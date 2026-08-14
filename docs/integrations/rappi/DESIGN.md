# Rappi Integration — Technical Design v0.2

**Workstream:** Delivery Platform Expansion — Phase 1  
**Estado:** `DEV_CREDENTIALS_RECEIVED` — Credenciales DEV y Store ID de pruebas recibidos por email el 2026-08-13. RAPPI-001 abierto; webhook signature contract sigue ECR.
**Fecha:** 2026-08-14
**Fuentes:** dev-portal.rappi.com (oficial), research multi-agente confirmado

### Reglas de seguridad vigentes

- NO guardar `RAPPI_CLIENT_SECRET` ni tokens Rappi en código, docs, logs ni DB sin cifrado.
- Credenciales DEV viven solo en variables de entorno server-side.
- Los endpoints operativos deben fallar cerrado si falta `SUPABASE_SERVICE_KEY`, credenciales Rappi o mapping tienda→tenant.
- NO implementar ningún punto marcado como ECR (External Confirmation Required)

### Al recibir respuesta de Rappi

1. Analizar toda la información recibida
2. Comparar contra Design v0.2
3. Actualizar únicamente los puntos que cambien con información oficial
4. Marcar los ítems correspondientes del checklist en `RAPPI-ONBOARDING-REQUEST.md`
5. Cuando los 11 ítems estén completos → autorizar apertura de RAPPI-001

## Changelog

| Versión | Fecha | Cambio |
|---|---|---|
| v0.1 | 2026-08-01 | Diseño inicial con polling como mecanismo primario |
| v0.2 | 2026-08-02 | **Arquitectura invertida:** webhooks push como primario, polling solo como reconciliación. Firma Rappi-Signature descubierta. Host México corregido. TTL corregido. Reutilización recalculada: 62% → ~68%. |
| v0.2.1 | 2026-08-02 | Estado actualizado a `WAITING_EXTERNAL`. Correo de onboarding enviado. Workstream congelado. |
| v0.2.2 | 2026-08-03 | **Partners dashboard + doc pública:** storeId confirmado `MX1930030014`, brandId `MX491066`. Auth header corregido: `x-authorization: bearer` (NO `Authorization: Bearer`). Secreto webhook: Rappi lo devuelve en `POST webhook` response. Token TTL: 86400s (24h, no 1 semana). Precios en centavos confirmado por muestras de payload. ECRs reducidos de 5 a 2. |
| v0.3.0 | 2026-08-14 | Credenciales DEV recibidas. Implementado OAuth server-side, header `x-authorization: "Bearer: <token>"`, normalizador centavos, ingesta fail-closed por `integration_store_mappings`, poller manual admin-only y acciones POS→Rappi. Webhook continúa fail-closed hasta contrato oficial de firma. |

---

## Índice

