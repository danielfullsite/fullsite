# Barrido 3 — Integraciones externas y recuperación ante resultado incierto

Worktree: `scratchpad/wt-merge/wt-barrido3` = `origin/main` `f9f8965c`.
Todo lo de abajo se leyó en ese commit. Rutas relativas a
`/private/tmp/claude-501/-Users-danielrg-fullsite/5da718bd-f5a0-4f70-b4bf-871021defe7a/scratchpad/wt-merge/wt-barrido3/`.

11 hallazgos (4 P0 · 5 P1 · 2 P2). Todos con confianza ≥0.7.

---

### [P0] MP Point: la respuesta perdida se resuelve como "cobrado" — doble cobro
`dashboard-app/src/app/pos/page.tsx:6576-6587`
confianza: **0.75**

**Escenario.** El cajero pulsa *Tarjeta*. El POS hace `fetch('/api/mp-point', {action:'payment'})`.
Mercado Pago ya recibió el `payment-intent` y la terminal está pidiendo la tarjeta, pero
la respuesta HTTP se pierde (timeout de la función en Vercel, WAN intermitente, 502 de
proxy). El `catch` del POS hace exactamente esto:

```
} catch {
  setSaving(false); operationLock.current = false
  if (!navigator.onLine) { showToast('Sin conexión — ...') }
  else { handlePayment('Tarjeta de crédito') }   // ← cierra la venta como cobrada
}
```

Y la rama `else` de `result.success` (línea 6576-6580) hace lo mismo: `handlePayment(...)`
sin preguntar nada. Es decir: **ante resultado incierto el POS afirma que se cobró**, cierra
la orden, y deja vivo en la terminal un `payment-intent` por el mismo monto. Si el cliente
pasa la tarjeta, se cobró y la orden ya está cerrada sin `paymentIntentId` ni conciliación;
si el cajero vuelve a mandar el cobro, son dos cargos.

La ruta ya tiene las dos piezas para resolverlo y no se usan: `action:'cancel'`
(`app/api/mp-point/route.ts:96`) y `action:'last-payment'` (`:114`), y el intent viaja con
`external_reference: orderId` (`:45`).

Refutación intentada: el camino feliz SÍ está bien defendido — `MpPaymentRecovery` /
`RECONCILIATION_REQUIRED` (`page.tsx:6540-6568`) cubre el caso "MP aprobó y `handlePayment`
truena". El hueco es anterior: la creación del intent, donde no hay estado de incertidumbre.

**Cómo probar.** En el POS con `mp_access_token` y `mp_device_id` en localStorage, retener la
respuesta de `/api/mp-point` >30 s con un proxy (o matar la red justo después de que salga el
POST, con `navigator.onLine` aún true). Ver que la orden se cierra como "Tarjeta de crédito"
mientras la terminal sigue esperando la tarjeta.

**Fix mínimo.** En ambas ramas de fallo, en vez de `handlePayment(...)`: marcar
`MpPaymentRecovery {state:'UNKNOWN', orderId, amount}`, llamar `action:'last-payment'`
filtrando por `external_reference === orderId` y, si no aparece, `action:'cancel'` sobre el
`deviceId` antes de ofrecer cobro manual. Nunca cerrar la venta sin una de las dos
confirmaciones.

---

### [P0] Token de producción de Mercado Pago guardado en el navegador
`dashboard-app/src/app/pos/page.tsx:6502` · `dashboard-app/src/app/api/mp-point/route.ts:18`
confianza: **0.9**

**Escenario.** El POS lee `localStorage.getItem('mp_access_token')` y lo manda en el body de
cada llamada; la ruta lo acepta como fallback (`const accessToken = process.env.MP_ACCESS_TOKEN || clientToken`).
El mismo patrón está en Clip (`app/api/clip-pinpad/route.ts:18`, `apiKey: clientApiKey`).

Un access token de MP en `localStorage` de una tablet compartida en piso es legible por
cualquiera con DevTools, por cualquier XSS y por cualquier extensión. Ese token cobra,
reembolsa y lista dispositivos de la cuenta completa. Los dos `TODO P0-H/P0-I Phase 2` en los
encabezados dicen que ya se sabía; sigue abierto en `main`.

