#!/usr/bin/env python3
"""
Migra datos extraídos de Wansoft (JSONs) a SQL para Supabase.
Genera 1 archivo SQL por tabla. Ejecutar cada uno en SQL Editor.

Tablas:
1. pos_suppliers — 202 proveedores
2. pos_recipes_old — 615 recetas (platillo → ingredientes)
3. pos_inventory_products — 745 existencias (stock al 7 jul 2026)
"""

import json
import re
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WANSOFT = os.path.join(BASE, "agents", "wansoft")
OUT = os.path.join(BASE, "scripts", "sql")
os.makedirs(OUT, exist_ok=True)

CLIENT_ID = "amalay"


def esc(s):
    """Escape single quotes for SQL."""
    if s is None:
        return "NULL"
    s = str(s).strip()
    if not s:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def is_rfc(s):
    """Heuristic: looks like a Mexican RFC."""
    if not s:
        return False
    s = s.strip()
    # RFC pattern: 3-4 letters + 6 digits + 3 alphanumeric
    return bool(re.match(r'^[A-Z]{3,4}\d{6}[A-Z0-9]{3}$', s))


# ═══════════════════════════════════════════════════════════════
# 1. PROVEEDORES → pos_suppliers
# ═══════════════════════════════════════════════════════════════
def migrate_proveedores():
    with open(os.path.join(WANSOFT, "wansoft_proveedores.json")) as f:
        data = json.load(f)

    rows = []
    seen_names = set()

    for p in data:
        # Los campos del scraper están corridos:
        # JSON "rfc" = nombre real del proveedor
        # JSON "nombre" = RFC (a veces)
        # JSON "telefono" = RFC duplicado o teléfono
        # JSON "email" = teléfono real
        # JSON "giro" = email real
        # JSON "dias_credito" = giro/categoría (cuando es string)

        name = str(p.get("rfc", "")).strip()
        if not name:
            continue

        # Dedup
        name_key = name.upper()
        if name_key in seen_names:
            continue
        seen_names.add(name_key)

        # RFC: buscar en "nombre" o "telefono"
        rfc = None
        for field in ["nombre", "telefono"]:
            val = str(p.get(field, "")).strip()
            if is_rfc(val):
                rfc = val
                break

        # Teléfono real está en "email"
        phone = str(p.get("email", "")).strip()
        if phone and not re.search(r'\d{7,}', phone):
            phone = ""  # No parece teléfono

        # Email real está en "giro"
        email = str(p.get("giro", "")).strip()
        if email and "@" not in email:
            email = ""  # No parece email

        # Giro/categoría está en "dias_credito" (cuando es string)
        giro = ""
        dc = p.get("dias_credito", 0)
        if isinstance(dc, str) and dc.strip():
            giro = dc.strip()

        rows.append({
            "name": name,
            "rfc": rfc,
            "phone": phone,
            "email": email,
            "category": giro,
        })

    # Generar SQL
    lines = [
        "-- Migración Wansoft → pos_suppliers",
        f"-- {len(rows)} proveedores únicos",
        "-- Ejecutar en Supabase SQL Editor",
        "",
        "-- Crear tabla si no existe",
        "CREATE TABLE IF NOT EXISTS pos_suppliers (",
        "  id BIGSERIAL PRIMARY KEY,",
        "  client_id TEXT DEFAULT 'amalay',",
        "  name TEXT NOT NULL,",
        "  rfc TEXT,",
        "  phone TEXT,",
        "  email TEXT,",
        "  category TEXT,",
        "  active BOOLEAN DEFAULT TRUE,",
        "  created_at TIMESTAMPTZ DEFAULT NOW(),",
        "  UNIQUE(client_id, name)",
        ");",
        "",
        "ALTER TABLE pos_suppliers ENABLE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS \"anon_read_suppliers\" ON pos_suppliers;",
        "DROP POLICY IF EXISTS \"anon_insert_suppliers\" ON pos_suppliers;",
        "DROP POLICY IF EXISTS \"anon_update_suppliers\" ON pos_suppliers;",
        "CREATE POLICY \"anon_read_suppliers\" ON pos_suppliers FOR SELECT TO anon USING (true);",
        "CREATE POLICY \"anon_insert_suppliers\" ON pos_suppliers FOR INSERT TO anon WITH CHECK (true);",
        "CREATE POLICY \"anon_update_suppliers\" ON pos_suppliers FOR UPDATE TO anon USING (true);",
        "",
        f"INSERT INTO pos_suppliers (client_id, name, rfc, phone, email, category)",
        "VALUES",
    ]

    vals = []
    for r in rows:
        vals.append(f"  ('{CLIENT_ID}', {esc(r['name'])}, {esc(r['rfc'])}, {esc(r['phone'])}, {esc(r['email'])}, {esc(r['category'])})")

    lines.append(",\n".join(vals))
    lines.append("ON CONFLICT (client_id, name) DO UPDATE SET")
    lines.append("  rfc = EXCLUDED.rfc,")
    lines.append("  phone = EXCLUDED.phone,")
    lines.append("  email = EXCLUDED.email,")
    lines.append("  category = EXCLUDED.category;")

    path = os.path.join(OUT, "01-proveedores.sql")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[1] {path} — {len(rows)} proveedores")


