mod ffmpeg;
mod plan;
mod probe;
mod progress;
mod registry;

use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub use ffmpeg::error_from_stderr;
pub use plan::{Plan, plan};
pub use probe::{Probe, parse_duration_line, parse_probe, probe};
pub use progress::{parse_out_time_us, parse_speed, percent};
pub use registry::{Registry, RunningJob, cancel, cancel_all};

use ffmpeg::{collect_tail, for_each_line, spawn_ffmpeg};
use progress::ProgressTracker;

pub type JobId = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u16")]
pub enum Bitrate {
    K128,
    K192,
    K320,
}

impl Bitrate {
    pub fn kbps(self) -> u16 {
        match self {
            Bitrate::K128 => 128,
            Bitrate::K192 => 192,
            Bitrate::K320 => 320,
        }
    }
}

impl TryFrom<u16> for Bitrate {
    type Error = String;

    fn try_from(kbps: u16) -> Result<Self, Self::Error> {
        match kbps {
            128 => Ok(Bitrate::K128),
            192 => Ok(Bitrate::K192),
            320 => Ok(Bitrate::K320),
            other => Err(format!("지원하지 않는 비트레이트입니다: {other}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    Mp3,
    M4a,
    Flac,
    Wav,
    Original,
}

#[derive(Clone, Debug)]
pub struct ConvertRequest {
    pub input: PathBuf,
    pub output_dir: Option<PathBuf>,
    pub format: OutputFormat,
    pub bitrate: Bitrate,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConvertError {
    Canceled,
    NoAudioStream,
    Failed { message: String },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOutcome {
    pub output: PathBuf,
    pub copied: bool,
}

/// One `-progress` report. `percent` is `None` when the input length is unknown.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Progress {
    pub percent: Option<f64>,
    /// Processing speed as a multiple of real time, from ffmpeg's `speed=52.3x`.
    pub speed: Option<f64>,
}

fn failed(message: impl Into<String>) -> ConvertError {
    ConvertError::Failed {
        message: message.into(),
    }
}

fn reserve_output(input: &Path, output_dir: Option<&Path>, ext: &str) -> io::Result<PathBuf> {
    let dir = output_dir
        .or_else(|| input.parent())
        .unwrap_or_else(|| Path::new("."));
    let stem = input.file_stem().unwrap_or(OsStr::new("audio"));
    let mut attempt = 0u32;
    loop {
        let mut name = stem.to_os_string();
        if attempt > 0 {
            name.push(format!(" ({attempt})"));
        }
        name.push(format!(".{ext}"));
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => attempt += 1,
            Err(e) => return Err(e),
        }
    }
}

pub fn convert(
    ffmpeg: &Path,
    id: JobId,
    req: &ConvertRequest,
    registry: &Registry,
    mut on_progress: impl FnMut(Progress),
) -> Result<ConvertOutcome, ConvertError> {
    let probed = probe(ffmpeg, &req.input)?;
    let Some(codec) = probed.first_audio_codec.as_deref() else {
        return Err(ConvertError::NoAudioStream);
    };
    let plan = plan(req.format, codec, req.bitrate);

    let output = reserve_output(&req.input, req.output_dir.as_deref(), plan.ext)
        .map_err(|e| failed(format!("출력 파일을 만들 수 없습니다: {e}")))?;

    let mut child = match spawn_ffmpeg(ffmpeg, &req.input, &output, &plan) {
        Ok(child) => child,
        Err(e) => {
            let _ = fs::remove_file(&output);
            return Err(failed(format!("ffmpeg를 실행할 수 없습니다: {e}")));
        }
    };
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    registry.register(
        id,
        RunningJob {
            child,
            output: output.clone(),
        },
    );

    let stderr_thread = collect_tail(stderr);

    let mut tracker = ProgressTracker::new(probed.duration_us);
    for_each_line(stdout, |line| {
        if let Some(progress) = tracker.line(line) {
            on_progress(progress);
        }
    });

    let tail = stderr_thread.join().unwrap_or_default();
    // A cancel holds the registry lock until the file is deleted, so a missing
    // entry here means the cancel is already complete.
    let Some(mut job) = registry.take(id) else {
        return Err(ConvertError::Canceled);
    };
    let status = job
        .child
        .wait()
        .map_err(|e| failed(format!("ffmpeg 종료를 확인할 수 없습니다: {e}")))?;
    if status.success() {
        return Ok(ConvertOutcome {
            output,
            copied: plan.copied,
        });
    }
    let _ = fs::remove_file(&job.output);
    Err(error_from_stderr(&tail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitrate_accepts_only_known_values() {
        let parse = |n: u16| serde_json::from_value::<Bitrate>(serde_json::json!(n));
        assert_eq!(parse(192).unwrap(), Bitrate::K192);
        assert_eq!(parse(320).unwrap().kbps(), 320);
        assert!(parse(100).is_err());
    }
}
