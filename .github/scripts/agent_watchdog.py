#!/usr/bin/env python3
"""Vigila a TODOS los agentes desde afuera y avisa sólo cuando algo cambia.

POR QUÉ DESDE AFUERA Y NO DENTRO DE CADA AGENTE
El modo de falla real de Fullsite no es "el agente falló": es "el agente dejó de
correr". Medido el 2026-08-26 contra agent_runs:

    cost-variance         46 días sin correr
    reservas-pendientes   93 días sin correr
    proactive-alerts      44 días sin correr

Un notificador metido DENTRO de cada script no puede avisar de eso, porque el
script no corre. Por eso esto vive afuera y lee la bitácora.

QUÉ DETECTA
  · ROTO — su última corrida quedó en error.
  · MUDO — lleva más callado de lo que jamás estuvo (umbral propio, ver abajo).

CÓMO EVITA EL RUIDO
Avisa por TRANSICIÓN, no por estado (la regla de agent_notify). Un agente roto
37 días seguidos cuesta un correo, no 37.

El estado previo se guarda en la propia fila de agent_runs del vigilante, como
JSON en output_summary. Sin tabla nueva, sin migración sobre producción.

EL UMBRAL DE "MUDO", Y POR QUÉ NO ES LA MEDIANA
Varios agentes corren en ráfaga: un workflow ejecuta 6 scripts y escribe 6 filas
en el mismo minuto, así que su hueco MEDIANO entre corridas es 0.0h. Un umbral
de "3x la mediana" daría 3*0 = 0 y marcaría todo como muerto de inmediato.
Se usa el percentil 90 de los huecos, que sí captura el intervalo entre ráfagas,
por 3, con piso de 6h para no gritarle a los agentes de alta frecuencia.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

from agent_notify import enviar_correo

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")
# Ensayo: diagnostica y dice qué mandaría, sin escribir en agent_runs ni
# mandar correo. Sirve para validarlo contra producción sin tocarla.
ENSAYO       = os.environ.get("WATCHDOG_DRY_RUN", "") == "1"

YO = "agent-watchdog"

ESTADOS_ROTOS   = {"error", "failure", "failed"}
VENTANA_DIAS    = 60
MULTIPLICADOR   = 3      # cuántas veces su p90 puede callar antes de contar como mudo
PISO_HORAS      = 6.0    # nunca marcar mudo antes de esto
MIN_CORRIDAS    = 4      # sin historia suficiente no se puede calibrar el umbral
TECHO_HORAS     = 720.0  # 30 días: muerto sin importar su cadencia

cabeceras = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
ahora = datetime.now(timezone.utc)


def traer_corridas() -> list[dict]:
    """Todas las corridas de la ventana, paginadas (PostgREST tapa en 1000)."""
    desde = (ahora - timedelta(days=VENTANA_DIAS)).isoformat()
    filas, offset = [], 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**cabeceras, "Range-Unit": "items",
                     "Range": f"{offset}-{offset + 999}"},
            params={"select": "agent_id,status,created_at,error_message",
                    "created_at": f"gte.{desde}",
                    "order": "created_at.asc"},
            timeout=30,
        )
        r.raise_for_status()
        lote = r.json()
        filas.extend(lote)
        if len(lote) < 1000:
            return filas
        offset += 1000


def percentil(valores: list[float], p: float) -> float:
    if not valores:
        return 0.0
    ordenados = sorted(valores)
    k = min(int(round(p * (len(ordenados) - 1))), len(ordenados) - 1)
    return ordenados[k]


def diagnosticar(filas: list[dict], antes: dict[str, str] | None = None) -> dict[str, dict]:
    """Por agente: su estado actual y por qué.

    `antes` es la foto previa. Se usa SÓLO para la histéresis (ver abajo); si no
    se pasa, el diagnóstico es el mismo que en una primera corrida.
    """
    antes = antes or {}
    por_agente = defaultdict(list)
    for f in filas:
        if f.get("agent_id") and f.get("created_at"):
            por_agente[f["agent_id"]].append(f)

    diagnostico = {}
    for agente, corridas in por_agente.items():
        if agente == YO:
            continue
        corridas.sort(key=lambda x: x["created_at"])
        marcas = [datetime.fromisoformat(c["created_at"].replace("Z", "+00:00"))
                  for c in corridas]
        ultima      = corridas[-1]
        horas_calla = (ahora - marcas[-1]).total_seconds() / 3600.0

        if (ultima.get("status") or "").lower() in ESTADOS_ROTOS:
            diagnostico[agente] = {
                "estado": "roto",
                "porque": (ultima.get("error_message") or "sin detalle")[:120],
            }
            continue

        huecos = [(b - a).total_seconds() / 3600.0 for a, b in zip(marcas, marcas[1:])]
        umbral = None
        if len(corridas) >= MIN_CORRIDAS and huecos:
            umbral = max(percentil(huecos, 0.90) * MULTIPLICADOR, PISO_HORAS)
        elif horas_calla > TECHO_HORAS:
            # Sin historia suficiente NO se puede calibrar un umbral propio, pero
            # un agente que lleva más de TECHO_HORAS sin aparecer está muerto sin
            # importar su cadencia. Sin esto se escapaban tres muertos reales
            # (menu-sync 59d, wansoft-deep-scraper 58d, crm-recompra 51d), que
            # tenían 1-2 corridas en la ventana y salían "ok".
            umbral = TECHO_HORAS

        if umbral is not None:
            # Histéresis: para ENTRAR a mudo hay que pasar el umbral; para SALIR
            # hay que bajar de la mitad. Sin esto, un agente rondando la línea
            # (waste-detector estaba a 4h de la suya) manda correo cada vez que
            # la cruza en cualquier dirección — que es justo el ruido a evitar.
            era_mudo = antes.get(agente) == "mudo"
            limite   = umbral * 0.5 if era_mudo else umbral
            if horas_calla > limite:
                diagnostico[agente] = {
                    "estado": "mudo",
                    "porque": (f"{horas_calla:.0f}h sin correr; su umbral es "
                               f"{umbral:.0f}h ({len(corridas)} corridas en "
                               f"{VENTANA_DIAS}d)"),
                }
                continue

        diagnostico[agente] = {"estado": "ok", "porque": ""}
    return diagnostico


def foto_anterior() -> dict[str, str]:
    """La última foto que dejó el vigilante. Vacío si es su primera corrida."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers=cabeceras,
            params={"agent_id": f"eq.{YO}", "select": "output_summary",
                    "order": "created_at.desc", "limit": "1"},
            timeout=15,
        )
        r.raise_for_status()
        filas = r.json()
        if not filas:
            return {}
        return json.loads(filas[0].get("output_summary") or "{}")
    except Exception as e:
        # Sin foto previa se trata todo como "sin antecedente": la primera corrida
        # avisa de lo que ya esté roto, y de ahí en adelante sólo de los cambios.
        print(f"[watchdog] no se pudo leer la foto previa: {e}", file=sys.stderr)
        return {}


