# OFFLINE-IMPL-001 v2.2 — Addendum de Diseño

> Estado: decisiones de diseño incorporadas — no modifica el scope de Commit 1
> Supersede: secciones específicas de v2.1 indicadas por ajuste
> Commit 1 (schema SQL): autorizado, ver outbox_schema_commit1.sql
> Commits 2–5: pendientes de evidencia de staging

---

## Ajuste 1 — Abstracción de respuesta HTTP (afecta Commit 4: OutboxWorker)

### Por qué no asumir códigos HTTP

PostgREST puede variar el código HTTP según la versión, la configuración de `Prefer:` y si la respuesta es vacía por `DO NOTHING`. Acoplar el Outbox a `201 = éxito` o `200 = duplicado` introduce una dependencia frágil no documentada.

### Contrato del adaptador

El OutboxWorker no interpreta respuestas HTTP directamente. Delega a un adaptador:

```
interface InsertResult {
  outcome:
    | 'inserted'           // fila nueva creada
    | 'already_exists'     // ON CONFLICT DO NOTHING — fila ya existía con ese id
    | 'integrity_violation' // constraint distinto al PK — ver campo constraint_name
    | 'terminal_error'     // 4xx no idempotente (RLS, check, validación)
    | 'transient_error'    // 5xx, timeout, red
  constraint_name?: string // solo si outcome === 'integrity_violation'
  http_status?: number     // para diagnóstico
  raw_error?: unknown      // para log
}

function interpretInsertResult(response: RawClientResponse): InsertResult
```

La implementación concreta de `interpretInsertResult` se escribe **después de observar en staging** qué devuelve PostgREST para cada caso. El contrato (los valores del enum `outcome`) es estable; la implementación interna puede cambiar.

### Qué debe observarse y documentarse en staging

Antes de implementar `interpretInsertResult`, ejecutar y registrar en `docs/testing/OUTBOX-HTTP-OBSERVATIONS.md`:

| Caso | SQL ejecutado | Respuesta observada (status, body, headers) |
|---|---|---|
| Primera inserción | `INSERT ... ON CONFLICT DO NOTHING` | — |
| Duplicado por PK(id) | Mismo id, segundo INSERT | — |
| Violación UNIQUE (restaurant_id, sequence) con id distinto | Mismo sequence, id diferente | — |
| Violación CHECK (type = 'STATE_SYNC') | type = 'STATE_SYNC' | — |
| Fila bloqueada por RLS | Tenant incorrecto | — |

El Outbox no entra a producción hasta que esa tabla esté completa.

---

## Ajuste 2 — Versionado del Checkpoint (afecta Commit 3: OutboxCheckpoint)

### Formato versionado

```json
{
  "outbox_version": 1,
  "last_synced_sequence": 124,
  "rejected_sequences": [],
  "incident_sequences": [],
  "consecutive_failures": 0,
  "last_attempt_at": null,
  "last_success_at": null
}
```

`outbox_version` es el primer campo que se lee. Todo lo demás se interpreta según esa versión.

### Comportamiento en load()

```
load():
  si el archivo no existe:
    → retornar estado inicial con version=1
    → no es un error

  si el archivo existe pero falla el parse (JSON inválido):
    → log WARN: "outbox-checkpoint.json corrupted — resetting to initial state"
    → retornar estado inicial con version=1
    → escribir el estado inicial al disco (sobreescribir el corrupto)
    → no es error terminal — el Outbox puede continuar
    → nota: los eventos no sincronizados en events.ndjson siguen ahí;
             el Outbox los reencola desde sequence=0

  si el archivo existe, parsea correctamente, pero no tiene campo version:
    → tratar como version=0 (pre-versionado)
    → intentar migración v0 → v1 (ver abajo)
    → si la migración falla: tratar como corrupto

  si version === 1:
    → parsear normalmente; retornar

  si version > MAX_KNOWN_VERSION (actualmente 1):
    → log ERROR: "checkpoint version {N} unknown — cannot downgrade"
    → retornar null — el Outbox no debe continuar con un checkpoint de versión superior
    → el operador debe resolver manualmente (actualizar el binario o limpiar el checkpoint)
```

### Migración v0 → v1

v0 = formato pre-versionado de v1 del Outbox (si existiera alguna vez):

```javascript
function migrate_v0_to_v1(raw) {
  return {
    outbox_version: 1,
    last_synced_sequence: raw.last_synced_sequence ?? 0,
    rejected_sequences:   raw.rejected_sequences   ?? [],
    incident_sequences:   raw.incident_sequences   ?? [],
    consecutive_failures: raw.consecutive_failures ?? 0,
    last_attempt_at:      raw.last_attempt_at      ?? null,
    last_success_at:      raw.last_success_at      ?? null,
  }
}
```

Cualquier campo ausente se inicializa con el valor por defecto. Mejor recuperar parcialmente que fallar.

### Escritura atómica

El checkpoint nunca se sobreescribe directamente. Siempre:

```
1. escribir a outbox-checkpoint.json.tmp
2. rename(outbox-checkpoint.json.tmp → outbox-checkpoint.json)
```

