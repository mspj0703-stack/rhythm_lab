/**
 * Musical grid for the Maker. Charts store only a global BPM (the analyzer's beat grid is not saved),
 * so the grid phase is recovered from the chart's own notes around the edit position. This follows
 * slow tempo drift as long as nearby notes exist, and falls back to the global phase otherwise.
 */
export const SNAP_DIVISIONS = [4, 8, 16, 32, 0] as const;
export type SnapDivision = (typeof SNAP_DIVISIONS)[number];

export function snapLabel(division: SnapDivision): string {
  return division === 0 ? "OFF" : `1/${division}`;
}

const PHASE_TOLERANCE_SEC = 0.012;
const LOCAL_WINDOW_SEC = 4;
const MIN_LOCAL_NOTES = 4;

export function beatSec(bpm: number): number {
  return 60 / (Number.isFinite(bpm) && bpm > 20 && bpm < 1000 ? bpm : 120);
}

/** Seconds between grid lines for a 1/division note (1/4 = one beat). */
export function gridStepSec(bpm: number, division: SnapDivision): number {
  if (division === 0) return 0;
  return beatSec(bpm) * 4 / division;
}

function mod(value: number, step: number): number {
  return ((value % step) + step) % step;
}

function circularDistance(a: number, b: number, step: number): number {
  const d = Math.abs(mod(a, step) - mod(b, step));
  return Math.min(d, step - d);
}

/** Beat-aligned phase (0..beat) that puts the most of `times` on the 1/16 grid and on beats. */
export function estimateBeatPhase(times: readonly number[], bpm: number, fallback = 0): number {
  const beat = beatSec(bpm);
  const sixteenth = beat / 4;
  if (times.length === 0) return mod(fallback, beat);
  let bestResidue = mod(times[0], sixteenth);
  let bestCount = -1;
  // Sampling the candidates keeps this O(64·n) for dense EXTREME charts.
  const stride = Math.max(1, Math.floor(times.length / 64));
  for (let i = 0; i < times.length; i += stride) {
    const candidate = times[i];
    const residue = mod(candidate, sixteenth);
    let count = 0;
    for (const t of times) if (circularDistance(t, residue, sixteenth) <= PHASE_TOLERANCE_SEC) count++;
    if (count > bestCount) { bestCount = count; bestResidue = residue; }
  }
  // Refine with the circular mean of the inliers.
  let sum = 0; let n = 0;
  for (const t of times) {
    const r = mod(t, sixteenth);
    let delta = r - bestResidue;
    if (delta > sixteenth / 2) delta -= sixteenth;
    if (delta < -sixteenth / 2) delta += sixteenth;
    if (Math.abs(delta) <= PHASE_TOLERANCE_SEC) { sum += delta; n++; }
  }
  const phase16 = mod(bestResidue + (n ? sum / n : 0), sixteenth);
  // Which of the four 1/16 offsets is the beat: the one most notes land on.
  let beatPhase = phase16;
  let beatScore = -1;
  for (let k = 0; k < 4; k++) {
    const candidate = phase16 + k * sixteenth;
    let score = 0;
    for (const t of times) if (circularDistance(t, candidate, beat) <= PHASE_TOLERANCE_SEC) score++;
    if (score > beatScore) { beatScore = score; beatPhase = candidate; }
  }
  return mod(beatPhase, beat);
}

export interface GridContext {
  bpm: number;
  /** Note times of the chart being edited (any order). */
  noteTimes: readonly number[];
  /** Chart offset, used only when no notes exist. */
  offset?: number;
}

const globalPhaseCache = new WeakMap<readonly number[], Map<string, number>>();

function globalBeatPhase(ctx: GridContext): number {
  let byTempo = globalPhaseCache.get(ctx.noteTimes);
  if (!byTempo) { byTempo = new Map(); globalPhaseCache.set(ctx.noteTimes, byTempo); }
  const key = `${ctx.bpm}:${ctx.offset ?? 0}`;
  let phase = byTempo.get(key);
  if (phase === undefined) { phase = estimateBeatPhase(ctx.noteTimes, ctx.bpm, ctx.offset ?? 0); byTempo.set(key, phase); }
  return phase;
}

export function localBeatPhase(ctx: GridContext, around: number): number {
  const local = ctx.noteTimes.filter((t) => Math.abs(t - around) <= LOCAL_WINDOW_SEC);
  return local.length >= MIN_LOCAL_NOTES ? estimateBeatPhase(local, ctx.bpm, ctx.offset ?? 0) : globalBeatPhase(ctx);
}

/** Nearest grid time to `t` (never negative). Division 0 = OFF keeps millisecond precision. */
export function snapTime(t: number, division: SnapDivision, ctx: GridContext): number {
  const clamped = Math.max(0, t);
  if (division === 0) return Math.round(clamped * 1000) / 1000;
  const step = gridStepSec(ctx.bpm, division);
  const phase = localBeatPhase(ctx, clamped);
  let snapped = phase + Math.round((clamped - phase) / step) * step;
  if (snapped < 0) snapped += step * Math.ceil(-snapped / step);
  return Math.round(snapped * 1000) / 1000;
}

export interface GridLine { time: number; strength: "bar" | "beat" | "sub"; }

/** Grid lines inside [start, end] for drawing; capped so extreme zoom-out stays cheap. */
export function gridLines(start: number, end: number, division: SnapDivision, ctx: GridContext, maxLines = 600): GridLine[] {
  const beat = beatSec(ctx.bpm);
  const drawDivision = division === 0 ? 4 : division;
  const step = gridStepSec(ctx.bpm, drawDivision);
  const phase = localBeatPhase(ctx, (start + end) / 2);
  const first = phase + Math.ceil((Math.max(0, start) - phase) / step) * step;
  const out: GridLine[] = [];
  for (let t = first; t <= end && out.length < maxLines; t += step) {
    const beats = (t - phase) / beat;
    const onBeat = Math.abs(beats - Math.round(beats)) < 1e-3;
    const onBar = onBeat && mod(Math.round(beats), 4) === 0;
    out.push({ time: Math.round(t * 1000) / 1000, strength: onBar ? "bar" : onBeat ? "beat" : "sub" });
  }
  return out;
}
