# DiDi Food — estado real y camino para cerrarlo

> Última revisión: **2026-09-09**. Se leyó la documentación pública de developers de DiDi de
> punta a punta y se corrigieron dos supuestos del análisis original (ver "Historial").

## Resumen ejecutivo (2026-09-09)

- **La puerta de MX existe y es self-serve.** `developer.didi-food.com` → "POS Vendor
  Self-Service Integration". El grueso del alta (registro, perfil, app de prueba, tienda de
  prueba) se hace **sin esperar a nadie**.
- **El CNPJ NO bloquea México.** El proceso oficial de credenciales dice, textual: *"If you
  don't have the DUNS, please add the Tax ID of your company"* y lista **RFC** (NIT/RFC/NUT)
  como identificador fiscal válido. La app consumer de prueba está disponible para **México**.
  El supuesto del 2026-08-26 (que el CNPJ podía cerrar la puerta a MX) queda **descartado**.
- **El correo del 2026-08-26 fue al buzón equivocado.** Se escribió a
  `didiOpenApiSupport@didiglobal.com` y hubo **silencio 14 días**. La doc oficial indica
  notificar el alta del perfil a **`globalsupportapi@didiglobal.com`** — ese es el buzón que
  revisa perfiles y define si hay que firmar el Technology Integration Agreement.
- **El contrato de API es público y ya está capturado abajo.** Auth, webhook de órdenes, firma,
  ciclo de vida y menú. Mapea **1:1** con lo que ya construimos para Rappi y Uber. El build queda
  totalmente dimensionado; ya no hay incógnitas de diseño.
- **El receptor de DiDi que ya está en `main` está roto y sin firmar.** Se corrigió en este mismo
  workstream contra el contrato real (ver "Defectos del worker"), con prueba offline usando el
  payload de ejemplo de la propia doc de DiDi. Falta validación en sandbox (necesita credenciales).

**Estado global:** `PARCIALMENTE_DESBLOQUEADO`. Lo self-serve puede arrancar cuando Daniel quiera;
sigue siendo secundario a cerrar Uber. Prioridad de secuencia sin cambios (Uber/Rappi primero).

---

## Dos cosas que solo puede hacer Daniel

1. **Registrar la cuenta de developer** en `developer.didi-food.com` (Sign Up). Crear cuentas y
   capturar contraseñas es acción del usuario, no del agente. Pasos exactos abajo.
2. **Aprobar/enviar el correo corregido** a `globalsupportapi@didiglobal.com` (borrador listo abajo).
   El del 2026-08-26 fue al buzón que no revisa altas.

---

## Contrato de API (capturado de `developer.didi-food.com`, 2026-09-09)

> ⚠️ El portal advierte que puede cambiar sin aviso y que las secciones restringidas son
> confidenciales. Lo de abajo es de las secciones públicas, para dimensionar; la fuente de verdad
> al construir es el **YAML/OpenAPI descargable** dentro del portal (Developer Documents).

### Host y envelope
- **API base:** `https://openapi.didi-food.com`
- **Respuesta estándar:** `{ "errno": 0, "errmsg": "ok", "requestId": "...", "time": <unix>, "data": {...} }`.
  `errno == 0` = ok. Códigos de error por endpoint (ej. `10102 auth_token has expired`).

### Autorización (`Authorization API`)
Modelo **app + tienda**, más simple que el OAuth de Rappi/Uber:
- `GET /v1/auth/authtoken/get?app_id=&app_secret=&app_shop_id=` → devuelve `auth_token` (por
  tienda) y `token_expiration_time`. El token expira en fecha aleatoria → chequear y refrescar.
- `Refresh Authtoken` para renovar.
- `Get Authorization Web Page` → página que el **merchant** usa para autorizar el binding de su
  tienda (equivalente a la página de OAuth del merchant en Rappi).
- `app_id` / `app_secret` = credenciales de la app (del alta). `app_shop_id` = id de la tienda en
  **nuestro** sistema.

### Webhook de órdenes (`Order Webhooks`) — el corazón
- DiDi hace POST al URL registrado al crear la app. Eventos: **`orderNew`** (consumidor creó y
  **pagó**; hay que **confirmar en < 5 min** vía `order/order/confirm` o se auto-cancela), más
  eventos de cambio de estado/cancelación.
- **Firma (Security):** header **`didi-header-sign`** = **`MD5(rawBody + APP_SECRET)`** en hex.
  Verificación: `checkSign = MD5({POST body raw} + {APP_SECRET})`; comparar contra el header.
  (Distinto a Uber = HMAC-SHA256, y a Rappi.)
- **Gotcha 64-bit:** `app_id`, `order_id`, `shop_id` son `long`. En Node/JS `JSON.parse()`
  **corrompe** el número (`5764607801871631353` → `...000`). Hay que usar `json-bigint` **o**
  extraer esos IDs como **string** del cuerpo crudo. `app_shop_id` viene entre comillas (string),
  así que ese sí sobrevive.
