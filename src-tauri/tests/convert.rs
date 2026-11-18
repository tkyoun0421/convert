use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;
use video_to_mp3_lib::converter::{
    self, Bitrate, ConvertError, ConvertRequest, OutputFormat, Registry, parse_probe,
};

fn ffmpeg() -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "ffmpeg-{}{}",
            env!("TARGET_TRIPLE"),
            std::env::consts::EXE_SUFFIX
        ));
    assert!(
        path.exists(),
        "run `node scripts/fetch-ffmpeg.mjs` first: {path:?}"
    );
    path
}

fn run_ffmpeg(args: &[&str]) -> String {
    let out = Command::new(ffmpeg())
        .args(["-hide_banner", "-nostdin", "-y"])
        .args(args)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn make_video(path: &Path, seconds: u32, audio: Option<&str>) {
    let video = format!("testsrc=duration={seconds}:size=160x120:rate=10");
    let sine = format!("sine=frequency=440:duration={seconds}");
    let path = path.to_str().unwrap();
    let mut args = vec!["-f", "lavfi", "-i", &video];
    match audio {
        Some(codec) => args.extend([
            "-f", "lavfi", "-i", &sine, "-ac", "2", "-c:a", codec, "-b:a", "128k",
        ]),
        None => args.push("-an"),
    }
    args.extend(["-c:v", "mpeg4", path]);
    let log = run_ffmpeg(&args);
    assert!(Path::new(path).exists(), "fixture failed: {log}");
}

fn request(input: &Path, output_dir: Option<&Path>, bitrate: Bitrate) -> ConvertRequest {
    ConvertRequest {
        input: input.to_path_buf(),
        output_dir: output_dir.map(Path::to_path_buf),
        format: OutputFormat::Mp3,
        bitrate,
    }
}

fn banner(path: &Path) -> String {
    run_ffmpeg(&["-i", path.to_str().unwrap()])
}

fn audio_kbps(banner: &str) -> u32 {
    let line = banner
        .lines()
        .find(|l| l.contains("Audio:"))
        .expect("audio line");
    let before = line.split(" kb/s").next().unwrap();
    before
        .rsplit(' ')
        .next()
        .unwrap()
        .parse()
        .expect("kb/s value")
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn aac_video_is_encoded_at_requested_bitrate() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("테스트 영상.mp4");
    make_video(&input, 3, Some("aac"));
    let registry = Registry::default();
    let mut progress = Vec::new();

    let outcome = converter::convert(
        &ffmpeg(),
        1,
        &request(&input, None, Bitrate::K320),
        &registry,
        |p| progress.push(p),
    )
    .unwrap();

    assert!(!outcome.copied);
    assert_eq!(outcome.output, dir.path().join("테스트 영상.mp3"));
    let info = banner(&outcome.output);
    let probe = parse_probe(&info);
    assert_eq!(probe.first_audio_codec.as_deref(), Some("mp3"));
    let seconds = probe.duration_us.unwrap() as f64 / 1e6;
    assert!((2.8..3.4).contains(&seconds), "duration {seconds}");
    assert_eq!(audio_kbps(&info), 320);
    assert!(!progress.is_empty(), "progress was reported");
    assert!(progress.iter().all(|p| (0.0..=100.0).contains(p)));
}

#[test]
fn mp3_audio_track_is_copied_without_reencoding() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("src.mkv");
    make_video(&input, 3, Some("libmp3lame"));
    let registry = Registry::default();

    let outcome = converter::convert(
        &ffmpeg(),
        1,
        &request(&input, None, Bitrate::K192),
        &registry,
        |_| {},
    )
    .unwrap();

    assert!(outcome.copied);
    let (src, out) = (banner(&input), banner(&outcome.output));
    assert_eq!(audio_kbps(&out), audio_kbps(&src));
    assert_eq!(audio_kbps(&out), 128);
    let diff = parse_probe(&src)
        .duration_us
        .unwrap()
        .abs_diff(parse_probe(&out).duration_us.unwrap());
    assert!(diff < 100_000, "duration differs by {diff}us");
}

