import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadChartFromUrl, parseChart } from "./engine/chartLoader";
import type { Chart } from "./types/chart";
import { GameScreen } from "./components/GameScreen";
import { UploadScreen } from "./web/UploadScreen";
import { AnalysisSummary } from "./web/AnalysisSummary";
import { EvaluationPanel } from "./web/EvaluationPanel";
import type { AnalysisResponse } from "./web/types";
import { loadNoteSpeed, normalizeNoteSpeed, saveNoteSpeed } from "./settings/noteSpeed";
import { combineTimingOffsets, loadTimingOffsetMs, normalizeTimingOffsetMs, saveTimingOffsetMs } from "./settings/timingOffset";
import { deleteSong, getLibrarySong, listLibrary, saveAnalysisToLibrary, savePlayResult, updateSongThumbnail } from "./library/db";
import { openSongMedia, useMediaHandleRelease, type SongMediaHandle } from "./library/mediaSource";
import { deriveAudioFallbackUrls } from "./engine/mediaSources";
import { captureThumbnail } from "./library/thumbnail";
import type { LibraryBundle, LibraryChart } from "./library/types";
import { HomeScreen } from "./components/v4/HomeScreen";
import { LibraryScreen } from "./components/v4/LibraryScreen";
import { SongDetailScreen } from "./components/v4/SongDetailScreen";
import { SettingsScreen } from "./components/v4/SettingsScreen";
import { FeedbackScreen } from "./components/v4/FeedbackScreen";
import { DEFAULT_AUDIO_SETTINGS, loadAudioSettings, playUiSfx, saveAudioSettings, type AudioSettings } from "./audio/sfx";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences, type Preferences } from "./settings/preferences";
import { DEFAULT_NOTE_SPEED } from "./settings/noteSpeed";
import { DEFAULT_TIMING_OFFSET_MS } from "./settings/timingOffset";
import testChartRaw from "./charts/testChart.json?raw";
import "./App.css";

const DEFAULT_VIDEO = "/test-video.mp4";

type View = "home" | "library" | "upload" | "analysis" | "detail" | "play" | "settings" | "feedback";

interface Source { chartUrl: string | null; videoUrl: string; }
interface LibraryPlay { bundle: LibraryBundle; chart: LibraryChart; media: SongMediaHandle; }

function readSource(): Source {
  const params = new URLSearchParams(window.location.search);
  return { chartUrl: params.get("chart"), videoUrl: params.get("video") ?? DEFAULT_VIDEO };
}

function loadBuiltinChart(): { chart: Chart | null; error: string | null } {
  try { return { chart: parseChart(testChartRaw), error: null }; }
  catch (e) { return { chart: null, error: (e as Error).message }; }
}

function LegacyGame() {
  const [source] = useState(readSource);
  const [noteSpeed] = useState(loadNoteSpeed);
  const [timingOffsetMs] = useState(loadTimingOffsetMs);
  const [audioSettings] = useState(loadAudioSettings);
  const [preferences] = useState(loadPreferences);
  const [loaded, setLoaded] = useState<{ chart: Chart | null; error: string | null }>(() => source.chartUrl ? { chart: null, error: null } : loadBuiltinChart());

  useEffect(() => {
    if (!source.chartUrl) return;
    let cancelled = false;
    loadChartFromUrl(source.chartUrl).then((chart) => !cancelled && setLoaded({ chart, error: null })).catch((e: Error) => !cancelled && setLoaded({ chart: null, error: e.message }));
    return () => { cancelled = true; };
  }, [source.chartUrl]);

  if (loaded.error) return <div className="app-error">채보 로드 실패: {loaded.error}</div>;
  if (!loaded.chart) return <div className="app-loading">불러오는 중...</div>;
  return <div className="app-root"><GameScreen chart={loaded.chart} mediaUrl={source.videoUrl} mediaKind="video" mediaMuted noteSpeed={noteSpeed} timingOffsetMs={timingOffsetMs} audioSettings={audioSettings} preferences={preferences} /></div>;
}

