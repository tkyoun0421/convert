import { isFinished, type Job } from "../domain/jobs";
import { formatSpeed, statusText } from "../domain/labels";
import { Waveform } from "./Waveform";

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
        <span className="job-status">{statusText(status)}</span>
        <div className="job-actions">
          {!isFinished(status) && (
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
