# Plan — hashear los PIN de `pos_staff`

> **Estado: PROPUESTO. No implementado, no aplicado.** Nada de este documento tocó la base.
> Todo lo que se consultó fue `SELECT` por el MCP read-only, y el MCP se queda read-only.
> Levantado el 2026-09-14. Requiere aprobación de Daniel antes de la Fase 0.

Documento hermano: [`MIGRACION-PINS.md`](MIGRACION-PINS.md) — ése mide la migración de
**longitud** (4 → 10 dígitos). Éste cambia el **almacenamiento**. Son ejes distintos y
ninguno reemplaza al otro: un PIN de 10 dígitos en claro sigue en claro, y un PIN de 4
dígitos hasheado sigue siendo adivinable en línea.

---

## 1. El hallazgo, con su consulta

`pos_staff.pin` es `text NOT NULL` con `CHECK (pin ~ '^[0-9]{4,10}$')`
(`supabase/migrations/00000000000000_baseline_esquema.sql:4017,4025`). No hay columna
`pin_hash`; se verificó contra `information_schema.columns` el 2026-09-14.

Censo del mismo día (la consulta nunca imprime un PIN):

```sql
select client_id, count(*) personas,
       count(*) filter (where pin ~ '^[0-9]{4}$')  pin4,
       count(*) filter (where pin ~ '^[0-9]{10}$') pin10,
       count(distinct pin) pins_distintos
from pos_staff group by client_id order by 2 desc;
```

| client_id | personas | pin4 | pin10 |
|---|---|---|---|
| amalay | 40 | 40 | 0 |
| boruca | 7 | 7 | 0 |
| carls-jr | 6 | 6 | 0 |
| esqueleton-demo | 6 | 6 | 0 |
| demo / diezmex-demo / scyf-demo | 5 c/u | 5 | 0 |
| chickin-demo / coffee-shop | 3 c/u | 3 | 0 |
| tekila-rg | 3 | 0 | 3 |
| test_noreste_grill | 1 | 1 | 0 |

**84 filas en total, 81 con PIN de 4 dígitos.** De paso queda medida
[`MIGRACION-PINS.md`](MIGRACION-PINS.md): su línea base del 2026-08-26 decía *0 de 40
migrados en AMALAY*, y hoy, 19 días después, **sigue en 0 de 40**.

### Quién puede leer los PIN hoy

| Vía | ¿Lee los PIN? | Evidencia |
|---|---|---|
| MCP `supabase-amalay` | **Sí, los 84, de los 11 tenants** | conecta como `supabase_read_only_user`, con `rolbypassrls = true` |
| `service_role` | Sí | `rolbypassrls = true`; es la llave de las rutas de servidor |
| `postgres` (dueño de la tabla) | Sí | `relrowsecurity = true` pero `relforcerowsecurity = false` → el dueño no pasa por RLS |
| `authenticated` del tenant | **Sí, los de su restaurante** | política `pos_staff_sel` con `private.user_has_client_access(client_id)` — cualquier usuario con fila en `client_users` puede pedirlos por PostgREST con su propio JWT |
| `anon` | No | tiene `GRANT SELECT` a nivel tabla (ACL `anon=rDxtm`) pero **ninguna política RLS** y `rolbypassrls = false` → 0 filas |
| `fullsite_readonly` / `fullsite_agent` | No | mismo caso: grant sin política, sin bypass |

Usuarios de dashboard que hoy pueden leer los PIN de su propio restaurante sin tocar la
base — sólo abriendo `/equipo`:

| client_id | usuarios en `client_users` |
|---|---|
| amalay | 4 |
| nomada | 3 |
| carls-jr / demo / diezmex-demo | 2 c/u |
| otros 6 tenants | 1 c/u |

> **Consecuencia que hay que decir en voz alta:** hashear la columna **no des-expone** los
> 84 PIN actuales. Ya fueron legibles por el token del MCP — y ese token ya estuvo expuesto
> una vez. Después del corte hay que **rotarlos**, y esa rotación es una campaña aparte con
> su propio riesgo offline (§6, R2).

