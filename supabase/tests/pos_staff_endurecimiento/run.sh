#!/bin/bash
# Prueba de las migraciones de endurecimiento de pos_staff en un Postgres 16 DESECHABLE.
# Solo socket local, sin TCP. Datos sintéticos. No toca ninguna base real.
#
# Uso:
#   supabase/tests/pos_staff_endurecimiento/run.sh [ruta-migracion-PR5]
# La migración de PR5 (caducidad de act-as) es opcional: vive en otra rama
# (containment/tenant-role-enforcement). Sin ella, los casos de act-as vencido se omiten
# y se reportan como OMITIDO, nunca como PASS.
set -u
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
PR3="$MIG/PENDIENTE_20260924060000_pos_staff_pin_fuera_de_authenticated.sql"
END="$MIG/PENDIENTE_20260925010000_pos_staff_endurecimiento.sql"
END_RB="$MIG/PENDIENTE_20260925010000_pos_staff_endurecimiento_ROLLBACK.sql"
TRU="$MIG/PENDIENTE_20260925020000_revocar_truncate_anon_authenticated.sql"
TRU_RB="$MIG/PENDIENTE_20260925020000_revocar_truncate_anon_authenticated_ROLLBACK.sql"
F1="$MIG/PENDIENTE_20260914120000_pos_staff_pin_hash.sql"
APROB="$MIG/PENDIENTE_20260925030000_pos_aprobaciones_usadas.sql"
APROB_RB="$MIG/PENDIENTE_20260925030000_pos_aprobaciones_usadas_ROLLBACK.sql"
PR5="${1:-}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/pos-staff-pg.XXXXXX")"
SOCK="/tmp/pss$$"
ln -s "$TMP" "$SOCK"
PASS=0; FAIL=0; OMIT=0

arrancar() {  # $1 = directorio de datos
  initdb -D "$1" -U postgres -A trust --no-locale --encoding=UTF8 >"$TMP/initdb.log" 2>&1 || { echo "initdb falló"; exit 1; }
  pg_ctl -D "$1" -o "-k $SOCK -c listen_addresses=''" -l "$TMP/pg.log" -w start >/dev/null || { echo "no arrancó"; exit 1; }
}
parar() { pg_ctl -D "$1" -w stop >/dev/null 2>&1; }
trap 'for d in "$TMP"/datos*; do parar "$d"; done; rm -f "$SOCK"' EXIT

PSQL="psql -X -q -At -h $SOCK -U postgres -d postgres"
aplicar() { $PSQL -v ON_ERROR_STOP=1 -f "$1" >"$TMP/aplicar.log" 2>&1; }
foto() { $PSQL -v ON_ERROR_STOP=1 -f "$AQUI/90_foto.sql" || { echo "  FAIL  la foto de catálogo falló (ver error arriba)" >&2; FAIL=$((FAIL+1)); }; }

# caso <descripción> <rol> <uid|-> <sql que devuelve 1 valor> <esperado: E:<sqlstate> | N:<n> | V:<valor>>
caso() {
  local desc="$1" rol="$2" uid="$3" sql="$4" esperado="$5" sub="" out obtenido
  [ "$uid" != "-" ] && sub="select set_config('request.jwt.claim.sub', '$uid', true);"
  out=$($PSQL -v VERBOSITY=sqlstate 2>&1 <<SQL
\set VERBOSITY sqlstate
begin;
set local role $rol;
$sub
$sql;
rollback;
SQL
)
  if echo "$out" | grep -q '^ERROR:'; then
    obtenido="E:$(echo "$out" | grep -m1 '^ERROR:' | awk '{print $2}')"
  else
    obtenido=$(echo "$out" | grep -v '^$' | tail -1)
    case "$esperado" in N:*) obtenido="N:$obtenido";; V:*) obtenido="V:$obtenido";; esac
  fi
  if [ "$obtenido" = "$esperado" ]; then PASS=$((PASS+1)); printf '  PASS  %-78s %s\n' "$desc" "$obtenido"
  else FAIL=$((FAIL+1)); printf '  FAIL  %-78s esperado=%s obtenido=%s\n' "$desc" "$esperado" "$obtenido"; fi
}
omitir() { OMIT=$((OMIT+1)); printf '  OMITIDO %-76s %s\n' "$1" "$2"; }
# Copia de una foto SIN los privilegios de anon. Los rollbacks no reabren anon (el guardián
# test_migraciones_no_exponen_a_anon.py lo prohíbe y ningún lector legítimo lo usa), así que
# «rollback exacto» se compara contra el estado previo menos anon.
sin_anon() {
  python3 - "$1" "$2" <<'PY'
import sys
out = []
for linea in open(sys.argv[1]):
    k, _, v = linea.rstrip('\n').partition('=')
    items = [x for x in v.split(',') if x and x != 'anon' and 'anon:' not in x]
    out.append(k + '=' + ','.join(items))
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
PY
}

