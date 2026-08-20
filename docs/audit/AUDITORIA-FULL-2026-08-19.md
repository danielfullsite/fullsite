# Auditoría FULL — POS · KDS · Dashboard · Offline (2026-08-19)

> Objetivo (Daniel): *"checar la lógica de dashboard, KDS y POS y hacer un full documento de todo
> para que ya no haya una falla más (mete offline también), FULL auditoría + recomendaciones."*
>
> Método: 4 auditorías de código en paralelo contra los requisitos de Eduardo
> (`docs/audit/EDUARDO-REQUISITOS.md`). Cada hallazgo trae severidad + `file:line` + repro + fix.
> Regla respetada: el **path offline congelado** (Pedro `local-server/index.js`) NO se reescribe;
> las mitigaciones son aditivas y de bajo riesgo.

---

## 0. Resumen ejecutivo

**Veredicto honesto:** la base es sólida (offline probado en campo, idempotencia/OCC bien hechos,
ledger de inventario bien diseñado, multi-tenant limpio tras B2). Las fallas reales son de **tres
tipos**: (A) **fraude** — los permisos y los totales se validan solo en el cliente; (B) **pérdida
silenciosa** — órdenes/comandas que se pierden por asimetrías de reintento y falta de timeout; (C)
**huecos de features** que Eduardo pide (KDS personas/expo/letra, reorden analítico, inter-sucursal,
IA de facturas). Ninguno de los 3 requiere reescribir lo que ya funciona.

### Tablero de severidad (lo que puede "provocar una falla más")

| # | Severidad | Dominio | Hallazgo | Efecto |
|---|---|---|---|---|
| 1 | 🔴 CRÍTICO | POS | **Totales/descuento se guardan tal cual del cliente** (`004_functions.sql:822,861`) | **Skimming**: cierras con total menor, el arqueo cuadra, te embolsas la diferencia |
| 2 | 🔴 CRÍTICO | POS | **Cancelar orden/item sin enforcement server-side** (`cancel-item/route.ts`, `save-order/route.ts:34-61`) | Un mesero cancela por POST directo; el PIN de gerente es cosmético |
| 3 | 🔴 CRÍTICO | Offline | **`ORDER_SENT` al KDS es fire-and-forget** (`pos/page.tsx:3089-3107`) | **El KDS pierde la comanda offline** (la impresión reintenta, el evento no) |
| 4 | 🔴 CRÍTICO | KDS | **`render()` sin try/catch** (`kds-ui.html:286-356`) | Un pedido malformado deja **la cocina en blanco** |
| 5 | 🟠 ALTO | Offline | **`saveOrder` con 5xx online no encola + sin timeout** (`pos-data.ts:1417,1423-1431`) | Orden **perdida** por 5xx transitorio; cuelgue "LAN sin WAN" (la lentitud P0) |
| 6 | 🟠 ALTO | POS | **Local server sin auth en la LAN** (`index.js:284,319,362` en `0.0.0.0:7717`) | Cualquier dispositivo cancela / imprime / reconfigura impresoras |
| 7 | 🟠 ALTO | POS | **Escrituras anon-key directas** (`pos-data.ts:reopenOrder:3002`, `updateOrderStatus:1449`) | Reabrir orden pagada = fraude; sin rol, solo RLS |
| 8 | 🟠 ALTO | Dashboard | **4 páginas POS corrompen el ledger** (PATCH directo a `pos_inventory`/`cost_per_unit`) | Stock y costo promedio corruptos en silencio |
| 9 | 🟠 ALTO | KDS | **`itemKey` por índice** (`kds-ui.html:226,320`) | En una ronda nueva se marca listo el **platillo equivocado** |
| 10 | 🟠 ALTO | Offline | **OFF-01 sin ecosistema de impresoras** (`printers.json` a mano, `station_id` texto libre) | Un área deja de imprimir en silencio (lo que vio Eduardo) |

**Conteo:** 4 CRÍTICO · 6 ALTO · ~10 MEDIO · ~6 BAJO · muchos requisitos de Eduardo sin implementar.

---

## 1. Cobertura de requisitos de Eduardo (resumen)