---

## 2. La restricción que decide el diseño

`/api/pos/pin` **no compara** un PIN: lo **busca**.

```
dashboard-app/src/app/api/pos/pin/route.ts:165
  pos_staff?pin=eq.<pin>&active=eq.true&client_id=eq.<tenant>&select=id,name,role&limit=1
```

No hay usuario. El mesero teclea 4 dígitos y el PIN **es** la identidad. Eso lo respalda el
índice `unique_pin_per_client UNIQUE (pin, client_id)`
(`baseline_esquema.sql:5998`), que es lo que garantiza que la búsqueda devuelva una persona
y no dos.

Eso descarta el esquema obvio:

| Opción | Por qué no |
|---|---|
| bcrypt/scrypt con sal por fila | Sin usuario no hay fila que buscar. Habría que traer las 40 filas del tenant y correr el KDF contra cada una: 40 × ~100 ms ≈ **4 s por login**, dentro de un timeout de Pedro de 5 s (`actor-authority.js:68`). Inviable. |
| SHA-256 sin sal | Determinista y buscable, pero 10^4 combinaciones se revientan en microsegundos con la tabla en la mano. Equivale a texto plano. Es, literalmente, lo que ya hace `/api/pos/staff-cache` (§7, C1). |
| Identificar primero, PIN después | Es la respuesta correcta a largo plazo y habilita sal por fila. Pero cambia la pantalla de bloqueo que la plantilla usa cientos de veces al día y reabre T-24 de forma mucho más seria. **Fase 7, no ahora.** |

### Esquema propuesto: HMAC con pimienta del servidor

```
pin_hash = hex( HMAC-SHA256( key = POS_PIN_PEPPER_v1, msg = client_id || ':' || pin ) )
pin_hash_v = 1
```

- **Determinista** → la búsqueda sigue siendo un índice, un solo round-trip, sin cambio de latencia.
- **`client_id` dentro del mensaje** → el mismo PIN en dos restaurantes da dos hashes distintos.
  No se puede correlacionar entre tenants y el índice único por tenant conserva su significado.
- **La pimienta vive sólo en el entorno de Vercel**, nunca en la base, nunca en el repo, nunca
  en un respaldo de Postgres. Mismo radio de explosión que `SUPABASE_SERVICE_KEY`.
- **`pin_hash_v`** existe desde el día uno para poder rotar la pimienta sin adivinar qué filas
  usan cuál.

**Lo que esto compra:** una lectura de la base —el MCP, un dump, un respaldo, el JWT de un
gerente, una fuga de RLS como la de `ops_consumo`— deja de entregar credenciales usables.

**Lo que NO compra, dicho sin adornos:**

1. Si se fugan la base **y** la pimienta juntas, 10^4 con HMAC se revientan al instante.
   La pimienta es toda la seguridad del esquema.
2. No protege contra adivinar en línea. Eso es `pin-throttle.ts`, y no cambia.
3. No arregla el espacio de 4 dígitos. Con 40 PIN ocupados de 10,000, un intento a ciegas
   le pega **a alguien** el 0.4 % de las veces. Eso es [`MIGRACION-PINS.md`](MIGRACION-PINS.md).
4. **Después de la Fase 6 la pimienta es irremplazable sin rotar los 84 PIN**, porque ya no
   existe el texto de dónde recalcular. Rotar pimienta = rotar PIN. Diseñado, no accidental.

---

## 3. Inventario completo de superficies

La lista del planteamiento original tenía 5 puntos. El barrido (`rg 'pin=eq\.'`,
`rg "select=[^&]*\bpin\b"`, `rg 'pos_staff'`) encontró **9**. Dos no estaban y uno ya está resuelto.

### Verificadores — leen el PIN para decidir quién entra

