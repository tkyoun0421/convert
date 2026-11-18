import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  BITRATES,
  DEFAULT_BITRATE,
  DEFAULT_FORMAT,
  OUTPUT_FORMATS,
  cancelJob,
  convertFile,
  toFailure,
  usesBitrate,
  type Bitrate,
  type OutputFormat,
} from "./api";
import { JobRow } from "./JobRow";
import {
  VIDEO_EXTENSIONS,
  initialJobs,
  isFinished,
  isVideoPath,
  jobsReducer,
  type Job,
} from "./jobs";

const MAX_PARALLEL = 2;
const SETTINGS_KEY = "videoToMp3.settings";

interface Settings {
  format: OutputFormat;
  bitrate: Bitrate;
  outputDir: string | null;
}

function loadSettings(): Settings {
  const fallback: Settings = {
    format: DEFAULT_FORMAT,
    bitrate: DEFAULT_BITRATE,
    outputDir: null,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return {
      format: OUTPUT_FORMATS.some((f) => f.value === raw?.format)
        ? raw.format
        : fallback.format,
      bitrate: BITRATES.includes(raw?.bitrate) ? raw.bitrate : fallback.bitrate,
      outputDir: typeof raw?.outputDir === "string" ? raw.outputDir : null,
    };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings just will not persist.
  }
}

function bitrateHint(format: OutputFormat): string {
  switch (format) {
    case "mp3":
      return "320 kbps가 MP3 최고 음질입니다. 128·192 kbps는 파일이 작아지는 대신 음질이 낮아집니다. 원본이 MP3면 그대로 복사합니다.";
    case "m4a":
      return "320 kbps가 가장 높은 음질입니다. 128·192 kbps는 파일이 작아지는 대신 음질이 낮아집니다. 원본이 AAC면 그대로 복사합니다.";
    case "flac":
    case "wav":
      return "무손실 형식이라 비트레이트를 쓰지 않습니다. 대신 파일이 커집니다.";
    case "original":
      return "오디오를 다시 인코딩하지 않고 그대로 꺼내므로 비트레이트를 쓰지 않습니다.";
  }
}

