# BEATDASH::Revive v4.75 RC — Final Integration Report

Date: 2026-10-02
Status: **v4.75 RC — HOLD FOR DEVICE VERIFICATION**

## 1. Phase 2 completed functionality
Gameplay judgement/tie-breaking, FAST/SLOW/Hold/Flick preservation, Perfect Streak, START removal with 3·2·1 auto-start, enlarged Pause controls, persistent sequential multi-link Queue, Android foreground-service background work, cancel/retry/recovery, and Version/Deployment SSoT are present in the integrated RC.

## 2. Phase 3 review
Accepted and integrated from its Phase 1-based branch: persistent artwork, native Android custom-cover picker, additive IndexedDB v3 migration, tester feedback, overlapping gameplay SFX, and conservative deterministic Chart AI v2. Phase 3 was not reimplemented from the prompt.

## 3. Merge conflicts
Actual textual conflicts: `web/src/App.css`, `web/src/components/v4/SettingsScreen.tsx`.

## 4. Conflict resolution
Both branches were merged from the Phase 1 base. Phase 2 gameplay/queue/background/version behavior and Phase 3 artwork/feedback/SFX/Chart AI behavior were retained. `GameScreen.tsx`, YouTube metadata flow and Android activity/service overlaps were semantically reviewed. No unresolved conflict markers remain.

## 5. Version SSoT
Release identity source: `web/VERSION`.
Current value: `4.75.0-rc.phase3`.
Backend `/api/health`, Web version surfaces, Android `versionName`, container verification and Railway verification consume this source. Deployment revision remains separate and is stamped from GitHub SHA.

## 6. Single location for future version changes
Change only: `web/VERSION`.
Do not manually edit release literals in workflows, backend, Android or verification scripts.

## 7. Artwork final structure
Canonical priority: `customCover -> originalThumbnail -> legacy thumbnailUrl -> placeholder`. New source artwork is persisted as image data. Android native picker decodes URI input, resizes/compresses and returns persistent artwork data. Restore-original removes only `customCover`. IndexedDB v2→v3 migration is additive.

## 8. SFX structure
WebAudio supports overlapping voices and separate Tap judgement, Flick, Hold-start and Hold-complete feedback. Device feel/latency remains a real-device gate.

## 9. Chart AI v2
Adds a deterministic RNG-free refinement after event selection and before lane assignment. Strong beat/accent/salience events are protected while weak off-grid filler in dense runs is conservatively reduced. Existing schema, seed behavior, QC and saved-song compatibility remain.

## 10. Queue / Background
Android uses persistent `ChartJobStore` plus sequential `ChartJobService` foreground service. Jobs support waiting/running-stage/completed/failed/canceled/needs_retry states, duplicate protection, isolated temp work, notification progress/cancel and safe recovery. Interrupted server-side work is not blindly resent.

## 11. Data migration
No wipe. Existing Library, songs, charts, Records/PB, titles, artwork fallback, Note Speed, settings and timing offsets are preserved by additive migration design. Physical update-install verification is still required.

## 12. Automatic test result
PASS: scripts 11/11; backend 8/8; analyzer normal 84/84; stress 20/20; long-audio 1/1; Python compileall; Android XML parse; setup-android@v4/workflow hardcode scan; no conflict markers.
NOT VERIFIED: npm/Vitest/Vite/oxlint because dependency install timed out in this environment.

## 13. Android build result
Full Gradle/signed APK build is **NOT VERIFIED** in this environment. Source/config parser-level checks are not an APK build PASS.

## 14. Real-device unverified items
Update-install migration, Library/Records/settings preservation, native artwork picker/persistence, Queue background/screen-off/recovery, countdown/multitouch/Hold/Flick/Perfect Streak, SFX latency/overlap, long-song playback and video/chart sync.

## 15. Known issues / limitations
- Feedback is a safe structured local/copy workflow, not a remote submission backend.
- Legacy songs with only remote `thumbnailUrl` are retained as fallback rather than network-migrated during IndexedDB upgrade.
- Android FGS cannot guarantee indefinite execution after OS/process termination; unsafe in-flight stages recover as `needs_retry`.
- Web dependency-based test/build/lint and live Railway convergence still need CI/deployment execution.

## 16. Completion verdict
**v4.75 RC — HOLD FOR DEVICE VERIFICATION**.
Do not mark COMPLETE until GitHub CI web gates, signed APK build, update-install/device checklist and live Railway version+revision verification pass.
