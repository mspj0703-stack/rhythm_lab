import pathlib, re, unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
class VersionSourceTests(unittest.TestCase):
 def test_single_release_source_propagation(self):
  version=(ROOT/'web/VERSION').read_text().strip(); self.assertRegex(version,r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')
  backend=(ROOT/'web/backend/app.py').read_text(); deploy=(ROOT/'.github/workflows/deploy-railway.yml').read_text(); android_workflow=(ROOT/'.github/workflows/build-android.yml').read_text(); verify=(ROOT/'scripts/verify_container.sh').read_text(); gradle=(ROOT/'android/app/build.gradle.kts').read_text(); play=(ROOT/'android/app/src/main/java/com/rhythmlab/companion/PlayActivity.kt').read_text(); main=(ROOT/'web/src/main.tsx').read_text()
  self.assertIn('ROOT / "VERSION"',backend); self.assertIn('web/VERSION',deploy); self.assertIn('web/VERSION',android_workflow); self.assertIn('web/VERSION',verify); self.assertIn('../web/VERSION',gradle); self.assertIn('__BEATDASH_VERSION__',play); self.assertIn('__BEATDASH_VERSION__',main); self.assertIn("versionName='$EXPECTED_VERSION'",android_workflow)
  for text in (backend,deploy,verify,gradle,android_workflow,play,main):
   self.assertNotIn('"4.0.0"',text); self.assertNotIn('"4.75.0-rc.phase1"',text); self.assertNotIn('"4.75.0-rc.phase2"',text)
 def test_workflow_has_no_literal_release_comparison(self):
  text=(ROOT/'.github/workflows/deploy-railway.yml').read_text(); self.assertNotRegex(text,r'health\.get\(["\']version["\']\)\s*==\s*["\']\d')
if __name__=='__main__': unittest.main()
