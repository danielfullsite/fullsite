#!/usr/bin/env python3
"""Revisa un volcado de esquema antes de dejarlo entrar al repositorio.

Dos trabajos, en este orden:

  1. SEGURIDAD — que el volcado no traiga secretos. Un volcado de esquema no debería
     tener ninguno (no lleva filas), pero el cuerpo de una función SÍ viaja completo,
     y ahí cabe una llave incrustada. Si aparece algo con forma de credencial, el
     script falla y NO imprime la línea: sólo dice el archivo y el renglón. Imprimir
     el hallazgo lo publicaría en los registros de la Action, que es justo lo que
     estamos evitando (CLAUDE.md §13).

  2. DERIVA — comparar contra el baseline que ya está en el repositorio y decir qué
     cambió. Un clon nuevo se construye desde el repositorio, así que cada objeto que
     vive sólo en la base es un objeto que un restaurante nuevo NO va a tener.

Uso:
    python3 .github/scripts/revisar_dump_esquema.py NUEVO.sql [--baseline BASE.sql]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Formas de credencial. Deliberadamente amplias: un falso positivo cuesta una revisión
# manual, un falso negativo publica una llave en un repositorio.
FORMAS_DE_SECRETO: list[tuple[str, re.Pattern[str]]] = [
    ("JWT (anon/service key de Supabase)", re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}")),
    ("llave secreta de Supabase",          re.compile(r"\bsb_secret_[A-Za-z0-9_-]{10,}")),
    ("llave de OpenAI",                    re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("token de GitHub",                    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}")),
    ("token de Telegram",                  re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}")),
    ("contraseña en cadena de conexión",   re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@")),
    ("asignación de contraseña",           re.compile(r"(?i)\bpassword\s*(?:=|:=)\s*'[^']{8,}'")),
]

# `CREATE POLICY` y `CREATE FUNCTION` traen comillas y paréntesis; contarlos por línea
# no sirve. Contamos por sentencia, que es como se aplican.
OBJETOS = [
    ("tabla",     re.compile(r"(?im)^\s*CREATE TABLE(?: IF NOT EXISTS)?\s+(?:\"?public\"?\.)?\"?([a-z0-9_]+)")),
    ("vista",     re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? VIEW\s+(?:\"?public\"?\.)?\"?([a-z0-9_]+)")),
    ("política",  re.compile(r"(?im)^\s*CREATE POLICY\s+\"?([^\"\s]+)\"?")),
    ("función",   re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? FUNCTION\s+(?:\"?(?:public|private)\"?\.)?\"?([a-z0-9_]+)")),
    ("índice",    re.compile(r"(?im)^\s*CREATE(?: UNIQUE)? INDEX(?: IF NOT EXISTS)?\s+\"?([a-z0-9_]+)")),
    ("trigger",   re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? TRIGGER\s+\"?([a-z0-9_]+)")),
]


def revisar_secretos(ruta: Path) -> list[str]:
    """Devuelve los hallazgos como 'archivo:renglón — qué forma'. Nunca el contenido."""
    hallazgos: list[str] = []
    for numero, linea in enumerate(ruta.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        for nombre, patron in FORMAS_DE_SECRETO:
            if patron.search(linea):
                hallazgos.append(f"{ruta.name}:{numero} — {nombre}")
                break  # un hallazgo por renglón basta para detener todo
    return hallazgos


def inventario(texto: str) -> dict[str, set[str]]:
    return {clase: set(m.group(1).lower() for m in patron.finditer(texto)) for clase, patron in OBJETOS}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("nuevo", type=Path)
    ap.add_argument("--baseline", type=Path, default=None)
    args = ap.parse_args()

    if not args.nuevo.is_file():
        print(f"ERROR: no existe {args.nuevo}", file=sys.stderr)
        return 2

    print("═══ 1. Revisión de secretos ═══")
    hallazgos = revisar_secretos(args.nuevo)
    if hallazgos:
        print(f"FALLA: {len(hallazgos)} renglón/es con forma de credencial.\n")
        for h in hallazgos[:40]:
            print(f"  · {h}")
        if len(hallazgos) > 40:
            print(f"  … y {len(hallazgos) - 40} más")
        print("\nNo se imprime el contenido a propósito. Ábrelo localmente para verlo.")
        print("Si es real: NO commitees el volcado y rota la credencial.")
        return 1
    print("OK — ningún renglón con forma de credencial.\n")

    nuevo = inventario(args.nuevo.read_text(encoding="utf-8", errors="replace"))
    print("═══ 2. Inventario del volcado ═══")
    for clase in nuevo:
        print(f"  {clase:>10}: {len(nuevo[clase])}")
    print()

    if args.baseline is None or not args.baseline.is_file():
        print("Sin baseline previo con el cual comparar — este volcado se vuelve el primero.")
        return 0

    viejo = inventario(args.baseline.read_text(encoding="utf-8", errors="replace"))
    print("═══ 3. Deriva contra el baseline del repositorio ═══")
    hubo_deriva = False
    for clase in nuevo:
        nacidos = sorted(nuevo[clase] - viejo[clase])
        muertos = sorted(viejo[clase] - nuevo[clase])
        if not nacidos and not muertos:
            continue
        hubo_deriva = True
        print(f"\n  {clase}:")
        for n in nacidos:
            print(f"    + {n}  (existe en la base, NO en el repositorio)")
        for m in muertos:
            print(f"    - {m}  (existe en el repositorio, NO en la base)")

    if not hubo_deriva:
        print("Sin deriva — el repositorio describe la base.")
        return 0

    print("\nCada '+' es un objeto que un restaurante nuevo NO tendría al clonar,")
    print("porque el clon se construye desde el repositorio, no desde la base.")
    return 3  # distinto de 1: es deriva, no un secreto


if __name__ == "__main__":
    sys.exit(main())
