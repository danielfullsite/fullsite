#!/usr/bin/env python3
"""Que el upsert de stock-alert apunte a la llave única y no cruce tenants.

Reproduce los dos defectos que tenía, verificados contra producción el 2026-08-26:

  · `resolution=merge-duplicates` sin `on_conflict` → 400 todos los días desde al
    menos el 2026-08-22 (cuatro corridas consecutivas en agent_runs).
  · El PATCH de respaldo filtraba por agent_id y fecha pero NO por client_id, así
    que con dos restaurantes en la base uno sobrescribía al otro.

Corre sin red: se sustituye `requests` y se observan las llamadas reales que hace
el script al ejecutarse.
"""

import os
import runpy
import sys
import types
from pathlib import Path

RUTA = Path(__file__).parent
llamadas = []          # (metodo, url, cuerpo)


class RespuestaFalsa:
    def __init__(self, payload=None, status=200, texto=""):
        self._payload = payload if payload is not None else []
        self.status_code, self.text = status, texto
        self.ok = status < 400

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise Exception(f"{self.status_code} para la prueba")


def instalar_dobles(status_post=201):
    llamadas.clear()
    falso = types.ModuleType("requests")

    def get(url, **kw):
        llamadas.append(("GET", url, None))
        return RespuestaFalsa([])

    def post(url, **kw):
        llamadas.append(("POST", url, kw.get("json")))
        if "agent_results" in url:
            return RespuestaFalsa(status=status_post,
                                  texto='{"code":"42P10","message":"prueba"}')
        return RespuestaFalsa()

    def patch(url, **kw):
        llamadas.append(("PATCH", url, kw.get("json")))
        return RespuestaFalsa()

    falso.get, falso.post, falso.patch = get, post, patch
    falso.HTTPError = type("HTTPError", (Exception,), {})
    falso.exceptions = types.SimpleNamespace(HTTPError=falso.HTTPError)
    sys.modules["requests"] = falso

    cc = types.ModuleType("client_config")
    cc.get_client = lambda: {"id": "amalay", "display_name": "AMALAY"}
    cc.get_tz = lambda c: __import__("datetime").timezone(
        __import__("datetime").timedelta(hours=-6))
    cc.get_chat_ids = lambda c, a: ["1"]
    sys.modules["client_config"] = cc

    # Inventario mínimo para que el script llegue hasta el upsert: un producto
    # sin existencias (qty 0 con mínimo 5) dispara la rama de alerta, que es la
    # que escribe en agent_results.
    inventario = [{"codigo": "A1", "producto": "Limón", "almacen": "Cocina",
                   "inv_final_qty": 0, "critico": True}]
    config = [{"codigo": "A1", "almacen": "cocina", "minimo": 5, "maximo": 20}]

    ac = types.ModuleType("agent_common")
    ac.sb_get = lambda t, q: [{"data": inventario if "inventory" in q else config}]
    ac.log_run = lambda **kw: None
    ac.check_freshness = lambda *a, **k: None
    ac.create_insight = lambda **kw: None
    sys.modules["agent_common"] = ac

    for k, v in {"SUPABASE_URL": "https://ejemplo.invalid",
                 "SUPABASE_SERVICE_KEY": "prueba",
                 "TELEGRAM_BOT_TOKEN": "prueba",
                 "CLIENT_ID": "amalay"}.items():
        os.environ.setdefault(k, v)


def correr(status_post=201):
    instalar_dobles(status_post)
    sys.path.insert(0, str(RUTA))
    try:
        runpy.run_path(str(RUTA / "stock_alert_agent.py"), run_name="__main__")
    except SystemExit:
        pass
    return list(llamadas)


fallos = 0


def revisar(nombre, condicion, detalle=""):
    global fallos
    if condicion:
        print(f"  ok    {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n     {detalle}")


def upserts(hechas):
    return [(m, u, c) for m, u, c in hechas
            if "agent_results" in u and m in ("POST", "PATCH")]


print("── el POST apunta a la llave única ──")
hechas = correr(201)
posts = [(m, u, c) for m, u, c in upserts(hechas) if m == "POST"]
revisar("hubo un POST a agent_results", len(posts) == 1, f"hubo {len(posts)}")
revisar("lleva on_conflict con las tres columnas",
        posts and "on_conflict=client_id,agent_id,fecha" in posts[0][1],
        f"url: {posts[0][1] if posts else '(ninguna)'}")

print("── el PATCH de respaldo aísla el tenant ──")
hechas = correr(409)
patches = [(m, u, c) for m, u, c in upserts(hechas) if m == "PATCH"]
revisar("el 409 dispara el PATCH", len(patches) == 1, f"hubo {len(patches)}")
revisar("el filtro incluye client_id",
        patches and "client_id=eq.amalay" in patches[0][1],
        f"url: {patches[0][1] if patches else '(ninguna)'}")
revisar("el cuerpo NO reescribe las llaves",
        patches and not any(k in (patches[0][2] or {})
                            for k in ("client_id", "agent_id", "fecha")),
        f"cuerpo: {list((patches[0][2] or {}).keys()) if patches else '(ninguno)'}")

print()
if fallos:
    print(f"stock-alert upsert: {fallos} FALLARON")
    sys.exit(1)
print("stock-alert upsert: 5/5 ok")
