# Fullsite Settings Gap Analysis

> Derivado de `FULLSITE-SETTINGS-BIBLE.md` — ~122 settings documentados en 26 dominios.
> El propósito de este documento no es agregar más settings al inventario.
> Es decidir qué construir, qué nunca construir, qué eliminar, y qué revisar después.
>
> Fecha: 2026-07-25

---

## 1. Top 20 settings de mayor impacto

Priorizados por tres variables: **valor operativo real** (qué problema resuelve y con qué frecuencia ocurre), **esfuerzo de implementación** (semanas-ingeniero), y **dónde nos deja** en el posicionamiento competitivo.

La columna "Hoy" refleja el estado actual: ✅ implementado, ⚠️ parcial, ❌ no existe.

### Tier 1 — Antes de los primeros 10 clientes

Estos no son opcionales. Sin ellos, el producto tiene gaps de control que un contador o dueño va a detectar en el primer mes.

| # | Setting | Dominio | Hoy | Por qué importa | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **Escalation in-place con log de quién autorizó** | 14.1.3 | ⚠️ | El manager PIN existe. Lo que falta es el log: quién autorizó, qué operación, a qué hora. Sin este registro, el PIN es control de acceso, no auditoría. Eduardo lo pidió explícitamente. | 1 sem |
| 2 | **Apertura formal de turno** | 12.5.1 | ❌ | Protege al cajero entrante. Si el fondo estaba incompleto al inicio de su turno y no hay registro de apertura, la discrepancia del cierre se atribuye a él. Es el único mecanismo de separación de responsabilidad entre turnos. | 3 días |
| 3 | **Corte de Mesero** | 13.1.1 | ❌ | Es el documento que el mesero lleva en la mano al cierre de su turno: sus ventas, su aportación al pool, sus propinas. Sin él, los meseros no tienen visibilidad de sus propios números. Si el sistema no les habla a ellos, el sistema no es suyo. | 1 sem |
| 4 | **Cambio de forma de pago post-cobro con audit trail** | 14.2.2 | ❌ | El cajero puede cobrar en efectivo, registrarlo como tarjeta, y quedarse con el efectivo. Sin restricción y sin log, es invisible. Este es el segundo vector de fraude de caja más común (el primero son las cancelaciones retroactivas). Eduardo lo pidió en la reunión del 05-27. | 3 días |
| 5 | **Porcentaje de aportación al pool de propinas** | 15.2.1 | ❌ | El `tips_analyzer` ya calcula tendencias de propinas. Pero sin saber cuánto aporta cada mesero al pool (AMALAY: 5% de su venta), el análisis es incompleto. Esta configuración destraba el análisis que ya existe. | 1 día |
| 6 | **Factura global automática** | 21.4.1 | ❌ | Es un requisito legal. Todas las ventas sin CFDI individual tienen que quedar cubiertas por la factura global mensual. No es opcional — es cumplimiento fiscal. Un restaurante sin factura global tiene un gap regulatorio que el contador va a notar. | 1 sem |
| 7 | **Cuentas bancarias del restaurante** | 20.5.1 | ❌ | Prerequisito para la conciliación automática. Sin saber a qué cuenta fueron los depósitos de efectivo, el sistema no puede comparar. Implementación trivial (una tabla y un select). Habilita algo mucho más grande. | 1 día |

### Tier 2 — Antes de 50 clientes

Diferenciales reales. Aquí es donde Fullsite deja de ser "otro POS con buena interfaz" y empieza a ser un sistema que el dueño siente que trabaja para él.

