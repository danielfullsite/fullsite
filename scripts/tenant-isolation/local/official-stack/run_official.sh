#!/usr/bin/env bash
# BUG-019 · Suite full-stack sobre el STACK LOCAL OFICIAL de Supabase.
# Auth/JWT/PostgREST reales + 2 tenants. Reversible, local, sin secretos hardcodeados
# (las llaves son las del stack local efímero, obtenidas de `supabase status`).
#
# Uso:
#   1) En un proyecto supabase con puertos libres:  npx supabase start
#   2) SUPABASE_DIR=<ese proyecto> bash run_official.sh
# Requiere: psql en PATH, node ≥18, un `supabase` CLI (npx supabase).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
MIGRATION="$REPO/docs/release/BUG-019-tenant-rls-fix.sql"
SUPABASE_DIR="${SUPABASE_DIR:?exporta SUPABASE_DIR=<dir del proyecto supabase en marcha>}"

# Extrae URL + llaves del stack en marcha (JSON de status).
ST="$(cd "$SUPABASE_DIR" && npx --yes supabase@latest status -o json 2>/dev/null)"
jqget() { node -e "const s=require('fs').readFileSync(0,'utf8');const j=JSON.parse(s);process.stdout.write(String(j['$1']||''))" <<<"$ST"; }
export API_URL="$(jqget API_URL)"
export ANON="$(jqget ANON_KEY)"
export SERVICE="$(jqget SERVICE_ROLE_KEY)"
DBURL="$(jqget DB_URL)"
[ -n "$API_URL" ] && [ -n "$DBURL" ] || { echo "no pude leer status del stack (¿está arriba?)"; exit 2; }

PSQL="psql $DBURL -v ON_ERROR_STOP=1 -q"
echo "== reset objetos representativos =="
psql "$DBURL" -q -c "drop table if exists public.pos_purchase_order_items,public.pos_purchase_orders,public.wansoft_daily,public.pos_audit_log,public.pos_staff,public.pos_menu_categories,public.pos_turnos,public.pos_orders,public.client_users,public.clients cascade; drop function if exists private.user_has_client_access(text);" >/dev/null 2>&1

echo "== 1. schema representativo =="; $PSQL -f "$HERE/real_schema.sql" || exit 1
echo "== 2. usuarios GoTrue reales =="; U="$(node "$HERE/users.mjs")" || exit 1; echo "$U"
UA="$(sed -n 's/^UA=//p' <<<"$U")"; UB="$(sed -n 's/^UB=//p' <<<"$U")"
echo "== 3. membership =="; $PSQL -c "insert into public.client_users values ('$UA','amalay','dueño'),('$UB','nomada','dueño');" || exit 1
echo "== 4. migración REAL =="; $PSQL -f "$MIGRATION" >/dev/null 2>&1 || { echo "migración FAIL"; exit 1; }
echo "== 5. suite full-stack (JWT real + PostgREST real) =="; node "$HERE/assert.mjs"
