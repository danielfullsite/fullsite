# Fullsite Settings Bible

> Referencia definitiva para toda la configuración del producto.
> No es una copia de Wansoft. Es la destilación de 20 años de
> experiencia operativa, reinterpretada para un sistema moderno.
>
> Principio central: si el sistema puede inferirlo o automatizarlo,
> no debe existir como configuración manual.
>
> Última actualización: 2026-07-25
> Estado: DRAFT — Taxonomía aprobada, clasificación en progreso

---

## Cómo leer este documento

Cada setting tiene 8 campos:

| Campo | Descripción |
|---|---|
| **Nombre** | Nombre del setting en Fullsite |
| **Wansoft** | Ubicación exacta en Wansoft (módulo > sección > opción) |
| **Qué hace** | Comportamiento al activarlo/cambiarlo |
| **Problema que resuelve** | El dolor operativo real detrás de la opción |
| **Frecuencia** | Con qué frecuencia un restaurante necesita esto (Universal / Común / Situacional / Raro) |
| **¿Existe en Fullsite?** | Sí / Parcial / No |
| **Cómo lo diseñaríamos hoy** | La versión Fullsite del mismo concepto |
| **Tipo** | Configuración manual / Automatización / Decisión IA |

**Frecuencia:**
- **Universal** — 100% de restaurantes lo necesitan (o implícitamente lo asumen)
- **Común** — 60-80% lo usa
- **Situacional** — 20-40% lo necesita según su tipo de operación
- **Raro** — <10%, nicho específico

**Tipo:**
- **Config** — Toggle o valor que un humano define una vez (setup inicial o cambios esporádicos)
- **Auto** — Regla que el sistema puede ejecutar basándose en triggers o schedules sin intervención humana
- **IA** — El sistema puede inferir el valor óptimo del contexto (historial, patrones, comparativa de red)
- **Config→Auto** — Hoy es config manual, pero debería convertirse en automatización
- **Config→IA** — Hoy es config manual, pero la IA puede optimizarlo

---

## Taxonomía de dominios

```
FULLSITE SETTINGS
│
├── 01 ORGANIZACIÓN
│   ├── 01.1 Empresa
│   └── 01.2 Sucursales
│
├── 02 MENÚ Y CATÁLOGO
│   ├── 02.1 Grupos y categorías
│   ├── 02.2 Tamaños
│   ├── 02.3 Platillos
│   ├── 02.4 Modificadores
│   ├── 02.5 Horarios de disponibilidad
│   └── 02.6 Tipos de precio
│
├── 03 FORMAS DE PAGO
│   ├── 03.1 Métodos estándar
│   ├── 03.2 Métodos custom e internos
│   └── 03.3 Impuestos especiales (IEPS)
│
├── 04 PROMOCIONES Y DESCUENTOS
│   ├── 04.1 Catálogo de descuentos
│   ├── 04.2 Catálogo de cortesías
│   ├── 04.3 Motor de 2x1
│   └── 04.4 Motor de promociones
│
├── 05 POS — OPERACIÓN GENERAL
│   ├── 05.1 Modo de operación
│   ├── 05.2 Tipos de órdenes activos
│   ├── 05.3 Sillas (asientos por partida)
│   ├── 05.4 Tiempos de platillo
│   └── 05.5 Comportamiento de pantalla de captura
│
├── 06 POS — COMANDA (impresión a cocina)
│   ├── 06.1 Ruteo por grupo
│   ├── 06.2 Ruteo por platillo individual
│   ├── 06.3 Campos del encabezado
│   ├── 06.4 Formato y tipografía
│   ├── 06.5 Mensaje de firebutton
│   └── 06.6 Etiquetas de preparación
│
├── 07 POS — TICKET (impresión al cliente)
│   ├── 07.1 Formato y campos visibles
│   ├── 07.2 Propina sugerida
│   ├── 07.3 QR de autofacturación
│   └── 07.4 QR de encuesta
│
├── 08 MESAS Y FLOOR PLAN
│   ├── 08.1 Mapa visual vs numeración directa
│   ├── 08.2 Secciones del salón
│   └── 08.3 Capacidad por mesa
│
├── 09 COCINA / KDS
│   ├── 09.1 Estaciones de cocina
│   ├── 09.2 Ruteo a estaciones KDS
│   └── 09.3 Tiempos de alerta
│
├── 10 HARDWARE E IMPRESORAS
│   ├── 10.1 Catálogo de impresoras
│   ├── 10.2 Asignación por rol de cocina
│   ├── 10.3 Cajón de dinero
│   └── 10.4 Etiquetado (stickers de producción)
│
├── 11 TERMINALES BANCARIAS
│   ├── 11.1 Procesadores activos
│   └── 11.2 Conciliación
│
├── 12 CAJA
│   ├── 12.1 Fondo de caja
│   ├── 12.2 Retiros
│   ├── 12.3 Depósitos
│   ├── 12.4 Apertura formal del día
│   └── 12.5 Arqueo
│
├── 13 CORTES
│   ├── 13.1 Tipos de corte activos
│   ├── 13.2 Contenido del corte Z
│   ├── 13.3 Horas máximas de turno
│   └── 13.4 Envío digital de cortes
│
├── 14 SEGURIDAD Y AUDITORÍA
│   ├── 14.1 Permisos de cajero (qué requiere escalation)
│   ├── 14.2 Permisos de gerente por catálogo
│   ├── 14.3 Bloqueo de terminal
│   └── 14.4 Operaciones de días anteriores
│
├── 15 PROPINAS
│   ├── 15.1 Activación y modo
│   ├── 15.2 Pool de propinas
│   ├── 15.3 Reparto por puesto
│   └── 15.4 Liquidación al cierre de turno
│
├── 16 USUARIOS Y ROLES
│   ├── 16.1 Staff POS
│   ├── 16.2 Roles y perfiles
│   ├── 16.3 Permisos granulares
│   └── 16.4 Usuarios del dashboard/portal
│
├── 17 RECURSOS HUMANOS
│   ├── 17.1 Turnos y calendario
│   ├── 17.2 Programación semanal
│   ├── 17.3 Días de asueto
│   └── 17.4 Check-in (método de entrada)
│
├── 18 INVENTARIO
│   ├── 18.1 Almacenes
│   ├── 18.2 Departamentos
│   ├── 18.3 Unidades de medida
│   ├── 18.4 Presentaciones y conversiones
│   ├── 18.5 Punto de reorden
│   ├── 18.6 Variación de costo (alertas)
│   ├── 18.7 Plantillas de conteo físico
│   └── 18.8 Momento de deducción
│
├── 19 RECETAS Y FOOD COST
│   ├── 19.1 Rendimiento / yield
│   ├── 19.2 Subrecetas
│   ├── 19.3 Costos adicionales
│   ├── 19.4 Umbral de alerta de food cost
│   └── 19.5 Producción / batch cooking
│
├── 20 COMPRAS Y PROVEEDORES
│   ├── 20.1 Catálogo de proveedores
│   ├── 20.2 Plantillas de OC
│   ├── 20.3 Flujo de aprobación de OC
│   ├── 20.4 Vales y egresos menores
│   └── 20.5 Cuentas bancarias
│
├── 21 FACTURACIÓN / CFDI
│   ├── 21.1 PAC y credenciales
│   ├── 21.2 Series por sucursal
│   ├── 21.3 Autofacturación
│   ├── 21.4 Factura global
│   └── 21.5 Catálogo de clientes fiscales
│
├── 22 DELIVERY / ECOMMERCE
│   ├── 22.1 Plataformas activas
│   ├── 22.2 Horarios por plataforma
│   ├── 22.3 Marcas virtuales
│   ├── 22.4 Disponibilidad de platillos
│   └── 22.5 Tiempo de preparación
│
├── 23 CRM Y LEALTAD
│   ├── 23.1 Encuestas
│   ├── 23.2 Tarjetas de regalo
│   └── 23.3 WhatsApp Business
│
├── 24 CONTABILIDAD
│   ├── 24.1 Cuentas contables
│   └── 24.2 Estado de resultados (P&L)
│
├── 25 NOTIFICACIONES Y ALERTAS
│   ├── 25.1 Canales de entrega
│   ├── 25.2 Destinatarios por tipo
│   └── 25.3 Umbrales configurables
│
└── 26 IA Y AUTOMATIZACIONES
    ├── 26.1 Agentes activos
    ├── 26.2 Umbrales de anomalía
    ├── 26.3 Acciones automáticas
    └── 26.4 Contexto de eventos
```

---

## Convenciones de clasificación de Wansoft

Cuando un setting viene de Wansoft, su ubicación se escribe así:

```
[Fuente] > [Módulo] > [Sección] > [Opción]
```

**Fuentes:**
- `NETSILVER` — Config local de terminal (Admin > Configurar Netsilver)
- `PORTAL` — Config del portal web (wansoftpos.com)
- `PORTAL:PV` — Portal > Punto de Venta
- `PORTAL:INV` — Portal > Inventario > Control de Inventarios
- `PORTAL:CONFIG` — Portal > Configuración
- `PORTAL:ADMIN` — Portal > Administración
- `PORTAL:EGRESOS` — Portal > Egresos > Configuración
- `PORTAL:ECOM` — Portal > Ecommerce > Administración
- `FULLSITE` — Setting exclusivo de Fullsite sin equivalente en Wansoft

---

## Dominios — descripción y notas clave

### 01. ORGANIZACIÓN

**01.1 Empresa**
Datos maestros de la entidad que opera el sistema. RFC, razón social, régimen fiscal, logo, datos de contacto.

*Nota Wansoft:* Configurado en el servidor de Wansoft durante la instalación inicial. No es visible ni editable desde el portal normal — requiere soporte de Wansoft o distribuidor.
*Nota Fullsite:* Ya existe en `clients` table. El onboarding en <30 min es ventaja directa.

**01.2 Sucursales**
Unidad operativa independiente. Tiene su propio timezone, horarios, régimen fiscal, fondo de caja, y configuración de hardware.

*Nota Wansoft:* `PORTAL:CONFIG > Sucursal` — timezone, régimen fiscal, horarios. Es el nivel más alto de configuración web.
*Nota Fullsite:* Multi-tenant desde el día 1. Cada cliente es una sucursal o un grupo de sucursales.

---

### 02. MENÚ Y CATÁLOGO

El catálogo es la configuración más frecuentemente modificada de cualquier sistema POS. Platillos que se agregan, precios que suben, grupos que cambian de temporada.

**Notas críticas de Wansoft:**
- Los platillos en Wansoft tienen flag por platillo de elegibilidad para 2x1, descuento, cortesía — no es global.
- Existen **tipos de precio**: normal, evento, happy hour, delivery. Precios diferentes por contexto.
- Los horarios de disponibilidad (ej. desayuno solo de 8am-12pm) son config por platillo, no por grupo.
- Modificadores tienen **niveles** (nivel 1 = obligatorio, nivel 2 = opcional) y se pueden asignar por tipo de orden (presencial diferente a delivery).

**Nota Fullsite:** Este dominio es donde más trabajo hay — es el corazón del SaaS. Los tipos de precio múltiples y los horarios de disponibilidad son gaps actuales.

---

### 03. FORMAS DE PAGO

Uno de los descubrimientos más sorprendentes de la Wansoft Bible: las formas de pago son **totalmente customizables**, incluyendo formas con nombre de persona ("Claudia Sada"), formas de cortesía categorizada ("Influencer", "Mercadotecnia"), y formas de pago de plataformas (Rappi, UberEats). Esto es extraordinariamente útil para auditoría.

**Nota crítica:** AMALAY tiene 18 formas de pago distintas. El sistema de Wansoft permite crear tantas como se necesiten sin límite. Cada una aparece en los reportes de ventas y en los cortes.

**IEPS (Impuesto Especial sobre Producción y Servicios):** Se aplica a bebidas alcohólicas, tabacos, y algunas bebidas energéticas. Separado del IVA 16%. AMALAY vende alcohol — este impuesto es obligatorio para ellos.

---

### 04. PROMOCIONES Y DESCUENTOS

Wansoft tiene 3 conceptos distintos que en Fullsite a veces se mezclan:
- **Descuento:** reducción de precio sobre partidas seleccionadas (puede ser % o monto fijo). Requiere que el platillo tenga flag "aplica descuento".
- **Cortesía:** toda la cuenta o partida sale en $0. Usada para empleados, clientes VIP, relaciones públicas. Requiere categoría (de un catálogo predefinido).
- **2x1 / DXU:** descuento especial por unidad. El platillo tiene que tener flag "acepta 2x1".
- **Promoción:** combinación de partidas seleccionadas + regla de descuento del catálogo de promociones. Motor separado.

**Nota:** AMALAY en 2026 no tenía ninguna promoción configurada. Esto es anecdóticamente común — muchos restaurantes pagan por el módulo pero no lo configuran. El MVP de promociones puede ser simple.

---

### 05. POS — OPERACIÓN GENERAL

La configuración más crítica del sistema. Determina qué puede hacer el cajero, qué flujos están activos, y cómo se comporta la pantalla de captura.

**Settings críticos que reveló CAJA-SPEC:**
- **Sillas activas en AMALAY** — validado en vivo. Las usan diario.
- **Tiempos de platillo activos** — confirmado. El firebutton dispara comanda parcial a cocina.
- **Existencias locales desactivado** — AMALAY prefiere "nunca decirle no al cliente". El sistema no debe bloquear; debe alertar.
- **Bloqueo de venta sin stock** es un default incorrecto para restaurantes — debe ser alerta, no bloqueo.

---

### 06. POS — COMANDA

El documento más complejo de configurar en Wansoft (30+ checkboxes). Define exactamente qué imprime la cocina cuando el mesero cierra una cuenta o dispara un tiempo.

**Insights críticos:**
- El ruteo puede ser por GRUPO (toda la categoría "Cocina Caliente" → impresora 1) o por PLATILLO individual (override por ítem específico). Cambiar de modo pisa la configuración existente — Wansoft advierte antes de hacerlo.
- AMALAY tiene 2 destinos de comanda: COCINA CALIENTE y BARRA.
- Las etiquetas (stickers) son un sub-módulo de la comanda — permiten imprimir etiquetas adhesivas para identificar preparaciones.
- El mensaje de firebutton (texto que se imprime en cocina al disparar un tiempo) es configurable por texto custom.

**Rediseño Fullsite:** Los 30 checkboxes de Wansoft se pueden simplificar a 3 presets (mínimo, estándar, completo) + modo avanzado con preview en vivo del ticket. La ventaja es que la config vive en la nube, no en cada terminal.

---

### 07. POS — TICKET

El ticket al cliente es el documento más visible del restaurante — lo ve el cliente, lo firma si paga con tarjeta, lo guarda como comprobante.

**Format de referencia (AMALAY):**
- Papel 72mm
- QR de encuesta en preticket
- QR de autofacturación en ticket de pago
- Propina sugerida en preticket
- Campos visibles: mesa, personas, mesero, hora entrada, hora cierre, fecha, pie de página
- Campos ocultos: IVA y subtotal, total por tipo de grupo

**Rediseño Fullsite:** El ticket puede tener una versión digital (WhatsApp/email) además del impreso. El QR de encuesta y el QR de autofacturación ya los tenemos. La propina sugerida con catálogo es un gap simple.

---

### 08. MESAS Y FLOOR PLAN

Wansoft tiene mapa visual de mesas como feature opcional — AMALAY lo tiene **desactivado** y usa numeración directa. Esto es relevante: el mapa visual no es prioridad para la migración. Lo que importa es la sección default al abrir una cuenta.

**P2 ya resuelto:** Fullsite implementó `pos_mesas` con DB-first floor plan en la sesión actual.

---

### 09. COCINA / KDS

Wansoft tiene KDS como concepto (`Id_KdsEstacion`, 89 referencias) pero lo implementa como routing de impresión, no como pantalla visual. La pantalla visual KDS es una ventaja diferencial de Fullsite.

**Configuración crítica:** el ruteo por estación (cuál categoría va a cuál pantalla KDS) es el mismo problema que el ruteo de comanda, pero para pantallas digitales en vez de impresoras.

---

### 10. HARDWARE E IMPRESORAS

Wansoft tiene un catálogo completo de impresoras y un sistema de ruteo sofisticado (primaria + secundaria + duplicar impresión). La configuración vive en la terminal local — es frágil y no está versionada.

**Ventaja Fullsite:** la config de impresoras vive en la nube, es la misma para todas las terminales de la sucursal, y tiene rollback si algo sale mal.

**AMALAY tiene:**
- EC TICKET (USB) — caja principal + cajón RJ-11
- PANADERIA (TCP, impresora de panadería) — destino de reportes locales
- COCINA CALIENTE (TCP) — comanda de platillos calientes
- BARRA (TCP) — comanda de bebidas

---

### 11. TERMINALES BANCARIAS

**Descubrimiento crítico:** AMALAY usa Getnet (Santander) como terminal bancaria, pero Getnet **no está en las integraciones nativas de Wansoft**. El cajero teclea el monto a mano — riesgo de descuadre permanente sin conciliación automática.

Wansoft tiene integración nativa con: Clip, Operaciones en Línea, NetPay, BBVA.
Fullsite tiene: Clip, MP Point.

**Gap de conciliación:** ningún sistema concilia automáticamente las transacciones de terminal bancaria con las ventas del POS. Es una oportunidad enorme de diferenciación.

---

### 12. CAJA

El corazón operativo del turno. Fondo de caja, retiros, depósitos, arqueo.

**Hallazgo crítico de CAJA-SPEC:**
- El fondo de caja de AMALAY es **$1,700 MXN** y persiste entre turnos.
- La fórmula de arqueo es: `Efectivo esperado = Fondo + Ventas efectivo + Propinas efectivo + Depósitos − Vales − PropinasXTarjeta pagadas en efectivo`
- El "cambio como propina en pagos bancarios" es una configuración real activa en AMALAY — cuando alguien paga con tarjeta y hay cambio, se queda como propina por default.

---

### 13. CORTES

Wansoft tiene 5 tipos de corte con semánticas distintas. No son intercambiables.

**Los 5 tipos:**
- **Corte X** — Parcial, sin cerrar el turno. Para saber cómo van a media jornada.
- **Corte de Turno** — Cierra el turno del cajero. El siguiente empieza con fondo nuevo.
- **Corte Z** — Cierra el día fiscal. Numerado consecutivamente. El que revisa Hacienda.
- **Corte Global** — Consolida todas las terminales de la sucursal.
- **Corte de Mesero** — Cuánto vendió cada mesero en el turno.

**Gap de Fullsite:** Tenemos corte de turno. Falta corte X (parcial), numeración consecutiva del Z, y corte por mesero separado.

---

### 14. SEGURIDAD Y AUDITORÍA

**Hallazgo más importante de toda la Wansoft Bible:**
> AMALAY tenía "Guardar logs de acciones" **APAGADO** en Wansoft. Esto significa que no había registro de quién canceló qué, quién dio descuento, quién hizo cortesía.

Wansoft trata el audit log como checkbox opcional. Fullsite lo tiene siempre activo — no es configurable. Esto es un argumento de venta directo.

**Permisos de gerente en Wansoft:** 6 catálogos configurables. El gerente puede definir:
1. Qué platillos requieren su PIN para vender
2. Qué grupos requieren su PIN
3. Qué formas de pago requieren su PIN
4. Qué descuentos puede aplicar el cajero (y cuáles requieren gerente)
5. Qué cortesías puede aplicar el cajero
6. Qué cancelaciones/anulaciones/devoluciones requieren su PIN

**Patrón de escalation in-place:** cuando el cajero no tiene permiso, aparece "¿Desea apoyo de otra persona?" — el gerente captura su PIN SIN cerrar la sesión del cajero. Es elegante y prácticamente invisible. Wansoft no registra quién autorizó. Fullsite debe registrarlo.

---

### 15. PROPINAS

Uno de los temas más sensibles de operación en restaurantes mexicanos. El sistema de propinas de Wansoft revela la complejidad real:

- El mesero "aporta" **5%** de su venta total al pool de propinas (para cubrir costos de tarjeta y fondos comunes). Esto se configura por sucursal.
- Existe un catálogo de propinas sugeridas (ej. 10%, 15%, 20%) que se imprime en el preticket para que el cliente elija.
- El "cambio como propina en pagos bancarios" es una regla que convierte el cambio pequeño en propina automáticamente.
- El fondo de propinas es una entidad separada — se recolecta, se distribuye por puesto (mesero/mosito/cajero), y se retira formalmente.

---

### 16. USUARIOS Y ROLES

**Dos sistemas de permisos independientes en Wansoft:**
- Permisos POS (para el staff de piso — cajeros, meseros)
- Permisos Web/Portal (para administradores, contadores, gerentes)

Los perfiles son plantillas reutilizables — no asignas permiso por permiso a cada usuario, sino que asignas el perfil "Cajero" o "Mesero" que ya tiene los permisos correctos.

**Fullsite:** Ya tenemos permisos granulares (269 acciones). La mejora es la UX de asignación — perfiles como plantillas reutilizables.

---

### 17. RECURSOS HUMANOS

Wansoft tiene un módulo de nómina completo que Fullsite **deliberadamente no replica** (eso es territorio de CONTPAQi/Nomipaq). Lo que sí replcamos:
- Turnos y calendario de trabajo
- Programación semanal (quién trabaja qué días)
- Días de asueto (festivos que afectan operación)
- Check-in (cómo entra y sale el empleado)

**La huella digital es legacy.** AMALAY tiene problemas de lectura con su lector DigitalPersona 4500 USB. PIN + app móvil es el futuro.

---

### 18. INVENTARIO

El módulo de inventario de Wansoft tiene 23 KB — el más pequeño del sistema. En 20 años nunca lo hicieron crecer porque el negocio de Wansoft es el POS de ventas, no el backoffice.

**Settings específicos que reveló el análisis:**
- **Almacenes:** AMALAY tiene 6 (cocina, barra, market, panadería, etc.). Cada producto puede estar en múltiples almacenes.
- **Presentaciones:** 1 CAJA = 24 PIEZAS. Las conversiones son críticas para compras (compras cajas, recetas usan piezas).
- **Punto de reorden:** pasivo en Wansoft. Nadie lo revisa porque es una tabla en el portal. En Fullsite debe ser una alerta proactiva.
- **Momento de deducción:** Wansoft deduce al COBRAR. Fullsite deduce al ENVIAR a cocina. Esta diferencia es filosófica y tiene impacto en el inventario teórico durante la hora pico.
- **Límites de variación de costo:** config por producto (alerta si el precio sube más del X%). Es un feature simple con alto valor operativo.

