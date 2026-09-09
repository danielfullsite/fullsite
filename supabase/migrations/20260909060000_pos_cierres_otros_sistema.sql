-- APLICADA EN PRODUCCION (AMALAY) el 2026-09-09 via MCP, migracion
-- `pos_cierres_otros_sistema`. Este archivo la deja en el repo para que un
-- tenant nuevo nazca con la columna.
--
-- El corte guardaba tres cubetas de venta: efectivo, tarjeta y transferencias.
-- Todo lo demas del catalogo -- plataformas (Rappi/Uber/DiDi) y "other"
-- (cortesias, vales, venta a terceros) -- se sumaba dentro de `tarjeta_sistema`,
-- que es justo el numero que se concilia a mano contra la terminal bancaria.
-- Nunca iba a cuadrar, y la diferencia quedaba sin dueno.
--
-- Columna ADITIVA y NULLABLE: el codigo desplegado hoy no la escribe y sigue
-- funcionando igual. NULL significa "cierre anterior al desglose", no cero.
alter table public.pos_cierres
  add column if not exists otros_sistema numeric;

comment on column public.pos_cierres.otros_sistema is
  'Ventas cobradas con formas que no son efectivo, tarjeta/terminal ni transferencia: plataformas de delivery, cortesias, vales, venta a terceros. NULL = cierre anterior a que existiera el desglose.';
