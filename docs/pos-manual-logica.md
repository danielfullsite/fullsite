# Fullsite POS — Manual de lógica del sistema

> Última actualización: 2026-06-12. Fuente de verdad: el código en `dashboard-app/`.
> Este manual documenta CÓMO funciona el sistema y POR QUÉ está hecho así, para que
> cualquier sesión futura (humana o IA) pueda operar sin redescubrir nada.

---

## 1. Visión general

- **Qué es**: POS web (Next.js + Supabase) que reemplaza a Wansoft/NetSilver en AMALAY.
  Corre en cualquier browser (tablet, laptop, teléfono) — sin hardware propietario.
- **Stack**: Next.js (App Router, versión con breaking changes — leer `node_modules/next/dist/docs/`
  antes de tocar APIs), Supabase (Postgres + REST), Tailwind v4, vitest + Playwright.
- **Regla de oro de datos**: NUNCA usar el SDK de Supabase en el dashboard (se cuelga en Next.js).
  Todo va por `fetch()` directo a `{SUPABASE_URL}/rest/v1/...` con headers `apikey` + `Authorization`.
- **Multi-tenant**: toda tabla tiene `client_id` (default `'amalay'`). El cliente activo viene de
  `localStorage.fullsite_client_id` (seteado por AuthContext) vía `_getClientId()` en `pos-data.ts`.
- **Escrituras sensibles**: el browser usa anon key (lectura + escrituras permitidas por RLS);
  lo que la anon key no puede hacer pasa por rutas `/api/*` server-side con `SUPABASE_SERVICE_KEY`
  (patrón: `/api/factura`, `/api/pos/pin`, `/api/factura/timbrar`).

## 2. Mapa de páginas

| Ruta | Rol |
|---|---|
| `/pos` | Pantalla principal de venta: mesas, items, modificadores, split, cobro |
| `/pos/mesas`, `/pos/plano` | Selección de mesa / plano del piso (16 mesas, `MESAS_COUNT`) |
| `/pos/cocina` | Display de cocina (excluye bebidas vía station/keywords) |
| `/pos/barra` | Display de barra (solo bebidas) |
| `/pos/kds` | KDS multi-estación: caliente / fría / panadería / barra |
| `/pos/corte` | Corte de caja — **gate de PIN de gerente** (2026-06-12) |
| `/pos/turno` | Apertura/cierre de turno (`pos_turnos`, fondo inicial) |
| `/pos/historial` | Órdenes cerradas del día, reabrir (reopen → status `enviada`) |
| `/pos/auditoria` | Lectura de `pos_audit_log` |
| `/pos/qr` | Genera QR del ticket → cliente abre `/factura` para pedir CFDI |
| `/pos/facturacion` | Admin de solicitudes CFDI + botón Timbrar (Facturama) |
| `/pos/cliente` | Vista cliente |
| `/pos/delivery` | Órdenes delivery (`delivery_orders`, tabla paralela a `pos_orders`) |
| `/pos/inventario`, `/pos/inventario-fisico`, `/pos/merma` | Stock, conteo físico, mermas |
| `/pos/recetas` | Recetas (ingredientes por platillo) |
| `/pos/compras`, `/pos/orden-compra`, `/pos/facturas-proveedor` | Ciclo de compras |
| `/facturas` (dashboard) | Admin XML proveedores + sección de solicitudes CFDI de clientes |

APIs: `/api/pos/pin` (verificación PIN server-side, rate-limited 10/min/IP),
`/api/pos/staff`, `/api/factura` (GET/POST/PATCH solicitudes CFDI),
`/api/factura/timbrar` + `/api/factura/descarga` (Facturama).

## 3. Modelo de datos (Supabase)

Los `CREATE TABLE` canónicos viven como comentarios al inicio de `src/lib/pos-data.ts`.