El rename es atómico en sistemas de archivos POSIX y NTFS (Windows, donde corre el Local Server). Un crash entre los pasos 1 y 2 deja el `.tmp` huérfano — detectable en el próximo startup e ignorable (no afecta el archivo principal).

---

## Ajuste 3 — Entradas del Journal de Reconciliación (afecta script outbox-reconcile.js)

### Formato de cada entrada

```json
{
  "ts_utc":         "2026-07-27T15:00:00.000Z",
  "script_version": "1.0.0",
  "transition_id":  "uuid-de-la-transicion",
  "applied_by":     "daniel@fullsite.mx",
  "mode":           "apply",
  "event_id":       "uuid-del-evento",
  "sequence":       131,
  "type":           "ORDER_CLOSED",
  "case":           "MISSING",
  "action":         "UPDATE pos_orders SET status='closed', closed_at='...' WHERE id='...'",
  "result":         "ok",
  "rows_affected":  1,
  "checksum":       "sha256:abc123def456..."
}
```

### Cómo se calcula el checksum

El checksum cubre los campos deterministas de la entrada (los que no dependen de cuándo se imprime):

```
campos a hashear: ts_utc, transition_id, event_id, sequence, type, action, result
método: SHA-256 del JSON canónico (claves ordenadas, sin espacios)
formato en el campo: "sha256:{hex}"
```

El checksum no incluye el campo `checksum` mismo. Para verificar: recomputar y comparar.

### Campos obligatorios

Todos los campos son obligatorios en una entrada de apply. Una entrada de verify (modo dry-run) puede omitir `applied_by`, `action`, `rows_affected` y `checksum` — pero debe incluir `ts_utc`, `script_version`, `transition_id`, `mode: "verify"`, `event_id`, `sequence`, `type`, `case`, `result`.

### Lectura del journal

El journal es NDJSON: una entrada JSON por línea, append-only. Para auditar:

```bash
# Ver resumen por resultado
cat reconcile-journal-{restaurantId}-{transitionId}.ndjson | jq -s 'group_by(.result) | map({result: .[0].result, count: length})'

# Verificar checksums
cat reconcile-journal-*.ndjson | while read line; do
  # recompute checksum from line fields and compare
done
```

---

## Ajuste 4 — Validación en Capa de Aplicación para Transición Activa (afecta herramienta de coordinación)

### Por qué validación en aplicación además del constraint SQL

El índice único parcial garantiza la integridad. Pero un constraint SQL produce un error técnico genérico que el coordinator no puede interpretar sin contexto. La validación en la capa de aplicación debe:

1. Verificar antes del INSERT si existe una transición activa
2. Si existe: lanzar un error con el contexto de la transición en curso
3. Si no existe: proceder al INSERT (el constraint es la guardia final)

### Contrato de la función de creación

```
async function createAuthorityTransition(params: {
  restaurantId: string,
  direction: 'activation' | 'rollback',
  initiatedBy: string,
}): Promise<TransitionRecord | TransitionConflictError>

TransitionConflictError: {
  code: 'TRANSITION_ALREADY_ACTIVE',
  message: string,      // mensaje en español, entendible por el coordinator
  existing: {
    id: string,
    direction: string,
    status: string,
    started_at: string,
    expires_at: string,
  }
}
```

Mensaje de error sugerido:
```
"Ya existe una transición activa para este restaurante.
 Dirección: activation | Estado: shadow | Iniciada: 2026-07-27T14:30:00Z | Expira: 2026-07-27T14:40:00Z
 Cancela la transición actual o espera a que expire antes de iniciar una nueva."
```

El constraint SQL sigue siendo la guardia final — protege contra race conditions si dos procesos llamaran `createAuthorityTransition` simultáneamente. La validación en aplicación es para el operador; el constraint es para la integridad.

---

## Estado consolidado del diseño

| Documento | Vigencia |
|---|---|
| v2 — arquitectura base | Vigente |
| v2.1 — timeout, pos_authority_transitions, verify/apply, terminal_id | Vigente |
| v2.2 (este) — HTTP abstraction, checkpoint version, journal format, app validation | Vigente |
| outbox_schema_commit1.sql | Listo para staging |
| scripts/outbox-reconcile.js | Pendiente — previo a Phase 2 |
| OUTBOX-HTTP-OBSERVATIONS.md | Pendiente — tras ejecutar staging |

## Criterio de salida de Commit 1

Commit 1 se acepta cuando se evidencian las 7 verificaciones de staging:

```
[ ] Idempotencia: INSERT mismo id → DO NOTHING sin error
[ ] Aislamiento por tenant: usuario de restaurante A no ve eventos de restaurante B
[ ] UNIQUE (restaurant_id, sequence): sequence duplicado con id distinto → error 23505 en la constraint correcta
[ ] CHECK STATE_SYNC: type='STATE_SYNC' → error de check
[ ] Transición única activa: segundo INSERT de transición activa → error de índice único parcial
[ ] RLS pos_authority_transitions: aislamiento por tenant
[ ] pos_write_authority: CHECK constraint + DEFAULT 'supabase' funcionan
```

Solo con las 7 marcadas se autoriza Commit 2.
