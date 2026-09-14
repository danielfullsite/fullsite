#!/usr/bin/env python3
"""Que el vigilante de la flota grite cuando nadie reporta, y se calle cuando todo late.

La prueba que importa es `flota_muda_alerta`: el estado REAL del 2026-09-13, con
la tabla `local_server_heartbeats` en cero filas. Ese caso se ve identico a una
flota sana desde afuera — ninguna alerta llega en ninguno de los dos — y es
exactamente el agujero que este vigilante existe para tapar. Si ese test pasa a
verde con `alerta: False`, el vigilante dejo de servir.

La segunda que importa es `terminal_viva_pero_sufriendo`: una caja que reporta
puntual pero con la cola de sync crecida o impresiones fallando. Ver el numero y
callarse seria repetir el bug con pasos extra.

Corre sin red.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fleet_heartbeat import evaluar_flota, UMBRAL_MIN_DEFAULT

AHORA = datetime(2026, 9, 13, 20, 0, 0, tzinfo=timezone.utc)
fallos = 0


def revisar(nombre, obtenido, esperado):
    global fallos
    if obtenido == esperado:
        print(f"  ok    {nombre}")
    else:
        fallos += 1
        print(f"  FALLA {nombre}\n     esperaba {esperado!r}, obtuvo {obtenido!r}")


def fila(server_id, min_atras, cola=0, fallas=0, salud="ok", version="1.3.6"):
    return {
        "server_id":         server_id,
        "restaurant_id":     "amalay",
        "reported_at":       (AHORA - timedelta(minutes=min_atras)).isoformat(),
        "version":           version,
        "health_status":     salud,
        "sync_queue_size":   cola,
        "print_jobs_failed": fallas,
        "clients_connected": 2,
        "disk_free_mb":      40000,
    }


print("\nflota muda (el estado real medido el 2026-09-13)")
v = evaluar_flota([], AHORA, client_id="amalay")
revisar("alerta cuando NUNCA reporto nadie", v["alerta"], True)
revisar("status warning", v["status"], "warning")
revisar("el mensaje nombra la causa probable",
        "supabaseAnonKey" in v["mensaje"], True)
revisar("el mensaje dice como verificar",
        "[heartbeat]" in v["mensaje"], True)

print("\nflota sana")
v = evaluar_flota([fila("caja", 2), fila("pdv2", 4), fila("entrada", 1)],
                  AHORA, client_id="amalay")
revisar("sin alerta", v["alerta"], False)
revisar("status success", v["status"], "success")
revisar("cuenta las tres vivas", v["vivas"], 3)
revisar("no manda mensaje", v["mensaje"], None)

print("\nuna terminal se callo")
v = evaluar_flota([fila("caja", 2), fila("pdv2", 90)], AHORA, client_id="amalay")
revisar("alerta", v["alerta"], True)
revisar("una viva", v["vivas"], 1)
revisar("una muda", v["mudas"], 1)
revisar("nombra la terminal callada", "pdv2" in v["mensaje"], True)
revisar("dice hace cuanto", "hace 90 min" in v["mensaje"], True)

print("\nel umbral no alerta por un reinicio")
# 5 latidos perdidos es el umbral; 20 min (4 latidos) todavia no alerta.
v = evaluar_flota([fila("caja", 20)], AHORA, client_id="amalay")
revisar("20 min todavia es viva", v["alerta"], False)
v = evaluar_flota([fila("caja", 26)], AHORA, client_id="amalay")
revisar("26 min ya es muda", v["alerta"], True)
revisar("el default son 25 min", UMBRAL_MIN_DEFAULT, 25)

print("\nterminal viva pero sufriendo")
v = evaluar_flota([fila("caja", 2, cola=120)], AHORA, client_id="amalay")
revisar("cola de sync crecida alerta", v["alerta"], True)
revisar("la reporta como viva, no como muda", v["mudas"], 0)
revisar("nombra la cola", "cola sync: 120" in v["mensaje"], True)

v = evaluar_flota([fila("caja", 2, fallas=3)], AHORA, client_id="amalay")
revisar("una sola impresion fallida ya alerta", v["alerta"], True)

v = evaluar_flota([fila("caja", 2, salud="degraded")], AHORA, client_id="amalay")
revisar("salud degradada alerta", v["alerta"], True)

v = evaluar_flota([fila("caja", 2, cola=10)], AHORA, client_id="amalay")
revisar("una cola chica NO alerta (offline normal)", v["alerta"], False)

print("\nse queda con el reporte mas reciente de cada terminal")
# La tabla acumula historia; dos filas de la misma caja no son dos terminales.
v = evaluar_flota([fila("caja", 2), fila("caja", 400)], AHORA, client_id="amalay")
revisar("una sola terminal", v["vivas"], 1)
revisar("sin alerta: el mas reciente manda", v["alerta"], False)

print("\nfila sin fecha")
mala = fila("caja", 2)
mala["reported_at"] = None
v = evaluar_flota([mala], AHORA, client_id="amalay")
revisar("una terminal sin fecha cuenta como muda", v["mudas"], 1)
revisar("y alerta", v["alerta"], True)

print()
if fallos:
    print(f"FALLARON {fallos} revisiones")
    sys.exit(1)
print("todas las revisiones pasaron")