- **Estructura** (igual que `GET /order/order/detail`):
  ```
  { app_id, app_shop_id, timestamp, type:"orderNew",
    data: { order_id, order_info: {
      status(100=nueva), pay_type, delivery_type,
      expected_cook_eta, expected_arrived_eta, create_time, ...
      price: { order_price, real_price, delivery_price, refund_price,
               customer_need_paying_money, others_fees:{service_price,coupon_discount,total_tip_money}},   // TODO en CENTAVOS
      shop: { shop_id, app_shop_id, shop_addr, shop_name, shop_phone[] },
      receive_address: { first_name, last_name, name, calling_code, phone, poi_address, poi_lat, poi_lng },
      order_items: [ { app_item_id, app_external_id, name, total_price, sku_price, amount, remark,
                       sub_item_list: [ ...modificadores anidados... ] } ]
    } } }
  ```
  **Precios en centavos** (`order_price: 2000` = $20.00). Cantidad = `amount` (no `quantity`).
  Modificadores = `sub_item_list` (no `attributes`/`options`).

### Ciclo de vida de la orden (`Order API`)
`Get Order Details`, **`Confirm Order`**, `Confirm Cash Payment`, **`Cancel Order`**,
`Order Partial Cancel`, `Handle Cancellation Requests`, `Handle Refund Requests`, **`Order Ready`**,
**`Order Delivered`**, `Order Verification`, **`Adjust Order Items`** (= equivalente al
`resolve-fulfillment-issues` de Uber: quitar/ajustar ítems agotados), `Promotions`.

### Tienda (`Store API`)
`Bind/Unbind Store`, `Set Store Order Confirmation Method`, `Get/Update Store Details`,
`Get Store Categories`, **`Set Store Status`** (online/offline, = activar tienda de Uber),
`Set Store Cancellation/Refund`, `Set Store Delivery Area`, `List Bind/Authorized Stores`,
`Store Webhooks`.

### Menú (`Food Menu API`)
`Get/Upload Store Menu Details` (**upload asíncrono** → `Get Menu Upload Task Info`, igual que
Rappi), `Update One Item`, **`Update Item Status`** (toggle disponibilidad = nuestro OOS sync),
`Update Modifier Group`, `Upload Image`, `Menu Webhooks`. (También `Grocery Menu API` y `Stock API`.)

### Reportes
`Payment Reconciliation Report` (= nuestro `reconcile`).

**Mapeo de reuso** — cada pieza de DiDi tiene su gemela ya hecha:

| DiDi | Ya existe en Fullsite |
|---|---|
| `authtoken/get` + Authorization Web Page | OAuth 2-token de Rappi / OAuth de Uber |
| `Bind Store` + `Set Store Status` | activar tienda Uber / provisioning Rappi |
| `Upload Menu` + task async | `lib/integrations/rappi/menu.ts` + upload task |
| `Update Item Status` | OOS sync (`oos_sync_enabled`) |
| `orderNew` webhook + Confirm/Cancel/Ready/Delivered | ciclo de orden Rappi/Uber |
| `Adjust Order Items` | `resolve-fulfillment-issues` de Uber |
| `Payment Reconciliation` | `api/integrations/uber-eats/reconcile` |

---

## Defectos del worker (corregidos en este PR)

El receptor de DiDi en `cloudflare/delivery-worker/src/index.ts` era **adivinanza previa al
contrato** y fallaba en todos los campos. Además el worker **es** el receptor de DiDi (la nota del
propio archivo lo dice: Uber va por el framework v1; Rappi y DiDi van por el worker). Hallazgos:

1. **Sin verificación de firma.** El worker declara `DIDI_APP_SECRET` pero nunca validaba
   `didi-header-sign` → endpoint `/didi` **sin autenticar** (hoy mitigado solo porque no hay tienda
   DiDi mapeada → cae a DLQ). **Fix:** verificar `MD5(rawBody + DIDI_APP_SECRET)` fail-closed.
2. **`request.json()` corrompía los IDs de 64 bits.** **Fix:** leer `request.text()` crudo (además
   necesario para la firma) y extraer `order_id` como string.
