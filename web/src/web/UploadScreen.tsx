import { useMemo, useState } from "react";
import { loadAudioSettings, playNoticeSfx } from "../audio/sfx";
import type { AnalysisResponse } from "./types";
import appVersion from "../../VERSION?raw";

const DIFFICULTIES = ["easy", "normal", "hard", "expert"] as const;

interface Props { onComplete: (result: AnalysisResponse) => void; onBack?: () => void; }
function formatMb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export function UploadScreen({ onComplete, onBack }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("hard");
  const [seed, setSeed] = useState(42);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = useMemo(() => ".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.mp4,audio/*,video/mp4", []);

  async function submit() {
    if (busy || !file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append("file", file); form.append("difficulty", difficulty); form.append("seed", String(seed));
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || `분석 실패 (${res.status})`);
      playNoticeSfx(loadAudioSettings(), "complete");
      onComplete(payload as AnalysisResponse);
    } catch { playNoticeSfx(loadAudioSettings(), "error"); setError("분석에 실패했습니다. 파일 형식·크기와 연결 상태를 확인해 주세요."); }
    finally { setBusy(false); }
  }

  return (
    <main className="lab-shell upload-shell">
      {onBack && <button className="text-back upload-back" onClick={onBack}>← HOME</button>}
      <header className="lab-header">
        <div className="eyebrow">BEATDASH · v{appVersion.trim()}</div>
        <h1>BEATDASH</h1>
        <p>BEATDASH Android 앱은 YouTube 영상과 분석 음원을 기기에서 준비해 서버로 보내고, 이 웹 플레이어를 자동으로 엽니다.</p>
      </header>
      <section className="upload-card">
        <div className="companion-callout">
          <strong>📱 YouTube 링크로 플레이하려면</strong>
          <span>YouTube 앱 → 공유 → BEATDASH를 선택하거나 BEATDASH 앱에 링크를 붙여넣으세요.</span>
        </div>

        <label className={`file-drop ${file ? "has-file" : ""}`}>
          <input type="file" accept={accept} disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="file-icon">♪</span>
          {file ? <><strong>{file.name}</strong><span>{formatMb(file.size)}</span></> : <><strong>직접 파일로 테스트</strong><span>MP3 · WAV · FLAC · OGG · M4A · AAC · MP4 · WEBM / 최대 80MB</span></>}
        </label>

        <div className="option-block"><span className="option-label">난이도</span><div className="difficulty-grid">
          {DIFFICULTIES.map((value) => <button type="button" key={value} className={difficulty === value ? "selected" : ""} onClick={() => setDifficulty(value)} disabled={busy}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div></div>
        <div className="seed-row"><label><span className="option-label">Pattern seed</span><input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} disabled={busy} /></label><p>같은 곡 + 같은 seed면 같은 레인 패턴이 생성됩니다.</p></div>
        {error && <div className="error-box">{error}</div>}
        <button className="primary-action" disabled={busy || !file} onClick={submit}>{busy ? "음악 분석 · 채보 생성 중…" : "AI 채보 생성"}</button>
        {busy && <div className="analysis-progress" aria-live="polite"><i className="status-spinner"/><div className="progress-steps"><span>오디오 준비 · 음악 분석 · 채보 생성 중…</span></div><small>파일 길이와 서버 상태에 따라 잠시 걸릴 수 있습니다.</small></div>}
      </section>
    </main>
  );
}
