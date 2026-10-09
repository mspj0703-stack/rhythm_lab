from __future__ import annotations

import io
import sys
from pathlib import Path

import soundfile as sf
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analyzer"))

from app import app
from synth import SR, make_kick_120

client = TestClient(app)


def wav_bytes() -> bytes:
    buf = io.BytesIO()
    sf.write(buf, make_kick_120(duration=4.0), SR, format="WAV")
    return buf.getvalue()


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_analyze_and_fetch_media():
    r = client.post(
        "/api/analyze",
        files={"file": ("kick.wav", wav_bytes(), "audio/wav")},
        data={"difficulty": "hard", "seed": "42"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["chart"]["notes"]
    assert data["chart"]["difficulty"] == "Hard"
    assert data["report"]["finalNoteCount"] == len(data["chart"]["notes"])
    media = client.get(data["mediaUrl"])
    assert media.status_code == 200 and len(media.content) > 1000

    session = client.get(f"/api/session/{data['id']}")
    assert session.status_code == 200, session.text
    restored = session.json()
    assert restored["id"] == data["id"]
    assert restored["chart"] == data["chart"]
    assert restored["report"] == data["report"]


def test_reject_bad_extension():
    r = client.post(
        "/api/analyze",
        files={"file": ("nope.txt", b"hello", "text/plain")},
        data={"difficulty": "hard", "seed": "0"},
    )
    assert r.status_code == 400


def test_reject_bad_difficulty():
    r = client.post(
        "/api/analyze",
        files={"file": ("kick.wav", wav_bytes(), "audio/wav")},
        data={"difficulty": "impossible", "seed": "0"},
    )
    assert r.status_code == 400


def test_v5_desktop_extreme_upload_and_restore():
    response = client.post("/api/analyze", files={"file": ("v5.wav", wav_bytes(), "audio/wav")},
                           data={"difficulty": "extreme", "platform": "desktop", "seed": "42"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["chart"]["platformProfile"] == "desktop"
    assert data["chart"]["scoringVersion"] == 2 and data["chart"]["difficulty"] == "Extreme"
    assert all(note["type"] != "flick" for note in data["chart"]["notes"])
    assert client.get(f"/api/session/{data['id']}").json()["chart"] == data["chart"]
    assert client.delete(f"/api/session/{data['id']}").status_code == 200


def test_v5_bad_platform_is_rejected_before_io(monkeypatch):
    import app as module
    monkeypatch.setattr(module, "_download_youtube", lambda *args: (_ for _ in ()).throw(AssertionError("must not download")))
    assert client.post("/api/analyze", files={"file": ("v5.wav", b"", "audio/wav")},
                       data={"platform": "invalid"}).status_code == 400
    assert client.post("/api/analyze-youtube", json={"url": "https://youtu.be/abcdefghijk", "platform": "invalid"}).status_code == 400


def test_youtube_preview_metadata_only(monkeypatch):
    import app as module
    import json
    from types import SimpleNamespace
    def run(cmd, **kwargs):
        assert '--skip-download' in cmd
        assert '--dump-single-json' in cmd
        assert kwargs['timeout'] == 45
        return SimpleNamespace(stdout=json.dumps({'title': 'Original', 'duration': 125, 'channel': 'Artist', 'thumbnail': 'https://i.ytimg.com/vi/id/hqdefault.jpg'}))
    monkeypatch.setattr(module.subprocess, 'run', run)
    r = client.post('/api/youtube-preview', json={'url': 'https://youtu.be/abcdefghijk'})
    assert r.status_code == 200
    assert r.json()['title'] == 'Original' and r.json()['duration'] == 125
    assert r.json()['channel'] == 'Artist'


def test_youtube_preview_hides_raw_exceptions(monkeypatch):
    import app as module
    def fail(url):
        raise RuntimeError('SECRET exception path /server/private')
    monkeypatch.setattr(module, '_youtube_preview', fail)
    r = client.post('/api/youtube-preview', json={'url': 'https://youtu.be/abcdefghijk'})
    assert r.status_code == 422
    assert 'SECRET' not in r.text and '/server' not in r.text


def test_youtube_preview_rejects_invalid_destinations(monkeypatch):
    import app as module
    def should_not_run(url):
        raise AssertionError('must validate first')
    monkeypatch.setattr(module, '_youtube_preview', should_not_run)
    for url in ['https://youtube.com.evil.test/x', 'https://localhost/private', 'https://u:p@youtube.com/x', 'https://youtube.com:8080/x']:
        assert client.post('/api/youtube-preview', json={'url': url}).status_code == 400


def test_youtube_preview_rejects_live_or_long(monkeypatch):
    import app as module
    import json
    from types import SimpleNamespace
    for info in [{'duration': 0}, {'duration': 800}, {'duration': 60, 'is_live': True}]:
        monkeypatch.setattr(module.subprocess, 'run', lambda *a, **kw: SimpleNamespace(stdout=json.dumps(info)))
        assert client.post('/api/youtube-preview', json={'url': 'https://youtu.be/abcdefghijk'}).status_code == 422


def test_master_is_accepted_as_extreme_for_generation():
    for platform in ("mobile", "desktop"):
        r = client.post(
            "/api/analyze",
            files={"file": ("kick.wav", wav_bytes(), "audio/wav")},
            data={"difficulty": "MASTER", "seed": "42", "platform": platform},
        )
        assert r.status_code == 200, r.text
        chart = r.json()["chart"]
        assert chart["difficulty"].lower() == "extreme" and chart["platformProfile"] == platform
        if platform == "desktop":
            assert not [n for n in chart["notes"] if n["type"] == "flick"]
