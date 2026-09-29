"""Audio Analysis / Musical Event / Beat Grid 테스트."""
import numpy as np

from chartgen.beatgrid import BeatGrid
from chartgen.features import extract_features


def test_01_bpm_120_detected(samples):
    f = extract_features(samples["kick_120.wav"])
    assert abs(f.bpm - 120) / 120 < 0.03, f.bpm


def test_01b_bpm_180_not_confused_with_120(samples):
    f = extract_features(samples["fast_180.wav"])
    assert abs(f.bpm - 180) / 180 < 0.03, f.bpm


def test_02_onset_count_in_expected_range(samples):
    # kick_120: 1.0s부터 15.7s 전까지 0.5s 간격 -> 30개
    f = extract_features(samples["kick_120.wav"])
    assert 28 <= len(f.onset_times) <= 32, len(f.onset_times)
    # fast_180: 4분 킥 + 8분 하이햇 -> 약 90개
    f2 = extract_features(samples["fast_180.wav"])
    assert 80 <= len(f2.onset_times) <= 95, len(f2.onset_times)


def test_onset_times_close_to_ground_truth(samples):
    f = extract_features(samples["kick_120.wav"])
    truth = 1.0 + 0.5 * np.arange(len(f.onset_times))
    assert np.max(np.abs(f.onset_times - truth)) < 0.03


def test_musical_events_have_band_and_grid_info(gen):
    r = gen("bands.wav", "expert")
    assert r.events, "이벤트가 있어야 함"
    e = r.events[0].to_dict()
    for key in ("time", "strength", "band", "beatAligned", "beatIndex", "gridDivision", "salience"):
        assert key in e
    bands = [ev.band for ev in r.events]
    # low/mid/high 가 번갈아 나오는 합성음 -> 세 band 모두 충분히 등장
    for b in ("low", "mid", "high"):
        assert bands.count(b) >= len(bands) * 0.2, (b, bands.count(b), len(bands))


def test_band_classification_follows_cycle(gen):
    r = gen("bands.wav", "expert")
    # 합성음은 low, mid, high 순환. 인접 3개가 모두 다른 band인 비율이 높아야 한다.
    bands = [e.band for e in r.events]
    triples = [len(set(bands[i:i + 3])) == 3 for i in range(len(bands) - 2)]
    assert sum(triples) / len(triples) > 0.8


def test_beat_grid_divisions_and_quantize():
    beats = np.arange(0, 4.01, 0.5)  # 120 BPM
    g = BeatGrid.from_beats(beats, 4.0)
    q = g.quantize(1.0 + 0.01)
    assert q.quantized and q.division == 4 and abs(q.time - 1.0) < 1e-9
    q = g.quantize(1.25 - 0.005)
    assert q.quantized and q.division == 8
    q = g.quantize(1.125 + 0.004)
    assert q.quantized and q.division == 16
    # 허용 오차 밖 -> quantize 하지 않음 (강제로 붙이지 않는다)
    q = g.quantize(1.06)
    assert not q.quantized and q.time == 1.06


def test_empty_beat_grid_does_not_quantize():
    g = BeatGrid.from_beats(np.array([1.0]), 3.0)
    assert g.is_empty
    assert not g.quantize(1.0).quantized
