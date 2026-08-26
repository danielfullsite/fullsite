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


if __name__ == "__main__":
    unittest.main(verbosity=2)