# ═══════════════════════════════════════════════════════════════
# 2. RECETAS → pos_recipes_old
# ═══════════════════════════════════════════════════════════════
def migrate_recetas():
    with open(os.path.join(WANSOFT, "wansoft_recetas.json")) as f:
        data = json.load(f)

    # pos_recipes_old schema:
    # client_id, menu_item_id, menu_item_name, ingredient_id, quantity, unit

    lines = [
        "-- Migración Wansoft → pos_recipes_old",
        f"-- {len(data)} platillos con ingredientes",
        "-- Ejecutar en Supabase SQL Editor",
        "",
        "-- Crear tabla si no existe",
        "CREATE TABLE IF NOT EXISTS pos_recipes_old (",
        "  id BIGSERIAL PRIMARY KEY,",
        "  client_id TEXT DEFAULT 'amalay',",
        "  menu_item_id TEXT NOT NULL,",
        "  menu_item_name TEXT,",
        "  ingredient_id TEXT NOT NULL,",
        "  quantity NUMERIC DEFAULT 0,",
        "  unit TEXT DEFAULT 'kg',",
        "  UNIQUE(client_id, menu_item_id, ingredient_id)",
        ");",
        "",
        "ALTER TABLE pos_recipes_old ENABLE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS \"anon_read_recipes\" ON pos_recipes_old;",
        "DROP POLICY IF EXISTS \"anon_insert_recipes\" ON pos_recipes_old;",
        "DROP POLICY IF EXISTS \"anon_update_recipes\" ON pos_recipes_old;",
        "DROP POLICY IF EXISTS \"anon_delete_recipes\" ON pos_recipes_old;",
        "CREATE POLICY \"anon_read_recipes\" ON pos_recipes_old FOR SELECT TO anon USING (true);",
        "CREATE POLICY \"anon_insert_recipes\" ON pos_recipes_old FOR INSERT TO anon WITH CHECK (true);",
        "CREATE POLICY \"anon_update_recipes\" ON pos_recipes_old FOR UPDATE TO anon USING (true);",
        "CREATE POLICY \"anon_delete_recipes\" ON pos_recipes_old FOR DELETE TO anon USING (true);",
        "",
    ]

    total_ingredients = 0
    vals = []

    for dish in data:
        code = dish.get("code", "").strip()
        name = dish.get("dish", "").strip()
        ingredients = dish.get("ingredients", [])

        if not code or not ingredients:
            continue

        menu_item_id = code.lower()

        for ing in ingredients:
            product = ing.get("product", "").strip()
            if not product:
                continue
            ingredient_id = re.sub(r'[^a-z0-9]+', '_', product.lower()).strip('_')
            qty = ing.get("qty", 0)
            unit = ing.get("unit", "KG").lower()

            vals.append(f"  ('{CLIENT_ID}', {esc(menu_item_id)}, {esc(name)}, {esc(ingredient_id)}, {qty}, {esc(unit)})")
            total_ingredients += 1

    # Split into batches of 500 to avoid SQL limits
    batch_size = 500
    for i in range(0, len(vals), batch_size):
        batch = vals[i:i + batch_size]
        if i == 0:
            lines.append(f"-- Total: {total_ingredients} ingredientes en {len(data)} platillos")
            lines.append("")
        lines.append(f"INSERT INTO pos_recipes_old (client_id, menu_item_id, menu_item_name, ingredient_id, quantity, unit)")
        lines.append("VALUES")
        lines.append(",\n".join(batch))
        lines.append("ON CONFLICT (client_id, menu_item_id, ingredient_id) DO UPDATE SET")
        lines.append("  quantity = EXCLUDED.quantity,")
        lines.append("  unit = EXCLUDED.unit,")
        lines.append("  menu_item_name = EXCLUDED.menu_item_name;")
        lines.append("")

    path = os.path.join(OUT, "02-recetas.sql")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[2] {path} — {len(data)} platillos, {total_ingredients} ingredientes")


