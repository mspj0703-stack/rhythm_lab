# v0.3.1 YouTube Input

- UI defaults to YouTube URL input; file upload remains available.
- Endpoint: `POST /api/analyze-youtube` JSON `{url,difficulty,seed}`.
- Accepted hosts: youtube.com variants and youtu.be.
- Single public video only; playlists disabled.
- Current deployment target limits: 8 minutes / 80 MB.
- Download is temporary and follows the same runtime TTL/session cleanup as uploads.
- Uses yt-dlp. Some videos may fail because of YouTube authentication, bot checks, region, age, or format restrictions.


## Railway bot-check hotfix
Set `YTDLP_POT_PROVIDER_URL=http://youtube-pot.railway.internal:4416` and run a compatible bgutil POT provider service. The backend automatically passes the provider to yt-dlp.
