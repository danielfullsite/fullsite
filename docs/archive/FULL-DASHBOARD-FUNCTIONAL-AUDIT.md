# Auditoría Funcional Completa — Fullsite Dashboard

> 185 páginas, 40 API routes, 30 componentes, 43 lib files auditados.
> 5 agentes en paralelo: dashboard+ventas, finanzas, inventario, POS+admin, APIs+seguridad.
> Fecha: 2026-07-17. Clasificación: HECHO / INFERENCIA / HIPÓTESIS.

---

## Mapa del dashboard

| Área | Páginas | Estado general |
|---|---|---|
| Dashboard + reportes | 13 | Funcional, bugs de datos menores |
| Finanzas + contabilidad | 12 | Funcional, gaps de seguridad en queries |
| Inventario + recetas + food cost | 17 | ARQUITECTURALMENTE ROTO — write-only |
| POS + KDS + admin | 21 | Funcional, gaps de permisos |
| APIs + lib + seguridad | 19 | Gaps sistémicos de tenant isolation |

---

## P0 — CRÍTICO (pérdida de datos, seguridad, cobros incorrectos, inventario corrupto)

### P0-1: Inventario write-only — NINGUNA operación actualiza stock real
**Tipo:** HECHO
**Alcance:** entradas, entradas-factura, merma, toma-física (4 páginas)
**Problema:** Todas escriben a `wansoft_data` como JSON blob. Ninguna actualiza `pos_inventory`, `pos_inventory_products`, ni ninguna tabla que el POS, Auto-86, o cierre-inventario lean. El staff registra operaciones creyendo que el stock cambia. No cambia.
**Impacto:** Auto-86 muestra "Todo disponible" falsamente. Toma física no reconcilia. Entradas no incrementan stock. Merma no decrementa.
**Archivos:** `inventario-real/entradas/page.tsx:223`, `entradas-factura/page.tsx:356`, `merma/page.tsx:305`, `toma-fisica/page.tsx:205`
**Recomendación:** Conectar cada operación a `pos_inventory` con una transacción atómica. Sin esto, el módulo completo de inventario es decorativo.

### P0-2: Chat IA — cross-tenant data access
**Tipo:** HECHO
**Alcance:** `/api/chat/route.ts:102`
**Problema:** `client_id` viene del body del request, no de la sesión. Cualquier usuario autenticado puede leer ventas, staff, recetas y costos de CUALQUIER tenant. Además, `wansoft_waiter_categories` y `wansoft_food_cost` se consultan SIN filtro de `client_id` en absoluto.
**Impacto:** Leak total de datos operativos entre clientes en producción multi-tenant.
**Recomendación:** Derivar `client_id` del JWT/sesión, no del body. Agregar `client_id` filter a todas las queries.

### P0-3: getClientId() — raíz de tenant isolation
**Tipo:** HECHO
**Alcance:** `lib/api-auth.ts:35-40`
**Problema:** `getClientId()` lee de `x-client-id` header o `client_id` query param — ambos son controlables por el cliente. No hay binding entre la sesión autenticada y el client_id. Esto afecta TODAS las APIs que usan esta función.
**Impacto:** Cualquier caller puede impersonar cualquier tenant.
**Recomendación:** Resolver `client_id` desde el JWT claims o desde la tabla `client_users` vinculada al user_id de la sesión.

### P0-4: Contabilidad y reporte-fiscal — queries sin client_id
**Tipo:** HECHO
**Alcance:** `contabilidad/page.tsx:139-151`, `reporte-fiscal/page.tsx:43`
**Problema:** Queries a `pos_orders`, `pos_invoices`, `pos_cfdi_requests` NO filtran por `client_id`. Devuelven datos de TODOS los clientes.
**Impacto:** Datos fiscales de otros restaurantes visibles.
**Recomendación:** Agregar `client_id=eq.${_cid()}` a todas las queries.

### P0-5: /caja tabla muestra porcentajes como pesos MXN
**Tipo:** HECHO
**Alcance:** `caja/page.tsx:94-95`
**Problema:** La tabla diaria renderiza `d.efectivo` y `d.tarjeta` directo como MXN, pero estos campos son porcentajes (0-100). El gráfico arriba SÍ convierte. La tabla no.
**Impacto:** Cajero ve "$42.30" en vez de "$42,300" — reconciliación de caja imposible.
**Recomendación:** Aplicar la misma conversión `val < 100 ? (val/100) * ventas_dia : val` que ya existe en `/ingresos`.

---

## P1 — BLOQUEADOR (impide usar correctamente una función central)

### P1-1: save-order y merge-orders sin auth check
**Tipo:** HECHO
**Alcance:** `/api/pos/save-order/route.ts`, `/api/pos/merge-orders/route.ts`
**Problema:** No verifican sesión. Cualquier caller no autenticado puede escribir órdenes o fusionar mesas si conoce un order_id.
**Recomendación:** Agregar `requireAuth()` al inicio de ambas rutas.