#[test]
fn video_without_audio_reports_no_audio_and_leaves_no_file() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("silent.mp4");
    make_video(&input, 2, None);
    let registry = Registry::default();

    let err = converter::convert(
        &ffmpeg(),
        1,
        &request(&input, None, Bitrate::K192),
        &registry,
        |_| {},
    )
    .unwrap_err();

    assert_eq!(err, ConvertError::NoAudioStream);
    assert_eq!(files_in(dir.path()), ["silent.mp4"]);
}

#[test]
fn unreadable_input_fails_without_leaving_a_file() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("broken.mp4");
    fs::write(&input, b"not a video").unwrap();
    let registry = Registry::default();

    let err = converter::convert(
        &ffmpeg(),
        1,
        &request(&input, None, Bitrate::K192),
        &registry,
        |_| {},
    )
    .unwrap_err();

    assert!(matches!(err, ConvertError::Failed { .. }), "{err:?}");
    assert_eq!(files_in(dir.path()), ["broken.mp4"]);
}

#[test]
fn same_stem_inputs_never_overwrite_each_other_or_existing_files() {
    let dir = TempDir::new().unwrap();
    let (mp4, mkv) = (dir.path().join("a.mp4"), dir.path().join("a.mkv"));
    make_video(&mp4, 1, Some("aac"));
    make_video(&mkv, 1, Some("aac"));
    let existing = dir.path().join("a.mp3");
    fs::write(&existing, b"precious").unwrap();
    let registry = Registry::default();

    let first = converter::convert(
        &ffmpeg(),
        1,
        &request(&mp4, None, Bitrate::K128),
        &registry,
        |_| {},
    )
    .unwrap();
    let second = converter::convert(
        &ffmpeg(),
        2,
        &request(&mkv, None, Bitrate::K128),
        &registry,
        |_| {},
    )
    .unwrap();

    assert_eq!(first.output, dir.path().join("a (1).mp3"));
    assert_eq!(second.output, dir.path().join("a (2).mp3"));
    assert_eq!(fs::read(&existing).unwrap(), b"precious");
}

#[test]
fn cancel_stops_conversion_and_removes_output() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("long.mkv");
    run_ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=7200:sample_rate=8000",
        "-ac",
        "1",
        "-c:a",
        "pcm_u8",
        input.to_str().unwrap(),
    ]);
    let registry = Registry::default();
    let mut progress = Vec::new();

    let result = converter::convert(
        &ffmpeg(),
        7,
        &request(&input, None, Bitrate::K128),
        &registry,
        |p| {
            progress.push(p);
            converter::cancel(&registry, 7);
        },
    );

    assert_eq!(result, Err(ConvertError::Canceled));
    assert!(progress[0] < 100.0, "canceled mid-conversion");
    assert_eq!(files_in(dir.path()), ["long.mkv"]);
    converter::cancel(&registry, 7);
    converter::cancel(&registry, 999);
}

#[test]
fn explicit_output_dir_is_honoured() {
    let src = TempDir::new().unwrap();
    let out = TempDir::new().unwrap();
    let input = src.path().join("clip.mp4");
    make_video(&input, 1, Some("aac"));
    let registry = Registry::default();

    let outcome = converter::convert(
        &ffmpeg(),
        1,
        &request(&input, Some(out.path()), Bitrate::K192),
        &registry,
        |_| {},
    )
    .unwrap();

    assert_eq!(outcome.output, out.path().join("clip.mp3"));
    assert_eq!(files_in(src.path()), ["clip.mp4"]);
}

