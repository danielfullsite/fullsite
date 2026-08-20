#!/usr/bin/env python3
"""
Fraud Watcher — alerta de fraude NEAR-REAL-TIME (OP-43).

Complementa al antifraud_agent.py (batch semanal, patrones estadísticos con baseline).
Este vigila el stream de eventos DUROS y discretos que el POS ya audita en
`pos_audit_log` y avisa el MISMO día (cron cada ~30 min en horario de servicio),
en vez de esperar al reporte del viernes.

Eventos que vigila (marcadores filosos, no heurísticos):
  · skimming_suspect        — total declarado ≠ suma de items (dinero desviado)
  · market_adjust_below_role — ajuste de stock/merma por un rol < gerente (OP-39)
  · recipe_sync_below_role   — edición de receta/costo por un rol < gerente (OP-39)

NO vigila cancelaciones/descuentos: son comunes y necesitan baseline → siguen en el
batch semanal (analyze_cancellations en antifraud_agent.py).

Modo SOMBRA (grace): por default SOLO registra en agent_events y en el log; NO manda
Telegram. Se activa el alertado real con FRAUD_WATCHER_ALERT='true' (una vez validado
con tráfico real que no hay falsos positivos). Igual que el patrón grace→strict de los
gates de seguridad.

Watermark: lee el último run exitoso de agent_runs y solo procesa eventos posteriores.
El batch semanal es el backstop que garantiza cobertura total (por si un evento cae en
la ventana de segundos de un run).
"""
import os
import sys
import time
from datetime import datetime, timedelta

from agent_common import sb_get, log_run, log_event, send_telegram
from client_config import get_client, get_tz, get_chat_ids, get_all_chat_ids

AGENT_ID = "fraud-watcher"
CLIENT = get_client()
CLIENT_ID = CLIENT["id"]
MX_TZ = get_tz(CLIENT)
ALERT_ENABLED = os.environ.get("FRAUD_WATCHER_ALERT", "").lower() == "true"

# Marcadores duros → cuánto pesan
SEVERITY = {
    "skimming_suspect": "high",
    "market_adjust_below_role": "medium",
    "recipe_sync_below_role": "medium",
}
LABELS = {
    "skimming_suspect": "Skimming (total ≠ suma de items)",
    "market_adjust_below_role": "Ajuste de stock por rol < gerente",
    "recipe_sync_below_role": "Edición de receta por rol < gerente",
}
ACTIONS_IN = "(" + ",".join(SEVERITY.keys()) + ")"

# Ventana de respaldo si no hay run previo (primer arranque)
FALLBACK_LOOKBACK_MIN = 60


def get_watermark() -> str:
    """created_at del último run exitoso; si no hay, ahora − FALLBACK_LOOKBACK_MIN."""
    fallback = (datetime.now(MX_TZ) - timedelta(minutes=FALLBACK_LOOKBACK_MIN)).isoformat()
    try:
        rows = sb_get(
            "agent_runs",
            f"agent_id=eq.{AGENT_ID}&status=eq.success"
            "&order=created_at.desc&limit=1&select=created_at",
        )
        if rows and rows[0].get("created_at"):
            return rows[0]["created_at"]
    except Exception as e:
        print(f"[{AGENT_ID}] watermark fetch failed ({e}); usando fallback", file=sys.stderr)
    return fallback


def get_new_events(since: str) -> list:
    """Eventos de fraude en pos_audit_log posteriores al watermark, scopeados al tenant."""
    return sb_get(
        "pos_audit_log",
        f"client_id=eq.{CLIENT_ID}"
        f"&created_at=gt.{since}"
        f"&action=in.{ACTIONS_IN}"
        "&order=created_at.asc&limit=200"
        "&select=id,order_id,action,actor,mesa,details,created_at",
    )


def event_value_mxn(ev: dict) -> float:
    """MXN en riesgo del evento (para el bucle de valor). Skimming trae la diferencia;
    los below_role no tienen monto directo → 0."""
    d = ev.get("details") or {}
    for k in ("diff_cents", "faltante_cents"):
        if isinstance(d.get(k), (int, float)):
            return round(abs(d[k]) / 100.0, 2)
    for k in ("diff_mxn", "faltante_mxn"):
        if isinstance(d.get(k), (int, float)):
            return round(abs(d[k]), 2)
    return 0.0


def format_alert(events: list, total_value: float) -> str:
    lines = [
        "🚨 <b>Alerta de fraude (tiempo real)</b>",
        f"{CLIENT.get('name', CLIENT_ID)} · {len(events)} evento(s)",
    ]
    if total_value > 0:
        lines.append(f"En riesgo: <b>${total_value:,.2f}</b> MXN")
    lines.append("")
    for ev in events[:15]:
        ts = str(ev.get("created_at", ""))[11:16]
        actor = ev.get("actor") or "—"
        mesa = f" · mesa {ev['mesa']}" if ev.get("mesa") else ""
        label = LABELS.get(ev["action"], ev["action"])
        val = event_value_mxn(ev)
        val_str = f" (${val:,.2f})" if val > 0 else ""
        lines.append(f"• {ts} <b>{label}</b>{val_str}\n   {actor}{mesa}")
    if len(events) > 15:
        lines.append(f"… y {len(events) - 15} más")
    return "\n".join(lines)


def main():
    start = time.time()
    watermark = get_watermark()

    try:
        events = get_new_events(watermark)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        print(f"[{AGENT_ID}] fetch de eventos falló: {e}", file=sys.stderr)
        log_run(AGENT_ID, "error", elapsed, error_message=str(e)[:300], tentacle="ops")
        return

    if not events:
        elapsed = int((time.time() - start) * 1000)
        print(f"[{AGENT_ID}] sin eventos nuevos desde {watermark}")
        log_run(AGENT_ID, "success", elapsed, rows_processed=0, tentacle="ops")
        return

    # Bucle de valor: cada evento se registra en agent_events (aunque estemos en sombra).
    total_value = 0.0
    for ev in events:
        val = event_value_mxn(ev)
        total_value += val
        log_event(
            agent_id=AGENT_ID,
            event_type="fraud",
            title=f"{LABELS.get(ev['action'], ev['action'])} — {ev.get('actor') or '—'}",
            severity=SEVERITY.get(ev["action"], "medium"),
            estimated_value=val,
            evidence={
                "action": ev["action"], "order_id": ev.get("order_id"),
                "mesa": ev.get("mesa"), "actor": ev.get("actor"),
                "at": ev.get("created_at"), "details": ev.get("details"),
            },
            explanation=LABELS.get(ev["action"], ev["action"]),
            client_id=CLIENT_ID,
        )

    msg = format_alert(events, total_value)

    if ALERT_ENABLED:
        chats = get_chat_ids(CLIENT, "intraday") or get_all_chat_ids(CLIENT)
        sent = 0
        for chat in chats:
            if send_telegram(chat, msg):
                sent += 1
        print(f"[{AGENT_ID}] {len(events)} eventos → alerta enviada a {sent} chat(s)")
    else:
        # Modo sombra: se registró en agent_events pero NO se molesta a nadie.
        print(f"[{AGENT_ID}] SOMBRA (FRAUD_WATCHER_ALERT!=true) — {len(events)} "
              f"eventos registrados, NO se envió Telegram. Mensaje que se enviaría:\n{msg}")

    elapsed = int((time.time() - start) * 1000)
    log_run(AGENT_ID, "success", elapsed, rows_processed=len(events), tentacle="ops")


if __name__ == "__main__":
    main()
