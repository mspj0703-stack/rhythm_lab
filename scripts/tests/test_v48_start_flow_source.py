import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class V48StartFlowSourceTests(unittest.TestCase):
    def test_redundant_start_contract_is_removed(self):
        game = (ROOT / "web/src/components/GameScreen.tsx").read_text()
        app = (ROOT / "web/src/App.tsx").read_text()
        self.assertNotIn("requireStartGesture", game)
        self.assertNotIn("requireStartGesture", app)
        self.assertNotIn(">START<", game)
        self.assertIn('type StartupPhase = "preparing" | "countdown" | "playing"', game)

    def test_countdown_is_media_ready_and_lifecycle_gated(self):
        game = (ROOT / "web/src/components/GameScreen.tsx").read_text()
        for token in (
            "mediaPrepared",
            "mediaError",
            "lifecycleBlocked",
            "document.hidden",
            "startupGeneration",
            'window.addEventListener("beatdash:pause"',
            'window.addEventListener("beatdash:resume"',
        ):
            self.assertIn(token, game)
        self.assertIn("const loopActive = gameStarted && !songEnded", game)
        # Initial media-error retry must return through prepare/countdown instead of bypassing it.
        self.assertIn('setMediaPrepared(false)', game)
        self.assertIn('setStartupPhase("preparing")', game)

    def test_note_speed_remains_visual_only_contract(self):
        game = (ROOT / "web/src/components/GameScreen.tsx").read_text()
        self.assertIn("시각적 스크롤만 바꾸고 chart/media/judgement time은 바꾸지 않는다", game)
        self.assertIn("applyTimingOffsetSec(mediaTimeSec, lockedTimingOffsetMs)", game)


if __name__ == "__main__":
    unittest.main()
