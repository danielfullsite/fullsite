# Roadmap de Inteligencia Operativa — Fullsite

> Documento definitivo. Cada hallazgo de Catalog Intelligence, Food Cost Engine
> y la Biblia de Wansoft clasificado en exactamente una categoria:
> MIGRAR, MEJORAR, o ELIMINAR.
>
> Escrito para Daniel. Sin fluff. Cada item es accionable.
> Ultima actualizacion: 2026-07-04

---

## 1. MIGRAR (Preservar/Importar a Fullsite)

### 1.1 Catalogo de platillos (522 items)

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| 522 platillos con clave, nombre, precio, grupo | Tabla platillos via API portal | `pos_menu_items` | Ya migrado | -- |
| 35 grupos/categorias de menu | Config portal → Grupos | `pos_categories` | Ya migrado | -- |
| Precios por tipo de orden (restaurante, llevar, delivery) | Platillos → Precios por tipo | `pos_menu_items.prices` | Ya migrado | -- |
| Modificadores y niveles | Portal → Modificadores → Asignacion | `pos_modifiers` | Ya migrado | -- |
| Horarios por platillo (desayuno/comida/todo el dia) | Portal → Horarios para platillos | `pos_menu_items.schedule` | Pendiente verificar | P1 |
| 7 platillos con precio $0 (Cargo Envio, extras, eventos) | Portal → Platillos | Validar en Fullsite si deben tener precio | Pendiente | P0 |

### 1.2 Recetas e ingredientes

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| 462 recetas vinculadas a platillos | Portal → Recetas de platillos | `recipes` + `recipe_ingredients` | Ya migrado | -- |
| 615 recetas totales (incluye sub-recetas) | Portal → Recetas + Recetas de subproductos | `recipes` | Ya migrado | -- |
| Cantidades y unidades por ingrediente | Recetas → qty + unidad | `recipe_ingredients` | Ya migrado | -- |
| 60 platillos SIN receta | No existe en Wansoft | Crear recetas en Fullsite o marcar como "sin costeo" | Pendiente | P1 |
| 81 ingredientes fantasma (en receta pero no en catalogo productos) | Inconsistencia interna Wansoft | Limpiar: crear producto o corregir receta | Pendiente | P1 |
| 33 productos sin costo asignado | Productos → Costos (falta dato) | Capturar costos reales con Monica/Alex | Pendiente | P1 |
| 439 recetas de 1 solo ingrediente | Wansoft → Recetas | Validar: Market items son correctos (1:1). Cocina items necesitan revision | Pendiente | P1 |

### 1.3 Inventario y productos

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| 769 productos master | Portal → Productos | `inventory_products` | Ya migrado | -- |
| 736 lineas de existencias | Portal → Existencias | `inventory_stock` | Ya migrado | -- |
| 878 registros de costos | Portal → Costos | `inventory_costs` | Ya migrado | -- |
| 90 puntos de reorden | Portal → Punto de reorden | `inventory_reorder_points` | Ya migrado | -- |
| Almacenes (cocina, barra, market) | Portal → Almacenes | `warehouses` | Ya migrado | -- |
| Departamentos de productos | Portal → Departamentos | `product_departments` | Ya migrado | -- |
| Unidades de medida y presentaciones | Portal → UM + Presentaciones | `units_of_measure` | Ya migrado | -- |
| 160 productos huerfanos (sin stock, sin receta) | Basura en Wansoft | NO migrar. Limpiar del catalogo Fullsite si entraron | P1 |
| 38 productos "criticos" sin receta vinculada | Wansoft → Productos | Vincular a recetas o reclasificar | P1 |

### 1.4 Proveedores

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| 202 proveedores (nombre, contacto) | Portal → Proveedores | `suppliers` | Ya migrado | -- |
| Plantillas de OC por proveedor ("JUGOS NL" con 12 items) | Portal → Plantillas de OC | `purchase_order_templates` | Listo para migrar | P1 |

### 1.5 Facturacion

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| Clientes FE (RFC, razon social, CP, regimen) | Portal → Clientes FE | `billing_clients` | Listo para migrar | P0 |
| Series por sucursal (AA, AB, AC) | Portal → Series | Config Facturama | Bloqueado (pago $1,650) | P0 |
| Historial de facturas emitidas | Portal → Facturas emitidas | Solo referencia, no migrar | P2 |

### 1.6 Usuarios y permisos

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| Usuarios POS (15 roles activos) | Portal → Usuarios PV | `pos_users` | Ya migrado | -- |
| Perfiles de permisos | Portal → Perfiles | `permission_profiles` | Ya construido (269 lineas) | -- |
| PINs de acceso | Terminal local | Regenerar en Fullsite | Pendiente | P0 |