igual() {  # igual <desc> <archivoA> <archivoB> [lineas a excluir regex]
  local excl="${4:-^$}"
  if diff <(grep -vE "$excl" "$2") <(grep -vE "$excl" "$3") >/dev/null; then PASS=$((PASS+1)); echo "  PASS  $1"
  else FAIL=$((FAIL+1)); echo "  FAIL  $1"; diff <(grep -vE "$excl" "$2") <(grep -vE "$excl" "$3") | sed 's/^/        /'; fi
}

NO=00000000-0000-0000-0000-0000000000a1
VIEW=00000000-0000-0000-0000-0000000000a2
GER=00000000-0000-0000-0000-0000000000a3
DUE=00000000-0000-0000-0000-0000000000a4
ACT_OK=00000000-0000-0000-0000-0000000000b5
ACT_VIEJO=00000000-0000-0000-0000-0000000000b6
ACT_FUT=00000000-0000-0000-0000-0000000000b7

# Con F1 (pin_hash) presente: la columna nueva NO la alcanza nadie del navegador, la doble
# escritura del servidor se audita como pin_reset y el CHECK de F1 sigue mordiendo.
casos_f1() {  # $1 = etiqueta
  local m="$1"
  caso "[$m] miembro básico: lee pin_hash"                                 authenticated $VIEW "select count(*) from (select pin_hash from pos_staff) s" E:42501
  caso "[$m] dueño del dashboard: lee pin_hash / pin_hash_v"               authenticated $DUE  "select count(*) from (select pin_hash, pin_hash_v from pos_staff) s" E:42501
  caso "[$m] miembro básico: usa pin_hash como oráculo"                    authenticated $VIEW "select count(*) from pos_staff where pin_hash is not null" E:42501
  caso "[$m] anon: lee pin_hash"                                           anon - "select count(*) from (select pin_hash from pos_staff) s" E:42501
  caso "[$m] miembro básico: escribe pin_hash"                             authenticated $VIEW "with u as (update pos_staff set pin_hash = repeat('a', 64), pin_hash_v = 1 where id = 'a-gerente' returning 1) select count(*) from u" E:42501
  caso "[$m] servidor: doble escritura pin+pin_hash → auditada como pin_reset" service_role - "update pos_staff set pin = '4777', pin_hash = repeat('a', 64), pin_hash_v = 1 where id = 'a-mesero'; select action || ':' || (changed_fields ? 'pin_hash')::text from pos_staff_audit where origen = 'db_trigger' order by id desc limit 1" V:pin_reset:true
  caso "[$m] servidor: hash sin versión (fila a medias) → CHECK de F1"   service_role - "update pos_staff set pin_hash = repeat('b', 64) where id = 'a-mesero'" E:23514
  caso "[$m] lectura legítima sigue con F1: miembro lee id,name,role,active" authenticated $VIEW "select count(*) from (select id, name, role, active from pos_staff) s" N:2
}

