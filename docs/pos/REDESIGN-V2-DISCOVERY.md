# POS REDESIGN V2 — DISCOVERY (solo lectura, sin código)

> **Fecha:** 2026-09-19 · **Artifact de referencia:** `4b33527c-a68b-401d-8d08-28a106d021a2`
> (versión `1789404595-4969`, 6 884 líneas, leídas completas).
> **Código comparado:** `origin/main @ 418933f4` (2026-09-19), **no** el working tree.
> El checkout local está en `feat/pos-ui-kit`, 58 adelante / **667 atrás** de `origin/main`
> (`git rev-list --left-right --count HEAD...origin/main` → `58  667`), y su diff de POS
> contra su merge-base son 4 archivos. **No sirve como base.**
>
> **Alcance:** descubrimiento. No se modificó código, no se desplegó, no se tocó lógica de negocio.

---

## CURRENT_POS_MAP

37 archivos bajo `app/pos` + `app/kds` en `origin/main`. Conteo de líneas real (`git show origin/main:<ruta> | wc -l`).

### Superficie de venta (el corazón)

| Ruta | Archivo | LOC | Qué es |
|---|---|---|---|
| `/pos` | `app/pos/page.tsx` | **7 045** | Pantalla de venta completa **en un solo archivo**: `POSPage` → `POSContent` (1728–6923) + 5 modales de nivel superior extraídos: `ModifierModal` (266), `DiscountModal` (749), `CancelModal` (1076), `VoidOrderModal` (1302), `CashMovementModal` (1490) + `POSAlerts` (6924) |
| — | `app/pos/layout.tsx` | 1 055 | Pantalla de bloqueo (PIN + huella WebAuthn), gate de tenant, inactividad, `POSLockContext.lock()` |
| — | `app/pos/pos-lock-context.tsx` | 10 | Contexto con `lock()` |

`POSContent` tiene ~110 `useState`. Las secciones de su JSX (por comentarios propios):
Top Bar (fila 1 logo/hamburguesa/listas/staff/reloj · fila 2 selectores mesa/personas/mesero ·
fila 3 tabs móvil), banner de cola de impresión, **Nav overlay** (acordeón `details[name="posnav"]`),
Panel izquierdo = ticket (cabecera, renglones agrupados por silla, badge de silla, editar/transferir/
cancelar por renglón, tiempos, descuento, notas, promos, totales, banda de acciones), Panel derecho =
menú (búsqueda + escáner, tabs de silla, **grid de categorías** → **modal centrado con los ítems**,
modal de combos, speed screen de mostrador), y ~15 modales más (split, verificar orden, personas,
MP Point, firebutton por tiempos, cobro, conflicto de sync, PIN prompt).

### Resto de pantallas

| Ruta | LOC | Ruta | LOC |
|---|---|---|---|
| `/pos/compras` | 1 603 | `/pos/recepcion-factura` | 378 |
| `/pos/mesas` | 1 327 | `/pos/barra` | 364 |
| `/pos/cocina` | 1 156 | `/pos/recetas` | 346 |
| `/pos/corte` | 1 121 | `/pos/inventario-market` | 331 |
| `/pos/plano` | 850 | `/pos/inventario` | 323 |
| `/pos/turno` | 819 | `/pos/merma` | 291 |
| `/pos/staff` | 749 | `/pos/facturas-proveedor` | 286 |
| `/pos/configuracion` | 625 | `/pos/staff-analytics` | 263 |
| `/kds` | 623 | `/pos/orden-compra` | 248 |
| `/pos/kds` | 567 | `/pos/historial` | 246 |
| `/pos/delivery` | 478 | `/pos/plano-editor` | 235 |
| `/pos/monitor` | 470 | `/pos/panaderia` | 231 |
| `/pos/asistencia` | 437 | `/pos/inventario-fisico` | 219 |
| `/pos/facturacion` | 395 | `/pos/auditoria` | 218 |
| `/pos/huella` | 176 | `/pos/food-cost` | 164 |
| `/pos/cliente` | 149 | `/pos/ui-kit` | 118 |
| `/pos/qr` | 85 | | |

### Navegación real (`page.tsx:4676-4736`)

4 grupos en acordeón, filtrados por `canSee(section)`:
**Operación** (Mesas · Cocina* · Barra* · Domicilio) · **Caja & Turno** (Turno · Corte · Facturación) ·
**Personal** (Checador · Empleados · Huellas) · **Terminal** (Configuración · Monitor · QR · Historial ·
Auditoría). *Cocina/Barra sólo si `hasKdsStation(...)`.
El back-office (recetas, food-cost, compras, inventario) está **deliberadamente fuera del nav** — vive
en el dashboard, aunque las rutas existan.

### Contratos que ya existen y mandan

- **Permisos:** 57 claves en `lib/permission-profiles.json`, copia byte-a-byte de
  `electron-app/local-server/core/permission-profiles.json`, con prueba que truena si derivan
  (`el-contrato-de-permisos-es-uno-solo.test.ts`). `lib/pos-permissions.ts` sólo la tipa.
- **Identidad de terminal:** `electron-app/local-server/config-schema.js` →
  `VALID_ROLES = ['server_pos','pos','kds','admin']`, `restaurant_id`, `terminal_id`, `terminal_role`.
- **Estaciones:** `type StationName = 'cocina' | 'barra' | 'caja'` (`pos-constants.ts:71`). **Tres, no cuatro.**
- **IVA:** `getIvaRate()` dinámico; `clients.iva_rate` de AMALAY = **0.16** (verificado por SQL).
- **Offline:** IndexedDB `fullsite_pos` v4 con **13 stores**: `menu, orders, inventory, sync_queue, meta,
  modifier_groups, modifiers, item_modifier_links, payment_methods, staff, turnos, cash_movements, print_jobs`.
- **Ajustes por tenant:** `clients.pos_settings` (JSONB) vía registro tipado en `lib/settings.ts`
  (`getEffectiveSetting`). Hoy AMALAY guarda ahí `pos.station_routing` y `pos.require_enrolled_terminal`.

---

## TARGET_POS_MAP

El artifact es **una sola aplicación** (`index.html`, 6 884 líneas: ~810 de CSS, ~430 de HTML,
~5 640 de JS). 28 vistas en `#main`, todas `display:none` salvo la activa. Sin scroll en operación.

