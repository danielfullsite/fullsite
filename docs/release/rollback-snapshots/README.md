# BUG-019 — Rollback snapshots (producción qjiomlvudfmzuvqvhwpk)

Snapshot capturado read-only INMEDIATAMENTE antes del deploy de BUG-019 a prod,
como artefacto de rollback verificable. Contiene el estado EXACTO de policies
(permisivas anon `using(true)`) de las tablas tenant ANTES del fix.

- `prod-policies-pre-bug019.json` — pg_policies de todas las tablas con client_id.

Uso: si `BUG-019-ROLLBACK.sql` no bastara, este snapshot permite reconstruir las
policies exactas previas. El rollback restaura la superficie INSEGURA anterior
(ver advertencia en el reporte de deploy).
