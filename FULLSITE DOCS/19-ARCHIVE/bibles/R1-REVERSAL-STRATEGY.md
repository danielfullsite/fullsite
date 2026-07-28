# R1 Reversal Strategy

**Estado:** PENDIENTE DE DECISIÓN — requiere aprobación de Daniel por escenario  
**Contexto:** Migración INV-P0-2026-07-25. Ver `R1-INVENTORY-CUTOVER.md` para el contexto completo.  
**Fecha:** 2026-07-25

Este documento responde una sola pregunta: **¿Cuál debe ser el sistema autoritativo para los reversals?**

Un reversal es cualquier operación que devuelve stock al inventario como consecuencia de cancelar o anular una venta. Hoy el reversal está implementado únicamente en Sistema A (`reverseIngredientDeduction()`). El estado correcto post-cutover depende de qué sistema hizo la deducción original.

---

## Sistema autoritativo

La regla es: **el reversal debe ser ejecutado por el mismo sistema que ejecutó la deducción**.

Si Sistema A dedujo → Sistema A revierte.  
Si R1 dedujo → R1 debe revertir.

Hoy, post-cutover, la deducción de items `recipe` la hace R1 (Sistema B). Pero `reverseIngredientDeduction()` sigue leyendo `pos_recipes_old` y actualizando `pos_inventory` directamente, sin saber si la deducción original fue de Sistema A o de R1. Si la deducción fue de R1 y el reversal lo ejecuta Sistema A, la suma es:

```
stock - deducción_R1 + reversal_A = stock + X
```

Si los ingredientes y cantidades coinciden exactamente entre `pos_recipe_lines` y `pos_recipes_old`, el resultado neto puede ser correcto. Si no coinciden (versiones distintas, cantidades diferentes, ingredientes distintos), el stock queda en un estado incorrecto.

---

## Escenario 1 — Item cancelado antes del pago

**Flujo actual:**  
`pos/page.tsx:2342` llama `reverseIngredientDeduction(item)` solo si `!voided && prepared`.  
Si el item no llegó a PREPARADO (no fue enviado a cocina), no hay reversal.

**¿Se dedujo inventario?**  
No — `deductIngredientsForOrder()` corre al pagar, no al preparar. R1 tampoco corrió aún. No hay nada que revertir.

**Decisión:** Sin reversal. Correcto en ambos sistemas.

---

## Escenario 2 — Item cancelado después del pago (estado: PREPARADO)

**Flujo actual:**  
`pos/page.tsx:2342` llama `reverseIngredientDeduction(item)`.  
Sistema A devuelve stock leyendo `pos_recipes_old`.

**¿Qué dedujo R1?**  
R1 dedujo al guardar la orden (vía `r1_reconcile_order` → `r1_reconcile_item`). Los ingredientes y cantidades vienen de `pos_recipe_lines`.

**Problema:**  
Si los ingredientes en `pos_recipes_old` y `pos_recipe_lines` coinciden para ese item, el reversal de Sistema A es numéricamente correcto. Si difieren (receta actualizada, versiones distintas), el stock queda mal.

**Opciones:**
- A. Mantener Sistema A para el reversal transitoriamente — acepta el riesgo de discrepancia entre tablas de recetas
- B. Bloquear el reversal de Sistema A para items `recipe` y no revertir hasta que R1 implemente orphan removal nativo
- C. Implementar `r1_orphan_removal` (ya diseñado en R1) y redirigir el reversal al SQL

**Decisión:** [ ] A / [ ] B / [ ] C  — requiere Daniel

---

## Escenario 3 — Item cancelado después de ser enviado a cocina (antes del pago)

**Flujo actual:**  
El item pasa a estado PREPARADO al llegar a KDS. La cancelación antes del pago llama `reverseIngredientDeduction(item)`.

**¿Se dedujo inventario?**  
Sistema A: No — `deductIngredientsForOrder()` corre al pagar, no al cocinar.  
R1: No — `r1_reconcile_order` corre desde `save-order` que sucede antes del pago, pero los items con estado `void` o `cancelled` no son incluidos en el reconcile. Confirmar con Eduardo: ¿puede un item ser cancelado después de KDS pero antes del cobro?

**Si la respuesta es sí:** mismo análisis que Escenario 1. No hay deducción → no hay reversal necesario.  
**Si la respuesta es no:** este escenario no existe en el flujo AMALAY.

**Pendiente:** Confirmar el flujo de estados de items con Eduardo.

---

## Escenario 4 — Anulación de orden completa (VOID)

