# BEATDASH v4.0 RC Hotfix 2 — DEVICE QUICK FIX

Status: UNREVIEWED / DEVICE TEST FIRST

Changes:
- Android custom-cover picker: accept valid content/file picker URIs and explicitly request image MIME types.
- Custom-cover processing: FileReader + HTMLImageElement + canvas for Android WebView compatibility instead of depending on createImageBitmap.
- Original YouTube thumbnail: accept yt-dlp converted JPG/JPEG thumbnails even when the filename is not exactly source.jpg.
- SFX untouched.
- Playback recovery untouched.

Device checks:
1. Update-install over the existing app; do not uninstall.
2. Change cover with JPG/PNG/WebP.
3. Confirm cover in Song Detail and Library.
4. Restart and confirm persistence.
5. Restore original thumbnail.
6. Add a new YouTube song and confirm its original thumbnail.
7. Restart and confirm thumbnail persistence.

Do not mark v4 COMPLETE from this unreviewed package alone.
