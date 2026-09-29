import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALIBRATION_DISCARD_SAMPLES,
  CALIBRATION_INTERVAL_MS,
  CALIBRATION_TAP_WINDOW_MS,
  CALIBRATION_TOTAL_BEATS,
  estimateTimingOffsetMs,
  normalizeTimingOffsetMs,
  TIMING_OFFSET_MAX_MS,
  TIMING_OFFSET_MIN_MS,
  TIMING_OFFSET_STEP_MS,
  type TimingCalibrationEstimate,
} from "../settings/timingOffset";

interface Props {
  value: number;
  onChange: (value: number) => void;
}

type CalibrationPhase = "idle" | "running" | "result";

function formatOffset(value: number) {
  const normalized = normalizeTimingOffsetMs(value);
  return `${normalized > 0 ? "+" : ""}${normalized} ms`;
}

export function TimingOffsetControl({ value, onChange }: Props) {
  const offset = normalizeTimingOffsetMs(value);
  const [phase, setPhase] = useState<CalibrationPhase>("idle");
  const [beat, setBeat] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [estimate, setEstimate] = useState<TimingCalibrationEstimate | null>(null);

  const expectedBeatTimesRef = useRef<number[]>([]);
  const samplesRef = useRef(new Map<number, number>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  // 보정 시작을 연타하면 async 시작 두 개가 겹쳐 interval/timeout이 덮어써진 채 새어 나간다.
  // 가장 마지막 시작만 유효하도록 실행 번호로 구분한다.
  const runIdRef = useRef(0);

  const stopTimers = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    timerRef.current = null;
    endTimerRef.current = null;
  }, []);

  const closeAudio = useCallback(() => {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const finishCalibration = useCallback(() => {
    stopTimers();
    closeAudio();
    const samples = [...samplesRef.current.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, diffMs]) => diffMs);
    setEstimate(estimateTimingOffsetMs(samples));
    setPhase("result");
  }, [closeAudio, stopTimers, setEstimate, setPhase]);

  const startCalibration = useCallback(async () => {
    const runId = ++runIdRef.current;
    stopTimers();
    closeAudio();
    samplesRef.current.clear();
    setAccepted(0);
    setBeat(0);
    setEstimate(null);

    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    audioContextRef.current = context;
    try {
      await context.resume();
    } catch {
      // 다른 시작 요청이 이 context를 이미 닫은 경우
    }
    if (runId !== runIdRef.current) {
      if (context.state !== "closed") void context.close().catch(() => {});
      return;
    }

    const startDelayMs = 900;
    const startPerfMs = performance.now() + startDelayMs;
    const startAudioSec = context.currentTime + startDelayMs / 1000;
    const expected = Array.from(
      { length: CALIBRATION_TOTAL_BEATS },
      (_, index) => startPerfMs + index * CALIBRATION_INTERVAL_MS
    );
    expectedBeatTimesRef.current = expected;

    for (let index = 0; index < CALIBRATION_TOTAL_BEATS; index++) {
      const when = startAudioSec + (index * CALIBRATION_INTERVAL_MS) / 1000;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = index % 4 === 0 ? 1040 : 760;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(index % 4 === 0 ? 0.22 : 0.14, when + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(when);
      oscillator.stop(when + 0.05);
    }

    setPhase("running");
    timerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startPerfMs;
      if (elapsed < 0) setBeat(0);
      else setBeat(Math.min(CALIBRATION_TOTAL_BEATS, Math.floor(elapsed / CALIBRATION_INTERVAL_MS) + 1));
    }, 40);

    endTimerRef.current = window.setTimeout(
      finishCalibration,
      startDelayMs + CALIBRATION_TOTAL_BEATS * CALIBRATION_INTERVAL_MS + 450
    );
  }, [closeAudio, finishCalibration, stopTimers, setAccepted, setBeat, setEstimate, setPhase]);

  const recordTap = useCallback(() => {
    if (phase !== "running") return;
    const now = performance.now();
    const expected = expectedBeatTimesRef.current;
    let bestIndex = -1;
    let bestAbs = Number.POSITIVE_INFINITY;

    for (let index = 0; index < expected.length; index++) {
      if (samplesRef.current.has(index)) continue;
      const abs = Math.abs(now - expected[index]);
      if (abs < bestAbs) {
        bestAbs = abs;
        bestIndex = index;
      }
    }

    if (bestIndex < 0 || bestAbs > CALIBRATION_TAP_WINDOW_MS) return;
    samplesRef.current.set(bestIndex, now - expected[bestIndex]);
    setAccepted(samplesRef.current.size);
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "enter" || key === "d" || key === "f" || key === "j" || key === "k") {
        if (key === " ") event.preventDefault();
        recordTap();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, recordTap]);

  useEffect(() => () => {
    runIdRef.current++; // 언마운트 후 끝나는 async 시작은 타이머를 만들지 않는다
    stopTimers();
    closeAudio();
  }, [closeAudio, stopTimers]);

  function step(deltaMs: number) {
    onChange(normalizeTimingOffsetMs(offset + deltaMs));
  }

  return (
    <section className="timing-offset-card" aria-label="타이밍 오프셋 설정">
      <div className="timing-offset-copy">
        <div className="eyebrow">TIMING OFFSET</div>
        <h2>판정 타이밍 보정</h2>
        <p>
          소리보다 노트나 판정이 빠르게 느껴지면 <b>+</b>, 늦게 느껴지면 <b>−</b>로 조정합니다.
          기기별로 저장되며 노트 속도와는 별개입니다.
        </p>
        <div className="timing-offset-adjuster">
          <button type="button" aria-label="타이밍 오프셋 1ms 낮추기" onClick={() => step(-TIMING_OFFSET_STEP_MS)}>−</button>
          <output aria-live="polite">{formatOffset(offset)}</output>
          <button type="button" aria-label="타이밍 오프셋 1ms 높이기" onClick={() => step(TIMING_OFFSET_STEP_MS)}>+</button>
          <button type="button" className="timing-reset" onClick={() => onChange(0)}>0으로</button>
        </div>
        <input
          className="timing-offset-range"
          type="range"
          min={TIMING_OFFSET_MIN_MS}
          max={TIMING_OFFSET_MAX_MS}
          step={TIMING_OFFSET_STEP_MS}
          value={offset}
          onChange={(event) => onChange(normalizeTimingOffsetMs(Number(event.target.value)))}
          aria-label="타이밍 오프셋"
        />
        <div className="timing-offset-scale"><span>{TIMING_OFFSET_MIN_MS}ms</span><span>0</span><span>+{TIMING_OFFSET_MAX_MS}ms</span></div>
      </div>

      <div className={`timing-calibration ${phase}`}>
        {phase === "idle" && (
          <>
            <span className="calibration-kicker">AUTO CALIBRATION</span>
            <strong>박자에 맞춰 탭해서 자동 보정</strong>
            <p>16번의 클릭음을 듣고 버튼을 탭하세요. 처음 {CALIBRATION_DISCARD_SAMPLES}회는 적응 구간으로 계산에서 제외합니다.</p>
            <button type="button" className="calibration-start" onClick={startCalibration}>보정 시작</button>
          </>
        )}

        {phase === "running" && (
          <>
            <span className="calibration-kicker">CALIBRATING</span>
            <strong>{beat === 0 ? "준비…" : `${beat} / ${CALIBRATION_TOTAL_BEATS}`}</strong>
            <p>{accepted}회 입력됨 · 소리가 들리는 순간 탭</p>
            <button type="button" className="calibration-tap" onPointerDown={(event) => { event.preventDefault(); recordTap(); }}>TAP</button>
          </>
        )}

        {phase === "result" && estimate && (
          <>
            <span className="calibration-kicker">CALIBRATION RESULT</span>
            <strong>추천 {formatOffset(estimate.offsetMs)}</strong>
            <p>
              유효 {estimate.sampleCount}회 · 흔들림 {Math.round(estimate.stddevMs)}ms
              {estimate.unstable ? " · 입력 편차가 커서 한 번 더 측정하는 것을 권장합니다." : " · 측정이 안정적입니다."}
            </p>
            <div className="calibration-result-actions">
              <button type="button" onClick={() => { onChange(estimate.offsetMs); setPhase("idle"); }}>적용</button>
              <button type="button" onClick={startCalibration}>다시 측정</button>
              <button type="button" onClick={() => setPhase("idle")}>닫기</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
