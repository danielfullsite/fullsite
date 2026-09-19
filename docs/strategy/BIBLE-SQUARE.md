# Bible Square — Presets por tipo de restaurante en Fullsite

> Creado: 2026-08-28 · Doc vivo. Complementa [PLAN-SQUARE-FULLSITE.md](PLAN-SQUARE-FULLSITE.md).
> Fuentes: SETTINGS-BIBLE.md, CONFIGURABILITY-BIBLE.md, knowledge/wansoft/BIBLE.md (§4 conocimiento
> oscuro, §5 adopción real), WANSOFT-POS-BIBLE.md, ICP-PLAYBOOK.md, ONBOARDING-RESTAURANT.md §1B,
> GOLDEN-POS-SKELETON.md §10, y el código actual (client-config.ts, plans.ts, provision-tenant.ts,
> onboarding-template.ts, restaurant-manifest.ts, settings.ts).
> Marcas: **[Confirmado]** = verificado en código/docs citados · **[Diseño]** = propuesta de este doc.

## 0. La idea en una frase

Al dar de alta un restaurante escoges su **tipo** (fast food, high-end, bar, cafetería…) y el
sistema entero se reconfigura solo: qué pantalla abre el POS, si hay mesas o speed screen, qué
módulos aparecen en el sidebar, qué se imprime, cómo se cobra la propina, qué agentes de IA
corren. **Cero personalización manual por cliente.** Square lo hace con "modes" por dispositivo;
nosotros lo hacemos con presets por tenant sobre infraestructura que ya existe.

## 1. Qué ya existe y qué falta (anclaje técnico)

**[Confirmado] Ya existe todo el mecanismo, falta la biblioteca de presets:**

| Pieza | Dónde | Estado |
|---|---|---|
| `clients.type` (string libre, hoy sin semántica) | client-config.ts | Existe — candidato a discriminante del preset |
| `clients.features` — 15 flags booleanos (`posRestaurant`, `posTienda`, `bakery_station`, `delivery`, `inventory`, `foodCost`, `nomina`…) | client-config.ts, JSONB | Existe, con un solo `DEFAULT_FEATURES` global |
| `clients.pos_settings` — settings con `default` + `scope` (org/sucursal/terminal/estación) | settings.ts | Existe, 8 claves implementadas de ~26 familias de la SETTINGS-BIBLE |
| `OnboardingTemplate` — menú/pagos/roles semilla; `provisionTenant()` ya acepta `template?` | onboarding-template.ts, provision-tenant.ts | Existe, plantilla única |
| `RestaurantManifest` — JSON declarativo (identity, type, features parciales, station routing, staff) | restaurant-manifest.ts | Existe — es el formato natural del preset |
| `plan` comercial (reporteador/software/completo) | plans.ts | Existe — **ortogonal** al tipo |

**[Diseño] Lo que se construye:**

1. `clients.type` pasa de string libre a enum de vertical (§3).
2. Una **biblioteca de presets** (`lib/vertical-presets.ts` + fila en `platform_settings`): cada
   preset = parche sobre `ClientFeatures` + parche sobre `pos_settings` + `OnboardingTemplate`
   propio + layout de POS + agentes IA activos.
3. El wizard de onboarding (hoy cuestionario manual, ONBOARDING-RESTAURANT.md §1B) se reduce a
   **una pregunta**: "¿qué tipo de restaurante eres?" — el resto son defaults del preset.
4. El preset es **punto de partida, no jaula**: todo sigue siendo editable después (filosofía
   SETTINGS-PHILOSOPHY.md). Los invariantes I1–I9 del dominio (FULLSITE-DOMAIN-BIBLE) **nunca**
   varían por preset.

**Regla de composición:** `config efectiva = DEFAULTS ⊕ preset(type) ⊕ plan ⊕ overrides del cliente`.
El plan limita qué módulos puede pagar; el preset decide cuáles tienen sentido; el override es la
excepción puntual.

## 1b. Estado del arte (investigado 2026-08-28, fuentes al pie)

Cómo lo resuelven los líderes — tres patrones que se repiten en todos:

1. **La vertical es un perfil de configuración, nunca un fork de código.** Square tiene "modes"
   por dispositivo (Full Service, Quick Service, Bar, Retail, Bookings…) — todos el mismo binario;
   Toast configura cada terminal por rol (mostrador, dining room, barra); Lightspeed distingue
   Direct Sale vs Table Service por configuración de dispositivo.
