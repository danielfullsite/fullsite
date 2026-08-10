import importlib.util
import ssl
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/onboarding/onboard_client.py"
SPEC = importlib.util.spec_from_file_location("onboard_client_auth_test", MODULE_PATH)
ONBOARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ONBOARD)


class ExistingAuthUserResolutionTest(unittest.TestCase):
    def test_onboarding_tls_is_verified(self):
        self.assertEqual(ONBOARD._SSL.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(ONBOARD._SSL.check_hostname)

    def test_finds_existing_owner_beyond_first_page(self):
        pages = [
            (200, {"users": [{"id": "u-1", "email": "other@example.test"}]}),
            (200, {"users": [{"id": "owner-id", "email": "OWNER@example.test"}]}),
        ]
        with patch.object(ONBOARD, "_req", side_effect=pages) as request:
            uid = ONBOARD._find_auth_user_id_by_email(
                "https://auth.test", {}, "owner@example.test", per_page=1,
            )
        self.assertEqual(uid, "owner-id")
        self.assertIn("page=2", request.call_args_list[1].args[1])

    def test_stops_after_short_final_page(self):
        with patch.object(
            ONBOARD, "_req", return_value=(200, {"users": []}),
        ) as request:
            uid = ONBOARD._find_auth_user_id_by_email(
                "https://auth.test", {}, "missing@example.test",
            )
        self.assertIsNone(uid)
        request.assert_called_once()

    def test_fails_closed_on_admin_api_error(self):
        with patch.object(
            ONBOARD, "_req", return_value=(503, {"message": "unavailable"}),
        ):
            uid = ONBOARD._find_auth_user_id_by_email(
                "https://auth.test", {}, "owner@example.test",
            )
        self.assertIsNone(uid)


if __name__ == "__main__":
    unittest.main()
