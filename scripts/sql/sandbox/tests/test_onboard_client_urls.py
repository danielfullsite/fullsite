import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "onboard_client.py"
SPEC = importlib.util.spec_from_file_location("onboard_client", MODULE_PATH)
onboard = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(onboard)


class _State:
    def record(self, *_args):
        pass


class _Log:
    def item(self, *_args, **_kwargs):
        pass


class RestUrlTests(unittest.TestCase):
    def test_dry_run_never_calls_auth_admin_api(self):
        with patch.object(onboard, "post") as post_mock:
            status, user = onboard.create_auth_user(
                "https://sandbox.supabase.co/auth/v1", "demo@example.com", "secret", "service-key", True
            )

        self.assertEqual(status, onboard.SKIPPED)
        self.assertIsNone(user)
        post_mock.assert_not_called()

    def test_upsert_row_does_not_duplicate_rest_prefix(self):
        rest_url = "https://sandbox.supabase.co/rest/v1"
        with patch.object(onboard, "get", return_value=(200, [])) as get_mock, \
             patch.object(onboard, "post", return_value=(201, [{}])) as post_mock:
            status, _ = onboard.upsert_row(
                rest_url, "clients", {"id": "demo"}, "id", {}, _State(), "clients", _Log(), False
            )

        self.assertEqual(status, onboard.CREATED)
        self.assertEqual(get_mock.call_args.args[0], f"{rest_url}/clients?id=eq.demo&select=id&limit=1")
        self.assertEqual(post_mock.call_args.args[0], f"{rest_url}/clients")
        self.assertNotIn("/rest/v1/rest/v1/", post_mock.call_args.args[0])

    def test_compound_upsert_does_not_duplicate_rest_prefix(self):
        rest_url = "https://sandbox.supabase.co/rest/v1"
        row = {"item_id": "item", "group_id": "group"}
        with patch.object(onboard, "get", return_value=(200, [])) as get_mock, \
             patch.object(onboard, "post", return_value=(201, [{}])) as post_mock:
            status = onboard.upsert_compound_pk(
                rest_url, "links", row, ["item_id", "group_id"], {}, _State(), "links", _Log(), False
            )

        self.assertEqual(status, onboard.CREATED)
        self.assertTrue(get_mock.call_args.args[0].startswith(f"{rest_url}/links?"))
        self.assertEqual(post_mock.call_args.args[0], f"{rest_url}/links")


if __name__ == "__main__":
    unittest.main()
