#!/usr/bin/env python3
"""
onboard_client.py — Pipeline orchestrator: onboarding completo en un solo comando.

Uso:
    python3 scripts/onboarding/onboard_client.py manifest.json
    python3 scripts/onboarding/onboard_client.py manifest.json --dry-run
    python3 scripts/onboarding/onboard_client.py manifest.json --resume
    python3 scripts/onboarding/onboard_client.py manifest.json --only client_create,menu_seed
    python3 scripts/onboarding/onboard_client.py manifest.json --skip vercel_provision,dns_provision
    python3 scripts/onboarding/onboard_client.py manifest.json --teardown

Manifest (manifest.json) — campos requeridos:
    client_id      slug único del cliente (ej. grupo-galeria-dunkin)
    name           nombre visible (ej. "Dunkin' Donuts Galería")
    owner_email    email del dueño para auth
    confirm_ref    project ref de Supabase (previene ejecutar sobre el proyecto equivocado)
    template       template de datos: minimal | cafe | full-service

Campos opcionales (habilitan pasos adicionales):
    menu_csv       path al CSV de menú → habilita menu_import + diff_report
    staff_csv      path al CSV de personal → habilita staff_import
    vercel_project nombre del proyecto en Vercel → habilita vercel_provision
    github_repo    owner/repo de GitHub (requerido con vercel_project)
    subdomain      subdominio (dunkin → dunkin.app.fullsite.mx) → habilita dns_provision
    cf_zone_id     Cloudflare Zone ID (alternativo a CF_ZONE_ID env)
    dns_verify     true/false — esperar a que el dominio sea válido
    city           ciudad del cliente (default: Monterrey)
    timezone       timezone (default: America/Monterrey)

Variables de entorno requeridas:
    SUPABASE_URL          https://<ref>.supabase.co   (acepta alias _SANDBOX)
    SUPABASE_SERVICE_KEY  service_role key            (acepta alias SANDBOX_SERVICE_KEY)
    SUPABASE_ANON_KEY     anon key                    (acepta alias _SANDBOX)
    SANDBOX_ENV           debe ser 'true'

Variables opcionales (para pasos Vercel/DNS):
    VERCEL_TOKEN, VERCEL_TEAM_ID, CF_API_TOKEN

Pasos del pipeline:
    [SIEMPRE]   env_validation, schema_check, client_create
    [SIEMPRE]   menu_seed, modifiers_seed, payment_methods_seed, staff_seed
    [SIEMPRE]   auth_user_create, client_users_create
    [OPCIONAL]  menu_import    — si manifest.menu_csv
    [OPCIONAL]  diff_report    — si manifest.menu_csv (gate de go-live)
    [OPCIONAL]  staff_import   — si manifest.staff_csv
    [OPCIONAL]  vercel_provision — si manifest.vercel_project
    [OPCIONAL]  dns_provision  — si manifest.subdomain
    [SIEMPRE]   smoke_check
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

SCRIPT_DIR   = Path(__file__).parent
AMALAY_REF   = "qjiomlvudfmzuvqvhwpk"
FORBIDDEN    = {"amalay"}
JWT_PAT      = re.compile(r'eyJ[A-Za-z0-9_\-\.]{50,}')

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode    = ssl.CERT_NONE

REQUIRED_MANIFEST_FIELDS = ["client_id", "name", "owner_email", "confirm_ref", "template"]

# ── Templates ─────────────────────────────────────────────────────────────────
TEMPLATES = {
    "minimal": {
        "type": "casual", "mesas": 4, "iva_rate": 0.16,
        "categories": [
            {"id_suffix": "cat-alimentos", "name": "Alimentos", "color": "bg-blue-600",  "sort_order": 1},
            {"id_suffix": "cat-bebidas",   "name": "Bebidas",   "color": "bg-amber-500", "sort_order": 2},
        ],
        "items": [
            {"id_suffix": "item-platillo", "cat_suffix": "cat-alimentos", "name": "Platillo del Día", "price": 120.00},
            {"id_suffix": "item-agua",     "cat_suffix": "cat-bebidas",   "name": "Agua Natural",     "price": 30.00},
        ],
        "modifier_groups": [], "modifiers": [], "item_modifier_links": [],
        "payment_methods": [
            {"id_suffix": "pm-efectivo", "name": "Efectivo", "type": "cash", "commission_pct": 0},
        ],
        "staff": [
            {"id_suffix": "staff-admin",  "name": "Administrador", "pin": "9001", "role": "admin",  "role_display": "Gerente"},
            {"id_suffix": "staff-mesero", "name": "Mesero",        "pin": "1001", "role": "mesero", "role_display": "Mesero"},
        ],
    },
    "cafe": {
        "type": "cafe", "mesas": 12, "iva_rate": 0.16,
        "categories": [
            {"id_suffix": "cat-entradas",    "name": "Entradas",       "color": "bg-emerald-600", "sort_order": 1},
            {"id_suffix": "cat-principales", "name": "Platos Fuertes", "color": "bg-blue-600",    "sort_order": 2},
            {"id_suffix": "cat-bebidas",     "name": "Bebidas",        "color": "bg-amber-500",   "sort_order": 3},
        ],
        "items": [
            {"id_suffix": "item-guacamole",  "cat_suffix": "cat-entradas",    "name": "Guacamole",          "price": 120.00},
            {"id_suffix": "item-quesadilla", "cat_suffix": "cat-entradas",    "name": "Quesadilla",         "price": 95.00},
            {"id_suffix": "item-ribeye",     "cat_suffix": "cat-principales", "name": "Ribeye 300g",        "price": 680.00},
            {"id_suffix": "item-salmon",     "cat_suffix": "cat-principales", "name": "Salmón a la Plancha","price": 420.00},
            {"id_suffix": "item-pollo",      "cat_suffix": "cat-principales", "name": "Pollo a la Brasa",   "price": 295.00},
            {"id_suffix": "item-agua",       "cat_suffix": "cat-bebidas",     "name": "Agua Mineral",       "price": 45.00},
            {"id_suffix": "item-cafe",       "cat_suffix": "cat-bebidas",     "name": "Café Americano",     "price": 55.00},
            {"id_suffix": "item-limonada",   "cat_suffix": "cat-bebidas",     "name": "Limonada Natural",   "price": 65.00},
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
            {"id_suffix": "mod-queso",    "group_suffix": "mg-extras", "name": "Queso Extra",    "price": 25, "sort_order": 1},
            {"id_suffix": "mod-aguacate", "group_suffix": "mg-extras", "name": "Aguacate Extra", "price": 35, "sort_order": 2},
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
        ],
    },
    "full-service": {
        "type": "full-service", "mesas": 20, "iva_rate": 0.16,
        "categories": [
            {"id_suffix": "cat-entradas",    "name": "Entradas",        "color": "bg-emerald-600", "sort_order": 1},
            {"id_suffix": "cat-sopas",       "name": "Sopas",           "color": "bg-orange-500",  "sort_order": 2},
            {"id_suffix": "cat-principales", "name": "Platos Fuertes",  "color": "bg-blue-600",    "sort_order": 3},
            {"id_suffix": "cat-postres",     "name": "Postres",         "color": "bg-pink-500",    "sort_order": 4},
            {"id_suffix": "cat-bebidas",     "name": "Bebidas",         "color": "bg-amber-500",   "sort_order": 5},
            {"id_suffix": "cat-vinos",       "name": "Vinos y Licores", "color": "bg-purple-600",  "sort_order": 6},
        ],
        "items": [
            {"id_suffix": "item-guac",   "cat_suffix": "cat-entradas",    "name": "Guacamole",          "price": 130.00},
            {"id_suffix": "item-brusc",  "cat_suffix": "cat-entradas",    "name": "Bruschetta",         "price": 110.00},
            {"id_suffix": "item-crema",  "cat_suffix": "cat-sopas",       "name": "Crema del Día",      "price": 95.00},
            {"id_suffix": "item-ribeye", "cat_suffix": "cat-principales", "name": "Ribeye 400g",        "price": 780.00},
            {"id_suffix": "item-salmon", "cat_suffix": "cat-principales", "name": "Salmón",             "price": 450.00},
            {"id_suffix": "item-pasta",  "cat_suffix": "cat-principales", "name": "Pasta Alfredo",      "price": 240.00},
            {"id_suffix": "item-choco",  "cat_suffix": "cat-postres",     "name": "Pastel de Chocolate","price": 120.00},
            {"id_suffix": "item-agua",   "cat_suffix": "cat-bebidas",     "name": "Agua Mineral",       "price": 50.00},
            {"id_suffix": "item-cafe",   "cat_suffix": "cat-bebidas",     "name": "Café Americano",     "price": 60.00},
            {"id_suffix": "item-vino-t", "cat_suffix": "cat-vinos",       "name": "Vino Tinto Copa",    "price": 150.00},
            {"id_suffix": "item-vino-b", "cat_suffix": "cat-vinos",       "name": "Vino Blanco Copa",   "price": 140.00},
        ],
        "modifier_groups": [
            {"id_suffix": "mg-punto",  "name": "Punto de Cocción", "sort_order": 1, "min_selections": 1, "max_selections": 1, "required": True},
            {"id_suffix": "mg-extras", "name": "Extras",           "sort_order": 2, "min_selections": 0, "max_selections": 5, "required": False},
        ],
        "modifiers": [
            {"id_suffix": "mod-rojo",    "group_suffix": "mg-punto",  "name": "Término Rojo",  "price": 0,  "sort_order": 1},
            {"id_suffix": "mod-medio",   "group_suffix": "mg-punto",  "name": "Tres Cuartos",  "price": 0,  "sort_order": 2},
            {"id_suffix": "mod-bien",    "group_suffix": "mg-punto",  "name": "Bien Cocido",   "price": 0,  "sort_order": 3},
            {"id_suffix": "mod-queso",   "group_suffix": "mg-extras", "name": "Queso Extra",   "price": 30, "sort_order": 1},
            {"id_suffix": "mod-avocado", "group_suffix": "mg-extras", "name": "Aguacate Extra","price": 40, "sort_order": 2},
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
            {"id_suffix": "staff-mesa-1", "name": "Mesero 1",        "pin": "1001", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-2", "name": "Mesero 2",        "pin": "1002", "role": "mesero", "role_display": "Mesero"},
            {"id_suffix": "staff-mesa-3", "name": "Mesero 3",        "pin": "1003", "role": "mesero", "role_display": "Mesero"},
        ],
    },
}

# ── Pipeline definition ───────────────────────────────────────────────────────
# (name, kind, condition_key)
# condition_key: manifest key that must be non-empty to activate optional steps
PIPELINE = [
    ("env_validation",       "internal", None),
    ("schema_check",         "internal", None),
    ("client_create",        "internal", None),
    ("menu_seed",            "internal", None),
    ("modifiers_seed",       "internal", None),
    ("payment_methods_seed", "internal", None),
    ("staff_seed",           "internal", None),
    ("auth_user_create",     "internal", None),
    ("client_users_create",  "internal", None),
    ("menu_import",          "external", "menu_csv"),
    ("diff_report",          "external", "menu_csv"),
    ("staff_import",         "external", "staff_csv"),
    ("vercel_provision",     "external", "vercel_project"),
    ("dns_provision",        "external", "subdomain"),
    ("smoke_check",          "internal", None),
]

ALL_STEP_NAMES = [name for name, _, _ in PIPELINE]


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def redact(s):
    return JWT_PAT.sub("***REDACTED***", str(s))

def _req(method, url, body, headers, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else [])
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:    return e.code, json.loads(raw)
        except Exception: return e.code, raw
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e)

def _get(url, h):     return _req("GET",    url, None,  h)
def _post(url, b, h): return _req("POST",   url, b,     h)
def _del(url, h):     return _req("DELETE", url, None,  h)


# ── Checkpoint state ──────────────────────────────────────────────────────────

class State:
    def __init__(self, client_id):
        self.path  = Path(f"/tmp/fullsite-pipeline-{client_id}.json")
        self._data = self._load()

    def _load(self):
        if self.path.exists():
            try:
                return json.loads(self.path.read_text())
            except Exception:
                pass
        return {"steps": {}, "created": {}, "ctx": {}, "started_at": time.time()}

    def _save(self):
        self.path.write_text(json.dumps(self._data, indent=2))

    def step_done(self, name):
        return self._data["steps"].get(name, {}).get("status") in ("PASS", "WARN")

    def mark_step(self, name, result):
        self._data["steps"][name] = result
        self._save()

    def record_created(self, kind, id_):
        self._data["created"].setdefault(kind, [])
        if id_ not in self._data["created"][kind]:
            self._data["created"][kind].append(id_)
        self._save()

    def set_ctx(self, key, value):
        self._data["ctx"][key] = value
        self._save()

    def get_ctx(self, key, default=None):
        return self._data["ctx"].get(key, default)

    def all_created(self):
        return dict(self._data.get("created", {}))

    def started_at(self):
        return self._data.get("started_at", time.time())

    def reset(self):
        self.path.unlink(missing_ok=True)
        self._data = {"steps": {}, "created": {}, "ctx": {}, "started_at": time.time()}


# ── Contract helper ───────────────────────────────────────────────────────────

def _contract(step, t0, created=0, updated=0, warnings=None, errors=None, skipped=False):
    w = warnings or []
    e = errors   or []
    if skipped:
        status = "SKIP"
    elif e:
        status = "FAIL"
    elif w:
        status = "WARN"
    else:
        status = "PASS"
    return {
        "step":        step,
        "status":      status,
        "duration_ms": int((time.time() - t0) * 1000),
        "created":     created,
        "updated":     updated,
        "warnings":    w,
        "errors":      e,
        "skipped":     skipped,
    }


# ── Upsert helpers ────────────────────────────────────────────────────────────

def _upsert(rest, table, row, pk, svc_h, state, kind, dry_run):
    pk_val = row[pk]
    enc    = urllib.parse.quote(str(pk_val))
    s, ex  = _get(f"{rest}/{table}?{pk}=eq.{enc}&select={pk}&limit=1", svc_h)

    if s == 200 and isinstance(ex, list) and ex:
        print(f"  = [ALREADY_EXISTS ] {table}: {pk_val}")
        return "ALREADY_EXISTS"

    if dry_run:
        print(f"  · [DRY-RUN       ] {table}: {pk_val}")
        return "SKIPPED"

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, r2 = _post(f"{rest}/{table}", row, h)
    if s2 in (200, 201):
        state.record_created(kind, pk_val)
        print(f"  ✚ [CREATED       ] {table}: {pk_val}")
        return "CREATED"

    print(f"  ✗ [FAILED        ] {table}: {pk_val} — {redact(str(r2)[:100])}", file=sys.stderr)
    return "FAILED"


def _upsert_compound(rest, table, row, pk_fields, svc_h, state, kind, dry_run):
    filters = "&".join(f"{k}=eq.{urllib.parse.quote(str(row[k]))}" for k in pk_fields)
    label   = "|".join(str(row[k]) for k in pk_fields)
    s, ex   = _get(f"{rest}/{table}?{filters}&limit=1", svc_h)

    if s == 200 and isinstance(ex, list) and ex:
        print(f"  = [ALREADY_EXISTS ] {table}: {label}")
        return "ALREADY_EXISTS"

    if dry_run:
        print(f"  · [DRY-RUN       ] {table}: {label}")
        return "SKIPPED"

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, r2 = _post(f"{rest}/{table}", row, h)
    if s2 in (200, 201):
        state.record_created(kind, label)
        print(f"  ✚ [CREATED       ] {table}: {label}")
        return "CREATED"

    print(f"  ✗ [FAILED        ] {table}: {label} — {redact(str(r2)[:100])}", file=sys.stderr)
    return "FAILED"


def _gen_password():
    alpha = string.ascii_letters + string.digits + "!@#$"
    while True:
        p = "".join(secrets.choice(alpha) for _ in range(16))
        if any(c.isupper() for c in p) and any(c.islower() for c in p) and any(c.isdigit() for c in p):
            return p


# ── Internal step handlers ────────────────────────────────────────────────────

def step_env_validation(ctx, dry_run):
    t0 = time.time()
    m  = ctx["manifest"]
    errors   = []
    warnings = []

    # Resolve env vars (accept multiple naming conventions)
    url      = (os.environ.get("SUPABASE_URL")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_URL_SANDBOX")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    svc_key  = (os.environ.get("SUPABASE_SERVICE_KEY")
                or os.environ.get("SANDBOX_SERVICE_KEY") or "")
    anon_key = (os.environ.get("SUPABASE_ANON_KEY")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX") or "")
    sbox     = os.environ.get("SANDBOX_ENV", "")

    if sbox != "true":
        errors.append("SANDBOX_ENV debe ser 'true'")
    if not url:
        errors.append("SUPABASE_URL vacío (o alias NEXT_PUBLIC_SUPABASE_URL_SANDBOX)")
    if not svc_key:
        errors.append("SUPABASE_SERVICE_KEY vacío (o alias SANDBOX_SERVICE_KEY)")
    if not anon_key:
        errors.append("SUPABASE_ANON_KEY vacío (o alias NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX)")
    if url and AMALAY_REF in url:
        errors.append(f"URL contiene ref de AMALAY producción — ABORTANDO")
    if m.get("client_id") in FORBIDDEN:
        errors.append(f"client_id='{m['client_id']}' prohibido")
    if svc_key and anon_key and svc_key == anon_key:
        errors.append("SERVICE_KEY == ANON_KEY — usa la service_role key, no la anon key")
    if m.get("template") not in TEMPLATES:
        errors.append(f"template '{m.get('template')}' desconocido. Válidos: {', '.join(TEMPLATES)}")
    if m.get("vercel_project") and not m.get("github_repo"):
        errors.append("manifest.vercel_project requiere manifest.github_repo")
    if m.get("subdomain") and not m.get("vercel_project"):
        errors.append("manifest.subdomain requiere manifest.vercel_project")

    if url and svc_key and not errors:
        match = re.search(r"https://([^.]+)\.supabase\.co", url)
        project_ref = match.group(1) if match else "unknown"
        if m["confirm_ref"] != project_ref:
            errors.append(
                f"confirm_ref='{m['confirm_ref']}' != project ref '{project_ref}'. "
                f"Actualiza el manifest con confirm_ref: {project_ref}"
            )
        else:
            owner_pwd = os.environ.get("OWNER_PASSWORD", "") or _gen_password()
            ctx.update({
                "url":          url,
                "svc_key":      svc_key,
                "anon_key":     anon_key,
                "svc_h":        {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"},
                "rest":         f"{url}/rest/v1",
                "auth":         f"{url}/auth/v1",
                "project_ref":  project_ref,
                "owner_pwd":    owner_pwd,
                "show_password": not bool(os.environ.get("OWNER_PASSWORD")),
            })
            print(f"  ✓ URL: {url}")
            print(f"  ✓ project_ref: {project_ref}")
            print(f"  ✓ client_id: {m['client_id']}")
            print(f"  ✓ template: {m['template']}")

    return _contract("env_validation", t0, errors=errors, warnings=warnings)


def step_schema_check(ctx, dry_run):
    t0 = time.time()
    s, _ = _get(f"{ctx['rest']}/clients?select=id&limit=0", ctx["svc_h"])
    if s == 200:
        print("  ✓ Schema aplicado (tabla clients existe)")
        return _contract("schema_check", t0)
    return _contract("schema_check", t0, errors=[
        f"Schema no aplicado — clients → HTTP {s}. "
        "Aplica las migraciones en Supabase SQL Editor y vuelve a ejecutar."
    ])


def step_client_create(ctx, dry_run):
    t0   = time.time()
    m    = ctx["manifest"]
    tmpl = TEMPLATES[m["template"]]
    # W1-D onboarding gate: un tenant production-ready DEBE tener semántica de
    # día operativo explícita. Sin business_day_start_local en el manifest, el
    # onboarding FALLA (no se hereda un default silencioso — el corte del día
    # es una decisión del restaurante, no de Fullsite).
    if not m.get("business_day_start_local"):
        return _contract("client_create", t0, errors=[
            "manifest sin business_day_start_local — requerido para Client #2+ "
            "(ej. '04:00:00'). El día operativo debe ser configuración explícita del tenant."
        ])
    if not m.get("timezone"):
        return _contract("client_create", t0, errors=[
            "manifest sin timezone — requerido (IANA, ej. 'America/Monterrey')."
        ])

    st   = _upsert(ctx["rest"], "clients", {
        "id":             m["client_id"],
        "display_name":   m["name"],
        "city":           m.get("city", "Monterrey"),
        "timezone":       m["timezone"],
        "business_day_start_local": m["business_day_start_local"],
        "data_source":    "fullsite",
        "active":         True,
        "default_theme":  "dark",
        "accent_color":   "emerald",
        "mesas":          tmpl["mesas"],
        "features":       json.dumps({"pos": True, "kds": True, "dashboard": True,
                                      "inventory": False, "agents": False}),
        "iva_rate":       tmpl["iva_rate"],
        "receipt_footer": f"Bienvenido a {m['name']}",
        "type":           tmpl["type"],
    }, "id", ctx["svc_h"], ctx["state"], "clients", dry_run)

    if st == "FAILED":
        return _contract("client_create", t0, errors=["upsert clients falló — ver error arriba"])
    return _contract("client_create", t0,
                     created=1 if st == "CREATED" else 0,
                     updated=1 if st == "ALREADY_EXISTS" else 0)


def _seed_table(ctx, step_name, t0, dry_run, items_spec):
    """Generic helper for seeding a list of rows. Returns contract dict."""
    errors  = []
    created = 0
    for spec in items_spec:
        st = spec["fn"]()
        if st == "CREATED":   created += 1
        elif st == "FAILED":  errors.append(spec["label"])
    return _contract(step_name, t0, created=created, errors=errors if errors else None)


def step_menu_seed(ctx, dry_run):
    t0   = time.time()
    m    = ctx["manifest"]
    cid  = m["client_id"]
    tmpl = TEMPLATES[m["template"]]
    rest = ctx["rest"]
    sh   = ctx["svc_h"]
    st_  = ctx["state"]
    errors  = []
    created = 0

    for cat in tmpl["categories"]:
        cat_id = f"{cid}-{cat['id_suffix']}"
        st = _upsert(rest, "pos_menu_categories", {
            "id": cat_id, "client_id": cid, "name": cat["name"],
            "color": cat["color"], "sort_order": cat["sort_order"], "active": True,
        }, "id", sh, st_, "categories", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"category '{cat['name']}'")

    for item in tmpl["items"]:
        item_id = f"{cid}-{item['id_suffix']}"
        cat_id  = f"{cid}-{item['cat_suffix']}"
        st = _upsert(rest, "pos_menu_items", {
            "id": item_id, "client_id": cid, "category_id": cat_id,
            "name": item["name"], "price": item["price"], "active": True,
        }, "id", sh, st_, "items", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"item '{item['name']}'")

    return _contract("menu_seed", t0, created=created, errors=errors or None)


def step_modifiers_seed(ctx, dry_run):
    t0   = time.time()
    m    = ctx["manifest"]
    cid  = m["client_id"]
    tmpl = TEMPLATES[m["template"]]
    rest = ctx["rest"]
    sh   = ctx["svc_h"]
    st_  = ctx["state"]
    errors  = []
    created = 0

    for mg in tmpl["modifier_groups"]:
        mg_id = f"{cid}-{mg['id_suffix']}"
        st = _upsert(rest, "pos_modifier_groups", {
            "id": mg_id, "client_id": cid, "name": mg["name"],
            "sort_order": mg["sort_order"], "active": True, "level": 1,
            "min_selections": mg["min_selections"],
            "max_selections": mg.get("max_selections"),
            "required": mg["required"],
        }, "id", sh, st_, "modifier_groups", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"group '{mg['name']}'")

    for mod in tmpl["modifiers"]:
        mod_id = f"{cid}-{mod['id_suffix']}"
        grp_id = f"{cid}-{mod['group_suffix']}"
        st = _upsert(rest, "pos_modifiers", {
            "id": mod_id, "client_id": cid, "group_id": grp_id,
            "name": mod["name"], "price": mod["price"],
            "sort_order": mod["sort_order"], "active": True,
        }, "id", sh, st_, "modifiers", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"modifier '{mod['name']}'")

    for lnk in tmpl["item_modifier_links"]:
        item_id = f"{cid}-{lnk['item_suffix']}"
        grp_id  = f"{cid}-{lnk['group_suffix']}"
        st = _upsert_compound(rest, "pos_item_modifier_groups", {
            "client_id": cid, "item_id": item_id, "group_id": grp_id,
        }, ["client_id", "item_id", "group_id"], sh, st_, "item_modifier_links", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"link {lnk['item_suffix']}→{lnk['group_suffix']}")

    return _contract("modifiers_seed", t0, created=created, errors=errors or None)


def step_payment_methods_seed(ctx, dry_run):
    t0   = time.time()
    m    = ctx["manifest"]
    cid  = m["client_id"]
    tmpl = TEMPLATES[m["template"]]
    errors  = []
    created = 0

    for pm in tmpl["payment_methods"]:
        pm_id = f"{cid}-{pm['id_suffix']}"
        st = _upsert(ctx["rest"], "pos_payment_methods", {
            "id": pm_id, "client_id": cid, "name": pm["name"],
            "type": pm["type"], "commission_pct": pm["commission_pct"], "active": True,
        }, "id", ctx["svc_h"], ctx["state"], "payment_methods", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"payment_method '{pm['name']}'")

    return _contract("payment_methods_seed", t0, created=created, errors=errors or None)


def step_staff_seed(ctx, dry_run):
    t0   = time.time()
    m    = ctx["manifest"]
    cid  = m["client_id"]
    tmpl = TEMPLATES[m["template"]]
    errors  = []
    created = 0

    for member in tmpl["staff"]:
        sid = f"{cid}-{member['id_suffix']}"
        st = _upsert(ctx["rest"], "pos_staff", {
            "id": sid, "client_id": cid, "name": member["name"],
            "pin": member["pin"], "role": member["role"],
            "role_display": member["role_display"], "active": True,
        }, "id", ctx["svc_h"], ctx["state"], "staff", dry_run)
        if st == "CREATED":  created += 1
        elif st == "FAILED": errors.append(f"staff '{member['name']}'")

    return _contract("staff_seed", t0, created=created, errors=errors or None)


def step_auth_user_create(ctx, dry_run):
    t0 = time.time()
    m  = ctx["manifest"]

    if dry_run:
        print(f"  · [DRY-RUN       ] auth user: {m['owner_email']}")
        return _contract("auth_user_create", t0)

    auth    = ctx["auth"]
    svc_key = ctx["svc_key"]
    h = {"apikey": svc_key, "Authorization": f"Bearer {svc_key}",
         "Content-Type": "application/json"}

    s, r = _post(f"{auth}/admin/users", {
        "email":         m["owner_email"],
        "password":      ctx["owner_pwd"],
        "email_confirm": True,
    }, h)

    if s in (200, 201) and isinstance(r, dict):
        uid = r["id"]
        ctx["state"].set_ctx("auth_user_id", uid)
        ctx["state"].record_created("auth_users", uid)
        print(f"  ✚ [CREATED       ] auth user: {m['owner_email']} (id={uid[:8]}…)")
        return _contract("auth_user_create", t0, created=1)

    if s == 422 and "already" in str(r).lower():
        # Fetch existing user_id
        s2, r2 = _req("GET", f"{auth}/admin/users", None, h)
        uid = None
        if s2 == 200 and isinstance(r2, dict):
            for u in r2.get("users", []):
                if u.get("email") == m["owner_email"]:
                    uid = u["id"]
                    break
        if uid:
            ctx["state"].set_ctx("auth_user_id", uid)
        print(f"  = [ALREADY_EXISTS ] auth user: {m['owner_email']}")
        return _contract("auth_user_create", t0, updated=1)

    return _contract("auth_user_create", t0, errors=[
        f"auth/admin/users → HTTP {s}: {redact(str(r)[:120])}"
    ])


def step_client_users_create(ctx, dry_run):
    t0  = time.time()
    m   = ctx["manifest"]
    uid = ctx["state"].get_ctx("auth_user_id")

    if not uid:
        return _contract("client_users_create", t0, warnings=[
            "auth_user_id no disponible — membership omitida "
            "(auth_user_create falló o fue excluida con --skip)"
        ])

    if dry_run:
        print(f"  · [DRY-RUN       ] client_users: {m['owner_email']} → {m['client_id']}")
        return _contract("client_users_create", t0)

    rest  = ctx["rest"]
    svc_h = ctx["svc_h"]
    s, ex = _get(
        f"{rest}/client_users?user_id=eq.{urllib.parse.quote(uid)}"
        f"&client_id=eq.{urllib.parse.quote(m['client_id'])}&select=id&limit=1",
        svc_h)

    if s == 200 and isinstance(ex, list) and ex:
        print(f"  = [ALREADY_EXISTS ] client_users: {m['owner_email']} → {m['client_id']}")
        return _contract("client_users_create", t0, updated=1)

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, r2 = _post(f"{rest}/client_users", {
        "user_id": uid, "client_id": m["client_id"], "role": "dueño",
    }, h)

    if s2 in (200, 201):
        ctx["state"].record_created("client_users", f"{uid}:{m['client_id']}")
        print(f"  ✚ [CREATED       ] client_users: {m['owner_email']} → {m['client_id']} (dueño)")
        return _contract("client_users_create", t0, created=1)

    return _contract("client_users_create", t0, errors=[
        f"client_users → HTTP {s2}: {redact(str(r2)[:120])}"
    ])


def step_smoke_check(ctx, dry_run):
    t0   = time.time()
    m    = ctx["manifest"]
    cid  = m["client_id"]
    rest = ctx["rest"]
    auth = ctx["auth"]
    sh   = ctx["svc_h"]

    if dry_run:
        print("  · [DRY-RUN       ] smoke_check omitido en dry-run")
        return _contract("smoke_check", t0)

    def count(table, flt):
        s, r = _get(f"{rest}/{table}?{flt}&select=id", sh)
        return len(r) if s == 200 and isinstance(r, list) else 0

    def field_set(table, flt, field):
        s, r = _get(f"{rest}/{table}?{flt}&select={field}", sh)
        return s == 200 and isinstance(r, list) and len(r) == 1 and bool(r[0].get(field))

    enc = urllib.parse.quote(cid)
    checks = [
        ("clients row existe",      count("clients",            f"id=eq.{enc}") == 1),
        # W1-D: semántica de día operativo obligatoria para tenants nuevos
        ("timezone configurada",    field_set("clients", f"id=eq.{enc}", "timezone")),
        ("business_day_start_local configurado",
                                    field_set("clients", f"id=eq.{enc}", "business_day_start_local")),
        ("menu_categories ≥ 1",     count("pos_menu_categories",f"client_id=eq.{enc}") >= 1),
        ("menu_items ≥ 1",          count("pos_menu_items",     f"client_id=eq.{enc}") >= 1),
        ("payment_methods ≥ 1",     count("pos_payment_methods",f"client_id=eq.{enc}&active=eq.true") >= 1),
        ("staff ≥ 1",               count("pos_staff",          f"client_id=eq.{enc}&active=eq.true") >= 1),
    ]

    uid = ctx["state"].get_ctx("auth_user_id")
    if uid and ctx.get("anon_key") and ctx.get("owner_pwd"):
        s_l, r_l = _post(f"{auth}/token?grant_type=password", {
            "email": m["owner_email"], "password": ctx["owner_pwd"],
        }, {"apikey": ctx["anon_key"], "Content-Type": "application/json"})
        checks.append(("login del dueño exitoso",
                        s_l == 200 and isinstance(r_l, dict) and "access_token" in r_l))

    errors = []
    for label, passed in checks:
        sym = "✓" if passed else "✗"
        print(f"  {sym} {'PASS' if passed else 'FAIL'}  {label}")
        if not passed:
            errors.append(f"smoke: '{label}' falló")

    return _contract("smoke_check", t0, errors=errors or None)


INTERNAL_HANDLERS = {
    "env_validation":       step_env_validation,
    "schema_check":         step_schema_check,
    "client_create":        step_client_create,
    "menu_seed":            step_menu_seed,
    "modifiers_seed":       step_modifiers_seed,
    "payment_methods_seed": step_payment_methods_seed,
    "staff_seed":           step_staff_seed,
    "auth_user_create":     step_auth_user_create,
    "client_users_create":  step_client_users_create,
    "smoke_check":          step_smoke_check,
}


# ── External step runner ──────────────────────────────────────────────────────

def _subprocess_env(ctx):
    """Build env for subprocesses — normalizes all Supabase naming conventions."""
    url     = ctx.get("url", "")
    svc_key = ctx.get("svc_key", "")
    anon_key = ctx.get("anon_key", "")
    return {
        **os.environ,
        # Normalize all naming conventions so every script finds what it needs
        "SUPABASE_URL":                        url,
        "NEXT_PUBLIC_SUPABASE_URL":            url,
        "NEXT_PUBLIC_SUPABASE_URL_SANDBOX":    url,
        "SUPABASE_SERVICE_KEY":                svc_key,
        "SANDBOX_SERVICE_KEY":                 svc_key,
        "SUPABASE_ANON_KEY":                   anon_key,
        "NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX": anon_key,
        "SANDBOX_ENV":                         "true",
    }


def _build_external_args(step_name, manifest, manifest_dir, report_dir):
    """Returns the CLI args list for the given external step."""
    cid = manifest["client_id"]
    ref = manifest["confirm_ref"]

    def resolve(p):
        """Resolve path relative to manifest directory."""
        return str((manifest_dir / p).resolve())

    if step_name == "menu_import":
        return ["--client-id", cid, "--csv", resolve(manifest["menu_csv"]),
                "--confirm-ref", ref]

    if step_name == "diff_report":
        out_path = str(report_dir / f"diff-report-{cid}.html")
        return ["--client-id", cid, "--source", resolve(manifest["menu_csv"]),
                "--output", out_path, "--confirm-ref", ref]

    if step_name == "staff_import":
        return ["--client-id", cid, "--csv", resolve(manifest["staff_csv"]),
                "--confirm-ref", ref]

    if step_name == "vercel_provision":
        return ["--client-id", cid, "--project-name", manifest["vercel_project"],
                "--confirm-ref", ref, "--github-repo", manifest["github_repo"]]

    if step_name == "dns_provision":
        args = ["--project", manifest["vercel_project"],
                "--subdomain", manifest["subdomain"]]
        zone_id = manifest.get("cf_zone_id") or os.environ.get("CF_ZONE_ID", "")
        if zone_id:
            args += ["--zone-id", zone_id]
        if manifest.get("dns_verify"):
            args.append("--verify")
        return args

    raise ValueError(f"No args builder for external step: {step_name}")


def run_external(step_name, manifest, manifest_dir, report_dir, ctx, dry_run, resume):
    """Run an external script, capture stdout/stderr, parse contract JSON."""
    script = SCRIPT_DIR / f"{step_name}.py"
    if not script.exists():
        return _contract(step_name, time.time(), errors=[
            f"Script no encontrado: {script}"
        ])

    args = _build_external_args(step_name, manifest, manifest_dir, report_dir)
    cmd  = [sys.executable, str(script)] + args
    if dry_run:
        cmd.append("--dry-run")
    if resume and step_name not in ("vercel_provision", "dns_provision"):
        cmd.append("--resume")

    t0   = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          env=_subprocess_env(ctx))
    duration_ms = int((time.time() - t0) * 1000)

    # Forward stderr
    if proc.stderr.strip():
        print(proc.stderr, end="", file=sys.stderr)

    # Find contract JSON (last line that parses and has 'step' + 'status')
    lines    = proc.stdout.splitlines()
    contract = None
    contract_line_idx = None
    for i in range(len(lines) - 1, -1, -1):
        try:
            parsed = json.loads(lines[i].strip())
            if isinstance(parsed, dict) and "step" in parsed and "status" in parsed:
                contract = parsed
                contract_line_idx = i
                break
        except (json.JSONDecodeError, AttributeError):
            continue

    # Print stdout lines (excluding the contract JSON line)
    for i, line in enumerate(lines):
        if i != contract_line_idx:
            print(line)

    if contract is None:
        status = "FAIL" if proc.returncode not in (0, 2) else "WARN"
        return {
            "step":        step_name,
            "status":      status,
            "duration_ms": duration_ms,
            "created":     0,
            "updated":     0,
            "warnings":    [],
            "errors":      [f"Script no emitió contrato JSON (exit={proc.returncode})"],
            "skipped":     False,
        }

    # Prefer the script's own duration, fall back to our wall-clock
    if not contract.get("duration_ms"):
        contract["duration_ms"] = duration_ms
    contract.setdefault("skipped", False)
    return contract


# ── Pipeline runner ───────────────────────────────────────────────────────────

def run_pipeline(manifest, manifest_dir, report_dir, dry_run, resume, only, skip):
    """
    Executes the pipeline. Returns (list[result_dict], pipeline_status_str).
    """
    cid   = manifest["client_id"]
    state = State(cid)

    if not resume:
        state.reset()

    ctx = {"manifest": manifest, "state": state}

    # Determine which steps to run
    only_set = set(only) if only else None
    skip_set = set(skip) if skip else set()

    results = []
    pipeline_status = "PASS"
    failed_step     = None

    step_labels = {
        "env_validation":       "1  · Validación de entorno",
        "schema_check":         "2  · Verificación de schema",
        "client_create":        "3  · Registro de cliente",
        "menu_seed":            "4  · Menú semilla (template)",
        "modifiers_seed":       "5  · Modificadores semilla",
        "payment_methods_seed": "6  · Métodos de pago semilla",
        "staff_seed":           "7  · Personal semilla (template)",
        "auth_user_create":     "8  · Auth user",
        "client_users_create":  "9  · Membresía client_users",
        "menu_import":          "10 · Importar menú (CSV)",
        "diff_report":          "11 · Diff report de menú",
        "staff_import":         "12 · Importar personal (CSV)",
        "vercel_provision":     "13 · Proyecto Vercel",
        "dns_provision":        "14 · DNS + dominio",
        "smoke_check":          "15 · Smoke check",
    }
    total_steps = len(PIPELINE)
    idx = 0

    for step_name, kind, condition_key in PIPELINE:
        idx += 1
        label = step_labels.get(step_name, step_name)

        # ── Condition check (optional steps) ─────────────────────────────────
        if condition_key and not manifest.get(condition_key):
            r = _contract(step_name, time.time(), skipped=True)
            r["_reason"] = f"omitido — manifest.{condition_key} no definido"
            results.append(r)
            continue

        # ── --only / --skip filters ───────────────────────────────────────────
        if only_set and step_name not in only_set:
            r = _contract(step_name, time.time(), skipped=True)
            r["_reason"] = "omitido — no incluido en --only"
            results.append(r)
            continue

        if step_name in skip_set:
            r = _contract(step_name, time.time(), skipped=True)
            r["_reason"] = "omitido — en --skip"
            results.append(r)
            continue

        # ── Resume: skip completed steps ──────────────────────────────────────
        if resume and state.step_done(step_name):
            cached = state._data["steps"].get(step_name, {})
            r = {**cached, "skipped": False, "_reason": "retomado desde checkpoint"}
            results.append(r)
            print(f"\n{'─'*68}")
            print(f"  [{idx:02d}/{total_steps}] {label}  [CHECKPOINT — omitido]")
            continue

        # ── Run step ──────────────────────────────────────────────────────────
        print(f"\n{'═'*68}")
        print(f"  [{idx:02d}/{total_steps}] {label}{' (DRY-RUN)' if dry_run else ''}")
        print(f"{'─'*68}")

        if kind == "internal":
            handler = INTERNAL_HANDLERS[step_name]
            result  = handler(ctx, dry_run)
        else:
            result = run_external(step_name, manifest, manifest_dir, report_dir,
                                  ctx, dry_run, resume)

        state.mark_step(step_name, result)
        results.append(result)

        status = result["status"]
        ms     = result["duration_ms"]
        print(f"\n  ── {status}  {ms}ms" +
              (f"  created={result['created']}" if result["created"] else "") +
              (f"  updated={result['updated']}" if result["updated"] else "") +
              (f"  warnings={len(result['warnings'])}" if result["warnings"] else ""))

        if status == "FAIL":
            pipeline_status = "FAIL"
            failed_step     = step_name
            print(f"\n  ✗ FAIL-FAST: el paso '{step_name}' falló.", file=sys.stderr)
            if result["errors"]:
                print("  Errores:", file=sys.stderr)
                for e in result["errors"]:
                    print(f"    · {e}", file=sys.stderr)
            print(f"\n  Para continuar desde aquí: agregar --resume", file=sys.stderr)
            print(f"  Para deshacer cambios: agregar --teardown", file=sys.stderr)
            break

    return results, pipeline_status, failed_step, ctx


# ── Teardown (rollback) ───────────────────────────────────────────────────────

def run_teardown(manifest, dry_run):
    cid   = manifest["client_id"]
    state = State(cid)
    created = state.all_created()

    if not created:
        print("  Nada que deshacer (estado vacío).")
        return

    url   = (os.environ.get("SUPABASE_URL")
             or os.environ.get("NEXT_PUBLIC_SUPABASE_URL_SANDBOX") or "").rstrip("/")
    svc_key = (os.environ.get("SUPABASE_SERVICE_KEY")
               or os.environ.get("SANDBOX_SERVICE_KEY") or "")
    if not url or not svc_key:
        print("  ✗ SUPABASE_URL / SUPABASE_SERVICE_KEY requeridos para teardown.",
              file=sys.stderr)
        sys.exit(1)

    svc_h = {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"}
    rest  = f"{url}/rest/v1"
    auth  = f"{url}/auth/v1"

    TABLE_MAP = {
        "clients":          ("clients",            "id"),
        "categories":       ("pos_menu_categories","id"),
        "items":            ("pos_menu_items",      "id"),
        "modifier_groups":  ("pos_modifier_groups", "id"),
        "modifiers":        ("pos_modifiers",       "id"),
        "payment_methods":  ("pos_payment_methods", "id"),
        "staff":            ("pos_staff",           "id"),
    }

    print(f"\n── Teardown: {cid} {'(DRY-RUN)' if dry_run else ''} {'─'*40}")
    for kind, ids in reversed(list(created.items())):
        if kind == "auth_users":
            for uid in ids:
                if dry_run:
                    print(f"  · [DRY-RUN       ] auth_users: {uid}")
                else:
                    s, _ = _req("DELETE", f"{auth}/admin/users/{uid}", None, svc_h)
                    sym = "↩" if s in (200, 204) else "✗"
                    print(f"  {sym} [{'ROLLED_BACK' if s in (200,204) else 'FAILED':14s}] auth_users: {uid}")
            continue

        if kind == "client_users":
            for entry in ids:
                uid, c_id = entry.split(":", 1)
                if dry_run:
                    print(f"  · [DRY-RUN       ] client_users: {entry}")
                else:
                    enc_u = urllib.parse.quote(uid)
                    enc_c = urllib.parse.quote(c_id)
                    s, _ = _del(f"{rest}/client_users?user_id=eq.{enc_u}&client_id=eq.{enc_c}", svc_h)
                    sym = "↩" if s in (200, 204) else "✗"
                    print(f"  {sym} [{'ROLLED_BACK' if s in (200,204) else 'FAILED':14s}] client_users: {entry}")
            continue

        if kind == "item_modifier_links":
            print(f"  · [SKIPPED       ] item_modifier_links — compound PK, omitido")
            continue

        if kind not in TABLE_MAP:
            print(f"  ~ [WARN          ] kind={kind} sin handler de rollback")
            continue

        tbl, pk = TABLE_MAP[kind]
        for id_ in ids:
            if dry_run:
                print(f"  · [DRY-RUN       ] {tbl}: {id_}")
            else:
                enc = urllib.parse.quote(str(id_))
                s, _ = _del(f"{rest}/{tbl}?{pk}=eq.{enc}", svc_h)
                sym = "↩" if s in (200, 204) else "✗"
                print(f"  {sym} [{'ROLLED_BACK' if s in (200,204) else 'FAILED':14s}] {tbl}: {id_}")

    if not dry_run:
        state.reset()
        print("\n  ✓ Teardown completo. Checkpoint eliminado.")
    else:
        print("\n  [DRY-RUN] — ningún cambio realizado.")


# ── Report generation ─────────────────────────────────────────────────────────

def _fmt_ms(ms):
    if ms < 1000:   return f"{ms}ms"
    if ms < 60000:  return f"{ms/1000:.1f}s"
    return f"{ms/60000:.1f}m"


def generate_reports(client_id, manifest, results, pipeline_status, failed_step,
                     started_at, report_dir):
    finished_at   = time.time()
    total_s       = round(finished_at - started_at, 1)
    ts_start      = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at))
    ts_finish     = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_at))
    ts_generated  = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    run_results = [r for r in results if not r.get("skipped")]
    skip_results = [r for r in results if r.get("skipped")]

    totals = {
        "created":       sum(r.get("created", 0) for r in run_results),
        "updated":       sum(r.get("updated", 0) for r in run_results),
        "warnings":      sum(len(r.get("warnings", [])) for r in run_results),
        "errors":        sum(len(r.get("errors", [])) for r in run_results),
        "steps_run":     len(run_results),
        "steps_skipped": len(skip_results),
    }

    # ── JSON ──────────────────────────────────────────────────────────────────
    report = {
        "client_id":          client_id,
        "manifest":           {k: v for k, v in manifest.items() if k not in ("owner_email",)},
        "started_at":         ts_start,
        "finished_at":        ts_finish,
        "total_duration_s":   total_s,
        "pipeline_status":    pipeline_status,
        "failed_step":        failed_step,
        "steps":              results,
        "totals":             totals,
        "report_generated_at": ts_generated,
    }

    json_path = report_dir / "report.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))

    # ── Markdown ──────────────────────────────────────────────────────────────
    status_icon = "PASS" if pipeline_status == "PASS" else "FAIL"
    lines = [
        f"# Reporte de Onboarding — {client_id}",
        "",
        f"**Status:** {status_icon}",
        f"**Cliente:** {manifest.get('name', client_id)}",
        f"**Inicio:** {ts_start}",
        f"**Fin:** {ts_finish}",
        f"**Duración total:** {_fmt_ms(int(total_s * 1000))}",
        "",
    ]

    if failed_step:
        lines += [
            f"> **FALLO EN PASO:** `{failed_step}`",
            f"> Para continuar: `python3 scripts/onboarding/onboard_client.py manifest.json --resume`",
            "",
        ]

    lines += [
        "## Pipeline",
        "",
        "| # | Paso | Status | Duración | Creados | Act. | Warns | Errors | Nota |",
        "|---|------|--------|----------|---------|------|-------|--------|------|",
    ]

    for i, r in enumerate(results, 1):
        st   = r["status"]
        icon = {"PASS": "✓", "FAIL": "✗", "WARN": "~", "SKIP": "·"}.get(st, "?")
        note = r.get("_reason", "")
        lines.append(
            f"| {i} | `{r['step']}` | {icon} {st} | {_fmt_ms(r['duration_ms'])} "
            f"| {r['created']} | {r['updated']} "
            f"| {len(r['warnings'])} | {len(r['errors'])} | {note} |"
        )

    lines += [
        "",
        "## Totales",
        "",
        f"- Registros creados: **{totals['created']}**",
        f"- Registros actualizados: **{totals['updated']}**",
        f"- Warnings: {totals['warnings']}",
        f"- Errors: {totals['errors']}",
        f"- Pasos ejecutados: {totals['steps_run']}",
        f"- Pasos omitidos: {totals['steps_skipped']}",
        "",
    ]

    # List all warnings
    all_warns = [(r["step"], w) for r in results for w in r.get("warnings", [])]
    if all_warns:
        lines += ["## Warnings", ""]
        for step, w in all_warns:
            lines.append(f"- `{step}`: {w}")
        lines.append("")

    # List all errors
    all_errs = [(r["step"], e) for r in results for e in r.get("errors", [])]
    if all_errs:
        lines += ["## Errores", ""]
        for step, e in all_errs:
            lines.append(f"- `{step}`: {e}")
        lines.append("")

    lines += [
        "---",
        f"*Generado por Fullsite onboard_client.py · {ts_generated}*",
    ]

    md_path = report_dir / "report.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")

    return json_path, md_path


def _display_credentials(ctx, dry_run):
    m = ctx.get("manifest", {})
    if not ctx.get("show_password") or dry_run:
        return
    owner_pwd = ctx.get("owner_pwd", "")
    email     = m.get("owner_email", "")
    client_id = m.get("client_id", "")

    if sys.stdout.isatty():
        print()
        print("  ╔══════════════════════════════════════════════════════════════╗")
        print("  ║  CREDENCIALES DEL DUEÑO — GUARDAR AHORA — NO SE ALMACENAN  ║")
        print(f"  ║  Email:    {email:<52s}║")
        print(f"  ║  Password: {owner_pwd:<52s}║")
        print("  ║  Cambiar antes de compartir con el cliente.                 ║")
        print("  ╚══════════════════════════════════════════════════════════════╝")
    else:
        cred_path = Path(f"/tmp/fullsite-creds-{client_id}.txt")
        cred_path.write_text(f"email={email}\npassword={owner_pwd}\nclient_id={client_id}\n")
        cred_path.chmod(0o600)
        print(f"\n  Credenciales escritas en: {cred_path} (0600)")
        print(f"  Leer y eliminar: cat {cred_path} && rm {cred_path}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def load_manifest(path):
    p = Path(path)
    if not p.exists():
        print(f"  ✗ Manifest no encontrado: {path}", file=sys.stderr)
        sys.exit(1)
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  ✗ Manifest JSON inválido: {e}", file=sys.stderr)
        sys.exit(1)

    missing = [f for f in REQUIRED_MANIFEST_FIELDS if not m.get(f)]
    if missing:
        print(f"  ✗ Manifest falta campos requeridos: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    return m, p.parent.resolve()


def main():
    p = argparse.ArgumentParser(
        description="Fullsite — Pipeline de onboarding completo",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("manifest",   help="Ruta al manifest.json del cliente")
    p.add_argument("--dry-run",  action="store_true", help="Planifica sin escribir nada")
    p.add_argument("--resume",   action="store_true", help="Continúa desde el último checkpoint")
    p.add_argument("--teardown", action="store_true", help="Deshace todos los registros creados")
    p.add_argument("--only",     default="",
                   help="Ejecutar solo estos pasos (coma-separados). "
                        f"Válidos: {', '.join(ALL_STEP_NAMES)}")
    p.add_argument("--skip",     default="",
                   help="Saltar estos pasos (coma-separados)")
    args = p.parse_args()

    manifest, manifest_dir = load_manifest(args.manifest)
    cid = manifest["client_id"]

    # Validate --only / --skip
    only = [s.strip() for s in args.only.split(",") if s.strip()] if args.only else []
    skip = [s.strip() for s in args.skip.split(",") if s.strip()] if args.skip else []

    invalid_only = [s for s in only if s not in ALL_STEP_NAMES]
    invalid_skip = [s for s in skip if s not in ALL_STEP_NAMES]
    if invalid_only:
        print(f"  ✗ Pasos desconocidos en --only: {invalid_only}", file=sys.stderr)
        print(f"     Válidos: {ALL_STEP_NAMES}", file=sys.stderr)
        sys.exit(1)
    if invalid_skip:
        print(f"  ✗ Pasos desconocidos en --skip: {invalid_skip}", file=sys.stderr)
        sys.exit(1)

    # ── Teardown mode ─────────────────────────────────────────────────────────
    if args.teardown:
        print(f"\n{'═'*68}")
        print(f"  TEARDOWN — {cid}{' (DRY-RUN)' if args.dry_run else ''}")
        print(f"{'═'*68}")
        run_teardown(manifest, args.dry_run)
        return

    # ── Report directory ──────────────────────────────────────────────────────
    ts_label  = time.strftime("%Y%m%d-%H%M%S")
    report_dir = Path("onboarding-reports") / f"{cid}-{ts_label}"
    report_dir.mkdir(parents=True, exist_ok=True)

    # ── Header ────────────────────────────────────────────────────────────────
    print(f"\n{'═'*68}")
    print(f"  FULLSITE · ONBOARDING PIPELINE")
    print(f"  Cliente:  {manifest['name']} ({cid})")
    print(f"  Template: {manifest['template']}")
    if args.dry_run: print("  Modo:     DRY-RUN — sin cambios")
    if args.resume:  print("  Modo:     RESUME desde checkpoint")
    if only:         print(f"  --only:   {', '.join(only)}")
    if skip:         print(f"  --skip:   {', '.join(skip)}")
    print(f"  Reporte:  {report_dir}/")
    print(f"{'═'*68}")

    started_at = time.time()

    try:
        results, pipeline_status, failed_step, ctx = run_pipeline(
            manifest, manifest_dir, report_dir,
            dry_run=args.dry_run,
            resume=args.resume,
            only=only,
            skip=skip,
        )
    except KeyboardInterrupt:
        print("\n\n  Interrumpido. Usa --resume para continuar.", file=sys.stderr)
        sys.exit(130)

    # ── Generate reports ──────────────────────────────────────────────────────
    json_path, md_path = generate_reports(
        cid, manifest, results, pipeline_status, failed_step,
        started_at, report_dir,
    )

    # ── Summary ───────────────────────────────────────────────────────────────
    total_ms  = int((time.time() - started_at) * 1000)
    run_count = sum(1 for r in results if not r.get("skipped"))
    skip_count = sum(1 for r in results if r.get("skipped"))
    created   = sum(r.get("created", 0) for r in results)
    warns     = sum(len(r.get("warnings", [])) for r in results)

    print(f"\n{'═'*68}")
    if pipeline_status == "PASS":
        print(f"  ✓ PIPELINE COMPLETADO  — {_fmt_ms(total_ms)}")
    else:
        print(f"  ✗ PIPELINE FALLIDO en '{failed_step}'")
    print(f"  Pasos: {run_count} ejecutados, {skip_count} omitidos")
    print(f"  Registros creados: {created}   Warnings: {warns}")
    print(f"  Reporte JSON:     {json_path}")
    print(f"  Reporte Markdown: {md_path}")
    print(f"{'═'*68}")

    _display_credentials(ctx, args.dry_run)

    if pipeline_status == "FAIL":
        print(f"\n  Siguiente: corregir el error en '{failed_step}' y ejecutar con --resume",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
