#!/usr/bin/env bash
# BUG-019 · Full-stack LOCAL isolation cert — ephemeral postgres, offline, reversible.
# initdb -> start -> bootstrap -> APLICA LA MIGRACIÓN REAL (docs/release/BUG-019-tenant-rls-fix.sql)
# -> assertions bajo authenticated A/B, anon, service_role -> teardown.
# No toca prod, no red, no credenciales. Exit 0 = todas las aserciones PASS.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$REPO/docs/release/BUG-019-tenant-rls-fix.sql"
PGDATA="$(mktemp -d)/pgdata"
SOCK="$(mktemp -d)"
PORT=54329
LOG="$(mktemp)"

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$PGDATA" "$SOCK" "$LOG"
}
trap cleanup EXIT

echo "== initdb (efímero) =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1 || { echo "initdb FAIL"; exit 2; }
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$LOG" -w start >/dev/null 2>&1 || { echo "pg_ctl start FAIL"; cat "$LOG"; exit 2; }
PSQL="psql -X -v ON_ERROR_STOP=1 -h $SOCK -p $PORT -U postgres -d postgres"

echo "== bootstrap (roles Supabase + auth + private + esquema + seed) =="
$PSQL -f "$HERE/00_bootstrap.sql" >/dev/null || { echo "bootstrap FAIL"; exit 2; }

echo "== aplica migración REAL: $(basename "$MIGRATION") =="
$PSQL -f "$MIGRATION" >/dev/null || { echo "MIGRACIÓN FAIL (revisar deps)"; exit 1; }

echo "== assertions =="
OUT="$($PSQL -f "$HERE/10_assertions.sql" 2>&1)"
echo "$OUT"

# Veredicto: ningún pass = f, ningún DO-FAIL, y CERO errores SQL inesperados.
FAILS=$(echo "$OUT" | grep -E "\| f$" | wc -l | tr -d ' ')
DOFAILS=$(echo "$OUT" | grep -c "FAIL")
# ERROR: esperados son solo los capturados por los DO (que imprimen 'PASS'); un
# ERROR: a nivel psql (no capturado) indica fallo real de aserción.
ERRS=$(echo "$OUT" | grep -c "ERROR:")
echo "----------------------------------------"
if [ "$FAILS" = "0" ] && [ "$DOFAILS" = "0" ] && [ "$ERRS" = "0" ]; then
  echo "RESULTADO: TODAS LAS ASERCIONES PASARON (aislamiento OK con la migración real)"
  exit 0
else
  echo "RESULTADO: FALLOS — pass=f:$FAILS, DO-FAIL:$DOFAILS, ERROR:$ERRS"
  exit 1
fi