---

### 19. RECETAS Y FOOD COST

La receta es la unidad atómica del sistema. Sin recetas bien configuradas, el food cost es ficción.

**Lo que Wansoft no tiene (y Fullsite sí):**
- Rendimiento/yield (1 kg de pollo crudo ≠ 1 kg de pollo cocido)
- Subrecetas (recetas reutilizables dentro de recetas)
- Monitor de food cost en tiempo real
- Alertas cuando el food cost sube del umbral

**Producción/batch cooking:** Wansoft lo tiene como módulo completo (26 SPs — el más profundo de todo el sistema). AMALAY lo tiene activado para su área de panadería. Fullsite aún no lo tiene — es prioridad pre-500 restaurantes.

---

### 20. COMPRAS Y PROVEEDORES

**El descubrimiento más importante para el producto:**
> Wansoft no tiene módulo de compras reales en 20 años. Solo órdenes de compra internas entre sucursales y un catálogo decorativo de proveedores.

La oportunidad: el 35-45% del ingreso de un restaurante se va en insumos y NADIE en México lo controla bien. Fullsite tiene el ciclo completo (OC → recepción → stock → food cost). Eso es diferenciación estructural.

---

### 21. FACTURACIÓN / CFDI

CFDI 4.0 es obligación legal en México. Sin facturación, el restaurante pierde clientes corporativos (20-40% del ingreso en zonas de oficinas).

**Wansoft tiene todo el flujo** — factura individual, global, agrupada, notas de crédito, complementos de pago, series por sucursal.

**Ventaja Fullsite:** autofacturación por QR (el comensal la hace solo sin llamar a la caja) y timbrado automático sin intervención humana.

---

### 22. DELIVERY / ECOMMERCE

**Marcas virtuales:** un restaurante puede operar como múltiples marcas en plataformas (AMALAY + La Nonna Keto + Bakery Shop). Cada marca tiene su menú, precios, horarios, y disponibilidad de platillos por separado.

**Top Offenders:** el reporte más valioso del módulo — platillos que más frecuentemente fallan en delivery (timeout, cancelado, rechazado). Wansoft lo tiene. Fullsite no.

**Disponibilidad automática por stock:** si se acaba el aguacate, los bowls se desactivan automáticamente en las plataformas. Wansoft no lo tiene — lo hace manualmente. Fullsite puede hacerlo con IA.

---

### 23. CRM Y LEALTAD

Wansoft tiene poco aquí (tarjetas de regalo, encuestas, MegaPoints legacy). La oportunidad es grande porque los restaurantes tienen los datos pero no los usan.

**Insight operativo:** el catálogo de clientes FE (para facturación) es la mejor base de datos de clientes de un restaurante — tienen RFC, razón social, email, y frecuencia de compra. Es un CRM involuntario.

---

### 24. CONTABILIDAD

**Estado de resultados automático de Wansoft:** calcula un P&L mensual basándose en ventas, egresos, compras, y nómina. Es ORO para el dueño — sabe cuánto gana sin esperar al contador 2 meses después.

**Cuentas contables:** Wansoft tiene CRUD de cuentas contables para mapear ventas a categorías contables. En Fullsite, la integración directa con CONTPAQi es mejor que duplicar el catálogo.

---

### 25. NOTIFICACIONES Y ALERTAS

**No existe en Wansoft** — excepto email de cortes (que AMALAY tiene apagado).

Es una ventaja competitiva exclusiva de Fullsite: el restaurante recibe alertas proactivas en Telegram/WhatsApp/email cuando pasa algo importante, en vez de esperar a que alguien abra un reporte.

**El principio:** si el sistema tiene que decirle algo al operador, que se lo diga — no esperar a que el operador vaya a buscarlo.

---

### 26. IA Y AUTOMATIZACIONES

**No existe en Wansoft** — ni en ningún competidor en LATAM.

Los 30 agentes de Fullsite son el moat competitivo que Wansoft no puede replicar porque sus datos están en SQL Server local en cada terminal y no están centralizados.

**Principio de diseño:** cada configuración manual que hoy existe debería evaluarse si puede convertirse en automatización o en decisión IA. El objetivo final es un sistema que se configure solo basándose en los patrones del restaurante.

---

## Regla de oro para cada setting

Antes de documentar un setting como "Configuración manual", pregunta:

1. **¿El sistema puede detectar automáticamente el valor correcto?**
   - Si el restaurante vende alcohol → el IEPS debería activarse automáticamente al detectar productos con IEPS en el catálogo.
   - Si hay solo una impresora → el ruteo de comanda no necesita configuración.

2. **¿Hay un default sensato para el 80% de los casos?**
   - El fondo de caja podría default a $1,500 MXN y ajustarse según el historial del restaurante.
   - Los horarios de disponibilidad podrían inferirse de los primeros 30 días de operación.

3. **¿La configuración refleja un evento o contexto cambiante?**
   - Happy Hour no es un toggle — es una regla de precio por horario.
   - La disponibilidad de platillos no es un checkbox — es una consecuencia del stock.

Si la respuesta a alguna de estas preguntas es "sí", el tipo del setting debe ser `Config→Auto` o `Config→IA`, no `Config`.

---

## Estado de la clasificación

| Dominio | Settings identificados | Clasificados | Pendientes |
|---|---|---|---|
| 01 Organización | — | — | — |
| 02 Menú y Catálogo | — | — | — |
| 03 Formas de Pago | — | — | — |
| 04 Promociones y Descuentos | — | — | — |
| 05 POS — Operación General | — | — | — |
| 06 POS — Comanda | — | — | — |
| 07 POS — Ticket | — | — | — |
| 08 Mesas y Floor Plan | — | — | — |
| 09 Cocina / KDS | — | — | — |
| 10 Hardware e Impresoras | — | — | — |
| 11 Terminales Bancarias | — | — | — |
| 12 Caja | — | — | — |
| 13 Cortes | — | — | — |
| 14 Seguridad y Auditoría | — | — | — |
| 15 Propinas | — | — | — |
| 16 Usuarios y Roles | — | — | — |
| 17 Recursos Humanos | — | — | — |
| 18 Inventario | — | — | — |
| 19 Recetas y Food Cost | — | — | — |
| 20 Compras y Proveedores | — | — | — |
| 21 Facturación / CFDI | — | — | — |
| 22 Delivery / Ecommerce | — | — | — |
| 23 CRM y Lealtad | — | — | — |
| 24 Contabilidad | — | — | — |
| 25 Notificaciones y Alertas | — | — | — |
| 26 IA y Automatizaciones | — | — | — |
| **TOTAL** | — | — | — |

---

---

## Settings — Catálogo completo

Formato de cada entry:

**Wansoft:** `[Fuente] > [Módulo] > [Opción]` | **Nivel:** ___ | **Frecuencia:** ___ | **¿En Fullsite?** ___ | **Tipo:** ___

---

### 01 ORGANIZACIÓN

#### 01.1.1 Nombre comercial y razón social

**Wansoft:** `PORTAL:CONFIG > Sucursal > Nombre`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define el nombre que aparece en tickets, comandas, y reportes (nombre comercial) y la razón social que va en las facturas (nombre fiscal). Son dos campos distintos aunque muchos sistemas los colapsan.

**Problema operativo:** Un ticket que dice "Distribuciones del Norte SA de CV" en vez de "AMALAY Coffee & Market" no genera confianza en el cliente. Una factura con razón social incorrecta es inválida ante el SAT y requiere cancelación y reemisión — proceso que cuesta tiempo y, con algunos PACs, dinero.

**Por qué alguien pagó:** El distribuidor de Wansoft cobraba horas de soporte para corregir el nombre después de la instalación inicial porque el campo estaba en el servidor local, no en el portal. La corrección requería acceso remoto a la terminal y reinicio del servicio. Varias facturas quedaban mal durante días.

**Diseño 2026:** Dos campos explícitos desde el onboarding: "¿Cómo quieres que aparezca en el ticket?" y "¿Cuál es tu razón social para facturas?". El RFC valida automáticamente la razón social contra el SAT en el momento de captura. Cambios post-setup no requieren soporte.

---

#### 01.1.2 RFC y datos fiscales

**Wansoft:** `PORTAL:CONFIG > Facturación Electrónica > RFC + Régimen fiscal`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** RFC, régimen fiscal (601, 605, 612...), código postal del domicilio fiscal. Sin estos datos, el sistema no puede timbrar CFDI.

**Problema operativo:** Un restaurante que opera sin RFC configurado puede vender perfectamente, pero cuando el primer cliente pide factura, la caja no puede emitirla. El cajero tiene que decir "regresa mañana" — el cliente corporativo no regresa.

**Por qué alguien pagó:** El módulo de facturación en Wansoft era opcional y se activaba en una instalación separada. Muchos restaurantes lo compraban "para después" y descubrían meses más tarde que no estaba configurado.

**Diseño 2026:** RFC obligatorio en el flujo de onboarding, antes de recibir el primer pago. El sistema valida el formato del RFC en el momento de captura y confirma que el régimen corresponde al tipo de persona (física vs moral). El CSD (certificado del SAT) se sube en la misma pantalla.

---

#### 01.2.1 Timezone y horario de operación

**Wansoft:** `PORTAL:CONFIG > Sucursal > Timezone + Horarios`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define la zona horaria de la sucursal y el horario de apertura/cierre. Afecta cuándo se corta el "día" en los reportes, qué ventas pertenecen a cada corte Z, y cuándo se disparan automaciones.

**Problema operativo:** México tiene 4 zonas horarias (Centro, Montaña, Pacífico, Noroeste). Un sistema que asume UTC-6 para todos muestra las ventas de Tijuana mal categorizadas por hora — la hora pico aparece a las 3am en los reportes porque el servidor no convierte correctamente.

**Por qué alguien pagó:** Una cadena con sucursales en CDMX y Tijuana recibía reportes donde el "día" de Tijuana empezaba 2 horas después que el de CDMX, mezclando ventas de un martes en los reportes del lunes. El distribuidor cobró una configuración especial para "corregirlo".

**Diseño 2026:** Timezone detectado automáticamente del browser en el primer login, confirmado por el usuario. El corte Z se ancla al timezone de la sucursal, no al del servidor. Los agentes IA que envían reportes a las 7am lo hacen a las 7am hora local de cada sucursal.

---

### 02 MENÚ Y CATÁLOGO

#### 02.1.1 Grupos y tipo de grupos

**Wansoft:** `PORTAL:PV > Restaurante > Tipos de grupos + Grupos`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Los Tipos de grupo son la agrupación de segundo nivel (ALIMENTOS, BEBIDAS, ALCOHOL, MARKET). Los Grupos son las categorías del menú (CHILAQUILES & ENCHILADAS, BOWLS, COFFEE HOT). Esta jerarquía determina cómo navega el cajero en la pantalla de captura y cómo se agrupan las ventas en los reportes.

**Problema operativo:** Sin jerarquía, el cajero navega por 50+ platillos en lista plana. Con 200+ platillos (AMALAY tiene 522), la búsqueda manual hace que cada pedido tarde 30-60 segundos más. En una mesa de 8 personas, eso suma 4-8 minutos de espera solo en captura.

**Por qué alguien pagó:** Cuando el menú del restaurante cambió de estacional — agregaron 20 platillos de temporada navideña — el distribuidor cobró una visita para reorganizar los grupos y "ajustar la navegación." Mover un platillo de grupo en Wansoft requería ir al portal, encontrar el platillo, cambiar el grupo, y "sincronizar" con la terminal.

**Diseño 2026:** Los grupos se crean en el dashboard y se reflejan en el POS en tiempo real sin reiniciar. La pantalla de captura respeta la jerarquía (tipo → grupo → platillo) con búsqueda global por nombre. El color del grupo en la pantalla es configurable (AMALAY usa guinda para categorías raíz, diferente a la paleta genérica).

---

#### 02.2.1 Tamaños

**Wansoft:** `PORTAL:PV > Restaurante > Tamaños`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define las variantes de tamaño disponibles en el sistema (Chico, Mediano, Grande; 8oz, 12oz, 16oz; etc.) con precio diferencial por tamaño. Un platillo puede tener múltiples tamaños activos.

**Problema operativo:** Un café sin sistema de tamaños cobra el mismo precio por todos los americanos — pequeño, mediano, grande. Perder 5-8 pesos por bebida grande en 200 bebidas al día son 1,000-1,600 pesos diarios de ingreso no capturado.

**Por qué alguien pagó:** Un restaurante que introdujo "bowl completo" vs "bowl chico" necesitaba que el POS diferenciara el precio automáticamente. Sin tamaños, el cajero aplicaba un descuento manual para el chico — que entraba como "descuento" en los reportes y confundía el análisis de leakage.

**Diseño 2026:** Los tamaños son modificadores estructurados de tipo "variante" — nivel 1 obligatorio si el platillo tiene más de una variante de precio. La pantalla de captura los muestra como botones grandes antes de agregar el item. El precio del tamaño está en la receta (food cost diferenciado por tamaño).

---

#### 02.3.1 Flag: aplica descuento

**Wansoft:** `PORTAL:PV > Restaurante > Platillos > Acepta descuento (flag por platillo)`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Marca a nivel de platillo si ese item puede recibir descuento. Sin el flag, el cajero no puede aplicar descuento aunque tenga el permiso de gerente. El drop-down "Seleccionar todos los que aplican descuento" en la pantalla de edición usa este flag.

**Problema operativo:** Sin control granular, un descuento de "10% por bienvenida" puede aplicarse a bebidas alcohólicas (donde el margen es mínimo), a platillos en promoción, o a artículos de market (donde no aplica lógica de restaurante). El descuento termina aplicándose donde no debería.

**Por qué alguien pagó:** Un gerente descubrió que sus meseros aplicaban el "10% empleados" a toda la cuenta, incluyendo las botellas de vino. La política era solo en alimentos. Sin el flag, no había forma de restringirlo técnicamente.

**Diseño 2026:** El flag existe pero se hereda del grupo por default (todos los platillos de ALIMENTOS aceptan descuento; ALCOHOL no). Excepciones se marcan por platillo. El sistema registra cada descuento con quién lo autorizó, en qué platillo, y bajo qué política.

---

#### 02.3.2 Flag: aplica 2x1 / DXU

**Wansoft:** `PORTAL:PV > Restaurante > Platillos > Acepta 2x1 (flag por platillo)`
**Nivel:** Configuración ocasional | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Marca si el platillo puede participar en promociones de tipo "descuento por unidad" (2x1 o DXU — Descuento por Unidad). Al intentar aplicar 2x1 a un platillo sin el flag, el POS muestra "EL PLATILLO 'X' NO ACEPTA 2X1."

**Problema operativo:** Sin esta separación, el 2x1 se convierte en una promoción de precio que el cajero aplica discrecionalmente a cualquier platillo — incluyendo artículos de alta demanda donde el restaurante no necesita promotion para vender. Un 2x1 en chilaquiles a hora pico es ingreso regalado.

**Por qué alguien pagó:** Un bar quería ofrecer 2x1 en cervezas los miércoles como estrategia de tráfico, pero no en cocteles (donde el margen necesario para cubrir el costo del bar es mayor). El distribuidor cobró configurar el flag individualmente para las 40 presentaciones de cerveza.

**Diseño 2026:** El 2x1 es una regla del motor de promociones, no un flag fijo por platillo. El operador define "Miércoles 5-7pm: 2x1 en todos los platillos del grupo CERVEZAS" y el sistema activa y desactiva automáticamente. Cero intervención manual.

---

#### 02.4.1 Modificadores y niveles

**Wansoft:** `PORTAL:PV > Restaurante > Modificadores > Lista + Asignación + Niveles + Adicionales por tipo orden`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define las personalizaciones disponibles por platillo: Nivel 1 = obligatorio (sin gluten / con gluten), Nivel 2 = opcional (extra aguacate +$25). Los modificadores pueden ser diferentes por tipo de orden (presencial vs delivery — en delivery no puedes pedir "sin cebolla" si la receta no admite sustitución).

**Problema operativo:** Un modificador sin nivel fuerza al cajero a decidir cuándo es obligatorio y cuándo es opcional. La cocina recibe comandas ambiguas: "¿Le pusiste la proteína o se la olvidaste?" genera re-fires y tiempo de mesa extendido.

**Por qué alguien pagó:** Un restaurante de bowls con 8 opciones de proteína necesitaba que la proteína fuera obligatoria en todos los bowls, pero opcional en las ensaladas. Wansoft cobró horas de configuración para asignar el nivel correcto a cada platillo por separado (no existía herencia de grupo).

**Diseño 2026:** Los modificadores se crean una vez y se asignan a grupos o platillos. El nivel (obligatorio/opcional) se define en la asignación, no en el modificador en sí. Los modificadores de delivery tienen su propia columna — si un modificador no tiene versión delivery, no aparece en la tablet de UberEats. El POS alerta si un platillo no tiene modificadores obligatorios configurados antes de imprimirse en cocina.

---

#### 02.5.1 Horarios de disponibilidad por platillo

**Wansoft:** `PORTAL:PV > Restaurante > Horarios para platillos`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Permite definir ventanas de tiempo en las que un platillo está disponible para venta. Los chilaquiles solo de 8am a 12pm; las pizzas solo de 12pm a 10pm. Fuera de horario, el platillo aparece en gris o no aparece en el POS.

**Problema operativo:** Sin control de horario, el cajero puede vender un huevo benedictino a las 9pm — cuando la cocina está en modo cena y no tiene los ingredientes preparados. El resultado es un "SE PUEDE HACER" en la comanda que cocina no puede cumplir, platillo cancelado, y cliente insatisfecho.

**Por qué alguien pagó:** Un restaurante de desayunos que abrió servicio de cena sin dividir el menú recibía pedidos de hotcakes a las 8pm. La cocina de cena no tenía maple ni mantequilla preparada. El gerente pedía al cajero que "recordara" no vender esos platillos — fallaba dos veces por semana.

**Diseño 2026:** La disponibilidad es una regla del grupo, no del platillo individual. "Todos los platillos de CROISSANTS BREAKFAST disponibles de 7am-12pm" se define una vez. Excepciones individuales por platillo. El POS no muestra platillos fuera de horario (no los oculta — los mueve a una sección "No disponible ahora" para que el mesero pueda informar al cliente). En delivery, se sincroniza automáticamente con las plataformas.

---

#### 02.6.1 Tipos de precio (por contexto)

**Wansoft:** `PORTAL:PV > Restaurante > Platillos > Precios por tipo de orden`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Permite definir precios diferentes para el mismo platillo según el canal de venta: precio normal (restaurante), precio delivery (UberEats/Rappi — generalmente 15-25% mayor), precio evento (paquete cerrado), precio happy hour.

**Problema operativo:** Rappi cobra entre 18-30% de comisión al restaurante por cada orden. Sin precio diferenciado por canal, el restaurante absorbe esa comisión reduciendo su margen — vende el bowl en $120 en Rappi y recibe $84, mientras que en el restaurante el mismo bowl a $120 deja $90+. El precio de delivery debe compensar la comisión.

**Por qué alguien pagó:** Un restaurante descubrió que su ingreso neto de Rappi era 22% menor que el restaurante a pesar de tener el mismo precio. Configurar precios de delivery en Wansoft requería modificar cada uno de los 200+ platillos individualmente en el portal — el distribuidor cobró el trabajo de carga masiva.

**Diseño 2026:** Los precios de delivery se definen como "precio restaurante × factor de canal" por grupo. BOWLS en Rappi = precio normal × 1.20. El factor es configurable y se aplica automáticamente al publicar el menú en la plataforma. El dashboard muestra margen neto por canal incluyendo la comisión de la plataforma.

---

### 03 FORMAS DE PAGO

#### 03.1.1 Métodos estándar activos

**Wansoft:** `PORTAL:PV > Restaurante > Forma de pago`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define qué formas de pago acepta el restaurante: efectivo, tarjeta crédito, tarjeta débito, transferencia. Solo las formas activas aparecen en la pantalla de cobro.

**Problema operativo:** Un restaurante que no acepta transferencias pero tiene habilitada esa forma de pago recibe pagos que el cajero registra como "transferencia" aunque no los confirma — y al hacer el corte, el efectivo no cuadra porque hay $500 de "transferencia" que nunca llegó al banco.

**Por qué alguien pagó:** Nada sorprendente aquí — es configuración básica. El hallazgo real es que la lista de formas de pago en Wansoft es completamente editable. No hay una lista fija. Eso es lo que permite el resto de los settings de este dominio.

**Diseño 2026:** Las formas estándar (efectivo, tarjeta crédito, débito, transferencia) están pre-configuradas y activas. El operador las desactiva si no las acepta. Las formas custom se agregan aparte. El sistema detecta si "transferencia" nunca tiene coincidencia en el banco y alerta al gerente.

---

#### 03.2.1 Formas de pago custom con nombre propio

**Wansoft:** `PORTAL:PV > Restaurante > Forma de pago > [Crear]`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Permite crear formas de pago con nombres arbitrarios: "Influencer", "Mercadotecnia", "Claudia Sada", "Vale AMALAY", "Venta Terceros", "Pago Open Table". Cada una aparece en los reportes de ventas y en el corte Z, separada del resto.

**Problema operativo:** Sin formas de pago categorizadas, todas las cortesías aparecen juntas como "Cortesía" en el reporte. El gerente no puede saber si el 3% de ventas en cortesías fue a empleados, a influencers, a proveedores, o a amigos del dueño. La auditoría de leakage es imposible.

**Por qué alguien pagó:** Un restaurante con 5+ categorías de cortesía (empleados, prensa, socios, eventos, ajustes) necesitaba separar el gasto por tipo para su contabilidad. El contador rechazó estados de resultados donde aparecía "Cortesía $45,000" sin desglose. El distribuidor de Wansoft cobró configurar cada forma de pago custom con su código contable.

**Diseño 2026:** Las formas de pago custom tienen además un campo "categoría contable" y un campo "requiere PIN de gerente". La forma "Claudia Sada" (una persona real) no debería ser una forma de pago — debería ser una cuenta por cobrar o un beneficio de nómina. Fullsite separa "formas de pago de cortesía categorizadas" de "pagos a crédito a persona identificada."

---

#### 03.2.2 Pago mixto (multi-forma en una cuenta)

