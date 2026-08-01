# ADR-004 — Canonical Module Rule

> **Status:** APROBADO — 2026-07-31  
> **Autores:** Daniel Ramonfaur  
> **Contexto:** Auditoría OCS P2.5.4 reveló fórmula de arqueo duplicada entre tres componentes

---

## Problema

Durante la auditoría OCS P2.5.4 Caja se encontró la misma fórmula de reconciliación de efectivo en tres lugares distintos:

1. `CierreCajaWizard.tsx` — fórmula incompleta (omitía `propinasNoEfectivo`)
2. `pos/corte/page.tsx` — fórmula correcta, inline en un IIFE
3. Print ticket dentro del Wizard — fórmula diferente a ambas

Cada vez que un componente necesitó calcular "efectivo esperado en caja", copió (o inventó) la fórmula localmente. No había módulo canónico. Resultado: tres implementaciones divergentes de la misma regla de negocio.

Esto no es un caso aislado. El mismo patrón se observó en inventory (`recordMovement` ignorado), en costos (cálculos inline en páginas), y en autenticación (btoa duplicado en múltiples archivos).

---

## Decisión

**Cuando una regla de negocio es utilizada por más de un componente del sistema:**

1. **No puede existir duplicada.** Si se necesita en dos lugares, pertenece a un módulo, no a ninguno de los dos lugares.
2. **No puede copiarse.** Copiar es crear deuda que divergirá. La segunda copia ya es un bug latente.
3. **No puede mantenerse manualmente.** "Mantener sincronizadas" dos implementaciones es una tarea que siempre falla eventualmente.

**Debe existir un módulo canónico reutilizable** en `src/lib/` con contrato explícito (tipos, funciones exportadas, tests).

---

## Primer ejemplo oficial

`src/lib/pos-arqueo.ts` — módulo canónico de reconciliación de caja.

```typescript
// Contrato canónico — la única fórmula de arqueo en el sistema
export function calcEfectivoEsperado(input: ArqueoInput, totalContado?: number): ArqueoResult

// Pipeline completo desde órdenes crudas hasta ArqueoInput
export function computeOrderSummary(orders, cashMovements, methodTypeMap?): OrderSummary
export function summaryToArqueoInput(summary, fondoInicial): ArqueoInput
```

Tres consumidores usan el mismo módulo: `CierreCajaWizard`, `pos/corte/page.tsx`, print ticket. Si la fórmula cambia (ej: agregar `propinasEspeciales` en el futuro), el cambio se hace una vez y todos los consumidores lo adoptan automáticamente.

---

## Señales de que se está violando esta regla

- Una búsqueda de `ventasEfectivo + depositos - retiros` devuelve más de un resultado en el codebase
- Un bug de cálculo se corrige en un lugar pero aparece en otro "porque también lo calculaba ahí"
- Un developer dice "copié la lógica de X para no tocar el módulo"

---

## Cómo aplicar esta regla a código existente

1. Identificar la regla de negocio (ej: "cómo se calcula el costo de un platillo")
2. Encontrar todas las implementaciones existentes (grep)
3. Determinar cuál es la correcta, o sintetizar la versión correcta
4. Crear el módulo en `src/lib/` con tipos y función(es) exportadas
5. Reemplazar todas las implementaciones inline por llamadas al módulo
6. Escribir tests que documenten el contrato
7. Actualizar `dashboard-app/AGENTS.md` → Domain Registry si el dominio no estaba listado

---

## Relación con axiomas existentes

Esta regla es una instancia específica de los Axiomas I.1–I.6 del Engineering Constitution, aplicada al caso concreto de reglas de negocio multi-consumidor. Ver `docs/constitution/ENGINEERING-AXIOMS.md`, Axioma 18.

---

## Lo que NO dice esta regla

- No dice que toda lógica debe abstraerse. Lógica usada por un solo componente puede vivir en ese componente.
- No dice que los módulos deben ser grandes. Un módulo de una función y cinco líneas es perfectamente válido si esa función es la regla canónica.
- No dice que la abstracción debe existir antes del segundo consumidor. Si solo hay un consumidor y es claro que solo habrá uno, el módulo puede esperar. La regla se activa en el segundo consumidor.

---

## Ejemplos en este codebase

| Regla de negocio | Módulo canónico | Consumidores |
|---|---|---|
| Efectivo esperado en caja | `pos-arqueo.ts / calcEfectivoEsperado` | Wizard, Corte, Print |
| Movimiento de inventario | `inventory.ts / recordMovement` | Barcode, Transferencias, Ventas |
| Costo de platillo | `cost-engine/` | Dashboard, Reports |
| Auth de gerente offline | `pos-manager-auth.ts / verifyPinOffline` | CashMovementModal, CierreCajaWizard |