**Flujo actual:**  
`pos/page.tsx:2489` llama `reverseIngredientDeduction(item)` para cada item en la orden.  
Sistema A devuelve el stock de cada item.

**¿Se dedujo R1?**  
R1 deduce cuando la orden se guarda/actualiza. Si la orden fue pagada antes del void, R1 ya corrió. Si no fue pagada, R1 puede haber corrido en saves previos.

**El problema:**  
R1 tiene idempotencia mediante `pos_reconciliation_results.applied_consumption`. El reversal de Sistema A devuelve el stock pero no actualiza `applied_consumption`. Si la orden se reabre y se vuelve a reconciliar (poco probable pero posible), R1 vería `applied_consumption > 0` y ajustaría delta = 0 — no deduciría de nuevo. El resultado neto: stock devuelto por A, nunca re-deducido por R1. Stock sobrecontado.

**Opciones:** Iguales al Escenario 2 (A, B, C).

**Decisión:** [ ] A / [ ] B / [ ] C  — requiere Daniel

---

## Escenario 5 — Item afectado por merge

**Flujo actual:**  
`merge-orders/route.ts` mueve items entre órdenes y llama `r1_reconcile_order` para ambas. No hay llamada a `reverseIngredientDeduction()` en el merge path.

**¿Hay reversals en merge?**  
No directamente. Si un item se mueve de una orden a otra, R1 reconcilia la diferencia (desired - applied). El merge no genera reversals explícitos.

**Si un item del merge se cancela después:**  
Escenario 2 aplica — el item ahora está en la orden destino, y la cancelación corre por el flujo normal.

**Decisión:** Sin cambio requerido por el merge en sí. El escenario posterior es Escenario 2.

---

## Escenario 6 — Item cancelado después de sincronización offline

**Flujo:**  
La orden fue tomada y pagada offline. Sistema A dedujo al pagar (offline). Al sincronizar, R1 dedujo vía `save-order`. Stock subcontado ×2 (bug P0 activo).

Si después se cancela un item de esa orden:

- Sistema A intenta revertir (leyendo `pos_recipes_old`)
- R1 no tiene reversal explícito para ese item

**El problema:**  
En el mejor caso, el reversal de Sistema A compensa una de las dos deducciones. El stock queda subcontado ×1 (mejor que ×2, pero aún incorrecto).

**Decisión:**
- Este escenario no se puede resolver correctamente hasta que se ejecute el Paso 0 (recovery de datos) y el Paso 1 (gate de TypeScript).
- Post-Paso 1, las nuevas órdenes offline no tendrán doble deducción. El reversal de Sistema A será la única corrección, lo que es numéricamente correcto si los ingredientes coinciden.
- Órdenes offline anteriores al Paso 1: el recovery del Paso 0 las corrige.

---

## Escenario 7 — División de orden (split)

**¿Existe split en AMALAY?**  
El código no muestra un endpoint de split. El flujo documentado es merge → dividir manualmente. Sin evidencia de split automático.

**Si se implementa en el futuro:**  
La estrategia de reversal debe seguir el mismo principio: el sistema que dedujo es el sistema que revierte. R1 debería manejar el rebalanceo de inventario vía `r1_reconcile_order` para ambas órdenes resultantes.

---

## Resumen de decisiones requeridas

| Escenario | Decisión pendiente |
|-----------|-------------------|
| 1 — Cancelado antes del pago | Sin cambio. Nada que revertir. |
| 2 — Cancelado después del pago | **A / B / C** |
| 3 — Cancelado después de cocina, antes del pago | Confirmar con Eduardo si el flujo existe |
| 4 — Void de orden completa | **A / B / C** |
| 5 — Post-merge | Sin cambio en merge. Escenario 2 aplica después. |
| 6 — Post-sincronización offline | Resolver post-Paso 0 + Paso 1. Decisión contingente. |
| 7 — Split | No existe hoy. Diseñar al implementar. |

**Recomendación:**  
Opción A (transitoria) para Escenarios 2 y 4 mientras se implementa `r1_orphan_removal`. Esto acepta el riesgo de discrepancia entre tablas de recetas, que es bajo si `pos_recipes_old` y `pos_recipe_lines` se mantienen en sincronía. Monitorear con query diaria: ingredientes revertidos por Sistema A vs. ingredientes deducidos por R1 para los mismos order_items.

La Opción C es la correcta a largo plazo pero bloquearía el Paso 1 hasta que `r1_orphan_removal` esté implementado y probado.

---

*Fecha de creación: 2026-07-25. Requiere revisión y aprobación de Daniel antes de implementar cualquier cambio en el flujo de reversals.*
