import type { ChartNote, ChartPlatform } from "../types/chart";

/**
 * Playability Validator (Maker v1). ERROR blocks sharing (local save stays possible, with a warning);
 * WARNING is advisory. The server repeats every ERROR rule before accepting an upload
 * (web/backend/community.py) - keep the two in sync.
 */
export type IssueSeverity = "ERROR" | "WARNING";

export type IssueCode =
  | "EMPTY" | "TOO_MANY_NOTES" | "INVALID_LANE" | "INVALID_TYPE" | "INVALID_TIME" | "NEGATIVE_TIME"
  | "AFTER_SONG_END" | "INVALID_HOLD" | "HOLD_PAST_END" | "DUPLICATE" | "OVERLAP" | "HOLD_OVERLAP"
  | "HOLD_BLOCKED" | "SAME_LANE_TOO_CLOSE" | "CHORD_THREE" | "CHORD_FOUR" | "DESKTOP_FLICK"
  | "DENSITY_HIGH" | "DENSITY_EXCESSIVE" | "SHORT_HOLD";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  /** Indexes into the validated (time-sorted) note array. */
  noteIndexes: number[];
  time?: number;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  /** true when no ERROR exists (sharing allowed by the validator). */
  ok: boolean;
}

export interface ValidationContext {
  platformProfile?: ChartPlatform;
  difficulty: string;
  /** Song length in seconds. 0/undefined skips the end-of-song checks. */
  durationSec?: number;
}

export const LIMITS = {
  MAX_NOTES: 5000,
  /** Same lane, same millisecond. */
  DUPLICATE_SEC: 0.001,
  /** Same lane closer than this cannot be judged as two notes (windows overlap). */
  OVERLAP_SEC: 0.05,
  /** Notes this close count as one chord. */
  CHORD_SEC: 0.015,
  /** A same-lane note this soon after a Hold ends collides with the release. */
  HOLD_RELEASE_GAP_SEC: 0.05,
  MIN_HOLD_SEC: 0.05,
  MAX_HOLD_SEC: 30,
  SHORT_HOLD_SEC: 0.1,
  /** Absolute 1-second density cap (EXTREME generator cap is 14). */
  MAX_NPS: 24,
  END_TOLERANCE_SEC: 0.5,
} as const;

/** Per-difficulty same-lane spacing and density used by the analyzer (analyzer/chartgen/config.py). */
export const DIFFICULTY_GUIDE: Record<string, { sameLaneSec: number; nps: number }> = {
  easy: { sameLaneSec: 0.55, nps: 3 },
  normal: { sameLaneSec: 0.32, nps: 5 },
  hard: { sameLaneSec: 0.2, nps: 8 },
  expert: { sameLaneSec: 0.14, nps: 12 },
  extreme: { sameLaneSec: 0.12, nps: 14 },
};

const ERROR_TEXT: Record<IssueCode, string> = {
  EMPTY: "노트가 없습니다.",
  TOO_MANY_NOTES: `노트가 너무 많습니다 (최대 ${LIMITS.MAX_NOTES}개).`,
  INVALID_LANE: "레인은 0~3(D F J K)만 사용할 수 있습니다.",
  INVALID_TYPE: "지원하지 않는 노트 종류입니다.",
  INVALID_TIME: "시간 값이 올바르지 않습니다.",
  NEGATIVE_TIME: "0초보다 앞선 노트가 있습니다.",
  AFTER_SONG_END: "곡이 끝난 뒤에 있는 노트입니다.",
  INVALID_HOLD: "Hold 길이가 0 이하이거나 올바르지 않습니다.",
  HOLD_PAST_END: "Hold가 곡 길이를 넘어갑니다.",
  DUPLICATE: "같은 레인·같은 시간에 노트가 중복되어 있습니다.",
  OVERLAP: "같은 레인 노트가 겹쳐 있습니다 (50ms 미만).",
  HOLD_OVERLAP: "같은 레인에서 Hold가 다른 Hold 안에서 시작합니다.",
  HOLD_BLOCKED: "Hold가 끝나기 전에 같은 레인에 노트가 있습니다.",
  SAME_LANE_TOO_CLOSE: "같은 레인 입력 간격이 이 난이도 기준보다 짧습니다.",
  CHORD_THREE: "3키 동시 입력입니다. 의도한 패턴인지 확인하세요.",
  CHORD_FOUR: "4키 동시 입력은 플레이할 수 없습니다.",
  DESKTOP_FLICK: "PC(Desktop) 채보에는 Flick을 넣을 수 없습니다.",
  DENSITY_HIGH: "1초 밀도가 이 난이도 기준보다 높습니다.",
  DENSITY_EXCESSIVE: `1초에 ${LIMITS.MAX_NPS}개를 넘는 구간이 있습니다.`,
  SHORT_HOLD: "100ms보다 짧은 Hold는 Tap처럼 보입니다.",
};

function holdEnd(note: ChartNote): number {
  return note.type === "hold" ? note.time + note.duration : note.time;
}

