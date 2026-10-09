import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { Chart, Lane, NoteType } from "../types/chart";
import type { LibraryBundle, LibraryChart } from "../library/types";
import type { SongMediaHandle } from "../library/mediaSource";
import { saveEditedChart } from "../library/db";
import { notesEqual } from "../library/chartDiff";
import { getAuthorIdentity } from "../library/author";
import { GameScreen } from "../components/GameScreen";
import type { AudioSettings } from "../audio/sfx";
import type { Preferences } from "../settings/preferences";
import {
  addNote, canRedo, canUndo, commit, createHistory, deleteNotes, findNoteAt, flickAllowed, fromChartNotes,
  moveNotes, notesInRange, redo, resizeHolds, setNoteLane, setNoteTime, setNoteType, toChartNotes, undo,
  MIN_HOLD_SEC, type EditorHistory, type EditorState,
} from "./editorModel";
import { gridLines, gridStepSec, snapLabel, snapTime, SNAP_DIVISIONS, type GridContext, type SnapDivision } from "./snap";
import { validatePlayability } from "./validator";
import { originLabel } from "./originLabel";
import { formatClock } from "./format";
import "./maker.css";
import { difficultyLabel } from "../constants/difficulty";

type Tool = "select" | "tap" | "hold" | "flick" | "erase";

interface Props {
  bundle: LibraryBundle;
  /** Chart opened in the Maker. AI/Community sources are cloned on first save; MANUAL_EDITED is updated. */
  source: LibraryChart;
  media: SongMediaHandle;
  noteSpeed: number;
  timingOffsetMs: number;
  audioSettings: AudioSettings;
  preferences: Preferences;
  onExit: () => void;
  onSaved: (chart: LibraryChart) => void;
}

const LANE_LABELS = ["D", "F", "J", "K"] as const;
const ZOOM_MIN = 60;
const ZOOM_MAX = 1400;
const PLAYHEAD_RATIO = 0.8;
const KEY_LANES: Record<string, Lane> = { d: 0, f: 1, j: 2, k: 3 };


interface DragState {
  pointerId: number;
  mode: "move" | "resize" | "pan";
  startY: number;
  startX: number;
  startView: number;
  base: EditorState;
  anchorId: number | null;
  anchorTime: number;
  anchorLane: number;
  anchorDuration: number;
  ids: Set<number>;
  moved: boolean;
}

