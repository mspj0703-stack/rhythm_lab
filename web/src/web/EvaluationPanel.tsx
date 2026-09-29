import { useState } from "react";

const CRITERIA = [
  ["timing", "Timing"],
  ["musicality", "Musicality"],
  ["pattern", "Pattern"],
  ["density", "Density"],
  ["repetition", "Repetition"],
  ["fun", "Fun"],
] as const;

type RatingKey = (typeof CRITERIA)[number][0];

interface Props {
  analysisId: string;
  songName: string;
}

export function EvaluationPanel({ analysisId, songName }: Props) {
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({ timing: 3, musicality: 3, pattern: 3, density: 3, repetition: 3, fun: 3 });
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  function payload() {
    return { analysis_id: analysisId, song_name: songName, ratings, comment };
  }

  async function save() {
    setStatus("저장 중…");
    try {
      const res = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) throw new Error("server");
      setStatus("저장 완료");
    } catch {
      setStatus("서버 저장 실패 — JSON 다운로드는 사용할 수 있어요.");
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${songName.replace(/[^a-zA-Z0-9가-힣_-]+/g, "_")}-evaluation.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="evaluation-panel">
      <div>
        <div className="eyebrow">HUMAN CHECK</div>
        <h2>이 채보, 실제로 어땠어?</h2>
        <p>자동 품질점수보다 이 평가가 더 중요해.</p>
      </div>
      <div className="rating-list">
        {CRITERIA.map(([key, label]) => (
          <div className="rating-row" key={key}>
            <span>{label}</span>
            <div>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={ratings[key] >= n ? "active" : ""} onClick={() => setRatings((old) => ({ ...old, [key]: n }))} aria-label={`${label} ${n}점`}>★</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="예: 후렴 타이밍은 좋은데 하이햇을 너무 많이 따라감" rows={3} />
      <div className="evaluation-actions">
        <button onClick={save}>평가 저장</button>
        <button onClick={download}>평가 JSON 다운로드</button>
        {status && <span>{status}</span>}
      </div>
    </section>
  );
}
