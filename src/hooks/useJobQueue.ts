import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  hasFinished,
  initialJobs,
  isIdle,
  jobsReducer,
  jobsToLaunch,
  queuedCount,
  type Job,
} from "../domain/jobs";
import type { Settings } from "../domain/settings";
import type { Converter } from "../services/ports";

/** LAME encodes on one thread, so a little parallelism pays off. */
const MAX_PARALLEL = 2;

/**
 * The conversion queue. After `start`, it keeps launching queued jobs into free
 * slots, with the settings current at launch, until nothing is left to do.
 */
export function useJobQueue(converter: Converter, settings: Settings) {
  const [{ jobs }, dispatch] = useReducer(jobsReducer, initialJobs);
  const [running, setRunning] = useState(false);
  const settingsRef = useRef(settings);
  const launched = useRef(new Set<number>());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!running) return;
    if (isIdle(jobs)) {
      setRunning(false);
      return;
    }
    for (const job of jobsToLaunch(jobs, MAX_PARALLEL)) {
      if (launched.current.has(job.id)) continue;
      launched.current.add(job.id);
      dispatch({ type: "start", id: job.id });
      const { format, bitrate, outputDir } = settingsRef.current;
      converter
        .convert(
          { id: job.id, input: job.input, outputDir, format, bitrate },
          ({ percent, speed }) => dispatch({ type: "progress", id: job.id, percent, speed }),
        )
        .then((result) => dispatch({ type: "settle", id: job.id, result }));
    }
  }, [converter, jobs, running]);

  const add = useCallback((paths: string[]) => dispatch({ type: "add", paths }), []);

  /**
   * A queued job has no FFmpeg process yet, so it is canceled right here. A converting
   * job turns canceled only when its conversion reports back.
   */
  const cancel = useCallback(
    (job: Job) => {
      if (job.status.kind === "queued") {
        dispatch({ type: "cancel", id: job.id });
      } else {
        void converter.cancel(job.id);
      }
    },
    [converter],
  );

  return {
    jobs,
    running,
    queuedCount: queuedCount(jobs),
    hasFinished: hasFinished(jobs),
    start: () => setRunning(true),
    add,
    cancel,
    remove: (id: number) => dispatch({ type: "remove", id }),
    clearFinished: () => dispatch({ type: "clearFinished" }),
  };
}
