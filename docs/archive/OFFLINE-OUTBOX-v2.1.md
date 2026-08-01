# OFFLINE-IMPL-001 v2.1 — Enmiendas al Outbox

> Estado: **PROPUESTA v2.1 — pendiente aprobación final**
> Supersede: secciones específicas de v2 (indicadas por sección)
> Base: OFFLINE-IMPL-001-OUTBOX-v2.md — leer en conjunto

---

## Cambios respecto a v2

| Sección v2 afectada | Cambio |
|---|---|
| Parte 3 §4.2–4.3 | `transitioning` tiene timeout y recuperación según dirección |
| Parte 4 §4.4 | El protocolo de rollback requiere script verify/apply antes de completar |
| Parte 1 §1.2 | `client_id` renombrado a `terminal_id` |
| Parte 3 §4.3, §4.4 | Las columnas de coordinación salen de `clients`; van en `pos_authority_transitions` |
| Commit 1 | Schema ampliado: incluye la nueva tabla |

---

## Enmienda 1: `pos_authority_transitions` — tabla de coordinación

### 1.1 Por qué tabla separada

Una sola columna `pos_write_authority = 'transitioning'` no distingue dirección, no tiene historial, no tiene timeout, y contamina la tabla operativa `clients` con metadata de coordinación. Una tabla separada resuelve los tres problemas.

### 1.2 Definición

```
Tabla: pos_authority_transitions
Propósito: registro y coordinación de cada cambio de autoridad de escritura POS.
           Audit trail histórico. Una sola fila activa por restaurante.

Columnas:
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid()
  restaurant_id            UUID         NOT NULL REFERENCES clients(id)
  direction                TEXT         NOT NULL  -- 'activation' | 'rollback'
  from_authority           TEXT         NOT NULL  -- 'supabase' | 'local_server'
  to_authority             TEXT         NOT NULL  -- 'local_server' | 'supabase'
  status                   TEXT         NOT NULL DEFAULT 'pending'
  started_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  expires_at               TIMESTAMPTZ  NOT NULL  -- started_at + 10 minutos
  completed_at             TIMESTAMPTZ
  cancelled_at             TIMESTAMPTZ
  outbox_ready_at          TIMESTAMPTZ  -- el Local Server confirmó shadow mode activo
  baseline_sequence        INTEGER      -- last_synced_sequence antes de iniciar
  shadow_sequence          INTEGER      -- highest sequence enviado en shadow mode
  last_reconciled_sequence INTEGER      -- para rollback: sequence más alto confirmado en pos_orders
  reconciliation_status    TEXT         -- 'pending' | 'verified' | 'applied' | 'blocked'
  initiated_by             UUID         -- user_id que creó la transición
  approved_by              UUID         -- user_id que autorizó completar
  failure_reason           TEXT         -- razón de cancelación o timeout

Constraints:
  CHECK (direction IN ('activation', 'rollback'))
  CHECK (from_authority IN ('supabase', 'local_server'))
  CHECK (to_authority IN ('supabase', 'local_server'))
  CHECK (from_authority <> to_authority)
  CHECK (status IN ('pending', 'shadow', 'completing', 'completed', 'cancelled', 'timed_out'))
  CHECK (reconciliation_status IN ('pending', 'verified', 'applied', 'blocked') OR reconciliation_status IS NULL)

Índices:
  UNIQUE INDEX one_active_per_restaurant ON pos_authority_transitions (restaurant_id)
    WHERE status NOT IN ('completed', 'cancelled', 'timed_out')
    -- garantiza que no pueden coexistir dos transiciones activas del mismo restaurante

  INDEX ON (restaurant_id, started_at DESC)  -- historial cronológico por restaurante
```

### 1.3 Flujo de estados

**Activación** (`supabase → local_server`):

