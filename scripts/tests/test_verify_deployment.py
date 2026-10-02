import importlib.util
import io
import pathlib
import sys
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

P = pathlib.Path(__file__).resolve().parents[1] / "verify_deployment.py"
spec = importlib.util.spec_from_file_location("verify_deployment", P)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)

class VerifyDeploymentTests(unittest.TestCase):
    def test_pass(self):
        self.assertTrue(m.evaluate({"ok": True, "version": "5.0.0", "revision": "abc"}, "5.0.0", "abc").ok)

    def test_version_mismatch(self):
        self.assertEqual(m.evaluate({"ok": True, "version": "4.0.0", "revision": "abc"}, "5.0.0", "abc").reason, "Version mismatch")

    def test_revision_mismatch(self):
        self.assertEqual(m.evaluate({"ok": True, "version": "5.0.0", "revision": "old"}, "5.0.0", "abc").reason, "Revision mismatch")

    def test_health_not_ok(self):
        self.assertIn("Health OK", m.evaluate({"ok": False, "version": "5.0.0", "revision": "abc"}, "5.0.0", "abc").reason)

    def _run_main(self, payload_or_error, *extra):
        argv = ["verify_deployment.py", "--url", "https://example.test/api/health", "--expected-version", "5.0.0", "--expected-revision", "abc", *extra]
        out, err = io.StringIO(), io.StringIO()
        effect = payload_or_error if isinstance(payload_or_error, Exception) else None
        with mock.patch.object(sys, "argv", argv), mock.patch.object(m, "fetch", side_effect=effect, return_value=None if effect else payload_or_error), redirect_stdout(out), redirect_stderr(err):
            code = m.main()
        return code, out.getvalue(), err.getvalue()

    def test_endpoint_connection_failure_is_distinct(self):
        code, out, _ = self._run_main(urllib.error.URLError("offline"), "--attempts", "1", "--interval", "0")
        self.assertEqual(code, 3)
        self.assertIn("Health endpoint connection failure", out)
        self.assertIn("Expected version: 5.0.0", out)
        self.assertIn("Actual version: <unavailable>", out)

    def test_stable_healthy_version_mismatch_fails_early(self):
        payload = {"ok": True, "version": "wrong", "revision": "abc"}
        code, out, err = self._run_main(payload, "--attempts", "60", "--interval", "0", "--stable-mismatch-limit", "2")
        self.assertEqual(code, 2)
        self.assertEqual(out.count("Attempt:"), 2)
        self.assertIn("Failing early", err)

if __name__ == "__main__":
    unittest.main()
