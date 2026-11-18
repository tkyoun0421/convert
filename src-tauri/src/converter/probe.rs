use std::path::Path;
use std::process::Stdio;

use super::ffmpeg::{error_from_stderr, ffmpeg_command};
use super::{ConvertError, failed};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Probe {
    pub duration_us: Option<u64>,
    pub first_audio_codec: Option<String>,
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
}
