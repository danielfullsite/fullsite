#!/usr/bin/env python3
"""Avisa por correo SÓLO cuando un agente CAMBIA de estado.

EL PROBLEMA QUE RESUELVE
`wansoft-staleness` detectó bien que los datos estaban muertos y mandó alerta
todos los días del 2026-07-20 al 2026-08-26 — 37 alertas, contador subiendo.
Daniel no recibió ninguna: iban a Telegram, que lleva muerto desde el 13 de junio.

Dos fallas distintas, y la segunda es la que importa para el diseño:
  1. El canal estaba muerto (se cambia el canal).
  2. Alertaba POR EVENTO, no por CAMBIO. Aunque el canal hubiera vivido, eran 37
     correos diciendo lo mismo. Eso entrena a ignorarlos — que es exactamente
     cómo se llega a tener 32 workflows apagados.

LA REGLA
Se avisa en las transiciones, no en los estados:
    sano  → roto   → "se rompió"     (un correo)
    roto  → roto   → silencio         (aunque sean 37 días)
    roto  → sano   → "se recuperó"    (un correo)

Con esta regla, esos 37 días habrían costado UN correo, no 37.

SIN TABLA NUEVA
El estado anterior ya vive en `agent_runs`: basta leer la corrida previa del
mismo `agent_id`. Cero migraciones sobre producción.
"""

import os
import sys

import requests

SUPABASE_URL   = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY   = os.environ.get("SUPABASE_SERVICE_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
DESTINO        = os.environ.get("ALERT_EMAIL_TO", "daniel@fullsite.mx")
REMITENTE      = os.environ.get("ALERT_EMAIL_FROM", "alertas@fullsite.mx")

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Qué cuenta como "roto". `no_data` y `skipped` NO son fallas: un agente que no
# tiene datos que procesar hizo su trabajo. Meterlos aquí genera ruido — y el
# ruido es el modo de falla que estamos evitando.
ESTADOS_ROTOS = {"error", "failure", "failed"}


def _esta_roto(estado: str) -> bool:
    return (estado or "").lower() in ESTADOS_ROTOS


def estado_anterior(agent_id: str) -> str | None:
    """Estado de la corrida PREVIA de este agente. None si es la primera."""
    if not (SUPABASE_URL and SUPABASE_KEY):
        return None
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            params={
                "agent_id": f"eq.{agent_id}",
                "select":   "status,created_at",
                "order":    "created_at.desc",
                "limit":    "1",
            },
            timeout=15,
        )
        r.raise_for_status()
        filas = r.json()
        return filas[0].get("status") if filas else None
    except Exception as e:
        # Si no se puede leer el estado previo, se prefiere avisar de más una vez
        # que callar una caída real. Se devuelve None = "sin antecedente".
        print(f"[notify] no se pudo leer estado previo de {agent_id}: {e}", file=sys.stderr)
        return None


def enviar_correo(asunto: str, cuerpo: str) -> bool:
    if not RESEND_API_KEY:
        print("[notify] sin RESEND_API_KEY — no se manda correo", file=sys.stderr)
        return False
    try:
        r = requests.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {RESEND_API_KEY}",
                     "Content-Type": "application/json"},
            json={"from": REMITENTE, "to": [DESTINO], "subject": asunto, "text": cuerpo},
            timeout=20,
        )
        if r.ok:
            return True
        print(f"[notify] Resend respondió {r.status_code}: {r.text[:200]}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[notify] Resend falló: {e}", file=sys.stderr)
        return False


def avisar_si_cambio(agent_id: str, estado_actual: str,
                     resumen: str = "", error: str = "") -> str:
    """Manda correo sólo si el agente cambió de estado.

    Devuelve la transición detectada: 'se_rompio', 'se_recupero' o 'sin_cambio'.
    El valor de retorno es lo que se debe verificar en las pruebas — no el envío,
    que depende de la red.
    """
    previo  = estado_anterior(agent_id)
    ahora   = _esta_roto(estado_actual)
    antes   = _esta_roto(previo) if previo is not None else False

    if ahora and not antes:
        transicion = "se_rompio"
        asunto = f"[Fullsite] {agent_id} se rompió"
        cuerpo = (
            f"El agente {agent_id} falló.\n\n"
            f"Estado: {estado_actual}\n"
            f"Anterior: {previo or '(sin corrida previa)'}\n"
            f"Error: {error or '(sin detalle)'}\n"
            f"Resumen: {resumen or '(sin resumen)'}\n\n"
            f"No se volverá a avisar de este agente hasta que se recupere.\n"
        )
    elif antes and not ahora:
        transicion = "se_recupero"
        asunto = f"[Fullsite] {agent_id} se recuperó"
        cuerpo = (
            f"El agente {agent_id} volvió a funcionar.\n\n"
            f"Estado: {estado_actual}\n"
            f"Resumen: {resumen or '(sin resumen)'}\n"
        )
    else:
        return "sin_cambio"

    enviar_correo(asunto, cuerpo)
    return transicion
