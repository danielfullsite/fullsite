#!/usr/bin/env python3
"""
Lab Watchdog — el revisor de workflow del laboratorio 24/7.

Revisa TODO el flujo del restaurante-lab y caza bugs/inconsistencias ANTES de que
lleguen a un cliente real ("que no truene nadita"): totales que no cuadran, órdenes
cerradas sin pago, items mal formados, órdenes huérfanas atoradas, estados inválidos,
KDS inconsistente. Registra cada hallazgo en lab_issues + agent_insights + Telegram.

Corre en cron después del simulador. Solo lee/valida — no altera órdenes.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID_DANIEL,
     CLIENT_ID (default lab-resto).
"""

import os
import sys
import time
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get, sb_post, log_run, create_insight, send_telegram

CLIENT_ID = os.environ.get("CLIENT_ID", "lab-resto")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
TOL = 0.5  # tolerancia en pesos para cuadres
VALID_STATUS = {"abierta", "enviada", "preparando", "lista", "cerrada", "cancelada", "anulada"}
IVA_RATE = 0.16


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def check_order(o):
    """Devuelve lista de (kind, severity, detail) para una orden."""
    issues = []
    oid = o.get("id")
    status = o.get("status")
    items = o.get("items") or []
    subtotal = num(o.get("subtotal"))
    iva = num(o.get("iva"))
    total = num(o.get("total"))
    desc = num(o.get("descuento"))

    if status not in VALID_STATUS:
        issues.append(("estado_invalido", "high", f"status '{status}' no es válido"))

    if total < 0 or subtotal < 0:
        issues.append(("monto_negativo", "critical", f"subtotal={subtotal} total={total}"))

    # items bien formados + subtotal = suma de items
    if not items:
        issues.append(("sin_items", "high", "orden sin items"))
    else:
        suma = 0.0
        for i, it in enumerate(items):
            if not it.get("nombre") or it.get("precio") is None or it.get("cantidad") is None:
                issues.append(("item_malformado", "high", f"item[{i}] incompleto: {it}"))
            else:
                suma += num(it.get("precio")) * num(it.get("cantidad"))
        if abs(suma - subtotal) > TOL:
            issues.append(("subtotal_no_cuadra", "high", f"suma items={suma:.2f} vs subtotal={subtotal:.2f}"))

    # total = subtotal + iva - descuento
    if abs((subtotal + iva - desc) - total) > TOL:
        issues.append(("total_no_cuadra", "high", f"subtotal+iva-desc={subtotal+iva-desc:.2f} vs total={total:.2f}"))

    # iva razonable respecto a subtotal
    if subtotal > 0 and abs(iva - round(subtotal * IVA_RATE, 2)) > max(TOL, subtotal * 0.02):
        issues.append(("iva_sospechoso", "medium", f"iva={iva:.2f} esperado≈{subtotal*IVA_RATE:.2f}"))

    # orden cerrada sin pago / sin closed_at
    if status == "cerrada":
        if not o.get("closed_at"):
            issues.append(("cerrada_sin_fecha", "high", "cerrada sin closed_at"))
        if not o.get("metodo_pago") and not o.get("pagos"):
            issues.append(("cerrada_sin_pago", "critical", "cerrada sin método de pago ni pagos"))

    # KDS consistente con items
    kds = o.get("kds_item_status") or {}
    if isinstance(kds, dict):
        for k in kds:
            try:
                if int(k) >= len(items):
                    issues.append(("kds_indice_fuera", "medium", f"kds key {k} > items ({len(items)})"))
            except ValueError:
                issues.append(("kds_key_invalida", "low", f"kds key no numérica: {k}"))

    # órdenes huérfanas: abiertas viejas (atoradas)
    if status in ("abierta", "enviada", "preparando"):
        ca = o.get("created_at")
        if ca:
            try:
                created = datetime.fromisoformat(ca.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - created > timedelta(hours=6):
                    issues.append(("orden_huerfana", "high", f"'{status}' desde hace >6h ({ca})"))
            except ValueError:
                pass

    return [(oid, k, s, d) for (k, s, d) in issues]


def main():
    start = time.time()
    try:
        orders = sb_get(
            "pos_orders",
            f"client_id=eq.{CLIENT_ID}&select=id,status,items,subtotal,iva,total,descuento,metodo_pago,pagos,closed_at,kds_item_status,created_at&order=created_at.desc&limit=400",
        )
        all_issues = []
        for o in orders:
            all_issues.extend(check_order(o))

        # Registrar hallazgos (evita duplicar el mismo order_id+kind)
        seen = set()
        for oid, kind, sev, detail in all_issues:
            key = (oid, kind)
            if key in seen:
                continue
            seen.add(key)
            try:
                sb_post("lab_issues", {"client_id": CLIENT_ID, "order_id": oid, "kind": kind, "severity": sev, "detail": detail})
            except Exception as e:
                print(f"[lab-watchdog] no pude guardar issue: {e}", file=sys.stderr)

        n = len(seen)
        criticos = sum(1 for (_o, _k, s, _d) in {(*x[:3],) for x in all_issues} if s == "critical")
        dur = int((time.time() - start) * 1000)
        summary = f"Revisó {len(orders)} órdenes · {n} problemas ({criticos} críticos)"
        print(f"[lab-watchdog] {summary}")

        if n == 0:
            log_run("lab-watchdog", "success", dur, output_summary=f"Revisó {len(orders)} órdenes · TODO cuadra",
                    tentacle="lab", rows_processed=len(orders))
            create_insight("lab-watchdog", "operations", "info", "Lab 24/7 sano",
                           summary=f"{len(orders)} órdenes revisadas, 0 problemas.", client_id=CLIENT_ID)
        else:
            sev = "critical" if criticos else "high"
            # top tipos de problema
            kinds = {}
            for _oid, k, _s, _d in all_issues:
                kinds[k] = kinds.get(k, 0) + 1
            top = ", ".join(f"{k}×{v}" for k, v in sorted(kinds.items(), key=lambda x: -x[1])[:5])
            log_run("lab-watchdog", "warning", dur, output_summary=summary, tentacle="lab", rows_processed=len(orders))
            create_insight("lab-watchdog", "operations", sev, f"{n} problemas en el flujo del lab",
                           summary=f"{summary}. Tipos: {top}", client_id=CLIENT_ID)
            if CHAT_ID:
                send_telegram(CHAT_ID, f"\U0001F6A8 <b>Lab Watchdog</b>\n{summary}\nTipos: {top}")
    except Exception as e:
        dur = int((time.time() - start) * 1000)
        print(f"[lab-watchdog] ERROR: {e}", file=sys.stderr)
        log_run("lab-watchdog", "error", dur, error_message=str(e), tentacle="lab")
        raise


if __name__ == "__main__":
    main()
