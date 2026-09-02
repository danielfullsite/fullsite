# Cerrar ChickIn + Onboarding raíz para próximos clientes

> **Fecha:** 2026-09-02 · **Autor:** sesión Claude (worktree `practical-tesla-c3b7a4`)
> **Base:** lectura directa del código (3 mapeos independientes: offline, provisioning, depleción)
> + verificación contra la BD viva de producción (SELECT read-only vía MCP `supabase-amalay`).
> Todas las afirmaciones con `archivo:línea` son hechos verificados; lo inferido se marca.

## TL;DR

1. **El offline es sólido y agnóstico de tenant.** El susto de instalar un cliente nuevo NO es el
   offline en sí — son 4 cosas del provisioning/arranque, todas concretas y arreglables (P0-1…P0-4).
2. **ChickIn ya tiene el costeo 100% fiel al Excel** (con los "+", 7/7 spot-checks al centavo).
   Le falta: (a) la capa de **depleción de inventario** (5 bloqueos concretos), y (b) **sembrar datos
   operativos** para que el offline tenga qué cachear.
3. **Corrección honesta:** dije que el gap era `pos_menu_item_recipes` (amalay=69). **Es falso** — esa
   tabla está muerta (sin `ingredient_id` ni cantidad, nadie la lee, migración de DROP pendiente). El
   enlace real de depleción es `pos_recipes_old` → R1 (`pos_recipe_versions`+`pos_recipe_lines`).
4. **La solución raíz para N clientes** es un uploader server-side "sube tu Excel → el sistema carga
   todo con los +", que reusa el patrón `validate→commit` existente y escribe las tablas canónicas +
   enciende la depleción. Hoy NO existe end-to-end; hay andamiaje parcial reusable.

---

## 1. Estado real de ChickIn (evidencia BD viva, 2026-09-02)

| Capa | Tabla | ChickIn | ¿Listo? |
|---|---|---|---|
| Menú | `pos_menu_items` | 46 | ✅ |
| Costeo (jsonb, los "+") | `pos_recipes` (vendibles) | 46 | ✅ fiel al Excel |
| Costeo (subrecetas) | `pos_recipes` (precio null) | 16 | ✅ |
| Insumos | `pos_ingredients` | 163 | ✅ proveedor+categoría |
| Inventario (stock) | `pos_inventory` | 163 (stock=0, `stock_unit`=NULL) | ⚠️ sin unidad |
| Ventas de ejemplo | `pos_orders` | 165 (14 días) | ✅ |
| Turnos | `pos_turnos` | 14 | ✅ |
| Staff | `pos_staff` | 3 (Billy/Daniel/Luisa) | ✅ |
| **Depleción — autoridad** | `pos_mutation_authority` | **0 → default `legacy`** | ❌ |
| **Depleción — política** | `pos_item_inventory_policy` | **46, todas `non_inventory`** | ❌ |
| **Depleción — receta R1** | `pos_recipe_versions` / `pos_recipe_lines` | **0 / 0** | ❌ |
| **Depleción — receta plana** | `pos_recipes_old` | **0** | ❌ |

**Reconciliación Excel↔BD: perfecta.** 7/7 spot-checks al centavo (Mac & Cheese 78.93%, Chickin
Sandwich 32.30%, Combo Chickin Sandwich 31.57%, etc.), incluyendo el empaque (PAPER) dentro del
`costo_total`. Los "+" están (23–43 ingredientes por receta).

**Único pendiente del Excel sin cargar:** pestaña **RENDIMIENTOS** (yield del pollo: 15 kg → 248
porciones, merma 96.97%, $6.01/porción). Es un modelo calculado, no data por-producto → sin destino
de display hoy. Candidato a un panel chico (es el "yield" que a Billy le importa).

---

## 2. Pilar A — Offline: sólido y agnóstico; el riesgo está en el arranque

El offline tiene **3 capas de persistencia** (no una), todas **agnósticas de tenant**:

- **A) Service Worker** (`dashboard-app/public/sw.js`, `CACHE_VERSION v46`): cachea por URL/path, cero
  `client_id`. Precachea el app-shell de `/pos/*` + chunks de Next; `stripRedirect` (fix login iOS);
  nunca cachea `pos_orders`/`pos_mesas`/auth. **100% agnóstico.**
- **B) Servidor local "Pedro"** (`electron-app/local-server/`, LAN `0.0.0.0:7717`): event store NDJSON
  con idempotencia por `command_id` (`core/event-store.js`); **se niega a arrancar** (fail-closed) si
  falta `restaurant_id` (`index.js:512-518`); poll a Supabase **siempre filtrado por tenant**.
