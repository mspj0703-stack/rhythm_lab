from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
ANALYZER = ROOT / "analyzer"
sys.path.insert(0, str(ANALYZER))

from chartgen.errors import ChartGenError
from chartgen.config import DIFFICULTIES
from chartgen.pipeline import generate_chart

try:  # `backend.app` in the container, plain `app` when tests import it from web/backend
    from .community import router as community_router
except ImportError:
    from community import router as community_router

RUNTIME = ROOT / ".runtime"
UPLOADS = RUNTIME / "uploads"
RESULTS = RUNTIME / "results"
EVALUATIONS = RUNTIME / "evaluations.jsonl"
for folder in (UPLOADS, RESULTS):
    folder.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "80"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_AUDIO_DURATION_SEC = float(os.getenv("MAX_AUDIO_DURATION_SEC", "600"))
RUNTIME_TTL_HOURS = float(os.getenv("RUNTIME_TTL_HOURS", "6"))
ANALYZE_CONCURRENCY = max(1, int(os.getenv("ANALYZE_CONCURRENCY", "1")))
YTDLP_POT_PROVIDER_URL = os.getenv("YTDLP_POT_PROVIDER_URL", "").strip().rstrip("/")
ANALYZE_SEMAPHORE = asyncio.Semaphore(ANALYZE_CONCURRENCY)
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".webm", ".mp4"}

APP_VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
if not APP_VERSION:
    raise RuntimeError("web/VERSION must not be empty")

app = FastAPI(title="BEATDASH", version=APP_VERSION)
app.include_router(community_router)


class EvaluationPayload(BaseModel):
    analysis_id: str = Field(min_length=1, max_length=64)
    song_name: str = Field(min_length=1, max_length=240)
    ratings: dict[str, int]
    comment: str = Field(default="", max_length=2000)


class YoutubeAnalyzePayload(BaseModel):
    url: str = Field(min_length=10, max_length=500)
    difficulty: str = Field(default="hard", max_length=16)
    seed: int = 42
    platform: str = Field(default="mobile", max_length=16)


def _normalize_difficulty(value: str) -> str:
    """Internal values stay Phase 1 (`extreme`); `master` is the v5 Phase 2 display name and is accepted as an alias."""
    difficulty = value.strip().lower()
    return "extreme" if difficulty == "master" else difficulty


def _validate_youtube_url(raw_url: str) -> str:
    try:
        parsed = urlparse(raw_url.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="올바른 YouTube 링크를 입력해 주세요.") from exc
    host = (parsed.hostname or "").lower()
    allowed = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
    if parsed.scheme not in {"http", "https"} or host not in allowed or parsed.username or parsed.password or parsed.netloc.lower() not in allowed:
        raise HTTPException(status_code=400, detail="YouTube 링크만 사용할 수 있습니다.")
    return raw_url.strip()


PREVIEW_SEMAPHORE = asyncio.Semaphore(2)


def _youtube_preview(url: str) -> dict:
    # Metadata only: bounded subprocess, no media download, no client-provided destination.
    proc = subprocess.run([
        sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings",
        "--skip-download", "--dump-single-json", "--socket-timeout", "15",
        "--retries", "1", url,
    ], check=True, capture_output=True, text=True, timeout=45)
    info = json.loads(proc.stdout)
    duration = info.get("duration")
    if info.get("is_live") or not isinstance(duration, (int, float)) or not 0 < duration <= MAX_AUDIO_DURATION_SEC:
        raise ValueError("unsupported duration")
    thumbnail = info.get("thumbnail") or ""
    if urlparse(thumbnail).scheme != "https":
        thumbnail = ""
    return {"title": str(info.get("title") or "YouTube 영상")[:500],
            "thumbnail": thumbnail, "duration": duration,
            "channel": str(info.get("channel") or info.get("uploader") or "")[:240]}


