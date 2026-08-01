# Fullsite Dashboard Bible

**Versión:** 1.0  
**Fecha:** 2026-07-23  
**Verificado contra código en:** `/dashboard-app/src/`  
**Stack:** Next.js 16 (App Router), Supabase, TypeScript, Tailwind CSS, Recharts  

> Este documento es la referencia canónica del Dashboard de Fullsite.
>
> **Niveles de evidencia usados en todo el documento:**
> - `[HECHO]` — Existe en el código y fue verificado. Se incluye archivo cuando es posible.
> - `[INFERENCIA]` — Deducido del comportamiento observado o del contexto, NO verificado directamente en el código fuente.
> - `[PENDIENTE]` — No existe todavía, está diseñado pero no implementado, o es una decisión abierta.
>
> No se usa lenguaje ambiguo ("probablemente", "parece que", "debería"). Cada afirmación lleva su etiqueta.  
> Discrepancias entre spec y código están marcadas con `⚠️ DISCREPANCIA`.

---

## 1. Propósito

Este documento es para el equipo de Fullsite — founders, ingenieros, y futuros colaboradores — que necesitan entender qué es el dashboard, cómo funciona y cómo evolucionar sin romper lo que ya existe.

El Dashboard de Fullsite es la capa de inteligencia para el dueño o gerente del restaurante. Es fundamentalmente diferente al POS:

| Dimensión | POS (`/pos`) | Dashboard (resto de rutas) |
|---|---|---|
| Usuario | Mesero, cajero | Dueño, gerente, capitán |
| Dispositivo | Terminal táctil en piso | Laptop, tablet, móvil |
| Tiempo | Tiempo real, orden por orden | Histórico + tendencias |
| Propósito | Capturar la venta | Entender y optimizar el negocio |
| Fuente primaria | `pos_orders`, `pos_order_items` | `wansoft_daily`, `agent_runs`, tablas POS |
| Modo offline | Diseñado para operar offline | Requiere conexión |

El dashboard NO es un reemplazo de un sistema ERP. Es un copiloto operativo que responde preguntas de negocio: ¿Cuánto vendimos? ¿Qué mesero lideró? ¿En qué categorías crece el negocio? ¿Hay riesgo de fraude? ¿El inventario está en niveles correctos?

---

## 2. Filosofía

**2.1 Claridad antes que completitud**  
El dashboard muestra lo que tiene. Si no hay datos, muestra un empty-state claro, no una tabla vacía o un 0 sin explicación. Cada módulo incluye lógica explícita de empty-state.

**2.2 Dual data source — sin dependencia de Wansoft**  
El sistema fue diseñado desde el inicio para sobrevivir al día en que Wansoft desaparezca. Toda página principal tiene un fallback: si `wansoft_daily` está vacío, construye los KPIs desde `pos_orders` nativos de Fullsite. Esto no es un hack — es la arquitectura de transición intencionada.

**2.3 Datos estimados ≠ datos reales. Siempre marcar la diferencia**  
Cuando el food cost o el costo de nómina son estimados (no scrapeados de Wansoft), el UI lo dice explícitamente. No se hacen pasar datos calculados como si fueran datos capturados.

**2.4 El inventario es un ledger, no un estado**  
Todos los movimientos de inventario son inmutables. Nunca se sobrescribe directamente el stock — siempre se registra un movimiento en `pos_inventory_movements` y el estado se deriva del ledger. El stock en `pos_inventory` es solo el valor materializado para performance.

**2.5 Multi-tenant desde el día 1**  
Ningún query toca datos sin incluir `client_id`. No hay lógica hardcodeada de AMALAY en los módulos del dashboard (aunque el scraper de Wansoft en prod es solo para AMALAY hoy).

**2.6 Los agentes trabajan 24/7 aunque nadie mire el dashboard**  
Los agentes de IA corren en GitHub Actions de forma autónoma. El dashboard es el visor de su trabajo, no su activador.

---

## 3. Arquitectura

### 3.1 Stack técnico

- **Framework:** Next.js 16 con App Router (`'use client'` predominante — casi todo es cliente)
- **Base de datos:** Supabase (PostgreSQL + Auth + RLS + REST API)
- **Estilos:** Tailwind CSS con variables CSS personalizadas para theming dark/light
- **Gráficas:** Recharts (AreaChart, BarChart, RadarChart, LineChart)
- **Íconos:** Lucide React
- **Auth:** Supabase Auth con sesiones JWT persistentes

### 3.2 Estructura de capas

```
Navegador / PWA
    │
    ├── AppShell (layout global)
    │     ├── AuthContext (user, role, clientId, clientConfig, locations)
    │     ├── Sidebar (navegación, roles, planes)
    │     └── <page.tsx> (módulo activo)
    │
    ├── /src/lib/data.ts (funciones de fetch — wansoft_daily + pos_orders)
    ├── /src/lib/pos-data.ts (funciones para datos nativos POS)
    ├── /src/lib/inventory.ts (operaciones de inventario — LEDGER)
    ├── /src/lib/roles.ts (permisos por rol)
    ├── /src/lib/plans.ts (permisos por plan comercial)
    └── /src/lib/supabase-browser.ts (cliente Supabase singleton)
```

### 3.3 Resolución del client_id

Este es el mecanismo central del multi-tenancy. Definido en `/src/lib/data.ts` función `getActiveClientSlug()` [HECHO]:

```
Orden de resolución:
  1. localStorage['fullsite_client_id']  ← AuthContext lo setea en login
  2. NEXT_PUBLIC_DEFAULT_CLIENT_ID       ← .env (='amalay' en producción actual)
  3. '' (string vacío)                   ← retorna 0 filas en BD, falla safe
```

El `clientId` se propaga a todas las queries vía este helper. No existe prop drilling — cada módulo llama `getActiveClientSlug()` directamente.

#### Rationale: Por qué coexisten `wansoft_daily` y `pos_orders` como fuentes paralelas

[HECHO] El restaurante AMALAY operaba con Wansoft antes de Fullsite. Al desplegar Fullsite, existía ya un historial de cientos de días en `wansoft_daily`.

Problema: Fullsite se desplegó en un restaurante con historial real de operación en Wansoft. Eliminar esos datos históricos significaría perder contexto de negocio valioso — tendencias de ventas, comportamiento de meseros, estacionalidad — que el dueño necesita para tomar decisiones.

Alternativa considerada: importar todos los datos históricos de Wansoft al schema de `pos_orders`. Por qué no se hizo: el schema es fundamentalmente diferente — Wansoft agrega por día, `pos_orders` es por orden individual. Una migración completa requeriría inferir órdenes individuales desde totales diarios, lo cual introduciría datos sintéticos que parecerían reales.

Tradeoff aceptado: [HECHO] dos fuentes de verdad coexistentes complican las queries — todas las páginas de ventas deben implementar el patrón `if (wansoft.length === 0) { return getDashboardFromPosOrders() }`. Esta dualidad es explícita, no accidental.

Cuándo replantear: cuando el restaurante lleve 6+ meses con operación completa en Fullsite POS y el historial de Wansoft sea irrelevante para las decisiones del día a día. En ese punto, el Data Source Switch puede desaparecer y el fallback volverse el primario.

### 3.4 Data Source Switch

Definido en `/src/lib/data.ts` [HECHO]:

```typescript
type DataSource = 'wansoft' | 'fullsite'
```

Almacenado en `localStorage['fullsite_data_source']`. Seteado por `AuthContext` al cargar `clientConfig.data_source` desde Supabase. En producción actual: `'wansoft'` para AMALAY.

#### Rationale: Por qué existe el Data Source Switch en el Home

[HECHO] El switch `wansoft | fullsite` es un mecanismo de transición deliberado, no una feature permanente.

Problema: durante el período de transición, `pos_orders` solo tiene datos desde la fecha de cutover (cuando Fullsite POS empezó a operar). `wansoft_daily` tiene el historial completo desde antes. El dueño necesita poder ver ambos contextos: el histórico de Wansoft y el actual de Fullsite, para evaluar si el nuevo sistema funciona igual o mejor.

Alternativa considerada: mostrar siempre solo una fuente, seleccionada automáticamente según la fecha. Por qué no: el dueño necesita control explícito para comparar períodos equivalentes entre el sistema viejo y el nuevo, y para validar que los números cuadran antes de comprometerse completamente con Fullsite como fuente de verdad.

Tradeoff aceptado: [HECHO] el switch agrega complejidad al Home y a todas las páginas de ventas, pero es la herramienta que permite al dueño ganar confianza en el cambio de sistema sin un salto de fe ciego.

Cuándo replantear: [PENDIENTE] después de 90 días de operación completa en Fullsite POS. En ese punto, el switch puede desaparecer y el dashboard mostrar solo datos de `pos_orders`.

### 3.5 Autenticación

**Flujo de login:**
1. `/login` — formulario email/password → Supabase Auth
2. JWT retornado → `AuthContext` lo usa para queries autenticadas
3. `AuthContext` carga en este orden:
   - `user_metadata.client_id` (del JWT — más rápido)
   - Tabla `client_users` (fuente de verdad del rol)
   - Mapa `ROLE_MAP` en `roles.ts` (fallback legacy por email)
4. `clientConfig` se carga desde Supabase (`client_config` table)
5. `localStorage['fullsite_client_id']` se setea para queries no-autenticadas

**Token cacheado:** `data.ts` cachea el access token por 30 segundos para evitar el timeout de 3s del SDK de Supabase en cada fetch [HECHO — comentario en código].

> ⚠️ DISCREPANCIA: El código usa `fetch()` directo a la REST API de Supabase en todos los módulos de inventario (no el SDK), siguiendo el patrón documentado en `feedback_supabase_sdk_bug.md`. Pero `data.ts` sí usa el SDK para `supabase.auth.getSession()`. El SDK solo se usa para auth, nunca para queries de datos.

#### Rationale: Por qué `fetch()` directo y nunca el SDK de Supabase para queries de datos

[HECHO] El SDK de Supabase hace hang indefinido en Next.js App Router server components y en API routes — fue descubierto en producción, no en tests. El problema no tiene workaround conocido dentro del SDK.

Problema: las páginas que usaban el SDK de Supabase para queries de datos (no auth) colgaban la petición sin retornar error ni timeout. El usuario veía un spinner infinito. El bug aparece en Next.js 16 App Router con server components y API routes.

Alternativa considerada: usar el SDK solo en client components (navegador), donde no presenta el bug. Por qué no: crearía inconsistencia en el codebase — algunos módulos usarían SDK, otros `fetch()` directo, y un ingeniero nuevo no sabría cuándo usar cuál. La regla simple ("nunca el SDK para datos") es más segura.

Tradeoff aceptado: [HECHO] al usar `fetch()` directo se pierde el helper de RLS automático del SDK. El filtro `client_id` debe pasarse manualmente en cada query como parámetro de URL (ej. `?client_id=eq.{clientId}`). Esto es más verboso pero más explícito.

Cuándo replantear: [PENDIENTE] cuando el SDK de Supabase publique una versión que corrija el bug con Next.js 16 App Router. Verificar con una migración acotada antes de adoptar masivamente.

### 3.6 Roles y acceso

Definidos en `/src/lib/roles.ts` [HECHO]:

| Rol | Páginas accesibles |
|---|---|
| `dueño` | Todo sin excepción |
| `gerente` | Todo excepto: `/estado-resultados`, `/nomina`, `/ingresos`, `/food-cost`, `/roi` |
| `capitan` | Operaciones + POS + inventario/merma. Sin finanzas ni agentes |
| `cajero` | `/pos`, `/cortes`, `/propinas`, `/ventas` únicamente |
| `mesero` / `staff` | Solo `/pos` |

Fuente de verdad del rol: columna `role` en tabla `client_users`. Fallback: `app_metadata.role` del JWT.

### 3.7 Planes comerciales

Definidos en `/src/lib/plans.ts` [HECHO]:

| Plan | Precio anual/suc | Incluye |
|---|---|---|
| `reporteador` | $14,999/año | Dashboard + agentes IA. Sin POS ni inventario nativo |
| `fullsite_software` | $49,999/año | POS + dashboard + inventario + IA |
| `fullsite_completo` | $49,999/año + $45,000 hardware | Software completo + hardware Fullsite |

El sidebar filtra ítems según `canPlanAccessPage(clientConfig.plan, item.href)`.

### 3.8 Sidebar

Definido en `/src/components/Sidebar.tsx` [HECHO]. Secciones colapsables, auto-expande la sección activa.

**Secciones actuales:**

| Sección | Módulos |
|---|---|
| Principal | Dashboard, Ventas, Cortes |
| Reportes | Meseros, Platillos, Tendencias, Propinas |
| Finanzas | Ingresos, Costos, Estado de Resultados, Nómina, Facturación CFDI, Notas de Crédito, Facturas Proveedores, Reporte Fiscal, Conciliación, Egresos, Control de Efectivo, Contabilidad CONTPAQi |
| Operaciones | Inventario, Cierre Inventario, Caja, Cancelaciones, Delivery, Auto-86, Food Cost, Compras, Proveedores, Reportes |
| Inv. Entradas | Entradas, Con Factura, Devoluciones, Código Barras |
| Inv. Control | Punto Reorden, Conversiones, Presentaciones, Subproductos |
| Inv. Auditoría | Toma Física, Merma, Movimientos, Costos Inv. |
| Inv. Compras | Orden Compra, Producción, Transferencias |
| POS | Punto de Venta, Plano |
| POS Restaurante | Platillos, Grupos, Modificadores, Horarios, Promociones, Formas de Pago |
| Herramientas | CRM, Agentes IA, Coach, Chat IA, Voice Agent |

En mobile: drawer deslizable. En desktop: panel fijo izquierdo. Los íconos se definen en Lucide React.

---

## 4. Flujos Principales

### 4.1 Flujo: Carga del Home Dashboard

**Ruta:** `/`  
**Archivo:** `/src/app/page.tsx` [HECHO]

```
1. Render inicial → estado loading=true
2. Promise.all([
     getRecentDays(1000),       // wansoft_daily últimos 1000 días
     getLatestDay(),            // wansoft_daily más reciente
     getLatestAgentRuns()       // agent_runs últimas ejecuciones
   ])
3. Si wansoft_daily vacío → getDashboardFromPosOrders(30)  [FALLBACK]
4. Calcular period data según selector (día/semana/mes)
5. Calcular comparativos (DOW promedio, semana anterior, mes anterior)
6. Render widgets según configuración localStorage
7. Auto-refresh cada 5 minutos + al recuperar foco de ventana
```

