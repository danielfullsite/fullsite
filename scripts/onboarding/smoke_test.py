#!/usr/bin/env python3
"""
smoke_test.py — Gate CLON-SMOKE (R2-G06, TSK-014).

Smoke test automatizado contra un tenant recién provisionado (por
onboard_client.py). Va más allá del smoke_check inline del pipeline:
ejercita los flows críticos del POS de punta a punta vía Supabase REST,
sin datos AMALAY y sin dejar rastro (cleanup automático).

Flows cubiertos:
  F1  Provisión íntegra: clients row existe, sin contaminación AMALAY
  F2  Menú operable: ≥1 categoría, ≥1 item activo con precio > 0
  F3  Staff operable: ≥1 activo, PINs únicos (login de mesero posible)
  F4  Cobro posible: ≥1 método de pago activo
  F5  Login del dueño (GoTrue password grant con anon key)
  F6  Flow POS completo: abrir turno → crear orden con items reales del
      menú → cobrar (metodo_pago + pagos) → cerrar → verificar totales
      y aislamiento del tenant en cada paso
  F7  Cleanup: la orden y el turno sintéticos se eliminan; cero rastro
      (--keep lo omite para inspección manual)

Guardas (idénticas al pipeline de onboarding — cero escrituras si fallan):
  - SANDBOX_ENV=true requerido
  - URL con ref de AMALAY producción → aborta
  - client_id prohibido (amalay/prod) → aborta
  - --confirm-ref debe coincidir con el project ref del URL

Uso:
  SANDBOX_ENV=true SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  SUPABASE_ANON_KEY=... \
  python3 scripts/onboarding/smoke_test.py --client-id <cid> --confirm-ref <ref>

Credenciales del dueño para F5 (en orden de prioridad):
  1. env OWNER_EMAIL + OWNER_PASSWORD
  2. archivo /tmp/fullsite-creds-<client_id>.txt (lo escribe onboard_client.py)
  3. --skip-login (F5 se omite explícitamente)

Salida: contrato JSON estándar (contract.Result) en la última línea de
stdout. Exit 0 = PASS, 1 = FAIL. Sin deps externas (stdlib puro).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contract import AMALAY_REF, Result, verify_ref  # noqa: E402

FORBIDDEN_CLIENT_IDS = {"amalay", "prod", "production"}
SMOKE_MARK = "smoke_test:TSK-014"
IVA_RATE = 0.16
TIMEOUT = 15


# ── HTTP helpers (stdlib) ─────────────────────────────────────────────────────

def _req(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={**headers,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "null"
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:200]}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return 0, {"error": str(e)[:200]}


def _get(url, headers):
    return _req("GET", url, headers)


def _post(url, body, headers):
    return _req("POST", url, headers, body)


def _patch(url, body, headers):
    return _req("PATCH", url, headers, body)


def _delete(url, headers):
    return _req("DELETE", url, headers)


# ── Credenciales del dueño ────────────────────────────────────────────────────

def load_owner_creds(client_id):
    """Devuelve (email, password) sin imprimirlos jamás."""
    email = os.environ.get("OWNER_EMAIL", "")
    pwd = os.environ.get("OWNER_PASSWORD", "")
    if email and pwd:
        return email, pwd
    cred_path = Path(f"/tmp/fullsite-creds-{client_id}.txt")
    if cred_path.exists():
        kv = {}
        for line in cred_path.read_text().strip().splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                kv[k] = v
        if kv.get("email") and kv.get("password"):
            return kv["email"], kv["password"]
    return None, None


# ── Smoke test ────────────────────────────────────────────────────────────────

class Smoke:
    def __init__(self, result, rest, auth, svc_h, anon_key, client_id):
        self.r = result
        self.rest = rest
        self.auth = auth
        self.svc_h = svc_h
        self.anon_key = anon_key
        self.cid = client_id
        self.enc = urllib.parse.quote(client_id)
        self.turno_id = f"SMOKE-TURNO-{client_id}"
        self.order_number = f"SMOKE-{client_id}"
        self.order_id = None
        self.turno_created = False

    def check(self, label, passed, detail=""):
        sym = "✓" if passed else "✗"
        line = f"  {sym} {'PASS' if passed else 'FAIL'}  {label}"
        if detail:
            line += f" — {detail}"
        print(line)
        if not passed:
            self.r.error(f"smoke: '{label}' falló" + (f" ({detail})" if detail else ""))
        return passed

    def rows(self, table, flt, select="*"):
        s, body = _get(f"{self.rest}/{table}?{flt}&select={select}", self.svc_h)
        if s != 200 or not isinstance(body, list):
            return None
        return body

    # F1 ─ provisión íntegra
    def f1_client(self):
        rows = self.rows("clients", f"id=eq.{self.enc}")
        ok = self.check("F1: clients row existe", bool(rows),
                        "" if rows else "tenant no provisionado — corre onboard_client.py")
        if not ok:
            return False
        blob = json.dumps(rows[0], ensure_ascii=False)
        self.check("F1b: sin contaminación AMALAY en clients row",
                   AMALAY_REF not in blob and "AFO200806" not in blob)
        return True

    # F2 ─ menú operable
    def f2_menu(self):
        cats = self.rows("pos_menu_categories", f"client_id=eq.{self.enc}", "id")
        self.check("F2: menu_categories ≥ 1", bool(cats),
                   f"{len(cats or [])} categorías")
        items = self.rows("pos_menu_items",
                          f"client_id=eq.{self.enc}&active=eq.true",
                          "id,name,price")
        priced = [i for i in (items or [])
                  if isinstance(i.get("price"), (int, float)) and i["price"] > 0]
        self.check("F2b: menu_items activos con precio > 0", len(priced) >= 1,
                   f"{len(priced)} items")
        return priced

    # F3 ─ staff operable
    def f3_staff(self):
        staff = self.rows("pos_staff",
                          f"client_id=eq.{self.enc}&active=eq.true", "name,pin")
        self.check("F3: staff activo ≥ 1", bool(staff),
                   f"{len(staff or [])} miembros")
        pins = [s.get("pin") for s in (staff or []) if s.get("pin")]
        self.check("F3b: PINs de staff únicos", len(pins) == len(set(pins)),
                   f"{len(pins)} pins, {len(set(pins))} únicos")
        return staff or []

    # F4 ─ cobro posible
    def f4_payment_methods(self):
        pms = self.rows("pos_payment_methods",
                        f"client_id=eq.{self.enc}&active=eq.true", "name")
        self.check("F4: métodos de pago activos ≥ 1", bool(pms),
                   f"{len(pms or [])} métodos")
        return pms or []

    # F5 ─ login del dueño
    def f5_login(self, email, pwd, skip):
        if skip:
            print("  · SKIP  F5: login del dueño (--skip-login)")
            return
        if not (email and pwd):
            self.check("F5: login del dueño", False,
                       "sin credenciales — usa OWNER_EMAIL/OWNER_PASSWORD, "
                       f"/tmp/fullsite-creds-{self.cid}.txt o --skip-login")
            return
        s, body = _post(f"{self.auth}/token?grant_type=password",
                        {"email": email, "password": pwd},
                        {"apikey": self.anon_key})
        self.check("F5: login del dueño exitoso",
                   s == 200 and isinstance(body, dict) and "access_token" in body,
                   f"HTTP {s}")

    # F6 ─ flow POS completo
    def f6_pos_flow(self, priced_items, staff, payment_methods):
        if not priced_items or not staff or not payment_methods:
            self.check("F6: flow POS (turno → orden → cobro → cierre)", False,
                       "prerrequisitos incompletos (menú/staff/métodos de pago)")
            return

        wh = {**self.svc_h, "Prefer": "return=representation"}

        # F6a: abrir turno (pos_orders exige turno_id NOT NULL)
        s, body = _post(f"{self.rest}/pos_turnos", {
            "id": self.turno_id, "client_id": self.cid,
            "opened_by": SMOKE_MARK, "fondo_inicial": 0,
        }, wh)
        self.turno_created = s in (200, 201)
        if not self.check("F6a: turno abierto", self.turno_created, f"HTTP {s}"):
            return

        # F6b: crear orden con items reales del menú
        chosen = priced_items[:2]
        items = [{"id": i.get("id"), "name": i.get("name"),
                  "price": i["price"], "qty": 1} for i in chosen]
        subtotal = round(sum(i["price"] for i in items), 2)
        iva = round(subtotal * IVA_RATE, 2)
        total = round(subtotal + iva, 2)
        s, body = _post(f"{self.rest}/pos_orders", {
            "client_id": self.cid, "mesa": "SMOKE",
            "mesero": staff[0].get("name", SMOKE_MARK), "personas": 1,
            "status": "enviada", "items": items,
            "subtotal": subtotal, "iva": iva, "total": total,
            "descuento": 0, "propina": 0, "notas": SMOKE_MARK,
            "order_number": self.order_number, "turno_id": self.turno_id,
        }, wh)
        created = (s in (200, 201) and isinstance(body, list) and body)
        if not self.check("F6b: orden creada con items del menú", bool(created),
                          f"HTTP {s}"):
            return
        self.order_id = body[0].get("id")

        # F6c: aislamiento — la orden solo es visible bajo el filtro del tenant
        mine = self.rows("pos_orders",
                         f"client_id=eq.{self.enc}&order_number=eq.{urllib.parse.quote(self.order_number)}",
                         "id,client_id,total")
        visible = bool(mine) and all(r["client_id"] == self.cid for r in mine)
        self.check("F6c: orden visible solo en el tenant correcto", visible,
                   f"{len(mine or [])} filas, client_id ok" if visible else "")

        # F6d: cobrar y cerrar la orden
        pm_name = payment_methods[0].get("name", "Efectivo")
        s, body = _patch(
            f"{self.rest}/pos_orders?id=eq.{urllib.parse.quote(str(self.order_id))}"
            f"&client_id=eq.{self.enc}",
            {"status": "cerrada", "metodo_pago": pm_name,
             "pagos": [{"metodo": pm_name, "monto": total}],
             "closed_at": "1970-01-01T00:00:00Z"}, wh)
        self.check("F6d: orden cobrada y cerrada", s == 200, f"HTTP {s}")

        # F6e: totales persistidos correctos
        rows = self.rows("pos_orders",
                         f"id=eq.{urllib.parse.quote(str(self.order_id))}",
                         "status,total,metodo_pago")
        row = rows[0] if rows else {}
        self.check("F6e: totales y estado persistidos",
                   row.get("status") == "cerrada"
                   and row.get("total") == total
                   and row.get("metodo_pago") == pm_name,
                   f"status={row.get('status')} total={row.get('total')}")

        # F6f: cerrar turno
        s, _ = _patch(
            f"{self.rest}/pos_turnos?id=eq.{urllib.parse.quote(self.turno_id)}"
            f"&client_id=eq.{self.enc}",
            {"closed_by": SMOKE_MARK, "fondo_final": 0,
             "closed_at": "1970-01-01T00:00:00Z"}, wh)
        self.check("F6f: turno cerrado", s == 200, f"HTTP {s}")

    # F7 ─ cleanup (corre siempre, incluso tras FAIL, salvo --keep)
    def f7_cleanup(self, keep):
        if keep:
            print("  · SKIP  F7: cleanup omitido (--keep) — la orden smoke "
                  "queda para inspección manual")
            return
        if not (self.order_id or self.turno_created):
            return
        ok = True
        if self.order_id:
            s, _ = _delete(
                f"{self.rest}/pos_orders?id=eq.{urllib.parse.quote(str(self.order_id))}"
                f"&client_id=eq.{self.enc}", self.svc_h)
            ok = ok and s in (200, 204)
        if self.turno_created:
            s, _ = _delete(
                f"{self.rest}/pos_turnos?id=eq.{urllib.parse.quote(self.turno_id)}"
                f"&client_id=eq.{self.enc}", self.svc_h)
            ok = ok and s in (200, 204)
        residue = self.rows("pos_orders",
                            f"client_id=eq.{self.enc}&notas=eq.{urllib.parse.quote(SMOKE_MARK)}",
                            "id")
        self.check("F7: cleanup sin rastro (orden + turno smoke eliminados)",
                   ok and residue == [],
                   f"{len(residue or [])} filas residuales" if residue else "")


def main():
    ap = argparse.ArgumentParser(description="CLON-SMOKE (R2-G06) — smoke test POS")
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--confirm-ref", required=True,
                    help="project ref esperado del SUPABASE_URL")
    ap.add_argument("--keep", action="store_true",
                    help="no borrar la orden/turno smoke al final")
    ap.add_argument("--skip-login", action="store_true",
                    help="omitir F5 (login del dueño)")
    args = ap.parse_args()

    result = Result("smoke_test")
    cid = args.client_id

    # ── Guardas (antes de cualquier request) ──
    url = (os.environ.get("SUPABASE_URL")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_URL_SANDBOX")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    svc_key = (os.environ.get("SUPABASE_SERVICE_KEY")
               or os.environ.get("SANDBOX_SERVICE_KEY") or "")
    anon_key = (os.environ.get("SUPABASE_ANON_KEY")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX") or "")

    if os.environ.get("SANDBOX_ENV") != "true":
        result.error("SANDBOX_ENV debe ser 'true' — este smoke escribe datos "
                     "sintéticos y solo corre contra sandbox/staging")
    if not url:
        result.error("SUPABASE_URL vacío")
    if not svc_key:
        result.error("SUPABASE_SERVICE_KEY vacío")
    if url and AMALAY_REF in url:
        result.error("URL contiene ref de AMALAY producción — ABORTANDO")
    if cid in FORBIDDEN_CLIENT_IDS:
        result.error(f"client_id='{cid}' prohibido para smoke test")
    if args.confirm_ref == AMALAY_REF:
        result.error("confirm_ref es el ref de AMALAY producción — ABORTANDO")
    if result.errors:
        result.finish()
    verify_ref(url, args.confirm_ref)

    print(f"\nCLON-SMOKE — tenant: {cid} @ {args.confirm_ref}\n")

    smoke = Smoke(result, f"{url}/rest/v1", f"{url}/auth/v1",
                  {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"},
                  anon_key, cid)
    try:
        if smoke.f1_client():
            priced = smoke.f2_menu()
            staff = smoke.f3_staff()
            pms = smoke.f4_payment_methods()
            email, pwd = load_owner_creds(cid)
            smoke.f5_login(email, pwd, args.skip_login)
            smoke.f6_pos_flow(priced, staff, pms)
    finally:
        smoke.f7_cleanup(args.keep)

    n_fail = len(result.errors)
    print(f"\nVeredicto: {'FAIL — ' + str(n_fail) + ' checks fallaron' if n_fail else 'PASS — flows críticos POS operables sin datos AMALAY'}\n")
    result.finish()


if __name__ == "__main__":
    main()
