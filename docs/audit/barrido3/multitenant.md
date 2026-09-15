# Barrido 3 — Multi-tenant y clonabilidad

Base: worktree solo-lectura `wt-barrido3` = `origin/main` `f9f8965c`.
Regla contrastada: `CLAUDE.md` §12 — «Prohibido hardcodear `amalay` como solución general.
Una solución para AMALAY debe poder configurarse para otro restaurante **sin modificar código**».
Rutas relativas a `dashboard-app/src/` salvo donde se indique.

---

### [P1] Un restaurante nuevo nace con la zona horaria y el inicio de día de AMALAY, y no hay forma de cambiarlos sin SQL

`lib/provision-tenant.ts:155-160` · `lib/provision-tenant.ts` (interface `ProvisionInput`, ~línea 20-33) ·
`lib/dia-de-venta.ts:20` · `app/api/platform/onboard/route.ts`

**confianza 0.85**

**escenario.** El `insert` del tenant fija literalmente, para todo cliente:

```
iva_rate:0.16, timezone:'America/Mexico_City', ... business_day_start_local:'05:00:00'
```

`ProvisionInput` acepta `clientId`, `display_name`, colores, `plan`, `mesas`, `locations`,
`template` y `vertical` — **ninguno de los tres valores operativos**. Y no existe pantalla ni
endpoint que los edite después: `rg timezone` y `rg business_day_start_local` sobre
`src/app/platform/` y `src/app/api/platform/` no devuelven una sola coincidencia (incluidos
`tenant-settings`, `settings` y `config`). El único otro lugar donde aparece
`business_day_start_local` es quien lo **lee** (`lib/dia-de-venta.ts`, `lib/pos-daily.ts`).

Consecuencias por cliente clonado:
- Un restaurante en Tijuana o en Cancún (`America/Tijuana`, `America/Cancun`) reporta con el
  huso de CDMX: los cortes, los rankings y los reportes diarios quedan corridos 1-2 horas.
- Un lugar que cierra a las 03:00 o abre a las 06:00 hereda el corte de las 05:00 de AMALAY —
  ventas de la madrugada caen en el día equivocado.
- El IVA queda en 0.16 aunque el cliente maneje precios con IVA incluido (que es justo el caso
  de AMALAY, ver el siguiente hallazgo).

El arreglo actual sólo puede ser un `UPDATE` manual por cliente en producción: eso es
exactamente lo que §12 prohíbe.

**cómo probar.** `POST /api/platform/onboard` con un tenant de prueba y leer la fila:
`select client_id, timezone, business_day_start_local, iva_rate from clients where client_id='...'`.
Después buscar en la UI de plataforma dónde cambiarlos.

**fix mínimo.** Tres campos opcionales en `ProvisionInput` (`timezone`,
`business_day_start_local`, `iva_rate`) con los valores de hoy como default, y exponerlos en el
PATCH de `app/api/platform/tenant-settings/route.ts`. Sin la segunda mitad, el alta sigue siendo
un formulario que no se puede corregir.

---

### [P1] El IVA por defecto del sistema es el de AMALAY (0): un clon puede imprimir el ticket sin IVA y nadie se entera

`lib/pos-constants.ts:5` · `lib/pos-constants.ts:10` · `app/pos/layout.tsx:154-158` ·
`lib/pos-calculations.ts` · `lib/printer.ts` · `lib/provision-tenant.ts:156`

**confianza 0.75**

**escenario.**

```
// Default IVA rate — AMALAY: precios ya incluyen IVA (= 0)
export const IVA_RATE = 0
export function getIvaRate(): number { return _dynamicIvaRate ?? IVA_RATE }
```

El valor de un restaurante concreto es el default del módulo. La carga de la configuración que
lo corrige va con `.catch(() => {})` (`layout.tsx:158`): si el fetch falla —arranque en frío sin
WAN, un 5xx, la ventana de red del Service Worker— `setIvaRate` nunca corre y **todo** el
cálculo y la impresión usan 0: `pos-calculations.ts` (`subtotalAfterDiscount * getIvaRate()`) y
`printer.ts`, que además omite el renglón del IVA cuando es 0, así que el ticket no delata nada.

Y todo tenant provisionado nace con `iva_rate: 0.16` (`provision-tenant.ts:156`). Es decir: el
modo de fallo por defecto de un clon es **cobrar 16% de menos y emitir un ticket que no lo
menciona**. Para AMALAY es inocuo; para cualquier otro cliente es dinero y es fiscal.

**intento de refutación (parcial).** `app/pos/page.tsx:1868` y `:2575-2577` vuelven a fijar el
valor desde el catálogo completo (`catalog.config.iva_rate`), que se persiste tras la primera
autenticación en línea. Una terminal que ya bajó el catálogo se recupera. El hueco vive en la
primera sesión de una instalación nueva y en cualquier arranque donde el catálogo tampoco esté
disponible — no lo pude descartar, y por eso queda 0.75 y no 0.9.

**cómo probar.** Tenant nuevo con `iva_rate = 0.16`, terminal limpia (sin catálogo en
IndexedDB), cortar la red antes de abrir `/pos`, levantar una orden y comparar el total contra
el mismo pedido con red.

**fix mínimo.** Que `getIvaRate()` no invente: si `_dynamicIvaRate` es `null` y no hay catálogo
persistido, bloquear el cobro con aviso explícito en vez de calcular con 0. Como mínimo, sacar
el `?? IVA_RATE` y leer el último valor conocido del catálogo local.

---

### [P2] Comportamiento ramificado por el nombre del tenant, en tres lugares

