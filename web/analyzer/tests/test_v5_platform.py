"""All ten generation paths, chords, seed stability, Hold occupancy and legacy mobile patterns."""
from collections import Counter

import pytest
from test_note_types import _features, _note

from chartgen.config import DIFFICULTIES
from chartgen.density import max_count_in_window
from chartgen.errors import InvalidOptionError
from chartgen.features import extract_features_from_signal
from chartgen.note_types import assign_note_types
from chartgen.pipeline import generate_chart, generate_from_features
from synth import SR, make_bands


@pytest.fixture(scope="module")
def music():
    return extract_features_from_signal(make_bands(), SR)


@pytest.mark.parametrize("platform", ["mobile", "desktop"])
@pytest.mark.parametrize("difficulty", list(DIFFICULTIES))
def test_generation_matrix(music, platform, difficulty):
    cfg = DIFFICULTIES[difficulty]
    result = generate_from_features(music, difficulty, 42, "v5", platform)
    chart = result.chart
    assert chart["version"] == 5 and chart["platformProfile"] == platform and chart["scoringVersion"] == 2
    assert chart == generate_from_features(music, difficulty, 42, "v5", platform).chart
    assert chart["notes"] and 1 <= chart["level"] <= 30
    if platform == "desktop":
        assert all(note["type"] != "flick" for note in chart["notes"])
    notes = chart["notes"]
    assert max_count_in_window([n["time"] for n in notes]) <= cfg.max_notes_per_second
    assert max(Counter(n["time"] for n in notes).values()) <= 2
    assert len({(n["time"], n["lane"]) for n in notes}) == len(notes)
    for lane in range(4):
        lane_notes = [note for note in notes if note["lane"] == lane]
        for a, b in zip(lane_notes, lane_notes[1:], strict=False):
            assert b["time"] - a["time"] >= cfg.same_lane_min_interval_sec - 0.001
            if a["type"] == "hold":
                assert b["time"] >= a["time"] + a["duration"] + 0.099
    for time in {note["time"] for note in notes}:
        chord = [note for note in notes if note["time"] == time]
        if len(chord) == 2:
            assert {note["lane"] // 2 for note in chord} == {0, 1}


def test_mobile_flick_is_preserved_and_desktop_removes_it_before_generation():
    notes = [_note(0.5 + i * 0.2, i % 4, "mid", 0.45, 0.45) for i in range(12)]
    notes[5] = _note(1.5, 2, "high", 0.95, 0.95)
    for note in notes[6:]:
        note.time += 0.45
    mobile, _ = assign_note_types(notes, _features(sustained=False), DIFFICULTIES["expert"], "mobile")
    desktop, _ = assign_note_types(notes, _features(sustained=False), DIFFICULTIES["expert"], "desktop")
    assert any(note.note_type == "flick" for note in mobile)
    assert not any(note.note_type == "flick" for note in desktop)


def test_extreme_and_desktop_include_accent_chords(music):
    for platform, difficulty in [("desktop", "hard"), ("desktop", "extreme"), ("mobile", "extreme")]:
        result = generate_from_features(music, difficulty, 42, "v5", platform)
        assert any(count == 2 for count in Counter(n.time for n in result.notes).values())
        # Every note remains grounded in a selected musical event.
        event_times = {round(event.time, 3) for event in result.events}
        assert all(round(note.time, 3) in event_times for note in result.notes)


def test_options_rejected_before_audio_io():
    with pytest.raises(InvalidOptionError):
        generate_chart("missing.wav", "extreme", platform="invalid")