3. **`extractDidiStoreId` buscaba `shop_id`;** el real es **`app_shop_id`** (top-level, y en
   `data.order_info.shop.app_shop_id`) → tenant no resolvía → DLQ. (Misma clase de bug que el de
   Uber #370.) **Fix:** leer `app_shop_id`.
4. **`parseDidiOrder` mapeaba mal todo:** ítems en `data.order_info.order_items`, precios en
   centavos (÷100), cantidad `amount`, modificadores `sub_item_list`, cliente en `receive_address`,
   total en `price.customer_need_paying_money`. **Fix:** reescrito al contrato real + prueba offline
   con el payload de ejemplo de la doc de DiDi.

> Pendiente: validación en **sandbox** (necesita credenciales del alta). El fix está probado contra
> el payload documentado, no contra tráfico real todavía.

---

## Pasos de alta self-serve (para Daniel)

Del proceso oficial "Obtaining Credentials":

1. **Registrarse como Developer** en `developer.didi-food.com` (botón *Sign Up*).
2. **Crear Business Profile** en *Qualifications* (Tools Introduction → Qualification Management).
   En el campo de identificador: si no hay DUNS, poner el **RFC** de FULLSITE SAS. Adjuntar lo que
   pida. Al terminar, **notificar a `globalsupportapi@didiglobal.com`** para que revisen el perfil
   y digan si hay que firmar el **Technology Integration Agreement** (si sí: Acta Constitutiva, RFC,
   Poder Notarial, ID del representante legal).
3. **Crear Developer APP** (test + prod) en Application Management. Ahí se define el **URL del
   webhook** (apuntar al worker `/didi`) y se obtiene `app_id` / `app_secret`.
4. **Crear tienda de prueba** y **pedir cuenta consumer de prueba** (empieza con "000", código de
   verificación fijo, válida 2 meses) para poder poner órdenes de prueba desde la app DiDiFood.
5. Herramientas de prueba: **DiDiStore** (app de comercio; Android/Exe, no iOS) y **DiDiFood**
   (app consumer; iOS cambiando el país de la App Store a MX, o Android).

Cuando existan `app_id` / `app_secret`, van como secrets del worker
(`wrangler secret put DIDI_APP_SECRET`) y arranca la validación en sandbox.

### ✉️ Borrador de correo corregido (a enviar por Daniel, con su OK)

> **Para:** globalsupportapi@didiglobal.com
> **Asunto:** POS Vendor Self-Service Integration — Fullsite (Mexico) — business profile review
>
> Hi DiDi Open API team,
>
> Following up on our interest in the POS Vendor Self-Service Integration for **Mexico**
> (an earlier note on Aug 26 went to didiOpenApiSupport@ and we didn't hear back).
>
> We are **Fullsite** (Monterrey, Mexico), a restaurant POS + operations platform. We already run
> direct integrations with Rappi and Uber Eats; pilot merchant is **Café AMALAY** (San Pedro Garza
> García, Nuevo León).
>
> Per your "Obtaining Credentials" guide we are registering on developer.didi-food.com and
> preparing our business profile in Qualifications using our **RFC** as tax ID (we don't have a
> DUNS/CNPJ). Could you please:
> 1. Confirm this is the right path for a POS vendor in **Mexico** and review our profile once
>    submitted, and whether we need to sign the Technology Integration Agreement.
> 2. Confirm sandbox access so we can start testing (order webhook, order lifecycle, menu sync).
>
> Thank you,
> Daniel Ramonfaur — Fullsite — daniel@fullsite.mx

---

## Recomendación de secuencia (sin cambios de fondo)

DiDi sigue siendo **secundario a cerrar Uber**. Lo que cambió es que ya **no está bloqueado por un
inbox mudo**: el alta self-serve puede arrancar en cualquier momento y no cuesta atención de dev.
Orden sugerido:

1. Cerrar Uber (cert en curso, pelota del lado de ellos).
2. Cutover de Rappi cuando Daniel lo decida (gate offline/KDS + rollback con Rodrigo).
3. DiDi: alta self-serve (Daniel) → sandbox → construir sobre el patrón de Rappi/Uber ya
   dimensionado arriba.

---

## Historial

### 2026-08-26 — Primera investigación

Se descubrió DiDi Food Open Platform (`developer.didi-food.com`) con el track "POS Vendor
Self-Service Integration" (6 pasos: Certification & Application → Test App → Debugging → Testing &
Acceptance → Authorization Service → Online Service Guarantees), y que el patrón es el mismo de Uber
y Rappi. Reuso identificado: el worker ya distinguía `provider='didi'`; el adaptador de Rappi es
trasladable; KDS y `/pos/delivery` son agnósticos de plataforma.

Se envió un correo a `didiOpenApiSupport@didiglobal.com` desde `daniel@fullsite.mx`
(asunto *POS Vendor Self-Service Integration - Fullsite (Mexico)*) preguntando la puerta de MX, el
campo CNPJ y la doc/sandbox. Quedó en `ESPERANDO_EXTERNO`.

**Dos supuestos de esa fecha, corregidos el 2026-09-09:**
- ❌ *"El CNPJ (Brasil) puede cerrar la puerta a MX."* → **Falso.** El proceso acepta **RFC**
  (Tax ID) cuando no hay DUNS; MX está soportado.
- ❌ *"Contacto = `didiOpenApiSupport@didiglobal.com`."* → El buzón que revisa altas de perfil es
  **`globalsupportapi@didiglobal.com`** (por eso el silencio de 14 días).

Ver [`../IDENTIDADES-Y-ACCESOS.md`](../IDENTIDADES-Y-ACCESOS.md) para el registro de cuentas.
