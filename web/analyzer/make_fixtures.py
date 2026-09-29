#!/usr/bin/env python3
"""
v0.1 게임 쪽 검증에 쓰는 픽스처를 만든다.

  src/__tests__/fixtures/generated/<sample>.<difficulty>.json   vitest(v0.1 loader) 검증용 채보
  public/generated/<sample>.<difficulty>.json                    브라우저 재생용 채보
  public/generated/<sample>.mp4                                  합성 오디오를 입힌 synthetic MV (ffmpeg 필요)

실행: python analyzer/make_fixtures.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import synth  # noqa: E402
from chartgen.pipeline import generate_chart  # noqa: E402

TEST_FIXTURE_DIR = os.path.join(ROOT, "src", "__tests__", "fixtures", "generated")
PUBLIC_DIR = os.path.join(ROOT, "public", "generated")
SEED = 42

# vitest용: 모든 합성음 x 모든 난이도
TEST_MATRIX = [(s, d) for s in ("kick_120", "fast_180", "accent", "bands") for d in ("easy", "normal", "hard", "expert")]
# 브라우저 재생용: 영상까지 만들 샘플과 난이도
BROWSER_MATRIX = [("accent", "expert"), ("fast_180", "hard")]


def make_mv(wav: str, out_mp4: str) -> None:
    if shutil.which("ffmpeg") is None:
        print("WARNING: ffmpeg 없음 - MV 생성을 건너뜁니다.")
        return
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
        "-i", wav,
        "-vf", "drawtext=text='%{pts\\:hms}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out_mp4,
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    os.makedirs(TEST_FIXTURE_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        samples = synth.write_all(tmp)
        for name, diff in TEST_MATRIX:
            chart = generate_chart(samples[f"{name}.wav"], diff, SEED, title=f"Synthetic {name}").chart
            with open(os.path.join(TEST_FIXTURE_DIR, f"{name}.{diff}.json"), "w", encoding="utf-8") as f:
                json.dump(chart, f, ensure_ascii=False, indent=1)
        for name, diff in BROWSER_MATRIX:
            result = generate_chart(samples[f"{name}.wav"], diff, SEED, title=f"Synthetic {name}")
            with open(os.path.join(PUBLIC_DIR, f"{name}.{diff}.json"), "w", encoding="utf-8") as f:
                json.dump(result.chart, f, ensure_ascii=False, indent=1)
            make_mv(samples[f"{name}.wav"], os.path.join(PUBLIC_DIR, f"{name}.mp4"))
            print(f"{name}.{diff}: {len(result.chart['notes'])} notes")
    print("fixtures written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
