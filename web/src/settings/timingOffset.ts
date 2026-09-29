export const TIMING_OFFSET_MIN_MS = -300;
export const TIMING_OFFSET_MAX_MS = 300;
export const TIMING_OFFSET_STEP_MS = 1;
export const DEFAULT_TIMING_OFFSET_MS = 0;
export const TIMING_OFFSET_STORAGE_KEY = "rhythm-lab.timing-offset.v1";

export const CALIBRATION_TOTAL_BEATS = 16;
export const CALIBRATION_DISCARD_SAMPLES = 3;
export const CALIBRATION_INTERVAL_MS = 500;
export const CALIBRATION_TAP_WINDOW_MS = 350;
export const CALIBRATION_UNSTABLE_STDDEV_MS = 45;

export interface TimingCalibrationEstimate {
  offsetMs: number;
  sampleCount: number;
  discardedCount: number;
  medianMs: number;
  stddevMs: number;
  unstable: boolean;
}

export function normalizeTimingOffsetMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMING_OFFSET_MS;
  const rounded = Math.round(value / TIMING_OFFSET_STEP_MS) * TIMING_OFFSET_STEP_MS;
  return Math.min(TIMING_OFFSET_MAX_MS, Math.max(TIMING_OFFSET_MIN_MS, rounded));
}

/**
 * media.currentTime을 실제 채보/판정 시계로 변환한다.
 * +offset은 채보를 그만큼 늦춰, 늦게 들리거나 늦게 입력되는 환경을 보정한다.
 * 예: media=1.080s, offset=+80ms -> chart clock=1.000s.
 */
export function applyTimingOffsetSec(mediaTimeSec: number, offsetMs: number): number {
  if (!Number.isFinite(mediaTimeSec)) return mediaTimeSec;
  return mediaTimeSec - normalizeTimingOffsetMs(offsetMs) / 1000;
}

export function loadTimingOffsetMs(storage?: Pick<Storage, "getItem"> | null): number {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!target) return DEFAULT_TIMING_OFFSET_MS;
    const raw = target.getItem(TIMING_OFFSET_STORAGE_KEY);
    if (raw === null) return DEFAULT_TIMING_OFFSET_MS;
    return normalizeTimingOffsetMs(Number(raw));
  } catch {
    return DEFAULT_TIMING_OFFSET_MS;
  }
}

export function saveTimingOffsetMs(offsetMs: number, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!target) return;
    target.setItem(TIMING_OFFSET_STORAGE_KEY, String(normalizeTimingOffsetMs(offsetMs)));
  } catch {
    // localStorage가 차단된 환경에서는 현재 세션 값만 사용한다.
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 보정 탭의 시간차(ms)에서 권장 Timing Offset을 계산한다.
 * 첫 3회는 적응 구간으로 버리고, 이후 중앙값을 사용해 순간적인 실수를 억제한다.
 */
export function estimateTimingOffsetMs(
  rawSamplesMs: readonly number[],
  discardSamples = CALIBRATION_DISCARD_SAMPLES
): TimingCalibrationEstimate {
  const finite = rawSamplesMs.filter(Number.isFinite);
  const discardedCount = Math.min(Math.max(0, Math.floor(discardSamples)), finite.length);
  const samples = finite.slice(discardedCount);

  if (samples.length === 0) {
    return {
      offsetMs: DEFAULT_TIMING_OFFSET_MS,
      sampleCount: 0,
      discardedCount,
      medianMs: 0,
      stddevMs: 0,
      unstable: true,
    };
  }

  const medianMs = median(samples);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  const stddevMs = Math.sqrt(variance);

  return {
    offsetMs: normalizeTimingOffsetMs(medianMs),
    sampleCount: samples.length,
    discardedCount,
    medianMs,
    stddevMs,
    unstable: samples.length < 8 || stddevMs > CALIBRATION_UNSTABLE_STDDEV_MS,
  };
}

/** Device calibration plus per-song correction, limited to the supported range. */
export function combineTimingOffsets(globalMs: number, songMs: number): number {
  return normalizeTimingOffsetMs(normalizeTimingOffsetMs(globalMs) + normalizeTimingOffsetMs(songMs));
}