**Cómo probar.** Abrir el POS en la caja → DevTools → Application → Local Storage →
`mp_access_token`. Con ese valor, `curl` directo a `api.mercadopago.com` funciona sin tocar
Fullsite.

**Fix mínimo.** Quitar el fallback `|| clientToken` / `|| clientApiKey` de las dos rutas (que
devuelvan 503 si no hay env) y borrar la escritura de `mp_access_token` en el cliente,
dejando sólo el `deviceId` (que no es secreto). Rotar el token actual: hay que asumirlo
expuesto.

---

### [P0] Rappi: ACK 200 antes de ingerir, error tragado, sin DLQ ni reintento → la orden se pierde
`dashboard-app/src/app/api/integrations/rappi/webhook/route.ts:68-79` ·
`dashboard-app/src/lib/integrations/rappi/ingest.ts:81,97,147`
confianza: **0.85**

**Escenario.** El webhook contesta `200 {ok:true, accepted:true}` y deja la ingesta en
`after()`. Rappi ya no reintentará. Dentro de `after()`:

```
} catch (e) {
  if (dev) console.log(`[rappi-webhook] ingest-error ...`)   // ← en prod, ni un log
}
```

Cualquier excepción de `processRappiOrder` — `SUPABASE_SERVICE_KEY_REQUIRED`
(`ingest.ts:14`), red caída a PostgREST, `RAPPI_ORDER_INSERT_FAILED_*` (`ingest.ts:147`) —
desaparece sin dejar fila en ninguna tabla. Peor: dos de los tres `return {action:'dlq'}`
**no escriben en la DLQ**; sólo devuelven la palabra:

- `ingest.ts:81` → `RAPPI_ORDER_ID_MISSING`: return seco.
- `ingest.ts:97` → `RAPPI_STORE_ID_MISSING`: return seco.
- `ingest.ts:100-103` → `UNMAPPED_STORE`: éste sí llama `quarantineUnmappedStore`.

Así que un payload con forma inesperada (el `extractOrder` del webhook desenvuelve
`order`/`data` por adivinanza) se traga una orden real de un cliente sin traza alguna.

Refutación intentada: ¿lo rescata el poller? No. `app/api/integrations/rappi/poller/route.ts:66`
tiene `dryRun = body.dry_run !== false` (por omisión **no ingiere**), exige
`INTEGRATION_ADMIN_SECRET` y **no hay cron**: `vercel.json` no declara `crons` y no hay
workflow de poller en `.github/workflows/` (sólo `rappi-cert-sandbox.yml`). El poller es
manual.

**Cómo probar.** Con `RAPPI_WEBHOOK_SECRET` puesto y `SUPABASE_SERVICE_KEY` vacío, mandar un
POST firmado con una orden válida: responde 200 y no aparece nada en `delivery_orders`,
`integration_webhook_dlq` ni el audit log. Segundo caso: firmar un body sin `order_id` → 200,
cero filas.

**Fix mínimo.** (a) En `processRappiOrder`, que los tres caminos `dlq` pasen por un
`quarantine()` generalizado (insert en `integration_webhook_dlq` con su `failure_reason`);
(b) en el `catch` de `after()`, insertar en la DLQ con el body crudo antes de rendirse, y
loguear siempre, no sólo en dev.

---

### [P0] La DLQ no la drena nadie
`dashboard-app/src/lib/integrations/rappi/ingest.ts:54` ·
`dashboard-app/src/app/api/integrations/uber-eats/webhook/route.ts:121,214`
confianza: **0.9**

**Escenario.** `integration_webhook_dlq` recibe escrituras desde tres sitios. La búsqueda de
lecturas en todo el repo (`rg -n "integration_webhook_dlq" -g '!*.md'`) devuelve **sólo**: los
tres escritores, dos tests (`src/__tests__/integrations/category-a.test.ts`,
`webhook-menu-refresh.test.ts`) y las migraciones SQL. **Cero** `GET`, cero ruta de replay,
cero pantalla, cero cron, cero alerta.

