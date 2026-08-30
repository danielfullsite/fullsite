#!/usr/bin/env python3
"""Pruebas de `agent_results.data` — sin red.

El fondo del asunto: `agent_results.data` es `jsonb`. Cuando un agente mandaba
`json.dumps({...})`, PostgREST recibia un STRING de Python y Postgres lo guardaba
como un ESCALAR JSON de tipo string — no como objeto. La fila se veia bien en el
dashboard (los lectores desenvuelven el string) pero era inconsultable desde SQL:

    select jsonb_typeof(data), data->>'sin_stock' from agent_results ...
    -- "string", null

O sea: el dato entraba, pero `data->>'campo'` devolvia NULL siempre.

Lo que fijan estas pruebas, en orden de importancia:

  1. Que NINGUN escritor vuelva a envolver `data` en `json.dumps`. Esta es la
     prueba que importa: el bug ya se habia notado antes y se parcho del lado del
     LECTOR (`deep_parse` en stock_alert_agent.py). Parchar al lector deja al
     escritor libre de reincidir, y el dato sigue sin ser consultable en SQL.

  2. Que el escaneo no pase en vacio. Una prueba que busca un patron y no
     encuentra ningun payload aprueba sin haber revisado nada. Por eso se exige un
     minimo de payloads hallados: si alguien renombra la llave, esto truena.

  3. Que las filas historicas (las que ya quedaron como string) se sigan
     leyendo. `deep_parse` es la red de seguridad y tiene que seguir siendo
     idempotente: dict -> dict, string -> dict, doble-escapado -> dict.
"""
from __future__ import annotations

import ast
import json
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parent

# Al 2026-08-26 hay 19 agentes que escriben a agent_results. El numero es un piso,
# no un objetivo: si se agregan agentes debe subir, nunca bajar en silencio.
MINIMO_PAYLOADS = 19


def _es_json_dumps(nodo: ast.AST) -> bool:
    return (isinstance(nodo, ast.Call)
            and isinstance(nodo.func, ast.Attribute)
            and nodo.func.attr == "dumps"
            and isinstance(nodo.func.value, ast.Name)
            and nodo.func.value.id == "json")


def _payloads_de_agent_results():
    """Devuelve (archivo, linea, nodo_valor_de_data) por cada payload de agent_results.

    Se identifica el payload por su firma de fila: un dict literal que lleva a la vez
    las llaves "agent_id" y "data". Es la forma de una fila de agent_results (su
    unique key es client_id+agent_id+fecha) y no coincide con las escrituras a otras
    tablas. Se busca asi, y no por nombre de archivo, para que un agente NUEVO quede
    cubierto el dia que lo agreguen sin tener que acordarse de esta prueba.
    """
    hallazgos = []
    for ruta in sorted(SCRIPTS.glob("*.py")):
        if ruta.name.startswith("test_"):
            continue
        try:
            arbol = ast.parse(ruta.read_text(encoding="utf-8"))
        except SyntaxError as e:  # un archivo roto es falla de otra prueba, no de esta
            raise AssertionError(f"{ruta.name} no parsea: {e}") from e
        for nodo in ast.walk(arbol):
            if not isinstance(nodo, ast.Dict):
                continue
            llaves = {k.value for k in nodo.keys
                      if isinstance(k, ast.Constant) and isinstance(k.value, str)}
            if not {"agent_id", "data"} <= llaves:
                continue
            for k, v in zip(nodo.keys, nodo.values):
                if isinstance(k, ast.Constant) and k.value == "data":
                    hallazgos.append((ruta.name, v.lineno, v))
    return hallazgos


def flecha_texto(data, llave):
    """Modela `data->>'llave'` de Postgres sobre un valor jsonb ya decodificado.

    En Postgres el operador ->> sobre un escalar de tipo string devuelve NULL: no hay
    llaves que buscar dentro de un string. Eso es exactamente lo que hacia invisible
    el dato. Se modela aqui para que la prueba hable de la consulta real y no de la
    forma del objeto en Python.
    """
    if not isinstance(data, dict):
        return None
    valor = data.get(llave)
    if valor is None:
        return None
    return valor if isinstance(valor, str) else json.dumps(valor)