### 1.7 Datos historicos

| Que | Fuente Wansoft | Destino Fullsite | Status | Prioridad |
|---|---|---|---|---|
| 887 dias de ventas diarias | Scraper → `wansoft_daily` | Ya en Supabase | Ya migrado | -- |
| Ventas por mesero historicas | `wansoft_daily.meseros` JSONB | Ya en Supabase | Ya migrado | -- |
| Ventas por grupo historicas | `wansoft_daily.ventas_por_grupo` JSONB | Ya en Supabase | Ya migrado | -- |

---

## 2. MEJORAR (Construir mejor que Wansoft)

### 2.1 Food Cost en Tiempo Real

**Wansoft:** Reporte estatico en Excel. Nadie lo abre. El food cost "oficial" sale 2 meses despues por el contador. El portal tiene `CostDetail`, `CostBySaucer`, `CostByGroup` pero requiere que alguien navegue 4 clicks y exporte.

**Fullsite debe hacer:**
- Dashboard de food cost por categoria actualizado en tiempo real
- Alerta automatica cuando un platillo supera el 35% de food cost (cocina/barra) o 75% (Market)
- Vista rapida: "Estos 5 platillos te estan costando dinero" con accion directa (subir precio / ajustar porcion)
- Food cost separado cocina (24.9%) vs Market (76.3%) -- nunca mezclar

**Por que importa:** AMALAY tiene food cost cocina 24.9% (saludable) pero 5 platillos se venden a PERDIDA y 34 platillos de cocina/barra superan 40%. Cada dia sin esta visibilidad es dinero perdido.

**Prioridad:** P1
**Diferenciador:** SI -- Wansoft no puede hacer esto en real-time
**Esfuerzo:** M

### 2.2 Alertas de Margen Negativo

**Wansoft:** Nada. Cero. Un producto puede venderse a perdida durante meses y nadie se entera.

**Fullsite debe hacer:**
- Detectar automaticamente items con margen negativo al importar catalogo
- Los 5 actuales: TOTEBAG ($-925), NATROL Melatonine ($-162), LIBRO Kidness ($-150), CAFE EN GRANO 500G ($-120), NUUN Sport ($-17)
- Notificacion WhatsApp a Daniel/Monica: "Estos productos se venden a perdida. Accion requerida."
- Bloqueo opcional: no permitir venta hasta que se corrija precio

**Por que importa:** $1,274.72 MXN de perdida CADA VEZ que se vende el combo completo de estos 5 items. Es dinero que sale del bolsillo.

**Prioridad:** P1
**Diferenciador:** SI
**Esfuerzo:** S

### 2.3 Ingredientes Criticos y Riesgo de Desabasto

**Wansoft:** Punto de reorden como tabla pasiva. Solo 90 de 769 productos tienen punto de reorden configurado (11.7%).

**Fullsite debe hacer:**
- Top 20 ingredientes por dependencia (cuantas recetas lo usan). Flor comestible = 56 recetas, tomate cherry = 20, jugo de limon = 20.
- Si flor comestible se acaba, 56 platillos se ven afectados. Eso es una emergencia.
- Alerta proactiva: "Te quedan 2 dias de aguacate basado en ventas de las ultimas 2 semanas"
- Auto-generacion de OC cuando el stock baja del punto de reorden

**Por que importa:** Un solo ingrediente faltante puede afectar 56 platillos. En un sabado de AMALAY eso son $30K+ de ventas perdidas.

**Prioridad:** P1
**Diferenciador:** SI -- Wansoft tiene la tabla pero no la inteligencia
**Esfuerzo:** M

### 2.4 Sensibilidad de Precios de Insumos

**Wansoft:** Tiene `VariacionDeCostos` como reporte. Pasivo, nadie lo consulta.

**Fullsite debe hacer:**
- Monitor automatico: si un ingrediente sube >10%, alerta inmediata
- Top 10 ingredientes de mayor impacto si suben 15%: LMNT Electrolyte ($126 impacto), Cheesecake Vasco ($54), Vino Laus Rosado ($44)
- Recomendacion: "El cafe en grano aparece en 19 recetas. Negocia precio fijo con tu proveedor o busca segundo proveedor."

**Por que importa:** El cafe en grano a $330/kg impacta 19 recetas. Una subida del 15% impacta $28.71 en costo total del menu. Multiplicado por volumen de ventas = miles de pesos mensuales.