| # | Archivo | Qué hace | Fase |
|---|---|---|---|
| V1 | `dashboard-app/src/app/api/pos/pin/route.ts:165` | El verificador. Busca por `pin=eq.` | F4 |
| V2 | `dashboard-app/src/app/api/pos/time-clock/route.ts:44` | **No estaba en la lista.** El checador identifica por `pin=eq.` | F4 |
| V3 | `dashboard-app/src/app/api/owner/staff/route.ts:55` | `pinTaken()` — busca por `pin=eq.` para el índice único | F4 |
| V4 | `mobile-app/src/screens/LoginScreen.tsx:28-33` | **No estaba en la lista.** Consulta `pos_staff` con la llave anon y `'amalay'` hardcodeado. Ver §7, C3 | F4, decisión aparte |

### Escritores — ponen el PIN en la base

| # | Archivo | Fase |
|---|---|---|
| E1 | `api/owner/staff/route.ts:124` (POST) y `:168` (PATCH) — el camino real de `/equipo` y `/pos/staff` | F2 |
| E2 | `api/platform/staff/route.ts:43` (PATCH) — admin de plataforma | F2 |
| E3 | `lib/provision-tenant.ts:242-256` — siembra de tenant nuevo, `randomPin10()` | F2 |

`supabase/migrations/PENDIENTE_20260910070000_tenant_provisioning_atomic.sql:51` **no
escribe** PIN: sólo comprueba `pin ~ '^[0-9]{4,10}$'` para decidir `staff_setup_required`.
Ese predicado cambia en F5.

### Exposiciones — mandan el PIN en claro fuera de la base

| # | Archivo | Fase |
|---|---|---|
| X1 | `api/owner/staff/route.ts:82` → `select=...,pin,...` → `equipo/page.tsx:195` lo revela con un ojito | F5 |
| X2 | `api/platform/staff/route.ts:23` → `platform/staff/page.tsx:107` lo pinta en un input editable | F5 |
| X3 | `api/pos/staff-cache/route.ts:11-16,37` — hash con sal estática, sin consumidor. Ver §7, C1 | **F4, borrar** |

### Ya resuelto — los tres verificadores offline

**Ninguno de los tres guarda el PIN en claro, y ninguno lee `pos_staff`.** Esto es el
hallazgo que cambia la forma del plan; se desarrolla en §6.

| Almacén | Dónde | Qué guarda |
|---|---|---|
| `pos_staff_cache` | `pos/layout.tsx:612-617` | `SHA-256(pin + ':' + staffId)` — función en `:24-31` |
| `pos_manager_credentials_v2` | `lib/pos-manager-auth.ts:143-160` | `PBKDF2(pin, salDelDispositivo, 10k)` |
| `actor-credentials.json` (Pedro) | `local-server/core/actor-authority.js:180-185` | `scryptSync(pin, sal, 32)` + índice `HMAC(clave local, 'pin:'+pin)` en `:122` |

---

## 4. Las fases

### F-1 — Prerrequisito, PR aparte: arreglar la rama de falla del login

`pos/layout.tsx` trata `429` y `5xx` como PIN equivocado y bloquea la terminal al 5º intento
sin mirar el almacén local (§7, C6). Es un bug preexistente y **no es parte de esta
migración** —va en su propio PR, un P0 por rama— pero **F4 no se despliega sin él**, porque es
lo que convierte una pimienta mal puesta en "el restaurante no abre" (§6.2, R1).

### F0 — Preparación. No toca datos, no toca prod.

- `dashboard-app/src/lib/pos-pin-hash.ts` con `hashPinParaBD(clientId, pin)`.
- **Falla CERRADO:** si `POS_PIN_PEPPER` no está, `throw`. Nunca un fallback a texto plano.
- El error debe viajar como **`503` con `code: 'authority_unavailable'`**, no como `500`.
  Razón en §6, R1: Pedro clasifica `{400,401,403}` como "PIN rechazado" y todo lo demás como
  "autoridad caída" (`actor-authority.js:165-173`). Un `500` mal clasificado no rompe nada,
  pero un `401` sí borraría la credencial preparada (`:170`). Que sea 503 es requisito, no nota.