### P1-2: PIN endpoint acepta client_id del body
**Tipo:** HECHO
**Alcance:** `/api/pos/pin/route.ts:33`
**Problema:** `client_id` viene del body. Permite enumeración cross-tenant de PINs.
**Recomendación:** Derivar client_id del contexto seguro.

### P1-3: Backup — env var equivocada + no tenant isolation
**Tipo:** HECHO
**Alcance:** `/api/backup/route.ts:4`
**Problema:** Usa `SUPABASE_SERVICE_ROLE_KEY` (no existe) vs `SUPABASE_SERVICE_KEY`. Además, ninguna tabla se filtra por `client_id` — backup exporta datos de todos los tenants.
**Recomendación:** Corregir env var. Agregar `client_id` filter.

### P1-4: Nómina — ediciones no se guardan
**Tipo:** HECHO
**Alcance:** `nomina/page.tsx:255`
**Problema:** Editar tarifa horaria por empleado es state local — se pierde al refrescar.
**Recomendación:** Persistir rates en `pos_staff` o tabla dedicada.

### P1-5: Missing .catch() en 8+ páginas
**Tipo:** HECHO
**Alcance:** cancelaciones, delivery, caja (pre-fix), ingresos (pre-fix), propinas (pre-fix), y más
**Problema:** Sin `.catch()` en data load, el spinner de carga gira infinitamente si la red falla.
**Recomendación:** Agregar `.catch(() => {}).finally(() => setLoading(false))` en todas las cargas.

### P1-6: Anti-fraude no respeta filtro de fecha
**Tipo:** HECHO
**Alcance:** `ventas/page.tsx:110`
**Problema:** Cancelaciones, anulaciones, cortesías siempre muestran el snapshot más reciente, sin importar el preset de fecha seleccionado.
**Recomendación:** Filtrar anti-fraude por el mismo rango de fechas del preset.

### P1-7: 3 tablas de inventario incompatibles
**Tipo:** HECHO
**Alcance:** Todo el módulo de inventario
**Problema:** `pos_inventory_products` (inventario, compras), `pos_inventory` (cierre-inventario, auto86), `wansoft_data.inventory_parsed` (inventario-real). Tres fuentes de stock paralelas sin sincronización.
**Recomendación:** Definir UNA tabla canónica y migrar las demás.

### P1-8: Turno — meseros acceden a Corte X
**Tipo:** INFERENCIA
**Alcance:** `turno/page.tsx` — botón Corte X sin role check
**Problema:** Cualquier staff logueado en POS puede ver el snapshot financiero del turno.
**Recomendación:** Agregar role check: solo gerente/admin/cajero.

### P1-9: Corte access persiste en sessionStorage
**Tipo:** INFERENCIA
**Alcance:** `corte/page.tsx:167`
**Problema:** Una vez que un gerente desbloquea el corte, cualquier persona en esa terminal puede acceder hasta que se cierre la sesión del navegador.
**Recomendación:** Invalidar `corte_access` al cambiar de usuario o después de X minutos.

### P1-10: Fusionar mesas sin permiso
**Tipo:** INFERENCIA
**Alcance:** `mesas/page.tsx:706`
**Problema:** Cualquier mesero puede fusionar mesas. No hay role check ni PIN.
**Recomendación:** Requerir PIN de gerente para merge.

### P1-11: Wansoft inventory_parsed — sin freshness check
**Tipo:** INFERENCIA
**Alcance:** Toda la sección inventario-real
**Problema:** Si el scrape de Wansoft no corre, todos los datos de inventario son stale sin aviso.
**Recomendación:** Mostrar banner de alerta si datos tienen >24h.

---

## P2 — IMPORTANTE (confusión, trabajo manual, datos poco confiables)

### Seguridad y datos
- Anon key para writes en gastos, control-efectivo, notas-crédito (5+ páginas)
- `monica@fullsite.mx` en backup admins y roles (ya removida de roles, falta backup)
- fs-at cookie no httpOnly — XSS puede robar sesión
- Dos sistemas offline compitiendo (localStorage vs IndexedDB)
- `client_id` desde localStorage (spoofable) en pages con writes directos

### Consistencia de datos
- `/egresos` y `/gastos` — misma funcionalidad, diferentes tablas DB
- Recetas: `/recetas` escribe a `pos_recipes_old`, food-cost lee de `wansoft_recipes` — no se conectan
- Dos fuentes de proveedores: `pos_suppliers` vs `wansoft_data.proveedores_catalog`
- Movimientos muestra `[object Object]` como nombre de proveedor
- Payment methods: 3 copias de la lógica % vs MXN sin utilidad compartida

### UX y navegación
- URL directa bypass role checks del sidebar (AppShell no verifica roles por ruta)
- "Conectado" en sidebar siempre estático — nunca muestra offline
- Auditoría POS accesible a cualquier mesero sin role gate
- Historial de órdenes: reimpresión sin PIN ni throttle
- Widget configurator en dashboard — premature para 0 clientes multi-restaurant
- Periodos inconsistentes entre tabs de meseros (ventas usa selector, KPIs siempre 30d)