@app.post("/api/youtube-preview")
async def youtube_preview(payload: YoutubeAnalyzePayload) -> dict:
    url = _validate_youtube_url(payload.url)
    try:
        # Reject overload promptly rather than building an unbounded metadata queue.
        await asyncio.wait_for(PREVIEW_SEMAPHORE.acquire(), timeout=0.2)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해 주세요.") from exc
    try:
        return await run_in_threadpool(_youtube_preview, url)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="영상을 불러올 수 없습니다. 링크와 영상 공개 여부를 확인해 주세요.") from exc
    finally:
        PREVIEW_SEMAPHORE.release()


def _download_youtube(url: str, analysis_id: str) -> tuple[Path, str, int]:
    """Download one public YouTube item for temporary analysis/playback.

    YouTube may challenge cloud/datacenter IPs before media delivery. Try a
    small set of official yt-dlp player clients so one blocked client does not
    make the whole tester unusable. The primary mweb attempt uses the configured
    PO-token provider; embedded/VR clients are fallbacks for public videos.
    """
    output = str(UPLOADS / f"{analysis_id}.%(ext)s")
    base_cmd = [
        sys.executable, "-m", "yt_dlp",
        "--no-playlist", "--no-warnings",
        "--max-filesize", f"{MAX_UPLOAD_MB}M",
        "--match-filter", f"duration <= {int(MAX_AUDIO_DURATION_SEC)}",
        "--format", "best[ext=mp4][height<=720]/best[ext=webm][height<=720]/best[height<=720]/best",
        "--output", output,
        "--print", "after_move:filepath",
        "--print", "title",
    ]

    # `player_client` is the canonical yt-dlp YouTube extractor argument name.
    attempts = ["mweb", "web_embedded", "android_vr"]
    errors: list[str] = []
    proc = None

    for player_client in attempts:
        # Remove any partial file left by a failed previous attempt.
        for partial in UPLOADS.glob(f"{analysis_id}.*"):
            if partial.is_file():
                partial.unlink(missing_ok=True)

        cmd = [*base_cmd, "--extractor-args", f"youtube:player_client={player_client}"]
        if YTDLP_POT_PROVIDER_URL:
            cmd.extend([
                "--extractor-args",
                f"youtubepot-bgutilhttp:base_url={YTDLP_POT_PROVIDER_URL}",
            ])
        cmd.append(url)

        try:
            proc = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=180)
            break
        except subprocess.TimeoutExpired:
            errors.append(f"{player_client}: timeout")
        except subprocess.CalledProcessError as exc:
            lines = [line.strip() for line in (exc.stderr or exc.stdout or "").splitlines() if line.strip()]
            msg = " | ".join(lines[-4:]) if lines else "unknown yt-dlp error"
            errors.append(f"{player_client}: {msg[:320]}")
    else:
        summary = " || ".join(errors)
        raise HTTPException(
            status_code=422,
            detail=f"YouTube 영상을 가져올 수 없습니다. 서버 IP가 YouTube의 봇 확인에 차단되었을 수 있습니다: {summary[:1100]}",
        )

    matches = [p for p in UPLOADS.glob(f"{analysis_id}.*") if p.is_file()]
    if len(matches) != 1:
        raise HTTPException(status_code=422, detail="YouTube 미디어 파일을 준비하지 못했습니다.")
    path = matches[0]
    size = path.stat().st_size
    if size > MAX_UPLOAD_BYTES:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail=f"영상이 너무 큽니다. 최대 {MAX_UPLOAD_MB}MB까지 처리할 수 있습니다.")
    lines = [line.strip() for line in (proc.stdout if proc else "").splitlines() if line.strip()]
    title = next((line for line in lines if line != str(path) and not line.endswith(str(path.name))), "YouTube Song")
    return path, title, size