| Tabla | Propósito | Notas clave |
|---|---|---|
| `pos_orders` | Órdenes | `items JSONB` (array de OrderItem), `status`, `pagos JSONB` (multi-forma), `turno_id`, `descuento`, `closed_at` |
| `pos_audit_log` | Blindaje — inmutable | NUNCA se borra nada; acciones: `order_created`, `item_cancelled`, `discount_applied`, `payment_processed`, etc. |
| `pos_turnos` | Turnos de caja | turno activo = `closed_at IS NULL` |
| `pos_menu_categories` / `pos_menu_items` | Menú desde BD | `color` (clase Tailwind — ver §12 safelist), `sort_order`, `active`. Fallback a `MENU_CATEGORIES` estático |
| `pos_staff` | Empleados + PINs + roles | PIN de gerente se valida solo server-side |
| `pos_cfdi_requests` | Solicitudes de factura de clientes | status: `pendiente`/`facturada`/`error` |
| `pos_ingredients` / `pos_recipes` / `pos_recipes_old` | Ingredientes y recetas (795 cargadas de Excel) | |
| `pos_inventory` / `pos_inventory_movements` | Stock + movimientos (`deduction`,`restock`,`adjustment`,`waste`) | |
| `pos_purchase_orders` / `pos_purchase_order_items` / `pos_facturas` | Compras: borrador→enviada→recibida→facturada→pagada | |
| `delivery_orders` | Delivery | **Paralela** a pos_orders, sin reconciliación (limitación §14) |
| `pos_events` (event store) | Shadow mode Fullsite OS | append-only, `publishEvent()` en `src/lib/events.ts` |

### OrderItem (dentro de `pos_orders.items`)

```ts
{ id, menuItemId, nombre, precio, cantidad, modificadores: string[], notas,
  precioExtra, subtotal,           // subtotal = (precio + precioExtra) * cantidad
  silla?: number,                  // asiento
  station?: 'cocina'|'barra'|'caja' }  // FIJADA AL AGREGAR — ver §5
```

Items especiales: separadores de tiempo (`menuItemId === '__tiempo__'`, `TIEMPO_ITEM_ID`),
partidas $0.00 estilo Wansoft que indican "XX TIEMPO: N XX" en comandas.

### Ciclo de status de orden

```
abierta → enviada → preparando → lista → entregada → cerrada
                ↘ cancelada (requiere PIN gerente + audit)
cerrada → (reabrir desde historial) → enviada
```

## 4. Flujo completo de una orden

1. **Crear**: mesero elige mesa (o cuenta por nombre `clienteNombre`, mesa=0) → `order_created` en audit.
2. **Agregar items**: modal de modificadores (`getModifiersForCategory`) → al confirmar,
   `handleModifierConfirm` fija `item.station = getStationForItem(categoryId, nombre)`
   usando la **categoría real de BD** (no keywords). Items idénticos se mergean (cantidad++),
   preservando la station existente.
3. **Enviar a cocina**: status `enviada` + impresión de comandas por estación
   (`printByStation` → `splitOrderByStation`) + `order_sent_kitchen` en audit.
4. **Cocina/KDS**: `getKitchenOrders()` lee `status in (enviada,preparando,lista)` de las
   últimas 12h, polling cada 3-5s (`POLL_INTERVAL_*`). Archivado visual a las 4h (`KITCHEN_ARCHIVE_HOURS`).
5. **Pre-cuenta**: `printPreTicket` (no cierra nada).
6. **Cobro**: ver §6. Genera `payment_processed` + `order_closed` en audit, guarda
   `pagos JSONB`, `turno_id` del turno activo, `closed_at`.
7. **Corte**: `/pos/corte` agrupa órdenes cerradas del día por método de pago
   (⚠ filtra por fecha `created_at`, no por `turno_id` — limitación §14).

Cancelaciones (orden o item): SIEMPRE requieren PIN de gerente (`verifyManagerPin`) y SIEMPRE
auditan con `reason` + `approved_by`. Nada se borra — requisito de Eduardo (anti-fraude).

Edición concurrente: last-write-wins con toast de conflicto vía `updated_at` (limitación §14).

## 5. Ruteo por estación

**Principio (fix 2026-06-12, bug Heineken)**: la estación se decide UNA vez, al agregar el item,
con la categoría real de la BD — y se persiste en `item.station`. Todo lo downstream la respeta.
Los keywords por nombre son SOLO fallback para órdenes viejas sin `station`.

- Fuente: `src/lib/pos-constants.ts`
  - `STATION_CATEGORIES`: mapa categoría→estación (cocina/barra/caja). Incluye categorías
    Wansoft importadas: `cerveza`,`vinos`,`licores`,`icecream`→barra; `promos`,`keto`...→cocina;
    `mkt-*`,`bakery`,`toast`,`postres`→caja (label "MARKET").
  - `getStationForItem(categoryId, nombre)`: categoría primero, `isBebida(nombre)` como fallback,
    default cocina.
  - `getStationByName(nombre)`: clasificador legacy puro por keywords (BEBIDA_KEYWORDS / CAJA_KEYWORDS).
