"""Supabase client — UPSERT wansoft_catalog rows."""

import json
import os

from supabase import create_client


def upsert_catalog(portal_map: dict):
    """
    UPSERT all items from portal_map into Supabase wansoft_catalog table.
    Graceful degradation: logs errors but does not crash.
    """
    print(f"\n[supabase] === Upserting catalog to Supabase ===")

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("[supabase] WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set — skipping")
        return False

    try:
        client = create_client(url, key)
    except Exception as e:
        print(f"[supabase] ERROR creating client: {e}")
        return False

    version = portal_map.get("explorer_version", "1.0.0")
    explored_at = portal_map.get("explored_at")
    items = portal_map.get("items", [])

    success_count = 0
    error_count = 0

    for item in items:
        row = {
            "explored_at": explored_at,
            "explorer_version": version,
            "path": item["path"],
            "parent_path": item.get("parent_path"),
            "level": item["level"],
            "item_type": item["item_type"],
            "ui_label": item.get("ui_label"),
            "ui_selector": item.get("ui_selector"),
            "screenshot_path": item.get("screenshot_path"),
            "has_export": item.get("has_export", False),
            "export_format": item.get("export_format"),
            "xlsx_sheets": json.dumps(item["xlsx_sheets"]) if item.get("xlsx_sheets") else None,
            "xlsx_sample_path": item.get("xlsx_sample_path"),
            "endpoints": json.dumps(item["endpoints"]) if item.get("endpoints") else None,
            "filters": json.dumps(item["filters"]) if item.get("filters") else None,
            "notes": item.get("notes"),
        }

        try:
            client.table("wansoft_catalog").upsert(
                row, on_conflict="path,explorer_version"
            ).execute()
            success_count += 1
        except Exception as e:
            error_count += 1
            if error_count <= 3:
                print(f"[supabase]   ERROR upserting {item['path']}: {e}")

    print(f"[supabase] Done: {success_count} upserted, {error_count} errors")
    return error_count == 0
