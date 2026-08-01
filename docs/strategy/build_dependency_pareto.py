#!/usr/bin/env python3
"""
AMALAY — Dependency Graph + Pareto Analysis
Reads Wansoft JSON data + Supabase sales history.
Outputs: /Users/danielrg/fullsite/docs/strategy/DEPENDENCY-AND-PARETO.md
"""

import json
import ssl
import urllib.request
from collections import defaultdict
from datetime import datetime

BASE = "/Users/danielrg/fullsite/agents/wansoft"
OUT  = "/Users/danielrg/fullsite/docs/strategy/DEPENDENCY-AND-PARETO.md"

SUPABASE_URL = "https://qjiomlvudfmzuvqvhwpk.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqaW9tbHZ1ZGZtenV2cXZod3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODQ5MTUsImV4cCI6MjA5MTM2MDkxNX0.nv1ctxRJbc8kzD5gPypoxZ4uLtxOX61Me2ype5GBXyU"

# ── Load data ──────────────────────────────────────────────────────────────

def load(name):
    with open(f"{BASE}/{name}") as f:
        return json.load(f)

platillos  = load("wansoft_platillos.json")
recetas    = load("wansoft_recetas.json")
products   = load("wansoft_products.json")
costos     = load("wansoft_costos.json")
proveedores= load("wansoft_proveedores.json")
existencias= load("wansoft_existencias_detalle.json")

# ── Fetch sales from Supabase ──────────────────────────────────────────────

def fetch_sales(days=90):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    url = f"{SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha,platillos_top,ventas_dia&order=fecha.desc&limit={days}"
    req = urllib.request.Request(url, headers={
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}"
    })
    resp = urllib.request.urlopen(req, context=ctx)
    return json.loads(resp.read())

sales_rows = fetch_sales(90)
print(f"Fetched {len(sales_rows)} days of sales data")

# ── Build indices ──────────────────────────────────────────────────────────

# Platillo lookup: clave -> platillo record
platillo_by_clave = {p["clave"]: p for p in platillos}
platillo_by_name = {}
for p in platillos:
    platillo_by_name[p["nombre"].upper().strip()] = p

# Receta lookup: code -> receta
receta_by_code = {r["code"]: r for r in recetas}

# Product master lookup by name (normalized)
product_by_name = {}
for p in products:
    product_by_name[p["nombre"].upper().strip()] = p

# Costos lookup by product name
cost_by_name = {}
for c in costos:
    cost_by_name[c["product"].upper().strip()] = c

# Existencias lookup by product name (field is 'unit' due to column swap)
exist_by_name = {}
for e in existencias:
    exist_by_name[e["unit"].upper().strip()] = e

# Proveedores: extract giro (stored in dias_credito due to column swap)
# rfc field contains actual company name
prov_by_giro = defaultdict(list)
for p in proveedores:
    giro = p.get("dias_credito", "")
    if giro and giro != 0:
        prov_by_giro[str(giro).upper().strip()].append(p)

# ── Unit conversion helper ─────────────────────────────────────────────────

def convert_qty_to_base(qty, recipe_unit, product_name):
    """Convert recipe quantity to the product's base unit for cost calculation.
    Recipes use GR/ML, but costs are per KG/LT."""
    recipe_unit = recipe_unit.upper().strip()
    p = product_by_name.get(product_name.upper().strip())
    base_unit = p.get("unidad", "").upper() if p else ""

    # GR -> KG
    if recipe_unit == "GR" and base_unit == "KG":
        return qty / 1000.0
    # ML -> LT
    if recipe_unit == "ML" and base_unit == "LT":
        return qty / 1000.0
    # ML -> KG (liquids stored as KG, e.g. miel de agave, salsas)
    if recipe_unit == "ML" and base_unit == "KG":
        return qty / 1000.0
    # GR -> LT (unlikely but handle it)
    if recipe_unit == "GR" and base_unit == "LT":
        return qty / 1000.0
    # OZ conversions
    if recipe_unit == "OZ" and base_unit == "KG":
        return qty * 0.02835
    if recipe_unit == "OZ" and base_unit == "LT":
        return qty * 0.02957
    return qty

# ── ANALYSIS 1: Dependency Graph ──────────────────────────────────────────

