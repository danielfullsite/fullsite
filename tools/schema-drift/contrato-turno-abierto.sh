#!/bin/bash
# CONTRATO DEL ÍNDICE «un turno abierto por restaurante» — base DESECHABLE.
#
# Levanta su propio clúster PostgreSQL en un directorio temporal, con socket
# unix propio, aplica ÚNICAMENTE la migración 20260909030000 y corre el contrato
# A–F. Al terminar borra el clúster.
#
# NO toca ninguna base compartida. NO usa red. NO lee credenciales.
# Si hay un PostgreSQL corriendo en esta máquina, no se entera: este clúster
# escucha sólo en su socket unix dentro del directorio temporal.
set -uo pipefail
# macOS de esta máquina no trae LC_* válidos. Sin esto el postmaster aborta con
# «became multithreaded during startup» — el sistema carga un hilo para resolver
# la configuración regional y Postgres se niega a seguir. La colación no
# participa de este contrato, así que C es la elección correcta y explícita.
export LC_ALL=C LANG=C

MIG_SHA_ESPERADO=4b1c202654366e1d4497080c3eb69f0ab97d5229ff422daae1b6a51484865195
REPO=/Users/danielrg/fullsite
MIG_PATH=supabase/migrations/20260909030000_un_turno_abierto_por_restaurante.sql
REF=${1:-origin/main}

# El clúster vive en el scratchpad de la sesión, no en /tmp del sistema.
BASE=${CONTRATO_TMP:-${TMPDIR:-/tmp}}
D=$(mktemp -d "$BASE/contrato-turno.XXXXXX")
PG=$D/data
# El socket NO puede vivir junto a los datos: la ruta del scratchpad supera los
# 103 bytes que permite un socket unix y el servidor no arranca. Va a un
# directorio corto y propio, que se borra al salir.
SOCK=$(mktemp -d "$HOME/.fsock.XXXXXX")
mkdir -p "$PG"
ok=0; fail=0
t() { if [ "$1" = ok ]; then ok=$((ok+1)); printf '  ✓ %s\n' "$2"; else fail=$((fail+1)); printf '  ✗ %s\n' "$2"; fi; }
limpiar() {
  [ -d "$PG" ] && pg_ctl -D "$PG" -s -m immediate stop >/dev/null 2>&1
  # Sólo se borra lo que este script creó con mktemp, y sólo si el nombre calza.
  case "$D"    in */contrato-turno.??????) rm -rf "$D" ;; esac
  case "$SOCK" in "$HOME"/.fsock.??????)   rm -rf "$SOCK" ;; esac
}
trap limpiar EXIT

echo "── 0 · integridad de la migración ──"
git -C "$REPO" show "$REF:$MIG_PATH" > "$D/mig.sql" 2>/dev/null || { echo "no se pudo leer la migración"; exit 2; }
SHA=$(shasum -a 256 "$D/mig.sql" | cut -d' ' -f1)
[ "$SHA" = "$MIG_SHA_ESPERADO" ] && t ok "sha256 del archivo coincide con el fijado" || t no "sha256 NO coincide (esperado $MIG_SHA_ESPERADO, leído $SHA)"

echo "── 1 · clúster desechable ──"
# --locale=C: el entorno de esta máquina tiene LC_* sin configuración regional
# válida e initdb se niega. La colación no participa del contrato.
initdb -D "$PG" -U postgres --auth=trust -E UTF8 --locale=C >"$D/initdb.log" 2>&1 || { echo "initdb falló:"; tail -3 "$D/initdb.log"; exit 2; }
pg_ctl -D "$PG" -o "-k $SOCK -c listen_addresses=''" -l "$D/pg.log" -w start >/dev/null 2>&1 || { echo "arranque falló"; tail -5 "$D/pg.log"; exit 2; }
q() { psql -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "$1" 2>&1; }
qf() { psql -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$1" 2>&1; }
t ok "clúster arriba: $(q 'select version()' | cut -c1-40)"

echo "── 2 · baseline: pos_turnos con sus columnas reales ──"
# Las once columnas que el esquema de producción tiene hoy, verificadas por
# introspección. Ni una más: el contrato prueba el índice, no un esquema inventado.
q "create table public.pos_turnos (
     id text primary key, client_id text not null, opened_by text, fondo_inicial numeric,
     opened_at timestamptz, closed_by text, fondo_final numeric, efectivo_sistema numeric,
     diferencia numeric, closed_at timestamptz, notas text)" >/dev/null
BASELINE=$(q "select string_agg(column_name||':'||data_type, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='pos_turnos'")
IDX_BASELINE=$(q "select count(*) from pg_indexes where schemaname='public' and tablename='pos_turnos'")
t ok "baseline con $IDX_BASELINE índice(s) y 11 columnas"

echo "── 3 · aplicar SÓLO la migración ──"
SALIDA=$(qf "$D/mig.sql")
[ $? -eq 0 ] && t ok "migración aplicada sin error" || t no "la migración falló: $SALIDA"
DEF=$(q "select pg_get_indexdef(indexrelid) from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='pos_turnos_uno_abierto_por_restaurante'")
ESPERADO="CREATE UNIQUE INDEX pos_turnos_uno_abierto_por_restaurante ON public.pos_turnos USING btree (client_id) WHERE (closed_at IS NULL)"
[ "$DEF" = "$ESPERADO" ] && t ok "fingerprint del índice idéntico al esperado" || t no "fingerprint distinto: $DEF"

