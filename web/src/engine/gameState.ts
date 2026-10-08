import type { Chart, JudgementLabel, Lane, NoteRuntime, NoteType } from "../types/chart";
import { createNoteRuntimes } from "./chartLoader";
import {
  classifyByTimingDiff,
  TIMING_EPSILON_MS,
  findCompletedHoldNotes,
  findExpiredHoldReleases,
  findExpiredPendingNotes,
  findNearestJudgeableNote,
  judgeHoldRelease,
} from "./judgementEngine";
import { calculateNoteScore } from "./scoring";
import { advanceHoldTicks } from "./holdTicks";
import { applyJudgementToGauge, isFailed } from "./gauge";
import { ACCURACY_WEIGHT, GAUGE_CONFIG, HOLD_REGRAB_GRACE_MS } from "../constants/config";


export type FeedbackPhase = "hit" | "hold_start" | "hold_complete" | "hold_break" | "miss";

export interface JudgementFeedback {
  sequence: number;
  judgement: JudgementLabel;
  diffMs: number | null;
  lane: Lane;
  noteType: NoteType;
  phase: FeedbackPhase;
}

export interface GameOptions {
  /** 개발/테스트 편의를 위해 게이지 실패를 끌 수 있는 옵션 */
  failEnabled: boolean;
}

export interface GameState {
  chart: Chart;
  notes: NoteRuntime[];
  score: number;
  holdTickScore: number;
  holdTicksEarned: number;
  combo: number;
  maxCombo: number;
  perfectStreak: number;
  maxPerfectStreak: number;
  gauge: number;
  failed: boolean;
  finished: boolean;
  options: GameOptions;
  judgementCounts: Record<JudgementLabel, number>;
  totalJudged: number;
  accuracyWeightSum: number;
  /** 마지막으로 발생한 판정 (UI에서 텍스트 연출용, 다음 판정 전까지 유지) */
  lastJudgement: JudgementLabel | null;
  /** 실제 판정선 연출에 쓰는 가장 최근 입력/판정 이벤트 */
  lastFeedback: JudgementFeedback | null;
  feedbackSequence: number;
}

export function createInitialGameState(chart: Chart, options: GameOptions): GameState {
  return {
    chart,
    notes: createNoteRuntimes(chart),
    score: 0,
    holdTickScore: 0,
    holdTicksEarned: 0,
    combo: 0,
    maxCombo: 0,
    perfectStreak: 0,
    maxPerfectStreak: 0,
    gauge: GAUGE_CONFIG.INITIAL,
    failed: false,
    finished: false,
    options,
    judgementCounts: { Perfect: 0, Great: 0, Good: 0, Miss: 0 },
    totalJudged: 0,
    accuracyWeightSum: 0,
    lastJudgement: null,
    lastFeedback: null,
    feedbackSequence: 0,
  };
}

/** 판정선 UI용 이벤트를 만든다. */
function feedbackPatch(
  state: GameState,
  feedback: Omit<JudgementFeedback, "sequence">
): Pick<GameState, "lastFeedback" | "feedbackSequence"> {
  const sequence = state.feedbackSequence + 1;
  return { lastFeedback: { ...feedback, sequence }, feedbackSequence: sequence };
}

/** 현재 콤보/점수/게이지/카운트에 판정 하나를 반영한다. */
function applyJudgement(
  state: GameState,
  judgement: JudgementLabel,
  feedback: Omit<JudgementFeedback, "sequence">
): Pick<
  GameState,
  "score" | "combo" | "maxCombo" | "perfectStreak" | "maxPerfectStreak" | "gauge" | "failed" | "judgementCounts" | "totalJudged" | "accuracyWeightSum" | "lastJudgement" | "lastFeedback" | "feedbackSequence"
> {
  const comboBefore = state.combo;
  const scoreDelta = calculateNoteScore(judgement, comboBefore);
  const nextCombo = judgement === "Miss" ? 0 : state.combo + 1;
  const nextGauge = applyJudgementToGauge(state.gauge, judgement);
  const nextPerfectStreak = judgement === "Perfect" ? state.perfectStreak + 1 : 0;

  return {
    score: state.score + scoreDelta,
    combo: nextCombo,
    maxCombo: Math.max(state.maxCombo, nextCombo),
    perfectStreak: nextPerfectStreak,
    maxPerfectStreak: Math.max(state.maxPerfectStreak, nextPerfectStreak),
    gauge: nextGauge,
    failed: state.failed || isFailed(nextGauge, state.options.failEnabled),
    judgementCounts: {
      ...state.judgementCounts,
      [judgement]: state.judgementCounts[judgement] + 1,
    },
    totalJudged: state.totalJudged + 1,
    accuracyWeightSum: state.accuracyWeightSum + ACCURACY_WEIGHT[judgement],
    lastJudgement: judgement,
    ...feedbackPatch(state, feedback),
  };
}

