#!/usr/bin/env python3
"""Califica solo los hallazgos del agente de inventario contra lo que realmente pasó.

POR QUÉ EXISTE
`resolver_predicciones.py` cerró el bucle para `close-predictor`, el agente más medible.
Este hace lo mismo para inventario, que al 2026-08-30 es el ÚNICO flujo con datos
frescos: `pos_inventory_movements` trae 2,568 filas con 4 días de atraso, mientras que
las ventas llevan 41–51 días muertas. Calificar contra ventas hoy sería calificar contra
nada.

Sin esto, la única forma de saber si el agente acertó era que una persona apretara un
botón — y al 2026-08-30 llevaba 0 de 27 hallazgos evaluados. Aquí no hace falta nadie: la
bodega contesta sola.

CÓMO CALIFICA
La regla NO vive en este archivo. Viene dentro de cada evento, en
`evidence.verificacion`, escrita por el agente en el momento de afirmar:

    { metodo, ventana_dias, ingrediente_ids, desmiente: [...], confirma: [...] }

Es a propósito, y es el mismo principio de `resolver_predicciones.py`: si la regla
viviera aquí, se podría aflojar después de ver los resultados y convertir un fallo en
acierto. Quien afirma fija la vara; quien califica sólo la aplica.

Para "no hay stock de X", dentro de la ventana:
    salió X    → sí había      → false_positive
    entró X    → sí faltaba    → correct
    se ajustó  → el dato mal   → false_positive
    nada       → indeterminado → NO se califica

Ese último caso es deliberado. Empujar lo indeterminado a un bucket infla la precisión
con casos que nadie verificó, que es exactamente el vicio que hace que un número de
accuracy no signifique nada.

NO califica hallazgos dentro de su ventana todavía: un `out_of_stock` de hace una hora no
ha tenido tiempo de ser desmentido.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID (o ALL)
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_common import sb_get, sb_patch, log_run  # noqa: E402

TIPOS_CALIFICABLES = ("out_of_stock",)
DIAS_ATRAS_MAX = 30  # no re-mirar historia vieja en cada corrida


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def eventos_pendientes(client_id: str) -> list[dict]:
    """Hallazgos de inventario sin veredicto, de los tipos que sabemos calificar."""
    desde = _iso(datetime.now(timezone.utc) - timedelta(days=DIAS_ATRAS_MAX))
    tipos = ",".join(TIPOS_CALIFICABLES)
    q = (
        f"client_id=eq.{client_id}&agent_id=eq.inventory&outcome=is.null"
        f"&type=in.({tipos})&created_at=gte.{desde}"
        f"&select=id,type,evidence,created_at&limit=200"
    )
    return sb_get("agent_events", q) or []


def movimientos(client_id: str, ingrediente_ids: list[str], desde: str, hasta: str) -> list[dict]:
    """Movimientos de esos ingredientes dentro de la ventana."""
    if not ingrediente_ids:
        return []
    # PostgREST: in.(a,b,c). Los ids de ingrediente son texto sin comas en este esquema.
    ids = ",".join(str(i) for i in ingrediente_ids if i is not None)
    if not ids:
        return []
    q = (
        f"client_id=eq.{client_id}&ingredient_id=in.({ids})"
        f"&created_at=gte.{desde}&created_at=lte.{hasta}"
        f"&select=ingredient_id,movement_type,quantity,created_at&limit=1000"
    )
    return sb_get("pos_inventory_movements", q) or []


def calificar(evento: dict, client_id: str) -> tuple[str | None, str]:
    """Devuelve (outcome, motivo). outcome None = indeterminado, no se escribe."""
    ev = evento.get("evidence") or {}
    spec = ev.get("verificacion") or {}

    if spec.get("metodo") != "pos_inventory_movements":
        return None, "el evento no trae regla de verificación (emitido antes del 2026-08-30)"

    ids = spec.get("ingrediente_ids") or []
    desmiente = set(spec.get("desmiente") or [])
    confirma = set(spec.get("confirma") or [])
    ventana = int(spec.get("ventana_dias") or 3)

    creado = datetime.fromisoformat(str(evento["created_at"]).replace("Z", "+00:00"))
    cierre = creado + timedelta(days=ventana)
    if datetime.now(timezone.utc) < cierre:
        return None, f"la ventana de {ventana} días aún no cierra"

    movs = movimientos(client_id, ids, _iso(creado), _iso(cierre))
    if not movs:
        # Nadie tocó esos ingredientes. No hay evidencia ni a favor ni en contra.
        return None, "sin movimientos en la ventana — indeterminado"

    tipos = {m.get("movement_type") for m in movs}

    # Una salida DESMIENTE con más fuerza de lo que una entrada confirma: si el sistema
    # dijo "no hay" y aun así se descontó, había. Se evalúa primero a propósito.
    if tipos & desmiente:
        cuales = sorted(tipos & desmiente)
        return "false_positive", f"hubo {', '.join(cuales)} de un ingrediente reportado sin stock"

    if tipos & confirma:
        cuales = sorted(tipos & confirma)
        return "correct", f"se resurtió ({', '.join(cuales)}), consistente con que faltaba"

    return None, f"movimientos no concluyentes: {sorted(tipos)}"


def main() -> int:
    t0 = datetime.now(timezone.utc)
    client = os.environ.get("CLIENT_ID", "amalay")
    clientes = [client] if client != "ALL" else [
        c["id"] for c in (sb_get("clients", "active=eq.true&select=id") or [])
    ]

    calificados = indeterminados = 0
    for cid in clientes:
        for evento in eventos_pendientes(cid):
            outcome, motivo = calificar(evento, cid)
            if outcome is None:
                indeterminados += 1
                print(f"  [-] {evento['id'][:8]} {evento['type']}: {motivo}")
                continue
            sb_patch("agent_events", f"id=eq.{evento['id']}", {"outcome": outcome})
            calificados += 1
            print(f"  [{'✓' if outcome == 'correct' else '✗'}] {evento['id'][:8]} {evento['type']}: {motivo}")

    resumen = f"{calificados} calificados, {indeterminados} indeterminados"
    print(f"\n{resumen}")
    log_run(
        agent_id="resolver-inventario",
        status="success",
        duration_ms=int((datetime.now(timezone.utc) - t0).total_seconds() * 1000),
        output_summary=resumen,
        rows_processed=calificados,
        tentacle="ops",
        # Que quede claro que no calificar NO es un fallo: es la respuesta honesta
        # cuando la bodega no se movió.
        skip_reason=f"{indeterminados} sin evidencia en su ventana" if indeterminados else None,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
