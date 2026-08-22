"""
Fuente diaria canónica para los agentes de IA — espejo Python de dashboard-app/src/lib/pos-daily.ts.

Devuelve filas con la MISMA forma que ops_daily_history/live (meseros / ventas_por_grupo /
platillos_top / pago_metodos como arrays), para que los agentes NO cambien su lógica de
parseo — solo su fuente de datos.

Tenant-aware:
- Clones (data viva en pos_orders) → vistas OCM (ocm_daily + ocm_waiter_rankings + ocm_menu_groups),
  que agregan pos_orders VIVO por tenant. Así un clon "sabe su info" sin sembrar nada.
- Tenants legacy en transición (AMALAY: todavía factura en Wansoft, su pos_orders es de PRUEBA
  ~2.8% de la venta real) → siguen leyendo ops_daily_history/live legacy, BYTE-IDÉNTICO a hoy,
  hasta el cutover del POS. Quitar 'amalay' de LEGACY_DAILY_TENANTS ese día.
  Ver docs/platform/CLONABILITY-FULL-ANALYSIS.md §3.

Regla: ninguna superficie de IA vuelve a acoplarse a wansoft_* como fuente nueva.
"""

import os
import requests

_SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
_SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
_H = {"apikey": _SUPABASE_KEY, "Authorization": f"Bearer {_SUPABASE_KEY}"}

# Tenants que aún NO tienen su venta real en pos_orders (transición). Quitar al hacer cutover.
LEGACY_DAILY_TENANTS = {"amalay"}


def uses_legacy(client: dict) -> bool:
    """True si el tenant sigue en su fuente diaria legacy (ops_daily_*) en vez de OCM."""
    return client.get("id") in LEGACY_DAILY_TENANTS


def _get(table: str, params: dict) -> list:
    r = requests.get(f"{_SUPABASE_URL}/rest/v1/{table}", headers=_H, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def _ocm_scalars(client_id: str, extra: dict) -> list:
    """Filas escalares de ocm_daily; dedup por fecha (por si hubiera varias fuentes)."""
    rows = _get("ocm_daily", {"client_id": f"eq.{client_id}", "select": "*", **extra})
    seen, out = set(), []
    for r in rows:
        if r["fecha"] in seen:
            continue
        seen.add(r["fecha"])
        out.append(r)
    return out


def _attach_relational(client_id: str, rows: list) -> list:
    """Adjunta meseros[] (de ocm_waiter_rankings) y ventas_por_grupo[] (de ocm_menu_groups)
    a cada fila, reconstruyendo la forma jsonb-por-fila que esperan los agentes."""
    if not rows:
        return rows
    fechas = sorted({r["fecha"] for r in rows})
    in_clause = "in.(" + ",".join(fechas) + ")"
    waiters = _get("ocm_waiter_rankings", {
        "client_id": f"eq.{client_id}", "fecha": in_clause,
        "select": "fecha,mesero,ventas,tickets,personas,propinas", "order": "ventas.desc",
    })
    groups = _get("ocm_menu_groups", {
        "client_id": f"eq.{client_id}", "fecha": in_clause,
        "select": "fecha,grupo,ventas,cantidad", "order": "ventas.desc",
    })
    m_by_fecha: dict = {}
    for w in waiters:
        m_by_fecha.setdefault(w["fecha"], []).append(
            {"nombre": w.get("mesero"), "total": round(float(w.get("ventas") or 0))}
        )
    g_by_fecha: dict = {}
    for g in groups:
        g_by_fecha.setdefault(g["fecha"], []).append(
            {"nombre": g.get("grupo"), "total": round(float(g.get("ventas") or 0)),
             "cantidad": g.get("cantidad")}
        )
    for r in rows:
        r["meseros"] = m_by_fecha.get(r["fecha"], [])
        r["ventas_por_grupo"] = g_by_fecha.get(r["fecha"], [])
        # OCM aún no expone platillos ni desglose de pagos como arrays → vacíos (degradación explícita)
        r.setdefault("platillos_top", [])
        r.setdefault("pago_metodos", [])
    return rows


# ─── API pública (mismos 3 patrones de acceso que usan los agentes) ───────────

def daily_today(client: dict, business_date: str):
    """Fila de HOY (equivalente a ops_daily_live para business_date). dict o None."""
    if uses_legacy(client):
        rows = _get("ops_daily_live", {
            "client_id": f"eq.{client['id']}", "fecha": f"eq.{business_date}",
            "select": "*", "order": "generated_at.desc", "limit": "1",
        })
        return rows[0] if rows else None
    rows = _ocm_scalars(client["id"], {"fecha": f"eq.{business_date}", "limit": "1"})
    rows = _attach_relational(client["id"], rows)
    return rows[0] if rows else None


def daily_by_dates(client: dict, fechas: list) -> list:
    """Filas para una lista de fechas específicas (mismo DOW histórico, comparativos)."""
    fechas = [f for f in fechas if f]
    if not fechas:
        return []
    if uses_legacy(client):
        out = []
        for fch in fechas:
            out += _get("ops_daily_history", {
                "client_id": f"eq.{client['id']}", "fecha": f"eq.{fch}", "select": "*", "limit": "1",
            })
        return out
    in_clause = "in.(" + ",".join(fechas) + ")"
    rows = _ocm_scalars(client["id"], {"fecha": in_clause, "order": "fecha.desc"})
    return _attach_relational(client["id"], rows)


def daily_recent(client: dict, n: int) -> list:
    """Últimos N días con ventas, orden fecha DESC."""
    if uses_legacy(client):
        return _get("ops_daily_history", {
            "client_id": f"eq.{client['id']}", "select": "*",
            "order": "fecha.desc", "limit": str(n),
        })
    rows = _ocm_scalars(client["id"], {"order": "fecha.desc", "limit": str(n)})
    return _attach_relational(client["id"], rows)
