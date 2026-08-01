# Fullsite POS — Biblia Operacional y de Producto

> Esta no es una documentación de Wansoft.
> Es la referencia oficial para entender, justificar y evolucionar
> el POS de Fullsite durante los próximos años.
>
> Cada flujo se analiza con una sola pregunta de fondo:
> ¿Qué haríamos si diseñáramos un POS desde cero hoy?
>
> Fecha: 2026-07-25
> Fuente primaria: WANSOFT-POS-BIBLE.md + evidencia operativa AMALAY + feedback Eduardo
> Complemento técnico: FULLSITE-POS-BIBLE.md (auditoría de código, state machines, limitaciones)
> KDS: documento independiente (pendiente)

---

## Índice

**El viaje de una orden**

0. [Principios](#0-principios) — Las 10 decisiones que guían todo lo demás
1. [Inicio del turno](#1-inicio-del-turno)
2. [El salón listo](#2-el-salon-listo)
3. [Llega el cliente](#3-llega-el-cliente)
4. [Captura de la orden](#4-captura-de-la-orden)
5. [Modificadores](#5-modificadores)
6. [Envío a cocina](#6-envio-a-cocina)
7. [Cambios durante la preparación](#7-cambios-durante-la-preparacion)
8. [Cancelaciones](#8-cancelaciones)
9. [Transferencias y cambios de mesa](#9-transferencias-y-cambios-de-mesa)
10. [Solicitud de cuenta](#10-solicitud-de-cuenta)
11. [Cobro](#11-cobro)
12. [Cierre de mesa](#12-cierre-de-mesa)
13. [Caja y retiros](#13-caja-y-retiros)
14. [Corte del turno](#14-corte-del-turno)
15. [Recuperación ante fallos](#15-recuperacion-ante-fallos)
16. [Operaciones de excepción](#16-operaciones-de-excepcion)

**Apéndices**

- [A: Veredictos consolidados](#apendice-a-veredictos)
- [B: Menú Avanzadas completo](#apendice-b-avanzadas)
- [C: Config operativa AMALAY](#apendice-c-config-amalay)
- [D: Principios en práctica](#apendice-d-principios-en-practica)

---

## 0. Principios

Estos principios son las decisiones de producto que determinan por qué el POS de Fullsite es diferente de Wansoft — no solo en features, sino en filosofía. Cada sección del documento los aplica y los cita.

---

**P1 — El POS no es el custodio del control. El event store sí lo es.**

En Wansoft, el control está en los toggles de seguridad: bloquear pantalla, pedir PIN, limitar intentos. En Fullsite, el control está en el event store: toda acción queda registrada, es inmutable, y es auditable. La restricción viene del análisis posterior, no del bloqueo previo. Un mesero que sabe que todo queda registrado opera diferente al que sabe que puede hacer algo si el gerente no está mirando.

**P2 — El operador no debe pensar. El sistema sí debe pensar.**

Un POS de restaurante lo usan personas bajo presión, de pie, con clientes esperando. Cada campo extra que el operador tiene que llenar es un error potencial. Cada decisión que el sistema puede tomar automáticamente (mesero por login, mesa por selección, silla por orden de captura) reduce la fricción sin reducir la trazabilidad.

**P3 — El flujo normal debe ser de 1 tap. El flujo de excepción puede ser de 5.**

El 90% de las órdenes son: mesa → ítems → enviar → cobrar → cerrar. Ese flujo debe ser el más rápido posible. Los descuentos, cancelaciones, y transferencias son excepciones — pueden requerir más pasos, más confirmaciones, más datos. No optimizar las excepciones a costa del flujo normal.

**P4 — La seguridad no se configura. Se diseña.**

El audit log no es una opción. Las razones de cancelación no son texto libre. Las cortesías no existen sin razón. Estos no son settings — son invariantes del sistema. El sistema que hace imposible el fraude sin esfuerzo es mejor que el que lo hace difícil con configuración.

**P5 — La confianza se gana con evidencia, no con permisos.**

Un gerente que confía en su equipo porque el sistema muestra que los números cuadran opera diferente a uno que desconfía porque no puede verificar. El POS debe generar esa evidencia automáticamente — dashboard de cancelaciones, ratio de descuentos, frecuencia de transferencias — sin que el gerente lo tenga que pedir.

**P6 — Offline no es modo de emergencia. Es modo de operación.**

Un restaurante no puede dejar de vender porque se fue el internet. El POS debe funcionar sin conexión exactamente igual que con conexión, y sincronizarse silenciosamente cuando la red regrese. El operador nunca debe saber si está online o offline — solo debe saber que la venta se registró.

**P7 — El ticket no es el fin. Es el inicio del análisis.**

Cada orden cerrada genera datos: mesa, personas, mesero, hora, duración, mix de platillos, método de pago, propina. Esos datos no son para el contador — son para el dueño que quiere entender su operación. El ticket impreso es para el cliente. El evento de cierre es para el sistema.

**P8 — Las impresoras son infraestructura, no features.**

El routing de comanda (qué imprime dónde) es una decisión de infraestructura crítica. Un platillo mal ruteado no llega a la cocina. Una impresora desconectada bloquea la operación. El sistema debe monitorear los periféricos activamente y alertar antes de que falle un servicio.

**P9 — La arquitectura nube elimina clases enteras de problemas.**

Configurar desde el dashboard y que se refleje en todas las terminales sin tocar ninguna físicamente. Un turno que nunca se perdió por crash de SQL local. Un reporte que siempre está disponible aunque la terminal esté apagada. Estos no son features — son consecuencias de una arquitectura correcta.

**P10 — Parity primero. Diferenciación después.**

El restaurante que migra de Wansoft a Fullsite necesita poder hacer todo lo que hacía antes en el primer día. La diferenciación (alertas proactivas, análisis, KDS digital) es el motivo para quedarse con Fullsite en el mes 6. No al revés.

---

## 1. Inicio del turno

### Qué hace

El cajero o gerente inicia sesión en el POS e identifica quién va a operar. Si no hay un turno abierto, debe abrir uno con el fondo de caja inicial. Si ya hay turno activo, entra directamente a la vista de operación.

### Problema operativo que resuelve

Sin identificación de operador, no hay trazabilidad de quién hizo qué. En un restaurante con 3 cajeros por turno, saber que "el Cajero 2" hizo 8 cancelaciones hoy es la diferencia entre detectar fraude y no detectarlo. El login vincula cada acción a una persona.

Sin apertura de turno con fondo de caja, el arqueo al cierre no tiene punto de comparación. "Cuánto había al abrir" es el denominador de toda la conciliación del día.

### Frecuencia

Universal. Ocurre una o más veces por día en cada terminal. Si falla, nada funciona.

### Cómo lo resuelve Wansoft

Login por huella digital (método primario) o PIN (alternativa). Un toque en el lector HID identifica al usuario y carga la vista de trabajo. Si el turno ya está abierto (el caso más común), entra directamente a la lista de órdenes activas.

Eduardo dijo explícitamente que prefiere que post-login vaya al **mapa de mesas** — no a la lista de órdenes. La prioridad visual del operador al entrar al turno es el estado del salón, no la lista de comandas.

El fondo de caja en AMALAY es $1,700 MXN. La apertura de turno registra ese monto como punto de partida del arqueo.

### Cómo lo resolvemos en Fullsite

Login por huella HID implementado (Jul 7-8). PIN como alternativa. La sesión queda asociada al usuario y al turno activo.

Post-login va al floor plan de mesas — ya alineado con el feedback de Eduardo, mejor que Wansoft.

Apertura de turno con fondo de caja: el flujo existe desde `/pos/turno` cuando no hay turno activo.

### Veredicto

**EQUIVALENTE** en identificación de operador. **MEJOR** en destino post-login (floor plan vs lista de órdenes).

### Principios aplicados

**P2** — El mesero auto-asignado por login de huella elimina un paso del flujo de creación de órdenes. No tiene que seleccionar su nombre de una lista.

### Cuando algo falla

**Huella no lee:** el sistema ofrece PIN inmediatamente, sin error largo. Un toque con el dedo vs un tap en el botón PIN. Si el PIN tampoco funciona, "Llamar al gerente" como CTA visible — no pantalla en blanco.

**Sin internet al abrir:** el login debe funcionar offline validando contra el caché local de credenciales (15 min TTL). El turno se registra localmente y sincroniza cuando hay conexión.

**Terminal no arranca:** la operación continúa en otra terminal. Los datos de sesión están en Supabase, no en la terminal local.

### Oportunidades de simplificación

El fondo puede tener un valor sugerido (el promedio histórico de las últimas 5 aperturas) para que el gerente solo confirme si cuadra, en lugar de escribir desde cero. Apertura de turno en 2 taps: huella → "¿Fondo de caja? [$1,700 sugerido]" → confirmar.

---

## 2. El salón listo

### Qué hace

La vista principal del POS muestra el estado actual del restaurante: qué mesas están libres, cuáles están ocupadas, cuáles esperan cobro, y cuáles tienen órdenes con tiempo excesivo.

### Problema operativo que resuelve

En un restaurante con 20-60 mesas, el mesero necesita saber en segundos el estado de su sección. Sin una vista de estado, tiene que preguntarle al cajero o revisar físicamente — minutos perdidos en cada hora de servicio.

El estado del salón también informa al gerente: ¿cuántas mesas están ocupadas?, ¿hay mesas esperando cobro mucho tiempo?, ¿cuál es la ocupación real?

### Frecuencia

Universal. Es la pantalla que más tiempo se pasa viendo durante un turno. El operador vuelve a ella decenas de veces por hora.

### Cómo lo resuelve Wansoft

AMALAY tiene el mapa de mesas **desactivado** y usa una **lista de órdenes en card view**. Cada card muestra: número de mesa, hora de apertura, total acumulado, número de orden. Cards en rojo = orden activa.

El mapa existe (editor drag & drop de cuadrados y círculos) pero nunca fue configurado en AMALAY. La lista de órdenes funciona como operación real.

Este es un hallazgo clave: no es que el mapa de Wansoft sea malo — es que el onboarding de Wansoft es tan difícil que nadie llega a configurarlo, y la lista de órdenes termina siendo el modo permanente de operación.

### Cómo lo resolvemos en Fullsite

Fullsite tiene un plano visual con zonas nombradas (Terraza, Interior, Barra) y mesas representadas gráficamente. Este es un **diferenciador real**: Fullsite tiene lo que Wansoft tiene como feature pero que AMALAY nunca pudo usar.

La lista de órdenes como alternativa al mapa (card view) no existe en Fullsite. Algunos operadores pueden preferirla para situaciones de alto volumen o como fallback si el plano no está configurado.

### Veredicto

**MEJOR** — Fullsite tiene el plano visual como primera opción funcional. El riesgo es el mismo que Wansoft: si el plano es difícil de configurar, nadie lo configura. La solución es un onboarding del plano que dure 10 minutos, no 2 horas.

### Principios aplicados

**P2** — El color de cada mesa es el estado: verde/libre, amarillo/ocupada, rojo/esperando cobro. El operador no busca el estado — lo ve.

**P9** — El estado de las mesas es la misma fuente de verdad para el POS y para el dashboard del gerente. No hay "actualizar" — hay datos en tiempo real.

### Cuando algo falla

**Mesa marcada como ocupada pero está físicamente libre:** botón "Liberar mesa" visible en el plano, registrado en event store con quién y cuándo.

**Mesa no aparece en el plano:** toggle de "Lista de órdenes" como fallback inmediato. El plano puede estar mal configurado — la operación no se detiene por eso.

### Oportunidades de simplificación

El color de la mesa encode tiempo de servicio, no solo estado: verde = < 45 min, amarillo = 45-90 min, rojo = > 90 min. El gerente ve de un vistazo qué mesas están demorando sin abrir cada una.

El estado del salón actualiza en tiempo real para todos los dispositivos simultáneamente (Supabase realtime). Cuando el mesero abre una mesa, el cajero ve la mesa ocupada inmediatamente — sin refrescar.

---

## 3. Llega el cliente

### Qué hace

El mesero crea una nueva orden asignándola a una mesa, tipo de orden, número de personas, y opcionalmente nombre de cliente.

### Problema operativo que resuelve

La creación de la orden es el momento en que el restaurante toma control del servicio. Sin una orden registrada, el cliente puede comer y pagar sin trazabilidad. Con la orden registrada, el flujo completo — cocina, mesero, cobro — queda vinculado a un registro único.

El tipo de orden (restaurante vs para llevar vs delivery) determina el flujo completo: qué comanda se imprime, qué ticket se genera, cómo se rutea la cocina.

### Frecuencia

Universal. Ocurre por cada cliente que llega. Es la primera acción operativa de cada servicio.

### Cómo lo resuelve Wansoft

Flujo lineal de 7 pasos: Nueva → tipo de orden → seleccionar mesero de lista → número de mesa → número de personas → nombre de cliente → confirmar → pantalla de captura.

Para llevar: pide nombre + número de torre (identificador del pedido en mostrador).

El número de orden es secuencial por turno (72, 73...) — no UUID. "La mesa 72" es más manejable operativamente que "La orden a8f3c2".

### Cómo lo resolvemos en Fullsite

Al tocar una mesa libre en el plano, se abre el modal de creación.

El tipo de orden se infiere del contexto: tocar mesa en el plano = restaurante. El mesero se auto-asigna por login. No hay lista para seleccionar.

El número de orden usa UUID internamente — en UI se muestran los primeros 8 caracteres hex. El staff no puede referirse a órdenes por número en conversación verbal.

### Veredicto

**MEJOR** — el flujo de Fullsite es más corto (3-4 pasos vs 7 en Wansoft) al inferir tipo de orden y auto-asignar mesero. **INFERIOR** en número secuencial legible para el staff.

### Principios aplicados

**P2** — Los campos que el sistema puede llenar automáticamente (mesero por login, tipo de orden por contexto, mesa por selección del plano) no se le piden al operador.

**P3** — La pantalla de captura debe aparecer en 1 tap desde el plano. El flujo de excepción (cambiar el mesero asignado, cambiar el tipo de orden) puede tener pasos adicionales.

### Cuando algo falla

**Mesa en conflicto:** si dos meseros intentan abrir la misma mesa simultáneamente, el segundo ve el estado actualizado inmediatamente. No hay error genérico de "mesa tomada".

**Para llevar sin nombre:** nombre requerido para para llevar. Si el cliente no tiene nombre, "CLIENTE" + número de orden como fallback. No bloquear la operación por este campo.

### Oportunidades de simplificación

La secuencia ideal con plano configurado:
1. Mesero toca mesa vacía
2. Sistema pregunta: "¿Cuántas personas?" → ingresa número
3. Orden creada: mesa = seleccionada, mesero = usuario activo, tipo = restaurante
4. Abre directamente la pantalla de captura

Tres campos eliminados vs Wansoft. El nombre de cliente solo se pide para para llevar y delivery — donde sí es necesario para identificar el pedido en el mostrador.

El número de orden debe coexistir en dos formatos: UUID para el sistema, número secuencial para el operador. El cajero dice "Mesa 8, Orden 142" — no "Orden abc-123-def".

---

## 4. Captura de la orden

### Qué hace

El mesero agrega platillos a la orden usando categorías, subcategorías, y opcionalmente escáner de código de barras. Asigna silla a cada ítem capturado.

### Problema operativo que resuelve

La captura es donde el mesero convierte la solicitud del cliente en una orden digital. Los errores de captura — platillo equivocado, modificador faltante, silla sin asignar — se manifiestan como: cocina preparando lo incorrecto, comanda incompleta, split de cuenta imposible.

La velocidad de captura importa: un mesero bajo presión que tarda 3 minutos en capturar una orden de 5 personas está dejando el salón desatendido.

### Frecuencia

Universal. Es la acción central del POS. Todo lo demás existe para que esta pantalla funcione bien.

### Cómo lo resuelve Wansoft

La pantalla tiene tres áreas:
- **Izquierda:** lista de ítems capturados con CANT +/- y SILLA +/- en el centro
- **Derecha:** botones de categorías con colores (ALIMENTOS, BEBIDAS, MARKET, ALCOHOL, POSTRES, APPETIZERS, VENTAS TERCEROS, EVENTO/MENU)
- **Arriba:** campo de código de barras siempre visible para productos de Market

AMALAY tiene 18 subcategorías en ALIMENTOS, cada una con color diferente.

El separador **XX TIEMPO** se agrega automáticamente como marcador de inicio de orden en la comanda — la cocina sabe cuándo empezó a contar el reloj.

Los botones son configurables con sliders (ancho, alto, fuente) con preview en vivo.

### Cómo lo resolvemos en Fullsite

Pantalla de captura con categorías, items, y asignación de silla. Diseñada para touch desde el inicio — ventaja sobre Wansoft que fue diseñado para mouse.

El campo de escaneo de código de barras no está integrado en la pantalla de captura principal — es una acción separada.

El separador XX TIEMPO no existe en Fullsite. La cocina no tiene un marcador visual de cuándo empezó el reloj de esta mesa.

### Veredicto

**EQUIVALENTE** con ventaja UX en touch. **INFERIOR** en barcode integrado en captura y separador de tiempo en comanda.

### Principios aplicados

**P3** — El flujo normal (seleccionar ítem, confirmar modificadores, siguiente ítem) debe ser el más rápido. Las acciones de excepción (cambiar cantidad, reasignar silla, borrar ítem no enviado) están disponibles pero no en el camino crítico.

**P4** — La silla se asigna en el momento de captura, no después. Es un prerequisito del split de cuenta. No es un campo opcional — es un dato de negocio.

### Cuando algo falla

**Platillo no encontrado:** campo de búsqueda por nombre como fallback. Más rápido que navegar 18 subcategorías.

**Scanner no lee:** entrada manual del código como alternativa, con el campo visible en pantalla principal.

**Ítem con modificadores requeridos saltado:** bloqueo explícito: "Este platillo requiere seleccionar [SALSA]. Completa antes de continuar." No cerrar silenciosamente.

### Oportunidades de simplificación

**Búsqueda global en captura:** teclear "chil" y ver "CHILAQUILES" es más rápido que ALIMENTOS → DESAYUNOS → CHILAQUILES para un mesero experimentado.

**Silla auto-incremental:** cada ítem capturado se asigna a la silla actual. Para cambiar de silla, el mesero toca "Cambiar silla" una vez — todos los siguientes ítems van a esa silla. Sin asignar silla por ítem individualmente.

**Platillos frecuentes por contexto:** si la Mesa 8 los domingos a las 10am siempre pide chilaquiles, los primeros botones pueden ser esos platillos. Menos navegación para el caso más común.

---

## 5. Modificadores

### Qué hace

Cuando un platillo tiene opciones de personalización, el sistema abre un flujo paso a paso (escalonado por niveles) para capturar las especificaciones antes de agregar el ítem a la orden.

### Problema operativo que resuelve

Sin modificadores estructurados, la personalización se captura como texto libre. Las notas de texto libre generan interpretaciones incorrectas en cocina, no son analizables estadísticamente, y no tienen validación de completitud.

Un platillo con modificadores requeridos (CHILAQUILES de AMALAY requieren selección de salsa) sin el flujo de modificadores crearía comandas incompletas.

### Frecuencia

Muy común. AMALAY tiene modificadores en prácticamente todos sus platillos principales.

### Cómo lo resuelve Wansoft

Flujo escalonado: al seleccionar el platillo, si tiene modificadores se abre un modal para el Nivel 1. Cada nivel tiene nombre, regla (requerido/opcional), y cantidad máxima de selecciones.

**AMALAY — ejemplos reales:**
- CHILAQUILES → Nivel 1 SALSA (Requerido, exactamente 1): Mixtos, Rojos, Verdes → Nivel 2 EXTRAS (Opcional, máximo 4): Aguacate, Chicharrón, Ext. Huevo, Pollo
- ACAI BOWL → Nivel 1 PROTEÍNA (Opcional, máximo 2): Habits Vainilla, Habits Colágeno

El modificador se concatena al nombre del ítem en la orden y comanda: "CHILAQUILES. VERDES". Visible inmediatamente — el mesero confirma que seleccionó lo correcto.

Un botón azul de check permite saltar niveles opcionales.

### Cómo lo resolvemos en Fullsite

Modifier steps implementados (Jul 8). El flujo escalonado existe y funciona.

La edición rápida de modificadores después de captura (antes de enviar a cocina) no existe. Si el mesero captura "CHILAQUILES. VERDES" y el cliente cambia a "ROJOS", tiene que borrar y recapturar el ítem completo.

### Veredicto

**EQUIVALENTE** en el flujo core. **INFERIOR** en edición post-captura de modificadores (no implementada).

### Principios aplicados

**P4** — Los modificadores requeridos no se pueden saltar. El sistema bloquea el avance si el nivel actual es obligatorio y no tiene selección. No hay "guardar sin completar".

**P2** — Los modificadores opcionales tienen un botón de skip visible. El mesero no deduce que puede saltar — el sistema lo dice.

### Cuando algo falla

**Cliente cambia un modificador ya seleccionado (ítem no enviado):** debe poder editar solo el modificador sin borrar y recapturar el platillo. Esta es una mejora pendiente — hoy requiere borrar y recapturar.

**Nivel con muchas opciones (>8 ítems):** grid de 2 columnas o scroll horizontal. No truncar.

### Oportunidades de simplificación

**Edición pre-envío:** tocar un ítem capturado (no enviado) abre sus modificadores para edición directa.

**Favoritos por platillo:** si el 80% de los CHILAQUILES son VERDES, el default puede ser VERDES pre-seleccionado — el mesero solo confirma en lugar de seleccionar.

---

## 6. Envío a cocina

### Qué hace

El mesero envía la orden capturada a cocina. El sistema imprime comandas en las impresoras correspondientes según el routing de cada ítem, y la orden queda en estado "en preparación".

### Problema operativo que resuelve

Sin el envío, la cocina no sabe qué preparar. El envío es el contrato entre el POS y la cocina: "estos ítems son reales, empieza a prepararlos". La comanda impresa es la evidencia física de ese contrato.

El routing determina que los ítems correctos lleguen a la estación correcta: cocina caliente recibe alimentos, barra recibe bebidas, market no imprime.

### Frecuencia

Universal. Ocurre en cada orden. Posiblemente la acción más frecuente del POS después de agregar ítems.

### Cómo lo resuelve Wansoft

El botón principal se llama "**Guardar**" — naming que genera confusión. "Guardar" suena a "no perder el trabajo". En realidad, es: enviar a cocina + imprimir comanda + registrar orden. No es un borrador — es una acción irreversible.

Al presionar Guardar, aparece un diálogo de confirmación: **"NO OLVIDES ANOTAR TODAS LAS ESPECIFICACIONES"** con botones Sí/No. Es una fricción intencional — hace que el mesero se detenga y verifique las especificaciones antes de enviar.

La comanda se imprime automáticamente en la impresora asignada por routing de cada ítem. Post-envío regresa a la lista de órdenes (Eduardo quiere que vaya al mapa de mesas).

**Formato de comanda real AMALAY:**
```
EN MESA
Orden: 72
Mesa: 8
Personas: 3
Mesero: Eduardo
XX TIEMPO ─────────────
Silla 1 | CHILAQUILES. VERDES
Silla 2 | ACAI BOWL
Silla 1 | CAFÉ AMERICANO
```

La cancelación de un ítem se imprime en la misma impresora como aviso a cocina.

### Cómo lo resolvemos en Fullsite

El botón se llama "**Enviar**" — naming correcto. No "Guardar".

La comanda se imprime via el bridge de impresión (Electron). El routing por ítem está implementado (parcialmente).

El diálogo de confirmación de Wansoft ("no olvides las especificaciones") no existe en Fullsite. Puede ser una pérdida operativa — los meseros que envían con modificadores faltantes no tienen ese momento de pausa para verificar.

El separador XX TIEMPO no existe. La cocina no tiene un marcador visual de cuándo empezó el reloj.

La confirmación de impresión exitosa no existe. Si la impresora falla, el mesero no sabe que la comanda no llegó.

Post-envío regresa al plano de mesas — ya alineado con el feedback de Eduardo.

### Veredicto

**EQUIVALENTE** en el flujo core. **MEJOR** en naming (Enviar vs Guardar) y en destino post-envío (plano vs lista). **INFERIOR** en confirmación de impresión exitosa y separador de tiempo en comanda.

### Principios aplicados

**P8** — Una falla silenciosa (el sistema dice "enviado" pero la comanda no llegó a cocina) es peor que un error explícito. El sistema debe confirmar que cada comanda fue recibida por la impresora.

**P6** — En modo offline, las comandas se acumulan en la cola local y se envían cuando regresa la conexión. La cocina siempre recibe sus comandas — incluso si llegan con 30 segundos de retraso.

### Cuando algo falla

**Impresora sin papel o desconectada:** alerta inmediata al mesero y al gerente: "IMPRESORA COCINA NO DISPONIBLE. ¿Imprimir en otra impresora?" No silencio.

**Comanda enviada pero no aparece en cocina:** botón de "Reimprimir comanda" visible dentro de la orden, sin restricción de tiempo. Cualquier comanda pasada puede reimprimirse.

### Oportunidades de simplificación

**Confirmación visual de impresión:** al enviar, la pantalla muestra brevemente "✓ Comanda enviada a COCINA CALIENTE" antes de regresar al plano. No requiere un diálogo adicional — solo retroalimentación visual de que funcionó.

**El botón que falta:** "Enviar sin imprimir" para mercado y productos de market que tienen [NO IMPRIMIR] configurado. Hoy estos ítems simplemente no generan comanda — debería ser explícito en la pantalla de captura.

---

## 7. Cambios durante la preparación

### Qué hace

Después de que la comanda fue enviada, el cliente pide algo más o el mesero necesita modificar la orden.

### Problema operativo que resuelve

Los clientes raramente piden todo de una vez. La realidad: se envía la comanda de alimentos, 5 minutos después el cliente pide un segundo café. El sistema necesita manejar adiciones a órdenes ya enviadas sin crear una nueva orden.

Principio clave: los **ítems ya enviados son inmutables** — no se pueden editar, solo cancelar. Los ítems nuevos se agregan libremente.

### Frecuencia

Común. Ocurre en la mayoría de las mesas, especialmente en servicios largos.

### Cómo lo resuelve Wansoft

Para abrir una orden activa: **doble click** en la tarjeta (single click solo selecciona). El doble click es protección contra ediciones accidentales.

Los ítems enviados son visualmente distintos de los ítems nuevos. Al presionar Guardar de nuevo, se genera una **comanda incremental** — solo los ítems nuevos se imprimen. Los enviados no se reimprimen.

No es posible modificar cantidad, silla, ni modificadores de un ítem ya enviado — solo cancelar y re-capturar.

### Cómo lo resolvemos en Fullsite

Las órdenes activas se reabren desde el plano. Los ítems nuevos se agregan y se envían incrementalmente.

La distinción visual entre ítems enviados (inmutables) e ítems nuevos (editables) dentro de la pantalla de captura puede no estar suficientemente diferenciada — el mesero puede intentar editar un ítem enviado y recibir un error confuso.

### Veredicto

**EQUIVALENTE** en funcionalidad. La distinción visual de estados es el gap principal.

### Principios aplicados

**P4** — Los ítems enviados son registros inmutables. Modificarlos requiere cancelación formal con razón documentada. No hay "edición sigilosa" de lo que ya fue a cocina.

### Cuando algo falla

**Mesero intenta agregar ítem a orden ya cobrada:** bloqueo explícito: "Esta orden ya fue cerrada. Para un nuevo consumo, abre una nueva orden en esta mesa."

---

## 8. Cancelaciones

### Qué hace

Eliminar un ítem ya enviado a cocina de la orden activa, documentando la razón y el impacto en inventario.

### Problema operativo que resuelve

Las cancelaciones son el **vector de fraude más común en restaurantes**. Sin control, un mesero puede pedir comida para él o sus conocidos, cobrar al cliente y cancelar antes del corte, o marcar como "no preparado" cuando sí se preparó para inflar el inventario.

El flujo de cancelación correcto resuelve tres problemas simultáneamente:
1. **Trazabilidad:** quién canceló, cuándo, y por qué
2. **Inventario:** si el ítem se preparó, los ingredientes se registran como merma (no regresan)
3. **Cocina:** recibe aviso impreso para no continuar preparando

### Frecuencia

Común. AMALAY tiene cancelaciones todos los días — errores de captura, cambios de opinión, platillos con tiempo excesivo.

### Cómo lo resuelve Wansoft

Flujo de 3 pasos:
1. Seleccionar ítem → presionar X
2. "Proporcione razón de cancelación" → campo de texto libre
3. "¿SE PREPARÓ LA ORDEN? (SALIERON LOS PRODUCTOS DE INVENTARIO?)" → Sí / No

Sin permisos de admin: se requiere autorización de gerente (huella o PIN).

La cancelación genera una impresión en la impresora de cocina con "CANCELADA" + nombre + razón + hora + mesero. La cocina sabe que debe parar la preparación.

### Cómo lo resolvemos en Fullsite

La pregunta "¿se preparó?" existe. La razón de cancelación actualmente es texto libre.

El catálogo de razones predefinidas no existe. El texto libre produce datos inanalizables: "error", "err", "test", "xxx" — el agente anti-fraude no puede trabajar con eso.

El aviso de cancelación a la impresora de cocina no está confirmado como implementado.

El event store registra toda cancelación de forma inmutable — esto es una ventaja sobre Wansoft para el análisis posterior.

### Veredicto

**INFERIOR** en el momento de captura (sin catálogo de razones, sin aviso confirmado a cocina). **MEJOR** en análisis posterior (event store + capacidad de dashboard de cancelaciones por mesero).

### Principios aplicados

**P4** — Toda cancelación tiene razón documentada. Sin razón, no hay cancelación. No existe un botón de "cancelar sin razón" aunque el gerente tenga todos los permisos.

**P5** — El dashboard de cancelaciones por mesero, visible para el gerente desde el primer día, genera presión de transparencia sin microgestión. El mesero que sabe que sus cancelaciones son visibles opera diferente.

**P8** — La notificación de cancelación a la impresora de cocina es tan crítica como la comanda original. Una cancelación que la cocina no recibe = comida preparada que nadie sirve.

### Cuando algo falla

**Gerente no disponible para autorizar:** el sistema puede enviar una notificación push al gerente para que autorice remotamente desde su celular. La operación no se bloquea indefinidamente esperando al gerente físico.

**Impresora de cocina sin conexión al enviar aviso:** el aviso queda en cola y se envía cuando la impresora regrese. Mientras tanto: "AVISO: La cocina no confirmó recepción. Notifica verbalmente que el ítem fue cancelado."

### Oportunidades de simplificación

**Catálogo de razones (cubre el 95% de los casos):**
- ERROR DE CAPTURA (mesero seleccionó el platillo equivocado)
- CLIENTE CAMBIÓ DE OPINIÓN
- DEMORA EXCESIVA
- PLATILLO INCORRECTO (cocina preparó algo diferente)
- CORTESÍA (se convierte en cortesía, no cancelación)
- OTRO (requiere texto libre)

El mesero toca una razón → confirma "¿se preparó?" → cancelación registrada en 3 toques. Sin teclado en pantalla, sin escribir.

---

## 9. Transferencias y cambios de mesa

### Qué hace

Mover ítems individuales de una mesa a otra (transferencia), o mover toda la orden a una mesa diferente (cambio de mesa), o fusionar dos cuentas en una.

### Problema operativo que resuelve

Los clientes se cambian de mesa o piden sentarse con otro grupo. Sin la capacidad de mover órdenes, el mesero tendría que cancelar todo y recapturar — con pérdida de trazabilidad y tiempo.

### Frecuencia

Situacional. No ocurre en la mayoría de los servicios, pero cuando ocurre es urgente.

### Cómo lo resuelve Wansoft

Dos operaciones desde "Avanzadas":
- **Transferir de mesa:** mueve un ítem individual. Proceso: seleccionar ítem → "Transferir de mesa" → ingresar número de mesa destino → Confirmar.
- **Cambiar # de mesa:** mueve toda la orden. El diálogo tiene dos campos — para merge de dos mesas.

Eduardo identificó las transferencias como el **vector de fraude más peligroso** del POS. Un mesero puede transferir ítems a una mesa que luego cancela completa, o transferir ítems ya cobrados a una mesa nueva para cobrar doble. Sin log inmutable de cada transferencia, es imposible detectarlo después.

AMALAY tiene configurado que las transferencias **requieren autorización de gerente** — indicador de que ya tuvieron problemas con esto.

### Cómo lo resolvemos en Fullsite

Transferencias implementadas. El event store registra cada operación de forma inmutable.

El dashboard de transferencias por mesero (análisis de fraude) no está construido. La data está — el análisis no.

### Veredicto

**EQUIVALENTE** en funcionalidad. **MEJOR** en trazabilidad (event store). **PENDIENTE** en dashboard de análisis de fraude.

### Principios aplicados

**P1** — La transferencia no se controla con bloqueos — se controla con registros. El evento inmutable es más poderoso que pedir PIN de gerente, porque el PIN se puede prestar pero el log no se puede borrar.

**P5** — "Este mesero hizo 15 transferencias en el turno de hoy vs 2 en promedio" es una señal que el gerente puede investigar. El dashboard de transferencias es la herramienta anti-fraude más efectiva.

### Cuando algo falla

**Transferencia a mesa sin orden activa:** "La mesa [X] no tiene una orden activa. ¿Deseas crear una orden nueva en esa mesa?"

**Fusión de mesas con ítems de diferentes meseros:** cada ítem mantiene su trazabilidad del mesero original después de la fusión.

### Oportunidades de simplificación

**Drag & drop en el plano:** arrastrar una mesa sobre otra para mover o fusionar es más intuitivo que Avanzadas → Cambiar mesa → ingresar número. Especialmente en touch.

**Vista previa del merge:** "Mesa 5 (3 ítems, $280) + Mesa 8 (2 ítems, $180) → Mesa unificada ($460). ¿Continuar?" El operador ve exactamente qué va a pasar.

---

## 10. Solicitud de cuenta

### Qué hace

El cliente pide la cuenta. El sistema puede mostrar el preticket, dividir la cuenta por sillas, y aplicar descuentos o cortesías antes de proceder al cobro.

### Problema operativo que resuelve

La solicitud de cuenta es uno de los momentos más críticos del servicio. El tiempo entre la solicitud y el cobro afecta directamente la percepción del servicio. Un proceso lento o con errores — cobrar lo que no se pidió, no poder dividir — genera fricción en el último momento.

La división de cuenta por silla es especialmente importante: grupos que quieren pagar por separado son la mayoría, no la excepción.

### Frecuencia

Universal. Ocurre en cada cierre de mesa.

### Cómo lo resuelve Wansoft

División de cuenta:
1. Avanzadas → Dividir cuenta
2. Se muestran todas las sillas como botones
3. El mesero selecciona qué silla(s) forman una nueva cuenta
4. Los ítems de esas sillas se separan en una orden independiente con su propio número
5. Cada cuenta se cobra individualmente

El split funciona **por silla** — la asignación de silla al momento de captura es el prerequisito. Sin silla asignada, no hay split posible. Por diseño, no por limitación.

Descuentos por ítem o prorrateados. Cortesías (100%) con razón obligatoria del catálogo. El catálogo de descuentos predefinidos (porcentajes y razones) limita las opciones del cajero.

### Cómo lo resolvemos en Fullsite

Split de cuenta por silla: implementado.

Descuentos: parcialmente implementados (sin catálogo predefinido completo).

Cortesías: parcialmente implementadas.

Vista previa del split antes de confirmar: no existe. El mesero ejecuta el split y luego ve el resultado — sin posibilidad de revisar antes.

### Veredicto

**EQUIVALENTE** en split por silla. **INFERIOR** en catálogos de descuento/cortesía. **PENDIENTE** en vista previa del split.

### Principios aplicados

**P3** — La solicitud de cuenta más común (una sola cuenta, sin descuento) debe ser 1 tap: "Cobrar". Los casos de división y descuento son excepciones con más pasos.

**P4** — Los descuentos son del catálogo, no de texto libre. El mesero no inventa el 12% — elige del catálogo que el gerente configuró.

### Cuando algo falla

**Ítems sin silla asignada en el momento del split:** el sistema identifica cuáles ítems no tienen silla y ofrece asignarlos antes de proceder. No "split imposible" como error final.

**El cliente quiere dividir en partes iguales (no por silla):** "Dividir $460 entre ¿cuántas personas? [___]" — calcula el monto por persona aunque no haya sillas asignadas.

### Oportunidades de simplificación

**Vista previa del split:** "Silla 1: CHILAQUILES + CAFÉ ($145) / Silla 2: ACAI BOWL ($110) / Silla 3: AVOCADO TOAST ($95). ¿Separar?" Un tap de confirmación. Sin sorpresas.

**Split rápido en partes iguales:** "Dividir en partes iguales" → "¿Cuántas partes? [2 / 3 / 4]" → calcula automáticamente.

---

## 11. Cobro

### Qué hace

Procesar el pago: seleccionar forma de pago, ingresar monto, calcular cambio, registrar propina, confirmar cierre de la orden.

### Problema operativo que resuelve

El cobro es el momento en que el restaurante recibe su ingreso. Un error — cobrar de más, no registrar el método de pago, no capturar la propina — tiene consecuencias financieras directas.

El **pago mixto** (parte efectivo + parte tarjeta) es la excepción más común, no el caso borde.

### Frecuencia

Universal. Ocurre en cada orden cerrada.

### Cómo lo resuelve Wansoft

Pantalla de cobro en tres columnas:
- **Izquierda:** lista scrolleable de métodos de pago (18 en AMALAY)
- **Centro:** Total, Cantidad recibida, Propina, Cambio auto-calculado, Saldo pendiente
- **Derecha:** tabla de pagos aplicados (forma de pago, monto, propina, total)

El botón "**Auto**" asigna todo el saldo pendiente al método seleccionado. Para pago mixto: seleccionar primer método, ingresar monto parcial → segundo método → "Auto" → confirmar.

Al confirmar:
1. Pregunta de número de personas (para KPI de ticket promedio)
2. Cajón de dinero abre automáticamente (DRAWER_KICK)
3. Ticket se imprime automáticamente

**El gap crítico de conciliación:** AMALAY usa Getnet (Santander) pero Getnet no está integrado en Wansoft ni en Fullsite. El cajero teclea el monto manualmente. Si cobra $356 pero teclea $360, hay un descuadre de $4 que nadie detecta automáticamente. En 100 transacciones diarias, el descuadre acumulado puede ser relevante.

### Cómo lo resolvemos en Fullsite

Pantalla de cobro con soporte de pago mixto. Múltiples métodos de pago. Diseñada para touch — botones más grandes y claros que Wansoft.

La integración con terminal bancaria para confirmación automática no existe — mismo problema que Wansoft con Getnet.

### Veredicto

**EQUIVALENTE** en flujo de cobro básico. **INFERIOR** en conciliación bancaria (igual que Wansoft — sin resolver aún). **MEJOR** en UX touch.

### Principios aplicados

**P3** — El cobro más común (efectivo o tarjeta, sin división) debe completarse en 3 taps: método → Auto → Confirmar.

**P7** — Cada cobro genera un evento de venta con: importe, método de pago, propina, personas, hora, mesa, mesero. Ese es el ingreso del análisis de negocio.

### Cuando algo falla

**Terminal bancaria rechaza el pago:** el cajero ve el mensaje de la terminal y puede intentar con otro método sin perder los ítems de la orden.

**Cajón de dinero no abre:** alerta explícita + instrucción manual. No silencio.

**Impresora sin papel:** la orden se cierra aunque el ticket no se imprima. "Reimprimir ticket" disponible después.

### Oportunidades de simplificación

**Integración con terminal bancaria:** Clip, NetPay, y BBVA tienen APIs. La terminal confirma el monto cobrado al POS automáticamente. Cero descuadres por typo. Esta es la oportunidad de mayor impacto financiero en toda la operación del cobro.

**Pantalla de propina customer-facing:** antes de procesar el pago con tarjeta, mostrar en segunda pantalla o pantalla girada: "¿Desea agregar propina? 10% ($38) / 15% ($57) / 20% ($76) / Sin propina". El cliente selecciona directamente.

---

## 12. Cierre de mesa

### Qué hace

Después del cobro, la orden se cierra, el ticket se imprime, la mesa queda libre en el plano, y el sistema queda listo para el siguiente cliente.

### Problema operativo que resuelve

El cierre de mesa limpia el estado del sistema. Una mesa "cerrada pero marcada como ocupada" en el plano confunde al salón. Un ticket no impreso deja al cliente sin evidencia.

### Frecuencia

Universal — ocurre en cada mesa cobrada.

### Cómo lo resuelve Wansoft

Al confirmar el pago, el ticket se imprime automáticamente y la tarjeta de la orden desaparece de la lista. La mesa queda disponible inmediatamente.

El ticket incluye: logo, folio secuencial, fecha/hora, mesa/personas/mesero, hora de apertura y cierre, ítems con precios, total, formas de pago, propina, cambio, footer "SERVICIOS NO INCLUIDOS", QR de Megapuntos, QR de facturación CFDI.

### Cómo lo resolvemos en Fullsite

El ticket con QR de autofacturación existe (parcialmente validado). La mesa se libera al cerrar la orden.

El folio secuencial en el ticket (no el UUID interno) es el gap. El cliente que pide el número de folio debe recibir un número legible (1847), no un UUID.

El QR de autofacturación es una **ventaja de Fullsite**: el portal de autofacturación es propio, no de Wansoft. El cliente va al portal de Fullsite, no al portal genérico de Wansoft.

### Veredicto

**EQUIVALENTE** en el flujo core. **MEJOR** en portal de autofacturación propio. **INFERIOR** en folio secuencial visible.

### Principios aplicados

**P7** — El ticket es para el cliente. El evento de cierre es para el sistema. Dos outputs del mismo momento.

---

## 13. Caja y retiros

### Qué hace

Gestionar el efectivo en la caja durante el turno: retiros (sacar efectivo para no acumular), depósitos (agregar efectivo), y mantener el saldo actualizado.

### Problema operativo que resuelve

El efectivo acumulado en la caja durante el turno es un riesgo: de robo, de error de conteo al cierre, y de tener que contar montos muy grandes al hacer el arqueo. Los retiros mantienen el efectivo manejable.

En AMALAY, los retiros son manuales. La persona que hace el retiro debería siempre documentar el monto y llevarse un comprobante.

### Frecuencia

Común. Un restaurante con alto volumen de efectivo puede hacer 3-5 retiros por turno.

### Cómo lo resuelve Wansoft

Retiros y depósitos manuales desde el menú de caja. La opción de retiro automático (cuando el efectivo excede un umbral) existe pero no está activada en AMALAY.

Toda operación de caja requiere autorización de gerente y queda registrada con monto, hora, y usuario.

### Cómo lo resolvemos en Fullsite

Retiros de caja: implementados (parcialmente).

Los retiros programados (auto-forzar cuando el efectivo supera un umbral) no están implementados.

Notificación al gerente cuando se hace un retiro: pendiente.

### Veredicto

**EQUIVALENTE** en retiro manual. **INFERIOR** en retiro automático y notificaciones.

### Principios aplicados

**P1** — Cada retiro es un evento inmutable: quién, cuánto, cuándo. El saldo de efectivo en caja puede reconstruirse en cualquier momento desde el fondo inicial más ventas en efectivo menos retiros.

---

## 14. Corte del turno

### Qué hace

Cerrar el período operativo con conciliación completa: ventas por método de pago, descuentos, cancelaciones, propinas, arqueo de efectivo, y reporte del turno.

### Problema operativo que resuelve

El corte es el **momento de verdad** del restaurante. Responde a: "¿El dinero que debería estar aquí está aquí?" Si el arqueo cuadra, el turno fue operativamente correcto. Si hay diferencia, el audit trail permite encontrar dónde.

### Frecuencia

Universal. Al menos una vez al día. En restaurantes con múltiples turnos, 2-3 veces.

### Cómo lo resuelve Wansoft

Cinco tipos de corte:

1. **Corte Z (diario):** cierre definitivo. Requiere cero órdenes abiertas. El número de Corte Z es **secuencial e irrepetible** — el SAT lo usa para auditar. Un restaurante no puede saltarse un número de Corte Z.

2. **Corte X (parcial):** consulta del estado actual sin cerrar el turno. El gerente ve las ventas de la mañana a las 2pm sin afectar el turno del cajero. No genera número oficial.

3. **Corte Turno:** cierra el turno de un cajero específico. En restaurantes con múltiples turnos, cada cajero hace el suyo y el Corte Z consolida al final.

4. **Corte Mesero:** resumen de ventas por mesero. Base para el tip-out y para evaluar rendimiento individual. AMALAY: tip-out de 5% de ventas por mesero.

5. **Corte Global:** resumen consolidado de todos los cajeros y turnos del día.

El arqueo de caja permite máximo 3 intentos — después, acepta la diferencia declarada aunque no cuadre.

### Cómo lo resolvemos en Fullsite

Corte de turno: implementado. Arqueo básico existe.

El Corte Z con número secuencial no está confirmado. Si Fullsite no lleva la secuencia consecutiva del Corte Z, hay un riesgo de auditoría fiscal.

Corte X (parcial, sin cerrar turno): no existe.

Corte por Mesero: no existe.

Ventaja de Fullsite: el corte puede enviarse automáticamente por Telegram al gerente y al dueño en el momento en que se genera. Y el comparativo histórico (hoy vs semana pasada) puede estar en el mismo reporte.

### Veredicto

**INFERIOR** en tipos de corte (faltan X y por Mesero). **EQUIVALENTE** en Corte Z. **MEJOR** en distribución automática y análisis histórico.

### Principios aplicados

**P4** — El Corte Z nunca puede hacerse con órdenes abiertas. Es un invariante, no una opción de configuración. No importa qué permisos tenga el gerente.

**P9** — El corte en la nube significa que el reporte de ventas del día está disponible inmediatamente para el dueño en su teléfono, aunque la terminal del restaurante esté apagada.

### Cuando algo falla

**Hay una orden abierta que no se puede cerrar (cliente se fue sin pagar):** el sistema muestra exactamente cuáles órdenes están abiertas. El gerente decide: cerrar como pérdida (cancelar con razón "CLIENTE NO PAGÓ"), o dejar en suspenso.

**La diferencia de arqueo es mayor al umbral normal ($50):** alerta al dueño con detalles. El corte no se bloquea — se registra la diferencia y se genera una alerta para investigar.

### Oportunidades de simplificación

El límite de 3 intentos en el arqueo de Wansoft es arbitrario. Fullsite debe permitir intentos ilimitados, registrando cada intento en el event store con monto declarado y diferencia. Si el cajero lleva 5 intentos con diferencias muy diferentes entre sí, eso es una señal de alerta — pero no se resuelve limitando los intentos.

---

## 15. Recuperación ante fallos

### Por qué es una sección independiente

La recuperación ante fallos no es un flujo operativo — es una filosofía de diseño. Un POS que funciona bien el 99% del tiempo y se queda sin respuesta el 1% restante es inaceptable en un restaurante. Los 5 escenarios de fallo más críticos:

---

### Fallo 1 — Pérdida de conexión a internet

**Wansoft:** funciona porque es local. Los datos están en el SQL Server de la terminal.

**Fullsite:** modo offline certificado (F-01). La orden se captura localmente y sincroniza cuando regresa la conexión. El cajero no sabe si está online u offline — la experiencia es idéntica.

**Gap a monitorear:** la sincronización de inventario en offline. Si un platillo se agota mientras se está offline, el sistema local no lo sabe. Trade-off aceptable: preferimos vender y gestionar la excepción después a bloquear la venta por incertidumbre de stock.

**Principio:** P6 — Offline no es emergencia, es modo de operación.

---

### Fallo 2 — Impresora desconectada

**Wansoft:** puede ser error silencioso. La orden queda "enviada" en el sistema pero la cocina no recibió nada.

**Fullsite:** el bridge de impresión debe confirmar recepción de cada comanda. Si la impresora no responde, alerta inmediata en el POS: "COCINA CALIENTE sin conexión". El mesero puede: reimprimir cuando se restaure, notificar verbalmente a cocina, o rutear temporalmente a otra impresora.

**Principio:** P8 — Las impresoras son infraestructura crítica.

---

### Fallo 3 — Crash de la terminal

**Wansoft:** si la terminal crashea durante la captura (antes de Guardar), los datos se pierden.

**Fullsite:** el estado de la orden puede persistirse en Supabase incrementalmente durante la captura, no solo al enviar. Si la terminal crashea y el mesero abre otra terminal, puede retomar la captura en progreso.

Esto requiere: guardar el borrador de la orden localmente y en Supabase durante la captura — no solo al presionar "Enviar". **Pendiente de implementar.**

---

### Fallo 4 — Lector de huella no funciona

**El caso de AMALAY:** el lector HID a veces no lee bien con manos húmedas (lavaplatos) o frías (mañanas).

**Fullsite:** fallback a PIN implementado. El PIN como fallback no puede ser un error oscuro — debe ser el botón más visible después de un fallo de huella. No pantalla de error, sino CTA claro: "Iniciar sesión con PIN".

---

### Fallo 5 — Cajón de dinero no abre

**Fullsite:** alerta explícita: "CAJÓN SIN RESPUESTA. Presiona el botón de apertura manual o llama al gerente." No silencio. El cajero sabe exactamente qué hacer.

---

## 16. Operaciones de excepción

Los flujos que no son parte del servicio normal pero que ocurren con suficiente frecuencia para requerir soporte explícito.

---

### Excepción 1 — Reimpresión de ticket

**Cuándo:** el cliente pide segunda copia, la primera salió mal, o el cliente necesita el ticket para su empresa.

**Fullsite:** reimprimir desde la orden cerrada debe estar disponible sin restricción de tiempo. Un cliente puede pedir el ticket del lunes el miércoles.

---

### Excepción 2 — Corrección de mesa post-cobro

**Cuándo:** el cajero cobró correctamente pero registró la orden en la mesa incorrecta.

**Fullsite:** corrección administrativa desde el dashboard. El gerente puede actualizar el número de mesa de una orden cerrada con registro en el event store. No afecta el monto cobrado — solo corrige el dato de mesa para los reportes.

---

### Excepción 3 — Orden sin pago (cliente se fue sin pagar)

**Cuándo:** el cliente abandona la mesa sin pagar.

**Fullsite:** debe existir una razón de cancelación específica: "CLIENTE SE FUE SIN PAGAR". Esto alimenta el agente anti-fraude con datos precisos y diferencia entre errores operativos y pérdidas por evasión.

---

### Excepción 4 — Error de cobro (cobró de más o de menos)

**Cuándo:** el cajero confirmó el cobro con un monto incorrecto.

**Fullsite:** el gerente puede emitir un ajuste desde el dashboard, vinculado a la orden original, con razón documentada. El monto ajustado queda en el event store.

---

### Excepción 5 — Cambio de turno con órdenes activas

**Cuándo:** el turno del Cajero A termina pero hay mesas abiertas que el Cajero B va a terminar.

**Fullsite:** las órdenes abiertas al cierre del turno quedan claramente asignadas al turno siguiente, con registro de la transferencia de responsabilidad. Cada orden sabe en qué turno fue cobrada, aunque fue creada en el anterior.

---

## Apéndice A: Veredictos consolidados

| Flujo | Veredicto | Gap principal |
|---|---|---|
| 1. Inicio del turno | EQUIVALENTE | — |
| 2. El salón listo | MEJOR | Plano visual funcional (Wansoft lo tiene desactivado en AMALAY) |
| 3. Crear orden | MEJOR | 3-4 pasos vs 7. Gap: sin número secuencial legible |
| 4. Captura | EQUIVALENTE | Faltan: barcode en captura, separador XX TIEMPO |
| 5. Modificadores | EQUIVALENTE | Sin edición post-captura pre-envío |
| 6. Envío a cocina | EQUIVALENTE | Falta confirmación de impresión exitosa |
| 7. Cambios durante preparación | EQUIVALENTE | Falta distinción visual enviado vs nuevo |
| 8. Cancelaciones | INFERIOR | Sin catálogo de razones. Sin aviso confirmado a cocina |
| 9. Transferencias | EQUIVALENTE | Event store es ventaja. Dashboard de fraude pendiente |
| 10. Solicitud de cuenta | EQUIVALENTE | Falta vista previa del split |
| 11. Cobro | EQUIVALENTE | Sin integración bancaria (igual que Wansoft) |
| 12. Cierre de mesa | EQUIVALENTE | Falta folio secuencial en ticket |
| 13. Caja y retiros | EQUIVALENTE | Falta retiro automático por umbral |
| 14. Corte del turno | INFERIOR | Faltan Corte X y Corte Mesero |
| 15. Recuperación ante fallos | MEJOR | Cloud-native elimina crash de SQL local |
| 16. Operaciones de excepción | PENDIENTE | Requieren diseño y validación |

**Resumen:**
- **MEJOR:** 3 flujos (salón, crear orden, recuperación)
- **EQUIVALENTE:** 9 flujos
- **INFERIOR:** 2 flujos (cancelaciones, corte) — con correcciones concretas de baja complejidad
- **PENDIENTE:** 1 flujo (excepciones)

Los 2 flujos INFERIOR tienen correcciones específicas que los llevarían a EQUIVALENTE o MEJOR con esfuerzo bajo-medio.

---

## Apéndice B: Menú Avanzadas completo

13 operaciones disponibles dentro de una orden activa en Wansoft:

| # | Operación | Cuándo usar | Requiere gerente |
|---|---|---|---|
| 1 | Borrar partida | Ítem no enviado (pre-comanda) | No |
| 2 | Aplicar descuento | Descuento por ítem individual | Depende del catálogo |
| 3 | Aplicar cortesía | 100% a ítem individual | Sí (siempre) |
| 4 | Aplicar 2x1 | Promoción dos por uno | Depende |
| 5 | Transferir de mesa | Mover ítem a otra mesa | Sí (AMALAY) |
| 6 | Cambiar # de silla | Reasignar silla de un ítem | No |
| 7 | Cambiar estatus cancelada-anulada | Tipo de cancelación | Sí |
| 8 | Ver detalle | Info del ítem seleccionado | No |
| 9 | Descuento prorrateado | Descuento distribuido en toda la orden | Depende |
| 10 | Cambiar # de mesa | Mover toda la orden | Sí (recomendado) |
| 11 | Cambiar # de personas | Actualizar cantidad de comensales | No |
| 12 | Dividir cuenta | Split por silla | No |
| 13 | Promociones | Aplicar promoción del catálogo | Depende |

**Nota de diseño:** el menú Avanzadas de Wansoft es una colección de operaciones de excepción agrupadas en un lugar. Es funcionalmente correcto pero UX deficiente: nadie sabe que existe sin haberlo visto antes. En Fullsite, estas operaciones deben estar disponibles contextualmente: "Dividir cuenta" aparece cuando hay sillas asignadas, "Transferir de mesa" aparece cuando el gerente autoriza. La visibilidad condicional reduce la carga cognitiva.

---

## Apéndice C: Config operativa de AMALAY

| Parámetro | Valor | Implicación para Fullsite |
|---|---|---|
| Tipo de operación | Modo completo | Full feature set activo |
| Tipos de orden activos | Restaurante + Para llevar | Delivery va por plataforma |
| Tiempos (XX TIEMPO) | Activado | Separador en comanda — pendiente en Fullsite |
| Sillas | Activadas | Split de cuenta habilitado |
| Para llevar pide | Nombre + número de torre | Torre = identificador en mostrador |
| Alerta órdenes desatendidas | 30 min | Para llevar/delivery sin atender > 30 min |
| Fondo de caja | $1,700 MXN | Referencia para arqueo de apertura |
| Tip-out | 5% de ventas del mesero | Se descuenta del Corte Mesero |
| Número de Corte Z | Secuencial e irrepetible | Requisito fiscal, no opción |
| Transferencias | Requieren autorización gerente | Eduardo ya tuvo problemas de fraude |
| Cancelaciones | Requieren razón escrita | Vector de fraude #1 |
| Impresoras activas | EC TICKET (USB) + COCINA CALIENTE (TCP) + BARRA (TCP) | 3 destinos de impresión |
| Market items | [NO IMPRIMIR] configurado | No generan comanda de cocina |
| Bascula | COM1, 9600 baud | Productos por peso en Market |

---

## Apéndice D: Principios en práctica

| Principio | Flujos donde más importa |
|---|---|
| P1 — Event store como custodio | Cancelaciones, Transferencias, Corte |
| P2 — Sistema piensa, no operador | Crear orden, Captura, Login |
| P3 — 1 tap para lo normal | Cobro, Crear orden, Solicitud de cuenta |
| P4 — Seguridad por diseño | Cancelaciones, Descuentos, Corte Z |
| P5 — Confianza con evidencia | Cancelaciones, Transferencias |
| P6 — Offline como modo normal | Envío a cocina, Recuperación ante fallos |
| P7 — Datos desde el primer evento | Cierre de mesa, Corte del turno |
| P8 — Impresoras como infraestructura | Envío a cocina, Cancelaciones, Corte |
| P9 — Arquitectura nube elimina problemas | Salón listo, Cambios de turno, Reportes |
| P10 — Parity primero | Todos los flujos INFERIOR o PENDIENTE |

---

> Biblia operacional y de producto del POS de Fullsite.
> Versión inicial: 2026-07-25.
> Fuente: WANSOFT-POS-BIBLE.md + evidencia AMALAY + feedback Eduardo.
> Complemento técnico: FULLSITE-POS-BIBLE.md (auditoría de código, state machines, invariantes).
> KDS: documento independiente pendiente.
> Próxima actualización: después de validación de campo en AMALAY.
