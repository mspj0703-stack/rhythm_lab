# AI Rhythm Lab — Integrated Source Build

Built: 2026-09-27
Repository: mspj0703-stack/rhythm_lab
GitHub main observed at packaging time: 6143723f10c50ca6358eaa8a24dabd3102d8924a

## Effective merge order
1. rhythm-core-v0.3.1-youtube-input.zip
2. rhythm-analyzer-memory-fix-files.zip
3. chart-generation-update-v1-rebased-files.zip
4. difficulty-level-update-v1-rebased-files.zip
5. gameplay-ux-update-v1-rebased-files.zip

This directory is the overlays already merged into one working source tree for coding/review convenience.
Do not re-apply the above overlays on top of this integrated tree unless intentionally rebuilding it.

## Verified features present
- saved-song `saved=1` web flow
- Android/mobile upward-swipe Flick input handling in GameScreen
- analyzer memory-fix implementation and stage logging
- Hold/Flick Note Type Planner (`note_types.py`)
- dynamic Lv.1~30 estimator (`level_estimator.py`)
- Gameplay UX v1 note-speed controls/HUD/result updates

## Verification performed while packaging
- Analyzer test suite: 101/101 PASS
- Backend tests: 4/4 PASS
- Required merged files present:
  - analyzer/chartgen/features.py
  - analyzer/chartgen/note_types.py
  - analyzer/chartgen/level_estimator.py
  - analyzer/tests/test_note_types.py
  - analyzer/tests/test_level_estimator.py
  - src/settings/noteSpeed.ts
  - src/web/NoteSpeedControl.tsx

## Packaging note
This is a merged development/handoff source archive, not a byte-for-byte mirror of the repository's nested ZIP artifacts. It was reconstructed from the retained core source archive plus the currently selected/rebased overlays and then regression-tested as above.
