#!/usr/bin/env python3
"""
Fullsite POS — Diagnostic Output Analyzer

Reads one or more ZIPs produced by DIAGNOSTIC-ONLY.ps1 and emits:
  - Terminal summary block (stdout)
  - Markdown report (adjacent .md file)
  - JSON report (adjacent .json file)

Usage:
    python analyze_diagnostic.py diag1.zip [diag2.zip ...]

Read-only. No secrets required. No external dependencies.
"""
import csv
import io
import json
import pathlib
import sys
import zipfile
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class DiagResult:
    source: str = ''
    terminal: str = 'UNKNOWN'
    capture_date: str = ''
    os_version: str = ''
    deployment_type: str = 'UNKNOWN'       # NSIS | LEGACY | MIXED | UNKNOWN
    current_executable: str = 'NOT RUNNING'
    current_version: str = 'UNKNOWN'
    port_7717_owner: str = 'NOT BOUND'
    port_7718_owner: str = 'NOT BOUND'
    auto_start_method: str = 'NONE DETECTED'
    user_data_paths: List[str] = field(default_factory=list)
    rollback_inputs_captured: bool = False
    recommended_branch: str = 'MANUAL REVIEW'  # NSIS UPGRADE | LEGACY MIGRATION | MANUAL REVIEW
    errors: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# ZIP helpers
# ---------------------------------------------------------------------------

def _read_csv(zf: zipfile.ZipFile, suffix: str) -> List[Dict[str, str]]:
    """Return rows from the first file in the ZIP whose name ends with suffix."""
    for name in zf.namelist():
        if name.endswith(suffix):
            try:
                raw = zf.read(name).decode('utf-8-sig', errors='replace')
                return list(csv.DictReader(io.StringIO(raw)))
            except Exception as exc:
                return []
    return []


def _read_text(zf: zipfile.ZipFile, suffix: str) -> str:
    for name in zf.namelist():
        if name.endswith(suffix):
            try:
                return zf.read(name).decode('utf-8-sig', errors='replace')
            except Exception:
                return ''
    return ''


# ---------------------------------------------------------------------------
# Core analysis
# ---------------------------------------------------------------------------

def analyze_zip(zip_path: str) -> DiagResult:
    r = DiagResult(source=zip_path)

    try:
        zf = zipfile.ZipFile(zip_path, 'r')
    except Exception as exc:
        r.errors.append(f'Cannot open ZIP: {exc}')
        return r

    with zf:
        # ── 0. Metadata ───────────────────────────────────────────────────
        meta_rows = _read_csv(zf, '0-metadata.csv')
        if meta_rows:
            m = meta_rows[0]
            r.terminal      = m.get('ComputerName', 'UNKNOWN') or 'UNKNOWN'
            r.capture_date  = m.get('CaptureDate', '')
            r.os_version    = m.get('OSVersion', '')
        else:
            # Fallback: derive from ZIP filename
            r.terminal = pathlib.Path(zip_path).stem

        # ── 1. Processes ──────────────────────────────────────────────────
        procs = _read_csv(zf, '1-processes.csv')
        running = [p for p in procs if p.get('ExecutablePath')]
        if running:
            r.current_executable = running[0].get('ExecutablePath', 'NOT RUNNING')

        # ── 2. Uninstall registry ─────────────────────────────────────────
        uninstall = _read_csv(zf, '2-uninstall-registry.csv')
        nsis_found = any(
            bool(u.get('UninstallString', '').strip())
            for u in uninstall
        )

        # ── 3. Ports ──────────────────────────────────────────────────────
        ports = _read_csv(zf, '3-ports.csv')
        for row in ports:
            lp    = str(row.get('LocalPort', '')).strip()
            owner = (
                f"{row.get('ProcessName', '')} "
                f"PID {row.get('OwningProcess', '')} "
                f"@ {row.get('ExecutablePath', '')}"
            ).strip()
            if lp == '7717':
                r.port_7717_owner = owner or 'BOUND (no process info)'
            elif lp == '7718':
                r.port_7718_owner = owner or 'BOUND (no process info)'

        # ── 7. Folder inventory ───────────────────────────────────────────
        inventory = _read_csv(zf, '7-folder-inventory.csv')

        legacy_rows = [
            row for row in inventory
            if row.get('Folder', '').startswith('C:\\fullsite')
            and row.get('Exists', '').lower() == 'true'
            and row.get('File', '').strip() != ''
        ]
        legacy_found = len(legacy_rows) > 0

        ud_set = set()
        appdata_labels = ('Fullsite POS', 'Fullsite KDS')
        for row in inventory:
            folder = row.get('Folder', '')
            if row.get('Exists', '').lower() == 'true' and row.get('File', '').strip():
                if any(label in folder for label in appdata_labels):
                    ud_set.add(folder)
        r.user_data_paths = sorted(ud_set)

        # ── Deployment type ───────────────────────────────────────────────
        if nsis_found and legacy_found:
            r.deployment_type = 'MIXED'
        elif nsis_found:
            r.deployment_type = 'NSIS'
        elif legacy_found:
            r.deployment_type = 'LEGACY'
        else:
            r.deployment_type = 'UNKNOWN'

        # ── 9. Executables — version ──────────────────────────────────────
        exes = _read_csv(zf, '9-executables.csv')
        main_exe = next(
            (
                e for e in exes
                if 'ullsite' in e.get('ProductName', '').lower()
                or 'ullsite' in e.get('Path', '').lower()
            ),
            None,
        )
        if main_exe:
            ver = main_exe.get('FileVersion', '').strip()
            r.current_version = ver if ver else 'UNKNOWN'
            if r.current_executable == 'NOT RUNNING':
                r.current_executable = main_exe.get('Path', 'NOT RUNNING')

        # ── 6. Auto-start ─────────────────────────────────────────────────
        methods: List[str] = []

        run_keys = _read_csv(zf, '6a-run-keys.csv')
        for rk in run_keys:
            name  = rk.get('Name', '')
            value = rk.get('Value', '')
            if 'ullsite' in name.lower() or 'ullsite' in value.lower():
                methods.append(f"Registry:Run name={name}")

        startup = _read_csv(zf, '6b-startup-folder.csv')
        for si in startup:
            tgt = si.get('LnkTarget', '')
            if tgt and 'ullsite' in tgt.lower():
                methods.append(f"StartupFolder:{si.get('Name', '')} -> {tgt}")

        tasks = _read_csv(zf, 'tasks-summary.csv')
        for t in tasks:
            task_name = t.get('TaskName', '')
            if task_name:
                methods.append(f"ScheduledTask:{task_name}")

        r.auto_start_method = ' | '.join(methods) if methods else 'NONE DETECTED'

        # ── Rollback inputs captured ───────────────────────────────────────
        has_evidence = (
            len(procs) > 0
            or len(uninstall) > 0
            or legacy_found
            or len(r.user_data_paths) > 0
        )
        r.rollback_inputs_captured = has_evidence

        # ── Recommended branch ────────────────────────────────────────────
        if r.deployment_type == 'NSIS':
            r.recommended_branch = 'NSIS UPGRADE'
        elif r.deployment_type == 'LEGACY':
            r.recommended_branch = 'LEGACY MIGRATION'
        else:
            r.recommended_branch = 'MANUAL REVIEW'

    return r


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