| # | Setting | Dominio | Hoy | Por qué importa | Esfuerzo |
|---|---|---|---|---|---|
| 8 | **Conciliación bancaria automática** | 11.2.1 | ❌ | El gap entre "tarjeta en POS" y "tarjeta en banco" es universal en restaurantes con terminales no integradas (como AMALAY/Getnet). Nadie en LATAM lo resuelve automáticamente. Con Clip + MP Point ya tenemos las APIs — el report nightly es el paso final. | 2 sem |
| 9 | **Envío de cortes por Telegram** | 13.4.1 | ❌ | El orquestador ya existe. El corte ya existe. Falta el trigger que, al cerrar el turno, genera el mensaje estructurado y lo manda al canal correcto. Esfuerzo real: horas. Impacto percibido: alto. | 2 días |
| 10 | **Arqueo de caja (opcional, con denominaciones)** | 12.4.1 | ❌ | AMALAY tiene el arqueo apagado en Wansoft. Pero para restaurantes con alto volumen de efectivo (bares, antros, mercados), el conteo por denominación es la única forma de detectar discrepancias chicas antes de que se acumulen. Activarlo como opción, no como default. | 1 sem |
| 11 | **Horas máximas de turno con banner de alerta** | 13.3.1 | ❌ | Si el turno lleva más de X horas activo sin corte, el cajón acumula efectivo sin control. No bloquear — alertar. Un banner prominente en el POS y un mensaje a Telegram al gerente. Esfuerzo: horas. | 1 día |
| 12 | **Distribución de propinas por modelo** | 15.4.1 | ❌ | El reparto de propinas es uno de los temas de mayor fricción entre el equipo de un restaurante. Un modelo formal (mesero 70%, runner 20%, garrotero 10%) que el sistema calcula y registra automáticamente elimina la discrepancia percibida. | 1.5 sem |
| 13 | **Umbrales de alerta configurables** | 25.3.1 | ⚠️ | El agente de anomalías tiene umbrales hardcoded. Un food cost target de 32% para AMALAY es correcto. Para un restaurante de alta gastronomía con ingredientes premium, el target puede ser 42%. Sin configuración, los umbrales fijos generan falsos positivos — y el dueño los ignora. | 3 días |
| 14 | **Destinatarios por tipo de alerta** | 25.2.1 | ⚠️ | Hoy las alertas van a un solo canal (Daniel en Telegram). Con múltiples sucursales y múltiples roles (gerente de operaciones, chef ejecutivo, contador), el dueño no debería recibir alertas de punto de reorden de cocina. | 1 sem |
| 15 | **Corte X — parcial sin cierre de turno** | 13.1.2 | ❌ | El gerente necesita saber "cómo vamos" sin cerrar nada. Hoy tiene que abrir el dashboard o esperar el briefing de Telegram. Un corte X imprimible desde el POS es el equivalente del dashboard para el gerente que no tiene teléfono en la mano. | 1 sem |

### Tier 3 — Antes de 100 clientes

Expanden la propuesta de valor a segmentos específicos (panaderías, delivery, eventos). Son grandes en esfuerzo pero abren mercado.

| # | Setting | Dominio | Hoy | Por qué importa | Esfuerzo |
|---|---|---|---|---|---|
| 16 | **Producción / Batch cooking** | 19.5.1 | ❌ | AMALAY tiene panadería activa. Sin producción formal, ~20% del negocio de AMALAY no tiene control de food cost. Wansoft tiene 26 stored procedures dedicados a esto. Es el módulo más complejo del inventario pero el más crítico para restaurantes con preparación. | 3-4 sem |
| 17 | **Costos adicionales por platillo** | 19.3.1 | ❌ | Packaging de delivery, gas de horneo, costo de barquillo en helados. Sin estos costos adicionales, el food cost de cualquier platillo con embalaje especial está subestimado sistemáticamente. Implementación: un campo numérico o un catálogo de overhead items. | 3 días |
| 18 | **Plantillas de conteo físico** | 18.8.1 | ⚠️ | Toma física ya existe. Lo que falta es la plantilla: "Conteo Semanal Barra" = 40 artículos, no los 500 del catálogo completo. Sin la plantilla, el conteo físico tarda demasiado y no se hace con frecuencia. | 3 días |
| 19 | **Marcas virtuales** | 22.3.1 | ❌ | Un restaurante con cocina subutilizada puede operar dos marcas en Rappi/UberEats desde la misma cocina. "La Nonna Gorditas Keto" ya existe como categoría en AMALAY — falta la separación formal de marca en el sistema. | 2 sem |
| 20 | **Tarjetas de regalo digitales** | 23.2.1 | ⚠️ | `/admin/tarjetas-regalo` ya existe en el build. La implementación parece parcial. Completar el flujo (QR en caja → validación → deducción de saldo) es el paso final. Para restaurantes con clientes frecuentes y gifting corporativo, es un canal de revenue anticipado. | 1 sem |

---

## 2. Settings que NO deberíamos implementar

Algunos settings existen en Wansoft no porque sean buenas ideas, sino porque Wansoft prefirió darle el toggle al usuario en lugar de tomar una decisión de diseño. Implementarlos en Fullsite sería copiar la deuda técnica disfrazada de funcionalidad.

### 2.1 Lector biométrico (DigitalPersona)