def guardar_foto(foto: dict[str, str], resumen_humano: str, hubo_cambios: bool) -> None:
    if ENSAYO:
        print("[watchdog] ENSAYO: no se escribe la foto en agent_runs")
        return
    try:
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**cabeceras, "Content-Type": "application/json",
                     "Prefer": "return=minimal"},
            json={
                "agent_id":       YO,
                "trigger_type":   TRIGGER_TYPE,
                "status":         "warning" if hubo_cambios else "success",
                "output_summary": json.dumps(foto, ensure_ascii=False),
                "error_message":  resumen_humano or None,
                "tentacle":       "ops",
                "tokens_in":      0,
                "tokens_out":     0,
            },
            timeout=15,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"[watchdog] no se pudo guardar la foto: {e}", file=sys.stderr)


def main() -> int:
    antes = foto_anterior()
    diagnostico = diagnosticar(traer_corridas(), antes)
    ahora_foto = {a: d["estado"] for a, d in diagnostico.items()}

    se_rompieron, se_arreglaron = [], []
    for agente, d in sorted(diagnostico.items()):
        # Un agente que no estaba en la foto previa (o primera corrida del
        # vigilante) se trata como sano: así lo que YA está roto se reporta una
        # vez, y de ahí en adelante sólo los cambios.
        previo = antes.get(agente, "ok")
        if d["estado"] in ("roto", "mudo") and previo == "ok":
            se_rompieron.append((agente, d))
        elif d["estado"] == "ok" and previo in ("roto", "mudo"):
            se_arreglaron.append(agente)

    lineas = []
    if se_rompieron:
        lineas.append("SE ROMPIERON:")
        for a, d in se_rompieron:
            lineas.append(f"  · {a} [{d['estado']}] — {d['porque']}")
    if se_arreglaron:
        lineas.append("SE RECUPERARON:")
        lineas.extend(f"  · {a}" for a in se_arreglaron)

    if lineas:
        rotos_hoy = sum(1 for e in ahora_foto.values() if e != "ok")
        cuerpo = (
            "\n".join(lineas)
            + f"\n\nEn total hay {rotos_hoy} agentes con problema de "
              f"{len(ahora_foto)} vigilados.\n"
              "Sólo se avisa de los CAMBIOS: los que siguen rotos desde antes no "
              "se repiten aquí.\n"
        )
        asunto = f"[Fullsite] {len(se_rompieron)} agentes se rompieron, {len(se_arreglaron)} se recuperaron"
        if ENSAYO:
            print(f"[watchdog] ENSAYO: mandaría correo — {asunto}")
        else:
            enviar_correo(asunto, cuerpo)
        print(cuerpo)
    else:
        print(f"[watchdog] sin cambios. {len(ahora_foto)} agentes vigilados.")

    guardar_foto(ahora_foto, "; ".join(l.strip() for l in lineas[:6]), bool(lineas))
    return 0


if __name__ == "__main__":
    sys.exit(main())
