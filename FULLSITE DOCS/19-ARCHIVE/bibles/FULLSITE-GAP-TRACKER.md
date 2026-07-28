# FULLSITE-GAP-TRACKER.md
> Backlog arquitectónico oficial de Fullsite.
> Fuente: QA Pass de las 7 Bibles — 2026-07-23
> Total: 53 gaps | 11 P0 | 20 P1 | 22 P2
> Estado de cada gap: ABIERTO hasta que se cierre con evidencia.

---

## Cómo usar este documento

Este documento **no es un roadmap de features**. Es el registro de gaps reales entre lo que el sistema promete, lo que el código hace, y lo que la documentación dice. Antes de cerrar cualquier gap, verificar contra el código — nunca contra otro documento.

**Flujo de cierre:**
1. Verificar en código o en Supabase la verdad
2. Implementar fix si es código, o actualizar Bible si es documentación
3. Marcar como CERRADO con evidencia (archivo:línea o PR)

**Categorías:**
- `ARQUITECTURA` — riesgo real de bug o corrupción de datos
- `OPERACIÓN` — riesgo real para producción en AMALAY
- `PRODUCTO` — flujo incompleto o inconsistencia de UX
- `DOCUMENTACIÓN` — contradicción entre Bibles (resolver contra el código)

---

## Resumen ejecutivo

| Categoría | P0 | P1 | P2 | Total |
|---|---|---|---|---|
| ARQUITECTURA | 9 | — | — | 9 |
| OPERACIÓN | 2 | 1 | — | 3 |
| PRODUCTO | — | 11 | — | 11 |
| DOCUMENTACIÓN | — | — | 30 | 30 |
| **TOTAL** | **11** | **12** | **30** | **53** |

---

## ARQUITECTURA — P0

> Problemas reales que pueden provocar bugs o corrupción de datos. No entrar al siguiente sprint sin plan para estos.

---

### ARC-01 | Doble deducción de inventario — protocolo sin definir

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Stock deducido dos veces por la misma orden |
| **Impacto** | Dashboard de inventario incorrecto; alertas de reorden falsas |
| **Evidencia** | `pos-data.ts:1784` (`deductIngredientsForOrder` — Sistema A) + `save-order/route.ts:157` (`r1_reconcile_order` — Sistema B) |
| **Bible afectada** | Domain Bible §3.6, Engineering Bible §3.9 |
| **Descripción** | Sistema A (cliente) deduce inventario en `handlePayment` cuando `ok=true`. Sistema B (servidor) llama a `r1_reconcile_order` en cada save. Ningún Bible ni comentario de código documenta si ambos sistemas escriben a las mismas tablas, si Sistema B tiene idempotencia que previene doble deducción, ni qué pasa en un pago online donde ambos se ejecutan. |
| **Recomendación** | 1. Revisar SQL de `r1_reconcile_order` en Supabase para confirmar qué tabla escribe. 2. Si escribe a `pos_inventory`: verificar que tiene idempotencia por `order_id`. 3. Documentar en Domain Bible §3.6 con [HECHO]. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 2-3h (investigación SQL + documentación) |
| **Dependencias** | Acceso a Supabase SQL Editor para ver el cuerpo de `r1_reconcile_order` |

---

### ARC-02 | Tabla canónica de recetas — tres versiones en conflicto

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | r1_reconcile_order (Sistema B) y deductIngredientsForOrder (Sistema A) pueden leer de tablas distintas, produciendo deducciones de cantidades distintas |
| **Impacto** | Doble deducción con cantidades inconsistentes; stock corrupto |
| **Evidencia** | `pos-data.ts:1791` (usa `getRecipes()` → [INFERENCIA: pos_recipes_old]), `route.ts:157` (`r1_reconcile_order` — tabla desconocida) |
| **Bible afectada** | Domain Bible §3.6, §7 (Source of Truth), C8 en QA Report |
| **Descripción** | Tres nombres de tabla identificados: `pos_recipes_old` (usado por `deductIngredientsForOrder` en cliente, [INFERENCIA]), `pos_recipe_versions + pos_recipe_lines` (marcada como canónica en Domain Bible §7), `pos_recipes` (usado en Operations Bible). No existe confirmación de qué tabla usa `r1_reconcile_order` internamente. |
| **Recomendación** | 1. Verificar en Supabase qué tabla existe actualmente. 2. Revisar SQL de `r1_reconcile_order`. 3. Documentar en Domain Bible §3.6 con [HECHO]. 4. Si hay migración en curso, confirmar su estado. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 2h |
| **Dependencias** | ARC-01 (relacionado — misma área de inventario) |

---

