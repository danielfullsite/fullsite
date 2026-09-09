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

from agent_common import sb_get, log_run, log_event, SupabaseError  # noqa: E402

# Un centavo de tolerancia. No es laxitud: `numeric` y los redondeos de IVA producen
# diferencias de fracciones de centavo que no son un descuadre real. Más ancho que esto
# sí escondería un error de verdad.
TOLERANCIA = 0.01

# Tope de la consulta de órdenes. Si un tenant lo alcanza, la lectura viene recortada y
# el Nivel 4 —que suma órdenes para compararlas contra el día— compararía contra una
# suma incompleta y acusaría de descuadre a un restaurante que está bien. Cuando se
# toca el tope no se juzga: se reporta que no se pudo comprobar.
LIMITE_ORDENES = 5000


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
    """Revisa un restaurante y dice, por nivel, si se pudo comprobar.

    CADA NIVEL RESPONDE POR SÍ SOLO. Antes los dos colgaban de la misma lectura: si la
    consulta del contrato fallaba, se perdían también los hallazgos del Nivel 1 que ya
    estaban calculados. Ahora una lectura caída se lleva su nivel y nada más.

    `nivel1` / `nivel4` valen 'ok' (se comprobó), 'parcial' (se comprobó sobre una
    lectura recortada — los hallazgos valen, la ausencia de hallazgos no) o
    'no_verificado' (no se pudo). `motivos` explica cada caso que no sea 'ok'.
    """
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).date().isoformat()
    r = {"ordenes": 0, "por_codigo": {}, "dias_descuadrados": [],
         "nivel1": "no_verificado", "nivel4": "no_verificado", "motivos": []}

    # ── Nivel 1 — dentro de una orden ──────────────────────────────────────
    try:
        ordenes = sb_get(
            "pos_orders",
            f"client_id=eq.{cid}&created_at=gte.{desde}"
            f"&select=id,status,subtotal,iva,descuento,total,items,pagos,metodo_pago,created_at"
            f"&limit={LIMITE_ORDENES}",
        )
    except SupabaseError as e:
        # Sin órdenes no hay Nivel 1 NI Nivel 4: los dos las necesitan.
        r["motivos"].append(f"niveles 1 y 4: no se pudieron leer las órdenes — {e}")
        return r

    r["ordenes"] = len(ordenes)
    por_codigo: dict[str, list] = {}
    for o in ordenes:
        for codigo, detalle, monto in revisar_orden(o):
            por_codigo.setdefault(codigo, []).append((o["id"], detalle, monto))
    r["por_codigo"] = por_codigo

    recortado = len(ordenes) >= LIMITE_ORDENES
    r["nivel1"] = "parcial" if recortado else "ok"
    if recortado:
        r["motivos"].append(
            f"nivel 1: se leyeron {len(ordenes)} órdenes y ése es el tope de la consulta — "
            f"puede haber más sin revisar")

    # ── Nivel 4 — el día contra sus partes ─────────────────────────────────
    if recortado:
        # Comparar el día contra una suma de órdenes incompleta acusaría de descuadre a
        # un restaurante que está bien. Un falso positivo aquí cuesta más que no medir.
        r["motivos"].append(
            f"nivel 4: no se compara — la lectura de órdenes topó en {LIMITE_ORDENES} y "
            f"la suma del día quedaría corta")
        return r

    try:
        diario = sb_get(
            "ops_daily_history",
            f"client_id=eq.{cid}&fecha=gte.{desde}&select=fecha,ventas_dia,tickets_count")
    except SupabaseError as e:
        r["motivos"].append(f"nivel 4: no se pudo leer el contrato — {e}")
        return r

    suma_por_dia: dict[str, float] = {}
    for o in ordenes:
        if str(o.get("status") or "") == "cancelada":
            continue
        f = str(o.get("created_at", ""))[:10]
        suma_por_dia[f] = suma_por_dia.get(f, 0) + dinero(o.get("total"))
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
            r["dias_descuadrados"].append((f, vista, crudo))

    r["nivel4"] = "ok"
    return r


def tenants() -> list[str]:
    pedido = (os.environ.get("CLIENT_ID") or "").strip()
    if pedido and pedido.upper() != "ALL":
        return [pedido]
    return sorted(r["id"] for r in sb_get("clients", "active=eq.true&select=id") if r.get("id"))