| Dominio | ✅ Cumple | 🟡 Parcial | ❌ Falta |
|---|---|---|---|
| **KDS** (15) | KDS-02,05,06,07,10,11,13 | KDS-01,04,08,09,12,15 | KDS-03 (tamaño letra) |
| **POS** (12) | POS-01,03,06,08,09,10,12 | POS-02,07,11 | **POS-04,05** (fricción diaria) |
| **Permisos** (22) | perfiles definidos ✅ | — | **enforcement server-side de casi todos** ❌ |
| **Dashboard/Inv** (9) | — | DASH-01,02,04,07,08 | **DASH-03,05,06,09** |
| **Offline** (4) | OFF-02 | OFF-03 | **OFF-01, OFF-04** |

---

## 2. Hallazgos por dominio

### 2.1 KDS (pantalla de cocina)

**Bugs de robustez:**
| ID | Sev | file:line | Repro → Fix |
|---|---|---|---|
| KDS-BUG-01 | 🔴 | `kds-ui.html:286-356` | Excepción en el render → board en blanco. **Fix:** try/catch **por-tarjeta** + en el catch global conservar el board anterior |
| KDS-BUG-02 | 🟠 | `:226,266,320,379` | `itemKey` por índice se desincroniza con rondas/filtro → marca listo el item equivocado. **Fix:** exigir `it.id` estable por línea |
| KDS-BUG-03 | 🟠 | `:442-443` | Un `kds_orders:[]` transitorio borra comandas vivas. **Fix:** requerir 2 lecturas vacías consecutivas |
| KDS-BUG-05 | 🟠 | `:447,449` | El tiempo transcurrido se congela si el server cae. **Fix:** `setInterval(render,15000)` independiente del polling |
| KDS-BUG-06 | 🟡 | `:366-371` | `postedStatus` bloquea reenvíos legítimos tras una ronda. **Fix:** incluir revisión en la key |

**Requisitos faltantes:** Personas no se pinta ni viaja online (`KITCHEN_SELECT` no la trae) · nº de orden secuencial del día (0100/0102 estilo Wansoft) · tamaño de letra configurable · modo "expo/todas las estaciones" · item listo no desaparece (queda tachado).

### 2.2 POS + Permisos (anti-fraude — el bloque más serio)

**El patrón central:** identidad server-side existe (`auth.role` en `api-auth.ts:54-96`), pero **las rutas sensibles la ignoran**. Los permisos se aplican ocultando botones en el cliente + un `verifyManagerPin` que el propio cliente decide honrar. El único gate server-side correcto es `db/route.ts:43-65` (caja/cierre).

| ID | Sev | file:line | Repro → Fix |
|---|---|---|---|
| POS-BUG-1 | 🔴 | `cancel-item/route.ts:26-31`, `save-order/route.ts:34-61` | Mesero cancela por POST con `manager:"x"`. **Fix:** exigir `isManager(auth.role)` **admin-only** en la ruta |
| POS-BUG-2 | 🔴 | `004_functions.sql:822,861` | Cliente manda `total` menor con pagos que cuadran → skimming. **Fix:** recomputar subtotal/total/descuento server-side desde items × precios de BD |
| POS-BUG-3 | 🟠 | `save-order/route.ts:92` | Descuento/cortesía arbitrario sin rol. **Fix:** rechazar `descuento>0` salvo aprobación de gerente |
| POS-BUG-4 | 🟠 | `pos-data.ts:3002,1449,3014` | Reabrir orden pagada/cambiar estado con anon-key. **Fix:** enrutar por `/api/pos/*` con `withPOSAuth`+rol |
| POS-BUG-5 | 🟠 | `local-server/index.js:284,319,362` | `/events`,`/print`,`/config` sin auth en la LAN. **Fix:** token de sesión por terminal + validación de origen |
| POS-BUG-6 | 🟡 | `page.tsx:1259,3921` | Cancelar pide gerente+, Eduardo dijo **admin-only**. **Fix:** `verifyPinWithMinRole(pin,'admin')` |
| POS-BUG-7 | 🟡 | `pin/route.ts:30,110` | El `min_role` lo decide el cliente. **Fix:** derivar el min_role de la operación en el servidor |

**Requisitos faltantes:** POS-04 (saltar modal si el platillo no tiene modificadores — `page.tsx:2417` siempre abre) · POS-05 (+/- cantidad por modificador — hoy son checkboxes) · POS-07 (tipos de tarjeta crédito/débito/AmEx nativos).

