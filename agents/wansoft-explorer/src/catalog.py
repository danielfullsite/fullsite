"""Catalog — consolidate all discovered items into portal_map.json."""

import json
import os
from dataclasses import asdict
from datetime import datetime, timezone

from .crawler import MenuItem

EXPLORER_VERSION = "1.0.0"


def build_catalog(items: list[MenuItem], xlsx_schemas: dict, output_dir: str = "output") -> dict:
    """
    Build the final portal_map.json from crawled items and XLSX schemas.
    """
    print(f"\n[catalog] === Paso 6: Building catalog ===")

    catalog_items = []
    for item in items:
        entry = {
            "path": item.path,
            "parent_path": item.parent_path,
            "level": item.level,
            "item_type": item.item_type,
            "ui_label": item.ui_label,
            "ui_selector": item.ui_selector,
            "screenshot_path": item.screenshot_path,
            "has_export": item.has_export,
            "export_format": item.export_format if item.has_export else None,
            "xlsx_sheets": None,
            "xlsx_sample_path": None,
            "endpoints": item.endpoints,
            "filters": item.filters,
            "notes": item.notes or None,
        }

        # Attach XLSX schema if available
        if item.path in xlsx_schemas:
            schema = xlsx_schemas[item.path]
            entry["xlsx_sheets"] = schema.get("sheets")
            entry["xlsx_sample_path"] = schema.get("file_path")

        catalog_items.append(entry)

    portal_map = {
        "explored_at": datetime.now(timezone.utc).isoformat(),
        "explorer_version": EXPLORER_VERSION,
        "total_items": len(catalog_items),
        "items": catalog_items,
    }

    # Save to disk
    path = os.path.join(output_dir, "portal_map.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(portal_map, f, indent=2, ensure_ascii=False)
    print(f"[catalog] Saved portal_map.json with {len(catalog_items)} items")

    # Also save endpoints.json separately
    all_endpoints = {}
    for item in items:
        for ep in item.endpoints:
            key = f"{ep['method']} {ep['url']}"
            if key not in all_endpoints:
                all_endpoints[key] = {
                    "method": ep["method"],
                    "url": ep["url"],
                    "params": ep.get("params", []),
                    "seen_in": [],
                }
            all_endpoints[key]["seen_in"].append(item.path)

    endpoints_path = os.path.join(output_dir, "endpoints.json")
    with open(endpoints_path, "w", encoding="utf-8") as f:
        json.dump(list(all_endpoints.values()), f, indent=2, ensure_ascii=False)
    print(f"[catalog] Saved endpoints.json with {len(all_endpoints)} unique endpoints")

    return portal_map
