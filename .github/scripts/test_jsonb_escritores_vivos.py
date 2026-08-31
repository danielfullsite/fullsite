#!/usr/bin/env python3
"""Pruebas de `evidence` (agent_insights / agent_events) — sin red.

El fondo del asunto: las dos columnas son `jsonb`. Cuando `create_insight` mandaba
`json.dumps(evidence)`, PostgREST recibia un STRING de Python y Postgres lo guardaba
como un ESCALAR JSON de tipo string — no como objeto. El hallazgo entraba, pero
`evidence->>'campo'` devolvia NULL y nada de eso era consultable desde SQL.

Medido en produccion (amalay, solo lectura, 2026-08-27):

    agent_insights.evidence → 2,057 de 2,444 filas escalares string
    ultima fila mala: 2026-08-27 — o sea, HOY. Seguia escribiendose mal.

Por que duro tanto: `agent_insights.evidence` NO TIENE LECTOR en el repo. Ni el
dashboard (getDeepTable solo se llama con 'agent_results' y 'agent_runs') ni ningun
script lo leen. Un dato que nadie lee no se queja cuando esta mal guardado.

`agent_events.evidence` marcaba 0 filas malas, pero no porque estuviera bien: los
INSERT de `log_event` se rechazaban por un CHECK de `status` y se perdian en
silencio. Eso se arreglo el 2026-08-26 — o sea que la columna estaba a punto de
empezar a llenarse de escalares string. Se arregla en el mismo movimiento porque es
la misma funcion, dos lineas mas abajo.

Lo que fijan estas pruebas, en orden de importancia:

  1. Que el payload REAL que arma agent_common lleve un dict. No se revisa el
     fuente: se importa el modulo, se intercepta requests.post y se mira lo que
     saldria por el cable. Es la unica forma de hablar del codigo que se despliega.

  2. Que ningun payload con llave "evidence" vuelva a envolverse en json.dumps,
     con guarda contra pasar en vacio.

  3. Que el lector de agent_events siga tolerando las filas historicas, que se
     quedan como string: NO se migro ningun dato de AMALAY.
"""
from __future__ import annotations

import ast
import json
import os
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
RAIZ = SCRIPTS.parents[1]
IGNORADOS = {"node_modules", ".git", "venv", ".venv", "graphify-out"}

# Al 2026-08-27 hay 3 payloads con llave "evidence" fuera de las pruebas:
# create_insight, log_event y el PATCH de resolver_predicciones. Piso, no objetivo.
MINIMO_PAYLOADS = 3


def _es_json_dumps(nodo: ast.AST) -> bool:
    return (isinstance(nodo, ast.Call)
            and isinstance(nodo.func, ast.Attribute)
            and nodo.func.attr == "dumps"
            and isinstance(nodo.func.value, ast.Name)
            and nodo.func.value.id == "json")


def _envuelve(nodo: ast.AST) -> bool:
    """¿Este valor termina como texto en el cuerpo HTTP?

    Se rechazan las dos formas que producen el bug:
      · json.dumps(x)
      · json.dumps(x) if <cond> else x   ← la guarda que guarda al reves: cuando x ya
        es texto lo deja pasar tal cual, y Postgres lo guarda igual de mal.
    """
    if _es_json_dumps(nodo):
        return True
    if isinstance(nodo, ast.IfExp):
        return _es_json_dumps(nodo.body) or _es_json_dumps(nodo.orelse)
    return False


def _payloads_con_evidence():
    """(archivo, linea, nodo) por cada dict literal con la llave "evidence".

    Se busca por la llave y no por nombre de archivo para que un agente NUEVO quede
    cubierto el dia que lo agreguen sin acordarse de esta prueba. Los archivos de
    prueba se saltan: ahi se construyen strings A PROPOSITO, para verificar que el
    lector tolera las filas historicas.
    """
    hallazgos = []
    for ruta in sorted(RAIZ.rglob("*.py")):
        if IGNORADOS & set(ruta.parts) or ruta.name.startswith("test_"):
            continue
        try:
            arbol = ast.parse(ruta.read_text(encoding="utf-8"))
        except SyntaxError as e:
            raise AssertionError(f"{ruta} no parsea: {e}") from e
        for nodo in ast.walk(arbol):
            if not isinstance(nodo, ast.Dict):
                continue
            for k, v in zip(nodo.keys, nodo.values):
                if isinstance(k, ast.Constant) and k.value == "evidence":
                    hallazgos.append((ruta.relative_to(RAIZ).as_posix(), v.lineno, v))
    return hallazgos


