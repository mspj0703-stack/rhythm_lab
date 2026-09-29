import type { JudgementLabel } from "../types/chart";
import { SCORE_RATIO } from "../constants/config";

/**
 * 점수 계산식을 이 함수 하나로 캡슐화한다.
 * 이후 더 복잡한 계산식(예: 노트 개수 기반 만점 정규화)으로 교체할 때
 * 이 함수의 내부만 바꾸면 되도록 한다.
 *
 * @param judgement 이번 노트의 판정 등급
 * @param comboBeforeThisNote 이 노트를 판정하기 "직전"의 콤보 수
 */
export function calculateNoteScore(
  judgement: JudgementLabel,
  comboBeforeThisNote: number
): number {
  const ratio = SCORE_RATIO[judgement];
  const comboBonus = 1 + Math.floor(comboBeforeThisNote / 10) * 0.05;
  return ratio * 100 * comboBonus;
}
