# RFC — P0-4: Local-First Restaurant Runtime & Offline Continuity
> Versión: 2.0
> Fecha: 2026-07-24
> Estado: DESIGN GATE — no implementable hasta que este RFC sea aprobado por Daniel
> Referencia: P0-EXECUTION-PLAN.md § P0-4, WANSOFT ARCHITECTURE.md § 15
> Audit de código: 2026-07-24 (contratos verificados contra source)

---

## Principio rector

**Internet debe ser una capa de sincronización y servicios remotos, no una dependencia para operar el restaurante.**

POS, KDS, cocina, barra, impresoras, autorizaciones y comunicación entre terminales deben funcionar completamente dentro de la LAN local. Supabase y Vercel son la capa de sincronización y el panel de control — no el bus operativo.

Este principio está validado por evidencia de campo: Wansoft opera bajo este modelo durante 20 años. Lo que cambia en Fullsite no es el principio sino las tecnologías: en lugar de SQL Server + IIS + APK Android, usamos IndexedDB + Node.js local + Next.js PWA.

---

## Cambio de alcance respecto al P0-4 original

| Original | Nuevo |
|---|---|
| "Boot offline real en Electron" | "Local-First Restaurant Runtime & Offline Continuity" |
| Problema: bundle no embebido → pantalla blanca al arrancar | Problema: todos los componentes operativos dependen de internet para funcionar |
| Solución: empaquetar el bundle en Electron | Solución: arquitectura local-first con sincronización diferida |

El boot offline es parte del problema, no el problema completo. Si solo embebemos el bundle pero el KDS sigue haciendo fetch a Supabase, el restaurante opera a medias sin internet. El alcance correcto es: Fullsite debe poder arrancar y operar completamente sin internet en todos sus componentes operativos.

---

## 1. Estado actual — Diagrama de dependencias

```
╔══════════════════════════════════════════════════════════════════════╗
║  FULLSITE HOY — qué requiere internet para operar                    ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  [Electron app]                                                      ║
║      ↓ carga bundle desde                                            ║
║  [Vercel CDN] ←─── INTERNET REQUERIDO para arrancar ❌              ║
║                                                                      ║
║  [POS /pos]                                                          ║
║      ↓ órdenes, catálogo, turno, staff                               ║
║  [Supabase API] ←── INTERNET requerido para datos ❌                ║
║      (mid-op offline parcial vía IndexedDB — órdenes solamente)      ║
║                                                                      ║
║  [KDS /pos/kds]                                                      ║
║      ↓ polling de órdenes via fetch()                                ║
║  [Supabase API] ←── INTERNET requerido, polling cada N seg ❌       ║
║                                                                      ║
║  [Cocina /pos/cocina]                                                ║
║      ↓ polling de órdenes via fetch()                                ║
║  [Supabase API] ←── INTERNET requerido ❌                           ║
║                                                                      ║
║  [Barra /pos/barra]                                                  ║
║      ↓ polling de órdenes via fetch()                                ║
║  [Supabase API] ←── INTERNET requerido ❌                           ║
║                                                                      ║
║  [PIN auth]                                                          ║
║      ↓ verifica usuario                                              ║
║  [localStorage cache 15min] ←── LOCAL ✅ pero TTL de 15 min         ║
║                                                                      ║
║  [Print bridge]                                                      ║
║      ↓ POST a localhost:3000                                         ║
║  [Electron/Node.js local] ←── LAN ✅ ya funciona offline            ║
║                                                                      ║
║  [Impresoras]                                                        ║
║      ↓ USB / TCP                                                     ║
║  [Hardware local] ←── LAN ✅ ya funciona offline                    ║
║                                                                      ║
║  [CFDI]                                                              ║
║      ↓ POST a Facturama                                              ║
║  [Facturama API] ←── INTERNET requerido (cola offline ya existe) ⚠  ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝

Resumen: 5 de 8 componentes operativos requieren internet.
Lo que ya funciona offline: impresión, PIN (15 min), cola de órdenes (mid-op).
```

---

## 2. Estado objetivo — Local-First Architecture

```
╔══════════════════════════════════════════════════════════════════════╗
║  FULLSITE LOCAL-FIRST — operación sin internet                       ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  [Electron app]                                                      ║
║      ↓ carga bundle embebido (filesystem)                            ║
║  [Local bundle] ←── LAN ✅ arranca sin internet                     ║
║                                                                      ║
║  [Local Runtime (Node.js en Electron)]                               ║
║  ┌─────────────────────────────────────────────────────────────┐     ║
║  │  Coordinador local (evolución del print bridge)             │     ║
║  │  ├── Servidor HTTP local (localhost:3000)                   │     ║
║  │  ├── WebSocket LAN (ws://192.168.1.X:3001)                 │     ║
║  │  ├── SQLite o IDB como fuente de verdad local               │     ║
║  │  ├── Cola de sincronización (eventos pendientes)            │     ║
║  │  └── Reconciliador con Supabase (cuando hay internet)       │     ║
║  └─────────────────────────────────────────────────────────────┘     ║
║             ↑                    ↑                                   ║
║  [POS /pos]              [KDS / Cocina / Barra]                     ║
║  fetch() a localhost     WebSocket a localhost:3001                  ║
║  LAN ✅                  LAN ✅                                      ║
║                                                                      ║
║  [PIN auth]                                                          ║
║  ├── PIN cache sin TTL fijo (renovación al reconectar)              ║
║  └── Staff table en IDB local                                        ║
║  LAN ✅                                                              ║
║                                                                      ║
║  [Impresión]                                                         ║
║  Print bridge local — sin cambios                                    ║
║  LAN ✅                                                              ║
║                                                                      ║
║  [CFDI]                                                              ║
║  Cola local → Facturama al reconectar (comportamiento actual)        ║
║  ⚠ Requiere internet — aceptable (no es operativo crítico)          ║
║                                                                      ║
║             ┌── cuando hay internet ──────────────────────┐         ║
║             ↓                                             ↓         ║
║  [Supabase]                                   [Vercel CDN]          ║
║  Sincronización diferida                      No requerido          ║
║  Analytics, dashboard, CFDI                   para operación        ║
║  Gestión multi-tenant                                                ║
║  └────────────────────────────────────────────────────────┘         ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 3. Componentes — análisis por área

### 3.1 Bundle / Boot

**Pregunta:** ¿Cómo hace Fullsite para que la app arranque sin internet?

**Estado actual:** Electron carga `https://[proyecto].vercel.app/pos` como WebView remota. Sin internet = pantalla blanca.

