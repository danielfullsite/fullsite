#!/usr/bin/env python3
"""Fail when cloneable runtime code introduces an unclassified AMALAY hardcode.

The scanner intentionally looks for tenant identity/defaults and production
project references, not branding prose. Every accepted runtime exception must
be documented in hardcode_allowlist.json with an exact rule and rationale.
"""

from __future__ import annotations

import fnmatch
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = ROOT / "scripts" / "hardcode_allowlist.json"
SOURCE_SUFFIXES = {".cjs", ".html", ".js", ".jsx", ".mjs", ".py", ".sh", ".toml", ".ts", ".tsx", ".yaml", ".yml"}

SKIP_GLOBS = (
    "docs/**",
    "**/__tests__/**",
    "**/tests/**",
    "**/test/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/test_*",
    "**/test-*",
    "**/seeds/**",
    "scripts/cert/**",
    "scripts/demo/**",
    "scripts/tenant-isolation/**",
    "onboarding-reports/**",
    "graphify-out/**",
    ".claude/**",
)


@dataclass(frozen=True)
class Rule:
    name: str
    pattern: re.Pattern[str]


RULES = (
    Rule("production_project_ref", re.compile(r"qjiomlvudfmzuvqvhwpk")),
    Rule(
        "amalay_tenant_assignment",
        re.compile(
            r"(?:client_id|clientId|CLIENT_ID|defaultClientId)\s*[:=]\s*['\"]amalay['\"]"
            r"|\.eq\(\s*['\"]client_id['\"]\s*,\s*['\"]amalay['\"]\s*\)",
            re.IGNORECASE,
        ),
    ),
    Rule(
        "amalay_tenant_fallback",
        re.compile(r"(?:\|\||\bor\b)\s*['\"]amalay['\"]", re.IGNORECASE),
    ),
    Rule(
        "amalay_tenant_comparison",
        re.compile(
            r"(?:client_id|clientId|CLIENT_ID|_cid\(\))\s*(?:===|!==|==|!=)\s*['\"]amalay['\"]",
            re.IGNORECASE,
        ),
    ),
    Rule("amalay_static_option", re.compile(r"<option[^>]+value\s*=\s*['\"]amalay['\"]", re.IGNORECASE)),
    Rule(
        "browser_embedded_jwt",
        re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    ),
)


def tracked_files() -> list[str]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT, stderr=subprocess.DEVNULL
    )
    return [part.decode() for part in output.split(b"\0") if part]


def should_scan(path: str) -> bool:
    if Path(path).suffix.lower() not in SOURCE_SUFFIXES:
        return False
    return not any(fnmatch.fnmatch(path, pattern) for pattern in SKIP_GLOBS)


def load_allowlist() -> list[dict[str, str]]:
    raw = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    entries = raw.get("entries", [])
    for entry in entries:
        if not all(entry.get(key) for key in ("path", "rule", "reason")):
            raise ValueError("Every hardcode allowlist entry needs path, rule and reason")
        if entry["rule"] not in {rule.name for rule in RULES}:
            raise ValueError(f"Unknown allowlist rule: {entry['rule']}")
    return entries


def allowed(path: str, rule: str, entries: list[dict[str, str]]) -> bool:
    return any(
        entry["rule"] == rule and fnmatch.fnmatch(path, entry["path"])
        for entry in entries
    )


def main() -> int:
    entries = load_allowlist()
    findings: list[tuple[str, int, str, str]] = []
    accepted = 0
    scanned = 0

    for relative in tracked_files():
        if not should_scan(relative):
            continue
        path = ROOT / relative
        if not path.is_file():
            continue
        scanned += 1
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(lines, start=1):
            stripped = line.lstrip()
            if stripped.startswith(("#", "//", "/*", "*", "<!--")):
                continue
            for rule in RULES:
                if rule.name == "browser_embedded_jwt" and not relative.startswith("dashboard-app/public/"):
                    continue
                if not rule.pattern.search(line):
                    continue
                if allowed(relative, rule.name, entries):
                    accepted += 1
                else:
                    findings.append((relative, line_number, rule.name, line.strip()))

    if findings:
        print(f"HARDCODE_GATE=FAIL scanned={scanned} accepted={accepted} violations={len(findings)}")
        for path, line, rule, source in findings:
            print(f"{path}:{line}: [{rule}] {source[:180]}")
        return 1

    print(f"HARDCODE_GATE=PASS scanned={scanned} accepted={accepted} violations=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
