# Fullsite Factory — coordinación de agentes

## Fuente de verdad actual

- Worktree: `/Users/danielrg/fullsite/.codex/worktrees/electron-amalay-qa`
- Rama: `codex/electron-amalay-qa`
- Este worktree contiene cambios sin integrar. Inspeccionarlo es seguro; no editarlo desde otros agentes.
- Producción `fullsite-amalay` está fuera de alcance. Toda prueba se ejecuta en staging/sandbox.

## Propiedad de trabajo

### Codex principal

- Dashboard y comparativo multisucursal.
- `dashboard-app/src/lib/data.ts`.
- Seed y cuenta Diezmex.
- Auditoría de aislamiento tenant/location.
- Calidad y guion del demo.

### Claude

- Modelo de dispositivos por sucursal.
- `/platform/terminales` y configuración de terminales.
- Pruebas de aislamiento multisucursal que no existan.
- KDS, estaciones e impresoras por sucursal después del modelo de dispositivos.

## Reglas de integración

1. Claude debe crear un worktree propio desde el estado integrado más reciente; nunca editar el worktree de Codex.
2. Antes de abrir un PR, comparar contra este archivo y contra los PR abiertos para evitar duplicados.
3. Un PR debe cubrir un solo bloque funcional, incluir migración, RLS, pruebas y rollback cuando corresponda.
4. No integrar código duplicado en `data.ts`, `seeds/run.ts` o `seeds/_lib/supabase.ts`.
5. Ningún config, QR o deep link puede contener `service_role`.
6. Toda fila operativa nueva debe quedar ligada a `client_id` y, cuando sea física, a `location_id`.
7. Diezmex sólo es fixture de sandbox; AMALAY no se toca.

## Primer bloque asignado a Claude

Entregar el modelo de dispositivos por sucursal:

- Migración para dispositivos con `client_id`, `location_id`, `device_id`, nombre, rol, estación, servidor, canal/versión, estado, última conexión y metadata no sensible.
- Llaves foráneas e índices.
- RLS fail-closed y APIs server-side que deriven tenant desde la sesión.
- Pruebas de dos tenants, dos sucursales y rechazo de cambio de tenant.
- Extender terminal config para exigir `location_id`, sin incluir secretos globales.
- No implementar todavía UI de impresoras ni autoconfiguración; ésos serán PR separados.

## Criterio de aceptación del primer bloque

- Provisionamiento idempotente.
- Una terminal no puede leer ni registrarse en otro tenant/sucursal.
- Repetir la solicitud no duplica el dispositivo.
- Build, pruebas y typecheck verdes.
- Documentación del rollback y riesgos pendientes.
