import { Channel, invoke } from "@tauri-apps/api/core";

export const BITRATES = [128, 192, 320] as const;
export type Bitrate = (typeof BITRATES)[number];
export const DEFAULT_BITRATE: Bitrate = 320;

export const OUTPUT_FORMATS = [
  { value: "mp3", label: "MP3 (기본)" },
  { value: "m4a", label: "M4A (AAC)" },
  { value: "flac", label: "FLAC (무손실)" },
  { value: "wav", label: "WAV (무손실·비압축)" },
  { value: "original", label: "원본 형식 그대로 (무손실)" },
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]["value"];
export const DEFAULT_FORMAT: OutputFormat = "mp3";

export function usesBitrate(format: OutputFormat): boolean {
  return format === "mp3" || format === "m4a";
}

export type ConvertError =
  | { kind: "canceled" }
  | { kind: "noAudioStream" }
  | { kind: "failed"; message: string };

export interface Progress {
  percent: number | null;
  /** Processing speed as a multiple of real time (ffmpeg `speed=`). */
  speed: number | null;
}

export interface ConvertOutcome {
  output: string;
  copied: boolean;
}

export interface ConvertArgs {
  id: number;
  input: string;
  outputDir: string | null;
  format: OutputFormat;
  bitrate: Bitrate;
}

export function convertFile(
  args: ConvertArgs,
  onProgress: (progress: Progress) => void,
): Promise<ConvertOutcome> {
  const channel = new Channel<Progress>();
  channel.onmessage = onProgress;
  return invoke<ConvertOutcome>("convert", { ...args, onProgress: channel });
}

export function cancelJob(id: number): Promise<void> {
  return invoke("cancel", { id });
}

export type Failure = { canceled: true } | { canceled: false; message: string };

function isConvertError(value: unknown): value is ConvertError {
  return typeof value === "object" && value !== null && "kind" in value;
}

export function toFailure(error: unknown): Failure {
  if (isConvertError(error)) {
    switch (error.kind) {
      case "canceled":
        return { canceled: true };
      case "noAudioStream":
        return { canceled: false, message: "오디오 트랙이 없는 영상입니다" };
      case "failed":
        return { canceled: false, message: error.message };
    }
  }
  return { canceled: false, message: String(error) };
}
