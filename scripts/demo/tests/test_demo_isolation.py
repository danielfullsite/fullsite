"""
Isolation Gate tests for TSK-005: DEMO-FOUNDATION

Covers all 9 isolation gates (IG-01..IG-09) plus DoD-named tests:
  - test_seed_idempotence          (F-02)
  - test_demo_amalay_isolation     (F-06 / IG-08)
  - test_log_prefix_present        (F-07)

All HTTP calls are mocked via unittest.mock — zero real network access.
"""

import io
import json
import pathlib
import sys
import time
import unittest
from unittest.mock import MagicMock, call, patch

# ─── Make scripts/demo importable ─────────────────────────────────────────────

DEMO_DIR = pathlib.Path(__file__).resolve().parent.parent
if str(DEMO_DIR) not in sys.path:
    sys.path.insert(0, str(DEMO_DIR))

import demo_seed as ds
import demo_reset as dr


# ─── Mock response factory ────────────────────────────────────────────────────

def _ok_response(status_code: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.raise_for_status = MagicMock()
    resp.json.return_value = []
    return resp


def _patch_requests(status: int = 200):
    """Context manager: patch both requests.post and requests.delete and requests.get."""
    ok = _ok_response(status)
    p1 = patch("requests.post", return_value=ok)
    p2 = patch("requests.delete", return_value=ok)
    p3 = patch("requests.get", return_value=ok)
    return p1, p2, p3


# ─── IG-01: Fail-closed for non-demo tenants ─────────────────────────────────

class TestIG01FailClosedNonDemo(unittest.TestCase):
    """IG-01 — seed() and reset() refuse any client_id other than 'demo'."""

    def test_seed_rejects_amalay(self):
        with self.assertRaises(RuntimeError) as ctx:
            ds.seed(seed_val=42, dry_run=True, client_id="amalay")
        self.assertIn("amalay", str(ctx.exception))
        self.assertIn("ABORT", str(ctx.exception))

    def test_seed_rejects_production(self):
        with self.assertRaises(RuntimeError):
            ds.seed(seed_val=42, dry_run=True, client_id="production")

    def test_seed_rejects_empty_string(self):
        with self.assertRaises(RuntimeError):
            ds.seed(seed_val=42, dry_run=True, client_id="")

    def test_seed_accepts_demo(self):
        # Must NOT raise — any exception fails this test
        result = ds.seed(seed_val=42, dry_run=True, client_id="demo")
        self.assertEqual(result["client"]["id"], "demo")

    def test_reset_rejects_non_demo(self):
        with self.assertRaises(RuntimeError):
            dr.reset(dry_run=True, client_id="amalay")

    def test_teardown_rejects_non_demo(self):
        with self.assertRaises(RuntimeError):
            dr.teardown(client_id="amalay", dry_run=True)

    def test_assert_demo_only_helper(self):
        with self.assertRaises(RuntimeError):
            ds._assert_demo_only("nomada")
        # Should not raise
        ds._assert_demo_only("demo")


# ─── IG-02: No production URLs contacted ─────────────────────────────────────

class TestIG02NoProductionURL(unittest.TestCase):
    """IG-02 — _assert_not_production raises on any production URL fragment."""

    def test_blocks_amalay_supabase_url(self):
        with self.assertRaises(RuntimeError) as ctx:
            ds._assert_not_production("https://qjiomlvudfmzuvqvhwpk.supabase.co/rest/v1/clients")
        self.assertIn("ABORT", str(ctx.exception))

    def test_blocks_fullsite_amalay_fragment(self):
        with self.assertRaises(RuntimeError):
            ds._assert_not_production("https://fullsite-amalay.supabase.co/rest/v1/data")

    def test_blocks_generic_unknown_url_when_staging_fragment_enforced(self):
        # When _STAGING_URL_FRAGMENT is set, any non-matching URL is rejected
        import demo_seed
        original = demo_seed._STAGING_URL_FRAGMENT
        demo_seed._STAGING_URL_FRAGMENT = "jkcnxfbbuyyfhwfjizgw"
        try:
            with self.assertRaises(RuntimeError):
                ds._assert_not_production("https://some-other-project.supabase.co/rest/v1/clients")
        finally:
            demo_seed._STAGING_URL_FRAGMENT = original

    def test_staging_url_passes(self):
        # Staging URL (jkcnxfbbuyyfhwfjizgw) must not be blocked
        import demo_seed
        original = demo_seed._STAGING_URL_FRAGMENT
        demo_seed._STAGING_URL_FRAGMENT = ""  # no allowlist enforcement
        try:
            # Should not raise — staging project is not in _PRODUCTION_URL_FRAGMENTS
            ds._assert_not_production("https://jkcnxfbbuyyfhwfjizgw.supabase.co/rest/v1/clients")
        finally:
            demo_seed._STAGING_URL_FRAGMENT = original

    def test_seed_logs_never_contain_production_url(self):
        """F-06: Log output must not contain any production URL fragment."""
        import demo_seed
        original_url = demo_seed.STAGING_SUPABASE_URL
        original_key = demo_seed.STAGING_SUPABASE_KEY
        original_frag = demo_seed._STAGING_URL_FRAGMENT
        demo_seed.STAGING_SUPABASE_URL = ""
        demo_seed._STAGING_URL_FRAGMENT = ""

        buf = io.StringIO()
        try:
            with patch("sys.stdout", buf):
                ds.seed(seed_val=42, dry_run=True, client_id="demo")
        finally:
            demo_seed.STAGING_SUPABASE_URL = original_url
            demo_seed.STAGING_SUPABASE_KEY = original_key
            demo_seed._STAGING_URL_FRAGMENT = original_frag

        output = buf.getvalue()
        for fragment in ds._PRODUCTION_URL_FRAGMENTS:
            self.assertNotIn(fragment, output, f"Production URL fragment '{fragment}' found in log")


# ─── IG-03: All rows have source='SIMULATED' ─────────────────────────────────

class TestIG03AllRowsSimulated(unittest.TestCase):
    """IG-03 — Every generated row has source='SIMULATED'."""

    def setUp(self):
        self.result = ds.seed(seed_val=42, dry_run=True, client_id="demo")

    def _all_rows(self):
        rows = [self.result["client"]]
        rows += self.result["menu_items"]
        rows += self.result["tables"]
        rows += self.result["staff"]
        return rows

    def test_client_has_simulated_source(self):
        self.assertEqual(self.result["client"]["source"], "SIMULATED")

    def test_menu_items_all_simulated(self):
        for item in self.result["menu_items"]:
            self.assertEqual(item["source"], "SIMULATED",
                             f"Menu item '{item['name']}' missing source='SIMULATED'")

    def test_tables_all_simulated(self):
        for table in self.result["tables"]:
            self.assertEqual(table["source"], "SIMULATED")

    def test_staff_all_simulated(self):
        for staff in self.result["staff"]:
            self.assertEqual(staff["source"], "SIMULATED")

    def test_zero_rows_with_non_simulated_source(self):
        """F-04: Assert 0 rows with source != 'SIMULATED'."""
        bad = [r for r in self._all_rows() if r.get("source") != "SIMULATED"]
        self.assertEqual(len(bad), 0, f"Rows with non-SIMULATED source: {bad}")


# ─── IG-04: All rows have environment='DEMO' ─────────────────────────────────

class TestIG04AllRowsDemoEnvironment(unittest.TestCase):
    """IG-04 — Every generated row has environment='DEMO'."""

    def setUp(self):
        self.result = ds.seed(seed_val=42, dry_run=True, client_id="demo")

    def _all_rows(self):
        rows = [self.result["client"]]
        rows += self.result["menu_items"]
        rows += self.result["tables"]
        rows += self.result["staff"]
        return rows

    def test_client_has_demo_environment(self):
        self.assertEqual(self.result["client"]["environment"], "DEMO")

    def test_all_rows_have_demo_environment(self):
        bad = [r for r in self._all_rows() if r.get("environment") != "DEMO"]
        self.assertEqual(len(bad), 0, f"Rows with non-DEMO environment: {bad}")


# ─── IG-05: Idempotent seed ───────────────────────────────────────────────────

class TestIG05IdempotentSeed(unittest.TestCase):
    """IG-05 / F-02 — Two runs with seed=42 produce identical rows."""

    def test_seed_idempotence(self):
        """DoD name: test_seed_idempotence — same IDs and content on every run."""
        run1 = ds.seed(seed_val=42, dry_run=True, client_id="demo")
        run2 = ds.seed(seed_val=42, dry_run=True, client_id="demo")

        # Same number of rows
        self.assertEqual(len(run1["menu_items"]), len(run2["menu_items"]))
        self.assertEqual(len(run1["tables"]), len(run2["tables"]))
        self.assertEqual(len(run1["staff"]), len(run2["staff"]))

        # Same IDs
        ids1 = {item["id"] for item in run1["menu_items"]}
        ids2 = {item["id"] for item in run2["menu_items"]}
        self.assertEqual(ids1, ids2, "Menu item IDs differ between runs")

        staff_ids1 = {s["id"] for s in run1["staff"]}
        staff_ids2 = {s["id"] for s in run2["staff"]}
        self.assertEqual(staff_ids1, staff_ids2, "Staff IDs differ between runs")

        # Same state MD5
        self.assertEqual(run1["state_md5"], run2["state_md5"],
                         "State MD5 differs between runs")

    def test_different_seed_gives_different_ids(self):
        run42 = ds.seed(seed_val=42, dry_run=True, client_id="demo")
        run99 = ds.seed(seed_val=99, dry_run=True, client_id="demo")
        ids42 = {item["id"] for item in run42["menu_items"]}
        ids99 = {item["id"] for item in run99["menu_items"]}
        # Should be different (with overwhelming probability for different seeds)
        self.assertNotEqual(ids42, ids99, "Different seeds should produce different IDs")

    def test_seed_counts_correct(self):
        result = ds.seed(seed_val=42, dry_run=True, client_id="demo")
        self.assertEqual(len(result["menu_items"]), 30, "Expected exactly 30 menu items")
        self.assertEqual(len(result["tables"]), 10, "Expected exactly 10 tables")
        self.assertEqual(len(result["staff"]), 5, "Expected exactly 5 staff")

    def test_client_record_always_identical(self):
        """Client record has no RNG dependency — always identical."""
        r1 = ds._generate_client_record()
        r2 = ds._generate_client_record()
        self.assertEqual(r1, r2)
        self.assertEqual(r1["id"], "demo")
        self.assertEqual(r1["name"], "El Molcajete Demo")
        self.assertEqual(r1["data_source"], "demo")
        self.assertEqual(r1["environment"], "DEMO")


# ─── IG-06: Log prefix [DEMO][ISOLATED] ──────────────────────────────────────

class TestIG06LogPrefix(unittest.TestCase):
    """IG-06 / F-07 — Every log line begins with [DEMO][ISOLATED]."""

    def _capture_seed_logs(self) -> str:
        import demo_seed
        orig_url = demo_seed.STAGING_SUPABASE_URL
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        demo_seed.STAGING_SUPABASE_URL = ""
        demo_seed._STAGING_URL_FRAGMENT = ""
        buf = io.StringIO()
        try:
            with patch("sys.stdout", buf):
                ds.seed(seed_val=42, dry_run=True, client_id="demo")
        finally:
            demo_seed.STAGING_SUPABASE_URL = orig_url
            demo_seed._STAGING_URL_FRAGMENT = orig_frag
        return buf.getvalue()

    def test_log_prefix_present(self):
        """DoD name: test_log_prefix_present — every stdout line has [DEMO][ISOLATED]."""
        output = self._capture_seed_logs()
        lines = [l for l in output.splitlines() if l.strip()]
        self.assertGreater(len(lines), 0, "No log output captured")
        for line in lines:
            self.assertTrue(
                line.startswith("[DEMO][ISOLATED]"),
                f"Line missing prefix: {line!r}"
            )

    def test_log_function_format(self):
        buf = io.StringIO()
        with patch("sys.stdout", buf):
            ds.log("test message")
        self.assertEqual(buf.getvalue().strip(), "[DEMO][ISOLATED] test message")

    def test_reset_logs_have_prefix(self):
        import demo_seed
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        demo_seed._STAGING_URL_FRAGMENT = ""
        buf = io.StringIO()
        try:
            with patch("sys.stdout", buf):
                dr.reset(seed_val=42, dry_run=True, client_id="demo")
        finally:
            demo_seed._STAGING_URL_FRAGMENT = orig_frag
        lines = [l for l in buf.getvalue().splitlines() if l.strip()]
        for line in lines:
            self.assertTrue(
                line.startswith("[DEMO][ISOLATED]"),
                f"Reset log line missing prefix: {line!r}"
            )


# ─── IG-07: Reset only touches client_id='demo' ──────────────────────────────

class TestIG07ResetOnlyDemo(unittest.TestCase):
    """IG-07 — Teardown DELETE queries only target client_id='demo'."""

    def test_teardown_delete_calls_only_demo(self):
        """All requests.delete calls must include eq.demo in params, never other tenants."""
        deleted_params = []

        def mock_delete(url, **kwargs):
            params = kwargs.get("params", {})
            deleted_params.append({"url": url, "params": params})
            return _ok_response()

        import demo_seed
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        orig_url = demo_seed.STAGING_SUPABASE_URL
        orig_key = demo_seed.STAGING_SUPABASE_KEY
        demo_seed._STAGING_URL_FRAGMENT = ""
        demo_seed.STAGING_SUPABASE_URL = "https://jkcnxfbbuyyfhwfjizgw.supabase.co"
        demo_seed.STAGING_SUPABASE_KEY = "fake-key"

        import demo_reset as dr2
        dr2.STAGING_SUPABASE_URL = demo_seed.STAGING_SUPABASE_URL

        try:
            with patch("requests.delete", side_effect=mock_delete), \
                 patch("requests.post", return_value=_ok_response()):
                dr.teardown(client_id="demo", dry_run=False)
        finally:
            demo_seed._STAGING_URL_FRAGMENT = orig_frag
            demo_seed.STAGING_SUPABASE_URL = orig_url
            demo_seed.STAGING_SUPABASE_KEY = orig_key

        for call_info in deleted_params:
            params = call_info["params"]
            # Every delete must filter by client_id = eq.demo OR id = eq.demo (clients table)
            has_demo_filter = (
                params.get("client_id") == "eq.demo" or
                params.get("id") == "eq.demo"
            )
            self.assertTrue(
                has_demo_filter,
                f"Delete call missing demo filter: {call_info}"
            )

    def test_teardown_never_touches_amalay(self):
        import demo_seed
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        demo_seed._STAGING_URL_FRAGMENT = ""
        amalay_touched = []

        def mock_delete(url, **kwargs):
            params = kwargs.get("params", {})
            if "amalay" in str(params):
                amalay_touched.append(url)
            return _ok_response()

        try:
            with patch("requests.delete", side_effect=mock_delete), \
                 patch("requests.post", return_value=_ok_response()):
                dr.teardown(client_id="demo", dry_run=False)
        finally:
            demo_seed._STAGING_URL_FRAGMENT = orig_frag

        self.assertEqual(amalay_touched, [],
                         f"Teardown touched AMALAY tables: {amalay_touched}")


# ─── IG-08: AMALAY data isolation ────────────────────────────────────────────

class TestIG08AmalayIsolation(unittest.TestCase):
    """IG-08 / F-06 — test_demo_amalay_isolation: no AMALAY data in demo context."""

    def test_demo_amalay_isolation(self):
        """DoD name: test_demo_amalay_isolation — IG-08 gate passes."""
        # Seed must never reference AMALAY client_id
        result = ds.seed(seed_val=42, dry_run=True, client_id="demo")
        all_rows = (
            [result["client"]]
            + result["menu_items"]
            + result["tables"]
            + result["staff"]
        )
        for row in all_rows:
            for key, val in row.items():
                self.assertNotEqual(str(val).lower(), "amalay",
                                    f"Row contains AMALAY reference: {key}={val!r}")
            self.assertEqual(row.get("client_id", "demo"), "demo",
                             f"Row has wrong client_id: {row}")

    def test_no_amalay_staff_names_in_demo_seed(self):
        """Demo staff names must not match AMALAY's meseros."""
        amalay_names = [
            "Omar Aguilera", "Hector Enrique Rodriguez Lopez",
            "Brayan Berlanga Solis", "Daniela Edith Rico Segura",
            "Julio Cesar Hernández Hernández", "Mauricio Rodriguez Rodriguez",
            "Oscar Rios Alvarado", "Alexis Alejandro Ocampo Vera",
            "Aldo Ruiz Ramirez", "Mariana Carolina Salas Alva",
            "Mario García Ramírez", "MESERO EVENTO",
        ]
        result = ds.seed(seed_val=42, dry_run=True, client_id="demo")
        demo_names = {s["name"] for s in result["staff"]}
        for amalay_name in amalay_names:
            self.assertNotIn(amalay_name, demo_names,
                             f"AMALAY staff name found in demo seed: {amalay_name!r}")

    def test_seed_http_calls_intercepted_by_mock(self):
        """F-06: unittest.mock intercepts 100% of HTTP calls during tests."""
        call_log = []

        import demo_seed
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        orig_url = demo_seed.STAGING_SUPABASE_URL
        orig_key = demo_seed.STAGING_SUPABASE_KEY
        demo_seed._STAGING_URL_FRAGMENT = ""
        demo_seed.STAGING_SUPABASE_URL = "https://jkcnxfbbuyyfhwfjizgw.supabase.co"
        demo_seed.STAGING_SUPABASE_KEY = "fake-key"

        def mock_post(url, **kwargs):
            call_log.append(url)
            return _ok_response()

        try:
            with patch("requests.post", side_effect=mock_post):
                ds.seed(seed_val=42, dry_run=False, client_id="demo")
        finally:
            demo_seed._STAGING_URL_FRAGMENT = orig_frag
            demo_seed.STAGING_SUPABASE_URL = orig_url
            demo_seed.STAGING_SUPABASE_KEY = orig_key

        # Verify mock intercepted actual calls (not an early exit)
        self.assertGreater(len(call_log), 0,
                           "requests.post was never called — seed() must have exited early")

        # All calls must have gone to staging, never production
        for url in call_log:
            for prod_frag in ds._PRODUCTION_URL_FRAGMENTS:
                self.assertNotIn(prod_frag, url,
                                 f"HTTP call to production URL during test: {url}")

    def test_production_url_in_env_raises_before_any_call(self):
        """Setting STAGING_SUPABASE_URL to production URL raises on first call."""
        import demo_seed
        orig_url = demo_seed.STAGING_SUPABASE_URL
        orig_key = demo_seed.STAGING_SUPABASE_KEY
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        demo_seed.STAGING_SUPABASE_URL = "https://qjiomlvudfmzuvqvhwpk.supabase.co"
        demo_seed.STAGING_SUPABASE_KEY = "fake-key"
        demo_seed._STAGING_URL_FRAGMENT = ""

        call_made = []

        def mock_post(url, **kwargs):
            call_made.append(url)
            return _ok_response()

        try:
            with self.assertRaises(RuntimeError) as ctx, \
                 patch("requests.post", side_effect=mock_post):
                ds.seed(seed_val=42, dry_run=False, client_id="demo")
        finally:
            demo_seed.STAGING_SUPABASE_URL = orig_url
            demo_seed.STAGING_SUPABASE_KEY = orig_key
            demo_seed._STAGING_URL_FRAGMENT = orig_frag

        self.assertIn("ABORT", str(ctx.exception))
        self.assertEqual(call_made, [], "requests.post should never have been called")


# ─── IG-09: Reset under 30 seconds ───────────────────────────────────────────

class TestIG09ResetUnder30s(unittest.TestCase):
    """IG-09 — reset() completes in < 30 seconds (with mocked network)."""

    def test_reset_under_30_seconds(self):
        import demo_seed
        orig_frag = demo_seed._STAGING_URL_FRAGMENT
        orig_url = demo_seed.STAGING_SUPABASE_URL
        orig_key = demo_seed.STAGING_SUPABASE_KEY
        demo_seed._STAGING_URL_FRAGMENT = ""
        demo_seed.STAGING_SUPABASE_URL = "https://jkcnxfbbuyyfhwfjizgw.supabase.co"
        demo_seed.STAGING_SUPABASE_KEY = "fake-key"

        try:
            with patch("requests.post", return_value=_ok_response()), \
                 patch("requests.delete", return_value=_ok_response()):
                t0 = time.monotonic()
                result = dr.reset(seed_val=42, dry_run=False, client_id="demo")
                elapsed = time.monotonic() - t0
        finally:
            demo_seed._STAGING_URL_FRAGMENT = orig_frag
            demo_seed.STAGING_SUPABASE_URL = orig_url
            demo_seed.STAGING_SUPABASE_KEY = orig_key

        self.assertLess(elapsed, 30.0,
                        f"reset() took {elapsed:.2f}s, exceeds 30s target")
        self.assertIn("state_md5", result)

    def test_two_consecutive_resets_identical_md5(self):
        """F-03: Two runs → identical state MD5."""
        result1 = dr.reset(seed_val=42, dry_run=True, client_id="demo")
        result2 = dr.reset(seed_val=42, dry_run=True, client_id="demo")
        self.assertEqual(result1["state_md5"], result2["state_md5"],
                         "Consecutive resets produced different state MD5")

    def test_reset_dry_run_is_fast(self):
        """Dry-run reset must also complete quickly."""
        t0 = time.monotonic()
        dr.reset(seed_val=42, dry_run=True, client_id="demo")
        elapsed = time.monotonic() - t0
        self.assertLess(elapsed, 5.0, f"Dry-run reset took {elapsed:.2f}s")


# ─── F-01: Tenant record shape ───────────────────────────────────────────────

class TestF01TenantRecord(unittest.TestCase):
    """F-01 — Client record has required fields: slug, name, data_source, environment."""

    def setUp(self):
        self.client = ds._generate_client_record()

    def test_slug_is_demo(self):
        self.assertEqual(self.client["slug"], "demo")

    def test_name_is_el_molcajete_demo(self):
        self.assertEqual(self.client["name"], "El Molcajete Demo")

    def test_data_source_is_demo(self):
        self.assertEqual(self.client["data_source"], "demo")

    def test_environment_is_demo(self):
        self.assertEqual(self.client["environment"], "DEMO")

    def test_id_is_demo(self):
        self.assertEqual(self.client["id"], "demo")


# ─── F-05: Provenance file exists ────────────────────────────────────────────

class TestF05ProvenanceFile(unittest.TestCase):
    """F-05 — PROVENANCE.md exists in scripts/demo/ with required sections."""

    PROVENANCE_PATH = DEMO_DIR / "PROVENANCE.md"

    def test_provenance_file_exists(self):
        self.assertTrue(self.PROVENANCE_PATH.exists(),
                        f"PROVENANCE.md not found at {self.PROVENANCE_PATH}")

    def test_provenance_documents_seed(self):
        content = self.PROVENANCE_PATH.read_text()
        self.assertIn("seed", content.lower(), "PROVENANCE.md must document the seed")

    def test_provenance_documents_generation_algorithm(self):
        content = self.PROVENANCE_PATH.read_text()
        self.assertIn("42", content, "PROVENANCE.md must document seed value 42")

    def test_provenance_documents_regeneration(self):
        content = self.PROVENANCE_PATH.read_text()
        self.assertIn("demo_seed.py", content,
                      "PROVENANCE.md must document how to regenerate")

    def test_provenance_documents_dataset_origin(self):
        content = self.PROVENANCE_PATH.read_text()
        self.assertIn("SIMULATED", content,
                      "PROVENANCE.md must document SIMULATED source")


if __name__ == "__main__":
    unittest.main(verbosity=2)