2. **Plantillas como punto de partida editable, no jaulas.** Square for Restaurants trae 3
   settings templates (Table service / Counter service / Bar or lounge) que parametrizan flujo
   de cierre, gratuity automática por tamaño de mesa, formato de ticket, pantalla default, y
   "straight-fire categories" (bebidas directo a barra sin coursing).
3. **Pricing por profundidad de features, no por vertical.** Square cobra Free/$49/$149 por
   local según features (coursing, floor plans, KDS, kiosk) — el preset vertical es gratis.
   Coincide con nuestra escalera (reporteador/software/completo): el preset es ortogonal al plan.

Detalles que adoptamos directo: coursing Required/Optional/Off por dispositivo con fire manual,
automático o vía expediter (Toast); tabs con pre-auth por monto mínimo, EMV dip, tab con nombre
del tarjetahabiente (Toast/Lightspeed); auto-gratuity por tamaño de mesa (Square); asignación
de propina a quien abre vs quien cierra la cuenta (Square).

**Refinamiento a nuestro diseño:** el preset tiene **dos niveles** — el tipo del *tenant* decide
módulos y defaults, y el *perfil del dispositivo/terminal* decide el flujo de venta de esa
pantalla (un mismo restaurante puede tener una terminal en modo mostrador y otra en modo mesas
— AMALAY ya lo vive con restaurante+market). Nuestro `settings.ts` ya contempla scope
`'terminal'`, así que el mecanismo existe. **[Confirmado el scope; diseño el uso]**

Fuentes: squareup.com/help (modes, device codes, Register setup), support.toasttab.com (course
firing, pre-auth, service areas, device setup), k-series-support.lightspeedhq.com (bar tabs),
nerdwallet.com (pricing Square for Restaurants).

## 2. Los tres ejes que un preset controla

Todo lo que distingue a un fast food de un fine dining cae en tres ejes:

- **Flujo de venta** — ¿la orden nace en una mesa o en una fila? mesas/floor plan vs speed screen,
  cursos, split de cuenta, transferencias, tabs abiertas, número de asiento.
- **Módulos encendidos** — sidebar, agentes IA, KDS, inventario, recetas, nómina, delivery,
  producción. La adopción real de Wansoft (§5 de su Biblia) dice qué enciende cada quien:
  100% usan POS+cortes+reportes+CFDI+permisos; inventario completo y recetas solo 20-40%.
- **Dinero y cierre** — propinas (obligatoria/sugerida/ninguna, distribución), tipos de corte
  (X/Turno/Z/Global/Mesero), formas de pago, descuentos permitidos, facturación.

## 3. Los presets (plan de diseño por tipo)

Ocho presets v1. Cada uno con: a quién sirve, qué cambia en cada eje, y qué falta construir.
Los flags citados son los reales de `ClientFeatures`; "spd" = speed screen (no existe hoy, §4).

### 3.1 `fast_food` (QSR) — el preset de Billy

*Combos, mostrador/drive-thru, velocidad sobre todo. Sin meseros.*

