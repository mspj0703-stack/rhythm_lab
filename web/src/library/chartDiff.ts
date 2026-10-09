import type { ChartNote } from "../types/chart";

/** Millisecond-resolution identity of a note. Sub-millisecond float noise never counts as an edit. */
export function noteKey(note: ChartNote): string {
  const duration = note.type === "hold" ? Math.round(note.duration * 1000) : 0;
  return `${Math.round(note.time * 1000)}:${note.lane}:${note.type}:${duration}`;
}

export function canonicalNoteKeys(notes: readonly ChartNote[]): string[] {
  return notes.map(noteKey).sort();
}

export function notesEqual(a: readonly ChartNote[], b: readonly ChartNote[]): boolean {
  if (a.length !== b.length) return false;
  const left = canonicalNoteKeys(a);
  const right = canonicalNoteKeys(b);
  return left.every((key, index) => key === right[index]);
}

export interface EditSummary {
  added: number;
  removed: number;
  unchanged: number;
}

/**
 * Multiset difference between an original and an edited note list. A moved note counts as one removal plus
 * one addition. `added + removed === 0` means the chart is identical to the original (not human-edited).
 */
export function summarizeEdit(original: readonly ChartNote[], edited: readonly ChartNote[]): EditSummary {
  const pool = new Map<string, number>();
  for (const key of original.map(noteKey)) pool.set(key, (pool.get(key) ?? 0) + 1);
  let unchanged = 0;
  for (const key of edited.map(noteKey)) {
    const left = pool.get(key) ?? 0;
    if (left > 0) { unchanged++; pool.set(key, left - 1); }
  }
  return { added: edited.length - unchanged, removed: original.length - unchanged, unchanged };
}

export function isEdited(summary: EditSummary): boolean {
  return summary.added + summary.removed > 0;
}
