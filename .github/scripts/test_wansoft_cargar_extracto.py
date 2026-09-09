#!/usr/bin/env python3
"""Pruebas del cargador de extractos de Wansoft — sin red.

Un backfill escribe sobre el histórico de un restaurante que opera de verdad. Si mete un
día a medias, o aterriza en la tabla equivocada, o falla callado, el daño no se ve hasta
que un agente razona sobre esos números.

Las que más importan:
  · que el día en curso NO se cargue (entra como una caída de ventas del 90%)
  · que se escriban las DOS tablas — `ops_daily` es la que lee el contrato
  · que un error de escritura devuelva != 0 en vez de dejar el hueco abierto en verde
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import wansoft_cargar_extracto as wb  # noqa: E402


def dia(fecha: str, ventas: float = 1000.0) -> dict:
    return {"fecha": fecha, "ventas_dia": ventas, "ventas_brutas": ventas + 50,
            "descuentos": 50, "devoluciones": 0, "efectivo": 400, "tarjeta": 600,
            "tickets_count": 10, "mesas_atendidas": 8, "ordenes_llevar": 2,
            "personas_restaurant": 20, "cuentas_restaurant": 8,
            "ticket_promedio_restaurant": 125.0, "propinas_total": 90,
            "chilaquiles_total": 300, "half_half_total": 100,
            "meseros": [{"nombre": "X", "total": 1000}], "platillos_top": [],
            "ventas_por_grupo": [], "pago_metodos": [], "propinas_meseros": []}


class ElCargador(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        wb.SUPABASE_URL, wb.SUPABASE_KEY = "https://x.supabase.co", "k"
        os.environ["DRY_RUN"] = "false"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def _correr(self, dias, upsert=None):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                         encoding="utf-8") as fh:
            json.dump(dias, fh)
            os.environ["ARCHIVO"] = fh.name
        salida = io.StringIO()
        up = upsert or mock.Mock()
        with mock.patch.object(wb, "upsert", up), mock.patch.object(wb, "log_run"), \
             contextlib.redirect_stdout(salida), contextlib.redirect_stderr(io.StringIO()):
            codigo = wb.main()
        os.unlink(os.environ["ARCHIVO"])
        return codigo, salida.getvalue(), up

    def test_el_dia_en_curso_no_se_carga(self):
        # Un día a medias entra como un desplome de ventas y envenena la línea base de
        # todos los detectores. El 2026-09-09 a mediodía iban $4,261 contra ~$60k del día.
        hoy = date.today().isoformat()
        ayer = (date.today() - timedelta(days=1)).isoformat()
        codigo, texto, up = self._correr([dia(ayer), dia(hoy)])
        self.assertEqual(codigo, 0)
        self.assertIn("se saltan 1", texto)
        filas = up.call_args_list[0][0][1]
        self.assertEqual([f["fecha"] for f in filas], [ayer])

    def test_escribe_las_dos_tablas_con_su_propia_llave(self):
        # `ops_daily_history` —el contrato— une `ops_daily`, NO `wansoft_daily`.
        # Cargar sólo la primera dejaría a los agentes igual de ciegos.
        ayer = (date.today() - timedelta(days=1)).isoformat()
        _, _, up = self._correr([dia(ayer)])
        tablas = {c[0][0]: c[0][2] for c in up.call_args_list}
        self.assertEqual(tablas, {"wansoft_daily": "client_slug,fecha,report_type",
                                  "ops_daily": "client_id,fecha,record_type"})

    def test_las_filas_llevan_tenant_y_tipo(self):
        ayer = (date.today() - timedelta(days=1)).isoformat()
        _, _, up = self._correr([dia(ayer)])
        w = up.call_args_list[0][0][1][0]
        o = up.call_args_list[1][0][1][0]
        self.assertEqual((w["client_slug"], w["report_type"], w["location_id"]),
                         ("amalay", "cierre", "amalay-spgg"))
        self.assertEqual((o["client_id"], o["record_type"], o["source_system"]),
                         ("amalay", "cierre_wansoft", "wansoft"))

    def test_una_escritura_fallida_devuelve_distinto_de_cero(self):
        ayer = (date.today() - timedelta(days=1)).isoformat()
        malo = mock.Mock(side_effect=RuntimeError("ops_daily: HTTP 400 — columna X"))
        codigo, _, _ = self._correr([dia(ayer)], upsert=malo)
        self.assertEqual(codigo, 1)

    def test_si_todo_el_extracto_es_de_hoy_no_se_carga_nada_y_es_error(self):
        # Cargar cero filas y reportar éxito diría "el hueco está cerrado" sin estarlo.
        codigo, _, up = self._correr([dia(date.today().isoformat())])
        self.assertEqual(codigo, 1)
        up.assert_not_called()

    def test_dry_run_no_escribe(self):
        os.environ["DRY_RUN"] = "true"
        ayer = (date.today() - timedelta(days=1)).isoformat()
        codigo, texto, up = self._correr([dia(ayer)])
        self.assertEqual(codigo, 0)
        up.assert_not_called()
        self.assertIn("DRY_RUN", texto)

    def test_un_campo_de_mas_en_el_extracto_no_revienta_el_insert(self):
        # El extracto trae `propinas_meseros`, que no es columna de ninguna de las dos
        # tablas. Se ignora en vez de tumbar la carga con "column does not exist".
        ayer = (date.today() - timedelta(days=1)).isoformat()
        d = dia(ayer); d["campo_inventado"] = 1
        _, _, up = self._correr([d])
        for c in up.call_args_list:
            self.assertNotIn("campo_inventado", c[0][1][0])
            self.assertNotIn("propinas_meseros", c[0][1][0])


class ElExtractoReal(unittest.TestCase):
    """El archivo que se va a cargar, revisado como dato y no como promesa."""

    ARCHIVO = Path(__file__).resolve().parents[2] / \
        "data/backfill/amalay-wansoft-2026-07-11_2026-09-09.json"

    def setUp(self):
        if not self.ARCHIVO.exists():
            self.skipTest("extracto no presente")
        self.datos = json.loads(self.ARCHIVO.read_text(encoding="utf-8"))

    def test_cubre_el_hueco_completo_sin_saltarse_dias(self):
        # ops_daily se quedó en 2026-07-10 y wansoft_daily en 2026-07-20: el extracto
        # tiene que empezar antes de la más vieja de las dos.
        fechas = [date.fromisoformat(d["fecha"]) for d in self.datos]
        self.assertEqual(fechas[0], date(2026, 7, 11))
        self.assertEqual(len(fechas), len(set(fechas)), "hay fechas repetidas")
        self.assertEqual((fechas[-1] - fechas[0]).days + 1, len(fechas), "faltan días")

    def test_ningun_dia_trae_el_centinela_de_fecha_mal_parseada(self):
        # $640,602.40 es lo que Wansoft devuelve cuando el "mes" queda entre 13 y 31 —
        # o sea cuando alguien mandó MM/DD/YYYY. Si aparece, el extracto está corrupto.
        for d in self.datos:
            self.assertNotEqual(round(float(d["ventas_dia"]), 2), 640602.40,
                                f"{d['fecha']} trae el centinela de fecha mal parseada")

    def test_los_totales_son_coherentes(self):
        for d in self.datos:
            if float(d["ventas_dia"]) <= 0:
                continue
            self.assertGreaterEqual(float(d["ventas_brutas"]), float(d["ventas_dia"]),
                                    f"{d['fecha']}: brutas < netas")
            self.assertGreater(int(d["tickets_count"]), 0, f"{d['fecha']}: 0 tickets con venta")


if __name__ == "__main__":
    unittest.main(verbosity=2)