# Step 1: Map ingredient -> recipes that use it, and ingredient -> platillos
ingredient_recipes = defaultdict(list)     # ingredient_name -> [recipe_code, ...]
ingredient_platillos = defaultdict(set)    # ingredient_name -> set of platillo names
ingredient_total_qty = defaultdict(float)  # ingredient_name -> total qty across all recipes

for r in recetas:
    for ing in r.get("ingredients", []):
        ing_name = ing["product"].upper().strip()
        ingredient_recipes[ing_name].append(r["code"])
        # Find platillo that matches this recipe code
        if r["code"] in platillo_by_clave:
            ingredient_platillos[ing_name].add(platillo_by_clave[r["code"]]["nombre"])
        # Also try matching by dish name
        dish_upper = r["dish"].upper().strip()
        if dish_upper in platillo_by_name:
            ingredient_platillos[ing_name].add(platillo_by_name[dish_upper]["nombre"])
        converted_qty = convert_qty_to_base(ing.get("qty", 0), ing.get("unit", ""), ing["product"])
        ingredient_total_qty[ing_name] += converted_qty

# Step 2: Get cost and stock for each ingredient
ingredient_data = {}
for ing_name in ingredient_recipes:
    cost_info = cost_by_name.get(ing_name, {})
    exist_info = exist_by_name.get(ing_name, {})
    prod_info = product_by_name.get(ing_name, {})

    last_cost = cost_info.get("last_cost", 0) or 0
    avg_cost = cost_info.get("avg_cost", 0) or 0
    best_cost = last_cost if last_cost > 0 else avg_cost

    stock_value = exist_info.get("value", 0) or 0
    department = exist_info.get("code", "") or prod_info.get("departamento", "")
    critical = cost_info.get("critical", False) or exist_info.get("critical", False) or prod_info.get("critico", False)

    n_recipes = len(ingredient_recipes[ing_name])
    n_platillos = len(ingredient_platillos[ing_name])

    # Total cost contribution = best_cost * total_qty across all recipes (cost per unit * qty used per recipe)
    total_cost_contribution = best_cost * ingredient_total_qty[ing_name]

    ingredient_data[ing_name] = {
        "name": ing_name,
        "n_recipes": n_recipes,
        "n_platillos": n_platillos,
        "last_cost": last_cost,
        "avg_cost": avg_cost,
        "best_cost": best_cost,
        "stock_value": stock_value,
        "department": department,
        "critical": critical,
        "total_qty": ingredient_total_qty[ing_name],
        "total_cost_contribution": total_cost_contribution,
        "platillos": list(ingredient_platillos[ing_name]),
    }

# Step 3: Identify supplier links via department -> giro mapping
DEPT_GIRO_MAP = {
    "PROTEINA ANIMAL": ["CARNES Y POLLO", "PESCADOS Y MARISCOS", "MARISCOS", "PESCADO Y MARISCOS", "HUEVO", "VENTA DE HUEVO"],
    "FRUTAS Y VERDURAS": ["FRUTAS Y VERDURAS", "FRUTAS Y LEGUMBRES"],
    "LACTEOS": ["LACTEOS", "CREMERIA", "ABARROTES LACTEOS Y CONGELADOS"],
    "ABARROTES": ["ABARROTES", "MATERIAS PRIMAS", "SUPER", "COSTCO", "AUTOSERVICIO"],
    "PANADERIA": ["PANADERIA", "PANADERIA RESTAURANT", "PAN BRAD", "REPOSTERIA"],
    "BEBIDAS": ["REFESCOS Y LECHE", "BEBIDA", "JUGOS", "JUGOS PRENSADOS", "JUGOS Y CONCENTRADOS", "JUGOS NTURALES", "VENTA DE JARABES Y BEBIDAS"],
    "VINOS Y LICORES": ["VINOS Y LICORES"],
    "CONGELADOS": ["ABARROTES LACTEOS Y CONGELADOS", "CONGELADOS"],
    "DESECHABLES": ["DESECHABLES", "QUIMICOS Y DESECHABLES", "BIODEGRADABLES"],
    "PRODUCTOS MARKET": ["MARKET", "MARCKET", "SNACKS", "SNACKS SALUDABLES"],
}

