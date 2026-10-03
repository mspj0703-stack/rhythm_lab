import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]

class V48AndroidSourceTests(unittest.TestCase):
    def test_home_layout_is_card_based_and_keeps_queue_ids(self):
        layout = ROOT / "android/app/src/main/res/layout/activity_main.xml"
        ET.parse(layout)
        text = layout.read_text()
        for token in ("contentContainer", "queueSummary", "jobQueue", "batchAddButton", "libraryButton", "settingsButton"):
            self.assertIn(token, text)
        self.assertIn("@drawable/bg_card", text)

    def test_queue_logic_is_preserved(self):
        text = (ROOT / "android/app/src/main/java/com/rhythmlab/companion/MainActivity.kt").read_text()
        for token in ("ChartJobStore", "ChartJobService.start", "ChartJobService.retry", "ChartJobService.cancel", "recoverInterrupted"):
            self.assertIn(token, text)
        self.assertIn("applyResponsiveContentWidth", text)

    def test_webview_version_gate_prevents_stale_remote_ui(self):
        play = (ROOT / "android/app/src/main/java/com/rhythmlab/companion/PlayActivity.kt").read_text()
        main = (ROOT / "web/src/main.tsx").read_text()
        self.assertIn("WebSettings.LOAD_NO_CACHE", play)
        self.assertIn("View.INVISIBLE", play)
        self.assertIn("__BEATDASH_VERSION__", play)
        self.assertIn("__BEATDASH_VERSION__", main)
        self.assertIn("beatdash:resume", play)

    def test_native_cover_guardrails(self):
        play = (ROOT / "android/app/src/main/java/com/rhythmlab/companion/PlayActivity.kt").read_text()
        for mime in ("image/jpeg", "image/png", "image/webp"):
            self.assertIn(mime, play)
        self.assertIn("12 * 1024 * 1024", play)
        self.assertIn("beatdash:native-cover-error", play)
        detail = (ROOT / "web/src/components/v4/SongDetailScreen.tsx").read_text()
        self.assertIn("beatdash:native-cover-error", detail)

    def test_data_paths_have_no_destructive_migration_calls(self):
        candidates = [
            ROOT / "web/src/library/db.ts",
            ROOT / "android/app/src/main/java/com/rhythmlab/companion/SavedSongStore.kt",
            ROOT / "android/app/src/main/java/com/rhythmlab/companion/ChartJobStore.kt",
        ]
        combined = "\
".join(p.read_text() for p in candidates)
        self.assertNotIn("deleteDatabase(", combined)
        self.assertNotIn("fallbackToDestructiveMigration", combined)

    def test_feedback_route_is_reachable_from_settings(self):
        app = (ROOT / "web/src/App.tsx").read_text()
        settings = (ROOT / "web/src/components/v4/SettingsScreen.tsx").read_text()
        self.assertIn('view === "feedback"', app)
        self.assertIn('nav("feedback")', app)
        self.assertIn("onFeedback", settings)

if __name__ == "__main__":
    unittest.main()