- **Flujo:** sin mapa de mesas — el POS abre directo en **speed screen**: grid de productos más
  vendidos + combos al frente, orden numerada (#47), cobro inmediato antes de preparar. Modo
  "para llevar / comer aquí" como único metadato. KDS con SLA agresivo (verde <3 min).
- **Features:** `posRestaurant: off`-como-mesas (ver §4: se vuelve `pos.service_model = 'counter'`),
  `delivery: on`, `inventory: on`, `foodCost: on`, `nomina: on` (aquí vive el **tacómetro de
  labor** — es EL diferenciador para este preset), `bakery_station/giftCards: off`.
- **Dinero:** sin propina en flujo (opcional en terminal bancaria), corte de turno + Z, sin
  split de cuenta, descuentos solo por promoción/combo (pos-promos.ts, pos-combos.ts ya existen).
- **Menú semilla:** template con estructura combo (principal + acompañamiento + bebida, upsize).
- **IA:** tacómetro labor por hora, alertas de velocidad de servicio, varianza de food cost
  (el desperdicio/robo es el dolor #1 según Billy).
- **Falta construir:** speed screen, combos como flujo de primera clase en POS, tacómetro labor.

### 3.2 `fast_casual`

*Fila para ordenar, comes en mesa, sin mesero asignado (tipo Chipotle/poke).*

- Speed screen + **número de mesa opcional** para entrega (localizador). Builder de producto
  paso a paso (base → proteína → toppings) = modificadores multinivel que ya existen.
- Features como fast_food + `resenas: on` (repite público local). Propina sugerida en pantalla
  de cobro (tip screen), no obligatoria.
- **Falta:** tip screen configurable, flujo "orden pagada → entregar en mesa X" en KDS.

### 3.3 `casual_dining` — el default actual

*Mesas, meseros, servicio completo. Es AMALAY sin market. Todo esto ya existe.* **[Confirmado]**

- Mapa de mesas, comanda a cocina/barra por estación, transferir platillos, juntar/separar
  mesas, split de cuenta, corte por mesero, propinas con distribución (WANSOFT-POS-BIBLE cubre
  cada flujo). Features = `DEFAULT_FEATURES` de hoy.
- Este preset es la **línea base**: los demás se definen como diffs contra éste.

### 3.4 `fine_dining` (high-end)

*Cursos, maridaje, reservas, ticket alto. El vertical premium donde ya vendemos (Rosta, Casa Oso).*

- **Flujo:** todo lo de casual + **cursos/tiempos** (entrada→plato fuerte→postre, "fire" manual
  por curso al KDS), **número de asiento** por comensal (para servir sin preguntar y para split
  por persona), notas de cocina prominentes (alergias, término), reservaciones integradas
  (módulo ya existe para AMALAY).
- **Features:** `inventory + foodCost: on` obligatorios (aquí el food cost es religión),
  **inventario de alcohol por onza / paleo de barra** (Wansoft `AjusteDeDiferenciasBascula` —
  no lo tenemos, diferenciador claro), `resenas: on`, `giftCards: on` (aquí sí se venden).
- **Dinero:** propina sugerida por % sobre subtotal, split por asiento, cortesías con
  autorización de gerente y auditoría (el flujo de descuentos auditados ya existe).
- **IA:** conteo de personas por hora (oro según Biblia Wansoft §4), ranking de meseros,
  maridaje/upsell sugerido.
- **Falta:** coursing en POS+KDS, seat numbers, inventario de alcohol por onza.

### 3.5 `bar_cantina`

*La venta es líquida, las cuentas quedan abiertas horas.*

- **Flujo:** **tabs** — cuenta abierta por nombre/tarjeta con **pre-autorización** (nadie se va
  sin pagar), barra como estación principal del KDS, reloj de última ronda.
- **Features:** `foodCost` enfocado a **licor abierto**: botella = inventario por onza, merma
  esperada por coctel, paleo de barra (pesar botellas). `posTienda: off`, cocina secundaria.
- **Dinero:** propina alta sugerida, corte con arqueo de barra, control estricto de cortesías
  (el hoyo #1 de un bar son los tragos regalados).
- **Falta:** tabs con pre-auth, inventario por onza.
- **Investigado 2026-08-28 (docs oficiales Clip/MP):** la pre-auth **presencial** (retener en
  la terminal física) **no existe hoy en México** — Clip PinPad API no tiene auth/capture y
  MP Point cobra de inmediato. El camino viable: **tokenizar + auth-only vía Clip e-commerce**
  (`capture_method: manual`, retención 30 días, captura parcial ≤ auth, cancelable) — el
  cliente registra su tarjeta al abrir el tab (QR a mini-checkout) por un monto techo, y al
  cerrar se captura total+propina o se cancela y cobra en terminal. MP Payments API también
  sirve (7 días, captura parcial) pero no con Point. La propina debe caber dentro del monto
  autorizado — nunca capturar de más.

### 3.6 `cafeteria_panaderia`

*Volumen de tickets chicos, mostrador, producción propia.*

- Speed screen con favoritos + barcode para producto empacado, `bakery_station: on` (ya existe
  el flag), **módulo de producción** (masa → pan: la receta produce inventario en vez de solo
  consumirlo — Wansoft lo tiene, nosotros parcial), venta por peso donde aplique.
- Features: `posTienda: on` (vitrina = tienda), `nomina: on`, delivery opcional.
- **Falta:** producción como flujo completo (receta que da de alta producto terminado).

### 3.7 `hibrido_restaurante_tienda` — el preset AMALAY

*Café/restaurante + market en el mismo lugar. Ya funciona.* **[Confirmado]**

- `posRestaurant: on` + `posTienda: on`, inventario compartido, reportes que separan ambos
  (ya se hace: Market/Delivery fuera del ticket promedio). Es la prueba viviente de que el
  modelo dual funciona — y el argumento de venta de "un solo sistema, no dos".

### 3.8 `dark_kitchen_delivery`

*Sin sala. 100% Rappi/Uber/pedidos directos.*

- **Sin POS de piso**: el "POS" es el agregador de canales — órdenes de Rappi/Uber/web caen
  directo al KDS (el bridge Rappi→KDS ya existe, commit b5c72c2). Pantalla de despacho con
  repartidor asignado.
- Features: `delivery + ecommerce: on`, `posRestaurant: off`, mesas: 0, inventario y food cost
  críticos (el margen es finísimo), `resenas: on` (el rating del agregador es la fachada).
- **IA:** reconciliación de comisiones por canal, menú engineering por plataforma.
- **Falta:** vista de despacho, P&L por canal.

### Matriz resumen

| Preset | Mesas | Speed screen | Cursos | Tabs | Propina | Inventario clave | Diferenciador IA |
|---|---|---|---|---|---|---|---|
| fast_food | — | ✔ | — | — | opcional | recetas/combos | tacómetro labor |
| fast_casual | localizador | ✔ | — | — | sugerida | recetas | upsell builder |
| casual_dining | ✔ | — | — | — | distribución | recetas | ranking meseros |
| fine_dining | ✔ | — | ✔ | — | % sugerido | alcohol por onza | personas/hora, maridaje |
| bar_cantina | opcional | — | — | ✔ pre-auth | alta | licor abierto | merma de barra |
| cafeteria_panaderia | opcional | ✔ | — | — | jar/opcional | producción | pronóstico de producción |
| hibrido (AMALAY) | ✔ | barcode | — | — | distribución | dual | todo lo anterior |
| dark_kitchen | — | canales | — | — | — | recetas | P&L por canal |

## 4. Cambios de diseño transversales (lo que hace posible los 8)

1. **`pos.service_model`** como setting raíz: `'tables' | 'counter' | 'tabs' | 'channels'`.
   Hoy el POS asume mesas; este setting decide la pantalla inicial y el ciclo de vida de la
   orden. Es el cambio estructural más grande — todo lo demás son flags y templates. **[Diseño]**
2. **Speed screen** como layout alternativo del POS (mismo motor de órdenes, otra entrada).
3. **Templates de menú por preset**: 8 `OnboardingTemplate` en vez de 1; `provisionTenant()`
   ya los acepta como parámetro — cambio mínimo. **[Confirmado el hook]**
4. **Unificar los dos conceptos de "features"** (plan vs tenant) antes de sumar el tercer eje —
   deuda ya detectada: provision-tenant.ts duplica `DEFAULT_FEATURES` en lugar de importarlo.
5. **Sidebar/AppShell dirigidos 100% por features** (hoy ya mayormente así — auditar residuos).
6. El preset se guarda como **`RestaurantManifest` base versionado** en `platform_settings`:
   editable por nosotros sin deploy, clonable, y auditable (qué versión de preset recibió cada
   cliente).

## 5. Orden de construcción propuesto

Respetando la prioridad vigente (§20 del protocolo — P0/offline primero), en cuanto haya
capacidad:

1. **Fase 1 — plomería (bajo riesgo):** enum de `type` + biblioteca de presets + 8 templates de
   menú + wizard de una pregunta. No toca el POS. Entregable: dar de alta un tenant de cualquier
   tipo y que sidebar/módulos/menú salgan correctos al Minute 0.
2. **Fase 2 — `service_model` + speed screen:** desbloquea fast_food y fast_casual → **es lo que
   necesita el piloto de Billy**. Combos de primera clase.
3. **Fase 3 — dinero por preset:** tip screen, tabs con pre-auth, corte X y numeración Z.
4. **Fase 4 — profundidad por vertical:** coursing/seats (fine dining), onzas/paleo (bar),
   producción (panadería), despacho (dark kitchen).

Cada fase se valida con **un cliente real del vertical** antes de declarar el preset listo
(Billy = fast_food; AMALAY = híbrido, ya validado; Rosta/Casa Oso = candidatos fine dining).

## 6. Por qué esto es la jugada Square

Square no vende "un POS configurable": vende que **al escoger tu negocio, el sistema ya viene
armado**. El costo marginal de un cliente nuevo tiende a cero — que es literalmente el requisito
de clonabilidad ya establecido (§12 del protocolo: "una solución para AMALAY debe poder
configurarse para otro restaurante sin modificar código"). Los presets son ese requisito hecho
producto: la personalización deja de ser un servicio y se vuelve un `SELECT`. Y la
generalización a otras industrias (retail, maquila) después será solo… un preset más.
