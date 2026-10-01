> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track C — Pagos (México primero)

> **Sprint de investigación read-only, 2026-09-17.** Sin cambios de código, sin contacto con proveedores,
> sin acceso a producción. Fuentes primarias donde existen (docs oficiales, páginas de precios, Banxico,
> 10-K). Cada afirmación va etiquetada: **[HECHO]** = citado de fuente primaria con URL ·
> **[INFERENCIA]** = deducción razonada del autor · **[RECOMENDACIÓN]** = decisión propuesta ·
> **[NO PUBLICADO]** = se buscó y no hay dato público.
>
> Limitación del método: el presupuesto de búsqueda web se agotó al final del sprint (200 consultas);
> varias páginas de Mercado Pago (`/developers/...`), `clip.mx/tarifas` y el blog de MP devolvieron
> 403/404 al fetch. Donde eso pasó, se dice explícitamente y se usa la fuente secundaria más cercana
> (docs de Odoo, tabla de Banxico, índice `llms.txt` de Clip).

---

## 0. Resumen ejecutivo

1. **Fullsite no necesita ser procesador para controlar la UX de cobro y ganar economía de pagos.**
   El modelo probado en la industria (Toast, Shift4, Lightspeed) es *semi-integración* + acuerdo
   comercial con el adquirente. Toast reporta un *net take rate* de fintech de **58 bps** sobre
   **US$195 B** de GPV y **no** es adquirente: "relies on third-party payment processors" **[HECHO]**
   (10-K FY2025, ver §5). Shift4 gana **60.5 bps** de *blended spread* con **550+ integraciones ISV**
   **[HECHO]**.
2. **En México hoy hay tres terminales con API cloud→terminal que Fullsite puede orquestar desde el
   POS sin tocar PAN:** Mercado Pago Point Smart (Orders API, modo PDV), Clip (PinPad API) y NetPay Smart
   API (Monterrey). Getnet expone lo mismo por contrato; Clover/Fiserv exige contrato ISV para el
   kit de desarrollo; Stripe Terminal está en *preview* en MX con documentación contradictoria; Adyen
   sí reporta tasas de restaurante a Banxico pero es venta enterprise **[HECHO/INFERENCIA, ver tabla]**.
3. **La brecha de precio es enorme y es la oportunidad comercial.** Banxico (julio 2026, giro
   Restaurantes, crédito): Mercado Pago promedio **3.39 %**, Clip **3.50 %**, Stripe **3.59 %**, contra
   NetPay Adquirente **2.19 %**, Getnet **2.26 %**, BBVA **2.33 %**, Adyen **2.16 %** **[HECHO]**.
   El intercambio regulado para restaurantes es **1.76 % crédito** y **1.15 % débito (tope $13.50)**
   **[HECHO]**. Entre el intercambio y lo que paga un restaurante con Clip/MP hay ~170 bps de margen
   bruto del que un ISV puede negociar una parte.
4. **Pre-autorización presencial (tab de bar) no existe en ninguna API mexicana pública revisada**
   **[HECHO para MP Orders, Clip PinPad, NetPay Smart; consistente con la nota interna del
   2026-08-28 en `docs/strategy/BIBLE-SQUARE.md:159`]**. Sólo Stripe Terminal (extended auth) y Adyen
   (authorisation adjustment) lo documentan, y ninguno está GA en México para lectores.