def _ud_str(r: DiagResult) -> str:
    return ' | '.join(r.user_data_paths) if r.user_data_paths else 'NONE FOUND'


def format_terminal(r: DiagResult) -> str:
    return (
        f"TERMINAL                     = {r.terminal}\n"
        f"CURRENT DEPLOYMENT TYPE      = {r.deployment_type}\n"
        f"CURRENT EXECUTABLE           = {r.current_executable}\n"
        f"CURRENT VERSION              = {r.current_version}\n"
        f"PORT 7717 OWNER              = {r.port_7717_owner}\n"
        f"PORT 7718 OWNER              = {r.port_7718_owner}\n"
        f"AUTO-START METHOD            = {r.auto_start_method}\n"
        f"USER DATA PATHS              = {_ud_str(r)}\n"
        f"ROLLBACK INPUTS CAPTURED     = {'YES' if r.rollback_inputs_captured else 'NO'}\n"
        f"RECOMMENDED MIGRATION BRANCH = {r.recommended_branch}"
    )


def format_markdown(r: DiagResult) -> str:
    ud = _ud_str(r)
    errors_section = ''
    if r.errors:
        errors_section = '\n## Errors\n\n' + '\n'.join(f'- {e}' for e in r.errors) + '\n'

    return (
        f"# Fullsite POS — Diagnostic Report\n\n"
        f"**Source:** `{r.source}`  \n"
        f"**Captured:** {r.capture_date or 'unknown'}  \n"
        f"**OS:** {r.os_version or 'unknown'}\n\n"
        f"| Field | Value |\n"
        f"|---|---|\n"
        f"| TERMINAL | `{r.terminal}` |\n"
        f"| DEPLOYMENT TYPE | `{r.deployment_type}` |\n"
        f"| CURRENT EXECUTABLE | `{r.current_executable}` |\n"
        f"| CURRENT VERSION | `{r.current_version}` |\n"
        f"| PORT 7717 | `{r.port_7717_owner}` |\n"
        f"| PORT 7718 | `{r.port_7718_owner}` |\n"
        f"| AUTO-START | `{r.auto_start_method}` |\n"
        f"| USER DATA PATHS | `{ud}` |\n"
        f"| ROLLBACK INPUTS CAPTURED | `{'YES' if r.rollback_inputs_captured else 'NO'}` |\n"
        f"| **RECOMMENDED BRANCH** | **{r.recommended_branch}** |\n"
        f"{errors_section}"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    args = argv if argv is not None else sys.argv[1:]

    if not args:
        print(
            'Usage: python analyze_diagnostic.py <diag.zip> [diag2.zip ...]',
            file=sys.stderr,
        )
        return 1

    all_results = []
    bar = '=' * 60

    for zip_arg in args:
        zip_path = pathlib.Path(zip_arg)
        if not zip_path.exists():
            print(f'[ERROR] File not found: {zip_arg}', file=sys.stderr)
            continue

        print(f'\n{bar}')
        print(f'Analyzing: {zip_arg}')
        print(bar)

        r = analyze_zip(str(zip_path))

        if r.errors:
            for err in r.errors:
                print(f'[ERROR] {err}', file=sys.stderr)

        print(format_terminal(r))

        md_path   = zip_path.with_suffix('.md')
        json_path = zip_path.with_suffix('.json')

        md_path.write_text(format_markdown(r), encoding='utf-8')
        json_path.write_text(
            json.dumps(asdict(r), indent=2, ensure_ascii=False),
            encoding='utf-8',
        )

        print(f'\nMarkdown : {md_path}')
        print(f'JSON     : {json_path}')

        all_results.append(asdict(r))

    if len(all_results) > 1:
        summary = pathlib.Path('diagnostic-summary.json')
        summary.write_text(
            json.dumps(all_results, indent=2, ensure_ascii=False),
            encoding='utf-8',
        )
        print(f'\nSummary  : {summary}')

    print(f'\n{bar}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
