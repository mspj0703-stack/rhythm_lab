"""v5 Phase 2 source contracts: play-time orientation lock, safe-area handling, Community storage, version guard."""
import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
PLAY = ROOT / "android/app/src/main/java/com/rhythmlab/companion/PlayActivity.kt"


class V5Phase2AndroidSourceTests(unittest.TestCase):
    def test_orientation_bridge_locks_only_during_play(self):
        play = PLAY.read_text()
        self.assertIn('addJavascriptInterface(OrientationBridge(), "BeatdashOrientation")', play)
        self.assertIn("SCREEN_ORIENTATION_LOCKED", play)
        self.assertIn("SCREEN_ORIENTATION_UNSPECIFIED", play)
        self.assertIn("isTrustedPage()", play)
        # Released on new page loads and on Activity destruction (abnormal-exit cleanup).
        started = play[play.index("override fun onPageStarted"):play.index("override fun onPageFinished")]
        self.assertIn("exitPlayMode()", started)
        destroy = play[play.index("override fun onDestroy"):]
        self.assertIn("exitPlayMode()", destroy)

    def test_app_is_never_globally_orientation_locked(self):
        manifest = ET.parse(ROOT / "android/app/src/main/AndroidManifest.xml").getroot()
        for activity in manifest.iter("activity"):
            self.assertIsNone(activity.get(f"{ANDROID_NS}screenOrientation"), activity.get(f"{ANDROID_NS}name"))
        play = next(a for a in manifest.iter("activity") if a.get(f"{ANDROID_NS}name") == ".PlayActivity")
        changes = play.get(f"{ANDROID_NS}configChanges") or ""
        for flag in ("orientation", "screenSize"):
            self.assertIn(flag, changes)
        for source in (ROOT / "android/app/src/main/java").rglob("*.kt"):
            text = source.read_text()
            for constant in ("SCREEN_ORIENTATION_PORTRAIT", "SCREEN_ORIENTATION_LANDSCAPE", "SCREEN_ORIENTATION_SENSOR_"):
                self.assertNotIn(constant, text, source.name)

    def test_webview_respects_system_bars_and_cutout(self):
        play = PLAY.read_text()
        self.assertIn("setOnApplyWindowInsetsListener", play)
        self.assertIn("WindowInsetsCompat.Type.displayCutout()", play)
        self.assertIn("WindowInsetsCompat.Type.systemBars()", play)

    def test_existing_bridges_and_version_guard_are_kept(self):
        play = PLAY.read_text()
        for token in ('"BeatdashArtwork"', "__BEATDASH_VERSION__", "shouldInterceptRequest", "beatdash:pause", "beatdash:resume", "versionRetryUsed"):
            self.assertIn(token, play)


class V5Phase2AndroidGameplaySourceTests(unittest.TestCase):
    KT = ROOT / "android/app/src/main/java/com/rhythmlab/companion"

    def test_companion_offers_master_and_sends_internal_extreme(self):
        difficulty = (self.KT / "Difficulty.kt").read_text()
        self.assertIn('Option("extreme", "MASTER")', difficulty)
        for value in ("easy", "normal", "hard", "expert"):
            self.assertIn(f'Option("{value}", "{value.upper()}")', difficulty)
        main = (self.KT / "MainActivity.kt").read_text()
        self.assertIn("Difficulty.OPTIONS", main)
        self.assertNotIn('listOf("Easy", "Normal", "Hard", "Expert")', main)
        self.assertIn("(difficultySpinner.selectedItem as Difficulty.Option).value", main)
        api = (self.KT / "RhythmApi.kt").read_text()
        self.assertIn('Difficulty.normalize(difficulty)', api)
        self.assertIn('addFormDataPart("platform", "mobile")', api)

    def test_back_opens_pause_instead_of_closing_gameplay(self):
        play = PLAY.read_text()
        self.assertIn("__beatdashBack", play)
        back = play[play.index("handleOnBackPressed"):play.index("handleOnBackPressed") + 400]
        self.assertIn("evaluateJavascript(BACK_SCRIPT)", back)
        self.assertIn('if (result != "true") finish()', back)

    def test_long_press_is_suppressed_only_during_play(self):
        play = PLAY.read_text()
        enter = play[play.index("private fun enterPlayMode"):play.index("private fun exitPlayMode")]
        leave = play[play.index("private fun exitPlayMode"):play.index("private val filePicker")]
        self.assertIn("setOnLongClickListener { true }", enter)
        self.assertIn("isLongClickable = false", enter)
        self.assertIn("setOnLongClickListener(null)", leave)
        self.assertIn("isLongClickable = true", leave)


class V5Phase2WebSourceTests(unittest.TestCase):
    def test_viewport_allows_safe_area_insets(self):
        html = (ROOT / "web/index.html").read_text()
        self.assertRegex(html, r'name="viewport"[^>]*viewport-fit=cover')

    def test_web_orientation_lock_is_best_effort_and_skips_desktop(self):
        text = (ROOT / "web/src/platform/orientation.ts").read_text()
        self.assertIn('BEATDASH_PLATFORM === "DESKTOP"', text)
        self.assertIn("BeatdashOrientation", text)
        self.assertIn(".catch", text)

    def test_play_screens_use_fullscreen_layout(self):
        app = (ROOT / "web/src/App.tsx").read_text()
        self.assertEqual(app.count('className="play-page play-fullscreen"'), 2)
        css = (ROOT / "web/src/App.css").read_text()
        self.assertIn("100dvh", css)
        self.assertIn("env(safe-area-inset-top", css)

    def test_community_storage_is_outside_runtime_ttl_cleanup(self):
        app = (ROOT / "web/backend/app.py").read_text()
        cleanup = app[app.index("def _cleanup_runtime"):app.index("def _probe_duration")]
        self.assertNotIn("community", cleanup)
        community = (ROOT / "web/backend/community.py").read_text()
        self.assertIn("COMMUNITY_DB_PATH", community)
        self.assertIsNone(re.search(r"mediaBlob|UploadFile", community))


if __name__ == "__main__":
    unittest.main()