### ARC-03 | r1_save_order — INSERT o UPDATE desconocido

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Si hace solo UPDATE, órdenes nuevas fallarían silenciosamente en el RPC |
| **Impacto** | Pérdida de órdenes sin error visible en el cliente |
| **Evidencia** | `route.ts:90` (llama a `r1_save_order_idempotent` o `r1_save_order` — SQL no en repo) |
| **Bible afectada** | Engineering Bible Open Questions, Master Bible §3 |
| **Descripción** | Engineering Bible documenta esta pregunta sin respuesta: ¿`r1_save_order` hace INSERT o UPDATE? El SQL de la RPC no está en el repositorio. Si hace solo UPDATE, una orden con `expected_revision=0` (nueva) fallaría sin retornar error distinguible. |
| **Recomendación** | Revisar SQL de `r1_save_order` y `r1_save_order_idempotent` en Supabase. Documentar en Engineering Bible con [HECHO]. |
| **Tipo** | DOCUMENTACIÓN (si es solo lectura de SQL) o CÓDIGO (si hay bug) |
| **Tiempo estimado** | 30min |
| **Dependencias** | Acceso a Supabase SQL Editor |

---

### ARC-04 | Comportamiento del sync ante 409 — bug potencial activo

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Conflictos de escritura OCC pueden estar siendo silenciados en producción |
| **Impacto** | Datos sobreescritos silenciosamente; pérdida de órdenes sin alerta |
| **Evidencia** | `pos-offline-db.ts:300-316` (STALE_WRITE_CONFLICT definido como terminal) vs Operations Bible §DT-2 ("sync silencia 409") |
| **Bible afectada** | Operations Bible §DT-2 |
| **Descripción** | Operations Bible §DT-2 documenta que el sync offline silencia errores 409 y los trata como éxito. El código en `pos-offline-db.ts` define `STALE_WRITE_CONFLICT` como error terminal explícito — no se silencia, se marca como conflict y se detiene el retry. Si el comportamiento real es el que describe Operations Bible, hay un bug activo. Si Operations Bible está mal, es una contradicción grave que induce a error. |
| **Recomendación** | 1. Verificar comportamiento real del sync ante 409 en dev (simular conflicto con expected_revision incorrecta). 2. Si Operations Bible está mal: corregirlo con [HECHO]. 3. Si hay bug: corregirlo en código y actualizar Bible. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 2h (prueba + corrección) |
| **Dependencias** | Ninguna |

---

### ARC-05 | NEXT_PUBLIC_DEFAULT_CLIENT_ID='amalay' — riesgo multi-tenant

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Si el header `x-client-id` no se envía, el restaurante #2 vería datos de AMALAY |
| **Impacto** | Fuga de datos entre tenants — bloqueante para onboarding del segundo cliente |
| **Evidencia** | Dashboard Bible §3.5 Rationale (hardcoded fallback = 'amalay') |
| **Bible afectada** | Dashboard Bible §3.5, Engineering Bible §8 |
| **Descripción** | El fallback de `client_id` en el dashboard está hardcodeado como 'amalay'. En producción con un solo cliente esto es inofensivo. Antes de onboarding del segundo restaurante, este fallback debe eliminarse o hacerse configurable. No hay plan documentado para cuándo se cambia. |
| **Recomendación** | 1. Agregar a roadmap de Fase 4 (multi-tenant). 2. Documentar en Engineering Bible §8 con [PENDIENTE] y condición de cambio: "antes del restaurante #2". 3. Agregar alerta en código: `if (!clientId) throw new Error('x-client-id required')`. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 1h |
| **Dependencias** | Segundo cliente en pipeline |

---

### ARC-06 | IndexedDB DB_VERSION=1 — sin estrategia de migración

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Al agregar un nuevo store o cambiar un schema, dispositivos con v1 no migran automáticamente |
| **Impacto** | Datos corruptos o sync queue inaccesible en meseros que ya tienen la app |
| **Evidencia** | `pos-offline-db.ts:6` (`DB_VERSION = 1`), sin `onupgradeneeded` handler documentado |
| **Bible afectada** | Engineering Bible §5.2 |
| **Descripción** | IndexedDB requiere un handler `onupgradeneeded` para migrar datos cuando la versión sube. No hay documentación ni código visible de esta estrategia. Si en Fase 2 (KDS local-first) se agrega un store nuevo a IndexedDB, todos los dispositivos existentes necesitarían migración. Sin estrategia, el upgrade podría limpiar la sync queue. |
| **Recomendación** | Documentar la estrategia actual en Engineering Bible §5.2: ¿qué pasa cuando DB_VERSION sube? ¿Se borran todos los stores? ¿Se migran? Definir el patrón antes de Fase 2. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 2h (definir + documentar + implementar handler) |
| **Dependencias** | Fase 2 (KDS local-first) necesita este patrón definido antes de implementar |

---

