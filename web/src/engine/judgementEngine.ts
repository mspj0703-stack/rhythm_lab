import type { JudgementLabel, Lane, NoteRuntime } from "../types/chart";
import {
  JUDGEMENT_WINDOW_MS,
  JUDGEMENT_MISS_WINDOW_MS,
  HOLD_RELEASE_TOLERANCE_MS,
  HOLD_REGRAB_GRACE_MS,
} from "../constants/config";

/**
 * 시간 오차(ms)를 등급으로 분류한다.
 * 반환값이 null이면 "판정 후보가 아님" (= 어떤 등급도 아니고 그냥 무시해야 함)을 의미한다.
 * 이 함수는 이미 |diffMs| <= JUDGEMENT_MISS_WINDOW_MS 인 입력에 대해서만 등급을 매긴다.
 * 그 범위를 넘는 입력에 대한 처리(=Miss 확정)는 호출부에서 결정한다.
 */
export const TIMING_EPSILON_MS = 1e-7;

export function classifyByTimingDiff(diffMs: number): Exclude<JudgementLabel, "Miss"> | null {
  const abs = Math.abs(diffMs);
  if (abs <= TIMING_EPSILON_MS + JUDGEMENT_WINDOW_MS.PERFECT) return "Perfect";
  if (abs <= TIMING_EPSILON_MS + JUDGEMENT_WINDOW_MS.GREAT) return "Great";
  if (abs <= TIMING_EPSILON_MS + JUDGEMENT_WINDOW_MS.GOOD) return "Good";
  return null;
}

/**
 * 특정 레인에서, 아직 판정되지 않은 노트 중 currentTimeSec에 가장 가까운 노트를 찾는다.
 * JUDGEMENT_MISS_WINDOW_MS(=Good 상한) 범위를 벗어나는 노트는 후보에서 제외한다.
 *
 * 성능 참고: 호출부(gameState)가 이미 "활성 윈도우"로 자른 노트 목록만 넘기므로,
 * 여기서는 그 부분집합 안에서만 선형 탐색한다.
 */
export function findNearestJudgeableNote(
  notes: NoteRuntime[],
  lane: Lane,
  currentTimeSec: number,
  statusFilter: NoteRuntime["status"][] = ["pending"]
): NoteRuntime | null {
  let best: NoteRuntime | null = null;
  let bestDiffMs = Infinity;

  for (const n of notes) {
    if (n.note.lane !== lane) continue;
    if (!statusFilter.includes(n.status)) continue;

    const diffMs = (currentTimeSec - n.note.time) * 1000;
    if (Math.abs(diffMs) > JUDGEMENT_MISS_WINDOW_MS + TIMING_EPSILON_MS) continue;

    const absDiff = Math.abs(diffMs);
    const bestAbs = Math.abs(bestDiffMs);
    const isCloser = absDiff < bestAbs - TIMING_EPSILON_MS;
    const isTie = Math.abs(absDiff - bestAbs) <= TIMING_EPSILON_MS;
    // Deterministic boundary choice: closest timing first; exact ties prefer the earlier chart time,
    // then the stable runtime index. This prevents frame/order jitter around shared judgement windows.
    const winsTie = isTie && best !== null && (
      n.note.time < best.note.time || (n.note.time === best.note.time && n.index < best.index)
    );
    if (best === null || isCloser || winsTie) {
      best = n;
      bestDiffMs = diffMs;
    }
  }

  return best;
}

export interface TapJudgeResult {
  note: NoteRuntime;
  judgement: JudgementLabel;
  diffMs: number;
}

/**
 * Tap/Flick 노트에 대한 즉시 판정.
 * 후보 노트가 없으면 null (= 허공 입력, 페널티 없음).
 */