**Wansoft:** `NETSILVER > Pantalla de cobro > tabla Forma de Pago/Pagado/Propina + botón Auto`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Permite cobrar una sola cuenta con múltiples formas de pago simultáneas. El cliente paga $150 en efectivo y $145 en tarjeta. El botón "Auto" autocompleta el saldo restante con la forma seleccionada.

**Problema operativo:** Sin pago mixto, el cajero tiene que cobrar el total en una sola forma de pago. Cuando el cliente dice "la mitad en efectivo y la mitad en tarjeta", el cajero tiene que decir "no puedo, escoge uno." El cliente ya tiene el efectivo en la mano. La escena es incómoda y el restaurante puede perder la propina.

**Por qué alguien pagó:** Este es Universal — todo restaurante lo necesita. El hallazgo de Wansoft es la elegancia del botón "Auto": el cajero selecciona "efectivo", escribe $150, el sistema calcula que restan $145 y los asigna automáticamente a tarjeta. Cero aritmética del cajero.

**Diseño 2026:** Igual que Wansoft pero con validación adicional: si el pago mixto incluye "transferencia", el sistema pide el número de referencia bancaria para conciliación. El corte muestra el desglose exacto de qué parte de cada cuenta se cobró por qué forma.

---

#### 03.3.1 IEPS (Impuesto Especial sobre Producción y Servicios)

**Wansoft:** `NETSILVER > Factura electrónica > Desglosar IEPS`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Activa el desglose del IEPS (8% bebidas alcohólicas, 7% bebidas energéticas, 160% tabacos) en las facturas y en el corte Z. El IVA (16%) y el IEPS se calculan y reportan por separado.

**Problema operativo:** Un restaurante que vende alcohol y no desglosa IEPS está incumpliendo su obligación fiscal. En una revisión del SAT, las facturas sin IEPS desglosado para bebidas alcohólicas generan multas. El contador no puede calcular la declaración mensual correctamente.

**Por qué alguien pagó:** AMALAY tiene "Desglosar IEPS" en OFF — probablemente porque la mayor parte de sus ventas no es alcohol y el contador no lo ha requerido todavía. Cuando el contador lo requiera, activarlo retroactivamente implica refacturar o reconocer la deuda con el SAT.

**Diseño 2026:** El sistema detecta automáticamente si el catálogo incluye platillos del grupo ALCOHOL o BEBIDAS OH y alerta al operador durante el onboarding: "Tus productos incluyen bebidas sujetas a IEPS. ¿Deseas activar el desglose? Tu contador lo necesitará para la declaración mensual." No es un toggle enterrado — es una alerta proactiva con consecuencias explicadas.

---

### 04 PROMOCIONES Y DESCUENTOS

#### 04.1.1 Catálogo de descuentos

**Wansoft:** `NETSILVER > Avanzadas (en pantalla de edición) > Aplicar descuento → catálogo`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Lista de descuentos disponibles con nombre, tipo (% o monto fijo), y si el cajero puede aplicarlo solo o requiere PIN de gerente. "10% empleados", "Descuento cliente frecuente $50", "Convenio corporativo 15%".

**Problema operativo:** Sin catálogo, el descuento es libre: el cajero puede escribir cualquier porcentaje y la razón es campo de texto libre. El gerente revisa el corte y ve "Descuento: $450" sin saber si fue 5% o 30%, ni por qué. La auditoría es imposible.

**Por qué alguien pagó:** Un restaurante descubrió que uno de sus cajeros aplicaba "descuento de empleado" a las mesas de sus amigos regularmente. Sin un catálogo con PIN requerido para cada tipo de descuento, no había forma de controlarlo.

**Diseño 2026:** El catálogo incluye "motivo" como campo obligatorio seleccionado antes de aplicar el descuento. Cada descuento aplicado queda en el audit log con: quién lo aplicó, quién lo autorizó (si requiere PIN), el motivo seleccionado, y el platillo afectado. El agente anti-fraude revisa patrones semanalmente.

---

#### 04.2.1 Catálogo de cortesías

**Wansoft:** `NETSILVER > Avanzadas > Aplicar cortesía → catálogo de categorías`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Lista de categorías de cortesía disponibles para cuando una cuenta o platillo sale en $0: "Empleado", "Influencer", "Mercadotecnia", "Ajuste de calidad", "VIP". La cortesía requiere seleccionar categoría — no es libre.

**Problema operativo:** Sin categorías, la cortesía es un número en el corte sin contexto. "Cortesías: $3,200 este mes" no le dice al dueño si eso fue legítimo (empleados comiendo, clientes con problema de calidad) o leakage (amigos del mesero).

**Por qué alguien pagó:** Wansoft obliga a clasificar la cortesía desde el momento de aplicarla. Ese dato no requiere trabajo extra del gerente — es simplemente un paso adicional del cajero que genera datos limpios para auditoría.

**Diseño 2026:** Idéntico a Wansoft pero el agente anti-fraude analiza el ratio cortesía/ventas por cajero semanalmente. Si Omar tiene 2.1% de ventas en cortesías y el promedio del equipo es 0.4%, el sistema alerta al gerente antes de que tenga que buscar el patrón.

---

#### 04.3.1 Motor de 2x1 (DXU — Descuento por Unidad)

**Wansoft:** `NETSILVER > Avanzadas > Aplicar 2x1 (solo en platillos con flag)`
**Nivel:** Configuración ocasional | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Aplica el segundo item del mismo platillo a $0 (o a precio reducido). El flag por platillo controla la elegibilidad. La aplicación es manual — el cajero selecciona el platillo y presiona "Aplicar 2x1."

**Problema operativo:** Un 2x1 manual que depende del cajero para aplicarlo es inconsistente. En hora pico, el cajero olvida aplicarlo. El cliente que sí sabe de la promoción se queja; el que no sabe jamás lo recibe. La experiencia del cliente es aleatoria dependiendo del turno del cajero.

**Por qué alguien pagó:** Un bar quería ofrecer 2x1 en cervezas los miércoles de 5-7pm para generar tráfico. Con el sistema manual de Wansoft, el gerente tenía que recordarle a cada cajero del turno que era "miércoles de 2x1." La mitad de los miércoles alguien se olvidaba.

**Diseño 2026:** El 2x1 es una regla del motor de promociones con condición de día/hora. El cajero no tiene que recordar — si es miércoles entre 5-7pm y el platillo está en el grupo CERVEZAS, el POS aplica el 2x1 automáticamente al agregar el segundo item. El gerente configura la regla una vez y el sistema la ejecuta.

---

#### 04.4.1 Motor de promociones (selección de partidas + regla)

**Wansoft:** `NETSILVER > Avanzadas > Promociones (pantalla 3 columnas: orden / disponibles / aplicadas)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Sistema de promociones por selección: el mesero selecciona partidas de la cuenta, el POS muestra qué promociones aplican a esa combinación, y el mesero aplica la que corresponde. Ejemplo: "Combo Desayuno — bagel + café + jugo = $120 (vs $165 individual)."

**Problema operativo:** Sin motor de promociones, los combos se cobran como descuentos manuales sobre el total — lo que contamina los reportes de ventas por platillo (los tres items se cuentan al precio lleno pero la cuenta refleja un descuento que no está vinculado a ningún item específico).

**Por qué alguien pagó:** AMALAY tiene CERO promociones configuradas en Wansoft — la pantalla está vacía. Esto es estadísticamente representativo: la mayoría de los restaurantes en México no usan el motor de promociones de su POS porque es demasiado complejo de configurar. El distribuidor cobra horas de configuración por cada combo.

**Diseño 2026:** Las promociones se definen como "si el cliente ordena A + B, aplica descuento C sobre el conjunto." El POS sugiere la promoción automáticamente cuando detecta la combinación en la cuenta, sin que el mesero tenga que buscarla. El gerente configura promos en el dashboard en 5 minutos.

---

#### 04.4.2 Descuento prorrateado

**Wansoft:** `NETSILVER > Avanzadas > Descuento prorrateado a la cuenta`
**Nivel:** Configuración ocasional | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Aplica un descuento porcentual al total de la cuenta y lo distribuye proporcionalmente entre todos los platillos. Útil para descuentos de "15% en todo" que deben reflejarse en los reportes de ventas por platillo (no como un descuento colgante del total).

**Problema operativo:** Un descuento sobre el total sin prorratear aparece en el corte como "Descuento: -$200" sin información de qué platillos lo absorbieron. El food cost teórico queda mal calculado porque los ingresos por platillo no reflejan el descuento real recibido.

**Por qué alguien pagó:** Un contador que revisaba el food cost mensual notó que los ingresos por platillo sumaban $180,000 pero la caja reportaba $165,000 — la diferencia eran descuentos no prorrateados que inflaban artificialmente el ingreso por platillo y subestimaban el food cost real.

**Diseño 2026:** Todos los descuentos se prorratean automáticamente entre los platillos de la cuenta, incluyendo la propina cuando corresponde. Los reportes de ventas por platillo reflejan el precio efectivo cobrado, no el precio de lista.

---

### 05 POS — OPERACIÓN GENERAL

#### 05.1.1 Tipo de operación

**Wansoft:** `NETSILVER > Operativas > Tipo de operación (Caja / Mesero / Para llevar / Retail)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Define el rol de la terminal: Caja (cobra y captura), Mesero (solo captura y envía a caja), Para llevar (sin mesa), Retail (artículos con barcode). Cada modo activa un conjunto diferente de botones y flujos.

**Problema operativo:** Una terminal configurada como "Caja" en manos de un mesero permite que el mesero cobre y cierre cuentas sin supervisor — el cobro debería pasar por la caja central para control de efectivo. Sin separación de roles por terminal, el control de efectivo es imposible.

**Por qué alguien pagó:** Un restaurante con 4 mesas y un solo cajero empezó a crecer — abrió una terraza con 6 mesas más. El cajero no podía atender 10 mesas solo. El gerente necesitaba que los meseros de la terraza capturaran pedidos en tabletas pero que el cobro seguiera centralizado. El distribuidor cobró una licencia adicional por la configuración de "modo mesero."

**Diseño 2026:** El rol de la terminal es una asignación de usuario en el perfil de staff, no una configuración de la terminal. El mesero Omar tiene rol "captura" y ve la pantalla de cuentas sin botón de cobro. El cajero Oscar tiene rol "caja" y puede cobrar cualquier cuenta. La tableta es hardware genérico — el rol define lo que ves, no el dispositivo.

---

#### 05.1.2 Tipos de órdenes activos

**Wansoft:** `NETSILVER > Operativas > Tipos de órdenes activos (Restaurante, Para llevar, eCommerce, A domicilio, Por recoger)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define qué canales de venta están activos en el POS. AMALAY tiene activos: Restaurante, Para llevar, eCommerce. Desactivos: A domicilio, Por recoger. Cada tipo activo aparece como opción al abrir una cuenta nueva.

**Problema operativo:** Activar "A domicilio" sin tener repartidores configura activa una pantalla de asignación de repartidores que nunca se usa — confunde al cajero y puede resultar en órdenes atascadas en "pendiente de repartidor."

**Por qué alguien pagó:** El módulo de domicilio en Wansoft requería configurar zonas de entrega, repartidores, y cargo de envío. Un restaurante que lo activó "para probarlo" sin completar la configuración empezó a recibir órdenes de Rappi que el sistema clasificaba como "domicilio propio" y pedía asignar repartidor — bloqueando el flujo.

**Diseño 2026:** Los tipos de orden se configuran durante el onboarding en base a las respuestas del restaurante. "¿Tienes repartidores propios?" → No → el tipo "A domicilio" se desactiva automáticamente. "¿Recibes órdenes de Rappi o UberEats?" → Sí → eCommerce se activa con instrucciones de integración. No hay checkbox suelto que el operador pueda activar sin consecuencias.

---

#### 05.3.1 Sillas / Asientos por partida

**Wansoft:** `NETSILVER > Operativas > Pantalla de captura > Activar funcionalidad de sillas ✓`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Permite asignar cada platillo a un número de asiento dentro de la mesa. La comanda llega a cocina con la etiqueta de silla; el POS puede dividir la cuenta exactamente por persona al cobrar.

**Problema operativo:** Sin sillas, dividir la cuenta de una mesa de 8 personas es una negociación manual. "¿Quién pidió el bowl? ¿Y el croissant era de silla 3 o silla 4?" El mesero recalcula en papel mientras todos esperan. El error es frecuente en mesas corporativas donde cada persona requiere su propio ticket.

**Por qué alguien pagó:** Las sillas en Wansoft estaban activas para AMALAY — confirmado en vivo. Cero duda de que se usan diariamente. El hallazgo más importante: las sillas aparecen tanto en la captura (asignar platillo a silla) como en la comanda (cocina sabe para qué asiento preparar) y en el cobro (dividir por silla). Son una entidad que atraviesa todo el flujo.

**Diseño 2026:** Sillas activas por default en modo restaurante. La silla es un número en la partida (no un campo extra — es parte del item). La división de cuenta respeta sillas: "Mesa 4 → Silla 1: $340 (2 platillos), Silla 2: $220 (1 platillo)." El POS genera automáticamente un ticket por silla sin intervención del mesero.

---

#### 05.4.1 Tiempos de platillo (course management)

**Wansoft:** `NETSILVER > Operativas > Restaurante > Activar tiempos ✓`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Permite separar los platillos de una cuenta en "tiempos" (1er tiempo = entradas, 2do tiempo = platos fuertes, 3er tiempo = postres). El mesero dispara cada tiempo por separado mediante el firebutton. La comanda llega a cocina en el momento correcto — no todo junto al abrir la cuenta.

**Problema operativo:** Sin tiempos, la cocina recibe la comanda completa al abrir la cuenta. El chef prepara todo simultáneamente — las entradas y el plato fuerte llegan a la mesa al mismo tiempo, las entradas frías, la experiencia del cliente deteriorada.

**Por qué alguien pagó:** Los tiempos estaban activos en AMALAY — confirmado en vivo. El separador "XX TIEMPO: 1 XX" aparece como partida en la cuenta. Este es uno de los features más importantes de la operación de piso: sin tiempos, el servicio de mesa se rompe para mesas formales.

**Diseño 2026:** Los tiempos son el default en modo restaurante. El mesero asigna cada platillo a un tiempo al capturar (o el sistema propone tiempo 1 para entradas/sopas, tiempo 2 para platos fuertes basándose en el grupo). El firebutton en el POS es el botón más prominente de la pantalla de captura — no enterrado en un menú. El KDS muestra los tiempos como estados: Pendiente → Disparado → En preparación → Listo.

---

#### 05.5.1 Bloqueo de venta sin stock

**Wansoft:** `NETSILVER > Existencias locales (módulo desactivado en AMALAY)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Cuando está activo, el POS verifica las existencias locales antes de permitir agregar un platillo. Si no hay ingredientes, bloquea la venta. AMALAY lo tiene desactivado deliberadamente.

**Problema operativo:** Bloquear la venta en el POS es la respuesta incorrecta al problema correcto. El problema es "no sé si me quedan ingredientes." Bloquearlo trae un problema peor: el cliente no puede pedir y el mesero no sabe si el inventario está actualizado. En restaurantes con alta rotación de inventario, los datos de existencias rara vez son 100% exactos en tiempo real.

**Por qué alguien pagó:** AMALAY eligió conscientemente no activarlo. "Preferimos nunca decirle no al cliente — el chef adapta o sustituye." Esta decisión operativa refleja una realidad: en un restaurante de volumen, la cocina siempre puede manejar variaciones. Bloquear la venta es un error de diseño disfrazado de control.

**Diseño 2026:** En lugar de bloquear, el sistema alerta. Cuando quedan menos de X porciones de un platillo (calculado desde el ingrediente limitante de la receta), el KDS muestra una cuenta regresiva visible solo para cocina. El mesero puede seguir tomando el pedido; la cocina decide si confirmar o informar que ya no hay. La alerta llega al gerente por Telegram cuando baja del punto de reorden.

---

#### 05.5.2 Edición de cuenta después de preticket

**Wansoft:** `NETSILVER > Seguridad > Permite editar cuenta después de preticket ✓ (AMALAY: ON)`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Controla si el mesero puede modificar una cuenta después de haberla impreso como preticket (la cuenta que el cliente revisa antes de pagar). Si está OFF, el preticket es definitivo — para cualquier cambio se requiere PIN de gerente.

**Problema operativo:** Un preticket que no puede modificarse es un bloqueo operativo: el cliente quiere agregar un café al final, el mesero no puede. Con el flag ON (como en AMALAY), el mesero puede agregar items pero también puede eliminar items ya cobrados antes de cerrar — punto de fraude potencial.

**Por qué alguien pagó:** El restaurante quería flexibilidad para el cliente (agregar café, postre) sin tener que llamar al gerente para cada pequeña adición. La solución de Wansoft es toggle: o el cajero puede todo, o necesita PIN para todo. La granularidad que falta: "puede AGREGAR items después del preticket, pero no puede ELIMINAR sin PIN."

**Diseño 2026:** La edición post-preticket es granular. Agregar items: permitido sin PIN. Eliminar items: requiere motivo (ya preparado / error del mesero) y queda en el audit log. Cambiar precios: siempre requiere PIN de gerente. Esta separación no existe en Wansoft — es una oportunidad de diferenciación en auditoría.

---

### 06 POS — COMANDA

#### 06.1.1 Ruteo de comanda por grupo

**Wansoft:** `NETSILVER > Comanda > Impresoras > Configurar impresión por grupo`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Mapea cada grupo del menú a una impresora de cocina. ALIMENTOS → COCINA CALIENTE (TCP 192.168.x.x). BEBIDAS → BARRA. El mesero dispara la comanda y el sistema envía cada platillo a la impresora correcta automáticamente.

**Problema operativo:** Sin ruteo, toda la comanda va a una sola impresora. En una cocina con barra separada (café, jugos) y cocina caliente, los jugos llegan a la cocina caliente y el chef de barra no se entera de pedidos que debería preparar. Las bebidas se retrasan porque alguien tiene que "pasar el pedido" manualmente entre estaciones.

**Por qué alguien pagó:** AMALAY tiene dos destinos de comanda confirmados: COCINA CALIENTE y BARRA. La configuración es por grupo del menú. El hallazgo crítico: cambiar de modo "por grupo" a "por platillo" pisa la configuración existente — Wansoft advierte antes de hacerlo. Una vez en modo "por platillo", volver a "por grupo" requiere reconfigurar todo desde cero.

**Diseño 2026:** El ruteo es por grupo (configuración más fácil de mantener) con override por platillo cuando un item específico va a una estación diferente a la de su grupo. La configuración es visual: un drag-and-drop del grupo a la impresora. Los cambios son en tiempo real — no requieren reiniciar la terminal.

---

#### 06.1.2 Ruteo de comanda por platillo individual (override)

**Wansoft:** `NETSILVER > Comanda > Impresoras > Configurar impresión por platillo`
**Nivel:** Configuración ocasional | **Frecuencia:** Situacional | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Permite que un platillo específico vaya a una impresora diferente a la de su grupo. Ejemplo: el "Chilaquiles Especiales" es del grupo ALIMENTOS (→ COCINA CALIENTE) pero su preparación especial lo manda también a la BARRA para la salsa.

**Problema operativo:** Una receta que requiere preparación en dos estaciones no tiene forma de mandarse a dos impresoras en el modo por grupo. Sin override por platillo, el mesero tiene que comunicar verbalmente la instrucción a la segunda estación — que a las 2pm de un sábado lleno, nadie escucha.

**Por qué alguien pagó:** El mismo advertencia de Wansoft — cambiar entre modo grupo y modo platillo es destructivo — refleja que muchos restaurantes empezaron con "por grupo" y luego necesitaron excepciones. El distribuidor cobraba la reconfiguración cada vez que el menú cambiaba de forma significativa.

**Diseño 2026:** Las dos modalidades coexisten. El ruteo base es por grupo. Los overrides de platillo son la excepción. El sistema visual muestra el ruteo de cada platillo en el catálogo — si un platillo no tiene ruteo explícito, hereda el de su grupo. La pantalla de configuración muestra cuántos platillos tienen override y cuáles.

---

#### 06.2.1 Campos del encabezado de comanda

**Wansoft:** `NETSILVER > Comanda > Encabezado (12 campos con checkboxes + tamaños de letra)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Define qué información aparece en el encabezado de la comanda que imprime la cocina. Wansoft tiene 12 campos posibles: fecha, terminal, tipo de orden, número de orden, número de mesa, número de personas, nombre de mesero, nombre del cliente, dirección del cliente, etc. Cada campo tiene su propio tamaño de letra.

**Problema operativo:** Una cocina que no ve el número de mesa recibe "Mesa: ---" y tiene que mandar al runner a preguntar "¿para qué mesa es el acai bowl?" En hora pico con 8 comandas esperando, esto genera caos y errores de entrega.

**Por qué alguien pagó:** Los 30 checkboxes de la config de comanda en Wansoft existen porque cada restaurante tiene sus propias prioridades: un bar de 10 mesas necesita solo "Mesa" y "Mesero"; un restaurante con eventos necesita "Nombre del cliente" y "Tipo de orden". La configurabilidad es el producto.

**Diseño 2026:** Tres presets predefinidos: Mínimo (mesa + mesero + items), Estándar (+ tipo de orden + personas + hora), Completo (todos los campos). El operador puede modificar cualquier preset. Un preview en vivo muestra cómo se verá la comanda impresa mientras ajusta los campos. Ningún campo requiere reiniciar la terminal.

---

#### 06.3.1 Texto del firebutton (mensaje de tiempo a cocina)

**Wansoft:** `NETSILVER > Comanda > Tiempos > Texto firebutton`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Define el mensaje que aparece en la comanda cuando el mesero "dispara" un tiempo — la instrucción visible para el chef. En AMALAY: "***PREPARAR Y SAC..." (el texto se trunca en la captura — probablemente "PREPARAR Y SACAR"). Es el aviso de "empieza a preparar este tiempo AHORA."

**Problema operativo:** Sin texto custom, la comanda de tiempo llega a la cocina idéntica a una comanda normal. El chef no sabe si es "empezar a preparar" o "esta es la primera comanda del turno." En cocinas ruidosas, la diferencia entre un tiempo y una comanda nueva determina la prioridad de preparación.

**Por qué alguien pagó:** Diferentes restaurantes tienen diferentes convenciones para el chef. "***PREPARAR Y SACAR" en mayúsculas con asteriscos es la forma de AMALAY de hacer que el chef note visualmente que esto es urgente. La personalización del texto permite adaptar el sistema al idioma de cada cocina.

**Diseño 2026:** El texto del firebutton se configura por estación de cocina. La BARRA puede tener "SERVIR BEBIDAS", COCINA CALIENTE puede tener "***EMPLATAR PLATOS FUERTES". El KDS digital puede además resaltar la tarjeta de tiempo con un borde rojo visible a distancia.

---

#### 06.4.1 Etiquetas de producción (stickers)

**Wansoft:** `NETSILVER > Comanda > Etiquetas > Activar impresión de etiquetas + configurar grupos`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Sub-módulo de la comanda que imprime etiquetas adhesivas (stickers) para marcar preparaciones. Cada etiqueta incluye el nombre del platillo, modificadores, mesa, y hora. Se adhiere al recipiente durante la preparación para identificar qué es de quién.

**Problema operativo:** En una cocina que produce múltiples platillos simultáneamente (5 bowls, 3 ensaladas, 2 paninis), sin etiquetas los recipientes se confunden durante el emplaque. El runner lleva el panini a la mesa que pidió el bowl. La reentrega requiere volver a cocina y el platillo llega frío.

**Por qué alguien pagó:** Las panaderías y cocinas de producción con platillos que se preparan por adelantado necesitan identificar física y claramente cada preparación. Sin etiqueta, la única forma de no confundirse es no preparar nada con anticipación — lo que elimina la ventaja del batch cooking.

**Diseño 2026:** Las etiquetas son una configuración por estación KDS. La estación de BARRA puede imprimir etiquetas para bebidas especiales (batidos con múltiples ingredientes) mientras COCINA CALIENTE no las necesita. El tamaño de la etiqueta y los campos son configurables. En el futuro: código QR en la etiqueta que el runner escanea para marcar el platillo como "en camino."

---

### 07 POS — TICKET

#### 07.1.1 Formato del ticket (campos visibles)

**Wansoft:** `NETSILVER > Ticket > Campos visibles (lista de checkboxes)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Controla qué información aparece en el ticket que recibe el cliente. AMALAY tiene visibles: encabezado, mesa, personas, mesero, hora de entrada, hora de cierre, fecha, pie de página. Invisibles: IVA y subtotal, total por tipo de grupo.

