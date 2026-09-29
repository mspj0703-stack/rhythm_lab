# v0.3-RC1 Validation

## Passed in this environment

- Python analyzer tests: **86 total**, run in chunks due execution-time limits.
  - `test_analysis.py`: 8/8 PASS
  - `test_generation.py`: 46/46 PASS
  - `test_v01_schema.py` + `test_v03_quality.py` + `test_v03_stress.py`: 32/32 PASS
- Synthetic stress benchmark: **28/28 chart cases PASS**
  - 7 stress audio types × 4 difficulties
- `python -m compileall analyzer`: PASS
- `colab_v03_validation.ipynb` JSON validation: PASS
- v0.1 chart-schema compatibility remains covered by Python tests.

## Bugs found and fixed during RC validation

1. Layered 150 BPM attacks could be interpreted as 75 BPM.
2. 120 BPM swing could be refined incorrectly toward 180 BPM.
3. Dense 128 BPM 16th-note material could regress toward ~86 BPM after accent weighting.

Tempo refinement now combines straight-grid evidence with strong-beat accent evidence, with a dedicated half/double-tempo rule.

## Environment-limited checks

- Frontend `npm ci` could not complete because this execution environment could not reach the package registry and its packaged `node_modules` copy was incomplete.
- Therefore npm/vitest/oxlint/TypeScript/build/browser-smoke were **not re-run in this RC environment**.
- v0.3-RC1 does not modify the frontend game logic; only regenerated chart fixtures/package metadata/docs differ on the frontend side.
- `ruff` could not be re-installed for the same no-network reason. Python source passed compile/import/runtime tests above.

## Still required for final v0.3

- At least 5 real songs of different styles.
- Human playtest scores for Timing, Musicality, Pattern Naturalness, Density, Repetition, Overall Fun.
- Same-song v0.2 vs v0.3 A/B report where a v0.2 baseline is available.
- Re-run npm + ruff validation in an environment with dependencies installed.
