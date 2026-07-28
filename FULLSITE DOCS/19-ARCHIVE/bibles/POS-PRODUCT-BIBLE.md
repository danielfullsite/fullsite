# POS Product Bible

> Extracción sistemática de conocimiento operativo del POS de Fullsite.
> Fuente primaria: `docs/product/WANSOFT-POS-BIBLE.md` (sesión TeamViewer AMALAY, 2026-07-21).
> Fuente secundaria: `docs/reference/wansoft/CAJA-SPEC.md`, `BACKOFFICE-KNOWLEDGE.md`, reuniones con Eduardo Esquivel.
>
> Este documento NO es un inventario de pantallas.
> Es una destilación de qué problemas reales resuelve el POS, cómo los resuelve Wansoft,
> cómo los resuelve Fullsite hoy, y qué principios de producto justifican cada decisión.
>
> Compañero de este documento: `FULLSITE-POS-BIBLE.md` — auditoría técnica de código (qué existe, dónde).
> Este documento responde el "por qué" y el "qué tan bien." El otro responde el "dónde."
>
> Fecha: 2026-07-25

---

## Convenciones

**Frecuencia:** Universal (ocurre en cada turno), Común (varias veces por semana), Situacional (varias veces por mes), Raro (una o dos veces por año).

**Veredicto:**
- **Fullsite Mejor** — nuestra solución resuelve el problema de forma superior
- **Equivalente** — soluciones comparables en efectividad
- **Gap** — Wansoft lo resuelve y Fullsite no, o lo resuelve peor
- **Gap crítico** — ausencia con consecuencias de fraude, operación, o cumplimiento
- **Ninguno debe tenerlo** — el problema no debería resolverse con configuración o UI

**Principio de producto:** una regla destilada que guía la decisión de diseño. Se consolidan en la sección de síntesis al final.

---

## 01 SESIÓN E IDENTIDAD

> El POS no sabe quién lo está operando a menos que el sistema lo obligue a saberlo. Sin identidad continua, no hay trazabilidad, no hay responsabilidad, y no hay auditoría.

---

#### 01.1 Login del operador

**Frecuencia:** Universal

**Qué hace:** Identifica quién inicia una sesión de trabajo en el POS. En AMALAY: huella digital (DigitalPersona HID) como método principal, PIN como fallback.

**Problema operativo:** Sin login, todas las operaciones son anónimas. No hay forma de saber quién hizo una cancelación, aplicó un descuento, o cobró una mesa. El fraude no solo es posible — es invisible.

**Wansoft:** Huella digital instantánea. Un toque y el sistema identifica al operador. El nombre del usuario activo aparece en el header de forma permanente. El sistema tiene cuentas "utilitarias" (PRUEBAS 1, APLICACIONES) con acceso total para testing — un riesgo de seguridad en producción.

**Fullsite hoy:** Huella HID implementada. PIN como alternativa. Usuario activo visible en el header.

**Veredicto:** Equivalente — con un gap específico: las cuentas de prueba con "acceso total" son riesgo en producción. Fullsite no debería tenerlas activas en instancias de clientes.

**Principio:** _La identidad es siempre visible y nunca opcional. Toda acción en el POS tiene un autor._

---

#### 01.2 Pantalla de bloqueo y re-autenticación

**Frecuencia:** Universal

**Qué hace:** Bloquea el POS después de una operación o por inactividad, forzando re-autenticación antes de continuar. Eduardo pidió explícitamente que el POS se bloquee post-envío de comanda — para que el siguiente mesero tenga que identificarse.

**Problema operativo:** Un POS que queda desbloqueado en la caja es una vulnerabilidad. Cualquier persona que pase puede abrir una orden, agregar items, o aplicar un descuento — sin registro de quién lo hizo.

**Wansoft:** Pantalla de bloqueo por tiempo de inactividad configurable. Re-autenticación por huella. No estaba activo en AMALAY al momento de la sesión.

**Fullsite hoy:** Gap — no hay pantalla de bloqueo automática post-operación.

**Veredicto:** Gap — Eduardo lo pidió explícitamente el 21 de julio.

**Principio:** _Entre cada operación, el sistema asume que el operador puede haber cambiado. La re-autenticación no es fricción — es protección al operador anterior._

---

#### 01.3 Escalation in-place

**Frecuencia:** Común

**Qué hace:** Cuando el cajero intenta una operación que requiere permiso de gerente, el sistema captura el PIN del gerente sobre la pantalla actual — sin cerrar la sesión del cajero. La operación se ejecuta y el cajero retoma donde estaba.

**Problema operativo:** Sin escalation in-place, el cajero tiene que cerrar sesión, el gerente inicia sesión, ejecuta la operación, y el cajero vuelve a autenticarse. En hora pico con 10-15 cancelaciones o descuentos por turno, ese flujo son 20-30 minutos de fricción que los clientes sienten.

**Wansoft:** Dialogo "¿Desea apoyo de otra persona con permiso?" — el gerente captura su huella o PIN sin que el cajero abandone la pantalla. La cuenta del cliente sigue visible.

**Fullsite hoy:** Manager PIN implementado. Gap: falta registrar explícitamente **quién** autorizó qué operación. El audit log tiene el evento, pero no el actor del manager.

**Veredicto:** Gap crítico — completa el fraud stack. Sin el "quién autorizó," el audit trail está incompleto.

**Principio:** _La autorización no interrumpe la operación. Pero siempre deja rastro de quién tomó la decisión._

---

#### 01.4 Sesión compartida vs sesión personal

**Frecuencia:** Universal

**Qué hace:** Define si la terminal tiene un "usuario de terminal" (el cajero del turno) o si cada operación requiere autenticación del actor específico (el mesero que tomó esa orden).

**Problema operativo:** En AMALAY, la terminal de caja es principalmente del cajero (Eduardo). Los meseros no hacen login individual — sus órdenes van a su nombre porque se seleccionan durante "Nueva Orden." Si el sistema siempre muestra al cajero como usuario activo, las operaciones del mesero quedan mal atribuidas.

**Wansoft:** Usuario activo = el que hizo login más recientemente. El mesero se selecciona en el flujo de orden, no en el login de terminal.

**Fullsite hoy:** El usuario activo es el login de sesión. Meseros se seleccionan en creación de orden.

**Veredicto:** Equivalente — la separación "cajero activo + mesero por orden" es la convención correcta para el modelo de AMALAY.

**Principio:** _Identidad de sesión (quién opera la terminal) y atribución de orden (a qué mesero pertenece la cuenta) son dos preguntas distintas. No confundirlas._

---

## 02 APERTURA DE ORDEN

> El primer momento de una venta es donde se fija el contexto de todo lo que sigue. Mesa incorrecta, mesero incorrecto, o tipo de orden incorrecto contamina toda la trazabilidad subsecuente.

---

#### 02.1 Tipo de orden

**Frecuencia:** Universal

**Qué hace:** Define el modo de la orden: Restaurante (cliente en mesa), Para Llevar, Delivery. El tipo determina el flujo de cobro, la comanda de cocina, y los datos que se capturan.

**Problema operativo:** Una orden "Para Llevar" registrada como "Restaurante" aparece en las estadísticas de mesas atendidas. Las métricas de ticket promedio, personas por mesa, y duración de estancia se contaminan — el dueño toma decisiones sobre datos incorrectos.

**Wansoft:** Selección al crear la orden: "Restaurante" o "Para Llevar." Para llevar pide nombre de cliente y número de torre en lugar de mesa y personas. Alerta a los 30 minutos si una orden para llevar no se ha atendido.

**Fullsite hoy:** Los tres tipos implementados. La alerta de 30 minutos: pendiente de verificar.

**Veredicto:** Equivalente.

**Principio:** _El tipo de orden es el contexto que no cambia después de abrirse. Establecerlo correctamente en el primer paso es más fácil que corregirlo después._

---

#### 02.2 Asignación de mesero y mesa

**Frecuencia:** Universal

**Qué hace:** En Wansoft, el mesero se selecciona de una lista y la mesa se captura como número manual. En Fullsite, la mesa se selecciona del plano visual.

**Problema operativo:** Si el mesero se selecciona de una lista de texto y la mesa se escribe a mano, los errores de captura son frecuentes bajo presión. "Mesa 4" escrita en lugar de "Mesa 14" desconecta el corte de mesero y el análisis de propinas.

**Wansoft:** Lista de meseros activos → campo numérico para mesa. La mesa acepta cualquier número, incluso uno que no existe en el plano.

**Fullsite hoy:** Selección visual de mesa en el plano. El mesero se selecciona en pantalla secundaria.