### ARC-07 | Transportes APP_API vs SUPABASE_REST — restricciones sin documentar

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Items con transporte incorrecto en la sync queue no se procesan correctamente |
| **Impacto** | Operaciones offline que nunca sincronizan sin error visible |
| **Evidencia** | `pos-offline-db.ts:27` (`transport?: ReplayTransport`), sin documentación de los dos valores ni sus restricciones |
| **Bible afectada** | Engineering Bible §5.3, Master Bible §4 |
| **Descripción** | `SyncQueueItem` tiene un campo `transport` con al menos dos valores: `APP_API` (replay via `/api/pos/save-order`) y `SUPABASE_REST` (directo a Supabase REST). Engineering Bible documenta el replay de `APP_API` pero no documenta cuándo se usa `SUPABASE_REST`, qué restricciones tiene, ni cómo se maneja su error classification. Cualquier operación que use `SUPABASE_REST` tiene camino de retry diferente. |
| **Recomendación** | 1. Leer `pos-offline-db.ts` completo para entender el dispatch por transporte. 2. Documentar ambos transportes en Engineering Bible §5.3 con [HECHO]. 3. Confirmar que `CierreCajaWizard` considera ambos transportes al filtrar items. |
| **Tipo** | DOCUMENTACIÓN (si el código ya es correcto) |
| **Tiempo estimado** | 2h |
| **Dependencias** | ARC-04 (relacionado — mismo módulo de sync) |

---

### ARC-08 | comanda_batches PATCH separado — fallo silencioso sin documentar

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Si el PATCH de comanda_batches falla, el KDS opera en modo degradado sin alerta |
| **Impacto** | KDS no muestra información de batch (todos los ítems en una sola card) — operación degradada sin visibilidad |
| **Evidencia** | `route.ts:110-119` (PATCH separado con `catch { /* non-blocking */ }`) |
| **Bible afectada** | Engineering Bible §3.1, POS Bible §8.2 |
| **Descripción** | `save-order/route.ts` guarda `comanda_batches` en un PATCH separado después del RPC principal, con `catch { /* non-blocking */ }`. Si este PATCH falla, el KDS recibe la orden sin información de batch y "falls back to single card". Este fallback existe pero no está documentado en ningún Bible. El comentario en el código dice "Eduardo Jul 21 (Batch 5): avoid modifying the RPC" pero no explica el riesgo del fallback. |
| **Recomendación** | 1. Documentar el fallback en POS Bible §8.2 y Engineering Bible §3.1 con [HECHO]. 2. Agregar log explícito cuando el PATCH falla para tener visibilidad del modo degradado. 3. Agregar Rationale: por qué no se modificó el RPC. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 1h |
| **Dependencias** | Ninguna |

---

### ARC-09 | Lineage check de reconciliación — capa de estado sin documentar

| Campo | Valor |
|---|---|
| **Prioridad** | P0 |
| **Riesgo** | Sin documentación de esta lógica, un bug en el lineage check puede causar reconciliación duplicada o saltada |
| **Impacto** | Inventario no reconciliado o reconciliado dos veces |
| **Evidencia** | `route.ts:131-217` (lógica `last_inventory_processed_revision` y `last_inventory_complete_revision`) |
| **Bible afectada** | Engineering Bible §3.1 |
| **Descripción** | `save-order/route.ts` tiene una capa completa de estado de reconciliación basada en `last_inventory_processed_revision` y `last_inventory_complete_revision` que determina si `r1_reconcile_order` debe ejecutarse en un replay idempotente. Esta lógica es compleja y crítica pero no está documentada en ningún Bible. Un error en el lineage check podría saltar reconciliaciones necesarias o ejecutar reconciliaciones innecesarias. |
| **Recomendación** | Documentar el algoritmo completo de lineage check en Engineering Bible §3.1 con [HECHO] y diagrama de flujo de decisión. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 2h |
| **Dependencias** | ARC-01, ARC-02 (contexto de inventario) |

---

## OPERACIÓN — P0 / P1

> Riesgos reales para producción en AMALAY. Los P0 requieren acción antes del siguiente turno.

---

### OPS-01 | Certificado CSD Facturama vence 2026-08-03

| Campo | Valor |
|---|---|
| **Prioridad** | P0 — URGENTE (11 días desde auditoría) |
| **Riesgo** | Las facturas CFDI dejarán de generarse el 2026-08-03 |
| **Impacto** | AMALAY no puede emitir facturas — 400-430 facturas/mes bloqueadas. Clientes sin CFDI. |
| **Evidencia** | Operations Bible Open Questions item #9 |
| **Bible afectada** | Operations Bible, Product Vision Bible §Roadmap |
| **Descripción** | El certificado CSD (Certificado de Sello Digital) de Facturama requerido para timbrar facturas ante el SAT tiene fecha de vencimiento 2026-08-03. Si no se renueva antes de esa fecha, todas las solicitudes de timbrado devolverán error. Las ventas continúan pero los clientes no pueden facturar. |
| **Recomendación** | 1. Renovar el certificado CSD en el SAT y actualizar en Facturama INMEDIATAMENTE. 2. Agregar alerta de vencimiento de certificado al sistema de monitoreo. 3. Documentar el proceso de renovación en Operations Bible. |
| **Tipo** | OPERACIÓN (acción de Daniel, no código) |
| **Tiempo estimado** | 2-4h (proceso SAT + Facturama) |
| **Dependencias** | Acceso al portal del SAT y a la cuenta de Facturama |