def find_suppliers(ingredient_name, department):
    """Find suppliers linked to an ingredient via department/giro mapping."""
    suppliers = []
    dept_upper = department.upper().strip()

    for dept_key, giro_list in DEPT_GIRO_MAP.items():
        if dept_upper == dept_key:
            for giro in giro_list:
                for prov in prov_by_giro.get(giro.upper(), []):
                    suppliers.append(prov["rfc"])  # rfc field = actual company name
            break

    # Also try direct name matching
    for giro_key, provs in prov_by_giro.items():
        ing_words = ingredient_name.lower().split()
        giro_words = giro_key.lower().split()
        if any(w in giro_words for w in ing_words if len(w) > 3):
            for prov in provs:
                if prov["rfc"] not in suppliers:
                    suppliers.append(prov["rfc"])

    return suppliers

for ing_name, data in ingredient_data.items():
    data["suppliers"] = find_suppliers(ing_name, data["department"])

# ── Single Points of Failure ──────────────────────────────────────────────

spof = sorted(
    [d for d in ingredient_data.values() if d["n_recipes"] >= 10],
    key=lambda x: x["n_recipes"],
    reverse=True
)

# ── Supply Chain Risks (high usage, no supplier link) ──────────────────────

supply_risk = sorted(
    [d for d in ingredient_data.values() if d["n_recipes"] >= 5 and not d["suppliers"]],
    key=lambda x: x["n_recipes"],
    reverse=True
)

# ── Cost Concentration ────────────────────────────────────────────────────

cost_top = sorted(
    [d for d in ingredient_data.values() if d["best_cost"] > 0],
    key=lambda x: x["total_cost_contribution"],
    reverse=True
)[:20]

# ── Cascade Impact ────────────────────────────────────────────────────────

cascade = sorted(
    ingredient_data.values(),
    key=lambda x: x["n_platillos"],
    reverse=True
)[:20]

# ── ANALYSIS 2: Pareto ────────────────────────────────────────────────────

# Aggregate sales across all days
platillo_sales = defaultdict(lambda: {"total_revenue": 0.0, "total_qty": 0, "days_seen": 0})

for row in sales_rows:
    pt = row.get("platillos_top")
    if not pt:
        continue
    if isinstance(pt, str):
        pt = json.loads(pt)
    for item in pt:
        name = item.get("nombre", "").upper().strip()
        total = float(item.get("total", 0) or 0)
        qty = int(item.get("cantidad", 0) or 0)
        platillo_sales[name]["total_revenue"] += total
        platillo_sales[name]["total_qty"] += qty
        platillo_sales[name]["days_seen"] += 1

# Sort by revenue
all_sales = sorted(platillo_sales.items(), key=lambda x: x[1]["total_revenue"], reverse=True)
total_revenue = sum(s["total_revenue"] for _, s in all_sales)

# Find Pareto 80% threshold
cumulative = 0
pareto_items = []
pareto_threshold_idx = 0
for i, (name, data) in enumerate(all_sales):
    cumulative += data["total_revenue"]
    pareto_items.append((name, data, cumulative / total_revenue * 100))
    if cumulative >= total_revenue * 0.80 and pareto_threshold_idx == 0:
        pareto_threshold_idx = i + 1

pareto_critical = pareto_items[:pareto_threshold_idx]
pareto_rest = pareto_items[pareto_threshold_idx:]

print(f"Pareto: {pareto_threshold_idx} items ({pareto_threshold_idx/len(all_sales)*100:.1f}%) generate 80% of ${total_revenue:,.0f} MXN revenue")

# Cross-reference Pareto items with recipes and ingredients
pareto_recipes = set()
pareto_ingredients = defaultdict(int)  # ingredient -> count of pareto platillos that use it

for name, data, _ in pareto_critical:
    # Find matching platillo
    p = platillo_by_name.get(name)
    if p:
        code = p["clave"]
        if code in receta_by_code:
            r = receta_by_code[code]
            pareto_recipes.add(code)
            for ing in r.get("ingredients", []):
                pareto_ingredients[ing["product"].upper().strip()] += 1

# Food cost % for pareto vs rest
pareto_food_costs = []
rest_food_costs = []