5. **Offline:** la terminal debe tener su propia WAN (SIM 4G incluida en Point Smart 2 y Clip Pro 2/
   Ultra; la S710 de Stripe **no** tiene celular en MX). El *store-and-forward* del lado del POS es un
   riesgo que asume el comercio (Square: 72 h, expira sin recurso, "you're responsible for any expired,
   declined, or disputed payments") y **no debe construirse** en Fullsite. La estrategia offline
   correcta es: el POS registra la *intención* localmente, la terminal cobra por su propia red, y el
   POS concilia por webhook + polling cuando vuelve la WAN.

---

## 1. Marco: los tres modelos de integración

| Modelo | Quién captura la tarjeta | Quién manda el monto | PCI para el POS | Ejemplo MX |
|---|---|---|---|---|
| **Standalone** (lo que usa AMALAY hoy) | Terminal bancaria | El mesero lo teclea a mano | Fuera de alcance, pero cero conciliación | Terminal Banorte/BBVA de AMALAY |
| **Semi-integrado** | Terminal certificada EMV/PCI PTS | El POS, por API (cloud o LAN) | POS nunca ve PAN → alcance mínimo | MP Point PDV, Clip PinPad, NetPay Smart, Getnet API, Clover Connector |
| **Totalmente integrado** | Lector "tonto" controlado por SDK del POS | El POS | El POS entra en alcance PCI (o depende de P2PE del proveedor) | Stripe Terminal SDK (mobile readers), Square Reader SDK |

**[RECOMENDACIÓN]** Fullsite sólo debe operar en la fila del medio. La primera fila es el status quo
que se reemplaza; la tercera mete a Fullsite en alcance PCI y en certificación EMV, que es
exactamente lo que no se quiere.

Dentro del semi-integrado hay dos sub-variantes que importan para offline:

- **Cloud terminal API** — el POS llama a la nube del proveedor, la nube empuja el cobro a la terminal
  (MP Orders, Clip PinPad, NetPay Smart, Adyen "cloud", Stripe server-driven). Requiere WAN en el POS
  **y** en la terminal.
- **Local/LAN terminal API** — el POS habla directo con la terminal por IP (Adyen "local
  communications", Clover Connector/REST Pay Display en LAN, Stripe "local network"). El POS sólo
  necesita LAN; la terminal necesita WAN para autorizar. **Ningún proveedor mexicano revisado documenta
  modo LAN** **[HECHO: MP, Clip, NetPay son cloud-only según sus docs; Clover Connector LATAM lo
  ofrece en SDK pero MX exige contrato ISV]**.

---

## 2. Tabla panorámica por proveedor

Leyenda: ✔ documentado · ✘ documentado que no · — no publicado · ? contradictorio.

| Proveedor | Disponible MX | Modelo | Pre-auth | Propina en terminal | Offline (terminal) | Reembolso por API | Webhooks | Programa ISV / rev-share | Tarifa publicada MX | Docs |
|---|---|---|---|---|---|---|---|---|---|---|
| **Mercado Pago Point** | ✔ Point Smart 1/2 | Cloud (Orders API, modo PDV) | ✘ | ✔ (Point Smart 2, standalone); en PDV — | ✔ modo offline (Point Smart) | ✔ total/parcial ≤90 días | ✔ | — ("Apps para plataformas" existe, sin rev-share público) | 3.5 % + IVA al instante; Banxico prom. 3.39 % | mercadopago.com.mx/developers/es/docs/mp-point/landing |
| **Clip** | ✔ | Cloud (PinPad API) | ✘ | ✔ `tip_amount` + `preferences` de propina | — | — (sólo DELETE de intento pendiente) | ✔ `PINPAD_INTENT_STATUS_CHANGED` | Fiserv ISV page (US); MX — | 3.6 % + IVA; Banxico prom. 3.50 %, mín. 1.80 % | developer.clip.mx/reference/post_payment-1 |
| **NetPay** (Monterrey, FEMSA Spin) | ✔ | Cloud (Smart API REST + callback) | ? (`checkIn` flag sin documentar) | ✔ campo `tip` | — | ✘ (cancelación sólo mismo día) | ✔ callback REST | — | — ; Banxico Adq prom. 2.19 % cr / 2.00 % db | docs.netpay.mx/terminales/smart-api/api-reference/ |
| **Getnet** (Santander) | ✔ | Cloud API→terminal, app en terminal, QR, web | — | — | — | — | Por contrato | "desde 0.70 %" (distribuidor, no oficial); Banxico prom. 2.26 % cr / 1.79 % db | gsmart.com.mx/i/devinfo.jsp |
| **Clover / Fiserv** | ✔ Flex 3 / Mini 3 desde ene-2025 | Clover Connector SDK (Android/iOS/JS/.NET); "External integration" única opción MX 2024 | — (US sí) | ✔ modos cashier/restaurant/tablepay | — | — | Kit dev sólo con contrato ISV | Banxico prom. 2.50 % cr / 2.11 % db | docs.apis-fiserv.com/latam/docs/card-present-clover |
| **Stripe Terminal** | ? *Public preview*; soporte dice S710 (Wi-Fi) + WisePad 3 + Tap to Pay; tabla de disponibilidad dice "MX*: only Tap to Pay" | Cloud + SDK | ✔ extended auth (no incremental) | ✔ smart readers | ✔ store-and-forward smart readers (país no listado para MX) | ✔ | ✔ | Connect: 0.25 % rev-share cuando la plataforma controla precio | 3.6 % + $3.00 MXN; TTP $2/auth; P2PE $0.90/auth; S710 $5,199; WisePad 3 $899 | support.stripe.com/questions/terminal-in-mexico |
| **Adyen** | ✔ reporta tasas Restaurantes a Banxico (2.16 % cr) | Terminal API cloud **y** local | ✔ pre-auth + adjust | ✔ POS o terminal | ✔ store-and-forward | ✔ | ✔ | ✔ Adyen for Platforms con in-person | US$0.13 + IC++ 0.60 % (indicativo); MX sólo OXXO listado | docs.adyen.com/point-of-sale/ |
| **Openpay / BBVA** | ✔ TPV | Standalone; SmartPOS "prevé" propinas/split (prensa) | — | anunciado | — | — | — | — | primer aparato sin costo, sin renta, T+1; % no publicado; Banxico BBVA 2.33 % cr / 1.65 % db | bbva.mx/empresas/landings/tpv---openpay.html |
| **Zettle (PayPal)** | ✔ lector $199 | Standalone / app | — | — | — | — | — | — | 3.5 % + IVA | zettle.com/mx/lector-de-tarjetas |
| **Conekta** | ✔ online | Sin terminal propia (KiWi/efectivo) | n/a | n/a | n/a | ✔ online | ✔ | — | Banxico 3.40 % | conekta.com |
| **FreedomPay** | ✔ desde mar-2022 (prensa) | Gateway multi-adquirente (600+ POS) | ✔ (gateway) | ✔ | — | ✔ | ✔ | Enterprise | — | corporate.freedompay.com |
| **Square** | ✘ no opera en MX (confirmado antes) | Referencia arquitectónica | ✔ | ✔ | ✔ 72 h, tope configurable $1–$50,000 | ✔ | ✔ | n/a | n/a | squareup.com/help/us/en/article/7777 |
| **CoDi / DiMo (Banxico)** | ✔ | QR / número celular, SPEI | ✘ | ✘ | ✘ | manual | por banco | n/a | **$0 por transacción** para el comercio | banxico.org.mx |

Fuentes por fila en §3 y §11.

---

## 3. Fichas por proveedor (lo que importa para Fullsite)

### 3.1 Mercado Pago Point — el candidato #1 por base instalada

- **Dispositivos integrables:** Point Smart 1 y Point Smart 2 **[HECHO]**
  (https://www.mercadopago.com.mx/developers/es/docs/mp-point/landing; confirmado por Odoo:
  "Odoo no es compatible con el modo de operación STANDALONE", disponibles en AR/BR/MX,
  https://www.odoo.com/documentation/17.0/es_419/applications/sales/point_of_sale/payment_methods/terminals/mercado_pago.html).
- **API vigente:** *Orders API* — `POST /v1/orders` (type point, `config.point.terminal_id`),
  `GET /v1/orders/{id}`, `POST /v1/orders/{id}/cancel` (sólo `status=created`),
  `POST /v1/orders/{id}/refund` (total o parcial, ≤ 90 días), `GET /terminals/v1/list`.
  Header `X-Idempotency-Key`. Expiración de la orden: mín 30 s, máx 3 h, default 15 min.
  `external_reference` ≤ 64 chars, sin PII **[HECHO]**
  (https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing).
- **El endpoint legado `POST /point/integration-api/devices/{id}/payment-intents`** que menciona el
  brief: las páginas de referencia devolvieron 404 en este sprint. **[INFERENCIA]** MP migró la
  documentación pública a Orders API; el legado puede seguir vivo pero ya no es el camino documentado.
  Verificar en el portal con credenciales de developer antes de codificar.
- **Terminal:** Point Smart 2 lista $4,499 MXN (promo $499), **chip 4G e internet gratis**, Wi-Fi 5.8 GHz,
  impresora integrada **[HECHO]** (https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point/point-smart).
- **Tarifa:** "3.5 % + IVA" débito y crédito al instante en la página del producto **[HECHO]**;
  Banxico jul-2026 Restaurantes: promedio 3.39 %, mínima 1.79 %, máxima 3.50 % **[HECHO]**. La mínima de
  1.79 % prueba que MP **sí negocia** tasas por debajo de lista con algunos comercios **[INFERENCIA]**.
- **Propina:** Point Smart 2 muestra la opción al cliente al finalizar el cobro (blog MP,
  https://www.mercadopago.com.mx/blog/configurar-propinas-terminal-point — el fetch dio 403; dato del
  snippet). Si la propina funciona en **modo PDV** con orden creada por API: **[NO PUBLICADO]**.
- **Offline:** existe "modo sin conexión" en Point Smart; almacena y sincroniza al reconectar
  (https://www.mercadopago.com.mx/blog/cobrar-sin-conexion-modo-offline-terminal-point, 403 al fetch).
  Límites de monto/tiempo y quién asume el rechazo: **[NO PUBLICADO]**. Si opera en modo PDV
  (orden empujada desde la nube) es dudoso que el modo offline aplique: **[INFERENCIA]** el modo offline
  es de la app standalone.
- **Pre-auth:** ninguna en Orders/Point. La nota interna del 2026-08-28 lo verificó: "MP Point cobra de
  inmediato" (`docs/strategy/BIBLE-SQUARE.md:159`) **[HECHO interno]**.
- **Rev-share:** "Apps para plataformas" existe en el portal; términos económicos **[NO PUBLICADO]**.

### 3.2 Clip — el candidato #2, y el dueño de Wansoft

- **Dos APIs distintas, no confundir:**
  1. *API de Punto de Venta* — crea un cobro "pendiente" que el cajero selecciona en la app Clip del
     lector (Clip Plus/Pro/Total); requiere habilitar "transacciones pendientes" escribiendo a
     developers@clip.mx **[HECHO]** (https://developer.clip.mx/docs/api-de-punto-de-venta).
  2. *API de PinPad* — el backend despierta el lector y le manda el cobro:
     `POST https://api.payclip.io/f2f/pinpad/v1/payment` con `amount`, `reference`,
     `serial_number_pos`, opcionales `tip_amount`, `webhook_url`, `preferences` (opciones de
     propina, MSI, auto-print, split). Sólo **Clip Total 3, Ultra, PinPad y Stand 2**; requiere APK
     PinPad instalado vía sdk@payclip.com, KYC, Wi-Fi ≥ 10 Mbps, **sólo ambiente producción** (no hay
     sandbox) **[HECHO]** (https://developer.clip.mx/reference/post_payment-1.md,
     https://developer.clip.mx/reference/introducción-a-la-api-de-pinpad.md).
- **Consulta:** `GET /f2f/pinpad/v1/payment?pinpadRequestId=` → estados `COMPLETED | PENDING | FAILED`,
  `tip_amount`, `bin`, `last_digits`, `issuer`; **no** devuelve código de autorización **[HECHO]**
  (https://developer.clip.mx/reference/get_payment.md).
- **Webhook:** un evento, `PINPAD_INTENT_STATUS_CHANGED`, con `id`, `origin`, `event_type`; luego hay
  que consultar el pago. Firma y reintentos **[NO PUBLICADO]** (https://developer.clip.mx/reference/webhook.md).
- **Reembolsos por API, offline, pre-auth:** **[NO PUBLICADO]** en el índice `llms.txt`; DELETE sólo
  cancela intentos pendientes. La nota interna confirma "Clip PinPad API no tiene auth/capture".
- **Tarifa:** 3.6 % + IVA lista **[HECHO, blog Clip vía búsqueda]**; Banxico: promedio 3.50 %, mínima
  **1.80 %** **[HECHO]**. Igual que MP: negocian.
- **ISV:** existe una landing "CLIP | ISV Partner" en Fiserv (https://isvpartner.fiserv.com/signup/clip)
  — es el programa de Fiserv **en EE. UU.** con Clip como software, no un programa de Clip México
  **[INFERENCIA]**. Programa ISV de Clip MX: **[NO PUBLICADO]**.
- **Riesgo estratégico:** Clip es dueño de Wansoft (memoria del proyecto). Integrarse con Clip es
  técnicamente lo más fácil y comercialmente lo más delicado **[INFERENCIA]**.

### 3.3 NetPay — el adquirente de Monterrey

- **Smart API:** REST cloud, no LAN. `POST https://suite.netpay.com.mx/netpay-integration-service/transactions/sale`
  (sandbox `http://nubeqa.netpay.com.mx:3334`). Campos: `serialNumber`, `amount`, `storeId`,
  `traceability` (obligatorios); `tip`, `tableId`, `waitressid`, `folioNumber`, `msi`,
  `settlementId` (corte 1-4), `settlementDate`, `checkIn`, `pendingAmount`, `exchangeRateUsd`
  (opcionales). Cancelación **sólo mismo día**; reimpresión; la respuesta llega a un endpoint REST del
  comercio ("local o por internet") **[HECHO]** (https://docs.netpay.mx/terminales/smart-api/api-reference/,
  https://docs.netpay.mx/terminales/smart-api/solicitud-venta/).
- **Los campos `tableId`, `waitressid`, `tip`, `settlementId` son de restaurante.** Es la única API
  mexicana revisada que modela mesa, mesero, propina y corte en el propio request **[HECHO]**. El flag
  `checkIn` sugiere un flujo hotelero de pre-autorización, pero no está documentado: **[NO PUBLICADO]**.
- **Tarifas:** Banxico jul-2026 Restaurantes: *NetPay Adq* 2.19 % cr / 2.00 % db (mín. 1.90 / 1.15);
  *NetPay* (agregador) 2.94 % / 2.89 % **[HECHO]**. Lista pública: **[NO PUBLICADO]**.
- **Programa de socios:** **[NO PUBLICADO]** (netpay.mx no lo lista; el portal de concesionarios
  ayudacomex.netpay.mx tiene una sección "Developers (Integraciones de productos NetPay)").
- **Contexto:** parte de Spin (FEMSA); soporte con lada 81 **[HECHO]** (https://netpay.mx/).

### 3.4 Getnet (Santander)

- Cuatro modos: app del comercio en la terminal, web en la terminal, QR y **API cloud→terminal** ("la
  más flexible… cualquier app celular, web o IoT envía una petición de cobro a la terminal"). Config
  por giro (retail/restaurante/hotel), marcas, MSI, webhook **[HECHO]** (https://www.gsmart.com.mx/i/devinfo.jsp).
- Tarifas: "desde 0.70 % + IVA" es claim de distribuidor (tpv.procontacto.com), **no** de Getnet;
  Banxico: 2.26 % cr / 1.79 % db promedio, mínimas 1.76 / 1.15 **[HECHO]**.
- El portal `docs.globalgetnet.com` es la API regional de e-commerce (SEP), no la de terminal
  **[INFERENCIA]**.

### 3.5 Clover / Fiserv

- Flex 3 y Mini 3 disponibles en México desde enero 2025; **kit de desarrollo sólo con relación
  contractual (ISV o cliente directo)**; en 2024 "External integration" era la única opción en MX;
  Clover Connector SDK para AR/BR/MX en Android/iOS/JS/.NET; modos cashier/restaurant/tablepay con
  propina **[HECHO]** (https://docs.apis-fiserv.com/latam/docs/card-present-clover-devices,
  https://docs.apis-fiserv.com/latam/docs/card-present-clover).
- Banxico: Fiserv 2.50 % cr / 2.11 % db **[HECHO]**.

### 3.6 Stripe Terminal — contradicción documentada

- Soporte: "available in public preview to users in Mexico"; lectores **Stripe Reader S710 (sólo
  Wi-Fi, sin celular en MX)**, **BBPOS WisePad 3**, Tap to Pay iPhone/Android; Visa/MC/Amex/Carnet; sin
  OXXO ni MSI presencial **[HECHO]** (https://support.stripe.com/questions/terminal-in-mexico).
- Tabla de disponibilidad: MX aparece en "Preview" con asterisco = "only Tap to Pay is available"
  **[HECHO]** (https://docs.stripe.com/terminal/payments/collect-card-payment/supported-card-brands).
  **Contradicción entre las dos páginas de Stripe.** Precios MX listan S710 a $5,199 y WisePad 3 a $899
  (https://stripe.com/mx/pricing), lo que apoya la versión de soporte **[INFERENCIA]**.
- Tarifa MX: 3.6 % + $3.00 MXN (nacional), +0.5 % internacional; Tap to Pay $2/autorización; P2PE
  $0.90/autorización **[HECHO]**. Banxico Stripe Restaurantes: 3.59 % promedio, mín 1.80 % **[HECHO]**.
- Offline: smart readers guardan y reenvían; propina y *extended authorizations* en smart readers;
  *incremental* no **[HECHO]** (https://docs.stripe.com/terminal/features/operate-offline/overview).
  Aplicabilidad a MX: **[NO PUBLICADO]**.
- Connect: si la plataforma controla precios, 0.25 % por transacción + $35 MXN/cuenta activa/mes +
  0.25 % + $12 por transferencia **[HECHO]** (https://stripe.com/connect/pricing).

### 3.7 Adyen

- Terminal API cloud **y** local, store-and-forward, pre-auth y ajuste, propina desde POS o terminal,
  Adyen for Platforms con in-person **[HECHO]** (https://docs.adyen.com/point-of-sale/,
  https://docs.adyen.com/platforms/). Precio indicativo US$0.13 + IC++ 0.60 %; "minimum invoice" no
  publicado **[HECHO]** (https://www.adyen.com/pricing).
- Banxico lo lista con tasas para Restaurantes (2.16 % cr) → adquiere presencial en MX **[INFERENCIA
  fuerte]**. Ticket enterprise; no es vía para 1–50 restaurantes **[INFERENCIA]**.

### 3.8 Rieles y alternativas

- **Prosa y E-Global** son las cámaras/switches propiedad de bancos ("Red MX"); hay 13+ adquirentes
  no bancarios registrados (Getnet, EVO, Fiserv, Zettle, Billpocket, Openpay, NetPay, Adyen, Clip,
  Konfío, Efevoo, Hey Pago…) **[HECHO, prensa axisnegocios + Santander]**.
- **CoDi/DiMo:** $0 de comisión para el comercio; adopción baja (21.8 M cuentas validadas, 17.8 M
  operaciones acumuladas a sep-2025); Banxico los está fusionando y creó cuentas Nivel 2 Bis para
  micro-comercio (2026) **[HECHO, prensa El Financiero / Cronista]**. Como *checkout* de restaurante
  es un botón secundario "Transferencia/QR", no el rail principal **[RECOMENDACIÓN]**.

---

## 4. Temas transversales

| Tema | Estado en México (proveedores revisados) | Nota |
|---|---|---|
| **Payment intent + idempotencia** | MP: `X-Idempotency-Key` en Orders. Clip: `reference` propio. NetPay: `traceability`. | Square: clave única, replay devuelve la respuesta original, misma clave con otros params = error (https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency) — patrón a copiar. |
| **Webhooks** | MP ✔ · Clip ✔ (1 evento, luego GET) · NetPay ✔ (callback a REST del comercio) | Ninguno documenta firma HMAC ni política de reintentos → **el POS debe hacer polling de respaldo** [RECOMENDACIÓN]. |
| **Propina** | Clip `tip_amount` + prefs · NetPay `tip` · MP en Point Smart 2 standalone (PDV: no publicado) · Clover modos · Stripe smart readers | El flujo mexicano (cliente elige % en la terminal después del monto) sólo está garantizado por API en Clip; en NetPay la propina la manda el POS. |
| **Reembolso parcial** | MP ✔ ≤ 90 días · NetPay ✘ (sólo cancelación mismo día) · Clip — | Reembolso ≠ cancelación: distinguir en el modelo de datos. |
| **Split tender** | Lo hace el POS (ya existe `mixtoPagos` en Fullsite, cert. OCS P2.5.8) | Clip menciona "split payments" en prefs (varias tarjetas en un intento). |
| **Pre-auth / tabs** | ✘ MP, ✘ Clip, ? NetPay (`checkIn`), ✔ Stripe (extended, no incremental), ✔ Adyen | Camino viable ya documentado internamente: token + auth-only e-commerce con captura ≤ auth (BIBLE-SQUARE §3.5). |
| **Liquidación** | MP "al instante" (con tarifa mayor por plazo) · Openpay/BBVA T+1 · Zettle/Clip — | La liquidación instantánea de MP es un argumento de venta real para el restaurantero. |
| **Contracargos** | Visa 10.1 (EMV counterfeit) 120 días; liability shift EMV aplica en MX por reglas de marca | Con EMV chip/NFC en terminal certificada, el fraude counterfeit recae en el emisor. Blog HG Pay cita a CyberSource: MX 1.9 % de contracargos (dato de e-commerce, no presencial) [INFERENCIA]. |
| **Certificación EMV L1/L2/L3** | La lleva el fabricante (L1/L2) y el adquirente (L3) | En semi-integración, Fullsite **no** certifica nada [HECHO por construcción del modelo]. |
| **Fleet / config remota** | MP: `GET /terminals/v1/list` + modo PDV · Clip: `get_f2f-pinpad-v1-devices-status` · NetPay: `serialNumber` + `storeId` | Ningún proveedor MX expone config remota de propina/MSI por API salvo Clip `preferences`. |

---

## 5. Economía (sólo números públicos)

### 5.1 Lo que cobra el mercado mexicano (Banxico, giro Restaurantes, julio 2026)

Fuente: https://www.banxico.org.mx/servicios/tasas-de-descuento-para-tarjetas-de-credito-por-gi/%7B178DFF29-DA8F-E376-78AC-9B52D36C799F%7D.pdf
y el PDF de débito equivalente (extraídos con `pdftotext` en este sprint) **[HECHO]**.

| Institución | Crédito prom. | Crédito mín. | Débito prom. | Débito mín. |
|---|---|---|---|---|
| Adyen | 2.16 % | 1.95 % | 2.12 % | 1.75 % |
| NetPay Adquirente | 2.19 % | 1.90 % | 2.00 % | 1.15 % |
| Banorte | 2.23 % | 1.76 % | 1.85 % | 1.15 % |
| Getnet | 2.26 % | 1.76 % | 1.79 % | 1.15 % |
| BBVA | 2.33 % | 1.76 % | 1.65 % | 1.15 % |
| Fiserv | 2.50 % | 1.78 % | 2.11 % | 1.20 % |
| NetPay (agregador) | 2.94 % | 1.78 % | 2.89 % | 1.15 % |
| Mercado Pago | 3.39 % | 1.79 % | 3.39 % | 1.25 % |
| Conekta | 3.40 % | 2.00 % | 3.40 % | 2.00 % |
| Clip | 3.50 % | 1.80 % | 3.49 % | 1.20 % |
| Stripe | 3.59 % | 1.80 % | 3.59 % | 1.80 % |

### 5.2 Intercambio regulado

- Crédito, giro Restaurantes: **1.76 %** (vigente 1-may a 31-oct 2026) **[HECHO]**
  (https://www.banxico.org.mx/servicios/cuotas-de-intercambio-por-el-uso-de-tarjetas-de-cr/%7BF24763DD-FBD3-19EC-E6EA-1156F62361DA%7D.pdf).
- Débito, Restaurantes: **1.15 %**, tope **$13.50 por operación** **[HECHO]**
  (https://www.banxico.org.mx/servicios/cuotas-de-intercambio-por-el-uso-de-tarjetas-de-de/%7B0556AA29-5FA6-5316-8053-04059529A510%7D.pdf; el PDF dice "último registro 16-may-2019" — el tope en pesos se indexa anualmente; verificar vigencia).
- **Lectura:** un restaurante con Clip a 3.6 % paga ~184 bps sobre intercambio en crédito; con un
  adquirente bancario a 2.2 % paga ~44 bps. **[INFERENCIA]** Para un ticket promedio de AMALAY, el
  ahorro de mover volumen de terminal de agregador a adquirente negociado es del orden de 1.0–1.4 pts
  de venta con tarjeta; ésa es la palanca comercial de Fullsite.

### 5.3 Comparables públicos (10-K / resultados)

| Empresa | Métrica | Valor | Fuente |
|---|---|---|---|
| Toast | Ingresos FY2025 | US$6,153 M (+24 %) | 10-K FY2025 https://www.sec.gov/Archives/edgar/data/1650164/000165016426000057/tost-20251231.htm |
| Toast | GPV TTM | ~US$195 B; FY $51.4 B Q4 | ídem / BusinessWire 2026-02-12 |
| Toast | Fintech net take rate / payments take rate | **58 bps / 48 bps** | BusinessWire Q4-2025 |
| Toast | Ubicaciones | ~164,000 | ídem |
| Toast | Modelo | "relies on third-party payment processors… pay fees to such financial institutions" | 10-K, factores de riesgo |
| Shift4 | Blended spread FY2025 | **60.5 bps** (Q4: 57 bps); 550+ integraciones; rev-share a ISV | 10-K https://www.sec.gov/Archives/edgar/data/1794669/000179466926000010/four-20251231.htm |
| Block/Square | Square GPV FY2025 | US$250 B, 4.5 M sellers | 10-K https://www.sec.gov/Archives/edgar/data/1512673/000162828026012254/xyz-20251231.htm (take rate ya no se desglosa) |
| Lightspeed | GPV / GTV (attach) FY2026 | 41–43 % por trimestre | lightspeedhq.com/news (Q1–Q4 FY2026) |
| Stripe Connect | Rev-share plataforma | 0.25 % por transacción cuando la plataforma fija precio | https://stripe.com/connect/pricing |
| Adyen for Platforms | Comisión de plataforma | Split configurable; "Commission and Markup" se descuentan del balance de la plataforma | https://docs.adyen.com/platforms/online-payments/transaction-fees |
| Clover/Fiserv | Referral | "% del net acquiring revenue"; bps negociados | referrals.clover.com |

**[INFERENCIA]** Un ISV mexicano que lleve volumen a un adquirente puede aspirar a 20–40 bps de
*rev-share* — no hay cifra pública para MX; el rango sale de que Toast/Shift4 retienen 48–60 bps
**siendo** el comercializador del servicio completo. Tratar como hipótesis a validar en la primera
negociación.

---

## 6. La pregunta principal: controlar la UX y ganar economía **sin** ser procesador

| Opción | Qué es | Pro | Contra | Veredicto |
|---|---|---|---|---|
| **BUILD** (ser agregador/adquirente) | Registro ante Banxico/CNBV como agregador, contrato con Prosa/E-Global, riesgo de contracargos propio | Take rate completo | Capital, licencia, riesgo de crédito, PCI nivel 1, equipo de riesgo; incompatible con §20 de prioridades | **No, no ahora.** Revisar a 300+ restaurantes. |
| **BUY** (comprar volumen a tarifa mayorista y revender) | Fullsite es el comercio ante el adquirente y sub-afilia restaurantes | Control de tarifa | Es *ser agregador* con otro nombre; mismas obligaciones | No. |
| **PARTNER — semi-integración + referido** | Fullsite integra la API de terminal del proveedor; el restaurante contrata al proveedor; Fullsite cobra rev-share/referido | Cero PCI, cero capital, se puede empezar con un proveedor y sumar otros | Rev-share no publicado en MX; hay que negociarlo; dependencia de docs frágiles (404s) | **Sí. Ruta principal.** |
| **PARTNER — plataforma (Stripe Connect / Adyen for Platforms)** | Fullsite onboardea sub-comercios y fija precio | Rev-share **publicado** (Stripe 0.25 %), control total de UX y precio | Stripe Terminal MX en preview y contradictorio; Adyen es enterprise; ambos a 3.6 % de lista quedan fuera de mercado vs. bancos | Plan B para 2027 si Stripe Terminal sale de preview con S710 celular. |
| **WHITE-LABEL** (terminal marca Fullsite sobre adquirente) | NetPay/Getnet ponen el riel, Fullsite la marca y la app | UX 100 % propia, tarifa negociada | Contrato de exclusividad probable; volumen mínimo; soporte de hardware | Fase 2, después de 20–30 restaurantes integrados con la ruta PARTNER. |

**[RECOMENDACIÓN] Ruta concreta:**

1. **Abstraer un `PaymentTerminalProvider`** en el POS con cuatro operaciones: `createIntent`,
   `getStatus`, `cancelIntent`, `refund` (+ `capabilities`: tip, msi, partialRefund, offline, preauth).
   El checkout de Fullsite es el mismo con cualquier terminal; sólo cambia el adaptador. Esto es lo
   que Odoo y Shift4 hacen — la UX se controla en el POS, no en la terminal.
2. **Adaptador #1: Mercado Pago Orders (modo PDV).** Mayor base instalada, terminal con 4G incluido,
   reembolso parcial por API, idempotencia nativa, docs de terceros (Odoo) que prueban que funciona en
   MX. Mejor "demo que cierra ventas".
3. **Adaptador #2: NetPay Smart API.** Es Monterrey, es adquirente (2.19 % vs 3.39 %), modela mesa/
   mesero/propina/corte en el request. **Éste es el socio con el que negociar rev-share y el que resuelve
   el precio del restaurantero.** Sandbox público.
4. **Adaptador #3: Clip PinPad** sólo si un cliente lo exige; sin sandbox, sólo producción, y es el
   dueño de Wansoft.
5. **No integrar Stripe Terminal ni Adyen todavía**; re-evaluar cuando Stripe saque MX de preview
   con S710 celular o cuando haya un cliente de 20+ sucursales que justifique Adyen.
6. **Botón "Transferencia/QR (CoDi-DiMo/SPEI)"** como método manual con conciliación, no como
   integración.

---

## 7. Arquitectura recomendada para un POS offline-first

**[RECOMENDACIÓN]** Principio: *el POS es la fuente de verdad de la intención; la terminal es la fuente
de verdad del dinero; el servidor local concilia.*

```
POS (Electron, LAN)            Edge server (LAN)              Nube proveedor        Terminal (SIM 4G / Wi-Fi)
   |-- 1. crea PaymentIntent local (uuid = idempotency key, monto, propina sugerida, mesa, mesero) -->
   |                                 |-- 2. si hay WAN: POST /orders (X-Idempotency-Key=uuid) ------->|
   |                                 |                                                                |-- 3. push a terminal -->|
   |                                 |                                                                |<-- 4. cliente paga -----|
   |                                 |<-- 5a. webhook (a edge o a nube Fullsite) ---------------------|
   |                                 |-- 5b. polling GET /orders/{id} cada 3 s hasta terminal --------|
   |<-- 6. estado FINISHED/CANCELED/EXPIRED; cierra cuenta; imprime ---|
```

Reglas:

1. **Idempotencia desde el POS.** El `uuid` del intento local es la `X-Idempotency-Key` (MP), el
   `reference` (Clip) o el `traceability` (NetPay). Reintentar nunca crea dos cobros. Patrón Square:
   misma clave → misma respuesta; misma clave con parámetros distintos → error.
2. **Webhook + polling siempre.** Ninguno de los tres proveedores MX documenta firma ni reintentos
   del webhook; el polling es el mecanismo primario y el webhook acelera. El webhook llega a la nube
   de Fullsite (Vercel) y se reenvía al edge por el canal ya existente; si el edge no tiene WAN, el
   polling tampoco funciona — por eso el paso 3.
3. **Expiración explícita.** MP permite 30 s–3 h (default 15 min). Fijar 5 min para restaurante; al
   expirar, el POS marca `EXPIRED` y ofrece reintentar o cobrar standalone.
4. **WAN caída en el POS/edge, terminal con SIM:** el POS guarda el intento en `pos-offline-db` con
   estado `PENDING_WAN`; el mesero cobra en la terminal en **modo standalone** tecleando el monto que
   el POS le muestra en grande; captura los últimos 4 dígitos/folio de la terminal en el POS
   (Fullsite ya tiene este flujo manual). Al volver la WAN, un *job* de conciliación busca en el
   proveedor (`GET /orders` por `external_reference`, o lista de transacciones del día) y empata por
   monto + hora ± 2 min + últimos 4 dígitos; lo que no empata queda en "por conciliar" en el corte.
   **No** se reintenta el push cloud de un intento que ya se cobró standalone.
5. **WAN caída en la terminal (sin SIM):** no hay cobro con tarjeta, punto. Las terminales
   recomendadas traen SIM (Point Smart 2: "chip 4G e internet gratis"; Clip Pro 2/Ultra: 4G).
   La Stripe S710 **no** tiene celular en MX — otra razón para no elegirla hoy.
6. **Store-and-forward del lado del POS: no construir.** Quien lo ofrece (Square, Stripe smart
   readers, Adyen) lo hace **dentro del hardware certificado** y transfiere el riesgo al comercio
   (Square: 72 h, expira sin recurso, tope configurable, "you're responsible for any expired, declined,
   or disputed payments"). Fullsite no tiene el hardware ni debe asumir el riesgo.
7. **Propina.** Dos flujos según proveedor: (a) *terminal pide propina* (Clip `preferences`, MP Smart
   standalone, Clover restaurant mode) → el POS recibe `tip_amount` y lo separa como ya hace
   `pos-arqueo.ts` (propinaTarjeta); (b) *POS manda propina* (NetPay `tip`) → el POS la pregunta en
   pantalla del cliente antes de enviar. `capabilities.tipOnTerminal` decide cuál.
8. **Reembolsos:** operación de gerente con PIN, sólo contra un pago con `provider_payment_id`;
   parcial sólo si `capabilities.partialRefund` (MP sí, NetPay no).
9. **Tabs/pre-auth:** no bloquear en la terminal; usar el diseño ya documentado (token + auth-only
   e-commerce, captura ≤ auth) cuando se construya `bar_cantina`.
10. **Conciliación en el corte:** el arqueo ya separa propina por método; agregar una vista "pagos
    con terminal" que cruce `pos_orders.pagos[]` con el ledger del proveedor y muestre diferencias.
    Este cruce es el argumento de venta #1 frente al standalone actual (cero errores de dedo).

---

## 8. Conclusión PCI

- **Semi-integrado con terminal certificada PCI PTS + EMV:** el POS de Fullsite nunca recibe PAN,
  track ni CVV; recibe `bin`, `last_digits`, `issuer` (Clip) o equivalentes — datos que **no** son
  cardholder data sensible bajo PCI DSS **[HECHO por definición de PCI DSS; los campos son los que
  documenta Clip]**.
- El cuestionario aplicable al **comercio** típicamente es **SAQ B-IP** (terminales IP standalone /
  semi-integradas sin almacenamiento electrónico) o **SAQ P2PE** si el proveedor tiene solución P2PE
  listada; Stripe vende P2PE como opción de pago ($0.90/autorización en MX) **[HECHO Stripe; la
  asignación de SAQ es INFERENCIA — la decide el adquirente]**.
- **Fullsite como proveedor de software:** al no tocar, transmitir ni almacenar PAN, **no** requiere
  PA-DSS/SSF ni PCI DSS propio por el módulo de pagos. Lo que sí queda en alcance de Fullsite es (a)
  proteger las credenciales API del proveedor (tokens Bearer/Basic) en el edge, (b) no registrar
  payloads completos en logs, (c) el `webhook` público con validación de origen. La política interna
  `docs/security/policies/pci-dss-saq-a.md` cubre e-commerce; hay que añadir un anexo "terminal
  semi-integrada" **[RECOMENDACIÓN]**.
- **EMV L1/L2/L3:** L1/L2 las certifica el fabricante del hardware (Newland N950 en MP, PAX/Sunmi en
  Clip/NetPay); L3 la certifica el adquirente con la marca. Fullsite no certifica nada mientras no
  controle el kernel del lector **[HECHO por construcción; fabricantes: INFERENCIA]**.
- **Lo que rompería esto:** integrar Stripe Terminal *mobile readers* (WisePad 3 por Bluetooth con SDK
  en el POS) o cualquier lector "tonto" — el SDK corre en el Electron y Fullsite entra en el flujo de
  datos de tarjeta. No hacerlo.

---

## 9. Contradicciones y huecos encontrados

| # | Contradicción / hueco | Fuentes | Cómo tratarla |
|---|---|---|---|
| 1 | Stripe: soporte dice S710 + WisePad 3 en MX; tabla de disponibilidad dice "MX*: only Tap to Pay" | support.stripe.com/questions/terminal-in-mexico vs docs.stripe.com/terminal/payments/collect-card-payment/supported-card-brands | Preview = puede cambiar semana a semana. No planear sobre Stripe hasta GA. |
| 2 | MP: el brief cita `POST /point/integration-api/devices/{id}/payment-intents`; los docs vigentes describen `POST /v1/orders` y la referencia del endpoint legado dio 404 | mercadopago.com.mx/developers/es/docs/mp-point/payment-processing | Codificar contra Orders; confirmar en portal con cuenta developer. |
| 3 | Getnet "desde 0.70 %" (distribuidor) vs Banxico promedio 2.26 % / mínima 1.76 % | tpv.procontacto.com vs Banxico | 0.70 % es marketing de giro específico (médicos/tlapalerías); usar Banxico. |
| 4 | Clip lista 3.6 % pero Banxico registra mínima 1.80 % | blog.clip.mx vs Banxico | Clip negocia; la lista no es el techo real. Igual MP (mín 1.79 %). |
| 5 | Banxico débito: el PDF de intercambio dice "último registro 2019" mientras el de crédito está vigente may–oct 2026 | Banxico | El tope $13.50 se indexa; verificar el PDF vigente antes de citar el peso exacto. |
| 6 | MP "modo offline" existe en Point Smart pero no se sabe si aplica en modo PDV | blog MP (403 al fetch) | Preguntar a MP developers o probar con terminal en mano. |
| 7 | NetPay `checkIn` parece pre-auth hotelera pero no está documentado | docs.netpay.mx api-reference | Preguntar a integraciones@netpay.com.mx. |
| 8 | Contracargo MX 1.9 % (CyberSource vía blog HG Pay) es dato de no presencial | hgpay.com.mx | No usar para presencial EMV. |
| 9 | Programas ISV/rev-share en MX: ninguno publicado (MP, Clip, NetPay, Getnet, Clover) | — | Es el dato que sólo sale negociando; llevar a la reunión los números de Toast/Shift4. |

---

## 10. Qué NO construir

1. **Adquirencia/agregación propia** (BUILD). Ni licencia, ni contrato Prosa/E-Global, ni riesgo de
   contracargos. Revisar a 300+ restaurantes.
2. **Store-and-forward de tarjeta en el POS/edge.** El riesgo es del comercio y el hardware certificado
   es del proveedor; Fullsite sólo guarda *intenciones* y concilia.
3. **SDK de lector móvil dentro del Electron** (WisePad 3 / Reader SDK): mete a Fullsite en alcance
   PCI.
4. **Terminal-driven pre-auth para tabs**: no existe en MX; usar el diseño auth-only e-commerce ya
   documentado.
5. **Un checkout distinto por proveedor.** Un solo `PaymentTerminalProvider`; la terminal es un
   adaptador.
6. **Integración CoDi/DiMo con API bancaria.** Botón manual con conciliación; la adopción no justifica
   más.
7. **Elegir proveedor por la API más bonita.** El criterio es tarifa negociada + SIM en terminal +
   reembolso por API + rev-share; hoy eso apunta a NetPay (precio) y MP (base instalada), no a Clip.

---

## 11. Top 5 URLs

1. Mercado Pago — Integrar el procesamiento de pagos (Orders API para Point):
   https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing
2. NetPay — Smart API reference (campos `tip`, `tableId`, `waitressid`, `settlementId`):
   https://docs.netpay.mx/terminales/smart-api/api-reference/
3. Clip — Crear una intención de pago en PinPad:
   https://developer.clip.mx/reference/post_payment-1.md
4. Banxico — Tasas de descuento por giro, Restaurantes, crédito (jul-2026):
   https://www.banxico.org.mx/servicios/tasas-de-descuento-para-tarjetas-de-credito-por-gi/%7B178DFF29-DA8F-E376-78AC-9B52D36C799F%7D.pdf
5. Toast 10-K FY2025 (modelo SaaS + fintech sin ser procesador):
   https://www.sec.gov/Archives/edgar/data/1650164/000165016426000057/tost-20251231.htm

Otras fuentes usadas: https://support.stripe.com/questions/terminal-in-mexico ·
https://stripe.com/mx/pricing · https://stripe.com/connect/pricing ·
https://docs.stripe.com/terminal/features/operate-offline/overview · https://docs.adyen.com/point-of-sale/ ·
https://docs.adyen.com/platforms/ · https://www.adyen.com/pricing ·
https://docs.apis-fiserv.com/latam/docs/card-present-clover-devices ·
https://www.gsmart.com.mx/i/devinfo.jsp · https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point/point-smart ·
https://www.odoo.com/documentation/17.0/es_419/applications/sales/point_of_sale/payment_methods/terminals/mercado_pago.html ·
https://developer.clip.mx/llms.txt · https://developer.clip.mx/reference/webhook.md ·
https://developer.clip.mx/reference/get_payment.md · https://docs.netpay.mx/terminales/smart-api/solicitud-venta/ ·
https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode ·
https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency ·
https://www.sec.gov/Archives/edgar/data/1794669/000179466926000010/four-20251231.htm ·
https://www.sec.gov/Archives/edgar/data/1512673/000162828026012254/xyz-20251231.htm ·
https://www.businesswire.com/news/home/20260212058106/en/Toast-Announces-Fourth-Quarter-and-Full-Year-2025-Financial-Results ·
https://www.lightspeedhq.com/news/lightspeed-announces-fourth-quarter-and-full-year-2026-financial-results-and-provides-outlook-for-fiscal-2027/ ·
https://www.bbva.mx/empresas/landings/tpv---openpay.html · https://www.zettle.com/mx/lector-de-tarjetas ·
https://corporate.freedompay.com/about-us/press-release/global-leader-in-commerce-technology-set-to-transform-payments-for-thousands-of-merchants-across-mexico ·
https://isvpartner.fiserv.com/signup/clip · https://www.banxico.org.mx/servicios/cuotas-de-intercambio-por-el-uso-de-tarjetas-de-cr/%7BF24763DD-FBD3-19EC-E6EA-1156F62361DA%7D.pdf ·
https://www.elfinanciero.com.mx/economia/2026/06/19/haces-transferencias-desde-tu-celular-banxico-cambia-las-reglas-para-spei-codi-y-dimo/ ·
https://www.cronista.com/mexico/finanzas-economia/no-es-para-todos-la-banca-simplifica-codi-y-dimo-ante-una-adopcion-menor-a-la-esperada-de-los-pagos-digitales/ ·
https://www.santander.com/es/sala-de-comunicacion/notas-de-prensa/2021/06/santander-consolida-su-negocio-adquirente-en-getnet-mexico-para-impulsar-su-crecimiento ·
https://www.axisnegocios.com/articulo.phtml?id=124069

---

## 12. Tabla de afirmaciones y fuentes (para que el hedge sobreviva al artefacto)

| Afirmación | Tipo | Fuente |
|---|---|---|
| Toast net take rate 58 bps, payments 48 bps, GPV ~$195 B, 164 k locations | HECHO | BusinessWire 2026-02-12; 10-K FY2025 |
| Toast no es procesador ("relies on third-party payment processors") | HECHO | 10-K FY2025, risk factors |
| Shift4 blended spread 60.5 bps FY2025; 550+ integraciones | HECHO | 10-K FY2025 |
| Lightspeed GPV/GTV 41–43 % FY2026 | HECHO | notas de resultados Q1–Q4 FY2026 |
| Banxico Restaurantes crédito jul-2026: MP 3.39 %, Clip 3.50 %, Stripe 3.59 %, NetPay Adq 2.19 %, Getnet 2.26 %, BBVA 2.33 %, Adyen 2.16 % | HECHO | PDF Banxico extraído con pdftotext |
| Intercambio Restaurantes 1.76 % crédito (may–oct 2026), 1.15 % débito tope $13.50 | HECHO | PDFs Banxico |
| MP Orders: idempotencia, expiración 30 s–3 h, reembolso parcial ≤ 90 días | HECHO | docs MP payment-processing |
| MP Point Smart 2 $4,499 (promo $499), 4G incluido, 3.5 % + IVA | HECHO | página de producto MP |
| MP modo offline existe en Point Smart | HECHO (snippet; página 403) | blog MP |
| MP offline no aplica en modo PDV | INFERENCIA | — |
| MP endpoint legado payment-intents ya no documentado | INFERENCIA | 404 en referencia |
| Clip PinPad: endpoint, campos, dispositivos, sólo producción, sdk@payclip.com | HECHO | developer.clip.mx |
| Clip sin pre-auth ni reembolso por API | HECHO (ausencia en índice llms.txt) + nota interna 2026-08-28 | developer.clip.mx/llms.txt; BIBLE-SQUARE.md:159 |
| NetPay Smart API cloud, campos de restaurante, cancelación mismo día | HECHO | docs.netpay.mx |
| NetPay `checkIn` = pre-auth | NO VERIFICADO | — |
| Programas ISV/rev-share MX | NO PUBLICADO | búsqueda en MP, Clip, NetPay, Getnet, Clover |
| Rev-share alcanzable 20–40 bps | INFERENCIA | derivado de Toast/Shift4 |
| Stripe Terminal MX preview, S710 sin celular, contradicción de lectores | HECHO | dos páginas de Stripe |
| Adyen adquiere presencial en MX | INFERENCIA fuerte | aparece en tabla Banxico Restaurantes |
| Clover MX exige contrato ISV para kit dev; Flex 3/Mini 3 desde ene-2025 | HECHO | docs.apis-fiserv.com/latam |
| Square offline 72 h, tope $1–$50,000, riesgo del comercio | HECHO | squareup.com help 7777 |
| Semi-integrado deja al POS fuera de alcance PCI | HECHO por modelo; SAQ exacto = INFERENCIA | PCI SSC SAQ docs |
| CoDi/DiMo $0 comisión, adopción baja, fusión 2026 | HECHO | El Financiero, Cronista |
| Contracargo MX 1.9 % | HECHO para e-commerce; no aplica a presencial | blog HG Pay citando CyberSource |

**Siguiente paso exacto:** (1) abrir cuenta developer en Mercado Pago y NetPay (sandbox) y confirmar
en el portal los tres puntos "no publicado" que bloquean diseño — propina en modo PDV (MP), `checkIn`
(NetPay), firma/reintentos de webhook (ambos); (2) definir el contrato `PaymentTerminalProvider` como
ADR antes de escribir el primer adaptador; (3) llevar la tabla de Banxico §5.1 a la primera
conversación comercial con NetPay.
