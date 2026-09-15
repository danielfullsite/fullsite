#!/usr/bin/env python3
"""Pregunta a PRODUCCION si alguna vista legible se salta el RLS. Con red.

POR QUE EXISTE, Y POR QUE NO BASTABA LO QUE YA HABIA
`test_migraciones_no_exponen_a_anon.py` fija esta misma propiedad leyendo los
archivos de `supabase/migrations/` en cada PR. Su encabezado ya declaraba su limite:
un cambio hecho a mano en el SQL Editor no pasa por ahi.

La fuga de `ocm_daily` entro justo por ese limite:

  2026-08-26 07:01:15 UTC  cerrar_vistas_ocm_fuga_cross_tenant
                           ALTER VIEW ocm_daily SET (security_invoker = on)   <- cerrada
  2026-09-09 03:53:05 UTC  ocm_daily_no_materializar
                           CREATE OR REPLACE VIEW ocm_daily AS ...            <- reabierta

La segunda no venia a tocar permisos: venia a cambiar el plan de ejecucion. Pero
`CREATE OR REPLACE VIEW` REEMPLAZA los reloptions, y lo que no se vuelve a declarar
se pierde sin aviso. Y esa migracion nunca existio como archivo — se aplico directo.
El guardian de archivos no podia verla.

De ahi la division del trabajo:
  · archivos  -> se atrapa en el PR, gratis, sin red (el guardian que ya existe)
  · base viva -> se atrapa aunque nadie haya escrito un archivo (este)

QUE REVISA
Una sola propiedad, la que importa: ninguna vista con SELECT para `anon` o
`authenticated` puede correr sin `security_invoker = on`. Sin el, la vista corre como
su dueno `postgres`, que tiene `rolbypassrls = true`, y el RLS de las tablas base no
se evalua: la vista deja de mostrar un restaurante y muestra todos.

COMO
Llama a `public.vistas_expuestas_sin_security_invoker()` por RPC con la service key.
La consulta vive en la base (migracion 20260914210200) para que el catalogo sea la
fuente, no una copia que se desactualiza.

Salida 0 = limpio. Salida 1 = hay vistas expuestas, y las nombra.
"""
from __future__ import annotations

import os
import sys

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
TIMEOUT = 20


def vistas_expuestas() -> list[dict]:
    r = requests.post(
        f"{URL}/rest/v1/rpc/vistas_expuestas_sin_security_invoker",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json"},
        json={},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    datos = r.json()
    if not isinstance(datos, list):
        raise SystemExit(f"FALLO: la RPC no devolvio una lista, sino {type(datos).__name__}")
    return datos


def main() -> int:
    try:
        hallazgos = vistas_expuestas()
    except requests.HTTPError as e:
        # Fallar cerrado: si la RPC no existe o la llave no alcanza, el guardian NO
        # puede afirmar que todo esta bien. Un guardian que se calla cuando no puede
        # mirar es peor que no tenerlo — da la senal de un sistema sano.
        print(f"FALLO: no se pudo consultar el catalogo ({e}).", file=sys.stderr)
        print("Revisar que la migracion 20260914210200 este aplicada y que la "
              "service key tenga EXECUTE.", file=sys.stderr)
        return 1

    if not hallazgos:
        print("OK — ninguna vista legible por anon/authenticated corre sin security_invoker.")
        return 0

    print("FUGA CROSS-TENANT ABIERTA — estas vistas se saltan el RLS:", file=sys.stderr)
    for h in hallazgos:
        marca = " (expone client_id)" if h.get("tiene_client_id") else ""
        print(f"  · {h.get('vista')} — legible por {h.get('rol')}{marca}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Arreglo: alter view public.<vista> set (security_invoker = on);", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
