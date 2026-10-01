> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track G — Voz como canal nativo de Fullsite (pedidos por teléfono primero, drive-thru después)

> Investigación read-only, 2026-09-17. Sin cambios de código, sin contacto con proveedores.
> Método: 24 búsquedas web + 12 fetches a fuentes primarias (SEC, docs de proveedores, repos de GitHub,
> páginas de precios) + una lectura read-only de `dashboard-app/src/app/api/pos/save-order/route.ts`
> para aterrizar la parte de "canal nativo". El presupuesto de búsquedas se agotó a mitad del sprint;
> lo que no pude verificar está marcado como **[no verificado]**.
>
> Vocabulario: **HECHO** = fuente primaria citada · **CLAIM DEL VENDOR** = número publicado por quien lo vende
> · **INFERENCIA** = mi lectura · **RECOMENDACIÓN** = lo que haría.

---

## 0. Resumen en diez líneas

1. **La voz ya funciona en drive-thru y teléfono a escala** (Hi Auto: 100M pedidos/año; White Castle ~100 unidades; Taco Bell ~900 restaurantes; Domino's 1,400 tiendas con ConverseNow), **pero los números buenos son de los vendors y los malos son públicos** (McDonald's/IBM 80–85% y cancelado; Presto sancionado por la SEC por esconder que >70% de los pedidos los tomaban humanos en Filipinas; Taco Bell viral por 18,000 vasos de agua).
2. **El patrón que sobrevive es "IA + humano de respaldo + POS como fuente de verdad"**, no "IA sola". Presto lo hizo a escondidas y le costó una orden de la SEC; ConverseNow y Kea lo dicen de frente.
3. **La infraestructura de bajo nivel se volvió commodity en 2025–2026**: STT en streaming con español (Deepgram Nova-3 `es`/`es-419`), TTS con acentos de español (Aura-2, ElevenLabs), modelos speech-to-speech con function calling y SIP (OpenAI gpt-realtime), frameworks open-source maduros (Pipecat 15.6k★ BSD-2, LiveKit Agents 14.2k★ Apache-2) con detección semántica de turno **que incluye español**.
4. **Costo unitario público**: entre US$0.06 y US$0.20 por minuto todo incluido (telefonía + STT + LLM + TTS), es decir **US$0.20–0.60 por llamada de 3 minutos**. Un mesero contestando el teléfono cuesta más que eso desde la primera llamada perdida.
5. **México está resuelto en telefonía**: Twilio cobra US$0.01/min entrante + US$6.25/mes por número local MX; Telnyx vende DIDs MX desde US$5/mes con KYC ligero (nombre, ID, dirección).
6. **Lo que NO hay en México** es un vendor de voz para restaurantes con integración de POS real: lo que existe son bots WhatsApp/voz que mandan el pedido a un dashboard o a Sheets (PideLexia, Jesy.ai). Eso es exactamente el "bolt-on" que Fullsite no debe construir.
7. **La ventaja de Fullsite no es la voz, es que ya tiene el contrato de orden**: `save-order` con `save_operation_id` idempotente, `expected_revision` (OCC), validación de pagos en centavos, y la ruta KDS. La voz debe ser **un cliente más de ese contrato**, igual que Uber/Rappi.
8. **La regla de oro de corrección**: el LLM conversa, **nunca calcula**. Precio, disponibilidad (86), totales, impuestos, modificadores obligatorios y confirmación final son deterministas y viven en el servidor de Fullsite; el modelo solo llama herramientas.
9. **Construir con open-source (Pipecat o LiveKit Agents) + proveedores intercambiables**, no con Vapi/Retell: el margen y el control del audit trail importan más que las dos semanas que se ahorran.
10. **Por qué ahora**: los componentes ya soportan español y SIP; **por qué después**: el núcleo offline/POS de AMALAY no está certificado (§20 del protocolo). Voz es una iniciativa nueva; se diseña el contrato de canal hoy, se construye el agente cuando el POS esté cerrado.

---

## 1. Tabla de vendors

