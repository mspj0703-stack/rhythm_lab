"""v0.3 RC synthetic stress regression tests.

These do not claim real-song quality; they lock down failure modes that clean click tracks miss.
"""
from __future__ import annotations

import csv
import json

import pytest

from chartgen import config as C
from chartgen.pipeline import generate_chart
from score_manual_evaluation import main as score_manual_main


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("reverb_120.wav", 120.0),
        ("hat_storm_140.wav", 140.0),
        ("sustained_100.wav", 100.0),
        ("overlap_150.wav", 150.0),
        ("slow_attack_90.wav", 90.0),
        ("swing_120.wav", 120.0),
    ],
)
def test_fixed_tempo_stress_bpm(stress_samples, name, expected):
    result = generate_chart(stress_samples[name], "hard", 42)
    assert abs(result.report["bpm"] - expected) / expected <= 0.12, result.report["tempoCandidates"]
    selected = next(x for x in result.report["tempoCandidates"] if x["selected"])
    assert "beatAccent" in selected


@pytest.mark.parametrize(
    "name",
    [
        "reverb_120.wav",
        "hat_storm_140.wav",
        "sustained_100.wav",
        "overlap_150.wav",
        "tempo_change.wav",
        "slow_attack_90.wav",
        "swing_120.wav",
    ],
)
def test_stress_chart_stays_playable(stress_samples, name):
    result = generate_chart(stress_samples[name], "hard", 7)
    notes = result.chart["notes"]
    times = [n["time"] for n in notes]
    assert times == sorted(times)
    assert all(0 <= n["lane"] <= 3 for n in notes)
    assert result.report["peakNotesIn1s"] <= C.DIFFICULTIES["hard"].max_notes_per_second
    assert result.report["quality"]["extremeJumpRatio"] <= 0.12


@pytest.mark.parametrize("name", ["hat_storm_140.wav", "reverb_120.wav", "sustained_100.wav"])
def test_stress_easy_is_not_denser_than_expert(stress_samples, name):
    easy = generate_chart(stress_samples[name], "easy", 42)
    expert = generate_chart(stress_samples[name], "expert", 42)
    assert easy.report["finalNoteCount"] <= expert.report["finalNoteCount"]
    assert easy.report["peakNotesIn1s"] <= C.DIFFICULTIES["easy"].max_notes_per_second


def test_reverb_does_not_explode_event_count(stress_samples):
    result = generate_chart(stress_samples["reverb_120.wav"], "hard", 42)
    # Reverb may create extra raw detections, but MusicalEvent clustering/filtering should keep it bounded.
    assert result.report["musicalEventCount"] <= result.report["rawOnsetCount"]
    assert result.report["finalNoteCount"] <= result.report["rawOnsetCount"]


def test_hat_storm_is_filtered_on_easy(stress_samples):
    easy = generate_chart(stress_samples["hat_storm_140.wav"], "easy", 42)
    assert easy.report["finalNoteCount"] < easy.report["rawOnsetCount"] * 0.75


def test_tempo_change_is_graceful(stress_samples):
    result = generate_chart(stress_samples["tempo_change.wav"], "hard", 42)
    assert C.TEMPO_MIN_BPM <= result.report["bpm"] <= C.TEMPO_MAX_BPM
    assert result.report["finalNoteCount"] > 0
    assert result.report["quality"]["internalQualityScore"] >= 0


def test_manual_evaluation_aggregator(tmp_path):
    src = tmp_path / "manual.csv"
    out = tmp_path / "summary.json"
    with src.open("w", newline="", encoding="utf-8") as f:
        fields = [
            "title", "difficulty", "Timing", "Musicality", "PatternNaturalness",
            "Density", "Repetition", "OverallFun", "notes",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerow({
            "title": "A", "difficulty": "hard", "Timing": 5, "Musicality": 4,
            "PatternNaturalness": 4, "Density": 3, "Repetition": 4, "OverallFun": 5, "notes": "",
        })
    assert score_manual_main([str(src), "-o", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["scoredTracks"] == 1
    assert data["fieldAverages"]["Timing"] == 5
    assert 1 <= data["overallAverage"] <= 5
