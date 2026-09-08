#!/usr/bin/env python3
"""Un hallazgo que habla en presente tiene que decir de cuándo es su dato.

EL PROBLEMA, MEDIDO EL 2026-09-08

De los 41 agentes que le hablan a una persona —pantalla, Telegram o insight— DOS revisan
si su dato está fresco. Treinta y nueve no.

Y las fuentes históricas están muertas: `wansoft_daily` no recibe datos desde el
2026-07-20 y `ops_daily` desde el 2026-07-12, porque los 17 workflows de Wansoft están
apagados en GitHub. Un agente que lea eso y escriba "las ventas cayeron 30%" está diciendo
algo falso con el cálculo perfecto — y suena exactamente igual de creíble que la verdad.

LA RESPUESTA NO ES CALLAR

Eso ya se decidió con el fraude: lo que se esconde no se puede juzgar, y un hallazgo
suprimido se ve igual que un restaurante sano. La respuesta es FECHAR la afirmación. Un
hallazgo viejo sigue sirviendo si dice que es viejo; deja de servir cuando se disfraza de
hoy.

El caso que lo prueba: entre el 2026-06-20 y el 2026-08-03 el predictor recibió el mismo
`current_ventas` 34 días seguidos —$68,421— porque su fuente repetía la última fila.
Proyectó los 34 días y ninguna proyección se veía rara. Con la frescura declarada habrían
salido fechadas desde el primer día.
"""
from __future__ import annotations

import os
import pathlib
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
os.environ.setdefault("SUPABASE_URL", "http://pruebas.invalido")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "no-es-una-llave")

import agent_common  # noqa: E402
from agent_common import (  # noqa: E402
    HORAS_PARA_HABLAR_EN_PRESENTE, edad_del_dato, fechar_afirmacion, mas_reciente,
)

HOY = datetime.now(timezone.utc)


def hace(horas: float) -> str:
    return (HOY - timedelta(hours=horas)).isoformat()


class QueTanViejoEsElDato(unittest.TestCase):
    def test_un_dato_de_hace_dos_horas_habla_del_presente(self):
        e = edad_del_dato(hace(2))
        self.assertTrue(e["declarada"])
        self.assertTrue(e["en_presente"])

    def test_un_dato_de_hace_dos_meses_no(self):
        e = edad_del_dato("2026-07-12")
        self.assertTrue(e["declarada"])
        self.assertFalse(e["en_presente"])
        self.assertGreater(e["dias"], 30)

    def test_no_declarar_no_es_lo_mismo_que_estar_fresco(self):
        # El error más fácil de cometer aquí sería tratar el silencio como "está bien".
        e = edad_del_dato(None)
        self.assertFalse(e["declarada"])
        self.assertFalse(e["en_presente"], "sin declarar NO puede pasar por dato de hoy")

    def test_una_fecha_ilegible_tampoco_pasa_por_fresca(self):
        e = edad_del_dato("ayer en la tarde")
        self.assertFalse(e["declarada"])
        self.assertFalse(e["en_presente"])

    def test_el_umbral_es_de_horas_no_de_dias(self):
        # Un hallazgo sobre la operación de hoy se cocina en horas.
        self.assertLessEqual(HORAS_PARA_HABLAR_EN_PRESENTE, 48)


class ComoQuedaLaFrase(unittest.TestCase):
    def test_el_dato_viejo_sale_fechado(self):
        t = fechar_afirmacion("las ventas cayeron 30%", edad_del_dato("2026-07-12"))
        self.assertIn("Con datos al 2026-07-12", t)
        self.assertIn("las ventas cayeron 30%", t, "fechar no puede perder el hallazgo")

    def test_el_dato_fresco_se_queda_igual(self):
        original = "las ventas cayeron 30%"
        self.assertEqual(fechar_afirmacion(original, edad_del_dato(hace(1))), original)

    def test_sin_declarar_no_se_ensucia_la_frase(self):
        # La presión va sobre el agente que no declara (ver el barrido de abajo), no sobre
        # quien lee la pantalla.
        original = "las ventas cayeron 30%"
        self.assertEqual(fechar_afirmacion(original, edad_del_dato(None)), original)

    def test_fechar_no_suaviza_ni_esconde(self):
        t = fechar_afirmacion("robo de $4,200 en cancelaciones", edad_del_dato("2026-07-12"))
        self.assertIn("robo de $4,200", t)
        for palabra in ("posible", "quizá", "podría"):
            self.assertNotIn(palabra, t.lower())


