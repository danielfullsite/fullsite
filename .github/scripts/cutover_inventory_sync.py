#!/usr/bin/env python3
"""
Cutover Inventory Sync: Wansoft → Fullsite POS
Corre el día del cutover para cargar stock real de Wansoft en pos_inventory.

Pasos:
1. Jala inventory_parsed fresco de Wansoft (o usa el guardado en wansoft_data)
2. Matchea con pos_ingredients existentes por nombre normalizado
3. Actualiza stock en pos_inventory
4. Crea ingredientes nuevos que no existan
5. Registra movimiento de tipo 'sync_cutover' en pos_inventory_movements

Uso:
  python cutover_inventory_sync.py                    # Dry run (solo muestra)
  python cutover_inventory_sync.py --execute          # Ejecuta el sync
  python cutover_inventory_sync.py --execute --fresh  # Scrapea de Wansoft primero
"""

import os
import sys
import json
import re
import requests
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qjiomlvudfmzuvqvhwpk.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "amalay")

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

MX_TZ = timezone(timedelta(hours=-6))

# Wansoft almacenes to include (skip VENTA_TERCEROS)
INCLUDE_ALMACENES = {"COCINA", "BARRA", "PANADERIA", "MARKET"}

# Departamento → category mapping
DEPTO_TO_CATEGORY = {
    "ABARROTES": "abarrote", "SECOS": "abarrote",
    "PROTEINA ANIMAL": "proteina", "LAC/CARNES/PESC": "proteina",
    "LACTEOS": "lacteo", "CONGELADOS": "congelado",
    "FRUTAS Y VERDURAS": "fruta_verdura", "PULPAS": "fruta_verdura",
    "BEBIDAS": "bebida", "CERVEZAS": "bebida",
    "PANADERIA": "panaderia", "SUBS COCINA": "sub_receta",
    "DESECHABLES Y QUIMICOS": "desechable", "EMPAQUE": "desechable",
    "PRODUCTOS MARKET": "market", "ALIMENTOS MARKET": "market",
    "MARCA PROPIA": "market", "GRANEL": "market",
    "4 BUDDIES": "market", "AMAZON": "market",
}

# Unit inference from departamento / product name
def infer_unit(item):
    name = item["producto"].upper()
    if any(k in name for k in ["PZA", "PIEZA", "PAQUETE", "PAQ", "BOLSA", "BOTELLA", "BOTE", "LATA", "CAJA", "CHAROLA", "ROLLO"]):
        return "pz"
    if any(k in name for k in [" LT", "LITRO", " L "]):
        return "lt"
    if any(k in name for k in [" ML", "MILILITRO"]):
        return "ml"
    if any(k in name for k in [" GR", "GRAMO"]):
        return "g"
    depto = item.get("departamento", "")
    if depto in ("FRUTAS Y VERDURAS", "PROTEINA ANIMAL", "LAC/CARNES/PESC", "LACTEOS", "CONGELADOS"):
        return "kg"
    if depto in ("BEBIDAS", "PULPAS", "CERVEZAS"):
        return "lt"
    return "kg"  # default


def normalize_name(name):
    """Normalize ingredient name for matching."""
    n = name.strip().upper()
    n = re.sub(r'\s+', ' ', n)
    # Remove common prefixes
    n = re.sub(r'^SUB\s+', '', n)
    return n


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=SB_HEADERS, params=params, timeout=15)
    return r.json() if r.ok else []


def sb_post(table, data, upsert=False):
    headers = dict(SB_HEADERS)
    if upsert:
        headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    else:
        headers["Prefer"] = "return=representation"
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, json=data, timeout=15)
    return r.json() if r.ok else None


def sb_patch(table, match_params, data):
    headers = dict(SB_HEADERS)
    headers["Prefer"] = "return=minimal"
    params_str = "&".join(f"{k}={v}" for k, v in match_params.items())
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{table}?{params_str}", headers=headers, json=data, timeout=15)
    return r.ok


# ── Step 1: Get Wansoft inventory ────────────────────────────────────

