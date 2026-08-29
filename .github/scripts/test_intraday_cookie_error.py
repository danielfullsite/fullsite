#!/usr/bin/env python3
"""Que el error de intraday-sales diga la causa REAL, no la del respaldo.

Cuando la cookie de Wansoft vence, el script cae al login con contraseña. Ese
login lo bloquea Cloudflare Turnstile desde julio de 2026, así que también falla
— y el mensaje que quedaba registrado era el del respaldo:

    "Wansoft login failed. URL: https://www.wansoft.net/Wansoft.Web/"

Verificado en agent_runs el 2026-08-26: ~15 corridas al día con ese texto, ni una
mencionando la cookie. Cualquiera que depure eso persigue la contraseña.

Corre sin red.
"""

import os
import sys
import types
from pathlib import Path

RUTA = Path(__file__).parent
sys.path.insert(0, str(RUTA))

for k, v in {"SUPABASE_URL": "https://ejemplo.invalid",
             "SUPABASE_SERVICE_KEY": "prueba",
             "WANSOFT_USER": "u", "WANSOFT_PASS": "p",
             "TELEGRAM_BOT_TOKEN": "prueba", "CLIENT_ID": "amalay"}.items():
    os.environ.setdefault(k, v)


class RespuestaFalsa:
    # El respaldo se considera fallido cuando la URL final no es el Dashboard:
    # se simula que Wansoft devuelve al login, que es lo que hace con Turnstile.
    url = "https://www.wansoft.net/Wansoft.Web/"

    def json(self):
        return {}

    def raise_for_status(self):
        pass


class SesionFalsa:
    def get(self, *a, **k):
        return RespuestaFalsa()

    def post(self, *a, **k):
        return RespuestaFalsa()


falso = types.ModuleType("requests")
falso.Session = SesionFalsa
falso.get = lambda *a, **k: RespuestaFalsa()
falso.post = lambda *a, **k: RespuestaFalsa()
falso.exceptions = types.SimpleNamespace(HTTPError=Exception)
sys.modules["requests"] = falso

cc = types.ModuleType("client_config")
cc.get_client = lambda: {"id": "amalay", "display_name": "AMALAY"}
cc.get_tz = lambda c: __import__("datetime").timezone(
    __import__("datetime").timedelta(hours=-6))
cc.get_chat_ids = lambda c, a: ["1"]
cc.is_mesero = lambda c: False
cc.is_market = lambda c: False
cc.get_wansoft_creds = lambda c: {"user": "u", "password": "p", "subsidiary_id": "1"}
sys.modules["client_config"] = cc

ac = types.ModuleType("agent_common")
ac.sb_get = lambda *a, **k: []
ac.log_run = lambda **k: None
ac.check_freshness = lambda *a, **k: None
ac.create_insight = lambda **k: None
ac.send_telegram = lambda *a, **k: True
sys.modules["agent_common"] = ac


class CookieVencida(Exception):
    pass


wa = types.ModuleType("wansoft_auth")
wa.WansoftAuthExpired = CookieVencida
_modo = {"falla": True}


def _get_session(client_id="amalay", validate=True):
    if _modo["falla"]:
        raise CookieVencida("wansoft_cookies.aspxauth is empty")
    return SesionFalsa()


wa.get_session = _get_session
sys.modules["wansoft_auth"] = wa

import intraday_sales as ins

fallos = 0


def revisar(nombre, condicion, detalle=""):
    global fallos
    if condicion:
        print(f"  ok    {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n     {detalle}")


print("── cookie vencida y respaldo bloqueado ──")
_modo["falla"] = True
try:
    ins.wansoft_session()
    revisar("levanta excepción", False, "no levantó nada")
    mensaje = ""
except Exception as e:
    mensaje = str(e)
    revisar("levanta excepción", True)

revisar("nombra la cookie como causa",
        "cookie" in mensaje.lower(), f"mensaje: {mensaje}")
revisar("no se queda sólo con el error del respaldo",
        mensaje.strip() != "Wansoft login failed. URL: https://www.wansoft.net/Wansoft.Web/",
        f"mensaje: {mensaje}")
revisar("dice qué hacer (el comando de refresco)",
        "wansoft_auth.py store" in mensaje, f"mensaje: {mensaje}")
revisar("menciona que el respaldo tampoco entra",
        "turnstile" in mensaje.lower(), f"mensaje: {mensaje}")

print("── con cookie viva no se toca el respaldo ──")
_modo["falla"] = False
try:
    s = ins.wansoft_session()
    revisar("devuelve la sesión del relevo", isinstance(s, SesionFalsa))
except Exception as e:
    revisar("devuelve la sesión del relevo", False, f"levantó: {e}")

print()
if fallos:
    print(f"intraday cookie error: {fallos} FALLARON")
    sys.exit(1)
print("intraday cookie error: 6/6 ok")