**Widget system:** 13 widgets configurables individualmente. Configuración persiste en `localStorage['dashboard_widgets']`.

**Período y navegación de día:**
- `period: 'dia' | 'semana' | 'mes'`
- En modo `dia`: navegación por flechas o date picker. `selectedDayIdx=0` = día más reciente.
- En modo `semana`: `weekOffset=0` = semana actual.
- En modo `mes`: `monthOffset=0` = mes actual.

### 4.2 Flujo: Análisis de ventas por período

**Ruta:** `/ventas`  
**Archivo:** `/src/app/ventas/page.tsx` [HECHO]

```
1. Usuario selecciona preset (hoy/ayer/semana/mes) o rango custom
2. getDateRange(from, to) → wansoft_daily filtrado por fecha
3. Si vacío → getDashboardFromPosOrders(diff_dias) [FALLBACK]
4. Calcular período anterior equivalente (misma duración)
5. Renderizar: KPIs, área chart, desglose métodos de pago, desglose categorías
6. Sección cancelaciones carga desde datos de la misma query
```

### 4.3 Flujo: Registro de entrada de inventario

**Ruta:** `/inventario-real/entradas`  
**Archivo:** `/src/app/inventario-real/entradas/page.tsx` + `/src/lib/inventory.ts` [HECHO]

```
1. Cargar catálogo pos_ingredients y lista pos_suppliers
2. Usuario selecciona proveedor, fecha y agrega ítems (producto, qty, precio)
3. Al guardar:
   a. makeIdempotencyKey(clientId, fecha, items) → key única
   b. recordMovement({
        movement_type: 'entry',
        lines: [{ingredient_id, quantity, unit_cost}],
        idempotency_key: key
      })
   c. INSERT pos_inventory_movements (ledger inmutable)
   d. PATCH pos_inventory.stock (estado materializado)
   e. PATCH pos_ingredients.cost_per_unit (costo promedio ponderado)
4. Si idempotency_key ya existe → skip (no error, no doble entrada)
```

**Cálculo de costo promedio ponderado:**
```
Si stock > 0: new_cost = (stock * old_cost + qty * purchase_cost) / (stock + qty)
Si stock = 0: new_cost = purchase_cost
Si purchase_cost = 0: costo no cambia
Si stock < 0 (anomalía legacy): movimiento BLOQUEADO, requiere corrección manual
```

### 4.4 Flujo: Toma física de inventario

**Ruta:** `/inventario-real/toma-fisica` [HECHO]

```
1. Cargar todos los insumos con stock del sistema (pos_inventory)
2. Usuario ingresa conteo real para cada ítem visible
3. Sistema calcula diferencia = conteo_real - stock_sistema
4. Al guardar:
   a. Para cada ítem con diferencia ≠ 0:
      recordMovement({ movement_type: 'adjustment', ... })
   b. INSERT pos_inventory_movements
   c. PATCH pos_inventory.stock = conteo_real
5. Motivo de conteo seleccionado por usuario (5 opciones)
```

### 4.5 Flujo: Generación de Orden de Compra

**Ruta:** `/inventario-real/orden-compra` [HECHO]

```
1. Cargar inventario actual (wansoft_data/inventory_parsed)
2. Cargar configuración de reorden (wansoft_data/reorder_config)
3. Cargar proveedores (pos_suppliers)
4. Identificar ítems bajo mínimo (inv_final_qty < minimo)
5. Asignar proveedor sugerido por GIRO_KEYWORDS (mapa departamento → giro → proveedor)
6. Usuario puede: editar cantidades, cambiar proveedor, eliminar ítems
7. "Generar automáticamente" → llena la OC con todos los ítems bajo mínimo
8. Agrupar por proveedor para envío
9. [INFERENCIA] Exportar a PDF o enviar email directamente al proveedor
```

### 4.6 Flujo: Producción de subproducto

**Ruta:** `/inventario-real/produccion` [HECHO]

```
1. Seleccionar qué se produce (subproducto o receta)
2. Ingresar cantidad a producir
3. Sistema muestra ingredientes requeridos × cantidad con stock actual
4. Validar que hay stock suficiente para todos los ingredientes
5. Al confirmar:
   a. recordMovement({ movement_type: 'waste', ... }) para ingredientes consumidos
   b. recordMovement({ movement_type: 'entry', ... }) para el subproducto producido
   c. Guardar log en wansoft_data con data_key 'produccion_log_{fecha}'
```

### 4.7 Flujo: Auto-86

**Ruta:** `/auto86` [HECHO]

```
1. Cargar pos_ingredients con stock y reorder_point
2. Cargar pos_recipes_old para todos los platillos
3. Identificar ingredientes críticos: stock < reorder_point
4. Para cada ingrediente crítico, buscar recetas que lo usan
5. Clasificar platillos afectados:
   - critical: ingrediente con stock = 0 o stock < needed_for_one_serving
   - warning: ingrediente bajo reorder_point
6. Mostrar lista de platillos afectados con desglose de ingredientes faltantes
7. KPI: porcentaje del menú disponible vs total
```

### 4.8 Flujo: Chat IA

**Ruta:** `/chat` [HECHO — UI]; [INFERENCIA — backend]

```
1. Usuario escribe pregunta en lenguaje natural
2. Frontend envía a API route /api/chat (inferencia)
3. API route: getActiveClientSlug() → fetch datos de Supabase relevantes
4. Prompt a Claude Haiku con datos del restaurante y pregunta del usuario
5. Stream de respuesta al cliente
6. Registrar en agent_runs o wansoft_data
```

---

## 5. Reglas de Negocio

### 5.1 Inventario

1. **Todo movimiento va por `recordMovement()`** — no hay writes directos a `pos_inventory`. Esta función está en `/src/lib/inventory.ts` y el comentario en el código lo declara explícitamente: "Direct writes to pos_inventory or pos_ingredients.cost_per_unit are forbidden outside this module." [HECHO]

2. **Idempotencia obligatoria** — cada movimiento tiene un `idempotency_key` único. Si la misma key ya existe en `pos_inventory_movements`, el movimiento se ignora silenciosamente. Previene doble entrada por reconexión o doble-click.

3. **Stock negativo = bloqueo** — si un movimiento resultaría en stock negativo, el sistema lo registra como `movement_type: 'underflow_prevented'` y no aplica el cambio. [HECHO — tipo de movimiento definido en inventory.ts]

4. **Costo promedio ponderado** — el único método de valuación de inventario en el sistema. Sin FIFO, sin LIFO.

   #### Rationale: Por qué costo promedio ponderado (WAC) y no FIFO

   [HECHO] El sistema implementa WAC exclusivamente para la valorización de inventario, documentado en `/src/lib/inventory.ts`.

   Problema: el restaurante recibe el mismo ingrediente de distintos proveedores a distintos precios en distintos momentos. Se necesita un método consistente para calcular el costo del inventario actual y el costo de las recetas.

   Alternativa considerada: FIFO (primero en entrar, primero en salir). Por qué no: FIFO requiere rastrear cada lote individualmente — cada entrada de inventario mantiene su costo de compra hasta que ese lote se agota. Implementarlo en `pos_inventory_movements` requeriría ligar cada consumo a una entrada específica, lo cual es significativamente más complejo y propenso a errores de registro.

   Tradeoff aceptado: [INFERENCIA] el costo promedio puede estar temporalmente desactualizado si se reciben compras con precios muy dispares en un período corto. Sin embargo, para los ingredientes típicos de un restaurante (donde los precios varían menos del 20% entre proveedores), la diferencia en el food cost calculado es marginal.

   Cuándo replantear: [PENDIENTE] si el restaurante empieza a manejar ingredientes de alto valor unitario donde el método de valorización impacte de forma material el cálculo de impuestos o el costo de ventas reportado al contador.

