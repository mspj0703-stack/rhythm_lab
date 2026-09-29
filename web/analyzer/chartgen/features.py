"""
1단계: Audio Analysis.

오디오 파일 -> AudioFeatures. 이 단계는 게임 규칙을 모르며 음악 신호 특징만 뽑는다.
v0.3부터 실제 곡의 half/double/3:2 tempo 오류를 추적할 수 있도록 tempo 후보와
로컬 대비 기반 분석을 위한 원시 특징을 함께 보존한다.
"""
from __future__ import annotations

import logging
import math
import os
import resource
import time
from dataclasses import dataclass, field

import librosa
import numpy as np
import soundfile as sf

from . import config as C
from .errors import AudioLoadError

LOGGER = logging.getLogger("uvicorn.error")


def log_stage(stage: str, started: float) -> None:
    """Expose stage timing and process high-water RSS in Railway logs."""
    LOGGER.info(
        "analysis stage=%s elapsed=%.2fs peak_rss_mb=%.1f",
        stage,
        time.monotonic() - started,
        resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
    )


@dataclass
class TempoCandidate:
    bpm: float
    grid_fit: float
    confidence: float
    ratio_from_initial: float
    beat_accent: float = 0.0
    selected: bool = False

    def to_dict(self) -> dict:
        return {
            "bpm": round(float(self.bpm), 2),
            "gridFit": round(float(self.grid_fit), 4) if math.isfinite(self.grid_fit) else None,
            "confidence": round(float(self.confidence), 4),
            "ratioFromInitial": round(float(self.ratio_from_initial), 4),
            "beatAccent": round(float(self.beat_accent), 4),
            "selected": bool(self.selected),
        }


@dataclass
class AudioFeatures:
    sr: int
    hop_length: int
    duration: float
    bpm: float
    beat_times: np.ndarray
    onset_frames: np.ndarray
    onset_times: np.ndarray
    onset_env: np.ndarray
    rms: np.ndarray
    rms_max_raw: float
    spectral_centroid: np.ndarray
    band_onset: dict[str, np.ndarray] = field(default_factory=dict)
    band_energy: dict[str, np.ndarray] = field(default_factory=dict)
    tempo_candidates: list[TempoCandidate] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def is_silent(self) -> bool:
        return self.rms_max_raw < C.SILENCE_RMS_THRESHOLD

    @property
    def bpm_confidence(self) -> float:
        selected = next((x for x in self.tempo_candidates if x.selected), None)
        return float(selected.confidence) if selected else (1.0 if self.bpm > 0 else 0.0)

    def frame_to_time(self, frame: int) -> float:
        return float(frame * self.hop_length / self.sr)

    def to_summary(self) -> dict:
        return {
            "sr": self.sr,
            "hopLength": self.hop_length,
            "duration": round(self.duration, 3),
            "bpm": round(self.bpm, 2),
            "bpmConfidence": round(self.bpm_confidence, 4),
            "tempoCandidates": [x.to_dict() for x in self.tempo_candidates],
            "beatTimes": [round(float(t), 4) for t in self.beat_times],
            "onsetTimes": [round(float(t), 4) for t in self.onset_times],
            "onsetStrengths": [round(float(self.onset_env[f]), 4) for f in self.onset_frames],
            "meanRms": round(float(self.rms.mean()) if self.rms.size else 0.0, 4),
            "meanSpectralCentroid": round(float(self.spectral_centroid.mean()) if self.spectral_centroid.size else 0.0, 1),
            "bandEnergyMean": {k: round(float(v.mean()) if v.size else 0.0, 4) for k, v in self.band_energy.items()},
            "isSilent": self.is_silent,
            "warnings": list(self.warnings),
        }


# soundfile(libsndfile)이 압축 해제 없이 직접 읽을 수 있는 포맷.
# librosa.load는 이 경우에도 내부적으로 훨씬 큰 임시 버퍼를 만든다(측정치는
# memory-fix-v0.3.2.md 참고) — Android Companion이 보내는 22.05kHz mono WAV가
# 정확히 이 경로에 해당한다. 그 외 포맷(mp3/m4a/aac/webm/mp4)은 압축 해제가
# 필요해 기존 librosa.load(내부적으로 audioread/ffmpeg 사용)를 그대로 쓴다.
SOUNDFILE_NATIVE_EXTENSIONS = {".wav", ".flac", ".ogg", ".aif", ".aiff"}


