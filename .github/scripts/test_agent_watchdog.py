#!/usr/bin/env python3
"""Que el vigilante detecte a los que se callaron sin gritarle a los que no.

La prueba que importa es `rafaga_no_es_muerte`: varios agentes de Fullsite
escriben 6 filas en el mismo minuto (un workflow que corre 6 scripts), así que su
hueco MEDIANO entre corridas es 0.0h. Con un umbral de "3x la mediana" darían
3*0 = 0 y saldrían marcados como muertos siempre. Medido el 2026-08-26:
waste-detector, antifraud-agent, staffing-optimizer, menu-engineering y
supplier-monitor tienen mediana 0.0h y están sanos.

Corre sin red.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "https://ejemplo.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "prueba")
sys.path.insert(0, str(Path(__file__).parent))

import agent_watchdog as w

AHORA = w.ahora
fallos = 0


def revisar(nombre, obtenido, esperado):
    global fallos
    if obtenido == esperado:
        print(f"  ok    {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n     esperaba {esperado!r}, obtuvo {obtenido!r}")


def fila(agente, horas_atras, estado="success", error=None):
    return {
        "agent_id":   agente,
        "status":     estado,
        "created_at": (AHORA - timedelta(hours=horas_atras)).isoformat(),
        "error_message": error,
    }


print("── la trampa de las ráfagas ──")
# 6 corridas en el mismo minuto, hace 3 días, y otra ráfaga hace 2h.
# Hueco mediano = 0.0h. Un umbral basado en la mediana lo mataría.
rafaga = ([fila("en-rafaga", 72 + i * 0.001) for i in range(6)]
          + [fila("en-rafaga", 2 + i * 0.001) for i in range(6)])
revisar("ráfaga reciente NO es muerte",
        w.diagnosticar(rafaga)["en-rafaga"]["estado"], "ok")

print("── detecta a los que se callaron ──")
# Corría cada ~24h durante 10 días, y lleva 40 días sin aparecer.
regular = [fila("regular", 960 + i * 24) for i in range(10)]
revisar("40 días de silencio en un diario = mudo",
        w.diagnosticar(regular)["regular"]["estado"], "mudo")

# Corre cada hora y lleva 3h sin correr: dentro del piso de 6h, no se avisa.
frecuente = [fila("frecuente", 3 + i) for i in range(12)]
revisar("3h de silencio en uno horario NO es mudo",
        w.diagnosticar(frecuente)["frecuente"]["estado"], "ok")

print("── estados de la última corrida ──")
revisar("última en error = roto",
        w.diagnosticar([fila("x", 1, "error", "algo truena")])["x"]["estado"], "roto")
revisar("no_data no es roto",
        w.diagnosticar([fila("y", 1, "no_data")])["y"]["estado"], "ok")
revisar("skipped no es roto",
        w.diagnosticar([fila("z", 1, "skipped")])["z"]["estado"], "ok")
revisar("warning no es roto",
        w.diagnosticar([fila("k", 1, "warning")])["k"]["estado"], "ok")

print("── sin historia suficiente no se inventa umbral ──")
revisar("2 corridas no alcanzan para llamarlo mudo",
        w.diagnosticar([fila("nuevo", 500), fila("nuevo", 400)])["nuevo"]["estado"], "ok")

print("── el vigilante no se vigila a sí mismo ──")
revisar("se excluye de su propio diagnóstico",
        w.YO in w.diagnosticar([fila(w.YO, 1, "error")]), False)

print("── el techo absoluto: muertos sin historia suficiente ──")
# menu-sync tenía 1 corrida en la ventana y 59 días callado: sin techo salía "ok".
revisar("1 corrida y 40 días callado = mudo",
        w.diagnosticar([fila("sin-historia", 960)])["sin-historia"]["estado"], "mudo")
revisar("1 corrida y 10 días callado sigue ok",
        w.diagnosticar([fila("reciente-sin-historia", 240)])["reciente-sin-historia"]["estado"],
        "ok")

print("── histéresis: no parpadear en la línea ──")
# Cadencia de 24h → umbral 3*24 = 72h. Para salir de mudo hay que bajar de 36h.
diario = lambda calla: [fila("oscilante", calla)] + [fila("oscilante", calla + 24 * i)
                                                    for i in range(1, 8)]
revisar("sano a 60h (bajo su umbral de 72h) = ok",
        w.diagnosticar(diario(60), antes={})["oscilante"]["estado"], "ok")
revisar("sano a 80h (sobre 72h) = mudo",
        w.diagnosticar(diario(80), antes={})["oscilante"]["estado"], "mudo")
revisar("ya mudo, a 50h NO se recupera todavía",
        w.diagnosticar(diario(50), antes={"oscilante": "mudo"})["oscilante"]["estado"], "mudo")
revisar("ya mudo, a 20h (bajo la mitad) sí se recupera",
        w.diagnosticar(diario(20), antes={"oscilante": "mudo"})["oscilante"]["estado"], "ok")

print("── el percentil aguanta casos borde ──")
revisar("lista vacía da 0",          w.percentil([], 0.9), 0.0)
revisar("un solo valor se devuelve", w.percentil([5.0], 0.9), 5.0)
revisar("p90 de 1..10 es 9",         w.percentil([float(i) for i in range(1, 11)], 0.9), 9.0)

print()
if fallos:
    print(f"agent_watchdog: {fallos} FALLARON")
    sys.exit(1)
print("agent_watchdog: 19/19 ok")