**Veredicto:** Fullsite Mejor — la selección visual elimina errores de captura. El mesero activo se puede inferir de la zona de mesas asignada en el plano.

**Principio:** _Un campo de texto libre invita el error. Una selección visual lo previene. El mesero y la mesa son demasiado importantes para fiarlos a captura manual._

---

#### 02.3 Número de personas

**Frecuencia:** Universal

**Qué hace:** Captura cuántas personas hay en la mesa. Se usa para el ticket promedio por persona y para habilitar el split por silla.

**Problema operativo:** El número de personas frecuentemente se deja en "1" por defecto o se captura incorrectamente. Esto corrompe el ticket promedio por persona — una de las métricas más importantes para evaluar la calidad del servicio y la efectividad del mesero.

**Wansoft:** Campo numérico obligatorio al crear. También se confirma al cerrar la cuenta. AMALAY captura en ambos momentos — si el grupo cambió durante la comida, la cifra al cierre prevalece.

**Fullsite hoy:** Se captura al crear la orden. La confirmación al cierre: pendiente de verificar.

**Veredicto:** Gap — la confirmación al cierre es más precisa. Wansoft pregunta dos veces; Fullsite probablemente pregunta una.

**Principio:** _Las métricas de negocio más importantes dependen de datos que el cajero captura en 2 segundos. El número de personas es uno de ellos._

---

#### 02.4 Plano visual vs lista de órdenes

**Frecuencia:** Universal

**Qué hace:** La vista principal del POS muestra el estado de todas las órdenes activas. En Wansoft/AMALAY: lista de órdenes como cards (el plano nunca se configuró). En Fullsite: plano visual con zonas.

**Problema operativo:** La lista de órdenes obliga a que el gerente y el mesero memoricen números de orden. El plano visual comunica el estado de toda la sala de un vistazo: cuántas mesas están ocupadas, cuáles llevan más de X minutos, cuáles esperan cobro.

**Wansoft:** Card view con tarjetas rojas (orden activa). Cada card: número de mesa, hora apertura, total acumulado, número de orden. El plano existe pero AMALAY nunca lo configuró.

**Fullsite hoy:** Plano visual con zonas nombradas y colores por estado. Lista de órdenes disponible como vista alternativa.

**Veredicto:** Fullsite Mejor — el plano visual es más rico. Que AMALAY no lo configuró en Wansoft es un argumento a favor de hacer el plano más fácil de configurar, no de usar cards.

**Principio:** _El gerente no debería necesitar recorrer el salón para saber el estado de la sala. El plano es su vista aérea._

---

## 03 CAPTURA DE PLATILLOS

> La captura de un platillo en el POS no es solo seleccionar un ítem — es comunicar a la cocina exactamente qué preparar, para quién, con qué especificaciones. Cualquier ambigüedad en este momento se convierte en error en la cocina.

---

#### 03.1 Navegación por grupos y categorías

**Frecuencia:** Universal

**Qué hace:** El menú está organizado en grupos con subcategorías. AMALAY tiene 8 grupos principales (ALIMENTOS, BEBIDAS, MARKET, ALCOHOL, POSTRES, APPETIZERS, VENTAS TERCEROS, EVENTO/MENU) y 18 subcategorías de ALIMENTOS.

**Problema operativo:** Con 200+ platillos, el mesero no puede encontrar nada por scroll. La navegación por grupos permite llegar en 2 taps a cualquier platillo. Si los grupos están mal nombrados o tienen demasiados niveles, la captura es lenta y el cliente espera.

**Wansoft:** Botones de grupos con codificación por color. Tamaño de botón configurable con sliders y preview en vivo. La configuración visual es extremadamente granular (ancho 90px, alto 50px, fuente 11 — todo ajustable).

**Fullsite hoy:** Grupos y categorías implementados. Configuración desde el dashboard admin.

**Veredicto:** Equivalente.

**Principio:** _La velocidad de captura es una métrica de calidad del POS. Si un mesero tarda más de 10 segundos en encontrar un platillo, algo está mal en la organización del menú._

---

#### 03.2 Modificadores escalonados

**Frecuencia:** Universal

**Qué hace:** Opciones de personalización por nivel (step by step). Cada nivel puede ser obligatorio u opcional con mínimo/máximo de selecciones. El nombre del platillo se actualiza en tiempo real con las selecciones: "CHILAQUILES. VERDES. AGUACATE."

**Problema operativo:** Sin modificadores estructurados, el mesero escribe notas de texto libre. El chef lee 15 notas con 15 estilos distintos y los errores son inevitables. Con modificadores escalonados, la cocina recibe strings concatenados y consistentes en el mismo formato siempre.

**Wansoft:** Modal por nivel. Botón azul de check para saltar niveles opcionales. Máximo de selecciones validado por nivel. El nombre del platillo se actualiza en tiempo real durante la selección.

**Fullsite hoy:** Modifier steps implementados. Verificar si el nombre del platillo se actualiza en tiempo real conforme se seleccionan modificadores.

**Veredicto:** Equivalente — con gap de UX: si el nombre no se actualiza en tiempo real, el mesero no puede confirmar visualmente la selección antes de agregar el item.

**Principio:** _Los modificadores no son una nota de texto con mejor UI. Son la forma en que el POS habla el mismo idioma que la cocina._

---

#### 03.3 Asignación de silla por platillo

**Frecuencia:** Universal (con sillas activas) | AMALAY tiene sillas activas

**Qué hace:** Cada platillo capturado puede asignarse a una silla específica de la mesa. La asignación habilita el split por silla al cobrar.

**Problema operativo:** Sin asignación de silla, el split de cuenta es imposible o debe hacerse manualmente. En una mesa de 6 personas donde cada quien paga lo suyo, la falta de sillas convierte el cobro en caos y en fuente de error.

**Wansoft:** Controles +/- de SILLA integrados en la pantalla de captura, al lado de los controles de CANT (cantidad). La silla del item aparece en la comanda y en el ticket.

**Fullsite hoy:** Sillas implementadas.

**Veredicto:** Equivalente — con la nota de que la asignación de silla debe ser parte del flujo natural de captura, no un paso separado que se omite bajo presión.

**Principio:** _La asignación de silla durante la captura habilita operaciones complejas al cobrar. No hay forma de recuperar esa información después._

---

#### 03.4 Escaneo de código de barras (market items)

**Frecuencia:** Común (en restaurantes con market/retail) | AMALAY tiene market activo

**Qué hace:** Permite agregar productos del área de market escaneando el código de barras. El cajero no tiene que buscar el producto en el menú — escanea el físico y el sistema lo identifica y agrega a la cuenta.

**Problema operativo:** Un restaurante con 50+ productos de market (refrescos, snacks, productos empaquetados) no puede tener botón de menú para cada uno. El cajero necesita escanear el barcode durante la captura de la orden, sin cambiar de pantalla.

**Wansoft:** Campo de "Código" siempre visible en la parte superior de la pantalla de captura. El cajero puede escanear en cualquier momento durante la orden. AMALAY tiene báscula integrada (COM1, 9600 baud) para productos por peso.

**Fullsite hoy:** Inventario market con dual-track (receta vs 1:1) implementado. El campo de barcode durante captura de orden: pendiente de verificar si está disponible sin salir del flujo de orden.

**Veredicto:** Gap — el escaneo de barcode durante la captura es un flujo activo en AMALAY que necesita funcionar sin cambiar de pantalla.

**Principio:** _Los productos de market no son platillos. Son artículos de retail con su propio ciclo de inventario. El POS debe tratar a ambos con igual fluidez._

---

#### 03.5 Course management (tiempos)

**Frecuencia:** Universal (con tiempos activos) | AMALAY tiene tiempos activos

**Qué hace:** El marcador XX TIEMPO se inserta automáticamente como separador de tiempos. Los platillos del primer tiempo se envían a cocina al hacer Guardar. El botón de firebutton dispara el segundo tiempo. La cocina recibe una comanda separada por cada tiempo.

**Problema operativo:** Sin course management, todos los platillos llegan a cocina al mismo tiempo. La entrada, el plato fuerte, y el postre se "preparan" simultáneamente. El chef termina todos los platillos del primer tiempo y los tiene listos mientras el cliente todavía está en la entrada.

**Wansoft:** El separador XX TIEMPO se agrega automáticamente. El mesero agrupa platillos por tiempo durante la captura. El texto del firebutton es configurable — en AMALAY es "PREPARAR Y SAC..." (probablemente "PREPARAR Y SACAR").

**Fullsite hoy:** Tiempos implementados con firebutton. Texto configurable.

**Veredicto:** Equivalente.

**Principio:** _El course management no es una feature de fine dining. Es el mecanismo que evita que la cocina entregue todo junto cuando el cliente todavía está en la entrada._

