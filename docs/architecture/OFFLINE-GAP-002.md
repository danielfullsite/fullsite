# OFFLINE-GAP-002 — State Synchronization Model

> P0-02 | Versión: 2026-07-27
> Análisis completo del modelo de sincronización de estado.
> Del síntoma (clobber) al modelo correcto.

---

## El Problema en Una Línea

El Local Server mantiene estado local que puede ser sobreescrito por datos de Supabase cada 5 segundos. Esto es intencional en Phase 1 y correcto para ese contexto. Es incompatible con Phase 2.

---

## 1. Estado Local

El `RestaurantState` mantiene en memoria:

```javascript
_mesas:  Map<string, { status, order_id, locked_by, locked_at }>
_orders: Map<string, { id, order_id, mesa, status, items, mesero, ... }>
_kds:    Array<{ order_id, mesa, items_sent, sent_at }>
_locks:  Map<string, { client_id, expires_ms }>
_turno:  { id, opened_by, opened_at } | null
```

Este estado se construye de dos formas:

**Construcción 1 — Replay en startup**:
```
events.ndjson
  → CoreEventStore.readAfter(0)
  → for (ev of events) state.apply(ev)
  → RestaurantState en memoria
```

**Construcción 2 — Aplicación de eventos en runtime**:
```
COMMAND del terminal
  → CommandHandler.handle()
  → CoreEventStore.processCommand()
  → state.apply(event)   ← actualización incremental
  → wsHub.broadcast(event)
```

---

## 2. Evento Remoto (Supabase Poll)

Cada 5 segundos, el Local Server hace:

```javascript
GET pos_orders?client_id=eq.{restaurantId}&status=neq.closed
  → construye mesaMap (mesa → { status, order_id })
  → eventStore.appendInternal(EVENT.STATE_SYNC, { mesas, kds_queue, turno, synced_at })
  → state.apply(stateSyncEvent)   ← aquí ocurre el clobber
  → if (stateChanged) wsHub.broadcast(stateSyncEvent)
```

---

## 3. Merge Esperado

El comportamiento que un operador esperaría de un sistema local-first:

```
Estado local: mesa 5 = ocupada (order_id: ABC, mesero: Omar)
              [creado por un COMMAND hace 2 segundos, aún no llegó a Supabase]

Estado Supabase (poll): mesa 5 = libre
                        [porque el order ABC aún no fue synced al browser → Supabase]

Merge esperado: el estado LOCAL gana.
                El evento local es más reciente que el dato de Supabase.
                Supabase simplemente no sabe del evento todavía.
```

**Criterio de merge esperado en un sistema local-first**:
> "El estado derivado de eventos locales recientes tiene prioridad sobre el estado observado en el servidor remoto. El servidor remoto eventualmente converge cuando el outbox propaga los eventos."

---

## 4. Comportamiento Actual (el Clobber)

```
t=0s  : COMMAND ORDER_SENT llega al Local Server
        → state.apply(ORDER_SENT) → mesa 5 = ocupada
        → wsHub.broadcast(ORDER_SENT) → KDS recibe la orden

t=1s  : Supabase poll ejecuta
        → GET pos_orders (Supabase aún no tiene la orden — el outbox no existe)
        → mesaMap = {} (sin órdenes activas)
        → STATE_SYNC { mesas: [], kds_queue: [], turno: null }
        → state._applyStateSync({ mesas: [] })

_applyStateSync:
  this._mesas.clear()           ← ⚠ borra mesa 5 = ocupada
  for (m of mesas) ...          ← no hay nada → mesas queda vacío
  this._kds = kds_queue         ← ⚠ borra la entrada del KDS
  wsHub.broadcast(STATE_SYNC)   ← ⚠ KDS recibe el broadcast y quita la orden
```

**Resultado observable**:
- La pantalla del KDS muestra la orden por <1 segundo, luego la borra
- El plano de mesas muestra mesa 5 como libre durante hasta 5 segundos
- Si un segundo terminal está conectado, también "ve" la mesa como libre
- La orden no se pierde (está en events.ndjson) pero el estado en memoria es incorrecto

---

## 5. Por Qué Ocurre el Clobber

La causa raíz es una **incompatibilidad de autoridades**:

| Aspecto | Phase 1 | Phase 2 |
|---|---|---|
| Autoridad de escritura | Supabase | Local Server |
| Quién debe ganar en merge | Supabase | Local Server |
| Comportamiento de STATE_SYNC | Correcto (replace) | Incorrecto (clobber) |

En Phase 1, Supabase es la autoridad. El Local Server "observa" y re-propaga. Si Supabase dice que no hay órdenes, no hay órdenes. El replace es correcto.

En Phase 2, el Local Server es la autoridad. Supabase es el destino de sincronización, no la fuente de verdad. Si el Local Server tiene una orden que Supabase aún no conoce, el estado local debe prevalecer.