### Navegación objetivo (`NAV`, líneas 1952–1984)

Doble filtro — **`term`** (en qué `terminal_role` existe la pantalla) × **`perm`** (qué puede quien está
enfrente). `visible = enEstaTerminal(n) && can(n.perm)`. Regla explícita del artifact:
*lo que no puedes hacer no se muestra* — ni gris, ni bloqueado.

| Grupo | Pantallas |
|---|---|
| **Piso** | Venta · Mesas · Cocina† · Barra† · Delivery · Market · Panadería · Pantalla del cliente · QR por mesa |
| **Caja** | Turno · Corte de caja · Facturación · Historial |
| **Almacén** | Inventario · Conteo físico · Merma · Compras · Proveedores · Recetas y costo |
| **Dirección** | Monitor · Food cost · Personal · Rutina de meseros · Checador · Huella digital · Seguridad · Auditoría · Sincronización |

† `term:['kds']` — Cocina y Barra **no existen** en una caja.

### Módulos JS del artifact (para el mapeo de reuso)

`IC` (iconos SVG inline) · `ICON_RULES`/`iconForCategory` · `TENANT` · `PERMISOS`/`can` · `FRAUDE` ·
`SEGURIDAD` · `NAV`/`UI` · `POS` · `SEARCH` · `MOD` (+`MOD_SETS`/`MOD_QUITAR`/`MOD_NOTAS`/`tipoModificador`) ·
`PAY` · `CUENTAS` · `DESC` · `AUTH` · `CANCEL` · `SPLIT` · `MESA_OPS` · `SYNC` (+`CATALOGO`/`OPERACION`/
`EXCEPCIONES`) · `MESAS` (+`SHAPES`/`FIXTURES`) · `ORDEN_TIPO`/`TIPOS_ORDEN` · `TECLADO` · `FACTURA` ·
`TICKET` · `DELIVERY` · `RECETAS` · `CONTEO` · `COMPRAS` · `CHECADOR` · `CORTE` · `HUELLA` · `MONITOR` ·
`CLIENTE` · `MARKET` · `PANADERIA` · `PROVEEDORES` · `FOODCOST` · `QRGEN` · `QR` · `BARRA` · `RUTINA` ·
`ADAPTA` · `HORA`/`FRANJAS` · `UNDO` · `GUARDIAN` · `SISTEMA` · `TECLAS` · `EDITOR` · `KDS` · `TURNO` ·
`INV` · `MERMA` · `HIST` · `STAFF` · `AUD` · `GEN` · `NUMPAD` · `CFG` · `LOCK`.

---

## SCREEN_BY_SCREEN_DIFF

Leyenda: **=** existe y es equivalente · **~** existe pero cambia · **+** nuevo en el target · **−** existe hoy y el artifact no lo cubre.

| Pantalla | Hoy | Target | Diff |
|---|---|---|---|
| **Venta** | `/pos` 7 045 LOC; categorías en grid → **modal** con los ítems; búsqueda con `<input>` del sistema; tabs de silla en panel de menú | familias (8) → categorías → **grid paginado** con retícula auto-calculada (`measure()`), pager con puntos; **teclado propio** en pantalla; chips de asiento en la cabecera del ticket | **~ fuerte.** Cambia la navegación del catálogo (modal → grid paginado) y el método de captura de texto. Ver BEHAVIOR_CHANGES. |
| **Bloqueo** | `layout.tsx`: PIN + huella, logo del tenant, intentos + lockout 60 s | igual + botón **Sistema** (kiosco/recargar/diagnóstico/cerrar app) en la esquina | **~** + botón nuevo. Hoy "cerrar app" vive en el nav y en `/pos/mesas`. |
| **Mesas** | `grid` (default) \| `planograma`; cuentas por nombre; reservaciones; modo fusionar | **`ordenes` (default)** \| `plano` \| `lista`; tarjeta con mesa, **folio #**, total, hora, minutos, mesero, zona; alerta a 45/75 min; fila de mesas libres | **~** Nueva vista por defecto. El artifact documenta el hallazgo de campo: en AMALAY el mapa está desactivado y operan con lista de órdenes. |
| **Plano** | `/pos/plano` (850) + `/pos/plano-editor` (235, escribe `pos_mesas`) | plano que llena la pantalla con `aspect-ratio 2/1` y alto calculado contra la proporción real; zonas, **fixtures** (barra/cocina/baños/caja/columna/planta/muro), **rotación**, duplicar, rejilla de 2.5 % | **~ + backend.** Rotación y fixtures no tienen dónde guardarse. |
| **Cocina/KDS** | `/pos/cocina` (1 156), `/pos/kds` (567), `/kds` (623); filtro por estación; estado por ítem; cancelación desde cocina | tarjeta por envío, FIFO, tarde ≥ 15 min, 4 estaciones | **~ + contrato.** Ver KDS_DEPENDENCIES. |
| **Barra** | `/pos/barra` (364) | mismo motor, umbral propio **8 min** | **=** con un umbral distinto. |
| **Turno** | `/pos/turno` (819): `caja` \| `legacy`, wizard de cierre, Corte X, historial de cierres, tab Personal | tarjetas de fondo/venta/efectivo, retiro/depósito, Corte X, "cerrar turno" → manda a Corte | **~** el artifact es más simple: **pierde** el wizard de cierre y el historial. |
| **Corte** | `/pos/corte` (1 121): gate por PIN/huella, 4 tabs (resumen/arqueo/meseros/órdenes), modo turno\|día, reabrir orden, truncado | gate igual, **mismos 4 tabs**, arqueo por denominación con stepper, 3 intentos → avisa al dueño, Corte X y **Corte Z** explícitos, Z bloqueado con cuentas abiertas | **≈** paridad alta. Faltan: reabrir orden, modo día, aviso de corte truncado. |
| **Facturación** | `/pos/facturacion` (395): RFC/régimen/uso/email, `validateRFC`, `/api/factura/timbrar` | mismos campos + **CP**, mismas validaciones, 3 tabs: nueva / historial / **Diseño del ticket** | **~ +** El editor de ticket es nuevo y necesita persistencia. |
| **Historial** | `/pos/historial` (246) | filtros todas/pagadas/canceladas, detalle, reimprimir | **=** |
| **Auditoría** | `/pos/auditoria` (218) lee `pos_audit_log` | filtros por tono + iconos por acción | **=** |
| **Delivery** | `/pos/delivery` (478), Uber/Rappi/DiDi | bandeja unificada, avanzar estado, **cobrar en caja** el pedido que la app no cobró | **~** el "cobrar en caja" con explicación es nuevo en UI. |
| **Checador** | `/pos/asistencia` (437) | pantalla de marcaje: reloj grande, **lector primero**, el sistema decide entrada/salida, PIN como respaldo, acuse a pantalla completa, detalle con autorización | **~ fuerte** — cambia el modelo de interacción (hoy hay lista; el artifact la prohíbe por diseño anti-fraude). |
| **Huella** | `/pos/huella` (176) | alta/baja, 3 lecturas, estado del lector vía `127.0.0.1:7717/fp`, cuántos gerentes pueden autorizar | **≈** |
| **Personal** | `/pos/staff` (749) | lista + secciones permitidas por rol | **~** el artifact es mucho más simple (probable pérdida). |
| **Monitor** | `/pos/monitor` (470) | 6 tarjetas + venta por mesero + "lo que necesita atención" (del GUARDIAN) | **~** |
| **Inventario / Merma / Recetas / Compras** | 323 / 291 / 346 / 1 603 | versiones compactas; `/pos/compras` del artifact es una fracción del actual | **~ pérdida** si se sustituye 1:1. |
| **Conteo físico** | `/pos/inventario-fisico` (219) | captura por numpad, diferencia por insumo, aviso si la diferencia ≥ 25 %, aplicar con autorización | **≈** |
| **Proveedores** | `/pos/facturas-proveedor` (286) + `/pos/recepcion-factura` (378) | una sola bandeja de facturas con recibir | **~ pérdida** (dos flujos → uno). |
| **Food cost** | `/pos/food-cost` (164) | tabla con % objetivo 28–32 | **≈** |
| **Pantalla del cliente** | `/pos/cliente` (149) | cuenta en vivo + explicación | **≈** |
| **QR** | `/pos/qr` (85), QR real (`lib/qr`), URL `/menu/{mesa}` | QR real generado sin librería (`QRGEN`, Reed-Solomon propio), URL **`/menu/{tenant}/{mesa}`** | **~** cambia la URL → cambia la ruta pública. |
| **Market** | **no existe** como pantalla de venta (hay `/pos/inventario-market`, 331) | escanear código / **báscula por peso** → importe al ticket | **+** |
| **Panadería** | `/pos/panaderia` (231) | plan de producción con barra de avance + merma; aviso "esta estación no imprime" | **≈** |
| **Rutina de meseros** | `/pos/staff-analytics` (263) | perfil por mesero con patrón por hora | **≈** |
| **Seguridad (antifraude)** | **no existe** | radar de 24 h por persona con umbrales (4 avisos / 7 grave / 35 % desc. / 72 % concentración) | **+** |
| **Sincronización** | **no existe como pantalla** (hay `OfflineIndicator` + resolutor de conflictos inline) | pantalla completa: catálogo que baja vs operación que sube, cola, reintentos, explicación de `save_operation_id` | **+** |
| **Configuración** | `/pos/configuracion` (625) | hoja `CFG`: probar-como-rol, panel `ADAPTA`, tamaño, tema, impresoras, identidad de terminal | **~ pérdida** (625 → una hoja). |

