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
    """Barrido sobre TODOS los workflows, no sobre el que se arreglo primero.

    La primera version de esta prueba solo miraba precision-agentes.yml — el mismo error
    que este archivo denuncia dos clases mas arriba. La auditoria adversarial del
    2026-09-08 encontro otros tres workflows con el patron intacto: cuadre.yml,
    esquema-baseline.yml y sembrar-demo.yml.
    """

    WORKFLOWS = RAIZ.parent / "workflows"

    def test_ningun_workflow_esconde_el_fallo_detras_de_un_tee(self):
        expuestos = []
        for wf in sorted(self.WORKFLOWS.glob("*.yml")):
            texto = wf.read_text()
            tuberias = [l.strip() for l in texto.splitlines()
                        if "| tee" in l and l.lstrip().startswith(("- run:", "run:"))]
            if tuberias and "pipefail" not in texto:
                expuestos.append(f"{wf.name}: {tuberias[0][:70]}")
        self.assertEqual(
            expuestos, [],
            "`cmd | tee` reporta el codigo de salida de tee (siempre 0). Estos workflows "
            "salen verdes aunque el script reviente:\n  " + "\n  ".join(expuestos))

    @staticmethod
    def _sin_comentarios(texto):
        """Quitar los comentarios del YAML antes de buscar.

        Sin esto la prueba se cree su propia explicacion: el comentario de
        precision-agentes.yml MENCIONA `continue-on-error` para decir que NO lo lleva, y
        una busqueda en el texto crudo lo cuenta como si estuviera puesto. Es el mismo
        error que ya aparecio dos veces hoy en pruebas de este repo.
        """
        return "\n".join(l for l in texto.splitlines() if not l.lstrip().startswith("#"))

    def test_los_dos_calificadores_corren_aunque_el_primero_falle(self):
        # Al poner pipefail se introdujo lo contrario: con `bash -e`, el fallo del primer
        # calificador mataba el job y el segundo ya ni se ejecutaba. Ver y bloquear no son
        # lo mismo.
        wf = self._sin_comentarios((self.WORKFLOWS / "precision-agentes.yml").read_text())
        # Anclar en el paso que CALIFICA, no en el que corre sus pruebas: buscar el nombre
        # del script a secas engancha primero `test_resolver_predicciones.py`.
        i = wf.find("run: python .github/scripts/resolver_predicciones.py")
        j = wf.find("run: python .github/scripts/resolver_inventario.py")
        self.assertGreater(i, 0, "no encontre el paso que califica predicciones")
        self.assertGreater(j, i, "el de inventario va despues del de predicciones")
        self.assertIn("if: always()", wf[i:j],
                      "el segundo calificador tiene que correr aunque el primero falle")

    def test_pero_el_job_sigue_saliendo_rojo(self):
        # `if: always()` hace que corra; `continue-on-error` haria que el fallo se perdone,
        # que es justo lo que esta prueba existe para impedir.
        wf = self._sin_comentarios((self.WORKFLOWS / "precision-agentes.yml").read_text())
        self.assertNotIn("continue-on-error", wf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
