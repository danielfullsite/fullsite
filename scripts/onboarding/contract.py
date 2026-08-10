"""
contract.py — Contrato estándar de salida para scripts de onboarding.

Todos los scripts de scripts/onboarding/ terminan con result.finish(),
que imprime este JSON a stdout para que onboard_client.py (u otro
orquestador) pueda consumirlo sin interpretar texto libre:

    {
      "step": "menu_import",
      "status": "PASS",          # PASS | FAIL | WARN
      "duration_ms": 8421,
      "created": 152,
      "updated": 8,
      "warnings": [],
      "errors": []
    }

Exit codes:
    0 = PASS (o WARN sin errores)
    1 = FAIL
    2 = EXIT_WARN (warnings presentes, sin errores)

Confirm-ref helper:
    verify_ref(url, confirm_ref) — aborta si el URL no corresponde
    al project ref declarado. Previene ejecutar sobre el proyecto
    equivocado.
"""
import json
import os
import re
import sys
import time

AMALAY_REF = "qjiomlvudfmzuvqvhwpk"
_REF_PAT = re.compile(r'https://([^.]+)\.supabase\.co')


def resolve_db_headers() -> tuple[dict[str, str], str]:
    """Resolve a server operator or a real authenticated-user DB session.

    Service role remains the unattended onboarding mode. Interactive imports
    may instead use a short-lived GoTrue access token plus the public anon key;
    PostgREST then enforces the caller's tenant RLS. No anon-only fallback is
    allowed.
    """
    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if service_key:
        return {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }, "service_role"

    anon_key = (
        os.environ.get("SUPABASE_ANON_KEY", "")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    ).strip()
    access_token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if anon_key and access_token:
        return {
            "apikey": anon_key,
            "Authorization": f"Bearer {access_token}",
        }, "authenticated_rls"

    raise RuntimeError(
        "SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY + SUPABASE_ACCESS_TOKEN is required"
    )


def verify_ref(url: str, confirm_ref: str) -> str:
    """
    Extrae el project ref del URL de Supabase y lo compara con confirm_ref.
    Si no coinciden, imprime el error y termina el proceso.
    Devuelve el project ref si es válido.
    """
    m = _REF_PAT.search(url)
    if not m:
        print(f"  ✗ URL no tiene formato esperado: {url}", file=sys.stderr)
        sys.exit(1)
    project_ref = m.group(1)
    if confirm_ref != project_ref:
        print(
            f"  ✗ --confirm-ref '{confirm_ref}' != project ref '{project_ref}'\n"
            f"     Re-run con --confirm-ref {project_ref}",
            file=sys.stderr,
        )
        sys.exit(1)
    return project_ref


class Result:
    """
    Acumula contadores y mensajes durante la ejecución de un script.
    Llama result.finish() al final para emitir el JSON de contrato.
    """

    def __init__(self, step: str):
        self.step     = step
        self.status   = "PASS"
        self._t0      = time.time()
        self.created  = 0
        self.updated  = 0
        self.warnings: list[str] = []
        self.errors:   list[str] = []

    # ── Logging ──────────────────────────────────────────────────────────────

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        print(f"  ~ [WARN          ] {msg}", file=sys.stderr)

    def error(self, msg: str) -> None:
        self.errors.append(msg)
        self.status = "FAIL"
        print(f"  ✗ [ERROR         ] {msg}", file=sys.stderr)

    def add_created(self, n: int = 1) -> None:
        self.created += n

    def add_updated(self, n: int = 1) -> None:
        self.updated += n

    # ── Finish ───────────────────────────────────────────────────────────────

    def finish(self, *, print_json: bool = True, exit_on_fail: bool = True) -> dict:
        """
        Calcula status final, emite JSON a stdout, y termina el proceso.

        El JSON va a stdout para que un orquestador pueda hacer:
            output = subprocess.check_output([...])
            result = json.loads(output.splitlines()[-1])

        El resto del output (print normales) va a stderr o queda
        intercalado — el orquestador debe leer solo la última línea JSON.
        """
        if self.errors:
            self.status = "FAIL"
        elif self.warnings and self.status == "PASS":
            self.status = "WARN"

        payload = {
            "step":        self.step,
            "status":      self.status,
            "duration_ms": int((time.time() - self._t0) * 1000),
            "created":     self.created,
            "updated":     self.updated,
            "warnings":    self.warnings,
            "errors":      self.errors,
        }

        if print_json:
            print(json.dumps(payload, ensure_ascii=False))

        if exit_on_fail and self.status == "FAIL":
            sys.exit(1)
        if self.status == "WARN":
            sys.exit(2)

        return payload
