import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Chart, Lane, NoteRuntime } from "../types/chart";
import {
  attemptFlick,
  attemptHoldRelease,
  attemptLanePress,
  createInitialGameState,
  restartGame,
  tick,
  type GameOptions,
  type GameState,
} from "../engine/gameState";
import { computeResult } from "../engine/resultCalculation";
import { useInputManager } from "../engine/inputManager";
import { useGameLoop } from "../hooks/useGameLoop";
import { getCurrentTimeSec, pauseVideo, playVideo, restartVideo } from "../engine/videoSync";
import { CANVAS_WIDTH, CANVAS_HEIGHT, JUDGE_LINE_Y } from "../engine/highway";
import { LANE_KEYS, GAUGE_CONFIG } from "../constants/config";
import { DEFAULT_NOTE_SPEED, getGameplayLookaheadSec, normalizeNoteSpeed } from "../settings/noteSpeed";
import { applyTimingOffsetSec, DEFAULT_TIMING_OFFSET_MS, normalizeTimingOffsetMs } from "../settings/timingOffset";
import { NoteFieldCanvas } from "./NoteFieldCanvas";
import { PauseOverlay } from "./PauseOverlay";
import { ResultScreen } from "./ResultScreen";
import type { GameResult } from "../engine/resultCalculation";
import { getClearType } from "../library/model";
import type { RecordFeedback } from "../library/types";
import { DEFAULT_AUDIO_SETTINGS, playHitSfx, playPerfectComboSfx, playFullComboSfx, playStartSfx, playNoticeSfx, type AudioSettings } from "../audio/sfx";

interface Props {
  chart: Chart;
  mediaUrl: string;
  mediaKind?: "audio" | "video";
  mediaMuted?: boolean;
  requireStartGesture?: boolean;
  resultExtra?: ReactNode;
  /** 1.0~20.0. 시각적 스크롤만 바꾸고 chart/media/judgement time은 바꾸지 않는다. */
  noteSpeed?: number;
  /** -300~+300ms. +값은 채보/판정을 늦추고, -값은 앞당긴다. */
  timingOffsetMs?: number;
  audioSettings?: AudioSettings;
  onResult?: (result: GameResult) => RecordFeedback | void | Promise<RecordFeedback | void>;
}

interface MvOptions {
  on: boolean;
  brightness: number;
  overlayOpacity: number;
  blurPx: number;
}

const LANE_COUNT = 4;

function isNoteActive(note: NoteRuntime, currentTimeSec: number, noteSpeed: number): boolean {
  if (note.status !== "pending" && note.status !== "holding") return false;
  const endTime = note.note.type === "hold" ? note.note.time + note.note.duration : note.note.time;
  return note.note.time - currentTimeSec <= getGameplayLookaheadSec(noteSpeed) && endTime >= currentTimeSec - 0.5;
}

