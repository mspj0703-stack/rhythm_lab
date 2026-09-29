"""
3단계: Event Selection.

MusicalEvent 중 난이도에 맞는 것만 남긴다.
기준: salience(strength+loudness+beat 정렬), grid division, 주변 간격, 1초 밀도, 1/16 비율.
"""
from __future__ import annotations

from dataclasses import dataclass

from .config import DifficultyConfig
from .density import DensityTracker
from .events import MusicalEvent


@dataclass
class FilterStats:
    input_count: int = 0
    removed_weak: int = 0
    removed_division: int = 0
    removed_unquantized: int = 0
    removed_density: int = 0
    removed_sixteenth_cap: int = 0
    output_count: int = 0


def select_events(events: list[MusicalEvent], cfg: DifficultyConfig) -> tuple[list[MusicalEvent], FilterStats]:
    stats = FilterStats(input_count=len(events))
    candidates: list[MusicalEvent] = []
    for e in events:
        if e.salience < cfg.min_salience:
            stats.removed_weak += 1
            continue
        if e.grid_division is None:
            if not cfg.allow_unquantized:
                stats.removed_unquantized += 1
                continue
        elif e.grid_division > cfg.max_division:
            stats.removed_division += 1
            continue
        candidates.append(e)

    # salience가 높은 이벤트부터 채택 -> 촘촘한 구간에서는 음악적으로 중요한 것이 남는다.
    tracker = DensityTracker(cfg.max_notes_per_second)
    accepted: list[MusicalEvent] = []
    for e in sorted(candidates, key=lambda e: (-e.salience, e.time)):
        if tracker.can_add(e.time, cfg.min_interval_sec):
            tracker.add(e.time)
            accepted.append(e)
        else:
            stats.removed_density += 1

    # 1/16 비율 상한
    sixteenth = [e for e in accepted if e.grid_division == 16]
    # 제거 후 남는 전체 개수 기준으로 비율을 맞춘다: s <= r*(other+s)  =>  s <= r*other/(1-r)
    other = len(accepted) - len(sixteenth)
    r = cfg.max_sixteenth_ratio
    allowed = len(sixteenth) if r >= 1.0 else int(r * other / (1 - r))
    if len(sixteenth) > allowed:
        drop = set(id(e) for e in sorted(sixteenth, key=lambda e: e.salience)[: len(sixteenth) - allowed])
        stats.removed_sixteenth_cap = len(drop)
        accepted = [e for e in accepted if id(e) not in drop]

    accepted.sort(key=lambda e: e.time)
    stats.output_count = len(accepted)
    return accepted, stats
