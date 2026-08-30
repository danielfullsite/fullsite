#!/usr/bin/env python3
"""Pruebas de `wansoft_data.data` — sin red.

El fondo del asunto: `wansoft_data.data` es `jsonb`. Cuando un scraper mandaba
`json.dumps([...])`, PostgREST recibia un STRING de Python y Postgres lo guardaba
como un ESCALAR JSON de tipo string — no como objeto ni como arreglo. La fila se
veia bien en el dashboard (los lectores desenvuelven el string) pero era
inconsultable desde SQL:

    select jsonb_typeof(data), count(*) from wansoft_data group by 1;
    -- string | 670     ← el bug
    -- array  |  32

O sea: el dato entraba, pero `data->>'campo'` devolvia NULL y
`jsonb_array_elements(data)` reventaba.

DIFERENCIA CON agent_results: aqui el arreglo es una forma LEGITIMA. De las 670
filas string, 497 desenvuelven a arreglo y 173 a objeto, y ya habia 32 arreglos
nativos (`platillos_full`, que intraday_sales.py siempre escribio bien). Estas
pruebas exigen "objeto U arreglo", nunca "objeto".

Lo que fijan, en orden de importancia:

  1. Que NINGUN escritor vuelva a envolver `data`. Se rechazan las dos formas que
     producen el bug: `json.dumps(x)` y `json.dumps(x) if not isinstance(x, str)
     else x`. La segunda parece una guarda pero guarda al reves: deja pasar el
     string tal cual, que es exactamente lo que Postgres guarda como escalar.

  2. Que el escaneo no pase en vacio. Una prueba que busca un patron y no
     encuentra ningun payload aprueba sin haber revisado nada. Por eso se exige
     un minimo de payloads hallados: si alguien renombra la llave, esto truena.

  3. Que `a_jsonb` —el ayudante que reemplazo a las guardas de isinstance y a los
     `default=str`— siga normalizando, y que las 5 copias no se separen entre si.

LIMITE CONOCIDO DEL ESCANEO: se reconoce el payload por su firma de fila
(`data_key` + `data` en el mismo dict literal). Un escritor que arme la fila con
`**spread` —hoy intraday_sales.py y agents/wansoft/backfill_platillos_full.py, los
dos correctos— no es visible para el AST y no queda cubierto.
"""
from __future__ import annotations

import ast
import json
import unittest
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
RAIZ = SCRIPTS.parents[1]
IGNORADOS = {"node_modules", ".git", "venv", ".venv", "graphify-out"}

# Al 2026-08-26 hay 14 payloads de wansoft_data en el repo. El numero es un piso,
# no un objetivo: si se agregan escritores debe subir, nunca bajar en silencio.
MINIMO_PAYLOADS = 14

# Los archivos que definen `a_jsonb`. Son copias porque estos scripts son
# ejecutables sueltos sin modulo comun; la prueba de abajo evita que se separen.
COPIAS_DE_AYUDANTE = [
    "wansoft_inventory_scrape.py",
    "wansoft_inventory_sync.py",
    "wansoft_mega_scraper.py",
    "wansoft_recipe_scraper.py",
    "wansoft_subproduct_scraper.py",
]


def _fuentes_python():
    for ruta in sorted(RAIZ.rglob("*.py")):
        if IGNORADOS & set(ruta.parts) or ruta.name.startswith("test_"):
            continue
        yield ruta


def _es_json_dumps(nodo: ast.AST) -> bool:
    return (isinstance(nodo, ast.Call)
            and isinstance(nodo.func, ast.Attribute)
            and nodo.func.attr == "dumps"
            and isinstance(nodo.func.value, ast.Name)
            and nodo.func.value.id == "json")


def _envuelve(nodo: ast.AST) -> bool:
    """¿Este valor de `data` termina como texto en el cuerpo HTTP?

    Dos formas, las dos con el mismo resultado en Postgres:
      · json.dumps(x)                                   → escalar string
      · json.dumps(x) if not isinstance(x, str) else x  → escalar string por las dos ramas
    """
    if _es_json_dumps(nodo):
        return True
    if isinstance(nodo, ast.IfExp):
        return _es_json_dumps(nodo.body) or _es_json_dumps(nodo.orelse)
    return False


