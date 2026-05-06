#!/usr/bin/env python3
"""
ops/reservas-pendientes
Alerta diaria de reservaciones próximas en status pending o sin teléfono.
Silent si no hay nada que hacer.
"""

import os, sys, time, requests
from datetime import date, timedelta

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID   = os.environ["TELEGRAM_CHAT_ID_DANIEL"]
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

today    = date.today()
end_date = (today + timedelta(days=5)).isoformat()
today_s  = today.isoformat()

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

start = time.time()

def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}",
                     headers=sb_headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def sb_post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
                      headers={**sb_headers, "Content-Type": "application/json",
                                "Prefer": "return=minimal"},
                      json=data, timeout=15)
    r.raise_for_status()

def send_telegram(text):
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": chunk},
            timeout=15)
        r.raise_for_status()

# ── Fetch reservaciones próximos 5 días ──────────────────────────────────────
print(f"[reservas-pendientes] Buscando reservas {today_s} → {end_date}...")

reservas = sb_get("amalay_reservaciones", [
    ("fecha",  f"gte.{today_s}"),
    ("fecha",  f"lte.{end_date}"),
    ("status", "neq.cancelled"),
    ("order",  "fecha.asc,horario_inicio.asc"),
    ("select", "codigo_reserva,nombre,telefono,fecha,horario_inicio,guests,espacio,paquete,total,status"),
])

# Filtrar: pending O sin teléfono
alertas = [
    r for r in reservas
    if r.get("status") == "pending" or not r.get("telefono")
]

print(f"[reservas-pendientes] Total reservas próximas: {len(reservas)}, requieren atención: {len(alertas)}")

status      = "success"
output_sum  = ""
error_msg   = None
tokens_in   = 0
tokens_out  = 0

if not alertas:
    print("[reservas-pendientes] Todo OK — sin alertas. Silent success.")
    output_sum = "Sin alertas. 0 reservas requieren atención."
else:
    # Formatear datos para Groq
    items_txt = []
    for r in alertas:
        issues = []
        if r.get("status") == "pending":
            issues.append("sin confirmar")
        if not r.get("telefono"):
            issues.append("sin teléfono")
        items_txt.append(
            f"- {r['fecha']} {str(r.get('horario_inicio',''))[:5]} | "
            f"{r['codigo_reserva']} | {r['nombre']} | "
            f"{r.get('guests','')} px | {r.get('espacio','')} | "
            f"ISSUES: {', '.join(issues)}"
        )

    data_str = "\n".join(items_txt)

    SYSTEM = """Eres el agente operativo del restaurante AMALAY en Monterrey, México.
Genera un mensaje de alerta conciso para Telegram. Sin markdown complejo, texto plano.
Máximo 15 líneas. Español mexicano. Incluye código AMA-XXXX de cada reserva."""

    USER = f"""Genera alerta de reservaciones que requieren seguimiento hoy:

{data_str}

Formato:
[N reservas requieren confirmación hoy]
(lista por fecha con código, nombre, hora, problema específico)
Acción: confirmar y actualizar status en sistema"""

    print("[reservas-pendientes] Llamando Groq...")
    groq_r = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}",
                 "Content-Type": "application/json"},
        json={"model": "llama-3.3-70b-versatile",
              "messages": [{"role": "system", "content": SYSTEM},
                           {"role": "user",   "content": USER}],
              "temperature": 0.2, "max_tokens": 500},
        timeout=30)
    groq_r.raise_for_status()
    data    = groq_r.json()
    mensaje = data["choices"][0]["message"]["content"]
    usage   = data.get("usage", {})
    tokens_in  = usage.get("prompt_tokens", 0)
    tokens_out = usage.get("completion_tokens", 0)

    print(f"[reservas-pendientes] Groq OK — {tokens_in}in/{tokens_out}out")

    send_telegram(mensaje)
    print("[reservas-pendientes] Telegram OK")

    output_sum = f"Alerta enviada. {len(alertas)} reservas requieren atención. Tokens: {tokens_in}in/{tokens_out}out"

# ── Log ──────────────────────────────────────────────────────────────────────
duration_ms = int((time.time() - start) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id":       "reservas-pendientes",
        "trigger_type":   TRIGGER_TYPE,
        "status":         status,
        "duration_ms":    duration_ms,
        "output_summary": output_sum,
        "error_message":  error_msg,
        "tokens_in":      tokens_in,
        "tokens_out":     tokens_out,
        "tentacle":       "ops",
    })
    print("[reservas-pendientes] agent_runs logged OK")
except Exception as e:
    print(f"[reservas-pendientes] WARN: log failed: {e}", file=sys.stderr)

print(f"[reservas-pendientes] Done {duration_ms}ms. {output_sum}")
