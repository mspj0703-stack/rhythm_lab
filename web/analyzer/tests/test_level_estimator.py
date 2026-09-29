"""Automatic Lv.1~30 chart difficulty estimation regression tests."""
from __future__ import annotations

from chartgen.level_estimator import LEVEL_MAX, LEVEL_MIN, estimate_chart_level
from chartgen.patterns import PlannedNote


def _note(
    time: float,
    lane: int,
    note_type: str = "tap",
    duration: float | None = None,
) -> PlannedNote:
    return PlannedNote(
        time=time,
        lane=lane,
        salience=0.9,
        division=8,
        band="mid",
        pattern="alternate",
        note_type=note_type,
        duration=duration,
    )


def _stream(interval: float, count: int = 48, lanes: tuple[int, ...] = (0, 2, 1, 3)) -> list[PlannedNote]:
    return [_note(0.5 + i * interval, lanes[i % len(lanes)]) for i in range(count)]


def test_empty_chart_is_level_one():
    result = estimate_chart_level([])
    assert result.level == 1
    assert result.complexity == 0.0


def test_dense_fast_stream_rates_higher_than_sparse_stream():
    sparse = estimate_chart_level(_stream(0.50, 32))
    dense = estimate_chart_level(_stream(0.12, 96))
    assert dense.level > sparse.level
    assert dense.density > sparse.density
    assert dense.speed > sparse.speed


def test_technical_note_types_raise_level_without_changing_timing():
    base = _stream(0.24, 48)
    technical = [n.copy() for n in base]
    for i in range(0, len(technical), 8):
        technical[i].note_type = "hold"
        technical[i].duration = 0.72
    for i in range(4, len(technical), 8):
        technical[i].note_type = "flick"
    plain = estimate_chart_level(base, "Hard")
    tech = estimate_chart_level(technical, "Hard")
    assert tech.level > plain.level
    assert tech.technique > plain.technique
    assert [(n.time, n.lane) for n in technical] == [(n.time, n.lane) for n in base]


def test_fast_same_hand_and_lane_motion_add_strain():
    easy_motion = _stream(0.16, 64, lanes=(0, 2))
    strained = _stream(0.16, 64, lanes=(0, 1, 0, 1, 3, 2, 3, 2))
    a = estimate_chart_level(easy_motion)
    b = estimate_chart_level(strained)
    assert b.hand_strain > a.hand_strain
    assert b.level >= a.level


def test_difficulty_name_is_only_a_small_tiebreak():
    notes = _stream(0.20, 64)
    easy = estimate_chart_level(notes, "Easy")
    expert = estimate_chart_level(notes, "Expert")
    assert expert.level >= easy.level
    assert expert.level - easy.level <= 1
    assert expert.complexity == easy.complexity


def test_level_is_always_in_1_to_30():
    extreme = _stream(0.03, 500, lanes=(0, 3, 0, 3))
    result = estimate_chart_level(extreme, "Expert")
    assert LEVEL_MIN <= result.level <= LEVEL_MAX
    assert result.level >= 20


def test_pipeline_reports_same_dynamic_level_as_chart(gen):
    result = gen("fast_180.wav", "expert", 42)
    assert 1 <= result.chart["level"] <= 30
    assert result.chart["level"] == result.report["chartLevel"]
    assert result.report["levelEstimate"]["level"] == result.chart["level"]
    assert result.report["levelEstimate"]["complexity"] >= 0.0


def test_very_short_chart_does_not_get_inflated_level():
    """짧은 구간에 몰린 소수 노트(비율 지표가 불안정)는 긴 고밀도 채보보다 훨씬 낮아야 한다."""
    burst = [PlannedNote(0.2 + i * 0.16, i % 4, 0.8, 8, "mid", "alternate") for i in range(9)]
    burst[3].note_type, burst[3].duration = "hold", 0.5
    few = estimate_chart_level(burst, "Normal")
    dense = estimate_chart_level([PlannedNote(i * 0.12, i % 4, 0.8, 16, "mid", "alternate") for i in range(400)], "Normal")
    assert few.level <= 10  # 보정 전에는 20
    assert dense.level > few.level + 8