export function MakerScreen({ bundle, source, media, noteSpeed, timingOffsetMs, audioSettings, preferences, onExit, onSaved }: Props) {
  const platform = source.chart.platformProfile;
  const flickOk = flickAllowed(platform);
  const parentNotes = useMemo(() => {
    if (source.origin !== "MANUAL_EDITED") return source.chart.notes;
    return bundle.charts.find((chart) => chart.id === source.parentChartId)?.chart.notes ?? null;
  }, [bundle.charts, source]);

  const [history, setHistory] = useState<EditorHistory>(() => createHistory(fromChartNotes(source.chart.notes)));
  const [preview, setPreview] = useState<EditorState | null>(null);
  const present = preview ?? history.present;
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [snap, setSnap] = useState<SnapDivision>(source.difficulty.toLowerCase() === "extreme" ? 32 : 16);
  const [zoom, setZoom] = useState(260);
  const [viewTime, setViewTime] = useState(() => Math.max(0, (source.chart.notes[0]?.time ?? 0) - 0.5));
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [savedChart, setSavedChart] = useState<LibraryChart | null>(source.origin === "MANUAL_EDITED" ? source : null);
  const [savedNotes, setSavedNotes] = useState(() => source.chart.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [laneHeight, setLaneHeight] = useState(480);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const chartNotes = useMemo(() => toChartNotes(present), [present]);
  const noteTimes = useMemo(() => present.notes.map((note) => note.time), [present]);
  const grid: GridContext = useMemo(() => ({ bpm: source.chart.bpm, noteTimes, offset: source.chart.offset }), [source.chart.bpm, source.chart.offset, noteTimes]);
  const duration = Math.max(bundle.song.durationSec || 0, mediaDuration);
  const lastNoteEnd = present.notes.reduce((end, note) => Math.max(end, note.time + (note.duration ?? 0)), 0);
  const timelineEnd = Math.max(duration, lastNoteEnd + 2, 5);
  const validation = useMemo(() => validatePlayability(chartNotes, { platformProfile: platform, difficulty: source.difficulty, durationSec: duration }), [chartNotes, platform, source.difficulty, duration]);
  const sameAsParent = parentNotes ? notesEqual(parentNotes, chartNotes) : false;
  const dirty = !notesEqual(savedNotes, chartNotes);
  const mediaUrls = useMemo(() => [media.url, ...media.audioFallbackUrls], [media]);
  const mediaKind = mediaIndex === 0 ? bundle.song.mediaKind : "audio";
  const stepSec = snap === 0 ? 0.01 : gridStepSec(source.chart.bpm, snap);
  const selectedNotes = present.notes.filter((note) => selection.has(note.id));
  const single = selectedNotes.length === 1 ? selectedNotes[0] : null;

  const apply = useCallback((update: (state: EditorState) => EditorState) => {
    setHistory((current) => commit(current, update(current.present)));
  }, []);

  // Lane area height drives the time<->pixel mapping.
  useEffect(() => {
    const node = lanesRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.height > 0) setLaneHeight(entry.contentRect.height); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [testing]);

  const playheadY = laneHeight * PLAYHEAD_RATIO;
  const viewStart = viewTime - (laneHeight - playheadY) / zoom;
  const viewEnd = viewTime + playheadY / zoom;
  const yOf = (time: number) => playheadY - (time - viewTime) * zoom;
  const timeAtY = (y: number) => viewTime + (playheadY - y) / zoom;

  // Playback clock: the editor view follows the media while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const loop = () => {
      const node = mediaRef.current;
      if (node) {
        const t = node.currentTime;
        if (follow) setViewTime(t);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, follow]);

  useEffect(() => {
    const node = mediaRef.current;
    if (node) node.volume = Math.max(0, Math.min(1, audioSettings.masterVolume * audioSettings.musicVolume));
  }, [audioSettings, mediaIndex, testing]);

  const pause = useCallback(() => { mediaRef.current?.pause(); setPlaying(false); }, []);
  const togglePlay = useCallback(() => {
    const node = mediaRef.current;
    if (!node) return;
    if (playing) { pause(); return; }
    try { node.currentTime = Math.max(0, viewTime); } catch { /* not seekable yet */ }
    setFollow(true);
    void Promise.resolve(node.play()).then(() => setPlaying(true)).catch(() => { setPlaying(false); setError("미디어를 재생할 수 없습니다."); });
  }, [playing, pause, viewTime]);

  const seek = useCallback((time: number) => {
    const next = Math.max(0, Math.min(timelineEnd, time));
    setViewTime(next);
    const node = mediaRef.current;
    if (node) { try { node.currentTime = next; } catch { /* not seekable yet */ } }
  }, [timelineEnd]);

  const goToPlayhead = () => {
    const node = mediaRef.current;
    setFollow(true);
    if (node) setViewTime(node.currentTime);
  };

  const defaultHold = Math.max(MIN_HOLD_SEC, snap === 0 ? 0.5 : gridStepSec(source.chart.bpm, 4));

  const addAt = useCallback((lane: Lane, rawTime: number, type: NoteType) => {
    if (type === "flick" && !flickOk) { setError("PC(Desktop) 채보에는 Flick을 만들 수 없습니다."); return; }
    const time = snapTime(rawTime, snap, grid);
    const note = { time, lane, type, duration: defaultHold };
    const result = addNote(history.present, note);
    // A second event in the same frame sees a stale closure; re-apply onto the newest state instead of dropping it.
    setHistory((current) => commit(current, current === history ? result.state : addNote(current.present, note).state));
    if (result.id !== null) setSelection(new Set([result.id]));
  }, [flickOk, snap, grid, defaultHold, history]);

  const deleteSelection = useCallback(() => {
    if (selection.size === 0) return;
    apply((state) => deleteNotes(state, selection));
    setSelection(new Set());
  }, [apply, selection]);

  const nudge = useCallback((deltaSec: number, deltaLane: number) => {
    if (selection.size === 0) return;
    apply((state) => moveNotes(state, selection, deltaSec, deltaLane));
  }, [apply, selection]);

  const doUndo = useCallback(() => { setPreview(null); setHistory(undo); }, []);
  const doRedo = useCallback(() => { setPreview(null); setHistory(redo); }, []);

  // Keyboard: Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y), Delete, Space, arrows, D F J K = add at playhead.
  useEffect(() => {
    if (testing) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && key === "y") { event.preventDefault(); doRedo(); return; }
      if (mod) return;
      if (key === "delete" || key === "backspace") { event.preventDefault(); deleteSelection(); return; }
      if (key === " ") { event.preventDefault(); togglePlay(); return; }
      if (key === "escape") { setSelection(new Set()); return; }
      if (key === "arrowup" || key === "arrowdown") { event.preventDefault(); nudge(key === "arrowup" ? stepSec : -stepSec, 0); return; }
      if (key === "arrowleft" || key === "arrowright") { event.preventDefault(); nudge(0, key === "arrowright" ? 1 : -1); return; }
      if (key in KEY_LANES && !event.repeat) {
        event.preventDefault();
        const node = mediaRef.current;
        const at = playing && node ? node.currentTime : viewTime;
        addAt(KEY_LANES[key], at, tool === "hold" || tool === "flick" ? tool : "tap");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [testing, doUndo, doRedo, deleteSelection, togglePlay, nudge, stepSec, addAt, playing, viewTime, tool]);

  // Pointer editing on the lane area.
  const pointerInfo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width || 1;
    const lane = Math.max(0, Math.min(3, Math.floor(((event.clientX - rect.left) / width) * 4))) as Lane;
    return { lane, time: timeAtY(event.clientY - rect.top), y: event.clientY - rect.top, rect };
  };

  const onLanePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const { lane, time, y } = pointerInfo(event);
    const tolerance = 10 / zoom;
    const hit = findNoteAt(history.present, lane, time, tolerance);
    if (tool === "erase") { if (hit) { apply((state) => deleteNotes(state, new Set([hit.id]))); setSelection(new Set()); } return; }
    if (!hit && tool !== "select") { addAt(lane, time, tool); return; }
    if (playing) pause();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!hit) {
      setSelection(new Set());
      drag.current = { pointerId: event.pointerId, mode: "pan", startY: y, startX: event.clientX, startView: viewTime, base: history.present, anchorId: null, anchorTime: 0, anchorLane: 0, anchorDuration: 0, ids: new Set(), moved: false };
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const nextSelection = additive ? new Set(selection) : selection.has(hit.id) ? new Set(selection) : new Set([hit.id]);
    if (additive && selection.has(hit.id)) nextSelection.delete(hit.id); else nextSelection.add(hit.id);
    setSelection(nextSelection);
    const tailY = hit.type === "hold" ? yOf(hit.time + (hit.duration ?? 0)) : null;
    const resize = tailY !== null && Math.abs(y - tailY) <= 12 && nextSelection.size === 1;
    drag.current = { pointerId: event.pointerId, mode: resize ? "resize" : "move", startY: y, startX: event.clientX, startView: viewTime, base: history.present,
      anchorId: hit.id, anchorTime: hit.time, anchorLane: hit.lane, anchorDuration: hit.duration ?? 0, ids: nextSelection.has(hit.id) ? nextSelection : new Set([hit.id]), moved: false };
  };

  const onLanePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const { lane, y } = pointerInfo(event);
    const dy = y - current.startY;
    if (Math.abs(dy) > 3 || Math.abs(event.clientX - current.startX) > 3) current.moved = true;
    if (!current.moved) return;
    if (current.mode === "pan") { setFollow(false); setViewTime(Math.max(0, current.startView + dy / zoom)); return; }
    if (current.mode === "resize") {
      const tail = snapTime(current.anchorTime + current.anchorDuration - dy / zoom, snap, grid);
      setPreview(resizeHolds(current.base, new Set([current.anchorId!]), { set: tail - current.anchorTime }));
      return;
    }
    const targetTime = snapTime(current.anchorTime - dy / zoom, snap, grid);
    setPreview(moveNotes(current.base, current.ids, targetTime - current.anchorTime, lane - current.anchorLane));
  };

  const onLanePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (preview) { const next = preview; setPreview(null); setHistory((h) => commit(h, next)); }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) { setZoom((value) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))); return; }
    setFollow(false);
    setViewTime((value) => Math.max(0, Math.min(timelineEnd, value - event.deltaY / zoom)));
  };

  async function save() {
    if (saving) return;
    if (sameAsParent) { setError("원본과 같은 채보입니다. 노트를 수정한 뒤 저장해 주세요."); return; }
    if (!validation.ok && !window.confirm(`ERROR ${validation.errors}개가 있습니다. 이 상태로는 공유할 수 없지만 로컬에는 저장할 수 있습니다. 저장할까요?`)) return;
    setSaving(true); setError(null);
    try {
      const saved = await saveEditedChart({
        songId: bundle.song.id,
        chartId: savedChart?.id,
        parentChartId: savedChart ? undefined : source.id,
        notes: chartNotes,
        authorId: getAuthorIdentity().authorId,
      });
      setSavedChart(saved);
      setSavedNotes(saved.chart.notes);
      setMessage(`저장됨 · ${saved.label ?? "편집본"} v${saved.chartVersion}${validation.ok ? "" : " · ERROR가 있어 공유 불가"}`);
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setSaving(false); }
  }

  function exit() {
    if (dirty && !window.confirm("저장하지 않은 변경 사항이 있습니다. Maker를 나갈까요?")) return;
    pause();
    onExit();
  }

  // Android system Back inside the Maker leaves through the same unsaved-changes check as the header button.
  useEffect(() => {
    if (testing) return;
    const w = window as Window & { __beatdashBack?: () => boolean };
    const handler = () => { exit(); return true; };
    w.__beatdashBack = handler;
    return () => { if (w.__beatdashBack === handler) delete w.__beatdashBack; };
  });

  function startTest() {
    pause();
    if (chartNotes.length === 0) { setError("노트가 없어 테스트할 수 없습니다."); return; }
    setTesting((value) => value + 1);
  }

  const draftChart: Chart = useMemo(() => ({ ...source.chart, notes: chartNotes }), [source.chart, chartNotes]);

  if (testing) {
    return <main className="play-page play-fullscreen maker-test">
      <GameScreen playLabel="TEST PLAY · 기록 저장 안 함" onQuit={() => setTesting(0)} quitLabel="Maker로 돌아가기" key={`maker-test-${testing}`} chart={draftChart} songTitle={`${bundle.song.title} (TEST)`} mediaUrl={media.url} audioFallbackUrls={media.audioFallbackUrls}
        mediaKind={bundle.song.mediaKind} mediaMuted={false} noteSpeed={noteSpeed} timingOffsetMs={timingOffsetMs} audioSettings={audioSettings}
        preferences={preferences} onSongDetail={() => setTesting(0)} />
    </main>;
  }

  const visibleNotes = notesInRange(present, viewStart - 0.2, viewEnd + 0.2);
  const lines = gridLines(Math.max(0, viewStart), viewEnd, snap, grid);
  const firstIssue = validation.issues[0];

  return (
    <main className="maker-page" ref={rootRef} aria-label="Maker">
      <header className="maker-header">
        <button className="text-back" onClick={exit}>← 곡 상세</button>
        <div className="maker-title">
          <strong>{bundle.song.title}</strong>
          <span>{difficultyLabel(source.difficulty)} · Lv.{source.level} · {platform === "desktop" ? "PC · D F J K" : platform === "mobile" ? "Mobile" : "Legacy"} · {originLabel(savedChart?.origin ?? source.origin)}{savedChart ? ` · ${savedChart.label ?? ""} v${savedChart.chartVersion}` : " → 저장 시 새 편집본"}</span>
        </div>
        <span className={`maker-dirty ${dirty ? "on" : ""}`}>{dirty ? "● 변경됨" : "저장됨"}</span>
      </header>

      {error && <p className="maker-alert" role="alert">{error}<button onClick={() => setError(null)} aria-label="닫기">×</button></p>}
      {message && !error && <p className="maker-message" role="status">{message}</p>}

      <section className="maker-tools" aria-label="편집 도구">
        <div className="maker-segment" role="radiogroup" aria-label="도구">
          {(["select", "tap", "hold", "flick", "erase"] as Tool[]).map((item) => (
            <button key={item} role="radio" aria-checked={tool === item} className={tool === item ? "on" : ""} disabled={item === "flick" && !flickOk}
              title={item === "flick" && !flickOk ? "PC 채보는 Flick을 만들 수 없습니다" : undefined} onClick={() => setTool(item)}>
              {{ select: "선택", tap: "Note", hold: "Hold", flick: "Flick", erase: "Delete" }[item]}
            </button>
          ))}
        </div>
        <label className="maker-snap">Snap <select aria-label="Snap" value={snap} onChange={(event) => setSnap(Number(event.target.value) as SnapDivision)}>
          {SNAP_DIVISIONS.map((division) => <option key={division} value={division}>{snapLabel(division)}</option>)}
        </select></label>
        <div className="maker-zoom"><button aria-label="축소" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / 1.25))}>−</button><span>{Math.round(zoom)}px/s</span><button aria-label="확대" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * 1.25))}>＋</button></div>
      </section>

      <section className="maker-editor">
        <div className="maker-lanes" ref={lanesRef} data-testid="maker-lanes" onPointerDown={onLanePointerDown} onPointerMove={onLanePointerMove}
          onPointerUp={onLanePointerUp} onPointerCancel={onLanePointerUp} onWheel={onWheel}>
          {LANE_LABELS.map((label, lane) => <div key={label} className="maker-lane-column" style={{ left: `${lane * 25}%` }}><span>{label}</span></div>)}
          {lines.map((line) => <i key={line.time} className={`maker-grid ${line.strength}`} style={{ top: yOf(line.time) }} />)}
          {visibleNotes.map((note) => {
            const top = note.type === "hold" ? yOf(note.time + (note.duration ?? 0)) : yOf(note.time);
            const height = note.type === "hold" ? Math.max(8, (note.duration ?? 0) * zoom) : 0;
            return <div key={note.id} data-note-id={note.id} className={`maker-note ${note.type} lane-${note.lane} ${selection.has(note.id) ? "selected" : ""}`}
              style={{ left: `calc(${note.lane * 25}% + 4px)`, top: note.type === "hold" ? top : top - 7, height: note.type === "hold" ? height + 7 : 14 }}
              aria-label={`${note.type} ${LANE_LABELS[note.lane]} ${formatClock(note.time)}`} />;
          })}
          <div className="maker-playhead" style={{ top: playheadY }}><span>{formatClock(viewTime)}</span></div>
        </div>

        <aside className="maker-inspector" aria-label="선택한 노트">
          {selectedNotes.length === 0 ? <p className="maker-hint">노트를 눌러 선택하거나, Note/Hold 도구로 빈 곳을 눌러 추가하세요. 키보드 D F J K = 재생 위치에 추가.</p> : <>
            <strong>{selectedNotes.length}개 선택</strong>
            {single && <label>시간(초) <input aria-label="노트 시간" type="number" step={0.001} min={0} value={single.time} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) apply((state) => setNoteTime(state, single.id, value)); }} /></label>}
            <div className="maker-row"><span>시간</span><button aria-label="시간 앞으로" onClick={() => nudge(-stepSec, 0)}>−{snapLabel(snap)}</button><button aria-label="시간 뒤로" onClick={() => nudge(stepSec, 0)}>＋{snapLabel(snap)}</button></div>
            <div className="maker-row"><span>레인</span><button aria-label="레인 왼쪽" onClick={() => nudge(0, -1)}>◀</button>{single && <select aria-label="레인" value={single.lane} onChange={(event) => apply((state) => setNoteLane(state, single.id, Number(event.target.value)))}>{LANE_LABELS.map((label, lane) => <option key={label} value={lane}>{label}</option>)}</select>}<button aria-label="레인 오른쪽" onClick={() => nudge(0, 1)}>▶</button></div>
            <div className="maker-row"><span>종류</span>
              {(["tap", "hold", "flick"] as NoteType[]).map((type) => <button key={type} aria-label={`종류 ${type === "tap" ? "Tap" : type === "hold" ? "Hold" : "Flick"}`} disabled={type === "flick" && !flickOk} className={selectedNotes.every((note) => note.type === type) ? "on" : ""} onClick={() => apply((state) => setNoteType(state, selection, type, defaultHold, platform))}>{type === "tap" ? "Tap" : type === "hold" ? "Hold" : "Flick"}</button>)}
            </div>
            {selectedNotes.some((note) => note.type === "hold") && <div className="maker-row"><span>Hold 길이</span>
              <button aria-label="Hold 짧게" onClick={() => apply((state) => resizeHolds(state, selection, { delta: -Math.max(stepSec, 0.01) }))}>−</button>
              {single?.type === "hold" ? <input aria-label="Hold 길이(초)" type="number" step={0.001} min={MIN_HOLD_SEC} value={single.duration ?? 0} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) apply((state) => resizeHolds(state, selection, { set: value })); }} /> : <span>여러 개</span>}
              <button aria-label="Hold 길게" onClick={() => apply((state) => resizeHolds(state, selection, { delta: Math.max(stepSec, 0.01) }))}>＋</button></div>}
            <button className="maker-danger" onClick={deleteSelection}>선택 삭제</button>
          </>}
          <div className="maker-validation">
            <button className={`maker-validation-summary ${validation.errors ? "has-error" : validation.warnings ? "has-warning" : "ok"}`} onClick={() => setShowIssues((value) => !value)} aria-expanded={showIssues}>
              검사 · ERROR {validation.errors} · WARNING {validation.warnings}
            </button>
            {!showIssues && firstIssue && <small>{firstIssue.severity}: {firstIssue.message}</small>}
            {showIssues && <ul>{validation.issues.slice(0, 80).map((issue, index) => <li key={`${issue.code}-${index}`} className={issue.severity.toLowerCase()}>
              <button onClick={() => { if (issue.time !== undefined) { setFollow(false); seek(issue.time); } }}>{issue.severity} · {issue.time !== undefined ? formatClock(issue.time) : "전체"} · {issue.message}</button>
            </li>)}</ul>}
          </div>
        </aside>
      </section>

      <section className="maker-lane-buttons" aria-label="재생 위치에 노트 추가">
        {LANE_LABELS.map((label, lane) => <button key={label} onClick={() => addAt(lane as Lane, playing && mediaRef.current ? mediaRef.current.currentTime : viewTime, tool === "hold" || tool === "flick" ? tool : "tap")}>＋ {label}</button>)}
      </section>

      <section className="maker-transport" aria-label="타임라인">
        <button className="maker-play" aria-label={playing ? "일시정지" : "재생"} onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
        <output className="maker-clock" aria-label="현재 위치">{formatClock(viewTime)}</output>
        <input className="maker-scrub" aria-label="타임라인" type="range" min={0} max={timelineEnd} step={0.001} value={Math.min(viewTime, timelineEnd)} onChange={(event) => { setFollow(false); seek(Number(event.target.value)); }} />
        <button onClick={goToPlayhead}>현재 위치로</button>
      </section>

      <section className="maker-actions" aria-label="저장">
        <button aria-label="Undo" disabled={!canUndo(history)} onClick={doUndo}>↶ Undo</button>
        <button aria-label="Redo" disabled={!canRedo(history)} onClick={doRedo}>↷ Redo</button>
        <button className="maker-test-button" onClick={startTest}>TEST PLAY</button>
        <button className="maker-save" disabled={saving || !dirty || sameAsParent} onClick={() => void save()} title={sameAsParent ? "원본과 같습니다" : undefined}>{saving ? "저장 중…" : sameAsParent ? "변경 없음" : "SAVE"}</button>
      </section>

      {mediaKind === "video"
        ? <video key={mediaIndex} ref={(node) => { mediaRef.current = node; }} className="maker-media" src={mediaUrls[mediaIndex]} preload="auto" playsInline
            onLoadedMetadata={(event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)}
            onError={() => { if (mediaIndex < mediaUrls.length - 1) setMediaIndex((value) => value + 1); else setError("미디어를 불러올 수 없습니다. 편집은 계속할 수 있습니다."); }} />
        : <audio key={mediaIndex} ref={(node) => { mediaRef.current = node; }} className="maker-media" src={mediaUrls[mediaIndex]} preload="auto"
            onLoadedMetadata={(event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)}
            onError={() => { if (mediaIndex < mediaUrls.length - 1) setMediaIndex((value) => value + 1); else setError("미디어를 불러올 수 없습니다. 편집은 계속할 수 있습니다."); }} />}
    </main>
  );
}
