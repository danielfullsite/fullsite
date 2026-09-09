#!/usr/bin/env python3
"""Pruebas de log_event — sin red.

POR QUÉ EXISTEN
`agent_events` tiene cuatro columnas NOT NULL **con default**: `confidence` (0.80),
`explanation` (''), `suggested_action` ('') y `evidence` ('{}'). `log_event` las mandaba
en `None` cuando el llamador las omitía — y un NULL explícito NO deja que el default
aplique: lo manda como NULL y PostgREST responde 23502.

Se descubrió el 2026-08-26 cuando el agente de cuadre encontró 25 descuadres reales en
boruca y NINGUNO se pudo guardar. Sólo se vio porque `log_event` acababa de aprender a
reportar el rechazo en vez de tragárselo.

Es el segundo bug latente que destapa el mismo arreglo. Por eso estas pruebas fijan
las dos mitades: que los campos omitidos NO viajen, y que `outcome` sí viaje en NULL
porque ahí el NULL significa algo ("todavía no calificado").
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

import agent_common as ac  # noqa: E402


def enviado(**kw) -> dict:
    """Devuelve el cuerpo que log_event le mandaría a PostgREST."""
    capturado = {}

    class RespOK:
        ok = True
        status_code = 201
        text = ""

    def post_falso(url, headers=None, json=None, timeout=None):
        capturado.update(json or {})
        return RespOK()

    base = {"agent_id": "cuadre", "event_type": "descuadre", "title": "T", "client_id": "demo"}
    base.update(kw)
    with mock.patch.dict(os.environ, {"CLIENT_ID": "demo"}, clear=False), \
         mock.patch.object(ac, "requests", mock.Mock(post=post_falso)), \
         mock.patch.object(ac, "SUPABASE_URL", "https://x.supabase.co"), \
         mock.patch.object(ac, "SUPABASE_KEY", "k"):
        ac.log_event(**base)
    return capturado


class LosDefaultsDeLaBaseSeRespetan(unittest.TestCase):
    def test_confidence_omitida_NO_viaja(self):
        # El bug exacto: viajaba en None y anulaba el default 0.80 → 23502.
        self.assertNotIn("confidence", enviado())

    def test_explanation_omitida_NO_viaja(self):
        self.assertNotIn("explanation", enviado())

    def test_suggested_action_omitida_NO_viaja(self):
        self.assertNotIn("suggested_action", enviado())

    def test_evidence_omitida_NO_viaja(self):
        self.assertNotIn("evidence", enviado())

    def test_ninguna_llave_viaja_en_None_salvo_outcome(self):
        cuerpo = enviado()
        nulas = [k for k, v in cuerpo.items() if v is None and k != "outcome"]
        self.assertEqual(nulas, [], f"estas anularían el default de su columna: {nulas}")


class OutcomeEsLaExcepcion(unittest.TestCase):
    def test_outcome_SI_viaja_en_None(self):
        # Es NULLABLE a propósito: su NULL significa "todavía no calificado". Quitarlo
        # dejaría el evento sin ese estado explícito.
        cuerpo = enviado()
        self.assertIn("outcome", cuerpo)
        self.assertIsNone(cuerpo["outcome"])


class LoQueSIseManda(unittest.TestCase):
    def test_los_campos_dados_llegan_completos(self):
        cuerpo = enviado(severity="warning", estimated_value=1234.5,
                         confidence=0.9, explanation="porque sí",
                         suggested_action="revisar", evidence={"a": 1})
        self.assertEqual(cuerpo["severity"], "warning")
        self.assertEqual(cuerpo["estimated_value"], 1234.5)
        self.assertEqual(cuerpo["confidence"], 0.9)
        self.assertEqual(cuerpo["explanation"], "porque sí")
        self.assertEqual(cuerpo["suggested_action"], "revisar")
        self.assertEqual(json.loads(cuerpo["evidence"]), {"a": 1})

    def test_el_status_nace_en_new_no_en_open(self):
        # 'open' no existe en el CHECK de la tabla; escribirlo rechazaba TODO.
        self.assertEqual(enviado()["status"], "new")

    def test_una_confidence_de_cero_SI_viaja(self):
        # 0.0 es falsy. Un filtro por verdad la borraría y la columna tomaría 0.80,
        # o sea el valor CONTRARIO al que el agente quiso decir.
        self.assertEqual(enviado(confidence=0.0)["confidence"], 0.0)

    def test_un_estimated_value_de_cero_SI_viaja(self):
        self.assertEqual(enviado(estimated_value=0.0)["estimated_value"], 0.0)


class SinClientIdNoSeEscribe(unittest.TestCase):
    def test_se_omite_en_vez_de_estampar_el_evento_en_otro_tenant(self):
        with mock.patch.dict(os.environ, {"CLIENT_ID": ""}, clear=False):
            with mock.patch.object(ac, "requests", mock.Mock()) as req:
                ac.log_event(agent_id="x", event_type="y", title="z", client_id=None)
                req.post.assert_not_called()


class SbGetNoPuedeTragarseElMotivo(unittest.TestCase):
    """`sb_get` es la puerta por la que 45 scripts leen Supabase. Lo que no diga aquí,
    no lo sabe nadie.

    Del 2026-09-02 al 09-08 el cuadre reportó siete veces
    `500 Server Error: Internal Server Error` y nada más. El cuerpo de esa respuesta
    decía `canceling statement due to statement timeout` — la diferencia entre un
    diagnóstico de un minuto y uno de una semana."""

    class Resp:
        def __init__(self, status, text="", payload=None):
            self.status_code, self.text, self._payload = status, text, payload or []
            self.ok = 200 <= status < 300

        def json(self):
            return self._payload

    def setUp(self):
        self._url, self._key = ac.SUPABASE_URL, ac.SUPABASE_KEY
        ac.SUPABASE_URL, ac.SUPABASE_KEY = "https://x.supabase.co", "k"
        # Los reintentos avisan por stderr, y en el log de CI esas lineas se leen
        # igual que una falla de produccion. Se capturan: aqui son material de
        # aserto, no ruido que haga dudar de una corrida sana.
        self.stderr = io.StringIO()
        self._silencio = contextlib.redirect_stderr(self.stderr)
        self._silencio.__enter__()

    def tearDown(self):
        self._silencio.__exit__(None, None, None)
        ac.SUPABASE_URL, ac.SUPABASE_KEY = self._url, self._key

    def test_el_cuerpo_del_error_viaja_en_la_excepcion(self):
        resp = self.Resp(500, "canceling statement due to statement timeout")
        with mock.patch.object(ac.requests, "get", return_value=resp), \
             mock.patch.object(ac.time, "sleep"):
            with self.assertRaises(ac.SupabaseError) as cm:
                ac.sb_get("ops_daily_history", "client_id=eq.amalay")
        self.assertIn("canceling statement due to statement timeout", str(cm.exception))
        self.assertIn("ops_daily_history", str(cm.exception))

    def test_un_500_se_reintenta_y_si_pasa_devuelve_los_datos(self):
        # Un timeout por contención no es un dato malo: es el mismo dato, más tarde.
        respuestas = [self.Resp(500, "timeout"), self.Resp(200, payload=[{"fecha": "2026-09-08"}])]
        with mock.patch.object(ac.requests, "get", side_effect=respuestas) as get, \
             mock.patch.object(ac.time, "sleep"):
            self.assertEqual(ac.sb_get("t", "p"), [{"fecha": "2026-09-08"}])
        self.assertEqual(get.call_count, 2)
        # Un reintento callado escondería que la base está sufriendo.
        self.assertIn("reintento 1/2", self.stderr.getvalue())

    def test_un_400_no_se_reintenta(self):
        # Una consulta mal escrita repetida tres veces sólo tarda tres veces más en fallar.
        with mock.patch.object(ac.requests, "get",
                               return_value=self.Resp(400, 'column "x" does not exist')) as get, \
             mock.patch.object(ac.time, "sleep"):
            with self.assertRaises(ac.SupabaseError):
                ac.sb_get("t", "p")
        self.assertEqual(get.call_count, 1)

    def test_se_agotan_los_reintentos_y_entonces_si_levanta(self):
        with mock.patch.object(ac.requests, "get", return_value=self.Resp(503, "no")) as get, \
             mock.patch.object(ac.time, "sleep"):
            with self.assertRaises(ac.SupabaseError):
                ac.sb_get("t", "p", reintentos=2)
        self.assertEqual(get.call_count, 3)

    def test_un_corte_de_conexion_tambien_se_reintenta(self):
        # En estas pruebas `requests` es un MagicMock, así que sus "excepciones" no son
        # excepciones de verdad. Se pone una real en su lugar para que el `except` de
        # sb_get sea el mismo que corre en producción.
        class CorteDeRed(Exception):
            pass

        with mock.patch.object(ac.requests.exceptions, "RequestException", CorteDeRed), \
             mock.patch.object(ac.requests, "get",
                               side_effect=[CorteDeRed("se acabó el tiempo"),
                                            self.Resp(200, payload=[1])]) as get, \
             mock.patch.object(ac.time, "sleep"):
            self.assertEqual(ac.sb_get("t", "p"), [1])
        self.assertEqual(get.call_count, 2)

    def test_nunca_devuelve_vacio_en_vez_de_fallar(self):
        # La regla que ya estaba y no se puede perder: [] significa "no hay filas",
        # nunca "no se pudo leer". Un agente no distingue las dos si se confunden.
        with mock.patch.object(ac.requests, "get", return_value=self.Resp(500, "x")), \
             mock.patch.object(ac.time, "sleep"):
            with self.assertRaises(ac.SupabaseError):
                ac.sb_get("t", "p")


if __name__ == "__main__":
    unittest.main(verbosity=2)
