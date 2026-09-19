# Backlog P0 — registrado, NO autorizado a implementar

> **Registrado:** 2026-09-17, por Daniel, al recibir Track A
> ([OFFLINE-IDEMPOTENCY.md](OFFLINE-IDEMPOTENCY.md)).
> **Estado de todo lo de aquí: REGISTRADO. Ninguno está autorizado a implementarse.**
>
> **El alcance actual de P0A no cambia.** Este documento existe para que los hallazgos del research
> no se conviertan en trabajo espontáneo ni se pierdan entre sesiones.

---

## Orden vigente

```
P0A  →  certificar  →  P0B  →  P0C  →  P0D / reliability wave
```

Nada de la derecha empieza antes de que lo de la izquierda esté cerrado. **P0A no se amplía**
para meterle nada de lo de abajo, aunque el research lo haya encontrado primero.

---

## La regla que gobierna este backlog

> **STATIC FINDING ≠ PRODUCT DEFECT hasta que haya prueba en runtime.**

El Track A fue lectura de código y de documentación pública. Eso produce **hipótesis con dirección**,
no defectos comprobados. Cada renglón de abajo arranca en estado `HALLAZGO ESTÁTICO` y sólo se
promueve a `DEFECTO` después de reproducirlo. Antes de eso no se corrige — ni siquiera "de paso".

---

## P0B — requisito añadido (no es un track nuevo)

**Qué se añade al alcance de P0B cuando le toque su turno:**

> Un ACK perdido / replay idempotente debe poder **recuperar o confirmar positivamente el resultado
> original**. `duplicate: true` sin *outcome* no es una semántica final suficiente.

- **Dónde vive hoy:** [`electron-app/local-server/core/event-store.js:29-31`](../../../electron-app/local-server/core/event-store.js#L29)
  devuelve `{ duplicate: true, event: null }`.
- **Referencia interna de cómo se ve bien hecho:** `r1_save_order_idempotent`, que sí devuelve
  `first_execution` / `idempotent_replay` / `revision`
  ([save-order/route.ts:141-143](../../../dashboard-app/src/app/api/pos/save-order/route.ts#L141)).
- **Referencia externa:** [Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
  (guarda y reproduce status + body de la primera ejecución) y
  [Replicache — server push](https://doc.replicache.dev/reference/server-push).
- **Estado:** requisito registrado. **No implementar hasta que P0A esté certificado.**

---

## P0C-PEDRO-DURABILITY

**Estado: `HALLAZGO ESTÁTICO`. No asumir implementación todavía.**

- **Qué reporta el research:** el event store usa `fs.appendFileSync` sin `fsync`/flush
  ([ndjson.js:84](../../../electron-app/local-server/adapters/storage/ndjson.js#L84)); cero
  coincidencias de `fsync`/`fdatasync` en `electron-app/` y `dashboard-app/src`.
- **Lo que NO está demostrado:** que eso produzca pérdida real en el runtime concreto de Node/Electron
  sobre Windows + NTFS que corre en la caja, ni dónde está exactamente hoy la frontera del ACK.
- **Trabajo pendiente, después de P0B:**
  1. Auditar el runtime **real** de Node/Electron, no el genérico.
  2. Fijar el **boundary exacto del ACK**: qué se le promete al cliente y en qué instante.
  3. Definir el modelo de durabilidad antes de elegir la implementación.
- **Contrato deseado:**
  > `ACK_DURABLE` significa que la operación sobrevive a un crash o corte de energía **dentro del
  > modelo de durabilidad que definamos**.
- **Cómo se prueba:** **corte y crash**, no sólo reinicio de proceso. Un `process.exit()` limpio no
  ejerce esta propiedad; hay que ejercer `SIGKILL` y pérdida de energía real.
- **Nota de consistencia documental:** si el contrato resulta distinto del que afirma
  [`PER-02-RESEARCH.md §3`](../../architecture/PER-02-RESEARCH.md) ("un ACK visible implica que el
  evento ya está en disco"), se corrige **ese** documento — no se deja la afirmación en pie.

---

## P0D-INVENTORY-DEDUP-RACE

**Estado: `REENCUADRADO 2026-09-18`. El hallazgo original era de una rama vieja.**

> **Corrección.** El research de P0B verificó contra `origin/main` (el working tree estaba **663
> commits atrás**) y encontró que el dedup por `LIKE` **ya está resuelto ahí**:
> `pos_record_inventory_movement` tiene tabla de recibos, `movement_operation_key` con índice único
> parcial, advisory lock sobre la llave, comparación de intent y replay del resultado guardado
> ([20260910050000_inventory_movement_atomic.sql](../../../supabase/migrations/20260910050000_inventory_movement_atomic.sql)).
>
> **Lo que queda abierto es otra cosa, y es lo que hereda el nombre P0D:** `pos_inventory_movements`
> y `pos_inventory` **siguen en la lista `ALLOW` del proxy REST**, así que existe un camino que
> saltea el RPC, el lock y el recibo. Un contrato no se cumple mientras exista otro camino al mismo
> efecto. Análisis en [P0B-COMMAND-RECEIPTS.md §10](P0B-COMMAND-RECEIPTS.md).
>
> **Sin verificar:** si esas migraciones están **aplicadas en producción** (la cabecera dice
> *"Candidate only"*). Estado `NO VERIFICADO`, no "no aplicado".

**El texto original, conservado como registro de lo que se creyó:**

- **Qué reporta el research:** dedup por `notes=like.*{key}*` seguido de insert, sin constraint único
  ([inventory.ts:144-146](../../../dashboard-app/src/lib/inventory.ts#L144)) — forma de check-then-act.
- **Lo que NO está demostrado:** que exista una ventana real de concurrencia en los caminos que de
  hecho llaman a `recordMovement()`. Puede estar serializado aguas arriba por algo que no leí.
- **Trabajo pendiente, después de P0C:**
  1. **Localizar el path exacto**: quién llama, con qué concurrencia posible, desde cuántos terminales.
  2. **Reproducir la carrera** con réplicas concurrentes del mismo `idempotency_key`.
  3. Sólo entonces decidir la corrección (constraint único es la dirección, no la decisión).
- **Guardián, cuando toque:** la prueba debe **fallar primero** con el código actual. Si pasa en verde
  contra el bug, no protege nada ([[feedback-guardian-debe-fallar]]).

---

## Lo que queda fuera de este backlog

Del Track A salieron otras recomendaciones (descubrimiento mDNS en vez de IP estática, checkpoint
versionado del outbox, dead-letter en Pedro, auditoría a IndexedDB en vez de `localStorage` con
descarte). **No están registradas como P0.** Viven en
[OFFLINE-IDEMPOTENCY.md](OFFLINE-IDEMPOTENCY.md) y esperan a la *reliability wave*.
</content>