export function GameScreen({
  chart,
  mediaUrl,
  mediaKind = "video",
  mediaMuted = true,
  requireStartGesture = false,
  resultExtra,
  noteSpeed = DEFAULT_NOTE_SPEED,
  timingOffsetMs = DEFAULT_TIMING_OFFSET_MS,
  audioSettings = DEFAULT_AUDIO_SETTINGS,
  onResult,
}: Props) {
  const lockedNoteSpeed = normalizeNoteSpeed(noteSpeed);
  const lockedTimingOffsetMs = normalizeTimingOffsetMs(timingOffsetMs);
  const [options] = useState<GameOptions>({ failEnabled: false });
  const [state, setState] = useState<GameState>(() => createInitialGameState(chart, options));
  const [mediaError, setMediaError] = useState<string | null>(null);
  const playGeneration = useRef(0);
  const [paused, setPaused] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(() => applyTimingOffsetSec(0, lockedTimingOffsetMs));
  const [gameStarted, setGameStarted] = useState(!requireStartGesture);
  const [mv, setMv] = useState<MvOptions>({ on: true, brightness: 0.4, overlayOpacity: 0.5, blurPx: 0 });
  const [pressedLanes, setPressedLanes] = useState<boolean[]>([false, false, false, false]);
  const [recordRetry, setRecordRetry] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const resultGeneration = useRef(0);
  const [recordFeedback, setRecordFeedback] = useState<RecordFeedback | null>(null);


  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const stateRef = useRef(state);
  const pausedRef = useRef(paused);
  const touchStarts = useRef(new Map<number, { y: number; flicked: boolean }>());
  const reportedResult = useRef(false);
  const resultSoundPlayed = useRef(false);
  const lastSfxSequence = useRef<number | null>(null);

  useEffect(() => () => { resultGeneration.current++; }, []);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const startMedia = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;
    const generation = ++playGeneration.current;
    setMediaError(null);
    try {
      await playVideo(media);
      if (generation !== playGeneration.current) return;
      pausedRef.current = false;
      setPaused(false);
      setGameStarted(true);
    } catch (error) {
      if (generation !== playGeneration.current) return;
      pausedRef.current = true;
      setPaused(true);
      setMediaError(`재생할 수 없습니다. ${(error as Error).message}`);
    }
  }, []);

  const cancelPlayback = useCallback(() => { playGeneration.current++; }, []);
  useEffect(() => {
    let cancelled = false;
    const media = mediaRef.current;
    // Defer autoplay so StrictMode cleanup can cancel the first mount attempt.
    void Promise.resolve().then(() => { if (!cancelled && !requireStartGesture) void startMedia(); });
    return () => { cancelled = true; cancelPlayback(); pauseVideo(media); };
  }, [requireStartGesture, startMedia, cancelPlayback]);

  const loopActive = gameStarted && !state.finished;

  useGameLoop(() => {
    if (pausedRef.current) return;
    const media = mediaRef.current;
    const mediaTimeSec = getCurrentTimeSec(media);
    const chartTimeSec = applyTimingOffsetSec(mediaTimeSec, lockedTimingOffsetMs);
    setCurrentTimeSec(chartTimeSec);
    const ended = !!media && media.ended;
    setState((s) => tick(s, ended ? Number.POSITIVE_INFINITY : chartTimeSec));
  }, loopActive);

  const handleStart = useCallback(() => { playStartSfx(audioSettings); void startMedia(); }, [startMedia, audioSettings]);

  const pauseGame = useCallback(() => {
    playGeneration.current++;
    pausedRef.current = true;
    setPaused(true);
    pauseVideo(mediaRef.current);
    // A paused hold requires a fresh press on resume; it cannot auto-clear hands-free.
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => ([0, 1, 2, 3] as Lane[]).reduce((next, lane) => attemptHoldRelease(next, lane, t), s));
    touchStarts.current.clear();
    setPressedLanes([false, false, false, false]);
  }, [lockedTimingOffsetMs]);

  const handlePauseToggle = useCallback(() => {
    if (!gameStarted || stateRef.current.finished) return;
    if (pausedRef.current) void startMedia();
    else pauseGame();
  }, [gameStarted, startMedia, pauseGame]);

  useEffect(() => {
    const hide = () => { if (document.hidden && gameStarted) pauseGame(); };
    const blur = () => { if (gameStarted) pauseGame(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", blur);
    window.addEventListener("beatdash:pause", blur);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", blur);
      window.removeEventListener("beatdash:pause", blur);
    };
  }, [gameStarted, pauseGame]);

  const setLanePressed = useCallback((lane: Lane, pressed: boolean) => {
    setPressedLanes((prev) => {
      if (prev[lane] === pressed) return prev;
      const next = prev.slice();
      next[lane] = pressed;
      return next;
    });
  }, []);

  const handleLaneKeyDown = useCallback((lane: Lane) => {
    setLanePressed(lane, true);
    if (!gameStarted || pausedRef.current || stateRef.current.failed || stateRef.current.finished) return;
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => attemptLanePress(s, lane, t));
  }, [gameStarted, lockedTimingOffsetMs, setLanePressed]);

  const handleLaneKeyUp = useCallback((lane: Lane) => {
    setLanePressed(lane, false);
    if (!gameStarted || pausedRef.current || stateRef.current.failed || stateRef.current.finished) return;
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => attemptHoldRelease(s, lane, t));
  }, [gameStarted, lockedTimingOffsetMs, setLanePressed]);

  const handleFlick = useCallback((lane: Lane) => {
    if (!gameStarted || pausedRef.current || stateRef.current.failed || stateRef.current.finished) return;
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => attemptFlick(s, lane, t));
  }, [gameStarted, lockedTimingOffsetMs]);

  const inputCallbacks = useMemo(() => ({
    onLaneKeyDown: handleLaneKeyDown,
    onLaneKeyUp: handleLaneKeyUp,
    onFlick: handleFlick,
    onPauseToggle: handlePauseToggle,
  }), [handleLaneKeyDown, handleLaneKeyUp, handleFlick, handlePauseToggle]);

  useInputManager(inputCallbacks, gameStarted && !state.finished, paused);

  const handleRestart = useCallback(() => {
    playGeneration.current++;
    pausedRef.current = false;
    setMediaError(null);
    touchStarts.current.clear();
    setState((s) => restartGame(s));
    setPaused(false);
    setCurrentTimeSec(applyTimingOffsetSec(0, lockedTimingOffsetMs));
    setPressedLanes([false, false, false, false]);
    resultGeneration.current++;
    lastSfxSequence.current = null;
    setRecordError(null);
    setRecordFeedback(null);
    reportedResult.current = false;
    resultSoundPlayed.current = false;
    restartVideo(mediaRef.current);
    if (requireStartGesture) setGameStarted(false);
    else {
      void startMedia();
    }
  }, [lockedTimingOffsetMs, requireStartGesture, startMedia]);

  useEffect(() => {
    if (state.finished) pauseVideo(mediaRef.current);
  }, [state.finished]);

  const activeNotes = useMemo(
    () => state.notes.filter((n) => isNoteActive(n, currentTimeSec, lockedNoteSpeed)),
    [state.notes, currentTimeSec, lockedNoteSpeed]
  );
  const result = useMemo(() => computeResult(state), [state]);

  useEffect(() => {
    const media = mediaRef.current;
    if (media) media.volume = Math.max(0, Math.min(1, audioSettings.masterVolume * audioSettings.musicVolume));
  }, [audioSettings]);

  useEffect(() => {
    const feedback = state.lastFeedback;
    if (!feedback || feedback.sequence === lastSfxSequence.current) return;
    lastSfxSequence.current = feedback.sequence;
    if (feedback.phase === "hold_complete") playHitSfx(audioSettings, "hold");
    else if (feedback.noteType === "flick" && feedback.judgement !== "Miss") playHitSfx(audioSettings, "flick");
    else playHitSfx(audioSettings, feedback.judgement.toLowerCase() as "perfect" | "great" | "good" | "miss");
  }, [state.lastFeedback, audioSettings]);

  useEffect(() => {
    if (!state.finished || resultSoundPlayed.current) return;
    resultSoundPlayed.current = true;
    const clear = getClearType(result);
    if (clear === "PERFECT_COMBO") playPerfectComboSfx(audioSettings);
    else if (clear === "FULL_COMBO") playFullComboSfx(audioSettings);
    else playNoticeSfx(audioSettings, "result");
  }, [state.finished, result, audioSettings]);

  useEffect(() => {
    if (!state.finished || reportedResult.current || !onResult) return;
    reportedResult.current = true;
    const generation = resultGeneration.current;
    void Promise.resolve().then(() => onResult(result)).then((feedback) => {
      if (!feedback || generation !== resultGeneration.current) return;
      setRecordFeedback(feedback);
      if (feedback.newHighScore || feedback.newAccuracyBest || feedback.newComboBest) {
        setTimeout(() => { if (generation === resultGeneration.current) playNoticeSfx(audioSettings, "best"); }, 550);
      }
    }).catch((error: Error) => { if (generation === resultGeneration.current) setRecordError(`기록 저장 실패: ${error.message}`); });
  }, [state.finished, result, onResult, audioSettings, recordRetry]);

  useEffect(() => {
    (window as unknown as { __RHYTHM_DEBUG__?: unknown }).__RHYTHM_DEBUG__ = {
      state,
      currentTimeSec,
      paused,
      gameStarted,
      noteSpeed: lockedNoteSpeed,
      timingOffsetMs: lockedTimingOffsetMs,
    };
  }, [state, currentTimeSec, paused, gameStarted, lockedNoteSpeed, lockedTimingOffsetMs]);

  const videoFilter = `brightness(${mv.brightness}) blur(${mv.blurPx}px)`;
  const mediaNode = mediaKind === "audio" ? (
    <audio ref={(node) => { mediaRef.current = node; }} src={mediaUrl} onError={() => { pauseGame(); setMediaError("오디오 파일을 재생할 수 없습니다."); }} preload="auto" />
  ) : (
    <video
      ref={(node) => { mediaRef.current = node; }}
      src={mediaUrl}
      onError={() => { pauseGame(); setMediaError("영상 파일을 재생할 수 없습니다."); }}
      muted={mediaMuted}
      playsInline
      preload="auto"
      style={mv.on ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: videoFilter } : { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0 }}
    />
  );

  const gaugePercent = Math.max(0, Math.min(100, (state.gauge / GAUGE_CONFIG.MAX) * 100));
  const feedback = state.lastFeedback;
  const timingWord = feedback && (feedback.judgement === "Great" || feedback.judgement === "Good") && feedback.diffMs !== null
    ? (feedback.diffMs < 0 ? "FAST" : "SLOW")
    : null;
  const timingMs = feedback?.diffMs !== null && feedback?.diffMs !== undefined
    ? `${feedback.diffMs >= 0 ? "+" : ""}${Math.round(feedback.diffMs)} ms`
    : null;
  const feedbackLabel = feedback?.phase === "hold_complete"
    ? "HOLD CLEAR"
    : feedback?.phase === "hold_break"
      ? "HOLD BREAK"
      : feedback?.judgement ?? null;

  return (
    <div className="game-screen">
      <div className="game-meta-row">
        <div className="game-song-meta">
          <strong>{chart.title}</strong>
          <span>{chart.artist}</span>
        </div>
        <div className="game-chart-meta">
          <span>{chart.difficulty} · Lv.{chart.level}</span>
          <span>Speed {lockedNoteSpeed.toFixed(1)}</span>
          {lockedTimingOffsetMs !== 0 && <span>Offset {lockedTimingOffsetMs > 0 ? "+" : ""}{lockedTimingOffsetMs}ms</span>}
        </div>
      </div>

      <div className={`stage ${mediaKind === "audio" ? "audio-stage" : ""}`}>
        {mediaNode}
        {mediaKind === "video" && <div className="mv-overlay" style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${mv.overlayOpacity})` }} />}
        {mediaKind === "audio" && <div className="audio-backdrop"><span>AI CHART</span><b>{Math.round(chart.bpm)} BPM</b></div>}

        <div className="game-hud game-hud-left">
          <span className="hud-label">SCORE</span>
          <strong>{result.score.toLocaleString()}</strong>
          <span className="hud-accuracy">ACC {result.accuracyPercent.toFixed(2)}%</span>
        </div>

        <div className="game-hud game-hud-right">
          <div className="hud-gauge-row">
            <span>GAUGE</span><b>{Math.round(state.gauge)}</b>
          </div>
          <div className="hud-gauge-track"><i style={{ width: `${gaugePercent}%` }} /></div>
          <button
            className="pause-button"
            type="button"
            aria-label="일시정지"
            onClick={handlePauseToggle}
            disabled={!gameStarted || state.finished}
          >Ⅱ</button>
        </div>

        <div className="combo-display">
          {state.combo > 0 && <div className="combo-number">{state.combo}</div>}
          {state.combo > 0 && <div className="combo-label">COMBO</div>}
        </div>

        <div className="lane-input-feedback" aria-hidden="true">
          {pressedLanes.map((pressed, lane) => <i key={lane} className={pressed ? "pressed" : ""} />)}
        </div>

        {feedback && feedbackLabel && (
          <>
            <div key={`label-${feedback.sequence}`} className={`judgement-feedback judgement-pop ${feedback.judgement.toLowerCase()} ${feedback.phase}`}>
              <strong>{feedbackLabel}</strong>
              {timingWord && <span>{timingWord}{timingMs ? ` · ${timingMs}` : ""}</span>}
            </div>
            <div
              key={`effect-${feedback.sequence}`}
              className={`lane-hit-effect ${feedback.judgement.toLowerCase()} ${feedback.noteType} ${feedback.phase}`}
              style={{ left: `${2 + (feedback.lane + 0.5) * 24}%` }}
              aria-hidden="true"
            >
              <i className="effect-ring" />
              <i className="effect-core" />
              <i className="effect-mark" />
            </div>
          </>
        )}

        <div className="note-field-layer">
          <NoteFieldCanvas
            notes={activeNotes}
            currentTimeSec={currentTimeSec}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            judgeLineY={JUDGE_LINE_Y}
            laneCount={LANE_COUNT}
            noteSpeed={lockedNoteSpeed}
          />
        </div>

        {!state.finished && (
          <div className="touch-lanes">
            {([0, 1, 2, 3] as Lane[]).map((lane) => (
              <button
                key={lane}
                type="button"
                className={`touch-lane lane-${lane}`}
                onPointerDown={(e) => {
                  e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
                  touchStarts.current.set(e.pointerId, { y: e.clientY, flicked: false });
                  handleLaneKeyDown(lane);
                }}
                onPointerMove={(e) => {
                  const touch = touchStarts.current.get(e.pointerId);
                  if (touch && !touch.flicked && touch.y - e.clientY > 28) {
                    touch.flicked = true;
                    handleFlick(lane);
                  }
                }}
                onPointerUp={(e) => {
                  e.preventDefault(); touchStarts.current.delete(e.pointerId);
                  handleLaneKeyUp(lane);
                }}
                onPointerCancel={(e) => { touchStarts.current.delete(e.pointerId); handleLaneKeyUp(lane); }}
              >
                {LANE_KEYS[lane].toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {!gameStarted && !state.finished && (
          <div className="start-overlay">
            <div className="start-card">
              <span>READY</span>
              <strong>Speed {lockedNoteSpeed.toFixed(1)}</strong>
              {lockedTimingOffsetMs !== 0 && <span className="start-offset">Offset {lockedTimingOffsetMs > 0 ? "+" : ""}{lockedTimingOffsetMs}ms</span>}
              <button onClick={handleStart}>START</button>
              <small>키보드 D F J K · Flick: 레인 키 + Space · 터치: 누르기/홀드, 위로 밀기 = Flick</small>
            </div>
          </div>
        )}
        {mediaError && <div className="media-error" role="alert"><p>{mediaError}</p><button onClick={() => { mediaRef.current?.load(); void startMedia(); }}>재생 다시 시도</button></div>}
        {paused && <PauseOverlay onResume={handlePauseToggle} onRestart={handleRestart} />}
      </div>

      {mediaKind === "video" && (
        <details className="visual-options">
          <summary>MV / Visual settings</summary>
          <div className="mv-options">
            <label><input type="checkbox" checked={mv.on} onChange={(e) => setMv((m) => ({ ...m, on: e.target.checked }))} /> MV</label>
            <label>밝기 <input type="range" min={0} max={1} step={0.05} value={mv.brightness} onChange={(e) => setMv((m) => ({ ...m, brightness: Number(e.target.value) }))} /></label>
            <label>오버레이 <input type="range" min={0} max={1} step={0.05} value={mv.overlayOpacity} onChange={(e) => setMv((m) => ({ ...m, overlayOpacity: Number(e.target.value) }))} /></label>
            <label>블러 <input type="range" min={0} max={10} step={1} value={mv.blurPx} onChange={(e) => setMv((m) => ({ ...m, blurPx: Number(e.target.value) }))} /></label>
          </div>
        </details>
      )}

      {state.finished && (
        <>
          {recordError && <div role="alert">{recordError}<button onClick={() => { reportedResult.current = false; setRecordError(null); setRecordRetry((value) => value + 1); }}>기록 저장 다시 시도</button></div>}
          <ResultScreen result={result} onRestart={handleRestart} feedback={recordFeedback} />
          {resultExtra && (
            <details className="result-extra">
              <summary>Rate AI Chart</summary>
              {resultExtra}
            </details>
          )}
        </>
      )}
    </div>
  );
}
