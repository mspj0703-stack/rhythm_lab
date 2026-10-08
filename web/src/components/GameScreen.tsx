import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PREFERENCES, supportsVibration, type Preferences } from "../settings/preferences";
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
import { playMediaWithTimeout, reloadMediaAtTime } from "../engine/mediaRecovery";
import { buildMediaPlan, describeMediaSource } from "../engine/mediaSources";
import { computeResult } from "../engine/resultCalculation";
import { useInputManager } from "../engine/inputManager";
import { useGameLoop } from "../hooks/useGameLoop";
import { getCurrentTimeSec, pauseVideo, restartVideo } from "../engine/videoSync";
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
  preferences?: Preferences;
  onLibrary?: () => void;
  onSongDetail?: () => void;
  songTitle?: string;
  chart: Chart;
  mediaUrl: string;
  mediaKind?: "audio" | "video";
  mediaMuted?: boolean;
  /** Audio-only sources tried in order when the MV/video cannot be loaded. Empty = no fallback. */
  audioFallbackUrls?: string[];
  /** Lets the owner re-acquire the media source (e.g. a fresh object URL) when the user presses retry. */
  onRetryMedia?: () => void;
  resultExtra?: ReactNode;
  /** 1.0~20.0. 시각적 스크롤만 바꾸고 chart/media/judgement time은 바꾸지 않는다. */
  noteSpeed?: number;
  /** -300~+300ms. +값은 채보/판정을 늦추고, -값은 앞당긴다. */
  timingOffsetMs?: number;
  audioSettings?: AudioSettings;
  onResult?: (result: GameResult) => RecordFeedback | void | Promise<RecordFeedback | void>;
}

type StartupPhase = "preparing" | "countdown" | "playing";

interface MvOptions {
  on: boolean;
  brightness: number;
  overlayOpacity: number;
  blurPx: number;
}

const LANE_COUNT = 4;

/** Safe, id-free description of why a media source failed (shown with the retry message for device debugging). */
function describeFailure(media: HTMLMediaElement | null, source: { url: string; kind: string }, reason: string): string {
  const code = media?.error?.code ?? "-";
  return `${reason} · code=${code} net=${media?.networkState ?? "-"} ready=${media?.readyState ?? "-"} ${source.kind} ${describeMediaSource(source.url)}`;
}

function isNoteActive(note: NoteRuntime, currentTimeSec: number, noteSpeed: number): boolean {
  if (note.status !== "pending" && note.status !== "holding") return false;
  const endTime = note.note.type === "hold" ? note.note.time + note.note.duration : note.note.time;
  return note.note.time - currentTimeSec <= getGameplayLookaheadSec(noteSpeed) && endTime >= currentTimeSec - 0.5;
}