- Pimienta: 32 bytes aleatorios en hex, en el entorno de Vercel (prod **y** preview, y deben
  ser **la misma** o el backfill de F3 y la lectura de F4 no empatan).
- Pruebas: determinismo; dos tenants con el mismo PIN dan hashes distintos; sin pimienta lanza.

**Impacto offline: ninguno.** **Reversible:** borrar el archivo.

### F1 — DDL aditiva

```sql
alter table public.pos_staff add column if not exists pin_hash   text;
alter table public.pos_staff add column if not exists pin_hash_v smallint;

create unique index if not exists pos_staff_pin_hash_unico
  on public.pos_staff (client_id, pin_hash) where pin_hash is not null;
create index if not exists pos_staff_pin_hash_busqueda
  on public.pos_staff (pin_hash) where pin_hash is not null;
```

Sin `concurrently`: son 84 filas, el lock es de microsegundos, y `concurrently` no corre
dentro de la transacción en la que el runner envuelve las migraciones.

Agregar una columna **no** resetea grants (eso pasa con `create or replace view`, ver
[`feedback_migracion_leer_archivo_completo`]). Pero `anon` tiene `GRANT SELECT` a nivel
tabla y ese grant cubre columnas nuevas. Hoy no le sirve de nada —no tiene política RLS—;
aun así vale revocar por columna en esta misma migración:

```sql
revoke select (pin, pin_hash) on public.pos_staff from anon;
```

**Impacto offline: ninguno.** Ningún código lee la columna todavía.
**Reversible:** `drop column` (nadie escribió nada).

### F2 — Doble escritura

E1, E2 y E3 calculan y escriben `pin_hash` + `pin_hash_v = 1` junto al `pin` de siempre.
Los lectores **no** cambian: `pin` sigue siendo la autoridad.

**Impacto offline: ninguno.**
**Reversible:** revertir el deploy. `pin_hash` queda con filas de más, inofensivas.

### F3 — Backfill

Script de una sola vez, corrido por Daniel en local con `SUPABASE_SERVICE_KEY` y
`POS_PIN_PEPPER`. **No por el MCP** — el MCP es read-only y así se queda.

Lee `id, client_id, pin` de las filas con `pin_hash is null`, hace PATCH de `pin_hash` y
`pin_hash_v`. Nunca registra un PIN en pantalla ni en log.

Verificación 1 — cobertura (read-only, se puede correr por el MCP):

```sql
select count(*) total, count(pin_hash) hasheados,
       count(*) filter (where pin_hash is null) faltan,
       count(distinct pin_hash) hashes_distintos
from pos_staff;
```

Debe dar `84 / 84 / 0 / 84`. Si `hashes_distintos < hasheados`, hay colisión y el índice
único de F1 ya habría fallado — investigar antes de seguir.

Verificación 2 — **correctitud, que es la que importa**: un script que re-deriva el hash de
cada fila desde `pin` y lo compara contra `pin_hash`. Prueba que el backfill usó la misma
pimienta que va a usar la app. Sin esto, F4 se entera de un desfase de pimienta cuando 40
personas no puedan entrar.

**Impacto offline: ninguno.**
**Reversible:** `update pos_staff set pin_hash = null, pin_hash_v = null`.

### F4 — Corte de lectura. **La fase de riesgo.**

- V1, V2 y V3 buscan por `pin_hash=eq.<hash>` en vez de `pin=eq.<pin>`.
- X3 (`api/pos/staff-cache/route.ts`) **se borra**. Ver §7, C1.
- V4 (mobile-app) necesita decisión propia, §7, C3.
- **Sin fallback a `pin`.** Un fallback reabre el camino de texto plano y esconde un backfill
  fallido. El rollback es de código —`git revert` + redeploy—; la columna `pin` sigue ahí y
  sigue siendo correcta hasta F6.

**Impacto offline: ninguno en el camino sin red** (§6), **pero es la fase que reabre T-24** (§6.3).
**Reversible:** `git revert`, sin tocar datos.

