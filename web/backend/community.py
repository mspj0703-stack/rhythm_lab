"""BEATDASH v5 Phase 2 - Community chart sharing (chart JSON only, never media).

Storage is a single SQLite file (COMMUNITY_DB_PATH, default web/.runtime/community.sqlite3).
The runtime TTL cleanup in app.py only touches uploads/ and results/, never this file. On Railway the
path must live on a persistent volume, otherwise shared charts disappear on redeploy.

The server never trusts client chart JSON: every upload is re-validated here with the same ERROR
rules as the Maker validator (web/src/maker/validator.ts) and re-serialized from known fields only.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import sqlite3
import tempfile
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / ".runtime" / "community.sqlite3"

MAX_PAYLOAD_BYTES = int(os.getenv("COMMUNITY_MAX_PAYLOAD_BYTES", str(512 * 1024)))
MAX_NOTES = 5000
MAX_SONG_SEC = float(os.getenv("COMMUNITY_MAX_SONG_SEC", "900"))
MAX_UPLOADS_PER_HOUR = int(os.getenv("COMMUNITY_MAX_UPLOADS_PER_HOUR", "30"))
MAX_TOTAL_CHARTS = int(os.getenv("COMMUNITY_MAX_TOTAL_CHARTS", "50000"))
SUPPORTED_CHART_VERSION = 5
DIFFICULTIES = ("easy", "normal", "hard", "expert", "extreme")
PLATFORMS = ("mobile", "desktop")
NOTE_TYPES = ("tap", "hold", "flick")

# Mirrors LIMITS in web/src/maker/validator.ts (ERROR rules only).
DUPLICATE_SEC = 0.001
OVERLAP_SEC = 0.05
CHORD_SEC = 0.015
HOLD_RELEASE_GAP_SEC = 0.05
MIN_HOLD_SEC = 0.05
MAX_HOLD_SEC = 30.0
MAX_NPS = 24
END_TOLERANCE_SEC = 0.5

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
ID_RE = re.compile(r"^[0-9a-f]{32}$")
FINGERPRINT_RE = re.compile(r"^v2:[0-9a-f]{64}$")


class CommunityStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self._ready = False

    def use(self, path: Path) -> None:
        """Point the store at another file (tests / ops)."""
        with self.lock:
            self.path = path
            self._ready = False

    def connect(self) -> sqlite3.Connection:
        if not self._ready:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        if not self._ready:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                """CREATE TABLE IF NOT EXISTS charts (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    song_title TEXT NOT NULL,
                    song_original_title TEXT,
                    song_duration REAL NOT NULL,
                    song_bpm REAL NOT NULL,
                    song_fingerprint TEXT,
                    difficulty TEXT NOT NULL,
                    level INTEGER NOT NULL,
                    platform TEXT NOT NULL,
                    chart_version INTEGER NOT NULL,
                    scoring_version INTEGER NOT NULL,
                    author_id TEXT NOT NULL,
                    author_secret_hash TEXT NOT NULL,
                    note_count INTEGER NOT NULL,
                    last_note_sec REAL NOT NULL,
                    content_hash TEXT NOT NULL,
                    chart_json TEXT NOT NULL,
                    download_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    created_ts REAL NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0
                )"""
            )
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS charts_content ON charts(content_hash) WHERE deleted = 0")
            conn.execute("CREATE INDEX IF NOT EXISTS charts_created ON charts(created_ts)")
            conn.execute("CREATE INDEX IF NOT EXISTS charts_author ON charts(author_id, created_ts)")
            conn.commit()
            self._ready = True
        return conn


def describe_storage(path: Path, configured: bool, env: "os._Environ[str] | dict[str, str] | None" = None, tmp_roots: tuple[str, ...] | None = None) -> dict:
    """What kind of place is the Community DB on, and does it survive a redeploy?

    COMMUNITY_DB_PATH being set proves nothing: it may still point into the container's ephemeral filesystem.
    A path counts as persistent only when it is inside Railway's volume mount (RAILWAY_VOLUME_MOUNT_PATH) or on a
    different device than the container root (a mounted volume). Paths are never returned, only their type.
    """
    env = os.environ if env is None else env
    try:
        resolved = Path(path).resolve()
    except OSError:
        resolved = Path(path)
    roots = tmp_roots if tmp_roots is not None else tuple({"/tmp", "/var/tmp", tempfile.gettempdir()})

    def inside(child: Path, parent: Path) -> bool:
        try:
            child.relative_to(parent)
            return True
        except ValueError:
            return False

    kind = "custom-unmounted" if configured else "default"
    if resolved == DEFAULT_DB_PATH.resolve():
        kind = "default"
    elif any(inside(resolved, Path(root).resolve()) for root in roots):
        kind = "tmp"
    else:
        volume = env.get("RAILWAY_VOLUME_MOUNT_PATH")
        if volume and inside(resolved, Path(volume).resolve()):
            kind = "volume"
        else:
            ancestor = resolved.parent
            while not ancestor.exists() and ancestor != ancestor.parent:
                ancestor = ancestor.parent
            try:
                if ancestor != Path(ancestor.anchor) and ancestor.stat().st_dev != Path(ancestor.anchor).stat().st_dev:
                    kind = "volume"
            except OSError:
                pass
    writable = False
    try:
        probe = resolved.parent
        while not probe.exists() and probe != probe.parent:
            probe = probe.parent
        writable = os.access(probe, os.W_OK)
    except OSError:
        pass
    return {
        "communityDbConfigured": configured,
        "communityDbPathType": kind,
        "communityPersistentStorage": kind == "volume" and writable,
        "communityDbWritable": writable,
    }


store = CommunityStore(Path(os.getenv("COMMUNITY_DB_PATH", str(DEFAULT_DB_PATH))))
router = APIRouter(prefix="/api/community")


def _bad(detail: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(value: Any, field: str, max_len: int, required: bool = True) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise _bad(f"{field} 값이 필요합니다.")
        return None
    if not isinstance(value, str):
        raise _bad(f"{field} 값이 올바르지 않습니다.")
    value = value.strip()
    if len(value) > max_len:
        raise _bad(f"{field}이(가) 너무 깁니다 (최대 {max_len}자).")
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _validate_notes(raw_notes: Any, platform: str, song_duration: float) -> list[dict]:
    if not isinstance(raw_notes, list) or not raw_notes:
        raise _bad("노트가 없습니다.")
    if len(raw_notes) > MAX_NOTES:
        raise _bad(f"노트가 너무 많습니다 (최대 {MAX_NOTES}개).")
    notes: list[dict] = []
    for raw in raw_notes:
        if not isinstance(raw, dict):
            raise _bad("노트 형식이 올바르지 않습니다.")
        note_type = raw.get("type")
        if note_type not in NOTE_TYPES:
            raise _bad("지원하지 않는 노트 종류가 있습니다.")
        lane = raw.get("lane")
        if not _int(lane) or not 0 <= lane <= 3:
            raise _bad("레인은 0~3만 사용할 수 있습니다.")
        t = raw.get("time")
        if not _finite(t) or t < 0:
            raise _bad("노트 시간이 올바르지 않습니다.")
        if t > song_duration + END_TOLERANCE_SEC:
            raise _bad("곡 길이를 넘는 노트가 있습니다.")
        if platform == "desktop" and note_type == "flick":
            raise _bad("PC(Desktop) 채보에는 Flick을 넣을 수 없습니다.")
        note: dict[str, Any] = {"time": round(float(t), 4), "lane": lane, "type": note_type}
        if note_type == "hold":
            duration = raw.get("duration")
            if not _finite(duration) or not MIN_HOLD_SEC <= duration <= MAX_HOLD_SEC:
                raise _bad("Hold 길이가 올바르지 않습니다.")
            if t + duration > song_duration + END_TOLERANCE_SEC:
                raise _bad("곡 길이를 넘는 Hold가 있습니다.")
            note["duration"] = round(float(duration), 4)
        notes.append(note)
    notes.sort(key=lambda n: (n["time"], n["lane"]))

    for lane in range(4):
        lane_notes = [n for n in notes if n["lane"] == lane]
        for prev, cur in zip(lane_notes, lane_notes[1:]):
            gap = cur["time"] - prev["time"]
            if gap < DUPLICATE_SEC:
                raise _bad("같은 레인·같은 시간에 중복 노트가 있습니다.")
            prev_end = prev["time"] + prev.get("duration", 0.0)
            if prev["type"] == "hold" and cur["time"] < prev_end + HOLD_RELEASE_GAP_SEC:
                raise _bad("Hold가 끝나기 전에 같은 레인에 노트가 있습니다.")
            if gap < OVERLAP_SEC:
                raise _bad("같은 레인 노트가 겹쳐 있습니다.")

    i = 0
    while i < len(notes):
        j = i + 1
        while j < len(notes) and notes[j]["time"] - notes[i]["time"] <= CHORD_SEC:
            j += 1
        if len({n["lane"] for n in notes[i:j]}) >= 4:
            raise _bad("4키 동시 입력은 공유할 수 없습니다.")
        i = j

    start = 0
    for end in range(len(notes)):
        while notes[end]["time"] - notes[start]["time"] >= 1:
            start += 1
        if end - start + 1 > MAX_NPS:
            raise _bad(f"1초에 {MAX_NPS}개를 넘는 구간이 있습니다.")
    return notes


def _validate_payload(body: bytes) -> dict:
    if len(body) > MAX_PAYLOAD_BYTES:
        raise _bad("채보 데이터가 너무 큽니다.", 413)
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise _bad("JSON 형식이 올바르지 않습니다.") from exc
    if not isinstance(data, dict):
        raise _bad("요청 형식이 올바르지 않습니다.")
    author_id = data.get("authorId")
    secret = data.get("authorSecret")
    if not isinstance(author_id, str) or not UUID_RE.match(author_id) or not isinstance(secret, str) or not UUID_RE.match(secret):
        raise _bad("작성자 ID가 올바르지 않습니다.")
    if data.get("origin") != "human-edited":
        raise _bad("사람이 Maker로 편집한 채보만 공유할 수 있습니다.", 422)
    summary = data.get("editSummary")
    if not isinstance(summary, dict) or not all(_int(summary.get(k)) and summary.get(k) >= 0 for k in ("added", "removed", "unchanged")):
        raise _bad("편집 정보가 올바르지 않습니다.")
    if summary["added"] + summary["removed"] == 0:
        raise _bad("AI 원본과 같은 채보는 공유할 수 없습니다.", 422)
    chart_version = data.get("chartVersion")
    if not _int(chart_version) or not 1 <= chart_version <= 100000:
        raise _bad("chartVersion이 올바르지 않습니다.")

    song = data.get("song")
    if not isinstance(song, dict):
        raise _bad("곡 정보가 필요합니다.")
    song_title = _text(song.get("title"), "곡 제목", 200)
    song_original = _text(song.get("originalTitle"), "원본 제목", 200, required=False)
    duration = song.get("durationSec")
    if not _finite(duration) or not 1 <= duration <= MAX_SONG_SEC:
        raise _bad("곡 길이가 올바르지 않습니다.")
    bpm = song.get("bpm")
    if not _finite(bpm) or not 0 <= bpm <= 1000:
        raise _bad("BPM이 올바르지 않습니다.")
    fingerprint = song.get("fingerprint")
    if fingerprint is not None and (not isinstance(fingerprint, str) or not FINGERPRINT_RE.match(fingerprint)):
        raise _bad("곡 식별 값이 올바르지 않습니다.")

    chart = data.get("chart")
    if not isinstance(chart, dict):
        raise _bad("채보 데이터가 필요합니다.")
    platform = chart.get("platformProfile")
    if platform not in PLATFORMS:
        raise _bad("플랫폼은 mobile/desktop이어야 합니다.")
    difficulty = chart.get("difficulty")
    if isinstance(difficulty, str) and difficulty.strip().lower() == "master":
        difficulty = "extreme"
    if not isinstance(difficulty, str) or difficulty.strip().lower() not in DIFFICULTIES:
        raise _bad("난이도는 easy/normal/hard/expert/master(extreme) 중 하나여야 합니다.")
    difficulty = difficulty.strip().lower()
    level = chart.get("level")
    if not _int(level) or not 1 <= level <= 30:
        raise _bad("레벨은 1~30이어야 합니다.")
    scoring = chart.get("scoringVersion", 1)
    if scoring not in (1, 2) or isinstance(scoring, bool):
        raise _bad("지원하지 않는 점수 규칙입니다.")
    version = chart.get("version", 1)
    if not _int(version) or not 1 <= version <= SUPPORTED_CHART_VERSION:
        raise _bad("지원하지 않는 채보 버전입니다.", 422)
    chart_bpm = chart.get("bpm")
    if not _finite(chart_bpm) or not 0 < chart_bpm <= 1000:
        raise _bad("채보 BPM이 올바르지 않습니다.")
    offset = chart.get("offset", 0)
    if not _finite(offset) or not -10 <= offset <= 10:
        raise _bad("offset이 올바르지 않습니다.")
    notes = _validate_notes(chart.get("notes"), platform, float(duration))

    clean_chart = {
        "version": version, "platformProfile": platform, "scoringVersion": scoring,
        "title": _text(chart.get("title"), "채보 제목", 200, required=False) or song_title,
        "artist": _text(chart.get("artist"), "아티스트", 200, required=False) or "",
        "bpm": float(chart_bpm), "offset": float(offset), "difficulty": difficulty, "level": level, "notes": notes,
    }
    identity = _song_identity(fingerprint, song_original or song_title, float(duration), float(bpm))
    content_hash = hashlib.sha256(
        json.dumps([2, identity, platform, difficulty, notes], ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    last_note = max(n["time"] + n.get("duration", 0.0) for n in notes)
    return {
        "author_id": author_id.lower(), "secret": secret, "chart_version": chart_version,
        "title": _text(data.get("title"), "채보 이름", 80),
        "description": _text(data.get("description"), "설명", 500, required=False),
        "song_title": song_title, "song_original_title": song_original, "song_duration": float(duration),
        "song_bpm": float(bpm), "song_fingerprint": fingerprint, "difficulty": difficulty, "level": level,
        "platform": platform, "scoring_version": scoring, "note_count": len(notes), "last_note_sec": round(last_note, 4),
        "content_hash": content_hash, "chart_json": json.dumps(clean_chart, ensure_ascii=False, separators=(",", ":")),
    }


def _song_identity(fingerprint: str | None, title: str, duration: float, bpm: float) -> list:
    """Stable song identity for duplicate detection: the fingerprint when present, otherwise normalized title/duration/BPM."""
    if fingerprint:
        return ["fp", fingerprint.lower()]
    normalized = " ".join(unicodedata.normalize("NFKC", title).casefold().split())
    return ["meta", normalized, round(duration, 1), round(bpm, 1)]


def _summary(row: sqlite3.Row) -> dict:
    return {
        "cloudChartId": row["id"], "title": row["title"], "description": row["description"] or None,
        "difficulty": row["difficulty"], "level": row["level"], "platformProfile": row["platform"],
        "chartVersion": row["chart_version"], "scoringVersion": row["scoring_version"], "authorId": row["author_id"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"], "downloadCount": row["download_count"],
        "noteCount": row["note_count"], "lastNoteSec": row["last_note_sec"],
        "song": {"title": row["song_title"], "originalTitle": row["song_original_title"] or None,
                 "durationSec": row["song_duration"], "bpm": row["song_bpm"], "fingerprint": row["song_fingerprint"] or None},
    }


def _detail(row: sqlite3.Row) -> dict:
    return {**_summary(row), "chartData": json.loads(row["chart_json"])}


def _get_row(conn: sqlite3.Connection, chart_id: str) -> sqlite3.Row:
    if not ID_RE.match(chart_id):
        raise _bad("채보를 찾을 수 없습니다.", 404)
    row = conn.execute("SELECT * FROM charts WHERE id = ? AND deleted = 0", (chart_id,)).fetchone()
    if row is None:
        raise _bad("채보를 찾을 수 없습니다.", 404)
    return row


def _check_owner(row: sqlite3.Row, author_id: Any, secret: Any) -> None:
    if not isinstance(author_id, str) or not isinstance(secret, str) or author_id.lower() != row["author_id"] \
            or not hmac.compare_digest(_hash_secret(secret), row["author_secret_hash"]):
        raise _bad("이 채보를 수정할 권한이 없습니다.", 403)


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PAYLOAD_BYTES:
        raise _bad("채보 데이터가 너무 큽니다.", 413)
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_PAYLOAD_BYTES:
            raise _bad("채보 데이터가 너무 큽니다.", 413)
    return body


@router.post("/charts")
async def upload_chart(request: Request) -> dict:
    item = _validate_payload(await _read_body(request))
    now_ts = time.time()
    with store.lock:
        conn = store.connect()
        try:
            recent = conn.execute("SELECT COUNT(*) FROM charts WHERE author_id = ? AND created_ts > ?", (item["author_id"], now_ts - 3600)).fetchone()[0]
            if recent >= MAX_UPLOADS_PER_HOUR:
                raise _bad("업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
            if conn.execute("SELECT COUNT(*) FROM charts WHERE deleted = 0").fetchone()[0] >= MAX_TOTAL_CHARTS:
                raise _bad("Community 저장 공간이 가득 찼습니다.", 507)
            if conn.execute("SELECT 1 FROM charts WHERE content_hash = ? AND deleted = 0", (item["content_hash"],)).fetchone():
                raise _bad("이미 같은 채보가 공유되어 있습니다.", 409)
            chart_id = uuid4().hex
            stamp = _now()
            conn.execute(
                """INSERT INTO charts (id, title, description, song_title, song_original_title, song_duration, song_bpm,
                    song_fingerprint, difficulty, level, platform, chart_version, scoring_version, author_id, author_secret_hash,
                    note_count, last_note_sec, content_hash, chart_json, created_at, updated_at, created_ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (chart_id, item["title"], item["description"], item["song_title"], item["song_original_title"], item["song_duration"],
                 item["song_bpm"], item["song_fingerprint"], item["difficulty"], item["level"], item["platform"], item["chart_version"],
                 item["scoring_version"], item["author_id"], _hash_secret(item["secret"]), item["note_count"], item["last_note_sec"],
                 item["content_hash"], item["chart_json"], stamp, stamp, now_ts),
            )
            conn.commit()
            return _summary(_get_row(conn, chart_id))
        finally:
            conn.close()