def _payloads_de_wansoft_data():
    """Devuelve (archivo, linea, nodo_valor_de_data) por cada payload de wansoft_data.

    Se identifica el payload por su firma de fila: un dict literal que lleva a la
    vez las llaves "data_key" y "data". `data_key` existe en una sola tabla del
    esquema (la PK de wansoft_data es client_id+fecha+data_key), asi que la firma
    no colisiona con escrituras a otras tablas. Se busca asi, y no por nombre de
    archivo, para que un scraper NUEVO quede cubierto el dia que lo agreguen sin
    tener que acordarse de esta prueba.
    """
    hallazgos = []
    for ruta in _fuentes_python():
        try:
            arbol = ast.parse(ruta.read_text(encoding="utf-8"))
        except SyntaxError as e:  # un archivo roto es falla de otra prueba, no de esta
            raise AssertionError(f"{ruta} no parsea: {e}") from e
        for nodo in ast.walk(arbol):
            if not isinstance(nodo, ast.Dict):
                continue
            llaves = {k.value for k in nodo.keys
                      if isinstance(k, ast.Constant) and isinstance(k.value, str)}
            if not {"data_key", "data"} <= llaves:
                continue
            for k, v in zip(nodo.keys, nodo.values):
                if isinstance(k, ast.Constant) and k.value == "data":
                    hallazgos.append((ruta.relative_to(RAIZ).as_posix(), v.lineno, v))
    return hallazgos


def flecha_texto(data, llave):
    """Modela `data->>'llave'` de Postgres sobre un valor jsonb ya decodificado.

    En Postgres el operador ->> con una llave de texto devuelve NULL sobre
    cualquier cosa que no sea un objeto: no hay llaves que buscar dentro de un
    string ni dentro de un arreglo. Eso es lo que hacia invisible el dato. Se
    modela aqui para que la prueba hable de la consulta real y no de la forma del
    objeto en Python.
    """
    if not isinstance(data, dict):
        return None
    valor = data.get(llave)
    if valor is None:
        return None
    return valor if isinstance(valor, str) else json.dumps(valor)


def longitud_arreglo(data):
    """Modela `jsonb_array_length(data)`: sirve sobre arreglos, falla sobre lo demas."""
    if not isinstance(data, list):
        raise TypeError("cannot get array length of a non-array")
    return len(data)


class EscritoresNoEnvuelvenData(unittest.TestCase):

    def test_ningun_payload_de_wansoft_data_envuelve_data(self):
        culpables = [f"{arch}:{ln}" for arch, ln, nodo in _payloads_de_wansoft_data()
                     if _envuelve(nodo)]
        self.assertEqual(
            culpables, [],
            "Estos escritores mandan `data` como texto. La columna es jsonb: hay que "
            "mandar el objeto o el arreglo directo, si no Postgres guarda un escalar "
            "de tipo string y el dato queda inconsultable desde SQL.\n  "
            + "\n  ".join(culpables))

    def test_el_escaneo_no_pasa_en_vacio(self):
        # Sin esto, renombrar la llave "data" volveria la prueba de arriba trivialmente
        # verde: cero payloads hallados, cero culpables, aprobado sin revisar nada.
        hallados = _payloads_de_wansoft_data()
        self.assertGreaterEqual(
            len(hallados), MINIMO_PAYLOADS,
            f"Solo se hallaron {len(hallados)} payloads de wansoft_data y se esperaban "
            f"al menos {MINIMO_PAYLOADS}. O el escaneo dejo de reconocer la firma "
            f"(data_key + data), o se borraron escritores.")


class SemanticaJsonbDePostgrest(unittest.TestCase):
    """Que quede escrito que las dos formas NO son equivalentes."""

    OBJETO = {"total": 1250.5, "items": 47, "almacenes": ["cocina", "barra"]}
    ARREGLO = [{"nombre": "Chilaquiles", "cantidad": 12, "total": 2400.0},
               {"nombre": "Smarty", "cantidad": 1, "total": 35.0}]

    def _viaje_redondo(self, valor_de_data):
        """Simula el viaje: payload -> cuerpo HTTP -> jsonb decodificado."""
        cuerpo = json.dumps({"data_key": "food_cost_browser", "data": valor_de_data})
        return json.loads(cuerpo)["data"]

    def test_objeto_directo_queda_como_objeto_y_es_consultable(self):
        data = self._viaje_redondo(self.OBJETO)
        self.assertIsInstance(data, dict, "jsonb_typeof deberia ser 'object'")
        self.assertEqual(flecha_texto(data, "items"), "47")

    def test_arreglo_directo_queda_como_arreglo_y_es_recorrible(self):
        # 32 filas de hoy son arreglo nativo y 497 de las string desenvuelven a
        # arreglo. El arreglo es una forma legitima, no un caso a "arreglar".
        data = self._viaje_redondo(self.ARREGLO)
        self.assertIsInstance(data, list, "jsonb_typeof deberia ser 'array'")
        self.assertEqual(longitud_arreglo(data), 2)

    def test_json_dumps_queda_como_escalar_string_e_inconsultable(self):
        # Este es el bug, congelado. Si algun dia esta prueba falla es que cambio la
        # semantica de PostgREST y habria que revisar todo lo demas.
        data = self._viaje_redondo(json.dumps(self.OBJETO))
        self.assertIsInstance(data, str, "asi entraba el dato: como string")
        self.assertIsNone(flecha_texto(data, "items"),
                          "data->>'items' devolvia NULL: el dato era inconsultable")

    def test_json_dumps_de_un_arreglo_tampoco_se_puede_recorrer(self):
        data = self._viaje_redondo(json.dumps(self.ARREGLO))
        self.assertIsInstance(data, str)
        with self.assertRaises(TypeError):
            longitud_arreglo(data)

    def test_la_guarda_de_isinstance_no_arreglaba_nada(self):
        # `json.dumps(x) if not isinstance(x, str) else x` guarda al reves: cuando
        # x YA es texto lo deja pasar tal cual, y PostgREST lo guarda igual de mal.
        ya_serializado = json.dumps(self.OBJETO)
        por_la_rama_else = self._viaje_redondo(ya_serializado)
        por_la_rama_dumps = self._viaje_redondo(json.dumps(self.OBJETO))
        self.assertEqual(por_la_rama_else, por_la_rama_dumps,
                         "las dos ramas producian el mismo escalar string")


