#!/usr/bin/env python3
"""Compare two report directories by matching JSON filenames.

Useful for v0.2 -> v0.3 A/B regression checks. JSON is always emitted; --csv optionally
adds a flat table that is easy to inspect in Sheets/Excel.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def get(d: dict, path: str):
    cur = d
    for key in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("old")
    p.add_argument("new")
    p.add_argument("--output", "-o", default="comparison.json")
    p.add_argument("--csv", dest="csv_output")
    args = p.parse_args(argv)
    old_dir, new_dir = Path(args.old), Path(args.new)
    metrics = [
        "bpm", "finalNoteCount", "notesPerSecond", "peakNotesIn1s",
        "quality.gridAlignmentRatio", "quality.offGridRatio", "quality.extremeJumpRatio",
        "quality.sameLaneRepeatRatio", "quality.phraseReuseRatio", "quality.internalQualityScore",
    ]
    rows = []
    flat_rows = []
    for new_file in sorted(new_dir.glob("*.json")):
        old_file = old_dir / new_file.name
        if not old_file.exists():
            continue
        old = json.loads(old_file.read_text(encoding="utf-8"))
        new = json.loads(new_file.read_text(encoding="utf-8"))
        row = {"file": new_file.name}
        flat = {"file": new_file.name}
        for metric in metrics:
            ov, nv = get(old, metric), get(new, metric)
            row[metric] = {"old": ov, "new": nv}
            flat[f"{metric}.old"] = ov
            flat[f"{metric}.new"] = nv
            if isinstance(ov, (int, float)) and isinstance(nv, (int, float)):
                delta = round(nv - ov, 4)
                row[metric]["delta"] = delta
                flat[f"{metric}.delta"] = delta
        rows.append(row)
        flat_rows.append(flat)
    Path(args.output).write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.csv_output:
        fields = list(flat_rows[0]) if flat_rows else ["file"]
        with Path(args.csv_output).open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(flat_rows)
    print(f"compared {len(rows)} reports -> {args.output}" + (f", {args.csv_output}" if args.csv_output else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