```
pending
  → Local Server confirma shadow mode: status = 'shadow', outbox_ready_at = now()
  → Coordinator aprueba: status = 'completing', pos_write_authority = 'local_server'
  → Todos los componentes confirman: status = 'completed', completed_at = now()

Si expires_at < now() antes de llegar a 'completing':
  → status = 'timed_out', cancelled_at = now(), failure_reason = 'timeout'
  → pos_write_authority revertido a 'supabase'
  → Outbox sale de shadow mode, se detiene
  → Alerta al coordinator
```

**Rollback** (`local_server → supabase`):

```
pending
  → Script verify ejecutado: reconciliation_status = 'verified'
  → Script apply ejecutado: reconciliation_status = 'applied', last_reconciled_sequence = N
  → Coordinator aprueba: status = 'completing', pos_write_authority = 'supabase'
  → Todos los componentes confirman: status = 'completed', completed_at = now()

Si expires_at < now() antes de llegar a 'completing':
  → status = 'timed_out', cancelled_at = now(), failure_reason = 'timeout'
  → pos_write_authority revertido a 'local_server'
  → Outbox reanuda (no pierde el checkpoint — sigue desde last_synced_sequence)
  → Alerta al coordinator
```

### 1.4 `clients` solo tiene `pos_write_authority`

Las columnas `outbox_ready_at` y `outbox_shadow_sequence` propuestas en v2 NO van en `clients`. Pertenecen a `pos_authority_transitions`. La tabla `clients` solo tiene:

```
clients.pos_write_authority TEXT NOT NULL DEFAULT 'supabase'
  CHECK (pos_write_authority IN ('supabase', 'transitioning', 'local_server'))
```

Los componentes leen `clients.pos_write_authority` para decidir su comportamiento. La metadata de la transición activa la obtienen consultando `pos_authority_transitions` donde `status NOT IN ('completed', 'cancelled', 'timed_out')`.

### 1.5 RLS de `pos_authority_transitions`

```sql
-- service_role: acceso completo (bypasea RLS)

-- authenticated: solo lectura por restaurante propio y rol admin
CREATE POLICY "transitions_tenant_admin_read"
  ON pos_authority_transitions
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- Sin INSERT/UPDATE/DELETE para authenticated.
-- Las transiciones las crea y modifica el script o el Local Server (service_role).
```

---

## Enmienda 2: Timeout y Recuperación de `transitioning`

### 2.1 Quién verifica el timeout

El Local Server verifica en cada ciclo de heartbeat (cada 5 min en estado estable; cada 30s durante `transitioning`):

```
heartbeat():
  → leer transición activa de pos_authority_transitions para este restaurant_id
  → si transición existe y expires_at < now() y status NOT IN ('completing', 'completed'):
      → status = 'timed_out', cancelled_at = now()
      → si direction == 'activation':
            → pos_write_authority = 'supabase'
            → Outbox.stop() si estaba en shadow mode
      → si direction == 'rollback':
            → pos_write_authority = 'local_server'
            → Outbox.resume() (retoma desde checkpoint; no reinicia)
      → escribir failure_reason = 'timeout'
      → emitir alerta (canal de heartbeat: health_status = 'transition_timed_out')
```

El coordinator recibe la alerta vía el canal de heartbeat (Telegram / dashboard). La recuperación es automática al último estado estable; completar el cambio requiere iniciar una nueva transición.

### 2.2 Timeout de 10 minutos — justificación

Con polling de 30s durante `transitioning`, el tiempo máximo para que todos los componentes detecten el nuevo estado es 60s (2 ciclos). 10 minutos da 10× el margen. Si en 10 minutos no se completó, hay un problema que requiere atención — no esperar indefinidamente.

El coordinator puede iniciar una nueva transición después de resolver la causa del timeout (red, proceso caído, configuración).

### 2.3 Cancelación manual

Además del timeout automático, el coordinator puede cancelar manualmente:

```sql
UPDATE pos_authority_transitions
SET status = 'cancelled',
    cancelled_at = now(),
    failure_reason = 'manual_cancellation'
WHERE id = '{transitionId}' AND status NOT IN ('completed', 'cancelled', 'timed_out');
```

El Local Server detecta `status = 'cancelled'` en el próximo ciclo y ejecuta la misma lógica de recovery que para `timed_out`.