- **C) Cola IndexedDB** (`dashboard-app/src/lib/pos-offline-db.ts`, la ruta certificada): replay por
  `/api/pos/save-order` con token fresco, idempotencia `save_operation_id`, guard `esMutacionSinFiltro`
  contra PATCH/DELETE sin filtro. (Existe una cola legacy `offline-sync.ts` sin idempotencia — confirmar
  que el POS no la use.)

### Riesgos de instalación para un tenant nuevo (tu miedo, priorizado)

| ID | Riesgo | Evidencia | Mitigación |
|---|---|---|---|
| **P0-1** | Fallback `NEXT_PUBLIC_DEFAULT_CLIENT_ID='amalay'` en el bundle: si `localStorage['fullsite_client_id']` no está puesto (terminal recién instalada, pre-login, navegador plano), **todas** las consultas preguntan por AMALAY. Ya pasó en prod (coffee-shop vio alertas de amalay). | `lib/data.ts:99-107`, `components/AgentBriefing.tsx:42-49` | El Electron inyecta el `client_id` correcto antes de cargar; `guardTenant` limpia IndexedDB si cambia el tenant. Pero el fallback sigue vivo para el camino navegador/pre-login → **endurecer**. |
| **P0-2** | El offline solo cachea lo que leyó **online**. Sin sembrar menú/staff/formas de pago/mesas/modificadores/turnos, la caché offline queda vacía → sin menú, **sin poder teclear PIN** (no hay staff). | `lib/data.ts:334-386`, `pos-data.ts:2151-2162`, `sw.js:396-398` | **Sembrar datos operativos + cargar online al menos una vez** antes de cortar WAN. |
| **P0-3** | Sin **service-account por tenant**, el poll del servidor local cae a anon key → RLS devuelve 0 filas → `STATE_SYNC` vacío. | `electron-app/local-server/index.js:110-136` | `/api/platform/onboard` ya crea el service-account (`:143`); confirmarlo para chickin. |
| **P0-4** | **No clonar la máquina de AMALAY** — arrastra `config.json` con `restaurant_id='amalay'` y el auto-migrador lo adopta. | `config-schema.js:106-146`, `main.js:51-53` | Provisionar desde cero con el wizard. |

**Conclusión:** el offline no se rediseña. Se **de-risquea el arranque**: endurecer P0-1, sembrar datos
(P0-2), confirmar service-account (P0-3), instalar limpio (P0-4). Todo esto se resuelve en el
provisioning/onboarding, no en el motor offline.

---

## 3. Pilar B — Depleción de inventario: cómo funciona AMALAY y los 5 bloqueos de ChickIn

**Cómo rebaja AMALAY** (verdad del código): al cerrar/guardar una orden, el POS pega a
`/api/pos/save-order`. El endpoint (1) guarda con RPC `r1_save_order`, (2) reconcilia inventario con
RPC **`r1_reconcile_order` → `r1_reconcile_item`** (`baseline_esquema.sql:948,681`). Es:
- **Server-side, en la BD** (RPC `SECURITY DEFINER`) — no trigger, no cron, no agente.
- **Tiempo real** al cerrar cada orden (no en el corte).
- **Aguanta offline**: la orden se encola y se reproduce por el mismo endpoint al reconectar, con
  idempotencia `save_operation_id` — no duplica la rebaja (`pos-offline-db.ts:766`).
- Modo `recipe`: lee `pos_recipe_lines`, convierte unidad receta→stock (`convert_recipe_to_stock`),
  decrementa `pos_inventory.stock` y deja rastro en `pos_inventory_movements` (`recipe_deduction`).

> `recordMovement()` (`lib/inventory.ts`, el contrato de inventario) **NO es el camino de venta** — es
> para movimientos manuales (recepción de factura, toma física, merma). La venta rebaja dentro del RPC.

### Los 5 bloqueos de ChickIn (verificados contra prod)

Vender un Chickin Sandwich hoy rebaja **cero** por cinco razones, no una:

1. **Sin autoridad `r1`** (`pos_mutation_authority` = 0 filas → default `legacy`) → corta en
   `BLOCKED_OWNER_MISSING`.
2. **Política toda `non_inventory`** (46/46) → `NO_MUTATION_APPROVED`.
3. **Sin `pos_recipe_versions`/`pos_recipe_lines`** → `BLOCKED_RECIPE_MISSING`.
4. **`pos_inventory.stock_unit` todo NULL** → `convert_recipe_to_stock` da NULL → `BLOCKED_UNIT_MISSING`.
5. **`pos_recipes_old` vacío** → la herramienta sancionada `recipe-sync` devolvería `skipped:'empty'`.

### La herramienta que existe: `/api/pos/recipe-sync`