matriz_navegador() {  # $1 = "vulnerable" | "endurecido"
  local m="$1" e_pin e_rol e_ins e_del e_trunc e_nom e_sueldo e_anon
  if [ "$m" = vulnerable ]; then
    e_pin=N:2; e_rol=N:1; e_ins=N:1; e_del=N:1; e_trunc=V:truncado; e_nom=N:1; e_sueldo=N:2; e_anon=N:0; e_atrunc=V:truncado
  else
    e_pin=E:42501; e_rol=E:42501; e_ins=E:42501; e_del=E:42501; e_trunc=E:42501; e_nom=E:42501; e_sueldo=E:42501; e_anon=E:42501; e_atrunc=E:42501
  fi
  caso "[$m] sin membresía: lee nombres de pos_staff (0 filas)"            authenticated $NO   "select count(*) from (select id, name from pos_staff) s" N:0
  caso "[$m] miembro básico: lee id,name,role,active de su restaurante"     authenticated $VIEW "select count(*) from (select id, name, role, active from pos_staff) s" N:2
  caso "[$m] miembro básico: NO ve filas de otro restaurante"               authenticated $VIEW "select count(*) from (select id from pos_staff where client_id = 'tenant-b') s" N:0
  caso "[$m] miembro básico: lee PIN"                                       authenticated $VIEW "select count(*) from (select pin from pos_staff) s" $e_pin
  caso "[$m] miembro básico: usa el PIN como oráculo (filtro pin=eq)"       authenticated $VIEW "select count(*) from pos_staff where pin = '4102'" $([ "$m" = vulnerable ] && echo N:1 || echo E:42501)
  caso "[$m] miembro básico: lee sueldos"                                   authenticated $VIEW "select count(*) from (select hourly_rate, weekly_salary from pos_staff) s" $e_sueldo
  caso "[$m] miembro básico: sube a admin a un empleado (autoescalación)"   authenticated $VIEW "with u as (update pos_staff set role = 'admin' where id = 'a-mesero' returning 1) select count(*) from u" $e_rol
  caso "[$m] miembro básico: restablece el PIN de un gerente"               authenticated $VIEW "with u as (update pos_staff set pin = '9999' where id = 'a-gerente' returning 1) select count(*) from u" $e_rol
  caso "[$m] miembro básico: cambia el nombre / desactiva"                  authenticated $VIEW "with u as (update pos_staff set active = false where id = 'a-gerente' returning 1) select count(*) from u" $e_nom
  caso "[$m] miembro básico: crea un admin con PIN propio"                  authenticated $VIEW "with i as (insert into pos_staff (id, client_id, name, pin, role) values ('x', 'tenant-a', 'x', '4999', 'admin') returning 1) select count(*) from i" $e_ins
  caso "[$m] miembro básico: borra personal"                                authenticated $VIEW "with d as (delete from pos_staff where id = 'a-mesero' returning 1) select count(*) from d" $e_del
  caso "[$m] gerente del dashboard: lee PIN directo"                        authenticated $GER  "select count(*) from (select pin from pos_staff) s" $e_pin
  caso "[$m] gerente del dashboard: cambia rol directo (debe ir por la API)" authenticated $GER "with u as (update pos_staff set role = 'gerente' where id = 'a-mesero' returning 1) select count(*) from u" $e_rol
  caso "[$m] dueño del dashboard: cambia rol directo (debe ir por la API)"  authenticated $DUE  "with u as (update pos_staff set role = 'gerente' where id = 'a-mesero' returning 1) select count(*) from u" $e_rol
  caso "[$m] acceso cruzado: miembro de A mueve un empleado a B"            authenticated $VIEW "with u as (update pos_staff set client_id = 'tenant-b' where id = 'a-mesero' returning 1) select count(*) from u" $([ "$m" = vulnerable ] && echo E:42501 || echo E:42501)
  caso "[$m] miembro básico: TRUNCATE pos_staff"                            authenticated $VIEW "truncate pos_staff; select 'truncado'" $e_trunc
  caso "[$m] anon: lee pos_staff"                                           anon - "select count(*) from (select id from pos_staff) s" $e_anon
  caso "[$m] anon: TRUNCATE pos_staff"                                      anon - "truncate pos_staff; select 'truncado'" $e_atrunc
  caso "[$m] act-as vigente (10 min) sobre B: lee nombres de B"             authenticated $ACT_OK "select count(*) from (select id, name from pos_staff where client_id = 'tenant-b') s" N:2
  caso "[$m] act-as vigente sobre B: lee PIN de B"                          authenticated $ACT_OK "select count(*) from (select pin from pos_staff where client_id = 'tenant-b') s" $e_pin
  caso "[$m] miembro básico: escribe en pos_staff_audit (falsificar bitácora)" authenticated $VIEW "with i as (insert into pos_staff_audit (client_id, staff_id, action, changed_by) values ('tenant-a','a-mesero','x','x') returning 1) select count(*) from i" $([ "$m" = vulnerable ] && echo E:42501 || echo E:42501)
  # La autorización de la API sale de client_users: si el usuario pudiera editarla, se
  # autorizaría con un dato propio. Sólo hay política de SELECT → UPDATE ve 0 filas, INSERT
  # viola RLS. Igual en ambos estados: es la base sobre la que se apoya el endurecimiento.
  caso "[$m] miembro básico: se sube a dueño en client_users"               authenticated $VIEW "with u as (update client_users set role = 'dueño' where user_id = auth.uid() returning 1) select count(*) from u" N:0
  caso "[$m] miembro básico: se da membresía en otro restaurante"           authenticated $VIEW "with i as (insert into client_users (user_id, client_id, role) values (auth.uid(), 'tenant-b', 'dueño') returning 1) select count(*) from i" E:42501
  caso "[$m] gerente: se borra la membresía de otro (sacar al dueño)"       authenticated $GER  "with d as (delete from client_users where role = 'dueño' returning 1) select count(*) from d" N:0
}

