# Fullsite Master Bible

> El punto de entrada para cualquier ingeniero nuevo.
> No repite las Bibles módulo a módulo — las referencia y explica las intersecciones.
> Es la narrativa completa del sistema: por qué existe, cómo funciona, qué decisiones lo definen.
> Última actualización: 2026-07-23

---

## Propósito de este documento

Este documento existe para responder a la pregunta: **¿cómo funciona Fullsite como sistema completo?**

No entra en el detalle de ningún módulo específico. Para eso existen las Bibles especializadas. Este documento enseña cómo todos los módulos se conectan entre sí, qué invariantes garantiza el sistema completo, y cómo pensar en los flujos que cruzan múltiples capas.

Alguien que lea este documento un fin de semana debe poder contribuir con criterio el lunes — no solo escribir código, sino entender por qué cada decisión fue tomada, qué rompe, y qué nunca debe tocar.

### Tres niveles de evidencia

Todo lo afirmado en este documento lleva uno de estos marcadores:

- `[HECHO]` — Implementado, verificado en producción o staging validado. Hay evidencia.
- `[INFERENCIA]` — Basado en lectura de código o diseño. No verificado end-to-end.
- `[PENDIENTE]` — Diseñado o planeado, no implementado todavía.

Nunca mezclados. Nunca un "está implementado" sin marcador.

### Cuándo leer cada Bible

| Si acabas de unirte al equipo | Lee este documento completo primero |
|---|---|
| Si vas a tocar código del POS | POS Bible + Engineering Bible |
| Si vas a tocar el dashboard | Dashboard Bible |
| Si necesitas entender por qué se tomó una decisión | `docs/DECISIONS.md` + § Decision Log de este documento |
| Si necesitas entender la operación del restaurante | Operations Bible |
| Si alguien te pregunta qué construye Fullsite | Product Vision Bible |
| Si necesitas entender una entidad del dominio | Domain Bible |

### Cómo se mantienen actualizadas

Quien toca el código, actualiza la Bible del módulo. El Master Bible se actualiza cuando cambia la arquitectura del sistema completo. Las marcas [HECHO], [INFERENCIA], [PENDIENTE] se actualizan el mismo día del cambio, no después.

---

## La historia de Fullsite

### El problema

Un restaurante en México depende de Wansoft — software .NET construido en 2007 que corre en un SQL Server local dentro del restaurante. Cuando se va la luz, el SQL Server cae. Cuando la terminal falla, el restore requiere llamar a soporte. Cuando el soporte tarda una semana (que es lo normal), el restaurante opera con papel y calculadora durante ese tiempo.

El dueño del restaurante no puede responder "¿cuánto vendí ayer?" sin: abrir el portal web, esperar que sincronice, navegar 4 clicks, exportar un Excel, y abrirlo en su laptop. Ese proceso toma entre 5 y 20 minutos si todo funciona.

Wansoft tiene 211 pantallas, 150+ endpoints HTTP, 822 stored procedures, y 20 años de madurez operativa. Nadie ha construido en México un backoffice restaurantero comparable. La barrera no es tecnológica — es que para competirles hay que conocer tablajería, producción de panadería, facturación electrónica mexicana (CFDI 4.0), integraciones con Rappi/UberEats, y 15 tipos de reportes que el contador espera. Y hay que hacerlo funcionando en restaurantes reales, con internet inestable, staff que rota cada 3 meses, y cortes de luz a las 2pm del sábado.

Fullsite existe porque entendemos ese problema desde adentro. Daniel opera AMALAY Coffee & Market. El sistema se prueba donde falla — en el piso del restaurante, hora pico, viernes a las 8pm.

### La solución

Fullsite es un Restaurant Operating System. No un POS más rápido — un sistema que captura la historia completa de lo que pasa en el restaurante, razona sobre esa historia en tiempo real, y actúa proactivamente.

Las diferencias que importan:

- **Sin internet: funciona.** El POS opera desde IndexedDB. Al reconectar, sincroniza automáticamente. Wansoft: SQL Server muere, el restaurante muere.
- **Datos al instante.** "¿Cuánto vendí ayer?" — WhatsApp, 3 segundos. Sin portales, sin sincronizaciones, sin esperas.
- **IA que trabaja mientras el restaurante duerme.** 13 agentes detectan anomalías, predicen el cierre del día, detectan fraude, optimizan el menú. Wansoft: 60+ reportes que alguien tiene que abrir manualmente.
- **Setup en <30 minutos.** Importar el menú, configurar impresoras, empezar a vender. Wansoft: días de instalación con un técnico en sitio.

La tesis central es la red: cada restaurante que usa Fullsite aporta datos anonimizados a una inteligencia colectiva. "Tu food cost de 38% está 5 puntos arriba del promedio de tu categoría." "Los restaurantes de tu zona ven 20% más tráfico este viernes — prepara más." Eso es imposible con software local. Y es imposible sin escala. Pero la arquitectura correcta tiene que existir desde el primer restaurante. Existe desde el día 1.

### La situación actual (julio 2026)

Fullsite POS está construido y validado en AMALAY con 12/12 casos de certificación pasados (R1). El dashboard tiene 17 páginas funcionales. Hay 13 agentes IA activos. El cutover (reemplazar Wansoft por Fullsite en AMALAY) está pendiente de la última milla: instalación de Facturama ($1,650 MXN), configuración de IPs de impresoras, capacitación formal del staff, y el piloto de 48 horas. El objetivo estratégico es llegar a 100 restaurantes. El funding target es YC Winter 2027.

---

## El sistema completo — visión de 10,000 metros

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FULLSITE SYSTEM                                  │
│                                                                          │
│  TERMINALES EN EL RESTAURANTE                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │  Electron App    │    │  Electron KDS    │    │ Dashboard (web)  │   │
│  │  (POS terminal)  │    │  (cocina/barra)  │    │ (dueño/gerente)  │   │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘   │
│           │                       │                        │             │
│  ┌────────▼───────────────────────▼──────────────────────▼──────────┐  │
│  │            Next.js App (Vercel)  — dashboard-app/                 │  │
│  │  /pos  /kds  /cocina  /inventario  /compras  /facturas  /chat     │  │
│  │                                                                    │  │
│  │  API Routes:                                                       │  │
│  │  /api/pos/save-order  ← Transaction A + Transaction B             │  │
│  │  /api/pos/pin         ← TurnoGate + permisos                     │  │
│  │  /api/pos/staff       ← staff CRUD                                │  │
│  │  /api/food-cost       ← motor de costos                           │  │
│  │  /api/chat            ← agente conversacional                     │  │
│  └────────────────────────────┬───────────────────────────────────────┘  │
│                               │                                           │
│  ┌────────────────────────────▼───────────────────────────────────────┐  │
│  │                  Supabase (PostgreSQL + RLS)                        │  │
│  │                                                                    │  │
│  │  pos_orders   pos_turnos   pos_inventory   pos_events              │  │
│  │  pos_staff    pos_recipes  pos_tax_rules   pos_save_operations     │  │
│  │  clients      wansoft_daily  wansoft_kpis                         │  │
│  └────────────┬─────────────────────────────────────────────────────-┘  │
│               │                    │                       │              │
│  ┌────────────▼──────┐  ┌──────────▼──────────┐  ┌───────▼──────────┐  │
│  │  Print Bridge     │  │  Agentes IA (Python) │  │  Wansoft         │  │
│  │  Node.js :7717    │  │  GitHub Actions      │  │  (shadow mode)   │  │
│  │  ESC/POS → TCP    │  │  anomaly, fraud,     │  │  NetSilver .NET  │  │
│  │  USB impresoras   │  │  close_predictor,    │  │                  │  │
│  └────────┬──────────┘  │  briefing, upsell    │  │  ← bridge.js    │  │
│           │             └──────────┬────────────┘  └──────────────────┘  │
│  ┌────────▼───┐                   │ Telegram / WhatsApp                  │
│  │ Impresoras │         ┌─────────▼──────────┐                          │
│  │ TCP + USB  │         │    Daniel / Staff   │                          │
│  └────────────┘         └────────────────────┘                          │
│                                                                          │
│  AUTENTICACIÓN Y CONTROL DE ACCESO                                       │
│  Staff → PIN (4 dígitos) o Huella HID → TurnoGate → POS habilitado     │
│  Dueño/Gerente → Supabase Auth (email/password) → Dashboard             │
└─────────────────────────────────────────────────────────────────────────┘
```

### El bridge: dos roles en la vida del sistema [HECHO]

**Antes del cutover (shadow mode activo desde 2026-06-12):** El bridge (`print-bridge/bridge.js`) captura eventos de Wansoft y los escribe en el Event Store de Fullsite (tabla `pos_events`). Es el corazón de la fase de validación: sin bridge, el Event Store está vacío, y sin Event Store, no hay inteligencia operativa histórica.

**Post-cutover:** El rol de captura de eventos cesa. El POS de Fullsite escribe directamente a Supabase. El bridge continúa como bridge de impresión exclusivamente: recibe comandos HTTP del POS y los traduce a ESC/POS para las impresoras térmicas vía TCP/IP o USB.

---

## El flujo de información — de principio a fin

Esta es la historia completa de cómo un cliente que entra al restaurante se convierte en inteligencia operativa para el dueño.

→ Ver [POS Bible § Flujos principales] para el detalle paso a paso de tomar y cobrar una orden.
→ Ver [Operations Bible § Un día completo] para el flujo operativo de apertura a cierre.
→ Ver [Dashboard Bible § Source of Truth] para qué tabla alimenta cada visualización del dueño.
→ Ver [Product Vision Bible § Tesis] para por qué este flujo importa estratégicamente.

```
CLIENTE ENTRA AL RESTAURANTE
    ↓
