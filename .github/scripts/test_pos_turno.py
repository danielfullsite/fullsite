#!/usr/bin/env python3
"""El simulador cuelga sus órdenes de un turno que EXISTE. Sin red.

LO QUE FIJAN ESTAS PRUEBAS
`api/pos/save-order` valida el turno contra `pos_turnos` antes de tocar nada. El
simulador lo inventaba —`lab-turno-<AAAAMMDD>`— y el POS rechazaba el 100% de las
órdenes con `TURN_NOT_FOUND` (HTTP 409). Corrida 34324277618 del 2026-09-09: 4
intentadas, 4 rechazadas, inventario del tenant `demo` en 0.

En orden:
  1. El día de venta se mide como lo mide el POS (corte 05:00, no 24 h de reloj). Ese
     fue el incidente del 2026-08-31 en AMALAY y no se va a repetir aquí.
  2. Un turno vigente se REUTILIZA: una corrida no abre un corte de más.
  3. Un turno de otro día se auto-cierra y se abre uno nuevo — un turno por día, como
     la propia historia del demo (`seed-demo-d1..d64`).
  4. Por el camino del POS nunca vuelve a salir un `lab-turno-*`.
  5. lab-resto, que escribe directo a la tabla, queda exactamente igual.
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

import pos_turno as pt  # noqa: E402
import lab_simulator as sim  # noqa: E402

MTY = "America/Monterrey"


@contextmanager
def silencio():
    with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
        yield


@contextmanager
def reloj(iso: str):
    """Congela `datetime.now()` dentro de pos_turno."""
    real = pt.datetime

    class Fijo(real):
        @classmethod
        def now(cls, tz=None):
            d = real.fromisoformat(iso)
            if d.tzinfo is None:
                d = d.replace(tzinfo=pt.timezone.utc)
            return d.astimezone(tz) if tz else d

    with mock.patch.object(pt, "datetime", Fijo):
        yield


def resolver(turnos, ahora, tz=MTY, inicio=None, operador="Ana García"):
    """Corre `turno_vigente` contra una base falsa. Devuelve (id, llamadas)."""
    llamadas = {"post": [], "patch": []}

    def get(tabla, params):
        if tabla == "clients":
            return [{"timezone": tz, "business_day_start_local": inicio}]
        if tabla == "pos_turnos":
            assert "closed_at=is.null" in params, "debe pedir SÓLO los turnos abiertos"
            assert "client_id=eq.demo" in params, "debe filtrar por tenant"
            return list(turnos)
        return []

    def post(tabla, data, upsert=False):
        llamadas["post"].append((tabla, data, upsert))
        return {}

    def patch(tabla, params, data):
        llamadas["patch"].append((tabla, params, data))

    with mock.patch.object(pt, "sb_get", get), mock.patch.object(pt, "sb_post", post), \
            mock.patch.object(pt, "sb_patch", patch), reloj(ahora), silencio():
        return pt.turno_vigente("demo", operador), llamadas


class ElDiaDeVentaNoEsElDelCalendario(unittest.TestCase):
    def test_un_turno_de_las_19_sigue_vigente_a_la_1_30_del_dia_siguiente(self):
        # Mismo caso que fija turno-verdad-unica.test.ts del lado del POS.
        self.assertTrue(pt.mismo_dia_de_venta(
            "2026-09-01T19:00:00-06:00", "2026-09-02T01:30:00-06:00", MTY, "05:00:00"))

    def test_un_turno_de_ayer_a_las_10_no_es_del_dia_de_hoy(self):
        self.assertFalse(pt.mismo_dia_de_venta(
            "2026-09-01T10:00:00-06:00", "2026-09-02T10:00:00-06:00", MTY, "05:00:00"))

    def test_el_corte_cae_exactamente_en_la_hora_de_inicio(self):
        d = lambda iso: pt.dia_de_venta(iso, MTY, "05:00:00")
        self.assertEqual(d("2026-09-02T04:59:00-06:00"), "2026-09-01")
        self.assertEqual(d("2026-09-02T05:00:00-06:00"), "2026-09-02")

    def test_se_mide_en_la_zona_del_restaurante_no_en_UTC(self):
        # 2026-09-10T03:00Z son las 21:00 del 09 en Monterrey: día de venta del 09.
        # Medido en UTC daría el 10, y cerraría un turno que sigue operando.
        self.assertEqual(pt.dia_de_venta("2026-09-10T03:00:00+00:00", MTY, "05:00:00"),
                         "2026-09-09")

    def test_sin_business_day_start_local_cae_al_default_de_las_5(self):
        # `demo` trae la columna en null.
        self.assertEqual(pt.hora_inicio_dia(None), 5.0)
        self.assertEqual(pt.hora_inicio_dia("05:00:00"), 5.0)
        self.assertEqual(pt.hora_inicio_dia("06:30"), 6.5)
        self.assertEqual(pt.hora_inicio_dia("basura"), 5.0)


class ParseaLoQuePostgRESTDevuelve(unittest.TestCase):
    def test_acepta_los_formatos_que_llegan_de_la_base(self):
        esperado = "2026-08-12T21:22:42.021907+00:00"
        for crudo in ("2026-08-12T21:22:42.021907+00:00",
                      "2026-08-12T21:22:42.021907+00",
                      "2026-08-12 21:22:42.021907+00",
                      "2026-08-12T21:22:42.021907Z"):
            self.assertEqual(pt.parsear_instante(crudo).isoformat(), esperado, crudo)

    def test_un_timestamp_sin_zona_se_asume_UTC(self):
        self.assertEqual(pt.parsear_instante("2026-08-12T21:22:42").tzinfo,
                         pt.timezone.utc)


class ReutilizaElTurnoVigente(unittest.TestCase):
    def test_usa_el_turno_abierto_de_hoy_y_no_abre_otro(self):
        tid, ll = resolver(
            [{"id": "turno-de-hoy", "opened_at": "2026-09-09T14:00:00+00:00"}],
            ahora="2026-09-09T20:00:00+00:00")
        self.assertEqual(tid, "turno-de-hoy")
        self.assertEqual(ll["post"], [], "no debe abrir un corte de más")
        self.assertEqual(ll["patch"], [], "no debe cerrar el turno en curso")

    def test_de_madrugada_sigue_siendo_el_turno_de_anoche(self):
        # 07:30 UTC = 01:30 en Monterrey: el restaurante sigue en el día de ayer.
        tid, ll = resolver(
            [{"id": "turno-de-anoche", "opened_at": "2026-09-10T01:00:00+00:00"}],
            ahora="2026-09-10T07:30:00+00:00")
        self.assertEqual(tid, "turno-de-anoche")
        self.assertEqual(ll["patch"], [], "cerrarlo aquí partiría el servicio en dos")

    def test_con_varios_abiertos_toma_el_mas_reciente_de_hoy(self):
        tid, _ = resolver([
            {"id": "el-nuevo", "opened_at": "2026-09-09T18:00:00+00:00"},
            {"id": "el-viejo", "opened_at": "2026-09-09T14:00:00+00:00"},
        ], ahora="2026-09-09T20:00:00+00:00")
        self.assertEqual(tid, "el-nuevo")


class CierraElDeAyerYAbreElDeHoy(unittest.TestCase):
    def setUp(self):
        # El caso real: el turno que `demo` trae pegado desde el 2026-08-12.
        self.tid, self.ll = resolver(
            [{"id": "msqlianea7sp", "opened_at": "2026-08-12T21:22:42.021907+00"}],
            ahora="2026-09-09T20:00:00+00:00")

    def test_cierra_el_turno_viejo(self):
        self.assertEqual(len(self.ll["patch"]), 1)
        tabla, params, data = self.ll["patch"][0]
        self.assertEqual(tabla, "pos_turnos")
        self.assertIn("msqlianea7sp", params)
        self.assertTrue(data["closed_at"], "sin closed_at el turno sigue abierto")
        self.assertEqual(data["closed_by"], "Ana García")

    def test_la_nota_es_la_misma_que_escribe_el_POS(self):
        # autoCloseStaleTurno, pos-data.ts. Un cierre del simulador debe leerse igual
        # que uno del POS: es la misma operación.
        self.assertEqual(self.ll["patch"][0][2]["notas"],
                         "Auto-cerrado (turno del dia anterior)")

    def test_abre_uno_nuevo_y_lo_devuelve(self):
        self.assertEqual(len(self.ll["post"]), 1)
        tabla, data, upsert = self.ll["post"][0]
        self.assertEqual(tabla, "pos_turnos")
        self.assertEqual(data["client_id"], "demo")
        self.assertEqual(data["opened_by"], "Ana García")
        self.assertEqual(data["id"], self.tid)
        self.assertNotEqual(self.tid, "msqlianea7sp", "devolvió el turno que acaba de cerrar")
        self.assertTrue(upsert, "el POS abre con merge-duplicates para no multiplicar turnos")

    def test_el_fondo_inicial_es_el_de_la_historia_del_demo(self):
        self.assertEqual(self.ll["post"][0][1]["fondo_inicial"], 500.0)


class SinNingunTurnoAbierto(unittest.TestCase):
    def test_abre_uno_sin_cerrar_nada(self):
        tid, ll = resolver([], ahora="2026-09-09T20:00:00+00:00")
        self.assertEqual(ll["patch"], [])
        self.assertEqual(len(ll["post"]), 1)
        self.assertEqual(ll["post"][0][1]["id"], tid)


class ElIdSeParaceAlDeUnaTerminal(unittest.TestCase):
    def test_tiene_la_forma_que_genera_el_POS(self):
        # idParaAbrirTurno: base36 del epoch en ms + 4 al azar. Los turnos reales del
        # demo se ven así (`msqlianea7sp`); uno del simulador no debe delatarse.
        ids = {pt.nuevo_id_de_turno() for _ in range(50)}
        self.assertEqual(len(ids), 50, "se repitieron ids")
        for i in ids:
            self.assertEqual(len(i), 12, i)
            self.assertTrue(all(c in pt.ALFABETO36 for c in i), i)

    def test_nunca_devuelve_un_turno_inventado(self):
        tid, _ = resolver([], ahora="2026-09-09T20:00:00+00:00")
        self.assertFalse(tid.startswith("lab-turno-"),
                         "ese id es justo el que save-order rechaza con TURN_NOT_FOUND")


class ElSimuladorMandaElTurnoResuelto(unittest.TestCase):
    """La regresión concreta: qué `turno_id` sale en el cuerpo de save-order."""

    def correr(self, factor, turno="turno-real-de-hoy"):
        cuerpos, resueltos = [], []

        def guardar(token, cuerpo):
            cuerpos.append(cuerpo)
            return {"revision": len(cuerpos)}

        def turno_vigente(client_id, operador, *a, **k):
            resueltos.append((client_id, operador))
            return turno

        with mock.patch.object(sim.pos_client, "guardar", guardar), \
                mock.patch.object(sim.pos_turno, "turno_vigente", turno_vigente), \
                mock.patch.object(sim, "menu_del_tenant",
                                  lambda: [("mi-cafe", "Café", 45, "cocina")]), \
                mock.patch.object(sim, "next_order_number", lambda: 1), silencio():
            res = sim.ciclo_por_el_pos("token-falso", factor, "Ana García")
        return res, cuerpos, resueltos

    def test_todas_las_ordenes_llevan_el_turno_resuelto(self):
        (creadas, _, cobradas, _), cuerpos, _ = self.correr(1.0)
        self.assertGreater(creadas, 0, "no se creó ninguna orden")
        self.assertEqual(creadas, cobradas, "una orden creada debe quedar cobrada")
        self.assertTrue(cuerpos)
        for c in cuerpos:
            self.assertEqual(c["turno_id"], "turno-real-de-hoy")

    def test_ninguna_orden_lleva_el_turno_inventado(self):
        _, cuerpos, _ = self.correr(1.0)
        for c in cuerpos:
            self.assertFalse(str(c["turno_id"]).startswith("lab-turno-"),
                             "volvió el id que produce el 409 TURN_NOT_FOUND")

    def test_el_turno_se_resuelve_UNA_vez_por_corrida(self):
        # Una terminal abre el turno al arrancar, no una vez por comanda.
        _, _, resueltos = self.correr(1.0)
        self.assertEqual(len(resueltos), 1)
        # El tenant es el que se esté simulando (CLIENT_ID), no uno fijo: el mismo
        # script corre para `demo` y para lab-resto.
        self.assertEqual(resueltos[0], (sim.CLIENT_ID, "Ana García"))

    def test_a_puerta_cerrada_no_abre_turno(self):
        # factor 0.0 = franja cerrada de la curva. Abrir un corte a las 3 de la mañana
        # le inventaría al demo un turno que ningún restaurante habría abierto.
        res, cuerpos, resueltos = self.correr(0.0)
        # El 4º valor son los estados de inventario de las órdenes cobradas: ninguna.
        self.assertEqual(res, (0, 0, 0, []))
        self.assertEqual(cuerpos, [])
        self.assertEqual(resueltos, [], "resolvió turno con el restaurante cerrado")


class ElLabNoCambia(unittest.TestCase):
    def test_la_escritura_directa_conserva_su_turno_sintetico(self):
        # lab-resto no tiene una sola fila en pos_turnos y escribe directo a la tabla,
        # donde el único requisito es que el campo no sea nulo (orders_require_turno).
        t = sim.turno_sintetico_del_lab()
        self.assertRegex(t, r"^lab-turno-\d{8}$")

    def test_make_order_pone_el_turno_que_se_le_da(self):
        # La carta es (menu_item_id, nombre, precio, estación): el id entró para que el
        # reconciliador de inventario pueda encontrar la receta.
        with silencio(), mock.patch.object(sim, "menu_del_tenant",
                                           lambda: [("mi-1", "Café", 45, "cocina")]), \
                mock.patch.object(sim, "next_order_number", lambda: 1):
            self.assertEqual(sim.make_order(0, "el-que-sea")["turno_id"], "el-que-sea")


if __name__ == "__main__":
    unittest.main(verbosity=2)
