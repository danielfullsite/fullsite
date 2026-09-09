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

import contextlib
import io
import json
import os
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
            "metodo_pago": "Efectivo", "created_at": "2026-08-25T20:00:00Z",
            "dia_venta": "2026-08-25"}
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



class ElCaminoDelDescuento(unittest.TestCase):
    """El descuento nunca se ha ejercitado con datos reales.

    Se midieron 0 violaciones en 3,043 órdenes de 30 días — pero en TODA la base hay
    CERO órdenes con descuento. O sea que la rama que más aritmética tiene es la única
    que ningún dato ha tocado.

    Y es justo donde otra sesión encontró un bug hoy (#136): el detector de skimming
    comparaba la suma de items SIN IVA contra el total CON IVA, y disparaba en cada
    ticket de los 5 tenants con iva_rate > 0. Misma familia de error: mezclar unidades
    a los dos lados de una resta.

    Estas pruebas usan la fórmula EXACTA del POS (pos/page.tsx:2896-2898), redondeos
    incluidos, para que el invariante se pruebe contra lo que el sistema realmente
    escribe y no contra lo que yo creo que escribe:

        subtotalTrasDescuento = redondear(subtotal − descuento)
        iva                   = redondear(subtotalTrasDescuento × tasa)
        total                 = redondear(subtotalTrasDescuento + iva)
    """

    @staticmethod
    def como_el_pos(subtotal: float, descuento: float, tasa: float) -> dict:
        r = lambda x: round(x * 100) / 100
        tras = r(max(0.0, subtotal - descuento))
        iva = r(tras * tasa)
        total = r(tras + iva)
        return {"subtotal": subtotal, "descuento": descuento, "iva": iva, "total": total,
                "items": [{"nombre": "X", "subtotal": subtotal}],
                "pagos": [{"metodo": "Efectivo", "monto": total}]}

    def test_con_IVA_16_y_descuento_cuadra(self):
        o = orden(**self.como_el_pos(1888.00, 150.00, 0.16))
        self.assertEqual(codigos(o), [])

    def test_con_IVA_cero_tambien(self):
        # coffee-shop y boruca tienen iva_rate = 0. El invariante no puede asumir 16%.
        o = orden(**self.como_el_pos(430.00, 30.00, 0.0))
        self.assertEqual(codigos(o), [])

    def test_los_redondeos_no_acumulan_mas_de_un_centavo(self):
        # Tres redondeos en el camino. Se barre un rango amplio de importes y descuentos
        # con la fórmula real: si algún caso se saliera del centavo, la tolerancia
        # estaría mal calibrada y el reporte se llenaría de falsos positivos.
        for tasa in (0.16, 0.08, 0.0):
            for sub in (33.33, 99.99, 1888.00, 12345.67, 7.77):
                for desc in (0.0, 0.01, 3.33, sub / 3):
                    o = orden(**self.como_el_pos(sub, round(desc, 2), tasa))
                    self.assertEqual(
                        codigos(o), [],
                        f"falso positivo con subtotal={sub} descuento={desc} tasa={tasa}")

    def test_un_descuento_mayor_que_el_subtotal_no_genera_negativos(self):
        # El POS lo topa (pos/page.tsx:2881), pero un dato viejo podría traerlo.
        o = orden(**self.como_el_pos(100.0, 500.0, 0.16))
        self.assertIsInstance(cuadre.revisar_orden(o), list)

    def test_y_SI_alguien_baja_el_total_dejando_lo_demas_se_detecta(self):
        # El vector que el detector de skimming vigila en save-order. Aquí debe caer
        # también, por la otra ruta: la aritmética de los campos guardados.
        o = orden(**self.como_el_pos(1888.00, 0.0, 0.16))
        o["total"] = 1500.00
        self.assertIn("aritmetica_del_total", codigos(o))

