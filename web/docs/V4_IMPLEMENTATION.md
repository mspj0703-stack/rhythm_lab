> Historical implementation note. Current review: `../../docs/V4_REVIEW.md`. Device + song offset is additive; native Companion media stays in private app storage.

# BEATDASH::Revive v4.0 implementation

Status: implementation candidate built on the reviewed v3.0 web source.

## Included

- New Home / Library / Song Detail / Settings flow.
- IndexedDB database `BEATDASH_DB` with `songs`, `charts`, `playRecords`, and reserved `settings` stores.
- Analysis results are automatically added to the local Library. The current media is cached as a Blob when browser quota allows it.
- Per-song title editing while preserving `originalTitle`.
- Per-song Timing Offset.
- Multiple difficulty charts for the same song; missing difficulties can be generated from the cached media.
- Play records per chart: score, accuracy, max combo, judgement counts, played time, offset and clear type.
- Independent best score / accuracy / combo tracking.
- CLEAR / FULL COMBO / PERFECT COMBO status.
- FIRST FULL COMBO / FIRST PERFECT COMBO / NEW BEST result feedback.
- Result-screen FC/PC banners.
- v4 audio settings and synthesized Web Audio SFX for UI, judgements, START, FC and PC.
- Existing v3 judgement, highway, Hold/Flick, media lifecycle and pause/restart logic is retained.

## Clear rules

- FULL COMBO: `Miss === 0` (Great/Good allowed).
- PERFECT COMBO: every judged note is Perfect; `Great === 0`, `Good === 0`, `Miss === 0`.
- Display priority: PERFECT COMBO > FULL COMBO > CLEAR.

## Persistence notes

The existing v3 note speed and global timing offset keys stay unchanged for update compatibility. v4 Library data uses IndexedDB. Audio settings currently use the versioned local key `beatdash.audio.v4` while the IndexedDB `settings` store is reserved for a later migration.

Media Blob caching is best-effort. If a browser/WebView quota prevents caching a large media file, metadata/chart persistence can still be used while the original source URL remains valid; Android-native saved media remains the preferred long-term source for large files.

## Validation in this package

- TypeScript/TSX syntax parse: 45 source files, 0 syntax errors (TypeScript transpile check).
- Internal semantic type pass using local React/Vite shims: pass for non-test source files.
- v4 record-model runtime checks: pass.
- Backend pytest: 4/4 pass.
- Full `npm ci` / Vite / Vitest execution could not be completed in the current container because npm dependency installation stalled; rerun the normal project commands in CI before release.
- Android full compile is not performed here; use the included GitHub Actions workflow and existing signing secrets.