MESERO TOMA ORDEN (POS)
  Mesero selecciona mesa → crea orden en React state + IndexedDB
  Agrega ítems → cada ítem con nombre, precio, modificadores, seat_id
  Presiona "Enviar a cocina" → POST /api/pos/save-order (Transaction A)
  La orden queda guardada en pos_orders (Supabase) con revision++
    ↓
COMANDA LLEGA A COCINA (Print Bridge + KDS)
  El bridge recibe el comando de impresión → ESC/POS → impresora térmica
  El KDS (Electron en cocina) actualiza: ítem aparece como "pendiente"
  Cocinero ve el ítem → marca "preparando" → "listo" en KDS
    ↓
CAJERO COBRA (Transaction A + Transaction B)
  Mesero selecciona forma de pago → POS calcula total + IVA + IEPS
  save_operation_id generado por cliente → garantiza exactly-once
  POST /api/pos/save-order → Transaction A (r1_save_order_idempotent)
  Si OCC ok → pos_orders.status = "closed", revision++
  Transaction B (r1_reconcile_order) → ingredientes deducidos de pos_inventory
  Resultado: inventory_status COMPLETE | BLOCKED | PENDING
    ↓
TICKET IMPRESO
  Print Bridge → impresora cajera → ticket con total + QR de auto-facturación
  Si cliente quiere factura → escanea QR → portal Facturama → CFDI emitido
    ↓
DASHBOARD DEL DUEÑO (visible inmediatamente)
  pos_orders actualizada → dashboard consulta en tiempo real
  food-cost, inventario, cortes reflejan la venta
    ↓
AGENTES IA (background, cada pocos minutos o en cron)
  anomaly_detector verifica si algo está fuera del patrón histórico
  close_predictor estima la venta final del día
  antifraud_agent busca patrones sospechosos en cancelaciones/descuentos
  upselling_agent detecta oportunidades por mesero
    ↓
DUEÑO RECIBE BRIEFING (7am día siguiente)
  daily-briefing.yml corre en GitHub Actions
  Lee Supabase (wansoft_daily o pos_orders), reservaciones, alertas
  Groq/Claude genera narrativa → envía a Telegram
  Daniel recibe en su celular antes de que el restaurante abra
```

---

## Arquitectura

### Capas del sistema

→ Ver [Engineering Bible § Arquitectura de capas] para el análisis técnico de cada capa.
→ Ver [Dashboard Bible § Módulos] para el catálogo de las 17 páginas del dashboard.

```
CAPA 1: CLIENTE (browser / Electron)
  React state + IndexedDB (offline storage)
  Responsabilidad: UX inmediata, cola de sync offline
  Archivos clave: src/app/pos/page.tsx, src/lib/pos-offline-db.ts

