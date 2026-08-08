"""
Tests for analyze_diagnostic.py — uses synthetic ZIP fixtures.

Scenarios:
  NSIS     — NSIS installer present, no C:\\fullsite
  LEGACY   — C:\\fullsite present, no NSIS registry entry
  MIXED    — both NSIS and C:\\fullsite
  UNKNOWN  — neither; no processes running
"""
import csv
import io
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile

# Ensure scripts/agent-os is importable
SCRIPTS_DIR = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

import analyze_diagnostic as ad


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _csv(rows, headers=None):
    """Return a CSV string from a list of dicts."""
    if not rows:
        return 'dummy\r\n'
    hdrs = headers or list(rows[0].keys())
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=hdrs, lineterminator='\r\n')
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def _make_zip(files):
    """
    Create a temporary ZIP with files dict {arcname: content_str}.
    Returns the path string. Caller is responsible for cleanup.
    """
    tmp = tempfile.NamedTemporaryFile(suffix='.zip', delete=False)
    tmp.close()
    with zipfile.ZipFile(tmp.name, 'w') as zf:
        for arcname, content in files.items():
            zf.writestr(arcname, content)
    return tmp.name


def _base_files(subdir='fullsite-diag-20260804-1400'):
    """Return a dict of all expected files with empty/minimal content."""
    return {
        f'{subdir}/0-metadata.csv':          _csv([{'ComputerName': 'PDV3', 'UserName': 'pos', 'CaptureDate': '2026-08-04 14:00:00', 'OSVersion': 'Windows 10', 'PSVersion': '5.1'}]),
        f'{subdir}/1-processes.csv':          _csv([]),
        f'{subdir}/2-uninstall-registry.csv': _csv([]),
        f'{subdir}/3-ports.csv':              _csv([]),
        f'{subdir}/4-services.csv':           _csv([]),
        f'{subdir}/5-scheduled-tasks/tasks-summary.csv': _csv([]),
        f'{subdir}/6a-run-keys.csv':          _csv([]),
        f'{subdir}/6b-startup-folder.csv':    _csv([]),
        f'{subdir}/7-folder-inventory.csv':   _csv([]),
        f'{subdir}/8e-connectivity.csv':      _csv([]),
        f'{subdir}/9-executables.csv':        _csv([]),
    }


# ---------------------------------------------------------------------------
# Fixture factories
# ---------------------------------------------------------------------------

def _nsis_zip():
    files = _base_files()
    sub = 'fullsite-diag-20260804-1400'

    files[f'{sub}/1-processes.csv'] = _csv([{
        'ProcessId': '4200',
        'Name': 'Fullsite POS.exe',
        'ExecutablePath': r'C:\Program Files\Fullsite POS\Fullsite POS.exe',
        'CommandLine': '',
        'CreationDate': '20260804140000.000000+000',
    }])
    files[f'{sub}/2-uninstall-registry.csv'] = _csv([{
        'Hive': r'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'KeyName': '{FULLSITE-POS-1.3.3}',
        'DisplayName': 'Fullsite POS',
        'DisplayVersion': '1.3.3',
        'Publisher': 'Fullsite',
        'InstallLocation': r'C:\Program Files\Fullsite POS',
        'UninstallString': r'"C:\Program Files\Fullsite POS\Uninstall Fullsite POS.exe"',
        'InstallDate': '20260804',
    }])
    files[f'{sub}/3-ports.csv'] = _csv([
        {'LocalAddress': '0.0.0.0', 'LocalPort': '7717', 'OwningProcess': '4200',
         'ProcessName': 'Fullsite POS.exe', 'ExecutablePath': r'C:\Program Files\Fullsite POS\Fullsite POS.exe'},
        {'LocalAddress': '127.0.0.1', 'LocalPort': '7718', 'OwningProcess': '4201',
         'ProcessName': 'fingerprint-service.exe', 'ExecutablePath': r'C:\fullsite\fingerprint-service.exe'},
    ])
    files[f'{sub}/6a-run-keys.csv'] = _csv([{
        'RegKey': r'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
        'Name': 'Fullsite POS',
        'Value': r'C:\Program Files\Fullsite POS\Fullsite POS.exe',
    }])
    files[f'{sub}/7-folder-inventory.csv'] = _csv([
        {'Folder': r'C:\Program Files\Fullsite POS', 'Exists': 'True',
         'File': r'\Fullsite POS.exe', 'SizeBytes': '81191116',
         'LastWriteTime': '2026-08-04 10:00:00', 'SHA256': 'abc123', 'FileVersion': '1.3.3'},
    ])
    files[f'{sub}/9-executables.csv'] = _csv([{
        'Path': r'C:\Program Files\Fullsite POS\Fullsite POS.exe',
        'FileVersion': '1.3.3',
        'ProductName': 'Fullsite POS',
        'SHA256': '47462a64c4abcd5f',
        'LastWrite': '2026-08-04 10:00:00',
    }])
    return _make_zip(files)