1. [Hallazgo revisado](#hallazgo-revisado)
2. [Comparativa de capacidades](#comparativa)
3. [Arquitectura v0.2](#arquitectura)
4. [Investigación API](#investigación-api)
5. [Gap Analysis](#gap-analysis)
6. [Roadmap RAPPI-001..015](#roadmap)
7. [Estimación](#estimación)

---

## Hallazgo Revisado

### v0.1 decía: "Rappi NO usa webhooks push. Usa polling."

### v0.2 corrige: Rappi es push-first. Ambos mecanismos coexisten.

Research posterior al Design v0.1 encontró un mecanismo de push con HMAC-SHA256 documentado en el dev portal. El polling (`GET /stores/{storeId}/orders`) también existe pero es **secundario** — su rol correcto es reconciliación y recuperación ante outages, no ingesta primaria.

| Dimensión | Uber Eats | Rappi |
|---|---|---|
| Mecanismo primario | Webhook push (HMAC-SHA256) | Webhook push (HMAC-SHA256) ⚠️ ver nota |
| Header de firma | `x-uber-signature: <hex>` | `Rappi-Signature: t=<ts>,sign=<hex>` — **EXTERNAL CONFIRMATION REQUIRED** |
| String firmado | `<raw_body>` | `<timestamp>.<raw_body>` — **EXTERNAL CONFIRMATION REQUIRED** |
| Mecanismo secundario | `reconcile/route.ts` vs API Uber | `poller/route.ts` vs API Rappi |
| Health-check | No documentado | PING cada 3 min → `{"status":"OK"}` — **EXTERNAL CONFIRMATION REQUIRED** |
| Latencia media | ~1–5 s | ~1–5 s (webhook) / 0–45 s (poller) |

> **EXTERNAL CONFIRMATION REQUIRED:** El formato exacto del header `Rappi-Signature`, la semántica del signed string y si el polling GET tiene semántica destructiva (dequeue) deben confirmarse con documentación privada o respuesta escrita de Rappi antes de implementar RAPPI-003 y RAPPI-012.

**Impacto en el framework:** Con webhooks como primario, la reutilización del framework Uber sube de ~62% a ~68%. El patrón de `verifySignature()`, el handler async de 2xx y la ruta de reconciliación son todos análogos al código de Uber.

---

## Comparativa

### Uber Eats vs Rappi — Capacidades del framework

| # | Capacidad | Uber Eats | Rappi | Estado para Rappi |
|---|---|---|---|---|
| 1 | Auth mecanismo | OAuth 2.0 `authorization_code` (por tienda) | OAuth 2.0 `client_credentials` (global) | Needs Adapter |
| 2 | Auth header | `Authorization: Bearer <token>` | `x-authorization: "Bearer: <token>"` | Needs Adapter |
| 3 | Token storage | `integration_providers` por store | Var de entorno / config global | Needs New |
| 4 | Mecanismo de ingesta | Webhook push | Webhook push (push-first) | Needs Adapter |
| 5 | Firma de webhook | `x-uber-signature: <hex>` | `Rappi-Signature: t=<ts>,sign=<hex>` (**ECR**) | Needs Adapter |
| 6 | Raw body para firma | ✅ necesario | ✅ necesario (crítico: usar raw bytes) | Reutilizable |
| 7 | Respuesta async 2xx | ✅ patrón Uber | ✅ Rappi requiere respuesta rápida | ~70% Reutilizable |
| 8 | Health-check endpoint | No documentado | PING cada 3 min → `{"status":"OK"}` (**ECR**) | Needs New |
| 9 | Función canónica de ingestión | En webhook handler | `processRappiOrder()` compartido webhook+poller | Needs New (framework) |
| 10 | Deduplicación | `UNIQUE(provider, provider_event_id)` | `UNIQUE(provider, platform_order_id)` | 100% Reutilizable |
| 11 | Normalización | `normalizeUberOrder()` | `normalizeRappiOrder()` | Needs Adapter |
| 12 | Aceptar orden | `POST /eats/v2/orders/{id}/accept` | `PUT .../orders/{id}/cooking_time/{min}/take` | Needs Adapter |
| 13 | Rechazar orden | `POST .../deny` + reason | `PUT .../cancel_type/{type}/reject` | Needs Adapter |
| 14 | Cancelar orden | `POST .../cancel` | Mismo endpoint que reject (cancelType) | Needs Adapter |
| 15 | Marcar ready | `POST .../readyforcustomer` | `POST .../ready-for-pickup` (máx 3) | Needs Adapter |
| 16 | Razones de rechazo | 9 razones enum | 13 `cancelType` path param | Needs New |
| 17 | `delivery_orders` | ✅ | ✅ mismo esquema, `platform=rappi` | 100% Reutilizable |
| 18 | `auditLog()` | ✅ | ✅ | 100% Reutilizable |
| 19 | DLQ / `quarantineUnmappedStore()` | ✅ | ✅ | 100% Reutilizable |
| 20 | `withRetry()` | ✅ | ✅ | 100% Reutilizable |
| 21 | Reconciliación | `reconcile/route.ts` | `poller/route.ts` (rol principal) + `reconcile/route.ts` | ~50% Reutilizable |
| 22 | Store status | Webhook `store.status` | `PUT` síncrono `is_enabled: true/false` | Needs New (post-MVP) |
| 23 | Menu API | Vía `eats.pos_provisioning` | JSON completo + PATCH nivel item | Needs New (fuera MVP) |

> **ECR** = EXTERNAL CONFIRMATION REQUIRED

---

## Arquitectura

### Principio de diseño

> El webhook handler y el poller son canales de entrada distintos. El procesamiento de una orden (dedup, mapping, normalización, persistencia, audit) es un único camino canónico que ambos canales invocan. La fuente del evento (`'webhook' | 'poller'`) se loggea para observabilidad pero **no ramifica la lógica de negocio**.

### Módulos a crear

```
src/lib/integrations/rappi/
├── auth.ts           — getAccessToken(), CC flow, cache con TTL 23h
├── ingest.ts         — processRappiOrder() — función canónica compartida
├── normalizer.ts     — normalizeRappiOrder() → CanonicalOrder
├── adapter.ts        — acceptOrder(), rejectOrder(), markOrderReady()
├── signature.ts      — verifyRappiSignature() [EXTERNAL CONFIRMATION REQUIRED]
└── reasons.ts        — RAPPI_CANCEL_TYPES (13 tipos)

src/app/api/integrations/rappi/
├── webhook/route.ts  — POST: verify → 2xx ACK → processRappiOrder async
├── health/route.ts   — GET/POST: responde {"status":"OK"} al PING de Rappi [ECR]
├── poller/route.ts   — POST: reconciliación + gap detection, llama processRappiOrder
├── order/route.ts    — POST: accept/reject/cancel/ready desde dashboard
└── reconcile/route.ts
```

### Flujo primario — Webhook push

```
Rappi → POST /api/integrations/rappi/webhook
  │
  ├─ 1. Leer rawBody como Buffer (crítico: no re-serializar antes de verificar firma)
  ├─ 2. verifyRappiSignature(rawBody, header['rappi-signature'])
  │      [EXTERNAL CONFIRMATION REQUIRED — formato header y signed string]
  │      └─ FAIL → 401, auditLog(webhook.invalid_sig), return
  │
  ├─ 3. Return 2xx ACK inmediatamente (antes de cualquier I/O)
  │
  └─ 4. [async] processRappiOrder(parsedOrder, 'webhook', correlationId)
              │
              ├─ dedup: ¿existe delivery_orders WHERE platform=rappi AND platform_order_id=X?
              │   ├─ SÍ: auditLog(order.dedup), return { action: 'dedup' }
              │   └─ NO: continuar
              │
              ├─ resolve store mapping (integration_store_mappings WHERE provider=rappi)
              │   └─ NO mapeada: quarantineUnmappedStore() → DLQ, return { action: 'dlq' }
              │       fail-closed: ningún write a delivery_orders para tienda no mapeada
              │
              ├─ normalizeRappiOrder(raw) → CanonicalOrder
              ├─ INSERT delivery_orders (platform=rappi, status='nueva', source='webhook')
              ├─ auditLog(provider='rappi', action='order.new', source='webhook')
              └─ return { action: 'new' }
```

### Flujo de reconciliación — Poller

```
Cron (≥45s entre ejecuciones) → POST /api/integrations/rappi/poller
  │
  ├─ Adquirir lock por storeId (DB mutex: SELECT ... FOR UPDATE SKIP LOCKED)
  │   └─ Si no puede adquirir → log + skip (otra instancia corre)
  │
  ├─ Para cada storeId en integration_store_mappings WHERE provider=rappi:
  │   ├─ getAccessToken()
  │   ├─ GET /stores/{storeId}/orders
  │   │   [EXTERNAL CONFIRMATION REQUIRED — ¿semántica destructiva (dequeue)?]
  │   │
  │   └─ Para cada orden en el response:
  │       └─ processRappiOrder(order, 'poller', correlationId)
  │           ← MISMA función canónica: dedup maneja duplicados con webhooks
  │
  ├─ Gap detection: órdenes con status='nueva' AND source='webhook' AND age > 5 min
  │   └─ Si encontradas: auditLog(reconcile.gap_detected), opcional: re-intentar accept
  │
  └─ auditLog(action='poller.run', result: { checked, new_via_poller, deduped, dlq })
```

### Convergencia canónica — Por qué es correcto este diseño

```
                    Rappi
                   /     \
         webhook           poller
        (primario)     (reconciliación)
              \           /
               \         /
          processRappiOrder()
          ┌───────────────────┐
          │ 1. dedup          │
          │ 2. store mapping  │
          │ 3. normalizeRappi │
          │ 4. INSERT         │
          │ 5. auditLog       │
          └───────────────────┘
                    │
             delivery_orders
              (source: webhook|poller)
```

Una orden llegada por webhook que el poller también detecta → `processRappiOrder` retorna `{ action: 'dedup' }` en la segunda llamada. No hay lógica especial de sincronización entre los dos canales: la deduplicación por `platform_order_id` + `UNIQUE` constraint maneja todo.

### Aceptación de órdenes — Decisión: Manual desde POS/KDS

> **Decisión cerrada (2026-08-02):** Fullsite no acepta órdenes automáticamente. El MVP es manual.

El flujo de `processRappiOrder` persiste la orden como `status='nueva'` y la expone inmediatamente en el POS/KDS. La aceptación o rechazo es acción del operador.

**Flujo completo:**
```
processRappiOrder() → INSERT delivery_orders (status='nueva')
    │
    ├─ KDS/POS muestra la orden inmediatamente
    ├─ Alerta sonora + visual al recibir
    ├─ Temporizador visible desde timestamp SENT (ventana: 6 minutos)
    ├─ Alertas crecientes a medida que se acerca el timeout
    └─ Escalación si no hay respuesta antes de N minutos (umbral configurable)

Operador → acepta → adapter.acceptOrder() → auditLog(actor, response_time_ms)
        ↘ rechaza → adapter.rejectOrder(cancelType) → auditLog(actor, response_time_ms)
```

**Requisitos de implementación:**
- Temporizador visible desde `SENT` en el KDS (campo `sent_at` en `delivery_orders`)
- `auditLog` con `actor: 'staff'`, `staff_id`, y `response_time_ms` para análisis de SLA interno
- Auto-accept queda como **feature flag por restaurante** (`integration_settings.rappi_auto_accept: false` por defecto)
- No habilitar auto-accept sin decisión explícita del operador del restaurante

---

## Investigación API

> Fuente: `dev-portal.rappi.com` (oficial). Campos marcados **ECR** requieren confirmación de Rappi antes de implementar.

### Autenticación

| Campo | Valor |
|---|---|
| Endpoint | `POST https://services.mxgrability.rappi.com/restaurants/auth/v1/token/login/integrations` |
| Body | `{ "client_id": "...", "client_secret": "..." }` |
| Token TTL (órdenes/menú) | **86,400s (24h)** — usar para cache de auth.ts |
| Token TTL (utilidades) | 604,798s (~7 días) — endpoint diferente, no confundir |
| Header name | `x-authorization` |
| Header value | `"Bearer: <token>"` — **con dos puntos después de Bearer** |
| Auth0 dominio (prod) | `rests-integrations.auth0.com` |
| Re-auth | Re-auth completa (no hay refresh token) |

> ⚠️ El TTL del token para operaciones de órdenes y menú es **24h, no 7 días**. El cache de `auth.ts` debe usar TTL de 23h (con margen de 1h).

### URLs base — México

| Ambiente | URL |
|---|---|
| **Producción México** | `https://services.mxgrability.rappi.com` (**no** `api.rappi.com.mx`) |
| Dev/Testing | `https://api.dev.rappi.com` |
| Portal dev | `https://dev-portal.rappi.com/en/` |

> `mxgrability` = infraestructura Grability (empresa adquirida por Rappi para tecnología de restaurantes). Usar `api.rappi.com.mx` puede producir 404 o timeout silencioso en producción México.

### Firma de webhook

| Campo | Valor |
|---|---|
| Header | `Rappi-Signature` **ECR** |
| Formato | `t=<unix_timestamp>,sign=<hex_digest>` **ECR** |
| String firmado | `<timestamp>.<raw_body>` **ECR** |
| Algoritmo | HMAC-SHA256 **ECR** |
| Secret | Retornado al registrar el webhook, rotatable **ECR** |
| Health check | PING a `/api/integrations/rappi/health` cada 3 min; responder `{"status":"OK"}` **ECR** |

> **ECR — No implementar verifyRappiSignature() hasta tener el formato exacto documentado oficialmente o confirmado por escrito por Rappi.** Formato estimado basado en research de dev portal; puede diferir en producción.

### Endpoints de ciclo de vida de una orden

**Base path:** `https://services.mxgrability.rappi.com/restaurants/orders/v1`

| Acción | Método | Endpoint | Notas |
|---|---|---|---|
| Obtener órdenes | `GET` | `/stores/{storeId}/orders` | Semántica posiblemente destructiva **ECR** |
| Aceptar | `PUT` | `/stores/{storeId}/orders/{orderId}/take` | |
| Aceptar con ETA | `PUT` | `/stores/{storeId}/orders/{orderId}/cooking_time/{min}/take` | Preferida |
| Rechazar/cancelar | `PUT` | `/stores/{storeId}/orders/{orderId}/cancel_type/{type}/reject` | Body: `{description, additional_info}` |
| Marcar ready | `POST` | `/stores/{storeId}/orders/{orderId}/ready-for-pickup` | Máx 3 llamadas por orden |
| Código entrega | `GET` | `/stores/{storeId}/orders/{orderId}/handoff` | QR + confirmation code |

### Cancel types (13 razones)

```
STORE_CLOSED | ITEM_STOCKOUT | POS_OFFLINE | POS_INTERNAL_ERROR
INTEGRATOR_ERROR | DELIVERY_METHOD_NOT_SUPPORTED | ORDER_TOTAL_INCORRECT
ORDER_CHARGES_INCORRECT | ORDER_DISCOUNTS_INCORRECT | OUTSIDE_DELIVERY_AREA
ITEM_PRICE_INCORRECT | ITEM_NOT_FOUND | CUSTOMER_INFO_INCORRECT
```

### Rate limits, SLA y timeouts

| Restricción | Valor | Consecuencia |
|---|---|---|
| Polling mínimo | **45s entre requests por tienda** | Throttling / revocación de acceso |
| Ventana SENT → TIMEOUT | **6 minutos** | Auto-cancelación por Rappi si no se acepta |
| Máx ready-for-pickup | **3 por orden** | Request bloqueado |
| Success rate SLA | **98%** | Revocación de acceso, sin período de gracia documentado |
| Token TTL órdenes | **86,400s** | 401 en todos los requests |

### Rappi Turbo

Misma API REST. Detectar en el payload via `"delivery_operation_type": "turbo"`. No requiere endpoints distintos.

### Schema de una orden (campos clave)

```
order_id, delivery_operation_type (incl. "turbo"), cooking_time
billing_information: { name, address, document, contact }
delivery_information: { address components, lat, lng }
totals: {
  products_subtotal,
  discounts[],     ← array desde nov 2022 (no campo único)
  charges,
  tips
}
items[]: { sku, name, price, quantity, subitems[] }
customer: { name, contact, document, user_type }
store: { internal_id, external_id, name }
```

> **ECR — Confirmar si `price` en `items[]` y `products_subtotal` vienen en pesos MXN o centavos. Bloqueante para normalizer.**

### Advertencia operacional — Wansoft

Research indica que Wansoft tiene integración nativa con Rappi en México. **Las órdenes de Rappi de AMALAY probablemente fluyen hoy por Wansoft.** La activación de la integración Fullsite-Rappi debe coincidir con el switch `clients.data_source = 'wansoft'` → `'fullsite'`. Nunca dos consumidores del polling activos simultáneamente.

---

## Gap Analysis

### Reutilización del framework Uber Eats

| Componente | Reutilizable | Trabajo nuevo | Riesgo |
|---|---|---|---|
| `CanonicalOrder` / `types.ts` | **100%** | Ninguno | BAJO |
| `delivery_orders` tabla | **100%** | Nueva fila `platform=rappi` | BAJO |
| `auditLog()` | **100%** | Ninguno | BAJO |
| `withRetry()` | **100%** | Ninguno | BAJO |
| `quarantineUnmappedStore()` | **100%** | `provider='rappi'` | BAJO |
| `integration_store_mappings` | **100%** | Nuevas filas `provider=rappi` | BAJO |
| `integration_audit_log` | **100%** | Ninguno | BAJO |
| `integration_webhook_dlq` | **100%** | Ninguno | BAJO |
| Raw body handling (webhook) | **85%** | Adaptar para `Rappi-Signature` | BAJO |
| Webhook handler (async 2xx) | **70%** | Adaptar rutas y sig format | BAJO |
| `verifySignature()` lógica HMAC | **65%** | Header name + signed string diferente **ECR** | MEDIO |
| `uber-eats/order/route.ts` | **60%** | Adaptar URLs, métodos, reasons | BAJO |
| `uber-eats/reconcile/route.ts` | **50%** | Adaptar a rol de polling Rappi | BAJO |
| `integration_providers` tabla | **20%** | Rappi global vs Uber por tienda | MEDIO |
| `uber-eats/oauth.ts` | **0%** | Crear `rappi/auth.ts` (CC flow diferente) | BAJO |
| `uber-eats/normalizer.ts` | **0%** | Crear `rappi/normalizer.ts` (payload diferente) | BAJO |
| `rappi/ingest.ts` (nueva) | **0%** | Función canónica nueva — sin equivalente exacto en Uber | BAJO |

**Estimación de reutilización total: ~68%** (subió de 62% al recuperar el patrón de webhook handler y verifySignature de Uber).

### Deuda de framework que este workstream formaliza

`DeliveryProvider` interface con soporte explícito para providers con webhook. `processRappiOrder` como función canónica de ingestión sienta las bases para DiDi si sigue un patrón similar. El patrón `source: 'webhook' | 'poller'` en auditLog es observable desde el primer día.

---

## Roadmap

### RAPPI-001 — Autenticación

**Estado:** `IMPLEMENTED_DEV_READY`

**Objetivo:** Token válido en header `x-authorization` para todos los requests Rappi.

**Módulo:** `src/lib/integrations/rappi/auth.ts`
- `getAccessToken()`: POST al endpoint de auth, cache en memoria con TTL de **23h** (no 7 días — TTL del token de órdenes es 24h)
- Variables de entorno server-only: `RAPPI_CLIENT_ID`, `RAPPI_CLIENT_SECRET`, `RAPPI_STORE_ID`, `RAPPI_ENV`
- Header resultante: `x-authorization: "Bearer: <token>"` (los dos puntos son parte del valor)
- Default seguro: `RAPPI_ENV=dev` apunta a `https://api.dev.rappi.com`; producción requiere configuración explícita.

**Criterios PASS:**
- POST al auth endpoint retorna token con HTTP 200
- Header generado es exactamente `x-authorization: "Bearer: <TOKEN>"` verificado con request curl manual
- Re-auth automática antes de TTL (23h check)

**Criterios FAIL:**
- Header omite los dos puntos: `"Bearer <token>"` en vez de `"Bearer: <token>"`
- Cache usa 7 días de TTL (confunde los dos endpoints)
- Token expirado no produce re-auth automática

**Dependencias externas:** recibidas para DEV. Pendiente cargar como secretos server-side en el entorno correspondiente.

---

### RAPPI-002 — Webhook endpoint + ACK asíncrono

**Objetivo:** Endpoint que recibe push de Rappi, responde 2xx inmediatamente y procesa async.

**Módulo:** `src/app/api/integrations/rappi/webhook/route.ts`

Flujo:
1. Leer `rawBody` como Buffer antes de cualquier parse
2. `verifyRappiSignature(rawBody, header)` — **depende de RAPPI-003**
3. Return 200 inmediatamente
4. Llamar `processRappiOrder(parsedOrder, 'webhook', correlationId)` de forma no-bloqueante

**Criterios PASS:**
- Handler responde HTTP 200 en < 200ms (antes de I/O de DB)
- Payload con firma inválida → 401, nunca procesado
- Orden real procesada y aparece en `delivery_orders` segundos después del ACK
- `auditLog` registra `source='webhook'`

**Criterios FAIL:**
- Handler espera a que `processRappiOrder` complete antes de responder (bloquea Rappi)
- Firma inválida → 200 y orden procesada

---

### RAPPI-003 — Verificación de firma

**Objetivo:** `verifyRappiSignature(rawBody, signatureHeader)` → `boolean`.

**Módulo:** `src/lib/integrations/rappi/signature.ts`

**⚠️ EXTERNAL CONFIRMATION REQUIRED:**  
Formato del header `Rappi-Signature: t=<ts>,sign=<hex>` y el string firmado `<timestamp>.<raw_body>` deben confirmarse con documentación privada de Rappi antes de implementar. No asumir que el formato es idéntico al documentado en el research; puede variar entre regiones o versiones.

**Criterios PASS (cuando se tenga confirmación):**
- Firma válida sobre el mismo payload → `true`
- Firma válida pero timestamp > threshold configurado → `false` (protección replay)
- Mismo payload, firma alterada → `false`
- Raw body re-serializado (distinto del original) con firma del original → `false`

**Criterios FAIL:**
- Usar `JSON.stringify(body)` en vez de raw body para verificar — producirá falsos negativos en producción

---

### RAPPI-004 — Health check endpoint

**Objetivo:** Responder al PING de Rappi para que el webhook no se desactive por inactividad.

**Módulo:** `src/app/api/integrations/rappi/health/route.ts`

**⚠️ EXTERNAL CONFIRMATION REQUIRED:** Confirmar si el PING es GET o POST, URL exacta esperada, y frecuencia (3 min documentada en research).

**Criterios PASS:**
- Cualquier request a la ruta responde `{"status":"OK"}` con HTTP 200
- Respuesta en < 100ms

**Criterios FAIL:**
- Endpoint devuelve 404 o 500 → Rappi puede desactivar el webhook

---

### RAPPI-005 — Función canónica de ingestión

**Objetivo:** `processRappiOrder(rawOrder, source, correlationId)` — única lógica de ingestión, invocada por webhook y poller.

**Módulo:** `src/lib/integrations/rappi/ingest.ts`

```
processRappiOrder(rawOrder, source: 'webhook' | 'poller', correlationId)
  → ProcessResult = { action: 'new' | 'dedup' | 'dlq', orderId?: string }
```

Pasos internos:
1. Dedup: `SELECT FROM delivery_orders WHERE platform='rappi' AND platform_order_id=X`
   - Existe → `auditLog(order.dedup, source)`, return `{ action: 'dedup' }`
2. Store mapping: `SELECT FROM integration_store_mappings WHERE provider='rappi' AND external_store_id=Y`
   - No existe → `quarantineUnmappedStore()` → DLQ, auditLog, return `{ action: 'dlq' }`
   - Fail-closed: ningún write a `delivery_orders` para tienda no mapeada
3. `normalizeRappiOrder(rawOrder)` → `CanonicalOrder`
4. `INSERT delivery_orders` (platform=rappi, status='nueva', source=source, raw_payload=rawOrder)
5. `auditLog(order.new, source, correlationId)`
6. Return `{ action: 'new', orderId }`

**Criterios PASS:**
- Misma orden llegada por webhook luego detectada por poller → 1 fila en `delivery_orders`, segunda llamada retorna `'dedup'`
- Tienda sin mapping → fila en DLQ, cero filas en `delivery_orders`
- `source` loggeado en `auditLog` en todos los paths

**Criterios FAIL:**
- Lógica branched por `source` en procesamiento de negocio
- Tienda no mapeada produce fila en `delivery_orders`

---

### RAPPI-006 — Normalización

**Objetivo:** Payload de Rappi → `CanonicalOrder` correctamente mapeado.

**Módulo:** `src/lib/integrations/rappi/normalizer.ts`

Mapeo clave:
```
rawOrder.order_id                  → provider_order_id
rawOrder.store.internal_id         → provider_store_id
rawOrder.customer.name             → customer_name
rawOrder.totals.products_subtotal  → subtotal  [ECR: MXN o centavos]
rawOrder.totals.charges            → delivery_fee
rawOrder.totals.tips               → tip
rawOrder.items[].subitems[]        → items[].modifiers[]
rawOrder.delivery_operation_type   → metadata.rappi_delivery_type
```

**⚠️ Blocker:** Requiere payload real para confirmar:
- Formato de montos (pesos MXN vs centavos) — error de ×100 en todos los precios
- Estructura exacta de `subitems[]` (modificadores)
- Tipo de `order_id` (UUID string o entero)

**Criterios PASS:**
- `CanonicalOrder` pasa validación TypeScript
- Precios en el formato correcto confirmado con payload real
- `subitems[]` mapeados a `modifiers[]` correctamente

**Criterios FAIL:**
- `total = 0` o precio incorrecto por error de escala (÷100 o ×100 incorrecto)
- `customer_name` vacío cuando el payload lo tiene

---

### RAPPI-007 — Aceptar orden

**Objetivo:** Rappi confirma que el restaurante tomó la orden.

**Módulo:** `src/lib/integrations/rappi/adapter.ts`, función `acceptOrder(orderId, storeId, cookingMinutes?)`

```
PUT /restaurants/orders/v1/stores/{storeId}/orders/{orderId}/cooking_time/{min}/take
Headers: { x-authorization: "Bearer: <token>" }
```

**⚠️ PENDIENTE DECISIÓN OPERACIONAL:** Esta función existe pero NO se llama automáticamente hasta que Daniel confirme si la aceptación es automática o manual desde el KDS.

**Criterios PASS:**
- HTTP 200 de Rappi
- `delivery_orders.status` actualizado a `preparando`
- `auditLog(order.accept)`

**Criterios FAIL:**
- 401 (header malformado o token expirado)
- 400 (orden ya aceptada — transición inválida)
- Llamada automática sin decisión operacional confirmada

---

### RAPPI-008 — Rechazar orden

**Módulo:** `adapter.ts`, función `rejectOrder(orderId, storeId, cancelType, description)`

```
PUT .../orders/{orderId}/cancel_type/{cancelType}/reject
Body: { "description": "...", "additional_info": {} }
```

**Criterios PASS:**
- HTTP 202 de Rappi
- `delivery_orders.status` → `cancelada`
- Los 13 `cancelType` definidos en `reasons.ts` y validados en runtime

**Criterios FAIL:**
- `cancelType` no incluido en los 13 documentados enviado a la API
- `ITEM_NOT_FOUND` enviado sin `additional_info` con item IDs

---

### RAPPI-009 — Marcar ready

**Módulo:** `adapter.ts`, función `markOrderReady(orderId, storeId)`

```
POST .../orders/{orderId}/ready-for-pickup
```

**Criterios PASS:**
- HTTP 200 de Rappi
- Contador de llamadas por `orderId` rastreado — no más de 3

**Criterios FAIL:**
- Llamada #4 llega a Rappi API (debe ser bloqueada por el cliente antes)

---

### RAPPI-010 — DLQ — Tienda no mapeada

**Objetivo:** Orden de tienda sin mapping en `integration_store_mappings` → fail-closed + DLQ.

Reutilizar `quarantineUnmappedStore()` con `provider='rappi'`. Poller continúa con otras tiendas al encontrar una no mapeada.

**Criterios PASS:**
- Tienda sin mapping → fila en `integration_webhook_dlq` con `provider=rappi`
- `delivery_orders` sin ninguna fila para esa orden
- Poller no aborta — sigue con otras tiendas

**Criterios FAIL:**
- Poller lanza excepción no manejada al encontrar tienda no mapeada
- Cualquier write a `delivery_orders` sin mapping confirmado

---

### RAPPI-011 — Audit log — Todos los eventos

**Objetivo:** Todos los eventos del ciclo de vida trackeados con `source` y `correlationId`.

Eventos a cubrir: `webhook.received`, `webhook.invalid_sig`, `order.new`, `order.dedup`, `order.dlq`, `order.accept`, `order.reject`, `order.ready`, `poller.run`, `reconcile.gap_detected`.

**Criterios PASS:**
- Cada path en `processRappiOrder` genera exactamente 1 evento de audit
- `source` ('webhook' | 'poller') presente en todos los eventos

---

### RAPPI-012 — Poller de reconciliación

**Objetivo:** Detectar órdenes no recibidas por webhook y recuperar después de outages.

**Módulo:** `src/lib/integrations/rappi/poller.ts` + `src/app/api/integrations/rappi/poller/route.ts`

**Roles del poller (NO es ingesta primaria):**
1. `GET /stores/{storeId}/orders` → para cada orden no en `delivery_orders`: llamar `processRappiOrder(order, 'poller')`
2. Gap detection: órdenes `status='nueva'` con `source='webhook'` y `age > 5min` — puede indicar accept automático pendiente o estado inconsistente
3. Recovery post-outage: si el webhook handler estuvo caído, el poller recupera las órdenes perdidas

**⚠️ EXTERNAL CONFIRMATION REQUIRED — Semántica del polling:**  
¿El GET `/stores/{storeId}/orders` tiene semántica destructiva (dequeue)? Si sí, una orden consumida por polling no reaparece aunque el webhook no la haya entregado. Si no, las órdenes siguen disponibles hasta ser aceptadas. Esta respuesta de Rappi define si el poller puede reconstruir el estado completo o solo detectar gaps.

**Infraestructura — Decisión (2026-08-02):** Vercel Cron + DB advisory lock por storeId.

**Pre-condiciones antes de implementar RAPPI-012** (verificar y documentar evidencia):
1. Confirmar que Vercel Cron puede ejecutar con la frecuencia necesaria para cubrir el contrato de 45s de Rappi
2. Verificar que `SELECT ... FOR UPDATE SKIP LOCKED` en la DB de Supabase previene ejecuciones concurrentes por storeId bajo carga real
3. Métricas obligatorias: `last_run_at`, `duration_ms`, `error_count` en `agent_runs` por storeId
4. Alerta activa si el poller no ejecuta en > 3× el intervalo configurado
5. Confirmar semántica de `GET /stores/{storeId}/orders` con Rappi **antes de implementar** — ECR crítico

Si Vercel Cron no puede cumplir la frecuencia o disponibilidad requerida, presentar alternativa a Daniel antes de cambiar la arquitectura.

**Criterios PASS:**
- Poller detecta orden no recibida por webhook y la procesa via `processRappiOrder`
- Gap de 45s entre polls por storeId respetado bajo concurrencia
- Sin instancias concurrentes del poller para el mismo storeId (lock confirmado)
- `auditLog(poller.run)` con `{checked, new_via_poller, deduped}` en cada ejecución

**Criterios FAIL:**
- Poller procesa orden ya en `delivery_orders` (dedup no la filtra) → duplicado
- Dos instancias concurrentes hacen polling para el mismo storeId

---

### RAPPI-013 — Order route (dashboard)

**Objetivo:** El personal del restaurante puede triggear accept/reject/ready desde el dashboard.

**Módulo:** `src/app/api/integrations/rappi/order/route.ts`

Acciones: `accept`, `reject`, `cancel`, `ready`. Reutilizar el patrón de `uber-eats/order/route.ts` (60% reusable).

**Criterios PASS:**
- Todas las acciones loggeadas en `auditLog` con `actor: 'staff'`
- Respuesta del adapter propagada al dashboard (success/error)

---

### RAPPI-014 — Reconciliación de estado atascado

**Módulo:** `src/app/api/integrations/rappi/reconcile/route.ts`

Detecta órdenes con `status='nueva'` y `age > N min`. Compara contra estado en API Rappi. Actualiza si hay discrepancia.

---

### RAPPI-015 — Sandbox y CI

**Objetivo:** Suite de tests que validen el pipeline completo sin depender de Rappi API real.

- `rappi/sandbox/route.ts`: endpoint que simula un push de webhook con payload fijo
- `rappi-cert-lifecycle.yml`: workflow de CI análogo a `uber-cert-lifecycle.yml`
- Tests unitarios para `normalizeRappiOrder()` con payload real capturado

**Blocker:** No hay sandbox documentado por Rappi. Alternativa: mock del HTTP client en tests + payload real capturado en producción.

---

## Estimación

### Distribución de trabajo

| RAPPI-# | Área | Horas | % Reuse |
|---|---|---|---|
| 001 | Auth (CC flow, 23h TTL) | 4h | 0% |
| 002 | Webhook handler + async 2xx | 4h | 70% |
| 003 | Verificación de firma **ECR** | 2h | 65% |
| 004 | Health check PING endpoint **ECR** | 1h | 80% |
| 005 | Función canónica de ingestión | 3h | 70% |
| 006 | Normalizer (requiere payload real) | 6h | 0% |
| 007 | Accept order | 2h | 40% |
| 008 | Reject order + reasons.ts | 3h | 40% |
| 009 | Mark ready (contador 3 llamadas) | 2h | 40% |
| 010 | DLQ fail-closed | 2h | 100% |
| 011 | Audit log completo | 1h | 100% |
| 012 | Poller reconciliación (solo fallback) | 6h | 40% |
| 013 | Order route (dashboard) | 3h | 60% |
| 014 | Reconcile route | 2h | 50% |
| 015 | Sandbox + CI workflow | 6h | 20% |
| **Total** | | **~47h** | **~68%** |

### Comparación v0.1 vs v0.2

| Dimensión | v0.1 (polling primario) | v0.2 (webhook primario) |
|---|---|---|
| Horas totales | ~43h | ~47h (+4h) |
| % Reuse | ~62% | ~68% |
| Latencia de ingesta | 0–45s (avg ~22s) | ~1–5s |
| Complejidad de infra | Cron + route | Webhook endpoint + cron + health check |
| Riesgo sig format | No aplicaba | MEDIO — ECR |
| Riesgo timeout 6min | ALTO (45s worst case) | BAJO (~1-5s) |
| Parecido a Uber | BAJO | ALTO (mismo patrón) |

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Formato `Rappi-Signature` diferente al documentado | Media | **ALTO** — webhook handler rechazaría todas las órdenes | EXTERNAL CONFIRMATION REQUIRED antes de RAPPI-003 |
| Precios en centavos vs MXN | Alta | **ALTO** — error ×100 en todos los montos | Payload real antes de RAPPI-006 |
| Polling con semántica destructiva no confirmada | Media | MEDIO — define diseño de reconciliación | EXTERNAL CONFIRMATION REQUIRED antes de RAPPI-012 |
| PING health check desactiva webhook si no responde | Media | ALTO | RAPPI-004 es prerequisito de RAPPI-002 |
| Wansoft-Rappi activo simultáneamente | Alta (sin coordinación) | **ALTO** — dos consumidores, pedidos duplicados | Coordinar switch `data_source` antes de activar |
| SLA 98% sin período de gracia | Alta | ALTO | Observabilidad desde día 1; no lanzar sin alertas en `agent_runs` |
| No hay sandbox de Rappi | Alta | MEDIO | Mock del HTTP client en tests + payload real de producción (log-only) |

### Decisiones internas — Cerradas

| Decisión | Resolución | Fecha |
|---|---|---|
| Aceptación de órdenes | **Manual desde POS/KDS** — temporizador visible, alertas crecientes, auto-accept como feature flag desactivado por defecto | 2026-08-02 |
| Mecanismo del poller | **Vercel Cron + DB advisory lock por storeId** — sujeto a 5 pre-condiciones antes de RAPPI-012 | 2026-08-02 |

### Blockers externos — 4 abiertos

> RAPPI-001 abierto el 2026-08-14. Contacto: Rodrigo / `integraciones_rest@rappi.com`

1. `RAPPI_CLIENT_ID` y `RAPPI_CLIENT_SECRET` — credenciales OAuth 2.0 client_credentials DEV recibidas; no documentar valores.
2. `storeId` de pruebas en la plataforma Rappi México recibido; no documentar valores sensibles/operativos en git.
3. **Contrato de webhook completo:** formato exacto de `Rappi-Signature`, string firmado, secreto HMAC y proceso de rotación, URL/método del health PING, garantía de entrega y política de retries
4. **Payload real de una orden:** estructura JSON completa + confirmación de unidad monetaria (pesos MXN o centavos)

### ECR — Pendientes de confirmación escrita de Rappi

- Formato del header `Rappi-Signature` y del string firmado para HMAC-SHA256
- Garantía de entrega del webhook (at-least-once, best-effort) y número de retries
- Método HTTP (GET o POST) y URL exacta del health PING
- Semántica de `GET /stores/{storeId}/orders` — ¿dequeue destructivo o idempotente?

---

*Documento v0.2 — 2026-08-02. No implementar código hasta cerrar los 4 blockers externos. Decisiones internas cerradas. Campos marcados ECR requieren confirmación escrita de Rappi antes de implementar RAPPI-003 y RAPPI-012.*