**Prioridad:** P2
**Diferenciador:** SI
**Esfuerzo:** M

### 2.5 Limpieza Inteligente de Catalogo

**Wansoft:** Tiene `ProductosQueNoEstanEnRecetas` como reporte. Nadie actua.

**Fullsite debe hacer:**
- Dashboard de salud del catalogo:
  - 160 productos huerfanos (sin stock, sin receta) -- sugerir eliminacion
  - 81 ingredientes fantasma -- sugerir correccion
  - 33 productos sin costo -- sugerir captura
  - 60 platillos sin receta -- sugerir creacion
- Score de calidad: "Tu catalogo esta al 71.1% de cobertura. Para llegar al 95% necesitas: crear 60 recetas + capturar 33 costos + resolver 81 fantasmas"
- Accion en 1 click: "Eliminar 160 huerfanos" con undo

**Por que importa:** Un catalogo sucio produce food cost incorrecto. Si el 29% de los platillos no tienen costeo completo, las decisiones de menu se toman a ciegas.

**Prioridad:** P1 (la limpieza inicial), P2 (el monitor automatico)
**Diferenciador:** SI -- ningun POS mexicano tiene esto
**Esfuerzo:** M

### 2.6 Deduccion al Enviar a Cocina (ya implementado)

**Wansoft:** Deduce inventario al COBRAR. Durante toda la preparacion, el inventario miente.

**Fullsite ya hace:** Deduccion al enviar comanda (INV-1 completado 2026-06-30, idempotente).

**Pendiente:**
- INV-4: Reversal al cancelar item enviado no preparado
- INV-5: Revertir market stock al reabrir orden

**Prioridad:** P1 (INV-4, INV-5)
**Diferenciador:** SI -- decision de diseno #2 de Fullsite
**Esfuerzo:** S

### 2.7 Compras como Ciudadano de Primera Clase

**Wansoft:** En 20 anos NUNCA construyo compras reales. Solo OC internas entre sucursales y un catalogo decorativo de 202 proveedores. No hay ciclo necesidad -> OC a proveedor externo -> recepcion -> factura -> pago.

**Fullsite debe hacer (y ya tiene parte):**
- OC a proveedores externos con envio por WhatsApp/email (construido)
- Recepcion con 6 motivos de discrepancia (construido)
- Matching inteligente con fuzzy (construido)
- Historial de precios por ingrediente (pendiente)
- Prediccion de compras con IA basada en ventas historicas + eventos (pendiente)
- Devolucion posterior a recepcion (pendiente -- Wansoft si lo tiene)

**Por que importa:** 35-45% del ingreso se va en insumos. Controlar compras es controlar el 35-45% del negocio.

**Prioridad:** Historial precios P1, Prediccion IA P2, Devolucion P2
**Diferenciador:** SI (el ciclo completo no existe en Wansoft)
**Esfuerzo:** L (todo junto), M (cada pieza)

### 2.8 Produccion y Batch Cooking

**Wansoft:** Su modulo mas profundo. 26 stored procedures. Ordenes de produccion, productores, plantillas, subproductos en proceso, tablajeria. AMALAY lo necesita para panaderia (croissants, galletas, panes).

**Fullsite debe hacer:**
- Produccion como entidad de primera clase (no hack de inventario)
- Ordenes: "produce 20 croissants" -> baja harina/mantequilla, sube croissants terminados
- Plantillas recurrentes: "todos los jueves produce batch de galletas"
- Subproductos: masa madre, fondo de pollo, salsas base -> reutilizables en multiples recetas
- Costos adicionales: gas, mano de obra, depreciacion (no solo ingredientes)
- Yield tracking: ingreso de masa vs salida real, diferencia = merma

**Lo que NO copiamos:** Tablajeria como modulo separado (es un caso de produccion), "Productores" como entidad separada (el productor es un empleado con rol).

**Por que importa:** Sin produccion, el inventario de AMALAY no refleja la realidad de la panaderia. Las galletas Amalay (20 recetas las usan) son subproductos que se producen en batch.

**Prioridad:** P2 (pre-10 restaurantes, post-cutover estable)
**Diferenciador:** PARITY (Wansoft ya lo hace bien)
**Esfuerzo:** XL

### 2.9 Corte de Caja Completo

**Wansoft:** 5 tipos de corte (X/Turno/Z/Global/Mesero). 20 anos de madurez.

**Fullsite tiene:** Corte de turno completo con formato Wansoft.