- Impresión: `splitOrderByStation` (printer.ts:1071) usa `item.station ?? fallback`.
  Separadores de tiempo van a TODAS las estaciones con platillos; estaciones que quedan
  solo con separadores se limpian.
- KDS (`/pos/kds`): `barra`→barra, `caja`→panaderia; `cocina` se sub-divide por keywords
  en fría/panadería/caliente. Sin station → keywords completos (órdenes viejas).

**Por qué**: el lookup estático `MENU_CATEGORIES` y los keywords fallaban con el catálogo
importado de Wansoft (items `ws-*`, marcas como HEINEKEN sin keyword).

## 6. Cálculos de pago

Fuente de verdad: `src/lib/pos-calculations.ts` (funciones puras, 100% testeadas).
`IVA_RATE = 0.16`. **Orden de operaciones: subtotal → descuento → IVA.**

```
subtotalAfterDiscount = max(0, subtotal - descuento)
total = subtotalAfterDiscount * 1.16
```

- **Métodos**: Efectivo, Tarjeta, Transferencia, Mixto (`PAYMENT_METHODS`). Mixto guarda
  `pagos: [{metodo, monto}]`; la suma debe cuadrar con tolerancia de 1 centavo (validación cliente).
- **Propina**: `calcPropina(total, %)` redondeada a peso; NO lleva IVA; se resetea a 0
  después de cobrar cada cuenta (evita propina duplicada en splits).
- **Split parejo** (`calcSplitParejo`): cuentas 1..N-1 pagan `round2(total/N)`; la **última
  paga el remanente exacto** para que la suma cierre al centavo. Aplica igual a subtotal,
  descuento y total.
- **Split por items** (`calcSplitItems`): items sin asignar caen en cuenta 1; el descuento
  global se **prorratea por fracción del subtotal** de cada cuenta.
- Ambas funciones se usan TANTO en `handlePayment` como en el display del modal de cobro
  (`/pos/page.tsx`) — antes divergían y el total mostrado podía no ser el cobrado.
- Cuentas split se guardan como órdenes `{orderId}-C{n}`.
- Efectivo abre el cajón (`openCashDrawer`, ESC p — pasa por la cola de impresión §7).

## 7. Impresión (ESC/POS)

Fuente: `src/lib/printer.ts`. Tres transportes: Web Bluetooth (BLE), WebUSB, y print-bridge
HTTP local (`BRIDGE_URL`, tickets de 48 columnas para EC-PM-80250 80mm).

**Cola global serializada** (crítico, 2026-06-12): ESC/POS es sensible al orden de bytes.
TODA escritura BT/USB pasa por `writeToPrinter()` → `printChain` (promise chain global):
chunks de 128 bytes con 50ms de delay, incluye keep-alive (DLE EOT) y cajón (ESC p).
Dos impresiones concurrentes jamás intercalan chunks; un fallo no bloquea la cola.
Exportada para tests (`printer-queue.test.ts`).

- Multi-impresora por slot (`printers` Map), auto-reconexión BLE con guard
  `printers.get(slot) !== conn` (listeners viejos = no-op), keep-alive con guard de timer único.
- Tipos de ticket: comanda por estación, pre-cuenta, ticket de pago (ESC/POS o CSS print),
  ticket con QR de facturación.

## 8. Turnos y corte

- `pos_turnos`: abrir con fondo inicial (`opened_by`); turno activo = `closed_at IS NULL`
  (`getActiveTurno`). Al cerrar una orden se le estampa `turno_id`.
- `/pos/corte`: gate de PIN de gerente (sessionStorage `corte_access='1'` para no repetir
  en la misma sesión; cada acceso audita `corte_viewed`). Modo default "Turno actual"
  (órdenes por `turno_id` — los turnos que cruzan medianoche no se parten); modo "Por día"
  para cortes históricos por fecha. Muestra ventas por método, descuentos, propinas, arqueo
  de efectivo con fondo inicial.

## 9. CFDI / Facturación

Flujo cliente: ticket impreso lleva QR → `/factura?orden=...` → cliente captura RFC, razón
social, régimen, uso, CP, email → POST `/api/factura` (service key, validación server-side)
→ fila en `pos_cfdi_requests` (status `pendiente`).

Flujo admin: `/facturas` (sección solicitudes) y `/pos/facturacion` listan pendientes;
PATCH `/api/factura` marca `facturada` (+folio fiscal) o reabre. Timbrado automático:
`/api/factura/timbrar` contra Facturama (sandbox, en desarrollo — stream paralelo).

