import { useMemo, type CSSProperties } from "react";
import type { JobStatus } from "./jobs";

const BARS = 80;
/** Bars around the progress edge that move with the beat: this many behind it, and ahead. */
const LIVE_BEHIND = 6;
const LIVE_AHEAD = 2;

/**
 * Beat length per speed band (seconds). Bands instead of a continuous curve,
 * because changing a running CSS animation's duration makes the bars jump.
 */
const TEMPO: { upTo: number; beat: number }[] = [
  { upTo: 2, beat: 1.0 },
  { upTo: 8, beat: 0.72 },
  { upTo: 30, beat: 0.52 },
  { upTo: 100, beat: 0.38 },
  { upTo: Infinity, beat: 0.27 },
];

function beatSeconds(speed: number | null): number {
  if (speed === null) return TEMPO[1].beat;
  return TEMPO.find((t) => speed <= t.upTo)!.beat;
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bar heights (0..1) seeded by the file path, so each file keeps its own shape. */
export function waveformHeights(seed: string): number[] {
  const next = random(hash(seed));
  let level = 0.55;
  return Array.from({ length: BARS }, (_, i) => {
    level = Math.min(0.95, Math.max(0.2, level + (next() - 0.5) * 0.35));
    const envelope = 0.75 + 0.25 * Math.sin((Math.PI * (i + 0.5)) / BARS);
    return Math.min(1, Math.max(0.1, (level * 0.65 + next() * 0.45) * envelope));
  });
}

function filledBars(status: JobStatus): number {
  if (status.kind === "done") return BARS;
  if (status.kind === "converting" && status.percent !== null) {
    return Math.round((status.percent / 100) * BARS);
  }
  return 0;
}

/** Which bars move: around the progress edge, or all of them when the length is unknown. */
function isLive(status: JobStatus, filled: number, i: number): boolean {
  if (status.kind !== "converting") return false;
  if (status.percent === null) return true;
  return i >= filled - LIVE_BEHIND && i < filled + LIVE_AHEAD;
}

export function Waveform({ seed, status }: { seed: string; status: JobStatus }) {
  const heights = useMemo(() => waveformHeights(seed), [seed]);
  const filled = filledBars(status);
  const beat = beatSeconds(status.kind === "converting" ? status.speed : null);
  return (
    <div
      className={`wave wave-${status.kind}`}
      style={{ "--bars": BARS, "--beat": `${beat}s` } as CSSProperties}
      aria-hidden
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className={`bar${i < filled ? " on" : ""}${isLive(status, filled, i) ? " live" : ""}`}
          style={{ "--h": h, "--phase": (i * 0.618) % 1 } as CSSProperties}
        />
      ))}
    </div>
  );
}
