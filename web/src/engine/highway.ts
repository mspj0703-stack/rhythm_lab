import { getNoteFallTimeSec, GAMEPLAY_LOOKAHEAD_MULTIPLIER } from "../settings/noteSpeed";

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 560;
export const JUDGE_LINE_Y = CANVAS_HEIGHT - 62;
/** Share of the playfield height below the judge line (touch lanes / hit effects use the same ratio in CSS). */
export const JUDGE_ZONE_RATIO = 62 / CANVAS_HEIGHT;

/** Judge line for a playfield of any size, keeping the v3 canvas proportions so CSS overlays stay aligned. */
export function judgeLineYFor(height: number): number {
  return height - height * JUDGE_ZONE_RATIO;
}
export const TOP_WIDTH_RATIO = 0.40;
export const BOTTOM_WIDTH_RATIO = 0.96;
export const PERSPECTIVE_POWER = 1.62;

export function projection(noteTime: number, current: number, judgeY: number, noteSpeed: number) {
  const horizon = getNoteFallTimeSec(noteSpeed) * GAMEPLAY_LOOKAHEAD_MULTIPLIER;
  const p = 1 - (noteTime - current) / horizon;
  const depth = Math.pow(Math.max(0, p), PERSPECTIVE_POWER);
  const y = depth * judgeY;
  // Match the straight lane boundaries at this projected height.
  const scale = TOP_WIDTH_RATIO + (BOTTOM_WIDTH_RATIO - TOP_WIDTH_RATIO) * Math.min(1, depth);
  return { p, y, scale };
}

export function laneGeometry(lane: number, laneCount: number, width: number, scale: number) {
  const roadW = width * scale;
  const laneW = roadW / laneCount;
  return { x: (width - roadW) / 2 + lane * laneW, laneW };
}
