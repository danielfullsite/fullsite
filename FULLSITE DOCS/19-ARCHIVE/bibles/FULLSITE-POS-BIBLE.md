# Fullsite POS Bible

> Documento canónico del sistema POS de Fullsite. Describe exactamente lo que existe en el código con referencias precisas a archivos y líneas. Cuando algo falta o tiene limitaciones conocidas, se dice explícitamente. Este documento es la fuente de verdad para cualquier ingeniero que necesite entender, modificar o extender el POS.
>
> Última actualización: 2026-07-23
> Generado desde auditoría directa del código fuente.

**Etiquetas de evidencia usadas en este documento:**
- `[HECHO]` — existe en el código y fue verificado directamente. Se incluye archivo y línea cuando es posible.
- `[INFERENCIA]` — deducido del comportamiento observado o del contexto, pero NO verificado directamente en el código.
- `[PENDIENTE]` — no existe todavía, está diseñado pero no implementado, o es una decisión abierta.

Nunca se usa lenguaje ambiguo ("probablemente", "parece que", "debería"). Cada afirmación lleva su etiqueta.

**Cross-references a otras Bibles:**
Este documento es parte de una familia. Las decisiones de arquitectura profunda están en las otras Bibles:
- `FULLSITE-ENGINEERING-BIBLE.md` — arquitectura de sync, Transaction A/B, OCC, event store
- `FULLSITE-DOMAIN-BIBLE.md` — schemas completos de entidades (Order, Turno, Staff, etc.)
- `FULLSITE-DASHBOARD-BIBLE.md` — módulo de reportes, admin multi-tenant
- `FULLSITE-OPERATIONS-BIBLE.md` — flujos operativos AMALAY, runbooks, cierre de turno
- `FULLSITE-PRODUCT-VISION-BIBLE.md` — por qué existe Fullsite, ICP, roadmap estratégico
- `FULLSITE-MASTER-BIBLE.md` — índice maestro de todo

Cuando algo está explicado en profundidad en otra Bible, se enlaza en vez de duplicar.

---

## Índice

