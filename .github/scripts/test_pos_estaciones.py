#!/usr/bin/env python3
"""La estación del renglón sale como la saca el POS. Sin red.

LO QUE FIJAN ESTAS PRUEBAS
El simulador escribía `estacion`, un campo que NADIE lee: las tres pantallas de cocina
leen `item.station` y, al no encontrarlo, caen en su fallback "for legacy orders that
predate the item.station field". El laboratorio nunca ejercitaba el camino real.

La trampa del arreglo es que renombrar el campo a secas EMPEORA el demo: la carta ponía
"cocina" en todos los platillos, y con `station` explícito `pos/kds/page.tsx` manda a la
cocina todo lo marcado así — un Latte incluido, que hoy el fallback rutea bien a barra.
Por eso la estación se resuelve de verdad, con la precedencia de `getStationForItem`.

En orden:
  1. La precedencia, nivel por nivel, y en el orden correcto.
  2. Los 28 platillos de `demo`: sólo Cold Brew y Cortado cambian de estación, y los dos
     hacia barra, que es donde va el café.
  3. Que las listas no se desincronicen de pos-constants.ts. Es una COPIA, y la copia se
     protege parseando el TypeScript: si alguien agrega una categoría al POS y no aquí,
     esta prueba truena. Es la guarda que no existía cuando se colaron `menuItemId` y
     `subtotal`.
  4. El renglón sale con `station` y ya no con `estacion`.
"""
from __future__ import annotations

import re
import sys
import unittest
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import lab_simulator as sim  # noqa: E402
import pos_estaciones as pe  # noqa: E402

CONSTANTES_TS = Path(__file__).parents[2] / "dashboard-app/src/lib/pos-constants.ts"

# Las categorías reales de `demo`, medidas el 2026-09-09.
CATS_DEMO = {"cafe": "Café", "desayunos": "Desayunos", "almuerzo": "Almuerzo",
             "bebidas": "Bebidas", "postres": "Postres"}


@contextmanager
def silencio():
    with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
        yield


# ── 1. Precedencia ───────────────────────────────────────────────────────────

class LaPrecedenciaEsLaDelPOS(unittest.TestCase):
    def test_1_el_override_del_tenant_gana_sobre_todo(self):
        # `amalay` manda siete categorías `mkt-*` a caja con esto. Es el primer nivel
        # de `getStationForItem` y el simulador tiene que respetarlo.
        self.assertEqual(
            pe.estacion_de("coffee", "Coffee Hot/Ice", "Latte", {"coffee": "caja"}),
            "caja")

    def test_2_el_id_de_categoria_gana_sobre_el_nombre(self):
        # 'postres' está en STATION_CATEGORIES.cocina, pero el NOMBRE "Postres" empata
        # con la regla de caja. Gana el id — y por eso los postres del demo siguen
        # imprimiendo comanda en cocina en vez de irse a caja, que es [NO IMPRIMIR].
        self.assertEqual(pe.estacion_de("postres", "Postres", "Brownie"), "cocina")

    def test_3_sin_id_conocido_manda_el_nombre_de_la_categoria(self):
        # 'cafe' NO está en STATION_CATEGORIES (la lista dice 'coffee'). Lo que salva el
        # ruteo del demo es el nombre de la categoría.
        self.assertEqual(pe.estacion_de("cafe", "Café", "Cold Brew"), "barra")

    def test_4_sin_categoria_util_manda_el_nombre_del_platillo(self):
        self.assertEqual(pe.estacion_de("bebidas", "Bebidas", "Jugo de Naranja"), "barra")
        self.assertEqual(pe.estacion_de("bebidas", "Bebidas", "Sopa"), "cocina")

    def test_5_lo_que_no_empata_con_nada_va_a_cocina(self):
        self.assertEqual(pe.estacion_de(None, None, "Algo Inclasificable"), "cocina")

    def test_el_orden_de_CATEGORY_NAME_TO_STATION_importa(self):
        # "Fresh Drinks" empata con 'fresh' (barra) antes que con nada más. Si la lista
        # se reordenara, este empate cambiaría de estación sin que nadie lo notara.
        self.assertEqual(pe.estacion_por_nombre_de_categoria("Fresh Drinks"), "barra")

    def test_solo_devuelve_estaciones_que_el_POS_conoce(self):
        for cid, cnombre in CATS_DEMO.items():
            self.assertIn(pe.estacion_de(cid, cnombre, "X"), pe.ESTACIONES)


