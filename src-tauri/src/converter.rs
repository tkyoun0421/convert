use std::collections::{HashMap, VecDeque};
use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;

use serde::{Deserialize, Serialize};

pub type JobId = u64;

const STDERR_TAIL_LINES: usize = 20;

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

/// What ffmpeg does with the audio track: the output extension, the codec/muxer arguments and whether the stream is copied untouched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub ext: &'static str,
    pub codec_args: Vec<String>,
    pub copied: bool,
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

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Probe {
    pub duration_us: Option<u64>,
    pub first_audio_codec: Option<String>,
}

pub struct RunningJob {
    child: Child,
    output: PathBuf,
}

#[derive(Default)]
pub struct Registry {
    running: Mutex<HashMap<JobId, RunningJob>>,
}

impl Registry {
    fn lock(&self) -> MutexGuard<'_, HashMap<JobId, RunningJob>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn failed(message: impl Into<String>) -> ConvertError {
    ConvertError::Failed {
        message: message.into(),
    }
}

/// `Duration: HH:MM:SS.xx, ...` into microseconds. `N/A` and non-duration lines give `None`.
pub fn parse_duration_line(line: &str) -> Option<u64> {
    let rest = line.trim_start().strip_prefix("Duration: ")?;
    let stamp = rest.split(',').next()?.trim();
    let mut parts = stamp.split(':');
    let hours: u64 = parts.next()?.parse().ok()?;
    let minutes: u64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some((hours * 3600 + minutes * 60) * 1_000_000 + (seconds * 1_000_000.0).round() as u64)
}

/// `-progress` line `out_time_us=<n>`. `N/A` and negative values give `None`.
pub fn parse_out_time_us(line: &str) -> Option<u64> {
    line.strip_prefix("out_time_us=")?.trim().parse().ok()
}

/// `-progress` line `speed=52.3x`. `N/A` and non-positive values give `None`.
pub fn parse_speed(line: &str) -> Option<f64> {
    let value: f64 = line
        .strip_prefix("speed=")?
        .trim()
        .strip_suffix('x')?
        .trim()
        .parse()
        .ok()?;
    (value.is_finite() && value > 0.0).then_some(value)
}

pub fn percent(out_time_us: u64, duration_us: Option<u64>) -> Option<f64> {
    let duration = duration_us.filter(|&d| d > 0)?;
    Some((out_time_us as f64 / duration as f64 * 100.0).clamp(0.0, 100.0))
}

fn parse_audio_codec(line: &str) -> Option<String> {
    if !line.trim_start().starts_with("Stream #") {
        return None;
    }
    let rest = line.split_once(": Audio: ")?.1;
    let codec: String = rest
        .chars()
        .take_while(|c| !c.is_whitespace() && *c != ',')
        .collect();
    (!codec.is_empty()).then_some(codec)
}

/// Reads the banner `ffmpeg -i <input>` prints on stderr.
pub fn parse_probe(stderr: &str) -> Probe {
    Probe {
        duration_us: stderr
            .lines()
            .find(|l| l.trim_start().starts_with("Duration: "))
            .and_then(parse_duration_line),
        first_audio_codec: stderr.lines().find_map(parse_audio_codec),
    }
}

const PCM_WAV_CODECS: [&str; 4] = ["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le"];

const ORIGINAL_EXTENSIONS: [(&str, &str); 15] = [
    ("aac", "m4a"),
    ("alac", "m4a"),
    ("mp3", "mp3"),
    ("opus", "opus"),
    ("vorbis", "ogg"),
    ("flac", "flac"),
    ("ac3", "ac3"),
    ("eac3", "eac3"),
    ("mp2", "mp2"),
    ("wmav1", "wma"),
    ("wmav2", "wma"),
    ("pcm_s16le", "wav"),
    ("pcm_s24le", "wav"),
    ("pcm_s32le", "wav"),
    ("pcm_f32le", "wav"),
];

/// Muxer options that only exist for one container; other muxers reject them.
fn muxer_args(ext: &str) -> &'static [&'static str] {
    match ext {
        "mp3" => &["-id3v2_version", "3"],
        "m4a" => &["-movflags", "+faststart"],
        "wav" => &["-rf64", "auto"],
        _ => &[],
    }
}

