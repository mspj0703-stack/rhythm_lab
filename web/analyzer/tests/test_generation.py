"""채보 생성 / 난이도 / seed / playability / 오류 처리 테스트."""
import json
import os
import subprocess
import sys

import pytest

from chartgen.config import DIFFICULTIES
from chartgen.density import max_count_in_window
from chartgen.errors import AudioLoadError, InvalidOptionError
from chartgen.pipeline import generate_chart

MUSIC = ["kick_120.wav", "fast_180.wav", "accent.wav", "bands.wav"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_03_same_seed_same_chart(samples):
    a = generate_chart(samples["accent.wav"], "hard", seed=42).chart
    b = generate_chart(samples["accent.wav"], "hard", seed=42).chart
    assert a == b


def test_04_different_seed_changes_lanes(gen):
    a = [n["lane"] for n in gen("accent.wav", "expert", 1).chart["notes"]]
    b = [n["lane"] for n in gen("accent.wav", "expert", 2).chart["notes"]]
    times_a = [n["time"] for n in gen("accent.wav", "expert", 1).chart["notes"]]
    times_b = [n["time"] for n in gen("accent.wav", "expert", 2).chart["notes"]]
    assert times_a == times_b, "seed는 레인만 바꾸고 타이밍은 바꾸지 않아야 한다"
    assert a != b


@pytest.mark.parametrize("name", MUSIC)
@pytest.mark.parametrize("diff", list(DIFFICULTIES))
def test_05_to_08_structural_invariants(gen, name, diff):
    r = gen(name, diff)
    notes = r.chart["notes"]
    cfg = DIFFICULTIES[diff]
    assert notes, "음악이 있는 파일에서는 노트가 생성되어야 한다"
    times = [n["time"] for n in notes]
    # 5. 오름차순
    assert times == sorted(times)
    # 6. lane 범위
    assert all(n["lane"] in (0, 1, 2, 3) for n in notes)
    assert all(n["type"] in ("tap", "hold", "flick") for n in notes)
    assert all(n["type"] != "hold" or n.get("duration", 0) > 0 for n in notes)
    assert all("duration" not in n for n in notes if n["type"] != "hold")
    # 7. 동일 lane + 동일 timestamp 중복 없음
    keys = [(n["time"], n["lane"]) for n in notes]
    assert len(keys) == len(set(keys))
    # 8. 최소 note 간격 (반올림 오차 1ms 허용)
    gaps = [b - a for a, b in zip(times, times[1:], strict=False)]
    assert min(gaps) >= cfg.min_interval_sec - 0.001, min(gaps)
    # 같은 레인 최소 간격
    last = {}
    for n in notes:
        if n["lane"] in last:
            assert n["time"] - last[n["lane"]] >= cfg.same_lane_min_interval_sec - 0.001
        last[n["lane"]] = n["time"]
    # 1초 밀도 상한
    assert max_count_in_window(times) <= cfg.max_notes_per_second


@pytest.mark.parametrize("name", MUSIC)
def test_lane_placement_not_random_and_hands_balanced(gen, name):
    from chartgen.config import BIG_JUMP_MIN_INTERVAL_SEC

    ratios = []
    for seed in range(6):
        notes = gen(name, "expert", seed).chart["notes"]
        lanes = [n["lane"] for n in notes]
        times = [n["time"] for n in notes]
        jumps = [abs(a - b) for a, b in zip(lanes, lanes[1:], strict=False)]
        ratios.append(jumps.count(3) / len(jumps))
        # 짧은 간격의 0<->3 점프 없음
        for i, j in enumerate(jumps):
            if j == 3:
                assert times[i + 1] - times[i] >= BIG_JUMP_MIN_INTERVAL_SEC - 0.001
        # 큰 점프 두 번 연속(0-3-0) 없음
        assert all(not (jumps[i] == 3 and jumps[i + 1] == 3) for i in range(len(jumps) - 1))
        # 좌/우 손 사용이 한쪽으로 쏠리지 않음
        left = sum(1 for x in lanes if x in (0, 1)) / len(lanes)
        assert 0.25 <= left <= 0.75
        # 같은 레인 3연속 이상 없음
        assert all(not (lanes[i] == lanes[i + 1] == lanes[i + 2]) for i in range(len(lanes) - 2))
    # 무작위 배치라면 |점프|=3 비율 기대값은 1/8. 인접 이동 선호이므로 평균이 훨씬 낮아야 한다.
    assert sum(ratios) / len(ratios) < 0.08, ratios


@pytest.mark.parametrize("name", MUSIC)
def test_09_easy_has_fewer_notes_than_expert(gen, name):
    easy = len(gen(name, "easy").chart["notes"])
    expert = len(gen(name, "expert").chart["notes"])
    assert easy <= expert
    if name != "kick_120.wav":  # 4분 킥만 있는 곡은 모든 난이도가 같을 수 있음
        assert easy < expert


def test_density_monotonic_on_dense_material(gen):
    counts = [len(gen("accent.wav", d).chart["notes"]) for d in ("easy", "normal", "hard", "expert")]
    assert counts == sorted(counts) and counts[0] < counts[-1], counts


@pytest.mark.parametrize("name", MUSIC)
def test_10_easy_has_no_sixteenths(gen, name):
    r = gen(name, "easy")
    assert all(n.division == 4 for n in r.notes), {n.division for n in r.notes}
    assert r.report["peakNotesIn1s"] <= DIFFICULTIES["easy"].max_notes_per_second


def test_hard_limits_sixteenth_ratio(gen):
    r = gen("accent.wav", "hard")
    six = sum(1 for n in r.notes if n.division == 16)
    assert six <= DIFFICULTIES["hard"].max_sixteenth_ratio * len(r.notes) + 1


def test_11_short_audio_graceful(samples):
    r = generate_chart(samples["short.wav"], "normal")
    assert r.chart["notes"] == []
    assert any("짧" in w for w in r.report["warnings"])


def test_12_silence_graceful(samples):
    r = generate_chart(samples["silence.wav"], "expert")
    assert r.chart["notes"] == []
    assert any("무음" in w for w in r.report["warnings"])


def test_13_malformed_inputs(samples, tmp_path):
    with pytest.raises(AudioLoadError):
        generate_chart(samples["corrupt.wav"], "normal")
    with pytest.raises(AudioLoadError):
        generate_chart(str(tmp_path / "does_not_exist.wav"), "normal")
    empty = tmp_path / "empty.wav"
    empty.write_bytes(b"")
    with pytest.raises(AudioLoadError):
        generate_chart(str(empty), "normal")
    with pytest.raises(InvalidOptionError):
        generate_chart(samples["kick_120.wav"], "insane")


def test_report_fields(gen):
    rep = gen("fast_180.wav", "hard").report
    for key in ("bpm", "duration", "rawOnsetCount", "filteredEventCount", "finalNoteCount",
                "notesPerSecond", "peakNotesIn1s", "laneUsage", "repetitionFixes"):
        assert key in rep
    assert abs(sum(rep["laneUsage"].values()) - 1.0) < 0.01


def test_repeated_phrases_reuse_lane_shape(gen):
    r = gen("kick_120.wav", "normal")
    assert r.report["patternUsage"]["repeat"] > 0


def test_cli_success_and_error_codes(samples, tmp_path):
    out = tmp_path / "c.json"
    rep = tmp_path / "r.json"
    ana = tmp_path / "a.json"
    cmd = [sys.executable, os.path.join(ROOT, "generate_chart.py"), samples["bands.wav"],
           "--difficulty", "hard", "--output", str(out), "--seed", "42", "--report", str(rep), "--dump-analysis", str(ana)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    chart = json.loads(out.read_text())
    assert chart["difficulty"] == "Hard" and chart["notes"]
    assert json.loads(rep.read_text())["finalNoteCount"] == len(chart["notes"])
    analysis = json.loads(ana.read_text())
    assert analysis["features"]["beatTimes"] and analysis["events"]

    p2 = subprocess.run([sys.executable, os.path.join(ROOT, "generate_chart.py"), samples["corrupt.wav"],
                         "-o", str(tmp_path / "x.json")], capture_output=True, text=True)
    assert p2.returncode == 2 and "ERROR" in p2.stderr


@pytest.mark.parametrize("name,period", [
    ("kick_120.wav", 0.5), ("fast_180.wav", 1 / 6), ("bands.wav", 0.25), ("accent.wav", 60 / 128 / 4),
])
@pytest.mark.parametrize("diff", ["easy", "expert"])
def test_chart_timing_matches_ground_truth(gen, name, period, diff):
    """합성음의 실제 발음 위치(1.0 + k*period)와 채보 노트 시각의 오차가 12ms 이내 (Perfect 창 30ms 대비 여유)."""
    notes = gen(name, diff).chart["notes"]
    for n in notes:
        k = round((n["time"] - 1.0) / period)
        assert abs(n["time"] - (1.0 + k * period)) < 0.012, n
