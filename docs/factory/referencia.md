# Referencia técnica — Fullsite Factory

> Contratos, APIs, feature flags y schemas. Cada entrada cita `archivo:símbolo` y su PR. Estado
> de todo lo de aquí: **Implementado · Probado localmente** (ver [`README.md`](README.md)).

## 1. Envelope de eventos v2 (contrato transversal)

`dashboard-app/src/lib/events/envelope.ts` · PR [#197](https://github.com/danielfullsite/fullsite/pull/197)

Todo evento operativo porta **tenant + location + device + shift**. Falla cerrado.

```ts
interface EventEnvelopeV2 {
  envelopeVersion: 2
  id: string            // idempotente = command_id del terminal
  type: string
  typeVersion: number
  occurredAt: string
  actor: { userId: string; deviceId: string }
  scope: { clientId: string; locationId: string; shiftId: string }
  payload: Record<string, unknown>
  audit?: { approvedBy: string; reason?: string }
}
```

- `buildEnvelope(input)` — lanza `EnvelopeInvalido` si falta tenant/location/device/shift, o si
  un evento sensible (`SENSITIVE_EVENT_TYPES`) viene sin `audit.approvedBy`.
- `isEnvelopeV2(o)` — valida en la frontera. `toEventsRow(e)` — proyecta a columnas de `events`.
- **Nota de estado:** la tabla `events` de `origin/main` **aún no** tiene `client_id/location_id/
  shift_id`; persistirlos + cerrar su RLS es un PR stacked posterior (ver [ADR-0007](adr.md)).

## 2. Modelo de dispositivos y enrolamiento

PR [#195](https://github.com/danielfullsite/fullsite/pull/195). La **plataforma genera la
identidad**; el dispositivo nunca elige `device_id/client_id/location_id`.

### Schema

`pos_terminals` (extendida, aditiva) — `20260827120000_pos_terminals_por_sucursal.sql`
- PK `(client_id, device_id)`. Columnas nuevas: `location_id` (nullable, transición),
  `role`, `station`, `server_device_id`, `channel`, `app_version`, `status`, `metadata jsonb`.
- FK compuesto `(client_id, location_id) → client_locations(client_id, id)`.
- FK auto `(client_id, server_device_id) → pos_terminals(client_id, device_id)`.
- RLS fail-closed: SELECT por tenant (`private.user_has_client_access`); escritura sólo
  `service_role`; sin `anon`. `metadata` con CHECK (whitelist de llaves, escalares, ≤4KB).

`pos_terminal_enrollments` (nueva) — `20260827130000_pos_terminal_enrollments.sql`
- `code_hash` **único** (sha256 del código; el código en claro nunca se persiste), `expires_at`,
  `claimed_at`, `device_id`, bindings `(client_id, location_id, role, label)`. FK compuesto a
  `client_locations`. RLS fail-closed **sin política** (sólo `service_role`).

### APIs (`dashboard-app/src/app/api/platform/…`)

| Ruta | Método | Contrato |
|---|---|---|
| `terminals/route.ts` | GET | `?clientId` → `{ terminals }` (incluye legacy con `location_id` NULL) |
| `terminals/route.ts` | POST | `{ clientId, location_id, role?, label?, metadata? }` → `{ device_id, enrollment_code, expires_at }`. **`device_id` en el body → 400** |
| `terminals/route.ts` | PATCH | `{ clientId, device_id, active }` → toggle. Rechaza cambiar `client_id/device_id/location_id` |
| `terminal-claim/route.ts` | POST | `{ code }` → `{ device_id, client_id, location_id, role, label }`. Canje atómico de un solo uso; inválido/vencido/usado → 400 genérico |
| `terminal-config/route.ts` | POST | `{ clientId, locationId, role, name?, bridgeHost? }` → `{ config, deepLink }`. Exige y valida sucursal del tenant |
| `locations/route.ts` | GET | `?clientId` → `{ locations }` (sucursales activas del tenant) |

## 3. Estaciones y routing por sucursal

PR [#198](https://github.com/danielfullsite/fullsite/pull/198) · flag `factory.stations_per_location`

`pos_location_stations` (nueva) — `20260827140000_pos_location_stations.sql`
- PK `(client_id, location_id, station)`; `station ∈ {cocina,barra,caja}`; `has_kds_screen`,
  `prints`, `category_overrides jsonb`, `sort`. FK compuesto a `client_locations`. RLS
  fail-closed (SELECT por tenant, sin `anon`). CHECK de overrides (sólo estaciones válidas, ≤8KB).

`dashboard-app/src/lib/station-routing-location.ts`
- `resolveStationForLocation({categoryId, itemName}, config?)` — determinista. **Sin config →
  idéntico a `getStationForItem` (legacy)**. Con config: override de sucursal → default de
  sistema → pliega a una estación presente (orden fijo).
- `buildLocationStationConfig(rows)` — proyecta las filas a la config; filas vacías → `null`.

## 4. KDS aislado por sucursal y turno

PR [#199](https://github.com/danielfullsite/fullsite/pull/199) · flag `factory.kds_location_scope`

`dashboard-app/src/app/api/pos/kitchen/route.ts` — GET acepta `location_id` y `shift_id`;
cuando se envían, filtra en la base (`location_id=eq`, `turno_id=eq`). Sin ellos: legacy
tenant-wide. `status=in.(enviada,preparando,lista)` excluye cerrada/cancelada (histórico no
reaparece). La proyección incluye `location_id`/`turno_id` para verificar en el cliente.

## 5. Turnos por sucursal + corte Z

PR [#200](https://github.com/danielfullsite/fullsite/pull/200). `pos_turnos` (extendida) —
`20260827150000_pos_turnos_por_sucursal.sql`
- Agrega `status` (`abierto|cerrado|forzado`, derivado de `closed_at` para legacy) y
  `location_id` (nullable). FK compuesto a `client_locations`. **Índice único parcial**: a lo
  sumo un turno `abierto` por `(client_id, location_id)`. **No borra historial, no reinicia
  folios** (no toca `pos_cfdi_requests` ni secuencias). No toca la RLS existente.

## 6. Interfaces de plataforma

| Capacidad | Ruta | Flag | Contrato clave |
|---|---|---|---|
| Wizard reanudable (#202) | `platform/onboarding-progress/route.ts` (GET/PUT) | `factory.wizard_resumable` | Progreso en `pos_settings['onboarding.progress']`; **PUT rechaza secretos** (400); idempotente |
| Soporte (#203) | `platform/support/action/route.ts` (GET/POST) | `factory.support_console` | Allowlist de acciones; consentimiento temporal; RBAC 2FA; audit; **sin shell** |
| Autoconfig (#204) | `platform/hardware/propose/route.ts` (POST) | `factory.autoconfig` | Evidencia → propuesta con confidence topado (<1.0); confirmación + fallback manual; stateless |
| Fullsite IQ (#205) | `platform/iq/propose/route.ts` (GET/POST) | `factory.iq_proposals` | Casos read-only; preview/diff; `autonomous:false`; audit de la generación |

`dashboard-app/src/lib/`: `onboarding-wizard.ts`, `support-actions.ts`, `hardware-capabilities.ts`,
`iq-proposals.ts` (motores puros).

## 7. Offline — métricas de latencia

PR [#201](https://github.com/danielfullsite/fullsite/pull/201) · flag `FACTORY_OFFLINE_METRICS`
- `electron-app/local-server/telemetry/latency-metrics.js` — motor puro: tramos `pos_to_kds`,
  `kds_to_print`, `pos_to_print`; p50/p95/p99 por rango-más-cercano; sin muestras → `null`.
- `…/telemetry/latency-harness.js` — JSONL de muestras → reporte (formato `soak-report.json`).

## 8. Feature flags (convención `factory.*`)

Se evalúan con `dashboard-app/src/lib/platform-config.ts` (`isEnabledForTenant`), tabla
`feature_flags`. Todos **apagados por default** → comportamiento legacy.

| Flag | PR | Enciende |
|---|---|---|
| `factory.stations_per_location` | #198 | Routing por overrides de sucursal |
| `factory.kds_location_scope` | #199 | KDS envía `location_id`/`shift_id` |
| `factory.wizard_resumable` | #202 | El wizard usa el endpoint de progreso |
| `factory.support_console` | #203 | Consola de soporte |
| `factory.autoconfig` | #204 | Autoconfiguración de hardware |
| `factory.iq_proposals` | #205 | Propuestas de IQ |
| `FACTORY_OFFLINE_METRICS` | #201 | Recolección de latencia (env del local-server) |