5. **wansoft_data para estado Wansoft** — el inventario de Wansoft se mantiene en `wansoft_data` tipo `inventory_parsed`. El inventario nativo de Fullsite usa `pos_inventory`. Son sistemas paralelos; no se mezclan.

### 5.2 Datos de ventas

1. **Los campos `efectivo` y `tarjeta` en `wansoft_daily` son porcentajes, no MXN** — cuando el valor < 100, significa %. Conversión: `mxn = (pct/100) * ventas_dia`. [HECHO — documentado en múltiples páginas]

   #### Rationale: Por qué `efectivo` y `tarjeta` pueden ser porcentaje O MXN según el valor

   [HECHO] El campo en `wansoft_daily` almacena dos tipos distintos de dato según el contexto histórico del scraper.

   Problema heredado del scraper de Wansoft: el campo que el scraper de Playwright extrae del reporte de Wansoft muestra "45%" o "1,234.50" dependiendo de la configuración del reporte en Wansoft (algunos reportes lo presentan como porcentaje del total, otros como monto MXN). El scraper no normaliza porque normalizar requeriría inferir el tipo desde el contexto — lo cual es frágil y puede producir errores silenciosos.

   Alternativa considerada: normalizar al momento del scraping, detectando si el valor extraído termina en "%" o tiene separador de miles. Por qué no: el riesgo de error silencioso es alto — un falso positivo convertiría montos reales en porcentajes o viceversa, y el dashboard mostraría valores completamente equivocados sin que nadie lo notara fácilmente.

   Tradeoff aceptado: [HECHO] el dashboard debe manejar ambos casos en cada módulo que usa estos campos (`/ingresos`, `/caja`, `/ventas`). La heurística `if (val < 100)` es frágil para ventas en efectivo menores a $100 MXN — ver Caso Borde §9.1.

   Cuándo replantear: [PENDIENTE] cuando el pipeline de datos de Wansoft se reescriba con schema estricto y validación en el punto de scraping. En ese momento, el campo debe dividirse en `efectivo_pct` y `efectivo_mxn` con types explícitos.

2. **El fallback dual es obligatorio** — ninguna página de ventas puede mostrar "sin datos" si hay datos en `pos_orders`. El pattern `if (wansoft.length === 0) { return getDashboardFromPosOrders() }` es estándar en todas las páginas principales.

3. **El staleness warning se muestra si los datos son de un día anterior** — comparando la fecha del registro más reciente con `new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })`. [HECHO]

4. **Descuentos se reportan en positivo** — `wansoft_daily.descuentos` almacena el monto de descuentos como número positivo. La resta se hace en la UI: `ventas_brutas - descuentos = ventas_netas`.

### 5.3 Autenticación y multi-tenancy

1. **El POS y el Dashboard tienen autenticación independiente** — un usuario del POS (turno/PIN) no tiene sesión de Supabase Auth. Un usuario del Dashboard sí. No se comparten sesiones.

2. **Logout NO hace `localStorage.clear()`** — se preservan `pos_print_queue`, `fullsite_offline_queue`, `fullsite_client_id` antes de limpiar. [HECHO — en Sidebar.tsx]

3. **Roles se resuelven en AuthContext, no en cada página** — las páginas consumen `useAuth().role` pero no hacen redirect. El Sidebar simplemente no muestra el link si el rol no tiene acceso.

4. **`client_users` es la fuente de verdad del rol** — el mapa `ROLE_MAP` en roles.ts es fallback legacy para emails hardcodeados.

### 5.4 Agentes de IA

1. **Los agentes no se activan desde el dashboard** — el dashboard solo lee `agent_runs`. Los agentes corren en GitHub Actions por cron o webhook.

2. **Todos los agentes registran en `agent_runs`** — esta es la única forma en que el dashboard sabe si un agente corrió y qué resultó.

3. **El output_summary es texto libre** — el dashboard muestra el texto tal como lo escribió el agente. No hay parsing estructurado del output.

---

## 6. Estados (State Machines)

### 6.1 Movimiento de inventario

```
PENDIENTE (en UI)
    │
    ├──[idempotency check: key existe] → IGNORADO (no error)
    │
    └──[key nueva]
          │
          ├──[stock resultante < 0] → BLOQUEADO (movement_type: 'underflow_prevented')
          │
          └──[stock ok] → REGISTRADO en pos_inventory_movements
                              │
                              └──[PATCH pos_inventory] → APLICADO
                                        │
                                        ├──[PATCH cost_per_unit si entrada] → COSTO_ACTUALIZADO
                                        │
                                        └──[PATCH falla] → REGISTRADO_SIN_APLICAR
                                             (ledger intacto, stock en BD desincronizado)
                                             (reconciliable desde ledger: SUM(qty) GROUP BY ingredient_id)
```

### 6.2 Sincronización de datos Wansoft

```
INACTIVO
    │
    └──[GitHub Actions cron dispara] → SCRAPEANDO (Playwright en Wansoft Web)
          │
          ├──[Wansoft responde] → PARSEANDO → INSERT wansoft_daily → SINCRONIZADO
          │                                                              │
          │                                                              └──[staleness = 0]
          │
          └──[Wansoft no responde / error] → FALLIDO
                    │
                    └──[staleness counter] → si > 24h → ALERTA wansoft-staleness agent
```

### 6.3 Widget del Home

```
VISIBLE (por defecto o guardado en localStorage)
    │
    └──[usuario hace click en Settings → toggle] → OCULTO
                                                      │
                                                      └──[save a localStorage]
```

### 6.4 Período del Home

```
DÍA (default)  ←→  SEMANA  ←→  MES
  │                  │           │
  ├─selectedDayIdx   ├─weekOffset ├─monthOffset
  ├─viewDay          ├─weekStart  ├─viewMonthStr
  └─sameDOWAvg       └─prevWeek  └─lastMonthData
```

---

## 7. Source of Truth

Esta es la tabla más importante del documento. Para cada dato que muestra el dashboard, aquí está la fuente real.

