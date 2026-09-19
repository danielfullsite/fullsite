# De AMALAY a un producto clonable — aprendizajes al 2026-08-31

> **Qué es esto.** El acta del 24-ago (`~/Documents/OFFLINE-AMALAY-CIERRE-2026-08-24.docx`)
> certificó *qué funciona y cómo se instala una terminal*. Este documento es lo que vino
> **después**: la sesión de campo del 30→31 de agosto, ~9 horas con acceso remoto real
> (TeamViewer + RustDesk + Tailscale) a las tres terminales, y lo que reveló sobre el
> producto que un acta de certificación no puede ver.
>
> **No reemplaza al acta del 24-ago.** El procedimiento de instalación clonable (§7 de ese
> documento), el runbook de corte (§8) y la regla de identidad única siguen vigentes tal
> cual. Aquí se agrega lo que esa noche corrigió y lo que dejó al descubierto.
>
> Relacionados: [`CLONABILITY-FULL-ANALYSIS.md`](CLONABILITY-FULL-ANALYSIS.md) ·
> [`GOLDEN-POS-SKELETON.md`](GOLDEN-POS-SKELETON.md) ·
> [`../pos/OFFLINE-CUTOVER-PLAN.md`](../pos/OFFLINE-CUTOVER-PLAN.md) ·
> [`../offline/TEST-MATRIX.md`](../offline/TEST-MATRIX.md)

---

## 1. El hallazgo de fondo: los bugs que sobreviven son los que se ven bien

El acta del 24-ago certificó Caja, Entrada y Escondite. Seis días después, con acceso a las
máquinas, aparecieron seis defectos que **ninguna de esas pruebas podía haber detectado** —
porque los seis producen una pantalla creíble:

| Lo que hacía | Lo que se veía |
|---|---|
| La comanda no llegaba a cocina | La orden se guardaba; la pantalla decía "enviada" |
| El mapa mostraba libres 15 mesas ocupadas | El plano salía **perfecto**: 33 mesas, distribución correcta |
| Una orden entraba a un turno cerrado 1 h 38 min antes | Todo verde; el corte ya estaba firmado |
| El puente local estaba bloqueado por el navegador | Funcionaba en las terminales, por un switch que lo tapaba |
| Una orden fantasma resucitaba sola | Se "limpiaba" y volvía al día siguiente |
| El envío a cocina se rendía tras 4 intentos | Silencio: ni log, ni aviso, ni error |

**La regla:**

> Un sistema que falla ruidosamente se arregla solo, porque alguien lo reporta. Los defectos
> que sobreviven meses son los que **producen una pantalla creíble**. En un POS eso no es
> incomodidad: es cobrar mal, comida que nunca se cocina, y un arqueo que cuadra sobre datos
> falsos.

**Para el cliente #2, la pregunta de aceptación cambia:** no *"¿se ve bien?"* sino
**"¿cómo se vería si estuviera roto?"**. Si la respuesta es *"igual"*, esa prueba no prueba
nada.

---

## 2. Los cinco patrones

### 2.1 Lo redundante en un lugar es estructural en otro

El envío de la comanda estaba escrito como best-effort — con este comentario literal en el
código: `NUNCA rechaza (best-effort)`. Reintentaba cuatro veces y se rendía en silencio.

En la **Caja** eso es inofensivo: Pedro corre en la misma máquina y el KDS además consulta
Supabase — hay dos respaldos. En **Entrada**, un POS secundario, ese envío es el **único**
camino a la cocina. Mismo código, consecuencia distinta.

> Nadie lo notó porque **sólo se probaba donde es redundante**.

**Al clonar:** la matriz debe ejecutarse **por rol de terminal**, no "en una terminal". Un
restaurante de 1 caja no ejercita los mismos caminos que uno de 3 — y el cliente #2 puede
tener 5.

### 2.2 Un fallo invisible es peor que uno ruidoso

`fetch(...).catch(() => {})` no sólo esconde el error: **impide diagnosticarlo**. Se
perdieron horas sin poder saber por qué la comanda no llegaba, porque el código estaba
construido para no decirlo.

La corrección no fue "manejar el error", fue convertir el envío en una función **esperada,
que valida la respuesta, registra url/status/error y bloquea la pantalla si cocina no
confirma**. El mesero se entera antes de soltar la mesa.

> Ninguna operación que el negocio dé por hecha puede ser best-effort.