---

## 04 DESPACHO A COCINA

> El momento en que el mesero presiona "Enviar" es el momento en que la orden deja de ser una intención y se convierte en un compromiso. A partir de aquí, la cocina empieza a preparar y el inventario empieza a consumirse.

---

#### 04.1 El botón de despacho

**Frecuencia:** Universal

**Qué hace:** En Wansoft, "Guardar" = despacho inmediato. En Fullsite, "Enviar a cocina" = despacho. No hay estado intermedio de "guardado sin enviar."

**Problema operativo:** Un POS con "Guardar en borrador" y "Enviar a cocina" como acciones separadas crea confusión: el cajero puede creer que envió cuando solo guardó. En operación real, "guardado" sin envío no tiene valor — la cocina no sabe qué preparar.

**Wansoft:** Guardar = despacho inmediato. Dialogo de confirmación ("NO OLVIDES ANOTAR TODAS LAS ESPECIFICACIONES") como único checkpoint. Post-envío, regresa a la lista de órdenes (Eduardo quiere que regrese al plano de mesas).

**Fullsite hoy:** "Enviar a cocina" como la acción de despacho. Post-envío: verificar si regresa al plano (feedback Eduardo) o a la lista.

**Veredicto:** Fullsite Mejor — "Enviar a cocina" es más claro que "Guardar" para describir lo que realmente ocurre.

**Principio:** _El nombre del botón describe exactamente lo que hace. "Guardar" sugiere reversibilidad. "Enviar a cocina" no._

---

#### 04.2 Routing por estación

**Frecuencia:** Universal

**Qué hace:** Al despachar, el sistema determina qué impresora (o estación KDS) recibe la comanda de cada platillo. En AMALAY: alimentos → COCINA CALIENTE, cafés → BARRA, market → TICKET, algunos items → [NO IMPRIMIR].

**Problema operativo:** Sin routing, toda la comanda va a una sola impresora. La cocina recibe comandas de café, la barra recibe comandas de alimentos. El chef pierde tiempo separando lo que le corresponde y lo demás se pierde.

**Wansoft:** Routing por platillo individual, hasta 5 impresoras por item. La granularidad es total: cada platillo puede ir a múltiples estaciones simultáneamente. [NO IMPRIMIR] disponible como opción.

**Fullsite hoy:** Routing por grupo como default + override por platillo. KDS visual para estaciones digitales; impresoras para estaciones físicas.

**Veredicto:** Fullsite Mejor — routing por grupo como default con override por platillo es mejor arquitectura: menos configuración, misma granularidad cuando se necesita.

**Principio:** _La comanda correcta llega a la estación correcta automáticamente. El mesero no debe saber qué prepara cada estación._

---

#### 04.3 La pregunta "¿Se preparó?" al cancelar

**Frecuencia:** Común

**Qué hace:** Cuando se cancela un item ya enviado a cocina, el sistema pregunta si el producto ya se empezó a preparar. SI = merma (el inventario no regresa). NO = devolución (el inventario regresa).

**Problema operativo:** La cancelación tiene consecuencias distintas dependiendo del momento. Si el chef ya tomó los ingredientes, cancelar la comanda no los devuelve al inventario físico — son merma. Si la comanda llegó pero el chef aún no empezó, los ingredientes siguen disponibles.

**Wansoft:** La pregunta se hace al cajero que cancela. Es una decisión manual que requiere que el cajero sepa (o pregunte) si el platillo ya se empezó.

**Fullsite hoy:** El flujo de cancelación con la pregunta de inventario implementado. La deducción ocurre al enviar (no al cobrar como en Wansoft), por lo que el inventario ya estaba deducido — si la respuesta es NO, el sistema revierte.

**Veredicto:** Fullsite Mejor — la deducción al enviar + reversión si NO preparado es la semántica correcta. Wansoft no deduce hasta cobrar, entonces cuando pregunta "¿se preparó?" el inventario todavía no se había descontado.

**Principio:** _El consumo de inventario ocurre cuando el chef toma el ingrediente, no cuando el cajero cobra. La pregunta "¿se preparó?" es la excepción que revierte el default, no la decisión principal._

---

#### 04.4 Fallo de impresora durante el despacho

**Frecuencia:** Situacional

**Qué hace:** Si la impresora de cocina no responde al despachar, el sistema debe detectarlo y actuar — no fallar silenciosamente.

**Problema operativo:** En hora pico, el cajero presiona Enviar, cree que la comanda llegó, y el cliente espera 25 minutos. El chef no tiene ninguna comanda de esa mesa. Este escenario con impresora fallando en silencio es más común de lo que parece, especialmente con impresoras TCP/IP que pueden perder conexión sin que el sistema lo sepa.

**Wansoft:** Mensaje de error visible si la impresora falla. Impresora secundaria como backup (no configurada en AMALAY). El error no es silencioso pero tampoco es proactivo.

**Fullsite hoy:** Monitoreo de conectividad de impresoras implementado. Verificar si el fallo durante un despacho específico genera alerta visible y no solo indica error general.

**Veredicto:** Gap — el failover automático (redirección a secundaria + alerta al gerente cuando ocurre) no está verificado como activo en el flujo de despacho.

**Principio:** _Un despacho exitoso significa que la cocina recibió la comanda. El sistema no puede decir "listo" hasta verificarlo._

---

## 05 ORDEN EN VUELO

> Entre el despacho y el cobro, la orden es un objeto vivo. El sistema debe permitir modificaciones sin perder la trazabilidad de lo ya enviado.

---

#### 05.1 Agregar items a una orden ya enviada

**Frecuencia:** Universal

**Qué hace:** Permite abrir una orden con items ya despachados y agregar nuevos. Al guardar, el sistema envía solo los items nuevos como una "segunda comanda" — sin reenviar lo ya despachado.

**Problema operativo:** Los clientes piden adicionales con frecuencia después de que la primera comanda llegó a la cocina. Si el sistema no permite agregar, el mesero crea una orden separada — perdiendo la unidad de la mesa en el reporte y complicando el cobro.

**Wansoft:** Doble click para entrar a la orden (previene edición accidental). Items enviados visibles pero inmutables. Los nuevos se agregan normalmente. Al Guardar, solo los nuevos generan comanda.

**Fullsite hoy:** Orden reaparable para agregar items. El despacho incremental: verificar que el historial muestre cada comanda enviada por separado.

**Veredicto:** Equivalente.

**Principio:** _Una orden es una conversación con la cocina, no un documento único. Cada despacho es un mensaje nuevo en la misma conversación._

---

#### 05.2 Inmutabilidad de items enviados

**Frecuencia:** Universal

**Qué hace:** Los items ya enviados a cocina no se pueden editar — solo cancelar (con el flujo completo: razón + pregunta de inventario). No hay forma de cambiar la cantidad o el modificador de un item ya despachado.

**Problema operativo:** Si el cajero pudiera editar un item enviado silenciosamente, la cocina estaría preparando el item original mientras el sistema refleja uno distinto. La inconsistencia entre lo que cocina prepara y lo que el sistema registra es la fuente de errores de cuenta más frustrante para el cliente.

**Wansoft:** Items enviados visualmente diferenciados de items nuevos. Solo se pueden cancelar.

**Fullsite hoy:** Items enviados marcados visualmente (gris) y no editables.

**Veredicto:** Equivalente.

**Principio:** _Una comanda enviada es un contrato con la cocina. El único mecanismo de modificación es la cancelación explícita con razón documentada._

---

#### 05.3 Historial de comandas de la orden

**Frecuencia:** Común

**Qué hace:** Registro visible de todas las comandas enviadas para una orden: primera comanda, adiciones, cancelaciones. Permite reconstruir el timeline completo.

**Problema operativo:** Sin historial de comandas, si hay discrepancia entre lo que el cliente dice haber pedido y lo que el sistema muestra, no hay forma de investigar. El gerente no puede saber "¿cuándo se pidió este platillo?" ni "¿quién canceló esta comanda?"

**Wansoft:** Las comandas físicas quedan en cocina. El historial digital solo existe si el audit log estaba activo — AMALAY lo tenía OFF.

**Fullsite hoy:** El event store registra cada despacho de forma inmutable. La visibilidad del historial dentro de la pantalla de orden: verificar.

**Veredicto:** Fullsite Mejor — el event store de Fullsite es inmutable y siempre activo. Wansoft solo tenía historial si el audit log estaba habilitado.

**Principio:** _El historial de una orden es la fuente de verdad ante cualquier disputa. Debe ser visible, inmutable, y sin excepciones._

---

## 06 CANCELACIONES Y CORRECCIONES