| Dato mostrado | Tabla principal | Fallback | Campo | Notas |
|---|---|---|---|---|
| Ventas del día | `wansoft_daily.ventas_dia` | `pos_orders` aggregado | `ventas_dia` | |
| Ventas brutas | `wansoft_daily.ventas_brutas` | `pos_orders` aggregado | `ventas_brutas` | |
| Descuentos | `wansoft_daily.descuentos` | `pos_orders` aggregado | `descuentos` | Valor positivo |
| Tickets/órdenes | `wansoft_daily.tickets_count` | `pos_orders` COUNT | `tickets_count` | |
| Personas | `wansoft_daily.personas_restaurant` | `pos_orders` sum guests | `personas_restaurant` | |
| Propinas | `wansoft_daily.propinas_total` | `wansoft_data/tips_raw` | `propinas_total` | tips_raw preferido |
| Efectivo | `wansoft_daily.efectivo` | — | `efectivo` | Es PORCENTAJE < 100 |
| Tarjeta | `wansoft_daily.tarjeta` | — | `tarjeta` | Es PORCENTAJE < 100 |
| Ventas por mesero | `wansoft_daily.meseros` (JSONB) | — | `meseros` | Array `[{nombre, total}]` |
| Propinas por mesero | `wansoft_data` tipo `tips_raw` | `wansoft_data/wansoft_tips` | `data` | deep scraper |
| Ventas por categoría | `wansoft_daily.ventas_por_grupo` (JSONB) | — | `ventas_por_grupo` | Array `[{nombre, total}]` |
| Métodos de pago | `wansoft_daily.pago_métodos` (JSONB) | — | `pago_métodos` | Los totales son % |
| Top platillos | `wansoft_daily.platillos_top` (JSONB) | — | `platillos_top` | [INFERENCIA] mezcla platillos y meseros |
| Cierre de caja | `wansoft_data` tipo `cash_closing` | — | `data` | Scraper deep |
| Retiros efectivo | `wansoft_data` tipo `cash_withdrawals` | — | `data` | |
| Depósitos bancarios | `wansoft_data` tipo `bank_deposits` | — | `data` | |
| Food cost por platillo | `pos_recipes_old` + `pos_ingredients` | — | `quantity`, `cost_per_unit` | Cálculo nativo Fullsite |
| Stock actual insumos | `pos_inventory.stock` | — | `stock` | Materializado del ledger |
| Costo promedio insumos | `pos_ingredients.cost_per_unit` | — | `cost_per_unit` | Actualizado en entradas |
| Movimientos de inventario | `pos_inventory_movements` | — | todos los campos | Ledger inmutable |
| Inventario Wansoft | `wansoft_data` tipo `inventory_parsed` | — | `data` | Snapshot sincronizado |
| Puntos de reorden | `wansoft_data` tipo `reorder_config` | — | `data` | Array `[{codigo, minimo, maximo}]` |
| Subproductos | `wansoft_data` tipo `inventory_subproductos` | — | `data` | |
| Proveedores | `pos_suppliers` | — | todos | client_id filtrado |
| Recetas | `pos_recipes_old` | — | todos | client_id filtrado |
| Sub-recetas | `pos_sub_recipes` + `pos_sub_recipe_ingredients` | — | todos | |
| Clientes CRM | `pos_customers` | — | todos | client_id filtrado |
| Visitas de clientes | `pos_customer_visits` | — | todos | |
| Estado de agentes | `agent_runs` | — | `agent_id`, `status`, `created_at`, `output_summary` | Últimas 200 filas |
| Delivery pagos | `delivery_platform_payments` | `wansoft_daily.pago_métodos` | todos | |
| Rol del usuario | `client_users.role` | `ROLE_MAP[email]` | `role` | |
| Config del cliente | `client_config` | hardcodeado en `client-config.ts` | `plan`, `display_name`, `data_source` | |

> ⚠️ DISCREPANCIA: `wansoft_daily.pago_métodos` usa la llave con tilde (`pago_métodos`), que es la columna real en la BD. En algunos lugares del código antiguo aparece como `pago_metodos` (sin tilde). Las páginas modernas ya usan la versión con tilde. Verificar al hacer queries directos.

---

## 8. Invariantes

Estas condiciones nunca deben romperse. Si algún cambio las viola, es un bug.

1. **`recordMovement()` es la única puerta de entrada al inventario.** Ningún otro código hace PATCH directo a `pos_inventory` o `pos_ingredients.cost_per_unit`. [HECHO — declarado en inventory.ts]

2. **`pos_inventory_movements` es inmutable.** No hay DELETE ni UPDATE en este ledger. Si hay un error de captura, se corrige con un movimiento de reversa (`reversal`).

3. **El `client_id` siempre está presente en todos los queries a tablas nativas.** Ningún SELECT en `pos_*` omite el filtro `client_id=eq.{clientId}`.

4. **Los datos del dashboard nunca contienen datos de otro tenant.** El aislamiento es lógico (client_id en query), no solo a nivel de RLS. Esto asegura que aunque RLS falle, el frontend filtra.

5. **El logout nunca destruye `pos_print_queue` ni `fullsite_offline_queue`.** Estas queues son operativas — su pérdida causan ventas perdidas. [HECHO — lógica explícita en Sidebar.tsx]

6. **El fallback dual de datos siempre existe en páginas de ventas.** Si `wansoft_daily` está vacío, `pos_orders` debe poder alimentar los KPIs básicos.

7. **`agent_runs` es solo lectura desde el dashboard.** Los agentes lo escriben desde GitHub Actions. El dashboard nunca hace INSERT en `agent_runs`.

---

## 9. Casos Borde

### 9.1 `wansoft_daily.efectivo` puede ser porcentaje o MXN

La BD almacena tanto porcentajes históricos (ej. `42.0` = 42%) como montos MXN (ej. `26000`). La distinción: si el valor es < 100, es porcentaje. Si es ≥ 100, es MXN. [HECHO — manejado en `/ingresos/page.tsx` y `/caja/page.tsx`]

```typescript
// Patrón en el código
const ef = d.efectivo || 0
const mxnAmount = ef < 100 ? (ef / 100) * (d.ventas_dia || 0) : ef
```

**Riesgo:** Si un día las ventas en efectivo fueran exactamente $0-$99 MXN, se interpretarían como porcentaje. En la práctica de AMALAY es imposible, pero es una deuda técnica.

### 9.2 `ventas_por_grupo` puede ser string JSON doble-escapado

El JSONB de Supabase a veces llega como string en lugar de objeto. La función `safeArray()` en el Home [HECHO] y `deepParse()` en food-cost [HECHO] manejan esto:

```typescript
function safeArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return [] }
  }
  return []
}
```

### 9.3 Wansoft no sincronizó hoy

El Home muestra un banner de alerta ámbar si el último registro de `wansoft_daily` no es del día de hoy (zona horaria México). El usuario ve "Sin sincronización de hoy todavía. Mostrando el último día con datos: [fecha]". [HECHO]

El agente `wansoft-staleness` corre a las 8am MX y envía Telegram si los datos tienen más de 24h.

### 9.4 Nuevo cliente sin datos históricos

Un cliente nuevo en Fullsite tiene `wansoft_daily` vacío y `pos_orders` también vacío. El Home muestra el empty-state de cada widget individualmente. El dashboard no se rompe — muestra ceros o mensajes "Sin datos". [HECHO — cada widget maneja su propio estado vacío]

### 9.5 Stock negativo en inventario legacy

Si `pos_inventory.stock` llega negativo por datos importados de Wansoft o por un bug histórico, `recordMovement()` bloquea cualquier movimiento posterior con `movement_type: 'underflow_prevented'` y no actualiza el stock. El problema requiere corrección manual. [HECHO — documentado en inventory.ts]

### 9.6 Mesero con nombre en múltiples formatos

Los nombres de meseros en `wansoft_daily.meseros` vienen del scraper de Wansoft y pueden tener variaciones (mayúsculas, espacios extra, acentos inconsistentes). La función `aggregateMeseros()` en data.ts [HECHO] hace matching por nombre exacto — no hay normalización. Si el mismo mesero aparece con nombres ligeramente distintos en diferentes días, aparecerá como dos personas distintas en el ranking.

