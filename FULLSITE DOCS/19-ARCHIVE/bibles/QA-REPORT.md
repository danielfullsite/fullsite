# QA Report — Fullsite Bible Audit
> Auditoría de consistencia interna de los 7 Bibles + 2 archivos de código
> Fecha: 2026-07-23
> Auditor: Claude (QA Lead)
> Scope: FULLSITE-MASTER-BIBLE.md, FULLSITE-POS-BIBLE.md, FULLSITE-ENGINEERING-BIBLE.md,
>        FULLSITE-DOMAIN-BIBLE.md, FULLSITE-DASHBOARD-BIBLE.md, FULLSITE-OPERATIONS-BIBLE.md,
>        FULLSITE-PRODUCT-VISION-BIBLE.md + route.ts + pos-offline-db.ts

---

## Resumen ejecutivo

| Categoría | Total | Crítico | Alto | Medio | Bajo |
|---|---|---|---|---|---|
| C — Contradicciones | 8 | 3 | 3 | 2 | — |
| D — Duplicaciones | 6 | — | 3 | 3 | — |
| R — Referencias rotas | 8 | 2 | 3 | 3 | — |
| T — Inconsistencias terminología | 7 | 2 | 3 | 2 | — |
| L — Etiquetas de evidencia faltantes | 5 | 1 | 2 | 2 | — |
| G — Gaps de cobertura | 9 | 3 | 4 | 2 | — |
| RQ — Rationale faltante | 5 | — | 2 | 3 | — |
| H — Secciones huérfanas | 5 | — | 2 | 3 | — |
| **TOTAL** | **53** | **11** | **22** | **20** | — |

Hallazgos críticos que bloquean el uso confiable de los Bibles como fuente de verdad:
- KDS write target (C1): dos Bibles dicen campo separado, una dice mismo campo — el código no deja claro cuál es correcto
- 409 offline behavior (C3): Operations Bible documenta un bug como comportamiento esperado
- Error term inconsistency (T1): `STALE_WRITE_CONFLICT` vs `STALE_WRITE_REJECTED` — dos términos distintos para el mismo error en Bibles distintas
- Dual recipe system (G3): ningún Bible confirma qué tabla usa `r1_reconcile_order` — posible doble deducción silenciosa

---

## C — Contradicciones

### C1 [CRÍTICO] KDS write target

| Bible | Afirmación |
|---|---|
| Operations Bible §DT-4 | KDS escribe al campo `items` (mismo que el POS) |
| POS Bible §8.4 | KDS escribe a columna separada `kds_item_status` |
| Domain Bible Invariante I7 | KDS escribe a columna separada `kds_item_status` |

Impacto: si Operations Bible tiene razón, el KDS sobreescribe ítems de la orden con cada actualización de status. Si POS/Domain tienen razón, existe una columna que no está documentada en el Master Bible ni en el schema de Domain Bible §5. No hay forma de resolver esto sin revisar el SQL o la tabla `pos_orders` en Supabase.

Acción sugerida: verificar columnas de `pos_orders` en Supabase. Actualizar los tres Bibles al mismo claim con etiqueta [HECHO].

---

### C2 [ALTO] Máquina de estados de la orden

| Bible | Estados |
|---|---|
| POS Bible §6.1 | 7 estados: `nueva → enviada → preparando → lista → entregada → cerrada → cancelada` |
| Operations Bible §6.1 | 5 estados: `abierta → enviada → cerrada / cancelada / anulada` |
| Domain Bible §3.2 | 6 estados: `nueva → enviada → preparando → lista → cerrada → cancelada` |

Las diferencias concretas:
- Operations Bible llama `abierta` al estado inicial; POS y Domain llaman `nueva`
- Operations Bible no incluye `preparando`, `lista`, ni `entregada`
- Operations Bible agrega `anulada` que no está en POS Bible ni Domain Bible
- Domain Bible no tiene `entregada`

Acción sugerida: acordar una máquina de estados canónica (POS Bible §6.1 parece la más completa), actualizar Operations y Domain, y documentar la diferencia entre `cancelada` y `anulada` si ambas existen.

---

### C3 [CRÍTICO] Comportamiento del sync offline ante 409

| Bible | Afirmación |
|---|---|
| Operations Bible §DT-2 | El sync offline silencia 409 — lo trata como éxito |
| Engineering Bible §4.3 | 409 se clasifica como STALE_WRITE_CONFLICT — terminal, no se reintenta, no se sobreescribe |
| Master Bible §3.4 | STALE_WRITE_CONFLICT nunca se auto-reintenta |
| `pos-offline-db.ts` (código) | `SyncErrorClass` incluye `STALE_WRITE_CONFLICT` como clase terminal explícita |

