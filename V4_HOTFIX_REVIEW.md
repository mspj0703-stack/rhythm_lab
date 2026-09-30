> 최초 구현 보고서입니다. 최신 독립 검수와 수정 결과는 [HOTFIX_INDEPENDENT_REVIEW.md](HOTFIX_INDEPENDENT_REVIEW.md)를 참조하세요.

# BEATDASH v4.0 RC Android Hotfix — implementation review

Date: 2026-09-30
Base: `BEATDASH-v4-github-clean-reviewed.zip`
Status: **HOTFIX CANDIDATE — Android device verification required; v4.0 is NOT yet COMPLETE.**

## Findings / root-cause analysis

### Playback interruption
The exact field failure cannot be reproduced in this container because Android WebView/device lifecycle is unavailable. Two concrete lifecycle weaknesses were found in the reviewed source:

1. Library Blob URLs were revoked both explicitly during song start and by React effect cleanup. URL ownership was therefore spread across navigation and playback code. The explicit revoke was removed; the active Library play session now owns cleanup on replacement/unmount.
2. Media `error` immediately paused gameplay, while WebView transient buffering had no recovery path. The player now distinguishes normal `ended` from failures, observes `stalled`/`waiting`, waits 3 seconds to avoid reacting to harmless buffering, and if the element still lacks future data reloads the same media and restores `currentTime`. A failed recovery pauses and shows an actionable error instead of pretending the song ended.

Normal media `ended` still drives the existing Result flow. Backgrounding still pauses intentionally and requires the existing resume action after return.

### Source title / thumbnail loss
The Android download pipeline only persisted chart/session/media. It did not persist the source YouTube title or source thumbnail. The web Library therefore fell back to chart title / filename and generated video-frame artwork.

Hotfix: yt-dlp writes `source.info.json` and a converted JPG thumbnail. Android persists immutable `originalTitle` plus `originalThumbnailUrl` in the saved analysis session and serves the cached thumbnail from `/api/thumbnail/<id>`. Web Library persists these separately from editable display title and custom cover.

## Data model / migration

IndexedDB `BEATDASH_DB` moves from schema version 1 to **2**. This is additive and does not delete stores or records.

Existing song rows are backfilled:
- `originalTitle` <- existing originalTitle, else display title, else original filename
- `originalThumbnail` <- existing originalThumbnail, else legacy thumbnailUrl

New fields:
- `originalThumbnail?: string`
- `customCover?: string`

Legacy `thumbnailUrl` remains readable for compatibility. Charts, play records, note speed, global/song Timing Offset, audio settings, and existing media blobs/endpoints are not reset.

## Artwork behavior

Display priority is exactly:
1. `customCover`
2. `originalThumbnail`
3. legacy `thumbnailUrl`
4. placeholder

Song Detail accepts JPG/JPEG, PNG and WebP. Before persistence it is resized to max 960 px edge and encoded as JPEG quality 0.86 to limit IndexedDB growth. “원본 썸네일로 되돌리기” removes only `customCover`.

## Source-title behavior

`originalTitle` is immutable once a Library song has a non-empty value. Renaming only changes display `title`. Reanalysis/difficulty generation/chart regeneration preserve the existing original title and original artwork.

## SFX assessment

No large audio redesign was included. Current Web Audio synthesized hit sounds are functional but are too synthetic/thin for the requested crisp commercial-rhythm-game feel. Follow-up `Gameplay Audio Polish` should separately tune:
- Tap: shorter transient + layered click/body
- Hold start/tick/end: distinct but quieter hierarchy
- Flick: brighter directional transient
- judgement-dependent gain/brightness without masking the song
- master/music/SFX balance and Bluetooth/device checks

No copyrighted sound from another game should be copied.

## Changed files

