import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/sql/tests/isolation_test.py"
SPEC = importlib.util.spec_from_file_location("tenant_isolation_runner_test", MODULE_PATH)
ISOLATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ISOLATION)


class IsolationRunnerCredentialBoundaryTest(unittest.TestCase):
    def setUp(self):
        ISOLATION.ANON_KEY = "anon-test-key"
        ISOLATION.SERVICE_KEY = "service-test-key"

    @patch.object(ISOLATION.requests, "post")
    def test_sign_in_uses_anon_apikey(self, post):
        post.return_value = Mock(status_code=200)
        post.return_value.json.return_value = {"access_token": "user-jwt"}
        self.assertEqual(ISOLATION.sign_in("user@test", "password"), "user-jwt")
        headers = post.call_args.kwargs["headers"]
        self.assertEqual(headers["apikey"], "anon-test-key")
        self.assertNotIn("service-test-key", headers.values())

    @patch.object(ISOLATION.requests, "get")
    def test_authenticated_request_uses_anon_apikey_and_user_jwt(self, get):
        get.return_value = Mock(status_code=200)
        get.return_value.json.return_value = []
        ISOLATION.authed_get("real-user-jwt", "clients")
        headers = get.call_args.kwargs["headers"]
        self.assertEqual(headers["apikey"], "anon-test-key")
        self.assertEqual(headers["Authorization"], "Bearer real-user-jwt")

    @patch.object(ISOLATION.requests, "get")
    def test_anon_request_is_actually_anon(self, get):
        get.return_value = Mock(status_code=401)
        get.return_value.json.return_value = {"message": "denied"}
        ISOLATION.anon_get("clients")
        headers = get.call_args.kwargs["headers"]
        self.assertEqual(headers["apikey"], "anon-test-key")
        self.assertEqual(headers["Authorization"], "Bearer anon-test-key")


if __name__ == "__main__":
    unittest.main()
