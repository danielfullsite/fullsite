# Configurability Bible

> Revisión completa de todo lo que un restaurante necesita configurar en Fullsite.
> No solo Settings — también POS, Dashboard, Reportes, Alertas, IA, Usuarios, Sucursales, Impresión, y Operación.
>
> Filosofía central: buenos defaults primero. Configuración cuando el default es insuficiente.
> Automatización cuando la configuración puede inferirse de los datos.
>
> La meta: un restaurante debe poder adaptar Fullsite a su operación sin tocar código,
> pero nunca debe tener que configurar algo que el sistema podría decidir por él.
>
> Compañero: `FULLSITE-SETTINGS-BIBLE.md` — análisis detallado de settings individuales.
> Compañero: `SETTINGS-GAP-ANALYSIS.md` — qué implementar y en qué orden.
> Compañero: `DASHBOARD-PRODUCT-BIBLE.md` y `POS-PRODUCT-BIBLE.md`.
>
> Fecha: 2026-07-25

---

## Principios de configurabilidad

**1. Default primero.**
El sistema debe funcionar correctamente sin configuración. El default es la elección que el 80% de los restaurantes haría si tuvieran que decidir. Si el default requiere explicación, el default está mal.

**2. El dueño configura una vez; el sistema recuerda siempre.**
La configuración no debería ser algo que el dueño repite. Se hace al inicio, el sistema aprende, y solo se vuelve a tocar cuando algo cambia en el negocio.

**3. Automatización > Configuración > Código.**
Antes de pedir al dueño que configure algo, verificar si el sistema puede inferirlo de los datos. Antes de requerir código, verificar si la configuración puede resolverlo. El objetivo es reducir la configuración con el tiempo, no aumentarla.

**4. La sobreconfiguración es un bug de producto.**
Un sistema con 200 opciones que el restaurante promedio deja en default es un sistema que no conoce a sus usuarios. Cada opción debe justificarse con: ¿hay al menos 20% de restaurantes que necesitan cambiar este default?

**5. Las consecuencias de la configuración deben ser visibles.**
El dueño que cambia el porcentaje de food cost objetivo debe ver en la misma pantalla qué platillos pasan a estar en zona de riesgo con el nuevo umbral.

---

## Taxonomía

Para cada configuración documentamos:

- **Área** — dónde vive en la experiencia del usuario
- **Tipo** — `Config` (usuario configura), `Auto` (sistema decide con dato), `Config→Auto` (usuario pone la regla; el sistema la ejecuta)
- **Actor** — quién puede cambiarlo: `Dueño`, `Gerente`, `Fullsite`
- **Frecuencia** — qué tan seguido se toca: `Inicial`, `Ocasional`, `Diario`
- **Default sugerido** — el valor correcto para el 80% de los restaurantes
- **¿Por qué es configurable?** — si no tiene una respuesta clara, es candidato a eliminarse

---

## 01 MENÚ Y PLATILLOS

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Nombre del platillo | Config | Dueño | Inicial | — | Cada restaurante es diferente |
| Descripción | Config | Dueño | Inicial | Vacío | No todos quieren descripción |
| Foto del platillo | Config | Dueño | Inicial | Vacío | Requiere asset del cliente |
| Precio por tipo de orden (restaurante / delivery / para llevar) | Config | Dueño | Ocasional | Mismo precio todos | Delivery puede tener margen diferente |
| Disponibilidad por horario | Config→Auto | Dueño | Ocasional | Disponible siempre | Desayunos no disponibles en la cena |
| Disponibilidad por canal (Rappi, UberEats, presencial) | Config | Dueño | Ocasional | Disponible en todos | Platillos que no viajan bien |
| Grupo / categoría | Config | Dueño | Inicial | — | Define la organización del menú |
| Tamaños | Config | Dueño | Inicial | Sin tamaños | Chico/Grande/Extra |
| Modificadores | Config | Dueño | Inicial | Sin modificadores | Opciones de personalización |
| Alérgenos | Config | Dueño | Inicial | Sin alérgenos | Información para el cliente |
| Código de barras (market items) | Config | Dueño | Inicial | Sin barcode | Solo para items de tienda/market |
| Impresora de destino | Config | Dueño | Inicial | Cocina principal | Routing de comanda |
| Activo / inactivo | Config | Gerente | Diario | Activo | Para dar de baja temporalmente |
| Auto-86 por existencia | Config→Auto | Dueño | Inicial | Desactivado | Si inventario llega a 0 → se desactiva solo |