**Alternativas:**

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| A — Static export + `electron-serve` | `next export` genera bundle estático; electron-serve lo sirve desde filesystem | Simple, compatible con Next.js | Las rutas API de Next.js no funcionan (no hay servidor) — las llamadas deben ir directo a Supabase o al coordinador local |
| B — Protocol handler | Electron registra `app://` y sirve archivos embebidos sin servidor HTTP | Sin servidor extra, limpio | Más complejo de configurar con Next.js; mismo límite de rutas API |
| C — Exportación + servidor Node.js embebido | `next build` completo + servidor Next.js corriendo dentro de Electron | Rutas API funcionan | Bundle más grande, más complejo, Next.js server puede ser pesado para Electron |

**Recomendación preliminar:** Opción A. El POS en `/pos` ya usa fetch() directo a Supabase o al print bridge — no depende de las API routes de Next.js para la operación. Necesita verificarse con el RCA técnico.

**RCA requerido:**
1. ¿Qué rutas API usa el POS en operación? (`grep -r 'fetch.*api' src/app/pos/`)
2. ¿Next.js está configurado para `output: 'export'` o solo server-side?
3. ¿Cómo está construido el `.exe` actualmente — webpack, electron-builder?

### 3.2 Fuente de verdad local

**Pregunta:** ¿Dónde viven los datos cuando no hay internet?

**Estado actual:** IndexedDB (`pos-offline-db`) guarda la cola de órdenes pendientes. No hay catálogo, staff ni configuración local.

**Qué necesita estar en local:**
- Catálogo completo (platillos, modificadores, precios, grupos)
- Staff (usuarios, PINs, roles, permisos)
- Configuración operativa (mesas, impresoras, secciones)
- Órdenes activas (pendientes de cobro)
- Cola de eventos para sincronización

**Alternativas:**

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| A — Extender IDB existente | Agregar stores a `pos-offline-db` para catálogo, staff, config | Ya existe, sin nueva dependencia | IDB no es accesible desde Node.js (solo desde el renderer); dificulta coordinador local |
| B — SQLite via `better-sqlite3` en Electron main | Base de datos SQLite en el proceso principal de Electron | Accesible desde Node.js y renderer via IPC; queries síncronos; robusto | Nueva dependencia; requiere IPC entre renderer y main |
| C — Dual: IDB para renderer, SQLite para coordinador | IDB para estado UI, SQLite para el coordinador local | Cada proceso accede a su store nativo | Duplicación; sincronización entre IDB y SQLite |

**Recomendación preliminar:** Opción B (SQLite). El coordinador local necesita acceder a los datos sin pasar por el renderer. IDB no cumple ese requisito. `better-sqlite3` es madura y ampliamente usada en Electron.

### 3.3 Comunicación LAN entre terminales (KDS, Cocina, Barra)

**Pregunta:** ¿Cómo recibe el KDS las órdenes nuevas sin Supabase Realtime?

**Estado actual:** KDS, Cocina y Barra hacen polling via `fetch()` a Supabase. Sin internet = no llegan órdenes.

**Alternativas:**

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| A — WebSocket desde el coordinador local | El coordinador local en Electron/Caja expone un WebSocket en LAN (`ws://192.168.1.71:3001`); KDS/Cocina/Barra se conectan a él | Push real-time; latencia ~0ms; sin internet | KDS debe conocer la IP del coordinador; requiere configuración por restaurante |
| B — Polling a coordinador local via HTTP | KDS hace fetch a `http://192.168.1.71:3001/orders` en lugar de a Supabase | Simple, mismo patrón actual | Sigue siendo polling; latencia igual a interval |
| C — mDNS / autodiscovery | El coordinador anuncia su presencia en la LAN via mDNS; KDS lo descubre automáticamente | Sin configuración manual de IPs | Más complejo; no todos los entornos soportan mDNS correctamente |

**Recomendación preliminar:** Opción A (WebSocket LAN) como principal, con autodiscovery simple via IP configurable en Supabase (descargada al iniciar y cacheada). La IP del coordinador local es estable en cada restaurante — se configura una vez.

### 3.4 Autenticación y autorizaciones sin internet

**Pregunta:** ¿Cómo funciona el PIN y las autorizaciones de gerente sin Supabase?

**Estado actual:** PIN auth: `localStorage['pos_auth_cache']` con TTL de 15 minutos. Al vencer el TTL, hace fetch a Supabase. Sin internet + TTL vencido = no puede autenticarse.

**Alternativas:**

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| A — Staff table en SQLite local | Toda la tabla de staff (id, nombre, PIN hasheado, rol) se sincroniza al coordinador local al conectar; el PIN se verifica localmente sin TTL fijo | Sin TTL; funciona indefinidamente offline | PIN hash debe ser seguro (bcrypt/argon2); sincronizar staff a local requiere lógica de merge |
| B — Extender TTL del cache actual | Aumentar el TTL de 15 min a 24-48 horas | Mínimo cambio | Sigue siendo un parche; un turno de 12h puede fallar |
| C — IDB + Service Worker para staff | Staff en IDB, Service Worker lo sirve al renderer | Sin dependencia de Electron main | No accesible para coordinador local |

**Recomendación preliminar:** Opción A. El coordinador local descarga y mantiene la tabla de staff en SQLite. El PIN se verifica contra el hash local. La sincronización con Supabase ocurre al reconectar.

### 3.5 Huellas digitales sin internet

**Pregunta:** ¿Cómo funciona el lector de huellas sin Supabase?

**Estado actual:** El lector HID DigitalPersona 4500 está identificado. El flujo de verificación aún no está implementado para operación local.

**Opciones:**
- Los templates de huella pueden almacenarse en SQLite local (misma estrategia que el staff)
- La verificación ocurre localmente via SDK nativo o bridge
- Sin internet, la huella verifica contra el template local

Este punto hereda la solución del bloqueador existente de huella digital (P0 huella, separado). El local-first no agrega complejidad — si hay un bridge de huella, el template viene de SQLite local.

### 3.6 Impresión

Sin cambios. El print bridge ya funciona localmente vía `localhost:3000`. Se mantiene como está.

### 3.7 Sincronización con Supabase al reconectar

**Pregunta:** ¿Cómo sincronizamos los datos locales con Supabase sin perder ni duplicar?

**Principios:**
1. Cada evento tiene un `id` único (UUID) generado localmente al crearse — idempotencia garantizada.
2. El coordinador local mantiene una cola ordenada de eventos pendientes (append-only).
3. Al reconectar: `syncAll()` envía la cola a Supabase. Supabase ignora duplicados por `id` (upsert por PK).
4. Los eventos son inmutables una vez creados — no se editan, solo se agregan.