Operations Bible §DT-2 documenta un bug como si fuera comportamiento esperado. El código y los otros tres Bibles son consistentes entre sí: 409 = STALE_WRITE_CONFLICT = terminal. Si Operations Bible está describiendo comportamiento real (no el diseño), hay un bug activo en producción que silencia conflictos de escritura.

Acción sugerida: verificar el comportamiento real del sync worker ante 409. Si hay bug, corregirlo y actualizar Operations Bible. Si Operations Bible está equivocado, corregir Operations Bible.

---

### C4 [ALTO] Bridge captura eventos de Wansoft

| Bible | Afirmación |
|---|---|
| Master Bible §2.3 | El bridge captura eventos de Wansoft para el Event Store |
| Engineering Bible §12.3 (DISCREPANCY 1) | `main.js` del bridge no tiene código de captura de eventos Wansoft |

Engineering Bible documenta esta discrepancia explícitamente. Master Bible no la refleja. La captura de eventos Wansoft vía bridge puede ser una aspiración no implementada, o puede existir en otro archivo.

Acción sugerida: verificar `main.js` del bridge. Actualizar Master Bible §2.3 con la etiqueta correcta ([INFERENCIA] o [PENDIENTE]).

---

### C5 [MEDIO] Uso del SDK de Supabase en Next.js

| Bible | Afirmación |
|---|---|
| Master Bible Regla R7 | SDK nunca se usa en Next.js (absoluto, sin excepción) |
| Engineering Bible §3.10 | Excepción: SDK se usa en `data.ts` para `supabase.auth.getSession()` en el cliente del dashboard |
| Dashboard Bible §3.5 | "SDK solo se usa para auth, nunca para queries de datos" |

La regla en Master Bible es absoluta pero incorrecta. La excepción de auth es real y está documentada en Engineering y Dashboard. Master Bible necesita actualizar R7 para reflejar la excepción.

Acción sugerida: actualizar Master Bible R7 a: "SDK no se usa en Next.js API routes para queries de datos. Excepción: `supabase.auth.getSession()` en el cliente del dashboard (`data.ts`)."

---

### C6 [ALTO] CierreCajaWizard — número de pasos

| Bible | Afirmación |
|---|---|
| POS Bible §11.3 | CierreCajaWizard tiene 2 pasos |
| Operations Bible §5.4 | CierreCajaWizard tiene 4 pasos (billetes, monedas, comparación+diferencia, PIN) |

Acción sugerida: verificar el componente `CierreCajaWizard` en el código. Actualizar el Bible incorrecto.

---

### C7 [MEDIO] Tabla de permisos — roles incluidos

| Bible | Roles documentados |
|---|---|
| POS Bible §5.2 | `admin`, `supervisor`, `mesero`, `cajero` |
| Operations Bible §5.6 | `admin`, `gerente`, `mesero`, `cajero` (no incluye `supervisor`) |

La inconsistencia puede reflejar que `supervisor` y `gerente` son el mismo rol con distintos nombres, o puede ser un gap real. En ninguno de los dos Bibles está documentado si estos son los roles configurados actualmente en AMALAY o si son los roles canónicos del sistema.

Acción sugerida: verificar la tabla `pos_staff` en Supabase para el conjunto de roles reales. Unificar ambos Bibles.

---

### C8 [CRÍTICO → BUG P0 CONFIRMADO] Tabla canónica de recetas / doble deducción activa

**Estado:** Promovido de contradicción documental a bug operativo P0. Ver `R1-INVENTORY-CUTOVER.md`.

**Evidencia obtenida 2026-07-25:**

| Sistema | Tabla | Gate de autoridad | Estado |
|---------|-------|-------------------|--------|
| A — `deductIngredientsForOrder()` TypeScript | `pos_recipes_old` | Ninguno — siempre corre | ACTIVO |
| B — `r1_reconcile_item` SQL | `pos_recipe_versions + pos_recipe_lines` | `sale_authority = 'r1'` ✓ | ACTIVO |

```
pos_mutation_authority: sale_authority = 'r1' desde 2026-07-14
pos_item_inventory_policy: 178 items en modo 'recipe', 178 versiones activas en pos_recipe_versions
pos_reconciliation_results: 233 RECONCILED (R1 ha deducido exitosamente)
Cross-reference orders: 6 items de 2 órdenes con tipo 'deduction' (A) Y 'RECONCILED' (B) = DOBLE DEDUCCIÓN CONFIRMADA
```

