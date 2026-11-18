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

export interface Progress {
  percent: number | null;
  /** Processing speed as a multiple of real time (ffmpeg `speed=`). */
  speed: number | null;
}

export type JobStatus =
  | { kind: "queued" }
  | ({ kind: "converting" } & Progress)
  | { kind: "done"; output: string; copied: boolean }
  | { kind: "failed"; message: string }
  | { kind: "canceled" };

/** How a conversion that reached the converter ends. */
export type ConvertResult = Extract<JobStatus, { kind: "done" | "failed" | "canceled" }>;

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
  | ({ type: "progress"; id: number } & Progress)
  | { type: "settle"; id: number; result: ConvertResult }
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

const countOf = (jobs: Job[], kind: JobStatus["kind"]) =>
  jobs.filter((job) => job.status.kind === kind).length;

export const queuedCount = (jobs: Job[]) => countOf(jobs, "queued");

export const hasFinished = (jobs: Job[]) => jobs.some((job) => isFinished(job.status));

/** Nothing is waiting or converting. */
export const isIdle = (jobs: Job[]) => jobs.every((job) => isFinished(job.status));

/** Queued jobs that fit into the free conversion slots, oldest first. */
export function jobsToLaunch(jobs: Job[], maxParallel: number): Job[] {
  return jobs
    .filter((job) => job.status.kind === "queued")
    .slice(0, maxParallel - countOf(jobs, "converting"));
}

/** Moves one job to `status` only from the `from` state, so late or repeated events do nothing. */
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
    case "settle":
      return setStatus(state, action.id, "converting", action.result);
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