Los comentarios del código apuestan la recuperación a esa cola:
`uber-eats/webhook/route.ts:611` — *"quarantined in integration_webhook_dlq for manual replay"*;
`:730-735` — *"must be resolved via DLQ replay"*. El replay manual no existe. Una orden pagada
por el cliente en Uber que cae a la DLQ se queda ahí hasta que alguien consulte la tabla a
mano — y nadie recibe aviso de que hay algo que consultar.

**Cómo probar.** `select count(*) from integration_webhook_dlq;` en prod y contrastar con las
órdenes esperadas. Y buscar cualquier consumidor en el repo: no hay.

**Fix mínimo.** Una ruta admin `POST /api/integrations/dlq/replay` (mismo guardia
`INTEGRATION_ADMIN_SECRET` del poller) que reprocese por `id`, más un contador `dlq_pending`
en el health de integraciones para que deje de ser una cola invisible.

---

### [P1] Uber: el dedup se escribe antes de procesar — el reintento de Uber nunca reprocesa
`dashboard-app/src/app/api/integrations/uber-eats/webhook/route.ts:340-346,396-408`
confianza: **0.8**

**Escenario.** Orden del handler: Step 4 inserta la fila en `integration_webhook_events`
(UNIQUE `provider, provider_event_id`) y **después** Step 5 procesa. Si `handleNewOrder`
truena (Uber API caída al pedir los detalles, PostgREST con 5xx, timeout), el `catch` marca el
evento `failed`, escribe la DLQ, y devuelve **200**. Cuando Uber reintenta el mismo
`event_id`, `upsertWebhookEvent` ve la fila existente y devuelve `isDuplicate: true` →
`"Duplicate event ... — ack without processing"` (`:346`). El reintento del proveedor, que es
la red de seguridad natural, queda anulado por el propio dedup. Combinado con el hallazgo
anterior (nadie drena la DLQ), la orden se pierde de forma definitiva.

Refutación intentada: `handleNewOrder` tiene un fallback si `getOrderDetails` falla — usa
`meta.resource` del sobre (`:544-548`) — así que el caso más común no truena. El agujero queda
para los fallos de persistencia (`throw new Error('Failed to persist order')`, `:555`) y para
cualquier excepción de los otros handlers.

**Cómo probar.** Simular `delivery_orders` no escribible (revocar insert, o apuntar
`NEXT_PUBLIC_SUPABASE_URL` a un host muerto) y mandar dos veces el mismo `orders.notification`
firmado: el primero DLQ + 200, el segundo "Duplicate event" + 200, y `delivery_orders` vacío.

**Fix mínimo.** Que `isDuplicate` sólo corte cuando la fila existente tenga
`status='processed'`; si está en `received`/`failed`, reprocesar (incrementando `attempts`) en
vez de ACKear en falso.

---

### [P1] La cancelación de Uber no retracta el ticket ya inyectado al KDS de Pedro
`electron-app/local-server/index.js:204-227` ·
`dashboard-app/src/app/api/integrations/uber-eats/webhook/route.ts:574-585`
confianza: **0.8**

**Escenario.** El poll de Pedro trae `delivery_orders` con
`status=in.(nueva,aceptada,preparando)` y las inyecta como `ORDER_SENT` con
`command_id: delivery-ingest:<platform>:<platform_order_id>` (idempotente, correcto) y además
imprime por estación. Cuando Uber cancela, `handleCancelledOrder` hace un PATCH a
`status='cancelada'` — con lo cual la fila simplemente **deja de aparecer en la consulta del
poll**. No se emite ningún comando de cancelación al event store local. El ticket ya está
impreso y la orden ya está en la pantalla del KDS: la cocina la sigue preparando.

No existe ningún camino de cancelación en el bridge: todas las apariciones de "delivery" en
`local-server/index.js` son las líneas 65, 73, 82, 85, 96, 102, 204-227 y el `module.exports`.

Agravante en el mismo handler: el PATCH de `handleCancelledOrder` (`:575-583`) no revisa `r.ok`
ni cuántas filas tocó. Si la cancelación llega antes de que la orden se haya persistido
(carrera real: `orders.notification` va a la API de Uber a pedir detalles antes de insertar),
el PATCH afecta 0 filas, se audita como si hubiera funcionado, y luego llega la orden y entra
al KDS **ya cancelada**.

