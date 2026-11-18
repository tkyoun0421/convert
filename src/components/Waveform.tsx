import { useMemo, type CSSProperties } from "react";
import type { JobStatus } from "../domain/jobs";
import { BARS, beatSeconds, waveformBars, waveformHeights } from "../domain/waveform";

export function Waveform({ seed, status }: { seed: string; status: JobStatus }) {
  const heights = useMemo(() => waveformHeights(seed), [seed]);
  return (
    <div
      className={`wave wave-${status.kind}`}
      style={{ "--bars": BARS, "--beat": `${beatSeconds(status)}s` } as CSSProperties}
      aria-hidden
    >
      {waveformBars(heights, status).map((bar, i) => (
        <span
          key={i}
          className={`bar${bar.on ? " on" : ""}${bar.live ? " live" : ""}`}
          style={{ "--h": bar.height, "--phase": bar.phase } as CSSProperties}
        />
      ))}
    </div>
  );
}
