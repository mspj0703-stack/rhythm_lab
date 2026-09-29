"""v0.3 자동 채보 회귀 비교용 품질 지표.

이 점수는 사용자에게 난이도/재미를 보증하는 점수가 아니다. 같은 평가 세트에서
버전 간 퇴행을 빠르게 찾기 위한 내부 지표다.
"""
from __future__ import annotations

from collections import Counter

from . import config as C
from .density import max_count_in_window
from .events import MusicalEvent
from .features import AudioFeatures
from .patterns import PlannedNote, hand_of


def _max_run(values: list[int]) -> int:
    best = run = 0
    prev = None
    for value in values:
        run = run + 1 if value == prev else 1
        best = max(best, run)
        prev = value
    return best


def compute_quality_metrics(
    *,
    features: AudioFeatures,
    events: list[MusicalEvent],
    selected_count: int,
    notes: list[PlannedNote],
) -> dict:
    total = len(notes)
    lanes = [n.lane for n in notes]
    times = [n.time for n in notes]
    lane_counts = Counter(lanes)
    lane_usage = [lane_counts.get(i, 0) / total if total else 0.0 for i in range(4)]

    adjacent = max(0, total - 1)
    same_lane = sum(a == b for a, b in zip(lanes, lanes[1:], strict=False))
    extreme = sum(abs(a - b) == 3 for a, b in zip(lanes, lanes[1:], strict=False))
    movement = [abs(a - b) for a, b in zip(lanes, lanes[1:], strict=False)]
    hands = [hand_of(lane) for lane in lanes]

    aligned = sum(e.grid_division is not None for e in events)
    offgrid_ratio = 1.0 - aligned / len(events) if events else 0.0
    cluster_suppressed = sum(max(0, e.cluster_size - 1) for e in events)
    reused_notes = sum(1 for n in notes if n.phrase_reused)
    families = Counter(n.phrase_family for n in notes if n.phrase_family is not None)
    note_types = Counter(n.note_type for n in notes)
    hold_durations = [float(n.duration) for n in notes if n.note_type == "hold" and n.duration is not None]

    metrics = {
        "bpmConfidence": round(features.bpm_confidence, 4),
        "gridAlignmentRatio": round(aligned / len(events), 4) if events else 0.0,
        "offGridRatio": round(offgrid_ratio, 4),
        "clusterSuppressed": cluster_suppressed,
        "filteredRawOnsetRatio": round(selected_count / int(features.onset_frames.size), 4)
        if features.onset_frames.size
        else 0.0,
        "averageNps": round(total / features.duration, 4) if features.duration > 0 else 0.0,
        "peakNps1s": max_count_in_window(times),
        "laneBalance": {str(i): round(lane_usage[i], 4) for i in range(4)},
        "leftHandRatio": round(sum(h == 0 for h in hands) / total, 4) if total else 0.0,
        "sameLaneRepeatRatio": round(same_lane / adjacent, 4) if adjacent else 0.0,
        "extremeJumpRatio": round(extreme / adjacent, 4) if adjacent else 0.0,
        "averageLaneMovement": round(sum(movement) / len(movement), 4) if movement else 0.0,
        "maxSameHandRun": _max_run(hands),
        "phraseReuseRatio": round(reused_notes / total, 4) if total else 0.0,
        "phraseFamilyCount": len(families),
        "holdRatio": round(note_types.get("hold", 0) / total, 4) if total else 0.0,
        "flickRatio": round(note_types.get("flick", 0) / total, 4) if total else 0.0,
        "averageHoldDuration": round(sum(hold_durations) / len(hold_durations), 4) if hold_durations else 0.0,
    }

    score = 100.0
    if metrics["bpmConfidence"] < 0.45:
        score -= (0.45 - metrics["bpmConfidence"]) / 0.45 * 18.0
    if offgrid_ratio > C.QUALITY_OFFGRID_WARN:
        score -= min(18.0, (offgrid_ratio - C.QUALITY_OFFGRID_WARN) * 40.0)
    if metrics["extremeJumpRatio"] > C.QUALITY_EXTREME_JUMP_WARN:
        score -= min(14.0, (metrics["extremeJumpRatio"] - C.QUALITY_EXTREME_JUMP_WARN) * 100.0)
    if metrics["sameLaneRepeatRatio"] > C.QUALITY_SAME_LANE_WARN:
        score -= min(10.0, (metrics["sameLaneRepeatRatio"] - C.QUALITY_SAME_LANE_WARN) * 50.0)
    for usage in lane_usage:
        if total and usage < C.QUALITY_TARGET_LANE_MIN:
            score -= min(6.0, (C.QUALITY_TARGET_LANE_MIN - usage) * 30.0)
        elif usage > C.QUALITY_TARGET_LANE_MAX:
            score -= min(6.0, (usage - C.QUALITY_TARGET_LANE_MAX) * 30.0)
    metrics["internalQualityScore"] = round(max(0.0, min(100.0, score)), 2)
    return metrics