function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const legacyMode = params.has("chart") || params.has("video") || params.has("legacy");
  const companionSession = params.get("session");
  const savedCompanion = params.get("saved") === "1";

  const [view, setView] = useState<View>(companionSession ? "analysis" : params.get("view") === "library" ? "library" : params.get("view") === "settings" ? "settings" : "home");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisBundle, setAnalysisBundle] = useState<LibraryBundle | null>(null);
  const [library, setLibrary] = useState<LibraryBundle[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<LibraryBundle | null>(null);
  const [libraryPlay, setLibraryPlay] = useState<LibraryPlay | null>(null);
  const [sessionLoading, setSessionLoading] = useState(Boolean(companionSession));
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [noteSpeed, setNoteSpeed] = useState(loadNoteSpeed);
  const [timingOffsetMs, setTimingOffsetMs] = useState(loadTimingOffsetMs);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);

  const [preferences, setPreferences] = useState(loadPreferences);
  const analysisGeneration = useRef(0);

  const refreshLibrary = useCallback(async () => {
    try { setLibrary(await listLibrary()); setLibraryError(null); }
    catch (error) { setLibraryError(`Library를 열 수 없습니다: ${(error as Error).message}`); }
  }, []);

  useEffect(() => {
    if (legacyMode) return;
    let cancelled = false;
    void listLibrary().then((items) => { if (!cancelled) setLibrary(items); })
      .catch((error: Error) => { if (!cancelled) setLibraryError(error.message); });
    return () => { cancelled = true; };
  }, [legacyMode]);

  useEffect(() => {
    const handler = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button, a") : null;
      if (!target || target.classList.contains("touch-lane") || target.closest(".start-card")) return;
      playUiSfx(audioSettings);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [audioSettings]);

  const cacheAnalysis = useCallback(async (payload: AnalysisResponse, nativeMedia = false) => {
    const generation = ++analysisGeneration.current;
    try {
      const bundle = await saveAnalysisToLibrary(payload, { nativeMedia });
      if (generation === analysisGeneration.current) setAnalysisBundle(bundle);
      await refreshLibrary();
      if (bundle.song.mediaKind === "video" && !(bundle.song.originalThumbnail || bundle.song.thumbnailUrl)) {
        void captureThumbnail(bundle.song.mediaBlob ?? payload.mediaUrl).then(async (thumbnail) => {
          if (thumbnail) { await updateSongThumbnail(bundle.song.id, thumbnail); await refreshLibrary(); }
        }).catch(() => { /* Artwork failure must not invalidate a playable saved song. */ });
      }
      return bundle;
    } catch (error) {
      if (generation === analysisGeneration.current) setLibraryError(`곡은 플레이할 수 있지만 Library 저장에 실패했습니다: ${(error as Error).message}`);
      return null;
    }
  }, [refreshLibrary]);

  useEffect(() => {
    if (!companionSession || legacyMode) return;
    let cancelled = false;
    fetch(`/api/session/${encodeURIComponent(companionSession)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.detail || `세션 불러오기 실패 (${res.status})`);
        return payload as AnalysisResponse;
      })
      .then((payload) => {
        if (cancelled) return;
        setAnalysis(payload);
        setSessionError(null);
        setView("analysis");
        void cacheAnalysis(payload, savedCompanion);
      })
      .catch((e: Error) => !cancelled && setSessionError(e.message))
      .finally(() => !cancelled && setSessionLoading(false));
    return () => { cancelled = true; };
  }, [companionSession, legacyMode, savedCompanion, cacheAnalysis]);

  // The object URL is revoked only after React has committed a screen that no longer uses it
  // (song replaced or play screen left) - never while the player may still seek, reload or fall back.
  useMediaHandleRelease(libraryPlay?.media);

  useEffect(() => {
    if (!selectedSongId) return;
    let cancelled = false;
    void getLibrarySong(selectedSongId).then((bundle) => { if (!cancelled) setSelectedBundle(bundle); }).catch((error: Error) => { if (!cancelled) setLibraryError(error.message); });
    return () => { cancelled = true; };
  }, [selectedSongId, library]);

  function nav(next: View) { if (next !== "play") setLibraryPlay(null); setView(next); }
  function updateNoteSpeed(value: number) { const normalized = normalizeNoteSpeed(value); setNoteSpeed(normalized); saveNoteSpeed(normalized); }
  function updateTimingOffset(value: number) { const normalized = normalizeTimingOffsetMs(value); setTimingOffsetMs(normalized); saveTimingOffsetMs(normalized); }
  function updateAudio(value: AudioSettings) { setAudioSettings(value); saveAudioSettings(value); }

  function updatePreferences(value: Preferences) {
    setPreferences(value);
    if (!savePreferences(value)) setLibraryError("설정을 저장할 수 없습니다. 현재 실행 중에만 적용됩니다.");
  }
  function resetSettings() {
    updateNoteSpeed(DEFAULT_NOTE_SPEED); updateTimingOffset(DEFAULT_TIMING_OFFSET_MS);
    updateAudio({ ...DEFAULT_AUDIO_SETTINGS }); updatePreferences({ ...DEFAULT_PREFERENCES });
  }

  async function handleAnalysisComplete(payload: AnalysisResponse) {
    setLibraryPlay(null);
    setAnalysis(payload);
    setAnalysisBundle(null);
    setView("analysis");
    void cacheAnalysis(payload);
  }

  async function resetAnalysis() {
    const current = analysis;
    analysisGeneration.current++;
    setLibraryPlay(null);
    setAnalysis(null); setAnalysisBundle(null); setView("home");
    if (current && !savedCompanion) {
      try { await fetch(`/api/session/${current.id}`, { method: "DELETE" }); } catch { /* TTL cleanup fallback */ }
    }
    if (companionSession) window.history.replaceState({}, "", window.location.pathname);
  }

  async function openSong(songId: string) {
    setLibraryPlay(null);
    if (selectedSongId !== songId) setSelectedBundle(null);
    setSelectedSongId(songId);
    setView("detail");
  }

  // Retry in the player asks for a fresh media resource (a new object URL for Blob songs).
  function reacquireLibraryMedia() {
    if (!libraryPlay) return;
    const media = openSongMedia(libraryPlay.bundle.song);
    if (media) setLibraryPlay({ ...libraryPlay, media });
  }

  async function startLibraryPlay(chart: LibraryChart) {
    if (!selectedBundle) return;
    const bundle = await getLibrarySong(selectedBundle.song.id);
    if (!bundle) { setLibraryError("곡이 삭제되었습니다. Library에서 다시 선택해 주세요."); return; }
    const currentChart = bundle.charts.find((item) => item.id === chart.id);
    if (!currentChart) { setLibraryError("채보를 다시 선택해 주세요."); return; }
    const media = openSongMedia(bundle.song);
    if (!media) { setLibraryError("이 곡의 미디어 파일을 찾을 수 없습니다. 다시 분석해 주세요."); return; }
    setLibraryPlay({ bundle, chart: currentChart, media });
    setView("play");
  }

  async function removeSelectedSong() {
    if (!selectedBundle) return;
    if (!window.confirm(`「${selectedBundle.song.title}」을 Library에서 삭제할까요?`)) return;
    await deleteSong(selectedBundle.song.id);
    setSelectedSongId(null); setSelectedBundle(null); await refreshLibrary(); setView("library");
  }

  async function generateDifficulty(difficulty: string) {
    if (!selectedBundle) return;
    let blob = selectedBundle.song.mediaBlob;
    if (!blob && selectedBundle.song.sourceUrl) {
      const response = await fetch(selectedBundle.song.sourceUrl);
      if (!response.ok) throw new Error("저장된 미디어를 다시 불러올 수 없습니다.");
      blob = await response.blob();
    }
    if (!blob) throw new Error("재분석할 미디어가 없습니다.");

    const song = selectedBundle.song;
    const mime = blob.type || song.mediaType;
    const videoExtension = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
    const mediaName = song.mediaKind === "video" ? `${song.mediaName.replace(/\.[^.]+$/, "")}.${videoExtension}` : song.mediaName || `${song.title}.wav`;
    const file = new File([blob], mediaName, { type: mime || undefined });
    const form = new FormData();
    form.append("file", file);
    form.append("difficulty", difficulty);
    form.append("seed", "42");
    const response = await fetch("/api/analyze", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `분석 실패 (${response.status})`);
    const saved = await saveAnalysisToLibrary(payload as AnalysisResponse, { songId: selectedBundle.song.id });
    await refreshLibrary();
    setSelectedBundle(await getLibrarySong(saved.song.id));
  }

  if (legacyMode) return <LegacyGame />;
  if (sessionLoading) return <div className="app-loading">Companion 채보 불러오는 중...</div>;
  if (sessionError) return <div className="app-error">Companion 세션 로드 실패: {sessionError}</div>;

  const libraryErrorBanner = libraryError ? <div className="v4-global-error" role="alert"><span>{libraryError}</span><button onClick={() => setLibraryError(null)}>×</button></div> : null;

  if (view === "home") return <>{libraryErrorBanner}<HomeScreen library={library} onOpenLibrary={() => nav("library")} onAddSong={() => nav("upload")} onOpenSong={(id) => void openSong(id)} onSettings={() => nav("settings")} onComplete={(payload) => void handleAnalysisComplete(payload)} /></>;
  if (view === "library") return <>{libraryErrorBanner}<LibraryScreen library={library} onBack={() => nav("home")} onAddSong={() => nav("upload")} onOpenSong={(id) => void openSong(id)} /></>;
  if (view === "settings") return <>{libraryErrorBanner}<SettingsScreen onFeedback={() => nav("feedback")} noteSpeed={noteSpeed} onNoteSpeedChange={updateNoteSpeed} timingOffsetMs={timingOffsetMs} onTimingOffsetChange={updateTimingOffset} settings={audioSettings} onChange={updateAudio} preferences={preferences} onPreferences={updatePreferences} onSongSettings={() => nav("library")} onReset={resetSettings} onBack={() => nav("home")} /></>;
  if (view === "feedback") return <FeedbackScreen onBack={() => nav("settings")} screen="settings" songTitle={selectedBundle?.song.title} />;
  if (view === "upload") return <>{libraryErrorBanner}<UploadScreen onBack={() => nav("home")} onComplete={(payload) => void handleAnalysisComplete(payload)} /></>;

  if (view === "detail") {
    if (!selectedBundle) return <div className="app-loading">Library 불러오는 중...</div>;
    return <>{libraryErrorBanner}<SongDetailScreen key={selectedBundle.song.id} bundle={selectedBundle} onBack={() => nav("library")} onPlay={(chart) => void startLibraryPlay(chart).catch((error: Error) => setLibraryError(error.message))} onDelete={() => void removeSelectedSong().catch((error: Error) => setLibraryError(error.message))} onChanged={() => void refreshLibrary()} onGenerateDifficulty={generateDifficulty} /></>;
  }

  if (view === "play" && libraryPlay) {
    const { bundle, chart, media } = libraryPlay;
    return <main className="play-page"><div className="play-toolbar"><button onClick={() => nav("detail")}>← 곡 상세</button><span>{bundle.song.title}</span><span className="companion-badge">LIBRARY</span></div><GameScreen key={`${chart.id}:${chart.chartVersion}`} chart={chart.chart} songTitle={bundle.song.title} mediaUrl={media.url} audioFallbackUrls={media.audioFallbackUrls} onRetryMedia={reacquireLibraryMedia} mediaKind={bundle.song.mediaKind} mediaMuted={false} noteSpeed={noteSpeed} timingOffsetMs={combineTimingOffsets(timingOffsetMs, bundle.song.timingOffsetMs)} audioSettings={audioSettings} preferences={preferences} onLibrary={() => nav("library")} onSongDetail={() => nav("detail")} onResult={(result) => savePlayResult({ songId: bundle.song.id, chartId: chart.id, chartVersion: chart.chartVersion, difficulty: chart.difficulty, result, offsetMs: combineTimingOffsets(timingOffsetMs, bundle.song.timingOffsetMs) }).then((feedback) => { void refreshLibrary(); return feedback; })} /></main>;
  }

  if (!analysis) return <>{libraryErrorBanner}<HomeScreen library={library} onOpenLibrary={() => nav("library")} onAddSong={() => nav("upload")} onOpenSong={(id) => void openSong(id)} onSettings={() => nav("settings")} onComplete={(payload) => void handleAnalysisComplete(payload)} /></>;
  if (view === "analysis") return <>{libraryErrorBanner}<AnalysisSummary data={analysis} saved={savedCompanion} onPlay={() => nav("play")} onReset={() => void resetAnalysis()} noteSpeed={noteSpeed} onNoteSpeedChange={updateNoteSpeed} timingOffsetMs={timingOffsetMs} onTimingOffsetChange={updateTimingOffset} /></>;

  const parsed = parseChart(JSON.stringify(analysis.chart));
  return <main className="play-page"><div className="play-toolbar"><button onClick={() => nav("analysis")}>← 곡 설정</button><span>{analysis.originalName}</span>{analysisBundle && <span className="companion-badge">LIBRARY SAVED</span>}</div><GameScreen key={analysis.id} chart={parsed} mediaUrl={analysis.mediaUrl} audioFallbackUrls={deriveAudioFallbackUrls(analysis.mediaUrl, analysis.mediaKind)} mediaKind={analysis.mediaKind} mediaMuted={false} resultExtra={savedCompanion ? undefined : <EvaluationPanel analysisId={analysis.id} songName={analysis.chart.title} />} noteSpeed={noteSpeed} timingOffsetMs={timingOffsetMs} audioSettings={audioSettings} preferences={preferences} onLibrary={() => nav("library")} onSongDetail={() => analysisBundle ? void openSong(analysisBundle.song.id) : nav("analysis")} onResult={analysisBundle ? (result) => savePlayResult({ songId: analysisBundle.song.id, chartId: analysisBundle.charts[0].id, chartVersion: analysisBundle.charts[0].chartVersion, difficulty: analysisBundle.charts[0].difficulty, result, offsetMs: timingOffsetMs }).then((feedback) => { void refreshLibrary(); return feedback; }) : undefined} /></main>;
}

export default App;
