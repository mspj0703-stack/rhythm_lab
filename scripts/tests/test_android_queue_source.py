import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
ANDROID = ROOT / "android/app/src/main"

class AndroidQueueSourceTests(unittest.TestCase):
    def test_manifest_declares_data_sync_foreground_service(self):
        tree = ET.parse(ANDROID / "AndroidManifest.xml")
        root = tree.getroot()
        ns = "{http://schemas.android.com/apk/res/android}"
        permissions = {p.attrib.get(ns + "name") for p in root.findall("uses-permission")}
        self.assertIn("android.permission.FOREGROUND_SERVICE", permissions)
        self.assertIn("android.permission.FOREGROUND_SERVICE_DATA_SYNC", permissions)
        services = root.find("application").findall("service")
        service = next(s for s in services if s.attrib.get(ns + "name") == ".ChartJobService")
        self.assertEqual(service.attrib.get(ns + "foregroundServiceType"), "dataSync")

    def test_queue_is_persistent_serial_and_does_not_force_play(self):
        store = (ANDROID / "java/com/rhythmlab/companion/ChartJobStore.kt").read_text()
        service = (ANDROID / "java/com/rhythmlab/companion/ChartJobService.kt").read_text()
        main = (ANDROID / "java/com/rhythmlab/companion/MainActivity.kt").read_text()
        engine = (ANDROID / "java/com/rhythmlab/companion/YoutubeEngine.kt").read_text()
        self.assertIn('"chart_jobs.json"', store)
        self.assertIn("newSingleThreadExecutor", service)
        self.assertIn("NEEDS_RETRY", store)
        self.assertIn("중복 방지를 위해 수동 재시도", store)
        self.assertIn("rhythm_media_extract-$safeWorkId", engine)
        self.assertIn("batchUrlInput", main)
        self.assertNotIn("openSong(song.id)", service)

    def test_phase2_service_handles_android_15_timeout(self):
        service = (ANDROID / "java/com/rhythmlab/companion/ChartJobService.kt").read_text()
        self.assertIn("override fun onTimeout(startId: Int, fgsType: Int)", service)
        self.assertIn("Android 백그라운드 실행 시간 제한", service)

if __name__ == "__main__":
    unittest.main()