---

### OPS-02 | MANUAL-OPERATIVO.md — referenciado pero no verificado

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Invariantes de Operations Bible sin fuente verificable |
| **Impacto** | 12+ referencias en Operations Bible que no se pueden validar |
| **Evidencia** | Operations Bible §3.5, §4.1, §5.4, §7.2 y otros |
| **Bible afectada** | Operations Bible |
| **Descripción** | Operations Bible referencia "MANUAL-OPERATIVO.md" docenas de veces como fuente de procedimientos y rationale de invariantes. Si este documento existe, debe integrarse a la familia Bible. Si no existe, las referencias son [PENDIENTE] o [INFERENCIA]. |
| **Recomendación** | 1. Verificar si existe en `/docs/`. 2. Si existe: decidir si absorberlo como Bible #8 o referenciar explícitamente. 3. Si no existe: marcar todas las referencias como [INFERENCIA] en Operations Bible. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 1h |
| **Dependencias** | Ninguna |

---

### OPS-03 | Proceso de renovación de CSD sin documentar

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Próxima renovación volverá a ser una emergencia |
| **Impacto** | Operacional — el proceso se repite cada 2 años sin playbook |
| **Evidencia** | Operations Bible Open Questions item #9 (primera vez que se documenta) |
| **Bible afectada** | Operations Bible §Facturación |
| **Descripción** | No hay documentación del proceso paso a paso para renovar el CSD. Después de resolver OPS-01, documentar el proceso para que no vuelva a ser una emergencia. |
| **Recomendación** | Agregar procedimiento de renovación CSD en Operations Bible §Facturación con pasos exactos, links al SAT y Facturama, y alerta de calendario 60 días antes del vencimiento. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 1h (post OPS-01) |
| **Dependencias** | OPS-01 (hacer la renovación primero, luego documentar) |

---

## PRODUCTO — P1

> Flujos incompletos o inconsistencias de UX. No bloquean la operación actual pero afectan calidad y onboarding de nuevos ingenieros.

---

### PRD-01 | Máquina de estados de la orden — tres versiones

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Ingeniero nuevo implementa transición basándose en la versión incorrecta |
| **Impacto** | Bug en lógica de negocio; transiciones inválidas no detectadas |
| **Evidencia** | POS Bible §6.1 (7 estados), Operations Bible §6.1 (5 estados), Domain Bible §3.2 (6 estados) |
| **Bible afectada** | Operations Bible §6.1, Domain Bible §3.2 |
| **Descripción** | Tres Bibles documentan la máquina de estados de `pos_orders.status` con diferente número de estados y nombres distintos: Operations llama `abierta` al estado inicial; POS y Domain lo llaman `nueva`. Operations incluye `anulada`; los otros no. Operations omite `preparando`, `lista`, y `entregada`. La fuente de verdad es el código — `pos/page.tsx` y el RPC `r1_save_order`. |
| **Recomendación** | 1. Verificar en `pos/page.tsx` y en la tabla `pos_orders` los valores de status realmente usados. 2. POS Bible §6.1 parece la más completa — usarla como canónica. 3. Actualizar Operations Bible §6.1 y Domain Bible §3.2 para alinear. 4. Documentar si `anulada` y `cancelada` son el mismo estado o distintos. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 2h |
| **Dependencias** | Ninguna |

---

### PRD-02 | KDS write target — kds_item_status vs items

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Si Operations Bible está en lo correcto, el KDS sobreescribe ítems de la orden |
| **Impacto** | Pérdida de modificadores u otros campos al actualizar status de KDS |
| **Evidencia** | Operations Bible §DT-4 (escribe a `items`), POS Bible §8.4 y Domain Bible I7 (escribe a `kds_item_status` separado) |
| **Bible afectada** | Operations Bible §DT-4 |
| **Descripción** | Operations Bible dice que el KDS escribe al campo `items` de la orden. POS Bible y Domain Bible dicen que escribe a una columna separada `kds_item_status`. Si Operations tiene razón, hay riesgo de corrupción de la orden. Si POS/Domain tienen razón, Operations Bible está mal y puede confundir a quien lo implemente. |
| **Recomendación** | 1. Revisar `kds/page.tsx` para ver el PATCH exacto que hace el KDS al marcar un ítem. 2. Verificar schema de `pos_orders` en Supabase. 3. Actualizar Operations Bible con [HECHO]. |
| **Tipo** | CÓDIGO + DOCUMENTACIÓN |
| **Tiempo estimado** | 1h |
| **Dependencias** | Ninguna |

---

