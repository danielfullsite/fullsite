#!/usr/bin/env python3
"""Pruebas del verificador del contrato — sin red.

Lo que se prueba aquí es el criterio, no el SQL: cuándo este script decide que una vista
está mintiendo. Si se equivoca hacia el lado permisivo, deja pasar un contrato roto y todos
los agentes heredan el error a la vez. Si se equivoca hacia el estricto, marca como rota
una vista sana y se deja de creer en él, que acaba en lo mismo.

Las que más importan:
  · que un contrato sano NO se marque (falso positivo = se deja de leer el reporte)
  · que un descuadre real SÍ se marque, con los dos montos a la vista
  · que la cobertura que no suma los tickets se marque — es la falla silenciosa
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import verificar_contrato as vc  # noqa: E402


def orden(total, dia="2026-09-01", status="cerrada"):
    return {"status": status, "total": total, "dia_venta": dia}


def hora(ventas, dia="2026-09-01"):
    return {"dia_venta": dia, "ventas": ventas}


def persona(ventas, tickets, con_tiempo, sin_cierre, descartado,
            pct_efectivo=50.0, dia="2026-09-01", mesero="Ana"):
    return {"dia_venta": dia, "mesero": mesero, "ventas": ventas, "tickets": tickets,
            "ordenes_con_tiempo": con_tiempo, "ordenes_sin_cierre": sin_cierre,
            "ordenes_tiempo_descartado": descartado, "pct_efectivo": pct_efectivo}


def correr(ordenes, horas, personal):
    """Ejecuta verificar_tenant con respuestas fijas por tabla."""
    def fake(tabla, query):
        return {"pos_orders": ordenes, "ops_hourly": horas, "ops_personal": personal}[tabla]
    with mock.patch.object(vc, "sb_get", side_effect=fake):
        return vc.verificar_tenant("t1", "2026-09-01")


class UnContratoSanoNoSeAcusa(unittest.TestCase):
    def test_cuando_todo_cierra_no_hay_fallas(self):
        fallas = correr(
            [orden(100.0), orden(50.0)],
            [hora(60.0), hora(90.0)],                 # 150 repartido en dos horas
            [persona(150.0, 2, 1, 1, 0)],
        )
        self.assertEqual(fallas, [])

    def test_un_tenant_sin_ordenes_no_es_una_falla(self):
        self.assertEqual(correr([], [], []), [])

    def test_las_canceladas_y_divididas_no_cuentan(self):
        # La vista las excluye; el verificador tiene que excluirlas igual o acusaría
        # de descuadre a una vista correcta.
        fallas = correr(
            [orden(100.0), orden(999.0, status="cancelada"), orden(777.0, status="dividida")],
            [hora(100.0)],
            [persona(100.0, 1, 1, 0, 0)],
        )
        self.assertEqual(fallas, [])

    def test_un_centavo_de_redondeo_no_es_descuadre(self):
        fallas = correr([orden(100.0)], [hora(100.01)], [persona(100.0, 1, 1, 0, 0)])
        self.assertEqual(fallas, [])

    def test_pct_efectivo_nulo_no_se_acusa(self):
        # NULL = no se pudo calcular (sin ventas). No es un porcentaje fuera de rango.
        fallas = correr([orden(100.0)], [hora(100.0)],
                        [persona(100.0, 1, 1, 0, 0, pct_efectivo=None)])
        self.assertEqual(fallas, [])


class UnDescuadreRealSeMarca(unittest.TestCase):
    def test_ops_hourly_que_pierde_ventas(self):
        fallas = correr([orden(100.0)], [hora(60.0)], [persona(100.0, 1, 1, 0, 0)])
        self.assertEqual(len(fallas), 1)
        self.assertIn("ops_hourly", fallas[0])
        self.assertIn("60.00", fallas[0])   # lo que dio
        self.assertIn("100.00", fallas[0])  # lo que debía dar

    def test_ops_personal_que_pierde_un_mesero(self):
        fallas = correr([orden(100.0), orden(50.0)], [hora(150.0)],
                        [persona(100.0, 1, 1, 0, 0)])  # falta el segundo mesero
        self.assertTrue(any("ops_personal" in f for f in fallas))

    def test_diez_centavos_SI_es_descuadre(self):
        fallas = correr([orden(100.0)], [hora(100.10)], [persona(100.0, 1, 1, 0, 0)])
        self.assertEqual(len(fallas), 1)

    def test_la_cobertura_que_no_suma_los_tickets(self):
        # 5 tickets pero la cobertura sólo explica 3. Las columnas estarían diciendo
        # que falta menos señal de la que falta — la mentira silenciosa.
        fallas = correr([orden(100.0)], [hora(100.0)], [persona(100.0, 5, 2, 1, 0)])
        self.assertTrue(any("cobertura" in f for f in fallas))

    def test_un_porcentaje_imposible(self):
        fallas = correr([orden(100.0)], [hora(100.0)],
                        [persona(100.0, 1, 1, 0, 0, pct_efectivo=140.0)])
        self.assertTrue(any("pct_efectivo" in f for f in fallas))


if __name__ == "__main__":
    unittest.main(verbosity=2)
