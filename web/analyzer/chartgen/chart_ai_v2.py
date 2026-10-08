"""Conservative v4.75 Chart AI v2 refinement.

Keeps the established analyzer/generator architecture. It only removes low-value filler
inside dense local runs and protects musically strong beat/accent events. No new chart
schema or platform-specific variants are introduced.
"""
from __future__ import annotations
from dataclasses import dataclass
from .events import MusicalEvent
from .config import DifficultyConfig

@dataclass
class V2Stats:
    input_count: int = 0
    removed_filler: int = 0
    protected_accents: int = 0
    output_count: int = 0

def refine_selected_events(events: list[MusicalEvent], cfg: DifficultyConfig) -> tuple[list[MusicalEvent], V2Stats]:
    stats = V2Stats(input_count=len(events))
    if len(events) < 3:
        stats.output_count = len(events); return list(events), stats
    out: list[MusicalEvent] = []
    # Easy/Normal need the strongest cleanup; Expert intentionally retains expressive density.
    filler_ratio = {"Easy": .92, "Normal": .82, "Hard": .70, "Expert": .58, "Extreme": .50}[cfg.name]
    for i, event in enumerate(events):
        accent = event.beat_aligned or event.local_contrast >= .72 or event.salience >= .72
        if accent:
            stats.protected_accents += 1; out.append(event); continue
        if i == 0 or i == len(events) - 1:
            out.append(event); continue
        prev, nxt = events[i - 1], events[i + 1]
        local_dense = event.time - prev.time < cfg.min_interval_sec * 1.65 and nxt.time - event.time < cfg.min_interval_sec * 1.65
        neighbor_peak = max(prev.salience, nxt.salience, 1e-6)
        weak_between_stronger = event.salience < neighbor_peak * filler_ratio
        # Off-grid filler in a dense run is the least musically reliable candidate.
        if local_dense and weak_between_stronger and (event.grid_division is None or event.grid_division >= 16):
            stats.removed_filler += 1; continue
        out.append(event)
    stats.output_count = len(out)
    return out, stats