**Automáticos (sin configuración):**
- Precio histórico (se guarda automáticamente cuando cambia)
- Popularidad (calculada de ventas)
- Food cost teórico (calculado de la receta)
- Clasificación estrella/vaca/perro (calculada de ventas + margen)

---

## 02 RECETAS E INGREDIENTES

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Ingredientes de la receta | Config | Dueño | Inicial | — | Es la receta |
| Cantidad por porción | Config | Dueño | Inicial | — | Cada receta es diferente |
| Unidad de medida | Config | Dueño | Inicial | Gramo | La más común en cocina MX |
| Factor de rendimiento / yield | Config | Dueño | Inicial | 1.0 (sin merma) | 1 kg crudo ≠ 1 kg cocido |
| Sub-receta (ingrediente preparado) | Config | Dueño | Inicial | Ingrediente simple | Para salsas, bases, pre-elaborados |
| Almacén de origen | Config | Dueño | Inicial | Almacén principal | Multi-almacén: barra, cocina, market |
| Costo adicional (gas, mano de obra) | Config | Dueño | Ocasional | Sin costos adicionales | Para food cost más preciso |

**Automáticos:**
- Costo de la receta (calculado de precio de ingredientes × cantidades × yield)
- Alerta si el costo real supera el costo teórico en >X% (configurable el umbral)
- Sugerencia de ajuste de precio si el margen cae bajo el objetivo

---

## 03 MODIFICADORES

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Nombre del nivel de modificador | Config | Dueño | Inicial | — | "¿Cómo quieres tu café?" |
| Opciones del nivel | Config | Dueño | Inicial | — | "Natural / Con leche / Americano" |
| Obligatorio / opcional | Config | Dueño | Inicial | Opcional | Si es obligatorio, no se puede saltar |
| Mínimo / máximo de selecciones | Config | Dueño | Inicial | Mín 1, Máx 1 | Para niveles de selección múltiple |
| Impacto en precio | Config | Dueño | Inicial | Sin impacto | "Extra proteína +$20" |
| Impacto en receta (ingrediente adicional) | Config | Dueño | Inicial | Sin impacto en inventario | "Extra aguacate → deduce 1 aguacate" |
| Disponibilidad por tipo de orden | Config | Dueño | Ocasional | Todos | Un modificador de mesa puede no aplicar en delivery |

---

## 04 POS — OPERACIÓN

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Modo de autenticación (huella / PIN / ambos) | Config | Dueño | Inicial | PIN | Huella requiere hardware específico |
| Bloqueo automático post-operación | Config | Dueño | Inicial | Activado | Previene uso no autorizado entre operaciones |
| Tiempo de inactividad para bloqueo | Config | Dueño | Inicial | 5 minutos | Ajustable según operación |
| Mesas activas y layout | Config | Dueño | Inicial | Sin mesas | Cada restaurante tiene su propio layout |
| Nombres de zonas | Config | Dueño | Inicial | "Salón", "Terraza" | Cada restaurante los nombra diferente |
| Capacidad de sillas por mesa | Config | Dueño | Inicial | 4 | Para calcular ocupación |
| Tipo de orden disponibles | Config | Dueño | Inicial | Restaurante + Para Llevar | Delivery requiere integración activa |
| Campos obligatorios al crear orden | Config | Dueño | Inicial | Mesa + Mesero | Algunos omiten número de personas |
| Confirmación de personas al cierre | Config | Dueño | Inicial | Activada | Para métricas de ocupación precisas |
| Sillas activas | Config | Dueño | Inicial | Activadas | Para split por silla |
| Tiempos (course management) | Config | Dueño | Inicial | Activados | Para restaurantes con courses |
| Texto del firebutton | Config | Dueño | Inicial | "Enviar a cocina" | Personalización de lenguaje |
| Regresa al plano post-envío | Config | Dueño | Inicial | Activado | Eduardo lo pidió explícitamente |
| Silla máxima permitida | Config→Auto | Dueño | Inicial | Capacidad de la mesa | Previene error de captura |

