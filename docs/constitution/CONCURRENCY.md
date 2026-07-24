# Modelo de Concurrencia — Fullsite

> **Permanente.** Este documento no se modifica sin RFC aprobado.
> Última revisión: 2026-07-24

---

## El problema que resuelve

Fullsite puede tener múltiples terminales operando simultáneamente sobre la misma mesa. Sin un modelo de concurrencia explícito, dos terminales pueden sobrescribirse silenciosamente. La pérdida de un ítem de orden es inaceptable: no se puede reconstruir qué se pidió, y genera diferencias de inventario y cobro.

---

## Dos primitivas. Una para cada caso.

### `r1_save_order` — Optimistic Concurrency Control (OCC)

**Cuándo usarlo:** Para guardar el estado completo de una orden (metadata + items) y para cobros.

**Cómo funciona:**
```
Cliente lee orden → guarda order_revision local (N)
Cliente modifica → intenta guardar con expected_revision = N
DB: UPDATE WHERE order_revision = N
  → Si matchea: escribe, retorna revision N+1       → ok: true
  → Si no matchea: otra terminal modificó antes     → conflict: true
```

**Invariante:** Si `r1_save_order` retorna `conflict: true`, el cliente NO DEBE hacer save automático. Debe calcular qué tiene de nuevo y usar `r1_add_items` para esos ítems específicos.

**Nunca:** Hacer retry silencioso de un full save después de un conflict. Esto sobrescribiría los ítems de la otra terminal.

---

### `r1_add_items` — Append-Only (sin OCC)

**Cuándo usarlo:** Para agregar ítems nuevos a una orden que ya existe, cuando hay conflicto de OCC o cuando se detecta que otra terminal creó la orden primero.

**Cómo funciona:**
```
UPDATE pos_orders
SET items = items || (new_items filtrados por item.id no existente)
    order_revision = order_revision + 1
WHERE id = order_id AND client_id = client_id
  AND status NOT IN ('cerrada', 'cancelada', 'void')
```

**Por qué es seguro sin OCC:** Los `item.id` son UUID v4 generados en el cliente al momento de confirmar el ítem. Dos terminales no pueden generar el mismo UUID. El filtro por `item.id` en la RPC garantiza idempotencia: llamar dos veces con los mismos ítems produce el mismo resultado.

**Nunca:** Usar `r1_add_items` para modificar ítems existentes. Es append-only. Para modificaciones (cantidad, modificadores, notas), se usa `r1_save_order`.

---

## Flujos canónicos de conflicto

### Caso 1: Race en orden nueva (dos terminales, misma mesa, sin orden en DB)

```
Terminal A: race_check → no encuentra orden → saveOrder(expected=0) → INSERT → ok, rev=1
Terminal B: race_check → encuentra orden de A → addOrderItems(B_items_nuevos) → ok, rev=2
```

El race check ocurre ANTES de `saveOrder`. Si B encuentra la orden de A, B hace append directo. Si el race check no la encontró (ventana de timing), B también hace INSERT exitoso y quedan dos órdenes para la misma mesa — este edge case requiere resolución manual.

### Caso 2: Conflict en orden existente (dos terminales modifican concurrentemente)

```
A y B cargan orden en revision N
A guarda → ok, rev N+1
B intenta guardar → conflict (B tiene revision N, DB tiene N+1)
B calcula: conflictNewItems = B_items - sentItemIds (ítems que B no había enviado)
B llama addOrderItems(conflictNewItems) → ok, rev N+2
```

B nunca sobrescribe los ítems de A. A nunca pierde lo que envió.

### Caso 3: Cobro — siempre OCC, nunca append-only

El cobro modifica `status → cerrada`, `pagos`, `propina`. Esto DEBE usar `r1_save_order` con OCC. Si otro terminal modificó la orden entre que se abrió el modal de pago y se confirmó, el cobro retorna `conflict` y el cajero recibe un aviso para recargar. No hay auto-append en el flujo de pago.

---

## Qué nunca puede ocurrir

| Prohibición | Consecuencia si ocurre |
|---|---|
| Retry silencioso de full save después de conflict | Ítems de otra terminal se pierden permanentemente |
| Usar `r1_add_items` para modificar ítems existentes | Duplicados en el JSONB, inconsistencia con sentItemIds |
| Guardar una orden sin `turno_id` | `r1_save_order` lo rechaza — requerido por la DB |
| Ignorar `conflict: true` en el cobro | Doble cobro o cobro con total incorrecto |
| Hacer UPDATE directo a `pos_orders.items` desde el cliente | Bypasea OCC, no hay garantía de integridad |

---

## Naming de RPCs

| Prefijo | Significado |
|---|---|
| `r1_` | Operación de datos core, sin idempotencia transaccional |
| `r2d_` | Wraps una r1 con exactly-once identity (tabla `pos_save_operations`) |

`r1_save_order` → la operación atómica  
`r1_save_order_idempotent` (wrapeada por `r2d_`) → con exactly-once replay  
`r1_add_items` → append-only, idempotente por item.id, sin tabla de operaciones

---

## Referencias

- Implementación: `dashboard-app/src/app/api/pos/save-order/route.ts`
- Implementación: `dashboard-app/src/app/api/pos/add-items/route.ts`
- SQL: `scripts/sql/migrations/004_functions.sql` (r1_save_order)
- SQL: `dashboard-app/sql/r1_add_items.sql`
- Contexto POS-02: commit `43d6140` (2026-07-24)