def get_wansoft_inventory(fresh=False):
    """Get inventory data. If fresh, scrape from Wansoft. Otherwise use wansoft_data."""
    if fresh:
        print("[sync] Scraping fresh inventory from Wansoft...")
        # Import the sync script to get fresh data
        sys.path.insert(0, os.path.dirname(__file__))
        from wansoft_inventory_sync import main as sync_main
        sync_main()
        print("[sync] Fresh scrape done, reading from wansoft_data...")

    # Read inventory_parsed from wansoft_data
    rows = sb_get("wansoft_data", {
        "select": "data",
        "client_id": f"eq.{CLIENT_ID}",
        "data_key": "eq.inventory_parsed",
        "order": "fecha.desc",
        "limit": "1",
    })
    if not rows:
        # Fallback: read local file
        local = os.path.join(os.path.dirname(__file__), "inventory_parsed.json")
        if os.path.exists(local):
            print(f"[sync] Using local file: {local}")
            with open(local) as f:
                return json.load(f)
        print("[sync] ERROR: No inventory data found")
        return []

    data = rows[0]["data"]
    if isinstance(data, str):
        data = json.loads(data)
    print(f"[sync] Loaded {len(data)} items from wansoft_data")
    return data


def get_reorder_points():
    """Get reorder points from wansoft_data."""
    rows = sb_get("wansoft_data", {
        "select": "data",
        "client_id": f"eq.{CLIENT_ID}",
        "data_key": "eq.reorder_points",
        "order": "fecha.desc",
        "limit": "1",
    })
    if not rows:
        return {}
    data = rows[0]["data"]
    if isinstance(data, str):
        data = json.loads(data)
    # Build lookup by product code
    reorder = {}
    if isinstance(data, list):
        for item in data:
            code = item.get("codigo") or item.get("code") or item.get("ProductCode", "")
            minimo = item.get("minimo") or item.get("Minimum") or 0
            maximo = item.get("maximo") or item.get("Maximum") or 0
            if code:
                reorder[code.strip().upper()] = {"min": float(minimo or 0), "max": float(maximo or 0)}
    elif isinstance(data, dict):
        for warehouse_data in data.values():
            if isinstance(warehouse_data, list):
                for item in warehouse_data:
                    code = item.get("codigo") or item.get("code") or item.get("ProductCode", "")
                    minimo = item.get("minimo") or item.get("Minimum") or 0
                    if code:
                        reorder[code.strip().upper()] = {"min": float(minimo or 0), "max": float(minimo or 0) * 2}
    print(f"[sync] Loaded {len(reorder)} reorder points")
    return reorder


# ── Step 2: Get existing Fullsite ingredients ────────────────────────

def get_existing_ingredients():
    """Fetch all pos_ingredients for this client."""
    ingredients = []
    offset = 0
    while True:
        batch = sb_get("pos_ingredients", {
            "client_id": f"eq.{CLIENT_ID}",
            "select": "id,name,unit,cost_per_unit,category",
            "limit": "1000",
            "offset": str(offset),
        })
        if not batch:
            break
        ingredients.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"[sync] Existing pos_ingredients: {len(ingredients)}")
    return ingredients


def get_existing_inventory():
    """Fetch all pos_inventory for this client."""
    inventory = []
    offset = 0
    while True:
        batch = sb_get("pos_inventory", {
            "client_id": f"eq.{CLIENT_ID}",
            "select": "ingredient_id,stock,reorder_point,reorder_quantity",
            "limit": "1000",
            "offset": str(offset),
        })
        if not batch:
            break
        inventory.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"[sync] Existing pos_inventory: {len(inventory)}")
    return inventory


# ── Step 3: Match and merge ──────────────────────────────────────────