---

## 05 POS — SEGURIDAD Y PERMISOS

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Matriz de permisos (269 acciones) | Config | Dueño | Inicial + Ocasional | Perfil "Mesero" con restricciones estándar | Cada restaurante calibra diferente |
| Catálogo de razones de cancelación | Config | Dueño | Inicial | Lista base de 5 razones | Los restaurantes tienen razones específicas |
| Catálogo de descuentos permitidos | Config | Dueño | Inicial | Sin descuentos (requiere configurar) | Cada restaurante tiene sus programas |
| Catálogo de cortesías permitidas | Config | Dueño | Inicial | Sin cortesías (requiere configurar) | Específico por negocio |
| Cancelación requiere gerente | Config | Dueño | Inicial | Activado | Anti-fraude |
| Descuento requiere gerente (monto umbral) | Config | Dueño | Inicial | Todo descuento → gerente | Algunos restaurantes permiten descuento menor sin autorizaciön |
| Cortesía siempre requiere gerente | Config | Dueño | Inicial | Activado | Sin excepción |
| Transferencia requiere autorización | Config | Dueño | Inicial | Activado | Vector de fraude principal |
| Cuentas de prueba activas | Config | Fullsite | — | Desactivadas en producción | Las cuentas de test no deben existir en instancias de clientes |

---

## 06 CAJA Y TURNOS

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Fondo de caja inicial | Config | Dueño | Inicial | $0 (requiere configurar) | Cada restaurante define su fondo |
| Apertura formal de turno obligatoria | Config | Dueño | Inicial | Activada | Para trazabilidad de responsabilidad |
| Arqueo al cierre de turno | Config | Dueño | Inicial | Activado | Sin arqueo no hay control de efectivo |
| Arqueo con denominaciones | Config | Dueño | Inicial | Activado | Detecta discrepancias pequeñas |
| Intentos máximos en arqueo | Config | Dueño | Inicial | 3 intentos | Después de 3, el gerente debe autorizar la diferencia |
| Retiro automático al superar monto | Config→Auto | Dueño | Inicial | Desactivado | Para restaurantes con mucho efectivo |
| Umbral de retiro automático | Config | Dueño | Inicial | $5,000 MXN | Cuando el efectivo supera este monto |
| Corte de mesero activo | Config | Dueño | Inicial | Activado | Para restaurantes que pagan propinas al cierre |
| Notificación al dueño al cerrar turno | Config→Auto | Dueño | Inicial | Activada | Push notification dentro de la app |
| Enviar reporte de corte al contador | Config | Dueño | Inicial | Desactivado | Requiere email del contador |

---

## 07 IMPRESIÓN Y HARDWARE

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Impresoras (nombre, IP, modelo, tipo) | Config | Dueño/Fullsite | Inicial | Sin impresoras | Requiere hardware físico |
| Tipo de impresora por estación | Config | Dueño | Inicial | Térmica 80mm | El estándar del mercado |
| Routing de comanda por platillo | Config | Dueño | Inicial | Cocina principal | Cada platillo puede ir a una estación diferente |
| Routing de comanda por grupo | Config | Dueño | Inicial | Cocina principal | La barra recibe sus propias comandas |
| Impresora backup por estación | Config | Dueño | Inicial | Sin backup | Para failover automático |
| Impresora secundaria activa si falla la principal | Config→Auto | Dueño | Inicial | Activado si hay backup | Requiere que haya backup configurado |
| Alerta al gerente si impresora falla | Config→Auto | Dueño | Inicial | Activado | Siempre activo — no debería ser configurable |
| Aviso de cancelación impreso | Config | Dueño | Inicial | Activado | En estaciones sin KDS |
| Logo en ticket | Config | Dueño | Inicial | Sin logo | Requiere subir imagen |
| Footer del ticket (7 líneas) | Config | Dueño | Inicial | Mensaje de "¡Gracias por tu visita!" | Personalizable |
| QR de autofacturación en ticket | Config→Auto | Dueño | Inicial | Activado si CFDI configurado | Se activa solo cuando la facturación está lista |
| QR de encuesta en ticket | Config | Dueño | Inicial | Activado | Fácil de desactivar si el restaurante no quiere |
| Impresión de ticket digital (sin papel) | Config | Dueño | Inicial | Activado como opción | El cliente puede elegir digital o impreso |

