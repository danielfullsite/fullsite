# FULLSITE — Manual Operativo v1.0

> Fuente de verdad del producto. Documento vivo.
> Ultima actualizacion: 2026-06-30
> Mantener actualizado con cada sesion de desarrollo.

---

## 1. ARQUITECTURA FUNCIONAL

### Mapa del sistema

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (PWA)                         │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐ │
│  │   POS   │  │   KDS   │  │  CORTE   │  │ TURNO    │ │
│  │ /pos    │  │ /pos/kds│  │/pos/corte│  │/pos/turno│ │
│  └────┬────┘  └────┬────┘  └────┬─────┘  └────┬─────┘ │
│       │            │            │              │        │
│  ┌────┴────┐  ┌────┴────┐  ┌───┴──────┐  ┌───┴─────┐  │
│  │DELIVERY │  │FACTURA  │  │AUDITORIA │  │MONITOR  │  │
│  │/pos/    │  │/pos/    │  │/pos/     │  │/pos/    │  │
│  │delivery │  │factura  │  │auditoria │  │monitor  │  │
│  └─────────┘  └─────────┘  └──────────┘  └─────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              LIB (logica compartida)              │   │
│  │  pos-data.ts · printer.ts · print-queue.ts       │   │
│  │  pos-offline-db.ts · pos-constants.ts            │   │
│  │  pos-permissions.ts · facturama.ts               │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
          ┌─────┴──────┐        ┌─────┴──────┐
          │  SUPABASE  │        │   BRIDGE   │
          │  (cloud)   │        │ (localhost) │
          │            │        │  :7717     │
          │ pos_orders │        │            │
          │ pos_turnos │        │ ┌────────┐ │
          │ pos_cierres│        │ │COCINA  │ │
          │ pos_staff  │        │ │TCP x2  │ │
          │ pos_audit  │        │ ├────────┤ │
          │ pos_menu   │        │ │BARRA   │ │
          │ pos_cash   │        │ │TCP     │ │
          │ events     │        │ ├────────┤ │
          └────────────┘        │ │TICKETS │ │
                                │ │USB EC01│ │
          ┌────────────┐        │ ├────────┤ │
          │  DASHBOARD │        │ │CAJA    │ │
          │  /ventas   │        │ │USB PAN │ │
          │  /meseros  │        │ └────────┘ │
          │  /recetas  │        └────────────┘
          │  /inventar │
          │  17 paginas│
          └────────────┘
