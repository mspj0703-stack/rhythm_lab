# BEATDASH v4.8 Desktop Test Report

Baseline: GitHub `main` `9ed6ebc744f61a76f9a4f2968bee4694ac097322`, version `4.8.0-rc.1`.

## PASS
- Desktop source checks: 5/5.
- Low-cost Python source/deployment suite including Desktop checks: 16/16.
- `desktop/package.json`: JSON parse.
- `desktop/src-tauri/tauri.conf.json`: JSON parse.
- Desktop capability JSON: parse.
- generated Tauri version override: parse and reads `web/VERSION`.
- Windows Desktop workflow: YAML parse.
- Android endpoint source moved from `RhythmApi.kt` hardcode to shared `web/SERVICE_URL` via BuildConfig.

## ATTEMPTED / NOT VERIFIED
- Web Vitest: attempted, but this container did not have the Vitest executable available (`vitest: not found`).
- Web production build: not run after the failed dependency-based test gate; no PASS claimed.
- Cargo/Tauri metadata/compile: Cargo is unavailable in this container.

## WINDOWS CI REQUIRED
- Tauri compile on `windows-latest`.
- raw `.exe` existence.
- NSIS installer creation.
- app launch / Home / Library / Settings.
- D/F/J/K gameplay input.
- audio/video/SFX latency.
- Pause/Resume/Restart/Result.
- IndexedDB/localStorage persistence after app restart.
- long-song / seek / song switch regression.

Final state until Windows CI runs: **DESKTOP TEST BUILD — HOLD FOR WINDOWS VERIFICATION**.
