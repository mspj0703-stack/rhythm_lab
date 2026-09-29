# BEATDASH::Revive — Android

Android companion for AI Rhythm Lab.

## Flow

1. Paste a public YouTube URL, or use **YouTube → Share → Rhythm Lab Companion**.
2. The app runs yt-dlp on the Android device and extracts temporary 22050 Hz mono WAV audio.
3. It uploads the audio to `https://web-production-e18dd.up.railway.app/api/analyze`.
4. The app saves the chart response and PCM WAV in its private song library, then deletes the temporary copy.
5. The app plays the existing web game in its own WebView, serving the saved chart and audio locally. The YouTube MV still requires a network connection.
6. Saved songs can be replayed after the server session expires. Long-press a song to delete its chart and WAV. Uninstalling the app also removes saved songs.

## Build without a PC

The repository's `build-android-companion4.yml` workflow builds a signed `app-release.apk` from a persistent signing key stored in GitHub Actions secrets. Set `COMPANION_KEYSTORE_BASE64` and `COMPANION_KEYSTORE_PASSWORD` before running it. Keep a backup of the keystore and password: losing them means future APKs cannot update installed copies. The workflow sets an increasing version code on each run. Existing APKs built with an ephemeral debug key require one uninstall before installing the first signed release; later signed releases install as updates.

## Dependencies

- `io.github.junkfood02.youtubedl-android:library:0.18.1`
- `io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1`
- OkHttp 4.12.0

## Current limits

- Public YouTube videos only.
- Region/age/DRM restrictions can still fail.
- Saved charts and audio take device storage (an eight-minute PCM WAV uses about 21 MB). The web game still loads from Railway, and its YouTube MV needs network access.
- YouTube can change extraction behavior; the app performs a best-effort NIGHTLY yt-dlp update during first use.
- This project is for development/testing. Respect content rights and service terms when using media.

## v4.0
- 표시 버전 4.0.0 / versionCode 400000 + GitHub Actions run number
- 앱 ID와 서명 구조는 v3와 동일하게 유지한다.
- v4의 Library/Records/UI/SFX는 WebView 웹 앱에서 제공하며 기존 WebView 저장소를 유지한다.
