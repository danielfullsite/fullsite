# Rappi — Mensaje de onboarding técnico

> **Enviado:** 2026-08-02 — Rodrigo (ejecutivo de cuenta de AMALAY en Rappi) + CC `integraciones_rest@rappi.com`  
> **Estado:** `WAITING_EXTERNAL` — Esperando respuesta  
> Objetivo: obtener los 4 blockers externos que desbloquean RAPPI-001

---

## Asunto sugerido

```
Integración POS ↔ Rappi para AMALAY — Solicitud técnica de onboarding
```

---

## Mensaje (español — versión para enviar)

Rodrigo,

Espero que estés bien. Te escribo porque estamos construyendo la integración directa entre el sistema POS de AMALAY y la plataforma de Rappi.

**Qué estamos haciendo**

Fullsite es el POS que opera en AMALAY (San Pedro Garza García, NL). La integración recibirá las órdenes de Rappi directamente en el sistema de cocina del restaurante, eliminando la transcripción manual. Usamos Next.js 15 en backend (servidor privado, sin exposición de credenciales al cliente) y seguimos el flujo de webhooks REST documentado en `dev-portal.rappi.com`.

Para avanzar necesito que nos apoyes con lo siguiente:

---

**1. Credenciales de acceso a la API**

- `client_id` y `client_secret` para el flujo OAuth 2.0 `client_credentials`
- (Endpoint de auth: `POST .../restaurants/auth/v1/token/login/integrations`)

---

**2. Store ID de AMALAY**

El identificador del restaurante AMALAY en la plataforma Rappi México. Es el `storeId` que usamos en todos los endpoints de lifecycle de órdenes (`/stores/{storeId}/orders`, etc.).

---

**3. Documentación del webhook push**

Según el dev portal, Rappi notifica nuevas órdenes via push a un endpoint nuestro. Necesitamos confirmación exacta de:

a) **Formato del header de firma:** el portal menciona `Rappi-Signature` — ¿el valor es `t=<unix_timestamp>,sign=<hex_digest>`? ¿O tiene un formato diferente?

b) **String firmado para HMAC-SHA256:** ¿es `<timestamp>.<raw_body>` o es solo `<raw_body>`? (Necesitamos saber exactamente qué se firma para implementar la verificación correctamente.)

c) **Secreto de firma:** ¿cómo se otorga el secreto HMAC? ¿Rappi nos lo envía al registrar el webhook, o lo generamos nosotros?

d) **URL de registro del webhook:** ¿hay un portal donde registramos nuestro endpoint, o se lo enviamos a ustedes manualmente?

e) **Garantía de entrega:** ¿el webhook es at-least-once (con retries)? Si nuestro endpoint está caído, ¿Rappi reintenta? ¿Cuántas veces y con qué backoff?

---

**4. Health check / PING**

El portal menciona que Rappi hace un PING periódico a nuestro servidor. Necesitamos saber:

a) ¿Qué método HTTP usa el PING (GET o POST)?  
b) ¿A qué ruta espera hacer el request (ej. `/health`, `/ping`)?  
c) ¿Qué respuesta espera (ej. `{"status":"OK"}` o solo HTTP 200)?  
d) ¿Con qué frecuencia llega el PING?

---

**5. Payload de ejemplo de una orden**

Un JSON completo de una orden real o de prueba que devuelva `GET /stores/{storeId}/orders`. Con esto podemos mapear todos los campos sin hacer suposiciones.

En particular necesitamos confirmar:

a) **Unidad de los montos:** ¿`totals.products_subtotal`, `totals.charges`, `totals.tips` vienen en **pesos MXN** o en **centavos** (es decir, hay que dividir entre 100)?  
b) Estructura de `items[].subitems[]` (modificadores / personalizaciones)  
c) Tipo de dato de `order_id` (¿string UUID o entero?)

---

**6. Semántica del polling**

El endpoint `GET /stores/{storeId}/orders` — cuando lo consultamos, ¿las órdenes que devuelve "desaparecen" del response en la siguiente consulta (semántica de dequeue/cola), o siguen disponibles hasta que las confirmemos explícitamente?

Esto impacta cómo diseñamos el mecanismo de reconciliación.

