#!/usr/bin/env python3
"""Pruebas del verificador de cuadre — sin red.

Este script decide si los números de un restaurante son confiables, y su veredicto es la
puerta por la que pasan todos los agentes. Si se equivoca hacia el lado permisivo, deja
entrar datos podridos; si se equivoca hacia el estricto, acusa de descuadre a un
restaurante que está bien.

Las que más importan:
  · que una orden correcta NO se marque (falso positivo = acusar sin razón)
  · que un descuadre real SÍ se marque, con el monto exacto en juego
  · que la tolerancia sea de un centavo — ni cero (redondeos de IVA) ni laxa
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import cuadre  # noqa: E402


def orden(**kw):
    base = {"id": "o1", "status": "cerrada", "subtotal": 100.0, "iva": 16.0,
            "descuento": 0.0, "total": 116.0,
            "items": [{"nombre": "X", "subtotal": 100.0}],
            "pagos": [{"metodo": "Efectivo", "monto": 116.0}],
            "metodo_pago": "Efectivo", "created_at": "2026-08-25T20:00:00Z"}
    base.update(kw)
    return base


def codigos(o):
    return [c for c, _, _ in cuadre.revisar_orden(o)]


class UnaOrdenSanaNoSeAcusa(unittest.TestCase):
    def test_la_orden_de_referencia_cuadra(self):
        self.assertEqual(codigos(orden()), [])

    def test_con_descuento_tambien_cuadra(self):
        # 100 − 10 = 90 ; IVA 14.40 ; total 104.40 ; y el pago tiene que seguirlo.
        # (La primera versión de esta prueba movió el total y dejó el pago en 116: el
        #  verificador lo cachó. Se deja anotado porque es justo lo que debe hacer.)
        self.assertEqual(codigos(orden(descuento=10.0, iva=14.40, total=104.40,
                                       pagos=[{"metodo": "Efectivo", "monto": 104.40}])), [])

    def test_una_orden_abierta_no_se_juzga_por_el_pago(self):
        o = orden(status="abierta", pagos=None, metodo_pago=None)
        self.assertNotIn("cerrada_sin_forma_de_pago", codigos(o))

    def test_un_POS_que_no_captura_lineas_no_es_un_descuadre(self):
        # coffee-shop tiene 565 órdenes sin items. Está incompleto, no descuadrado:
        # marcarlo acusaría de un problema que no existe.
        self.assertEqual(codigos(orden(items=[])), [])

    def test_items_sin_importe_tampoco_se_juzgan(self):
        self.assertEqual(codigos(orden(items=[{"nombre": "X", "cantidad": 1}])), [])


class UnDescuadreRealSeMarca(unittest.TestCase):
    def test_los_items_no_suman_el_subtotal(self):
        o = orden(items=[{"nombre": "X", "subtotal": 80.0}])
        self.assertIn("items_vs_subtotal", codigos(o))

    def test_la_aritmetica_del_total_no_da(self):
        o = orden(total=999.0)
        self.assertIn("aritmetica_del_total", codigos(o))

    def test_los_pagos_no_suman_el_total(self):
        o = orden(pagos=[{"metodo": "Efectivo", "monto": 50.0}])
        self.assertIn("pagos_vs_total", codigos(o))

    def test_cerrada_sin_forma_de_pago(self):
        # Se sirvió y no consta cómo se cobró. Es dinero sin rastro.
        o = orden(pagos=None, metodo_pago=None)
        self.assertIn("cerrada_sin_forma_de_pago", codigos(o))

    def test_boruca_NO_se_marca_por_no_traer_el_arreglo_pagos(self):
        # 200/200 de sus órdenes cerradas traen metodo_pago pero no `pagos`. El corte
        # cuadra; sólo no puede representar un pago dividido. Acusarla de descuadre
        # sería un falso positivo sobre un restaurante que está bien.
        o = orden(pagos=None, metodo_pago="Efectivo")
        self.assertEqual(codigos(o), [])


class ElMontoEnJuegoEsExacto(unittest.TestCase):
    def test_reporta_la_diferencia_no_el_total(self):
        o = orden(items=[{"nombre": "X", "subtotal": 80.0}])
        _, _, monto = cuadre.revisar_orden(o)[0]
        self.assertAlmostEqual(monto, 20.0, places=2)

    def test_una_cerrada_sin_pago_pone_en_juego_el_total_completo(self):
        o = orden(pagos=None, metodo_pago=None, total=116.0)
        fallas = [f for f in cuadre.revisar_orden(o) if f[0] == "cerrada_sin_forma_de_pago"]
        self.assertAlmostEqual(fallas[0][2], 116.0, places=2)


class LaTolerancia(unittest.TestCase):
    def test_es_de_un_centavo(self):
        self.assertEqual(cuadre.TOLERANCIA, 0.01)

    def test_medio_centavo_de_redondeo_de_IVA_no_es_descuadre(self):
        # `numeric` y el redondeo del IVA producen fracciones de centavo. Marcarlas
        # llenaría el reporte de ruido y nadie volvería a leerlo.
        self.assertEqual(codigos(orden(total=116.005)), [])

    def test_diez_centavos_SI_es_descuadre(self):
        self.assertIn("aritmetica_del_total", codigos(orden(total=116.10)))


class Robustez(unittest.TestCase):
    def test_items_como_texto_json_se_entienden(self):
        o = orden(items=json.dumps([{"nombre": "X", "subtotal": 100.0}]))
        self.assertEqual(codigos(o), [])

    def test_json_corrupto_no_tumba_el_verificador(self):
        self.assertIsInstance(cuadre.revisar_orden(orden(items="{no es json")), list)

    def test_nulos_no_truenan(self):
        o = orden(subtotal=None, iva=None, descuento=None, total=None, items=None, pagos=None,
                  metodo_pago=None)
        self.assertIsInstance(cuadre.revisar_orden(o), list)

    def test_un_total_en_texto_se_convierte(self):
        self.assertEqual(codigos(orden(total="116.00")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