### 2.3 Dashboard / Inventario

| ID | Sev | file:line | Hallazgo → Fix |
|---|---|---|---|
| INV-P0 | 🟠 | `pos/facturas-proveedor:116,148` · `recepcion-factura:152,169` · `merma:122` · `inventario-fisico:74` | 4 páginas POS hacen PATCH directo a `pos_inventory`/`cost_per_unit` → corrompen ledger/costo. **Fix:** migrar a `recordMovement()`; consolidar flujos de factura duplicados |
| INV-P1a | 🟠 | `transferencias/page.tsx:252` | La transferencia guarda un blob y **nunca mueve stock** (no usa el ledger). **Fix:** emitir `transfer_out`+`transfer_in` reales |
| INV-P1b | 🟠 | `inventory.ts` vs `predict/route.ts:37` | **Dos tablas de stock** (`pos_inventory` vs `pos_inventory_products`) → predicción ve stock distinto al real. **Fix:** unificar a una vista canónica |
| INV-P2 | 🟡 | `recetas/page.tsx:134` | Costeo de líneas en el cliente (viola contrato). **Fix:** usar `/api/food-cost/calculate` |
| INV-P2b | 🟡 | `inventory.ts:145` | Idempotencia por `notes LIKE` + key a resolución de minuto → falso duplicado. **Fix:** columna `idempotency_key` con índice único |

**Requisitos faltantes (grandes):** DASH-03 (agente IA que lee facturas — hoy es fuzzy-match) · DASH-04/05 (reorden analítico con proyección de crecimiento — hoy fórmula lineal) · DASH-06 (transferencias inter-sucursal reales) · DASH-02 (parser Excel/XLSX — solo CSV/XML) · DASH-09 (doc de reglas de config + normalización acento-insensitive).

### 2.4 Offline / Infra / Integraciones

| ID | Sev | file:line | Hallazgo → Fix |
|---|---|---|---|
| OFF-SEV1 | 🔴 | `pos/page.tsx:3089-3107,3131-3149` | `fetch('/events').catch()` fire-and-forget → **KDS pierde la comanda offline** (la impresión sí reintenta). **Fix:** encolar el `ORDER_SENT` en IDB con reintento (reusa `print-queue.ts`) |
| OFF-SEV2a | 🟠 | `pos-data.ts:1423-1431` | 5xx online → `API_ERROR`, **orden perdida** (no encola). **Fix:** tratar `status>=500`/`0` como `OFFLINE_QUEUED` en la rama `!res.ok` |
| OFF-SEV2b | 🟠 | `pos-data.ts:1417` | El POST de guardado **sin timeout** → cuelgue "LAN sin WAN" (la lentitud P0). **Fix:** `AbortSignal.timeout(7000)` |
| OFF-01 | 🟠 | `main.js:141-196`, `printer-config-schema.js` | Sin ecosistema: `printers.json` a mano en la caja, `station_id` texto libre no validado contra el enum web `cocina/barra/caja` → un área deja de imprimir en silencio. **Fix:** registro central en Supabase + validación de cobertura de estaciones al arranque (usar `/health.stations` que ya existe) + constreñir `station_ids` al enum |
| OFF-SEV3a | 🟡 | `pos-offline-db.ts:521` | Item con `retries>=5` queda varado (sin pérdida, pero atorado). **Fix:** reintento manual + alerta |
| OFF-SEV3b | 🟡 | `pos-data.ts:1329-1345` | `addOrderItems` (recuperación de conflicto) sin cola offline → pérdida en ventana angosta |
| OFF-04 | 🟠 | `order-adapter.ts`, `webhook/route.ts:227` | Delivery no imprime comanda; modificadores degradados; **Rappi inexistente**. **Fix:** rutear delivery por `printByStation`; unificar separador; borrar webhook legacy |
| OFF-03 | 🟡 | `main.js:640-737` | Cold-boot sin WAN = pantalla negra (POS carga de app.fullsite.mx). **Fix:** shell mínimo servido por Pedro (como el KDS) |

---

## 3. Temas transversales

