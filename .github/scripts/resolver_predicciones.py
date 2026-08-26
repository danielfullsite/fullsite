#!/usr/bin/env python3
"""Califica las predicciones de los agentes contra lo que realmente pasó.

POR QUÉ EXISTE
`resolve_event()` estaba escrita en agent_common.py desde hace meses y NO LA LLAMABA
NADIE. Por eso, al 2026-08-26, la base tenía:

    agent_events   12 filas, CERO calificadas
    agent_insights 2,387 filas, `confidence` NULL en TODAS

O sea: no había un número de precisión bajo ni alto. No había denominador. "Llegar al
98%" no se podía ni empezar a medir, porque nada comparaba lo predicho con lo ocurrido.

Este script cierra ese bucle para `close-predictor`, que es el agente más medible: dice
en cuánto va a cerrar el día, y a la medianoche se sabe el número real.

CÓMO CALIFICA
Cada evento trae su propia `tolerancia_pct` en la evidencia, escrita en el momento de
predecir. Se lee de ahí a propósito: si la tolerancia viviera en este script, se podría
aflojar después de ver los resultados y convertir un fallo en acierto. La regla la fija
quien predice, no quien califica.

    error = |predicho - real| / real
    error <= tolerancia  →  'correct'
    error >  tolerancia  →  'false_positive'

NO califica el día en curso. Sólo días ya cerrados; si no, castigaría una predicción
hecha a las 2pm contra las ventas de las 2pm.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID (o ALL para todos)
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_common import sb_get, sb_patch, log_run  # noqa: E402

TOLERANCIA_POR_OMISION = 10.0   # % — sólo si el evento no trae la suya
DIAS_ATRAS = 7                  # ventana de días cerrados a calificar


def dias_cerrados(dias: int = DIAS_ATRAS) -> list[str]:
    """Días de negocio ya terminados, del más viejo al más nuevo. Hoy NO entra."""
    hoy_mx = (datetime.now(timezone.utc) + timedelta(hours=-6)).date()
    return [str(hoy_mx - timedelta(days=d)) for d in range(dias, 0, -1)]


def ventas_reales(client_id: str, fechas: list[str]) -> dict[str, float]:
    """Venta real por día, desde ops_daily_history (la fuente viva desde #134)."""
    if not fechas:
        return {}
    lista = ",".join(f'"{f}"' for f in fechas)
    filas = sb_get(
        "ops_daily_history",
        f"client_id=eq.{client_id}&fecha=in.({lista})&select=fecha,ventas_dia",
    )
    return {r["fecha"]: float(r["ventas_dia"] or 0) for r in filas if r.get("ventas_dia")}


def evidencia_de(evento: dict) -> dict:
    import json
    ev = evento.get("evidence")
    if isinstance(ev, str):
        try:
            return json.loads(ev)
        except (ValueError, TypeError):
            return {}
    return ev or {}


def calificar(client_id: str) -> tuple[int, int, int]:
    """Devuelve (calificados, aciertos, sin_dato_real)."""
    fechas = dias_cerrados()
    reales = ventas_reales(client_id, fechas)

    abiertos = sb_get(
        "agent_events",
        f"client_id=eq.{client_id}&agent_id=eq.close-predictor&status=eq.new"
        f"&type=eq.forecast&select=id,evidence,created_at&limit=500",
    )

    calificados = aciertos = sin_dato = 0
    for ev in abiertos:
        e = evidencia_de(ev)
        predicho = e.get("prediccion")
        fecha = e.get("fecha_objetivo")
        if predicho is None or not fecha:
            continue                      # evento viejo, sin forma falsificable
        if fecha not in reales:
            sin_dato += 1                 # el día no cerró, o no hubo ventas: no se juzga
            continue

        real = reales[fecha]
        if real <= 0:
            sin_dato += 1
            continue

        tolerancia = float(e.get("tolerancia_pct", TOLERANCIA_POR_OMISION))
        error_pct = abs(float(predicho) - real) / real * 100.0
        resultado = "correct" if error_pct <= tolerancia else "false_positive"

        e["venta_real"] = round(real, 2)
        e["error_pct"] = round(error_pct, 2)
        e["calificado_el"] = datetime.now(timezone.utc).isoformat()

        import json
        try:
            sb_patch(
                "agent_events",
                f"id=eq.{ev['id']}",
                {"status": "resolved", "outcome": resultado, "evidence": json.dumps(e)},
            )
        except Exception as err:
            print(f"[resolver] no se pudo calificar {ev['id']}: {err}", file=sys.stderr)
            continue

        calificados += 1
        aciertos += resultado == "correct"
        print(f"[resolver] {fecha} predicho ${predicho:,.0f} vs real ${real:,.0f} "
              f"→ {error_pct:.1f}% de error → {resultado}")

    return calificados, aciertos, sin_dato


def tenants() -> list[str]:
    pedido = (os.environ.get("CLIENT_ID") or "").strip()
    if pedido and pedido.upper() != "ALL":
        return [pedido]
    filas = sb_get("clients", "active=eq.true&select=id")
    return sorted(r["id"] for r in filas if r.get("id"))


def main() -> int:
    inicio = time.time()
    total = total_ok = total_sin = 0
    try:
        for cid in tenants():
            os.environ["CLIENT_ID"] = cid    # para que log_run etiquete bien
            c, ok, sin = calificar(cid)
            total += c
            total_ok += ok
            total_sin += sin
            if c:
                print(f"[resolver] {cid}: {ok}/{c} acertadas ({100.0*ok/c:.0f}%)")
    except Exception as e:
        ms = int((time.time() - inicio) * 1000)
        print(f"[resolver] ERROR: {e}", file=sys.stderr)
        log_run("prediction-resolver", "error", ms, error_message=str(e), tentacle="meta")
        return 1

    ms = int((time.time() - inicio) * 1000)
    if total == 0:
        # No es error: puede que no haya predicciones pendientes. Pero tiene que verse,
        # porque "0 calificadas" y "todo bien" se leen igual en un log silencioso.
        resumen = f"nada que calificar ({total_sin} sin venta real todavía)"
        print(f"[resolver] {resumen}")
        log_run("prediction-resolver", "no_data", ms, skip_reason=resumen,
                data_status="no_data", tentacle="meta")
        return 0

    precision = 100.0 * total_ok / total
    resumen = f"{total_ok}/{total} acertadas — precisión {precision:.1f}%"
    print(f"[resolver] {resumen}")
    log_run("prediction-resolver", "success", ms, output_summary=resumen,
            rows_processed=total, data_status="ok", tentacle="meta")
    return 0


if __name__ == "__main__":
    sys.exit(main())
