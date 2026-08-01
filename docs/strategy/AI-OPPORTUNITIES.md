# Oportunidades de IA -- Lo que Fullsite puede hacer y Wansoft jamas podra

Documento estrategico. Ultima actualizacion: 2026-07-04

Fullsite es cloud-native (Next.js + Supabase), tiene 30 agentes IA activos, y procesa datos en tiempo real.
Wansoft es .NET 4.5 de 2007, SQL Server local, sin IA, sin real-time, sin APIs modernas.

Este documento mapea las oportunidades de IA por cada modulo de Wansoft,
con ejemplos concretos, datos requeridos, y factibilidad.

---

## Indice

1. [Punto de Venta (POS)](#1-punto-de-venta-pos)
2. [Inventario](#2-inventario)
3. [Compras y Proveedores](#3-compras-y-proveedores)
4. [Produccion](#4-produccion)
5. [Recursos Humanos](#5-recursos-humanos)
6. [Facturacion Electronica](#6-facturacion-electronica)
7. [Reportes](#7-reportes)
8. [Ecommerce / Delivery](#8-ecommerce--delivery)
9. [CRM y Lealtad](#9-crm-y-lealtad)
10. [Configuracion y Administracion](#10-configuracion-y-administracion)
11. [El Copiloto de Datos](#11-el-copiloto-de-datos)
12. [El Efecto de Red](#12-el-efecto-de-red)

---

## 1. Punto de Venta (POS)

**Lo que Wansoft hace:** Captura de ventas en terminal .NET local con comandas impresas, cortes de caja, y permisos por usuario.

**Lo que Wansoft nunca podra hacer:** Analizar patrones en tiempo real. Su arquitectura es SQL Server local que sincroniza al portal cada X horas. No tiene capacidad de procesamiento en tiempo real, no puede correr modelos, y no puede actuar sobre lo que detecta.

**Oportunidades de IA para Fullsite:**

---

### 1.1 Detector de Fraude en Tiempo Real

- **Que hace**: Analiza cada cancelacion, descuento, cortesia y anulacion en el momento que ocurre. Compara contra el patron historico del mesero, la hora, el platillo, y el monto. Si detecta una anomalia, alerta al gerente por WhatsApp inmediatamente.
- **Datos requeridos**: Event store de ordenes (ya lo tenemos -- append-only desde 2026-06-12), historial de cancelaciones por mesero, permisos usados. Todo disponible.
- **Ejemplo de output**:
  ```
  ALERTA FRAUDE | 14:32
  Mesero: Oscar Rios
  Accion: Cancelacion de Salmon Bagel ($360) + Cortesia de Croissant Breakfast ($280)
  En los ultimos 45 min, 3 cancelaciones del mismo mesero.
  Patron historico: 0.8 cancelaciones/turno.
  Probabilidad de anomalia: 94%
  Accion sugerida: Verificar con supervisor de piso.
  ```
- **Impacto**: Risk-- (fraude interno es 3-5% de ventas en restaurantes mexicanos = $15K-25K/mes en AMALAY)
- **Factibilidad**: Puede construirse ahora. El agente `antifraud_agent.py` ya existe y corre semanalmente -- solo falta hacerlo real-time con el event store.
- **Wansoft podria hacerlo?** No. AMALAY tenia "Guardar logs de acciones" APAGADO. Incluso si lo prendieran, los datos viven en SQL Server local sin capacidad de analisis. No hay pipeline de eventos, no hay modelo, no hay canal de alerta.

---

### 1.2 Predictor de Cierre

- **Que hace**: A las 2pm, 4pm y 6pm analiza las ventas acumuladas del dia, las compara con el mismo dia de la semana en semanas anteriores, y predice el cierre del dia con intervalo de confianza.
- **Datos requeridos**: `wansoft_daily` (887 dias de historico ya cargados), `wansoft_kpis` (ventas en tiempo real). Todo disponible.
- **Ejemplo de output**:
  ```
  PREDICCION DE CIERRE | Viernes 4 Jul | 4:00 PM
  Ventas actuales: $38,420
  Prediccion cierre: $67,800 - $74,200
  vs viernes promedio: $71,500
  Status: EN LINEA (+2% sobre promedio a esta hora)
  Si el ritmo se mantiene, hoy superas el target.
  ```
- **Impacto**: Revenue++ (permite ajustar preparacion, staffing, y promociones en tiempo real)
- **Factibilidad**: Ya construido. `close_predictor.py` corre 3 veces al dia via GitHub Actions.
- **Wansoft podria hacerlo?** No. No tiene datos en tiempo real (depende de sincronizacion), no tiene modelo predictivo, y no tiene canal de comunicacion proactivo.

---

### 1.3 Motor de Upselling por Mesero

- **Que hace**: Analiza el ticket promedio de cada mesero vs el promedio del equipo, identifica en que categorias vende menos (bebidas, postres, extras), y sugiere frases de venta especificas para cada mesero.
- **Datos requeridos**: Ventas por mesero desglosadas por categoria (`wansoft_daily.meseros` + `ventas_por_grupo`). Disponible.
- **Ejemplo de output**:
  ```
  COACHING DE VENTA | Omar Aguilera
  Tu ticket promedio: $285 (equipo: $340)
  Gap principal: BEBIDAS OH (-$42 vs promedio)
  
  Sugerencia: "Omar, hoy al tomar la orden de comida, 
  pregunta: Ya vieron nuestra carta de vinos por copa? 
  Tenemos un rosado de Laus que va perfecto con los bowls."
  
  Si subes $40 por mesa, generas $1,200 extra hoy (30 mesas).
  ```
- **Impacto**: Revenue++ ($1,200/dia x 300 dias = $360K/ano potencial)
- **Factibilidad**: Ya construido. `upselling_agent.py` corre en horarios pico.
- **Wansoft podria hacerlo?** No. Tiene datos de ventas por mesero pero no tiene capacidad de analisis comparativo automatico, no genera recomendaciones, y no tiene canal de comunicacion al mesero.

---

### 1.4 Analisis de Velocidad de Mesa

- **Que hace**: Mide el tiempo promedio desde que se abre una mesa hasta que se cobra, segmentado por tipo de orden, dia de semana, y hora. Detecta mesas "atoradas" en tiempo real y alerta al gerente.
- **Datos requeridos**: Timestamps de apertura y cierre de orden (event store). Disponible.
- **Ejemplo de output**:
  ```
  MESA LENTA | Mesa 7 | 13:45
  Tiempo abierta: 1h 42min (promedio sabado almuerzo: 58 min)
  Status: Cobrada pero no liberada
  Impacto: Con 3 mesas atoradas, estas perdiendo ~$1,800/hora
  en rotacion.
  Accion: Verificar si el mesero ya ofrecio la cuenta.
  ```
- **Impacto**: Revenue++ (rotacion de mesas = mas covers = mas ventas)
- **Factibilidad**: Ya construido. `table_time_agent.py` activo.
- **Wansoft podria hacerlo?** No. No tiene event store, no tiene timestamps granulares de cada estado de la mesa, y no puede alertar en tiempo real.

---

## 2. Inventario

**Lo que Wansoft hace:** Kardex basico, existencias, conteo fisico vs sistema, punto de reorden como tabla pasiva. 23 KB de codigo de inventario.

**Lo que Wansoft nunca podra hacer:** Predecir consumo, detectar merma inteligente, o vincular inventario con ventas en tiempo real. Su inventario deduce al COBRAR (no al enviar a cocina), asi que durante toda la preparacion el inventario miente.

**Oportunidades de IA para Fullsite:**

---

### 2.1 Food Cost Guardian

- **Que hace**: Monitorea el food cost en tiempo real por platillo, categoria, y global. Compara contra el target (25% cocina). Cuando un platillo se desvie mas de 5 puntos del objetivo, alerta con la causa probable (precio de ingrediente subio, porcion incorrecta, merma alta).
- **Datos requeridos**: Recetas con costos (429 platillos costeados), precios de compra (878 costos registrados), ventas en tiempo real. Disponible.
- **Ejemplo de output**:
  ```
  ALERTA FOOD COST | Categoria: JUGOS
  Food cost actual: 37.2% (target: 25%)
  
  Platillo critico: JUGO VERDE DE LA CASA
  Costo: $82.32 | Precio: $95.00 | Food cost: 86.7%
  
  Causa probable: Precio del AGUACATE subio 18% 
  en las ultimas 2 semanas ($100 -> $118/kg).
  El aguacate esta en 18 recetas.
  
  Opciones:
  1. Subir precio del jugo a $115 (food cost baja a 71.6%)
  2. Reducir porcion de aguacate de 100g a 80g (ahorro $3.60/jugo)
  3. Sustituir por ingrediente alternativo
  ```
- **Impacto**: Cost-- (reducir food cost 2 puntos = $40K/ano en un restaurante como AMALAY con $2M en insumos)
- **Factibilidad**: Puede construirse ahora. Los datos de FOOD-COST-ENGINE ya existen. Solo falta el monitor en tiempo real.
- **Wansoft podria hacerlo?** No. Su food cost es un reporte Excel que nadie abre. No tiene alertas, no tiene analisis causal, no conecta precios de compra con impacto en menu.

---

### 2.2 Predictor de Desabasto

- **Que hace**: Combina existencias actuales, consumo historico, y prediccion de demanda (por dia de semana + eventos + clima) para alertar 48-72 horas ANTES de que un ingrediente critico se agote.
- **Datos requeridos**: Existencias (736 lineas de inventario), consumo por receta, 90 puntos de reorden configurados, historico de ventas. Disponible parcialmente -- necesita consumo diario por ingrediente.
- **Ejemplo de output**:
  ```
  ALERTA DESABASTO | 48 horas
  
  SALMON AHUMADO
  Stock actual: 1.2 kg
  Consumo promedio viernes-sabado: 0.9 kg/dia
  Prediccion: se agota SABADO 3:00 PM
  
  Este ingrediente esta en 6 recetas:
  - Salmon Bagel ($360, 7.6% food cost -- tu platillo mas rentable)
  - Eggs Benedict Salmon ($320)
  - 4 platillos mas
  
  Proveedor: Distribuidora del Norte
  Ultimo pedido: hace 5 dias
  Lead time: 24 horas
  
  Quieres que genere la OC? [Si / No]
  ```
- **Impacto**: Revenue++ (zero lost sales -- un desabasto de salmon un sabado puede perder $5K en ventas)
- **Factibilidad**: Puede construirse ahora. Requiere conectar deduccion de inventario con prediccion de ventas.
- **Wansoft podria hacerlo?** No. Su punto de reorden es una tabla estatica que nadie revisa. No predice, no alerta, no conecta con proveedores.

---

### 2.3 Auditor de Merma Inteligente

- **Que hace**: Compara el consumo teorico (basado en ventas x recetas) contra el consumo real (compras - existencias). La diferencia es merma. Identifica patrones: si la merma de un ingrediente sube los martes, probablemente es un empleado especifico. Si sube gradualmente, probablemente son porciones inconsistentes.
- **Datos requeridos**: Ventas por platillo, recetas, compras, existencias. Disponible parcialmente.
- **Ejemplo de output**:
  ```
  REPORTE DE MERMA | Semana 26
  
  Merma total estimada: $8,400 (4.2% de ventas)
  Target: <3%
  
  Top 3 ingredientes con merma anormal:
  1. CAFE EN GRANO: -2.1 kg ($693) | Usado en 19 recetas
     Patron: constante toda la semana. Posible causa: porciones
     de espresso de 25g son mas de lo calibrado.
  2. FRESAS FRESCAS: -1.8 kg ($278) | Usado en 19 recetas  
     Patron: pico el lunes. Posible causa: fresas del viernes
     se echaron a perder el fin de semana.
  3. AGUACATE: -1.5 kg ($150) | Usado en 18 recetas
     Patron: inconsistente. Posible causa: variacion en
     tamano de aguacate vs peso estandar de receta.
  ```
- **Impacto**: Cost-- (reducir merma de 4.2% a 3% = $24K/ano)
- **Factibilidad**: Necesita mas datos (inventario fisico frecuente y compras registradas al dia). Construible en 3 meses.
- **Wansoft podria hacerlo?** No. Tiene "inventario fisico vs sistema" pero es un snapshot manual, no un analisis de patrones. No identifica causas, no detecta tendencias.

---

## 3. Compras y Proveedores

**Lo que Wansoft hace:** Ordenes de compra internas (entre sucursales), catalogo decorativo de 202 proveedores, reportes de compras por proveedor/producto.

**Lo que Wansoft nunca podra hacer:** Optimizar compras. No tiene ciclo de compra real (necesidad -> OC externa -> recepcion -> pago), no tiene historial de precios, y no conecta compras con demanda futura.

**Oportunidades de IA para Fullsite:**

---

### 3.1 Comprador Automatico

- **Que hace**: Genera ordenes de compra automaticas basadas en: existencias actuales, consumo proyectado (proximos 3-5 dias), lead time del proveedor, y dia optimo de entrega. El gerente solo aprueba.
- **Datos requeridos**: Existencias, recetas, prediccion de ventas, catalogo de proveedores con lead times. Parcialmente disponible.
- **Ejemplo de output**:
  ```
  OC SUGERIDA | Proveedor: Alpura | Entrega: Jueves 6 Jul
  
  Generada automaticamente basada en consumo proyectado Jue-Dom.
  
  | Producto         | Stock | Consumo 4d | Pedir | Precio   |
  |------------------|-------|------------|-------|----------|
  | Leche entera     | 8 Lt  | 22 Lt      | 15 Lt | $315.00  |
  | Leche deslact.   | 5 Lt  | 18 Lt      | 15 Lt | $345.00  |
  | Crema p/batir    | 2 Lt  | 6 Lt       | 5 Lt  | $225.00  |
  | Yogurt griego    | 1 Kg  | 4 Kg       | 4 Kg  | $360.00  |
  |                  |       |            | TOTAL | $1,245.00|
  
  vs compra manual promedio a Alpura: $1,890
  Ahorro estimado: $645 (34%) por eliminar sobre-stock.
  
  [Aprobar] [Modificar] [Rechazar]
  ```
- **Impacto**: Cost-- ($645/proveedor/semana x 10 proveedores = $335K/ano), Time-- (2 horas/dia de compras manuales eliminadas)
- **Factibilidad**: Necesita integracion con proveedores (WhatsApp/email para envio de OC). Construible en 2 meses.
- **Wansoft podria hacerlo?** No. No tiene compras reales. Su "compras sugeridas" es basado en punto de reorden estatico, no en prediccion de demanda.

---

### 3.2 Negociador de Precios

- **Que hace**: Rastrea el precio historico de cada ingrediente por proveedor. Cuando detecta que un proveedor subio el precio mas del 10%, busca en la red de restaurantes Fullsite si otros estan comprando el mismo ingrediente mas barato.
- **Datos requeridos**: Historial de precios de compra, red de restaurantes Fullsite. Disponible parcialmente (historial propio si; red aun no).
- **Ejemplo de output**:
  ```
  ALERTA DE PRECIO | SALMON AHUMADO
  
  Proveedor actual: Distribuidora del Norte
  Precio actual: $550/kg
  Precio hace 3 meses: $480/kg (+14.6%)
  
  Este ingrediente impacta 6 recetas y $31.35/dia en costo.
  
  En la red Fullsite:
  - 3 restaurantes compran salmon ahumado a $490-520/kg
  - Proveedor alternativo: Mar y Tierra (Monterrey)
  
  Si cambias a $510/kg, ahorras $14,600/ano.
  Quieres que solicite cotizacion?
  ```
- **Impacto**: Cost-- (negociacion informada puede bajar 5-15% en top ingredients)
- **Factibilidad**: Historial propio: ahora. Red de restaurantes: necesita +10 restaurantes.
- **Wansoft podria hacerlo?** No. Cada restaurante Wansoft es una isla con SQL Server local. No hay datos centralizados, no hay red, no hay historial de precios cruzado.

---

### 3.3 Monitor de Proveedores

- **Que hace**: Evalua cada proveedor en 4 dimensiones: cumplimiento de entrega (llego a tiempo?), calidad (cuantas devoluciones?), precio (competitivo vs mercado?), y completitud (entrego todo lo pedido?). Score automatico mensual.
- **Datos requeridos**: Ordenes de compra con fechas prometidas vs reales, recepciones con discrepancias (6 motivos ya implementados). Parcialmente disponible.
- **Ejemplo de output**:
  ```
  SCORECARD PROVEEDORES | Junio 2026
  
  | Proveedor          | Entregas | A tiempo | Completo | Calidad | Score |
  |--------------------|----------|----------|----------|---------|-------|
  | Alpura             | 12       | 100%     | 95%      | 100%    | 9.5   |
  | Distribuidora NE   | 8        | 75%      | 88%      | 92%     | 7.2   |
  | Frutas Selectas    | 16       | 94%      | 100%     | 85%     | 8.4   |
  
  Distribuidora NE: 2 entregas tarde, 1 incompleta.
  Recomendacion: Solicitar penalizacion o buscar alternativa
  para SALMON AHUMADO y PECHUGA DE PAVO.
  ```
- **Impacto**: Quality++, Cost-- (proveedores malos cuestan en merma, retrabajos, y ventas perdidas)
- **Factibilidad**: Necesita datos de recepcion acumulados (3+ meses). Construible en Q4 2026.
- **Wansoft podria hacerlo?** No. No registra la calidad de entrega. Solo registra si la factura entro al inventario.

---

## 4. Produccion

**Lo que Wansoft hace:** Ordenes de produccion para batch cooking (salsas, panes, bases). Plantillas recurrentes, subproductos, tablajeria. Es su modulo mas profundo con 26 stored procedures.

**Lo que Wansoft nunca podra hacer:** Conectar produccion con demanda predicha. La produccion se decide por intuicion del chef, no por datos.

**Oportunidades de IA para Fullsite:**

---

### 4.1 Planificador de Produccion Predictivo

- **Que hace**: Analiza las ventas historicas por dia de la semana, temporada, clima y eventos, y genera la orden de produccion optima para el dia siguiente. "Manana es sabado lluvioso de julio -- produce 40 croissants (no 20), 15 litros de salsa verde (no 8), y 6 kg de masa para pizza (no 4)."
- **Datos requeridos**: Ventas historicas por platillo por dia (disponible), recetas de subproductos (615 recetas), clima (API externa). Parcialmente disponible.
- **Ejemplo de output**:
  ```
  PLAN DE PRODUCCION | Sabado 5 Jul
  Pronostico: Dia lluvioso, 15% mas trafico que sabado promedio 
  (por vacaciones de verano).
  
  | Subproducto                  | Normal | Sugerido | Razon           |
  |------------------------------|--------|----------|-----------------|
  | SUB SALSA VERDE CHILAQUILES  | 8 kg   | 11 kg    | +35% demanda    |
  | SUB SALSA ROJA CHILAQUILES   | 6 kg   | 8 kg     | +35% demanda    |
  | SUB CROISSANT NATURAL        | 20 pz  | 35 pz    | Sabado lluvioso |
  | SUB PAN BRIOCHE              | 4 pz   | 6 pz     | +50% brunch     |
  | SUB FRIJOLES COCIDOS         | 5 kg   | 7 kg     | correlacion     |
  
  Ingredientes adicionales necesarios:
  - Tomate verde: 4 kg extra ($180)
  - Harina: 3 kg extra ($45)
  - Mantequilla: 2 kg extra ($320)
  
  Quieres generar la OC de ingredientes faltantes?
  ```
- **Impacto**: Revenue++ (zero stockouts de subproductos), Cost-- (zero sobreproduccion = zero merma de producto preparado)
- **Factibilidad**: Necesita modulo de produccion (pre-500 restaurantes). Construible en Q1 2027.
- **Wansoft podria hacerlo?** No. Su produccion es manual -- el chef decide cuanto producir basado en experiencia. No hay prediccion, no hay conexion con ventas, no hay optimizacion.

---

### 4.2 Tracker de Rendimiento de Produccion

- **Que hace**: Compara input vs output de cada orden de produccion. Si la receta dice que 5 kg de harina producen 40 croissants, pero el panadero solo saco 32, detecta el 20% de perdida y busca la causa.
- **Datos requeridos**: Ordenes de produccion con cantidades de entrada y salida. Necesita modulo de produccion.
- **Ejemplo de output**:
  ```
  RENDIMIENTO | Produccion Panaderia | Semana 26
  
  | Producto       | Esperado | Real | Rendimiento | Tendencia |
  |----------------|----------|------|-------------|-----------|
  | Croissant nat. | 160 pz   | 148  | 92.5%       | estable   |
  | Pan brioche    | 24 pz    | 24   | 100%        | estable   |
  | Galleta choco  | 200 pz   | 165  | 82.5%       | bajando   |
  
  ALERTA: Galleta chocochip bajo de 95% a 82.5% en 3 semanas.
  Posible causa: horno descalibrado o cambio en lote de harina.
  Impacto: $340/semana en ingredientes desperdiciados.
  ```
- **Impacto**: Cost-- (identificar 10% de merma en produccion = $50K/ano en restaurante con panaderia)
- **Factibilidad**: Necesita modulo de produccion. Construible junto con el modulo.
- **Wansoft podria hacerlo?** No. Registra ordenes de produccion pero no analiza rendimiento historico ni detecta tendencias.

---

## 5. Recursos Humanos

**Lo que Wansoft hace:** Control de asistencia (huella digital), turnos, programacion semanal, nomina basica, propinas.

**Lo que Wansoft nunca podra hacer:** Optimizar staffing con datos de demanda. Los turnos se programan por costumbre, no por evidencia.

**Oportunidades de IA para Fullsite:**

---

### 5.1 Optimizador de Turnos

- **Que hace**: Analiza ventas por hora de cada dia de la semana, cuenta de personas (ocupacion), y velocidad de servicio. Genera la programacion semanal optima: cuantos meseros, cocineros, y cajeros se necesitan por franja horaria.
- **Datos requeridos**: Ventas por hora (887 dias de historico), personas por hora (necesita mas granularidad), staff disponible. Parcialmente disponible.
- **Ejemplo de output**:
  ```
  PROGRAMACION SUGERIDA | Semana del 7 Jul
  
  SABADO:
  | Franja    | Meseros | Cocina | Barra | Caja |
  |-----------|---------|--------|-------|------|
  | 7am-10am  | 2       | 2      | 1     | 1    |
  | 10am-2pm  | 4       | 3      | 2     | 1    |
  | 2pm-5pm   | 2       | 2      | 1     | 1    |
  | 5pm-10pm  | 3       | 2      | 2     | 1    |
  
  vs programacion actual: 3 meseros todo el dia
  Ahorro: 1 turno completo ($650/dia) sin afectar servicio.
  O: Mismos turnos pero mejor distribuidos = 15% mas velocidad 
  en hora pico.
  
  Staff sugerido para pico (10am-2pm):
  Omar, Brayan, Daniela, Julio (top 4 por ticket promedio)
  ```
- **Impacto**: Cost-- ($650/dia x 100 dias de sobre-staffing = $65K/ano), Quality++ (mejor servicio en pico)
- **Factibilidad**: Ya construido parcialmente. `staffing_optimizer.py` corre los lunes.
- **Wansoft podria hacerlo?** No. Tiene programacion semanal manual pero no conecta turnos con datos de demanda. El gerente programa por intuicion.

---

### 5.2 Analizador de Propinas

- **Que hace**: Correlaciona propinas con ventas, tipo de mesa, hora del dia, y mesero. Identifica meseros que consistentemente reciben mas propinas (mejor servicio) y los que reciben menos (oportunidad de coaching).
- **Datos requeridos**: `wansoft_daily.propinas_total`, `wansoft_kpis.propinas_meseros`, ventas por mesero. Disponible.
- **Ejemplo de output**:
  ```
  PROPINAS | Semana 26
  
  | Mesero        | Ventas    | Propinas | % Propina | Trend  |
  |---------------|-----------|----------|-----------|--------|
  | Omar          | $42,300   | $5,920   | 14.0%     | +1.2%  |
  | Daniela       | $38,100   | $5,334   | 14.0%     | estable|
  | Brayan        | $35,800   | $3,580   | 10.0%     | -0.5%  |
  | Oscar         | $28,400   | $2,272   |  8.0%     | -1.0%  |
  
  Oscar: propina 43% debajo del promedio del equipo.
  Correlacion encontrada: mesas de Oscar tardan 22% mas 
  en recibir la cuenta. Posible causa: no ofrece cuenta 
  proactivamente.
  ```
- **Impacto**: Quality++ (propinas son proxy de satisfaccion), Revenue++ (mejor servicio = mas repeticion)
- **Factibilidad**: Ya construido. `tips_analyzer.py` corre los viernes.
- **Wansoft podria hacerlo?** No. Tiene fondo de propinas pero no analiza correlaciones ni genera insights.

---

## 6. Facturacion Electronica

**Lo que Wansoft hace:** CFDI completo: factura individual, global, agrupada, notas de credito, complementos de pago. El proceso es manual via portal web.

**Lo que Wansoft nunca podra hacer:** Auto-facturar. El comensal tiene que llamar o ir al portal. El restaurante tiene que ir al portal a generar la factura global.

**Oportunidades de IA para Fullsite:**

---

### 6.1 Auto-Facturacion QR

- **Que hace**: Cada ticket imprime un QR. El comensal lo escanea, ingresa sus datos fiscales, y la factura se timbra automaticamente via Facturama API. Cero intervencion humana.
- **Datos requeridos**: Datos de venta, catalogo de clientes FE, Facturama API ($215/mes por ~430 CFDI). Disponible.
- **Ejemplo de output (lo que ve el comensal)**:
  ```
  [Escanea QR en tu telefono]
  
  Factura de AMALAY Coffee & Market
  Ticket: #4521 | $1,240.00 + IVA
  Fecha: 4 Jul 2026
  
  Ingresa tus datos fiscales:
  RFC: [____________]
  Razon Social: [____________]
  CP: [____________]
  Uso CFDI: [Gastos en general v]
  
  [Generar Factura]
  
  Tu factura fue emitida. Revisa tu email.
  ```
- **Impacto**: Time-- (elimina 100% del trabajo manual de facturacion), Quality++ (cero errores de captura)
- **Factibilidad**: Puede construirse ahora. Facturama API ya esta presupuestado ($1,650 setup + $215/mes).
- **Wansoft podria hacerlo?** No. Su facturacion requiere ir al portal web, buscar la venta, capturar datos del cliente, y dar click en emitir. No tiene QR, no tiene self-service.

---

### 6.2 Factura Global Automatica

- **Que hace**: Al cierre de cada periodo fiscal, detecta automaticamente las ventas sin facturar, genera la factura global con el TXT del SAT, y la timbra. El contador solo valida.
- **Datos requeridos**: Ventas del periodo, facturas emitidas (para el reporte de conciliacion). Disponible.
- **Ejemplo de output**:
  ```
  FACTURA GLOBAL | Junio 2026
  
  Ventas totales: $1,842,000
  Facturadas individualmente: $736,800 (40%)
  Para factura global: $1,105,200 (60%)
  
  TXT generado con 2,847 lineas.
  CFDI timbrado: FG-2026-06-001
  UUID: a1b2c3d4-e5f6-...
  
  Enviado al contador (Andy) por email.
  ```
- **Impacto**: Time-- (4-6 horas/mes de trabajo de facturacion eliminadas), Risk-- (cumplimiento fiscal automatico)
- **Factibilidad**: Puede construirse ahora con Facturama API.
- **Wansoft podria hacerlo?** No. La factura global es manual en el portal. Alguien tiene que generar el TXT, subirlo, y timbrar.

---

## 7. Reportes

**Lo que Wansoft hace:** 60+ reportes en Excel descargable con templates MR6. El dueno abre el portal, navega 4 clicks, y exporta. La informacion tiene retraso de sincronizacion.

**Lo que Wansoft nunca podra hacer:** Ser proactivo. Los reportes son pull (el usuario va a buscar), no push (el sistema te avisa). Y jamas podra generar narrativa o analisis causal.

**Oportunidades de IA para Fullsite:**

---

### 7.1 Narrador de Datos

- **Que hace**: Toma los numeros del dia/semana/mes y genera un resumen en lenguaje natural con contexto, comparativas, y recomendaciones. No es un dashboard -- es un brief ejecutivo que el dueno LEE en 30 segundos.
- **Datos requeridos**: Todos los datos de `wansoft_daily` y `wansoft_kpis`. Disponible.
- **Ejemplo de output**:
  ```
  BRIEF DIARIO | Jueves 3 Jul 2026
  
  Vendiste $68,420 con 142 tickets. Ticket promedio $482.
  Eso es 8% arriba del jueves promedio ($63,350).
  
  Por que estuvo bueno: Las BEBIDAS OH subieron 23% 
  ($12,400 vs $10,080 promedio). Posible causa: dia caluroso 
  (34C) impulso cocktails.
  
  Alerta: BAKERY cayo 15%. Los croissants de almendra 
  se agotaron a las 11am. Mañana produce 50% mas.
  
  Mejor mesero: Omar ($12,800, ticket promedio $520).
  
  Food cost estimado hoy: 23.8% (target: 25%). 
  ```
- **Impacto**: Time-- (el dueno ya no necesita abrir el portal ni Excel), Quality++ (decisiones basadas en datos, no en intuicion)
- **Factibilidad**: Ya construido. `daily_briefing.py` corre todos los dias a las 7am. `weekly-amalay.yml` corre los lunes.
- **Wansoft podria hacerlo?** No. Tiene datos pero no tiene narrativa. El dueno recibe numeros en tablas, no insights.

---

### 7.2 Detector de Anomalias

- **Que hace**: Compara cada metrica del dia contra el patron historico del mismo dia de la semana. Si algo se desvie mas de 2 desviaciones estandar, alerta inmediatamente con posible causa.
- **Datos requeridos**: 887 dias de historico. Disponible.
- **Ejemplo de output**:
  ```
  ANOMALIA DETECTADA | 15:30
  
  Descuentos hoy: $4,200 (promedio jueves: $1,800)
  Desviacion: +133% | 3.2 sigma
  
  Desglose:
  - 60% de los descuentos son del turno de Oscar (14:00-15:30)
  - 80% aplicados a la categoria PANINIS
  - PIN de autorizacion: Gerente Eduardo
  
  Posibles causas:
  1. Promocion no registrada en sistema
  2. Producto con problema de calidad (quejas)
  3. Uso indebido de descuento
  
  Accion sugerida: Verificar con Eduardo.
  ```
- **Impacto**: Risk-- (deteccion temprana de problemas), Cost-- (parar hemorragias antes de que se acumulen)
- **Factibilidad**: Ya construido. `anomaly_detector.py` corre en horarios pico.
- **Wansoft podria hacerlo?** No. No tiene analisis estadistico, no tiene deteccion de anomalias, no tiene alertas proactivas.

---

### 7.3 Ingeniero de Menu

- **Que hace**: Clasifica cada platillo en la matriz BCG restaurantera: estrellas (alta popularidad + alto margen), vacas (alta popularidad + bajo margen), puzzles (baja popularidad + alto margen), perros (baja popularidad + bajo margen). Sugiere acciones especificas para cada cuadrante.
- **Datos requeridos**: Ventas por platillo (disponible), food cost por platillo (429 costeados). Disponible.
- **Ejemplo de output**:
  ```
  INGENIERIA DE MENU | Junio 2026
  
  ESTRELLAS (promover agresivamente):
  - Salmon Bagel: 127 vendidos, margen $332.60 = $42,240
  - Chilaquiles Rojos: 340 vendidos, margen $164.58 = $55,957
  - Croissant Breakfast: 89 vendidos, margen $222.37 = $19,791
  
  PUZZLES (subir visibilidad -- alto margen, baja venta):
  - Ceviche del Dia: 12 vendidos, margen $302.14
    Accion: Mover a posicion 2 en menu. 
    Si sube a 30/mes = +$5,440 margen extra.
  - Pastel Cumpleanos: 8 vendidos, margen $714.58
    Accion: Ofrecer activamente en eventos/reservaciones.
  
  PERROS (retirar o reformular):
  - Bisketo de Harina de Almendra: 5 vendidos, margen $1.22
    Accion: Retirar. No vale el espacio en menu.
  - Jugo Verde de la Casa: 45 vendidos, margen $12.68
    Accion: Reformular receta (food cost 86.7%).
  
  VACAS (mantener pero optimizar costo):
  - Coffee Americano: 890 vendidos, margen $71.00
    Accion: Renegociar precio de cafe en grano ($330/kg 
    en 19 recetas -- tu ingrediente #5 mas usado).
  ```
- **Impacto**: Revenue++ (optimizar menu puede subir margen bruto 3-5%), Cost-- (eliminar perros reduce complejidad)
- **Factibilidad**: Ya construido. `menu_engineering.py` corre semanalmente.
- **Wansoft podria hacerlo?** No. Tiene reportes de ventas por platillo y costo por platillo, pero en dos reportes separados que nadie cruza. No tiene clasificacion BCG, no sugiere acciones.

---

## 8. Ecommerce / Delivery

**Lo que Wansoft hace:** Integracion propietaria con Rappi y UberEats via middleware. Disponibilidad de platillos por plataforma, marcas virtuales, Top Offenders.

**Lo que Wansoft nunca podra hacer:** Conectar disponibilidad con inventario real. Si se acaba el aguacate, los bowls siguen activos en Rappi hasta que alguien se da cuenta y los desactiva manualmente.

**Oportunidades de IA para Fullsite:**

---

### 8.1 Disponibilidad Inteligente

- **Que hace**: Conecta inventario real con las plataformas de delivery. Si el AGUACATE (18 recetas) baja de stock minimo, desactiva automaticamente los bowls, el guacamole, y los extras de aguacate en Rappi Y UberEats. Cuando llega la reposicion, los reactiva.
- **Datos requeridos**: Existencias en tiempo real, recetas (que platillo usa que ingrediente), integracion con APIs de delivery. Parcialmente disponible (necesita API de UberEats activa).
- **Ejemplo de output**:
  ```
  AUTO-PAUSE | 14:20
  
  AGUACATE bajo de 0.5 kg (minimo: 1.8 kg).
  
  Desactivados automaticamente:
  - Rappi: Acai Bowl, Buddha Bowl, Extra Aguacate (3 items)
  - UberEats: Acai Bowl, Buddha Bowl, Extra Aguacate (3 items)
  
  Impacto estimado: -$2,400 en ventas delivery hoy
  vs costo de rechazar ordenes sin ingrediente: -$2,400 
  + penalizacion Rappi ($500) + resena negativa
  
  Proximo restock: Manana 8am (OC #247 a Frutas Selectas)
  Reactivacion automatica al recibir.
  ```
- **Impacto**: Quality++ (zero rechazos por desabasto), Risk-- (zero penalizaciones de plataformas)
- **Factibilidad**: Necesita API de UberEats (NDA firmado, contacto de activacion pendiente) y API de Rappi. Construible en Q4 2026.
- **Wansoft podria hacerlo?** No. La disponibilidad es manual. Alguien tiene que ir al portal y desactivar platillo por platillo, plataforma por plataforma.

---

### 8.2 Predictor de Demanda por Canal

- **Que hace**: Analiza patrones de demanda separados para restaurante, para llevar, Rappi, y UberEats. Cada canal tiene su propio patron (delivery pica viernes noche, restaurante pica sabado brunch). Genera preparacion diferenciada por canal.
- **Datos requeridos**: Ventas por tipo de orden y plataforma, historico por dia/hora. Parcialmente disponible.
- **Ejemplo de output**:
  ```
  DEMANDA POR CANAL | Viernes 4 Jul
  
  | Canal       | Prediccion | vs promedio | Preparar mas       |
  |-------------|------------|-------------|---------------------|
  | Restaurante | $45,000    | +5%         | Brunch items        |
  | Para llevar | $8,500     | normal      | --                  |
  | Rappi       | $12,000    | +22%        | Bowls, Paninis      |
  | UberEats    | $9,800     | +18%        | Pizzas, Pastas      |
  
  Alerta: Viernes de quincena + vacaciones de verano.
  Delivery va a estar 20% arriba. Producir 30% mas 
  empaque para llevar y verificar stock de bolsas kraft.
  ```
- **Impacto**: Revenue++ (preparacion optima = zero rechazos), Cost-- (produccion ajustada = zero merma)
- **Factibilidad**: Puede construirse ahora con datos de `wansoft_daily` (tipo de orden ya registrado).
- **Wansoft podria hacerlo?** No. Tiene ordenes por plataforma pero no predice, no diferencia preparacion, y no ajusta produccion.

---

## 9. CRM y Lealtad

**Lo que Wansoft hace:** Tarjetas de regalo fisicas, encuestas basicas, MegaPoints (programa de puntos legacy que casi nadie usa), y catalogo de clientes para facturacion.

**Lo que Wansoft nunca podra hacer:** Conocer al cliente. No tiene CRM real, no tiene historial de visitas, no tiene marketing automatizado.

**Oportunidades de IA para Fullsite:**

---

### 9.1 CRM Automatico

- **Que hace**: Cada interaccion genera un perfil de cliente automatico: facturacion (RFC + datos fiscales), reservacion (nombre + telefono + preferencias), WhatsApp (conversaciones), resenas (sentimiento). Sin captura manual.
- **Datos requeridos**: 12,200 clientes de Reservy ya importados en Supabase, clientes FE, conversaciones WhatsApp. Disponible.
- **Ejemplo de output**:
  ```
  PERFIL | Maria Gonzalez
  
  Fuente: Reservy + Facturacion + WhatsApp
  Visitas: 23 (primera: Mar 2025, ultima: Jun 28 2026)
  Frecuencia: Cada 12 dias (quincenal)
  Gasto promedio: $680/visita
  Lifetime value: $15,640
  
  Preferencias detectadas:
  - Siempre pide Chilaquiles Verdes (14/23 visitas)
  - Suele venir sabados 10-11am
  - Reserva mesa en jardin cuando viene con familia (6 veces)
  - Factura a nombre de "Consultoria MG SA de CV"
  
  Ultima interaccion WhatsApp: "Tienen disponible el jardin 
  para 8 personas el sabado?"
  
  Status: CLIENTE VIP (top 5% por lifetime value)
  Alerta: No ha venido en 18 dias (promedio: 12).
  Sugerencia: Enviar mensaje de reactivacion.
  ```
- **Impacto**: Revenue++ (retener 5% mas clientes = 25-95% mas profit segun Harvard Business Review)
- **Factibilidad**: Puede construirse ahora. Los datos ya estan en Supabase.
- **Wansoft podria hacerlo?** No. No tiene CRM. Los clientes solo existen como datos fiscales para facturacion. No hay historial de visitas, no hay preferencias, no hay marketing.

---

### 9.2 Predictor de Churn

- **Que hace**: Detecta clientes regulares que dejaron de venir. Calcula la frecuencia normal de cada cliente y alerta cuando se desvian. Sugiere accion de reactivacion con incentivo personalizado.
- **Datos requeridos**: Historial de visitas por cliente (via reservaciones y facturas). Disponible parcialmente.
- **Ejemplo de output**:
  ```
  CLIENTES EN RIESGO | Semana 27
  
  5 clientes VIP no han regresado:
  
  1. Carlos Mendez | LTV: $22,400 | Ultima visita: 28 dias
     Frecuencia normal: cada 8 dias
     Accion: WhatsApp con 15% descuento en su proximo brunch
  
  2. Ana Torres | LTV: $18,900 | Ultima visita: 21 dias
     Frecuencia normal: cada 10 dias
     Accion: Invitar a probar nuevo menu de verano
  
  Costo de reactivacion: ~$350 en descuentos
  Valor en riesgo: $41,300 en LTV anual
  ROI estimado: 118x
  ```
- **Impacto**: Revenue++ (recuperar 1 cliente VIP = $15K+ en LTV anual)
- **Factibilidad**: Puede construirse ahora con datos de Reservy + facturacion.
- **Wansoft podria hacerlo?** No. No sabe quien es el cliente. Cada venta es anonima a menos que facture.

---

### 9.3 Segmentacion Inteligente

- **Que hace**: Agrupa clientes automaticamente por comportamiento: frecuencia, gasto, preferencias, canal (presencial vs delivery), horario. Permite campanas de marketing hipersegmentadas.
- **Datos requeridos**: CRM automatico (9.1). Construible sobre la base existente.
- **Ejemplo de output**:
  ```
  SEGMENTOS | Julio 2026
  
  | Segmento              | Clientes | Gasto/visita | Frecuencia  |
  |-----------------------|----------|--------------|-------------|
  | Brunch Lovers         | 340      | $520         | Semanal     |
  | Coffee Regulars       | 890      | $120         | 3x/semana   |
  | Market Shoppers       | 210      | $380         | Quincenal   |
  | Event Hosts           | 45       | $4,500       | Trimestral  |
  | Delivery Only         | 1,200    | $280         | Quincenal   |
  
  Oportunidad: 890 Coffee Regulars nunca han pedido comida.
  Si 10% convierte a brunch = 89 clientes x $400 adicional 
  x 4 visitas/mes = $142K/mes incremental.
  
  Campana sugerida: "Tu cafe favorito + brunch a mitad de precio"
  Canal: WhatsApp (ya tenemos sus numeros)
  ```
- **Impacto**: Revenue++ (marketing personalizado tiene 6x mas conversion que generico)
- **Factibilidad**: Necesita CRM consolidado. Construible en Q1 2027.
- **Wansoft podria hacerlo?** No. No tiene datos de clientes. Cada venta es anonima.

---

## 10. Configuracion y Administracion

**Lo que Wansoft hace:** Setup de sucursales, usuarios POS y web con permisos granulares, perfiles, cuentas contables, cuentas bancarias. La instalacion toma dias.

**Lo que Wansoft nunca podra hacer:** Auto-configurarse. Cada restaurante se configura manualmente: 522 platillos, 615 recetas, 202 proveedores, permisos de 15 roles, impresoras, terminales.

**Oportunidades de IA para Fullsite:**

---

### 10.1 Setup en 30 Minutos con IA

- **Que hace**: El restaurante sube su menu (foto, PDF, o link a Rappi/UberEats). La IA extrae platillos, precios, categorias, y descripciones. Genera automaticamente el catalogo, sugiere recetas basadas en el nombre del platillo, y configura permisos estandar por rol.
- **Datos requeridos**: Menu del restaurante (input), red de restaurantes Fullsite como referencia de recetas (se construye con el tiempo). Input del cliente.
- **Ejemplo de output**:
  ```
  SETUP AUTOMATICO | Restaurante: La Terraza
  
  Menu importado: 85 platillos de PDF
  
  Detectados automaticamente:
  - 12 categorias (Entradas, Sopas, Ensaladas, Carnes, ...)
  - 85 platillos con precios
  - 23 modificadores inferidos ("sin cebolla", "extra queso")
  
  Recetas sugeridas (basadas en platillos similares en la red):
  - "Filete de Res a la Parrilla" -> 6 ingredientes, 
    food cost estimado: 32%
  - "Ensalada Caesar" -> 8 ingredientes,
    food cost estimado: 18%
  
  Permisos aplicados: Perfil "Restaurante estandar"
  (cajero, mesero, cocinero, gerente, dueno)
  
  Tiempo total: 22 minutos
  vs instalacion Wansoft: 2-3 dias
  ```
- **Impacto**: Time-- (de dias a minutos), Cost-- (de $5K en instalacion a $0)
- **Factibilidad**: Puede construirse ahora con Claude API para extraccion de menu. Las recetas sugeridas mejoran con cada restaurante (efecto red).
- **Wansoft podria hacerlo?** No. Requiere instalacion manual de SQL Server, configuracion del portal, importacion item por item, y entrenamiento presencial.

---

### 10.2 Validador de Configuracion

- **Que hace**: Audita la configuracion del restaurante continuamente. Detecta recetas incompletas, productos huerfanos, precios sospechosos, permisos inseguros, y sugiere correcciones.
- **Datos requeridos**: Toda la configuracion del restaurante. Disponible.
- **Ejemplo de output**:
  ```
  AUDITORIA DE CONFIGURACION | AMALAY
  
  CRITICO (resolver hoy):
  - 5 platillos con margen negativo (se venden a perdida):
    TOTEBAG: precio $75, costo $1,000. Perdida: $925/unidad.
    CAFE EN GRANO 500G: precio $220, costo $340.
  
  IMPORTANTE (resolver esta semana):
  - 60 platillos sin receta (11.5%) -- no se puede costear
  - 81 ingredientes fantasma (en recetas pero no en catalogo)
  - 33 productos sin costo asignado
  
  LIMPIEZA (cuando haya tiempo):
  - 160 productos huerfanos (sin uso y sin stock) -- archivar
  - 439 recetas con solo 1 ingrediente -- probablemente incompletas
  
  Score de salud del catalogo: 71.1%
  Target: >90%
  ```
- **Impacto**: Quality++ (datos limpios = food cost real), Cost-- (eliminar ventas a perdida)
- **Factibilidad**: Ya construido parcialmente. `config_validator` corre diario via `agents-daily.yml`. Los datos del CATALOG-INTELLIGENCE report son exactamente este output.
- **Wansoft podria hacerlo?** No. Tiene "validacion de recetas" como reporte pasivo. No tiene auditoria proactiva, no detecta productos a perdida, no sugiere correcciones.

---

## 11. El Copiloto de Datos

Basado en el hallazgo critico: **439 de 615 recetas tienen solo 1 ingrediente**. Los restaurantes no mantienen datos limpios. Nunca lo han hecho. Nunca lo haran -- a menos que una IA les ayude.

### El Problema

Los datos de AMALAY revelan la realidad de TODO restaurante:

| Hallazgo | Numero | Impacto |
|---|---|---|
| Recetas de 1 ingrediente | 439 (71%) | Food cost incalculable |
| Ingredientes fantasma | 81 | Recetas apuntan a productos inexistentes |
| Productos huerfanos | 160 | Basura que confunde el inventario |
| Productos sin costo | 33 | Costeo incompleto |
| Platillos sin receta | 60 (11.5%) | Zero visibilidad de margen |
| Cobertura completa (receta+costo) | 71.1% | El food cost real es un misterio |

Wansoft tiene 20 anos y este es el resultado. No es culpa de Wansoft -- es que ningun sistema ha resuelto el problema de DATA ENTRY en restaurantes. El personal rota cada 3-6 meses. Nadie tiene tiempo. Las recetas se capturan una vez y nunca se actualizan.

### La Solucion: Copiloto de Datos con IA

---

### 11.1 Auto-Completador de Recetas

- **Que hace**: Detecta recetas incompletas (1 ingrediente) y sugiere los ingredientes faltantes basandose en: el nombre del platillo, su categoria, recetas similares de otros restaurantes en la red, y el catalogo de productos existente.
- **Ejemplo de output**:
  ```
  RECETA INCOMPLETA | Chilaquiles Rojos
  
  Receta actual: 1 ingrediente
  - SUB SALSA ROJA PARA CHILAQUILES: 0.25 kg
  
  Ingredientes sugeridos (basado en 47 restaurantes 
  con chilaquiles en la red):
  
  | Ingrediente       | Cantidad | Unidad | Costo est. | Confianza |
  |-------------------|----------|--------|------------|-----------|
  | Totopo de maiz    | 0.08     | kg     | $4.80      | 98%       |
  | Crema acida       | 0.03     | kg     | $3.60      | 95%       |
  | Queso fresco      | 0.04     | kg     | $7.20      | 93%       |
  | Cebolla morada    | 0.02     | kg     | $0.76      | 90%       |
  | Aguacate          | 0.03     | kg     | $3.00      | 85%       |
  | Cilantro          | 0.005    | kg     | $2.00      | 80%       |
  
  Food cost estimado con receta completa: $21.36 (10.8%)
  vs food cost actual (incompleto): $3.50 (1.8%) <-- FALSO
  
  [Aceptar todos] [Revisar uno por uno] [Ignorar]
  ```
- **Impacto**: Quality++ (food cost real en vez de ficticio), Time-- (completar 439 recetas manualmente = 200+ horas. Con IA: 30 minutos de revision)
- **Factibilidad**: Puede construirse ahora con Claude API. La calidad mejora con cada restaurante que se una a la red.
- **Wansoft podria hacerlo?** No. No tiene IA, no tiene red de restaurantes, y no puede sugerir ingredientes. La captura es manual item por item.

---

### 11.2 Cazador de Fantasmas

- **Que hace**: Detecta los 81 ingredientes fantasma (existen en recetas pero no en el catalogo de productos) y sugiere la correccion: vincular con producto existente (nombre similar) o crear producto nuevo.
- **Ejemplo de output**:
  ```
  INGREDIENTES FANTASMA | 81 encontrados
  
  Resolucion automatica (match fuzzy >90%):
  
  | Fantasma                    | Producto sugerido              | Match |
  |-----------------------------|--------------------------------|-------|
  | GALLETA AMALAY A GRANEL     | SUB GALLETA AMALAY A GRANEL    | 96%   |
  | CHICHARRON DE LA RAMOS      | CHICHARRON DE LA RAMOS (CON003)| 100%  |
  | GRANOLA DE LA CASA          | SUB GRANOLA DE LA CASA (SUB014)| 95%   |
  | POLLO COCIDO                | POLLO COCIDO (sin match)       | nuevo |
  | LECHE DE ALMENDRA           | LECHE DE ALMENDRA (sin match)  | nuevo |
  
  Resolucion automatica: 52/81 (64%)
  Necesitan revision manual: 29
  Necesitan producto nuevo: 15
  
  [Aplicar automaticas] [Revisar todas]
  ```
- **Impacto**: Quality++ (catalogo limpio = inventario confiable)
- **Factibilidad**: Puede construirse ahora. Fuzzy matching ya existe en el modulo de compras.
- **Wansoft podria hacerlo?** No. Los ingredientes fantasma son un bug silencioso. Wansoft no lo detecta ni alerta.

---

### 11.3 Archivador Inteligente

- **Que hace**: Identifica los 160 productos huerfanos (sin uso en recetas y sin stock) y los archiva automaticamente. Antes de archivar, verifica que no se hayan vendido en los ultimos 90 dias y que no esten en ninguna OC pendiente.
- **Ejemplo de output**:
  ```
  LIMPIEZA DE CATALOGO | 160 productos candidatos
  
  Safe to archive (sin uso, sin stock, sin ventas 90d): 142
  Requieren verificacion (tienen stock >0): 16
  No archivar (se vendieron en ultimos 90 dias): 2
  
  Ejemplos de productos a archivar:
  - ARROZ BLANCO (sin stock, sin receta, 0 movimientos)
  - AZUCAR MOSCABADO EN SOBRE (indirecto, 0 stock)
  - CAFE AMERICANO MOLIDO (reemplazado por CAFE EN GRANO)
  - 139 productos mas...
  
  Impacto: Catalogo pasa de 769 a 627 productos (-18%)
  Beneficio: Menos ruido en busquedas, conteos, y reportes.
  
  [Archivar 142] [Revisar lista completa]
  ```
- **Impacto**: Quality++ (catalogo limpio), Time-- (conteos fisicos mas rapidos)
- **Factibilidad**: Puede construirse ahora.
- **Wansoft podria hacerlo?** No. Los productos huerfanos se acumulan por anos. Nadie los limpia porque nadie sabe cuales son huerfanos.

---

### 11.4 Motor de Aprendizaje Continuo

- **Que hace**: Cada correccion que un restaurante hace a una receta sugerida retroalimenta el modelo. Cuando el siguiente restaurante agrega "Chilaquiles" a su menu, las sugerencias ya incluyen las correcciones de todos los restaurantes anteriores.
- **Ejemplo**:
  ```
  MODELO DE RECETAS | Chilaquiles (categoria: comida mexicana)
  
  Datos de entrenamiento: 47 restaurantes
  Ingredientes con >80% de presencia:
  - Tortilla/totopo (100%)
  - Salsa roja o verde (100%)
  - Crema (95%)
  - Queso (93%)
  - Cebolla (90%)
  - Proteina: pollo (60%), huevo (45%), ambos (15%)
  - Aguacate (85%)
  - Cilantro (80%)
  
  Variaciones regionales detectadas:
  - Monterrey: crema acida + queso chihuahua
  - CDMX: crema agria + queso panela
  - Guadalajara: crema + queso cotija
  
  Cada restaurante que corrige su receta mejora la precision
  para los siguientes. Con 100 restaurantes, las sugerencias
  seran >95% correctas.
  ```
- **Impacto**: Quality++ (cada restaurante nuevo se beneficia del conocimiento de los anteriores)
- **Factibilidad**: Necesita +10 restaurantes para empezar a ser util. Mejora exponencialmente con escala.
- **Wansoft podria hacerlo?** No. Cada restaurante es una isla. No hay datos compartidos, no hay aprendizaje, no hay red.

---

## 12. El Efecto de Red

Lo que se vuelve posible cuando Fullsite tiene 100+ restaurantes en la plataforma.

Wansoft tiene los clientes (~200 en el noreste) pero cada uno es un SQL Server aislado. No hay datos centralizados. Fullsite tiene los datos centralizados desde el dia 1 (Supabase multi-tenant). Eso cambia todo.

---

### 12.1 Benchmarking Anonimo

- **Que hace**: Cada restaurante puede comparar sus metricas contra el promedio de su categoria (cafeteria, comida mexicana, comida italiana, etc.) sin revelar la identidad de ningun participante.
- **Ejemplo de output**:
  ```
  BENCHMARK | AMALAY vs Cafeterias (Monterrey, $1.5-3M/ano)
  
  | Metrica              | AMALAY  | Promedio | Percentil |
  |----------------------|---------|----------|-----------|
  | Food cost cocina     | 24.9%   | 28.5%    | Top 20%   |
  | Ticket promedio      | $482    | $320     | Top 10%   |
  | Rotacion de mesa     | 1.4h    | 1.1h     | Bottom 40%|
  | Propina %            | 12.3%   | 10.5%    | Top 30%   |
  | Descuentos % ventas  | 2.8%    | 3.2%     | Top 40%   |
  | Staff por $100K vent | 4.2     | 3.8      | Bottom 30%|
  
  Insight: Tu food cost es excelente pero tu rotacion 
  de mesa esta 27% debajo del promedio. Cada 10 minutos 
  de mejora en rotacion = $180K/ano adicional.
  ```
- **Impacto**: Quality++ (el restaurante sabe donde esta parado vs el mercado)
- **Factibilidad**: Necesita 20+ restaurantes por categoria para ser estadisticamente significativo.

---

### 12.2 Compras Grupales

- **Que hace**: Identifica ingredientes que multiples restaurantes Fullsite compran al mismo proveedor (o podrian comprar). Agrega volumen para negociar mejores precios. Fullsite toma un % del ahorro.
- **Ejemplo de output**:
  ```
  COMPRA GRUPAL | Pollo (pechuga y muslo)
  
  12 restaurantes Fullsite en Monterrey compran pollo.
  Volumen semanal combinado: 380 kg
  
  | Proveedor actual   | Restaurantes | Precio/kg | Total/sem |
  |--------------------|-------------|-----------|-----------|
  | Bachoco directo     | 4           | $89       | $12,460   |
  | Pollera del Norte   | 3           | $95       | $9,975    |
  | Mercado de abastos  | 5           | $98       | $17,150   |
  
  Cotizacion grupal (380 kg/semana garantizados):
  - Bachoco: $82/kg (-$7 promedio) = Ahorro $2,660/semana
  - Tyson: $79/kg (-$10 promedio) = Ahorro $3,800/semana
  
  Ahorro anual para los 12 restaurantes: $138K-$198K
  Comision Fullsite (15%): $20K-$30K
  ```
- **Impacto**: Cost-- (5-15% en ingredientes de alto volumen), Revenue++ (comision para Fullsite)
- **Factibilidad**: Necesita 50+ restaurantes. Factible en 2027-2028.

---

### 12.3 Prediccion de Demanda Cruzada

- **Que hace**: Detecta tendencias de demanda en tiempo real a nivel de zona. Si 8 de 12 restaurantes en Monterrey ven un spike de 20% en ventas un viernes, alerta a los otros 4 para que se preparen.
- **Ejemplo de output**:
  ```
  TENDENCIA DETECTADA | Monterrey | Viernes 4 Jul 14:00
  
  8 de 12 restaurantes estan 18-25% arriba del viernes 
  promedio a esta hora.
  
  Causa probable: Puente vacacional + quincena.
  
  Restaurantes que aun no ven el spike:
  - La Terraza: preparar 20% mas para cena
  - El Asador: llamar mesero extra para turno noche
  - Cafe Central: preparar pasteles extra
  
  Historico de puentes similares:
  - El spike dura hasta el domingo
  - Categorias que mas suben: BEBIDAS OH (+35%), 
    POSTRES (+28%), PIZZAS (+22%)
  ```
- **Impacto**: Revenue++ (zero lost sales por falta de preparacion en dias atipicos)
- **Factibilidad**: Necesita 30+ restaurantes con datos real-time. Factible en 2027.

---

### 12.4 Ingenieria de Menu con Datos de Mercado

- **Que hace**: Cuando un restaurante quiere agregar un platillo a su menu, Fullsite le muestra cuantos restaurantes en su zona venden ese platillo, a que precio, con que food cost, y con que popularidad. Decisiones de menu basadas en datos de mercado, no en intuicion.
- **Ejemplo de output**:
  ```
  MARKET INTELLIGENCE | "Salmon Bagel"
  
  14 restaurantes en Monterrey venden Salmon Bagel (o similar).
  
  | Metrica              | Promedio red | Tu precio | Status    |
  |----------------------|-------------|-----------|-----------|
  | Precio               | $320        | $360      | +12%      |
  | Food cost            | 12.5%       | 7.6%      | Excelente |
  | Popularidad (rank)   | #8 en menu  | #3 tu menu| Top       |
  | Margen               | $280        | $332      | +19%      |
  
  El Salmon Bagel es tu 3er platillo mas popular Y el 
  mas rentable (margen $332). Estas 19% arriba del promedio 
  de mercado en margen.
  
  Sugerencia: Puedes subir a $380 sin riesgo -- estas 
  12% arriba pero tu producto es premium y el volumen 
  lo sostiene.
  
  Ingreso adicional: $20 x 127 unidades/mes = $2,540/mes
  ```
- **Impacto**: Revenue++ (pricing basado en datos de mercado en vez de intuicion)
- **Factibilidad**: Necesita 50+ restaurantes con menus completos. Factible en 2027-2028.

---

### 12.5 Tracking de Precios de Ingredientes

- **Que hace**: Agrega los precios de compra de todos los restaurantes Fullsite para crear un indice de precios de ingredientes en tiempo real. Detecta inflacion, estacionalidad, y oportunidades de arbitraje.
- **Ejemplo de output**:
  ```
  INDICE DE PRECIOS | Monterrey | Julio 2026
  
  | Ingrediente     | Precio    | vs mes ant | vs ano ant | Alerta     |
  |-----------------|-----------|------------|------------|------------|
  | Aguacate /kg    | $118      | +18%       | +32%       | SUBIENDO   |
  | Salmon fresco   | $550      | +5%        | +12%       | estable    |
  | Cafe en grano   | $330      | 0%         | -8%        | estable    |
  | Leche entera    | $21/Lt    | +3%        | +15%       | tendencia  |
  | Huevo /kg       | $33.49    | -2%        | -5%        | bajando    |
  
  Top 3 ingredientes con mayor inflacion anual:
  1. Aguacate (+32%) -- impacta 18 recetas
  2. Fresas (+22%) -- impacta 19 recetas  
  3. Leche (+15%) -- impacta 12+ recetas
  
  Recomendacion: Renegociar contrato de aguacate o reformular
  recetas con alta dependencia (bowls, guacamole, extras).
  ```
- **Impacto**: Cost-- (informacion de precios de mercado en tiempo real para negociar)
- **Factibilidad**: Necesita 20+ restaurantes registrando compras. Factible en 2027.

---

## Resumen de Oportunidades

| # | Oportunidad | Modulo | Impacto | Factibilidad |
|---|---|---|---|---|
| 1.1 | Detector de Fraude Real-Time | POS | Risk-- $15-25K/ano | Ahora |
| 1.2 | Predictor de Cierre | POS | Revenue++ | Ya construido |
| 1.3 | Motor de Upselling | POS | Revenue++ $360K/ano | Ya construido |
| 1.4 | Velocidad de Mesa | POS | Revenue++ | Ya construido |
| 2.1 | Food Cost Guardian | Inventario | Cost-- $40K/ano | Ahora |
| 2.2 | Predictor de Desabasto | Inventario | Revenue++ zero lost sales | Ahora |
| 2.3 | Auditor de Merma | Inventario | Cost-- $24K/ano | 3 meses |
| 3.1 | Comprador Automatico | Compras | Cost-- $335K/ano, Time-- | 2 meses |
| 3.2 | Negociador de Precios | Compras | Cost-- 5-15% | Ahora (propio), Red (futuro) |
| 3.3 | Monitor de Proveedores | Compras | Quality++, Cost-- | Q4 2026 |
| 4.1 | Produccion Predictiva | Produccion | Revenue++, Cost-- | Q1 2027 |
| 4.2 | Rendimiento de Produccion | Produccion | Cost-- $50K/ano | Q1 2027 |
| 5.1 | Optimizador de Turnos | RRHH | Cost-- $65K/ano | Ya parcial |
| 5.2 | Analizador de Propinas | RRHH | Quality++ | Ya construido |
| 6.1 | Auto-Facturacion QR | Facturacion | Time-- 100% | Ahora |
| 6.2 | Factura Global Automatica | Facturacion | Time-- 4-6h/mes | Ahora |
| 7.1 | Narrador de Datos | Reportes | Time--, Quality++ | Ya construido |
| 7.2 | Detector de Anomalias | Reportes | Risk--, Cost-- | Ya construido |
| 7.3 | Ingeniero de Menu | Reportes | Revenue++ 3-5% margen | Ya construido |
| 8.1 | Disponibilidad Inteligente | Ecommerce | Quality++, Risk-- | Q4 2026 |
| 8.2 | Demanda por Canal | Ecommerce | Revenue++, Cost-- | Ahora |
| 9.1 | CRM Automatico | CRM | Revenue++ LTV | Ahora |
| 9.2 | Predictor de Churn | CRM | Revenue++ $15K+/cliente | Ahora |
| 9.3 | Segmentacion Inteligente | CRM | Revenue++ 6x conversion | Q1 2027 |
| 10.1 | Setup IA en 30 min | Config | Time-- (dias a minutos) | Ahora |
| 10.2 | Validador de Config | Config | Quality++, Cost-- | Ya parcial |
| 11.1 | Auto-Completar Recetas | Copiloto | Quality++, Time-- 200h | Ahora |
| 11.2 | Cazador de Fantasmas | Copiloto | Quality++ | Ahora |
| 11.3 | Archivador Inteligente | Copiloto | Quality++, Time-- | Ahora |
| 11.4 | Aprendizaje Continuo | Copiloto | Quality++ exponencial | 10+ restaurantes |
| 12.1 | Benchmarking Anonimo | Red | Quality++ | 20+ restaurantes |
| 12.2 | Compras Grupales | Red | Cost-- $138-198K/ano (12 rest.) | 50+ restaurantes |
| 12.3 | Demanda Cruzada | Red | Revenue++ | 30+ restaurantes |
| 12.4 | Menu con Datos de Mercado | Red | Revenue++ pricing | 50+ restaurantes |
| 12.5 | Indice de Precios | Red | Cost-- negociacion | 20+ restaurantes |

---

## La Tesis

Wansoft tiene 20 anos, 822 stored procedures, 211 pantallas, y 150+ endpoints.
Pero cada restaurante es una isla con SQL Server local.

Fullsite tiene 30 agentes IA activos, datos centralizados desde el dia 1,
y una arquitectura que permite escalar de 1 a 1,000 restaurantes sin cambiar una linea.

Wansoft vende software. Fullsite vende inteligencia operativa.

La diferencia no es tecnologica -- es estructural.
Y la brecha se amplifica con cada restaurante que se suma a la red.

---

Generado: 2026-07-04 | Daniel Ramonfaur | Fullsite
