# La Biblia de Wansoft

> Reverse engineering de 20 anos de conocimiento operativo restaurantero.
> No para copiar. Para entender POR QUE existe cada cosa,
> y decidir conscientemente que superar, que adoptar, y que enterrar.
>
> Documento estrategico de Fullsite. Ultima actualizacion: 2026-07-04

---

## Indice

1. [Por que Wansoft sobrevivio 20 anos](#1-por-que-wansoft-sobrevivio-20-anos)
2. [Anatomia completa del sistema](#2-anatomia-completa-del-sistema)
3. [Modulo por modulo: analisis estrategico](#3-modulo-por-modulo)
4. [El conocimiento oscuro](#4-el-conocimiento-oscuro)
5. [Que modulos usa todo mundo vs casi nadie](#5-adopcion-real-de-modulos)
6. [Matriz de comparacion Fullsite vs Wansoft](#6-matriz-de-comparacion)
7. [Las 10 decisiones de diseno que definen a Fullsite](#7-las-10-decisiones)

---

## 1. Por que Wansoft sobrevivio 20 anos

### El modelo de negocio

Wansoft no es un producto. Es un ecosistema de dependencia:

1. **Netsilver local = candado.** SQL Server corriendo en la terminal del restaurante. Si la terminal muere, el restaurante muere. El restaurante NECESITA a Wansoft para el restore. Eso no es un bug — es el modelo de negocio.

2. **SaaS antes del SaaS.** El portal web (`wansoftpos.com`) es donde viven los reportes, la configuracion del menu, la facturacion. Pero los datos se generan localmente y se SINCRONIZAN al portal. Esa sincronizacion es el pulso vital. Si no sincroniza, el dueno del restaurante no ve nada. Eso genera llamadas de soporte. Las llamadas de soporte generan renovaciones.

3. **Complejidad como moat.** 211 pantallas en el portal. 150+ endpoints HTTP. 822 stored procedures en la DB local. 80+ tablas. 47 templates de impresion. Ningun competidor nuevo puede replicar eso en menos de 3 anos. Wansoft lo sabe.

4. **Distribucion via socios.** Wansoft no vende directo — tiene distribuidores regionales (como Eduardo de la Garza, que construyo la operacion comercial del noreste de 2 a 35 personas). Cada distribuidor es cautivo: conoce el sistema, entrena al restaurante, y cobra por instalacion + soporte.

5. **Feature creep intencional.** Tienda (retail), restaurante, ecommerce, nomina, encuestas, tarjetas de regalo, produccion, tablajeria, billar. Cada modulo extra amarra a un tipo mas de cliente. No importa si el 80% no lo usa — importa que el 20% que lo usa no pueda migrar.

### Por que NO cayeron

- Nadie en Mexico ha construido un backoffice restaurantero comparable. Poster, Soft Restaurant, iFood — todos son POS de ventas con inventario decorativo.
- La barrera de entrada no es tecnologica. Es OPERATIVA. Necesitas conocer tablajeria, produccion de panaderia, facturacion electronica mexicana (CFDI 4.0), integraciones con Rappi/UberEats, y 15 tipos de reportes que el contador espera.
- El costo de cambio es altisimo: reconfigurar 522 platillos, 615 recetas, 202 proveedores, 3000 productos de inventario, permisos de 15 roles, y entrenar a un staff que rota cada 3 meses.

### Por que VAN a caer

- .NET 4.5 de 2007. SQL Server local. Sin HTTPS en la API interna. La deuda tecnica es terminal.
- Zero innovacion en 5 anos. El portal web sigue usando jqGrid y MR6 reports.
- No tienen IA, no tienen mobile-first, no tienen real-time.
- Un restaurante que usa Wansoft no puede contestar "cuanto gano ayer" sin esperar a que sincronice, abrir el portal, navegar 4 clicks, y exportar un Excel.
- Fullsite contesta esa pregunta por WhatsApp en 3 segundos.

---

## 2. Anatomia completa del sistema

### Estructura del portal (211 items descubiertos)

```
Wansoft Portal Web
|
+-- Reportes (el corazon — donde vive el dueno)
|   +-- Escritorio (dashboard con 15 widgets)
|   +-- Ingresos
|   |   +-- Ventas por sucursal (9 hojas Excel: resumen, ventas, cortesias, descuentos, cancelaciones, anulaciones, ocupacion, reporte contador)
|   |   +-- Proyeccion de ventas
|   |   +-- Cortes (por dia)
|   |   +-- Cobranza
|   |   +-- Retiros
|   |   +-- Pagos anticipados
|   |   +-- Depositos
|   +-- Egresos
|   |   +-- Compras (por proveedor, por producto, por presentacion)
|   |   +-- Vales
|   |   +-- Nomina (asistencia, pago, incidencia con retardos/faltas/incapacidades/permisos/vacaciones)
|   +-- Inventarios (22 sub-reportes — el modulo mas extenso)
|   |   +-- Costo y margen (por articulo, grupo, tipo grupo, resumen TD)
|   |   +-- Punto de reorden
|   |   +-- Reporte de existencias
|   |   +-- Cardex (movimientos + consolidado de salidas)
|   |   +-- Costo por articulo / subproducto / producto
|   |   +-- Productos a caducar
|   |   +-- Validacion de recetas
|   |   +-- Productos que (no) estan en recetas
|   |   +-- Reporte de recetas (recetas + subrecetas + productos)
|   |   +-- Estado de cuenta de inventario
|   |   +-- Ordenes de compra canceladas
|   |   +-- Consolidado de existencias (detalle, por sucursal, balance)
|   |   +-- Compras sugeridas
|   |   +-- Paleo de barra
|   |   +-- Variacion de costos
|   |   +-- Diferencias fisico vs sistema
|   |   +-- Costos de producto vs venta
|   |   +-- Inventario fisico vs sistema
|   |   +-- Ordenes de produccion por productor
|   +-- Integraciones
|   +-- Pantalla en cocina
|   +-- Control de acceso
|   +-- Estado de resultados (P&L mensual por ano)
|   +-- Sincronizacion
|   +-- Horas trabajadas
|   +-- Modulo de propinas (fondos + reporte)
|   +-- Auditoria (transferencia de platillos)
|   +-- Reporte de acciones en portal web
|
+-- Ingresos (operacion de dinero entrante)
|   +-- Cuentas por cobrar
|   +-- Pagos
|   +-- Control de Efectivo
|       +-- Flujo de efectivo
|       +-- Transferencia de efectivo (entre sucursales)
|       +-- Transferencias recibidas
|       +-- Depositos bancarios
|
+-- Egresos (operacion de dinero saliente)
|   +-- Facturas (con estados de cuenta, consolidado por subcuenta)
|   +-- Pagos
|   +-- Notas de credito
|   +-- Configuracion
|   |   +-- Proveedores
|   |   +-- Compradores
|   |   +-- Tipo de vales
|   +-- Nomina
|       +-- Dias de asueto
|       +-- Turnos (calendario + lista)
|       +-- Programacion semanal
|       +-- Pago de nomina
|
+-- Inventario (el modulo mas profundo)
|   +-- Entradas y salidas
|   |   +-- Con facturas
|   |   +-- Transferencias (recibidas, realizadas, hacer)
|   |   +-- Con codigo de barras
|   |   +-- Devoluciones
|   |   +-- Ajustes por lote
|   |   +-- Subproductos en proceso
|   |   +-- Carga masiva de inventario
|   |   +-- Salida masiva de inventario
|   |   +-- Ordenes de compra (recibidas, realizadas, hacer, por aprobar)
|   |   +-- Ventas de terceros (con CFDI)
|   |   +-- Tablajeria (configuracion + entradas con producto base)
|   |   +-- Orden de Produccion (productores, plantillas, ordenes)
|   +-- Auditoria
|   |   +-- Ajustes de inventario
|   |   +-- Inventario fisico vs sistema
|   |   +-- Reporte de existencias
|   |   +-- Productos pendientes de rebaja
|   +-- Control de inventarios
|   |   +-- Almacenes
|   |   +-- Salidas por area-almacen
|   |   +-- Salida de platillos por almacen
|   |   +-- Departamentos
|   |   +-- Unidades de medida
|   |   +-- Presentaciones
|   |   +-- Productos
|   |   +-- Punto de reorden
|   |   +-- Precios
|   |   +-- Areas
|   |   +-- Plantillas de inv. fisico vs sistema
|   |   +-- Plantillas de OC
|   |   +-- Config limites variacion costo por producto
|   +-- Produccion y costos
|       +-- Conversiones
|       +-- Recetas de platillos
|       +-- Recetas de subproductos
|       +-- Costos adicionales
|
+-- Facturacion (CFDI mexicano)
|   +-- Facturas
|   |   +-- Emitir
|   |   +-- Factura Global (con txt / sin txt)
|   |   +-- Facturas emitidas
|   |   +-- Factura Agrupada
|   |   +-- Clientes
|   |   +-- Reporte Conciliacion
|   +-- Notas de credito (emitir + emitidas)
|   +-- Complementos de pago (emitir + emitidos)
|
+-- Ecommerce (integraciones delivery)
|   +-- Operaciones
|   |   +-- Disponibilidad de platillos integraciones
|   |   +-- Estatus plataformas
|   |   +-- Estatus de menu integracion
|   |   +-- Estatus de ordenes (programadas + normales)
|   |   +-- Tiempo de preparacion
|   +-- Administracion
|       +-- Configuracion horario por integracion
|       +-- Configuracion grupos por marcas
|       +-- Configuracion de platillos / modificadores / grupos
|       +-- Cupones de descuento
|       +-- Reporte de ordenes integradas (con Top Offenders)
|
+-- Punto de venta (config del menu — NO es el POS real)
|   +-- Restaurante
|   |   +-- Forma de pago
|   |   +-- Tamanos
|   |   +-- Tipos de grupos
|   |   +-- Grupos
|   |   +-- Horarios para platillos
|   |   +-- Platillos (precios por tipo de orden)
|   |   +-- Modificadores (lista + asignacion + niveles + adicionales por tipo orden + copiar config)
|   |   +-- Promociones
|   |   +-- Domicilio (ubicaciones)
|   |   +-- Tarjetas de Regalo (admin + reporte)
|   +-- Tienda (mirror de restaurante para retail: forma pago, tipo precio, grupos, articulos, promos, tarjetas)
|
+-- Administracion
|   +-- Usuarios de punto de venta (con permisos)
|   +-- Perfil de usuario de punto de venta
|   +-- Usuarios de portal web (con permisos)
|   +-- Perfil de usuario portal web
|
+-- Encuesta
|   +-- Configuracion de encuesta
|   +-- Reporte (opcion multiple + calificacion)
|
+-- Configuracion
|   +-- Sucursal (timezone, regimen fiscal, horarios)
|   +-- Facturacion electronica (FE config, autofacturacion, series)
|   +-- Integraciones Ecommerce
|   +-- Cuentas contables
|   +-- Cuentas bancarias
|
+-- Facturas Wansoft (facturacion propia de Wansoft al cliente)
+-- Liberaciones (releases de software)
```

### Endpoints HTTP: 150+ unicos

Organizados por dominio funcional:
- **Reports** (38 endpoints): El grupo mas grande. Ventas consolidadas, por hora, grupo, area, platillo, mesero, tipo de orden, descuentos, personas, pagos, modificadores, terminales, propinas, promociones, anulaciones.
- **Inventory** (35 endpoints): Existencias, ajustes, transferencias, kardex, recetas, costos, produccion, reorden, subproductos.
- **Expense** (12 endpoints): Facturas, pagos, proveedores, compradores, vales, notas de credito.
- **Income** (12 endpoints): Cuentas por cobrar, pagos, efectivo, transferencias, depositos, anticipos.
- **FE/Facturacion** (11 endpoints): CFDI, facturas globales, notas de credito, complementos de pago, clientes, series, regimenes fiscales.
- **ECommerce** (12 endpoints): Integraciones, ordenes, disponibilidad, marcas, cupones, horarios.
- **Menu** (15 endpoints): Platillos, grupos, modificadores, areas, formas de pago, tamanos, tipos de orden.
- **Payroll** (6 endpoints): Turnos, programacion, nomina, puestos, dias de asueto.
- **Production** (5 endpoints): Ordenes de produccion, plantillas, conversiones, productores.
- **Admin** (8 endpoints): Usuarios POS/web, perfiles, releases, sucursales, bancos.
- **Attendance** (2 endpoints): Control de acceso, horas trabajadas.
- **Survey** (2 endpoints): Encuestas, reportes.
- **Statement** (3 endpoints): Estado de resultados, cuentas contables.

---

## 3. Modulo por modulo

---

### 3.1 PUNTO DE VENTA (POS)

**Que problema resuelve:**
Captura de ventas en el piso del restaurante. Mesa → pedido → comanda a cocina → cobro → ticket → propina → corte de caja.

**Por que existe:**
El restaurante sin POS usa papel y calculadora. Con POS, cada venta queda registrada, cada mesero tiene cuenta, y el dueno puede auditar.

**Que decisiones de negocio habilita:**
- Quien es mi mejor mesero (por ventas, por ticket promedio)
- Cual es mi hora pico (SalesByHours)
- Que platillos se venden mas y cuales cancelan (SalesBySaucer + CancelSalesDetail)
- Cuanto damos de descuento y cortesia (leakage analysis)
- Cuanto cobra cada terminal (SalesByTerminal)
- Mi cajero cuadro? (corte: esperado vs declarado)

**Edge cases que maneja:**
- Cancelar despues de preparar (merma) vs antes (revert inventario) vs anulacion (error operativo — 3 caminos)
- Pago mixto: parte efectivo, parte tarjeta, parte transferencia — N formas de pago por orden
- Dividir cuenta por silla (seat_id per item)
- Tiempos de platillos (course management: pending/fired/preparing/ready/served)
- Cambiar mesa con orden abierta
- Cortesias con PIN de gerente
- Propina como % de venta del mesero (modelo mexicano: mesero paga 5% de su venta al pool)
- Corte X (parcial), Turno, Z (cierre), Global, por Mesero — 5 tipos distintos

**Que copiamos:**
- Los 15 principios Gold Notes (ya implementados al 100% en Fullsite)
- Silla como entidad fuerte, tiempos de platillo, fire button
- Permisos ultra granulares por accion (269 lineas en Fullsite)
- Corte = fondo + ventas + depositos - retiros = esperado vs declarado
- "Se preparo?" al cancelar — vincula decision operativa con inventario

**Que mejoramos:**
- POS cloud-native con offline-first (Wansoft depende de SQL Server local que si muere, muere todo)
- Audit log SIEMPRE encendido (Wansoft tiene checkbox "Guardar logs" y AMALAY lo tenia APAGADO)
- Cobro digital nativo (Wansoft: "Tarjeta sin MP" con confirmacion de monto gigante)
- KDS real-time (Wansoft: comanda impresa, si se pierde se pierde)
- Auto-facturacion QR en ticket (Wansoft: manual por portal)
- IA sobre eventos: fraude, food cost, prediccion de cierre, upselling

**Que NUNCA implementamos:**
- Billar (Wansoft tiene modulo BillardSetting). Nicho muerto.
- "Megapoints" (programa de puntos legacy sin integracion real)
- Config de terminal local como fuente de verdad (config debe ser cloud, no archivo .ini)
- Happy Hour como toggle manual (deberia ser regla automatica por horario)

---

### 3.2 INVENTARIO

**Que problema resuelve:**
Saber que hay en el almacen, cuanto cuesta, y cuando hay que comprar mas.

**Por que existe:**
El food cost es el 35-45% del ingreso de un restaurante. Sin control de inventario, el dueno no sabe si esta ganando o perdiendo dinero hasta que revisa su cuenta de banco.

**Que decisiones de negocio habilita:**
- Mi food cost real es X% (CostDetail + CostBySaucer + CostByGroup)
- Necesito comprar Y antes de que se acabe (punto de reorden)
- Alguien esta robando? (inventario fisico vs sistema — diferencias)
- Mi proveedor subio el precio? (variacion de costos)
- Cuantos platillos puedo servir con lo que tengo? (existencia por platillo — calculo por ingrediente limitante)
- Cuanto desperdicio? (paleo de barra — peso de botellas abiertas vs consumo esperado)
- Los productos se van a caducar? (reporte de productos a caducar)

**Edge cases que maneja:**
- Productos con multiples presentaciones (botella, caja, pieza, litro, kilo)
- Conversiones entre unidades de medida
- Stock comprometido vs disponible (CantidadEnProduccion)
- Productos que no estan en ninguna receta (huerfanos)
- Validacion de recetas (receta existe pero esta mal configurada)
- Ajustes por lote (ajuste masivo de existencias)
- Carga/salida masiva de inventario (Excel bulk)
- Limites de variacion de costo por producto (alerta si el precio sube mas del X%)

**Que copiamos:**
- Almacenes multiples por sucursal (AMALAY: almacen cocina, almacen barra, almacen market)
- Departamentos como agrupador de productos
- Presentaciones separadas de unidades de medida (1 CAJA = 24 PIEZAS)
- Plantillas de OC (orden de compra pre-configurada por proveedor)
- Plantillas de conteo fisico (seleccionar que productos contar)
- Cardex (historial de movimientos por producto — trazabilidad completa)
- Paleo de barra (pesado de botellas abiertas — critico para bares)

**Que mejoramos:**
- Fullsite tiene modulo de compras completo (Wansoft NO tiene compras reales, solo OC internas entre sucursales)
- Recepcion con verificacion item por item y 6 motivos de discrepancia
- Merma como modulo dedicado con 7 motivos y costeo
- Conteo fisico digital con diferencias automaticas
- Deduccion automatica al enviar a cocina (Wansoft deduce al cobrar — el momento real es cuando el chef toma el ingrediente)
- Food cost como monitor en tiempo real con alertas (Wansoft: reporte Excel que nadie consulta)
- Alertas de reorden proactivas (Wansoft: tabla pasiva que nadie revisa)
- Matching inteligente con fuzzy (Wansoft: ID rigido — si cambia el proveedor, se rompe)

**Que NUNCA implementamos:**
- Inventario como config de terminal local. Debe ser cloud, periodo.
- Reportes de inventario como templates de impresion MR6. Es 2026.
- Costeo "ultimo precio de compra" sin historial. Necesitamos al menos promedio ponderado.
- El modulo de inventario de 23 KB. Es deuda tecnica disfrazada de minimalismo — Fullsite ya tiene 10x mas.

---

### 3.3 COMPRAS Y PROVEEDORES

**Que problema resuelve:**
Controlar que se compra, a quien, a que precio, y con que frecuencia.

**Por que existe:**
Porque el 35-45% del ingreso se va en insumos y NADIE lo controlaba. En 20 anos, Wansoft nunca construyo un modulo de compras real — lo que tiene son ordenes de compra INTERNAS (entre sucursales del mismo grupo) y un catalogo de proveedores decorativo.

**Que decisiones de negocio habilita (lo que Wansoft permite):**
- Cuanto compre por proveedor (ShopBySupplier)
- Cuanto compre por producto (ShopByProduct)
- Cuanto compre por presentacion (ShopByPresentation)
- Ordenes de compra pendientes de recibir (GetPurchaseOrdersPendingReceipt)
- Ordenes de compra por aprobar (flujo de aprobacion)
- Compras sugeridas (basado en punto de reorden — pasivo)
- Facturas pendientes de inventariar (GetPendingInvoiceToInventory)

**Lo que Wansoft NO resuelve (y es la oportunidad):**
- No hay ciclo: necesidad → OC a proveedor externo → recepcion → factura → pago
- No hay evaluacion de proveedores (cumplimiento, calidad, precio historico)
- No hay prediccion de compras ("manana necesitas 200 huevos")
- No hay negociacion basada en datos ("tu competidor cobra 15% menos")
- No hay compras grupales (multiples restaurantes Fullsite comprando juntos)

**Que copiamos:**
- Plantillas de OC por proveedor (probadas y utiles — AMALAY tiene plantillas como "JUGOS NL" con 12 items pre-cargados)
- Flujo de aprobacion de OC (gerente aprueba antes de enviar)
- Reporte de facturas pendientes de inventariar (vincular compra con inventario)

**Que mejoramos:**
- OC a proveedores EXTERNOS con envio directo (WhatsApp/email)
- Recepcion con captura de factura y matching automatico
- Historial de precios por ingrediente (detectar inflacion)
- Prediccion de compras con IA basada en ventas historicas + eventos
- Red de proveedores compartida entre restaurantes Fullsite

**Que NUNCA implementamos:**
- "Compradores" como entidad separada (Wansoft los tiene — es over-engineering para <500 restaurantes)
- Tipo de vales como modulo independiente (los vales son un gasto con categoria, no un modulo)

---

### 3.4 PRODUCCION

**Que problema resuelve:**
Batch cooking. Salsas, panes, bases, postres — se preparan ANTES de que se venda el platillo. Sin este proceso, el inventario de ingredientes no refleja la realidad.

**Por que existe:**
Porque un restaurante con panaderia, pasteleria, o cocina de preparacion necesita "ordenar" produccion interna: "produce 20 croissants usando 5 kg harina, 2 kg mantequilla, etc." El inventario baja los ingredientes y sube los productos terminados.

**Que decisiones de negocio habilita:**
- Cuanto produce cada productor (reportes por productor)
- El rendimiento de la produccion cuadra? (entrada de MP vs salida de producto terminado)
- La tablajeria da el yield esperado? (peso de la res vs cortes resultantes)

**Edge cases que maneja:**
- Produccion tiene su propio concepto de "orden" con status (no es un ajuste de inventario)
- Productores como entidad (persona responsable de producir)
- Plantillas de produccion (ordenes recurrentes pre-configuradas)
- Tipos de orden de produccion (panaderia vs cocina vs preparaciones)
- Tablajeria: un producto base (res) entra, multiples subproductos salen (cortes)
- Subproductos en proceso (producto intermedio: masa madre, fondo de pollo)
- Costos adicionales por platillo (gas, mano de obra, depreciacion)
- Conversiones entre unidades (kg → litro, pieza → porcion)

**Que copiamos:**
- Produccion como entidad de primera clase (no un hack de inventario)
- Plantillas de produccion recurrentes
- Subproductos (producto intermedio reutilizable en multiples recetas)
- Costos adicionales (concepto — no solo ingredientes)

**Que mejoramos:**
- Produccion triggered por prediccion de demanda ("manana es sabado, produce 40 croissants en vez de 20")
- Yield tracking automatico (ingreso de producto base vs salida real, con diferencia como merma)
- Integracion con OC: si la produccion consume el ultimo kilo de harina, genera OC automatica

**Que NUNCA implementamos:**
- Tablajeria como modulo separado. Es un caso particular de produccion (entrada → multiples salidas).
- "Productores" como entidad independiente del staff. El productor es un empleado con rol.

---

### 3.5 RECURSOS HUMANOS Y NOMINA

**Que problema resuelve:**
Control de asistencia, turnos, incidencias, y pago de nomina del personal.

**Por que existe:**
Porque un restaurante tiene 15-40 empleados con alta rotacion (3-6 meses promedio), turnos variables, propinas que distribuir, y la LFT mexicana que cumplir.

**Que decisiones de negocio habilita:**
- Quien llego tarde? Quien falto? (control de acceso + incidencias: retardos/faltas/incapacidades/permisos/vacaciones)
- Cuantas horas trabajo cada persona? (horas trabajadas por usuario)
- Cuanto le debo a cada empleado? (pago de nomina con detalle)
- Como programo la semana? (programacion semanal por puesto + turno)
- Dias de asueto me afectan? (calendario de asueto)

**Edge cases que maneja:**
- Turnos con calendario (shift calendar — asignacion por dia/semana)
- Puestos/jobs como base de permisos y programacion
- Huella digital para control de acceso (check-in/check-out)
- Incidencias con 5 tipos: retardos, faltas, incapacidades, permisos, vacaciones
- Propinas como modulo separado con fondo y distribucion

**Que copiamos:**
- Control de acceso basico (check-in/check-out por empleado)
- Programacion semanal por puesto
- Modulo de propinas (fondo + distribucion)
- Nada mas. El resto es territorio de nomina especializada.

**Que mejoramos:**
- Check-in por app movil con geolocalizacion (no huella digital — AMALAY tiene problema de huella, es blocker real)
- Programacion optimizada por IA basada en ventas historicas por dia/hora
- Prediccion de necesidad de personal ("el sabado necesitas 2 meseros extra")

**Que NUNCA implementamos:**
- Nomina completa (calculo IMSS, ISR, timbrado de recibos). Es dominio de Nomipaq/CONTPAQi. Integracion, no reinvencion.
- Huella digital como requisito. Es hardware legacy con problemas de lectura. PIN + app es el futuro.
- Incapacidades y vacaciones como calculo propio. Eso es HRIS, no POS.

---

### 3.6 FACTURACION ELECTRONICA (CFDI)

**Que problema resuelve:**
Cumplir con la obligacion fiscal mexicana: emitir CFDI 4.0 por cada venta que el cliente solicite, emitir factura global por ventas sin factura, y gestionar notas de credito y complementos de pago.

**Por que existe:**
Porque el SAT lo exige. No es opcional. Un restaurante que no factura pierde clientes corporativos (que representan 20-40% del ingreso en zonas de oficinas).

**Que decisiones de negocio habilita:**
- Conciliacion ventas vs facturas (Reporte Conciliacion — cuanto vendi vs cuanto facture)
- Cuanto debo de factura global este mes? (con txt / sin txt)
- Facturas emitidas por periodo (control fiscal)
- Solicitudes de cancelacion pendientes
- Complementos de pago por cobrar

**Edge cases que maneja:**
- Factura global con txt de SAT (lote de ventas al publico general)
- Factura global sin txt (agrupacion manual)
- Factura agrupada (multiples ventas en una sola factura para un cliente)
- Series por sucursal (AA, AB, AC...)
- Regimenes fiscales multiples
- Notas de credito con CFDI reason codes (4 motivos de cancelacion SAT)
- Complementos de pago (PPD — pago en parcialidades)
- Clientes con datos fiscales pre-cargados (RFC, razon social, CP, regimen)

**Que copiamos:**
- Flujo de factura individual: venta → datos fiscales → emision
- Factura global como proceso periodico
- Clientes FE como catalogo separado
- Series por sucursal

**Que mejoramos:**
- Auto-facturacion por QR en ticket (Wansoft: el cliente llama o va al portal)
- Timbrado automatico sin intervencion humana (Wansoft: alguien tiene que ir al portal y dar click)
- Deteccion automatica de ventas sin facturar
- Integracion directa con Facturama API ($215/mes por 430 CFDI)

**Que NUNCA implementamos:**
- Complementos de pago como modulo propio. Eso es contabilidad (CONTPAQi territory).
- Regimenes fiscales como configuracion editable (son catalogo SAT fijo, no necesitan CRUD).

---

### 3.7 REPORTES

**Que problema resuelve:**
Convertir datos operativos en informacion para tomar decisiones.

**Por que existe:**
Porque el dueno, el gerente, el contador, y el socio necesitan respuestas diferentes de los mismos datos. El dueno quiere "cuanto gane esta semana." El contador quiere "desglose por forma de pago con IVA." El gerente quiere "quien cancelo mas platillos."

**Que decisiones de negocio habilita:**

El portal de Wansoft tiene la coleccion de reportes restauranteros mas completa que existe en Mexico:

**Ventas (19 reportes):**
- Consolidado, por hora, por dia, por dia de la semana, por grupo, por tipo de grupo, por area, por platillo, por mesero, por tipo de orden, por forma de pago, por modificador, por terminal, por promocion
- Descuentos detalle, cortesias detalle, cancelaciones detalle, anulaciones detalle
- Personas por hora/dia/dia de la semana (ocupacion)

**Inventario (22 reportes):**
- Costo y margen (el reporte mas importante — por articulo, grupo, tipo)
- Existencias, punto de reorden, cardex, variacion de costos
- Recetas, validacion de recetas, productos huerfanos
- Consolidado multi-sucursal, estado de cuenta
- Fisico vs sistema, diferencias, paleo de barra, productos a caducar, compras sugeridas, produccion por productor

**Financieros:**
- Estado de resultados (P&L mensual por ano — ingresos/egresos/utilidad)
- Depositos (lista, por cajero, por fecha)
- Vales (detalle, por usuario, por fecha)
- Cobranza (cuentas por cobrar con status)
- Retiros de efectivo

**Operativos:**
- Control de acceso + horas trabajadas
- Propinas (fondo + detalle por mesero)
- Pantalla en cocina (KDS status)
- Auditoria (transferencia de platillos entre mesas)
- Acciones en portal web (quien hizo que)
- Sincronizacion (status de sync)

**Que copiamos:**
- La GRANULARIDAD. Wansoft entendio que el mismo dato se necesita cortado de 15 maneras diferentes.
- "Reporte para Contador" como hoja separada en el Excel de ventas. Brillante — el dueno y el contador ven datos diferentes del mismo periodo.
- Personas por hora (ocupacion). Nadie mas tiene esto.
- Paleo de barra (pesado de botellas). Nicho pero invaluable para bares.
- Costo y margen con 4 vistas (articulo, grupo, tipo, resumen TD).

**Que mejoramos:**
- TODOS los reportes son dashboards interactivos, no Excel que descargas y abres.
- Alertas proactivas: no esperar a que alguien abra el reporte — la anomalia va al gerente por WhatsApp.
- Comparativas automaticas: "esta semana vs misma semana del ano pasado."
- IA narrativa: "Tus ventas bajaron 12% el martes porque llovio — pero las bebidas calientes subieron 30%, considera ajustar la oferta."
- Real-time: no esperar sincronizacion. El dato esta en el dashboard cuando sucede.

**Que NUNCA implementamos:**
- "Proyeccion de ventas" como reporte estatico. La prediccion tiene que ser IA, no extrapolacion lineal.
- Sincronizacion como concepto visible al usuario. Los datos simplemente estan ahi.
- MR6 templates de impresion para reportes. Es 2026.

---

### 3.8 ECOMMERCE (Integraciones Delivery)

**Que problema resuelve:**
Recibir ordenes de Rappi, UberEats, y otros agregadores directamente en el POS, sin re-captura manual.

**Por que existe:**
Porque delivery representa 15-30% del ingreso de un restaurante urbano, y sin integracion el restaurante tiene una tablet por cada plataforma, re-captura manual, y errores constantes.

**Que decisiones de negocio habilita:**
- Que platillos estan disponibles por plataforma (disponibilidad por integracion)
- Cuales ordenes fallaron y por que (Top Offenders — el reporte mas valioso del modulo)
- Cual plataforma genera mas ingreso? (ordenes integradas por servicio)
- El tiempo de preparacion es adecuado? (por marca/integracion)
- Estatus de las ordenes en tiempo real

**Edge cases que maneja:**
- Marcas virtuales (un restaurante opera como 3 marcas diferentes en apps: "AMALAY", "La Nonna Keto", "Bakery Shop")
- Horarios por integracion (diferente horario para Rappi vs UberEats)
- Menus distintos por plataforma (disponibilidad selectiva de platillos)
- Ordenes programadas (para recoger a las 3pm)
- Cupones de descuento por plataforma
- Modificadores separados para ecommerce vs presencial

**Que copiamos:**
- Concepto de marcas virtuales (Brand entity)
- Disponibilidad de platillos por plataforma
- Top Offenders report (platillos que mas fallan en delivery)

**Que mejoramos:**
- Integracion directa con API de UberEats (Wansoft usa middleware propietario)
- Disponibilidad automatica basada en existencias reales (si no hay aguacate, los bowls se desactivan solos)
- Prediccion de demanda por plataforma (ajustar preparacion pre-peak)
- Unified inbox: todas las ordenes de todas las plataformas en una sola pantalla POS

**Que NUNCA implementamos:**
- Middleware propietario para integraciones. APIs directas.
- "Configuracion de grupos por marcas" como proceso manual. Debe ser automatico basado en el menu.

---

### 3.9 CRM / LEALTAD / ENCUESTAS

**Que problema resuelve:**
Conocer al cliente, medir su satisfaccion, y generar repeticion de visita.

**Por que existe:**
Porque adquirir un cliente nuevo cuesta 5-7x mas que retener uno existente, y un restaurante tipico no sabe ni cuantos clientes unicos tiene.

**Lo que Wansoft tiene (poco):**
- Tarjetas de regalo (preloaded cards): tipos, status, administracion, reporte
- Encuestas: configuracion + reporte (opcion multiple + calificacion)
- Clientes FE (catalogo de clientes para facturacion, NO para CRM)
- MegaPoints (programa de puntos — legacy, casi nadie lo usa)

**Lo que Wansoft NO tiene:**
- CRM real (historial de visitas, preferencias, frecuencia)
- Marketing automatizado (email/WhatsApp post-visita)
- Segmentacion de clientes
- Net Promoter Score
- Resenas integradas (Google Maps, TripAdvisor)

**Que copiamos:**
- Tarjetas de regalo como concepto (util para temporadas)
- Encuestas post-visita (el QR en ticket ya lo tenemos)

**Que mejoramos:**
- CRM automatico: cada cliente que factura ya tiene datos. Cada reservacion tiene nombre/telefono. Cada WhatsApp es un lead.
- 12,200 clientes de Reservy ya importados a Supabase
- Bot WhatsApp que contesta consultas 24/7
- Segmentacion IA: "clientes que vienen los martes pero no han venido en 3 semanas"
- Prediccion de churn: "este cliente regular no ha venido en 14 dias — mandale un 15% de descuento"

**Que NUNCA implementamos:**
- MegaPoints. Los programas de puntos genericos no generan lealtad real.
- Tarjetas fisicas. Todo digital.
- Encuestas de 15 preguntas. Una sola pregunta: "Lo recomendarias?"

---

### 3.10 CONFIGURACION Y ADMINISTRACION

**Que problema resuelve:**
Setup inicial y mantenimiento del sistema: sucursales, usuarios, permisos, cuentas contables, cuentas bancarias, integraciones.

**Por que existe:**
Porque cada restaurante es diferente: horarios, zonas horarias, regimenes fiscales, formas de pago aceptadas, roles del staff, y como se conecta con el contador.

**Que decisiones de negocio habilita:**
- Quien puede cancelar? Quien puede dar descuento? (permisos granulares)
- Cuantas sucursales tengo? (multi-tenant)
- Como se mapean mis ventas a las cuentas del contador? (cuentas contables)
- A que banco depositar? (cuentas bancarias)

**Edge cases que maneja:**
- Permisos POS separados de permisos web (dos sistemas de permisos independientes)
- Perfiles como plantillas de permisos (no asignar permiso por permiso a cada usuario)
- Horarios de sucursal (afectan cortes, reportes, y operacion)
- Timezone configurable (Mexico tiene 4 zonas horarias)
- Facturacion electronica como seccion de configuracion separada (series, autofacturacion, regimen)
- Liberaciones de software como modulo visible al cliente

**Que copiamos:**
- Permisos granulares por accion (ya tenemos 269 lineas)
- Perfiles como plantillas de permisos
- Sucursal como unidad operativa con sus propios horarios y config

**Que mejoramos:**
- Setup en <30 minutos (Wansoft: dias de instalacion)
- Multi-tenant nativo desde el dia 1 (Wansoft: SQL Server local por sucursal)
- Permisos via app movil, no via desktop remoto
- Self-service para cambios de menu y precios (Wansoft: necesitas ir al portal web)

**Que NUNCA implementamos:**
- "Liberaciones" como modulo visible. Las actualizaciones son automaticas y silenciosas.
- Cuentas contables como CRUD manual. Integracion con CONTPAQi, no duplicacion.
- "Facturas Wansoft" (facturacion del vendor al cliente). No somos Wansoft.

---

## 4. El conocimiento oscuro

Cosas que solo descubres operando un restaurante por 20 anos. No estan en ningun manual. Las aprendimos del analisis de 822 stored procedures, 80+ tablas, y las capturas reales de AMALAY.

### El conteo real de personas es oro

Wansoft tiene `PersonsByHour`, `PersonsByDay`, `PersonsByDayName`. Tres reportes dedicados SOLO a contar personas. No ventas — PERSONAS. Porque:
- El ticket promedio sin personas es un numero sin significado ("vendi $50K" — con cuantas personas?)
- La ocupacion por hora determina cuantos meseros necesitas
- La ocupacion por dia de la semana determina cuanto preparar
- "Personas por nombre de dia" (lunes, martes...) es diferente de "personas por fecha" — uno da patrones, otro da datos puntuales

**Fullsite learning:** Nuestro `personas_restaurant` en `wansoft_daily` es insuficiente. Necesitamos personas por hora.

### El corte de caja tiene 5 sabores

No es "cerrar el dia." Es:
- **Corte X**: parcial, sin cerrar. Para saber como vas a media jornada.
- **Corte de Turno**: cierra el turno del cajero actual. El siguiente empieza con fondo nuevo.
- **Corte Z**: cierra el dia fiscal. Numera consecutivamente. Es el que revisa Hacienda.
- **Corte Global**: consolida todas las terminales de la sucursal.
- **Corte por Mesero**: cuanto vendio cada mesero en el turno.

**Fullsite learning:** Tenemos corte de turno. Nos falta corte X (parcial sin cerrar) y la numeracion consecutiva del Z.

### La separacion Restaurante / Tienda es real

Wansoft tiene dos subsistemas completos: POS Restaurante y POS Tienda. No es capricho — un lugar como AMALAY tiene AMBOS: el cafe/restaurante con mesas, meseros, y tiempos de platillo, Y el market con estantes, codigo de barras, y venta directa sin mesa.

Los dos comparten inventario pero tienen flujos completamente diferentes:
- Restaurante: mesa → pedido → comanda → preparar → servir → cobrar
- Tienda: cliente llega → escanea → cobra → bolsa

**Fullsite learning:** Ya tenemos esto. El POS tiene modo restaurante y modo market. Pero los reportes necesitan separar ambos (ya lo hacemos en `wansoft_daily` excluyendo Market/Delivery del ticket promedio).

### Las devoluciones a proveedor son masivas

`GetDevolutionPendingToInventory`, `GetDevolutions` — Wansoft tiene un flujo completo de devoluciones. Porque:
- El proveedor trajo fresas golpeadas
- El pedido llego con 2 cajas menos
- La calidad del producto no es la esperada

Cada devolucion revierte el inventario y genera una nota de credito.

**Fullsite learning:** Tenemos recepcion con 6 motivos de discrepancia, pero no tenemos devolucion POSTERIOR a la recepcion. Es un caso real que necesitamos.

### El "paleo de barra" es genial

Pesar las botellas abiertas, comparar con el consumo esperado, y detectar la diferencia. Si la botella de tequila pesa 200g menos de lo esperado, alguien sirvio de mas (o se sirvio).

Wansoft tiene esto como `AjusteDeDiferenciasBascula`. Es especifico de bares/antros, pero para restaurantes con barra (AMALAY tiene) es la unica forma de controlar el licor abierto.

**Fullsite learning:** No lo tenemos. Es post-500 restaurantes, pero es un diferenciador claro para bares.

### Las transferencias entre sucursales son un mini-ERP

760 referencias en los stored procedures. Transferir producto de una sucursal a otra es un proceso de:
1. Crear transferencia (origen → destino)
2. Seleccionar productos y cantidades
3. Enviar (baja de inventario en origen)
4. Recibir (alta de inventario en destino, con posible discrepancia)
5. Asociar factura (si hay facturacion interna)
6. Opcionalmente: factura electronica entre sucursales

Es tan critico que tiene su propia seccion de transferencias de EFECTIVO separada.

**Fullsite learning:** No tenemos transferencias. Es pre-requisito para cadenas (>5 sucursales). Prioridad antes de 500 restaurantes.

### El estado de resultados lo construye el sistema

`GetIncomeStatemetByMonthInYear` — Wansoft calcula un P&L mensual automatico basado en:
- Ingresos: ventas netas (brutas - descuentos - cancelaciones - cortesias)
- Egresos: compras + nomina + vales + facturas registradas
- Costo: deduccion de inventario por recetas
- Utilidad: ingresos - egresos - costo

Esto es ORO para el dueno. La mayoria no tiene idea de cuanto ganan realmente hasta que el contador entrega el estado financiero 2 meses despues.

**Fullsite learning:** Nuestro dashboard tiene ventas y costos, pero no tenemos un P&L automatico. Es modulo de alto valor, baja complejidad (los datos ya existen).

---

## 5. Adopcion real de modulos

Basado en el analisis de AMALAY (operacion real) y la estructura del portal:

### Todos usan (100% de clientes Wansoft)

| Modulo | Por que es universal |
|---|---|
| POS Restaurante | Es la razon por la que compraron Wansoft |
| Cortes de caja | Sin corte no cuadras. Obligatorio. |
| Reportes de ventas | El dueno quiere saber cuanto vendio |
| Facturacion CFDI | Obligacion fiscal. Sin esto, pierdes clientes corporativos |
| Usuarios y permisos | Sin permisos, cualquiera cancela y da descuento |

### Muchos usan (60-80%)

| Modulo | Por que |
|---|---|
| Control de acceso (check-in) | Saber quien llego y a que hora |
| Propinas | Distribucion de propinas es drama constante sin sistema |
| Formas de pago custom | Cada restaurante acepta cosas diferentes |
| Descuentos y cortesias | Parte del negocio — pero hay que auditarlas |
| Ecommerce / integraciones | Rappi/UberEats = 15-30% del ingreso |

### Algunos usan (20-40%)

| Modulo | Por que algunos si y otros no |
|---|---|
| Inventario completo | Requiere disciplina de captura. Muchos compran y no registran |
| Recetas / food cost | Requiere que las recetas esten correctas. La mayoria no las tiene |
| Produccion | Solo restaurantes con panaderia/pasteleria/cocina central |
| Punto de reorden | Solo funciona si el inventario esta al dia (circular) |
| Nomina | Muchos usan nomina externa (CONTPAQi, ADP) |
| POS Tienda | Solo negocios hibridos (restaurante + market) |

### Casi nadie usa (<10%)

| Modulo | Por que no |
|---|---|
| Tarjetas de regalo | Requiere producir tarjetas fisicas. Costo alto, adopcion baja |
| Encuestas | Configuracion compleja para resultado poco accionable |
| MegaPoints | Programa de puntos generico sin valor diferencial |
| Billar (BillardSetting) | Nicho muerto |
| Tablajeria | Solo carniceros/pescaderias con venta integrada |
| Paleo de barra | Solo bares serios con control de licor |
| Ventas de terceros | Concepto confuso, pocos lo entienden |
| Pagos anticipados | Solo para eventos y banquetes |
| Cuentas contables como CRUD | El contador lo hace en su propio sistema |

---

## 6. Matriz de comparacion

| Modulo | Wansoft | Fullsite | Ventaja Fullsite |
|---|---|---|---|
| **POS Restaurante** | Completo, 20 anos de madurez. .NET local, offline robusto | Completo, cloud-native, offline-first con sync. 15/15 Gold Notes implementados | **Touch-first, IA sobre eventos, audit siempre on, auto-facturacion QR** |
| **POS Tienda/Market** | Subsistema separado con articulos, barcode, precios | Modo dual (restaurante + market) en el mismo POS | **Un solo sistema, no dos** |
| **Cortes de caja** | 5 tipos (X/Turno/Z/Global/Mesero). Probado 20 anos | Corte de turno completo, formato Wansoft | **Mismo formato + digital (no solo impreso)** |
| **Inventario** | 23 KB de codigo. Basico pero funcional. Costeo ultimo precio | 10x mas funcionalidad. Merma, compras, recepcion, conteo digital | **Control real del 35-45% del gasto. Wansoft casi no tiene** |
| **Compras / Proveedores** | Solo OC internas + catalogo decorativo de proveedores | OC a proveedores externos, recepcion con 6 motivos, matching inteligente | **Wansoft NO tiene compras reales. Fullsite si** |
| **Recetas / Food Cost** | Ingrediente-cantidad-unidad. Sin rendimiento. Sin sub-recetas | Recetas completas + elaboracion + alergenos + tiempos. Monitor real-time | **Food cost en tiempo real vs Excel que nadie abre** |
| **Produccion** | 26 SPs. Batch cooking, subproductos, ordenes, plantillas | Pendiente (pre-500 restaurantes) | **Wansoft gana aqui. Es su modulo mas profundo** |
| **Facturacion CFDI** | Completo: individual, global, agrupada, NC, complementos | Auto-facturacion QR + Facturama API | **Self-service para el comensal. Wansoft: alguien va al portal** |
| **Reportes** | 60+ reportes, Excel export, MR6 print templates | 17 dashboards interactivos + 30 agentes IA + alertas WhatsApp | **Real-time + proactivo + narrativa IA** |
| **Ecommerce** | Integracion propietaria con Rappi/UberEats. Marcas virtuales | Integracion directa API. Disponibilidad por existencias | **Sin middleware. Stock-aware. Prediccion de demanda** |
| **HR / Nomina** | Turnos, asistencia, incidencias, programacion, pago de nomina | Control de acceso basico. Programacion IA | **Wansoft tiene mas features. Pero nomina real es CONTPAQi** |
| **CRM / Lealtad** | Tarjetas regalo + encuestas + MegaPoints (legacy) | 12.2K clientes CRM, bot WhatsApp, segmentacion IA | **CRM real vs catalogo de tarjetas fisicas** |
| **Transferencias** | 760 refs. Flujo completo envio/recepcion entre sucursales | No existe todavia | **Wansoft gana. Necesario pre-500 restaurantes** |
| **Control de efectivo** | Retiros, depositos, transferencias de efectivo, depositos bancarios | Retiros y depositos con PIN gerente | **Funcionalidad similar. Fullsite mas simple** |
| **Estado de resultados** | P&L mensual automatico por ano | Dashboard de ventas/costos pero no P&L integrado | **Wansoft gana en consolidacion contable** |
| **Administracion** | Usuarios POS + web, perfiles, permisos granulares | Auth Supabase, permisos granulares (269 lineas) | **Setup en <30min vs dias de instalacion** |
| **Encuestas** | Config + reporte (opcion multiple + calificacion) | QR en ticket → reporte (simple y efectivo) | **Friccion cero vs configuracion compleja** |
| **Configuracion** | Sucursal, FE, cuentas, bancos, integraciones | Multi-tenant nativo, cloud config | **Zero install. Self-service.** |

### Score global

- **Wansoft gana claramente en:** Produccion, transferencias entre sucursales, P&L automatico, nomina
- **Empate funcional:** POS core, cortes, facturacion, permisos
- **Fullsite gana claramente en:** Inventario/compras/food cost, reportes/IA, CRM, ecommerce, velocidad de setup, mobile, real-time

---

## 7. Las 10 decisiones de diseno que definen a Fullsite

Basadas en todo lo aprendido de Wansoft. Estas no son features — son PRINCIPIOS.

### 1. La receta es la unidad atomica, no el platillo

Todo gira alrededor de la receta: que ingredientes necesito, cuanto cuestan, cuanto tardo en preparar, cuanto pierdo en el proceso, cuantas porciones puedo servir. El platillo del menu es la cara visible. Debajo esta la receta → ingredientes → proveedores → costos. Wansoft modelo platillos. Fullsite modela recetas.

### 2. Deduccion al ENVIAR a cocina, no al cobrar

El consumo real es cuando el chef toma el ingrediente. No cuando el cajero cobra. Wansoft deduce al cobrar. Eso significa que durante toda la preparacion el inventario miente. Fullsite deduce cuando se manda la comanda.

### 3. Compras como ciudadano de primera clase

El 35-45% del ingreso se va en insumos. Wansoft nunca construyo un modulo de compras real en 20 anos. Fullsite tiene el ciclo completo: receta → ingrediente → proveedor → OC → recepcion → stock → costo → food cost → alerta si el margen baja.

### 4. La terminal es desechable, los datos son eternos

Wansoft: si la terminal muere, llamas a soporte para el restore. Fullsite: tiras la terminal, abres Chrome en cualquier dispositivo, y sigues operando. Offline-first con sync automatico.

### 5. Alertas proactivas, no reportes pasivos

Wansoft: el dueno tiene que abrir el portal, navegar a Reportes → Inventarios → Punto de reorden, y ver si algo esta bajo. Fullsite: "Daniel, se te esta acabando la leche de almendra. Tu proveedor Alpura la entrega en 24h. Quieres que genere la OC?"

### 6. Audit siempre encendido, no checkbox opcional

AMALAY tenia "Guardar logs de acciones" APAGADO en Wansoft. Eso significa que no habia registro de quien cancelo que, quien dio descuento, quien hizo cortesia. Fullsite audita TODO, siempre, sin opcion de apagar. Eduardo (gerente) lo requiere. Es anti-fraude.

### 7. Setup en <30 minutos, no en dias

La instalacion de Wansoft requiere: instalar SQL Server, configurar Netsilver, configurar el portal, importar el menu, configurar impresoras, entrenar al staff. Dias. Fullsite: abres Chrome, escaneas tu menu, la IA importa productos y recetas, y empiezas a vender.

### 8. IA como ventaja estructural, no como feature

Wansoft tiene 60+ reportes. Fullsite tiene 30 agentes IA que analizan esos mismos datos y ACTUAN: prediccion de cierre, deteccion de fraude, optimizacion de menu, prediccion de compras, scheduling de staff. Los reportes son la materia prima. La IA es el producto.

### 9. Una sola app para todo, no POS + portal + app + widget

Wansoft tiene el POS local (Netsilver/.NET), el portal web (ASP.NET MVC), y nada movil. Tres experiencias diferentes, tres logins, datos que tardan en sincronizar. Fullsite: una PWA que funciona como POS en la terminal, como dashboard en la laptop del dueno, y como app en el telefono del gerente.

### 10. El moat es la red, no el producto

Un restaurante con Wansoft esta solo. Un restaurante con Fullsite esta conectado a una red de 100+ restaurantes: benchmarks anonimos ("tu food cost de 38% esta 5 puntos arriba del promedio de tu categoria"), compras grupales ("20 restaurantes Fullsite compran pollo juntos y negocian 12% menos"), y predicciones cruzadas ("los restaurantes de tu zona estan viendo 20% mas trafico este viernes — prepara mas").

Eso es imposible de replicar. Y es imposible de construir sin la escala. Wansoft tiene los clientes pero no tiene los datos centralizados. Fullsite tiene los datos centralizados desde el dia 1.

---

> Este documento es permanente y vivo.
> Cada leccion fue extraida de 211 pantallas del portal,
> 150+ endpoints HTTP, 97 reportes Excel,
> 822 stored procedures, 80+ tablas,
> 47 templates de impresion, 615 recetas,
> 3000 productos, 202 proveedores,
> y la operacion real de AMALAY Coffee & Market.
>
> No copiamos. Aprendimos. Y ahora construimos algo mejor.