def flecha_texto(valor, llave):
    """Modela `evidence->>'llave'` de Postgres sobre un jsonb ya decodificado.

    Sobre un escalar de tipo string, ->> devuelve NULL: no hay llaves que buscar
    dentro de un string. Eso es lo que hacia invisible el dato.
    """
    if not isinstance(valor, dict):
        return None
    v = valor.get(llave)
    if v is None:
        return None
    return v if isinstance(v, str) else json.dumps(v)


# ── Carga de agent_common con el entorno minimo ────────────────────────────────
# El modulo solo lee variables de entorno al importarse (no pega a la red), pero
# necesita que existan para armar los headers.
os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "placeholder")
os.environ.setdefault("CLIENT_ID", "tenant-de-prueba")
sys.path.insert(0, str(SCRIPTS))
import agent_common  # noqa: E402


class PayloadRealDeAgentCommon(unittest.TestCase):
    """Lo que de verdad sale por el cable, no lo que dice el fuente."""

    CARGA = {"sin_stock": 225, "criticos": ["harina", "huevo"], "monto": 1250.5}

    def _capturar(self, fn, **kwargs):
        """Corre `fn` con requests.post interceptado y devuelve el body que mandaria."""
        capturado = {}

        class RespuestaFalsa:
            ok = True
            status_code = 201
            text = ""

        def post_falso(url, **kw):
            capturado["url"] = url
            capturado["json"] = kw.get("json")
            return RespuestaFalsa()

        original = agent_common.requests.post
        agent_common.requests.post = post_falso
        try:
            fn(**kwargs)
        finally:
            agent_common.requests.post = original
        self.assertIn("json", capturado, "no se disparo ningun POST")
        return capturado

    def test_create_insight_manda_evidence_como_objeto(self):
        cap = self._capturar(
            agent_common.create_insight,
            agent_id="stock-alert", category="inventory", severity="high",
            title="Falta producto", evidence=dict(self.CARGA), client_id="tenant-de-prueba",
        )
        self.assertIn("agent_insights", cap["url"])
        ev = cap["json"]["evidence"]
        self.assertIsInstance(ev, dict, "la columna es jsonb: dict, no str")
        self.assertEqual(flecha_texto(ev, "sin_stock"), "225",
                         "evidence->>'sin_stock' tiene que devolver el dato, no NULL")

    def test_log_event_manda_evidence_como_objeto(self):
        cap = self._capturar(
            agent_common.log_event,
            agent_id="close-predictor", event_type="forecast", title="Cierre estimado",
            evidence=dict(self.CARGA), client_id="tenant-de-prueba",
        )
        self.assertIn("agent_events", cap["url"])
        self.assertIsInstance(cap["json"]["evidence"], dict)

    def test_sin_evidence_se_manda_None_no_la_cadena_null(self):
        # `null` de JSON, no el texto "null": si no, la columna guarda un escalar
        # string con la palabra null adentro y `evidence is null` da falso.
        cap = self._capturar(
            agent_common.create_insight,
            agent_id="config-validator", category="ops", severity="info",
            title="Todo bien", client_id="tenant-de-prueba",
        )
        self.assertIsNone(cap["json"]["evidence"])

    def test_el_payload_entero_sobrevive_el_viaje_http(self):
        # Que no quede duda de que el dict aguanta la serializacion del cuerpo.
        cap = self._capturar(
            agent_common.create_insight,
            agent_id="waste-detector", category="ops", severity="medium",
            title="Merma alta", evidence=dict(self.CARGA), client_id="tenant-de-prueba",
        )
        ida_y_vuelta = json.loads(json.dumps(cap["json"]))
        self.assertEqual(ida_y_vuelta["evidence"], self.CARGA)


