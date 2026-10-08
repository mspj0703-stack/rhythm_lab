import { isYouTubeUrl } from "./youtubeUrl";
import { useEffect, useRef, useState } from "react";
import type { AnalysisResponse } from "./types";
import { DIFFICULTIES } from "../types/chart";
import { defaultChartPlatform } from "../platform/runtime";
import { ChartPlatformSelect } from "../components/ChartPlatformSelect";

export interface VideoPreview { title: string; thumbnail: string; duration: number; channel?: string; }
export function YouTubeEntry({ onComplete }: { onComplete: (value: AnalysisResponse) => void }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [difficulty, setDifficulty] = useState("hard");
  const [platform, setPlatform] = useState(defaultChartPlatform);
  const [stage, setStage] = useState<"preview" | "generate" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  function edit(value: string) { controller.current?.abort(); setUrl(value); setPreview(null); setError(""); setStage(null); }
  async function paste() {
    try { edit(await navigator.clipboard.readText()); }
    catch { setError("클립보드에 접근할 수 없습니다. 입력칸을 길게 눌러 붙여넣어 주세요."); }
  }
  async function request(generate: boolean) {
    if (stage || !isYouTubeUrl(url)) { if (!stage) setError("올바른 YouTube 영상 링크를 입력해 주세요."); return; }
    if (generate && !preview) return;
    const abort = new AbortController(); controller.current = abort;
    setStage(generate ? "generate" : "preview"); setError("");
    // Backend currently exposes one blocking generation operation: never invent substage percentages.
    try {
      const response = await fetch(generate ? "/api/analyze-youtube" : "/api/youtube-preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), difficulty, seed: 42, platform }), signal: abort.signal,
      });
     const data = await response.json().catch(() => ({}));

if (!response.ok) {
  throw new Error(
    typeof data.detail === "string"
      ? data.detail
      : `요청 실패 (${response.status})`
  );
}
      if (abort.signal.aborted || !mounted.current) return;
      if (generate) onComplete({ ...(data as AnalysisResponse), originalTitle: preview?.title, originalThumbnailUrl: preview?.thumbnail });
      else setPreview(data as VideoPreview);
    } catch {
  if (!abort.signal.aborted && mounted.current) {
    setError(
      generate
        ? "채보를 생성할 수 없습니다. 연결 상태와 영상 사용 가능 여부를 확인해 주세요."
        : "영상을 불러올 수 없습니다. 연결 상태와 링크를 확인해 주세요."
    );
  }
} finally { if (!abort.signal.aborted && mounted.current) setStage(null); }
  }
  return <section className="youtube-entry" aria-label="YouTube로 시작">
    <h2>YouTube 링크로 플레이</h2><p>링크 입력 → 영상 확인 → 채보 만들기 → 플레이</p>
    <form onSubmit={e => { e.preventDefault(); void request(false); }}>
      <label htmlFor="youtube-url">YouTube URL</label><input id="youtube-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://youtu.be/…" value={url} disabled={!!stage} onChange={e => edit(e.target.value)} />
      <div className="youtube-actions"><button type="button" disabled={!!stage} onClick={() => void paste()}>붙여넣기</button><button type="submit" disabled={!!stage || !url.trim()}>URL 불러오기</button></div>
    </form>
    {preview && <div className="video-preview"><img src={preview.thumbnail} alt="원본 영상 썸네일"/><div><h3>{preview.title}</h3><p>{Math.floor(preview.duration / 60)}:{String(Math.floor(preview.duration % 60)).padStart(2, "0")}{preview.channel ? ` · ${preview.channel}` : ""}</p></div><ChartPlatformSelect value={platform} onChange={setPlatform} disabled={!!stage}/><label>난이도<select value={difficulty} disabled={!!stage} onChange={e => setDifficulty(e.target.value)}>{DIFFICULTIES.map(d => <option key={d} value={d}>{d.toUpperCase()}</option>)}</select></label><button className="primary-action" disabled={!!stage} onClick={() => void request(true)}>채보 만들기</button></div>}
    {stage && <div className="stage-status" role="status" aria-live="polite"><i className="status-spinner"/>{stage === "preview" ? "영상 정보 확인 중…" : "오디오 준비 · 음악 분석 · 채보 생성 중…"}<small>완료되면 자동으로 플레이 준비 화면으로 이동합니다.</small></div>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </section>;
}
