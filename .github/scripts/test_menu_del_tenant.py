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
  4. Que la carta traiga el `id` del platillo. Se agregó el 2026-09-09: sin él las
     órdenes no pueden descontar inventario, porque `r1_reconcile_item` resuelve la
     receta por `menu_item_id` y no por el nombre.
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
            {"id": "mi-1", "name": "Café americano", "price": 45},
            {"id": "mi-2", "name": "Chilaquiles", "price": 120},
        ])
        self.assertEqual([n for _, n, _, _ in carta], ["Café americano", "Chilaquiles"])
        self.assertEqual([p for _, _, p, _ in carta], [45.0, 120.0])

    def test_la_carta_trae_el_id_del_platillo(self):
        # Es lo que `make_order` copia a `menuItemId`, y por donde el reconciliador
        # encuentra la receta. Sin id la venta no descuenta nada.
        carta = cargar_menu([{"id": "mi-1", "name": "Latte", "price": 60}])
        self.assertEqual([mid for mid, _, _, _ in carta], ["mi-1"])

    def test_los_precios_son_los_del_tenant_no_los_del_steakhouse(self):
        carta = cargar_menu([{"id": "mi-1", "name": "Latte", "price": 60}])
        self.assertLess(max(p for _, _, p, _ in carta), 200,
                        "se coló un precio de la carta premium")

    def test_descarta_platillos_sin_nombre_o_sin_precio(self):
        carta = cargar_menu([
            {"id": "mi-1", "name": "Bueno", "price": 50},
            {"id": "mi-2", "name": None, "price": 50},
            {"id": "mi-3", "name": "Sin precio", "price": None},
        ])
        self.assertEqual(len(carta), 1)


class ElLabNoCambia(unittest.TestCase):
    # El respaldo se compara sin el id: MENU no existe en `pos_menu_items`, así que sus
    # platillos salen con `menu_item_id = None`. Inventarles uno los mandaría al
    # reconciliador como platillos sin política — BLOCKED_UNCLASSIFIED.
    RESPALDO = None  # se llena en setUp

    def setUp(self):
        self.RESPALDO = [(None, n, p, e) for n, p, e in sim.MENU]

    def test_sin_menu_propio_usa_la_carta_de_respaldo(self):
        # lab-resto no tiene filas en pos_menu_items. Debe quedar EXACTAMENTE igual.
        self.assertEqual(cargar_menu([]), self.RESPALDO)

    def test_si_la_consulta_truena_tambien_cae_al_respaldo(self):
        self.assertEqual(cargar_menu(revienta=True), self.RESPALDO)

    def test_el_respaldo_no_trae_ids_inventados(self):
        self.assertTrue(all(mid is None for mid, _, _, _ in cargar_menu([])))

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
            return [{"id": "mi-x", "name": "X", "price": 10}]
        with mock.patch.object(sim, "sb_get", sb_get_falso):
            from io import StringIO
            with mock.patch("sys.stdout", StringIO()):
                sim.menu_del_tenant()
                sim.menu_del_tenant()
                sim.menu_del_tenant()
        self.assertEqual(len(llamadas), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