**Fullsite necesita:**
- Corte X (parcial, sin cerrar) -- "como vamos a media jornada"
- Corte Z con numeracion consecutiva -- requerimiento fiscal (Hacienda)
- Corte por mesero -- cuanto vendio cada uno en el turno

**Prioridad:** Corte Z P1, Corte X P2, Corte por mesero P2
**Diferenciador:** PARITY
**Esfuerzo:** M

### 2.10 Estado de Resultados (P&L) Automatico

**Wansoft:** `GetIncomeStatemetByMonthInYear` -- calcula P&L mensual automatico: ingresos netos - egresos (compras + nomina + vales) - costo = utilidad.

**Fullsite debe hacer:**
- P&L mensual automatico usando datos que YA existen en Supabase
- Ingresos: ventas netas de `wansoft_daily` (brutas - descuentos - cancelaciones - cortesias)
- Egresos: compras registradas + estimado de nomina
- Costo: food cost calculado por recetas
- Comparativa mes vs mes, ano vs ano
- "Daniel, en junio ganaste $X netos. 12% mas que mayo. Tu food cost bajo de 26% a 24.9%."

**Por que importa:** La mayoria de duenos no saben cuanto ganan hasta que el contador entrega el estado financiero 2 meses despues. Esto les da la respuesta HOY.

**Prioridad:** P2
**Diferenciador:** SI (automatico + real-time vs Excel mensual)
**Esfuerzo:** M

### 2.11 Reportes de Personas por Hora

**Wansoft:** 3 reportes dedicados SOLO a contar personas: PersonsByHour, PersonsByDay, PersonsByDayName. Es oro.

**Fullsite tiene:** `personas_restaurant` en `wansoft_daily` (diario). No tiene por hora.

**Fullsite debe hacer:**
- Personas por hora (determina cuantos meseros necesitas a las 10am vs 2pm)
- Personas por dia de la semana (patrones: sabado = 2x martes)
- Ticket promedio POR PERSONA, no por mesa (la metrica real)

**Prioridad:** P2
**Diferenciador:** PARITY (Wansoft lo tiene, nosotros no)
**Esfuerzo:** S

### 2.12 Transferencias entre Sucursales

**Wansoft:** 760 referencias en SPs. Flujo completo: crear -> seleccionar productos -> enviar (baja origen) -> recibir (alta destino, con discrepancia) -> factura.

**Fullsite no tiene:** Nada.

**Por que importa:** Pre-requisito para cadenas (>5 sucursales). AMALAY no lo necesita hoy (1 sucursal) pero cualquier cliente multi-sucursal lo requiere.

**Prioridad:** P3 (pre-100 restaurantes)
**Diferenciador:** PARITY
**Esfuerzo:** L

### 2.13 Disponibilidad por Existencias en Delivery

**Wansoft:** Menu de delivery es estatico. Si se acaba el aguacate, los bowls siguen apareciendo en Rappi hasta que alguien lo desactiva manualmente.

**Fullsite debe hacer:**
- Si el inventario de un ingrediente critico llega a cero, desactivar automaticamente los platillos afectados en todas las plataformas de delivery
- Ejemplo: aguacate = 0 -> desactivar 18 platillos en Rappi/UberEats automaticamente
- Reactivar automaticamente cuando se recibe inventario

**Prioridad:** P2
**Diferenciador:** SI -- ningun POS mexicano hace esto
**Esfuerzo:** L

### 2.14 Menu Engineering con IA

**Wansoft:** No existe. Los reportes de ventas por platillo existen, pero nadie cruza ventas con food cost para clasificar platillos.

**Fullsite debe hacer (ya tiene agente semanal):**
- Clasificacion BCG: Estrellas (alto margen, alta venta), Vacas (alto margen, baja venta), Puzzles (bajo margen, alta venta), Perros (bajo margen, baja venta)
- Cruzar food cost engine con ventas reales: "SALMON BAGEL tiene margen de $332.60 y se vende X veces por semana -> ESTRELLA"
- Recomendaciones: "Sube el precio de JUGO VERDE DE LA CASA de $95 a $120. Tiene 86.7% food cost. Nadie dejara de comprarlo por $25."
- "BISKETO DE HARINA DE ALMENDRA tiene 98.4% food cost y margen de $1.22. Eliminalo del menu o sube el precio a $120."

**Por que importa:** AMALAY tiene 522 platillos. Sin clasificacion, no sabe cuales promover, cuales eliminar, cuales subir de precio.

**Prioridad:** P1 (clasificacion basica), P2 (recomendaciones automaticas)
**Diferenciador:** SI
**Esfuerzo:** M

### 2.15 CRM Automatico

