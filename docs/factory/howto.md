# How-to — tareas concretas de Fullsite Factory

> Recetas orientadas a una tarea. Suponen los PRs del programa aplicados en el entorno donde
> operas (hoy: **ninguno desplegado** — ver [`README.md`](README.md)). Placeholders:
> `<tenant>` = client_id, `<sucursal>` = location_id, `<ADMIN>` = admin de plataforma con 2FA.
> Nunca pegues PIN, tokens ni códigos en un chat, log o commit.

## Crear un cliente y sus sucursales

1. **Cliente.** `provisionTenant()` (`dashboard-app/src/lib/provision-tenant.ts`) es idempotente
   y service-role: siembra `clients`, `client_locations` (una "Principal"), menú/pagos/staff/
   mesas base. Re-ejecutar con el mismo `<tenant>` no duplica.
2. **Sucursales adicionales.** Inserta en `client_locations` (`id`, `client_id`, `name`,
   `active`) — el `id` debe ser único por tenant. El wizard reanudable (#202) orquesta este paso
   cuando `factory.wizard_resumable` está encendido; ver [`tutorial-instalacion.md`](tutorial-instalacion.md).
3. **Verifica.** `GET /api/platform/locations?clientId=<tenant>` devuelve las sucursales activas.

## Enrolar un equipo (terminal) — la plataforma genera la identidad

> El dispositivo **no** elige su `device_id`. Flujo enroll→claim (ADR-0002/0003).

1. **Alta (admin).** `POST /api/platform/terminals` con `{ clientId:<tenant>, location_id:<sucursal>,
   role?, label? }`. Responde `{ device_id, enrollment_code, expires_at }`. El **código se
   muestra una vez** — no se vuelve a mostrar ni se persiste en claro.
2. **Provisiona la caja.** En la terminal, abre el wizard del Electron y canjea el código:
   `POST /api/platform/terminal-claim` con `{ code }` → devuelve la identidad asignada.
3. **Config sin teclear (opcional).** `POST /api/platform/terminal-config` con
   `{ clientId, locationId, role, bridgeHost? }` genera `config.json` + deep-link para el wizard.
4. Un código **vencido, reusado o de otra sucursal** falla cerrado (400). Re-emite desde el paso 1.

## Configurar KDS e impresoras por sucursal

1. **Estaciones de la sucursal.** Declara filas en `pos_location_stations` (`station ∈
   {cocina,barra,caja}`, `has_kds_screen`, `prints`, `category_overrides`). Sin filas → routing
   legacy (default de sistema).
2. **Routing.** `resolveStationForLocation({categoryId,itemName}, config)` decide la estación;
   enciende `factory.stations_per_location` para que se consulten los overrides.
3. **KDS aislado.** El KDS debe enviar `location_id` y `shift_id` a
   `GET /api/pos/kitchen` (gate `factory.kds_location_scope`). Verifica que la respuesta sólo
   trae la sucursal/turno pedidos (la proyección incluye `location_id/turno_id`).
4. **Impresoras.** El adapter ESC/POS (`electron-app/local-server/adapters/printer.js`) enruta
   por estación. La autoconfig (#204) **propone** impresoras con confidence; **confirma antes de
   guardar** y usa fallback manual si la confianza es baja.

## Abrir/cerrar turno y corte Z

1. **Abrir turno.** Un turno `abierto` por `(<tenant>, <sucursal>)` — el índice único parcial lo
   garantiza (#200). Si ya hay uno abierto, ciérralo antes.
2. **Corte X** (parcial, en vivo): `app/pos/turno`. **Corte Z / cierre**: `CierreCajaWizard`
   (arqueo con `pos-arqueo.ts`, GUARD-08 para órdenes abiertas).
3. **Recuperación admin.** Un cierre bloqueado se resuelve marcando `status='forzado'` con
   aprobación. **No** se borra historial ni se reinician folios.

## Ejecutar las pruebas (offline y de programa)

```bash
# Suite de dashboard (vitest) — desde dashboard-app/
bun install && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run
# Pruebas del local-server (node --test) — desde la raíz
node --test electron-app/local-server/tests/latency-metrics.test.js
# Reporte de latencia offline desde un JSONL de muestras (reproducible)
node electron-app/local-server/telemetry/latency-harness.js muestras.jsonl reporte.json
```
Ver [`referencia.md`](referencia.md) §7 para el formato de muestras. Sin muestras, el reporte
devuelve `null` (no inventa números).

## Soporte remoto seguro

1. `GET /api/platform/support/action` lista la **allowlist** (lo único ejecutable).
2. El cliente concede consentimiento temporal (`pos_settings['support.consent'] = {expiresAt}`).
3. `POST /api/platform/support/action` `{ clientId, actionId }` — RBAC 2FA + consentimiento
   vigente + auditoría. Fuera de la allowlist → 400. Sin consentimiento → 403. **Nunca hay shell.**

## Rollback de un PR del programa

- Cada PR es revertible con `git revert`. Ninguno cambia comportamiento en producción con su
  flag apagado (default), así que revertir es seguro.
- Migraciones: aditivas; el down documentado (drop de columnas/constraints/índices que agrega)
  está en el cuerpo del PR y en `README-pos-terminals-endurecimiento.md`. **No aplicadas a
  remoto**, así que hoy "rollback" = cerrar/revertir el PR.
