# v0.4 Android Companion handoff

The web app now accepts:

`/?session=<analysis-id>&videoId=<youtube-video-id>`

The server exposes `GET /api/session/{id}` to reconstruct a previous analysis response from runtime files.

During gameplay the uploaded/extracted audio remains the authoritative timing clock. A muted YouTube IFrame is visual-only and is synchronized on START/pause/restart plus periodic drift correction. If the IFrame API fails, gameplay continues with audio and the generated chart.
