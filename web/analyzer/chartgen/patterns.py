"""
4단계: Pattern Generator.

완전 랜덤 배치를 피하고 phrase 단위 패턴을 사용한다.
v0.3에서는 exact signature 대신 fuzzy phrase similarity를 사용해, 편곡/검출 지터가 조금
있어도 비슷한 리듬 프레이즈는 비슷한 레인 모양을 재사용할 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import config as C
from .config import DifficultyConfig
from .events import MusicalEvent


@dataclass
class PlannedNote:
    time: float
    lane: int
    salience: float
    division: int | None
    band: str
    pattern: str
    phrase_family: int | None = None
    phrase_reused: bool = False
    local_contrast: float = 0.0
    strength: float = 0.0
    loudness: float = 0.0
    band_strengths: dict[str, float] = field(default_factory=dict)
    note_type: str = "tap"
    duration: float | None = None

    def copy(self) -> PlannedNote:
        return PlannedNote(**self.__dict__)


@dataclass
class PatternState:
    prev_lane: int | None = None
    prev_time: float | None = None
    run_length: int = 0
    direction: int = 1
    pattern_step: int = 0
    usage: dict[str, int] = field(default_factory=lambda: {n: 0 for n in C.PATTERN_NAMES})


def hand_of(lane: int) -> int:
    return 0 if lane in C.LEFT_HAND else 1


def pattern_alternate(state: PatternState, event: MusicalEvent, rng: np.random.Generator) -> int:
    pref = C.BAND_LANE_PREFERENCE.get(event.band, (1, 1, 1, 1))
    if state.prev_lane is None:
        lanes = [0, 1, 2, 3]
    else:
        lanes = list(C.RIGHT_HAND if hand_of(state.prev_lane) == 0 else C.LEFT_HAND)
    weights = np.array([pref[lane] for lane in lanes], dtype=float)
    if state.prev_lane is not None:
        weights *= np.array([1.0 / (1 + 0.5 * abs(lane - state.prev_lane) ** 2) for lane in lanes])
        weights *= np.array([0.5 if abs(lane - state.prev_lane) == 3 else 1.0 for lane in lanes])
    weights /= weights.sum()
    return int(rng.choice(lanes, p=weights))


def pattern_stair(state: PatternState, event: MusicalEvent, rng: np.random.Generator) -> int:
    if state.prev_lane is None:
        return 0 if state.direction > 0 else 3
    nxt = state.prev_lane + state.direction
    if 0 <= nxt <= 3:
        return nxt
    return state.prev_lane - 2 * state.direction


def pattern_bounce(state: PatternState, event: MusicalEvent, rng: np.random.Generator) -> int:
    if state.prev_lane is None:
        return 0 if state.direction > 0 else 3
    nxt = state.prev_lane + state.direction
    if not 0 <= nxt <= 3:
        state.direction *= -1
        nxt = state.prev_lane + state.direction
    return nxt


def pattern_zigzag(state: PatternState, event: MusicalEvent, rng: np.random.Generator) -> int:
    seq = (0, 2, 1, 3) if state.direction > 0 else (3, 1, 2, 0)
    return seq[state.pattern_step % len(seq)]


def pattern_anchor(state: PatternState, event: MusicalEvent, rng: np.random.Generator) -> int:
    # 중앙 레인을 축으로 두고 반대쪽/바깥쪽을 섞는 형태. 0<->3 직접 점프는 피한다.
    seq = (1, 2, 1, 0) if state.direction > 0 else (2, 1, 2, 3)
    return seq[state.pattern_step % len(seq)]


PATTERN_FUNCS = {
    "alternate": pattern_alternate,
    "stair": pattern_stair,
    "bounce": pattern_bounce,
    "zigzag": pattern_zigzag,
    "anchor": pattern_anchor,
}


def enforce_constraints(lane: int, state: PatternState, t: float, cfg: DifficultyConfig) -> int:
    if state.prev_lane is None or state.prev_time is None:
        return lane
    interval = t - state.prev_time
    prev = state.prev_lane
    if lane == prev and (interval < cfg.same_lane_min_interval_sec or state.run_length >= C.MAX_SAME_LANE_RUN):
        options = sorted((x for x in range(4) if x != prev), key=lambda x: (abs(x - prev), x))
        lane = options[0]
    # 0<->3 점프는 저속 구간에서만 남긴다. 실제 곡 자동채보에서 이런 점프가
    # 반복되면 랜덤 배치처럼 느껴지므로 기존 hard limit보다 넓은 soft limit를 둔다.
    if abs(lane - prev) == 3 and interval < C.BIG_JUMP_SOFT_INTERVAL_SEC:
        lane = prev + (1 if lane > prev else -1) * 2
    return lane


def split_phrases(events: list[MusicalEvent], beats_per_phrase: int = 4) -> list[list[MusicalEvent]]:
    phrases: list[list[MusicalEvent]] = []
    current_key = None
    for e in events:
        key = (e.beat_index // beats_per_phrase) if e.beat_index is not None else int(e.time // 2.0) + 100000
        if key != current_key:
            phrases.append([])
            current_key = key
        phrases[-1].append(e)
    return phrases


def phrase_signature(phrase: list[MusicalEvent]) -> tuple:
    """호환/디버그용 coarse signature. fuzzy 매칭 자체는 phrase_similarity를 사용한다."""
    if not phrase:
        return ()
    start = phrase[0].time
    return tuple((int(round((e.time - start) * 25)), e.band) for e in phrase)


def _normalized_positions(phrase: list[MusicalEvent]) -> np.ndarray:
    if not phrase:
        return np.array([], dtype=float)
    if len(phrase) == 1:
        return np.array([0.0])
    times = np.array([e.time for e in phrase], dtype=float)
    span = max(float(times[-1] - times[0]), 1e-6)
    return (times - times[0]) / span


def phrase_similarity(a: list[MusicalEvent], b: list[MusicalEvent]) -> float:
    """0~1. timing shape + band sequence 유사도. 같은 길이의 phrase에서 가장 의미가 크다."""
    if not a or not b or abs(len(a) - len(b)) > C.PHRASE_MAX_COUNT_DELTA:
        return 0.0
    # lane shape 재사용은 동일 note 수에서만 안전하므로, count가 다르면 family 후보 점수만 낮춘다.
    count_penalty = 1.0 if len(a) == len(b) else 0.72
    n = min(len(a), len(b))
    pa = _normalized_positions(a)
    pb = _normalized_positions(b)
    if n == 1:
        timing_score = 1.0
    else:
        # 길이가 하나 다를 때는 균등 위치로 보간해 대략적인 리듬 모양을 비교한다.
        x = np.linspace(0.0, 1.0, n)
        xa = np.linspace(0.0, 1.0, len(pa))
        xb = np.linspace(0.0, 1.0, len(pb))
        ia = np.interp(x, xa, pa)
        ib = np.interp(x, xb, pb)
        mean_delta = float(np.mean(np.abs(ia - ib)))
        timing_score = float(np.clip(1.0 - mean_delta / 0.20, 0.0, 1.0))
    band_matches = sum(a[i].band == b[i].band for i in range(n)) / n
    score = C.PHRASE_TIMING_WEIGHT * timing_score + C.PHRASE_BAND_WEIGHT * band_matches
    return float(np.clip(score * count_penalty, 0.0, 1.0))


def choose_pattern(phrase: list[MusicalEvent], rng: np.random.Generator, cfg: DifficultyConfig) -> str:
    """난이도에 따라 패턴 어휘 자체를 달리한다. density만 줄이는 방식은 피한다."""
    median_gap = float(np.median(np.diff([e.time for e in phrase]))) if len(phrase) > 1 else 1.0
    names = ["alternate", "stair", "bounce", "zigzag", "anchor"]
    if cfg.name == "Easy":
        weights = [0.66, 0.04, 0.16, 0.02, 0.12]
    elif cfg.name == "Normal":
        weights = [0.52, 0.10, 0.14, 0.07, 0.17]
    elif cfg.name == "Hard":
        weights = [0.34, 0.18, 0.18, 0.15, 0.15]
    elif median_gap < C.STREAM_INTERVAL_SEC:
        weights = [0.12, 0.28, 0.22, 0.28, 0.10]
    else:
        weights = [0.28, 0.20, 0.17, 0.19, 0.16]
    return str(rng.choice(names, p=weights))


def _entry_cost(seq: list[int], prev_lane: int) -> int:
    d = abs(seq[0] - prev_lane)
    return 10 if d == 0 else (5 if d == 3 else d)


def assign_lanes(events: list[MusicalEvent], cfg: DifficultyConfig, seed: int) -> tuple[list[PlannedNote], dict[str, int]]:
    rng = np.random.default_rng(seed)
    state = PatternState(direction=1 if rng.random() < 0.5 else -1)
    # (phrase, lane shape, family id)
    remembered: list[tuple[list[MusicalEvent], list[int], int]] = []
    notes: list[PlannedNote] = []
    next_family = 0

    for phrase in split_phrases(events):
        if not phrase:
            continue
        best: tuple[float, list[int], int] | None = None
        for old_phrase, old_lanes, family_id in remembered:
            if len(old_lanes) != len(phrase):
                continue
            sim = phrase_similarity(old_phrase, phrase)
            if sim >= C.PHRASE_SIMILARITY_THRESHOLD and (best is None or sim > best[0]):
                best = (sim, old_lanes, family_id)

        replay = list(best[1]) if best else None
        family_id = best[2] if best else next_family
        if best is None:
            next_family += 1
        pattern = "repeat" if replay is not None else choose_pattern(phrase, rng, cfg)
        state.usage[pattern] += 1

        if replay is not None and state.prev_lane is not None:
            mirrored = [3 - x for x in replay]
            replay = min((replay, mirrored), key=lambda seq: _entry_cost(seq, state.prev_lane))

        lanes: list[int] = []
        for i, e in enumerate(phrase):
            state.pattern_step = i
            lane = replay[i] if replay is not None else PATTERN_FUNCS[pattern](state, e, rng)
            lane = enforce_constraints(lane, state, e.time, cfg)
            state.run_length = state.run_length + 1 if lane == state.prev_lane else 1
            state.prev_lane, state.prev_time = lane, e.time
            lanes.append(lane)
            notes.append(
                PlannedNote(
                    e.time,
                    lane,
                    e.salience,
                    e.grid_division,
                    e.band,
                    pattern,
                    phrase_family=family_id,
                    phrase_reused=replay is not None,
                    local_contrast=e.local_contrast,
                    strength=e.strength,
                    loudness=e.loudness,
                    band_strengths=dict(e.band_strengths),
                )
            )

        if replay is None:
            remembered.append((list(phrase), list(lanes), family_id))
        if rng.random() < 0.3:
            state.direction *= -1

    return notes, state.usage