---

**7. Sandbox / ambiente de pruebas**

¿Hay acceso a `api.dev.rappi.com` con credenciales de prueba y órdenes generables? Si existe, ¿se obtiene con las mismas credenciales de producción o son separadas?

Si no hay sandbox disponible, ¿cuál es el mecanismo recomendado para hacer pruebas sin afectar órdenes reales del restaurante?

---

Quedo disponible para una llamada técnica si prefieres resolver estos puntos más rápido.

Muchas gracias,

**[Nombre]**  
Fullsite  
[email] · [teléfono]

---

## Versión en inglés (para CC a integraciones_rest@rappi.com o equipo técnico)

Subject: AMALAY Restaurant — POS/Rappi Integration Technical Onboarding Request

Hi,

We are building a direct REST integration between AMALAY restaurant's POS system (Fullsite) and Rappi México. AMALAY is located in San Pedro Garza García, NL and is an active Rappi partner. We are implementing the webhook push flow documented at dev-portal.rappi.com.

To proceed, we need the following from your technical team:

**1. API credentials**
- `client_id` and `client_secret` for the OAuth 2.0 `client_credentials` flow  
- Auth endpoint: `POST .../restaurants/auth/v1/token/login/integrations`

**2. AMALAY store ID**
- The `storeId` used in all order lifecycle endpoints (`/stores/{storeId}/orders`, etc.)

**3. Webhook documentation**
We need to confirm the following — the dev portal mentions these but does not provide full private integration specs:

a. Exact format of the `Rappi-Signature` header value (is it `t=<unix_ts>,sign=<hex>`?)  
b. Exact signed string for HMAC-SHA256 verification (is it `<timestamp>.<raw_body>` or just `<raw_body>`?)  
c. How the HMAC signing secret is provisioned and rotated  
d. Webhook registration process (portal self-service or manual via your team?)  
e. Delivery guarantee: at-least-once with retries? How many retries? What backoff?

**4. Health check / PING**
a. HTTP method of the PING request (GET or POST?)  
b. Expected path on our server (e.g. `/health`?)  
c. Expected response body (`{"status":"OK"}` or just HTTP 200?)  
d. PING frequency

**5. Sample order payload**
A full JSON response from `GET /stores/{storeId}/orders` (real or test order). We specifically need to confirm:  
a. Whether `totals.products_subtotal`, `totals.charges`, and `totals.tips` are in **MXN pesos** or **centavos** (÷100)  
b. Structure of `items[].subitems[]` (modifiers / customizations)  
c. Data type of `order_id` (UUID string or integer?)

**6. Polling semantics**
Is `GET /stores/{storeId}/orders` destructive (dequeue — orders disappear from the next response after being fetched), or do orders remain available until explicitly accepted?

**7. Sandbox / test environment**
Is `api.dev.rappi.com` available with test credentials and synthetic orders? If not, what is the recommended testing approach without affecting live AMALAY orders?

We are ready to share our webhook endpoint URL and technical architecture document upon request.

Thank you,

**[Name]**  
Fullsite  
[email] · [phone]

---

## Checklist de respuesta esperada de Rappi

Marcar cuando se reciba confirmación escrita:

- [x] `RAPPI_CLIENT_ID` recibido — 2026-08-29, vía self-onboarding. **El valor NO va en este archivo**
      (§13): vive en el secret store como `RAPPI_CLIENT_ID`.
- [ ] `RAPPI_CLIENT_SECRET` recibido — **ÚNICO PENDIENTE REAL.** Ojo: lo que llegó el 2026-08-29 fue
      usuario y contraseña del *portal* de self-onboarding, que **no** es el `client_secret` del flujo
      `client_credentials`. Se saca de la sección de credenciales del portal.