def _load_via_soundfile(path: str) -> tuple[np.ndarray, int]:
    y, file_sr = sf.read(path, dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1).astype(np.float32, copy=False)  # 스테레오 등 -> 모노 다운믹스
    if file_sr != C.SAMPLE_RATE:
        y = librosa.resample(y, orig_sr=file_sr, target_sr=C.SAMPLE_RATE, res_type="soxr_hq")
    return np.ascontiguousarray(y, dtype=np.float32), C.SAMPLE_RATE


def load_audio(path: str) -> tuple[np.ndarray, int]:
    if not os.path.isfile(path):
        raise AudioLoadError(f"오디오 파일을 찾을 수 없습니다: {path}")
    if os.path.getsize(path) == 0:
        raise AudioLoadError(f"빈 파일입니다: {path}")

    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in SOUNDFILE_NATIVE_EXTENSIONS:
            try:
                y, sr = _load_via_soundfile(path)
            except sf.SoundFileError:
                # 확장자는 .wav/.flac 등이지만 실제 내용이 다른 경우, 기존 경로로 한 번 더 시도.
                y, sr = librosa.load(path, sr=C.SAMPLE_RATE, mono=True)
        else:
            y, sr = librosa.load(path, sr=C.SAMPLE_RATE, mono=True)
    except Exception as e:
        raise AudioLoadError(f"오디오를 디코딩할 수 없습니다: {path} ({type(e).__name__}: {e})") from e
    if y.ndim != 1:
        raise AudioLoadError("모노 변환에 실패했습니다.")
    if not np.all(np.isfinite(y)):
        raise AudioLoadError("오디오에 NaN/Inf 샘플이 포함되어 있습니다.")
    return y, int(sr)


def _normalize(a: np.ndarray) -> np.ndarray:
    if a.size == 0:
        return a
    m = float(np.max(a))
    return a / m if m > 0 else np.zeros_like(a)


def _empty_features(sr: int, duration: float, rms_max_raw: float, warning: str) -> AudioFeatures:
    empty = np.array([], dtype=float)
    return AudioFeatures(
        sr=sr,
        hop_length=C.HOP_LENGTH,
        duration=duration,
        bpm=0.0,
        beat_times=empty,
        onset_frames=np.array([], dtype=int),
        onset_times=empty,
        onset_env=empty,
        rms=empty,
        rms_max_raw=rms_max_raw,
        spectral_centroid=empty,
        band_onset={k: empty for k in C.FREQUENCY_BANDS},
        band_energy={k: empty for k in C.FREQUENCY_BANDS},
        tempo_candidates=[],
        warnings=[warning],
    )


def grid_fit_score(beat_times: np.ndarray, duration: float, onset_times: np.ndarray, weights: np.ndarray) -> float:
    """onset들이 1/8 grid에 얼마나 잘 맞는지. 0에 가까울수록 좋다."""
    from .beatgrid import BeatGrid

    grid = BeatGrid.from_beats(beat_times, duration, subdivisions=2)
    if grid.is_empty or onset_times.size == 0:
        return float("inf")
    eighth = grid.sixteenth_interval
    offs = np.array([abs(grid.quantize(float(t), threshold_sec=1e9).offset_sec) for t in onset_times]) / eighth
    w = weights if weights.size == onset_times.size and weights.sum() > 0 else np.ones_like(offs)
    return float(np.sum(offs * w) / np.sum(w))


def _beat_accent_score(beat_times: np.ndarray, onset_times: np.ndarray, weights: np.ndarray) -> float:
    """Strong-event mass that lands on candidate quarter-note beats (0..1)."""
    if beat_times.size < 2 or onset_times.size == 0:
        return 0.0
    interval = float(np.median(np.diff(beat_times)))
    tol = min(C.TEMPO_BEAT_ACCENT_TOLERANCE_SEC, interval * C.TEMPO_BEAT_ACCENT_TOLERANCE_FRACTION)
    idx = np.clip(np.searchsorted(beat_times, onset_times), 1, beat_times.size - 1)
    dist = np.minimum(np.abs(onset_times - beat_times[idx - 1]), np.abs(onset_times - beat_times[idx]))
    w = weights if weights.size == onset_times.size and weights.sum() > 0 else np.ones_like(onset_times)
    return float(np.sum(w[dist <= tol]) / np.sum(w))


