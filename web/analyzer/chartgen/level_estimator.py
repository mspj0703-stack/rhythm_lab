"""Chart difficulty estimator (Lv.1~30).

The estimator is intentionally chart-driven: difficulty labels do not directly decide the
level.  Density, timing pressure, lane movement, hand strain and note-type technique are
measured from the final playable chart.  The selected difficulty contributes only a tiny
sub-level tie-break so nearly identical charts do not frequently display a lower level on a
nominally harder generation preset.

This module never mutates notes.
"""
from __future__ import annotations

import heapq
import math
import statistics
from collections import Counter
from dataclasses import dataclass

from .patterns import PlannedNote, hand_of

LEVEL_MIN = 1
LEVEL_MAX = 30

# 노트가 이보다 적으면 비율/분위수 지표(Hold 비율, 빠른 간격 비율, 같은 손 비율 등)가 몇 개
# 노트에 크게 흔들린다 (예: 9노트 중 Hold 1개 = Hold 11%). 이 경우 complexity를 노트 수에
# 비례해 줄인다. 일반 곡(수십~수천 노트)에는 영향이 없다.
LEVEL_FULL_CONFIDENCE_NOTES = 24

# Level-unit tie-break only.  The chart metrics remain the overwhelming source of the score.
DIFFICULTY_TIE_BREAK = {
    "Easy": 0.00,
    "Normal": 0.25,
    "Hard": 0.60,
    "Expert": 0.90,
    "Extreme": 1.10,
}


