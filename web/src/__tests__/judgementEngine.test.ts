import { describe, expect, it } from "vitest";
import {
  classifyByTimingDiff,
  findNearestJudgeableNote,
  judgeHoldRelease,
} from "../engine/judgementEngine";
import type { NoteRuntime, TapNote, HoldNote } from "../types/chart";

function makeTap(index: number, time: number, lane: 0 | 1 | 2 | 3 = 0): NoteRuntime {
  const note: TapNote = { time, lane, type: "tap" };
  return { note, index, status: "pending", judgement: null };
}

function makeHold(index: number, time: number, duration: number, lane: 0 | 1 | 2 | 3 = 0): NoteRuntime {
  const note: HoldNote = { time, lane, type: "hold", duration };
  return { note, index, status: "pending", judgement: null };
}

describe("classifyByTimingDiff", () => {
  it("1. Perfect 경계값 (±35ms)", () => {
    expect(classifyByTimingDiff(0)).toBe("Perfect");
    expect(classifyByTimingDiff(35)).toBe("Perfect");
    expect(classifyByTimingDiff(-35)).toBe("Perfect");
  });

  it("2. Great 경계값 (35ms 초과 ~ 75ms)", () => {
    expect(classifyByTimingDiff(36)).toBe("Great");
    expect(classifyByTimingDiff(75)).toBe("Great");
    expect(classifyByTimingDiff(-75)).toBe("Great");
  });

  it("3. Good 경계값 (75ms 초과 ~ 120ms)", () => {
    expect(classifyByTimingDiff(76)).toBe("Good");
    expect(classifyByTimingDiff(120)).toBe("Good");
    expect(classifyByTimingDiff(-120)).toBe("Good");
  });

  it("4. 120ms 초과는 후보에서 제외됨 (null)", () => {
    expect(classifyByTimingDiff(121)).toBeNull();
    expect(classifyByTimingDiff(-150)).toBeNull();
  });
});

describe("findNearestJudgeableNote", () => {
  it("5. 가장 가까운 노트만 판정 대상으로 선택된다", () => {
    const notes = [makeTap(0, 1.0), makeTap(1, 1.05), makeTap(2, 3.0)];
    // 현재 시각 1.02 -> 1.0(20ms차)과 1.05(30ms차) 중 1.0이 더 가까움
    const target = findNearestJudgeableNote(notes, 0, 1.02);
    expect(target?.index).toBe(0);
  });

  it("6. 이미 처리된(pending이 아닌) 노트는 다시 판정 대상이 되지 않는다", () => {
    const hitNote = { ...makeTap(0, 1.0), status: "hit" as const };
    const pendingNote = makeTap(1, 1.05);
    const target = findNearestJudgeableNote([hitNote, pendingNote], 0, 1.0);
    expect(target?.index).toBe(1);
  });

  it("미스 윈도우(120ms)를 벗어난 노트는 후보에서 제외된다", () => {
    const notes = [makeTap(0, 1.0)];
    const target = findNearestJudgeableNote(notes, 0, 1.2); // 200ms 차이
    expect(target).toBeNull();
  });

  it("다른 레인의 노트는 후보에서 제외된다", () => {
    const notes = [makeTap(0, 1.0, 1)];
    const target = findNearestJudgeableNote(notes, 0, 1.0);
    expect(target).toBeNull();
  });
});

describe("Hold 판정", () => {
  it("7. Hold 시작 - 판정 대상 탐색이 정상 동작한다", () => {
    const notes = [makeHold(0, 2.0, 1.0)];
    const target = findNearestJudgeableNote(notes, 0, 2.01);
    expect(target?.index).toBe(0);
  });

  it("8. Hold 조기 이탈 - 종료 시각보다 100ms 넘게 일찍 떼면 early_release", () => {
    const holdRuntime: NoteRuntime = { ...makeHold(0, 2.0, 1.0), status: "holding" };
    // 종료 시각은 3.0초. 2.5초에 뗌 -> 훨씬 이름
    const outcome = judgeHoldRelease(holdRuntime, 2.5);
    expect(outcome).toBe("early_release");
  });

  it("9. Hold 정상 완료 - 종료 시각 근처(허용오차 이내)에 떼면 completed", () => {
    const holdRuntime: NoteRuntime = { ...makeHold(0, 2.0, 1.0), status: "holding" };
    // 종료 시각 3.0초, 2.95초에 뗌 (50ms 이전, 허용오차 100ms 이내)
    const outcome = judgeHoldRelease(holdRuntime, 2.95);
    expect(outcome).toBe("completed");

    // 종료 시각을 넘겨서 뗀 경우도 completed
    const outcome2 = judgeHoldRelease(holdRuntime, 3.05);
    expect(outcome2).toBe("completed");
  });

  it("hold가 아닌 노트에 judgeHoldRelease를 호출하면 에러", () => {
    const tapRuntime = makeTap(0, 1.0);
    expect(() => judgeHoldRelease(tapRuntime, 1.0)).toThrow();
  });
});