**Cómo probar.** En LAN con Pedro corriendo: insertar una fila en `delivery_orders`
(`platform='ubereats'`, `status='nueva'`), ver el ticket salir; cambiar la fila a
`status='cancelada'` y confirmar que la orden sigue en el KDS tras varios ciclos de 5 s.

**Fix mínimo.** Ampliar la consulta del poll a
`status=in.(nueva,aceptada,preparando,cancelada)` y, para las canceladas, emitir un comando
`ORDER_CANCELLED` con `command_id: delivery-cancel:<platform>:<platform_order_id>` (mismo
patrón idempotente) + ticket de cancelación por estación. Y en el webhook, usar `Prefer:
return=representation` en el PATCH y mandar a DLQ cuando afecte 0 filas.

---

### [P1] Las órdenes de delivery entran al KDS sin `turno_id`
`electron-app/local-server/index.js:73-99` vs `:197-205`
confianza: **0.7**

**Escenario.** `deliveryOrderCommand()` construye el `ORDER_SENT` con `mesa: null`,
`mesero: '🟢 Uber'`… y **sin `turno_id`**. En el mismo archivo, a 100 líneas de distancia, las
órdenes de salón se filtran con rigor por turno:

```
const operationalOrders = activeTurno ? orders.filter(o => o.turno_id === activeTurno.id) : []
```

y hay lógica dedicada a las "huérfanas" con `turno_id` distinto al activo (`:180-195`, barrido
2026-09-10). Las de delivery entran por un carril que no pasa por ninguna de las dos cosas:
**se inyectan aunque no haya turno abierto** (`activeTurno` null no las detiene) y no
pertenecen a ningún turno.

Confirmado: la ausencia de `turno_id` en el comando y la asimetría con el filtro de salón.
**Inferido (no verificado):** que por eso no cuadran en el corte de caja — no seguí la consulta
del corte hasta el final. Verificarlo antes de dimensionar el impacto en dinero.

**Cómo probar.** Con el turno cerrado, insertar una fila `delivery_orders` con
`status='nueva'`: el ticket sale y la orden aparece en el KDS pese a no haber turno. Luego
correr el corte y ver si ese importe aparece.

**Fix mínimo.** Resolver `activeTurno` antes del bloque de delivery y poner
`turno_id: activeTurno?.id` en el comando; si no hay turno activo, no inyectar (o inyectar
marcada, pero nunca sin turno).

---

### [P1] CFDI: carrera de doble timbrado y estado `procesando` irrecuperable
`dashboard-app/src/app/api/factura/timbrar/route.ts:62-71` · `dashboard-app/src/lib/facturama.ts:141`
confianza: **0.8**

**Escenario A — doble timbrado.** El guardia es un *read-then-write* sin condición:

```
if (!['pendiente','error'].includes(row.status)) return 409
await patchRequest(id, { status: 'procesando', error_msg: null })
const result = await stampCfdi(row, paymentForm)
```

Dos POST concurrentes (doble tap del cajero, o el reintento del navegador) leen ambos
`pendiente`, ambos pasan el `if`, ambos llaman a Facturama → **dos CFDI timbrados ante el SAT**
por la misma venta. Es escritura fiscal irreversible: se arregla con cancelación, no con un
`DELETE`.

**Escenario B — respuesta perdida.** `stampCfdi` (`lib/facturama.ts:141`) hace `fetch` sin
timeout, sin reintento y sin clave de idempotencia. Si Facturama timbra pero la respuesta se
pierde, el `throw` cae en el `catch` general (`:95-98`) que devuelve 500 **sin tocar la fila**:
queda en `status='procesando'`, que no está en `['pendiente','error']` → el propio guardia de
la línea 62 impide reintentar, y la UI no tiene ningún camino para ese estado. CFDI emitido
ante el SAT, sin folio fiscal guardado, sin PDF/XML y sin forma de recuperarlo desde el
producto.

**Cómo probar.** (A) Disparar dos POST simultáneos con el mismo `id` (`curl ... & curl ... &`)
contra el sandbox de Facturama: salen dos UUID. (B) Cortar la red justo después del POST a
Facturama y ver la fila quedarse en `procesando` para siempre.