### 9.7 Platillos de Market en food cost

Los productos de tienda retail (vitaminas, snacks, accesorios) tienen recetas con costo en `pos_recipes_old` pero sus márgenes no son comparables con los de cocina. El módulo `/food-cost` los detecta automáticamente con la lista `MARKET_BRANDS` (~80 entradas) y los marca con `market: true`. Se excluyen del food cost promedio de cocina. [HECHO]

### 9.8 Primer sync del día aparece en el dashboard antes del cierre real

El scraper corre a las 3pm con datos parciales del día. `wansoft_kpis` se actualiza, pero `wansoft_daily` solo recibe el dato final del día. El Home muestra el dato de `wansoft_daily` (el del día anterior) mientras el día actual está en curso. El widget de predicción de cierre compensa esto usando el último dato disponible para proyectar. [HECHO — PredictionWidget]

---

## 10. Limitaciones Actuales

### 10.1 Inventario Wansoft ≠ Inventario Fullsite

El sistema tiene DOS inventarios paralelos:
- **Wansoft** (`wansoft_data/inventory_parsed`): snapshot sincronizado desde Wansoft. Solo lectura. Se usa en las vistas del inventario real principal y en orden de compra.
- **Fullsite nativo** (`pos_inventory`): el inventario vivo con movimientos. Es el que usan Toma Física, Entradas, Merma, etc.

No hay reconciliación automática entre ambos. Los módulos de auditoría (toma física, merma) escriben al inventario nativo de Fullsite, pero eso no actualiza Wansoft. Esta deuda se resuelve cuando el cutover a Fullsite POS sea completo.

### 10.2 Ventas solo por categoría, no por platillo individual

`wansoft_daily.ventas_por_grupo` desglosa por categoría de menú, no por platillo. Para ver ventas por platillo individual sería necesario el deep scraper de Wansoft o los datos nativos de `pos_order_items`. El módulo `/platillos` usa categorías.

### 10.3 Nómina es estimativa

El módulo `/nomina` calcula salarios basados en tarifas por hora hardcodeadas por rol y días con ventas registradas. No hay integración con reloj de entrada/salida real, ni con un sistema de RH. Es un primer nivel de análisis, no una nómina oficial.

### 10.4 Food cost requiere recetas en Fullsite

El módulo `/food-cost` calcula márgenes desde `pos_recipes_old` + `pos_ingredients`. Si un platillo no tiene receta cargada en Fullsite, no aparece. La importación inicial de recetas desde Wansoft está parcialmente completada.

### 10.5 CRM no conectado al POS

El módulo `/crm` tiene `pos_customers` con historial de visitas, pero el POS no captura el cliente en cada orden de forma automática — es un campo opcional. La cobertura del CRM depende de qué tan consistentemente los meseros asocian clientes a órdenes.

### 10.6 Conciliación, Egresos, Notas de Crédito — implementación básica

Estos módulos existen (`/conciliacion`, `/egresos`, `/notas-credito`) pero están en nivel "exists" — tienen la página creada con la interfaz básica pero sin la profundidad de los módulos core (ventas, inventario, meseros). No tienen la misma riqueza de filtros, exportaciones y comparativos.

### 10.7 Voice Agent en desarrollo

`/voice` existe como ruta pero sin implementación sustancial documentada en el código revisado. [INFERENCIA — no se leyó ese archivo]

### 10.8 Facturación CFDI apunta al POS, no al dashboard

El link de "Facturación CFDI" en el sidebar apunta a `/pos/facturacion`, que es parte del POS, no del dashboard. El módulo no existe como página independiente del dashboard. [HECHO — verificado en Sidebar.tsx]

### 10.9 Módulos de admin tienda tienen URL inconsistente

Los módulos de tienda (`/admin/tienda/articulos`, etc.) existen pero no aparecen en la sección de sidebar "POS Restaurante" — solo en la sección "POS Restaurante" aparecen los módulos clásicos de restaurante. Los de tienda están en la navegación secundaria del admin. [HECHO — rutas verificadas pero sin link en sidebar principal]

### 10.10 Data staleness en inventario Wansoft

`wansoft_data/inventory_parsed` se actualiza cuando el scraper corre. La frecuencia es variable. Los módulos de Orden de Compra y Punto de Reorden que leen de este snapshot pueden mostrar datos de hace 12-24h. No hay indicador de frescura en la UI de estos módulos.

---

## 11. Roadmap

Basado en el código actual, los siguientes desarrollos son los más urgentes:

### 11.1 Inmediato (post-cutover)

1. **Reconciliar inventarios** — una vez que el POS nativo sea la fuente primaria, eliminar la dependencia de `wansoft_data/inventory_parsed`. Los módulos de inventario deben leer solo de `pos_inventory`.

2. **Ventas por platillo individual** — usar `pos_order_items` para construir el módulo `/platillos` con desglose real por ítem, no solo por categoría.

3. **Indicador de frescura en inventario** — mostrar cuándo fue la última sincronización del snapshot de Wansoft en los módulos que lo usan.

### 11.2 Mediano plazo

4. **CRM conectado al POS** — captura automática de cliente en cada orden del POS, no opcional.

5. **Módulo de reservaciones** — existe la tabla `amalay_reservaciones` con datos, pero no hay UI de dashboard para CRUD de reservaciones. Solo la página pública `/reservar`.

6. **Nómina con reloj de entrada/salida** — integrar con el módulo de turnos del POS para calcular horas reales trabajadas.

7. **Conciliación bancaria real** — conectar con los extractos bancarios para la conciliación automática.

### 11.3 Largo plazo

8. **Offline boot para dashboard** — actualmente requiere Vercel URL para cargar. Post-cutover, hacer bundle Electron para el dashboard también (hoy solo el POS tiene Electron).

9. **Multi-sucursal con datos reales** — el selector de sucursal existe en el sidebar pero la tabla `wansoft_daily` es mono-sucursal. Con datos nativos de POS se puede filtrar por `location_id` real.

10. **Reportes agendados** — que el dueño pueda suscribirse a que el Estado de Resultados, nómina o reporte de platillos llegue automáticamente a su email cada semana.

---

## 12. Referencias al Código

