import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PREFERENCES, supportsVibration, type Preferences } from "../settings/preferences";
import type { Chart, Lane, NoteRuntime } from "../types/chart";
import {
  attemptFlick,
  attemptHoldRelease,
  attemptLanePress,
  createInitialGameState,
  restartGame,
  resumeHolds,
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
import { CANVAS_WIDTH, CANVAS_HEIGHT, judgeLineYFor } from "../engine/highway";
import { lockPlayOrientation } from "../platform/orientation";
import { LANE_KEYS, GAUGE_CONFIG, COUNTDOWN_STEP_MS } from "../constants/config";
import { PointerLaneTracker } from "../engine/pointerInput";
import { isMediaReady, preparationProgress } from "../engine/mediaReadiness";
import { FullscreenToggle } from "./FullscreenToggle";
import type { MvSettings } from "./PauseOverlay";
import { DEFAULT_NOTE_SPEED, getGameplayLookaheadSec, normalizeNoteSpeed } from "../settings/noteSpeed";
import { applyTimingOffsetSec, DEFAULT_TIMING_OFFSET_MS, normalizeTimingOffsetMs } from "../settings/timingOffset";
import { NoteFieldCanvas } from "./NoteFieldCanvas";
import { PauseOverlay } from "./PauseOverlay";
import { ResultScreen } from "./ResultScreen";
import type { GameResult } from "../engine/resultCalculation";
import { getClearType } from "../library/model";
import type { RecordFeedback } from "../library/types";
import { DEFAULT_AUDIO_SETTINGS, playHitSfx, playPerfectComboSfx, playFullComboSfx, playStartSfx, playNoticeSfx, type AudioSettings } from "../audio/sfx";
import { difficultyLabel } from "../constants/difficulty";

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
  /** Pause -> "곡 리스트로 돌아가기". Falls back to onLibrary. */
  onQuit?: () => void;
  quitLabel?: string;
  /** Small context label shown on the start card and Pause menu (e.g. TEST PLAY). */
  playLabel?: string;
  /** Persists MV changes made in the Pause menu through the existing preferences store. */
  onPreferencesChange?: (next: Preferences) => void;
}

type StartupPhase = "preparing" | "countdown" | "playing";

