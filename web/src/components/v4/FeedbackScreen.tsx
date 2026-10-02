import { useMemo, useState } from "react";
import revision from "../../../BUILD_REVISION?raw";
import appVersion from "../../../VERSION?raw";

type Category = "bug" | "gameplay" | "chart" | "ui" | "other";
interface Props { onBack: () => void; songTitle?: string; screen: string; }

export function FeedbackScreen({ onBack, songTitle, screen }: Props) {
  const [category, setCategory] = useState<Category>("bug");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const context = useMemo(() => ({
    category, message: message.trim(), version: new URLSearchParams(location.search).get("nativeVersion") || `Web ${appVersion.trim()}`,
    build: revision.trim(), platform: navigator.userAgent.includes("Android") ? "Android" : "Web",
    screen, song: songTitle || undefined, createdAt: new Date().toISOString(),
  }), [category, message, screen, songTitle]);
  async function copy() {
    if (!context.message) { setStatus("내용을 입력해 주세요."); return; }
    try { await navigator.clipboard.writeText(JSON.stringify(context, null, 2)); setStatus("피드백 정보가 복사되었습니다."); }
    catch { setStatus("복사할 수 없습니다. 내용을 직접 복사해 주세요."); }
  }
  return <main className="v4-shell feedback-page">
    <header className="v4-topbar"><button className="text-back" onClick={onBack}>← SETTINGS</button><strong>FEEDBACK</strong></header>
    <section className="settings-card"><h1>피드백 보내기</h1><p>계정·파일·기기 식별정보는 자동 수집하지 않습니다.</p>
      <label>카테고리<select value={category} onChange={e => setCategory(e.target.value as Category)}><option value="bug">버그</option><option value="gameplay">플레이</option><option value="chart">채보</option><option value="ui">UI/UX</option><option value="other">기타</option></select></label>
      <label>내용<textarea rows={8} value={message} onChange={e => setMessage(e.target.value)} placeholder="어떤 일이 있었는지 적어 주세요."/></label>
      <div className="feedback-context"><span>{context.version}</span><span>{context.platform}</span><span>{screen}</span>{songTitle && <span>{songTitle}</span>}</div>
      <button className="small-primary" onClick={() => void copy()}>피드백 정보 복사</button>{status && <p role="status">{status}</p>}
    </section>
  </main>;
}