def calc_recipe_cost(recipe):
    """Calculate food cost for a recipe with proper unit conversion."""
    total = 0
    for ing in recipe.get("ingredients", []):
        ing_name = ing["product"].upper().strip()
        ci = cost_by_name.get(ing_name, {})
        lc = ci.get("last_cost", 0) or 0
        ac = ci.get("avg_cost", 0) or 0
        best = lc if lc > 0 else ac
        converted_qty = convert_qty_to_base(ing.get("qty", 0), ing.get("unit", ""), ing["product"])
        total += best * converted_qty
    return total

for name, data, _ in pareto_critical:
    p = platillo_by_name.get(name)
    if p:
        code = p["clave"]
        if code in receta_by_code:
            r = receta_by_code[code]
            recipe_cost = calc_recipe_cost(r)
            if p["precio"] > 0 and recipe_cost > 0:
                pareto_food_costs.append({
                    "name": name,
                    "precio": p["precio"],
                    "cost": recipe_cost,
                    "pct": recipe_cost / p["precio"] * 100,
                    "revenue": data["total_revenue"],
                    "qty": data["total_qty"],
                })

for name, data, _ in pareto_rest:
    p = platillo_by_name.get(name)
    if p:
        code = p["clave"]
        if code in receta_by_code:
            r = receta_by_code[code]
            recipe_cost = calc_recipe_cost(r)
            if p["precio"] > 0 and recipe_cost > 0:
                rest_food_costs.append({
                    "name": name,
                    "precio": p["precio"],
                    "cost": recipe_cost,
                    "pct": recipe_cost / p["precio"] * 100,
                    "revenue": data["total_revenue"],
                })

avg_pareto_fc = sum(x["pct"] for x in pareto_food_costs) / len(pareto_food_costs) if pareto_food_costs else 0
avg_rest_fc = sum(x["pct"] for x in rest_food_costs) / len(rest_food_costs) if rest_food_costs else 0

# Top ingredients in Pareto recipes
pareto_ing_sorted = sorted(pareto_ingredients.items(), key=lambda x: x[1], reverse=True)

# ── Generate Markdown ─────────────────────────────────────────────────────

lines = []
def w(s=""):
    lines.append(s)

date_range_start = sales_rows[-1]["fecha"] if sales_rows else "N/A"
date_range_end = sales_rows[0]["fecha"] if sales_rows else "N/A"

w("# Analisis de Dependencias e Ingredientes Criticos -- AMALAY")
w()
w(f"Fecha de analisis: {datetime.now().strftime('%Y-%m-%d')}")
w()
w(f"Fuentes: Wansoft (522 platillos, 615 recetas, ~3000 productos, 878 costos, 202 proveedores, 840 existencias)")
w(f"Ventas historicas: {len(sales_rows)} dias ({date_range_start} a {date_range_end})")
w()
w("---")
w()

# ═══════════════════════════════════════════════════════════════════════════
# PART 1: DEPENDENCY GRAPH
# ═══════════════════════════════════════════════════════════════════════════

w("## PARTE 1: Grafo de Dependencias")
w()
w("### Resumen")
w()
w(f"| Metrica | Valor |")
w(f"|---|---|")
w(f"| Ingredientes unicos en recetas | {len(ingredient_data)} |")
w(f"| Ingredientes usados en 10+ recetas | {len(spof)} |")
w(f"| Ingredientes usados en 5+ recetas sin proveedor vinculado | {len(supply_risk)} |")
w(f"| Proveedores registrados | {len(proveedores)} |")
w(f"| Giros de proveedores unicos | {len(prov_by_giro)} |")
w()

# ── Single Points of Failure ──────────────────────────────────────────────
w("### Puntos Unicos de Falla (ingredientes en 10+ recetas)")
w()
w("Si alguno de estos ingredientes falta, se caen multiples platillos del menu.")
w()
w("| # | Ingrediente | Recetas | Platillos | Depto | Valor en stock | Costo/u | Proveedor vinculado |")
w("|---|---|---|---|---|---|---|---|")
for i, d in enumerate(spof[:25], 1):
    supps = ", ".join(d["suppliers"][:2]) if d["suppliers"] else "SIN PROVEEDOR"
    w(f"| {i} | {d['name']} | {d['n_recipes']} | {d['n_platillos']} | {d['department']} | ${d['stock_value']:,.0f} | ${d['best_cost']:,.2f} | {supps} |")
w()

