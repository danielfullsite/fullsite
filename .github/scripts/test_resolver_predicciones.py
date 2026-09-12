#!/usr/bin/env python3
"""Pruebas del resolvedor — sin red.

Lo que fijan, en orden de importancia:

  1. Que la TOLERANCIA salga del evento y no del script. Si viviera aquí, se podría
     aflojar después de ver los resultados y convertir un fallo en acierto. La regla la
     fija quien predice, no quien califica.

  2. Que NO se califique un día que todavía no cierra. Juzgar a las 2pm una predicción
     del cierre contra las ventas de las 2pm la reprueba siempre.

  3. Que "nada que calificar" no se confunda con "todo salió bien".

  4. Que "cerrado" se mida en DÍAS DE NEGOCIO del tenant y no en calendario UTC-6. La
     versión anterior de esta prueba calculaba HOY con la misma regla equivocada que el
     script, así que la afirmación "hoy no entra" era cierta por construcción y no podía
     fallar nunca. Ahora se congela una hora real —las 03:00, que es cuando corre— y se
     comprueba contra la primitiva canónica.
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
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


# `demo` es uno de los clientes que tiene `business_day_start_local` en NULL en producción:
# sirve para fijar que el default de las 05:00 se aplica igual que en la base.
CLIENTE = {"id": "demo", "timezone": "America/Mexico_City", "business_day_start_local": None}


# 09:00 UTC del 2026-09-10 = 03:00 en Monterrey, que es la hora a la que corre
# `precision-agentes.yml`. A esa hora el día de negocio en curso es el 2026-09-09.
CONGELADO = datetime(2026, 9, 10, 9, 0, tzinfo=timezone.utc)


def reloj_congelado(instante: datetime = None):
    """Congela `now()` en los DOS módulos que lo consultan.

    `resolver_predicciones` y `ops_aggregate` importan `datetime` cada uno por su lado,
    así que hay que parchear ambos: si sólo se congelara uno, la prueba mediría una
    mezcla de reloj falso y reloj real.
    """
    fijo = instante or CONGELADO

    class _Reloj(datetime):
        @classmethod
        def now(cls, tz=None):
            return fijo.astimezone(tz) if tz else fijo.replace(tzinfo=None)

    import contextlib
    import ops_aggregate

    @contextlib.contextmanager
    def _ctx():
        with mock.patch.object(rp, "datetime", _Reloj), \
             mock.patch.object(ops_aggregate, "datetime", _Reloj):
            yield

    return _ctx()


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
            res = rp.calificar(CLIENTE)
    return res, parches


HOY = rp._dia_de_negocio_en_curso(CLIENTE)              # día de negocio en curso
AYER = str(date.fromisoformat(HOY) - timedelta(days=1))


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
        self.assertNotIn(HOY, rp.dias_cerrados(CLIENTE))

    def test_a_las_3am_el_dia_en_curso_sigue_abierto_y_no_se_califica(self):
        """La regresión concreta que este arreglo cierra.

        `precision-agentes.yml` corre a las 03:00 de Monterrey = 09:00 UTC. A esa hora el
        día de negocio en curso es el de AYER en calendario: empezó a las 05:00 de ayer y
        no termina hasta las 05:00 de hoy. La regla vieja (`now_utc - 6h`) lo daba por
        cerrado y calificaba la predicción contra un día que seguía acumulando ventas.

        SE CONGELA EL RELOJ, no se mockea `_dia_de_negocio_en_curso`. Mockear el ayudante
        haría que la prueba pasara igual con la regla vieja —que ni siquiera lo llama— y
        además el resultado dependería del día real en que corriera. Congelando `now()`
        las dos reglas ven el mismo instante y sólo una da la ventana correcta.
        """
        with reloj_congelado():
            ventana = rp.dias_cerrados(CLIENTE)

        self.assertNotIn("2026-09-09", ventana, "calificó un día que sigue abierto")
        self.assertEqual(ventana[-1], "2026-09-08", "el último cerrado es el anterior")
        self.assertEqual(ventana[0], "2026-09-02")
        self.assertEqual(len(ventana), rp.DIAS_ATRAS)

    def test_el_dia_en_curso_depende_de_la_zona_del_tenant(self):
        """Mismo instante, dos tenants, dos días de negocio distintos.

        A las 09:00 UTC son las 03:00 en Monterrey (día en curso: el 09) y las 04:00 en
        Chicago, que en septiembre va una hora adelante porque observa horario de verano
        y Monterrey dejó de observarlo en 2022. Sigue siendo antes de las 05:00, así que
        `tekila-rg` también está en el 09 — pero por su propia cuenta, no por la de
        Monterrey. Con la regla vieja los dos recibían la misma fecha clavada.
        """
        mty = dict(CLIENTE, timezone="America/Monterrey", business_day_start_local="05:00:00")
        chi = dict(CLIENTE, timezone="America/Chicago", business_day_start_local="05:00:00")
        with reloj_congelado():
            self.assertEqual(rp._dia_de_negocio_en_curso(mty), "2026-09-09")
            self.assertEqual(rp._dia_de_negocio_en_curso(chi), "2026-09-09")

        # Una hora antes ya se separan: 08:00 UTC = 02:00 en Monterrey y 03:00 en Chicago.
        with reloj_congelado(datetime(2026, 9, 10, 10, 30, tzinfo=timezone.utc)):
            # 10:30 UTC = 04:30 en Monterrey (aún el 09) y 05:30 en Chicago (ya el 10).
            self.assertEqual(rp._dia_de_negocio_en_curso(mty), "2026-09-09")
            self.assertEqual(rp._dia_de_negocio_en_curso(chi), "2026-09-10")

    def test_el_corte_de_las_5_se_aplica_aunque_el_cliente_no_lo_declare(self):
        """La base escribe `dia_venta` con coalesce(business_day_start_local,'05:00').

        Si aquí se usara otro default (o si reventara, que es lo que hace
        `get_business_day_config` con un NULL), las llaves de fecha no cruzarían contra
        `ops_daily_history` para los 5 clientes activos que lo tienen sin declarar.
        """
        sin_declarar = dict(CLIENTE, business_day_start_local=None)
        declarado = dict(CLIENTE, business_day_start_local="05:00:00")
        self.assertEqual(rp._dia_de_negocio_en_curso(sin_declarar),
                         rp._dia_de_negocio_en_curso(declarado))

    def test_sin_zona_declarada_usa_el_mismo_default_que_la_base(self):
        sin_zona = dict(CLIENTE, timezone=None, business_day_start_local="05:00:00")
        monterrey = dict(CLIENTE, timezone="America/Monterrey",
                         business_day_start_local="05:00:00")
        self.assertEqual(rp._dia_de_negocio_en_curso(sin_zona),
                         rp._dia_de_negocio_en_curso(monterrey))

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
        (_, _, _), parches = correr([evento(10000, AYER, 10)], {AYER: 12000})
        ev = parches[0][1]["evidence"]
        self.assertIsInstance(ev, dict, "jsonb debe recibir un objeto, no JSON serializado")
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
