import { artworkForSong } from "../../library/db";
import { useEffect, useMemo, useState } from "react";
import { getBestRecordsForSong } from "../../library/db";
import type { BestRecord, LibraryBundle } from "../../library/types";

interface Props {
  library: LibraryBundle[];
  onBack: () => void;
  onAddSong: () => void;
  onOpenSong: (songId: string) => void;
}

type SortMode = "recent" | "added" | "title";

function clearBadge(record: BestRecord | null | undefined): string {
  if (!record) return "—";
  if (record.bestClearType === "PERFECT_COMBO") return "PC";
  if (record.bestClearType === "FULL_COMBO") return "FC";
  return "CL";
}

export function LibraryScreen({ library, onBack, onAddSong, onOpenSong }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [bests, setBests] = useState<Record<string, Record<string, BestRecord | null>>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(library.map(async ({ song }) => [song.id, await getBestRecordsForSong(song.id)] as const))
      .then((entries) => { if (!cancelled) setBests(Object.fromEntries(entries)); }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [library]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const items = library.filter(({ song }) => !needle || song.title.toLocaleLowerCase().includes(needle) || song.originalTitle.toLocaleLowerCase().includes(needle));
    return items.slice().sort((a, b) => {
      if (sort === "title") return a.song.title.localeCompare(b.song.title, "ko");
      if (sort === "added") return b.song.createdAt - a.song.createdAt;
      return (b.song.lastPlayedAt ?? b.song.updatedAt) - (a.song.lastPlayedAt ?? a.song.updatedAt);
    });
  }, [library, query, sort]);

  return (
    <main className="v4-shell library-page">
      <header className="v4-topbar"><button className="text-back" onClick={onBack}>← HOME</button><div className="brand-lockup compact"><span className="brand-mark">B</span><strong>LIBRARY</strong></div><button className="small-primary" onClick={onAddSong}>＋ ADD</button></header>
      {error && <p role="alert">{error}</p>}
      <section className="library-title"><div><span className="eyebrow">LOCAL COLLECTION</span><h1>Library</h1><p>{library.length}곡 저장됨</p></div></section>
      <section className="library-tools"><input aria-label="곡 검색" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="곡 제목 검색"/><select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}><option value="recent">최근 플레이</option><option value="added">최근 추가</option><option value="title">제목순</option></select></section>

      {visible.length === 0 ? <section className="empty-library"><strong>조건에 맞는 곡이 없습니다.</strong><span>새 곡을 추가하거나 검색어를 바꿔보세요.</span></section> : (
        <section className="library-list">
          {visible.map(({ song, charts }) => (
            <button className="library-row" key={song.id} onClick={() => onOpenSong(song.id)}>
              <div className="library-art">{artworkForSong(song) ? <img src={artworkForSong(song)} alt=""/> : <span>{song.mediaKind === "video" ? "MV" : "♪"}</span>}</div>
              <div className="library-main"><strong>{song.title}</strong><span>{song.bpm.toFixed(1)} BPM · {Math.round(song.durationSec)}s</span></div>
              <div className="library-difficulties">
                {charts.slice().sort((a,b) => a.level-b.level).map((chart) => <span key={chart.id}><small>{chart.difficulty.slice(0,3).toUpperCase()}</small><b className={`clear-${clearBadge(bests[song.id]?.[chart.difficulty]).toLowerCase()}`}>{clearBadge(bests[song.id]?.[chart.difficulty])}</b></span>)}
              </div>
              <span className="row-arrow">›</span>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