> Las cancelaciones son el vector de fraude más común en restaurantes. Un sistema que las hace convenientes, rápidas, y sin fricción es un sistema que facilita el robo. El diseño correcto hace las cancelaciones posibles pero incómodas de justificar.

---

#### 06.1 Catálogo de razones de cancelación

**Frecuencia:** Común

**Qué hace:** Lista configurable de razones predefinidas para cancelar un item. El mesero selecciona (o escribe) una razón antes de que la cancelación se ejecute.

**Problema operativo:** "Error del cajero" es la razón de cancelación más conveniente — y la más usada para ocultar una cancelación maliciosa. Un catálogo con razones específicas (error de captura, cambio de orden del cliente, no disponible en cocina, alergia detectada) permite analizar patrones reales y detectar anomalías por mesero.

**Wansoft:** Catálogo de razones configurable (uno de los 6 catálogos de permisos de seguridad). Texto libre también disponible. La razón queda registrada.

**Fullsite hoy:** Catálogo de razones implementado. El agente anti-fraude analiza cancellaciones por mesero.

**Veredicto:** Equivalente — con oportunidad de cruzar la distribución de razones por mesero para detectar patrones específicos (un mesero que siempre cancela por "error de captura" vs el promedio del equipo).

**Principio:** _Una cancelación sin razón específica es una cancelación sospechosa. El sistema no puede saberlo; el patrón de razones sí lo revela con el tiempo._

---

#### 06.2 Autorización de gerente para cancelar

**Frecuencia:** Común

**Qué hace:** Cancelar un item enviado requiere autorización del gerente (huella o PIN). El cajero sin permiso ve el dialogo de escalation in-place.

**Problema operativo:** Si el cajero puede cancelar sin autorización, el mecanismo de fraude es trivial: cobrar en efectivo al cliente, cancelar el item en el sistema, y quedarse con el dinero. La autorización del gerente agrega un testigo a la decisión.

**Wansoft:** Configurable en el panel de seguridad. Con perfil admin no requiere autorización adicional — pero en configuración estándar, sí. La autorización in-place aplica.

**Fullsite hoy:** Manager PIN para cancelaciones configurado. Gap: falta el registro de "quién autorizó" (ver 01.3).

**Veredicto:** Gap — la autorización existe pero el audit trail está incompleto sin el nombre del gerente que autorizó.

**Principio:** _La autorización sin registro es una ilusión de control. El valor de requerir el PIN del gerente es el rastro que genera, no el permiso en sí._

---

#### 06.3 Aviso de cancelación a cocina

**Frecuencia:** Común

**Qué hace:** Al cancelar un item ya enviado, el sistema imprime automáticamente un aviso de cancelación en la misma impresora que recibió la comanda original: "CANCELADA — [item] — [razón] — [hora] — [mesero]."

**Problema operativo:** Sin aviso, el chef que ya empezó a preparar el platillo no sabe que fue cancelado. El platillo se termina de preparar, se lleva a la mesa, el cliente no lo esperaba, y el mesero tiene que devolverlo — merma, tiempo, y experiencia del cliente dañados innecesariamente.

**Wansoft:** Impresión automática de aviso de cancelación en la impresora correspondiente. La comunicación es bidireccional: el POS "habla" con la cocina tanto al pedir como al cancelar.

**Fullsite hoy:** KDS visual muestra cancelaciones en tiempo real con color diferenciador para estaciones con KDS. Para estaciones con solo impresora (BARRA en AMALAY): verificar que el aviso impreso se genere.

**Veredicto:** Fullsite Mejor para estaciones con KDS. Gap para estaciones con solo impresora.

**Principio:** _Toda comunicación hacia la cocina necesita su contraparte de cancelación en el mismo canal. Si se pidió por papel, se cancela por papel._

---

#### 06.4 Cancelación de orden completa

**Frecuencia:** Situacional

**Qué hace:** Cancela todos los items de una orden. Siempre requiere razón y, en configuración estándar, autorización del gerente.

**Problema operativo:** Una cancelación de orden con muchos items enviados implica múltiples decisiones de inventario. Si el sistema pregunta "¿se preparó?" por la orden completa (sí/no), la respuesta es incorrecta para algunos items y correcta para otros. Cada platillo tuvo su propio momento de preparación.

**Wansoft:** Cancelación completa disponible. La pregunta de inventario aplica a la orden como un todo.

**Fullsite hoy:** Cancelación de orden implementada. Verificar si la pregunta de inventario es por item o por orden completa.

**Veredicto:** Gap — la pregunta de inventario debería ser item por item, no por la orden completa.

**Principio:** _Una orden con 8 platillos cancelados no es una sola decisión de inventario. Cada platillo tuvo su propio momento de preparación._

---

## 07 OPERACIONES DE MESA

> Los clientes se mueven físicamente en el restaurante. El POS debe seguir esos movimientos sin perder trazabilidad de qué se consumió y quién lo debe.

---

#### 07.1 Transferencia de items individuales

**Frecuencia:** Situacional

**Qué hace:** Mueve platillos individuales de una orden a otra. Acceso desde Avanzadas → "Transferir de mesa." Requiere autorización si está configurado.

**Problema operativo:** Las transferencias son el vector de fraude más sofisticado del POS, identificado explícitamente por Eduardo como "vector principal." El esquema: el cajero cobra una mesa en efectivo, transfiere los items a una orden activa nueva, la primera mesa queda en cero sin haberse cobrado realmente en el sistema, y los items desaparecen entre dos órdenes. El éxito del fraude depende de que la transferencia pase desapercibida.

**Wansoft:** Transferencia vía Avanzadas con campo numérico de mesa destino. Configurable para requerir autorización. El audit log registra la transferencia — pero AMALAY lo tenía OFF, por lo que en la práctica no quedaba registro de ninguna transferencia ocurrida.

**Fullsite hoy:** Transferencia implementada. El event store registra cada movimiento de forma inmutable (sin posibilidad de desactivarlo como en Wansoft). El registro existe; la señal de riesgo no.

**Diseño de prevención — la pregunta correcta:**

La pregunta no es "¿cómo alerto de todas las transferencias?" sino **¿cómo hacemos prácticamente imposible ocultar una transferencia sospechosa sin generar fricción cuando la operación es normal?**

Una transferencia normal tiene contexto claro: el cliente pidió sentarse en otra mesa, el mesero lo acompañó, el cambio ocurrió antes de cobrar. Una transferencia sospechosa no tiene ese contexto — ocurre cerca del cobro, involucra items de alto valor, o sigue un patrón repetido en el turno.

El sistema de prevención tiene tres capas:

1. **Captura de contexto obligatoria** — al transferir, el operador selecciona una razón de una lista corta: "cliente cambió de mesa," "corrección de asignación," "split por petición del cliente." No hay opción de "otro." La razón queda en el event store.

2. **Score de riesgo automático** — la transferencia recibe una puntuación basada en: ¿ocurrió en los últimos X minutos antes de un cobro? ¿El monto involucrado supera el promedio del turno? ¿Este cajero ha transferido más de Z veces hoy? Ningún factor solo activa la alerta — la combinación sí.

3. **Alerta operativa en app cuando el score supera el umbral** — el gerente recibe una notificación dentro de Fullsite: "Transferencia de 3 items ($480) de Mesa 7 a Mesa 2. Score de riesgo: Alto. Ver detalle." La alerta es accionable, no solo informativa.

Las transferencias de bajo riesgo no generan notificación. El gerente no aprende a ignorarlas.

**Veredicto:** Gap crítico — el event store existe, el score de riesgo y la alerta operativa no. Este gap forma parte del sistema de Alertas Operativas (ver 12.2).

**Principio:** _La transferencia legítima tiene contexto. La sospechosa no. El sistema distingue entre ambas por el patrón, no por la operación en sí. Registrar todo es el requisito mínimo; señalar lo inusual es el valor real._

---

#### 07.2 Cambio de mesa (orden completa)

**Frecuencia:** Situacional

**Qué hace:** Mueve toda la orden a un número de mesa diferente. El historial de la orden registra el cambio de número.

**Problema operativo:** Cuando el grupo se cambia físicamente de mesa, el sistema debe reflejarlo para que el plano visual, el mesero, y el gerente sepan dónde está la cuenta. Sin el cambio en el sistema, el plano muestra la mesa original ocupada y la nueva vacía — mentira que desorienta a todo el equipo.

**Wansoft:** Cambiar # de mesa desde Avanzadas. Los 2 campos en el dialogo sugieren capacidad de merge simultáneo.

**Fullsite hoy:** Cambio de mesa implementado. Drag & drop en el plano: verificar si mover la tarjeta de mesa genera el cambio en el sistema o es solo visual.

