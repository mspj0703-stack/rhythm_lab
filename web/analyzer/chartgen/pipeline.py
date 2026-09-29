"""
오케스트레이터: Audio Analysis -> Musical Events -> Event Selection -> Pattern Generator -> Playability Pass.

각 단계의 입출력은 명시적인 데이터 구조이므로, 나중에 Chart Planner나 AI 모델은
select_events / assign_lanes 자리에 끼워 넣으면 된다.
"""
from __future__ import annotations

import os
import time
from dataclasses import asdict, dataclass

from . import config as C
from .beatgrid import BeatGrid, align_grid_to_onsets
from .chart import build_chart, build_report
from .errors import InvalidOptionError
from .events import MusicalEvent, build_events
from .features import AudioFeatures, extract_features, extract_features_from_signal, log_stage
from .filtering import select_events
from .level_estimator import estimate_chart_level
from .note_types import assign_note_types
from .patterns import PlannedNote, assign_lanes
from .playability import apply_playability
from .quality import compute_quality_metrics


@dataclass
class GenerationResult:
    chart: dict
    report: dict
    features: AudioFeatures
    events: list[MusicalEvent]
    notes: list[PlannedNote]


def get_difficulty(name: str) -> C.DifficultyConfig:
    key = name.strip().lower()
    if key not in C.DIFFICULTIES:
        raise InvalidOptionError(f"알 수 없는 난이도: {name} (가능: {', '.join(C.DIFFICULTIES)})")
    return C.DIFFICULTIES[key]


def generate_from_features(features: AudioFeatures, difficulty: str, seed: int, title: str) -> GenerationResult:
    started = time.monotonic()
    cfg = get_difficulty(difficulty)
    grid = BeatGrid.from_beats(features.beat_times, features.duration)
    if features.onset_frames.size:
        weights = features.onset_env[features.onset_frames]
        grid, _ = align_grid_to_onsets(grid, features.onset_times, weights)
    events = build_events(features, grid) if features.onset_frames.size else []
    log_stage("event generation", started)
    selected, fstats = select_events(events, cfg)
    planned, usage = assign_lanes(selected, cfg, seed)
    final, pstats = apply_playability(planned, cfg)
    typed, ntstats = assign_note_types(final, features, cfg)
    level_estimate = estimate_chart_level(typed, cfg.name)

    chart = build_chart(typed, cfg, features.bpm, title, level=level_estimate.level)
    log_stage("chart generation", started)
    quality = compute_quality_metrics(features=features, events=events, selected_count=len(selected), notes=typed)
    report = build_report(
        bpm=features.bpm, duration=features.duration, raw_onsets=int(features.onset_frames.size),
        event_count=len(events), filtered_count=len(selected), notes=typed,
        repetition_fixes=pstats.repetition_fixes, pattern_usage=usage,
        filter_stats=asdict(fstats), playability_stats=asdict(pstats),
        warnings=list(features.warnings), difficulty=cfg.name, seed=seed,
        bpm_confidence=features.bpm_confidence,
        tempo_candidates=[x.to_dict() for x in features.tempo_candidates],
        quality_metrics=quality,
        note_type_stats=asdict(ntstats),
        level_estimate=asdict(level_estimate),
    )
    return GenerationResult(chart, report, features, events, typed)


def generate_chart(audio_path: str, difficulty: str = "normal", seed: int = 0, title: str | None = None) -> GenerationResult:
    get_difficulty(difficulty)  # 오디오 분석 전에 옵션 먼저 검증
    features = extract_features(audio_path)
    if title is None:
        title = os.path.splitext(os.path.basename(audio_path))[0]
    return generate_from_features(features, difficulty, seed, title)


def generate_chart_from_signal(
    y, sr: int, difficulty: str = "normal", seed: int = 0, title: str = "Generated Chart"
) -> GenerationResult:
    return generate_from_features(extract_features_from_signal(y, sr), difficulty, seed, title)
