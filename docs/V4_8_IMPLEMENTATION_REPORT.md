# BEATDASH::Revive v4.8 implementation report

Status: **v4.8 RC — HOLD FOR DEVICE VERIFICATION**

Version source: `web/VERSION = 4.8.0-rc.1`
Baseline used in this work: archived `BEATDASH-v4.75-RC-integrated-phase3-source.zip` (Phase 2 + Phase 3 integrated snapshot).

> GitHub main was intentionally not accessed. The user will apply the patch manually. Because GitHub main can contain later manual changes, run `git apply --check` before applying the patch.

## 1. Implemented

### Android home UI redesign
- Reworked the native `MainActivity` home into a card-based hierarchy while keeping the existing queue engine and persistence intact.
- Added a centered responsive content container with a ~700dp maximum width for large tablets.
- Separated link preview, quick navigation, chart options, batch add, queue, and saved songs into visually distinct sections.
- Added custom purple/dark card, input, primary, secondary and ghost drawable resources plus spinner rows.
- Queue entries now render as individual cards with title, difficulty/seed, status badge, message and context-appropriate play/retry/cancel actions.
- Queue processing/storage/service code was not rewritten.

### START / countdown execution-path repair
The v4.75 integrated source did not contain a visible gameplay `START` button, but Android `PlayActivity` loaded the production Railway Web UI without enforcing that its release matched the installed APK. A stale/deferred Web deployment could therefore show an older gameplay UI even with a newer APK.

v4.8 fixes both sides of that failure mode:
- Removed the obsolete `requireStartGesture` prop/contract from `GameScreen` and its callers.
- Added explicit startup phases: `preparing -> countdown -> playing`.
- Countdown does not begin until media reports it is prepared.
- The judgement/game loop stays disabled until actual media playback starts.
- Background/visibility/pause invalidates the pending countdown generation and blocks delayed callbacks.
- Explicit foreground/resume restarts from the preparation gate rather than letting an old callback auto-start.
- Restart/Retry returns to the same preparation/countdown path.
- Initial media-play errors no longer silently re-enter countdown or bypass it on retry.
- Android dispatches explicit `beatdash:pause` / `beatdash:resume` lifecycle events.

### Android/Web stale-version gate
- `web/src/main.tsx` exposes `window.__BEATDASH_VERSION__` from the existing `web/VERSION` single source.
- `PlayActivity` reads the installed APK `versionName`, loads the remote Web UI with no-cache behavior and keeps the WebView hidden until the Web release reports the same version.
- On first mismatch it clears WebView cache and retries once with a build cache-buster.
- On persistent mismatch it refuses to expose the stale gameplay UI and shows an update/deployment error instead.
- This specifically prevents an old production Web bundle from reintroducing removed UI such as the reported START screen.

### Judgement / multi-input verification support
- Added regression coverage for Tap+Tap, Tap+Hold, Hold+Hold, Hold-held + Tap and Hold-held + Flick behavior.
- Added Perfect Streak reset assertions.
- Existing FAST/SLOW sign behavior, timing offset path and visual-only note speed contract remain unchanged.
- No v5 input/chart-variant changes were introduced.

### Phase 3 access-path checks
- Feedback remains reachable from Settings through the actual `App` navigation path.
- Native artwork picker remains connected through `BeatdashArtwork`.
- Added native-cover error propagation back to Song Detail so invalid/failed native images do not fail silently.
- Accepted native image MIME types remain JPEG/JPG, PNG and WebP; Android decodes, bounds input, resizes and normalizes persistent output to JPEG.
- Original thumbnail/custom-cover DB schema and fallback priority are unchanged; no destructive migration was introduced.

### Chart AI v2 verification
- Confirmed `chart_ai_v2.refine_selected_events` is called by the real analyzer pipeline after established event selection.
- Added representative synthetic fixtures for strong beats, dense/fast onsets and repeating beats across Easy/Normal/Hard/Expert.
- Confirmed deterministic seed behavior and unchanged chart schema.
- No v5 Chart Planner/Phrase Planner/EXTREME/platform-variant work was introduced.

### Version / CI
- Release version moved to `4.8.0-rc.1` only through `web/VERSION`.
- Android Gradle still consumes `../web/VERSION` for `versionName`.
- Android build workflow now triggers when `web/VERSION` changes and verifies the built APK `versionName` exactly matches `web/VERSION`.
- Railway/version/revision verification structure remains intact.

## 2. Existing behavior intentionally preserved
- Library, songs, charts and records.
- `originalTitle` / `displayTitle`.
- `originalThumbnail` / `customCover` and artwork priority.
- Note Speed, Global Timing Offset and Song Timing Offset.
- Settings.
- Persistent Queue data and the existing `ChartJobStore` / `ChartJobService` processing model.
- Single/multiple URL queueing, retry/cancel, per-job temp isolation, serial heavy processing, notification/background work.
- Existing SFX implementation; no large SFX redesign was done in v4.8.

## 3. DB / migration
No new DB migration is required for v4.8. Existing v4.75 additive IndexedDB v3 data is reused. No database reset, destructive migration, uninstall/reinstall path, or Library clearing was added.

## 4. Chart AI fixture observations
The v4.8 audit fixtures all generated valid QC-passing charts with deterministic output. Difficulty density was monotonic on the strong-beat fixture. Some synthetic sources contain too little musical variety to distinguish every difficulty (for example the repeated kick fixture can saturate at the same event count), so these fixtures are regression tests rather than proof of real-song musical quality.

Real-song listening/play quality still requires device/manual sampling before release.

## 5. Completion state
Automated/source verification is strong enough for an RC, but the release gate explicitly requires a signed Android build plus physical-device checks. Therefore this build is **not** marked v4.8 COMPLETE.

Final status: **v4.8 RC — HOLD FOR DEVICE VERIFICATION**.

## 6. Known limitations
- This patch is based on the archived v4.75 integrated snapshot, not a live read of GitHub main. Any later manual main changes must be preserved during manual application.
- Web Vitest/Vite/typecheck/lint and Android Gradle/signed APK could not be executed in this environment because dependencies/SDK tooling are incomplete.
- The Android/Web version gate intentionally blocks an APK when production Web has not yet been deployed to the same `web/VERSION`; deploy Web first.
- Chart AI v2 passed analyzer/QC fixtures, but real-song musical feel is still a manual/device gate.
- SFX was only regression-protected; the requested larger SFX redesign remains deferred.

## 7. Next step
1. Apply `BEATDASH-v4.75-to-v4.8.0-rc.1.patch` to the current main with `git apply --check` first, resolving any later-main overlap semantically instead of overwriting files.
2. Push `4.8.0-rc.1` and let CI run Web tests/build/lint plus signed Android build.
3. Deploy Railway/Web `4.8.0-rc.1` before installing/testing the matching APK so the stale-Web gate can pass.
4. Update-install the signed APK and execute `V4_8_ANDROID_DEVICE_CHECKLIST.md`.
5. If every gate passes, change only `web/VERSION` to `4.8.0`, rebuild/deploy all release surfaces, and perform the final smoke check.