echo "── 4 · contrato A–E ──"
A=$(q "insert into public.pos_turnos (id,client_id,opened_by,opened_at) values ('t1','tenantA','ana',now())" )
[ -n "$(echo "$A" | grep -i 'INSERT 0 1')" ] || A=$(q "select 1 from public.pos_turnos where id='t1'")
[ "$(q "select count(*) from public.pos_turnos where id='t1'")" = "1" ] && t ok "A · primer turno abierto del tenant A" || t no "A · no se insertó"

B=$(q "insert into public.pos_turnos (id,client_id,opened_by,opened_at) values ('t2','tenantA','beto',now())")
echo "$B" | grep -q "duplicate key value violates unique constraint \"pos_turnos_uno_abierto_por_restaurante\"" \
  && t ok "B · segundo turno abierto del MISMO tenant → violación de unicidad (23505)" \
  || t no "B · no violó unicidad. Salida: $(echo "$B" | head -1)"

D_=$(q "insert into public.pos_turnos (id,client_id,opened_by,opened_at) values ('t3','tenantB','caro',now())")
[ "$(q "select count(*) from public.pos_turnos where client_id='tenantB' and closed_at is null")" = "1" ] \
  && t ok "D · el tenant B abre el suyo en paralelo" || t no "D · el tenant B fue bloqueado"

q "update public.pos_turnos set closed_at=now(), closed_by='ana' where id='t1'" >/dev/null
C=$(q "insert into public.pos_turnos (id,client_id,opened_by,opened_at) values ('t4','tenantA','beto',now())")
[ "$(q "select count(*) from public.pos_turnos where client_id='tenantA' and closed_at is null")" = "1" ] \
  && t ok "C · cerrado el primero, el tenant A abre uno nuevo" || t no "C · no pudo reabrir: $(echo "$C"|head -1)"

q "update public.pos_turnos set closed_at=now() where id='t4'" >/dev/null
q "insert into public.pos_turnos (id,client_id,opened_by,opened_at,closed_at) values ('t5','tenantA','x',now(),now())" >/dev/null
q "insert into public.pos_turnos (id,client_id,opened_by,opened_at,closed_at) values ('t6','tenantA','y',now(),now())" >/dev/null
[ "$(q "select count(*) from public.pos_turnos where client_id='tenantA' and closed_at is not null")" = "4" ] \
  && t ok "E · los cerrados no participan de la unicidad (4 cerrados del mismo tenant)" || t no "E · un cerrado fue rechazado"

# Concurrencia real: dos sesiones intentando abrir a la vez para el mismo tenant.
q "delete from public.pos_turnos" >/dev/null
( q "begin; insert into public.pos_turnos (id,client_id,opened_at) values ('c1','tenantC',now()); select pg_sleep(0.4); commit;" >"$D/c1.out" 2>&1 ) &
sleep 0.1
q "insert into public.pos_turnos (id,client_id,opened_at) values ('c2','tenantC',now())" >"$D/c2.out" 2>&1
wait
ABIERTOS=$(q "select count(*) from public.pos_turnos where client_id='tenantC' and closed_at is null")
if [ "$ABIERTOS" = "1" ] && grep -qi 'duplicate key' "$D/c2.out"; then
  t ok "concurrencia · dos sesiones simultáneas → exactamente 1 abierto, la segunda bloqueó y falló"
else
  t no "concurrencia · quedaron $ABIERTOS abiertos; c2: $(head -1 "$D/c2.out")"
fi

echo "── 5 · F · rollback ──"
q "drop index public.pos_turnos_uno_abierto_por_restaurante" >/dev/null
DESPUES=$(q "select string_agg(column_name||':'||data_type, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='pos_turnos'")
IDX_DESPUES=$(q "select count(*) from pg_indexes where schemaname='public' and tablename='pos_turnos'")
[ "$DESPUES" = "$BASELINE" ] && t ok "F · columnas idénticas al baseline tras el rollback" || t no "F · el esquema cambió"
[ "$IDX_DESPUES" = "$IDX_BASELINE" ] && t ok "F · mismo número de índices que el baseline ($IDX_BASELINE)" || t no "F · quedaron $IDX_DESPUES índices"
q "insert into public.pos_turnos (id,client_id,opened_at) values ('r1','tenantD',now())" >/dev/null
R=$(q "insert into public.pos_turnos (id,client_id,opened_at) values ('r2','tenantD',now())")
echo "$R" | grep -qi 'duplicate key' && t no "F · el índice seguía vivo tras el DROP" || t ok "F · tras el rollback vuelve a admitir dos abiertos (el índice se fue de verdad)"

echo
echo "── resultado ──"
echo "  ok=$ok  fail=$fail"
echo "  DISPOSABLE_DB_CONTRACT = $([ $fail -eq 0 ] && echo PASS || echo FAIL)"
echo "  escrituras a base compartida: 0 · el clúster se destruye al salir"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
