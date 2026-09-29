#!/usr/bin/env python3
"""
실제 음악 없이 파이프라인을 검증하기 위한 합성 WAV 생성기. 결과는 결정론적이다.

  kick_120.wav     일정한 120 BPM 킥 (4분음표)
  fast_180.wav     180 BPM 킥(4분) + 하이햇(8분) + 스네어(2,4박)
  accent.wav       128 BPM, 16분음표 강-약-약-약 반복
  bands.wav        120 BPM 8분음표로 low/mid/high 음이 번갈아 나옴
  silence.wav      무음 5초
  short.wav        0.3초
  corrupt.wav      WAV 헤더만 흉내 낸 손상 파일
"""
from __future__ import annotations

import os
import sys

import numpy as np
import soundfile as sf

SR = 22050


def _env(n: int, decay: float) -> np.ndarray:
    return np.exp(-np.linspace(0, decay, n))


def kick(sr: int = SR, dur: float = 0.18) -> np.ndarray:
    n = int(sr * dur)
    t = np.arange(n) / sr
    freq = 120 * np.exp(-t * 18) + 45  # 피치 하강
    phase = 2 * np.pi * np.cumsum(freq) / sr
    return np.sin(phase) * _env(n, 9)


def hat(sr: int = SR, dur: float = 0.05, seed: int = 0) -> np.ndarray:
    n = int(sr * dur)
    noise = np.random.default_rng(seed).standard_normal(n)
    hp = np.diff(noise, prepend=0.0)  # 간단한 고역 강조
    return hp * _env(n, 12) * 0.35


def snare(sr: int = SR, dur: float = 0.14, seed: int = 1) -> np.ndarray:
    n = int(sr * dur)
    t = np.arange(n) / sr
    noise = np.random.default_rng(seed).standard_normal(n) * 0.5
    tone = np.sin(2 * np.pi * 190 * t) * 0.5
    return (noise + tone) * _env(n, 10) * 0.7


def tone(freq: float, sr: int = SR, dur: float = 0.12) -> np.ndarray:
    n = int(sr * dur)
    t = np.arange(n) / sr
    attack = np.minimum(1.0, np.arange(n) / (0.003 * sr))
    return np.sin(2 * np.pi * freq * t) * attack * _env(n, 7) * 0.8


def place(buf: np.ndarray, sample: np.ndarray, at_sec: float, gain: float = 1.0, sr: int = SR) -> None:
    i = int(round(at_sec * sr))
    if i >= len(buf):
        return
    end = min(len(buf), i + len(sample))
    buf[i:end] += sample[: end - i] * gain


def _finish(buf: np.ndarray) -> np.ndarray:
    peak = np.max(np.abs(buf))
    return (buf / peak * 0.9).astype(np.float32) if peak > 0 else buf.astype(np.float32)


LEAD_IN = 1.0  # 첫 노트 전 여유


def make_kick_120(duration: float = 16.0) -> np.ndarray:
    buf = np.zeros(int(SR * duration))
    beat = 60 / 120
    t = LEAD_IN
    while t < duration - 0.3:
        place(buf, kick(), t)
        t += beat
    return _finish(buf)


def make_fast_180(duration: float = 16.0) -> np.ndarray:
    buf = np.zeros(int(SR * duration))
    beat = 60 / 180
    i = 0
    t = LEAD_IN
    while t < duration - 0.3:
        place(buf, kick(), t)
        if i % 2 == 1:
            place(buf, snare(seed=i), t, 0.9)
        place(buf, hat(seed=i), t + beat / 2, 0.8)
        t += beat
        i += 1
    return _finish(buf)


def make_accent(duration: float = 16.0) -> np.ndarray:
    buf = np.zeros(int(SR * duration))
    sixteenth = 60 / 128 / 4
    i = 0
    t = LEAD_IN
    while t < duration - 0.3:
        gain = 1.0 if i % 4 == 0 else 0.25
        place(buf, kick() if i % 4 == 0 else hat(seed=i) * 2.5, t, gain)
        t += sixteenth
        i += 1
    return _finish(buf)


