# 01 — Operación

> Dominio: Flujo del día completo, turnos, apertura, cierre, autenticación de staff  
> Patrones: OP-001 a OP-014  
> Referencias cruzadas: → CJ-007 (corte Z), → OF-002 (IDB offline), → EC-007 (órdenes abiertas al cierre)

---

## OP-001 — Apertura del día: fondo de caja obligatorio

```
ID:                OP-001
Nombre:            Apertura del día: fondo de caja obligatorio
Categoría:         Operación
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md, FULLSITE-POS-OPERATIONAL-BIBLE.md (AMALAY config)
```

**Evidencia:**  
AMALAY opera con fondo inicial de $1,700 MXN fijo al abrir cada turno. Este monto se registra al iniciar el turno y se descuenta del efectivo al calcular el corte Z.

**Problema operacional:**  
Sin fondo registrado, el corte Z no puede calcular correctamente el efectivo generado durante el turno — el saldo inicial contamina el cálculo de ventas en efectivo.

**Por qué existe:**  
El efectivo en caja al inicio del turno no es ingreso del día — es el cambio necesario para operar. Sin separarlo, el efectivo del corte Z aparece inflado.

**Cuándo aplica:**  
Cada apertura de turno, en todas las terminales. Si hay múltiples terminales, cada una puede tener su propio fondo.

**Comportamiento observado:**  
En Wansoft: el cajero registra el fondo en la pantalla de apertura; queda asociado al turno del cajero. En Fullsite: flujo equivalente documentado; monto AMALAY hardcodeado en $1,700 MXN (ver → CF-007 sobre configuración por cliente).

**Impacto operativo:**  
Si el cajero olvida registrar el fondo, el corte Z muestra un faltante de $1,700 — la caja "cuadra" solo si el fondo se descontó.

**Limitaciones conocidas:**  
El monto de fondo es fijo en AMALAY. No hay evidencia de configuración dinámica por turno o por terminal.

**Preguntas abiertas:**  
- ¿Puede el gerente cambiar el monto del fondo sin deploy? → Ver → UNK-001
- ¿Qué pasa si se abre turno sin registrar fondo? ¿El sistema lo permite?

---

## OP-002 — Turno como unidad de control fiscal

```
ID:                OP-002
Nombre:            Turno como unidad de control fiscal
Categoría:         Operación
Clasificación:     MATCH
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md, FULLSITE-OPERATIONS-BIBLE.md
```

**Evidencia:**  
El turno es la estructura que agrupa todas las transacciones del día. Cada venta, cancelación, descuento y propina pertenece a un turno. El corte Z cierra el turno y genera el reporte fiscal.

**Problema operacional:**  
Sin turno, no hay unidad de reconciliación. No se puede saber qué ventas corresponden a qué período ni qué mesero fue responsable de qué cuenta.

**Por qué existe:**  
Requerimiento fiscal mexicano (SAT) y operacional: el turno es la unidad de auditoría mínima para restaurantes.

**Cuándo aplica:**  
Todo el tiempo. No hay operación POS sin turno activo (ver → OP-006 TurnoGate).

**Comportamiento observado:**  
En Wansoft: el turno pertenece a la terminal (cajero). En Fullsite: turno ligado a la sesión de la terminal. Múltiples terminales pueden tener turnos independientes.

**Impacto operativo:**  
Si un turno queda abierto sin cerrar (ej. falla de luz), las órdenes quedan en estado "stale" — el sistema las detecta pero no las anula automáticamente (ver → OP-007, → EC-007).

**Limitaciones conocidas:**  
No hay evidencia de mecanismo de recuperación de turno si el dispositivo se reinicia a mitad del turno.

**Preguntas abiertas:**  
- ¿Un turno puede reasignarse de terminal? En Wansoft sí (ver → OP-014). En Fullsite: sin evidencia.

---

## OP-003 — Un turno por terminal, no por negocio

```
ID:                OP-003
Nombre:            Un turno por terminal, no por negocio
Categoría:         Operación
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md, FULLSITE-OPERATIONS-BIBLE.md
```

**Evidencia:**  
Cada terminal POS tiene su propio turno independiente. Un restaurante con 3 terminales puede tener 3 turnos abiertos simultáneamente.

**Problema operacional:**  
El corte Z al final del día debe consolidar todos los turnos de todas las terminales para el reporte fiscal total. Si cada terminal cierra por separado, hay riesgo de que el total no cuadre con el reporte consolidado.