export function validatePlayability(input: readonly ChartNote[], ctx: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (severity: IssueSeverity, code: IssueCode, noteIndexes: number[], time?: number) =>
    issues.push({ severity, code, message: ERROR_TEXT[code], noteIndexes, time });
  const notes = [...input].sort((a, b) => a.time - b.time || a.lane - b.lane);
  const guide = DIFFICULTY_GUIDE[ctx.difficulty.toLowerCase()] ?? DIFFICULTY_GUIDE.extreme;
  const duration = ctx.durationSec && ctx.durationSec > 0 ? ctx.durationSec : 0;

  if (notes.length === 0) add("ERROR", "EMPTY", []);
  if (notes.length > LIMITS.MAX_NOTES) add("ERROR", "TOO_MANY_NOTES", []);

  const sane: number[] = [];
  notes.forEach((note, index) => {
    const lane = note.lane as number;
    if (!Number.isInteger(lane) || lane < 0 || lane > 3) { add("ERROR", "INVALID_LANE", [index], note.time); return; }
    if (!["tap", "hold", "flick"].includes(note.type)) { add("ERROR", "INVALID_TYPE", [index], note.time); return; }
    if (!Number.isFinite(note.time)) { add("ERROR", "INVALID_TIME", [index]); return; }
    if (note.time < 0) add("ERROR", "NEGATIVE_TIME", [index], note.time);
    if (duration && note.time > duration + LIMITS.END_TOLERANCE_SEC) add("ERROR", "AFTER_SONG_END", [index], note.time);
    if (note.type === "hold") {
      if (!Number.isFinite(note.duration) || note.duration < LIMITS.MIN_HOLD_SEC || note.duration > LIMITS.MAX_HOLD_SEC) {
        add("ERROR", "INVALID_HOLD", [index], note.time); return;
      }
      if (note.duration < LIMITS.SHORT_HOLD_SEC) add("WARNING", "SHORT_HOLD", [index], note.time);
      if (duration && holdEnd(note) > duration + LIMITS.END_TOLERANCE_SEC) add("ERROR", "HOLD_PAST_END", [index], note.time);
    }
    if (note.type === "flick" && ctx.platformProfile === "desktop") add("ERROR", "DESKTOP_FLICK", [index], note.time);
    sane.push(index);
  });

  // Same-lane relations.
  for (let lane = 0; lane < 4; lane++) {
    const laneNotes = sane.filter((index) => notes[index].lane === lane);
    for (let i = 1; i < laneNotes.length; i++) {
      const prevIndex = laneNotes[i - 1];
      const index = laneNotes[i];
      const prev = notes[prevIndex];
      const note = notes[index];
      const gap = note.time - prev.time;
      if (gap < LIMITS.DUPLICATE_SEC) { add("ERROR", "DUPLICATE", [prevIndex, index], note.time); continue; }
      if (prev.type === "hold" && note.time < holdEnd(prev) + LIMITS.HOLD_RELEASE_GAP_SEC) {
        add("ERROR", note.type === "hold" ? "HOLD_OVERLAP" : "HOLD_BLOCKED", [prevIndex, index], note.time);
        continue;
      }
      const sinceRelease = note.time - holdEnd(prev);
      if (gap < LIMITS.OVERLAP_SEC) add("ERROR", "OVERLAP", [prevIndex, index], note.time);
      else if (sinceRelease < guide.sameLaneSec - 1e-6) add("WARNING", "SAME_LANE_TOO_CLOSE", [prevIndex, index], note.time);
    }
  }

  // Chords: notes starting within CHORD_SEC of each other on different lanes.
  for (let i = 0; i < sane.length;) {
    let j = i + 1;
    while (j < sane.length && notes[sane[j]].time - notes[sane[i]].time <= LIMITS.CHORD_SEC) j++;
    const group = sane.slice(i, j);
    const lanes = new Set(group.map((index) => notes[index].lane));
    if (lanes.size >= 4) add("ERROR", "CHORD_FOUR", group, notes[sane[i]].time);
    else if (lanes.size === 3) add("WARNING", "CHORD_THREE", group, notes[sane[i]].time);
    i = j;
  }

  // Rolling 1-second density (chord notes count individually, as in the analyzer).
  let worst = 0; let worstStart = 0;
  for (let i = 0, j = 0; j < sane.length; j++) {
    while (notes[sane[j]].time - notes[sane[i]].time >= 1) i++;
    if (j - i + 1 > worst) { worst = j - i + 1; worstStart = i; }
  }
  if (worst > LIMITS.MAX_NPS) add("ERROR", "DENSITY_EXCESSIVE", [], notes[sane[worstStart]]?.time);
  else if (worst > guide.nps) add("WARNING", "DENSITY_HIGH", [], notes[sane[worstStart]]?.time);

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1) || (a.time ?? 0) - (b.time ?? 0));
  const errors = issues.filter((issue) => issue.severity === "ERROR").length;
  return { issues, errors, warnings: issues.length - errors, ok: errors === 0 };
}