type MvOptions = MvSettings;
/** A video that is not ready after this long offers "MV 없이 플레이" instead of an endless spinner. */
const MV_PREPARE_TIMEOUT_MS = 20000;
const LANE_LIST = [0, 1, 2, 3] as Lane[];

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
  onQuit, quitLabel = "곡 리스트로 돌아가기", playLabel, onPreferencesChange,
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
  // v5 Phase 2: the note field is drawn at the playfield's real size (no fixed 640x560 stretch).
  const playfieldRef = useRef<HTMLDivElement | null>(null);
  const [field, setField] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const [mv, setMv] = useState<MvOptions>({ on: preferences.backgroundVideo, brightness: preferences.backgroundBrightness, overlayOpacity: 0.5, blurPx: 0 });
  const [pressedLanes, setPressedLanes] = useState<boolean[]>([false, false, false, false]);
  const [songEnded, setSongEnded] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [recordRetry, setRecordRetry] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const resultGeneration = useRef(0);
  const [recordFeedback, setRecordFeedback] = useState<RecordFeedback | null>(null);
  // v5 Phase 2 gameplay state: resume countdown, buffering guard, preparation progress, MV failure choice.
  const [resumeCountdown, setResumeCountdown] = useState<number | null>(null);
  const resumeTimer = useRef<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const bufferingRef = useRef(false);
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [mvChoice, setMvChoice] = useState<{ reason: string; slow: boolean } | null>(null);
  /** Per-pointer touch input; never a single global "pressed" flag. */
  const tracker = useRef(new PointerLaneTracker());
  /** pointerId -> lane button that successfully captured it (used to detect a lost capture before resuming). */
  const capturedPointers = useRef(new Map<number, HTMLElement>());
  /** Lane keys physically held (kept even while paused, for the resume Hold policy). */
  const keyLanes = useRef(new Set<Lane>());
  /** noteIndex -> pointerId that started the Hold (diagnostics; release ownership lives in the tracker). */
  const holdOwners = useRef(new Map<number, number>());


  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const stateRef = useRef(state);
  const pausedRef = useRef(paused);
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

  /** canplaythrough: the browser itself says the source can play to the end without stalling. */
  const markMediaPrepared = useCallback(() => { setPrepareProgress(1); setMediaPrepared(true); }, []);
  /** loadedmetadata / canplay / progress: start only once enough is really buffered, never on a bare canplay. */
  const checkMediaReady = useCallback(() => {
    const media = mediaRef.current;
    setPrepareProgress(preparationProgress(media));
    if (isMediaReady(media)) setMediaPrepared(true);
  }, []);

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
    }, COUNTDOWN_STEP_MS);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a DOM node: the latest value is what must be bumped
    return () => { startupGeneration.current++; window.clearInterval(timer); };
  }, [startupPhase, gameStarted, showResult, startMedia, audioSettings]);

  // Rotation stays locked for the whole play screen: gameplay, Pause, resume countdown, Restart and the
  // result screen. It is released when the screen unmounts (song list / Library / Maker / abnormal cleanup).
  useEffect(() => lockPlayOrientation(), []);

  // MV that never becomes ready must not leave the player on an endless spinner.
  useEffect(() => {
    if (gameStarted || mediaPrepared || mediaError || mvChoice || effectiveKind !== "video" || !hasNextSource) return;
    const timer = window.setTimeout(() => setMvChoice({ reason: "MV 준비가 지연되고 있습니다.", slow: true }), MV_PREPARE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [gameStarted, mediaPrepared, mediaError, mvChoice, effectiveKind, hasNextSource, mediaSession]);

  useEffect(() => {
    const node = playfieldRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width > 0 && height > 0) setField((prev) => prev.width === width && prev.height === height ? prev : { width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [showResult]);

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
    // The game state freezes as-is (Holds stay "holding", no Miss). Physical pointers are NOT dropped: the lane
    // buttons stay mounted under the overlay and every touch is pointer-captured by its lane button, so
    // pointerup/pointercancel still arrive while paused and keep the tracker truthful. Gameplay actions are
    // gated by inputLive(); resumeHolds() later reads which lanes are still physically held.
    if (resumeTimer.current !== null) { window.clearInterval(resumeTimer.current); resumeTimer.current = null; }
    setResumeCountdown(null);
    bufferingRef.current = false;
    setBuffering(false);
  }, [cancelMediaRecovery]);

  /** Window lost focus / page hidden: pointer events are unreliable now, so forget every touch (Holds get the resume re-grab window). */
  const dropPhysicalPointers = useCallback(() => {
    tracker.current.reset();
    capturedPointers.current.clear();
    holdOwners.current.clear();
    setPressedLanes(LANE_LIST.map((lane) => keyLanes.current.has(lane)));
  }, []);

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
      // A preload error must never start the game by itself. A failing MV asks the player
      // ("다시 시도" / "MV 없이 플레이"); an audio source moves on to the next audio candidate.
      if (activeSource.kind === "video" && hasNextSource) {
        recoveryPosition.current = null;
        setMediaDiagnostic(describeFailure(media, activeSource, reason));
        setMvChoice({ reason: "MV를 불러오지 못했습니다.", slow: false });
        return;
      }
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

  const cancelResumeCountdown = useCallback(() => {
    if (resumeTimer.current !== null) { window.clearInterval(resumeTimer.current); resumeTimer.current = null; }
    setResumeCountdown(null);
  }, []);

  /** Physically pressed lanes right now: touch pointers + held lane keys. */
  const heldLanes = useCallback(() => LANE_LIST.filter((lane) => tracker.current.isLaneHeld(lane) || keyLanes.current.has(lane)), []);

  /**
   * Continue: 3-2-1 with audio, MV, clock and notes still frozen at the pause position, then everything
   * restarts from that same media time. Pausing again during the countdown cancels it (no duplicate timers).
   */
  const beginResumeCountdown = useCallback(() => {
    if (!gameStarted || songEnded || resumeTimer.current !== null) return;
    let value = 3;
    setResumeCountdown(value);
    resumeTimer.current = window.setInterval(() => {
      value -= 1;
      if (value > 0) { setResumeCountdown(value); return; }
      if (resumeTimer.current !== null) window.clearInterval(resumeTimer.current);
      resumeTimer.current = null;
      setResumeCountdown(null);
      const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
      // A pointer that lost its capture without an end event is a ghost: drop it so no lane stays stuck.
      for (const [pointerId, element] of capturedPointers.current) {
        if (typeof element.hasPointerCapture === "function" && !element.hasPointerCapture(pointerId)) {
          tracker.current.end(pointerId);
          capturedPointers.current.delete(pointerId);
        }
      }
      const pressed = heldLanes();
      setPressedLanes(LANE_LIST.map((lane) => pressed.includes(lane)));
      setState((s) => resumeHolds(s, t, pressed));
      void startMedia();
    }, COUNTDOWN_STEP_MS);
  }, [gameStarted, songEnded, lockedTimingOffsetMs, heldLanes, startMedia]);

  useEffect(() => () => { if (resumeTimer.current !== null) window.clearInterval(resumeTimer.current); }, []);

  const handlePauseToggle = useCallback(() => {
    if (!gameStarted || songEnded) return;
    if (!pausedRef.current) { pauseGame(); return; }
    if (resumeTimer.current !== null) { cancelResumeCountdown(); return; }
    beginResumeCountdown();
  }, [gameStarted, songEnded, pauseGame, beginResumeCountdown, cancelResumeCountdown]);

  useEffect(() => {
    const freeze = () => {
      if (songEnded || showResult) return;
      if (gameStarted) { pauseGame(); dropPhysicalPointers(); return; }
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
  }, [gameStarted, songEnded, showResult, mediaPrepared, pauseGame, dropPhysicalPointers, cancelPlayback]);


  /** Judgement is live only while the song really plays (not paused, counting down or buffering). */
  const inputLive = useCallback(() => gameStarted && !pausedRef.current && !bufferingRef.current && !stateRef.current.failed && !stateRef.current.finished, [gameStarted]);

  const syncPressedLanes = useCallback(() => {
    const lanes = LANE_LIST.map((lane) => tracker.current.isLaneHeld(lane) || keyLanes.current.has(lane));
    setPressedLanes((prev) => prev.every((value, index) => value === lanes[index]) ? prev : lanes);
  }, []);

  const pressLane = useCallback((lane: Lane, pointerId?: number) => {
    if (!inputLive()) return;
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => {
      const next = attemptLanePress(s, lane, t);
      if (pointerId !== undefined) {
        const started = next.notes.find((n) => n.note.lane === lane && n.status === "holding" && s.notes[n.index].status !== "holding");
        if (started) holdOwners.current.set(started.index, pointerId);
      }
      return next;
    });
  }, [inputLive, lockedTimingOffsetMs]);

  const releaseLane = useCallback((lane: Lane) => {
    if (!inputLive()) return;
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => attemptHoldRelease(s, lane, t));
  }, [inputLive, lockedTimingOffsetMs]);

  const handleFlick = useCallback((lane: Lane) => {
    if (!inputLive()) return;
    const t = applyTimingOffsetSec(getCurrentTimeSec(mediaRef.current), lockedTimingOffsetMs);
    setState((s) => attemptFlick(s, lane, t));
  }, [inputLive, lockedTimingOffsetMs]);

  // Keyboard (D F J K, legacy Space flick) goes through useInputManager; keys a touch never affects.
  const handleLaneKeyDown = useCallback((lane: Lane) => {
    keyLanes.current.add(lane);
    syncPressedLanes();
    // A key and a finger on the same lane act as one press: only the first starts it.
    if (!tracker.current.isLaneHeld(lane)) pressLane(lane);
  }, [pressLane, syncPressedLanes]);

  const handleLaneKeyUp = useCallback((lane: Lane) => {
    keyLanes.current.delete(lane);
    syncPressedLanes();
    if (!tracker.current.isLaneHeld(lane)) releaseLane(lane);
  }, [releaseLane, syncPressedLanes]);

  // Lane keys are tracked even while paused so the resume Hold policy knows what is physically held.
  useEffect(() => {
    const laneOf = (event: KeyboardEvent) => LANE_LIST.find((lane) => LANE_KEYS[lane] === event.key.toLowerCase());
    const down = (event: KeyboardEvent) => { const lane = laneOf(event); if (lane !== undefined && pausedRef.current) keyLanes.current.add(lane); };
    const up = (event: KeyboardEvent) => { const lane = laneOf(event); if (lane !== undefined && pausedRef.current) keyLanes.current.delete(lane); };
    const blur = () => keyLanes.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  // ---- Touch: one PointerLaneTracker entry per pointerId (Hold ownership, per-pointer Flick) ----
  const onLanePointerDown = useCallback((lane: Lane, event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); capturedPointers.current.set(event.pointerId, event.currentTarget); } catch { /* already captured / synthetic */ }
    const actions = tracker.current.down(event.pointerId, lane, event.clientX, event.clientY, event.timeStamp);
    syncPressedLanes();
    // A finger on a lane already held by a key/finger still presses (Tap during that lane's Hold is a chart error).
    for (const action of actions) if (action.type === "press" && !keyLanes.current.has(lane)) pressLane(action.lane, action.pointerId);
  }, [pressLane, syncPressedLanes]);

  const onLanePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    for (const action of tracker.current.move(event.pointerId, event.clientX, event.clientY, event.timeStamp)) {
      if (action.type === "flick") handleFlick(action.lane);
    }
  }, [handleFlick]);

  const onLanePointerEnd = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.type === "pointerup") event.preventDefault();
    const actions = tracker.current.end(event.pointerId);
    capturedPointers.current.delete(event.pointerId);
    syncPressedLanes();
    for (const action of actions) {
      if (action.type !== "release" || keyLanes.current.has(action.lane)) continue;
      for (const [index, owner] of holdOwners.current) if (owner === action.pointerId) holdOwners.current.delete(index);
      releaseLane(action.lane);
    }
  }, [releaseLane, syncPressedLanes]);

  const inputCallbacks = useMemo(() => ({
    onLaneKeyDown: handleLaneKeyDown,
    onLaneKeyUp: handleLaneKeyUp,
    onFlick: handleFlick,
    onPauseToggle: handlePauseToggle,
  }), [handleLaneKeyDown, handleLaneKeyUp, handleFlick, handlePauseToggle]);

  useInputManager(inputCallbacks, gameStarted && !state.finished, paused, chart.notes.some(note => note.type === "flick"));

  /** fromResult: the result screen already unmounted the media element, so the new one must prepare again. */
  const handleRestart = useCallback((fromResult = false) => {
    setSongEnded(false); setShowResult(false);
    cancelPlayback();
    recoveryPosition.current = null;
    recoveryAttempts.current = 0;
    pausedRef.current = false;
    setMediaError(null);
    setMvChoice(null);
    if (resumeTimer.current !== null) { window.clearInterval(resumeTimer.current); resumeTimer.current = null; }
    setResumeCountdown(null);
    bufferingRef.current = false;
    setBuffering(false);
    tracker.current.reset();
    capturedPointers.current.clear();
    holdOwners.current.clear();
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
    // Restart reuses the prepared element (seek 0) - nothing is downloaded again.
    setMediaPrepared((prepared) => !fromResult && (prepared || isMediaReady(mediaRef.current)));
    setCountdown(3);
  }, [lockedTimingOffsetMs, cancelPlayback]);

  /** Pause -> "곡 리스트로 돌아가기": stop everything here; unmount then releases media and the rotation lock. */
  const handleQuit = useCallback((confirmFirst = true) => {
    if (confirmFirst && !window.confirm("플레이를 종료하고 곡 리스트로 돌아갈까요?")) return;
    cancelPlayback();
    pauseVideo(mediaRef.current);
    startupGeneration.current++;
    if (resumeTimer.current !== null) { window.clearInterval(resumeTimer.current); resumeTimer.current = null; }
    tracker.current.reset();
    capturedPointers.current.clear();
    holdOwners.current.clear();
    keyLanes.current.clear();
    pausedRef.current = true;
    resultGeneration.current++; // an unfinished play never reaches onResult / Records
    (onQuit ?? onLibrary)?.();
  }, [cancelPlayback, onQuit, onLibrary]);

  // Android system Back (PlayActivity asks window.__beatdashBack first): during play it opens Pause instead
  // of closing the screen; on the result screen it goes back to the song list. Never leaves without cleanup.
  useEffect(() => {
    const w = window as Window & { __beatdashBack?: () => boolean };
    const handler = () => {
      if (showResult) { const leave = onLibrary ?? onQuit; if (!leave) return false; leave(); return true; }
      if (gameStarted && !songEnded) {
        if (!pausedRef.current) pauseGame();
        else if (resumeTimer.current !== null) cancelResumeCountdown();
        return true;
      }
      if (!onQuit && !onLibrary) return false;
      handleQuit(false);
      return true;
    };
    w.__beatdashBack = handler;
    return () => { if (w.__beatdashBack === handler) delete w.__beatdashBack; };
  }, [showResult, gameStarted, songEnded, onLibrary, onQuit, pauseGame, cancelResumeCountdown, handleQuit]);


  useEffect(() => {
    if (!state.finished) return;
    tracker.current.reset();
    capturedPointers.current.clear();
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

  // Buffer underrun: the clock is the media itself, so notes already stop with it; judgement is also
  // suspended until the media plays again, so no input is judged against a frozen clock.
  const onBuffering = (reason: string) => {
    if (gameStarted && !pausedRef.current && !songEnded) { bufferingRef.current = true; setBuffering(true); }
    scheduleMediaRecovery(reason);
  };
  const onMediaPlaying = () => { bufferingRef.current = false; setBuffering(false); clearMediaRecovery(); };

  /** MV settings from the Pause menu apply immediately; the element (and so the audio position) is untouched. */
  const changeMv = (next: MvOptions) => {
    setMv(next);
    if (onPreferencesChange && (next.on !== preferences.backgroundVideo || next.brightness !== preferences.backgroundBrightness)) {
      onPreferencesChange({ ...preferences, backgroundVideo: next.on, backgroundBrightness: next.brightness });
    }
  };

  const retryMedia = () => {
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
            setMvChoice(null);
  };

  /** "MV 없이 플레이": continue with the audio-only source; the countdown still waits for audio readiness. */
  const playWithoutMv = () => {
    setMvChoice(null);
    advanceSource("MV 없이 플레이", false);
  };

  const handleEnded = () => { setPaused(false); setState(s => tick(s, Number.POSITIVE_INFINITY)); setSongEnded(true); };

  const videoFilter = `brightness(${mv.brightness}) blur(${mv.blurPx}px)`;
  const mediaKey = `${mediaSession}:${sourceIndex}`;
  const attachMedia = (node: HTMLMediaElement | null) => { mediaRef.current = node; if (node) latestMedia.current = node; };
  const mediaNode = effectiveKind === "audio" ? (
    <audio key={mediaKey} onEnded={handleEnded} ref={attachMedia} src={activeSource.url} onLoadedMetadata={checkMediaReady} onCanPlay={checkMediaReady} onProgress={checkMediaReady} onCanPlayThrough={markMediaPrepared} onError={() => { void recoverMedia("오디오 파일 오류"); }} onStalled={() => scheduleMediaRecovery("오디오 로딩 지연")} onWaiting={() => onBuffering("오디오 버퍼링")} onPlaying={onMediaPlaying} preload="auto" />
  ) : (
    <video
      key={mediaKey}
      onEnded={handleEnded}
      ref={attachMedia}
      src={activeSource.url}
      onLoadedMetadata={checkMediaReady}
      onCanPlay={checkMediaReady}
      onProgress={checkMediaReady}
      onCanPlayThrough={markMediaPrepared}
      onError={() => { void recoverMedia("영상 파일 오류"); }}
      onStalled={() => scheduleMediaRecovery("영상 로딩 지연")}
      onWaiting={() => onBuffering("영상 버퍼링")}
      onPlaying={onMediaPlaying}
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
  if (showResult) return <div className="result-page">{saveError}<ResultScreen title={songTitle ?? chart.title} difficulty={`${difficultyLabel(chart.difficulty)} · ${chart.platformProfile ?? "Legacy"}`} result={result} onRestart={() => handleRestart(true)} feedback={recordFeedback} onLibrary={onLibrary} onSongDetail={onSongDetail}/>{resultExtra && <details className="result-extra"><summary>Rate AI Chart</summary>{resultExtra}</details>}</div>;

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
          <span>{difficultyLabel(chart.difficulty)} · Lv.{chart.level}</span>
          <span>Speed {lockedNoteSpeed.toFixed(1)}</span>
          {lockedTimingOffsetMs !== 0 && <span>Offset {lockedTimingOffsetMs > 0 ? "+" : ""}{lockedTimingOffsetMs}ms</span>}
        </div>
      </div>

      <div className={`stage gameplay-surface ${effectiveKind === "audio" ? "audio-stage" : ""}`} onContextMenu={(e) => e.preventDefault()}>
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

        <div className="playfield" ref={playfieldRef} data-field-size={`${field.width}x${field.height}`}>
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
            width={field.width}
            height={field.height}
            judgeLineY={judgeLineYFor(field.height)}
            laneCount={LANE_COUNT}
            noteSpeed={lockedNoteSpeed}
            pixelRatio={typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1}
          />
        </div>

        {!state.finished && (
          <div className="touch-lanes">
            {LANE_LIST.map((lane) => (
              <button
                key={lane}
                type="button"
                className={`touch-lane lane-${lane}`}
                onPointerDown={(e) => onLanePointerDown(lane, e)}
                onPointerMove={onLanePointerMove}
                onPointerUp={onLanePointerEnd}
                onPointerCancel={onLanePointerEnd}
                onLostPointerCapture={onLanePointerEnd}
                onContextMenu={(e) => e.preventDefault()}
              >
                {LANE_KEYS[lane].toUpperCase()}
              </button>
            ))}
          </div>
        )}
        </div>

        {!gameStarted && !state.finished && (
          <div className="start-overlay">
            <div className="start-card">
              <span>READY</span>
              <strong>Speed {lockedNoteSpeed.toFixed(1)}</strong>
              {lockedTimingOffsetMs !== 0 && <span className="start-offset">Offset {lockedTimingOffsetMs > 0 ? "+" : ""}{lockedTimingOffsetMs}ms</span>}
              {playLabel && <span className="start-play-label">{playLabel}</span>}
              {startupPhase === "preparing" ? <div className="countdown-number preparing" role="status">READY</div> : <div className="countdown-number" role="status">{countdown ?? "GO"}</div>}
              {startupPhase === "preparing" && <div className="prepare-status" role="status" aria-label="미디어 준비"><span className="status-spinner" />{effectiveKind === "video" ? "MV를 불러오는 중…" : "곡을 준비하는 중…"}{prepareProgress > 0 && prepareProgress < 1 ? ` ${Math.round(prepareProgress * 100)}%` : ""}</div>}
              <small>{startupPhase === "preparing" ? "준비가 끝나면 3·2·1 후 자동으로 시작합니다." : "자동으로 시작합니다 · 키보드 D F J K · Flick: 레인 키 + Space · 터치: 누르기/홀드, 위로 밀기 = Flick"}</small>
            </div>
          </div>
        )}
        {mediaNotice && !mediaError && <div className="media-notice" role="status" style={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 30, padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 12, textAlign: "center", pointerEvents: "none" }}>{mediaNotice}</div>}
        {mediaError && <div className="media-error" role="alert"><p>{mediaError}</p>{mediaDiagnostic && <small className="media-diagnostic">진단 · {mediaDiagnostic}</small>}<button onClick={retryMedia}>재생 다시 시도</button></div>}
        {mvChoice && !gameStarted && !mediaError && <div className="media-error mv-choice" role="alert">
          <p>{mvChoice.reason}</p>
          {mediaDiagnostic && !mvChoice.slow && <small className="media-diagnostic">진단 · {mediaDiagnostic}</small>}
          <div className="mv-choice-buttons">
            {mvChoice.slow ? <button onClick={() => setMvChoice(null)}>계속 기다리기</button> : <button onClick={retryMedia}>다시 시도</button>}
            <button onClick={playWithoutMv}>MV 없이 플레이</button>
          </div>
        </div>}
        {buffering && !paused && <div className="buffering-status" role="status">버퍼링 중… 재생이 재개되면 이어서 진행합니다</div>}
        {resumeCountdown !== null && <div className="resume-countdown" role="status" aria-label="재개 카운트다운"><div className="countdown-number">{resumeCountdown}</div></div>}
        {paused && gameStarted && resumeCountdown === null && <PauseOverlay onResume={handlePauseToggle} onRestart={() => handleRestart(false)}
          onQuit={(onQuit ?? onLibrary) ? () => handleQuit(true) : undefined} quitLabel={quitLabel} label={playLabel}
          mv={effectiveKind === "video" ? mv : undefined} onMvChange={changeMv} extra={<FullscreenToggle />} />}
      </div>



    </div>
  );
}