def _store_result(analysis_id: str, stored: Path, original_name: str, size: int, result) -> dict:
    result_dir = RESULTS / analysis_id
    result_dir.mkdir(parents=True, exist_ok=True)
    (result_dir / "chart.json").write_text(json.dumps(result.chart, ensure_ascii=False, indent=2), encoding="utf-8")
    (result_dir / "report.json").write_text(json.dumps(result.report, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {
        "id": analysis_id, "originalName": original_name, "storedName": stored.name, "size": size,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    (result_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "id": analysis_id, "originalName": original_name, "mediaUrl": f"/api/media/{analysis_id}",
        "mediaKind": "video" if stored.suffix.lower() in {".mp4", ".webm"} else "audio",
        "chart": result.chart, "report": result.report,
    }


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "version": app.version,
        "revision": (ROOT / "BUILD_REVISION").read_text().strip() if (ROOT / "BUILD_REVISION").is_file() else "unknown",
        "maxUploadMb": MAX_UPLOAD_MB,
        "maxAudioDurationSec": MAX_AUDIO_DURATION_SEC,
        "youtubePotProvider": bool(YTDLP_POT_PROVIDER_URL),
        # Community charts need COMMUNITY_DB_PATH on a persistent volume; the default path is ephemeral.
        "communityPersistentStorage": bool(os.getenv("COMMUNITY_DB_PATH")),
    }


def _cleanup_runtime() -> None:
    """Best-effort cleanup for ephemeral hosting. Never lets cleanup break a request."""
    cutoff = time.time() - RUNTIME_TTL_HOURS * 3600
    try:
        for path in UPLOADS.glob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        for path in RESULTS.glob("*"):
            if path.is_dir() and path.stat().st_mtime < cutoff:
                shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass


def _probe_duration(path: Path) -> float | None:
    """Use ffprobe when available so overlong media is rejected before librosa loads it."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        proc = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            check=True, capture_output=True, text=True, timeout=15,
        )
        return float(proc.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _safe_extension(filename: str | None) -> str:
    ext = Path(filename or "audio.wav").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 파일 형식입니다: {ext or '(확장자 없음)'}")
    return ext


async def _save_upload(upload: UploadFile, target: Path) -> int:
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"파일이 너무 큽니다. 최대 {MAX_UPLOAD_MB}MB까지 업로드할 수 있습니다.")
                out.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    return size


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),  # noqa: B008 - FastAPI dependency declaration
    difficulty: str = Form("hard"),
    seed: int = Form(42),
    platform: str = Form("mobile"),
) -> dict:
    if platform not in {"mobile", "desktop"}:
        raise HTTPException(status_code=400, detail="플랫폼은 mobile/desktop 중 하나여야 합니다.")
    difficulty = _normalize_difficulty(difficulty)
    if difficulty not in DIFFICULTIES:
        raise HTTPException(status_code=400, detail="난이도는 easy/normal/hard/expert/master(extreme) 중 하나여야 합니다.")
    if seed < -2_147_483_648 or seed > 2_147_483_647:
        raise HTTPException(status_code=400, detail="seed 범위가 너무 큽니다.")

    _cleanup_runtime()
    ext = _safe_extension(file.filename)
    analysis_id = uuid4().hex
    stored = UPLOADS / f"{analysis_id}{ext}"
    size = await _save_upload(file, stored)
    title = Path(file.filename or "Uploaded Song").stem

    duration = _probe_duration(stored)
    if duration is not None and duration > MAX_AUDIO_DURATION_SEC:
        stored.unlink(missing_ok=True)
        raise HTTPException(
            status_code=413,
            detail=f"미디어가 너무 깁니다. 최대 {MAX_AUDIO_DURATION_SEC / 60:.0f}분까지 분석할 수 있습니다.",
        )

    try:
        async with ANALYZE_SEMAPHORE:
            result = await run_in_threadpool(generate_chart, str(stored), difficulty, seed, title, platform)
    except ChartGenError as exc:
        stored.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        stored.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"분석 중 예기치 않은 오류가 발생했습니다: {type(exc).__name__}") from exc

    return _store_result(analysis_id, stored, file.filename or stored.name, size, result)

@app.post("/api/analyze-youtube")
async def analyze_youtube(payload: YoutubeAnalyzePayload) -> dict:
    if payload.platform not in {"mobile", "desktop"}:
        raise HTTPException(status_code=400, detail="플랫폼은 mobile/desktop 중 하나여야 합니다.")
    difficulty = _normalize_difficulty(payload.difficulty)
    if difficulty not in DIFFICULTIES:
        raise HTTPException(status_code=400, detail="난이도는 easy/normal/hard/expert/master(extreme) 중 하나여야 합니다.")
    if payload.seed < -2_147_483_648 or payload.seed > 2_147_483_647:
        raise HTTPException(status_code=400, detail="seed 범위가 너무 큽니다.")
    url = _validate_youtube_url(payload.url)
    _cleanup_runtime()
    analysis_id = uuid4().hex
    stored = None
    try:
        async with ANALYZE_SEMAPHORE:
            stored, title, size = await run_in_threadpool(_download_youtube, url, analysis_id)
            duration = _probe_duration(stored)
            if duration is not None and duration > MAX_AUDIO_DURATION_SEC:
                raise HTTPException(status_code=413, detail=f"미디어가 너무 깁니다. 최대 {MAX_AUDIO_DURATION_SEC / 60:.0f}분까지 분석할 수 있습니다.")
            result = await run_in_threadpool(generate_chart, str(stored), difficulty, payload.seed, title, payload.platform)
    except HTTPException:
        if stored: stored.unlink(missing_ok=True)
        raise
    except ChartGenError as exc:
        if stored: stored.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if stored: stored.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"분석 중 예기치 않은 오류가 발생했습니다: {type(exc).__name__}") from exc
    return _store_result(analysis_id, stored, title, size, result)



def _find_upload(analysis_id: str) -> Path:
    if not analysis_id.isalnum() or len(analysis_id) > 64:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    matches = list(UPLOADS.glob(f"{analysis_id}.*"))
    if len(matches) != 1:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return matches[0]


@app.get("/api/media/{analysis_id}")
def media(analysis_id: str):
    path = _find_upload(analysis_id)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name, headers={"Cache-Control": "no-store, private"})


@app.get("/api/session/{analysis_id}")
def get_session(analysis_id: str) -> dict:
    upload = _find_upload(analysis_id)
    result_dir = RESULTS / analysis_id
    meta_path = result_dir / "meta.json"
    chart_path = result_dir / "chart.json"
    report_path = result_dir / "report.json"
    if not (meta_path.is_file() and chart_path.is_file() and report_path.is_file()):
        raise HTTPException(status_code=404, detail="분석 세션을 찾을 수 없습니다.")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        chart = json.loads(chart_path.read_text(encoding="utf-8"))
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="분석 세션을 읽지 못했습니다.") from exc
    return {
        "id": analysis_id,
        "originalName": meta.get("originalName", upload.name),
        "mediaUrl": f"/api/media/{analysis_id}",
        "mediaKind": "video" if upload.suffix.lower() in {".mp4", ".webm"} else "audio",
        "chart": chart,
        "report": report,
    }


@app.get("/api/result/{analysis_id}/{name}")
def result_file(analysis_id: str, name: str):
    if name not in {"chart.json", "report.json"}:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    path = RESULTS / analysis_id / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(path, media_type="application/json", filename=name, headers={"Cache-Control": "no-store, private"})


@app.post("/api/evaluations")
def save_evaluation(payload: EvaluationPayload) -> dict:
    required = {"timing", "musicality", "pattern", "density", "repetition", "fun"}
    if set(payload.ratings) != required:
        raise HTTPException(status_code=400, detail="평가 항목이 올바르지 않습니다.")
    if any(not isinstance(v, int) or v < 1 or v > 5 for v in payload.ratings.values()):
        raise HTTPException(status_code=400, detail="평점은 1~5 정수여야 합니다.")
    record = {
        **payload.model_dump(),
        "savedAt": datetime.now(timezone.utc).isoformat(),
    }
    EVALUATIONS.parent.mkdir(parents=True, exist_ok=True)
    with EVALUATIONS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {"ok": True}


@app.delete("/api/session/{analysis_id}")
def delete_session(analysis_id: str) -> dict:
    try:
        upload = _find_upload(analysis_id)
        upload.unlink(missing_ok=True)
    except HTTPException:
        pass
    shutil.rmtree(RESULTS / analysis_id, ignore_errors=True)
    return {"ok": True}


DIST = ROOT / "dist"
if DIST.is_dir():
    assets = DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = DIST / full_path
        if full_path and candidate.is_file() and DIST in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
