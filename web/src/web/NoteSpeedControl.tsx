import type { CSSProperties } from "react";
import {
  DEFAULT_NOTE_SPEED,
  getNoteFallTimeSec,
  normalizeNoteSpeed,
  NOTE_SPEED_MAX,
  NOTE_SPEED_MIN,
  NOTE_SPEED_STEP,
} from "../settings/noteSpeed";

interface Props {
  value: number;
  onChange: (value: number) => void;
}

const PREVIEW_NOTES = [
  { lane: 0, phase: 0.06 },
  { lane: 2, phase: 0.29 },
  { lane: 1, phase: 0.51 },
  { lane: 3, phase: 0.74 },
];

export function NoteSpeedControl({ value, onChange }: Props) {
  const speed = normalizeNoteSpeed(value);
  const travelSec = getNoteFallTimeSec(speed);

  function step(delta: number) {
    onChange(normalizeNoteSpeed(speed + delta));
  }

  return (
    <section className="note-speed-card" aria-label="노트 속도 설정">
      <div className="note-speed-copy">
        <div className="eyebrow">NOTE SPEED</div>
        <h2>노트 속도</h2>
        <p>채보와 판정 시각은 그대로 두고, 화면에서 보이는 이동 속도와 간격만 바꿉니다.</p>
        <div className="note-speed-adjuster">
          <button type="button" aria-label="노트 속도 낮추기" onClick={() => step(-NOTE_SPEED_STEP)}>−</button>
          <output aria-live="polite">{speed.toFixed(1)}</output>
          <button type="button" aria-label="노트 속도 높이기" onClick={() => step(NOTE_SPEED_STEP)}>+</button>
        </div>
        <input
          className="note-speed-range"
          type="range"
          min={NOTE_SPEED_MIN}
          max={NOTE_SPEED_MAX}
          step={NOTE_SPEED_STEP}
          value={speed}
          onChange={(e) => onChange(normalizeNoteSpeed(Number(e.target.value)))}
          aria-label="노트 속도"
        />
        <div className="note-speed-scale"><span>{NOTE_SPEED_MIN.toFixed(1)}</span><span>기본 {DEFAULT_NOTE_SPEED.toFixed(1)}</span><span>{NOTE_SPEED_MAX.toFixed(1)}</span></div>
        <small>PLAY를 누르면 이 값으로 고정됩니다. 플레이 중에는 변경할 수 없습니다.</small>
      </div>

      <div className="note-speed-preview" aria-hidden="true">
        <div className="preview-lanes">
          {[0, 1, 2, 3].map((lane) => <span key={lane} />)}
        </div>
        {PREVIEW_NOTES.map((note, index) => (
          <i
            key={`${note.lane}-${index}-${speed}`}
            className={`preview-note preview-lane-${note.lane}`}
            style={{
              left: `${note.lane * 25 + 3}%`,
              animationDuration: `${travelSec}s`,
              animationDelay: `${-(travelSec * note.phase)}s`,
            } as CSSProperties}
          />
        ))}
        <div className="preview-judge-line" />
        <span className="preview-caption">LIVE PREVIEW</span>
      </div>
    </section>
  );
}