fn codec_args(codec: &[&str], ext: &str) -> Vec<String> {
    codec
        .iter()
        .chain(muxer_args(ext))
        .map(|a| a.to_string())
        .collect()
}

pub fn plan(format: OutputFormat, source_codec: &str, bitrate: Bitrate) -> Plan {
    let copy = ["-c:a", "copy"];
    let kbps = format!("{}k", bitrate.kbps());
    let (ext, codec, copied): (&'static str, Vec<&str>, bool) = match format {
        OutputFormat::Mp3 if source_codec == "mp3" => ("mp3", copy.to_vec(), true),
        OutputFormat::Mp3 => (
            "mp3",
            vec![
                "-c:a",
                "libmp3lame",
                "-b:a",
                &kbps,
                "-compression_level",
                "0",
            ],
            false,
        ),
        OutputFormat::M4a if source_codec == "aac" => ("m4a", copy.to_vec(), true),
        OutputFormat::M4a => ("m4a", vec!["-c:a", "aac", "-b:a", &kbps], false),
        OutputFormat::Flac if source_codec == "flac" => ("flac", copy.to_vec(), true),
        OutputFormat::Flac => ("flac", vec!["-c:a", "flac"], false),
        OutputFormat::Wav if PCM_WAV_CODECS.contains(&source_codec) => ("wav", copy.to_vec(), true),
        OutputFormat::Wav => ("wav", vec!["-c:a", "pcm_s24le"], false),
        OutputFormat::Original => {
            let ext = ORIGINAL_EXTENSIONS
                .iter()
                .find(|(codec, _)| *codec == source_codec)
                .map_or("mka", |(_, ext)| *ext);
            (ext, copy.to_vec(), true)
        }
    };
    Plan {
        ext,
        codec_args: codec_args(&codec, ext),
        copied,
    }
}

pub fn error_from_stderr(tail: &[String]) -> ConvertError {
    if tail.iter().any(|l| l.contains("matches no streams")) {
        return ConvertError::NoAudioStream;
    }
    let relevant: Vec<&str> = tail
        .iter()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    let start = relevant.len().saturating_sub(2);
    if relevant.is_empty() {
        return failed("ffmpeg가 오류와 함께 종료되었습니다");
    }
    failed(relevant[start..].join("\n"))
}

fn for_each_line(reader: impl Read, mut f: impl FnMut(&str)) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => f(String::from_utf8_lossy(&buf).trim_end()),
        }
    }
}