Proyecta la receta plana `pos_recipes_old` → R1 (`pos_recipe_versions`+`pos_recipe_lines`), agrega
duplicados por ingrediente, activa la versión y **sube la política a `recipe`**
(`recipe-sync/route.ts:110-226`). ChickIn es `data_source='fullsite'` → siempre reconstruye. Pero
requiere `pos_recipes_old` poblado primero, y **no fija autoridad ni `stock_unit`**.

### Cómo cerrar la depleción de ChickIn (pasos concretos)

1. **Autoridad**: `insert pos_mutation_authority(client_id='chickin-demo', sale_authority='r1')`.
2. **`stock_unit`**: poblar las 163 filas de `pos_inventory` mapeando `pos_ingredients.unit`
   (`GRS→g`, `ML→ml`, `PZA→pz`).
3. **Aplanar el jsonb `ingredientes` → recetas hoja**: por platillo de cocina, explotar combos
   recursivamente a materia prima; **sumar** líneas repetidas por insumo.
4. **Mapear** cada `nombre` → `pos_ingredients.id` (exacto → case/acento-insensible → crear faltantes) y
   `um` → `recipe_unit` en `{g,ml,pz}`. Medido: **95/101 nombres matchan** case-insensitive; los ~6
   restantes son componentes de combo (BOM 2 niveles) + ~3 insumos realmente faltantes.
5. **Materializar** vía la ruta sancionada: poblar `pos_recipes_old(menu_item_id, ingredient_id,
   quantity, unit)` y llamar `/api/pos/recipe-sync` por item (construye R1, activa, sube policy).
6. **Ignorar `pos_menu_item_recipes`** (muerta).

### Advertencias
- **Modificadores NO rebajan** en ningún tenant hoy ("extra queso" sube precio, no descuenta queso).
  Si el negocio lo espera, es feature nueva.
- **Combos**: no marcar combo **y** sus componentes ambos como `recipe` → doble contabilidad. Decidir
  si deduce el combo (explotado a insumos) o sus componentes, no ambos.
- **Subrecetas**: `recipe-sync` salta `ingredient_type='sub_recipe'`; explotar antes o modelar como
  líneas de materia prima directas.

---

## 4. Pilar C — Onboarding raíz: "sube tu Excel → el sistema carga todo con los +"

