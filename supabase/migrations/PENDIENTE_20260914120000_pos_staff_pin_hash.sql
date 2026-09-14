-- PENDIENTE: requiere que Daniel la aplique por el camino normal de migraciones.
-- NO se aplicó por el MCP — el MCP de AMALAY es read-only y así debe quedarse.
--
-- Fase 1 de docs/security/PLAN-PIN-HASH.md. Aditiva pura: agrega dos columnas
-- NULLABLE y un índice. Ninguna fila cambia, ningún código las lee todavía.
-- La doble escritura es F2, el backfill F3 y el corte de lectura F4.
--
-- ── EL PROBLEMA QUE ESTO EMPIEZA A CERRAR ─────────────────────────────────────
--
-- `pos_staff.pin` guarda los PIN en TEXTO PLANO. Censo del 2026-09-14: 84 personas
-- en 11 tenants, 81 con PIN de 4 dígitos. Los lee el token del MCP
-- (`supabase_read_only_user` tiene rolbypassrls), el service_role, y cualquier
-- usuario de dashboard del propio restaurante vía PostgREST (política
-- `pos_staff_sel`). En AMALAY eso son 4 personas que pueden leer los 40 PIN sin
-- acercarse a la base, sólo abriendo /equipo.
--
-- ── POR QUÉ HMAC Y NO UNA SAL POR FILA ────────────────────────────────────────
--
-- `/api/pos/pin` no COMPARA un PIN: lo BUSCA (`pos_staff?pin=eq.<pin>`). No hay
-- usuario — el mesero teclea 4 dígitos y el PIN ES la identidad, respaldada por
-- `unique_pin_per_client`. Sin fila que buscar, una sal por fila obligaría a traer
-- las 40 personas del restaurante y correr el KDF contra cada una: ~4 s por login,
-- dentro de un timeout de Pedro de 5 s. Por eso el esquema es determinista:
--
--   pin_hash = hex( HMAC-SHA256( pimienta_del_servidor, client_id || ':' || pin ) )
--
-- La pimienta vive SÓLO en el entorno (POS_PIN_PEPPER), nunca aquí, nunca en un
-- respaldo de Postgres. La regla en sí, con sus pruebas, está en
-- dashboard-app/src/lib/pos-pin-hash.ts (F0, ya en main).
--
-- El `client_id` va DENTRO del mensaje: sin eso, el mismo PIN en dos restaurantes
-- daría el mismo hash y un dump permitiría correlacionar personas entre clientes.

alter table public.pos_staff add column if not exists pin_hash   text;
alter table public.pos_staff add column if not exists pin_hash_v smallint;

comment on column public.pos_staff.pin_hash is
  'HMAC-SHA256(POS_PIN_PEPPER, client_id || '':'' || pin) en hex. NULL = fila anterior al backfill de F3. La pimienta NO vive en la base: sin ella este valor no se puede revertir ni verificar.';
comment on column public.pos_staff.pin_hash_v is
  'Version de pimienta con la que se calculo pin_hash. 1 = POS_PIN_PEPPER. Existe desde el dia uno para poder rotar la pimienta sin adivinar que filas usan cual.';

-- ── Unicidad, igual que la del PIN en claro ───────────────────────────────────
--
-- Espeja `unique_pin_per_client UNIQUE (pin, client_id)`, que es lo que garantiza
-- que la busqueda por PIN devuelva UNA persona y no dos. Sin este indice, dos
-- empleados podrian terminar con el mismo pin_hash y el login seria ambiguo:
-- `limit=1` devolveria a cualquiera de los dos, y la bitacora de quien autorizo
-- una cancelacion dejaria de probar nada.
--
-- Parcial (`where pin_hash is not null`) porque durante F1..F3 conviven filas
-- hasheadas y sin hashear; sin el `where`, los NULL no chocarian entre si en
-- Postgres pero el indice cargaria 84 entradas muertas.
--
-- NO filtra por `active`, a proposito: `unique_pin_per_client` tampoco lo hace, y
-- la razon esta escrita en api/owner/staff/route.ts:50-54 — si filtrara, el PIN de
-- un mesero desactivado se veria "libre" en la validacion y el INSERT chocaria
-- contra el indice con un 502 opaco.
--
-- (client_id, pin_hash) y no al reves: el orden sirve a las tres consultas que
-- vendran en F4, que siempre filtran por ambos. Por eso NO se agrega un segundo
-- indice sobre pin_hash solo — seria redundante y costaria en cada escritura.
-- Esto se aparta del plan, que proponia dos indices; uno basta.
create unique index if not exists pos_staff_pin_hash_unico
  on public.pos_staff (client_id, pin_hash)
  where pin_hash is not null;