**Causa raíz:** El cutover del 14-jul activó el gate SQL de R1 pero no desactivó `deductIngredientsForOrder()` en TypeScript. Ambos escriben a `pos_inventory` para los mismos 178 items.

**Próxima acción:** Revisar `R1-INVENTORY-CUTOVER.md` → aprobar Paso 0 (corrección de datos) → implementar Paso 1 (gate TypeScript). No tocar código hasta aprobación de Daniel.

---

## D — Duplicaciones

### D1 [ALTO] Rationale de Transaction A/B

Documentado con explicación completa en:
- Master Bible §2 (Decisión D2)
- Engineering Bible §3.2
- Product Vision Bible §2.9

La Vision Bible replica el rationale completo en vez de referenciar Engineering Bible §3.2 donde ya existe. El principio es válido pero el mantenimiento de tres copias paralelas crea riesgo de divergencia.

Acción sugerida: Vision Bible §2.9 → referenciar Engineering Bible §3.2 para la implementación técnica. Mantener el rationale de negocio en Vision Bible solamente.

---

### D2 [ALTO] Rationale de OCC e idempotencia

Documentado con explicación completa en:
- Master Bible §2 (Decisión D6)
- Engineering Bible §3.4
- Domain Bible §3.4
- Product Vision Bible §5.3

Acción sugerida: consolidar en Engineering Bible §3.4 como único lugar de implementación. Otros Bibles referencian.

---

### D3 [ALTO] Rationale de turno obligatorio

Documentado con explicación completa en:
- Master Bible (Regla R2)
- Domain Bible Invariante I1 + §5.3
- Operations Bible §5.1
- Product Vision Bible §5.2

Acción sugerida: Domain Bible es el lugar correcto para el invariante. Operations Bible para el proceso operativo. Master Bible para la decisión de arquitectura. Vision Bible para el principio de negocio. Los cuatro pueden co-existir pero cada uno debe tener un ángulo distinto, no el mismo texto duplicado.

---

### D4 [MEDIO] Rationale de offline-first

Documentado con explicación completa en:
- Master Bible (Decisión D3)
- Engineering Bible §3.6
- Product Vision Bible §2.10

Acción sugerida: Vision Bible §2.10 contiene el rationale más completo (con alternativas descartadas). Los otros dos pueden referenciar y agregar detalles técnicos/operativos propios.

---

### D5 [MEDIO] Descripción del data flywheel

Documentado en:
- Product Vision Bible §3.3 (con diagrama completo)
- Master Bible §4.2 (descripción separada)

Acción sugerida: Master Bible §4.2 → referenciar Vision Bible §3.3.

---

### D6 [MEDIO] Limitaciones del offline boot

