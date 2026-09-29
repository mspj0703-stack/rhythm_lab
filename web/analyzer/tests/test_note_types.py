"""Chart Generation Update v1: Hold/Flick planner regression."""
from __future__ import annotations

import numpy as np

from chartgen.config import DIFFICULTIES, NOTE_TYPE_CONFIGS
from chartgen.features import AudioFeatures
from chartgen.note_types import assign_note_types
from chartgen.patterns import PlannedNote


def _features(*, bpm: float = 120.0, seconds: float = 8.0, sustained: bool = True) -> AudioFeatures:
    sr, hop = 100, 10  # test-friendly 100ms/frame
    n = int(seconds * sr / hop)
    rms = np.full(n, 0.08, dtype=np.float32)
    mid = np.full(n, 0.05, dtype=np.float32)
    high = np.full(n, 0.05, dtype=np.float32)
    if sustained:
        rms[10:23] = 0.9
        mid[10:23] = 0.85
    return AudioFeatures(
        sr=sr,
        hop_length=hop,
        duration=seconds,
        bpm=bpm,
        beat_times=np.arange(0, seconds, 60 / bpm),
        onset_frames=np.array([], dtype=int),
        onset_times=np.array([], dtype=float),
        onset_env=np.zeros(n, dtype=np.float32),
        rms=rms,
        rms_max_raw=1.0,
        spectral_centroid=np.zeros(n, dtype=np.float32),
        band_onset={"low": np.zeros(n), "mid": np.zeros(n), "high": np.zeros(n)},
        band_energy={"low": np.zeros(n), "mid": mid, "high": high},
    )


def _note(t: float, lane: int, band: str = "mid", salience: float = 0.9, contrast: float = 0.9) -> PlannedNote:
    strengths = {"low": 0.1, "mid": 0.7, "high": 0.1}
    if band == "high":
        strengths = {"low": 0.05, "mid": 0.25, "high": 0.9}
    elif band == "low":
        strengths = {"low": 0.9, "mid": 0.25, "high": 0.05}
    return PlannedNote(
        t, lane, salience, 4, band, "alternate",
        local_contrast=contrast, strength=0.9, loudness=0.9, band_strengths=strengths
    )


def test_easy_remains_tap_only():
    notes = [_note(1.0, 0), _note(2.5, 1, "high")]
    out, stats = assign_note_types(notes, _features(), DIFFICULTIES["easy"])
    assert all(n.note_type == "tap" for n in out)
    assert stats.holds_assigned == stats.flicks_assigned == 0


def test_sustained_mid_event_can_become_hold_on_hard():
    notes = [_note(1.0, 0)] + [_note(3.0 + i * 0.5, (i + 1) % 4, "low", 0.5, 0.5) for i in range(11)]
    out, stats = assign_note_types(notes, _features(), DIFFICULTIES["hard"])
    hold = out[0]
    assert stats.holds_assigned >= 1
    assert hold.note_type == "hold"
    assert hold.duration is not None and hold.duration >= 0.5


def test_short_decay_does_not_become_hold():
    f = _features(sustained=False)
    f.rms[10:12] = 0.9
    f.band_energy["mid"][10:12] = 0.9
    notes = [_note(1.0, 0)] + [_note(3.0 + i * 0.5, (i + 1) % 4, "low", 0.5, 0.5) for i in range(11)]
    out, _ = assign_note_types(notes, f, DIFFICULTIES["hard"])
    assert out[0].note_type == "tap"


def test_strong_high_phrase_end_can_become_flick_on_expert():
    notes = [_note(0.5 + i * 0.2, i % 4, "mid", 0.45, 0.45) for i in range(12)]
    notes[5] = _note(1.5, 2, "high", 0.95, 0.95)
    # 다음 노트를 멀리 두어 phrase-end 성격을 만든다.
    for i in range(6, len(notes)):
        notes[i].time += 0.45
    out, stats = assign_note_types(notes, _features(sustained=False), DIFFICULTIES["expert"])
    assert stats.flicks_assigned >= 1
    assert any(n.note_type == "flick" for n in out)


def test_note_type_caps_and_timing_lane_invariance():
    notes = [_note(0.5 + i * 0.45, i % 4, "high" if i % 3 == 0 else "mid", 0.95, 0.95) for i in range(30)]
    before = [(n.time, n.lane) for n in notes]
    out, _ = assign_note_types(notes, _features(seconds=20, sustained=False), DIFFICULTIES["expert"])
    assert [(n.time, n.lane) for n in out] == before
    holds = sum(n.note_type == "hold" for n in out)
    flicks = sum(n.note_type == "flick" for n in out)
    nt = NOTE_TYPE_CONFIGS["Expert"]
    assert holds <= round(len(out) * nt.hold_max_ratio)
    assert flicks <= round(len(out) * nt.flick_max_ratio)


def test_high_notes_inside_steady_stream_do_not_become_flick():
    """일정한 8분 하이햇 stream 중간의 고역 노트는 '구절 끝/고립 강세'가 아니므로 Flick 금지."""
    notes = [_note(0.5 + i * 0.17, i % 4, "high", 0.95, 0.95) for i in range(24)]
    out, stats = assign_note_types(notes, _features(sustained=False), DIFFICULTIES["expert"])
    assert all(n.note_type != "flick" for n in out[:-1])


def test_normal_hold_avoids_other_notes_during_sustain():
    notes = [_note(1.0, 0)]
    # sustain 중간에 다른 노트가 있으면 Normal에서는 단순 Hold 후보에서 제외한다.
    notes.append(_note(1.25, 3, "low", 0.5, 0.5))
    notes.extend(_note(3.0 + i * 0.5, (i + 1) % 4, "low", 0.5, 0.5) for i in range(18))
    out, _ = assign_note_types(notes, _features(seconds=16), DIFFICULTIES["normal"])
    assert out[0].note_type == "tap"


def test_hard_hold_rejects_same_hand_notes_inside_sustain():
    notes = [_note(1.0, 0)]
    notes.append(_note(1.5, 1, "low", 0.5, 0.5))  # same left hand
    notes.extend(_note(3.0 + i * 0.5, 2 + (i % 2), "low", 0.5, 0.5) for i in range(18))
    out, _ = assign_note_types(notes, _features(seconds=16), DIFFICULTIES["hard"])
    assert out[0].note_type == "tap"