function replaceNote(notes: NoteRuntime[], updated: NoteRuntime): NoteRuntime[] {
  const copy = notes.slice();
  copy[updated.index] = updated;
  return copy;
}

function accrueHoldTicks(state: GameState, time: number, onlyIndex?: number): GameState {
  if (state.chart.scoringVersion !== 2 || state.failed || state.finished) return state;
  let next = state;
  for (const runtime of state.notes) {
    if (onlyIndex !== undefined && runtime.index !== onlyIndex) continue;
    const tick = advanceHoldTicks(runtime, time);
    if (tick.note === runtime) continue;
    next = { ...next, notes: replaceNote(next.notes, tick.note), score: next.score + tick.score,
      holdTickScore: next.holdTickScore + tick.score, holdTicksEarned: next.holdTicksEarned + tick.earned };
  }
  return next;
}

/** Tap 노트 판정 시도. 대상이 없으면 상태 변화 없이 그대로 반환한다 (허공 입력은 무페널티). */
export function attemptTap(state: GameState, lane: Lane, currentTimeSec: number): GameState {
  if (state.failed || state.finished) return state;

  const candidates = state.notes.filter((n) => n.note.type === "tap");
  const target = findNearestJudgeableNote(candidates, lane, currentTimeSec, ["pending"]);
  if (!target) return state;

  const diffMs = (currentTimeSec - target.note.time) * 1000;
  const judgement = classifyByTimingDiff(diffMs) ?? "Good";

  const updatedNote: NoteRuntime = { ...target, status: "hit", judgement };
  const patch = applyJudgement(state, judgement, { judgement, diffMs, lane, noteType: "tap", phase: "hit" });

  return { ...state, ...patch, notes: replaceNote(state.notes, updatedNote) };
}

/** One lane press consumes only its nearest note; regrabbing an active hold takes priority. */
export function attemptLanePress(state: GameState, lane: Lane, currentTimeSec: number): GameState {
  const regrab = state.notes.some((n) => n.note.lane === lane && n.status === "holding" && n.holdReleasedAt !== undefined);
  if (regrab) return attemptHoldStart(state, lane, currentTimeSec);
  const target = findNearestJudgeableNote(state.notes, lane, currentTimeSec);
  if (target?.note.type === "tap") return attemptTap(state, lane, currentTimeSec);
  if (target?.note.type === "hold") return attemptHoldStart(state, lane, currentTimeSec);
  return state;
}

/** Hold 노트 시작 또는 grace 안의 재입력을 시도한다. */
export function attemptHoldStart(state: GameState, lane: Lane, currentTimeSec: number): GameState {
  if (state.failed || state.finished) return state;

  let working = accrueHoldTicks(state, currentTimeSec);
  const released = working.notes.find(
    (n) => n.note.lane === lane && n.status === "holding" && n.note.type === "hold" && n.holdReleasedAt !== undefined
  );
  if (released && released.holdReleasedAt !== undefined) {
    const elapsedMs = (currentTimeSec - released.holdReleasedAt) * 1000;
    if (elapsedMs <= HOLD_REGRAB_GRACE_MS + TIMING_EPSILON_MS) {
      const recovered: NoteRuntime = { ...released, holdReleasedAt: undefined };
      return { ...working, notes: replaceNote(working.notes, recovered) };
    }
    const broken: NoteRuntime = { ...released, status: "hold_broken", judgement: "Miss" };
    const releasedEnd = released.note.type === "hold" ? released.note.time + released.note.duration : released.note.time;
    const diffMs = (released.holdReleasedAt - releasedEnd) * 1000;
    const patch = applyJudgement(working, "Miss", { judgement: "Miss", diffMs, lane, noteType: "hold", phase: "hold_break" });
    working = { ...working, ...patch, notes: replaceNote(working.notes, broken) };
  }

  const candidates = working.notes.filter((n) => n.note.type === "hold");
  const target = findNearestJudgeableNote(candidates, lane, currentTimeSec, ["pending"]);
  if (!target) return working;

  const diffMs = (currentTimeSec - target.note.time) * 1000;
  const startJudgement = classifyByTimingDiff(diffMs) ?? "Good";
  const updatedNote: NoteRuntime = {
    ...target,
    status: "holding",
    judgement: startJudgement,
    holdStartedAt: currentTimeSec,
    holdReleasedAt: undefined,
  };

  return {
    ...working,
    ...feedbackPatch(working, { judgement: startJudgement, diffMs, lane, noteType: "hold", phase: "hold_start" }),
    notes: replaceNote(working.notes, updatedNote),
  };
}

