"""
Shared utilities for Fullsite AI agents.
Replaces per-agent copies of sb_get, log_run, send_telegram.
Enforces truthful reporting: no silent success on empty/stale data.
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone, timedelta

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
_sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


# ─── Supabase helpers ─────────────────────────────────────────

def sb_get(table: str, params: str) -> list:
    """Fetch from Supabase. Raises on HTTP error — never silently returns []."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers=_sb_headers, timeout=15,
    )
    r.raise_for_status()
    return r.json()


def sb_post(table: str, data: dict, upsert: bool = False) -> dict:
    """Insert/upsert to Supabase. Returns response JSON."""
    headers = {**_sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"}
    if upsert:
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=headers, json=data, timeout=15,
    )
    r.raise_for_status()
    return {}


def sb_patch(table: str, params: str, data: dict) -> None:
    """Update rows in Supabase."""
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers={**_sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=data, timeout=15,
    )
    r.raise_for_status()


# ─── Data freshness check ─────────────────────────────────────

def check_freshness(rows: list, date_field: str = "fecha", max_stale_hours: int = 48) -> dict:
    """
    Check if data is fresh enough to analyze.
    Returns: { fresh: bool, latest: str, hours_stale: float, status: str }
    """
    if not rows:
        return {"fresh": False, "latest": None, "hours_stale": None, "status": "no_data"}

    dates = []
    for r in rows:
        val = r.get(date_field) or r.get("updated_at") or r.get("created_at")
        if val:
            dates.append(val)

    if not dates:
        return {"fresh": False, "latest": None, "hours_stale": None, "status": "no_data"}

    latest = max(dates)
    # Parse — handle both date and datetime formats
    try:
        if "T" in str(latest) or " " in str(latest):
            dt = datetime.fromisoformat(str(latest).replace("Z", "+00:00").replace(" ", "T"))
        else:
            dt = datetime.fromisoformat(str(latest) + "T23:59:59+00:00")
    except Exception:
        return {"fresh": False, "latest": str(latest), "hours_stale": None, "status": "parse_error"}

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    status = "ok" if hours <= max_stale_hours else "stale_data"
    return {"fresh": hours <= max_stale_hours, "latest": str(latest), "hours_stale": round(hours, 1), "status": status}


# ─── Agent run logging (truthful) ─────────────────────────────

