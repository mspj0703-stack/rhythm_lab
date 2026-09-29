#!/usr/bin/env python3
"""Validate/aggregate the 1-5 human listening/playtest CSV produced by evaluate_real_songs.py."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from evaluate_real_songs import MANUAL_FIELDS


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="수동 채보 평가 CSV 집계")
    p.add_argument("csv_file")
    p.add_argument("--output", "-o", default="manual-evaluation-summary.json")
    args = p.parse_args(argv)

    rows = list(csv.DictReader(Path(args.csv_file).open(encoding="utf-8-sig")))
    scored: list[dict] = []
    errors: list[str] = []
    for i, row in enumerate(rows, start=2):
        values: dict[str, float] = {}
        if all(not (row.get(k) or "").strip() for k in MANUAL_FIELDS):
            continue
        for field in MANUAL_FIELDS:
            raw = (row.get(field) or "").strip()
            try:
                value = float(raw)
            except ValueError:
                errors.append(f"row {i} {field}: 숫자가 아님 ({raw!r})")
                continue
            if not 1.0 <= value <= 5.0:
                errors.append(f"row {i} {field}: 1~5 범위 밖 ({value})")
            values[field] = value
        if len(values) == len(MANUAL_FIELDS):
            scored.append({"title": row.get("title", ""), "difficulty": row.get("difficulty", ""), "scores": values})

    averages = {
        field: round(sum(x["scores"][field] for x in scored) / len(scored), 3) if scored else None
        for field in MANUAL_FIELDS
    }
    overall = round(sum(v for v in averages.values() if v is not None) / len(MANUAL_FIELDS), 3) if scored else None
    result = {"scoredTracks": len(scored), "fieldAverages": averages, "overallAverage": overall, "errors": errors}
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"scored={len(scored)} errors={len(errors)} overall={overall} -> {args.output}")
    for error in errors:
        print(f"ERROR: {error}")
    return 2 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