class EscritoresNoEnvuelvenEvidence(unittest.TestCase):

    def test_ningun_payload_envuelve_evidence(self):
        culpables = [f"{arch}:{ln}" for arch, ln, nodo in _payloads_con_evidence()
                     if _envuelve(nodo)]
        self.assertEqual(
            culpables, [],
            "Estos escritores mandan `evidence` como texto. La columna es jsonb: hay "
            "que mandar el dict directo, si no Postgres guarda un escalar de tipo "
            "string y `evidence->>'campo'` devuelve NULL.\n  " + "\n  ".join(culpables))

    def test_el_escaneo_no_pasa_en_vacio(self):
        # Sin esto, renombrar la llave "evidence" volveria la prueba de arriba
        # trivialmente verde: cero payloads, cero culpables, aprobado sin revisar nada.
        hallados = _payloads_con_evidence()
        self.assertGreaterEqual(
            len(hallados), MINIMO_PAYLOADS,
            f"Solo se hallaron {len(hallados)} payloads con llave 'evidence' y se "
            f"esperaban al menos {MINIMO_PAYLOADS}. O el escaneo dejo de reconocer la "
            f"llave, o se borraron escritores.")


class SemanticaJsonbDePostgrest(unittest.TestCase):
    """Que quede escrito que las dos formas NO son equivalentes."""

    CARGA = {"sin_stock": 225, "criticos": ["harina", "huevo"]}

    def _viaje_redondo(self, valor):
        cuerpo = json.dumps({"agent_id": "stock-alert", "evidence": valor})
        return json.loads(cuerpo)["evidence"]

    def test_dict_directo_queda_como_objeto_y_es_consultable(self):
        ev = self._viaje_redondo(self.CARGA)
        self.assertIsInstance(ev, dict)
        self.assertEqual(flecha_texto(ev, "sin_stock"), "225")

    def test_json_dumps_queda_como_escalar_string_e_inconsultable(self):
        # Este es el bug, congelado. Si algun dia esta prueba falla es que cambio la
        # semantica de PostgREST y habria que revisar todo lo demas.
        ev = self._viaje_redondo(json.dumps(self.CARGA))
        self.assertIsInstance(ev, str)
        self.assertIsNone(flecha_texto(ev, "sin_stock"),
                          "evidence->>'sin_stock' devolvia NULL: inconsultable")


class LectorDeEvidenceToleraLoHistorico(unittest.TestCase):
    """NO se migro ningun dato de AMALAY: las 2,057 filas viejas siguen como string."""

    @staticmethod
    def _cargar_evidencia_de():
        """Saca `evidencia_de` del fuente real de resolver_predicciones.py.

        No se importa el modulo: corre trabajo de verdad al importarse. Se extrae la
        funcion del AST y se ejecuta aislada, para que la prueba hable del codigo que
        se despliega y no de una copia.
        """
        arbol = ast.parse((SCRIPTS / "resolver_predicciones.py").read_text(encoding="utf-8"))
        for nodo in arbol.body:
            if isinstance(nodo, ast.FunctionDef) and nodo.name == "evidencia_de":
                ambito: dict = {"json": json}
                exec(compile(ast.Module([nodo], []), "<evidencia_de>", "exec"), ambito)
                return ambito["evidencia_de"]
        raise AssertionError("evidencia_de ya no existe en resolver_predicciones.py")

    def setUp(self):
        self.evidencia_de = self._cargar_evidencia_de()

    def test_tolera_el_objeto_nuevo(self):
        self.assertEqual(self.evidencia_de({"evidence": {"prediccion": 1}}), {"prediccion": 1})

    def test_tolera_el_string_historico(self):
        self.assertEqual(self.evidencia_de({"evidence": '{"prediccion": 1}'}), {"prediccion": 1})

    def test_una_fila_corrupta_no_lo_tumba(self):
        self.assertEqual(self.evidencia_de({"evidence": "{no es json"}), {})

    def test_sin_evidence_devuelve_dict_vacio(self):
        self.assertEqual(self.evidencia_de({}), {})

    def test_las_dos_formas_dan_lo_mismo(self):
        # La propiedad que importa: durante la transicion conviven filas viejas y
        # nuevas en la misma consulta, y el resolvedor no puede distinguirlas.
        carga = {"prediccion": 12345, "tolerancia_pct": 10}
        self.assertEqual(self.evidencia_de({"evidence": carga}),
                         self.evidencia_de({"evidence": json.dumps(carga)}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