Documentado en:
- Product Vision Bible §10 (Limitación #1) y §13 (Open Question)
- Engineering Bible §12 (Open Question)
- Operations Bible §5.3 (mención)

Acción sugerida: Engineering Bible es el lugar canónico para deuda técnica de offline boot. Vision Bible puede referenciar con la perspectiva de impacto de negocio.

---

## R — Referencias rotas

### R1 [CRÍTICO] MANUAL-OPERATIVO.md

Operations Bible referencia este documento 12+ veces (§3.5, §4.1, §5.4, §7.2, etc.) incluyendo citas a "D9 in MANUAL-OPERATIVO.md" como rationale para invariantes. El documento no pertenece a la familia Bible y no está mencionado por ningún otro Bible.

Impacto: rationale de invariantes en Operations Bible es imposible de verificar sin encontrar este documento.

Acción sugerida: (a) verificar si `docs/MANUAL-OPERATIVO.md` existe y si es un documento activo; (b) si existe, decidir si debe ser absorbido como un Bible #8 o referenciado explícitamente; (c) si no existe, marcar los rationales que dependen de él como [INFERENCIA].

---

### R2 [ALTO] /docs/playbooks/ONBOARDING-PLAYBOOK.md

Operations Bible §4.2 referencia este documento como la fuente del proceso de onboarding. No está mencionado por ningún otro Bible. No se sabe si existe.

Acción sugerida: verificar existencia. Si no existe, es un Gap de cobertura (ver G7).

---

### R3 [ALTO] docs/reference/BRIDGE.md y docs/reference/EVENT-STORE.md

Engineering Bible Open Questions referencia estos dos documentos para detalles técnicos del bridge y el event store. No están en la familia Bible.

Acción sugerida: verificar existencia. Si existen, evaluar si su contenido debe incorporarse al Engineering Bible.

---

### R4 [ALTO] docs/DECISIONS.md

Master Bible §6.5 referencia `docs/DECISIONS.md` múltiples veces como el registro de ADRs. No está en la familia Bible ni mencionado por los otros Bibles como fuente de decisiones de arquitectura.

Acción sugerida: verificar existencia. Si existe, el Master Bible debe documentarlo explícitamente en su Source of Truth map.

---

### R5 [MEDIO] ADR-CONCURRENCY.md, ADR-TURNO-LIFECYCLE.md, ADR-FISCAL-MODEL.md

Product Vision Bible referencia tres ADRs como fuentes de decisiones (§5.3, §5.2, §5.7). Ningún otro Bible los menciona. No se sabe si existen o si son documentos aspiracionales.

Acción sugerida: verificar existencia de estos tres ADRs. Si no existen, las referencias son [PENDIENTE] y deben marcarse como tal.

---

### R6 [MEDIO] docs/archive/pos-logica-operativa.md

POS Bible §12.9 referencia este archivo como fuente de decisiones anteriores sobre la lógica operativa del POS. Archivo de archivo — probablemente existe pero no está en la cadena activa de documentación.

---

### R7 [MEDIO] COMPANY_BRAIN.md y FOUNDER.md

Product Vision Bible §2.2, §2.13, y §2.8 citan `COMPANY_BRAIN.md` y `FOUNDER.md` como fuentes de frases y principios. Ningún Bible documenta qué son estos archivos ni dónde viven. No son Bibles. Su estado (activos, deprecados, absorbidos) es desconocido.

---

### R8 [MEDIO] STRATEGIC-DECISIONS.md y WHY-RESTAURANTS-SWITCH.md

Product Vision Bible §4.1 referencia estos dos documentos como fuentes de validación. No están documentados en ningún otro Bible ni en el Source of Truth map del Master Bible.

---

## T — Inconsistencias de terminología

### T1 [CRÍTICO] Error de conflicto OCC

| Término | Usado en |
|---|---|
| `STALE_WRITE_CONFLICT` | Master Bible, Engineering Bible, POS Bible, `pos-offline-db.ts` (código), `save-order/route.ts` (implícito) |
| `STALE_WRITE_REJECTED` | Domain Bible §3.4 y Glosario Domain Bible |

El código usa `STALE_WRITE_CONFLICT`. Domain Bible usa `STALE_WRITE_REJECTED`. Son dos nombres distintos para el mismo error terminal de OCC. Cualquier consumidor del Domain Bible que busque este error en el código no lo encontrará.

Acción sugerida: actualizar Domain Bible §3.4 y Glosario a `STALE_WRITE_CONFLICT`.

---

### T2 [CRÍTICO] Campo de revisión OCC

| Término | Usado en |
|---|---|
| `revision` | Engineering Bible, Master Bible, `save-order/route.ts` (`expected_revision` como parámetro de la RPC) |
| `order_revision` | Domain Bible §3.4 |

El código en `route.ts` extrae `expected_revision` del body y lo pasa como `p_expected_revision` a la RPC. La variable de respuesta se llama `revision` (línea 221: `revision: committedRevision`). Domain Bible llama a este campo `order_revision`.

Acción sugerida: verificar el schema de `pos_orders` en Supabase para confirmar el nombre real de la columna. Unificar todos los Bibles al nombre real.

---

### T3 [ALTO] Tabla de staff

| Término | Usado en |
|---|---|
| `pos_staff` | Master Bible, Engineering Bible, Domain Bible, Operations Bible, Dashboard Bible |
| `staff` (sin prefijo) | POS Bible Appendix A |

Acción sugerida: verificar nombre real de la tabla en Supabase. Actualizar POS Bible Appendix A si es incorrecto.

---

### T4 [ALTO] Tabla canónica de recetas (terminología)

| Término | Usado en |
|---|---|
| `pos_recipes_old` | Domain Bible, Dashboard Bible |
| `pos_recipes` | Operations Bible §7 |
| `pos_recipe_versions` + `pos_recipe_lines` | Domain Bible §7 (Source of Truth como canónico) |

Tres nombres distintos para lo que puede ser una o dos tablas. Ver también C8.

---

### T5 [ALTO] Campo de estado KDS en la orden

| Término | Usado en |
|---|---|
| `kds_status` | Master Bible (diagrama de flujo) |
| `kds_item_status` | POS Bible §8.4, Domain Bible Invariante I7, Engineering Bible |

Acción sugerida: verificar schema de `pos_orders` en Supabase. Actualizar Master Bible si `kds_status` es incorrecto.

---

### T6 [MEDIO] Estados de la cola de impresión

| Término | Usado en |
|---|---|
| `printing` / `success` | Operations Bible §3.3 |
| `retrying` / `printed` | POS Bible §6.4, Engineering Bible §6.4 |

Acción sugerida: verificar el bridge o el tipo `PrintJob` en el código para los estados reales. Unificar ambos Bibles.

---

### T7 [MEDIO] Estado inicial de la orden

| Término | Usado en |
|---|---|
| `nueva` | POS Bible §6.1, Domain Bible §3.2 |
| `abierta` | Operations Bible §6.1 |

Relacionado con C2. El estado inicial tiene dos nombres distintos.

---

## L — Etiquetas de evidencia faltantes

### L1 [CRÍTICO] Dual recipe system en Domain Bible

Domain Bible §L1 documenta los dos sistemas de recetas (pos_recipes_old vs pos_recipe_versions) como "P0 debt" pero no tiene etiqueta de evidencia ([HECHO]/[INFERENCIA]/[PENDIENTE]) sobre el estado actual de la migración ni sobre qué usa realmente `r1_reconcile_order`.

Impacto: no se puede determinar el nivel de riesgo real sin esta información.

---

### L2 [ALTO] pos_turnos status en Engineering Bible

Engineering Bible §6.5 documenta los estados de `pos_turnos` con etiqueta [INFERENCIA]. Este es un campo central de la lógica del turno obligatorio. La inferencia puede ser incorrecta.

Acción sugerida: verificar los estados reales del turno en el código o en el schema de Supabase.

---

### L3 [ALTO] Inmutabilidad del event store a nivel DB

Product Vision Bible §8 Invariante #5 dice que el log de auditoría es inmutable, pero agrega: "[INFERENCIA] La inmutabilidad a nivel de base de datos no fue verificada explícitamente en el código." Este invariante es central para la confianza en los datos del Event Store.

Acción sugerida: verificar si existe un trigger de bloqueo de DELETE en `pos_events` en Supabase. Actualizar la etiqueta.

---

### L4 [MEDIO] Separación de infraestructura de agentes en Product Vision Bible

Product Vision Bible §8 Invariante #3 dice que la separación de infraestructura de los agentes respecto al POS core está "[INFERENCIA] diseñada pero no completamente verificada en condiciones de falla."

Acción sugerida: si este invariante es crítico para la disponibilidad del POS, verificarlo o documentar el riesgo explícitamente.

---

### L5 [MEDIO] Reconcile order en save-order/route.ts

El código en `route.ts` llama a `r1_reconcile_order` con solo `p_client_id` y `p_order_id` (líneas 160-163). No hay documentación en ningún Bible sobre qué tablas lee internamente esta RPC ni cómo maneja el caso de que el mismo item ya haya sido deducido por `deductIngredientsForOrder()` en el cliente. Esta es una etiqueta faltante de nivel [HECHO] vs [INFERENCIA] que tiene impacto directo en el riesgo de doble deducción.

---

## G — Gaps de cobertura

### G1 [CRÍTICO] Qué tabla usa r1_reconcile_order

Ningún Bible documenta si `r1_reconcile_order` lee de `pos_recipe_versions + pos_recipe_lines` o de `pos_recipes_old`. Esta pregunta está abierta en Domain Bible Open Questions pero sin respuesta. Si lee de `pos_recipe_versions` y `deductIngredientsForOrder()` (cliente) lee de `pos_recipes_old`, la deducción puede ocurrir dos veces con datos distintos.

Acción sugerida: revisar el SQL de `r1_reconcile_order` en Supabase. Este es el gap de mayor riesgo operativo.

---

### G2 [CRÍTICO] Doble deducción de inventario — protocolo de resolución

Domain Bible §3.6 documenta que existe un "Sistema A" (cliente, `deductIngredientsForOrder()`) y un "Sistema B" (servidor, `r1_reconcile_order`). No existe en ningún Bible un protocolo claro sobre:
- ¿Cuándo se ejecuta cada uno?
- ¿Qué pasa si ambos se ejecutan para la misma orden?
- ¿Hay protección de idempotencia en el sistema B para evitar deducción doble?

Este gap no está en ningún Bible, incluyendo Master Bible, Engineering Bible, o Domain Bible §3.6.

---

### G3 [CRÍTICO] r1_save_order — INSERT vs UPDATE

Engineering Bible Open Questions documenta esta pregunta: "¿r1_save_order hace INSERT o UPDATE?" El SQL no está en el repo (Engineering Bible §12.3 DISCREPANCY 3). `route.ts` llama a esta RPC pero no puede responder la pregunta. Si hace solo UPDATE, las órdenes nuevas fallarían silenciosamente.

Acción sugerida: verificar el SQL de `r1_save_order` en Supabase.

---

### G4 [ALTO] Módulos POS no documentados en POS Bible §1.3

POS Bible §1.3 lista los módulos del POS pero omite:
- `/pos/auditoria` — mencionado en Operations Bible
- `/pos/monitor` — mencionado en Operations Bible
- `/pos/inventario` — mencionado en Operations Bible
- `/pos/compras` — mencionado en Operations Bible

Acción sugerida: verificar si estos módulos existen en el filesystem (`dashboard-app/src/app/pos/`). Si existen, agregarlos a POS Bible §1.3.

---

### G5 [ALTO] Invariante recordMovement() no está en Master Bible

Dashboard Bible §5.1 Regla 1: "recordMovement() es la única puerta de entrada al inventario" — este es un invariante crítico de integridad de datos de inventario. No está en el Master Bible §4 (Invariantes del sistema) ni en el Domain Bible §4.

Acción sugerida: agregar este invariante al Master Bible y al Domain Bible.

---

### G6 [ALTO] Endpoints API no documentados en Engineering Bible

Los siguientes endpoints existen (según Domain Bible y POS Bible) pero no están en la lista de API de Engineering Bible ni en Master Bible:
- `/api/pos/merge-orders` (POS Bible §9.1)
- `/api/pos/adjust-market` (Domain Bible §12)
- `/api/pos/deduct-market` (Domain Bible §12)

---

### G7 [ALTO] Tabla pos_market_stock no en Master Bible Source of Truth

`pos_market_stock` aparece en Domain Bible §12 como tabla para el módulo de mercado/tienda. No está en el Source of Truth map del Master Bible ni en el schema principal del Domain Bible.

---

### G8 [MEDIO] Facturama CSD expira 2026-08-03

Operations Bible Open Questions documenta que el certificado CSD de Facturama expira el 2026-08-03 — en 11 días desde la fecha de esta auditoría. Este dato crítico no aparece en ningún otro Bible ni en el roadmap del Product Vision Bible.

Acción sugerida: crear tarea de renovación de CSD antes de esa fecha. Agregar al horizonte 0 del roadmap del Vision Bible.

---

### G9 [MEDIO] wansoft_daily.pago_métodos — tilde vs sin tilde

Dashboard Bible §7 documenta que `wansoft_daily.pago_métodos` (con tilde) no coincide con `pago_metodos` (sin tilde) en código legacy. Ningún otro Bible lo menciona. El impacto en los reportes de métodos de pago es desconocido.

---

## RQ — Rationale faltante

### RQ1 [ALTO] pago_métodos con tilde en Wansoft

Dashboard Bible §7 documenta la discrepancia de tilde sin explicar por qué Wansoft almacena el valor con tilde. Sin este rationale es imposible saber si es un bug de Wansoft, un encoding issue, o un comportamiento intencional que hay que preservar.

---

### RQ2 [ALTO] NEXT_PUBLIC_DEFAULT_CLIENT_ID='amalay' fallback

Dashboard Bible documenta que el fallback del `client_id` es `'amalay'` hardcodeado. No hay rationale para por qué este fallback es aceptable en una arquitectura multi-tenant. En una instalación para el restaurante #2, este default podría filtrar datos de AMALAY si el header `x-client-id` no se envía.

Acción sugerida: agregar rationale explícito o marcar como [PENDIENTE] para cambiar antes del restaurante #2.

---

### RQ3 [MEDIO] Por qué wansoft_daily.efectivo < 100 = porcentaje

Dashboard Bible §9.1 documenta que cuando `efectivo < 100` se trata como porcentaje. No hay rationale sobre por qué Wansoft usa esta convención ni si hay casos borde donde esto produce resultados incorrectos (ej: un turno con exactamente $98 MXN en efectivo).

---

### RQ4 [MEDIO] Por qué comanda_batches se guarda en PATCH separado

`save-order/route.ts` líneas 110-119 guarda `comanda_batches` en un PATCH separado después del RPC. El comentario dice "Eduardo Jul 21 (Batch 5): avoid modifying the RPC function" pero no hay rationale de por qué no se modificó la RPC. Si el PATCH falla, el KDS no tiene información de batch y "falls back to single card". Este fallback no está documentado en ningún Bible.

---

### RQ5 [MEDIO] Por qué DB_VERSION = 1 en pos-offline-db.ts

`pos-offline-db.ts` línea 6 tiene `DB_VERSION = 1`. No hay rationale en ningún Bible sobre la estrategia de migración de IndexedDB cuando el schema cambia. Si se agrega un store nuevo, ¿cómo se migran los dispositivos de los meseros que ya tienen la v1?

---

## H — Secciones huérfanas

### H1 [ALTO] Operations Bible §3.5 — Los agentes de IA

Operations Bible §3.5 describe 13 agentes de IA con sus nombres y funciones. Esta descripción no está cross-referenciada desde ningún otro Bible. Engineering Bible §5 tiene su propia lista de agentes con diferente nivel de detalle. No está claro cuál es la lista canónica.

Acción sugerida: definir Engineering Bible §5 como la lista canónica de agentes. Operations Bible §3.5 puede describir cómo se experimenta en campo pero debe referenciar Engineering Bible.

---

### H2 [ALTO] POS Bible §3.8 — Event store shadow mode

POS Bible §3.8 es una sección de 3 líneas con etiqueta [INFERENCIA] sobre el event store en shadow mode. No está cross-referenciada desde ningún Bible. Engineering Bible tiene una sección mucho más completa sobre el Event Store.

Acción sugerida: eliminar POS Bible §3.8 y reemplazar con referencia a Engineering Bible.

---

### H3 [MEDIO] Dashboard Bible §6.3 — Widget del Home

Dashboard Bible §6.3 documenta la máquina de estados del widget del Home. No está referenciada desde ningún otro Bible. Si este widget se elimina o cambia, el Bible quedará desactualizado sin que ningún otro documento lo señale.

---

### H4 [MEDIO] Product Vision Bible §6 — Estados del producto (0→N)

Product Vision Bible §6 documenta los estados de evolución 0→N del producto con criterios de entrada/salida. No hay cross-reference a esta sección desde ningún otro Bible, incluyendo el Master Bible. Esta información es relevante para decisiones de prioridad pero es inaccesible para alguien que no lee el Vision Bible completo.

Acción sugerida: agregar referencia en Master Bible §5 a Vision Bible §6 para el roadmap de estados.

---

### H5 [MEDIO] Operations Bible §4.3 — Análisis post-turno

Operations Bible §4.3 describe el proceso de análisis post-turno. No está referenciada desde ningún otro Bible ni desde el Dashboard Bible que documenta las páginas donde ocurre ese análisis.

---

## Plan de acción

### P0 — Bloquea confianza en los Bibles como fuente de verdad

| ID | Acción | Responsable | Estimado |
|---|---|---|---|
| FIX-C3 | Verificar comportamiento real del sync worker ante 409. Si hay bug, corregirlo. Actualizar Operations Bible §DT-2 | Eng | 2h |
| FIX-T1 | Actualizar Domain Bible §3.4 y Glosario: `STALE_WRITE_REJECTED` → `STALE_WRITE_CONFLICT` | Doc | 30min |
| FIX-G1 | Revisar SQL de `r1_reconcile_order` en Supabase. Documentar qué tablas lee en Engineering Bible y Domain Bible | Eng | 1h |
| FIX-G2 | Documentar protocolo de doble deducción en Domain Bible §3.6: ¿cuándo corre cada sistema y cómo se evita la doble deducción? | Eng+Doc | 2h |
| FIX-G3 | Verificar SQL de `r1_save_order` en Supabase — INSERT o UPDATE. Responder Engineering Bible Open Question | Eng | 30min |
| FIX-G8 | Renovar certificado CSD de Facturama antes de 2026-08-03 | Daniel | URGENTE |

### P1 — Correcciones de alta prioridad

| ID | Acción | Responsable | Estimado |
|---|---|---|---|
| FIX-C1 | Verificar columnas de `pos_orders`. Resolver KDS write target. Actualizar Operations Bible §DT-4 o POS Bible §8.4 + Domain Bible I7 | Eng+Doc | 2h |
| FIX-C2 | Acordar máquina de estados canónica. Actualizar Domain Bible y Operations Bible para alinear con POS Bible §6.1 | Doc | 1h |
| FIX-C6 | Verificar `CierreCajaWizard` en código. Actualizar el Bible incorrecto (2 pasos vs 4 pasos) | Eng+Doc | 1h |
| FIX-C8 | Verificar tablas de recetas en Supabase. Documentar si `pos_recipe_versions` existe y está en uso | Eng | 1h |
| FIX-T2 | Verificar columna real en `pos_orders`. Unificar: `revision` vs `order_revision` en todos los Bibles | Doc | 1h |
| FIX-T3 | Verificar nombre real de tabla staff. Actualizar POS Bible Appendix A si es `pos_staff` | Doc | 15min |
| FIX-C5 | Actualizar Master Bible R7 para reflejar la excepción de auth SDK | Doc | 15min |
| FIX-R1 | Verificar si MANUAL-OPERATIVO.md existe. Decidir si absorberlo o marcarlo como referencia externa | Daniel | 1h |
| FIX-RQ2 | Agregar rationale para el fallback `'amalay'` en `getClientId()`, o marcar como [PENDIENTE] para cambiar antes del restaurante #2 | Eng+Doc | 30min |

### P2 — Mejoras de mantenibilidad

| ID | Acción | Responsable | Estimado |
|---|---|---|---|
| FIX-G4 | Verificar filesystem para módulos `/pos/auditoria`, `/pos/monitor`, `/pos/inventario`, `/pos/compras`. Agregar a POS Bible §1.3 | Doc | 30min |
| FIX-G5 | Agregar invariante `recordMovement()` al Master Bible §4 y Domain Bible §4 | Doc | 30min |
| FIX-G6 | Documentar endpoints faltantes en Engineering Bible: merge-orders, adjust-market, deduct-market | Doc | 30min |
| FIX-T6 | Verificar estados de PrintJob en bridge o código. Unificar Operations y POS Bible | Eng+Doc | 30min |
| FIX-C4 | Verificar main.js del bridge. Actualizar Master Bible §2.3 | Eng+Doc | 30min |
| FIX-D1-D6 | Refactorizar duplicaciones: Transaction A/B, OCC, turno obligatorio, offline-first — mantener en 1 lugar, referenciar desde los demás | Doc | 4h |
| FIX-R4 | Verificar `docs/DECISIONS.md`. Si existe, documentarlo en Master Bible Source of Truth map | Doc | 15min |
| FIX-R5 | Verificar existencia de ADR-CONCURRENCY.md, ADR-TURNO-LIFECYCLE.md, ADR-FISCAL-MODEL.md | Eng | 15min |
| FIX-H1 | Definir Engineering Bible §5 como lista canónica de agentes. Operations Bible §3.5 → referenciar | Doc | 30min |
| FIX-H2 | Eliminar POS Bible §3.8 y referenciar Engineering Bible para event store | Doc | 15min |

---

## Hallazgos del código (save-order/route.ts + pos-offline-db.ts)

Los siguientes hallazgos provienen de la revisión de código y tienen impacto directo en la documentación:

### Confirmaciones del código

- `STALE_WRITE_CONFLICT` (no `REJECTED`) es el término correcto — confirmado en `pos-offline-db.ts` línea 20 y en el comportamiento de `route.ts`
- `fetch()` directo (no SDK) — confirmado en `route.ts` líneas 90, 113, 134, etc.
- `expected_revision` como nombre del campo OCC en el body del request — `route.ts` línea 39
- `revision` (no `order_revision`) como nombre en la respuesta — `route.ts` línea 221
- Transaction A/B bien implementado: reconciliación no bloquea el response si falla (`try/catch` en líneas 155-217)
- `save_operation_id` como mecanismo de idempotencia exactamente como documentado — `route.ts` líneas 61-88
- 5 stores en IndexedDB: `menu`, `orders`, `inventory`, `sync_queue`, `meta` — confirmado en `pos-offline-db.ts` líneas 46-64

### Inconsistencias código vs documentación

- Operations Bible §DT-2 (409 silenciado) **contradice** el tipo `STALE_WRITE_CONFLICT` definido en `pos-offline-db.ts` línea 20 como error terminal — el código es correcto, el Bible está mal
- `comanda_batches` se guarda en PATCH separado fuera del RPC (`route.ts` líneas 110-119) — no documentado en ningún Bible
- La lógica de lineage check (`last_inventory_processed_revision`, `last_inventory_complete_revision`) en `route.ts` líneas 131-217 no está documentada en ningún Bible — es una capa adicional de estado de reconciliación no documentada
- `transport?: ReplayTransport` en `SyncQueueItem` (`pos-offline-db.ts` línea 27) — dos transportes distintos (`APP_API` vs `SUPABASE_REST`) con restricciones diferentes, no documentados en Engineering Bible ni Master Bible

---

_Fin del reporte. Total: 53 hallazgos. 11 críticos requieren acción antes de usar los Bibles como fuente de verdad confiable._