---

## COMPONENT_REUSE_MAP

### Lo que ya está y **no** hay que construir

| Artifact | Ya existe en el repo | Nota |
|---|---|---|
| Tokens `--bg --surface --surface-2 --panel --line --line-soft --text-1..4 --accent --accent-bright --accent-soft --accent-line --info --warn --crit --crit-ink` | `app/globals.css:120-209` | **Casi idénticos.** Diferencias: `--bg` `#07090a` vs `#080b0c`; `--text-2` `#b4bfbb` vs `#a8b5b1`; `--accent-line` `.26` vs `.28`. Reconciliables en una línea. |
| Tema claro | `globals.css:184-227` + variantes | ya existe |
| `.act` (botón de acción) | `PosKit.PosButton` | |
| `.cat` / familia | `PosKit.CategoryChip` | |
| `.tile` | `PosKit.ProductTile` + `CAT_COLORS` | |
| `.stepper` | `PosKit.Stepper` | |
| `.pill` / `.tag` | `PosKit.StatusPill` | |
| Montos rápidos del cobro | `PosKit.QuickAmount` | |
| `z-index` de capas | `components/ui/layers.ts` (`layerZ`) | usarlo, no inventar `z:400` |
| Iconos | `lucide-react` en todo el repo | **El `IC` del artifact (≈90 SVG inline) es la única forma correcta para el KDS Electron offline**, pero duplica `lucide`. Decisión pendiente. |
| Tipografía | Public Sans + IBM Plex Mono | ya es la canónica del proyecto |
| Escáner de código | `components/BarcodeScanner` + `TECLAS.codigoBarras` equivalente en `handleBarcodeScan` | |
| Generador de QR | `lib/qr.ts` (`qrToDataURL`) | **el `QRGEN` del artifact es redundante** salvo que se quiera cero dependencias |
| Autorización huella/PIN | `verifyManagerPin` + WebAuthn en `CancelModal`/`DiscountModal`/`VoidOrderModal`/`CashMovementModal`/`corte` | el `AUTH.ask()` del artifact **unifica** 5 implementaciones distintas — es la mayor ganancia de reuso del rediseño |
| Numpad / PIN prompt | `pinPrompt` + `pinInput` en `page.tsx` y `mesas` | |
| Cola offline + conflictos | `lib/pos-offline-db.ts` completo | la pantalla `SYNC` del artifact es **sólo vista** sobre esto |
| Modificadores por tipo | `getModifierTypeFromCategoryName()` (el artifact lo dice explícitamente) | `MOD_SETS`/`MOD_QUITAR` deben leer del catálogo real, no de la constante |

### Lo que hay que construir de cero

`measure()` (retícula auto), paginador de tiles, `TECLADO`/`SEARCH` (teclado en pantalla),
`UNDO` (barra de deshacer 10 s), `GUARDIAN` (avisos por ausencia), `ADAPTA` (auto-configuración por
tamaño/táctil/rol), `TECLAS` (teclado físico global + detección de lector por velocidad),
`EDITOR` (fixtures + rotación), `FRAUDE.radar`, `TICKET` (editor de ticket), `MARKET` (báscula),
`SISTEMA` (menú de kiosco en el bloqueo), `HORA` (Top por franja horaria).