echo "=== Postgres: $(postgres --version)"
echo; echo "== S1 · esquema de producción → PR3 → endurecimiento → TRUNCATE =="
arrancar "$TMP/datos1"
aplicar "$AQUI/00_esquema_produccion.sql" && aplicar "$AQUI/01_datos_sinteticos.sql" || { echo "SETUP FALLÓ"; cat "$TMP/aplicar.log"; exit 1; }
foto >"$TMP/foto_prod.txt"

echo "-- 1. Estado de producción: el guardián debe VER la vulnerabilidad"
matriz_navegador vulnerable

echo "-- 2. PR3"
aplicar "$PR3" && echo "  aplicada" || { echo "  PR3 FALLÓ"; cat "$TMP/aplicar.log"; }
foto >"$TMP/foto_pr3.txt"
caso "[pr3] miembro básico: lee PIN"                                authenticated $VIEW "select count(*) from (select pin from pos_staff) s" E:42501
caso "[pr3] miembro básico: desactiva a un gerente (PR3 NO lo cierra)" authenticated $VIEW "with u as (update pos_staff set active = false where id = 'a-gerente' returning 1) select count(*) from u" N:1
caso "[pr3] miembro básico: borra personal (PR3 NO lo cierra)"      authenticated $VIEW "with d as (delete from pos_staff where id = 'a-mesero' returning 1) select count(*) from d" N:1
caso "[pr3] miembro básico: lee sueldos (PR3 NO lo cierra)"         authenticated $VIEW "select count(*) from (select hourly_rate from pos_staff) s" N:2
caso "[pr3] anon: TRUNCATE pos_staff (PR3 NO lo cierra)"            anon - "truncate pos_staff; select 'truncado'" V:truncado

echo "-- 3. Endurecimiento"
aplicar "$END" && echo "  aplicada" || { echo "  ENDURECIMIENTO FALLÓ"; cat "$TMP/aplicar.log"; }
foto >"$TMP/foto_end.txt"
matriz_navegador endurecido