`lib/floorplan-coordinates.ts:6-7` · `lib/order-cleanup-auth.ts` (`CLEANUP_OWNER_TENANT`) ·
`lib/warehouses.ts:22-28`

**confianza 0.9** (son literales, no inferencia)

**escenario.**

```
export function shouldUsePersistedFloorCoordinates(clientId: string): boolean {
  return clientId !== 'amalay'
}
const CLEANUP_OWNER_TENANT = 'amalay'
const EXTRAS_POR_TENANT: Record<string, Warehouse[]> = { amalay: [ panaderia, market, venta_terceros ] }
```

- **Plano de mesas:** la decisión de usar coordenadas persistidas depende de una comparación de
  cadena, y **falla abierta**: con `clientId` vacío o aún sin resolver (el caso normal durante
  la hidratación) devuelve `true`. Un tenant que se llamara `amalay` en otra instancia heredaría
  el camino legacy.
- **Limpieza destructiva de órdenes:** la autorización de una operación destructiva se ancla al
  nombre de un tenant en el código. Es acotado y deliberado, pero es el patrón que §12 prohíbe y
  no es auditable desde la BD.
- **Almacenes de inventario:** el propio archivo lo admite («DEUDA… lo correcto es que cada
  tenant configure sus almacenes en la BD»). Un cliente con panadería no puede tener el almacén
  de panadería sin que alguien edite y despliegue código.

**cómo probar.** Provisionar un tenant con panadería y buscar el almacén en el dropdown de
`/inventario-real`; y llamar `shouldUsePersistedFloorCoordinates('')`.

**fix mínimo.** Los tres a `clients.features` (o una columna dedicada):
`use_persisted_floorplan`, `allow_test_order_cleanup`, `warehouses[]`. Mientras tanto, que
`shouldUsePersistedFloorCoordinates` falle **cerrado** ante un `clientId` vacío.

---

### [P2] El ruteo de estaciones trae el vocabulario de una cafetería como default del sistema

`lib/pos-constants.ts:20-33` (BEBIDA_KEYWORDS) · `lib/pos-constants.ts:~35` (BARRA_CATEGORIES) ·
`lib/pos-constants.ts:~74` (`_clientStationOverride`) · `app/pos/layout.tsx:160-177`

**confianza 0.7**

**escenario.** La lista que decide si algo va a barra o a cocina es literal y específica de
AMALAY: `cappuccino`, `matcha`, `chamoyada`, `carajillo` y una lista de marcas de cerveza.
`BARRA_CATEGORIES` es igual (`coffee`, `frappes`, `signature`). Existe override por cliente
(`_clientStationOverride`, cargado en el arranque del POS), lo que mitiga el caso feliz — pero
esa carga viaja en el mismo bloque con `.catch(() => { /* keep module-level defaults */ })`
(`layout.tsx:177`): cuando no llega, una taquería o un pollo frito rutean sus platillos con
palabras de café, y las comandas salen por la impresora equivocada sin error visible.

**cómo probar.** Tenant nuevo sin `station_routing` configurado, ítem «Michelada» y ítem
«Té de manzanilla» → ver a qué estación se imprimen.

**fix mínimo.** Que el default del módulo sea vacío y que la ausencia de ruteo configurado sea
un estado explícito («estación sin configurar») en vez de un fallback silencioso al de AMALAY.

---

## Descartados

- **`app/api/pos/menu/route.ts` sin la cadena `client_id`.** Refutado leyéndolo: resuelve el
  tenant con `withPOSAuth(request)` y pasa `auth.clientId` a `fetchCompletePosCatalog`
  (`pos/menu/route.ts:9-13`). El aparente hueco era mi grep, no el código.
- **`sbFetch` sin alcance de tenant.** Refutado: `lib/data.ts:375` fuerza
  `client_id=eq.${cid || '__none__'}` — falla **cerrado** cuando no hay tenant resuelto, que es
  el comportamiento que pide §12.
- **`NEXT_PUBLIC_DEFAULT_CLIENT_ID` como fallback a otro tenant.** `lib/data.ts:106` devuelve
  `''` cuando la variable no está, y ese `''` termina en `__none__` (arriba). No encontré un
  camino donde caiga al tenant de otro restaurante.
- **Provisionamiento que escribe filas fuera de su tenant.** Refutado: `insertMissing`
  (`lib/provision-tenant.ts:121-135`) relee por `id` y exige que cada fila traiga el `client_id`
  esperado, lanzando `SCOPE_CONFLICT` si no. El tenant nace `active:false` /
  `provisioning_state:'pending'` y se activa al final.
- **Vistas `ocm_*` sin `security_invoker`.** NO VERIFICADO contra la base. En el repo,
  `supabase/migrations/20260826_cerrar_vistas_ocm.sql` contiene 15 apariciones de
  `security_invoker` y el baseline otras 10; este barrido fue de sólo lectura del repositorio y
  no consultó Supabase, así que no afirmo nada sobre el estado real de producción.
- **Los ~40 rutas de `app/api/` que no contienen la cadena literal `client_id`.** Revisé por
  muestra y las que abrí resuelven el tenant por `auth.clientId`. **NO BUSCADO A FONDO**: no es
  ausencia confirmada de fugas, es una muestra. Quedan sin abrir, sobre todo,
  `app/api/integrations/rappi/**` y `app/api/integrations/uber-eats/**`, donde el tenant llega
  desde un webhook externo — ése es el siguiente lugar donde yo buscaría.
- **Reportes que truncan o mezclan sucursales.** No revisado en este barrido (existe el
  antecedente conocido del dashboard que lee las 5,000 órdenes más viejas); no lo verifiqué
  contra este commit y por eso no lo reporto como hallazgo.
