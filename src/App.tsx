import { useCallback, useState } from "react";
import "./App.css";
import { ActionBar } from "./components/ActionBar";
import { DropZone } from "./components/DropZone";
import { JobList } from "./components/JobList";
import { SettingsPanel } from "./components/SettingsPanel";
import { isVideoPath } from "./domain/jobs";
import { skippedNotice } from "./domain/labels";
import { useFileDrop } from "./hooks/useFileDrop";
import { useJobQueue } from "./hooks/useJobQueue";
import { useSettings } from "./hooks/useSettings";
import { appServices } from "./services";

const { converter, settings: settingsStore, desktop } = appServices;

export default function App() {
  const { settings, updateSettings } = useSettings(settingsStore);
  const queue = useJobQueue(converter, settings);
  const [notice, setNotice] = useState<string | null>(null);

  const { add } = queue;
  const addPaths = useCallback(
    (paths: string[]) => {
      const videos = paths.filter(isVideoPath);
      setNotice(skippedNotice(paths.length - videos.length));
      if (videos.length > 0) add(videos);
    },
    [add],
  );

  const dragging = useFileDrop(desktop, addPaths);

  async function pickFiles() {
    const picked = await desktop.pickVideos();
    if (picked) addPaths(picked);
  }

  async function pickOutputDir() {
    const dir = await desktop.pickFolder();
    if (dir !== null) updateSettings({ outputDir: dir });
  }

  function reveal(path: string) {
    desktop
      .reveal(path)
      .catch((error) => setNotice(`폴더를 열 수 없습니다: ${String(error)}`));
  }

  return (
    <div className={dragging ? "app dragging" : "app"}>
      <header className="masthead">
        <h1>VideoToMP3</h1>
      </header>
      <main className="content">
        <DropZone onPickFiles={pickFiles} />
        <SettingsPanel
          settings={settings}
          locked={queue.running}
          onChange={updateSettings}
          onPickFolder={pickOutputDir}
        />
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <JobList
          jobs={queue.jobs}
          onCancel={queue.cancel}
          onReveal={reveal}
          onRemove={queue.remove}
        />
      </main>
      <ActionBar
        running={queue.running}
        queuedCount={queue.queuedCount}
        hasFinished={queue.hasFinished}
        onClearFinished={queue.clearFinished}
        onStart={queue.start}
      />
    </div>
  );
}