### PRD-03 | CierreCajaWizard — 2 pasos vs 4 pasos

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Documentación de capacitación incorrecta |
| **Impacto** | Staff capacitado con flujo incorrecto de cierre de caja |
| **Evidencia** | POS Bible §11.3 (2 pasos), Operations Bible §5.4 (4 pasos: billetes, monedas, comparación, PIN) |
| **Bible afectada** | POS Bible §11.3 o Operations Bible §5.4 (uno de los dos) |
| **Descripción** | El número de pasos del wizard de cierre de caja varía entre Bibles. Las Bibles de operaciones y capacitación son las que impactan directamente al staff. |
| **Recomendación** | Revisar `CierreCajaWizard.tsx` y contar los pasos reales. Actualizar el Bible incorrecto con [HECHO]. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 30min |
| **Dependencias** | Ninguna |

---

### PRD-04 | Roles del sistema — supervisor vs gerente

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Permisos incorrectos aplicados a un rol |
| **Impacto** | Staff con acceso que no debería tener, o bloqueado donde debería tener acceso |
| **Evidencia** | POS Bible §5.2 (`admin`, `supervisor`, `mesero`, `cajero`), Operations Bible §5.6 (`admin`, `gerente`, `mesero`, `cajero`) |
| **Bible afectada** | POS Bible §5.2 o Operations Bible §5.6 |
| **Descripción** | `supervisor` y `gerente` pueden ser el mismo rol con distinto nombre, o pueden ser dos roles distintos con distintos permisos. Ninguna Bible lo aclara. La tabla `pos_staff` en Supabase tiene la verdad. |
| **Recomendación** | 1. Consultar `pos_staff` en Supabase para ver los valores de `role` actualmente en uso. 2. Actualizar ambas Bibles para usar los valores exactos de la DB. 3. Si `supervisor` y `gerente` son distintos, documentar la diferencia de permisos. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 30min |
| **Dependencias** | Ninguna |

---

### PRD-05 | Módulos POS no documentados en POS Bible

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Módulos existentes sin cobertura — ingenieros no saben que existen |
| **Impacto** | Cambios en módulos sin context de qué hacen |
| **Evidencia** | Operations Bible menciona `/pos/auditoria`, `/pos/monitor`, `/pos/inventario`, `/pos/compras` |
| **Bible afectada** | POS Bible §1.3 |
| **Descripción** | POS Bible §1.3 lista los módulos del POS pero puede omitir hasta 4 módulos mencionados en Operations Bible. Necesitan verificación de existencia y documentación si existen. |
| **Recomendación** | `find /Users/danielrg/fullsite/dashboard-app/src/app/pos -type d` para listar todos los módulos. Agregar los que falten a POS Bible §1.3 con al menos una descripción de una línea. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 1h |
| **Dependencias** | Ninguna |

---

### PRD-06 | Estados de print queue — terminología inconsistente

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Diagnóstico incorrecto de un problema de impresión |
| **Impacto** | Tiempo de resolución más lento en operación |
| **Evidencia** | Operations Bible §3.3 (`printing`, `success`), POS Bible §6.4 y Engineering Bible §6.4 (`retrying`, `printed`) |
| **Bible afectada** | Operations Bible §3.3 |
| **Descripción** | Los estados de la cola de impresión tienen nombres distintos según el Bible. `print-queue.ts` tiene la verdad. |
| **Recomendación** | Revisar `src/lib/print-queue.ts` para los estados reales del tipo `PrintJob`. Actualizar el Bible incorrecto con [HECHO]. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 30min |
| **Dependencias** | Ninguna |

---

### PRD-07 | recordMovement() — invariante de inventario sin cobertura en Master Bible

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Alguien escribe directamente a `pos_inventory` sin usar `recordMovement()` |
| **Impacto** | Movimientos de inventario sin audit trail; conteo incorrecto |
| **Evidencia** | Dashboard Bible §5.1 Regla 1 |
| **Bible afectada** | Master Bible §4, Domain Bible §4 |
| **Descripción** | Dashboard Bible documenta que `recordMovement()` es la única puerta de entrada al inventario. Esta es una invariante crítica de integridad pero no está en Master Bible §4 (Invariantes del sistema) ni en Domain Bible §4. |
| **Recomendación** | Agregar como Invariante #N en Master Bible §4 y Domain Bible §4: "Todo movimiento de inventario debe pasar por `recordMovement()`. Nunca escribir directamente a `pos_inventory` o `pos_inventory_movements`." |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 30min |
| **Dependencias** | Ninguna |

---

### PRD-08 | Endpoints API sin cobertura documental

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Ingenieros modifican endpoints sin entender qué hacen |
| **Impacto** | Bugs silenciosos en merge de órdenes, ajustes de market |
| **Evidencia** | Domain Bible §12 menciona `/api/pos/merge-orders`, `/api/pos/adjust-market`, `/api/pos/deduct-market` |
| **Bible afectada** | Engineering Bible §3.2 |
| **Descripción** | Tres endpoints existen en el sistema pero no están documentados en Engineering Bible. |
| **Recomendación** | 1. Verificar que los archivos existen en `src/app/api/pos/`. 2. Leer cada uno y documentar en Engineering Bible §3.2: propósito, parámetros, Transaction A/B, errores posibles. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 2h |
| **Dependencias** | Ninguna |

