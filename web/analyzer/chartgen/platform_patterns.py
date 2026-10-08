"""Keyboard patterns and cross-hand accent chords. No synthetic event times are added."""
from __future__ import annotations

from .config import DifficultyConfig
from .density import max_count_in_window
from .errors import InvalidOptionError
from .patterns import PlannedNote, hand_of


def validate_platform(platform: str) -> str:
    if platform not in ("mobile", "desktop"):
        raise InvalidOptionError("platform must be mobile or desktop")
    return platform


def keyboard_lanes(notes: list[PlannedNote], cfg: DifficultyConfig) -> list[PlannedNote]:
    out: list[PlannedNote] = []
    last = [-999.0] * 4
    for source in notes:
        note = source.copy()
        free = [lane for lane in range(4) if note.time - last[lane] >= cfg.same_lane_min_interval_sec - 1e-9]
        if not free:
            continue
        # Streams alternate hands; slower phrases retain the existing pattern vocabulary.
        preferred = free
        if out and note.time - out[-1].time < 0.22:
            opposite = [lane for lane in free if hand_of(lane) != hand_of(out[-1].lane)]
            preferred = opposite or free
        note.lane = min(preferred, key=lambda lane: (lane != note.lane, abs(lane - note.lane), lane))
        last[note.lane] = note.time
        out.append(note)
    return out


def accent_chords(notes: list[PlannedNote], cfg: DifficultyConfig, platform: str) -> list[PlannedNote]:
    ratio = {"Easy": 0.0, "Normal": 0.0, "Hard": 0.08, "Expert": 0.12, "Extreme": 0.20}[cfg.name]
    if platform == "mobile":
        ratio = 0.10 if cfg.name == "Extreme" else 0.0
    limit = int(len(notes) * ratio)
    out = [note.copy() for note in notes]
    chosen = 0
    last_chord = -999.0
    for note in notes:
        if chosen >= limit:
            break
        if (note.note_type != "tap" or note.division not in (4, 8) or note.salience < 0.72
                or note.local_contrast < 0.5 or note.time - last_chord < 0.3):
            continue
        # Chords never add work during a Hold or on an occupied lane.
        if any(n.note_type == "hold" and n.time <= note.time < n.time + float(n.duration or 0) + 0.1 for n in out):
            continue
        lanes = [lane for lane in range(4) if hand_of(lane) != hand_of(note.lane)]
        lanes = [lane for lane in lanes if all(
            n.lane != lane or abs(n.time - note.time) >= cfg.same_lane_min_interval_sec - 1e-9 for n in out
        )]
        if not lanes:
            continue
        lane = min(lanes, key=lambda candidate: (abs(candidate - note.lane), candidate))
        chord = note.copy()
        chord.lane = lane
        chord.pattern = "chord"
        # Enforce the same rolling density limit, including chords.
        if max_count_in_window(sorted([n.time for n in out] + [chord.time])) > cfg.max_notes_per_second:
            continue
        out.append(chord)
        chosen += 1
        last_chord = note.time
    return sorted(out, key=lambda note: (note.time, note.lane))