echo "-- 4. Escrituras del servidor (service_role) y auditoría en la base"
caso "service_role: sube de rol (vía API) → permitido"            service_role - "with u as (update pos_staff set role = 'capitan', role_display = 'capitan' where id = 'a-mesero' returning 1) select count(*) from u" N:1
$PSQL -c "set role service_role; update pos_staff set role = 'capitan', role_display = 'capitan' where id = 'a-mesero'" >/dev/null
$PSQL -c "set role service_role; update pos_staff set pin = '4777' where id = 'a-mesero'" >/dev/null
$PSQL -c "set role service_role; update pos_staff set active = false where id = 'a-mesero'" >/dev/null
$PSQL -c "set role service_role; insert into pos_staff (id, client_id, name, pin, role) values ('a-nuevo', 'tenant-a', 'Nuevo sintetico', '4555', 'mesero')" >/dev/null
$PSQL -c "set role service_role; delete from pos_staff where id = 'a-nuevo'" >/dev/null
caso "auditoría: role_changed registra NOMBRES de campos"           postgres - "select changed_fields::text from pos_staff_audit where action = 'role_changed' and origen = 'db_trigger'" 'V:["role", "role_display"]'
caso "auditoría: pin_reset registrado"                              postgres - "select count(*) from pos_staff_audit where action = 'pin_reset' and changed_fields ? 'pin'" N:1
caso "auditoría: deactivated registrado"                            postgres - "select count(*) from pos_staff_audit where action = 'deactivated'" N:1
caso "auditoría: created y deleted registrados"                     postgres - "select count(*) from pos_staff_audit where action in ('created','deleted')" N:2
caso "auditoría: ninguna fila contiene un valor de PIN"             postgres - "select count(*) from pos_staff_audit where changed_fields::text ~ '4777|4555|4101|4102' or changed_by ~ '4777|4555'" N:0
caso "auditoría: actor = rol de BD cuando no hay JWT"               postgres - "select distinct changed_by from pos_staff_audit where origen = 'db_trigger'" V:db:service_role
caso "auditoría: miembro de A la lee; no ve la de B"                authenticated $VIEW "select count(*) from pos_staff_audit where client_id = 'tenant-b'" N:0
caso "aislamiento: service_role NO puede mover client_id"           service_role - "update pos_staff set client_id = 'tenant-b' where id = 'a-gerente'; select 1" E:23514
caso "falla cerrado: si la auditoría falla, la escritura no ocurre" postgres - "alter table pos_staff_audit add constraint t_rompe check (action <> 'role_changed') not valid; set local role service_role; update pos_staff set role = 'cajero' where id = 'a-gerente'; select 1" E:23514

echo "-- 5. Rollback del endurecimiento → estado PR3 exacto"
aplicar "$END_RB" && echo "  rollback aplicado" || { echo "  ROLLBACK FALLÓ"; cat "$TMP/aplicar.log"; }
foto >"$TMP/foto_rb.txt"
sin_anon "$TMP/foto_pr3.txt" "$TMP/foto_pr3_sin_anon.txt"
sin_anon "$TMP/foto_rb.txt" "$TMP/foto_rb_sin_anon.txt"
igual "rollback = estado PR3 sin anon (excepto columna aditiva pos_staff_audit.origen, documentada)" "$TMP/foto_pr3_sin_anon.txt" "$TMP/foto_rb_sin_anon.txt" '^columna_origen='
caso "[rollback] anon NO recupera TRUNCATE de pos_staff"          anon - "truncate pos_staff; select 'truncado'" E:42501
caso "[rollback] anon NO recupera lectura de pos_staff"           anon - "select count(*) from (select id from pos_staff) s" E:42501
caso "[rollback] miembro básico vuelve a poder desactivar (estado PR3)" authenticated $VIEW "with u as (update pos_staff set active = true where id = 'a-mesero' returning 1) select count(*) from u" N:1

echo "-- 6. Reaplicar dos veces → mismo estado endurecido"
aplicar "$END" && aplicar "$END" && echo "  aplicada ×2"
foto >"$TMP/foto_end2.txt"
igual "reaplicación idempotente = primer endurecimiento" "$TMP/foto_end.txt" "$TMP/foto_end2.txt"

