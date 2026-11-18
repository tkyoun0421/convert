use super::{Bitrate, OutputFormat};

/// What ffmpeg does with the audio track: the output extension, the codec/muxer arguments and whether the stream is copied untouched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub ext: &'static str,
    pub codec_args: Vec<String>,
    pub copied: bool,
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
