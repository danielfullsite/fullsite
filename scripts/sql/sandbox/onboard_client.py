#!/usr/bin/env python3
"""
onboard_client.py — Sandbox Client Bootstrap.

NOTA: Esta herramienta aprovisiona clientes en el entorno sandbox para demos
y validaciones de portabilidad. NO es el flujo de provisioning SaaS definitivo.
El provisioning de producción requerirá: organizations, branches, memberships,
capabilities y el flujo de Foundation. Ver sandbox/foundation branch.

Fullsite tenant onboarding in a single command.

Applies migrations (if schema not yet present), creates client, seeds restaurant
data from a template, creates auth user, links client_users, and validates.
Idempotent — safe to re-run. Checkpoints prevent half-created tenants.

Usage:
    python3 scripts/sql/sandbox/onboard_client.py \
        --client-id    vantara \
        --name         "Grupo VANTARA" \
        --owner-email  owner@vantara.sandbox \
        --template     cafe \
        --confirm-ref  <project-ref>

    # Dry-run (prints plan, touches nothing):
    python3 scripts/sql/sandbox/onboard_client.py ... --dry-run

    # Resume after partial failure:
    python3 scripts/sql/sandbox/onboard_client.py ... --resume

    # Rollback a failed onboarding:
    python3 scripts/sql/sandbox/onboard_client.py ... --rollback

Environment (required):
    NEXT_PUBLIC_SUPABASE_URL_SANDBOX       https://<ref>.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX  anon key (public)
    SANDBOX_SERVICE_KEY                    service_role key (secret — never printed)
    SANDBOX_ENV                            must be exactly 'true'

Environment (optional):
    DATABASE_URL      postgres://... — enables automatic migration application via psql
    OWNER_PASSWORD    set to use a specific password; otherwise auto-generated once

Security rules:
    - Rejects URL containing AMALAY production project ref
    - Rejects client_id = 'amalay'
    - Refuses to run without SANDBOX_ENV=true
    - Requires --confirm-ref matching the actual project ref
    - Never prints service keys, JWTs, or passwords in logs
    - All log output is redacted of tokens
    - No fallback to production variables
"""
import argparse
import json
import os
import re
import secrets
import ssl
import string
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Sandbox: bypass SSL cert verification (macOS Python 3.11 cert issue)
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

# ── Security ──────────────────────────────────────────────────────────────────
AMALAY_PROJECT_REF = "qjiomlvudfmzuvqvhwpk"
FORBIDDEN_CLIENT_IDS = {"amalay"}

# ── Stages (in order) ─────────────────────────────────────────────────────────
STAGES = [
    "env_validation",
    "schema_check",
    "migrations",
    "client_create",
    "menu_seed",
    "modifiers_seed",
    "payment_methods_seed",
    "staff_seed",
    "auth_user_create",
    "client_users_create",
    "smoke_check",
]

# ── Status tokens ─────────────────────────────────────────────────────────────
CREATED       = "CREATED"
ALREADY_EXISTS = "ALREADY_EXISTS"
UPDATED       = "UPDATED"
SKIPPED       = "SKIPPED"
FAILED        = "FAILED"
ROLLED_BACK   = "ROLLED_BACK"