---

### PRD-09 | Lista de agentes IA — dos listas en conflicto

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Una de las dos listas está desactualizada |
| **Impacto** | Confusión sobre qué agentes existen y qué hacen |
| **Evidencia** | Operations Bible §3.5 (13 agentes con descripción operativa), Engineering Bible §5 (lista con distinto nivel de detalle) |
| **Bible afectada** | Ambos |
| **Descripción** | Dos Bibles listan los agentes de IA con distintos nombres y descripciones. No está claro cuál es la lista canónica. |
| **Recomendación** | 1. Engineering Bible §5 debe ser la lista canónica (con nombre, propósito técnico, schedule, tabla de output). 2. Operations Bible §3.5 debe describir el impacto operativo de cada agente y referenciar Engineering Bible para detalles técnicos. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 1h |
| **Dependencias** | Ninguna |

---

### PRD-10 | pos_market_stock — no en Source of Truth del Master Bible

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Operaciones de market sin contexto de arquitectura |
| **Impacto** | Cambios en el módulo de market sin saber qué tabla afectan |
| **Evidencia** | Domain Bible §12 |
| **Bible afectada** | Master Bible §7 (Source of Truth), Domain Bible §4 |
| **Descripción** | `pos_market_stock` aparece en Domain Bible pero no en el mapa de Source of Truth del Master Bible. El módulo de market es parte del sistema pero no tiene cobertura en el Master Bible. |
| **Recomendación** | Agregar `pos_market_stock` al mapa de Source of Truth del Master Bible y verificar si existe una tabla separada o si es parte de `pos_inventory`. |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 30min |
| **Dependencias** | Ninguna |

---

### PRD-11 | Event store shadow mode — sección huérfana en POS Bible

| Campo | Valor |
|---|---|
| **Prioridad** | P1 |
| **Riesgo** | Información duplicada y fragmentada sobre el Event Store |
| **Impacto** | Confusión sobre dónde está la fuente de verdad del Event Store |
| **Evidencia** | POS Bible §3.8 (3 líneas, [INFERENCIA]), Engineering Bible §8 (sección completa) |
| **Bible afectada** | POS Bible §3.8 |
| **Descripción** | POS Bible §3.8 es una sección de 3 líneas sobre el event store en shadow mode. Engineering Bible §8 tiene una sección completa y más precisa. La sección del POS Bible es huérfana y puede divergir. |
| **Recomendación** | Eliminar POS Bible §3.8 y reemplazar con: "→ Ver Engineering Bible §8 para la arquitectura completa del Event Store." |
| **Tipo** | DOCUMENTACIÓN |
| **Tiempo estimado** | 15min |
| **Dependencias** | Ninguna |

---

## DOCUMENTACIÓN — P2

> Contradicciones entre Bibles que deben resolverse contra el código, nunca por votación entre documentos. No urgente pero importantes para mantener las Bibles como fuente confiable.

---

### DOC-01 | STALE_WRITE_CONFLICT vs STALE_WRITE_REJECTED — terminología

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Domain Bible §3.4, Glosario |
| **Fix:** Actualizar Domain Bible §3.4 y Glosario: `STALE_WRITE_REJECTED` → `STALE_WRITE_CONFLICT`. Código confirma: `pos-offline-db.ts` línea 20. |

---

### DOC-02 | revision vs order_revision — campo OCC

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Domain Bible §3.4 |
| **Fix:** Actualizar Domain Bible §3.4: `order_revision` → `revision`. Código confirma: `route.ts:221`. Verificar también el nombre de la columna real en `pos_orders`. |

---

### DOC-03 | SDK de Supabase — regla absoluta vs excepción de auth

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Master Bible Regla R7 |
| **Fix:** Actualizar Master Bible R7: "SDK no se usa para queries de datos en Next.js. Excepción: `supabase.auth.getSession()` en el cliente del dashboard (`data.ts`)." |

---

### DOC-04 | kds_status vs kds_item_status — campo de estado KDS en pos_orders

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Master Bible diagrama, POS Bible §8.4, Domain Bible I7 |
| **Fix:** Verificar schema de `pos_orders` en Supabase. Actualizar Master Bible si usa `kds_status` incorrecto. Mayoría de Bibles dice `kds_item_status`. |

---

### DOC-05 | pos_staff vs staff — nombre de tabla

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | POS Bible Appendix A |
| **Fix:** Verificar nombre real en Supabase. Si es `pos_staff`, actualizar POS Bible Appendix A. |

---

