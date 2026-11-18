use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread::{self, JoinHandle};

use super::{ConvertError, Plan, failed};

const STDERR_TAIL_LINES: usize = 20;

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

pub(super) fn for_each_line(reader: impl Read, mut f: impl FnMut(&str)) {
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

pub(super) fn ffmpeg_command(ffmpeg: &Path) -> Command {
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

pub(super) fn spawn_ffmpeg(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    plan: &Plan,
) -> io::Result<Child> {
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

pub(super) fn collect_tail(stderr: impl Read + Send + 'static) -> JoinHandle<Vec<String>> {
    thread::spawn(move || {
        let mut tail = VecDeque::with_capacity(STDERR_TAIL_LINES);
        for_each_line(stderr, |line| {
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line.to_owned());
        });
        Vec::from(tail)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
