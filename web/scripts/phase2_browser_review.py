"""BEATDASH v5 Phase 2 browser review (real backend + Chromium).

Runs the production build against a local FastAPI backend with a throw-away Community database and checks:
  * play-screen layout at phone/tablet/desktop sizes in portrait and landscape (judge line, Pause, HUD, lanes),
  * Maker: open from Library, edit, save as a separate human chart, test-play,
  * Community: share the edit, find it, download it in a *fresh* browser profile (another user) and play it.

Usage (from web/):  npm run build && python3 scripts/phase2_browser_review.py
Screenshots and a JSON summary go to web/review-output/phase2/.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "review-output" / "phase2"
PORT = int(os.getenv("PHASE2_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"
SIZES = [(360, 800), (412, 915), (800, 1280), (1280, 720), (1920, 1080), (2560, 1440)]
checks: list[str] = []
errors: list[str] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    if not ok:
        raise AssertionError(f"FAIL {name} {detail}")
    checks.append(name)
    print("PASS", name)


def click_text(page: Page, text: str) -> None:
    page.get_by_role("button", name=text).first.click()


def layout(page: Page) -> dict:
    return page.evaluate("""() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,r:b.right,b:b.bottom}; };
      const canvas = document.querySelector('.playfield canvas');
      const field = r('.playfield');
      return { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, stage: r('.stage'), field, canvas: r('.playfield canvas'),
        backing: canvas ? {w: canvas.width, h: canvas.height} : null, lanes: r('.touch-lanes'), pause: r('.pause-button'),
        hudLeft: r('.game-hud-left'), hudRight: r('.game-hud-right'), toolbar: r('.play-toolbar'),
        judgeY: field ? field.y + field.h * (1 - 62 / 560) : null, scrollW: document.documentElement.scrollWidth };
    }""")


def inside(box: dict | None, vw: float, vh: float) -> bool:
    return bool(box) and box["x"] >= -0.5 and box["y"] >= -0.5 and box["r"] <= vw + 0.5 and box["b"] <= vh + 0.5


def check_play_layout(page: Page, label: str) -> None:
    page.wait_for_selector(".play-fullscreen .stage")
    page.wait_for_timeout(250)
    data = layout(page)
    vw, vh = data["vw"], data["vh"]
    for part in ("stage", "field", "canvas", "lanes", "pause", "hudLeft", "hudRight"):
        check(f"{label}: {part} inside viewport", inside(data[part], vw, vh), data[part])
    check(f"{label}: no in-play menu/back toolbar", data["toolbar"] is None)
    check(f"{label}: stage uses the whole screen", data["stage"]["h"] >= vh - 1 and data["stage"]["w"] >= vw - 1, data["stage"])
    check(f"{label}: judge line on screen", 0 < data["judgeY"] < vh, data["judgeY"])
    check(f"{label}: canvas not stretched (backing = css x dpr)", abs(data["backing"]["w"] - round(data["canvas"]["w"] * min(2, data["dpr"]))) <= 2, data["backing"])
    lane_w = data["lanes"]["w"] / 4
    check(f"{label}: lanes wide enough ({lane_w:.0f}px)", lane_w >= 60, lane_w)
    check(f"{label}: lane width capped on wide screens", data["field"]["w"] <= 881, data["field"])
    check(f"{label}: no horizontal scroll", data["scrollW"] <= vw + 1, data["scrollW"])
    page.screenshot(path=str(OUT / f"{label}.png"))


def check_pause_menu(page: Page, label: str) -> None:
    page.keyboard.press("Escape")
    page.wait_for_selector(".pause-overlay")
    vw, vh = page.viewport_size["width"], page.viewport_size["height"]
    for name in ("계속하기", "다시 시작", "곡 리스트로 돌아가기"):
        box = page.get_by_role("button", name=name).bounding_box()
        check(f"{label}: Pause '{name}' visible and large", box is not None and box["height"] >= 44 and inside({"x": box["x"], "y": box["y"], "r": box["x"] + box["width"], "b": box["y"] + box["height"]}, vw, vh), box)
    page.screenshot(path=str(OUT / f"{label}-pause.png"))
    page.get_by_role("button", name="계속하기").click()
    page.wait_for_selector(".resume-countdown")
    t0 = page.evaluate("document.querySelector('audio,video').currentTime")
    page.wait_for_timeout(1200)
    t1 = page.evaluate("document.querySelector('audio,video').currentTime")
    check(f"{label}: media frozen during the resume countdown", abs(t1 - t0) < 0.01, (t0, t1))
    page.wait_for_selector(".resume-countdown", state="detached", timeout=5000)
    page.wait_for_timeout(400)
    t2 = page.evaluate("document.querySelector('audio,video').currentTime")
    check(f"{label}: playback resumes from the paused position", 0.05 < t2 - t1 < 1.5, (t1, t2))


def multitouch(page: Page) -> None:
    """Real Chromium touch input via CDP (touchEnd lists the fingers that lift): several fingers on different lanes."""
    cdp = page.context.new_cdp_session(page)
    lanes = page.evaluate("[...document.querySelectorAll('.touch-lane')].map(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })")
    pressed = lambda: page.evaluate("[...document.querySelectorAll('.lane-input-feedback i')].map(i => i.classList.contains('pressed') ? 1 : 0).join('')")  # noqa: E731
    pt = lambda i, lane, dy=0: {"x": lanes[lane][0], "y": lanes[lane][1] + dy, "id": i}  # noqa: E731
    send = lambda kind, points: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})  # noqa: E731
    send("touchStart", [pt(1, 0)])
    send("touchStart", [pt(1, 0), pt(2, 2)])
    page.wait_for_timeout(80)
    check("multi-touch: two fingers press two lanes", pressed() == "1010", pressed())
    send("touchEnd", [pt(2, 2)])
    page.wait_for_timeout(80)
    check("multi-touch: lifting the second finger keeps the first finger's lane", pressed() == "1000", pressed())
    send("touchStart", [pt(1, 0), pt(3, 3)])
    send("touchMove", [pt(1, 0), pt(3, 3, -60)])
    send("touchEnd", [pt(3, 3, -60)])
    page.wait_for_timeout(80)
    check("multi-touch: a flick on another lane leaves the held lane pressed", pressed() == "1000", pressed())
    page.wait_for_timeout(1300)  # long press: must not turn into a context menu / pointercancel
    check("multi-touch: a 1.3 s long press stays pressed (no long-press cancel)", pressed() == "1000", pressed())
    send("touchStart", [pt(1, 0), pt(4, 1), pt(5, 2), pt(6, 3)])
    page.wait_for_timeout(80)
    check("multi-touch: four simultaneous fingers", pressed() == "1111", pressed())
    send("touchEnd", [pt(4, 1), pt(5, 2), pt(6, 3)])
    page.wait_for_timeout(80)
    check("multi-touch: three fingers lift, the Hold finger stays", pressed() == "1000", pressed())
    send("touchCancel", [])
    page.wait_for_timeout(80)
    check("multi-touch: cancel ends the last finger", pressed() == "0000", pressed())


def touch_hold_across_pause(page: Page) -> None:
    """Real CDP touches: does a finger that stays down (or lifts) while the Pause overlay opens keep a truthful lane state?"""
    cdp = page.context.new_cdp_session(page)
    lanes = page.evaluate("[...document.querySelectorAll('.touch-lane')].map(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })")
    pressed = lambda: page.evaluate("[...document.querySelectorAll('.lane-input-feedback i')].map(i => i.classList.contains('pressed') ? 1 : 0).join('')")  # noqa: E731
    pt = lambda i, lane: {"x": lanes[lane][0], "y": lanes[lane][1], "id": i}  # noqa: E731
    send = lambda kind, points: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})  # noqa: E731
    # A) finger stays down through Pause + resume countdown
    send("touchStart", [pt(1, 0)])
    page.wait_for_timeout(120)
    page.evaluate("window.__beatdashBack()")
    page.wait_for_selector(".pause-overlay")
    page.wait_for_timeout(150)
    check("touch Hold: the finger is still tracked while the Pause overlay is on top of it", pressed() == "1000", pressed())
    page.get_by_role("button", name="계속하기").click()
    page.wait_for_selector(".resume-countdown", state="detached", timeout=6000)
    page.wait_for_timeout(150)
    check("touch Hold: the finger is still pressed after the 3-2-1 resume", pressed() == "1000", pressed())
    send("touchEnd", [pt(1, 0)])
    page.wait_for_timeout(120)
    check("touch Hold: lifting afterwards releases the lane (no stuck lane)", pressed() == "0000", pressed())
    # B) finger lifts while paused
    send("touchStart", [pt(2, 1)])
    page.wait_for_timeout(120)
    page.evaluate("window.__beatdashBack()")
    page.wait_for_selector(".pause-overlay")
    send("touchEnd", [pt(2, 1)])
    page.wait_for_timeout(150)
    check("touch Hold: a finger lifted under the Pause overlay is released", pressed() == "0000", pressed())
    page.get_by_role("button", name="계속하기").click()
    page.wait_for_selector(".resume-countdown", state="detached", timeout=6000)
    page.wait_for_timeout(150)
    check("touch Hold: nothing is stuck after resuming", pressed() == "0000", pressed())
    # C) touchCancel while paused
    send("touchStart", [pt(3, 2)])
    page.wait_for_timeout(120)
    page.evaluate("window.__beatdashBack()")
    page.wait_for_selector(".pause-overlay")
    send("touchCancel", [])
    page.wait_for_timeout(150)
    check("touch Hold: pointercancel under the Pause overlay releases the lane", pressed() == "0000", pressed())
    page.get_by_role("button", name="계속하기").click()
    page.wait_for_selector(".resume-countdown", state="detached", timeout=6000)


def wait_db(page: Page, predicate: str, timeout: float = 20) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = page.evaluate("""async () => {
          const d = await new Promise(r => { const q = indexedDB.open('BEATDASH_DB'); q.onsuccess = () => r(q.result); });
          const read = n => new Promise(r => { const q = d.transaction(n).objectStore(n).getAll(); q.onsuccess = () => r(q.result); });
          const out = { version: d.version, songs: (await read('songs')).map(s => ({id: s.id, fp: s.fingerprint})), charts: (await read('charts')).map(c => ({id: c.id, origin: c.origin, slotKey: c.slotKey, parent: c.parentChartId, cloud: c.cloudChartId, published: c.cloudPublished, notes: c.chart.notes.length})) };
          d.close(); return out; }""")
        if page.evaluate(predicate, state):
            return state
        page.wait_for_timeout(250)
    raise AssertionError(f"db condition not met: {predicate}")


def add_song(page: Page, wav: Path) -> None:
    page.goto(BASE + "/")
    click_text(page, "새 곡 추가 · 파일")
    page.set_input_files('input[type="file"]', str(wav))
    page.select_option('select[aria-label="채보 플랫폼"]', "mobile")
    click_text(page, "AI 채보 생성")
    page.wait_for_selector("button.play-action", timeout=120_000)
    wait_db(page, "s => s.songs.length === 1 && s.charts.length === 1")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="beatdash-phase2-"))
    sys.path.insert(0, str(WEB / "analyzer"))
    import soundfile as sf
    from synth import SR, make_kick_120
    wav = tmp / "phase2-song.wav"
    sf.write(wav, make_kick_120(duration=14.0), SR)
    env = {**os.environ, "COMMUNITY_DB_PATH": str(tmp / "community.sqlite3")}
    server = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", str(PORT)],
                              cwd=WEB, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(BASE + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.25)
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            # ---------- Author: phone, touch ----------
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.accept("Phase2 review edit") if d.type == "prompt" else d.accept())
            page.goto(BASE + "/")
            click_text(page, "새 곡 추가 · 파일")
            check("Upload UI shows MASTER", page.locator(".difficulty-grid button", has_text="MASTER").count() == 1 and page.locator("text=Extreme").count() == 0)
            add_song(page, wav)
            click_text(page, "PLAY")
            check_play_layout(page, "phone-390x844-portrait")
            page.wait_for_function("window.__RHYTHM_DEBUG__ && window.__RHYTHM_DEBUG__.gameStarted", timeout=20000)
            multitouch(page)
            touch_hold_across_pause(page)
            check_pause_menu(page, "phone-390x844")
            handled = page.evaluate("window.__beatdashBack()")
            check("Back during play opens Pause (handled in page)", handled is True and page.locator(".pause-overlay").count() == 1)
            page.keyboard.press("Escape")
            page.wait_for_selector(".resume-countdown", state="detached", timeout=5000)
            for w, h in SIZES[:3]:
                page.set_viewport_size({"width": w, "height": h})
                check_play_layout(page, f"touch-{w}x{h}-portrait")
                page.set_viewport_size({"width": h, "height": w})
                check_play_layout(page, f"touch-{h}x{w}-landscape")
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_selector(".result-screen", timeout=40_000)
            page.wait_for_timeout(300)
            retry = page.get_by_role("button", name="RETRY")
            retry.scroll_into_view_if_needed()
            check("result screen reachable inside fullscreen play page", retry.is_visible())
            page.screenshot(path=str(OUT / "phone-result.png"))

            # ---------- Maker ----------
            page.goto(BASE + "/?view=library")
            page.locator(".library-row").first.click()
            page.get_by_role("button", name="EDIT · Maker (복제본 생성)").click()
            page.wait_for_selector(".maker-page")
            check("Maker opens with SAVE disabled for the untouched AI copy", page.get_by_role("button", name="변경 없음").is_disabled())
            page.locator('input[aria-label="타임라인"]').fill("3")
            page.get_by_role("button", name="＋ K").click()
            page.locator('input[aria-label="타임라인"]').fill("6.5")
            page.get_by_role("button", name="＋ D").click()
            page.get_by_role("button", name="Undo").click()
            page.get_by_role("button", name="Redo").click()
            page.screenshot(path=str(OUT / "maker-phone.png"), full_page=True)
            page.get_by_role("button", name="SAVE").click()
            state = wait_db(page, "s => s.charts.some(c => c.origin === 'MANUAL_EDITED')")
            ai = next(c for c in state["charts"] if c["origin"] == "AI_GENERATED")
            human = next(c for c in state["charts"] if c["origin"] == "MANUAL_EDITED")
            check("DB upgraded to v5", state["version"] == 5)
            check("human edit is a separate chart linked to the AI original", human["parent"] == ai["id"] and human["id"] != ai["id"] and human["notes"] == ai["notes"] + 2)
            check("AI slot unchanged", ai["slotKey"] == "hard:mobile")
            page.get_by_role("button", name="TEST PLAY").click()
            check_play_layout(page, "maker-testplay-390x844")
            page.wait_for_function("window.__RHYTHM_DEBUG__ && window.__RHYTHM_DEBUG__.gameStarted", timeout=20000)
            page.keyboard.press("Escape")
            page.get_by_role("button", name="Maker로 돌아가기").click()
            page.wait_for_selector(".maker-page")
            page.get_by_role("button", name="← 곡 상세").click()
            page.wait_for_selector(".chart-tools-panel")
            page.get_by_role("button", name="COMMUNITY 공유").click()
            page.wait_for_selector("text=Community에 공유했습니다.")
            state = wait_db(page, "s => s.charts.some(c => c.origin === 'MANUAL_EDITED' && c.published && c.cloud)")
            check("shared edit is marked published with a cloud ID", True)

            # ---------- Blank chart on the existing song ----------
            page.get_by_role("button", name="빈 채보로 Maker 시작").click()
            page.wait_for_selector(".maker-page")
            check("blank Maker starts with SAVE disabled and no notes", page.get_by_role("button", name="SAVE").is_disabled() and page.locator(".maker-note").count() == 0)
            page.get_by_role("button", name="＋ F").click()
            page.get_by_role("button", name="SAVE").click()
            state = wait_db(page, "s => s.charts.filter(c => c.origin === 'MANUAL_EDITED').length === 2")
            blank = next(c for c in state["charts"] if c["origin"] == "MANUAL_EDITED" and c["id"] != human["id"])
            check("blank chart is stored as its own user chart without a parent", blank["parent"] in (None, "") and blank["notes"] == 1, blank)
            check("AI original untouched by the blank chart", next(c for c in state["charts"] if c["origin"] == "AI_GENERATED")["notes"] == ai["notes"])
            page.get_by_role("button", name="← 곡 상세").click()
            page.wait_for_selector(".chart-tools-panel")

            # ---------- Another user downloads it ----------
            other = browser.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, has_touch=True, device_scale_factor=2.6)
            page2 = other.new_page()
            page2.on("pageerror", lambda e: errors.append(str(e)))
            add_song(page2, wav)
            page2.goto(BASE + "/")
            click_text(page2, "COMMUNITY · 공유 채보")
            page2.wait_for_selector(".community-row")
            page2.locator('[role="radio"]', has_text="DESKTOP").click()
            page2.wait_for_selector("text=조건에 맞는 공유 채보가 없습니다.")
            page2.locator('[role="radio"]', has_text="MOBILE").click()
            page2.locator(".community-row").first.click()
            check("same media is matched exactly", page2.locator("text=같은 미디어 파일").count() == 1)
            page2.screenshot(path=str(OUT / "community-phone.png"), full_page=True)
            page2.get_by_role("button", name="다운로드 → Library에 추가").click()
            page2.wait_for_selector(".chart-tools-panel")
            state2 = wait_db(page2, "s => s.charts.some(c => c.origin === 'COMMUNITY')")
            check("download added a COMMUNITY chart next to the AI chart", sorted(c["origin"] for c in state2["charts"]) == ["AI_GENERATED", "COMMUNITY"])
            check("downloaded chart has the edited note count", next(c for c in state2["charts"] if c["origin"] == "COMMUNITY")["notes"] == human["notes"])
            page2.get_by_role("button", name="PLAY").first.click()
            check_play_layout(page2, "community-play-412x915")
            check("community play is labelled", page2.locator(".start-play-label", has_text="COMMUNITY").count() == 1)
            page2.wait_for_selector(".result-screen", timeout=40_000)
            other.close()

            # ---------- Desktop window ----------
            desk = browser.new_context(viewport={"width": 1920, "height": 1080})
            page3 = desk.new_page()
            page3.on("pageerror", lambda e: errors.append(str(e)))
            page3.on("dialog", lambda d: d.accept())
            add_song(page3, wav)
            click_text(page3, "PLAY")
            for w, h in SIZES[3:]:
                page3.set_viewport_size({"width": w, "height": h})
                check_play_layout(page3, f"desktop-{w}x{h}")
            page3.wait_for_function("window.__RHYTHM_DEBUG__ && window.__RHYTHM_DEBUG__.gameStarted", timeout=20000)
            check_pause_menu(page3, "desktop-2560x1440")
            page3.keyboard.press("Escape")
            check("fullscreen toggle offered in the desktop Pause menu", page3.locator(".pause-overlay .fullscreen-toggle").count() == 1)
            page3.get_by_role("button", name="곡 리스트로 돌아가기").click()
            page3.wait_for_selector(".library-page")
            check("Pause -> 곡 리스트로 돌아가기 lands on the Library with no media left", page3.locator("audio,video").count() == 0)
            desk.close()
            ctx.close()
            browser.close()
        check("no uncaught page errors", not errors, errors)
    finally:
        server.terminate()
        server.wait(timeout=10)
    (OUT / "summary.json").write_text(json.dumps({"checks": checks, "errors": errors}, ensure_ascii=False, indent=2))
    print(f"\n{len(checks)} checks passed")


if __name__ == "__main__":
    main()
