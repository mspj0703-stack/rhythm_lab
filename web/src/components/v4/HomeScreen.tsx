import type { LibraryBundle } from "../../library/types";

interface Props {
  library: LibraryBundle[];
  onOpenLibrary: () => void;
  onAddSong: () => void;
  onOpenSong: (songId: string) => void;
  onSettings: () => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function HomeScreen({ library, onOpenLibrary, onAddSong, onOpenSong, onSettings }: Props) {
  const recent = library.slice(0, 4);
  return (
    <main className="v4-shell">
      <header className="v4-topbar">
        <div className="brand-lockup"><span className="brand-mark">B</span><div><strong>BEATDASH</strong><small>v4.0</small></div></div>
        <button className="icon-action" onClick={onSettings} aria-label="설정">⚙</button>
      </header>

      <section className="v4-hero">
        <div><span className="eyebrow">YOUR RHYTHM LIBRARY</span><h1>다시 하고 싶은 곡을<br/>바로 플레이.</h1><p>분석한 곡과 기록을 기기에 저장하고, 난이도별 최고 기록을 이어서 갱신합니다.</p></div>
        <button className="hero-add" onClick={onAddSong}><span>＋</span><strong>새 곡 추가</strong><small>AI 채보 생성</small></button>
      </section>

      <section className="v4-section-head"><div><span className="eyebrow">RECENT</span><h2>최근 곡</h2></div><button onClick={onOpenLibrary}>전체 Library →</button></section>
      {recent.length === 0 ? (
        <section className="empty-library"><strong>아직 저장된 곡이 없습니다.</strong><span>곡을 추가하면 여기에서 바로 다시 플레이할 수 있어요.</span><button onClick={onAddSong}>첫 곡 추가</button></section>
      ) : (
        <section className="recent-grid">
          {recent.map(({ song, charts }) => (
            <button key={song.id} className="song-card" onClick={() => onOpenSong(song.id)}>
              <div className="song-art">{song.thumbnailUrl ? <img src={song.thumbnailUrl} alt=""/> : <span>{song.mediaKind === "video" ? "MV" : "♪"}</span>}</div>
              <div className="song-card-copy"><strong>{song.title}</strong><span>{song.bpm.toFixed(1)} BPM · {formatDuration(song.durationSec)}</span><small>{charts.length} chart{charts.length === 1 ? "" : "s"}</small></div>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
