-- PENDIENTE: requiere decision de Daniel (produccion tiene filas que violan la
-- regla; por eso la restriccion entra NOT VALID: protege lo nuevo sin tocar lo viejo).
--
-- Origen: lente de datos reales del 2026-09-11 (docs/audit/BARRIDO3-2026-09-11.md).
--
-- (1) 33 turnos de AMALAY quedaron "cerrados" con el mismo closed_at
--     (2026-09-01 02:07:00.918) por un cierre masivo; 11 de ellos con
--     closed_at < opened_at. Un turno no puede cerrarse antes de abrirse.
alter table public.pos_turnos
  add constraint pos_turnos_closed_after_opened
  check (closed_at is null or closed_at >= opened_at) not valid;

-- (2) La misma reconciliacion descontó dos veces el mismo insumo (9 casos de
--     julio de 2026). r1_reconcile_item escribe una fila por (reconciliacion,
--     insumo, revision); dos filas iguales son un doble descuento. Indice unico
--     PARCIAL sobre lo nuevo: las filas historicas duplicadas se conservan
--     (limpiarlas es una decision aparte, con recipe_reversal ligado al mismo
--     recon), y a partir de aqui el duplicado falla en la base.
create unique index if not exists pos_inventory_movements_recon_unica
  on public.pos_inventory_movements (reconciliation_result_id, ingredient_id, mutation_revision)
  where reconciliation_result_id is not null
    and mutation_revision is not null
    and created_at >= '2026-09-12';

-- (3) Consulta guardian (solo lectura) para CI o para el corte de soporte:
--   select count(*) from pos_inventory_movements m
--   left join pos_orders o on o.id = m.order_id::text
--   where m.order_id is not null and o.id is null;
-- Debe ser 0 en un tenant sano; hoy en AMALAY es 693 porque se borraron
-- pos_orders de pruebas sin cascada. Eso no lo arregla una migracion: es una
-- limpieza con respaldo y conteo fisico.
