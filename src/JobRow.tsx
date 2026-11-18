import { isFinished, type Job } from "./jobs";
import { Waveform } from "./Waveform";

function statusText(job: Job): string {
  const { status } = job;
  switch (status.kind) {
    case "queued":
      return "대기";
    case "converting":
      return status.percent === null ? "변환 중" : `${Math.floor(status.percent)}%`;
    case "done":
      return status.copied ? "무손실 복사 완료" : "완료";
    case "failed":
      return "실패";
    case "canceled":
      return "취소됨";
  }
}

function formatSpeed(speed: number): string {
  return `${speed < 10 ? speed.toFixed(1) : Math.round(speed)}배속`;
}

interface JobRowProps {
  job: Job;
  onCancel: () => void;
  onReveal: (path: string) => void;
  onRemove: () => void;
}

export function JobRow({ job, onCancel, onReveal, onRemove }: JobRowProps) {
  const { status } = job;
  const converting = status.kind === "converting";
  return (
    <li className={`job job-${status.kind}`}>
      <div className="job-head">
        <span className="job-name" title={job.input}>
          {job.name}
        </span>
        {status.kind === "converting" && status.speed !== null && (
          <span className="job-speed">{formatSpeed(status.speed)}</span>
        )}
        <span className="job-status">{statusText(job)}</span>
        <div className="job-actions">
          {(status.kind === "queued" || converting) && (
            <button type="button" className="quiet" onClick={onCancel}>
              취소
            </button>
          )}
          {status.kind === "done" && (
            <button type="button" className="quiet" onClick={() => onReveal(status.output)}>
              폴더에서 보기
            </button>
          )}
          {isFinished(status) && (
            <button type="button" className="quiet" onClick={onRemove}>
              목록에서 제거
            </button>
          )}
        </div>
      </div>
      <div
        className="job-wave"
        role={converting ? "progressbar" : undefined}
        aria-label={converting ? `${job.name} 변환 진행률` : undefined}
        aria-valuemin={converting ? 0 : undefined}
        aria-valuemax={converting ? 100 : undefined}
        aria-valuenow={converting ? (status.percent ?? undefined) : undefined}
      >
        <Waveform seed={job.input} status={status} />
      </div>
      {status.kind === "failed" && <p className="job-error">{status.message}</p>}
    </li>
  );
}