### DOC-06 | Bridge captura eventos Wansoft — aspiración vs implementación

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Master Bible §2.3 |
| **Fix:** Verificar `main.js` del bridge. Si no hay captura de Wansoft, actualizar Master Bible §2.3 con [PENDIENTE] o eliminar la afirmación. |

---

### DOC-07 | Estado inicial de orden — nueva vs abierta

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Operations Bible §6.1 |
| **Fix:** Parte de PRD-01. Una vez acordado el estado canónico, actualizar Operations Bible. |

---

### DOC-08 | Estado inicial de orden — anulada vs cancelada

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Operations Bible §6.1 |
| **Fix:** Parte de PRD-01. Determinar si `anulada` existe como estado en el código o es sinónimo de `cancelada`. |

---

### DOC-09 | Duplicación: Transaction A/B en tres Bibles

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 2h | Product Vision Bible §2.9, Master Bible §2 |
| **Fix:** Engineering Bible §3.2 es el lugar canónico para la implementación técnica de Transaction A/B. Product Vision Bible §2.9 debe referenciar y conservar solo el rationale de negocio. Master Bible §2 puede mantener el Decision Log pero referenciar Engineering para detalles. |

---

### DOC-10 | Duplicación: OCC e idempotencia en cuatro Bibles

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 2h | Domain Bible §3.4, Product Vision Bible §5.3, Master Bible §2 |
| **Fix:** Engineering Bible §3.4 es canónico para implementación. Los otros tres referencian. Cada uno mantiene solo su ángulo propio (dominio, producto, decisión arquitectónica). |

---

### DOC-11 | Duplicación: Rationale de turno obligatorio

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 1h | Master Bible R2, Domain Bible I1, Operations Bible §5.1, Product Vision Bible §5.2 |
| **Fix:** Cada Bible mantiene su ángulo (invariante en Domain, proceso en Operations, decisión en Master, principio en Vision). Eliminar texto duplicado entre ellos, no el contenido específico de cada ángulo. |

---

### DOC-12 | Duplicación: offline-first en tres Bibles

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 1h | Master Bible D3, Engineering Bible §3.6, Product Vision Bible §2.10 |
| **Fix:** Product Vision Bible §2.10 tiene el rationale más completo. Engineering Bible §3.6 tiene los detalles técnicos. Master Bible §2 D3 mantiene la decisión. Las tres pueden coexistir si cada una tiene su ángulo propio. |

---

### DOC-13 | Duplicación: data flywheel

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Master Bible §4.2 |
| **Fix:** Master Bible §4.2 → referenciar Product Vision Bible §3.3. Eliminar la descripción duplicada. |

---

### DOC-14 | Duplicación: offline boot debt

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Product Vision Bible §10, §13 |
| **Fix:** Engineering Bible es canónico para deuda técnica de offline boot. Product Vision Bible puede mencionar el impacto de negocio y referenciar Engineering Bible. |

---

### DOC-15 | R1: MANUAL-OPERATIVO.md — documento referenciado sin verificar existencia

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 1h | Operations Bible (12+ referencias) |
| **Ver OPS-02 para acción completa.** |

---

### DOC-16 | R2: ONBOARDING-PLAYBOOK.md — referenciado sin verificar

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Operations Bible §4.2 |
| **Fix:** `ls /Users/danielrg/fullsite/docs/playbooks/`. Si no existe, documentar el gap como [PENDIENTE] en Operations Bible. |

---

### DOC-17 | R3: BRIDGE.md y EVENT-STORE.md — estado en familia Bible

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 1h | Engineering Bible Open Questions |
| **Fix:** Verificar existencia en `docs/reference/`. Si existen y tienen contenido relevante, decidir si absorberlos en Engineering Bible o referenciarlos explícitamente. |

---

### DOC-18 | R4: docs/DECISIONS.md — ADR principal sin cobertura en Master Bible

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Master Bible §6.5 |
| **Fix:** Verificar existencia. Si existe, agregar al Source of Truth map del Master Bible como "registro de ADRs históricos". |

---

### DOC-19 | R5: Tres ADRs específicos — existen o son aspiracionales

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Product Vision Bible |
| **Fix:** `ls /Users/danielrg/fullsite/docs/` buscando ADR-CONCURRENCY.md, ADR-TURNO-LIFECYCLE.md, ADR-FISCAL-MODEL.md. Si no existen, marcar referencias como [PENDIENTE]. |

---

### DOC-20 | R6: pos-logica-operativa.md — archivo de archive en cadena activa

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | POS Bible §12.9 |
| **Fix:** El archivo existe en `docs/archive/`. Si sigue siendo relevante, decidir si su contenido activo pertenece al POS Bible. Si está deprecado, actualizar la referencia a [PENDIENTE] o eliminarla. |

---

### DOC-21 | R7: COMPANY_BRAIN.md y FOUNDER.md — estado no documentado

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Product Vision Bible |
| **Fix:** Documentar qué son estos archivos en el Source of Truth map del Master Bible: "documentos de fundador, no Bibles técnicas, fuente de principios de visión." |

