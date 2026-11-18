use super::Progress;

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

/// Folds ffmpeg's `-progress` lines into reports. A report is emitted on `progress=`, using the latest `out_time_us=` and `speed=` seen.
pub struct ProgressTracker {
    duration_us: Option<u64>,
    out_time_us: Option<u64>,
    speed: Option<f64>,
}

impl ProgressTracker {
    pub fn new(duration_us: Option<u64>) -> Self {
        Self {
            duration_us,
            out_time_us: None,
            speed: None,
        }
    }

    pub fn line(&mut self, line: &str) -> Option<Progress> {
        if line.starts_with("out_time_us=") {
            self.out_time_us = parse_out_time_us(line);
        } else if line.starts_with("speed=") {
            self.speed = parse_speed(line);
        } else if line.starts_with("progress=") {
            let percent = self
                .out_time_us
                .and_then(|us| percent(us, self.duration_us));
            if percent.is_some() || self.speed.is_some() {
                return Some(Progress {
                    percent,
                    speed: self.speed,
                });
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn feed(tracker: &mut ProgressTracker, lines: &[&str]) -> Vec<Option<Progress>> {
        lines.iter().map(|l| tracker.line(l)).collect()
    }

    #[test]
    fn emits_only_on_progress_line() {
        let mut tracker = ProgressTracker::new(Some(1_000_000));
        let out = feed(
            &mut tracker,
            &[
                "out_time_us=500000",
                "speed=2.0x",
                "bitrate=128.0kbits/s",
                "progress=continue",
            ],
        );
        assert_eq!(out[..3], [None, None, None]);
        assert_eq!(
            out[3],
            Some(Progress {
                percent: Some(50.0),
                speed: Some(2.0)
            })
        );
    }

    #[test]
    fn na_resets_a_known_value() {
        let mut tracker = ProgressTracker::new(Some(1_000_000));
        feed(&mut tracker, &["out_time_us=500000", "speed=2.0x"]);
        let out = feed(&mut tracker, &["out_time_us=N/A", "progress=continue"]);
        assert_eq!(
            out[1],
            Some(Progress {
                percent: None,
                speed: Some(2.0)
            })
        );
        let out = feed(&mut tracker, &["speed=N/A", "progress=continue"]);
        assert_eq!(out[1], None);
    }

    #[test]
    fn unknown_duration_still_reports_speed() {
        let mut tracker = ProgressTracker::new(None);
        let out = feed(
            &mut tracker,
            &["out_time_us=500000", "speed=3.0x", "progress=continue"],
        );
        assert_eq!(
            out[2],
            Some(Progress {
                percent: None,
                speed: Some(3.0)
            })
        );
    }

    #[test]
    fn nothing_emitted_when_both_unknown() {
        let mut tracker = ProgressTracker::new(None);
        let out = feed(
            &mut tracker,
            &["out_time_us=500000", "speed=N/A", "progress=continue"],
        );
        assert_eq!(out, [None, None, None]);

        let mut tracker = ProgressTracker::new(Some(1_000_000));
        let out = feed(
            &mut tracker,
            &["out_time_us=N/A", "speed=N/A", "progress=continue"],
        );
        assert_eq!(out, [None, None, None]);
    }

    #[test]
    fn values_persist_across_continue_blocks() {
        let mut tracker = ProgressTracker::new(Some(1_000_000));
        feed(
            &mut tracker,
            &["out_time_us=250000", "speed=2.0x", "progress=continue"],
        );
        assert_eq!(
            tracker.line("progress=continue"),
            Some(Progress {
                percent: Some(25.0),
                speed: Some(2.0)
            })
        );
        let out = feed(&mut tracker, &["out_time_us=1000000", "progress=end"]);
        assert_eq!(
            out[1],
            Some(Progress {
                percent: Some(100.0),
                speed: Some(2.0)
            })
        );
    }
}