**Conflictos entre terminales:**
- Mismo turno operando en PDV1 y Caja simultáneamente: los eventos de ambas máquinas llegan a Supabase con timestamps locales. El conflicto más común es doble cobro de la misma mesa.
- Resolución: `orden_id` + `terminal_id` en cada evento. Supabase rechaza el segundo cobro si `estado = cobrada`.
- Merges complejos (modificaciones de la misma orden desde dos terminales sin internet) quedan como PENDIENTE DE VALIDACIÓN — requieren prueba en campo.

### 3.8 Empaquetado del frontend para boot offline

El bundle de Next.js debe estar embebido en el instalador de Electron. Esto implica:
1. Pipeline de build: `next build` → `next export` → incluir `out/` en el paquete de Electron
2. `electron-builder` copia `out/` a los resources del `.exe`
3. `electron-serve` (o protocol handler) sirve desde esa carpeta al iniciar
4. La URL que ve el renderer cambia de `https://...vercel.app/pos` a `app://pos` o `http://localhost:3000/pos`

RCA requerido: ¿el build actual usa `electron-builder`? ¿Dónde está el script de build del `.exe`?

---

## 4. Plan de migración por fases

Las fases no son todas independientes. El orden importa.

```
Fase 0 — RCA técnico (1-2 días)
    └── Responder las 5 preguntas del P0-EXECUTION-PLAN.md § P0-4
        + 3 preguntas adicionales de este RFC
    Bloquea: todas las demás fases

Fase 1 — Boot offline (bundle embebido)
    Entregable: la app Electron arranca sin internet y carga el POS
    Bloquea: validación de todas las demás fases (sin boot, no hay nada)
    Dependencia: Fase 0

Fase 2 — Datos locales (SQLite + staff + catálogo)
    Entregable: catálogo, staff y configuración disponibles offline
    Dependencia: Fase 1
    Valida: PIN sin TTL, platillos en POS offline

Fase 3 — KDS / Cocina / Barra por LAN
    Entregable: órdenes enviadas desde el POS aparecen en KDS/cocina/barra sin internet
    Dependencia: Fase 2 (necesita catálogo local para renderizar)

Fase 4 — Sincronización robusta con Supabase
    Entregable: al reconectar, todos los eventos se sincronizan sin pérdida ni duplicación
    Dependencia: Fase 3

Fase 5 — Certificación en AMALAY
    Entregable: prueba de estrés completa (ver criterios abajo)
    Dependencia: Fase 4
```

---

## 5. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Next.js usa rutas API críticas que no exportan estáticamente | Media | Alto | RCA Fase 0 — auditar fetch calls del POS antes de comprometerse con static export |
| IDB del Electron no persiste entre reinicios en algunos sistemas | Baja | Alto | Verificar en campo en AMALAY; SQLite como respaldo más robusto |
| IP del coordinador cambia (DHCP sin reserva) | Media | Alto | Configurar IP estática en el router de AMALAY para la Caja |
| Conflictos de merge en órdenes editadas desde dos terminales | Media | Medio | Diseño de evento inmutable + orden_id único; validar en campo |
| Sincronización lenta con colas grandes (>8 horas offline) | Baja | Medio | Sync incremental por lote con progress indicator |
| El APK Comandero de Wansoft y el print bridge conviviendo en la misma red | N/A | Bajo | Son redes separadas; no hay colisión de puertos |
| Bundle embebido desactualizado vs. Vercel | Media | Bajo | El updater de Electron descarga bundle nuevo al reconectar |

---

## 6. Preguntas de RCA técnico (Fase 0)

Del P0-EXECUTION-PLAN.md:
1. ¿Dónde está el código de Electron? (`electron/`, `apps/electron/`, o en el repo?)
2. ¿Cómo se construye el `.exe` actualmente? (webpack, electron-builder, otro)
3. ¿Next.js está configurado para exportar estático (`output: 'export'`) o es server-side?
4. ¿Hay rutas API de Next.js que el POS usa en operación, o solo fetch() directo a Supabase?
5. ¿El IDB del Electron app persiste entre reinicios en el filesystem local?

Adicionales de este RFC:
6. ¿Qué endpoints de Supabase consulta el KDS/cocina/barra — REST o Realtime?
7. ¿`better-sqlite3` o `@electron/remote` tienen restricciones en el build actual?
8. ¿El print bridge ya tiene un proceso Node.js estable que pueda extenderse, o es un módulo dentro del renderer?

---

## 7. Criterios de certificación en AMALAY

La certificación de P0-4 requiere que TODOS los siguientes pasos pasen con video continuo sin cortes:

### 7.1 Arranque sin internet
- [ ] Apagar el router o desconectar el cable de red de la Caja
- [ ] Abrir la app Electron → el POS carga completamente (menú, mesas, botones)
- [ ] El catálogo muestra los platillos correctos (del último sync)
- [ ] El staff puede entrar con PIN

### 7.2 Operación completa sin internet
- [ ] Tomar una orden en el POS → enviar a cocina
- [ ] KDS/cocina/barra recibe la orden (sin internet, por LAN)
- [ ] La orden se puede avanzar de estado desde cocina (en producción → lista)
- [ ] La orden se puede cobrar desde el POS
- [ ] El ticket se imprime correctamente

### 7.3 Autorización sin internet
- [ ] Una acción que requiere gerente (descuento, cancelación) → pide PIN de gerente → funciona sin internet

### 7.4 Reconexión sin pérdida
- [ ] Reconectar el router
- [ ] La app detecta la reconexión → muestra indicador de sync
- [ ] Las órdenes tomadas offline aparecen en el Dashboard dentro de los 60 segundos
- [ ] Sin duplicados en el Dashboard
- [ ] Sin errores en el audit log

### 7.5 Operación desde segunda terminal (si aplica)
- [ ] PDV1 también puede tomar órdenes y verlas en KDS durante el offline de internet

### Restricciones de certificación
- La certificación se ejecuta con operación real (no datos de prueba) o con simulación documentada
- Si falla cualquier check: se registra exactamente qué falló, con qué condición, y se regresa al ciclo de corrección. No se omiten checks.
- Evidencia requerida: video continuo desde que se desconecta el router hasta que se confirma la sincronización post-reconexión.

---

## 8. Decisiones que Daniel debe aprobar antes de implementar

1. ¿Opción A (static export) o alguna otra para el bundle?
2. ¿SQLite como fuente de verdad local, o IDB extendida?
3. ¿WebSocket LAN para KDS, o HTTP polling al coordinador local?
4. ¿El coordinador local es una evolución del print bridge actual, o un proceso nuevo?
5. ¿Qué TTL o política de renovación para el staff local cacheado?

---

---

---

