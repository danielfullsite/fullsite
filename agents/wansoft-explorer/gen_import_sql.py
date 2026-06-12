"""Genera SQL de importación del catálogo real de Wansoft al POS Fullsite.

Lee output/catalog_fresh.json + snapshots del POS (/tmp/pos_items.json,
/tmp/pos_cats.json) y produce un .sql para correr en Supabase SQL Editor.
"""

import json
import re
import sys
import unicodedata
from collections import defaultdict

CLIENT = "amalay"

# Wansoft grupo -> categoria POS (existente o nueva)
CAT_MAP = {
    "ACTIVACIONES": "activaciones",
    "CEVICHE": "ceviche",
    "EGGS & KETO": "eggs",
    "ENCHILADAS & TACOS": "enchiladas-tacos",
    "EVERYDAY SPECIALS": "promos",
    "PIZZAS & PASTAS": "pizzas",
    "SALADS & CEVICHE": "salads-ceviche",
    "SIGNATURE": "signature",
    "BOWLS": "bowls",
    "TOAST & BAGELS": "toast",
    "CHILAQUILES & ENCHILADAS": "chilaquiles",
    "CROISSANTS BREAKFAST": "croissants",
    "KETO MENU": "keto",
    "PANCAKES & WAFFLES": "pancakes",
    "KIDS MENU": "kids",
    "SOUPS & SALADS": "soups",
    "PANINIS": "paninis",
    "MUNCHIES": "munchies",
    "EXTRAS": "extras",
    "ENVIOS": "envios",
    "APPETIZERS": "appetizers",
    "SODAS": "sodas",
    "COFFEE HOT/ICE": "coffee",
    "SMOOTHIES": "smoothies",
    "FRAPPES": "frappes",
    "TEA & TISANAS": "tea",
    "JUGOS": "jugos",
    "FRESH DRINKS": "fresh",
    "EVENTO/MENU TEMP": "evento",
    "ICE CREAM": "icecream",
    "DESSERTS": "postres",
    "BAKERY": "bakery",
    "BEBIDAS OH": "alcohol",
    "VINOS": "vinos",
    "CERVEZA": "cerveza",
    "LICORES 2OZ": "licores",
    "MARKET - HEALTHY SNACKS & ABARROTES": "mkt-healthy",
    "MARKET - VITAMINAS & SUPLEMENTOS": "mkt-vitaminas",
    "MARKET - REGALOS & DETALLES": "mkt-regalos",
    "MARKET - MARCA PROPIA AMALAY": "mkt-amalay",
    "": "mkt-healthy",  # 5 suplementos sin grupo
}

NEW_CATS = [
    # (id, name, color, sort_order)
    ("enchiladas-tacos", "Enchiladas & Tacos", "bg-orange-600", 10),
    ("salads-ceviche", "Salads & Ceviche", "bg-lime-600", 17),
    ("appetizers", "Appetizers", "bg-rose-500", 15),
    ("icecream", "Ice Cream", "bg-sky-400", 95),
    ("vinos", "Vinos", "bg-purple-700", 112),
    ("cerveza", "Cerveza", "bg-yellow-600", 113),
    ("licores", "Licores 2oz", "bg-amber-700", 114),
    ("evento", "Evento / Menu Temp", "bg-fuchsia-600", 150),
    ("mkt-healthy", "Market: Healthy Snacks & Abarrotes", "bg-emerald-600", 200),
    ("mkt-vitaminas", "Market: Vitaminas & Suplementos", "bg-teal-600", 201),
    ("mkt-regalos", "Market: Regalos & Detalles", "bg-pink-500", 202),
    ("mkt-amalay", "Market: Marca Propia AMALAY", "bg-indigo-600", 204),
]

OLD_MKT_CATS = [
    "mkt-cafe", "mkt-galletas", "mkt-snacks", "mkt-amaranth", "mkt-smarty",
    "mkt-sanutri", "mkt-dulces", "mkt-proteina", "mkt-suplementos", "mkt-te",
    "mkt-lanona", "mkt-rojamaica", "mkt-belleza", "mkt-accesorios", "mkt-libros",
]


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def slug(s, maxlen=40):
    s = unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen].strip("-")


