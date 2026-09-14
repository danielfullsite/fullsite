# Barrido 3 — Permisos y roles con enforcement en servidor

Worktree: `wt-merge/wt-barrido3` = `origin/main` `f9f8965c`.
Lente: acciones sensibles del POS validadas sólo en cliente, o ejecutables con un
POST directo usando un shift token de **mesero** (nivel 1).

Cadena verificada en todos los casos: el interceptor del cliente
(`lib/supabase-fetch-patch.ts`) reescribe `${SUPABASE_URL}/rest/v1/*` →
`/api/pos/db/rest/v1/*` con el shift token, así que **toda terminal de kiosco escribe
por el proxy**, que corre con `SUPABASE_SERVICE_KEY` y se salta RLS. Lo único que
separa a un mesero de un gerente en ese camino es `lib/pos-db-policy.ts`.

---

### [P0] `pos_turnos` no protege sus columnas de dinero — un mesero cuadra el arqueo del turno

`dashboard-app/src/lib/pos-db-policy.ts:156` (`CAMPOS_SOLO_DE_GERENTE`) ·
`dashboard-app/src/lib/pos-db-policy.ts:119` (`NIVEL_MINIMO_DE_ESCRITURA`)
**confianza: 0.85**

`CAMPOS_SOLO_DE_GERENTE` sólo tiene una entrada: `pos_orders`. `pos_turnos` **no**
está en `MANAGER_ONLY_WRITE` ni en `NIVEL_MINIMO_DE_ESCRITURA` (deliberado: el cierre
se encola y lo reproduce un cajero, `pos-db-policy.ts:174-195`). Lo único que se
prohíbe a un rol bajo sobre esa tabla es **poner `closed_at` en `null`**
(`REABRIR_SOLO_GERENTE`, verificado en `intentaReabrir`, línea 198). Cualquier otra
columna pasa: `camposProhibidos` hace `if (!vetadas) continue` (línea 220) y devuelve
sólo la marca de reapertura.

Las columnas reales de `pos_turnos` son de caja, confirmadas en el payload de cierre —
`components/pos/CierreCajaWizard.tsx:378-385`: `closed_by`, `fondo_final`,
`efectivo_sistema`, `diferencia`, `closed_at`, `notas`; más `fondo_inicial` y
`opened_by` (`app/pos/monitor/page.tsx:126`).

**Escenario**
1. Un mesero se loguea con su PIN → shift token `rol:"mesero"` (`/api/pos/pin`).
2. Saca $2,000 del cajón durante el turno.
3. `PATCH /api/pos/db?path=pos_turnos?id=eq.<turno>` con
   `{"efectivo_sistema": <esperado-2000>, "diferencia": 0}`.
4. `puedeEscribirEn('pos_turnos','mesero')` → `true` (no está en ninguna lista).
   `camposProhibidos` → `[]` (no hay `closed_at:null`). El proxy estampa
   `client_id=eq.<su tenant>` y manda el PATCH con service_role.
5. El Corte Z sale con diferencia $0. El faltante desapareció del arqueo.

Variante del mismo hueco: `{"fondo_inicial": 999999}` al abrir, o
`{"closed_at": "<fecha>", "closed_by": "Eduardo"}` para **cerrar a la fuerza el turno
de otro** y firmarlo con el nombre del gerente.

**Cómo probar**
```
# con un shift token de rol mesero
curl -X PATCH 'https://<host>/api/pos/db?path=pos_turnos%3Fid%3Deq.<TURNO_ID>' \
  -H "Authorization: Bearer <SHIFT_TOKEN_MESERO>" \
  -H 'Content-Type: application/json' \
  -d '{"efectivo_sistema":1,"diferencia":0}'
# esperado hoy: 200/204 y la fila cambiada. Esperado tras el fix: 403.
```
Prueba de regresión hermana ya existe para `pos_orders`:
`dashboard-app/src/__tests__/proxy-no-deja-tocar-el-dinero.test.ts`.

**Fix mínimo** — una entrada más en el mapa que ya existe, sin tocar el flujo del
cierre (que escribe estas columnas **junto con** `closed_at` con fecha, así que hay
que dejar pasar al cajero, igual que `NIVEL_MINIMO_DE_ESCRITURA`):

```ts
// pos-db-policy.ts — CAMPOS_SOLO_DE_GERENTE
pos_turnos: ['fondo_inicial', 'opened_by', 'client_id', 'id'],
```
y para las columnas del cierre (`fondo_final`, `efectivo_sistema`, `diferencia`,
`closed_by`), gatearlas por nivel **cajero** en vez de por gerente — mismo patrón que
`NIVEL_MINIMO_DE_ESCRITURA` — porque el cierre encolado las escribe con rol `cajero`.
Un mesero no debe poder tocar ninguna.