**Wansoft:** Tarjetas de regalo fisicas + encuestas de 15 preguntas + MegaPoints (nadie lo usa).

**Fullsite ya tiene:**
- 12,200 clientes de Reservy en Supabase
- Bot WhatsApp 24/7
- Clientes FE como seed de CRM (RFC = identificador unico)

**Fullsite debe completar:**
- Segmentacion IA: "clientes que vienen martes pero no han venido en 3 semanas"
- Prediccion de churn: "este regular no vino en 14 dias, mandale descuento"
- Historial de visitas por cliente (vinculado a facturacion + reservaciones)

**Prioridad:** P2
**Diferenciador:** SI -- Wansoft no tiene CRM real
**Esfuerzo:** L

### 2.16 Facturacion Self-Service

**Wansoft:** El cliente llama o va al portal web para solicitar su factura. Alguien del restaurante tiene que entrar al portal y emitirla manualmente.

**Fullsite debe hacer:**
- QR en ticket -> cliente captura sus datos fiscales -> factura emitida automaticamente via Facturama
- Factura global automatica periodica para ventas sin facturar

**Prioridad:** P0 (bloqueado por pago Facturama $1,650)
**Diferenciador:** SI
**Esfuerzo:** S (ya construido, solo falta activar)

---

## 3. ELIMINAR (No copiar de Wansoft)

### 3.1 Billar (BillardSetting)
**Que es:** Modulo para mesas de billar con temporizador y cobro por hora.
**Por que Wansoft lo construyo:** Clientes de antros/bares con mesas de billar.
**Por que no:** Nicho muerto. <1% de restaurantes. Zero demanda en nuestro mercado objetivo (cafes, brunch, casual dining).

### 3.2 MegaPoints (Programa de puntos)
**Que es:** Sistema de puntos por compra, canjeable por productos.
**Por que Wansoft lo construyo:** Feature request de algun cliente grande circa 2010.
**Por que no:** Los programas de puntos genericos no generan lealtad real. Starbucks necesito $400M para que funcione. Un restaurante independiente no tiene esa escala. Mejor: CRM inteligente con ofertas personalizadas.

### 3.3 Tarjetas de regalo fisicas
**Que es:** Produccion, activacion y tracking de tarjetas plasticas pre-cargadas.
**Por que Wansoft lo construyo:** Era el estandar en 2005. Starbucks, Liverpool, todos tenian tarjetas fisicas.
**Por que no:** 2026. Todo es digital. Gift cards digitales via WhatsApp/email son mas baratas, rastreables, y no requieren inventario fisico.

### 3.4 Encuestas de 15 preguntas
**Que es:** Constructor de encuestas con opcion multiple + calificacion.
**Por que Wansoft lo construyo:** Moda de "voz del cliente" circa 2008.
**Por que no:** Nadie las llena. La tasa de respuesta de una encuesta de 15 preguntas en un restaurante es <2%. Mejor: NPS de 1 pregunta via QR en ticket. O simplemente monitorear resenas de Google.

### 3.5 Nomina completa (IMSS, ISR, timbrado de recibos)
**Que es:** Calculo de nomina, deducciones, timbrado de recibos CFDI.
**Por que Wansoft lo construyo:** Intentar ser todo-en-uno.
**Por que no:** Es territorio de CONTPAQi/Nomipaq/ADP. La regulacion laboral mexicana cambia constantemente. Mantener compliance de nomina es un negocio en si mismo. Fullsite se integra con el sistema de nomina del contador, no lo reemplaza. Andy (contador de AMALAY) ya usa CONTPAQi.

### 3.6 Huella digital como mecanismo de auth
**Que es:** Lector biometrico (DP4500) para check-in y login en POS.
**Por que Wansoft lo construyo:** Era la unica forma "segura" de identificar empleados en 2007.
**Por que no:** AMALAY tiene problemas reales con el lector de huella (es P0 blocker). Lectura inconsistente, no funciona con manos mojadas/grasosas (cocina de restaurante). PIN + app movil es mas confiable. Si el hardware falla, falla todo. El futuro es face recognition o NFC badge, no fingerprint.

### 3.7 SQL Server local como fuente de verdad
**Que es:** La base de datos del restaurante corre en una terminal fisica. Si muere, el restaurante muere.
**Por que Wansoft lo construyo:** En 2005 no habia cloud confiable en Mexico. Era la unica opcion.
**Por que no:** Es 2026. Cloud con offline-first. La terminal es desechable, los datos son eternos. Principio #4 de Fullsite.