def log_run(
    agent_id: str,
    status: str,  # "success" | "error" | "skipped" | "no_data" | "stale_data"
    duration_ms: int,
    output_summary: str = "",
    error_message: str = "",
    tentacle: str = "ops",
    input_freshness: str = None,
    rows_processed: int = 0,
    skip_reason: str = None,
    data_status: str = "ok",  # "ok" | "no_data" | "stale_data" | "partial" | "error"
    tokens_in: int = None,
    tokens_out: int = None,
):
    """Log agent run to agent_runs with truthful status reporting."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print(f"[{agent_id}] Cannot log run: Supabase not configured", file=sys.stderr)
        return

    row = {
        "agent_id": agent_id,
        "trigger_type": os.environ.get("TRIGGER_TYPE", "schedule"),
        "status": status,
        "duration_ms": duration_ms,
        "output_summary": output_summary[:500] if output_summary else "",
        "error_message": error_message[:500] if error_message else "",
        "tentacle": tentacle,
        "input_freshness": input_freshness,
        "rows_processed": rows_processed,
        "skip_reason": skip_reason,
        "data_status": data_status,
    }
    if tokens_in is not None:
        row["tokens_in"] = tokens_in
    if tokens_out is not None:
        row["tokens_out"] = tokens_out

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**_sb_headers, "Content-Type": "application/json"},
            json=row, timeout=10,
        )
    except Exception as e:
        # Log failure must NOT be swallowed — print to stderr so CI shows it
        print(f"[{agent_id}] FAILED to log run: {e}", file=sys.stderr)


# ─── Structured insight creation ──────────────────────────────

def create_insight(
    agent_id: str,
    category: str,  # "inventory" | "costs" | "operations" | "sales" | "staffing" | "fraud" | "config"
    severity: str,  # "critical" | "high" | "medium" | "info"
    title: str,
    summary: str = None,
    evidence: dict = None,
    recommended_action: str = None,
    deep_link: str = None,
    data_freshness: str = None,
    confidence: float = None,
    client_id: str = None,
):
    """Create a structured insight in agent_insights table.
    client_id DEBE identificar al tenant. Si no se pasa, se toma de CLIENT_ID en el
    entorno — NUNCA se asume 'amalay' (evita estampar insights de un cliente en otro)."""
    client_id = client_id or os.environ.get("CLIENT_ID")
    if not client_id:
        print(f"[{agent_id}] create_insight sin client_id — se omite (aislamiento tenant)", file=sys.stderr)
        return
    row = {
        "agent_id": agent_id,
        "client_id": client_id,
        "category": category,
        "severity": severity,
        "title": title,
        "summary": summary,
        "evidence": json.dumps(evidence) if evidence else None,
        "recommended_action": recommended_action,
        "deep_link": deep_link,
        "data_freshness": data_freshness,
        "confidence": confidence,
    }

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_insights",
            headers={**_sb_headers, "Content-Type": "application/json"},
            json=row, timeout=10,
        )
    except Exception as e:
        print(f"[{agent_id}] FAILED to create insight: {e}", file=sys.stderr)


# ─── Telegram helper ──────────────────────────────────────────

def send_telegram(chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    """Send message to Telegram. Returns True on success."""
    if not TELEGRAM_TOKEN:
        print("[telegram] No TELEGRAM_BOT_TOKEN set", file=sys.stderr)
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": chat_id, "text": text[:4096], "parse_mode": parse_mode},
            timeout=15,
        )
        return r.ok
    except Exception as e:
        print(f"[telegram] Send failed: {e}", file=sys.stderr)
        return False


# ─── Bucle de valor: agent_events ─────────────────────────────
# La auditoría de IA (2026-08-19) encontró que agent_events NUNCA se escribe → no se
# puede medir si un agente acierta, ni priorizar, ni podar falsos positivos. Este helper
# cierra el WRITE del bucle: cada hallazgo se registra con un estimated_value y queda
# 'open' hasta que se resuelva (resolve_event). Aislado del POS — solo analítica.

def log_event(
    agent_id: str,
    event_type: str,          # "fraud" | "waste" | "upsell" | "forecast" | "anomaly" | ...
    title: str,
    severity: str = "info",   # "critical" | "high" | "medium" | "info"
    estimated_value: float = 0.0,   # MXN que este hallazgo vale (ahorro/riesgo/oportunidad)
    confidence: float = None,       # 0..1
    evidence: dict = None,
    explanation: str = None,
    suggested_action: str = None,
    expires_at: str = None,         # ISO — cuándo deja de ser relevante
    client_id: str = None,
):
    """Registra un evento medible en agent_events (status='new', outcome=None).

    Tenant-aware como create_insight: client_id del entorno, NUNCA asume 'amalay'.

    OJO CON `status`: la tabla acepta solo 'new' | 'acknowledged' | 'resolved'. Esta
    funcion escribia 'open', que NO existe, asi que TODOS sus INSERT se rechazaban —
    y como el except solo imprime a stderr, fallaba en silencio. antifraud-agent y
    fraud_watcher llevaban meses reportando al vacio. Verificado el 2026-08-26: cero
    filas suyas en agent_events."""
    client_id = client_id or os.environ.get("CLIENT_ID")
    if not client_id:
        print(f"[{agent_id}] log_event sin client_id — se omite (aislamiento tenant)", file=sys.stderr)
        return
    row = {
        "agent_id": agent_id, "client_id": client_id, "type": event_type,
        "title": title, "severity": severity, "status": "new", "outcome": None,
        "estimated_value": estimated_value, "confidence": confidence,
        "evidence": json.dumps(evidence) if evidence else None,
        "explanation": explanation, "suggested_action": suggested_action,
        "expires_at": expires_at,
    }
    # Un NULL explicito ANULA el default de la columna.
    #
    # `confidence`, `explanation`, `suggested_action` y `evidence` son NOT NULL CON
    # DEFAULT en agent_events (0.80, '', '', '{}'). Mandarlos en None no los deja en su
    # default: los manda como NULL y PostgREST responde 23502.
    #
    # Se descubrio el 2026-08-26 cuando el agente de cuadre encontro 25 descuadres reales
    # en boruca y NINGUNO se pudo guardar. Solo se vio porque este mismo modulo acababa de
    # aprender a reportar el rechazo en vez de tragarselo — antes habria sido silencio.
    #
    # `outcome` es la excepcion: es NULLABLE a proposito, y su NULL significa "todavia no
    # calificado". Se conserva.
    row = {k: v for k, v in row.items() if v is not None or k == "outcome"}
    # Se revisa r.ok, no solo la excepcion.
    #
    # Esta es la razon por la que el fallo duro meses sin que nadie lo viera: PostgREST
    # devolvia 400 por el CHECK de agent_id, y un 400 NO es una excepcion para
    # `requests` — el except ni se activaba. El INSERT se perdia y la funcion regresaba
    # como si todo hubiera salido bien.
    #
    # Un error de registro no debe tumbar al agente, pero SI tiene que verse en el log
    # de la corrida. Silencio y exito no pueden verse igual.
    try:
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_events",
            headers={**_sb_headers, "Content-Type": "application/json"},
            json=row, timeout=10,
        )
        if not r.ok:
            print(
                f"[{agent_id}] ERROR: agent_events rechazo el evento — HTTP {r.status_code}: "
                f"{r.text[:300]}",
                file=sys.stderr,
            )
            return False
        return True
    except Exception as e:
        print(f"[{agent_id}] ERROR: no se pudo registrar el evento: {e}", file=sys.stderr)
        return False


def resolve_event(event_id: str, outcome: str, actual_value: float = None):
    """Cierra el bucle: marca como resulto un evento.

    `outcome` solo admite 'correct' | 'false_positive' — es un CHECK de la tabla. El
    docstring anterior decia 'confirmed' y 'expired', que NO existen; cualquiera que
    los hubiera usado habria fallado en silencio."""
    data = {"status": "resolved", "outcome": outcome}
    if actual_value is not None:
        data["estimated_value"] = actual_value
    try:
        sb_patch("agent_events", f"id=eq.{event_id}", data)
    except Exception as e:
        print(f"[resolve_event] FAILED for {event_id}: {e}", file=sys.stderr)


# ─── Contexto de monitoreo compartido ─────────────────────────
# La auditoría encontró que 22/24 agentes alertan FUERA de contexto (ej. "ventas 95%
# abajo" a las 9am con 2 órdenes). Este primitivo da el contexto operativo para que un
# agente sepa si SIQUIERA debe evaluar una métrica ahora. Regla: antes de comparar
# contra un baseline de día completo, checar `should_evaluate_daily_totals`.

MX_OFFSET = timedelta(hours=-6)  # Monterrey = UTC-6 (sin DST desde 2023)

# % ACUMULADO aproximado de ventas del día por hora local (perfil desayuno/brunch tipo
# AMALAY, front-loaded). Default — debería venir del histórico del cliente cuando exista.
_DAY_PROGRESS = {
    0:0.0, 1:0.0, 2:0.0, 3:0.0, 4:0.0, 5:0.0, 6:0.0, 7:0.03, 8:0.10, 9:0.20,
    10:0.33, 11:0.47, 12:0.60, 13:0.71, 14:0.80, 15:0.86, 16:0.90, 17:0.93,
    18:0.95, 19:0.97, 20:0.985, 21:0.995, 22:1.0, 23:1.0,
}

def _day_phase(h: int) -> str:
    if h < 7:  return "pre_service"
    if h < 11: return "opening"
    if h < 16: return "peak"
    if h < 19: return "afternoon"
    if h < 22: return "dinner"
    return "closing"

def get_monitoring_context(client_id: str = None, eval_threshold: float = 0.70) -> dict:
    """Contexto operativo para decidir si evaluar una métrica ahora. Nunca lanza —
    si la lectura falla, degrada a solo-tiempo (source='degraded'). Aislado del POS."""
    client_id = client_id or os.environ.get("CLIENT_ID")
    now_mx = datetime.now(timezone.utc) + MX_OFFSET
    h = now_mx.hour
    progress = _DAY_PROGRESS.get(h, 1.0)
    ctx = {
        "now_mx": now_mx.isoformat(),
        "hour": h,
        "weekday": now_mx.weekday(),           # 0=lunes
        "day_phase": _day_phase(h),
        "expected_progress_pct": progress,     # % del día que ya debió pasar
        "should_evaluate_daily_totals": progress >= eval_threshold,
        "orders_today": None,
        "sales_today": None,
        "minutes_since_last_order": None,
        "source": "degraded",
    }
    if not client_id or not SUPABASE_URL or not SUPABASE_KEY:
        return ctx
    try:
        # inicio del día local en UTC (MX 00:00 = UTC 06:00)
        day_start_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
        day_start_utc = (day_start_mx - MX_OFFSET).replace(tzinfo=timezone.utc)
        rows = sb_get("pos_orders",
            f"client_id=eq.{client_id}&created_at=gte.{day_start_utc.isoformat()}"
            f"&status=neq.cancelada&select=total,created_at,status")
        ctx["orders_today"] = len(rows)
        ctx["sales_today"] = round(sum(float(r.get("total") or 0) for r in rows), 2)
        if rows:
            last = max(str(r.get("created_at")) for r in rows if r.get("created_at"))
            try:
                ldt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                if ldt.tzinfo is None: ldt = ldt.replace(tzinfo=timezone.utc)
                ctx["minutes_since_last_order"] = round((datetime.now(timezone.utc) - ldt).total_seconds() / 60, 1)
            except Exception:
                pass
        ctx["source"] = "pos_orders"
    except Exception as e:
        print(f"[monitoring-context] read failed (degraded): {e}", file=sys.stderr)
    return ctx