- `android/.../MainActivity.kt`
- `android/.../PlayActivity.kt`
- `android/.../SavedSongStore.kt`
- `android/.../YoutubeEngine.kt`
- `web/src/App.tsx`, `App.css`
- `web/src/components/GameScreen.tsx`
- `web/src/components/v4/{HomeScreen,LibraryScreen,SongDetailScreen}.tsx`
- `web/src/library/{db,types,cover}.ts`
- `web/src/web/types.ts`
- `web/src/__tests__/libraryDb.test.ts`

## New/expanded tests

Library DB tests now specify:
- source title survives rename, reload and changed-chart regeneration
- source thumbnail survives persistence/regeneration
- custom cover survives reload, does not destroy source thumbnail, and restore removes only custom cover
- DB helper version updated for schema v2

Existing media lifecycle tests remain the regression basis for gesture start, pause/resume, restart, audio/video clock, background pause, offset, Flick and asynchronous result persistence. Frontend tests could not be executed in this environment because `node_modules` is not in the reviewed ZIP and `npm ci` exceeded the execution timeout.

## Verification executed here

- Backend pytest: **4/4 PASS**
- Analyzer pytest: **103/103 PASS** (4 pre-existing library/deprecation warnings)
- Android ByteRange Java regression: **14/14 PASS**
- Python source compile check: **PASS**
- Frontend Vitest: **UNVERIFIED in this run** — dependencies unavailable; `npm ci` timed out
- TypeScript/Vite build: **UNVERIFIED in this run** for same reason
- Frontend lint/browser E2E: **UNVERIFIED in this run** for same reason
- Android APK/Kotlin compile: **UNVERIFIED in this container** — Android SDK/Gradle wrapper unavailable
- Android physical-device test: **UNVERIFIED**

## Required Android device checklist

1. Install the signed hotfix APK **over** the existing BEATDASH app; do not uninstall.
2. Confirm existing saved songs, charts, play records and edited display titles remain.
3. Confirm note speed, Global Offset, Song Offset, audio/settings remain.
4. Open an old Library song and play it from start to finish.
5. Play the same song again, then play at least two different saved songs consecutively.
6. Seek near beginning/middle/end and confirm video/audio/chart remain synchronized.
7. Pause/resume/restart repeatedly.
8. During play, background the app briefly and return; verify intentional pause and successful resume with no stale/duplicate media.
9. Test a long song and a large MP4; watch for stalled/waiting recovery and any spontaneous stop.
10. Import a new YouTube song; verify actual source video title becomes immutable `originalTitle` after app restart and Library re-entry.
11. Verify original YouTube thumbnail remains after restart, chart regeneration and adding another difficulty.
12. Rename display title; verify original title is unchanged.
13. Choose JPG, PNG and WebP custom covers; restart app and verify cover remains in Home/Library/Song Detail.
14. Use “원본 썸네일로 되돌리기”; verify only custom cover disappears.
15. Verify Tap/Hold/Flick, multitouch and ±35/75/120ms judgement behavior are unchanged.
16. Repeat with Bluetooth audio if used; note SFX balance separately from chart timing.

## Known limitations

- The original field playback interruption is not claimed fixed until the physical-device checklist passes. The hotfix addresses concrete media-lifecycle weaknesses found in source, but the exact device-specific trigger remains unverified here.
- Existing songs that never stored a real YouTube title/thumbnail cannot reconstruct missing source metadata offline. They safely keep legacy title/artwork fallback; newly imported songs preserve source metadata.
- Custom covers are stored in IndexedDB as compressed data URLs. Very large libraries can still consume browser/WebView storage; cloud backup/export is outside v4 scope.
- SFX quality is deferred to Gameplay Audio Polish.
- v5 Mobile/PC chart variants and Hold Tick are intentionally not implemented.

## Completion verdict

**v4.0 COMPLETE: NO.**

Current verdict: **v4.0 RC HOTFIX CANDIDATE / HOLD FOR DEVICE VERIFICATION**.

It may be promoted to v4.0 COMPLETE only after frontend CI/build and signed APK succeed and the physical-device playback/metadata/artwork/update checklist passes without the spontaneous-stop regression.