### 2.3 Un caché tibio no es garantía, es casualidad

El plano offline funcionaba… si alguien había abierto el mapa con internet antes. Nadie
sabía cuándo se había enfriado.

Tras limpiar el almacenamiento —reinstalación, "clear site data", terminal nueva— el mapa
mostraba **0 de 33 ocupadas** con **$6,172.36** abiertos.

> El offline no puede depender de que alguien haya usado la app antes. El calentamiento tiene
> que ser **determinista**: al entrar con red, siempre.

**Esto pesa el triple al clonar: un cliente nuevo arranca con el caché frío por definición.**
El día 1 de cada restaurante *es* el escenario que fallaba.

### 2.4 Un arreglo que funciona por la razón equivocada sigue roto

El puente declaraba `targetAddressSpace: 'local'` para `127.0.0.1`. Chromium clasifica
loopback aparte, y **bloqueaba la petición antes de enviarla**. No se veía porque el build
1.3.9 desactiva esas comprobaciones.

> **El switch estaba tapando el bug, no arreglándolo.** En un navegador —o en una terminal
> sin ese build— el puente estaba muerto. Y al clonar, la bandera puede no estar.

### 2.5 Un TTL que se refresca al leer no caduca nunca

Las órdenes fantasma tenían un TTL de 4 h que se reiniciaba **al restaurarlas**. Medía
"desde la última vez que alguien abrió la mesa", no "desde que el mesero escribió algo". En
un restaurante donde tocan las mesas todo el día, eso es *para siempre*.

---

## 3. Lo que sólo se ve entrando a las máquinas

El acta del 24-ago se construyó ejecutando pruebas. Esta sesión entró a la configuración
derivada, y ahí apareció otra clase de problema:

- **Entrada llevaba 12 días con el rol equivocado** (`server_pos` en vez de `pos`), desde un
  re-aprovisionamiento del 18-ago. Con ese rol el código nunca le fijaba el puente. Nadie lo
  reportó: el POS "abría bien".
- **Catorce mesas fantasma** en su almacenamiento local, ninguna en la base.
- **El acceso directo apuntaba a un build viejo**: reiniciar la máquina revertía la
  actualización. Invisible desde cualquier consulta remota.
- **El KDS corría un build 45 minutos anterior** al commit que agregó su botón de salida —
  por eso "no existía" un botón que sí estaba en el código.
- **Un artefacto llamado `KDS-1.3.9-FIX` no contenía el fix.** Sólo verificando el contenido
  se supo. Casi se instala.
- **La consola del navegador tenía 403 errores acumulados**, y uno explicaba el bug del
  puente. Estaba ahí todo el tiempo; nadie la había abierto.

> **El acceso remoto no es comodidad de soporte, es instrumento de diagnóstico.** La mitad de
> los hallazgos fueron cosas que sólo existen en la máquina: configuración derivada, accesos
> directos, versiones reales, consola.

**Requisito para el cliente #2:** acceso remoto establecido **antes** del día 1, no cuando
algo falle.

**Y no es un requisito teórico: en AMALAY falla hoy.** Caja y KDS quedaron alcanzables por
Tailscale, pero **Escondite (PDV1) sigue sin acceso remoto por un tema de licencia de
TeamViewer** — no por un problema técnico. Está certificada desde el 24-ago y desde entonces
sólo se puede tocar yendo al restaurante. Toda la clase de hallazgos de esta sección —rol
equivocado, acceso directo apuntando a un build viejo, versión real, consola— es **invisible**
en esa terminal.

> Un restaurante con N terminales necesita acceso remoto a **las N**. La que queda fuera es
> justamente donde se acumulan los problemas que nadie ve.

---

## 4. Lo que se agrega al procedimiento del 24-ago

El §7 del acta (instalación clonable) sigue siendo correcto. Se le agregan cuatro
verificaciones que esta noche demostró necesarias:

| Verificar | Cómo | Por qué |
|---|---|---|
| **Versión real** | `http://127.0.0.1:7717/health` | El nombre del archivo miente; el `/health` no |
| **Rol correcto** | `config.json` → `terminal_role` | `pos` vs `server_pos` cambia el puente, la seguridad web y la URL |
| **El acceso directo** | Que apunte al build instalado | Si no, el reinicio revierte la actualización |
| **Un login con red** | Antes de operar sin ella | Calienta el mapa de mesas; sin esto la terminal miente el día 1 |

