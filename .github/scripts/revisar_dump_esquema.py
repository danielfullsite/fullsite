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
    # Nombre Y tabla. Los nombres de política NO son únicos en el esquema: `sro_only`
    # existe en cuatro tablas distintas. Identificarlas sólo por nombre las colapsaba
    # en una, y eso no sólo desinflaba el conteo — hacía al detector CIEGO a una
    # política nueva que reusara un nombre ya existente en otra tabla. Un detector que
    # puede no ver es peor que no tener detector, porque da confianza falsa.
    # El nombre puede venir entrecomillado Y con espacios — `CREATE POLICY "Allow read"`
    # existe hoy en wansoft_kpis. Un patrón que corta en el primer espacio no empata, y
    # entonces esa política es INVISIBLE para el detector, sin avisar. Por eso las dos
    # alternativas, y por eso la autocomprobación de más abajo.
    ("política",  re.compile(r"(?im)^\s*CREATE POLICY\s+(?:\"([^\"]+)\"|(\S+))\s+ON\s+(?:\"?public\"?\.)?\"?([a-z0-9_]+)")),
    # Las funciones se sobrecargan: mismo nombre, distinta firma. Se incluyen los
    # argumentos para no colapsar dos sobrecargas en una.
    ("función",   re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? FUNCTION\s+(?:\"?(?:public|private)\"?\.)?\"?([a-z0-9_]+)\"?\s*(\([^)]*\))")),
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


def clave(m: re.Match[str]) -> str:
    """Identidad del objeto. Con dos grupos se compone `tabla.nombre` (o nombre+firma),
    porque el nombre solo no es único — ver el comentario en OBJETOS."""
    partes = [p for p in m.groups() if p]
    if len(partes) >= 2:
        nombre, contexto = partes[0], partes[1]
        # Para políticas el orden natural de lectura es tabla.política.
        return f"{contexto}.{nombre}".lower() if not contexto.startswith("(") else f"{nombre}{contexto}".lower()
    return partes[0].lower()


def inventario(texto: str) -> dict[str, set[str]]:
    return {clase: set(clave(m) for m in patron.finditer(texto)) for clase, patron in OBJETOS}


# Cuántas sentencias `CREATE <cosa>` hay de verdad, contadas sin extraer el nombre.
# Sirve para cachar al detector cuando su patrón detallado no empata con algo.
CUENTAS_CRUDAS = {
    "tabla":    re.compile(r"(?im)^\s*CREATE TABLE\b"),
    "vista":    re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? VIEW\b"),
    "política": re.compile(r"(?im)^\s*CREATE POLICY\b"),
    "función":  re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? FUNCTION\b"),
    "índice":   re.compile(r"(?im)^\s*CREATE(?: UNIQUE)? INDEX\b"),
    "trigger":  re.compile(r"(?im)^\s*CREATE(?: OR REPLACE)? TRIGGER\b"),
}


def revisar_cobertura(texto: str, inv: dict[str, set[str]]) -> list[str]:
    """¿El detector vio todo lo que hay?

    Existe porque el modo de fallo peor de esta herramienta no es equivocarse: es no
    ver. Un `CREATE POLICY "Allow read"` —nombre con espacio— no empataba con el patrón
    y desaparecía del inventario sin una sola queja. Un detector que puede no ver da
    confianza falsa, que es peor que no tener detector.

    Compara lo extraído contra un conteo crudo de sentencias. Si no cuadran, el patrón
    detallado se está comiendo algo y hay que arreglarlo.
    """
    problemas = []
    for clase, patron in CUENTAS_CRUDAS.items():
        crudo = len(patron.findall(texto))
        visto = len(inv.get(clase, ()))
        if visto < crudo:
            problemas.append(
                f"{clase}: hay {crudo} sentencias pero el detector sólo identificó {visto}"
                f" — su patrón no empata con {crudo - visto}"
            )
    return problemas


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

    texto_nuevo = args.nuevo.read_text(encoding="utf-8", errors="replace")
    nuevo = inventario(texto_nuevo)
    print("═══ 2. Inventario del volcado ═══")
    for clase in nuevo:
        print(f"  {clase:>10}: {len(nuevo[clase])}")
    print()

    ciegos = revisar_cobertura(texto_nuevo, nuevo)
    if ciegos:
        print("FALLA: el detector no está viendo todo lo que hay.\n")
        for c in ciegos:
            print(f"  · {c}")
        print("\nNo se reporta deriva con un detector incompleto: diría 'sin novedad'")
        print("sobre objetos que ni siquiera alcanzó a leer. Arregla el patrón en")
        print("OBJETOS y vuelve a correr.")
        return 2

    if args.baseline is None or not args.baseline.is_file():
        # No hay baseline todavía: TODO lo que trae el volcado falta en el repositorio.
        # Eso es deriva máxima, no "sin novedad" — devolver 0 aquí dejaba al workflow
        # sin abrir nunca el primer PR, porque el paso que lo abre exige el código 3.
        # La primera corrida es justo la que más necesita abrirlo.
        total = sum(len(v) for v in nuevo.values())
        print("Sin baseline previo: este volcado se vuelve el primero.")
        print(f"Los {total} objetos del volcado faltan hoy en el repositorio.")
        return 3

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