| Archivo | Propósito | Estado |
|---|---|---|
| `/src/app/layout.tsx` | Root layout: AuthProvider, AppShell, Inter font, PWA meta | [HECHO] |
| `/src/components/Sidebar.tsx` | Navegación principal con secciones colapsables y roles | [HECHO] |
| `/src/components/AppShell.tsx` | Wrapper que decide si mostrar sidebar o layout full-screen (POS) | [HECHO — importado en layout.tsx] |
| `/src/contexts/AuthContext.tsx` | Contexto global: user, role, clientId, clientConfig, locations | [HECHO] |
| `/src/lib/data.ts` | Funciones de fetch: wansoft_daily, pos_orders, agent_runs | [HECHO] |
| `/src/lib/roles.ts` | Definición de roles y permisos por página | [HECHO] |
| `/src/lib/plans.ts` | Planes comerciales y páginas habilitadas por plan | [HECHO] |
| `/src/lib/client-config.ts` | Config por cliente (display_name, plan, data_source) | [INFERENCIA — importado pero no leído] |
| `/src/lib/pos-data.ts` | Fetch de datos nativos POS (recetas, inventario) | [HECHO — importado en recetas y auto86] |
| `/src/lib/inventory.ts` | Operaciones de inventario: recordMovement(), idempotencia, ledger | [HECHO] |
| `/src/lib/supabase-browser.ts` | Cliente Supabase singleton para browser | [HECHO — importado en AuthContext] |
| `/src/lib/supabase-api.ts` | Helper `sbApi()` para fetch directo a REST API | [HECHO — usado en compras/page.tsx] |
| `/src/app/page.tsx` | Home dashboard — 13 widgets, 3 períodos, auto-refresh | [HECHO] |
| `/src/app/ventas/page.tsx` | Análisis de ventas por período con presets | [HECHO] |
| `/src/app/cortes/page.tsx` | Cierres de caja con heatmap de calendario | [HECHO] |
| `/src/app/meseros/page.tsx` | Ranking y KPIs de meseros con radar chart | [HECHO] |
| `/src/app/platillos/page.tsx` | Ventas por categoría de menú (30 días) | [HECHO] |
| `/src/app/tendencias/page.tsx` | Análisis de largo plazo: mensual, DOW, ticket promedio | [HECHO] |
| `/src/app/food-cost/page.tsx` | Costo por platillo vs precio. Detección de market y sospechosos | [HECHO] |
| `/src/app/estado-resultados/page.tsx` | P&L mensual/trimestral/semestral/anual | [HECHO] |
| `/src/app/nomina/page.tsx` | Pre-nómina estimativa por período y tabs de rendimiento | [HECHO] |
| `/src/app/inventario-real/page.tsx` | Vista maestro inventario (snapshot Wansoft) | [HECHO] |
| `/src/app/inventario-real/toma-fisica/page.tsx` | Conteo físico con escritura a ledger | [HECHO] |
| `/src/app/inventario-real/merma/page.tsx` | Registro de mermas con motivo y costo | [HECHO] |
| `/src/app/inventario-real/entradas/page.tsx` | Entradas de mercancía sin factura | [HECHO] |
| `/src/app/inventario-real/orden-compra/page.tsx` | OC automática basada en puntos de reorden | [HECHO] |
| `/src/app/inventario-real/produccion/page.tsx` | Órdenes de producción con deducción de insumos | [HECHO] |
| `/src/app/inventario-real/reorden/page.tsx` | Configuración y monitoreo de puntos de reorden | [HECHO] |
| `/src/app/inventario-real/subproductos/page.tsx` | CRUD de subproductos con cálculo de costo | [HECHO] |
| `/src/app/inventario-real/transferencias/page.tsx` | Transferencias entre almacenes | [HECHO] |
| `/src/app/inventario-real/movimientos/page.tsx` | Log de todos los movimientos (ledger viewer) | [HECHO] |
| `/src/app/recetas/page.tsx` | CRUD de recetas con cálculo de costo | [HECHO] |
| `/src/app/recetas/sub-recetas/page.tsx` | CRUD de sub-recetas | [HECHO] |
| `/src/app/auto86/page.tsx` | Detector de platillos no disponibles por inventario | [HECHO] |
| `/src/app/crm/page.tsx` | Base de clientes con historial y tags | [HECHO] |
| `/src/app/mission-control/page.tsx` | Centro de monitoreo de 24 agentes IA | [HECHO] |
| `/src/app/agentes/*.tsx` | Páginas individuales por agente | [HECHO — rutas verificadas] |
| `/src/app/chat/page.tsx` | Chat IA con sugerencias de inicio | [HECHO — UI] |
| `/src/app/coach/page.tsx` | Coach operativo delegado a CoachPanel | [HECHO] |
| `/src/app/compras/page.tsx` | Productos bajo reorden y movimientos recientes | [HECHO] |
| `/src/app/proveedores/page.tsx` | Catálogo de proveedores con KPIs de cobertura | [HECHO] |
| `/src/app/cancelaciones/page.tsx` | Descuentos y cancelaciones con tendencia mensual | [HECHO] |
| `/src/app/delivery/page.tsx` | Ventas por plataforma y pagos de plataformas | [HECHO] |
| `/src/app/reportes/page.tsx` | Generador de reportes con exportación CSV | [HECHO] |
| `/src/app/admin/menu/page.tsx` | CRUD de platillos y categorías del POS | [HECHO] |
| `/src/app/admin/usuarios/page.tsx` | Gestión de usuarios y roles | [HECHO — ruta verificada] |

---

## Cross References

Este documento es parte de la familia de Bibles de Fullsite. Las decisiones de arquitectura que afectan al dashboard pero están explicadas en profundidad en otro documento se enlazan aquí.

**→ POS Bible** — Ver § Flujos principales para entender cómo se generan los datos que el dashboard muestra (cómo una orden se convierte en un registro en `pos_orders`). Ver § Pagos para los métodos de pago válidos y cómo se registran en `pos_order_items`. Ver § Offline para entender por qué algunos datos pueden llegar con delay al dashboard cuando una terminal operó sin conexión.

**→ Engineering Bible** — Ver § Transaction A/B para entender por qué la deducción de inventario puede aparecer en el dashboard con retraso respecto a la orden (Transaction B es eventual). Ver § Source of Truth para el mapa técnico completo de tablas y su autoridad. Ver § Sincronización Offline para entender cuándo `pos_orders` recibe los datos de operación offline y por qué el dashboard puede mostrar datos del día anterior mientras hay órdenes pendientes de sync.

**→ Domain Bible** — Ver § InventoryItem e InventoryMovement para el schema completo de las entidades de inventario que alimentan los módulos de dashboard (`pos_inventory`, `pos_inventory_movements`, `pos_ingredients`). Ver § Order para los campos de `pos_orders` y `pos_order_items` que se usan en analytics y en el fallback de ventas.

**→ Operations Bible** — Ver § Flujos principales para entender el contexto operativo de los datos que el dashboard muestra (qué es un turno, un corte, cómo se registra una venta en la práctica). Ver § Agentes de IA para los triggers, frecuencia y outputs esperados de cada agente que escribe en `agent_runs`.

**→ Master Bible** — Ver § Flujo de información (extremo a extremo) para entender desde dónde vienen los datos que llegan al dashboard (terminal → Supabase → wansoft_daily → dashboard). Ver § Source of Truth (tabla global) para el mapa completo de qué tabla es la autoridad de cada dato del negocio.

---

## Open Questions & Future Work

Esta sección es el backlog arquitectónico del dashboard. Incluye dudas que surgieron durante el análisis, deuda técnica identificada, decisiones pendientes e inconsistencias encontradas entre el código y la documentación existente.

---

**[INCONSISTENCIA]** Campo `pago_métodos` con tilde en la BD  
> Descripción: La columna en `wansoft_daily` se llama `pago_métodos` (con tilde en é). Código legado en algunos módulos usa `pago_metodos` (sin tilde). El campo JSONB llega como string en lugar de objeto en ciertos contextos. La función `safeArray()` maneja el parse, pero el mismatch de nombre puede causar `undefined` silencioso si alguien hace un query directo sin conocer este detalle.  
> Impacto: Queries manuales o nuevos módulos que lean este campo pueden retornar vacío sin error visible.  
> Prioridad sugerida: P1

---