1. **Enforcement client-only (fraude).** El shift token da rol, pero cancelar/cobrar/descuentos/reabrir/configurar no lo validan server-side. **Es el riesgo #1** y el que Eduardo más subrayó (cancelaciones = permiso más crítico). El patrón correcto ya existe (`db/route.ts`) — hay que replicarlo.
2. **Fallas silenciosas.** Órdenes/comandas se pierden sin aviso: `ORDER_SENT` sin reintento, `saveOrder` 5xx sin encolar, impresora sin ligar cae a `STATION_NOT_CONFIGURED`. **Regla nueva a adoptar:** todo camino de pérdida debe encolar+reintentar o alertar, nunca fallar en silencio.
3. **Violación de contratos de dominio.** 4 páginas POS escriben inventario directo; recetas costea en cliente; escrituras anon-key a `pos_orders`. El `AGENTS.md` ya prohíbe esto — hay deuda que pagar.
4. **Acople por string no validado.** `station_id` (impresoras) y nombres de platillo (búsqueda con acentos) fallan por texto libre. Falta el doc de reglas (DASH-09) + normalización.

---

## 4. Plan de remediación priorizado

**P0 — antes de meter AMALAY 100% o un 2º cliente (fraude + pérdida):**
1. Enforcement server-side de rol en `save-order`/`cancel-item` (cancelar=admin, descuento/cortesía=gerente+, cerrar=cajero+) — reusa `isManager`.
2. Recomputar dinero server-side en `r1_save_order` (cierra skimming).
3. Blindar la fan-out del KDS (`ORDER_SENT` con reintento en IDB) + `saveOrder` 5xx→encola + timeout 7s.
4. `render()` del KDS con try/catch por-tarjeta.
5. Autenticar el local server (`/events`,`/print`,`/config`) con token de sesión.

**P1 — robustez + deuda (antes de escalar):**
6. Migrar las 4 páginas POS a `recordMovement()` + consolidar facturas.
7. `itemKey` del KDS por `id` estable.
8. OFF-01: validar `station_ids` contra enum + chequeo de cobertura al arranque.
9. Cerrar rutas anon-key (`reopenOrder` etc.) por `/api/pos/*`.
10. Delivery imprime comanda (OFF-04) + borrar webhook legacy.

**P2 — features de Eduardo (diferenciadores GTM):**
11. KDS: personas + nº orden secuencial + tamaño de letra + modo expo (items desaparecen al listo).
12. POS-04/05: saltar modal sin modificadores + cantidad por modificador.
13. Reorden analítico (DASH-04): fórmula de Eduardo `base × (1+crec%) × (1+colchón%) ÷ semanas`.
14. Transferencias inter-sucursal reales (DASH-06).
15. Agente IA de facturas + parser Excel (DASH-03/02) + doc de reglas de config (DASH-09).
16. Registro central de impresoras (OFF-01 completo, encaja con el esqueleton clonable P4).

---

## 5. Lo que está SÓLIDO (no tocar)

Idempotencia por `save_operation_id`/`command_id` (sin duplicados) · persistencia de la cola en IndexedDB (sobrevive reload/reinicio) · Pedro caído no pierde órdenes · `print-queue` con write-through + escalado a `needs_attention` · fix P1-1 del bridge en `preload.js` · cadena OFF-02 KDS-por-LAN probada en campo · ledger inmutable de `inventory.ts` con costo promedio ponderado · multi-tenant limpio (B2) · OCC en cancel-item · escapado HTML `esc()` en el KDS.

---

## 6. Recomendación estratégica

Esto conecta con el plan maestro y con lo que dijo Eduardo:
- **Antes de "meter AMALAY 100% y quitar Wansoft" (GTM-10), cerrar P0.** No puedes correr un restaurante vivo con skimming abierto y el KDS perdiendo comandas offline. Es el pre-requisito real de la Capa 3 (paridad) del plan maestro.
- **Los P2 son los diferenciadores** que Eduardo señala vs Wansoft/Parrot: reorden analítico (GTM-05), IA en cada módulo (GTM-04), KDS pulido. Ahí está el "valor agregado" que se vende.
- **La regla de oro que sale de esta auditoría:** *nada falla en silencio* — todo camino de error encola+reintenta o alerta. Es lo que convierte "software que a veces se cae" en "sistema en el que confías tu restaurante".
