import { describe, expect, it } from "vitest";
import {
  attemptFlick,
  attemptHoldRelease,
  attemptHoldStart,
  attemptTap,
  calculateAccuracyPercent,
  createInitialGameState,
  restartGame,
  tick,
} from "../engine/gameState";
import { parseChart } from "../engine/chartLoader";
import type { Chart } from "../types/chart";

function makeChart(overrides: Partial<Chart> = {}): Chart {
  const base: Chart = {
    title: "t",
    artist: "a",
    bpm: 120,
    offset: 0,
    difficulty: "Normal",
    level: 1,
    notes: [
      { time: 1.0, lane: 0, type: "tap" },
      { time: 2.0, lane: 1, type: "tap" },
      { time: 3.0, lane: 2, type: "hold", duration: 1.0 },
      { time: 5.0, lane: 3, type: "flick" },
    ],
  };
  return { ...base, ...overrides };
}

describe("Tap 판정 및 콤보/정확도", () => {
  it("10. 연속 Perfect는 콤보가 계속 증가하고, Miss에서 콤보가 초기화된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0); // Perfect
    expect(state.combo).toBe(1);

    state = attemptTap(state, 1, 2.0); // Perfect
    expect(state.combo).toBe(2);
    expect(state.maxCombo).toBe(2);

    // 3번째 노트(hold)는 tap으로 시도해도 무시되고, 명시적으로 miss를 만들기 위해
    // 판정 기회를 그냥 흘려보낸다 (tick으로 만료 처리)
    state = tick(state, 3.5); // hold 시작 못하고 지나감 -> pending 상태의 hold는 findExpiredPendingNotes에서 Miss 처리
    const holdNoteRuntime = state.notes[2];
    expect(holdNoteRuntime.status).toBe("missed");
    expect(state.combo).toBe(0); // Miss로 콤보 초기화
  });

  it("Perfect Streak는 Perfect에서만 이어지고 Great/Good에서 종료된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0);
    state = attemptTap(state, 1, 2.0);
    expect(state.perfectStreak).toBe(2);
    expect(state.maxPerfectStreak).toBe(2);
    const chart2 = makeChart({ notes: [{ time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "tap" }] });
    state = createInitialGameState(chart2, { failEnabled: false });
    state = attemptTap(state, 0, 1.0);
    state = attemptTap(state, 1, 2.05);
    expect(state.combo).toBe(2);
    expect(state.perfectStreak).toBe(0);
    expect(state.maxPerfectStreak).toBe(1);
  });

  it("12. Accuracy 계산이 판정 가중치를 정확히 반영한다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0); // diff 0ms -> Perfect (weight 1.0)
    state = attemptTap(state, 1, 2.05); // diff 50ms -> Great (weight 0.8)

    // 두 개 판정: (1.0 + 0.8) / 2 * 100 = 90
    expect(calculateAccuracyPercent(state)).toBeCloseTo(90, 5);
  });

  it("허공 입력(대상 노트 없음)은 상태를 바꾸지 않는다", () => {
    const state0 = createInitialGameState(makeChart(), { failEnabled: false });
    const state1 = attemptTap(state0, 0, 99.0); // 근처에 노트 없음
    expect(state1).toBe(state0);
  });
});

describe("Hold 판정 (시작/유지/조기이탈/완료)", () => {
  it("7. Hold 시작 성공 시 상태가 holding으로 바뀐다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptHoldStart(state, 2, 3.0);
    expect(state.notes[2].status).toBe("holding");
    // 시작만으로는 아직 점수/콤보에 반영되지 않는다 (종료 시점에 반영)
    expect(state.combo).toBe(0);
  });

  it("8. Hold 조기 이탈은 즉시 Miss가 아니라 100ms re-grab grace를 준다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0);
    state = attemptTap(state, 1, 2.0); // 2.0초 tap도 처리해 두어야 tick(3.31)에서 Miss가 Hold 1건만 집계된다
    state = attemptHoldStart(state, 2, 3.0);
    state = attemptHoldRelease(state, 2, 3.2);
    expect(state.notes[2].status).toBe("holding");
    expect(state.notes[2].holdReleasedAt).toBe(3.2);
    expect(state.judgementCounts.Miss).toBe(0);
    state = tick(state, 3.31);
    expect(state.notes[2].status).toBe("hold_broken");
    expect(state.combo).toBe(0);
    expect(state.judgementCounts.Miss).toBe(1);
  });

  it("grace 안에 다시 누르면 Hold가 복구된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptHoldStart(state, 2, 3.0);
    state = attemptHoldRelease(state, 2, 3.4);
    state = attemptHoldStart(state, 2, 3.47);
    expect(state.notes[2].status).toBe("holding");
    expect(state.notes[2].holdReleasedAt).toBeUndefined();
    state = tick(state, 4.01);
    expect(state.notes[2].status).toBe("hit");
    expect(state.judgementCounts.Perfect).toBe(1);
  });

  it("Hold tail 120ms 이내 조기 release는 정상 완료로 인정한다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptHoldStart(state, 2, 3.0);
    state = attemptHoldRelease(state, 2, 3.89);
    expect(state.notes[2].status).toBe("hit");
    expect(state.judgementCounts.Perfect).toBe(1);
  });

  it("9. Hold 정상 완료 시 시작 판정 등급대로 콤보/점수가 반영된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptHoldStart(state, 2, 3.0); // Perfect 시작
    state = attemptHoldRelease(state, 2, 4.0); // 정확히 종료 시각에 뗌
    expect(state.notes[2].status).toBe("hit");
    expect(state.combo).toBe(1);
    expect(state.judgementCounts.Perfect).toBe(1);
  });

  it("키를 계속 누르고 있으면 tick()이 종료 시각에 자동으로 완료 처리한다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptHoldStart(state, 2, 3.0);
    state = tick(state, 4.01); // 종료 시각(4.0)을 넘김
    expect(state.notes[2].status).toBe("hit");
    expect(state.combo).toBe(1);
  });
});