---

## Enmienda 3: Script de Reconciliación — verify / apply

### 3.1 Propósito y ubicación

Script operacional versionado. No es una UI ni un workflow de GitHub Actions. Corre localmente con credenciales explícitas. Las credenciales no deben estar en el script ni en el repositorio — se pasan como variables de entorno al ejecutar.

```
Ubicación: scripts/outbox-reconcile.js
Runtime: Node.js (comparte ecosistema con electron-app)
Comandos: verify | apply
```

### 3.2 Modo `verify` — solo lectura

Compara `pos_local_events` con `pos_orders` para todos los eventos de la transición activa.

Para cada evento donde `sequence > baseline_sequence`:

| Caso | Definición | Acción del script |
|---|---|---|
| `MATERIALIZED` | `pos_orders` tiene una fila que corresponde al evento y el estado coincide | Reportar como OK |
| `MISSING` | No hay fila correspondiente en `pos_orders` | Candidato para apply si es determinista |
| `AMBIGUOUS` | Hay fila en `pos_orders` pero el estado difiere del que el evento implica | Reportar como conflicto; bloqueado para apply |
| `NON_MATERIALIZABLE` | El tipo de evento no tiene representación directa en `pos_orders` (`KDS_ITEM_STATUS`, `MESA_LOCK`, `PRINT_COMMAND`, etc.) | Reportar como fuera de alcance; no se materializa |

Output del verify:
```json
{
  "transition_id": "...",
  "restaurant_id": "...",
  "baseline_sequence": 124,
  "events_total": 48,
  "by_case": {
    "MATERIALIZED": 40,
    "MISSING": 5,
    "AMBIGUOUS": 2,
    "NON_MATERIALIZABLE": 1
  },
  "missing": [{ "sequence": 131, "type": "ORDER_CLOSED", "id": "..." }, ...],
  "ambiguous": [{ "sequence": 143, "type": "ORDER_UPSERTED", "id": "...", "conflict": "..." }],
  "blocked": true,
  "can_apply": false
}
```

`can_apply = true` únicamente si `AMBIGUOUS = 0`. Con cualquier ambigüedad, el apply está bloqueado hasta que el coordinator resuelva manualmente.

El verify actualiza `pos_authority_transitions.reconciliation_status = 'verified'` al terminar.

### 3.3 Modo `apply` — requiere autorización explícita

```bash
node scripts/outbox-reconcile.js apply \
  --transition-id <uuid> \
  --restaurant-id <uuid> \
  --approve               # flag obligatorio; sin él el script no corre apply
```

Sin `--approve`, el script imprime el plan y sale con code 1.

Qué materializa:
- Solo eventos `MISSING` con tipo determinista: `ORDER_CLOSED`, `ORDER_CANCELLED`
- Casos donde la mutación de `pos_orders` puede derivarse unívocamente del payload del evento

Qué nunca materializa:
- Casos `AMBIGUOUS` — siempre bloqueados
- `ORDER_UPSERTED` con conflicto de versión — no se puede saber cuál versión es la correcta
- Tipos `NON_MATERIALIZABLE`

Por cada fila materializada, escribe en el journal:

```
Archivo: scripts/reconcile-journal-{restaurantId}-{transitionId}.ndjson
Formato: una línea JSON por acción

{ "ts": 1753660000, "event_id": "...", "sequence": 131, "type": "ORDER_CLOSED",
  "action": "UPDATE pos_orders SET status='closed', closed_at=... WHERE id=...",
  "result": "ok", "rows_affected": 1 }
```

El journal es append-only y se versionea junto al script. Nunca se borra — es el audit trail del rollback.

El apply actualiza:
- `pos_authority_transitions.reconciliation_status = 'applied'`
- `pos_authority_transitions.last_reconciled_sequence = max(sequences aplicados)`

El apply jamás acepta pérdidas silenciosamente. Si después del apply quedan casos `MISSING` no materializables, el script imprime un bloque explícito:

```
PÉRDIDAS NO MATERIALIZADAS (requieren aceptación manual del coordinator):
  sequence 139 — ORDER_UPSERTED — sin fila correspondiente en pos_orders
  sequence 141 — ORDER_UPSERTED — sin fila correspondiente en pos_orders

Estos eventos existieron en el restaurante durante Phase 2 y no están representados
en pos_orders. La activación de Phase 1 no los recuperará automáticamente.
Para continuar el rollback, el coordinator debe aceptar esta pérdida explícitamente
pasando --accept-losses al comando apply. Sin ese flag, el rollback permanece bloqueado.
```

### 3.4 El script existe antes de activar Phase 2

El script debe estar implementado y probado en staging (con un restaurante de prueba) antes de que cualquier restaurante llegue a `pos_write_authority = 'local_server'`. Aunque el rollback puede no ser necesario nunca, la capacidad de ejecutarlo debe estar probada.

---

## Enmienda 4: Renombre de `client_id` → `terminal_id` en eventos

### 4.1 Problema en v2

El campo `client_id` en `pos_local_events` se describía como "el terminal de origen", pero `client_id` en el resto del sistema identifica al restaurante (tenant), no al terminal. Esto provoca ambigüedad en joins y RLS.

### 4.2 Definición corregida

En `pos_local_events`:

```
terminal_id    UUID    -- dispositivo que originó el comando
                       -- NULL si el evento fue generado por el Local Server (appendInternal)
                       -- Corresponde a pos_terminal_id del localStorage del POS
restaurant_id  UUID    -- identidad del tenant (restaurante)
                       -- FK a clients.id
```

`terminal_id` es el identificador del dispositivo físico (tablet, caja, KDS) — el mismo valor que `pos_terminal_id` en localStorage. `restaurant_id` es el tenant. Son ortogonales.

Este rename se aplica también en el checkpoint, en los tests y en el event log del Local Server. En `events.ndjson`, el campo ya se llamaba `client_id` en el protocolo v1 — ese campo puede seguir llamándose así en el NDJSON (es un formato de disco existente), pero al sincronizar a Supabase, el Outbox mapea `event.client_id → terminal_id` en el INSERT.

---

## Commit 1 — Schema Revisado (único commit autorizado)

El Commit 1 crea el schema completo en Supabase staging. Nada más hasta que el schema pase las pruebas indicadas.

### SQL a generar y revisar