**Problema operativo:** Un ticket con demasiada información (IVA, subtotal, desglose por categoría, código de impuesto) confunde al cliente y hace el ticket más largo — requiere más papel y más tiempo de impresión. Un ticket con muy poca información no sirve como comprobante de pago reconocible.

**Por qué alguien pagó:** El contador de un restaurante necesitaba ver el IVA desglosado en el ticket para su conciliación mensual. El operador del restaurante quería que el ticket fuera corto y limpio para el cliente. La solución de Wansoft es dar el control campo por campo — pero configurar 10 checkboxes uno por uno es trabajo innecesario.

**Diseño 2026:** Dos presets: "Ticket cliente" (limpio: items + total + propina + QR) y "Ticket contable" (completo: items + subtotal + IVA + IEPS + descuentos + total + formas de pago). El "Ticket contable" solo se imprime cuando el cajero lo solicita explícitamente — no por default. El ticket digital (WhatsApp/email) siempre tiene la versión completa con drill-down.

---

#### 07.1.2 Tamaño de papel de impresión

**Wansoft:** `NETSILVER > Ticket > Tamaño de impresión (72mm / 80mm)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define el ancho del papel de la impresora de tickets. 72mm es el más común en terminales pequeñas; 80mm es el estándar de impresoras de mostrador. El layout del ticket se adapta al ancho para maximizar espacio.

**Problema operativo:** Una impresora de 80mm configurada para 72mm deja un margen blanco visible en cada ticket — desperdicio de papel. Una de 72mm configurada para 80mm trunca texto en cada línea.

**Por qué alguien pagó:** AMALAY usa 72mm (confirmado en CAJA-SPEC). Es la única variable de hardware que afecta el layout del ticket del cliente. No hay drama aquí — es configuración básica que debe ser correcta desde el inicio.

**Diseño 2026:** El sistema detecta el modelo de impresora durante el onboarding de hardware y sugiere el tamaño correcto. El operador puede previsualizar cómo queda el ticket antes de guardar la configuración.

---

#### 07.2.1 Propina sugerida en preticket

**Wansoft:** `NETSILVER > Ticket > Preticket > Mostrar propina sugerida ✓ + catálogo de propinas sugeridas`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Imprime en el preticket una tabla de propinas sugeridas que el cliente puede elegir. Ejemplo: "10% = $35 / 15% = $52 / 20% = $70." El cliente no tiene que calcular — solo señala el porcentaje que quiere dejar.

**Problema operativo:** Sin propina sugerida impresa, el cliente tiene que calcular el 15% de $346.50 en la cabeza, con el mesero esperando, y cuando la propina es baja ("le eché $10 porque no supe calcular más") el mesero pierde ingreso por falta de información del cliente.

**Por qué alguien pagó:** El catálogo de propinas sugeridas en Wansoft es configurable (puedes poner los porcentajes que quieras: 10%, 12%, 15%, 18%, 20%). Restaurantes de alta cocina pueden empezar la sugerencia en 18%; cafés informales pueden empezar en 10%. La omisión del cálculo visible es directamente dinero para el mesero.

**Diseño 2026:** La propina sugerida está activa por default. El catálogo de porcentajes se configura una vez (default: 10%, 15%, 20%). El cliente también puede ver la propina sugerida en el ticket digital (WhatsApp/QR) y pagarla directamente con su tarjeta desde el teléfono — sin que el cajero tenga que capturar el monto.

---

#### 07.3.1 QR de autofacturación en ticket

**Wansoft:** `NETSILVER > Factura electrónica > Mostrar QR de código de facturación en ticket ✓`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Imprime un código QR en el ticket de pago que lleva al cliente a un portal de autofacturación. El cliente escanea, captura su RFC, y recibe la factura por correo sin intervención del cajero.

**Problema operativo:** Sin QR de autofacturación, el cliente que necesita factura tiene que: 1) llamar al cajero, 2) dictar RFC y datos fiscales, 3) esperar a que el cajero entre al portal, 4) recibir el CFDI por correo horas después. En restaurantes de zona corporativa, el 30-40% de los clientes piden factura. Ese proceso consume 3-5 minutos por factura — tiempo real del cajero.

**Por qué alguien pagó:** El QR de autofacturación era uno de los diferenciadores de Wansoft frente a competidores más básicos. Lo tiene AMALAY (confirmado en CAJA-SPEC: "Mostrar QR de código de facturación en ticket ✓"). La autofacturación hace la experiencia del cliente mejor y elimina trabajo del cajero.

**Diseño 2026:** El QR va al portal de autofacturación de Fullsite, no a un portal de Wansoft. El cliente captura su RFC, el sistema valida contra el SAT en tiempo real, y el CFDI se timbra automáticamente y llega al correo del cliente en menos de 60 segundos. El cajero no interviene en ningún paso.

---

#### 07.4.1 QR de encuesta en preticket

**Wansoft:** `NETSILVER > Ticket > Generales > QR de encuestas en preticket ✓ (270×270)`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Imprime un código QR en el preticket (la cuenta que el cliente revisa antes de pagar) que lleva a la encuesta de satisfacción. El cliente la responde mientras espera el cambio o mientras firma con tarjeta.

**Problema operativo:** Sin QR de encuesta, la tasa de respuesta a encuestas de restaurantes es inferior al 2% — porque la fricción de "busca la encuesta en Google, busca el restaurante, escribe una reseña" es demasiada para el cliente promedio. El QR en el preticket captura el momento de mayor disposición del cliente (acaba de comer, está satisfecho o insatisfecho y lo siente).

**Por qué alguien pagó:** AMALAY tiene el QR en el preticket activo (tamaño 270×270 px). Es uno de los pocos puntos de contacto donde el cliente activamente espera que ocurra algo — el pago. El QR convierte esa espera en dato.

**Diseño 2026:** El QR lleva a una sola pregunta: "¿Lo recomendarías? (1-5 estrellas)" con un campo de texto opcional. Si la respuesta es 1-2 estrellas, se activa un flujo de recuperación: el gerente recibe alerta en Telegram en tiempo real y puede acercarse a la mesa antes de que el cliente se vaya.

---

### 08 MESAS Y FLOOR PLAN

#### 08.1.1 Mapa visual de mesas (activar/desactivar)

**Wansoft:** `NETSILVER > Mapa de mesas > Activar mapa de mesas (checkbox — AMALAY: OFF)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Activa un editor visual del salón donde las mesas son elementos arrastrables en una planta del espacio. El cajero abre cuentas haciendo click en la mesa en el plano — no escribiendo el número de mesa manualmente.

**Problema operativo:** El mapa visual tiene un costo cognitivo de mantenimiento: cada vez que el restaurante reorganiza el salón, alguien tiene que actualizar el mapa. En restaurantes con layout flexible (eventos, terrazas), el mapa se desactualiza y confunde más de lo que ayuda.

**Por qué alguien pagó:** AMALAY tiene el mapa visual DESACTIVADO deliberadamente. Usan número de mesa directo — el mesero escribe "15" en el numpad. Esto es más rápido para restaurantes donde el layout es estable y el staff conoce los números de memoria.

**Diseño 2026:** El mapa visual está disponible como opción pero no es el default. El default es numeración directa. Para restaurantes que quieren el mapa, el editor drag-and-drop vive en el dashboard (no en la terminal de caja) y los cambios se sincronizan instantáneamente a todas las terminales. La P2 (pos_mesas DB-first) ya resolvió el modelo de datos subyacente.

---

#### 08.2.1 Secciones del salón y sección default

**Wansoft:** `NETSILVER > Mapa de mesas > Permisos por sección + Sección default`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Divide el salón en secciones (Terraza, Salón Principal, Jardín, Privado) y asigna permisos de qué mesero puede operar en cada sección. La sección default determina qué sección abre al iniciar una cuenta nueva.

**Problema operativo:** Sin secciones, cualquier mesero puede abrir una cuenta en cualquier mesa. En un restaurante con terraza asignada a meseros de temporada y salón asignado a meseros permanentes, la mezcla genera disputas de propinas y confusión en la asignación de turno.

**Por qué alguien pagó:** Un restaurante con jardín exterior como espacio premium necesitaba que solo el "mesero de jardín" abriera cuentas ahí — porque ese mesero era el más experimentado y recibía comisión diferenciada. Sin secciones, cualquier mesero abría cuentas en el jardín.

**Diseño 2026:** Las secciones son entidades del floor plan (ya en `pos_mesas`). La asignación de mesero a sección es un turno — al iniciar el turno, el mesero selecciona su sección. El POS filtra las mesas a su sección. El gerente puede ver en tiempo real qué mesero tiene qué mesas y rebalancear desde el dashboard.

---

#### 08.3.1 Capacidad por mesa

**Wansoft:** `NETSILVER > Mapa de mesas > [no explícito — la capacidad se captura al abrir la cuenta como "número de personas"]`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Define el número máximo de comensales que caben en cada mesa. Permite al sistema calcular el índice de ocupación real (personas por mesa vs capacidad de la mesa) y optimizar la asignación de mesas para maximizar el ingreso por metro cuadrado.

**Problema operativo:** Sin capacidad configurada, el POS no puede sugerir "sienten a la mesa 8 que tiene 4 lugares disponibles" cuando llega un grupo de 4. El host asigna mesas manualmente basado en memoria o costumbre — frecuentemente subutilizando mesas grandes y saturando mesas chicas.

**Por qué alguien pagó:** No existe en Wansoft de forma explícita. Es una oportunidad de Fullsite. La capacidad por mesa más el número de personas capturado en cada cuenta permite calcular el ticket promedio por persona por mesa — que es más útil que el ticket promedio global para tomar decisiones de layout.

**Diseño 2026:** La capacidad de cada mesa se define en el editor del floor plan junto con su nombre/número. El sistema calcula ocupación en tiempo real: "Mesa 4 — capacidad 6, actualmente 4 personas (67% ocupada)." El agente de tiempo de mesa usa la capacidad para calcular el ingreso por asiento por hora — la métrica real de eficiencia de salón.

---

### 09 COCINA / KDS

#### 09.1.1 Estaciones de cocina (catálogo)

**Wansoft:** `NETSILVER > Comanda > Impresoras involucradas (catálogo de impresoras de cocina)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define las estaciones de preparación que existen en la cocina. AMALAY tiene: COCINA CALIENTE y BARRA. Cada estación tiene su hardware de salida (impresora o pantalla KDS). Una estación es el destino final de cada platillo según su grupo del menú.

**Problema operativo:** Sin estaciones definidas, la cocina es un cuarto negro — el POS manda "la comanda" pero no sabe ni hay diferenciación entre quién debe preparar qué. La organización de la cocina depende 100% de la tradición verbal del equipo, no del sistema.

**Por qué alguien pagó:** Cada estación adicional es un hardware adicional (impresora o pantalla) que el distribuidor instalaba y cobraba. La configuración de estaciones definía qué platillos iban a qué hardware — trabajo que el distribuidor realizaba durante la instalación y cobraba como "configuración de cocina."

**Diseño 2026:** Las estaciones se crean en el dashboard con nombre, tipo de output (impresora IP, impresora USB, pantalla KDS), y paleta de color para identificación visual en el KDS. Una estación puede tener múltiples dispositivos (duplicar impresión). Los cambios se sincronizan en tiempo real.

---

#### 09.2.1 Ruteo a estaciones KDS

**Wansoft:** `NETSILVER > Comanda > Impresoras > [mismo concepto que 06.1 pero para pantallas digitales]`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define qué grupos del menú van a qué pantalla KDS. Equivalente al ruteo de impresión (06.1) pero para el sistema digital de cocina. Un platillo puede ir simultáneamente a la pantalla KDS y a la impresora de respaldo.

**Problema operativo:** Sin ruteo claro para el KDS, todas las tarjetas aparecen en todas las pantallas — la pantalla de BARRA muestra platillos de cocina caliente y viceversa. El cocinero tiene que revisar visualmente cuáles son suyos en una pantalla llena — tiempo perdido, errores de preparación.

**Por qué alguien pagó:** El KDS digital de Wansoft es básico (ruteo de impresión trasladado a pantalla). Fullsite tiene KDS visual con estados de preparación. El valor real de la pantalla es el estado en tiempo real: Pendiente / En preparación / Listo / Entregado. Ese ciclo completo no existe en Wansoft.

**Diseño 2026:** El ruteo KDS es idéntico al de impresión (configura una vez, se aplica a ambos). El KDS de Fullsite tiene cuatro columnas: Pendiente (naranja) / En preparación (amarillo) / Listo (verde) / Entregado (gris). El chef toca la tarjeta para avanzar el estado. El mesero ve en el POS cuando un platillo está Listo para ir a la mesa.

---

#### 09.3.1 Tiempos de alerta por platillo en KDS

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Define el tiempo estimado de preparación para cada platillo (o grupo). Si el platillo lleva más de ese tiempo en estado "En preparación", la tarjeta en el KDS cambia de color (amarillo → naranja → rojo) para alertar al chef.

**Problema operativo:** Sin referencia de tiempo de preparación, el chef no tiene señal visual de cuándo un platillo lleva demasiado tiempo. Los platillos que fallan en tiempo se detectan cuando el mesero viene a preguntar "¿ya está la mesa 5?" — demasiado tarde para actuar.

**Por qué alguien pagó:** Wansoft no tiene este feature — es exclusivo de Fullsite. El agente `kitchen_quality_agent` ya analiza los tiempos de cancelación como proxy de calidad de cocina. El paso siguiente es darle al chef una señal visual proactiva, no esperar a la cancelación.

**Diseño 2026:** Los tiempos de preparación se configuran por grupo: BOWLS = 8 min, PIZZAS = 14 min, BEBIDAS = 3 min. Los tiempos por platillo individual son override. Con el tiempo de preparación configurado, el agente de cocina puede calcular el ETA de cada mesa y mostrarlo al mesero: "Mesa 4: listo en ~6 min." Los tiempos se calibran automáticamente con el historial real (el sistema aprende cuánto tarda cada platillo en cada turno).

---

#### 09.3.2 Tiempo máximo de mesa (alerta)

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración ocasional | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Define el tiempo objetivo de rotación de mesa según el tipo de servicio. Si una cuenta lleva más de X minutos abierta, el sistema alerta al gerente. Útil para restaurantes con alta demanda donde la rotación es crítica.

**Problema operativo:** Un restaurante con lista de espera y mesas que tardan 2 horas cuando el objetivo es 1 hora está dejando dinero en la mesa — literalmente. Sin visibilidad del tiempo en mesa, el gerente no sabe cuáles mesas están "vencidas" hasta que le llega alguien a reclamar.

**Por qué alguien pagó:** No existe en Wansoft — el agente `table_time_agent` de Fullsite ya analiza esto post-cierre. La oportunidad es moverlo a tiempo real: alerta cuando la mesa supera el objetivo, no cuando ya cerró.

**Diseño 2026:** El tiempo objetivo es configurable por tipo de servicio (desayuno: 45 min, comida: 90 min, cena: 120 min). El dashboard del gerente muestra un semáforo por mesa: verde (dentro del objetivo), amarillo (acercándose), rojo (superado). La alerta llega a Telegram solo si el restaurante tiene lista de espera activa — no sirve alertar de mesas lentas cuando el salón está vacío.

---

---

### 10 HARDWARE E IMPRESORAS

#### 10.1.1 Catálogo de impresoras

**Wansoft:** `NETSILVER > Comanda > Catálogo de Impresoras`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Lista de impresoras registradas con su nombre, tipo de conexión (USB, TCP/IP), dirección (IP o puerto COM), y estado. AMALAY tiene 4: EC TICKET (USB, caja), PANADERIA (TCP, reportes locales), COCINA CALIENTE (TCP), BARRA (TCP).

**Problema operativo:** Una impresora sin nombre descriptivo es "Impresora 1" — cuando falla a las 12pm del viernes, el cajero no sabe si "Impresora 1" es la de barra o la de cocina. El soporte técnico pregunta "¿cuál impresora?" y nadie sabe cómo describirla.

**Por qué alguien pagó:** El distribuidor de Wansoft instalaba las impresoras físicamente, las configuraba en el catálogo con nombre y IP, y cobraba cada visita de soporte cuando una impresora cambiaba de IP por el router. La config vivía en la terminal — si la terminal moría, la config también.

**Diseño 2026:** Las impresoras se registran en el dashboard con nombre, IP, y un test de conectividad desde el browser. La config es cloud — si la terminal falla y se reemplaza con otra, las impresoras ya están configuradas en la nube. El sistema monitorea periódicamente la conectividad de cada impresora y alerta al gerente si alguna deja de responder antes de que el mesero note el problema.

---

#### 10.1.2 Impresora primaria y secundaria por grupo

**Wansoft:** `NETSILVER > Comanda > Impresoras > Configurar impresión por grupo (primaria + secundaria + duplicar)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Cada grupo del menú puede tener impresora primaria (destino principal) e impresora secundaria (respaldo o duplicado). "Duplicar impresión" envía la comanda a ambas simultáneamente.

**Problema operativo:** Si la impresora de COCINA CALIENTE falla durante el servicio, todos los platillos calientes dejan de imprimirse. Sin configuración de respaldo, la solución en tiempo real es "mesero gritando los pedidos a la cocina" — caos total en hora pico.

**Por qué alguien pagó:** Los restaurantes con cocina crítica (cenas de grupo, eventos) configuran duplicado de impresión como respaldo obligatorio. Cuando la impresora falla, la secundaria sigue produciendo. El distribuidor cobraba la configuración del esquema primaria/secundaria como parte del setup inicial.

**Diseño 2026:** La configuración de respaldo es automática: si la impresora primaria no responde en 2 segundos, el sistema redirige a la secundaria y alerta al gerente. El cajero nunca sabe que hubo un fallo — las comandas siguen llegando a cocina. El dashboard muestra el evento en el log de incidencias.

---

#### 10.3.1 Cajón de dinero

