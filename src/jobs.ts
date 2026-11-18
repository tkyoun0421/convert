export const VIDEO_EXTENSIONS = [
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "webm",
  "flv",
  "m4v",
  "mpg",
  "mpeg",
  "ts",
  "3gp",
];

export type JobStatus =
  | { kind: "queued" }
  | { kind: "converting"; percent: number | null; speed: number | null }
  | { kind: "done"; output: string; copied: boolean }
  | { kind: "failed"; message: string }
  | { kind: "canceled" };

export interface Job {
  id: number;
  input: string;
  name: string;
  status: JobStatus;
}

export interface JobsState {
  jobs: Job[];
  nextId: number;
}

export type JobsAction =
  | { type: "add"; paths: string[] }
  | { type: "start"; id: number }
  | { type: "progress"; id: number; percent: number | null; speed: number | null }
  | { type: "finish"; id: number; output: string; copied: boolean }
  | { type: "fail"; id: number; message: string }
  | { type: "canceled"; id: number }
  | { type: "cancel"; id: number }
  | { type: "remove"; id: number }
  | { type: "clearFinished" };

export const initialJobs: JobsState = { jobs: [], nextId: 1 };

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isVideoPath(path: string): boolean {
  const dot = fileName(path).lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(fileName(path).slice(dot + 1).toLowerCase());
}

export function isFinished(status: JobStatus): boolean {
  return (
    status.kind === "done" ||
    status.kind === "failed" ||
    status.kind === "canceled"
  );
}

function setStatus(
  state: JobsState,
  id: number,
  from: JobStatus["kind"],
  status: JobStatus,
): JobsState {
  return {
    ...state,
    jobs: state.jobs.map((job) =>
      job.id === id && job.status.kind === from ? { ...job, status } : job,
    ),
  };
}

export function jobsReducer(state: JobsState, action: JobsAction): JobsState {
  switch (action.type) {
    case "add": {
      const known = new Set(state.jobs.map((job) => job.input));
      const added: Job[] = [];
      for (const path of action.paths) {
        if (known.has(path)) continue;
        known.add(path);
        added.push({
          id: state.nextId + added.length,
          input: path,
          name: fileName(path),
          status: { kind: "queued" },
        });
      }
      return {
        jobs: [...state.jobs, ...added],
        nextId: state.nextId + added.length,
      };
    }
    case "start":
      return setStatus(state, action.id, "queued", {
        kind: "converting",
        percent: null,
        speed: null,
      });
    case "progress":
      return setStatus(state, action.id, "converting", {
        kind: "converting",
        percent: action.percent,
        speed: action.speed,
      });
    case "finish":
      return setStatus(state, action.id, "converting", {
        kind: "done",
        output: action.output,
        copied: action.copied,
      });
    case "fail":
      return setStatus(state, action.id, "converting", {
        kind: "failed",
        message: action.message,
      });
    case "canceled":
      return setStatus(state, action.id, "converting", { kind: "canceled" });
    case "cancel":
      return setStatus(state, action.id, "queued", { kind: "canceled" });
    case "remove":
      return {
        ...state,
        jobs: state.jobs.filter(
          (job) => job.id !== action.id || !isFinished(job.status),
        ),
      };
    case "clearFinished":
      return {
        ...state,
        jobs: state.jobs.filter((job) => !isFinished(job.status)),
      };
  }
}
