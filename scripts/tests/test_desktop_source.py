from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DesktopSourceTests(unittest.TestCase):
    def test_desktop_structure_exists(self):
        required = [
            ROOT / "desktop/package.json",
            ROOT / "desktop/src-tauri/Cargo.toml",
            ROOT / "desktop/src-tauri/tauri.conf.json",
            ROOT / "desktop/src-tauri/src/main.rs",
            ROOT / ".github/workflows/build-desktop-windows.yml",
            ROOT / "web/src/platform/runtime.ts",
        ]
        for path in required:
            self.assertTrue(path.is_file(), path)

    def test_desktop_reads_release_version_and_service_url(self):
        source = (ROOT / "desktop/src-tauri/src/main.rs").read_text(encoding="utf-8")
        self.assertIn('include_str!("../../../web/VERSION")', source)
        self.assertIn('include_str!("../../../web/SERVICE_URL")', source)
        self.assertNotIn("web-production-e18dd", source)

    def test_android_uses_shared_service_url(self):
        api = (ROOT / "android/app/src/main/java/com/rhythmlab/companion/RhythmApi.kt").read_text(encoding="utf-8")
        gradle = (ROOT / "android/app/build.gradle.kts").read_text(encoding="utf-8")
        self.assertIn("BuildConfig.BEATDASH_SERVICE_URL", api)
        self.assertNotIn("https://web-production", api)
        self.assertIn('../web/SERVICE_URL', gradle)

    def test_tauri_config_is_parseable_and_nsis_enabled(self):
        cfg = json.loads((ROOT / "desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        self.assertEqual(cfg["identifier"], "com.beatdash.desktop")
        self.assertIn("nsis", cfg["bundle"]["targets"])

    def test_platform_layer_knows_desktop(self):
        source = (ROOT / "web/src/platform/runtime.ts").read_text(encoding="utf-8")
        self.assertIn('"DESKTOP"', source)
        self.assertIn('params.get("platform")', source)


if __name__ == "__main__":
    unittest.main()
