import {
  BITRATES,
  DEFAULT_BITRATE,
  DEFAULT_FORMAT,
  OUTPUT_FORMATS,
  type Bitrate,
  type OutputFormat,
} from "./formats";

export interface Settings {
  format: OutputFormat;
  bitrate: Bitrate;
  outputDir: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  format: DEFAULT_FORMAT,
  bitrate: DEFAULT_BITRATE,
  outputDir: null,
};

function isOneOf<T>(choices: readonly T[], value: unknown): value is T {
  return (choices as readonly unknown[]).includes(value);
}

/** Reads stored settings field by field: an unknown value falls back to its default alone. */
export function parseSettings(raw: unknown): Settings {
  const stored: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    format: isOneOf(OUTPUT_FORMATS, stored.format) ? stored.format : DEFAULT_SETTINGS.format,
    bitrate: isOneOf(BITRATES, stored.bitrate) ? stored.bitrate : DEFAULT_SETTINGS.bitrate,
    outputDir: typeof stored.outputDir === "string" ? stored.outputDir : null,
  };
}