---

## VISUAL_ONLY_CHANGES

Cambios que **no tocan estado ni contrato** — sólo CSS/markup. Son los candidatos a ir primero.

1. Reconciliar los 3 tokens que difieren (`--bg`, `--text-2`, `--accent-line`).
2. Barra de estado: marca `fullsite` + punto verde, separador, chips de contexto (mesa · personas ·
   mesero), pills de Cocina / Turno / Red, reloj, campana, ajustes, candado.
3. Jerarquía tipográfica del ticket: `.tk-head .amt` 26 px, `.tot-grand b` 30 px, tabular-nums,
   densidad automática por número de renglones (`data-density 1|2|3`).
4. Banda de acción inferior de 78 px con posición fija de verbos: **destructivo a la izquierda,
   principal a la derecha**; `.act.send` verde, `.act.pay` azul, `.act.danger` rojo suave.
5. `.card-stat` / `.list` / `.row` / `.tag` como lenguaje único de todas las pantallas de dato.
6. `.sheet` + `.card` (hoja modal con blur y `rise`) en lugar de los overlays sueltos de hoy.
7. Gaveta de navegación (`.drawer-panel` 312 px con secciones) en vez del acordeón `details`.
8. Estados de mesa con **relleno pleno** en el plano (`color-mix`), no tinta pálida.
9. Escala `zoom` por `data-scale` (xs…xl) y densidad por `data-densidad`.
10. Avisos (`#avisos`) centrados arriba, 2.8 s.
11. `--tap: 56px` como mínimo táctil en `.opt`.
12. Vista previa del ticket en papel (`.ticket-prev`).

---

## BEHAVIOR_CHANGES

Cambios que alteran **cómo se opera**, aunque no toquen el backend. Cada uno necesita decisión explícita.

| # | Cambio | Hoy | Riesgo |
|---|---|---|---|
| B1 | **Catálogo: modal → grid paginado** con familias y retícula auto | tocar categoría abre un modal centrado con sus ítems | Medio. Es el gesto que más repite un mesero en el turno. Necesita validación física antes de sustituir. |
| B2 | **Teclado en pantalla propio** (`SEARCH.kb`, `TECLADO`) en vez del `<input>` del sistema | `<input type=text>` | Medio-alto. En Electron kiosco el teclado del sistema es un problema real; pero el actual funciona y hay lector de barras que **escribe como teclado**. El `TECLAS` del artifact ya contempla los dos caminos. |
| B3 | **Vista ÓRDENES por defecto** en Mesas | `grid` de mesas | Bajo, y respaldado por hallazgo de campo. |
| B4 | **Tiempo por platillo (1º/2º/3º)** en el modal de modificadores | separador `TIEMPO_ITEM_ID` como renglón + `courseId` | Medio. Se puede **mapear** `tiempo → courseId` al confirmar y no tocar el modelo. Si no se mapea, se rompe el firebutton. |
| B5 | **`UNDO` de 10 s** para quitar renglón / descuento / cambio de personas | no existe; todo pasa por autorización | Bajo y de alto valor: quita cuello de botella del gerente. Pero **debe** quedar en auditoría igual. |
| B6 | **`GUARDIAN`**: 7 comprobaciones cada 60 s (mesa > 45 min, comanda sin imprimir, cocina > 20 min, insumo en cero, turno > 14 h, cola ≥ 15, producto con dos precios) | `POSAlerts` (órdenes listas + delivery) | Bajo. Es aditivo. |
| B7 | **`ADAPTA`**: la terminal elige escala y densidad sola según rol/pulgadas/táctil | fijo | Bajo, con la regla "lo manual manda" que el artifact ya trae. |
| B8 | **`SEGURIDAD`: bloqueo a los 4 min** de inactividad | `pos.idle_timeout_ms` por tenant, revisado cada 60 s | **No copiar el 4 hardcodeado.** Usar el ajuste que ya existe. |
| B9 | **Checador sin lista de nombres** | hay lista | Medio: cambia el flujo del empleado. Es la decisión correcta (anti "checo por mi compañero") pero es un cambio de proceso, no de piel. |
| B10 | **Reglas que se endurecen solas** (`FRAUDE.exigeAutorizacion`): pasadas 4 cancelaciones del día, la siguiente pide autorización **aunque el rol la tenga** | el rol manda siempre | Medio-alto: cambia el contrato de permisos en runtime. Necesita aprobación de Daniel y quedar documentado, porque un permiso que "a veces no aplica" es difícil de auditar. |
| B11 | **`can()` falla cerrado** y lo no permitido **no se muestra** | `canSee()` ya filtra el nav | Bajo: es la regla que ya rige. |
| B12 | **URL del QR** `/menu/{tenant}/{mesa}` | `/menu/{mesa}` | Medio: rompe los QR ya impresos si los hay. |
| B13 | **Pantalla de Sincronización** visible al operador | indicador + resolutor inline | Bajo, aditivo. |
| B14 | `SISTEMA` (salir de kiosco / cerrar app / diagnóstico) **en el bloqueo** | en el nav y en `/pos/mesas` | Bajo y mejor: nadie cierra el POS con una cuenta abierta enfrente. |

### Lo que el artifact **ya hace igual** que producción (no es cambio)

- Tras enviar a cocina: **ir al mapa de mesas y bloquear la terminal**; y si cocina **no** confirmó,
  **diferir el bloqueo** hasta que el mesero acuse el aviso. Es literalmente lo que hace
  `handleSendToKitchen` (`page.tsx:3872-3887`, con el comentario que explica por qué).
- Envío incremental: sólo va a cocina la diferencia (`enviadas` ↔ `sent_quantity`).
- Descuentos: los mismos 4 modos (`percent` / `fixed` / `cortesia` / `2x1`) y el 2x1 regala la
  unidad más barata de cada par.
- Cancelar renglón en dos pasos (motivo + autorización → ¿se preparó? → merma).
- Split parejo y por partidas.
- Corte X (lectura) vs Corte Z (cierre) con arqueo de por medio.

---