**Wansoft:** `NETSILVER > Periféricos > Cajón (impresora asociada + pulso de apertura)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Configura el cajón de dinero: a qué impresora está conectado (via cable RJ-11) y el pulso eléctrico que lo abre. El cajón se abre automáticamente al cobrar con efectivo o al hacer un retiro — no hay botón físico de apertura (o sí lo hay, como auditoría).

**Problema operativo:** Un cajón que se puede abrir manualmente sin registro es un punto de fraude. El cajero puede abrir el cajón entre ventas para tomar efectivo sin que quede registro. El cajón debe abrirse SOLO al registrar una transacción en el POS — y cada apertura debe quedar en el audit log con razón y timestamp.

**Por qué alguien pagó:** En Wansoft, "Abrir Cajón" es un botón en el menú Admin que cualquier usuario de caja puede presionar. En CAJA-SPEC está listado sin restricción de permiso visible. Esto es un gap de auditoría que Fullsite puede resolver: el botón existe pero requiere motivo y genera log.

**Diseño 2026:** El cajón se abre automáticamente al cobrar efectivo, al registrar un retiro, y al hacer un depósito. Cualquier apertura manual requiere seleccionar motivo ("falta de cambio", "conteo de caja", "otro") y queda en el audit log. El agente anti-fraude revisa patrones de apertura sin venta asociada.

---

#### 10.4.1 Etiquetadoras de producción

**Wansoft:** `NETSILVER > Comanda > Etiquetas > Activar + configurar grupos de etiquetas + tamaño`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Configura impresoras de stickers (etiquetadoras tipo Zebra o Brother) para marcar preparaciones de producción. Qué grupos usan etiquetas, qué información va en cada sticker, y el tamaño de impresión.

**Problema operativo:** Ver el entry 06.4.1 — las etiquetas resuelven la confusión de preparaciones en cocinas de volumen. La configuración de la etiquetadora es la parte de hardware del setting.

**Por qué alguien pagó:** Una etiquetadora es hardware diferente a una impresora de tickets — requiere drivers diferentes y configuración de ancho de etiqueta. Wansoft la trata como un tercer tipo de periférico, separado de las impresoras de comanda.

**Diseño 2026:** La etiquetadora se registra igual que cualquier impresora en el catálogo, con un tipo "Etiquetadora" que activa las opciones de tamaño de etiqueta. Los grupos que usan etiquetas se marcan en el catálogo de grupos — no en la configuración de comanda.

---

### 11 TERMINALES BANCARIAS

#### 11.1.1 Procesadores de pago activos

**Wansoft:** `NETSILVER > Terminales bancarias > Clip / Operaciones en Línea / NetPay / BBVA`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Activa la integración nativa con el procesador de pagos. Cuando el cajero selecciona "Pago con tarjeta", el POS se comunica con la terminal bancaria, envía el monto, y recibe la confirmación — sin que el cajero tenga que teclear el monto manualmente.

**Problema operativo:** AMALAY usa terminales Getnet (Santander) que NO está en las integraciones de Wansoft. El cajero teclea el monto a mano en la terminal y en el POS por separado — doble captura, doble posibilidad de error, y cero conciliación automática. El descuadre entre "tarjeta en POS" y "tarjeta en banco" es permanente.

**Por qué alguien pagó:** La integración nativa elimina la doble captura. El POS envía el monto a la terminal, el cliente paga, la terminal confirma, y el POS registra el pago automáticamente. Sin integración, el cajero puede registrar $295 en el POS pero cobrar $250 en la terminal — y quedarse con $45.

**Diseño 2026:** Clip y MP Point son las integraciones prioritarias para Fullsite (ya tenemos ambas). Para terminales sin integración nativa (Getnet, Bambu), el sistema pide al cajero confirmar el monto cobrado y el número de referencia de la terminal — agregando fricción deliberada para audit trail. La conciliación automática diaria compara las transacciones del POS contra las del estado de cuenta bancario.

---

#### 11.2.1 Conciliación automática de pagos electrónicos

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Compara automáticamente las ventas con tarjeta registradas en el POS contra las transacciones confirmadas por el procesador bancario. Detecta diferencias: cobros en terminal que no están en el POS, y registros en el POS que la terminal rechazó.

**Problema operativo:** El descuadre entre POS y banco es uno de los dolores más constantes de los restaurantes. Cada discrepancia requiere revisar tickets impresos, vouchers firmados, y estados de cuenta — proceso manual que toma horas. Los fraudes de "cobrar de más en la terminal y registrar menos en el POS" son invisibles sin conciliación.

**Por qué alguien pagó:** No existe en Wansoft — es una oportunidad enorme. AMALAY tiene Getnet standalone: cero conciliación automática. Cada fin de mes el contador revisa manualmente. El costo de tiempo es real; el costo de los errores no detectados, mayor.

**Diseño 2026:** El agente de conciliación corre cada noche a las 2am. Compara transacciones del POS con el estado de cuenta del procesador (via API de Clip/MP Point). Las diferencias se reportan en el dashboard con detalle de transacción. Discrepancias mayores a $500 generan alerta inmediata a Telegram. La configuración es solo "¿cuál es el umbral de alerta?" — el resto es automatización.

---

#### 11.2.2 Impresión de detalle de pagos bancarios en corte

**Wansoft:** `NETSILVER > Terminales bancarias > Imprimir detalle de pagos bancarios en cortes ✓/✗`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Incluye en el corte Z o de turno el desglose de cada transacción bancaria: número de autorización, monto, hora. AMALAY lo tiene en OFF — el corte solo muestra totales por forma de pago, no el detalle de cada transacción.

**Problema operativo:** Sin detalle de transacciones bancarias en el corte, el cajero no puede verificar que el total de "Tarjeta crédito: $4,320" realmente corresponde a 12 transacciones de amounts específicos. Si hay una discrepancia, no hay forma de saber en cuál transacción ocurrió sin revisar todos los vouchers.

**Por qué alguien pagó:** El detalle alarga el corte físico significativamente (40-50 transacciones × 2 líneas = 1 metro de papel). AMALAY lo tiene apagado probablemente por eso. La solución no es imprimirlo en papel — es tenerlo disponible digitalmente en el corte del dashboard.

**Diseño 2026:** El corte digital siempre incluye el detalle de transacciones bancarias con drill-down. La versión impresa (72mm) muestra solo totales para mantener el papel corto. El gerente puede ver el detalle completo desde el dashboard o Telegram en cualquier momento.

---

### 12 CAJA

#### 12.1.1 Fondo de caja

**Wansoft:** `NETSILVER > Cortes y apertura > [fondo de caja con arqueo]`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define el monto de efectivo que siempre debe estar en el cajón al inicio de cada turno. AMALAY tiene $1,700 MXN. El fondo persiste entre turnos — el cajero saliente no se lleva el fondo, lo deja para el siguiente.

**Problema operativo:** Sin fondo de caja definido, el cajero entrante no sabe cuánto efectivo debe haber en el cajón. Si hay $1,000 cuando deberían ser $1,700, los $700 faltantes podrían ser un error del turno anterior o un faltante. Sin el número de referencia, la discrepancia es imposible de investigar.

**Por qué alguien pagó:** El fondo de caja es el único número que conecta todos los turnos entre sí. La fórmula de arqueo (Fondo + Ventas efectivo + Depósitos - Vales - Propinas tarjeta en efectivo = Efectivo esperado) requiere que el fondo sea un número conocido y consistente.

**Diseño 2026:** El fondo de caja se configura en el onboarding y se registra en la DB del restaurante (no en la terminal local). El sistema calcula el "Efectivo esperado" automáticamente en el corte. Si el cajero declara menos de lo esperado, se activa el flujo de "diferencia de caja": justificación obligatoria antes de cerrar el turno.

---

#### 12.2.1 Retiros de efectivo

**Wansoft:** `NETSILVER > Admin > Retiros (con permiso de gerente escalation in-place)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Permite sacar efectivo del cajón para pagos inmediatos: pago al proveedor que llegó, pago de gas, limpieza de emergencia. Cada retiro tiene monto, motivo, y quién lo autorizó. Disminuye el efectivo esperado en el arqueo.

**Problema operativo:** Un retiro sin registro es dinero que "desaparece" del cajón sin rastro. Al hacer el arqueo, el efectivo no cuadra y nadie sabe por qué. La única investigación posible es revisar recibos físicos de gastos — proceso manual que puede tomar horas.

**Por qué alguien pagó:** El flujo de escalation in-place de Wansoft es brillante: el cajero sin permiso de retiros ve "¿desea apoyo de otra persona?" — el gerente captura su PIN sobre la pantalla del cajero sin que este tenga que desloguearse. El retiro queda registrado con quién lo autorizó. Fullsite ya tiene manager PIN; falta el registro de quién autorizó.

**Diseño 2026:** Todo retiro requiere: monto, motivo seleccionado de un catálogo (proveedor, servicios, emergencia, otro), y PIN de gerente. El audit log registra: cajero que solicitó, gerente que autorizó, monto, motivo, hora. El agente anti-fraude revisa patrones de retiros por cajero vs promedio del equipo.

---

#### 12.3.1 Depósitos de efectivo

**Wansoft:** `NETSILVER > Admin > Depósitos`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Registra cuando el gerente saca efectivo del cajón para depositarlo en el banco antes del cierre. El depósito reduce el efectivo del cajón pero NO reduce las ventas — es una transferencia interna de efectivo a banco.

**Problema operativo:** Sin registro de depósitos en el POS, el arqueo de caja no cuadra. El efectivo esperado es $8,500 pero en el cajón hay $2,000 — los $6,500 de diferencia fueron al banco, pero el sistema no lo sabe y registra una "diferencia de caja" incorrecta.

**Por qué alguien pagó:** El flujo de retiros programados de Wansoft (NETSILVER > Retiros > "Forzar retiro al acumular $X de ventas") es un paso más avanzado: el sistema alerta automáticamente cuando el efectivo en caja supera un umbral y sugiere hacer un depósito parcial para reducir el riesgo de robo.

**Diseño 2026:** Los retiros programados están configurados: si el efectivo en caja supera $5,000 MXN (configurable), el sistema alerta al gerente por Telegram. El gerente hace el depósito, captura el monto y el banco destino en el POS, y el sistema actualiza el efectivo esperado automáticamente.

---

#### 12.4.1 Arqueo de caja

**Wansoft:** `NETSILVER > Cortes y apertura > Arqueo de caja (desactivado en AMALAY)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Proceso formal de conteo físico del efectivo en el cajón al cierre del turno. El cajero cuenta billete por billete y moneda por moneda, captura el total en el sistema, y el sistema compara contra el esperado — mostrando la diferencia.

**Problema operativo:** AMALAY tiene el arqueo desactivado — el cajero simplemente declara el monto de efectivo sin contarlo formalmente. Esto es un punto de fraude: si el cajero sabe que no hay arqueo, puede declarar un número conveniente sin contar.

**Por qué alguien pagó:** Wansoft tiene arqueo con denominaciones (cuántos billetes de $500, cuántos de $200, cuántos de $100...) y hasta 3 intentos antes de que se fuerce el cierre. Es sobre-engineered para la mayoría de los restaurantes — pero para restaurantes con mucho efectivo (bares, antros), el conteo por denominación es la única forma de detectar discrepancias chicas.

**Diseño 2026:** Arqueo opcional pero recomendado. Si está activo, el cajero captura billetes por denominación (la app calcula el total). El sistema compara contra el esperado y muestra la diferencia con tres estados: OK (diferencia < $10), Advertencia ($10-100), Diferencia significativa (>$100 — requiere justificación antes de cerrar).

---

#### 12.5.1 Apertura formal del turno

**Wansoft:** `NETSILVER > Cortes y apertura > Apertura de caja > llenar fondo con efectivo real del Z anterior`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Formaliza el inicio del turno con una cuenta del fondo de caja. El cajero entrante confirma que el fondo es correcto (o captura la cantidad real). Sin apertura formal, el turno empieza sin verificación del estado del cajón.

**Problema operativo:** Sin apertura formal, si el fondo está incompleto (el turno anterior tenía diferencia de caja y no la repuso), el cajero entrante lo descubre horas después cuando su propio arqueo no cuadra. El error no es de él pero queda atribuido a su turno.

**Por qué alguien pagó:** La apertura formal protege al cajero entrante. Si confirma formalmente "el fondo son $1,700 MXN" al inicio de su turno, cualquier discrepancia al cierre es responsabilidad del turno actual — no puede provenir del turno anterior.

**Diseño 2026:** La apertura de turno es un flujo de 30 segundos: "¿El fondo está completo? Confirmar $1,700 MXN." Si el cajero reporta diferencia, la discrepancia se atribuye automáticamente al turno anterior y genera una alerta al gerente. El flujo se hace desde el POS antes de la primera venta del turno.

---

### 13 CORTES

#### 13.1.1 Tipos de corte activos

**Wansoft:** `NETSILVER > Cortes y apertura + menú Admin > Realizar corte (4 tipos visibles: X, Turno, Z, Mesero)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Define cuáles de los 5 tipos de corte están disponibles para el usuario. Wansoft tiene: Corte X (parcial), Corte de Turno, Corte Z (fiscal), Corte Global, Corte de Mesero. Fullsite actualmente tiene solo Corte de Turno.

**Problema operativo:** Sin Corte X, el gerente no puede hacer un "¿cómo vamos?" a media jornada sin cerrar el turno. Sin Corte Z numerado consecutivamente, la secuencia fiscal para el SAT no está completa. Sin Corte de Mesero, los meseros no pueden verificar sus propias ventas y propinas al final de su turno.

**Por qué alguien pagó:** Los 5 tipos de corte representan 20 años de descubrir que los restaurantes necesitan visibilidad en diferentes momentos y para diferentes audiencias. El dueño necesita el Z diario. El mesero necesita el corte de mesero para calcular sus propinas. El gerente necesita el X para tomar decisiones en tiempo real.

**Diseño 2026:** Los 5 tipos se implementan en Fullsite con el formato del ticket de corte de AMALAY como referencia exacta (documentado en CAJA-SPEC 14.2). Cada tipo es un sub-permiso configurable por rol: los meseros pueden ver su propio corte de mesero pero no el Z.

---

#### 13.1.2 Corte X — parcial sin cierre de turno

**Wansoft:** `NETSILVER > Admin > Realizar corte > Corte X`
**Nivel:** Configuración ocasional | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Genera un reporte de ventas del turno hasta ese momento sin cerrar ni reiniciar nada. El cajero sigue vendiendo. Es el "¿cómo vamos?" del gerente a media jornada: ventas actuales, propinas, efectivo en caja, cancelaciones.

**Problema operativo:** Sin Corte X, la única forma de saber "cómo va el día" es o abrir el portal de Wansoft (que puede estar desactualizado) o cerrar el turno (irreversible). En un restaurante que abre de 8am a 10pm, el dueño necesita saber a las 2pm si van bien para decidir si acepta una reservación grande de última hora.

**Por qué alguien pagó:** El Corte X es la versión impresa del dashboard en tiempo real — para restaurantes donde el dueño no está mirando una pantalla sino trabajando. Es la única forma de tener un "snapshot" oficial sin interrumpir la operación.

**Diseño 2026:** El Corte X en Fullsite es el dashboard en tiempo real. El dueño no necesita un papel — recibe el KPI del momento en Telegram cuando pregunta "¿cómo vamos?" al agente. El corte impreso sigue disponible para los que necesitan papel (inspecciones, revisiones de efectivo), pero no es la fuente primaria de información.

---

#### 13.2.1 Corte Z — cierre fiscal del día

**Wansoft:** `NETSILVER > Admin > Realizar corte > Corte Z (numerado consecutivamente)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Cierra el día fiscal. Los totales del Corte Z son los que van a la contabilidad del día. El número de Z es consecutivo (Z001, Z002...) y no puede tener huecos — un Z faltante en la secuencia es una señal de fraude para el SAT.

**Problema operativo:** Sin número de Z consecutivo, el contador no puede verificar que todos los días fueron reportados. Un restaurante que "saltó" el Z del martes porque el sistema falló queda con un hueco en la secuencia que tiene que justificarse ante el SAT en caso de auditoría.

**Por qué alguien pagó:** La numeración consecutiva del Z es un requisito legal en México — es parte de las obligaciones fiscales del contribuyente. Los restaurantes que no tienen Z numerado (o que tienen gaps) están expuestos a multas y requerimientos del SAT.

**Diseño 2026:** El Z se genera automáticamente al cierre del día con numeración consecutiva en la DB (no en la terminal local). Si un día falla sin Z, el sistema registra el evento y genera el Z de cierre de día siguiente con una nota de "día anterior sin cierre formal." El contador puede descargar todos los Z del año en un reporte fiscal consolidado.

---

#### 13.3.1 Horas máximas de turno

**Wansoft:** `NETSILVER > Cortes y apertura > Corte Z y Global > Horas máximas para corte: 9`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Si un turno lleva más de X horas sin hacer corte, el sistema muestra una advertencia o bloquea nuevas ventas hasta que se haga el corte. AMALAY tiene 9 horas como máximo.

**Problema operativo:** Un turno de 12 horas sin corte significa que el efectivo del cajón ha acumulado $15,000+ sin control. El riesgo de robo aumenta proporcionalmente con el tiempo. Además, un turno demasiado largo sin corte puede contaminar las estadísticas de un día Z con ventas del día anterior.

**Por qué alguien pagó:** Restaurantes con operación continua (cafeterías 24 horas, restaurantes de aeropuerto) necesitan que el sistema obligue el corte de turno antes de que el efectivo sea inmanejable — sin depender del criterio del cajero.

**Diseño 2026:** El límite de horas de turno es configurable (default: 12 horas). Si el turno supera el límite, el POS muestra un banner prominente "Turno abierto hace 12h — realiza el corte antes de continuar." No bloquea ventas (para no interrumpir la operación) pero sí alerta al gerente por Telegram.

---

#### 13.4.1 Envío digital de cortes

**Wansoft:** `NETSILVER > Cortes y apertura > Envío por email (apertura/corte turno/corte global — todo OFF en AMALAY)`
**Nivel:** Configuración ocasional | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Envía automáticamente el reporte del corte por email cuando se genera. AMALAY lo tiene apagado — el dueño nunca recibe los cortes digitalmente; tiene que ir al portal de Wansoft a buscarlos.

**Problema operativo:** Un dueño que no está en el restaurante no puede verificar que el corte del turno nocturno cuadró correctamente hasta que llega al día siguiente. Si hubo una diferencia de caja significativa, lo sabe 12 horas después.

**Por qué alguien pagó:** El email de cortes en Wansoft es la única forma de notificación proactiva que tiene el sistema. Todo lo demás requiere que el usuario vaya al portal a buscar información. AMALAY no lo usa, probablemente porque los emails de Wansoft no son legibles en mobile — son PDFs adjuntos con el formato de ticket.

**Diseño 2026:** El corte se envía a Telegram en lugar de email (dónde ya está el dueño). El formato es un mensaje estructurado con los KPIs del turno: ventas totales, efectivo declarado vs esperado, diferencia, total propinas, número de órdenes. Un link lleva al corte completo en el dashboard. El dueño puede responder directamente desde Telegram si hay algo que investigar.

---

### 14 SEGURIDAD Y AUDITORÍA

#### 14.1.1 Audit log (siempre activo)

**Wansoft:** `NETSILVER > Seguridad > Guardar logs de acciones (checkbox — AMALAY: OFF)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** En Wansoft es un checkbox que el operador puede apagar. Si está OFF (como en AMALAY), no hay registro de quién canceló qué, quién dio descuento, quién aplicó cortesía, ni quién cambió la forma de pago de una venta cobrada.

**Problema operativo:** Sin audit log, el fraude es indetectable hasta que la diferencia acumulada es tan grande que el balance no puede ignorarse. Un cajero que aplica cortesías a sus amigos 3 veces por semana puede hacer $2,000-3,000 mensuales de leakage sin que nadie lo note en meses.

**Por qué alguien pagó:** En Wansoft el audit log consume espacio en la DB local de la terminal — que eventualmente se llena (de ahí el botón "Depurar BD" en el menú Admin). La solución de Wansoft fue hacerlo opcional. La solución correcta es almacenarlo en la nube.

**Diseño 2026:** En Fullsite el audit log es siempre activo, no configurable, y vive en Supabase — no en la terminal local. No hay límite de retención. Cada evento registra: operación, usuario, mesa, monto, timestamp, y IP. El agente anti-fraude lo analiza semanalmente. Esto es un argumento de venta directo: "Con Fullsite, tu restaurante tiene audit trail permanente aunque el cajero lo quisiera desactivar."

---

#### 14.1.2 Permisos de escalation por categoría

**Wansoft:** `NETSILVER > Seguridad > Permisos de gerente (6 catálogos configurables)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Define qué operaciones requieren PIN de gerente para ejecutarse. Wansoft tiene 6 catálogos separados: (1) platillos que requieren gerente, (2) grupos que requieren gerente, (3) formas de pago que requieren gerente, (4) descuentos permitidos al cajero, (5) cortesías permitidas al cajero, (6) cancelaciones/anulaciones/devoluciones que requieren gerente.

**Problema operativo:** Sin granularidad de permisos, el cajero tiene acceso total o acceso mínimo. "Total" es un riesgo de fraude. "Mínimo" genera fricción en cada transacción normal porque el gerente tiene que estar presente. La granularidad resuelve la tensión: el cajero puede hacer lo rutinario, el gerente autoriza lo excepcional.

**Por qué alguien pagó:** Un restaurante donde el gerente tiene que aprobar cada descuento tiene al gerente corriendo por el salón en hora pico. Un restaurante donde el cajero puede aplicar cualquier descuento tiene leakage garantizado. Los 6 catálogos de Wansoft son la solución: el cajero puede el "10% empleados" sin PIN, pero el "25% gerencia" siempre requiere PIN.

**Diseño 2026:** La matriz de permisos de escalation es parte del perfil de rol del cajero. Se define en el dashboard como una tabla: columnas = tipos de operación (descuentos, cortesías, cancelaciones, cambio de forma de pago), filas = catálogos específicos, celdas = "sin PIN", "con PIN", o "prohibido." El gerente puede ver y modificar la matriz en 5 minutos desde el móvil.

---

#### 14.1.3 Escalation in-place (PIN de gerente sin cerrar sesión)

**Wansoft:** `NETSILVER > Flujo de escalation → "¿desea apoyo de otra persona con permiso?" → numpad de gerente`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Cuando el cajero intenta una operación que requiere permiso de gerente, el POS muestra "¿Desea apoyo de otra persona con permiso? Sí/No." Si el cajero dice Sí, aparece un numpad para que el gerente capture su PIN — sin cerrar la sesión del cajero. La operación se ejecuta bajo la autorización del gerente.

**Problema operativo:** Sin escalation in-place, el cajero tiene que cerrar su sesión, el gerente inicia sesión, ejecuta la operación, cierra sesión, y el cajero vuelve a iniciar sesión. En hora pico, ese proceso de 2 minutos ocurre 5-10 veces por turno — 10-20 minutos de fricción operativa que el cliente siente.

**Por qué alguien pagó:** La elegancia de Wansoft aquí es que el gerente puede autorizar sin estar físicamente en la caja todo el tiempo — solo cuando se le llama. Y la pantalla del cajero permanece activa, con la cuenta del cliente visible, lo que acelera el proceso.

**Diseño 2026:** Fullsite tiene manager PIN pero falta el flujo completo de escalation in-place. La pantalla de escalation debe mostrar: la operación que se está autorizando, el monto, la cuenta afectada, y capturar el PIN del gerente. El evento queda en el audit log con el nombre del gerente que autorizó — campo que Wansoft no registra porque su audit log estaba apagado.

---

#### 14.2.1 Cancelación de cuentas/platillos de días anteriores

**Wansoft:** `NETSILVER > Seguridad > Cancelar ventas de días anteriores (OFF en AMALAY)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Controla si el cajero puede cancelar una venta de un día anterior (un Z ya cerrado). Si está OFF, las ventas históricas son intocables — cualquier ajuste debe hacerse como nota de crédito, no como cancelación retroactiva.

**Problema operativo:** Cancelar ventas de días anteriores es el mecanismo de fraude más elegante: el cajero cobra la venta, cierra el turno, y al día siguiente cancela retroactivamente la venta y se queda con el efectivo. Sin esta restricción, el fraude es silencioso y difícil de detectar.

**Por qué alguien pagó:** AMALAY tiene este flag en OFF — no se pueden cancelar ventas de días anteriores. Esta es una de las configuraciones de seguridad correctamente configuradas en AMALAY. El hallazgo más importante: Wansoft permite activarlo (para operaciones legítimas como devoluciones tardías), pero la activación debe requerir aprobación del contador, no ser un toggle del gerente.