### 3.8 Sincronizacion como concepto visible
**Que es:** Status de sync entre terminal local y portal web. Si no sincroniza, el dueno no ve datos.
**Por que Wansoft lo construyo:** Consecuencia de la arquitectura local-first. Necesitas sync manual.
**Por que no:** Los datos simplemente estan ahi. Real-time. No hay "esperando sincronizacion." El concepto no deberia existir para el usuario.

### 3.9 MR6 templates de impresion para reportes
**Que es:** 47 templates de impresion en formato Microsoft Report (MR6).
**Por que Wansoft lo construyo:** Era el estandar de reporting en .NET circa 2005.
**Por que no:** Es 2026. Dashboards interactivos, no PDFs. Export a Excel cuando se necesite, pero la interfaz principal es web.

### 3.10 "Compradores" como entidad separada
**Que es:** Tabla independiente para personas autorizadas a comprar, separada de empleados.
**Por que Wansoft lo construyo:** Over-engineering para grandes cadenas con departamentos de compras.
**Por que no:** Para <500 restaurantes, el comprador es un empleado con permiso. No necesita su propia entidad.

### 3.11 Tipo de vales como modulo independiente
**Que es:** CRUD completo para tipos de vales (comida, transporte, despensa).
**Por que Wansoft lo construyo:** Modelo de egresos ultra-granular.
**Por que no:** Un vale es un gasto con categoria. No necesita su propio modulo.

### 3.12 "Liberaciones" como modulo visible al usuario
**Que es:** Lista de releases de software visible en el portal del cliente.
**Por que Wansoft lo construyo:** Para que el cliente vea que "se esta trabajando."
**Por que no:** Las actualizaciones son automaticas y silenciosas. El usuario no necesita saber que version tiene. Solo necesita que funcione.

### 3.13 Proyeccion de ventas como reporte estatico
**Que es:** Extrapolacion lineal de ventas pasadas para proyectar futuras.
**Por que Wansoft lo construyo:** Feature decorativo. Numeros que nadie cuestiona.
**Por que no:** La prediccion tiene que ser IA con contexto (clima, dia de la semana, eventos, temporada). Extrapolacion lineal es un numero que miente con confianza.

### 3.14 Complementos de pago como modulo propio
**Que es:** Gestion de pagos en parcialidades (PPD) con CFDI de complemento.
**Por que Wansoft lo construyo:** Requerimiento contable para clientes corporativos.
**Por que no:** Es territorio de contabilidad (CONTPAQi). Un restaurante rara vez tiene pagos en parcialidades. Si un cliente lo necesita, el contador lo emite.

### 3.15 Cuentas contables como CRUD manual
**Que es:** Configuracion de catalogo de cuentas contables dentro de Wansoft.
**Por que Wansoft lo construyo:** Para mapear ventas a cuentas del contador.
**Por que no:** Integracion con CONTPAQi, no duplicacion. El contador tiene su propio catalogo. No le vamos a pedir que lo mantenga en dos sistemas.

### 3.16 Paleo de barra (pesado de botellas)
**Que es:** Pesar botellas abiertas de licor, comparar con consumo esperado, detectar diferencias.
**Por que Wansoft lo construyo:** Critico para bares/antros serios.
**Por que no:** AMALAY tiene barra pero no es un bar. <10% de restaurantes lo usan. Es post-500 restaurantes como diferenciador para bares. No es prioridad hoy.

### 3.17 Pagos anticipados como modulo
**Que es:** Registro de anticipos para eventos y banquetes.
**Por que Wansoft lo construyo:** Para restaurantes con salones de eventos.
**Por que no:** AMALAY maneja eventos con reservaciones + deposito bancario. El flujo actual funciona. No necesita modulo dedicado.

---

## 4. ROADMAP DE INTELIGENCIA OPERATIVA

### P0 -- Antes del cutover (Julio 8, 2026)

