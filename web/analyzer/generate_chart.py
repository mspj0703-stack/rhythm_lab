#!/usr/bin/env python3
"""
사용법:
  python generate_chart.py song.wav --difficulty hard --output chart.json [--seed 42]
                           [--report report.json] [--dump-analysis analysis.json] [--title "..."]

종료 코드: 0 성공, 2 입력/옵션 오류
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chartgen.chart import format_report  # noqa: E402
from chartgen.config import DIFFICULTIES  # noqa: E402
from chartgen.errors import ChartGenError  # noqa: E402
from chartgen.pipeline import generate_chart  # noqa: E402


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="오디오 파일에서 4키 Tap 채보(JSON)를 자동 생성합니다.")
    p.add_argument("input", help="입력 오디오 파일 (wav/flac/ogg/mp3)")
    p.add_argument("--difficulty", "-d", default="normal", choices=list(DIFFICULTIES), type=str.lower)
    p.add_argument("--output", "-o", default=None, help="출력 chart JSON 경로 (기본: <입력이름>.<난이도>.json)")
    p.add_argument("--seed", type=int, default=0, help="레인 패턴 재현용 seed (기본 0)")
    p.add_argument("--title", default=None)
    p.add_argument("--platform", choices=["mobile", "desktop"], default="mobile")
    p.add_argument("--report", default=None, help="분석 리포트 JSON 저장 경로")
    p.add_argument("--dump-analysis", default=None, help="Audio Features + Musical Events 중간 결과 JSON 저장 경로")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = generate_chart(args.input, args.difficulty, args.seed, args.title, args.platform)
    except ChartGenError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    out = args.output or f"{os.path.splitext(args.input)[0]}.{args.difficulty}.json"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result.chart, f, ensure_ascii=False, indent=2)

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(result.report, f, ensure_ascii=False, indent=2)
    if args.dump_analysis:
        with open(args.dump_analysis, "w", encoding="utf-8") as f:
            json.dump({"features": result.features.to_summary(), "events": [e.to_dict() for e in result.events]},
                      f, ensure_ascii=False, indent=2)

    print(format_report(result.report))
    print(f"  -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