## BUSINESS_LOGIC_AT_RISK

Lo que **no se debe reinterpretar** al portar el artifact. El artifact es una maqueta: su lógica está
simplificada a propósito y en varios puntos **contradice** al contrato vivo.

| # | Riesgo | Evidencia |
|---|---|---|
| L1 | **IVA.** El artifact calcula `iva = (sub − desc) × 0.16` **sobre** el subtotal. Producción usa `getIvaRate()` con `IVA_RATE = 0` por defecto y `clients.iva_rate` por tenant (AMALAY = 0.16, precios **con** IVA incluido según `pos-config.ts`). Copiar la fórmula del artifact cambia el total cobrado. | `pos-constants.ts:5-10`, `pos-config.ts` (`ivaRate: number // 0 (AMALAY: precios incluyen IVA)`), SQL `clients.iva_rate = 0.16` |
| L2 | **Estaciones.** El artifact enruta a `cocina/barra/cafe/panaderia`. El contrato es `'cocina'\|'barra'\|'caja'` y el ruteo real de AMALAY manda `coffee/frappes/tea → barra` y `bakery → cocina`. | `pos-constants.ts:71`, `clients.pos_settings['pos.station_routing']` |
| L3 | **Formas de pago.** `PAY.sync()` decide por `abre_cajon` / `terminal` / `requiere_autorizacion`. Esas columnas **no existen**: `pos_payment_methods` tiene `type ∈ {cash, card, terminal, transfer, platform, other}` (18 filas en AMALAY). Derivar los tres flags desde `type` es ambiguo para los 8 `other` (Cortesía, Influencer, Mercadotecnia sí requieren autorización; Vale y Venta terceros no). | SQL sobre `information_schema` + `pos_payment_methods` |
| L4 | **Cobro.** El artifact **no tiene** pago mixto, ni Mercado Pago Point, ni confirmación de tarjeta, ni recuperación de pago MP, ni calculadora de efectivo, ni montos rápidos por denominación. Producción sí (`mixtoPagos`, `mpConfig`, `showCardConfirm`, `mpRecovery`, `SmartCashCalculator`, "Montos rápidos"). Sustituir el modal de cobro por el del artifact **pierde dinero real**. | `page.tsx:6464-6880` |
| L5 | **Anulación de orden.** El artifact borra los renglones. Producción exige **disposición por renglón** (`disposicionPropuesta`, `anulacion-completa.ts`) porque hay mercancía preparada que sí costó. | `page.tsx:1302-1489`, `lib/anulacion-completa.ts` |
| L6 | **Escritura en caja.** El artifact no conoce el modo `escribeEnCaja` (Pedro como autoridad de escritura: `pedro-operaciones`, `pedro-cliente`, `pos_write_authority`, reconciliación, sesión de editor). Es la mitad del POS de AMALAY. | `page.tsx:2603-2760`, `clients.pos_write_authority` |
| L7 | **`save_operation_id` / idempotencia.** El artifact lo menciona en texto pero su `SYNC.push` no lo implementa. `nuevaIdentidadDeAccion()` y `client_op_id` son el contrato real. | `lib/operation-identity.ts`, `logAudit` |
| L8 | **Concurrencia.** `checkOrderConflict`, `orderRevision`, `loadedUpdatedAt`, el resolutor LOCAL/NUBE. El artifact no tiene nada de esto. | `page.tsx:3389-3420`, `pos-offline-db.ts` |
| L9 | **Inventario.** `deductIngredientsForOrder` al **enviar** (no al cobrar) + `setOrderInventoryPending`. El artifact dice "se descuenta al cobrar". | `page.tsx:3830-3841` |
| L10 | **Multi-tenant.** El `TENANT` del artifact es un objeto literal con datos reales de AMALAY (menú, 29 nombres de personal, mesas, RFC). Nada de eso puede entrar al repo: debe salir de `pos_menu_*`, `pos_staff`, `pos_mesas`, `clients`. `guardTenant()` ya existe para esto. | artifact líneas 1408–1603 |
| L11 | **Liquidación / split.** `evaluarLiquidacion`, estado `dividida` para que el corte no cuente dos veces. El artifact cobra la cuenta completa en el demo. | `lib/liquidacion-de-orden.ts`, `Order.status` |
| L12 | **Umbrales antifraude inventados.** 4/7/35 %/72 % y `CORTESIA_POR_PERSONA = 480` no están en ningún contrato del repo. Son propuestas, no hechos. | artifact líneas 1691–1696, 2847 |

---

## OFFLINE_DEPENDENCIES

El rediseño toca la superficie de la que depende el offline certificado. Reglas que **no se negocian**
(`docs/pos/OFFLINE-LAN-FIELD-PROVEN.md` §4, recordadas por el hook del repo):

1. `saveOrder` cae a `OFFLINE_QUEUED` ante `navigator.onLine === false`, status 0/5xx o timeout —
   **nunca** a `API_ERROR`.
2. El KDS va por **HTTP**, no HTTPS. El POS imprime por `FULLSITE_BRIDGE_URL`.
3. Pedro muere si muere Electron. `ORDER_SENT` por HTTP, no `ws://`.
4. La sync es idempotente por `save_operation_id`.
5. Nunca equiparar `navigator.onLine` con conectividad real.

Superficies del rediseño que cruzan esa frontera:

- **Catálogo en IndexedDB** (`cacheMenu` / `getCachedMenu`): el grid paginado y las **familias** del
  artifact necesitan que el menú cacheado traiga la categoría y una regla de familia. Hoy el caché
  guarda categorías, no familias. Si la familia se calcula en cliente (como en el artifact,
  `iconForCategory` + `familias[].match`), **no hay cambio de caché**. Es la vía recomendada.
- **"Top / Más vendidos"** sale de `ocm_menu_items`, que es una **vista en la nube**. Sin red no hay
  Top. La pestaña debe degradar a una lista local o desaparecer, y eso tiene que decidirse antes de
  construirla, no después.
- **Arranque en frío**: el Service Worker gana la carrera contra `did-fail-load` (3 reintentos con
  backoff en `main.js`). Cualquier archivo nuevo que el rediseño agregue al bundle crítico afecta
  T-25. La fuente inline del artifact (`fonts.googleapis.com`) **rompe** el arranque sin WAN:
  las fuentes deben ir empacadas.