# ── Templates ─────────────────────────────────────────────────────────────────
# Each template defines the data shape; IDs are generated as {client_id}-{suffix}.
# Add new templates here — the script itself has no VANTARA-specific knowledge.
TEMPLATES = {
    "minimal": {
        "type": "casual",
        "mesas": 4,
        "iva_rate": 0.16,
        "categories": [
            {"id_suffix": "cat-alimentos", "name": "Alimentos", "color": "bg-blue-600",  "sort_order": 1},
            {"id_suffix": "cat-bebidas",   "name": "Bebidas",   "color": "bg-amber-500", "sort_order": 2},
        ],
        "items": [
            {"id_suffix": "item-platillo", "cat_suffix": "cat-alimentos", "name": "Platillo del Día", "price": 120.00},
            {"id_suffix": "item-agua",     "cat_suffix": "cat-bebidas",   "name": "Agua Natural",     "price": 30.00},
        ],
        "modifier_groups": [],
        "modifiers": [],
        "item_modifier_links": [],
        "payment_methods": [
            {"id_suffix": "pm-efectivo", "name": "Efectivo", "type": "cash", "commission_pct": 0},
        ],
        "staff": [
            {"id_suffix": "staff-admin",  "name": "Administrador", "pin": "9001", "role": "admin",  "role_display": "Gerente"},
            {"id_suffix": "staff-mesero", "name": "Mesero",        "pin": "1001", "role": "mesero", "role_display": "Mesero"},
        ],
    },
    "cafe": {
        "type": "cafe",
        "mesas": 12,
        "iva_rate": 0.16,
        "categories": [
            {"id_suffix": "cat-entradas",    "name": "Entradas",       "color": "bg-emerald-600", "sort_order": 1},
            {"id_suffix": "cat-principales", "name": "Platos Fuertes", "color": "bg-blue-600",    "sort_order": 2},
            {"id_suffix": "cat-bebidas",     "name": "Bebidas",        "color": "bg-amber-500",   "sort_order": 3},
        ],
        "items": [
            {"id_suffix": "item-guacamole",  "cat_suffix": "cat-entradas",    "name": "Guacamole",          "price": 120.00},
            {"id_suffix": "item-quesadilla", "cat_suffix": "cat-entradas",    "name": "Quesadilla",          "price": 95.00},
            {"id_suffix": "item-tostadas",   "cat_suffix": "cat-entradas",    "name": "Tostadas de Tinga",   "price": 110.00},
            {"id_suffix": "item-ribeye",     "cat_suffix": "cat-principales", "name": "Ribeye 300g",         "price": 680.00},
            {"id_suffix": "item-salmon",     "cat_suffix": "cat-principales", "name": "Salmón a la Plancha", "price": 420.00},
            {"id_suffix": "item-pollo",      "cat_suffix": "cat-principales", "name": "Pollo a la Brasa",    "price": 295.00},
            {"id_suffix": "item-pasta",      "cat_suffix": "cat-principales", "name": "Pasta Alfredo",       "price": 240.00},
            {"id_suffix": "item-agua",       "cat_suffix": "cat-bebidas",     "name": "Agua Mineral",         "price": 45.00},
            {"id_suffix": "item-cafe",       "cat_suffix": "cat-bebidas",     "name": "Café Americano",       "price": 55.00},
            {"id_suffix": "item-limonada",   "cat_suffix": "cat-bebidas",     "name": "Limonada Natural",     "price": 65.00},
            {"id_suffix": "item-refresco",   "cat_suffix": "cat-bebidas",     "name": "Refresco",             "price": 50.00},
        ],
        "modifier_groups": [
            {"id_suffix": "mg-punto",  "name": "Punto de Cocción", "sort_order": 1, "min_selections": 1, "max_selections": 1, "required": True},
            {"id_suffix": "mg-temp",   "name": "Temperatura",      "sort_order": 2, "min_selections": 0, "max_selections": 1, "required": False},
            {"id_suffix": "mg-extras", "name": "Extras",           "sort_order": 3, "min_selections": 0, "max_selections": 3, "required": False},
        ],
        "modifiers": [
            {"id_suffix": "mod-rojo",     "group_suffix": "mg-punto",  "name": "Término Rojo",   "price": 0,  "sort_order": 1},
            {"id_suffix": "mod-medio",    "group_suffix": "mg-punto",  "name": "Tres Cuartos",   "price": 0,  "sort_order": 2},
            {"id_suffix": "mod-bien",     "group_suffix": "mg-punto",  "name": "Bien Cocido",    "price": 0,  "sort_order": 3},
            {"id_suffix": "mod-caliente", "group_suffix": "mg-temp",   "name": "Caliente",       "price": 0,  "sort_order": 1},
            {"id_suffix": "mod-frio",     "group_suffix": "mg-temp",   "name": "Frío",           "price": 0,  "sort_order": 2},
            {"id_suffix": "mod-tiempo",   "group_suffix": "mg-temp",   "name": "Al Tiempo",      "price": 0,  "sort_order": 3},
            {"id_suffix": "mod-queso",    "group_suffix": "mg-extras", "name": "Queso Extra",    "price": 25, "sort_order": 1},
            {"id_suffix": "mod-aguacate", "group_suffix": "mg-extras", "name": "Aguacate Extra", "price": 35, "sort_order": 2},
            {"id_suffix": "mod-sin-ceb",  "group_suffix": "mg-extras", "name": "Sin Cebolla",    "price": 0,  "sort_order": 3},
        ],
        "item_modifier_links": [
            {"item_suffix": "item-ribeye",   "group_suffix": "mg-punto"},
            {"item_suffix": "item-ribeye",   "group_suffix": "mg-extras"},
            {"item_suffix": "item-salmon",   "group_suffix": "mg-extras"},
            {"item_suffix": "item-cafe",     "group_suffix": "mg-temp"},
            {"item_suffix": "item-limonada", "group_suffix": "mg-temp"},
        ],
        "payment_methods": [
            {"id_suffix": "pm-efectivo", "name": "Efectivo",           "type": "cash",        "commission_pct": 0},
            {"id_suffix": "pm-credito",  "name": "Tarjeta de Crédito", "type": "card_credit", "commission_pct": 0.035},
            {"id_suffix": "pm-debito",   "name": "Tarjeta de Débito",  "type": "card_debit",  "commission_pct": 0.025},
            {"id_suffix": "pm-transfer", "name": "Transferencia",      "type": "transfer",    "commission_pct": 0},
        ],
        "staff": [
            {"id_suffix": "staff-admin",  "name": "Administrador", "pin": "9001", "role": "admin",  "role_display": "Gerente"},
            {"id_suffix": "staff-mesa-1", "name": "Mesero 1",      "pin": "1001", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-2", "name": "Mesero 2",      "pin": "1002", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-3", "name": "Mesero 3",      "pin": "1003", "role": "mesero", "role_display": "Mesero"},
        ],
    },
    "full-service": {
        "type": "full-service",
        "mesas": 20,
        "iva_rate": 0.16,
        "categories": [
            {"id_suffix": "cat-entradas",    "name": "Entradas",       "color": "bg-emerald-600", "sort_order": 1},
            {"id_suffix": "cat-sopas",       "name": "Sopas",          "color": "bg-orange-500",  "sort_order": 2},
            {"id_suffix": "cat-principales", "name": "Platos Fuertes", "color": "bg-blue-600",    "sort_order": 3},
            {"id_suffix": "cat-postres",     "name": "Postres",        "color": "bg-pink-500",    "sort_order": 4},
            {"id_suffix": "cat-bebidas",     "name": "Bebidas",        "color": "bg-amber-500",   "sort_order": 5},
            {"id_suffix": "cat-vinos",       "name": "Vinos y Licores","color": "bg-purple-600",  "sort_order": 6},
        ],
        "items": [
            {"id_suffix": "item-guac",    "cat_suffix": "cat-entradas",    "name": "Guacamole",         "price": 130.00},
            {"id_suffix": "item-brusc",   "cat_suffix": "cat-entradas",    "name": "Bruschetta",        "price": 110.00},
            {"id_suffix": "item-crema",   "cat_suffix": "cat-sopas",       "name": "Crema del Día",     "price": 95.00},
            {"id_suffix": "item-consomé", "cat_suffix": "cat-sopas",       "name": "Consomé",           "price": 75.00},
            {"id_suffix": "item-ribeye",  "cat_suffix": "cat-principales", "name": "Ribeye 400g",       "price": 780.00},
            {"id_suffix": "item-salmon",  "cat_suffix": "cat-principales", "name": "Salmón",            "price": 450.00},
            {"id_suffix": "item-pasta",   "cat_suffix": "cat-principales", "name": "Pasta Alfredo",     "price": 240.00},
            {"id_suffix": "item-choco",   "cat_suffix": "cat-postres",     "name": "Pastel de Chocolate","price": 120.00},
            {"id_suffix": "item-agua",    "cat_suffix": "cat-bebidas",     "name": "Agua Mineral",       "price": 50.00},
            {"id_suffix": "item-cafe",    "cat_suffix": "cat-bebidas",     "name": "Café Americano",     "price": 60.00},
            {"id_suffix": "item-vino-t",  "cat_suffix": "cat-vinos",       "name": "Vino Tinto Copa",   "price": 150.00},
            {"id_suffix": "item-vino-b",  "cat_suffix": "cat-vinos",       "name": "Vino Blanco Copa",  "price": 140.00},
        ],
        "modifier_groups": [
            {"id_suffix": "mg-punto",  "name": "Punto de Cocción", "sort_order": 1, "min_selections": 1, "max_selections": 1, "required": True},
            {"id_suffix": "mg-extras", "name": "Extras",           "sort_order": 2, "min_selections": 0, "max_selections": 5, "required": False},
        ],
        "modifiers": [
            {"id_suffix": "mod-rojo",   "group_suffix": "mg-punto",  "name": "Término Rojo",  "price": 0,  "sort_order": 1},
            {"id_suffix": "mod-medio",  "group_suffix": "mg-punto",  "name": "Tres Cuartos",  "price": 0,  "sort_order": 2},
            {"id_suffix": "mod-bien",   "group_suffix": "mg-punto",  "name": "Bien Cocido",   "price": 0,  "sort_order": 3},
            {"id_suffix": "mod-queso",  "group_suffix": "mg-extras", "name": "Queso Extra",   "price": 30, "sort_order": 1},
            {"id_suffix": "mod-avocado","group_suffix": "mg-extras", "name": "Aguacate Extra","price": 40, "sort_order": 2},
        ],
        "item_modifier_links": [
            {"item_suffix": "item-ribeye", "group_suffix": "mg-punto"},
            {"item_suffix": "item-ribeye", "group_suffix": "mg-extras"},
            {"item_suffix": "item-salmon", "group_suffix": "mg-extras"},
        ],
        "payment_methods": [
            {"id_suffix": "pm-efectivo", "name": "Efectivo",           "type": "cash",        "commission_pct": 0},
            {"id_suffix": "pm-credito",  "name": "Tarjeta de Crédito", "type": "card_credit", "commission_pct": 0.035},
            {"id_suffix": "pm-debito",   "name": "Tarjeta de Débito",  "type": "card_debit",  "commission_pct": 0.025},
            {"id_suffix": "pm-transfer", "name": "Transferencia",      "type": "transfer",    "commission_pct": 0},
        ],
        "staff": [
            {"id_suffix": "staff-gm",     "name": "Gerente General", "pin": "9001", "role": "admin",  "role_display": "GM"},
            {"id_suffix": "staff-host",   "name": "Hostess",         "pin": "8001", "role": "admin",  "role_display": "Hostess"},
            {"id_suffix": "staff-mesa-1", "name": "Mesero 1",        "pin": "1001", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-2", "name": "Mesero 2",        "pin": "1002", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-3", "name": "Mesero 3",        "pin": "1003", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-4", "name": "Mesero 4",        "pin": "1004", "role": "mesero", "role_display": "Mesero"},
        ],
    },
}

# ── HTTP helpers ──────────────────────────────────────────────────────────────
JWT_PATTERN = re.compile(r'eyJ[A-Za-z0-9_\-\.]{50,}')

def redact(s):
    return JWT_PATTERN.sub('***REDACTED***', str(s))

def _req(method, url, body, headers, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e)


def get(url, headers):
    return _req("GET", url, None, headers)

def post(url, body, headers):
    return _req("POST", url, body, headers)

def delete(url, headers):
    return _req("DELETE", url, None, headers)


def create_auth_user(auth_url, email, password, svc_key, dry_run):
    """Create an auth user only during a real onboarding run.

    Keeping the dry-run guard inside this helper prevents a caller from logging a
    simulated action while accidentally issuing the admin mutation.
    """
    if dry_run:
        return SKIPPED, None
    return post(f"{auth_url}/admin/users", {
        "email": email,
        "password": password,
        "email_confirm": True,
    }, {"apikey": svc_key, "Authorization": f"Bearer {svc_key}",
        "Content-Type": "application/json"})


# ── Checkpoint state ──────────────────────────────────────────────────────────
class State:
    def __init__(self, client_id):
        self.path = Path(f"/tmp/fullsite-onboard-{client_id}.json")
        self.data = self._load()

    def _load(self):
        if self.path.exists():
            try:
                return json.loads(self.path.read_text())
            except Exception:
                pass
        return {"stages": {}, "created": {}, "started_at": time.time()}

    def save(self):
        self.path.write_text(json.dumps(self.data, indent=2))

    def stage_done(self, stage):
        return self.data["stages"].get(stage, {}).get("status") == "done"

    def mark_done(self, stage, details=None):
        self.data["stages"][stage] = {"status": "done", "ts": time.time(), "details": details or {}}
        self.save()

    def mark_failed(self, stage, error):
        self.data["stages"][stage] = {"status": "failed", "ts": time.time(), "error": str(error)}
        self.save()

    def record(self, kind, id_):
        self.data["created"].setdefault(kind, [])
        if id_ not in self.data["created"][kind]:
            self.data["created"][kind].append(id_)
        self.save()

    def reset(self):
        self.path.unlink(missing_ok=True)
        self.data = {"stages": {}, "created": {}, "started_at": time.time()}


# ── Logging ───────────────────────────────────────────────────────────────────
class Log:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self._timings = {}
        self._items = []  # (status, label)

    def section(self, title):
        print(f"\n── {title} {'(DRY-RUN)' if self.dry_run else ''}".ljust(68, "─"))

    def item(self, status, label, detail=""):
        symbol = {"CREATED": "✚", "ALREADY_EXISTS": "=", "UPDATED": "↑",
                  "SKIPPED": "·", "FAILED": "✗", "ROLLED_BACK": "↩",
                  "PASS": "✓", "FAIL": "✗", "WARN": "~"}.get(status, "?")
        line = f"  {symbol} [{status:14s}] {label}"
        if detail:
            line += f"\n              {redact(detail)}"
        print(line)
        self._items.append((status, label))

    def warn(self, msg):
        print(f"  ~ [WARN          ] {msg}")

    def error(self, msg):
        print(f"  ✗ [ERROR         ] {redact(msg)}", file=sys.stderr)

    def start_stage(self, stage):
        self._timings[stage] = time.time()

    def end_stage(self, stage):
        elapsed = time.time() - self._timings.get(stage, time.time())
        self._timings[f"{stage}_elapsed"] = elapsed
        return elapsed

    def summary(self, stage_timings):
        passes = sum(1 for s, _ in self._items if s in (CREATED, ALREADY_EXISTS, UPDATED, SKIPPED, "PASS"))
        fails  = sum(1 for s, _ in self._items if s in (FAILED, "FAIL"))
        print("\n" + "═" * 68)
        print(f"  {'DRY-RUN — no changes made' if self.dry_run else 'Onboarding complete'}")
        print(f"  Items: {passes} OK, {fails} FAIL")
        print()
        if stage_timings:
            print("  Timing per stage:")
            total = sum(stage_timings.values())
            for stage, elapsed in stage_timings.items():
                print(f"    {stage:<30s} {elapsed:.1f}s")
            print(f"    {'TOTAL':<30s} {total:.1f}s")
        print("═" * 68)


# ── Migration application ─────────────────────────────────────────────────────
MIGRATION_FILES = [
    "000_extensions_sandbox.sql",
    "010_consolidated_core_sandbox.sql",
    "003_rls_policies_sandbox.sql",
    "004_functions_sandbox.sql",
    "008_realtime_sandbox.sql",
    "SKEL-01_seed_vantara.sql",   # NOTE: will be replaced by this script's own seeding
    "SKEL-03_restaurant_data.sql",
]

MIGRATION_DIR = Path(__file__).parent / "migrations"

def check_schema_applied(url, svc_h):
    """Return True if core schema is already applied."""
    s, _ = get(f"{url}/rest/v1/clients?select=id&limit=0", svc_h)
    return s == 200

def apply_migrations_via_psql(db_url, log):
    """Run migration files via psql subprocess. Requires DATABASE_URL in env."""
    if not db_url:
        return False
    for fname in MIGRATION_FILES[:5]:   # only schema migrations, not seed files
        fpath = MIGRATION_DIR / fname
        if not fpath.exists():
            log.error(f"Migration file not found: {fpath}")
            return False
        try:
            result = subprocess.run(
                ["psql", db_url, "-f", str(fpath), "--quiet"],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode != 0:
                log.error(f"psql failed on {fname}: {result.stderr[:200]}")
                return False
            log.item(CREATED, f"Migration {fname}")
        except FileNotFoundError:
            log.warn("psql not found in PATH — migrations must be applied manually")
            return False
        except subprocess.TimeoutExpired:
            log.error(f"psql timed out on {fname}")
            return False
    return True


# ── REST upsert helpers ───────────────────────────────────────────────────────
def upsert_row(rest_url, table, row, pk_field, svc_h, state, kind, log, dry_run):
    """Check if row exists (by pk_field), create if not. Returns (status, id)."""
    pk_val = row[pk_field]
    encoded = urllib.parse.quote(str(pk_val))
    s, existing = get(f"{rest_url}/{table}?{pk_field}=eq.{encoded}&select={pk_field}&limit=1", svc_h)

    if s == 200 and isinstance(existing, list) and existing:
        log.item(ALREADY_EXISTS, f"{table}: {pk_val}")
        return ALREADY_EXISTS, pk_val

    if dry_run:
        log.item(SKIPPED, f"{table}: {pk_val} (dry-run)")
        return SKIPPED, pk_val

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, resp = post(f"{rest_url}/{table}", row, h)
    if s2 in (200, 201):
        state.record(kind, pk_val)
        log.item(CREATED, f"{table}: {pk_val}")
        return CREATED, pk_val
    else:
        log.item(FAILED, f"{table}: {pk_val}", detail=str(resp)[:120])
        return FAILED, pk_val


def upsert_compound_pk(rest_url, table, row, pk_fields, svc_h, state, kind, log, dry_run):
    """Upsert for tables with compound PKs (e.g. pos_item_modifier_groups)."""
    filters = "&".join(f"{k}=eq.{urllib.parse.quote(str(row[k]))}" for k in pk_fields)
    s, existing = get(f"{rest_url}/{table}?{filters}&limit=1", svc_h)
    label = "_".join(str(row[k]) for k in pk_fields)

    if s == 200 and isinstance(existing, list) and existing:
        log.item(ALREADY_EXISTS, f"{table}: {label}")
        return ALREADY_EXISTS

    if dry_run:
        log.item(SKIPPED, f"{table}: {label} (dry-run)")
        return SKIPPED

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, resp = post(f"{rest_url}/{table}", row, h)
    if s2 in (200, 201):
        state.record(kind, label)
        log.item(CREATED, f"{table}: {label}")
        return CREATED
    else:
        log.item(FAILED, f"{table}: {label}", detail=str(resp)[:120])
        return FAILED


# ── Password generation ───────────────────────────────────────────────────────
def gen_password():
    alphabet = string.ascii_letters + string.digits + "!@#$"
    while True:
        pwd = ''.join(secrets.choice(alphabet) for _ in range(16))
        if (any(c.isupper() for c in pwd) and any(c.islower() for c in pwd)
                and any(c.isdigit() for c in pwd)):
            return pwd


# ── Main onboarding logic ─────────────────────────────────────────────────────
def run_onboarding(args):
    client_id  = args.client_id
    name       = args.name
    email      = args.owner_email
    tmpl_name  = args.template
    confirm    = args.confirm_ref
    dry_run    = args.dry_run
    do_resume  = args.resume
    do_rollback = args.rollback

    log   = Log(dry_run=dry_run)
    state = State(client_id)
    timings = {}

    # ── env_validation ───────────────────────────────────────────────────────
    log.section("1 · Environment validation")
    t0 = time.time()

    url       = os.environ.get("NEXT_PUBLIC_SUPABASE_URL_SANDBOX", "").rstrip("/")
    anon_key  = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX", "")
    svc_key   = os.environ.get("SANDBOX_SERVICE_KEY", "")
    sbox_env  = os.environ.get("SANDBOX_ENV", "")
    db_url    = os.environ.get("DATABASE_URL", "")
    owner_pwd = os.environ.get("OWNER_PASSWORD", "")

    errors = []
    if sbox_env != "true":
        errors.append("SANDBOX_ENV must be 'true'")
    if not url:
        errors.append("NEXT_PUBLIC_SUPABASE_URL_SANDBOX is empty")
    if not svc_key:
        errors.append("SANDBOX_SERVICE_KEY is empty")
    if not anon_key:
        errors.append("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX is empty")
    if AMALAY_PROJECT_REF in url:
        errors.append(f"URL contains AMALAY production project ref ({AMALAY_PROJECT_REF}) — ABORTING")
    if client_id in FORBIDDEN_CLIENT_IDS:
        errors.append(f"client_id='{client_id}' is forbidden in sandbox mode")
    if svc_key and anon_key and svc_key == anon_key:
        errors.append("SANDBOX_SERVICE_KEY == NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX (use service_role key, not anon key)")
    if tmpl_name not in TEMPLATES:
        errors.append(f"Unknown template '{tmpl_name}'. Valid: {', '.join(TEMPLATES)}")

    if errors:
        for e in errors:
            log.error(e)
        sys.exit(1)

    # Extract project ref
    m = re.search(r'https://([^.]+)\.supabase\.co', url)
    project_ref = m.group(1) if m else "unknown"

    if confirm != project_ref:
        log.error(
            f"--confirm-ref '{confirm}' does not match project ref '{project_ref}'.\n"
            f"              Re-run with --confirm-ref {project_ref}"
        )
        sys.exit(1)

    log.item("PASS", f"URL: {url}")
    log.item("PASS", f"Project ref: {project_ref}")
    log.item("PASS", f"client_id: {client_id}")
    log.item("PASS", f"Template: {tmpl_name}")
    log.item("PASS", f"Owner email: {email}")
    log.item("PASS", "SANDBOX_ENV=true")
    log.item("PASS", "Service key != anon key")

    timings["env_validation"] = time.time() - t0

    if not owner_pwd:
        owner_pwd = gen_password()
        log.item("CREATED", "Owner password auto-generated (shown once at end)")
        show_password = True
    else:
        log.item("SKIPPED", "Owner password from OWNER_PASSWORD env (not printed)")
        show_password = False

    svc_h  = {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"}
    anon_h = {"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}
    rest   = f"{url}/rest/v1"
    auth   = f"{url}/auth/v1"
    tmpl   = TEMPLATES[tmpl_name]

    # ── rollback mode ─────────────────────────────────────────────────────────
    if do_rollback:
        return do_rollback_mode(url, rest, auth, svc_h, state, log, client_id, dry_run)

    # ── schema_check ─────────────────────────────────────────────────────────
    log.section("2 · Schema check")
    t0 = time.time()

    if not state.stage_done("schema_check") or not do_resume:
        schema_ok = check_schema_applied(url, svc_h)
        if schema_ok:
            log.item("PASS", "Schema applied (clients table exists)")
            state.mark_done("schema_check", {"schema_applied": True})
        else:
            log.warn("Schema not applied yet. Apply migrations first.")
            log.warn("Migrations dir: scripts/sql/sandbox/migrations/")
            log.warn("Or set DATABASE_URL to apply via psql automatically.")
            if db_url and not dry_run:
                log.section("  Applying migrations via psql")
                ok = apply_migrations_via_psql(db_url, log)
                if not ok:
                    log.error("Migration application failed. Apply manually and re-run.")
                    sys.exit(1)
                state.mark_done("schema_check", {"schema_applied": True})
            else:
                print()
                print("  Apply these files in Supabase SQL Editor (in order):")
                for f in MIGRATION_FILES[:5]:
                    print(f"    scripts/sql/sandbox/migrations/{f}")
                print()
                print("  Then re-run this script.")
                sys.exit(2)
    else:
        log.item(SKIPPED, "schema_check (resuming)")

    timings["schema_check"] = time.time() - t0

    # ── client_create ─────────────────────────────────────────────────────────
    log.section("3 · Client record")
    t0 = time.time()

    if not state.stage_done("client_create") or not do_resume:
        status, _ = upsert_row(rest, "clients", {
            "id":             client_id,
            "display_name":   name,
            "city":           "Monterrey",
            "timezone":       "America/Monterrey",
            "data_source":    "fullsite",
            "active":         True,
            "default_theme":  "dark",
            "accent_color":   "emerald",
            "mesas":          tmpl["mesas"],
            "features":       json.dumps({"pos": True, "kds": True, "dashboard": True, "inventory": False, "agents": False}),
            "iva_rate":       tmpl["iva_rate"],
            "receipt_footer": f"Bienvenido a {name}",
            "type":           tmpl["type"],
        }, "id", svc_h, state, "clients", log, dry_run)

        if status == FAILED:
            state.mark_failed("client_create", "upsert failed")
            sys.exit(1)
        state.mark_done("client_create")
    else:
        log.item(SKIPPED, "client_create (resuming)")

    timings["client_create"] = time.time() - t0

    # ── menu_seed ─────────────────────────────────────────────────────────────
    log.section("4 · Menu categories & items")
    t0 = time.time()
    failed_count = 0

    if not state.stage_done("menu_seed") or not do_resume:
        for cat in tmpl["categories"]:
            cat_id = f"{client_id}-{cat['id_suffix']}"
            st, _ = upsert_row(rest, "pos_menu_categories", {
                "id": cat_id, "client_id": client_id,
                "name": cat["name"], "color": cat["color"],
                "sort_order": cat["sort_order"], "active": True,
            }, "id", svc_h, state, "categories", log, dry_run)
            if st == FAILED:
                failed_count += 1

        for item in tmpl["items"]:
            item_id = f"{client_id}-{item['id_suffix']}"
            cat_id  = f"{client_id}-{item['cat_suffix']}"
            st, _   = upsert_row(rest, "pos_menu_items", {
                "id": item_id, "client_id": client_id, "category_id": cat_id,
                "name": item["name"], "price": item["price"], "active": True,
            }, "id", svc_h, state, "items", log, dry_run)
            if st == FAILED:
                failed_count += 1

        if failed_count:
            state.mark_failed("menu_seed", f"{failed_count} failures")
            _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run)
            sys.exit(1)
        state.mark_done("menu_seed")
    else:
        log.item(SKIPPED, "menu_seed (resuming)")

    timings["menu_seed"] = time.time() - t0

    # ── modifiers_seed ────────────────────────────────────────────────────────
    log.section("5 · Modifier groups & modifiers")
    t0 = time.time()
    failed_count = 0

    if not state.stage_done("modifiers_seed") or not do_resume:
        for mg in tmpl["modifier_groups"]:
            mg_id = f"{client_id}-{mg['id_suffix']}"
            st, _ = upsert_row(rest, "pos_modifier_groups", {
                "id": mg_id, "client_id": client_id, "name": mg["name"],
                "sort_order": mg["sort_order"], "active": True, "level": 1,
                "min_selections": mg["min_selections"],
                "max_selections": mg.get("max_selections"),
                "required": mg["required"],
            }, "id", svc_h, state, "modifier_groups", log, dry_run)
            if st == FAILED: failed_count += 1

        for mod in tmpl["modifiers"]:
            mod_id  = f"{client_id}-{mod['id_suffix']}"
            grp_id  = f"{client_id}-{mod['group_suffix']}"
            st, _   = upsert_row(rest, "pos_modifiers", {
                "id": mod_id, "client_id": client_id, "group_id": grp_id,
                "name": mod["name"], "price": mod["price"],
                "sort_order": mod["sort_order"], "active": True,
            }, "id", svc_h, state, "modifiers", log, dry_run)
            if st == FAILED: failed_count += 1

        for link in tmpl["item_modifier_links"]:
            item_id = f"{client_id}-{link['item_suffix']}"
            grp_id  = f"{client_id}-{link['group_suffix']}"
            st = upsert_compound_pk(rest, "pos_item_modifier_groups",
                {"client_id": client_id, "item_id": item_id, "group_id": grp_id},
                ["client_id", "item_id", "group_id"],
                svc_h, state, "item_modifier_links", log, dry_run)
            if st == FAILED: failed_count += 1

        if failed_count:
            state.mark_failed("modifiers_seed", f"{failed_count} failures")
            _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run)
            sys.exit(1)
        state.mark_done("modifiers_seed")
    else:
        log.item(SKIPPED, "modifiers_seed (resuming)")

    timings["modifiers_seed"] = time.time() - t0

    # ── payment_methods_seed ──────────────────────────────────────────────────
    log.section("6 · Payment methods")
    t0 = time.time()
    failed_count = 0

    if not state.stage_done("payment_methods_seed") or not do_resume:
        for pm in tmpl["payment_methods"]:
            pm_id = f"{client_id}-{pm['id_suffix']}"
            st, _ = upsert_row(rest, "pos_payment_methods", {
                "id": pm_id, "client_id": client_id, "name": pm["name"],
                "type": pm["type"], "commission_pct": pm["commission_pct"], "active": True,
            }, "id", svc_h, state, "payment_methods", log, dry_run)
            if st == FAILED: failed_count += 1

        if failed_count:
            state.mark_failed("payment_methods_seed", f"{failed_count} failures")
            _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run)
            sys.exit(1)
        state.mark_done("payment_methods_seed")
    else:
        log.item(SKIPPED, "payment_methods_seed (resuming)")

    timings["payment_methods_seed"] = time.time() - t0

    # ── staff_seed ────────────────────────────────────────────────────────────
    log.section("7 · Staff")
    t0 = time.time()
    failed_count = 0

    if not state.stage_done("staff_seed") or not do_resume:
        for member in tmpl["staff"]:
            sid = f"{client_id}-{member['id_suffix']}"
            st, _ = upsert_row(rest, "pos_staff", {
                "id": sid, "client_id": client_id, "name": member["name"],
                "pin": member["pin"], "role": member["role"],
                "role_display": member["role_display"], "active": True,
            }, "id", svc_h, state, "staff", log, dry_run)
            if st == FAILED: failed_count += 1

        if failed_count:
            state.mark_failed("staff_seed", f"{failed_count} failures")
            _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run)
            sys.exit(1)
        state.mark_done("staff_seed")
    else:
        log.item(SKIPPED, "staff_seed (resuming)")

    timings["staff_seed"] = time.time() - t0

    # ── auth_user_create ──────────────────────────────────────────────────────
    log.section("8 · Auth user")
    t0 = time.time()
    user_id = None

    if not state.stage_done("auth_user_create") or not do_resume:
        s, r = create_auth_user(auth, email, owner_pwd, svc_key, dry_run)

        if s == SKIPPED:
            log.item(SKIPPED, f"auth user: {email} (dry-run)")
            state.mark_done("auth_user_create", {"dry_run": True})
        elif s in (200, 201) and isinstance(r, dict):
            user_id = r["id"]
            state.record("auth_users", user_id)
            log.item(CREATED, f"auth user: {email}")
            state.mark_done("auth_user_create", {"user_id": user_id})
        elif s == 422 and "already" in str(r).lower():
            log.item(ALREADY_EXISTS, f"auth user: {email}")
            # Fetch existing user_id
            s2, r2 = _req("GET", f"{auth}/admin/users", None,
                          {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"})
            if s2 == 200 and isinstance(r2, dict):
                for u in r2.get("users", []):
                    if u.get("email") == email:
                        user_id = u["id"]
                        break
            state.mark_done("auth_user_create", {"user_id": user_id})
        else:
            log.item(FAILED, f"auth user: {email}", detail=str(r)[:120])
            state.mark_failed("auth_user_create", str(r))
            _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run)
            sys.exit(1)
    else:
        log.item(SKIPPED, "auth_user_create (resuming)")
        user_id = state.data["stages"]["auth_user_create"].get("details", {}).get("user_id")

    timings["auth_user_create"] = time.time() - t0

    # ── client_users_create ───────────────────────────────────────────────────
    log.section("9 · client_users membership")
    t0 = time.time()

    if not state.stage_done("client_users_create") or not do_resume:
        if user_id and not dry_run:
            # Check if membership already exists
            s, existing = get(
                f"{rest}/client_users?user_id=eq.{user_id}&client_id=eq.{client_id}&select=id&limit=1",
                svc_h)

            if s == 200 and isinstance(existing, list) and existing:
                log.item(ALREADY_EXISTS, f"client_users: {email} → {client_id}")
            else:
                h = {**svc_h, "Content-Type": "application/json",
                     "Prefer": "return=representation"}
                s2, r2 = post(f"{rest}/client_users", {
                    "user_id": user_id, "client_id": client_id, "role": "dueño",
                }, h)
                if s2 in (200, 201):
                    state.record("client_users", f"{user_id}:{client_id}")
                    log.item(CREATED, f"client_users: {email} → {client_id} (role=dueño)")
                else:
                    log.item(FAILED, "client_users", detail=str(r2)[:120])
                    state.mark_failed("client_users_create", str(r2))
                    _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run)
                    sys.exit(1)
        elif dry_run:
            log.item(SKIPPED, f"client_users: {email} → {client_id} (dry-run)")
        else:
            log.warn("user_id not available — client_users not created")
        state.mark_done("client_users_create")
    else:
        log.item(SKIPPED, "client_users_create (resuming)")

    timings["client_users_create"] = time.time() - t0

    # ── smoke_check ───────────────────────────────────────────────────────────
    log.section("10 · Smoke check")
    t0 = time.time()

    if not dry_run:
        checks = [
            ("clients row exists", _check_count(rest, "clients", f"id=eq.{client_id}", svc_h) == 1),
            ("menu_categories ≥ 1", _check_count(rest, "pos_menu_categories", f"client_id=eq.{client_id}", svc_h) >= 1),
            ("menu_items ≥ 1",      _check_count(rest, "pos_menu_items",      f"client_id=eq.{client_id}", svc_h) >= 1),
            ("payment_methods ≥ 1", _check_count(rest, "pos_payment_methods", f"client_id=eq.{client_id}&active=eq.true", svc_h) >= 1),
            ("staff ≥ 1",           _check_count(rest, "pos_staff",           f"client_id=eq.{client_id}&active=eq.true", svc_h) >= 1),
        ]
        if user_id:
            # Test login
            s_login, r_login = post(f"{auth}/token?grant_type=password",
                {"email": email, "password": owner_pwd},
                {"apikey": anon_key, "Content-Type": "application/json"})
            checks.append(("owner login succeeds", s_login == 200 and "access_token" in (r_login if isinstance(r_login, dict) else {})))

        any_fail = False
        for label, passed in checks:
            log.item("PASS" if passed else "FAIL", label)
            if not passed:
                any_fail = True

        if any_fail:
            state.mark_failed("smoke_check", "one or more checks failed")
        else:
            state.mark_done("smoke_check")
    else:
        log.item(SKIPPED, "smoke_check (dry-run)")
        state.mark_done("smoke_check")

    timings["smoke_check"] = time.time() - t0

    # ── Final report ──────────────────────────────────────────────────────────
    log.summary(timings)
    total = sum(timings.values())

    hardcodes = [
        "src/lib/pos-config.ts:28 — SSR fallback to 'amalay' (P3: cosmetic flicker)",
        "src/lib/pos-data.ts:1258 — AMALAY custom floor plan (P3: VANTARA uses generic grid)",
        "src/app/admin/tarjetas-regalo/page.tsx:23 — default client_id='amalay' (P1)",
        "src/app/api/health/route.ts — reads wansoft_daily (P3: health check false negative)",
    ]

    print()
    print("  Known hardcodes (see HARDCODE-ISSUES-REGISTRY.md):")
    for h in hardcodes:
        print(f"    · {h}")

    print()
    print("  Manual steps still required:")
    print("    1. Create Vercel project fullsite-sandbox (if not done)")
    print("    2. Set env vars in Vercel: NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_KEY, SANDBOX_ENV=true")
    print("    3. Add DNS CNAME: sandbox.app → cname.vercel-dns.com")
    print("    4. Add domain in Vercel → sandbox.app.fullsite.mx")

    if show_password and not dry_run:
        if sys.stdout.isatty():
            # Interactive terminal: show once in-band
            print()
            print("  ╔═══════════════════════════════════════════════════════════════╗")
            print("  ║  OWNER CREDENTIALS — SAVE NOW — NOT STORED ANYWHERE ELSE     ║")
            print(f"  ║  Email:    {email:<51s}║")
            print(f"  ║  Password: {owner_pwd:<51s}║")
            print("  ║  Change before sharing with the client.                      ║")
            print("  ╚═══════════════════════════════════════════════════════════════╝")
        else:
            # Non-interactive (CI, pipe, Vercel): write to file with 0600, never print to stdout
            cred_path = Path(f"/tmp/fullsite-creds-{client_id}.txt")
            cred_path.write_text(f"email={email}\npassword={owner_pwd}\nclient_id={client_id}\n")
            cred_path.chmod(0o600)
            print()
            print(f"  Non-interactive mode: credentials written to {cred_path}")
            print(f"  Read and delete: cat {cred_path} && rm {cred_path}")
            print(f"  File is 0600 — readable only by current user. Delete after use.")

    print()
    print(f"  Cloneability Time: {total:.0f}s ({total/60:.1f} min) automated")
    print(f"  Target: < 8 min total (including manual Vercel/DNS steps: ~25 min)")
    print()

    # Clean up state file on full success
    if not any(v.get("status") == "failed"
               for v in state.data["stages"].values()):
        state.path.unlink(missing_ok=True)


