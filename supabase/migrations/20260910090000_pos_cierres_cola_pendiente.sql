-- YA EXISTE EN PRODUCCION (AMALAY): la columna se agrego por MCP (commit f655123f)
-- y nunca entro al repositorio. Este archivo la deja donde tiene que estar para que
-- un tenant nuevo, staging y cualquier entorno nacido de supabase/migrations la
-- tengan. `add column if not exists` hace que sea inocua en AMALAY.
--
-- ── POR QUE ES P0 (barrido 2026-09-10) ────────────────────────────────────────
--
-- CierreCajaWizard escribe `cola_pendiente_al_cerrar` en cada Corte Z. Donde la
-- columna no existe, PostgREST responde 400 PGRST204 ("Could not find the
-- column"); el wizard lo ignoraba (`/* queued — will sync later */`) y la cola de
-- replay clasifica 400 como terminal, asi que el cierre NUNCA se registraba.
-- Mientras tanto el PATCH a pos_turnos es otra peticion y si entraba: el turno
-- quedaba CERRADO SIN CIERRE, sin folio Z, sin fila en el historial y con el fondo
-- del dia siguiente confrontado contra "primer turno de la vida del restaurante".
-- Un registro de dinero perdido en silencio, en todo entorno salvo AMALAY prod.
--
-- Columna ADITIVA y NULLABLE: NULL significa "cierre anterior a que se midiera
-- la cola", no cero. Con ella viaja tambien la prueba de paridad
-- (dashboard-app/src/__tests__/pos-cierre-fila-cabe-en-la-tabla.test.ts) que
-- compara cada campo que escribe el wizard contra las columnas del esquema.
alter table public.pos_cierres
  add column if not exists cola_pendiente_al_cerrar integer;

comment on column public.pos_cierres.cola_pendiente_al_cerrar is
  'Operaciones que seguian en la cola de sincronizacion de la terminal al momento de cerrar (cobros, retiros, depositos sin subir). NULL = cierre anterior a que se midiera.';
