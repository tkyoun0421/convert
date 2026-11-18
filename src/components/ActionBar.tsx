interface ActionBarProps {
  running: boolean;
  queuedCount: number;
  hasFinished: boolean;
  onClearFinished: () => void;
  onStart: () => void;
}

export function ActionBar({
  running,
  queuedCount,
  hasFinished,
  onClearFinished,
  onStart,
}: ActionBarProps) {
  return (
    <footer className="actionbar">
      <span className="copyright">Copyright © 2026 관태</span>
      <button
        type="button"
        className="quiet"
        disabled={!hasFinished}
        onClick={onClearFinished}
      >
        완료 항목 지우기
      </button>
      <button
        type="button"
        className="primary"
        disabled={running || queuedCount === 0}
        onClick={onStart}
      >
        {running ? "변환 중…" : `변환 시작 (${queuedCount}개)`}
      </button>
    </footer>
  );
}