def q(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def b(v):
    return "true" if v else "false"


def main():
    fresh = json.load(open("output/catalog_fresh.json"))
    pos_items = json.load(open("/tmp/pos_items.json"))
    by_name = {}
    for i in pos_items:
        by_name.setdefault(norm(i["name"]), i["id"])

    out = []
    w = out.append
    w("-- =====================================================================")
    w("-- IMPORTACION CATALOGO REAL WANSOFT -> POS FULLSITE (generado 2026-06-12)")
    w("-- Fuente: export Wansoft de hoy (522 platillos, 131 modificadores,")
    w("-- 499 asignaciones multinivel, 40 grupos). Correr completo en SQL Editor.")
    w("-- =====================================================================\n")

    # 1. columnas nuevas
    w("-- 1) Columnas de flags Wansoft en platillos")
    w("ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS aplica_2x1 BOOLEAN DEFAULT false;")
    w("ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS aplica_descuento BOOLEAN DEFAULT true;")
    w("ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS aplica_cortesia BOOLEAN DEFAULT true;\n")

    # 2. categorias nuevas + deactivar mkt viejas
    w("-- 2) Categorias nuevas (espejo de grupos Wansoft) y retiro de mkt-* viejas")
    for cid, name, color, so in NEW_CATS:
        w(f"INSERT INTO pos_menu_categories (id, client_id, name, color, sort_order, active) "
          f"VALUES ({q(cid)}, {q(CLIENT)}, {q(name)}, {q(color)}, {so}, true) "
          f"ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color, "
          f"sort_order=EXCLUDED.sort_order, active=true;")
    w(f"UPDATE pos_menu_categories SET active=false WHERE client_id={q(CLIENT)} AND id IN "
      f"({', '.join(q(c) for c in OLD_MKT_CATS)});\n")

    # 3. platillos
    w("-- 3) Upsert de los 522 platillos reales (id existente si coincide nombre)")
    item_id_by_name = {}   # norm nombre wansoft -> id final en POS
    seen_ids = set()
    imported_ids = []
    for p in fresh["platillos"]:
        nombre = (p["nombre"] or "").strip()
        if not nombre:
            continue
        grupo = (p["grupo"] or "").strip()
        cat = CAT_MAP.get(grupo)
        if cat is None:
            print(f"!! grupo sin mapeo: {grupo!r} ({nombre})", file=sys.stderr)
            continue
        n = norm(nombre)
        iid = by_name.get(n) or f"ws-{slug(p['clave'] or nombre)}"
        if iid in seen_ids:
            iid = f"ws-{slug((p['clave'] or '') + '-' + nombre)}"
        if iid in seen_ids:
            print(f"!! id duplicado, skip: {iid} ({nombre})", file=sys.stderr)
            continue
        seen_ids.add(iid)
        item_id_by_name[n] = iid
        imported_ids.append(iid)
        active = (p.get("incluir_en_pv") != "No")
        w(f"INSERT INTO pos_menu_items (id, client_id, category_id, name, price, barcode, "
          f"sort_order, active, aplica_2x1, aplica_descuento, aplica_cortesia) VALUES "
          f"({q(iid)}, {q(CLIENT)}, {q(cat)}, {q(nombre)}, {p['precio'] or 0}, {q(p['clave'])}, "
          f"{p['orden'] or 0}, {b(active)}, {b(p.get('aplica_2x1') == 'Si')}, "
          f"{b(p.get('aplica_descuento') == 'Si')}, {b(p.get('aplica_cortesia') == 'Si')}) "
          f"ON CONFLICT (id) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, "
          f"price=EXCLUDED.price, barcode=EXCLUDED.barcode, sort_order=EXCLUDED.sort_order, "
          f"active=EXCLUDED.active, aplica_2x1=EXCLUDED.aplica_2x1, "
          f"aplica_descuento=EXCLUDED.aplica_descuento, aplica_cortesia=EXCLUDED.aplica_cortesia;")
    w("")

    # 4. desactivar items que no existen en Wansoft
    w("-- 4) Desactivar items del POS que NO existen en Wansoft (no se borran: historial)")
    w(f"UPDATE pos_menu_items SET active=false WHERE client_id={q(CLIENT)} AND id NOT IN "
      f"({', '.join(q(i) for i in imported_ids)});\n")

    # 5. grupos de modificadores multinivel reales
    w("-- 5) Modificadores multinivel reales (reemplaza seeds wsg-/wsm- previos)")
    w("DELETE FROM pos_item_modifier_groups WHERE client_id=" + q(CLIENT) + ";")
    w("DELETE FROM pos_modifiers WHERE id LIKE 'wsm-%';")
    w("DELETE FROM pos_modifier_groups WHERE id LIKE 'wsg-%';")
    w("-- retirar seeds inventados de mayo y asignaciones por categoria genericas")
    w(f"DELETE FROM pos_category_modifiers WHERE client_id={q(CLIENT)} "
      f"AND modifier_group_id IN ('food','coffee','drinks','proteina');")
    w("UPDATE pos_modifier_groups SET active=false WHERE id IN ('food','coffee','drinks','proteina');\n")

    price_by_mod = {norm(m["nombre"]): m["precio"] or 0 for m in fresh["modificadores"]}
    # nombres en asignaciones que no estan en la lista de modificadores;
    # precio tomado del platillo EXTRAS equivalente (EXT. AGUACATE $55, HUEVO $55)
    price_by_mod.setdefault(norm("AGUACATE"), 55)
    price_by_mod.setdefault(norm("EXT. HUEVO"), 55)

    # platillo -> nivel -> datos
    per_item = defaultdict(lambda: defaultdict(lambda: {"mods": [], "meta": None}))
    for a in fresh["asignaciones"]:
        d = per_item[norm(a["platillo"])][a["nivel"]]
        d["mods"].append(a["modificador"])
        d["meta"] = a

    # dedupe de grupos
    group_key_to_id = {}
    groups_sql = []
    opts_sql = []
    assign_sql = []
    missing_items = set()
    missing_prices = set()
    gcount = 0

    for pname, niveles in sorted(per_item.items()):
        iid = item_id_by_name.get(pname)
        if not iid:
            missing_items.add(pname)
            continue
        for nivel, d in sorted(niveles.items()):
            a = d["meta"]
            mods = sorted(set(d["mods"]))
            key = (norm(a["nombre_nivel"]), nivel, a["min"], a["max"], tuple(mods))
            gid = group_key_to_id.get(key)
            if gid is None:
                gcount += 1
                gid = f"wsg-{slug(a['nombre_nivel'] or 'nivel')}-{gcount}"
                group_key_to_id[key] = gid
                maxv = "NULL" if a["max"] in (None, "", 0) and a["min"] == 0 else (a["max"] if a["max"] is not None else "NULL")
                groups_sql.append(
                    f"INSERT INTO pos_modifier_groups (id, client_id, name, level, min_selections, "
                    f"max_selections, required, sort_order, active) VALUES ({q(gid)}, {q(CLIENT)}, "
                    f"{q((a['nombre_nivel'] or 'Nivel').strip())}, {nivel}, {a['min'] or 0}, {maxv}, "
                    f"{b(bool(a['requerido']) or (a['min'] or 0) >= 1)}, {nivel}, true);")
                for j, mname in enumerate(mods):
                    price = price_by_mod.get(norm(mname))
                    if price is None:
                        missing_prices.add(mname)
                        price = 0
                    mid = f"wsm-{gcount}-{slug(mname)}"
                    opts_sql.append(
                        f"INSERT INTO pos_modifiers (id, client_id, group_id, name, price, sort_order, active) "
                        f"VALUES ({q(mid)}, {q(CLIENT)}, {q(gid)}, {q(mname.strip())}, {price}, {j}, true);")
            assign_sql.append(
                f"INSERT INTO pos_item_modifier_groups (client_id, item_id, group_id) "
                f"VALUES ({q(CLIENT)}, {q(iid)}, {q(gid)});")

    w("-- 5a) Grupos unicos deduplicados")
    out.extend(groups_sql)
    w("")
    w("-- 5b) Opciones con precio real")
    out.extend(opts_sql)
    w("")
    w("-- 5c) Asignacion POR PLATILLO (modelo Wansoft)")
    out.extend(assign_sql)
    w("")

    sql = "\n".join(out)
    out_path = sys.argv[1] if len(sys.argv) > 1 else "output/import-wansoft-catalog.sql"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql)

    print(f"SQL -> {out_path}")
    print(f"platillos importados: {len(imported_ids)}")
    print(f"grupos de modificadores unicos: {len(group_key_to_id)}")
    print(f"opciones: {len(opts_sql)}")
    print(f"asignaciones item-grupo: {len(assign_sql)}")
    if missing_items:
        print(f"\n!! platillos en asignaciones que no matchean item importado ({len(missing_items)}):")
        for m in sorted(missing_items):
            print("   -", m)
    if missing_prices:
        print(f"\n!! modificadores sin precio en lista ({len(missing_prices)}):")
        for m in sorted(missing_prices):
            print("   -", m)


if __name__ == "__main__":
    main()
