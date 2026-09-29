"""노트 밀도 계산 유틸 (filtering / playability / 리포트에서 공용)."""
from __future__ import annotations

from bisect import bisect_left, bisect_right, insort


def max_count_in_window(times: list[float], window: float = 1.0) -> int:
    """정렬된 times에서 길이 window(초)의 반열린 구간 [t, t+window)에 들어가는 최대 개수."""
    best, j = 0, 0
    for i in range(len(times)):
        while times[i] - times[j] >= window:
            j += 1
        best = max(best, i - j + 1)
    return best


def peak_window_start(times: list[float], window: float = 1.0) -> float | None:
    best, j, start = 0, 0, None
    for i in range(len(times)):
        while times[i] - times[j] >= window:
            j += 1
        if i - j + 1 > best:
            best, start = i - j + 1, times[j]
    return start


class DensityTracker:
    """정렬 상태를 유지하며, 새 시각을 넣었을 때 어떤 1초 구간도 cap을 넘지 않는지 검사한다."""

    def __init__(self, cap: int, window: float = 1.0):
        self.cap = cap
        self.window = window
        self.times: list[float] = []

    def can_add(self, t: float, min_interval: float) -> bool:
        i = bisect_left(self.times, t)
        if i > 0 and t - self.times[i - 1] < min_interval:
            return False
        if i < len(self.times) and self.times[i] - t < min_interval:
            return False
        lo = bisect_left(self.times, t - self.window)
        hi = bisect_right(self.times, t + self.window)
        local = sorted(self.times[lo:hi] + [t])
        return max_count_in_window(local, self.window) <= self.cap

    def add(self, t: float) -> None:
        insort(self.times, t)