-- ── El formato se exige AHORA, no en F6 ───────────────────────────────────────
--
-- El plan ponia este CHECK hasta el final. Adelantarlo sale gratis —las 84 filas
-- tienen pin_hash NULL, asi que la restriccion se valida trivialmente— y cambia
-- donde se descubre un backfill roto: al escribirlo en F3, en vez de en F4 cuando
-- 40 personas no puedan entrar.
--
-- Tambien ata las dos columnas: o las dos estan, o ninguna. Una fila con pin_hash
-- y sin version seria imposible de re-hashear el dia que se rote la pimienta.
--
-- ── OJO CON EL `is not null` EXPLICITO: NO ES REDUNDANTE ──────────────────────
--
-- Un CHECK en Postgres rechaza la fila solo cuando la expresion da FALSE. Si da
-- NULL, la fila PASA. La version primera de este constraint decia:
--
--     (pin_hash is null and pin_hash_v is null)
--     or (pin_hash ~ '^[0-9a-f]{64}$' and pin_hash_v >= 1)
--
-- y con eso una fila de (hash valido, version NULL) entraba sin chistar: la
-- segunda rama evaluaba `true and (NULL >= 1)` = `true and NULL` = NULL, la
-- primera daba false, y `false or NULL` = NULL → PASA. Justo la fila a medio
-- escribir que el constraint existe para impedir.
--
-- Se descubrio ejecutandola contra un Postgres 16.14 de verdad (2026-09-14); leer
-- la expresion no bastaba. Poniendo los `is not null` DELANTE, esa rama da
-- `true and false and ...` = FALSE —porque en logica de tres valores
-- `false and NULL` sigue siendo false— y el constraint muerde.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_staff_pin_hash_chk') then
    alter table public.pos_staff
      add constraint pos_staff_pin_hash_chk check (
        (pin_hash is null and pin_hash_v is null)
        or (
          pin_hash is not null and pin_hash_v is not null
          and pin_hash ~ '^[0-9a-f]{64}$' and pin_hash_v >= 1
        )
      );
  end if;
end $$;

-- ── Lo que esta migracion NO hace, y por que ──────────────────────────────────
--
-- 1. NO toca `pin`. Sigue siendo la columna autoritativa hasta F4. Mientras exista,
--    el rollback de cualquier fase posterior es codigo, no datos.
--
-- 2. NO revoca el SELECT de `anon`. `anon` tiene GRANT SELECT a nivel TABLA sobre
--    pos_staff (ACL `anon=rDxtm`), pero ninguna politica RLS y rolbypassrls=false,
--    asi que hoy lee CERO filas. Un `revoke select (pin, pin_hash) ... from anon`
--    se veria como que cierra algo y no cerraria nada: en Postgres un privilegio a
--    nivel tabla no se recorta revocando columnas sueltas — habria que revocar el
--    SELECT completo y volver a otorgarlo columna por columna. Eso cambia la
--    superficie de acceso de anon y merece su propio PR, con su propio barrido de
--    quien consulta pos_staff con la llave publica (hoy: mobile-app/LoginScreen,
--    que por esto mismo ya esta muerto en produccion). Queda anotado, no hecho.
--
-- 3. NO agrega NOT NULL a pin_hash. Eso es F6, despues del backfill y de 14 dias
--    de F4/F5 estables.
--
-- ── OJO: staging y produccion NO tienen el mismo esquema aqui ─────────────────
--
-- Medido el 2026-09-14: produccion (qjiomlvudfmzuvqvhwpk) tiene tres constraints
-- en pos_staff — pkey, unique_pin_per_client y pos_staff_pin_len_chk. Staging
-- (jkcnxfbbuyyfhwfjizgw) sólo tiene las dos primeras: le FALTA el CHECK de
-- longitud del PIN.
--
-- Esta migracion no depende de esa diferencia, asi que corre igual en los dos.
-- Pero F5 planea `drop constraint pos_staff_pin_len_chk` y en staging eso
-- reventaria: alli tendra que ser `drop constraint if exists`. Queda escrito para
-- que no se descubra el dia que se corra.
