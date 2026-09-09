#!/usr/bin/env python3
"""La estación de un renglón, resuelta como la resuelve el POS.

POR QUÉ EXISTE
El simulador escribía `estacion` en cada ítem. NADIE lee ese campo. Las tres pantallas
de cocina leen `item.station`:

    kds/page.tsx:51       if (item.station) return item.station
    cocina/page.tsx:39    if (i.station) return i.station
    pos/kds/page.tsx:51   if (item.station === 'barra') return 'barra'

Las dos primeras traen un fallback explícito "for legacy orders that predate the
item.station field". Todo lo que genera el simulador cae ahí: el ruteo se infiere por
palabras del nombre en vez de venir del campo que pone una terminal real. Es decir, el
laboratorio nunca ejercitaba el camino que usa el POS.

POR QUÉ NO BASTABA RENOMBRAR EL CAMPO
`menu_del_tenant()` ponía "cocina" en TODOS los platillos del tenant. Con `estacion` eso
daba igual —nadie lo leía— pero al llamarlo `station` se vuelve la verdad:
`pos/kds/page.tsx` con `station === 'cocina'` manda el renglón a cocina y ya. Un Latte,
que hoy el fallback rutea correctamente a barra por su nombre, se habría ido a la cocina.
El rename a secas EMPEORA el demo; hay que resolver la estación de verdad.

DE DÓNDE SALE LA ESTACIÓN
La misma precedencia que `getStationForItem()` en `dashboard-app/src/lib/pos-constants.ts`:

    1. override del tenant       clients.pos_settings -> 'pos.station_routing'
    2. id de categoría estático  STATION_CATEGORIES  ('postres' → cocina)
    3. nombre de la categoría    CATEGORY_NAME_TO_STATION  ('Café' → barra)
    4. el nombre del platillo    es_bebida() → barra
    5. el nombre del platillo    CAJA_KEYWORDS → caja
    6. cocina

DUPLICACIÓN, Y CÓMO NO SE PUDRE
Estas listas son un ESPEJO de pos-constants.ts. No hay forma de leerlas desde Python en
tiempo de ejecución —viven en TypeScript, no en la base— así que la copia se protege con
una prueba: `test_pos_estaciones.py` parsea el .ts y truena si las listas dejan de
coincidir. Si alguien agrega una categoría al POS y no aquí, el CI lo dice; que es
justamente lo que NO pasó con `menuItemId` ni con `subtotal`.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get

ESTACIONES = ("cocina", "barra", "caja")

# ── Espejo de pos-constants.ts ───────────────────────────────────────────────
# STATION_CATEGORIES
STATION_CATEGORIES = {
    "cocina": [
        "chilaquiles", "eggs", "croissants", "pancakes", "paninis",
        "pizzas", "bowls", "ceviche",
        "toast", "bakery", "postres",
        "promos", "keto", "kids", "soups", "munchies", "extras", "envios",
        "enchiladas-tacos", "salads-ceviche", "appetizers", "evento", "signature",
    ],
    "barra": [
        "coffee", "jugos", "fresh", "smoothies", "frappes",
        "sodas", "tea", "alcohol", "activaciones",
        "vinos", "cerveza", "licores",
    ],
    "caja": [
        "icecream", "desserts",
    ],
}

CATEGORY_TO_STATION = {
    cat: est for est, cats in STATION_CATEGORIES.items() for cat in cats
}

# CATEGORY_NAME_TO_STATION — el ORDEN importa: se devuelve la primera que empate.
CATEGORY_NAME_TO_STATION = [
    (["coffee", "café", "cafe"], "barra"),
    (["cerveza", "beer"], "barra"),
    (["bebidas oh", "licores", "licor", "2oz"], "barra"),
    (["jugos", "juice"], "barra"),
    (["fresh drink", "fresh"], "barra"),
    (["smoothie"], "barra"),
    (["frappe"], "barra"),
    (["soda"], "barra"),
    (["tea", "tisana"], "barra"),
    (["signature"], "cocina"),
    (["ice cream", "helado", "nieve"], "caja"),
    (["bakery", "panadería", "panaderia"], "cocina"),
    (["croissant"], "cocina"),
    (["toast", "bagel"], "cocina"),
    (["concha", "brownie", "galleta", "cookie", "muffin", "scone", "pan de", "crunchy"], "cocina"),
    (["market", "healthy snack", "vitamina", "suplemento", "regalo", "detalle", "marca propia"], "caja"),
    (["dessert", "postre"], "caja"),
    (["vino"], "barra"),
]

BEBIDA_KEYWORDS = [
    "cafe", "café", "cappuccino", "capuchino", "latte", "americano", "espresso", "mocca", "matcha", "chai",
    "smoothie", "frappe", "jugo", "limonada", "fresco",
    "soda", "coca", "agua", "te ", "té ", "tisana",
    "mimosa", "chamoyada", "cerveza", "vino",
    "heineken", "corona", "modelo", "pacifico", "pacífico", "victoria", "bohemia",
    "stella", "budweiser", "michelob", "miller", "tecate", "indio", "dos equis",
    "negra modelo", "xx lager", "montejo", "carta blanca", "leon", "león",
    "whisky", "whiskey", "tequila", "mezcal", "vodka", "ron ", "ginebra", "gin ",
    "margarita", "mojito", "piña colada", "sangria", "sangría", "michelada",
    "carajillo", "baileys", "kahlua", "amaretto",
]

CAJA_KEYWORDS = [
    "cafe grano", "cafe molido", "vaso cafe refill", "semilla", "dulce",
    "amalay -", "ramekin",
    "taza de ceramica", "termo", "vela", "gift card", "tarjeta de regalo",
    "ice cream", "helado", "nieve",
    "chips", "snack",
]


# ── Resolución ───────────────────────────────────────────────────────────────

def es_bebida(nombre: str) -> bool:
    bajo = (nombre or "").lower()
    return any(kw in bajo for kw in BEBIDA_KEYWORDS)


def estacion_por_nombre_de_categoria(cat_nombre: str | None) -> str | None:
    if not cat_nombre:
        return None
    bajo = cat_nombre.lower()
    for palabras, estacion in CATEGORY_NAME_TO_STATION:
        if any(kw in bajo for kw in palabras):
            return estacion
    return None


def estacion_por_nombre_del_platillo(nombre: str) -> str:
    """`getStationByName`: lo único que se puede usar cuando no hay categoría."""
    if es_bebida(nombre):
        return "barra"
    bajo = (nombre or "").lower()
    if any(kw in bajo for kw in CAJA_KEYWORDS):
        return "caja"
    return "cocina"


def estacion_de(category_id: str | None, cat_nombre: str | None, nombre: str,
                override: dict | None = None) -> str:
    """La estación del platillo, con la precedencia de `getStationForItem`."""
    if override and category_id and override.get(category_id):
        return override[category_id]
    if category_id and category_id in CATEGORY_TO_STATION:
        return CATEGORY_TO_STATION[category_id]
    por_categoria = estacion_por_nombre_de_categoria(cat_nombre)
    if por_categoria:
        return por_categoria
    return estacion_por_nombre_del_platillo(nombre)


# ── Config del tenant ────────────────────────────────────────────────────────

def override_del_tenant(client_id: str) -> dict | None:
    """`clients.pos_settings -> 'pos.station_routing'`, aplanado a {categoria: estación}.

    Es el primer nivel de precedencia del POS real y hoy `demo` no lo tiene (sale null),
    pero `amalay` sí — le manda siete categorías `mkt-*` a caja. Se lee en vez de asumir
    el default para que el simulador no se desincronice el día que alguien configure un
    tenant de pruebas desde /platform/config.
    """
    try:
        filas = sb_get("clients", f"id=eq.{client_id}&select=pos_settings&limit=1")
        if not filas:
            return None
        ajustes = filas[0].get("pos_settings") or {}
        ruteo = ajustes.get("pos.station_routing")
        if not isinstance(ruteo, dict):
            return None
        plano = {}
        for estacion, cats in ruteo.items():
            if estacion in ESTACIONES and isinstance(cats, list):
                for cat in cats:
                    plano[cat] = estacion
        if plano:
            print(f"[estaciones] {client_id} tiene ruteo propio: "
                  f"{len(plano)} categorías configuradas")
        return plano or None
    except Exception as e:
        print(f"[estaciones] no se pudo leer el ruteo de {client_id} ({e}); "
              f"se usan los defaults del sistema", file=sys.stderr)
        return None


def nombres_de_categorias(client_id: str) -> dict:
    """{category_id: nombre} del tenant. El POS hace lo mismo (`setCategoryNameCache`)
    porque las categorías nuevas traen id UUID y sólo el NOMBRE dice qué son."""
    try:
        filas = sb_get("pos_menu_categories",
                       f"client_id=eq.{client_id}&select=id,name&limit=200")
        return {f["id"]: f.get("name") for f in filas if f.get("id")}
    except Exception as e:
        print(f"[estaciones] no se pudieron leer las categorías de {client_id} ({e}); "
              f"la estación saldrá del nombre del platillo", file=sys.stderr)
        return {}
