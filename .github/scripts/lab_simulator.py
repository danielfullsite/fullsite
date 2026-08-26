#!/usr/bin/env python3
"""
Lab Simulator — el laboratorio-restaurante 24/7.

Simula la operación real de un restaurante sobre el tenant sintético (lab-resto):
meseros crean órdenes, cocina las avanza por el KDS, caja las cobra. Cada corrida
mueve el flujo un poco; a lo largo del día se construye un servicio realista que
ejercita POS -> KDS -> pago. El watchdog (lab_watchdog.py) revisa que todo cuadre.

Corre en cron (GitHub Actions). Escribe directo a pos_orders con service key para
el tenant del lab. NO toca a ningún cliente real (aislado por client_id).

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID (default lab-resto).
"""

import os
import sys
import time
import random
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get, sb_post, sb_patch, log_run

CLIENT_ID = os.environ.get("CLIENT_ID", "lab-resto")
IVA_RATE = 0.16

MESEROS = ["Fernanda del Río", "Sebastián Icaza", "Regina Barragán", "Patricio Elizondo", "Valentina Sada"]
# Restaurante PREMIUM (fine dining). (nombre, precio, estación)
MENU = [
    ("Wagyu A5 200g", 1280, "cocina"), ("Langosta Thermidor", 980, "cocina"),
    ("Ribeye Prime 400g", 720, "cocina"), ("Atún Sellado", 560, "cocina"),
    ("Risotto de Trufa", 480, "cocina"), ("Foie Gras", 620, "cocina"),
    ("Rack de Cordero", 690, "cocina"), ("Pulpo a la Brasa", 520, "cocina"),
    ("Carpaccio de Res", 340, "barra"), ("Ostras (6)", 420, "barra"),
    ("Copa Malbec Reserva", 280, "barra"), ("Cóctel de autor", 240, "barra"),
    ("Agua mineral", 90, "barra"),
    ("Crème Brûlée", 190, "caja"), ("Soufflé de Chocolate", 210, "caja"),
]
PAGOS = ["Tarjeta de crédito", "Efectivo", "Tarjeta de débito", "Transferencia"]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def next_order_number():
    rows = sb_get("pos_orders", f"client_id=eq.{CLIENT_ID}&select=order_number&order=order_number.desc&limit=1")
    return (rows[0]["order_number"] + 1) if rows and rows[0].get("order_number") else 1


# El menú del propio restaurante, cuando lo tiene.
#
# MENU (arriba) es una carta de steakhouse: Wagyu A5 a $1,280, langosta a $980. Coherente
# para el lab, que no tiene menú propio en la base. Pero apuntar el simulador a `demo`
# con esa carta convirtió al demo en OTRO NEGOCIO de un día para otro:
#
#   históricas del demo   1,203 órdenes, ticket promedio $418   (rango $30–$1,365)
#   generadas con MENU       11 órdenes, ticket promedio $4,945 (rango $1,195–$12,992)
#
# Doce veces el ticket. Cualquier agente que compare hoy contra la historia grita
# "anomalía" — y tiene razón, pero por el motivo equivocado. Y un prospecto ve un ticket
# de $12,992 al lado de un promedio de $418 y sabe que le están enseñando algo falso.
#
# Se lee el menú real del tenant. Si no tiene (el caso de lab-resto), se usa MENU y el
# lab se comporta EXACTAMENTE igual que antes.
_menu_cache = None


def menu_del_tenant():
    """[(nombre, precio, estación)] del restaurante, o el MENU de respaldo."""
    global _menu_cache
    if _menu_cache is not None:
        return _menu_cache
    try:
        filas = sb_get(
            "pos_menu_items",
            f"client_id=eq.{CLIENT_ID}&active=eq.true&select=name,price&limit=200",
        )
        propio = [(f["name"], float(f["price"]), "cocina")
                  for f in filas if f.get("name") and f.get("price")]
        if propio:
            print(f"[lab-simulator] menú de {CLIENT_ID}: {len(propio)} platillos "
                  f"(promedio ${sum(p for _, p, _ in propio)/len(propio):,.0f})")
            _menu_cache = propio
            return _menu_cache
    except Exception as e:
        print(f"[lab-simulator] no se pudo leer el menú de {CLIENT_ID}: {e}", file=sys.stderr)

    print(f"[lab-simulator] {CLIENT_ID} no tiene menú propio — se usa el de respaldo")
    _menu_cache = MENU
    return _menu_cache


def make_order(seq):
    carta = menu_del_tenant()
    n_items = random.randint(2, 5)
    items = []
    for _ in range(n_items):
        nombre, precio, est = random.choice(carta)
        cant = random.randint(1, 3)
        items.append({"nombre": nombre, "precio": precio, "cantidad": cant, "estacion": est})
    subtotal = sum(i["precio"] * i["cantidad"] for i in items)
    iva = round(subtotal * IVA_RATE, 2)
    total = round(subtotal + iva, 2)
    oid = f"lab-{int(time.time()*1000)}-{seq}-{random.randint(100,999)}"
    # turno_id requerido por el constraint pos_orders_turno_id_check (salvo QR abierto).
    turno = f"lab-turno-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
    return {
        "id": oid, "client_id": CLIENT_ID, "mesa": random.randint(1, 24),
        "mesero": random.choice(MESEROS), "personas": random.randint(1, 6),
        "status": "abierta", "subtotal": subtotal, "iva": iva, "total": total,
        "descuento": 0, "items": items, "kds_item_status": {},
        "turno_id": turno,
        "order_number": next_order_number() + seq, "created_at": now_iso(),
    }


