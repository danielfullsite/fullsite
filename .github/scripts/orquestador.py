#!/usr/bin/env python3
"""
orquestador — skeleton
Clasifica mensaje Telegram y dispara workflow del tentáculo correcto via GitHub Actions API.
"""

import os, sys, json, requests

GROQ_API_KEY = os.environ["GROQ_API_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID   = os.environ.get("INPUT_CHAT_ID") or os.environ["TELEGRAM_CHAT_ID_DANIEL"]
GH_TOKEN     = os.environ["GH_TOKEN"]
GH_REPO      = os.environ["GH_REPO"]
MESSAGE      = os.environ.get("INPUT_MESSAGE", "")

# System prompt del orquestador
SYSTEM = open("agents/orquestador/system_prompt.md").read()
# Extraer solo el contenido entre los backticks del system_prompt.md
if "```" in SYSTEM:
    SYSTEM = SYSTEM.split("```")[1].strip()

WORKFLOW_MAP = {
    "reportes":  "daily-briefing.yml",
    "ops":       "reservas-pendientes.yml",
    "kb":        "kb-query.yml",        # skeleton
    "reseñas":   "gbp-monitor.yml",     # skeleton
}

def send_telegram(text, chat_id=TG_CHAT_ID):
    requests.post(
        f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": chat_id, "text": text},
        timeout=15)

def dispatch_workflow(workflow_file, inputs=None):
    """Dispara un workflow via GitHub Actions API."""
    r = requests.post(
        f"https://api.github.com/repos/{GH_REPO}/actions/workflows/{workflow_file}/dispatches",
        headers={
            "Authorization": f"Bearer {GH_TOKEN}",
            "Accept": "application/vnd.github+json",
        },
        json={"ref": "main", "inputs": inputs or {}},
        timeout=15)
    return r.status_code in (204, 200)

if not MESSAGE:
    print("[orquestador] No hay mensaje. Skeleton test OK.")
    sys.exit(0)

print(f"[orquestador] Clasificando: '{MESSAGE[:80]}...'")

# ── Groq clasifica intención ──────────────────────────────────────────────────
groq_r = requests.post(
    "https://api.groq.com/openai/v1/chat/completions",
    headers={"Authorization": f"Bearer {GROQ_API_KEY}",
             "Content-Type": "application/json"},
    json={"model": "llama-3.3-70b-versatile",
          "messages": [{"role": "system", "content": SYSTEM},
                       {"role": "user",   "content": MESSAGE}],
          "temperature": 0.1, "max_tokens": 200},
    timeout=30)
groq_r.raise_for_status()

raw    = groq_r.json()["choices"][0]["message"]["content"].strip()
print(f"[orquestador] Groq response: {raw}")

try:
    result   = json.loads(raw)
    tentacle = result.get("tentacle", "desconocido")
    workflow = result.get("workflow") or WORKFLOW_MAP.get(tentacle)
    intent   = result.get("intent", "")
except json.JSONDecodeError:
    tentacle = "desconocido"
    workflow = None
    intent   = "parse error"
    print(f"[orquestador] WARN: no se pudo parsear JSON de Groq", file=sys.stderr)

print(f"[orquestador] Tentáculo: {tentacle} | Workflow: {workflow} | Intención: {intent}")

# ── Despachar ─────────────────────────────────────────────────────────────────
if tentacle == "desconocido" or not workflow:
    send_telegram(
        "No entendi bien tu consulta. Puedo ayudarte con:\n"
        "- Reportes del dia o semanales\n"
        "- Reservaciones pendientes\n"
        "- Consultas de historial de clientes\n"
        "Intenta ser mas especifico.")
elif workflow in ("kb-query.yml", "gbp-monitor.yml"):
    send_telegram(f"Esa funcion ({tentacle}) esta en construccion. Pronto disponible.")
else:
    ok = dispatch_workflow(workflow)
    if ok:
        send_telegram(f"Procesando... ({intent}). Te aviso cuando termine.")
        print(f"[orquestador] Dispatched {workflow} OK")
    else:
        send_telegram("Hubo un error al procesar tu solicitud. Intenta de nuevo.")
        print(f"[orquestador] ERROR dispatching {workflow}", file=sys.stderr)
        sys.exit(1)