# ── Cascade Impact ────────────────────────────────────────────────────────
w("### Impacto en Cascada: Si se agota el ingrediente, cuantos platillos caen")
w()
w("| # | Ingrediente | Platillos afectados | Recetas | Ejemplos de platillos que caen |")
w("|---|---|---|---|---|")
for i, d in enumerate(cascade[:20], 1):
    examples = ", ".join(d["platillos"][:4])
    if len(d["platillos"]) > 4:
        examples += f" (+{len(d['platillos'])-4} mas)"
    w(f"| {i} | {d['name']} | {d['n_platillos']} | {d['n_recipes']} | {examples} |")
w()

# ── Supply Chain Risks ────────────────────────────────────────────────────
w("### Riesgo de Cadena de Suministro (5+ recetas, sin proveedor vinculado)")
w()
w("Estos ingredientes se usan frecuentemente pero no tienen un proveedor claro en el sistema.")
w()
w("| # | Ingrediente | Recetas | Platillos | Depto | Costo/u |")
w("|---|---|---|---|---|---|")
for i, d in enumerate(supply_risk[:25], 1):
    w(f"| {i} | {d['name']} | {d['n_recipes']} | {d['n_platillos']} | {d['department']} | ${d['best_cost']:,.2f} |")
w()

# ── Cost Concentration ────────────────────────────────────────────────────
w("### Concentracion de Costo: Top 20 ingredientes por contribucion total de costo")
w()
w("Costo total = costo unitario x cantidad total usada en todas las recetas.")
w()
w("| # | Ingrediente | Costo/u | Qty total en recetas | Costo total | Recetas | Depto |")
w("|---|---|---|---|---|---|---|")
for i, d in enumerate(cost_top, 1):
    w(f"| {i} | {d['name']} | ${d['best_cost']:,.2f} | {d['total_qty']:,.2f} | ${d['total_cost_contribution']:,.2f} | {d['n_recipes']} | {d['department']} |")
w()

# ── Supplier Coverage ─────────────────────────────────────────────────────
w("### Cobertura de Proveedores por Departamento")
w()
dept_counts = defaultdict(lambda: {"total": 0, "with_supplier": 0, "without": 0})
for d in ingredient_data.values():
    dept = d["department"] or "SIN DEPTO"
    dept_counts[dept]["total"] += 1
    if d["suppliers"]:
        dept_counts[dept]["with_supplier"] += 1
    else:
        dept_counts[dept]["without"] += 1

w("| Departamento | Ingredientes | Con proveedor | Sin proveedor | Cobertura |")
w("|---|---|---|---|---|")
for dept in sorted(dept_counts, key=lambda x: dept_counts[x]["total"], reverse=True):
    dc = dept_counts[dept]
    pct = dc["with_supplier"] / dc["total"] * 100 if dc["total"] > 0 else 0
    w(f"| {dept} | {dc['total']} | {dc['with_supplier']} | {dc['without']} | {pct:.0f}% |")
w()

# ═══════════════════════════════════════════════════════════════════════════
# PART 2: PARETO
# ═══════════════════════════════════════════════════════════════════════════

w("---")
w()
w("## PARTE 2: Analisis Pareto de Ventas")
w()
w(f"Periodo: {date_range_start} a {date_range_end} ({len(sales_rows)} dias)")
w(f"Ingreso total del periodo: ${total_revenue:,.0f} MXN")
w(f"Platillos con ventas registradas: {len(all_sales)}")
w()

w("### Resumen Pareto")
w()
w(f"| Metrica | Valor |")
w(f"|---|---|")
w(f"| Platillos que generan 80% del ingreso | {pareto_threshold_idx} de {len(all_sales)} ({pareto_threshold_idx/len(all_sales)*100:.1f}%) |")
w(f"| Ingreso del top {pareto_threshold_idx} platillos | ${sum(d['total_revenue'] for _,d,_ in pareto_critical):,.0f} MXN |")
w(f"| Food cost % promedio (Pareto criticos) | {avg_pareto_fc:.1f}% |")
w(f"| Food cost % promedio (resto) | {avg_rest_fc:.1f}% |")
w(f"| Ingredientes unicos en recetas Pareto | {len(pareto_ingredients)} |")
w()