def make_bands(duration: float = 16.0) -> np.ndarray:
    buf = np.zeros(int(SR * duration))
    eighth = 60 / 120 / 2
    freqs = [70.0, 700.0, 5000.0]  # low / mid / high
    i = 0
    t = LEAD_IN
    while t < duration - 0.3:
        place(buf, tone(freqs[i % 3]), t)
        t += eighth
        i += 1
    return _finish(buf)


SYNTHS = {
    "kick_120.wav": make_kick_120,
    "fast_180.wav": make_fast_180,
    "accent.wav": make_accent,
    "bands.wav": make_bands,
}


def write_all(out_dir: str) -> dict[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    for name, fn in SYNTHS.items():
        p = os.path.join(out_dir, name)
        sf.write(p, fn(), SR)
        paths[name] = p
    p = os.path.join(out_dir, "silence.wav")
    sf.write(p, np.zeros(SR * 5, dtype=np.float32), SR)
    paths["silence.wav"] = p
    p = os.path.join(out_dir, "short.wav")
    sf.write(p, make_kick_120()[: int(SR * 0.3)], SR)
    paths["short.wav"] = p
    p = os.path.join(out_dir, "corrupt.wav")
    with open(p, "wb") as f:
        f.write(b"RIFF\x24\x00\x00\x00WAVEfmt garbage-not-audio" * 4)
    paths["corrupt.wav"] = p
    return paths


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
    for k, v in write_all(out).items():
        print(k, "->", v)

# ---------------- v0.3 stress fixtures ----------------
# These deliberately approximate failure modes seen in mixed music rather than clean click tracks.

def _add_echoes(buf: np.ndarray, delays_gains: tuple[tuple[float, float], ...]) -> np.ndarray:
    out = buf.astype(np.float64, copy=True)
    for delay, gain in delays_gains:
        shift = int(round(delay * SR))
        if 0 < shift < len(buf):
            out[shift:] += buf[:-shift] * gain
    return _finish(out)


def make_reverb_120(duration: float = 16.0) -> np.ndarray:
    """120 BPM drums with short tails that can create duplicate onsets."""
    dry = np.zeros(int(SR * duration))
    beat = 60 / 120
    i = 0
    t = LEAD_IN
    while t < duration - 0.5:
        place(dry, kick(), t, 1.0)
        if i % 2:
            place(dry, snare(seed=500 + i), t, 0.65)
        place(dry, hat(seed=800 + i), t + beat / 2, 0.38)
        t += beat
        i += 1
    return _add_echoes(_finish(dry), ((0.032, 0.24), (0.071, 0.13), (0.145, 0.07)))


def make_hat_storm_140(duration: float = 16.0) -> np.ndarray:
    """Strong quarter-note kick under busy 16th high-frequency material."""
    buf = np.zeros(int(SR * duration))
    beat = 60 / 140
    sixteenth = beat / 4
    i = 0
    t = LEAD_IN
    while t < duration - 0.3:
        if i % 4 == 0:
            place(buf, kick(), t, 1.0)
        # deliberately dense but weak high-frequency transients
        gain = 0.22 if i % 4 else 0.10
        place(buf, hat(seed=1300 + i), t, gain)
        t += sixteenth
        i += 1
    return _finish(buf)


def make_sustained_100(duration: float = 16.0) -> np.ndarray:
    """Slowly changing sustained tones plus sparse rhythmic attacks."""
    buf = np.zeros(int(SR * duration))
    beat = 60 / 100
    t_axis = np.arange(len(buf)) / SR
    # continuous pad/vocal-like body with amplitude modulation; should not become hundreds of notes
    vibrato = 4.8 * np.sin(2 * np.pi * 5.2 * t_axis)
    phase = 2 * np.pi * np.cumsum(330.0 + vibrato) / SR
    body = np.sin(phase) * (0.16 + 0.04 * np.sin(2 * np.pi * 0.7 * t_axis))
    fade = np.clip((t_axis - 0.25) / 0.7, 0, 1) * np.clip((duration - t_axis) / 0.7, 0, 1)
    buf += body * fade
    i = 0
    t = LEAD_IN
    while t < duration - 0.5:
        place(buf, kick(), t, 0.7 if i % 4 else 1.0)
        if i % 2:
            place(buf, tone(880, dur=0.18), t + beat / 2, 0.35)
        t += beat
        i += 1
    return _finish(buf)


def make_overlap_150(duration: float = 16.0) -> np.ndarray:
    """Kick, bass and bright transient arriving almost together."""
    buf = np.zeros(int(SR * duration))
    beat = 60 / 150
    i = 0
    t = LEAD_IN
    while t < duration - 0.4:
        place(buf, kick(), t, 0.9)
        place(buf, tone(82, dur=0.24), t + 0.012, 0.72)
        place(buf, hat(seed=1800 + i), t + 0.021, 0.34)
        if i % 2:
            place(buf, snare(seed=2000 + i), t, 0.45)
        t += beat
        i += 1
    return _finish(buf)


def make_tempo_change(duration: float = 18.0) -> np.ndarray:
    """First half 120 BPM, second half 160 BPM. Global tempo is intentionally ambiguous."""
    buf = np.zeros(int(SR * duration))
    t = LEAD_IN
    split = duration / 2
    i = 0
    while t < duration - 0.4:
        bpm = 120 if t < split else 160
        beat = 60 / bpm
        place(buf, kick(), t, 1.0)
        place(buf, hat(seed=2400 + i), t + beat / 2, 0.35)
        t += beat
        i += 1
    return _finish(buf)


def _slow_tone(freq: float, dur: float = 0.38) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    attack = np.clip(t / 0.085, 0.0, 1.0)
    release = np.exp(-np.maximum(0.0, t - 0.12) * 5.0)
    return np.sin(2 * np.pi * freq * t) * attack * release * 0.7


def make_slow_attack_90(duration: float = 16.0) -> np.ndarray:
    """Soft/slow attacks that are harder for onset detectors than percussion."""
    buf = np.zeros(int(SR * duration))
    beat = 60 / 90
    freqs = (220.0, 330.0, 440.0, 550.0)
    i = 0
    t = LEAD_IN
    while t < duration - 0.5:
        place(buf, _slow_tone(freqs[i % len(freqs)]), t, 1.0)
        if i % 4 == 0:
            place(buf, kick(), t, 0.28)
        t += beat
        i += 1
    return _finish(buf)


def make_swing_120(duration: float = 16.0) -> np.ndarray:
    """120 BPM swung eighths (2:1). Some events are intentionally off the straight grid."""
    buf = np.zeros(int(SR * duration))
    beat = 60 / 120
    i = 0
    t = LEAD_IN
    while t < duration - 0.5:
        place(buf, kick(), t, 0.95)
        place(buf, hat(seed=3000 + i), t + beat * (2 / 3), 0.55)
        if i % 2:
            place(buf, snare(seed=3200 + i), t, 0.55)
        t += beat
        i += 1
    return _finish(buf)


STRESS_SYNTHS = {
    "reverb_120.wav": make_reverb_120,
    "hat_storm_140.wav": make_hat_storm_140,
    "sustained_100.wav": make_sustained_100,
    "overlap_150.wav": make_overlap_150,
    "tempo_change.wav": make_tempo_change,
    "slow_attack_90.wav": make_slow_attack_90,
    "swing_120.wav": make_swing_120,
}


def write_stress(out_dir: str) -> dict[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    paths: dict[str, str] = {}
    for name, fn in STRESS_SYNTHS.items():
        p = os.path.join(out_dir, name)
        sf.write(p, fn(), SR)
        paths[name] = p
    return paths