- **Login offline**: `pos_staff_cache` guarda **una** credencial y la ventana de 8 h no cubre
  cierre-apertura (T-24 sigue ⚠️ parcial). El rediseño del bloqueo no debe tocar ese camino.
- **Cola y conflictos**: la pantalla `SYNC` es sólo vista. `getSyncQueueDiagnostics`,
  `resolveSyncConflictKeepServer/ApplyLocal`, `ticksEntreReintentos`, `tocaReintentar` ya existen y
  **no se reescriben**.
- **`guardTenant()`**: si la terminal se reasigna, limpia el caché. Es lo que hace segura la
  clonación; el rediseño debe seguir llamándolo al arrancar.

---

## KDS_DEPENDENCIES

| Dependencia | Estado | Impacto del rediseño |
|---|---|---|
| `StationName = 'cocina'\|'barra'\|'caja'` | contrato en `pos-constants.ts:71` | **El artifact propone 4 estaciones (`cocina/barra/cafe/panaderia`). Esto rompe el tipo, `STATION_CATEGORIES`, `CATEGORY_TO_STATION`, `getStationForItem`, `isNoPrintStation`, `hasKdsStation`, `initStationRouting`, y el `pos_settings['pos.station_routing']` de AMALAY.** Es el cambio de mayor riesgo del rediseño. |
| `comanda_batch_id` / `comanda_batch_seq` | `OrderItem`, `pos_orders.comanda_batches` | El artifact crea **una comanda por estación por envío**, que es lo mismo que hace producción por batch. Compatible si se respetan los campos. |
| `kds_item_status` (`pos_orders.kds_item_status` jsonb) | estado por ítem | El `KDS.toggle` del artifact es equivalente. |
| `sendOrderToKitchen` / `kitchenFailureMessage` (`lib/kitchen-bridge`) | bridge LAN | El aviso "la comanda no llegó a cocina" del artifact **es** este camino. Ya está bien modelado. |
| `useKdsWsClient`, `kds_queue` como fallback de `kds_orders` | hooks | El artifact no los conoce; no deben perderse. |
| `/kds` (Electron, `kds_only`, `surface==='kds'`) | app separada, otro instalador | El `term:['kds']` del artifact **coincide** con la arquitectura real: Cocina y Barra no existen en una caja. |
| Panadería sin impresora | `isNoPrintStation` | El artifact lo dice bien, pero lo modela como **estación**, no como ruteo a `caja`. Hoy AMALAY manda panadería/bakery a **cocina** y market/postres a **caja** (no imprime). |

**Regla:** cualquier cambio en KDS/estaciones requiere **instalador nuevo** y validación física.
No viaja por Vercel.

---

## CASH_SHIFT_DEPENDENCIES

| Pieza | Dónde vive hoy | Qué asume el artifact |
|---|---|---|
| Turno abierto obligatorio para cobrar | `TurnoGate.tsx`, `turnoId` en `POSContent` | igual (`Sin turno abierto — la caja no puede cobrar`) |
| Apertura con fondo contado | `/pos/turno` + `abrir-turno-no-es-un-patch.test.ts` | `NUMPAD` para el fondo — equivalente |
| No abrir turno con cuentas abiertas | `no-abrir-turno-con-cuentas.test.ts` | el artifact lo impone en el **cierre** (Corte Z), no en la apertura |
| Movimientos de caja | `CashMovementModal` + `pos_cash_movements` (+`client_op_id`) | `TURNO.mov()` — equivalente, pero el artifact **no** persiste |
| Arqueo por denominación | `lib/pos-arqueo.ts` + `pos-arqueo.test.ts` + `el-fondo-se-confronta-con-el-corte.test.ts` | `CORTE.DENOM` `[1000…1]` con stepper. **Verificar que las denominaciones coincidan con `pos-arqueo`** |
| Corte X vs Z | `/pos/corte` + `CierreCajaWizard` + `no-se-reabre-el-turno-cortado.test.ts` | X = lectura, Z = cierre con arqueo previo obligatorio. **Coincide con el contrato** |
| Corte del día vs del turno | `corteMode`, `el-corte-del-dia-cubre-el-dia.test.ts`, `dia_venta`, `business_day_start_local` | **el artifact no lo tiene** — pérdida si se sustituye |
| Cancelaciones dentro del corte | `el-corte-cuenta-las-cancelaciones-del-dia.test.ts` | el artifact las muestra tachadas; no verifica el conteo |
| Split sin doble cobro | `Order.status = 'dividida'`, `la-mesa-dividida-no-se-cobra-dos-veces.test.ts` | el artifact cobra la cuenta completa (demo) |
| Huella en corte y cierre | `huella-en-corte-y-cierre.test.ts` | `AUTH.bio()` — equivalente |
| Corte truncado (> ~5 000 órdenes) | `corteTruncado` | ausente en el artifact |
| Propina | `propina` en `Order`, modal de cobro | el artifact estima **12 %** para el corte de mesero — número inventado, no leído |

---

## MIGRATION_SEQUENCE

**El big-bang no está justificado.** Evidencia de que la migración incremental es posible:

1. Los **tokens de color ya coinciden** casi exactamente — la piel del artifact se puede aplicar
   sin tocar lógica.
2. Existe `PosKit.tsx` con 6 primitivas y una página `/pos/ui-kit` para verlas.
3. Las pantallas están **separadas por ruta**: 30 archivos independientes. Cada una migra sola.
4. El archivo grande (`page.tsx`, 7 045 líneas) ya tiene **5 modales extraídos** como componentes
   de nivel superior — el patrón de extracción ya está probado en este archivo.
5. `clients.pos_settings` + `lib/settings.ts` dan un interruptor por tenant sin desplegar código.

### Orden propuesto