class AyudanteAJsonb(unittest.TestCase):
    """`a_jsonb` es lo que reemplazo a las guardas de isinstance y a los default=str."""

    @staticmethod
    def _cargar(nombre_archivo):
        """Saca a_jsonb del fuente real, sin importar el modulo.

        Estos scripts corren trabajo de verdad al importarse (leen env, pegan a la
        red). Se extrae la funcion del AST y se ejecuta aislada, para que la prueba
        hable del codigo que se despliega y no de una copia.
        """
        arbol = ast.parse((SCRIPTS / nombre_archivo).read_text(encoding="utf-8"))
        for nodo in arbol.body:
            if isinstance(nodo, ast.FunctionDef) and nodo.name == "a_jsonb":
                ambito: dict = {"json": json}
                exec(compile(ast.Module([nodo], []), "<a_jsonb>", "exec"), ambito)
                return ambito["a_jsonb"]
        raise AssertionError(f"a_jsonb ya no existe en {nombre_archivo}")

    def setUp(self):
        self.a_jsonb = self._cargar("wansoft_mega_scraper.py")

    def test_el_objeto_pasa_intacto(self):
        self.assertEqual(self.a_jsonb({"total": 47}), {"total": 47})

    def test_el_arreglo_pasa_intacto(self):
        self.assertEqual(self.a_jsonb([{"nombre": "x"}]), [{"nombre": "x"}])

    def test_desenvuelve_el_texto_que_llega_ya_serializado(self):
        # Esta es la rama que la guarda de isinstance dejaba pasar tal cual.
        self.assertEqual(self.a_jsonb('[{"nombre": "x"}]'), [{"nombre": "x"}])

    def test_nunca_devuelve_texto_para_un_contenedor(self):
        # La propiedad que importa: pase lo que pase, lo que sale no es un str, o
        # sea que PostgREST no puede guardar un escalar de tipo string.
        for entrada in ({"a": 1}, [1, 2], '{"a": 1}', '[1, 2]'):
            self.assertNotIsInstance(self.a_jsonb(entrada), str, f"entrada: {entrada!r}")

    def test_tolera_fechas_como_traia_el_default_str(self):
        # Ocupa el lugar del `default=str` de los json.dumps originales.
        salida = self.a_jsonb({"fecha": date(2026, 8, 26)})
        self.assertEqual(salida, {"fecha": "2026-08-26"})

    def test_es_idempotente(self):
        una = self.a_jsonb('[{"nombre": "x"}]')
        self.assertEqual(self.a_jsonb(una), una)

    def test_las_copias_no_se_separaron(self):
        # Son 5 copias del mismo ayudante en 5 ejecutables sueltos. Si alguien
        # arregla una y no las otras, esto lo dice.
        cuerpos = {}
        for archivo in COPIAS_DE_AYUDANTE:
            arbol = ast.parse((SCRIPTS / archivo).read_text(encoding="utf-8"))
            defs = [n for n in arbol.body
                    if isinstance(n, ast.FunctionDef) and n.name == "a_jsonb"]
            self.assertEqual(len(defs), 1, f"{archivo}: se esperaba un solo a_jsonb")
            cuerpos[archivo] = ast.dump(defs[0])
        distintos = set(cuerpos.values())
        self.assertEqual(len(distintos), 1,
                         "las copias de a_jsonb se separaron: "
                         + ", ".join(sorted(cuerpos)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