```

### Modulos

| Modulo | Que hace | Archivos clave |
|---|---|---|
| **POS** | Toma de ordenes, modificadores, cobro, split, descuentos, cancelaciones, notas, sillas, tiempos | `pos/page.tsx` (~3000 lineas) |
| **KDS** | Pantalla de cocina: recibe ordenes, marca items, avanza estados, routing por estacion, alerta sonora | `pos/kds/page.tsx` |
| **Mesas** | Planograma arquitectonico, grid, merge, cuentas por nombre, filtro "mis mesas", alertas +90min | `pos/mesas/page.tsx` |
| **Turno** | Abrir turno con fondo, Corte X, Cierre de caja wizard (4 pasos, denominaciones, PIN), historial | `pos/turno/page.tsx` + `CierreCajaWizard.tsx` |
| **Corte** | KPIs, desglose financiero, metodos de pago, ventas por mesero, arqueo, reabrir ordenes | `pos/corte/page.tsx` |
| **Facturacion** | CFDI 4.0: formulario RFC, timbrado via Facturama, historial, PDF/XML | `pos/facturacion/page.tsx` + `facturama.ts` |
| **Delivery** | Monitor de ordenes por plataforma (Rappi, Uber), cambio de estado | `pos/delivery/page.tsx` |
| **Auditoria** | Log inmutable de todas las acciones con filtros y detalles expandibles | `pos/auditoria/page.tsx` |
| **Monitor** | Health check del bridge, cola de impresion, retry manual | `pos/monitor/page.tsx` |
| **Config** | Staff activo, impresoras conectadas, bridge status | `pos/configuracion/page.tsx` |
| **Bridge** | Servidor HTTP local que rutea ESC/POS a impresoras TCP y USB | `node bridge.js` en `C:\fullsite\` |
| **Print Queue** | Cola persistente en localStorage con retry, escalamiento, recovery | `print-queue.ts` |
| **Offline** | IndexedDB sync queue, cache de menu, auto-sync al reconectar | `pos-offline-db.ts` |
| **Permisos** | 50+ permisos granulares por rol (admin, gerente, capitan, cajero, mesero) | `pos-permissions.ts` |
| **Dashboard** | 17 paginas de analytics: ventas, meseros, platillos, inventario, recetas, tendencias | `/ventas`, `/meseros`, etc. |
| **IA** | 13 agentes autonomos: anomalias, prediccion, upselling, anti-fraude, staffing, menu engineering | `.github/scripts/*.py` |

---

## 2. ESTADO DE CADA MODULO

| Modulo | Existe | Code PASS | Prod PASS | Certified | Riesgo | Prioridad |
|---|---|---|---|---|---|---|
| POS (ordenes) | Si | Si | Si (AMALAY) | 12/13 CERT | Bajo | -- |
| KDS | Si | Si | Si (AMALAY) | Routing OK | Medio (concurrencia con POS) | P1 |
| Mesas | Si | Si | Si (AMALAY) | Merge OK | Bajo | -- |
| Turno (abrir/cerrar) | Si | Si | No | -- | Medio (no probado en prod) | P0 Shadow Day |
| Corte | Si | Si | No | -- | Medio | P0 Shadow Day |
| Facturacion | Si | Si | No (sandbox) | -- | Alto (Facturama no pagado) | P0 |
| Delivery | Si | Si | Parcial | -- | Bajo | P2 |
| Auditoria | Si | Si | Si | Inmutable | Bajo | -- |
| Monitor | Si | Si | Si | -- | Bajo | -- |
| Bridge | Si | Si | Si (AMALAY) | 3/5 criterios | Medio (sin auto-restart) | P1 |
| Print Queue | Si | Si | Si | State machine | Bajo | -- |
| Offline | Si | Parcial | Parcial | OFF-02 PASS | Alto (sync 409 silencia) | P0 |
| Permisos | Si | Si | Parcial | -- | Bajo (enforcement parcial) | P2 |
| Dashboard | Si | Si | Si | -- | Bajo | -- |
| IA | Si | Si | Si | -- | Bajo | -- |

---

## 3. MAPA DE PROCESOS

```
CLIENTE ENTRA
    │
    ▼
┌─────────────────────────────┐
│ MESA                        │
│ Mesero abre mesa en POS     │
│ Asigna personas, sillas     │
│ Opcion: cuenta por nombre   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ ORDEN                       │
│ Agregar items por categoria │
│ Modificadores multinivel    │
│ Notas por item y por orden  │
│ Tiempos/cursos              │
│ Silla por item              │
│ Busqueda + barcode          │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ ENVIAR A COCINA             │
│ saveOrder → Supabase        │
│ printByStation → Bridge     │
│   cocina: TCP 192.168.1.21  │
│   barra: TCP 192.168.1.30   │
│   caja: USB PANADERIA       │
│ Si falla: print queue retry │
│ Audit: order_sent_kitchen   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ KDS (COCINA)                │
│ Polling 2s desde Supabase   │
│ Cards por estacion          │
│ Marcar items individuales   │
│ NUEVA → PREPARAR → LISTA   │
│ Alerta sonora nuevas        │
│ Timer por orden             │
│ Si item cambia: comanda     │
│   ACTUALIZACION impresa     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ COBRO                       │
│ Preticket (precuenta)       │
│ Propina (%, fijo, custom)   │
│ Descuento/cortesia con PIN  │
│ Split (parejo o por items)  │
│ Efectivo → cajon abre       │
│ Tarjeta → Getnet standalone │
│ Mixto → multiples formas    │
│ Delivery → forma custom     │
│ Ticket impreso auto         │
│ Audit: payment_processed    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ FACTURACION (opcional)      │
│ QR en ticket → auto-factura │
│ O captura manual en POS     │
│ Timbrado via Facturama API  │
│ PDF/XML descargables        │
│ PENDIENTE: pago $1,650      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ INVENTARIO (automatico)     │
│ Al enviar a cocina:         │
│   deductIngredientsForOrder │
│ Al cancelar:                │
│   reverseIngredientDeduct   │
│ Al cobrar market:           │
│   deductMarketStockForOrder │
│ Alertas stock bajo          │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ CORTE                       │
│ Corte X: snapshot parcial   │
│ Corte turno: por turno_id   │
│ Corte dia: por fecha        │
│ Ventas por mesero           │
│ Control de efectivo         │
│ Reabrir orden cerrada       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ CIERRE                      │
│ CierreCajaWizard:           │
│   1. Contar billetes        │
│   2. Contar monedas         │
│   3. Resumen + diferencia   │
│   4. PIN gerente + cerrar   │
│ Imprime ticket de cierre    │
│ Guarda en pos_cierres       │
│ Cierra pos_turnos           │
│ Audit: cierre_caja          │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ AUDITORIA                   │
│ pos_audit_log inmutable     │
│ 20+ tipos de accion         │
│ Actor + timestamp + detalles│
│ Consultable desde POS       │
│ Funciona offline (queue)    │
└─────────────────────────────┘
```

---

## 4. DEUDA TECNICA

### P0 — Resolver antes del cutover

| # | Deuda | Tiempo est. | Detalle |
|---|---|---|---|
| DT-1 | handlePayment sin check updated_at | 2h | Doble cobro posible si dos terminales cobran simultaneamente |
| DT-2 | Sync offline trata 409 como exito | 1h | Cambios offline se pierden silenciosamente |
| DT-3 | Items JSON monolitico (items JSONB) | -- | Raiz de todos los problemas de concurrencia. No resolver antes del cutover (1 terminal), resolver post-cutover con normalizacion |
| DT-4 | KDS escribe al campo items (compite con POS) | 2h | Separar kds_status del campo items |
| DT-5 | Mesas abiertas no bloquean cierre de turno | 1h | ADR aprobado: bloquear + override con PIN |

### P1 — Resolver primera semana post-cutover

| # | Deuda | Tiempo est. | Detalle |
|---|---|---|---|
| DT-6 | Sin Supabase Realtime | 3d | Terminales no se sincronizan en tiempo real |
| DT-7 | Sin lock de mesa al abrir | 2h | Dos terminales pueden crear ordenes paralelas |
| DT-8 | Normalizar items a tabla propia | 5d | pos_order_items como filas independientes |
| DT-9 | Cambio de mesero sin audit trail | 1h | Agregar logAudit al cambiar mesero |
| DT-10 | Apertura de cajon sin audit | 30m | Loguear cuando se abre sin venta |
| DT-11 | Cache de PIN inseguro (btoa reversible) | 2h | Usar hash real o eliminar cache |

### P2 — Resolver antes de 10 restaurantes

| # | Deuda | Tiempo est. | Detalle |
|---|---|---|---|
| DT-12 | Permisos definidos pero enforcement parcial | 3d | Auditar cada permiso vs cada UI element |
| DT-13 | Reportes no exportables a Excel desde POS | 2d | Agregar boton "Exportar" |
| DT-14 | Catalogo no editable desde POS | 3d | CRUD de platillos, precios, categorias |
| DT-15 | Sin sistema de fondo de propinas | 5d | Recoleccion, reparto, comisiones, retiros |
| DT-16 | Sin reimprimir comanda explicita | 2h | Agregar boton en KDS |
| DT-17 | Sin Corte Z formal (cierre de dia con bloqueo) | 3d | Definir reglas de negocio primero |

---

## 5. RIESGOS OPERATIVOS

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| **Bridge se detiene** (alguien cierra CMD) | Alta | Alto — no imprime | Startup folder configurado. Staff instruido: "no cerrar ventana negra". Solucion definitiva: NSSM (requiere admin) |
| **Internet se cae** | Media | Medio | Offline-first: ordenes se guardan local, sync al reconectar. Cocina sigue recibiendo comandas impresas (TCP directo). RIESGO: sync 409 (DT-2) |
| **Dos POS editan misma mesa** | Baja (1 terminal) | Critico | Hoy: 1 terminal. Post-cutover: implementar Realtime (DT-6) + lock de mesa (DT-7). Ver ADR-CONCURRENCY |
| **Impresora falla** | Media | Medio | Print queue con retry 5x + escalamiento. Banner "Comandas sin imprimir" en POS. Fallback CSS si bridge no disponible |
| **Facturama fuera de servicio** | Baja | Medio | La facturacion no bloquea el cobro. Se puede facturar despues. QR en ticket para auto-factura offline |
| **Terminal bancaria falla** | Baja | Bajo | Getnet standalone — no depende de Fullsite. Cobrar como efectivo y registrar despues |
| **Corte incorrecto** | Media | Alto | Fondo de apertura + arqueo por denominacion + diferencia calculada. Intentos de corte logueados (CierreCajaWizard). Gerente aprueba con PIN |
| **EC TICKET atascada** | Activo | Medio | Workaround: tickets imprimen en EC01 (USB002). Fix: limpiar cola con admin, o mover RJ-11 del cajon |
| **Certificado eGlobal expira 3 ago 2026** | Cierto | Alto (si AMALAY sigue facturando con Wansoft) | Activar Facturama antes de esa fecha. Si no, renovar certificado eGlobal con proveedor |
| **Staff quiere volver a Wansoft** | Media | Critico | Wansoft no se desinstala. Rollback disponible 2 semanas. La pregunta en dia 30: "volverian a Wansoft?" |

---

## 6. ROADMAP

### Antes del cutover (esta semana)

| # | Tarea | Esfuerzo | Status |
|---|---|---|---|
| 1 | Parche concurrencia: updated_at en handlePayment | 2h | Pendiente |
| 2 | Parche offline: no silenciar 409 | 1h | Pendiente |
| 3 | Separar KDS writes del campo items | 2h | Pendiente |
| 4 | Mesas abiertas bloquean cierre (override con PIN) | 1h | Pendiente |
| 5 | Verificar turno + corte + cierre E2E en AMALAY | 2h | Pendiente |
| 6 | Decidir facturacion (pagar Facturama o workaround) | Decision | Pendiente |
| 7 | Fix cajon (EC TICKET o mover RJ-11) | 1h presencial | Pendiente |
| 8 | Instalar Fullsite en todos los devices | 2h presencial | Pendiente |
| 9 | Capacitacion staff | 3h presencial | Pendiente |
| 10 | Shadow Day | 1 dia presencial | Pendiente |

### Primer restaurante (semanas 1-4 post-cutover)

| # | Tarea | Esfuerzo |
|---|---|---|
| 1 | Normalizar items a pos_order_items (ADR Opcion B) | 5d |
| 2 | Supabase Realtime para sync entre terminales | 3d |
| 3 | Huella digital (WebAuthn o bridge) | 3d |
| 4 | Corte Z formal con reglas de negocio | 3d |
| 5 | Sistema de fondo de propinas | 5d |
| 6 | Cambio de mesero con auditoria | 1h |
| 7 | NSSM para bridge auto-restart | 1h presencial |
| 8 | Reportes exportables a Excel | 2d |
| 9 | Reimprimir comanda desde KDS | 2h |
| 10 | Hypercare: soporte diario, revisar audit, ajustar | Continuo |

### Primeros 10 restaurantes (meses 2-6)

| # | Tarea | Esfuerzo |
|---|---|---|
| 1 | Multi-tenant completo (client_id en todo) | 3d |
| 2 | Onboarding automatizado (migration script) | 5d |
| 3 | Catalogo editable desde POS (CRUD) | 3d |
| 4 | Base de datos de clientes (CRM basico) | 3d |
| 5 | Permisos configurables por usuario (no hardcoded) | 3d |
| 6 | Integracion Uber Eats API | 5d |
| 7 | Asignacion formal de secciones a meseros | 2d |
| 8 | Terminal propia (hardware) | Investigacion |
| 9 | Documentacion para implementadores | 5d |
| 10 | Sistema de soporte (tickets, chat) | 3d |

### Primeros 100 restaurantes (meses 6-18)

| # | Tarea | Esfuerzo |
|---|---|---|
| 1 | Event sourcing como complemento (ADR Opcion B+C) | 12d |
| 2 | API publica para integraciones | 10d |
| 3 | Marketplace de integraciones (pagos, delivery, contabilidad) | Continuo |
| 4 | App nativa para comandero (React Native) | 30d |
| 5 | Analytics avanzados (benchmarks entre restaurantes) | 10d |
| 6 | Sistema de lealtad/puntos | 5d |
| 7 | Compras y proveedores | 10d |
| 8 | Contabilidad (integracion CONTPAQi/SAT) | 10d |
| 9 | Equipo de 3+ developers | Hiring |
| 10 | SOC 2 / compliance | 15d |

---

## 7. METRICAS DE CERTIFICACION

### AMALAY — Estado actual

| Item | Status | Fecha |
|---|---|---|
| Precios 509/509 match Wansoft | PASS | 2026-06-27 |
| Routing 38/40 grupos | PASS (2 pendientes) | 2026-06-28 |
| Staff 36/40 match | PASS (2 faltantes) | 2026-06-27 |
| Bridge imprime cocina | PASS | 2026-06-29 |
| Bridge imprime barra | PASS | 2026-06-29 |
| Bridge imprime tickets | PASS (EC01) | 2026-06-29 |
| Bridge auto-arranque | PASS (Startup) | 2026-06-29 |
| Offline sync | PASS (OFF-02) | 2026-06-26 |
| Print queue state machine | PASS (BUG-005) | 2026-06-26 |
| Audit queue offline | PASS (A3) | 2026-06-26 |
| 12 flujos certificados | PASS (CERT-01 a CERT-12) | 2026-06-29 |
| H-7 comanda de actualizacion | Code PASS | 2026-06-30 |

### Pendiente certificar en Shadow Day

| Item | Tipo |
|---|---|
| Turno: abrir + operar + cerrar | Flujo completo |
| CierreCajaWizard: arqueo real | Produccion |
| Bridge: sobrevive reinicio | Hardware |
| Cajon: abre con efectivo, no con tarjeta | Hardware |
| H-7: comanda actualizacion imprime | Produccion |
| Facturacion: timbrado real (si Facturama pagado) | Produccion |
| Concurrencia: parches aplicados | Codigo |

---

## 8. CONTACTOS Y ACCESOS

| Recurso | Acceso |
|---|---|
| Terminal AMALAY | TeamViewer ID: 730 530 602 (SERVER1, usuario: Cliente) |
| Supabase | qjiomlvudfmzuvqvhwpk.supabase.co |
| Vercel | auto-deploy desde GitHub main |
| GitHub | ramonfaurdaniel-png/fullsite |
| Bridge | `C:\fullsite\bridge.js` + `printers.json` |
| Wansoft backup | `~/Desktop/WANSOFT/cafeamalay20260330.bak` (1.78 GB) |

---

> Este documento es la fuente de verdad del producto.
> Todo lo que no esta aqui, no esta decidido.
> Actualizar despues de cada sesion, Shadow Day, y cutover.
>
> Fullsite v1.0 — 2026-06-30