def build_sync_plan(wansoft_items, existing_ingredients, existing_inventory, reorder_points):
    """Build a plan of what to create/update."""

    # Build normalized name → ingredient lookup
    name_to_ingredient = {}
    for ing in existing_ingredients:
        norm = normalize_name(ing["name"])
        name_to_ingredient[norm] = ing

    # Build ingredient_id → inventory lookup
    inv_by_ingredient = {inv["ingredient_id"]: inv for inv in existing_inventory}

    # Aggregate Wansoft items by product (sum across warehouses)
    # Some products appear in multiple almacenes (e.g. ACEITE VEGETAL in COCINA + PANADERIA)
    product_agg = {}
    for item in wansoft_items:
        if item["almacen"] not in INCLUDE_ALMACENES:
            continue
        if item["inv_final_qty"] == 0 and item["costo_promedio"] == 0:
            continue  # Skip zero-everything items

        code = item["codigo"].strip().upper()
        name = item["producto"].strip()
        key = normalize_name(name)

        if key not in product_agg:
            product_agg[key] = {
                "code": code,
                "name": name,
                "qty": 0,
                "cost": item["costo_promedio"],
                "depto": item["departamento"],
                "almacen": item["almacen"],
                "unit": infer_unit(item),
            }
        product_agg[key]["qty"] += item["inv_final_qty"]
        # Keep highest cost (most recent)
        if item["costo_promedio"] > 0:
            product_agg[key]["cost"] = item["costo_promedio"]

    print(f"[sync] Wansoft products (aggregated): {len(product_agg)}")

    # Build plan
    plan = {
        "update_stock": [],       # ingredient exists + inventory exists → update stock
        "create_inventory": [],   # ingredient exists but no inventory row → insert
        "create_ingredient": [],  # ingredient doesn't exist → create both
        "skipped": [],            # already correct
    }

    for norm_name, wdata in product_agg.items():
        qty = round(wdata["qty"], 4)
        cost = round(wdata["cost"], 2)
        category = DEPTO_TO_CATEGORY.get(wdata["depto"], "otro")
        reorder = reorder_points.get(wdata["code"], {})
        reorder_min = reorder.get("min", 0)

        matched = name_to_ingredient.get(norm_name)

        if matched:
            ing_id = matched["id"]
            existing_inv = inv_by_ingredient.get(ing_id)

            if existing_inv:
                old_stock = existing_inv["stock"]
                if abs(old_stock - qty) < 0.01:
                    plan["skipped"].append({"name": wdata["name"], "stock": qty})
                else:
                    plan["update_stock"].append({
                        "ingredient_id": ing_id,
                        "name": wdata["name"],
                        "old_stock": old_stock,
                        "new_stock": qty,
                        "cost": cost,
                        "reorder_point": reorder_min,
                    })
            else:
                plan["create_inventory"].append({
                    "ingredient_id": ing_id,
                    "name": wdata["name"],
                    "stock": qty,
                    "cost": cost,
                    "reorder_point": reorder_min,
                })
        else:
            # Generate ID from name
            ing_id = re.sub(r'[^a-z0-9_]', '_', wdata["name"].lower().strip())
            ing_id = re.sub(r'_+', '_', ing_id).strip('_')
            plan["create_ingredient"].append({
                "ingredient_id": ing_id,
                "name": wdata["name"],
                "unit": wdata["unit"],
                "cost": cost,
                "category": category,
                "stock": qty,
                "reorder_point": reorder_min,
            })

    return plan


# ── Step 4: Execute ──────────────────────────────────────────────────