---

## 08 FORMAS DE PAGO

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Formas de pago activas | Config | Dueño | Inicial | Efectivo + Tarjeta | Cada restaurante acepta cosas diferentes |
| Nombre de cada forma de pago | Config | Dueño | Inicial | Estándar (Efectivo, Tarjeta crédito, etc.) | "Getnet" vs "Tarjeta Santander" |
| Terminal bancaria integrada | Config | Dueño/Fullsite | Inicial | Sin integración | Requiere credenciales del proveedor |
| Diferencial de tarjeta como propina | Config | Dueño | Inicial | Desactivado | AMALAY lo tiene activo — no todos |
| Formas de pago que requieren gerente | Config | Dueño | Inicial | Ninguna | Algunos restaurantes requieren gerente para transferencias |
| Cuenta bancaria por forma de pago | Config | Dueño | Inicial | Una cuenta para todo | Para conciliación por banco |

---

## 09 FACTURACIÓN CFDI

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Datos fiscales del restaurante (RFC, razón social, CP, régimen) | Config | Dueño | Inicial | — | Obligatorio para CFDI |
| CSD (Certificado de Sello Digital) | Config | Dueño | Inicial | — | Requiere trámite ante el SAT |
| Series por sucursal | Config | Dueño | Inicial | A (o por letra de sucursal) | Para distinguir facturas entre sucursales |
| Portal de autofacturación activo | Config | Dueño | Inicial | Activado | El restaurante puede preferir manual |
| Texto del portal de autofacturación | Config | Dueño | Inicial | "Solicita tu factura aquí" | Personalización de branding |
| Factura global (frecuencia) | Config | Dueño | Inicial | Diaria | Algunos prefieren semanal |
| Política de cancelación de CFDI | Config | Dueño | Inicial | Requiere autorización del dueño | Para evitar cancelaciones indebidas |
| Complementos de pago activos | Config | Dueño | Inicial | Desactivado | Para restaurantes con crédito a clientes corporativos |

---

## 10 DELIVERY E INTEGRACIONES

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Plataformas activas (UberEats, Rappi, DiDi) | Config | Dueño | Inicial | Ninguna | Requiere onboarding con cada plataforma |
| Credenciales de integración por plataforma | Config | Dueño/Fullsite | Inicial | — | Obligatorio para integración |
| Marcas virtuales | Config | Dueño | Inicial | Una sola marca | Para restaurantes con múltiples conceptos |
| Horario por plataforma | Config | Dueño | Inicial | Mismo horario del restaurante | UberEats puede tener horario diferente |
| Tiempo de preparación por plataforma | Config | Dueño | Inicial | 20 minutos | Cada restaurante calibra diferente |
| Menú activo por plataforma | Config | Dueño | Ocasional | 100% del menú | Algunos platillos no viajan bien |
| Auto-86 por plataforma al llegar a stock 0 | Config→Auto | Dueño | Inicial | Activado | Recomendado siempre |
| Impresora para órdenes de delivery | Config | Dueño | Inicial | Cocina principal | Puede ser diferente a órdenes en mesa |

---

