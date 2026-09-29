"""출력: v0.1 chart schema 호환 JSON + v0.3 분석/품질 리포트."""
from __future__ import annotations

from collections import Counter

from .config import DifficultyConfig
from .density import max_count_in_window, peak_window_start
from .patterns import PlannedNote


def build_chart(
    notes: list[PlannedNote],
    cfg: DifficultyConfig,
    bpm: float,
    title: str,
    artist: str = "",
    level: int | None = None,
) -> dict:
    return {
        "title": title,
        "artist": artist,
        "bpm": round(float(bpm), 2),
        "offset": 0,
        "difficulty": cfg.name,
        "level": int(cfg.level if level is None else level),
        "notes": [
            ({
                "time": round(n.time, 3),
                "lane": int(n.lane),
                "type": n.note_type,
                **({"duration": round(float(n.duration), 3)} if n.note_type == "hold" and n.duration is not None else {}),
            })
            for n in notes
        ],
    }


def build_report(
    *,
    bpm: float,
    duration: float,
    raw_onsets: int,
    event_count: int,
    filtered_count: int,
    notes: list[PlannedNote],
    repetition_fixes: int,
    pattern_usage: dict[str, int],
    filter_stats: dict,
    playability_stats: dict,
    warnings: list[str],
    difficulty: str,
    seed: int,
    bpm_confidence: float = 0.0,
    tempo_candidates: list[dict] | None = None,
    quality_metrics: dict | None = None,
    note_type_stats: dict | None = None,
    level_estimate: dict | None = None,
) -> dict:
    times = [n.time for n in notes]
    lanes = Counter(n.lane for n in notes)
    total = len(notes)
    divisions = Counter(str(n.division) if n.division else "unquantized" for n in notes)
    note_types = Counter(n.note_type for n in notes)
    return {
        "generatorVersion": "0.3.0-rc.1",
        "difficulty": difficulty,
        "seed": seed,
        "bpm": round(float(bpm), 2),
        "bpmConfidence": round(float(bpm_confidence), 4),
        "tempoCandidates": tempo_candidates or [],
        "duration": round(float(duration), 3),
        "rawOnsetCount": raw_onsets,
        "musicalEventCount": event_count,
        "filteredEventCount": filtered_count,
        "finalNoteCount": total,
        "notesPerSecond": round(total / duration, 3) if duration > 0 else 0.0,
        "peakNotesIn1s": max_count_in_window(times),
        "peakWindowStart": round(peak_window_start(times), 3) if times else None,
        "laneUsage": {str(k): round(lanes.get(k, 0) / total, 3) if total else 0.0 for k in range(4)},
        "divisionUsage": dict(divisions),
        "noteTypeUsage": {k: note_types.get(k, 0) for k in ("tap", "hold", "flick")},
        "noteTypeStats": note_type_stats or {},
        "chartLevel": int((level_estimate or {}).get("level", 0)),
        "levelEstimate": level_estimate or {},
        "repetitionFixes": repetition_fixes,
        "patternUsage": pattern_usage,
        "filterStats": filter_stats,
        "playabilityStats": playability_stats,
        "quality": quality_metrics or {},
        "warnings": warnings,
    }


def format_report(r: dict) -> str:
    lane = " ".join(f"L{k}:{v * 100:.0f}%" for k, v in r["laneUsage"].items())
    lines = [
        f"[{r['difficulty']}] seed={r['seed']}",
        f"  BPM                 : {r['bpm']} (confidence {r.get('bpmConfidence', 0):.2f})",
        f"  duration            : {r['duration']}s",
        f"  raw onset count     : {r['rawOnsetCount']}",
        f"  musical events      : {r['musicalEventCount']}",
        f"  filtered event count: {r['filteredEventCount']}",
        f"  final note count    : {r['finalNoteCount']}",
        f"  notes per second    : {r['notesPerSecond']}",
        f"  peak 1s density     : {r['peakNotesIn1s']} (from {r['peakWindowStart']}s)",
        f"  lane usage          : {lane}",
        f"  grid division usage : {r['divisionUsage']}",
        f"  note type usage     : {r.get('noteTypeUsage', {})}",
        f"  estimated level     : Lv.{r.get('chartLevel', 0)}",
        f"  repetition fixes    : {r['repetitionFixes']}",
        f"  pattern usage       : {r['patternUsage']}",
    ]
    if r.get("quality"):
        lines.append(f"  internal quality    : {r['quality'].get('internalQualityScore', 0):.1f}/100")
        lines.append(f"  phrase reuse ratio  : {r['quality'].get('phraseReuseRatio', 0):.2f}")
    for w in r["warnings"]:
        lines.append(f"  WARNING: {w}")
    return "\n".join(lines)
