import subprocess
import tempfile
import unittest
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNBOOK = ROOT / "docs/playbooks/INSTALL-NEW-RESTAURANT.md"
MANIFEST = ROOT / "scripts/manifests/nomada-mini.json"


class InstallRunbookTest(unittest.TestCase):
    def test_runbook_references_real_entrypoints_in_safe_order(self):
        text = RUNBOOK.read_text(encoding="utf-8")
        commands = [
            "scripts/manifests/validate_manifest.mjs",
            "scripts/manifests/generate_terminal_config.mjs",
            "scripts/onboarding/onboard_client.py cliente-cloud.json --dry-run",
            "scripts/onboarding/onboard_client.py cliente-cloud.json",
            "scripts/onboarding/onboard_client.py cliente-cloud.json --resume",
            "scripts/onboarding/smoke_test.py --help",
            "scripts/onboarding/smoke_test.py --client-id <client_id> --confirm-ref <confirm_ref>",
        ]
        positions = [text.index(command) for command in commands]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("SUPABASE_SERVICE_KEY=", text)
        self.assertIn("qjiomlvudfmzuvqvhwpk", text)
        self.assertIn("Nunca continuar", text)

    def test_real_manifest_validator_and_terminal_generator_pass(self):
        validate = subprocess.run(
            ["node", "scripts/manifests/validate_manifest.mjs", str(MANIFEST)],
            cwd=ROOT, text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(validate.returncode, 0, validate.stdout + validate.stderr)
        self.assertIn("1/1 manifests válidos", validate.stdout)

        with tempfile.TemporaryDirectory() as output:
            generate = subprocess.run(
                ["node", "scripts/manifests/generate_terminal_config.mjs", str(MANIFEST), output,
                 "--provisioned-at=2026-08-10T00:00:00.000Z"],
                cwd=ROOT, text=True, capture_output=True, timeout=20,
            )
            self.assertEqual(generate.returncode, 0, generate.stdout + generate.stderr)
            self.assertTrue((Path(output) / "nomada-caja/config.json").exists())
            self.assertTrue((Path(output) / "nomada-caja/printers.json").exists())
            self.assertTrue((Path(output) / "nomada-kds-cocina/config.json").exists())

    def test_onboarding_cli_exposes_recovery_and_safe_preview(self):
        help_run = subprocess.run(
            ["python3", "scripts/onboarding/onboard_client.py", "--help"],
            cwd=ROOT, text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(help_run.returncode, 0, help_run.stdout + help_run.stderr)
        for flag in ("--dry-run", "--resume", "--teardown"):
            self.assertIn(flag, help_run.stdout)

    def test_cloud_manifest_example_contains_current_safety_contract(self):
        manifest = json.loads(
            (ROOT / "scripts/onboarding/manifest.example.json").read_text(encoding="utf-8")
        )
        required = {
            "client_id", "name", "owner_email", "confirm_ref", "template",
            "timezone", "business_day_start_local",
        }
        self.assertFalse(required - manifest.keys())
        self.assertNotEqual(manifest["client_id"], "amalay")
        self.assertNotEqual(manifest["confirm_ref"], "qjiomlvudfmzuvqvhwpk")


if __name__ == "__main__":
    unittest.main()
