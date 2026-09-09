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
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get, sb_post, sb_patch, log_run
import pos_client
import pos_turno

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
    """[(menu_item_id, nombre, precio, estación)] del restaurante, o el MENU de respaldo.

    El `id` NO es decorativo: es por donde el reconciliador de inventario encuentra la
    receta. `r1_reconcile_item` resuelve la política y la receta activa POR
    `menu_item_id` — no por el nombre del platillo. Sin él la orden se cobra y no
    consume un solo gramo.
    """
    global _menu_cache
    if _menu_cache is not None:
        return _menu_cache
    try:
        filas = sb_get(
            "pos_menu_items",
            f"client_id=eq.{CLIENT_ID}&active=eq.true&select=id,name,price&limit=200",
        )
        propio = [(f["id"], f["name"], float(f["price"]), "cocina")
                  for f in filas if f.get("id") and f.get("name") and f.get("price")]
        if propio:
            print(f"[lab-simulator] menú de {CLIENT_ID}: {len(propio)} platillos "
                  f"(promedio ${sum(p for _, _, p, _ in propio)/len(propio):,.0f})")
            _menu_cache = propio
            return _menu_cache
    except Exception as e:
        print(f"[lab-simulator] no se pudo leer el menú de {CLIENT_ID}: {e}", file=sys.stderr)

    print(f"[lab-simulator] {CLIENT_ID} no tiene menú propio — se usa el de respaldo")
    # Sin id: el menú de respaldo no existe en `pos_menu_items`. Es el caso de lab-resto,
    # que escribe directo a la tabla y nunca pasa por el reconciliador.
    _menu_cache = [(None, nombre, precio, est) for nombre, precio, est in MENU]
    return _menu_cache


def turno_sintetico_del_lab():
    """El turno inventado con el que lab-resto lleva meses escribiendo DIRECTO a la tabla.

    Sirve ahí y sólo ahí: `pos_orders` únicamente exige que el campo no sea nulo
    (constraint `orders_require_turno`), y lab-resto no tiene una sola fila en
    `pos_turnos`. Por el camino real del POS este id es lo que producía el 409
    `TURN_NOT_FOUND` — ese camino resuelve el turno con `pos_turno.turno_vigente()`.

    Se conserva para no alterar la línea base del laboratorio, que es lo único que
    depende de la escritura directa.
    """
    return f"lab-turno-{datetime.now(timezone.utc).strftime('%Y%m%d')}"