CAPA 2: SERVIDOR (Next.js en Vercel)
  API Routes que validan, coordinan RPCs, y retornan resultados
  Responsabilidad: validación de clientId, coordinación Transaction A/B
  Archivos clave: src/app/api/pos/*, src/lib/api-auth.ts

CAPA 3: BASE DE DATOS (Supabase / PostgreSQL)
  Stored functions (RPCs), RLS policies, tablas
  Responsabilidad: atomicidad, OCC, idempotencia, aislamiento multi-tenant
  Source of truth definitiva. Nada puede alterar datos sin pasar por aquí.

CAPA 4: HARDWARE LOCAL
  Electron App (envuelve la PWA en una ventana de escritorio)
  Print Bridge (Node.js :7717 → impresoras térmicas TCP/USB)
  Electron KDS (pantalla en cocina/barra)
  Archivos clave: electron-app/main.js, print-bridge/bridge.js, electron-kds/main.js

CAPA 5: AGENTES DE INTELIGENCIA (GitHub Actions)
  Python scripts que leen de Supabase y envían alertas/reportes
  Corren en cron o on-demand via Telegram → Cloudflare Worker → GitHub Actions
  Archivos clave: .github/scripts/*.py, agents/*
```

### Transaction A vs Transaction B

Este es el principio más importante del sistema. Todo ingeniero nuevo debe entenderlo antes de tocar código de pagos o inventario.

→ Ver [Engineering Bible § Transaction A/B] para el análisis técnico detallado y los patrones de retry.
→ Ver [Domain Bible § Order] para el schema completo de pos_orders y los campos inventory_status.
→ Ver [POS Bible § Cobro y formas de pago] para cómo el mesero experimenta este flujo.

**Transaction A: guardar la orden** [HECHO]

Es la operación de ventas. El mesero capturó una orden, el cliente pagó, los datos quedan persistidos en Supabase. Esta transacción tiene que ser infalible:

- Usa OCC (`expected_revision`) para detectar conflictos concurrentes.
- Usa `save_operation_id` para garantizar idempotencia: si el mismo pago llega dos veces (por timeout, offline replay, doble-click), la segunda vez retorna el resultado original sin re-ejecutar.
- El resultado es binario: `ok: true, revision: N` o `conflict: true / error`.

Implementado en `src/app/api/pos/save-order/route.ts`. Las RPCs son `r1_save_order` (sin idempotencia, legacy) y `r1_save_order_idempotent` (con `save_operation_id`).

**Transaction B: reconciliar inventario** [HECHO]

Es la deducción de ingredientes. Corre DESPUÉS de Transaction A, de forma completamente independiente. Si Transaction B falla (por 503, error de receta, existencia insuficiente), la orden YA ESTÁ GUARDADA. El pago ya ocurrió. La venta ya sucedió.

Transaction B no puede deshacer Transaction A. Su falla produce `inventory_status: PENDING` que el sistema puede reintentar. Su éxito produce `COMPLETE` o `BLOCKED` (ingrediente sin stock suficiente).

La separación existe por un principio operativo: **un restaurante no puede perder una venta porque el módulo de inventario tiene un error**. Las dos operaciones tienen contratos de falla diferentes.

### El mecanismo completo de save-order

```
POST /api/pos/save-order
    ↓
1. getClientId(request) → extrae client_id del header x-client-id o NEXT_PUBLIC_CLIENT_ID
2. Validar order_id (string requerido)
3. Validar expected_revision (número ≥ 0 requerido)
    ↓
4. Si hay save_operation_id → usar r1_save_order_idempotent
   Si no → usar r1_save_order (legacy)
    ↓
5. RPC verifica:
   - Que la orden existe y pertenece a client_id
   - Que pos_orders.revision == expected_revision (OCC)
   - Si hay save_operation_id: buscar en pos_save_operations
     - Si existe → retornar resultado original (idempotent_replay: true)
     - Si no → ejecutar el save y guardar en pos_save_operations
    ↓
6. Si saveResult.ok = false → retornar inmediatamente (conflict o error)
    ↓
7. Transaction B: determinar si reconciliar
   - Si first_execution: true → siempre reconciliar
   - Si idempotent_replay: true → verificar last_inventory_processed_revision
     Si no está al día → reconciliar como catch-up
    ↓
8. r1_reconcile_order(p_client_id, p_order_id)
   - Deduce ingredientes de recetas por cada ítem de la orden
   - Actualiza pos_inventory (stock down)
   - Retorna lista de resultados por ítem: RECONCILED | NO_MUTATION_APPROVED | BLOCKED_*
    ↓
9. Calcular inventory_status: COMPLETE | BLOCKED | PENDING | SKIPPED
    ↓
10. Retornar resultado completo al cliente
```

### El flujo offline-first [HECHO]

El offline-first no es un feature — es un requisito operativo. Los restaurantes tienen internet inestable. Un sistema que deja de funcionar cuando falla el router no es aceptable.

```
OPERACIÓN NORMAL (online)
  Cliente toca POS → React state actualiza
  POST /api/pos/save-order → Supabase
  IndexedDB actualizado como caché secundaria

OPERACIÓN OFFLINE (sin red)
  navigator.onLine = false → OfflineIndicator muestra banner
  POST /api/pos/save-order falla → no-throw, capturado por offline-sync
  Operación → IndexedDB [sync_queue] con transport: APP_API
  POS continúa operando desde IndexedDB [orders]
  El operador no ve diferencia en el UX — puede seguir cobrando

RECONEXIÓN (red vuelve)
  navigator.onLine = true → registerAutoSync() dispara syncAll()
  syncAll() procesa la queue en orden (module-level lock: nunca dos runs paralelos)
  Para cada SyncQueueItem en estado pending:
    - Si transport: APP_API → replayViaAppApi() → /api/pos/save-order
    - Si transport: SUPABASE_REST → fetch directo a PostgREST
  Resultados:
    - ok: true → markSynced(), emite evento pos-order-synced al POS activo
    - STALE_WRITE_CONFLICT → markConflict(), NO reintento, payload preservado
    - TERMINAL_NON_RETRYABLE → markConflict(), NO reintento
    - TRANSIENT_RETRYABLE → incrementRetry() (máx 5 reintentos)
```

**Por qué dos transports:** Las órdenes van por APP_API porque necesitan OCC + idempotencia, que solo existen en `/api/pos/save-order`. Los audit logs, movimientos de inventario de market, y otros datos no-reconciliación van por SUPABASE_REST directo — son operaciones idempotentes por naturaleza (upsert) que no necesitan la capa de OCC.

---

## Decision Log — Las decisiones que cambiaron el rumbo

Las 8 decisiones más importantes del sistema. Para cada una: el problema que resolvía, las alternativas consideradas, los tradeoffs, y cuándo tendría sentido replantearla.

Antes de cambiar cualquiera de estas, leer el contexto completo en `docs/DECISIONS.md`.

→ Ver [Engineering Bible § Principios de concurrencia] para el análisis técnico profundo de D2, D3, D4, D6.
→ Ver [POS Bible § Cobro y offline] para cómo D3, D4, D5, D6 se manifiestan en el flujo de pago.
→ Ver [Operations Bible § Ciclo del día] para cómo D5 (turno) define el ritmo operativo.

---

### D1 — fetch() directo en vez del SDK de Supabase [HECHO]

**Problema que resolvía:** El SDK `@supabase/supabase-js` causa hangs indefinidos en rutas API de Next.js (entorno serverless). En producción, las rutas simplemente se cuelgan sin error visible, sin timeout, y sin que el cliente reciba respuesta. Esto no es un bug conocido y corregido — es un comportamiento del SDK en contextos donde el cliente JS asume que corre en un browser.

**Alternativas consideradas:**
- SDK de Supabase con cliente server-side → hang en producción. Descartado.
- SDK de Supabase en modo `createClient` por request → misma superficie de problema. Descartado.
- `fetch()` directo a la API REST de PostgREST/RPC → funciona. Elegido.

**Por qué se eligió fetch() directo:**
Control explícito de cada request. Sin dependencias de estado que persistan entre requests serverless. Sin magic que oculte el comportamiento real.

**Tradeoffs:**
- Más verboso: URL-building manual, parsing de respuestas JSON, manejo de errores explícito.
- Sin tipos automáticos de Supabase en las responses (se perdió el type safety del SDK).
- Más frágil a cambios de API de Supabase (aunque PostgREST es estable).

**Cuándo replantear:** Si Supabase publica una versión del SDK explícitamente diseñada para entornos Edge/serverless con garantías de no-hang, y hay evidencia de que funciona en Next.js API routes bajo carga. No antes.

**Ubicación:** `docs/DECISIONS.md`, preferencia en CLAUDE.md. Aplicado en todos los API routes de `src/app/api/`.

---

### D2 — Transaction A y B como operaciones separadas [HECHO]

**Problema que resolvía:** En la primera arquitectura, guardar una orden y deducir inventario era una sola transacción. Si la deducción de inventario fallaba (error de receta, existencia insuficiente, timeout de Supabase), el cobro también se revertía. En un restaurante, esto significa que el mesero cobra, el sistema dice "error", el cliente ya se fue, y no hay registro de la venta.

**Alternativas consideradas:**
- Transacción única A+B con rollback → si B falla, A se revierte. El pago "no ocurrió" para el sistema, pero el cliente ya pagó. Inaceptable.
- A+B sin transacción, sin separación → duplicados posibles si el cliente reintenta. Inaceptable.
- A comprometida, B retryable independiente → elegido.

**Por qué se eligió la separación:**
El cobro es primario. El inventario es secundario y correctable. Si el inventario queda inexacto, puede corregirse con un ajuste. Si el cobro se pierde, no hay forma de recuperarlo confiablemente.

**Tradeoffs:**
- El inventario puede quedar temporalmente inexacto (PENDING o BLOCKED).
- Se necesita lógica de catch-up (si B falló, ¿cuándo se reintenta?).
- El estado de la orden tiene dos componentes independientes: el financiero (Transaction A) y el operativo de inventario (Transaction B).

**Cuándo replantear:** Si el modelo cambia a Event Sourcing completo (Opción C del ADR-CONCURRENCY), donde ambas operaciones se derivan del mismo evento y la reconciliación es eventual por diseño. Esto requiere equipo de 3+ devs y más de 50 restaurantes.

**Ubicación:** `docs/DECISIONS.md 2026-06-30`, `save-order/route.ts` líneas 121-218.
→ Ver [Engineering Bible § Transaction A/B] para el análisis técnico detallado.

---

### D3 — Offline-first con IndexedDB y sync queue explícita [HECHO]

**Problema que resolvía:** Los restaurantes en México tienen internet inestable. Cortes frecuentes de 2-15 minutos durante el servicio. Un POS que se detiene cuando falla el router no es viable.

**Alternativas consideradas:**
- Sin offline → restaurante paralizado sin internet. Descartado.
- Service Worker con cache de red → funciona para lecturas, complejo para mutaciones. El Service Worker no tiene acceso directo a IndexedDB, no puede manejar conflictos de revisión, y el ciclo de vida del SW es no-determinista bajo iOS Safari. Descartado.
- IndexedDB con sync queue explícita → control total sobre qué se reintenta, qué tiene conflictos, y cómo se resuelven. Elegido.

**Por qué se eligió IndexedDB con sync queue:**
Visibilidad completa del estado offline. El desarrollador escribe cada operación que puede fallar offline explícitamente en la queue. No hay magia. Los conflictos son detectables y clasificables.

**Tradeoffs:**
- El desarrollador es responsable de todo el ciclo de sync. Cada nueva operación offline requiere decisión consciente de qué transport usar (APP_API vs SUPABASE_REST).
- El menú y el inventario en IndexedDB pueden estar desactualizados si hubo cambios mientras estaba offline.
- No hay sync de lectura (el POS no puede ver órdenes nuevas de otros terminales mientras está offline).

**Cuándo replantear:** Si el equipo crece a 3+ devs y hay tiempo para diseñar un Service Worker que maneje mutaciones con gestión de conflictos robusta, o si se adopta una librería de sync (como ElectricSQL o PowerSync) que resuelva el problema de forma declarativa.

**Ubicación:** `src/lib/pos-offline-db.ts`, `src/lib/offline-sync.ts`.
→ Ver [Engineering Bible § Offline-first y sync_queue] para el análisis técnico.

---

### D4 — Electron como shell de escritorio, no app nativa [HECHO]

**Problema que resolvía:** Las impresoras térmicas de restaurante (Epson, Star) usan ESC/POS sobre TCP/IP (puerto 9100) o USB. Una PWA corriendo en Chrome no puede hacer conexiones TCP arbitrarias por restricciones de seguridad del browser. Sin impresión, no hay comandas a cocina ni tickets al cliente.

**Alternativas consideradas:**
- App nativa iOS → ciclo de publicación en App Store (días/semanas), sin soporte de USB directo, requiere hardware Apple. Descartado.
- App nativa Android → fragmentación de hardware, mismo problema de ciclo de publicación. Descartado.
- Impresión cloud (enviar comandos a un servidor que imprime) → latencia de 15s+ inaceptable para comandas de cocina. Descartado.
- Electron que carga la PWA y expone el print bridge → elegido.

**Por qué se eligió Electron:**
La PWA ya existe y funciona. Electron es un wrapper fino que agrega acceso a puertos TCP/USB. El print bridge corre como servidor HTTP en localhost:7717 y la PWA le habla vía fetch() sin restricciones de CORS (mismo origen). Cero cambios en el código del POS para soportar impresión.

**Tradeoffs:**
- Electron tiene overhead de memoria (~150MB base) por terminal.
- Las actualizaciones de la app requieren proceso de distribución del `.exe`/`.dmg`.
- La app de Electron carga desde Vercel URL (deuda L1: sin offline boot).
- Si Electron no puede cargar la URL al arrancar, el POS no funciona.

**Cuándo replantear:** Con Fase 3 (offline boot), el bundle de Next.js va dentro del `.asar` de Electron. Si en algún momento existe una API de browser para conexiones TCP arbitrarias (Web Serial para USB ya existe, WebSockets con TCP para ESC/POS no), se podría eliminar Electron para impresión.

**Ubicación:** `electron-app/main.js`, `print-bridge/bridge.js`.
→ Ver [Engineering Bible § Print Bridge] para el protocolo ESC/POS.
→ Ver [POS Bible § Impresión y comandas] para cuándo y qué se imprime.

---

### D5 — Turno obligatorio en cada orden [HECHO]

**Problema que resolvía:** Sin turno, no hay forma de auditar quién fue el cajero responsable de un cobro, cuándo ocurrió dentro de un período, ni de hacer el arqueo de caja al final del día. Eduardo (gerente de AMALAY) identificó esto como el requisito anti-fraude más importante: si alguien puede cobrar sin que quede vinculado a un turno y un cajero, puede cobrar "al bolsillo" sin registro.

**Alternativas consideradas:**
- Turno opcional → las órdenes sin turno no pueden auditarse. El arqueo de caja es imposible. Descartado.
- Turno global único por restaurante → no escala a múltiples terminales. Si el turno falla, ninguna terminal puede operar. Descartado.
- Turno por terminal (elegido) → cada terminal tiene su propio turno. Múltiples terminales pueden operar simultáneamente. Si una terminal falla, las otras continúan.

**Por qué se eligió turno por terminal:**
Compatible con multi-terminal futuro. Auditabilidad completa (cada venta vinculada a un cajero en un período específico). Permite arqueos parciales por terminal.

**Tradeoffs:**
- TurnoGate bloquea el POS si no hay turno abierto → si el módulo de turnos tiene un bug, el restaurante no puede operar. Alta disponibilidad requerida.
- El fondo inicial no se puede editar después de abrir el turno (errores → depósito/retiro). Curva de aprendizaje para el staff.
- El cierre de turno requiere que todas las órdenes estén cerradas y la sync_queue vacía. Puede bloquear el cierre si hay ítems pendientes.

**Cuándo replantear:** Nunca la decisión de fondo (audit trail es no-negociable). Posiblemente el mecanismo de TurnoGate si el equipo implementa un modo de emergencia donde se puede operar temporalmente sin turno y registrar las ventas retroactivamente.

**Ubicación:** `src/components/pos/TurnoGate.tsx`, `docs/DECISIONS.md 2026-06-30`.
→ Ver [Operations Bible § Apertura de turno] para el flujo operativo del cajero.
→ Ver [Domain Bible § Shift/Turno] para el schema de pos_turnos.

---

### D6 — OCC (expected_revision) en vez de locks pesimistas [HECHO]

**Problema que resolvía:** En un sistema offline-first, los locks distribuidos son inviables. Un lock requiere que el servidor sepa que el cliente tiene el lock y que el cliente devuelva el lock al terminar. Si el cliente está offline 30 minutos, el lock quedaría retenido indefinidamente, bloqueando a todos los demás.

**Alternativas consideradas:**
- Locks pesimistas (SELECT FOR UPDATE en PostgreSQL) → bloquean operaciones concurrentes. Con offline, un lock puede quedar retenido indefinidamente. Inaceptable.
- Sin control de concurrencia → last-write-wins, pérdida silenciosa de modificaciones. Inaceptable en un sistema financiero.
- CRDT (Conflict-free Replicated Data Types) → apropiado para texto colaborativo, complejo para datos financieros con semántica de negocio específica. Overkill.
- OCC con expected_revision → elegido.

**Por qué se eligió OCC:**
Funciona correctamente con offline: la operación offline procede localmente con el último `revision` conocido. Al reconectar, el replay detecta si alguien más modificó la orden (revision no coincide) y retorna STALE_WRITE_CONFLICT. Sin locks, sin bloqueos, sin timeouts.

**Tradeoffs:**
- Los STALE_WRITE_CONFLICT son esperables y el sistema debe manejarlos explícitamente.
- Con un solo terminal (AMALAY hoy), los conflictos son raros. Con multi-terminal, serán frecuentes.
- No hay resolución automática de conflictos — requiere intervención del operador.

**Cuándo replantear:** Si se normaliza `pos_orders.items` a `pos_order_items` (Opción B), los conflictos se vuelven más granulares (por ítem, no por orden completa) y menos frecuentes. El mecanismo de OCC sigue siendo válido.

**Ubicación:** `src/app/api/pos/save-order/route.ts`, RPC `r1_save_order`.
→ Ver [Engineering Bible § OCC + expected_revision] para el análisis técnico.

---

### D7 — save_operation_id para idempotencia de pagos [HECHO]

**Problema que resolvía:** OCC solo no es suficiente para replay offline. Considera este escenario: el mesero cobra, la operación va a sync_queue (offline), al reconectar el sistema hace replay. Si la red falla durante el replay (después de que el servidor procesó pero antes de que retornara 200), el cliente no sabe si el pago ocurrió. Sin idempotencia, el retry duplica el pago.

**Alternativas consideradas:**
- OCC solo (sin save_operation_id) → el replay puede duplicar el pago si la red falla durante el reply. Inaceptable para operaciones financieras.
- Marcar la orden como "pagada" en el cliente antes del reply del servidor → introduce un estado inconsistente que es difícil de reconciliar. Descartado.
- save_operation_id + tabla pos_save_operations → el servidor reconoce el ID y retorna el resultado original sin re-ejecutar. Elegido.

**Por qué se eligió save_operation_id:**
El cliente genera el ID antes de enviar el request. Si el servidor ya procesó este ID, retorna el resultado original (idempotent_replay: true) sin ejecutar nuevamente. El cliente puede reintentar indefinidamente sin riesgo de duplicar el pago.

**Tradeoffs:**
- Requiere que el cliente genere y persista el save_operation_id antes del request.
- La tabla pos_save_operations crece indefinidamente (necesita TTL o archivado).
- Las requests sin save_operation_id (legacy) no tienen esta protección — solo tienen OCC.

**Cuándo replantear:** Si se migra a Event Sourcing completo, donde la idempotencia se garantiza a nivel de evento (event_id único) en vez de a nivel de operación de save.

**Ubicación:** `src/app/api/pos/save-order/route.ts` (verificación del ID), RPC `r1_save_order_idempotent`.
→ Ver [Engineering Bible § Idempotencia y save_operation_id] para el análisis técnico.

---

### D8 — 503 INVENTORY_POSTPROCESS_RETRYABLE: Transaction B no revierte A [HECHO]

**Problema que resolvía:** ¿Qué pasa cuando r1_reconcile_order falla con un error de servidor (503, timeout, error de red)? La primera versión del código hacía que este error produjera un fallo en el endpoint completo, lo que desde la perspectiva del cliente parecía que el pago no había ocurrido. Pero el pago sí había ocurrido (Transaction A fue exitosa). El cliente reintentaba, y el pago se duplicaba.

**Alternativas consideradas:**
- Hacer que el fallo de B falle el endpoint completo → cliente interpreta como fallo del cobro, reintenta, duplica el cobro. Inaceptable.
- Usar una transacción de base de datos que incluya A y B → si B falla, A se revierte. El cobro se pierde aunque el cliente pagó físicamente. Inaceptable.
- A comprometida, B marcada como PENDING y retryable → el cobro ocurrió, el inventario se reconcilia después. Elegido.

**Por qué se eligió:**
El cobro es primario. La reconciliación de inventario es un proceso secundario que puede fallar y reintentarse sin consecuencias financieras. El `inventory_status: PENDING` indica que la reconciliación no completó, no que el cobro falló.

**Tradeoffs:**
- El inventario puede quedar temporalmente inexacto (pendiente de reconciliar).
- El sistema necesita un mecanismo de catch-up para reconciliaciones pendientes (hoy: el retry del cliente en el replay de sync_queue; pendiente: job background que reintente PENDING).
- La distinción entre "pago falló" y "inventario PENDING" debe ser clara en el UX para el operador.

**Cuándo replantear:** Si se implementa un worker background que reintente reconciliaciones PENDING automáticamente, el tradeoff cambia: el inventario converge eventualmente sin intervención manual, pero se agrega complejidad de infraestructura.

**Ubicación:** `src/app/api/pos/save-order/route.ts` líneas 155-217. El nombre INVENTORY_POSTPROCESS_RETRYABLE viene del comentario en el código.
→ Ver [Engineering Bible § Transaction A/B] para el análisis completo de esta arquitectura.

---

## Reglas de negocio transversales

Reglas que aplican a TODA la stack, no a un módulo específico. Violarlas produce bugs que son difíciles de diagnosticar porque se manifiestan en capas distintas a donde se originan.

→ Ver [Engineering Bible § Principios de concurrencia] para R3, R4, R6 en profundidad.
→ Ver [Domain Bible § Invariantes de entidades] para las reglas por entidad individual.
→ Ver [Product Vision Bible § Invariantes] para el razonamiento de producto detrás de cada regla.

### R1 — client_id en cada operación [HECHO]

Cada operación que toca datos en Supabase lleva `client_id`. Este campo es el aislamiento multi-tenant. Sin él, un restaurante puede ver datos de otro.

El `client_id` viene de `getClientId(request)` (`src/lib/api-auth.ts`): lee el header `x-client-id` o la variable de entorno `NEXT_PUBLIC_CLIENT_ID`. Las RPCs de Supabase validan `p_client_id` contra la fila existente.

[INFERENCIA] RLS policies en las tablas refuerzan esto a nivel de base de datos. Cobertura completa pendiente de auditoría formal.

### R2 — turno_id obligatorio en cada orden [HECHO]

Una orden sin `turno_id` no puede existir. TurnoGate (`src/components/pos/TurnoGate.tsx`) verifica que hay un turno abierto antes de habilitar el POS. Si el turno se cierra mientras hay órdenes abiertas, CierreCajaWizard lo detecta.

### R3 — save_operation_id para idempotencia de pagos [HECHO]

Un pago lleva `save_operation_id` generado por el cliente. Si la misma operación llega dos veces, el servidor reconoce el ID y retorna el resultado original. Garantiza que un pago nunca se duplica. Es el mecanismo más importante desde la perspectiva de integridad financiera.

### R4 — expected_revision para OCC en órdenes [HECHO]

Cada lectura de una orden devuelve su `revision` actual. Cada escritura envía `expected_revision`. Si no coincide, la escritura se rechaza con 409 CONFLICT (STALE_WRITE_CONFLICT).

### R5 — Transaction B nunca bloquea Transaction A [HECHO]

Si r1_reconcile_order falla, la orden queda guardada. El bloque try/catch alrededor de Transaction B en `save-order/route.ts` lo garantiza.

### R6 — STALE_WRITE_CONFLICT nunca se reintenta automáticamente [HECHO]

Un conflicto de revisión requiere intervención del operador. El sistema preserva el payload, marca el ítem, y no sobreescribe el servidor. Ver `syncAll()` en `pos-offline-db.ts`.

### R7 — Supabase SDK no se usa en Next.js [HECHO]

Toda llamada a Supabase desde Next.js usa `fetch()` directo. El SDK causa hangs en producción. Esta regla se aplica en todos los API routes existentes.

---

## Estados del sistema

### Estado del turno

| Estado | Significado | Transición |
|---|---|---|
| `sin_turno` | No hay turno abierto en este terminal | → `abierto` al abrir turno |
| `abierto` | Turno activo, operación normal | → `cerrado` al cerrar |
| `cerrado` | Turno cerrado, inmutable | No se puede reabrir — se crea uno nuevo |

[HECHO — decisión en DECISIONS.md 2026-06-30]

### Estado de la sync_queue

| Estado | `synced` | `error_class` | Significado |
|---|---|---|---|
| `pending` | false | null | Esperando sync, reintentable |
| `synced` | true | null | Sincronizado exitosamente |
| `stale_conflict` | false | STALE_WRITE_CONFLICT | Terminal — requiere intervención manual |
| `terminal_error` | false | TERMINAL_NON_RETRYABLE | Terminal — payload corrupto o rechazado |
| `retrying` | false | null | retries > 0, seguirá reintentando |

[HECHO]

### Estado del sistema de conexión

| Estado | `navigator.onLine` | Comportamiento |
|---|---|---|
| `online` | true | Operación normal, sync inmediata |
| `offline` | false | POS continúa, operaciones → sync_queue |
| `syncing` | true | syncAllRunning = true, no lanzar segundo sync |

[HECHO]

### Estado del print bridge

| Estado | Significado |
|---|---|
| `conectado` | Bridge escuchando en :7717, impresoras respondiendo |
| `desconectado` | Bridge no responde o proceso caído |
| `impresora_error` | Bridge activo pero impresora no responde (TCP timeout) |
| `cola_atascada` | Trabajos en cola sin enviar |

⚠️ DISCREPANCIA: `docs/reference/BRIDGE.md` lista la observabilidad del bridge como "Por validar" — los indicadores de estado visual en el dashboard están marcados como requeridos pero no confirmados como implementados. No asumir que existen. [PENDIENTE de verificación]

---

## Source of Truth — mapa global

→ Ver [Dashboard Bible § Source of Truth] para el mapa específico de qué tabla alimenta cada visualización.
→ Ver [Domain Bible § Schema de tablas] para el schema completo de cada tabla listada aquí.
→ Ver [Engineering Bible § Offline-first] para cómo las réplicas en IndexedDB se mantienen en sync.

| Dato | Source of Truth | Réplica(s) | Notas |
|---|---|---|---|
| Estado de la orden | `pos_orders` (Supabase) | IndexedDB [orders] | La réplica se descarta al sync exitoso [HECHO] |
| Ítems de la orden | `pos_orders.items` (JSONB) | IndexedDB [orders] | JSON monolítico — normalización pendiente post-cutover [HECHO actual, PENDIENTE normalización] |
| Turno activo | `pos_turnos` (Supabase) | `localStorage` (turno_id) | localStorage como caché de acceso rápido [HECHO] |
| Stock de ingrediente | `pos_inventory` (Supabase) | — | Sin réplica offline — lectura online requerida [HECHO/PENDIENTE offline] |
| Menú (platillos) | Supabase (tabla de menú) | IndexedDB [menu] | Se cachea para offline [HECHO] |
| Operaciones pendientes | IndexedDB [sync_queue] | — | Solo en cliente, se vacía al sincronizar [HECHO] |
| Recetas | `pos_recipes` (Supabase) | — | Sin caché offline [HECHO] |
| Staff / PIN | `pos_staff` (Supabase) | `/api/pos/staff-cache` | Cache de PINs para autenticación offline [HECHO] |
| Config del cliente | `clients` (Supabase) | `client-config.ts` | Config en memoria por sesión [HECHO] |
| Eventos del sistema | `pos_events` (Supabase) | — | Append-only, nunca se actualiza [HECHO] |
| Ventas históricas (Wansoft) | `wansoft_daily` (Supabase) | — | Scraper deposita aquí el histórico [HECHO] |
| KPIs en tiempo real (Wansoft) | `wansoft_kpis` (Supabase) | — | Fila única actualizada continuamente [HECHO] |
| Operaciones idempotentes | `pos_save_operations` (Supabase) | — | Registro de save_operation_id ya procesados [HECHO] |

---

## Flujos principales del sistema completo

→ Ver [POS Bible § Flujos principales] para el detalle de cada paso desde la perspectiva del mesero.
→ Ver [Operations Bible § Ciclo del día] para el contexto operativo de apertura, servicio, y cierre.
→ Ver [Engineering Bible § Sync y conflictos] para el análisis técnico de los flujos offline.

### Flujo 1: Una orden completa (inicio a fin)

```
APERTURA DEL TURNO [HECHO]
  Staff → autenticación PIN o huella HID
  TurnoGate verifica turno abierto en pos_turnos
  Si no hay turno → CierreCajaWizard → abrir turno con fondo inicial
  Evento: shift.opened en pos_events

TOMAR LA ORDEN [HECHO]
  Mesero selecciona mesa → POS crea orden con order_id (UUID cliente)
  Cada ítem → estado React + IndexedDB [orders]
  Orden: order_id, client_id, turno_id, mesero, mesa, items[]
  Cada ítem: id, nombre, precio, modificadores, seat_id, kds_status

ENVIAR A COCINA [HECHO]
  Mesero presiona "Enviar" → POST /api/pos/save-order (Transaction A)
  items con kds_status="pending" → batch nuevo en comanda_batches
  Print Bridge recibe comando → imprime comanda ESC/POS
  KDS actualiza: ítem aparece como pendiente

PREPARACIÓN EN COCINA [HECHO]
  Cocinero ve ítem en KDS → "preparando" → "listo"
  kds_status: pending → cooking → ready → served
  Actualiza pos_orders.items[n].kds_status

COBRO [HECHO]
  Mesero → forma de pago → total + IVA + IEPS + propina - descuento
  POST /api/pos/save-order con status="closed", pagos[], closed_at
  save_operation_id → exactly-once
  Transaction A: r1_save_order_idempotent → cerrado, revision++
  Transaction B: r1_reconcile_order → ingredientes deducidos
  inventory_status: COMPLETE | BLOCKED | PENDING

IMPRESIÓN Y FACTURA [HECHO → FACTURAMA PENDIENTE]
  Print Bridge → impresora cajera → ticket impreso
  QR de auto-facturación en ticket → Facturama API
  [PENDIENTE: integración Facturama activa — costo $1,650 MXN pendiente de contratar]

DASHBOARD [HECHO]
  pos_orders actualizada → visible en tiempo real en /costos, /inventario, /food-cost
```

### Flujo 2: Pago offline

```
DETECCIÓN DE OFFLINE [HECHO]
  navigator.onLine = false o fetch falla
  OfflineIndicator.tsx muestra banner visible
  POS continúa desde IndexedDB — el operador no lo nota

COBRO SIN RED [HECHO]
  Mesero cobra igual
  POST /api/pos/save-order falla → queue a IndexedDB [sync_queue]
  save_operation_id generado igual → mismo ID para replay
  Status: "pendiente de sync"

RIESGO DE CONFLICTO [HECHO — protección implementada]
  Si otro terminal toca la MISMA orden mientras este está offline:
  → expected_revision del terminal offline quedó stale
  → replay retornará STALE_WRITE_CONFLICT
  → ítem marcado en sync_queue como terminal
  → intervención manual requerida

RECONEXIÓN [HECHO]
  navigator.onLine = true → syncAll() disparado
  APP_API items → replayViaAppApi() → /api/pos/save-order
  Si ok → markSynced(), evento pos-order-synced
  Si conflict → markConflict(), sin reintento
  Transaction B corre durante replay → deducción de inventario
```

### Flujo 3: El ciclo de un día

```
7am — BRIEFING AUTOMÁTICO [HECHO]
  daily-briefing.yml (GitHub Actions)
  Lee: reservaciones del día, KPIs de ayer, alertas de inventario
  Genera narrativa con Groq/Claude → envía a Telegram

7am-9am — APERTURA [HECHO]
  Supervisor autentica → TurnoGate → abrir turno con fondo inicial
  shift.opened → pos_events

10am-10pm — OPERACIÓN [HECHO]
  Flujo 1 repetido cientos de veces
  Agentes en background (GitHub Actions):
    anomaly_detector (2pm, 4pm, 6pm MX)
    close_predictor (2pm, 4pm, 6pm MX)
    upselling_agent (2pm, 4pm, 6pm MX)
    kitchen_quality_agent (7am, 4pm, 7pm MX)
    table_time_agent (7am, 4pm, 7pm MX)

10pm-11pm — CIERRE [HECHO]
  CierreCajaWizard abierto por supervisor
  Verificar: órdenes abiertas + sync_queue pendiente
  Arqueo: efectivo declarado vs esperado
  shift.closed → turno bloqueado, corte impreso
```

---

## Invariantes del sistema completo

Lo que NUNCA puede romperse, sin excepción. Si alguno se viola, es un bug crítico.

→ Ver [Product Vision Bible § Invariantes] para el razonamiento de producto detrás de cada invariante.
→ Ver [Engineering Bible § Contratos de falla] para cómo cada invariante está protegido en el código.
→ Ver [Operations Bible § Procedimientos de emergencia] para qué hacer cuando un invariante se viola en producción.

**Invariante 1: Una orden nunca se pierde** [HECHO]
Transaction A exitosa → orden en Supabase. Si hay desconexión → sync_queue. El peor escenario es un delay, nunca una pérdida.

**Invariante 2: Un pago nunca se duplica** [HECHO]
`save_operation_id` garantiza exactly-once en `r1_save_order_idempotent`.

**Invariante 3: Transaction A nunca espera a Transaction B** [HECHO]
La reconciliación de inventario es asíncrona y su fallo no bloquea el cobro.

**Invariante 4: El staff nunca queda bloqueado por el sistema** [HECHO con excepción]
El POS continúa offline desde IndexedDB. Excepción conocida: si Electron no puede cargar la URL de Vercel al arrancar (sin internet al boot), el POS no arranca. Ver L1 en Limitaciones.

**Invariante 5: El dueño siempre puede ver qué pasó** [HECHO]
Toda acción financiera genera un registro en `pos_events` con actor, timestamp, razón. No hay opción de apagar el audit log (a diferencia de Wansoft, donde AMALAY tenía "Guardar logs" APAGADO).

**Invariante 6: Los datos del restaurante son del restaurante** [HECHO/INFERENCIA]
`client_id` en cada operación. [HECHO] en API routes. [INFERENCIA] en cobertura completa de RLS policies.

**Invariante 7: Un turno cerrado es inmutable** [HECHO]
Un turno cerrado no se modifica. Los errores se corrigen en el turno siguiente con depósito/retiro.

**Invariante 8: STALE_WRITE_CONFLICT nunca se sobreescribe automáticamente** [HECHO]
El payload se preserva y requiere resolución manual.

---

## Casos borde del sistema

→ Ver [Engineering Bible § Edge cases de sync] para el análisis técnico de cada caso.
→ Ver [POS Bible § Manejo de errores] para cómo el UX comunica estos casos al operador.
→ Ver [Operations Bible § Resolución de conflictos] para el procedimiento operativo cuando ocurren.

### Caso 1: Pago offline + doble-click [HECHO — protegido]

El `save_operation_id` es el mismo en ambos intentos. El replay de la segunda operación retorna `idempotent_replay: true` sin re-ejecutar el cobro.

### Caso 2: Pago offline + otro terminal modifica la misma orden [HECHO — detectado, no resuelto]

Result: STALE_WRITE_CONFLICT en el replay. El operador debe resolver manualmente. Mitigación operativa: AMALAY tiene 1 terminal POS — este caso no ocurre en producción hoy. Relevante para multi-terminal futuro.

### Caso 3: Cierre de turno con ítems en sync_queue [INFERENCIA]

CierreCajaWizard debería verificar el estado de sync_queue antes de permitir el cierre. [INFERENCIA] que lo hace — requiere verificación en el código del wizard.

### Caso 4: Inventario BLOCKED pero orden ya guardada [HECHO]

La orden está guardada y cobrada. El inventario puede quedar negativo si se siguen vendiendo ítems con ese ingrediente. El sistema no bloquea la venta — alerta al operador.

### Caso 5: Bridge caído durante operación [HECHO — con gap de observabilidad]

Las órdenes se guardan en Supabase. El KDS sigue actualizándose (va directo a Supabase). La impresora de papel NO recibe comandas. Si el staff depende solo del ticket impreso, hay un problema operativo. Ver D4 sobre el rol del KDS como fuente primaria.

⚠️ DISCREPANCIA: BRIDGE.md dice que la observabilidad del bridge (indicador visual de estado) está "Por validar". No asumir que el sistema detecta la caída del bridge antes de que el staff lo reporte. [PENDIENTE de validación]

### Caso 6: Supabase degradación en hora pico [HECHO — parcialmente]

Las operaciones van a sync_queue. El POS opera desde IndexedDB. El KDS pierde tiempo real. El menú en IndexedDB puede estar desactualizado si hubo cambios de precio no cacheados.

### Caso 7: Electron arranca sin internet [HECHO — deuda conocida]

La Electron App carga desde `https://dashboard-app.vercel.app`. Sin internet al boot → muestra `offline.html`. El POS no arranca. Esta es la deuda L1 documentada. [PENDIENTE Fase 3]

---

## Interacción entre módulos: el mapa completo

→ Ver [Domain Bible § Relaciones entre entidades] para el schema ER completo.
→ Ver [Dashboard Bible § Módulos] para cómo el dashboard consume las interacciones entre módulos.
→ Ver [POS Bible § Integración con inventario] para cómo Transaction B vincula el POS con el inventario.

```
POS (src/app/pos/)
    ↓ guarda orden            ↓ envía a cocina
  Supabase              Print Bridge → Impresoras
  (pos_orders)                     ↓
    ↓                         KDS (electron-kds)
  Dashboard (17 páginas)
    ↓ lee inventario
  Inventario (pos_inventory)
    ↑ deduce al cobrar (Transaction B)
    ↑ recibe al comprar (módulo compras)
    ↑
  Compras (pos/compras, /compras)
    ↑ genera OC → proveedor envía → recepción → stock up

  Recetas (pos_recipes)
    ↑ vincula ítems del menú con ingredientes
    → usadas por Transaction B para deducción
    → usadas por cost-engine para food cost

  Food Cost (/food-cost, /costos)
    ← lee pos_orders + pos_recipes + pos_inventory
    → calcula margen por platillo, por día, por categoría
    → envía alertas si food cost > umbral

  Facturación (/factura, /facturas)
    ← lee pos_orders cerradas
    → emite CFDI via Facturama API [PENDIENTE]
    → genera factura global mensual

  Agentes IA (GitHub Actions)
    ← leen wansoft_daily, pos_orders, pos_inventory
    → envían a Telegram
    → log en agent_runs

  Turnos (pos_turnos, TurnoGate)
    → requerido por pos_orders (turno_id obligatorio)
    → usado por CierreCajaWizard para cierre
    → usado por corte de caja para arqueo

  Staff / Permisos (pos_staff)
    → autenticación por PIN en TurnoGate
    → permisos granulares por acción (269 líneas)
    → cacheado para autenticación offline
```

---

## Limitaciones actuales del sistema completo

**L1 — Sin offline boot en Electron** [PENDIENTE — Fase 3]
La Electron App carga desde `https://dashboard-app.vercel.app`. Sin internet al arrancar la terminal, el POS no carga. Dentro de una sesión activa, el offline-first funciona. Pero un reinicio sin red es un blocker operativo.

**L2 — Inventario sin réplica offline** [PENDIENTE — Fase 2]
El stock de ingredientes no tiene réplica en IndexedDB. Si el POS cobra sin red, Transaction B corre después al reconectar, con datos potencialmente stale.

**L3 — pos_orders.items como JSON monolítico** [HECHO actual, PENDIENTE normalización]
Los ítems de cada orden viven en JSONB en una sola fila. Con AMALAY (1 terminal) funciona. Con múltiples terminales modificando la misma orden, la frecuencia de OCC conflicts aumenta. Normalización a `pos_order_items` planeada para post-cutover. [Ver DECISIONS.md 2026-06-30]

**L4 — RLS sin auditoría completa** [INFERENCIA — PENDIENTE validación formal]
El aislamiento multi-tenant usa `client_id` en todas las operaciones, pero la cobertura completa de RLS policies requiere auditoría antes del segundo cliente. [Ver Fase 4 del roadmap]

**L5 — Sin producción de panadería/batch cooking** [PENDIENTE — pre-500 restaurantes]
El módulo de producción (órdenes de producción, subrecetas, rendimiento de batch) no está implementado. AMALAY tiene panadería. Por ahora, la deducción es por ítem vendido, no por producción previa.

**L6 — Sin transferencias entre sucursales** [PENDIENTE — pre-cadenas]
Para grupos con más de 1 sucursal, las transferencias de inventario son necesarias. No implementado.

**L7 — Facturama no contratado** [PENDIENTE — blocker de cutover]
La integración de CFDI está diseñada y code-ready pero Facturama no está activo ($1,650 MXN pendiente). Sin esto, no se pueden emitir facturas electrónicas desde Fullsite.

**L8 — Observabilidad del bridge sin validar** [PENDIENTE — ver BRIDGE.md]
Los indicadores de estado del bridge (conectado/desconectado, errores de impresora) están diseñados pero no confirmados como implementados.

---

## Roadmap del sistema

→ Ver [Product Vision Bible § Roadmap] para el razonamiento de producto detrás de cada fase.
→ Ver [Engineering Bible § Deuda técnica] para el análisis técnico de cada deuda listada.

### Fase 2 — Inventario server-side + KDS local-first (próxima)

- Cache offline de inventario en IndexedDB con delta-sync
- Normalización de `pos_orders.items` a `pos_order_items`
- KDS V2 con arquitectura local-first
- P&L automático mensual (datos ya existen, falta consolidación)

**Prioridad:** Alta — necesario antes del segundo restaurante.

### Fase 3 — Offline boot (Electron desde bundle local)

- Build de Next.js embebido en el paquete de Electron
- Electron carga desde bundle local, no desde Vercel URL
- Hot-reload del bundle cuando hay internet

**Prioridad:** Crítica antes de escalar a restaurantes con internet inestable.

### Fase 4 — Tenant isolation (Device JWT + RLS)

- Device JWT firmado por Supabase — `client_id` baked in el token
- RLS policies que leen `client_id` del JWT, no del payload
- Auditoría completa de todas las políticas RLS

**Prioridad:** Crítica antes del onboarding del segundo cliente en producción.

---

## Lo que un ingeniero nuevo hace su primer lunes

### Antes de tocar código

1. Lee este documento completo. [~60 min]
2. Lee `docs/DECISIONS.md`. [~30 min]
3. Lee `docs/reference/EVENT-STORE.md`. [~20 min]
4. Lee `docs/reference/BRIDGE.md`. [~15 min]
5. Abre `src/app/api/pos/save-order/route.ts` y léelo línea por línea. [~20 min]
6. Abre `src/lib/pos-offline-db.ts` y entiende el ciclo de sync. [~20 min]

### Para hacer el primer cambio

1. Identifica el módulo que vas a tocar (POS, dashboard, inventario, etc.).
2. Lee la Bible del módulo correspondiente.
3. Antes de escribir código, verifica: ¿la decisión que estás tomando ya está en `docs/DECISIONS.md`? Si sí, respétala. Si la vas a cambiar, documenta por qué.
4. Escribe el código. Prueba localmente.
5. Verifica en staging o producción antes de declarar [HECHO].
6. Actualiza la Bible del módulo. Si cambia la arquitectura del sistema, actualiza el Master Bible.

### Lo que nunca debes hacer

- Importar `@supabase/supabase-js` en un API route de Next.js. Usa `fetch()` directo.
- Agregar features sin evidencia operativa de que importan. Si no hay 100 restaurantes pidiéndolo → parking lot.
- Cerrar un bug sin reproducirlo antes y después.
- Declarar algo [HECHO] sin haberlo verificado en producción.
- Reabrir un turno cerrado. Los turnos son inmutables.
- Sobreescribir un STALE_WRITE_CONFLICT automáticamente.

---

## Guía de lectura — cómo usar las Bibles

| Si quieres entender... | Lee... | Sección |
|---|---|---|
| Cómo tomar una orden en el POS | POS Bible | § Flujos principales |
| Cómo funciona el pago mixto | POS Bible | § Cobro y formas de pago |
| Por qué Transaction A y B | Engineering Bible | § Principios de concurrencia |
| Cómo funciona OCC en detalle | Engineering Bible | § OCC + expected_revision |
| Cómo funciona el offline sync | Engineering Bible | § Offline-first y sync_queue |
| Qué es una entidad Order | Domain Bible | § Order |
| Qué es una entidad Recipe | Domain Bible | § Recipe |
| Cómo opera el restaurante de apertura a cierre | Operations Bible | § Ciclo del día |
| Cómo entrenar al staff nuevo | Operations Bible | § Onboarding de staff |
| Por qué existe Fullsite | Product Vision Bible | § Tesis |
| Qué nunca vamos a construir | Product Vision Bible | § Parking lot |
| Módulos del dashboard | Dashboard Bible | § Módulos |
| Cómo funciona el food cost | Dashboard Bible | § Food Cost |
| Por qué Wansoft sobrevivió 20 años | `docs/strategy/WANSOFT-BIBLE.md` | § 1 |
| Qué decidimos y por qué | `docs/DECISIONS.md` | (completo) |
| Cómo piensa Daniel | `docs/FOUNDER.md` | (completo) |

---

## Glosario de términos Fullsite

**Transaction A**
La operación de guardar una orden en Supabase. Incluye OCC (revisión) e idempotencia. Su éxito garantiza que la venta quedó registrada. RPCs: `r1_save_order` y `r1_save_order_idempotent`.

**Transaction B**
La reconciliación de inventario que corre después de Transaction A. Deduce ingredientes de recetas. Su fallo no revierte el cobro. RPC: `r1_reconcile_order`.

**save_operation_id**
ID único generado por el cliente para cada operación de pago. Garantiza exactly-once. Almacenado en `pos_save_operations`.

**expected_revision**
El número de revisión que el cliente cree que tiene la orden. Se envía con cada write. Si no coincide con el servidor, la operación se rechaza (OCC).

**OCC (Optimistic Concurrency Control)**
El mecanismo de `expected_revision`. Permite writes concurrentes sin locks, detectando conflictos en el commit.

**STALE_WRITE_CONFLICT**
Error class asignado a un SyncQueueItem cuando el servidor rechazó la escritura por OCC. Terminal — no se reintenta automáticamente.

**TERMINAL_NON_RETRYABLE**
Error class para fallos por payload corrupto o entidad no encontrada. No tiene sentido reintentar.

**TRANSIENT_RETRYABLE**
Error class para fallos de red o 5xx temporales. El sistema reintenta hasta 5 veces.

**SyncQueueItem**
Ítem en IndexedDB [sync_queue]. Representa una operación que no pudo sincronizarse en tiempo real. Campos: id, table, method, data, endpoint, transport, retries, error_class, error_detail, server_revision.

**ReplayTransport**
El mecanismo de replay de un SyncQueueItem. `APP_API`: va por `/api/pos/save-order` (respeta OCC + idempotencia). `SUPABASE_REST`: va directo a PostgREST (datos no-reconciliación).

**error_class**
El tipo de error de un SyncQueueItem: `TRANSIENT_RETRYABLE` | `STALE_WRITE_CONFLICT` | `TERMINAL_NON_RETRYABLE`.

**TurnoGate**
Componente React que bloquea el acceso al POS si no hay turno abierto. Verifica `pos_turnos` al cargar. Archivo: `src/components/pos/TurnoGate.tsx`.

**client_id**
El identificador del tenant (restaurante). Presente en cada operación. Eje del aislamiento multi-tenant.

**turno_id**
El identificador del turno de caja activo. Obligatorio en cada orden creada.

**Print Bridge**
Proceso Node.js en `localhost:7717`. Recibe comandos HTTP del POS y los traduce a ESC/POS para impresoras térmicas vía TCP/IP o USB. Archivo: `print-bridge/bridge.js`.

**comanda batch**
Grupo de ítems enviados a cocina en una sola operación. Cada "Enviar" crea un batch nuevo. Almacenado en `pos_orders.comanda_batches`.

**inventory_status**
Resultado de Transaction B: `COMPLETE` | `BLOCKED` | `PENDING` | `SKIPPED`.

**Event Store**
La tabla `pos_events` en Supabase. Append-only. Registra todo: órdenes, ítems, pagos, turnos, errores. Fundación de la inteligencia operativa.

**shadow mode**
El período donde el Event Store captura eventos de Wansoft pero Wansoft sigue siendo la fuente de verdad. Activo desde 2026-06-12.

**cutover**
El momento en que Fullsite POS reemplaza a Wansoft. La fuente de verdad pasa de Wansoft a Supabase.

**CierreCajaWizard**
Wizard de cierre de turno. Verifica órdenes abiertas, sync_queue pendiente, arqueo de efectivo. Archivo: `src/components/pos/CierreCajaWizard.tsx`.

**pos_events**
Tabla append-only del Event Store. Campos clave: `event_id` (UNIQUE para idempotencia), `stream_id`, `event_type`, `payload`, `actor`, `source`.

**HECHO**
Implementado y verificado en producción o staging validado.

**INFERENCIA**
Basado en lectura de código o diseño. No verificado end-to-end.

**PENDIENTE**
Diseñado o planeado, no implementado todavía.

**Prueba del viernes a las 8pm**
El estándar de calidad de Daniel: si algo no funciona sin fricción durante el servicio del viernes en la noche (hora pico, alta carga, meseros estresados), no está listo para producción.

**Wansoft exit mindset**
El principio de diseño de producto: construir parity con Wansoft primero, luego mejorar. No agregar features que Wansoft no tiene hasta que la parity esté completa y la operación sea estable.

**INVENTORY_POSTPROCESS_RETRYABLE**
Clase de error que indica que Transaction B falló pero la orden está guardada. El sistema puede reintentar la reconciliación.

---

## Índice de archivos críticos

| Archivo | Propósito |
|---|---|
| `dashboard-app/src/app/api/pos/save-order/route.ts` | El endpoint más crítico. Transaction A + B. OCC + idempotencia. Toda orden pasa por aquí. |
| `dashboard-app/src/lib/pos-offline-db.ts` | Motor de offline-first. IndexedDB schema, sync queue, syncAll(), resolución de conflictos. |
| `dashboard-app/src/lib/offline-sync.ts` | Complemento de offline. Registro automático de sync en reconexión. |
| `dashboard-app/src/app/pos/page.tsx` | POS principal. Selección de mesa, captura de orden, cobro. |
| `dashboard-app/src/app/pos/layout.tsx` | Layout del POS. Monta TurnoGate, StaffShiftPanel, verificación de turno. |
| `dashboard-app/src/components/pos/TurnoGate.tsx` | Gate de autenticación de turno. Sin turno abierto, sin POS. |
| `dashboard-app/src/components/pos/CierreCajaWizard.tsx` | Wizard de cierre. Verifica sync_queue y órdenes abiertas antes de cerrar. |
| `dashboard-app/src/components/pos/OfflineIndicator.tsx` | Banner visual de estado offline. |
| `dashboard-app/src/app/pos/kds/page.tsx` | KDS (Kitchen Display System). Vista de órdenes en cocina. |
| `dashboard-app/src/lib/api-auth.ts` | `getClientId()`. Extrae client_id. Primero llamado en toda API route. |
| `dashboard-app/src/lib/pos-calculations.ts` | Cálculos de IVA, IEPS, totales, descuentos. Lógica fiscal. |
| `dashboard-app/src/lib/printer.ts` | Cliente del print bridge. Envía comandos HTTP a :7717. |
| `dashboard-app/src/lib/client-config.ts` | Config multi-tenant. Lee settings del restaurante desde Supabase. |
| `dashboard-app/src/lib/cost-engine.ts` | Motor de food cost. Costo por receta, margen por platillo. |
| `dashboard-app/src/app/api/pos/pin/route.ts` | Auth de staff. Verifica PIN de 4 dígitos contra pos_staff. |
| `dashboard-app/src/app/api/pos/staff-cache/route.ts` | Cache de PINs del staff para autenticación offline. |
| `print-bridge/bridge.js` | Bridge de impresión. Node.js en :7717. ESC/POS a TCP/USB. |
| `electron-app/main.js` | Electron shell del POS. Carga la PWA en ventana de escritorio. |
| `electron-kds/main.js` | Electron shell del KDS. Pantalla dedicada para cocina/barra. |
| `dashboard-app/supabase/` | Migraciones SQL. Schema de Supabase. RPCs r1_save_order, r1_reconcile_order. |
| `.github/scripts/` | Agentes IA Python. daily_briefing, anomaly_detector, antifraud, etc. |
| `docs/strategy/WANSOFT-BIBLE.md` | La biblia de referencia. 20 años de conocimiento operativo. |
| `docs/DECISIONS.md` | Registro histórico de decisiones. Consultar antes de cualquier decisión de arquitectura. |
| `docs/reference/BRIDGE.md` | Especificación técnica del print bridge. Idempotencia, recovery, observabilidad. |
| `docs/reference/EVENT-STORE.md` | Schema y semántica del Event Store. Tipos de eventos, reconciliación. |

---

## Cómo contribuir a las Bibles

### Cuándo actualizar

- **Master Bible:** cuando cambia la arquitectura del sistema completo.
- **Bible de módulo:** cuando cambia el módulo (nuevo flujo, nuevo edge case).
- **DECISIONS.md:** inmediatamente después de cualquier decisión de arquitectura significativa.
- **Nunca:** retrasar "para cuando haya tiempo". Las Bibles se actualizan el mismo día del cambio.

### Marcadores obligatorios

- `[HECHO]` — Implementado y verificado. Tienes evidencia.
- `[INFERENCIA]` — Basado en código o diseño. No verificado end-to-end.
- `[PENDIENTE]` — Diseñado o planeado, no implementado.
- `⚠️ DISCREPANCIA [fecha]` — Contradicción entre documentación y código, o entre dos documentos.

### Cómo documentar discrepancias

```
⚠️ DISCREPANCIA [fecha]
  Documento dice: [lo que dice el documento]
  Código dice: [lo encontrado en el código, con ruta de archivo y línea]
  Impacto: [qué significa esta diferencia]
  Pendiente: [quién debe resolver y cuándo]
```

### Quién aprueba cambios

Daniel aprueba cambios al Master Bible y a DECISIONS.md. Cambios a Bibles de módulo los puede aprobar cualquier ingeniero con contexto operativo del módulo. Si el cambio afecta un invariante o una decisión en DECISIONS.md → requiere aprobación de Daniel.

---

## Open Questions & Future Work

El backlog arquitectónico transversal. Las preguntas y deudas que afectan al sistema como un todo.

---

**[INCONSISTENCIA] Observabilidad del bridge: diseñada vs implementada**
> `docs/reference/BRIDGE.md` define los indicadores de estado requeridos (bridge conectado, impresora error, gap de eventos) pero los marca como "Por validar". El Master Bible asume que esta observabilidad existe. Necesita verificación en código antes de declararlo [HECHO]. Si no existe → blocker para el Shadow Day. Prioridad: P0 (blocker de cutover).

---

**[DEUDA] Offline boot de Electron**
> La Electron App carga desde `https://dashboard-app.vercel.app`. Sin internet al arrancar la terminal, el POS muestra `offline.html` y no puede operar. Esto viola Invariante 3 (el staff nunca queda bloqueado por el sistema) en el escenario de corte de luz + reinicio. La solución es empaquetar un build de Next.js en `app.asar`. Prioridad: P0 antes de escalar a restaurantes con internet inestable.

---

**[DEUDA] Cobertura completa de RLS policies**
> El aislamiento multi-tenant actual depende de `client_id` en el payload y en el header de cada request. Si una RLS policy está mal configurada o falta en una tabla, un restaurante podría ver datos de otro. No hay registro de una auditoría completa de todas las políticas RLS en Supabase. Prioridad: P0 antes del onboarding del segundo cliente en producción.

---

**[DECISIÓN PENDIENTE] Resolución de STALE_WRITE_CONFLICT**
> Actualmente, cuando el sync queue tiene un STALE_WRITE_CONFLICT, el sistema lo marca como terminal y requiere intervención manual. No hay UI de resolución de conflictos para el operador. En AMALAY (1 terminal) esto es raro. En multi-terminal es frecuente. ¿Qué UI necesita el operador para resolver un conflicto? ¿Puede ver las dos versiones y elegir? ¿O siempre gana el servidor? Decisión necesaria antes de multi-terminal. Prioridad: P1.

---

**[DEUDA] Normalización de pos_orders.items (Opción B)**
> Los ítems de cada orden viven en un JSONB monolítico en `pos_orders.items`. Esto funciona con 1 terminal. Con múltiples terminales modificando la misma orden (agregar ítem, cambiar modificador), la frecuencia de OCC conflicts aumenta porque cualquier modificación requiere reescribir el JSONB completo. La normalización a `pos_order_items` (tabla separada, un fila por ítem) reduce la superficie de conflicto. Bloqueada por el cutover — implementar en semana 2-3 post-cutover. Prioridad: P1.

---

**[DUDA] ¿El bridge genera el mismo event_id para el mismo evento de Wansoft si lo recibe dos veces?**
> `docs/reference/EVENT-STORE.md` y `docs/reference/BRIDGE.md` identifican esto como la pregunta crítica de idempotencia del Event Store. La tabla `pos_events` tiene un UNIQUE INDEX en `event_id` que protege contra duplicados. Pero si el bridge genera IDs aleatorios en vez de deterministas (derivados del contenido del evento), el UNIQUE INDEX no protege. Estado: "Por validar" según la documentación. Prioridad: P0 para Shadow Day.

---

**[INCONSISTENCIA] CierreCajaWizard y verificación de sync_queue**
> El Master Bible afirma que CierreCajaWizard verifica el estado de sync_queue antes de permitir el cierre. Esto está documentado como [INFERENCIA] — el componente existe (`src/components/pos/CierreCajaWizard.tsx`) pero no se ha confirmado que esta verificación esté implementada. Si el cierre no verifica la queue, un operador puede cerrar el turno con ventas pendientes de sincronizar. Prioridad: P1.

---

**[DEUDA] Sin P&L automático mensual**
> Wansoft tiene `GetIncomeStatemetByMonthInYear` — un Estado de Resultados mensual automático con ingresos, egresos, costo, y utilidad. Fullsite tiene los datos (pos_orders, pos_inventory, gastos) pero no tiene la consolidación. El dueño hoy no puede saber su utilidad neta sin que el contador entregue el estado financiero 2 meses después. Los datos ya existen en Supabase — falta el módulo de consolidación. Prioridad: P1 (alto valor, baja complejidad).

---

**[DEUDA] Sin módulo de producción de panadería / batch cooking**
> AMALAY tiene panadería (croissants, panes, etc.). La deducción de inventario actual es por ítem vendido al momento del cobro. En un restaurante con batch cooking, el consumo real de ingredientes ocurre durante la producción previa, no al vender. Esto significa que el food cost en tiempo real está mal calculado para items de panadería. Wansoft tiene 26 stored procedures dedicados a este módulo. Prioridad: P2 (necesario antes de escalar a restaurantes con producción).

---

**[DECISIÓN PENDIENTE] Tenant isolation: Device JWT + RLS (Fase 4)**
> El diseño de Fase 4 usa Device JWT firmado por Supabase para que `client_id` esté baked in el token JWT. Esto elimina la dependencia de `x-client-id` header (que podría ser manipulado). El diseño existe pero no hay ADR formal ni fecha de implementación. Debe implementarse antes de onboarding del segundo cliente. Prioridad: P0 (seguridad crítica).

---

**[DUDA] ¿Electron KDS (electron-kds) tiene offline-first?**
> El Electron KDS carga desde Supabase Realtime o polling para mostrar el estado de las órdenes en cocina. No hay evidencia en el código revisado de que el KDS tenga una capa offline. Si Supabase tiene degradación, ¿el KDS muestra las últimas órdenes cacheadas o una pantalla en blanco? Prioridad: P1 — el KDS es la pantalla más crítica en cocina.

---

**[DEUDA] Sin transferencias entre sucursales**
> Para Grupo Galería (Dunkin México, Carl's Jr, BWW, iHop — 12+ ubicaciones), las transferencias de inventario entre sucursales son un requisito. Wansoft tiene 760 referencias a este módulo en sus stored procedures. Fullsite no lo tiene. Prioridad: P2 (necesario antes de grupos multi-sucursal).

---

**[INCONSISTENCIA] Modelo fiscal genérico: diseñado pero no validado**
> La decisión de usar `pos_tax_rules` + `pos_item_taxes` (N:M) para soportar IVA + IEPS está documentada en DECISIONS.md como "bloqueada hasta tener XML CFDI real de Wansoft como referencia". No hay confirmación de que el XML ya fue obtenido ni de que el modelo fue validado. Si el modelo fiscal está mal, los CFDIs emitidos serán incorrectos y el SAT puede rechazarlos. Prioridad: P0 antes de emitir cualquier CFDI en producción.

---

> "El cutover no es el objetivo.
>  El objetivo es que nadie quiera regresar a Wansoft después de 2 semanas."
>
> — Daniel Ramonfaur, Fundador, Fullsite
>
> Fullsite — Restaurant Operating System
> docs/bibles/FULLSITE-MASTER-BIBLE.md