| Producto | Idiomas (es-MX) | Despliegue | Modelo de respaldo humano | Precio público | Métricas publicadas | Integración con POS |
|---|---|---|---|---|---|---|
| **SoundHound for Restaurants** (Dynamic Interaction, Smart Ordering, Smart Answering, Employee Assist) | Multilingüe (modelo Polaris, "multilingual"); es-MX no confirmado explícitamente | Drive-thru (White Castle ~100 unidades = 30% de la cadena), teléfono ("una de las pizzerías más grandes del mundo, miles de tiendas") | No lo publica como producto; vende "100% de llamadas contestadas" | No público | **CLAIM**: 90%+ de pedidos completados sin humano, <60 s por pedido (White Castle) | Integraciones propias; compró Allset (2024) y Amelia (US$80M, 2024) para comercio y enterprise |
| **ConverseNow** | Inglés y español (publicado) | Teléfono + drive-thru (Domino's 1,400 tiendas, Jet's Pizza; compró Valyant 2024) | **Híbrido explícito**: "context-aware AI-human hybrid" | No público | **CLAIM**: CSAT 4.4/5 post-llamada en Domino's | POS integration como feature; detalle no público |
| **Presto Voice** | Inglés | Drive-thru (Checkers, Del Taco, Hardee's históricos) | Humanos en Filipinas e India, **no revelado** hasta nov-2023 | No público | **HECHO (SEC 2025-01-14)**: ">70% de pedidos requerían intervención humana" en la versión avanzada; 100% en la versión original | Integración con POS de la cadena |
| **Kea** | Inglés (español no confirmado) | Teléfono | Transferencia a staff + preguntas de aclaración; **presume no depender de humanos 20–30% como "competidores"** | ~US$450/mes por local, llamadas ilimitadas | **CLAIM**: 99.3% de exactitud sobre 846,000 llamadas | POS sync incluido |
| **Slang.ai** | Inglés (español no confirmado) | Teléfono (reservas/FAQ/pedidos) | Transferencia al restaurante | US$399/mes Core, US$599/mes Premium por local | No publica exactitud | Reservas (OpenTable etc.); pedidos limitados |
| **PolyAI** | Multilingüe enterprise | Teléfono (contact center, hospitalidad) | Transferencia a agente | Enterprise | **CLAIM**: Dialog-RSN-1 responde <300 ms; barge-in activado por defecto | No es producto de restaurante; se integra vía API |
| **Hi Auto** | Inglés | Drive-thru (Checkers/Rally's, Bojangles, Lee's, BK NZ, Popeyes UK) | Escalación al empleado | No público | **CLAIM**: 93% completion, 96% exactitud, 100M pedidos/año; levantó US$15M (abr-2025) | POS de cadena |
| **OpenCity (Tori)** | Inglés | Drive-thru (Popeyes franquiciado, Lafayette LA) | Empleado | No público | **CLAIM**: 99.9% exactitud, +20% velocidad, +150% bebidas (una franquicia; cifra de PR de 2022) | — |
| **Wendy's FreshAI** (Google Cloud) | Inglés/español (Wendy's ha declarado español) | Drive-thru; 100 pilotos → meta 500–600 en 2025; reportado "más de 160" | Empleado toma el relevo | Interno | Sin exactitud publicada; "mejoras en exactitud" | Interno (Vertex/Gemini) |
| **Yum Byte AI** (Taco Bell, con Nvidia) | Inglés | Drive-thru; ~500 (mar-2025) → ~890–900 (2026) | Empleado | Interno | Sin exactitud publicada; incidente viral de 18,000 aguas (ago-2025) y "rethinking" público, luego siguió escalando | Interno |
| **McDonald's/IBM** | Inglés | Drive-thru, >100 unidades, 2021–jun-2024, **cancelado** | Empleado | Interno | Reportado (CNBC/fuentes): plateau 80–85% exactitud; problemas con acentos | Interno; reemplazado en 2026 por ArchIQ/"Archy" en pocos locales |
| **OpenAI Realtime API** (gpt-realtime) | Multilingüe incl. español | Componente (WebRTC/WebSocket/**SIP**) | N/A | US$32/1M tokens audio in, US$64/1M out (mini: US$10/US$20). ≈ US$0.06–0.11/min con caché | N/A | N/A — tú lo integras con tools |
| **Google Gemini Live API** | Multilingüe | Componente | N/A | US$3/1M audio in, US$12/1M out; se re-cobra el contexto de sesión por turno | N/A | N/A |
| **Deepgram** (Nova-3 STT, Aura-2 TTS, Voice Agent API) | Nova-3: `es`, `es-419` streaming; Aura-2: español con acentos regionales, 10+ voces | Componente | N/A | STT US$0.0048/min; TTS US$30/1M chars; Voice Agent bundle US$4.50/h (=US$0.075/min) | AssemblyAI publica WER 12.83% para Nova-3 en code-switching vs 7.60% Universal-3.5 (benchmark del competidor) | N/A |
| **ElevenLabs Agents** | Multilingüe incl. español | Componente + telefonía (Twilio nativo, SIP trunk) | N/A | US$0.08/min estándar (burst 2x); planes con minutos incluidos | N/A | N/A |
| **Vapi / Retell / Bland** | Multilingüe (depende del STT/LLM) | Managed: orquestación + telefonía | Transferencia configurable | Vapi US$0.05/min + proveedores al costo (real US$0.10–0.30); Retell US$0.055/min infra (real US$0.13–0.31); Bland US$0.09/min | N/A | Tools HTTP genéricos |
| **Twilio ConversationRelay** | Depende del STT (Deepgram Nova-2, Google) / TTS (Polly, ElevenLabs, Google) | Telefonía + STT/TTS gestionados, tú pones el LLM por WebSocket | N/A | Desde US$0.07/min + voz MX | N/A | N/A |
| **México: PideLexia (Colima), Jesy.ai** | Español | WhatsApp/teléfono | ? | No público | Sin métricas | "llega al POS o dashboard de Jesy" — es decir, bolt-on |

Fuentes por fila en §9.

---

## 2. Lecciones de los casos públicos (lo que el marketing no dice)

**Presto (HECHO, orden SEC 33-11352, 2025-01-14).** La SEC encontró que Presto (a) no reveló que la tecnología de reconocimiento de voz de sus unidades era de terceros, (b) afirmó que su producto "eliminaba la necesidad de humanos tomando pedidos" cuando "la gran mayoría" de los pedidos requerían intervención humana, y (c) presentó de forma engañosa la tasa de pedidos sin humano. En los 10-K/10-Q de nov–dic 2023 apareció por primera vez: ">70% de los pedidos tomados por Presto Voice requieren intervención de un agente humano" (versión avanzada) y 100% en la versión original, con agentes en Filipinas e India. Sin multa por cooperación. **Lección**: el humano en el loop no es vergonzoso; esconderlo sí. Fullsite debe medir y reportar containment desde el día uno, con la métrica definida de forma auditable.

**McDonald's/IBM (HECHO: cancelado jun-2024, >100 restaurantes).** Reportes citan plateau de 80–85% y problemas con acentos y dialectos. **Inferencia** del análisis de CIO.inc que comparto: el 15% de fallas no se distribuye al azar; se concentra en ruido, prisa y clientes molestos — justo lo que se graba y se vuelve viral. En español mexicano con ruido de cocina ese riesgo es mayor, no menor.

**Taco Bell (HECHO: ~500 → ~900 locales; incidente viral ago-2025).** Un cliente pidió 18,000 vasos de agua y el sistema lo aceptó. Yum dijo públicamente que "repensaría" el despliegue y siguió escalando con guardrails. **Lección**: límites de cantidad por línea y por ticket son reglas deterministas del servidor, no del prompt.

**White Castle/SoundHound, Hi Auto, Kea, OpenCity (CLAIMS).** 90%, 93/96%, 99.3%, 99.9%. Ningún número viene con definición pública de "exactitud" (¿por ítem? ¿por ticket? ¿después de corrección humana?) ni con auditoría externa. Kea además publica que "los competidores dependen de humanos 20–30% del tiempo", lo que es útil como estimado de la industria aunque sea interesado. **Recomendación**: Fullsite define sus métricas antes de la primera llamada (ver §6).

**ConverseNow (HECHO: híbrido declarado).** Es el modelo honesto: la IA atiende, un humano remoto interviene cuando el sistema lo pide, y el POS sigue siendo la verdad. Domino's lo tiene en 1,400 tiendas con CSAT 4.4/5 reportado por el vendor.

---

## 3. Mapa técnico con citas

### 3.1 Ruta telefónica

```
PSTN (cliente marca al número MX del restaurante)
  → Carrier/CPaaS (Twilio: US$0.01/min entrante + US$6.25/mes local MX; Telnyx: DID MX desde US$5/mes, KYC nombre+ID+dirección)
  → SIP trunk o WebSocket de media (Twilio Media Streams ~US$0.002/min; ConversationRelay desde US$0.07/min; o SIP directo a LiveKit/OpenAI Realtime)
  → Orquestador (Pipecat / LiveKit Agents / managed)
      ├─ VAD + detección de turno (LiveKit turn-detector: 14 idiomas incl. español; texto ~50–160 ms; audio ~1 s)
      ├─ STT streaming (Deepgram Nova-3 es/es-419 US$0.0048/min)  ── o ── modelo speech-to-speech (gpt-realtime, Gemini Live)
      ├─ LLM con tools (add_item, set_modifier, check_availability, quote_price, confirm_order, handoff)
      │     └─ tools = llamadas HTTP a Fullsite (Pedro local o Vercel), que devuelven la verdad del menú/precio
      └─ TTS streaming (Aura-2 es con acentos, ElevenLabs Flash)
  → Confirmación leída → confirm_order → save-order (save_operation_id) → KDS
  → Transcript + tool calls + orden final → audit log
```

### 3.2 Presupuesto de latencia

Objetivo de la industria: <800 ms de "fin de habla del cliente → inicio de audio del agente". Lo que publican:
- PolyAI: Dialog-RSN-1 "<300 ms de forma confiable, distribución más apretada que GPT Realtime 2.1" (CLAIM en blog de partner).
- LiveKit turn detector: 50–160 ms por turno (texto), VAD mínimo 250 ms de silencio.
- OpenAI gpt-realtime: sin cifra oficial en lo que pude verificar [no verificado].

**Inferencia de presupuesto** para stack en cascada: VAD/endpoint 250–400 ms + STT final 100–200 ms + LLM primer token 200–400 ms + TTS primer byte 100–200 ms = 650–1,200 ms. Speech-to-speech (gpt-realtime) comprime eso pero pierde control sobre el texto intermedio (importante para audit y para "leer de vuelta" exacto).

### 3.3 Barge-in y turnos

PolyAI (blog "The art of knowing when to shut up") describe el problema real: un falso disparo por ruido de fondo/TV/eco hace que el agente conteste algo que nadie dijo; dos o tres de esos y el cliente cuelga. Su solución: modelo de fin de habla adaptativo que extiende la ventana cuando el cliente pausa a media idea, barge-in activado por defecto. LiveKit y Pipecat implementan lo mismo con modelo semántico + VAD. **Para México**: el modelo de turno de LiveKit **sí lista español**; hay que medirlo con audio de teléfono real de Monterrey (8 kHz, ruido de calle).

### 3.4 Grounding al menú real (el punto que separa nativo de bolt-on)

Ningún vendor publica su técnica en detalle; el patrón observable en las APIs (OpenAI function calling, Pipecat Flows, LiveKit function tools) es:

1. **El menú NO va en el prompt como texto libre.** Va como resultado de herramientas: `search_menu(query)` devuelve ítems reales con `menu_item_id`, precio vigente, grupos de modificadores y disponibilidad. El LLM solo puede referirse a IDs que recibió.
2. **Esquemas de tools con enums cerrados** por turno: `add_item(menu_item_id ∈ {ids devueltos})`, `set_modifier(group_id, option_id)`; cualquier ID fuera del set = error de tool, no de conversación.
3. **Pipecat Flows** permite además nodos con tools distintos por estado (tomando pedido / confirmando / cobrando), lo que evita que el modelo llame `confirm_order` antes de resolver modificadores obligatorios.
4. **"No hallucinated items"** se garantiza en el servidor: `add_item` valida contra `menu_items` del tenant; si el ítem no existe o está 86, la tool responde `{ok:false, reason:"UNAVAILABLE", alternatives:[...]}` y el modelo lo dice.

### 3.5 Lo determinista vs lo que el modelo puede hacer

| Determinista (servidor Fullsite) | El LLM puede |
|---|---|
| Precio por ítem y por modificador | Elegir qué preguntar y en qué orden |
| Disponibilidad / 86 | Parafrasear, aclarar, sugerir (upsell con lista permitida) |
| Modificadores obligatorios sin resolver ⇒ no se confirma | Interpretar "sin cebolla, con todo, para llevar" a IDs |
| Subtotal, IVA, propina, total | Leer de vuelta el resumen **que el servidor generó** |
| Límites: cantidad máx por línea, ticket máx, ítems máx | Pedir confirmación explícita ("¿confirmo?") |
| Idempotencia: `save_operation_id` = `call_sid` + secuencia | Disparar `handoff` cuando no entiende |
| Alergias: disclaimer fijo, texto aprobado por el restaurante | **Nunca** afirmar que un platillo es libre de alérgenos |
| Pago: nunca captura tarjeta por voz; link de pago o Twilio `<Pay>` con DTMF enmascarado | Decir "te mando el link por SMS/WhatsApp" |

### 3.6 Handoff a humano

Disparadores que aparecen en Kea/ConverseNow/PolyAI y en docs de frameworks: (a) el cliente lo pide ("quiero hablar con alguien"), (b) N fallos consecutivos de interpretación (2–3), (c) confianza STT baja sostenida, (d) intent fuera de alcance (queja, factura, reservación grande), (e) ítem/modificador no resoluble, (f) timeout. Mecánica: transferencia SIP en frío al número del restaurante, o "warm" con contexto leído al empleado; ElevenLabs marca warm transfer como limitado; LiveKit y Pipecat exponen transferencia por SIP REFER [detalle no verificado en docs por agotamiento de búsquedas].

### 3.7 Pagos por teléfono

- **Twilio `<Pay>`** (GA): captura de tarjeta por DTMF con dígitos enmascarados; el agente no los oye; PCI en Twilio y el gateway. Requiere conector de pago compatible; Mercado Pago no aparece en la lista pública de conectores [no verificado].
- **Pay-by-link**: crear preferencia en Mercado Pago (`init_point`) y enviarla por SMS/WhatsApp; webhook confirma; la orden queda `pendiente_pago` hasta el webhook. Es lo que más encaja con México (tarjeta + OXXO + SPEI) y no toca PCI.
- **Recomendación**: pago contra entrega/en mostrador como default en fase 1; link Mercado Pago como opción; `<Pay>` nunca en fase 1.

### 3.8 Audit log

Mínimo por llamada: `call_sid`, número origen (hasheado), tenant, timestamps por turno, transcript STT (con confianza), cada tool call con request/response, resumen leído al cliente, `save_operation_id`, `order_id` + `revision`, resultado (completada / handoff / abandonada), costo por componente. Es lo que la SEC habría querido ver de Presto y lo que permite calcular containment sin discusión.

### 3.9 Costo por llamada (precios de lista, sep-2026)

Llamada de 3 min, stack open-source en cascada:
- Telefonía Twilio MX entrante: 3 × US$0.01 = **US$0.03** (+ Media Streams 3 × 0.002 = 0.006)
- STT Nova-3: 3 × 0.0048 = **US$0.014**
- LLM (gpt-4.1-mini/-4o-mini clase; ~6k tokens/llamada): **≈US$0.01–0.02** [estimado]
- TTS Aura-2 (~1,500 chars): **US$0.045**
- Hosting orquestador: **≈US$0.01** [estimado]
- **Total ≈ US$0.11–0.13 por llamada (≈ MXN $2.20–2.60)**

Con gpt-realtime speech-to-speech: 3 min × US$0.06–0.11 = US$0.18–0.33 + telefonía. Con Vapi/Retell: US$0.30–0.90 por llamada. Con Deepgram Voice Agent bundle: 3 × 0.075 = US$0.225 + LLM + telefonía. Cualquiera es despreciable frente al ticket promedio de AMALAY; lo que manda es la tasa de pedidos perdidos/mal tomados, no el costo de cómputo.

---

## 4. La pregunta clave: cómo hacer la voz un canal NATIVO

### 4.1 Qué ya tiene Fullsite (HECHO, leído del repo)

`dashboard-app/src/app/api/pos/save-order/route.ts`:
- Autenticación de POS (`withPOSAuth`) que resuelve `clientId` (tenant).
- `order_id` + `expected_revision` (OCC) y `save_operation_id` → `r1_save_order_idempotent`; replay devuelve el resultado original sin re-ejecutar.
- Validación server-side de `sum(pagos) == total + propina` en centavos.
- Reconciliación de inventario separada del save (PENDING/COMPLETE/BLOCKED/SKIPPED).
- Rutas hermanas: `add-items`, `cancel-item`, `menu`, `kitchen`, `merge-orders`, `transfer-item`.

Y existe `lib/integrations/uber-eats/delivery-store.ts` + un bridge Rappi→KDS (commit `b5c72c25`), es decir, ya hay **dos canales externos** entrando a la misma ruta. La voz es el tercero.

### 4.2 Bolt-on vs nativo

| | Bolt-on (PideLexia/Jesy/Retell "restaurant template") | Nativo (propuesta) |
|---|---|---|
| Menú | Copia en el vendor, se desincroniza | `GET /api/pos/menu` del tenant, con 86 en vivo |
| Precio/total | Lo calcula el bot o el LLM | Lo calcula `quote_order` en Fullsite |
| Entrega del pedido | Email/SMS/dashboard/Sheets; alguien lo re-teclea en el POS | `save-order` con `save_operation_id` = `voice:{call_sid}:{n}` → misma OCC, mismo KDS, misma impresión |
| Duplicados | Re-llamadas duplican | Idempotencia existente |
| Auditoría | Del vendor, si acaso | Transcript + tool calls + `order_id` en Fullsite |
| Multi-tenant | Un bot por restaurante configurado a mano | `client_id` del contrato autorizado; el agente se instancia por tenant sin código |
| Offline | Si Vercel cae, el bot no sabe nada | El agente habla con Pedro (LAN) o con Vercel según topología; misma cola |

### 4.3 La abstracción de canal (la misma que necesitan Uber/Rappi)

**Inferencia/recomendación**: definir un **Order Intent** común, independiente del canal:

```
OrderIntent {
  tenant_id, channel: 'pos'|'uber'|'rappi'|'voice'|'whatsapp',
  external_ref: { provider, id },          // call_sid, uber order id…
  save_operation_id,                        // idempotencia
  customer: { phone_hash?, name? },
  fulfillment: 'pickup'|'delivery'|'dine_in', requested_at?,
  lines: [{ menu_item_id, qty, modifiers: [{group_id, option_id}], notes }],
  payment: 'on_pickup'|'link_pending'|'prepaid'|…,
  provenance: { transcript_ref?, agent_version?, confidence_summary? }
}
```
con tres operaciones en el servidor: `validate(intent) → errores por línea` · `quote(intent) → totales deterministas` · `commit(intent) → save-order`. Uber y Rappi ya hacen (a su modo) lo mismo en `delivery-store.ts`; unificar bajo un `channel-adapter` evita tres versiones de la misma lógica y le da al KDS un campo `channel` para pintar el ticket. **Sin este contrato, la voz no puede ser nativa; con él, la voz es una tarde de tools.**

---

## 5. Arquitectura de referencia para Fullsite

| Componente | Opción | BUILD / BUY / OSS | Por qué |
|---|---|---|---|
| Número y PSTN MX | Twilio (US$0.01/min + US$6.25/mes) o Telnyx (DID desde US$5/mes) | BUY | KYC ligero, ambos con SIP y WebSocket; empezar con Twilio por ConversationRelay como fallback gestionado |
| Transporte de media | SIP a LiveKit Cloud/self-host **o** Twilio Media Streams a Pipecat | OSS | Pipecat trae serializers Twilio/Telnyx/Vonage/Plivo; LiveKit trae stack SIP propio |
| Orquestador | **Pipecat** (15.6k★, BSD-2, Python) con Pipecat Flows | OSS | Flows da máquina de estados con tools por nodo = grounding estructural. Alternativa: LiveKit Agents (14.2k★, Apache-2) si se quiere SIP nativo y turn-detector propio |
| Turno / barge-in | LiveKit turn-detector (español incluido; licencia LiveKit Model License) o Silero VAD + endpointing de Deepgram | OSS | Medir con audio real de Monterrey |
| STT | Deepgram Nova-3 `es-419` streaming | BUY (intercambiable) | Único con precio/latencia publicados y español en streaming; benchmark de AssemblyAI lo deja abajo en code-switching, así que probar Universal-3.5 en paralelo |
| LLM | Modelo con function calling (GPT-4.1-mini/Claude Haiku clase) en cascada; gpt-realtime como experimento | BUY | Cascada conserva texto intermedio para audit; S2S para latencia después |
| TTS | Deepgram Aura-2 (es con acentos) o ElevenLabs Flash | BUY | Voz mexicana neutra; comparar en escucha ciega |
| Tools / contrato | `search_menu`, `add_item`, `set_modifier`, `remove_item`, `check_availability`, `quote_order`, `read_back`, `confirm_order`, `send_pay_link`, `handoff` → todas contra Fullsite | BUILD | Es el canal; es lo único que nadie puede vender |
| Handoff | SIP REFER al número del restaurante + mensaje al POS con resumen | BUILD sobre OSS | |
| Pago | Mercado Pago link (SMS/WhatsApp) | BUY | Sin PCI |
| Audit/eval | Tabla `voice_calls` + `voice_turns` + `voice_tool_calls` en Supabase (por tenant, RLS) | BUILD | Containment auditable |
| Managed alternativo | Vapi/Retell/ElevenLabs Agents | BUY | Solo para un piloto de 2 semanas que valide demanda; migrar antes de escalar (costo 3–5x y audit fuera de casa) |

**Dónde corre**: el orquestador necesita salida a internet para STT/LLM/TTS; por tanto corre en la nube, **no** en Pedro. Pero las tools deben poder resolver contra Pedro (vía Tailscale/API 7717, ya existe) cuando la sucursal esté offline de Vercel, o encolar en la misma cola offline. Si no hay internet en el restaurante, el teléfono fijo sigue sonando en el local: ese es el fallback natural, no hay que inventar otro.

---

## 6. Evaluación: métricas que Fullsite define antes de la primera llamada

- **Containment**: llamadas terminadas con `confirm_order` exitoso sin `handoff` / llamadas contestadas. Reportar también "handoff solicitado por cliente" vs "por sistema".
- **Exactitud por ticket**: pedido en KDS == lo que el cliente confirmó en la lectura de vuelta (auditado por muestreo humano semanal, 50 llamadas).
- **AHT** y **tiempo a primer audio**.
- **Ingreso por llamada** y **llamadas perdidas antes/después** (hoy nadie mide cuántas llamadas se pierden en AMALAY en hora pico; es el número que justifica el proyecto).
- **Costo por llamada** por componente (del audit log).

Referencias de la industria para calibrar: 80–85% (McDonald's/IBM, cancelado), 90% (SoundHound claim), 93–96% (Hi Auto claim), 20–30% intervención humana (Kea sobre competidores), >70% (Presto real). **Umbral honesto para un piloto en español**: 70% containment el mes 1 con humano de respaldo, 85% al mes 3; menos de eso, se pausa.

---

## 7. Repos

| REPO | STARS | LICENSE | LAST_ACTIVE | LANGUAGE | WHAT_TO_REUSE | RISKS |
|---|---|---|---|---|---|---|
| github.com/pipecat-ai/pipecat | 15.6k | BSD-2-Clause | Activo (13k commits, mantenido por Daily) | Python | Pipeline completo, serializers Twilio/Telnyx/Vonage/Plivo, **Pipecat Flows** para diálogo por estados, ejemplos de teléfono | Daily empuja su transporte; Python en prod para Fullsite (stack TS) = servicio aparte |
| github.com/livekit/agents | 14.2k | Apache-2.0 (turn-detector: LiveKit Model License) | Activo (4k commits) | Python (hay agents-js en Node) | Telefonía SIP nativa, turn detector con español, function tools, `agents-js` encaja con el stack TS | Modelo de turno con licencia propia; mejor experiencia con LiveKit Cloud (vendor pull) |
| github.com/vocodedev/vocode-core | 3.8k | MIT | Último commit nov-2024 (quieto) | Python | Ideas de abstracción STT/LLM/TTS | Abandonado en la práctica; no usar |
| github.com/bolna-ai/bolna | 763 | MIT | Activo | Python | Config JSON de agentes, Twilio/Plivo | Comunidad chica; Exotel/Vonage "coming soon" |
| TEN Framework (10.9k, por búsqueda secundaria) | ~10.9k | [no verificado] | Activo | C/Python | Orquestación multimodal por grafo | No verificado directamente |

---

## 8. FACT / INFERENCE / RECOMMENDATION

**HECHOS**
- SEC sancionó a Presto (2025-01-14) por ocultar que la "gran mayoría" de pedidos requerían humanos; >70% en su versión avanzada, 100% en la original (10-K/10-Q 2023).
- McDonald's terminó el piloto con IBM en jun-2024 (>100 locales).
- Taco Bell pasó de ~500 a ~900 locales pese al incidente viral de ago-2025.
- Deepgram Nova-3 soporta `es` y `es-419` en streaming a US$0.0048/min; Aura-2 español con acentos a US$30/1M chars.
- LiveKit turn-detector lista español entre 14 idiomas; latencia 50–160 ms texto.
- Twilio MX: US$0.01/min entrante local, US$6.25/mes; Telnyx MX DID desde US$5/mes con KYC nombre+ID+dirección.
- gpt-realtime: US$32/US$64 por 1M tokens audio in/out; mini US$10/US$20; SIP soportado (según OpenAI; la página de docs `realtime-sip` devolvió 404 en dos rutas — **[URL no verificada]**).
- Pipecat 15.6k★ BSD-2; LiveKit Agents 14.2k★ Apache-2; Vocode sin commits desde nov-2024.
- Fullsite ya tiene `save-order` idempotente con `save_operation_id`, OCC por `expected_revision` y validación de pagos en centavos.

**INFERENCIAS**
- Ningún vendor de restaurantes opera con integración POS real en México; el mercado local es bolt-on.
- El costo por llamada (US$0.11–0.33) es irrelevante frente al valor de una llamada no perdida; el riesgo del proyecto es exactitud y reputación, no dinero.
- El español mexicano telefónico (8 kHz, ruido) tendrá WER peor que los benchmarks publicados; sin medición propia no hay decisión de STT.
- La abstracción de canal es el 60% del trabajo y sirve a Uber/Rappi/WhatsApp igual que a voz.

**RECOMENDACIONES**
1. Diseñar y documentar el **Order Intent + channel adapter** ahora (afecta delivery, ya en curso).
2. Prototipo de 2 semanas con Pipecat + Twilio MX + Nova-3 es-419 + Aura-2 contra el menú real de AMALAY vía tools, **sin tocar save-order en prod** (tenant demo).
3. Humano de respaldo desde el día uno (transferencia al fijo del restaurante) y containment reportado semanalmente.
4. Deterministas en servidor: precio, 86, totales, límites de cantidad, modificadores obligatorios, disclaimer de alergias.
5. Pago: contra entrega o link Mercado Pago; nunca tarjeta por voz en fase 1.

---

## 9. Top URLs (las 5 que más valen + resto de fuentes)

**Top 5**
1. https://www.sec.gov/enforcement-litigation/administrative-proceedings/33-11352-s — la única fuente adversarial con números reales de containment.
2. https://github.com/pipecat-ai/pipecat — framework recomendado; ver Pipecat Flows.
3. https://docs.livekit.io/agents/build/turns/turn-detector — turno semántico con español.
4. https://developers.deepgram.com/docs/models-languages-overview — Nova-3 `es`/`es-419`.
5. https://www.twilio.com/en-us/voice/pricing/mx — precios reales de telefonía en México.

**Resto**
- Presto 10-K FY2023: https://www.sec.gov/Archives/edgar/data/1822145/000155837023016336/prst-20230630x10k.htm
- SoundHound/White Castle: https://www.restaurantdive.com/news/white-castle-soundhound-ai-voice-drive-thru-100-units-2024/689624/ ; https://www.soundhound.com/newsroom/press-releases/soundhound-and-white-castle-commit-to-expand-successful-drive-thru-ai-partnership/ ; Employee Assist: https://www.soundhound.com/voice-ai-products/employee-assist/ ; Amelia: https://techcrunch.com/2024/08/08/soundhound-acquires-amelia-ai-for-80m-after-it-raised-189m/
- ConverseNow: https://conversenow.ai/products.html ; https://www.restaurantbusinessonline.com/technology/ai-voice-supplier-conversenow-acquires-fellow-provider-valyant-ai
- McDonald's/IBM: https://www.cnbc.com/2024/06/17/mcdonalds-to-end-ibm-ai-drive-thru-test.html ; https://www.cio.inc/mcdonalds-ai-drive-thru-20-lessons-from-failure-a-32152
- Taco Bell: https://www.nrn.com/quick-service/taco-bell-s-drive-thru-voice-ai-expands-to-nearly-900-restaurants ; https://restauranttechnologynews.com/2025/08/how-taco-bells-ai-drive-thru-became-a-viral-sensation-for-the-wrong-reasons/ ; https://techxplore.com/news/2025-03-ai-taco-bell-parent-yum.html
- Wendy's FreshAI: https://www.restaurantdive.com/news/wendys-deploy-digital-menu-boards-drive-thru-ai-500-restaurants-2025/746977/ ; https://www.wendys.com/blog/drive-thru-innovation-wendys-freshai
- Hi Auto: https://hi.auto/company/newsroom/hi-autos-ai-order-taker-surpasses-100-million-drive-thru-orders-per-year/ ; https://restauranttechnologynews.com/2025/04/hi-auto-picks-up-speed-with-15-million-funding-round-to-fuel-its-ai-powered-drive-thru-voice-assistant/
- OpenCity/Popeyes: https://medium.com/opencity/opencitys-conversational-voice-ai-tori-forever-changes-the-drive-thru-experience-6820b6fb6acf
- Chipotle "Ava Cado" es contratación, no pedidos: https://newsroom.chipotle.com/2024-10-22-CHIPOTLE-INTRODUCES-NEW-AI-HIRING-PLATFORM-TO-SUPPORT-ITS-ACCELERATED-GROWTH
- Kea: https://kea.ai/ ; https://kea.ai/resources/voice-ai-order-accuracy-benchmarks-2026
- Slang.ai: https://www.slang.ai/ ; precios vía https://synthflow.ai/blog/slang-ai-pricing (secundaria)
- PolyAI: https://poly.ai/blog/barge-in-voice-ai-interruption-handling ; https://ai-coustics.com/blog/polyai-production-grade-voice-agents ; https://docs.poly.ai/voice-channel/advanced/call-settings
- OpenAI: https://openai.com/index/introducing-gpt-realtime/ ; https://developers.openai.com/api/docs/pricing
- Gemini Live: https://ai.google.dev/gemini-api/docs/pricing
- Deepgram precios: https://deepgram.com/pricing
- ElevenLabs: https://elevenlabs.io/pricing/agents ; https://elevenlabs.io/agents/integrations/twilio
- Vapi/Retell/Bland (secundarias): https://www.cekura.ai/blogs/vapi-ai-pricing ; https://www.cekura.ai/blogs/retell-ai-pricing-per-minute
- Twilio ConversationRelay: https://www.twilio.com/docs/voice/conversationrelay ; https://www.twilio.com/en-us/products/conversational-ai/pricing ; `<Pay>`: https://www.twilio.com/docs/voice/twiml/pay ; SIP MX: https://www.twilio.com/en-us/sip-trunking/pricing/mx
- Telnyx MX: https://support.telnyx.com/en/articles/5466793-mexico-did-requirements ; https://telnyx.com/phone-numbers/mexico
- Mercado Pago link de pago: https://www.mercadopago.com.ar/developers/es/docs/payment-link/intro-button
- LiveKit Agents: https://github.com/livekit/agents ; https://github.com/livekit/agents-js
- Vocode: https://github.com/vocodedev/vocode-core ; Bolna: https://github.com/bolna-ai/bolna
- AssemblyAI benchmarks (incluye Nova-3 en code-switching): https://www.assemblyai.com/benchmarks
- México: https://pidelexia.com/ ; https://jesyai.com/

---

## 10. Qué NO construir

- **Un STT/TTS propio.** Commodity con español; no hay moat ahí.
- **Un bot que manda el pedido por WhatsApp/email al restaurante.** Es el bolt-on que todos venden en México y que deja al mesero re-tecleando.
- **Captura de tarjeta por voz.** PCI, fraude, y nadie en México lo espera; link de Mercado Pago.
- **Drive-thru en fase 1.** AMALAY no tiene drive-thru; el hardware de audio (micrófono de poste, cancelación de ruido) es otro proyecto. Teléfono primero.
- **Un "prompt gigante con el menú".** Es la forma más rápida de inventar platillos y precios; el menú entra por tools.
- **Depender de Vapi/Retell para producción.** 3–5x el costo, audit fuera de casa, y el contrato de canal de todos modos hay que escribirlo.
- **Prometer containment antes de medirlo.** Presto.

---

## 11. Por qué ahora / por qué después (México)

**Por qué ahora**
- Los componentes ya soportan español en streaming, telefonía MX con KYC ligero, y frameworks OSS maduros con detección de turno en español; hace 18 meses esto no existía en conjunto.
- Nadie en México lo ofrece integrado al POS; el pitch "tu teléfono ya no pierde pedidos y el ticket cae directo en cocina" es simple y demostrable en AMALAY.
- La abstracción de canal se necesita de todas formas para Uber/Rappi (ya en curso: `b5c72c25`), así que el 60% del trabajo tiene doble uso.
- Costo por llamada ≈ MXN $2–7; el argumento económico se cierra con una llamada recuperada por día.

**Por qué después**
- §20 del protocolo: no abrir iniciativas nuevas con el núcleo (offline, POS, KDS) sin certificar; voz es nueva.
- Sin medición propia de WER en español telefónico de Monterrey, cualquier promesa de exactitud es un recuerdo, no un hecho.
- AMALAY primero debe contestar: ¿cuántas llamadas se pierden hoy? Si son pocas, la voz no es P0 aunque sea vistosa.
- El equipo es Daniel + agentes; un canal en producción con clientes reales al teléfono exige respaldo humano operado por el restaurante, y eso hay que negociarlo con Eduardo antes de escribir código.

**Siguiente paso exacto** (cuando se autorice): documentar `OrderIntent` + `channel-adapter` en `docs/` como ADR, y un prototipo de dos semanas en tenant demo con Pipecat + Twilio MX + Nova-3 es-419 + Aura-2 hablando con `GET /api/pos/menu` y un `save-order` de sandbox, midiendo WER, latencia y containment sobre 100 llamadas de prueba grabadas.