**Veredicto:** Fullsite Mejor — drag & drop en el plano es más intuitivo que un campo numérico.

**Principio:** _El estado del plano de mesas en pantalla debe ser idéntico al estado físico del restaurante. Cualquier discrepancia es fuente de error._

---

#### 07.3 Split de cuenta por silla

**Frecuencia:** Común

**Qué hace:** Divide los items de una orden en múltiples cuentas separadas por silla asignada. En Wansoft: Avanzadas → Dividir cuenta → seleccionar sillas. Los items de esas sillas forman una nueva orden independiente.

**Problema operativo:** Sin split formal, el cajero calcula manualmente qué le corresponde a cada quien — con papel, calculadora, y margen de error. El split por silla funciona exactamente porque la asignación se hizo durante la captura.

**Wansoft:** Botones por silla en el dialogo de split. Múltiples sillas pueden ir a la misma nueva orden. La orden original conserva las sillas restantes. Cada cuenta se cobra y se imprime independientemente.

**Fullsite hoy:** Split por silla implementado. Items sin silla asignada no participan en el split automático.

**Veredicto:** Equivalente — con la nota de que el split por item individual (drag & drop, sin depender de sillas) y el split por porcentaje serían mejoras para los casos donde las sillas no se asignaron.

**Principio:** _El split de cuenta es la consecuencia natural de asignar sillas durante la captura. Sin esa asignación previa, el split es un cálculo manual que siempre tiene margen de error._

---

#### 07.4 Merge de mesas

**Frecuencia:** Situacional

**Qué hace:** Combina dos órdenes de mesas diferentes en una sola cuenta. Los items de ambas mesas quedan bajo la misma orden, manteniendo la trazabilidad de origen.

**Problema operativo:** Cuando dos mesas quieren pagar juntas, el sistema debe consolidar sin perder el registro de qué mesero atendió a qué grupo y qué items venían de cada mesa.

**Wansoft:** Los 2 campos en el dialogo de "Cambiar # de mesa" sugieren capacidad de merge (mesa A + mesa B → mesa A). El historial debería registrar el origen de cada item.

**Fullsite hoy:** Merge formal de mesas: no verificado. El drag & drop en el plano puede ofrecer este flujo si se arrastra una tarjeta sobre otra.

**Veredicto:** Gap — el merge formal (consolidar dos órdenes preservando el origen de cada item) no está verificado en Fullsite.

**Principio:** _Un merge de mesas no es borrar una orden y agregar sus items a otra. Es consolidar dos conversaciones en una, preservando el contexto de cada una._

---

## 08 COBRO

> El cobro es el momento donde el restaurante recibe el valor de lo que entregó. Un sistema de cobro bien diseñado es rápido, sin ambigüedad, y con cero margen para discrepancias no registradas.

---

#### 08.1 Pantalla de cobro

**Frecuencia:** Universal

**Qué hace:** Muestra el total de la cuenta, permite seleccionar el método de pago, captura el monto recibido, y calcula el cambio automáticamente. En Wansoft: lista de métodos a la izquierda, campos de Total/Recibido/Propina/Cambio al centro, tabla de pagos aplicados a la derecha.

**Problema operativo:** Si la pantalla de cobro es compleja o ambigua, el cajero comete errores bajo presión. AMALAY tiene 18 formas de pago — una lista scrolleable de 18 opciones no es una buena UX de cobro.

**Wansoft:** Layout de 3 columnas. Lista scrolleable de métodos. Botón "Auto" para asignar todo el saldo al método seleccionado. Cambio calculado en tiempo real. La tabla de pagos aplicados muestra el progreso del pago mixto.

**Fullsite hoy:** Flujo de cobro implementado. Verificar si el botón "Auto" existe y si el cambio se calcula en tiempo real.

**Veredicto:** Equivalente — con oportunidad: los 3-4 métodos más usados deberían ser botones prominentes; el resto en un panel de "más opciones."

**Principio:** _El cajero cobra a 50 clientes por turno. La fricción de 2 segundos por cobro son 100 segundos de tiempo perdido — y 100 momentos de potencial error._

---

#### 08.2 Pago mixto

**Frecuencia:** Común

**Qué hace:** Permite pagar con múltiples métodos en la misma cuenta. El saldo pendiente se actualiza en tiempo real conforme se aplican pagos. El cierre solo ocurre cuando el saldo llega a $0.

**Problema operativo:** "¿Tengo $200 en efectivo y el resto con tarjeta?" es una frase que el cajero escucha varias veces por turno. Sin soporte nativo, el cajero tiene que calcular el split a mano.

**Wansoft:** La tabla de pagos aplicados a la derecha muestra cada pago por método. El saldo pendiente se actualiza al agregar cada pago. El botón "Auto" asigna el saldo restante al método actual.

**Fullsite hoy:** Pago mixto implementado.

**Veredicto:** Equivalente.

**Principio:** _El saldo pendiente al cobrar debe ser siempre visible y actualizado en tiempo real. El cajero nunca debería hacer cálculos mentales._

---

#### 08.3 Integración con terminal bancaria

**Frecuencia:** Universal

**Qué hace:** Al seleccionar tarjeta, el POS se comunica con la terminal bancaria, envía el monto, y espera la confirmación antes de cerrar la cuenta.

**Problema operativo:** Sin integración, el cajero captura el monto en el POS y en la terminal por separado — doble captura, doble posibilidad de error. AMALAY usa Getnet (Santander) que NO está en las integraciones nativas de Wansoft. AMALAY opera en modo doble captura permanente.

**Wansoft:** Integración nativa con Clip, Operaciones en Línea, NetPay, BBVA. Para Getnet: cero integración, la doble captura es manual.

**Fullsite hoy:** Integración con Clip y MP Point. Para Getnet: el cajero captura el número de referencia manualmente.

**Veredicto:** Equivalente en integración disponible. Gap de conciliación automática — ver Settings 11.2.1.

**Principio:** _La confirmación de la terminal bancaria y el registro en el POS son un solo evento, no dos. Si son dos, habrá discrepancias._

---

#### 08.4 Cambio como propina

**Frecuencia:** Común

**Qué hace:** Cuando el diferencial entre el monto autorizado en tarjeta y el total de la cuenta es pequeño, ese diferencial se registra como propina automáticamente — en lugar de quedar como "saldo no resuelto." AMALAY tiene esta regla activa.

**Problema operativo:** Sin esta regla, el diferencial queda como un estado indefinido. El cajero tiene que decidir ad-hoc qué hacer con $12 de diferencial, y cualquier decisión sin registro es inconsistente.

**Wansoft:** Checkbox "Incluir el cambio como propina en pagos con cuenta bancaria" — activo en AMALAY.

**Fullsite hoy:** Gap — esta regla no está configurada formalmente.

**Veredicto:** Gap — ver Settings 15.3.1 para el diseño.

**Principio:** _Todo dinero que entra al restaurante debe tener una categoría. Un diferencial sin nombre es dinero que alguien puede quedarse._

---

## 09 EXCEPCIONES AL COBRO

> Los descuentos y cortesías son herramientas legítimas de operación. También son el segundo vector de fraude más común. El sistema debe hacer posible lo legítimo e incómodo lo ilegítimo.

---

#### 09.1 Descuentos con catálogo predefinido

**Frecuencia:** Común

**Qué hace:** Lista configurable de descuentos con porcentajes y razones predefinidas. AMALAY tiene: 50% EMPLEADOS, TELCEL 15%, INFLUENCER 50%, SRA MONICA 50%, REFILL $10, MARKET 20%, BBVA 15%. También: opción de porcentaje/monto abierto.

**Problema operativo:** Sin catálogo, el cajero puede escribir cualquier porcentaje de descuento. El catálogo limita los descuentos posibles a los que el gerente autorizó previamente — y cada uno tiene una razón explícita.

**Wansoft:** 4 opciones: porcentajes predefinidos del catálogo, razones predefinidas, monto abierto, porcentaje abierto. El descuento por item (individual) es distinto al descuento prorrateado a la cuenta (distribuido entre todos los items).

**Fullsite hoy:** Catálogo de descuentos implementado. Verificar que el porcentaje abierto esté restringido a perfil de gerente.

**Veredicto:** Equivalente — con recomendación de bloquear el porcentaje abierto para meseros.

**Principio:** _Un catálogo de descuentos predefinido no limita la operación. Limita el abuso. La diferencia es visible en el análisis de descuentos por mesero._

---

#### 09.2 Cortesías

**Frecuencia:** Situacional

**Qué hace:** Aplica el 100% de descuento a un item o a toda la cuenta. Siempre requiere razón. En AMALAY, el catálogo tiene: CLAUDIA SADA 100%, INFLUENCER 100%.

