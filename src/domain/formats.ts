export const BITRATES = [128, 192, 320] as const;
export type Bitrate = (typeof BITRATES)[number];
export const DEFAULT_BITRATE: Bitrate = 320;

export type OutputFormat = "mp3" | "m4a" | "flac" | "wav" | "original";
export const DEFAULT_FORMAT: OutputFormat = "mp3";

interface FormatInfo {
  label: string;
  usesBitrate: boolean;
  hint: string;
}

const LOSSLESS_HINT = "무손실 형식이라 비트레이트를 쓰지 않습니다. 대신 파일이 커집니다.";

/** Everything the screen says or decides per output format. Order is the order shown. */
export const FORMATS: Record<OutputFormat, FormatInfo> = {
  mp3: {
    label: "MP3 (기본)",
    usesBitrate: true,
    hint: "320 kbps가 MP3 최고 음질입니다. 128·192 kbps는 파일이 작아지는 대신 음질이 낮아집니다. 원본이 MP3면 그대로 복사합니다.",
  },
  m4a: {
    label: "M4A (AAC)",
    usesBitrate: true,
    hint: "320 kbps가 가장 높은 음질입니다. 128·192 kbps는 파일이 작아지는 대신 음질이 낮아집니다. 원본이 AAC면 그대로 복사합니다.",
  },
  flac: { label: "FLAC (무손실)", usesBitrate: false, hint: LOSSLESS_HINT },
  wav: { label: "WAV (무손실·비압축)", usesBitrate: false, hint: LOSSLESS_HINT },
  original: {
    label: "원본 형식 그대로 (무손실)",
    usesBitrate: false,
    hint: "오디오를 다시 인코딩하지 않고 그대로 꺼내므로 비트레이트를 쓰지 않습니다.",
  },
};

export const OUTPUT_FORMATS = Object.keys(FORMATS) as OutputFormat[];
