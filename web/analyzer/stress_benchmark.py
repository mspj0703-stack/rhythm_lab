#!/usr/bin/env python3
"""v0.3 synthetic stress benchmark.

This is not a substitute for real-song listening tests. It deliberately targets common
failure modes (reverb tails, dense hats, sustained material, overlapping attacks,
tempo changes, slow attacks and swing) so regressions are caught before human testing.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import synth  # noqa: E402
from chartgen.config import DIFFICULTIES  # noqa: E402
from chartgen.pipeline import generate_chart  # noqa: E402

EXPECTED_BPM = {
    "reverb_120.wav": 120.0,
    "hat_storm_140.wav": 140.0,
    "sustained_100.wav": 100.0,
    "overlap_150.wav": 150.0,
    "slow_attack_90.wav": 90.0,
    "swing_120.wav": 120.0,
}


def _row(name: str, difficulty: str, report: dict) -> dict:
    q = report.get("quality", {})
    expected = EXPECTED_BPM.get(name)
    detected = report.get("bpm", 0.0)
    bpm_error = abs(detected - expected) / expected if expected and detected else None
    return {
        "sample": name,
        "difficulty": difficulty,
        "expectedBpm": expected,
        "detectedBpm": detected,
        "bpmRelativeError": round(bpm_error, 4) if bpm_error is not None else None,
        "bpmConfidence": report.get("bpmConfidence"),
        "rawOnsets": report.get("rawOnsetCount"),
        "events": report.get("musicalEventCount"),
        "notes": report.get("finalNoteCount"),
        "averageNps": q.get("averageNps"),
        "peakNps1s": q.get("peakNps1s"),
        "offGridRatio": q.get("offGridRatio"),
        "clusterSuppressed": q.get("clusterSuppressed"),
        "extremeJumpRatio": q.get("extremeJumpRatio"),
        "qualityScore": q.get("internalQualityScore"),
        "warnings": " | ".join(report.get("warnings", [])),
    }


def _sanity_failures(rows: list[dict]) -> list[str]:
    failures: list[str] = []
    by_sample: dict[str, list[dict]] = {}
    for row in rows:
        by_sample.setdefault(row["sample"], []).append(row)
        max_nps = DIFFICULTIES[row["difficulty"]].max_notes_per_second
        if (row["peakNps1s"] or 0) > max_nps:
            failures.append(f"{row['sample']} {row['difficulty']}: peak NPS exceeds config cap")
        if (row["extremeJumpRatio"] or 0) > 0.12:
            failures.append(f"{row['sample']} {row['difficulty']}: extreme jumps > 12%")
    for name, group in by_sample.items():
        counts = {r["difficulty"]: r["notes"] for r in group}
        if counts.get("easy", 0) > counts.get("expert", 0):
            failures.append(f"{name}: Easy has more notes than Expert")
    # Clean, fixed-tempo stress tracks should not be catastrophically misread.
    for row in rows:
        if row["difficulty"] != "hard" or row["expectedBpm"] is None:
            continue
        if row["bpmRelativeError"] is not None and row["bpmRelativeError"] > 0.12:
            failures.append(f"{row['sample']}: BPM error > 12% ({row['detectedBpm']} vs {row['expectedBpm']})")
    return failures


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="v0.3 합성 스트레스 벤치마크")
    p.add_argument("--out", default="stress-output")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    reports_dir = out / "reports"
    reports_dir.mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        paths = synth.write_stress(tmp)
        for name, path in sorted(paths.items()):
            for difficulty in DIFFICULTIES:
                result = generate_chart(path, difficulty, args.seed, title=f"Stress {name}")
                rows.append(_row(name, difficulty, result.report))
                (reports_dir / f"{Path(name).stem}.{difficulty}.json").write_text(
                    json.dumps(result.report, ensure_ascii=False, indent=2), encoding="utf-8"
                )

    failures = _sanity_failures(rows)
    summary = {"rows": rows, "failures": failures, "status": "PASS" if not failures else "FAIL"}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    with (out / "summary.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["sample"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"stress cases={len(rows)} status={summary['status']} -> {out}")
    for failure in failures:
        print(f"FAIL: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