# ═══════════════════════════════════════════════════════════════
# 3. EXISTENCIAS → pos_inventory_products
# ═══════════════════════════════════════════════════════════════
def migrate_existencias():
    with open(os.path.join(WANSOFT, "wansoft_existencias_20260707.json")) as f:
        data = json.load(f)

    # pos_inventory_products schema:
    # client_id, name, unit, cost_per_unit, stock, reorder_point, category, active

    lines = [
        "-- Migración Wansoft → pos_inventory_products",
        f"-- {len(data)} productos con stock al 2026-07-07",
        "-- Ejecutar en Supabase SQL Editor",
        "-- NOTA: tabla ya creada por create_pos_inventory_products.sql",
        "",
    ]

    vals = []
    for item in data:
        name = item.get("product", "").strip()
        if not name:
            continue

        unit_raw = item.get("unit", "Kilogramo").strip()
        # Normalizar unidades
        unit_map = {
            "Kilogramo": "KG", "Gramo": "GR", "Litro": "LT",
            "Mililitro": "ML", "Pieza": "PZ", "Porción": "PORCION",
            "Sobre": "SOBRE", "Bolsa": "BOLSA", "Paquete": "PAQUETE",
            "Bote": "BOTE", "Caja": "CAJA", "Rollo": "ROLLO",
            "Galón": "GALON", "Metro": "MT",
        }
        unit = unit_map.get(unit_raw, unit_raw.upper())

        stock = item.get("stock", 0)
        value = item.get("value", 0)
        cost_per_unit = round(value / stock, 2) if stock and stock > 0 else 0
        category = item.get("department", "").strip()
        code = item.get("code", "").strip()

        vals.append(f"  ('{CLIENT_ID}', {esc(name)}, {esc(unit)}, {cost_per_unit}, {stock}, 0, {esc(category)})")

    batch_size = 500
    for i in range(0, len(vals), batch_size):
        batch = vals[i:i + batch_size]
        lines.append(f"INSERT INTO pos_inventory_products (client_id, name, unit, cost_per_unit, stock, reorder_point, category)")
        lines.append("VALUES")
        lines.append(",\n".join(batch))
        lines.append("ON CONFLICT (client_id, name) DO UPDATE SET")
        lines.append("  stock = EXCLUDED.stock,")
        lines.append("  cost_per_unit = EXCLUDED.cost_per_unit,")
        lines.append("  category = EXCLUDED.category,")
        lines.append("  unit = EXCLUDED.unit,")
        lines.append("  updated_at = NOW();")
        lines.append("")

    path = os.path.join(OUT, "03-existencias.sql")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[3] {path} — {len(data)} productos con stock")


# ═══════════════════════════════════════════════════════════════
# RUN ALL
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    migrate_proveedores()
    migrate_recetas()
    migrate_existencias()
    print(f"\nSQL generado en {OUT}/")
    print("Ejecutar en orden: 01, 02, 03 en Supabase SQL Editor")