---

### DOC-22 | R8: STRATEGIC-DECISIONS.md y WHY-RESTAURANTS-SWITCH.md

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Product Vision Bible §4.1 |
| **Fix:** Verificar existencia en `docs/strategy/`. Si existen, documentarlos en el Source of Truth map del Master Bible. |

---

### DOC-23 | L1: Sistema de recetas dual — sin etiqueta de evidencia

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Domain Bible §L1 |
| **Fix:** Parte de ARC-01/ARC-02. Después de verificar el SQL, agregar [HECHO] con la información real. |

---

### DOC-24 | L2: Estados de pos_turnos — [INFERENCIA] sobre campo central

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Engineering Bible §6.5 |
| **Fix:** Verificar en Supabase los valores de `status` en `pos_turnos`. Actualizar de [INFERENCIA] a [HECHO]. |

---

### DOC-25 | L3: Inmutabilidad del Event Store a nivel DB

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 1h | Product Vision Bible §8 Invariante #5 |
| **Fix:** Verificar en Supabase si existe un trigger de bloqueo de DELETE/UPDATE en `pos_events`. Si existe: actualizar a [HECHO]. Si no: marcarlo como [PENDIENTE] y crear el trigger. |

---

### DOC-26 | L4: Separación de infra de agentes — [INFERENCIA]

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Product Vision Bible §8 Invariante #3 |
| **Fix:** Si este invariante es crítico para la disponibilidad del POS, verificar que los agentes no comparten infraestructura con el POS. Actualizar etiqueta. |

---

### DOC-27 | RQ1: pago_métodos con tilde — rationale faltante

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Dashboard Bible §7, G9 |
| **Fix:** Verificar en `wansoft_daily` el nombre exacto de la columna. Documentar si es un encoding issue del scraper o convención de Wansoft. |

---

### DOC-28 | RQ3: efectivo < 100 = porcentaje — casos borde

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 30min | Dashboard Bible §9.1 |
| **Fix:** Documentar el caso borde: ¿qué pasa si un turno tiene exactamente $98 MXN en efectivo? ¿Se trata como 98% o como $98? Agregar test case o validación al scraper. |

---

### DOC-29 | H3: Widget del Home — sección huérfana

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Dashboard Bible §6.3, Master Bible |
| **Fix:** Agregar referencia en Master Bible §5 a Dashboard Bible §6.3. |

---

### DOC-30 | H4: Estados de evolución del producto (0→N) — sin referencia en Master Bible

| Tipo | Tiempo | Bible afectada |
|---|---|---|
| DOCUMENTACIÓN | 15min | Master Bible §5, Product Vision Bible §6 |
| **Fix:** Agregar en Master Bible §5: "→ Ver Product Vision Bible §6 para los estados de evolución del producto y criterios de avance entre estados." |

---

## Índice de dependencias

Para planificar el sprint, estos gaps tienen dependencias entre sí:

```
OPS-01 (Facturama CSD) ──────────────────────────────── Independiente, URGENTE
ARC-04 (409 behavior) ──────────────────────────────── Independiente
ARC-03 (r1_save_order INSERT/UPDATE) ───────────────── Independiente

ARC-01 (doble deducción)
  └── depende de: acceso SQL r1_reconcile_order
  └── bloquea: ARC-02 (tabla de recetas)
  └── bloquea: DOC-23 (L1 en Domain Bible)

ARC-02 (tabla de recetas)
  └── depende de: ARC-01

PRD-01 (máquina de estados)
  └── bloquea: DOC-07, DOC-08

ARC-06 (IndexedDB versioning)
  └── bloquea: Fase 2 (KDS local-first)
```

---

## Próximo sprint sugerido (para revisión con Daniel)

| Gap | Tipo | Tiempo | Criterio de cierre |
|---|---|---|---|
| OPS-01 | Operación | 2-4h | CSD renovado, facturas timbran en test |
| ARC-04 | Código + Doc | 2h | Comportamiento 409 verificado con prueba real |
| ARC-03 | Documentación | 30min | SQL de r1_save_order leído y documentado |
| ARC-01 | Código + Doc | 2-3h | SQL de r1_reconcile_order leído, protocolo documentado |
| PRD-01 | Código + Doc | 2h | Máquina de estados canónica con [HECHO] en 3 Bibles |
| DOC-01 | Documentación | 30min | STALE_WRITE_REJECTED → STALE_WRITE_CONFLICT en Domain Bible |
| DOC-02 | Documentación | 30min | order_revision → revision en Domain Bible |
| DOC-03 | Documentación | 15min | Master Bible R7 actualizado con excepción auth SDK |

**Total sprint sugerido: ~12h**

---

_Versión 1.0 — 2026-07-23_
_Fuente: QA Pass de 7 Bibles + revisión de route.ts + pos-offline-db.ts_
_Próxima revisión: después de AMALAY Fase 1 + inicio de Fase 2_