class ElNivel4CruzaPorDiaDeVenta(unittest.TestCase):
    """El Nivel 4 sumaba las órdenes por `created_at[:10]` —día de calendario en UTC— y
    las comparaba contra una vista que cortaba el día en otra parte. Eran peras contra
    manzanas, tapadas con un 1% de tolerancia.

    Desde el #360 la vista agrupa por `pos_orders.dia_venta` (zona del tenant + corte de
    las 05:00). Si el comparador se hubiera quedado en UTC, el desfase pasaba de 6 a 11
    horas — y como el #363 devolvió este nivel a la vida, cada diferencia se escribe como
    un evento `descuadre`. O sea: el chequeo se habría vuelto la fuente del ruido."""

    @staticmethod
    def _sb(ordenes, diario, cliente=None):
        def fake(table, params, *a, **kw):
            if table == "pos_orders":
                return ordenes
            if table == "ops_daily_history":
                return diario
            if table == "clients":
                return cliente if cliente is not None else [
                    {"id": "t1", "timezone": "America/Monterrey",
                     "business_day_start_local": "05:00:00"}]
            return []
        return fake

    def _correr(self, ordenes, diario, en_curso="2026-09-30", cliente=None):
        with mock.patch.object(cuadre, "sb_get", self._sb(ordenes, diario, cliente)), \
             mock.patch.object(cuadre, "business_date_con_defaults_de_la_base",
                               return_value=en_curso):
            return cuadre.revisar_tenant("t1", 7)

    def test_la_madrugada_no_descuadra_los_dos_dias_que_toca(self):
        """La regresión concreta, con la forma que tiene en producción.

        Un restaurante que vende la noche del 01 y hasta las 02:00 del 02 tiene UN día de
        venta: el 01. El comparador viejo partía esas órdenes en dos días de calendario
        UTC y ninguno cuadraba contra la vista — así se llegó a 28 de 31 días marcados en
        `lab-resto`.

        Ojo con la forma de la falla: cuando las llaves no coinciden, el nivel 4 se SALTA
        el día en silencio. Por eso aquí los dos días existen en la vista, para que el
        error salga como lo que es —una acusación falsa— y no como un hueco."""
        ordenes = [
            # Día de venta 01: la noche del 01 y la madrugada del 02.
            orden(id="a", total=900.0, dia_venta="2026-09-01",
                  created_at="2026-09-02T02:00:00Z"),   # 20:00 del 01 en Monterrey
            orden(id="b", total=500.0, dia_venta="2026-09-01",
                  created_at="2026-09-02T07:30:00Z"),   # 01:30 del 02 en Monterrey
            # Día de venta 02: su propia tarde.
            orden(id="c", total=700.0, dia_venta="2026-09-02",
                  created_at="2026-09-03T01:00:00Z"),   # 19:00 del 02 en Monterrey
        ]
        diario = [
            {"fecha": "2026-09-01", "ventas_dia": 1400.0, "tickets_count": 2},
            {"fecha": "2026-09-02", "ventas_dia": 700.0, "tickets_count": 1},
        ]
        r = self._correr(ordenes, diario)
        self.assertEqual(r["nivel4"], "ok")
        self.assertEqual(r["dias_descuadrados"], [], "acusó a un restaurante que cuadra")

        # Y que el día SÍ se comparó, no que se saltó en silencio: si la vista miente en
        # uno de los dos, tiene que salir.
        diario_mentiroso = [
            {"fecha": "2026-09-01", "ventas_dia": 900.0, "tickets_count": 2},
            {"fecha": "2026-09-02", "ventas_dia": 700.0, "tickets_count": 1},
        ]
        r2 = self._correr(ordenes, diario_mentiroso)
        self.assertEqual([f for f, _, _ in r2["dias_descuadrados"]], ["2026-09-01"])

    def test_un_descuadre_real_de_un_peso_si_se_marca(self):
        """Con la misma columna en las dos partes, el 1% ya no hace falta. Un peso de
        diferencia sobre un día de $1,400 es 0.07% — el 1% viejo lo dejaba pasar."""
        ordenes = [orden(id="a", total=1400.0, dia_venta="2026-09-01")]
        diario = [{"fecha": "2026-09-01", "ventas_dia": 1401.0, "tickets_count": 1}]
        r = self._correr(ordenes, diario)
        self.assertEqual(len(r["dias_descuadrados"]), 1)
        fecha, vista, crudo = r["dias_descuadrados"][0]
        self.assertEqual((fecha, vista, crudo), ("2026-09-01", 1401.0, 1400.0))

    def test_un_centavo_de_redondeo_no_es_un_descuadre(self):
        ordenes = [orden(id="a", total=1400.0, dia_venta="2026-09-01")]
        diario = [{"fecha": "2026-09-01", "ventas_dia": 1400.01, "tickets_count": 1}]
        self.assertEqual(self._correr(ordenes, diario)["dias_descuadrados"], [])

    def test_el_dia_de_negocio_en_curso_no_se_juzga(self):
        """A la 1am —cuando corre este workflow— el día que empezó a las 05:00 de ayer
        sigue acumulando. Compararlo es una carrera contra las órdenes que entran."""
        ordenes = [orden(id="a", total=500.0, dia_venta="2026-09-09")]
        diario = [{"fecha": "2026-09-09", "ventas_dia": 999999.0, "tickets_count": 1}]
        r = self._correr(ordenes, diario, en_curso="2026-09-09")
        self.assertEqual(r["dias_descuadrados"], [], "juzgó un día todavía abierto")

    def test_cancelada_y_dividida_se_excluyen_igual_que_en_la_vista(self):
        """Si el comparador excluyera algo distinto que la vista, el descuadre lo
        produciría él mismo."""
        ordenes = [
            orden(id="a", total=1400.0, dia_venta="2026-09-01"),
            orden(id="b", total=999.0, dia_venta="2026-09-01", status="cancelada"),
            orden(id="c", total=777.0, dia_venta="2026-09-01", status="dividida"),
        ]
        diario = [{"fecha": "2026-09-01", "ventas_dia": 1400.0, "tickets_count": 1}]
        self.assertEqual(self._correr(ordenes, diario)["dias_descuadrados"], [])

    def test_una_orden_sin_dia_de_venta_no_se_juzga_y_se_dice(self):
        """Dejaría la suma corta. Callarlo acusaría de descuadre a un restaurante sano;
        hoy son 0 en producción, pero el silencio es justo lo que este archivo prohíbe."""
        ordenes = [
            orden(id="a", total=1400.0, dia_venta="2026-09-01"),
            orden(id="b", total=300.0, dia_venta=None),
        ]
        diario = [{"fecha": "2026-09-01", "ventas_dia": 1400.0, "tickets_count": 1}]
        r = self._correr(ordenes, diario)
        self.assertEqual(r["dias_descuadrados"], [])
        self.assertTrue(any("sin `dia_venta`" in m for m in r["motivos"]),
                        f"no reportó las órdenes sin día de venta: {r['motivos']}")


