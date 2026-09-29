import type { ChartNote } from "../types/chart";
import { DEFAULT_NOTE_SPEED, getNoteFallTimeSec } from "../settings/noteSpeed";

/**
 * 노트의 현재 화면 y 좌표(px)를 시간 기반으로 계산한다.
 * 프레임 누적(속도 * 경과프레임) 방식은 사용하지 않는다 — 항상 절대 시간 차이로부터 재계산한다.
 *
 * progress: 0 = 노트가 막 나타나는 시점(화면 맨 위), 1 = 판정선에 도달하는 시점.
 * noteSpeed는 시각적 스크롤 속도만 바꾸며 노트/판정 시각에는 관여하지 않는다.
 */
export function computeNoteProgress(
  noteTime: number,
  currentTimeSec: number,
  noteSpeed: number = DEFAULT_NOTE_SPEED
): number {
  const distance = noteTime - currentTimeSec;
  const fallTimeSec = getNoteFallTimeSec(noteSpeed);
  return 1 - distance / fallTimeSec;
}

export function computeNoteY(
  noteTime: number,
  currentTimeSec: number,
  judgeLineY: number,
  noteSpeed: number = DEFAULT_NOTE_SPEED
): number {
  return computeNoteProgress(noteTime, currentTimeSec, noteSpeed) * judgeLineY;
}

/** hold 노트 꼬리의 길이(px) 계산 — duration만큼 더 위쪽까지 그려야 한다. */
export function computeHoldTailLengthPx(
  duration: number,
  judgeLineY: number,
  noteSpeed: number = DEFAULT_NOTE_SPEED
): number {
  return (duration / getNoteFallTimeSec(noteSpeed)) * judgeLineY;
}

export interface VisibleNoteInfo {
  note: ChartNote;
  index: number;
  y: number;
  tailLengthPx?: number;
}

/**
 * 현재 시각 기준으로 화면에 그릴 필요가 있는 노트만 골라 위치 정보를 계산한다.
 * 매 프레임 전체 채보를 순회하지 않기 위해, 호출부에서 이미 활성 윈도우로 잘라 넘긴
 * 노트 목록(activeNotes)을 받는다.
 */
export function computeVisibleNotes(
  activeNotes: { note: ChartNote; index: number; visible: boolean }[],
  currentTimeSec: number,
  judgeLineY: number,
  noteSpeed: number = DEFAULT_NOTE_SPEED
): VisibleNoteInfo[] {
  const result: VisibleNoteInfo[] = [];
  for (const { note, index, visible } of activeNotes) {
    if (!visible) continue;
    const y = computeNoteY(note.time, currentTimeSec, judgeLineY, noteSpeed);
    if (note.type === "hold") {
      result.push({ note, index, y, tailLengthPx: computeHoldTailLengthPx(note.duration, judgeLineY, noteSpeed) });
    } else {
      result.push({ note, index, y });
    }
  }
  return result;
}
