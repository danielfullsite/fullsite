#!/usr/bin/env python3
"""Habla con el POS por su camino real: PIN → shift token → save-order.

POR QUÉ EXISTE
El simulador escribía directo a `pos_orders` con la service key. Eso se salta TODO lo que
hace `api/pos/save-order`: el descuento de inventario (`reconcile_order_inventory`), la
concurrencia optimista por revisión, la detección de skimming, y la validación de que los
pagos cuadren.

Consecuencia medida el 2026-08-26: el 100% de las órdenes cerradas del laboratorio
—2,813 de 2,813 en lab-resto, 14 de 14 en demo— **serían RECHAZADAS por el POS real**.
Llevan meses siendo datos que el sistema considera inválidos, y los agentes aprendieron
de ahí.

EL INVARIANTE QUE LAS RECHAZA
`save-order` exige, en centavos:

    Σ pagos.monto  ==  total + propina

El simulador ponía `pagos = [{monto: total}]` y la propina aparte. El cliente paga la
cuenta MÁS la propina; ese es el invariante del arqueo y por eso el servidor lo verifica
en cada escritura, incluido el replay de la cola offline.

SEGURIDAD
El PIN llega por variable de entorno y NUNCA se imprime. El shift token tampoco: en el
log sólo aparece su longitud, que basta para diagnosticar y no sirve para entrar.
"""
from __future__ import annotations

import os
import sys
import uuid

import requests

TIEMPO_LIMITE = 25


class ErrorPOS(RuntimeError):
    pass


def base_url() -> str:
    return (os.environ.get("APP_URL") or "https://app.fullsite.mx").rstrip("/")


def autenticar(client_id: str, pin: str) -> tuple[str, dict]:
    """Devuelve (shift_token, staff). Igual que teclear el PIN en una terminal."""
    if not pin:
        raise ErrorPOS("falta el PIN (variable POS_PIN)")
    r = requests.post(
        f"{base_url()}/api/pos/pin",
        json={"pin": pin, "client_id": client_id},
        timeout=TIEMPO_LIMITE,
    )
    if not r.ok:
        # El cuerpo puede traer el mensaje de bloqueo por intentos; se recorta por si
        # acaso, para no arrastrar nada largo al log.
        raise ErrorPOS(f"PIN rechazado: HTTP {r.status_code} {r.text[:120]}")
    datos = r.json()
    token = datos.get("shiftToken")
    if not token:
        raise ErrorPOS("el POS no devolvió shiftToken (¿falta SHIFT_TOKEN_SECRET en el servidor?)")
    staff = datos.get("staff") or {}
    print(f"[pos] autenticado como {staff.get('name','?')} ({staff.get('role','?')}) "
          f"· token de {len(token)} caracteres")
    return token, staff


def guardar(token: str, cuerpo: dict) -> dict:
    """POST a save-order. Devuelve el resultado; lanza si el POS rechaza.

    `cuerpo` necesita al menos `order_id` y `expected_revision`. El resto es la orden.
    """
    cuerpo = {**cuerpo}
    # Idempotencia: si la corrida se repite por un reintento de la Action, el POS
    # reconoce la operación y no duplica la orden.
    cuerpo.setdefault("save_operation_id", str(uuid.uuid4()))
    r = requests.post(
        f"{base_url()}/api/pos/save-order",
        json=cuerpo,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=TIEMPO_LIMITE,
    )
    try:
        datos = r.json()
    except ValueError:
        raise ErrorPOS(f"save-order devolvió algo que no es JSON: HTTP {r.status_code}")

    if not r.ok or not datos.get("ok"):
        raise ErrorPOS(
            f"save-order rechazó la orden {cuerpo.get('order_id')}: "
            f"HTTP {r.status_code} {datos.get('error', '(sin error)')}"
        )
    return datos


def pagos_que_cuadran(total: float, propina: float, metodo: str) -> list[dict]:
    """El pago que `save-order` acepta: la cuenta MÁS la propina.

    Se centra aquí en vez de en cada llamador porque es el invariante que rechazaba el
    100% de las órdenes del simulador, y no quiero que se vuelva a escribir mal.
    """
    return [{"metodo": metodo, "monto": round(float(total) + float(propina), 2)}]


def diagnostico_inventario(resultado: dict) -> str:
    """Resume qué hizo el inventario. Es la prueba de que el camino real se ejercitó."""
    estado = resultado.get("inventory_status")
    if not estado:
        return "sin inventario"
    filas = resultado.get("inventory_results") or []
    aplicado = sum(abs(float(f.get("r_applied") or 0)) for f in filas)
    return f"inventario {estado} ({len(filas)} ingrediente(s), {aplicado:.3f} aplicado)"


if __name__ == "__main__":
    # Comprobación de humo: autentica y no hace nada más. Sirve para verificar el
    # secreto sin escribir una sola orden.
    cid = os.environ.get("CLIENT_ID", "demo")
    try:
        autenticar(cid, os.environ.get("POS_PIN", ""))
        print("[pos] la autenticación funciona")
    except ErrorPOS as e:
        print(f"[pos] ERROR: {e}", file=sys.stderr)
        sys.exit(1)
