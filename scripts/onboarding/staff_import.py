#!/usr/bin/env python3
"""
staff_import.py — Importa personal desde CSV al proyecto Fullsite.

CSV esperado (con encabezado):
    name,role,pin,role_display,active
    Juan Pérez,waiter,1234,Mesero,true
    Ana García,manager,,Gerente,true

Columnas:
    name         — requerido. Nombre completo.
    role         — requerido. Rol en sistema: waiter|manager|cashier|kitchen|admin
    pin          — opcional. 4 dígitos. Se auto-asigna en rango 1000-8999 si vacío.
    role_display — opcional. Nombre mostrado en UI (default: role capitalizado).
    active       — opcional. true|false (default: true).

Flags:
    --client-id   <slug>       slug del cliente en tabla `clients`
    --csv         <path>       ruta al CSV
    --confirm-ref <ref>        project ref de Supabase (ej. abcdefghijkl)
    --dry-run                  muestra qué haría sin escribir nada
    --resume                   continúa desde checkpoint previo

Uso:
    python3 scripts/onboarding/staff_import.py \
        --client-id grupo-galeria-dunkin \
        --csv staff/dunkin-staff.csv \
        --confirm-ref abcdefghijkl
"""
import argparse
import csv
import json
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Add scripts/ to path so `contract` is importable from scripts/onboarding/contract.py
sys.path.insert(0, str(Path(__file__).parent))
from contract import Result, verify_ref

VALID_ROLES = {"waiter", "manager", "cashier", "kitchen", "admin"}
AUTO_PIN_MIN = 1000
AUTO_PIN_MAX = 8999


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def redact(token: str) -> str:
    return token[:8] + "***REDACTED***" if len(token) > 8 else "***REDACTED***"


def sb_headers(key: str) -> dict:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def sb_get(url: str, path: str, key: str, params: dict | None = None) -> list:
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(url + path + qs, headers=sb_headers(key))
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def sb_post(url: str, path: str, key: str, body: dict | list) -> list:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url + path, data=data,
                                  headers=sb_headers(key), method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def sb_patch(url: str, path: str, key: str, body: dict, params: dict) -> list:
    qs = "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode()
    req = urllib.request.Request(url + path + qs, data=data,
                                  headers=sb_headers(key), method="PATCH")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


# ── Checkpoint ───────────────────────────────────────────────────────────────

class State:
    def __init__(self, client_id: str, csv_stem: str):
        self._path = Path(f"/tmp/fullsite-staff-import-{client_id}-{csv_stem}.json")
        self._data: dict = {}
        if self._path.exists():
            try:
                self._data = json.loads(self._path.read_text())
            except Exception:
                self._data = {}

    def done(self, key: str) -> bool:
        return self._data.get(key, False)

    def mark(self, key: str) -> None:
        self._data[key] = True
        self._path.write_text(json.dumps(self._data))

    def clear(self) -> None:
        self._data = {}
        if self._path.exists():
            self._path.unlink()


# ── PIN helpers ───────────────────────────────────────────────────────────────

def fetch_existing_pins(url: str, key: str, client_id: str) -> set[str]:
    """Devuelve todos los PINs existentes para el client_id."""
    rows = sb_get(url, "/rest/v1/pos_staff", key, {
        "select": "pin",
        "client_id": f"eq.{client_id}",
    })
    return {r["pin"] for r in rows if r.get("pin")}


def generate_pin(used_pins: set[str]) -> str:
    """Genera un PIN de 4 dígitos en rango 1000-8999 no utilizado."""
    candidates = list(range(AUTO_PIN_MIN, AUTO_PIN_MAX + 1))
    random.shuffle(candidates)
    for n in candidates:
        p = str(n)
        if p not in used_pins:
            used_pins.add(p)
            return p
    raise RuntimeError("No hay PINs disponibles en el rango 1000-8999.")


# ── CSV parsing ───────────────────────────────────────────────────────────────