El último es el paso nuevo. Los otros tres son verificaciones de lo que ya se instalaba.

**Sigue vigente y es la regla más importante del acta:** nunca clonar el mismo `terminal_id`
en dos equipos activos.

---

## 5. La condición que ya estaba escrita, y que el campo confirmó

El acta del 24-ago lo dice con todas sus letras:

> **"Sin Internet sí; sin red local no."** Si se apaga SERVER1, el switch/router LAN o la
> energía de las estaciones, impresión y KDS locales dejan de estar disponibles.

La noche del 31 esto se comprobó de forma no planeada: al apagar el **WiFi** de Entrada, la
terminal perdió **las dos** —internet y red local—, porque en AMALAY las terminales van por
WiFi. Sin LAN no hay camino a Pedro, y la comanda no tuvo a dónde ir.

**Lo que esto agrega al análisis:** el diseño asume *"se cae la WAN, la LAN sigue viva"*, pero
en un restaurante con terminales en WiFi la falla más probable es que **muera el router**, y
ahí se caen las dos. En ese escenario un POS secundario puede capturar la orden pero **no
tiene cómo mandarla a cocina** — no por defecto, sino porque no existe el camino.

Lo que cambió esa noche es que **ya no falla en silencio**: el mesero ve un bloqueo rojo que
se lo dice. Falta la respuesta operativa —llevar la comanda a mano— y decidir si el diseño
debe ofrecer algo más (p. ej. impresora de respaldo por terminal).

---

## 6. Cómo mejoró el producto

Diez correcciones aterrizaron durante la sesión. No todas recibieron la misma clase de
certificación física: algunas quedaron verificadas en las terminales, otras por prueba de
regresión y otras sólo por inspección del código desplegado. La tabla distingue el alcance
para no confundir **mergeado** con **certificado en restaurante**.