/** Hold 노트 유지 중 키를 뗐을 때 호출. 끝 근처면 즉시 완료, 아니면 re-grab grace를 시작한다. */
export function attemptHoldRelease(state: GameState, lane: Lane, currentTimeSec: number): GameState {
  if (state.failed || state.finished) return state;
  state = accrueHoldTicks(state, currentTimeSec);

  const holding = state.notes.find(
    (n) => n.note.lane === lane && n.status === "holding" && n.note.type === "hold"
  );
  if (!holding || holding.holdReleasedAt !== undefined) return state;

  const outcome = judgeHoldRelease(holding, currentTimeSec);

  if (outcome === "completed") {
    // Preserve the existing early-release allowance, including the final tolerated tick.
    state = accrueHoldTicks(state, holding.note.time + (holding.note.type === "hold" ? holding.note.duration : 0), holding.index);
    const currentHold = state.notes[holding.index];
    const judgement = holding.judgement ?? "Good";
    const updatedNote: NoteRuntime = { ...currentHold, status: "hit", holdReleasedAt: undefined };
    const patch = applyJudgement(state, judgement, { judgement, diffMs: null, lane, noteType: "hold", phase: "hold_complete" });
    return { ...state, ...patch, notes: replaceNote(state.notes, updatedNote) };
  }

  const released: NoteRuntime = { ...holding, holdReleasedAt: currentTimeSec };
  return { ...state, notes: replaceNote(state.notes, released) };
}

/** Flick 판정 시도 (레인 키 + Space 조합이 완성된 시점에 호출). */
export function attemptFlick(state: GameState, lane: Lane, currentTimeSec: number): GameState {
  if (state.failed || state.finished) return state;

  const candidates = state.notes.filter((n) => n.note.type === "flick");
  const target = findNearestJudgeableNote(candidates, lane, currentTimeSec, ["pending"]);
  if (!target) return state;

  const diffMs = (currentTimeSec - target.note.time) * 1000;
  const judgement = classifyByTimingDiff(diffMs) ?? "Good";

  const updatedNote: NoteRuntime = { ...target, status: "hit", judgement };
  const patch = applyJudgement(state, judgement, { judgement, diffMs, lane, noteType: "flick", phase: "hit" });

  return { ...state, ...patch, notes: replaceNote(state.notes, updatedNote) };
}

/**
 * 매 프레임 호출: 판정 기회를 놓친 pending 노트를 Miss 처리하고,
 * 유지 시간을 다 채운 holding 노트를 정상 완료 처리한다.
 * 마지막 노트까지 지나갔으면 finished=true로 표시한다.
 */
export function tick(state: GameState, currentTimeSec: number): GameState {
  if (state.finished) return state;

  let next = accrueHoldTicks(state, currentTimeSec);

  const expired = findExpiredPendingNotes(next.notes, currentTimeSec);
  for (const n of expired) {
    const updatedNote: NoteRuntime = { ...n, status: "missed", judgement: "Miss" };
    const rawDiffMs = (currentTimeSec - n.note.time) * 1000;
    const diffMs = Number.isFinite(rawDiffMs) ? rawDiffMs : null;
    const patch = applyJudgement(next, "Miss", { judgement: "Miss", diffMs, lane: n.note.lane, noteType: n.note.type, phase: "miss" });
    next = { ...next, ...patch, notes: replaceNote(next.notes, updatedNote) };
  }

  const expiredReleases = findExpiredHoldReleases(next.notes, currentTimeSec);
  for (const n of expiredReleases) {
    const updatedNote: NoteRuntime = { ...n, status: "hold_broken", judgement: "Miss" };
    const endTime = n.note.type === "hold" ? n.note.time + n.note.duration : n.note.time;
    const rawDiffMs = n.holdReleasedAt === undefined ? null : (n.holdReleasedAt - endTime) * 1000;
    const diffMs = rawDiffMs !== null && Number.isFinite(rawDiffMs) ? rawDiffMs : null;
    const patch = applyJudgement(next, "Miss", { judgement: "Miss", diffMs, lane: n.note.lane, noteType: "hold", phase: "hold_break" });
    next = { ...next, ...patch, notes: replaceNote(next.notes, updatedNote) };
  }

  const completedHolds = findCompletedHoldNotes(next.notes, currentTimeSec);
  for (const n of completedHolds) {
    const judgement = n.judgement ?? "Good";
    const updatedNote: NoteRuntime = { ...n, status: "hit" };
    const patch = applyJudgement(next, judgement, { judgement, diffMs: null, lane: n.note.lane, noteType: "hold", phase: "hold_complete" });
    next = { ...next, ...patch, notes: replaceNote(next.notes, updatedNote) };
  }

  const allResolved = next.notes.every((n) => n.status === "hit" || n.status === "missed" || n.status === "hold_broken");
  const lastNoteEndTime = next.chart.notes.reduce((max, n) => {
    const endTime = n.type === "hold" ? n.time + n.duration : n.time;
    return Math.max(max, endTime);
  }, 0);

  if (allResolved && currentTimeSec > lastNoteEndTime + 0.5) {
    next = { ...next, finished: true };
  }

  return next;
}

export function restartGame(state: GameState): GameState {
  return createInitialGameState(state.chart, state.options);
}

export function calculateAccuracyPercent(state: GameState): number {
  if (state.totalJudged === 0) return 100;
  return (state.accuracyWeightSum / state.totalJudged) * 100;
}
