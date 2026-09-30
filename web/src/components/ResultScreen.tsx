import { useEffect, useRef } from "react";
import type { GameResult } from "../engine/resultCalculation";
import { getClearType } from "../library/model";
import type { RecordFeedback } from "../library/types";

interface Props {
  title?: string;
  difficulty?: string;
  onLibrary?: () => void;
  onSongDetail?: () => void;
  result: GameResult;
  onRestart: () => void;
  feedback?: RecordFeedback | null;
}

export function ResultScreen({ result, onRestart, feedback, title, difficulty, onLibrary, onSongDetail }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const pointerArmed = useRef(false);
  useEffect(() => { heading.current?.focus(); window.scrollTo?.(0, 0); }, []);
  const clearType = getClearType(result);
  const headline = clearType === "PERFECT_COMBO" ? "PERFECT COMBO" : clearType === "FULL_COMBO" ? "FULL COMBO" : "CLEAR";
  const achievements = [
    feedback?.newHighScore ? "NEW BEST · NEW HIGH SCORE" : null,
    feedback?.newAccuracyBest ? "NEW ACCURACY BEST" : null,
    feedback?.newComboBest ? "NEW COMBO BEST" : null,
    feedback?.firstFullCombo ? "FIRST FULL COMBO" : null,
    feedback?.firstPerfectCombo ? "FIRST PERFECT COMBO" : null,
  ].filter(Boolean) as string[];

  return (
    <section className={`result-screen clear-${clearType.toLowerCase()}`} aria-label="플레이 결과" onPointerDownCapture={() => { pointerArmed.current = true; }} onPointerCancelCapture={() => { pointerArmed.current = false; }} onClickCapture={event => {
        if (event.detail > 0 && !pointerArmed.current) { event.preventDefault(); event.stopPropagation(); }
        pointerArmed.current = false;
      }} onKeyDownCapture={event => { if (event.repeat) { event.preventDefault(); event.stopPropagation(); } }}>
      <h1 ref={heading} tabIndex={-1}>{title ?? "플레이 결과"}</h1><p>{difficulty}</p>
      <div className={`clear-banner ${clearType.toLowerCase()}`}><span>{clearType === "PERFECT_COMBO" ? "ALL PERFECT" : clearType === "FULL_COMBO" ? "0 MISS" : "RESULT"}</span><strong>{headline}</strong></div>
      <div className="result-heading"><div><span className="eyebrow">RESULT</span><h2>{headline}</h2></div><div className={`result-rank rank-${result.rank.toLowerCase()}`}>{result.rank}</div></div>
      {achievements.length > 0 && <div className="result-achievements">{achievements.map((label) => <span key={label}>{label}</span>)}</div>}
      <div className="result-score-block"><span>SCORE</span><strong>{result.score.toLocaleString()}</strong></div>
      <div className="result-grid"><div><span className="label">Accuracy</span><span className="value">{result.accuracyPercent.toFixed(2)}%</span></div><div><span className="label">Max Combo</span><span className="value">{result.maxCombo.toLocaleString()}</span></div></div>
      <div className="result-counts"><div><span className="perfect">Perfect</span><strong>{result.perfect}</strong></div><div><span className="great">Great</span><strong>{result.great}</strong></div><div><span className="good">Good</span><strong>{result.good}</strong></div><div><span className="miss">Miss</span><strong>{result.miss}</strong></div></div>
      <div className="result-buttons"><button className="primary-result-action" onClick={onRestart}>RETRY</button>{onSongDetail && <button onClick={onSongDetail}>Song Detail · 곡 상세</button>}{onLibrary && <button onClick={onLibrary}>Library</button>}</div>
    </section>
  );
}
