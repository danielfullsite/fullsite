#!/usr/bin/env python3
"""Reparar unidades de `pos_recipes_old` sin cambiar cuánto se descuenta.

POR QUÉ EXISTE ESTA REPARACIÓN
`sembrar_r1()` escribe `recipe_unit` desde la constante del script, así que la cadena
que descuenta hoy nace bien. Pero `/api/pos/recipe-sync` reproyecta desde
`pos_recipes_old` cada vez que alguien edita una receta en /recetas o /pos/recetas:
lee `unit` de ahí y lo copia tal cual a `pos_recipe_lines`.

Un renglón con "pza" por lo tanto no rompe nada hoy y rompe todo el día que un usuario
toque esa receta en la UI — `convert_recipe_to_stock('pza','pz')` devuelve NULL y
`r1_reconcile_item` marca BLOCKED_UNIT_MISSING. Sin error visible: la receta está, el
ingrediente está, y el platillo simplemente deja de descontar.

EL RIESGO DE LA REPARACIÓN ES PEOR QUE EL BUG
Renombrar "g" a "kg" no es un cambio de etiqueta: multiplica el consumo por mil, y
también en silencio. Por eso sólo se renombra cuando el alias apunta EXACTAMENTE a la
unidad del stock, y lo que no tiene alias se reporta en vez de adivinarse.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import sembrar_recetas_demo as seed  # noqa: E402


def correr(receta_unit, stock_unit, ingrediente="demo-huevo"):
    patches, gets = [], {
        "pos_inventory": [{"ingredient_id": "demo-huevo", "stock_unit": stock_unit}],
        "pos_recipes_old": [{"id": 1, "menu_item_name": "Flan",
                             "ingredient_id": ingrediente, "unit": receta_unit}],
    }
    from io import StringIO
    with mock.patch.object(seed, "sb_get", lambda t, p: gets.get(t, [])), \
         mock.patch.object(seed, "sb_patch", lambda t, p, d: patches.append((t, p, d))), \
         mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
        rotos = seed.normalizar_unidades("demo")
    return patches, rotos


class RenombraLoQueEsElMismoUnidad(unittest.TestCase):
    def test_pza_con_stock_en_pz(self):
        patches, rotos = correr("pza", "pz")
        self.assertEqual(patches, [("pos_recipes_old", "id=eq.1", {"unit": "pz"})])
        self.assertEqual(rotos, 0)

    def test_acepta_mayusculas_y_variantes(self):
        for grafia in ("PZA", "Pza", "piezas", "pza."):
            patches, _ = correr(grafia, "pz")
            self.assertEqual(len(patches), 1, f"no reparó '{grafia}'")

    def test_litros_escritos_como_L(self):
        patches, _ = correr("L", "lt")
        self.assertEqual(patches[0][2], {"unit": "lt"})


class NoTocaLoQueNoDebe(unittest.TestCase):
    def test_no_reetiqueta_g_como_kg(self):
        # El bug que esta guarda evita: 'g' contra 'kg' SÍ convierte. Renombrarlo
        # multiplicaría el consumo por mil, en silencio.
        patches, rotos = correr("g", "kg")
        self.assertEqual(patches, [])
        self.assertEqual(rotos, 0)

    def test_no_reetiqueta_ml_como_lt(self):
        patches, rotos = correr("ml", "lt")
        self.assertEqual(patches, [])
        self.assertEqual(rotos, 0)

    def test_no_toca_una_unidad_ya_correcta(self):
        self.assertEqual(correr("pz", "pz")[0], [])

    def test_una_unidad_sin_alias_se_reporta_en_vez_de_adivinar(self):
        # 'porción' contra 'kg' no tiene equivalencia. Inventarla sería inventar consumo.
        patches, rotos = correr("porción", "kg")
        self.assertEqual(patches, [])
        self.assertEqual(rotos, 1)

    def test_un_ingrediente_sin_stock_no_se_toca(self):
        # Sin fila en pos_inventory no hay unidad destino contra la cual comparar.
        patches, rotos = correr("pza", "pz", ingrediente="demo-inexistente")
        self.assertEqual(patches, [])
        self.assertEqual(rotos, 0)


class EspejoDeLaFuncionDeLaBase(unittest.TestCase):
    def test_convierte_las_mismas_parejas_que_convert_recipe_to_stock(self):
        for a, b in (("g", "kg"), ("kg", "g"), ("ml", "lt"), ("lt", "ml")):
            self.assertTrue(seed._convierte(a, b), f"{a}->{b}")

    def test_y_ninguna_otra(self):
        # convert_recipe_to_stock no sabe pasar de peso a volumen ni a piezas.
        for a, b in (("pza", "pz"), ("g", "lt"), ("pz", "kg"), ("kg", "lt")):
            self.assertFalse(seed._convierte(a, b), f"{a}->{b}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