- [x] `storeId` de AMALAY confirmado — `MX1930030014` (brandId: `MX491066`) — extraído de URL partners.rappi.com 2026-08-03
- [x] Formato de `Rappi-Signature` **CONFIRMADO 2026-08-29** en `dev-portal.rappi.com/en/webhook-events/`,
      sección *Validating Your Signature*. Sí estaba en la doc pública; la nota anterior decía que no.
      · Header: `Rappi-Signature` (los headers **no** son case-sensitive según el portal)
      · Valor: `t=123456,sign=d74b65c2e68c1a84a4d5843a69ef5faf1d82f28df2dd3723e8e0dad9c54abc79`
      · String firmado: **`<timestamp>.<raw_payload>`** — ej. `123456.{ "message" : "this is an example" }`
      · HMAC-SHA256. Se parsea el header separando por `,` y luego por `=`.
      Coincide exactamente con lo que el DESIGN v0.2 había hipotetizado.
- [x] String firmado para HMAC: pendiente, pero secreto lo da Rappi en respuesta `POST webhook` — confirmado por doc pública
- [x] Secreto HMAC: Rappi lo devuelve en `POST /webhook` response campo `secret` — confirmado
- [x] PING **CONFIRMADO 2026-08-29** en `dev-portal.rappi.com/en/webhook-events/`, evento `PING`:
      · Recibe: `{"store_id": 999}`
      · Debe responder: `{"status":"OK","description":"Store on"}` — `status` obligatorio;
        si es `null` o distinto de `OK`, Rappi da la tienda por **no disponible**. `description` opcional.
      · Frecuencia: **cada 3 minutos** con webhook configurado (igual con Order Pulling).
      · 2 strikes por defecto antes de generar incidente; 1 minuto de tiempo de gracia.
      · **Requisito de arquitectura que el DESIGN no tenía:** *"This Ping must be implemented for each
        store and not on a central server."* Es por-tienda, no un `/health` global.
      Falta sólo el método HTTP explícito (el portal dice "will send the payload", lo que implica POST
      pero no lo escribe). Se resuelve al registrar el webhook y observar la primera llamada.
- [x] Payload de ejemplo de orden recibido — disponible en doc pública `GET /orders`
- [x] Unidad monetaria: **centavos** — confirmado por muestras de payload (28900 = $289 MXN)
- [x] Semántica del polling: `GET /orders` devuelve órdenes "nuevas" (persisten hasta ser tomadas/rechazadas) — confirmado por doc pública
- [x] Sandbox disponible: dev domain `microservices.dev.rappi.com` + `rests-integrations-dev.auth0.com`
      — **credenciales dev de self-onboarding recibidas 2026-08-29** (usuario `admon@cafeamalay.com`).
      Confirma que el ambiente separado existe y que tenemos acceso.

**Cuando todos estén marcados → abrir RAPPI-001.**

---

## Estado 2026-08-29 — 10 de 11 cerrados, y los 2 ECRs cayeron con doc pública

Los dos puntos que estaban marcados **"ECR ABIERTO (no en doc pública)"** sí estaban en la doc
pública, en `dev-portal.rappi.com/en/webhook-events/`. Nadie los había ido a leer; la nota anterior
afirmaba una ausencia sin haberla comprobado.

**Queda un solo pendiente: `RAPPI_CLIENT_SECRET`**, que es una credencial y sale del portal.

### Qué desbloquea esto

La regla del DESIGN (*NO escribir código · NO asumir contratos de API*) existía para no construir
sobre suposiciones. **Ya no hay suposiciones en el contrato**: firma, string firmado, PING, unidad
monetaria, semántica del polling y payload de orden están todos confirmados por fuente oficial.

El `client_secret` es un asunto de despliegue, no de diseño: el código se escribe leyéndolo de
variable de entorno y no cambia según su valor. **Se puede abrir RAPPI-001 y escribir la
integración; lo único que no se puede es ejecutarla en vivo hasta tener el secreto.**

### Correcciones al DESIGN v0.2.2 que salen de esto

1. El PING es **por tienda, no un endpoint central** (`/health` global no cumple). Esto cambia el
   módulo que el DESIGN §Arquitectura contemplaba.
2. El formato de firma que el DESIGN hipotetizó resultó exacto — se puede quitar el marcador ECR.
3. Falta sólo el método HTTP del PING; se observa en la primera llamada tras registrar el webhook.

**Seguridad:** las credenciales del 2026-08-29 llegaron por chat en texto plano → considerarlas
expuestas, rotar al terminar y dejarlas sólo en el secret store.
