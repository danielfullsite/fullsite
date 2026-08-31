#!/usr/bin/env python3
"""Pruebas del resolvedor — sin red.

Lo que fijan, en orden de importancia:

  1. Que la TOLERANCIA salga del evento y no del script. Si viviera aquí, se podría
     aflojar después de ver los resultados y convertir un fallo en acierto. La regla la
     fija quien predice, no quien califica.

  2. Que NO se califique un día que todavía no cierra. Juzgar a las 2pm una predicción
     del cierre contra las ventas de las 2pm la reprueba siempre.

  3. Que "nada que calificar" no se confunda con "todo salió bien".
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import resolver_predicciones as rp  # noqa: E402


def evento(prediccion, fecha, tolerancia=None, eid="e1"):
    import json
    ev = {"prediccion": prediccion, "fecha_objetivo": fecha}
    if tolerancia is not None:
        ev["tolerancia_pct"] = tolerancia
    return {"id": eid, "evidence": json.dumps(ev), "created_at": "2026-08-25T20:00:00Z"}


def correr(eventos, reales):
    parches = []

    def sb_get_falso(tabla, params):
        if tabla == "ops_daily_history":
            return [{"fecha": f, "ventas_dia": v} for f, v in reales.items()]
        if tabla == "agent_events":
            return eventos
        return []

    def sb_patch_falso(tabla, q, data):
        parches.append((q, data))

    with mock.patch.object(rp, "sb_get", sb_get_falso), \
         mock.patch.object(rp, "sb_patch", sb_patch_falso):
        from io import StringIO
        with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
            res = rp.calificar("demo")
    return res, parches


AYER = str((datetime.now(timezone.utc) + timedelta(hours=-6)).date() - timedelta(days=1))
HOY = str((datetime.now(timezone.utc) + timedelta(hours=-6)).date())


class LaToleranciaLaFijaQuienPredice(unittest.TestCase):
    def test_dentro_de_su_tolerancia_es_acierto(self):
        # Predijo 10,000, cerró en 10,500 → 5% de error, tolerancia 10% → acierto.
        (cal, ok, _), parches = correr([evento(10000, AYER, 10)], {AYER: 10500})
        self.assertEqual((cal, ok), (1, 1))
        self.assertEqual(parches[0][1]["outcome"], "correct")

    def test_fuera_de_su_tolerancia_es_falso_positivo(self):
        # Mismo error del 5%, pero el evento pidió 3% → falla.
        (cal, ok, _), parches = correr([evento(10000, AYER, 3)], {AYER: 10500})
        self.assertEqual((cal, ok), (1, 0))
        self.assertEqual(parches[0][1]["outcome"], "false_positive")

    def test_el_script_NO_puede_aflojar_la_tolerancia(self):
        # Lo importante: aunque el default del script sea 10, un evento que pidió 3
        # se califica con 3. Si esto se rompiera, bastaría subir el default para que
        # todo el historial pareciera acertado.
        self.assertEqual(rp.TOLERANCIA_POR_OMISION, 10.0)
        (_, ok, _), _ = correr([evento(10000, AYER, 3)], {AYER: 10500})
        self.assertEqual(ok, 0)


class NoJuzgarDiasAbiertos(unittest.TestCase):
    def test_el_dia_de_hoy_no_entra_en_la_ventana(self):
        self.assertNotIn(HOY, rp.dias_cerrados())

    def test_sin_venta_real_no_se_califica_se_cuenta_aparte(self):
        (cal, ok, sin), parches = correr([evento(10000, AYER, 10)], {})
        self.assertEqual((cal, ok, sin), (0, 0, 1))
        self.assertEqual(parches, [], "no debió tocar la base")

    def test_venta_real_en_cero_tampoco_se_califica(self):
        (cal, _, sin), _ = correr([evento(10000, AYER, 10)], {AYER: 0})
        self.assertEqual((cal, sin), (0, 1))


class EventosViejos(unittest.TestCase):
    def test_un_evento_sin_forma_falsificable_se_ignora(self):
        viejo = {"id": "x", "evidence": '{"texto":"las ventas van bajas"}', "created_at": ""}
        (cal, _, sin), parches = correr([viejo], {AYER: 10000})
        self.assertEqual(cal, 0)
        self.assertEqual(parches, [])

    def test_evidencia_corrupta_no_tumba_el_resolvedor(self):
        roto = {"id": "x", "evidence": "{no es json", "created_at": ""}
        (cal, _, _), _ = correr([roto, evento(10000, AYER, 10, "e2")], {AYER: 10000})
        self.assertEqual(cal, 1)   # el bueno sí se calificó


class LoQueSeGuarda(unittest.TestCase):
    def test_guarda_la_venta_real_y_el_error_para_poder_auditarlo(self):
        # Esta prueba hacia `json.loads(...["evidence"])`, o sea daba por bueno que el
        # resolvedor mandara TEXTO a una columna jsonb. Con eso PostgREST guardaba un
        # escalar de tipo string y `evidence->>'venta_real'` devolvia NULL: la prueba
        # confirmaba el bug en vez de atraparlo. Ahora se exige el dict directo.
        (_, _, _), parches = correr([evento(10000, AYER, 10)], {AYER: 12000})
        ev = parches[0][1]["evidence"]
        self.assertIsInstance(ev, dict, "evidence va a una columna jsonb: dict, no str")
        self.assertEqual(ev["venta_real"], 12000)
        self.assertAlmostEqual(ev["error_pct"], 16.67, places=1)
        self.assertIn("calificado_el", ev)

    def test_marca_el_evento_como_resuelto(self):
        (_, _, _), parches = correr([evento(10000, AYER, 10)], {AYER: 10000})
        self.assertEqual(parches[0][1]["status"], "resolved")

    def test_los_valores_de_outcome_son_los_que_la_base_acepta(self):
        # La tabla tiene CHECK (outcome IN ('correct','false_positive')). Cualquier
        # otro valor haría fallar el PATCH en silencio.
        for real, esperado in ((10000, "correct"), (99999, "false_positive")):
            (_, _, _), parches = correr([evento(10000, AYER, 10)], {AYER: real})
            self.assertIn(parches[0][1]["outcome"], ("correct", "false_positive"))
            self.assertEqual(parches[0][1]["outcome"], esperado)


if __name__ == "__main__":
    unittest.main(verbosity=2)