### Qué existe hoy
- **`provisionTenant()`** (`lib/provision-tenant.ts:170`, 396 líneas, 10 tablas): el esqueleton. Template
  de código **cliente-agnóstico** (`onboarding-template.ts`, "ZERO hardcode tied to any specific
  restaurant") + presets verticales (`fast_food`, etc.). **NO clona amalay.** NO siembra
  `pos_ingredients`/`pos_inventory`/`pos_recipes` — ese es el hueco del uploader.
- **`/api/platform/import`** (validate→commit, service_role, 2FA, audit): el **buen patrón**, pero solo
  menú/categorías/pagos.
- **`/admin/carga-masiva`**: maneja recetas/insumos/inventario pero es **riesgoso** (escribe con anon-key
  desde el browser, recetas a `pos_recipes_old` sin preservar los "+", sin reconciliación). No usar como
  contrato raíz.

### El parser ya existe (base del uploader)
`scratchpad/chickin/extract_full.py` parsea las 6 pestañas usando el **outline level de openpyxl**
(receta=nivel 0, ingredientes "los +"=nivel 1), con **reconciliación de costos integrada** (Σ ingredientes
≈ costo_total, marca `bad` si difiere >$0.10). Esa validación es el corazón del uploader.

### Diseño propuesto (causa raíz, N clientes)
- **Dónde vive:** nuevo `POST /api/platform/import-costeo` server-side, gateado admin+2FA, service_role,
  patrón **validate (preview) → commit**. Página en `/platform/importar` (dataset "Costeo Excel").
- **Parseo:** en el server con **SheetJS/`xlsx`** leyendo outline levels (el browser con papaparse no
  puede) — o un paso Python que emite JSON canónico. Recomendado: SheetJS (100% web, sin Python runtime).
- **Mapa pestaña → tabla canónica:**

  | Pestaña | Destino | Nota |
  |---|---|---|
  | PRODUCTOS | `pos_ingredients` + stock inicial vía `recordMovement('entry')` | id determinístico; costo por creación |
  | FOOD COST (receta) | `pos_recipes` (jsonb, los "+") **y** `pos_recipes_old` (plano, con `ingredient_id`) | doble escritura obligatoria |
  | FOOD COST → menú | `pos_menu_items` + `recipe_ref` | categoría primero (FK) |
  | Depleción | `/api/pos/recipe-sync` por item | crea R1, activa, sube policy |
  | COMBOS | `pos_recipes`(combo) + `pos_menu_items`(cat-combos) + `pos_combos` | explotar a insumos para depleción |
  | SUBRECETAS/RENDIMIENTOS | `pos_ingredients` `product_type='subproducto'` + `yield_factor` | cost-engine ya explota subrecetas |
  | PRECIO DE VENTA | `pos_menu_items.price` / `pos_recipes.precio_venta` | conciliar con FOOD COST |

- **Validaciones raíz (no negociables):**
  1. **Reconciliación de costos** en el preview antes de commit (ya en el parser).
  2. **Resolución de ingredientes**: todo "+" debe existir en PRODUCTOS; listar no-resueltos (no
     auto-crear en silencio).
  3. **Tenant isolation**: `client_id` explícito y no-vacío en cada fila (falla cerrado); nunca depender
     del DEFAULT `amalay-spgg` ni de `_cid()` client-side. Probar con 2 tenants.
  4. **Idempotencia**: UPSERT por id determinístico (no `delete+insert`); `idempotency_key` en
     `recordMovement`. Re-subir el mismo Excel no duplica.
  5. **Respetar contratos**: stock por `recordMovement()`, depleción por `recipe-sync` — no INSERT crudo.
  6. **Unidades**: normalizar `GRS/ML/PZA` → `{kg,g,lt,ml,pz}` (CHECK de `pos_inventory`/`pos_recipe_lines`).
- **Integración con el esqueleton:** `provisionTenant()` → **uploader de costeo** (reemplaza el menú
  genérico por el real). Añadir `input.skipMenuSeed` para no dejar items placeholder huérfanos.

### Deuda de plataforma a documentar (proliferación de tablas)
Mismo concepto en varias tablas: `pos_ingredients` (canónica) vs `pos_inventory_products` (legacy, la que
usó el hack de chickin) vs `pos_insumos` (Excel). `pos_recipes` (jsonb) vs `pos_recipes_old` (plano).
**La tripleta canónica** que el uploader debe respetar: `pos_ingredients` + `pos_inventory` +
(`pos_recipes` jsonb **y** `pos_recipes_old` plano).

---

## 5. Plan para CERRAR ChickIn (secuenciado)

> "Cerrar" = operar como AMALAY: POS offline + inventario que se rebaja + todo cruzado. El estándar
> Fullsite de "cerrado" exige validación física en su hardware (Daniel es el instrumento).

**Track 1 — Depleción (yo, por MCP, scoped a chickin-demo, reversible).** Decisiones antes de ejecutar:
combo vs componente (evitar doble conteo), y qué hacer con los ~3 insumos faltantes. Pasos §3.
**Track 2 — Sembrar datos operativos para offline (P0-2).** Confirmar que menú/staff/pagos/modificadores
están y se cachean; definir modificadores desde insumos reales (curados, no inventados).
**Track 3 — De-risquear instalación (P0-1, P0-3, P0-4).** Endurecer el fallback `amalay`; confirmar
service-account; instalar limpio (no clonar máquina).
**Track 4 — Validación física en su hardware (campo, Daniel).** Matriz offline: arranque en frío sin
WAN, comanda Entrada→Pedro→Caja, imprimir, cobrar, reconectar sin duplicar, y **verificar que rebaja
stock**. Turnos cortos, guion numerado.

**Orden sugerido:** Track 1 + 2 en paralelo (MCP) → Track 3 (código, PR) → Track 4 (campo). Cerrar solo
tras Track 4.

## 6. Plan para próximos clientes (uploader) — NO bloquea cerrar ChickIn

Fase 1: endpoint `import-costeo` validate→commit + parser SheetJS server-side (reusa `extract_full.py`).
Fase 2: mapeo a tripleta canónica + resolución de ingredientes + recipe-sync automático.
Fase 3: integrar al wizard de onboarding (`provisionTenant` → uploader), `skipMenuSeed`.
Fase 4: endurecer P0-1 (matar el default `amalay`) como parte del blindaje multi-tenant.

## 7. Correcciones honestas y validación pendiente
- **Corrección:** `pos_menu_item_recipes` NO era el gap (tabla muerta). Gap real = `pos_recipes_old`→R1.
  Memoria `project_chickin_demo` corregida.
- **Ya en curso:** el default `pos_orders.location_id='amalay-spgg'` (fuga cross-tenant, lab-resto tiene
  4,402 órdenes mal etiquetadas) — tarea separada `task_86b12111`.
- **Pendiente de campo (no verificable por lectura):** arranque offline en la máquina de ChickIn, que el
  default `amalay` no aparezca, y que la rebaja de stock ocurra de verdad al vender.