def execute_plan(plan, dry_run=True):
    now = datetime.now(MX_TZ).isoformat()
    total_ops = len(plan["update_stock"]) + len(plan["create_inventory"]) + len(plan["create_ingredient"])

    print(f"\n{'=' * 60}")
    print(f"SYNC PLAN — {datetime.now(MX_TZ).strftime('%Y-%m-%d %H:%M')}")
    print(f"{'=' * 60}")
    print(f"  Update stock:        {len(plan['update_stock'])}")
    print(f"  Create inventory:    {len(plan['create_inventory'])}")
    print(f"  Create ingredient:   {len(plan['create_ingredient'])}")
    print(f"  Already correct:     {len(plan['skipped'])}")
    print(f"  TOTAL operations:    {total_ops}")
    print(f"  Mode:                {'DRY RUN' if dry_run else 'EXECUTING'}")
    print(f"{'=' * 60}\n")

    if dry_run:
        # Show details
        if plan["update_stock"]:
            print("STOCK UPDATES:")
            for item in plan["update_stock"][:20]:
                print(f"  {item['name']}: {item['old_stock']} → {item['new_stock']}")
            if len(plan["update_stock"]) > 20:
                print(f"  ... and {len(plan['update_stock']) - 20} more")

        if plan["create_ingredient"]:
            print("\nNEW INGREDIENTS:")
            for item in plan["create_ingredient"][:20]:
                print(f"  {item['name']} ({item['unit']}, ${item['cost']}) stock={item['stock']}")
            if len(plan["create_ingredient"]) > 20:
                print(f"  ... and {len(plan['create_ingredient']) - 20} more")

        print(f"\nRun with --execute to apply changes.")
        return

    # Execute updates
    success = 0
    errors = 0

    # 1. Update existing stock
    for item in plan["update_stock"]:
        ok = sb_patch("pos_inventory", {
            "client_id": f"eq.{CLIENT_ID}",
            "ingredient_id": f"eq.{item['ingredient_id']}",
        }, {
            "stock": item["new_stock"],
            "reorder_point": item["reorder_point"],
            "updated_at": now,
        })
        if ok:
            # Log movement
            sb_post("pos_inventory_movements", {
                "client_id": CLIENT_ID,
                "ingredient_id": item["ingredient_id"],
                "movement_type": "sync_cutover",
                "quantity": item["new_stock"] - item["old_stock"],
                "actor": "cutover_sync",
                "notes": f"Wansoft sync: {item['old_stock']} → {item['new_stock']}",
            })
            # Update cost
            sb_patch("pos_ingredients", {
                "client_id": f"eq.{CLIENT_ID}",
                "id": f"eq.{item['ingredient_id']}",
            }, {"cost_per_unit": item["cost"]})
            success += 1
        else:
            errors += 1
            print(f"  ERROR updating {item['name']}")

    # 2. Create inventory for existing ingredients
    for item in plan["create_inventory"]:
        result = sb_post("pos_inventory", {
            "client_id": CLIENT_ID,
            "ingredient_id": item["ingredient_id"],
            "stock": item["stock"],
            "reorder_point": item["reorder_point"],
            "reorder_quantity": item["reorder_point"] * 2,
            "updated_at": now,
        })
        if result:
            sb_post("pos_inventory_movements", {
                "client_id": CLIENT_ID,
                "ingredient_id": item["ingredient_id"],
                "movement_type": "sync_cutover",
                "quantity": item["stock"],
                "actor": "cutover_sync",
                "notes": f"Initial stock from Wansoft: {item['stock']}",
            })
            sb_patch("pos_ingredients", {
                "client_id": f"eq.{CLIENT_ID}",
                "id": f"eq.{item['ingredient_id']}",
            }, {"cost_per_unit": item["cost"]})
            success += 1
        else:
            errors += 1
            print(f"  ERROR creating inventory for {item['name']}")

    # 3. Create new ingredients + inventory
    for item in plan["create_ingredient"]:
        # Create ingredient
        result = sb_post("pos_ingredients", {
            "id": item["ingredient_id"],
            "client_id": CLIENT_ID,
            "name": item["name"],
            "unit": item["unit"],
            "cost_per_unit": item["cost"],
            "category": item["category"],
            "active": True,
        })
        if result:
            # Create inventory
            sb_post("pos_inventory", {
                "client_id": CLIENT_ID,
                "ingredient_id": item["ingredient_id"],
                "stock": item["stock"],
                "reorder_point": item["reorder_point"],
                "reorder_quantity": item["reorder_point"] * 2,
                "updated_at": now,
            })
            sb_post("pos_inventory_movements", {
                "client_id": CLIENT_ID,
                "ingredient_id": item["ingredient_id"],
                "movement_type": "sync_cutover",
                "quantity": item["stock"],
                "actor": "cutover_sync",
                "notes": f"New ingredient from Wansoft cutover",
            })
            success += 1
        else:
            errors += 1
            print(f"  ERROR creating ingredient {item['name']}")

    print(f"\n{'=' * 60}")
    print(f"DONE: {success} success, {errors} errors")
    print(f"{'=' * 60}")


# ── Main ─────────────────────────────────────────────────────────────

def main():
    execute = "--execute" in sys.argv
    fresh = "--fresh" in sys.argv

    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_SERVICE_KEY env var")
        sys.exit(1)

    # 1. Get Wansoft data
    wansoft_items = get_wansoft_inventory(fresh=fresh)
    if not wansoft_items:
        print("No inventory data. Aborting.")
        sys.exit(1)

    reorder_points = get_reorder_points()

    # 2. Get existing Fullsite data
    existing_ingredients = get_existing_ingredients()
    existing_inventory = get_existing_inventory()

    # 3. Build plan
    plan = build_sync_plan(wansoft_items, existing_ingredients, existing_inventory, reorder_points)

    # 4. Execute (or dry run)
    execute_plan(plan, dry_run=not execute)


if __name__ == "__main__":
    main()
