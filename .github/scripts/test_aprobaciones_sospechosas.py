#!/usr/bin/env python3
"""Pruebas del detector de aprobaciones sospechosas — sin red.

POR QUE EXISTE

El servidor YA sabia cuando una aprobacion era sospechosa y lo guardaba.
`manager-approval.ts:apruebaSospechosa()` devuelve True cuando el modo fue
`offline_device_trust` y el rol de quien pedia --que sale del shift token FIRMADO, no
del cuerpo de la peticion-- esta por debajo de gerente. Eso se escribe en
`pos_audit_log.details.revisar`, tanto en `cancel-item` como en `reopen-order`.

Y NADIE LO LEIA. Comprobado el 2026-09-09: este agente solo consultaba
`action = 'skimming_suspect'`. La marca se calculaba, se guardaba, y moria en una
bitacora que nadie abre. Un control que marca y no avisa no es un control: es trabajo
hecho que no protege nada.

EL VECTOR QUE DELATA. `offline_approved: true` es una AFIRMACION del cliente, no una
prueba. Un mesero con su propio shift token puede mandarla y autoaprobarse una
cancelacion o la reapertura de una cuenta ya pagada. No se BLOQUEA a proposito: un 403
en el replay de la cola offline es terminal (pos-offline-db.ts) y perderia en silencio
cada cancelacion hecha sin internet, en un restaurante que opera sin WAN. La defensa
que queda es verlo.

QUE FIJAN ESTAS PRUEBAS
  - que solo se reporte lo que el servidor marco (no se re-inventa el criterio aqui);
  - que "ya servido" pese mas que el monto al ordenar, porque es lo que separa un error
    de captura de una cancelacion despues de servir y cobrar;
  - que una reaparicion sin monto NO se descarte: en una reapertura no hay monto de
    renglon, y exigirlo dejaria fuera justo el vector mas caro.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

# El agente lee configuracion del entorno al importarse.
os.environ.setdefault("SUPABASE_URL", "https://ejemplo.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "no-es-una-llave")
os.environ.setdefault("CLIENT_ID", "amalay")

import antifraud_agent as af  # noqa: E402


def evento(actor, *, revisar=True, monto=None, servido=False, action="item_cancelled"):
    detalles = {"revisar": revisar, "approval_mode": "offline_device_trust:mesero"}
    if monto is not None:
        detalles["monto"] = monto
    if servido:
        detalles["ya_enviado_a_cocina"] = True
    return {"order_id": "o-1", "action": action, "actor": actor,
            "mesa": 4, "details": detalles, "created_at": "2026-09-09T20:00:00Z"}


class SoloLoQueElServidorMarco(unittest.TestCase):
    def test_una_sola_ya_dispara(self):
        # No es una tasa: el servidor solo marca cuando quien pedia NO tenia el nivel.
        f = af.analyze_aprobaciones([evento("Oscar", monto=928)])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["actor"], "Oscar")
        self.assertEqual(f[0]["count"], 1)

    def test_sin_la_marca_no_se_reporta(self):
        # El criterio vive en el servidor. Aqui no se re-inventa: si un gerente aprueba
        # sin red en su propia terminal, `revisar` es False y esto no debe alarmar.
        self.assertEqual(af.analyze_aprobaciones([evento("Eduardo", revisar=False)]), [])

    def test_lista_vacia_no_produce_hallazgos(self):
        self.assertEqual(af.analyze_aprobaciones([]), [])

    def test_detalles_corruptos_no_truenan(self):
        raro = {"actor": "X", "action": "item_cancelled", "details": "esto no es un objeto"}
        self.assertEqual(af.analyze_aprobaciones([raro]), [])


class LoQueImportaAlOrdenar(unittest.TestCase):
    def test_ya_servido_gana_al_monto(self):
        # Cancelar algo que la cocina YA mando es lo que distingue un error de captura
        # de una cancelacion despues de servir. Pesa mas que un monto grande.
        f = af.analyze_aprobaciones([
            evento("ConMonto", monto=5000),
            evento("Servido", monto=100, servido=True),
        ])
        self.assertEqual(f[0]["actor"], "Servido")
        self.assertEqual(f[0]["servido"], 1)
        self.assertIn("YA SERVIDAS", f[0]["message"])

    def test_a_igualdad_de_servidas_manda_el_monto(self):
        f = af.analyze_aprobaciones([evento("Chico", monto=50), evento("Grande", monto=900)])
        self.assertEqual(f[0]["actor"], "Grande")


class ElCasoSinMonto(unittest.TestCase):
    def test_una_reapertura_sin_monto_SI_se_reporta(self):
        # `reopen-order` no guarda `monto`: lo que se reabre es la cuenta entera.
        # Exigir monto dejaria fuera el vector mas caro (reabrir -> modificar -> recerrar).
        f = af.analyze_aprobaciones([evento("Ana", action="order_reopened")])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["faltante_mxn"], 0)
        self.assertNotIn("$", f[0]["message"])

    def test_un_monto_no_numerico_no_tira_el_analisis(self):
        f = af.analyze_aprobaciones([evento("Ana", monto="doscientos")])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["faltante_mxn"], 0)


class SeSumaPorActor(unittest.TestCase):
    def test_varias_del_mismo_actor_son_un_hallazgo(self):
        f = af.analyze_aprobaciones([
            evento("Oscar", monto=300), evento("Oscar", monto=200, servido=True),
        ])
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["count"], 2)
        self.assertEqual(f[0]["faltante_mxn"], 500)
        self.assertEqual(f[0]["servido"], 1)


class LlegaAlReporte(unittest.TestCase):
    def test_el_tipo_pesa_en_el_score(self):
        # Sin peso propio caia en el `else` de 5 puntos, junto a las observaciones
        # menores. Es el mismo robo que el skimming, un paso antes.
        self.assertGreaterEqual(
            af.calculate_risk_score([{"type": "aprobacion_sospechosa"}]), 25)

    def test_pesa_menos_que_el_skimming_pero_no_mucho(self):
        solo = af.calculate_risk_score([{"type": "aprobacion_sospechosa"}])
        skim = af.calculate_risk_score([{"type": "skimming"}])
        self.assertLess(solo, skim)
        self.assertGreater(solo, af.calculate_risk_score([{"type": "cancellations"}]))

    def test_el_mensaje_dice_que_hacer(self):
        f = af.analyze_aprobaciones([evento("Oscar", monto=928, servido=True)])[0]
        self.assertIn("SIN nivel de gerente", f["message"])
        self.assertIn("device-trust", f["detail"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
