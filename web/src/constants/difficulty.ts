import { DIFFICULTIES, type Difficulty } from "../types/chart";

/**
 * Single source for user-facing difficulty names. Internal values (chart JSON, API, DB, records) keep
 * the Phase 1 identifiers; only the display changes - `extreme` is shown as MASTER.
 */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "EASY",
  normal: "NORMAL",
  hard: "HARD",
  expert: "EXPERT",
  extreme: "MASTER",
};

/** Accepts any stored spelling ("Extreme", "extreme", "MASTER") and returns the internal value. */
export function normalizeDifficulty(value: string | null | undefined): Difficulty | null {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "master") return "extreme";
  return (DIFFICULTIES as readonly string[]).includes(key) ? key as Difficulty : null;
}

export function difficultyLabel(value: string | null | undefined): string {
  const normalized = normalizeDifficulty(value);
  return normalized ? DIFFICULTY_LABELS[normalized] : (value ?? "").toUpperCase();
}

/** Short tag for compact rows (EAS/NOR/HAR/EXP/MAS). */
export function difficultyShort(value: string | null | undefined): string {
  return difficultyLabel(value).slice(0, 3);
}

export const DIFFICULTY_OPTIONS = DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }));
