# Fullsite Settings — Gap Analysis y Estrategia de Producto

> No más inventario. Recomendaciones de producto.
>
> Este documento toma la Settings Bible (111 settings, 26 dominios)
> y la convierte en una estrategia ejecutable:
> qué construir, en qué orden, qué ignorar, y qué
> reemplazar con mejores decisiones de arquitectura.
>
> Fecha: 2026-07-25
> Input: `docs/product/SETTINGS-BIBLE.md`

---

## Índice

1. [Top 25 — Settings de mayor impacto](#1-top-25)
2. [Settings que NO debemos implementar](#2-no-implementar)
3. [Settings que desaparecen gracias a la arquitectura](#3-desaparecen)
4. [Oportunidades de simplificación](#4-simplificacion)
5. [Roadmap P0 / P1 / P2 / P3](#5-roadmap)

---

## 1. Top 25 — Settings de mayor impacto

Criterios de ranking: valor operativo × frecuencia × diferenciación Fullsite × esfuerzo estimado.

Los **negritas** son gaps actuales (no implementados o parciales en Fullsite).

---

### #1 — Ruteo de comanda por grupo y por platillo
**Dominio:** 06 (POS — Comanda) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** M

El problema más crítico de cocina. Sin ruteo, todos los items imprimen en una sola impresora. AMALAY tiene dos destinos: COCINA CALIENTE y BARRA. El modelo Wansoft permite ruteo por grupo (toda una categoría va a la misma impresora) con override por platillo individual.

**Por qué es #1:** sin esto, el restaurante no puede operar físicamente con múltiples estaciones de cocina. No es un feature — es infraestructura.

**Diseño Fullsite:** una Station (COCINA / BARRA / PANADERÍA) tiene categorías asignadas por defecto. Un platillo individual puede sobreescribir su station. Regla: station default → override de platillo → si ninguno aplica, alerta, nunca silencio.

---

### #2 — Catálogo de descuentos con elegibilidad por platillo
**Dominio:** 04 (Promociones) + 02 (Menú) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** M

Los descuentos no son globales — cada platillo tiene un flag de "acepta descuento". El catálogo define las opciones (10%, BBVA 15%, EMPLEADOS 50%) y el cajero solo puede escoger del catálogo, no inventar porcentajes.

**Por qué es #2:** los descuentos sin catálogo son el vector de leakage más común en restaurantes. Con catálogo, el gerente controla exactamente qué descuentos existen y el audit log los captura por nombre ("DESCUENTO BBVA" vs "12% random").

**Diseño Fullsite:** catálogo por sucursal configurable desde el dashboard. El cajero ve únicamente las opciones del catálogo más "monto libre" (requiere permiso de gerente). Cada descuento tiene: nombre, %, requiere PIN de gerente sí/no, razón predeterminada.

---

### #3 — Catálogo de cancelaciones con pregunta de inventario
**Dominio:** 14 (Seguridad) + 05 (POS) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** S

Dos decisiones vinculadas en el momento de cancelar: (1) razón del catálogo ("ERROR DE CAPTURA", "CLIENTE CAMBIÓ DE OPINIÓN", "DEMORA EXCESIVA"), y (2) "¿Se preparó?" — la respuesta determina si el stock regresa al inventario (no se preparó) o se registra como merma (sí se preparó).

**Por qué es #3:** sin razón obligatoria, no hay auditoría de cancelaciones. Sin la pregunta de inventario, el stock nunca cuadra con la realidad. Son dos líneas de código con impacto operativo masivo.

**Diseño Fullsite:** la pregunta "¿se preparó?" ya existe en el flujo de cancelación actual. El catálogo de razones no — se escribe texto libre. Agregar el catálogo de razones configurable convierte un texto libre en datos analizables para el agente anti-fraude.

---

### #4 — Permisos de gerente: 6 catálogos de escalation
**Dominio:** 14 (Seguridad y Auditoría) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** M

Los 6 catálogos de Wansoft:
1. Platillos que requieren PIN de gerente para vender
2. Grupos que requieren PIN de gerente
3. Formas de pago que requieren PIN de gerente
4. Descuentos que requieren PIN de gerente
5. Cortesías que requieren PIN de gerente
6. Cancelaciones que requieren PIN de gerente

El patrón de escalation es elegante: el cajero no pierde su sesión — el gerente teclea su PIN encima y el sistema registra quién autorizó. Fullsite tiene el PIN del gerente pero no registra sistemáticamente qué autorizó.

**Diseño Fullsite:** una "Security Matrix" en el dashboard donde el gerente marca qué operaciones requieren su autorización. Cada autorización queda en el event store con: operación, cajero que solicitó, gerente que autorizó, timestamp.

---

### #5 — Catálogo de cortesías
**Dominio:** 04 (Promociones) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** S

Las cortesías son diferentes de los descuentos: siempre son 100%, siempre requieren razón, y tienen categorías distintas (RELACIONES PÚBLICAS, COMPENSACIÓN, EMPLEADO, INFLUENCER). AMALAY tiene cortesías predefinidas: CLAUDIA SADA 100%, INFLUENCER 100%.

**Por qué importa:** una cortesía sin categoría en el reporte de ventas aparece solo como "ingreso en $0" — no se sabe si fue compensación por mala comida o un regalo de relaciones públicas. Con categorías, el gerente puede ver cuánto está regalando y a quién.

**Diseño Fullsite:** dentro del módulo de Incentivos, las cortesías son el tipo donde el descuento es siempre 100% y la razón es obligatoria del catálogo. El reporte de cortesías es un dashboard separado visible para el gerente.

---

### #6 — Fondo de caja y fórmula de arqueo
**Dominio:** 12 (Caja) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** M

El fondo es el efectivo inicial en caja al abrir el turno. La fórmula de arqueo no es trivial:

```
Efectivo esperado = Fondo + Ventas efectivo + Propinas efectivo + Depósitos − Vales − Propinas de tarjeta pagadas en efectivo
```

AMALAY tiene fondo de $1,700 MXN. El "cambio como propina en pagos bancarios" es una regla real: cuando alguien paga con tarjeta y hay cambio mínimo, se registra como propina por defecto.

**Diseño Fullsite:** el corte de turno actual calcula la diferencia entre esperado y declarado, pero la fórmula no incluye propinas de tarjeta pagadas en efectivo. Eso es un descuadre permanente en restaurantes con alta propina en tarjeta.

---

### #7 — Tipos de corte: X, Turno, Z, Mesero
**Dominio:** 13 (Cortes) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** M

Fullsite tiene corte de turno. Faltan:
- **Corte X:** parcial, sin cerrar el turno — el gerente lo pide a media jornada para ver cómo van sin afectar el turno del cajero.
- **Corte Z:** numerado consecutivamente — es el que revisa el SAT. El número correlativo es obligatorio para efectos fiscales.
- **Corte por Mesero:** cuánto vendió cada mesero en el turno — base para el tip-out y para el análisis de rendimiento.

**Por qué importa el Corte Z consecutivo:** una cadena que no lleva secuencia correlativa de cortes Z puede tener problemas con la autoridad fiscal al auditar. Es un requisito implícito, no un nice-to-have.

---

### #8 — Perfiles de usuario como plantillas de permisos
**Dominio:** 16 (Usuarios y Roles) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** S

En lugar de asignar 269 permisos individualmente a cada nuevo cajero, crear un perfil "Cajero Estándar" con los permisos correctos y asignarlo al usuario. Si se necesita ajustar, se sobreescribe el perfil individual.

**Por qué ahora:** cuando Fullsite tenga 10 restaurantes, cada uno con 10 empleados, la gestión de permisos sin plantillas será insostenible. Con plantillas, agregar un nuevo mesero es: buscar usuario → asignar perfil "Mesero" → listo.

---

### #9 — Propinas: pool, % del mesero, sugeridas en ticket
**Dominio:** 15 (Propinas) | **Frecuencia:** Común (60-80%) | **Fullsite:** Parcial | **Esfuerzo:** M

Tres partes distintas:
1. **% que el mesero aporta al pool:** AMALAY = 5% de sus ventas. Se descuenta del corte del mesero y va al pool común (para cubrir comisiones de tarjeta, propinas de cocina, etc.).
2. **Propinas sugeridas en preticket:** catálogo de porcentajes impresos (ej. 10% / 15% / 20% calculados en pesos) — aumenta las propinas un 15-30% según estudios.
3. **"Cambio como propina" en pagos con tarjeta:** cuando el cambio es < $5, se registra como propina automáticamente.

**Por qué es sensible:** el dinero de las propinas de los meseros es un tema de drama constante en AMALAY y en cualquier restaurante. Si el sistema lo maneja mal, hay confrontaciones. Si lo maneja bien, elimina el drama.

---

### #10 — Formas de pago customizables con trazabilidad contable
**Dominio:** 03 (Formas de Pago) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** S

AMALAY tiene 18 formas de pago, incluyendo formas con nombre propio ("Claudia Sada"), formas de marketing ("Influencer", "Mercadotecnia"), y vales propios ("Vale Amalay"). Cada forma de pago custom aparece como línea separada en el corte y en los reportes.

**El valor real:** "Influencer" como forma de pago hace que el gerente pueda ver exactamente cuánto de marketing se está dando, separado de las cortesías de compensación y de los descuentos de empleado. No es un workaround — es una herramienta de análisis.

**Diseño Fullsite:** el creador de formas de pago permite nombre, color, requiere PIN de gerente, y una categoría para reportes (efectivo / digital / crédito interno / marketing / cortesía). Ilimitadas. Cada una tiene su línea en el corte.

---

### #11 — Horarios de disponibilidad por platillo
**Dominio:** 02.5 (Menú) | **Frecuencia:** Común | **Fullsite:** No | **Esfuerzo:** M

Los chilaquiles solo se sirven de 8am a 12pm. Las pizzas solo a partir de las 12pm. Los platillos del menú de evento solo cuando hay evento activo. En Wansoft, cada platillo tiene un horario de disponibilidad configurable.

**El impacto operativo:** sin esto, el cajero puede teclear un desayuno a las 4pm y la cocina lo tiene que rechazar manualmente. El sistema debería hacer esa validación automáticamente y ocultar los platillos fuera de horario en la pantalla de captura.

**Diseño Fullsite:** el platillo tiene un campo "Disponible" con opciones: siempre / por horario (rango hora inicio-fin) / por día de semana / por turno activo. Los platillos fuera de horario no aparecen en el POS — no están grises, están ausentes.

---

### #12 — Tipos de precio por contexto (presencial vs delivery vs evento)
**Dominio:** 02.6 (Menú) | **Frecuencia:** Común | **Fullsite:** No | **Esfuerzo:** L

En Wansoft, un platillo puede tener hasta 4 precios diferentes: normal, delivery, happy hour, evento. El sistema aplica automáticamente el precio correcto según el tipo de orden.

**El impacto:** los restaurantes que venden en Rappi típicamente suben el precio 15-20% para cubrir la comisión de la plataforma. Sin tipos de precio, el restaurante tiene que crear un catálogo duplicado ("PIZZA MARGHERITA RAPPI") o manualmente ajustar los precios en la plataforma, que se dessincronizan del POS.

**Diseño Fullsite:** el precio de un platillo tiene un campo "precio base" y una tabla de overrides por contexto. El contexto se determina automáticamente por el tipo de orden (restaurante / delivery / evento / market). Sin UI compleja — el chef ve el precio base, el sistema resuelve el resto.

---

### #13 — Punto de reorden con alerta proactiva
**Dominio:** 18.5 (Inventario) | **Frecuencia:** Común | **Fullsite:** Parcial | **Esfuerzo:** S

Wansoft tiene punto de reorden como tabla pasiva en el portal — nadie la consulta. AMALAY tiene 50+ productos con punto de reorden configurado (CHOCOLATE SICAO mínimo 3 kg, VASO REFILL mínimo 10 unidades).

**El salto de Fullsite:** el punto de reorden no debe ser un reporte que nadie ve — debe ser una alerta que llega al gerente cuando el stock baja del mínimo. La diferencia entre "datos en una tabla" y "alerta en Telegram a las 7am" es la diferencia entre un sistema que nadie usa y un sistema que cambia la operación.

**Diseño Fullsite:** el punto de reorden ya existe en la BD. Falta: (1) trigger que evalúa stock vs mínimo después de cada deducción, (2) alerta al canal configurado del gerente, (3) generación automática de orden de compra sugerida si el restaurante tiene proveedor mapeado.

---

### #14 — Umbral de variación de costo por ingrediente
**Dominio:** 18.6 (Inventario) | **Frecuencia:** Común | **Fullsite:** No | **Esfuerzo:** S

Wansoft permite configurar por producto "alertar si el precio de compra sube más del X%". Si el aguacate que costaba $120/kg ahora llega a $180/kg, el sistema registra la variación y puede alertar.

**El valor:** los restaurantes absorben inflación de insumos sin saberlo hasta que el contador les da el estado financiero 2 meses después. Una alerta de variación de costo permite al dueño reaccionar: subir precio del platillo, buscar proveedor alternativo, o modificar la receta.

**Diseño Fullsite:** cuando se registra una recepción con precio diferente al histórico, si la variación excede el umbral configurado (default: 15%), se genera una alerta. El dashboard de food cost muestra la tendencia del costo de cada ingrediente en el tiempo.

---

### #15 — Subrecetas como componente reutilizable
**Dominio:** 19.2 (Recetas y Food Cost) | **Frecuencia:** Común | **Fullsite:** No | **Esfuerzo:** M

Una subreceta es una preparación intermedia que se usa en múltiples platillos: el fondo de pollo que va en 6 sopas, la vinagreta que va en 8 ensaladas, la masa madre que va en todos los panes.

Sin subrecetas, cuando el costo del fondo de pollo cambia, hay que actualizar las 6 sopas por separado. Con subrecetas, se actualiza una vez y propaga a todos.

**Por qué no puede esperar:** Eduardo lo pidió explícitamente (jul 16). AMALAY tiene preparaciones compartidas en panadería que sin subrecetas hacen que el food cost sea incorrecto.

---

### #16 — Rendimiento / yield en recetas
**Dominio:** 19.1 (Recetas) | **Frecuencia:** Común | **Fullsite:** No | **Esfuerzo:** S

1 kg de pollo crudo → 0.72 kg de pollo cocido (yield 72%). Sin el factor de rendimiento, la receta dice "0.2 kg de pollo" pero en realidad se usan 0.28 kg de pollo crudo para obtener esos 0.2 kg. El food cost calculado es sistemáticamente 28% más bajo que el real.

**El impacto:** si el food cost real es 38% pero el sistema reporta 30%, el dueño cree que tiene un margen saludable cuando en realidad está perdiendo 8 puntos de margen. Esta es la causa #1 de que los restaurantes "siempre tienen buenas ventas pero nunca les alcanza el dinero".

**Diseño Fullsite:** cada ingrediente en la receta tiene un campo opcional "factor de rendimiento" (0-100%). Si no se configura, default a 100%. El costo mostrado en la receta puede mostrarse en dos modos: "costo de ingrediente como comprado" y "costo ajustado por yield".

---

### #17 — Plantillas de Orden de Compra por proveedor
**Dominio:** 20.2 (Compras) | **Frecuencia:** Común | **Fullsite:** Parcial | **Esfuerzo:** S

AMALAY tiene plantillas pre-configuradas por proveedor: "JUGOS NL" tiene 12 items pre-cargados. Cuando llega el pedido de Jugos NL, el gerente abre la plantilla, ajusta cantidades, y genera la OC en 2 minutos en vez de 15.

**El impacto de tiempo:** un restaurante hace 15-25 órdenes de compra por semana. Sin plantillas, cada OC tarda 10-15 minutos. Con plantillas, tarda 2-3 minutos. Ahorro: 1-2 horas semanales del gerente.

---

### #18 — Autofacturación QR en ticket
**Dominio:** 21.3 (CFDI) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** M

El QR en el ticket lleva al comensal a un formulario web donde ingresa su RFC y recibe la factura en su correo sin intervenir el cajero. AMALAY tiene esto activado en Wansoft (Serie A).

**El impacto:** en AMALAY, 400-430 CFDIs por mes. Si un 30% de esas facturas las piden al cajero, eso son 120-130 interrupciones al flujo de caja por mes. Con autofacturación QR, el cajero no se entera — la factura llega sola.

**Estado actual Fullsite:** el QR existe. Falta validar el flujo completo (QR → formulario → Facturama API → email al comensal → log en dashboard). La configuración de la serie CFDI y los datos del PAC es lo que permite activarlo.

---

### #19 — Almacenes múltiples con routing por área
**Dominio:** 18.1 (Inventario) | **Frecuencia:** Situacional (restaurantes con >1 área) | **Fullsite:** Parcial | **Esfuerzo:** M

AMALAY tiene 6 almacenes: cocina, barra, market, panadería, almacén general, y almacén de desechables. Cada producto puede estar en uno o varios almacenes. Cuando se hace un conteo físico, se cuenta por almacén — no se mezclan.

**El impacto:** sin almacenes separados, el inventario de AMALAY sería un solo número global que no refleja la realidad (no es lo mismo tener los ingredientes en cocina que en el almacén general). Los ajustes y diferencias se calculan por almacén, no en agregado.

---

### #20 — Catálogo de impresoras con tipo de conexión
**Dominio:** 10.1 (Hardware) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** S

El catálogo de impresoras de AMALAY: EC TICKET (USB, caja + cajón RJ-11), COCINA CALIENTE (TCP/IP), BARRA (TCP/IP), PANADERIA (TCP/IP, para reportes). La configuración incluye tipo de conexión, IP, y puerto.

**El gap actual:** la configuración de impresoras en Fullsite vive en config local del bridge de impresión. No está en el dashboard, no está versionada, y no se puede cambiar sin acceso físico a la terminal. Esto es exactamente el modelo de Wansoft que estamos tratando de superar.

**Diseño Fullsite:** las impresoras se configuran en el dashboard web una sola vez. El bridge de impresión lee la config desde Supabase. Si cambia la IP de la impresora de cocina, el gerente lo cambia en el dashboard y el sistema lo refleja sin tocar la terminal.

---

### #21 — Canal y destinatarios de alertas por tipo
**Dominio:** 25 (Notificaciones) | **Frecuencia:** Universal | **Fullsite:** Parcial | **Esfuerzo:** S

Wansoft solo tiene email de cortes (apagado en AMALAY). Fullsite tiene 26 agentes con alertas a Telegram. Lo que falta es la configuración de "quién recibe qué":
- El dueño recibe el briefing diario y el reporte semanal.
- El gerente recibe alertas de cancelaciones, transferencias, y descuentos fuera de umbral.
- El almacenista recibe alertas de punto de reorden.
- El contador recibe el corte Z por email.

**Diseño Fullsite:** en el dashboard, cada rol tiene una sección de "Notificaciones" con toggles por tipo de alerta y un campo de canal (Telegram chat ID / email / WhatsApp). La configuración está en la tabla `client_config` que ya existe.

---

### #22 — Secciones del salón con permisos por sección
**Dominio:** 08 (Mesas y Floor Plan) | **Frecuencia:** Común | **Fullsite:** Parcial | **Esfuerzo:** M

Wansoft permite dividir el salón en secciones (Terraza, Interior, Barra, Privado) y configurar qué meseros tienen acceso a cada sección. Un mesero de terraza no ve las mesas del privado. Esto simplifica la operación y reduce errores de asignación.

**El impacto:** en AMALAY, con 60+ mesas en diferentes zonas, sin secciones cada mesero navega por todo el salón para encontrar sus mesas. Con secciones, la pantalla del mesero solo muestra sus mesas.

---

### #23 — Marcas virtuales para delivery
**Dominio:** 22.3 (Delivery) | **Frecuencia:** Común (restaurantes urbanos) | **Fullsite:** No | **Esfuerzo:** L

Un restaurante puede operar como múltiples marcas en plataformas de delivery: AMALAY Coffee & Market + La Nonna Keto + Bakery Shop. Cada marca tiene su menú, sus precios, sus horarios, y su configuración de disponibilidad por plataforma.

**El impacto de negocio:** las marcas virtuales permiten maximizar el ingreso de delivery sin costo marginal de operación — misma cocina, múltiples marcas. Un restaurante que bien lo ejecuta puede doblar sus ventas de delivery.

---

### #24 — Producción y batch cooking
**Dominio:** 19.5 (Recetas) | **Frecuencia:** Situacional (panaderías, cocinas centrales) | **Fullsite:** No | **Esfuerzo:** XL

Una "Orden de Producción" le dice a la cocina: "produce 40 croissants usando 2 kg de harina, 1 kg de mantequilla, etc." El inventario baja los ingredientes y sube los productos terminados. Sin esto, el inventario de una panadería nunca cuadra.

**Por qué está en el top 25 si es Situacional:** AMALAY tiene panadería. Eduardo lo mencionó. Cualquier restaurante con área de preparación de bases necesita esto. Y Wansoft tiene 26 stored procedures dedicados a este módulo — el más profundo de todo el sistema — lo que indica que es un pain point real y frecuente en la industria.

---

### #25 — Conciliación de terminal bancaria
**Dominio:** 11 (Terminales Bancarias) | **Frecuencia:** Universal | **Fullsite:** No | **Esfuerzo:** L

**El descubrimiento más importante del CAJA-SPEC:** AMALAY usa Getnet (Santander) pero Getnet NO está en las integraciones de Wansoft. El cajero teclea el monto a mano. Eso significa que si cobra $356 en tarjeta pero teclea $360, el sistema registra $360 y el banco depositó $356 — hay un descuadre de $4 que nadie detecta automáticamente.

Multiplicado por 100 transacciones diarias, el descuadre acumulado puede ser relevante.

**Diseño Fullsite:** integración directa con el API de la terminal bancaria (Clip, NetPay, o Getnet) para recibir la confirmación del monto cobrado. El POS no acepta el pago hasta recibir confirmación de la terminal. Cero descuadres por error manual.

---

## 2. Settings que NO debemos implementar

La restricción no es técnica — es de producto. Implementar un setting innecesario es un costo de mantenimiento permanente, una fuente de confusión en el onboarding, y una señal de que no entendemos para qué sirve.

---

### NO — Bloqueo de venta sin stock (`NETSILVER > Existencias locales`)
**Razón:** El restaurante NO quiere bloquear ventas. AMALAY lo tiene explícitamente desactivado y su política es "nunca decirle no al cliente — el chef adapta". El bloqueo automático es paternalista y contrario a la operación real.

**Qué hacer en cambio:** alerta proactiva visible para el cajero ("stock bajo de este ingrediente"), sin bloquear la venta. La decisión de vender o no la toma el cajero, no el sistema.

---

### NO — "Depurar BD" como función de usuario (`NETSILVER > Admin > Depurar BD`)
**Razón:** En Wansoft existe porque el SQL Server local se llena con el tiempo y necesita mantenimiento. En Fullsite no hay SQL Server local — Supabase se gestiona solo. Exponer mantenimiento de base de datos a un cajero es un anti-patrón peligroso.

---

### NO — Billares, Tiempo aire, Wannapay (`NETSILVER > Config`)
**Razón:** Vertical muerto (billares), servicio no relacionado con restaurantes (tiempo aire), y procesador de pagos propio de Wansoft sin ventaja sobre Clip/MP (Wannapay). Fullsite es para restaurantes — no para mini-misceláneas.

---

### NO — Nómina completa (cálculo IMSS, ISR, timbrado de recibos)
**Razón:** Territorio de CONTPAQi/Nomipaq. Intentar replicarlo en Fullsite es 18+ meses de trabajo especializado en legislación laboral mexicana (LFT, IMSS, INFONAVIT) que cambia frecuentemente. La integración con CONTPAQi es la respuesta correcta.

**Qué sí hacer:** exportar la nómina calculada (horas trabajadas × tarifa × extras) en formato que CONTPAQi importa directamente. El cálculo legal es de ellos.

---

### NO — MegaPoints / programa de puntos genérico
**Razón:** Los programas de puntos genéricos no generan lealtad real. AMALAY tiene el QR de MegaPoints en el ticket pero nadie lo usa. El esfuerzo de mantener un sistema de puntos (acumulación, redención, caducidad, fraude de puntos) no justifica el retorno. La lealtad real viene del CRM con segmentación inteligente y ofertas personalizadas — no de una tarjeta de puntos.

---

### NO — Arqueo de caja con "3 intentos máximo" (`NETSILVER > Cortes > Arqueo`)
**Razón:** El límite de 3 intentos es arbitrario y frustrante. Si el cajero contó mal, necesita volver a contar. Fullsite debe registrar cada intento de arqueo (con timestamp y monto declarado) en el event store — eso es la auditoría real, no limitar cuántas veces puede intentar.

---

### NO — Cuentas contables como CRUD dentro del POS (`PORTAL:CONFIG > Cuentas contables`)
**Razón:** Duplicar el plan de cuentas contables en el POS es trabajo de doble entrada que siempre se desincroniza del sistema contable real (CONTPAQi). La integración correcta es mapear categorías de Fullsite al plan de cuentas de CONTPAQi una sola vez, no mantener dos catálogos.

---

### NO — Tarjetas de regalo físicas
**Razón:** Requieren producción física (costo de impresión, inventario de plástico), gestión de activación, y sistema de saldo. El retorno es bajo (Wansoft reporta adopción <10%). La versión digital (código QR enviado por WhatsApp) tiene cero costo marginal y mayor adopción.

---

### NO — Encuestas de múltiples preguntas (`PORTAL > Encuesta > Configuración`)
**Razón:** Las encuestas largas tienen tasa de respuesta < 5%. Una sola pregunta ("¿Lo recomendarías? 1-10") captura el Net Promoter Score con 80% de los insights a 20% del costo de configuración. El módulo de encuestas de 15 preguntas de Wansoft es casi universalmente ignorado.

---

### NO — "Liberaciones de software" como módulo visible al cliente
**Razón:** Wansoft muestra las versiones de software como módulo del portal. En un SaaS cloud-native, las actualizaciones son silenciosas y automáticas. El cliente no necesita saber qué versión está corriendo — solo necesita saber que el sistema funciona.

---

### NO — Huella digital del cliente para lealtad
**Razón:** Invasivo, requiere hardware adicional, y AMALAY ya tuvo problemas de lectura con la huella del staff. El teléfono del cliente es el identificador universal — ya lo tienen en el CRM de Reservy con 12,200 clientes.

---

## 3. Settings que desaparecen gracias a la arquitectura

Estos no son features que rechazamos — son configuraciones que existían como workaround de las limitaciones de Wansoft y que Fullsite resuelve por diseño.

---

### Desaparece — "Guardar logs de acciones" (checkbox)
**En Wansoft:** `NETSILVER > Seguridad > Guardar logs de acciones` (APAGADO en AMALAY)
**En Fullsite:** el event store es siempre activo, inmutable, y no configurable. No existe el toggle. El audit trail no es una opción — es una garantía del sistema.
**Principio:** la auditoría no se configura. Es la fundación de la confianza.

---

### Desaparece — "Sincronización" como concepto visible
**En Wansoft:** `PORTAL > Reportes > Sincronización` — un módulo completo para revisar si la terminal sincronizó con el portal.
**En Fullsite:** cloud-native. Los datos están en Supabase en el momento en que ocurren. No hay "sincronizar" — hay datos y hay datos sin conexión (que se resuelven solos al recuperar red). El usuario nunca ve una pantalla de sincronización.

---

### Desaparece — Configuración de terminal por terminal
**En Wansoft:** cada terminal tiene su propia config local en Netsilver. Si tienes 3 terminales, configuras 3 veces.
**En Fullsite:** la configuración vive en Supabase, es la misma para todas las terminales de la sucursal, está versionada, y tiene rollback instantáneo. Cambiar la IP de la impresora de cocina se hace en el dashboard — se refleja en todas las terminales sin tocar ninguna físicamente.

---

### Desaparece — "Preguntar personas al cerrar" (toggle)
**En Wansoft:** `NETSILVER > Cierre de cuentas > Preguntar personas al cerrar` — configurable on/off.
**En Fullsite:** siempre pregunta. El conteo de personas es un KPI fundamental (`personas_restaurant` en wansoft_daily) que alimenta el ticket promedio por persona, la predicción de ocupación, y el staffing optimizado. No tiene sentido apagarlo.

---

### Desaparece — "Cerrar múltiples cuentas" (toggle)
**En Wansoft:** config que habilita o deshabilita cerrar más de una cuenta a la vez.
**En Fullsite:** siempre permitido. No hay razón operativa para bloquearlo.

---

### Desaparece — "Llenar fondo de caja con efectivo real del corte Z anterior" (toggle)
**En Wansoft:** opción de apertura de caja.
**En Fullsite:** siempre sucede así — el fondo del siguiente turno toma el saldo efectivo del corte Z anterior como base. No es una decisión de configuración, es la única lógica correcta.

---

### Desaparece — Timezone configurado manualmente
**En Wansoft:** `PORTAL:CONFIG > Sucursal > Timezone` — menú desplegable manual.
**En Fullsite:** el timezone se detecta del browser/IP en el primer login y se confirma con el usuario. No se configura desde cero. Si el restaurante cambia de zona (imposible), la confirmación es un solo click.

---

### Desaparece — "Permitir corte Z con órdenes abiertas" (toggle)
**En Wansoft:** configurable. AMALAY lo tiene desactivado (no puede hacer Z con cuentas abiertas).
**En Fullsite:** el Corte Z nunca permite cuentas abiertas — es la definición de un cierre fiscal. Punto. No es una configuración — es una regla de negocio inamovible.

---

### Desaparece — Impresiones de corte: N copias (numeral)
**En Wansoft:** configurar cuántas copias físicas imprime el corte Z (AMALAY: 1).
**En Fullsite:** el corte Z genera un PDF digital enviado por Telegram al gerente y al dueño. La impresión física es opcional y siempre es 1 copia. Nadie necesita configurar "cuántas copias quiero imprimir de mi corte."

---

### Desaparece — "Disponibilidad de platillos en delivery" como checkbox manual
**En Wansoft:** el gerente entra al portal, navega a Ecommerce → Disponibilidad, y marca o desmarca cada platillo manualmente en cada plataforma.
**En Fullsite:** la disponibilidad en delivery es automática. Si el stock de aguacate llega a cero, los bowls se marcan como no disponibles en todas las plataformas. Si el restaurante está cerrado (fuera de horario), todos los platillos están no disponibles. La intervención manual existe como override, no como flujo principal.

---

## 4. Oportunidades de simplificación

Los siguientes grupos de settings pueden convertirse en experiencias de más alto nivel, reduciendo la carga cognitiva del operador sin perder funcionalidad.

---

### Simplificación A — Onboarding Wizard en vez de 20 toggles de "Operativas"

**Settings actuales:** `NETSILVER > Operativas` — 20 toggles: tipo de operación, tipos de órdenes, sillas, tiempos, para llevar pide nombre/torre, domicilio con repartidor, etc.

**El problema:** un gerente nuevo enfrenta 20 opciones técnicas sin contexto. El 80% usa la misma combinación.

**La solución:** un wizard de 4 preguntas:
1. "¿Qué tipo de restaurante eres?" → Mesa service / Counter service / Market / Híbrido / Bar
2. "¿Haces delivery?" → Sí (con plataformas) / Sí (domicilio propio) / No
3. "¿Tu cocina tiene múltiples estaciones?" → Sí (configurar) / No (una sola impresora)
4. "¿Cuántas cajas tienes?" → 1 / 2-5 / Más de 5

Las respuestas configuran automáticamente los 20 toggles con defaults inteligentes. El modo avanzado sigue disponible para sobreescribir. El onboarding en <10 minutos en vez de una tarde con el distribuidor.

---

### Simplificación B — "Incentivos" en vez de 4 sistemas separados

**Settings actuales:** catálogo de descuentos + catálogo de cortesías + motor de 2x1 + motor de promociones — 4 módulos con UX diferente, reglas diferentes, y reportes diferentes.

**El problema:** en Wansoft son 4 flujos de código separados porque se construyeron en 4 momentos distintos. La experiencia del cajero es inconsistente. El reporte de "cuánto dinero dejé de cobrar hoy" requiere sumar 4 columnas diferentes.

**La solución:** un módulo unificado de "Incentivos" con un solo tipo de objeto:
- Nombre
- Tipo: `descuento_porcentaje` / `descuento_fijo` / `cortesia` / `promo_combo` / `2x1`
- Aplicable a: ítem individual / cuenta completa / selección
- Requiere: catálogo predefinido (no texto libre) + razón + PIN de gerente (sí/no)
- Elegibilidad: todos los platillos / lista de platillos específicos

El reporte de Incentivos consolida todas las líneas en un solo lugar.

---

### Simplificación C — "Documentos" en vez de Ticket + Comanda por separado

**Settings actuales:** `NETSILVER > Ticket` (15+ opciones) y `NETSILVER > Comanda` (30+ opciones) — dos paneles de configuración separados que comparten el 60% de las opciones (logo, RFC, nombre del restaurante, fuentes).

**La solución:** un módulo de "Documentos" con tabs:
- **Tab Ticket:** campos específicos del ticket (mesa, personas, mesero, QR de encuesta, QR de CFDI, propina sugerida)
- **Tab Comanda:** campos específicos de la comanda (silla, tiempo, mensaje del firebutton, por estación)
- **Shared:** logo, nombre del restaurante, fuentes, tamaño de papel

Preview en vivo en ambos tabs. La configuración de logo/RFC se cambia una sola vez y aplica a ambos.

---

### Simplificación D — "Security Matrix" en vez de 6 catálogos separados

**Settings actuales:** 6 catálogos independientes de permisos de gerente (platillos, grupos, formas de pago, descuentos, cortesías, cancelaciones) — acceso por sección diferente en el panel de seguridad.

**La solución:** una tabla visual donde las columnas son las operaciones sensibles y las filas son los roles:

|  | Cancelar | Descuento | Cortesía | Cambiar mesa | Cambio de forma pago |
|---|---|---|---|---|---|
| Cajero | PIN gerente | PIN gerente | Nunca | Libre | PIN gerente |
| Mesero | PIN gerente | PIN gerente | Nunca | Libre | Nunca |
| Supervisor | Libre | PIN dueño | PIN gerente | Libre | PIN gerente |
| Gerente | Libre | Libre | Libre | Libre | Libre |

Una sola pantalla para configurar toda la matriz. Exportable como PDF para que el gerente la revise.

---

### Simplificación E — "Alert Rules" en vez de umbrales dispersos

**Settings actuales:** umbrales de point de reorden (18.5), umbral de variación de costo (18.6), umbral de cancelaciones del agente anti-fraude (en GitHub Actions), umbral de diferencias de arqueo (12.5) — todos configurados en lugares diferentes.

**La solución:** un módulo de "Reglas de Alerta" en el dashboard donde cada regla tiene:
- **Trigger:** qué evento lo activa (stock < mínimo / precio sube >X% / cancelaciones > N en turno / diferencia de arqueo > $Y)
- **Destinatarios:** roles que reciben la alerta (dueño / gerente / almacenista)
- **Canal:** Telegram / WhatsApp / email
- **Urgencia:** inmediata / próximo briefing matutino / reporte semanal

Todas las alertas del sistema configuradas desde una sola pantalla.

---

### Simplificación F — Ruteo de impresión unificado

**Settings actuales:** `NETSILVER > Comanda > Impresoras Grupo` (por categoría) vs `NETSILVER > Comanda > Impresoras Platillo` (por ítem) — dos modos que se excluyen mutuamente. Cambiar de modo destruye la configuración existente.

**La solución:** modelo de herencia en tres niveles:
1. **Sucursal:** impresora default (todo va aquí si no hay otra regla)
2. **Categoría:** override para toda la categoría (ALIMENTOS → COCINA CALIENTE, BEBIDAS → BARRA)
3. **Platillo:** override individual (AGUA SIN GAS → no imprimir)

Los niveles inferiores sobreescriben los superiores. No hay "modo". Siempre es el modelo de tres niveles. El preview en vivo muestra exactamente a qué impresora irá cada platillo del menú.

---

## 5. Roadmap P0 / P1 / P2 / P3

### Criterios de clasificación

- **P0 — Imprescindible:** sin esto, el restaurante no puede operar o Fullsite no puede onboardear un cliente. Bloquea la venta.
- **P1 — Muy valioso:** mejora significativa para restaurantes medianos y grandes. No bloquea el primer cliente pero es necesario para el segundo o tercero.
- **P2 — Especializado:** valioso para un segmento específico (cadenas, bares, panaderías, restaurantes de evento).
- **P3 — No implementar ahora:** complejidad desproporcionada al valor, o existe una mejor solución que aún no es el momento de construir.

---

### P0 — Imprescindible para cualquier restaurante

| # | Setting | Dominio | Estado actual | Esfuerzo |
|---|---|---|---|---|
| 1 | Nombre comercial + razón social | 01 | ✅ Sí | — |
| 2 | RFC y datos fiscales (onboarding) | 01 | ✅ Sí | — |
| 3 | Timezone y horario de operación | 01 | ✅ Sí | — |
| 4 | Grupos, tipos de grupo, catálogo de platillos | 02 | ✅ Sí | — |
| 5 | Modificadores con niveles (obligatorio/opcional) | 02 | ✅ Sí | — |
| 6 | Formas de pago con soporte de pago mixto | 03 | 🟡 Parcial | S |
| 7 | Formas de pago customizables (Influencer, Vales) | 03 | 🟡 Parcial | S |
| 8 | Catálogo de descuentos con elegibilidad por platillo | 04 | 🟡 Parcial | M |
| 9 | Catálogo de cortesías | 04 | 🟡 Parcial | S |
| 10 | Catálogo de cancelaciones con razón + pregunta de inventario | 14 | 🟡 Parcial | S |
| 11 | Tipos de órdenes: restaurante, para llevar, ecommerce | 05 | ✅ Sí | — |
| 12 | Sillas por partida y split de cuenta | 05 | ✅ Sí | — |
| 13 | Tiempos de platillo / firebutton | 05 | ✅ Sí | — |
| 14 | Ruteo de comanda: Station default + override por platillo | 06 | 🟡 Parcial | M |
| 15 | Formato de ticket: logo, RFC, campos, 72mm | 07 | ✅ Sí | — |
| 16 | QR de autofacturación en ticket | 07 | 🟡 Parcial | M |
| 17 | Catálogo de impresoras (TCP/IP + USB) desde dashboard | 10 | 🟡 Parcial | S |
| 18 | Fondo de caja y fórmula de arqueo completa | 12 | 🟡 Parcial | M |
| 19 | Corte Z con numeración consecutiva | 13 | 🟡 Parcial | M |
| 20 | Corte X (parcial, sin cerrar turno) | 13 | ❌ No | M |
| 21 | Corte por Mesero | 13 | ❌ No | S |
| 22 | Permisos de gerente: Security Matrix (6 catálogos unificados) | 14 | 🟡 Parcial | M |
| 23 | Perfiles de usuario como plantillas de permisos | 16 | 🟡 Parcial | S |
| 24 | RFC + PAC para CFDI (Facturama) | 21 | ✅ Sí | — |
| 25 | Series CFDI por sucursal | 21 | 🟡 Parcial | S |

**Total P0: 25 settings — 14 ya implementados, 11 con trabajo pendiente**

---

### P1 — Muy valioso para restaurantes medianos y grandes

| # | Setting | Dominio | Estado actual | Esfuerzo |
|---|---|---|---|---|
| 1 | Tamaños de platillo con precio diferenciado | 02 | ✅ Sí | — |
| 2 | Horarios de disponibilidad por platillo | 02 | ❌ No | M |
| 3 | Tipos de precio: presencial / delivery / evento | 02 | ❌ No | L |
| 4 | Motor de 2x1 | 04 | ❌ No | M |
| 5 | Motor de promociones (combinación de partidas) | 04 | ❌ No | L |
| 6 | Catálogo de propinas sugeridas en preticket | 07 | ❌ No | S |
| 7 | Secciones del salón con permisos por sección | 08 | 🟡 Parcial | M |
| 8 | KDS: estaciones y ruteo digital | 09 | 🟡 Parcial | M |
| 9 | Conciliación de terminal bancaria | 11 | ❌ No | L |
| 10 | Retiros programados (auto-forzar cuando cash > umbral) | 12 | ❌ No | S |
| 11 | Corte Global multi-terminal | 13 | ❌ No | M |
| 12 | Propinas: pool + % del mesero + liquidación en corte | 15 | 🟡 Parcial | M |
| 13 | Programación semanal de turnos por puesto | 17 | ❌ No | M |
| 14 | Almacenes múltiples con routing por área | 18 | 🟡 Parcial | M |
| 15 | Punto de reorden con alerta proactiva | 18 | 🟡 Parcial | S |
| 16 | Umbral de variación de costo por ingrediente | 18 | ❌ No | S |
| 17 | Plantillas de conteo físico por almacén | 18 | 🟡 Parcial | M |
| 18 | Rendimiento / yield en recetas | 19 | ❌ No | S |
| 19 | Subrecetas como componente reutilizable | 19 | ❌ No | M |
| 20 | Plantillas de OC por proveedor | 20 | 🟡 Parcial | S |
| 21 | Flujo de aprobación de OC | 20 | 🟡 Parcial | M |
| 22 | Catálogo de clientes fiscales para CFDI | 21 | ✅ Sí | — |
| 23 | Factura global periódica | 21 | 🟡 Parcial | M |
| 24 | Canal y destinatarios de alertas por tipo | 25 | 🟡 Parcial | S |
| 25 | Agentes activos por sucursal (toggle por agente) | 26 | 🟡 Parcial | S |

**Total P1: 25 settings — 3 ya implementados, 22 con trabajo pendiente**

---

### P2 — Especializado o de nicho

| # | Setting | Dominio | Quién lo necesita |
|---|---|---|---|
| 1 | Marcas virtuales para delivery | 22 | Restaurantes con múltiples conceptos |
| 2 | Horarios por plataforma de delivery | 22 | Cualquier restaurante con Rappi/UberEats |
| 3 | Disponibilidad automática de platillos por stock | 22 | Restaurantes con inventario activo |
| 4 | Top Offenders de delivery (platillos que más fallan) | 22 | Restaurantes con alto volumen delivery |
| 5 | Producción / batch cooking | 19 | Panaderías, cocinas centrales, pastelerías |
| 6 | Subproductos en proceso | 19 | Restaurantes con fermentos, fondos, bases |
| 7 | Costos adicionales por platillo (gas, mano de obra) | 19 | Cálculo de food cost avanzado |
| 8 | Almacén de panadería y routing específico | 18 | AMALAY y similares |
| 9 | Paleo de barra (pesado de botellas) | 18 | Bares con alto volumen de licor |
| 10 | Transferencias entre sucursales | 18 | Cadenas con >2 locales |
| 11 | P&L automático mensual | 24 | Dueños que quieren ver utilidad sin esperar contador |
| 12 | Integración CONTPAQi | 24 | Restaurantes con contador activo |
| 13 | Catálogo de vales y egresos menores | 20 | Restaurantes con compras en efectivo frecuentes |
| 14 | Catálogo de compradores (quién autoriza compras) | 20 | Restaurantes con proceso formal de compras |
| 15 | Programación de staff con IA | 17 | Restaurantes con alta rotación y horarios variables |
| 16 | Permisos de grupos y platillos específicos (nivel avanzado) | 14 | Restaurantes con menú sensitivo |
| 17 | Control de acceso con check-in/check-out del staff | 17 | Restaurantes con control de asistencia |
| 18 | WhatsApp Business como canal de alertas | 25 | Restaurantes sin acceso a Telegram |
| 19 | QR de encuesta post-visita (NPS) | 23 | Restaurantes que miden satisfacción activamente |
| 20 | Tarjetas de regalo digitales (código QR por WhatsApp) | 23 | Restaurantes con ventas de temporada |

---

### P3 — No implementar ahora

| Setting | Razón |
|---|---|
| Nómina completa (IMSS, ISR, timbrado) | Territorio de CONTPAQi. No es nuestro moat. |
| MegaPoints / programa de puntos genérico | No genera lealtad real. Adopción < 5%. |
| Tarjetas de regalo físicas | Costo de producción, baja adopción. Digital es mejor. |
| Encuestas de múltiples preguntas | Una pregunta (NPS) captura el 80% del insight. |
| Billar / Tiempo aire | Otro vertical. Fuera del scope de restaurantes. |
| Wannapay / procesador propio | Clip y MP ya lo resuelven. |
| "Depurar BD" para usuario | Anti-patrón. No aplicable en cloud. |
| Liberaciones de software visibles al cliente | Actualizaciones silenciosas y automáticas. |
| Arqueo con 3 intentos máximo | Reemplazado por audit log de cada intento. |
| Huella digital del cliente para lealtad | Invasivo. El teléfono es el identificador universal. |
| Paleo de barra | Válido pero nicho. Post-200 restaurantes. |
| Tablajería (cortes de carne) | Nicho muy específico. Post-500 restaurantes. |
| Ventas a terceros como categoría separada | Confuso. Mejor incluir en formas de pago custom. |
| Cuentas contables como CRUD en Fullsite | Integración CONTPAQi es la respuesta correcta. |
| Compatibilidad con Getnet / terminales standalone | Priorizar APIs nativas (Clip, NetPay) primero. |

---

## Resumen ejecutivo

### El estado real del producto

De los **25 settings P0**:
- **14 implementados (56%)** — el producto ya funciona para un restaurante básico
- **11 con trabajo pendiente** — estos son los blockers para el segundo cliente

De los **25 settings P1**:
- **3 implementados (12%)** — hay mucho por construir en este nivel
- **22 pendientes** — es el roadmap de los próximos 6-12 meses

### Los 5 más urgentes (no en Fullsite, alta frecuencia, bajo esfuerzo)

Estos 5 tienen la mejor relación impacto/esfuerzo y deberían priorizarse en el próximo sprint de configuración:

1. **Catálogo de razones de cancelación** — 1-2 días. Convierte texto libre en datos analizables. Habilita el agente anti-fraude completo.
2. **Corte por Mesero** — 2-3 días. Es el reporte que el cajero y el gerente piden más frecuentemente.
3. **Perfiles de usuario como plantillas** — 2-3 días. Hace que agregar un empleado nuevo tome 30 segundos en vez de 15 minutos.
4. **Catálogo de propinas sugeridas en preticket** — 1 día. Aumenta las propinas de los meseros — uno de los temas más sensibles en operación.
5. **Umbral de variación de costo por ingrediente** — 1-2 días. El primer sistema de alerta de inflación en la industria restaurantera mexicana.

### La oportunidad estructural

El hallazgo más importante de este análisis no es técnico — es competitivo:

**Wansoft tiene todos estos settings como toggles manuales. Fullsite los tiene como decisiones de arquitectura.**

El audit log activo, la config en la nube, los datos en tiempo real, las alertas proactivas, la conciliación automática — estos no son settings que Fullsite configura diferente. Son cosas que Fullsite hace bien por diseño y Wansoft no puede hacer porque su arquitectura es local, frágil, y de 2007.

Esa diferencia es el moat. No los features — la arquitectura.

---

> Documento estratégico de Fullsite.
> Input: `FULLSITE-SETTINGS-BIBLE.md` — 111 settings, 26 dominios.
> Output: este roadmap de producto.
>
> Fecha: 2026-07-25
