#!/usr/bin/env python3
"""El turno del simulador, resuelto como lo resuelve una terminal del POS.

POR QUÉ EXISTE
`make_order` inventaba el turno: `lab-turno-<AAAAMMDD>`. Eso alcanzaba mientras el
simulador escribía DIRECTO a `pos_orders`, porque la tabla sólo exige que el campo no
sea nulo (constraint `orders_require_turno`). Al pasar al camino real del POS quedó
igual, y ahí ya no alcanza:

`api/pos/save-order` valida el turno contra `pos_turnos` ANTES de tocar nada
(`resolveTurnoForSave`). Un id inventado no existe en esa tabla, así que el endpoint
devuelve `TURN_NOT_FOUND` → HTTP 409. Medido el 2026-09-09 en la corrida 34324277618:
4 órdenes intentadas, 4 rechazadas, `+0 órdenes, 0 a cocina, 0 cobradas`. Por eso
`pos_inventory_movements` del tenant `demo` sigue en 0 y su última orden es del
2026-08-26: el descuento de inventario NUNCA se ha ejercitado por el camino real.

QUÉ HACE EN SU LUGAR
Lo mismo que una terminal al arrancar el día:
  1. lee los turnos abiertos del tenant   (`getActiveTurnos`)
  2. si el más reciente es del DÍA DE VENTA de hoy, lo usa
  3. si es de otro día de venta, lo auto-cierra (`autoCloseStaleTurno`) y abre uno nuevo
  4. si no hay ninguno abierto, abre uno   (`openTurno`)

Así el demo termina con UN turno por día —como su propia historia, `seed-demo-d1..d64`,
uno diario— en vez del turno pegado desde el 2026-08-12 que traía. Ese turno viejo no
sólo no se usaba: el POS lo declara stale (`getActiveTurnoWithStaleCheck`), así que a un
prospecto que entra con PIN le enseña "Turno del día anterior → Corte Z" en lugar de un
restaurante operando.

DÍA DE VENTA, NO 24 HORAS DE RELOJ
La vigencia se mide por día de venta (`dia-de-venta.ts`): un turno abierto a las 19:00
sigue vigente a la 01:30 del día natural siguiente, porque el restaurante corta a las
05:00. Medirla con un TTL de reloj fue exactamente el bug del incidente del 2026-08-31
en AMALAY — "Turno del día anterior / Corte Z" en bucle sobre un turno que el servidor
ya tenía cerrado. Este módulo copia la regla, no la reinventa.
"""
from __future__ import annotations

import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get, sb_post, sb_patch

# Mismo default que `dia-de-venta.ts` (INICIO_DIA_DEFAULT) y `provision-tenant.ts`.
INICIO_DIA_DEFAULT = "05:00:00"
TZ_DEFAULT = "America/Monterrey"
# La historia del demo abre con $500 (`seed-demo-d1..d64`). El turno pegado de agosto
# abrió con $0, que es de las cosas que lo delatan como no-operado.
FONDO_INICIAL_DEFAULT = 500.0

ALFABETO36 = "0123456789abcdefghijklmnopqrstuvwxyz"


# ── Día de venta ──────────────────────────────────────────────────────────────

def hora_inicio_dia(valor: str | None) -> float:
    """Inicio del día de venta en horas. Acepta 'HH:MM' y 'HH:MM:SS'."""
    m = re.match(r"^(\d{1,2}):(\d{2})", (valor or INICIO_DIA_DEFAULT).strip())
    if not m:
        return 5.0
    h = int(m.group(1)) + int(m.group(2)) / 60
    return h if 0 <= h < 24 else 5.0


def zona(nombre: str):
    """La zona del restaurante. Si no se puede resolver, UTC — y se dice en voz alta,
    porque con UTC el día de venta de un restaurante mexicano se corre seis horas."""
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(nombre)
    except Exception as e:
        print(f"[turno] AVISO: no se pudo cargar la zona '{nombre}' ({e}); se usa UTC y "
              f"el día de venta puede quedar corrido", file=sys.stderr)
        return timezone.utc


def parsear_instante(valor) -> datetime:
    """Un timestamp de PostgREST → datetime con zona.

    Tolerante a propósito: separador 'T' o espacio, sufijo 'Z', offset de dos dígitos
    ('+00', que `fromisoformat` no acepta) y timestamps sin zona (se asumen UTC). Un
    turno mal parseado se declararía de otro día y provocaría un corte de caja falso.
    """
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)
    s = str(valor).strip().replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if re.search(r"[+-]\d{2}$", s):
        s += ":00"
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def dia_de_venta(instante, tz: str, inicio: str | None) -> str:
    """'AAAA-MM-DD' del día de venta al que pertenece un instante, en la zona del
    restaurante. Antes de la hora de inicio, pertenece al día ANTERIOR."""
    local = parsear_instante(instante).astimezone(zona(tz))
    h = local.hour + local.minute / 60 + local.second / 3600
    if h < hora_inicio_dia(inicio):
        local -= timedelta(days=1)
    return local.strftime("%Y-%m-%d")


def mismo_dia_de_venta(a, b, tz: str, inicio: str | None) -> bool:
    """¿Los dos instantes caen en el MISMO día de venta?"""
    da = dia_de_venta(a, tz, inicio)
    return da != "" and da == dia_de_venta(b, tz, inicio)