export function judgeTapOrFlick(
  notes: NoteRuntime[],
  lane: Lane,
  currentTimeSec: number
): TapJudgeResult | null {
  const target = findNearestJudgeableNote(notes, lane, currentTimeSec, ["pending"]);
  if (!target) return null;

  const diffMs = (currentTimeSec - target.note.time) * 1000;
  const label = classifyByTimingDiff(diffMs);
  // findNearestJudgeableNote가 이미 MISS 윈도우 내로 필터링했으므로 label은 항상 non-null
  const judgement = label ?? "Good";

  return { note: target, judgement, diffMs };
}

/**
 * Hold 노트 시작 판정. Tap과 동일한 타이밍 기준을 사용하되,
 * 대상 노트 타입이 "hold"인 것만 찾는다.
 */
export function judgeHoldStart(
  notes: NoteRuntime[],
  lane: Lane,
  currentTimeSec: number
): TapJudgeResult | null {
  const candidates = notes.filter((n) => n.note.type === "hold");
  const target = findNearestJudgeableNote(candidates, lane, currentTimeSec, ["pending"]);
  if (!target) return null;

  const diffMs = (currentTimeSec - target.note.time) * 1000;
  const label = classifyByTimingDiff(diffMs);
  const judgement = label ?? "Good";

  return { note: target, judgement, diffMs };
}

export type HoldReleaseOutcome = "completed" | "early_release";

/**
 * Hold 노트를 유지하던 중 키를 뗐을 때, 정상 종료인지 조기 이탈인지 판정한다.
 * note.note.type이 "hold"라고 가정한다 (호출부에서 보장).
 */
export function judgeHoldRelease(
  note: NoteRuntime,
  currentTimeSec: number
): HoldReleaseOutcome {
  if (note.note.type !== "hold") {
    throw new Error("judgeHoldRelease는 hold 노트에만 사용할 수 있습니다.");
  }
  const endTime = note.note.time + note.note.duration;
  const diffMs = (endTime - currentTimeSec) * 1000;

  // endTime보다 HOLD_RELEASE_TOLERANCE_MS 이상 이전에 뗀 경우 조기 이탈
  if (diffMs > HOLD_RELEASE_TOLERANCE_MS + TIMING_EPSILON_MS) {
    return "early_release";
  }
  return "completed";
}

/**
 * 특정 시각 이전에, 판정 기회를 완전히 놓친(pending 상태로 미스 윈도우를 지나버린) 노트들을 찾는다.
 * hold 노트는 "시작" 판정 기준으로만 이 함수에서 다루고, 시작에 성공한 이후(holding)의
 * 조기 이탈/정상 종료는 judgeHoldRelease / 별도의 hold 만료 체크에서 처리한다.
 */
export function findExpiredPendingNotes(
  notes: NoteRuntime[],
  currentTimeSec: number
): NoteRuntime[] {
  return notes.filter((n) => {
    if (n.status !== "pending") return false;
    const diffMs = (currentTimeSec - n.note.time) * 1000;
    return diffMs > JUDGEMENT_MISS_WINDOW_MS + TIMING_EPSILON_MS;
  });
}

/**
 * "holding" 상태인 hold 노트 중, 유지 종료 시각을 이미 넘겼는데도
 * 여전히 holding으로 남아있는 노트를 찾는다 (키를 계속 누르고 있어서 정상 완료된 경우).
 */
export function findCompletedHoldNotes(
  notes: NoteRuntime[],
  currentTimeSec: number
): NoteRuntime[] {
  return notes.filter((n) => {
    if (n.status !== "holding" || n.note.type !== "hold" || n.holdReleasedAt !== undefined) return false;
    const endTime = n.note.time + n.note.duration;
    return currentTimeSec >= endTime;
  });
}


/** grace 시간이 끝났는데 다시 눌리지 않은 Hold를 찾는다. */
export function findExpiredHoldReleases(
  notes: NoteRuntime[],
  currentTimeSec: number
): NoteRuntime[] {
  return notes.filter((n) => {
    if (n.status !== "holding" || n.note.type !== "hold" || n.holdReleasedAt === undefined) return false;
    return (currentTimeSec - n.holdReleasedAt) * 1000 > HOLD_REGRAB_GRACE_MS + TIMING_EPSILON_MS;
  });
}
