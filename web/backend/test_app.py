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