def main() -> int:
    # Con `| tee`, stdout queda con búfer de bloque y stderr no: los dos flujos salen
    # desordenados en el log y el motivo de una falla aparece antes que la falla.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass

    inicio = time.time()
    dias = int(os.environ.get("DIAS", "7"))
    total_fallas = 0
    sin_comprobar: list[tuple[str, list[str]]] = []
    eventos_perdidos = 0
    comprobados = 0

    try:
        lista = tenants()
    except SupabaseError as e:
        # Sin la lista de restaurantes no se revisó ninguno. Eso es un fallo del
        # verificador, no un veredicto sobre nadie.
        ms = int((time.time() - inicio) * 1000)
        print(f"[cuadre] ERROR: no se pudo leer la lista de restaurantes — {e}", file=sys.stderr)
        log_run("cuadre", "error", ms, error_message=str(e)[:500],
                data_status="error", tentacle="meta")
        return 1

    for cid in lista:
        os.environ["CLIENT_ID"] = cid
        try:
            r = revisar_tenant(cid, dias)
        except Exception as e:
            # Una excepción inesperada en un restaurante no puede dejar ciegos a los
            # demás: del 2026-09-02 al 09-08 un timeout en el primero (amalay) abortó
            # el bucle y los otros doce no se revisaron — con la corrida en verde.
            print(f"[cuadre] {cid}: ERROR inesperado — {e}", file=sys.stderr)
            sin_comprobar.append((cid, [f"error inesperado — {e}"]))
            continue

        fallas = sum(len(v) for v in r["por_codigo"].values()) + len(r["dias_descuadrados"])
        total_fallas += fallas

        niveles_malos = [n for n in ("nivel1", "nivel4") if r[n] != "ok"]
        if niveles_malos:
            sin_comprobar.append((cid, r["motivos"]))
            print(f"[cuadre] {cid}: {r['ordenes']} órdenes — NO SE PUDO COMPROBAR "
                  f"({', '.join(niveles_malos)})")
            for m in r["motivos"]:
                print(f"    {m}")
        else:
            comprobados += 1

        if fallas == 0:
            if not niveles_malos:
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
            if not log_event(
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
            ):
                # Un hallazgo que no se guarda es un hallazgo que se perdió. Ya pasó:
                # el 2026-08-26 el cuadre encontró 25 descuadres reales en boruca y
                # agent_events los rechazó todos, con la corrida en verde.
                eventos_perdidos += 1
        for f, vista, crudo in r["dias_descuadrados"]:
            print(f"    dia_vs_ordenes: {f} la vista dice ${vista:,.2f}, las órdenes suman ${crudo:,.2f}")
            if not log_event(
                agent_id="cuadre", event_type="descuadre",
                title=f"El día {f} no cuadra con sus órdenes",
                severity="warning", estimated_value=round(abs(vista - crudo), 2),
                evidence={"codigo": "dia_vs_ordenes", "fecha": f,
                          "vista": vista, "suma_ordenes": crudo},
                explanation=f"ops_daily_history dice ${vista:,.2f} y las órdenes suman ${crudo:,.2f}",
                suggested_action="Revisar la vista o las órdenes de ese día.",
                client_id=cid,
            ):
                eventos_perdidos += 1

    # ── Veredicto ──────────────────────────────────────────────────────────
    ms = int((time.time() - inicio) * 1000)
    resumen = (f"{comprobados}/{len(lista)} comprobados, "
               f"{total_fallas} descuadre(s)")
    if sin_comprobar:
        resumen += f", {len(sin_comprobar)} SIN COMPROBAR"
    if eventos_perdidos:
        resumen += f", {eventos_perdidos} hallazgo(s) no registrado(s)"

    print(f"\n[cuadre] {resumen}")
    if sin_comprobar:
        # A stdout a propósito: `tee` sólo captura stdout, y el paso "Resumen" del
        # workflow pega ese archivo en el resumen del job. Un motivo que sólo va a
        # stderr no aparece ahí — y el resumen es lo que alguien lee tres días después.
        print("[cuadre] sin comprobar:")
        for cid, motivos in sin_comprobar:
            for m in motivos:
                print(f"    {cid}: {m}")

    roto = bool(sin_comprobar) or eventos_perdidos > 0
    log_run("cuadre", "error" if roto else "success", ms, output_summary=resumen,
            error_message=("; ".join(f"{c}: {'; '.join(ms_)}"
                                     for c, ms_ in sin_comprobar)[:500] if sin_comprobar else ""),
            rows_processed=total_fallas,
            data_status="partial" if roto else "ok", tentacle="meta")

    # Un descuadre NO tumba la corrida: es un hallazgo, no un fallo del verificador.
    # Que salga en rojo escondería el día que el verificador sí se rompa.
    #
    # No haber podido comprobar SÍ la tumba. Es la regla 10 de docs/ai/ARQUITECTURA-CRUCE.md
    # ("fallar callado está prohibido"): un detector ciego que reporta verde es peor que
    # no tenerlo, porque los agentes de arriba leen su silencio como "todo cuadró".
    return 1 if roto else 0


if __name__ == "__main__":
    sys.exit(main())
