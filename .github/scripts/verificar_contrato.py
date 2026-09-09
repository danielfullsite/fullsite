#!/usr/bin/env python3
"""Comprueba que las vistas del contrato cierran contra las órdenes que las alimentan.

POR QUÉ EXISTE
docs/ai/ARQUITECTURA-CRUCE.md pone una regla: ningún agente lee una tabla cruda, sólo el
contrato. Eso sólo sirve si el contrato es correcto — si `ops_personal` pierde un mesero
al agrupar, todos los agentes lo pierden a la vez y nadie se entera, que es exactamente
cómo la mitad de la flota terminó leyendo tablas muertas durante meses.

No hay Postgres en CI (los tests del repo son unitarios con mocks), así que una vista SQL
no se puede probar aislada. Esto es lo siguiente mejor: correrla contra la base y verificar
identidades aritméticas, que no opinan.

QUÉ COMPRUEBA
  1. ops_hourly cierra   — Σ ventas por hora  == Σ total de las órdenes de ese día
  2. ops_personal cierra — Σ ventas por mesero == Σ total de las órdenes de ese día
  3. el denominador cierra — con_tiempo + sin_cierre + descartado == tickets
  4. los porcentajes son porcentajes — 0 <= pct_efectivo <= 100

La 3 es la que más importa y la menos obvia. Las columnas de cobertura existen para que un
cero por falta de captura no se lea como un cero real; si no suman los tickets, están
mintiendo sobre cuánta señal falta, que es peor que no publicarlas.

Uso:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python verificar_contrato.py [dias]
Salida: 0 si todo cierra, 1 si algo no.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import requests

# Un centavo, igual que cuadre.py. `numeric` y los redondeos producen fracciones de
# centavo que no son un descuadre; más ancho que esto sí escondería uno real.
TOLERANCIA = 0.01


def dinero(x) -> float:
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def descuadra(a: float, b: float) -> bool:
    """True si la diferencia pasa la tolerancia. La resta se redondea ANTES de comparar.

    Sin ese redondeo, `abs(100.01 - 100.00)` da 0.010000000000005 en punto flotante y un
    centavo exacto —el borde que la tolerancia existe para permitir— se marca como
    descuadre. Lo encontró la prueba del borde, no la lectura del código.

    NOTA: `cuadre.py` compara con el mismo patrón `abs(x - y) > TOLERANCIA` sin redondear,
    así que arrastra el mismo borde frágil. No se toca aquí para no mezclar dos problemas
    en una rama; queda anotado.
    """
    return round(abs(a - b), 2) > TOLERANCIA


def sb_get(tabla: str, query: str) -> list:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    r = requests.get(
        f"{url}/rest/v1/{tabla}?{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def verificar_tenant(cid: str, desde: str) -> list[str]:
    """Devuelve la lista de fallas. Vacía = el contrato cierra para este tenant."""
    fallas: list[str] = []

    ordenes = sb_get(
        "pos_orders",
        f"client_id=eq.{cid}&dia_venta=gte.{desde}"
        f"&select=status,total,dia_venta&limit=10000",
    )
    esperado: dict[str, float] = {}
    for o in ordenes:
        if str(o.get("status") or "") in ("cancelada", "dividida"):
            continue
        dia = o.get("dia_venta")
        if not dia:
            continue
        esperado[dia] = esperado.get(dia, 0.0) + dinero(o.get("total"))

    if not esperado:
        return fallas  # sin órdenes no hay nada que cerrar, y eso no es una falla

    # 1 — ops_hourly cierra contra las órdenes.
    horas = sb_get("ops_hourly",
                   f"client_id=eq.{cid}&dia_venta=gte.{desde}&select=dia_venta,ventas&limit=10000")
    por_dia: dict[str, float] = {}
    for h in horas:
        por_dia[h["dia_venta"]] = por_dia.get(h["dia_venta"], 0.0) + dinero(h.get("ventas"))
    for dia, esp in esperado.items():
        got = round(por_dia.get(dia, 0.0), 2)
        if descuadra(got, esp):
            fallas.append(f"{cid} {dia}: ops_hourly suma {got:.2f}, las órdenes suman {esp:.2f}")

    # 2, 3 y 4 — ops_personal.
    personal = sb_get(
        "ops_personal",
        f"client_id=eq.{cid}&dia_venta=gte.{desde}"
        f"&select=dia_venta,mesero,ventas,tickets,ordenes_con_tiempo,"
        f"ordenes_sin_cierre,ordenes_tiempo_descartado,pct_efectivo&limit=10000",
    )
    por_dia_p: dict[str, float] = {}
    for p in personal:
        por_dia_p[p["dia_venta"]] = por_dia_p.get(p["dia_venta"], 0.0) + dinero(p.get("ventas"))

        # El denominador tiene que cerrar: toda orden cae en exactamente una de las tres.
        partes = (int(p.get("ordenes_con_tiempo") or 0)
                  + int(p.get("ordenes_sin_cierre") or 0)
                  + int(p.get("ordenes_tiempo_descartado") or 0))
        tickets = int(p.get("tickets") or 0)
        if partes != tickets:
            fallas.append(
                f"{cid} {p['dia_venta']} {p['mesero']}: cobertura de tiempo suma {partes} "
                f"y son {tickets} tickets — las columnas de cobertura mienten"
            )

        pct = p.get("pct_efectivo")
        if pct is not None and not (0 <= float(pct) <= 100):
            fallas.append(f"{cid} {p['dia_venta']} {p['mesero']}: pct_efectivo = {pct}")

    for dia, esp in esperado.items():
        got = round(por_dia_p.get(dia, 0.0), 2)
        if descuadra(got, esp):
            fallas.append(f"{cid} {dia}: ops_personal suma {got:.2f}, las órdenes suman {esp:.2f}")

    return fallas


def tenants() -> list[str]:
    filas = sb_get("clients", "select=id&limit=200")
    return [f["id"] for f in filas if f.get("id")]


def main() -> int:
    dias = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).date().isoformat()

    todas: list[str] = []
    for cid in tenants():
        try:
            fallas = verificar_tenant(cid, desde)
        except Exception as e:  # noqa: BLE001 — fallar callado está prohibido
            fallas = [f"{cid}: no se pudo verificar — {e}"]
        if fallas:
            todas.extend(fallas)
            print(f"[contrato] {cid}: {len(fallas)} falla(s)")
        else:
            print(f"[contrato] {cid}: cierra")

    if todas:
        print(f"\n[contrato] {len(todas)} falla(s):")
        for f in todas[:50]:
            print(f"  · {f}")
        return 1

    print("\n[contrato] las vistas cierran contra sus órdenes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