export default function App() {
  const [{ jobs }, dispatch] = useReducer(jobsReducer, initialJobs);
  const [settings, setSettings] = useState(loadSettings);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const launched = useRef(new Set<number>());

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
  }, [settings]);

  const addPaths = useCallback((paths: string[]) => {
    const videos = paths.filter(isVideoPath);
    const skipped = paths.length - videos.length;
    setNotice(
      skipped > 0
        ? `영상 파일이 아닌 ${skipped}개 파일은 건너뛰었습니다.`
        : null,
    );
    if (videos.length > 0) dispatch({ type: "add", paths: videos });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
        } else if (payload.type === "drop") {
          setDragging(false);
          addPaths(payload.paths);
        } else {
          setDragging(false);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths]);

  useEffect(() => {
    if (!running) return;
    const converting = jobs.filter((j) => j.status.kind === "converting");
    const queued = jobs.filter((j) => j.status.kind === "queued");
    if (converting.length === 0 && queued.length === 0) {
      setRunning(false);
      return;
    }
    for (const job of queued.slice(0, MAX_PARALLEL - converting.length)) {
      if (launched.current.has(job.id)) continue;
      launched.current.add(job.id);
      dispatch({ type: "start", id: job.id });
      const { format, bitrate, outputDir } = settingsRef.current;
      convertFile(
        { id: job.id, input: job.input, outputDir, format, bitrate },
        ({ percent, speed }) =>
          dispatch({ type: "progress", id: job.id, percent, speed }),
      ).then(
        (outcome) =>
          dispatch({
            type: "finish",
            id: job.id,
            output: outcome.output,
            copied: outcome.copied,
          }),
        (error) => {
          const failure = toFailure(error);
          dispatch(
            failure.canceled
              ? { type: "canceled", id: job.id }
              : { type: "fail", id: job.id, message: failure.message },
          );
        },
      );
    }
  }, [jobs, running]);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "영상 파일", extensions: VIDEO_EXTENSIONS }],
    });
    if (picked) addPaths(picked);
  }

  async function pickOutputDir() {
    const dir = await open({ directory: true });
    if (typeof dir === "string") setSettings((s) => ({ ...s, outputDir: dir }));
  }

  function cancel(job: Job) {
    if (job.status.kind === "queued") {
      dispatch({ type: "cancel", id: job.id });
    } else {
      void cancelJob(job.id);
    }
  }

  function reveal(path: string) {
    revealItemInDir(path).catch((error) =>
      setNotice(`폴더를 열 수 없습니다: ${String(error)}`),
    );
  }

  const queuedCount = jobs.filter((j) => j.status.kind === "queued").length;
  const hasFinished = jobs.some((j) => isFinished(j.status));

  return (
    <div className={dragging ? "app dragging" : "app"}>
      <header className="masthead">
        <h1>VideoToMP3</h1>
      </header>
      <main className="content">

        <section className="drop" aria-label="영상 추가">
          <span className="drop-glyph" aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <div className="drop-text">
            <p className="drop-title">영상 파일을 여기로 끌어다 놓으세요</p>
            <p className="drop-formats">mp4, mkv, avi, mov, webm 등</p>
          </div>
          <button type="button" onClick={pickFiles}>
            파일 선택…
          </button>
        </section>

        <section className="settings">
          <div className="setting">
            <span className="setting-label">출력</span>
            <div className="setting-control">
              <div className="setting-inline">
                <select
                  aria-label="출력 형식"
                  value={settings.format}
                  disabled={running}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      format: e.target.value as OutputFormat,
                    }))
                  }
                >
                  {OUTPUT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  className="narrow"
                  aria-label="음질"
                  value={settings.bitrate}
                  disabled={running || !usesBitrate(settings.format)}
                  aria-describedby="bitrate-hint"
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      bitrate: Number(e.target.value) as Bitrate,
                    }))
                  }
                >
                  {BITRATES.map((b) => (
                    <option key={b} value={b}>
                      {b} kbps
                    </option>
                  ))}
                </select>
              </div>
              <p id="bitrate-hint" className="hint">
                {bitrateHint(settings.format)}
              </p>
            </div>
          </div>
          <div className="setting">
            <span className="setting-label">저장 위치</span>
            <div className="setting-control output-dir">
              <span className="path" title={settings.outputDir ?? undefined}>
                {settings.outputDir ?? "원본 영상과 같은 폴더"}
              </span>
              <button type="button" disabled={running} onClick={pickOutputDir}>
                폴더 선택…
              </button>
              {settings.outputDir && (
                <button
                  type="button"
                  className="quiet"
                  disabled={running}
                  onClick={() => setSettings((s) => ({ ...s, outputDir: null }))}
                >
                  원본 폴더로
                </button>
              )}
            </div>
          </div>
        </section>

        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}

        {jobs.length === 0 ? (
          <p className="empty">추가한 영상이 여기에 표시됩니다.</p>
        ) : (
          <ul className="jobs">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onCancel={() => cancel(job)}
                onReveal={reveal}
                onRemove={() => dispatch({ type: "remove", id: job.id })}
              />
            ))}
          </ul>
        )}
      </main>

      <footer className="actionbar">
        <span className="copyright">Copyright © 2026 관태</span>
        <button
          type="button"
          className="quiet"
          disabled={!hasFinished}
          onClick={() => dispatch({ type: "clearFinished" })}
        >
          완료 항목 지우기
        </button>
        <button
          type="button"
          className="primary"
          disabled={running || queuedCount === 0}
          onClick={() => setRunning(true)}
        >
          {running ? "변환 중…" : `변환 시작 (${queuedCount}개)`}
        </button>
      </footer>
    </div>
  );
}
