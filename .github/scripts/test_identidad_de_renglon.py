#!/usr/bin/env python3
"""La venta descuenta inventario, o la corrida truena. Sin red.

LO QUE FIJAN ESTAS PRUEBAS
Con el turno ya arreglado, `demo` volvió a vender por el camino real — y siguió sin
mover un gramo. Corrida 34375190026 del 2026-09-09: 5 órdenes creadas, 5 cobradas,
`inventario SKIPPED (0 renglones, 0.000 aplicado)` en las cinco, y `success`.

La causa está en `r1_reconcile_order`, STEP 4:

    v_item_id      := v_item->>'id';
    v_menu_item_id := v_item->>'menuItemId';
    IF v_item_id IS NULL OR v_menu_item_id IS NULL THEN
      CONTINUE;  -- skip malformed items

Los ítems del simulador eran {nombre, precio, cantidad, estacion}. Sin esa pareja, la
RPC descartaba TODOS los renglones, devolvía vacío y `save-order` respondía 200 con
inventory_status=SKIPPED. La orden se cobraba y el inventario ni se enteraba.

En orden:
  1. Cada renglón lleva `id` y `menuItemId` — la pareja que exige la RPC.
  2. El `id` es por RENGLÓN y único dentro de la orden: es la llave de idempotencia
     (client_id, order_id, order_item_id) que evita descontar dos veces.
  3. `menuItemId` es el id del MENÚ, no el nombre: por ahí resuelve la receta.
  4. El payload viejo —el que produjo el SKIPPED— sigue siendo detectado como malo.
  5. lab-resto, que escribe directo a la tabla y no pasa por el reconciliador, no
     cambia: su carta de respaldo no tiene ids y sus ítems quedan igual que siempre.
  6. La guarda: cobrar sin conciliar inventario hace fallar la corrida, en vez de
     salir verde en vacío (ARQUITECTURA-CRUCE.md, regla 10).
"""
from __future__ import annotations

import sys
import unittest
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import lab_simulator as sim  # noqa: E402
import pos_client  # noqa: E402

CARTA = [
    ("menu-latte", "Latte", 60.0, "barra"),
    ("menu-espresso", "Espresso", 35.0, "barra"),
]


@contextmanager
def silencio():
    with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
        yield


@contextmanager
def carta(items):
    """Fija el menú y el folio, para que `make_order` no toque la red."""
    with silencio(), \
            mock.patch.object(sim, "menu_del_tenant", lambda: items), \
            mock.patch.object(sim, "next_order_number", lambda: 1):
        yield


def una_orden(items=CARTA):
    with carta(items):
        return sim.make_order(0, "turno-de-prueba")


# ── 1-3. La identidad que la RPC exige ───────────────────────────────────────

class CadaRenglonSePuedeIdentificar(unittest.TestCase):
    def test_todo_renglon_trae_id_y_menuItemId(self):
        for it in una_orden()["items"]:
            self.assertIn("id", it, "sin `id` la RPC descarta el renglón")
            self.assertIn("menuItemId", it, "sin `menuItemId` la RPC descarta el renglón")
            self.assertTrue(it["id"] and it["menuItemId"])

    def test_el_id_es_unico_dentro_de_la_orden(self):
        # Es la llave de idempotencia (client_id, order_id, order_item_id). Si dos
        # renglones la compartieran, el segundo chocaría con el ON CONFLICT DO NOTHING
        # del reconciliador y su consumo no se aplicaría nunca.
        ids = [it["id"] for it in una_orden()["items"]]
        self.assertEqual(len(ids), len(set(ids)), f"ids repetidos: {ids}")

    def test_dos_renglones_del_mismo_platillo_no_comparten_id(self):
        # El caso que más fácil se cuela: la carta tiene un solo platillo, así que
        # todos los renglones son el mismo — y aun así deben distinguirse.
        with carta([("menu-latte", "Latte", 60.0, "cocina")]):
            for _ in range(12):
                items = sim.make_order(0, "t")["items"]
                ids = [it["id"] for it in items]
                self.assertEqual(len(ids), len(set(ids)), f"ids repetidos: {ids}")

    def test_menuItemId_es_el_id_del_menu_no_el_nombre(self):
        # `r1_reconcile_item` resuelve política y receta POR menu_item_id. Mandar el
        # nombre ahí devuelve BLOCKED_UNCLASSIFIED aunque la receta exista.
        validos = {mid for mid, _, _, _ in CARTA}
        nombres = {n for _, n, _, _ in CARTA}
        for it in una_orden()["items"]:
            self.assertIn(it["menuItemId"], validos)
            self.assertNotIn(it["menuItemId"], nombres)

    def test_el_id_del_renglon_cuelga_del_id_de_la_orden(self):
        orden = una_orden()
        for it in orden["items"]:
            self.assertTrue(
                it["id"].startswith(orden["id"]),
                f"{it['id']} no pertenece visiblemente a {orden['id']}",
            )

    def test_no_se_perdio_nada_de_lo_que_ya_llevaba_el_renglon(self):
        # El KDS y el arqueo leen estos campos; agregar identidad no debe quitarlos.
        for it in una_orden()["items"]:
            for campo in ("nombre", "precio", "cantidad", "station"):
                self.assertIn(campo, it)

    def test_todo_renglon_trae_subtotal(self):
        # `ops_consumo_cobertura` pondera POR IMPORTE la fracción de lo vendido que tiene
        # receta. Ese porcentaje es el denominador que separa "catálogo incompleto" de
        # merma. Sin `subtotal` en el renglón sale NULL y la vista queda medio ciega.
        for it in una_orden()["items"]:
            self.assertIn("subtotal", it)
            self.assertEqual(it["subtotal"], round(it["precio"] * it["cantidad"], 2))

    def test_el_subtotal_de_los_renglones_suma_el_subtotal_de_la_orden(self):
        orden = una_orden()
        self.assertAlmostEqual(
            sum(i["subtotal"] for i in orden["items"]), orden["subtotal"], places=2)

    def test_el_total_sigue_cuadrando_con_los_renglones(self):
        orden = una_orden()
        subtotal = sum(i["precio"] * i["cantidad"] for i in orden["items"])
        self.assertAlmostEqual(orden["subtotal"], subtotal, places=2)
        self.assertAlmostEqual(orden["total"], round(subtotal * 1.16, 2), places=2)


