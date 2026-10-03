# BEATDASH::Revive v4.8 test report

Status: **v4.8 RC — HOLD FOR DEVICE VERIFICATION**

## AUTO PASS

- `python -m pytest -q scripts/tests` — **20/20 PASS**
  - Queue/background source regression
  - deployment/version verifier regression
  - Android v4.8 source/access-path checks
  - START/countdown source contract checks
  - version Single Source of Truth checks
- `python -m pytest -q web/backend/test_app.py` — **8/8 PASS**
- `python -m pytest -q web/analyzer/tests` — **109/109 PASS**, 4 upstream/deprecation warnings
- Python `compileall` for backend/analyzer/scripts — **PASS**
- Android `ByteRangeTest` — **14/14 PASS**
- TS/TSX syntax transpile using available global TypeScript — **59 files / 0 syntax errors**
- Android Manifest/resource XML parse — **12 files / 0 XML errors**
- Kotlin compiler parser-level scan — **0 syntax/parser markers**; full Android references are unresolved without Android SDK/classpath, so this is not an Android compile PASS.
- Standalone compiled game-state audit:
  - Tap + Tap — PASS
  - Tap + Hold + Hold — PASS
  - Hold-held + Tap + Flick — PASS
  - Hold + Hold completion — PASS
  - FAST/Great negative-diff sign — PASS
  - SLOW/Great positive-diff sign — PASS
  - Perfect Streak reset/restart — PASS
  - Miss resets Combo/Perfect Streak — PASS
- `git diff --check` — PASS
- MainActivity `R.id` references vs `activity_main.xml` — **21/21 matched, 0 missing**
- No unresolved Git conflict markers found.
- No `requireStartGesture` runtime contract remains.
- No destructive DB operation was introduced in the v4.8 diff.

## AUTO FAIL

None among tests that were actually executable.

## NOT VERIFIED — environment limitation

- Web Vitest: local dependency tree is incomplete (`vitest` binary unavailable).
- Web `tsc -b` / Vite production build / oxlint: `npm ci` could not complete in the execution environment; therefore **not claimed PASS**.
- Python Ruff: `ruff` is not installed in this execution environment.
- Android Gradle release build: system Gradle/Android SDK classpath is unavailable here.
- Signed APK verification: requires GitHub Actions or a configured Android build environment.
- Docker image build: Docker executable is unavailable here.
- Live Railway deployment/version convergence: not performed here.

These items must not be interpreted as failures; they are explicitly unverified.

## DEVICE VERIFICATION REQUIRED

- Update-install over existing v4.75 without uninstalling.
- Native Android home layout on phone portrait and tablet landscape.
- PLAY -> prepare -> 3 -> 2 -> 1 -> automatic playback with no START button.
- Restart/Retry follows the same startup path.
- Background/foreground during countdown never starts from an old delayed callback.
- No judgement/Miss before media actually starts.
- Tap+Tap, Tap+Hold, Hold+Hold, Hold+Tap, Hold+Flick multi-touch combinations.
- FAST/SLOW and Perfect Streak visual behavior.
- Custom Cover native picker: JPEG/JPG/PNG/WebP, persistence after restart, Restore Original.
- Feedback path: Android Settings -> Web Settings -> Feedback.
- Original thumbnail remains intact.
- Queue/background/notification/retry/cancel/recreation regression.
- Representative real-song Chart AI v2 playtest on Easy/Normal/Hard/Expert.
- SFX regression only; no major v4.8 SFX redesign expected.

## Release decision
Because Android build/device gates remain, status is **v4.8 RC — HOLD FOR DEVICE VERIFICATION**.
