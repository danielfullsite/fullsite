#!/usr/bin/env python3
"""El `+` de una URL es un espacio, y por eso el sistema no sabia si acertaba.

`datetime.isoformat()` termina en `+00:00`. Metido a mano en un query string de PostgREST,
ese `+` se decodifica como ESPACIO: el servidor recibe

    created_at=gte.2026-08-09T13:12:57.754113 00:00

Postgres no puede castear eso a timestamptz y responde 400.

QUE COSTO ESTO, medido el 2026-09-08 en produccion:

  · resolver_inventario.py llevaba 7 dias devolviendo 400 y NUNCA ha calificado un solo
    hallazgo — cero eventos de inventory con outcome en toda la base. La excepcion mata el
    primer tenant del ciclo, asi que ninguno se procesa.
  · GitHub Actions marcaba verde los 7 dias, porque el paso era `python ... | tee` sin
    pipefail y el codigo de salida que se reporta es el de `tee`.

Y lo mas importante para no repetirlo: el arreglo YA EXISTIA. table_time_agent.py hace
`.replace("+00:00", "Z")` desde antes. Alguien encontro este bug, lo corrigio en un solo
archivo y no barrio el resto. Esta prueba es el barrido.

Los valores que van en un dict a `params=` de requests NO tienen el problema: requests los
codifica. Solo importan los que se concatenan a mano en la URL.
"""
from __future__ import annotations

import pathlib
import re
import sys
import unittest
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))


class ElFormatoQueSeMandaEnLaUrl(unittest.TestCase):
    def test_iso_del_resolver_no_lleva_mas(self):
        from resolver_inventario import _iso
        salida = _iso(datetime(2026, 8, 9, 13, 12, 57, 754113, tzinfo=timezone.utc))
        self.assertNotIn("+", salida, "el + se decodifica como espacio y Postgres devuelve 400")
        self.assertTrue(salida.endswith("Z"), salida)

    def test_sigue_siendo_la_misma_hora(self):
        from resolver_inventario import _iso
        # Arreglar la codificacion no puede cambiar el instante.
        t = datetime(2026, 8, 9, 7, 12, 57, tzinfo=timezone.utc)
        self.assertEqual(_iso(t), "2026-08-09T07:12:57Z")


class BarridoDelPatronEnTodosLosScripts(unittest.TestCase):
    """Ningun script puede concatenar a mano un isoformat con zona dentro de una URL."""

    # Solo el que arma la URL COMPLETA a mano: la f-string trae `clave=` o `&`, senal de
    # que es un query string y no el valor de un dict. Un dict que va a `params=` de
    # requests esta a salvo — requests codifica el `+` como %2B. Comprobado el 2026-09-08:
    # pos_daily_aggregator, speed_of_service, daily_briefing, pos_intraday_snapshot y
    # hermes_agent pasan sus filtros por `params=`.
    CONCATENA = re.compile(r'f"[^"]*[=&][^"]*(?:gte|lte|lt|gt)\.\{([^}]+)\}')

    def test_ningun_isoformat_crudo_en_una_url(self):
        ofensores = []
        for archivo in sorted(RAIZ.glob("*.py")):
            if archivo.name.startswith("test_"):
                continue
            for n, linea in enumerate(archivo.read_text().splitlines(), 1):
                for m in self.CONCATENA.finditer(linea):
                    expr = m.group(1)
                    # Un isoformat() sin el replace, pegado crudo a la URL.
                    if "isoformat()" in expr and "replace" not in expr:
                        # `.date().isoformat()` da 2026-09-01, sin zona: no tiene el problema.
                        if ".date()" in expr:
                            continue
                        ofensores.append(f"{archivo.name}:{n}  {linea.strip()[:90]}")
        self.assertEqual(
            ofensores, [],
            "isoformat() con zona concatenado a una URL de PostgREST:\n  " + "\n  ".join(ofensores))


class ElVerdeNoPuedeMentir(unittest.TestCase):
    def test_el_workflow_de_precision_usa_pipefail(self):
        wf = (RAIZ.parent / "workflows" / "precision-agentes.yml").read_text()
        self.assertIn("pipefail", wf,
                      "sin pipefail, `python ... | tee` reporta el exito de tee y esconde el fallo")

    def test_ningun_paso_que_califica_esconde_su_codigo_de_salida(self):
        wf = (RAIZ.parent / "workflows" / "precision-agentes.yml").read_text()
        # Si algun dia se quita el pipefail del job, que esta prueba lo cache.
        tuberias = [l.strip() for l in wf.splitlines() if "resolver_" in l and "|" in l]
        if tuberias:
            self.assertIn("shell: bash -euo pipefail", wf,
                          f"hay pasos con tuberia sin pipefail declarado: {tuberias}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