---

### [P0] `DELETE` sólo está gateado en `pos_orders` — un mesero borra la bitácora antifraude

`dashboard-app/src/lib/pos-db-policy.ts:164` (`MANAGER_ONLY_DELETE`) ·
`dashboard-app/src/app/api/pos/db/route.ts:53` ·
`dashboard-app/src/app/api/pos/db/[...path]/route.ts:107`
**confianza: 0.8**

`MANAGER_ONLY_DELETE = new Set(['pos_orders'])`. Para el resto de las 33 tablas de
`ALLOW`, un `DELETE` sólo pasa por `puedeEscribirEn`, que para las tablas operativas
devuelve `true` con cualquier rol. Y el cuerpo de un DELETE es vacío, así que
`prepararCuerpoProxy` sale en la primera línea (`if (!raw) return { body: undefined }`,
línea 286) sin evaluar nada: `camposProhibidos` **nunca corre en un DELETE**.
`scopedProxyRequest` devuelve `null` para DELETE en tablas normales
(`pos-db-scoped.ts:13`), o sea que cae al REST directo con service_role.

Tablas que un **mesero** puede borrar hoy: `pos_audit_log`, `pos_turnos`, `pos_mesas`,
`pos_attendance`, `pos_staff_shifts`, `pos_save_operations`, `pos_print_jobs`,
`pos_customers`, `pos_sessions`. Un **cajero** además: `pos_cierres` y
`pos_cash_movements` (les basta nivel 2 para escribir → también para borrar).

El peor es `pos_audit_log`: es exactamente donde caen `order_reopened`,
`skimming_suspect`, `market_adjust_below_role` y `legacy_no_approval` — toda la
evidencia que los flags en modo *grace* están recolectando. Borrarla deja los gates de
grace sin su única salida.

Peor aún, el mismo camino permite **PATCH** sobre `pos_audit_log` con cualquier rol
(no está en `CAMPOS_SOLO_DE_GERENTE`): reescribir `actor` y `details` de una entrada
ajena, o sea falsificar la bitácora en vez de borrarla.

**Escenario**
1. Mesero reabre una cuenta pagada con `offline_approved:true` (ver hallazgo P1 abajo).
   `reopen-order/route.ts:46` escribe `order_reopened` en `pos_audit_log`.
2. `DELETE /api/pos/db?path=pos_audit_log?action=eq.order_reopened` con su shift token.
3. El proxy añade `client_id=eq.<su tenant>` y manda el DELETE. El único predicado
   restante es el que puso el atacante: se lleva **todas** las reaperturas del tenant.
4. `pos_cierres` intacto, arqueo cuadrado, cero rastro.

**Cómo probar**
```
curl -X DELETE 'https://<host>/api/pos/db?path=pos_audit_log%3Faction%3Deq.order_reopened' \
  -H "Authorization: Bearer <SHIFT_TOKEN_MESERO>"
# esperado hoy: 204 y filas borradas. Esperado tras el fix: 403.
curl -X PATCH 'https://<host>/api/pos/db?path=pos_audit_log%3Fid%3Deq.<ID>' \
  -H "Authorization: Bearer <SHIFT_TOKEN_MESERO>" -H 'Content-Type: application/json' \
  -d '{"actor":"otro"}'
```

**Fix mínimo** — dos listas en `pos-db-policy.ts`, aplicadas en los dos proxies (que ya
comparten las funciones, así que basta tocar la política):

```ts
/** Bitácoras: se agregan, nunca se corrigen ni se borran desde una terminal. */
export const APPEND_ONLY = new Set(['pos_audit_log', 'pos_save_operations'])
// en el handler, antes de escribir:
if ((method === 'PATCH' || method === 'DELETE') && APPEND_ONLY.has(table)) return 403

// y ampliar el gate de borrado a todo lo que sostiene el arqueo:
export const MANAGER_ONLY_DELETE = new Set([
  'pos_orders', 'pos_turnos', 'pos_cierres', 'pos_cash_movements',
  'pos_attendance', 'pos_staff_shifts', 'pos_mesas',
])
```
Regla de fondo, para no repetir el patrón: en el proxy, **DELETE debería ser
gerente-only por defecto** y la lista debería ser de excepciones, no de prohibiciones.
Hoy cada tabla nueva que se agregue a `ALLOW` nace borrable por un mesero.

---

