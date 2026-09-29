#!/usr/bin/env python3
"""실제 곡 평가 harness.

manifest 예시:
[
  {"path": "/music/song1.mp3", "title": "Song 1", "expectedBpm": 174},
  {"path": "/music/song2.wav", "title": "Song 2"}
]

음원은 프로젝트/ZIP에 복사하지 않는다. 결과 JSON/CSV와 수동 평가 템플릿만 만든다.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chartgen.config import DIFFICULTIES  # noqa: E402
from chartgen.errors import ChartGenError  # noqa: E402
from chartgen.pipeline import generate_chart  # noqa: E402

MANUAL_FIELDS = ["Timing", "Musicality", "PatternNaturalness", "Density", "Repetition", "OverallFun"]


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="실제 곡 자동채보 평가 세트를 일괄 실행합니다.")
    p.add_argument("manifest", help="곡 목록 JSON")
    p.add_argument("--out", default="evaluation-output", help="결과 디렉터리")
    p.add_argument("--difficulty", choices=list(DIFFICULTIES), default="hard")
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    tracks = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    if not isinstance(tracks, list) or not tracks:
        print("ERROR: manifest는 1개 이상의 곡 객체 배열이어야 합니다.", file=sys.stderr)
        return 2

    out_dir = Path(args.out)
    charts_dir = out_dir / "charts"
    reports_dir = out_dir / "reports"
    charts_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    summary = []
    for idx, item in enumerate(tracks, start=1):
        path = item.get("path")
        title = item.get("title") or Path(path or "unknown").stem
        expected = item.get("expectedBpm")
        try:
            result = generate_chart(path, args.difficulty, args.seed, title)
        except (ChartGenError, TypeError) as exc:
            summary.append({"title": title, "path": path, "error": str(exc)})
            continue

        stem = f"{idx:02d}-{Path(path).stem}"
        (charts_dir / f"{stem}.json").write_text(json.dumps(result.chart, ensure_ascii=False, indent=2), encoding="utf-8")
        (reports_dir / f"{stem}.json").write_text(json.dumps(result.report, ensure_ascii=False, indent=2), encoding="utf-8")
        bpm_error = None
        if isinstance(expected, (int, float)) and expected > 0:
            bpm_error = abs(result.report["bpm"] - expected) / expected
        summary.append({
            "title": title,
            "path": path,
            "expectedBpm": expected,
            "detectedBpm": result.report["bpm"],
            "bpmRelativeError": round(bpm_error, 4) if bpm_error is not None else None,
            "bpmConfidence": result.report.get("bpmConfidence"),
            "finalNoteCount": result.report["finalNoteCount"],
            "averageNps": result.report.get("quality", {}).get("averageNps"),
            "peakNps1s": result.report.get("quality", {}).get("peakNps1s"),
            "gridAlignmentRatio": result.report.get("quality", {}).get("gridAlignmentRatio"),
            "offGridRatio": result.report.get("quality", {}).get("offGridRatio"),
            "phraseReuseRatio": result.report.get("quality", {}).get("phraseReuseRatio"),
            "internalQualityScore": result.report.get("quality", {}).get("internalQualityScore"),
        })

    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    with (out_dir / "summary.csv").open("w", encoding="utf-8", newline="") as f:
        fields = sorted({k for row in summary for k in row})
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(summary)

    with (out_dir / "manual-evaluation.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["title", "difficulty", *MANUAL_FIELDS, "notes"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in summary:
            if "error" not in row:
                writer.writerow(
                    {"title": row["title"], "difficulty": args.difficulty, **{x: "" for x in MANUAL_FIELDS}, "notes": ""}
                )

    failed = sum(1 for x in summary if "error" in x)
    print(f"evaluated={len(summary) - failed} failed={failed} -> {out_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