El clobber existe porque `_applyStateSync` usa la semántica de Phase 1 (`clear() + replace`) cuando la arquitectura avanza hacia Phase 2.

---

## 6. Casos que Hacen el Clobber Menos Grave (Phase 1)

En Phase 1, el clobber es mitigado por:

1. **El outbox del browser ya sincronizó**: Si el POS browser sincronizó el ORDER_SENT directamente a Supabase antes de que el poll ocurra, el poll traerá la orden de vuelta. La ventana de inconsistencia es: tiempo entre el COMMAND y el sync del browser, típicamente <2s con internet.

2. **Supabase poll cada 5s**: El clobber es temporal. Después del siguiente poll (si el browser ya sincronizó), el estado se restaura.

3. **Los eventos están en events.ndjson**: La orden no se pierde. Solo el estado en memoria es temporalmente incorrecto.

**Sin embargo**: En situaciones offline (sin internet), el browser NO puede sincronizar. El clobber es permanente mientras no hay internet, porque el poll de Supabase también falla (el poll requiere internet). En este caso el poll no ejecuta y el clobber no ocurre. Es decir: **el clobber solo ocurre cuando HAY internet pero el outbox del browser es más lento que el poll**. Una ventana pequeña pero real.

---

## 7. Arquitectura Propuesta

### Opción A: Hybrid Sync (Phase 2a) — Merge por timestamp

En lugar de replace, el `_applyStateSync` hace merge comparando timestamps:

```javascript
_applyStateSync({ mesas, kds_queue, turno, synced_at }) {
  for (const m of mesas) {
    const localMesa = this._mesas.get(String(m.mesa))
    const supabaseTs = new Date(synced_at).getTime()
    const localTs = localMesa?._last_event_ts || 0

    if (!localMesa || supabaseTs > localTs) {
      // Supabase más reciente → aplicar
      this._mesas.set(...)
    }
    // Si local más reciente → no tocar
  }
}
```

**Requiere**: `_last_event_ts` en cada entrada de mesa, actualizado cuando se aplica un evento local.

**Ventaja**: No rompe Phase 1 (si el browser ya sincronizó, Supabase tiene la info más reciente).

**Desventaja**: El timestamp de Supabase (`updated_at` de `pos_orders`) y el timestamp local pueden divergir si los relojes de las máquinas no están sincronizados. Solución: usar el sequence del event store como proxy de "más reciente" en lugar de timestamps de reloj.

### Opción B: Sequence-Based Merge (Phase 2b) — Merge por sequence

Cada entrada de mesa lleva el sequence del último evento local que la modificó:

```javascript
// En _applyOrderSent:
this._mesas.set(String(mesa), {
  status: 'ocupada', order_id, locked_by: null,
  _local_seq: event.sequence    // ← nuevo campo
})

// En _applyStateSync:
for (const m of mesas) {
  const localMesa = this._mesas.get(String(m.mesa))
  const lastSyncedSeq = this._lastSyncedSeq || 0  // último sequence confirmado por Supabase

  if (!localMesa || !localMesa._local_seq || localMesa._local_seq <= lastSyncedSeq) {
    // Estado local ya fue sincronizado → Supabase tiene info más actualizada
    this._mesas.set(...)
  }
  // Si local_seq > lastSyncedSeq → evento local aún no llegó a Supabase → preservar local
}
```

**Requiere**: `_lastSyncedSeq` — el último sequence que el outbox confirmó como recibido por Supabase.

**Ventaja**: No depende de relojes. El sequence es monotónico y confiable.

**Desventaja**: Requiere que el outbox actualice `_lastSyncedSeq` en tiempo real. Ver sección 7a para la definición exacta.

---

### 7a. Definición Exacta de `_lastSyncedSeq` (condición de aprobación de Opción B)

La aprobación de Opción B está condicionada a resolver tres preguntas sobre `_lastSyncedSeq`. Se responden aquí como parte del diseño.

#### ¿Qué confirma Supabase?

`_lastSyncedSeq` se actualiza **únicamente** cuando:

1. El outbox llama `POST /rest/v1/pos_local_events` con el evento de sequence N
2. Supabase responde con HTTP 2xx (201 Created o 200 OK si ya existía — upsert idempotente)
3. El outbox llama `eventStore.markSynced([N])`
4. `markSynced` persiste `synced: true` en el NDJSON
5. El outbox actualiza `state._lastSyncedSeq = N` en el RestaurantState en memoria

**Lo que NO actualiza `_lastSyncedSeq`**:
- Que el evento fue procesado por el CommandHandler → solo en memoria
- Que el evento fue broadcast a terminales vía WS → solo LAN
- Que el browser POS sincronizó su propia copia a Supabase → canal diferente, sequence diferente
- Un 4xx o 5xx de Supabase → el evento permanece `synced: false` y `_lastSyncedSeq` no sube