### F5 — Dejar de escribir y de exponer `pin`

Ordenamiento obligatorio: `pin` es `NOT NULL` con CHECK, así que **no se puede dejar de
escribir hasta relajarlo**.

```sql
alter table public.pos_staff alter column pin drop not null;
alter table public.pos_staff drop constraint pos_staff_pin_len_chk;
```

Luego:

- E1/E2/E3 dejan de escribir `pin`.
- X1 y X2 dejan de devolverlo en el `select=`.
- `PENDIENTE_20260910070000_...sql:51` cambia `pin ~ '^[0-9]{4,10}$'` por `pin_hash is not null`.
- `pos/staff/page.tsx:171` (`isPinTaken`) lee `data.staff[].pin` en el cliente: se borra.
  La API ya valida colisión server-side en `owner/staff/route.ts:119`.

> **Decisión de producto para Daniel — la única pérdida visible.**
> `equipo/page.tsx:195` tiene un ojito que revela el PIN de cualquier persona. Después de F5
> deja de haber qué revelar. El reemplazo natural es **"Resetear PIN"**: genera uno nuevo, lo
> muestra una sola vez —el alta ya hace exactamente eso en `equipo/page.tsx:280`— y queda en
> la bitácora `pos_staff_audit`. Es mejor control que ver el PIN de alguien más, pero **es un
> cambio de hábito para el gerente** y hay que decírselo antes, no después.

**Impacto offline: ninguno.**
**Reversible:** el código sí; el `pin` de quien se haya dado de alta entre F5 y el revert
queda en `null` y esa persona necesita reset.

### F6 — Borrar la columna. Punto de no retorno.

Mínimo **14 días** de F4+F5 estables, y respaldo verificado antes.

```sql
alter table public.pos_staff drop constraint unique_pin_per_client;
alter table public.pos_staff drop column pin;
alter table public.pos_staff alter column pin_hash set not null;
alter table public.pos_staff alter column pin_hash_v set not null;
alter table public.pos_staff alter column pin_hash_v set default 1;
alter table public.pos_staff add constraint pos_staff_pin_hash_chk
  check (pin_hash ~ '^[0-9a-f]{64}$');
```

**Irreversible.** Desde aquí los PIN no se pueden recuperar —que es el objetivo— y la
pimienta no se puede rotar sin rotar los 84 PIN.

**Impacto offline: ninguno.**

### F7 — Fuera de alcance, anotado para no perderlo

Identificar-primero-PIN-después, que habilitaría sal por fila y un KDF lento de verdad.
Cambia la pantalla de bloqueo y reabre T-24 en serio. No entra en esta migración.

---

## 5. Cambios por archivo

| Archivo | F2 | F4 | F5 |
|---|---|---|---|
| `dashboard-app/src/lib/pos-pin-hash.ts` | nuevo (F0) | — | — |
| `api/pos/pin/route.ts` | — | `:165` busca por hash | — |
| `api/pos/time-clock/route.ts` | — | `:44` busca por hash | — |
| `api/owner/staff/route.ts` | `:124`, `:168` escriben hash | `:55` `pinTaken` por hash | `:82` sin `pin` |
| `api/platform/staff/route.ts` | `:43` escribe hash | — | `:23` sin `pin` |
| `lib/provision-tenant.ts` | `:248` escribe hash | — | deja de escribir `pin` |
| `api/pos/staff-cache/route.ts` | — | **borrar** | — |
| `mobile-app/src/screens/LoginScreen.tsx` | — | decisión §7 C3 | — |
| `equipo/page.tsx` | — | — | `:195` ojito → resetear |
| `platform/staff/page.tsx` | — | — | `:107` input write-only |
| `pos/staff/page.tsx` | — | — | `:171` borrar `isPinTaken` |
| `PENDIENTE_2026091007...sql` | — | — | `:51` predicado |

