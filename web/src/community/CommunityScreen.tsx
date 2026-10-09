import { useEffect, useMemo, useState } from "react";
import type { LibraryBundle, LibraryChart } from "../library/types";
import { saveCommunityChart } from "../library/db";
import { shortAuthor } from "../library/author";
import { downloadCommunityChart, listCommunityCharts, type CommunityChartSummary, type CommunityPlatformFilter, type CommunitySort } from "./api";
import { findSongMatches } from "./matchSong";
import "./community.css";
import { DIFFICULTY_OPTIONS, difficultyLabel } from "../constants/difficulty";

interface Props {
  library: LibraryBundle[];
  onBack: () => void;
  onImported: (songId: string, chart: LibraryChart) => void;
  onAddSong: () => void;
}

function chartEnd(summary: CommunityChartSummary): number {
  return Number.isFinite(summary.lastNoteSec) ? summary.lastNoteSec : 0;
}

export function CommunityScreen({ library, onBack, onImported, onAddSong }: Props) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [sort, setSort] = useState<CommunitySort>("latest");
  const [difficulty, setDifficulty] = useState("all");
  const [platform, setPlatform] = useState<CommunityPlatformFilter>("all");
  const [items, setItems] = useState<CommunityChartSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CommunityChartSummary | null>(null);
  const [songId, setSongId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- show the spinner for every new query
    setLoading(true);
    listCommunityCharts({ q: submitted, sort, difficulty, platform })
      .then((result) => { if (!cancelled) { setItems(result.items); setTotal(result.total); setError(null); } })
      .catch((reason: Error) => { if (!cancelled) { setError(reason.message); setItems([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [submitted, sort, difficulty, platform]);

  const matches = useMemo(() => selected ? findSongMatches(library, selected.song, chartEnd(selected)) : [], [library, selected]);
  const choice = matches.find((match) => match.bundle.song.id === songId) ?? null;
  const needsConfirm = choice !== null && choice.level !== "exact";

  function open(item: CommunityChartSummary) {
    setSelected(item);
    const found = findSongMatches(library, item.song, chartEnd(item));
    setSongId(found[0]?.level === "exact" ? found[0].bundle.song.id : null);
    setConfirmed(false);
  }

  async function importChart() {
    if (!selected || !choice || (needsConfirm && !confirmed) || importing) return;
    setImporting(true); setError(null);
    try {
      const detail = await downloadCommunityChart(selected.cloudChartId);
      const lastNoteEnd = detail.chartData.notes.reduce((end, note) => Math.max(end, note.time + (note.type === "hold" ? note.duration : 0)), 0);
      if (choice.bundle.song.durationSec > 0 && lastNoteEnd > choice.bundle.song.durationSec + 1) throw new Error("선택한 곡보다 채보가 길어 연결할 수 없습니다. 다른 곡을 선택해 주세요.");
      const saved = await saveCommunityChart(choice.bundle.song.id, {
        cloudChartId: detail.cloudChartId, authorId: detail.authorId, title: detail.title, description: detail.description,
        difficulty: detail.difficulty, level: detail.level, platformProfile: detail.platformProfile, chart: detail.chartData,
      });
      onImported(choice.bundle.song.id, saved);
    } catch (reason) { setError((reason as Error).message); }
    finally { setImporting(false); }
  }

  return (
    <main className="v4-shell community-page">
      <header className="v4-topbar"><button className="text-back" onClick={onBack}>← HOME</button><div className="brand-lockup compact"><span className="brand-mark">B</span><strong>COMMUNITY</strong></div><span /></header>
      <section className="community-intro"><span className="eyebrow">SHARED CHARTS</span><h1>Community</h1><p>사람이 Maker로 수정한 채보만 공유됩니다. 음원/영상은 공유되지 않으므로 같은 곡이 Library에 있어야 플레이할 수 있습니다.</p></section>
      <form className="community-filters" onSubmit={(event) => { event.preventDefault(); setSubmitted(query); }}>
        <input aria-label="곡명 검색" value={query} placeholder="곡명 / 채보 이름 검색" onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">검색</button>
        <select aria-label="정렬" value={sort} onChange={(event) => setSort(event.target.value as CommunitySort)}><option value="latest">최신</option><option value="downloads">다운로드 많은 순</option></select>
        <select aria-label="난이도" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="all">ALL</option>{DIFFICULTY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <div className="community-platform" role="radiogroup" aria-label="플랫폼">
          {(["all", "mobile", "desktop"] as CommunityPlatformFilter[]).map((item) => <button type="button" key={item} role="radio" aria-checked={platform === item} className={platform === item ? "on" : ""} onClick={() => setPlatform(item)}>{item.toUpperCase()}</button>)}
        </div>
      </form>
      {error && <p className="community-error" role="alert">{error}</p>}
      <p className="community-count" role="status">{loading ? "불러오는 중…" : `${total}개`}</p>
      <section className="community-list" aria-label="공유 채보">
        {!loading && items.length === 0 && !error && <div className="empty-library"><strong>조건에 맞는 공유 채보가 없습니다.</strong></div>}
        {items.map((item) => <button key={item.cloudChartId} className={`community-row ${selected?.cloudChartId === item.cloudChartId ? "selected" : ""}`} onClick={() => open(item)}>
          <div><strong>{item.song.title}</strong><span>{item.title}</span></div>
          <div className="community-tags"><b>{difficultyLabel(item.difficulty)} Lv.{item.level}</b><span>{item.platformProfile === "desktop" ? "PC" : "MOBILE"}</span><span>{item.noteCount} notes</span><span>↓ {item.downloadCount}</span><span>{shortAuthor(item.authorId)}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString()}</time></div>
        </button>)}
      </section>
      {selected && <section className="community-detail" aria-label="채보 상세">
        <h2>{selected.title}</h2>
        <p>{selected.song.title} · {Math.round(selected.song.durationSec)}초 · {Math.round(selected.song.bpm)} BPM · {difficultyLabel(selected.difficulty)} · {selected.platformProfile === "desktop" ? "PC (D F J K)" : "Mobile"} · v{selected.chartVersion}</p>
        {selected.description && <p className="community-description">{selected.description}</p>}
        <h3>Library 곡 연결</h3>
        {matches.length === 0 ? <div className="community-nomatch"><p>Library에서 이 곡을 찾지 못했습니다. 같은 곡을 먼저 추가한 뒤 다시 다운로드하세요.</p><button onClick={onAddSong}>곡 추가</button></div> : <>
          <div className="community-matches" role="radiogroup" aria-label="연결할 곡">
            {matches.map((match) => <label key={match.bundle.song.id}><input type="radio" name="song" checked={songId === match.bundle.song.id} onChange={() => { setSongId(match.bundle.song.id); setConfirmed(false); }} />
              <span>{match.bundle.song.title}</span><small>{Math.round(match.bundle.song.durationSec)}초 · {match.reason}</small></label>)}
          </div>
          {needsConfirm && <label className="community-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 이 곡이 채보와 같은 곡임을 확인했습니다</label>}
          <button className="community-download" disabled={!choice || (needsConfirm && !confirmed) || importing} onClick={() => void importChart()}>{importing ? "다운로드 중…" : "다운로드 → Library에 추가"}</button>
        </>}
      </section>}
    </main>
  );
}