class ElDatoMasNuevoDeUnLote(unittest.TestCase):
    def test_toma_el_mayor(self):
        filas = [{"created_at": "2026-09-01"}, {"created_at": "2026-09-05"}, {"created_at": "2026-08-30"}]
        self.assertEqual(mas_reciente(filas, "created_at"), "2026-09-05")

    def test_sin_filas_devuelve_none_no_una_fecha_inventada(self):
        self.assertIsNone(mas_reciente([], "created_at"))
        self.assertIsNone(mas_reciente(None, "created_at"))

    def test_ignora_filas_sin_el_campo(self):
        self.assertEqual(mas_reciente([{"x": 1}, {"created_at": "2026-09-05"}], "created_at"),
                         "2026-09-05")


class LoQueLlegaAAgentEvents(unittest.TestCase):
    """log_event es el cuello por donde pasa todo hallazgo que llega a la pantalla."""

    def setUp(self):
        self.enviado = {}
        original = agent_common.requests.post

        class Respuesta:
            ok = True
            status_code = 201
            text = ""

        def falso_post(url, headers=None, json=None, timeout=None):
            self.enviado.clear()
            self.enviado.update(json or {})
            return Respuesta()

        agent_common.requests.post = falso_post
        self.addCleanup(lambda: setattr(agent_common.requests, "post", original))

    def test_la_frescura_queda_escrita_en_la_evidencia(self):
        agent_common.log_event(agent_id="pruebas", event_type="anomaly", title="algo",
                               client_id="amalay", datos_hasta="2026-07-12")
        import json
        ev = json.loads(self.enviado["evidence"])
        self.assertIn("frescura", ev)
        self.assertTrue(ev["frescura"]["declarada"])
        self.assertFalse(ev["frescura"]["en_presente"])

    def test_el_titulo_viejo_llega_fechado(self):
        agent_common.log_event(agent_id="pruebas", event_type="anomaly",
                               title="las ventas cayeron 30%",
                               client_id="amalay", datos_hasta="2026-07-12")
        self.assertIn("Con datos al 2026-07-12", self.enviado["title"])

    def test_sin_declarar_queda_marcado_como_no_declarado(self):
        agent_common.log_event(agent_id="pruebas", event_type="anomaly", title="algo",
                               client_id="amalay")
        import json
        ev = json.loads(self.enviado["evidence"])
        self.assertFalse(ev["frescura"]["declarada"])

    def test_no_pisa_la_evidencia_que_trae_el_agente(self):
        agent_common.log_event(agent_id="pruebas", event_type="anomaly", title="algo",
                               client_id="amalay", datos_hasta="2026-07-12",
                               evidence={"ordenes": 12})
        import json
        ev = json.loads(self.enviado["evidence"])
        self.assertEqual(ev["ordenes"], 12)
        self.assertIn("frescura", ev)


class BarridoDeQuienEscribeALaPantalla(unittest.TestCase):
    """Ningún agente puede escribir a agent_events sin declarar la edad de su dato.

    Sin esta prueba la regla dura hasta el próximo agente que alguien escriba. Es el mismo
    error que ya costó una semana: `.replace("+00:00","Z")` estaba corregido en UN archivo
    y nadie barrió el resto.
    """

    def test_todos_los_log_event_declaran_datos_hasta(self):
        omisos = []
        for archivo in sorted(RAIZ.glob("*.py")):
            if archivo.name.startswith("test_") or archivo.name == "agent_common.py":
                continue
            texto = archivo.read_text()
            for m in re.finditer(r"\blog_event\s*\(", texto):
                # recortar la llamada balanceando paréntesis
                i, prof = m.end() - 1, 0
                while i < len(texto):
                    if texto[i] == "(":
                        prof += 1
                    elif texto[i] == ")":
                        prof -= 1
                        if prof == 0:
                            break
                    i += 1
                llamada = texto[m.start():i + 1]
                if "datos_hasta" not in llamada:
                    linea = texto[:m.start()].count("\n") + 1
                    omisos.append(f"{archivo.name}:{linea}")
        self.assertEqual(
            omisos, [],
            "hallazgos que llegan a la pantalla sin decir de cuándo es su dato:\n  "
            + "\n  ".join(omisos))


if __name__ == "__main__":
    unittest.main(verbosity=2)