**No se toca `electron-app/local-server/`.** Eso importa: por
[`OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`](../offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md)
§5.2–5.3, cualquier cambio ahí obliga a **regenerar el .exe y reinstalar en cada máquina**.
Esta migración vive entera en Vercel + Supabase.

Pruebas que van a tronar y hay que actualizar, no acomodar:
`bug019-pin-service-role.test.ts`, `pin-fallback-tenant.test.ts`, `pin-authority-outage.test.ts`,
`pin-cache-respeta-rol.test.ts`, `login-offline-identidad-e-intentos.test.ts`,
`staff-onboarding.test.ts`, `provision-tenant-durability.test.ts`, `proxy-resource-boundary.test.ts`.

---

## 6. El impacto sobre el arranque en frío sin WAN

### 6.1 El hallazgo: el camino offline no toca la base

Los tres verificadores offline **derivan su hash del PIN que la persona acaba de teclear**,
y se aprovisionan **en el momento de un login online exitoso**, con el PIN en memoria.
Ninguno lee `pos_staff`. Nunca.

| Almacén | Aprovisiona | Verifica |
|---|---|---|
| `pos_staff_cache` (navegador, 1 credencial) | `pos/layout.tsx:612-617` | `:648-651` |
| `pos_manager_credentials_v2` (navegador, lista) | `pos-manager-auth.ts:143-160` | `:166-194` |
| `actor-credentials.json` (Pedro, Caja) | `actor-authority.js:180-185` | `:191` |

**Por lo tanto: la base puede guardar lo que quiera.** Mientras `/api/pos/pin` conserve su
contrato —`{pin, client_id, device_id}` → `{staff, shiftToken}`—, el camino sin red no se
entera de la migración. Y el contrato no cambia: sólo cambia cómo la ruta busca la fila por
dentro.

Corolario: **Pedro no necesita instalador nuevo.** Su `/auth/pin`
(`local-server/index.js:643-661`) delega en `actorAuthority.login()`, que llama por HTTPS a
`/api/pos/pin` (`actor-authority.js:154`) y guarda su propio verificador acotado. No valida
contra Supabase por su cuenta.

### 6.2 Los tres riesgos que sí son reales

**R1 — La pimienta ausente o distinta en prod. El riesgo número uno, y no degrada suave.**

Las dos terminales no se comportan igual, y la diferencia es la que decide si el restaurante
abre:

| Camino | Qué hace ante un 503 de `/api/pos/pin` | Resultado |
|---|---|---|
| **Por Caja (Pedro)** | Lo clasifica como "autoridad caída" (`actor-authority.js:165-173`) y cae a su rama offline (`:191`) | Quien ya esté preparado **sigue entrando**, hasta 7 días de `credentialTtlMs` (`:57`) |
| **Directo a la nube** (`requiereCaja()` falso) | **Nada.** Ver abajo | **"PIN incorrecto"** a todos, y terminal bloqueada al 5º intento |

El camino directo del navegador ramifica **sólo** sobre `403` (`pos/layout.tsx:573`), `400`
(`:582`) y `res.ok` (`:588`). Un `503` —o un `500`, o un `429`— no es ninguno de los tres: se
cae del `try` **sin lanzar**, así que el `catch` con el respaldo offline (`:631-706`) **nunca
corre**, y la ejecución aterriza directo en el contador de intentos fallidos (`:707-712`).
Quien teclea su PIN correcto ve *"PIN incorrecto"*, y a los 5 intentos la terminal se bloquea
`LOCKOUT_MS`, **sin haber consultado jamás el almacén local de credenciales**.

O sea: una pimienta mal puesta en Vercel no deja al restaurante "operando en modo degradado".
Deja a las terminales que no pasan por Caja **sin poder abrir**, con el mensaje equivocado.

Mitigaciones, las tres obligatorias:

1. El fallo cerrado de F0 devuelve **`503` + `code: 'authority_unavailable'`**, no `500`, para
   que Pedro lo clasifique bien (un `401` sería peor: `actor-authority.js:170` **borra** la
   credencial preparada).