**Problema operativo:** Una cortesía sin nombre asociado es un ingreso que el restaurante regaló sin saber a quién. Con nombres específicos en el catálogo, el gerente puede revisar a quién se dieron cortesías y con qué frecuencia — incluyendo si un mesero está abusando del catálogo.

**Wansoft:** Catálogo de cortesías separado del de descuentos. La diferencia semántica es importante: la cortesía siempre es 100%; el descuento puede ser parcial.

**Fullsite hoy:** Cortesías con catálogo implementadas.

**Veredicto:** Equivalente.

**Principio:** _Una cortesía con nombre específico es una decisión de negocio documentada. Una cortesía anónima es una fuga sin identificar._

---

#### 09.3 Descuento prorrateado vs descuento por item

**Frecuencia:** Común

**Qué hace:** El descuento por item aplica solo al platillo seleccionado. El descuento prorrateado distribuye el porcentaje proporcionalmente entre todos los items de la cuenta. Son operaciones con consecuencias distintas en el food cost calculado.

**Problema operativo:** Si el sistema solo tiene un tipo de descuento, el cajero no puede distinguir entre "el cliente tiene BBVA y aplica 15% a toda la cuenta" vs "este platillo específico tiene un error y aplica descuento al item." La confusión contamina el análisis de food cost.

**Wansoft:** "Aplicar descuento" (item individual, seleccionado desde el item) y "Descuento prorrateado a la cuenta" (toda la orden, desde Avanzadas opción 9) son flujos distintos.

**Fullsite hoy:** Verificar si ambos tipos están implementados y diferenciados.

**Veredicto:** Gap — si solo existe un tipo, la distinción semántica se pierde.

**Principio:** _Un descuento a toda la cuenta no es el mismo porcentaje aplicado a cada item. El food cost calculado tiene que reflejar la diferencia._

---

#### 09.4 Promociones y 2x1

**Frecuencia:** Situacional

**Qué hace:** Las promociones aplican reglas condicionales (horario, platillo, forma de pago, combinación de items). El 2x1 es una operación separada del descuento — tiene semántica distinta en el inventario y en el food cost.

**Problema operativo:** Las promociones son temporales. Si el sistema no controla qué promociones están vigentes en cada momento, el mesero las aplica o las olvida de forma inconsistente — un cliente obtuvo el 2x1 del miércoles y otro no porque el mesero olvidó aplicarlo.

**Wansoft:** 2x1 y Promociones son opciones separadas en Avanzadas (además de descuentos y cortesías). El 2x1 es distinto al 50% de descuento — tiene semántica propia en el inventario.

**Fullsite hoy:** Motor de promociones en el dashboard. Verificar si las promociones activas se aplican automáticamente o requieren activación manual del mesero.

**Veredicto:** Fullsite Mejor (potencial) — el motor de promociones puede aplicar la condición automáticamente cuando se detectan los items y el horario, sin que el mesero tenga que recordar activarla.

**Principio:** _Una promoción que el mesero puede olvidar no es una promoción — es una lotería para el cliente._

---

## 10 OUTPUT FÍSICO

> El ticket es el único documento que el cliente se lleva del restaurante. La comanda es el único documento que llega a cocina. Ambos deben ser completos, correctos, y sin ambigüedad.

---

#### 10.1 Ticket impreso vs ticket digital

**Frecuencia:** Universal

**Qué hace:** Al cerrar una orden, el sistema genera el recibo. En Wansoft, siempre impreso (thermal 72mm). En Fullsite, puede ser impreso, digital (QR al ticket web), o ambos.

**Problema operativo:** El ticket impreso cuesta papel, requiere rollo disponible, puede fallar la impresora, y el cliente frecuentemente no lo quiere. El ticket digital es gratuito, no falla, y el cliente lo tiene en el teléfono.

**Wansoft:** Siempre impreso. Configuración completa: logo, nombre, dirección, RFC, razón social, teléfonos, footer de 7 líneas, QR de facturación, QR de Megapuntos. Preview en vivo y test print.

**Fullsite hoy:** Ticket impreso implementado. Ticket digital como QR: disponible como opción complementaria.

**Veredicto:** Fullsite Mejor — la opción digital reduce costos y fricción.

**Principio:** _El ticket es el último punto de contacto del restaurante con el cliente. Debe ser la oportunidad de dejar buena impresión, no un papel que el cliente tira en la salida._

---

#### 10.2 QR de autofacturación en el ticket

**Frecuencia:** Común (en zonas corporativas)

**Qué hace:** El ticket incluye un QR que lleva al cliente al portal de autofacturación: captura RFC, el sistema valida contra el SAT, timbra el CFDI, y lo envía al email del cliente — sin intervención del cajero.

**Problema operativo:** El proceso manual de facturación en Wansoft (cajero busca la venta, captura RFC, timbra, envía email) toma 5-10 minutos. En restaurantes donde el 30-40% de los clientes piden factura (zonas corporativas, San Pedro), eso es 1-4 horas diarias de trabajo administrativo.

**Wansoft:** QR en el ticket activo en AMALAY. El QR lleva al portal de Wansoft — interfaz desktop con flujo de 8+ pasos no optimizada para móvil.

**Fullsite hoy:** Portal de autofacturación mobile-first activo. Validación de RFC en tiempo real contra el SAT. 3 pasos en 60 segundos.

**Veredicto:** Fullsite Mejor — la experiencia mobile-first supera significativamente al portal desktop de Wansoft.

**Principio:** _La facturación es una obligación del restaurante hacia el cliente que la pide. Hacerla fácil para el cliente es hacerla eficiente para el negocio._

---

#### 10.3 Aviso de cancelación en cocina

**Frecuencia:** Común

**Qué hace:** Al cancelar un item ya enviado, el sistema imprime automáticamente un aviso en la impresora de la estación correspondiente.

**Problema operativo:** Ver 06.3. Sin aviso, el chef termina de preparar un platillo cancelado.

**Wansoft:** Impresión automática en la impresora correcta: "CANCELADA — [item] — [razón] — [hora] — [mesero]."

**Fullsite hoy:** KDS visual para estaciones digitales (mejor que papel). Para BARRA en AMALAY (solo impresora): verificar que el aviso impreso se genere.

**Veredicto:** Gap específico para estaciones con impresora pero sin KDS.

**Principio:** _Ver 06.3._

---

## 11 CONTROL DE TURNO

> El turno es la unidad de tiempo de responsabilidad del cajero. Todo lo que ocurrió desde que abrió la caja hasta que la cerró es su responsabilidad. El cierre de turno es el momento de reconciliar esa responsabilidad con el efectivo real.

---

#### 11.1 Apertura formal de turno

**Frecuencia:** Universal

**Qué hace:** Formaliza el inicio del turno: confirma el fondo de caja ($1,700 MXN en AMALAY), registra la hora de inicio, y establece al cajero responsable.

**Problema operativo:** Sin apertura formal, si el fondo está incompleto al inicio del turno (el turno anterior tenía faltante), la discrepancia al cierre del nuevo turno no puede atribuirse correctamente. El cajero entrante carga con un problema que no creó.

**Wansoft:** La apertura de turno existe en el sistema aunque AMALAY no la usa formalmente. El fondo es $1,700 MXN.

**Fullsite hoy:** Gap — apertura formal de turno con confirmación del fondo no implementada como flujo explícito.

**Veredicto:** Gap crítico — Tier 1 del Gap Analysis. Sin apertura formal, la responsabilidad del cajero no tiene punto de inicio verificado.

**Principio:** _El turno comienza cuando el cajero confirma el estado inicial. Sin ese momento, no hay responsabilidad delimitada._

---

#### 11.2 Retiros y depósitos

**Frecuencia:** Común

**Qué hace:** Registra movimientos de efectivo fuera del cajón: retiros (pagar gastos, reducir efectivo acumulado) y depósitos (llevar efectivo al banco). Ambos tienen monto, razón, y autorización del gerente.

**Problema operativo:** Sin registro, el arqueo de caja nunca cuadra. No hay forma de calcular el efectivo esperado al cierre si no se sabe qué entradas y salidas ocurrieron durante el turno.

**Wansoft:** Retiros y depósitos desde el menú de caja. Retiros programados (cuando el efectivo supera un umbral) no activados en AMALAY.

**Fullsite hoy:** Retiros y depósitos implementados.

**Veredicto:** Equivalente.

**Principio:** _Todo efectivo que sale del cajón sin registro es un déficit en el arqueo que nadie puede explicar._

---

#### 11.3 Los cinco tipos de corte

**Frecuencia:** Universal