echo "-- 7. Fallas inyectadas: nada queda a medias"
aplicar "$END_RB" >/dev/null
foto >"$TMP/foto_pre_falla.txt"
$PSQL -c "begin; lock table public.pos_staff in access exclusive mode; select pg_sleep(6); commit;" >/dev/null 2>&1 &
BL=$!; sleep 1
if aplicar "$END"; then FAIL=$((FAIL+1)); echo "  FAIL  con la tabla bloqueada la migración debió fallar"; else PASS=$((PASS+1)); echo "  PASS  bloqueo → falla por lock_timeout ($(grep -m1 -oE 'ERROR:.*' "$TMP/aplicar.log"))"; fi
wait $BL
foto >"$TMP/foto_falla_a.txt"; igual "tras falla A: estado idéntico al previo" "$TMP/foto_pre_falla.txt" "$TMP/foto_falla_a.txt"
sed 's/^commit;$/select 1\/0; -- falla inyectada\ncommit;/' "$END" >"$TMP/end_falla.sql"
if aplicar "$TMP/end_falla.sql"; then FAIL=$((FAIL+1)); echo "  FAIL  1/0 antes del COMMIT debió fallar"; else PASS=$((PASS+1)); echo "  PASS  1/0 antes del COMMIT → falla"; fi
foto >"$TMP/foto_falla_b.txt"; igual "tras falla B: estado idéntico al previo" "$TMP/foto_pre_falla.txt" "$TMP/foto_falla_b.txt"
aplicar "$END"

echo "-- 8. Act-as con caducidad (función de PR5)"
if [ -n "$PR5" ] && [ -f "$PR5" ]; then
  aplicar "$PR5" && echo "  PR5 aplicada: $(basename "$PR5")"
  caso "act-as vigente (10 min): ve nombres de B"                  authenticated $ACT_OK    "select count(*) from (select id from pos_staff where client_id = 'tenant-b') s" N:2
  caso "act-as vencido (61 min): NO ve B"                          authenticated $ACT_VIEJO "select count(*) from (select id from pos_staff where client_id = 'tenant-b') s" N:0
  caso "act-as con fecha futura: NO ve B"                          authenticated $ACT_FUT   "select count(*) from (select id from pos_staff where client_id = 'tenant-b') s" N:0
  caso "act-as vigente: tampoco lee PIN ni escribe"                authenticated $ACT_OK    "select count(*) from (select pin from pos_staff) s" E:42501
else
  omitir "act-as vencido / fecha futura" "falta la migración de PR5 (argumento 1)"
fi

echo "-- 9. TRUNCATE en todo public"
foto >"$TMP/foto_pre_tru.txt"
aplicar "$TRU" && echo "  aplicada"
caso "anon: TRUNCATE de otra tabla de negocio"                     anon - "truncate ventas_sinteticas; select 'truncado'" E:42501
caso "authenticated: TRUNCATE de otra tabla de negocio"            authenticated $VIEW "truncate ventas_sinteticas; select 'truncado'" E:42501
caso "service_role conserva TRUNCATE (tablas propias del servidor)" service_role - "truncate ventas_sinteticas; select 'truncado'" V:truncado
caso "tabla NUEVA ya no nace con TRUNCATE para anon/authenticated" postgres - "create table public.t_nueva (id int); select count(*) from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.t_nueva'::regclass and a.privilege_type = 'TRUNCATE' and pg_get_userbyid(a.grantee) in ('anon','authenticated')" N:0
caso "lectura legítima sigue: miembro lee nombres"                 authenticated $VIEW "select count(*) from (select id, name from pos_staff) s" N:2
aplicar "$TRU_RB" && echo "  rollback aplicado"
foto >"$TMP/foto_tru_rb.txt"
sin_anon "$TMP/foto_pre_tru.txt" "$TMP/foto_pre_tru_sin_anon.txt"
igual "rollback TRUNCATE: estado previo exacto sin anon" "$TMP/foto_pre_tru_sin_anon.txt" "$TMP/foto_tru_rb.txt"
caso "[rollback TRUNCATE] anon sigue sin TRUNCATE en tablas de negocio" anon - "truncate ventas_sinteticas; select 'truncado'" E:42501
caso "[rollback TRUNCATE] authenticated recupera TRUNCATE (ruta no vista)" authenticated $VIEW "truncate ventas_sinteticas; select 'truncado'" V:truncado

echo "-- 10. F1 (pin_hash) DESPUÉS del endurecimiento"
aplicar "$F1" && echo "  F1 aplicada" || { FAIL=$((FAIL+1)); echo "  FAIL  F1 no aplicó sobre el estado endurecido"; cat "$TMP/aplicar.log"; }
casos_f1 "endurecido+F1"

