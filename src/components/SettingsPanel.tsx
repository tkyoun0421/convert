import {
  BITRATES,
  FORMATS,
  OUTPUT_FORMATS,
  type Bitrate,
  type OutputFormat,
} from "../domain/formats";
import type { Settings } from "../domain/settings";

interface SettingsPanelProps {
  settings: Settings;
  /** While converting, settings stay as they were when the run started. */
  locked: boolean;
  onChange: (change: Partial<Settings>) => void;
  onPickFolder: () => void;
}

export function SettingsPanel({ settings, locked, onChange, onPickFolder }: SettingsPanelProps) {
  const format = FORMATS[settings.format];
  return (
    <section className="settings">
      <div className="setting">
        <span className="setting-label">출력</span>
        <div className="setting-control">
          <div className="setting-inline">
            <select
              aria-label="출력 형식"
              value={settings.format}
              disabled={locked}
              onChange={(e) => onChange({ format: e.target.value as OutputFormat })}
            >
              {OUTPUT_FORMATS.map((value) => (
                <option key={value} value={value}>
                  {FORMATS[value].label}
                </option>
              ))}
            </select>
            <select
              className="narrow"
              aria-label="음질"
              value={settings.bitrate}
              disabled={locked || !format.usesBitrate}
              aria-describedby="bitrate-hint"
              onChange={(e) => onChange({ bitrate: Number(e.target.value) as Bitrate })}
            >
              {BITRATES.map((b) => (
                <option key={b} value={b}>
                  {b} kbps
                </option>
              ))}
            </select>
          </div>
          <p id="bitrate-hint" className="hint">
            {format.hint}
          </p>
        </div>
      </div>
      <div className="setting">
        <span className="setting-label">저장 위치</span>
        <div className="setting-control output-dir">
          <span className="path" title={settings.outputDir ?? undefined}>
            {settings.outputDir ?? "원본 영상과 같은 폴더"}
          </span>
          <button type="button" disabled={locked} onClick={onPickFolder}>
            폴더 선택…
          </button>
          {settings.outputDir && (
            <button
              type="button"
              className="quiet"
              disabled={locked}
              onClick={() => onChange({ outputDir: null })}
            >
              원본 폴더로
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
