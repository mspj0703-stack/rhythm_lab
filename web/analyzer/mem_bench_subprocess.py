#!/usr/bin/env python3
"""
각 (곡 길이, 밀도) 조합을 별도 서브프로세스에서 실행하고, 그 프로세스 자신의
/proc/<pid>/status에서 VmHWM(peak resident set size, 커널이 기록하는 진짜 최고
수위)을 읽는다. 부모 프로세스의 누적 ru_maxrss에 다른 측정이 섞이지 않도록
철저히 격리한다 (요청하신 subprocess별 측정 방식).
"""
from __future__ import annotations

import json
import subprocess
import sys

WORKER = """
import sys, time, resource
sys.path.insert(0, {analyzer_dir!r})

def vmhwm_kb():
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmHWM:"):
                return int(line.split()[1])
    return None

from chartgen.pipeline import generate_chart
t0 = time.time()
result = generate_chart({audio_path!r}, {difficulty!r}, {seed!r}, {title!r})
elapsed = time.time() - t0
print("RESULT_JSON:" + __import__("json").dumps({{
    "vmhwm_kb": vmhwm_kb(),
    "ru_maxrss_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    "elapsed_sec": round(elapsed, 2),
    "note_count": len(result.chart["notes"]),
    "bpm": result.chart["bpm"],
}}))
"""


def run_one(analyzer_dir: str, audio_path: str, difficulty: str, seed: int, title: str) -> dict:
    code = WORKER.format(analyzer_dir=analyzer_dir, audio_path=audio_path, difficulty=difficulty, seed=seed, title=title)
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        return {"error": proc.stderr[-2000:]}
    line = next((line for line in proc.stdout.splitlines() if line.startswith("RESULT_JSON:")), None)
    if not line:
        return {"error": "no RESULT_JSON in output: " + proc.stdout[-1000:] + proc.stderr[-1000:]}
    return json.loads(line[len("RESULT_JSON:") :])


def main() -> int:
    analyzer_dir = "."
    cases = [
        ("samples_long/song6min.wav", "expert", "6min dense"),
        ("samples_long/song8min_dense.wav", "expert", "8min dense (target)"),
        ("samples_long/song10min_dense.wav", "expert", "10min dense (max duration)"),
    ]
    print(f"{'case':45s} {'VmHWM(MB)':>12s} {'ru_maxrss(MB)':>15s} {'time(s)':>8s} {'notes':>7s} {'bpm':>8s}")
    all_ok = True
    for path, diff, label in cases:
        r = run_one(analyzer_dir, path, diff, 42, label)
        if "error" in r:
            print(f"{label:45s} ERROR: {r['error']}")
            all_ok = False
            continue
        vm_mb = r["vmhwm_kb"] / 1024
        rss_mb = r["ru_maxrss_kb"] / 1024
        target_ok = "OK" if vm_mb <= 700 else "OVER"
        line_out = (
            f"{label:45s} {vm_mb:12.1f} {rss_mb:15.1f} "
            f"{r['elapsed_sec']:8.1f} {r['note_count']:7d} {r['bpm']:8.1f}  [{target_ok}]"
        )
        print(line_out)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
