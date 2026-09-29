import type { JudgementLabel } from "../types/chart";
import { GAUGE_CONFIG } from "../constants/config";

/**
 * 판정 결과를 받아 새 게이지 값을 계산한다. 0~MAX 범위로 clamp된다.
 */
export function applyJudgementToGauge(currentGauge: number, judgement: JudgementLabel): number {
  const delta =
    judgement === "Perfect"
      ? GAUGE_CONFIG.ON_PERFECT
      : judgement === "Great"
      ? GAUGE_CONFIG.ON_GREAT
      : judgement === "Good"
      ? GAUGE_CONFIG.ON_GOOD
      : GAUGE_CONFIG.ON_MISS;

  const next = currentGauge + delta;
  return Math.max(0, Math.min(GAUGE_CONFIG.MAX, next));
}

export function isFailed(gauge: number, failEnabled: boolean): boolean {
  if (!failEnabled) return false;
  return gauge <= GAUGE_CONFIG.FAIL_THRESHOLD;
}
