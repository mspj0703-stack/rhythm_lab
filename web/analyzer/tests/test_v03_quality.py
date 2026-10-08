"""v0.3 실제 곡 대응용 회귀 테스트."""
from __future__ import annotations

from chartgen import config as C
from chartgen.events import MusicalEvent, merge_close_events
from chartgen.patterns import phrase_similarity


def _event(t: float, band: str = "mid", strength: float = 0.8) -> MusicalEvent:
    return MusicalEvent(
        time=t,
        raw_time=t,
        strength=strength,
        loudness=0.7,
        band=band,
        local_contrast=0.8,
        salience=0.8,
        beat_index=int(t * 2),
        grid_division=8,
    )


def test_tempo_candidates_and_confidence(samples):
    from chartgen.features import extract_features

    f = extract_features(samples["fast_180.wav"])
    assert f.tempo_candidates
    assert any(c.selected for c in f.tempo_candidates)
    assert 0 < f.bpm_confidence <= 1
    assert any(abs(c.bpm - 180) / 180 < 0.03 for c in f.tempo_candidates)
    summary = f.to_summary()
    assert summary["tempoCandidates"] and "bpmConfidence" in summary


def test_event_cluster_suppresses_split_attack():
    a = _event(1.000, "low", 0.7)
    b = _event(1.026, "high", 0.9)
    b.band_strengths = {"high": 1.0}
    merged = merge_close_events([a, b])
    assert len(merged) == 1
    assert merged[0].cluster_size == 2
    assert merged[0].strength >= 0.9


def test_event_cluster_preserves_real_fast_notes():
    # 180 BPM 16분음표는 약 83ms. cluster window보다 충분히 멀어 보존되어야 한다.
    a = _event(1.000)
    b = _event(1.083)
    assert len(merge_close_events([a, b])) == 2


def test_fuzzy_phrase_similarity_accepts_small_jitter_and_band_variation():
    a = [_event(1.00, "low"), _event(1.25, "mid"), _event(1.50, "high"), _event(1.75, "mid")]
    b = [_event(5.00, "low"), _event(5.26, "mid"), _event(5.49, "high"), _event(5.76, "high")]
    assert phrase_similarity(a, b) >= C.PHRASE_SIMILARITY_THRESHOLD


def test_fuzzy_phrase_similarity_rejects_different_shape():
    a = [_event(1.00, "low"), _event(1.25, "mid"), _event(1.50, "high"), _event(1.75, "mid")]
    b = [_event(5.00, "high"), _event(5.05, "high"), _event(5.10, "high"), _event(5.75, "high")]
    assert phrase_similarity(a, b) < C.PHRASE_SIMILARITY_THRESHOLD


def test_v03_quality_report_fields(gen):
    r = gen("accent.wav", "hard", 42)
    rep = r.report
    assert rep["generatorVersion"] == "5.0.0-phase1"
    assert rep["tempoCandidates"]
    q = rep["quality"]
    required = {
        "bpmConfidence", "gridAlignmentRatio", "offGridRatio", "clusterSuppressed",
        "filteredRawOnsetRatio", "averageNps", "peakNps1s", "laneBalance",
        "leftHandRatio", "sameLaneRepeatRatio", "extremeJumpRatio", "averageLaneMovement",
        "maxSameHandRun", "phraseReuseRatio", "phraseFamilyCount", "internalQualityScore",
    }
    assert required <= set(q)
    assert 0 <= q["internalQualityScore"] <= 100
    assert 0 <= q["gridAlignmentRatio"] <= 1
    assert 0 <= q["offGridRatio"] <= 1


def test_similar_repeated_material_has_phrase_reuse(gen):
    r = gen("kick_120.wav", "normal", 0)
    assert r.report["patternUsage"]["repeat"] > 0
    assert r.report["quality"]["phraseReuseRatio"] > 0


def test_pattern_set_tracks_new_patterns(gen):
    r = gen("accent.wav", "expert", 7)
    usage = r.report["patternUsage"]
    assert set(C.PATTERN_NAMES) <= set(usage)
    assert sum(usage.values()) > 0