# ── Config del restaurante ────────────────────────────────────────────────────

def config_del_tenant(client_id: str) -> tuple[str, str]:
    """(zona horaria, inicio del día de venta), leídos de `clients`.

    Del restaurante, no del entorno: el día de venta es una propiedad del negocio.
    `demo` no declara `business_day_start_local` (viene en null), así que cae al default
    de 05:00 — el mismo que usan `dia-de-venta.ts` y `provision-tenant.ts`.
    """
    tz = os.environ.get("TZ_LOCAL") or TZ_DEFAULT
    inicio = INICIO_DIA_DEFAULT
    try:
        filas = sb_get(
            "clients",
            f"id=eq.{client_id}&select=timezone,business_day_start_local&limit=1",
        )
        if filas:
            tz = filas[0].get("timezone") or tz
            inicio = filas[0].get("business_day_start_local") or INICIO_DIA_DEFAULT
    except Exception as e:
        print(f"[turno] no se pudo leer la config de {client_id} ({e}); "
              f"se sigue con zona {tz} e inicio {inicio}", file=sys.stderr)
    return tz, inicio


# ── Apertura y cierre ─────────────────────────────────────────────────────────

def nuevo_id_de_turno() -> str:
    """Con la MISMA forma que el que teclea una terminal: base36 del epoch en ms más
    cuatro al azar (`idParaAbrirTurno`, pos-data.ts). Un turno del simulador no se
    distingue de uno abierto a mano, que es justo lo que el demo debe aparentar."""
    n, s = int(time.time() * 1000), ""
    while n:
        n, r = divmod(n, 36)
        s = ALFABETO36[r] + s
    return s + "".join(random.choice(ALFABETO36) for _ in range(4))


def cerrar_turno_stale(turno_id: str, cerrado_por: str) -> None:
    """Igual que `autoCloseStaleTurno`: un turno de otro día de venta se cierra sin
    wizard de conteo, y con su misma nota para que se lea como lo que es."""
    sb_patch("pos_turnos", f"id=eq.{turno_id}", {
        "closed_at": datetime.now(timezone.utc).isoformat(),
        "closed_by": cerrado_por,
        "notas": "Auto-cerrado (turno del dia anterior)",
    })


def abrir_turno(client_id: str, abierto_por: str, fondo_inicial: float,
                ahora: datetime, tz: str, inicio: str) -> str:
    turno_id = nuevo_id_de_turno()
    # `upsert` = el `resolution=merge-duplicates` con el que abre el POS: un segundo
    # toque reescribe la MISMA fila en vez de multiplicar turnos. Aquí el id es nuevo
    # cada vez, pero se conserva el modo por si dos corridas llegaran a encimarse.
    sb_post("pos_turnos", {
        "id": turno_id, "client_id": client_id, "opened_by": abierto_por,
        "fondo_inicial": fondo_inicial, "opened_at": ahora.isoformat(),
    }, upsert=True)
    print(f"[turno] abierto {turno_id} por {abierto_por} · día de venta "
          f"{dia_de_venta(ahora, tz, inicio)} · fondo ${fondo_inicial:,.2f}")
    return turno_id


def turno_vigente(client_id: str, operador: str,
                  fondo_inicial: float = FONDO_INICIAL_DEFAULT) -> str:
    """El id del turno abierto al que pertenece AHORA — lo único que `save-order`
    necesita en el cuerpo de la orden.

    Reutiliza el vigente, auto-cierra el que quedó de otro día de venta y abre el que
    haga falta. Es el camino de una terminal real, sin atajos.
    """
    tz, inicio = config_del_tenant(client_id)
    ahora = datetime.now(timezone.utc)
    hoy = dia_de_venta(ahora, tz, inicio)

    abiertos = sb_get(
        "pos_turnos",
        f"client_id=eq.{client_id}&closed_at=is.null"
        f"&select=id,opened_at,opened_by&order=opened_at.desc&limit=10",
    )

    for t in abiertos:
        if t.get("opened_at") and mismo_dia_de_venta(t["opened_at"], ahora, tz, inicio):
            print(f"[turno] se reutiliza el turno abierto {t['id']} · día de venta {hoy}")
            return t["id"]

    # Ninguno es de hoy: los que sigan abiertos pertenecen a un día ya cerrado. Se
    # cierran como los cierra el POS, para que el demo tenga un turno por día y su
    # corte de caja signifique algo en vez de acumular semanas en uno solo.
    for t in abiertos:
        cerrar_turno_stale(t["id"], operador)
        de = dia_de_venta(t["opened_at"], tz, inicio) if t.get("opened_at") else "?"
        print(f"[turno] auto-cerrado {t['id']} (era del día de venta {de}, hoy es {hoy})")

    return abrir_turno(client_id, operador, fondo_inicial, ahora, tz, inicio)


if __name__ == "__main__":
    # Comprobación de humo: resuelve el turno del tenant y lo imprime. Escribe en
    # `pos_turnos` si hace falta, así que sólo tiene sentido contra un tenant de pruebas.
    cid = os.environ.get("CLIENT_ID", "demo")
    print(turno_vigente(cid, os.environ.get("OPERADOR", "Simulador")))
