# BEATDASH v4.75 Phase 2 + Phase 3 Integration Report

Status: **INTEGRATED RC CANDIDATE — CI / Android device verification still required**
Release version source: `web/VERSION` = `4.75.0-rc.phase3`
Build revision placeholder: `web/BUILD_REVISION` = `v4.75-rc-phase3-integrated` (Railway deploy workflow stamps the actual GitHub SHA at deploy time)

## 1. Inputs reviewed

- Phase 2 was based on v4.75 Phase 1 and contained gameplay feel, multi-link queue, Android foreground/background workflow, and release/deployment version single-source work.
- Phase 3 was independently based on v4.75 Phase 1 and contained artwork persistence/custom-cover repair, tester feedback, SFX polish, and conservative Chart AI v2 refinement.
- The two branches were merged through their common Phase 1 base; no full ZIP was blindly overlaid on the other branch.

## 2. Phase 3 review result

Accepted for integration with two limitations retained from the Phase 3 report:

- Phase 3's Python/backend focused validation was credible and reproducible in this integration environment.
- Phase 3 did not itself prove Web npm build/lint or Android APK/device behavior; those remain CI/device gates.

Phase 3's additive IndexedDB v2 -> v3 migration is preserved. It does not clear songs, charts, records, settings, titles, offsets, media, or legacy thumbnail fallback data.

## 3. Merge conflicts and resolution

The actual three-way merge produced conflicts only in:

- `web/src/App.css`
- `web/src/components/v4/SettingsScreen.tsx`

Resolution:

- Preserved Phase 2 countdown / Perfect Streak / enlarged Pause controls and Phase 3 feedback UI polish together.
- Preserved the Phase 3 `피드백 보내기` action while keeping Phase 2's release `VERSION` source for displayed Web version.

`GameScreen.tsx` and other overlapping files merged automatically through the common Phase 1 base. Phase 2 gameplay changes and Phase 3 SFX changes are both present.

## 4. Additional integration correction

Phase 3 still contained player-visible version text hardcoded as `v4.75 RC` / `Phase 1` in Home, Upload and Feedback context. This contradicted Phase 2's release-version Single Source of Truth requirement.

Integration changed these surfaces to read `web/VERSION` as raw build input:

- `HomeScreen.tsx`
- `UploadScreen.tsx`
- `FeedbackScreen.tsx`

Settings already used the same source after conflict resolution.

Therefore changing `web/VERSION` is sufficient for the Web release-version surfaces plus the backend/container/deployment/Android version plumbing implemented in Phase 2.

## 5. Preserved Phase 2 functionality

- Deterministic judgement tie-breaking and existing FAST/SLOW / Hold / Flick / Timing Offset behavior.
- Perfect Streak state and setting.
- PLAY/Retry -> preparation -> 3·2·1 -> automatic start without redundant START action.
- Enlarged Pause Continue/Restart controls.
- Multi-URL queue, persistent `ChartJobStore`, sequential `ChartJobService`, foreground notification, cancel/retry/recovery behavior.
- targetSdk 35 foreground-service timeout handling.
- `web/VERSION` release Single Source of Truth.
- Docker/Railway/GitHub Actions expected-version loading without release-number hardcoding.
- GitHub SHA revision verification and detailed deployment diagnostics.

## 6. Preserved Phase 3 functionality

- Persistent original thumbnail/artwork bytes and custom-cover fallback order.
- Android native custom-cover bridge with Web fallback.
- Additive IndexedDB v3 migration and legacy thumbnail fallback.
- Feedback screen and structured context copy flow.
- Overlapping WebAudio SFX voices for Tap/Flick/Hold start/Hold complete.
- Conservative deterministic `chart_ai_v2.py` refinement in the existing generator pipeline.

## 7. Validation executed after integration

PASS:

- Deployment/version/Android queue source regression: **11/11 PASS**.
- Backend pytest: **8/8 PASS**.
- Chart AI v2 focused tests: **2/2 PASS**.
- Full analyzer pytest after merge: **105/105 PASS**, 4 upstream/deprecation warnings.
- No unresolved Git conflict markers.
- `.github/workflows/build-android.yml` still uses `android-actions/setup-android@v4`.
- Release-like runtime hardcoding search: only `web/VERSION` remains for the current v4.75 Phase 3 release string; test fixtures intentionally contain old/different values for mismatch assertions.
- `git diff --check`: PASS.

Not verified in this environment:

- `npm ci` could not finish within the execution window, so final Vitest / Vite build / oxlint are **not claimed PASS** here.
- Signed Android APK/Gradle build is **not verified** here.
- Physical Android update-install, queue/background behavior, native artwork picker, actual SFX feel, and full-song playback are **not verified** here.
- Docker build and live Railway deployment are **not performed** here.

## 8. Version / deployment state

Current integrated release source:

`web/VERSION` -> `4.75.0-rc.phase3`

The Railway workflow reads this file at runtime. It does not compare `/api/health.version` against a literal release number. The workflow still stamps `web/BUILD_REVISION` with `$GITHUB_SHA` before deployment and checks deployed `/api/health.revision` against that SHA.

The integration keeps `android-actions/setup-android@v4`; the previous Hotfix overwrite regression that restored setup-android v3 is not reintroduced.

## 9. Remaining release gates

Before calling v4.75 COMPLETE:

1. GitHub CI: npm ci, Vitest, Vite/TypeScript build, lint, analyzer/ruff, backend, script tests.
2. Signed Android APK build.
3. Update-install over the existing app without uninstalling.
4. Confirm Library/Records/Settings/Offsets survive migration.
5. Test Phase 2 queue/background/notification/retry behavior on Android.
6. Test original thumbnail and custom cover persistence/restore on Android.
7. Test gameplay countdown, Pause UI, Perfect Streak and multi-touch.
8. Test SFX overlap and Tap/Flick/Hold distinction.
9. Play representative charts to sanity-check Chart AI v2.
10. Deploy Railway and verify health/version/revision convergence through the new diagnostics.

## 10. Recommended application method

If the repository already contains the finished Phase 2 branch, apply the generated **Phase2-to-integrated patch** rather than replacing the whole repository. The full source ZIP is a snapshot/reference artifact and should not be used to overwrite unrelated newer repository changes blindly.
