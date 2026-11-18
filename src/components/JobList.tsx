import type { Job } from "../domain/jobs";
import { JobRow } from "./JobRow";

interface JobListProps {
  jobs: Job[];
  onCancel: (job: Job) => void;
  onReveal: (path: string) => void;
  onRemove: (id: number) => void;
}

export function JobList({ jobs, onCancel, onReveal, onRemove }: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <svg className="empty-art" viewBox="0 0 64 56" aria-hidden>
          <path className="empty-inside" d="M10 22 32 12l22 10-22 10Z" />
          <path className="empty-face" d="M10 22 32 32v22L10 44Z" />
          <path className="empty-face" d="M54 22 32 32v22l22-10Z" />
          <path className="empty-flap" d="M10 22 3 31l22 10 7-9" />
          <path className="empty-flap" d="M54 22l7 9-22 10-7-9" />
        </svg>
        <p>비어 있음</p>
      </div>
    );
  }
  return (
    <ul className="jobs">
      {jobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          onCancel={() => onCancel(job)}
          onReveal={onReveal}
          onRemove={() => onRemove(job.id)}
        />
      ))}
    </ul>
  );
}