## 11 ALERTAS OPERATIVAS

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Alertas activas para el dueño | Config | Dueño | Inicial | Las 8 alertas de alta confianza activas | El dueño puede desactivar las que no quiere |
| Umbral de cancelaciones para alerta | Config | Dueño | Inicial | 2σ del promedio del equipo | Calculado automáticamente; ajustable |
| Umbral de descuento inusual | Config | Dueño | Inicial | Fuera del catálogo vigente | No se puede ajustar — es siempre que sale del catálogo |
| Tiempo sin ventas para alerta | Config | Dueño | Inicial | 60 minutos en horario activo | Ajustable por restaurante |
| Tiempo de mesa sin movimiento | Config | Dueño | Inicial | 90 minutos | Ajustable |
| Destinatario de alertas por tipo | Config | Dueño | Inicial | Solo el dueño | Puede agregar al gerente en algunas |
| Canal de alertas | Config | Dueño | Inicial | Push notification en app | Puede agregar email |
| Hora de silencio de alertas | Config | Dueño | Inicial | Ninguna | Para quienes no quieren alertas en la madrugada |

**Alertas que NUNCA deben ser desactivables:**
- Caja sin cerrar después de X horas del cierre esperado
- Transferencia de mesa con score de riesgo Alto
- Impresora de cocina sin respuesta durante despacho activo

---

## 12 AGENTES IA

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Agentes activos | Config | Dueño | Inicial | Todos activos | El restaurante puede desactivar los que no son relevantes |
| Frecuencia de ejecución por agente | Config | Dueño | Inicial | Default del agente | Algunos quieren el agente anti-fraude diario, no semanal |
| Umbral de anomalía por agente | Config | Dueño | Ocasional | Calculado automáticamente | 2σ como default; ajustable |
| Destinatario de hallazgos | Config | Dueño | Inicial | Solo el dueño | Puede incluir al gerente |
| Agentes que envían alerta inmediata vs resumen | Config | Dueño | Inicial | Alerta inmediata para fraude/transferencia; resumen para los demás | Configurable |
| Nivel de detalle del reporte de agente | Config | Dueño | Inicial | Resumen ejecutivo | Algunos quieren el análisis completo |

**Automáticos (sin configuración del usuario):**
- Score de riesgo de transferencia (calculado con el algoritmo, no configurable)
- Benchmark con el promedio del equipo para cancelaciones y descuentos
- Clasificación estrella/vaca/perro de platillos

---

## 13 USUARIOS Y PERMISOS

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Usuarios activos | Config | Dueño | Inicial + Ocasional | — | Cada restaurante tiene su staff |
| Rol por usuario | Config | Dueño | Inicial | Mesero | El rol más restrictivo como default |
| Permisos custom por usuario | Config | Dueño | Ocasional | Heredados del rol | Para casos especiales |
| PIN de cada usuario | Config | Usuario | Inicial | Temporal generado | El usuario lo cambia en primer login |
| Huella digital por usuario | Config | Usuario | Inicial | No registrada | Requiere hardware HID |
| Acceso al dashboard (POS-only vs dashboard) | Config | Dueño | Inicial | POS-only para meseros y cajeros | Los meseros no necesitan el dashboard |
| Módulos visibles en el dashboard por rol | Config | Dueño | Inicial | Perfil estándar por rol | El contador solo ve facturación y P&L |
| Vista de rendimiento propio (mesero ve sus propios KPIs) | Config | Dueño | Inicial | Activado | Cada mesero puede ver solo sus propios números |

---

## 14 SUCURSALES

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Nombre y dirección de la sucursal | Config | Dueño | Inicial | — | Único por sucursal |
| Zona horaria | Config | Dueño | Inicial | America/Monterrey | México tiene 4 zonas horarias |
| Horario de operación (apertura / cierre) | Config | Dueño | Inicial | 8am - 10pm | Define cuándo el "día" fiscal empieza y termina |
| Régimen fiscal y RFC | Config | Dueño | Inicial | — | Para CFDI por sucursal |
| Moneda (para operaciones internacionales futuras) | Config | Dueño | Inicial | MXN | Preparado para expansión |
| Data source (Wansoft vs Fullsite POS) | Config | Fullsite | Migración | Fullsite | Switch de migración — solo Fullsite lo toca |
| Almacenes activos | Config | Dueño | Inicial | Un almacén principal | Para multi-almacén (barra, cocina, market) |
| Consolidación en reportes multi-sucursal | Config | Dueño | Inicial | Todas las sucursales consolidadas | El dueño puede ver solo algunas |

