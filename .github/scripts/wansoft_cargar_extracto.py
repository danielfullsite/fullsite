#!/usr/bin/env python3
"""Carga un extracto de Wansoft a `wansoft_daily` y `ops_daily`. Una sola vez, a mano.

NO SUSTITUYE A `wansoft_backfill.py`
Aquel re-scrapea fechas historicas y esta bien escrito (usa ISO, los endpoints correctos),
pero cuelga de `wansoft_login()` y Cloudflare Turnstile lo bloquea. Ademas escribe solo
`wansoft_daily` — por eso `ops_daily` quedo 10 dias mas atrasada que ella. Este script
cubre las dos tablas y no necesita autenticarse: recibe lo ya extraido.

POR QUÉ EXISTE
Wansoft puso Cloudflare Turnstile en su login, así que ningún scraper puede autenticarse
solo. La única forma de traer datos es que una persona entre al portal y la sesión se use
desde ahí. Este script es la otra mitad de esa maniobra: toma lo que se extrajo y lo
aterriza en las dos tablas, con las mismas llaves que usa el pipeline normal.

EL HUECO QUE CIERRA (medido el 2026-09-09)
    wansoft_daily          → hasta 2026-07-20   (51 días sin datos)
    ops_daily cierre_wansoft → hasta 2026-07-10 (59 días) ← ES LA QUE LEE EL CONTRATO

Las dos importan, y no es la misma fecha: `ops_daily_history` —el contrato que leen todos
los agentes— une `ops_daily`, no `wansoft_daily`. Cargar sólo la primera dejaría a los
agentes igual de ciegos.

EL DÍA EN CURSO NO SE CARGA
Un día a medias entra como una caída de ventas del 90% y envenena la línea base de todos
los detectores. Se salta, y se dice cuál se saltó.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ARCHIVO, DRY_RUN (default "true")
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_common import log_run  # noqa: E402

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
_H = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

CLIENT = "amalay"
LOCATION = "amalay-spgg"          # 01 - Café Amalay - Plaza Duendes (subsidiaryId 6043)
SOURCE = "wansoft"

# Columnas que van a cada tabla. Explícitas a propósito: si el extracto trae un campo de
# más, se ignora en vez de reventar el INSERT con una columna que no existe.
COLS_WANSOFT = [
    "fecha", "ventas_dia", "ventas_brutas", "descuentos", "devoluciones", "efectivo",
    "tarjeta", "tickets_count", "mesas_atendidas", "ordenes_llevar", "personas_restaurant",
    "cuentas_restaurant", "ticket_promedio_restaurant", "propinas_total",
    "chilaquiles_total", "half_half_total", "meseros", "platillos_top",
    "ventas_por_grupo", "pago_metodos",
]
COLS_OPS = [
    "fecha", "ventas_dia", "ventas_brutas", "descuentos", "devoluciones", "efectivo",
    "tarjeta", "tickets_count", "mesas_atendidas", "personas_restaurant",
    "ticket_promedio_restaurant", "propinas_total", "meseros", "platillos_top",
    "ventas_por_grupo", "pago_metodos",
]


def upsert(tabla: str, filas: list[dict], on_conflict: str) -> None:
    """UPSERT en lotes. Levanta con el cuerpo del error — un backfill que falla callado
    dejaría el hueco abierto y la corrida en verde."""
    if not filas:
        return
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{tabla}",
        headers={**_H, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        params={"on_conflict": on_conflict},
        json=filas, timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"{tabla}: HTTP {r.status_code} — {(r.text or '')[:400]}")


def main() -> int:
    inicio = time.time()
    archivo = os.environ.get("ARCHIVO", "data/backfill/amalay-wansoft-2026-07-11_2026-09-09.json")
    dry = (os.environ.get("DRY_RUN", "true").strip().lower() != "false")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[backfill] ERROR: falta SUPABASE_URL o SUPABASE_SERVICE_KEY", file=sys.stderr)
        return 1
    try:
        with open(archivo, encoding="utf-8") as fh:
            datos = json.load(fh)
    except (OSError, ValueError) as e:
        print(f"[backfill] ERROR: no se pudo leer {archivo} — {e}", file=sys.stderr)
        return 1

    hoy = datetime.now(timezone.utc).date()
    completos, saltados = [], []
    for d in datos:
        f = date.fromisoformat(d["fecha"])
        (saltados if f >= hoy else completos).append(d)

    if saltados:
        print(f"[backfill] se saltan {len(saltados)} día(s) en curso o futuros: "
              f"{', '.join(x['fecha'] for x in saltados)}")

    if not completos:
        print("[backfill] ERROR: no quedó ningún día completo que cargar", file=sys.stderr)
        return 1

    ventas = sum(float(d.get("ventas_dia") or 0) for d in completos)
    print(f"[backfill] {len(completos)} días — {completos[0]['fecha']} → {completos[-1]['fecha']}"
          f" — ${ventas:,.2f} en ventas")

    filas_w = [{**{c: d.get(c) for c in COLS_WANSOFT},
                "client_slug": CLIENT, "report_type": "cierre", "location_id": LOCATION,
                "updated_at": datetime.now(timezone.utc).isoformat()} for d in completos]
    filas_o = [{**{c: d.get(c) for c in COLS_OPS},
                "client_id": CLIENT, "record_type": "cierre_wansoft",
                "source_system": SOURCE,
                "rows_aggregated": d.get("tickets_count") or 0,
                "data_freshness": f"{d['fecha']}T23:59:59+00:00"} for d in completos]

    if dry:
        print("[backfill] DRY_RUN — no se escribe nada. Ejemplo de fila:")
        print(f"    wansoft_daily: {json.dumps({k: v for k, v in list(filas_w[0].items())[:8]}, ensure_ascii=False)}")
        print(f"    ops_daily:     {json.dumps({k: v for k, v in list(filas_o[0].items())[:8]}, ensure_ascii=False)}")
        print(f"[backfill] cargaría {len(filas_w)} filas en wansoft_daily y {len(filas_o)} en ops_daily")
        return 0

    try:
        upsert("wansoft_daily", filas_w, "client_slug,fecha,report_type")
        print(f"[backfill] wansoft_daily: {len(filas_w)} filas")
        upsert("ops_daily", filas_o, "client_id,fecha,record_type")
        print(f"[backfill] ops_daily: {len(filas_o)} filas")
    except Exception as e:
        ms = int((time.time() - inicio) * 1000)
        print(f"[backfill] ERROR: {e}", file=sys.stderr)
        log_run("wansoft-backfill", "error", ms, error_message=str(e)[:500],
                data_status="error", tentacle="ops")
        return 1

    ms = int((time.time() - inicio) * 1000)
    resumen = (f"{len(completos)} días cargados ({completos[0]['fecha']} → "
               f"{completos[-1]['fecha']}), ${ventas:,.2f}")
    log_run("wansoft-backfill", "success", ms, output_summary=resumen,
            rows_processed=len(completos), data_status="ok", tentacle="ops")
    print(f"[backfill] {resumen}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