**Por qué existe:**  
Modelo heredado de sistemas monolíticos (Wansoft). Cada caja es autónoma — necesario para operación offline independiente.

**Cuándo aplica:**  
Restaurantes con múltiples terminales (barra, terraza, salón principal).

**Comportamiento observado:**  
En Wansoft: turno por cajero (terminal). Corte Global consolida todos. En Fullsite: turno por sesión de terminal. Sin evidencia de corte Global implementado.

**Impacto operativo:**  
Para el cierre contable, alguien debe sumar manualmente los cortes de todas las terminales si no hay corte consolidado automático.

**Limitaciones conocidas:**  
Fullsite no tiene corte Global equivalente al de Wansoft (ver → CJ-009).

**Preguntas abiertas:**  
- ¿Cómo consolida AMALAY los turnos de múltiples terminales?

---

## OP-004 — Cierre de turno bloquea acceso al POS

```
ID:                OP-004
Nombre:            Cierre de turno bloquea acceso al POS
Categoría:         Operación
Clasificación:     MATCH
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md (TurnoGate component)
```

**Evidencia:**  
Una vez que el turno se cierra, la terminal queda bloqueada hasta que se abra un nuevo turno. No es posible tomar órdenes en un turno cerrado.

**Problema operacional:**  
Si el cajero cierra el turno por error mientras hay mesas abiertas, las órdenes activas no pueden avanzar en esa terminal.

**Por qué existe:**  
Integridad fiscal: un turno cerrado es irrepetible. Reabrir aceptaría transacciones en un período ya reportado.

**Cuándo aplica:**  
Siempre que el cajero ejecute "cerrar turno" o el turno alcance estado "stale".

**Comportamiento observado:**  
TurnoGate component bloquea el UI completo del POS. Solo se puede crear nuevo turno o, si el sistema lo permite, investigar el turno stale.

**Impacto operativo:**  
Alto si hay órdenes abiertas. El mesero no puede cobrar hasta que el gerente resuelva la situación (nuevo turno = nuevo período fiscal).

**Limitaciones conocidas:**  
No hay "reabrir turno" — la única salida es un nuevo turno con las transacciones pendientes reclasificadas.

**Preguntas abiertas:**  
- ¿Qué pasa con las órdenes activas al cerrar el turno? → Ver → EC-007

---

## OP-005 — Cierre de turno y corte Z son conceptos distintos

```
ID:                OP-005
Nombre:            Cierre de turno y corte Z son conceptos distintos
Categoría:         Operación
Clasificación:     SURPASS
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md, FULLSITE-OPERATIONS-BIBLE.md
```

**Evidencia:**  
El cierre de turno es un evento de la terminal (detiene la operación). El corte Z es el reporte fiscal que se genera del turno — puede generarse en el mismo momento o después.

**Problema operacional:**  
En sistemas que no separan ambos conceptos, el operador no puede cerrar la operación sin generar el reporte fiscal, lo que bloquea si hay impresora fuera de línea.

**Por qué existe:**  
La separación permite cerrar la operación sin depender de la impresora. El corte Z puede imprimirse cuando la impresora vuelva.

**Cuándo aplica:**  
Al final del día. También cuando hay falla de impresora al cerrar.

**Comportamiento observado:**  
Fullsite separa ambos. Wansoft los mezcla — el corte Z es parte del proceso de cierre de turno (no se puede cerrar sin imprimir el corte).

**Impacto operativo:**  
Si la impresora falla en Wansoft al intentar el corte, el turno no se puede cerrar. En Fullsite, el cierre procede y la impresión se reintenta.

**Limitaciones conocidas:**  
No hay evidencia de que Fullsite haya probado esto en campo con impresora offline.

**Preguntas abiertas:**  
- ¿El SAT requiere impresión física del corte Z o solo el registro digital?

---

## OP-006 — TurnoGate: bloqueo de POS sin turno activo

```
ID:                OP-006
Nombre:            TurnoGate: bloqueo de POS sin turno activo
Categoría:         Operación
Clasificación:     SURPASS
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md (TurnoGate component)
```

**Evidencia:**  
TurnoGate es un componente React que envuelve el POS completo. Si no hay turno activo, el POS muestra pantalla de bloqueo y no permite ninguna operación.

**Problema operacional:**  
Sin este guardia, un mesero podría tomar órdenes sin turno activo — las transacciones no quedarían asociadas a ningún período fiscal.

**Por qué existe:**  
Integridad de datos: toda transacción debe pertenecer a un turno. También simplifica la UI — no hay que validar el turno en cada operación individual.

