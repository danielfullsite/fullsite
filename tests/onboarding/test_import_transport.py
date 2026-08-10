import importlib.util
import ssl
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, relative: str):
    module_dir = str((ROOT / relative).parent)
    if module_dir not in sys.path:
        sys.path.insert(0, module_dir)
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ImportTransportTest(unittest.TestCase):
    def test_menu_import_requires_certificate_verification(self):
        module = load_module("menu_import", "scripts/onboarding/menu_import.py")
        self.assertEqual(module._SSL_CTX.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(module._SSL_CTX.check_hostname)

    def test_staff_import_requires_certificate_verification(self):
        module = load_module("staff_import", "scripts/onboarding/staff_import.py")
        self.assertEqual(module._SSL_CTX.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(module._SSL_CTX.check_hostname)

    def test_diff_report_requires_certificate_verification(self):
        module = load_module("diff_report", "scripts/onboarding/diff_report.py")
        self.assertEqual(module._SSL_CTX.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(module._SSL_CTX.check_hostname)

    def test_authenticated_import_uses_anon_apikey_and_real_access_token(self):
        contract = load_module("contract_auth", "scripts/onboarding/contract.py")
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_SERVICE_KEY": "",
                "SUPABASE_ANON_KEY": "public-anon",
                "SUPABASE_ACCESS_TOKEN": "real-user-jwt",
            },
            clear=False,
        ):
            headers, mode = contract.resolve_db_headers()
        self.assertEqual(mode, "authenticated_rls")
        self.assertEqual(headers["apikey"], "public-anon")
        self.assertEqual(headers["Authorization"], "Bearer real-user-jwt")

    def test_import_never_falls_back_to_anon_only(self):
        contract = load_module("contract_fail_closed", "scripts/onboarding/contract.py")
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_SERVICE_KEY": "",
                "SUPABASE_ANON_KEY": "public-anon",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": "",
                "SUPABASE_ACCESS_TOKEN": "",
            },
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                contract.resolve_db_headers()

    def test_menu_dry_run_propagates_synthetic_category_identity(self):
        module = load_module("menu_import_dry", "scripts/onboarding/menu_import.py")

        class MemoryState:
            data = {"cats": {}, "items": {}, "links": {}}

            @staticmethod
            def cat_done(_name):
                return False

            @staticmethod
            def get_cat_id(name):
                return MemoryState.data["cats"].get(name)

        state = MemoryState()
        category_id = module.upsert_category(
            "https://invalid.local/rest/v1",
            "tenant-a",
            "Postres",
            1,
            {},
            state,
            True,
            lambda _message: None,
        )
        self.assertEqual(category_id, "dry-run-cat-1")
        self.assertEqual(state.get_cat_id("Postres"), category_id)

    def test_staff_import_queries_canonical_client_id_not_missing_slug(self):
        source = (ROOT / "scripts/onboarding/staff_import.py").read_text()
        self.assertIn('"id": f"eq.{args.client_id}"', source)
        self.assertIn('"select": "id,display_name"', source)
        self.assertNotIn('"slug": f"eq.{args.client_id}"', source)

    def test_menu_insert_supplies_required_category_and_item_ids(self):
        module = load_module("menu_import_ids", "scripts/onboarding/menu_import.py")

        class MemoryState:
            data = {"cats": {}, "items": {}, "links": {}}

            @staticmethod
            def cat_done(_name): return False

            @staticmethod
            def item_done(_key): return False

            @staticmethod
            def record_cat(name, value): MemoryState.data["cats"][name] = value

            @staticmethod
            def record_item(name, value): MemoryState.data["items"][name] = value

        payloads = []

        def fake_post(_url, body, _headers):
            payloads.append(body)
            return 201, [{"id": body["id"]}]

        with patch.object(module, "get", return_value=(200, [])), patch.object(module, "post", side_effect=fake_post):
            category_id = module.upsert_category(
                "rest", "tenant-a", "Postres", 1, {}, MemoryState(), False, lambda _m: None
            )
            item_id = module.upsert_item(
                "rest",
                "tenant-a",
                category_id,
                {"category": "Postres", "name": "Tarta", "price": 75, "active": True},
                1,
                {},
                MemoryState(),
                False,
                lambda _m: None,
            )

        self.assertTrue(category_id)
        self.assertTrue(item_id)
        self.assertEqual(len(payloads), 2)
        self.assertTrue(all(payload.get("id") for payload in payloads))

    def test_staff_rerun_preserves_existing_auto_assigned_pin(self):
        module = load_module("staff_import_pin", "scripts/onboarding/staff_import.py")
        used = {"4321"}
        self.assertEqual(module.choose_pin(None, {"pin": "4321"}, used), "4321")
        self.assertEqual(module.choose_pin("9002", {"pin": "4321"}, used), "9002")


if __name__ == "__main__":
    unittest.main()