**Por qué no:** El lector de huella digital resuelve "los empleados no pueden marcar por otro" — pero introduce fricción operativa en entornos de cocina (dedos sucios, callosidades, manos mojadas). El distribuidor lo vendía como seguridad premium; en la práctica es un blocker de operación que los restaurantes eventualmente ignoran. 

**La alternativa correcta:** PIN + geolocalización desde app móvil. El empleado hace check-in desde su teléfono; el sistema verifica que esté en el radio del restaurante. Más seguro que el biométrico en condiciones de cocina, y no requiere hardware.

### 2.2 Audit log como checkbox

**Por qué no:** Que el audit log sea un checkbox activable/desactivable (AMALAY lo tenía en OFF) es la raíz del problema que la auditoría pretende resolver. Si el cajero puede apagar el registro de sus acciones, el registro no sirve.

**La alternativa correcta:** Audit log siempre activo, inmutable, almacenado en Supabase. No configurable. Este es un argumento de venta explícito: "Con Fullsite, ni el cajero ni el gerente pueden borrar el historial."

### 2.3 Cancelación retroactiva de ventas de días anteriores

**Por qué no:** Este flag existe en Wansoft para permitir devoluciones tardías legítimas. Pero la misma funcionalidad permite cancelar una venta del Z de ayer para quedarse con el efectivo. El mecanismo correcto para devoluciones no es modificar un registro histórico — es crear un nuevo documento (nota de crédito con CFDI de cancelación).

**La alternativa correcta:** Inmutabilidad de registros históricos como garantía del sistema. Toda corrección genera un nuevo documento que referencia al original. El contador puede ver la cadena completa. Es un argumento legal: "Tus registros son auditables e inalterables."

### 2.4 Configuración de base de datos local (depurar BD, límite de logs)

**Por qué no:** Estos settings existen porque Wansoft almacena los logs en la terminal local, que eventualmente se llena. En Fullsite los datos están en Supabase — no hay límite de almacenamiento local, no hay base de datos que depurar, no hay tamaño de BD que gestionar.

**La alternativa correcta:** No existe en Fullsite porque no es necesaria. Si algún día hay un costo de almacenamiento relevante, se maneja en la infraestructura, no como configuración del usuario.

### 2.5 Tipos de corte como selección manual

**Por qué no:** En Wansoft, el usuario decide qué tipo de corte hacer. El Corte Z en particular debería ser automático: el sistema fiscal del restaurante no puede depender de que alguien recuerde hacer el cierre del día.

**La alternativa correcta:** El Corte Z se genera automáticamente a la hora de cierre del restaurante (configurada en horarios). El dueño puede hacer un Corte X cuando quiera (parcial, sin cierre). El Corte Z automático elimina el riesgo de gaps en la numeración fiscal.

### 2.6 Ruteo de comanda por modo exclusivo (grupo XOR platillo)

**Por qué no:** En Wansoft, el ruteo puede ser por grupo O por platillo — y cambiar de modo destruye la configuración del otro. Esta exclusividad mutua es una limitación de implementación, no una decisión de diseño. Un restaurante debería poder tener algunos platillos con destino explícito (override individual) y el resto siguiendo la regla del grupo.

**La alternativa correcta:** El ruteo es jerárquico: el platillo tiene prioridad sobre el grupo. Si un platillo tiene destino explícito, ese destino se usa. Si no, sigue la regla del grupo. No hay exclusividad mutua — hay precedencia.

---

## 3. Settings que desaparecen gracias a la arquitectura de Fullsite

Estos no son settings que decidimos no implementar porque sean malos. Son settings que simplemente no existen cuando el sistema está bien diseñado. Wansoft los necesitaba porque su arquitectura los generaba. Fullsite no los necesita porque resuelve el problema de raíz.

### 3.1 "Configurar impresora en terminal" → la configuración es cloud

En Wansoft, las impresoras se configuran en cada terminal local. Si la terminal muere, la configuración desaparece. El técnico tiene que volver a instalar.

En Fullsite, las impresoras se registran una vez en el dashboard y se sincronizan a todas las terminales. Una terminal nueva se conecta y ya conoce las impresoras — sin configuración local. El setting "catálogo de impresoras por terminal" no existe porque la configuración está en la nube y es universal.

### 3.2 "Configuración primaria/secundaria manual" → failover automático

En Wansoft, el gerente define manualmente cuál es la impresora primaria y cuál la secundaria. Si la primaria falla, el sistema usa la secundaria — pero solo si alguien la configuró previamente.