# ── Pareto Table ──────────────────────────────────────────────────────────
w("### Los platillos que generan el 80% del ingreso")
w()
w("| # | Platillo | Ingreso | % del total | % acumulado | Qty vendida | Dias |")
w("|---|---|---|---|---|---|---|")
for i, (name, data, cum_pct) in enumerate(pareto_critical, 1):
    pct = data["total_revenue"] / total_revenue * 100
    w(f"| {i} | {name} | ${data['total_revenue']:,.0f} | {pct:.1f}% | {cum_pct:.1f}% | {data['total_qty']:,} | {data['days_seen']} |")
w()

# ── Food Cost of Pareto items ─────────────────────────────────────────────
w("### Food Cost de los platillos Pareto-criticos")
w()
w("| # | Platillo | Precio | Food Cost | Cost % | Ingreso periodo | Margen estimado |")
w("|---|---|---|---|---|---|---|")
pareto_food_costs_sorted = sorted(pareto_food_costs, key=lambda x: x["revenue"], reverse=True)
for i, fc in enumerate(pareto_food_costs_sorted, 1):
    margin = fc["precio"] - fc["cost"]
    total_margin = margin * fc["qty"]
    w(f"| {i} | {fc['name']} | ${fc['precio']:,.0f} | ${fc['cost']:,.2f} | {fc['pct']:.1f}% | ${fc['revenue']:,.0f} | ${total_margin:,.0f} |")
w()

# ── Critical Ingredients for Pareto ───────────────────────────────────────
w("### Ingredientes criticos para los platillos Pareto")
w()
w("Estos ingredientes aparecen en las recetas de los platillos que generan el 80% del ingreso.")
w()
w("| # | Ingrediente | Platillos Pareto que lo usan | Recetas totales | Depto | Costo/u | Proveedor |")
w("|---|---|---|---|---|---|---|")
for i, (ing, count) in enumerate(pareto_ing_sorted[:25], 1):
    d = ingredient_data.get(ing, {})
    supps = ", ".join(d.get("suppliers", [])[:2]) if d.get("suppliers") else "SIN PROVEEDOR"
    w(f"| {i} | {ing} | {count} | {d.get('n_recipes',0)} | {d.get('department','')} | ${d.get('best_cost',0):,.2f} | {supps} |")
w()

# ── Cross analysis: Pareto + Dependency ───────────────────────────────────
w("### Cruce: Ingredientes de alto impacto (Pareto + Dependencia)")
w()
w("Ingredientes que son criticos tanto por Pareto (platillos de mayor venta) como por dependencia (usados en muchas recetas).")
w()

high_impact = []
for ing, count in pareto_ing_sorted:
    d = ingredient_data.get(ing, {})
    if d.get("n_recipes", 0) >= 8 and count >= 2:
        high_impact.append({
            "name": ing,
            "pareto_count": count,
            "n_recipes": d["n_recipes"],
            "n_platillos": d["n_platillos"],
            "best_cost": d.get("best_cost", 0),
            "stock_value": d.get("stock_value", 0),
            "department": d.get("department", ""),
            "suppliers": d.get("suppliers", []),
        })

high_impact.sort(key=lambda x: x["pareto_count"] * x["n_recipes"], reverse=True)

w("| # | Ingrediente | Platillos Pareto | Total recetas | Total platillos | Costo/u | Stock $ | Proveedor |")
w("|---|---|---|---|---|---|---|---|")
for i, h in enumerate(high_impact[:20], 1):
    supps = ", ".join(h["suppliers"][:2]) if h["suppliers"] else "SIN PROVEEDOR"
    w(f"| {i} | {h['name']} | {h['pareto_count']} | {h['n_recipes']} | {h['n_platillos']} | ${h['best_cost']:,.2f} | ${h['stock_value']:,.0f} | {supps} |")
w()

# ── The long tail ─────────────────────────────────────────────────────────
w("### La cola larga: platillos que NO justifican su complejidad")
w()
w("Platillos con bajo ingreso pero ingredientes unicos (ingredientes que SOLO se usan para ese platillo).")
w()

