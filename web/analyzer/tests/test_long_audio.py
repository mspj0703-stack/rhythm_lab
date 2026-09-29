"""Long input exercises chunk boundaries and the complete chart pipeline."""
import math

import numpy as np

from chartgen.features import extract_features_from_signal
from chartgen.pipeline import generate_from_features


def test_eight_minute_audio_all_difficulties_and_seed():
    sr = 22050
    seconds = 480
    y = np.zeros(sr * seconds, dtype=np.float32)
    # Hits on both sides of the first 4096-frame spectral chunk boundary.
    for t in np.arange(1.0, seconds - 0.1, 0.5):
        pos = round(t * sr)
        y[pos:pos + 220] = np.linspace(0.6, 0, 220, dtype=np.float32)
    features = extract_features_from_signal(y, sr)
    assert any(abs(features.onset_times - 47.5) < 0.03)
    assert any(abs(features.onset_times - 48.0) < 0.03)
    for arr in (features.onset_env, features.rms, features.spectral_centroid,
                *features.band_onset.values(), *features.band_energy.values()):
        assert np.isfinite(arr).all()
    for difficulty in ("easy", "normal", "hard", "expert"):
        result = generate_from_features(features, difficulty, 42, "stress")
        assert result.chart["notes"]
        assert all(math.isfinite(note["time"]) for note in result.chart["notes"])
        assert generate_from_features(features, difficulty, 42, "stress").chart == result.chart