---

## 15 REPORTES Y EXPORTACIONES

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Reportes programados activos | Config | Dueño | Inicial | Ninguno (requiere configurar) | El dueño elige qué reportes recibir y cuándo |
| Frecuencia de cada reporte programado | Config | Dueño | Inicial | — | Depende del reporte |
| Destinatarios de cada reporte | Config | Dueño | Inicial | Solo el dueño | Puede incluir contador, gerente |
| Formato de exportación default | Config | Dueño | Inicial | Excel | Algunos contadores prefieren PDF |
| Período de comparación en reportes | Config | Dueño | Inicial | Semana anterior | Algunos prefieren mismo período año anterior |
| Vista default del reporte de ventas | Config | Usuario | Inicial | Vista Dueño | Cada usuario ve la vista de su rol |
| Widgets en el home del dashboard | Config | Usuario | Inicial | Layout sugerido por tipo de restaurante | Personalizable por usuario |
| KPIs en el home | Config | Usuario | Inicial | Ventas del día, ticket promedio, mesas | Personalizable |

---

## 16 OPERACIÓN Y NOMINA

| Configuración | Tipo | Actor | Frecuencia | Default | ¿Por qué? |
|---|---|---|---|---|---|
| Puestos del restaurante | Config | Dueño | Inicial | Mesero, Cajero, Cocinero, Gerente | Base para permisos y nomina |
| Turnos (horarios por puesto) | Config | Dueño | Inicial | — | Cada restaurante tiene sus turnos |
| Programación semanal | Config | Gerente | Semanal | — | Se programa semana a semana |
| Días de asueto activos | Config | Dueño | Anual | Días SAT del año | Algunos restaurantes trabajan en asueto |
| Control de acceso activo (check-in) | Config | Dueño | Inicial | Activado | Para restaurantes que llevan asistencia |
| Propinas: modelo de distribución | Config | Dueño | Inicial | Pool (5% del mesero al fondo) | Cada restaurante tiene su acuerdo |
| Porcentaje de contribución al pool | Config | Dueño | Inicial | 5% de ventas del mesero | AMALAY usa 5% |
| Política de propinas en tarjeta | Config | Dueño | Inicial | Propina en tarjeta = propina del mesero | Algunos restaurantes pasan las propinas de tarjeta al pool |

---

## Mapa de configuración por momento del ciclo de vida

### 01. Onboarding (primer día)
Lo mínimo para operar. Todo lo demás puede esperar.

1. Datos de la sucursal (nombre, dirección, zona horaria)
2. Usuarios y roles (dueño, gerente, cajeros, meseros)
3. Menú básico (grupos + platillos con precio)
4. Formas de pago (efectivo como mínimo)
5. Impresora de cocina (si aplica)
6. Mesas y layout (si es restaurante con mesas)
7. Fondo de caja

**Tiempo estimado: < 30 minutos para un restaurante estándar.**

### 02. Configuración completa (primera semana)
Para tener el sistema completamente funcional.

8. Modificadores
9. Recetas y food cost
10. Usuarios adicionales y permisos granulares
11. Catálogo de descuentos y cortesías
12. Propinas (modelo de distribución)
13. CFDI (si hay facturación)
14. Alertas operativas preferidas
15. Agentes IA (cuáles activos, frecuencia)
16. Reportes programados

### 03. Optimización (primer mes)
Una vez que el sistema tiene datos reales.

17. Puntos de reorden por ingrediente (el sistema sugiere basado en consumo)
18. Horarios de disponibilidad de platillos
19. Delivery e integraciones
20. Widgets del home personalizados (basados en qué reportes el dueño visita más)
21. Umbral de alertas calibrado con el patrón real del restaurante

