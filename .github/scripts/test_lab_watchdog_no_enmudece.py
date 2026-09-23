#!/usr/bin/env python3
"""Que el Lab Watchdog avise cuando encuentra algo — que es cuando dejó de avisar.

El detector llevaba desde su última corrida reventando EXACTAMENTE en el caso que
existe para cubrir. `main()` cuenta los críticos así:

    criticos = sum(1 for (_o, _k, s, _d) in {(*x[:3],) for x in all_issues} ...)

El `set` produce tuplas de TRES —`x[:3]`— y el `for` las desempaca en CUATRO
nombres. Con `all_issues` vacío el genexpr no itera y nada truena: el camino sano
pasa verde. Con un solo hallazgo, `ValueError` antes de `create_insight` y antes
de `send_telegram` (L141-152). O sea: el vigilante enmudece justo al detectar, y
el workflow queda rojo con un traceback que no dice nada del restaurante.

Por eso esta prueba NO va por `check_order` —sus reglas no están en duda— sino por
la agregación de `main()`, que es donde estaba el defecto. `criticos` es local, así
que se observa por donde sí sale: el `summary` que viaja a `log_run`,
`create_insight` y Telegram lo lleva escrito.

Los dos casos no son intercambiables:

  · SIN hallazgos  — el camino que YA pasaba verde. Si sólo se probara éste, el
    bug seguiría vivo y el test daría tranquilidad falsa.
  · CON hallazgos  — incluye un duplicado (mismo order_id+kind, detalle distinto)
    porque la deduplicación y el conteo de críticos usan criterios DISTINTOS, y un
    fixture sin duplicados no distingue uno del otro.

Corre sin red: todo lo que toca Supabase o Telegram está sustituido.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import lab_watchdog

fallos = 0


def revisar(nombre, obtenido, esperado):
    global fallos
    if obtenido == esperado:
        print(f"  ok   {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n        esperado: {esperado!r}\n        obtenido: {obtenido!r}")


def correr_main(orders, issues_por_orden):
    """Ejecuta main() con todo lo externo sustituido. Devuelve lo que intentó emitir."""
    visto = {"insights": [], "runs": [], "telegram": [], "issues_guardados": []}

    original = {k: getattr(lab_watchdog, k) for k in
                ("sb_get", "sb_post", "log_run", "create_insight", "send_telegram", "check_order", "CHAT_ID")}
    try:
        lab_watchdog.sb_get = lambda *a, **k: orders
        lab_watchdog.sb_post = lambda tabla, fila: visto["issues_guardados"].append((tabla, fila))
        lab_watchdog.log_run = lambda agente, estado, dur, **k: visto["runs"].append((estado, k.get("output_summary")))
        lab_watchdog.create_insight = lambda agente, area, sev, titulo, **k: visto["insights"].append((sev, titulo, k.get("summary")))
        lab_watchdog.send_telegram = lambda chat, texto: visto["telegram"].append(texto)
        lab_watchdog.check_order = lambda o: issues_por_orden.get(o["id"], [])
        lab_watchdog.CHAT_ID = "chat-de-prueba"
        lab_watchdog.main()
    finally:
        for k, v in original.items():
            setattr(lab_watchdog, k, v)
    return visto


# ── Caso 1 · sin hallazgos: el camino que nunca estuvo roto ───────────────────
print("sin hallazgos")
v = correr_main([{"id": "o1"}, {"id": "o2"}], {})
revisar("no se guarda ningún issue", v["issues_guardados"], [])
revisar("el run queda en success", [e for e, _ in v["runs"]], ["success"])
revisar("el insight es informativo", [s for s, _, _ in v["insights"]], ["info"])
revisar("no se manda Telegram", v["telegram"], [])

# ── Caso 2 · con hallazgos: donde el vigilante enmudecía ──────────────────────
#
# o1 reporta DOS veces el mismo (order_id, kind) con detalle distinto: la
# deduplicación de `seen` los cuenta como UNO. El conteo de críticos deduplica
# por (order_id, kind, severity), que aquí también los colapsa. Que los dos
# criterios coincidan en este fixture es lo que hace comparables los números.
print("con hallazgos")
v = correr_main(
    [{"id": "o1"}, {"id": "o2"}, {"id": "o3"}],
    {
        "o1": [("o1", "total_no_cuadra", "critical", "subtotal+iva != total"),
               ("o1", "total_no_cuadra", "critical", "otra vez, con otro detalle")],
        "o2": [("o2", "orden_huerfana", "high", "'abierta' desde hace >6h")],
        "o3": [],
    },
)

ESPERADO = "Revisó 3 órdenes · 2 problemas (1 críticos)"

revisar("el duplicado se guarda una sola vez", len(v["issues_guardados"]), 2)
revisar("se alcanza la rama de alerta (log_run warning)", [e for e, _ in v["runs"]], ["warning"])
revisar("el resumen cuenta bien problemas y críticos", [s for _, s in v["runs"]], [ESPERADO])
revisar("se crea el insight con severidad critical", [s for s, _, _ in v["insights"]], ["critical"])
revisar("el insight lleva el resumen correcto",
        [s.startswith(ESPERADO) for _, _, s in v["insights"]], [True])
revisar("SE MANDA TELEGRAM", len(v["telegram"]), 1)
revisar("el mensaje de Telegram lleva el resumen",
        [ESPERADO in t for t in v["telegram"]], [True])

print(f"\n{'TODO VERDE' if not fallos else str(fallos) + ' FALLA(S)'}")
sys.exit(1 if fallos else 0)
