#!/usr/bin/env python3
"""El simulador usa el menú del restaurante que simula.

POR QUÉ
Apuntar el simulador a `demo` con su carta de steakhouse (Wagyu A5 $1,280, langosta
$980) convirtió al demo en otro negocio de un día para otro:

    históricas del demo   1,203 órdenes, ticket promedio $418   ($30–$1,365)
    generadas con MENU       11 órdenes, ticket promedio $4,945 ($1,195–$12,992)

Doce veces el ticket. Un agente que compare hoy contra la historia grita "anomalía" con
razón pero por el motivo equivocado, y un prospecto ve un ticket de $12,992 junto a un
promedio de $418 y sabe que le enseñan algo falso.

Lo que fijan estas pruebas, en orden:
  1. Que un tenant CON menú propio lo use.
  2. Que lab-resto —que no tiene menú en la base— siga con la carta de respaldo, o sea
     que este cambio no lo altere.
  3. Que un fallo leyendo el menú no tumbe al simulador.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import lab_simulator as sim  # noqa: E402


def cargar_menu(filas=None, revienta=False):
    sim._menu_cache = None                     # la caché es de proceso
    def sb_get_falso(tabla, params):
        if revienta:
            raise RuntimeError("PostgREST caído")
        return filas or []
    with mock.patch.object(sim, "sb_get", sb_get_falso):
        from io import StringIO
        with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
            return sim.menu_del_tenant()


class UsaElMenuDelTenant(unittest.TestCase):
    def test_un_tenant_con_menu_propio_lo_usa(self):
        carta = cargar_menu([
            {"name": "Café americano", "price": 45},
            {"name": "Chilaquiles", "price": 120},
        ])
        self.assertEqual([n for n, _, _ in carta], ["Café americano", "Chilaquiles"])
        self.assertEqual([p for _, p, _ in carta], [45.0, 120.0])

    def test_los_precios_son_los_del_tenant_no_los_del_steakhouse(self):
        carta = cargar_menu([{"name": "Latte", "price": 60}])
        self.assertLess(max(p for _, p, _ in carta), 200,
                        "se coló un precio de la carta premium")

    def test_descarta_platillos_sin_nombre_o_sin_precio(self):
        carta = cargar_menu([
            {"name": "Bueno", "price": 50},
            {"name": None, "price": 50},
            {"name": "Sin precio", "price": None},
        ])
        self.assertEqual(len(carta), 1)


class ElLabNoCambia(unittest.TestCase):
    def test_sin_menu_propio_usa_la_carta_de_respaldo(self):
        # lab-resto no tiene filas en pos_menu_items. Debe quedar EXACTAMENTE igual.
        self.assertEqual(cargar_menu([]), sim.MENU)

    def test_si_la_consulta_truena_tambien_cae_al_respaldo(self):
        self.assertEqual(cargar_menu(revienta=True), sim.MENU)

    def test_la_carta_de_respaldo_sigue_intacta(self):
        nombres = [n for n, _, _ in sim.MENU]
        self.assertIn("Wagyu A5 200g", nombres)
        self.assertEqual(len(sim.MENU), 15)


class Cachea(unittest.TestCase):
    def test_no_consulta_el_menu_en_cada_orden(self):
        sim._menu_cache = None
        llamadas = []
        def sb_get_falso(tabla, params):
            llamadas.append(tabla)
            return [{"name": "X", "price": 10}]
        with mock.patch.object(sim, "sb_get", sb_get_falso):
            from io import StringIO
            with mock.patch("sys.stdout", StringIO()):
                sim.menu_del_tenant()
                sim.menu_del_tenant()
                sim.menu_del_tenant()
        self.assertEqual(len(llamadas), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
