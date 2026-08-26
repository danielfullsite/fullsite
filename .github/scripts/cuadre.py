#!/usr/bin/env python3
"""Verifica que los números de cada restaurante cierren. Capa 0.

POR QUÉ ES LA PRIMERA CAPA
Un agente que razona sobre números que no cuadran miente con confianza. Un detector de
merma sobre un inventario descuadrado no detecta merma: la inventa. Y un falso positivo
de robo cuesta más que no tener el detector — se acusa a una persona.

Por eso el cuadre va ANTES que cualquier detector estadístico, no después.

POR QUÉ ES TAMBIÉN EL MEJOR AGENTE
Los descuadres son los hallazgos más valiosos del sistema y son deterministas:

    caja no cuadra                 → faltante, error de cobro, o robo
    salidas > lo vendido           → merma no declarada
    orden cerrada sin pago         → se sirvió y no se cobró
    comisión de plataforma ≠ pacto → te están cobrando de más

Ninguno necesita un modelo. Los da una resta, y son exactos. **Cero falsos positivos por
diseño: una identidad aritmética no opina.**

QUÉ CUBRE ESTA VERSIÓN
Nivel 1 (dentro de una orden) y nivel 4 (el día contra sus partes). Son los que no
dependen de nada más.

Los niveles 2 (arqueo de turno, fórmula de Wansoft en docs/knowledge/wansoft/CAJA-SPEC.md)
y 3 (inventario contra venta) necesitan que exista un restaurante con la operación
completa — ver docs/ai/ARQUITECTURA-CRUCE.md.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID (o ALL), DIAS (default 7)
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_common import sb_get, log_run, log_event  # noqa: E402

# Un centavo de tolerancia. No es laxitud: `numeric` y los redondeos de IVA producen
# diferencias de fracciones de centavo que no son un descuadre real. Más ancho que esto
# sí escondería un error de verdad.
TOLERANCIA = 0.01


def dinero(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def como_lista(v) -> list:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except (ValueError, TypeError):
            return []
    return v if isinstance(v, list) else []


def revisar_orden(o: dict) -> list[tuple[str, str, float]]:
    """[(codigo, detalle, monto_en_juego)] — vacío si la orden cuadra."""
    fallas = []
    subtotal = dinero(o.get("subtotal"))
    iva = dinero(o.get("iva"))
    desc = dinero(o.get("descuento"))
    total = dinero(o.get("total"))

    items = como_lista(o.get("items"))
    suma_items = sum(dinero(i.get("subtotal")) for i in items if isinstance(i, dict))
    # Sólo se juzga si los items traen importe. Un POS que no captura líneas no está
    # descuadrado: está incompleto, y eso lo reporta otra comprobación.
    if items and suma_items > 0 and abs(suma_items - subtotal) > TOLERANCIA:
        fallas.append(("items_vs_subtotal",
                       f"items suman ${suma_items:,.2f} pero el subtotal dice ${subtotal:,.2f}",
                       abs(suma_items - subtotal)))

    esperado = subtotal - desc + iva
    if abs(esperado - total) > TOLERANCIA:
        fallas.append(("aritmetica_del_total",
                       f"subtotal ${subtotal:,.2f} − descuento ${desc:,.2f} + IVA ${iva:,.2f} "
                       f"= ${esperado:,.2f}, pero el total dice ${total:,.2f}",
                       abs(esperado - total)))

    if str(o.get("status") or "") in ("cerrada", "cobrada"):
        pagos = como_lista(o.get("pagos"))
        suma_pagos = sum(dinero(p.get("monto")) for p in pagos if isinstance(p, dict))
        if pagos and abs(suma_pagos - total) > TOLERANCIA:
            fallas.append(("pagos_vs_total",
                           f"los pagos suman ${suma_pagos:,.2f} y el total es ${total:,.2f}",
                           abs(suma_pagos - total)))
        if not pagos and not (o.get("metodo_pago") or "").strip():
            # Se sirvió y no consta cómo se cobró. Es dinero sin rastro.
            fallas.append(("cerrada_sin_forma_de_pago",
                           f"orden cerrada por ${total:,.2f} sin forma de pago registrada",
                           total))
    return fallas


def revisar_tenant(cid: str, dias: int) -> dict:
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).date().isoformat()
    ordenes = sb_get(
        "pos_orders",
        f"client_id=eq.{cid}&created_at=gte.{desde}"
        f"&select=id,status,subtotal,iva,descuento,total,items,pagos,metodo_pago,created_at"
        f"&limit=5000",
    )

    por_codigo: dict[str, list] = {}
    for o in ordenes:
        for codigo, detalle, monto in revisar_orden(o):
            por_codigo.setdefault(codigo, []).append((o["id"], detalle, monto))

    # Nivel 4 — el día contra sus partes.
    dias_desc = []
    diario = sb_get("ops_daily_history",
                    f"client_id=eq.{cid}&fecha=gte.{desde}&select=fecha,ventas_dia,tickets_count")
    suma_por_dia: dict[str, float] = {}
    cuenta_por_dia: dict[str, int] = {}
    for o in ordenes:
        if str(o.get("status") or "") == "cancelada":
            continue
        f = str(o.get("created_at", ""))[:10]
        suma_por_dia[f] = suma_por_dia.get(f, 0) + dinero(o.get("total"))
        cuenta_por_dia[f] = cuenta_por_dia.get(f, 0) + 1
    for d in diario:
        f = d["fecha"]
        if f not in suma_por_dia:
            continue
        vista = dinero(d.get("ventas_dia"))
        crudo = suma_por_dia[f]
        # 1% de tolerancia: la vista usa la zona horaria del negocio para cortar el día
        # y esta suma usa UTC, así que las órdenes del filo se mueven. Una diferencia
        # mayor no es zona horaria, es un problema.
        if crudo > 0 and abs(vista - crudo) / crudo > 0.01:
            dias_desc.append((f, vista, crudo))

    return {"ordenes": len(ordenes), "por_codigo": por_codigo, "dias_descuadrados": dias_desc}


def tenants() -> list[str]:
    pedido = (os.environ.get("CLIENT_ID") or "").strip()
    if pedido and pedido.upper() != "ALL":
        return [pedido]
    return sorted(r["id"] for r in sb_get("clients", "active=eq.true&select=id") if r.get("id"))


def main() -> int:
    inicio = time.time()
    dias = int(os.environ.get("DIAS", "7"))
    total_fallas = 0
    try:
        for cid in tenants():
            os.environ["CLIENT_ID"] = cid
            r = revisar_tenant(cid, dias)
            fallas = sum(len(v) for v in r["por_codigo"].values()) + len(r["dias_descuadrados"])
            total_fallas += fallas

            if fallas == 0:
                print(f"[cuadre] {cid}: {r['ordenes']} órdenes — CUADRA")
                continue

            print(f"[cuadre] {cid}: {r['ordenes']} órdenes — {fallas} DESCUADRE(S)")
            for codigo, casos in r["por_codigo"].items():
                monto = sum(m for _, _, m in casos)
                print(f"    {codigo}: {len(casos)} orden(es), ${monto:,.2f} en juego")
                for oid, detalle, _ in casos[:3]:
                    print(f"        {oid}: {detalle}")
                if len(casos) > 3:
                    print(f"        … y {len(casos)-3} más")
                # El descuadre ES el hallazgo. Se registra como evento medible, con el
                # dinero en juego, para que entre al mismo bucle de valor que todo lo demás.
                log_event(
                    agent_id="cuadre",
                    event_type="descuadre",
                    title=f"{len(casos)} orden(es) con {codigo.replace('_',' ')}",
                    severity="critical" if codigo == "cerrada_sin_forma_de_pago" else "warning",
                    estimated_value=round(monto, 2),
                    evidence={"codigo": codigo, "ordenes": len(casos),
                              "monto_en_juego": round(monto, 2),
                              "ejemplos": [oid for oid, _, _ in casos[:5]]},
                    explanation=casos[0][1],
                    suggested_action="Revisar esas órdenes en el POS antes de confiar en los reportes del día.",
                    client_id=cid,
                )
            for f, vista, crudo in r["dias_descuadrados"]:
                print(f"    dia_vs_ordenes: {f} la vista dice ${vista:,.2f}, las órdenes suman ${crudo:,.2f}")
                log_event(
                    agent_id="cuadre", event_type="descuadre",
                    title=f"El día {f} no cuadra con sus órdenes",
                    severity="warning", estimated_value=round(abs(vista - crudo), 2),
                    evidence={"codigo": "dia_vs_ordenes", "fecha": f,
                              "vista": vista, "suma_ordenes": crudo},
                    explanation=f"ops_daily_history dice ${vista:,.2f} y las órdenes suman ${crudo:,.2f}",
                    suggested_action="Revisar la vista o las órdenes de ese día.",
                    client_id=cid,
                )
    except Exception as e:
        ms = int((time.time() - inicio) * 1000)
        print(f"[cuadre] ERROR: {e}", file=sys.stderr)
        log_run("cuadre", "error", ms, error_message=str(e), tentacle="meta")
        return 1

    ms = int((time.time() - inicio) * 1000)
    resumen = "todo cuadra" if total_fallas == 0 else f"{total_fallas} descuadre(s)"
    log_run("cuadre", "success", ms, output_summary=resumen,
            rows_processed=total_fallas, data_status="ok", tentacle="meta")
    print(f"\n[cuadre] {resumen}")
    # Un descuadre NO tumba la corrida: es un hallazgo, no un fallo del verificador.
    # Que salga en rojo escondería el día que el verificador sí se rompa.
    return 0


if __name__ == "__main__":
    sys.exit(main())