# ── 4. El payload que causó el SKIPPED ───────────────────────────────────────

class ElPayloadViejoEraElProblema(unittest.TestCase):
    VIEJO = {"nombre": "Latte", "precio": 60, "cantidad": 1, "estacion": "cocina"}
    # `estacion` es parte de lo viejo: el campo que ninguna pantalla leía. Hoy el
    # renglón manda `station`, que es el que sí leen (ver test_pos_estaciones.py).

    def test_al_renglon_viejo_le_faltaba_la_pareja(self):
        self.assertNotIn("id", self.VIEJO)
        self.assertNotIn("menuItemId", self.VIEJO)

    def test_el_renglon_de_hoy_ya_no_se_parece_al_viejo(self):
        nuevo = una_orden()["items"][0]
        self.assertTrue({"id", "menuItemId"} <= set(nuevo))


# ── 5. lab-resto no se mueve ─────────────────────────────────────────────────

class ElLabNoCambia(unittest.TestCase):
    def test_la_carta_de_respaldo_no_inventa_ids_de_menu(self):
        # MENU no existe en `pos_menu_items`. Inventarle ids produciría
        # BLOCKED_UNCLASSIFIED en cualquier tenant que lo usara por el camino del POS.
        sim._menu_cache = None
        with silencio(), mock.patch.object(sim, "sb_get", side_effect=RuntimeError("sin red")):
            carta_respaldo = sim.menu_del_tenant()
        sim._menu_cache = None
        self.assertEqual(len(carta_respaldo), len(sim.MENU))
        self.assertTrue(all(mid is None for mid, _, _, _ in carta_respaldo))

    def test_sin_id_de_menu_el_renglon_queda_como_siempre(self):
        with carta([(None, "Wagyu A5 200g", 1280, "cocina")]):
            for it in sim.make_order(0, "t")["items"]:
                self.assertEqual(set(it), {"nombre", "precio", "cantidad", "subtotal",
                                           "station"})


# ── 6. La guarda: vender sin descontar no puede salir verde ──────────────────

class VenderSinDescontarEsUnFallo(unittest.TestCase):
    def test_todo_conciliado_no_se_queja(self):
        self.assertIsNone(sim.reclamo_del_inventario(3, ["COMPLETE"] * 3))

    def test_SKIPPED_truena(self):
        # El estado exacto de la corrida 34375190026.
        reclamo = sim.reclamo_del_inventario(5, ["SKIPPED"] * 5)
        self.assertIsNotNone(reclamo)
        self.assertIn("5 de 5", reclamo)
        self.assertIn("menuItemId", reclamo, "el reclamo debe decir qué revisar")

    def test_BLOCKED_truena(self):
        # Falta política o receta activa: la identidad llegó pero el platillo no
        # está clasificado. Es un fallo distinto y se nombra distinto.
        reclamo = sim.reclamo_del_inventario(2, ["BLOCKED", "COMPLETE"])
        self.assertIsNotNone(reclamo)
        self.assertIn("1 de 2", reclamo)
        self.assertIn("política de inventario", reclamo)

    def test_una_sola_mala_entre_muchas_buenas_tambien_truena(self):
        self.assertIsNotNone(sim.reclamo_del_inventario(10, ["COMPLETE"] * 9 + ["SKIPPED"]))

    def test_sin_ordenes_cobradas_no_hay_de_que_quejarse(self):
        # Restaurante cerrado: cero órdenes es lo correcto, no un fallo.
        self.assertIsNone(sim.reclamo_del_inventario(0, []))

    def test_PENDING_y_SIN_ESTADO_tambien_cuentan_como_malos(self):
        for estado in ("PENDING", "SIN_ESTADO"):
            self.assertIsNotNone(sim.reclamo_del_inventario(1, [estado]), estado)

    def test_el_reclamo_dice_cuantas_y_por_que(self):
        reclamo = sim.reclamo_del_inventario(4, ["SKIPPED", "SKIPPED", "BLOCKED", "COMPLETE"])
        self.assertIn("3 de 4", reclamo)
        self.assertIn("2 orden(es) SKIPPED", reclamo)
        self.assertIn("1 orden(es) BLOCKED", reclamo)


# ── El diagnóstico que se lee en el log ──────────────────────────────────────

class ElDiagnosticoNoMiente(unittest.TestCase):
    def test_cuenta_renglones_no_ingredientes(self):
        # Decía "ingrediente(s)" y por eso "0 ingrediente(s)" se leyó como "esta receta
        # no tiene ingredientes" cuando en realidad era "ningún renglón llegó".
        texto = pos_client.diagnostico_inventario({
            "inventory_status": "COMPLETE",
            "inventory_results": [{"r_applied": 2}, {"r_applied": -1}],
        })
        self.assertIn("2 renglón(es)", texto)
        self.assertIn("3.000 aplicado", texto)

    def test_el_estado_vacio_se_dice_asi(self):
        self.assertEqual(pos_client.diagnostico_inventario({}), "sin inventario")


if __name__ == "__main__":
    unittest.main(verbosity=2)
