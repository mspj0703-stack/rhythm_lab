"""생성 JSON이 v0.1 TypeScript loader(validateChart)의 규칙을 만족하는지 파이썬 측에서도 검증."""
import pytest

from chartgen.config import DIFFICULTIES


def validate_like_v01(c: dict) -> bool:
    # src/engine/chartLoader.ts validateChart와 동일한 규칙
    if not isinstance(c.get("title"), str) or not isinstance(c.get("artist"), str):
        return False
    for k in ("bpm", "offset", "level"):
        if not isinstance(c.get(k), (int, float)) or isinstance(c.get(k), bool):
            return False
    if not isinstance(c.get("difficulty"), str) or not isinstance(c.get("notes"), list):
        return False
    for n in c["notes"]:
        if not isinstance(n.get("time"), (int, float)) or n.get("lane") not in (0, 1, 2, 3):
            return False
        if n.get("type") not in ("tap", "hold", "flick"):
            return False
        if n["type"] == "hold" and not isinstance(n.get("duration"), (int, float)):
            return False
    return True


@pytest.mark.parametrize("diff", list(DIFFICULTIES))
def test_14_python_side_schema(gen, diff):
    assert validate_like_v01(gen("fast_180.wav", diff).chart)