| Fase | Qué | Por qué aquí | Riesgo |
|---|---|---|---|
| **0** | **Worktree limpio desde `origin/main`.** El checkout actual está 667 commits atrás. | §1.6 del protocolo | — |
| **1** | **Tokens + primitivas.** Reconciliar los 3 tokens que difieren; ampliar `PosKit` con `Sheet`, `Row/List`, `CardStat`, `Tag`, `Pill`, `ActionBar`, `Keypad`. Publicar todo en `/pos/ui-kit`. **Cero pantallas tocadas.** | No cambia ningún píxel en producción; da el vocabulario a todo lo demás | Nulo |
| **2** | **`/pos/auditoria` + `/pos/historial`** con las primitivas nuevas. | 218 y 246 LOC, **sólo lectura**, sin dinero, sin offline, sin KDS. Si se rompen, no para el servicio. | Muy bajo |
| **3** | **`/pos/mesas`: vista ÓRDENES** como tercera opción (sin cambiar el default). | Aditivo. Se mide en campo antes de hacerla default. | Bajo |
| **4** | **`AUTH` unificado.** Un solo componente huella-o-PIN que reemplaza las 5 copias (`CancelModal`, `DiscountModal`, `VoidOrderModal`, `CashMovementModal`, `corte`). Sin cambiar qué autoriza cada una. | Es la mayor ganancia de reuso y **reduce** superficie de error | Medio — toca 5 flujos con dinero. Prueba de regresión por cada uno. |
| **5** | **Barra de estado + gaveta + banda de acción** en `/pos`. Piel, no flujo. | Lo que más se ve, sin tocar el catálogo ni el cobro | Bajo-medio |
| **6** | **`GUARDIAN` + `UNDO`.** Aditivos, con auditoría. | Valor inmediato, reversible | Bajo |
| **7** | **`SYNC` como pantalla** sobre `pos-offline-db`. Sólo vista. | No cambia la cola | Bajo |
| **8** | **Catálogo: familias + grid paginado + teclado propio** detrás de bandera, en una terminal. | **Es el cambio que hay que validar con Eduardo en piso antes de generalizar** | **Alto** |
| **9** | **Seguridad (antifraude)** leyendo `pos_audit_log`. | Nuevo, aislado | Bajo |
| **10** | **Editor de plano con fixtures/rotación.** Requiere migración de BD. | Depende de BACKEND_CHANGES | Medio |
| **11** | **Cobro.** Último y sólo si se preserva todo L4. | Dinero. No se toca hasta que todo lo demás esté certificado | **Máximo** |

Fuera de esta secuencia, y **cada uno con su propia decisión**: Market/báscula, editor de ticket,
tipo de orden, checador sin lista, 4 estaciones.

---

## FEATURE_FLAG_STRATEGY

**No hay infraestructura de feature flags en el repo** (`git grep NEXT_PUBLIC_FEATURE|featureFlag|useFlag`
→ 0 resultados). Hay dos mecanismos que sí existen y bastan:

### 1. Por tenant — `clients.pos_settings` vía `lib/settings.ts`

Registro tipado (`SettingKey`) + `getEffectiveSetting(clientId, key)` con default. Ya se usa en
`pos/layout.tsx:183-191` para `pos.idle_timeout_ms`, `pos.station_routing`, `pos.no_print_stations`,
`pos.cancellation_reasons`, `pos.discount_catalog`, `pos.kds_stations`.

Claves propuestas (una por superficie, **nunca una sola bandera global**):

```
pos.ui_v2.shell        → barra de estado + gaveta + banda de acción
pos.ui_v2.catalogo     → familias + grid paginado + teclado propio
pos.ui_v2.mesas        → vista ÓRDENES por defecto
pos.ui_v2.guardian     → avisos por ausencia
pos.ui_v2.undo         → barra de deshacer
pos.ui_v2.sync         → pantalla de sincronización
```

Ventaja: se enciende **sin desplegar** y se apaga igual de rápido. Y se puede encender sólo para
`amalay` sin tocar a los demás tenants.

### 2. Por terminal — `localStorage`

Igual que `fs-scale-manual` en el artifact: un override local que **manda** sobre el ajuste del
tenant, para poder probar en **una sola caja** sin afectar al restaurante. Debe ser legible desde
`/pos/configuracion`.

### Reglas

- **Fail-safe:** sin ajuste, sin red, storage bloqueado → **V1**. Exactamente el patrón de
  `peekServiceModel()`.
- La bandera se lee **una vez al montar**, no en cada render, y no cambia a media orden.
- Ninguna bandera cambia **cálculo** (IVA, descuentos, totales, arqueo). Sólo presentación y
  navegación. Si una bandera cambiara un número, está mal diseñada.
- Cada bandera se retira en el PR siguiente al que la certifica. Una bandera permanente es deuda.

---

## TEST_STRATEGY

Base existente: **289 archivos `*.test.ts(x)`** + Playwright (`e2e/pos.spec.ts`,
`e2e/offline.spec.ts`, `e2e/multiterminal-offline.spec.ts`, workflow `offline-e2e.yml`).

### Lo que no se toca

Las pruebas de contrato deben seguir verdes **sin editarlas**. Si una falla, la respuesta es corregir
el código, no la expectativa:

`el-contrato-de-permisos-es-uno-solo` · `pos-arqueo` · `pos-calculations` · `la-mesa-dividida-no-se-cobra-dos-veces` ·
`el-corte-del-dia-cubre-el-dia` · `el-corte-cuenta-las-cancelaciones-del-dia` · `el-fondo-se-confronta-con-el-corte` ·
`no-abrir-turno-con-cuentas` · `no-se-reabre-el-turno-cortado` · `mesa-cobrada-se-libera` ·
`offline-t01-venta-activa` · `offline-t04-t07-recovery` · `offline-turno-replay` · `lo-que-se-guarda-offline-se-confirma` ·
`login-offline-identidad-e-intentos` · `la-aprobacion-offline-deja-de-ser-anonima` · `kds-*` · `multi-printer`.

### Lo que hay que agregar, por fase

| Fase | Prueba |
|---|---|
| 1 | Snapshot de tokens: los valores de `globals.css` son los que consume `PosKit` (guardián contra deriva de color) |
| 2 | DOM: `/pos/auditoria` y `/pos/historial` pintan con datos vacíos, con 1 fila y con 500 |
| 3 | La vista ÓRDENES ordena **la más vieja primero** y el folio que muestra es `order_number`, no un contador local |
| 4 | Por cada uno de los 5 flujos: **sin autorización no pasa**; con PIN correcto pasa; con huella pasa; y **el evento queda en `pos_audit_log` con el `approved_by` correcto**. Reintroducir el bug (quitar el gate) debe hacer fallar la prueba. |
| 5 | La banda de acción deshabilita Enviar cuando no hay pendientes y Cobrar cuando la cuenta está vacía |
| 6 | `UNDO` expira a los 10 s y **el deshacer también se audita**; `GUARDIAN` no dispara con estado sano (guardián mudo = sistema sano) y **sí** dispara con cada una de las 7 condiciones |
| 7 | La pantalla `SYNC` refleja la cola real, incluida una entrada en `error`, sin mutarla |
| 8 | La retícula recalcula al cambiar tamaño y escala; el pager no pierde ítems (suma de páginas = total de la categoría); el lector de barras sigue funcionando con el teclado propio abierto |
| 11 | Paridad total del cobro: mixto, MP Point, recuperación MP, montos rápidos, exacto, faltante, cajón |