### Formularios y validaciones
- Reorden permite max < min silenciosamente
- Notas-crédito folio con Math.random() puede colisionar
- Gastos: delete/mark-paid sin verificar res.ok
- Admin/modificadores: delete sin confirmación
- Admin/menú: precio puede ser negativo o cero
- Cierre-inventario: `client_id=eq.amalay` hardcoded

### Performance
- `getRecentDays(1000)` en dashboard — carga inicial pesada
- Tendencias: loop cuadrático O(meses × días) en descuentos trending
- Supabase 1000-row limit afecta pos_recipes_old (4069 rows) — ya fixeado en cost-engine

---

## P3 — MEJORA (calidad de experiencia)

- NotificationBell solo visible en desktop
- Sidebar sin búsqueda/filtro con 40+ items
- No hay export/download en ninguna tabla de reportes
- Charts sin leyendas en varias páginas
- Platillos: chilaquiles/H&H hardcoded para AMALAY
- Date picker es un input invisible overlaid (no keyboard accessible)
- Confirmaciones con `confirm()` — puede fallar en Electron
- Admin/usuarios: password capturado pero nunca usado

---

## Lógicas transversales

### Formularios
| Check | Estado |
|---|---|
| Campos obligatorios | Parcial — varía por página |
| Valores negativos | Falta en admin/menu (precio), formas-pago (comisión) |
| Duplicados | Solo en sub-recetas y staff (PIN). Falta en notas-crédito (folio) |
| Doble envío | Solo en sub-recetas y CierreCajaWizard. Falta en la mayoría |
| Cambios sin guardar | No existe en ninguna página |
| Mensajes de validación | Inconsistente — algunos usan toast, otros alert, otros nada |

### Tablas y listas
| Check | Estado |
|---|---|
| Búsqueda | Existe en la mayoría |
| Filtros | Parcial — muchas páginas sin date range |
| Paginación | No existe en ninguna página (cortan a 200-300 rows) |
| Estado vacío | Parcial — 60% de páginas lo tienen |
| Actualización post-edit | Sí en la mayoría (fetchData() después de save) |

### Acciones destructivas
| Check | Estado |
|---|---|
| Confirmación | Solo en cierre de turno (PIN) y algunos admin pages (confirm()) |
| PIN requerido | Solo cierre de turno, cancelación KDS, corte view |
| Audit trail | Solo en POS (pos_audit_log). Falta en admin pages |
| Soft delete | Sub-recetas sí. Staff sí. Menú items sí. Gastos no |

### Seguridad
| Check | Estado |
|---|---|
| client_id filtering | 70% de queries — falta en chat, contabilidad, reporte-fiscal, backup |
| Role checks en UI | Solo POS layout y staff page. Falta en admin pages y reportes |
| Auth en APIs | Falta en save-order, merge-orders, staff list |
| Tenant isolation | ROTO para multi-tenant por getClientId() design |

---

## 4 Listas ejecutables

### Lista 1: Bloqueadores antes de seguir desarrollando
1. Definir tabla canónica de inventario (pos_inventory vs pos_inventory_products vs wansoft_data)
2. Conectar entradas/merma/toma-física a la tabla canónica
3. Agregar `.catch()` a todas las cargas de datos
4. Fix tabla de /caja (% vs MXN)

### Lista 2: Bloqueadores antes de instalar en otro restaurante
1. Resolver getClientId() — binding sesión↔client_id
2. Agregar client_id filter a chat, contabilidad, reporte-fiscal, backup
3. Auth check en save-order, merge-orders
4. Corregir backup env var (SERVICE_ROLE_KEY → SERVICE_KEY)
5. Remover monica@fullsite.mx de backup admins
6. Persistir ediciones de nómina
7. Remover chilaquiles/H&H hardcoded de platillos page

### Lista 3: Mejoras necesarias antes de vender Fullsite formalmente
1. Role checks en admin pages (no depender solo del layout)
2. PIN para merge mesas, reimpresión, toggle staff, Corte X
3. Export CSV/Excel en todos los reportes
4. Paginación en tablas grandes (>100 rows)
5. Unificar lógica % vs MXN en una función compartida
6. Conectar recetas editadas con food-cost (pos_recipes_old → engine)
7. Freshness warning en datos de Wansoft
8. Prevención de doble envío en todos los formularios
9. Warning de cambios sin guardar

### Lista 4: Mejoras que pueden esperar
1. Sidebar búsqueda/filtro
2. Mobile notifications
3. Keyboard accessibility en date pickers
4. Real connectivity indicator en sidebar
5. Batch timbrado para CFDI
6. Portal user management real (actualmente prototipo)
7. Swipe-to-close en mobile sidebar