**[DEUDA]** Dos inventarios paralelos sin reconciliación  
> Descripción: `wansoft_data/inventory_parsed` (snapshot de Wansoft) y `pos_inventory` (inventario nativo de Fullsite) coexisten sin sincronización automática. Los módulos de Orden de Compra y Punto de Reorden leen del snapshot de Wansoft; los módulos de Toma Física, Merma y Entradas escriben al inventario nativo. No hay mecanismo para que los movimientos nativos se reflejen en el snapshot, ni viceversa.  
> Impacto: Después del cutover, el snapshot de Wansoft quedará desactualizado pero los módulos de OC seguirán leyéndolo. Los datos de cuánto pedir serán incorrectos.  
> Prioridad sugerida: P0 (para el cutover)

---

**[DUDA]** ¿El fallback `getDashboardFromPosOrders()` calcula exactamente los mismos campos que `wansoft_daily`?  
> Descripción: `getDashboardFromPosOrders()` en `data.ts` construye un objeto tipo `WansoftDaily` desde `pos_orders`. No se verificó si calcula `propinas_total`, `descuentos`, `ventas_brutas`, `mesas_atendidas` con la misma semántica que Wansoft. Podría haber diferencias de definición (ej. Wansoft cuenta "personas" diferente que Fullsite).  
> Impacto: Durante el período de transición, los KPIs mostrados pueden diferir según si el dato viene de Wansoft o del fallback. El dueño podría ver números inconsistentes.  
> Prioridad sugerida: P1

---

**[DEUDA]** `pos_recipes_old` tiene nombre "old" — ¿hay una versión nueva?  
> Descripción: La tabla de recetas se llama `pos_recipes_old`. El módulo `/recetas/sub-recetas` usa `pos_sub_recipes` (sin "old"). No está claro si existe o se planea una tabla `pos_recipes` (sin "old") con un schema diferente.  
> Impacto: Si alguien crea `pos_recipes` como "nueva versión", los módulos actuales que leen `pos_recipes_old` quedarán desconectados.  
> Prioridad sugerida: P2

---

**[DECISIÓN PENDIENTE]** ¿El Chat IA usa un API route de Next.js o llama directamente a la API de Anthropic desde el browser?  
> Descripción: El componente `/chat/page.tsx` tiene la UI del chat pero no se leyó el endpoint al que envía los mensajes. Llamar directamente a Anthropic desde el browser expone el API key. Si usa un API route de Next.js, ese archivo no fue revisado.  
> Impacto: Si el API key está expuesto en el cliente, cualquier persona con DevTools puede hacer queries a Claude a cargo de Fullsite.  
> Prioridad sugerida: P0

---

**[INCONSISTENCIA]** `wansoft_daily.platillos_top` mezcla platillos, meseros y grupos  
> Descripción: El comentario en `CLAUDE.md` dice: "`platillos_top` en la BD actual mezcla platillos, meseros y grupos — filtrar con cuidado". El módulo `/platillos` usa `ventas_por_grupo` (no `platillos_top`), pero si alguien usa `platillos_top` directamente obtendrá datos mezclados.  
> Impacto: Cualquier nuevo módulo que intente mostrar "top platillos" desde este campo mostrará datos incorrectos sin error visible.  
> Prioridad sugerida: P1

---

**[DEUDA]** Los módulos "Exists" (conciliación, egresos, notas de crédito, etc.) no fueron leídos durante este análisis  
> Descripción: Los archivos `/conciliacion/page.tsx`, `/egresos/page.tsx`, `/notas-credito/page.tsx`, `/contabilidad/page.tsx`, `/control-efectivo/page.tsx`, `/reporte-fiscal/page.tsx`, `/costos/page.tsx`, `/cierre-inventario/page.tsx`, `/lealtad/page.tsx`, `/encuestas/page.tsx` no fueron leídos. Su estado real es [INFERENCIA] basado en el hecho de que existen como rutas y aparecen en el sidebar.  
> Impacto: Este documento puede sobreestimar la completitud de estos módulos.  
> Prioridad sugerida: P2 — leer y actualizar la sección 10 con el estado real

---

**[DUDA]** ¿El Voice Agent (`/voice`) tiene implementación o es solo una ruta vacía?  
> Descripción: La ruta `/voice` existe y aparece en el sidebar como "Voice Agent". El archivo `page.tsx` no fue leído. Podría ser una página en blanco, un placeholder, o una implementación funcional.  
> Impacto: El sidebar promete una funcionalidad que puede no existir.  
> Prioridad sugerida: P2

---

**[INCONSISTENCIA]** Efecto doble de wansoft_daily.efectivo/tarjeta como porcentaje vs MXN  
> Descripción: Los campos `efectivo` y `tarjeta` en `wansoft_daily` almacenan a veces porcentajes (< 100) y a veces montos MXN (≥ 100). El código detecta esto con `if (val < 100)`. Esto es frágil: si un día las ventas en efectivo son exactamente $50 MXN (perfectamente posible en operaciones mínimas), se interpretarán como 50%.  
> Impacto: Error silencioso de cálculo en `/ingresos` y `/caja` para días con efectivo < $100.  
> Prioridad sugerida: P1

---

**[DECISIÓN PENDIENTE]** ¿Los módulos de inventario Wansoft (`/inventario-real/*` que leen de `wansoft_data`) deben mostrarse después del cutover?  
> Descripción: Los módulos de Orden de Compra, Punto de Reorden y Vista Principal del inventario leen del snapshot de Wansoft (`wansoft_data/inventory_parsed`). Después del cutover, Wansoft ya no se usará como POS, el scraper dejará de correr, y el snapshot quedará stale. Estos módulos deberán migrar a leer de `pos_inventory` directamente.  
> Impacto: Si no se migran antes del cutover, estos módulos mostrarán datos de hace meses.  
> Prioridad sugerida: P0

---

**[DUDA]** ¿Qué sucede con el multi-tenancy cuando `NEXT_PUBLIC_DEFAULT_CLIENT_ID` está seteado a 'amalay'?  
> Descripción: El env var `NEXT_PUBLIC_DEFAULT_CLIENT_ID='amalay'` significa que cualquier usuario sin sesión (o con un bug en el login) verá datos de AMALAY. Para el segundo cliente de Fullsite, ¿cómo se configura? ¿Deploy separado por cliente? ¿Variable de entorno diferente? ¿O solo `client_users`?  
> Impacto: En producción multi-tenant real, este default puede filtrar datos de AMALAY a usuarios de otros restaurantes que tengan algún problema en su sesión.  
> Prioridad sugerida: P0 (para el onboarding del cliente #2)

---

**[DEUDA]** CoachPanel es una caja negra en este análisis  
> Descripción: La página `/coach` delega toda su lógica a `<CoachPanel />` que no fue leído. No sabemos qué hace, qué API llama, o qué datos usa. El único dato verificado es que existe el componente y que la descripción dice "Tu socio operativo que nunca deja de pensar en tu negocio".  
> Impacto: Este documento no puede documentar el Coach con certeza.  
> Prioridad sugerida: P2 — leer `CoachPanel.tsx` y actualizar

---

*Este documento se generó a partir del código fuente verificado el 2026-07-23. Para cambios posteriores a esta fecha, leer directamente los archivos en `/dashboard-app/src/`. Ante cualquier duda entre este documento y el código: el código manda.*