**Diseño 2026:** Las cancelaciones post-Z no existen en Fullsite — se manejan como notas de crédito con CFDI de cancelación. El sistema no permite modificar registros históricos de ventas. Cualquier ajuste genera un nuevo documento (nota de crédito) que queda en el audit log junto con el documento original. Esta inmutabilidad es un argumento de venta legal: "Tus registros son auditables e inalterables."

---

#### 14.2.2 Cambio de forma de pago post-cobro

**Wansoft:** `NETSILVER > Admin > Cambiar forma de pago (post-cobro)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Permite modificar la forma de pago de una venta ya cobrada. Ejemplo: el cajero registró la venta como "efectivo" pero en realidad fue con tarjeta — necesita corregir el registro.

**Problema operativo:** Cambiar la forma de pago post-cobro es el segundo mecanismo de fraude más elegante (después de cancelaciones retroactivas). El cajero cobra en efectivo, registra como "tarjeta," y se queda con el efectivo. Sin restricción y sin audit trail, es invisible.

**Por qué alguien pagó:** AMALAY tiene "Cambio forma de pago de días anteriores" en OFF — no se puede cambiar formas de pago de días pasados. El botón "Cambiar forma de pago" existe en el menú Admin para el día actual. Eduardo en la reunión del 05-27 específicamente pidió que esto requiriera aprobación y dejara trail. Es un blocker de fraude real.

**Diseño 2026:** El cambio de forma de pago del día actual requiere PIN de gerente y motivo obligatorio. El cambio genera un registro inmutable en el audit log: forma original, forma nueva, monto, razón, quién lo autorizó, timestamp. El agente anti-fraude detecta si un cajero específico cambia formas de pago con frecuencia inusual.

---

### 15 PROPINAS

#### 15.1.1 Propinas activas y modo de captura

**Wansoft:** `NETSILVER > Cierre de cuentas > Activar propina ✓ + Mostrar propinas en corte ✓`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Activa el campo de propina en la pantalla de cobro. Cuando está activo, el cajero puede capturar la propina del cliente (en efectivo o cargada a tarjeta). Las propinas aparecen como línea separada en el corte.

**Problema operativo:** Sin propina formal en el sistema, las propinas son cash entre el cliente y el mesero — sin registro, sin auditoría, y sin forma de hacer un reparto justo entre el equipo. El sistema de propinas es uno de los temas más sensibles del restaurante: cualquier sospecha de robo genera conflicto en el equipo.

**Por qué alguien pagó:** El sistema de propinas de Wansoft es más complejo de lo que parece: la propina puede ser en efectivo (el mesero la recibe directo) o cargada a la cuenta (el cajero la cobra junto con la cuenta y después la distribuye). El modo de captura determina el flujo contable.

**Diseño 2026:** Las propinas están activas por default. El campo de propina en la pantalla de cobro acepta tanto monto fijo como porcentaje. El catálogo de propinas sugeridas (07.2.1) pre-llena las opciones. Propinas en tarjeta se registran en el sistema y se distribuyen al cierre del turno según el modelo del restaurante.

---

#### 15.2.1 Porcentaje de venta que el mesero paga al pool

**Wansoft:** `NETSILVER > Propinas > Porcentaje de venta que el mesero pagará: 5`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Define el porcentaje de su venta total que cada mesero "aporta" al fondo de propinas del turno — para cubrir comisiones de tarjeta y compensar a otros roles (hostess, runner, garrotero). AMALAY: 5%. Sobre ventas totales del mesero, no sobre las propinas recibidas.

**Problema operativo:** Sin este mecanismo formal, los meseros que reciben propinas en efectivo retienen el 100% sin contribuir a los costos de tarjeta que generan cuando el cliente paga con tarjeta. Genera inequidad entre el mesero de "mesa de efectivo" y el de "mesa de tarjeta."

**Por qué alguien pagó:** El modelo de propinas mexicano es diferente al anglosajón: aquí el mesero "paga" un porcentaje al restaurante (fondo común), no al revés. Configurar este porcentaje correctamente es crítico para el modelo financiero de propinas — y Wansoft lo hace en la sección de configuración de propinas de la terminal.

**Diseño 2026:** El porcentaje de aportación al pool es configurable por sucursal. El sistema calcula automáticamente cuánto aporta cada mesero basado en sus ventas del turno. El corte de mesero muestra: ventas brutas, aportación al pool (5%), propinas recibidas, y neto a pagar. El `tips_analyzer` ya usa este dato — falta la configuración formal en el POS.

---

#### 15.3.1 Cambio como propina en pagos bancarios

**Wansoft:** `NETSILVER > Cierre de cuentas > Incluir el cambio como propina en pagos con cuenta bancaria ✓ (AMALAY: ON)`
**Nivel:** Configuración ocasional | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Cuando el cliente paga con tarjeta y hay "cambio" (porque el monto autorizado es mayor que la cuenta), ese diferencial se registra automáticamente como propina en vez de devolverse al cliente. Ejemplo: cuenta $185, tarjeta autorizada por $200 → $15 van como propina.

**Problema operativo:** Sin esta regla, los $15 de diferencia quedan como "saldo pendiente" que el sistema no sabe cómo manejar. El cajero tiene que decidir en el momento qué hacer — y cualquier decisión ad-hoc sin registro es un punto de inconsistencia en el arqueo.

**Por qué alguien pagó:** AMALAY tiene esta regla activa. Es un default cultural en muchos restaurantes mexicanos: el cambio chico no se devuelve al cliente — se queda como propina. El sistema formaliza esa práctica con un registro limpio en vez de dejarla al criterio del cajero.

**Diseño 2026:** Esta regla es configurable por sucursal con un umbral mínimo (no activar si el diferencial es menor a $5 — podría ser un error del cajero, no un redondeo intencional). El sistema informa al cajero explícitamente: "El cambio de $15 se registrará como propina. ¿Confirmar?" — el cliente ve la pantalla y puede rechazar si prefiere el cambio en efectivo.

---

#### 15.4.1 Distribución de propinas por puesto

**Wansoft:** `PORTAL > Módulo de propinas > Fondo + reporte (desglose por mesero)`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Define cómo se distribuyen las propinas del turno entre los diferentes puestos: meseros (100% individual) vs pool compartido (entre mesero, garrotero, runner, hostess). La distribución puede ser por partes iguales, por porcentaje del rol, o por ventas individuales.

**Problema operativo:** En restaurantes con trabajo en equipo (runner lleva los platillos, garrotero repone agua, hostess asigna mesas), el mesero recibe la propina pero beneficia de todo el equipo. Sin un modelo de distribución formal, los conflictos son frecuentes y dañan el ambiente de trabajo.

**Por qué alguien pagó:** Wansoft tiene un módulo completo de propinas con fondo, reporte por mesero, y el "plaque" (monto base que se asigna a ciertos roles independientemente de las ventas). El plaque es la compensación fija del garrotero que no tiene ventas propias pero contribuye al servicio.

**Diseño 2026:** La distribución de propinas es configurable: % por rol (mesero 70%, runner 20%, garrotero 10%) o distribución proporcional a las ventas de cada mesero. El sistema calcula automáticamente la distribución al cierre del turno y genera un comprobante por empleado. El `tips_analyzer` ya analiza la distribución histórica — el siguiente paso es configurar el modelo de distribución en el POS.

---

### 16 USUARIOS Y ROLES

#### 16.1.1 Staff del POS (catálogo de empleados)

**Wansoft:** `PORTAL:ADMIN > Usuarios de punto de venta`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define los empleados que pueden iniciar sesión en el POS: nombre, PIN, puesto, y perfil de permisos. Cada empleado tiene un PIN de 4 dígitos único. El POS identifica quién está operando en cada momento por su PIN.

**Problema operativo:** Sin catálogo de empleados, el POS no puede atribuir ventas, propinas, cancelaciones, ni descuentos a un cajero específico. Todo queda como "anónimo" — imposible el corte de mesero, el análisis de propinas, ni la detección de fraude por empleado.

**Por qué alguien pagó:** Wansoft incluye en el catálogo "empleados utilitarios" como APLICACIONES, PRUEBAS 1, MESERO EVENTO — cuentas del sistema que no son personas reales pero necesitan aparecer en la lista de meseros para asignar ciertos tipos de órdenes. Esta práctica revela que el catálogo de empleados no es solo "gente que trabaja aquí" sino también "agentes del sistema."

**Diseño 2026:** Los empleados del POS se sincronizan desde el módulo de RRHH — no hay dos catálogos separados. Los "empleados utilitarios" son cuentas de sistema explícitas (tipo = "sistema") que no aparecen en reportes de ventas por mesero ni en propinas. La foto del empleado (opcional) aparece en el POS para que el gerente identifique visualmente quién está en caja.

---

#### 16.2.1 Perfiles de permisos POS

**Wansoft:** `PORTAL:ADMIN > Perfil de usuario de punto de venta`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Plantillas reutilizables de permisos para el POS. En vez de configurar 50+ permisos por empleado, se asigna el perfil "Cajero" o "Mesero" que ya tiene los permisos correctos. Cambiar el perfil de un empleado actualiza todos sus permisos en un solo paso.

**Problema operativo:** Sin perfiles, agregar un nuevo empleado requiere configurar sus permisos desde cero. Con alta rotación de personal (3-6 meses promedio en restaurantes), esto significa configurar nuevos empleados semanalmente. El gerente que no tiene perfiles configurados termina asignando acceso total "para que no moleste" — que es exactamente el escenario de fraude.

**Por qué alguien pagó:** Los perfiles son una inversión de setup de 30 minutos que ahorra 5 minutos por cada empleado nuevo. En un restaurante con 20 empleados y 50% de rotación anual, eso es 50 minutos anuales de trabajo vs 100 minutos sin perfiles. La diferencia real es que los perfiles garantizan consistencia — sin perfiles, cada empleado tiene permisos ligeramente diferentes que nadie documenta.

**Diseño 2026:** Cuatro perfiles default: Cajero, Mesero, Gerente, Administrador. El gerente puede crear perfiles custom. Cada perfil tiene una matriz de permisos visual (lo mismo que en 14.1.2) que el gerente puede revisar antes de asignar. Los perfiles se sincronizan a todas las terminales instantáneamente.

---

#### 16.3.1 Permisos del portal web (dashboard)

**Wansoft:** `PORTAL:ADMIN > Usuarios de portal web + Perfil de usuario portal web`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Sistema de permisos separado del POS para el acceso web: quién puede ver reportes, quién puede modificar el menú, quién puede aprobar órdenes de compra, quién puede acceder a la contabilidad. El contador y el gerente tienen permisos de portal muy diferentes al cajero.

**Problema operativo:** Un restaurante donde "todos tienen la contraseña del portal" no tiene control de qué información ve quién. El proveedor puede ver las ventas brutas si alguien le compartió el login. El cajero puede ver y editar precios del menú.

**Por qué alguien pagó:** Wansoft tiene dos sistemas de permisos completamente independientes: el del POS y el del portal web. Esta separación es correcta — el cajero necesita permisos específicos en la caja que son completamente diferentes a lo que necesita el contador en el portal.

**Diseño 2026:** El dashboard de Fullsite tiene permisos granulares (ya implementados con 269 acciones). Los perfiles de portal son: Dueño (acceso total), Gerente (sin contabilidad avanzada ni config de precios), Contador (solo reportes financieros y facturación), Staff (solo su área operativa). El dueño puede crear perfiles custom.

---

### 17 RECURSOS HUMANOS

#### 17.1.1 Turnos y calendario de trabajo

**Wansoft:** `PORTAL > Egresos > Nómina > Turnos (calendario + lista)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define los turnos de trabajo del restaurante: nombre (Turno Matutino, Turno Vespertino), horario de inicio/fin, días de la semana activos. Los turnos son la base de la programación semanal y del control de asistencia.

**Problema operativo:** Sin turnos formalizados, el control de asistencia es "el gerente recuerda qué hora entró cada quien." Con alta rotación y múltiples empleados, esa memoria falla constantemente. Las discrepancias en el cálculo de horas trabajadas generan conflictos con el personal.

**Por qué alguien pagó:** El módulo de nómina completo de Wansoft (del que deliberadamente no copiamos la nómina en sí) tiene los turnos como entidad base. Los turnos se usan para calcular horas trabajadas, incidencias, y pago. Fullsite usa los turnos para programación y control de acceso — sin entrar en cálculo de nómina.

**Diseño 2026:** Turnos configurados en el dashboard con nombre, horario, y días. El POS usa el turno activo para determinar qué cajero está en función. El check-in se registra contra el turno programado: si el empleado entra 15 minutos tarde, el sistema lo registra como "retardo." El gerente ve esto en tiempo real desde el móvil.

---

#### 17.4.1 Método de check-in del empleado

**Wansoft:** `NETSILVER > Admin > Huella digital (biométrico DigitalPersona 4500)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define cómo verifica su identidad el empleado al iniciar turno: huella digital (biométrico), PIN de 4 dígitos, o PIN desde app móvil. El método afecta la velocidad del check-in y la posibilidad de "marcar" por otro empleado.

**Problema operativo:** La huella digital es el método más seguro (no puedes marcar por otro) pero el más frágil. AMALAY tiene problemas de lectura con el lector DigitalPersona USB — que rechaza huellas secas, callosidades, y dedos sucios (frecuente en personal de cocina). El sistema se convierte en un blocker de operación.

**Por qué alguien pagó:** El distribuidor de Wansoft vendía el lector biométrico como parte del paquete de "control de acceso." Pero el lector DigitalPersona 4500 es hardware legacy con problemas documentados de lectura en entornos de cocina. El restaurante pagó por seguridad y obtuvo fricción operativa.

**Diseño 2026:** PIN de 4 dígitos es el default — funciona en cualquier dispositivo, es rápido, y no requiere hardware adicional. La app móvil con geolocalización es el upgrade: el empleado hace check-in desde su teléfono y el sistema verifica que esté dentro del radio del restaurante (no puede hacer check-in desde casa). La huella biométrica es una opción avanzada para quien la quiera, no el default.

---

#### 17.3.1 Días de asueto

**Wansoft:** `PORTAL > Egresos > Nómina > Días de asueto`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Calendario de días festivos que afectan la operación del restaurante. Determina si un día festivo es "día normal con pago doble" o "día cerrado." El cálculo de nómina y la programación semanal consideran este calendario.

**Problema operativo:** Un restaurante que no tiene configurados los días de asueto programa empleados en días festivos como días normales — sin considerar el pago doble obligatorio de ley. Al final del mes, el contador descubre que falta dinero para pagar correctamente el 25 de diciembre.

**Por qué alguien pagó:** La LFT mexicana tiene una lista de días festivos obligatorios con pago doble. Wansoft pre-carga el calendario SAT de festivos y permite que el operador marque cuáles son "día cerrado" (sin operación) vs "día con pago especial" (operación con costo de nómina mayor).

**Diseño 2026:** El calendario de festivos se pre-carga con las fechas de la LFT al crear la sucursal. El restaurante marca cuáles van a operar y cuáles van a cerrar. El sistema alerta cuando hay un festivo próximo y el horario de operación no tiene ajuste — "El 1 de enero está programado como día normal, ¿confirmas que vas a operar?"

---

### 18 INVENTARIO

#### 18.1.1 Almacenes

**Wansoft:** `PORTAL:INV > Control de inventarios > Almacenes`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define los espacios físicos donde se guarda el inventario del restaurante. AMALAY tiene 6: cocina, barra, market, panadería, cava, y almacén general. Cada producto tiene existencias por almacén — el inventario no es un número único por producto sino una distribución por espacio.

**Problema operativo:** Sin almacenes, el inventario total de "leche de almendra" es "3 litros" — pero sin saber que 2 están en la barra y 1 en cocina, el chef puede buscar leche en cocina y no encontrarla (está en la barra) y creer que se acabó. Los almacenes eliminan el "¿dónde está X?" del personal de cocina.

**Por qué alguien pagó:** Las transferencias entre almacenes en Wansoft son un sub-módulo completo: se crea una transferencia, se seleccionan productos y cantidades, se "envía" (baja del almacén origen) y se "recibe" (alta en el almacén destino). Es un mini-ERP interno del restaurante.

**Diseño 2026:** Los almacenes se crean en el dashboard con nombre y tipo (cocina, barra, market, bodega). El conteo físico es por almacén: el chef de cocina hace su conteo, el bartender hace el suyo — sin interferencia. Las transferencias entre almacenes tienen su propio flujo: solicitud → aprobación → confirmación de recepción.

---

#### 18.3.1 Unidades de medida

**Wansoft:** `PORTAL:INV > Control de inventarios > Unidades de medida`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Catálogo de unidades de medida del inventario: kg, gr, lt, ml, pieza, caja, botella, lata. Cada producto tiene su unidad base. Las presentaciones (siguiente setting) definen las conversiones entre unidades.

**Problema operativo:** Sin unidades de medida definidas, el inventario no puede calcular nada. "3 de leche" no tiene significado — ¿3 litros? ¿3 cajas? ¿3 bolsas? La unidad base es la que usa la receta (ml o gr para ingredientes pesados), y es diferente a la unidad de compra (botella, kilo).

**Por qué alguien pagó:** El catálogo de unidades de medida en Wansoft es customizable porque cada tipo de restaurante tiene unidades peculiares: una panadería mide en "piezas" y "libras"; una cava mide en "botellas" y "copas"; una cafetería mide en "shots" y "ml." El catálogo genérico (kg/lt/pza) no cubre todos los casos.

**Diseño 2026:** Pre-cargado con las unidades más comunes. El operador agrega las específicas de su operación. El sistema sugiere la unidad base al crear un ingrediente nuevo basándose en su categoría (líquidos → ml, sólidos → gr, artículos contados → pza).

---

#### 18.4.1 Presentaciones y conversiones

**Wansoft:** `PORTAL:INV > Control de inventarios > Presentaciones`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define cómo se relacionan las unidades de compra con las unidades base del inventario. "1 CAJA de huevo = 30 PIEZAS." "1 BOTELLA de aceite de oliva = 750 ML." Permite comprar en cajas y consumir en piezas sin convertir manualmente.

**Problema operativo:** Sin presentaciones configuradas, el sistema recibe "1 caja" de huevo y registra 1 unidad en inventario. La receta del chilaquil pide "2 piezas de huevo" — el sistema no puede saber si hay suficiente. Sin la conversión, el food cost, el punto de reorden, y las compras sugeridas son todos incorrectos.

**Por qué alguien pagó:** Las conversiones son trabajo de setup que requiere conocer el producto. "1 bolsa de harina = 5 kg" parece obvio, pero "1 paquete de café" depende de si es 250gr o 1kg. El distribuidor cobraba la carga masiva de presentaciones como parte de la instalación del módulo de inventario.

**Diseño 2026:** El sistema sugiere las conversiones más comunes por tipo de producto (huevo, aceite, harina tienen conversiones estándar conocidas). El operador confirma o corrige. Las conversiones se validan automáticamente contra las recetas — si una receta pide 200ml de un ingrediente cuya presentación mínima es "botella de 750ml", el sistema calcula que 1 botella alcanza para 3.75 porciones.

---

#### 18.5.1 Punto de reorden

**Wansoft:** `PORTAL:INV > Control de inventarios > Punto de reorden (tabla pasiva)`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config→Auto

**Qué hace:** Define el umbral de inventario al que se debe generar una orden de compra para cada ingrediente. "Leche de almendra: reordenar cuando queden menos de 5 litros." En Wansoft es una tabla que el gerente tiene que revisar manualmente.

**Problema operativo:** El punto de reorden pasivo es información que nadie consulta. El gerente abriría el portal, navegaría a Inventario → Punto de reorden, y verificaría cuáles ingredientes están bajo el umbral — pero esto solo ocurre cuando alguien recuerda hacerlo. El restaurante se queda sin leche de almendra a las 11am del martes porque nadie revisó el punto de reorden del lunes.

**Por qué alguien pagó:** Wansoft tiene la tabla. Los datos existen. Lo que falta es el sistema proactivo que hace algo con esos datos automáticamente — que Wansoft nunca construyó.

**Diseño 2026:** Cuando el inventario baja del punto de reorden, el sistema genera automáticamente una alerta en Telegram al gerente con el ingrediente, la cantidad actual, y el punto de reorden. Con un click desde Telegram, el gerente puede generar una OC al proveedor. El punto de reorden se calibra automáticamente basándose en el consumo histórico de los últimos 30 días: si los chilaquiles se venden más en verano, el sistema ajusta el punto de reorden de los huevos en mayo.

---

#### 18.6.1 Límites de variación de costo por producto

**Wansoft:** `PORTAL:INV > Control de inventarios > Config límites variación costo por producto`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Define un umbral de variación de precio aceptable para cada ingrediente. Si el tomate que normalmente cuesta $25/kg llega en una factura a $38/kg (52% de incremento), el sistema alerta antes de registrar la recepción. El responsable de compras puede rechazar el precio o aceptarlo con justificación.

**Problema operativo:** La inflación en México puede ser súbita y selectiva (el aguacate puede subir 40% en una semana). Sin alerta de variación, el restaurante registra el costo nuevo sin darse cuenta — y el food cost sube silenciosamente sin que nadie sepa por qué.

**Por qué alguien pagó:** Un restaurante que recibía facturas de proveedor con precios variables cada semana necesitaba un mecanismo de control. Sin el límite de variación, el cajero de recepción registraba precios como venían en la factura sin cuestionarlos. Un proveedor con acceso a facturar directamente podría cobrar de más durante meses antes de que alguien lo notara.

**Diseño 2026:** Los límites de variación se configuran por categoría de producto (verduras: 20%, proteínas: 15%, lácteos: 10%) y se pueden override por producto específico. El agente de proveedores ya analiza variación de costos semanalmente — falta la integración con el flujo de recepción para detener el registro antes de que ocurra, no solo reportarlo después.

---

#### 18.7.1 Momento de deducción de inventario

**Wansoft:** `FULLSITE vs NETSILVER — decisión de diseño fundamental (Wansoft: al cobrar; Fullsite: al enviar a cocina)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define en qué momento del flujo de venta se descuenta el inventario: al enviar la comanda a cocina (Fullsite) o al cobrar la cuenta (Wansoft).

**Problema operativo:** El momento correcto de deducción es al enviar a cocina — cuando el chef físicamente toma los ingredientes. Wansoft deduce al cobrar: durante toda la preparación del platillo, el inventario teórico sigue contando esos ingredientes como disponibles. En hora pico con 20 comandas en vuelo, el inventario miente.

