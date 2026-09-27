# Rediseño POS v1.2: especificación técnica de integración

**Fecha:** 2026-09-26.
**Base:** `origin/main` @ `ecc89364`. Las líneas de código citadas se leyeron en `aee90ec9`; los dos commits posteriores no tocan esos archivos salvo `platform-evidence.ts`, cuyo estado nuevo está en §7.1. Rama aislada `docs/pos-v1.2-plan-integracion`; sólo agrega este archivo.

**Qué es.** La especificación técnica que desarrolla la decisión ya escrita en [`REDISENO-V1.2-INTEGRATION-PLAN.md`](REDISENO-V1.2-INTEGRATION-PLAN.md) (`157db1b9`). **No la reemplaza.** Donde este documento difiere de ella, lo marca como propuesta en §10.

**Estado:** especificación. **Nada está implementado.** No se tocó código, datos, P19, P17, pagos ni KDS. En el vocabulario de CLAUDE.md §10, todo lo que describe es «propuesto».

**Decisiones de Daniel** (detalle en §10.3 y §7.3):

| Fecha | Decisión | Qué dice |
|---|---|---|
| 2026-09-26 | Q2 | Se mantiene Schibsted Grotesk, con disponibilidad offline verificada |
| 2026-09-26 | Q3 | Pendiente de inventario físico de PDV1, PDV3 y SERVER1. **No se supone DPR, pantalla táctil ni escala** |
| 2026-09-26 | Q8 | **No autorizada.** No se escriben componentes dentro de `/pos`, ni se implementa o publica nada, hasta que P19 GUI/CDP complete el tramo de edición (E0) |
| 2026-09-27 | E0 | «Tramo de edición» = **GUI sintética real hasta login → turno → borrador → acción válida → Guardar con recibo durable** |
| 2026-09-27 | E1 | `ORDER_SEND` → KDS **no** es prerrequisito de F0b (aislado y sin handlers), pero **sí es prerrequisito absoluto** para habilitar `ui_version: v2` en una Caja o para cualquier rollout |
| 2026-09-27 | RC | RC-1, RC-2 y RC-3 siguen como riesgos **independientes** del rediseño |

La rama sigue aislada y sin push. No se implementa código.

---

## 0. Resultado

1. **La v1.2 es un prototipo, no código portable.**
   - Es un solo HTML con JS vanilla: 7,435 líneas sin contar las fuentes.
   - Tiene datos semilla, azar, hardware simulado y 0 llamadas de red.
   - Se integran tres cosas:
     - **su piel** (tokens, caparazón, jerarquía);
     - **su contrato de mensajes** (avisos globales en la barra, errores locales dentro de su hoja);
     - **las aserciones geométricas de su batería.**
   - Su lógica no se integra.
2. **La bandera ya existe y no hay que inventarla.**
   - Es `ui_version` (`v1` | `v2`) en `config.json` por terminal, y se resuelve **una sola vez al arrancar Electron** (`electron-app/local-server/core/version-de-interfaz.js`). La v1.2 entra como `v2`.
   - **Ojo:** si la clave falta, vale `v1`. Pero un valor **presente e inválido** (`"V2"`, `" v2 "`, `true`) invalida la configuración entera, y la terminal arranca en NOT_PROVISIONED **sin Pedro ni POS** (`config-schema.js:60-61`; `main.js:1057-1061`).
   - Falta que el renderer reciba ese valor congelado. Debe llegar por el canal que ya usa `FULLSITE_UI_PACKAGE`: el preload lo escribe antes de cualquier script (`main.js:761-767`, `preload.js:5-11`). Nunca por una lectura HTTP (§4).
3. **El `pos/page.tsx` de `main` no es el código que se está certificando.**
   - P16–P19 viven sólo en la Caja Windows, en un árbol sin Git, con base `418933f4`. Esa base es ancestro de `main` y no hubo cambios de POS desde entonces.
   - En `main` el envío a cocina tiene dos caminos:
     - en modo web manda `ORDER_SENT` (`page.tsx:3653-3654`);
     - en modo Caja ya manda `ORDER_SEND` (`page.tsx:3422` → `guardarOperacionCaja` → `enviarCuentaEnCaja` `:2677` → `pedro-operaciones.ts:77`).
   - FRESH certifica un solo `ORDER_SEND` y **cero** `ORDER_SENT`.
   - Consecuencia: el rediseño **no puede conectarse a ningún handler hasta que FRESH esté en Git y en `main`**, además de que P19 pase GUI/CDP (§7).
4. **Hoy sólo cabe la fase F0, y sólo en papel:** esta especificación y el diseño de la batería de pruebas. Daniel **no autorizó** código (Q8, 2026-09-26): nada dentro de `/pos`, ni siquiera primitivas aisladas en `/pos/ui-kit`, hasta que P19 GUI/CDP complete el tramo de edición: GUI sintética real hasta login → turno → borrador → acción válida → Guardar con recibo durable (condición E0, §7.3). Coincide con `DO_NOT_TOUCH_BEFORE_FIELD_CERT.md:6`, «ningún rediseño ni refactor previo». **Habilitar `v2` en una Caja o hacer cualquier rollout exige además `ORDER_SEND` → KDS en PASS (E1), sin excepción.**
5. **Ocho puntos donde la v1.2 contradice el sistema real.** Hay que adaptar el diseño, no copiarlo (§10.1):
   - modificadores sin obligatorios;
   - Cortesía, Influencer y Mercadotecnia como formas de pago que cierran sin autorización (en el sistema real la cortesía es un descuento con PIN o huella);
   - «Pago mixto» sin flujo;
   - la cola «reintenta sola» los conflictos;
   - aviso offline que siempre promete cobrar e imprimir;
   - PIN de 4 dígitos contra 10;
   - no incluye Schibsted Grotesk;
   - contraste y objetivos táctiles bajo el piso del POS, y medición sólo a zoom 0.95.
6. **El POS real tiene más de lo que muestra la v1.2**:
   - dos modos (Caja/Electron y web);
   - pago mixto real;
   - grupos de modificadores;
   - 14 modales.

   La regla de cero pérdida obliga a conservarlo todo (memoria `feedback_redesign_zero_info_loss`, 2026-08-11). §3 lista lo que debe sobrevivir.

---

## 1. Fuentes y huellas

### 1.1 El artefacto

| Fuente | Ruta real | Huella | Estado |
|---|---|---|---|
| v1.2 HTML | `~/Desktop/pos-rediseno-export-2026-09-25-v1.2/fullsite-skeleton-pos-v1.2.html` (iCloud, sin datos locales; bajado con `cat`) | SHA-256 `6f7df51f8677bbd8ec724d34dc83b4544c96da8d810fd3da2c97b3fb9115c9a3`, igual a su `SHA256SUMS` | ENCONTRADO Y LEGIBLE |
| v1.2 LEEME | misma carpeta, `LEEME.md` | `c412cec8315dfdc45de8c87118c9139224b859ea54920faf3804fc2111d3c9bb` | ENCONTRADO Y LEGIBLE |
| v1.2 batería y resultados | `herramientas/verify-v12.mjs`, `herramientas/reporte-v1.2.txt`, `capturas/verificacion.json`, `herramientas/v1.1-a-v1.2.diff` | listados en `SHA256SUMS` | ENCONTRADO Y LEGIBLE |
| v1.2.1 (sólo Sincronización) | `~/fullsite-canonicos/pos-rediseno-v1.2.1-2026-09-25.tar.gz` | `shasum -a 256 -c` → OK; HTML `27869b60e17346fe1470944787061366c600a2b47aff0b81fcb79aed9f892ed1` | ENCONTRADO Y LEGIBLE |

### 1.2 El sistema y el trabajo previo

