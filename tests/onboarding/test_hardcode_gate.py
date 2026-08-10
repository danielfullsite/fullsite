import importlib.util
import json
import tempfile
import unittest
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "check_hardcodes", ROOT / "scripts" / "check_hardcodes.py"
)
assert SPEC and SPEC.loader
CHECKER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CHECKER
SPEC.loader.exec_module(CHECKER)


class HardcodeGateTest(unittest.TestCase):
    def test_production_ref_and_tenant_defaults_are_detected(self):
        samples = {
            "production_project_ref": "https://qjiomlvudfmzuvqvhwpk.supabase.co",
            "amalay_tenant_assignment": "const clientId = 'amalay'",
            "amalay_tenant_fallback": "const id = configured || 'amalay'",
            "amalay_tenant_comparison": "if (clientId === 'amalay') return",
            "amalay_static_option": '<option value="amalay">AMALAY</option>',
            "browser_embedded_jwt": "eyJabcdefghijk.eyJabcdefghijk.abcdefghijk",
        }
        rules = {rule.name: rule for rule in CHECKER.RULES}
        for name, source in samples.items():
            with self.subTest(rule=name):
                self.assertRegex(source, rules[name].pattern)

    def test_allowlist_requires_exact_rule_and_reason(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "allowlist.json"
            path.write_text(json.dumps({"entries": [{"path": "x.ts", "rule": "unknown"}]}))
            original = CHECKER.ALLOWLIST_PATH
            CHECKER.ALLOWLIST_PATH = path
            try:
                with self.assertRaises(ValueError):
                    CHECKER.load_allowlist()
            finally:
                CHECKER.ALLOWLIST_PATH = original


if __name__ == "__main__":
    unittest.main()