**Cuándo aplica:**  
Al cargar el POS, en cada re-hidratación de la página, y cuando el turno expira (stale).

**Comportamiento observado:**  
El componente consulta el turno activo. Si no existe, renderiza pantalla de "Abrir turno". Si existe pero está stale (> N horas), renderiza pantalla de "Turno vencido".

**Impacto operativo:**  
Protege la integridad fiscal por diseño. Si el sistema pierde la referencia al turno (falla de red + IDB corrupta), el POS queda bloqueado hasta resolver.

**Limitaciones conocidas:**  
El comportamiento en caso de IDB corrupta no está documentado.

**Preguntas abiertas:**  
- ¿Cuántas horas antes de que un turno pase a "stale"?

---

## OP-007 — Estado de turno: loading / active / none / stale

```
ID:                OP-007
Nombre:            Estado de turno: loading / active / none / stale
Categoría:         Operación
Clasificación:     SURPASS
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md
```

**Evidencia:**  
El turno tiene 4 estados en Fullsite. Wansoft solo distingue abierto/cerrado — no modela el estado intermedio "stale" o "loading".

**Problema operacional:**  
Sin el estado "loading", la UI puede mostrar "no hay turno" durante la carga inicial (falso negativo que confunde al operador). Sin "stale", no hay forma de detectar un turno que quedó abierto por un error del día anterior.

**Por qué existe:**  
La distinción de estados permite que la UI sea honesta: "estoy verificando" vs "no hay turno" vs "hay un turno de ayer que no se cerró".

**Cuándo aplica:**  
Siempre que el POS carga. El estado "stale" solo aplica cuando existe un turno de más de N horas sin cerrar.

**Comportamiento observado:**  
- `loading`: la UI espera la respuesta de Supabase/IDB
- `active`: operación normal
- `none`: no hay turno — mostrar pantalla de apertura
- `stale`: hay un turno pero es de ayer — requiere acción del gerente

**Impacto operativo:**  
El estado "stale" previene operación en un turno del día anterior (evita mezclar días fiscales). El estado "loading" evita falsos bloqueos.

**Limitaciones conocidas:**  
El umbral de tiempo para "stale" no está documentado en las fuentes consultadas.

**Preguntas abiertas:**  
- ¿Cuántas horas de umbral para pasar a stale?
- ¿Qué acción toma el gerente cuando ve un turno stale? → Ver → UNK-002

---

## OP-008 — Órdenes abiertas al cerrar turno — comportamiento no bloqueante

```
ID:                OP-008
Nombre:            Órdenes abiertas al cerrar turno — comportamiento no bloqueante
Categoría:         Operación
Clasificación:     UNKNOWN
Estado evidencia:  INFERRED
Fuente:            BREAK-THE-RESTAURANT.md (Trust Issue #6)
```

**Evidencia:**  
BREAK-THE-RESTAURANT.md identifica "órdenes abiertas al cierre de turno" como Trust Issue #6. No se especifica el comportamiento exacto del sistema — solo que es una situación que puede ocurrir.

**Problema operacional:**  
Si hay una mesa con cuenta abierta y el cajero cierra el turno, esa cuenta queda en un estado ambiguo: ¿pertenece al turno cerrado o al siguiente?

**Por qué existe:**  
Los restaurantes tienen operaciones asíncronas — es normal que la mesa 5 esté pagando mientras el cajero ya quiere cerrar.

**Cuándo aplica:**  
Al intentar cerrar el turno con mesas activas.

**Comportamiento observado:**  
No documentado con certeza. INFERRED: el sistema debería advertir pero no bloquear. Wansoft: advertencia pero el cajero puede forzar el cierre.

**Impacto operativo:**  
Si la orden abierta termina en el turno siguiente, los reportes del día quedan incompletos para ese turno.

**Limitaciones conocidas:**  
Sin evidencia de campo ni código verificado sobre este flujo específico.

**Preguntas abiertas:**  
- ¿El sistema permite cerrar turno con órdenes abiertas?
- ¿Muestra advertencia? ¿Bloquea? ¿Permite forzar?
- → Ver → EC-007, → UNK-003

---

## OP-009 — Hora pico identificada internamente

```
ID:                OP-009
Nombre:            Hora pico identificada internamente (sin config de operador)
Categoría:         Operación
Clasificación:     SURPASS
Estado evidencia:  CODE VERIFIED
Fuente:            CLAUDE.md (tabla wansoft_kpis — columna hora_pico)
```