2. **Arreglar la rama de falla del navegador antes de F4** — que un `429`/`5xx` caiga al
   respaldo offline en vez de al contador. Ver §7, C6: es un bug preexistente, no lo introduce
   esta migración, pero la migración estrena una forma nueva de dispararlo.
3. Verificación de humo inmediatamente después de cada deploy de F0 y F4: un login online
   real, uno por rol, antes de dejar las terminales solas.

**R2 — Un PIN cambiado mientras la terminal está sin red sigue aceptando el viejo.**
Ya es cierto hoy y está escrito en `pos-manager-auth.ts:29-31`. La migración **no lo empeora**.
Pero se vuelve el riesgo dominante si F4 se combina con la rotación de los 84 PIN. **Van
separadas**, y la rotación se hace con todas las terminales conectadas.

**R3 — Desplegar F4 en horario de servicio.**
El camino offline no lee la base, pero el online sí cambia de forma. Desplegar al cierre,
verificar login online de una persona por rol antes de dejar las terminales solas. Rollback:
`git revert` + redeploy, con `pin` todavía autoritativo.

### 6.3 T-24 se reabre, y hay que decirlo

`docs/offline/TEST-MATRIX.md:589` tiene T-24 en **Impl ✓ / Test ✓ / Cert ✗**, pendiente
sólo de campo. La posición honesta:

- **F0–F3 y F5–F6 no tocan el camino de login. T-24 no se mueve.**
- **F4 sí toca `/api/pos/pin`**, que es la mitad *online* de T-24: la que **aprovisiona la
  credencial offline**. Si F4 rompiera el aprovisionamiento en silencio —pimienta distinta
  entre preview y prod, o la búsqueda por hash devolviendo la fila equivocada— las terminales
  se verían bien todo el día y fallarían **a la mañana siguiente, al abrir**. Esa es
  exactamente la forma de falla para la que T-24 existe.
- Por eso **F4 reabre T-24** y sólo lo cierra la prueba de campo que la matriz ya pide:
  apagar la terminal al cierre, prenderla al día siguiente **sin WAN**, y que entren **dos
  personas distintas** (`TEST-MATRIX.md:589`).
- Prueba automatizada nueva, guardián del aprovisionamiento: tras un login exitoso **por la
  ruta hasheada**, afirmar que `pos_manager_credentials_v2` quedó con credencial para ese
  `staff_id`. Hoy ningún test ata esas dos mitades.
- Vale re-correr también la rama `OFFLINE_USER_NOT_PREPARED` de Pedro
  (`actor-authority.js:191-193`): su credencial se indexa con `_index(pin)` en el login online,
  igual de expuesta al mismo modo de falla.

Efecto en el conteo de la matriz: **25/26 implementados no cambia**; lo que cambia es que
T-24 vuelve a necesitar campo sobre el commit de F4, no sobre el de PR #133.

---

## 7. Hallazgos colaterales del barrido

**C1 — `/api/pos/staff-cache` es texto plano con pasos extra. Borrarlo en F4.**
`route.ts:11-16` hashea con `SHA-256(pin + '_fullsite_salt')`: sal estática, sin iteraciones,
espacio de 10^4. Se revienta completo en menos de un segundo. Y `:37` se lo entrega a
**cualquiera con shift token** —o sea, a cualquier mesero— para **toda la plantilla activa**.
`rg 'staff-cache|pinHash'` sobre `dashboard-app/src`, `electron-app` y `mobile-app` no
encuentra un solo consumidor. Es exposición viva de código muerto; conviene borrarlo antes
que el resto del plan.

**C2 — El PIN en claro ya sale de la base todos los días.**
`api/owner/staff/route.ts:82` devuelve `pin` a cualquier dueño/admin/gerente y
`equipo/page.tsx:195` lo revela con un ojito. Los 4 usuarios de dashboard de AMALAY pueden
leer los 40 PIN sin acercarse a Supabase. Hashear la columna no cierra esto: lo cierra **F5**.

