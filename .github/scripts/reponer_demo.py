#!/usr/bin/env python3
"""El restaurante de pruebas recibe mercancía, como cualquier restaurante.

POR QUÉ EXISTE
Desde que el simulador vende por el camino real (#366), cada venta descuenta inventario
de verdad — y `r1_reconcile_item` actualiza el stock SIN tope:

    -- Atomic stock update — no clamping, allows negative
    UPDATE pos_inventory SET stock = stock - v_ing_delta ...

O sea que el demo se vacía y sigue de largo hacia números negativos. Medido el
2026-09-09, al ritmo de MEDIO día de operación, el primer insumo llegaba a cero en 8.7
días. Un prospecto abriendo el demo la semana entrante se habría encontrado el inventario
en rojo, que es exactamente lo contrario de lo que el demo existe para enseñar.

POR QUÉ NO SE REPONE EN CADA CORRIDA
Rellenar cada hora dejaría el inventario clavado y el consumo invisible — se perdería lo
único nuevo que el demo puede enseñar. Se repone como repone un restaurante: cuando el
insumo cae bajo su punto de reorden, y hasta el nivel que ya declara su ficha.

    reorder_point    = 4 días de consumo   (lo sembró `sembrar_recetas_demo.py`)
    reorder_quantity = 21 días de consumo  ← nivel objetivo, el mismo del stock inicial

Con eso el demo enseña la curva completa: baja durante días, entra mercancía, vuelve a
bajar. Que es la película que le interesa a un restaurantero.

EL MOVIMIENTO SE ESCRIBE, NO SÓLO EL SALDO
Cada reposición deja su fila en `pos_inventory_movements` con `movement_type='restock'`.
Mover el saldo sin dejar rastro es la misma clase de divergencia silenciosa que tuvimos
que perseguir tres veces esta semana: el número cambia y nadie puede decir por qué.

OJO CON EL CRUCE CONSUMO × VENTA
Hasta hoy `demo` sólo tenía salidas, así que sumar `abs(quantity)` de TODOS sus
movimientos daba el consumo. Con reposiciones eso deja de ser cierto: una entrada de
+40 kg se sumaría como si fuera consumo. Cualquier consulta que compare contra
`ops_consumo` tiene que filtrar por tipo:

    where movement_type in ('recipe_deduction', 'recipe_reversal')

SEGURIDAD
Escribe SOLO en la lista blanca de tenants de prueba, igual que el sembrador. Regalarle
inventario a un restaurante real le falsea el costo con el que fija precios.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID (default demo)
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_common import log_run, sb_get, sb_patch, sb_post  # noqa: E402

TENANTS_PERMITIDOS = {"demo", "lab-resto", "esqueleton-demo"}

# Los tipos que representan SALIDA por venta. Es lo único que se puede comparar contra el
# consumo teórico de `ops_consumo`; ver el aviso del encabezado.
TIPOS_DE_CONSUMO = ("recipe_deduction", "recipe_reversal")


def insumos(cid: str) -> list[dict]:
    return sb_get(
        "pos_inventory",
        f"client_id=eq.{cid}&select=ingredient_id,stock,reorder_point,reorder_quantity"
        f",stock_unit&limit=1000",
    )


def reponer(cid: str) -> tuple[int, int]:
    """Devuelve (repuestos, en_negativo_antes). Idempotente: si nada bajó del punto de
    reorden, no escribe una sola fila."""
    ahora = datetime.now(timezone.utc).isoformat()
    filas = insumos(cid)
    if not filas:
        raise RuntimeError(
            f"{cid} no tiene una sola fila en pos_inventory. Sin inventario no hay nada "
            f"que reponer — ¿falta correr sembrar_recetas_demo.py?")

    movimientos, cambios, negativos = [], [], 0
    for f in filas:
        stock = float(f.get("stock") or 0)
        punto = float(f.get("reorder_point") or 0)
        objetivo = float(f.get("reorder_quantity") or 0)
        if stock < 0:
            negativos += 1
        # `objetivo <= 0` = ficha sin nivel declarado: no se adivina, se reporta abajo.
        if objetivo <= 0 or stock >= punto:
            continue
        entrada = round(objetivo - stock, 3)
        if entrada <= 0:
            continue
        cambios.append((f["ingredient_id"], stock, objetivo, entrada))
        movimientos.append({
            "client_id": cid, "ingredient_id": f["ingredient_id"],
            "movement_type": "restock", "quantity": entrada,
            "actor": "reposicion_demo",
            "notes": f"reposicion automatica: {stock:.3f} -> {objetivo:.3f} "
                     f"{f.get('stock_unit') or ''}".strip(),
            "created_at": ahora,
        })

    for ing, antes, objetivo, entrada in cambios:
        # Se escribe el saldo antes que el movimiento: si algo truena en medio, queda una
        # entrada de menos —visible al comparar— y no stock de más sin respaldo.
        sb_patch("pos_inventory", f"client_id=eq.{cid}&ingredient_id=eq.{ing}",
                 {"stock": objetivo, "last_restock": ahora, "updated_at": ahora})
        print(f"[reponer]   {ing:<28} {antes:>10.3f} → {objetivo:>10.3f}  (+{entrada:.3f})")
    if movimientos:
        sb_post("pos_inventory_movements", movimientos)

    sin_nivel = [f["ingredient_id"] for f in filas
                 if float(f.get("reorder_quantity") or 0) <= 0]
    if sin_nivel:
        print(f"[reponer] AVISO: {len(sin_nivel)} insumo(s) sin reorder_quantity — no se "
              f"reponen porque no se sabe hasta dónde: {sorted(sin_nivel)}", file=sys.stderr)

    return len(cambios), negativos


def main() -> int:
    cid = (os.environ.get("CLIENT_ID") or "demo").strip()
    if cid not in TENANTS_PERMITIDOS:
        print(f"[reponer] ERROR: '{cid}' no es un tenant de prueba. Regalarle inventario a "
              f"un restaurante real le falsea el costo con el que fija precios.",
              file=sys.stderr)
        return 1

    inicio = datetime.now(timezone.utc)
    try:
        repuestos, negativos = reponer(cid)
    except Exception as e:
        print(f"[reponer] ERROR: {e}", file=sys.stderr)
        log_run("reponer-demo", "error", 0, error_message=str(e)[:500], tentacle="lab")
        return 1

    dur = int((datetime.now(timezone.utc) - inicio).total_seconds() * 1000)
    if repuestos:
        resumen = f"[{cid}] {repuestos} insumo(s) repuestos"
    else:
        resumen = f"[{cid}] nada bajo el punto de reorden — no se repuso nada"
    print(f"[reponer] {resumen}")

    if negativos:
        # Que haya llegado a negativo significa que la reposición se quedó corta: o el
        # cron no corrió, o el consumo creció más rápido que el punto de reorden. No se
        # calla — es el aviso de que la ventana de 4 días ya no alcanza.
        print(f"[reponer] ATENCION: {negativos} insumo(s) estaban en NEGATIVO. La "
              f"reposicion los levanta, pero el punto de reorden se quedo corto.",
              file=sys.stderr)

    log_run("reponer-demo", "success", dur, output_summary=resumen[:500],
            tentacle="lab", rows_processed=repuestos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