def _legacy_zip():
    files = _base_files()
    sub = 'fullsite-diag-20260804-1400'

    files[f'{sub}/1-processes.csv'] = _csv([{
        'ProcessId': '3100',
        'Name': 'Fullsite POS.exe',
        'ExecutablePath': r'C:\fullsite\Fullsite POS.exe',
        'CommandLine': '',
        'CreationDate': '20260804140000.000000+000',
    }])
    # No uninstall entry (legacy — no NSIS)
    files[f'{sub}/7-folder-inventory.csv'] = _csv([
        {'Folder': r'C:\fullsite', 'Exists': 'True',
         'File': r'\Fullsite POS.exe', 'SizeBytes': '80000000',
         'LastWriteTime': '2026-06-01 08:00:00', 'SHA256': 'deadbeef', 'FileVersion': '1.2.0'},
        {'Folder': r'C:\fullsite', 'Exists': 'True',
         'File': r'\config.json', 'SizeBytes': '512',
         'LastWriteTime': '2026-06-01 08:00:00', 'SHA256': 'aabbcc', 'FileVersion': ''},
    ])
    files[f'{sub}/9-executables.csv'] = _csv([{
        'Path': r'C:\fullsite\Fullsite POS.exe',
        'FileVersion': '1.2.0',
        'ProductName': 'Fullsite KDS',
        'SHA256': 'deadbeef',
        'LastWrite': '2026-06-01 08:00:00',
    }])
    return _make_zip(files)


def _mixed_zip():
    files = _base_files()
    sub = 'fullsite-diag-20260804-1400'

    # NSIS entry
    files[f'{sub}/2-uninstall-registry.csv'] = _csv([{
        'Hive': r'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'KeyName': '{FULLSITE-POS-1.3.3}',
        'DisplayName': 'Fullsite POS',
        'DisplayVersion': '1.3.3',
        'Publisher': 'Fullsite',
        'InstallLocation': r'C:\Program Files\Fullsite POS',
        'UninstallString': r'"C:\Program Files\Fullsite POS\Uninstall Fullsite POS.exe"',
        'InstallDate': '20260804',
    }])
    # AND legacy C:\fullsite folder
    files[f'{sub}/7-folder-inventory.csv'] = _csv([
        {'Folder': r'C:\fullsite', 'Exists': 'True',
         'File': r'\fingerprint-service.exe', 'SizeBytes': '102400',
         'LastWriteTime': '2026-06-01 08:00:00', 'SHA256': 'ff00ff', 'FileVersion': ''},
        {'Folder': r'C:\Program Files\Fullsite POS', 'Exists': 'True',
         'File': r'\Fullsite POS.exe', 'SizeBytes': '81191116',
         'LastWriteTime': '2026-08-04 10:00:00', 'SHA256': '47462a64', 'FileVersion': '1.3.3'},
    ])
    return _make_zip(files)


def _unknown_zip():
    # Minimal: metadata only, nothing found
    files = _base_files()
    return _make_zip(files)


# ---------------------------------------------------------------------------
# Tests — Deployment type detection
# ---------------------------------------------------------------------------

class TestDeploymentType(unittest.TestCase):

    def test_nsis_detected(self):
        path = _nsis_zip()
        r = ad.analyze_zip(path)
        self.assertEqual(r.deployment_type, 'NSIS')

    def test_legacy_detected(self):
        path = _legacy_zip()
        r = ad.analyze_zip(path)
        self.assertEqual(r.deployment_type, 'LEGACY')

    def test_mixed_detected(self):
        path = _mixed_zip()
        r = ad.analyze_zip(path)
        self.assertEqual(r.deployment_type, 'MIXED')

    def test_unknown_when_nothing_found(self):
        path = _unknown_zip()
        r = ad.analyze_zip(path)
        self.assertEqual(r.deployment_type, 'UNKNOWN')


# ---------------------------------------------------------------------------
# Tests — Recommended migration branch
# ---------------------------------------------------------------------------