def parse_csv(csv_path: str, result: Result) -> list[dict]:
    rows = []
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):  # 1-indexed; row 1 = header
            name = (row.get("name") or "").strip()
            role = (row.get("role") or "").strip().lower()
            pin = (row.get("pin") or "").strip()
            role_display = (row.get("role_display") or "").strip()
            active_raw = (row.get("active") or "true").strip().lower()

            if not name:
                result.error(f"Fila {i}: 'name' vacío — omitida")
                continue
            if role not in VALID_ROLES:
                result.error(f"Fila {i} ({name!r}): rol inválido '{role}' "
                              f"(válidos: {', '.join(sorted(VALID_ROLES))})")
                continue
            if pin and (not pin.isdigit() or len(pin) != 4):
                result.error(f"Fila {i} ({name!r}): PIN debe ser 4 dígitos, recibido '{pin}'")
                continue
            active = active_raw != "false"
            rows.append({
                "name": name,
                "role": role,
                "pin": pin or None,
                "role_display": role_display or role.capitalize(),
                "active": active,
                "_row": i,
            })
    return rows


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Importa personal desde CSV a Supabase.")
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--confirm-ref", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("  ✗ SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridos.", file=sys.stderr)
        sys.exit(1)

    verify_ref(url, args.confirm_ref)

    result = Result("staff_import")

    csv_stem = Path(args.csv).stem
    state = State(args.client_id, csv_stem)
    if not args.resume and state.done("__started__"):
        print(f"  ~ Checkpoint encontrado. Usa --resume para continuar o borra "
              f"/tmp/fullsite-staff-import-{args.client_id}-{csv_stem}.json",
              file=sys.stderr)
    if not args.resume:
        state.clear()

    # ── Validate client ────────────────────────────────────────────────────
    print(f"  Verificando cliente '{args.client_id}'…")
    clients = sb_get(url, "/rest/v1/clients", key, {
        "select": "id,slug,name",
        "slug": f"eq.{args.client_id}",
        "limit": "1",
    })
    if not clients:
        result.error(f"Cliente '{args.client_id}' no encontrado en tabla clients.")
        result.finish()
        return
    client = clients[0]
    client_id = client["id"]
    print(f"  Cliente: {client['name']} (id={client_id})")

    state.mark("__started__")

    # ── Parse CSV ─────────────────────────────────────────────────────────
    if not Path(args.csv).exists():
        result.error(f"Archivo CSV no encontrado: {args.csv}")
        result.finish()
        return

    rows = parse_csv(args.csv, result)
    if result.errors:
        result.finish()
        return

    print(f"  CSV: {len(rows)} registros válidos")

    if args.dry_run:
        print(f"\n  [DRY-RUN] Se importarían {len(rows)} empleados:")
        for r in rows:
            pin_label = r["pin"] if r["pin"] else "(auto-asignado)"
            print(f"    {r['name']:30s}  {r['role']:10s}  PIN={pin_label}")
        result.finish(exit_on_fail=False)
        return

    # ── Fetch existing staff & PINs ────────────────────────────────────────
    print("  Cargando personal existente…")
    existing_rows = sb_get(url, "/rest/v1/pos_staff", key, {
        "select": "id,name,role,pin,active",
        "client_id": f"eq.{client_id}",
    })
    existing_by_name = {r["name"].strip().lower(): r for r in existing_rows}
    used_pins: set[str] = {r["pin"] for r in existing_rows if r.get("pin")}

    # Detect PIN conflicts within CSV itself
    csv_pins: dict[str, str] = {}
    for r in rows:
        if r["pin"]:
            if r["pin"] in csv_pins:
                result.error(
                    f"PIN duplicado en CSV: {r['pin']} asignado a "
                    f"'{csv_pins[r['pin']]}' y '{r['name']}'"
                )
            else:
                csv_pins[r["pin"]] = r["name"]
    if result.errors:
        result.finish()
        return

    # Detect CSV PINs that conflict with existing DB PINs
    for r in rows:
        if r["pin"] and r["pin"] in used_pins:
            existing_owner = next(
                (e["name"] for e in existing_rows if e.get("pin") == r["pin"]), "?"
            )
            if existing_owner.strip().lower() != r["name"].strip().lower():
                result.error(
                    f"PIN {r['pin']} para '{r['name']}' ya está en uso por '{existing_owner}'"
                )
    if result.errors:
        result.finish()
        return

    # ── Insert / update ────────────────────────────────────────────────────
    print("  Importando personal…")
    for r in rows:
        ck = f"staff::{r['name'].lower()}"
        if args.resume and state.done(ck):
            print(f"    [skip] {r['name']} (ya procesado)")
            continue

        # Auto-assign PIN if not provided
        pin = r["pin"]
        if not pin:
            pin = generate_pin(used_pins)
            used_pins.add(pin)

        key_lower = r["name"].strip().lower()
        if key_lower in existing_by_name:
            # Update existing record
            existing = existing_by_name[key_lower]
            sb_patch(url, "/rest/v1/pos_staff", key, {
                "role": r["role"],
                "pin": pin,
                "role_display": r["role_display"],
                "active": r["active"],
            }, {"id": f"eq.{existing['id']}", "client_id": f"eq.{client_id}"})
            result.add_updated()
            action = "actualizado"
        else:
            # Insert new record
            sb_post(url, "/rest/v1/pos_staff", key, {
                "client_id": client_id,
                "name": r["name"],
                "role": r["role"],
                "pin": pin,
                "role_display": r["role_display"],
                "active": r["active"],
            })
            result.add_created()
            action = "creado"

        print(f"    [{action}] {r['name']:30s}  {r['role']:10s}  PIN={pin}")
        state.mark(ck)

    state.clear()
    print(f"\n  ✓ {result.created} creados, {result.updated} actualizados")
    result.finish()


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"  ✗ HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  Interrumpido.", file=sys.stderr)
        sys.exit(130)
