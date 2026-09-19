#!/usr/bin/env python3
"""Avisa cuando la flota deja de reportar — o cuando nunca reportó.

POR QUÉ EXISTE
--------------
Medido contra AMALAY el 2026-09-14:

    select count(*) from local_server_heartbeats  ->  0     (cero desde que existe)

La tabla, el emisor (electron-app/local-server/telemetry/heartbeat.js), la API
(/api/platform/devices) y las pantallas (/platform/devices) estaban todas
construidas. Nunca pasó un solo renglón, y nadie se enteró en meses.

La razón es la que ya está escrita en este repo como patrón: **una flota que no
reporta se ve idéntica a una flota sana**. Todos los monitores miran filas que
llegan; ninguno mira las que faltan. Por eso este script alerta por AUSENCIA.

Los dos casos son distintos y se dicen distinto:

  · NUNCA REPORTÓ  -> la tubería está desconectada (falta la credencial en el
    config.json de la terminal; la receta de clonado no la escribe). No es una
    caída: es que nunca se encendió.
  · DEJÓ DE REPORTAR -> la terminal estaba viva y se calló. Eso sí es una caída.

Confundirlos hace que el aviso se ignore, que es como mueren los avisos.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_AGENT_KEY"]
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT = os.environ.get("TELEGRAM_CHAT_ID_DANIEL")

# Latido cada 5 min. Tres horas sin señal no es "tardó": es que se calló.
SILENCIO_MAX = timedelta(hours=3)

HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def consultar(path):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


def avisar(texto):
    print(texto)
    if not (TELEGRAM_TOKEN and TELEGRAM_CHAT):
        print("(sin credenciales de Telegram: sólo se imprime)")
        return
    requests.post(
        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
        json={"chat_id": TELEGRAM_CHAT, "text": texto, "parse_mode": "Markdown"},
        timeout=20,
    )


def main():
    latidos = consultar("local_server_heartbeats?select=server_id,restaurant_id,reported_at"
                        "&order=reported_at.desc&limit=200")

    # CASO 1 — la tabla está vacía. No es una caída; es una tubería desconectada.
    if not latidos:
        avisar(
            "🔌 *La flota nunca ha reportado*\n\n"
            "`local_server_heartbeats` está en **cero filas**. No es que una terminal "
            "se haya caído: es que ninguna ha reportado jamás.\n\n"
            "Causa confirmada el 2026-09-14: el `config.json` de una terminal "
            "provisionada no trae `supabaseAnonKey` ni `supabaseUrl`, así que "
            "`heartbeat.start()` se apaga por su guard.\n\n"
            "Revisa `/health` de la terminal: el campo `telemetria` dice el motivo."
        )
        return 1

    ahora = datetime.now(timezone.utc)
    mudas, vivas = [], 0
    vistos = set()
    for h in latidos:
        sid = h["server_id"]
        if sid in vistos:          # ya tenemos su latido más reciente
            continue
        vistos.add(sid)
        visto = datetime.fromisoformat(h["reported_at"].replace("Z", "+00:00"))
        silencio = ahora - visto
        if silencio > SILENCIO_MAX:
            mudas.append((h.get("restaurant_id", "?"), sid, silencio))
        else:
            vivas += 1

    # CASO 2 — estaban reportando y se callaron. Esto sí es una caída.
    if mudas:
        lineas = "\n".join(
            f"· `{rid}` / `{sid[:12]}` — {int(s.total_seconds() // 3600)} h sin señal"
            for rid, sid, s in sorted(mudas, key=lambda x: -x[2].total_seconds())
        )
        avisar(f"📴 *{len(mudas)} terminal(es) dejaron de reportar*\n\n{lineas}\n\n"
               f"Reportando bien: {vivas}.")
        return 1

    # Silencio sano: se imprime y no se manda nada. Un aviso que llega todos los
    # días deja de leerse.
    print(f"OK — {vivas} terminal(es) reportando dentro de las últimas "
          f"{int(SILENCIO_MAX.total_seconds() // 3600)} h.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:               # noqa: BLE001
        # Que el monitor se caiga en silencio sería repetir el defecto que vigila.
        avisar(f"⚠️ *El monitor de flota falló*: `{type(err).__name__}: {err}`")
        sys.exit(2)