**Fix mínimo.** (A) Convertir el guardia en escritura condicional: `PATCH
pos_cfdi_requests?id=eq.X&status=in.(pendiente,error)` con `Prefer: return=representation`, y
seguir sólo si volvió una fila. (B) Poner `AbortSignal.timeout()` en `stampCfdi` y, en el
`catch` del route, dejar la fila en `status='incierto'` con una acción de conciliación
(consultar el CFDI en Facturama por `Serie/Folio`) en vez de un 500 mudo.

---

### [P1] `/api/mp-point` acepta `paymentId`/`deviceId` del body sin comprobar que sean del tenant
`dashboard-app/src/app/api/mp-point/route.ts:129-151,154-188`
confianza: **0.75**

**Escenario.** `withPOSAuth` verifica que hay una sesión POS válida, pero después la ruta usa
`paymentId` y `deviceId` **tal como vienen del body**, contra el token de MP de la plataforma
(`process.env.MP_ACCESS_TOKEN`). No hay ninguna consulta que ate ese `paymentId` a una orden
del `auth.clientId`. Es decir: cualquier usuario POS autenticado — de **cualquier**
restaurante, en cuanto haya más de uno sobre la misma cuenta de MP — puede reembolsar el pago
de otro (`action:'refund'`, `:129`), cambiar el modo de operación de una terminal ajena
(`action:'change-mode'`, `:169`) o cancelar los intents de un dispositivo ajeno
(`action:'cancel'`, `:96`, que además hace DELETE sobre *la colección* del `deviceId`, no sobre
un intent concreto). El mismo patrón en Clip (`clip-pinpad/route.ts:79-95`).

