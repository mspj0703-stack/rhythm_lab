"""6단계: Note Type Planner.

lane/timing 생성이 끝난 뒤, 음악적 근거가 충분한 일부 노트를 Hold/Flick으로 바꾼다.
이 단계는 note time과 lane을 절대 바꾸지 않는다. 따라서 기존 타이밍 회귀와 seed 재현성을
유지하면서 표현력만 추가할 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import config as C
from .config import DifficultyConfig
from .features import AudioFeatures
from .patterns import PlannedNote


@dataclass
class NoteTypeStats:
    hold_candidates: int = 0
    flick_candidates: int = 0
    holds_assigned: int = 0
    flicks_assigned: int = 0


def _frame(features: AudioFeatures, t: float) -> int:
    if features.rms.size == 0 or features.sr <= 0 or features.hop_length <= 0:
        return 0
    return int(np.clip(round(t * features.sr / features.hop_length), 0, features.rms.size - 1))


def _sustain_duration(features: AudioFeatures, note: PlannedNote, max_sec: float) -> float:
    """RMS + 해당 대역 energy가 충분히 유지되는 시간을 보수적으로 추정한다."""
    if max_sec <= 0 or note.band != "mid" or features.rms.size == 0:
        return 0.0
    start = _frame(features, note.time)
    frame_sec = features.hop_length / features.sr
    max_frames = max(1, int(max_sec / frame_sec))
    end = min(features.rms.size, start + max_frames + 1)
    if end - start < 2:
        return 0.0

    rms = features.rms
    band_energy = features.band_energy.get(note.band)
    if band_energy is None or band_energy.size == 0:
        return 0.0

    bend = min(end, band_energy.size)
    end = min(end, bend)
    if end - start < 2:
        return 0.0

    rms_peak = float(np.max(rms[start : min(end, start + 4)]))
    band_peak = float(np.max(band_energy[start : min(end, start + 4)]))
    if rms_peak < C.HOLD_MIN_START_RMS or band_peak < C.HOLD_MIN_START_BAND_ENERGY:
        return 0.0

    rms_threshold = max(C.HOLD_RMS_FLOOR, rms_peak * C.HOLD_RMS_RETAIN_RATIO)
    band_threshold = max(C.HOLD_BAND_FLOOR, band_peak * C.HOLD_BAND_RETAIN_RATIO)
    tolerated_dips = 0
    last_good = start

    for f in range(start + 1, end):
        good = float(rms[f]) >= rms_threshold and float(band_energy[f]) >= band_threshold
        if good:
            tolerated_dips = 0
            last_good = f
        else:
            tolerated_dips += 1
            if tolerated_dips > C.HOLD_MAX_DIP_FRAMES:
                break

    return max(0.0, (last_good - start) * frame_sec)


def _quantized_hold_duration(raw_sec: float, beat_sec: float, min_beats: float, max_beats: float) -> float:
    if raw_sec <= 0 or beat_sec <= 0:
        return 0.0
    steps = (0.5, 1.0, 1.5, 2.0, 3.0)
    lo = max(C.HOLD_MIN_DURATION_SEC, min_beats * beat_sec)
    hi = min(C.HOLD_MAX_DURATION_SEC, max_beats * beat_sec, raw_sec)
    candidates = [s * beat_sec for s in steps if lo <= s * beat_sec <= hi + 1e-9]
    return max(candidates) if candidates else 0.0


def _next_same_lane_time(notes: list[PlannedNote], index: int) -> float | None:
    lane = notes[index].lane
    for n in notes[index + 1 :]:
        if n.lane == lane:
            return n.time
    return None


def _same_hand(a: int, b: int) -> bool:
    return (a <= 1 and b <= 1) or (a >= 2 and b >= 2)


def _hold_complexity_ok(
    notes: list[PlannedNote], index: int, duration: float, max_same_hand: int, max_total: int
) -> bool:
    start = notes[index].time
    end = start + duration
    inside = [n for j, n in enumerate(notes) if j != index and start < n.time < end - 1e-9]
    if len(inside) > max_total:
        return False
    same_hand = sum(_same_hand(notes[index].lane, n.lane) for n in inside)
    return same_hand <= max_same_hand


def _assign_holds(notes: list[PlannedNote], features: AudioFeatures, cfg: DifficultyConfig, stats: NoteTypeStats) -> None:
    nt = C.NOTE_TYPE_CONFIGS[cfg.name]
    max_holds = int(round(len(notes) * nt.hold_max_ratio))
    if max_holds <= 0 or not notes:
        return

    beat_sec = 60.0 / features.bpm if features.bpm > 0 else 0.5
    candidates: list[tuple[float, int, float]] = []
    for i, n in enumerate(notes):
        if n.band != "mid" or n.salience < C.HOLD_MIN_SALIENCE:
            continue
        next_same = _next_same_lane_time(notes, i)
        lane_room = C.HOLD_MAX_DURATION_SEC if next_same is None else next_same - n.time - C.HOLD_SAME_LANE_CLEARANCE_SEC
        if lane_room <= 0:
            continue
        max_probe = min(C.HOLD_MAX_DURATION_SEC, nt.hold_max_beats * beat_sec, lane_room)
        sustain = _sustain_duration(features, n, max_probe)
        duration = _quantized_hold_duration(sustain, beat_sec, nt.hold_min_beats, nt.hold_max_beats)
        if duration <= 0:
            continue
        if not _hold_complexity_ok(
            notes, i, duration, nt.max_same_hand_notes_during_hold, nt.max_total_notes_during_hold
        ):
            continue
        stats.hold_candidates += 1
        score = n.salience + 0.20 * n.local_contrast + 0.12 * min(duration / max(beat_sec, 1e-6), 2.0)
        candidates.append((score, i, duration))

    occupied_until = {0: -1.0, 1: -1.0, 2: -1.0, 3: -1.0}
    chosen = 0
    for _score, i, duration in sorted(candidates, key=lambda x: (-x[0], notes[x[1]].time)):
        if chosen >= max_holds:
            break
        n = notes[i]
        if n.time < occupied_until[n.lane] + C.HOLD_SAME_LANE_CLEARANCE_SEC:
            continue
        n.note_type = "hold"
        n.duration = round(duration, 3)
        occupied_until[n.lane] = n.time + duration
        chosen += 1
    stats.holds_assigned = chosen


def _local_median_gap(notes: list[PlannedNote], index: int, radius: int = 4) -> float:
    """index 주변(자기 자신의 앞뒤 간격은 제외)의 노트 간격 중앙값."""
    lo = max(0, index - radius)
    hi = min(len(notes), index + radius + 1)
    gaps = [
        notes[k + 1].time - notes[k].time
        for k in range(lo, hi - 1)
        if k not in (index - 1, index)
    ]
    return float(np.median(gaps)) if gaps else 0.0


def _assign_flicks(notes: list[PlannedNote], features: AudioFeatures, cfg: DifficultyConfig, stats: NoteTypeStats) -> None:
    nt = C.NOTE_TYPE_CONFIGS[cfg.name]
    max_flicks = int(round(len(notes) * nt.flick_max_ratio))
    if max_flicks <= 0 or not notes:
        return

    beat_sec = 60.0 / features.bpm if features.bpm > 0 else 0.5
    candidates: list[tuple[float, int]] = []
    for i, n in enumerate(notes):
        if n.note_type != "tap" or n.band != "high":
            continue
        high = float(n.band_strengths.get("high", 0.0))
        other = max(float(n.band_strengths.get("mid", 0.0)), float(n.band_strengths.get("low", 0.0)), 1e-6)
        # 단순히 high가 조금 높은 kick/transient를 Flick으로 오인하지 않는다.
        if high < other * C.FLICK_HIGH_DOMINANCE_RATIO:
            continue
        if n.salience < nt.flick_min_salience or n.local_contrast < nt.flick_min_local_contrast:
            continue
        prev_gap = n.time - notes[i - 1].time if i > 0 else 99.0
        next_gap = notes[i + 1].time - n.time if i + 1 < len(notes) else 99.0
        # 문맥 판정은 절대 간격이 아니라 주변 리듬 대비로 한다. 고정 간격(0.12s/0.24s)만 쓰면
        # 일정한 8분 하이햇 stream(간격 0.17s) 한가운데 노트도 "고립/구절 끝"으로 통과해 버린다.
        local_gap = _local_median_gap(notes, i)
        stand_out = local_gap * C.FLICK_CONTEXT_GAP_RATIO
        phrase_end_like = next_gap >= max(C.FLICK_PHRASE_END_GAP_SEC, beat_sec * C.FLICK_PHRASE_END_BEAT_FRACTION, stand_out)
        isolated_accent = min(prev_gap, next_gap) >= max(C.FLICK_MIN_NEIGHBOR_GAP_SEC, stand_out)
        if not (phrase_end_like or isolated_accent):
            continue
        stats.flick_candidates += 1
        score = n.salience + 0.35 * n.local_contrast + (0.12 if phrase_end_like else 0.0)
        candidates.append((score, i))

    chosen_times: list[float] = []
    for _score, i in sorted(candidates, key=lambda x: (-x[0], notes[x[1]].time)):
        if len(chosen_times) >= max_flicks:
            break
        n = notes[i]
        if any(abs(n.time - t) < C.FLICK_MIN_INTERVAL_SEC for t in chosen_times):
            continue
        n.note_type = "flick"
        n.duration = None
        chosen_times.append(n.time)
    stats.flicks_assigned = len(chosen_times)


def assign_note_types(
    notes: list[PlannedNote], features: AudioFeatures, cfg: DifficultyConfig, platform: str = "mobile"
) -> tuple[list[PlannedNote], NoteTypeStats]:
    """Timing/lane을 보존한 채 일부 tap을 hold/flick으로 변환한다."""
    out = [n.copy() for n in notes]
    stats = NoteTypeStats()
    _assign_holds(out, features, cfg, stats)
    if platform == "mobile":
        _assign_flicks(out, features, cfg, stats)
    return out, stats
