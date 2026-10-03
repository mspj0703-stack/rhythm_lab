# BEATDASH v4.8 Android device checklist

Build target: `4.8.0-rc.1`
Expected result before promotion: every required item below passes on the signed APK installed as an update over the existing app.

## A. Update/data protection
- [ ] Install the new APK over v4.75 without uninstalling.
- [ ] Existing Library songs remain.
- [ ] Existing charts and PB/records remain.
- [ ] displayTitle/originalTitle remain.
- [ ] originalThumbnail/customCover remain.
- [ ] Note Speed remains.
- [ ] Global and per-song Timing Offset remain.
- [ ] Settings remain.
- [ ] Queue state remains/restores correctly.

## B. Native home UI
- [ ] Phone portrait: cards, inputs and buttons are readable and not clipped.
- [ ] Tablet landscape: content remains centered and does not stretch excessively.
- [ ] Link -> URL check -> preview -> Queue add flow is visually obvious.
- [ ] Library and Settings shortcuts work.
- [ ] Difficulty/Pattern Seed controls work.
- [ ] Batch input works.
- [ ] Queue cards show status/message and correct play/retry/cancel action.

## C. START/countdown
- [ ] PLAY never exposes an extra START button.
- [ ] Media preparation happens before countdown.
- [ ] 3 -> 2 -> 1 -> playback starts automatically.
- [ ] No note clock/Miss occurs during prepare/countdown.
- [ ] Restart follows prepare -> countdown -> play.
- [ ] Initial playback error -> retry returns through prepare/countdown.
- [ ] Background app during countdown; wait >5s; no delayed auto-start occurs.
- [ ] Foreground app; a fresh countdown starts.
- [ ] Screen off/on during countdown behaves the same.

## D. Multi-touch/judgement
- [ ] Tap + Tap.
- [ ] Tap + Hold.
- [ ] Hold + Hold.
- [ ] Hold maintained while tapping another lane.
- [ ] Hold maintained while flicking another lane.
- [ ] FAST/SLOW labels still match timing direction.
- [ ] Great/Good/Miss reset Perfect Streak correctly.
- [ ] Hold release/regrab regression absent.
- [ ] Flick remains visually distinct.
- [ ] Note Speed changes visuals only, not judgement timing.

## E. Phase 3 access paths
- [ ] Original YouTube thumbnail remains after app restart.
- [ ] Custom Cover button opens Android native picker.
- [ ] JPEG/JPG, PNG and WebP input accepted.
- [ ] Large image is resized/compressed without crash.
- [ ] Custom Cover remains after app restart.
- [ ] Restore Original removes only custom cover and restores original thumbnail.
- [ ] Settings -> Feedback is reachable.
- [ ] Feedback shows category/text/version/build/platform/screen and optional song context.

## F. Queue/background regression
- [ ] Single URL add.
- [ ] Multiple URL add.
- [ ] Add another URL while one is processing.
- [ ] queued/running/completed/failed/canceled/needs_retry display correctly.
- [ ] retry.
- [ ] cancel.
- [ ] duplicate prevention.
- [ ] Activity recreation restores queue UI/state.
- [ ] Foreground service notification visible while processing.
- [ ] Background processing continues.
- [ ] Screen-off processing continues as designed.
- [ ] Completed job does not force-open gameplay.

## G. Version/deployment gate
- [ ] Deploy Web/Railway `4.8.0-rc.1` before distributing the APK.
- [ ] APK opens Web gameplay/library/settings when Web version matches.
- [ ] Deliberate Web/APK mismatch is blocked instead of displaying stale UI.
- [ ] `/api/health` reports expected version/revision after deployment.

## H. Chart AI v2 sanity playtest
Use at least three representative real songs: strong beat, dense fast onset, repeated phrase.
- [ ] Easy is sparse/playable.
- [ ] Normal meaningfully differs where source material permits.
- [ ] Hard is denser but controlled.
- [ ] Expert is demanding without impossible/unpleasant clusters.
- [ ] Important beats/onsets are represented.
- [ ] Weak off-grid filler is not excessive.
- [ ] Phrase repetition feels intentional rather than random.
- [ ] Hold/Flick placement feels natural.

If all required device/CI checks pass, change `web/VERSION` from `4.8.0-rc.1` to `4.8.0`, rebuild Web/backend/APK from the same source, and rerun the version/deployment gates.
