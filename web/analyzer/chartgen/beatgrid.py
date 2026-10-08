"""
Beat Grid: beat 타임스탬프 사이를 등분해 1/4, 1/8, 1/16 grid point를 만든다.

beat 간격이 곡 중간에 흔들려도(tempo drift) 인접 beat 사이를 선형 보간하므로
고정 BPM 가정보다 실제 곡에 더 잘 맞는다.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import gcd

import numpy as np

from . import config as C


@dataclass
class GridPoint:
    time: float
    beat_index: int
    # 이 point가 속하는 가장 거친 분할: 4(=정박), 8(=8분), 16(=16분)
    division: int


@dataclass
class QuantizeResult:
    quantized: bool
    time: float  # quantize된 시각 (quantized=False면 원래 시각)
    division: int | None
    beat_index: int | None
    offset_sec: float  # 원래 시각 - 가장 가까운 grid point (부호 있음)


class BeatGrid:
    def __init__(self, times: np.ndarray, beat_indices: np.ndarray, divisions: np.ndarray, sixteenth_interval: float):
        self.times = times
        self.beat_indices = beat_indices
        self.divisions = divisions
        self.sixteenth_interval = sixteenth_interval

    @property
    def is_empty(self) -> bool:
        return self.times.size == 0

    @classmethod
    def empty(cls) -> BeatGrid:
        return cls(np.array([]), np.array([], dtype=int), np.array([], dtype=int), 0.0)

    @classmethod
    def from_beats(cls, beat_times: np.ndarray, duration: float, subdivisions: int = C.GRID_SUBDIVISIONS_PER_BEAT) -> BeatGrid:
        beats = np.asarray(beat_times, dtype=float)
        if beats.size < 2:
            return cls.empty()

        interval = float(np.median(np.diff(beats)))
        if interval <= 0:
            return cls.empty()

        # 첫 beat 이전과 마지막 beat 이후를 중앙값 간격으로 외삽해 곡 전체를 덮는다.
        pre = []
        t = beats[0] - interval
        while t > -interval:
            pre.append(t)
            t -= interval
        post = []
        t = beats[-1] + interval
        while t < duration + interval:
            post.append(t)
            t += interval
        all_beats = np.concatenate([np.array(pre[::-1]), beats, np.array(post)])
        first_real_index = len(pre)

        times, idxs, divs = [], [], []
        for i in range(len(all_beats) - 1):
            a, b = all_beats[i], all_beats[i + 1]
            for k in range(subdivisions):
                times.append(a + (b - a) * k / subdivisions)
                idxs.append(i - first_real_index)
                divs.append(_division_of(k, subdivisions))
        times.append(all_beats[-1])
        idxs.append(len(all_beats) - 1 - first_real_index)
        divs.append(4)

        return cls(np.array(times), np.array(idxs, dtype=int), np.array(divs, dtype=int), interval / subdivisions)

    def shifted(self, delta: float) -> BeatGrid:
        return BeatGrid(self.times + delta, self.beat_indices, self.divisions, self.sixteenth_interval)

    def quantize(self, t: float, threshold_sec: float = C.QUANTIZE_THRESHOLD_SEC) -> QuantizeResult:
        if self.is_empty:
            return QuantizeResult(False, t, None, None, 0.0)
        pos = int(np.searchsorted(self.times, t))
        candidates = [p for p in (pos - 1, pos) if 0 <= p < self.times.size]
        best = min(candidates, key=lambda p: abs(self.times[p] - t))
        offset = t - float(self.times[best])
        limit = min(threshold_sec, self.sixteenth_interval * C.QUANTIZE_MAX_FRACTION_OF_16TH)
        if abs(offset) <= limit:
            return QuantizeResult(True, float(self.times[best]), int(self.divisions[best]), int(self.beat_indices[best]), offset)
        return QuantizeResult(False, t, None, int(self.beat_indices[best]), offset)


def _division_of(k: int, subdivisions: int) -> int:
    """beat 내 k번째 칸이 몇 분음표 위치인지. subdivisions=4 기준: 0->4, 2->8, 1/3->16"""
    return 4 * subdivisions // gcd(k, subdivisions)


def align_grid_to_onsets(grid: BeatGrid, onset_times: np.ndarray, weights: np.ndarray) -> tuple[BeatGrid, float]:
    """
    beat tracker의 beat 위치는 onset 대비 일정한 지연/선행이 있을 수 있다(프레임 해상도, envelope 형태).
    grid 근처(1/16 간격의 절반 이내)에 있는 onset들의 가중 중앙값 오프셋만큼 grid 전체를 옮겨
    quantize가 노트를 실제 소리보다 늦거나 이르게 끌어당기지 않도록 한다.
    """
    if grid.is_empty or onset_times.size == 0:
        return grid, 0.0
    offs, ws = [], []
    for t, w in zip(onset_times, weights, strict=False):
        q = grid.quantize(float(t), threshold_sec=grid.sixteenth_interval * 0.5)
        if q.quantized:
            offs.append(q.offset_sec)
            ws.append(float(w))
    if not offs:
        return grid, 0.0
    order = np.argsort(offs)
    cum = np.cumsum(np.array(ws)[order])
    median = float(np.array(offs)[order][np.searchsorted(cum, cum[-1] / 2)])
    delta = float(np.clip(median, -C.GRID_ALIGN_MAX_SHIFT_SEC, C.GRID_ALIGN_MAX_SHIFT_SEC))
    return grid.shifted(delta), delta