export function GameScreen({
  chart, songTitle,
  mediaUrl,
  mediaKind = "video",
  mediaMuted = true,
  audioFallbackUrls,
  onRetryMedia,
  resultExtra,
  noteSpeed = DEFAULT_NOTE_SPEED,
  timingOffsetMs = DEFAULT_TIMING_OFFSET_MS,
  audioSettings = DEFAULT_AUDIO_SETTINGS,
  onResult,
  preferences = DEFAULT_PREFERENCES,
  onLibrary, onSongDetail,
}: Props) {
  const lockedNoteSpeed = normalizeNoteSpeed(noteSpeed);
  const lockedTimingOffsetMs = normalizeTimingOffsetMs(timingOffsetMs);
  const [options] = useState<GameOptions>({ failEnabled: false });
  const [state, setState] = useState<GameState>(() => createInitialGameState(chart, options));
  const [mediaError, setMediaError] = useState<string | null>(null);
  const playGeneration = useRef(0);
  const [paused, setPaused] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(() => applyTimingOffsetSec(0, lockedTimingOffsetMs));
  const [gameStarted, setGameStarted] = useState(false);
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("preparing");
  const [mediaPrepared, setMediaPrepared] = useState(false);
  const [lifecycleBlocked, setLifecycleBlocked] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(3);
  // Media source state machine: sourceIndex 0 = stored MV/audio, >0 = audio-only fallbacks.
  // LOADING -> READY, or LOADING -> RECOVERING (one bounded reload) -> AUDIO_ONLY -> READY, FATAL only when no source is left.
  const plan = useMemo(() => buildMediaPlan(mediaUrl, mediaKind, audioFallbackUrls ?? []), [mediaUrl, mediaKind, audioFallbackUrls]);
  const planKey = plan.map((candidate) => `${candidate.kind}:${candidate.url}`).join("|");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [mediaSession, setMediaSession] = useState(0);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [mediaDiagnostic, setMediaDiagnostic] = useState<string | null>(null);
  const activeSource = plan[Math.min(sourceIndex, plan.length - 1)];
  const effectiveKind = activeSource.kind;
  const hasNextSource = sourceIndex < plan.length - 1;
  const sourceIndexRef = useRef(0);
  const handledFailures = useRef(new Set<string>());
  const resumeAfterSwitch = useRef(false);
  const latestMedia = useRef<HTMLMediaElement | null>(null);
  const advanceSourceRef = useRef<(reason: string, resume: boolean) => boolean>(() => false);
  const [mv, setMv] = useState<MvOptions>({ on: preferences.backgroundVideo, brightness: preferences.backgroundBrightness, overlayOpacity: 0.5, blurPx: 0 });
  const [pressedLanes, setPressedLanes] = useState<boolean[]>([false, false, false, false]);
  const [songEnded, setSongEnded] = useState(false);
  const [showResult, setShowResult] = useState(false);
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
  const mediaRecoveryTimer = useRef<number | null>(null);
  const startupGeneration = useRef(0);
  const recoveryAbort = useRef<AbortController | null>(null);
  const recoveryPosition = useRef<number | null>(null);
  const recoveryAttempts = useRef(0);
  const clearMediaRecovery = useCallback(() => {
    if (mediaRecoveryTimer.current !== null) window.clearTimeout(mediaRecoveryTimer.current);
    mediaRecoveryTimer.current = null;
  }, []);
  const cancelMediaRecovery = useCallback(() => {
    clearMediaRecovery();
    recoveryAbort.current?.abort();
    recoveryAbort.current = null;
  }, [clearMediaRecovery]);

  useEffect(() => () => { resultGeneration.current++; }, []);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const startMedia = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;
    cancelMediaRecovery();
    const generation = ++playGeneration.current;
    const controller = new AbortController();
    recoveryAbort.current = controller;
    setMediaError(null);
    try {
      if (recoveryPosition.current !== null) await reloadMediaAtTime(media, recoveryPosition.current, controller.signal);
      if (generation !== playGeneration.current) return;
      await playMediaWithTimeout(media, controller.signal);
      if (generation !== playGeneration.current) return;
      pausedRef.current = false;
      setPaused(false);
      setGameStarted(true);
      setStartupPhase("playing");
      recoveryPosition.current = null;
      recoveryAttempts.current = 0;
    } catch (error) {
      if (generation !== playGeneration.current) return;
      // A source the browser cannot decode will never play: move on instead of asking for a manual retry.
      if ((error as Error).name === "NotSupportedError" && advanceSourceRef.current("재생할 수 없는 미디어", false)) return;
      pausedRef.current = false;
      setPaused(false);
      setStartupPhase("preparing");
      setMediaError(`재생할 수 없습니다. ${(error as Error).message}`);
    } finally { if (recoveryAbort.current === controller) recoveryAbort.current = null; }
  }, [cancelMediaRecovery]);

  const cancelPlayback = useCallback(() => { playGeneration.current++; cancelMediaRecovery(); }, [cancelMediaRecovery]);
  // Pause whichever element is live at unmount: Result -> RETRY and audio-only fallback both replace the element.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the ref must be read at unmount time, not captured at mount
  useEffect(() => () => { cancelPlayback(); pauseVideo(latestMedia.current); }, [cancelPlayback]);

  const lastPlanKey = useRef(planKey);
  useEffect(() => {
    if (lastPlanKey.current === planKey) return;
    lastPlanKey.current = planKey;
    /* oxlint-disable react-hooks/set-state-in-effect -- a new media plan (song change) must reset the session state */
    handledFailures.current.clear();
    sourceIndexRef.current = 0;
    setSourceIndex(0);
    setMediaSession((value) => value + 1);
    setMediaPrepared(false);
    setMediaNotice(null);
    /* oxlint-enable react-hooks/set-state-in-effect */
  }, [planKey]);

  const markMediaPrepared = useCallback(() => { setMediaPrepared(true); }, []);

  useEffect(() => {
    if (startupPhase !== "preparing" || !mediaPrepared || mediaError || lifecycleBlocked || gameStarted || showResult || pausedRef.current || document.hidden) return;
    setCountdown(3);
    setStartupPhase("countdown");
  }, [startupPhase, mediaPrepared, mediaError, lifecycleBlocked, gameStarted, showResult]);

  useEffect(() => {
    if (startupPhase !== "countdown" || gameStarted || showResult) return;
    const generation = ++startupGeneration.current;
    let value = 3;
    setCountdown(value);
    const timer = window.setInterval(() => {
      if (generation !== startupGeneration.current) { window.clearInterval(timer); return; }
      if (document.hidden) { window.clearInterval(timer); setCountdown(3); setStartupPhase("preparing"); return; }
      value -= 1;
      if (value <= 0) {
        window.clearInterval(timer);
        setCountdown(null);
        playStartSfx(audioSettings);
        void startMedia();
      } else setCountdown(value);
    }, 700);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a DOM node: the latest value is what must be bumped
    return () => { startupGeneration.current++; window.clearInterval(timer); };
  }, [startupPhase, gameStarted, showResult, startMedia, audioSettings]);

  const loopActive = gameStarted && !songEnded;

  useGameLoop(() => {
    if (pausedRef.current) return;
    const media = mediaRef.current;
    const mediaTimeSec = getCurrentTimeSec(media);
    const chartTimeSec = applyTimingOffsetSec(mediaTimeSec, lockedTimingOffsetMs);
    setCurrentTimeSec(chartTimeSec);
    const ended = !!media && media.ended;
    if (ended) setSongEnded(true);
    setState((s) => tick(s, ended ? Number.POSITIVE_INFINITY : chartTimeSec));
  }, loopActive);


  const pauseGame = useCallback(() => {
    playGeneration.current++;
    cancelMediaRecovery();
    pausedRef.current = true;
    setPaused(true);
    pauseVideo(mediaRef.current);
    // A paused hold requires a fresh press on resume; it cannot auto-clear hands-free.
    const t = applyTimingOffsetSec(recoveryPosition.current ?? getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => ([0, 1, 2, 3] as Lane[]).reduce((next, lane) => attemptHoldRelease(next, lane, t), s));
    touchStarts.current.clear();
    setPressedLanes([false, false, false, false]);
  }, [lockedTimingOffsetMs, cancelMediaRecovery]);

  /** Leave a failed source exactly once and continue with the next audio-only candidate. */
  const advanceSource = useCallback((reason: string, resume: boolean): boolean => {
    const from = sourceIndexRef.current;
    if (from >= plan.length - 1) return false;
    const failureKey = `${mediaSession}:${from}`;
    if (handledFailures.current.has(failureKey)) return true;
    handledFailures.current.add(failureKey);
    const media = mediaRef.current;
    setMediaDiagnostic(describeFailure(media, activeSource, reason));
    const position = recoveryPosition.current ?? (media && Number.isFinite(media.currentTime) ? media.currentTime : 0);
    cancelPlayback();
    pauseVideo(media);
    if (gameStarted) {
      recoveryPosition.current = position;
      pauseGame();
      resumeAfterSwitch.current = resume;
    } else {
      recoveryPosition.current = null;
      startupGeneration.current++;
      setCountdown(3);
      setStartupPhase("preparing");
    }
    const next = from + 1;
    sourceIndexRef.current = next;
    setSourceIndex(next);
    setMediaPrepared(false);
    setMediaError(null);
    if (plan[0].kind === "video" && plan[next].kind === "audio") setMediaNotice("영상 로드에 실패해 오디오 모드로 재생합니다.");
    return true;
  }, [plan, mediaSession, activeSource, gameStarted, cancelPlayback, pauseGame]);
  useEffect(() => { advanceSourceRef.current = advanceSource; }, [advanceSource]);

  // After a mid-song switch the new element must seek back to the saved position before the game continues.
  useEffect(() => {
    if (!resumeAfterSwitch.current || !mediaPrepared || !gameStarted) return;
    resumeAfterSwitch.current = false;
    void startMedia();
  }, [mediaPrepared, gameStarted, startMedia]);

  const recoverMedia = useCallback(async (reason: string) => {
    const media = mediaRef.current;
    if (!media || songEnded || recoveryAbort.current) return;
    if (!gameStarted) {
      // A preload error must never start the game by itself; with an audio-only source left it continues there.
      if (advanceSource(reason, false)) return;
      recoveryPosition.current ??= Number.isFinite(media.currentTime) ? media.currentTime : 0;
      setMediaDiagnostic(describeFailure(media, activeSource, reason));
      setMediaError(`${reason} · 재생 다시 시도를 눌러 주세요.`);
      return;
    }
    if (pausedRef.current) {
      recoveryPosition.current ??= Number.isFinite(media.currentTime) ? media.currentTime : 0;
      setMediaDiagnostic(describeFailure(media, activeSource, reason));
      setMediaError(`${reason} · 재생 다시 시도를 눌러 주세요.`);
      return;
    }
    recoveryPosition.current = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    pauseGame(); // freeze judgement and release held inputs before load() resets the clock
    // With an audio-only source available a second identical reload is pointless, so only one is attempted.
    const maxRecoveries = hasNextSource ? 1 : 2;
    if (recoveryAttempts.current >= maxRecoveries) {
      if (advanceSource(reason, true)) return;
      setMediaDiagnostic(describeFailure(media, activeSource, reason));
      setMediaError(`${reason} · 자동 복구 한도에 도달했습니다. 재생 다시 시도를 눌러 주세요.`);
      return;
    }
    recoveryAttempts.current++;
    const generation = playGeneration.current;
    const controller = new AbortController();
    recoveryAbort.current = controller;
    setMediaError(`${reason} · 재생 복구 중…`);
    try {
      await reloadMediaAtTime(media, recoveryPosition.current, controller.signal);
      if (generation !== playGeneration.current) return;
      await playMediaWithTimeout(media, controller.signal);
      if (generation !== playGeneration.current) return;
      recoveryPosition.current = null;
      setMediaError(null); pausedRef.current = false; setPaused(false);
    } catch (error) {
      if (generation !== playGeneration.current) return;
      pauseVideo(media);
      if (hasNextSource && advanceSource(reason, true)) return;
      setMediaDiagnostic(describeFailure(media, activeSource, reason));
      setMediaError(`${reason} · 재생 복구 실패: ${(error as Error).message}`);
    } finally { if (recoveryAbort.current === controller) recoveryAbort.current = null; }
  }, [gameStarted, songEnded, pauseGame, advanceSource, hasNextSource, activeSource]);

  const scheduleMediaRecovery = useCallback((reason: string) => {
    if (!gameStarted || mediaRecoveryTimer.current !== null || pausedRef.current || songEnded || recoveryAbort.current) return;
    const generation = playGeneration.current;
    mediaRecoveryTimer.current = window.setTimeout(() => {
      mediaRecoveryTimer.current = null;
      const media = mediaRef.current;
      if (generation !== playGeneration.current || pausedRef.current || songEnded) return;
      if (media && !media.ended && media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) void recoverMedia(reason);
    }, 3000);
  }, [gameStarted, songEnded, recoverMedia]);

  const handlePauseToggle = useCallback(() => {
    if (!gameStarted || songEnded) return;
    if (pausedRef.current) void startMedia();
    else pauseGame();
  }, [gameStarted, songEnded, startMedia, pauseGame]);

  useEffect(() => {
    const freeze = () => {
      if (songEnded || showResult) return;
      if (gameStarted) { pauseGame(); return; }
      startupGeneration.current++;
      setLifecycleBlocked(true);
      cancelPlayback();
      pauseVideo(mediaRef.current);
      setCountdown(3);
      setStartupPhase("preparing");
    };
    const resumeStartup = () => {
      if (gameStarted || songEnded || showResult) return;
      setLifecycleBlocked(false);
      setCountdown(3);
      setStartupPhase("preparing");
    };
    const visibility = () => { if (document.hidden) freeze(); else resumeStartup(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", freeze);
    window.addEventListener("focus", resumeStartup);
    window.addEventListener("beatdash:pause", freeze);
    window.addEventListener("beatdash:resume", resumeStartup);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", freeze);
      window.removeEventListener("focus", resumeStartup);
      window.removeEventListener("beatdash:pause", freeze);
      window.removeEventListener("beatdash:resume", resumeStartup);
    };
  }, [gameStarted, songEnded, showResult, mediaPrepared, pauseGame, cancelPlayback]);

  const setLanePressed = useCallback((lane: Lane, pressed: boolean) => {
    setPressedLanes((prev) => {
      if (prev[lane] === pressed) return prev;
      const next = prev.slice();
      next[lane] = pressed;
      return next;
    });
  }, []);

  const handleLaneKeyDown = useCallback((lane: Lane) => {
    if (!gameStarted || pausedRef.current || stateRef.current.failed || stateRef.current.finished) return;
    setLanePressed(lane, true);
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
    setSongEnded(false); setShowResult(false);
    cancelPlayback();
    recoveryPosition.current = null;
    recoveryAttempts.current = 0;
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
    startupGeneration.current++;
    setGameStarted(false);
    setStartupPhase("preparing");
    setMediaPrepared(Boolean(mediaRef.current && mediaRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA));
    setCountdown(3);
  }, [lockedTimingOffsetMs, cancelPlayback]);


  useEffect(() => {
    if (!state.finished) return;
    touchStarts.current.clear();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [state.finished]);

  useEffect(() => {
    if (!songEnded) return;
    cancelPlayback(); pauseVideo(mediaRef.current);
    const timer = window.setTimeout(() => setShowResult(true), 600);
    return () => window.clearTimeout(timer);
  }, [songEnded, cancelPlayback]);

  const activeNotes = useMemo(
    () => state.notes.filter((n) => isNoteActive(n, currentTimeSec, lockedNoteSpeed)),
    [state.notes, currentTimeSec, lockedNoteSpeed]
  );
  const result = useMemo(() => computeResult(state), [state]);

  useEffect(() => {
    const media = mediaRef.current;
    if (media) media.volume = Math.max(0, Math.min(1, audioSettings.masterVolume * audioSettings.musicVolume));
  }, [audioSettings, showResult, sourceIndex, mediaSession]);

  useEffect(() => {
    const feedback = state.lastFeedback;
    if (!feedback || feedback.sequence === lastSfxSequence.current) return;
    lastSfxSequence.current = feedback.sequence;
    if (preferences.vibration && supportsVibration() && feedback.judgement !== "Miss") navigator.vibrate(10);
    if (feedback.phase === "hold_complete") playHitSfx(audioSettings, "holdComplete");
    else if (feedback.phase === "hold_start") playHitSfx(audioSettings, "holdStart");
    else if (feedback.noteType === "flick" && feedback.judgement !== "Miss") playHitSfx(audioSettings, "flick");
    else playHitSfx(audioSettings, feedback.judgement.toLowerCase() as "perfect" | "great" | "good" | "miss");
  }, [state.lastFeedback, audioSettings, preferences.vibration]);

  useEffect(() => {
    if (!showResult || resultSoundPlayed.current) return;
    resultSoundPlayed.current = true;
    const clear = getClearType(result);
    if (clear === "PERFECT_COMBO") playPerfectComboSfx(audioSettings);
    else if (clear === "FULL_COMBO") playFullComboSfx(audioSettings);
    else playNoticeSfx(audioSettings, "result");
  }, [showResult, result, audioSettings]);

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
      startupPhase,
      lifecycleBlocked,
      noteSpeed: lockedNoteSpeed,
      timingOffsetMs: lockedTimingOffsetMs,
    };
  }, [state, currentTimeSec, paused, gameStarted, startupPhase, lifecycleBlocked, lockedNoteSpeed, lockedTimingOffsetMs]);

  const handleEnded = () => { setPaused(false); setState(s => tick(s, Number.POSITIVE_INFINITY)); setSongEnded(true); };

  const videoFilter = `brightness(${mv.brightness}) blur(${mv.blurPx}px)`;
  const mediaKey = `${mediaSession}:${sourceIndex}`;
  const attachMedia = (node: HTMLMediaElement | null) => { mediaRef.current = node; if (node) latestMedia.current = node; };
  const mediaNode = effectiveKind === "audio" ? (
    <audio key={mediaKey} onEnded={handleEnded} ref={attachMedia} src={activeSource.url} onLoadedMetadata={markMediaPrepared} onCanPlay={markMediaPrepared} onError={() => { void recoverMedia("오디오 파일 오류"); }} onStalled={() => scheduleMediaRecovery("오디오 로딩 지연")} onWaiting={() => scheduleMediaRecovery("오디오 버퍼링")} onPlaying={clearMediaRecovery} preload="auto" />
  ) : (
    <video
      key={mediaKey}
      onEnded={handleEnded}
      ref={attachMedia}
      src={activeSource.url}
      onLoadedMetadata={markMediaPrepared}
      onCanPlay={markMediaPrepared}
      onError={() => { void recoverMedia("영상 파일 오류"); }}
      onStalled={() => scheduleMediaRecovery("영상 로딩 지연")}
      onWaiting={() => scheduleMediaRecovery("영상 버퍼링")}
      onPlaying={clearMediaRecovery}
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

  const saveError = recordError && <div role="alert">{recordError}<button onClick={() => { reportedResult.current = false; setRecordError(null); setRecordRetry(value => value + 1); }}>기록 저장 다시 시도</button></div>;
  if (showResult) return <div className="result-page">{saveError}<ResultScreen title={songTitle ?? chart.title} difficulty={chart.difficulty} result={result} onRestart={handleRestart} feedback={recordFeedback} onLibrary={onLibrary} onSongDetail={onSongDetail}/>{resultExtra && <details className="result-extra"><summary>Rate AI Chart</summary>{resultExtra}</details>}</div>;

  return (
    <div className={`game-screen effects-${preferences.effects} ${songEnded ? "finishing" : ""}`}>
      {saveError}
      {songEnded && <div className="finish-status" role="status">TRACK COMPLETE</div>}
      <div className="game-meta-row">
        <div className="game-song-meta">
          <strong>{songTitle ?? chart.title}</strong>
          <span>{chart.artist}</span>
        </div>
        <div className="game-chart-meta">
          <span>{chart.difficulty} · Lv.{chart.level}</span>
          <span>Speed {lockedNoteSpeed.toFixed(1)}</span>
          {lockedTimingOffsetMs !== 0 && <span>Offset {lockedTimingOffsetMs > 0 ? "+" : ""}{lockedTimingOffsetMs}ms</span>}
        </div>
      </div>

      <div className={`stage ${effectiveKind === "audio" ? "audio-stage" : ""}`}>
        {mediaNode}
        {effectiveKind === "video" && <div className="mv-overlay" style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${mv.overlayOpacity})` }} />}
        {effectiveKind === "audio" && <div className="audio-backdrop"><span>AI CHART</span><b>{Math.round(chart.bpm)} BPM</b></div>}

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
            disabled={!gameStarted || songEnded}
          >Ⅱ</button>
        </div>

        <div className="combo-display" hidden={!preferences.combo}>
          {state.combo > 0 && <div className="combo-number">{state.combo}</div>}
          {state.combo > 0 && <div className="combo-label">COMBO</div>}
        </div>
        {preferences.perfectStreak && state.perfectStreak >= 2 && <div className="perfect-streak" aria-label={`Perfect streak ${state.perfectStreak}`}>PERFECT × {state.perfectStreak}</div>}

        <div className="lane-input-feedback" aria-hidden="true">
          {pressedLanes.map((pressed, lane) => <i key={lane} className={pressed && !state.finished ? "pressed" : ""} />)}
        </div>

        {feedback && feedbackLabel && (
          <>
            <div key={`label-${feedback.sequence}`} className={`judgement-feedback judgement-pop ${feedback.judgement.toLowerCase()} ${feedback.phase}`}>
              {preferences.judgementText && <strong>{feedbackLabel}</strong>}
              {preferences.fastSlow && timingWord && <span>{timingWord}{timingMs ? ` · ${timingMs}` : ""}</span>}
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
              {startupPhase === "preparing" ? <div className="countdown-number preparing" role="status">READY</div> : <div className="countdown-number" role="status">{countdown ?? "GO"}</div>}
              <small>{startupPhase === "preparing" ? "미디어 준비 중… 준비가 끝나면 3·2·1 후 자동 시작합니다." : "자동으로 시작합니다 · 키보드 D F J K · Flick: 레인 키 + Space · 터치: 누르기/홀드, 위로 밀기 = Flick"}</small>
            </div>
          </div>
        )}
        {mediaNotice && !mediaError && <div className="media-notice" role="status" style={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 30, padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 12, textAlign: "center", pointerEvents: "none" }}>{mediaNotice}</div>}
        {mediaError && <div className="media-error" role="alert"><p>{mediaError}</p>{mediaDiagnostic && <small className="media-diagnostic">진단 · {mediaDiagnostic}</small>}<button onClick={() => {
          // Retry re-acquires the resource: fresh element, fresh failure bookkeeping, stored MV tried once more.
          const media = mediaRef.current;
          onRetryMedia?.();
          cancelPlayback();
          startupGeneration.current++;
          handledFailures.current.clear();
          if (gameStarted) {
            recoveryPosition.current ??= media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
            resumeAfterSwitch.current = true;
          } else {
            // Nothing has played yet: a stale checkpoint from the failed attempt must not trigger a reload+seek.
            recoveryPosition.current = null;
            recoveryAttempts.current = 0;
            setCountdown(3);
            setStartupPhase("preparing");
          }
          sourceIndexRef.current = 0;
          setSourceIndex(0);
          setMediaSession((value) => value + 1);
          setMediaPrepared(false);
          setMediaError(null);
          setMediaNotice(null);
        }}>재생 다시 시도</button></div>}
        {paused && gameStarted && <PauseOverlay onResume={handlePauseToggle} onRestart={handleRestart} />}
      </div>

      {effectiveKind === "video" && (
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


    </div>
  );
}