### [P1] `offline_approved: true` es una afirmación del cliente — un mesero reabre una cuenta pagada y cancela un platillo servido

`dashboard-app/src/lib/manager-approval.ts:63-70` ·
`dashboard-app/src/app/api/pos/reopen-order/route.ts:25` ·
`dashboard-app/src/app/api/pos/cancel-item/route.ts:56-64`
**confianza: 0.95** · **conocido y documentado** (OP-02 / OP-03 en
`docs/state/OPEN-ITEMS.md:85-86`; el propio archivo lo explica en `manager-approval.ts:18-46`)

Se reporta porque sigue vivo en `main` y porque el lente lo pide explícitamente. El
orden de evaluación es el problema: la rama `offline_approved === true` va **antes**
del `else if (POS_APPROVAL_STRICT)`, así que prender el flag **no cierra este vector** —
sólo bloquea a quien no manda ningún campo. Lo mismo en `cancel-item` con
`CANCEL_APPROVAL_STRICT`.

**Escenario**
```
POST /api/pos/reopen-order          Authorization: Bearer <SHIFT_TOKEN_MESERO>
{"order_id":"<orden pagada>","offline_approved":true,"manager":"Eduardo"}
→ 200 {ok:true}; status→'enviada', closed_at→null, metodo_pago→null
```
El mesero edita la cuenta, la recierra por menos, y se queda la diferencia. Queda una
entrada con `approval_mode:"offline_device_trust:mesero"` y `revisar:true`
(`apruebaSospechosa`) — que, por el hallazgo anterior, el mismo mesero puede borrar.

**Fix mínimo** (el archivo ya explica por qué el obvio rompe el offline): prueba
firmada por dispositivo — llave provisionada con red, `HMAC(llave, order_id + gerente +
timestamp)` verificable al drenar la cola. Mientras tanto, lo barato y no-destructivo:
aplicar el bloqueo de `POS_APPROVAL_STRICT` también a la rama offline **cuando la
petición no viene del replay de la cola** (marcar el replay con una cabecera propia en
`pos-offline-db.ts`), para que el POST forjado en vivo sí se bloquee y la cancelación
sin WAN siga pasando.

---

### [P1] Ajuste de inventario y merma: el gate existe pero está en *grace*, y el flag no está puesto

`dashboard-app/src/app/api/pos/adjust-market/route.ts:30` ·
`dashboard-app/src/app/api/pos/recipe-sync/route.ts:74` ·
`dashboard-app/src/lib/api-auth.ts:161-171`
**confianza: 0.9** · **conocido** (OP-39)

`checkPosRole(auth, POS_ROLE_LVL.gerente, 'MARKET_ROLE_STRICT')` devuelve
`{ok:true, mode:'below_role:mesero'}` cuando el env no vale `'true'`. Grepeado el repo
completo: `MARKET_ROLE_STRICT` **no aparece en ningún `.env*`, `vercel.json` ni
runbook** — los otros dos flags sí están documentados
(`docs/security/FRAUD-ENFORCEMENT-FLAGS.md`), éste ni eso. O sea: hoy un mesero registra
merma y `ajuste_absoluto` de stock, y edita recetas vía `recipe-sync`. Sólo se audita.

**Cómo probar**: `POST /api/pos/adjust-market` con shift token de mesero y
`{"adjustment_type":"merma", ...}` → hoy `200` + una fila
`market_adjust_below_role` en `pos_audit_log`.

**Fix mínimo**: `MARKET_ROLE_STRICT=true` en Vercel tras revisar que el log no muestre
`below_role:*` legítimos, y agregarlo a `FRAUD-ENFORCEMENT-FLAGS.md` con los otros dos.
A diferencia de cancel/reopen, este camino **no** se encola offline, así que un 403 aquí
no se vuelve terminal en la cola — es el flag más barato de voltear de los tres.

---

### [P2] `manager-approval.ts` no conoce el rol `dueño` — el dueño no puede autorizar

`dashboard-app/src/lib/manager-approval.ts:16`
**confianza: 0.75**

```ts
const ROLE_LVL = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }  // sin 'dueño'
```
`POS_ROLE_LVL` en `api-auth.ts:148` **sí** lo tiene (`dueño: 6`), y el comentario de
arriba dice explícitamente por qué se agregó: «sin él, `checkPosRole` trataba a los
dueños como nivel 0 → en strict los bloqueaba y en grace los marcaba como `below_role`
(falsos eventos de fraude)». Ese fix (`2185cb92`, citado en `OPEN-ITEMS.md:168`) se
aplicó a un mapa y no al otro. `transfer-item/route.ts:19` sí incluye `'dueño'` en su
lista, lo que confirma que un shift token puede traer ese rol
(`/api/pos/pin` lo toma de `pos_staff.role`, líneas 151 y 171).

