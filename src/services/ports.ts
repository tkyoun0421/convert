import type { Bitrate, OutputFormat } from "../domain/formats";
import type { ConvertResult, Progress } from "../domain/jobs";
import type { Settings } from "../domain/settings";

export interface ConvertRequest {
  id: number;
  input: string;
  outputDir: string | null;
  format: OutputFormat;
  bitrate: Bitrate;
}

/** Runs conversions. A conversion never rejects: every ending is a `ConvertResult`. */
export interface Converter {
  convert(
    request: ConvertRequest,
    onProgress: (progress: Progress) => void,
  ): Promise<ConvertResult>;
  cancel(id: number): Promise<void>;
}

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
}

export type FileDrag = { kind: "hover" } | { kind: "drop"; paths: string[] } | { kind: "leave" };

export interface Desktop {
  /** Video files the user picked, or `null` when the dialog was closed. */
  pickVideos(): Promise<string[] | null>;
  /** The folder the user picked, or `null` when the dialog was closed. */
  pickFolder(): Promise<string | null>;
  reveal(path: string): Promise<void>;
  /** Calls `listener` for files dragged over the window until the returned function is called. */
  onFileDrag(listener: (drag: FileDrag) => void): () => void;
}

export interface Services {
  converter: Converter;
  settings: SettingsStore;
  desktop: Desktop;
}
