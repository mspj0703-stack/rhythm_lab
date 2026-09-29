interface Props {
  onResume: () => void;
  onRestart: () => void;
}

export function PauseOverlay({ onResume, onRestart }: Props) {
  return (
    <div className="pause-overlay">
      <h2>일시정지</h2>
      <p>Esc를 눌러 계속하기</p>
      <div className="pause-buttons">
        <button onClick={onResume}>계속하기</button>
        <button onClick={onRestart}>Restart</button>
      </div>
    </div>
  );
}