def make_order(seq, turno_id):
    carta = menu_del_tenant()
    n_items = random.randint(2, 5)
    items = []
    oid = f"lab-{int(time.time()*1000)}-{seq}-{random.randint(100,999)}"
    for idx in range(n_items):
        menu_item_id, nombre, precio, est = random.choice(carta)
        cant = random.randint(1, 3)
        item = {"nombre": nombre, "precio": precio, "cantidad": cant, "estacion": est}
        if menu_item_id:
            # La identidad que exige `r1_reconcile_order`. Su STEP 4 hace:
            #     IF v_item_id IS NULL OR v_menu_item_id IS NULL THEN CONTINUE;
            # o sea, descarta el renglón como malformado SIN decir nada. Con los ítems
            # de sólo {nombre, precio, cantidad, estacion} se descartaban TODOS: la RPC
            # devolvía cero filas, `save-order` reportaba inventory_status=SKIPPED y la
            # orden se cobraba sin descontar nada. Es la misma pareja que manda el POS
            # real (pos/page.tsx:379 — `id: generateId(), menuItemId: item.id`).
            #
            # El `id` es por RENGLÓN, no por platillo: es la llave de idempotencia
            # (client_id, order_id, order_item_id) con la que el reconciliador evita
            # descontar dos veces la misma línea cuando la orden se guarda varias veces.
            item["id"] = f"{oid}-{idx}"
            item["menuItemId"] = menu_item_id
        items.append(item)
    subtotal = sum(i["precio"] * i["cantidad"] for i in items)
    iva = round(subtotal * IVA_RATE, 2)
    total = round(subtotal + iva, 2)
    return {
        "id": oid, "client_id": CLIENT_ID, "mesa": random.randint(1, 24),
        "mesero": random.choice(MESEROS), "personas": random.randint(1, 6),
        "status": "abierta", "subtotal": subtotal, "iva": iva, "total": total,
        "descuento": 0, "items": items, "kds_item_status": {},
        "turno_id": turno_id,
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


def ciclo_por_el_pos(token: str, factor: float, operador: str) -> tuple[int, int, int, list[str]]:
    """Un servicio completo POR EL CAMINO REAL: crear → cocina → cobrar, vía save-order.

    Cada paso pasa por api/pos/save-order, que es donde vive el descuento de inventario
    (`reconcile_order_inventory`), la concurrencia optimista por revisión, la detección de
    skimming y la validación de pagos. Escribir directo a la tabla se salta todo eso.

    La orden se lleva COMPLETA en una sola corrida —crear, cocina, cobrar— en vez de
    dejarla a medias para la siguiente. El POS usa revisiones optimistas, y encadenarlas
    aquí ejercita ese mecanismo, que es justo lo que no se estaba probando.
    """
    creadas = avanzadas = cobradas = 0
    # El estado del inventario de cada orden COBRADA. Se junta para poder decidir al
    # final si la corrida sirvió: vender sin descontar no es un éxito.
    estados: list[str] = []
    n = 0 if factor == 0.0 else max(1, round(random.randint(2, 5) * factor))
    if n == 0:
        # Cerrado. No se resuelve el turno a propósito: abrir uno a las 3 de la mañana
        # le inventaría al demo un corte que ningún restaurante habría abierto.
        return 0, 0, 0, []

    # El turno se resuelve UNA vez por corrida, como una terminal al arrancar: todas las
    # órdenes del servicio cuelgan del mismo corte. Antes se inventaba uno por orden y
    # `save-order` las rechazaba TODAS con TURN_NOT_FOUND (409).
    turno = pos_turno.turno_vigente(CLIENT_ID, operador)

    for s in range(n):
        orden = make_order(s, turno)
        oid = orden["id"]
        base = {
            "order_id": oid, "mesa": orden["mesa"], "mesero": orden["mesero"],
            "personas": orden["personas"], "subtotal": orden["subtotal"],
            "iva": orden["iva"], "total": orden["total"], "descuento": 0,
            "turno_id": orden["turno_id"], "items": orden["items"],
        }
        try:
            r = pos_client.guardar(token, {**base, "expected_revision": 0, "status": "abierta"})
            creadas += 1
            rev = r.get("revision", 1)

            r = pos_client.guardar(token, {**base, "expected_revision": rev, "status": "enviada"})
            avanzadas += 1
            rev = r.get("revision", rev + 1)

            propina = round(float(orden["total"]) * random.uniform(0.08, 0.15), 2)
            metodo = random.choice(PAGOS)
            r = pos_client.guardar(token, {
                **base, "expected_revision": rev, "status": "cerrada",
                "propina": propina, "metodo_pago": metodo,
                # El invariante que rechazaba el 100% de las órdenes viejas.
                "pagos": pos_client.pagos_que_cuadran(orden["total"], propina, metodo),
                "closed_at": now_iso(),
            })
            cobradas += 1
            estados.append(r.get("inventory_status") or "SIN_ESTADO")
            print(f"[lab-simulator]   {oid[:24]} cobrada · {pos_client.diagnostico_inventario(r)}")
        except pos_client.ErrorPOS as e:
            # Una orden rechazada NO tumba el servicio: se reporta y se sigue. Pero se
            # reporta FUERTE — un rechazo silencioso es exactamente cómo se acumularon
            # 2,813 órdenes que el POS real nunca habría aceptado.
            print(f"[lab-simulator]   RECHAZADA {oid[:24]}: {e}", file=sys.stderr)

    return creadas, avanzadas, cobradas, estados


# Los estados de `save-order` que significan "esta venta SÍ movió el inventario".
# `COMPLETE` es el único: todos los renglones terminaron en RECONCILED o en
# NO_MUTATION_APPROVED (un platillo que a propósito no consume inventario).
INVENTARIO_SANO = {"COMPLETE"}

# Qué significa cada estado malo, en el idioma del problema y no del código.
POR_QUE_DUELE = {
    "SKIPPED": "la RPC no recibió un solo renglón válido — a los ítems les falta "
               "`id`/`menuItemId` y `r1_reconcile_order` los descarta como malformados",
    "BLOCKED": "el renglón llegó bien, pero al platillo le falta política de inventario "
               "o receta activa (pos_item_inventory_policy / pos_recipe_versions)",
    "PENDING": "la reconciliación no terminó — la RPC falló o quedó a medias",
    "SIN_ESTADO": "`save-order` no devolvió inventory_status",
}


def movimientos_de_inventario_desde(desde_iso: str) -> int:
    """Filas nuevas en `pos_inventory_movements` del tenant desde ese instante.

    Es la evidencia que no se puede fingir. `inventory_status` dice qué INTENTÓ hacer
    `save-order`; esto dice qué quedó ESCRITO. Se imprime en cada corrida porque el
    criterio de que el laboratorio sirve es justo ese: que este número deje de ser cero.

    Devuelve -1 si no se pudo medir, para no reportar un cero que en realidad es un
    "no sé" — que es como se ven los fallos silenciosos desde afuera.
    """
    try:
        filas = sb_get(
            "pos_inventory_movements",
            # `quote`: el `+00:00` del ISO se leería como espacio dentro del query string.
            f"client_id=eq.{CLIENT_ID}&created_at=gte.{quote(desde_iso, safe='')}"
            f"&select=id&limit=1000",
        )
        return len(filas)
    except Exception as e:
        print(f"[lab-simulator] no se pudieron contar los movimientos de inventario: {e}",
              file=sys.stderr)
        return -1


def reclamo_del_inventario(cobradas: int, estados: list[str]) -> str | None:
    """El motivo por el que la corrida NO puede pasar como buena, o None si todo bien.

    POR QUÉ ESTO ES UNA GUARDA Y NO UN AVISO
    Vender sin descontar es un fallo silencioso perfecto: la corrida sale verde,
    `pos_orders` crece y `pos_inventory_movements` se queda quieto. Así el demo llegó a
    1,218 órdenes con CERO movimientos de inventario sin que nadie se enterara — y así
    el 409 TURN_NOT_FOUND pasó semanas en verde. `docs/ai/ARQUITECTURA-CRUCE.md`, regla
    10: fallar callado está prohibido.

    Se mide por ESTADO, no por cantidad descontada. Un platillo marcado `non_inventory`
    descuenta cero y está bien; lo que nunca está bien es que el renglón ni siquiera
    llegue al reconciliador.
    """
    if cobradas == 0 or not estados:
        return None
    malos = [e for e in estados if e not in INVENTARIO_SANO]
    if not malos:
        return None
    conteo = {e: malos.count(e) for e in dict.fromkeys(malos)}
    detalle = "; ".join(
        f"{n} orden(es) {e} — {POR_QUE_DUELE.get(e, 'estado no esperado')}"
        for e, n in conteo.items()
    )
    return (f"{len(malos)} de {cobradas} órdenes se cobraron sin que el inventario "
            f"quedara conciliado. {detalle}")


def main():
    start = time.time()
    created = advanced = closed = 0
    try:
        factor = factor_de_la_hora()

        # ¿Por el camino real del POS, o escribiendo directo a la tabla?
        #
        # Apagado por omisión: lab-resto lleva meses con la escritura directa y este
        # cambio no debe alterarlo. Se enciende por tenant, desde el workflow.
        if os.environ.get("VIA_POS", "").strip().lower() in ("1", "true", "si", "sí"):
            # El turno se abre y se cierra a nombre de quien tecleó el PIN — igual que
            # en la terminal, donde TurnoGate llama `openTurno(fondo, staff.name)`.
            token, staff = pos_client.autenticar(CLIENT_ID, os.environ.get("POS_PIN", ""))
            operador = staff.get("name") or "POS"
            # Se marca ANTES de vender para poder contar sólo lo que dejó esta corrida.
            antes_de_vender = now_iso()
            created, advanced, closed, estados_inv = ciclo_por_el_pos(token, factor, operador)
            dur = int((time.time() - start) * 1000)
            estado = "cerrado" if factor == 0.0 else f"factor {factor:.1f}"
            movs = movimientos_de_inventario_desde(antes_de_vender) if closed else 0
            cuanto = "no medido" if movs < 0 else f"{movs} movimiento(s) de inventario"
            summary = (f"[{CLIENT_ID}] vía POS · {estado} · +{created} órdenes, "
                       f"{advanced} a cocina, {closed} cobradas · {cuanto}")
            print(f"[lab-simulator] {summary}")

            reclamo = reclamo_del_inventario(closed, estados_inv)
            if reclamo:
                # No se degrada a aviso: el laboratorio existe para ejercitar el camino
                # completo (vender → descontar → detectar merma). Si la mitad de atrás no
                # corrió, la corrida no probó lo que dice probar.
                print(f"[lab-simulator] INVENTARIO SIN CONCILIAR: {reclamo}", file=sys.stderr)
                log_run("lab-simulator", "error", dur, output_summary=summary,
                        error_message=reclamo[:500], tentacle="lab",
                        data_status="partial", rows_processed=created + advanced + closed)
                sys.exit(1)

            log_run("lab-simulator", "success", dur, output_summary=summary,
                    tentacle="lab", rows_processed=created + advanced + closed)
            return

        # 1) Crear órdenes nuevas (servicio premium entrando — más volumen)
        if factor == 0.0:
            # Cerrado. No se crean órdenes, pero SÍ se cierran las que quedaron
            # abiertas — un restaurante que cierra cobra lo que tiene en mesa.
            n_new = 0
        else:
            n_new = max(1, round(random.randint(4, 9) * factor))
        base_seq = 0
        for s in range(n_new):
            order = make_order(base_seq + s, turno_sintetico_del_lab())
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
