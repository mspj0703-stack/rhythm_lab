"""Generate actual v5 charts for the shared Web engine compatibility suite."""
import json
from pathlib import Path

from chartgen.config import DIFFICULTIES
from chartgen.features import extract_features_from_signal
from chartgen.pipeline import generate_from_features
from synth import SR, make_bands


def main():
    output = Path(__file__).resolve().parents[1] / "src/__tests__/fixtures/v5"
    output.mkdir(parents=True, exist_ok=True)
    features = extract_features_from_signal(make_bands(), SR)
    for platform in ("mobile", "desktop"):
        for difficulty in DIFFICULTIES:
            chart = generate_from_features(features, difficulty, 42, "v5 compatibility", platform).chart
            (output / f"{platform}.{difficulty}.json").write_text(json.dumps(chart, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