**Evidencia:**  
La tabla `wansoft_kpis` tiene columna `hora_pico` calculada automáticamente. Wansoft no tiene equivalente documentado — el operador lo conoce por experiencia.

**Problema operacional:**  
Sin identificación automática de hora pico, el gerente no puede anticipar necesidades de staffing ni alertar a cocina para aumentar producción.

**Por qué existe:**  
Los restaurantes tienen patrones de demanda predecibles (fin de semana vs entre semana, mediodía vs noche). Identificarlos automáticamente reduce la carga cognitiva del gerente.

**Cuándo aplica:**  
Continuamente durante el turno. Más útil durante la planificación del día siguiente.

**Comportamiento observado:**  
Columna calculada en tiempo real. No hay evidencia de notificación proactiva al gerente cuando se acerca la hora pico.

**Impacto operativo:**  
Potencial para alertas de staffing anticipadas. Actualmente solo disponible en dashboard, no en POS.

**Limitaciones conocidas:**  
El algoritmo de detección no está documentado en las fuentes consultadas.

**Preguntas abiertas:**  
- ¿Cómo se calcula `hora_pico`? ¿Ventana deslizante? ¿Histórico?
- → Ver → UNK-004

---

## OP-010 — PIN con TTL de 900 segundos

```
ID:                OP-010
Nombre:            Sesión de PIN con TTL 900s — re-auth silencioso
Categoría:         Operación
Clasificación:     SURPASS
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md (PIN_CACHE_TTL = 900000ms)
```

**Evidencia:**  
`PIN_CACHE_TTL = 900000ms` (15 minutos). Después de este tiempo, el sistema re-autentica silenciosamente en background. El mesero no nota la re-auth salvo que falle.

**Problema operacional:**  
En Wansoft, el PIN se valida en cada operación importante (sin TTL documentado). En Fullsite, hay un período de 15 minutos donde el PIN no se re-valida, lo que puede ser un riesgo si el mesero deja la terminal sin bloquear.

**Por qué existe:**  
Reducir fricción: el mesero no tiene que ingresar su PIN en cada orden. El TTL balancea seguridad vs. usabilidad.

**Cuándo aplica:**  
Después de cada autenticación exitosa. El reloj reinicia con cada operación.

**Comportamiento observado:**  
El PIN cacheado se guarda en memoria (no en localStorage para evitar robo de PIN). La re-auth ocurre antes de que expire el caché.

**Impacto operativo:**  
Un mesero que deja la terminal sin bloquear tiene hasta 15 minutos antes de que expire la sesión. Cualquier persona puede tomar órdenes con la identidad del mesero.

**Limitaciones conocidas:**  
No hay "lock screen" manual documentado — el mesero no puede bloquear activamente la terminal sin cerrar la sesión.

**Preguntas abiertas:**  
- ¿Puede el mesero bloquear manualmente la terminal?
- → Ver → UNK-005

---

## OP-011 — Idle timeout de 1800 segundos

```
ID:                OP-011
Nombre:            Idle timeout 1800s — cierre automático de sesión
Categoría:         Operación
Clasificación:     MATCH
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md (IDLE_TIMEOUT_MS = 1800000ms)
```

**Evidencia:**  
`IDLE_TIMEOUT_MS = 1800000ms` (30 minutos). Después de 30 minutos sin interacción, el sistema cierra la sesión del mesero.

**Problema operacional:**  
Una sesión activa sin usuario presente es un riesgo de seguridad — cualquiera puede operar el POS como ese mesero.

**Por qué existe:**  
Estándar de seguridad para terminales compartidas. Común en todos los POS de restaurantes.

**Cuándo aplica:**  
En cualquier momento donde no haya interacción con el POS por más de 30 minutos.

**Comportamiento observado:**  
La sesión se invalida y el sistema regresa a pantalla de ingreso de PIN.

**Impacto operativo:**  
Bajo en operación normal — 30 minutos es mucho tiempo en un restaurante activo. Alto en turnos nocturnos o momentos de baja actividad.

**Limitaciones conocidas:**  
El idle timeout es fijo — no configurable por el operador.

**Preguntas abiertas:**  
- ¿Se puede configurar el tiempo de idle por cliente? → Ver → CF-003

---

## OP-012 — Apertura offline: snapshot de menú en IDB desde boot

```
ID:                OP-012
Nombre:            Apertura offline: snapshot de menú en IDB desde boot
Categoría:         Operación
Clasificación:     SURPASS
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md, OFFLINE-SUITE-v1.md (OC-10)
```