## 10. Seguridad y blindaje (requisitos Eduardo)

- **Nada se borra**: cancelaciones marcan, no eliminan; `pos_audit_log` es append-only.
- **PIN de gerente** para: cancelar orden/item, descuentos, reabrir, ver corte.
  Validación SOLO server-side (`/api/pos/pin`, rate limit 10/min/IP) — el PIN nunca
  viaja a queries del cliente.
- **Audit log** en cada acción sensible con `actor`, `reason`, `approved_by`, `details JSONB`.
- **Event store** (`publishEvent`, `src/lib/events.ts`): shadow mode Fullsite OS, append-only,
  con `device_id` — base del futuro sistema de eventos.
- Permisos por rol en `src/lib/pos-permissions.ts` (admin/gerente/cajero/mesero).

## 11. Offline / resiliencia

- `src/lib/pos-offline-db.ts` + `offline-sync.ts`: cola de operaciones (POST/PATCH a
  `pos_orders`) en IndexedDB con fallback a localStorage; reintento al reconectar.
- Service worker (`offline-sw`): cache de la app shell.
- Tests: `pos-offline-resilience.test.ts`, `offline-sw.test.ts`, `backup.test.ts`
  (backup exporta 8 tablas clave).

## 12. Patrones técnicos obligatorios

1. **`fetch()` directo, no SDK Supabase** (el SDK se cuelga en Next.js).
2. **Service key solo en `/api/*`** — nunca en cliente; rutas validan input y filtran `client_id`.
3. **Tailwind v4 safelist**: los colores de categorías viven en BD (`pos_menu_categories.color`),
   pero Tailwind solo compila clases que aparecen literalmente en el código. TODO color nuevo
   en BD debe agregarse a `CATEGORY_COLOR_SAFELIST` (`pos-constants.ts`) o no renderiza.
4. **`client_id` en todo query** (multi-tenant).
5. **Layout sidebar**: solo CSS grid `grid-cols-[240px_1fr]`, nunca flex/fixed.
6. **Deploys**: commits con `ramonfaurdaniel-png@users.noreply.github.com` (Vercel).
7. **Constantes compartidas** en `pos-constants.ts` (IVA, polling, keywords, estaciones) —
   nunca duplicar valores en páginas.
8. **Funciones de dinero** en `pos-calculations.ts` (puras y testeadas) — no escribir
   matemática de cobro inline en componentes.

## 13. Tests

- **Unit (vitest)**: `src/__tests__/` — 31 archivos, 1,440 tests (~2s). Cobertura clave:
  `pos-calculations` (totales, splits, centavos), `printer-queue` (serialización),
  `station-routing` (Heineken / station persistida), `pos-constants`, `pos-data`,
  `pos-permissions`, `pos-offline-resilience`, `cfdi`, `multi-printer`.
- **E2E (Playwright)**: `e2e/` — proyectos chromium + mobile (Pixel 7), `baseURL` localhost:3000
  con `reuseExistingServer` (no matar el dev server). Smoke de 13 subpáginas POS + gate de
  PIN del corte + login + dashboard.
- Comandos: `npx vitest run` · `npx playwright test --project=chromium` · `npx tsc --noEmit`.

## 14. Limitaciones conocidas (honestas, a 2026-06-12)

1. ~~Corte por fecha, no por turno~~ — **RESUELTO 2026-06-12**: `/pos/corte` default agrupa
   por `turno_id` del turno activo (toggle "Turno actual" / "Por día" para históricos).
2. **`delivery_orders` paralela**: sin reconciliación con `pos_orders`; el corte no incluye delivery.
   SQL aplicado 2026-06-12: `id` default `gen_random_uuid()`, `platform_order_id` nullable,
   `items` default `'[]'::jsonb` — inserts del POS verificados (201). Falta solo la reconciliación.
3. **Mixto con tolerancia de 1 centavo** validada solo en cliente.
4. **Concurrencia last-write-wins** en edición de orden (con toast de conflicto por `updated_at`).
5. **Acentos en térmicas**: CP437 vs UTF-8 sin resolver formalmente (impresiones de prueba se
   vieron bien).
6. **Timbrado CFDI**: aún manual/sandbox; falta PAC en producción.
7. **Órdenes viejas sin `station`**: caen al clasificador por keywords (correcto en la práctica,
   pero no garantizado para marcas raras).
