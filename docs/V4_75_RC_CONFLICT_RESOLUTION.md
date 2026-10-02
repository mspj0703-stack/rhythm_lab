# BEATDASH v4.75 RC — Phase 2/3 Conflict Resolution

Base: v4.75 Phase 1

## Actual merge conflicts
- `web/src/App.css`: Phase 2 countdown/Perfect Streak/Pause sizing and Phase 3 feedback/polish styles retained together.
- `web/src/components/v4/SettingsScreen.tsx`: Phase 2 gameplay/settings/version SSoT and Phase 3 feedback entry retained together.

## Semantic overlaps reviewed
- `GameScreen.tsx`: Phase 2 judgement/countdown/multitouch retained; Phase 3 SFX dispatch layered on top.
- `YouTubeEntry.tsx`: queue-compatible flow retained; preview title/thumbnail metadata propagated for persistent artwork.
- Android activity/service code: Phase 2 queue/background behavior retained; Phase 3 native ArtworkBridge retained.
- Workflows: `android-actions/setup-android@v4` retained; no release-version literal comparison restored.

No unresolved Git conflict markers remain.
