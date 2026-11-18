pub mod converter;

use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use converter::{
    Bitrate, ConvertError, ConvertOutcome, ConvertRequest, JobId, OutputFormat, Registry,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, RunEvent, Runtime};

struct Ffmpeg(PathBuf);

fn ffmpeg_path() -> io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::other("실행 파일 위치를 알 수 없습니다"))?;
    Ok(dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)))
}

#[tauri::command]
async fn convert<R: Runtime>(
    app: AppHandle<R>,
    id: JobId,
    input: PathBuf,
    output_dir: Option<PathBuf>,
    format: OutputFormat,
    bitrate: Bitrate,
    on_progress: Channel<f64>,
) -> Result<ConvertOutcome, ConvertError> {
    let registry = Arc::clone(&app.state::<Arc<Registry>>());
    let ffmpeg = app.state::<Ffmpeg>().0.clone();
    let req = ConvertRequest {
        input,
        output_dir,
        format,
        bitrate,
    };
    tauri::async_runtime::spawn_blocking(move || {
        converter::convert(&ffmpeg, id, &req, &registry, |percent| {
            let _ = on_progress.send(percent);
        })
    })
    .await
    .map_err(|e| ConvertError::Failed {
        message: e.to_string(),
    })?
}

#[tauri::command]
async fn cancel<R: Runtime>(app: AppHandle<R>, id: JobId) {
    let registry = Arc::clone(&app.state::<Arc<Registry>>());
    let _ = tauri::async_runtime::spawn_blocking(move || converter::cancel(&registry, id)).await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Registry::default()))
        .setup(|app| {
            app.manage(Ffmpeg(ffmpeg_path()?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![convert, cancel])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Windows leaves child processes running after the parent exits.
            if let RunEvent::Exit = event {
                converter::cancel_all(&app.state::<Arc<Registry>>());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::path::Path;
    use std::process::Command;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{
        INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
    };
    use tauri::webview::InvokeRequest;
    use tauri::{WebviewWindow, WebviewWindowBuilder};

    fn sidecar() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "ffmpeg-{}{}",
                env!("TARGET_TRIPLE"),
                std::env::consts::EXE_SUFFIX
            ))
    }

    fn make_video(path: &Path, audio: bool) {
        let mut cmd = Command::new(sidecar());
        cmd.args(["-hide_banner", "-nostdin", "-y", "-f", "lavfi"])
            .args(["-i", "testsrc=duration=2:size=160x120:rate=10"]);
        if audio {
            cmd.args(["-f", "lavfi", "-i", "sine=frequency=440:duration=2"])
                .args(["-c:a", "aac"]);
        }
        let status = cmd
            .args(["-c:v", "mpeg4"])
            .arg(path)
            .output()
            .unwrap()
            .status;
        assert!(status.success(), "fixture {path:?}");
    }

    fn webview() -> WebviewWindow<MockRuntime> {
        let app = mock_builder()
            .manage(Arc::new(Registry::default()))
            .manage(Ffmpeg(sidecar()))
            .invoke_handler(tauri::generate_handler![convert, cancel])
            .build(mock_context(noop_assets()))
            .unwrap();
        WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap()
    }

    fn invoke(
        webview: &WebviewWindow<MockRuntime>,
        cmd: &str,
        body: Value,
    ) -> Result<Value, Value> {
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|b| b.deserialize::<Value>().unwrap())
    }

    /// Payloads shaped exactly like `src/api.ts` sends them.
    #[test]
    fn frontend_payloads_round_trip_through_the_commands() {
        let dir = tempfile::tempdir().unwrap();
        let clip = dir.path().join("클립.mp4");
        let silent = dir.path().join("silent.mp4");
        make_video(&clip, true);
        make_video(&silent, false);
        let out = dir.path().join("out");
        std::fs::create_dir(&out).unwrap();
        let webview = webview();
        let request =
            |id: u64, input: &Path, output_dir: Option<&Path>, format: &str, bitrate: u16| {
                json!({
                    "id": id,
                    "input": input,
                    "outputDir": output_dir,
                    "format": format,
                    "bitrate": bitrate,
                    "onProgress": "__CHANNEL__:1",
                })
            };

        assert_eq!(
            invoke(&webview, "convert", request(1, &clip, None, "m4a", 320)),
            Ok(json!({ "output": dir.path().join("클립.m4a"), "copied": true }))
        );
        assert_eq!(
            invoke(
                &webview,
                "convert",
                request(2, &clip, Some(&out), "mp3", 192)
            ),
            Ok(json!({ "output": out.join("클립.mp3"), "copied": false }))
        );
        assert_eq!(
            invoke(&webview, "convert", request(3, &silent, None, "flac", 320)),
            Err(json!({ "kind": "noAudioStream" }))
        );
        assert!(
            invoke(&webview, "convert", request(4, &clip, None, "mp3", 100))
                .is_err_and(|e| e.is_string()),
            "unsupported bitrate is rejected at the IPC boundary"
        );
        assert_eq!(
            invoke(&webview, "cancel", json!({ "id": 99 })),
            Ok(Value::Null)
        );
    }
}
