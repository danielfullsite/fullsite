#!/usr/bin/env python3
"""Siembra ingredientes, recetas e inventario para el restaurante de pruebas.

PARA QUÉ
Hoy NINGÚN restaurante puede cruzar consumo contra venta. Las dos mitades viven en
tenants distintos: `amalay` tiene inventario, recetas y movimientos frescos pero CERO
ventas en pos_orders (opera en Wansoft); los demás tienen ventas y no tienen recetas.

Sin un restaurante donde pase todo, cualquier cruce que se codifique corre sobre datos
donde el fenómeno no ocurre — se puede escribir, pero no se puede saber si sirve.

Este script le da a `demo` la mitad que le falta, para que el laboratorio 24/7 ejercite
el loop completo: vender → descontar inventario → detectar merma.

LA TABLA QUE IMPORTA ES `pos_recipes_old`, NO `pos_recipes`
Se ve al revés, y por poco lo siembro mal. La función que descuenta inventario de verdad
—`reconcile_order_inventory()`— hace:

    JOIN pos_recipes_old r ON r.client_id = ... AND lower(r.menu_item_name) = lower(elem->>'nombre')

O sea: empata por NOMBRE del platillo (en minúsculas), una fila por par
(platillo, ingrediente). `pos_recipes` existe y tiene otra forma —un jsonb de
ingredientes— pero el descuento en vivo NO la usa. Verificado leyendo la función en
producción el 2026-08-26.

SEGURIDAD
Escribe SOLO en la lista blanca de tenants de prueba. Sembrarle recetas inventadas a un
restaurante real le mete costos falsos a su food cost, que es un número con el que toma
decisiones de precio.

Idempotente: se puede correr muchas veces sin duplicar.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID (default demo)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_common import sb_get, sb_post  # noqa: E402

TENANTS_PERMITIDOS = {"demo", "lab-resto", "esqueleton-demo"}

# Las únicas unidades que la base acepta, impuestas por el CHECK
# `pos_inventory_stock_unit_check`. NO es una convención nuestra: es una restricción real
# y sembrar fuera de ella hace fallar el INSERT con un 400 seco.
#
# Ojo con el desorden que hay del otro lado: `pos_ingredients.unit` NO tiene ese CHECK, y
# en AMALAY conviven 18 grafías para 5 unidades — PZ/pz/pza./PZA, KG/kg/kilo/k, LT/lt,
# ML/GR/gramos, más BTA/paq/PQ/BL/porción. Cualquier cálculo que agrupe por unidad ahí
# está mal. Medido el 2026-08-26. Aquí se usa el conjunto canónico y punto.
UNIDADES_VALIDAS = {"kg", "g", "lt", "ml", "pz"}

# ─── Despensa ────────────────────────────────────────────────────────────────
# (id, nombre, unidad, costo por unidad MXN, categoría)
# Costos de mayoreo en Monterrey, orden de magnitud realista.
INGREDIENTES = [
    ("cafe-grano",    "Café en grano",        "kg",   320.0, "Café"),
    ("leche",         "Leche entera",         "lt",    28.0, "Lácteos"),
    ("leche-vegetal", "Leche de almendra",    "lt",    62.0, "Lácteos"),
    ("matcha",        "Matcha ceremonial",    "kg",  1450.0, "Café"),
    ("chocolate",     "Chocolate para taza",  "kg",   240.0, "Café"),
    ("huevo",         "Huevo",                "pz",    4.2, "Abarrotes"),
    ("pan-brioche",   "Pan brioche (rebanada)", "pz",  8.0, "Panadería"),
    ("pan-masa-madre","Pan masa madre (reb.)", "pz",   6.0, "Panadería"),
    ("aguacate",      "Aguacate",             "pz",   22.0, "Frutas y verduras"),
    ("jitomate",      "Jitomate",             "kg",    32.0, "Frutas y verduras"),
    ("lechuga",       "Lechuga romana",       "pz",   18.0, "Frutas y verduras"),
    ("fresa",         "Fresa",                "kg",    85.0, "Frutas y verduras"),
    ("naranja",       "Naranja para jugo",    "kg",    22.0, "Frutas y verduras"),
    ("limon",         "Limón",                "kg",    35.0, "Frutas y verduras"),
    ("jamaica",       "Flor de jamaica",      "kg",   180.0, "Abarrotes"),
    ("pollo",         "Pechuga de pollo",     "kg",   145.0, "Carnes"),
    ("tocino",        "Tocino",               "kg",   190.0, "Carnes"),
    ("queso-crema",   "Queso crema",          "kg",   115.0, "Lácteos"),
    ("queso-parm",    "Queso parmesano",      "kg",   320.0, "Lácteos"),
    ("harina",        "Harina",               "kg",    24.0, "Abarrotes"),
    ("pasta",         "Pasta seca",           "kg",    42.0, "Abarrotes"),
    ("granola",       "Granola artesanal",    "kg",   135.0, "Abarrotes"),
    ("yogurt",        "Yogurt natural",       "lt",    45.0, "Lácteos"),
    ("tortilla",      "Tortilla de maíz",     "pz",    1.6, "Abarrotes"),
    ("mantequilla",   "Mantequilla",          "kg",   180.0, "Lácteos"),
    ("azucar",        "Azúcar",               "kg",    26.0, "Abarrotes"),
    ("te-hojas",      "Té de hoja suelta",    "kg",   650.0, "Café"),
    ("agua-mineral",  "Agua mineral 355ml",   "pz",    9.0, "Bebidas"),
]

# ─── Recetas: platillo → [(ingrediente, cantidad)] ───────────────────────────
# Las cantidades buscan un food cost de 25–35%, que es donde vive una cafetería sana.
RECETAS = {
    # Café
    "Espresso":            [("cafe-grano", 0.022)],
    "Americano":           [("cafe-grano", 0.022)],
    "Cortado":             [("cafe-grano", 0.022), ("leche", 0.06)],
    "Cappuccino":          [("cafe-grano", 0.022), ("leche", 0.15)],
    "Latte":               [("cafe-grano", 0.022), ("leche", 0.22)],
    "Mocca":               [("cafe-grano", 0.022), ("leche", 0.20), ("chocolate", 0.025)],
    "Cold Brew":           [("cafe-grano", 0.045)],
    "Matcha Latte":        [("matcha", 0.004), ("leche-vegetal", 0.22)],
    # Desayunos
    "Huevos Benedictinos": [("huevo", 2), ("pan-brioche", 1), ("tocino", 0.06), ("mantequilla", 0.02)],
    "Huevos Divorciados":  [("huevo", 2), ("tortilla", 3), ("jitomate", 0.12)],
    "Avocado Toast":       [("pan-masa-madre", 1), ("aguacate", 1), ("jitomate", 0.05)],
    "French Toast":        [("pan-brioche", 2), ("huevo", 1), ("leche", 0.08), ("mantequilla", 0.02)],
    "Hotcakes":            [("harina", 0.12), ("huevo", 1), ("leche", 0.15), ("mantequilla", 0.02)],
    "Granola Bowl":        [("granola", 0.08), ("yogurt", 0.18), ("fresa", 0.06)],
    # Almuerzo
    "Pasta Pomodoro":      [("pasta", 0.15), ("jitomate", 0.25), ("queso-parm", 0.035)],
    "Club Sandwich":       [("pan-masa-madre", 2), ("pollo", 0.07), ("tocino", 0.025), ("lechuga", 0.10), ("jitomate", 0.06)],
    "Wrap de Pollo":       [("pollo", 0.11), ("lechuga", 0.20), ("jitomate", 0.06), ("harina", 0.05)],
    "Ensalada César":      [("lechuga", 0.45), ("queso-parm", 0.03), ("pan-masa-madre", 0.4)],
    "Sopa del Día":        [("jitomate", 0.22), ("pollo", 0.05), ("mantequilla", 0.015)],
    # Bebidas
    "Jugo de Naranja":     [("naranja", 0.55)],
    "Limonada":            [("limon", 0.16), ("azucar", 0.03)],
    "Agua de Jamaica":     [("jamaica", 0.025), ("azucar", 0.035)],
    "Té de la Casa":       [("te-hojas", 0.010), ("azucar", 0.01)],
    "Agua Mineral":        [("agua-mineral", 1)],
    # Postres
    "Waffle de Fresa":     [("harina", 0.10), ("huevo", 1), ("fresa", 0.09), ("mantequilla", 0.02)],
    "Cheesecake":          [("queso-crema", 0.11), ("harina", 0.03), ("azucar", 0.04)],
    "Brownie":             [("chocolate", 0.03), ("harina", 0.04), ("huevo", 1), ("mantequilla", 0.03)],
    "Flan Napolitano":     [("huevo", 2), ("leche", 0.12), ("azucar", 0.05)],
}

# Días de inventario inicial. Suficiente para que el simulador opere sin agotarse en un
# día, pero no tanto que una fuga de merma tarde semanas en notarse.
DIAS_DE_STOCK = 21


def ing_id(cid: str, slug: str) -> str:
    return f"{cid}-{slug}"


def sembrar(cid: str) -> int:
    costos = {slug: costo for slug, _, _, costo, _ in INGREDIENTES}
    unidades = {slug: um for slug, _, um, _, _ in INGREDIENTES}
    errores = 0

    # Se valida ANTES de escribir nada. La primera corrida sembró 28 ingredientes y 75
    # renglones de receta y sólo entonces reventó en el inventario con un 400, porque la
    # unidad decía "pza" y el CHECK exige "pz". Dejó los datos a medias.
    malas = {um for um in unidades.values() if um not in UNIDADES_VALIDAS}
    if malas:
        raise ValueError(
            f"unidades que la base va a rechazar: {sorted(malas)}. "
            f"Sólo acepta {sorted(UNIDADES_VALIDAS)} (CHECK pos_inventory_stock_unit_check)."
        )

    # 1) Ingredientes
    existentes = {r["id"] for r in sb_get("pos_ingredients", f"client_id=eq.{cid}&select=id&limit=500")}
    nuevos = [
        {"id": ing_id(cid, slug), "client_id": cid, "name": nombre, "unit": um,
         "cost_per_unit": costo, "category": cat, "yield_factor": 1.0, "active": True}
        for slug, nombre, um, costo, cat in INGREDIENTES
        if ing_id(cid, slug) not in existentes
    ]
    if nuevos:
        sb_post("pos_ingredients", nuevos)
    print(f"[sembrar] ingredientes: {len(nuevos)} nuevos, {len(existentes)} ya estaban")

    # 2) Recetas — la tabla que usa el descuento real
    menu = {m["name"]: m for m in
            sb_get("pos_menu_items", f"client_id=eq.{cid}&active=eq.true&select=id,name,price&limit=200")}
    ya = {(r["menu_item_name"], r["ingredient_id"])
          for r in sb_get("pos_recipes_old", f"client_id=eq.{cid}&select=menu_item_name,ingredient_id&limit=2000")}

    filas, resumen = [], []
    for platillo, comps in RECETAS.items():
        if platillo not in menu:
            print(f"[sembrar]   AVISO: '{platillo}' no está en el menú de {cid} — se omite", file=sys.stderr)
            errores += 1
            continue
        costo = sum(costos[s] * q for s, q in comps)
        precio = float(menu[platillo]["price"])
        resumen.append((platillo, precio, costo, 100 * costo / precio if precio else 0))
        for slug, cant in comps:
            if (platillo, ing_id(cid, slug)) in ya:
                continue
            filas.append({
                "client_id": cid,
                "menu_item_id": menu[platillo]["id"],
                "menu_item_name": platillo,
                "ingredient_id": ing_id(cid, slug),
                "quantity": cant,
                "unit": unidades[slug],
                "ingredient_type": "ingredient",
            })
    if filas:
        sb_post("pos_recipes_old", filas)
    print(f"[sembrar] recetas: {len(filas)} renglones nuevos sobre {len(RECETAS)} platillos")

    # 3) Inventario inicial — consumo diario estimado × DIAS_DE_STOCK
    consumo_diario: dict[str, float] = {}
    for platillo, comps in RECETAS.items():
        if platillo not in menu:
            continue
        # ~6 unidades vendidas al día por platillo: el simulador hace 4–9 órdenes/hora
        # a factor variable, con 2–5 platillos cada una.
        for slug, cant in comps:
            consumo_diario[slug] = consumo_diario.get(slug, 0) + cant * 6

    con_stock = {r["ingredient_id"] for r in
                 sb_get("pos_inventory", f"client_id=eq.{cid}&select=ingredient_id&limit=500")}
    inv = [
        {"client_id": cid, "ingredient_id": ing_id(cid, slug),
         "stock": round(cons * DIAS_DE_STOCK, 3),
         "reorder_point": round(cons * 4, 3),
         "reorder_quantity": round(cons * DIAS_DE_STOCK, 3),
         "stock_unit": unidades[slug]}
        for slug, cons in consumo_diario.items()
        if ing_id(cid, slug) not in con_stock
    ]
    if inv:
        sb_post("pos_inventory", inv)
    print(f"[sembrar] inventario: {len(inv)} ingredientes con stock inicial ({DIAS_DE_STOCK} días)")

    # 4) Food cost — que se vea, porque es el número que hace creíble el demo
    print("\n[sembrar] food cost por platillo:")
    fuera = 0
    for nombre, precio, costo, pct in sorted(resumen, key=lambda x: -x[3]):
        marca = ""
        if pct > 40 or pct < 15:
            marca = "  ← fuera de rango"
            fuera += 1
        print(f"    {nombre:<22} ${precio:>6.0f}  costo ${costo:>6.2f}  {pct:>5.1f}%{marca}")
    promedio = sum(r[2] for r in resumen) / sum(r[1] for r in resumen) * 100 if resumen else 0
    print(f"\n[sembrar] food cost promedio ponderado: {promedio:.1f}%"
          f"  ({fuera} platillo(s) fuera de 15–40%)")
    return errores


def main() -> int:
    cid = (os.environ.get("CLIENT_ID") or "demo").strip()
    if cid not in TENANTS_PERMITIDOS:
        print(f"[sembrar] ERROR: '{cid}' no es un tenant de prueba. "
              f"Sembrar recetas inventadas en un restaurante real le mete costos falsos "
              f"a su food cost, que es un número con el que fija precios.", file=sys.stderr)
        return 1
    print(f"[sembrar] tenant: {cid}\n")
    try:
        errores = sembrar(cid)
    except Exception as e:
        print(f"[sembrar] ERROR: {e}", file=sys.stderr)
        return 1
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
