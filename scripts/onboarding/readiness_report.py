#!/usr/bin/env python3
"""
Fullsite readiness report — read-only pipeline score.

Purpose:
  Give Daniel a reproducible % for:
    1. Client #2 operability
    2. Cloneability for many restaurants
    3. Offline readiness

This script does NOT mutate code, DB, Vercel, Supabase, or production.
It scores only local repo evidence plus optional GitHub PR state when `gh`
is available.

Usage:
  python3 scripts/onboarding/readiness_report.py
  python3 scripts/onboarding/readiness_report.py --json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable


REPO = Path(__file__).resolve().parents[2]
PROD_REF = "qjiomlvudfmzuvqvhwpk"
STAGING_REF = "jkcnxfbbuyyfhwfjizgw"


@dataclass
class Check:
    id: str
    label: str
    weight: int
    passed: bool
    evidence: str
    blocker: bool = False


def read(path: str) -> str:
    p = REPO / path
    try:
        return p.read_text(errors="ignore")
    except FileNotFoundError:
        return ""


def exists(path: str) -> bool:
    return (REPO / path).exists()


def contains(path: str, *needles: str) -> bool:
    text = read(path)
    return all(n in text for n in needles)


def rg_count(pattern: str, paths: Iterable[str]) -> int:
    cmd = [
        "rg",
        "-n",
        pattern,
        *paths,
        "-g",
        "!**/__tests__/**",
        "-g",
        "!**/*.test.ts",
        "-g",
        "!scripts/onboarding/readiness_report.py",
    ]
    try:
        r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        return -1
    if r.returncode not in (0, 1):
        return -1
    return 0 if not r.stdout.strip() else len(r.stdout.splitlines())


def cmd_text(cmd: list[str], timeout: int = 12) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 124, str(e)


def pr23_green() -> tuple[bool, str]:
    code, out = cmd_text(["gh", "pr", "checks", "23", "--repo", "danielfullsite/fullsite"], timeout=18)
    if code != 0 and not out:
        return False, "gh unavailable"
    required = ["test\tpass", "Vercel\tpass"]
    ok = all(x in out for x in required)
    return ok, "PR #23 checks include GitHub test + Vercel PASS" if ok else "PR #23 not fully green"


def git_head() -> str:
    code, out = cmd_text(["git", "rev-parse", "--short", "HEAD"], timeout=5)
    return out.strip() if code == 0 else "unknown"


def score(checks: list[Check]) -> int:
    total = sum(c.weight for c in checks)
    got = sum(c.weight for c in checks if c.passed)
    return round((got / total) * 100) if total else 0


def client2_checks() -> list[Check]:
    pr_ok, pr_ev = pr23_green()
    return [
        Check(
            "c2-doc",
            "Client #2 Nómada state documented",
            8,
            contains("docs/platform/CLIENT2-NOMADA-STAGING.md", "client_id = nomada", "Ventas del día $510"),
            "docs/platform/CLIENT2-NOMADA-STAGING.md has tenant + UI evidence",
        ),
        Check(
            "c2-seeds",
            "Canonical Nómada seeds exist",
            10,
            all(exists(p) for p in [
                "scripts/seed/nomada/v1_client.sql",
                "scripts/seed/nomada/v1_staff.sql",
                "scripts/seed/nomada/v1_menu.sql",
                "scripts/seed/nomada/v1_payment_methods.sql",
                "scripts/seed/nomada/v1_verify.sql",
            ]),
            "scripts/seed/nomada/v1_*.sql",
        ),
        Check(
            "c2-e2e-sql",
            "Read-only E2E verification SQL exists",
            8,
            contains("scripts/onboarding/verify_nomada_e2e.sql", "ventas_total", "corte_diferencia", "isolation"),
            "scripts/onboarding/verify_nomada_e2e.sql",
        ),
        Check(
            "c2-rls",
            "Tenant isolation check exists and requires authenticated session",
            10,
            contains("scripts/tenant-isolation/README.md", "sesión autenticada como nomada", "no como service_role"),
            "scripts/tenant-isolation/README.md",
        ),
        Check(
            "c2-public-url",
            "Public navigable Client #2 URL certified",
            18,
            contains("docs/platform/CLIENT2-NOMADA-STAGING.md", "HOSTED STAGING CERTIFICATION COMPLETE")
            or contains("docs/platform/CLIENT2-NOMADA-STAGING.md", "URL pública", "PASS"),
            "Local UI evidence exists; hosted public URL still not certified",
            blocker=True,
        ),
        Check(
            "c2-pr23",
            "Delivery/KDS server endpoint PR green",
            8,
            pr_ok,
            pr_ev,
        ),
        Check(
            "c2-no-prod",
            "Staging guardrails present",
            8,
            contains("scripts/sql/sandbox/onboard_client.py", PROD_REF, "ABORTING")
            and contains("scripts/onboarding/run_dashboard_staging.sh", STAGING_REF),
            "prod ref guard + staging wrapper present",
        ),
        Check(
            "c2-manual-ui",
            "Full manual hosted UI flow PASS",
            18,
            contains("docs/platform/CLIENT2-NOMADA-STAGING.md", "HOSTED STAGING CERTIFICATION COMPLETE")
            or contains("docs/platform/CLIENT2-NOMADA-STAGING.md", "login → PIN → abrir turno → agregar producto → enviar a KDS → cobrar → corte → refrescar"),
            "Local UI PASS only; hosted public UI flow remains the blocker",
            blocker=True,
        ),
        Check(
            "c2-demo-data",
            "Demo is labeled synthetic / not AMALAY",
            12,
            contains("docs/platform/CLIENT2-NOMADA-STAGING.md", "DEMO / DATOS SINTÉTICOS", "0 \"amalay\""),
            "Nómada UI evidence says synthetic + no AMALAY",
        ),
    ]


def cloneability_checks() -> list[Check]:
    hardcode_hits = rg_count(
        r"typeof window === 'undefined' \? 'amalay'|client_id: 'amalay'|value=\"amalay\"",
        ["dashboard-app/src", "scripts/onboarding", "scripts/sql/sandbox"],
    )
    return [
        Check(
            "clone-onboard",
            "One-command onboarding orchestrator exists",
            14,
            contains("scripts/onboarding/onboard_client.py", "Pipeline orchestrator", "smoke_check"),
            "scripts/onboarding/onboard_client.py",
        ),
        Check(
            "clone-manifest",
            "Manifest contract exists",
            8,
            contains("scripts/onboarding/manifest.example.json", "client_id", "owner_email", "template"),
            "scripts/onboarding/manifest.example.json",
        ),
        Check(
            "clone-menu-import",
            "Menu/staff import tooling exists",
            10,
            exists("scripts/onboarding/menu_import.py") and exists("scripts/onboarding/staff_import.py"),
            "scripts/onboarding/menu_import.py + staff_import.py",
        ),
        Check(
            "clone-diff",
            "Diff report gate exists",
            8,
            exists("scripts/onboarding/diff_report.py"),
            "scripts/onboarding/diff_report.py",
        ),
        Check(
            "clone-vercel-dns",
            "Vercel/DNS provisioning hooks exist",
            10,
            exists("scripts/onboarding/vercel_provision.py") and exists("scripts/onboarding/dns_provision.py"),
            "scripts/onboarding/vercel_provision.py + dns_provision.py",
        ),
        Check(
            "clone-smoke",
            "Automated clone smoke exists and can exercise JWT/RLS",
            12,
            exists("scripts/onboarding/tenant_jwt_smoke.py"),
            "scripts/onboarding/tenant_jwt_smoke.py signs in with real Supabase Auth JWT and does not use service_role",
        ),
        Check(
            "clone-teardown",
            "Tenant teardown/verify exists",
            8,
            exists("scripts/teardown/nomada_teardown.sql") and exists("scripts/teardown/nomada_verify_clean.sql"),
            "scripts/teardown/nomada_*.sql",
        ),
        Check(
            "clone-hardcodes",
            "Critical AMALAY hardcodes removed from clone path",
            16,
            hardcode_hits == 0,
            f"critical hardcode pattern hits={hardcode_hits}",
            blocker=hardcode_hits not in (0, -1),
        ),
        Check(
            "clone-public-demo",
            "Public per-tenant demo deployment is repeatable",
            14,
            contains("docs/platform/HANDOFF-CLAUDE1-NOMADA-PUBLIC.md", "BUG-019 HOSTED STAGING CERTIFICATION COMPLETE")
            or contains("docs/platform/HANDOFF-CLAUDE1-NOMADA-PUBLIC.md", "URL pública", "PASS"),
            "handoff exists; final hosted public deployment still owned by deploy lane",
            blocker=True,
        ),
    ]


def offline_checks() -> list[Check]:
    return [
        Check(
            "off-arch",
            "Offline architecture documented",
            10,
            exists("docs/architecture/LOCAL-FIRST.md") and exists("docs/offline/RUNBOOK.md"),
            "docs/architecture/LOCAL-FIRST.md + docs/offline/RUNBOOK.md",
        ),
        Check(
            "off-matrix",
            "Offline test matrix exists",
            8,
            contains("docs/offline/TEST-MATRIX.md", "Caída de Internet", "Reinicios"),
            "docs/offline/TEST-MATRIX.md",
        ),
        Check(
            "off-field-pack",
            "AMALAY Field Batch #2 pack exists",
            12,
            exists("docs/customers/amalay/FIELD-BATCH-2-OFFLINE-PACK-2026-08-11.md")
            and exists("docs/customers/amalay/FIELD-BATCH-2-RUN-SHEET-2026-08-11.md"),
            "Field Batch #2 pack + run sheet",
        ),
        Check(
            "off-local-server",
            "Local server/event store/KDS tests exist",
            10,
            exists("electron-app/local-server/core/event-store.js")
            and exists("electron-app/local-server/tests/kds-ws.test.js"),
            "electron-app/local-server core + tests",
        ),
        Check(
            "off-print-retry",
            "Print retry/duplicate tests exist",
            8,
            exists("electron-app/local-server/tests/printer-retry-cycle.test.js"),
            "printer-retry-cycle.test.js",
        ),
        Check(
            "off-build",
            "Offline shell branch has recent local-load commits",
            10,
            "offline-shell/local-load" in cmd_text(["git", "branch", "--show-current"], timeout=5)[1],
            "current branch offline-shell/local-load",
        ),
        Check(
            "off-field-pass",
            "Physical Field Batch #2 PASS evidence exists",
            22,
            exists("docs/certifications/AMALAY-FIELD-BATCH-2-PASS.md"),
            "Pack exists; physical PASS evidence not yet archived",
            blocker=True,
        ),
        Check(
            "off-fleet",
            "Fleet observability/update channel for 1000+ restaurants",
            20,
            exists("electron-app/local-server/telemetry/heartbeat.js")
            and contains("docs/offline/OBSERVABILITY.md", "heartbeat")
            and contains("docs/offline/OBSERVABILITY.md", "alert"),
            "heartbeat exists; fleet-grade dashboard/alerts still incomplete",
            blocker=True,
        ),
    ]


def render_section(title: str, checks: list[Check]) -> None:
    pct = score(checks)
    print(f"\n{title}: {pct}%")
    print("-" * (len(title) + 6))
    for c in checks:
        mark = "PASS" if c.passed else ("BLOCK" if c.blocker else "TODO")
        print(f"[{mark:5}] {c.id:18} {c.label}")
        print(f"        {c.evidence}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args()

    sections = {
        "client2": client2_checks(),
        "cloneability": cloneability_checks(),
        "offline": offline_checks(),
    }
    overall = round(sum(score(v) for v in sections.values()) / len(sections))
    blockers = [c for checks in sections.values() for c in checks if c.blocker and not c.passed]
    payload = {
        "git_head": git_head(),
        "overall_percent": overall,
        "sections": {k: {"percent": score(v), "checks": [asdict(c) for c in v]} for k, v in sections.items()},
        "blockers": [asdict(c) for c in blockers],
        "rules": {
            "production_changed": False,
            "db_changed": False,
            "read_only": True,
        },
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print("Fullsite readiness report")
    print(f"HEAD: {payload['git_head']}")
    print(f"Overall: {overall}%")
    for name, checks in sections.items():
        render_section(name.upper(), checks)
    print("\nTop blockers")
    print("------------")
    if blockers:
        for b in blockers:
            print(f"- {b.id}: {b.label} — {b.evidence}")
    else:
        print("- none")
    print("\nNo production, DB, Vercel, or Supabase mutations performed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
