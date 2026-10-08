import type { HoldNote, NoteRuntime } from "../types/chart";

export const HOLD_TICK_INTERVAL_SEC = 0.25;
export const HOLD_TICK_SCORE = 15;
export const HOLD_TICK_MAX_SCORE = 50;

export function holdTickCount(note: HoldNote): number {
  if (!Number.isFinite(note.duration) || note.duration < 0.3) return 0;
  return Math.max(0, Math.ceil(note.duration / HOLD_TICK_INTERVAL_SEC - 1e-8) - 1);
}

/** Chart-time ticks, independent of frame rate. Released intervals never earn catch-up points. */
export function advanceHoldTicks(runtime: NoteRuntime, time: number): { note: NoteRuntime; score: number; earned: number } {
  if (runtime.note.type !== "hold" || runtime.status !== "holding" || !Number.isFinite(time)) {
    return { note: runtime, score: 0, earned: 0 };
  }
  const count = holdTickCount(runtime.note);
  const processed = runtime.holdTicksProcessed ?? 0;
  const due = Math.min(count, Math.max(0, Math.floor((time - runtime.note.time + 1e-8) / HOLD_TICK_INTERVAL_SEC)));
  if (due <= processed) return { note: runtime, score: 0, earned: 0 };
  let earned = 0;
  for (let i = processed + 1; i <= due; i++) {
    const at = runtime.note.time + i * HOLD_TICK_INTERVAL_SEC;
    if (at + 1e-8 >= (runtime.holdStartedAt ?? Infinity) &&
      (runtime.holdReleasedAt === undefined || at <= runtime.holdReleasedAt + 1e-8)) earned++;
  }
  return {
    note: { ...runtime, holdTicksProcessed: due }, earned,
    score: earned * Math.min(HOLD_TICK_SCORE, HOLD_TICK_MAX_SCORE / Math.max(1, count)),
  };
}
