#!/usr/bin/env python3
"""El briefing debe LLEGAR aunque Groq truene.

Regresión del 2026-08-24→26: `groq_resp.raise_for_status()` sin proteger hacía que
un 404 de Groq matara el agente entero (exit 1) y Daniel se quedaba sin briefing.
Los números ya están calculados ANTES de llamar a Groq; el modelo sólo redacta.
Perder el redactor no debe costar el reporte.

Corre sin red: se sustituyen `requests`, `client_config` y `audit_log` por dobles.
"""

import os
import runpy
import sys
import types
from pathlib import Path

GUION = Path(__file__).parent / "daily_briefing.py"

telegram_recibio = []   # cuerpos que llegaron a sendMessage
agent_runs       = []   # filas escritas en agent_runs


class RespuestaFalsa:
    def __init__(self, payload=None, status=200, texto=""):
        self._payload = payload if payload is not None else []
        self.status_code = status
        self.text = texto

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code} Client Error para la prueba")


def instalar_dobles(groq_status):
    """Deja `requests` inerte y registra a dónde se mandó qué."""
    falso = types.ModuleType("requests")

    def get(url, **kw):
        return RespuestaFalsa([])

    def post(url, **kw):
        if "api.groq.com" in url:
            return RespuestaFalsa(
                {"choices": [{"message": {"content": "BRIEFING REDACTADO"}}],
                 "usage": {"prompt_tokens": 10, "completion_tokens": 20}},
                status=groq_status,
                texto='{"error":{"code":"model_decommissioned"}}',
            )
        if "api.telegram.org" in url:
            telegram_recibio.append((kw.get("json") or {}).get("text", ""))
            return RespuestaFalsa({"ok": True})
        if "/rest/v1/agent_runs" in url:
            agent_runs.append(kw.get("json") or {})
        return RespuestaFalsa([])

    falso.get, falso.post = get, post
    falso.exceptions = types.SimpleNamespace(HTTPError=Exception)
    sys.modules["requests"] = falso

    cc = types.ModuleType("client_config")
    # Mismas llaves que el script consume de la fila de `clients`.
    cc.get_client   = lambda: {
        "id": "amalay",
        "display_name": "AMALAY",
        "reservaciones_table": "amalay_reservaciones",
    }
    cc.get_tz       = lambda c: __import__("datetime").timezone(
                          __import__("datetime").timedelta(hours=-6))
    cc.get_chat_ids = lambda c, a: ["123"]
    sys.modules["client_config"] = cc

    al = types.ModuleType("audit_log")
    class _L:
        def __init__(self, *a, **k): pass
        def __getattr__(self, _): return lambda *a, **k: None
    al.AuditLogger = _L
    sys.modules["audit_log"] = al

    for k, v in {
        "SUPABASE_URL": "https://ejemplo.invalid",
        "SUPABASE_SERVICE_KEY": "prueba",
        "GROQ_API_KEY": "prueba",
        "TELEGRAM_BOT_TOKEN": "prueba",
        "TRIGGER_TYPE": "test",
    }.items():
        os.environ.setdefault(k, v)


def correr(groq_status):
    telegram_recibio.clear()
    agent_runs.clear()
    instalar_dobles(groq_status)
    sys.path.insert(0, str(GUION.parent))
    try:
        runpy.run_path(str(GUION), run_name="__main__")
    except SystemExit:
        pass
    return list(telegram_recibio), list(agent_runs)


fallos = 0


def revisar(nombre, condicion, detalle=""):
    global fallos
    if condicion:
        print(f"  ok    {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n     {detalle}")


print("── Groq responde 404 (la regresión real) ──")
enviados, corridas = correr(404)
revisar("el briefing SÍ llegó a Telegram",
        len(enviados) == 1,
        f"se mandaron {len(enviados)} mensajes; se esperaba 1")
revisar("el mensaje dice que no fue redactado",
        enviados and "SIN REDACTAR" in enviados[0],
        f"texto: {enviados[0][:120] if enviados else '(nada)'}")
revisar("se registró como warning, no como success",
        corridas and corridas[0].get("status") == "warning",
        f"status: {corridas[0].get('status') if corridas else '(sin fila)'}")

print("── Groq responde 200 (el camino feliz sigue igual) ──")
enviados, corridas = correr(200)
revisar("llegó el texto redactado por el modelo",
        enviados and "BRIEFING REDACTADO" in enviados[0],
        f"texto: {enviados[0][:120] if enviados else '(nada)'}")
revisar("se registró como success",
        corridas and corridas[0].get("status") == "success",
        f"status: {corridas[0].get('status') if corridas else '(sin fila)'}")

print()
if fallos:
    print(f"daily_briefing fallback: {fallos} FALLARON")
    sys.exit(1)
print("daily_briefing fallback: 5/5 ok")
