# Fullsite Factory — plan maestro de integración

> Programa único que integra 8 capacidades para operar y clonar restaurantes. **Coordinado en
> paralelo, nunca en un mega-PR.** PRs pequeños encadenados, cada uno con dependencia,
> evidencia, rollback y "qué NO se desplegó".
>
> Levantado el 2026-08-27 tras inspeccionar el repo con 4 agentes paralelos + verificación
> directa contra `origin/main`. Base de arquitectura: **PR #195 (modelo de dispositivos por
> sucursal) sigue sin merge — no se asume desplegado.**

## Principio que cambió el plan

La inspección encontró que **casi todo ya está construido**. El Factory NO es greenfield: es
**cerrar gaps, aislar por `location`, y agregar rieles de seguridad** (preview/diff, confidence,
reanudabilidad) sobre lo que existe. Cada programa abajo lista lo que YA existe (con
archivo:línea) antes de lo que falta, para no reconstruir.

## Reglas de coordinación (no negociables)

1. No tocar producción ni AMALAY. Único remoto de inspección: staging `<STAGING_PROJECT_REF>`,
   **solo lectura** hasta revisión explícita. Sin merge/deploy/migración remota sin aprobación.
2. No tocar el worktree de Codex `/.codex/worktrees/electron-amalay-qa` ni sus cambios sin commit
   (contiene el fix de `data.ts` multisucursal, que aterriza por su PR; ver #194).
3. Migraciones **aditivas e idempotentes**. Legacy compatible. RLS **fail-closed**.
4. Cada PR: una capacidad, rama propia, base declarada, tests proporcionales al riesgo.

## Contratos transversales (keystone — PR-0)

Todo evento operativo debe portar **tenant + location + device + shift**. Estado real:

| Contrato | Hoy en `origin/main` | Acción |
|---|---|---|
| `events` envelope | `actor{userId,deviceId}` + `payload` + `audit`; **sin `client_id`/`location`/`shift`** y con fuga RLS `qual=true` | **Extender** el envelope (device ya está) + cerrar RLS en PR aparte |
| `pos_orders` | ya tiene `location_id` y `turno_id` (CHECK `orders_require_turno`) | Reusar como fuente de verdad |
| `feature_flags` | operativo (`platform-config.ts`, `isEnabledForTenant`, cohortes) | Convención de claves `factory.*` |
| Identidad de dispositivo | PR #195 (`pos_terminals` + enroll/claim) | Base del binding device→location |

**PR-0 entrega:** este documento + `lib/events/envelope.ts` (contrato versionado v2 con
tenant+location+device+shift, builder y validador puros) + convención de flags. Es additivo y no
conflictúa con nadie. La migración que persiste esos campos en `events` y cierra su RLS va como
PR stacked, revisado aparte (toca una tabla compartida con fuga conocida).

## Las 8 capacidades — YA EXISTE / GAP / PR

### 1. KDS, impresoras y estaciones por sucursal  · camino crítico
- **YA EXISTE:** routing por estación (`lib/pos-constants.ts` `getStationForItem`/`resolveItemStation`),
  split e impresión multi-estación (`lib/printer.ts` `splitOrderByStation`, slots cocina/barra/caja),
  comanda batch-aware (`comanda_batch_id`), KDS (`app/kds/page.tsx`) + endpoint
  (`api/pos/kitchen`), settings `pos.kds_stations`/`pos.no_print_stations`, tests
  (`station-routing.test.ts`, `pos-kds.test.ts`). #164 cierra el token de cocina fail-closed.
- **GAP:** el routing y el KDS **no filtran por `location_id`** — dos sucursales del mismo tenant
  verían comandas cruzadas. Falta aislamiento tenant+location+shift en la lectura y prueba
  anti-cruce.
- **PR-1** `factory/estaciones-routing` (stacked sobre #195): estaciones ligadas a `location_id`,
  routing resuelto por (categoría/rol/**location**), migración aditiva. **PR-2** `factory/kds-aislamiento`:
  `api/pos/kitchen` filtra por location+shift; prueba de 2 sucursales sin comandas cruzadas.

### 2. Autoconfiguración
- **YA EXISTE:** descubrimiento mDNS (`electron-app/local-server/discovery/mdns.js`), adapter
  ESC/POS config-driven con cola NDJSON persistente y auto-recuperación
  (`adapters/printer.js`), heartbeat de flota (`telemetry/heartbeat.js`).
- **GAP:** USB/HID, **confidence score**, propuesta explicable + confirmación humana, catálogo
  de drivers por capacidades, fallback manual UI. **Nunca afirmar 100% para hardware desconocido.**
- **PR-9** `factory/autoconfig-interfaz`: contrato `DiscoveryResult{capability, confidence,
  evidence, proposal}` + adapters por capacidad, **sin** tocar el driver Windows existente.

### 3. Plantilla clonable / wizard
- **YA EXISTE:** `provisionTenant()` idempotente service-role (8+2 tablas, IDs deterministas),
  `scripts/bootstrap_client.py`, `seeds/_lib/seed-restaurant.ts`, wizard cliente 6 pasos
  (`app/onboarding/page.tsx`). #173 cloneability bootstrap.
- **GAP:** wizard **no reanudable**, sin orquestación marca→sucursal→dispositivos→impresoras→prueba,
  sin lado plataforma. Objetivo: operación básica < 60 min, sin secretos exportados.
- **PR-11** `factory/wizard-reanudable`: estado del wizard persistido + idempotente; encadena
  provisionTenant → client_locations → enroll (#195) → prueba de impresión (Programa 1).

### 4. Offline inmediato
- **YA EXISTE:** Pedro (7717, event store `events.ndjson` durable, idempotencia, WS hub, mDNS),
  outbox `core/outbox.js` (shadow mode), IndexedDB v4 (`pos-offline-db.ts`, cola durable +
  print_jobs + turnos/cash offline), SW v21, conflictos clasificados
  (STALE_WRITE/TRANSIENT/TERMINAL con payload preservado). Docs: `OFFLINE-GAP-001.md`,
  `TEST-MATRIX.md` (23 escenarios).
- **GAP:** schema `pos_local_events` no aplicado, outbox en shadow, **sin métricas p50/p95**,
  0/23 certificados, arranque frío sin WAN abierto (P1-4).
- **PR-12** `factory/offline-metricas-soak`: harness p50/p95 sobre soak/twin existentes (sin
  reimplementar outbox), umbrales, sin CI de deploy. Activar outbox = decisión con aprobación.

### 5. Turnos / corte Z
- **YA EXISTE:** `pos_turnos`, `pos_staff_shifts`, `pos_cash_movements`, `pos_cierres`,
  `pos_cfdi_requests` (todas en baseline), `pos_orders.turno_id` NOT NULL con CHECK, wizard de
  cierre (`CierreCajaWizard.tsx`), fórmula de arqueo (`pos-arqueo.ts`), GUARD-08 con escalation
  (`pos-cierre-guard.ts`), corte X live (`app/pos/turno`).
- **GAP:** `pos_turnos` **sin `location_id` ni `status/active`**, `client_id` nullable, **sin FK**
  desde `pos_orders.turno_id`; falta "una caja/turno activo según reglas", corte Z endpoint,
  bloqueo seguro + recuperación admin. **No reiniciar folios fiscales.**
- **PR-3** `factory/turnos-corte-z`: migración aditiva (location_id, status, FK, unicidad de turno
  activo por caja/location); KDS sólo muestra turno operativo; historial intacto.

### 6. Centro de soporte
- **YA EXISTE:** `/api/health`, `local_server_heartbeats`, 3 audit logs inmutables
  (agent/platform/pos), logs sanitizados en el proxy, `requirePlatformAdmin2FA`.
- **GAP:** dashboard unificado health/version/network/queues/printers/KDS, diagnósticos, acciones
  remotas **con consentimiento + acceso temporal + RBAC + MFA/auditoría**. Nada de shell remoto
  arbitrario ni credenciales visibles.
- **PR-13** `factory/soporte-interfaz`: agrega vista de flota sobre datos existentes + contrato de
  acción remota con consentimiento (sin ejecutar acciones destructivas todavía).

### 7. Skeleton multisucursal
- **YA EXISTE:** `AuthContext` carga `locations` + selector, `app/sucursales/page.tsx`,
  `getActiveClientSlug()`, `clients.data_source` (demo/wansoft/fullsite). #174 demo-diezmex.
  **`<ADMIN_EMAIL>` NO está hardcodeado** (super-admin por 2FA) ✓.
- **GAP:** home grupo/marca/sucursal, selector global visible, **provenance/freshness/real-vs-demo
  por fila**, cero alertas inventadas. Admin multisucursal por **permisos**, nunca email hardcodeado
  (hay un `<DEMO_EMAIL>` fallback en `client-config.ts:173` a documentar).
- **PR-14** `factory/skeleton-provenance`: etiquetado demo/real + freshness en las lecturas
  existentes; selector global; sin inventar alertas.

### 8. Fullsite IQ
- **YA EXISTE:** ~15 agentes (`.github/scripts/*.py`), whitelist de 23 tablas
  (`lib/pos-db-policy.ts`), copiloto (`lib/copilot.ts`: lectura auto, acciones con confirmación),
  execute gate 2FA (`api/platform/copiloto/execute`), rate limit + `platform_audit_log`
  (`lib/platform-writes.ts`), `agent_events` con confidence/outcome.
- **GAP:** **preview/diff** antes de ejecutar, herramientas allowlisted por caso, confirmación +
  audit log por acción. Empezar read-only por: agotados, precios, costos cero, turnos abiertos,
  anomalías. **Nada de compras/precios/horarios autónomos todavía.**
- **PR-15** `factory/iq-preview-diff`: capa read-only + acción propuesta con preview/diff sobre el
  copiloto existente; allowlist por caso; sin acción autónoma.

## DAG y camino crítico

```
                         PR-0 contratos (envelope v2 + doc + flags)   ← keystone, base origin/main
                          │         (no bloquea a #195; lo consumen todos)
   #195 device model ─────┼─────────────┐
     (en revisión)        │             ▼
        │                 │        PR-3 turnos/corte-z (location+status+FK)
        ▼                 │             │
   PR-1 estaciones/routing por location │
        │                               │
        ▼                               ▼
   PR-2 KDS aislamiento ───────► (evento de comanda con tenant+location+device+shift)
                                        ▲
   PR-12 offline métricas/soak ─────────┘   (se cruzan en el evento → PR-0 primero)

   interfaces no conflictivas (contratos primero, sin lógica de negocio, en paralelo):
   PR-9 autoconfig · PR-11 wizard · PR-13 soporte · PR-14 skeleton · PR-15 IQ
```

**Camino crítico:** `#195 → PR-1 → PR-2`, con `PR-3` y `PR-12` en paralelo, todos consumiendo el
envelope de PR-0.

## Mapa de PRs

| PR | Rama | Base | Depende de | Estado |
|---|---|---|---|---|
| PR-0 | `factory/contratos-y-plan` | `origin/main` | — | **este PR** |
| PR-1 | `factory/estaciones-routing` | rama #195 | #195, PR-0 | siguiente |
| PR-2 | `factory/kds-aislamiento` | rama PR-1 | PR-1 | encadenado |
| PR-3 | `factory/turnos-corte-z` | `origin/main` | PR-0 | paralelo |
| PR-12 | `factory/offline-metricas-soak` | `origin/main` | PR-0 | paralelo |
| PR-9/11/13/14/15 | `factory/{autoconfig,wizard,soporte,skeleton,iq}-interfaz` | `origin/main` | PR-0 | paralelo, interfaces |

## Ownership (para no chocar)

- **Codex:** `data.ts`, `seeds/`, negocio de `client_locations`, worktree `electron-amalay-qa` (intocable).
- **Factory (yo):** `events` envelope, estaciones/routing por location, KDS, turnos extendido,
  offline métricas, e interfaces de wizard/soporte/skeleton/IQ. Dominios compartidos (`events`,
  `feature_flags`) sólo se **extienden aditivamente**.

## Criterio 10/10 por PR

1. Rama desde la base correcta; sin mega-PR. 2. Migración aditiva + idempotente; legacy compatible.
3. RLS fail-closed con prueba de aislamiento (2 tenants × 2 sucursales). 4. Evento con
tenant+location+device+shift. 5. Sin PII/secretos en logs. 6. Tests proporcionales
(unit/integration; e2e/soak/chaos donde el riesgo lo pida). 7. Datos demo etiquetados y aislados.
8. Responsive iPhone/iPad/desktop + accesibilidad + latencia medible. 9. tsc + lint + build verdes.
10. Sin merge/deploy/migración remota; rollback documentado.
