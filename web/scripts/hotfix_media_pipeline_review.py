"""Hotfix sidecar title/thumbnail and retained video pipeline, using local fixtures."""
import functools
import http.server
import json
import subprocess
import tempfile
import threading
from pathlib import Path

import soundfile as sf
import yt_dlp


def run_review():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        video = root / "fixture.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=1:d=480",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=480",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(video),
        ], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", str(root / "thumbnail.png")], check=True)
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        opts = yt_dlp.parse_options([
            "--ignore-config", "--no-playlist", "--match-filter", "duration <= 480 & !is_live",
            "--max-filesize", "80M", "-f", "best[ext=mp4][height<=480][vcodec^=avc1][acodec^=mp4a]",
            "--keep-video", "-x", "--audio-format", "wav", "--postprocessor-args",
            "ExtractAudio+ffmpeg_o:-ac 1 -ar 22050 -c:a pcm_s16le", "--no-mtime", "--write-info-json", "--write-thumbnail", "--convert-thumbnails", "jpg",
            "-o", str(root / "output" / "source.%(ext)s"),
        ]).ydl_opts
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.process_ie_result({
                    "id": "fixture", "title": "원본 YouTube 제목 — Hotfix", "thumbnail": f"http://127.0.0.1:{server.server_port}/thumbnail.png", "extractor": "fixture", "duration": 480, "is_live": False,
                    "formats": [{"url": f"http://127.0.0.1:{server.server_port}/fixture.mp4", "format_id": "18",
                                 "ext": "mp4", "height": 180, "vcodec": "avc1", "acodec": "mp4a"}],
                }, download=True)
        finally:
            server.shutdown()
            server.server_close()
        metadata = json.loads((root / "output/source.info.json").read_text())
        assert metadata["title"] == "원본 YouTube 제목 — Hotfix"
        assert (root / "output/source.jpg").read_bytes().startswith(b"\xff\xd8\xff")
        kept = root / "output/source.mp4"
        audio = root / "output/source.wav"
        assert kept.read_bytes() == video.read_bytes(), "retained video must be the original"
        info = sf.info(audio)
        assert info.samplerate == 22050 and info.channels == 1 and info.subtype == "PCM_16"
        assert abs(info.duration - 480) < 0.05
        print(json.dumps({"result": "PASS", "source_duration_sec": 480, "wav_duration_sec": info.duration,
                          "retained_mp4_identical": True, "sample_rate": info.samplerate, "channels": info.channels,
                          "original_title_retained": True, "thumbnail_jpeg": True, "scope": "desktop yt-dlp/FFmpeg synthetic fixture; Android/YouTube not exercised"}))


if __name__ == "__main__":
    run_review()
