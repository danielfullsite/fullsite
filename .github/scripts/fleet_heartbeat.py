#!/usr/bin/env python3
"""
ops/fleet-heartbeat
Vigila que las terminales de un restaurante sigan reportando telemetria.

Silent success si toda la flota reporto hace poco. Alerta a Telegram si una
terminal se callo, o si NINGUNA ha reportado nunca.

─── Por que existe ───────────────────────────────────────────────────────────
`electron-app/local-server/telemetry/heartbeat.js` manda cada 5 min a la tabla
`local_server_heartbeats`: cola de sync, fallas de impresion, version, uptime,
disco. Medido el 2026-09-13 contra el proyecto de AMALAY: la tabla tenia CERO
filas. Nunca reporto una terminal, de ningun restaurante.

Nadie se entero porque una flota que no reporta se ve EXACTAMENTE igual que una
flota sana: en ambos casos no llega ninguna alerta. Es el mismo patron que el
demo que estuvo 14 dias muerto con el CI en verde, y que la alerta de ingesta
de Wansoft que se ignoro 51 dias.

Este script existe para romper esa simetria: alerta por AUSENCIA, no por
contenido. Es la unica clase de alerta que puede avisar que el sistema de
alertas esta caido.

La logica vive en `evaluar_flota()`, una funcion PURA: sin red, sin reloj
propio, sin entorno. Asi se puede probar de verdad — ver test_fleet_heartbeat.py.
"""

import os, sys, time, requests
from datetime import datetime, timezone, timedelta

MX_TZ = timezone(timedelta(hours=-6))

# Una terminal late cada 5 min. 25 min = 5 latidos perdidos: suficiente para no
# alertar por un reinicio o una reconexion, poco para enterarse el mismo turno.
UMBRAL_MIN_DEFAULT = 25

# Una cola de sync crece sola cuando no hay internet; 50 ordenes pendientes ya
# no es "un ratito sin WAN", es algo atorado.
COLA_SYNC_MAX = 50


# ─── Logica pura (probable sin red) ──────────────────────────────────────────

def _minutos_desde(iso_str, ahora):
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return (ahora - dt).total_seconds() / 60.0


def _hora_mx(iso_str):
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.astimezone(MX_TZ).strftime("%Y-%m-%d %H:%M")


def evaluar_flota(filas, ahora, umbral_min=UMBRAL_MIN_DEFAULT, client_id="?"):
    """Decidir si la flota merece alerta.

    Funcion pura: no toca red, ni reloj, ni entorno. `filas` son los heartbeats
    ya ordenados por reported_at descendente.

    Devuelve {'alerta': bool, 'status': str, 'resumen': str, 'mensaje': str|None,
              'vivas': int, 'mudas': int}
    """
    # ── Caso 1: la flota nunca reporto ───────────────────────────────────────
    if not filas:
        return {
            "alerta": True,
            "status": "warning",
            "resumen": "ALERT: flota muda — 0 heartbeats historicos",
            "vivas": 0,
            "mudas": 0,
            "mensaje": (
                "🔴 TELEMETRIA DE FLOTA MUDA\n"
                f"Restaurante: {client_id}\n\n"
                "Ninguna terminal ha reportado NUNCA a local_server_heartbeats.\n"
                "No hay forma de saber remotamente si la cola de sync crece, si "
                "fallan impresiones, ni que version corre cada caja.\n\n"
                "Causa probable: el config.json de la terminal no trae "
                "`supabaseAnonKey` (la receta de clonado no lo escribe) y no hay "
                "credencial embebida → heartbeat.start() se apaga.\n\n"
                "Verificar: en la terminal, buscar la linea [heartbeat] en el log "
                "de arranque de Pedro."
            ),
        }

    # Una fila por terminal: nos quedamos con el reporte mas reciente de cada una.
    ultimo_por_terminal = {}
    for f in filas:
        sid = f.get("server_id")
        if sid and sid not in ultimo_por_terminal:
            ultimo_por_terminal[sid] = f

    mudas, vivas, con_problema = [], [], []

    for sid, f in ultimo_por_terminal.items():
        reportado = f.get("reported_at") or ""
        if not reportado:
            mudas.append((sid, None, f))
            continue

        mins = _minutos_desde(reportado, ahora)
        if mins > umbral_min:
            mudas.append((sid, mins, f))
        else:
            vivas.append((sid, mins, f))
            # Una terminal viva tambien puede estar sufriendo. Estos numeros son
            # el punto de toda la telemetria: no sirve verlos y callarse.
            cola   = f.get("sync_queue_size") or 0
            fallas = f.get("print_jobs_failed") or 0
            salud  = (f.get("health_status") or "").lower()
            if cola > COLA_SYNC_MAX or fallas > 0 or salud not in ("", "ok", "healthy"):
                con_problema.append((sid, f))

    lineas = []
    if mudas:
        lineas.append("🔴 TERMINALES CALLADAS")
        for sid, mins, f in mudas:
            cuando = f"hace {mins:.0f} min" if mins is not None else "sin fecha"
            visto  = _hora_mx(f["reported_at"]) if f.get("reported_at") else "N/D"
            lineas.append(f"• {sid} — {cuando} (ultimo: {visto}, v{f.get('version', '?')})")

    if con_problema:
        lineas.append("\n⚠️ TERMINALES REPORTANDO PROBLEMAS")
        for sid, f in con_problema:
            lineas.append(
                f"• {sid} — cola sync: {f.get('sync_queue_size', 0)}, "
                f"impresiones fallidas: {f.get('print_jobs_failed', 0)}, "
                f"salud: {f.get('health_status', 'N/D')}"
            )

    if not lineas:
        return {
            "alerta": False,
            "status": "success",
            "resumen": f"OK — {len(vivas)} terminal(es) reportando. Sin alerta.",
            "vivas": len(vivas),
            "mudas": 0,
            "mensaje": None,
        }

    encabezado = f"Flota {client_id} — {len(vivas)} viva(s), {len(mudas)} callada(s)\n\n"
    return {
        "alerta": True,
        "status": "warning",
        "resumen": f"ALERT: {len(mudas)} callada(s), {len(con_problema)} con problema",
        "vivas": len(vivas),
        "mudas": len(mudas),
        "mensaje": encabezado + "\n".join(lineas),
    }