def _tempo_evaluations(
    onset_env_raw: np.ndarray,
    sr: int,
    hop: int,
    duration: float,
    initial_bpm: float,
    initial_beats: np.ndarray,
    onset_times: np.ndarray,
    onset_strengths: np.ndarray,
) -> list[tuple[float, float, np.ndarray, float, float]]:
    """(grid_fit, bpm, beat_times, ratio_from_initial, beat_accent) 후보 목록."""
    if initial_bpm <= 0:
        return []

    requested: list[tuple[float, float]] = [(initial_bpm, 1.0)]
    requested.extend((initial_bpm * r, r) for r in C.TEMPO_REFINE_RATIOS)
    seen: set[int] = set()
    out: list[tuple[float, float, np.ndarray, float, float]] = []

    for cand, ratio in requested:
        if not C.TEMPO_MIN_BPM <= cand <= C.TEMPO_MAX_BPM:
            continue
        key = int(round(cand * 10))
        if key in seen:
            continue
        seen.add(key)
        if abs(ratio - 1.0) < 1e-9:
            bpm2 = float(initial_bpm)
            bt2 = np.asarray(initial_beats, dtype=float)
        else:
            t2, bf2 = librosa.beat.beat_track(onset_envelope=onset_env_raw, sr=sr, hop_length=hop, bpm=cand)
            bpm2 = float(np.atleast_1d(t2)[0])
            bt2 = librosa.frames_to_time(bf2, sr=sr, hop_length=hop)
        score = grid_fit_score(bt2, duration, onset_times, onset_strengths)
        accent = _beat_accent_score(np.asarray(bt2, dtype=float), onset_times, onset_strengths)
        out.append((score, bpm2, np.asarray(bt2, dtype=float), ratio, accent))
    return out

def _candidates_for_report(
    evaluations: list[tuple[float, float, np.ndarray, float, float]], selected_bpm: float
) -> list[TempoCandidate]:
    finite = [x for x in evaluations if math.isfinite(x[0])]
    if not finite:
        return []
    raw = [math.exp(-C.TEMPO_CONFIDENCE_SCALE * max(0.0, x[0])) for x in finite]
    total = sum(raw) or 1.0
    ranked: list[TempoCandidate] = []
    for ev, weight in zip(finite, raw, strict=True):
        score, bpm, _, ratio, beat_accent = ev
        ranked.append(
            TempoCandidate(
                bpm=bpm,
                grid_fit=score,
                confidence=weight / total,
                ratio_from_initial=ratio,
                beat_accent=beat_accent,
                selected=abs(bpm - selected_bpm) < 0.75,
            )
        )
    ranked.sort(key=lambda x: (not x.selected, -x.confidence, x.grid_fit))
    return ranked[: C.TEMPO_CANDIDATE_LIMIT]

def refine_tempo(
    onset_env_raw: np.ndarray,
    sr: int,
    hop: int,
    duration: float,
    bpm: float,
    beat_times: np.ndarray,
    onset_times: np.ndarray,
    onset_strengths: np.ndarray,
) -> tuple[float, np.ndarray, list[TempoCandidate]]:
    """배수 관계 tempo 오류를 보정하고 후보/신뢰도를 함께 반환한다."""
    if bpm <= 0 or onset_times.size < 8 or beat_times.size < 2:
        return bpm, beat_times, []

    evaluations = _tempo_evaluations(
        onset_env_raw, sr, hop, duration, bpm, beat_times, onset_times, onset_strengths
    )
    if not evaluations:
        return bpm, beat_times, []

    base = next((x for x in evaluations if abs(x[3] - 1.0) < 1e-9), evaluations[0])
    selected = base
    if base[0] > C.TEMPO_REFINE_GOOD_ENOUGH:
        # Normal correction: switch only when grid fit improves *and* strong-beat
        # evidence does not materially get worse. This avoids choosing a mathematically
        # neat but musically wrong multiple such as 128 -> ~86 BPM on dense 16ths.
        for candidate in sorted(evaluations, key=lambda x: x[0]):
            if (
                candidate[0] < base[0] - C.TEMPO_REFINE_MIN_IMPROVEMENT
                and candidate[4] >= base[4] - C.TEMPO_REFINE_MAX_ACCENT_DROP
            ):
                selected = candidate
                break

    # Half/double-tempo is special: a 75-BPM eighth grid can fit 150-BPM quarter attacks
    # perfectly, so a small grid-fit value alone is not sufficient evidence. This check runs
    # even when the base grid already looks "good".
    octave_candidates = [x for x in evaluations if abs(x[3] - 2.0) < 1e-9 or abs(x[3] - 0.5) < 1e-9]
    base_combined = base[0] - C.TEMPO_BEAT_ACCENT_WEIGHT * base[4]
    for candidate in octave_candidates:
        combined = candidate[0] - C.TEMPO_BEAT_ACCENT_WEIGHT * candidate[4]
        accent_gain = candidate[4] - base[4]
        if (
            accent_gain >= C.TEMPO_OCTAVE_ACCENT_GAIN
            and combined <= base_combined - C.TEMPO_OCTAVE_SELECTION_GAIN
        ):
            selected = candidate
            break

    candidates = _candidates_for_report(evaluations, selected[1])
    return float(selected[1]), np.asarray(selected[2], dtype=float), candidates