**Qué hace:** Cinco tipos de cierre de período con propósitos distintos: X (parcial, no cierra), Turno (cierra el turno del cajero), Z (cierre fiscal del día, requiere cero órdenes abiertas), Global (resumen general), Mesero (resumen individual por mesero).

**Problema operativo:** Un solo tipo de corte no puede satisfacer las necesidades de información del gerente (mid-service, Corte X), el cajero (end of shift, Corte Turno), y el dueño/contador (end of day fiscal, Corte Z). Sin los cinco tipos, las decisiones de información se toman con la herramienta incorrecta.

**Wansoft:** Los 5 tipos con semántica clara. El Corte Z requiere cero órdenes abiertas. El Corte X es el "¿cómo vamos?" sin cerrar nada. El Corte de Mesero da el resumen individual.

**Fullsite hoy:** Corte de turno implementado. Corte de Mesero: Gap crítico (Tier 1 del Gap Analysis). El dashboard en tiempo real es el "Corte X digital" de Fullsite.

**Veredicto:** Gap en Corte de Mesero y Corte Z automático. El dashboard reemplaza el Corte X impreso.

**Principio:** _Diferentes actores necesitan información en diferentes momentos y formatos. Un solo tipo de corte es insuficiente._

---

#### 11.4 Arqueo de caja

**Frecuencia:** Universal

**Qué hace:** Proceso de contar el efectivo en el cajón y compararlo contra el esperado por el sistema. La diferencia es el faltante o sobrante del turno.

**Problema operativo:** AMALAY tiene el arqueo desactivado — el cajero declara el monto sin contarlo formalmente. Sin arqueo, el cajero puede declarar cualquier número conveniente sin contar físicamente el efectivo.

**Wansoft:** Arqueo con hasta 3 intentos antes de aceptar la diferencia. El sistema tiene la fórmula: Fondo + Ventas efectivo + Depósitos - Retiros - Vales - Propinas distribuidas = Efectivo esperado.

**Fullsite hoy:** Arqueo básico implementado. Arqueo con denominaciones (billetes de $500, $200, $100...): no verificado.

**Veredicto:** Gap — el arqueo sin denominaciones detecta discrepancias de $500 pero no de $50.

**Principio:** _El arqueo no es un trámite de cierre. Es el único mecanismo que hace al cajero responsable del efectivo real, no del número que escribe._

---

#### 11.5 Disponibilidad del corte en tiempo real

**Frecuencia:** Universal

**Qué hace:** Al cerrar el turno, el resumen queda disponible inmediatamente en la app de Fullsite — y el dueño o gerente recibe una notificación de alta confianza dentro de la app: "Corte de turno disponible. Diferencia de caja: $0."

**Problema operativo:** El dueño de AMALAY no sabe si el turno nocturno cuadró hasta la mañana siguiente. Una diferencia de caja de $2,000 a las 11pm que se detecta a las 8am del día siguiente ya no es investigable — el cajero ya se fue, el efectivo se mezcló con el fondo del día siguiente, y el rastro se enfrió.

**Wansoft:** Email de corte disponible pero OFF en AMALAY. El email es un PDF adjunto no optimizado para móvil, y requiere que el dueño tenga cuenta en el portal de Wansoft.

**Fullsite hoy:** El corte existe en el sistema. La notificación push al dueño cuando se cierra el turno: no implementada. El dueño tiene que entrar a la app para verificarlo.

**Veredicto:** Gap — la dirección correcta no es "enviar a un canal externo" sino hacer que la app de Fullsite sea el centro de la operación. El corte disponible es el primer evento que activa el sistema de Alertas Operativas (ver 12.2).

**Principio:** _Fullsite es el destino, no el remitente. La app entrega información al dueño. El dueño no va a buscarla._

---

## 12 SUPERVISIÓN

> El gerente no puede estar en la caja todo el tiempo. El sistema debe ser sus ojos cuando no está presente. Fullsite es el centro de la operación — no un canal de notificaciones que compite con otros, sino la app que el gerente abre porque sabe que ahí está la información que importa.

---

#### 12.1 Los seis catálogos de permisos

**Frecuencia:** Universal (como infraestructura)

**Qué hace:** Seis catálogos que definen el ámbito de lo que el cajero puede hacer solo vs lo que requiere autorización: (1) platillos que requieren gerente, (2) grupos que requieren gerente, (3) métodos de pago que requieren gerente, (4) catálogo de descuentos permitidos, (5) catálogo de cortesías permitidas, (6) razones de cancelación.

**Problema operativo:** Sin granularidad de permisos, el cajero tiene acceso total (riesgo de fraude) o acceso mínimo (fricción en cada transacción normal). Los 6 catálogos permiten que el cajero haga lo rutinario de forma autónoma y que el gerente autorice solo lo excepcional.

**Wansoft:** Panel de seguridad con toggles y 6 catálogos editables. La granularidad es a nivel de ítem específico: no es "el cajero puede descuentos" vs "no puede" — es "el cajero puede ESTOS descuentos específicos."

**Fullsite hoy:** Matriz de permisos con 269 acciones configurables. Los 6 catálogos de Wansoft están representados con mayor granularidad.

**Veredicto:** Fullsite Mejor — la granularidad de 269 acciones supera los 6 catálogos de Wansoft.

**Principio:** _La granularidad de permisos es proporcional a la confianza en el sistema. Un sistema con 2 niveles es un sistema que no confía en sus propias reglas._

---

#### 12.2 Sistema de Alertas Operativas

**Frecuencia:** Común

**Qué hace:** Detecta eventos operativos de alta importancia y entrega notificaciones de alta confianza dentro de la app de Fullsite. La filosofía es: pocas alertas, pero cada una merece abrir la aplicación.

**Problema operativo:** Los sistemas de notificación que alertan de todo entrenan al receptor a ignorarlos. El gerente que recibe 30 notificaciones por turno deja de leerlas. El objetivo no es más información — es señal más limpia. Una alerta de Fullsite debe llegar y ser accionable, no decorativa.

**Wansoft:** No tiene alertas proactivas durante el servicio. Todo es retrospectivo. La única "alerta" en tiempo real es el dialogo de autorización en el POS — y esa requiere que el gerente ya esté presente.

**Fullsite hoy:** Agente anti-fraude semanal. Agente de anomalías diario. Alertas de alta confianza en tiempo real durante el servicio: no implementadas.

**Catálogo de alertas de alta confianza:**

| Alerta | Condición de disparo | Por qué merece abrir la app |
|---|---|---|
| Corte de turno disponible | Al cerrar el turno | Diferencia de caja visible en 10 segundos |
| Transferencia con riesgo | Score > umbral (ver 07.1) | Posible fraude activo, no retrospectivo |
| Cancelaciones fuera de patrón | Cajero supera 2σ del promedio del equipo | Anomalía estadística, no juicio subjetivo |
| Descuento inusual | Monto o porcentaje fuera del catálogo vigente | Error o abuso, identificable en el momento |
| Caja sin cerrar | Turno esperado terminó sin corte registrado | Cajero se fue sin cuadrar |
| Inventario crítico | Item bajo punto de reorden durante el servicio | Afecta platillos activos en el menú |
| Tiempo de preparación anormal | Mesa con pedido enviado hace >N minutos sin cierre | Cliente esperando; cocina puede necesitar apoyo |
| Restaurante sin ventas en horario activo | Zero movimiento en hora con historial de ventas | Falla de sistema, cierre no registrado, o problema real |

Criterio de inclusión: la alerta debe ser accionable hoy, no la semana próxima. Si el gerente no puede hacer nada en el momento, no es una alerta — es un reporte.

**Veredicto:** Gap — ningún competidor tiene este sistema. Wansoft no tiene alertas operativas. El sistema de Alertas Operativas convierte a Fullsite de "POS con mejores reportes" a "sistema operativo que detecta problemas antes de que el dueño los vea."

**Principio:** _Una alerta que llega siempre pierde su urgencia. El valor de las alertas de alta confianza es proporcional a su escasez. Cada notificación de Fullsite debe merecer la atención del gerente._

---

#### 12.3 Autorización remota

**Frecuencia:** Situacional

**Qué hace:** Cuando el cajero necesita autorización del gerente, el gerente puede autorizarla desde su teléfono sin ir físicamente a la caja.

**Problema operativo:** El escalation in-place de Wansoft es excelente cuando el gerente está en el restaurante. Si el gerente está en el salón atendiendo a una mesa VIP, tiene que interrumpir para ir a la caja. Esto ocurre 5-15 veces por turno en un restaurante activo.

**Wansoft:** No existe. La autorización siempre requiere presencia física en la caja.

**Fullsite hoy:** Gap — no implementada.

