#!/usr/bin/env python3
"""
orquestador
Clasifica mensaje Telegram inbound, responde ack inmediato,
y dispara el workflow del tentáculo correcto.
"""

import os, sys, json, requests

GROQ_API_KEY = os.environ["GROQ_API_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("INPUT_CHAT_ID") or os.environ["TELEGRAM_CHAT_ID_DANIEL"]
GH_TOKEN     = os.environ["GH_TOKEN"]
GH_REPO      = os.environ["GH_REPO"]
MESSAGE      = os.environ.get("INPUT_MESSAGE", "").strip()

# Sistema prompt — extraer entre backticks del .md
_raw_system = open("agents/orquestador/system_prompt.md").read()
SYSTEM = _raw_system.split("```")[1].strip() if "```" in _raw_system else _raw_system

# ── Comandos disponibles (para el menú) ──────────────────────────────────────
MENU = (
    "Comandos disponibles:\n"
    "\n"
    "  briefing — resumen del dia (reservas, ventas, acciones)\n"
    "  reporte semanal — ventas y eventos de la semana pasada\n"
    "  reservas pendientes — alertas de reservas sin confirmar\n"
    "  wansoft — estado del sync de ventas\n"
    "  reseñas — monitoreo Google (proximamente)\n"
    "\n"
    "Pregunta lo que quieras sobre ventas, meseros, platillos,\n"
    "inventario o cualquier dato de Wansoft. 24/7.\n"
    "\n"
    "Escribe en lenguaje natural, no hace falta usar comandos exactos."
)

# Workflow a disparar por tentáculo + intent keyword
# Orden: primero intent específico, luego fallback por tentáculo
WORKFLOW_MAP: dict[str, str] = {
    # reportes — solo el documento formal
    "reportes":         "daily-briefing.yml",
    "briefing":         "daily-briefing.yml",
    "weekly":           "weekly-amalay.yml",
    "semanal":          "weekly-amalay.yml",
    "reporte semanal":  "weekly-amalay.yml",
    # ops
    "ops":              "reservas-pendientes.yml",
    "reservas":         "reservas-pendientes.yml",
    "confirmaciones":   "reservas-pendientes.yml",
    "wansoft":          "wansoft-staleness.yml",
    "sync":             "wansoft-staleness.yml",
    # kb — Wansoft query (24/7) — default para preguntas
    "kb":               "wansoft-query.yml",
    "consulta":         "wansoft-query.yml",
    "ventas":           "wansoft-query.yml",
    "vendimos":         "wansoft-query.yml",
    "vendió":           "wansoft-query.yml",
    "vendio":           "wansoft-query.yml",
    "meseros":          "wansoft-query.yml",
    "mesero":           "wansoft-query.yml",
    "platillos":        "wansoft-query.yml",
    "platillo":         "wansoft-query.yml",
    "ticket":           "wansoft-query.yml",
    "tickets":          "wansoft-query.yml",
    "propinas":         "wansoft-query.yml",
    "inventario":       "wansoft-query.yml",
    "top":              "wansoft-query.yml",
    "cuánto":           "wansoft-query.yml",
    "cuanto":           "wansoft-query.yml",
    "quién":            "wansoft-query.yml",
    "quien":            "wansoft-query.yml",
    "cómo vamos":       "wansoft-query.yml",
    "como vamos":       "wansoft-query.yml",
    "hoy":              "wansoft-query.yml",
    "ayer":             "wansoft-query.yml",
    "semana":           "wansoft-query.yml",
    # skeleton
    "reseñas":          None,
}

SKELETON_WORKFLOWS = {"gbp-monitor.yml", None}

# ── Helpers ──────────────────────────────────────────────────────────────────
def send_telegram(text: str) -> bool:
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": text},
            timeout=15,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"[orquestador] WARN send_telegram failed: {e}", file=sys.stderr)
        return False