def refine_phase(beat_times: np.ndarray, onset_times: np.ndarray, onset_strengths: np.ndarray) -> np.ndarray:
    if beat_times.size < 2 or onset_times.size == 0:
        return beat_times
    interval = float(np.median(np.diff(beat_times)))
    w = onset_strengths**2 if onset_strengths.size == onset_times.size else np.ones_like(onset_times)
    tol = min(C.QUANTIZE_THRESHOLD_SEC, interval / 4 * C.QUANTIZE_MAX_FRACTION_OF_16TH)

    def score(beats: np.ndarray) -> float:
        idx = np.clip(np.searchsorted(beats, onset_times), 1, beats.size - 1)
        d = np.minimum(np.abs(onset_times - beats[idx - 1]), np.abs(onset_times - beats[idx]))
        return float(np.sum(w[d <= tol]))

    base = score(beat_times)
    best_shift, best_score = 0.0, base
    for k in (1, 2, 3):
        shift = k * interval / 4
        s = score(beat_times + shift)
        if s > best_score * C.PHASE_REFINE_MIN_GAIN:
            best_shift, best_score = shift, s
    if best_shift == 0.0:
        return beat_times
    shifted = beat_times + best_shift
    if shifted[0] - interval > 0:
        shifted = np.concatenate([[shifted[0] - interval], shifted])
    return shifted


def estimate_initial_bpm_light(
    onset_env_raw: np.ndarray,
    sr: int,
    hop_length: int,
    ac_size: float = C.TEMPO_ESTIMATION_AC_SIZE_SEC,
    start_bpm: float = 120.0,
    std_bpm: float = 1.0,
    max_tempo: float = 320.0,
) -> float:
    """
    librosa.beat.beat_track(bpm=None)이 내부적으로 호출하는 tempo 추정기(librosa.feature.tempo)는
    onset envelope 전체에 대해 (win_length, n_frames) 크기의 windowed autocorrelation을 만든 뒤
    시간축으로 평균낸다. win_length(~ac_size초 분량 프레임 수) x n_frames 크기의 dense float64
    배열이 곡 길이에 비례해 커져서, 몇 분짜리 곡에서 수백 MB를 차지한다
    (측정치는 memory-fix-v0.3.2.md 참고).

    "여러 짧은 윈도우의 자기상관을 평균"하는 것은, 템포가 일정한 신호에서는
    "전체 신호를 한 번 전역 자기상관"한 것과 근사적으로 같은 결과를 준다. 그래서 여기서는
    win_length x n_frames 텐서를 만들지 않고 onset envelope 전체를 그대로 한 번만
    자기상관(1차원, O(n_frames))해서 같은 로그정규 사전분포로 최적 BPM을 고른다.
    해상도는 그대로(HOP_LENGTH) 유지하므로 기존 tempo() 대비 정밀도 저하가 없다.
    """
    if onset_env_raw.size < 2:
        return 0.0
    max_size = int(round(ac_size * sr / hop_length))
    if max_size < 2:
        return 0.0

    ac = librosa.autocorrelate(onset_env_raw, max_size=max_size)
    ac = librosa.util.normalize(ac, norm=np.inf)  # librosa.feature.tempogram과 동일한 정규화 (log1p 도메인 보호)
    bpms = librosa.tempo_frequencies(len(ac), hop_length=hop_length, sr=sr)
    with np.errstate(divide="ignore"):
        logprior = -0.5 * ((np.log2(np.maximum(bpms, 1e-9)) - np.log2(start_bpm)) / std_bpm) ** 2
    if max_tempo is not None and np.any(bpms < max_tempo):
        max_idx = int(np.argmax(bpms < max_tempo))
        logprior[:max_idx] = -np.inf
    best = int(np.argmax(np.log1p(1e6 * ac) + logprior))
    return float(bpms[best])


