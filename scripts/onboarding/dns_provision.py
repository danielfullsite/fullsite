#!/usr/bin/env python3
"""
dns_provision.py — Crea registro DNS en Cloudflare y vincula dominio al proyecto Vercel.

Qué hace:
    1. Crea un CNAME en Cloudflare: <subdomain>.<zone> → cname.vercel-dns.com
    2. Agrega el dominio al proyecto Vercel vía la API.
    3. Con --verify: espera hasta que Vercel reporte el dominio como válido.

Flags:
    --project     <name>        nombre del proyecto en Vercel
    --subdomain   <sub>         subdominio a crear (ej. dunkin → dunkin.app.fullsite.mx)
    --zone-id     <id>          Cloudflare Zone ID (o env CF_ZONE_ID)
    --verify                    espera a que el dominio sea válido (max 3 min)
    --dry-run                   muestra qué haría sin crear nada

Env vars requeridas:
    CF_API_TOKEN   — Cloudflare API token con permiso Zone:DNS:Edit
    CF_ZONE_ID     — Cloudflare Zone ID (override de --zone-id)
    VERCEL_TOKEN   — token de Vercel
    VERCEL_TEAM_ID — team ID del equipo en Vercel

Uso:
    python3 scripts/onboarding/dns_provision.py \
        --project fullsite-dunkin \
        --subdomain dunkin \
        --zone-id abc123 \
        --verify

    # FQDN resultante: dunkin.app.fullsite.mx
    # CNAME target:    cname.vercel-dns.com
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

sys.path.insert(0, str(Path(__file__).parent))
from contract import Result

VERCEL_API = "https://api.vercel.com"
CF_API = "https://api.cloudflare.com/client/v4"
CNAME_TARGET = "cname.vercel-dns.com"
BASE_DOMAIN = "app.fullsite.mx"
VERIFY_TIMEOUT_S = 180
VERIFY_POLL_S = 10


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def redact(token: str) -> str:
    return token[:8] + "***REDACTED***" if len(token) > 8 else "***REDACTED***"


def _json_request(method: str, url: str, headers: dict,
                  body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {url} → HTTP {e.code}: {body_text}") from e


# ── Cloudflare helpers ────────────────────────────────────────────────────────

def cf_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def cf_list_dns(zone_id: str, token: str, name: str) -> list:
    url = f"{CF_API}/zones/{zone_id}/dns_records?name={urllib.parse.quote(name)}&type=CNAME"
    resp = _json_request("GET", url, cf_headers(token))
    return resp.get("result", [])


def cf_create_cname(zone_id: str, token: str, name: str, content: str) -> dict:
    url = f"{CF_API}/zones/{zone_id}/dns_records"
    body = {"type": "CNAME", "name": name, "content": content,
            "ttl": 1, "proxied": False}
    resp = _json_request("POST", url, cf_headers(token), body)
    return resp.get("result", {})


# ── Vercel helpers ────────────────────────────────────────────────────────────

def vc_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def vc_add_domain(project: str, domain: str, token: str, team_id: str) -> dict:
    url = (f"{VERCEL_API}/v10/projects/{urllib.parse.quote(project)}/domains"
           f"?teamId={team_id}")
    return _json_request("POST", url, vc_headers(token), {"name": domain})


def vc_get_domain(project: str, domain: str, token: str, team_id: str) -> dict:
    url = (f"{VERCEL_API}/v10/projects/{urllib.parse.quote(project)}"
           f"/domains/{urllib.parse.quote(domain)}?teamId={team_id}")
    return _json_request("GET", url, vc_headers(token))


# ── Verify loop ───────────────────────────────────────────────────────────────

def wait_for_domain(project: str, domain: str, token: str, team_id: str,
                    result: Result) -> bool:
    print(f"  Esperando propagación DNS (max {VERIFY_TIMEOUT_S}s)…")
    deadline = time.time() + VERIFY_TIMEOUT_S
    while time.time() < deadline:
        try:
            info = vc_get_domain(project, domain, token, team_id)
            verified = info.get("verified", False)
            config_valid = (info.get("verification") or []) == []
            if verified and config_valid:
                print(f"  ✓ Dominio verificado: {domain}")
                return True
            remaining = int(deadline - time.time())
            print(f"    aún pendiente… ({remaining}s restantes)")
        except RuntimeError as e:
            result.warn(f"Error al verificar: {e}")
        time.sleep(VERIFY_POLL_S)
    result.warn(
        f"Timeout: dominio no verificado en {VERIFY_TIMEOUT_S}s. "
        "Revisa en el dashboard de Vercel o vuelve a correr con --verify más tarde."
    )
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Provisiona DNS Cloudflare + dominio Vercel.")
    parser.add_argument("--project", required=True)
    parser.add_argument("--subdomain", required=True)
    parser.add_argument("--zone-id", default="")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cf_token = os.environ.get("CF_API_TOKEN", "")
    zone_id = os.environ.get("CF_ZONE_ID", "") or args.zone_id
    vc_token = os.environ.get("VERCEL_TOKEN", "")
    team_id = os.environ.get("VERCEL_TEAM_ID", "")

    missing = [k for k, v in {
        "CF_API_TOKEN": cf_token, "CF_ZONE_ID / --zone-id": zone_id,
        "VERCEL_TOKEN": vc_token, "VERCEL_TEAM_ID": team_id,
    }.items() if not v]
    if missing:
        print(f"  ✗ Faltantes: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    fqdn = f"{args.subdomain}.{BASE_DOMAIN}"
    result = Result("dns_provision")

    if args.dry_run:
        print(f"\n  [DRY-RUN] Acciones que se ejecutarían:")
        print(f"    1. Cloudflare: CNAME {fqdn} → {CNAME_TARGET}")
        print(f"    2. Vercel: agregar dominio '{fqdn}' al proyecto '{args.project}'")
        if args.verify:
            print(f"    3. Esperar verificación DNS (max {VERIFY_TIMEOUT_S}s)")
        result.finish(exit_on_fail=False)
        return

    # ── Cloudflare CNAME ──────────────────────────────────────────────────
    print(f"  Verificando DNS existente para '{fqdn}'…")
    existing = cf_list_dns(zone_id, cf_token, fqdn)
    if existing:
        existing_target = existing[0].get("content", "")
        if existing_target == CNAME_TARGET:
            print(f"  CNAME ya existe y apunta a {CNAME_TARGET} — OK.")
            result.add_updated()
        else:
            result.warn(
                f"CNAME existe pero apunta a '{existing_target}' en vez de '{CNAME_TARGET}'. "
                "Actualiza manualmente en Cloudflare si es incorrecto."
            )
    else:
        print(f"  Creando CNAME: {fqdn} → {CNAME_TARGET}")
        cf_create_cname(zone_id, cf_token, fqdn, CNAME_TARGET)
        result.add_created()
        print(f"  CNAME creado.")

    # ── Vercel domain ─────────────────────────────────────────────────────
    print(f"  Agregando dominio '{fqdn}' al proyecto '{args.project}' en Vercel…")
    try:
        vc_add_domain(args.project, fqdn, vc_token, team_id)
        print(f"  Dominio agregado.")
        result.add_created()
    except RuntimeError as e:
        if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
            print(f"  Dominio ya estaba vinculado al proyecto.")
            result.add_updated()
        else:
            result.error(str(e))

    if result.errors:
        result.finish()
        return

    # ── Optional verify ───────────────────────────────────────────────────
    if args.verify:
        wait_for_domain(args.project, fqdn, vc_token, team_id, result)

    print(f"\n  URL del cliente: https://{fqdn}")
    print(f"  Dashboard Vercel: https://vercel.com/dashboard")
    result.finish()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Interrumpido.", file=sys.stderr)
        sys.exit(130)
