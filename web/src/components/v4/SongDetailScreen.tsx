import { useEffect, useMemo, useState } from "react";
import { artworkForSong, getBestRecordsForSong, getRecordsForChart, updateSongCustomCover, updateSongOffset, updateSongTitle } from "../../library/db";
import { prepareCustomCover } from "../../library/cover";
import { hasNativeArtworkPicker, requestNativeArtwork } from "../../library/nativeArtwork";
import { loadAudioSettings, playNoticeSfx } from "../../audio/sfx";
import { normalizeTimingOffsetMs } from "../../settings/timingOffset";
import type { BestRecord, LibraryBundle, LibraryChart, PlayRecord } from "../../library/types";
import { DIFFICULTIES, type ChartPlatform } from "../../types/chart";
import { defaultChartPlatform } from "../../platform/runtime";
import { ChartPlatformSelect } from "../ChartPlatformSelect";
import { originBadge, originLabel } from "../../maker/originLabel";
import { checkShareEligibility } from "../../community/share";
import { shortAuthor } from "../../library/author";
import { isAiOriginal } from "../../library/model";
import "../../community/community.css";
import { DIFFICULTY_OPTIONS, difficultyLabel } from "../../constants/difficulty";

interface Props {
  bundle: LibraryBundle;
  onBack: () => void;
  onPlay: (chart: LibraryChart) => void;
  onDelete: () => void;
  onChanged: () => void;
  onGenerateDifficulty: (difficulty: string, platform?: ChartPlatform) => Promise<void>;
  /** Opens the Maker for this chart (AI/Community charts are cloned on save, never overwritten). */
  onEdit?: (chart: LibraryChart) => void;
  /** Starts the Maker with an empty chart on this (already saved) song. */
  onCreateBlank?: (difficulty: string, platform: ChartPlatform) => void;
  onShare?: (chart: LibraryChart, description?: string) => Promise<void>;
  onDeleteChart?: (chart: LibraryChart) => Promise<void>;
  initialChartId?: string;
}


function statusLabel(record: BestRecord | null | undefined): string {
  if (!record) return "NO RECORD";
  if (record.bestClearType === "PERFECT_COMBO") return "PERFECT COMBO";
  if (record.bestClearType === "FULL_COMBO") return "FULL COMBO";
  return "CLEARED";
}

function shortClear(record: PlayRecord): string {
  return record.clearType === "PERFECT_COMBO" ? "PC" : record.clearType === "FULL_COMBO" ? "FC" : "CL";
}

