import { useState, type ReactNode } from "react";

export interface MvSettings {
  on: boolean;
  brightness: number;
  overlayOpacity: number;
  blurPx: number;
}

interface Props {
  onResume: () => void;
  onRestart: () => void;
  /** "곡 리스트로 돌아가기" - the only in-play navigation (v5 Phase 2). */
  onQuit?: () => void;
  quitLabel?: string;
  /** MV settings are offered only when the current source is a video. */
  mv?: MvSettings;
  onMvChange?: (next: MvSettings) => void;
  label?: string;
  extra?: ReactNode;
}

/** v5 Phase 2 Pause menu: 계속하기 / 다시 시작 / MV 설정 / 곡 리스트로 돌아가기. */
export function PauseOverlay({ onResume, onRestart, onQuit, quitLabel = "곡 리스트로 돌아가기", mv, onMvChange, label, extra }: Props) {
  const [view, setView] = useState<"menu" | "mv">("menu");
  if (view === "mv" && mv && onMvChange) {
    return (
      <div className="pause-overlay" role="dialog" aria-label="MV 설정">
        <h2>MV 설정</h2>
        <div className="pause-mv-options">
          <label className="pause-toggle"><input type="checkbox" checked={mv.on} onChange={(e) => onMvChange({ ...mv, on: e.target.checked })} /> MV 표시</label>
          <label>밝기 <input aria-label="MV 밝기" type="range" min={0} max={1} step={0.05} value={mv.brightness} onChange={(e) => onMvChange({ ...mv, brightness: Number(e.target.value) })} /></label>
          <label>Dim(오버레이) <input aria-label="MV 오버레이" type="range" min={0} max={1} step={0.05} value={mv.overlayOpacity} onChange={(e) => onMvChange({ ...mv, overlayOpacity: Number(e.target.value) })} /></label>
          <label>블러 <input aria-label="MV 블러" type="range" min={0} max={10} step={1} value={mv.blurPx} onChange={(e) => onMvChange({ ...mv, blurPx: Number(e.target.value) })} /></label>
        </div>
        <div className="pause-buttons"><button onClick={() => setView("menu")}>← 돌아가기</button></div>
      </div>
    );
  }
  return (
    <div className="pause-overlay" role="dialog" aria-label="일시정지">
      <h2>PAUSE</h2>
      {label && <p className="pause-label">{label}</p>}
      <div className="pause-buttons pause-menu">
        <button className="pause-primary" onClick={onResume}>계속하기</button>
        <button onClick={onRestart}>다시 시작</button>
        {mv && onMvChange && <button onClick={() => setView("mv")}>MV 설정</button>}
        {onQuit && <button onClick={onQuit}>{quitLabel}</button>}
      </div>
      {extra}
      <p className="pause-hint">계속하기를 누르면 3·2·1 후 이어서 재생합니다 · Esc</p>
    </div>
  );
}