```sql
-- 1. pos_local_events
CREATE TABLE IF NOT EXISTS pos_local_events (
  id             UUID        NOT NULL,
  sequence       INTEGER     NOT NULL,
  type           TEXT        NOT NULL,
  ts             BIGINT      NOT NULL,
  terminal_id    UUID,
  restaurant_id  UUID        NOT NULL,
  payload        JSONB       NOT NULL,
  CONSTRAINT pos_local_events_pkey PRIMARY KEY (id),
  CONSTRAINT pos_local_events_unique_seq UNIQUE (restaurant_id, sequence),
  CONSTRAINT pos_local_events_type_not_state_sync CHECK (type <> 'STATE_SYNC')
);

CREATE INDEX IF NOT EXISTS pos_local_events_restaurant_seq
  ON pos_local_events (restaurant_id, sequence);

CREATE INDEX IF NOT EXISTS pos_local_events_restaurant_ts
  ON pos_local_events (restaurant_id, ts);

ALTER TABLE pos_local_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_local_events_tenant_admin_read
  ON pos_local_events
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- 2. pos_authority_transitions
CREATE TABLE IF NOT EXISTS pos_authority_transitions (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id              UUID        NOT NULL REFERENCES clients(id),
  direction                  TEXT        NOT NULL,
  from_authority             TEXT        NOT NULL,
  to_authority               TEXT        NOT NULL,
  status                     TEXT        NOT NULL DEFAULT 'pending',
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                 TIMESTAMPTZ NOT NULL,
  completed_at               TIMESTAMPTZ,
  cancelled_at               TIMESTAMPTZ,
  outbox_ready_at            TIMESTAMPTZ,
  baseline_sequence          INTEGER,
  shadow_sequence            INTEGER,
  last_reconciled_sequence   INTEGER,
  reconciliation_status      TEXT,
  initiated_by               UUID,
  approved_by                UUID,
  failure_reason             TEXT,
  CONSTRAINT pat_direction_valid    CHECK (direction IN ('activation', 'rollback')),
  CONSTRAINT pat_from_valid         CHECK (from_authority IN ('supabase', 'local_server')),
  CONSTRAINT pat_to_valid           CHECK (to_authority IN ('supabase', 'local_server')),
  CONSTRAINT pat_from_neq_to        CHECK (from_authority <> to_authority),
  CONSTRAINT pat_status_valid       CHECK (status IN
    ('pending', 'shadow', 'completing', 'completed', 'cancelled', 'timed_out')),
  CONSTRAINT pat_recon_status_valid CHECK (reconciliation_status IN
    ('pending', 'verified', 'applied', 'blocked') OR reconciliation_status IS NULL)
);

CREATE UNIQUE INDEX pos_authority_transitions_one_active
  ON pos_authority_transitions (restaurant_id)
  WHERE status NOT IN ('completed', 'cancelled', 'timed_out');

CREATE INDEX pos_authority_transitions_history
  ON pos_authority_transitions (restaurant_id, started_at DESC);

ALTER TABLE pos_authority_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pat_tenant_admin_read
  ON pos_authority_transitions
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- 3. Columna en clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pos_write_authority TEXT NOT NULL DEFAULT 'supabase'
  CONSTRAINT clients_pwa_valid CHECK (
    pos_write_authority IN ('supabase', 'transitioning', 'local_server')
  );
```

### Pruebas requeridas antes de avanzar a Commit 2

El schema pasa cuando todas estas afirmaciones son verdaderas:

**Idempotencia**:
- INSERT de evento A en `pos_local_events` → 201
- INSERT del mismo evento A (mismo id) → 200 con cuerpo vacío (DO NOTHING)
- El registro original no fue modificado

**Aislamiento de tenant**:
- Usuario authenticated con rol `admin` de restaurante X puede SELECT sus propios eventos
- El mismo usuario NO puede SELECT eventos de restaurante Y
- Usuario sin rol `admin`/`owner` no puede SELECT ningún evento

**Constraint de sequence**:
- INSERT de evento con `(restaurant_id=X, sequence=5)` → éxito
- INSERT de otro evento distinto con `(restaurant_id=X, sequence=5)` → error 23505 en constraint `pos_local_events_unique_seq`
- INSERT de evento con `(restaurant_id=Y, sequence=5)` → éxito (mismo sequence, distinto tenant)

**Constraint de tipo**:
- INSERT con `type = 'STATE_SYNC'` → error de check constraint

**Transición única activa**:
- INSERT de transición activa para restaurante X → éxito
- INSERT de segunda transición activa para el mismo restaurante X → error por índice único parcial
- Después de cerrar la primera (`status = 'completed'`): INSERT de nueva transición → éxito

**RLS de transiciones**:
- Admin de restaurante X puede ver su transición
- Admin de restaurante X no puede ver transición de restaurante Y

**`pos_write_authority`**:
- INSERT/UPDATE a valor fuera del CHECK → error
- DEFAULT es 'supabase'

Hasta que el staging valide estas pruebas, los commits 2–5 no inician.

---

## Estado del diseño después de v2.1

| Documento | Estado |
|---|---|
| OFFLINE-MASTER.md | Vigente |
| OFFLINE-GAP-001.md (con decisiones resueltas) | Vigente |
| OFFLINE-GAP-002.md | Vigente (Opción B pendiente de Outbox) |
| OFFLINE-IMPL-001-OUTBOX-v2.md | Vigente — leer en conjunto con v2.1 |
| OFFLINE-IMPL-001-OUTBOX-v2.1.md (este) | **Enmiendas activas** |
| scripts/outbox-reconcile.js | Pendiente — entregable separado, previo a Phase 2 |