def rms_from_signal(y: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    """
    librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)와
    수치적으로 동일한 결과를, O(frame_length x n_frames) 대신 O(len(y))
    메모리로 계산한다 (제곱값의 누적합을 이용한 슬라이딩 윈도우).

    frame_length=2048, hop_length=256처럼 겹침이 큰 설정에서 원래 방식은
    (frame_length x n_frames) 크기의 조밀한 배열을 만들어 곡이 길어질수록
    수백 MB를 차지한다 (측정치는 memory-fix-v0.3.2.md 참고).
    """
    pad = frame_length // 2
    n = len(y)
    if n == 0:
        return np.array([0.0], dtype=np.float32)

    # 제곱값의 누적합 하나만 float64로 보관한다 (n_frames 배열이 아니라 len(y) 크기 O(n)).
    sq_cumsum = np.concatenate(([0.0], np.cumsum(y.astype(np.float64) ** 2)))

    n_frames = 1 + (n + 2 * pad - frame_length) // hop_length
    starts = np.arange(n_frames) * hop_length - pad  # 패딩 적용 전 좌표계 기준 프레임 시작 위치

    lo = np.clip(starts, 0, n)
    hi = np.clip(starts + frame_length, 0, n)
    window_sum = sq_cumsum[hi] - sq_cumsum[lo]
    return np.sqrt(window_sum / frame_length).astype(np.float32)


def spectral_centroid_light(S: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    """
    librosa.feature.spectral_centroid(S=S)와 수치적으로 동일한 결과를 낸다
    (검증: 6분 합성곡에서 최대 절대오차 ~0.001Hz, 값 자체는 수백~수천Hz 대).

    librosa 구현은 `util.normalize(S, norm=1, axis=-2)`로 S 전체 크기의 복사본을
    만든 뒤 freq와 다시 곱해 또 하나의 S 크기 배열을 만든다 (S가 이미 커다란
    상태에서 임시로 +2배 크기가 추가로 필요해짐). 이 값은 리포트의
    meanSpectralCentroid 표시에만 쓰이고 채보 생성 로직에는 쓰이지 않으므로,
    가중합/합계를 바로 축약해 큰 임시 배열이 남지 않게 계산한다.
    """
    weighted = (freqs[:, None] * S).sum(axis=0)
    total = S.sum(axis=0)
    return np.divide(weighted, total, out=np.zeros_like(weighted), where=total > 0)


def onset_envelope_chunked(
    y: np.ndarray,
    sr: int,
    n_fft: int,
    hop_length: int,
    chunk_seconds: float = C.SPECTRAL_CHUNK_SECONDS,
) -> np.ndarray:
    """
    librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)와
    bit-for-bit 동일한 결과를 내지만(검증: 여러 합성곡에서 최대오차 0.0),
    전체곡 길이의 선형 STFT((n_fft/2+1) x n_frames, 8분 곡 기준 peak +627MB)를
    한 번에 만들지 않는다.

    onset_strength(y=..)는 내부적으로 (1) 선형 STFT -> mel 필터뱅크로 축약(멜 스펙트로그램,
    기본 128 x n_frames — 선형 스펙트로그램보다 8배 이상 작음) (2) `power_to_db(mel, ref=1.0)`
    (ref가 고정 상수라 청크와 무관) (3) `mean_f max(0, db[t+1]-db[t])` (이웃 프레임 1개만 필요)
    순서로 계산한다. 그래서:

      - 비싼 선형 STFT만 시간축 청크로 나눠 처리하고, 즉시 훨씬 작은 멜 스펙트로그램으로
        축약해 이어붙인다 (선형 스펙트로그램 자체는 절대 전체 곡 길이로 보관하지 않음).
      - 다 이어붙인 뒤에는 멜 스펙트로그램 자체가 이미 작으므로(8분 곡 기준 약 21MB),
        나머지 db 변환/차분/패딩은 원래 코드와 동일하게 "한 번에" 계산해도 메모리 문제가 없다.
        (band 계산과 달리 여기서는 ref가 고정 상수라 2-pass가 필요 없다.)
    """
    pad = n_fft // 2
    y_padded = np.pad(y, (pad, pad), mode="constant")
    n_frames = 1 + (len(y_padded) - n_fft) // hop_length
    mel_basis = librosa.filters.mel(sr=sr, n_fft=n_fft, fmax=0.5 * sr)
    chunk_frames = max(hop_length, int(round(chunk_seconds * sr / hop_length)))

    mel_parts = []
    f = 0
    while f < n_frames:
        f_end = min(f + chunk_frames, n_frames)
        s0 = f * hop_length
        s1 = (f_end - 1) * hop_length + n_fft
        S_chunk = np.abs(librosa.stft(y_padded[s0:s1], n_fft=n_fft, hop_length=hop_length, center=False)) ** 2.0
        mel_parts.append((mel_basis @ S_chunk).astype(np.float32))
        f = f_end
    mel_power = np.concatenate(mel_parts, axis=1)
    del mel_parts

    log_spec = 10.0 * np.log10(np.maximum(1e-10, mel_power))
    log_spec = np.maximum(log_spec, log_spec.max() - 80.0)  # power_to_db 기본 top_db=80.0과 동일

    lag = 1
    onset_env = np.maximum(0.0, log_spec[:, lag:] - log_spec[:, :-lag]).mean(axis=0)
    pad_width = lag + n_fft // (2 * hop_length)
    return np.pad(onset_env, (pad_width, 0), mode="constant")[:n_frames].astype(np.float32, copy=False)


def compute_spectral_band_features_chunked(
    y: np.ndarray,
    sr: int,
    n_fft: int,
    hop_length: int,
    freq_bands: dict[str, tuple[float, float]],
    chunk_seconds: float = C.SPECTRAL_CHUNK_SECONDS,
) -> tuple[np.ndarray, dict[str, np.ndarray], dict[str, np.ndarray], int, np.ndarray]:
    """
    centroid, band_energy(대역별 에너지), band_onset(대역별 onset strength)을
    전체 곡 길이의 STFT(S)를 한 번에 메모리에 올리지 않고 시간축 청크 단위로 계산한다.

    아래 세 계산은 전부 "각 시간 프레임에서 같은 청크 안의 값만으로 정해지는" 연산이라
    수학적으로 청크 단위로 나눠 계산해도 전체를 한 번에 계산한 것과 정확히 같은 결과를 준다:

    - centroid = sum(freq*S)/sum(S) : 프레임별 가중합/합계를 즉시 축약하면 됨.
    - band_energy = Sb.sum(axis=0) : 프레임별 합.
    - band_onset = onset_strength(power_to_db(Sb**2, ref=np.max), lag=1, max_size=1) :
      공식이 `max(0, db[t+1]-db[t])`이므로 이웃 프레임 1개만 있으면 청크 경계를 넘길 수 있다.
      단 `ref=np.max`와 top_db 클리핑이 "전체 곡"의 최댓값을 기준으로 하므로,
      1차 패스에서 대역별 전역 최댓값을 먼저 구하고, 2차 패스에서 그 값을 고정 ref로
      써서 청크별로 재계산한다 (power_to_db가 전역 스칼라 ref를 넘기면 두 방식은
      부동소수점 오차 수준까지 동일함 — 아래 문서/테스트로 검증됨).

    onset 알고리즘 자체(파라미터, 결과)는 원래 구현과 동일하게 유지하고,
    "한 번에 계산하느냐 청크로 나눠 계산하느냐"만 바뀐다.
    """
    pad = n_fft // 2
    y_padded = np.pad(y, (pad, pad), mode="constant")
    n_frames = 1 + (len(y_padded) - n_fft) // hop_length
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band_masks = {name: (freqs >= lo) & (freqs < hi) for name, (lo, hi) in freq_bands.items()}

    chunk_frames = max(hop_length, int(round(chunk_seconds * sr / hop_length)))
    lag = 1  # librosa.onset.onset_strength 기본값과 동일

    def frame_slice(f0: int, f1: int) -> np.ndarray:
        s0 = f0 * hop_length
        s1 = (f1 - 1) * hop_length + n_fft
        return y_padded[s0:s1]

    # ---------- Pass 1: centroid + band_energy(그대로 채택) + 대역별 전역 max(Sb**2) ----------
    centroid_weighted = np.empty(n_frames, dtype=np.float64)
    centroid_total = np.empty(n_frames, dtype=np.float64)
    band_energy_raw = {name: np.empty(n_frames, dtype=np.float32) for name in freq_bands}
    band_power_max = {name: 0.0 for name in freq_bands}

    f = 0
    while f < n_frames:
        f_end = min(f + chunk_frames, n_frames)
        S_chunk = np.abs(librosa.stft(frame_slice(f, f_end), n_fft=n_fft, hop_length=hop_length, center=False))

        centroid_weighted[f:f_end] = (freqs[:, None] * S_chunk).sum(axis=0)
        centroid_total[f:f_end] = S_chunk.sum(axis=0)

        for name, mask in band_masks.items():
            Sb = S_chunk[mask, :]
            if Sb.size == 0:
                band_energy_raw[name][f:f_end] = 0.0
                continue
            band_energy_raw[name][f:f_end] = Sb.sum(axis=0)
            chunk_max = float(Sb.max()) ** 2 if Sb.size else 0.0
            if chunk_max > band_power_max[name]:
                band_power_max[name] = chunk_max
        f = f_end

    centroid = np.divide(
        centroid_weighted, centroid_total, out=np.zeros_like(centroid_weighted), where=centroid_total > 0
    )
    band_energy = {name: _normalize(arr) for name, arr in band_energy_raw.items()}

    # ---------- Pass 2: 대역별 onset (전역 ref 확정 후 청크 단위로 diff 이어붙이기) ----------
    band_onset_raw: dict[str, list[np.ndarray]] = {name: [] for name in freq_bands}
    carry_last_col: dict[str, np.ndarray | None] = {name: None for name in freq_bands}
    empty_bands = {name for name, mask in band_masks.items() if not mask.any()}

    f = 0
    while f < n_frames:
        f_end = min(f + chunk_frames, n_frames)
        S_chunk = np.abs(librosa.stft(frame_slice(f, f_end), n_fft=n_fft, hop_length=hop_length, center=False))

        for name, mask in band_masks.items():
            if name in empty_bands:
                continue
            Sb = S_chunk[mask, :]
            ref = band_power_max[name] if band_power_max[name] > 0 else 1.0
            # NOTE: power_to_db(..., top_db=80.0)에 맡기면 top_db 플로어를
            # "이 배열(=이 청크)만의" 최댓값 기준으로 다시 계산해버려서, 전역 최댓값이
            # 포함되지 않은 청크에서는 원본(전체 한 번에 계산)과 다른 값이 나온다.
            # ref를 이미 전역 최댓값으로 고정했으므로, 전역 top_db 플로어는 항상
            # 정확히 -80.0 dB로 고정된다 — 이를 직접 적용해 청크별로도 동일하게 만든다.
            db = librosa.power_to_db(Sb**2, ref=ref, top_db=None)
            np.maximum(db, -80.0, out=db)

            piece = db if carry_last_col[name] is None else np.concatenate([carry_last_col[name], db], axis=1)
            diffs = np.maximum(0.0, piece[:, lag:] - piece[:, :-lag]).mean(axis=0)
            band_onset_raw[name].append(diffs.astype(np.float32, copy=False))
            carry_last_col[name] = db[:, -lag:]
        f = f_end

    band_onset: dict[str, np.ndarray] = {}
    onset_center_pad = lag + n_fft // (2 * hop_length)  # librosa.onset.onset_strength(center=True)와 동일
    for name in freq_bands:
        if name in empty_bands:
            band_onset[name] = np.zeros(n_frames, dtype=np.float32)
            continue
        raw = np.concatenate(band_onset_raw[name]) if band_onset_raw[name] else np.array([], dtype=np.float32)
        padded = np.pad(raw, (onset_center_pad, 0), mode="constant")[:n_frames]
        band_onset[name] = _normalize(padded)

    return centroid.astype(np.float32, copy=False), band_energy, band_onset, n_frames, freqs


def extract_features_from_signal(y: np.ndarray, sr: int) -> AudioFeatures:
    started = time.monotonic()
    duration = float(len(y) / sr) if sr else 0.0
    rms_raw = rms_from_signal(y, frame_length=2048, hop_length=C.HOP_LENGTH) if len(y) else np.array([0.0], dtype=np.float32)
    rms_max_raw = float(rms_raw.max()) if rms_raw.size else 0.0

    if duration < C.MIN_AUDIO_DURATION_SEC:
        msg = f"오디오가 너무 짧습니다 ({duration:.2f}s < {C.MIN_AUDIO_DURATION_SEC}s). 빈 채보를 생성합니다."
        return _empty_features(sr, duration, rms_max_raw, msg)
    if rms_max_raw < C.SILENCE_RMS_THRESHOLD:
        return _empty_features(sr, duration, rms_max_raw, "무음 오디오로 판단되어 빈 채보를 생성합니다.")

    hop = C.HOP_LENGTH

    onset_env_raw = onset_envelope_chunked(y, sr, C.N_FFT, hop)
    log_stage("STFT/onset (chunked)", started)
    onset_env = _normalize(onset_env_raw)
    rms_n = _normalize(rms_raw)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env_raw, sr=sr, hop_length=hop, units="frames"
    )
    onset_times = np.maximum(
        0.0, librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop) - C.ONSET_LATENCY_COMP_SEC
    )
    log_stage("onset", started)

    # 전역 BPM 1차 추정은 성긴 hop으로 (거대한 autocorrelation tempogram 회피, 위 함수 설명 참고).
    # 이 값을 beat_track에 bpm=으로 넘기면 내부의 비싼 tempo() 재계산을 건너뛰고,
    # 실제 beat 위치는 여전히 HOP_LENGTH=256 onset envelope 그대로 사용해 정렬한다.
    coarse_bpm = estimate_initial_bpm_light(onset_env_raw, sr, hop)
    if coarse_bpm > 0:
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env_raw, sr=sr, hop_length=hop, bpm=coarse_bpm
        )
    else:
        # 성긴 envelope로도 주기성을 못 찾은 극단적인 경우에만 기존(비싼) 경로로 폴백한다.
        tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env_raw, sr=sr, hop_length=hop)
    bpm = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    # Tempo ambiguity is common in real mixes: a dense hi-hat can make 120 BPM look like
    # 180 BPM, while layered attacks can make 150 BPM look like 75 BPM. Weight tempo/grid
    # evidence by perceptual accent (transient strength + local RMS), not transient count alone.
    accents = (
        np.array(
            [
                C.ACCENT_W_STRENGTH * onset_env[f]
                + C.ACCENT_W_LOUDNESS * float(rms_n[f : f + 4].max())
                for f in onset_frames
            ]
        )
        if len(onset_frames)
        else np.array([])
    )
    bpm, beat_times, tempo_candidates = refine_tempo(
        onset_env_raw, sr, hop, duration, bpm, beat_times, onset_times, accents
    )

    beat_times = refine_phase(np.asarray(beat_times, dtype=float), onset_times, accents)
    log_stage("tempo", started)

    centroid, band_energy, band_onset, n_frames, _freqs = compute_spectral_band_features_chunked(
        y, sr, C.N_FFT, hop, C.FREQUENCY_BANDS
    )
    log_stage("spectral bands (chunked)", started)
    rms = _normalize(rms_raw[:n_frames])

    warnings: list[str] = []
    if len(beat_times) < 2:
        warnings.append("beat를 충분히 검출하지 못했습니다. grid quantize가 제한됩니다.")
    if len(onset_frames) == 0:
        warnings.append("onset이 검출되지 않았습니다.")
    if tempo_candidates:
        selected = next((x for x in tempo_candidates if x.selected), None)
        if selected and selected.confidence < 0.45:
            warnings.append("BPM 후보 간 차이가 작아 tempo 신뢰도가 낮습니다.")

    return AudioFeatures(
        sr=sr,
        hop_length=hop,
        duration=duration,
        bpm=bpm,
        beat_times=np.asarray(beat_times, dtype=float),
        onset_frames=np.asarray(onset_frames, dtype=int),
        onset_times=np.asarray(onset_times, dtype=float),
        onset_env=onset_env,
        rms=rms,
        rms_max_raw=rms_max_raw,
        spectral_centroid=centroid,
        band_onset=band_onset,
        band_energy=band_energy,
        tempo_candidates=tempo_candidates,
        warnings=warnings,
    )


def extract_features(path: str) -> AudioFeatures:
    started = time.monotonic()
    y, sr = load_audio(path)
    log_stage("audio loaded", started)
    return extract_features_from_signal(y, sr)