# ── 2. El menú real de demo ──────────────────────────────────────────────────

class ElRuteoDelDemo(unittest.TestCase):
    CAFE = ["Americano", "Cappuccino", "Cold Brew", "Cortado", "Espresso",
            "Latte", "Matcha Latte", "Mocca"]
    BEBIDAS = ["Agua de Jamaica", "Agua Mineral", "Jugo de Naranja", "Limonada",
               "Té de la Casa"]
    COMIDA = ["Avocado Toast", "French Toast", "Granola Bowl", "Hotcakes",
              "Huevos Benedictinos", "Huevos Divorciados", "Club Sandwich",
              "Ensalada César", "Pasta Pomodoro", "Sopa del Día", "Wrap de Pollo"]
    POSTRES = ["Brownie", "Cheesecake", "Flan Napolitano", "Waffle de Fresa"]

    def test_todo_el_cafe_va_a_barra(self):
        for nombre in self.CAFE:
            self.assertEqual(pe.estacion_de("cafe", "Café", nombre), "barra", nombre)

    def test_las_bebidas_van_a_barra(self):
        for nombre in self.BEBIDAS:
            self.assertEqual(pe.estacion_de("bebidas", "Bebidas", nombre), "barra", nombre)

    def test_la_comida_va_a_cocina(self):
        for cat, nombre in [("desayunos", n) for n in self.COMIDA[:6]] + \
                           [("almuerzo", n) for n in self.COMIDA[6:]]:
            self.assertEqual(pe.estacion_de(cat, CATS_DEMO[cat], nombre), "cocina", nombre)

    def test_los_postres_siguen_en_cocina_y_no_se_van_a_caja(self):
        # caja es [NO IMPRIMIR] por defecto: mandarlos ahí los dejaría sin comanda.
        for nombre in self.POSTRES:
            self.assertEqual(pe.estacion_de("postres", "Postres", nombre), "cocina", nombre)

    def test_solo_cambian_de_ruteo_Cold_Brew_y_Cortado(self):
        # El resto conserva EXACTAMENTE el ruteo que hoy produce el fallback por nombre.
        # Si esta prueba empieza a fallar, el cambio dejó de ser el que se midió.
        cambian = set()
        for cat, nombres in [("cafe", self.CAFE), ("bebidas", self.BEBIDAS),
                             ("postres", self.POSTRES),
                             ("desayunos", self.COMIDA[:6]), ("almuerzo", self.COMIDA[6:])]:
            for nombre in nombres:
                antes = pe.estacion_por_nombre_del_platillo(nombre)
                ahora = pe.estacion_de(cat, CATS_DEMO[cat], nombre)
                if antes != ahora:
                    cambian.add((nombre, antes, ahora))
        self.assertEqual(
            cambian,
            {("Cold Brew", "cocina", "barra"), ("Cortado", "cocina", "barra")})


# ── 3. La copia no se puede pudrir ───────────────────────────────────────────

def _sin_comentarios(texto: str) -> str:
    return re.sub(r"//[^\n]*", "", texto)


def _bloque(fuente: str, declaracion: str, cierre: str) -> str:
    i = fuente.index(declaracion) + len(declaracion)
    j = fuente.index(cierre, i)
    return _sin_comentarios(fuente[i:j])


def _cadenas(texto: str) -> list[str]:
    return re.findall(r"'([^']*)'", texto)