@dataclass(frozen=True)
class LevelEstimate:
    level: int
    raw_level: float
    complexity: float
    density: float
    speed: float
    movement: float
    technique: float
    hand_strain: float
    active_nps: float
    peak_nps_1s: float
    peak_nps_2s: float
    interval_p20: float
    fast_170ms_ratio: float
    fast_130ms_ratio: float
    p90_lane_velocity: float
    average_lane_movement: float
    rapid_same_hand_ratio: float
    max_same_hand_run: int
    hold_ratio: float
    flick_ratio: float
    hold_overlap_ratio: float
    chord_note_ratio: float


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _norm(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return _clamp01((value - low) / (high - low))


def _quantile(values: list[float], q: float, fallback: float = 0.0) -> float:
    if not values:
        return fallback
    ordered = sorted(values)
    idx = int(round(_clamp01(q) * (len(ordered) - 1)))
    return float(ordered[idx])


def _peak_nps(times: list[float], window_sec: float) -> float:
    if not times or window_sec <= 0:
        return 0.0
    best = 0
    left = 0
    for right, t in enumerate(times):
        while left <= right and t - times[left] >= window_sec:
            left += 1
        best = max(best, right - left + 1)
    return best / window_sec


def _hold_overlap_ratio(notes: list[PlannedNote]) -> float:
    """Fraction of notes hit while at least one earlier Hold is still active."""
    if not notes:
        return 0.0
    holds = sorted(
        (n.time, n.time + float(n.duration))
        for n in notes
        if n.note_type == "hold" and n.duration is not None and n.duration > 0
    )
    if not holds:
        return 0.0

    active_ends: list[float] = []
    hold_index = 0
    covered = 0
    for note in notes:
        t = note.time
        while hold_index < len(holds) and holds[hold_index][0] < t - 1e-9:
            heapq.heappush(active_ends, holds[hold_index][1])
            hold_index += 1
        while active_ends and active_ends[0] <= t + 1e-9:
            heapq.heappop(active_ends)
        if active_ends:
            covered += 1
    return covered / len(notes)


def _max_same_hand_run(notes: list[PlannedNote]) -> int:
    best = run = 0
    previous: int | None = None
    for note in notes:
        hand = hand_of(note.lane)
        run = run + 1 if hand == previous else 1
        best = max(best, run)
        previous = hand
    return best


def estimate_chart_level(notes: list[PlannedNote], difficulty: str | None = None) -> LevelEstimate:
    """Estimate Lv.1~30 from the final chart without modifying it."""
    ordered = sorted(notes, key=lambda n: (n.time, n.lane))
    total = len(ordered)
    if total == 0:
        return LevelEstimate(
            level=LEVEL_MIN,
            raw_level=float(LEVEL_MIN),
            complexity=0.0,
            density=0.0,
            speed=0.0,
            movement=0.0,
            technique=0.0,
            hand_strain=0.0,
            active_nps=0.0,
            peak_nps_1s=0.0,
            peak_nps_2s=0.0,
            interval_p20=0.0,
            fast_170ms_ratio=0.0,
            fast_130ms_ratio=0.0,
            p90_lane_velocity=0.0,
            average_lane_movement=0.0,
            rapid_same_hand_ratio=0.0,
            max_same_hand_run=0,
            hold_ratio=0.0,
            flick_ratio=0.0,
            hold_overlap_ratio=0.0,
            chord_note_ratio=0.0,
        )

    times = [float(n.time) for n in ordered]
    positive_gaps = [b - a for a, b in zip(times, times[1:], strict=False) if b - a > 1e-5]
    median_gap = statistics.median(positive_gaps) if positive_gaps else 1.0
    if total == 1:
        active_span = max(median_gap, 1.0)
    else:
        active_span = max(times[-1] - times[0] + median_gap, median_gap)
    active_nps = total / active_span
    peak_1s = _peak_nps(times, 1.0)
    peak_2s = _peak_nps(times, 2.0)

    interval_p20 = _quantile(positive_gaps, 0.20, fallback=1.0)
    fast_170 = sum(g < 0.170 for g in positive_gaps) / len(positive_gaps) if positive_gaps else 0.0
    fast_130 = sum(g < 0.130 for g in positive_gaps) / len(positive_gaps) if positive_gaps else 0.0

    transitions = list(zip(ordered, ordered[1:], strict=False))
    lane_movements = [abs(b.lane - a.lane) for a, b in transitions]
    average_lane_movement = sum(lane_movements) / len(lane_movements) if lane_movements else 0.0
    lane_velocities = [
        abs(b.lane - a.lane) / (b.time - a.time)
        for a, b in transitions
        if b.time - a.time > 1e-5
    ]
    p90_lane_velocity = _quantile(lane_velocities, 0.90)
    extreme_jump_ratio = (
        sum(movement == 3 for movement in lane_movements) / len(lane_movements)
        if lane_movements
        else 0.0
    )

    rapid_transitions = [
        (a, b)
        for a, b in transitions
        if 1e-5 < b.time - a.time < 0.250
    ]
    rapid_same_hand_ratio = (
        sum(hand_of(a.lane) == hand_of(b.lane) for a, b in rapid_transitions) / len(rapid_transitions)
        if rapid_transitions
        else 0.0
    )
    max_same_hand_run = _max_same_hand_run(ordered)

    note_types = Counter(n.note_type for n in ordered)
    hold_ratio = note_types.get("hold", 0) / total
    flick_ratio = note_types.get("flick", 0) / total
    hold_overlap_ratio = _hold_overlap_ratio(ordered)

    # Future-proof for charts that permit simultaneous notes. Current generator normally has none.
    timestamp_counts = Counter(round(n.time, 3) for n in ordered)
    chord_notes = sum(count for count in timestamp_counts.values() if count > 1)
    chord_note_ratio = chord_notes / total

    density = (
        0.45 * _norm(active_nps, 1.0, 8.5)
        + 0.35 * _norm(peak_1s, 2.0, 10.0)
        + 0.20 * _norm(peak_2s, 1.5, 8.0)
    )
    speed = (
        0.45 * _norm(0.300 - interval_p20, 0.0, 0.220)
        + 0.35 * _norm(fast_170, 0.0, 0.65)
        + 0.20 * _norm(fast_130, 0.0, 0.35)
    )
    movement = (
        0.55 * _norm(p90_lane_velocity, 3.0, 14.0)
        + 0.30 * _norm(average_lane_movement, 0.8, 1.8)
        + 0.15 * _norm(extreme_jump_ratio, 0.0, 0.10)
    )
    technique = (
        0.35 * _norm(hold_ratio, 0.0, 0.15)
        + 0.25 * _norm(flick_ratio, 0.0, 0.08)
        + 0.25 * _norm(hold_overlap_ratio, 0.0, 0.25)
        + 0.15 * _norm(chord_note_ratio, 0.0, 0.15)
    )
    hand_strain = (
        0.60 * rapid_same_hand_ratio
        + 0.40 * _norm(max_same_hand_run, 2.0, 8.0)
    )

    complexity = _clamp01(
        0.42 * density
        + 0.22 * speed
        + 0.14 * movement
        + 0.14 * technique
        + 0.08 * hand_strain
    )
    complexity *= min(1.0, total / LEVEL_FULL_CONFIDENCE_NOTES)
    prior = DIFFICULTY_TIE_BREAK.get(difficulty or "", 0.0)
    raw_level = 1.0 + 29.0 * math.pow(complexity, 0.90) + prior
    level = int(math.floor(raw_level + 0.5))
    level = max(LEVEL_MIN, min(LEVEL_MAX, level))

    return LevelEstimate(
        level=level,
        raw_level=round(raw_level, 4),
        complexity=round(complexity, 4),
        density=round(density, 4),
        speed=round(speed, 4),
        movement=round(movement, 4),
        technique=round(technique, 4),
        hand_strain=round(hand_strain, 4),
        active_nps=round(active_nps, 4),
        peak_nps_1s=round(peak_1s, 4),
        peak_nps_2s=round(peak_2s, 4),
        interval_p20=round(interval_p20, 4),
        fast_170ms_ratio=round(fast_170, 4),
        fast_130ms_ratio=round(fast_130, 4),
        p90_lane_velocity=round(p90_lane_velocity, 4),
        average_lane_movement=round(average_lane_movement, 4),
        rapid_same_hand_ratio=round(rapid_same_hand_ratio, 4),
        max_same_hand_run=max_same_hand_run,
        hold_ratio=round(hold_ratio, 4),
        flick_ratio=round(flick_ratio, 4),
        hold_overlap_ratio=round(hold_overlap_ratio, 4),
        chord_note_ratio=round(chord_note_ratio, 4),
    )
