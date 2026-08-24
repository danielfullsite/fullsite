# Fullsite × Wansoft — POS Bible + Gap Analysis (Documento Maestro)

> **Propósito:** Este es el documento maestro y definitivo que compara, capacidad-por-capacidad y setting-por-setting, el sistema **Wansoft (NetSilver)** contra **Fullsite** — el estado real construido y verificado contra código. Sirve como (1) mapa de paridad para producto/ingeniería, (2) libro de fuente de verdad para ventas/founder frente a un prospecto que hoy usa Wansoft, y (3) backlog priorizado de gaps.
>
> **Fecha:** 2026-08-16
>
> **Fuentes (verificadas, catálogos base):**
> 1. **Ground-truth Wansoft:** catálogo exhaustivo de 18 secciones construido de: software real NetSilver (`~/Desktop/WANSOFT/`: 12 `*.config` XML, ~70 DLLs/EXEs, 47 plantillas `.mr6`, 8 plantillas Excel, licencias), la cotización comercial de la nueva sucursal AMALAY, extractos reales de datos (376 costos, 769 productos, 662 modificadores, ~200 ingredientes costeados), la POS-BIBLE (ingeniería inversa pantalla-por-pantalla vía TeamViewer) y la web-BIBLE del portal (211 pantallas, 150+ endpoints, 822 stored procedures, 80+ tablas).
> 2. **Fullsite estado real:** catálogo verificado-contra-código en `dashboard-app/src/` y contra el esquema real de la tabla `clients` en Supabase (staging + AMALAY prod). Cada capacidad clasificada **CONSTRUIDO / PARCIAL / AUSENTE**.
>
> **Método de honestidad:** Donde una capacidad de Wansoft se **infiere** de binarios .NET no decompilables se marca `(inferido)`. Donde Fullsite tiene un doc que afirma algo que el código no respalda, se marca **PARCIAL/AUSENTE** con la nota. Cero invención de features que no estén en los catálogos base. Los caveats de esquema (drift `pos_settings`/`plan`), Rappi sin código, y el schema nativo Wansoft en `.bak` no accesible se declaran explícitamente en §7.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Modelo de configuración comparado](#2-modelo-de-configuración-comparado)
3. [Comparación por área funcional](#3-comparación-por-área-funcional)
   - 3.1 POS — Cuenta / Venta
   - 3.2 Mesas / Plano de piso
   - 3.3 Impresión / Comandas / Hardware
   - 3.4 Inventario
   - 3.5 Recetas / Costeo
   - 3.6 Facturación / CFDI / Fiscal
   - 3.7 Retail / Tienda
   - 3.8 E-Commerce / Delivery
   - 3.9 Seguridad / Roles / Permisos
   - 3.10 Turnos / Cortes / Caja
   - 3.11 Nómina / Propinas / Asistencia
   - 3.12 Reportes / Analítica
   - 3.13 Config sucursal / Impuestos / Pagos / Monedas
   - 3.14 Lealtad / CRM
   - 3.15 Settings globales / Periféricos
4. [Lista consolidada de gaps (priorizada P0/P1/P2)](#4-lista-consolidada-de-gaps)
5. [Donde Fullsite supera a Wansoft](#5-donde-fullsite-supera-a-wansoft)
6. [Comparación comercial / licenciamiento](#6-comparación-comercial--licenciamiento)
7. [Honestidad / caveats](#7-honestidad--caveats)
8. [Apéndices](#8-apéndices)

---

# 1. Resumen ejecutivo

## 1.1 El titular para el fundador

**Fullsite ya iguala o supera a Wansoft en el 80% de la operación diaria de un restaurante, y lo supera de forma decisiva en las capas que definen el futuro del producto (analítica en tiempo real, ~30 agentes de IA, offline LAN sub-1s, auditoría inmutable, multi-tenant clonable, conciliación bancaria).** El terreno donde Wansoft todavía va adelante es el **back-office profundo de inventario/costeo de nivel ERP** (yield/rendimiento, sub-recetas como entidad, costeo de producción, transferencias multi-sucursal, devoluciones a proveedor) y **algunas piezas de CFDI/retail** (factura global, complementos PPD emitidos, báscula por peso). Ninguno de esos gaps es un bloqueador para vender a un restaurante de café/casual como AMALAY; casi todos son **features acotadas** (esfuerzo S/M), no reescrituras.

**Veredicto de una línea:** Wansoft es un ERP restaurantero maduro de 2007 (SQL Server local, .NET 4.5, 822 stored procedures) con costo de setup y de cambio altísimos. Fullsite es una plataforma SaaS multi-tenant nativa de nube + IA que ya cubre el core y está a un puñado de features acotadas de paridad total en el back-office, mientras ya gana en todo lo que Wansoft no puede alcanzar sin reescribirse.

## 1.2 Veredicto por capa

| Capa | Wansoft | Fullsite | Veredicto |
|---|---|---|---|
| **POS / captura de orden** | Maduro, multinivel, 13 operaciones avanzadas | CONSTRUIDO + valida modificadores mejor | **Empate**, con brechas UI acotadas (cambio mesa, USD, tipo orden) |
| **Mesas / plano** | Editor drag&drop maduro + secciones-permiso | Editor drag&drop DB-first real | **Empate** (falta secciones-permiso) |
| **Impresión** | Motor MR6, 47 plantillas, ruteo a 5 impresoras | Print bridge Electron con cola+recuperación | **Empate funcional**; falta editor de ticket UI |
| **Inventario** | ERP profundo (multi-almacén, transfer, devolución) | Ajuste automático real + auto-86 + carga masiva | **Wansoft adelante** en profundidad |
| **Recetas / costeo** | Sub-recetas, yield, costeo producción, 26 SPs | Food-cost real-time + recetas + rentabilidad | **Wansoft adelante** (yield/producción) |
| **CFDI / fiscal** | Global, agrupada, NC, PPD, autoemisión | CFDI individual + parser XML + reporte fiscal | **Mixto:** Fullsite gana reporte fiscal; Wansoft gana global/PPD |
| **Retail / tienda** | Subsistema completo + báscula | Módulo tienda completo | **Empate**; falta báscula por peso |
| **E-commerce / delivery** | Middleware, marcas virtuales, Top Offenders | Uber Eats real en código; Rappi solo diseño | **Wansoft adelante** (Rappi + marcas virtuales) |
| **Seguridad / roles** | 6 catálogos de permiso, huella, audit **OFF** | ~50 permisos + audit **always-on** inmutable | **Fullsite gana** (audit); Wansoft gana matriz granular |
| **Turnos / cortes** | 5 tipos de corte, arqueo 3 intentos | X/Z/Mesero + guard de órdenes abiertas | **Empate**; falta corte global + denominaciones |
| **Nómina / propinas** | Nómina + incidencias + programación | Asistencia por POS + nómina + propinas | **Empate**; Fullsite gana check-in sin hardware |
| **Reportes / analítica** | 60+ reportes, P&L, Excel | Real-time + ~30 agentes IA + conciliación | **Fullsite gana decisivamente** |
| **Config sucursal / pagos** | Config local por terminal | Config en nube versionada multi-tenant | **Fullsite gana** (arquitectura) |
| **Lealtad / CRM** | MegaPoints + encuestas + gift cards | CRM real + WhatsApp bot 12.2K clientes | **Fullsite gana** CRM; Wansoft gana Megapuntos-QR |
| **Analítica IA / tiempo real** | No existe | ~30 agentes, chat, coach, anomalías | **Fullsite exclusivo** |
| **Offline** | Polling 15s | LAN push <1s + audit + cajón software | **Fullsite gana** (con deuda de boot P0) |
| **Modelo comercial** | $154K setup + $1,500/mes + $1,293/año | $4,999/mes + $4,999 setup | **Fullsite gana** (año 1: ~65% del costo Wansoft) |

## 1.3 Dónde Fullsite gana / empata / va detrás — mapa rápido

- **Gana (exclusivo o decisivo):** analítica en tiempo real, ~30 agentes IA, chat/coach/voz, auditoría inmutable always-on, offline LAN sub-1s, conciliación tarjeta-vs-banco, reporte fiscal IVA/ISR, multi-tenant clonable, config versionada en nube, check-in sin hardware, autofactura QR self-service, modelo comercial.
- **Empata (paridad funcional para un restaurante típico):** captura POS, modificadores multinivel, plano de mesas, impresión por estación, cortes X/Z/mesero, CRM, retail base, propinas.
- **Va detrás (Wansoft más maduro):** inventario ERP profundo (multi-almacén/transfer/devolución/producción), costeo con yield y sub-recetas, CFDI global + PPD emitidos + NC timbrada, báscula por peso, Rappi + marcas virtuales, secciones-permiso, corte global multi-terminal.

---

# 2. Modelo de configuración comparado

La diferencia arquitectónica más profunda entre ambos productos **no es una feature — es dónde vive la configuración**.

## 2.1 Wansoft: config local por terminal + portal web

- **`OrigenDeConfiguraciones=1`** en cada `*.config`: la configuración se lee de un **origen LOCAL** (`C:\Netsilver`) en cada terminal. La verdad de config vive en la máquina física.
- **Connection string cifrada** en `NetSilver.exe.config` y `cn.xml`; logging va a **SQL Server local** vía stored procedure `WriteLog`.
- **Licenciamiento por terminal:** `Licencia.ns` / `ContraLicencia.ns` (blobs cifrados) controlan activación por máquina. Agregar terminal = re-licenciar.
- **Portal web** (`wansoftpos.com`): capa de back-office (inventario, reportes, CFDI, nómina) separada del POS local, con su **propio** sistema de usuarios/permisos.
- **Dos sistemas de permisos independientes:** Usuarios de POS (+ perfil) y Usuarios de portal web (+ perfil) — no unificados.
- Auto-update vía WebService ASMX SOAP legacy (`wansoft.net/.../Netsilver_UpdateVersion.asmx`).
- Consecuencia operativa: **cada terminal es un snowflake**. Cambiar un setting global implica tocar terminales; el costo de cambio es alto (carga masiva de menú por Excel con "hasta 3 iteraciones", consultoría de inventarios).

## 2.2 Fullsite: 3 capas de config por-tenant en la nube (tabla `clients`)

El mecanismo vive en la tabla `clients` de Supabase (una fila por tenant), leída por `lib/client-config.ts` (TS) y `client_config.py` (agentes). **Fuente única de verdad = tabla `clients`.** La misma config aplica a todas las terminales; agregar terminal = apuntar a la config del tenant (sin re-licenciar).

**Las tres capas (todas reales en código):**

1. **`clients.features` (jsonb) — 15 feature flags.** Encienden/apagan módulos. Tipado en `ClientFeatures`. Funciona en staging y prod.
2. **`clients.pos_settings` (jsonb) — 8 settings operativos** flat key-value. Registry en `lib/settings.ts`. **Solo persiste en AMALAY prod** (columna ausente en staging → cae a defaults; ver §7).
3. **`clients.plan` (text) — 3 tiers** de gating de plan/página/agente. `lib/plans.ts`. **Solo en prod** (staging cae a `fullsite_completo`).

Más: **catálogos maestros** en tablas `pos_*` dedicadas (menú, staff, formas de pago, modificadores, promos, horarios, tamaños, zonas de domicilio, gift cards, retail…) y **roles** (`lib/roles.ts`, 6 roles con permisos por página).

## 2.3 Tabla lado a lado

| Dimensión | Wansoft | Fullsite |
|---|---|---|
| **Dónde vive la config** | Local por terminal (`C:\Netsilver`), `OrigenDeConfiguraciones=1` | Nube, tabla `clients` (una fila/tenant) |
| **Alcance de un cambio** | Por terminal (snowflake) | Por tenant (todas las terminales heredan) |
| **Versionado de config** | No (archivos locales) | Sí (fila en DB, versionable) |
| **Agregar terminal** | Re-licenciar (`Licencia.ns`) | Apuntar a config del tenant (sin licencia por máquina) |
| **Feature flags** | Toggles en portal + configs locales | `clients.features` — 15 flags tipados |
| **Settings operativos** | Pantallas de config del POS + portal | `clients.pos_settings` — 8 keys (registry `settings.ts`) |
| **Planes/tiers** | Licencia por módulo (Inventarios, etc.) | `clients.plan` — 3 tiers con gating |
| **Sistemas de permisos** | 2 independientes (POS + portal web) | 1 unificado (`roles.ts` 6 roles + ~50 permisos POS) |
| **Catálogos maestros** | Tablas SQL Server locales + portal | Tablas `pos_*` en Supabase (multi-tenant) |
| **Multi-tenant** | No nativo (una instalación por sucursal/razón social) | Nativo desde día 1 (client_id por host) |
| **Cifrado de secretos** | connectionString cifrada, `Licencia.ns` | `credentials_vault` (XOR débil, no filtra client_id — ver §7) |

**Los 15 feature flags de Fullsite (`ClientFeatures`, default entre paréntesis):**

| Flag | Default | Enciende |
|---|---|---|
| `pos` | true | POS |
| `posRestaurant` | true | Modo restaurante (mesas) |
| `posTienda` | false | Modo tienda/retail |
| `bakery_station` | false | Estación panadería |
| `delivery` | false | Domicilio propio |
| `ecommerce` | false | Canales delivery (Uber/Rappi) |
| `inventory` | true | Inventario |
| `foodCost` | true | Food cost |
| `facturacion` | true | CFDI |
| `nomina` | false | Nómina |
| `agentesIA` | true | Agentes IA |
| `coach` | true | Coach IA |
| `chatIA` | true | Chat IA |
| `resenas` | false | Reseñas |
| `giftCards` | false | Tarjetas de regalo |

**Los 8 settings operativos (`pos.*`, `lib/settings.ts`):** `station_routing` (ruteo comanda por estación), `kds_stations` (`[cocina, barra, caja]`), `no_print_stations` (`[caja]`), `cancellation_reasons` (5 razones), `discount_catalog`, `idle_timeout_ms` (30 min), `return_to_plano` (true), `require_enrolled_terminal` (false).

**Los 3 planes (`lib/plans.ts`):** `reporteador` ($1,499/mes, IA sobre POS ajeno, sin POS), `fullsite_software` ($4,999/mes, todo software sin hardware), `fullsite_completo` (default, +$45K hardware one-time, todo).

**Los 6 roles (`lib/roles.ts`):** `dueño, gerente, capitan, cajero, mesero, staff`. dueño → todo; gerente → todo excepto páginas financieras; capitan → operaciones+POS+admin; cajero → pos/cortes/propinas/ventas; mesero/staff → solo POS.

---

# 3. Comparación por área funcional

> **Leyenda de estado Fullsite:** ✅ = CONSTRUIDO (código real) · 🟡 = PARCIAL (backbone existe, falta una pierna) · ❌ = AUSENTE/PLANEADO (sin ruta ni código, o solo diseño/doc).

---

## 3.1 POS — Cuenta / Venta

Módulo Wansoft: `NetSilver.exe` + `NetSilver.MapaDeMesas.dll` + `Wansoft.Promociones.dll`. Fullsite: `lib/pos-data.ts`, `lib/pos-combos.ts`, `lib/pos-promos.ts`, `lib/pos-offline-db.ts`, event store vía bridge.

| Capacidad / Config de Wansoft | Detalle Wansoft (settings/campos/opciones) | Fullsite | Detalle del gap / qué construir |
|---|---|---|---|
| Login POS | Huella (1 toque) o PIN; usuario auto-identificado; requiere turno abierto con fondo | ✅ | PIN + WebAuthn; auth gerente offline PBKDF2 TTL 8h. Huella nativa DigitalPersona NO (usa WebAuthn) |
| Post-login → lista de órdenes | Card view (config AMALAY); header persistente (usuario/turno/mesa/hora) | ✅ | Equivalente |
| Crear orden (flujo) | Nueva → Tipo → Mesero → Mesa → Personas → Nombre → captura | 🟡 | Captura sí; **picker de tipo de orden en creación (Restaurante/Llevar/Domicilio/Recoger) sin UI** (permisos existen) |
| Tipos de orden | Restaurante, Para llevar, Domicilio, Retail (toggles por sucursal) | 🟡 | Modo restaurante/tienda por flag; selector en creación de orden ❌ |
| Para llevar: nombre + número de torre | Campos obligatorios | 🟡 | Nombre sí; **campo torre/referencia ❌** |
| Alerta órdenes desatendidas | Configurable (AMALAY: 30 min llevar/delivery) | ✅ | Idle timeout config (`pos.idle_timeout_ms` 30 min) + table-time 60/90 min |
| Separador de tiempos `XX TIEMPO` | Auto-insertado (course tracking) | ✅ | Tiempos/firebutton/coursing por ítem |
| Sillas (seat_id) | Entidad de 1ª clase, +/- en captura; habilita split y comanda por silla | ✅ | Silla/asiento por ítem construido |
| Código de barras siempre visible | Para productos Market | ✅ | Escaneo barcode (cámara/USB) |
| **Modificadores multinivel** | Por niveles: nombre, Requerido/Opcional, mín/máx, precio incremental; concatena al nombre; se suma al base | ✅ **SUPERA** | Validación real nivel/requerido/min/max en `pos-data.ts` (más estricta que Wansoft) |
| Combos / EVENTO-MENU | Platillos-paquete por tipo de orden | ✅ | `pos-combos.ts` |
| Menú Avanzadas (13 ops) | Borrar/descuento/cortesía/2x1/transferir ítem/cambiar silla/cancelada↔anulada/ver detalle/descuento prorrateado/cambiar mesa/cambiar personas/dividir cuenta/promociones | 🟡 | La mayoría ✅; **cambiar # mesa (orden completa) sin UI 🟡**, split por silla manual 🟡, cambiar personas verificar |
| Guardar = enviar a cocina | No hay "guardado sin enviar"; comanda incremental; ítems enviados inmutables | ✅ | Deducción de inventario al ENVIAR (invariante) |
| Cancelaciones (3 caminos) | Razón escrita (catálogo+libre) + **"¿se preparó?"** (SÍ=merma, NO=revert stock); anulación = camino distinto; imprime "CANCELADA" | ✅ | Razón + "¿se preparó?" (merma/void) + PIN gerente + audit |
| Transferir ítem entre mesas | Avanzadas → # mesa destino; requiere auth si toggle ON (vector fraude #1) | ✅ | `/api/pos/transfer-item` con PIN + log |
| Cambiar # de mesa (orden completa) | Mueve orden; 2 campos sugieren merge | 🟡 | Permiso `cambio_mesa` existe, **sin UI** |
| Juntar/merge mesas | Implícito en cambio de mesa | 🟡 | `/api/pos/merge-orders` existe pero conflicto OCC manual |
| Split de cuenta | Por silla: cada grupo → orden separada con # y ticket; requiere silla asignada | 🟡 | Ítems guardan `silla` pero split **manual**, no automático |
| Cobrar / pago mixto | N formas por orden; saldo tiempo real; botón "Auto"; confirma # personas; drawer-kick efectivo; saldo→$0 | ✅ | Pago mixto/split + propina + cambio + drawer-kick construido |
| Métodos de pago (AMALAY) | Efectivo, Dólares, Cortesía, T.crédito, T.débito, Rappi, Netpay, aDomicilio, Influencer, Mercadotecnia, Transferencia | 🟡 | Formas custom en `pos_payment_methods`; **USD/dólares + tipo de cambio sin UI (crítico San Pedro)** |
| Pago USD / dólares | Forma de pago con conversión en cobro | 🟡 | Permiso `tipo_cambio` existe, **sin UI**; arqueo no reconcilia USD |
| Cambiar forma de pago post-cobro | Con autorización | ❌ | No implementado |
| Terminal bancaria integrada | Clip/OEL/NetPay/BBVA; esperar confirmación antes de cerrar | 🟡 | Clip + MP Point (`lib/mercadopago.ts`); **Getnet (real de AMALAY) NO integrado** |
| Descuentos | Por ítem o prorrateado; catálogo % (10-90) + razones predefinidas; monto/% abierto; toggle "no dobles descuentos" | ✅ | Descuento %/fijo + catálogo configurable (`pos.discount_catalog`) |
| Cortesías (100%) | Catálogo + texto libre; siempre razón | ✅ | Cortesía con tope (`CORTESIA_POR_PERSONA=480` hardcode) |
| 2x1 | Operación separada | ✅ | `pos-promos.ts` |
| Promociones | Motor `Wansoft.Promociones.dll`; catálogo | ✅ | `pos_promotions` (%/fijo/2x1/combo, schedule, auto_apply, max/día) |
| Número de orden secuencial | 72, 73… (no UUID); staff dice "la orden 73" | ❌ | Usa UUID, muestra 8 hex; **staff no puede referir orden por número** |
| Reimprimir ticket | — | ✅ | Throttle 3s |
| Bloquear terminal | Idle timeout | ✅ | `pos.idle_timeout_ms` |
| Pagos anticipados / vales | Eventos, prepago (`SaldoPrePago.mr6`) | ❌ | No implementado |
| Event store / offline | (Polling 15s a DB local) | ✅ **SUPERA** | Event store inmutable (`command_id`→`events.ndjson`), IndexedDB offline |

---

## 3.2 Mesas / Plano de piso

Módulo Wansoft: `NetSilver.MapaDeMesas.dll` (174 KB). Fullsite: `pos/plano`, `pos/plano-editor`, `pos_mesas`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Editor de layout drag&drop | Cuadrados/círculos como mesas (en AMALAY desactivado) | ✅ | Editor drag&drop DB-first (upsert `pos_mesas` vía `/api/pos/db`) |
| Card view fallback | Mesa/Hora/Total/#Orden; rojo=activa | ✅ | Equivalente |
| Secciones / zonas | Configurables con **permisos por sección** (mesero ve ciertas zonas) | 🟡 | Zonas visuales sí; **secciones con permiso por mesero ❌** |
| Conteo de mesas | Config | ✅ | `mesas` en `clients` |
| Alertas table-time | (implícito) | ✅ | 60/90 min |
| Layout no code-baked | — | 🟡 | Migró de `FLOOR_TABLES[]` hardcode a DB-first; verificar que live no siga code-baked |

---

## 3.3 Impresión / Comandas / Hardware

Módulos Wansoft: `NetSilver.Impresor.dll` (430 KB), `Impresiones`, `ImpresionesXP`, `RestPrintingApp.exe` (`TimeInterval=15` polling), motor MR6 (47 plantillas). Fullsite: print bridge Electron `127.0.0.1:7717`, `lib/printer.ts`, `lib/print-queue.ts`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Ruteo por estación | Por platillo individual (AMALAY); hasta 5 impresoras por ítem | ✅ | `resolveItemStation()` + `pos.station_routing` |
| `[NO IMPRIMIR]` | Ítem sin comanda (Market) | ✅ | `pos.no_print_stations` (`[caja]`) |
| Cancelación en impresora original | Imprime "CANCELADA" en misma impresora | ✅ | Ruteo a estación de la comanda original |
| Cola de impresión | Polling cada 15s (`RestPrintingApp`) | ✅ **SUPERA** | Cola de reintentos con **recuperación IndexedDB**; push, no polling; fallback Bluetooth |
| ESC/POS USB + TCP | (motor propietario) | ✅ | USB + TCP; slot por estación (`getStationPrinterName`) |
| Apertura de cajón | DRAWER_KICK al cobrar efectivo | ✅ **SUPERA** | `openCashDrawer`/`POST /drawer` — **cajón por software** |
| Config de comanda | Header (orden/mesa/personas/mesero/cliente), detalle (silla/tamaño/grupo), fuentes por campo, separadores | 🟡 | Comanda construida; edición fina de campos/fuentes desde UI limitada |
| **Config de ticket** | Header (logo+slider, nombre, dirección, RFC, razón social, tel×2), IVA 16%, tamaño 72mm, QR 270×270, fuentes total(12)/mesa(12)/orden(8), footer 7 líneas, serie A, QR ON; **preview en vivo + test print** | ❌ | **Editor de ticket POS-side AUSENTE**: logo/RFC/razón social/footer/IVA/QR con preview + test print. Config vive en `clients`/`pos-config` pero **no editable desde terminal** (riesgo fiscal: RFC/serie mal → CFDI-QR roto) |
| QR CFDI en ticket | Autofacturación por razón social | ✅ **SUPERA** | QR autofacturación self-service impreso |
| QR encuesta | En ticket | ✅ | Impreso en ticket/pre-ticket |
| QR MegaPuntos/lealtad | En ticket | ❌ | Sin QR de lealtad en ticket |
| Plantillas MR6 (47) | OrdenParaLlevar, OrdenParaDomicilio, Vale, EtiquetasTLP2844, 36 reportes… | 🟡 | Tickets/comandas CSS construidos; no motor de plantillas equivalente (ver Apéndice 8.1) |
| Config bridge por terminal | (local) | ✅ **SUPERA** | URL bridge configurable **por terminal** (localStorage, `lib/bridge-url.ts`) + health check |
| UI re-ruteo estación | Reasignar categoría→estación sin código | 🟡 | Registry `pos.station_routing` existe; editar desde UI limitado |
| Alerta comanda no impresa | — | ❌ | Sin alerta proactiva |

---

## 3.4 Inventario

Módulo Wansoft: `NetSilver.Inventarios.dll` (23 KB núcleo) + amplio subsistema portal (el más extenso: 22 sub-reportes). Fullsite: `lib/inventory.ts`→`recordMovement()`, `pos/inventario`, `pos/inventario-fisico`, `pos/merma`, `admin/carga-masiva`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Almacenes múltiples | Por sucursal (AMALAY: cocina, barra, market — 6 áreas) | 🟡 | Multi-almacén con routing por área **PARCIAL** |
| Departamentos | Agrupador de productos | ✅ | Soportado |
| Unidades + presentaciones | 1 CAJA = 24 PIEZAS (separada de unidad base) | ✅ | Soportado |
| Productos (catálogo) | 769 en AMALAY (code/name/wansoft_id) | ✅ | Carga masiva + CRUD |
| Punto de reorden | Por producto | ✅ | `inventario-real/reorden` |
| Plantillas inv. físico | Seleccionar qué contar | 🟡 | Plantillas de conteo por almacén **PARCIAL** |
| Plantillas de OC | OC pre-configurada por proveedor (ej. "JUGOS NL" 12 items) | 🟡 | OC parcial |
| Límite variación de costo | Alerta si sube > X% (por producto) | ❌ | **Umbral configurable por ingrediente AUSENTE** |
| **Toma física** | Físico vs sistema (shrinkage) | ✅ | `pos/inventario-fisico` con **ajuste automático de stock** |
| **Merma** | Con "¿se preparó?" | ✅ | `pos/merma` con deducción de ingrediente |
| Cardex / movimientos | Kardex + consolidado salidas | ✅ | `pos/inventario`, contrato `recordMovement()` |
| Entradas con facturas | + código de barras | ✅ | Parser CFDI XML → restock (`pos/recepcion-factura`) |
| **Transferencias entre sucursales** | Recibidas/realizadas/por hacer (mini-ERP, 760 refs SPs) | ❌ | **AUSENTE** |
| **Devoluciones a proveedor** | Revierten inventario + generan NC | ❌ | **AUSENTE** |
| Órdenes de compra | Recibidas/realizadas/por hacer/**por aprobar** | 🟡 | OC parcial, flujo "por aprobar" limitado |
| Ventas de terceros | Con CFDI | 🟡 | Parcial |
| Tablajería | Producto base → múltiples cortes | ❌ | AUSENTE (nicho) |
| Órdenes de producción | Productores + plantillas + órdenes | 🟡 | Producción/batch existe, no siempre afecta inventario |
| Ajustes por lote / subproductos | En proceso | 🟡 | Parcial |
| Carga masiva | Excel | ✅ | `admin/carga-masiva` (ingredientes/inventario/recetas/menú, upsert batched) |
| Cierre mensual + snapshot | — | ✅ | `app/cierre-inventario` + LKG cache (`inventory-policy.ts`) |
| **Auto-86** | (Checkbox de disponibilidad) | ✅ **SUPERA** | `/auto86` predictivo |
| Productos a caducar | Reporte | ❌ | Alerta proactiva de caducidad AUSENTE |
| Paleo de barra (pesaje botellas) | `AjusteDeDiferenciasBascula` | ❌ | AUSENTE |
| Predicción de inventario | — | ✅ **SUPERA** | `inventario-prediccion` |

---

## 3.5 Recetas / Costeo

Módulo Wansoft: `NetSilver.Inventarios.dll` + subsistema portal (26 SPs de costeo). Fullsite: `lib/cost-engine/`, `/food-cost`, `pos/recetas`, `/rentabilidad`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Recetas de platillos | Ingrediente-cantidad-unidad | ✅ | `pos/recetas`, `/recetas` CRUD |
| **Sub-recetas (subproductos)** | Entidad reutilizable (ej. "SUB VINAGRETA DE CHAMPAÑA", "SUB PAN PARA PANINI") | 🟡 | Mencionado en `/recetas` pero como **entidad de costeo profunda PARCIAL** (Eduardo lo pidió) |
| **Factor de rendimiento / yield** | `performance` en ingredient-costs.json | ❌ | **AUSENTE** — subestima food cost ~28% |
| Conversiones entre unidades | kg→litro, pieza→porción | 🟡 | Parcial |
| Costos adicionales por platillo | Gas, mano de obra, depreciación | ❌ | AUSENTE |
| **Costeo de producción** | MP entra → producto sale (26 SPs) | ❌ | **AUSENTE** — Wansoft gana |
| Costeo por último precio de compra | Sin promedio ponderado | ✅ | Costeo real-time construido |
| Food-cost real-time | (reporte batch) | ✅ **SUPERA** | `/food-cost` con alertas; contrato `lib/cost-engine/` |
| Rentabilidad por platillo | Reporte costo/margen | ✅ | `/rentabilidad`, `/api/rentabilidad` |
| Detección de recetas sospechosas | Validación de recetas / huérfanos | ✅ | Detección de recetas sospechosas |
| Simulador de precios | — | ❌ | AUSENTE |
| Validación de recetas | Productos (no) en recetas | ✅ | Equivalente |

---

## 3.6 Facturación / CFDI / Fiscal

Módulo Wansoft: `NetSilver.FacturaElectronica.DLL` (11 endpoints FE). Fullsite: `lib/facturama.ts`, `factura`, `facturas`, `pos/facturacion`, `lib/cfdi-xml-parser.ts`, `reporte-fiscal`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Emitir factura individual | Venta → datos fiscales → timbrado PAC | ✅ | CFDI 4.0 vía Facturama (`stampCfdi`, valida RFC, pdf/xml, email) |
| **Factura Global** | Con/sin txt SAT (lote público general) | ❌ | **AUSENTE** — factura global mensual |
| **Factura Agrupada** | Varias ventas de un cliente en una factura | ❌ | AUSENTE |
| Facturas emitidas (control) | Por periodo | ✅ | `facturas` |
| Reporte de conciliación ventas-vs-facturas | — | 🟡 | Conciliación exacta ventas-vs-timbradas PARCIAL |
| **Notas de crédito** | Emitir/emitidas con reason codes SAT | 🟡 | `notas-credito` (506L, persiste `wansoft_data`) status real pero **timbrado real NC falta** |
| **Complementos de pago (PPD)** | Emitir/emitidos | 🟡 | `PaymentComplementRequest` tipado pero **PPD emitidos end-to-end AUSENTE** |
| Clientes FE | Catálogo fiscal (RFC, razón, CP, régimen) | ✅ | Clientes fiscales + campos en `clients` |
| Series por sucursal | A, AA, AB… | 🟡 | Series parcial |
| Regímenes fiscales | Catálogo SAT | ✅ | `regimen_fiscal` en `clients` |
| Config FE | Autofacturación, series, régimen | ✅ | Configurado |
| **QR CFDI autoemisión** | Portal por razón social | ✅ **SUPERA** | QR self-service impreso en ticket |
| Parser XML de gastos/proveedor | — | ✅ **SUPERA** | `cfdi-xml-parser.ts` + match ingredientes + restock |
| Reporte fiscal IVA/ISR | — | ✅ **SUPERA** | `reporte-fiscal` mensual (Wansoft no tiene) |
| Cuentas por cobrar (CxC) | Cobranza con status | ❌ | AUSENTE |

---

## 3.7 Retail / Tienda

Módulo Wansoft: `NetSilver.Retail.dll` (253 KB) — subsistema completo paralelo. Fullsite: `admin/tienda/*`, `pos_retail_items`, `pos/inventario-market`, flag `posTienda`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Subsistema Tienda completo | Forma de pago, tipo de precio, grupos, artículos, promos, gift cards (mirror de restaurante) | ✅ | `admin/tienda/`: artículos, precios, promociones, grupos |
| Artículos retail | Nombre, barcode, depto, grupo, precio, costo, margen, stock, min_stock, unidad | ✅ | `pos_retail_items` |
| Flujo tienda | Escanea barcode → cobra → bolsa (sin mesa/comanda) | ✅ | Escaneo barcode (cámara/USB) |
| Comparte inventario | Con restaurante, flujos independientes | ✅ | Inventario Market (`pos/inventario-market`) |
| Edición bulk de precios | Por tier | ✅ | PATCH bulk `id=in.()` |
| Promos retail | — | ✅ | `pos_retail_promos` |
| Grupos retail | — | 🟡 | Rename real; "nuevo grupo" solo toast |
| **Báscula por peso + barcode báscula** | COM1 9600 baud; barcode con peso embebido; etiquetas TLP2844 | ❌ | **AUSENTE — la principal brecha de retail** |
| Etiquetas código de barras | `EtiquetasTLP2844.mr6` | ❌ | Generación de etiquetas AUSENTE |

---

## 3.8 E-Commerce / Delivery

Módulo Wansoft: `NetSilver.ECommerceService.exe` + middleware propietario. Fullsite: `lib/integrations/uber-eats/`, `pos/delivery`, `admin/domicilio`, flag `ecommerce`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Integración plataformas | Middleware propietario (no APIs directas) | 🟡 | **Uber Eats real en código** (oauth/adapter/menu/provisioning); **Rappi solo diseño** |
| **Rappi** | Integrado | ❌ | **AUSENTE en código** (solo DESIGN v0.2.2; sin `lib/integrations/rappi`) |
| Uber Eats | Integrado | ✅ | Recibe órdenes, filtra test/$0, inyecta a KDS |
| Disponibilidad platillos por integración | Estatus menú/plataforma/órdenes | 🟡 | Parcial |
| Horario por integración | Distinto Rappi vs Uber | ❌ | AUSENTE |
| **Marcas virtuales** | Un local = N marcas (AMALAY, La Nonna Keto, Bakery) | ❌ | **AUSENTE** |
| Config platillos/modif/grupos por integración | Menús distintos por plataforma | ❌ | AUSENTE |
| Tipos de precio por canal | Delivery +15-20% | ❌ | AUSENTE |
| Cupones por plataforma | — | ❌ | AUSENTE |
| **Top Offenders** | Platillos que más fallan en delivery | ❌ | AUSENTE |
| Auto-86 hacia plataformas | Por stock | ❌ | Roadmap |
| Tiempo de preparación por marca | Config | 🟡 | Parcial |
| Domicilio propio | Ubicaciones/zonas | ✅ | `admin/domicilio` (CP, tarifa, mínimo, minutos) |
| Dashboards delivery | — | ✅ **SUPERA** | `ecommerce`/`delivery`: canal Rappi/Uber, tendencias 90d, breakdown MXN |

---

## 3.9 Seguridad / Roles / Permisos

Módulos Wansoft: `NetSilver.Seguridad.dll` + `NetSilver.HuellaDigital.dll` (SDK DigitalPersona). Fullsite: `lib/pos-permissions.ts` (~50), `lib/pos-manager-auth.ts`, `lib/roles.ts`, `pos/auditoria`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Dos sistemas de permisos | Usuarios POS (+perfil) y Usuarios portal (+perfil) independientes | ✅ **SUPERA** | **Unificado**: 6 roles (`roles.ts`) + ~50 permisos POS granulares |
| Niveles | Mesero / Gerente / Admin | ✅ | dueño/gerente/capitan/cajero/mesero/staff |
| Toggles de seguridad | "Bloquear pantalla c/operación", "Transferir requiere auth", "No dobles descuentos" | 🟡 | Idle lock ✅; matriz de toggles por operación PARCIAL |
| **6 catálogos de permiso** | Platillos/grupos/métodos que requieren gerente; catálogos descuentos/cortesías/razones cancelación | 🟡 | Catálogos descuento/cancelación ✅; **matriz "qué platillo/forma requiere PIN" PARCIAL** |
| Autorización por operación | Cancelar/descuento/cortesía/transferir/método sensible; registra quién solicitó/autorizó/hora | ✅ | Escalación gerente in-place vía PIN + log |
| Huella digital (DigitalPersona) | Login, auth gerente, check-in/out (imprime recibo) | 🟡 | WebAuthn (sin hardware DigitalPersona); `pos/huella` PARCIAL (localStorage, sin backend) |
| Logging de acciones | **Checkbox opcional "Guardar logs" — OFF en AMALAY** | ✅ **SUPERA** | **Audit log siempre-on, inmutable, no-configurable** (`pos/auditoria`, `getAuditLog`) — diferenciador estrella |
| Vault de credenciales | (portal) | 🟡 | `admin/vault` gated dueño pero **XOR débil + no filtra client_id** (ver §7) |
| 2FA plataforma | — | ✅ | `lib/platform-2fa.ts`, `certificados`, `checador` |
| Reglas anti-fraude dinámicas | — | ❌ | >3 cancelaciones → auth AUSENTE |
| Autorización remota gerente | (desde portal) | ❌ | Desde teléfono AUSENTE |
| Dashboard cancelaciones/descuentos por mesero | Reportes de auditoría | 🟡 | POS-side AUSENTE; dashboard analítico parcial |
| PIN throttle / lockout | — | 🟡 | `pin-throttle.ts` per-device, no per-employee |

---

## 3.10 Turnos / Cortes / Caja

Fuente Wansoft: 5 tipos de corte + Control de Efectivo portal. Fullsite: `pos/turno`, `pos/corte`, `lib/pos-arqueo.ts`, `lib/pos-cierre-guard.ts`, `control-efectivo`, dashboards `cortes`/`caja`/`conciliacion`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Abrir turno con fondo | Requerido para operar | ✅ | Abrir turno con fondo |
| **Corte X** (parcial) | Sin cerrar | ✅ | Construido |
| Corte de Turno | Cierra turno del cajero | ✅ | Wizard 2 pasos |
| **Corte Z** (fiscal diario) | Numeración consecutiva; **requiere CERO órdenes abiertas** | ✅ | Con **guard de órdenes abiertas** (Z no permitido con cuentas abiertas) + sync barrier |
| **Corte Global** (multi-terminal) | Consolida todas las terminales | ❌ | **AUSENTE** |
| **Corte por Mesero** | Resumen individual, múltiples por mesero | ✅ | Con tip-out + comisión tarjeta + arqueo |
| Arqueo | Efectivo contado vs sistema, **máx 3 intentos**; faltante/sobrante | 🟡 | Arqueo ✅; **límite 3 intentos PARCIAL** |
| **Denominaciones en cierre** | Cuenta billetes/monedas | 🟡 | Wizard cuenta billetes/monedas pero **guarda `{}` — solo total persiste** |
| Retiros/depósitos manuales | Con auth gerente; registra monto/hora/usuario/razón | ✅ | Con PIN |
| Retiros programados | Auto-forzar cuando cash > umbral (OFF AMALAY) | ❌ | AUSENTE |
| Control de Efectivo (portal) | Flujo, transferencias entre sucursales, depósitos bancarios, pagos anticipados, cobranza | 🟡 | `control-efectivo` (form + balance); transferencias entre sucursales AUSENTE |
| Envío de corte | Email (no usado AMALAY) | ❌ | Telegram/WhatsApp/email al cerrar AUSENTE |
| Propina tarjeta pagada en efectivo | (en fórmula de arqueo) | 🟡 | PARCIAL (descuadre en restaurantes con muchas propinas tarjeta) |
| Business day start | Timezone/horario sucursal | ✅ | `business_day_start_local` (AMALAY 05:00) |
| Abrir turno / cierre 100% offline | (local always) | 🟡 | Requiere Supabase; ops de media-jornada sí offline |
| Dashboards de corte | Reportes | ✅ **SUPERA** | `cortes` (heatmap), `caja` (Recharts 30d), `conciliacion` (tarjeta-vs-depósito) |

---

## 3.11 Nómina / Propinas / Asistencia

Módulo Wansoft: portal Egresos→Nómina. Fullsite: `pos/asistencia`, `pos/staff`, `checador`, `nomina`, `propinas`, `acceso`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Check-in/out | Por huella DigitalPersona (imprime recibo) | ✅ **SUPERA** | Por **POS PIN/WebAuthn sin hardware extra** (`pos/asistencia`, `checador` kiosk) |
| Horas trabajadas | Por usuario | ✅ | `acceso` (`wansoft_labor`), auto-close al cerrar turno |
| Pago de nómina | Con detalle | ✅ | `nomina` (892L, multi-tab, agregación horas, tarifas editables) |
| Días de asueto | Calendario | ❌ | AUSENTE |
| Turnos (calendario+lista) | — | 🟡 | Parcial |
| **Programación semanal** | Por puesto + turno | ❌ | Agente sugiere, no agenda |
| **Incidencias (5 tipos)** | Retardos, faltas, incapacidades, permisos, vacaciones | ❌ | Registrar incidencias AUSENTE |
| Puestos/jobs | Base de permisos y programación | ✅ | Staff CRUD |
| Módulo de propinas | Fondo + distribución + reporte por mesero | ✅ | `propinas` (263L, desde `wansoft_tips` + fallback) |
| **Cálculo automático 5% al pool** | Tip-out 5% | 🟡 | PARCIAL |
| Propinas sugeridas en pre-ticket | — | ❌ | 10/15/20% AUSENTE |
| Nómina fiscal (IMSS/ISR/timbrado) | (portal) | ❌ | **Deliberadamente NO construida** (export a CONTPAQi/Nomipaq) |

---

## 3.12 Reportes / Analítica

Fuente Wansoft: 60+ reportes (colección más completa de MX), 38 endpoints Reports, P&L mensual automático, Excel vía NPOI. Fullsite: dashboards + ~30 agentes IA.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Ventas consolidado/día/semana/grupo/área/platillo/mesero/tipo orden/forma pago/modificador/terminal/promoción | 19 reportes de ventas | ✅ | `ventas`, `meseros`, `tendencias`, `ingresos`, por platillo/categoría |
| Descuentos/cortesías/cancelaciones/anulaciones detalle | Por ítem | 🟡 | Detalle por-ítem PARCIAL |
| **Ventas por hora** | Reporte dedicado | ❌ | **AUSENTE (crítico cuando POS Fullsite genera su data)** |
| **Personas por hora/día/día-semana** | 3 reportes dedicados (métrica de 1ª clase) | ❌ | AUSENTE |
| **Estado de resultados / P&L** | Mensual automático por año | ✅ | `estado-resultados` (`wansoft_daily` + food cost real) |
| Rentabilidad por platillo | Reporte | ✅ | `rentabilidad` |
| Depósitos/vales/cobranza/retiros | Financieros | 🟡 | `egresos`/`gastos` parcial |
| Control acceso + horas | — | ✅ | `acceso` |
| Propinas | Por mesero | ✅ | `propinas` |
| KDS status | Pantalla en cocina | ✅ | KDS |
| **Auditoría (transferencia platillos)** | Reporte | ✅ **SUPERA** | Audit inmutable |
| Sincronización status | — | ✅ | Nunca visible al usuario (invariante) |
| **Conciliación tarjeta-vs-banco** | — | ✅ **SUPERA** | `conciliacion` (CSV upload) — Wansoft no tiene |
| **Reporte fiscal IVA/ISR** | — | ✅ **SUPERA** | `reporte-fiscal` — Wansoft no tiene |
| **~30 agentes IA** | — | ✅ **EXCLUSIVO** | briefing/anomaly/close-predictor/upselling/menu-engineering/supplier/tips + chat/voice/coach |
| Exportación Excel (.xls) | 8 plantillas NPOI; "9 hojas" + "Reporte para Contador" | 🟡 | Solo **CSV** hoy; **.xlsx real PARCIAL** |
| Reportes programados | (crons portal) | ❌ | Dentro de la app AUSENTE (agentes cubren parte) |
| Sucursales comparadas | Multi-sucursal | ✅ | `sucursales` |

---

## 3.13 Config sucursal / Impuestos / Pagos / Monedas

Fuente Wansoft: portal Configuración. Fullsite: `clients` + `admin/onboarding`, `admin/formas-pago`, `lib/mercadopago.ts`.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Sucursal (timezone/régimen/horarios) | 4 zonas MX; afectan cortes/reportes | ✅ | Timezone, régimen, business_day en `clients` |
| Empresa/RFC/razón/CP/domicilio fiscal | Config FE | ✅ | Todo en `clients` (multi-tenant día 1) |
| Onboarding nuevo cliente | Carga masiva menú Excel (hasta 3 iteraciones) + consultoría | ✅ **SUPERA** | Wizard 4 pasos (`admin/onboarding`: cliente + staff+PINs + menú CSV + formas) — fire-and-forget sin rollback |
| Cuentas contables | Mapeo ventas → cuentas contador | ✅ | `configuracion/cuentas` |
| Cuentas bancarias | A qué banco depositar | ✅ | Soportado |
| Impuestos IVA 16% | Config en ticket | ✅ | `iva_rate` por tenant (`getIvaRate/setIvaRate`; AMALAY IVA-incluido) |
| **IEPS** | Alcohol/tabaco por artículo (inferido dominio CFDI) | ❌ | **No confirmado en código; IVA-incluido 16% hardcode** |
| Formas de pago custom | Catálogo editable (Efectivo, Dólares, tarjetas, transferencia, plataforma/marketing) | ✅ | `pos_payment_methods` (nombre, tipo, comisión %, código SAT, activo) |
| **Monedas (multi-moneda)** | Forma de pago "Dólares" con conversión | 🟡 | Permiso `tipo_cambio` sin UI; USD AUSENTE |
| Tamaños / grupos / horarios / promos / domicilio | Catálogos portal | ✅ | Tablas `pos_*` (ver §3.15) |
| **Terminales bancarias + conciliación auto** | Clip/OEL/NetPay/BBVA | 🟡 | Clip + MP Point; **Getnet (real AMALAY) NO integrado**; conciliación auto terminal-vs-POS AUSENTE |
| Liberaciones / facturas del vendor | Portal | ❌ | N/A (SaaS) |

---

## 3.14 Lealtad / CRM

Módulo Wansoft: `Megapoints.App.exe` + portal. Fullsite: `crm`, `clientes`, `lealtad`, WhatsApp bot.

| Capacidad / Config de Wansoft | Detalle Wansoft | Fullsite | Detalle del gap |
|---|---|---|---|
| Tarjetas de regalo | Tipos, status, admin, reporte (restaurante+tienda) | ✅ | `tarjetas-regalo` (`pos_gift_cards`: código, saldo, cliente, expiry) |
| Gift cards digitales | — | 🟡 | CRUD admin sí; flujo digital QR-por-WhatsApp P2/parcial |
| Encuestas | Config + reporte (opción múltiple + calificación); QR ticket | 🟡 | QR en ticket ✅; **multi-pregunta rechazado (solo NPS)**; resultados con mock |
| **MegaPoints** | Puntos + QR MegaPuntos en ticket (legacy, baja adopción) | ❌ | QR de lealtad/Megapuntos en ticket AUSENTE (tensión producto: SGA dice no construir) |
| Clientes FE | Catálogo fiscal (no CRM marketing) | ✅ | Clientes fiscales |
| **CRM real** | Wansoft NO tiene (historial/preferencias/frecuencia) | ✅ **SUPERA** | `crm` (863L, `pos_customers`, tags, historial visitas), `clientes` (270L) |
| WhatsApp bot | — | ✅ **EXCLUSIVO** | 12.2K clientes Reservy |
| Segmentación/NPS/reseñas | Wansoft NO tiene | 🟡 | Flag `resenas`; NPS 1-pregunta |

---

## 3.15 Settings globales / Periféricos

Fuente Wansoft: POS-BIBLE §21 + configs. Fullsite: catálogos `admin/*` + invariantes.

**Periféricos (estado en AMALAY, Wansoft):**

| Periférico | Wansoft AMALAY | Fullsite |
|---|---|---|
| Cajón de dinero | ON (Ethernet, DRAWER_KICK) | ✅ Cajón por software (`openCashDrawer`) |
| Lector de huella | ON (recibos entrada/salida) | 🟡 WebAuthn (sin DigitalPersona) |
| Báscula | ON (COM1 9600 baud) | ❌ AUSENTE |
| Código barras báscula | ON (peso embebido) | ❌ AUSENTE |
| CashDro (contadora) | OFF | ❌ N/A |
| Segunda pantalla cliente | OFF (hardware roto) | 🟡 No confirmado |

**Settings de sistema Wansoft:** `OrigenDeConfiguraciones=1` (local), `timeout=60000`, `AutoinstalarCert=1`, `MinTotalSecondsToGetDevicesStatus=5`, `TimeInterval=15` (cola impresión), WebApi `Versión=18.0`+`ForcedVersion`, licenciamiento por terminal. **Fullsite equivalente:** config en nube versionada, misma para todas las terminales; URL bridge por terminal; sin licencia por máquina.

**Catálogos maestros configurables Fullsite (`admin/*`), todos CONSTRUIDO salvo nota:**

| Ruta admin | Estado | Configura | Tabla |
|---|---|---|---|
| `usuarios` | ✅* | usuarios portal, rol, sucursales | `wansoft_data` (*password nunca persiste) |
| `formas-pago` | ✅ | formas de pago (comisión, código SAT) | `pos_payment_methods` |
| `menu` | ✅ | ítems + categorías (color, orden) | `pos_menu_items`, `pos_menu_categories` |
| `grupos` | 🟡 | grupos de menú (read-only, deep-link) | derivado |
| `tamaños` | ✅ | tamaños + multiplicador precio | `pos_sizes` |
| `modificadores` | ✅* | modif + grupos + matriz categoría↔grupo | `pos_modifiers`, `pos_modifier_groups`, `pos_category_modifiers` (*tab "por tipo orden" in-memory) |
| `promociones` | ✅ | promos (%/fijo/2x1/combo, schedule, auto_apply, max/día) | `pos_promotions` |
| `horarios` | ✅ | horarios de menú (días, franja) | `pos_schedules` |
| `domicilio` | ✅ | zonas delivery (CP, tarifa, mínimo, minutos) | `pos_delivery_zones` |
| `tienda/articulos` | ✅ | artículos retail | `pos_retail_items` |
| `tienda/precios` | ✅ | edición bulk precios | `pos_retail_items` |
| `tienda/promociones` | ✅ | promos retail | `pos_retail_promos` |
| `tienda/grupos` | 🟡 | grupos retail (rename real; "nuevo" toast) | derivado |
| `tarjetas-regalo` | ✅ | gift cards | `pos_gift_cards` |
| `carga-masiva` | ✅ | import CSV masivo | varias `pos_*` |
| `onboarding` | ✅ | wizard nuevo cliente 4 pasos | `clients`, `pos_staff`, menú, formas |
| `exportar` | ✅ (gated dueño) | export CSV 8 catálogos | 8 tablas |
| `vault` | ✅ (gated dueño) | vault credenciales | `credentials_vault` (XOR débil, no filtra client_id) |
| `chat-logs` | ✅ | viewer read-only logs chat | `chat_logs` |
| `configuracion/cuentas` | ✅ | cuentas contables + bancos | `wansoft_data` |
| `pos/configuracion` | ✅ | Impresión (bridge)/Catálogos/Terminal | `pos_settings`, localStorage |

**Invariantes no-configurables de Fullsite (por diseño):** audit log siempre-on; deducción de inventario al ENVIAR; Z bloqueado con órdenes abiertas; timezone auto; sync nunca visible.

---

# 4. Lista consolidada de gaps

> Todo lo que a Fullsite le falta vs Wansoft, priorizado. **Esfuerzo:** S (días) / M (1-2 semanas) / L (semanas-mes). **Tipo:** Config (setting/UI sobre backbone existente) o Feature (código nuevo).

## 4.1 P0 — bloqueadores operativos / fiscales / de descuadre

| # | Gap | Qué hace Wansoft | Qué le falta a Fullsite | Esfuerzo | Tipo |
|---|---|---|---|---|---|
| P0-1 | **Pago USD + tipo de cambio** | Forma de pago "Dólares" con conversión en cobro | Permiso `tipo_cambio` existe pero **sin UI**; arqueo no reconcilia USD (crítico San Pedro, descuadre de caja) | M | Feature |
| P0-2 | **Editor de ticket POS-side** | Logo/RFC/razón social/serie/footer/IVA/QR con preview + test print por terminal | Config vive en `clients`/`pos-config` pero no editable desde terminal → RFC/serie mal = **CFDI-QR roto (riesgo fiscal)** | M | Config+Feature |
| P0-3 | **Cambiar # de mesa + juntar mesas (UI)** | Avanzadas #5/#10: mover ítem/orden, merge de mesas | Permiso `cambio_mesa` + `/api/pos/merge-orders` existen pero **sin UI + conflicto OCC manual** | M | Feature |
| P0-4 | **Denominaciones de cierre persistentes** | Cuenta billetes/monedas en arqueo | Wizard las cuenta pero **guarda `{}`** (solo total) → arqueo no auditable | S | Feature |
| P0-5 | **Conciliación terminal bancaria (Getnet)** | Espera confirmación de terminal antes de cerrar | Clip+MP Point sí; **Getnet real de AMALAY NO integrado** → cajero teclea monto a mano (descuadre) | M | Feature |
| P0-6 | **Boot offline de Electron** | POS local siempre arranca | Boot desde URL Vercel → arranque offline falla sin internet previo (deuda P0) | M | Feature |

## 4.2 P1 — paridad de back-office / analítica que Fullsite promete generar

| # | Gap | Qué hace Wansoft | Qué le falta a Fullsite | Esfuerzo | Tipo |
|---|---|---|---|---|---|
| P1-1 | **Factor de rendimiento / yield** | `performance` por ingrediente | AUSENTE — subestima food cost ~28% | M | Feature |
| P1-2 | **Sub-recetas como entidad** | Subproductos reutilizables costeables | PARCIAL — falta costeo profundo (Eduardo lo pidió) | M | Feature |
| P1-3 | **Costeo de producción** | MP entra → producto sale (26 SPs) | AUSENTE | L | Feature |
| P1-4 | **Ventas por hora / personas por hora** | 3+ reportes dedicados (métrica 1ª clase) | AUSENTE (crítico cuando POS Fullsite genera su propia data) | M | Feature |
| P1-5 | **Factura Global CFDI** | Mensual con/sin txt SAT (público general) | AUSENTE | M | Feature |
| P1-6 | **Complementos de pago PPD emitidos** | Emitir/emitidos | Tipo `PaymentComplementRequest` existe pero end-to-end AUSENTE | M | Feature |
| P1-7 | **Timbrado real de Notas de Crédito** | NC con reason codes SAT | Status tracking sí, timbrado real falta | M | Feature |
| P1-8 | **Rappi (código)** | Integrado vía middleware | AUSENTE en código (solo DESIGN v0.2.2) | L | Feature |
| P1-9 | **Transferencias entre sucursales (inventario)** | Recibidas/realizadas/por hacer | AUSENTE | L | Feature |
| P1-10 | **Devoluciones a proveedor** | Revierten inventario + generan NC | AUSENTE | M | Feature |
| P1-11 | **Selector de tipo de orden en creación** | Restaurante/Llevar/Domicilio/Recoger | Permisos existen, sin UI | S | Config+Feature |
| P1-12 | **Corte Global multi-terminal** | Consolida todas las terminales | AUSENTE | M | Feature |
| P1-13 | **Envío de corte (Telegram/WhatsApp/email)** | Email al cerrar | AUSENTE | S | Feature |
| P1-14 | **Báscula por peso + barcode báscula** | COM1 9600 + peso embebido + etiquetas TLP2844 | AUSENTE (principal brecha retail) | M | Feature |
| P1-15 | **Export Excel real (.xlsx)** | 8 plantillas NPOI + "Reporte para Contador" | Solo CSV hoy | S | Feature |
| P1-16 | **Número de orden secuencial** | 72, 73… (staff refiere por número) | Usa UUID (8 hex) | S | Feature |
| P1-17 | **Abrir turno + cierre 100% offline** | Local always | Requiere Supabase para abrir/cerrar | M | Feature |

## 4.3 P2 — profundidad ERP / nicho / mejoras incrementales

| # | Gap | Qué hace Wansoft | Qué le falta a Fullsite | Esfuerzo | Tipo |
|---|---|---|---|---|---|
| P2-1 | Multi-almacén con routing por área | AMALAY 6 áreas; salidas por área-almacén | PARCIAL | M | Feature |
| P2-2 | Plantillas de conteo físico por almacén | Seleccionar qué contar | PARCIAL | S | Config |
| P2-3 | Umbral de variación de costo por ingrediente | Alerta si sube > X% | AUSENTE | S | Config |
| P2-4 | Alerta de productos a caducar | Reporte | AUSENTE | S | Feature |
| P2-5 | Órdenes de producción que afectan inventario | Productores/plantillas/órdenes | PARCIAL | M | Feature |
| P2-6 | Órdenes de compra "por aprobar" | Flujo de aprobación | PARCIAL | S | Feature |
| P2-7 | Costos adicionales por platillo (gas/mano de obra) | Config por platillo | AUSENTE | S | Config |
| P2-8 | Simulador de precios | — | AUSENTE | S | Feature |
| P2-9 | Marcas virtuales (delivery) | Un local = N marcas | AUSENTE | M | Feature |
| P2-10 | Tipos de precio por canal (delivery +15-20%) | Config por integración | AUSENTE | S | Config |
| P2-11 | Horario por integración | Distinto Rappi vs Uber | AUSENTE | S | Config |
| P2-12 | Top Offenders (delivery) | Platillos que más fallan | AUSENTE | S | Feature |
| P2-13 | Secciones con permiso por mesero | Mesero ve solo su zona | AUSENTE | M | Feature |
| P2-14 | Reglas anti-fraude dinámicas | >3 cancelaciones → auth | AUSENTE | M | Feature |
| P2-15 | Autorización remota de gerente | (desde portal) | AUSENTE (desde teléfono) | M | Feature |
| P2-16 | Retiros programados con umbral | Auto-force cuando cash > X | AUSENTE | S | Config |
| P2-17 | Programación semanal de turnos | Por puesto + turno | Agente sugiere, no agenda | M | Feature |
| P2-18 | Registro de incidencias (5 tipos) | Retardo/falta/incapacidad/permiso/vacación | AUSENTE | M | Feature |
| P2-19 | Cálculo automático 5% al pool | Tip-out | PARCIAL | S | Feature |
| P2-20 | Propinas sugeridas en pre-ticket | 10/15/20% | AUSENTE | S | Feature |
| P2-21 | Cambiar forma de pago post-cobro | Con audit | AUSENTE | S | Feature |
| P2-22 | Campo torre/referencia para llevar | Obligatorio | AUSENTE | S | Config |
| P2-23 | Pagos anticipados / vales | Prepago (`SaldoPrePago`) | AUSENTE | M | Feature |
| P2-24 | Cuentas por cobrar (CxC) | Cobranza con status | AUSENTE | M | Feature |
| P2-25 | IEPS por artículo | Alcohol/tabaco | AUSENTE (IVA-incluido 16% hardcode) | M | Config+Feature |
| P2-26 | QR de lealtad/Megapuntos en ticket | Impreso | AUSENTE (tensión producto) | S | Feature |
| P2-27 | Encuestas multi-pregunta + resultados reales | Config + reporte | Solo NPS 1-pregunta; resultados mock | S | Feature |
| P2-28 | Reportes programados dentro de la app | Crons portal | AUSENTE (agentes cubren parte) | M | Feature |
| P2-29 | Tablajería | Producto base → cortes | AUSENTE (nicho) | M | Feature |
| P2-30 | Paleo de barra (pesaje botellas) | `AjusteDeDiferenciasBascula` | AUSENTE | M | Feature |
| P2-31 | Detalle por-ítem de descuentos/cortesías/cancelaciones | Reportes dedicados | PARCIAL | S | Feature |
| P2-32 | Motor de plantillas de impresión (equivalente MR6) | 47 plantillas | Tickets CSS; sin motor de plantillas | L | Feature |

## 4.4 Gaps NUEVOS surgidos del schema nativo (.bak) + mapa de portal (revisión §9)

> Estos gaps **no estaban en el primer bible** porque provienen del schema nativo Wansoft (`.bak`, 1048 SPs únicos extraídos) y del mapa real de endpoints del portal — fuentes declaradas "no explotadas" en §7.4 y ahora sí mineadas. Verificados por nombre de SP/tabla real, no inferidos por binario.

| # | Gap | Qué hace Wansoft (evidencia en .bak/portal) | Qué le falta a Fullsite | Prioridad | Esfuerzo | Tipo |
|---|---|---|---|---|---|---|
| N-1 | **Módulo de Reservaciones ligado a orden/mesa** | 9 SPs `Reservation_*` (`ConsultaReservaPorMesa`, `AsignarOrdenReservaDisponible`, `ActualizaEstatusReserva`) + `spSelReservacionesPendientes` — reserva se asigna a mesa y "abre" la orden del POS | Fullsite tiene reservaciones de **eventos** (`amalay_reservaciones`) y WhatsApp bot, pero **no reserva-de-mesa integrada al flujo POS** (asignar reserva → abrir orden en esa mesa) | P1 | M | Feature |
| N-2 | **Tarjetas precargadas / monedero (stored-value)** | `GruposTarjetasPrecargadas`, `PlatillosTarjetasPrecargadas`, `LogsTarjetaPrecargada`, `ClienteTarjeta` — saldo recargable por cliente, restringible a ciertos platillos/grupos | Fullsite tiene **gift cards** (`pos_gift_cards`) pero no monedero recargable con restricción de catálogo ni log de movimientos | P1 | M | Feature |
| N-3 | **Consumo a crédito / cuentas de cliente (colegio/corporativo)** | `spSelConsumoPorCliente`, `spSelClientePOSByCredito`, `spSelVentasACreditoPagadas`, `logventascredito*`, plantilla `ConsumoAlumno.mr6` — cliente consume a cuenta y paga después | AUSENTE — sin cuentas de consumo a crédito por cliente | P2 | M | Feature |
| N-4 | **Subsidios por platillo** | `pos_Ins/Upd/DelSubsidioPorPlatillo` + tabla `subsidioporplatillo` — precio subsidiado (empleado/alumno) por platillo | AUSENTE | P2 | S | Config+Feature |
| N-5 | **Happy Hour (pricing por horario)** | `spActivarHappyHour` / `spDesActivarHappyHour` / `spSelHappyHourActivado` — motor de precios activable por franja horaria | PARCIAL — `pos_promotions` tiene `schedule` pero no un modo Happy-Hour dedicado con activación manual/auto por hora | P2 | S | Config |
| N-6 | **Retos / metas de venta (gamificación)** | `spSelRetosAll`, `spSelMontoRetos` — objetivos de venta con monto meta | AUSENTE (los agentes IA cubren coaching, no metas formales) | P2 | S | Feature |
| N-7 | **Billar / mesa por tiempo** | `spSelConfiguracionMesaBillar` + tabla `configuracionmesabillar` — cobro por tiempo de mesa (billar) — **ahora VERIFICADO en schema** (antes solo inferido) | AUSENTE (nicho) | P2 | M | Feature |
| N-8 | **Disponibilidad de platillo por plataforma (86 por canal)** | `SelPlatilloPlataformas`, `InsExistenciaPlatilloPlataformas`, `spSelPlatillosExistenciaPlataformasPorIdPlatillo` + tabla `disponibilidadplatillosplataforma` — 86/stock independiente por plataforma delivery (base de marcas virtuales) | AUSENTE — refuerza P2-9 (marcas virtuales); confirma que Wansoft SÍ modela stock por-plataforma | P1 | M | Feature |
| N-9 | **Precio por tipo de orden (`preciotipoorden`)** | Tabla `preciotipoorden` — precio distinto por tipo de orden (delivery +%) a nivel de schema | AUSENTE — confirma P2-10 con evidencia de tabla real | P2 | S | Config |
| N-10 | **Corte Z Global multi-terminal (verificado)** | `spSelCorteZGlobal`, `spInsCorteGlobal`, `spSelCorteZGlobalPagos`, `spEnviarCorteGlobalConServicioEnvio`, `spSelPlatillosCorteGlobal` — consolida terminales + **envío del corte por servicio** | Confirma P1-12 (Corte Global) y P1-13 (envío) con SPs reales; el envío del corte es una feature de 1ª clase en Wansoft | P1 | M | Feature |
| N-11 | **Registro de intentos de Corte Z (auditable)** | `spInsIntentoCorteZ` / `spSelIntentoCorteZ` + `ReporteIntentosCorte.mr6` — cada intento de corte queda registrado (el "máx 3 intentos" es auditable) | PARCIAL — Fullsite limita intentos pero no persiste un log de intentos consultable | P2 | S | Feature |
| N-12 | **Propina sugerida como catálogo configurable** | `spIns/Sel/DelCatalogoPropinaSugerida` — catálogo de % de propina sugerida (10/15/20) configurable | AUSENTE — refuerza P2-20 (propinas sugeridas en pre-ticket) con evidencia de catálogo real | P2 | S | Config |
| N-13 | **Complemento de pago (PPD) a nivel de pago** | `spInsComplementoDePagoIdPago`, `spTieneComplementoDePago` + tabla `complementodepago` — PPD ligado al pago | Confirma P1-6 (PPD emitidos) con SP + tabla reales | P1 | M | Feature |
| N-14 | **Código de facturación / autofactura por ticket (`CodigoFacturacion`)** | `spIns/Sel/DelCodigoFacturacion` — código único por ticket para autofactura; `FacturaInterfactura` (PAC Interfactura) | Fullsite imprime QR de autofactura (✅ SUPERA en UX) pero no un catálogo de códigos de facturación reintentables; PAC es Facturama, no Interfactura | P2 | S | Feature |
| N-15 | **Prepago / vales / saldos con log (`movimientoprepago`, `vales`, `saldos`)** | Tablas `movimientoprepago`, `vales`, `saldos` + `SaldoPrePago.mr6` — prepago y vales con saldo y bitácora | Confirma P2-23 (pagos anticipados/vales) con tablas reales | P2 | M | Feature |
| N-16 | **Costo por horas (`spSelCostoxHoras`)** | SP de costo por platillo × día/hora — costeo cruzado con franja horaria | AUSENTE (Fullsite tiene food-cost real-time pero no cruce costo×hora) | P2 | S | Feature |

**Resumen de conteo actualizado:** 6 P0 · 17 P1 · 32 P2 (originales) + **16 gaps nuevos (N-1…N-16: 6 P1, 10 P2)** del schema nativo/portal = **6 P0 · 23 P1 · 42 P2 = 71 gaps totales**. La mayoría absoluta siguen siendo **Features acotadas (S/M)** sobre backbones ya existentes; solo P1-3 (costeo producción), P1-8 (Rappi), P1-9 (transferencias sucursal) y P2-32 (motor plantillas) son L. Ningún gap nuevo es un bloqueador para vender a un café/casual como AMALAY; varios (N-1 reservación-mesa, N-8 86-por-plataforma, N-13 PPD) son relevantes para prospectos con delivery pesado o cuentas corporativas.

---

# 5. Donde Fullsite supera a Wansoft

Estos no son "empates favorables" — son capas donde Wansoft **no puede** alcanzar a Fullsite sin reescribir su producto de 2007.

## 5.1 Analítica en tiempo real + ~30 agentes IA (exclusivo)
Wansoft produce reportes **batch** (snapshots diarios). Fullsite corre **~30 agentes IA** sobre la operación viva: briefing matutino, detector de anomalías, close-predictor (predice cierre a 2/4/6pm), upselling, menu-engineering (estrellas/vacas/perros), supplier-monitor, tips-analyzer, anti-fraude, más **chat IA, voz, y coach**. Con outcome tracking (`agent_events` con estimated_value + outcome). Wansoft: **0 de esto**. Esto es el CORE value prop — "información al segundo → decisiones en tiempo real → más revenue".

## 5.2 KDS + offline LAN sub-1s
Fullsite empuja comandas a KDS por **LAN push <1s** (event store `command_id`→`events.ndjson`, IndexedDB) vs el **polling de 15s** de `RestPrintingApp` de Wansoft. Cola de reintentos con recuperación IndexedDB, fallback Bluetooth. (Deuda conocida: boot de Electron offline, P0-6.)

## 5.3 Cajón de dinero por software
`openCashDrawer` / `POST /drawer` abre el cajón por comando desde el bridge — sin depender de la impresora como el DRAWER_KICK de Wansoft.

## 5.4 Auditoría inmutable always-on (diferenciador estrella)
En Wansoft, el logging de acciones es un **checkbox opcional** ("Guardar logs") — y en AMALAY estaba **APAGADO**. En Fullsite el audit log es **siempre-on, inmutable, no-configurable** (`pos/auditoria`, `getAuditLog`). Para un dueño que sospecha fraude, esto es decisivo.

## 5.5 Autofactura QR self-service
QR CFDI impreso en cada ticket → el cliente factura solo. Paridad con la autoemisión de Wansoft pero además **parser XML de gastos/proveedor** con match de ingredientes + restock automático y **reporte fiscal IVA/ISR mensual** que Wansoft no tiene.

## 5.6 Config versionada en la nube por terminal
Wansoft: config local por terminal (`OrigenDeConfiguraciones=1`, snowflakes). Fullsite: una fila `clients`, misma config para todas las terminales, versionable, sin re-licenciar al agregar máquina.

## 5.7 Conciliación tarjeta-vs-banco
`conciliacion` (CSV upload, tarjeta-vs-depósito). Wansoft **no tiene** conciliación bancaria — su P&L no cruza depósitos reales.

## 5.8 Multi-tenant / clonable
Multi-tenant nativo desde día 1 (client_id por host). Onboarding wizard de 4 pasos crea cliente + staff+PINs + menú CSV + formas de pago. Wansoft requiere una **instalación por sucursal/razón social** + consultoría + carga masiva Excel (hasta 3 iteraciones). El costo marginal de un cliente nuevo en Fullsite tiende a cero; en Wansoft es alto.

## 5.9 Check-in sin hardware + WhatsApp CRM
Check-in/out por PIN/WebAuthn en el mismo POS (sin lector DigitalPersona). CRM real (`pos_customers`, historial de visitas) + WhatsApp bot con 12.2K clientes — Wansoft **no tiene CRM de marketing**, solo catálogo fiscal.

---

# 6. Comparación comercial / licenciamiento

Fuente: cotización real de Wansoft para la nueva sucursal AMALAY (marca "Wansoft by Clip", v26.01.1, ejecutiva Fabiola Tapia).

## 6.1 Modelo Wansoft (de la cotización)

- **Total cotización:** $154,580.45 MXN (Subtotal $154,180.32 − descuento 13.6% $20,921.32 + IVA $21,321.44).
- **Tres conceptos:** (1) Inversión inicial $130,466.01 · (2) Renta mensual $1,500.00 · (3) Cargos anuales $1,293.00.
- **Hardware revendido** (BOM físico): 3 AIO Pentium 15", 6 impresoras térmicas, 3 monitores LED 17", 3 Mini PC, 1 AIO Ci3, **4 lectores biométricos**, 1 cajón grande, 4 no-breaks, 4 reguladores.
- **Servicios:** Instalación+config+capacitación Licencia Inventarios (3 terminales) $11,206.00. Cargo anual "Mantenimiento BD y Servidor Web" $1,293.00. Renta mensual "Licencia Inventarios" $1,500 ($15,000/año; domiciliado $1,375).
- **Condiciones:** portal de autoemisión por razón social; menú por carga masiva Excel (hasta 3 iteraciones); consultoría de inventarios a cargo del cliente; apoyo presencial 12h en máx 2 visitas; soporte 24/7/365; garantía 2 años (Wansoft) / 1 año (otras marcas); anticipo 30%; MSI Amex/Bancomer.

**Naturaleza del modelo:** hardware revendido + **licencia por terminal** + renta mensual + anual de BD/servidor + servicios de instalación/consultoría/capacitación. **Alto costo de setup, alto costo de cambio** (carga masiva de menú, consultoría de inventarios, re-licencia por terminal).

## 6.2 Modelo Fullsite

- **$4,999 MXN/mes por sucursal** + **$4,999 setup** (SaaS, plan único `fullsite_completo`).
- Alternativas de plan: `reporteador` $1,499/mes (IA sobre POS ajeno, sin POS), `fullsite_software` $4,999/mes (todo software, sin hardware), `fullsite_completo` (+$45K hardware one-time opcional).
- Config en la nube, sin licencia por terminal, sin consultoría obligatoria, onboarding por wizard.

## 6.3 Tabla de costo — Año 1 (escenario 3 terminales, comparación directa)

| Concepto | Wansoft | Fullsite ($4,999/mes) |
|---|---|---|
| Setup / instalación / capacitación | $11,206 + inversión inicial | $4,999 |
| Hardware (revendido / one-time) | ~$119,260 (incluido en inversión inicial) | Cliente aporta o +$45K opcional (completo) |
| Licencia mensual × 12 | $18,000 ($1,500×12) | $59,988 ($4,999×12) |
| Cargo anual BD/servidor | $1,293 | Incluido |
| **Total año 1 (con hardware Wansoft)** | **~$154,580** | **~$64,987** (software+setup, sin hardware) |
| **Total año 1 (solo software, sin hardware)** | **~$30,499** (setup servicios + 12 mensualidades + anual) | **~$64,987** |

**Lectura honesta:** cuando el cliente **necesita hardware nuevo**, Fullsite año 1 cuesta ~42% del total Wansoft (~$65K vs ~$155K) porque el cliente reutiliza/aporta hardware. Cuando se compara **solo software** (cliente ya tiene hardware), Wansoft mensual es más barato ($1,500 vs $4,999) — **pero** el precio de Fullsite incluye ~30 agentes IA, analítica en tiempo real, CRM, conciliación bancaria y offline LAN que Wansoft no ofrece a ningún precio. La conversación de ventas no es "más barato", es "**más valor por peso + sin costo de cambio + sin snowflakes**". Además Wansoft tiene costos ocultos históricos (consultoría, soporte por hora) documentados aparte.

---

# 7. Honestidad / caveats

No se barre nada debajo del tapete. Estos son los límites reales de este análisis y del estado de Fullsite.

## 7.1 Drift de esquema (Fullsite)
- En **STAGING**, la tabla `clients` **NO tiene** las columnas `pos_settings` ni `plan`.
- En **AMALAY PROD**, `clients` **SÍ tiene** `pos_settings` y `plan`.
- Consecuencia: `lib/settings.ts` funciona en prod pero **cae silenciosamente a defaults en staging**; `lib/plans.ts` cae a `fullsite_completo` en staging. Es "código adelantado del esquema" — consistente con el drift ya conocido en la auditoría interna. Los 8 settings operativos y los 3 tiers **solo persisten en prod**.

## 7.2 Rappi sin código (Fullsite)
- **Rappi NO existe en código.** Solo hay diseño (DESIGN v0.2.2 en docs). `find` no encuentra `lib/integrations/rappi`. Uber Eats sí es real en código. Cualquier claim de "integración con Rappi" es **falso hoy**.

## 7.3 Riesgo de aislamiento multi-tenant / anon-key (Fullsite, BUG-019)
- **16 de 18 páginas admin** envían la **anon key** como bearer (`Authorization: Bearer ${SUPABASE_ANON_KEY}`); el aislamiento depende 100% de RLS. Solo `admin/menu` usa el token de sesión. `admin/vault` lee `credentials_vault` **sin filtrar por client_id** y usa cifrado XOR débil. Enforcement de página `canAccessPage` usa `startsWith` → rutas anidadas (`/pos/kds/x`) potencialmente sin gate fino; PIN lockout es per-device, no per-employee.

## 7.4 Schema nativo de Wansoft no accesible (Wansoft)
- Las **DLLs binarias** (`NetSilver.*`, `Wansoft.*`, `Megapoints.*`) son binarios .NET compilados **no decompilables** en este entorno. Su alcance se **infiere** de nombre + configs + bibles.
- Las **connectionStrings cifradas**, `Licencia.ns`/`ContraLicencia.ns`, y los `.cer` son blobs cifrados — no legibles.
- Los **backups `.bak`** (`cafeamalay20260330.bak` 1.8 GB) contienen el **schema real de 80+ tablas y 822 SPs**. **ACTUALIZACIÓN (revisión §9):** este `.bak` **YA fue minado** vía `strings` (sin restaurar SQL Server, cumpliendo CLAUDE.md): se extrajeron **1,048 SPs únicos + 85+ tablas** — ver §9.1. Todo lo de §9 sobre SPs individuales está VERIFICADO contra el nombre real en el `.bak`; el detalle de columnas por tabla y los cuerpos completos de SP salen parciales (`strings` fragmenta el `.bak`). Lo dicho en §1–§8 sobre SPs (`SalesByHours`, `CostBySaucer`, `AjusteDeDiferenciasBascula`, etc.) provenía de la web-BIBLE; §9 lo corrobora/amplía con lectura directa del schema.
- Módulos citados en bibles pero **no verificables por binario:** `BillardSetting` (billar), detalle de "Ventas de terceros".

## 7.5 Claims de "SUPERA" — calibración
- Los "SUPERA" de Fullsite son reales pero acotados: superan en **arquitectura, tiempo real, IA, offline, audit** — no en profundidad ERP de inventario/costeo. No confundir "mejor plataforma" con "más features de back-office". Wansoft tiene 822 SPs de lógica de negocio acumulada; Fullsite tiene una fracción, pero mejor arquitectada y con IA encima.
- Donde un doc interno de Fullsite (ej. CAP) dice "269 acciones" o "cambio de mesa RESUELTO", **se confió en el código** (~50 acciones reales, cambio de mesa sin UI). Los conteos optimistas de docs no se propagaron a este documento.

---

# 8. Apéndices

## 8.1 Plantillas de impresión MR6 (47 archivos reales, `FormatoImpresion_MR6/`)

**Órdenes/tickets (11):** ConsumoAlumno (consumo escolar/crédito), OrdenParaDomicilio, OrdenParaLlevar, OrdenParaLlevarDireccion, OrdenParaLlevarDomicilio, OrdenParaRecoger, OrdenesPorCobrar, FacturasAClientes, SaldoPrePago (prepago), Vale, EtiquetasTLP2844 (etiquetas barcode).

**Reportes (36):** ReporteCancelaciones, ReporteClientes, ReporteComandasXMesero, ReporteConsumoPorVentas, ReporteCortesiasencuentascompletas, ReporteCuentasCobradas, ReporteCuentasCobradasXDia, ReporteCuentasPorPagar, ReporteDescuentoenOrdenes, ReporteDetalleFormasdePago, ReporteFacturasdeClientes, ReporteIntentosCorte, ReporteMesa, ReporteMesero, ReporteOrdenesAnuladas, ReporteOrdenesCanceladas, ReporteOrdenesPorCobrar, ReportePlatillosAnulados, ReportePlatillosCancelados, ReportePlatillosGratis, ReportePropinas, ReportePropinasxMesero, ReporteReimpresionesXMesero, ReporteVales, ReporteVentasdeFormadePagoGlobales, ReporteVentasdeFormadePagoporFecha, ReporteVentasdePlatilloPorMesero, ReporteVentasdePlatilloPorRepartidor, ReporteVentasdePorGrupo, ReporteVentasDiarias, ReporteVentasPorPlatillo, ReporteVentasPorPlatilloEspecifico, ReporteVentasporRepartidor, ReporteVentasXMesero, VentasGlobales.

*Notas de dominio:* la existencia de reportes de **repartidor** confirma delivery propio; **ConsumoAlumno**/**SaldoPrePago** confirman modo consumo escolar/prepago. Fullsite no replica este motor de plantillas (P2-32); genera tickets/comandas por CSS.

## 8.2 Plantillas Excel (`Excel/`, vía NPOI) — 8 archivos
ReporteDeCorteGlobal.xls, ReporteDePagos.xls, ReporteDetalleVentas.xls, ReporteExistencias.xls, ReporteLogAcciones.xls, ReporteVentaDetallada.xls, ReporteVentaPorFormaPago.xls, ReporteVentasPorMesero.xls. (web-BIBLE: "Ventas por sucursal = 9 hojas Excel" incl. hoja separada **"Reporte para Contador"**.) Fullsite hoy solo exporta CSV (P1-15).

## 8.3 "Conocimiento oscuro" / edge cases del dominio (que definen paridad real)

Estos son los detalles que separan un POS "que funciona en demo" de uno que sobrevive un servicio real:

1. **Cancelación con 3 caminos:** merma (stock no regresa) / revert inventario (stock regresa) / anulación (error operativo, camino distinto). La pregunta **"¿se preparó? (¿salieron productos de inventario?)"** es la bisagra. Fullsite ✅ lo replica.
2. **Corte con 5 sabores:** X (parcial) / Turno / Z (fiscal, numeración consecutiva, cero órdenes abiertas) / Global (multi-terminal) / por Mesero. Fullsite tiene X/Z/Mesero; falta Global (P1-12).
3. **Separación Restaurante/Tienda** como subsistemas completos que comparten inventario pero no flujo. Fullsite ✅.
4. **Devoluciones a proveedor masivas** que revierten inventario + generan NC. Fullsite ❌ (P1-10).
5. **Paleo de barra:** pesado de botellas abiertas (`AjusteDeDiferenciasBascula`). Fullsite ❌ (P2-30).
6. **Transferencias entre sucursales** = mini-ERP (760 refs en SPs) + transferencias de efectivo. Fullsite ❌ (P1-9).
7. **P&L mensual automático** construido por el sistema (ingresos = brutas − descuentos − cancelaciones − cortesías; costo por deducción de recetas). Fullsite ✅ (`estado-resultados`) + conciliación bancaria que Wansoft no tiene.
8. **Personas por hora** como métrica de 1ª clase (3 reportes dedicados solo a contar personas). Fullsite ❌ (P1-4) — importante porque cuando el POS Fullsite genera su propia data, esta métrica se puede computar de origen.
9. **Modificadores multinivel escalonados** (nivel/requerido/min/max/precio incremental). Fullsite ✅ y valida más estricto.
10. **Transferir platillo entre mesas = vector de fraude #1** (según Eduardo). Fullsite ✅ con PIN + audit inmutable — mejor postura anti-fraude que Wansoft (que tenía logs OFF).

## 8.4 Cifras de escala Wansoft (operación real AMALAY)
211 pantallas de portal · 150+ endpoints HTTP · 822 stored procedures · 80+ tablas · 47 plantillas MR6 · 97 reportes Excel · 615 recetas · 3000 productos inventario · 202 proveedores · 522 platillos · 12–40 empleados. Stack: .NET 4.5 (2007), SQL Server local, ASP.NET MVC, jqGrid, MR6.

## 8.5 Datos reales extraídos (forma de datos Wansoft)
- `costs` — 376 ingredientes (name/unit/department/total_qty/total_cost/unit_cost; ej. AGUACATE KG $90.53).
- `products` — 769 (code/name/wansoft_id; ej. ABA002 / ACEITE DE COCO / 1431527).
- `saucers` — 662 modificadores (name/wansoft_id).
- `ingredient-costs` — ~200 (`cost, unit, product_id, department_id, performance`) — **`performance` = factor de rendimiento/yield** que Fullsite aún no modela (P1-1).
- Feeds JSONB que Wansoft exporta: `wansoft_inventory`, `wansoft_food_cost`, `wansoft_shrinkage`, `wansoft_suppliers`, `wansoft_labor` (incl. `ventas_por_hora`), `wansoft_pnl`, `wansoft_tips`.

---

## Índice de cobertura (checklist de verificación — ninguna área quedó fuera)

- [x] §1 Resumen ejecutivo (veredicto por capa + titular founder + gana/empata/detrás)
- [x] §2 Modelo de configuración comparado (Wansoft local vs Fullsite 3 capas + tabla lado a lado + 15 flags + 8 settings + 3 planes + 6 roles)
- [x] §3.1 POS — Cuenta / Venta
- [x] §3.2 Mesas / Plano
- [x] §3.3 Impresión / Comandas / Hardware
- [x] §3.4 Inventario
- [x] §3.5 Recetas / Costeo
- [x] §3.6 Facturación / CFDI / Fiscal
- [x] §3.7 Retail / Tienda
- [x] §3.8 E-Commerce / Delivery
- [x] §3.9 Seguridad / Roles / Permisos
- [x] §3.10 Turnos / Cortes / Caja
- [x] §3.11 Nómina / Propinas / Asistencia
- [x] §3.12 Reportes / Analítica
- [x] §3.13 Config sucursal / Impuestos / Pagos / Monedas
- [x] §3.14 Lealtad / CRM
- [x] §3.15 Settings globales / Periféricos
- [x] §4 Lista consolidada de gaps (6 P0 · 17 P1 · 32 P2, con esfuerzo S/M/L y tipo Config/Feature)
- [x] §5 Donde Fullsite supera (9 capas detalladas)
- [x] §6 Comparación comercial / licenciamiento (tabla costo año 1)
- [x] §7 Honestidad / caveats (drift esquema, Rappi, anon-key, .bak, calibración SUPERA)
- [x] §8 Apéndices (MR6 47, Excel 8, conocimiento oscuro, cifras escala, datos reales)

**Las 15 áreas funcionales de la taxonomía Wansoft + las 8 secciones requeridas están cubiertas. Ninguna quedó fuera.**

---

# 9. Revisión completa — hallazgos adicionales (schema nativo + portal + connectors)

> **Por qué existe esta sección.** El primer bible (§7.4) declaró explícitamente que el **schema nativo de Wansoft en los `.bak`** (80+ tablas / 822 SPs) **NO estaba explotado** — se infería de nombres de binarios y bibles. Esta revisión sí lo minó. El backup `cafeamalay20260330.bak` (1.78 GB) se procesó con `strings` (sin restaurar SQL Server, sin tocar datos): se extrajeron **1,285 sentencias `CREATE PROCEDURE` → 1,048 SPs únicos**, más nombres de tablas/funciones/vistas y referencias `[dbo].[...]`. Además se leyeron: los 11 scrapers del portal (`~/fullsite/.github/scripts/wansoft_*.py`), el connector de Fullsite (`integration_hub`), la extensión Chrome (`amalay-wansoft-extension`), y 8 docs de integración. **Método de honestidad:** todo lo de §9.1 está **VERIFICADO** contra el nombre real del SP/tabla en el `.bak` (ya no es "inferido por binario"). El detalle de columnas individuales sigue siendo parcial (los cuerpos de SP se fragmentan al `strings`-ear un `.bak`); donde no se pudo leer el cuerpo se marca.

## 9.1 Inventario del schema nativo (.bak) — VERIFICADO

**Conteos reales extraídos del `.bak`:**

| Objeto | Conteo | Método |
|---|---|---|
| Stored procedures únicos | **1,048** | `CREATE PROC(EDURE)` deduplicado (1,285 sentencias brutas — hay procs repetidos/versionados) |
| Funciones (`fn*`) | ~15 | `CREATE FUNCTION` (`fnComandaValida`, `fnGetFormasDePago`, `fnGetTamanoId`, `fnNombrePermiso`, `fnNombreRol`, `fnCantidadesDevolucion`, `SplitString`, `fn_ParseText2Table`…) |
| Tablas identificables | **85+** | identificadores `[dbo].[X]` no-proc referenciados en cuerpos de SP |

> Nota: la web-BIBLE citaba "822 SPs / 80+ tablas". La extracción directa del `.bak` da **1,048 SPs únicos** — el schema real es **más grande** de lo documentado (el 822 probablemente contaba solo un subconjunto o una versión anterior).

**SPs por área (conteo real, keyword sobre 1,048 nombres):**

| Área | ~SPs | SPs representativos (verificados) |
|---|---|---|
| Órdenes / comanda | 131 + 41 | `spInsOrdenPendiente`, `spSelOrdenPendientesByIdTipoOrdenYTerminal`, `spSelComandaByOrden`, `spSelComandaModificadoresByOrden`, `spUpdOrdenPendienteXTransferencia` |
| Ventas / detalle-venta | 67 | `spInsVenta`, `spSelDetalleVentasByMovimiento`, `spSelVentasCanceladas`, `spSelDetalleVentasByMovimiento_Devolucion`, `spSelTotalVentasECommerce` |
| Clientes POS | 67 | `spUpdClientePOS`, `spInsClienteOrdenParaLlevar`, `spInsCustomerFiscalDom`, `spSelClientesDynamic` |
| KDS | 58 | `kds_SelSales`, `kds_SelOrdersInProduction`, `kds_InsComandaProduccion`, `kds_SelDishesIgnoreInStations`, `kds_UpdateKdsConfiguracion` |
| Cortes / arqueo | 54 | `spSelCorteZGlobal`, `spInsCorteGlobal`, `spSelCorteDeTurno`, `spSelCorteZPagosArqueo`, `spInsIntentoCorteZ`, `spSelCorteZByTerminal_Retail` |
| Promociones (motor `NP_*`) | 52 | `NP_InsPromocion`, `NP_SelPromocionesManualesAplicables`, `NP_SelTipoPromociones`, `NP_InsLogPromocionAplicadaPlatillo` |
| Propinas | 28–50 | `spMarcarCorteDeMesero`, `sppagosterminalbancariacorteturno`, catálogo `spSelCatalogoPropinasSugeridas` |
| Facturación / CFDI | 42 | `spInsInvoice`, `spInsFacturaInterfactura`, `spInsCodigoFacturacion`, `spInsComplementoDePagoIdPago`, `spTieneComplementoDePago`, `Invoice_GetCountryCatalog`, `usoscfdi_getcatalog`, `regimenfiscal_get` |
| Roles / permisos / seguridad | 28 + 27 | `permisosrol`, `permisousuario`, `usuarioroles`, `fnNombrePermiso`, `fnNombreRol` |
| Mesas / secciones | 27 + 23 | `spSelCambiosDeMesa`, `spDelSeccionById`, `spDelUsuarioSeccion`, `spDelUsuarioPantallaInicialSeccionDefault` (secciones-permiso por usuario — el gap §3.2/P2-13, con schema real) |
| E-Commerce | 27 | `Ecommerce_AceptarOrden`, `Ecommerce_RechazarOrden`, `Ecommerce_ConsultarOrdenesPendientes`, `spInsRelacionPDVEcommerce`, `spValidarOrdenEcommerce` |
| Cancelaciones / anulaciones | 21 | `spInsCatalogoCancelaciones`, `spSelPlatillosCanceladasAnuladas`, `spSelOrdenesCanceladas` |
| Huella (DigitalPersona) | 11 | `spInsUsuarioHuella`, `spSelUsuarioHuellaImagenByFinger`, `spInsClienteHuella` (huella también para **clientes**, no solo staff) |
| Terminal bancaria / pagos | 11 | `sppagosterminalbancariacorteturno`, `PagosTerminalBancariaTicket`, `fnGetSecuenciaBancaria` |
| Almacén / existencias | 6–12 | `spSelAlmacen`, `spSelAlmacenGrupoByTerminalGrupo`, `spReporteExistenciaEntradas/Salidas`, `spUpdExistenciaPlatillo` |
| Producción | ~10 | `spInsComandaProduccion`, `spActualizarOrdenProduccionOrigen`, `spCopiarPlatillosEntreOrdenProduccion`, `spCheckProduccion`, `kds_*OrdenProduccion` |
| Reservaciones | 9 | `Reservation_ConsultaReservaPorMesa`, `Reservation_AsignarOrdenReservaDisponible`, `Reservation_ActualizaEstatusReserva` |
| Asistencia / labor | ~10 | `spInsRegistroAsistencia`, `spInsUsuarioEntrada/Salida`, `spInsRazonSalida`, `spSelUltimaHoraEntradaByUsuarioId`, `spObtenerNumeroComprasPorNomina` |
| MegaPuntos / lealtad | 5 | `MP_SelDescuentoMegapuntos`, `spInsRegistroMegapuntos`, `spInsDescuentoMegapuntos` |
| Vales / prepago / retos | ~13 | `spSelRepValesByFecha`, `movimientoprepago`, `spSelRetosAll`, `spSelMontoRetos` |

**Tablas nativas identificadas (85+, muestra por área):**

| Área | Tablas (verificadas por referencia `[dbo].[...]`) |
|---|---|
| Venta / orden | `platillo`, `detalleventas`, `comanda`, `ordenpendiente`, `ventas`, `pagos`, `pagospendientes`, `pagosparcial`, `modificador`, `modificadorplatillo`, `modificadorrequerido`, `grupo`, `tipogrupo`, `horaplatillo`, `preciotipoorden`, `tamanos`, `promocion`, `descuento` |
| **Logging / auditoría (18 tablas)** | `logcomanda`, `logdetalleventas`, `logevento`, `logfileoperacion`, `logfileorden`, `logfileplatillo`, `logmodificador`, `logoperacionesusuarios`, `logordenpendiente`, `logpagos`, `logsaccesospdv`, `logsistema`, `logterminal`, `logventas`, `logventascredito(ins/upd)`, `ordenpendientelog`, `trborradoderegistrocomanda`, + SP `writelog` |
| Cliente / fiscal | `clientepos`, `customerfiscal`, `facturasaclientes`, `facturainterfactura`, `complementodepago`, `formatosxml`, `regimenfiscal`, `usoscfdi` |
| Config / sistema | `sistema`, `sistemaconfiguracion`, `configuracion`, `configuracionmesabillar`, `terminal`, `impresoragrupo` |
| Seguridad | `usuario`, `usuarioroles`, `roles`, `permisos`, `permisosrol`, `permisousuario`, `secciones` |
| Inventario / almacén | `almacen`, `existenciaplatillo`, `disponibilidadplatillosplataforma`, `subsidioporplatillo` |
| Lealtad / stored-value | `vales`, `saldos`, `movimientoprepago`, `gruposTarjetasPrecargadas`, `clienteTarjeta`, `montoretos` |
| Reservas / eventos | `evento`, `logevento`, (reservas vía SPs `Reservation_*`) |
| Delivery / plataforma | `disponibilidadplatillosplataforma`, `preciotipoorden` |

**Hallazgo material sobre auditoría (corrige matiz del §3.9/§5.4):** el schema nativo tiene **18 tablas de log/auditoría** (`logfileorden`, `logfileplatillo`, `logventas`, `logoperacionesusuarios`, `logsaccesospdv`, `logterminal`, `logsistema`…) + un SP `writelog`. Es decir, **Wansoft SÍ tiene infraestructura de auditoría profunda a nivel de schema**; el "checkbox opcional Guardar logs = OFF en AMALAY" (§3.9) apaga la **escritura** de esos logs, no es que el modelo no exista. El diferenciador de Fullsite se debe re-encuadrar con precisión: **no es "Wansoft no audita"** — es que en Fullsite el audit log es **siempre-on, inmutable y no-configurable por diseño**, mientras Wansoft lo deja como toggle que en AMALAY estaba apagado. Sigue siendo un diferenciador real de postura, pero la afirmación honesta es "always-on vs opt-in-apagado", no "existe vs no existe".

## 9.2 Mapa de endpoints / reportes / exports del portal (scrapers + extensión)

**Base + auth (verificado en scrapers):** dominio `https://www.wansoft.net/Wansoft.Web`. Auth por **cookie relay** (`.ASPXAUTH`, `ASP.NET_SessionId`, `__RequestVerificationToken`, `SubsidiaryId`) guardado en `clients.wansoft_cookies`; login directo bloqueado por **Cloudflare Turnstile**. `subsidiaryId` requerido en casi todo endpoint (AMALAY = `6043`). Grids en **jqGrid** (`.rowReport`, `.headerReport`, `.totalReport`, `.jqgrow`); el `ConsolidatedSalesMasterReport` es **Angular** (parseo por `innerText`). Endpoints reales declarados en JS del portal (`ScriptsViews/Reports/*.js`, `ScriptsViews/Production/*.js`).

**~120+ endpoints reales mapeados, por controlador** (muestra representativa — lista completa en los scrapers):

| Controlador | Endpoints (muestra) |
|---|---|
| **Reports** (ventas) | `SalesByHours`, `SalesByArea`, `SalesByTerminal`, `SalesByUser`, `SalesByGroup`, `SalesBySaucer`, `SalesByPaymentType`, `SalesByTypeOfOrder`, `SalesByModifiers`, `SalesByWaiterByGroupReport`, `ConsolidatedSalesMasterReport`, `GetConsolidatedSales` (JSON), `Dashboard`, `SaleDetail`, `SalesBySubsidiary`, `IncomeByBranch`, `GetIncomeReport` |
| **Reports** (transacción) | `DiscountsDetail`, `CancelSalesDetail`, `SaleNullificationDetail` (anulaciones), `CourtesiesDetail`, `CashWithdrawal`, `GetCashWithdrawalReport` |
| **Reports** (costeo/P&L) | `GetCostBySaucer`, `CostByGroup`, `GetSaucersWithCost`, `GetIncomeStatemetByMonthInYear` (P&L mensual) |
| **Inventory** | `GetInventoryBySubsidiary`, `InventoryStatement`+`Export…`, `GetReorderPointReport`, `GetReOrderListByWareHouse`, `PhysicalInventoryVsSystem`+`Export…`, `Transfer`+`ExportTransfer`, `Returns`/`Return`, `BatchAdjustment`+`Export…`, `MassiveInventoryOutput`+`Export…`, `SubproductsInProcess`, `InputOutputWithInvoice`, `InputOutputBarcode`, `GetWarehousesBySubsidiarySortedByName`, `GetPresentationsBySubsidiary`, `GetProductsThatAreInRecipes`/`…NotInRecipes`, `GetUnitsOfMeasureBySubsidiary` |
| **Menu** | `GetSaucerAndComplementaryListBySubsidiary`, `GetGroupList`, `GetComplementaryList`, `GetPromotionList`, `GetSubProductListBySubsidiary` |
| **Production** | `GetSaucerRecipe`, `GetSubProductRecipe`, `ProductionAndCosts`, `SubProductRecipe`, `Costs` |
| **Staff** | `GetAccessControlReport`, `GetUserHoursWorkedReport`, `GetPosUsersList`, `GetShiftList` |
| **Finance** | `GetCashFlowList`, `CashFlow`, `BankDeposit`, `GetBankDepositList` |
| **Purchasing** | `GetPurchaseOrderIssued`, `GetSupplierList`, `PurchaseOrder`, `PurchaseOrderBrowser`, `ShopBySupplier`, `ShopByProduct` |
| **ECommerce** | `GetGeneralOrderStatusList`, `GetECommerceMenuStatusList`, `ECommerceMenuStatus` |
| **Billing / Account** | `GetDocumentList`, `Document`, `Account/MyDocumentsList`+`Export…` |

**Patrón de export:** cada reporte expone variantes `Export{Base}` / `Export{Base}ToTxt` / `…ToExcel` / `…ToCsv` vía POST con `__RequestVerificationToken` fresco. Confirma el motor Excel (NPOI, §3.12) a nivel de endpoint.

**Connector de Fullsite (`integration_hub`) — cómo consume Wansoft:** es **file-based** (ingesta de exports **Excel** desde carpeta `WANSOFT_ONLY/`), no API de reportes; adicionalmente hay un stub REST (`/stores`, `/orders` paginado 500) con auth Bearer/Basic. Detecta 7 tipos activos + 3 futuros: `sales_by_branch`, `sales_by_payment` (KPI primario), `courtesies`, `discounts`, `cancelled`, `voided`, **`occupancy` (ocupación por día)**, + futuros `ticket_detail`, `items_by_ticket`, `payments_by_ticket`. Mapea columnas del grid (`c3` Fecha, `c5` Movimiento PDV, `c9` Forma de pago, `c15` Total, `c16` Propina, `c17` Total Cobrado) y computa KPIs (`ticket_count`, `revenue`, `tips`, `avg_ticket`, `payment_mix`, `peak_hour`, `revenue_by_hour`).

**Extensión Chrome (`amalay-wansoft-extension`, MV3):** content-script inyectado en `ConsolidatedSalesMasterReport`, parser `innerText`, secciones detectadas: Ventas brutas/Netas/Descuentos, **por platillo/artículo**, **por tipo de orden** (ticket promedio + personas + cuentas), **por usuario (meseros)**, **propinas por mesero**, **por forma de pago**, **por grupo**. Upsert directo a `wansoft_kpis`/`wansoft_daily`. Confirma que el reporte consolidado de Wansoft **no expone** timestamp por transacción ni correlación mesero×platillo (limitación real del portal, relevante para el pitch "cuando Fullsite genera su propia data, esas métricas son de origen").

**Feeds `wansoft_*` que el pipeline persiste (muestra ampliada vs §8.5):** además de los ya citados — `sales_area`, `sales_terminal`, `modifiers_sold`, `sales_hours`, `discounts_detail`, `cancel_sales`, `voids`, `courtesies`, `cost_by_group`, `saucers_with_cost`, `inv_fisico_vs_sistema`, `inv_transferencias`, `inv_ajustes_lote`, `inv_salida_masiva`, `recipe_products`, `units_of_measure`, `subproduct_recipes`, `presentations_catalog`, `access_control`, `hours_worked`, `pos_users`, `shifts`, `cash_flow`, `bank_deposits`, `income_statement`, `ecommerce_menu_status`, `shop_supplier`, `po_issued`, `suppliers`, `menu_promotions`.

## 9.3 Módulos de pago y adicionales (Clip / Netpay / Wannapay / OEL / Promociones / ImpresionesXP)

DLLs en `~/Desktop/WANSOFT/WebApi/bin/` (binarios .NET no decompilables; capacidad inferida de nombre + configs + SPs bancarios reales `PagosTerminalBancaria*`, `fnGetSecuenciaBancaria`, `sppagosterminalbancariacorteturno`):

| Módulo (DLL) | Capacidad (inferida) | Evidencia | Fullsite |
|---|---|---|---|
| `Wansoft.Clip.dll` | Terminal de pago **Clip** integrada al POS | DLL + marca comercial "Wansoft by Clip" (§6) | ✅ Clip integrado (`lib/mercadopago.ts`/Clip) |
| `Wansoft.Netpay.dll` | Pasarela **Netpay** (procesador de tarjetas) | DLL + forma de pago "Netpay" en AMALAY (§3.1) | ❌ No integrado |
| `Wansoft.Wannapay.dll` | Wallet/pago **Wannapay** | DLL | ❌ No integrado |
| `Wansoft.OEL.dll` | Integración **OEL** (terminal bancaria, citada §3.1) | DLL + "OEL" en métodos de pago | ❌ No integrado |
| `Wansoft.Promociones.dll` | Motor de **promociones** (mapea a 52 SPs `NP_*`) | DLL + `NP_*` en .bak | ✅ `pos_promotions` (paridad funcional) |
| `Megapoints.App.exe` + `Megapoints.App.Backend.dll` | Lealtad **MegaPoints** (mapea a SPs `MP_*`) | EXE/DLL + `MP_*`/`spInsRegistroMegapuntos` | 🟡 CRM propio supera; QR MegaPuntos en ticket AUSENTE |
| `Netsilver.ImpresionesXP.dll` / `NetSilver.Impresiones.dll` | Motor de impresión (variante XP) | DLL + MR6 (§8.1) | ✅ Print bridge (paridad; sin motor plantillas) |
| `NetSilver.Backend/BL/BaseGUI/Logging.dll` | Backend + capa de negocio + GUI base + **logging** | DLLs + 18 tablas `log*` + `writelog` | n/a (arquitectura) |
| `NetSilver.ECommerceService.exe` | Servicio middleware **e-commerce/delivery** | EXE + `NetSilver.ECommerceService.exe.config` (`timeout=60000`, `OrigenDeConfiguraciones=1`) + 27 SPs `Ecommerce_*` | 🟡 Uber real; Rappi solo diseño |
| `NetSilver.HuellaDigital.dll` + SDK DigitalPersona (`DPFP*NET.dll`, `DPFPShrNET`, `DPCtlUruNet`) | Biometría de huella (staff **y clientes**) | DLLs + `spInsClienteHuella`/`spInsUsuarioHuella` | 🟡 WebAuthn, sin DigitalPersona |
| `ControladoresDeCajon.dll` / `Cajon.DLL` | Driver de cajón de dinero | DLLs | ✅ SUPERA (cajón por software) |
| `PinpadConnector.dll` + `pinpad.config` | Conector de PIN-pad físico | DLL + config | 🟡 MP Point / Clip |

**Config nueva verificada:** `Wansoft.Services.exe.config` y `NetSilver.ECommerceService.exe.config` confirman `OrigenDeConfiguraciones=1` (config local), `DirectorioNetSilver=C:\Netsilver`, `timeout=60000`, y **connectionString cifrada** (blob no legible) — refuerza §2.1 (config local por terminal, secretos cifrados).

## 9.4 Capacidades / config nuevas descubiertas — ¿Fullsite las tiene?

> Solo capacidades **no documentadas** en el primer bible. Estado Fullsite: ✅ tiene · 🟡 parcial · ❌ falta.

| # | Capacidad nueva (Wansoft) | Evidencia | Fullsite | Gap |
|---|---|---|---|---|
| 1 | **Reservación de mesa integrada al POS** (reserva → abre orden en mesa) | 9 SPs `Reservation_*` | ❌ (solo reservas de evento + WhatsApp) | N-1 (P1) |
| 2 | **Tarjetas precargadas / monedero recargable** con restricción de catálogo + log | `GruposTarjetasPrecargadas`, `PlatillosTarjetasPrecargadas`, `LogsTarjetaPrecargada` | ❌ (solo gift cards) | N-2 (P1) |
| 3 | **Consumo a crédito / cuentas de cliente** (colegio/corporativo) | `spSelConsumoPorCliente`, `logventascredito*`, `ConsumoAlumno.mr6` | ❌ | N-3 (P2) |
| 4 | **Subsidios por platillo** (precio empleado/alumno) | `subsidioporplatillo`, `pos_*SubsidioPorPlatillo` | ❌ | N-4 (P2) |
| 5 | **Happy Hour** (activación de pricing por horario) | `spActivarHappyHour`/`spDesActivar`/`spSel…Activado` | 🟡 (schedule en promos, sin modo HH) | N-5 (P2) |
| 6 | **Retos / metas de venta** | `spSelRetosAll`, `spSelMontoRetos`, `montoretos` | ❌ (agentes IA cubren coaching) | N-6 (P2) |
| 7 | **Billar / cobro por tiempo de mesa** (ahora VERIFICADO) | `configuracionmesabillar`, `spSelConfiguracionMesaBillar` | ❌ (nicho) | N-7 (P2) |
| 8 | **86 / stock por plataforma delivery** (base de marcas virtuales) | `disponibilidadplatillosplataforma`, `SelPlatilloPlataformas` | ❌ | N-8 (P1) |
| 9 | **Precio por tipo de orden** (delivery +%) a nivel de tabla | `preciotipoorden` | ❌ | N-9 (P2) |
| 10 | **Corte Z Global + envío por servicio** | `spSelCorteZGlobal`, `spEnviarCorteGlobalConServicioEnvio` | ❌ | N-10/P1-12/P1-13 |
| 11 | **Log de intentos de Corte Z** (auditable) | `spInsIntentoCorteZ`, `ReporteIntentosCorte.mr6` | 🟡 (limita, no persiste log) | N-11 (P2) |
| 12 | **Catálogo de propinas sugeridas** configurable | `spSelCatalogoPropinasSugeridas` | ❌ | N-12/P2-20 |
| 13 | **PPD (complemento de pago) por pago** | `complementodepago`, `spTieneComplementoDePago` | 🟡 (tipado, sin end-to-end) | N-13/P1-6 |
| 14 | **Código de facturación por ticket** + PAC **Interfactura** | `spInsCodigoFacturacion`, `facturainterfactura` | 🟡 (QR autofactura ✅; PAC=Facturama) | N-14 (P2) |
| 15 | **Vales / prepago / saldos con bitácora** | `vales`, `saldos`, `movimientoprepago`, `SaldoPrePago.mr6` | ❌ | N-15/P2-23 |
| 16 | **Costo por horas** (costo × franja) | `spSelCostoxHoras` | ❌ | N-16 (P2) |
| 17 | **Secciones-permiso por usuario** (schema real) | `spDelUsuarioSeccion`, `spDelUsuarioPantallaInicialSeccionDefault`, `secciones` | ❌ | P2-13 (confirmado con schema) |
| 18 | **Huella para clientes** (no solo staff) | `spInsClienteHuella`, `spSelAllClienteHuella` | ❌ | (nicho — identificar cliente por huella) |
| 19 | **Ocupación por día** como feed de reporte | connector `occupancy` | 🟡 (personas por hora AUSENTE, P1-4) | P1-4 |
| 20 | **Netpay / Wannapay / OEL** como pasarelas integradas | DLLs `Wansoft.Netpay/Wannapay/OEL` | ❌ (solo Clip/MP Point) | (ampliación de P0-5) |

**Lectura para el pitch (honesta):** la mayoría de estos 20 hallazgos son **nicho o back-office** (billar, subsidios, consumo escolar, retos, huella-cliente) y **no bloquean** la venta a un café/casual. Los relevantes comercialmente son: **N-1 reservación-de-mesa**, **N-8 86-por-plataforma / marcas virtuales**, **N-13 PPD**, **N-10 corte global + envío**, y **N-2 monedero recargable** — todos ya reflejados en los gaps N-*/P1. El hallazgo más importante para la narrativa es de §9.1: **Wansoft SÍ tiene 18 tablas de auditoría** — el diferenciador de Fullsite es "always-on inmutable" vs "opt-in que estaba apagado", no "audita vs no audita". Corregir esto evita un claim rebatible frente a un prospecto técnico.

## 9.5 Caveats de esta revisión (honestidad)

- **`strings` sobre `.bak` fragmenta cuerpos de SP:** se recuperaron nombres de 1,048 SPs con alta confianza, pero los **cuerpos completos** (lógica línea-por-línea) y la **lista exacta de columnas por tabla** salen parciales — un `.bak` comprime/segmenta el texto. Los nombres de tabla/SP son VERIFICADOS; el detalle de columnas individuales sigue siendo parcial (marcado donde aplica).
- **La lista de 85+ tablas es un piso, no un techo:** proviene de identificadores `[dbo].[X]` referenciados en SPs; tablas sin referencia en un SP legible no aparecen. El "80+ tablas" de la web-BIBLE es consistente y probablemente subestimado.
- **DLLs de pago (Clip/Netpay/Wannapay/OEL) siguen siendo binarios:** su capacidad se infiere de nombre + configs + SPs bancarios; no se decompiló código.
- **No se restauró SQL Server ni se leyeron datos** de clientes: solo extracción de texto de schema/SP del `.bak` (cumple CLAUDE.md — sin ejecutar el backup).
- **Diff con `.bak` viejo (`cafe_malay_29052023.bak`) no ejecutado a fondo:** el `.bak` nuevo (2026-03-30) se tomó como fuente canónica; un diff de SPs añadidos/removidos entre 2023 y 2026 queda como trabajo futuro de bajo valor (no cambia el mapa de capacidades).

---

# 10. Roadmap ejecutable (P0 + P1 → tickets)

> De diagnóstico a plan. Cada gap prioritario convertido en ticket accionable con esfuerzo (**S**=días · **M**=1-2 sem · **L**=semanas-mes), tipo (**Config** = setting/UI sobre backbone existente · **Feature** = código nuevo), dependencia y criterio de aceptación. **Principio: primero lo que causa descuadre de caja / riesgo fiscal, luego config sobre backbone existente, al final features nuevas de ERP profundo.**

## 10.1 Wave 0 — P0: cierra descuadre de caja y riesgo fiscal (~2-3 semanas)
Bloqueadores reales de operación. Casi todo es UI/config sobre APIs que ya existen.

| Ticket | Gap | Tipo | Esf. | Depende | Criterio de aceptación |
|---|---|---|---|---|---|
| CP-01 | Pago USD + tipo de cambio (P0-1) | Feature | M | — | Cobrar en USD con TC del día; el arqueo reconcilia MXN+USD sin descuadre |
| CP-02 | Editor de ticket POS-side (P0-2) | Config+Feature | M | — | Editar logo/RFC/serie/footer/IVA/QR por terminal con preview + test print; CFDI-QR válido |
| CP-03 | Cambiar # mesa + juntar mesas (UI) (P0-3) | Feature | M | — | Mover ítem/orden y merge de mesas desde el POS, con resolución OCC automática |
| CP-04 | Denominaciones de cierre persistentes (P0-4) | Feature | S | — | El arqueo guarda el desglose de billetes/monedas (no `{}`), auditable en el corte |
| CP-05 | Conciliación terminal Getnet (P0-5) | Feature | M | — | El cobro con tarjeta espera confirmación de la Getnet antes de cerrar; monto no tecleado a mano |
| CP-06 | Boot offline de Electron (P0-6) | Feature | M | — | El POS arranca sin internet previo (bundle local), no depende de la URL Vercel |

**Quick win:** CP-04 (S) cierra en días.

## 10.2 Wave 1 — P1 back-office & fiscal: lo que Fullsite ya promete generar (~3-4 semanas)
Analítica y fiscal que el prospecto espera cuando el POS Fullsite genera su propia data.

| Ticket | Gap | Tipo | Esf. | Depende | Criterio |
|---|---|---|---|---|---|
| BO-01 | Ventas / personas por hora (P1-4) | Feature | M | — | Reporte por hora (métrica de 1ª clase) con datos del POS Fullsite |
| BO-02 | Número de orden secuencial (P1-16) | Feature | S | — | Órdenes numeradas 72, 73… (no UUID) para referencia de staff |
| BO-03 | Export Excel real .xlsx + "Reporte para Contador" (P1-15) | Feature | S | — | Exportar reportes clave a .xlsx, no solo CSV |
| BO-04 | Envío de corte (Telegram/WhatsApp/email) (P1-13/N-10) | Feature | S | CP-04 | Al cerrar corte se envía automático al dueño |
| BO-05 | Corte Z Global multi-terminal (P1-12/N-10) | Feature | M | CP-04 | Consolida todas las terminales en un corte global |
| BO-06 | Abrir turno + cierre 100% offline (P1-17) | Feature | M | CP-06 | Abrir/cerrar turno sin Supabase (local-first) |
| BO-07 | Factura Global CFDI (público general) (P1-5) | Feature | M | — | Emitir factura global mensual (con/sin txt SAT) |
| BO-08 | Complementos PPD emitidos (P1-6/N-13) | Feature | M | — | Emitir complemento de pago PPD end-to-end, ligado al pago |
| BO-09 | Timbrado real de Notas de Crédito (P1-7) | Feature | M | — | NC timbrada con reason codes SAT (no solo status) |

## 10.3 Wave 2 — P1 inventario / costeo profundo (nivel ERP) (~4-6 semanas)
El terreno donde Wansoft va adelante. Cierra la brecha de costeo/almacén.

| Ticket | Gap | Tipo | Esf. | Depende | Criterio |
|---|---|---|---|---|---|
| IC-01 | Factor de rendimiento / yield (P1-1) | Feature | M | — | `performance` por ingrediente → food cost deja de subestimar ~28% |
| IC-02 | Sub-recetas como entidad costeable (P1-2) | Feature | M | IC-01 | Subproductos reutilizables con costeo propio (pedido de Eduardo) |
| IC-03 | Costeo de producción (MP→producto) (P1-3) | Feature | L | IC-02 | Entrada de MP genera producto costeado |
| IC-04 | Transferencias entre sucursales (P1-9) | Feature | L | — | Traspasos de inventario recibidos/realizados/por hacer |
| IC-05 | Devoluciones a proveedor (P1-10) | Feature | M | — | Devolución revierte inventario + genera NC |
| IC-06 | Báscula por peso + barcode báscula (P1-14) | Feature | M | — | Lectura de peso (serial/COM) + etiquetas de peso para retail |

## 10.4 Wave 3 — P1 canales & CRM (delivery pesado / cuentas) (~3-4 semanas)
Relevante para prospectos con delivery fuerte o cuentas corporativas.

| Ticket | Gap | Tipo | Esf. | Depende | Criterio |
|---|---|---|---|---|---|
| CH-01 | Selector de tipo de orden en creación (P1-11) | Config+Feature | S | — | Restaurante/Llevar/Domicilio/Recoger elegible al crear orden |
| CH-02 | Rappi (código real) (P1-8) | Feature | L | — | Integración Rappi en código (hoy solo diseño v0.2.2) |
| CH-03 | 86 / stock por plataforma de delivery (N-8) | Feature | M | — | Disponibilidad de platillo independiente por canal (base de marcas virtuales) |
| CH-04 | Reservación de mesa ligada al POS (N-1) | Feature | M | — | Asignar reserva → abrir orden en esa mesa |
| CH-05 | Tarjetas precargadas / monedero (N-2) | Feature | M | — | Saldo recargable por cliente, restringible a catálogo, con log de movimientos |

## 10.5 Secuencia recomendada y lectura
- **Orden:** Wave 0 (bloqueadores) → Wave 1 (paridad analítica/fiscal, alto valor de venta) → Wave 2 (costeo ERP, cierra la última gran brecha) → Wave 3 (según prospecto: delivery/cuentas).
- **Config vs Feature:** ~1/3 son config/UI sobre backbone existente (rápidos); el resto features acotadas. Solo **IC-03, IC-04 y CH-02 son L** (semanas-mes); todo lo demás es S/M.
- **P2 (42 gaps):** backlog de profundidad/nicho (Consumo escolar, Billar, Happy Hour, Retos, subsidios, precio-por-canal, prepago/vales, costo×hora…). Se priorizan cuando un prospecto concreto lo pida.
- **Estimación gruesa:** Waves 0-1 (~6-7 semanas) llevan a **paridad operativa + fiscal + analítica** para vender a cualquier café/casual/full-service estándar. Waves 2-3 cierran el back-office ERP profundo y los casos delivery/corporativo.
- **Total priorizado:** 6 P0 + 23 P1 = **29 tickets** (26 en las tablas de arriba + 3 P1 nuevos ya absorbidos en BO/CH). El grueso es esfuerzo S/M sobre backbones que Fullsite ya tiene.