| # | Capacidad | Descubrimiento | Impacto | Vale construir? | Diferenciador? |
|---|---|---|---|---|---|
| 1 | **Facturama produccion** | CFDI es obligatorio. Sin facturacion, no hay cutover | Bloquea 20-40% de ingresos (clientes corporativos) | SI, bloqueante | PARITY |
| 2 | **Clientes FE migrados** | 522 platillos migrados pero los clientes de facturacion no | Sin datos fiscales de clientes, facturacion manual | SI, 15 minutos de trabajo | PARITY |
| 3 | **IEPS modelo fiscal** | Bebidas alcoholicas requieren IEPS en el CFDI. Sin XML de referencia de Wansoft no podemos validar | Facturas rechazadas por SAT | SI, bloqueante | PARITY |
| 4 | **PINs de acceso regenerados** | Los PINs de Wansoft no migran (son locales en SQL Server) | Sin PINs, cualquiera accede al POS | SI, 30 minutos | PARITY |
| 5 | **7 platillos con precio $0 validados** | Cargo Envio, extras, eventos -- deben tener precio $0 o son error? | Ventas sin cobro | SI, verificacion de 10 min con Monica | PARITY |
| 6 | **Shadow Day** | Operar ambos sistemas en paralelo 1 dia completo | Descubrir gaps antes de quemar el puente | SI, critico | N/A |
| 7 | **Cajon de dinero** | Fix EC TICKET o mover RJ-11 | Sin cajon, corte no cuadra | SI, hardware | PARITY |

### P1 -- Julio 2026 (primera semana post-cutover)

| # | Capacidad | Descubrimiento | Impacto | Vale construir? | Diferenciador? |
|---|---|---|---|---|---|
| 1 | **Alertas de margen negativo** | 5 productos se venden a perdida por $1,274.72 combinados | Cada venta de TOTEBAG pierde $925 | SI. 1 dia de trabajo. ROI inmediato | SI |
| 2 | **Food cost dashboard** | Food cost cocina 24.9% (sano) pero 34 items de cocina >40% | Visibilidad sobre el 35-45% del gasto | SI. Los datos ya existen | SI |
| 3 | **60 recetas faltantes** | 11.5% del menu sin costeo. Incluye items de cocina reales (Red Velvet Latte, Fruit Bowl, Amalay Triple Chocolate) | Food cost subestimado, decisiones ciegas | SI. Capturar con chef en 2-3 horas | PARITY |
| 4 | **81 ingredientes fantasma** | Inconsistencias internas de Wansoft. Ingrediente en receta pero no existe como producto | Deduccion de inventario falla silenciosamente | SI. Limpieza de datos, 2-3 horas | PARITY |
| 5 | **33 productos sin costo** | Costos faltantes hacen que el food cost real sea MAS ALTO que el calculado | Food cost reportado es optimista | SI. Capturar con Monica/Alex, 1 hora | PARITY |
| 6 | **Corte Z con numeracion** | Requerimiento fiscal. Hacienda puede pedir cortes Z consecutivos | Riesgo regulatorio | SI. M esfuerzo | PARITY |
| 7 | **INV-4/INV-5** | Reversal de inventario al cancelar items / reabrir ordenes | Inventario miente si no se revierte | SI. S esfuerzo | SI |
| 8 | **160 productos huerfanos** | Basura en el catalogo que ensucia busquedas y reportes | Catalogo limpio = busquedas rapidas en POS | SI. 1 hora de limpieza | PARITY |
| 9 | **Plantillas de OC migradas** | AMALAY tiene plantillas como "JUGOS NL" con 12 items pre-cargados | Compras rapidas para el equipo | SI. 1 hora de migracion | PARITY |
| 10 | **Fondo de propinas** | Recoleccion, reparto, retiro. Drama constante sin sistema | Sin propinas, meseros se van | SI. M esfuerzo | PARITY |
| 11 | **Menu engineering basico** | Cruzar food cost x ventas. Clasificar 522 platillos | Saber que promover, que eliminar, que subir de precio | SI. Los datos ya existen (agente semanal existe) | SI |

### P2 -- Q3 2026 (Agosto-Septiembre)

