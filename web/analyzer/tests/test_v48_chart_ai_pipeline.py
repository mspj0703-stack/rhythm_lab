from chartgen.pipeline import generate_chart_from_signal
from synth import SR, make_accent, make_fast_180, make_kick_120

DIFFICULTIES = ("easy", "normal", "hard", "expert")

def _generate(signal, difficulty, seed=475):
    return generate_chart_from_signal(signal, SR, difficulty=difficulty, seed=seed, title="v4.8 fixture")

def test_chart_ai_v2_is_active_for_representative_pipeline_fixtures():
    fixtures = (make_accent(), make_fast_180(), make_kick_120())
    for signal in fixtures:
        for difficulty in DIFFICULTIES:
            result = _generate(signal, difficulty)
            stats = result.report["filterStats"]["chartAiV2"]
            assert stats["input_count"] >= stats["output_count"]
            assert stats["output_count"] == result.report["filteredEventCount"]
            assert stats["protected_accents"] <= stats["input_count"]
            assert result.report["finalNoteCount"] <= result.report["filteredEventCount"]

def test_representative_chart_generation_remains_deterministic():
    signal = make_fast_180()
    a = _generate(signal, "hard", seed=8128)
    b = _generate(signal, "hard", seed=8128)
    assert a.chart == b.chart
    assert a.report["patternUsage"] == b.report["patternUsage"]
    assert a.report["filterStats"]["chartAiV2"] == b.report["filterStats"]["chartAiV2"]

def test_strong_beats_are_protected_and_difficulty_density_is_not_inverted():
    signal = make_accent()
    results = [_generate(signal, difficulty) for difficulty in DIFFICULTIES]
    counts = [result.report["finalNoteCount"] for result in results]
    assert counts == sorted(counts)
    assert all(result.report["filterStats"]["chartAiV2"]["protected_accents"] > 0 for result in results)

def test_repeated_beat_fixture_uses_pattern_repetition_without_schema_change():
    result = _generate(make_kick_120(), "hard")
    assert result.report["patternUsage"].get("repeat", 0) > 0
    assert set(result.chart) == {"title", "artist", "bpm", "offset", "difficulty", "level", "notes"}
