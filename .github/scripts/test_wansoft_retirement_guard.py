#!/usr/bin/env python3
"""Regression checks for the Wansoft retirement guard; no network is used."""

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WORKFLOWS = ROOT.parent / "workflows"
sys.path.insert(0, str(ROOT))
os.environ.setdefault("SUPABASE_URL", "https://example.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")

import client_config
import wansoft_auth


def expect_retired(callable_):
    try:
        callable_()
    except (client_config.WansoftLegacyRetired, wansoft_auth.WansoftLegacyRetired):
        return
    raise AssertionError("retired legacy access was not blocked")


def main():
    os.environ.pop("FULLSITE_WANSOFT_LEGACY_ACCESS", None)
    expect_retired(lambda: client_config.get_wansoft_creds({}))
    expect_retired(lambda: wansoft_auth._load_cookies("test-client"))
    expect_retired(lambda: wansoft_auth.store_cookies("test-client", "cookie"))

    os.environ["FULLSITE_WANSOFT_LEGACY_ACCESS"] = "archive_import_only"
    expect_retired(lambda: client_config.get_wansoft_creds({}))

    active_workflows = {path.name for path in WORKFLOWS.glob("*.yml")}
    retired = {
        "intraday-sales.yml",
        "menu-gap-analysis.yml",
        "ticket-detail.yml",
        "wansoft-backfill.yml",
        "wansoft-browser.yml",
        "wansoft-daily-mesero.yml",
        "wansoft-data-audit.yml",
        "wansoft-deep.yml",
        "wansoft-discovery.yml",
        "wansoft-export-discovery.yml",
        "wansoft-inv-scrape.yml",
        "wansoft-inventory.yml",
        "wansoft-mega.yml",
        "wansoft-menu-sync.yml",
        "wansoft-probe.yml",
        "wansoft-query.yml",
        "wansoft-recipes.yml",
        "wansoft-sales-probe.yml",
        "wansoft-staleness.yml",
        "wansoft-subproducts.yml",
    }
    assert not retired & active_workflows
    assert "wansoft-cargar-extracto.yml" in active_workflows

    print("PASS: Wansoft retirement guard is fail-closed")


if __name__ == "__main__":
    main()
