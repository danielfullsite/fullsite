-- Folio Z consecutivo por cliente (Fase 3, docs/strategy/BIBLE-SQUARE.md).
--
-- Server-side: numera AL INSERTAR, así el orden de la cola offline no importa
-- y no hay huecos por fallas del cliente. Advisory lock por client_id evita
-- carreras entre cajas concurrentes del mismo tenant.
--
-- SIN backfill deliberado: pos_cierres es SEALED (inmutable, w1d_sealed_guard) —
-- los cierres históricos quedan sin folio y la numeración arranca en 1.
--
-- Estado: APLICADA EN STAGING el 2026-08-28 (probada: consecutivo por cliente,
-- sin cruzar tenants). Pendiente de aplicar a PROD con autorización de Daniel.
-- El código (pos/turno) es tolerante: sin la columna, el chip Z no aparece.

alter table pos_cierres add column if not exists folio_z integer;

create or replace function assign_folio_z() returns trigger
language plpgsql as $$
begin
  if new.folio_z is null then
    perform pg_advisory_xact_lock(hashtext('folio_z:' || new.client_id));
    select coalesce(max(folio_z), 0) + 1 into new.folio_z
      from pos_cierres where client_id = new.client_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_pos_cierres_folio_z on pos_cierres;
create trigger trg_pos_cierres_folio_z
  before insert on pos_cierres
  for each row execute function assign_folio_z();