class EscritoresNoEnvuelvenData(unittest.TestCase):

    def test_ningun_payload_de_agent_results_usa_json_dumps(self):
        culpables = [f"{arch}:{ln}" for arch, ln, nodo in _payloads_de_agent_results()
                     if _es_json_dumps(nodo)]
        self.assertEqual(
            culpables, [],
            "Estos escritores envuelven `data` en json.dumps. La columna es jsonb: "
            "hay que mandar el dict directo, si no Postgres guarda un escalar de tipo "
            "string y `data->>'campo'` devuelve NULL.\n  " + "\n  ".join(culpables))

    def test_el_escaneo_no_pasa_en_vacio(self):
        # Sin esto, renombrar la llave "data" volveria la prueba de arriba trivialmente
        # verde: cero payloads hallados, cero culpables, aprobado sin revisar nada.
        hallados = _payloads_de_agent_results()
        self.assertGreaterEqual(
            len(hallados), MINIMO_PAYLOADS,
            f"Solo se hallaron {len(hallados)} payloads de agent_results y se esperaban "
            f"al menos {MINIMO_PAYLOADS}. O el escaneo dejo de reconocer la firma "
            f"(agent_id + data), o se borraron agentes.")


class SemanticaJsonbDePostgrest(unittest.TestCase):
    """Que quede escrito que las dos formas NO son equivalentes."""

    CARGA = {"sin_stock": 225, "critico": 12, "almacenes_afectados": ["cocina", "barra"]}

    def _viaje_redondo(self, valor_de_data):
        """Simula el viaje: payload -> cuerpo HTTP -> jsonb decodificado."""
        cuerpo = json.dumps({"agent_id": "stock-alert", "data": valor_de_data})
        return json.loads(cuerpo)["data"]

    def test_dict_directo_queda_como_objeto_y_es_consultable(self):
        data = self._viaje_redondo(self.CARGA)
        self.assertIsInstance(data, dict, "jsonb_typeof deberia ser 'object'")
        self.assertEqual(flecha_texto(data, "sin_stock"), "225")

    def test_json_dumps_queda_como_escalar_string_e_inconsultable(self):
        # Este es el bug, congelado. Si algun dia esta prueba falla es que cambio la
        # semantica de PostgREST y habria que revisar todo lo demas.
        data = self._viaje_redondo(json.dumps(self.CARGA))
        self.assertIsInstance(data, str, "asi entraba el dato: como string, no objeto")
        self.assertIsNone(flecha_texto(data, "sin_stock"),
                          "data->>'sin_stock' devolvia NULL: el dato era inconsultable")


class LecturaDeFilasHistoricas(unittest.TestCase):
    """Las filas viejas siguen guardadas como string. Se tienen que poder leer."""

    @staticmethod
    def _cargar_deep_parse():
        """Saca deep_parse del fuente real de stock_alert_agent.py.

        No se importa el modulo: corre trabajo de verdad al importarse (lee env,
        pega a la red). Se extrae la funcion del AST y se ejecuta aislada, para que
        la prueba hable del codigo que se despliega y no de una copia.
        """
        fuente = (SCRIPTS / "stock_alert_agent.py").read_text(encoding="utf-8")
        arbol = ast.parse(fuente)
        for nodo in arbol.body:
            if isinstance(nodo, ast.FunctionDef) and nodo.name == "deep_parse":
                ambito: dict = {"json": json}
                exec(compile(ast.Module([nodo], []), "<deep_parse>", "exec"), ambito)
                return ambito["deep_parse"]
        raise AssertionError("deep_parse ya no existe en stock_alert_agent.py")

    def setUp(self):
        self.deep_parse = self._cargar_deep_parse()

    def test_tolera_objeto_nuevo(self):
        self.assertEqual(self.deep_parse({"sin_stock": 225}), {"sin_stock": 225})

    def test_tolera_string_historico(self):
        self.assertEqual(self.deep_parse('{"sin_stock": 225}'), {"sin_stock": 225})

    def test_tolera_doble_escapado(self):
        self.assertEqual(self.deep_parse(json.dumps('{"sin_stock": 225}')),
                         {"sin_stock": 225})

    def test_es_idempotente(self):
        una = self.deep_parse('{"sin_stock": 225}')
        self.assertEqual(self.deep_parse(una), una)


if __name__ == "__main__":
    unittest.main(verbosity=2)