Choca de frente con §12 del CLAUDE.md ("filtrar explícitamente por tenant, fallar cerrado
cuando no haya mapping").

**Cómo probar.** Con un token POS válido del tenant A, llamar
`{action:'refund', paymentId:<pago del tenant B>}`. Hoy no hay nada que lo impida.

**Fix mínimo.** Antes de `refund`/`cancel`/`change-mode`, resolver el `paymentId`/`deviceId`
contra una tabla por `client_id` (`pos_payments` / la config de terminales del tenant) y
devolver 403 si no pertenece.

---

### [P2] Rappi: el descubrimiento de formatos de firma está activo por omisión en producción
`dashboard-app/src/app/api/integrations/rappi/webhook/route.ts:12,39,41-46` ·
`dashboard-app/src/lib/integrations/rappi/signature.ts:98-105`
confianza: **0.8**

**Escenario.** `const isDev = () => (process.env.RAPPI_ENV || 'dev').toLowerCase() !== 'prod'`.
El default es *dev*. Si `RAPPI_ENV` no está puesta en Vercel — y el código no lo exige en
ningún lado — producción corre con `allowFormatDiscovery: true`, que acepta **cuatro**
construcciones de firma distintas, incluida `HMAC(body)` sin timestamp (`signature.ts:102`).
El comentario del propio archivo dice lo contrario: *"En prod la firma se valida con UN solo
formato (determinístico)"*. Además, en ese modo se loguea el header de firma recortado
(`webhook:44`), que es material sensible en logs.

Atenúa el riesgo que las cuatro variantes siguen exigiendo `RAPPI_WEBHOOK_SECRET`, y que el
chequeo anti-replay del timestamp (`signature.ts:95`) corre antes en todos los casos. Por eso
P2 y no P1.

**Cómo probar.** `vercel env ls` para confirmar si `RAPPI_ENV` existe en production. Si no
está, el modo dev está vivo en prod.

**Fix mínimo.** Invertir el default: `(process.env.RAPPI_ENV || 'prod')`, y quitar el header de
firma del log.

---

### [P2] La ruta legacy de Uber sigue desplegada, sin dedup ni DLQ ni mapeo de tenant
`dashboard-app/src/app/api/webhook/ubereats/route.ts:1-4,25`
confianza: **0.7**

**Escenario.** El propio encabezado lo dice: *"DEPRECATED … lacks: deduplication, DLQ,
correlation IDs, audit log, multi-tenant mapping. It must not receive new Uber traffic."* Pero
el archivo está en `main` y por lo tanto la URL responde. Mientras exista, la consola de Uber
puede seguir apuntando ahí (o volver a hacerlo tras un cambio de configuración) y las órdenes
entrarían por un camino sin idempotencia de evento: el reintento de Uber, que v2 deduplica,
aquí se reprocesa. Usa además `SUPABASE_SERVICE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY` (`:25`) —
con la anon key, tras el lockdown de RLS, escribe 0 filas y nadie se entera.

No pude confirmar desde el repo a qué URL apunta hoy la consola de Uber: eso lo sabe Daniel o
está en el dashboard de Uber. Sin ese dato el hallazgo es "ruta viva que no debería estar", no
"doble orden confirmada".

**Cómo probar.** Revisar en Uber Developer Console la URL del webhook. Si es
`/api/webhook/ubereats`, sube a P0 inmediato.

**Fix mínimo.** Borrar la ruta, o dejarla devolviendo 410 con un `console.error` ruidoso para
que cualquier tráfico residual sea visible en vez de silencioso.

---

## Descartados

- **`lib/integrations/uber-eats/delivery-store.ts`** — lo revisé completo por el encargo
  explícito. Está bien hecho: `withRetry(maxAttempts 3, baseDelayMs 500)` en las cuatro
  llamadas, `auditLog` con `status_code` y `duration_ms` en éxito y en fallo, y los enums de
  lectura/escritura documentados con evidencia de runs reales. Sin hallazgo.
- **Dedup de `delivery_orders`** — tanto Uber (`webhook:262-265`, `Prefer:
  resolution=ignore-duplicates` sobre `(platform, platform_order_id)`) como Rappi
  (`ingest.ts:140-144`, mismo patrón) son idempotentes de verdad a nivel DB. El riesgo de doble
  orden por reintento del proveedor **no** existe en la persistencia; los problemas están antes
  (el ACK) y después (el KDS).
- **`command_id` del bridge de Pedro** — `delivery-ingest:<platform>:<order>` y
  `delivery-print:<platform>:<order>:<station>` son estables entre polls y entre reinicios, tal
  como dice el comentario. Verificado; no reimprime.
- **Resolución de tenant en los webhooks** — ni Uber ni Rappi aceptan `client_id` del body: los
  dos lo resuelven contra `integration_store_mappings` y fallan cerrado si no hay mapeo
  (`webhook:334-339`, `ingest.ts:99-103`). El "tenant tomado del body" que buscaba no está.
- **Anti-replay de Rappi** — la ventana de 5 min sobre el timestamp firmado
  (`signature.ts:90-95`) existe y corre antes de comparar la firma. Correcto.
- **`providerEventId` con fallback `${eventType}:${orderId}`** (`webhook:328`) — sospeché que un
  evento sin `event_id` ni `resource_id` (p. ej. `store.status.changed`) generaría siempre la
  misma clave y quedaría deduplicado para siempre, congelando el estado abierto/cerrado de la
  tienda. No pude confirmar qué manda Uber realmente en `meta.resource_id` para esos eventos,
  así que se queda por debajo del umbral de confianza. Vale la pena mirarlo con un payload real
  de la consola de Uber.
- **`handleScheduledOrder` persiste como `'nueva'` y luego hace PATCH a `'programada'`**
  (`webhook:452-480`) — huele mal: el poll de Pedro corre cada 5 s, la ventana entre INSERT y
  PATCH es real, y si el PATCH falla (no revisa `r.ok`) la orden programada se queda `'nueva'`
  para siempre, que es exactamente lo que el comentario dice evitar. Fuera de la lista principal
  porque no medí la ventana ni reproduje el fallo del PATCH; si alguien toma el P1 del
  `turno_id`, que revise esto en el mismo viaje.
- **Resend** — lo único que toca el camino de integraciones dentro de esta lente es
  `emailCfdi()` (`factura/timbrar/route.ts:86`), que es best-effort declarado y cuyo fallo no
  altera el estado fiscal. Sin hallazgo propio.