class TestRecommendedBranch(unittest.TestCase):

    def test_nsis_recommends_upgrade(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertEqual(r.recommended_branch, 'NSIS UPGRADE')

    def test_legacy_recommends_migration(self):
        r = ad.analyze_zip(_legacy_zip())
        self.assertEqual(r.recommended_branch, 'LEGACY MIGRATION')

    def test_mixed_recommends_manual_review(self):
        r = ad.analyze_zip(_mixed_zip())
        self.assertEqual(r.recommended_branch, 'MANUAL REVIEW')

    def test_unknown_recommends_manual_review(self):
        r = ad.analyze_zip(_unknown_zip())
        self.assertEqual(r.recommended_branch, 'MANUAL REVIEW')


# ---------------------------------------------------------------------------
# Tests — Port detection
# ---------------------------------------------------------------------------

class TestPortDetection(unittest.TestCase):

    def test_7717_owner_detected(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertIn('Fullsite POS.exe', r.port_7717_owner)
        self.assertIn('4200', r.port_7717_owner)

    def test_7718_owner_detected(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertIn('fingerprint-service.exe', r.port_7718_owner)

    def test_ports_not_bound_on_clean_machine(self):
        r = ad.analyze_zip(_unknown_zip())
        self.assertEqual(r.port_7717_owner, 'NOT BOUND')
        self.assertEqual(r.port_7718_owner, 'NOT BOUND')


# ---------------------------------------------------------------------------
# Tests — Version and executable
# ---------------------------------------------------------------------------

class TestVersionAndExecutable(unittest.TestCase):

    def test_version_extracted_nsis(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertEqual(r.current_version, '1.3.3')

    def test_version_extracted_legacy(self):
        r = ad.analyze_zip(_legacy_zip())
        self.assertEqual(r.current_version, '1.2.0')

    def test_executable_from_running_process(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertIn('Fullsite POS', r.current_executable)

    def test_no_crash_when_nothing_running(self):
        r = ad.analyze_zip(_unknown_zip())
        # Must not raise; must have a safe default
        self.assertIn(r.current_executable, ('NOT RUNNING', ''))


# ---------------------------------------------------------------------------
# Tests — Auto-start method
# ---------------------------------------------------------------------------

class TestAutoStart(unittest.TestCase):

    def test_registry_run_detected(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertIn('Registry:Run', r.auto_start_method)
        self.assertIn('Fullsite POS', r.auto_start_method)

    def test_none_detected_on_clean_machine(self):
        r = ad.analyze_zip(_unknown_zip())
        self.assertEqual(r.auto_start_method, 'NONE DETECTED')


# ---------------------------------------------------------------------------
# Tests — Rollback inputs captured
# ---------------------------------------------------------------------------

class TestRollbackInputs(unittest.TestCase):

    def test_captured_when_processes_found(self):
        r = ad.analyze_zip(_nsis_zip())
        self.assertTrue(r.rollback_inputs_captured)

    def test_captured_when_legacy_folder_found(self):
        r = ad.analyze_zip(_legacy_zip())
        self.assertTrue(r.rollback_inputs_captured)

    def test_not_captured_on_clean_machine(self):
        r = ad.analyze_zip(_unknown_zip())
        self.assertFalse(r.rollback_inputs_captured)


# ---------------------------------------------------------------------------
# Tests — Resilience (missing files, corrupt data)
# ---------------------------------------------------------------------------

class TestResilience(unittest.TestCase):

    def test_empty_zip_does_not_crash(self):
        tmp = tempfile.NamedTemporaryFile(suffix='.zip', delete=False)
        tmp.close()
        with zipfile.ZipFile(tmp.name, 'w'):
            pass
        r = ad.analyze_zip(tmp.name)
        self.assertEqual(r.deployment_type, 'UNKNOWN')
        self.assertEqual(r.port_7717_owner, 'NOT BOUND')

    def test_nonexistent_zip_returns_error(self):
        r = ad.analyze_zip('/nonexistent/path/diag.zip')
        self.assertTrue(len(r.errors) > 0)
        self.assertEqual(r.deployment_type, 'UNKNOWN')

    def test_corrupt_csv_does_not_crash(self):
        files = _base_files()
        sub = 'fullsite-diag-20260804-1400'
        files[f'{sub}/1-processes.csv'] = 'not,valid\x00\xff\ncsv,data'
        path = _make_zip(files)
        r = ad.analyze_zip(path)
        # Must complete without exception
        self.assertIsInstance(r.deployment_type, str)

    def test_metadata_fallback_to_filename(self):
        files = _base_files()
        sub = 'fullsite-diag-20260804-1400'
        # Remove metadata CSV entirely
        del files[f'{sub}/0-metadata.csv']
        path = _make_zip(files)
        r = ad.analyze_zip(path)
        # Falls back to ZIP filename stem
        self.assertNotEqual(r.terminal, '')


# ---------------------------------------------------------------------------
# Tests — Output format
# ---------------------------------------------------------------------------

class TestOutputFormat(unittest.TestCase):

    def test_terminal_block_contains_all_fields(self):
        r = ad.analyze_zip(_nsis_zip())
        block = ad.format_terminal(r)
        for field_name in (
            'TERMINAL', 'CURRENT DEPLOYMENT TYPE', 'CURRENT EXECUTABLE',
            'CURRENT VERSION', 'PORT 7717 OWNER', 'PORT 7718 OWNER',
            'AUTO-START METHOD', 'USER DATA PATHS',
            'ROLLBACK INPUTS CAPTURED', 'RECOMMENDED MIGRATION BRANCH',
        ):
            self.assertIn(field_name, block, f'Missing field in terminal block: {field_name}')

    def test_markdown_is_valid_table(self):
        r = ad.analyze_zip(_nsis_zip())
        md = ad.format_markdown(r)
        self.assertIn('|', md)
        self.assertIn('DEPLOYMENT TYPE', md)
        self.assertIn('RECOMMENDED BRANCH', md)

    def test_json_is_valid_and_complete(self):
        import dataclasses
        r = ad.analyze_zip(_nsis_zip())
        d = dataclasses.asdict(r)
        serialized = json.dumps(d)
        parsed = json.loads(serialized)
        self.assertIn('deployment_type', parsed)
        self.assertIn('recommended_branch', parsed)
        self.assertIn('rollback_inputs_captured', parsed)


if __name__ == '__main__':
    unittest.main(verbosity=2)