En Fullsite, el sistema detecta automáticamente que la impresora primaria no responde y redirige a la secundaria. No hay configuración manual de failover — hay monitoreo de conectividad y redirección automática. El setting desaparece porque el sistema lo resuelve.

### 3.3 "Email de cortes" → Telegram es el canal, no es opción

Wansoft tiene un checkbox "enviar corte por email." AMALAY lo tiene en OFF porque el email de Wansoft es un PDF adjunto en desktop que nadie revisa.

En Fullsite, Telegram no es una alternativa al email — es la arquitectura de comunicación del sistema. El dueño ya está en Telegram, el orquestador ya corre, el briefing matutino ya llega. Agregar "¿canal de notificaciones?" como configuración implicaría que Telegram es opcional, cuando en realidad es el canal primario del sistema.

El setting no existe porque la decisión ya está tomada: Telegram primero, email como fallback para documentos formales (facturas, reportes PDF).

### 3.4 "Numeración consecutiva de Z" → es una invariante del sistema, no un setting

En Wansoft, la numeración del Z depende de que el cajero haga el corte correctamente. Si alguien se saltó el Z, hay un gap en la secuencia.

En Fullsite, el Z se genera automáticamente y la numeración es una invariante del sistema — la base de datos garantiza la secuencia. No es algo que el usuario configure; es algo que el sistema garantiza. La pregunta "¿numeración consecutiva activada?" no tiene sentido porque no puede estar desactivada.

### 3.5 "Audit log ON/OFF" → ya cubierto en sección 2.2

El audit log no es un setting porque no puede ser opcional. Ver sección 2.2.

### 3.6 "Impresora de etiquetadora vs comanda como tipos separados" → tipo como atributo, no como categoría de registro

En Wansoft, las etiquetadoras son un tercer tipo de periférico con configuración separada de las impresoras de comanda y de ticket.

En Fullsite, el tipo de impresora (tickets, comanda, etiquetas) es un atributo del registro de impresora en el catálogo, no una categoría de configuración independiente. Una impresora se registra una vez; su tipo determina sus capacidades y su rol en el sistema. El "módulo de etiquetadoras" desaparece porque se integra al catálogo de impresoras.

### 3.7 "RECIPE_ALIASES" y fallback manual de recetas → ya resuelto

El sistema anterior de RECIPE_ALIASES era un mapeo manual entre nombres de platillos en el POS y nombres de recetas en el inventario. Era un setting escondido en el código.

P1 (ya en producción, commit `93ebe89`) resolvió esto con `pos_menu_items.recipe_ref` + fuzzy fallback: el platillo conoce su receta por ID, y si no hay match exacto, el sistema busca el más cercano. El "mapeo de aliases" como configuración desaparece porque se convierte en un dato del catálogo de platillos, editable desde el POS.

---

## 4. Candidatos para el segundo pass

El segundo pass decidirá, para cada uno de estos settings, si debe:

- **Permanecer como Config:** el restaurante necesita controlar este parámetro manualmente
- **Convertirse en Auto:** el sistema puede aprender o calcular el valor correcto
- **Resolverse con IA operativa:** el valor óptimo cambia con el contexto y un modelo lo hace mejor que un número fijo

En este primer pass no tomamos esa decisión. Solo marcamos los candidatos donde la respuesta correcta no es obvia y requiere más contexto sobre cómo opera la red de restaurantes de Fullsite.

### Candidatos fuertes (el segundo pass cambia el diseño)

| Setting | Dominio | Qué tendrá que decidir el segundo pass |
|---|---|---|
| **Punto de reorden** | 18.5.1 | ¿El umbral lo fija el dueño o el sistema lo aprende del consumo histórico? Con 30+ restaurantes del mismo tipo, el sistema puede sugerir el punto de reorden basado en el percentil de restaurantes similares. |
| **Tiempo de preparación por plataforma** | 22.5.1 | ¿Lo captura el gerente o el sistema lo calibra automáticamente desde el tiempo real entre recepción de orden y confirmación de listo? El segundo caso elimina el setting completamente. |
| **Umbrales de alerta de food cost** | 19.4.1, 25.3.1 | ¿Fijo por sucursal o adaptativo al histórico del restaurante? Un umbral que se ajusta solo cuando el restaurante entra en temporada alta es más útil que uno fijo. |
| **Distribución de propinas** | 15.4.1 | ¿El dueño define el modelo o el sistema detecta el modelo que minimiza la rotación del equipo basándose en satisfacción y retención? Probablemente Config en el corto plazo, pero el segundo pass debe evaluar el potencial de sugerencia automática. |
| **Costos adicionales por platillo** | 19.3.1 | ¿El operador los captura manualmente o el sistema los puede inferir desde los registros de consumo de gas/electricidad si se integra con medidores? En el corto plazo es Config; en el largo plazo es Auto. |
| **Sugerencia de compras** | 20.2.1 | Las plantillas de OC son Config hoy. El segundo pass debe evaluar si el sistema puede proponer la OC completa (proveedor, cantidades, timing) desde el consumo histórico + punto de reorden + lead time del proveedor. |

