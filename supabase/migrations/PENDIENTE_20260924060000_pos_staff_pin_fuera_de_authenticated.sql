-- PENDIENTE: NO aplicada. Requiere autorización de Daniel y el camino normal de migraciones.
-- Probada solo en un Postgres 16 desechable con roles simulados (ver informe PR3, §6 y el log
-- PR3-SECRET_AND_PIN_CONTAINMENT-migracion-postgres.log). Contención V-A18 / revisión PR3 H-4.
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────────
--
-- PR3 quitó `pin` de GET /api/owner/staff y /api/platform/staff, pero la causa raíz está en la
-- base: `GRANT ALL ON pos_staff TO authenticated` (baseline:9901) + las políticas
-- `pos_staff_sel/ins/upd` (baseline:8087-8102, USING user_has_client_access(client_id)).
-- Cualquier usuario del dashboard con membresía en el tenant — sin importar su rol en
-- client_users — puede, con su JWT (supabase-fetch-patch lo inyecta):
--     GET   /rest/v1/pos_staff?select=name,pin           → leer todos los PIN
--     GET   /rest/v1/pos_staff?pin=eq.1234&select=id     → usar el PIN como oráculo
--     PATCH /rest/v1/pos_staff?id=eq.<gerente> {pin}     → reescribir el PIN de un gerente
--     POST  /rest/v1/pos_staff {role:'admin', pin}       → crearse un admin con PIN propio
-- y con ese PIN entrar al POS como gerente/admin.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────
--
-- En Postgres un privilegio a nivel TABLA no se recorta revocando columnas sueltas: hay que
-- revocar el privilegio de tabla y otorgar la lista de columnas. Para `authenticated`:
--   · SELECT: todas las columnas MENOS pin (y pin_hash/pin_hash_v si ya existen: no se
--     otorgan, así que quedan fuera automáticamente).
--   · UPDATE: solo name, active, hourly_rate, weekly_salary. NI `role` NI `role_display`
--     (re-revisión PR3, N-2): con UPDATE(role) cualquier usuario del dashboard ascendía a
--     `admin` una fila cuyo PIN conoce (la suya) y entraba al POS como admin. Los cambios de
--     rol van por /api/owner/staff (service_role, con jerarquía canAssignRole).
--   · INSERT: revocado. Crear personal es escribir un PIN; el único camino es la API
--     (/api/owner/staff, service_role, con jerarquía de roles y pinTaken).
--   · DELETE: sin cambio (no toca el PIN).
-- `service_role` (APIs del servidor, Pedro vía API) no cambia.
--
-- ── INVENTARIO DE LECTORES/ESCRITORES DESDE EL NAVEGADOR (2026-09-24, rama PR3) ──
--
--   Compatible (no piden pin):
--     src/app/admin/exportar/page.tsx:19          select=id,name,role,active
--     src/app/pos/configuracion/page.tsx:255      select=id,name,role,active
--     src/lib/pos-data.ts:1493 (fetchMeseros)     select=name
--   Pasan por el servidor (service_role, no les afecta):
--     /api/owner/staff (GET/POST/PATCH), /api/platform/staff, /api/pos/pin, /api/pos/staff,
--     /api/pos/db (proxy del kiosco; ya redacta `pin`), /api/backup, /api/platform/export.
--     Kiosco/offline: supabase-fetch-patch manda el REST del POS a /api/pos/db (service_role);
--     pos_staff_cache y pos_manager_pin_cache (pos/layout.tsx, pos-data.ts) guardan HASH del
--     PIN que devuelve /api/pos/pin, no leen la tabla.
--   Se rompen (y por qué está bien):
--     src/lib/backup.ts (createBackup, select=* sobre pos_staff): código muerto — ningún
--       archivo lo importa salvo su prueba (formatBytes). `select=*` con privilegios por
--       columna da 42501. Si se revive: usar /api/backup (ya excluye pin) o select explícito.
--     src/app/admin/onboarding/page.tsx:63 (POST pos_staff con pin): wizard viejo; el que
--       redirige es src/app/onboarding/page.tsx, pero admin/onboarding sigue alcanzable por URL
--       (nada lo enlaza). Su POST ya fallaba por RLS de clients y ahora también por privilegio.
--     public/sw.js:41 cachea /rest/v1/pos_staff: las respuestas YA cacheadas (con pin, si alguna
--       vez se pidió) no se invalidan con esta migración → subir la versión de la caché del SW
--       al desplegar (re-revisión N-3).
--   Otros roles NO tocados aquí (anotado, fuera de alcance):
--     anon: SELECT de tabla sin política RLS → 0 filas (ver nota 2 de
--       PENDIENTE_20260914120000_pos_staff_pin_hash.sql; mobile-app/LoginScreen ya está muerto).
--     fullsite_readonly, fullsite_agent: SELECT de tabla (incluye pin). Merecen su propio PR.
--
-- ── DEPENDENCIAS ───────────────────────────────────────────────────────────────
--   · Compatible con PENDIENTE_20260914120000_pos_staff_pin_hash.sql en cualquier orden: si
--     pin_hash se agrega DESPUÉS, authenticated no lo recibe (no hay privilegio de tabla).
--   · Toda columna NUEVA de pos_staff que el navegador deba leer necesita su GRANT explícito.
--   · Requiere que ninguna pantalla con sesión de dashboard dependa de `select=*` ni de
--     `Prefer: return=representation` sobre pos_staff (inventario de arriba: ninguna viva).
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────────
--   begin;
--   revoke select, update on public.pos_staff from authenticated;
--   grant all on table public.pos_staff to authenticated;
--   commit;

begin;

revoke select, insert, update on table public.pos_staff from authenticated;

grant select (id, client_id, name, role, role_display, active, created_at, hourly_rate, weekly_salary)
  on table public.pos_staff to authenticated;

grant update (name, active, hourly_rate, weekly_salary)
  on table public.pos_staff to authenticated;

commit;