describe("Flick 판정", () => {
  it("10. Flick 노트가 정상적으로 판정된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptFlick(state, 3, 5.0);
    expect(state.notes[3].status).toBe("hit");
    expect(state.judgementCounts.Perfect).toBe(1);
  });

  it("tap 시도로는 flick 노트가 판정되지 않는다 (타입이 다름)", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    const before = state;
    state = attemptTap(state, 3, 5.0);
    expect(state).toBe(before); // 변화 없음
  });
});

describe("곡(영상) 종료 처리 (v0.2 회귀 수정)", () => {
  it("영상이 끝나 시간이 무한대로 정산되면 남은 pending 노트는 Miss, 게임은 finished", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0);
    state = tick(state, Number.POSITIVE_INFINITY);
    expect(state.finished).toBe(true);
    expect(state.judgementCounts.Perfect).toBe(1);
    expect(state.judgementCounts.Miss).toBe(3);
  });

  it("마지막 노트 직후 영상이 끝나도(0.5초 여유 없음) finished가 된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0);
    state = attemptTap(state, 1, 2.0);
    state = attemptHoldStart(state, 2, 3.0);
    state = attemptHoldRelease(state, 2, 4.0);
    state = attemptFlick(state, 3, 5.0);
    state = tick(state, 5.05); // 0.5초 여유 전
    expect(state.finished).toBe(false);
    state = tick(state, Number.POSITIVE_INFINITY); // 영상 종료
    expect(state.finished).toBe(true);
    expect(state.judgementCounts.Miss).toBe(0);
  });
});

describe("Gameplay Feel v2 feedback", () => {
  it("Great/Good 입력의 signed diff와 lane/type을 feedback에 보존한다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.05);
    expect(state.lastFeedback?.judgement).toBe("Great");
    expect(state.lastFeedback?.diffMs).toBeCloseTo(50, 5);
    expect(state.lastFeedback?.lane).toBe(0);
    expect(state.lastFeedback?.noteType).toBe("tap");
  });

  it("Hold 시작도 점수 반영 전 즉시 feedback을 만든다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptHoldStart(state, 2, 3.04);
    expect(state.totalJudged).toBe(0);
    expect(state.lastFeedback?.phase).toBe("hold_start");
    expect(state.lastFeedback?.judgement).toBe("Great");
  });
});

describe("Restart", () => {
  it("13. Restart 후 모든 상태가 초기화된다", () => {
    let state = createInitialGameState(makeChart(), { failEnabled: false });
    state = attemptTap(state, 0, 1.0);
    state = attemptTap(state, 1, 2.0);
    expect(state.combo).toBe(2);
    expect(state.score).toBeGreaterThan(0);

    const restarted = restartGame(state);
    expect(restarted.combo).toBe(0);
    expect(restarted.score).toBe(0);
    expect(restarted.maxCombo).toBe(0);
    expect(restarted.gauge).toBe(100);
    expect(restarted.finished).toBe(false);
    expect(restarted.notes.every((n) => n.status === "pending")).toBe(true);
  });
});

describe("실제 채보 JSON 파싱 통합", () => {
  it("parseChart로 만든 채보로도 정상적으로 게임 상태를 만들 수 있다", () => {
    const raw = JSON.stringify(makeChart());
    const chart = parseChart(raw);
    const state = createInitialGameState(chart, { failEnabled: false });
    expect(state.notes.length).toBe(4);
  });
});
