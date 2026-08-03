#!/usr/bin/env python3
"""
vercel_provision.py — Crea proyecto Vercel y configura env vars para un nuevo cliente.

Qué hace:
    1. Valida que SUPABASE_URL no sea el proyecto AMALAY (previene contaminación de prod).
    2. Crea el proyecto en Vercel (si no existe ya).
    3. Vincula el repo de GitHub al proyecto.
    4. Configura todas las env vars (SUPABASE_URL, SUPABASE_ANON_KEY, CLIENT_SLUG, etc.).
    5. Reporta la URL de preview del deployment inicial.

Flags:
    --client-id       <slug>        slug del cliente (ej. grupo-galeria-dunkin)
    --project-name    <name>        nombre del proyecto en Vercel (ej. fullsite-dunkin)
    --confirm-ref     <ref>         project ref de Supabase del cliente
    --github-repo     <owner/repo>  repositorio a vincular (ej. ramonfaurdaniel-png/fullsite)
    --framework       <name>        framework hint para Vercel (default: nextjs)
    --root-dir        <path>        root directory del proyecto (default: dashboard-app)
    --dry-run                       muestra qué haría sin crear nada

Env vars requeridas:
    VERCEL_TOKEN          — token de Vercel con scope de equipo
    VERCEL_TEAM_ID        — team ID del equipo en Vercel (ej. team_xxxx)
    SUPABASE_URL          — URL del Supabase del cliente nuevo
    SUPABASE_ANON_KEY     — anon key del Supabase del cliente nuevo
    SUPABASE_SERVICE_KEY  — service role key (se guarda como Production-only)

Uso:
    python3 scripts/onboarding/vercel_provision.py \
        --client-id grupo-galeria-dunkin \
        --project-name fullsite-dunkin \
        --confirm-ref abcdefghijkl \
        --github-repo ramonfaurdaniel-png/fullsite \
        --dry-run
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from contract import Result, verify_ref

AMALAY_REF = "qjiomlvudfmzuvqvhwpk"
VERCEL_API = "https://api.vercel.com"


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def redact(token: str) -> str:
    return token[:8] + "***REDACTED***" if len(token) > 8 else "***REDACTED***"


def vc_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def vc_request(method: str, path: str, token: str, team_id: str,
               body: dict | None = None) -> dict:
    sep = "&" if "?" in path else "?"
    url = VERCEL_API + path + sep + f"teamId={team_id}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=vc_headers(token), method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"Vercel API {method} {path} → HTTP {e.code}: {body_text}") from e


def vc_get(path: str, token: str, team_id: str) -> dict:
    return vc_request("GET", path, token, team_id)


def vc_post(path: str, token: str, team_id: str, body: dict) -> dict:
    return vc_request("POST", path, token, team_id, body)


def vc_patch(path: str, token: str, team_id: str, body: dict) -> dict:
    return vc_request("PATCH", path, token, team_id, body)


# ── Vercel operations ─────────────────────────────────────────────────────────

def find_project(name: str, token: str, team_id: str) -> dict | None:
    try:
        return vc_get(f"/v9/projects/{urllib.parse.quote(name)}", token, team_id)
    except RuntimeError as e:
        if "HTTP 404" in str(e):
            return None
        raise


def create_project(name: str, framework: str, root_dir: str,
                   github_repo: str, token: str, team_id: str) -> dict:
    owner, repo = github_repo.split("/", 1)
    body: dict = {
        "name": name,
        "framework": framework,
        "rootDirectory": root_dir,
        "gitRepository": {
            "type": "github",
            "repo": f"{owner}/{repo}",
        },
        "buildCommand": None,          # inherit from framework
        "outputDirectory": None,
        "installCommand": None,
    }
    return vc_post("/v10/projects", token, team_id, body)


def set_env_var(project_name: str, key: str, value: str,
                target: list[str], token: str, team_id: str) -> None:
    body = {
        "key": key,
        "value": value,
        "type": "encrypted",
        "target": target,
    }
    vc_post(f"/v10/projects/{urllib.parse.quote(project_name)}/env",
            token, team_id, body)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Provisiona proyecto Vercel para nuevo cliente.")
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--confirm-ref", required=True)
    parser.add_argument("--github-repo", required=True)
    parser.add_argument("--framework", default="nextjs")
    parser.add_argument("--root-dir", default="dashboard-app")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("VERCEL_TOKEN", "")
    team_id = os.environ.get("VERCEL_TEAM_ID", "")
    supabase_url = os.environ.get("SUPABASE_URL", "")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "")

    missing = [k for k, v in {
        "VERCEL_TOKEN": token, "VERCEL_TEAM_ID": team_id,
        "SUPABASE_URL": supabase_url, "SUPABASE_ANON_KEY": anon_key,
        "SUPABASE_SERVICE_KEY": service_key,
    }.items() if not v]
    if missing:
        print(f"  ✗ Variables de entorno faltantes: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    # Safety check: never provision Vercel project pointing to AMALAY prod
    verify_ref(supabase_url, args.confirm_ref)
    if args.confirm_ref == AMALAY_REF:
        print(
            f"  ✗ BLOQUEADO: --confirm-ref apunta al proyecto AMALAY ({AMALAY_REF}).\n"
            f"     Nunca provisionar un proyecto Vercel apuntando a la BD de producción de AMALAY.",
            file=sys.stderr,
        )
        sys.exit(1)

    result = Result("vercel_provision")

    if args.dry_run:
        print(f"\n  [DRY-RUN] Acciones que se ejecutarían:")
        print(f"    1. Crear proyecto Vercel: {args.project_name}")
        print(f"       Framework: {args.framework}  |  Root dir: {args.root_dir}")
        print(f"       GitHub: {args.github_repo}")
        print(f"    2. Configurar env vars (Production + Preview):")
        print(f"       SUPABASE_URL        = {supabase_url}")
        print(f"       SUPABASE_ANON_KEY   = {redact(anon_key)}")
        print(f"       SUPABASE_SERVICE_KEY= {redact(service_key)}  [Production only]")
        print(f"       NEXT_PUBLIC_CLIENT_SLUG = {args.client_id}")
        result.finish(exit_on_fail=False)
        return

    # ── Check / create project ────────────────────────────────────────────
    print(f"  Verificando proyecto '{args.project_name}' en Vercel…")
    project = find_project(args.project_name, token, team_id)
    if project:
        print(f"  Proyecto ya existe (id={project['id']}) — continuando.")
        result.add_updated()
    else:
        print(f"  Creando proyecto…")
        project = create_project(
            args.project_name, args.framework, args.root_dir,
            args.github_repo, token, team_id,
        )
        result.add_created()
        print(f"  Proyecto creado: id={project['id']}")

    project_id = project["id"]
    prod_preview = ["production", "preview"]

    # ── Env vars ──────────────────────────────────────────────────────────
    env_pairs = [
        ("SUPABASE_URL",            supabase_url,    prod_preview),
        ("NEXT_PUBLIC_SUPABASE_URL", supabase_url,   prod_preview),
        ("SUPABASE_ANON_KEY",       anon_key,        prod_preview),
        ("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon_key,  prod_preview),
        ("SUPABASE_SERVICE_KEY",    service_key,     ["production"]),   # never in preview
        ("NEXT_PUBLIC_CLIENT_SLUG", args.client_id,  prod_preview),
        ("CLIENT_SLUG",             args.client_id,  prod_preview),
    ]

    print(f"  Configurando {len(env_pairs)} env vars…")
    for key_name, value, targets in env_pairs:
        try:
            set_env_var(args.project_name, key_name, value, targets, token, team_id)
            targets_label = "+".join(targets)
            print(f"    {key_name:40s} [{targets_label}]")
        except RuntimeError as e:
            if "already exists" in str(e).lower():
                result.warn(f"{key_name} ya existía (no sobreescrito)")
            else:
                result.error(str(e))

    # ── Report ────────────────────────────────────────────────────────────
    dashboard_url = f"https://vercel.com/{team_id}/{args.project_name}"
    print(f"\n  Dashboard Vercel: {dashboard_url}")
    print(f"  Siguiente paso: trigger un deployment manual o push a main.")
    print(f"  Luego: python3 scripts/onboarding/dns_provision.py --project {args.project_name} …")

    result.finish()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Interrumpido.", file=sys.stderr)
        sys.exit(130)
