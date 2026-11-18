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
    return <p className="empty">추가한 영상이 여기에 표시됩니다.</p>;
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
