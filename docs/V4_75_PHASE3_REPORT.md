# BEATDASH v4.75 Phase 3 implementation report

Baseline: `BEATDASH-v4.75-RC-phase1-source.zip` (Phase 2 intentionally not merged).

## 1. Implemented
- Persistent original-artwork pipeline: source thumbnail is fetched/decoded/resized and stored as image bytes instead of relying on a temporary URL.
- Artwork priority remains `customCover -> originalThumbnail -> legacy thumbnailUrl -> placeholder`.
- Android native cover bridge: native picker reads URI in Android, resizes to max 960px, JPEG-compresses, and returns persistent data to Web UI. Web fallback still supports JPG/PNG/WebP.
- Custom-cover restore deletes only `customCover`.
- IndexedDB schema v3 additive migration; no store reset/deletion.
- Tester feedback screen with category, text, app/build, platform, current screen and optional song context. No account/device identifier or files are collected. Minimum safe implementation copies structured JSON; no new external service.
- SFX polish: independent WebAudio voices for overlapping hits; separate Tap judgement, Flick, Hold-start and Hold-complete voices.
- Chart AI v2 conservative refinement module: protects beat/accent events and removes weak off-grid filler from dense runs after existing filtering. Existing pipeline, seed behavior, schema, QC and note-type planner remain intact.
- Phase 1 visual structure retained; feedback/support UI follows existing settings cards. Existing Flick arrow rendering retained because it is already materially distinct from Tap.

## 2. Existing causes
- Original thumbnail could remain a remote/session URL, so persistence depended on server/session/network lifetime.
- Android custom cover depended on WebView file chooser semantics; URI decoding/compression was done in web code.
- SFX used a single generic synthesized hit vocabulary; Hold start was effectively a normal judgement sound.
- Chart generation selected density-safe events but had no explicit final pass to reject weak filler between stronger nearby events.
- Feedback entry was only a placeholder.

## 3. Data / migration
`BEATDASH_DB` 2 -> 3. Migration is additive and backfills artwork metadata without clearing songs/charts/records/settings. Existing legacy `thumbnailUrl` is retained as fallback. Existing media blobs, records, offsets, titles and metadata are not reset.

## 4. Chart AI v2
New `chart_ai_v2.py` runs after established `select_events` and before lane assignment. It is deterministic and RNG-free. It protects beat-aligned/high-contrast/high-salience accents, then conservatively removes only weak off-grid/16th filler in locally dense runs. Difficulty-dependent thresholds keep Expert more expressive. Stats are nested in the existing filter report under `chartAiV2`; no chart schema change and no v5 planner/platform variant work.

## 5. Tests / build
- Backend pytest: 8/8 PASS.
- Analyzer normal regression excluding long-audio/stress suites: 84/84 PASS; 4 upstream/deprecation warnings.
- New Chart AI v2 focused tests: 2/2 PASS.
- Full analyzer invocation exceeded the execution window while running long/stress tests; those suites are therefore not claimed PASS here.
- Python compileall: PASS.
- `git diff --check`: PASS.
- Web Vitest/build/lint: NOT VERIFIED because `npm ci` could not complete in this environment; global `tsc` also lacks project `vite/client` and Node type packages. Do not infer PASS.
- Android Gradle build: NOT VERIFIED; this source bundle has no Gradle wrapper and system Gradle is unavailable.
- Physical Android: NOT VERIFIED. See `V4_75_PHASE3_ANDROID_CHECKLIST.md`.

## 6. Known limitations
- Existing v2 rows whose only artwork is a legacy remote `thumbnailUrl` are preserved, not destructively rewritten during IndexedDB upgrade (network I/O is intentionally not performed inside DB migration). New YouTube saves persist image bytes.
- Feedback is a privacy-safe local/copy workflow, not server submission.
- Native cover output is normalized to JPEG after Android decoding; PNG/WebP input is accepted but output format is intentionally normalized.

## 7. Phase 2 collision risk
High/medium collision candidates because Phase 2 is developing in parallel:
- `web/src/App.tsx` — navigation/state wiring.
- `web/src/components/GameScreen.tsx` — Phase 2 judgement/start-flow work; Phase 3 change is limited to SFX dispatch.
- `web/src/web/YouTubeEntry.tsx` — Phase 2 queue work is expected here; Phase 3 adds only original title/thumbnail metadata to completion payload. Reapply this one semantic change after Phase 2 queue merge.
- `web/src/components/v4/SettingsScreen.tsx` — Phase 3 feedback entry.
- `android/app/src/main/java/com/rhythmlab/companion/PlayActivity.kt` — Phase 2 background/native work may touch activity code; preserve Phase 3 `ArtworkBridge` and `coverPicker` during merge.

Lower collision risk: library artwork/db modules, FeedbackScreen, SFX module, Chart AI v2 module/tests, CSS additions.

## 8. Final merge notes
Merge Phase 2 and Phase 3 semantically, not by whole-file replacement. Keep Phase 2 version Single Source of Truth/deployment changes authoritative. In `YouTubeEntry`, retain Phase 2 queue behavior and carry preview `title/thumbnail` into each completed analysis item. In `GameScreen`, retain Phase 2 judgement/multitouch/start changes and only reapply Hold/Flick SFX routing. In `PlayActivity`, retain both Phase 2 background behavior and Phase 3 native artwork bridge. Then run the full combined Web/Analyzer/Backend/Android regression and physical-device checklist.
