#!/usr/bin/env python3
"""Que avisar_si_cambio avise en las transiciones y se calle en lo demás.

La prueba que importa es `treinta_y_siete_dias_rotos`: reproduce exactamente lo que
pasó con wansoft-staleness (37 días fallando seguido) y exige UN correo, no 37.
Si esa prueba se rompe, se rompió la razón de existir del módulo.

Corre sin red: se sustituye `requests`.
"""

import sys
import types
from pathlib import Path

RUTA = Path(__file__).parent
sys.path.insert(0, str(RUTA))

correos = []          # asuntos enviados
_estado_previo = []   # lo que devolverá la consulta a agent_runs


class RespuestaFalsa:
    def __init__(self, payload=None, ok=True):
        self._payload, self.ok = payload if payload is not None else [], ok
        self.status_code, self.text = (200 if ok else 500), ""

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise Exception("error de prueba")


falso = types.ModuleType("requests")
falso.get = lambda url, **kw: RespuestaFalsa(
    [{"status": _estado_previo[0]}] if _estado_previo and _estado_previo[0] is not None else []
)


def _post(url, **kw):
    if "resend.com" in url:
        correos.append((kw.get("json") or {}).get("subject", ""))
    return RespuestaFalsa({"id": "x"})


falso.post = _post
sys.modules["requests"] = falso

import os
os.environ.setdefault("SUPABASE_URL", "https://ejemplo.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "prueba")
os.environ.setdefault("RESEND_API_KEY", "prueba")

import agent_notify

fallos = 0


def revisar(nombre, obtenido, esperado):
    global fallos
    if obtenido == esperado:
        print(f"  ok    {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n     esperaba {esperado!r}, obtuvo {obtenido!r}")


def transicion(previo, actual):
    _estado_previo.clear()
    _estado_previo.append(previo)
    return agent_notify.avisar_si_cambio("agente-prueba", actual)


print("── transiciones ──")
revisar("sano → roto avisa",            transicion("success", "error"),   "se_rompio")
revisar("roto → sano avisa",            transicion("error",   "success"), "se_recupero")
revisar("sano → sano calla",            transicion("success", "success"), "sin_cambio")
revisar("roto → roto CALLA",            transicion("error",   "error"),   "sin_cambio")
revisar("primera corrida rota avisa",   transicion(None,      "error"),   "se_rompio")
revisar("primera corrida sana calla",   transicion(None,      "success"), "sin_cambio")

print("── lo que NO es una falla ──")
revisar("no_data no es falla",  transicion("success", "no_data"), "sin_cambio")
revisar("skipped no es falla",  transicion("success", "skipped"), "sin_cambio")
revisar("warning no es falla",  transicion("success", "warning"), "sin_cambio")

print("── el caso real: 37 días rotos seguidos ──")
correos.clear()
previo = "success"
for _ in range(37):
    _estado_previo.clear()
    _estado_previo.append(previo)
    agent_notify.avisar_si_cambio("wansoft-staleness", "error")
    previo = "error"          # la corrida de hoy es el estado previo de mañana
revisar("37 días rotos = 1 solo correo", len(correos), 1)

print("── y al recuperarse, un aviso más ──")
_estado_previo.clear()
_estado_previo.append("error")
agent_notify.avisar_si_cambio("wansoft-staleness", "success")
revisar("recuperación agrega exactamente 1", len(correos), 2)

print()
if fallos:
    print(f"agent_notify: {fallos} FALLARON")
    sys.exit(1)
print("agent_notify: 12/12 ok")