def dispatch_workflow(workflow_file: str, inputs: dict | None = None) -> bool:
    try:
        r = requests.post(
            f"https://api.github.com/repos/{GH_REPO}/actions/workflows/{workflow_file}/dispatches",
            headers={
                "Authorization": f"Bearer {GH_TOKEN}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json={"ref": "main", "inputs": inputs or {}},
            timeout=15,
        )
        if not r.ok:
            print(f"[orquestador] GitHub dispatch {workflow_file} -> {r.status_code}: {r.text[:200]}", file=sys.stderr)
        return r.status_code in (204, 200)
    except Exception as e:
        print(f"[orquestador] dispatch_workflow exception: {e}", file=sys.stderr)
        return False

def resolve_workflow(tentacle: str, intent: str, groq_workflow: str | None) -> str | None:
    """Resuelve el workflow a disparar en orden de prioridad."""
    # 1. El que dijo Groq explícitamente
    if groq_workflow and groq_workflow not in SKELETON_WORKFLOWS:
        return groq_workflow
    # 2. Buscar por palabras clave en el intent
    intent_lower = intent.lower()
    for keyword, wf in WORKFLOW_MAP.items():
        if keyword in intent_lower and wf:
            return wf
    # 3. Fallback por tentáculo
    return WORKFLOW_MAP.get(tentacle)

# ── Manejar /start y mensajes vacíos ─────────────────────────────────────────
if not MESSAGE or MESSAGE.lower() in ("/start", "start", "hola", "hi", "hello"):
    send_telegram(
        "Hola, soy el War Room de AMALAY.\n"
        "\n" + MENU
    )
    print("[orquestador] /start o saludo — menu enviado.")
    sys.exit(0)

print(f"[orquestador] Mensaje: '{MESSAGE[:100]}'")

# ── Groq clasifica ────────────────────────────────────────────────────────────
groq_r = requests.post(
    "https://api.groq.com/openai/v1/chat/completions",
    headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
    json={
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user",   "content": MESSAGE},
        ],
        "temperature": 0.1,
        "max_tokens": 200,
    },
    timeout=30,
)
groq_r.raise_for_status()

raw = groq_r.json()["choices"][0]["message"]["content"].strip()
print(f"[orquestador] Groq raw: {raw}")

tentacle    = "desconocido"
workflow    = None
intent      = ""
priority    = "medium"

try:
    result   = json.loads(raw)
    tentacle = result.get("tentacle", "desconocido")
    intent   = result.get("intent", "")
    priority = result.get("priority", "medium")
    workflow = resolve_workflow(tentacle, intent, result.get("workflow"))
except (json.JSONDecodeError, AttributeError):
    print("[orquestador] WARN: Groq no devolvió JSON válido", file=sys.stderr)

print(f"[orquestador] tentacle={tentacle} workflow={workflow} intent={intent}")

# ── Responder a Telegram ──────────────────────────────────────────────────────
if tentacle == "desconocido" or not workflow:
    send_telegram(
        f"No identifiqué bien lo que necesitas.\n"
        f"\n{MENU}"
    )
    print("[orquestador] desconocido — menú enviado.")
    sys.exit(0)

if workflow in SKELETON_WORKFLOWS:
    send_telegram(
        f"Esa función ({tentacle}) está en construcción.\n"
        f"Pronto disponible.\n\n{MENU}"
    )
    print(f"[orquestador] Skeleton workflow para {tentacle}.")
    sys.exit(0)

# ── Ack inmediato antes de disparar ──────────────────────────────────────────
TENTACLE_EMOJI = {
    "reportes": "Reporte",
    "ops":      "Operaciones",
    "kb":       "Consulta",
    "reseñas":  "Reseñas",
}
tentacle_label = TENTACLE_EMOJI.get(tentacle, tentacle.capitalize())

send_telegram(
    f"Recibí: {MESSAGE[:60]}\n"
    f"Área: {tentacle_label}\n"
    f"Acción: {intent}\n"
    f"Procesando..."
)

# ── Disparar workflow ─────────────────────────────────────────────────────────
# Pass message + chat_id to wansoft-query so it can answer contextually
inputs = {}
if workflow == "wansoft-query.yml":
    inputs = {"message": MESSAGE[:500], "chat_id": TG_CHAT_ID}

ok = dispatch_workflow(workflow, inputs)
if ok:
    print(f"[orquestador] Dispatched {workflow} OK")
else:
    send_telegram("Error al iniciar el proceso. Intenta de nuevo en un momento.")
    print(f"[orquestador] ERROR dispatching {workflow}", file=sys.stderr)
    sys.exit(1)
