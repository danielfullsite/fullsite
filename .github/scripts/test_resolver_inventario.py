#!/usr/bin/env python3
"""Pruebas de `resolver_inventario.py` — la calificación automática.

Lo que se fija aquí es que el calificador NO invente veredictos. Un número de precisión
sirve exactamente en la medida en que su denominador sea honesto: si lo indeterminado se
empuja a "acertó", la precisión sube sin que nada haya mejorado, que es la forma más fácil
de mentirse con métricas.

Se corre con: python3 .github/scripts/test_resolver_inventario.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_URL", "https://test.local")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test")

import resolver_inventario as R  # noqa: E402

FALLOS: list[str] = []


def check(nombre: str, cond: bool, detalle: str = "") -> None:
    if cond:
        print(f"  ✓ {nombre}")
    else:
        FALLOS.append(f"{nombre} — {detalle}")
        print(f"  ✗ {nombre} — {detalle}")


def evento(dias_atras: float, con_spec: bool = True, ventana: int = 3) -> dict:
    creado = datetime.now(timezone.utc) - timedelta(days=dias_atras)
    ev = {"items": [{"id": "ing-1", "name": "Café"}], "count": 1}
    if con_spec:
        ev["verificacion"] = {
            "metodo": "pos_inventory_movements",
            "ventana_dias": ventana,
            "ingrediente_ids": ["ing-1"],
            "desmiente": ["deduction", "recipe_deduction", "waste", "adjustment"],
            "confirma": ["restock", "entry", "invoice_entry"],
        }
    return {"id": "evt-0001", "type": "out_of_stock", "evidence": ev, "created_at": creado.isoformat()}


def con_movimientos(tipos: list[str]):
    """Sustituye la consulta de movimientos por una lista fija."""
    R.movimientos = lambda *a, **k: [{"movement_type": t, "ingredient_id": "ing-1"} for t in tipos]


print("\nresolver_inventario — calificación automática\n")

# ── No califica antes de tiempo ───────────────────────────────────────────────
con_movimientos([])
outcome, motivo = R.calificar(evento(dias_atras=0.5), "amalay")
check("no califica dentro de su ventana", outcome is None and "ventana" in motivo, motivo)

# ── Indeterminado se queda sin calificar ──────────────────────────────────────
con_movimientos([])
outcome, motivo = R.calificar(evento(dias_atras=5), "amalay")
check("sin movimientos NO inventa veredicto", outcome is None, f"devolvió {outcome}")

con_movimientos(["reversal"])
outcome, _ = R.calificar(evento(dias_atras=5), "amalay")
check("movimiento no listado queda indeterminado", outcome is None, f"devolvió {outcome}")

# ── Desmentido ────────────────────────────────────────────────────────────────
for tipo in ("deduction", "recipe_deduction", "waste", "adjustment"):
    con_movimientos([tipo])
    outcome, _ = R.calificar(evento(dias_atras=5), "amalay")
    check(f"'{tipo}' desmiente el hallazgo", outcome == "false_positive", f"devolvió {outcome}")

# ── Confirmado ────────────────────────────────────────────────────────────────
for tipo in ("restock", "entry", "invoice_entry"):
    con_movimientos([tipo])
    outcome, _ = R.calificar(evento(dias_atras=5), "amalay")
    check(f"'{tipo}' confirma el hallazgo", outcome == "correct", f"devolvió {outcome}")

# ── Conflicto: la salida gana ─────────────────────────────────────────────────
con_movimientos(["restock", "deduction"])
outcome, motivo = R.calificar(evento(dias_atras=5), "amalay")
check(
    "si hubo salida Y entrada, gana el desmentido",
    outcome == "false_positive",
    f"devolvió {outcome} — si el sistema dijo 'no hay' y aun así se descontó, había",
)

# ── Eventos viejos sin regla ──────────────────────────────────────────────────
con_movimientos(["deduction"])
outcome, motivo = R.calificar(evento(dias_atras=5, con_spec=False), "amalay")
check("evento sin regla de verificación NO se califica", outcome is None, motivo)

# ── La regla viene del evento, no del script ──────────────────────────────────
con_movimientos([])
outcome, motivo = R.calificar(evento(dias_atras=5, ventana=30), "amalay")
check(
    "respeta la ventana escrita en el evento, no una del script",
    outcome is None and "30" in motivo,
    motivo,
)

print()
if FALLOS:
    print(f"{len(FALLOS)} fallo(s):")
    for f in FALLOS:
        print(f"  - {f}")
    sys.exit(1)
print("todas pasaron\n")