class LasListasSiguenSiendoLasDelPOS(unittest.TestCase):
    """Parsea pos-constants.ts. Truena si el espejo se desincroniza.

    Sin esto la copia envejece en silencio y el simulador rutea con reglas viejas — la
    misma clase de fallo mudo que dejó `demo` vendiendo sin descontar.
    """

    @classmethod
    def setUpClass(cls):
        cls.ts = CONSTANTES_TS.read_text(encoding="utf-8")

    def test_el_archivo_de_constantes_sigue_donde_creemos(self):
        self.assertTrue(CONSTANTES_TS.is_file(), f"no existe {CONSTANTES_TS}")

    def test_STATION_CATEGORIES_coincide(self):
        bloque = _bloque(
            self.ts,
            "export const STATION_CATEGORIES: Record<StationName, string[]> = {",
            "\n}")
        for estacion in ("cocina", "barra", "caja"):
            m = re.search(rf"{estacion}:\s*\[(.*?)\]", bloque, re.S)
            self.assertIsNotNone(m, f"no se encontró la lista de {estacion}")
            self.assertEqual(_cadenas(m.group(1)), pe.STATION_CATEGORIES[estacion],
                             f"STATION_CATEGORIES.{estacion} cambió en pos-constants.ts")

    def test_CATEGORY_NAME_TO_STATION_coincide_en_contenido_y_orden(self):
        bloque = _bloque(
            self.ts,
            "const CATEGORY_NAME_TO_STATION: Array<{ keywords: string[]; station: StationName }> = [",
            "\n]")
        entradas = [(_cadenas(kw), est) for kw, est in
                    re.findall(r"keywords:\s*\[(.*?)\],\s*station:\s*'([^']+)'", bloque, re.S)]
        self.assertEqual(entradas, pe.CATEGORY_NAME_TO_STATION,
                         "CATEGORY_NAME_TO_STATION cambió (contenido u orden)")

    def test_BEBIDA_KEYWORDS_coincide(self):
        bloque = _bloque(self.ts, "export const BEBIDA_KEYWORDS = [", "\n]")
        self.assertEqual(_cadenas(bloque), pe.BEBIDA_KEYWORDS,
                         "BEBIDA_KEYWORDS cambió en pos-constants.ts")

    def test_CAJA_KEYWORDS_coincide(self):
        bloque = _bloque(self.ts, "const CAJA_KEYWORDS = [", "\n]")
        self.assertEqual(_cadenas(bloque), pe.CAJA_KEYWORDS,
                         "CAJA_KEYWORDS cambió en pos-constants.ts")

    def test_el_parser_de_verdad_encuentra_algo(self):
        # Un regex que no empata devolvería listas vacías y las pruebas de arriba
        # pasarían comparando nada contra nada.
        bloque = _bloque(self.ts, "export const BEBIDA_KEYWORDS = [", "\n]")
        self.assertGreater(len(_cadenas(bloque)), 20)


# ── 4. El renglón que sale del simulador ─────────────────────────────────────

class ElRenglonLlevaStation(unittest.TestCase):
    def orden(self, carta):
        with silencio(), mock.patch.object(sim, "menu_del_tenant", lambda: carta), \
                mock.patch.object(sim, "next_order_number", lambda: 1):
            return sim.make_order(0, "t")

    def test_el_campo_se_llama_station(self):
        for it in self.orden([("mi-1", "Latte", 60.0, "barra")])["items"]:
            self.assertEqual(it["station"], "barra")

    def test_ya_no_se_escribe_estacion(self):
        # Nadie lo leía. Dejarlo además de `station` sería inventar un campo que el POS
        # real no manda.
        for it in self.orden([("mi-1", "Latte", 60.0, "barra")])["items"]:
            self.assertNotIn("estacion", it)

    def test_la_carta_de_respaldo_conserva_sus_estaciones(self):
        # MENU trae cocina/barra/caja escritas a mano y ya eran los nombres correctos.
        sim._menu_cache = None
        with silencio(), mock.patch.object(sim, "sb_get", side_effect=RuntimeError("sin red")):
            respaldo = sim.menu_del_tenant()
        sim._menu_cache = None
        self.assertEqual([e for _, _, _, e in respaldo], [e for _, _, e in sim.MENU])
        self.assertTrue(set(e for _, _, _, e in respaldo) <= set(pe.ESTACIONES))


if __name__ == "__main__":
    unittest.main(verbosity=2)