### Verificación física (no sustituible)

Toda fase que toque **POS, KDS, impresoras, huella, LAN, Service Worker, offline o caja** exige
validación en el mismo commit/instalador, con los 23 escenarios de la matriz offline. En concreto:
fases 4, 8, 10 y 11. Las fases 1, 2, 3, 6, 7 y 9 viajan por Vercel y se toman con F5.

### Revisión adversarial

Fases 4 y 11 requieren que **otra persona o agente intente romperlas** de forma independiente
(§9 del protocolo) antes de merge.

---

# RESULTADO

```
POS_REDESIGN_DISCOVERY_COMPLETE = SÍ
  Artifact leído completo (6 884/6 884 líneas). Código comparado contra origin/main @ 418933f4,
  no contra el working tree (667 commits atrás). Esquema verificado por SQL contra Supabase amalay.

CURRENT_CAPABILITIES_PRESERVED = SÍ, CON 12 RIESGOS EXPLÍCITOS (L1–L12)
  El artifact es una maqueta y simplifica: cobro (sin mixto, sin MP Point, sin recuperación),
  anulación (sin disposición por renglón), escritura en caja (sin Pedro), concurrencia (sin
  orderRevision), liquidación (sin estado 'dividida'), IVA (fórmula distinta), estaciones (4 vs 3).
  Ninguna de esas simplificaciones puede portarse. Se preserva todo si se migra por piel y no
  por sustitución.

BACKEND_CHANGES_REQUIRED = 6, NINGUNO BLOQUEA LAS PRIMERAS 9 FASES
  1. pos_orders: tipo de orden (mesa/llevar/domicilio/recoger) + referencia (nombre o dirección).
     Los permisos ya existen (abrir_cuentas_llevar/domicilio/recoger); la columna no.
  2. pos_mesas: rotación; y una tabla o JSON para fixtures del plano (barra, cocina, baños, caja,
     columna, planta, muro). Hoy: number, capacity, zone, x_pct, y_pct, shape, sort_order, active.
  3. pos_payment_methods: abre_cajon / requiere_terminal / requiere_autorizacion. Hoy sólo
     type ∈ {cash, card, terminal, transfer, platform, other}; los 8 'other' son ambiguos.
  4. Diseño de ticket: serie, ancho de papel, líneas de pie (hoy receipt_footer es un solo TEXT),
     toggles de QR y logo.
  5. StationName: sólo si se acepta el modelo de 4 estaciones. Exige instalador nuevo.
  6. "Top por franja horaria": lectura de ocm_menu_items desde el POS + su degradación offline.

  NO requieren backend: tiempo por platillo (mapea a courseId), radar antifraude (lee pos_audit_log),
  pantalla de sincronización (lee pos-offline-db), QR (lib/qr ya genera real).

SAFE_FIRST_SURFACE = /pos/auditoria y /pos/historial
  218 y 246 líneas. Sólo lectura. Sin dinero, sin offline, sin KDS, sin impresora. Si fallan, nadie
  deja de vender. Antes de ellas, la fase 0: tokens y primitivas en /pos/ui-kit, que no toca ninguna
  pantalla en producción.

HIGHEST_RISK_SURFACE = el modal de cobro de /pos (page.tsx:6464-6880)
  Es donde entra el dinero y donde el artifact es más pobre: le faltan pago mixto, Mercado Pago Point,
  confirmación de tarjeta, recuperación de pago MP, calculadora de efectivo y montos rápidos por
  denominación. Segundo lugar: el cambio a 4 estaciones, que rompe un contrato tipado, el ruteo vivo
  de AMALAY y exige instalador nuevo.

RECOMMENDED_IMPLEMENTATION_ORDER =
  0. Worktree limpio desde origin/main
  1. Tokens + primitivas en PosKit, visibles en /pos/ui-kit — cero pantallas tocadas
  2. /pos/auditoria + /pos/historial con las primitivas
  3. Vista ÓRDENES en /pos/mesas como opción (sin cambiar el default)
  4. AUTH unificado — un solo huella-o-PIN en lugar de 5 copias
  5. Barra de estado + gaveta + banda de acción en /pos
  6. GUARDIAN + UNDO (aditivos, auditados)
  7. Pantalla SYNC (sólo vista)
  8. Catálogo: familias + grid paginado + teclado propio — BANDERA, UNA TERMINAL, CAMPO
  9. Seguridad / antifraude sobre pos_audit_log
 10. Editor de plano con fixtures y rotación (requiere migración)
 11. Cobro — último, y sólo preservando L4 completo
```

---

## Estado de las afirmaciones

| Afirmación | Grado | Fuente |
|---|---|---|
| Contenido del artifact | **HECHO** | 6 884 líneas leídas |
| Rutas, LOC y estructura del POS | **HECHO** | `git show origin/main:<ruta>` |
| Esquema de `pos_orders`, `pos_mesas`, `pos_payment_methods`, `pos_turnos`, `pos_staff`, `clients` | **HECHO** | `information_schema` vía MCP read-only |
| `iva_rate = 0.16`, `station_routing`, 18 formas de pago en AMALAY | **HECHO** | SQL |
| Ausencia de infraestructura de feature flags | **HECHO** | `git grep` sin resultados |
| Riesgos L1–L12 | **INFERENCIA fundada en código** | citada línea por línea arriba |
| "El grid paginado es mejor que el modal actual" | **NO VERIFICADO** | requiere campo con Eduardo |
| "El teclado en pantalla propio mejora la captura" | **NO VERIFICADO** | requiere campo |
| Umbrales antifraude 4/7/35 %/72 % y cortesía $480 | **PROPUESTA del artifact** | sin respaldo en el repo |
