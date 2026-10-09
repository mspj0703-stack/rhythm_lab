import type { ChartNote, ChartPlatform, Lane, NoteType } from "../types/chart";

/** Editor-side note with a stable id so selection survives sorting, moves and undo. */
export interface EditorNote {
  id: number;
  time: number;
  lane: Lane;
  type: NoteType;
  /** Hold length in seconds (hold only). */
  duration?: number;
}

export interface EditorState {
  notes: EditorNote[];
  nextId: number;
}

export interface EditorHistory {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

export const HISTORY_LIMIT = 300;
/** Shortest Hold the editor creates or resizes to (also the validator's lower bound for a sane Hold). */
export const MIN_HOLD_SEC = 0.05;
export const MAX_HOLD_SEC = 30;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function sortNotes(notes: EditorNote[]): EditorNote[] {
  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane || a.id - b.id);
}

export function fromChartNotes(notes: readonly ChartNote[]): EditorState {
  const editorNotes = notes.map<EditorNote>((note, index) => ({
    id: index + 1, time: note.time, lane: note.lane, type: note.type,
    ...(note.type === "hold" ? { duration: note.duration } : {}),
  }));
  return { notes: sortNotes(editorNotes), nextId: notes.length + 1 };
}

export function toChartNotes(state: EditorState): ChartNote[] {
  return state.notes.map<ChartNote>((note) => note.type === "hold"
    ? { time: round3(note.time), lane: note.lane, type: "hold", duration: round3(note.duration ?? MIN_HOLD_SEC) }
    : { time: round3(note.time), lane: note.lane, type: note.type });
}

export function createHistory(state: EditorState): EditorHistory {
  return { past: [], present: state, future: [] };
}

/** Records a new state. Operations that changed nothing return the same object and add no history entry. */
export function commit(history: EditorHistory, next: EditorState): EditorHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undo(history: EditorHistory): EditorHistory {
  if (history.past.length === 0) return history;
  const past = history.past.slice(0, -1);
  return { past, present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redo(history: EditorHistory): EditorHistory {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

export function canUndo(history: EditorHistory): boolean { return history.past.length > 0; }
export function canRedo(history: EditorHistory): boolean { return history.future.length > 0; }

/** Flick is a mobile gesture: new v5 desktop charts never get one (legacy charts keep theirs). */
export function flickAllowed(platform: ChartPlatform | undefined): boolean {
  return platform !== "desktop";
}

function clampLane(lane: number): Lane {
  return Math.max(0, Math.min(3, Math.round(lane))) as Lane;
}

function clampHold(duration: number): number {
  return round3(Math.max(MIN_HOLD_SEC, Math.min(MAX_HOLD_SEC, duration)));
}

export interface NewNote { time: number; lane: Lane; type: NoteType; duration?: number; }

/** Adds a note. An identical note (same lane and millisecond) is not duplicated. */
export function addNote(state: EditorState, note: NewNote): { state: EditorState; id: number | null } {
  const time = round3(Math.max(0, note.time));
  if (state.notes.some((existing) => existing.lane === note.lane && Math.abs(existing.time - time) < 0.0005)) return { state, id: null };
  const id = state.nextId;
  const created: EditorNote = { id, time, lane: clampLane(note.lane), type: note.type,
    ...(note.type === "hold" ? { duration: clampHold(note.duration ?? 0.5) } : {}) };
  return { state: { notes: sortNotes([...state.notes, created]), nextId: id + 1 }, id };
}

export function deleteNotes(state: EditorState, ids: ReadonlySet<number>): EditorState {
  if (ids.size === 0) return state;
  const notes = state.notes.filter((note) => !ids.has(note.id));
  return notes.length === state.notes.length ? state : { ...state, notes };
}

/**
 * Moves the selection together. The lane shift is limited so every selected note stays inside 0..3 and
 * the time shift so none goes below zero - the selection keeps its shape instead of collapsing.
 */
export function moveNotes(state: EditorState, ids: ReadonlySet<number>, deltaSec: number, deltaLane: number): EditorState {
  const selected = state.notes.filter((note) => ids.has(note.id));
  if (selected.length === 0) return state;
  const minLane = Math.min(...selected.map((note) => note.lane));
  const maxLane = Math.max(...selected.map((note) => note.lane));
  const laneShift = Math.max(-minLane, Math.min(3 - maxLane, Math.round(deltaLane)));
  const minTime = Math.min(...selected.map((note) => note.time));
  const timeShift = Math.max(-minTime, deltaSec);
  if (laneShift === 0 && Math.abs(timeShift) < 0.0005) return state;
  const notes = state.notes.map((note) => ids.has(note.id)
    ? { ...note, lane: (note.lane + laneShift) as Lane, time: round3(note.time + timeShift) }
    : note);
  return { ...state, notes: sortNotes(notes) };
}

export function setNoteTime(state: EditorState, id: number, time: number): EditorState {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return state;
  return moveNotes(state, new Set([id]), round3(Math.max(0, time)) - note.time, 0);
}

export function setNoteLane(state: EditorState, id: number, lane: number): EditorState {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return state;
  return moveNotes(state, new Set([id]), 0, clampLane(lane) - note.lane);
}

/**
 * Changes the type of the selected notes. Hold gets `defaultHoldSec`; Flick is refused (no change) on a
 * desktop chart. Converting away from Hold drops its duration.
 */
export function setNoteType(state: EditorState, ids: ReadonlySet<number>, type: NoteType, defaultHoldSec: number, platform: ChartPlatform | undefined): EditorState {
  if (type === "flick" && !flickAllowed(platform)) return state;
  let changed = false;
  const notes = state.notes.map((note) => {
    if (!ids.has(note.id) || note.type === type) return note;
    changed = true;
    const { duration: _drop, ...rest } = note;
    void _drop;
    return type === "hold" ? { ...rest, type, duration: clampHold(defaultHoldSec) } : { ...rest, type };
  });
  return changed ? { ...state, notes } : state;
}

/** Sets (absolute) or adjusts (delta) Hold length of the selected Holds. Non-Hold notes are untouched. */
export function resizeHolds(state: EditorState, ids: ReadonlySet<number>, change: { set?: number; delta?: number }): EditorState {
  let changed = false;
  const notes = state.notes.map((note) => {
    if (!ids.has(note.id) || note.type !== "hold") return note;
    const next = clampHold(change.set ?? (note.duration ?? MIN_HOLD_SEC) + (change.delta ?? 0));
    if (Math.abs(next - (note.duration ?? 0)) < 0.0005) return note;
    changed = true;
    return { ...note, duration: next };
  });
  return changed ? { ...state, notes } : state;
}

export function notesInRange(state: EditorState, start: number, end: number): EditorNote[] {
  return state.notes.filter((note) => {
    const tail = note.type === "hold" ? note.time + (note.duration ?? 0) : note.time;
    return tail >= start && note.time <= end;
  });
}

export function findNoteAt(state: EditorState, lane: Lane, time: number, toleranceSec: number): EditorNote | null {
  let best: EditorNote | null = null;
  let bestDistance = Infinity;
  for (const note of state.notes) {
    if (note.lane !== lane) continue;
    const end = note.type === "hold" ? note.time + (note.duration ?? 0) : note.time;
    const distance = time < note.time ? note.time - time : time > end ? time - end : 0;
    if (distance <= toleranceSec && distance < bestDistance) { best = note; bestDistance = distance; }
  }
  return best;
}
