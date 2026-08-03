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

- [ ] `RAPPI_CLIENT_ID` recibido
- [ ] `RAPPI_CLIENT_SECRET` recibido
- [ ] `storeId` de AMALAY confirmado
- [ ] Formato de `Rappi-Signature` documentado oficialmente
- [ ] String firmado para HMAC confirmado
- [ ] Secreto HMAC recibido
- [ ] URL/método del PING confirmado
- [ ] Payload de ejemplo de orden recibido
- [ ] Unidad monetaria (MXN o centavos) confirmada
- [ ] Semántica del polling (destructivo o no) confirmada
- [ ] Sandbox disponible (sí/no)

**Cuando todos estén marcados → abrir RAPPI-001.**
