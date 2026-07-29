#!/usr/bin/env bash
# SKEL-02 — sandbox/second-customer-skeleton
# Carga .env.sandbox.local, valida credenciales sandbox, arranca Next.js
# apuntando a fullsite-sandbox en puerto 3001.
#
# Falla explícitamente si:
#   - Falta .env.sandbox.local
#   - SANDBOX_ENV != true
#   - Alguna credencial sandbox está vacía
#   - La URL sandbox apunta al proyecto de producción AMALAY
#   - SANDBOX_SERVICE_KEY == NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX
#
# NUNCA hace fallback a variables de AMALAY ni service key → anon key.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$APP_DIR/.env.sandbox.local"
AMALAY_PROJECT_REF="qjiomlvudfmzuvqvhwpk"

# ── 1. Validar que existe .env.sandbox.local ──────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "" >&2
  echo "ERROR: .env.sandbox.local no encontrado en:" >&2
  echo "  $ENV_FILE" >&2
  echo "" >&2
  echo "Crear el archivo con:" >&2
  echo "  NEXT_PUBLIC_SUPABASE_URL_SANDBOX=https://<ref>.supabase.co" >&2
  echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX=<anon-key>" >&2
  echo "  SANDBOX_SERVICE_KEY=<service-role-key>" >&2
  echo "  SANDBOX_ENV=true" >&2
  echo "" >&2
  exit 1
fi

# ── 2. Cargar .env.sandbox.local (solo este archivo, sin .env.local) ──────────
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# ── 3. Validar SANDBOX_ENV=true ───────────────────────────────────────────────
if [[ "${SANDBOX_ENV:-}" != "true" ]]; then
  echo "ERROR: SANDBOX_ENV debe ser 'true' en .env.sandbox.local" >&2
  echo "  Valor actual: '${SANDBOX_ENV:-<vacío>}'" >&2
  exit 1
fi

# ── 4. Validar credenciales sandbox (falla explícita, sin fallback) ───────────
REQUIRED_SANDBOX_VARS=(
  "NEXT_PUBLIC_SUPABASE_URL_SANDBOX"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX"
  "SANDBOX_SERVICE_KEY"
)

for var in "${REQUIRED_SANDBOX_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var está vacío o ausente en .env.sandbox.local" >&2
    echo "  Agregar la variable y reintentar." >&2
    exit 1
  fi
done

# ── 5. Rechazar URL de producción AMALAY ─────────────────────────────────────
if [[ "${NEXT_PUBLIC_SUPABASE_URL_SANDBOX}" == *"${AMALAY_PROJECT_REF}"* ]]; then
  echo "ERROR: NEXT_PUBLIC_SUPABASE_URL_SANDBOX apunta al proyecto de producción AMALAY." >&2
  echo "  El sandbox requiere un proyecto Supabase independiente." >&2
  echo "  Proyecto de producción (prohibido): ${AMALAY_PROJECT_REF}" >&2
  exit 1
fi

# ── 6. Rechazar service key == anon key (sin fallback service → anon) ─────────
if [[ "${SANDBOX_SERVICE_KEY}" == "${NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX}" ]]; then
  echo "ERROR: SANDBOX_SERVICE_KEY y NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX son idénticos." >&2
  echo "  La service role key es distinta a la anon key." >&2
  echo "  Obtener la service role key en: Supabase Dashboard → Settings → API → service_role" >&2
  exit 1
fi

# ── 7. Remap a nombres estándar de Next.js ────────────────────────────────────
# Shell env tiene prioridad sobre .env.local — el remap gana aunque exista
# un .env.local con variables de AMALAY en el mismo directorio.
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL_SANDBOX}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX}"
export SUPABASE_SERVICE_KEY="${SANDBOX_SERVICE_KEY}"
export SUPABASE_SERVICE_ROLE_KEY="${SANDBOX_SERVICE_KEY}"

# Limpieza defensiva: eliminar las variables _SANDBOX para que el código de app
# no pueda leer credenciales de producción si accidentalmente las confunde.
unset NEXT_PUBLIC_SUPABASE_URL_SANDBOX
unset NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX
unset SANDBOX_SERVICE_KEY

# ── 8. Confirmar startup ──────────────────────────────────────────────────────
echo ""
echo "==================================================================="
echo " sandbox/second-customer-skeleton — VANTARA dev server"
echo "==================================================================="
echo " Proyecto:    ${NEXT_PUBLIC_SUPABASE_URL}"
echo " SANDBOX_ENV: ${SANDBOX_ENV}"
echo " Puerto:      3001  (AMALAY corre en 3000 — sin colisión)"
echo "==================================================================="
echo ""

# ── 9. Iniciar Next.js usando binario local (no global) ───────────────────────
cd "$APP_DIR"
exec node_modules/.bin/next dev --port 3001