**Evidencia:**  
Al iniciar el POS, el menú completo (categorías + ítems) se carga en IndexedDB. Si la red cae después del boot, el POS puede seguir operando con el snapshot del menú.

**Problema operacional:**  
Si el menú solo está en el servidor y la red cae, el POS no puede mostrar ítems — la operación se detiene.

**Por qué existe:**  
Requerimiento de operación offline: el menú debe estar disponible sin internet. Benchmark: Wansoft opera sin internet porque SQL Server es local.

**Cuándo aplica:**  
Siempre al iniciar el POS. El snapshot se actualiza cuando hay conectividad y el menú cambió.

**Comportamiento observado:**  
OC-10 está en PASS (código). Aún pendiente validación de campo (Fase 5 de certificación offline).

**Impacto operativo:**  
El mesero puede tomar órdenes con el menú correcto incluso sin internet. Si el menú cambió esa mañana y el POS no sincronizó, el mesero trabaja con el menú del día anterior.

**Limitaciones conocidas:**  
La frecuencia de sincronización del snapshot de menú no está documentada en las fuentes consultadas.

**Preguntas abiertas:**  
- ¿Cada cuánto se actualiza el snapshot de menú en IDB?
- ¿Qué pasa si el menú cambió y el POS está offline? ¿El mesero lo sabe?
- → Ver → UNK-006

---

## OP-013 — Fondo de caja AMALAY: $1,700 MXN fijo

```
ID:                OP-013
Nombre:            Fondo de caja AMALAY: $1,700 MXN fijo
Categoría:         Operación
Clasificación:     UNKNOWN
Estado evidencia:  FIELD VERIFIED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (sección AMALAY config)
```

**Evidencia:**  
Documentado en la config real de AMALAY: fondo = $1,700 MXN. El valor está hardcodeado o configurado por Fullsite durante onboarding — no queda claro cuál.

**Problema operacional:**  
Si el dueño decide cambiar el fondo (ej. temporada alta = $2,500 MXN), ¿puede hacerlo sin intervención de Fullsite?

**Por qué existe:**  
El fondo varía por restaurante y por época del año. AMALAY usa $1,700 por decisión del gerente/dueño.

**Cuándo aplica:**  
Cada apertura de turno.

**Comportamiento observado:**  
En AMALAY: el cajero simplemente confirma el monto al abrir. No hay evidencia de que pueda modificarlo desde el UI.

**Impacto operativo:**  
Si el fondo cambia y el sistema no se actualiza, el corte Z mostrará diferencias de caja todos los días.

**Limitaciones conocidas:**  
Sin evidencia de dónde está almacenado este valor (código, base de datos, config de cliente).

**Preguntas abiertas:**  
- ¿Puede el gerente cambiar el monto del fondo desde el POS o requiere soporte?
- → Ver → UNK-001

---

## OP-014 — Turno transferible entre terminales en Wansoft

```
ID:                OP-014
Nombre:            Turno transferible entre terminales en Wansoft
Categoría:         Operación
Clasificación:     WANSOFT-ONLY
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (sección Wansoft Avanzadas)
```

**Evidencia:**  
Wansoft permite transferir el turno de un cajero a otro cajero en una terminal diferente. Útil cuando el cajero termina su turno pero hay órdenes activas que debe continuar otro operador.

**Problema operacional:**  
En restaurantes con cambio de turno (mañana/tarde/noche), sin transferencia de turno el cajero saliente debe esperar a que todas las mesas paguen antes de cerrar.

**Por qué existe:**  
Operación continua en restaurantes que tienen múltiples turnos de personal durante el día.

**Cuándo aplica:**  
Cambios de turno de personal. Más común en restaurantes que operan 12+ horas.

**Comportamiento observado:**  
En Wansoft: el "Turno de cajero" se transfiere. El nuevo cajero asume las cuentas activas. En Fullsite: sin evidencia de esta funcionalidad.

**Impacto operativo:**  
Sin transferencia, el cajero del turno de mañana en AMALAY tendría que esperar a que todas las mesas paguen antes de salir. En la práctica, AMALAY resuelve esto de alguna manera — cómo exactamente no está documentado.

**Limitaciones conocidas:**  
Fullsite no implementa esta funcionalidad. Puede ser un gap operacional para restaurantes con múltiples turnos de personal.

**Preguntas abiertas:**  
- ¿Cómo resuelve AMALAY el cambio de turno de cajero?
- → Ver → UNK-007