**C3 — El login de `mobile-app` ya está muerto en producción.**
`LoginScreen.tsx:28-33` consulta `pos_staff` con la llave **anon** y `'amalay'` hardcodeado.
Verificado hoy: `anon` tiene grant de tabla pero **ninguna política RLS** y `rolbypassrls =
false` → la consulta devuelve 0 filas y ese PIN nunca puede entrar. Además viola la regla de
CLAUDE.md §12 (prohibido hardcodear `amalay`). Decisión de Daniel: apuntarlo a `/api/pos/pin`
o borrar la pantalla. **No lo arreglo de callado dentro de esta migración.**

**C4 — El camino de lectura real es el MCP.**
`supabase_read_only_user` con `rolbypassrls = true`. Así funcionó la consulta de evidencia y
así se leen los 84 PIN de los 11 tenants. Read-only no significa ciego.

**C6 — El login del navegador trata `429` y `5xx` como PIN equivocado. Preexistente, y hay
que arreglarlo antes de F4.**
`pos/layout.tsx` ramifica sobre `403` (`:573`), `400` (`:582`) y `res.ok` (`:588`), y nada
más. Un `429` del throttle o un `5xx` de la nube se cae del `try` sin lanzar → el `catch` con
el respaldo offline (`:631-706`) no corre → aterriza en el contador de intentos (`:707-712`):
*"PIN incorrecto"* y bloqueo al 5º intento, **sin mirar el almacén local**.

No es hipotético ni nuevo: Pedro ya tropezó con esto y lo arregló para sí mismo. El comentario
de `actor-authority.js:159-164` lo cuenta completo — *"un 429 NO es un veredicto sobre este
PIN: la nube limita por IP pública, que en un restaurante comparten las tres terminales"*, y
tratarlo como rechazo *"era peor que estar sin internet"*. **El navegador nunca recibió ese
mismo arreglo.**

Dos consecuencias hoy, antes de tocar nada: (a) tres terminales compartiendo la IP del
restaurante pueden tumbarse el login entre ellas; (b) cualquier 5xx de Vercel se ve como PIN
equivocado. Y una consecuencia para este plan: es el amplificador del riesgo R1. **Corregirlo
es prerrequisito de F4**, y va en su propio PR —un P0 por rama, CLAUDE.md §7— antes de que
empiece la migración.

**C5 — El espacio de 4 dígitos sigue siendo el techo.**
40 PIN ocupados de 10,000: un intento a ciegas le pega a **alguien** el 0.4 % de las veces.
La defensa es `pin-throttle.ts`, por *(tenant, IP)*. Es
[`MIGRACION-PINS.md`](MIGRACION-PINS.md), que lleva **0 de 40 desde el 2026-08-26** —
confirmado hoy, 19 días después.

---

## 8. Lo que este documento no demuestra

| | |
|---|---|
| **Confirmado** | El censo de §1, los grants, las políticas RLS, el `rolbypassrls` de cada rol, y cada `archivo:línea` citado. Todo con `SELECT` read-only y lectura de código del working tree de `claude/objective-burnell-ee8e7e` (`54b3cf30`). |
| **Inferido** | Que F0–F3 y F5–F6 no tocan el camino offline. Se sigue de que los tres verificadores derivan del PIN tecleado (§6.1), pero **no está probado corriendo nada**. Lo mismo C6: la ausencia de rama para `429`/`5xx` está leída en el código, no reproducida en una terminal. |
| **Pendiente** | Todo. Nada implementado, nada aplicado, ninguna prueba corrida. El plan necesita aprobación antes de F0. |
| **Bloqueado externamente** | La certificación de T-24 depende de una noche en AMALAY: apagar al cierre, prender sin WAN, dos personas. No se puede sustituir con razonamiento. |

Verificado el 2026-09-14 contra `main` en `54b3cf30`. El working tree de este checkout está
al día con esa referencia; si pasan días antes de aprobar, re-verificar §3 con
`rg 'pin=eq\.'` antes de empezar.