echo "-- 11. Registro de uso de aprobaciones (pos_aprobaciones_usadas)"
aplicar "$APROB" && echo "  aplicada" || { FAIL=$((FAIL+1)); echo "  FAIL  no aplicó"; cat "$TMP/aplicar.log"; }
caso "aprobaciones: anon no inserta"                                  anon - "insert into pos_aprobaciones_usadas (jti, client_id, operacion) values ('jti-sintetico-1', 'tenant-a', 'op'); select 'x'" E:42501
caso "aprobaciones: miembro con sesión no inserta ni lee"             authenticated $DUE "select count(*) from pos_aprobaciones_usadas" E:42501
caso "aprobaciones: servidor registra el primer uso"                  service_role - "with i as (insert into pos_aprobaciones_usadas (jti, client_id, operacion) values ('jti-sintetico-1', 'tenant-a', 'op') returning 1) select count(*) from i" N:1
caso "aprobaciones: el mismo jti otra vez → 23505 (PostgREST 409)"   service_role - "insert into pos_aprobaciones_usadas (jti, client_id, operacion) values ('jti-sintetico-2', 'tenant-a', 'op'); insert into pos_aprobaciones_usadas (jti, client_id, operacion) values ('jti-sintetico-2', 'tenant-a', 'otra'); select 'x'" E:23505
caso "aprobaciones: jti demasiado corto se rechaza"                   service_role - "insert into pos_aprobaciones_usadas (jti, client_id, operacion) values ('corto', 'tenant-a', 'op'); select 'x'" E:23514
aplicar "$APROB" && echo "  reaplicada (idempotente)" || { FAIL=$((FAIL+1)); echo "  FAIL  no es idempotente"; }
aplicar "$APROB_RB" && caso "aprobaciones: rollback borra la tabla" postgres - "select count(*) from pg_class where relname = 'pos_aprobaciones_usadas'" N:0
parar "$TMP/datos1"

echo; echo "== S2 · esquema de producción → endurecimiento DIRECTO (sin PR3): autosuficiente =="
arrancar "$TMP/datos2"
aplicar "$AQUI/00_esquema_produccion.sql" && aplicar "$AQUI/01_datos_sinteticos.sql" && aplicar "$END" && echo "  aplicada"
foto >"$TMP/foto_s2.txt"
igual "estado final sin PR3 = estado final con PR3" "$TMP/foto_end.txt" "$TMP/foto_s2.txt"
matriz_navegador endurecido
parar "$TMP/datos2"

echo; echo "== S3 · orden del plan: producción → PR3 → F1 → endurecimiento → TRUNCATE =="
arrancar "$TMP/datos3"
aplicar "$AQUI/00_esquema_produccion.sql" && aplicar "$AQUI/01_datos_sinteticos.sql" || { echo "SETUP S3 FALLÓ"; exit 1; }
for m in "$PR3" "$F1" "$END" "$TRU"; do
  if aplicar "$m"; then echo "  aplicada: $(basename "$m")"; else FAIL=$((FAIL+1)); echo "  FAIL  no aplicó: $(basename "$m")"; cat "$TMP/aplicar.log"; fi
done
matriz_navegador endurecido
casos_f1 "plan"
echo "  rollback en orden inverso: TRUNCATE → endurecimiento"
aplicar "$TRU_RB" && aplicar "$END_RB" && echo "  rollbacks aplicados" || { FAIL=$((FAIL+1)); echo "  FAIL  rollback en orden inverso"; cat "$TMP/aplicar.log"; }
caso "[plan→rollback] PR3 sigue cerrando pin_hash (la columna nació sin grant)" authenticated $VIEW "select count(*) from (select pin_hash from pos_staff) s" E:42501
caso "[plan→rollback] estado PR3: miembro vuelve a poder desactivar"           authenticated $VIEW "with u as (update pos_staff set active = false where id = 'a-gerente' returning 1) select count(*) from u" N:1
parar "$TMP/datos3"

echo; echo "=== RESULTADO: $PASS PASS · $FAIL FAIL · $OMIT OMITIDO"
cp "$TMP"/foto_*.txt "${FOTOS_DIR:-$TMP}/" 2>/dev/null || true
[ "$FAIL" -eq 0 ]