# SECCIÓN 2 — COMPATIBILITY-FIRST MIGRATION STRATEGY
> Añadida: 2026-07-24
> Basada en audit de código completo del codebase. Todos los contratos verificados contra source.

---

## CF-1. Principios de la migración

1. **No eliminar ni modificar el flujo actual contra Supabase.** El flujo actual sigue operando en paralelo mientras se construye la capa local.
2. **No cambiar contratos existentes sin capa de compatibilidad.** Toda funcionalidad nueva mantiene el contrato de entrada/salida actual.
3. **Feature flags por sucursal y por terminal.** Ningún comportamiento nuevo activa sin flag explícito.
4. **Cada fase tiene rollback independiente.** Desactivar un flag = regresar al estado anterior.
5. **Primero observar y duplicar tráfico. Después cambiar lecturas. Al final cambiar escrituras.**
6. **El sistema debe funcionar en 500 sucursales, no solo en AMALAY.** Cada decisión se evalúa contra ese escenario.
7. **Nada implementable hasta que este RFC esté aprobado y el RCA técnico esté completo.**

---

## CF-2. Arquitectura actual reconciliada

### Topología de procesos hoy

```
╔══════════════════════════════════════════════════════════╗
║  AMALAY — CAJA TERMINAL (192.168.1.71)                   ║
║                                                          ║
║  electron-app/main.js                                    ║
║  ├── WebView → https://app.fullsite.mx/pos               ║
║  │   (POS React/Next.js — bundle en Vercel)              ║
║  ├── Bridge embebido: 127.0.0.1:7717                     ║
║  │   GET  /health                                        ║
║  │   POST /print   {station, data: base64}               ║
║  │   POST /drawer                                        ║
║  │   POST /test                                          ║
║  │   GET|POST /config   C:\fullsite\printers.json        ║
║  │   /fp/*  → proxy a 127.0.0.1:7718                    ║
║  └── Fingerprint service: 127.0.0.1:7718                 ║
║      fingerprint-service.exe + DPUruNet.dll              ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════╗
║  COCINA / BARRA TERMINAL(ES) (192.168.1.68, .4, .69)    ║
║                                                          ║
║  electron-kds/main.js                                    ║
║  └── WebView → https://app.fullsite.mx/pos/cocina        ║
║      (sin bridge, sin fingerprint)                       ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════╗
║  INTERNET / CLOUD                                        ║
║                                                          ║
║  Vercel CDN      → bundle JS/CSS del POS y KDS           ║
║  Vercel Functions → /api/pos/save-order                  ║
║                    /api/pos/pin                          ║
║  Supabase REST   → lectura/escritura de todas las        ║
║                    tablas (polling KDS 2s)               ║
║  Supabase RPC    → r1_save_order_idempotent              ║
║                    r1_reconcile_order                    ║
║  Facturama API   → CFDI (cola IDB si offline)            ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

### Flujos actuales con contratos exactos

#### A. Creación y actualización de órdenes

| Elemento | Valor exacto |
|---|---|
| Endpoint | `POST /api/pos/save-order` (Next.js API Route en Vercel) |
| Función cliente | `saveOrder(order, saveOperationId?)` — `pos-data.ts:1120` |
| Idempotency key | `save_operation_id` (UUID) — campo `p_save_operation_id` en RPC |
| Supabase RPC | `r1_save_order_idempotent` (nuevo) / `r1_save_order` (legacy) |
| Tabla principal | `pos_orders` |
| Enforcement | Requiere `turno_id` no nulo — error `NO_TURNO` si falta |
| Offline fallback | IDB store `sync_queue`, transport `'APP_API'` |
| Retry actor | `syncAll()` via `replayViaAppApi()` — `pos-offline-db.ts:360` |
| Conflicto | `{ ok: false, conflict: true }` → `STALE_WRITE_CONFLICT`, no se reintenta |

**Request body canónico:**
```typescript
{
  order_id: string,        // UUID — PK inmutable
  expected_revision: number,
  save_operation_id?: string,
  mesa: number | null,
  customer_name: string | null,
  mesero: string,
  personas: number | null,
  status: 'abierta'|'enviada'|'preparando'|'lista'|'entregada'|'cerrada'|'cancelada',
  subtotal: number | null,
  iva: number | null,
  total: number | null,
  descuento: number | null,
  propina: number | null,
  metodo_pago: string | null,
  pagos: { metodo: string; monto: number }[] | null,
  turno_id: string | null,   // OBLIGATORIO para cualquier orden
  notas: string | null,
  items: OrderItem[],
  closed_at: string | null,
  comanda_batches?: Record<string, { status, created_at, seq }>
}
```

#### B. KDS / Cocina / Barra — polling

| Elemento | Valor exacto |
|---|---|
| Función cliente | `getKitchenOrders()` — `pos-data.ts:1273` |
| Endpoint | Supabase REST directo (no API Route) |
| URL | `/rest/v1/pos_orders?status=in.(enviada,preparando,lista)&client_id=eq.{clientId}&created_at=gte.{12h_ago}&order=created_at.desc` |
| Auth | Headers `apikey` y `Authorization: Bearer {anon_key}` (anon key pública) |
| Intervalo | 2000ms (`setInterval(fetchOrders, 2000)`) |
| Offline fallback | IDB store `orders` — `pos-offline-db.ts:1297` |
| Escritura de estado | `updateOrderStatus()` — `PATCH /rest/v1/pos_orders?id=eq.{orderId}` |
| KDS item done | PATCH `pos_orders.kds_item_status` (JSON string separado de `items`) |
| Comanda batches | PATCH `pos_orders.comanda_batches` (JSON separado) |

#### C. Print bridge

| Elemento | Valor exacto |
|---|---|
| Host | `127.0.0.1:7717` |
| Archivo cliente | `printer.ts` |
| Health check | `GET /health` — TTL 5s en caché del cliente |
| Print request | `POST /print` → body `{station: string, data: base64}` |
| Cash drawer | `POST /drawer` |
| Config | `GET|POST /config` — lee/escribe `C:\fullsite\printers.json` |
| Fingerprint proxy | `/fp/*` → `http://127.0.0.1:7718{path}` |
| Fallback chain | bridge → WebBluetooth → CSS print dialog |
| On bridge fail | `bridgeAvailable = false`, `enqueueFailedPrint()` a `print_queue` tabla |

#### D. PIN auth

| Elemento | Valor exacto |
|---|---|
| Endpoint | `POST /api/pos/pin` (Next.js API Route en Vercel) |
| Query | `pos_staff` WHERE `pin=eq.{pin}`, `active=eq.true`, `client_id=eq.{clientId}`, `role=in.({allowedRoles})` |
| Rate limit | 5 intentos / 300s por IP — in-memory (no persistido) |
| Cache key | `localStorage['pos_manager_pin_cache']` |
| Cache estructura | `{ [btoa(pin)]: { name, role, cached_at } }` |
| Cache TTL | 15 minutos |
| Offline fallback | Usa caché si red falla — `pos-data.ts:1484` |
| Fallback PIN | `POS_FALLBACK_PIN` env var (server-side) |

#### E. Pagos y cobro

| Elemento | Valor exacto |
|---|---|
| Mecanismo | Campo `pagos: PagoForma[]` en el mismo `save-order` |
| Validación | Sum(`pagos.monto`) === `total + propina` (en centavos) al `status='cerrada'` |
| Error | `{ ok: false, error: 'PAYMENT_MISMATCH' }` |
| Métodos | Tabla `pos_payment_methods` — `getPaymentMethodsFromDB()` |
| Audit | `logAudit({ action: 'payment_processed', ... })` → `pos_audit_log` |

#### F. Cortes de turno

| Elemento | Valor exacto |
|---|---|
| Archivo | `CierreCajaWizard.tsx` |
| Datos del corte | `pos_orders` filtrado por `turno_id` + `status='cerrada'` |
| Movimientos | `pos_cash_movements WHERE turno_id=eq.{id}` |
| Cierre | `PATCH /rest/v1/pos_turnos?id=eq.{id}` con `closed_at`, `closed_by`, etc. |
| Guard | Verifica PIN de gerente antes de permitir cierre |
| Stale turno | Auto-cierra si > 18 horas abierto |

#### G. Movimientos de caja

| Elemento | Valor exacto |
|---|---|
| Tabla | `pos_cash_movements` |
| Columnas | `id`, `client_id`, `turno_id`, `type` ('deposito'|'retiro'), `amount`, `actor`, `notes`, `created_at` |
| Audit | `logAudit()` con `action: 'cash_retiro'` o `'cash_deposito'` |

#### H. Sincronización y retries

| Elemento | Valor exacto |
|---|---|
| Archivo | `pos-offline-db.ts` |
| Trigger | `window.addEventListener('online', ...)` + mount check |
| Función | `syncAll()` — `pos-offline-db.ts:360` |
| Concurrencia | Flag `syncAllRunning` previene doble ejecución |
| Skip | Items con `error_class = 'STALE_WRITE_CONFLICT'` o `'TERMINAL_NON_RETRYABLE'` o `retries >= 5` |
| Replay | `replayViaAppApi()` para `transport='APP_API'` |
| Evento emitido | `CustomEvent('pos-order-synced', { orderId, revision, idempotentReplay })` |

#### I. IDB stores actuales (pos-offline-db.ts)

| Store | keyPath | Índices | Contenido |
|---|---|---|---|
| `menu` | `id` | — | `MenuCategory[]` (catálogo) |
| `orders` | `id` | `status`, `mesa` | `Order[]` (fallback local) |
| `inventory` | `ingredient_id` | — | `InventoryItem[]` |
| `sync_queue` | `id` | `synced` | Cola de operaciones pendientes |
| `meta` | `key` | — | Metadatos (last_sync, etc.) |

---

## CF-3. Inventario de componentes: reutilizar, evolucionar, no tocar

### Reutilizables sin cambios

| Componente | Por qué es seguro |
|---|---|
| IDB `sync_queue` con `save_operation_id` | Idempotencia ya implementada; el replay local puede usar la misma cola |
| IDB `orders` store | Ya existe; el runtime local puede escribir aquí y el POS ya lee de ahí offline |
| IDB `menu` store | Ya existe; el runtime local puede mantenerlo fresco |
| `syncAll()` / `registerAutoSync()` | La lógica de replay es correcta; solo necesita saber a dónde hacer replay (local o Vercel) |
| Print bridge `/print`, `/drawer`, `/config` | Contrato estable; no hay razón para cambiarlo |
| Fingerprint proxy `/fp/*` | Modelo ya validado; extender con el mismo patrón |
| `offline.html` en electron-app | Ya existe como fallback; puede mejorar su contenido |
| `logAudit()` / `pos_audit_log` | Append-only; se sincroniza igual que las órdenes |
| `clients` table como config multi-tenant | Puede extenderse con columna `feature_flags JSONB` sin romper nada |

### Evolutivos (pueden extenderse con módulos nuevos)

| Componente | Extensión propuesta | Riesgo |
|---|---|---|
| Print bridge `main.js` | Agregar rutas `/events`, `/api/*`, `/sync/*` | Bajo — misma arquitectura HTTP, mismo proceso |
| IDB database `fullsite_pos` | Agregar store `staff` (PINs locales) | Bajo — solo bump de versión |
| `pos_manager_pin_cache` localStorage | Extender TTL + almacenar en IDB `staff` | Bajo — backward compatible |
| `getKitchenOrders()` | Agregar fuente `'local'` además de Supabase | Bajo — condicional, sin cambiar flujo actual |
| electron-kds/main.js | Agregar configuración de IP del runtime local | Bajo — nueva funcionalidad, no modifica existente |

### Peligroso tocar (no modificar sin RFC aprobado y evidencia de compatibilidad)

| Componente | Riesgo si se modifica sin cuidado |
|---|---|
| `r1_save_order_idempotent` RPC (Supabase) | Cambia la fuente de verdad canónica; un bug silencia todas las ventas |
| `saveOrder()` en pos-data.ts | Contrato de escritura de órdenes; un cambio rompe el flujo en producción |
| `pagos` validation (sum = total + propina) | Invariante financiero; si se rompe, los cortes cuadran mal |
| `turno_id` enforcement | Si se relaja, las órdenes quedan huérfanas en el corte |
| `order_revision` en RPC | Control de concurrencia; si se manipula localmente, hay riesgo de escrituras out-of-order |
| `pos_audit_log` | Append-only por diseño; no agregar lógica de update/delete |
| Rate limiter de PIN | In-memory hoy; si se mueve a local sin Redis distribuido, se pierden los conteos entre terminales |

---

## CF-4. Análisis del bridge: evolucionar, envolver, o reemplazar

### Estado actual del bridge

El bridge (`electron-app/main.js`, espejado en `print-bridge/bridge.js`) es un servidor HTTP Node.js embebido en el proceso Electron principal.

**Fortalezas:**
- Ya está instalado y operando en producción
- Contrato HTTP limpio y bien definido
- Ya tiene extensibilidad demostrada: `/fp/*` es un proxy añadido posteriormente
- Ya tiene `/config` con hot-reload sin reiniciar
- El mismo proceso maneja fingerprint + impresión — patrón de coordinador único
- Startup automático vía Electron main
- Error isolation: si el bridge falla, Electron maneja el error gracefully

**Límites actuales:**
- Solo escucha en `127.0.0.1` (localhost only) — el KDS no puede alcanzarlo desde otra máquina
- Sin estado persistido (no SQLite, no caché de órdenes)
- Sin WebSocket para push a KDS
- Sin auth (cualquier proceso local puede llamarlo)

### Opción A: Evolucionar el bridge (módulos nuevos en el mismo proceso)

Agregar rutas al bridge existente:

```
Puerto 7717 — Fullsite Local Runtime (evolución del bridge)
  GET  /health                  [sin cambios]
  POST /print                   [sin cambios]
  POST /drawer                  [sin cambios]
  POST /test                    [sin cambios]
  GET|POST /config              [sin cambios]
  /fp/*                         [sin cambios]
  --- NUEVAS RUTAS (detrás de flag) ---
  GET  /status                  estado del runtime + sync queue
  GET  /events                  SSE — push órdenes a KDS (solo LAN)
  POST /api/pos/save-order      proxy local cuando offline
  POST /api/pos/pin             verificación PIN local cuando offline
  POST /sync/force              forzar syncAll()
  GET  /sync/status             cola pendiente, último sync
```

Cambio requerido en Electron:
- `BRIDGE_HOST = '0.0.0.0'` (en lugar de `'127.0.0.1'`) para que el KDS alcance el bridge por LAN
- Solo cuando el feature flag `local_runtime_lan` está activo

**Riesgo de regresión:** Bajo. Las rutas existentes no cambian. Las nuevas son aditivas.
**Despliegue:** Actualizar el `.exe` del electron-app. El KDS configura la IP del runtime.
**Observabilidad:** `/status` y `/sync/status` ya son telemetría suficiente.
**Rollback:** Desactivar el flag `local_runtime_lan` → el KDS vuelve a Supabase.
**Multi-sucursal:** Cada sucursal tiene su bridge en la Caja. Un archivo `C:\fullsite\runtime.json` configura el cliente_id y los flags.
**Actualizaciones remotas:** El updater de Electron ya hace esto hoy — push del nuevo `.exe` vía electron-updater.
**Falla del equipo principal:** Sin la Caja, el KDS no tiene runtime. Esto es equivalente a la situación actual — Supabase tampoco funciona si cae internet. Se documenta como dependencia conocida.

### Opción B: Envolver el bridge (nuevo proceso independiente en otro puerto)

Crear un proceso Node.js separado que corre en, por ejemplo, `0.0.0.0:7720`, con acceso al mismo `C:\fullsite\printers.json` y SQLite propio.

**Riesgo de regresión:** Bajo para el bridge existente (no lo toca). Alto para el despliegue (nuevo proceso = nueva gestión de ciclo de vida, nuevo proceso a mantener en Windows).
**Despliegue:** Requiere instalar y registrar un segundo servicio Windows. Más fricción para 500 sucursales.
**Rollback:** Parar el servicio nuevo. El bridge original no cambió.
**Multi-sucursal:** Dos procesos a mantener por sucursal.
**Actualizaciones remotas:** Necesita su propio updater separado.
**Falla del equipo principal:** Mismo problema que Opción A.

### Opción C: Reemplazar el bridge gradualmente

Deprecar `electron-app/main.js`'s bridge y reemplazar con un runtime completo.

**Riesgo de regresión:** Alto. El bridge está en producción con contratos establecidos.
**Despliegue:** Requiere validar que el nuevo runtime maneja todos los casos del bridge actual (TCP, USB, fallback array de impresoras, fingerprint proxy).
**Justificación:** No hay razón para reemplazar algo que funciona. El bridge tiene ~300 líneas de código bien organizadas — agregar 200 líneas de rutas nuevas es más barato y más seguro que un rewrite.

### Recomendación

**Opción A — Evolucionar el bridge.**

El bridge ya es el coordinador local de facto: maneja impresión, fingerprint, y configuración de hardware. Es el lugar natural para crecer hacia un runtime local. El patrón `/fp/*` como proxy es evidencia de que esta extensibilidad ya fue usada exitosamente.

El único cambio de riesgo real es cambiar `BRIDGE_HOST` de `127.0.0.1` a `0.0.0.0` para que el KDS pueda conectarse por LAN. Esto tiene un implicación de seguridad (el bridge quedaría expuesto en la red local) que se mitiga con:
1. Firewall de Windows para solo permitir el puerto 7717 desde la subred LAN
2. Token de autenticación simple en las rutas nuevas (no en las existentes — backward compatible)

---

## CF-5. Feature flags y rollback

### Diseño de feature flags

Sin mecanismo de feature flags hoy. Propuesta: columna en la tabla `clients`:

```sql
-- Migración aditiva, no rompe nada existente
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';
```

Flags propuestos por fase:

| Flag | Fase | Efecto |
|---|---|---|
| `local_runtime.shadow_mode` | Fase 1 | Bridge acepta copia de eventos; solo logging, sin autoridad |
| `local_runtime.lan_listen` | Fase 1→2 | Bridge escucha en `0.0.0.0` en lugar de `127.0.0.1` |
| `kds.read_from_local` | Fase 2 | KDS lee órdenes del bridge en lugar de Supabase; fallback automático a Supabase |
| `pos.pin_local_cache_extended` | Fase 2 | PIN cache sin TTL fijo; usa IDB `staff` store |
| `pos.dual_write` | Fase 3 | POS escribe en Supabase Y en runtime local; compara resultados |
| `kds.write_to_local` | Fase 4 | Avances de estado KDS van al runtime primero |
| `pos.boot_offline` | Fase 4-5 | Electron carga bundle local cuando no hay internet |

### Lectura de flags en el cliente

```typescript
// pos-data.ts — sin cambiar el flujo actual
const flags = await getClientFlags(clientId)  // lee de pos_offline_db.meta o Supabase
const readLocal = flags['kds.read_from_local'] ?? false
```

### Rollback por fase

| Fase | Rollback |
|---|---|
| 1 — Shadow mode | Desactivar `local_runtime.shadow_mode` en DB → bridge deja de copiar eventos |
| 2 — Lectura local KDS | Desactivar `kds.read_from_local` → KDS vuelve a Supabase automáticamente |
| 3 — Dual write | Desactivar `pos.dual_write` → solo Supabase, igual que hoy |
| 4 — Autoridad local | Por subsistema individual — no hay un solo rollback global |
| 5 — Boot offline | Desactivar `pos.boot_offline` → Electron vuelve a cargar desde Vercel |

---

## CF-6. Telemetría necesaria

Para comparar cloud vs. local se requieren métricas antes de cambiar cualquier lectura:

| Métrica | Dónde capturar | Qué mide |
|---|---|---|
| `bridge.health_check_latency_ms` | `/health` endpoint | Si el bridge responde rápido |
| `kds.poll_supabase_latency_ms` | En `getKitchenOrders()` | Baseline de latencia actual |
| `kds.poll_supabase_errors` | En `getKitchenOrders()` catch | Frecuencia de fallas actuales |
| `sync_queue.pending_count` | `syncAll()` entry | Cuántas órdenes están en cola |
| `sync_queue.age_seconds` | Oldest item in queue | Cuánto tiempo llevan sin subir |
| `save_order.latency_ms` | En `saveOrder()` | Baseline de escritura actual |
| `local_runtime.order_state_divergence` | Fase 3 — dual write | Compara estado local vs Supabase |
| `local_runtime.sync_lag_seconds` | Runtime → Supabase | Cuánto tarda en sincronizar |

**Implementación:** Todos los logs van a `pos_audit_log` con `action: 'telemetry'` o a un store IDB `telemetry`. No se requiere infrastructure externa.

---

## CF-7. Invariantes que no debemos romper

Lista completa de invariantes identificados en el audit. **Cualquier migración que viole uno de estos requiere RFC separado.**

| # | Invariante | Evidencia en código |
|---|---|---|
| I-1 | Toda orden debe tener `turno_id` no nulo antes de guardarse | `saveOrder()` line 1122 → error `NO_TURNO` |
| I-2 | Sum(`pagos.monto`) === `total + propina` al cerrar una orden | `saveOrder()` lines 1128-1135 → error `PAYMENT_MISMATCH` |
| I-3 | `order_revision` es monotónico y gestionado por el servidor — el cliente nunca lo establece | RPC `r1_save_order_idempotent` |
| I-4 | Operaciones con el mismo `save_operation_id` son idempotentes — el servidor detecta replay y responde igual | RPC flags `first_execution`, `idempotent_replay` |
| I-5 | Conflictos `STALE_WRITE_CONFLICT` nunca se auto-resuelven — requieren intervención manual | `pos-offline-db.ts:380` |
| I-6 | `pos_audit_log` es append-only — ningún código debe UPDATE ni DELETE en esta tabla | Diseño por convención |
| I-7 | El PIN rate limiter opera por IP — en modo local, el rate limiter debe ser por `(client_id, terminal_id)` | `pin/route.ts` líneas 44-82 |
| I-8 | El KDS solo muestra órdenes con `status in (enviada, preparando, lista)` — el local runtime debe respetar este filtro | `getKitchenOrders()` line 1282 |
| I-9 | El `client_id` filtra TODOS los datos — ninguna query puede omitir este filtro | Todas las queries en pos-data.ts |
| I-10 | Las órdenes del turno anterior (P0-1) no desaparecen del mapa aunque el turno esté cerrado | Diseño P0-1 |
| I-11 | `comanda_batches` y `kds_item_status` son patches separados al guardado de orden para evitar race conditions | `save-order/route.ts` lines 111-119, 213 |
| I-12 | El fallback de impresión es siempre bridge → Bluetooth → CSS — nunca al revés | `printer.ts` fallback chain |

---

## CF-8. Matriz de riesgos por subsistema

| Subsistema | Riesgo si se migra a local | Impacto operativo | Complejidad | Orden de migración |
|---|---|---|---|---|
| Impresión | Muy bajo — ya es local | Nulo | Baja | Ya hecho ✅ |
| Boot del bundle | Bajo — Electron ya tiene `offline.html` | Alto si falla el arranque | Media | Fase 4 |
| PIN auth (cache extendido) | Bajo — cache ya existe, solo se extiende | Medio — bloqueo de acceso si falla | Baja | Fase 2 |
| KDS lectura de órdenes | Bajo — fallback automático a Supabase | Alto en hora pico si diverge | Media | Fase 2 |
| Estado de mesas (POS) | Medio — race condition si dos terminales actualizan | Alto — mesa fantasma o doble cobro | Alta | Fase 4 |
| KDS avance de estado | Medio — secuencia de status puede desincronizarse | Medio — orden llega en estado incorrecto | Media | Fase 4 |
| Autorizaciones de gerente | Medio — rate limiter no funciona multi-terminal | Alto — bypass de seguridad | Media | Fase 3 |
| Pagos y cobro | Alto — invariante financiero estricto | Crítico — arqueo incorrecto | Alta | Fase 4-5 |
| Cortes | Alto — calcula totales del día | Crítico — diferencia de caja | Alta | Fase 5 |
| Movimientos de caja | Alto — trazabilidad financiera | Crítico | Alta | Fase 5 |

---

## CF-9. Plan de migración por fases (compatibility-first)

### Fase 0 — Audit y contrato congelado
**Objetivo:** Documentar el estado exacto antes de cualquier cambio. No cambiar comportamiento.

**Criterio de entrada:** Nada — puede empezar hoy.

**Deliverables:**
- [ ] Este RFC aprobado por Daniel
- [ ] RCA técnico respondido (8 preguntas en sección §6 del RFC)
- [ ] Diagrama de topología de procesos validado en AMALAY (verificar que PDV1/2/3 = Caja en la red real)
- [ ] Verificar que los 12 invariantes (CF-7) están cubiertos por tests o por código existente
- [ ] Feature flag column añadida a `clients` (migración aditiva, no rompe nada)
- [ ] Telemetría baseline: capturar `kds.poll_supabase_latency_ms` y `save_order.latency_ms` por 7 días

**Criterio de salida:** Daniel aprueba el estado documentado como correcto. Baseline de telemetría capturado.

**Rollback:** No aplica — no se cambia comportamiento.

---

### Fase 1 — Runtime local en modo sombra
**Objetivo:** El bridge recibe copia de eventos y los persiste localmente. Sin autoridad, sin control de KDS ni POS.

**Criterio de entrada:** Fase 0 CERTIFIED + RCA técnico completo.

**Cambios:**
- Bridge agrega nuevo store SQLite en `C:\fullsite\runtime.db` (órdenes, staff, catálogo)
- Bridge agrega `/status` y `/sync/status` endpoints
- POS, al guardar una orden exitosamente a Supabase, TAMBIÉN envía una copia al bridge (`POST /api/pos/save-order` en el bridge local) — solo si flag `local_runtime.shadow_mode` activo
- Bridge recibe la copia, persiste en SQLite, compara contra su estado local, emite log de divergencia si existe
- Bridge NO responde al KDS, NO controla impresión diferente, NO es fuente de verdad

**Cambios en código (mínimos):**
- `electron-app/main.js`: agregar SQLite (`better-sqlite3`), rutas `/status`, `/sync/status`, `POST /api/pos/save-order` (write-only)
- `pos-data.ts`: después de un `saveOrder()` exitoso, si flag activo, fire-and-forget `POST http://127.0.0.1:7717/api/pos/save-order`

**Lo que NO cambia:** El flujo actual de Supabase. El KDS. La impresión. Los pagos. Todo.

**Criterio de salida:** Por 7 días, el bridge reconstituye el estado correcto de órdenes sin afectar producción. Divergencia < 0.5% de operaciones.

**Rollback:** Desactivar flag `local_runtime.shadow_mode`. Bridge deja de recibir copias. Estado local queda como log histórico.

---

### Fase 2 — Lectura local opcional (KDS primero)
**Objetivo:** Un KDS piloto lee órdenes del bridge local en lugar de Supabase. Las escrituras siguen en Supabase.

**Criterio de entrada:** Fase 1 CERTIFIED (7 días de shadow mode sin divergencia).

**Cambios:**
- Bridge escucha en `0.0.0.0:7717` (controlado por flag `local_runtime.lan_listen`)
- Bridge agrega `GET /events` (SSE) que emite nuevas órdenes en tiempo real
- Bridge agrega `GET /orders?status=in.(enviada,preparando,lista)&client_id={id}` — mismo contrato que Supabase REST
- electron-kds: si flag `kds.read_from_local` activo y IP del runtime configurada (`C:\fullsite\runtime.json`), conecta a `http://{runtime_ip}:7717/events` en lugar de polling Supabase. Fallback automático a Supabase si SSE falla.
- PIN auth: IDB `staff` store poblado desde Supabase al arrancar. TTL extendido (sin límite fijo) si flag activo.

**Lo que NO cambia:** Escrituras de órdenes (siguen a Supabase). Pagos. Cortes. El POS. Cualquier terminal sin el flag.

**Criterio de salida:** KDS piloto opera correctamente por 7 días con órdenes desde el bridge. Latencia de actualización ≤ 500ms (vs. 2000ms de polling actual). Cero divergencias de estado.

**Rollback:** Desactivar flag `kds.read_from_local` en DB. electron-kds vuelve a Supabase en el siguiente poll (≤ 2s).

---

### Fase 3 — Dual write controlado
**Objetivo:** El POS escribe en Supabase Y en el runtime. Se comparan resultados. No se declara autoridad al runtime todavía.

**Criterio de entrada:** Fase 2 CERTIFIED.

**Cambios:**
- `saveOrder()`: si flag `pos.dual_write` activo, escribe en Supabase como siempre, y además escribe en bridge local
- Bridge compara su estado con Supabase cada N segundos y emite métrica `local_runtime.order_state_divergence`
- Si divergencia detectada: alerta en `pos_audit_log`, NO corrige automáticamente

**Lo que NO cambia:** Supabase sigue siendo la fuente de verdad. El runtime no se usa para leer todavía en el POS.

**Criterio de salida:** 7 días de dual write sin divergencias. Alert rate < 0.1%.

**Rollback:** Desactivar `pos.dual_write`. Un solo campo en DB. El POS deja de enviar copia al bridge.

---

### Fase 4 — Runtime autoritativo por subsistema
**Objetivo:** Migrar un subsistema a la vez al runtime local como fuente de verdad. Empezando por menor riesgo.

**Criterio de entrada:** Fase 3 CERTIFIED.

**Orden de subsistemas:**
1. KDS distribución de órdenes → escritura de estado (avance de estado va al runtime primero, replica a Supabase)
2. Impresión de comandas (ya es local — solo formalizar que el runtime es coordinador)
3. Autorizaciones y PIN (runtime verifica contra SQLite local)
4. Estado de mesas y órdenes en POS

**Cada subsistema tiene su propio flag y rollback independiente.**

**Lo que NO se migra en esta fase:** Pagos. Cortes. Movimientos de caja.

**Criterio de salida:** Cada subsistema migrado opera sin internet durante el equivalente a 3 turnos completos (≥ 24 horas acumuladas). Cero pérdidas de datos al reconectar.

---

### Fase 5 — Operación offline completa
**Objetivo:** Arranque sin internet, operación LAN completa, sincronización robusta.

**Criterio de entrada:** Fase 4 CERTIFIED en todos los subsistemas de Fase 4.

**Cambios:**
- Boot offline: bundle embebido en Electron (static export según RCA)
- Pagos y cortes: runtime autoritativo con reconciliación diferida
- Pruebas de corte abrupto: desconexión en medio de un pago
- Pruebas de reconexión: cola larga (>100 órdenes) sincroniza sin duplicados ni pérdida
- Pruebas de cambio de runtime primario (Caja reiniciada mientras hay órdenes abiertas)

**Criterio de salida:** Certificación completa en AMALAY (ver §7 del RFC v1.0 — 14 checks).

---

## CF-10. Primera modificación mínima, de bajo riesgo y completamente reversible

**Esta es la única acción de código que puede ejecutarse antes de que el RFC esté completamente aprobado.**

### Qué es

Extender `/health` del bridge para reportar estado del runtime (sin cambiar ningún otro comportamiento):

```javascript
// Adición a electron-app/main.js — dentro del handler GET /health
// Sin cambios al resto del bridge
GET /health  →  añadir campos al JSON de respuesta:
{
  ok: true,
  hostname: "...",
  stations: [...],          // sin cambios
  // --- NUEVOS (aditivos) ---
  runtime_version: "0.1",
  supabase_reachable: null, // null = no se ha verificado aún
  sync_queue_pending: 0,    // de pos-offline-db si accesible
  last_boot_at: "...",      // localStorage['pos_last_boot']
}
```

### Por qué es seguro

- **Aditivo**: el POS ya llama `/health` y solo usa `ok: true/false`. Los campos nuevos son ignorados.
- **Reversible**: eliminar 4 líneas de código = regresa al estado actual.
- **Sin dependencias**: no requiere SQLite, no requiere cambio de host, no requiere feature flag.
- **Valor inmediato**: le da al equipo visibilidad de si el bridge está funcionando cuando se reporta un problema.

### Qué no incluye

No cambia el `BRIDGE_HOST`. No agrega nuevas rutas. No instala SQLite. No toca el POS ni el KDS.

---

## CF-11. Changelog de la sección

| Fecha | Cambio |
|---|---|
| 2026-07-24 | Sección CF-1 a CF-10 añadida — Compatibility-First Migration Strategy v1.0 |

---

_RFC v2.0 — 2026-07-24_
_Audit de código: 2026-07-24 — contratos verificados contra source (explore agent)_
_Primera modificación de código: solo CF-10 puede implementarse antes de aprobación del RFC._