**Por qué alguien pagó:** Wansoft eligió "al cobrar" porque es más simple técnicamente (la venta ya está cerrada, no hay reversal si el platillo no se prepara). Fullsite eligió "al enviar a cocina" porque es más correcto operativamente. La diferencia es filosófica pero tiene consecuencias reales en el inventario teórico durante el servicio.

**Diseño 2026:** La deducción al enviar a cocina ya está implementada en Fullsite. Si la comanda se cancela después de enviarse (el platillo "se preparó"), el inventario permanece deducido. Si se cancela antes de enviar, el inventario se revierte. Esta es la semántica correcta que resuelve el problema de "¿se preparó?" de la sección de cancelaciones de Wansoft (13.1 del CAJA-SPEC).

---

#### 18.8.1 Plantillas de conteo físico

**Wansoft:** `PORTAL:INV > Control de inventarios > Plantillas de inv. físico vs sistema`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Listas pre-configuradas de qué productos contar en cada conteo. Ejemplo: "Plantilla Semanal Barra" = solo los licores y bebidas. "Plantilla Mensual Cocina" = todos los ingredientes de cocina. El gerente selecciona la plantilla, el sistema genera la hoja de conteo.

**Problema operativo:** Un conteo físico sin plantilla requiere que alguien vaya por todos los productos del catálogo (500+ en AMALAY) y los anote. Con plantilla, el conteo semanal de barra son 40 artículos en 20 minutos. Sin plantilla, el conteo se omite porque "tarda demasiado."

**Por qué alguien pagó:** La plantilla es la diferencia entre "contamos cuando tenemos tiempo" y "contamos cada semana." Los restaurantes que hacen conteos frecuentes tienen food costs más precisos — porque detectan discrepancias antes de que acumulen.

**Diseño 2026:** Las plantillas se crean en el dashboard con nombre, almacén, y lista de productos. El conteo físico desde el POS carga la plantilla seleccionada en modo "conteo": el empleado escanea o escribe las cantidades reales, el sistema calcula las diferencias en tiempo real. Al terminar, el reporte de diferencias se envía al gerente automáticamente.

---

### 19 RECETAS Y FOOD COST

#### 19.1.1 Rendimiento / Yield por ingrediente

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define el factor de rendimiento de cada ingrediente: qué porcentaje del peso/volumen comprado queda utilizable después de limpieza, cocción, o procesamiento. Pollo crudo → pollo cocido: rendimiento 72%. Aguacate → pulpa: 60%.

**Problema operativo:** Sin yield, 1 kg de pollo crudo en la receta equivale a 1 kg de pollo cocido — que es incorrecto. El food cost calculado es siempre menor al real. Un restaurante con 50 recetas sin yield puede creer que su food cost es 28% cuando en realidad es 35%.

**Por qué alguien pagó:** Wansoft no tiene yield — y la industria lo tolera porque calcular el yield correcto requiere trabajo experimental (pesar el ingrediente antes y después de procesar). En restaurantes de alta gastronomía, el yield es un dato crítico que se mide con precisión. En restaurantes casuales, se usa una estimación. Fullsite tiene el campo; la industria no lo llenaba.

**Diseño 2026:** El campo de yield está en la pantalla de ingrediente (no en la receta). Un aguacate tiene yield 60% en toda receta que lo use. El sistema calcula automáticamente: "Para 200gr de pulpa necesitas 333gr de aguacate." El food cost reportado ya incorpora el yield. Los yields comunes están pre-cargados como defaults (pollo: 72%, carne: 68%, aguacate: 60%).

---

#### 19.2.1 Subrecetas (preparaciones intermedias)

**Wansoft:** `PORTAL:INV > Producción y costos > Recetas de subproductos`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Una subreceta es una preparación que sirve como ingrediente en múltiples recetas. "Salsa roja" es una subreceta con sus propios ingredientes (jitomate, chile, ajo). Múltiples platillos usan "Salsa roja" — el costo de la salsa se calcula una vez y se reutiliza.

**Problema operativo:** Sin subrecetas, si el precio del jitomate sube, hay que actualizar el costo en todas las recetas que usan jitomate individualmente. Con 50 platillos que usan jitomate de alguna forma, eso es 50 actualizaciones manuales. Con subrecetas, actualizas la subreceta "Salsa roja" y el cambio se propaga automáticamente a todos los platillos que la usan.

**Por qué alguien pagó:** Wansoft tiene subrecetas como módulo separado (Recetas de subproductos). Los restaurantes con cocina de preparación (salsas base, fondos, masas) lo necesitan — de lo contrario, el food cost es incorrecto para cualquier platillo que use preparaciones complejas.

**Diseño 2026:** Las subrecetas son una entidad de primer orden en Fullsite, idéntica a un ingrediente pero con sus propios sub-ingredientes. Se pueden anidar: una subreceta puede usar otra subreceta (masa madre → croissant → orden de croissants). El costo se propaga en cascada automáticamente cuando cambia cualquier ingrediente en la cadena.

---

#### 19.3.1 Costos adicionales por platillo

**Wansoft:** `PORTAL:INV > Producción y costos > Costos adicionales`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Agrega al food cost de un platillo costos que no son ingredientes: gas por cocción, electricidad, mano de obra directa, packaging (caja, servilleta, cuchara desechable). Particularmente relevante para platillos de producción (panadería, pasteles) y para delivery (caja, bolsa, utensilio).

**Problema operativo:** Una dona que cuesta $8 en ingredientes puede tener $2 de gas (hornear), $1 de empaque (caja individual), y $0.50 de mano de obra directa. El food cost real es $11.50, no $8. Sin costos adicionales, el precio de venta se calcula sobre el costo incorrecto y el margen real es menor al esperado.

**Por qué alguien pagó:** Los costos adicionales en Wansoft son un campo numérico directo (no un catálogo) — el operador escribe el monto adicional por platillo. Simple pero útil para categorías donde el packaging es significativo (pasteles, cajas de lunch, platillos para llevar con embalaje especial).

**Diseño 2026:** Los costos adicionales son un catálogo de "overhead items": Gas ($/hora de horno), Packaging tipo A ($2/pieza), Packaging tipo B ($5/pieza), Mano de obra ($/hora). El platillo referencia los overhead items que usa y la duración/cantidad. Esto permite actualizar el costo del gas una vez y que se propague a todos los platillos que usan el horno.

---

#### 19.4.1 Umbral de alerta de food cost

**Wansoft:** `FULLSITE — no existe en Wansoft (Wansoft tiene reportes; Fullsite tiene alertas)`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define el porcentaje de food cost que dispara una alerta. Si el food cost del día supera el 35%, el gerente recibe una notificación. El umbral es configurable por sucursal y puede ser diferente para desayuno vs cena.

**Problema operativo:** El food cost puede subir sin que nadie lo note hasta el cierre del mes, cuando el contador entrega los estados financieros. Una semana con food cost de 42% (vs target de 32%) son 10 puntos de margen que se evaporaron — recuperarlos es imposible. Detectarlos en tiempo real permite reaccionar.

**Por qué alguien pagó:** No existe en Wansoft — es ventaja estructural de Fullsite. El agente anti-fraude y el food cost agent ya calculan este dato. La configuración del umbral es lo que falta para activar la alerta proactiva.

**Diseño 2026:** El umbral se configura en el onboarding con el target de food cost del restaurante (típico: 25-35% para restaurantes casuales). El sistema calcula el food cost en tiempo real a medida que se cierran las cuentas. Si al mediodía el food cost va a 41% (vs target 32%), el gerente recibe alerta: "Food cost en 41% — 9 puntos sobre tu target. Los bowls y las ensaladas tienen los mayores desvíos hoy."

---

#### 19.5.1 Producción / Batch cooking

**Wansoft:** `PORTAL:INV > Producción y costos > Orden de Producción (productores, plantillas, órdenes)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Sistema para gestionar preparaciones en batch antes del servicio. "Producir 20 croissants" consume X kg de harina, Y kg de mantequilla, Z ml de leche del inventario — y agrega 20 unidades de "Croissant (listo)" al inventario del área de panadería.

**Problema operativo:** Sin producción formal, el batch cooking de panadería es invisible para el sistema. Los ingredientes bajan del inventario "mágicamente" (alguien los usa sin registrar) y el inventario de productos terminados nunca existe en el sistema. El food cost de la panadería es imposible de calcular correctamente.

**Por qué alguien pagó:** Wansoft tiene 26 stored procedures dedicados a producción — el módulo con más variantes en todo el sistema. AMALAY tiene panadería activa. Sin producción, el 15-20% del negocio de AMALAY (Bakery section) no tiene control de food cost.

**Diseño 2026:** La orden de producción tiene: qué producir (platillo o subreceta), cuántas unidades, qué plantilla de producción usar, quién la produce, y cuándo. Al completarla, el sistema descuenta ingredientes del almacén origen y agrega productos terminados al almacén destino. Las plantillas recurrentes se programan: "Cada mañana a las 6am, producir 30 croissants." El agente de predicción sugiere la cantidad basándose en las ventas históricas del día siguiente.

---

### 20 COMPRAS Y PROVEEDORES

#### 20.1.1 Catálogo de proveedores

**Wansoft:** `PORTAL:EGRESOS > Configuración > Proveedores`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Lista de proveedores con nombre, RFC, teléfono, email, y los productos que vende cada uno. AMALAY tiene 202 proveedores en el catálogo. Los proveedores se vinculan a los ingredientes del inventario.

**Problema operativo:** Sin catálogo de proveedores, las órdenes de compra son notas a mano o mensajes de WhatsApp sin trazabilidad. No hay forma de saber cuánto se le compró a cada proveedor en el mes, qué precio cobró, ni si llegó todo lo que se pidió.

**Por qué alguien pagó:** El catálogo de proveedores en Wansoft es "decorativo" — los proveedores existen pero no hay un módulo de compras real que los use. Son solo nombres en una lista. La oportunidad de Fullsite es que el catálogo sea funcional: cada OC va al proveedor correcto, el historial de precios queda vinculado al proveedor, y el análisis de gasto por proveedor está disponible en tiempo real.

**Diseño 2026:** Cada proveedor tiene su catálogo de productos con el precio de la última compra, el precio promedio histórico, y el lead time (días que tarda en entregar). Cuando el gerente crea una OC, puede enviarla directamente al proveedor por WhatsApp o email desde el dashboard. El proveedor confirma por el mismo canal.

---

#### 20.2.1 Plantillas de órdenes de compra

**Wansoft:** `PORTAL:INV > Entradas y salidas > Plantillas de OC`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Listas pre-configuradas de productos para cada proveedor. "Plantilla Jugos NL" = 12 items que se piden cada semana a ese proveedor. El gerente selecciona la plantilla, ajusta cantidades, y envía — sin buscar producto por producto.

**Problema operativo:** Sin plantillas, cada OC semanal empieza desde cero. Buscar 12 productos en un catálogo de 3,000 ingredientes, uno por uno, toma 20 minutos. Con plantilla, toma 2 minutos. En un restaurante que genera 5-8 OCs semanales, la plantilla ahorra 2-3 horas de trabajo administrativo por semana.

**Por qué alguien pagó:** AMALAY tiene plantillas configuradas con nombres de proveedores reales ("JUGOS NL", "SIGMA", etc.). El distribuidor de Wansoft las cargó durante la instalación. Son probablemente la configuración más valiosa del módulo de compras — y nadie las actualizó desde entonces.

**Diseño 2026:** Las plantillas se crean en el dashboard y se actualizan automáticamente: si un ingrediente se agotó la semana pasada, el sistema sugiere aumentar la cantidad en la plantilla. Las plantillas tienen un campo de "cantidad sugerida" calculada por el sistema basada en el consumo histórico + punto de reorden.

---

#### 20.3.1 Flujo de aprobación de OC

**Wansoft:** `PORTAL:INV > Entradas y salidas > Órdenes de compra > Por aprobar`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define si las órdenes de compra requieren aprobación del dueño o contador antes de enviarse al proveedor. "OC menores a $1,000 — el gerente aprueba solo. OC mayores a $1,000 — requiere aprobación del dueño."

**Problema operativo:** Sin flujo de aprobación, cualquier persona con acceso al módulo de compras puede hacer una OC y enviarla. En restaurantes donde el gerente tiene acceso amplio, esto puede generar compras no autorizadas — sobre-pedido de ingredientes costosos que llegan a bodega y que nadie usó porque no había demanda.

**Por qué alguien pagó:** El dueño de un restaurante con 3 sucursales necesitaba aprobar cualquier compra mayor a $5,000 independientemente de qué sucursal la generara. Sin flujo de aprobación, el gerente de cada sucursal hacía compras de forma independiente — y el gasto mensual en insumos era impredecible.

**Diseño 2026:** El umbral de aprobación es configurable por monto y por categoría (licores siempre requieren aprobación, sin importar el monto). La aprobación llega por Telegram al dueño: "📦 OC #234 — Sigma Alimentos: $3,450. ¿Aprobar?" Un click desde Telegram aprueba o rechaza. Sin aprobación en 4 horas, el sistema recuerda.

---

#### 20.5.1 Cuentas bancarias del restaurante

**Wansoft:** `PORTAL:CONFIG > Cuentas bancarias`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Catálogo de cuentas bancarias de la empresa: banco, número de cuenta, CLABE, cuenta de cheques. Las cuentas se usan para: registrar depósitos de efectivo, registrar pagos a proveedores, y conciliar con el corte Z.

**Problema operativo:** Sin cuentas bancarias configuradas, los depósitos en el sistema son "dinero que salió de la caja" sin destino. El contador no puede hacer la conciliación bancaria porque no sabe a qué cuenta fue cada depósito.

**Por qué alguien pagó:** Simple y no controversial. La cuenta bancaria es el destino del efectivo que sale de la caja. La conciliación bancaria automatizada (ver 11.2.1) requiere que el sistema conozca las cuentas del restaurante para comparar.

**Diseño 2026:** Las cuentas bancarias se configuran en el onboarding. Los depósitos de efectivo desde el POS requieren seleccionar la cuenta destino. Integraciones futuras con BBVA/Santander/Banamex permitirán conciliación automática diaria comparando el estado de cuenta bancario con los depósitos registrados en el sistema.

---

### 21 FACTURACIÓN / CFDI

#### 21.1.1 PAC y credenciales fiscales (CSD)

**Wansoft:** `PORTAL:CONFIG > Facturación electrónica > FE Config (PAC, CSD, contraseña)`
**Nivel:** Configuración inicial | **Frecuencia:** Raro | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Configura el Proveedor Autorizado de Certificación (PAC) para el timbrado de CFDI. Requiere subir el Certificado de Sello Digital (CSD) del SAT (archivos .cer y .key) y la contraseña de la llave privada.

**Problema operativo:** Sin CSD configurado, el sistema no puede timbrar ninguna factura. Un restaurante que no tiene su CSD listo desde el primer día no puede emitir facturas hasta que lo resuelva — y los clientes corporativos que visitaron ese día piden factura que nunca llega.

**Por qué alguien pagó:** El CSD vence cada 4 años y requiere renovación ante el SAT. Wansoft no tiene alerta de vencimiento — el PAC simplemente rechaza el timbrado cuando el CSD expira, y el cajero se entera cuando intenta facturar a un cliente. Fullsite puede monitorear la vigencia del CSD y alertar 30 días antes.

**Diseño 2026:** La configuración del PAC es wizard guiado: subir .cer, subir .key, capturar contraseña, validar con el SAT, y confirmar. Fullsite usa Facturama como PAC default. El CSD se almacena cifrado en la nube. El sistema alerta al dueño 60 días antes del vencimiento del CSD con instrucciones de renovación.

---

#### 21.2.1 Series por sucursal

**Wansoft:** `PORTAL:CONFIG > Facturación electrónica > Series (AA, AB, AC...)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Cada sucursal emite facturas con una serie diferente (Sucursal 1 = AA-0001, Sucursal 2 = AB-0001). Esto permite al contador identificar de qué sucursal proviene cada factura sin ambigüedad — especialmente importante en negocios con múltiples RFC o que consolidan el reporte por sucursal.

**Problema operativo:** Sin series por sucursal, todas las facturas tienen el mismo prefijo. Si AMALAY tiene 2 sucursales compartiendo RFC (grupo empresarial), las facturas de ambas se mezclan en el sistema del SAT con la misma serie — imposible distinguir cuál venta fue de qué sucursal.

**Por qué alguien pagó:** El SAT requiere que la numeración de facturas sea consecutiva y sin repetición. Si dos sucursales emiten facturas con la misma serie, inevitablemente se repiten números — incumplimiento fiscal. Las series son el mecanismo para evitarlo.

**Diseño 2026:** Las series se asignan automáticamente por sucursal durante el onboarding: Sucursal 1 = AA, Sucursal 2 = AB. El operador puede cambiarlas si ya tiene una convención establecida con su contador. El sistema garantiza que nunca haya dos sucursales con la misma serie.

---

#### 21.3.1 Autofacturación por QR

**Wansoft:** `NETSILVER > Factura electrónica > Mostrar QR en ticket ✓` (portal: proceso manual)
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config→Auto

**Qué hace:** El cliente escanea el QR del ticket, captura su RFC y datos fiscales, y el sistema timbra automáticamente el CFDI y lo envía al email del cliente. Cero intervención del cajero. En Wansoft, el QR es solo el link — el proceso de emisión sigue siendo manual en el portal.

**Problema operativo:** El proceso manual de facturación en Wansoft (cajero va al portal, busca la venta, captura RFC del cliente, timbra, envía email) toma 5-10 minutos. En restaurantes de zona corporativa donde el 30-40% de los clientes piden factura, eso es 1.5-4 horas diarias de trabajo del cajero — que podría dedicarse a atender mesas.

**Por qué alguien pagó:** La autofacturación es uno de los diferenciadores más claros de Fullsite vs Wansoft. El QR de Wansoft lleva al portal de Wansoft (interfaz desktop, no optimizada para móvil). El QR de Fullsite lleva a un flujo mobile-first de 3 pasos en 60 segundos.

**Diseño 2026:** El portal de autofacturación de Fullsite: (1) el cliente escanea el QR, (2) captura su RFC — el sistema valida contra el SAT en tiempo real y pre-llena razón social y régimen fiscal, (3) confirma y el CFDI se timbra y envía al email en menos de 60 segundos. Si el cliente ya facturó con ese RFC antes, su información está guardada — paso 2 ya está pre-llenado.

---

#### 21.4.1 Factura global

