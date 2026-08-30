# ADRs — decisiones durables de Fullsite Factory

> Cada decisión: contexto, decisión, consecuencias, estado, fecha, y a qué supersede. Formato
> Diátaxis "explicación". Estado de todas: **Aceptada · Implementada · Probada localmente** (no
> desplegada). Fecha de registro: 2026-08-27.

## ADR-0001 — Extender `pos_terminals`, no crear una tabla `devices`

**Contexto.** El "modelo de dispositivos por sucursal" necesitaba una entidad de terminal.
`pos_terminals` ya existía (usada por `/api/platform/terminals` y `/devices`) pero sin migración
commiteada, sin RLS con política y sin `location_id`.

**Decisión.** Extender `pos_terminals` de forma aditiva (capturarla en migración + agregar
columnas + RLS), en vez de una tabla `devices` paralela.

**Consecuencias.** Reuse-first; cero duplicación de la entidad que ya consumen las rutas. La PK
existente `(client_id, device_id)` da idempotencia de enrolamiento gratis. Contra: se hereda el
nombre "terminals" para lo que ahora también es "device".

**Supersede.** La propuesta inicial de PR-1 (tabla `devices`), descartada en revisión. · PR #195.

## ADR-0002 — La plataforma genera la identidad del dispositivo

**Contexto.** El POST de alta aceptaba `device_id` del cliente: un dispositivo podía elegir su
propia identidad (y potencialmente la de otro tenant).

**Decisión.** El servidor genera `device_id`; el dispositivo **nunca** elige `device_id`,
`client_id` ni `location_id`. Un `device_id` en el body se **rechaza** (400).

**Consecuencias.** Identidad no falsificable por el cliente. Requiere el flujo enroll→claim
(ADR-0003). Las filas legacy (device_id elegido por el cliente antes de esto) mantienen un
camino de sólo lectura/toggle explícito y separado.

**Supersede.** El contrato de PR-1 que aceptaba `device_id` del body. · PR #195.

## ADR-0003 — Enrolamiento por código de un solo uso, hasheado

**Contexto.** Si la plataforma genera la identidad, el dispositivo necesita una forma segura de
reclamarla sin credenciales previas.

**Decisión.** Alta (admin) genera un **código de un solo uso**; se persiste **sólo su
`sha256`** (nunca el código en claro) + bindings + expiración corta. `claim` (dispositivo)
canjea el código una vez, en un UPDATE atómico condicionado a `claimed_at IS NULL AND expires_at
> now`. Inválido/vencido/reusado → 400 genérico (no revela la etapa).

**Consecuencias.** Fail-closed; cross-tenant imposible (el binding lo fija el código, no el
body). El código en claro nunca se registra. Contra: un canje perdido no se recupera con el
mismo código (hay que re-emitir) — aceptable para un token de un solo uso.

**Supersede.** — · PR #195.

## ADR-0004 — Migraciones aditivas e idempotentes; legacy compatible

**Contexto.** Producción y AMALAY no se tocan; el clon limpio debe reproducir el schema.

**Decisión.** Toda migración es `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` +
constraints guardadas por `pg_constraint`. Nada de `DROP`/`DELETE`/`TRUNCATE`. Columnas nuevas
nullable (transición). RLS fail-closed. Reversible por `git revert` + down documentado.

**Consecuencias.** Aplicable sobre schema con datos sin romper; reproducible desde clon limpio.
Contra: el endurecimiento (`NOT NULL`, backfill) queda como paso posterior explícito
(ver `supabase/migrations/README-pos-terminals-endurecimiento.md`).

**Supersede.** — · PRs #195, #198, #200.

## ADR-0005 — KDS aislado por sucursal y turno

**Contexto.** `/api/pos/kitchen` filtraba sólo por `client_id`: dos sucursales del mismo tenant
veían comandas cruzadas; sin candado por turno.

**Decisión.** Filtrar por `location_id` y `turno_id` **en la base** cuando el KDS los envía
(gate `factory.kds_location_scope`). El filtro de status excluye cerrada/cancelada; el turno
acota la otra dimensión (histórico no reaparece).

**Consecuencias.** Aislamiento verificable (la proyección devuelve `location_id/turno_id`).
Legacy-safe: sin los params, comportamiento actual.

**Supersede.** — · PR #199.

## ADR-0006 — Offline-first: no tocar el hot path desde la nube

**Contexto.** Medir latencia y autoconfig requiere código en la caja (Pedro), pero el
local-server no viaja por Vercel: cambiarlo exige **instalador nuevo** y reinstalar.

**Decisión.** Las capas nube entregan el **motor + enganche opt-in** sin tocar el hot path. El
wiring (3 líneas en `command-handler`/`ws-hub`/print; escaneo LAN/USB/HID) va en un PR de
local-server agrupado con el instalador.

**Consecuencias.** Se puede probar y revisar la lógica sin arriesgar el offline en operación. La
recolección real de métricas/hardware queda pendiente de ese PR de instalador (declarado).

**Supersede.** — · PRs #201, #204.

## ADR-0007 — Confirmación humana; nada autónomo de alto riesgo

**Contexto.** Soporte remoto, autoconfig e IQ podrían "actuar solos". Riesgo inaceptable.

**Decisión.** Soporte = allowlist + consentimiento temporal + audit, **sin shell arbitrario**.
Autoconfig = propuesta con confidence topado (<1.0), **confirmar antes de guardar**, fallback
manual. IQ = read-only por defecto, allowlist de casos, preview/diff, `autonomous:false`
invariante; precios/compras/horarios se proponen, no se ejecutan.

**Consecuencias.** Ningún cambio de estado ocurre sin un humano. La ejecución confirmada de una
propuesta es un endpoint separado (fuera del lote actual).

**Supersede.** — · PRs #203, #204, #205.
