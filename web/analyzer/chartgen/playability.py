"""
5단계: Playability Pass.

Pattern Generator 결과가 "음악적으로는 맞지만 치기 불편한" 경우를 후처리로 고친다.
이 단계는 어떤 생성기(규칙 기반/AI)가 앞에 오든 항상 마지막에 실행되는 안전망이다.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import config as C
from .config import DifficultyConfig
from .density import max_count_in_window
from .patterns import PlannedNote

DUPLICATE_WINDOW_SEC = 0.010


@dataclass
class PlayabilityStats:
    duplicates_removed: int = 0
    min_interval_removed: int = 0
    same_lane_reassigned: int = 0
    same_lane_removed: int = 0
    jump_repeat_fixed: int = 0
    density_removed: int = 0

    @property
    def repetition_fixes(self) -> int:
        """리포트용 '반복 제거 횟수': 같은 레인 연타 + 1-4-1-4 반복 보정 합계."""
        return self.same_lane_reassigned + self.same_lane_removed + self.jump_repeat_fixed


def remove_duplicates(notes: list[PlannedNote], stats: PlayabilityStats) -> list[PlannedNote]:
    out: list[PlannedNote] = []
    for n in sorted(notes, key=lambda n: (n.time, -n.salience)):
        if out and n.time - out[-1].time < DUPLICATE_WINDOW_SEC:
            stats.duplicates_removed += 1
            continue
        out.append(n)
    return out


def enforce_min_interval(notes: list[PlannedNote], cfg: DifficultyConfig, stats: PlayabilityStats) -> list[PlannedNote]:
    out: list[PlannedNote] = []
    for n in notes:
        if out and n.time - out[-1].time < cfg.min_interval_sec:
            stats.min_interval_removed += 1
            if n.salience > out[-1].salience:
                out[-1] = n
            continue
        out.append(n)
    return out


def fix_same_lane(notes: list[PlannedNote], cfg: DifficultyConfig, stats: PlayabilityStats) -> list[PlannedNote]:
    out: list[PlannedNote] = []
    run = 0
    for idx, n in enumerate(notes):
        if out:
            prev = out[-1]
            interval = n.time - prev.time
            violates = n.lane == prev.lane and (interval < cfg.same_lane_min_interval_sec or run >= C.MAX_SAME_LANE_RUN)
            if violates:
                nxt = notes[idx + 1] if idx + 1 < len(notes) else None
                options = []
                for lane in sorted(range(4), key=lambda x: (abs(x - prev.lane), x)):
                    if lane == prev.lane:
                        continue
                    if abs(lane - prev.lane) == 3 and interval < C.BIG_JUMP_MIN_INTERVAL_SEC:
                        continue
                    if nxt is not None and nxt.lane == lane and nxt.time - n.time < cfg.same_lane_min_interval_sec:
                        continue
                    options.append(lane)
                if options:
                    n.lane = options[0]
                    stats.same_lane_reassigned += 1
                else:
                    stats.same_lane_removed += 1
                    continue
        run = run + 1 if out and n.lane == out[-1].lane else 1
        out.append(n)
    return out


def fix_jump_repeats(notes: list[PlannedNote], cfg: DifficultyConfig, stats: PlayabilityStats) -> list[PlannedNote]:
    """
    연속된 큰 점프(0->3->0, 1-4-1-4 반복 등)를 제한한다.
    x -> y -> z 에서 두 번 연속 |점프|==3 이면 가운데 노트를 한 칸 안쪽으로 당긴다.
    """
    for i in range(1, len(notes) - 1):
        a, b, c = notes[i - 1].lane, notes[i].lane, notes[i + 1].lane
        if abs(b - a) == 3 and abs(c - b) == 3:
            new_lane = b + (1 if b == 0 else -1)
            if new_lane not in (a, c):
                notes[i].lane = new_lane
                stats.jump_repeat_fixed += 1
    return notes


def enforce_density(notes: list[PlannedNote], cfg: DifficultyConfig, stats: PlayabilityStats) -> list[PlannedNote]:
    notes = list(notes)
    while notes and max_count_in_window([n.time for n in notes]) > cfg.max_notes_per_second:
        times = [n.time for n in notes]
        # 가장 밀집한 1초 구간을 찾아 그 안에서 salience가 가장 낮은 노트를 제거
        best, j, start_j, end_i = 0, 0, 0, 0
        for i in range(len(times)):
            while times[i] - times[j] >= 1.0:
                j += 1
            if i - j + 1 > best:
                best, start_j, end_i = i - j + 1, j, i
        victim = min(range(start_j, end_i + 1), key=lambda k: notes[k].salience)
        del notes[victim]
        stats.density_removed += 1
    return notes


def apply_playability(notes: list[PlannedNote], cfg: DifficultyConfig) -> tuple[list[PlannedNote], PlayabilityStats]:
    stats = PlayabilityStats()
    notes = remove_duplicates(notes, stats)
    notes = enforce_min_interval(notes, cfg, stats)
    notes = fix_same_lane(notes, cfg, stats)
    notes = fix_jump_repeats(notes, cfg, stats)
    notes = enforce_density(notes, cfg, stats)
    notes.sort(key=lambda n: n.time)
    for n in notes:
        if not 0 <= n.lane <= 3:
            raise AssertionError(f"lane out of range: {n}")
    return notes, stats