@router.get("/charts")
def list_charts(
    q: str = Query(default="", max_length=100),
    difficulty: str = Query(default="all", max_length=16),
    platform: str = Query(default="all", max_length=16),
    sort: str = Query(default="latest", max_length=16),
    limit: int = Query(default=30, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=10000),
) -> dict:
    where = ["deleted = 0"]
    params: list[Any] = []
    if q.strip():
        like = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(lower(title) LIKE ? ESCAPE '\\' OR lower(song_title) LIKE ? ESCAPE '\\' OR lower(coalesce(song_original_title, '')) LIKE ? ESCAPE '\\')")
        params += [like, like, like]
    if difficulty != "all":
        wanted = "extreme" if difficulty.lower() == "master" else difficulty.lower()
        if wanted not in DIFFICULTIES:
            raise _bad("난이도 필터가 올바르지 않습니다.")
        where.append("difficulty = ?")
        params.append(wanted)
    if platform != "all":
        if platform not in PLATFORMS:
            raise _bad("플랫폼 필터가 올바르지 않습니다.")
        where.append("platform = ?")
        params.append(platform)
    if sort not in ("latest", "downloads"):
        raise _bad("정렬 기준이 올바르지 않습니다.")
    order = "created_ts DESC" if sort == "latest" else "download_count DESC, created_ts DESC"
    clause = " AND ".join(where)
    conn = store.connect()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM charts WHERE {clause}", params).fetchone()[0]
        rows = conn.execute(f"SELECT * FROM charts WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()
        return {"items": [_summary(row) for row in rows], "total": total}
    finally:
        conn.close()


@router.get("/charts/{chart_id}")
def get_chart(chart_id: str) -> dict:
    conn = store.connect()
    try:
        return _detail(_get_row(conn, chart_id))
    finally:
        conn.close()


@router.post("/charts/{chart_id}/download")
def download_chart(chart_id: str) -> dict:
    with store.lock:
        conn = store.connect()
        try:
            _get_row(conn, chart_id)
            conn.execute("UPDATE charts SET download_count = download_count + 1 WHERE id = ?", (chart_id,))
            conn.commit()
            return _detail(_get_row(conn, chart_id))
        finally:
            conn.close()


@router.put("/charts/{chart_id}")
async def update_chart(chart_id: str, request: Request) -> dict:
    item = _validate_payload(await _read_body(request))
    with store.lock:
        conn = store.connect()
        try:
            row = _get_row(conn, chart_id)
            _check_owner(row, item["author_id"], item["secret"])
            clash = conn.execute("SELECT 1 FROM charts WHERE content_hash = ? AND deleted = 0 AND id != ?", (item["content_hash"], chart_id)).fetchone()
            if clash:
                raise _bad("이미 같은 채보가 공유되어 있습니다.", 409)
            conn.execute(
                """UPDATE charts SET title = ?, description = ?, song_title = ?, song_original_title = ?, song_duration = ?, song_bpm = ?,
                    song_fingerprint = ?, difficulty = ?, level = ?, platform = ?, chart_version = ?, scoring_version = ?, note_count = ?,
                    last_note_sec = ?, content_hash = ?, chart_json = ?, updated_at = ? WHERE id = ?""",
                (item["title"], item["description"], item["song_title"], item["song_original_title"], item["song_duration"], item["song_bpm"],
                 item["song_fingerprint"], item["difficulty"], item["level"], item["platform"], item["chart_version"], item["scoring_version"],
                 item["note_count"], item["last_note_sec"], item["content_hash"], item["chart_json"], _now(), chart_id),
            )
            conn.commit()
            return _summary(_get_row(conn, chart_id))
        finally:
            conn.close()


@router.delete("/charts/{chart_id}")
async def delete_chart(chart_id: str, request: Request) -> dict:
    body = await _read_body(request)
    try:
        data = json.loads(body or b"{}")
    except ValueError as exc:
        raise _bad("JSON 형식이 올바르지 않습니다.") from exc
    if not isinstance(data, dict):
        raise _bad("요청 형식이 올바르지 않습니다.")
    with store.lock:
        conn = store.connect()
        try:
            row = _get_row(conn, chart_id)
            _check_owner(row, data.get("authorId"), data.get("authorSecret"))
            conn.execute("UPDATE charts SET deleted = 1, updated_at = ? WHERE id = ?", (_now(), chart_id))
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()