#### ¿Cómo se reconstruye `_lastSyncedSeq` después de un reinicio?

Al reiniciar el Local Server, `NdjsonEventStore.load()` lee todos los eventos del NDJSON. Durante el load:

```javascript
// En NdjsonEventStore.load() — extensión requerida:
let maxSyncedSeq = 0
for (const line of lines) {
  const ev = parse(line)
  if (ev.synced === true && ev.sequence > maxSyncedSeq) {
    maxSyncedSeq = ev.sequence
  }
}
this._lastSyncedSeq = maxSyncedSeq  // expuesto para que el State lo consuma
```

El `RestaurantState` inicializa `_lastSyncedSeq = eventStore.lastSyncedSequence` en su constructor.

**Garantía de correctness tras reinicio**: Si el outbox fue interrumpido en el medio de un batch (confirmó sequences 1-50, falló en 51-60), el NDJSON tiene `synced: true` en 1-50 y `synced: false` en 51-60. Al reiniciar, `_lastSyncedSeq = 50`. Los eventos 51-60 tienen `_local_seq > 50` → el STATE_SYNC no los clobberearía. El outbox los reenvía y, cuando Supabase confirma, `_lastSyncedSeq` sube.

#### ¿Qué pasa si `_lastSyncedSeq` nunca avanza (outbox no implementado)?

En Phase 1, el outbox no existe. `_lastSyncedSeq = 0` siempre. Esto significa que Opción B, aplicada sin outbox, trataría TODOS los eventos locales como "no sincronizados" y nunca aplicaría STATE_SYNC a ninguna mesa. Esto rompería Phase 1 completamente.

**Consecuencia de diseño**: Opción B REQUIERE el outbox para funcionar correctamente. No puede implementarse como "medida de contención" independiente del outbox. La secuencia correcta es:

1. Implementar outbox (GAP-001)
2. Verificar que `_lastSyncedSeq` avanza conforme los eventos llegan a Supabase
3. Implementar Opción B en `_applyStateSync` con `_lastSyncedSeq` como guard
4. Deprecar STATE_SYNC (Opción C) cuando el outbox esté estable

Mientras el outbox no esté implementado, el STATE_SYNC debe seguir siendo replace (comportamiento actual de Phase 1). La Opción B como parche prematuro empeora el sistema.

### Opción C: Deprecar STATE_SYNC en Phase 2 (Phase 2c) — solución radical

En Phase 2, el Local Server es la autoridad. El poll de Supabase se desactiva completamente. El estado del Local Server es la única fuente de verdad. Supabase recibe datos del outbox, no al revés.

```javascript
// En startLocalServer:
if (config.phase === 2) {
  // NO iniciar startSupabasePoll
  // El estado viene solo del event log
} else {
  startSupabasePoll(...)
}
```

**Ventaja**: Elimina el problema de raíz. Sin poll → sin STATE_SYNC → sin clobber.

**Desventaja**: En Phase 2, si el outbox falla, Supabase no recibe datos. Necesita el outbox completamente implementado y probado ANTES de deprecar el poll.

---

## 8. Recomendación

**Para Phase 2a (próxima iteración)**:

1. Implementar Opción B (sequence-based merge) como medida de contención. Es quirúrgico: solo modifica `_applyStateSync`. No requiere el outbox completo.

2. En paralelo, implementar el outbox (GAP-001).

3. Una vez el outbox está estable y probado, migrar a Opción C (deprecar STATE_SYNC).

**No implementar Opción A** (timestamp-based): los relojes de Windows pueden estar desincronizados y la ventana de error puede ser invisible.

---

## 9. Tabla de Decisión de Implementación

| Criterio | Opción A | Opción B | Opción C |
|---|---|---|---|
| Implementación sin outbox completo | Sí | Sí | No |
| Depende de relojes sincronizados | Sí ⚠ | No | No |
| Elimina el clobber completamente | No (mitiga) | No (mitiga) | Sí |
| Riesgo de regresión en Phase 1 | Medio | Bajo | Alto (sin outbox) |
| Complejidad de implementación | Media | Media | Baja (eliminar código) |
| **Recomendado para** | — | **Phase 2a** | **Phase 2b** (con outbox estable) |

---

## 10. Test para Verificar el Fix

```
Precondición: internet activo, browser POS conectado, Supabase poll corriendo

1. Enviar ORDER_SENT para mesa 5 via WS
2. Capturar el timestamp T1 del evento
3. Esperar 2s (antes del próximo poll en 5s)
4. Verificar que mesa 5 sigue = ocupada en RestaurantState
5. Esperar que el poll ocurra (t < 5s desde T1)
6. Verificar que mesa 5 sigue = ocupada (no fue clobbereada)

PASS: mesa 5 permanece ocupada después del poll
FAIL: mesa 5 aparece como libre después del poll
```

Este es el test de regresión mínimo para cualquier implementación de Opciones A/B/C.