| # | Capacidad | Descubrimiento | Impacto | Vale construir? | Diferenciador? |
|---|---|---|---|---|---|
| 1 | **Ingredientes criticos + riesgo desabasto** | Flor comestible = 56 recetas. Aguacate = 18. Si faltan, decenas de platillos fuera | Prevencion de ventas perdidas | SI. M esfuerzo | SI |
| 2 | **Sensibilidad de precios** | LMNT Electrolyte: si sube 15% impacta $126. Cafe en grano: 19 recetas | Negociacion informada con proveedores | SI. M esfuerzo | SI |
| 3 | **P&L automatico** | Los datos ya existen. Solo falta consolidar ventas-egresos-costo | Dueno sabe cuanto gana HOY, no en 2 meses | SI. M esfuerzo. Alto valor, baja complejidad | SI |
| 4 | **Personas por hora** | Wansoft tiene 3 reportes dedicados. Fullsite solo tiene por dia | Staffing inteligente: cuantos meseros a las 10am vs 2pm | SI. S esfuerzo | PARITY |
| 5 | **Produccion / batch cooking** | Panaderia AMALAY necesita ordenes de produccion | Sin esto, inventario de bakery no cuadra | SI. XL esfuerzo. Core del OS | PARITY |
| 6 | **Limpieza automatica de catalogo** | Score de calidad 71.1%. Meta: 95%+ | Decisiones informadas vs ciegas | SI. M esfuerzo | SI |
| 7 | **Disponibilidad delivery por existencias** | Si no hay aguacate, 18 platillos se desactivan en Rappi automaticamente | Zero ordenes rechazadas por falta de insumo | SI. L esfuerzo. Requiere API UberEats/Rappi | SI |
| 8 | **Historial de precios por ingrediente** | Detectar inflacion temprano, negociar con datos | Ahorro en compras del 5-10% | SI. M esfuerzo | SI |
| 9 | **Devolucion post-recepcion** | Wansoft lo tiene. Fullsite no. Caso real: fresas golpeadas, cajas faltantes | Inventario correcto, nota de credito a proveedor | SI. M esfuerzo | PARITY |
| 10 | **Corte X (parcial)** | "Como vamos a media jornada" sin cerrar turno | Visibilidad intra-dia para el gerente | SI. S esfuerzo | PARITY |
| 11 | **CRM automatico** | 12.2K clientes existentes + cada factura = datos de cliente | Retencion > adquisicion. 5-7x mas barato | SI. L esfuerzo | SI |

### P3 -- Q4 2026+ (Escala)

| # | Capacidad | Descubrimiento | Impacto | Vale construir? | Diferenciador? |
|---|---|---|---|---|---|
| 1 | **Transferencias inter-sucursal** | 760 refs en Wansoft. Pre-requisito para cadenas | Sin esto, no escalas a >5 sucursales | SI, cuando haya demanda. L esfuerzo | PARITY |
| 2 | **Prediccion de compras IA** | "Manana necesitas 200 huevos basado en historico + que es sabado" | Compras just-in-time, zero desperdicio | SI. L esfuerzo. Necesita datos de 3+ meses | SI |
| 3 | **Red de proveedores compartida** | 20 restaurantes Fullsite comprando pollo juntos = 12% descuento | Efecto red. Moat real. Imposible de replicar sin escala | SI, cuando haya 20+ clientes. XL esfuerzo | SI |
| 4 | **Benchmarks anonimos** | "Tu food cost de 38% esta 5 puntos arriba del promedio de tu categoria" | Presion positiva + demostracion de valor | SI, cuando haya 50+ restaurantes | SI |
| 5 | **Paleo de barra** | Control de licor abierto. Pesado de botellas vs consumo esperado | Diferenciador para bares serios | No hoy. Post-500 restaurantes si hay demanda | SI |
| 6 | **Prediccion de demanda por plataforma** | Ajustar preparacion pre-peak en Rappi vs UberEats | Menos rechazos, menos desperdicio | SI. L esfuerzo | SI |
| 7 | **Scheduling IA** | "El sabado necesitas 2 meseros extra basado en personas por hora historico" | Optimizacion de nomina (costo laboral = 25-30% del ingreso) | SI. M esfuerzo. Requiere personas por hora | SI |

---

## Score de Prioridad Consolidado

| Prioridad | Items | Theme |
|---|---|---|
| **P0 (pre-cutover)** | 7 | Facturacion, hardware, validacion. Todo es bloqueante. |
| **P1 (julio)** | 11 | Inteligencia de costos + limpieza de datos + features operativos criticos |
| **P2 (Q3)** | 11 | Inteligencia predictiva + produccion + CRM |
| **P3 (Q4+)** | 7 | Escala + efecto red |
| **ELIMINAR** | 17 | Funcionalidad muerta o territorio de otro sistema |

## Decision Clave

El food cost engine revelo que AMALAY tiene un negocio saludable en cocina (24.9%) pero un catalogo sucio (71.1% de cobertura). La prioridad #1 post-cutover NO es construir features nuevas -- es limpiar los datos para que las decisiones sean confiables.

**Secuencia correcta:**
1. Cutover funcional (P0) -- julio 8
2. Datos limpios (P1) -- semana 1-2 post-cutover
3. Inteligencia sobre datos limpios (P1-P2) -- julio-agosto
4. Prediccion y automatizacion (P2-P3) -- septiembre+

No se puede tener inteligencia operativa sobre datos sucios. Primero limpiar, despues construir.

---

> Este documento se actualiza despues de cada milestone.
> Cada item tiene dueno, prioridad, y criterio de exito.
> Si algo no esta aqui, no existe.