### 04. Automático con el tiempo (el sistema aprende)
Sin intervención del dueño.

- Score de riesgo de transferencias (calibrado con datos del restaurante)
- Clasificación estrella/vaca/perro (actualizada semanalmente)
- Sugerencias de OC (basadas en ventas proyectadas y stock actual)
- Predicción de staffing (basada en patrón histórico)
- Alertas de churn de clientes (basadas en frecuencia histórica)

---

## Lo que NO debe ser configurable

Estas configuraciones existen en Wansoft pero no deben existir en Fullsite:

| Qué | Por qué no |
|---|---|
| Audit log on/off | El audit log está siempre activo. Es infraestructura, no opción. |
| Deducción de inventario al cobrar vs al enviar | Al enviar siempre. No hay debate operativo que justifique deducir al cobrar. |
| Score de riesgo de transferencia (algoritmo) | El algoritmo lo decide el sistema. El usuario solo ve el resultado. |
| Tipo de base de datos o configuración de servidor | Cloud por defecto. El cliente no gestiona infraestructura. |
| Numeración de cortes Z (consecutivo) | Es un invariante fiscal. No es configurable. |
| Cuentas de prueba con acceso total | No deben existir en instancias de producción. |
| Cuentas contables para CONTPAQi | Es dominio del contador, no del restaurante. Integración directa. |
| Módulo de nómina completa (IMSS, ISR) | Es territorio de Nomipaq/CONTPAQi. No duplicar. |

---

## Lo que empieza como Config y evoluciona a Auto

El objetivo a largo plazo es reducir la configuración que el dueño tiene que hacer explícitamente.

| Configuración actual | Señal de evolución | Estado target |
|---|---|---|
| Punto de reorden por ingrediente | Después de 90 días de datos de ventas, el sistema puede sugerir el punto de reorden óptimo | `Config→Auto` |
| Umbral de anomalía en cancelaciones | Después de 60 días, el sistema conoce el patrón del equipo y calibra el umbral solo | `Auto` |
| Horario de disponibilidad de platillos | Si el dueño siempre vende X platillo solo en las mañanas, el sistema puede detectarlo | `Config→Auto` |
| Layout del home del dashboard | Si el dueño siempre abre el módulo de meseros primero, el sistema puede sugerirlo como widget | `Auto` |
| OC sugerida | Con ventas proyectadas + stock + lead time del proveedor, la OC puede generarse automáticamente | `Auto` (aprobación manual) |
| Frecuencia de agentes | Si un agente nunca encuentra nada, puede reducir su frecuencia automáticamente | `Auto` |

---

## Síntesis: Principios de configurabilidad

1. _El sistema debe funcionar sin configuración. El default es la elección correcta para el 80% de los restaurantes._
2. _Cada opción de configuración debe justificarse con: ¿hay al menos 20% de restaurantes que necesitan cambiar este default?_
3. _El onboarding completo debe tomar menos de 30 minutos. Si toma más, hay demasiadas opciones obligatorias._
4. _El audit log, la deducción al enviar, y la numeración de cortes no son configurables. Son invariantes._
5. _El objetivo a largo plazo es tener menos configuración, no más. El sistema aprende; el dueño calibra menos._
6. _Las consecuencias de un cambio de configuración deben ser visibles en la misma pantalla donde se hace el cambio._
7. _El dueño configura una vez. El sistema recuerda siempre. La configuración no es una tarea periódica._

---

> **Diseño conceptual de configurabilidad: cerrado.**
> Los siguientes gaps de configuración son prioritarios para implementar antes de los primeros 10 clientes:
> - Apertura formal de turno con confirmación de fondo
> - Corte de Mesero con cálculo de propinas
> - Sistema de Alertas Operativas con umbral configurable
> - Reportes programados dentro de la app
> - Widgets configurables en el home del dashboard
>
> Compañero: `SETTINGS-GAP-ANALYSIS.md` — análisis de qué settings implementar y en qué orden.
>
> Última actualización: 2026-07-25 — Daniel Ramonfaur + Claude Code (Fullsite)
