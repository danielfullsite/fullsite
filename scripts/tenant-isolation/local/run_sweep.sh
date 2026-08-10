#!/usr/bin/env bash
# BUG-019 · Barrido de esquema COMPLETO — postgres efímero, offline, reversible.
# Genera stubs de las ~74 tablas con client_id del esquema REAL (010/011), aplica
# la MIGRACIÓN REAL y verifica estructuralmente que TODAS quedaron aisladas.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$REPO/docs/release/BUG-019-tenant-rls-fix.sql"
PGDATA="$(mktemp -d)/pgdata"; SOCK="$(mktemp -d)"; PORT=54330; LOG="$(mktemp)"; STUB="$(mktemp).sql"
cleanup() { pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1; rm -rf "$PGDATA" "$SOCK" "$LOG" "$STUB"; }
trap cleanup EXIT

initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1 || { echo "initdb FAIL"; exit 2; }
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$LOG" -w start >/dev/null 2>&1 || { echo "start FAIL"; cat "$LOG"; exit 2; }
PSQL="psql -X -v ON_ERROR_STOP=1 -h $SOCK -p $PORT -U postgres -d postgres"

echo "== roles + auth shim =="
$PSQL >/dev/null 2>&1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $f$;
SQL

echo "== generar + cargar stubs del esquema real =="
python3 "$HERE/gen_schema_stub.py" > "$STUB" || { echo "gen FAIL"; exit 2; }
EXPECTED=$(grep -oE "SWEEP_EXPECTED_COUNT=[0-9]+" "$STUB" | cut -d= -f2)
$PSQL -f "$STUB" >/dev/null || { echo "stub load FAIL"; exit 2; }

echo "== private + user_has_client_access (client_users ya existe) =="
$PSQL >/dev/null <<'SQL'
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.user_has_client_access(target_client_id text)
returns boolean language sql stable security definer set search_path=public, private as $f$
  select case when auth.uid() is null then false when target_client_id is null then false
              when target_client_id='' then false
              else exists (select 1 from public.client_users cu where cu.user_id=auth.uid() and cu.client_id=target_client_id) end;
$f$;
revoke all on function private.user_has_client_access(text) from public, anon;
grant execute on function private.user_has_client_access(text) to authenticated;
alter role service_role bypassrls;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
SQL

echo "== aplica MIGRACIÓN REAL =="
$PSQL -f "$MIGRATION" >/dev/null 2>&1 || { echo "MIGRACIÓN FAIL"; exit 1; }

echo "== barrido estructural sobre $EXPECTED tablas con client_id =="
OUT="$($PSQL -f "$HERE/20_sweep_assert.sql" 2>&1)"
echo "$OUT"
# fully_isolated = último número de la fila SWEEP-SUMMARY
FULLY=$(echo "$OUT" | awk -F'|' '/SWEEP-SUMMARY/{gsub(/ /,"",$NF); print $NF}')
echo "----------------------------------------"
# La query de fallas devuelve 0 filas si todo OK ("(0 filas)")
FAILROWS=$(echo "$OUT" | grep -cE "^ pos_|^ agent_|^ wansoft_|^ ops_|^ chat_")
if [ "$FAILROWS" = "0" ] && [ "$FULLY" = "$EXPECTED" ]; then
  echo "RESULTADO: BARRIDO OK — $FULLY/$EXPECTED tablas con client_id totalmente aisladas por la migración"
  exit 0
else
  echo "RESULTADO: GAPS — tablas no aisladas (ver filas arriba); fully=$FULLY expected=$EXPECTED"
  exit 1
fi
