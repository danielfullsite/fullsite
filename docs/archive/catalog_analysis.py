#!/usr/bin/env python3
"""
Catalog Intelligence Analysis — AMALAY / Wansoft
Reads all Wansoft data files and produces a comprehensive anomaly report.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

BASE = Path("/Users/danielrg/fullsite/agents/wansoft")

def load(name):
    with open(BASE / name, "r", encoding="utf-8") as f:
        return json.load(f)

# ── Load all data ──
platillos = load("wansoft_platillos.json")
recetas = load("wansoft_recetas.json")
products = load("wansoft_products.json")
existencias = load("wansoft_existencias.json")
costos = load("wansoft_costos.json")
reorder = load("wansoft_reorder_points.json")

# ── Build indexes ──
platillo_by_clave = {p["clave"]: p for p in platillos}
receta_by_code = {r["code"]: r for r in recetas}
receta_codes = set(r["code"] for r in recetas)

product_by_name = {}
product_by_code = {}
for p in products:
    product_by_name[p["nombre"].upper().strip()] = p
    product_by_code[p["codigo"]] = p

product_names_upper = set(product_by_name.keys())

existencia_by_code = {e["codigo"]: e for e in existencias}
costo_by_code = {c["code"]: c for c in costos}

# All ingredients used across all recipes
all_recipe_ingredients = set()
ingredient_to_recipes = defaultdict(list)
for r in recetas:
    for ing in r.get("ingredients", []):
        name = ing["product"].upper().strip()
        all_recipe_ingredients.add(name)
        ingredient_to_recipes[name].append(r["code"])

out = []
def section(title):
    out.append(f"\n## {title}\n")
def line(text=""):
    out.append(text)

# ══════════════════════════════════════════════════════════════
# Header
# ══════════════════════════════════════════════════════════════
out.append("# Catalog Intelligence Report — AMALAY")
out.append("")
out.append(f"Fecha: 2026-07-04")
out.append("")
out.append(f"| Dato | Cantidad |")
out.append(f"|---|---|")
out.append(f"| Platillos (menu items) | {len(platillos)} |")
out.append(f"| Recetas | {len(recetas)} |")
out.append(f"| Productos (master) | {len(products)} |")
out.append(f"| Existencias (inventory lines) | {len(existencias)} |")
out.append(f"| Costos registrados | {len(costos)} |")
out.append(f"| Reorder points | {len(reorder)} |")

# ══════════════════════════════════════════════════════════════
# 1. Platillos sin receta
# ══════════════════════════════════════════════════════════════
section("1. Platillos sin receta")
sin_receta = [p for p in platillos if p["clave"] not in receta_codes]
line(f"**Total: {len(sin_receta)} de {len(platillos)} platillos ({100*len(sin_receta)/len(platillos):.1f}%)**")
line()
if sin_receta:
    line("| Grupo | Clave | Nombre | Precio |")
    line("|---|---|---|---|")
    for p in sorted(sin_receta, key=lambda x: (x["grupo"], x["nombre"])):
        line(f"| {p['grupo']} | {p['clave']} | {p['nombre']} | ${p['precio']:,.2f} |")

# ══════════════════════════════════════════════════════════════
# 2. Recetas incompletas
# ══════════════════════════════════════════════════════════════
section("2. Recetas incompletas")

# 2a. qty = 0
zero_qty = []
for r in recetas:
    for ing in r.get("ingredients", []):
        if ing["qty"] == 0:
            zero_qty.append((r["code"], r["dish"], ing["product"], ing["unit"]))

line(f"### 2a. Ingredientes con cantidad = 0")
line(f"**Total: {len(zero_qty)} ingredientes en 0**")
line()
if zero_qty:
    line("| Receta | Platillo | Ingrediente | Unidad |")
    line("|---|---|---|---|")
    for code, dish, prod, unit in zero_qty:
        line(f"| {code} | {dish} | {prod} | {unit} |")

# 2b. Only 1 ingredient
one_ing = [r for r in recetas if len(r.get("ingredients", [])) == 1]
line()
line(f"### 2b. Recetas con solo 1 ingrediente")
line(f"**Total: {len(one_ing)}**")
line()
if one_ing:
    line("| Clave | Platillo | Ingrediente | Qty | Unidad |")
    line("|---|---|---|---|---|")
    for r in one_ing:
        ing = r["ingredients"][0]
        line(f"| {r['code']} | {r['dish']} | {ing['product']} | {ing['qty']} | {ing['unit']} |")

# ══════════════════════════════════════════════════════════════
# 3. Ingredientes fantasma
# ══════════════════════════════════════════════════════════════
section("3. Ingredientes fantasma (en recetas pero no en catálogo de productos)")
fantasma = all_recipe_ingredients - product_names_upper
line(f"**Total: {len(fantasma)} ingredientes sin match en productos master**")
line()
if fantasma:
    line("| Ingrediente | Usado en recetas |")
    line("|---|---|")
    for name in sorted(fantasma):
        codes = ingredient_to_recipes[name]
        line(f"| {name} | {', '.join(codes[:5])}{'...' if len(codes)>5 else ''} |")

# ══════════════════════════════════════════════════════════════
# 4. Productos huérfanos (not in any recipe AND zero stock)
# ══════════════════════════════════════════════════════════════
section("4. Productos huérfanos (sin uso en recetas + stock cero)")
orphans = []
for p in products:
    name_upper = p["nombre"].upper().strip()
    if name_upper not in all_recipe_ingredients:
        # check stock
        ex = existencia_by_code.get(p["codigo"])
        stock = ex["existencia"] if ex else 0
        if stock <= 0:
            orphans.append(p)

line(f"**Total: {len(orphans)} productos sin uso y sin stock**")
line()
if orphans:
    line("| Codigo | Nombre | Depto | Tipo |")
    line("|---|---|---|---|")
    for p in sorted(orphans, key=lambda x: (x.get("departamento",""), x["nombre"])):
        line(f"| {p['codigo']} | {p['nombre']} | {p.get('departamento','')} | {p.get('tipo','')} |")

# ══════════════════════════════════════════════════════════════
# 5. Ingredientes duplicados en misma receta
# ══════════════════════════════════════════════════════════════
section("5. Ingredientes duplicados en una misma receta")
dupes = []
for r in recetas:
    seen = defaultdict(int)
    for ing in r.get("ingredients", []):
        seen[ing["product"].upper().strip()] += 1
    for name, count in seen.items():
        if count > 1:
            dupes.append((r["code"], r["dish"], name, count))

line(f"**Total: {len(dupes)} duplicados encontrados**")
line()
if dupes:
    line("| Receta | Platillo | Ingrediente | Apariciones |")
    line("|---|---|---|---|")
    for code, dish, name, count in dupes:
        line(f"| {code} | {dish} | {name} | {count} |")

# ══════════════════════════════════════════════════════════════
# 6. Recetas sospechosas (cantidades muy altas)
# ══════════════════════════════════════════════════════════════
section("6. Recetas sospechosas (cantidades inusualmente altas)")
HIGH_QTY_THRESHOLD = 500
suspicious = []
for r in recetas:
    for ing in r.get("ingredients", []):
        if ing["qty"] >= HIGH_QTY_THRESHOLD:
            suspicious.append((r["code"], r["dish"], ing["product"], ing["qty"], ing["unit"]))

line(f"**Total: {len(suspicious)} ingredientes con qty >= {HIGH_QTY_THRESHOLD}**")
line()
if suspicious:
    line("| Receta | Platillo | Ingrediente | Qty | Unidad |")
    line("|---|---|---|---|---|")
    for code, dish, prod, qty, unit in sorted(suspicious, key=lambda x: -x[3]):
        line(f"| {code} | {dish} | {prod} | {qty:,.2f} | {unit} |")

# Also flag potential unit mismatches (e.g., KG qty > 50, PZ qty > 100)
line()
line("### Posibles errores de unidad")
unit_suspects = []
for r in recetas:
    for ing in r.get("ingredients", []):
        q = ing["qty"]
        u = ing["unit"].upper()
        if u == "KG" and q > 50:
            unit_suspects.append((r["code"], r["dish"], ing["product"], q, ing["unit"], "KG > 50"))
        elif u == "LT" and q > 50:
            unit_suspects.append((r["code"], r["dish"], ing["product"], q, ing["unit"], "LT > 50"))
        elif u == "PZ" and q > 200:
            unit_suspects.append((r["code"], r["dish"], ing["product"], q, ing["unit"], "PZ > 200"))

line(f"**Total: {len(unit_suspects)} posibles errores de unidad**")
line()
if unit_suspects:
    line("| Receta | Platillo | Ingrediente | Qty | Unidad | Motivo |")
    line("|---|---|---|---|---|---|")
    for code, dish, prod, qty, unit, reason in unit_suspects:
        line(f"| {code} | {dish} | {prod} | {qty:,.2f} | {unit} | {reason} |")

# ══════════════════════════════════════════════════════════════
# 7. Platillos sin precio
# ══════════════════════════════════════════════════════════════
section("7. Platillos sin precio (precio = 0)")
sin_precio = [p for p in platillos if p["precio"] == 0]
line(f"**Total: {len(sin_precio)} platillos con precio $0**")
line()
if sin_precio:
    line("| Grupo | Clave | Nombre |")
    line("|---|---|---|")
    for p in sorted(sin_precio, key=lambda x: (x["grupo"], x["nombre"])):
        line(f"| {p['grupo']} | {p['clave']} | {p['nombre']} |")

# ══════════════════════════════════════════════════════════════
# 8. Productos sin costo (usados en recetas pero sin costo)
# ══════════════════════════════════════════════════════════════
section("8. Productos sin costo (usados en recetas, sin datos de costo)")
# Build cost lookup by product name
costo_by_name = {}
for c in costos:
    costo_by_name[c["product"].upper().strip()] = c

sin_costo = []
for name in sorted(all_recipe_ingredients):
    p = product_by_name.get(name)
    if p:
        c = costo_by_code.get(p["codigo"])
        # Also check by name in costos
        c2 = costo_by_name.get(name)
        cost_val = None
        if c:
            cost_val = c.get("last_cost", 0) or c.get("avg_cost", 0) or c.get("ideal_cost", 0)
        elif c2:
            cost_val = c2.get("last_cost", 0) or c2.get("avg_cost", 0) or c2.get("ideal_cost", 0)
        elif p.get("costo", 0) > 0:
            cost_val = p["costo"]

        if not cost_val or cost_val == 0:
            recipe_count = len(ingredient_to_recipes.get(name, []))
            sin_costo.append((p["codigo"], p["nombre"], p.get("departamento",""), recipe_count))

line(f"**Total: {len(sin_costo)} productos usados en recetas sin costo registrado**")
line()
if sin_costo:
    line("| Codigo | Nombre | Depto | Recetas que lo usan |")
    line("|---|---|---|---|")
    for codigo, nombre, depto, rc in sorted(sin_costo, key=lambda x: -x[3]):
        line(f"| {codigo} | {nombre} | {depto} | {rc} |")

# ══════════════════════════════════════════════════════════════
# 9. Inventario critico sin receta
# ══════════════════════════════════════════════════════════════
section("9. Productos criticos que no se usan en ninguna receta")
criticos_sin_receta = []
for p in products:
    if p.get("critico", False):
        name_upper = p["nombre"].upper().strip()
        if name_upper not in all_recipe_ingredients:
            ex = existencia_by_code.get(p["codigo"])
            stock = ex["existencia"] if ex else 0
            criticos_sin_receta.append((p["codigo"], p["nombre"], p.get("departamento",""), stock))

line(f"**Total: {len(criticos_sin_receta)} productos marcados como criticos sin uso en recetas**")
line()
if criticos_sin_receta:
    line("| Codigo | Nombre | Depto | Stock actual |")
    line("|---|---|---|---|")
    for codigo, nombre, depto, stock in sorted(criticos_sin_receta, key=lambda x: x[1]):
        line(f"| {codigo} | {nombre} | {depto} | {stock:,.2f} |")

# ══════════════════════════════════════════════════════════════
# 10. Cobertura
# ══════════════════════════════════════════════════════════════
section("10. Cobertura: platillos con receta completa y costeada")

complete = 0
partial = 0
no_recipe = 0

for p in platillos:
    clave = p["clave"]
    if clave not in receta_codes:
        no_recipe += 1
        continue

    r = receta_by_code[clave]
    ings = r.get("ingredients", [])
    if not ings:
        no_recipe += 1
        continue

    all_costed = True
    for ing in ings:
        name = ing["product"].upper().strip()
        prod = product_by_name.get(name)
        if not prod:
            all_costed = False
            continue
        c = costo_by_code.get(prod["codigo"])
        c2 = costo_by_name.get(name)
        cost_val = 0
        if c:
            cost_val = c.get("last_cost", 0) or c.get("avg_cost", 0) or c.get("ideal_cost", 0)
        elif c2:
            cost_val = c2.get("last_cost", 0) or c2.get("avg_cost", 0) or c2.get("ideal_cost", 0)
        elif prod.get("costo", 0) > 0:
            cost_val = prod["costo"]
        if not cost_val:
            all_costed = False

    if all_costed:
        complete += 1
    else:
        partial += 1

total = len(platillos)
line(f"| Estado | Cantidad | % |")
line(f"|---|---|---|")
line(f"| Receta completa + todos ingredientes costeados | {complete} | {100*complete/total:.1f}% |")
line(f"| Receta existe pero ingredientes sin costo | {partial} | {100*partial/total:.1f}% |")
line(f"| Sin receta | {no_recipe} | {100*no_recipe/total:.1f}% |")
line(f"| **Total platillos** | **{total}** | **100%** |")

# ══════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════
section("Resumen ejecutivo")
line("| Hallazgo | Impacto | Conteo |")
line("|---|---|---|")
line(f"| Platillos sin receta | No se puede costear | {len(sin_receta)} |")
line(f"| Ingredientes con qty=0 | Receta rota | {len(zero_qty)} |")
line(f"| Recetas de 1 ingrediente | Probablemente incompleta | {len(one_ing)} |")
line(f"| Ingredientes fantasma | No existen en catalogo | {len(fantasma)} |")
line(f"| Productos huerfanos (sin stock ni uso) | Basura en catalogo | {len(orphans)} |")
line(f"| Ingredientes duplicados en receta | Error de captura | {len(dupes)} |")
line(f"| Cantidades sospechosas (>={HIGH_QTY_THRESHOLD}) | Posible error | {len(suspicious)} |")
line(f"| Platillos con precio $0 | Venta sin cobro | {len(sin_precio)} |")
line(f"| Productos sin costo (usados en recetas) | Costeo incompleto | {len(sin_costo)} |")
line(f"| Productos criticos sin receta | Inventario sin liga | {len(criticos_sin_receta)} |")
line(f"| **Cobertura total (receta+costo)** | | **{100*complete/total:.1f}%** |")

# Write output
output_path = Path("/Users/danielrg/fullsite/docs/analysis/CATALOG-INTELLIGENCE.md")
output_path.write_text("\n".join(out), encoding="utf-8")
print(f"Report written to {output_path}")
print(f"\nQuick stats:")
print(f"  Platillos: {len(platillos)}, Recetas: {len(recetas)}, Products: {len(products)}")
print(f"  Sin receta: {len(sin_receta)}, Fantasma: {len(fantasma)}, Orphans: {len(orphans)}")
print(f"  Cobertura completa: {complete}/{total} ({100*complete/total:.1f}%)")
