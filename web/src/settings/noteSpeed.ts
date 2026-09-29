export const NOTE_SPEED_MIN = 1.0;
export const NOTE_SPEED_MAX = 20.0;
export const NOTE_SPEED_STEP = 0.1;
export const DEFAULT_NOTE_SPEED = 8.0;
export const NOTE_SPEED_STORAGE_KEY = "rhythm-lab.note-speed.v1";

const SPEED_CURVE: ReadonlyArray<readonly [number, number]> = [
  [1.0, 3.0],
  [6.0, 1.6],
  [8.0, 1.2],
  [10.0, 0.9],
  [12.0, 0.7],
  [15.0, 0.5],
  [20.0, 0.35],
];

export function normalizeNoteSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NOTE_SPEED;
  const clamped = Math.min(NOTE_SPEED_MAX, Math.max(NOTE_SPEED_MIN, value));
  return Math.round(clamped / NOTE_SPEED_STEP) * NOTE_SPEED_STEP;
}

/**
 * 숫자형 노트 속도를 실제 화면 접근 시간으로 바꾼다.
 * v2는 고속 영역을 더 공격적으로 압축해 12~20 구간에서 실제로 빠른 플레이가 가능하다.
 * chart time / media.currentTime / 판정 시각은 전혀 바꾸지 않는다.
 */
export function getNoteFallTimeSec(noteSpeed: number): number {
  const speed = normalizeNoteSpeed(noteSpeed);
  for (let i = 0; i < SPEED_CURVE.length - 1; i++) {
    const [s0, t0] = SPEED_CURVE[i];
    const [s1, t1] = SPEED_CURVE[i + 1];
    if (speed <= s1) {
      const p = (speed - s0) / (s1 - s0);
      return t0 + (t1 - t0) * p;
    }
  }
  return SPEED_CURVE[SPEED_CURVE.length - 1][1];
}

/** v3 perspective highway: show farther chart without making the near-line motion feel proportionally slower. */
export const GAMEPLAY_LOOKAHEAD_MULTIPLIER = 1.6;

export function getGameplayLookaheadSec(noteSpeed: number): number {
  return getNoteFallTimeSec(noteSpeed) * GAMEPLAY_LOOKAHEAD_MULTIPLIER + 0.5;
}

export function getActiveWindowSec(noteSpeed: number): number {
  return getNoteFallTimeSec(noteSpeed) + 0.5;
}

export function loadNoteSpeed(storage?: Pick<Storage, "getItem"> | null): number {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!target) return DEFAULT_NOTE_SPEED;
    const raw = target.getItem(NOTE_SPEED_STORAGE_KEY);
    if (raw === null) return DEFAULT_NOTE_SPEED;
    return normalizeNoteSpeed(Number(raw));
  } catch {
    return DEFAULT_NOTE_SPEED;
  }
}

export function saveNoteSpeed(noteSpeed: number, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!target) return;
    target.setItem(NOTE_SPEED_STORAGE_KEY, normalizeNoteSpeed(noteSpeed).toFixed(1));
  } catch {
    // localStorage가 차단된 환경에서는 세션 값만 사용한다.
  }
}