fn ffmpeg_command(ffmpeg: &Path) -> Command {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// ffmpeg exits non-zero here ("At least one output file must be specified"); only its stderr matters.
pub fn probe(ffmpeg: &Path, input: &Path) -> Result<Probe, ConvertError> {
    let out = ffmpeg_command(ffmpeg)
        .arg("-i")
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| failed(format!("ffmpeg를 실행할 수 없습니다: {e}")))?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stderr.contains("Input #0") {
        let tail: Vec<String> = stderr.lines().map(str::to_owned).collect();
        return Err(error_from_stderr(&tail));
    }
    Ok(parse_probe(&stderr))
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

fn spawn_ffmpeg(ffmpeg: &Path, input: &Path, output: &Path, plan: &Plan) -> io::Result<Child> {
    ffmpeg_command(ffmpeg)
        .args(["-y", "-i"])
        .arg(input)
        .args(["-map", "0:a:0", "-vn"])
        .args(&plan.codec_args)
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
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
    registry.lock().insert(
        id,
        RunningJob {
            child,
            output: output.clone(),
        },
    );

    let stderr_thread = thread::spawn(move || {
        let mut tail = VecDeque::with_capacity(STDERR_TAIL_LINES);
        for_each_line(stderr, |line| {
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line.to_owned());
        });
        Vec::from(tail)
    });

    let mut out_time_us = None;
    let mut speed = None;
    for_each_line(stdout, |line| {
        if line.starts_with("out_time_us=") {
            out_time_us = parse_out_time_us(line);
        } else if line.starts_with("speed=") {
            speed = parse_speed(line);
        } else if line.starts_with("progress=") {
            let percent = out_time_us.and_then(|us| percent(us, probed.duration_us));
            if percent.is_some() || speed.is_some() {
                on_progress(Progress { percent, speed });
            }
        }
    });

    let tail = stderr_thread.join().unwrap_or_default();
    // A cancel holds the registry lock until the file is deleted, so a missing
    // entry here means the cancel is already complete.
    let Some(mut job) = registry.lock().remove(&id) else {
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

fn stop(mut job: RunningJob) {
    let _ = job.child.kill();
    // Windows cannot delete a file the process still has open.
    let _ = job.child.wait();
    let _ = fs::remove_file(&job.output);
}

/// Holds the registry lock while stopping so `convert` cannot report `Canceled` before the file is gone.
pub fn cancel(registry: &Registry, id: JobId) {
    let mut running = registry.lock();
    if let Some(job) = running.remove(&id) {
        stop(job);
    }
}

pub fn cancel_all(registry: &Registry) {
    for (_, job) in registry.lock().drain() {
        stop(job);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_line_parses_to_microseconds() {
        assert_eq!(
            parse_duration_line("  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s"),
            Some(3_723_500_000)
        );
        assert_eq!(parse_duration_line("  Duration: N/A, bitrate: N/A"), None);
        assert_eq!(
            parse_duration_line("    DURATION        : 00:00:03.0"),
            None
        );
    }

    #[test]
    fn out_time_ignores_na_and_negative() {
        assert_eq!(parse_out_time_us("out_time_us=1500000"), Some(1_500_000));
        assert_eq!(parse_out_time_us("out_time_us=N/A"), None);
        assert_eq!(parse_out_time_us("out_time_us=-9223372036854775807"), None);
        assert_eq!(parse_out_time_us("progress=continue"), None);
    }

    #[test]
    fn speed_reads_multiplier_and_ignores_na() {
        assert_eq!(parse_speed("speed=52.3x"), Some(52.3));
        assert_eq!(parse_speed("speed=   1.5x"), Some(1.5));
        assert_eq!(parse_speed("speed=1e+03x"), Some(1000.0));
        assert_eq!(parse_speed("speed=N/A"), None);
        assert_eq!(parse_speed("speed=0x"), None);
        assert_eq!(parse_speed("bitrate=128.0kbits/s"), None);
    }

    #[test]
    fn percent_clamps_and_needs_duration() {
        assert_eq!(percent(500, Some(1000)), Some(50.0));
        assert_eq!(percent(2000, Some(1000)), Some(100.0));
        assert_eq!(percent(500, Some(0)), None);
        assert_eq!(percent(500, None), None);
    }

    const AAC_BANNER: &str = "\
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:03.05, start: 0.000000, bitrate: 200 kb/s
  Stream #0:0[0x1](und): Video: mpeg4 (Simple Profile), yuv420p, 160x120, 10 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s
At least one output file must be specified";

    #[test]
    fn probe_reads_aac() {
        assert_eq!(
            parse_probe(AAC_BANNER),
            Probe {
                duration_us: Some(3_050_000),
                first_audio_codec: Some("aac".into())
            }
        );
    }

    #[test]
    fn probe_reads_mp3_float_as_mp3() {
        let banner = "  Duration: 00:00:01.00, start: 0\n  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 128 kb/s\n";
        assert_eq!(
            parse_probe(banner).first_audio_codec.as_deref(),
            Some("mp3")
        );
    }

    #[test]
    fn probe_without_audio_has_no_codec() {
        let banner =
            "  Duration: 00:00:03.00, start: 0\n  Stream #0:0: Video: mpeg4, yuv420p, 160x120\n";
        assert_eq!(parse_probe(banner).first_audio_codec, None);
    }

    #[test]
    fn probe_duration_na_is_unknown() {
        let banner =
            "  Duration: N/A, bitrate: N/A\n  Stream #0:0: Audio: opus, 48000 Hz, stereo\n";
        assert_eq!(
            parse_probe(banner),
            Probe {
                duration_us: None,
                first_audio_codec: Some("opus".into())
            }
        );
    }

    fn args(plan: &Plan) -> Vec<&str> {
        plan.codec_args.iter().map(String::as_str).collect()
    }

    #[test]
    fn mp3_plan_copies_mp3_and_encodes_the_rest() {
        let copied = plan(OutputFormat::Mp3, "mp3", Bitrate::K128);
        assert_eq!((copied.ext, copied.copied), ("mp3", true));
        assert_eq!(args(&copied), ["-c:a", "copy", "-id3v2_version", "3"]);

        let encoded = plan(OutputFormat::Mp3, "aac", Bitrate::K320);
        assert!(!encoded.copied);
        assert_eq!(
            args(&encoded),
            [
                "-c:a",
                "libmp3lame",
                "-b:a",
                "320k",
                "-compression_level",
                "0",
                "-id3v2_version",
                "3"
            ]
        );
    }

    #[test]
    fn m4a_plan_copies_aac_and_encodes_the_rest() {
        let copied = plan(OutputFormat::M4a, "aac", Bitrate::K128);
        assert_eq!((copied.ext, copied.copied), ("m4a", true));
        assert_eq!(args(&copied), ["-c:a", "copy", "-movflags", "+faststart"]);

        let encoded = plan(OutputFormat::M4a, "mp3", Bitrate::K192);
        assert!(!encoded.copied);
        assert_eq!(
            args(&encoded),
            ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
        );
    }

    #[test]
    fn flac_plan_copies_flac_and_encodes_the_rest() {
        let copied = plan(OutputFormat::Flac, "flac", Bitrate::K320);
        assert_eq!((copied.ext, copied.copied), ("flac", true));
        assert_eq!(args(&copied), ["-c:a", "copy"]);

        let encoded = plan(OutputFormat::Flac, "aac", Bitrate::K320);
        assert_eq!((encoded.ext, encoded.copied), ("flac", false));
        assert_eq!(args(&encoded), ["-c:a", "flac"]);
    }

    #[test]
    fn wav_plan_copies_pcm_le_and_encodes_the_rest() {
        for codec in ["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le"] {
            let copied = plan(OutputFormat::Wav, codec, Bitrate::K192);
            assert!(copied.copied, "{codec}");
            assert_eq!(args(&copied), ["-c:a", "copy", "-rf64", "auto"]);
        }
        for codec in ["pcm_s16be", "pcm_u8", "aac"] {
            let encoded = plan(OutputFormat::Wav, codec, Bitrate::K192);
            assert!(!encoded.copied, "{codec}");
            assert_eq!(args(&encoded), ["-c:a", "pcm_s24le", "-rf64", "auto"]);
        }
        assert_eq!(plan(OutputFormat::Wav, "aac", Bitrate::K192).ext, "wav");
    }

    #[test]
    fn original_plan_copies_with_extension_from_codec() {
        let cases = [
            ("aac", "m4a"),
            ("alac", "m4a"),
            ("mp3", "mp3"),
            ("opus", "opus"),
            ("vorbis", "ogg"),
            ("flac", "flac"),
            ("ac3", "ac3"),
            ("eac3", "eac3"),
            ("mp2", "mp2"),
            ("wmav1", "wma"),
            ("wmav2", "wma"),
            ("pcm_s16le", "wav"),
            ("pcm_s24le", "wav"),
            ("pcm_s32le", "wav"),
            ("pcm_f32le", "wav"),
            ("pcm_s16be", "mka"),
            ("dts", "mka"),
        ];
        for (codec, ext) in cases {
            let p = plan(OutputFormat::Original, codec, Bitrate::K192);
            assert_eq!((p.ext, p.copied), (ext, true), "{codec}");
            assert_eq!(&args(&p)[..2], ["-c:a", "copy"], "{codec}");
        }
    }

    #[test]
    fn stderr_maps_to_errors() {
        let no_audio = vec!["Stream map '0:a:0' matches no streams.".to_string()];
        assert_eq!(error_from_stderr(&no_audio), ConvertError::NoAudioStream);

        let other = vec![
            "first".to_string(),
            "x: Invalid data found".to_string(),
            "".to_string(),
            "Conversion failed!".to_string(),
        ];
        assert_eq!(
            error_from_stderr(&other),
            failed("x: Invalid data found\nConversion failed!")
        );
        assert!(matches!(
            error_from_stderr(&[]),
            ConvertError::Failed { .. }
        ));
    }

    #[test]
    fn bitrate_accepts_only_known_values() {
        let parse = |n: u16| serde_json::from_value::<Bitrate>(serde_json::json!(n));
        assert_eq!(parse(192).unwrap(), Bitrate::K192);
        assert_eq!(parse(320).unwrap().kbps(), 320);
        assert!(parse(100).is_err());
    }
}
