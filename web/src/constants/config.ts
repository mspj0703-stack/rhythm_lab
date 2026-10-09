import type { JudgementLabel, Lane } from "../types/chart";

/**
 * 판정 타이밍 윈도우 (ms).
 * 값들은 "이 오차 이하이면 해당 등급" 기준의 상한선이다.
 * 예: |오차| <= PERFECT_MS 이면 Perfect, 그 다음 GREAT_MS까지는 Great ...
 */
export const JUDGEMENT_WINDOW_MS = {
  PERFECT: 35,
  GREAT: 75,
  GOOD: 120,
} as const;

/** 이 값(ms)을 넘어서면 판정 후보에서 아예 제외한다 (= 노트를 인지하지 못함) */
export const JUDGEMENT_MISS_WINDOW_MS = JUDGEMENT_WINDOW_MS.GOOD;

/** 판정별 정확도(Accuracy) 가중치 (0~1) */
export const ACCURACY_WEIGHT: Record<JudgementLabel, number> = {
  Perfect: 1.0,
  Great: 0.8,
  Good: 0.5,
  Miss: 0,
};

/** 판정별 기본 점수 배율 (0~1). scoring 모듈에서 콤보 보너스와 함께 사용 */
export const SCORE_RATIO: Record<JudgementLabel, number> = {
  Perfect: 1.0,
  Great: 0.8,
  Good: 0.5,
  Miss: 0,
};

/** 레인별 키 바인딩. 코드 한 곳만 바꾸면 전체 반영되도록 분리 */
export const LANE_KEYS: Record<Lane, string> = {
  0: "d",
  1: "f",
  2: "j",
  3: "k",
};

/** Flick 판정에 쓰이는 보조 키 (레인 키 + 이 키가 짧은 시간 안에 함께 들어와야 함) */
export const FLICK_MODIFIER_KEY = " "; // Space

/** Flick 조합 입력으로 인정하는 두 키 입력 사이의 최대 시간 간격 (ms) */
export const FLICK_COMBINE_WINDOW_MS = 120;

/** Hold 노트: 너무 일찍 떼면 실패로 처리하는 기준 (종료 시점 이전 몇 ms까지 허용할지) */
export const HOLD_RELEASE_TOLERANCE_MS = 120;

/** Hold를 일찍 놓쳤을 때 다시 누를 수 있는 짧은 복구 유예 시간 */
export const HOLD_REGRAB_GRACE_MS = 100;

/**
 * v5 Phase 2: a Hold interrupted by Pause keeps "holding" while paused. When play resumes (after the
 * 3-2-1 countdown) a lane that is not physically pressed gets this one-time re-grab window instead of
 * the normal 100 ms - fingers were lifted to use the Pause menu, so 100 ms would be an unfair Miss.
 */
export const RESUME_HOLD_GRACE_MS = 400;

/** 3-2-1 countdown step for start, resume and restart. */
export const COUNTDOWN_STEP_MS = 1000;

/** 게이지 설정 */
export const GAUGE_CONFIG = {
  INITIAL: 100,
  MAX: 100,
  ON_PERFECT: 1.0,
  ON_GREAT: 0.5,
  ON_GOOD: 0,
  ON_MISS: -6,
  FAIL_THRESHOLD: 0,
} as const;

/** 노트 낙하 시간 (초). 노트가 화면 위쪽에 나타나서 판정선까지 도달하는 데 걸리는 시간 */
export const NOTE_FALL_TIME_SEC = 1.6;

/** 렌더러가 매 프레임 순회할 때, 현재 시각 기준 앞뒤로 몇 초 범위의 노트만 볼지 */
export const ACTIVE_WINDOW_SEC = NOTE_FALL_TIME_SEC + 0.5;