# Find platillos with unique ingredients that sell little
tail_items = []
for name, data, cum_pct in pareto_rest:
    if data["total_revenue"] < total_revenue * 0.005:  # less than 0.5% of revenue
        p = platillo_by_name.get(name)
        if p:
            code = p["clave"]
            if code in receta_by_code:
                r = receta_by_code[code]
                unique_ings = []
                for ing in r.get("ingredients", []):
                    ing_name = ing["product"].upper().strip()
                    if ingredient_data.get(ing_name, {}).get("n_recipes", 0) <= 2:
                        unique_ings.append(ing_name)
                if unique_ings:
                    tail_items.append({
                        "name": name,
                        "revenue": data["total_revenue"],
                        "qty": data["total_qty"],
                        "unique_ings": unique_ings,
                        "precio": p["precio"],
                    })

tail_items.sort(key=lambda x: len(x["unique_ings"]), reverse=True)

w("| # | Platillo | Ingreso total | Qty | Ingredientes unicos (solo para este platillo) |")
w("|---|---|---|---|---|")
for i, t in enumerate(tail_items[:15], 1):
    ings = ", ".join(t["unique_ings"][:4])
    if len(t["unique_ings"]) > 4:
        ings += f" (+{len(t['unique_ings'])-4})"
    w(f"| {i} | {t['name']} | ${t['revenue']:,.0f} | {t['qty']} | {ings} |")
w()

# ── Actionable Summary ────────────────────────────────────────────────────
w("---")
w()
w("## Acciones Recomendadas")
w()

w("### Accion 1: Proteger los ingredientes de mayor impacto")
w()
w("Estos ingredientes son los mas criticos del negocio. Sin ellos, se caen los platillos que generan el 80% del ingreso.")
w()
top5_impact = high_impact[:7]
for h in top5_impact:
    supps = ", ".join(h["suppliers"][:2]) if h["suppliers"] else "BUSCAR PROVEEDOR"
    w(f"- **{h['name']}**: {h['n_recipes']} recetas, {h['pareto_count']} platillos Pareto. Proveedor: {supps}")
w()

w("### Accion 2: Vincular proveedores faltantes")
w()
w(f"{len(supply_risk)} ingredientes de uso frecuente (5+ recetas) no tienen proveedor vinculado en el sistema. Los mas criticos:")
w()
for d in supply_risk[:7]:
    w(f"- **{d['name']}**: {d['n_recipes']} recetas, {d['n_platillos']} platillos. Depto: {d['department']}")
w()

w("### Accion 3: Revisar precios de platillos Pareto con food cost alto")
w()
high_fc_pareto = [fc for fc in pareto_food_costs if fc["pct"] > 30]
high_fc_pareto.sort(key=lambda x: x["pct"], reverse=True)
if high_fc_pareto:
    for fc in high_fc_pareto[:7]:
        w(f"- **{fc['name']}**: precio ${fc['precio']:,.0f}, food cost {fc['pct']:.1f}% (${fc['cost']:,.2f}). Se venden {fc['qty']:,} unidades en el periodo.")
else:
    w("Todos los platillos Pareto tienen food cost saludable.")
w()

w("### Accion 4: Evaluar la cola larga")
w()
w(f"{len(tail_items)} platillos de baja venta requieren ingredientes unicos que solo ellos usan. Considerar:")
w()
w("- Eliminar del menu los que no venden y complican el inventario")
w("- Sustituir ingredientes unicos por ingredientes compartidos con otros platillos")
w("- Si el platillo es de temporada, solo comprar el ingrediente en temporada")
w()

w("### Accion 5: Monitoreo de stock de ingredientes criticos")
w()
w("El sistema actual de existencias NO tiene cantidades fisicas (stock = null en todos los registros). Solo tiene valor monetario.")
w()
w("Recomendacion: Implementar conteo fisico al menos para los top 20 ingredientes de esta lista. Sin eso, no se puede detectar desabasto antes de que pase.")
w()

# Write output
with open(OUT, "w") as f:
    f.write("\n".join(lines))

print(f"\nAnalisis escrito en: {OUT}")
print(f"Total ingredientes analizados: {len(ingredient_data)}")
print(f"Puntos unicos de falla (10+ recetas): {len(spof)}")
print(f"Riesgos de cadena (5+ recetas, sin proveedor): {len(supply_risk)}")
print(f"Pareto: {pareto_threshold_idx} platillos generan 80% del ingreso")
print(f"Ingredientes de alto impacto (Pareto + Dependencia): {len(high_impact)}")