**Veredicto:** Gap — oportunidad de diferenciación directa. La alerta dentro de la app: "Omar solicita cortesía INFLUENCER en mesa 7 ($480). ¿Aprobar?" con un botón de aprobación que ejecuta el permiso en tiempo real. El gerente no abandona lo que está haciendo; la caja no queda bloqueada esperando.

**Principio:** _El gerente no debería tener que elegir entre supervisar el salón y autorizar en la caja. La autorización remota elimina ese trade-off._

---

#### 12.4 Dashboard del gerente

**Frecuencia:** Universal

**Qué hace:** Vista del estado de toda la operación disponible desde el teléfono del gerente: mesas ocupadas, ventas del turno, cancelaciones, descuentos aplicados, diferencias de caja, alertas activas.

**Problema operativo:** El gerente que quiere saber "¿cómo vamos?" tiene que ir al POS (interrumpir al cajero) o esperar el corte. Con el dashboard móvil, la información está disponible sin interrumpir la operación.

**Wansoft:** No existe dashboard móvil. La única vista en tiempo real es el POS físico en la caja.

**Fullsite hoy:** Dashboard web con datos en tiempo real. El gerente puede ver el estado de la operación sin interrumpir al cajero.

**Veredicto:** Fullsite Mejor — el dashboard es una ventaja estructural. La diferencia no es tecnológica: es que Fullsite fue diseñado desde el inicio con la premisa de que el dueño no está siempre en el local. Wansoft asume que el dueño está frente al POS.

**Principio:** _El gerente que tiene que ir al POS para saber cómo va la operación es un gerente que está atado a la caja. Fullsite libera esa restricción._

---

## Síntesis: Principios de Producto del POS

Destilación de los 16 principios que emergen de documentar ~50 operaciones del POS:

### Identidad y responsabilidad
1. _La identidad es siempre visible y nunca opcional. Toda acción en el POS tiene un autor._
2. _La autorización sin registro es una ilusión de control. El valor de requerir el PIN del gerente es el rastro que genera, no el permiso en sí._
3. _El turno comienza cuando el cajero confirma el estado inicial. Sin ese momento, no hay responsabilidad delimitada._
4. _Identidad de sesión y atribución de orden son dos preguntas distintas. No confundirlas._

### Flujo operativo
5. _El nombre del botón describe exactamente lo que hace. "Guardar" sugiere reversibilidad. "Enviar a cocina" no._
6. _Una comanda enviada es un contrato con la cocina. El único mecanismo de modificación es la cancelación explícita con razón documentada._
7. _El primer paso de una orden establece el contexto de todo lo que sigue. Establecerlo correctamente es más fácil que corregirlo después._
8. _Una orden es una conversación con la cocina, no un documento único. Cada despacho es un mensaje nuevo._

### Control y fraude
9. _Todo movimiento de item entre órdenes es potencialmente sospechoso. El gerente debe saberlo en tiempo real._
10. _Una cancelación sin razón específica es una cancelación sospechosa. El sistema no puede saberlo; el patrón de razones sí lo revela._
11. _Un catálogo de descuentos predefinido no limita la operación. Limita el abuso._
12. _El arqueo no es un trámite de cierre. Es el único mecanismo que hace al cajero responsable del efectivo real._

### Comunicación con cocina
13. _La comanda correcta llega a la estación correcta automáticamente. El mesero no debe saber qué prepara cada estación._
14. _El consumo de inventario ocurre cuando el chef toma el ingrediente, no cuando el cajero cobra._
15. _Toda comunicación hacia la cocina necesita su contraparte de cancelación en el mismo canal._

### Supervisión
16. _La supervisión retrospectiva documenta el daño. La supervisión en tiempo real previene que ocurra._
17. _El gerente que tiene que ir al POS para saber cómo va la operación es un gerente atado a la caja. Fullsite libera esa restricción._
18. _Fullsite es el destino, no el remitente. La app entrega información al dueño. El dueño no va a buscarla._
19. _Una alerta que llega siempre pierde su urgencia. El valor de las alertas de alta confianza es proporcional a su escasez._
20. _La transferencia legítima tiene contexto. La sospechosa no. El sistema distingue entre ambas por el patrón, no por la operación en sí._

---

## Veredicto consolidado

| Área | Veredicto | Estado |
|---|---|---|
| Sesión e identidad | Equivalente | Gap en bloqueo post-operación y log de quién autorizó |
| Apertura de orden | Fullsite Mejor | Plano visual supera card view; gap de confirmación de personas al cierre |
| Captura de platillos | Equivalente | Gap en escaneo de barcode durante captura de orden |
| Despacho a cocina | Fullsite Mejor | Deducción al enviar; failover de impresora pendiente de verificar |
| Orden en vuelo | Fullsite Mejor | Event store inmutable siempre activo vs audit log opcional de Wansoft |
| Cancelaciones | Equivalente | Oportunidad en análisis de distribución de razones por mesero |
| Operaciones de mesa | Gap en merge | Transferencia: alerta proactiva pendiente; merge formal no verificado |
| Cobro | Equivalente | Diferencial de tarjeta como propina: pendiente |
| Excepciones al cobro | Equivalente | Descuento prorrateado vs por item: pendiente de verificar |
| Output físico | Fullsite Mejor | Ticket digital + autofacturación móvil supera portal desktop de Wansoft |
| Control de turno | Gap | Apertura formal pendiente; Corte de Mesero pendiente; arqueo con denominaciones pendiente |
| Supervisión | Fullsite Mejor (potencial) | Dashboard supera portal desktop de Wansoft; Alertas Operativas y autorización remota en app pendientes |

**Fullsite Mejor en 4 áreas, Equivalente en 5, Gap en 3.**

El mayor diferencial estructural de Fullsite no está en la captura de órdenes ni en el cobro — está en la supervisión. Wansoft asume que el dueño está frente al POS. Fullsite asume que el dueño tiene un restaurante que operar y no puede estar siempre en la caja. Las Alertas Operativas, la autorización remota, y el dashboard en tiempo real son el núcleo de esa diferencia — y ningún competidor las tiene integradas en un solo sistema.

---

## Gaps priorizados

| Gap | Dominio | Esfuerzo | Prioridad |
|---|---|---|---|
| Pantalla de bloqueo post-operación | 01.2 | 2 días | Alta — Eduardo lo pidió explícitamente |
| Log de "quién autorizó" en escalation | 01.3 | 3 días | Alta — completa el fraud stack |
| Confirmación de personas al cierre de cuenta | 02.3 | 1 día | Media |
| Escaneo de barcode durante captura de orden | 03.4 | 3 días | Alta — AMALAY market activo |
| Post-envío regresa al plano (no a lista) | 04.1 | 1 día | Alta — Eduardo feedback 21 jul |
| Failover de impresora + alerta en despacho | 04.4 | 1 sem | Alta — silencio en fallo es inaceptable |
| Pregunta de inventario por item (no por orden) | 06.4 | 3 días | Media |
| Sistema Alertas Operativas (score riesgo + notif en app) | 07.1, 12.2 | 3 sem | Alta — diferencial competitivo principal |
| Merge de mesas formal | 07.4 | 1 sem | Media |
| Diferencial de tarjeta como propina | 08.4 | 3 días | Media — AMALAY activo en Wansoft |
| Descuento prorrateado vs por item | 09.3 | 3 días | Media |
| Aviso de cancelación en estaciones solo-impresora | 10.3 | 2 días | Alta — BARRA en AMALAY |
| Apertura formal de turno | 11.1 | 3 días | Alta — Tier 1 del Gap Analysis |
| Corte de Mesero | 11.3 | 1 sem | Alta — Tier 1 del Gap Analysis |
| Arqueo con denominaciones | 11.4 | 1 sem | Media |
| Notificación push en app al cerrar turno | 11.5 | 1 sem | Alta — primer evento de Alertas Operativas |
| Autorización remota desde app Fullsite | 12.3 | 2 sem | Alta — elimina trade-off supervisión/caja |

---

> **Fase de análisis funcional: cerrada.**
> Las siguientes decisiones de producto nacen de estos documentos — no de comparaciones pantalla a pantalla con Wansoft.
> El objetivo a partir de aquí: implementar los gaps priorizados, validarlos en operación real, y construir
> la visión de Fullsite como el sistema operativo del restaurante.
>
> Compañero técnico: `FULLSITE-POS-BIBLE.md` — auditoría de código, state machines, referencias precisas a archivos y líneas.
> Settings Bible: `docs/bibles/FULLSITE-SETTINGS-BIBLE.md`
> Settings Gap Analysis: `docs/bibles/SETTINGS-GAP-ANALYSIS.md`
>
> Última actualización: 2026-07-25 — Daniel Ramonfaur + Claude Code (Fullsite)