# ─── I/O ─────────────────────────────────────────────────────────────────────

def main():
    from client_config import get_client, get_chat_ids, get_all_chat_ids

    CLIENT       = get_client()
    SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
    SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
    TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")
    UMBRAL_MIN   = int(os.environ.get("HEARTBEAT_STALE_MIN", str(UMBRAL_MIN_DEFAULT)))

    # El destinatario: si nadie configuro `fleet_heartbeat` en report_recipients,
    # caemos a todos los chats del cliente. Una alerta que no llega a nadie es
    # justo el bug que este script existe para cazar — no lo repetimos.
    TG_CHAT_IDS = get_chat_ids(CLIENT, "fleet_heartbeat") or get_all_chat_ids(CLIENT)

    sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
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
        if not TG_CHAT_IDS:
            # Sin destinatario no hay alerta. Truena para que el workflow salga
            # en rojo en vez de "pasar" sin avisarle a nadie.
            raise RuntimeError(
                "fleet-heartbeat sin destinatario: ni report_recipients['fleet_heartbeat'] "
                f"ni telegram_chat_ids para el cliente {CLIENT['id']}"
            )
        for chat_id in TG_CHAT_IDS:
            r = requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                              json={"chat_id": chat_id, "text": text}, timeout=15)
            r.raise_for_status()

    print(f"[fleet-heartbeat] Revisando flota de {CLIENT['id']} (umbral {UMBRAL_MIN} min)...")

    filas = sb_get("local_server_heartbeats", [
        ("restaurant_id", f"eq.{CLIENT['id']}"),
        ("select", "server_id,restaurant_id,reported_at,version,health_status,"
                   "sync_queue_size,print_jobs_failed,clients_connected,disk_free_mb"),
        ("order", "reported_at.desc"),
        ("limit", "200"),
    ])

    veredicto = evaluar_flota(
        filas, datetime.now(timezone.utc), umbral_min=UMBRAL_MIN, client_id=CLIENT["id"]
    )

    if veredicto["alerta"]:
        send_telegram(veredicto["mensaje"])
    print(f"[fleet-heartbeat] {veredicto['resumen']}")

    duration_ms = int((time.time() - start) * 1000)
    try:
        sb_post("agent_runs", {
            "agent_id":       "fleet-heartbeat",
            "trigger_type":   TRIGGER_TYPE,
            "status":         veredicto["status"],
            "duration_ms":    duration_ms,
            "output_summary": veredicto["resumen"],
            "error_message":  None,
            "tokens_in":      0,
            "tokens_out":     0,
            "tentacle":       "ops",
        })
        print("[fleet-heartbeat] agent_runs logged OK")
    except Exception as e:
        print(f"[fleet-heartbeat] WARN: log failed: {e}", file=sys.stderr)

    print(f"[fleet-heartbeat] Done {duration_ms}ms. {veredicto['resumen']}")


if __name__ == "__main__":
    main()
