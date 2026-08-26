#!/usr/bin/env python3
"""Pruebas de tenants_activos.py — sin red.

Lo que fijan, en orden de importancia:

  1. Que AMALAY NO se caiga de la lista por su llave corrupta. En producción tiene
     `agent\\n  esIA` en vez de `agentesIA`, y es el único restaurante así. Un filtro
     estricto excluiría justo al que hoy corre los agentes: el arreglo rompería lo que
     venía a proteger.

  2. Que `features` guardado como STRING (coffee-shop, demo, esqueleton-demo) cuente
     igual que guardado como objeto.

  3. Que un error de red o de HTTP haga FALLAR el script en vez de devolver una lista
     vacía. Una matriz vacía salta los jobs en silencio, y eso se lee como "todo bien"
     cuando en realidad los agentes dejaron de correr.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

RUTA = Path(__file__).parent / "tenants_activos.py"
sys.path.insert(0, str(Path(__file__).parent))

import tenants_activos as ta  # noqa: E402


class RespuestaFalsa:
    def __init__(self, filas, ok=True, status=200):
        self._filas, self.ok, self.status_code = filas, ok, status

    def json(self):
        if self._filas is None:
            raise ValueError("no es json")
        return self._filas


def correr(filas, entorno=None, ok=True):
    env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_KEY": "k"}
    env.update(entorno or {})
    with mock.patch.dict(os.environ, env, clear=True), \
         mock.patch.object(ta.requests, "get", return_value=RespuestaFalsa(filas, ok)):
        from io import StringIO
        salida, err = StringIO(), StringIO()
        with mock.patch("sys.stdout", salida), mock.patch("sys.stderr", err):
            codigo = ta.main()
        return codigo, salida.getvalue().strip(), err.getvalue()


def lista_de(salida: str) -> list[str]:
    return json.loads(salida.split("lista=", 1)[1])


class NormalizacionDeLlaves(unittest.TestCase):
    def test_amalay_con_su_llave_corrupta_SIGUE_en_la_lista(self):
        # El caso que importa. `agent\n  esIA` es lo que hay en producción.
        codigo, out, _ = correr([
            {"id": "amalay", "active": True, "features": {"agent\n  esIA": True}},
        ])
        self.assertEqual(codigo, 0)
        self.assertEqual(lista_de(out), ["amalay"])

    def test_avisa_de_las_llaves_sucias_en_vez_de_taparlas(self):
        _, _, err = correr([
            {"id": "amalay", "active": True, "features": {"agent\n  esIA": True}},
        ])
        self.assertIn("AVISO", err)
        self.assertIn("amalay", err)

    def test_la_llave_limpia_tambien_funciona(self):
        codigo, out, _ = correr([
            {"id": "boruca", "active": True, "features": {"agentesIA": True}},
        ])
        self.assertEqual(lista_de(out), ["boruca"])


class FeaturesComoTexto(unittest.TestCase):
    def test_features_en_string_cuenta_igual(self):
        codigo, out, _ = correr([
            {"id": "demo", "active": True, "features": '{"agentesIA": true}'},
        ])
        self.assertEqual(lista_de(out), ["demo"])

    def test_string_roto_no_tumba_el_script(self):
        codigo, out, _ = correr([
            {"id": "roto", "active": True, "features": "{esto no es json"},
            {"id": "bueno", "active": True, "features": {"agentesIA": True}},
        ])
        self.assertEqual(codigo, 0)
        self.assertEqual(lista_de(out), ["bueno"])


class QuienQuedaFuera(unittest.TestCase):
    def test_sin_la_bandera_no_entra(self):
        _, out, _ = correr([
            {"id": "nomada", "active": True, "features": {}},
            {"id": "sushi-zen", "active": True, "features": {"pos": True}},
        ])
        self.assertEqual(lista_de(out), [])

    def test_la_bandera_en_false_no_entra(self):
        _, out, _ = correr([{"id": "x", "active": True, "features": {"agentesIA": False}}])
        self.assertEqual(lista_de(out), [])

    def test_una_bandera_que_no_es_booleana_no_cuenta(self):
        # 'true' como texto, o 1, no son la bandera puesta. Se exige True de verdad.
        _, out, _ = correr([{"id": "x", "active": True, "features": {"agentesIA": "true"}}])
        self.assertEqual(lista_de(out), [])

    def test_lista_vacia_avisa_fuerte(self):
        _, _, err = correr([{"id": "x", "active": True, "features": {}}])
        self.assertIn("NINGÚN", err)


class Fallas(unittest.TestCase):
    def test_error_de_red_hace_fallar_no_devuelve_vacio(self):
        env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_KEY": "k"}
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(ta.requests, "get", side_effect=ta.requests.RequestException("caída")):
            from io import StringIO
            with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
                self.assertEqual(ta.main(), 1)

    def test_http_no_2xx_hace_fallar(self):
        codigo, _, _ = correr([], ok=False)
        self.assertEqual(codigo, 1)

    def test_respuesta_que_no_es_json_hace_fallar(self):
        codigo, _, _ = correr(None)
        self.assertEqual(codigo, 1)

    def test_sin_credenciales_falla(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            from io import StringIO
            with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
                self.assertEqual(ta.main(), 1)


class DisparoManual(unittest.TestCase):
    def test_un_client_id_concreto_devuelve_solo_ese_y_no_consulta(self):
        env = {"CLIENT_ID": "boruca"}
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(ta.requests, "get") as g:
            from io import StringIO
            salida = StringIO()
            with mock.patch("sys.stdout", salida), mock.patch("sys.stderr", StringIO()):
                self.assertEqual(ta.main(), 0)
            self.assertEqual(lista_de(salida.getvalue()), ["boruca"])
            g.assert_not_called()

    def test_ALL_si_consulta_a_todos(self):
        _, out, _ = correr(
            [{"id": "a", "active": True, "features": {"agentesIA": True}}],
            {"CLIENT_ID": "ALL"},
        )
        self.assertEqual(lista_de(out), ["a"])


class Formato(unittest.TestCase):
    def test_la_salida_es_parseable_por_fromJson_de_actions(self):
        _, out, _ = correr([
            {"id": "zeta", "active": True, "features": {"agentesIA": True}},
            {"id": "alfa", "active": True, "features": {"agentesIA": True}},
        ])
        self.assertTrue(out.startswith("lista="))
        self.assertEqual(lista_de(out), ["alfa", "zeta"])  # ordenado y estable

    def test_corre_de_verdad_como_subproceso(self):
        # Que el archivo sea ejecutable y no truene al importar.
        r = subprocess.run([sys.executable, str(RUTA)],
                           env={**os.environ, "CLIENT_ID": "amalay"},
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn('lista=["amalay"]', r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