1. [Propósito](#1-propósito)
2. [Filosofía](#2-filosofía)
3. [Arquitectura](#3-arquitectura)
4. [Flujos principales](#4-flujos-principales)
5. [Reglas de negocio](#5-reglas-de-negocio)
6. [Estados (State Machines)](#6-estados-state-machines)
7. [Source of Truth](#7-source-of-truth)
8. [Invariantes](#8-invariantes)
9. [Casos borde](#9-casos-borde)
10. [Limitaciones actuales](#10-limitaciones-actuales)
11. [Roadmap](#11-roadmap)
12. [Referencias al código](#12-referencias-al-código)
13. [Open Questions & Future Work](#13-open-questions--future-work)

---

## 1. Propósito

### 1.1 Para quién es este documento

Este documento es para el ingeniero que entra al repo sin haber hablado con nadie del equipo. Explica el POS de Fullsite desde adentro: por qué existe, cómo funciona, qué está construido y qué no.

No reemplaza leer el código. Lo complementa: explica el "por qué" y "dónde" para que el código tenga contexto.

### 1.2 Qué es el POS de Fullsite

El POS de Fullsite es una aplicación web (Next.js 16 App Router, TypeScript) que sirve como sistema punto de venta para restaurantes. Funciona en cualquier navegador moderno y en producción (AMALAY Coffee & Market) corre dentro de una app Electron que le da acceso a hardware local: impresoras, cajón de dinero y lector de huella dactilar DigitalPersona.

No es un sistema de escritorio nativo. Es una PWA con capacidades offline vía IndexedDB y Service Worker.

### 1.3 Alcance del módulo POS

El POS cubre:

| Módulo | Path | Descripción |
|--------|------|-------------|
| Layout / Auth | `/pos/layout.tsx` | Autenticación, PIN/huella, kiosko, idle |
| Vista de Mesas | `/pos/mesas` | Planograma físico + grid de mesas |
| POS principal | `/pos` | Tomar orden, modificadores, pagos, descuentos |
| KDS | `/pos/kds` | Display de cocina (multi-estación) |
| Barra | `/pos/barra` | Display de barra (alternativo) |
| Turno | `/pos/turno` | Apertura, corte parcial, cierre de caja |
| Corte | `/pos/corte` | Reporte detallado de ventas por turno/día |
| Historial | `/pos/historial` | Órdenes pasadas, reimpresión |
| Facturación | `/pos/facturacion` | CFDI 4.0 vía Facturama |
| Delivery | `/pos/delivery` | Órdenes Uber Eats y Rappi |
| Config / Huella | `/pos/configuracion`, `/pos/huella` | Sin auth de turno |

El POS NO incluye: reportes financieros avanzados, gestión de empleados (CRUD), configuración de menú, admin multi-tenant. Esos son del módulo Dashboard.

### 1.4 Cliente en producción

Un único tenant activo: AMALAY Coffee & Market (`client_id` en Supabase). El sistema es multi-tenant en diseño pero el onboarding de nuevos clientes no existe como flujo de usuario.

---

## 2. Filosofía

### 2.1 Reliability sobre features

El POS opera en un restaurante en producción. Una caída del POS es una venta perdida. La filosofía central: el restaurante debe olvidar que Fullsite existe — el sistema debe ser tan confiable que nadie lo note.

Esto se traduce en:
- Offline-first: el POS debe funcionar sin internet durante la operación (con la excepción crítica documentada en §10.1)
- Cola de sync con reintentos automáticos antes que "guardar en el servidor" directo
- Locks de concurrencia para prevenir datos corruptos entre terminales

### 2.2 Copia primero, innova después (Wansoft parity)

El POS de Wansoft (NetSilver) tiene 15+ años de evolución en restaurantes mexicanos. Las decisiones de UX de Wansoft existen por razones operativas reales. Fullsite las copia primero y solo diverge cuando hay evidencia de que algo no funciona.

Ejemplos de esto en el código:
- El ítem TIEMPO como separador de tandas (copia directa de Wansoft)
- Los 4 modos de descuento (porcentaje, fijo, cortesía, 2x1)
- La lógica de turno obligatorio para toda orden

### 2.3 Sin SDK de Supabase

El SDK de Supabase (`createClient`) hace hangs silenciosos en Next.js App Router. Todo acceso a Supabase usa `fetch()` directo a PostgREST. Esta regla no tiene excepciones.

**Rationale:**
- **Problema:** El SDK de Supabase tiene un bug en el contexto de Next.js App Router donde las llamadas no resuelven ni rechazan — simplemente cuelgan. En producción esto se manifiesta como páginas que cargan infinitamente.
- **Alternativa descartada:** Usar el SDK con workarounds (timeout manual, abort signal). No resuelve el problema raíz.
- **Decisión:** fetch() directo a PostgREST es verboso pero predecible. El contrato de la API REST de Supabase es estable.
- **Tradeoff:** Más código boilerplate para cada query (headers repetidos, URL construida a mano). Se acepta a cambio de confiabilidad.
- **Cuándo replantear:** Si Supabase publica un SDK que resuelve el bug documentado en App Router, o si se migra a un BFF (Backend for Frontend) que centraliza las llamadas.

→ Ver [Engineering Bible § Data Access Layer] para el patrón completo de fetch() en el proyecto.

```typescript
// Correcto
const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_orders?...`, {
  headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
})

// PROHIBIDO
const { data } = await supabase.from('pos_orders').select('*')  // hangs silenciosamente
```

### 2.4 El gerente es el guardián de cambios destructivos

Toda operación que afecta dinero o estado de orden (descuento, cancelación, void, movimiento de caja, cierre) requiere autenticación de manager en el momento de la acción. No existe un "modo gerente" que desbloquea todo para una sesión.

**Rationale:**
- **Problema:** En un restaurante, el mesero usa el mismo terminal para tomar órdenes y potencialmente abusar de descuentos.
- **Alternativa descartada:** "Modo gerente" de sesión (login como gerente = todo habilitado). Riesgo: el gerente se va y el terminal queda desbloqueado.
- **Decisión:** Cada acción sensible requiere el PIN del gerente en ese momento. El mesero no puede hacer descuentos aunque el gerente esté físicamente presente.
- **Tradeoff:** Más fricción operativa para el gerente en restaurantes de alto volumen. Se acepta como costo de control anti-fraude.
- **Cuándo replantear:** Si el feedback operativo muestra que el gerente está autenticando decenas de veces por turno, considerar un "modo gerente" con expiración corta (ej: 5 min).

### 2.5 Multi-tenant por diseño, AMALAY en práctica

Toda tabla tiene `client_id`. Todo query filtra por él. Pero las constantes operativas (CORTESIA_POR_PERSONA=$480, el planograma de mesas, las keywords de estación) están hardcoded para AMALAY. El sistema es multi-tenant en la base de datos; no lo es en la configuración de operación.

---

## 3. Arquitectura

### 3.1 Stack tecnológico

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Framework | Next.js 16 App Router | TypeScript |
| Hosting | Vercel | Deploy automático desde git |
| Base de datos | Supabase (PostgreSQL) | Acceso vía PostgREST con fetch() |
| Auth de operador | Supabase Auth | Sesión del tenant admin |
| Auth de staff POS | PIN + Huella + sessionStorage | Separado del auth de operador |
| Offline store | IndexedDB | DB: `fullsite_pos` v1 |
| Service Worker | Registrado | Maneja sync en background |
| Desktop wrapper | Electron | Solo en terminales AMALAY |
| Print bridge | Node.js en Electron | `http://127.0.0.1:7717` |
| Fingerprint | DigitalPersona HID | `http://127.0.0.1:7717/fp` |
| Impresoras | ESC/POS | USB y TCP, via bridge |

### 3.2 Estructura de archivos

```
src/app/pos/
├── layout.tsx              # Gate de auth + PIN + huella + kiosko + idle timeout
├── page.tsx                # POS principal: orden, modificadores, pagos, descuentos
├── mesas/page.tsx          # Vista de mesas (planograma + grid)
├── kds/page.tsx            # KDS multi-estación (cocina/barra/panadería)
├── barra/page.tsx          # Display barra alternativo
├── turno/page.tsx          # Apertura, CorteX, cierre
├── corte/page.tsx          # Reporte detallado
├── historial/page.tsx      # Historial y reimpresión
├── facturacion/page.tsx    # CFDI 4.0
├── delivery/page.tsx       # Uber Eats y Rappi
├── configuracion/page.tsx  # Config (ungated)
└── huella/page.tsx         # Gestión huella (ungated)

src/components/pos/
├── TurnoGate.tsx           # Barrera de turno activo, envuelve hijos del layout
└── CierreCajaWizard.tsx    # Wizard 2 pasos para cierre de caja

src/lib/
├── pos-offline-db.ts       # IndexedDB + cola de sync + syncAll()
└── print-queue.ts          # Cola de impresión con máquina de estados
```

### 3.3 Capas de seguridad del POS

El POS tiene 3 capas de control de acceso en secuencia:

```
1. layout.tsx (Auth de staff)
   ¿Es KDS_PATH? → bypass total
   ¿Hay sesión activa? → continúa
   No → pantalla de lock (PIN / huella)

2. TurnoGate.tsx (Control de turno)
   ¿Es UNGATED_PATH? → bypass
   ¿Turno activo mismo día? → continúa
   Turno stale → pantalla de resolución para gerente
   Sin turno → espera para mesero / formulario para gerente

3. Permiso de operación (en cada acción)
   Descuentos, cancelaciones, cierres → requieren PIN de manager
```

### 3.4 Paths sin autenticación

`[HECHO]` — `layout.tsx`:
```typescript
const KDS_PATHS = ['/pos/cocina', '/pos/barra', '/pos/panaderia', '/pos/kds']
```
Bypass total de auth. Para pantallas de cocina sin login requerido.

`[HECHO]` — `TurnoGate.tsx`:
```typescript
const UNGATED_PATHS = ['/pos/turno', '/pos/configuracion', '/pos/huella']
```
Requieren login de staff pero no turno activo.

### 3.5 IndexedDB

`[HECHO]` — `pos-offline-db.ts`:
- Nombre: `fullsite_pos`
- Versión: 1
- 5 stores: `menu`, `orders`, `inventory`, `sync_queue`, `meta`

### 3.6 Print bridge

El browser no accede a impresoras directamente. Flujo:
```
POS (browser)
  → print-queue.ts
    → HTTP POST http://127.0.0.1:7717
      → Bridge Electron (Node.js local)
        → ESC/POS binario
          → Impresora USB / TCP
```

El mismo proceso Electron también expone `/fp` para el lector de huella.

**Rationale del bridge local:**
- **Problema:** Los browsers no tienen acceso a impresoras ESC/POS (térmicas de recibos) por razones de seguridad de la plataforma web.
- **Alternativas descartadas:**
  - `window.print()` / CSS: solo imprime HTML con el formato del OS, no ESC/POS directo. No funciona para comandas con formato específico de impresora.
  - Servicio cloud de impresión (PrintNode, Google Cloud Print): requiere internet permanente. Falla en offline.
- **Decisión:** Proceso Node.js local dentro de Electron que expone HTTP en localhost. El POS (browser) lo llama como si fuera una API local.
- **Tradeoff:** Acoplamiento al entorno Electron. En un browser standalone (sin Electron), la impresión no funciona.
- **Cuándo replantear:** Si se implementa una versión iPad/tablet del POS, se necesitaría una alternativa (AirPrint, Star Micronics SDK para iOS).

### 3.7 Electron

El app Electron carga la URL de Vercel en producción. No tiene bundle local del frontend. Esta decisión crea la deuda crítica de offline boot (ver §10.1).

**Rationale:**
- **Problema:** Necesitamos acceso a hardware local (impresoras, huella) desde una aplicación web.
- **Alternativa descartada:** App nativa (Swift, .NET): desarrollo lento, sin reutilización del código web.
- **Decisión:** Electron envuelve el browser ya existente. El 95% del código sigue siendo web (Next.js). Electron solo provee el bridge de hardware.
- **Tradeoff introducido:** El app carga desde Vercel (internet requerido en arranque). El bundle no está empaquetado localmente. Es la deuda `[PENDIENTE]` más crítica.
- **Cuándo replantear:** En cuanto sea el P0 de cutover — el bundle debe empaquetarse localmente para permitir offline boot completo.

### 3.8 Event store (shadow mode)

`[INFERENCIA]` — Desde 2026-06-12, las operaciones del POS disparan eventos append-only a una tabla de eventos. Esto corre en paralelo al modelo transaccional principal. No afecta la operación normal del POS pero es la base del analytics futuro.

---

## 4. Flujos principales

### 4.1 Login de staff

```
1. Staff abre el POS (o pantalla se bloquea por idle 30 min)
2. layout.tsx muestra pantalla de lock
3. Staff elige método:

   [PIN]
   a. Staff ingresa su PIN numérico
   b. POST /api/pos/pin con pin + staff_id
   c. Servidor verifica contra hash en DB
   d. Si inválido: contador de intentos++
      → 5 intentos fallidos: lockout 60 segundos
   e. Si válido: sesión guardada en sessionStorage
   f. Si bridge de huella disponible Y staff no tiene template:
      → Pantalla de registro de huella (4 capturas, ~90s)
   g. Redirect a /pos/mesas si en /pos raíz

   [Huella]
   a. Staff toca el lector HID
   b. POST http://127.0.0.1:7717/fp con imagen de huella
   c. Bridge compara contra templates enrollados
   d. Si match: sesión guardada en sessionStorage
   e. Redirect a /pos/mesas

4. Wake Lock API adquirida → pantalla permanece activa
5. Idle timer iniciado: 30 min sin actividad → lock automático
```

`[HECHO]` — Constantes en `layout.tsx`: `MAX_ATTEMPTS=5`, `LOCKOUT_MS=60000`, `IDLE_TIMEOUT_MS=30*60*1000`.

`[HECHO]` — Cache PIN offline: `btoa(pin).slice(0, 8)` con TTL de 15 minutos en localStorage.

### 4.2 Apertura de turno

```
1. Gerente o admin navega a /pos/turno (ungated — no requiere turno activo)
2. TurnoGate detecta estado 'none'
3. Gerente ve formulario con campo "Fondo inicial"
4. Ingresa el monto en caja al iniciar el turno
5. POST a pos_turnos con { fondo_inicial, opened_by, client_id, opened_at }
6. TurnoGate actualiza a estado 'active'
7. Meseros que esperaban ven el POS desbloquearse automáticamente
   (TurnoGate hace poll cada 5s en estado 'none')
```

### 4.3 Tomar una orden

```
1. Mesero selecciona mesa en /pos/mesas
   → Navega a /pos?mesa=N (o /pos?cuenta=NOMBRE para cuentas sin mesa)

2. POS carga el menú del día
   → Desde IndexedDB si offline / Supabase si online

3. Mesero selecciona ítems por categoría
   → Ítems agotados (stock 0 en pos_inventory) aparecen bloqueados

4. Para cada ítem, opcionalmente:
   a. Modal de modificadores
      → Path legacy: checkboxes "quitar" (ingredientes) + "agregar" (DB)
      → Path nuevo: grupos stepped (uno a la vez, con indicador de progreso)
      → Grupos requeridos sin seleccionar bloquean confirmar

5. Mesero puede agregar ítem TIEMPO como separador de tandas

6. Al confirmar:
   a. Orden guardada en IndexedDB (offline-first)
   b. POST a /api/pos/orders (sincronización)
   c. Si falla sync: queda en sync_queue para retry automático
   d. Comanda enviada a impresora de estación via print-queue.ts

7. Estado inicial de orden: 'enviada'
```

### 4.4 Ciclo de vida en cocina (KDS)

```
1. Orden aparece en /pos/kds como tarjeta blanca (status='enviada')
2. Chef toca para marcar como 'preparando' → tarjeta en ámbar
3. Chef marca ítems individuales como listos (kds_item_status)
4. Cuando todos los ítems activos están marcados:
   → Sistema avanza automáticamente a 'lista' → tarjeta en esmeralda
5. Chef toca BUMP: 'lista' → 'entregada'
   (o mesero lo confirma desde el POS principal)
```

Alerta sonora cuando llega nueva orden: 3 tonos a 880Hz-1100Hz-880Hz.

### 4.5 Cobro y cierre de orden

```
1. Mesero presiona "Cobrar" en el POS principal

   [Efectivo]
   a. Ingresa monto recibido → POS calcula cambio
   b. Confirmar → orden pasa a 'cerrada'
   c. Cajón abre automáticamente (print job tipo 'drawer')
   d. Ticket impreso via print-queue.ts

   [Tarjeta (Getnet)]
   a. POS muestra monto en pantalla grande (showCardConfirm)
   b. Cajero ingresa monto manualmente en terminal Getnet física
   c. Terminal confirma pago de forma autónoma
   d. Cajero confirma en POS → orden 'cerrada'
   e. Ticket impreso (sin cajón)

   [Múltiples métodos]
   a. Se pueden combinar métodos (split payment)
   b. pagos[] array almacena cada pago con {metodo, monto}

2. Orden cerrada → turno_id asignado
3. pos_audit_log: evento 'order_closed'
```

`[INFERENCIA]` — No hay integración API con Getnet. El flujo es manual por diseño hasta que se implemente Mercado Pago Point u otra integración.

### 4.6 Descuentos

```
Todos los descuentos requieren:
- PIN de manager (verificado vía /api/pos/pin)
- O biométrico WebAuthn (si disponible)

Tipos disponibles:
1. Porcentaje: % sobre el total
2. Fijo: monto fijo en pesos
3. Cortesía: $480 × personas (máximo = personas × $480)
4. 2x1: ítems seleccionados → el más barato de cada par = $0
```

### 4.7 Cancelación de ítem

```
1. Manager toca ítem en la orden → CancelModal
2. Selecciona razón (6 opciones preset + "otro")
3. Autenticación de manager (PIN / biométrico)
4. ¿El ítem ya fue preparado?
   → No: cancelación limpia, sin registro de merma
   → Sí: se registra como merma
   → Error operativo: se registra como void
5. pos_audit_log: evento 'item_cancelled'
```

### 4.8 Cierre de caja

```
1. Gerente en /pos/turno → tab Caja → Cerrar turno

2. CierreCajaWizard Paso 1:
   → UI de denominaciones (billetes + monedas)
   → Gerente cuenta efectivo físico
   → Ingresa total declarado
   ⚠️ LIMITACIÓN: el desglose por denominación NO se guarda

3. CierreCajaWizard Paso 2:
   → Sistema calcula:
     efectivoEsperado = fondoInicial + ventasEfectivo + depósitos - retiros
     diferencia = declarado - esperado
   → Código de color: ≤$10 verde, ≤$50 ámbar, >$50 rojo
   → BARRERA: si hay items TRANSIENT_RETRYABLE en sync_queue → bloquea cierre
   → Manager ingresa PIN para aprobar

4. Al confirmar:
   → POST a pos_cierres
   → PATCH pos_turnos: status='cerrado', closed_at=NOW()
   → logAudit 'turno_cerrado'
   → Todos los registros pos_attendance sin salida → salida=NOW()
```

### 4.9 Delivery

```
1. Orden llega de plataforma (Uber Eats / Rappi) via webhook/integración
   → Se crea registro en delivery_orders con status='nueva'

2. /pos/delivery muestra la orden (refresh cada 10s)

3. Cocina gestiona: nueva → preparando → lista
   (los estados en_ruta y entregada son responsabilidad de la plataforma)

4. Órdenes TEST y órdenes con total=0 se filtran automáticamente
```

### 4.10 Facturación CFDI

```
1. Cliente solicita factura (en caja o en mesa)

2. /pos/facturacion → Nueva solicitud:
   - RFC (validado con regex SAT)
   - Razón social, régimen fiscal, uso CFDI
   - Código postal, email
   - Monto total de la venta

3. createCFDIRequest() crea registro en factura_requests con status='pendiente'

4. POST /api/factura/timbrar
   → Llama a Facturama con los datos
   → Facturama devuelve XML timbrado + folio fiscal

5. Status actualiza a 'emitida'
   → PDF y XML disponibles para descarga
   → Folio fiscal visible en UI
```

---

## 5. Reglas de negocio

### 5.1 Turno obligatorio

Toda orden requiere un `turno_id` activo. No se puede tomar una orden sin turno.

Enforcement en 4 capas:
1. **UI**: TurnoGate bloquea el POS visualmente
2. **Cliente**: POSContent no permite crear orden sin turno_id
3. **Lógica**: Al cerrar orden, se asigna turno_id del turno activo
4. **DB**: FK en pos_orders → pos_turnos

`[HECHO]` — TurnoGate.tsx muestra pantalla de espera para mesero, formulario de apertura para gerente.

### 5.2 Roles y restricciones por rol

| Rol | Puede hacer |
|-----|------------|
| `admin` / `gerente` | Todo |
| `mesero` | Tomar órdenes, ver sus mesas, cobrar |
| `cajero` | Ver mesas con órdenes activas, cobrar. NO puede crear órdenes en mesas vacías |
| `chef` | Solo KDS |
| `barista` | Solo display barra |
| `supervisor` | Similar a mesero con algunas funciones extras |

Restricción cajero en código `[HECHO]` — `mesas/page.tsx`:
```typescript
if (staffRole === 'cajero' && !ordersByMesa.has(mesaNum)) return
```

### 5.3 Permisos por operación

| Operación | Requiere |
|-----------|---------|
| Descuento de cualquier tipo | Manager (PIN o biométrico) |
| Cancelar ítem | Manager (PIN o biométrico) |
| Cancelar orden completa (void) | Manager (PIN o biométrico) |
| Movimiento de caja (retiro/depósito) | Manager (PIN o biométrico) |
| Abrir turno | Rol gerente o admin |
| Cerrar turno | Permiso `corte_z` + Manager PIN |
| Reabrir orden cerrada | Manager PIN (desde /pos/corte) |
| Ver corte de caja | Manager PIN (sesión `corte_access='1'` en sessionStorage) |

### 5.4 IVA incluido en precios

Los precios del menú son precios finales con IVA incluido (16%). Al desglosar:

```typescript
const IVA_RATE = 0.16
subtotal = total / (1 + IVA_RATE)
iva = total - subtotal
```

`[HECHO]` — Constante usada en `pos/page.tsx` y `facturacion/page.tsx`.

### 5.5 Descuento por cortesía

Monto máximo = `personas × CORTESIA_POR_PERSONA` donde `CORTESIA_POR_PERSONA = 480`.

Este valor está hardcoded. No es configurable desde la UI ni desde la base de datos.

### 5.6 Descuento 2x1

Algoritmo:
1. Seleccionar ítems a los que aplica 2x1
2. Expandir unidades: 2 unidades del ítem A = 2 instancias separadas
3. Ordenar de mayor a menor precio
4. Por cada par (índices 1,3,5...): el ítem en posición impar queda en $0

### 5.7 Cancelación con estado de preparación

La cancelación de un ítem debe registrar si ya fue preparado:
- No preparado: no hay impacto operativo ni de costo
- Preparado: se registra como merma (pérdida de food cost)
- Error operativo: se registra como void (sin costo de merma pero con registro)

### 5.8 Arqueo de caja

```
efectivoEsperado = fondoInicial
                 + ventasEfectivo
                 + propinaEfectivo
                 + depósitos
                 - retiros
                 - propinasNoEfectivo (tarjeta/transferencia)
```

Las propinas no en efectivo se descuentan porque no entran al cajón físico.

### 5.9 Alertas de tiempo en mesa

| Tiempo en mesa | Estado |
|---------------|--------|
| < 60 min | Normal |
| 60-90 min | Timer en ámbar |
| > 90 min | Timer rojo pulsante + banner de alerta en pantalla |

### 5.10 Detección de productos agotados

El POS verifica `pos_inventory` para ingredientes con stock cero vinculados via recetas. Si un ingrediente está en cero, el ítem del menú que lo usa aparece bloqueado y no se puede agregar.

`[HECHO]` — POSContent en `pos/page.tsx` carga el estado de inventario al iniciar.

### 5.11 FIFO en barra

Las órdenes en `/pos/barra` se muestran de la más antigua a la más reciente (FIFO). Esto fue establecido por feedback operativo para que el barista atienda en orden de llegada.

`[HECHO]` — `barra/page.tsx` con sort por `created_at` ASC.

### 5.12 KDS auto-avance a 'lista'

Cuando todos los ítems activos de una orden en estado `preparando` tienen `kds_item_status = done`, el sistema avanza automáticamente la orden a `lista`.

`[HECHO]` — `kds/page.tsx`.

### 5.13 Guard de avance unidireccional de estados

En barra y KDS, antes de avanzar el estado de una orden se verifica que el nuevo estado tenga mayor rango numérico que el actual:

```typescript
if (STATUS_ORDER[newStatus] <= STATUS_ORDER[currentStatus]) return
```

Previene retrocesos accidentales.

`[HECHO]` — `barra/page.tsx`.

### 5.14 Barrera de sync antes del cierre

El cierre de turno bloquea si hay items `TRANSIENT_RETRYABLE` en la sync_queue. Permite cerrar con `STALE_WRITE_CONFLICT` y `TERMINAL_NON_RETRYABLE` (ya no son recuperables automáticamente).

`[HECHO]` — `CierreCajaWizard.tsx`.

**Rationale:**
- **Problema:** Si el turno se cierra con órdenes no sincronizadas en la cola, las ventas del turno estarían incompletas en Supabase. El corte de caja mostraría montos incorrectos.
- **Por qué solo se bloquea en TRANSIENT_RETRYABLE:** Los items en `STALE_WRITE_CONFLICT` ya tienen los datos en el servidor (otra terminal los escribió), y los `TERMINAL_NON_RETRYABLE` son errores de validación que no se resolverán. Bloquear por estos últimos atraparia el cierre indefinidamente.
- **Tradeoff:** Si el internet no regresa, el turno no se puede cerrar. Requiere decisión humana.
- **Cuándo replantear:** Agregar una opción de "cerrar de todos modos" con advertencia explícita para gerente (ej: si llevan >4h sin internet).

→ Ver [Engineering Bible § Sync Queue] para la taxonomía completa de error_class.

### 5.15 Deduplicación en historial

Las órdenes en historial se deduplicán usando:
```typescript
key = `${mesa}-${mesero}-${items}-${created_at.slice(0, 16)}`
```

Maneja duplicados creados por retries de offline sync.

`[HECHO]` — `historial/page.tsx`.

### 5.16 Filtros de delivery

Se filtran automáticamente:
- Órdenes con `is_test = true`
- Órdenes con `total = 0`

`[HECHO]` — `delivery/page.tsx`.

### 5.17 Estaciones KDS por keyword

La estación de un ítem se determina:
1. Campo `station` del ítem primero
2. Si no tiene `station`: matching por keywords

Palabras clave para barra: café, coffee, cappuccino, latte, espresso, americano, smoothie, juice, jugo, frappé, coctel, limonada, agua fresca, té, horchata, jamaica, tamarindo.

Palabras clave para panadería: croissant, toast, tostada, bagel, pan, muffin, scone, danish, baguette, brioche.

Excepción: ítems de cocina que contienen keywords de panadería → van a panadería.

`[HECHO]` — `kds/page.tsx` como `STATION_KEYWORDS`.

---

## 6. Estados (State Machines)

### 6.1 Estados de una orden (`pos_orders.status`)

```
                    ┌─────────┐
                    │  nueva  │  ← orden creada pero no enviada a cocina
                    └────┬────┘
                         │ (comanda enviada)
                    ┌────▼────┐
                    │ enviada │  ← cocina la ve, tarjeta blanca en KDS
                    └────┬────┘
                         │ (chef acepta)
                   ┌─────▼──────┐
                   │ preparando │  ← tarjeta ámbar en KDS
                   └─────┬──────┘
                          │ (todos los ítems marcados)
                    ┌─────▼────┐
                    │  lista   │  ← tarjeta esmeralda en KDS
                    └─────┬────┘
                           │ (BUMP / mesero confirma)
                   ┌───────▼──────┐
                   │  entregada   │  ← entregado al cliente
                   └───────┬──────┘
                            │ (pago recibido)
                    ┌───────▼──────┐
                    │   cerrada    │  ← turno_id asignado, ticket impreso
                    └──────────────┘

Desde cualquier estado (con manager auth):
    → cancelada
```

Transiciones válidas:

| De | A | Actor |
|----|---|-------|
| nueva | enviada | POS al imprimir comanda |
| enviada | preparando | KDS (chef) |
| preparando | lista | KDS auto-avance (todos ítems done) |
| lista | entregada | KDS BUMP o barra |
| entregada | cerrada | POS al cobrar |
| cerrada | (reabierta) | Manager desde /pos/corte |
| cualquiera | cancelada | Manager con PIN/biométrico |

### 6.2 Estados del turno (`pos_turnos.status`)

```
┌─────────┐         ┌─────────┐
│ abierto │ ──────► │ cerrado │
└─────────┘         └─────────┘
    ↑ (también puede estar en estado implícito 'stale'
       cuando la fecha del turno es anterior al día actual)
```

Estados que maneja TurnoGate:

| Estado TurnoGate | Descripción |
|-----------------|-------------|
| `loading` | Verificando con servidor |
| `active` | Turno abierto del mismo día |
| `none` | No hay turno |
| `stale` | Turno de un día anterior (sin cerrar) |

### 6.3 Estados de la cola de sync (`sync_queue`)

```
[nueva operación]
      │
   pending ──────────────────────────► synced ✓
      │
      │ [error de red / 5xx]
      ▼
  retrying ──────────────────────────► synced ✓
      │
      │ [retries >= MAX_RETRIES=5]
      ▼
  (ignorado — error_class=TRANSIENT_RETRYABLE, retries>=5)
      │
      │ [409 OCC conflict]
      ▼
  STALE_WRITE_CONFLICT (terminal, no auto-retry)
      │
      │ [4xx validación]
      ▼
  TERMINAL_NON_RETRYABLE (terminal, no auto-retry)
```

### 6.4 Estados de un trabajo de impresión (`print-queue`)

```
pending
   │
   ├──[bridge UP]──────────────────► printed ✓
   │
   ├──[bridge DOWN]──────────────── bridge_unavailable
   │                                    │
   │                                    │ [< 2 min]
   │                                    │    (espera)
   │                                    │
   │                                    │ [>= 2 min]
   │                                    ├──[tipo=comanda]─► needs_attention
   │                                    │                        │
   │                                    │                        │ [bridge regresa]
   │                                    │                        └──► pending (auto-recover)
   │                                    │
   │                                    └──[otros tipos]──► failed
   │
   ├──[error, retries < 5]──────────► retrying
   │                                    │
   │                                    └──[cada 15s]─► pending
   │
   └──[MAX_RETRIES alcanzado]──────────► failed
```

### 6.5 Estados de una solicitud CFDI

```
pendiente → procesando → emitida ✓
                     └─► error
                     └─► cancelada (ante SAT)
```

### 6.6 Estados de orden de delivery

```
nueva → preparando → lista → en_ruta → entregada
                          └─► cancelada
```

Los últimos dos estados (`en_ruta`, `entregada`) son manejados por la plataforma (Uber Eats / Rappi), no por Fullsite.

---

## 7. Source of Truth

### 7.1 Menú (ítems, precios, categorías)

| Dato | Dónde vive | Quién manda |
|------|-----------|-------------|
| Ítems del menú | `menu_items` (Supabase) | Dashboard admin |
| Precios | `menu_items.price` | Dashboard admin |
| Categorías | `menu_categories` | Dashboard admin |
| Estación por ítem | `menu_items.station` o keyword matching | Admin + código |
| Cache offline | IndexedDB `menu` store | Se actualiza al cargar el POS |

### 7.2 Órdenes

| Dato | Dónde vive | Quién manda |
|------|-----------|-------------|
| Orden activa | `pos_orders` (Supabase) | POS via sync queue |
| Borrador offline | IndexedDB `orders` store | POS cliente |
| Estado de ítems KDS | `pos_orders.kds_item_status` | KDS (columna separada) |

### 7.3 Turno

| Dato | Dónde vive | Quién manda |
|------|-----------|-------------|
| Turno activo | `pos_turnos` (Supabase) | Gerente en /pos/turno |
| Cache offline | `localStorage.pos_cached_turno` | TurnoGate (15 min TTL) |

### 7.4 Staff / Sesión

| Dato | Dónde vive | Quién manda |
|------|-----------|-------------|
| Staff registrado | `staff` (Supabase) | Dashboard admin |
| Sesión activa POS | `sessionStorage` | layout.tsx al login |
| Último PIN válido (offline) | `localStorage` | layout.tsx (TTL 15 min) |
| Actividad para idle | `pos_last_activity` localStorage | layout.tsx |
| Template de huella | Bridge Electron local | Proceso de enrolamiento |

### 7.5 Inventario

| Dato | Dónde vive | Quién manda |
|------|-----------|-------------|
| Stock actual | `pos_inventory` (Supabase) | Sistema de inventario |
| Cache offline | IndexedDB `inventory` store | Sync al cargar |

### 7.6 Cola de impresión

| Dato | Dónde vive | Quién manda |
|------|-----------|-------------|
| Cola activa | `localStorage.pos_print_queue` | print-queue.ts |
| Histórico (opcional) | `pos_print_jobs` (Supabase) | Sync no-blocking |

### 7.7 Audit log

Toda acción relevante (descuento, cancelación, cierre) escribe a `pos_audit_log`. Este es el registro definitivo de qué pasó y quién lo hizo.

### 7.8 Planograma de mesas

`[HECHO]` — El layout de mesas está hardcoded en el array `FLOOR_TABLES[]` en `mesas/page.tsx`. No hay tabla en Supabase para la configuración del plano. Es el único dato de configuración que vive en el código, no en la DB.

---

## 8. Invariantes

Las siguientes condiciones deben mantenerse en todo momento. Si alguna se viola, hay un bug.

### 8.1 Toda orden cerrada tiene turno_id

Una orden con `status='cerrada'` siempre tiene `turno_id` no nulo. Si no, los cálculos del corte serán incorrectos.

### 8.2 El estado de orden solo avanza (excepto reabrir)

Los estados de una orden siguen el orden del ciclo de vida. La única excepción es el gerente reabriendo una orden cerrada desde `/pos/corte`. No existe retroceso automático.

### 8.3 client_id siempre presente en queries

Todo query a Supabase incluye el filtro `client_id=eq.${CLIENT_ID}`. Un query sin este filtro viola el aislamiento multi-tenant y RLS debería rechazarlo.

### 8.4 Los ítems de KDS se marcan en columna separada

El estado de ítems en KDS (`kds_item_status`) está en una columna separada de los ítems de la orden. Esto es para evitar races de escritura entre el POS (que actualiza ítems) y el KDS (que marca ítems como listos).

`[HECHO]` — `kds/page.tsx` escribe a `kds_item_status`, no a los items de la orden.

### 8.5 La sync_queue nunca se borra con items no sincronizados

`clearSyncedItems()` solo elimina items donde `synced=true`. Los items pendientes permanecen hasta sincronizarse o fallar terminalmente.

### 8.6 El lock de syncAll previene ejecuciones paralelas

```typescript
let syncAllRunning = false
```

Si `syncAll()` ya está corriendo, una segunda llamada retorna inmediatamente. Esto evita escrituras paralelas en conflicto.

`[HECHO]` — `pos-offline-db.ts`.

### 8.7 El bridge de impresión es local

El print bridge solo puede estar en `http://127.0.0.1:7717`. No existe configuración de URL remota para el bridge. Si el proceso Electron no está corriendo, el bridge no existe.

### 8.8 Los descuentos siempre requieren autenticación de manager

No existe descuento sin verificación de manager en el momento. No hay modo que permita descuentos sin PIN.

---

## 9. Casos borde

### 9.1 Merge de mesas con conflicto OCC

Si dos terminales intentan modificar la misma orden simultáneamente, el segundo recibe HTTP 409 (`STALE_WRITE_CONFLICT`). El merge de mesas llama a `/api/pos/merge-orders` con guards de revisión. La UI muestra error; el usuario debe reintentar manualmente.

### 9.2 Turno stale al cambio de día

Si el turno del día anterior no se cerró:
- TurnoGate detecta estado `stale` (fecha del turno < fecha actual)
- Gerente debe resolver: cerrar el anterior o reabrirlo
- El cierre de turno stale verifica que no haya items `TRANSIENT_RETRYABLE` pendientes
- Si los hay, el cierre se bloquea hasta que se sincronicen

### 9.3 Login PIN con bridge de huella fallido

Si el usuario hace login con PIN exitosamente pero el bridge de huella falla durante el enrolamiento:
- El login con PIN ya fue aprobado — el usuario queda logueado
- El registro de huella queda pendiente para la próxima sesión
- El POS continúa sin huella

### 9.4 Cajero en mesa vacía

El cajero no puede crear órdenes nuevas. Si navega directamente a `/pos?mesa=N` para una mesa sin orden activa, el POS no le permite agregar ítems. En la vista de mesas, el cajero directamente no ve las mesas disponibles.

### 9.5 Descuento 2x1 con unidades múltiples del mismo ítem

Si hay 3 unidades del ítem A (precio $100):
- Se expanden como 3 instancias: [$100, $100, $100]
- Sort descendent: [$100, $100, $100]
- Par 1 (índices 0,1): el de índice 1 queda en $0
- Par 2 (índice 2): impar en el conteo, no tiene par → queda a precio normal
- Resultado: $100 + $0 + $100 = $200 (en vez de $300)

### 9.6 Impresión durante offline

Durante offline de red, los trabajos de impresión se encolan en `localStorage`. Si el bridge Electron sí está disponible localmente (impresoras conectadas), la impresión funciona aunque no haya Supabase sync. La cola de impresión es independiente de la cola de sync.

### 9.7 Items de sync_queue con retries >= 5

Items con 5 o más reintentos son ignorados silenciosamente en futuros ciclos. El contador de "pendientes" en UI sigue incluyéndolos. El usuario puede creer que hay órdenes por sincronizar cuando en realidad ya fueron silenciadas permanentemente.

No existe UI para ver el detalle de items silenciados ni para purgarlos manualmente.

### 9.8 Lockout de PIN compartido entre empleados

El contador de intentos fallidos de PIN es por dispositivo/sesión, no por empleado. Si el empleado A falla 4 veces y el empleado B falla 1 vez en el mismo terminal, el terminal se bloquea. Ninguno individualmente llegó al límite pero el terminal queda bloqueado 60 segundos.

`[INFERENCIA]` — El mecanismo exacto depende de cómo se almacena el contador. Si es global al dispositivo, aplica este caso.

### 9.9 STALE_WRITE_CONFLICT sin mecanismo de resolución en UI

Si una operación queda en estado `STALE_WRITE_CONFLICT` en la sync_queue:
- No se reintenta automáticamente
- No hay UI para ver cuáles operaciones están en conflicto
- El cierre de turno las permite pasar (no las bloquea)
- Permanecen en la cola indefinidamente hasta que alguien las limpie con código

### 9.10 Alerta de tiempo en mesa con offline

Si el POS está offline y la vista de mesas ya estaba cargada, el timer de alerta (60/90 min) sigue funcionando porque usa `Date.now()` local. El estado de mesa (ocupada/disponible) puede estar desactualizado respecto al servidor.

### 9.11 KDS sin auth en paths anidados

`KDS_PATHS = ['/pos/cocina', '/pos/barra', '/pos/panaderia', '/pos/kds']`

El bypass de auth se aplica si `pathname.startsWith(kdsPath)`. Un path como `/pos/kds/anything` también estaría sin auth. No existe sub-routing en KDS actualmente, pero cualquier ruta anidada bajo esos prefijos quedaría sin protección.

### 9.12 Delivery sin webhooks configurados

Los estados `en_ruta` y `entregada` de delivery_orders se esperan de webhooks de Uber Eats/Rappi. Si los webhooks no están configurados o fallan, las órdenes quedan en `lista` indefinidamente en la UI de delivery.

---

## 10. Limitaciones actuales

### 10.1 Offline boot (P0 — blocker crítico antes del cutover)

**Qué falta:** La app Electron carga desde la URL de Vercel (`https://...vercel.app/pos`). Si no hay internet en el arranque, el app no carga. El offline solo funciona si ya estaba cargado cuando se perdió la conexión.

**Impacto:** Corte de internet al inicio del turno = POS inoperable.

**Solución:** Empaquetar el bundle de Next.js dentro del Electron en el build (offline bundle). No implementado.

`[HECHO]` — Esta limitación fue identificada en la auditoría RC1 y documentada como deuda P0.

### 10.2 Denominaciones en cierre de caja no persisten

**Qué falta:** El CierreCajaWizard muestra UI completa para contar billetes ($1000/$500/...) y monedas ($10/$5/...) por denominación. Pero al guardar el cierre, el campo de denominaciones en `pos_cierres` se guarda como `{}` (JSON vacío). Solo el monto total declarado queda registrado.

**Impacto:** No hay registro histórico del conteo por denominación. Si hubiera error de arqueo, no se puede auditar cómo se contó.

### 10.3 Editor de plano de mesas no existe

**Qué falta:** El planograma está hardcoded en `FLOOR_TABLES[]` en `mesas/page.tsx`. No hay editor visual ni tabla en Supabase para la configuración del plano.

**Impacto:** Para un nuevo restaurante con diferente layout, hay que editar el código fuente y hacer deploy.

### 10.4 Número de orden no secuencial

**Qué falta:** Wansoft usa números secuenciales por turno (72, 73, 74...) que el personal puede mencionar verbalmente. Fullsite usa UUIDs; en UI se muestran los primeros 8 caracteres hexadecimales.

**Impacto:** El staff no puede referirse a órdenes por número en conversación. "La orden 73" no existe en Fullsite.

### 10.5 Impresión de corte y reimpresión de historial no usan el bridge

**Qué falta:** El corte parcial (CorteXModal) y la reimpresión de tickets desde historial usan `window.open()` + `window.print()` — esto abre el diálogo de impresión del OS, no envía directamente a la impresora configurada via el bridge Electron.

**Impacto:** En modo kiosko sin barra de herramientas, el diálogo del OS puede ser confuso. La impresión no va a la impresora de caja automáticamente.

### 10.6 Mercado Pago Point — estado de integración no confirmado

**Qué falta:** Existe código que referencia Mercado Pago Point para pagos con tarjeta. El estado operativo en producción no pudo confirmarse desde el código revisado.

**Impacto:** Si la integración no está activa, todos los pagos con tarjeta son 100% manuales (Getnet con monto en pantalla grande).

`[INFERENCIA]` — No se verificó directamente el estado de activación de MP Point.

### 10.7 Cortesía hardcoded

`CORTESIA_POR_PERSONA = 480` está hardcoded en `pos/page.tsx`. No configurable desde UI ni DB.

**Impacto:** Requiere cambio de código y deploy para ajustar el monto de cortesía.

### 10.8 Conflictos OCC sin resolución en UI

Operaciones en `STALE_WRITE_CONFLICT` no tienen UI de resolución. No se puede ver qué orden tuvo el conflicto ni qué hacer al respecto. Permanecen en la cola indefinidamente.

### 10.9 Session locking sin mecanismo confirmado

El sistema debe prevenir logins dobles del mismo empleado en múltiples terminales. El mecanismo exacto de propagación (cómo se invalida la sesión en otro terminal) no está claro en el código revisado.

`[INFERENCIA]` — Existe la intención pero la implementación completa no fue verificada.

### 10.10 Dos sistemas de modificadores en paralelo

Existen el path legacy (quitar/agregar) y el path nuevo (grupos stepped) corriendo en paralelo. No está documentado en el código qué ítems usan cuál. `getModifierGroupsForItem()` puede devolver vacío para ítems sin grupos stepped, cayendo al legacy.

**Impacto:** La experiencia de modificadores es inconsistente entre ítems.

### 10.11 Planograma hardcoded para AMALAY

Las 28 mesas del planograma con sus posiciones, formas y zonas son específicas de AMALAY. Las "paredes" del restaurante (div verde = terraza, div maroon = barra) también son hardcoded.

**Impacto:** El POS no es plug-and-play para otro restaurante sin editar código.

---

## 11. Roadmap

Esta sección describe lo que viene después, según el estado conocido del proyecto al 2026-07-23.

### 11.1 P0 — Blocker para cutover (antes de reemplazar Wansoft)

| Item | Estado |
|------|--------|
| Offline boot (bundle en Electron) | Pendiente |
| Validación smoke test físico AMALAY | Pendiente |
| Integración Facturama producción | Pendiente (costo $1,650 setup) |
| IPs de impresoras configuradas en bridge | Pendiente |
| Capacitación de staff | Pendiente |
| Piloto paralelo con Wansoft | Pendiente |

### 11.2 P1 — Post cutover (estabilización)

| Item | Descripción |
|------|-------------|
| Número secuencial de orden | Por turno, para que el staff se refiera por número |
| Denominaciones en cierre | Persistir el desglose real en pos_cierres |
| UI de conflictos OCC | Ver y resolver STALE_WRITE_CONFLICT desde el POS |
| Editor de plano de mesas | Configurar layout sin tocar código |
| Session locking robusto | Verificar y completar el mecanismo |
| Integración completa MP Point | O confirmar que Getnet manual es suficiente |

### 11.3 P2 — Expansión (100 restaurantes)

| Item | Descripción |
|------|-------------|
| Onboarding self-service | Import + config + go, sin editar código |
| Configuración de cortesía por tenant | Sacar $480 del hardcode |
| Configuración de estaciones por tenant | Keywords en DB, no en código |
| Modificadores unificados | Un solo path, sin legacy |
| Terminal propia (hardware) | Tipo Toast/Clip, largo plazo |

### 11.4 KDS V2

Rediseño del KDS inspirado en Wansoft: realtime, batch-aware, distance-visible, con awareness de estación configurado por tenant (no por keywords). Está especificado en `docs/product/KDS-V2-SPEC.md`.

---

## 12. Referencias al código

### 12.1 Autenticación y sesión

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| Gate principal de auth | `src/app/pos/layout.tsx` | 1-end | `[HECHO]` |
| KDS_PATHS bypass | `layout.tsx` | ~30 | `[HECHO]` |
| MAX_ATTEMPTS, LOCKOUT_MS | `layout.tsx` | ~40-50 | `[HECHO]` |
| IDLE_TIMEOUT_MS (30 min) | `layout.tsx` | ~50 | `[HECHO]` |
| Cache PIN offline (`btoa`) | `layout.tsx` | ~100-130 | `[HECHO]` |
| Enrolamiento huella (4 capturas) | `layout.tsx` | ~200-300 | `[HECHO]` |
| Truco salida kiosko (logo ×5) | `layout.tsx` | ~400+ | `[HECHO]` |
| Wake Lock API | `layout.tsx` | ~350-400 | `[HECHO]` |
| TurnoGate estados | `src/components/pos/TurnoGate.tsx` | 1-end | `[HECHO]` |
| UNGATED_PATHS | `TurnoGate.tsx` | ~15 | `[HECHO]` |
| Offline turno cache | `TurnoGate.tsx` | ~80-120 | `[HECHO]` |

### 12.2 Vista de mesas

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| FLOOR_TABLES[] planograma | `src/app/pos/mesas/page.tsx` | ~1-100 | `[HECHO]` |
| Restricción cajero | `mesas/page.tsx` | render loop | `[HECHO]` |
| Refresh 5s + visibilitychange | `mesas/page.tsx` | ~150-200 | `[HECHO]` |
| Alertas tiempo (60/90 min) | `mesas/page.tsx` | render | `[HECHO]` |
| Stats header | `mesas/page.tsx` | ~250-300 | `[HECHO]` |
| Merge mode | `mesas/page.tsx` | ~300-400 | `[HECHO]` |

### 12.3 POS principal

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| ModifierModal path nuevo | `src/app/pos/page.tsx` | 154-625 | `[HECHO]` |
| DiscountModal (4 modos) | `pos/page.tsx` | 627-923 | `[HECHO]` |
| CORTESIA_POR_PERSONA=480 | `pos/page.tsx` | ~700 | `[HECHO]` |
| CancelModal (2 pasos) | `pos/page.tsx` | 925-1134 | `[HECHO]` |
| VoidOrderModal | `pos/page.tsx` | 1136-1273 | `[HECHO]` |
| CashMovementModal | `pos/page.tsx` | 1275-1476 | `[HECHO]` |
| POSContent estado principal | `pos/page.tsx` | 1478+ | `[HECHO]` |
| IVA_RATE = 0.16 | `pos/page.tsx` | ~1500 | `[HECHO]` |
| showCardConfirm (Getnet) | `pos/page.tsx` | ~1600+ | `[HECHO]` |

### 12.4 Offline y sync

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| IndexedDB schema (5 stores) | `src/lib/pos-offline-db.ts` | ~1-80 | `[HECHO]` |
| SyncQueueItem interface | `pos-offline-db.ts` | ~80-120 | `[HECHO]` |
| Resolución de transporte | `pos-offline-db.ts` | ~150-180 | `[HECHO]` |
| syncAllRunning lock | `pos-offline-db.ts` | ~200 | `[HECHO]` |
| Clases de error sync | `pos-offline-db.ts` | ~220-280 | `[HECHO]` |
| Evento pos-order-synced | `pos-offline-db.ts` | ~300+ | `[HECHO]` |
| clearSyncedItems | `pos-offline-db.ts` | ~350+ | `[HECHO]` |

### 12.5 Impresión

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| PrintJob interface | `src/lib/print-queue.ts` | ~1-60 | `[HECHO]` |
| Bridge URL (127.0.0.1:7717) | `print-queue.ts` | ~70 | `[HECHO]` |
| MAX_RETRIES=5 | `print-queue.ts` | ~80 | `[HECHO]` |
| RETRY_INTERVAL_MS=15000 | `print-queue.ts` | ~80 | `[HECHO]` |
| BRIDGE_UNAVAILABLE_ESCALATION=120000 | `print-queue.ts` | ~80 | `[HECHO]` |
| processQueue() máquina de estados | `print-queue.ts` | ~150-300 | `[HECHO]` |
| notifyListeners() evento DOM | `print-queue.ts` | ~320 | `[HECHO]` |
| retryAllStuck() | `print-queue.ts` | ~340+ | `[HECHO]` |
| Persistencia localStorage | `print-queue.ts` | ~100-120 | `[HECHO]` |

### 12.6 KDS y barra

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| Poll 2s + timer 10s | `src/app/pos/kds/page.tsx` | ~30-60 | `[HECHO]` |
| STATION_KEYWORDS | `kds/page.tsx` | ~80-120 | `[HECHO]` |
| kds_item_status per-item | `kds/page.tsx` | ~200-250 | `[HECHO]` |
| Auto-avance a 'lista' | `kds/page.tsx` | ~260-300 | `[HECHO]` |
| Alerta sonora (880/1100/880Hz) | `kds/page.tsx` | ~180-210 | `[HECHO]` |
| Colores tiempo (10/20 min) | `kds/page.tsx` | render | `[HECHO]` |
| FIFO sort | `src/app/pos/barra/page.tsx` | ~50 | `[HECHO]` |
| Guard unidireccional STATUS_ORDER | `barra/page.tsx` | ~100 | `[HECHO]` |
| Alerta sonora barra (660Hz) | `barra/page.tsx` | ~150 | `[HECHO]` |

### 12.7 Turno y cierre

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| CorteXModal (window.print) | `src/app/pos/turno/page.tsx` | ~100-200 | `[HECHO]` |
| CierreCajaWizard (2 pasos) | `src/components/pos/CierreCajaWizard.tsx` | 1-end | `[HECHO]` |
| Denominaciones sin guardar | `CierreCajaWizard.tsx` | paso 1 | `[HECHO]` |
| Barrera sync antes de cierre | `CierreCajaWizard.tsx` | paso 2 | `[HECHO]` |
| Inferencia salida asistencia | `CierreCajaWizard.tsx` | final | `[HECHO]` |
| Arqueo efectivo (fórmula) | `CierreCajaWizard.tsx` | paso 2 | `[HECHO]` |

### 12.8 Corte de caja

| Tema | Archivo | Líneas | Estado |
|------|---------|--------|--------|
| Gate manager PIN | `src/app/pos/corte/page.tsx` | ~1-50 | `[HECHO]` |
| Modo turno vs día | `corte/page.tsx` | ~60-100 | `[HECHO]` |
| Desglose pagos[] array | `corte/page.tsx` | ~120-180 | `[HECHO]` |
| Por-mesero breakdown | `corte/page.tsx` | ~300-400 | `[HECHO]` |
| Reabrir orden (reopenOrder) | `corte/page.tsx` | ~400-450 | `[HECHO]` |
| Export CSV con BOM | `corte/page.tsx` | ~460+ | `[HECHO]` |

### 12.9 Discrepancias detectadas

> ⚠️ DISCREPANCIA: `docs/archive/pos-logica-operativa.md` (archivado) menciona que fue "reemplazado por reference/wansoft/CAJA-SPEC.md". Sin embargo, la información sobre el modelo de órdenes en ese archivo menciona campos que pueden no coincidir con el schema actual de `pos_orders`. No se auditó CAJA-SPEC.md en esta sesión. Verificar antes de confiar en cualquiera de los dos para el schema exacto.

> ⚠️ DISCREPANCIA: `docs/product/WANSOFT-POS-BIBLE.md` (solo primeras 150 líneas auditadas) menciona que AMALAY tiene el mapa físico de Wansoft desactivado y usa la vista de cards. Sin embargo, `mesas/page.tsx` en Fullsite sí tiene el planograma físico como opción principal. No es contradicción — Wansoft no tiene mapa en AMALAY, Fullsite sí lo implementó — pero es importante no confundir el estado de Wansoft con el estado de Fullsite.

> ⚠️ DISCREPANCIA: La documentación de sesión indica que existe integración con Mercado Pago Point, pero en el código revisado de `pos/page.tsx` el pago con tarjeta muestra `showCardConfirm` (flujo manual con Getnet). No se confirmó en qué archivo o branch vive la integración de MP Point, ni si está activa en producción.

---

## Apéndice A: Tablas de Supabase relevantes al POS

| Tabla | Propósito |
|-------|----------|
| `pos_orders` | Órdenes: activas, cerradas, canceladas |
| `pos_turnos` | Turnos de caja (apertura/cierre) |
| `pos_cierres` | Registros de cierre de caja |
| `pos_cash_movements` | Retiros y depósitos de efectivo |
| `pos_attendance` | Entradas/salidas del personal |
| `pos_print_jobs` | Cola de impresión (sync opcional) |
| `pos_inventory` | Stock de ingredientes |
| `pos_payment_methods` | Métodos de pago y comisiones |
| `delivery_orders` | Órdenes de Uber Eats y Rappi |
| `menu_items` | Ítems del menú con precios y categorías |
| `menu_categories` | Categorías del menú |
| `staff` | Empleados con roles y PINs |
| `reservaciones` | Reservaciones (solo lectura en POS) |
| `factura_requests` | Solicitudes CFDI |
| `pos_audit_log` | Log de auditoría de todas las acciones |

---

## Apéndice B: Constantes del sistema

| Constante | Valor | Archivo |
|----------|-------|---------|
| `IVA_RATE` | `0.16` | `pos/page.tsx`, `facturacion/page.tsx` |
| `CORTESIA_POR_PERSONA` | `480` | `pos/page.tsx` |
| `MAX_ATTEMPTS` (PIN) | `5` | `pos/layout.tsx` |
| `LOCKOUT_MS` | `60000` (1 min) | `pos/layout.tsx` |
| `IDLE_TIMEOUT_MS` | `1800000` (30 min) | `pos/layout.tsx` |
| `PIN_CACHE_TTL` | `900000` (15 min) | `pos/layout.tsx` |
| `FINGER_ENROLL_CAPTURES` | `4` | `pos/layout.tsx` |
| `MAX_RETRIES` (impresión) | `5` | `print-queue.ts` |
| `RETRY_INTERVAL_MS` | `15000` (15s) | `print-queue.ts` |
| `BRIDGE_UNAVAILABLE_ESCALATION_MS` | `120000` (2 min) | `print-queue.ts` |
| `BRIDGE_HEALTH_TTL` | `10000` (10s) | `print-queue.ts` |
| `BRIDGE_HEALTH_TIMEOUT` | `800` (0.8s) | `print-queue.ts` |
| `KDS_POLL_INTERVAL` | `2000` (2s) | `kds/page.tsx` |
| `MESAS_REFRESH_INTERVAL` | `5000` (5s) | `mesas/page.tsx` |
| `MESAS_CACHE_TTL` | `30000` (30s) | `mesas/page.tsx` |
| `DELIVERY_REFRESH_INTERVAL` | `10000` (10s) | `delivery/page.tsx` |
| `TURNO_GATE_POLL_MS` | `5000` (5s) | `TurnoGate.tsx` |
| `MESA_WARN_MINUTES` | `60` | `mesas/page.tsx` |
| `MESA_ALERT_MINUTES` | `90` | `mesas/page.tsx` |
| `OFFLINE_WARN_MINUTES` | `120` | `TurnoGate.tsx` |
| `PRINT_BRIDGE_URL` | `http://127.0.0.1:7717` | `print-queue.ts` |
| `FINGER_SERVICE_URL` | `http://127.0.0.1:7717/fp` | `pos/layout.tsx` |

---

## Apéndice C: Variables de entorno requeridas

| Variable | Uso |
|---------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL base de PostgREST |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | API key pública |
| `NEXT_PUBLIC_CLIENT_ID` | ID del tenant activo |
| `SUPABASE_SERVICE_ROLE_KEY` | Key de servicio para rutas `/api/` |

---

---

## 13. Open Questions & Future Work

Esta sección es el backlog arquitectónico del módulo POS. Incluye dudas no resueltas durante el análisis, deuda técnica, decisiones pendientes e inconsistencias encontradas.

---

**[DEUDA]** Offline boot — bundle no empaquetado en Electron
> Descripción: El app Electron carga desde Vercel. Sin internet en arranque, el POS no funciona en absoluto. El modo offline solo aplica si ya estaba cargado.
> Impacto: Cualquier corte de internet al inicio del turno = POS inoperable, ventas perdidas.
> Prioridad sugerida: P0 — blocker para cutover de Wansoft.

---

**[DEUDA]** Denominaciones de cierre no se persisten
> Descripción: El CierreCajaWizard muestra UI completa para contar billetes y monedas, pero guarda `{}` (JSON vacío) en el campo de denominaciones de `pos_cierres`. Solo el monto total queda registrado.
> Impacto: Sin auditoría del conteo detallado. Si hay diferencia de arqueo, no se sabe cómo se contó.
> Prioridad sugerida: P1 — importante para confianza del gerente en el sistema.

---

**[DECISIÓN]** Dos sistemas de modificadores en paralelo (legacy + nuevo stepped)
> Descripción: Existen el path legacy (quitar/agregar) y el path nuevo (grupos stepped) corriendo simultáneamente. No está documentado qué ítems usan cuál. `getModifierGroupsForItem()` puede devolver vacío cayendo al legacy silenciosamente.
> Impacto: Experiencia de modificadores inconsistente entre ítems. Confusión para staff y para el ingeniero que mantiene el código.
> Decisión pendiente: ¿Se migra todo al nuevo sistema stepped? ¿Se elimina el legacy? ¿O coexisten con documentación clara de cuándo aplica cada uno?
> Prioridad sugerida: P1 — bloquea onboarding de nuevos restaurantes con modificadores complejos.

---

**[DUDA]** Mecanismo de session locking entre terminales no confirmado
> Descripción: El sistema debe invalidar la sesión de un empleado en terminal A cuando hace login en terminal B. El mecanismo exacto de propagación no fue verificado en el código.
> Impacto: Si el mecanismo no funciona, el mismo empleado puede estar "logueado" en dos terminales simultáneamente — riesgo de fraude o confusión.
> Prioridad sugerida: P1 — verificar antes del cutover.

---

**[INCONSISTENCIA]** Integración Mercado Pago Point vs flujo manual Getnet
> Descripción: La documentación del proyecto menciona integración con Mercado Pago Point para pagos con tarjeta. Sin embargo, el código de `pos/page.tsx` muestra `showCardConfirm` — una pantalla manual para que el cajero ingrese el monto en la terminal Getnet física. No se encontró el código de integración MP Point.
> Impacto: Si MP Point no está activo, el 100% de los pagos con tarjeta son manuales. Riesgo de error humano al ingresar montos incorrectos.
> Acción: Verificar si la integración MP Point existe en otra branch o si fue descartada.
> Prioridad sugerida: P1 — clarificar antes del cutover.

---

**[DEUDA]** STALE_WRITE_CONFLICT sin UI de resolución
> Descripción: Items en `STALE_WRITE_CONFLICT` en la sync_queue quedan indefinidamente. No hay UI para ver cuáles son, ni para resolverlos o purgarlos manualmente.
> Impacto: El contador de "pendientes" incluye items irresolubles. El personal no puede distinguir entre "pendiente de sync" y "bloqueado por conflicto para siempre".
> Prioridad sugerida: P1 — necesario para operación multi-terminal.

---

**[DEUDA]** Planograma hardcoded para AMALAY
> Descripción: Las 28 mesas, sus posiciones, formas, zonas y las "paredes" del restaurante están hardcoded en `FLOOR_TABLES[]` de `mesas/page.tsx`. No hay editor ni tabla en DB.
> Impacto: Para cualquier nuevo restaurante, se requiere editar código fuente y hacer deploy.
> Prioridad sugerida: P2 — aplaza el onboarding self-service hasta que se resuelva.

---

**[DEUDA]** Número de orden no secuencial
> Descripción: Wansoft usa números secuenciales por turno (72, 73...). Fullsite usa UUID; la UI muestra los primeros 8 caracteres hex. El staff no puede referirse a órdenes por número en conversación verbal.
> Impacto: Fricción operativa. "La orden 73" no existe en Fullsite. El staff tiene que aprender a referirse por mesa/mesero.
> Prioridad sugerida: P1 — UX blocker para adopción del staff.

---

**[DEUDA]** Reimpresión de historial y corte via window.print(), no via bridge
> Descripción: La reimpresión de tickets desde historial y el corte parcial (CorteX) usan `window.print()` del browser, no la cola de impresión del bridge Electron.
> Impacto: En modo kiosko, abre el diálogo de impresión del OS en vez de ir directo a la impresora de caja. Puede confundir al staff.
> Prioridad sugerida: P1 — arreglar antes o inmediatamente después del cutover.

---

**[DUDA]** Estado real de integración con webhooks de Uber Eats y Rappi
> Descripción: Los estados `en_ruta` y `entregada` de delivery se esperan de webhooks de las plataformas. No se verificó si los webhooks están configurados y activos en producción.
> Impacto: Si no están activos, las órdenes quedan en `lista` indefinidamente en la UI de delivery. No es operativamente crítico (las órdenes físicamente se entregan igual) pero el historial no refleja realidad.
> Prioridad sugerida: P2 — verificar estado, configurar si es necesario.

---

**[INCONSISTENCIA]** Schema de pos_orders en código vs documentación archivada
> Descripción: `docs/archive/pos-logica-operativa.md` fue archivado indicando que fue "reemplazado por reference/wansoft/CAJA-SPEC.md". Los campos de pos_orders documentados ahí pueden estar desactualizados respecto al schema real en Supabase.
> Impacto: Un ingeniero que lea esa documentación archivada puede construir queries incorrectos.
> Acción: Verificar el schema real de `pos_orders` en Supabase y documentarlo en Domain Bible.
> → Ver [Domain Bible § Order] cuando esté disponible.
> Prioridad sugerida: P1 — riesgo de bugs en nuevas features.

---

**[DECISIÓN]** Cortesía hardcoded a $480/persona
> Descripción: `CORTESIA_POR_PERSONA = 480` está en el código de `pos/page.tsx`. No es configurable.
> Impacto: Para cualquier restaurante con diferente política de cortesía, hay que editar código.
> Decisión pendiente: Mover a configuración de tenant en Supabase (`pos_config` tabla o similar).
> Prioridad sugerida: P2 — bloquea multi-tenant real.

---

**[DEUDA]** Lockout de PIN por dispositivo, no por empleado
> Descripción: El contador de intentos fallidos de PIN es global al terminal, no por empleado. Empleado A falla 4 veces + Empleado B falla 1 vez = terminal bloqueado aunque ninguno llegó al límite individualmente.
> Impacto: Lockouts accidentales en restaurantes con mucha rotación de staff en el terminal.
> Prioridad sugerida: P2 — UX issue, no blocker.

---

*Documento generado el 2026-07-23 desde auditoría directa del código fuente del repositorio `dashboard-app`.*
*Para mantener vigente: al modificar cualquiera de los archivos referenciados, actualizar la sección correspondiente con los cambios y verificar las invariantes.*