**Wansoft:** `PORTAL > Facturación > Factura Global (con txt / sin txt)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Consolida todas las ventas del período que no tuvieron factura individual en un solo CFDI de "Público en General." La factura global es obligatoria — sin ella, las ventas sin facturar quedan sin comprobante fiscal.

**Problema operativo:** Un restaurante que no emite factura global mensual incumple su obligación fiscal. El SAT puede detectar que el total de CFDI individuales no suma el total declarado en la declaración mensual — la diferencia sin justificar es una señal de evasión.

**Por qué alguien pagó:** La factura global tiene dos variantes en Wansoft: "con txt" (importa el archivo de ventas del SAT para validar contra las ventas del POS) y "sin txt" (genera directamente desde los datos del sistema). La variante "con txt" es el proceso correcto para la declaración del SAT.

**Diseño 2026:** La factura global se genera automáticamente al cierre del mes — el sistema identifica todas las ventas sin CFDI individual y las consolida. El operador confirma el período y el proceso de timbrado es automático. El CFDI global se envía al contador por email junto con el reporte de conciliación (ventas totales vs facturadas individualmente vs factura global).

---

### 22 DELIVERY / ECOMMERCE

#### 22.1.1 Plataformas activas

**Wansoft:** `PORTAL > Ecommerce > Administración > Configuración horario por integracion`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define qué plataformas de delivery están integradas: UberEats, Rappi, DiDi Food, aDomicilio. Cada plataforma activa recibe las órdenes automáticamente en el POS sin re-captura manual.

**Problema operativo:** Un restaurante con tablet de Rappi y tablet de UberEats maneja 2 flujos paralelos de órdenes que el cajero tiene que monitorear simultáneamente — más el POS del salón. En hora pico, las tablets de delivery suenan mientras la caja tiene cola. Las órdenes de delivery se retrasan o se pierden.

**Por qué alguien pagó:** La integración de Wansoft con delivery usa un middleware propietario. AMALAY recibe órdenes de Rappi y UberEats en el POS — se ven en la pantalla de Delivery como órdenes con estado "Confirmada/Pendiente." Sin integración, alguien tiene que re-capturar cada orden manualmente.

**Diseño 2026:** Cada plataforma activa genera órdenes automáticamente en el POS con la misma interfaz que las órdenes del salón. El cajero ve todas las órdenes (mesa, para llevar, Rappi, UberEats) en una sola pantalla sin cambiar de modo. La comanda va a cocina igual que una orden presencial.

---

#### 22.3.1 Marcas virtuales

**Wansoft:** `PORTAL > Ecommerce > Administración > Configuración grupos por marcas`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Permite que un restaurante aparezca en las plataformas de delivery como múltiples marcas con menús diferentes. AMALAY puede operar como "AMALAY Coffee & Market", "La Nonna Gorditas Keto", y "AMALAY Bakery" en Rappi — desde la misma cocina, con el mismo staff, compartiendo el mismo inventario.

**Problema operativo:** Un restaurante con capacidad de cocina subutilizada en ciertos horarios puede generar ingresos adicionales con una segunda marca virtual — sin costo de renta o personal adicional. Sin el concepto de marcas virtuales en el sistema, las órdenes de la segunda marca se mezclan con las de la primera en el POS.

**Por qué alguien pagó:** Las marcas virtuales son un modelo de negocio relativamente nuevo (popularizado post-pandemia). Wansoft las resolvió porque los clientes con múltiples conceptos en el mismo espacio lo pedían. AMALAY tiene "LA NONNA Gorditas Keto" como categoría de menú — probablemente sin la separación formal de marca.

**Diseño 2026:** Cada marca virtual tiene su propio menú (subconjunto del catálogo del restaurante), su propio horario, y su propio perfil en la plataforma. Las órdenes de cada marca se identifican visualmente en el POS con un color distinto. Los reportes de ventas separan el ingreso por marca — el dueño sabe cuánto generó cada concepto.

---

#### 22.5.1 Tiempo de preparación por plataforma

**Wansoft:** `PORTAL > Ecommerce > Operaciones > Tiempo de preparación`
**Nivel:** Configuración ocasional | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Define cuánto tiempo tarda el restaurante en tener listo un pedido de delivery para que el repartidor lo recoja. Esto afecta cuándo las plataformas muestran el pedido como "disponible" y cuándo notifican al repartidor que puede llegar.

**Problema operativo:** Un tiempo de preparación muy corto (15 min) hace que el repartidor llegue antes de que el pedido esté listo — espera en el restaurante, bloquea la entrada, y potencialmente cancela. Un tiempo muy largo (40 min) hace que el restaurante pierda órdenes porque el cliente prefiere un competidor más rápido.

**Por qué alguien pagó:** El tiempo de preparación en Wansoft es configurable por marca/plataforma — cada integración puede tener un tiempo diferente. Rappi puede ser 20 min y UberEats 25 min por diferencias en cómo calculan la llegada del repartidor.

**Diseño 2026:** El tiempo de preparación se calibra automáticamente basándose en el historial. El sistema calcula el promedio de tiempo real de preparación de los últimos 30 días (desde la recepción de la orden hasta el "listo") y sugiere ajustar el tiempo configurado si hay diferencia significativa. En hora pico, puede aumentar automáticamente el tiempo estimado para reducir repartidores esperando.

---

### 23 CRM Y LEALTAD

#### 23.1.1 Encuesta post-visita

**Wansoft:** `PORTAL > Encuesta > Configuración de encuesta + reporte`
**Nivel:** Configuración inicial | **Frecuencia:** Común | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define la encuesta de satisfacción que ve el cliente al escanear el QR del ticket. Puede ser opción múltiple, calificación numérica, o pregunta abierta. El reporte de encuestas agrupa las respuestas por pregunta, período, y calificación promedio.

**Problema operativo:** Wansoft permite encuestas de múltiples preguntas. El problema real: cada pregunta adicional reduce la tasa de respuesta a la mitad. Una encuesta de 5 preguntas tiene una tasa de respuesta de <2%. Una encuesta de 1 pregunta ("¿lo recomendarías?") puede llegar al 15-20%.

**Por qué alguien pagó:** El módulo de encuestas de Wansoft es "casi nadie lo usa" en la tabla de adopción de módulos. No es porque las encuestas sean inútiles — es porque la configuración es compleja y el resultado no es accionable. AMALAY tiene el QR en el ticket pero no sabemos si tiene la encuesta configurada.

**Diseño 2026:** Una sola pregunta por default: "¿Del 1 al 5, qué tan probable es que recomiendes AMALAY?" Las respuestas de 1-3 disparan una alerta inmediata al gerente para recuperación. Las respuestas de 4-5 generan un mensaje de agradecimiento automático por WhatsApp (si tenemos el número del cliente). El NPS se muestra en el dashboard en tiempo real.

---

#### 23.2.1 Tarjetas de regalo

**Wansoft:** `PORTAL:PV > Restaurante > Tarjetas de Regalo (admin + reporte)`
**Nivel:** Configuración inicial | **Frecuencia:** Raro | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Sistema de tarjetas de regalo pre-cargadas con un monto (o con un paquete específico). El cliente compra la tarjeta, la usa como forma de pago en una visita futura. El sistema verifica el saldo y lo descuenta automáticamente al cobrar.

**Problema operativo:** Las tarjetas de regalo físicas son caras de producir y logisticamente complejas. Un cliente que recibe una tarjeta de regalo física tiene que llevarla encima en cada visita — si la pierde, pierde el dinero. Sin un sistema digital de tarjetas, el control es manual y propenso a fraude (el cajero puede "regalar" saldo de tarjetas sin registro).

**Por qué alguien pagó:** Wansoft tiene tarjetas de regalo como opción de módulo (casi nadie lo usa, según la tabla de adopción). El valor real para un restaurante es el efectivo recibido por anticipado — el cliente paga hoy por consumir mañana. El riesgo es la redención: si el cliente nunca regresa, el restaurante tiene deuda "silenciosa."

**Diseño 2026:** Tarjetas de regalo digitales (código QR o número de serie). El cliente compra la tarjeta en el POS o en el ecommerce del restaurante. Al cobrar, el cajero escanea el QR o escribe el código — el sistema descuenta el monto. Sin tarjeta física, sin pérdida posible, sin fraude manual.

---

#### 23.3.1 WhatsApp Business activo

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Activa el canal de WhatsApp Business del restaurante como punto de contacto con clientes: reservaciones, respuesta a preguntas, envío de tickets digitales, y seguimiento post-visita. El bot responde automáticamente fuera de horas.

**Problema operativo:** Un restaurante que solo tiene teléfono fijo pierde clientes que prefieren WhatsApp. En México, WhatsApp es el canal preferido de comunicación de los clientes — más del 80% prefiere WhatsApp sobre llamada o email para hacer reservaciones.

**Por qué alguien pagó:** No existe en Wansoft — es ventaja estructural de Fullsite. El bot de WhatsApp de AMALAY ya está activo (orquestador). La configuración es qué horarios responde el bot, qué preguntas frecuentes maneja, y cuándo escalar a una persona real.

**Diseño 2026:** El canal de WhatsApp se activa con el número del restaurante y se integra al orquestador. El bot maneja reservaciones, preguntas de horario, menú, y ubicación. Los tickets digitales llegan por WhatsApp al número del cliente (si lo dejó en la reservación o factura). El gerente puede leer todas las conversaciones desde el dashboard y tomar el control cuando el bot no puede resolver.

---

### 24 CONTABILIDAD

#### 24.1.1 Estado de resultados (P&L) automático

**Wansoft:** `PORTAL > Reportes > Estado de resultados (P&L mensual por año — GetIncomeStatemetByMonthInYear)`
**Nivel:** Configuración inicial | **Frecuencia:** Situacional | **¿En Fullsite?** No | **Tipo:** Config→Auto

**Qué hace:** Calcula automáticamente el P&L del restaurante por mes: ingresos (ventas netas), costos (food cost de inventario), egresos (compras + nómina + vales), y utilidad. El dueño ve cuánto ganó sin esperar al contador.

**Problema operativo:** La mayoría de los dueños de restaurantes en México saben cuánto vendieron (lo ven en el POS) pero no saben cuánto ganaron hasta 2 meses después cuando el contador entrega los estados financieros. Decisiones como "¿aumentar precios?" o "¿abrir sucursal?" se toman con datos de 8 semanas de retraso.

**Por qué alguien pagó:** El P&L automático de Wansoft es una de las funcionalidades de mayor valor percibido por el dueño — aunque el dato no sea 100% preciso (porque no todos los egresos se capturan en el sistema). Un P&L aproximado disponible hoy vale más que un P&L exacto disponible en 2 meses.

**Diseño 2026:** El P&L de Fullsite se construye automáticamente desde tres fuentes: ventas (wansoft_daily / pos_orders), food cost (pos_recipes × unidades vendidas), y egresos registrados en el sistema (OCs, vales, gastos). El dueño ve el P&L del mes en curso actualizado diariamente. El agente de IA hace la narrativa: "Esta semana tu utilidad bajó 3 puntos porque el aguacate subió 25% — tus platillos con guacamole tienen margen negativo."

---

#### 24.2.1 Cuentas contables (mapeo a catálogo SAT)

**Wansoft:** `PORTAL:CONFIG > Cuentas contables`
**Nivel:** Configuración inicial | **Frecuencia:** Raro | **¿En Fullsite?** No | **Tipo:** Config

**Qué hace:** Mapea las categorías de ingreso/egreso del POS con las cuentas del catálogo contable SAT. "Ventas de alimentos → Cuenta 401.01," "Ventas de bebidas → Cuenta 401.02." El contador usa este mapeo para importar las ventas directamente a CONTPAQi.

**Problema operativo:** Sin mapeo de cuentas contables, el contador tiene que clasificar manualmente cada línea de venta en el sistema contable. Para un restaurante con $500,000 de ventas mensuales en 20 categorías, eso es trabajo manual significativo.

**Por qué alguien pagó:** La integración con CONTPAQi es el santo grial del dueño de restaurante: el sistema contable "sabe" lo que vendió el restaurante sin que el contador tenga que capturarlo. El mapeo de cuentas es el prerequisito técnico para que esa integración funcione.

**Diseño 2026:** El mapeo de cuentas se configura una vez con el contador. Fullsite genera automáticamente un archivo XML o CSV compatible con CONTPAQi con las pólizas de ventas del mes. El contador importa el archivo y listo — sin captura manual. El mapeo incluye ventas por categoría, egresos, propinas, descuentos, y cortesías como entidades contables separadas.

---

### 25 NOTIFICACIONES Y ALERTAS

#### 25.1.1 Canal de entrega de alertas

**Wansoft:** `NETSILVER > Notificaciones (sección de config) / PORTAL > email de cortes (todo OFF en AMALAY)`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define por qué canal llegan las alertas del sistema al dueño o gerente: Telegram, WhatsApp, email. En Wansoft, la única notificación es email de cortes — AMALAY la tiene apagada. En Fullsite, el canal principal es Telegram.

**Problema operativo:** Email como canal de alertas tiene tasa de apertura de 20-40% y retraso de minutos. Una alerta de "diferencia de caja de $2,000" que llega 6 horas después (cuando el dueño abre el email) ya no es accionable. Telegram tiene tasa de apertura de 90%+ y entrega en segundos.

**Por qué alguien pagó:** No existe como configuración en Wansoft — las notificaciones son vestigiales. La ventaja de Fullsite es estructural: el orquestador de Telegram ya está activo y el dueño ya recibe el briefing matutino por Telegram. Las alertas son el siguiente paso natural.

**Diseño 2026:** El canal de alertas se configura en el onboarding: Telegram (default), WhatsApp Business, o email. El número/chat ID se configura una vez. Las alertas llegan por el canal elegido con formato estructurado: emoji de severidad + resumen en una línea + link al dashboard para más detalle.

---

#### 25.2.1 Destinatarios por tipo de alerta

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Define quién recibe cada tipo de alerta. "Diferencia de caja → dueño + gerente. Punto de reorden → gerente de operaciones. Food cost elevado → dueño + gerente. Reseña negativa → dueño." Cada persona recibe solo las alertas relevantes para su rol.

**Problema operativo:** Sin configuración de destinatarios, todas las alertas van a la misma persona — el dueño recibe alertas de inventario que no son su responsabilidad directa, y el gerente no recibe alertas de food cost que sí son suyas. El ruido de alertas irrelevantes reduce la atención a las importantes.

**Por qué alguien pagó:** No existe en Wansoft. La oportunidad de Fullsite es construir un sistema de alertas inteligente: la alerta correcta a la persona correcta en el momento correcto.

**Diseño 2026:** Cada tipo de alerta tiene una lista de destinatarios configurable. El setup inicial pre-configura las alertas más importantes por rol (dueño, gerente, chef, contador). El dueño puede agregar o quitar destinatarios desde el dashboard en cualquier momento. En el futuro: el sistema aprende qué alertas cada persona realmente lee y actúa sobre (vs las que ignora) para calibrar la relevancia.

---

#### 25.3.1 Umbrales de alerta configurables

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Parcial | **Tipo:** Config

**Qué hace:** Define los valores que disparan cada alerta: food cost > 35%, diferencia de caja > $500, retraso de platillo > 15 min, inventario < punto de reorden, ventas del día < 80% del promedio histórico.

**Problema operativo:** Un umbral fijo no sirve para todos los restaurantes. Un restaurante de alta cocina con food cost objetivo de 40% (ingredientes premium) no debería recibir alerta al 35%. Un food truck con objetivo de 25% debe recibir alerta al 30%. Sin configuración de umbral, el sistema alerta sobre normal o no alerta sobre anormal.

**Por qué alguien pagó:** No existe en Wansoft. Los umbrales de Fullsite deben calibrarse por restaurante durante el onboarding y ajustarse con el tiempo. El agente de anomalías ya tiene umbrales hardcoded — la siguiente iteración es hacerlos configurables por el dueño.

**Diseño 2026:** Los umbrales se configuran por categoría de alerta con valores default basados en benchmarks de la industria (30 restaurantes en Fullsite → percentil 50 de food cost para restaurantes del mismo tipo). El dueño puede ajustar cada umbral desde el dashboard. El sistema muestra el historial de la métrica para contextualizar el umbral ("tu food cost histórico es 31% — ¿quieres alertar cuando supere 35%?").

---

#### 25.3.2 Alertas de ventas intraday

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración ocasional | **Frecuencia:** Situacional | **¿En Fullsite?** Sí | **Tipo:** Config→Auto

**Qué hace:** Alerta al gerente si las ventas a determinada hora del día están significativamente por debajo del promedio histórico para esa hora. "Son las 2pm de un miércoles y llevas $3,200 — el miércoles pasado llevabas $8,500 a esta hora."

**Problema operativo:** Un gerente que solo revisa el corte al final del día descubre que las ventas estuvieron bajas cuando ya no puede hacer nada. Una alerta a las 2pm de que las ventas van lentas puede motivar una acción: promoción de media tarde, mensaje a la lista de clientes frecuentes, ajuste de producción para la tarde.

**Por qué alguien pagó:** Los workflows `intraday-sales.yml` ya existen en Fullsite. La configuración de umbral es lo que falta — "alertar si las ventas a las 2pm son menos del 70% del promedio del mismo día de la semana."

**Diseño 2026:** La alerta intraday compara las ventas actuales contra el percentil 25 del mismo día de la semana en los últimos 30 días. Si las ventas están en el cuartil inferior, alerta al gerente con contexto: "Ventas lentas este miércoles — el mismo día la semana pasada tenías 40% más a esta hora. ¿Hay algo que quieras activar?" La respuesta del gerente por Telegram puede disparar una acción: activar promoción, enviar WhatsApp a clientes frecuentes.

---

### 26 IA Y AUTOMATIZACIONES

#### 26.1.1 Agentes activos por sucursal

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración inicial | **Frecuencia:** Universal | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Lista de agentes autónomos activos para cada sucursal: qué agentes están habilitados, con qué frecuencia corren, y a qué canal envían sus reportes. AMALAY tiene 26 agentes activos vía GitHub Actions + Groq + Telegram.

**Problema operativo:** Un agente que corre para todas las sucursales por igual no sirve si cada sucursal tiene contexto diferente. El agente de staffing de AMALAY necesita saber que el brunch del domingo es el turno más crítico — un restaurante con cenas de grupos tiene una dinámica diferente. Los agentes sin configuración por sucursal generan alertas irrelevantes que el dueño empieza a ignorar.

**Por qué alguien pagó:** No existe en Wansoft — es territorio completamente nuevo. La ventaja de Fullsite es que los agentes son configurables por sucursal desde el dashboard: qué agente, qué horario, qué umbral de alerta, qué canal de entrega.

**Diseño 2026:** El dashboard muestra todos los agentes disponibles con una descripción de qué hacen y cuántos tokens consumen. El dueño activa los que quiere. Los agentes que no son relevantes para el tipo de restaurante pueden desactivarse (un coffee shop sin delivery no necesita el agente de Rappi). El historial de ejecuciones y los tokens usados son visibles para que el dueño entienda el costo del sistema.

---

#### 26.1.2 Modelos de IA por tarea

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración avanzada | **Frecuencia:** Raro | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Define qué modelo de IA se usa para cada tipo de tarea. Tareas de análisis complejo (reporte semanal, detección de anomalías, explicación de variación) usan modelos más capaces. Tareas de respuesta rápida (clasificar intent de Telegram, responder "¿cuánto vendemos hoy?") usan modelos más rápidos y económicos.

**Problema operativo:** Un solo modelo para todo genera o respuestas de alta calidad a costo elevado (si se usa el modelo más capaz para todo) o respuestas mediocres que nadie lee (si se usa el modelo más económico para análisis). La jerarquía de modelos debe ser transparente para el operador técnico.

**Por qué alguien pagó:** El sistema de fallback Groq → Claude Haiku ya existe en Fullsite (memoria: "Chat must never fail"). La configuración de qué modelo va en qué contexto es la extensión natural de esa arquitectura. Para un restaurante con 100+ interacciones por día, la diferencia de costo entre modelos es significativa.

**Diseño 2026:** El catálogo de tareas de IA tiene: análisis profundo (reportes, anomalías, previsiones) → Claude Sonnet 5; respuesta conversacional rápida (orquestador de Telegram, preguntas de ventas) → Claude Haiku 4.5; clasificación y extracción estructurada (parsing de facturas, categorización de transacciones) → Groq Llama3. El dueño ve este mapa en el dashboard pero no necesita cambiarlo — solo los operadores técnicos de Fullsite lo ajustan.

---

#### 26.1.3 Memoria del sistema (contexto persistente de la sucursal)

**Wansoft:** `FULLSITE — no existe en Wansoft`
**Nivel:** Configuración avanzada | **Frecuencia:** Raro | **¿En Fullsite?** Sí | **Tipo:** Config

**Qué hace:** Contexto que los agentes de IA tienen sobre la sucursal: nombre del restaurante, tipo de cocina, horarios, equipo clave, proveedores principales, objetivos del mes, restricciones actuales ("estamos con staff reducido en agosto"). Este contexto se inyecta automáticamente en cada prompt de cada agente.

**Problema operativo:** Sin memoria del sistema, cada agente comienza desde cero sin contexto. El agente de staffing no sabe que AMALAY tiene brunch los domingos. El agente de proveedores no sabe que el proveedor de aguacate tuvo problemas de entrega el mes pasado. El resultado son análisis genéricos que no reflejan la realidad operativa del restaurante.

**Por qué alguien pagó:** La memoria del sistema es la diferencia entre "un chatbot genérico de restaurante" y "el sistema que conoce AMALAY específicamente." Los datos operativos ya existen en Supabase (`memories` table, `wansoft_daily`, `agent_runs`). La memoria del sistema los sintetiza en un contexto conciso que cada agente usa.

**Diseño 2026:** La memoria del sistema tiene dos capas: (1) datos estáticos configurados en el onboarding (nombre, tipo, horarios, equipo), y (2) datos dinámicos que el sistema actualiza automáticamente (promedios de las últimas 4 semanas, proveedores activos, platillos top, tendencias del mes). El gerente puede agregar notas de contexto manual: "Estamos en temporada alta por vacaciones escolares — validar con benchmarks históricos de julio-agosto." Estas notas tienen fecha de expiración automática para que no contaminen el contexto indefinidamente.

---

> **Nota de alcance — Dominio 26:** Este dominio documenta la capa de configuración de IA como infraestructura. Los casos de uso específicos de IA (predicción de compras, análisis de anomalías, sustitución inteligente de ingredientes, red de proveedores) están documentados en `BACKOFFICE-KNOWLEDGE.md` sección 3 y son el roadmap de producto de Fullsite post-100 restaurantes.

---

## Resumen ejecutivo

### Conteo de settings por dominio

| Dominio | Settings | Tipo predominante | Frecuencia típica |
|---|---|---|---|
| 01 Menú y Platillos | 7 | Config / Config→Auto | Universal-Común |
| 02 Modificadores | 4 | Config | Común-Situacional |
| 03 Grupos y Categorías | 3 | Config | Universal |
| 04 Precios y Promociones | 5 | Config / Config→IA | Común-Situacional |
| 05 Ticket y Cuenta | 5 | Config | Universal-Común |
| 06 Comanda y Ruteo | 7 | Config | Universal-Situacional |
| 07 Cobro y Formas de Pago | 5 | Config | Universal |
| 08 Mesas y Espacios | 5 | Config | Universal-Situacional |
| 09 KDS y Cocina | 4 | Config / Config→Auto | Universal-Común |
| 10 Hardware e Impresoras | 4 | Config | Universal-Situacional |
| 11 Terminales Bancarias | 3 | Config / Config→Auto | Universal |
| 12 Caja | 5 | Config | Universal |
| 13 Cortes | 5 | Config / Config→Auto | Universal-Común |
| 14 Seguridad y Auditoría | 5 | Config | Universal |
| 15 Propinas | 4 | Config | Universal-Común |
| 16 Usuarios y Roles | 3 | Config | Universal |
| 17 Recursos Humanos | 3 | Config | Universal |
| 18 Inventario | 8 | Config / Config→Auto | Universal-Situacional |
| 19 Recetas y Food Cost | 5 | Config / Config→Auto | Universal-Común |
| 20 Compras y Proveedores | 4 | Config | Universal-Común |
| 21 Facturación / CFDI | 4 | Config / Config→Auto | Universal-Situacional |
| 22 Delivery / Ecommerce | 3 | Config / Config→Auto | Situacional |
| 23 CRM y Lealtad | 3 | Config | Común-Situacional |
| 24 Contabilidad | 2 | Config→Auto | Situacional-Raro |
| 25 Notificaciones y Alertas | 5 | Config / Config→Auto | Universal |
| 26 IA y Automatizaciones | 3 | Config | Universal-Raro |
| **Total** | **~122** | | |

### Hallazgos clave

**Gaps críticos de Wansoft que Fullsite resuelve:**
1. Audit log siempre activo (Wansoft: checkbox apagado en AMALAY)
2. Conciliación bancaria automática (Wansoft: zero conciliación)
3. Alertas proactivas en tiempo real (Wansoft: reportes pasivos)
4. Deducción de inventario al enviar a cocina (Wansoft: al cobrar)
5. Canal de comunicación Telegram (Wansoft: email con tasa de apertura 20%)

**Settings que Fullsite ya tiene implementados:** ~45 (37%)

**Settings que Fullsite tiene parcialmente:** ~20 (16%)

**Settings que Fullsite no tiene aún:** ~57 (47%) — backlog de producto priorizado

**Settings donde Fullsite es mejor by design (no configurable):**
- Audit log permanente e inmutable
- Conciliación bancaria nativa
- Alertas proactivas vs reportes pasivos
- App móvil vs desktop-only
- Configuración en nube vs terminal local

---

> Este documento es la arquitectura de configuración de referencia para Fullsite.
> Cada setting aquí documentado representa un problema operativo real que alguien
> pagó para resolver en 20+ años de historia de la industria restaurantera en México.
> No copiamos Wansoft. Aprendimos de él.
>
> Fecha de última actualización: 2026-07-24
> Autor: Claude Code + Daniel Ramonfaur (Fullsite)

> Este documento es el artefacto vivo de la Settings Bible de Fullsite.
> Se construye leyendo la Wansoft Bible, el CAJA-SPEC, el DATA-MODEL,
> el BACKOFFICE-KNOWLEDGE, y la operación real de AMALAY.
> No copiamos configuraciones — entendemos por qué existen y decidimos
> cuáles tienen lugar en un sistema moderno.