def _check_count(rest, table, filter_str, svc_h):
    s, r = get(f"{rest}/{table}?{filter_str}&select=id", svc_h)
    return len(r) if s == 200 and isinstance(r, list) else 0


def _offer_rollback(url, rest, auth, svc_h, state, log, client_id, dry_run):
    print()
    print("  ── Rollback available ──────────────────────────────────────────")
    print(f"  Run with --rollback to undo created rows for client_id='{client_id}'")
    created = state.data.get("created", {})
    for kind, ids in created.items():
        print(f"    {kind}: {len(ids)} item(s)")


def do_rollback_mode(url, rest, auth, svc_h, state, log, client_id, dry_run):
    log.section("Rollback")
    created = state.data.get("created", {})
    if not created:
        print("  Nothing to roll back.")
        return

    table_map = {
        "clients": ("clients", "id"),
        "categories": ("pos_menu_categories", "id"),
        "items": ("pos_menu_items", "id"),
        "modifier_groups": ("pos_modifier_groups", "id"),
        "modifiers": ("pos_modifiers", "id"),
        "payment_methods": ("pos_payment_methods", "id"),
        "staff": ("pos_staff", "id"),
    }

    for kind, ids in reversed(list(created.items())):
        if kind == "auth_users":
            for uid in ids:
                if not dry_run:
                    s, _ = _req("DELETE", f"{url}/auth/v1/admin/users/{uid}", None, svc_h)
                    status = ROLLED_BACK if s in (200, 204) else FAILED
                else:
                    status = SKIPPED
                log.item(status, f"auth_users: {uid}")
            continue

        if kind == "client_users":
            for entry in ids:
                user_id, cid = entry.split(":", 1)
                if not dry_run:
                    encoded_uid = urllib.parse.quote(user_id)
                    encoded_cid = urllib.parse.quote(cid)
                    s, _ = delete(
                        f"{rest}/client_users?user_id=eq.{encoded_uid}&client_id=eq.{encoded_cid}",
                        svc_h)
                    status = ROLLED_BACK if s in (200, 204) else FAILED
                else:
                    status = SKIPPED
                log.item(status, f"client_users: {entry}")
            continue

        if kind == "item_modifier_links":
            continue  # compound PK DELETE omitted — safe to leave (orphaned if parent deleted)

        if kind not in table_map:
            log.warn(f"No rollback handler for kind={kind}")
            continue

        tbl, pk = table_map[kind]
        for id_ in ids:
            if not dry_run:
                encoded = urllib.parse.quote(str(id_))
                s, _ = delete(f"{rest}/{tbl}?{pk}=eq.{encoded}", svc_h)
                status = ROLLED_BACK if s in (200, 204) else FAILED
            else:
                status = SKIPPED
            log.item(status, f"{tbl}: {id_}")

    state.reset()
    print("\n  Rollback complete. State file cleared.")


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        description="Fullsite tenant onboarding — single command",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--client-id",    required=True, help="Unique tenant slug (e.g. vantara)")
    p.add_argument("--name",         required=True, help="Display name (e.g. 'Grupo VANTARA')")
    p.add_argument("--owner-email",  required=True, help="Owner auth email")
    p.add_argument("--template",     required=True, choices=list(TEMPLATES), help="Data template")
    p.add_argument("--confirm-ref",  required=True, help="Supabase project ref to confirm target")
    p.add_argument("--dry-run",      action="store_true", help="Plan only — touch nothing")
    p.add_argument("--resume",       action="store_true", help="Resume from last checkpoint")
    p.add_argument("--rollback",     action="store_true", help="Undo created records for this client")

    args = p.parse_args()

    try:
        run_onboarding(args)
    except KeyboardInterrupt:
        print("\n\nInterrupted. Run with --resume to continue or --rollback to undo.")
        sys.exit(130)


if __name__ == "__main__":
    main()
