import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import synth  # noqa: E402


@pytest.fixture(scope="session")
def samples(tmp_path_factory):
    out = tmp_path_factory.mktemp("samples")
    return synth.write_all(str(out))


@pytest.fixture(scope="session")
def results_cache():
    return {}


@pytest.fixture(scope="session")
def gen(samples, results_cache):
    """(샘플이름, 난이도, seed) -> GenerationResult. 같은 조합은 캐시해 테스트 시간을 줄인다."""
    from chartgen.pipeline import generate_chart

    def _gen(name, difficulty="normal", seed=0):
        key = (name, difficulty, seed)
        if key not in results_cache:
            results_cache[key] = generate_chart(samples[name], difficulty, seed)
        return results_cache[key]

    return _gen

@pytest.fixture(scope="session")
def stress_samples(tmp_path_factory):
    out = tmp_path_factory.mktemp("stress-samples")
    return synth.write_stress(str(out))
