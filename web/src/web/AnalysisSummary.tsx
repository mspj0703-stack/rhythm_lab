import type { AnalysisResponse } from "./types";
import { NoteSpeedControl } from "./NoteSpeedControl";
import { TimingOffsetControl } from "./TimingOffsetControl";
import { difficultyLabel } from "../constants/difficulty";

interface Props {
  data: AnalysisResponse;
  saved?: boolean;
  onPlay: () => void;
  onReset: () => void;
  noteSpeed: number;
  onNoteSpeedChange: (value: number) => void;
  timingOffsetMs: number;
  onTimingOffsetChange: (value: number) => void;
}

function pct(value?: number) {
  return `${((value ?? 0) * 100).toFixed(0)}%`;
}

export function AnalysisSummary({ data, saved = false, onPlay, onReset, noteSpeed, onNoteSpeedChange, timingOffsetMs, onTimingOffsetChange }: Props) {
  const r = data.report;
  const q = r.quality ?? {};
  const selected = r.tempoCandidates?.find((c) => c.selected);

  return (
    <main className="lab-shell summary-shell">
      <header className="summary-header">
        <div>
          <div className="eyebrow">CHART READY</div>
          <h1>{data.chart.title}</h1>
          <p>{data.originalName}</p>
        </div>
        <div className="difficulty-pill">{difficultyLabel(data.chart.difficulty)} · Lv.{data.chart.level}</div>
      </header>

      {!saved && <>
      <section className="metric-grid">
        <article><span>BPM</span><strong>{r.bpm.toFixed(1)}</strong><small>confidence {pct(r.bpmConfidence)}</small></article>
        <article><span>Notes</span><strong>{r.finalNoteCount}</strong><small>{r.notesPerSecond.toFixed(2)} notes/sec</small></article>
        <article><span>Peak</span><strong>{r.peakNotesIn1s}</strong><small>notes in 1 sec</small></article>
        <article><span>Grid</span><strong>{pct(q.gridAlignmentRatio)}</strong><small>off-grid {pct(q.offGridRatio)}</small></article>
        <article><span>Phrase reuse</span><strong>{pct(q.phraseReuseRatio)}</strong><small>반복구간 패턴 재사용</small></article>
        <article><span>Internal QC</span><strong>{(q.internalQualityScore ?? 0).toFixed(0)}</strong><small>회귀 비교용 · 재미 점수 아님</small></article>
      </section>

      {selected && (
        <section className="candidate-strip">
          <span>선택된 템포 후보</span>
          <strong>{selected.bpm.toFixed(2)} BPM</strong>
          <span>grid fit {selected.gridFit?.toFixed(3) ?? "—"}</span>
          <span>beat accent {selected.beatAccent?.toFixed(3) ?? "—"}</span>
        </section>
      )}

      {r.warnings?.length > 0 && (
        <section className="warning-box">
          <strong>분석 경고</strong>
          {r.warnings.map((w) => <div key={w}>{w}</div>)}
        </section>
      )}

      </>}
      <NoteSpeedControl value={noteSpeed} onChange={onNoteSpeedChange} />
      <TimingOffsetControl value={timingOffsetMs} onChange={onTimingOffsetChange} />

      <section className="summary-actions">
        <button className="secondary-action" onClick={onReset}>다른 곡</button>
        {!saved && <><a className="secondary-action link-button" href={`/api/result/${data.id}/report.json`} download>리포트 JSON</a>
        <a className="secondary-action link-button" href={`/api/result/${data.id}/chart.json`} download>채보 JSON</a></>}
        <button className="primary-action play-action" onClick={onPlay}>PLAY · {noteSpeed.toFixed(1)} · {timingOffsetMs > 0 ? "+" : ""}{timingOffsetMs}ms</button>
      </section>
    </main>
  );
}
