/**
 * 채보(Chart) 및 노트(Note) 관련 타입 정의.
 *
 * 채보 JSON은 시간(time) 단위를 "초"로 사용한다.
 * 이후 AI 자동 채보 생성기가 이 구조 그대로 출력할 예정이므로,
 * 필드를 함부로 늘리거나 의미를 바꾸지 않는다.
 */

export type NoteType = "tap" | "hold" | "flick";
export type ChartPlatform = "mobile" | "desktop";
export const DIFFICULTIES = ["easy", "normal", "hard", "expert", "extreme"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type JudgementLabel = "Perfect" | "Great" | "Good" | "Miss";

/** 레인 인덱스: 0=D, 1=F, 2=J, 3=K (키 바인딩은 constants/keybinds.ts에서 관리) */
export type Lane = 0 | 1 | 2 | 3;

interface BaseNote {
  /** 노트가 판정선에 도달해야 하는 시각 (초, video.currentTime 기준) */
  time: number;
  lane: Lane;
  type: NoteType;
}

export interface TapNote extends BaseNote {
  type: "tap";
}

export interface HoldNote extends BaseNote {
  type: "hold";
  /** 유지해야 하는 길이 (초) */
  duration: number;
}

export interface FlickNote extends BaseNote {
  type: "flick";
}

export type ChartNote = TapNote | HoldNote | FlickNote;

export interface Chart {
  version?: number;
  platformProfile?: ChartPlatform;
  /** Missing means legacy scoring; v5 tick scoring is opt-in per chart. */
  scoringVersion?: 1 | 2;
  title: string;
  artist: string;
  bpm: number;
  /** 채보 전체에 적용되는 시간 오프셋 (초). 영상 싱크 보정용 */
  offset: number;
  difficulty: string;
  level: number;
  notes: ChartNote[];
}

/**
 * 런타임에서 노트 하나의 진행 상태를 추적하기 위한 확장 타입.
 * Chart의 원본 데이터는 불변으로 두고, 이 타입으로 판정 상태만 별도 관리한다.
 */
export type NoteRuntimeStatus =
  | "pending" // 아직 판정 전
  | "hit" // tap/flick 성공, 또는 hold 정상 종료
  | "holding" // hold 시작 성공, 유지 중
  | "hold_broken" // hold 유지 중 조기 이탈
  | "missed"; // 판정 기회를 놓침

export interface NoteRuntime {
  note: ChartNote;
  /** 원본 notes 배열에서의 인덱스. 판정/렌더링 시 식별용 */
  index: number;
  status: NoteRuntimeStatus;
  /** 실제 판정된 등급 (판정 완료 후에만 존재) */
  judgement: JudgementLabel | null;
  /** hold 노트가 유지 중일 때, 실제로 키를 누르기 시작한 시각 (초) */
  holdStartedAt?: number;
  /** Hold 중 손이 잠깐 떨어진 시각. grace 안에 다시 누르면 유지가 복구된다. */
  holdReleasedAt?: number;
  holdTicksProcessed?: number;
}
