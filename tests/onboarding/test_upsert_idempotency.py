import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/onboarding/onboard_client.py"
SPEC = importlib.util.spec_from_file_location("onboard_client_upsert_test", MODULE_PATH)
ONBOARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ONBOARD)


class OnboardingUpsertTest(unittest.TestCase):
    def setUp(self):
        self.state = Mock()
        self.row = {"id": "tenant-item-1", "client_id": "tenant"}

    def test_existing_row_is_not_written(self):
        with patch.object(ONBOARD, "_get", return_value=(200, [{"id": self.row["id"]}])), \
             patch.object(ONBOARD, "_post") as post:
            result = ONBOARD._upsert(
                "https://rest.test", "items", self.row, "id", {}, self.state, "items", False,
            )
        self.assertEqual(result, "ALREADY_EXISTS")
        post.assert_not_called()

    def test_duplicate_after_stale_read_reconciles_without_overwrite(self):
        with patch.object(
            ONBOARD, "_get",
            side_effect=[(200, []), (200, [{"id": self.row["id"]}])],
        ), patch.object(
            ONBOARD, "_post", return_value=(409, {"code": "23505"}),
        ):
            result = ONBOARD._upsert(
                "https://rest.test", "items", self.row, "id", {}, self.state, "items", False,
            )
        self.assertEqual(result, "ALREADY_EXISTS")
        self.state.record_created.assert_not_called()

    def test_read_error_fails_closed_before_write(self):
        with patch.object(ONBOARD, "_get", return_value=(503, {"message": "unavailable"})), \
             patch.object(ONBOARD, "_post") as post:
            result = ONBOARD._upsert(
                "https://rest.test", "items", self.row, "id", {}, self.state, "items", False,
            )
        self.assertEqual(result, "FAILED")
        post.assert_not_called()

    def test_compound_duplicate_reconciles(self):
        row = {"client_id": "tenant", "item_id": "item", "group_id": "group"}
        with patch.object(
            ONBOARD, "_get", side_effect=[(200, []), (200, [{"client_id": "tenant"}])],
        ), patch.object(
            ONBOARD, "_post", return_value=(409, {"code": "23505"}),
        ):
            result = ONBOARD._upsert_compound(
                "https://rest.test", "links", row,
                ["client_id", "item_id", "group_id"], {}, self.state, "links", False,
            )
        self.assertEqual(result, "ALREADY_EXISTS")


if __name__ == "__main__":
    unittest.main()