**Escenario** — el único camino hoy **strict desde el día uno**
(`save-order/route.ts:391-402`): un dueño teclea su PIN para autorizar un rebase de
conflicto. `ROLE_LVL['dueño'] || 0` → `0 < 4` → `mode` no arranca con `'online:'` → **403
`MANAGER_APPROVAL_REQUIRED`**. El dueño no puede resolver el conflicto; nadie con rol
menor tampoco. Además `apruebaSospechosa` marca `revisar:true` cada vez que un dueño
aprueba offline → falsos positivos en el detector antifraude.

**Cómo probar**: fila en `pos_staff` con `role='dueño'` → PIN → usar ese
`approval_token` en `POST /api/pos/save-order` con `conflict_resolution:true`.
Depende de que exista al menos un `pos_staff.role='dueño'` en producción — **no
verificado contra la BD** (fuera del alcance de sólo-lectura de este barrido).

**Fix mínimo**: importar el mapa en vez de duplicarlo.
```ts
import { POS_ROLE_LVL as ROLE_LVL } from '@/lib/api-auth'
```
(`cancel-item/route.ts:54` tiene una **tercera** copia del mismo literal — mismo
problema, mismo fix.)

---

## Descartados

| Candidato | Por qué no es hallazgo |
|---|---|
| `/api/pos/caja/materialize` sin `withPOSAuth` | Deliberado y correcto: la autorización es la credencial de stream que verifica el SQL (`apply_pos_caja_event`), y la ruta valida forma de `p_stream_id`/`p_credential`/hashes antes de pasar. No se envía service key a la terminal. |
| `/api/platform/terminal-claim` sin `requirePlatformAdmin` | Deliberado: la autorización **es** el código de enrolamiento (base64url de 24 bytes, hasheado, un solo uso, canje atómico con `claimed_at=is.null`). La terminal no elige ni el código ni la identidad. Falla cerrado con mensaje genérico. |
| `/api/pos/kitchen` sin `withPOSAuth` | Lectura de KDS con su propio token; no es superficie de rol. No se auditó a fondo — fuera del lente. |
| Rutas `/api/platform/**` | Las 29 restantes usan `requirePlatformAdmin`; `act-as` y las de escritura llevan además 2FA (`platform-auth.ts:79`). Sin hallazgo. |
| `withPOSAuth` confiando en `x-fullsite-tenant` | El header sólo **sugiere**; se honra sólo si hay membresía real (`api-auth.ts:110-111`) y se rechaza si contradice el `cid` del shift token (línea 70). Falla cerrado con multi-membresía sin header. Correcto. |
| `pos_staff` escribible por rol bajo | Cerrado: `MANAGER_ONLY_WRITE` lo incluye y `REDACTED_COLUMNS` tapa el `pin` en la salida; `consultaProxyValida` bloquea además filtrar por `pin`. |
| `pos_menu_items` (cambiar precio) | Cerrado: está en `MANAGER_ONLY_WRITE`. |
| `transfer-item` | Estricto y correcto: exige `approval_token` firmado de `capitan`+ del mismo tenant, sin rama de grace (`transfer-item/route.ts:18-19`). |
| `merge-orders` sin gate de rol | El total se **recomputa** server-side desde las órdenes en BD (`merge-orders/route.ts:37-45`); juntar mesas es operación de mesero por diseño (`juntar_mesas` en el perfil). El descuadre se audita como `skimming_suspect`. Riesgo bajo. |
| `deduct-market` / `inventory/reconcile` sin rol | Camino de venta/reconciliación disparado por una orden confirmada, no administrativo. Coincide con lo dictaminado en OP-39. |
| RPC por el proxy catch-all | Cerrado con `return` temprano (`[...path]/route.ts:82-90`), antes de cualquier otra comprobación. Bien diseñado. |
| `POST` con `client_id` ajeno en el cuerpo | Cerrado: `prepararCuerpoProxy` borra el `client_id` del cliente y estampa el del token (líneas 299-306); PATCH rechaza `id`/`client_id` de plano. |
| `pos_cash_movements` / `pos_cierres` bajados a nivel cajero | Decisión razonada y documentada (`pos-db-policy.ts:87-115`): un 403 aquí se clasifica terminal en el replay de la cola y el dinero del turno no sube nunca. El mesero sigue bloqueado. Correcto — salvo por el `DELETE`, que sí se reporta arriba. |