| Fuente | Qué aporta | Estado |
|---|---|---|
| `docs/pos/REDISENO-V1.2-INTEGRATION-PLAN.md` (`main`, `157db1b9`) | La decisión: capa de presentación con bandera, después de P19 GUI/CDP | vigente |
| `docs/release/CLOSURE-TRACKER-2026-09-26.md` (`main`) | «No mezclar P19 con el rediseño» (`:17`) | vigente |
| `electron-app/local-server/core/version-de-interfaz.js` + `config-schema.js:51-62` (`main`) | El interruptor `ui_version` por terminal, congelado al arrancar | vigente, sin consumidor en el renderer |
| `docs/pos/REDESIGN-V2-DISCOVERY.md` (rama `redesign/pos-ds-v2`, 14 commits detrás de `main`) | Mapa, reutilización y fases del rediseño V2 anterior; «guardián de tokens» `6b7b7bc6` | previo a la v1.2; su estrategia de bandera (`pos_settings` + `localStorage`) queda superada por `version-de-interfaz.js` |
| PR [danielfullsite/fullsite#408](https://github.com/danielfullsite/fullsite/pull/408) `redesign/pos-tile` | 8 componentes presentacionales con rama apagada idéntica; `MATRIZ-REDISENO-POS.md` | CONFLICTING, 29 commits detrás de `main`; «la rama prendida no se ha visto renderizada» |
| `~/Documents/Codex/2026-09-19/docu/outputs/FULLSITE-FRESH-UI-CHROMIUM-P16-P20-LINT-PROMPT.md` | Definición de P16–P20 y del refactor de `pos/page.tsx` | ENCONTRADO Y LEGIBLE |
| `~/Documents/Codex/2026-09-19/docu/outputs/REDESIGN-INSTALL-IMPACT.md` | En Electron, la UI viaja en el instalador | ENCONTRADO Y LEGIBLE |
| `~/Documents/Codex/2026-09-19/docu/outputs/DO_NOT_TOUCH_BEFORE_FIELD_CERT.md` | Congelamiento de POS, KDS, caja, pagos y sync | ENCONTRADO Y LEGIBLE |
| `dashboard-app/src/lib/jev/platform-evidence.ts` (`main`: `a9234098`, `aee90ec9`) | Contratos de los manifiestos P19: integral `blocked` y admisión `scoped_pass`, los dos con `uiPolicy: 'hold'` | leído |
| Historia de Codex, `~/.codex/thread_history_1.sqlite`, hilo `01a0babf-…` (leída en sólo lectura) | Estados P16–P19 que Codex Windows reportó; copias pegadas, no archivos originales | REPORTADO (§11) |
| Manifiesto `fresh-p19-pos-kds-integral-20260926.json` | El original está en `C:\AMALAY-LAB\…\jev-evidence-export\…` (Windows) | NO LOCALIZADO EN ESTA MAC tras buscar en `~/Documents`, `~/Downloads`, `~/Desktop`, `~/fullsite-canonicos` y `/private/tmp/claude-501`. No es una búsqueda global de `~`: quedaron 65 archivos iCloud sin datos locales que no se pudieron leer |

**Notación:**
- `:NNN` es una línea de la v1.2 sin base64, idéntica al original salvo las fuentes.
- `page.tsx:NNN` es `dashboard-app/src/app/pos/page.tsx` en `aee90ec9`, igual al de `c7530a17`.
- `V12:NNN` es `verify-v12.mjs`.

---

## 2. Alcance

**Se integra (piel y contrato):**
- tokens de color, radios, sombras y escala;
- barra de estado de 52 px y banda de acción de 78 px;
- retícula de productos sin scroll con paginador;
- ticket agrupado por asiento;
- piel de las hojas Cobro y Modificadores;
- contrato de avisos global y local;
- listas con scroll sin filas a medias;
- pantalla de Sincronización, **de sólo lectura** y en la última fase.

Es el mismo alcance visual que aprobó la decisión (`REDISENO-V1.2-INTEGRATION-PLAN.md:16-17`), ampliado a la piel de venta.

**No se integra:**

| De la v1.2 | Por qué no |
|---|---|
| El JS de estado (`S`, `POS`, `PAY`, `MOD`, `SYNC`, `CUENTAS`…) | El estado vive en `page.tsx` y, después de P19, en el owner durable de main |
| `SYNC.push`, que con red no encola (:3717-3722) | En el sistema real toda operación lleva `save_operation_id` y pasa por la cola |
| `SYNC.drenar` con `Math.random() < .14` (:3744) | El conflicto es simulado |
| Cortesía, Influencer y Mercadotecnia como formas de pago que sólo avisan y cierran (:3112-3118, :3137) | No existen como formas de pago; la cortesía real es un descuento autorizado (`DiscountModal`) |
| «Pago mixto» sin flujo (:1833) | El POS real tiene un mixto funcional (`page.tsx:6788-6873`) |
| `TENANT` con datos de AMALAY: nombres del personal, plano, RFC, PIN 1234 (:1800-1906, :4011, :4397) | CLAUDE.md §12, nada de `amalay` en el código |
| `localStorage` `fs-theme` y `fs-scale`, leídos sin `try` (:2248-2249) | P16 hizo durable el estado de tema y UI; esto no entra |
| Huella, terminal de pago, impresión, báscula y lector simulados | Sus contratos reales viven en Pedro, `mp-payment-recovery` y `print-queue` |
| `ADAPTA.detectar()` (:6168-6189) | Queda para F3. Sin pantalla táctil sólo produce `sm` |
| Otras 22 vistas (turno, corte, inventario, facturación, delivery…) | Fuera de este plan. Cada una requiere su propio inventario de cero pérdida |
| Cocina y Barra | Fuera por instrucción |

### 2.1 No copiar del artefacto v1.2

Son seis comportamientos del prototipo que **no pasan a Fullsite**, aunque se vean bien en las capturas. Cada fila dice qué hace la v1.2, qué hace el sistema, la regla que manda y la prueba que la vigila.

| # | Tema | Qué hace la v1.2 (no copiar) | Qué hace el sistema | Regla para la integración | Se verifica con |
|---|---|---|---|---|---|
| NC-1 | **Cortesía** | Cortesía, Influencer y Mercadotecnia son **formas de pago** (:1815-1834). `PAY.finish` sólo avisa «se pediría huella» y **cierra la cuenta igual** (:3112-3118, :3137) | No existen como formas de pago: `PaymentMethodDB` = `{id, name, type, commission_pct}`, sin campo de autorización (`pos-data.ts:400-407`). La cortesía es un modo de `DiscountModal`, con PIN o huella de gerente (`page.tsx:749-1066`) | El rediseño **no crea formas de pago**. La cortesía sólo existe dentro del flujo de descuento autorizado, vestido tal cual. La UI nunca decide si algo está autorizado | T-03, T-10 |
| NC-2 | **Reintentos de cobro** | `SYNC.reintentar` regresa los errores a pendiente y vuelve a drenar (:3752). Los conflictos salen de `Math.random() < .14` (:3744). La pantalla etiqueta un «Cobro mesa 44 · Efectivo» en conflicto como «se reintenta solo» (captura `09-sync-conflicto`) | La idempotencia depende de `save_operation_id`. Una petición legacy sin él **no** es idempotente (`api/pos/save-order/route.ts:17-20`, `82`). `operationLock` impide el doble envío (`page.tsx:2878`, `3957`). En FRESH, un cobro incierto es `uncertain` en el journal P17 (REPORTADO) | **La UI nunca genera un segundo intento de cobro.** «Reintentar» sólo pide al dueño de la cola que drene la **misma** operación con el **mismo** id. Un cobro incierto es un diálogo bloqueante sin botón de reintento (§5.4-6). Ningún cobro se etiqueta «se reintenta solo» salvo si su clase es `TRANSIENT_RETRYABLE` (§5.6) | T-10 (doble clic = 1 petición), T-12, T-13 |
| NC-3 | **Modificadores obligatorios** | Todo es opcional (:3042). Los modificadores son constantes escritas en el código por tipo de producto (`MOD_SETS` :3165, `MOD_QUITAR` :3181) | Los grupos vienen del catálogo, con `required`, `min_selections` y `max_selections` (`pedro-catalogo.ts:12-16`). Confirmar queda bloqueado mientras falten obligatorios (`page.tsx:311-331`, `400`, `648`, `721`) | Los grupos y sus reglas **salen del catálogo, nunca de constantes de la UI**. Aplican M-01 a M-06 (§5.5). Un obligatorio sin elegir bloquea «Agregar» y dice por qué | T-11 |
| NC-4 | **Precios autoritativos** | La vista calcula subtotal, descuento, IVA y total (:2690-2694). Calcula el cobro como `tot × (1 + tip)` (:3096). Los precios salen de datos semilla y de `MOD_SETS` (:3165) | La Caja es dueña del catálogo completo (`pedro-catalogo.ts:21-22`). El servidor compara el precio cobrado contra el del menú, **el único dato que el POS no dicta** (`save-order/route.ts:252-259`). Hoy los totales se calculan en `page.tsx:3343-3372`; en FRESH, P19 tiene una proyección de precios propia (`fresh-draft-price-projection.ts`, REPORTADO) | Los componentes `v2` **reciben montos ya calculados** por el dueño del estado. **Nunca calculan, redondean ni editan** precios, impuestos, propinas ni totales. No hay campo de precio en `v2` fuera de los flujos autorizados que ya existen. La tasa sale de `iva_rate` (L-02) | T-12 (mismo payload en `v1` y `v2`), T-16 (`iva_rate` 0 y 0.16) |
| NC-5 | **Mínimo táctil de 48 px** | Controles de 24 px (`.tag` :499, usada como botón), 28 (`.pill` :444), 38 (`.seg` :512) y 40 (`.seat` :536, `.icon-btn` :454). La densidad compacta renglones con más de 8 o 14 (:2662) | `.pos-kiosk` fija `min-height: 48px` en button, input y select (`globals.css:58-64`) | **≥48 px de alto en todo control y ≥48 px de ancho en los de sólo icono.** La densidad no baja un renglón accionable de 48 px: si no caben, hay scroll sin filas a medias (V-13). El tamaño **físico** depende del DPR y del tamaño de pantalla, pendientes de Q3; hasta entonces se mide en px CSS y no se aprueba nada | V-14 |
| NC-6 | **Flujo durable P19** | Cuentas y cola viven en memoria (`CUENTAS`, `SYNC.cola`), aunque los comentarios dicen `localStorage 'pos_order_<mesa>'` más IndexedDB (:3220, :3723): justo el almacenamiento que P19 retira. Los ids se generan con `Math.random` (:3053, :3718). Lee `fs-theme` y `fs-scale` de `localStorage` sin `try` (:2248-2249) y los escribe ahí (:2610, :2617). Deshacer es una pila local de 10 s que recrea renglones (:6369-6397) | P19 muda `pos_order_*` y los borradores a un owner durable en main, atado a restaurante, terminal, turno, mesa, generación y revisión (`FULLSITE-FRESH-UI-CHROMIUM-P16-P20-LINT-PROMPT.md`, sección P19). Hoy en `main` esos borradores están en `localStorage` (`page.tsx:1763-2733`). Codex Mac le pidió a Windows que el rediseño no use `localStorage` para pedidos, no genere ids y no reemplace a los owners P16–P20 (historia de Codex, 09-24; REPORTADO) | Los componentes `v2` **no leen ni escriben storage, no generan ids y no guardan estado de la orden**. Editar, mover de mesa, deshacer y enviar son **acciones del owner**. Si el owner no expone «deshacer», `v2` no lo inventa. Nada se conecta antes de E0 y E1 (§7.3) | T-12, T-14, T-15, T-18 |

---

## 3. Mapa pantalla → componente → estado (actual → v1.2)

Columnas:
- **Contacto FRESH**: qué contrato de P16–P19 toca esa superficie.
- **Fase**: la de §9.

| # | Superficie v1.2 | Hoy en `main` | Estado que la alimenta | Qué cambia (piel) | Lo que la v1.2 no tiene y debe conservarse | Contacto FRESH | Fase |
|---|---|---|---|---|---|---|---|
| 1 | Barra de estado `#statusbar` 52 px (:411, :1208-1220) | Encabezado en 2 filas `page.tsx:4391-4635`; shell `pos/layout.tsx:852-882` | `online`, `pendingSync`, `isSyncing`, `lastSyncTime` (`OfflineIndicator.tsx:30-83`), `readyOrders`, `comandasOff`, `btPrinter`, `mpConfig`, `staffName`, `clock`, `mesa`, `personas`, `mesero` | Una fila: chips de mesa, personas y mesero; píldoras Cocina, Turno y Red de sólo lectura; reloj; campana; ajustes; candado | Reasignar mesero con PIN (`4539-4635`); impresora BT; estado de MP; «Limpiar cola» (>5); «Modo offline activo»; sync manual con diagnóstico (`4410-4439`); banner «(plantilla)» (`layout.tsx:868-873`) | P16: FRESH señaló `page.tsx:2076`, donde hoy se borra `pos_comandas_muted` y se fuerza `false`. P17: contador de pendientes | F1 piel · F2 píldoras |
| 2 | Ticket por asiento `#tk-body` (:2660-2706) | `page.tsx:4826-5346` | `orderItems`, `cancelledItems`, `voidedItems`, `sentItemIds`, `flashItemId`, `sillaActual`, `personas`, `discount`, `orderNotes`, `appliedPromo` | Encabezado de mesa con monto; asientos con subtotal; densidad según número de renglones | 8 estados del renglón; acciones por renglón con permisos (cantidad `3279`, silla `3302`, editar `2956`, transferir, cancelar); promociones; nota de orden (`5139-5145`); herramientas (`5089-5287`); no editar lo enviado (`5022`) | **P19.** Hoy se hidrata de `pos_order_${mesa}` / `pos_draft_${mesa}` (`1763-2733`) | F2 |
| 3 | Familias → categorías → retícula paginada (:2625-2651; `measure()` :2322) | Categorías `5454-5506`; modal por categoría `5509-5557`; combos `5559-5604`; buscador y escáner `5352-5450`, `5741-5746` | `menuCategories`, `allCombos`, `speedMode`, `catalogoError`, `outOfStockItems`, `menuSearch` | Retícula sin scroll con paginador; color de categoría en todo el mosaico (como en #408) | Agotado; combos; `speedMode` de mostrador (`1748-1753`); error de catálogo con `role=alert` (`5455`); escáner | Catálogo en IDB `fullsite_pos` (P18 lo clasifica) | F1 |
| 4 | Banda de acción `#actions` 78 px (:613, :2423-2451) | `page.tsx:5290-5345` | `saving`, `loadingMesa`, `cuentaCajaBloqueada`, `escribeEnCaja`, `can('cerrar_cuentas')`. `requiereCaja()` agrega «Guardar» y pasa a 3 columnas (`5290`, `5300`; `pedro-cliente.ts:24-28`) | Enviar y Cobrar rellenos, el resto delineados; subtítulo con renglones o monto | «Guardar» en Caja; los 7 caminos de la banda (#408); spinner de envío (`5316`) | **P17.** Enviar es `ORDER_SEND` y su estado en vuelo o incierto sale del journal | F1 piel · F2 estados |
| 5 | Mesas en Órdenes / Plano / Lista (:3902-4016) | `mesas/page.tsx` (1,327 líneas); sondeo de 3 s (`438-455`) | Órdenes abiertas, zonas, `pos_mesas_orders` (LS, TTL 30 s), `pos_mesero` (`275`) | Leyenda de estados con conteos, minutos abiertos, plano por zonas | Fusionar; cuenta por nombre; filtro de mesero; **zonas desde datos**, no un arreglo fijo (:4011) | P16 (señaló `mesas/page.tsx:275`); cachés LS (P18) | F1 |
| 6 | Hoja Modificadores (:1497, `MOD.open` :2970) | `ModifierModal` `page.tsx:266-735`, montado en `5749-5760` con ErrorBoundary `235-264` | `modifierItem`, `editingOrderItem`, `modifierCategoryId`, grupos (`281`) | Cantidad, asiento, nota, tiempo y chips en retícula; pie fijo con «Agregar $X» | **Obligatorio, mínimo y máximo** (`311-312`, `327-331`, `503-505`); con máximo 1 el control se dibuja redondo (`545`), aunque el input es un `checkbox` `sr-only` (`538-543`); niveles con «Omitir» (`637-731`); «Quitar» desde la receta (`333-339`); confirmar bloqueado mientras falten obligatorios (`400`, `648`, `721`) | P19: el subgate «modificadores» pasó en FRESH; escribe por acción del editor | F1 piel · F2 cableado |
| 7 | Hoja Cobro web (:1526, `PAY.open` :3073) | Modal legacy `page.tsx:6464-6879` (oculto si `bloqueaLegacyCaja`) | Propina `6528-6552`; efectivo `6681-6735`; tarjeta `6563-6679`, `6736-6757`; métodos personalizados `6759-6787`; mixto `6788-6873`; `operationLock` (`2878`, `3957`); `save_operation_id` (`3960`, `4038`) | Total, propina en 4 botones, formas de pago en retícula, teclado, cambio, error bajo Recibido | Mixto real; confirmación de personas (`6212-6283`); split (`6030-6210`); recuperación de MP (`4322-4342`, `6599-6647`); cobro offline (`4049-4092`); botón deshabilitado si lo recibido es menor al total (`6727`) | **P17 + P19** (efecto externo tipo A) | F2 |
| 8 | Hoja Cobro en Caja | `CobroDeCaja` (`page.tsx:4786`; `CobroDeCaja.tsx`), `z-[120]`, colores de tema claro (`:96,111-112`) | `cobroDeCaja`, `avisoCuentaCaja` (`4800-4823`) | La misma piel que la fila 7 | Comandos de Caja, banner de cuenta y conflicto | **P17** (`pedro-operaciones.ts:66,77`) | F2 |
| 9 | Hojas genéricas y teclados (`NUMPAD` :7249, `TECLADO` :4154, `GEN` :7236, `SPLIT` :3534, `DESC` :3313, `AUTH` :3434) | DiscountModal `749-1066`; Cancel `1076-1286`; VoidOrder `1302-1476`; CashMovement `1490-1724`; Transferir `5783-5848`; Verificar `5915-6028`; Personas `6212-6283`; config MP `6285-6399`; Tiempos `6401-6462`; PinPrompt `6884-6917` | Estado local de cada modal | Hoja con pie fijo y teclado grande | PIN o huella de gerente; catálogos de descuento y razones; transferencia a mesa en Caja | P17 (cancelar, anular y transferir pasan por el journal de Caja) | F3 |
| 10 | Bloqueo / PIN `#lock` (:1613, `LOCK.tap` :7350) | `pos/layout.tsx:886-1054` (teclado `976-1015`, puntos `960-973`); alta de huella `776-850` | `pos_actor_session`, `pos_shift_token` | Candado con teclado de 66 px | **PIN de 10 dígitos** (`47f32325`, fuera de `main`); **F4: autoridad por hash** (#437) | Bloque de seguridad POS (#431–#440) | F3 |
| 11 | Avisos `UI.aviso` global/local (:2475-2523) y deshacer de 10 s (:6369) | Toast de texto sin tipo, 2.5 s, `layerZ('toast')=300` (`page.tsx:2892-2896`, `5874-5878`); `window.alert/confirm` (`4425`, `4451`, `4753`); diálogo bloqueante «cocina no confirmó» (`5882-5913`); modal de conflicto de sync (`5611-5738`) | `toast: string` | Franja global anclada a la barra, encima de las hojas; error local dentro de la hoja | Los diálogos que exigen decisión **no** bajan a aviso | — | F1 contrato · F2 cableado |
| 12 | Sincronización `view-sync` (:3756; prioridad en v1.2.1) | **No existe como pantalla.** Hay `OfflineIndicator`, el diagnóstico `4410-4439` y `ConsumoPendienteDeCaja.tsx:21-35` | IDB `sync_queue`, LS `pos_comando_pendiente:*` (`pedro-comandos.ts:17-80`), `print_jobs`, `pos_avisos_lan_pendientes` | Tarjetas, resúmenes y cola por prioridad | Clase `TERMINAL_NON_RETRYABLE`, invisible hoy (L-09, `pos-offline-db.ts:585`) | **P17** (el journal sale de LS y pasa a main) | F3, sólo lectura |

**Superficies que la v1.2 no dibuja y siguen existiendo** (cero pérdida):
- banners de MP, de impresión y de Caja (`4348-4388`, `4654-4672`, `4777-4823`);
- conmutador móvil Menú/Orden (`4637-4650`);
- cajón de navegación con permisos (`4676-4775`; `canSee` `2808-2829`);
- pestañas de asiento (`5369-5408`);
- disparar tiempos;
- `TurnoGate`, `ImpresionesPendientesDeCaja` y `AperturasPendientesDeCaja` (`pos/layout.tsx`);
- `POSAlerts` (`6882`);
- **ramas sólo móviles:** `isMobileDevice` y `isMobileRestricted` (`2794-2796`) controlan:
  - `POSCopilot` y `CustomerMemory` (`5075-5084`);
  - los botones de impresora BT y USB (`4474`, `4486`);
  - el cajón deshabilitado para mesero y barra (`5149-5151`).

  Ninguna aparece con un viewport de escritorio, así que T-03 incluye un viewport móvil.

Además, por debajo de 900 px la v1.2 oculta el ticket y nunca asigna `body[data-mobile="ticket"]` (:1199-1205). Portada tal cual, en un teléfono el ticket se perdería.

---

## 4. Bandera y rollback

### 4.1 Mecanismo: el que ya está en `main`

`version-de-interfaz.js` explica en su propio encabezado por qué la bandera **no** vive en la nube: `platform-config.ts` falla a `{}`, y eso haría que la interfaz «cambi[e] de identidad exactamente cuando se cae el internet».

Hay una segunda razón, medida aquí: `feature_flags` **no está** en la lista `ALLOW` del proxy del POS (`pos-db-policy.ts`; `grep feature_flags` no devuelve nada). Una lectura desde la terminal daría un 403 mudo (L-12).

| Aspecto | Especificación |
|---|---|
| Valores | `ui_version`: `v1` (actual) o `v2` (esta integración). **Ausente → `v1`.** **Presente e inválido → configuración inválida → NOT_PROVISIONED, sin Pedro ni POS** (`config-schema.js:60-61`; `main.js:116-123`, `1057-1061`). La tolerancia de `normalizar()` (`version-de-interfaz.js:50-53`) sólo aplica a configuraciones que ya pasaron la validación |
| Dónde vive | `config.json` de cada terminal (`config-schema.js:51-62`). Viaja con el aprovisionamiento y sobrevive sin red. **Se escribe sólo con una herramienta que llame a `configSchema.validate` antes de guardar; nunca a mano en operación** |
| Cuándo se decide | **Una vez, al arrancar Electron** (`main.js:286`). No se relee al desbloquear, al abrir turno, al refrescar el catálogo ni cuando vuelve la red. Cambiar exige reiniciar la terminal (`version-de-interfaz.js:23-31`) |
| Cómo llega al renderer | **Falta, y es el único cableado nuevo de la bandera.** `git grep ui_version -- dashboard-app/src` devuelve 0, y `cfg.uiVersion` (`main.js:291`) no tiene consumidor. **Canal:** agregar `FULLSITE_UI_VERSION` a `identityForUrl` (`main.js:761-767`), junto a `FULLSITE_UI_PACKAGE`. El preload lo escribe por IPC síncrono **antes de cualquier script** (`preload.js:5-11`; `main.js:778-784`, que valida ventana, marco principal y origen). Cada recarga o crash del renderer reescribe el mismo valor congelado de main: sin red, sin timeout, sin otra terminal. El renderer sólo respeta `v2` si `window.fullsiteApp?.isElectron === true` (`preload.js:14-21`). Toca `main.js`, así que viaja en el mismo instalador que las pieles (D10) |
| Canal descartado | Leer `ui.version` de `GET /identity` o `/health` de Pedro. Son rutas abiertas (`credencial-lan.js:54`). (a) Una relectura con timeout en un remontaje cambiaría `v2` → `v1` a media comida, justo lo que prohíbe `version-de-interfaz.js:29-31`. (b) Si `getBridgeUrl()` apunta a otra máquina (`pos_bridge_host` o `FULLSITE_BRIDGE_URL` manual, `bridge-url.ts:59-68`), leería la versión **de la caja**, no la propia |
| Navegador sin Electron (producción) | `v1` siempre. El módulo deja `localStorage` sólo para DEV (`version-de-interfaz.js:65-67`) |
| Preview y laboratorio | Override `#ui=v2` / `#ui=v1` **sólo** si `NODE_ENV !== 'production'` o el host es un preview. Hash y no query porque `pos/layout.tsx:487,568,788,800` decide a dónde aterrizar con `!window.location.search`; #408 lo midió. El hash se pierde con `router.push('/pos/mesas')` (`layout.tsx:487-488`), así que el override se guarda en `sessionStorage` **sólo en preview** |
| Qué controla | Sólo marcado y CSS. Mismos handlers, hooks, permisos y llamadas. **Invariante:** con el mismo guion, `v1` y `v2` producen la misma secuencia de red y de comandos (T-12). Por eso **nada de este rediseño agrega sondas de red** (§5.1) |
| Forma del código | Patrón #408: cada componente tiene dos ramas, y con `v1` devuelve exactamente el marcado actual, comprobado con un diff normalizado. CSS en `pos-v2.css`. `globals.css` no cambia (5 tests leen su texto) |
| Tokens | Se mapean a los nombres existentes (`--bg`, `--surface*`, `--line*`, `--text-*`, `--accent*`, `--info/warn/crit*`). **Un detalle:** `pos/layout.tsx:854-864` fija esas variables **en línea** sobre `.pos-kiosk`, y una regla de hoja de estilos no le gana al estilo en línea del mismo elemento. `data-ui="v2"` va en un **contenedor descendiente**: las propiedades personalizadas redefinidas ahí aplican a todo su subárbol, sin tocar `layout.tsx`. Se reutiliza el guardián de tokens de `redesign/pos-ds-v2` (`6b7b7bc6`) |
| Tipografía (Q2, decidida) | **Se mantiene Schibsted Grotesk**, con Public Sans e IBM Plex Mono, **y su disponibilidad offline tiene que verificarse, no suponerse.** Lo que hay hoy:<br>1. Las tres familias salen de `next/font/google` (`app/layout.tsx:2`, `22-49`). Se descargan **al compilar** y se sirven desde el propio origen, bajo `/_next/static/media`. La compilación necesita red; la ejecución no.<br>2. **Hoy el POS no usa Schibsted:** `--font-display` sólo existe bajo `[data-ds="v3"]` (`globals.css:710-711`), y `/pos` no lleva ese atributo porque AppShell lo omite (`AppShell.tsx:60-62`). `v2` define `--font-display: var(--font-schibsted), …` dentro de su contenedor (`pos-v2.css`), sin tocar `globals.css`.<br>3. **Electron:** el paquete offline copia la exportación estática (`build-offline-ui.cjs:102-109`), que debe incluir los `.woff2`. La CSP sólo admite `font-src 'self' data:` (`offline-ui/protocol.js:12`).<br>4. **Navegador:** el Service Worker enumera `/_next/static/` al instalarse y cachea `woff2` (`public/sw.js:122-131`, `215`).<br>Verificación: V-16 y T-20 |
| Tema | No se porta `fs-theme` de la v1.2. En `main`, `tenant-theme` y `ThemeToggle` no se usan en `app/pos` (`git grep` → 0). El owner durable del tema (P16) existe sólo en FRESH; `v2` lo consume cuando llegue (D6) |
| Multi-tenant | La bandera es por terminal. El despliegue por restaurante se hace aprovisionando sus terminales. No se escribe `amalay` en ninguna parte (T-16) |
| Instalador | En Electron la UI viaja en el paquete instalado (`REDESIGN-INSTALL-IMPACT.md` §3-§5). `v2` requiere un instalador que traiga las dos pieles. Después se enciende por configuración y reinicio. Ver la decisión Q5 |

### 4.2 Niveles de rollback

| Nivel | Cómo | Alcance | ¿Red? | Tiempo | Verificación |
|---|---|---|---|---|---|
| R0 | **Borrar la clave `ui_version`** (ausente = `v1`) con la herramienta de aprovisionamiento que valida, y reiniciar. Nunca editar a mano: un `"V1"` mal escrito deja la caja en NOT_PROVISIONED | Una terminal | No | Un reinicio | Log `[main] Interfaz: v1 (por omisión)` (`main.js:287`); `data-ui="v1"` en el DOM; captura igual a la línea base `v1` |
| R1 | R0 en todas las terminales del restaurante | Un restaurante | No (LAN o in situ) | Un reinicio por terminal | En `/health` de cada una, el campo **`identidad.ui.version`** (`identidad-de-terminal.js:68`) = `v1`. No confundir con `build.ui_version` (`identidad-de-build.js:40`), que dice con qué se compiló, no qué se sirve |
| R2 | Revertir el PR del rediseño | Código | Sí | Un deploy más un instalador en Electron | Hash del paquete de UI igual al anterior (`identidad-de-build.js`: `ui_revision`); procedimiento en `docs/pos/ROLLBACK-INSTALADOR.md` |
| R-prev | `#ui=v1` en preview o lab | Una sesión | No | Inmediato | `data-ui="v1"` |

**Antes de poner `ui_version: v2` en cualquier Caja: E1 (`ORDER_SEND` → KDS) en PASS, sin excepción** (§7.3). Además:

**Prueba de rollback obligatoria antes de encender `v2` en cualquier terminal** (CLAUDE.md §10.7):
1. Dejar preparados una mesa con renglones sin enviar, un envío en cola sin red y un cobro en efectivo en cola.
2. Aplicar R0 (`v2` → `v1`, reinicio).
3. Comprobar que no cambió nada:
   - el borrador (owner P19);
   - el journal (owner P17);
   - `sync_queue`;
   - que no haya `ORDER_SEND` ni `ORDER_SAVE` nuevos (CDP y log de Pedro).
4. Repetir de `v1` a `v2`.
5. Negativo: intentar guardar `"V1"` y `true` con la herramienta. Debe rechazarlos, y la terminal debe seguir arrancando.

---

## 5. Estados

Cada estado tiene seis entradas: cómo lo muestra la v1.2, cómo es hoy, la **especificación integrada**, la **señal real** de la que se alimenta y el **criterio** que lo prueba (IDs de §6 y §8).

### 5.1 Offline

- **v1.2.**
  - `S.online` es un booleano que se cambia a mano (`UI.toggleNet`, :2542). Las píldoras de Red y Cocina son **botones** que alternan ese estado (:2560-2572).
  - Muestra «Offline · N en cola» y vacía la cola a los 600 ms de reconectar.
  - El aviso siempre dice «Sin internet. El punto de venta sigue cobrando e imprimiendo.»
- **Hoy.**
  - `online` viene de `navigator.onLine` y sus eventos (`page.tsx:1967-2022`).
  - La pantalla de venta **no** revisa la salud de Pedro; el único `/health` es el de la huella (`pos/layout.tsx:359`).
  - Banners ámbar de Caja (`4800-4823`) y de mesas (`mesas/page.tsx:913-936`).
- **Especificación integrada.** Tres píldoras de **sólo lectura** (nunca botones), alimentadas **sólo por señales que ya existen**. El rediseño no agrega sondas de red: la decisión lo prohíbe (`REDISENO-V1.2-INTEGRATION-PLAN.md:40`, «no hay … acceso a redes para el rediseño») y romperían la invariante T-12.

| Píldora | Señal existente que consume | Estados |
|---|---|---|
| Red (WAN) | El `online` actual (`page.tsx:1967-2022`), la cola pendiente y el evento `pos-sync-auth-required` | En línea · Sin internet |
| Caja / LAN | `lecturaCuentaCaja`: `procedencia`, `autoritativa` y el estado `incierta` (`page.tsx:2629-2631`; `pedro-cliente.ts`). Sólo en modo Caja (`requiereCaja()`); en web la píldora no se muestra | Caja lista · Caja sin autoridad · Caja incierta |
| Cocina | El resultado del último envío. **Ya hoy depende del modo** (`escribeEnCaja`, `page.tsx:2631`): en Caja, el acuse de `ORDER_SEND`; en web, la respuesta de `ORDER_SENT` a `/events` (regla dura #5, `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md` §4) y el diálogo `kitchenFailure` (`5882-5913`). En FRESH será el `receipt` del journal P17. La píldora consume una sola interfaz (`cocinaRecibe: boolean \| null`) que implementa el dueño del camino | Cocina recibe · Cocina sin acuse · Sin envíos todavía |

  - **Límite honesto:** la píldora Red hereda la debilidad de `navigator.onLine`, que CLAUDE.md §11 prohíbe confundir con conectividad real. Una sonda WAN real y la salud de Pedro en la pantalla de venta **son cambios de comportamiento**: van en su propio PR, fuera de `ui_version` y con sus pruebas (Q9).
  - **El texto sale del estado de las tres píldoras, no es una promesa fija:**
    - Sin WAN, con Caja lista: «Sin internet. Se puede cobrar en efectivo e imprimir; se sube al reconectar.»
    - Caja incierta o sin autoridad: «La caja no confirma el estado. No cierres cuentas hasta que responda.»
  - **Deshabilitar formas con terminal externa sin WAN también es un cambio de comportamiento**, y hoy no se puede hacer bien: `PaymentMethodDB` sólo trae `type` = `cash` | `card` | `other` (`pos-data.ts:400-407`), que no distingue una terminal bancaria autónoma de una integrada. En el rediseño esas formas sólo muestran un aviso local; la decisión va en Q9.
  - `saveOrder` sigue cayendo a `OFFLINE_QUEUED` (regla dura #3). La UI sólo lo refleja.
- **Criterio:** V-09, T-06 y T-07.

### 5.2 Carga

- **v1.2:** **no existe.** Sin esqueletos ni spinners; sólo estados vacíos (:2664, :3931…).
- **Hoy:**
  - fallback de Suspense con colores fijos (`page.tsx:214-218`);
  - `loadingMesa` con un seguro de 3 s, que deshabilita Enviar y Cuenta (`2355`, `5313`, `5321`);
  - «Cargando opciones…» (`427`);
  - spinner en Enviar (`5316`); «Terminal...» (`6678`);
  - esqueletos: 0 (búsqueda de `skeleton` en `app/pos` y `components/pos`).
- **Especificación integrada:**
  1. Tres estados que no se confunden:
     - *cargando*: esqueleto del tamaño final, para que no brinque el layout;
     - *vacío verificado*: texto explícito;
     - *error de carga*: `role=alert` y «Reintentar».
     - **Una foto incompleta no es un «no hay nada»** (L-11). Con `order_snapshot_complete=false`, Mesas muestra «Salón incompleto: la caja no confirma todas las cuentas», no un salón vacío.
  2. Los botones conservan sus guardas y muestran el spinner **dentro**, sin cambiar de tamaño.
  3. El fallback de Suspense usa tokens.
- **Criterio:** V-12 y T-08.

### 5.3 Error

- **v1.2**, contrato que se adopta:
  - `UI.aviso(kind, msg, {global})`.
  - **Global:** franja anclada a la barra, encima de hojas, bloqueo y gaveta; 2.8 s.
  - **Local:** dentro de la hoja activa, junto a su acción; un mensaje por hoja; errores de 6 s.
  - Al cerrar la hoja, sus errores se descartan y sus confirmaciones pasan a la franja (:2475-2523).
- **Hoy:**
  - un toast de texto sin tipo, 2.5 s, sin `aria-live` (`page.tsx:2892-2896`, `5874-5878`);
  - `window.alert/confirm` en 3 lugares;
  - errores en línea con `role=alert` en `428`, `5455` y `1249`.
- **Especificación integrada.** Un componente `PosAviso` con **origen tipado**, como exige la decisión (`REDISENO-V1.2-INTEGRATION-PLAN.md:38`): la UI no inventa errores.

| Clase | Ejemplos | Dónde | Duración | Accesibilidad |
|---|---|---|---|---|
| Global de estado | Red, Caja, Cocina, «N sincronizadas», «N con conflicto» | Franja de la barra, `LAYER.toast` = 300 (`components/ui/layers.ts`) | 2.8 s o mientras dure la condición | `aria-live="polite"` |
| Local de validación | «Falta $X», «Captura algo», «Elige 1 en Término» | Dentro de su hoja, a ≤24 px de la acción que corrige | **Hasta que se corrija** (en dinero no hay temporizador) | `role="alert"` |
| Bloqueante | Conflicto de revisión (`5611-5738`), «La comanda no llegó a cocina» (`5882-5913`), cobro incierto (P17) | Diálogo `LAYER.blocking` = 120. **Nunca** baja a aviso | Hasta que haya decisión | `role="alertdialog"`, foco atrapado |

  **Respuestas HTTP** (CLAUDE.md §11):

| Respuesta | Qué muestra |
|---|---|
| `503` resuelto por el Service Worker | Nada nuevo; lo refleja la píldora Red |
| `401/403` de autenticación | Vuelve al bloqueo con «Tu sesión expiró» (evento existente `pos-sync-auth-required`, `pos/layout.tsx:234-243`) |
| `403` de negocio | Error local persistente con el motivo del servidor |
| `409` de revisión | El diálogo de conflicto existente |

- **Criterio:** V-04 a V-07 y T-09.

### 5.4 Cobro

- **v1.2** (:3073-3148):
  - total, propina 0/10/15/20 %, 18 formas en retícula sin scroll y teclado de 290 px con Exacto;
  - «Falta dinero» bajo Recibido, que se borra al corregir;
  - calcula la propina sobre el total **con IVA** (:3096);
  - toma la tasa del impuesto de su `TENANT` de demo (:2703);
  - trata Cortesía, Influencer y Mercadotecnia como **formas de pago** que «requieren autorización» (:3112-3118, :3137).
- **Hoy:** dos caminos.
  - Modal legacy (`6464-6879`, `max-h-[96vh] overflow-y-auto`).
  - `CobroDeCaja` bajo Electron (`4786`).
  - Guardas: turno (`3964`), revisión (`3389-3419`), `operationLock` (`2878`), `save_operation_id` (`3960`, `4038`). Botón deshabilitado si lo recibido es menor al total (`6727`).
- **Especificación integrada:**
  1. **La piel de la v1.2 viste los dos caminos. La UI no calcula dinero:** propina, IVA, total, cambio y restante vienen del código actual. La etiqueta del impuesto usa `iva_rate` del tenant (L-02).
  2. **Formas de pago = catálogo del tenant** (`pos_payment_methods` o el catálogo de Caja, `pos-data.ts:409-416`), no 18 fijas, **en el orden del catálogo** (hoy `order=name.asc`). Si no caben todas, el resto va a «Más formas», a un toque (V-10, V-11).
  3. **Pago mixto** conserva su flujo (`6788-6873`, «Faltan $X» / «Confirmar pago mixto»).
  4. **Sin formas de pago nuevas.** `PaymentMethodDB` no tiene un campo de autorización (`pos-data.ts:400-407`). La cortesía real es un modo de `DiscountModal`, con PIN o huella de gerente (`page.tsx:749-1066`). El rediseño viste ese flujo tal como es y **no** agrega Cortesía, Influencer ni Mercadotecnia como formas de pago.
  5. **Efectivo:** se conservan las dos guardas. «Cobrar» deshabilitado mientras lo recibido sea menor al total, y «Falta $X» bajo Recibido. El error de la v1.2 es ayuda visual, no la guarda.
  6. **En vuelo** (P17):
     - «Cobrar» pasa a «Cobrando…», deshabilitado y sin cancelar mientras `operationLock` esté tomado.
     - Si el journal marca `uncertain`, aparece un diálogo bloqueante: «No sabemos si el cobro entró. No cobres de nuevo. Verificando…», con la acción de verificación que defina P17.
     - **Nunca** un «Reintentar» que dispare un segundo pago.
     - Los estados P17 existen sólo en FRESH; en `main` el journal (`pedro-comandos.ts`) no los tiene.
  7. **Offline:** el efectivo pasa por `OFFLINE_QUEUED` con «Cobrado sin internet · se sube al reconectar». Deshabilitar las formas con terminal externa queda en Q9 (§5.1).
- **Criterio:** V-10, V-11, V-13, T-10 y T-12 (exactamente un pago por intento).

### 5.5 Modificadores

- **v1.2** (:2970-3197): cantidad, asiento, nota (40 caracteres; vacía da «Captura algo»), tiempo y chips. **Todo es opcional:** sin grupos, obligatorios, mínimos ni máximos (:3042).
- **Hoy:** `ModifierModal` (`page.tsx:266-735`) con grupos, obligatorio, mínimo y máximo; radio; niveles con «Omitir»; «Quitar»; confirmar bloqueado; «Cargando opciones…».
- **Especificación integrada:**

| ID | Regla |
|---|---|
| M-01 | Cada grupo con encabezado de su regla («Obligatorio · elige 1», «Elige de 1 a 3», «Opcional · hasta 2») y un contador `n / máx` en vivo |
| M-02 | Con máximo 1, `role="radiogroup"` y radios. Hoy es un `checkbox` `sr-only` con forma redonda (`page.tsx:538-545`): quien usa lector de pantalla oye «casilla» donde la regla es «elige uno». Corregir la semántica sin cambiar `toggleGroupOption` es visual y cabe en el rediseño. Con más de 1, `role="checkbox"` y `aria-checked`. **No** se usa `aria-selected` en botones: la v1.2 lo hace 52 veces y es semánticamente inválido |
| M-03 | «Agregar $X» deshabilitado mientras falte un obligatorio, con el motivo local a ≤24 px («Falta elegir: Término»). Tocarlo lleva al primer grupo incompleto |
| M-04 | **Los nombres nunca se truncan con «…».** Pasan a 2 líneas; si no alcanza, a 3 con la letra un paso más chica. Motivo: POS-10 de `docs/audit/EDUARDO-REQUISITOS.md` («el KDS muestra EXACTO lo configurado»). La v1.2 corta «Extra aguac…» a 1366 y a 1280 (captura `03-modificadores`) |
| M-05 | Se conservan los niveles con «Omitir», «Quitar» desde la receta, el precio por modificador y POS-04 (sin modificadores, la hoja no se abre) |
| M-06 | Sólo la lista de grupos hace scroll. El pie «Cancelar / Agregar» queda fijo y visible en las 3 resoluciones |

- **Criterio:** V-08, V-14 y T-11.

### 5.6 Sincronización

- **v1.2 / v1.2.1** (`SYNC` :3711; diff v1.2→v1.2.1):
  - estados `pending`, `synced` y `error` (llamado «conflicto · N intentos»), con la leyenda «se reintenta solo»;
  - cola conflicto → pendiente → reciente (≤10 min) → anterior; 40 visibles más «+N anteriores»;
  - texto «Por qué no se pierde ni se duplica».
- **Hoy:**
  - IDB `fullsite_pos` v4 con `sync_queue` (`pos-offline-db.ts:7-101`); `TERMINAL_NON_RETRYABLE` queda invisible (L-09);
  - journal en LS `pos_comando_pendiente:*`;
  - eventos `pos-order-synced` / `pos-order-conflict` (`2738-2768`).
- **Especificación integrada** (pantalla nueva, **sólo lectura**, F3, después de P17):
  1. **Los estados son los del sistema, no los de la v1.2.** Clases reales de la cola (`SyncErrorClass`, `pos-offline-db.ts:28`), con la etiqueta que les toca:

| Clase | Etiqueta | Acción |
|---|---|---|
| `TRANSIENT_RETRYABLE` | «Se reintenta solo». Aquí **sí** es cierto | Reintentar ahora |
| `STALE_WRITE_CONFLICT` | «Necesita decisión» | Abrir el diálogo de conflicto existente |
| `AUTH_EXPIRED` | «Inicia sesión para subir» | Ir al bloqueo (`emitAuthRequired`) |
| `TERMINAL_NON_RETRYABLE` | «Rechazada · avisar a soporte» | Ver motivo y avisar |

  Sin clase: «Pendiente». Los estados del journal P17 (`pending`, `sent`, `receipt`, `uncertain`) existen sólo en FRESH y entran cuando P17 esté en `main` (D5).
  2. **Ni un conflicto ni un cobro incierto se presentan como reintento automático:**
     - conflicto: «Necesita decisión», que abre el diálogo existente;
     - cobro incierto: §5.4-6.
  3. **Toda fila no subida tiene su acción** (L-09): Reintentar, Resolver, Iniciar sesión o Avisar a soporte.
  4. Se adopta **el orden de la v1.2.1** y el renglón «+N anteriores · siguen en la cola local, no se borran». Los 10 min de «reciente» pasan a configuración.
  5. **Se quita, o se condiciona, «Por qué no se pierde ni se duplica».** Es falso para peticiones sin `save_operation_id`: `api/pos/save-order/route.ts:20` dice «Legacy requests without save_operation_id bypass idempotency».
  6. Ids de operación truncados. Nunca tokens, hashes privados ni PIN (P20 `renderer_secret_audit`).
- **Criterio:** V-13, V-15 y T-13, con datos del IDB y del journal reales.

---

## 6. Criterios visuales verificables: 1440×900, 1366×768, 1280×800

### 6.1 Condiciones de medición (corrigen la batería v1.2)

| Condición | Valor | Por qué |
|---|---|---|
| Viewports | Las tres resoluciones en px CSS. Sólo para el inventario de cero pérdida (T-03), además, un viewport móvil con user agent móvil | Sin el viewport móvil no se ven las ramas de `isMobileDevice` (`page.tsx:2794`) ni el ticket bajo 900 px |
| **DPR, pantalla táctil y escala** | **PENDIENTE (Q3): inventario físico de PDV1, PDV3 y SERVER1. No se suponen.** Hasta tenerlo, toda corrida es **DIAGNÓSTICO**: registra con qué parámetros corrió y no se usa para aprobar ningún criterio | La v1.2 se midió con DPR 1 (V12:183) y sin pantalla táctil, así que `ADAPTA` eligió `sm` (0.95) en las tres (`reporte-v1.2.txt`). Eso es una configuración de laboratorio, no la de una terminal |
| Umbrales que dependen de Q3 | V-11 (cuántas formas de pago se ven), V-14 (tamaño **físico** de 48 px), V-17 (celdas y columnas de la retícula) y V-19 (capturas de referencia) | Se fijan con el inventario, no antes |
| Registro del inventario | Por terminal: modelo, resolución nativa, escala del sistema operativo, `window.devicePixelRatio` y `innerWidth`×`innerHeight` en el Electron real, si es táctil, tamaño físico de la pantalla y distancia de uso | Es lo que hace falta para convertir 48 px CSS en milímetros bajo el dedo |
| Red | Bloqueada salvo el origen de la app y los mocks; 0 peticiones externas | CSP de Electron |
| Datos | Fixture determinista en un tenant de pruebas (no AMALAY de producción, CLAUDE.md §13), más un segundo tenant (T-16) | — |
| Reloj | Fijo (`page.clock`) | Capturas deterministas |
| Variante | `v1` y `v2` | `v1` es la línea base de cero pérdida |

### 6.2 Criterios

✔ = portado de la batería v1.2 · ✚ = nuevo.

| ID | Criterio | Método | Umbral |
|---|---|---|---|
| V-01 ✔ | El caparazón ocupa exactamente el viewport | `getBoundingClientRect` de la raíz del POS | ±0.6 px (V12:33-36) |
| V-02 ✔ | Sin scroll de documento, body ni ventana | `scrollHeight` contra `clientHeight`; `scrollY` | 0 (V12:37-41) |
| V-03 ✔ | La capa superior cabe en el viewport | bbox | ±0.6 px |
| V-04 ✔ | Ningún aviso activo queda tapado | `elementFromPoint` en 5 puntos interiores (V12:53-73) | 5/5 |
| V-05 ✚ | Un error local vive dentro de su hoja y no en la franja | `data-aviso-origen` y `data-aviso-clase` (sustituyen a `data-origen` / `data-global`) | 100 % |
| V-06 ✔ | El aviso no se encima con la acción final, Recibido ni los totales | intersección de bboxes con recorte por overflow (V12:57-64) | 0 px² |
| V-07 ✔ | El mensaje esperado queda cerca de su campo o acción | distancia entre bboxes (V12:102-118) | ≤24 px |
| V-08 ✚ | Nombres de producto y de modificador, y montos, sin «…» ni recorte | `scrollWidth ≤ clientWidth` y `scrollHeight ≤ clientHeight` en `[data-texto-critico]`; sin `text-overflow: ellipsis` computado | 0 |
| V-09 ✚ | Píldoras con texto, color y `aria-label` coherentes con la señal | Tabla de verdad de las combinaciones **alcanzables** de Red (2) × Caja (3) × Cocina (3). Las imposibles se listan en F0 con su porqué | 100 % de las alcanzables |
| V-10 ✔ | Cobro: cada forma **visible** completa y sin cortar; **todas** las del catálogo alcanzables con ≤1 toque adicional («Más formas»); orden del catálogo; «Cobrar» completo | bbox contra contenedor (V12:121-131), con los catálogos de 8, 18 y 24 formas | 100 % |
| V-11 ✚ | Cobro: la hoja completa, sin scroll interno, en las tres resoluciones | `scrollHeight` de la hoja | 0 px. El **número de formas visibles** por resolución queda **sin fijar hasta el inventario físico (Q3)**; no se supone escala. El umbral de 18 de la v1.2 no vale: se midió a 0.95 y DPR 1 |
| V-12 ✚ | Ningún estado vacío visible mientras está en curso **la petición que alimenta esa vista** (los sondeos de fondo, como el de 3 s de Mesas, no cuentan) | `route` con retraso sobre esa petición; `[data-estado="vacio"]` | 0 |
| V-13 ✔ | Listas con scroll sin filas a medias; la última se ve entera | barrido de `overflowY` (V12:138-163) | 0 filas cortadas |
| V-14 ✚ | Objetivos táctiles | bbox del **área que recibe el toque**: `button`, `[role=button]`, `a`, `select`, inputs visibles; en inputs `sr-only` (`page.tsx:538-543`) se mide su `label` visible | **Alto ≥48 px** en todo control (el piso vigente de `.pos-kiosk` sólo fija `min-height: 48px` en button, input y select, `globals.css:58-64`), y **ancho ≥48 px** en controles sólo de icono (regla nueva de este plan). La v1.2 no lo cumple: `.tag` 24 px, `.pill` 28, `.seg` 38, `.seat` e `.icon-btn` 40. **La densidad de la v1.2 no puede bajar un renglón del ticket de 48 px:** si no caben, hay scroll sin filas a medias (V-13) |
| V-15 ✚ | Contraste | WCAG sobre los colores computados en el navegador, más axe `color-contrast` | ≥4.5:1 en texto normal; ≥3:1 en texto grande y bordes de controles. Cálculo previo **sin medir en navegador** (INFERENCIA): `--text-4` sobre `--bg` 2.55:1; blanco sobre ámbar 2.15:1. El texto del mosaico se elige por contraste contra el color de categoría del tenant |
| V-16 ✚ | Tipografía **offline** (Q2) | Con la red bloqueada por completo (Electron desde su paquete; navegador desde el SW tras una visita previa):<br>- `document.fonts.check` de Public Sans, **Schibsted Grotesk 500** e IBM Plex Mono;<br>- `getComputedStyle` de los títulos y cifras grandes de `v2` resuelve a Schibsted;<br>- en la red, las fuentes salen sólo de `'self'` | 3/3 cargadas; **0 peticiones** a `fonts.googleapis.com` o `fonts.gstatic.com`; 0 violaciones de CSP; montos con `tabular-nums` |
| V-17 ✚ | Retícula de productos sin scroll | celdas ≥152×92 (:2322) y paginador visible | 0 scroll |
| V-18 ✚ | Cero pérdida | T-03 | 0 elementos de `v1` ausentes sin excepción firmada |
| V-19 ✚ | Captura estable | `toHaveScreenshot` | `maxDiffPixelRatio` 0.002 contra la línea base aprobada |

### 6.3 Estados a medir

| # | Estado |
|---|---|
| E01 | Bloqueo |
| E02 | Mesas en plano y en lista |
| E03 | Venta vacía |
| E04 | Venta con 4 asientos y >14 renglones |
| E05 | Modificadores con obligatorio |
| E06 | Obligatorio incompleto |
| E07 | Nota vacía |
| E08 | Cobro en efectivo con cambio |
| E09 | Falta dinero |
| E10 | Sin monto |
| E11 | Mixto |
| E12 | Forma que requiere autorización |
| E13 | Cobro en vuelo |
| E14 | Cobro incierto (P17) |
| E15 | Sin WAN, con Caja lista |
| E16 | Sin Caja |
| E17 | Cocina sin acuse |
| E18 | Cobro abierto con caída de red |
| E19 | Conflicto de revisión |
| E20 | Cola con 0, 1, 5 y 45 operaciones (F3) |
| E21 | Carga lenta |
| E22 | Error de catálogo |
| E23 | Modo Caja contra modo web, en venta y en cobro |

La matriz completa: 23 estados × 3 resoluciones × 2 variantes. **Los parámetros de dispositivo (DPR, pantalla táctil, escala) se agregan cuando exista el inventario Q3.**

---

## 7. Dependencias con P19 y sus vecinos: condición de entrada

### 7.1 Estado al 2026-09-26, mediodía

| Contrato | Estado | Fuente | Grado |
|---|---|---|---|
| P01–P15 | PASS (`tested_locally`), fingerprint `17b3fd09…` | `~/Documents/Codex/…/FULLSITE-STORES-ORCHESTRATION-PASS-20260923-183722.json` | archivo |
| P16 · P17 · P18 | PASS `tested_locally` (09-24 15:11 · 09-24 11:54 · 09-23 23:39) | historia de Codex (copias pegadas desde Windows) | REPORTADO |
| **P19** | **Abierto.** Integral `fresh_p19_pos_kds_integral` = `blocked` (manifiesto `dc717fc4…`, en Windows). 11:26: GUI/CDP sintético `BLOCKED` (`EDITOR_CREATE` → `FRESH_DRAFT_UNAVAILABLE`). 11:53: diagnóstico de admisión `scoped_pass`, fingerprint `f81149e9…` | Contratos en `main`: `platform-evidence.ts` (`a9234098`, `aee90ec9`). Horas y fingerprints: historia de Codex | contrato: HECHO · hechos del gate: REPORTADO |
| P20 | Sin implementar | historia de Codex | REPORTADO |
| Lint `pos/page.tsx` | 38 errores / 36 avisos en `main` (medido por #408 contra `main` de su fecha); 37/36 en FRESH | PR #408; historia de Codex | HECHO / REPORTADO |
| `uiPolicy` | `hold`. En Windows hay una barrera `FRESH_DRAFT_ACTION_BINDINGS_INCOMPLETE`; en `main` sólo es un invariante del importador (`platform-evidence.ts`) | idem | REPORTADO / HECHO |

**Último estado en `main` (`2a1b8494`, 2026-09-26):**
- El GUI/CDP sintético reanudado (`fresh_p19_gui_cdp_synthetic_resumed`) sigue **`blocked`**.
- El bloqueo es del **arnés**, no del producto: `blocker: 'synthetic_fixture_network_isolation'` (mDNS).
- Hubo 0 ejecuciones de Electron y de GUI; sólo corrió 1 build.
- Pendientes: `harness_preflight`, `integral_gui`, `replay_restarts`, `concurrency_recovery`, `chromium_network_audit`, `renderer_secret_audit` e `integral_regression`.
- **Los nombres de los pendientes cambian de un manifiesto a otro**, así que las condiciones de §7.3 se leen por significado. La correspondencia está en la tabla de abajo.

| Condición | Manifiesto de admisión (`aee90ec9`) | Manifiesto reanudado (`2a1b8494`) |
|---|---|---|
| E0 (tramo de edición) | Admisión: login → turno → `EDITOR_CREATE` 1/1 (REPORTADO) | `harness_preflight` y la parte de `integral_gui` que va hasta Guardar con recibo durable. **Los manifiestos no separan edición de envío.** El que cierre E0 tiene que declarar ese tramo por separado, o E0 no se puede demostrar (ver E7) |
| E1 (envío) | `integral_gui`, `kds_replay`, `two_restarts` | `integral_gui`, `replay_restarts` |
| E4 | `renderer_secret_audit` | `renderer_secret_audit` |
| E6 | `ack_concurrency_closure`, `abrupt_recovery`, `complete_netlogs`, `integral_regression` | `concurrency_recovery`, `chromium_network_audit`, `integral_regression` |

**Pendientes de P19 que declara el manifiesto de admisión** (`aee90ec9`):
- `integral_gui`
- `kds_replay`
- `two_restarts`
- `ack_concurrency_closure`
- `abrupt_recovery`
- `complete_netlogs`
- `renderer_secret_audit`
- `integral_regression`
- `physical_validation`

### 7.2 La dependencia que no está en ningún gate: FRESH no está en Git

- P16–P19 viven sólo en `C:\AMALAY-LAB\SOURCE\fullsite-fresh-1.4.2`: un árbol **sin Git** con base `418933f4`, anclado sólo por fingerprints de contenido.
  - Comprobado aquí: `418933f4` es ancestro de `main`, y `git log 418933f4..origin/main -- dashboard-app/src/app/pos dashboard-app/src/components/pos …` sale vacío.
  - `electron-app/fresh/`, `lib/fresh-draft-editor.ts`, `lib/fresh-domain.ts` y `components/pos/PosUiBoundary.tsx` no existen en `main` (`git cat-file -e`).
- **Consecuencia:** cablear la v1.2 sobre el `page.tsx` actual sería cablearla sobre un camino que FRESH va a reemplazar. Hoy `main` manda `ORDER_SENT` (`page.tsx:3653-3654`) y FRESH certifica cero `ORDER_SENT`. Además el refactor de lint de FRESH extrae hooks de ese mismo archivo, fuera de Git; cualquier edición previa se fusionaría a mano.
- **Primero hay que reconciliar** (prioridad #3 de CLAUDE.md §20). La v1.2 se conecta a los hooks que salgan de ahí, no a las 7,045 líneas.

### 7.3 Condiciones de entrada

Todas se cumplen sobre el **mismo fingerprint y commit**.

| ID | Condición | Qué la prueba |
|---|---|---|
| **E0** | **El tramo de edición de P19 GUI/CDP está completo.** Definición de Daniel (2026-09-27): **GUI sintética real** (Electron con perfil sintético, manejada por CDP) que recorre, en la misma corrida:<br>1. **login**;<br>2. **turno**;<br>3. **borrador**: el owner P19 lo crea (`EDITOR_CREATE` sin `FRESH_DRAFT_UNAVAILABLE`);<br>4. **acción válida**: una edición que el owner acepta;<br>5. **Guardar con recibo durable**: el owner devuelve el recibo del guardado y la UI sólo limpia lo pendiente después de ese recibo (contrato P17).<br>**No incluye `ORDER_SEND` → KDS**: eso es E1. Deriva de Q8 (2026-09-26): sin E0 no se escriben componentes dentro de `/pos`, ni se implementa o publica nada. **Hoy no se cumple:** según la historia de Codex (REPORTADO), el diagnóstico de admisión pasó 1/1 de login → turno → `EDITOR_CREATE`, y el GUI/CDP reanudado está `blocked` con 0 ejecuciones de GUI (§7.1). Faltan en GUI real la acción válida y Guardar con recibo durable. Cumplir E0 **no** autoriza código por sí solo: la autorización se vuelve a pedir | Manifiesto P19 importado en `main` (requiere E7) con los cinco pasos en PASS en una sola corrida de GUI sintética real, y el recibo durable identificado en la evidencia. Más la autorización escrita de Daniel |
| E1 | **P19 GUI/CDP pasa el envío:** `integral_gui` + `kds_replay` + `two_restarts` en PASS. POS → `ORDER_SEND` → KDS en Electron real, con reload, crash del renderer, cierre normal, dos reinicios, exactamente un `ORDER_SEND` y cero `ORDER_SENT`. **Prerrequisito absoluto (Daniel, 2026-09-27) para habilitar `ui_version: v2` en cualquier Caja y para cualquier rollout, sin excepción.** **No** es prerrequisito de F0b (código aislado sin handlers) | Manifiesto nuevo importado (E7) |
| E2 | FRESH (P16–P19 y el refactor de lint/UI) está en `main` por PR con CI verde, con una tabla fingerprint ↔ commit, y **la suite GUI/CDP de E1 se volvió a correr sobre ese commit de `main`**. Que existan los archivos no basta | PR fusionado más el manifiesto de la corrida sobre el commit |
| E3 | Los hooks de estado, persistencia, efectos y comandos ya están extraídos de `pos/page.tsx`. La v1.2 se conecta a esos hooks, no al archivo de 7,045 líneas. El lint en 0/0 es la evidencia que usa FRESH; aquí importa como prueba del refactor, no como seguridad | Hooks presentes; `npx eslint src/app/pos/page.tsx` en 0/0 |
| E4 | `renderer_secret_audit` en PASS **y repetido con `ui_version=v2`**, con criterio de **cero secretos nuevos frente a `v1`**. «Cero secretos» a secas ya falla hoy: el preload escribe `FULLSITE_LAN_SECRET` en `localStorage` en las dos variantes (`renderer-identity.js:24`, `preload.js:6-10`; riesgo de cierre RC-2, §12.1) | Auditoría en las dos variantes y diff |
| E5 | Se levanta el HOLD de la UI operativa (`uiPolicy` deja de ser `hold`). Es una decisión humana | Registro de la decisión (E7) |
| E6 | `ack_concurrency_closure`, `abrupt_recovery`, `complete_netlogs` e `integral_regression` en PASS. Son justo los estados en vuelo e inciertos que pinta F2 | Manifiesto (E7) |
| E7 | **El importador acepta un resultado positivo.** Hoy `platform-evidence.ts` sólo admite `blocked` o `scoped_pass` con `uiPolicy: 'hold'`, y rechaza cualquier cambio en la lista de pendientes. Hace falta un contrato nuevo y versionado para registrar E0, E1, E5 y E6, que **declare el tramo de edición (E0) por separado del envío (E1)**: los manifiestos actuales no los distinguen | Contrato nuevo en `main`, con pruebas |

**Qué condiciones exige cada fase (§9):**

| Fase | Condiciones |
|---|---|
| F0 (papel) | Ninguna. No escribe código |
| F0b (código aislado, sin handlers ni storage, en `/pos/ui-kit`) | E0 más una autorización nueva de Daniel. **No requiere E1** (`ORDER_SEND` → KDS) |
| F1 | E0, E1, E2, E3 y E7. Sólo en perfiles sintéticos de laboratorio, sin estados en vuelo |
| F2 y F3 | Además, E4, E5 y E6 |
| **Habilitar `ui_version: v2` en una Caja, o cualquier rollout** | **E1 sin excepción**, sobre el mismo commit e instalador que se va a habilitar. Además, todo lo de F2 y F3, la prueba de rollback de §4.2 y `physical_validation`. Vale también para una sola Caja «de prueba» dentro de un restaurante: una Caja es producción |
| F4 | La fila anterior completa |

`physical_validation` **no** es condición para fusionar código detrás de `v1`. Sí lo es, junto con E1, para encender `v2` en una terminal real.

### 7.4 Lista de dependencias por superficie

| ID | Superficie v1.2 | Depende de | Qué consume después | Qué se puede hacer antes |
|---|---|---|---|---|
| D1 | Ticket (fila 2) | **P19**, owner del borrador | El estado del borrador por el hook del editor P19 (restaurante, terminal, turno, mesa, generación, revisión). Nunca `localStorage` | Sólo el componente presentacional con datos de fixture en `/pos/ui-kit` |
| D2 | Modificadores (fila 6) | **P19**, acciones del editor (subgate «modificadores» PASS) | Emite la intención; el editor la aplica | Piel y reglas M-01 a M-06 con fixture |
| D3 | Banda: Enviar (fila 4) | **P17**, estados del journal, y contrato P19→P17 v1 | `pending/sent/receipt/uncertain` → texto y `disabled` del botón | Botón con los 4 estados simulados en el ui-kit |
| D4 | Cobro (filas 7-8) | **P17 + P19** (save/cancel) | Estado en vuelo e incierto basado en `receipt` | Piel con fixture; **ningún handler** |
| D5 | Sincronización (fila 12) | **P17** (journal en main), reconciliación P19, **P20** (qué diagnóstico se puede mostrar) | Lectura del journal y de `sync_queue` | Nada; es F3 |
| D6 | Tema, silencio de comandas, preferencias (fila 1) | **P16**, estado de UI durable. En FRESH toca `tenant-theme.ts`, `ThemeToggle`, `app/pos/layout.tsx` y `PosUiBoundary`; en `main`, `app/pos` no usa `tenant-theme` ni `ThemeToggle`, y `pos_comandas_muted` se borra y se fuerza `false` (`page.tsx:2074-2078`) | El owner P16. La v1.2 no escribe `fs-theme` ni `fs-scale` | Tokens `v2` para el tema oscuro existente |
| D7 | Storage nuevo de la v1.2 | **P18**, inventario de stores de Chromium | `ui_version` vive en `config.json` y no es un store de Chromium. No se portan `fs-scale-manual` ni `fs-teclado` | — |
| D8 | Bloqueo, PIN y AUTH (filas 9-10) | Bloque de seguridad POS #431–#440 y PIN de 10 dígitos (`47f32325`) | El teclado y los puntos para la longitud vigente | Nada; es F3 |
| D9 | Píldora Cocina (§5.1) | **P17**. Hoy la fuente ya depende de `escribeEnCaja` (`page.tsx:2631`); en FRESH será el `receipt` de `ORDER_SEND` | `cocinaRecibe` | La interfaz de la señal, sin implementarla |
| D10 | Llegar a una terminal Electron | Instalador que traiga las dos pieles **y** el transporte de `FULLSITE_UI_VERSION` en `identityForUrl`, que cambia `main.js` (`REDESIGN-INSTALL-IMPACT.md` §5) | `ui_version` por terminal | Decisión Q5 |
| D11 | Mesas (fila 5) | **P16** (`pos_mesero` `mesas/page.tsx:275`) y cachés LS (P18) | Las preferencias del owner P16 | Piel con fixture |

La columna «Qué se puede hacer antes» describe **F0b**: sólo después de E0 y con autorización explícita de Daniel. **Hoy no se hace nada de esa columna.**

### 7.5 Lo que sería ortogonal y sigue sin autorizarse

Lo técnicamente ortogonal es:
- tokens y CSS con alcance acotado;
- componentes presentacionales **sin handlers ni storage**, vistos en `/pos/ui-kit` con fixtures;
- sus pruebas geométricas y de accesibilidad.

Coincide con lo que la decisión llama capa de presentación (`REDISENO-V1.2-INTEGRATION-PLAN.md:6-8`). **Que sea ortogonal no lo autoriza.** Daniel lo negó el 2026-09-26 (Q8) hasta que se cumpla E0, en línea con `DO_NOT_TOUCH_BEFORE_FIELD_CERT.md:6`. Hoy sólo se permite trabajo en papel: este documento, el diseño de las pruebas y la plantilla del inventario Q3.

---

## 8. Pruebas visuales y de accesibilidad necesarias

Ninguna existe hoy:
- snapshots visuales, axe, jest-axe y Lighthouse: 0 en el repo;
- `e2e/pos.spec.ts` son 53 líneas de smoke;
- el lab guarda capturas como evidencia, no como aserción.

| ID | Prueba | Cómo | Pasa si |
|---|---|---|---|
| T-01 | Batería geométrica | Playwright 1.60 (ya fijado) con V-01 a V-17 sobre E01–E23 × 3 resoluciones × `v1`/`v2`. Los parámetros de dispositivo salen del inventario Q3; mientras no exista, la corrida queda etiquetada DIAGNÓSTICO | 0 fallas, **con los parámetros del inventario** |
| T-02 | Regresión visual | `toHaveScreenshot`, con máscara en reloj y fechas. Línea base `v1` aprobada por Daniel; `v2` aprobada por escena | V-19 |
| T-03 | **Inventario de cero pérdida** | Por estado, en `v1` y `v2`: árbol accesible (rol + nombre), textos de datos y controles. Luego un diff. Corre en las tres resoluciones **y** en un viewport móvil de 390×844 (§6.1), en modo web y en modo Caja, y con roles mesero, cajero y gerente | 0 elementos de `v1` ausentes en `v2` salvo en `docs/pos/rediseno-v12-excepciones.md`, firmado por Daniel |
| T-04 | axe-core | `@axe-core/playwright` como devDependency nueva, fijada; etiquetas `wcag2a`, `wcag2aa`, `wcag21aa` en E01–E23 | 0 `serious`/`critical` |
| T-05 | Teclado y foco | Cada hoja con `role=dialog` o `alertdialog`, `aria-modal` y nombre. Foco inicial en lo accionable; Tab atrapado (se reutilizan `components/ui/Dialog.tsx` y `useFocusTrap`, hoy sin uso en el POS); Esc cierra salvo en bloqueantes y cobro en vuelo; el foco vuelve a quien abrió; `:focus-visible` ≥3:1 | 100 % de las hojas |
| T-06 | Matriz offline | WAN × Caja × Cocina = 8 combinaciones: `context.setOffline`, `route` abortando Supabase, mock de Pedro caído, KDS sin acuse | V-09; texto esperado; formas externas deshabilitadas sin WAN |
| T-07 | Clases HTTP | `503` por SW, `401/403` de auth, `403` de negocio, `409` de revisión | Cada una en su lugar (§5.3) |
| T-08 | Carga | Rutas con retraso de 3 s; suma de `layout-shift` (PerformanceObserver) | V-12; desplazamiento < 0.02 |
| T-09 | Avisos | V-04 a V-07, más anuncios `aria-live` en el snapshot de accesibilidad | 100 % |
| T-10 | Cobro | Catálogos de 8, 18 y 24 formas; guarda con lo recibido menor al total; autorización antes de habilitar; mixto; doble clic en «Cobrar» | V-10, V-11; **1 sola petición** por doble clic |
| T-11 | Modificadores | Grupo obligatorio de máximo 1, grupo de 1 a 3, nombre de 38 caracteres | M-01 a M-06; V-08 |
| T-12 | **Invariante `v1` ≡ `v2`** | El mismo guion en las dos variantes, registrando red (CDP `Network`) y comandos de Pedro | Secuencias idénticas (sin marcas de tiempo); exactamente 1 `ORDER_SEND`, 0 `ORDER_SENT` en el camino FRESH, 1 pago por intento |
| T-13 | Sincronización | IDB y journal reales con 0, 1, 5 y 45 operaciones | Orden, contadores y «+N» correctos; toda fila con acción (L-09) |
| T-14 | **Suite GUI/CDP de P19 con `ui_version=v2`** | La misma de E1: POS y KDS, reload, crash del renderer, cierre, dos reinicios | Mismo PASS que con `v1`. **Es la prueba de integración** |
| T-15 | Rollback | §4.2, incluido el negativo: `"V1"` y `true` rechazados por la herramienta | Sin cambios en borrador, journal ni cola; 0 comandos nuevos; la terminal sigue arrancando |
| T-15b | Congelado de la bandera | Con `ui_version=v2`: recargar, matar el renderer y hacer que Pedro no responda | La interfaz sigue en `v2` en los tres casos; nunca cambia a `v1` sin reinicio de Electron |
| T-16 | Clonabilidad | Tenants A y B con colores, `iva_rate` 0 y 0.16, catálogos de pago y zonas distintos | Buscar «AMALAY» en el DOM de B da 0; la etiqueta del impuesto sigue a `iva_rate` |
| T-17 | Pruebas existentes | Tests que leen el texto fuente (≥9 de `page.tsx`, 8 de `pos/layout.tsx`, 6 de `mesas`, 5 de `globals.css`) y el lab de CI `lab-multi-terminal.yml:141` | Verdes con `v1`. Antes de correr el lab con `v2`, migrar sus selectores de clase (`span.font-extrabold`, `button.bg-emerald-600`, `div.fixed.inset-0`, color `rgb(16,185,129)` de los puntos del PIN) a roles o `data-testid`, en un PR sólo de pruebas |
| T-18 | Secretos en el renderer | DOM, globals y storage con `v1` y con `v2`, y luego un diff | 0 secretos, PIN o tokens **nuevos** en `v2` frente a `v1` (E4). Lo que ya existe en `v1`, como `FULLSITE_LAN_SECRET`, se reporta aparte (§12) |
| T-19 | Movimiento reducido | `prefers-reduced-motion: reduce` | `document.getAnimations()` con iteraciones infinitas = 0 (la v1.2 declara 9: :452, :703, :989, :1007, :1013, :1050, :1139, :1146, :1180) |
| T-20 | Paquete Electron y fuentes offline (Q2) | `build-offline-ui.cjs` con `v2`: listar los `.woff2` de la exportación (`out/_next/static/media`) y comprobar que están las tres familias. Arrancar Electron **sin red** y medir V-16. En navegador: primera visita con red, luego offline, recargar y medir V-16 desde el SW | Las 3 familias dentro del paquete; V-16 en PASS en Electron y en navegador sin red; 0 violaciones de CSP |
| T-21 | Validación física | En las terminales reales, mismo instalador y commit (CLAUDE.md §8 y §10) | Registro aparte del laboratorio. No se sustituye |
| T-22 | Revisión adversarial | Otra persona o agente intenta romper F2 (cobro) y F3 (sincronización) | Hallazgos resueltos o aceptados por escrito |

---

## 9. Fases

Un PR por fase y por tema (CLAUDE.md §7). Nada se enciende en tenants productivos sin F4.

| Fase | Qué | Entra cuando | Sale cuando |
|---|---|---|---|
| **F0 · ahora, sólo papel** | (a) Este documento. (b) Las decisiones de §10.3. (c) El diseño escrito de las pruebas T-01 a T-22 y de la tabla de combinaciones alcanzables de V-09. (d) La plantilla del inventario físico Q3 (§6.1). **Sin código** (Q8 negada) | Ya | Especificación aprobada; inventario Q3 levantado en sitio |
| **F0b · código aislado** | Primitivas `v2` sin handlers ni storage en `/pos/ui-kit`, con fixtures; T-01, T-03, T-04 y T-05 contra el ui-kit; el diseño de `FULLSITE_UI_VERSION` en `identityForUrl`, sin cablear | **E0** (tramo de edición completo) y una autorización nueva de Daniel. No requiere E1 | Batería corriendo contra el ui-kit; línea base de inventario `v1` (se retoma después de E2) |
| **F1 · piel sin estado** | Caparazón, retícula, mesas, banda sin estados en vuelo y piel de modificadores, conectados a los hooks del refactor FRESH. `v2` sólo en perfiles sintéticos de laboratorio | F0b; E1, E2, E3, E7 (§7.3); inventario Q3 | T-01 a T-05, T-11, T-12, T-14, T-15b, T-16 y T-17 en verde **con los parámetros del inventario** |
| **F2 · dinero y envío** | Ticket, Cobro en los dos modos, estados en vuelo e inciertos, contrato de avisos | F1, E4, E5, E6 | Además, T-06 a T-10, T-15, T-18 y T-22 |
| **F3 · lo demás** | Sincronización (sólo lectura), bloqueo/PIN (después del bloque de seguridad), hojas genéricas, reemplazo de `window.alert` donde no cambie el flujo | F2; bloque de seguridad POS en `main` | T-13 y T-19 en verde |
| **F4 · activación** | Instalador con las dos pieles (Q5); `ui_version=v2` en una terminal de laboratorio; validación física; después **una** Caja real por decisión de Daniel, con R0 ensayado | F3 y **E1 en PASS sin excepción** sobre el mismo commit e instalador (§7.3, fila «Habilitar `ui_version: v2`») | T-14, T-20 y T-21 registrados. Sólo entonces cabe decir «validado en campo» |

---

## 10. Contradicciones, riesgos y decisiones

### 10.1 Donde la v1.2 contradice el sistema real

| # | v1.2 | Sistema | Resolución |
|---|---|---|---|
| 1 | Modificadores sin obligatorio, mínimo ni máximo (:3042) | `ModifierModal` con grupos y validación | M-01 a M-06 |
| 2 | Cortesía, Influencer y Mercadotecnia como formas de pago que sólo avisan y cierran (:3112-3118, :3137); «Pago mixto» sin flujo (:1833) | No existen como formas de pago (`PaymentMethodDB`, `pos-data.ts:400-407`). La cortesía es un modo de `DiscountModal` con PIN o huella (`page.tsx:749-1066`). El mixto funciona (`6788-6873`) | §5.4-3 y §5.4-4 |
| 3 | «Con conflicto: se reintenta solo», cobros incluidos (:3744-3752; captura `09-sync-conflicto`) | 409 exige decisión; un cobro incierto nunca se repite | §5.6-1 y §5.6-2 |
| 4 | Aviso offline fijo, «sigue cobrando e imprimiendo» | Depende de Caja, de la impresora y de la forma de pago | §5.1 |
| 5 | PIN de 4 dígitos, demo 1234 (:1812) | 10 dígitos en `47f32325` (fuera de `main`) | F3, después del bloque de seguridad |
| 6 | Public Sans + Plex Mono, sin Schibsted (38 `@font-face`, :4-346) | Tipografía canónica con Schibsted para display (memoria `tipografia-canonica-fullsite`, verificada el 2026-08-28) | **Decidido (Q2): se mantiene Schibsted**, con disponibilidad offline verificada (V-16, T-20) |
| 7 | Tacto de 24–40 px; contraste estimado de 2.15–2.55:1 | Alto mínimo de 48 px (`.pos-kiosk`); WCAG AA | NC-5, V-14 y V-15 |
| 8 | Medida sólo en `sm` (0.95), sin pantalla táctil, DPR 1 | Las terminales reales **no están inventariadas**: DPR, pantalla táctil y escala desconocidos | §6.1. **Q3 pendiente de inventario físico; no se supone nada** |

**Tres más, del propio artefacto:**
- La escena `05-offline` de la batería es **circular**: el arnés inyecta el aviso global que después verifica (V12:241).
- El LEEME cuenta 10 llamadas globales; hay 9, y dos viven en `CATALOGO_SYNC.bajar`, que nunca se llama (:3840-3844).
- «Por qué no se pierde ni se duplica» afirma una idempotencia que no aplica a peticiones legacy (§5.6-5).

### 10.2 Diferencias con documentos previos, propuestas para enmendar

| Documento | Dice | Esta especificación propone | Por qué |
|---|---|---|---|
| `REDISENO-V1.2-INTEGRATION-PLAN.md:25-26` | «La bandera … se evalúa en el renderer; no llega a main/preload» | La **decide** main al arrancar (`version-de-interfaz.js`, ya en `main`). **Viaja por el preload** (`identityForUrl`), y el renderer sólo **lee** el valor congelado | El código ya decidió así, con razones escritas. Evaluarla en el renderer la volvería relectura, que es justo lo que el módulo prohíbe. El preload es el único canal que no se relee ni depende de red (§4.1) |
| `REDESIGN-V2-DISCOVERY.md` §FEATURE_FLAG_STRATEGY (rama `redesign/pos-ds-v2`) | Por tenant en `pos_settings`, por terminal en `localStorage` | `ui_version` en `config.json` | Una versión previa de este mismo documento proponía `pos_settings`. Se descartó al encontrar `version-de-interfaz.js` |
| Batería v1.2 | «Fuentes OK» | V-16 exige las 3 familias canónicas, offline | Q2 |

### 10.3 Decisiones de Daniel

| # | Pregunta | Estado |
|---|---|---|
| Q1 | ¿La referencia es la v1.2 o la v1.2.1? | Abierta. Recomendación: la v1.2, más el orden de cola de la v1.2.1 (sólo afecta a F3) |
| Q2 | La v1.2 no tiene Schibsted Grotesk. ¿Se conserva la tipografía canónica? | **Decidida el 2026-09-26: sí, se mantiene Schibsted Grotesk con disponibilidad offline verificada.** Aplica en §4.1 (Tipografía), V-16 y T-20 |
| Q3 | ¿Qué resolución, DPR y pantalla táctil tienen PDV1, PDV3 y SERVER1? | **Pendiente de inventario físico (2026-09-26). No se supone DPR, pantalla táctil ni escala.** Los criterios que dependen de esto quedan sin umbral (§6.1), y toda corrida hasta entonces es DIAGNÓSTICO |
| Q4 | ¿El POS en navegador (sin Electron) puede ver `v2` en producción? | Abierta. Recomendación: no; `v2` sólo en Electron y en previews |
| Q5 | ¿Un paquete con las dos pieles o dos paquetes? ¿El instalador de hoy lleva `v2`? | Abierta. Recomendación: un paquete con las dos pieles y `v1` por omisión; **no** incluirlo en el instalador de hoy (igual que `REDESIGN-INSTALL-IMPACT.md:102-105`). Aclarar qué sella `sellar-version.cjs:82` (`ui_version` de compilación) contra `config.json` (de terminal) |
| Q6 | ¿Qué pasa con #408 y `redesign/pos-ds-v2`? | Abierta. Recomendación: reutilizar sus componentes y el guardián de tokens como base de F0b/F1, y cerrarlos cuando F1 los supere. Parten del `page.tsx` previo a FRESH y no deben fusionarse tal cual |
| Q7 | Excepciones a la regla de cero pérdida (p. ej. sustituir `window.alert`) | Abierta. Recomendación: lista explícita y firmada (T-03) |
| Q8 | ¿Se autoriza código aislado (primitivas sin handlers en `/pos/ui-kit`)? | **Negada el 2026-09-26.** Ningún componente dentro de `/pos`, ni implementación ni publicación, hasta que P19 GUI/CDP complete el tramo de edición (E0). **E0 quedó definido el 2026-09-27:** GUI sintética real hasta login → turno → borrador → acción válida → Guardar con recibo durable. Después de E0 se vuelve a pedir. F0b no requiere `ORDER_SEND` → KDS; habilitar `v2` en una Caja o cualquier rollout sí, sin excepción (E1) |
| Q9 | Tres cambios de **comportamiento** que la v1.2 sugiere y que no caben bajo `ui_version`: (a) una sonda WAN real en lugar de `navigator.onLine`; (b) la salud de Pedro en la pantalla de venta; (c) deshabilitar formas con terminal externa sin WAN, lo que requiere distinguirlas en `pos_payment_methods`. ¿Se hacen? | Abierta. Recomendación: sí a (a) y (b), en PRs propios fuera del rediseño y después de P19, con prueba de que no cambian el camino de órdenes. (c) necesita primero el dato en el catálogo: decisión de producto |

### 10.4 Riesgos

| Riesgo | Mitigación |
|---|---|
| Cablear sobre el camino `main` que FRESH reemplaza | Condición E2 |
| Un `ui_version` mal escrito tumba la terminal (NOT_PROVISIONED) | Escribir sólo con la herramienta que valida; R0 borra la clave; T-15 con negativos |
| Que la bandera se relea y cambie a media comida | Transporte por preload, nunca HTTP; T-15b |
| Que la bandera cambie la navegación (ya pasó en #408 con `?v2=1`) | Hash sólo en preview; en Electron, `config.json` |
| Que `v2` mueva el timing de los efectos (la causa raíz de P19 del 26-sep fue un efecto del renderer con el turno en `null`) | Componentes sin efectos; T-12 y T-14 con `v2` |
| Lab de CI atado a clases Tailwind | T-17: migrar selectores antes de `v2` |
| Que las pruebas de este plan escriban en producción | Exigen `E2E_BASE_URL` explícito y fallan si falta; nunca heredan el valor por omisión de `playwright.config.multiterminal.ts`. El riesgo general va aparte: RC-3 (§12) |
| Contraste de colores de categoría definidos por el tenant | Color de texto calculado (V-15) |

---

## 11. Afirmaciones y fuentes

**Grados:**
- **HECHO:** leído en el archivo o el comando citado.
- **REPORTADO:** copia pegada de otra herramienta; no es el original.
- **INFERENCIA:** deducido, no comprobado.

| Afirmación | Fuente | Grado |
|---|---|---|
| El SHA de la v1.2 coincide | `shasum -a 256` contra `SHA256SUMS` | HECHO |
| La v1.2 hace 0 peticiones de red y usa `Math.random` para los conflictos | `reporte-v1.2.txt`; :3744 | HECHO |
| `push` con red no encola | :3717-3722 | HECHO |
| El cobro con autorización cierra sin pedirla | :3137 | HECHO |
| La escena 05 de la batería es circular | V12:241 | HECHO |
| La v1.2 sólo se midió a `sm` | `reporte-v1.2.txt`; :6186 | HECHO |
| `feature_flags` no está en `ALLOW` | `grep` sobre `pos-db-policy.ts` en `c7530a17` | HECHO |
| `ui_version` existe y se congela al arrancar | `version-de-interfaz.js`; `main.js:286` | HECHO |
| Un `ui_version` presente e inválido deja la terminal en NOT_PROVISIONED | `config-schema.js:60-61`; `main.js:116-123`, `1057-1061`; `node -e` del revisor adversarial con `"V2"`, `" v2 "`, `"v3"` y `true` → `valid=false` | HECHO |
| El preload escribe la identidad de main antes de cualquier script | `preload.js:5-11`; `main.js:761-767`, `778-784` | HECHO |
| `/health` e `/identity` de Pedro son rutas abiertas | `credencial-lan.js:54` | HECHO. El comentario de `identidad-de-terminal.js:108-110` («detrás de la credencial») está obsoleto |
| Ningún archivo de `dashboard-app/src` lee `ui_version` | `git grep` en `origin/main` | HECHO (alcance: `dashboard-app/src`) |
| En `main`, la web manda `ORDER_SENT` y Caja manda `ORDER_SEND` | `page.tsx:3653-3654`; `page.tsx:3422` → `2677` → `pedro-operaciones.ts:77` | HECHO |
| `PaymentMethodDB` no tiene campo de autorización | `pos-data.ts:400-407` | HECHO |
| FRESH no está en `main`; su base es `418933f4` y no hay cambios de POS después | `git cat-file -e`; `git merge-base --is-ancestor`; `git log 418933f4..origin/main -- <POS>` | HECHO. La base declarada viene de `FULLSITE-1.4.1-LAB-IMPLEMENTATION.json` (REPORTADO) |
| P16, P17 y P18 en PASS; P19 abierto; P20 sin implementar; horas y fingerprints | historia de Codex (copias pegadas desde Windows) | REPORTADO |
| Admisión P19 `scoped_pass` con 9 pendientes | contrato en `aee90ec9` | HECHO (el contrato); el resultado es REPORTADO |
| Alto mínimo de 48 px en button, input y select del POS (no hay ancho mínimo) | `globals.css:58-64` | HECHO |
| Hoy el POS no usa Schibsted: `--font-display` sólo existe bajo `[data-ds="v3"]` | `globals.css:710-711`; `AppShell.tsx:60-62` | HECHO |
| Las fuentes de `next/font/google` quedan en `/_next/static/media`; el paquete offline copia la exportación; el SW cachea `woff2` | `app/layout.tsx:2`; `build-offline-ui.cjs:102-109`; `public/sw.js:122-131`, `215` | HECHO estático; offline en runtime **NO VERIFICADO** (T-20) |
| El servidor compara el precio cobrado contra el del menú | `api/pos/save-order/route.ts:252-259` | HECHO |
| El renderer usa `FULLSITE_LAN_SECRET` para autenticarse con Pedro | `local-network-fetch.ts:110-112` | HECHO |
| DPR, pantalla táctil y escala de PDV1, PDV3 y SERVER1 | — | **DESCONOCIDO** (Q3, inventario físico) |
| Contraste de 2.55:1 y 2.15:1 | Cálculo WCAG de un subagente sobre los tokens de la v1.2 | INFERENCIA (no medido en navegador) |
| El camino MP Point es inalcanzable (`mp_access_token` se lee en `page.tsx:6566` y nadie lo escribe en `src/`) | `grep setItem` en `dashboard-app/src` | HECHO estático; en runtime NO VERIFICADO (§12) |

---

## 12. Riesgos de cierre separados y otros hallazgos

### 12.1 Riesgos de cierre separados (no son del rediseño)

Estos tres riesgos **existen hoy en `main` con `v1`**, sin relación con la v1.2. Se registran por separado: cada uno lleva su propio PR, su propia prueba y su propio dueño de decisión, y **ninguno entra en la rama del rediseño**. Nada de esto se ejecutó; sólo se documenta. Verificado contra `origin/main` @ `ecc89364` el 2026-09-26.

#### RC-1 · PostHog con autocapture en `/pos`

| Campo | Contenido |
|---|---|
| Evidencia | `lib/posthog.ts:7-12`: `autocapture: true`, `capture_pageview: true`. `app/layout.tsx:101`: `<PosthogInit />` en el layout raíz, que envuelve también `/pos`. AppShell no lo excluye (`AppShell.tsx:60-62` sólo cambia el contenedor) |
| Estado | **Abierto en código.** La corrección `f6c4e553` («PostHog nunca en POS, KDS, checador ni Electron») está en `cierre/10-posthog-fuera-del-pos` (también en `candidata/dashboard-security-20260925` y otras ramas `cierre/*`) y **no** en `main` (`git merge-base --is-ancestor` → no). Mitigado **del lado del proyecto**: autocapture apagado el 2026-09-25 19:48 UTC, según la memoria `project_p0_containment_phase_a_20260925`, que tiene fecha pero **no la verifiqué hoy** |
| Impacto | Esa memoria midió 1,968 toques de un solo dígito en `/pos` antes del apagado, la cota superior de toques de PIN. Si alguien reactiva autocapture o la grabación de sesión en el proyecto, el código vuelve a capturar el teclado del PIN sin ningún cambio de código |
| Acción propuesta | Revisar y fusionar `f6c4e553` por su propio PR, más una prueba guardiana: en rutas `/pos*`, `/kds`, checador y bajo Electron, `posthog.__loaded === false` y 0 peticiones a `*.posthog.com`. Aparte: el runbook de rotación de PIN (R1) quedó disparado según la misma memoria; la decisión de rotar es tuya |
| Relación con v1.2 | **Ninguna. Riesgo independiente:** no bloquea al rediseño ni depende de él, y se cierra por su propio PR. El riesgo es el mismo con `v1` que con `v2` |

#### RC-2 · `FULLSITE_LAN_SECRET` en `localStorage` del renderer

| Campo | Contenido |
|---|---|
| Evidencia | `renderer-identity.js:24` incluye `FULLSITE_LAN_SECRET` en la identidad. El preload la escribe en `localStorage` antes de cualquier script (`preload.js:6-10`). El renderer la lee **a propósito** para autenticarse con Pedro: cabecera `x-fullsite-lan` (`local-network-fetch.ts:110-112`). `pedro-cliente.ts:28` también usa su presencia para decidir `requiereCaja()` |
| Estado | **Abierto, por diseño actual**, en toda terminal Electron, con `v1` y con `v2`. No sé si FRESH lo cambió en Windows (P18 clasifica los stores de Chromium; P19 tiene pendiente `renderer_secret_audit`) |
| Impacto | Cualquier script que corra en el origen del renderer puede leer la credencial LAN y llamar a las rutas protegidas de Pedro desde esa terminal: un script de terceros cargado en la página (ver RC-1) o una inyección. Además hace imposible una auditoría de «cero secretos en storage» (E4 se redactó como diferencia `v2` − `v1` por esta razón) |
| Acción propuesta | Decisión de diseño aparte: que la credencial no se persista en storage del renderer. Opciones: que main agregue la cabecera a las peticiones hacia `127.0.0.1:7717` (`session.webRequest.onBeforeSendHeaders`), o exponerla por `contextBridge` sin escribirla. Toca Electron y la autenticación de Pedro, así que requiere instalador y va coordinado con P18 y P19. Prueba: la auditoría del renderer sin la clave en `localStorage`, y Pedro sigue aceptando al POS legítimo y rechazando sin credencial |
| Relación con v1.2 | **Ninguna. Riesgo independiente:** no bloquea al rediseño ni depende de él. Sólo explica por qué E4 se mide como diferencia `v2` − `v1` y no como «cero secretos» |

#### RC-3 · Playwright multiterminal con producción por omisión

| Campo | Contenido |
|---|---|
| Evidencia | `dashboard-app/playwright.config.multiterminal.ts:17`: `baseURL: process.env.E2E_BASE_URL \|\| 'https://app.fullsite.mx'`. Su propio comentario (`:14-16`) dice que usa producción real porque `/api/pos/pin` exige una llave de servicio que sólo vive en Vercel, y que «escribe únicamente en el tenant demo (chickin-demo)» |
| Estado | **Abierto, por diseño.** No lo corre ningún workflow: en `.github/workflows` sólo aparece `lab-multi-terminal.yml:141`, que corre el laboratorio `.cjs`, no esta configuración. El riesgo está en la corrida manual |
| Impacto | `npx playwright test -c playwright.config.multiterminal.ts` sin `E2E_BASE_URL` **escribe en producción** con las credenciales que use la prueba. Choca con CLAUDE.md §13 («no usar credenciales de producción para pruebas»). El único límite es una convención (tenant demo), no una guarda |
| Acción propuesta | Fallar cerrado: exigir `E2E_BASE_URL` explícito y, si apunta a producción, además `E2E_ALLOW_PRODUCTION=1` y una lista blanca de tenants comprobada antes de la primera escritura. Buscar el mismo patrón en las demás configuraciones. El subagente de inventario reportó otro caso, `tests/pos-e2e.spec.ts`, que escribe en producción detrás de una bandera; **no lo verifiqué** |
| Relación con v1.2 | **Ninguna. Riesgo independiente:** no bloquea al rediseño ni depende de él. Las pruebas de este plan tampoco heredan ese valor por omisión (§10.4) |

### 12.2 Otros hallazgos, fuera de alcance

1. **REPORTADO, no verificado por mí:** según la historia de Codex, Codex Mac aplicó la migración JEV directo en el Supabase de producción y configuró variables en Vercel Production. Si es así, choca con CLAUDE.md §13 y §2.
2. **Llaves de MP incoherentes.** La configuración guarda `mp_point_config` (`lib/mercadopago.ts:47-60`) y el botón Tarjeta lee `mp_access_token` / `mp_device_id` (`page.tsx:6566-6567`). Hallazgo estático; hay que reproducirlo antes de tratarlo como defecto.
3. **Código importado sin usar en `page.tsx`**: `InventoryAlerts`, `SmartCashCalculator` y funciones de MP (`157-159`, `199`, `201`). Hallazgo estático.
4. **Comentario obsoleto:** `identidad-de-terminal.js:108-110` dice que `/health` está «detrás de la credencial de red local», pero `credencial-lan.js:54` lo declara ruta abierta.
5. **`cfg.uiVersion` sin consumidor** (`main.js:291`): se resuelve y se pasa al servidor local, pero nada lo usa.

---

## 13. Revisión adversarial de este documento

El 2026-09-26 un agente independiente intentó refutar la primera versión: verificó más de 25 citas y buscó fallas de lógica. Encontró **3 fallas críticas y 11 importantes**. Cada una se reprodujo contra el código antes de corregirla.

| Hallazgo | Qué se corrigió |
|---|---|
| **C1.** «Un `ui_version` inválido cae a `v1`» era falso a nivel sistema: la configuración inválida lleva a NOT_PROVISIONED | §0.2, §4.1, R0 (borrar la clave), T-15 con negativos, riesgo nuevo |
| **C2.** Leer la versión por HTTP al montar rompía el congelado y podía leer la versión de otra terminal | Transporte por preload (`identityForUrl`); canal HTTP descartado con su motivo; T-15b |
| **C3.** F1 contradecía la condición de entrada | §7.3 con condiciones por fase |
| E1 imposible de registrar con el importador actual | E7 |
| Faltaban 4 pendientes para los estados en vuelo | E6 |
| El alcance de «`main` manda `ORDER_SENT`» estaba mal | §0.3, §5.1 y D9: web `ORDER_SENT`, Caja `ORDER_SEND` |
| `requiere_autorizacion` no existe; las sondas nuevas rompen la invariante | §5.1, §5.4 y Q9 |
| «0 secretos» ya falla en `v1` | E4 y T-18 como diferencia `v2` − `v1`; riesgo de cierre RC-2 (§12.1) |
| Cita equivocada del piso táctil; inputs `sr-only` | V-14 |
| V-10 contradecía a V-11 | Los dos reescritos |
| Los tokens en línea le ganan a la hoja de estilos | `data-ui` en un contenedor descendiente |
| Faltaban superficies (móvil, `POSAlerts`, `POSCopilot`…) | §3 y viewport móvil en T-03 |
| El hash se pierde al navegar | `sessionStorage` sólo en preview |
| Citas que no coincidían: `page.tsx:545` (radio), `:2076`, «IVA 16%» de la v1.2, `V12:10`, nombres de la cola | Corregidas |

**Lo que la revisión no cubrió:** no ejecutó código de la app ni pruebas; sólo leyó y corrió `node -e` sobre `config-schema.validate`. Todas las afirmaciones de runtime siguen siendo estáticas hasta F0.
