#!/usr/bin/env python3
"""Qué restaurantes deben correr los agentes de IA.

POR QUÉ EXISTE
Los workflows resolvían el tenant así:

    CLIENT_ID: ${{ github.event.inputs.client_id || 'amalay' }}

En un disparo manual puedes pasar otro cliente. Pero en una corrida PROGRAMADA no hay
inputs, así que `github.event.inputs.client_id` viene vacío y el valor es siempre
'amalay'. Y las corridas programadas son la única forma en que los agentes corren de
verdad.

Consecuencia: un restaurante nuevo no tiene NI UN agente corriendo. Todo el producto de
IA —la razón por la que alguien paga— simplemente no existe para el cliente #2. No daba
error; daba silencio.

Este script devuelve la lista de restaurantes elegibles para que el workflow abra un job
por cada uno (matriz), en vez de asumir uno.

Salida en formato de GITHUB_OUTPUT:

    lista=["amalay","boruca","coffee-shop"]

Uso:
    python3 .github/scripts/tenants_activos.py >> "$GITHUB_OUTPUT"

Variables:
    SUPABASE_URL, SUPABASE_SERVICE_KEY   obligatorias
    CLIENT_ID                            si viene con un slug concreto, devuelve sólo
                                         ése — así el disparo manual sigue sirviendo
                                         para correr un restaurante suelto
    FEATURE                              bandera requerida (default: agentesIA)
"""
from __future__ import annotations

import json
import os
import sys

import requests

TIEMPO_LIMITE = 20


def normalizar_llave(k: str) -> str:
    """Quita espacios y saltos de línea, y baja a minúsculas.

    NO es cosmético. En producción, AMALAY tiene la llave literal `agent\\n  esIA`
    —con un salto de línea y dos espacios inyectados en medio de `agentesIA`— y es el
    ÚNICO restaurante así. Un filtro estricto lo dejaría fuera de su propia lista de
    agentes: justo el restaurante que hoy los corre. Verificado contra producción el
    2026-08-26.
    """
    return "".join(k.split()).lower()


def features_de(fila: dict) -> tuple[dict, list[str]]:
    """Devuelve (features normalizadas, llaves sucias encontradas).

    `features` está guardado como objeto en unos tenants y como STRING con JSON adentro
    en otros (coffee-shop, demo, esqueleton-demo). Se aceptan ambos.
    """
    crudo = fila.get("features")
    if isinstance(crudo, str):
        try:
            crudo = json.loads(crudo)
        except (ValueError, TypeError):
            crudo = {}
    if not isinstance(crudo, dict):
        crudo = {}

    sucias = [k for k in crudo if k != k.strip() or any(c.isspace() for c in k)]
    return {normalizar_llave(k): v for k, v in crudo.items()}, sucias


def main() -> int:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    bandera = normalizar_llave(os.environ.get("FEATURE", "agentesIA"))
    pedido = (os.environ.get("CLIENT_ID") or "").strip()

    # Disparo manual con un restaurante concreto: se respeta y no se consulta nada.
    if pedido and pedido.upper() != "ALL":
        print(f"[tenants] CLIENT_ID={pedido} — sólo ese restaurante", file=sys.stderr)
        print(f"lista={json.dumps([pedido])}")
        return 0

    if not url or not key:
        print("[tenants] ERROR: faltan SUPABASE_URL o SUPABASE_SERVICE_KEY", file=sys.stderr)
        return 1

    try:
        r = requests.get(
            f"{url}/rest/v1/clients",
            params={"select": "id,active,features", "active": "eq.true"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=TIEMPO_LIMITE,
        )
    except requests.RequestException as e:
        print(f"[tenants] ERROR consultando clients: {e}", file=sys.stderr)
        return 1

    if not r.ok:
        print(f"[tenants] ERROR HTTP {r.status_code} consultando clients", file=sys.stderr)
        return 1

    try:
        filas = r.json()
    except ValueError:
        print("[tenants] ERROR: la respuesta de clients no es JSON", file=sys.stderr)
        return 1

    elegibles: list[str] = []
    for fila in filas:
        cid = fila.get("id")
        if not cid:
            continue
        feats, sucias = features_de(fila)
        if sucias:
            print(
                f"[tenants] AVISO: {cid} tiene llaves con espacios en features: {sucias!r}. "
                "Se normalizan aquí, pero conviene limpiarlas en la base.",
                file=sys.stderr,
            )
        if feats.get(bandera) is True:
            elegibles.append(cid)

    elegibles.sort()

    if not elegibles:
        # No es un error —puede que nadie tenga la bandera— pero tiene que verse.
        # Una matriz vacía salta los jobs en silencio, y eso se lee como "todo bien".
        print(
            f"[tenants] NINGÚN restaurante activo tiene la bandera '{bandera}'. "
            "Los agentes no van a correr para nadie.",
            file=sys.stderr,
        )
    else:
        print(f"[tenants] {len(elegibles)} restaurante(s): {', '.join(elegibles)}", file=sys.stderr)

    print(f"lista={json.dumps(elegibles)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