fn has_encoder(name: &str) -> bool {
    let out = Command::new(ffmpeg())
        .args(["-hide_banner", "-encoders"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).contains(&format!(" {name} "))
}

fn make_audio(path: &Path, source_args: &[&str]) {
    let mut args = vec!["-f", "lavfi", "-i"];
    args.extend(source_args);
    args.push(path.to_str().unwrap());
    let log = run_ffmpeg(&args);
    assert!(path.exists(), "fixture failed: {log}");
}

fn convert_as(input: &Path, format: OutputFormat) -> converter::ConvertOutcome {
    let req = ConvertRequest {
        format,
        ..request(input, None, Bitrate::K192)
    };
    converter::convert(&ffmpeg(), 1, &req, &Registry::default(), |_| {}).unwrap()
}

fn decodes_cleanly(path: &Path) -> bool {
    let log = run_ffmpeg(&[
        "-v",
        "error",
        "-i",
        path.to_str().unwrap(),
        "-f",
        "null",
        "-",
    ]);
    log.trim().is_empty()
}

fn audio_line(path: &Path) -> String {
    banner(path)
        .lines()
        .find(|l| l.contains("Audio:"))
        .expect("audio stream")
        .to_string()
}

fn seconds(path: &Path) -> f64 {
    parse_probe(&banner(path)).duration_us.unwrap() as f64 / 1e6
}

#[test]
fn m4a_copies_aac_track() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("clip.mp4");
    make_video(&input, 3, Some("aac"));

    let outcome = convert_as(&input, OutputFormat::M4a);

    assert!(outcome.copied);
    assert_eq!(outcome.output, dir.path().join("clip.m4a"));
    assert!(audio_line(&outcome.output).contains("Audio: aac"));
    assert!(decodes_cleanly(&outcome.output));
}

#[test]
fn m4a_encodes_non_aac_source_with_requested_bitrate() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("clip.mkv");
    make_video(&input, 2, Some("libmp3lame"));

    let outcome = convert_as(&input, OutputFormat::M4a);

    assert!(!outcome.copied);
    assert!(audio_line(&outcome.output).contains("Audio: aac"));
    assert!(decodes_cleanly(&outcome.output));
}

#[test]
fn flac_keeps_surround_channels_and_sample_rate() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("surround.mp4");
    make_audio(
        &input,
        &[
            "sine=frequency=440:duration=3:sample_rate=96000",
            "-ac",
            "6",
            "-c:a",
            "aac",
        ],
    );

    let outcome = convert_as(&input, OutputFormat::Flac);

    assert!(!outcome.copied);
    assert_eq!(outcome.output, dir.path().join("surround.flac"));
    let line = audio_line(&outcome.output);
    assert!(
        line.contains("Audio: flac") && line.contains("96000 Hz"),
        "{line}"
    );
    assert!(
        line.contains("5.1") || line.contains("6 channels"),
        "{line}"
    );
    assert!((seconds(&outcome.output) - seconds(&input)).abs() < 0.2);
    assert!(decodes_cleanly(&outcome.output));
}

#[test]
fn wav_is_24_bit_pcm() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("clip.mp4");
    make_video(&input, 2, Some("aac"));

    let outcome = convert_as(&input, OutputFormat::Wav);

    assert!(!outcome.copied);
    assert_eq!(outcome.output, dir.path().join("clip.wav"));
    assert!(audio_line(&outcome.output).contains("pcm_s24le"));
    assert!(decodes_cleanly(&outcome.output));
}

#[test]
fn original_keeps_opus_stream_as_opus_file() {
    if !has_encoder("libopus") {
        eprintln!("skipped: this ffmpeg build has no libopus encoder");
        return;
    }
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("voice.webm");
    make_audio(
        &input,
        &[
            "sine=frequency=440:duration=2",
            "-ar",
            "48000",
            "-c:a",
            "libopus",
        ],
    );

    let outcome = convert_as(&input, OutputFormat::Original);

    assert!(outcome.copied);
    assert_eq!(outcome.output, dir.path().join("voice.opus"));
    assert!(audio_line(&outcome.output).contains("Audio: opus"));
    assert!(decodes_cleanly(&outcome.output));
}

#[test]
fn original_puts_unlisted_codec_in_matroska_audio() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("raw.mov");
    make_audio(
        &input,
        &["sine=frequency=440:duration=2", "-c:a", "pcm_s16be"],
    );

    let outcome = convert_as(&input, OutputFormat::Original);

    assert!(outcome.copied);
    assert_eq!(outcome.output, dir.path().join("raw.mka"));
    assert!(audio_line(&outcome.output).contains("pcm_s16be"));
    assert!(decodes_cleanly(&outcome.output));
}

#[test]
fn m4a_copies_adts_aac_from_transport_stream() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("broadcast.ts");
    make_audio(&input, &["sine=frequency=440:duration=3", "-c:a", "aac"]);

    let outcome = convert_as(&input, OutputFormat::M4a);

    assert!(outcome.copied);
    assert_eq!(outcome.output, dir.path().join("broadcast.m4a"));
    assert!(decodes_cleanly(&outcome.output));
}