| PR | Qué | Efecto para el restaurante |
|---|---|---|
| [#246](https://github.com/danielfullsite/fullsite/pull/246) | La huella se re-arma en cada login con PIN | Deja de morir al limpiar el almacenamiento |
| [#247](https://github.com/danielfullsite/fullsite/pull/247) | Fechas de prueba en hora de México | CI dejó de fallar de noche y pasar de día |
| [#249](https://github.com/danielfullsite/fullsite/pull/249) | La comanda se espera, se valida y se avisa | Si no llegó a cocina, el mesero se entera |
| [#250](https://github.com/danielfullsite/fullsite/pull/250) | Permitir el bridge localhost desde el POS HTTPS | Abrió el camino de PNA desde la capa web |
| [#251](https://github.com/danielfullsite/fullsite/pull/251) | Compatibilidad del bridge local con Chromium 130 | Evitó depender de comportamiento viejo del navegador |
| [#252](https://github.com/danielfullsite/fullsite/pull/252) | Quitar esperas artificiales de huella y órdenes offline | Login y navegación dejaron de pagar timeouts innecesarios |
| [#253](https://github.com/danielfullsite/fullsite/pull/253) | Eliminar mesas fantasma y latencia de navegación offline | El mapa dejó de resucitar estado local obsoleto |
| [#254](https://github.com/danielfullsite/fullsite/pull/254) | Turno validado en servidor + hora real de captura + folios por turno | Ninguna venta entra a un corte ya cerrado |
| [#255](https://github.com/danielfullsite/fullsite/pull/255) | Calentamiento determinista del mapa (T-26) | Una terminal recién instalada dice la verdad sin red |
| [#256](https://github.com/danielfullsite/fullsite/pull/256) | Espacio de direcciones derivado del destino | El puente ya no depende del switch de Electron |

**Escenario nuevo en la matriz: T-26.** Ya existían dos pruebas de arranque en frío; faltaba
la tercera:

| | Pregunta que responde |
|---|---|
| T-24 | ¿puede el mesero **entrar** sin red? |
| T-25 | ¿aparece el **plano**? |
| **T-26** | ¿ese plano dice la **verdad**? |

**Auditoría de datos** (además de los PR): 7 órdenes de AMALAY por **$1,879** quedaron
huérfanas en julio con `client_id` vacío — invisibles para dashboard, reportes y agentes.
La puerta ya está cerrada (el servidor deriva el tenant del token), pero **el dinero sigue sin
recuperarse**. Y una tabla de respaldo con 1,061 filas estaba expuesta sin RLS: cerrado en #254.

---

## 7. Evidencia de campo — 30/31 de agosto

**Caja (SERVER1) — certificación completa.** Huella, navegación, impresión, plano intacto al
reentrar, y **cobro sin internet**.

**Entrada (PDV3) — medido, no impresiones:**

| Qué | Evidencia |
|---|---|
| Puente local reparado | Consola filtrada por `127.0.0.1` → **0 errores**. Antes: `address space 'local' … 'loopback'` + `ERR_FAILED` |
| Calentamiento del mapa | IndexedDB **12.4 kB → 833 kB** al teclear el PIN, partiendo de almacenamiento borrado |
| **T-26 sin red** | **NO CONCLUIDO** — el caché sí se calentó, pero la prueba final quedó bloqueada antes del mapa por un conflicto falso de turnos locales |

No debe registrarse T-26 como aprobado todavía. La evidencia demuestra que el snapshot se
llena al entrar, pero falta demostrar en una corrida limpia que, al perder sólo WAN, las 15
mesas y sus montos sobreviven. La corrida nocturna apagó también la LAN y después encontró
otro defecto independiente: el gate de turno leyó estado local contaminado y bloqueó el POS
antes de llegar al mapa.

**KDS (PDV2):** de 1.3.8 a 1.3.11, con botón de salida y acceso directo en el escritorio.

---

## 8. Pendientes, actualizados

Los P0/P1 del acta del 24-ago siguen vigentes (enrolamiento de huellas, failover de Pedro,
cold boot sin WAN, observabilidad de flota). Se agregan:

- **La cola de la caja no drena** — OutboxWorker en shadow-mode apagado. Es el **G3** del plan
  de cutover. Sin esto, "offline seguro" no es cierto.
- **Un contador de turnos se infla sin red y bloquea el POS** (`activeCount > 1`). La base
  decía 1 turno; la pantalla decía 16. **Origen no identificado** — falta leer
  `pos_turno_cache` con el WiFi apagado en el momento del aviso.
- **Templates de huella locales por terminal** (`FINGERPRINT_SYNC_SECRET` sin configurar →
  `401`). Enrolar en la caja no sirve en Entrada: hay que enrolar N veces.
- **Dos líneas de versión divergentes** — POS 1.3.9 / KDS 1.3.11. Hay que reconciliarlas antes
  de que un cliente nuevo herede la confusión.
- **Espera larga cuando la LAN está muerta** — 6 s de reintentos antes de rendirse. Con LAN
  viva no se nota; sin ella el mesero espera lo peor.
- **Mesa 20 tiene dos cuentas activas y el plano sólo representa una.** Una cuenta de
  $603.20 era visible y otra de $162.40 quedaba escondida. Cobrar desde el plano puede dejar
  saldo real sin cobrar. Sigue siendo bloqueante hasta corregir la unicidad o representar
  explícitamente cuentas múltiples.
- **16 órdenes de prueba siguen vivas** — 15 mesas, $6,172.36 y 0 pagos al momento del
  diagnóstico. Existe un script de limpieza con rollback por defecto; no se ejecuta sin
  confirmación explícita y evidencia de que ninguna orden es real.
- **403 repetidos en reservaciones** — aparecieron en DevTools y no pertenecen al problema
  del bridge. Se mantienen como seguimiento separado para no mezclar causas.
- **Datos históricos huérfanos** — 7 órdenes reales de julio por $1,879, además de un turno
  y una asistencia, quedaron con identidad de cliente vacía. La escritura nueva ya falla
  cerrada, pero los datos históricos todavía requieren reconciliación auditable.

---

## 9. Las tres reglas para el cliente #2

**1. Instrumentar antes de diagnosticar.** El hallazgo más caro de la noche salió de una línea
en la consola del navegador, no de leer código. Antes de teorizar, hacer que el sistema
**diga** por qué falla.

**2. Probar el rol, no la aplicación.** El mismo código se comporta distinto según sea caja o
terminal secundaria. Probar "el POS" no es probar el POS de nadie en particular.

**3. La certificación mide lo que se ve cuando está roto.** Si un módulo roto y uno sano se
ven igual, la prueba no prueba nada.

---

## Anexo A — errores propios de la sesión

Se documentan porque el patrón se repite y cuesta:

- **Se auditó una rama 149 commits atrás de `main`** y se reportó como producción código que
  ya había cambiado. Regla: leer `origin/main`, siempre.
- **Se instaló Electron en dos máquinas** el mismo día en que el guion de validación decía
  explícitamente no hacerlo. Salió bien por suerte, no por criterio.
- **Se borró el almacenamiento de Entrada** para matar mesas fantasma — y con eso se enfrió el
  caché del mapa, provocando el síntoma que luego se investigó como bug nuevo. El bug era real,
  pero se disparó por una acción propia.
- **Se afirmó "14 agentes muertos"** cuando estaban **apagados a mano**, y bien apagados: leen
  una tabla con 42 días sin datos.
- **Se exageró un hallazgo** ("el detector de faltantes está ciego") sobre datos que resultaron
  ser de restaurantes demo sembrados.
- **Se reintrodujo, en el propio arreglo, la carrera que ese arreglo evitaba.** Se detectó
  leyendo el diff contra `merge-base` antes de mergear — **CI estaba en verde con el bug
  adentro**.
- **Se afirmó que Escondite "nunca se tocó"**, cuando el acta del 24-ago la certifica.
  La afirmación venía de memoria, no de leer el acta.

> La lección común: **CI verde no es evidencia, y la memoria de sesiones anteriores es la
> fuente menos confiable de todas.** Lo que sostiene una afirmación es el archivo, la consulta
> o la pantalla — citados.

---

## Anexo B — de dónde sale este documento

| Fuente | Qué aporta |
|---|---|
| `~/Documents/OFFLINE-AMALAY-CIERRE-2026-08-24.docx` | El acta de certificación: qué funciona, cómo se instala una terminal, runbook de corte, escalabilidad |
| Sesión **"AMALAY"** (`76d70a97`) | Primera sesión de campo: limpieza del almacenamiento de la caja, instalación 1.3.7, primera orden verificada en la nube |
| Sesión **"AMALAY (fork)"** (`5da718bd`) | Continuación: Entrada, KDS, el bug del puente, la auditoría de datos |
| Sesión **"AMALAY (fork 2)"** (`579eeb71`) | Cierre: T-26, el espacio de direcciones, la validación final |
| PR #246, #247 y #249–#256 | El código, el alcance de cada arreglo y sus pruebas de regresión |
| `../offline/GUION-VALIDACION-DOMINGO-2026-08-31.md` | Alcance permitido de la visita y secuencia de certificación |
| `../pos/PLAN-RECONCILIACION-ELECTRON.md` | Divergencia entre líneas Electron y plan para reconciliarlas |
| `../pos/OFFLINE-CUTOVER-PLAN.md` | Gates G1–G3 y condiciones reales del corte offline |
| `../offline/TEST-MATRIX.md` | T-24, T-25, T-26 y matriz de regresión offline |

Las tres sesiones son la misma línea de trabajo continuada, no tres investigaciones
independientes: `fork` continúa a `AMALAY` y `fork 2` continúa a `fork`. Lo que aportan ya
está incorporado arriba.

**Lo que no se revisó a fondo:** los 778 mensajes de la sesión "AMALAY" se consultaron por
búsqueda dirigida, no íntegros. Si aparece un tema que este documento no cubre, ahí está el
lugar donde buscarlo.

---

## Anexo C — procedimiento DevTools para diagnosticar Electron sin teclado físico

Este procedimiento fue el que convirtió “el bridge abre en Chrome” en evidencia útil. Abrir
`/health` directamente sólo demuestra que el servidor local vive; **no demuestra** que una
página HTTPS pueda consultarlo desde su origen.

1. Cerrar Fullsite POS.
2. Abrir Símbolo del sistema y lanzar el ejecutable con
   `--remote-debugging-port=9222`.
3. Abrir Chrome en `http://127.0.0.1:9222`.
4. Elegir el target **Fullsite POS**, no el Service Worker.
5. En **Console**, filtrar por `127.0.0.1` o `7717`.
6. En **Network**, activar *Preserve log* y recargar cerrando/abriendo la app cuando no haya
   teclado o F5.
7. En **Application**, revisar por separado:
   - Service Workers para shell y rutas;
   - IndexedDB para órdenes/mesas/turno;
   - Local Storage para identidad y configuración.
8. Antes de borrar almacenamiento, verificar que la cola offline esté vacía y capturar una
   evidencia del estado actual. **Borrar storage puede borrar el único snapshot útil y hacer
   que mesas ocupadas parezcan libres.**
9. Después del arreglo #256, el criterio del bridge es: filtro `127.0.0.1` con **0 errores**.
   Antes se observaba `target IP address space`, `local/loopback` o `net::ERR_FAILED`.

Si Chrome rechaza pegar en Console, escribir manualmente `allow pasting`. No usar esto para
ocultar errores ni para modificar datos de producción; sólo para pruebas de lectura/fetch
acotadas.

---

## Anexo D — playbook clonable para el siguiente restaurante

### D.1 Siete días antes

- Crear un manifiesto por terminal: nombre, rol, `terminal_id`, versión Electron, URL del
  bridge, IP LAN, impresoras, lector de huella, acceso remoto y responsable.
- Confirmar que todos los equipos tengan acceso remoto. Una terminal fuera de Tailscale o
  TeamViewer es una terminal no observable.
- Congelar las versiones web y Electron. No mezclar validación web con instalación desktop.
- Conservar el sistema anterior y sus accesos directos como rollback. No desinstalar
  Wansoft/KDS anterior durante la certificación.
- Preparar órdenes de prueba identificables, monto esperado y limpieza auditable sin
  `DELETE` irreversible.

### D.2 Un día antes

- Verificar la versión **del proceso que corre** en `http://127.0.0.1:7717/health`; nunca
  confiar en el nombre de la carpeta o instalador.
- Confirmar `restaurant_id`, `terminal_id` único y rol correcto.
- Probar `/health`, `/fp/health`, estaciones, impresoras y KDS.
- Entrar una vez con red para calentar IndexedDB y guardar evidencia de tamaño/fecha.
- Verificar que la cola offline esté en cero antes de limpiar storage o cambiar build.
- Inspeccionar que el acceso directo apunte al ejecutable validado.

### D.3 Matriz física por cada rol

| Prueba | Caja | Entrada/secundaria | KDS |
|---|---:|---:|---:|
| PIN online y offline | obligatoria | obligatoria | — |
| Huella online y offline | obligatoria | obligatoria | — |
| Navegación de mesas | obligatoria | obligatoria | recepción |
| Enviar orden a cocina | obligatoria | **crítica: camino único** | recibe |
| Impresión por estación | obligatoria | obligatoria | estado correcto |
| Cobro offline | obligatoria | según rol | — |
| Reconexión y drenado | obligatoria | obligatoria | sin duplicados |
| Arranque frío sin WAN | obligatoria | obligatoria | estado coherente |
| Plano conserva ocupación/montos | obligatoria | obligatoria | — |

### D.4 Gates de go/no-go

No se corta al sistema nuevo si ocurre cualquiera de estos puntos:

- la cola no drena después de recuperar internet;
- una comanda puede perderse sin alerta;
- el plano puede mostrar libre una mesa ocupada;
- existen dos cuentas activas invisibles para la misma mesa;
- un caché local de turnos puede bloquear la operación sin WAN;
- la huella sólo funciona en una terminal cuando el procedimiento exige varias;
- no existe rollback ejecutable o no hay acceso remoto a todos los equipos.

### D.5 Evidencia mínima del cierre

- `/health` de cada proceso con versión, hostname y rol;
- captura de DevTools sin errores del bridge;
- tabla de resultados online/offline/reconexión por terminal;
- IDs de órdenes de prueba y su resultado en KDS/impresión/pago;
- tamaños y timestamps de IndexedDB antes/después del calentamiento;
- estado de colas antes del corte y después de reconectar;
- lista explícita de pendientes, dueño y fecha; ningún “funcionó” sin evidencia asociada.

---

## Anexo E — discrepancias que no deben convertirse en verdad histórica

Durante la noche se mencionaron versiones distintas para Entrada (1.3.7, 1.3.8 y 1.3.9) y
se confundieron nombres de carpetas con procesos activos. Este documento **no adjudica una
versión final** sin una captura fresca de `/health`. La lección clonable es mantener un
manifiesto firmado al inicio y al final de la visita.

También hubo dos mensajes distintos con el número 16:

- “16 órdenes abiertas”: compatible con las órdenes de prueba todavía activas;
- “16 turnos abiertos”: incompatible con la base, que mostraba un solo turno, y atribuible
  a estado local obsoleto/contaminado hasta que se pruebe la causa exacta.

No deben mezclarse. El primero describe datos de prueba; el segundo es un defecto de
resiliencia offline que puede bloquear la venta.
