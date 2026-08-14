# Rappi — External Access Pack v1.0

> **Estado:** `WAITING_EXTERNAL` — Correo enviado 2026-08-02 a Rodrigo + `integraciones_rest@rappi.com`  
> **Fecha:** 2026-08-01 (actualizado 2026-08-02)  
> **Blocker:** Respuesta de Rappi con los 11 ítems del checklist en `RAPPI-ONBOARDING-REQUEST.md`

---

## Canales de contacto — Orden de prioridad

| Prioridad | Canal | Acción |
|---|---|---|
| **1** | **Email directo: `integraciones_rest@rappi.com`** | **Canal oficial de onboarding de integraciones REST. Primera acción.** |
| 2 | Dev portal: `https://dev-portal.rappi.com/en/` | Formulario "Get Access" / "Request Integration" — especificar país: México |
| 2 (paralelo) | Portal restaurante: `https://restaurants.rappi.com.mx` | Iniciar sesión con cuenta AMALAY → sección "Integraciones" o "API / POS" |
| 3 | Ejecutivo de cuenta Rappi de AMALAY | Escalar a equipo de Technical Integrations / Partner Engineering de Rappi México |
| Respaldo | LinkedIn — búsqueda "Rappi Partner Engineering" o "Rappi Technical Integrations" | Perfiles con sede en México, Colombia, Brasil |

> Email confirmado por research: `integraciones_rest@rappi.com` — es el TAM (Technical Account Manager) que crea credenciales en Auth0 manualmente. Usar como línea de apertura.

---

## Texto de solicitud — Español

**Asunto:** Solicitud de credenciales API — Integración POS para restaurante AMALAY

Estimado equipo de Partner Integrations de Rappi,

Me dirijo a ustedes en nombre de [Fullsite / AMALAY]. Somos la empresa tecnológica que desarrolla el sistema POS del restaurante AMALAY, ubicado en San Pedro Garza García, Nuevo León, México.

**Objetivo**  
Integramos la plataforma Fullsite POS directamente con la API de restaurantes de Rappi para:
- Recibir automáticamente las órdenes de Rappi en el sistema de cocina (KDS) del restaurante.
- Confirmar aceptación, tiempo de preparación y estado de entrega sin intervención manual.
- Reducir errores de captura y tiempos de respuesta para los clientes de Rappi.

**Tecnología de integración**  
Utilizamos el flujo de polling REST documentado en dev-portal.rappi.com, con OAuth 2.0 client_credentials. El stack es Next.js 15 + Supabase. La integración es un servidor privado; no exponemos credenciales en el cliente.

**Datos que necesitamos:**
1. `client_id` y `client_secret` para el flujo OAuth 2.0 (client_credentials)
2. `storeId` de AMALAY en la plataforma Rappi México
3. URL base de ambiente de desarrollo/sandbox (`api.dev.rappi.com`) y credenciales de prueba si están disponibles
4. Confirmación del formato de montos en el payload de órdenes (pesos MXN o centavos)
5. Ejemplo de payload de una orden real o de prueba

**Restaurante:**
- Nombre: AMALAY
- País: México (Monterrey / San Pedro Garza García, NL)
- RFC: AFO200806JI0
- Cuenta Rappi activa: Sí

Saludos,  
[Nombre] · [Cargo] — Fullsite  
[Email] · [Teléfono]

---

## Texto de solicitud — English

**Subject:** API Integration Access Request — AMALAY Restaurant, Mexico

Hi Rappi Partner Integrations team,

I'm reaching out on behalf of [Fullsite], the POS technology provider for AMALAY restaurant in San Pedro Garza García, Nuevo León, Mexico.

We're integrating Fullsite POS with Rappi's restaurant API to automatically receive and accept Rappi orders in AMALAY's kitchen display system (KDS), eliminating manual order entry.

Our implementation follows the REST polling flow documented at dev-portal.rappi.com using OAuth 2.0 client_credentials. The integration runs server-side only (Next.js 15 + Supabase).

**Access required:**
1. OAuth 2.0 `client_id` and `client_secret` for the client_credentials flow
2. AMALAY's `storeId` on the Rappi México platform
3. Sandbox / development environment access at `api.dev.rappi.com` (if available)
4. Confirmation: are order amounts in MXN pesos or centavos in the order payload?
5. A sample order payload JSON (real or test)

**Restaurant:** AMALAY · Mexico (Monterrey, NL) · Active Rappi account: Yes

Best regards,  
[Name · Title · Fullsite] · [Email · Phone]

---

## Datos a solicitar (9 ítems)

| # | Dato | Por qué |
|---|---|---|
| 01 | `client_id` | Requerido para POST al auth endpoint |
| 02 | `client_secret` | Requerido para obtener access token |
| 03 | `storeId` de AMALAY | Requerido en todos los endpoints de lifecycle |
| 04 | URL + credenciales sandbox (`api.dev.rappi.com`) | Imprescindible para implementar sin afectar órdenes reales |
| 05 | Formato de montos (MXN o centavos) | Crítico para normalizer — error produce precios incorrectos en todas las órdenes |
| 06 | Payload de ejemplo de una orden | Permite construir normalizer sin suposiciones |
| 07 | Confirmación del header `x-authorization: "Bearer <token>"` | Header específico de Rappi — verificar explícitamente |
| 08 | Acuerdo de integrador / Partnership agreement | Si existe, solicitar en primer contacto para no bloquear después |
| 09 | Contacto técnico de soporte para integradores | No el soporte general — el canal de Partner Engineering |