### Candidatos moderados (el segundo pass puede dejarlo como Config)

| Setting | Dominio | Por qué podría quedarse como Config |
|---|---|---|
| **Fondo de caja** | 12.1.1 | El monto correcto depende del volumen de efectivo del restaurante, que varía por día de semana y temporada. El sistema podría sugerir un ajuste estacional, pero el dueño debe aprobar. |
| **Firebutton text** | 06.3.1 | Es texto libre que refleja la cultura del equipo ("FUEGO", "PREPARAR", "A LA LÍNEA"). Automatizar esto no agrega valor. |
| **Nombres de formas de pago custom** | 07.4.1 | "Claudia Sada" como forma de pago es tan específico del restaurante que ningún sistema puede inferirlo. Config permanente. |
| **Horas máximas de turno** | 13.3.1 | Depende de la estructura de turnos del restaurante. Un turno de 12 horas es normal en un restaurante de cena-noche; raro en una cafetería de desayunos. El segundo pass puede sugerir el valor basado en el historial de duración real de turnos. |
| **Variación aceptable de costo por proveedor** | 18.6.1 | La tolerancia depende del ingrediente y de la relación con el proveedor. El sistema puede detectar la variación histórica de cada ingrediente y sugerir un umbral razonable, pero la aprobación es del dueño. |

### Candidatos que probablemente desaparecen en el segundo pass

| Setting | Dominio | Por qué probablemente se elimina |
|---|---|---|
| **Alertas intraday configurables** | 25.3.2 | El sistema ya tiene el historial para detectar automáticamente cuando las ventas están por debajo del percentil 25 del mismo día de la semana. La pregunta del segundo pass es si existe algún caso donde el dueño necesite cambiar ese umbral manualmente — probablemente no. |
| **Canal de entrega de alertas** | 25.1.1 | Si Telegram es la arquitectura de comunicación del sistema (ver sección 3.3), el "canal de alertas" no es un setting del usuario — es una invariante del sistema. El segundo pass debe confirmar si hay casos donde un restaurante genuinamente no quiere Telegram. |
| **Modelos de IA por tarea** | 26.1.2 | Es configuración de infraestructura, no de operación. El restaurante no debería necesitar decidir qué modelo usa el agente de anomalías. El segundo pass debe confirmar que este es un setting interno de Fullsite, no expuesto al cliente. |

---

## Síntesis

Tres decisiones de producto que este análisis hace evidentes:

**1. El fraud prevention stack es incompleto.**
Escalation in-place con log de quién autorizó, cambio de forma de pago post-cobro con audit trail, y apertura formal de turno son tres piezas de un mismo sistema de control de caja que están desconectadas hoy. Las tres son Tier 1 porque sin ellas, el audit log permanente (la ventaja estructural de Fullsite vs Wansoft) no tiene suficiente contexto para detectar patrones.

**2. La configuración es mejor cuando protege al usuario de sus propios errores.**
Los mejores settings del inventario no son los que dan más opciones — son los que protegen de escenarios donde el usuario tomaría la decisión incorrecta: apertura de turno (protege al cajero), cambio de forma de pago con PIN (protege al dueño), audit log siempre activo (protege al negocio). El diseño debe preferir buenos defaults sobre más opciones.

**3. El segundo pass es sobre dónde el sistema puede aprender mejor que el humano.**
No todos los settings son candidatos — solo los que tienen un historial de datos suficiente para que el sistema pueda calcular el valor correcto. Punto de reorden, tiempo de preparación, y umbrales de alerta son los tres más claros. El criterio del segundo pass es simple: si el valor óptimo cambia con el tiempo y el sistema tiene los datos para saberlo, el toggle no debería existir.

---

> Settings Bible: `docs/bibles/FULLSITE-SETTINGS-BIBLE.md`
> Backlog de producto derivado: ver Tier 1-3 de la sección 1 de este documento
> Próximo paso sugerido: convertir el Tier 1 en tickets de implementación