export function SongDetailScreen({ bundle, onBack, onPlay, onDelete, onChanged, onGenerateDifficulty, onEdit, onCreateBlank, onShare, onDeleteChart, initialChartId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(bundle.song.title);
  const [offset, setOffset] = useState(bundle.song.timingOffsetMs);
  const [selectedId, setSelectedId] = useState(initialChartId && bundle.charts.some((chart) => chart.id === initialChartId) ? initialChartId : bundle.charts[0]?.id ?? "");
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [bests, setBests] = useState<Record<string, BestRecord | null>>({});
  const [records, setRecords] = useState<PlayRecord[]>([]);
  const [coverBusy, setCoverBusy] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [platform, setPlatform] = useState(defaultChartPlatform);
  const [blankPlatform, setBlankPlatform] = useState<ChartPlatform>(defaultChartPlatform);
  const [blankDifficulty, setBlankDifficulty] = useState<string>("normal");
  const selected = useMemo(() => bundle.charts.find((chart) => chart.id === selectedId) ?? bundle.charts[0], [bundle.charts, selectedId]);
  // Only AI originals count: a Maker edit or Community download never hides the AI generator for that slot.
  const existingDifficulties = useMemo(() => new Set(bundle.charts.filter(chart => isAiOriginal(chart) && chart.chart.platformProfile === platform).map((chart) => chart.difficulty.toLowerCase())), [bundle.charts, platform]);
  const shareCheck = useMemo(() => selected?.origin === "MANUAL_EDITED" ? checkShareEligibility(selected, bundle) : null, [selected, bundle]);
  const missingDifficulties = DIFFICULTIES.filter((difficulty) => !existingDifficulties.has(difficulty));

  useEffect(() => {
    let cancelled = false;
    void getBestRecordsForSong(bundle.song.id).then((items) => { if (!cancelled) setBests(items); })
      .catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [bundle.song.id, bundle.charts]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void getRecordsForChart(selected.id).then((items) => { if (!cancelled) setRecords(items.slice(0, 5)); }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [selected]);

  async function changeCover(file?: File) {
    if (!file || coverBusy) return;
    setCoverBusy(true);
    try { setError(null); await updateSongCustomCover(bundle.song.id, await prepareCustomCover(file)); onChanged(); }
    catch (error) { setError((error as Error).message); }
    finally { setCoverBusy(false); }
  }
  async function restoreOriginalCover() { if (coverBusy) return; try { setError(null); await updateSongCustomCover(bundle.song.id, undefined); onChanged(); } catch (error) { setError((error as Error).message); } }
  async function saveTitle() { try { setError(null); await updateSongTitle(bundle.song.id, title); onChanged(); } catch (error) { setError((error as Error).message); } }
  async function saveOffset(value: number) { const next = normalizeTimingOffsetMs(value); setOffset(next); try { setError(null); await updateSongOffset(bundle.song.id, next); onChanged(); } catch (error) { setError((error as Error).message); } }
  async function share() {
    if (!selected || !onShare || sharing) return;
    const description = window.prompt("공유 설명 (선택, 500자 이내)", selected.description ?? "") ?? undefined;
    setSharing(true); setShareMessage(null);
    try { setError(null); await onShare(selected, description); setShareMessage("Community에 공유했습니다."); }
    catch (error) { setError((error as Error).message); }
    finally { setSharing(false); }
  }
  async function removeChart() {
    if (!selected || !onDeleteChart || isAiOriginal(selected)) return;
    if (!window.confirm(`「${selected.label ?? difficultyLabel(selected.difficulty)}」 채보와 이 채보의 기록을 삭제할까요? AI 원본과 다른 채보는 유지됩니다.`)) return;
    try { setError(null); await onDeleteChart(selected); setSelectedId(bundle.charts.find((chart) => chart.id !== selected.id)?.id ?? ""); }
    catch (error) { setError((error as Error).message); }
  }
  async function generate(difficulty: string, profile: ChartPlatform = platform) {
    if (generating) return;
    setGenerating(difficulty);
    try { setError(null); await onGenerateDifficulty(difficulty, profile); playNoticeSfx(loadAudioSettings(), "complete"); }
    catch (error) { playNoticeSfx(loadAudioSettings(), "error"); setError((error as Error).message); }
    finally { setGenerating(null); }
  }

  useEffect(() => {
    const onNativeCover = (event: Event) => {
      const data = (event as CustomEvent<string>).detail;
      if (!data?.startsWith("data:image/")) return;
      setCoverBusy(true);
      setError(null);
      void updateSongCustomCover(bundle.song.id, data).then(onChanged).catch((e: Error) => setError(e.message)).finally(() => setCoverBusy(false));
    };
    const onNativeCoverError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      setCoverBusy(false);
      setError(message || "커버 이미지를 처리할 수 없습니다.");
    };
    window.addEventListener("beatdash:native-cover", onNativeCover);
    window.addEventListener("beatdash:native-cover-error", onNativeCoverError);
    return () => {
      window.removeEventListener("beatdash:native-cover", onNativeCover);
      window.removeEventListener("beatdash:native-cover-error", onNativeCoverError);
    };
  }, [bundle.song.id, onChanged]);

  const record = selected ? bests[selected.id] : null;
  return (
    <main className="v4-shell detail-page">
      <header className="v4-topbar"><button className="text-back" onClick={onBack}>← LIBRARY</button><div className="brand-lockup compact"><span className="brand-mark">B</span><strong>SONG</strong></div><span/></header>
      {error && <p role="alert">{error}</p>}
      <section className="detail-hero">
        <div><div className="detail-art">{artworkForSong(bundle.song) ? <img src={artworkForSong(bundle.song)} alt=""/> : <span>{bundle.song.mediaKind === "video" ? "MV" : "♪"}</span>}</div><div className="cover-actions">{hasNativeArtworkPicker() ? <button className="small-primary" disabled={coverBusy} onClick={requestNativeArtwork}>커버 변경</button> : <label className="small-primary">커버 변경<input hidden disabled={coverBusy} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void changeCover(file); }}/></label>}<button disabled={coverBusy || !bundle.song.customCover} onClick={() => void restoreOriginalCover()}>원본 썸네일로 되돌리기</button></div></div>
        <div className="detail-copy"><span className="eyebrow">LOCAL SONG</span><div className="title-edit"><input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveTitle()} aria-label="곡 제목"/><button onClick={() => void saveTitle()}>SAVE</button></div><p>원본: {bundle.song.originalTitle}</p><div className="song-meta-pills"><span>{bundle.song.bpm.toFixed(1)} BPM</span><span>{Math.round(bundle.song.durationSec)} sec</span><span>{bundle.song.mediaKind.toUpperCase()}</span><span>추가: {new Date(bundle.song.createdAt).toLocaleDateString()}</span></div></div>
      </section>

      <section className="difficulty-select">
        {bundle.charts.slice().sort((a, b) => DIFFICULTIES.indexOf(a.difficulty.toLowerCase() as typeof DIFFICULTIES[number]) - DIFFICULTIES.indexOf(b.difficulty.toLowerCase() as typeof DIFFICULTIES[number])).map((chart) => <button key={chart.id} className={selected?.id === chart.id ? "selected" : ""} onClick={() => setSelectedId(chart.id)}><small>{difficultyLabel(chart.difficulty)} · {chart.chart.platformProfile ?? "legacy"}<em className={`origin-badge ${originBadge(chart.origin).toLowerCase()}`}>{originBadge(chart.origin)}</em></small><strong>Lv.{chart.level}</strong>{!isAiOriginal(chart) && chart.label && <small className="chart-label">{chart.label}</small>}<span>{statusLabel(bests[chart.id])}</span></button>)}
      </section>

      {selected && <section className="record-panel">
        <div className="record-status"><span className="eyebrow">BEST RECORD</span><strong>{statusLabel(record)}</strong></div>
        <div className="record-stats"><div><small>SCORE</small><b>{record ? record.bestScore.toLocaleString() : "—"}</b></div><div><small>ACCURACY</small><b>{record ? `${record.bestAccuracy.toFixed(2)}%` : "—"}</b></div><div><small>MAX COMBO</small><b>{record ? record.bestMaxCombo.toLocaleString() : "—"}</b></div><div><small>PLAYS</small><b>{record?.playCount ?? 0}</b></div></div>
        <button className="big-play" disabled={Boolean(generating)} onClick={() => onPlay(selected)}>PLAY <span>→</span></button>
      </section>}

      {selected && (onEdit || onShare || onDeleteChart) && <section className="chart-tools-panel" aria-label="채보 편집·공유">
        <p>{originLabel(selected.origin)}{selected.origin === "COMMUNITY" && ` · 작성자 ${shortAuthor(selected.authorId)}`}{!isAiOriginal(selected) && ` · v${selected.chartVersion}`}{selected.cloudPublished && " · 공유됨"}</p>
        {onEdit && <button disabled={Boolean(generating)} onClick={() => onEdit(selected)}>{selected.origin === "MANUAL_EDITED" ? "EDIT · Maker" : "EDIT · Maker (복제본 생성)"}</button>}
        {onShare && selected.origin === "MANUAL_EDITED" && <button disabled={sharing || !shareCheck?.ok} onClick={() => void share()}>{sharing ? "공유 중…" : selected.cloudChartId ? (selected.cloudPublished ? "공유됨 · 다시 업로드" : "변경 사항 공유") : "COMMUNITY 공유"}</button>}
        {onDeleteChart && !isAiOriginal(selected) && <button onClick={() => void removeChart()}>이 채보 삭제</button>}
        {shareCheck && !shareCheck.ok && <ul className="share-reasons">{shareCheck.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        {shareMessage && <p role="status">{shareMessage}</p>}
      </section>}

      {records.length > 0 && <section className="recent-records"><div className="panel-heading"><span className="eyebrow">RECENT PLAYS</span><h2>최근 기록</h2></div><div className="recent-record-list">{records.map((item) => <div key={item.id}><span className={`record-clear record-${shortClear(item).toLowerCase()}`}>{shortClear(item)}</span><strong>{item.score.toLocaleString()}</strong><span>{item.accuracy.toFixed(2)}%</span><span>{item.maxCombo} combo</span><time>{new Date(item.playedAt).toLocaleDateString()}</time></div>)}</div></section>}

      <section className="song-settings-panel"><div><span className="eyebrow">SONG OFFSET</span><h2>{offset > 0 ? "+" : ""}{offset} ms</h2><p>이 곡의 보정값을 전역 Offset에 더합니다. 최종 적용 범위는 −300~+300 ms입니다.</p></div><div className="song-offset-controls"><button onClick={() => void saveOffset(offset - 10)}>−10</button><input type="range" min={-300} max={300} step={1} value={offset} onChange={(e) => setOffset(Number(e.target.value))} onPointerUp={() => void saveOffset(offset)} onKeyUp={() => void saveOffset(offset)}/><button onClick={() => void saveOffset(offset + 10)}>+10</button><button className="reset-offset" onClick={() => void saveOffset(0)}>RESET</button></div></section>

      {onCreateBlank && <section className="chart-generator-panel blank-chart-panel" aria-label="빈 채보로 새로 만들기">
        <div><span className="eyebrow">MAKER</span><h2>빈 채보로 새로 만들기</h2><p>이 곡의 BPM·오프셋을 그대로 쓰고 노트 없이 시작합니다. AI 채보는 바뀌지 않으며, 저장하면 내 채보로 따로 추가됩니다.</p></div>
        <div className="blank-chart-controls">
          <select aria-label="새 채보 플랫폼" value={blankPlatform} onChange={(e) => setBlankPlatform(e.target.value as ChartPlatform)}><option value="mobile">Mobile</option><option value="desktop">Desktop</option></select>
          <select aria-label="새 채보 난이도" value={blankDifficulty} onChange={(e) => setBlankDifficulty(e.target.value)}>{DIFFICULTY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <button disabled={Boolean(generating)} onClick={() => onCreateBlank(blankDifficulty, blankPlatform)}>빈 채보로 Maker 시작</button>
        </div>
      </section>}
      <ChartPlatformSelect value={platform} onChange={setPlatform} disabled={Boolean(generating)} />
      {missingDifficulties.length > 0 && <section className="chart-generator-panel"><div><span className="eyebrow">ADD CHART</span><h2>다른 난이도 생성</h2><p>저장된 미디어를 서버로 보내 새 난이도를 생성합니다. 네트워크 연결이 필요합니다.</p></div><div>{missingDifficulties.map((difficulty) => <button key={difficulty} disabled={Boolean(generating)} onClick={() => void generate(difficulty)}>{generating === difficulty ? "GENERATING…" : `＋ ${difficultyLabel(difficulty)}`}</button>)}</div></section>}
      {selected && isAiOriginal(selected) && <section className="chart-generator-panel"><div><h2>현재 채보 재생성</h2><p>노트가 바뀌면 새 채보 버전으로 기록을 시작합니다. 이전 기록은 보관됩니다. 기존 채보는 선택한 플랫폼의 새 채보로 생성합니다.</p></div><button disabled={Boolean(generating)} onClick={() => { if (window.confirm("현재 난이도를 다시 생성할까요?")) void generate(selected.difficulty, selected.chart.platformProfile ?? platform); }}>{generating === selected.difficulty ? "GENERATING…" : "REGENERATE"}</button></section>}
      <section className="danger-zone"><button onClick={onDelete}>이 곡을 Library에서 삭제</button></section>
    </main>
  );
}