---

## Preguntas técnicas abiertas (8)

| ID | Pregunta | Impacto |
|---|---|---|
| TQ-01 | ¿Montos en payload en pesos MXN o centavos? | **CRÍTICO** — impacta normalizer completo |
| TQ-02 | ¿El polling devuelve solo órdenes nuevas no procesadas o también órdenes en otros estados? | **CRÍTICO** — impacta estrategia de dedup |
| TQ-03 | ¿El SLA 98% aplica desde día 1 o hay período de gracia? | Alto — impacta estrategia de lanzamiento |
| TQ-04 | ¿Hay sandbox con órdenes de prueba generables o solo producción? | Alto — impacta cómo hacemos las pruebas |
| TQ-05 | ¿Qué sucede si el integrador no llama a `accept` dentro de un tiempo límite? | Alto — impacta decisión operacional de auto-accept |
| TQ-06 | ¿`ITEM_STOCKOUT` vs `ITEM_NOT_FOUND` para artículo no disponible temporalmente? | Medio — mapping de cancelTypes |
| TQ-07 | ¿El polling desde múltiples instancias genera duplicados o hay control en Rappi? | Medio — impacta diseño del mutex |
| TQ-08 | ¿Existe algún webhook push complementario para actualizaciones de estado? | Medio — podría simplificar tracking post-aceptación |

---

## Decisión de arquitectura pendiente — Poller

El mecanismo de polling requiere decisión explícita sobre HA, mutex y observabilidad antes de implementar RAPPI-002.

| Mecanismo | HA | Mutex | Observabilidad | Costo |
|---|---|---|---|---|
| GitHub Actions cron | GitHub SLA ≈99.9%, retrasos posibles | Requiere DB lock (`SELECT FOR UPDATE SKIP LOCKED`) | `agent_runs` + alerta si última run > 3 min | $0 |
| Vercel Cron (Fluid Compute) | Vercel SLA, sin retrasos de cola | Misma lógica de DB lock | Vercel Functions dashboard + `agent_runs` | Incluido |
| Vercel Queues | Alta (at-least-once) | Nativa por partición de storeId | Queue metrics nativas | Beta pública |

Decisión pendiente: depende de respuesta a TQ-07.

---

## Capturar primer payload — Sin afectar operación

### Opción A (preferida): api.dev.rappi.com con credenciales dev

```bash
# Paso 1: Obtener token
curl -X POST https://api.dev.rappi.com/restaurants/auth/v1/token/login/integrations \
  -H "Content-Type: application/json" \
  -d '{"client_id":"DEV_CLIENT_ID","client_secret":"DEV_SECRET"}' \
  | tee /tmp/rappi_token.json

# Paso 2: Poll una vez
TOKEN=$(cat /tmp/rappi_token.json | jq -r '.access_token')
curl -X GET "https://api.dev.rappi.com/restaurants/orders/v1/orders" \
  -H "x-authorization: Bearer $TOKEN" \
  | tee /tmp/rappi_payload_sample.json
```

### Opción B: Log-only en producción (si no hay sandbox)

Ruta temporal `/api/integrations/rappi/capture-sample` que hace el GET y retorna el raw JSON sin ningún write, accept ni auditLog. Ejecutar UNA vez fuera de horario pico. Eliminar la ruta después.

**Preguntas a responder con el payload:**
- ¿Precios en MXN o centavos?
- Estructura exacta de `items[].subitems[]` (modificadores)
- ¿`order_id` es UUID string o entero?
- ¿Qué campos de cliente están disponibles?
- ¿Response es array o paginado?

Guardar resultado en: `docs/integrations/rappi/sample-order-payload.json`

### ⚠️ Advertencia operacional — Wansoft-Rappi probablemente activo en AMALAY

Research indica que Wansoft, Parrot Software y Soft Restaurant tienen integraciones nativas con Rappi en México. **Las órdenes de Rappi de AMALAY probablemente ya fluyen por Wansoft hoy.** Esto significa:
- Antes de activar la integración Fullsite-Rappi, verificar en `clients` el valor de `data_source` para AMALAY
- El switch a Fullsite-Rappi debe ocurrir en el mismo momento que el switch general de `data_source=wansoft` → `data_source=fullsite`
- Nunca tener dos consumidores del polling de Rappi activos simultáneamente (Wansoft + Fullsite)

---

## Gate — READY TO IMPLEMENT (8 condiciones)

> RAPPI-001 no abre hasta que **todas** estén cumplidas.

| Tipo | Condición |
|---|---|
| **Externo** | `RAPPI_CLIENT_ID` y `RAPPI_CLIENT_SECRET` recibidos y verificados con POST manual exitoso al endpoint de auth |
| **Externo** | `storeId` de AMALAY confirmado en Rappi México |
| **Externo** | Formato de montos confirmado (MXN o centavos) |
| **Externo** | Al menos un payload de orden real/prueba en `docs/integrations/rappi/sample-order-payload.json` |
| **Interno** | Decisión de arquitectura del poller aprobada por Daniel (mecanismo + mutex + observabilidad) |
| **Operativo** | Decisión explícita de Daniel: ¿aceptación automática de órdenes o manual? |
| **Interno** | Header `x-authorization: "Bearer <token>"` verificado con request manual exitoso |
| **Interno** ✅ | Design v0.1 aprobado — completado 2026-08-01 |