def advance_to_kitchen(order):
    """abierta -> enviada, marca items en el KDS como 'preparando'."""
    kds = {str(idx): "preparando" for idx in range(len(order.get("items", [])))}
    sb_patch("pos_orders", f"id=eq.{order['id']}", {
        "status": "enviada", "kds_item_status": kds, "updated_at": now_iso(),
    })


def close_order(order):
    """enviada/preparando -> cerrada (cobrada). Marca items 'listo', agrega pago."""
    kds = {str(idx): "listo" for idx in range(len(order.get("items", [])))}
    metodo = random.choice(PAGOS)
    propina = round(float(order["total"]) * random.uniform(0.08, 0.15), 2)
    sb_patch("pos_orders", f"id=eq.{order['id']}", {
        "status": "cerrada", "kds_item_status": kds, "metodo_pago": metodo,
        "propina": propina, "pagos": [{"metodo": metodo, "monto": order["total"]}],
        "closed_at": now_iso(), "updated_at": now_iso(),
    })


# Curva de un restaurante de verdad, por hora local (0–23).
#
# El simulador nació generando el MISMO volumen a toda hora, y por eso lab-resto tiene
# órdenes a las 4 de la mañana: 109 a las 4am, 133 a las 5am, y sólo 3 a las 6pm —
# medido el 2026-08-26. O sea, un restaurante que nunca cierra y que está muerto justo
# a la hora de la cena. Para un laboratorio da igual; para un DEMO que se le enseña a un
# restaurantero, es lo primero que va a notar que está mal.
#
# Los factores multiplican el volumen base. 0.0 = cerrado.
CURVA_RESTAURANTE = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,   # 00–06 cerrado
    0.3, 0.6, 0.8, 0.7, 0.9,             # 07–11 desayuno
    1.3, 1.6, 1.4, 0.8,                  # 12–15 comida (pico)
    0.4, 0.5, 0.9,                       # 16–18 tarde floja
    1.5, 1.6, 1.2,                       # 19–21 cena (pico)
    0.6, 0.3,                            # 22–23 cierre
]


def factor_de_la_hora() -> float:
    """1.0 = volumen base. Sólo aplica si CURVA_HORARIA está encendida.

    Apagada por omisión a propósito: el lab existente depende de su volumen parejo y
    este cambio no debe alterarlo. Se enciende por tenant, desde el workflow.
    """
    if os.environ.get("CURVA_HORARIA", "").strip().lower() not in ("1", "true", "si", "sí"):
        return 1.0
    tz = os.environ.get("TZ_LOCAL", "America/Monterrey")
    try:
        from zoneinfo import ZoneInfo
        hora = datetime.now(ZoneInfo(tz)).hour
    except Exception:
        hora = datetime.utcnow().hour  # sin zona, mejor seguir que tronar
    return CURVA_RESTAURANTE[hora % 24]


def main():
    start = time.time()
    created = advanced = closed = 0
    try:
        # 1) Crear órdenes nuevas (servicio premium entrando — más volumen)
        factor = factor_de_la_hora()
        if factor == 0.0:
            # Cerrado. No se crean órdenes, pero SÍ se cierran las que quedaron
            # abiertas — un restaurante que cierra cobra lo que tiene en mesa.
            n_new = 0
        else:
            n_new = max(1, round(random.randint(4, 9) * factor))
        base_seq = 0
        for s in range(n_new):
            order = make_order(base_seq + s)
            sb_post("pos_orders", order)
            created += 1

        # 2) Avanzar a cocina algunas abiertas
        abiertas = sb_get("pos_orders", f"client_id=eq.{CLIENT_ID}&status=eq.abierta&select=id,items&order=created_at.asc&limit=15")
        for o in abiertas:
            if random.random() < 0.7:
                advance_to_kitchen(o)
                advanced += 1

        # 3) Cobrar algunas enviadas
        enviadas = sb_get("pos_orders", f"client_id=eq.{CLIENT_ID}&status=eq.enviada&select=id,items,total&order=created_at.asc&limit=15")
        for o in enviadas:
            if random.random() < 0.6:
                close_order(o)
                closed += 1

        dur = int((time.time() - start) * 1000)
        # El tenant va en el resumen porque agent_runs NO tiene columna de client_id:
        # con dos restaurantes corriendo este mismo script, "lab sim: +6" no dice de
        # cuál habla. Es la única forma de distinguirlos hoy.
        estado = "cerrado" if factor == 0.0 else f"factor {factor:.1f}"
        summary = (f"[{CLIENT_ID}] {estado} · +{created} órdenes, "
                   f"{advanced} a cocina, {closed} cobradas")
        print(f"[lab-simulator] {summary}")
        log_run("lab-simulator", "success", dur, output_summary=summary,
                tentacle="lab", rows_processed=created + advanced + closed)
    except Exception as e:
        dur = int((time.time() - start) * 1000)
        print(f"[lab-simulator] ERROR: {e}", file=sys.stderr)
        log_run("lab-simulator", "error", dur, error_message=str(e), tentacle="lab")
        raise


if __name__ == "__main__":
    main()