class UnaLecturaCaidaNoPuedeVerseComoQueCuadro(unittest.TestCase):
    """Del 2026-09-02 al 09-08 el cuadre reportó `success` siete días seguidos con el
    Nivel 4 sin correr: un 500 de PostgREST en el primer restaurante abortaba el bucle
    entero, y `cuadre.py | tee` se comía el código de salida.

    Es exactamente lo que prohíbe la regla 10 de docs/ai/ARQUITECTURA-CRUCE.md. Estas
    pruebas son la cerca: silencio y éxito no pueden verse igual."""

    def setUp(self):
        self._env = dict(os.environ)
        os.environ["CLIENT_ID"] = "ALL"
        os.environ["DIAS"] = "7"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    @staticmethod
    def _lecturas(**por_tabla):
        """Falsea sb_get: por_tabla['pos_orders'] puede ser una lista o una excepción."""
        def fake(table, params, *a, **kw):
            v = por_tabla.get(table, [])
            if isinstance(v, Exception):
                raise v
            return v
        return fake

    def _correr(self, sb, log_event=None):
        salida = io.StringIO()
        with mock.patch.object(cuadre, "sb_get", sb), \
             mock.patch.object(cuadre, "log_run") as log_run, \
             mock.patch.object(cuadre, "log_event", log_event or mock.Mock(return_value=True)), \
             contextlib.redirect_stdout(salida), contextlib.redirect_stderr(io.StringIO()):
            codigo = cuadre.main()
        return codigo, salida.getvalue(), log_run

    def test_si_el_contrato_no_se_puede_leer_la_corrida_sale_en_rojo(self):
        sb = self._lecturas(
            clients=[{"id": "amalay"}],
            pos_orders=[orden()],
            ops_daily_history=cuadre.SupabaseError("ops_daily_history: HTTP 500 — timeout"),
        )
        codigo, texto, _ = self._correr(sb)
        self.assertEqual(codigo, 1, "una lectura caída tiene que devolver != 0")
        self.assertIn("NO SE PUDO COMPROBAR", texto)
        self.assertNotIn("CUADRA", texto)

    def test_el_motivo_del_servidor_llega_al_log(self):
        # El cuerpo del 500 decía `canceling statement due to statement timeout` y se
        # tiraba. Sin él hubo que ir a los logs de Postgres para saber qué pasaba.
        sb = self._lecturas(
            clients=[{"id": "amalay"}],
            pos_orders=[orden()],
            ops_daily_history=cuadre.SupabaseError(
                "ops_daily_history: HTTP 500 — canceling statement due to statement timeout"),
        )
        _, texto, _ = self._correr(sb)
        self.assertIn("canceling statement due to statement timeout", texto)

    def test_un_restaurante_caido_no_deja_ciegos_a_los_demas(self):
        # amalay va primero en orden alfabético; su timeout abortaba el bucle entero.
        llamadas = []

        def sb(table, params, *a, **kw):
            llamadas.append((table, params))
            if table == "clients":
                return [{"id": "amalay"}, {"id": "boruca"}, {"id": "zzz"}]
            if table == "ops_daily_history" and "amalay" in params:
                raise cuadre.SupabaseError("ops_daily_history: HTTP 500 — timeout")
            if table == "pos_orders":
                return [orden()]
            return []

        codigo, texto, _ = self._correr(sb)
        self.assertEqual(codigo, 1)
        # Los otros dos SÍ se comprobaron: su Nivel 4 se leyó.
        leidos = {p.split("client_id=eq.")[1].split("&")[0]
                  for t, p in llamadas if t == "ops_daily_history"}
        self.assertEqual(leidos, {"amalay", "boruca", "zzz"})
        self.assertIn("boruca", texto)
        self.assertIn("zzz", texto)

    def test_un_descuadre_real_sigue_saliendo_en_verde(self):
        # La otra mitad de la regla: si un descuadre pusiera la corrida en rojo, el día
        # que el verificador se rompa de verdad se vería igual y no se distinguiría.
        mala = orden(total=1500.00)
        sb = self._lecturas(clients=[{"id": "amalay"}], pos_orders=[mala],
                            ops_daily_history=[])
        codigo, texto, _ = self._correr(sb)
        self.assertEqual(codigo, 0, "un descuadre es un hallazgo, no un fallo")
        self.assertIn("DESCUADRE", texto)

    def test_un_hallazgo_que_no_se_pudo_guardar_pone_la_corrida_en_rojo(self):
        # 2026-08-26: 25 descuadres reales en boruca, agent_events los rechazó todos,
        # y la corrida salió verde. Un hallazgo perdido es un hallazgo que no existió.
        sb = self._lecturas(clients=[{"id": "amalay"}], pos_orders=[orden(total=1500.00)],
                            ops_daily_history=[])
        codigo, _, _ = self._correr(sb, log_event=mock.Mock(return_value=False))
        self.assertEqual(codigo, 1)

    def test_si_la_lectura_topa_en_el_limite_no_se_juzga_el_dia(self):
        # Con la lectura recortada la suma de órdenes queda corta y el Nivel 4 acusaría
        # de descuadre a un restaurante que está bien. No medir es mejor que mentir.
        muchas = [orden(id=f"o{i}") for i in range(cuadre.LIMITE_ORDENES)]
        sb = self._lecturas(clients=[{"id": "grande"}], pos_orders=muchas,
                            ops_daily_history=[{"fecha": "2026-08-25", "ventas_dia": 1.0,
                                                "tickets_count": 1}])
        codigo, texto, _ = self._correr(sb)
        self.assertEqual(codigo, 1)
        self.assertIn("NO SE PUDO COMPROBAR", texto)
        self.assertNotIn("dia_vs_ordenes", texto)

    def test_todo_bien_sigue_saliendo_en_verde_y_se_registra_como_success(self):
        sb = self._lecturas(clients=[{"id": "amalay"}], pos_orders=[orden()],
                            ops_daily_history=[])
        codigo, texto, log_run = self._correr(sb)
        self.assertEqual(codigo, 0)
        self.assertIn("CUADRA", texto)
        self.assertEqual(log_run.call_args[0][1], "success")

    def test_si_no_se_puede_ni_listar_los_restaurantes_es_rojo(self):
        sb = self._lecturas(clients=cuadre.SupabaseError("clients: HTTP 500 — timeout"))
        codigo, _, log_run = self._correr(sb)
        self.assertEqual(codigo, 1)
        self.assertEqual(log_run.call_args[0][1], "error")


if __name__ == "__main__":
    unittest.main(verbosity=2)
