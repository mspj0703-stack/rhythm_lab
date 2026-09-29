"""
2단계: Musical Event.

onset을 곧바로 노트로 만들지 않고 음악적 의미를 담은 중간 표현으로 바꾼다.
v0.3에서는 전역 세기뿐 아니라 주변 구간 대비(local contrast)를 사용하고,
같은 실제 타격이 여러 onset으로 쪼개진 경우 cluster로 병합한다.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np

from . import config as C
from .beatgrid import BeatGrid
from .features import AudioFeatures


@dataclass
class MusicalEvent:
    time: float
    raw_time: float
    strength: float
    loudness: float
    band: str
    band_strengths: dict[str, float] = field(default_factory=dict)
    beat_aligned: bool = False
    beat_index: int | None = None
    grid_division: int | None = None
    grid_offset: float = 0.0
    local_contrast: float = 0.0
    salience: float = 0.0
    source: str = "onset"
    cluster_size: int = 1

    def to_dict(self) -> dict:
        d = asdict(self)
        return {
            "time": round(d["time"], 4),
            "rawTime": round(d["raw_time"], 4),
            "strength": round(d["strength"], 4),
            "loudness": round(d["loudness"], 4),
            "band": d["band"],
            "bandStrengths": {k: round(v, 4) for k, v in d["band_strengths"].items()},
            "beatAligned": d["beat_aligned"],
            "beatIndex": d["beat_index"],
            "gridDivision": d["grid_division"],
            "gridOffset": round(d["grid_offset"], 4),
            "localContrast": round(d["local_contrast"], 4),
            "salience": round(d["salience"], 4),
            "source": d["source"],
            "clusterSize": d["cluster_size"],
        }


def _peak_around(arr: np.ndarray, frame: int, before: int = 1, after: int = 2) -> float:
    if arr.size == 0:
        return 0.0
    lo = max(0, frame - before)
    hi = min(arr.size, frame + after + 1)
    return float(arr[lo:hi].max()) if hi > lo else 0.0


def _local_prominence(arr: np.ndarray, frame: int, sr: int, hop: int) -> float:
    """주변 1초 내 일반적인 값 대비 현재 peak의 두드러짐을 0~1로 압축한다."""
    if arr.size == 0:
        return 0.0
    radius = max(2, int(round(C.LOCAL_FEATURE_WINDOW_SEC * sr / hop / 2)))
    lo = max(0, frame - radius)
    hi = min(arr.size, frame + radius + 1)
    local = arr[lo:hi]
    if local.size == 0:
        return 0.0
    value = _peak_around(arr, frame, 0, 2)
    baseline = float(np.percentile(local, C.LOCAL_PERCENTILE))
    if baseline <= 1e-8:
        return 1.0 if value > 0 else 0.0
    ratio = value / baseline
    # ratio=1 -> 0.5, ratio>=clip -> 1.0. 주변보다 약한 값도 완전히 0으로 버리지는 않는다.
    return float(np.clip(ratio / C.LOCAL_CONTRAST_CLIP, 0.0, 1.0))


def classify_band(features: AudioFeatures, frame: int) -> tuple[str, dict[str, float]]:
    strengths = {name: _peak_around(env, frame) for name, env in features.band_onset.items()}
    if not strengths or max(strengths.values()) <= 0:
        return "mid", strengths
    return max(strengths, key=lambda k: strengths[k]), strengths


def compute_salience(strength: float, loudness: float, local_contrast: float, division: int | None) -> float:
    bonus = 0.0
    if division == 4:
        bonus = C.SALIENCE_BONUS_ON_BEAT
    elif division == 8:
        bonus = C.SALIENCE_BONUS_ON_8TH
    return (
        strength * C.SALIENCE_W_STRENGTH
        + loudness * C.SALIENCE_W_LOUDNESS
        + local_contrast * C.SALIENCE_W_LOCAL_CONTRAST
        + bonus
    )


def build_events(features: AudioFeatures, grid: BeatGrid) -> list[MusicalEvent]:
    events: list[MusicalEvent] = []
    for frame, t in zip(features.onset_frames, features.onset_times, strict=True):
        frame = int(frame)
        strength = _peak_around(features.onset_env, frame, 0, 1)
        loudness = _peak_around(features.rms, frame, 0, 3)
        onset_prom = _local_prominence(features.onset_env, frame, features.sr, features.hop_length)
        rms_prom = _local_prominence(features.rms, frame, features.sr, features.hop_length)
        local_contrast = 0.65 * onset_prom + 0.35 * rms_prom
        band, band_strengths = classify_band(features, frame)
        q = grid.quantize(float(t))
        division = q.division if q.quantized else None
        events.append(
            MusicalEvent(
                time=q.time,
                raw_time=float(t),
                strength=strength,
                loudness=loudness,
                band=band,
                band_strengths=band_strengths,
                beat_aligned=q.quantized and q.division == 4,
                beat_index=q.beat_index,
                grid_division=division,
                grid_offset=q.offset_sec,
                local_contrast=local_contrast,
                salience=compute_salience(strength, loudness, local_contrast, division),
            )
        )
    return merge_close_events(events)


def _merge_pair(a: MusicalEvent, b: MusicalEvent) -> MusicalEvent:
    """둘 중 음악적으로 중요한 event를 대표로 두되 cluster 정보는 합친다."""
    winner, other = (b, a) if b.salience > a.salience else (a, b)
    winner.cluster_size = a.cluster_size + b.cluster_size
    keys = set(a.band_strengths) | set(b.band_strengths)
    winner.band_strengths = {k: max(a.band_strengths.get(k, 0.0), b.band_strengths.get(k, 0.0)) for k in keys}
    winner.local_contrast = max(a.local_contrast, b.local_contrast)
    winner.strength = max(a.strength, b.strength)
    winner.loudness = max(a.loudness, b.loudness)
    # winner의 grid 위치는 유지한다. raw onset은 더 강한 실제 attack을 대표한다.
    return winner


def merge_close_events(events: list[MusicalEvent], window: float = C.EVENT_MERGE_WINDOW_SEC) -> list[MusicalEvent]:
    """같은 타격으로 보이는 가까운 onset을 cluster로 묶는다."""
    events = sorted(events, key=lambda e: (e.time, e.raw_time))
    merged: list[MusicalEvent] = []
    for e in events:
        if merged:
            prev = merged[-1]
            time_gap = e.time - prev.time
            raw_gap = e.raw_time - prev.raw_time
            # quantize가 같은 점으로 붙었거나 raw onset 자체가 매우 가까울 때 병합.
            close = time_gap < window or raw_gap < C.EVENT_CLUSTER_MAX_WINDOW_SEC and time_gap < 0.075
            if close:
                merged[-1] = _merge_pair(prev, e)
                continue
        merged.append(e)
    return merged
