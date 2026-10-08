import { NOTICES, type Notice } from "../../notices";

export function NoticePanel({ notices = NOTICES }: { notices?: readonly Notice[] }) {
  if (!notices.length) return null;
  const ordered = [...notices].sort((a, b) => Number(b.priority === "important") - Number(a.priority === "important") ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section className="notice-panel" aria-label="공지">
    <div className="notice-heading"><strong>공지</strong><span>{ordered[0].title}</span></div>
    <details><summary>공지 전체보기 ({ordered.length})</summary>
      {ordered.map(notice => <article key={notice.id}><h3>{notice.priority === "important" && <small>중요 · </small>}{notice.title}</h3>
        <time dateTime={notice.createdAt}>{new Date(notice.createdAt).toLocaleDateString("ko-KR")}</time>
        {notice.version && <small> · v{notice.version}</small>}<p>{notice.body}</p></article>)}
    </details>
  </section>;
}
