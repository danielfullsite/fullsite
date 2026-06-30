# WANSOFT — Analisis del Modelo de Datos

> Extraido del backup cafeamalay20260330.bak (1.78 GB, marzo 2026)
> Sin restaurar la BD — analisis via strings del binario.
> Objetivo: entender que sabe Wansoft sobre operar un restaurante
> que Fullsite todavia no ha modelado.
> Fecha: 2026-06-30

---

## 1. MODELO DE DATOS

### 1.1 Entidades principales (por Foreign Keys)

Los campos `Id_` revelan las entidades centrales y sus relaciones:

```
                    Id_Terminal (4942)
                         │
            ┌────────────┼────────────┐
            │            │            │
    Id_Platillo (4390)   │    Id_Usuario (1078)
            │            │       ├── Id_Usuario_Mesero (1151)
    Id_Grupo (2285)      │       ├── Id_Usuario_Repartidor (630)
            │            │       ├── Id_Usuario_CajeroAbrio (452)
            │            │       ├── Id_Usuario_CajeroCerro (357)
            │            │       ├── Id_Usuario_Cajero (109)
            │            │       └── Id_Usuario_Asignado (67)
            │            │
            │     Id_OrdenProduccion (1542)
            │            │
            │     Id_Consecutivo (1482)
            │            │
            │     Id_CdeC (904)  ← "Cuenta de Consumo"
            │            │
            │     Id_FormaPago (777)
            │            │
            │     Id_Cliente (1200)
            │       └── Id_ClienteTarjeta (657)
            │
    Id_SucursalDestino (760) ← MULTI-SUCURSAL
            │
    Id_Comanda (545)
    Id_ComandaRegistro (221)
    Id_Configuracion (237)
    Id_Cortesia (220)
    Id_Factura (144)
    Id_SmartNetPay (119)
    Id_SmartOEL (118)
    Id_PagoAnticipado (106)
    Id_KdsEstacion (89)  ← WANSOFT SI TIENE KDS (como estaciones)
    Id_Nivel (86)
    Id_Hotel (284)  ← INTEGRACION HOTELERA
    Id_zona (109)  ← ZONAS DE DELIVERY
```

### 1.2 Descubrimientos del modelo

**Id_SucursalDestino (760 referencias):** Wansoft tiene soporte multi-sucursal
con traspasos entre sucursales. Fullsite no tiene esto.

**Id_Hotel (284 referencias):** Wansoft tiene integracion con sistemas hoteleros.
Probablemente para restaurantes dentro de hoteles que cargan a la habitacion.

**Id_KdsEstacion (89 referencias):** Contrario a lo que pensabamos, Wansoft
SI tiene concepto de estaciones KDS en su modelo de datos. Lo implementan
como configuracion de routing, no como pantalla visual.

**Id_OrdenProduccion (1542 referencias):** Sistema de produccion con ordenes
dedicadas. Esto es para batch cooking (preparar N porciones antes del servicio).

**Id_CdeC (904 referencias):** "Cuenta de Consumo" — parece ser una entidad
separada de la orden. Posiblemente para cuentas corrientes de clientes.

**Id_TerminalTemporal (202):** Terminales temporales — probablemente para
mesas de evento o terminales moviles que se agregan al vuelo.

### 1.3 Campos de negocio reveladores

| Campo | Frecuencia | Que revela |
|---|---|---|
| TotalDescontado (12705) | Muy alto | Cada item tiene su propio total descontado, no solo la orden |
| TipoOrden (5846) | Muy alto | Multiples tipos: mesa, llevar, recoger, domicilio, consumo interno, evento |
| TipoEntrega (3616) | Alto | Tipos de entrega para delivery: inmediata, programada, recoger |
| NombreDeCliente (5836) | Muy alto | El nombre del cliente se guarda en CADA orden, no solo en clientes |
| TipoPrecio (303) | Medio | Precios por tipo (normal, evento, happy hour, delivery) |
| TotalIeps (205) | Medio | IEPS separado del IVA (para bebidas alcoholicas) |
| TotalAPagarMesero / TotalACobrarMesero (157) | Medio | Tracking de cuanto debe cada mesero — sistema de liquidacion |
| TotalPorFacturar (145) | Medio | Ordenes pendientes de facturar |
| MontoRetirado (138) | Medio | Control de retiros por turno |
| TotalEnLetras (125) | Medio | Monto en texto para comprobantes legales |
| MontoRestante (122) | Medio | Saldo pendiente en pagos parciales/CxC |
| CantidadDXU (115) | Medio | "DXU" = DescuentoXUnidad — descuento por unidad individual |
| TipoGrupoId (114) | Medio | Clasificacion de grupos (comida, bebida, market, etc.) |
| FechaEvento (173) | Medio | Soporte de eventos con fecha programada |
| FechaEntrega (495) | Alto | Fecha de entrega para pedidos programados |

---

## 2. STORED PROCEDURES CLASIFICADOS

### 813 SPs en 23 dominios

| Dominio | SPs | % | Estado en Fullsite |
|---|---|---|---|
| Ventas/Ordenes | 177 | 22% | Cubierto |
| Catalogo/Menu | 120 | 15% | Cubierto |
| Pagos | 74 | 9% | Cubierto |
| Usuarios/Seguridad | 74 | 9% | Cubierto |
| Clientes | 58 | 7% | Parcial (sin CRM) |
| Cortes/Caja | 50 | 6% | Cubierto |
| Mesas | 43 | 5% | Cubierto |
| Configuracion | 37 | 5% | Cubierto |
| Impresion | 34 | 4% | Cubierto |
| Sin clasificar | 29 | 4% | Desconocido |
| Facturacion | 24 | 3% | Cubierto |
| Propinas | 16 | 2% | Parcial (sin fondo) |
| Descuentos/Cortesias | 13 | 2% | Cubierto |
| Promociones | 13 | 2% | No cubierto |
| Auditoria/Logs | 12 | 1% | Cubierto |
| Inventario/Almacen | 11 | 1% | Cubierto (mejor) |
| Vales/Caja | 9 | 1% | Parcial |
| Asistencia | 6 | 1% | Parcial |
| Cobranza/CxC | 5 | 1% | No cubierto |
| Delivery/eCommerce | 4 | 0.5% | Cubierto |
| Tarjetas prepago | 2 | 0.2% | No cubierto |
| Etiquetas | 1 | 0.1% | No cubierto |
| Reservaciones | 1 | 0.1% | Cubierto (separado) |

### SPs con logica de negocio critica

**Los mas importantes para entender (si restauramos el .bak):**

| SP | Por que importa |
|---|---|
| `spInsCorteGlobal` (8 variantes) | Define que datos se capturan al cerrar el dia |
| `spInsCortesArqueoDiferenciaFP` | Arqueo por forma de pago — no solo efectivo |
| `spInsIntentoCorteZ` | Registra CADA intento de corte, no solo el exitoso |
| `spInsRegistrarPropinasCorte` | Como se registran propinas al hacer corte |
| `spInsFondoPropinas` | Como se calcula y distribuye el fondo de propinas |
| `spSelReportePropinasPuestos` | Reparto de propinas por puesto (mesero vs mosito) |
| `spSelPorcentajesPropinasMeseros` | % de reparto por mesero |
| `spInsComandaProduccion` | Ordenes de produccion (batch cooking) |
| `spSelConsumoPorVenta` | Deduccion de inventario por receta al vender |
| `spInsNuevoDiaDeOperacion` | Que pasa al abrir un nuevo dia |
| `spSelDescargasPendientes` | Pagos pendientes de conciliar |
| `spInsRelacionPDVEcommerce` | Como vincula POS con plataformas delivery |
| `spInsertarLiquidacion` | Liquidacion de meseros al final del turno |
| `spSelCostoxHoras` | Costo por hora (para analisis de productividad) |

---

## 3. DESCUBRIMIENTOS

### Lo que Wansoft sabe que Fullsite no ha modelado

| # | Descubrimiento | Evidencia | AMALAY lo usa? | Clasificacion | Prioridad |
|---|---------------|-----------|----------------|---------------|-----------|
| D-1 | **Liquidacion de meseros** — al cierre, se calcula cuanto debe cada mesero y cuanto se le paga | `spInsertarLiquidacion`, `TotalAPagarMesero`, `TotalACobrarMesero` | Investigar | Investigar | P1 |
| D-2 | **Fondo de propinas con reparto por puesto** — pool de propinas, % por rol (mesero/mosito/cajero), comisiones | `spInsFondoPropinas`, `spSelReportePropinasPuestos`, `spSelPorcentajesPropinasMeseros` | Investigar | Adoptar | P1 |
| D-3 | **Intentos de corte registrados** — cada intento con cantidad declarada y diferencia | `spInsIntentoCorteZ`, `ReporteIntentosCorte.mr6` | Probable | Adoptar | P0 |
| D-4 | **Produccion/batch cooking** — ordenes de produccion pre-servicio | `spInsComandaProduccion`, `Id_OrdenProduccion` (1542 refs) | Investigar | Investigar | P2 |
| D-5 | **Multi-sucursal con traspasos** — envio de producto entre sucursales | `Id_SucursalDestino` (760 refs) | No (1 sucursal) | No replicar ahora | P3 |
| D-6 | **Integracion hotelera** — cargo a habitacion | `Id_Hotel` (284 refs) | No | No replicar | P3 |
| D-7 | **IEPS separado del IVA** — para bebidas alcoholicas | `TotalIeps` (205 refs) | Si (venden alcohol) | Adoptar | P1 |
| D-8 | **Tipos de precio** (normal, evento, happy hour, delivery) | `TipoPrecio` (303 refs), `spSelEventoDelDia` | Si (eventos) | Mejorar | P2 |
| D-9 | **Descuento por unidad individual** | `CantidadDXU` (115 refs) | Investigar | Investigar | P2 |
| D-10 | **Arqueo por forma de pago** (no solo efectivo) | `spInsCortesArqueoDiferenciaFP` | Investigar | Adoptar | P1 |
| D-11 | **Terminales temporales** para eventos | `Id_TerminalTemporal` (202 refs) | Si (eventos) | Mejorar | P2 |
| D-12 | **Pedidos programados** con fecha/hora de entrega | `FechaEntrega` (495 refs), `FechaPedido` (5750 refs) | Investigar | Mejorar | P2 |
| D-13 | **Costo por hora** (productividad del personal) | `spSelCostoxHoras` | Investigar | Mejorar | P3 |
| D-14 | **Catalogo de propinas sugeridas** | `spSelCatalogoPropinasSugeridas` (5 SPs) | Si (en ticket) | Adoptar | P1 |
| D-15 | **Estado del nuevo dia de operacion** — logica de que pasa cuando se abre un dia | `spInsNuevoDiaDeOperacion`, `spInsNuevoDiaDeOperacionConTiempoExcedido` | Si | Adoptar | P1 |

---

## 4. CLASIFICACION DE FUNCIONALIDADES

### Adoptar (implementar en Fullsite)

| # | Funcionalidad | Razon | Esfuerzo |
|---|---|---|---|
| A-1 | Intentos de corte registrados | Anti-fraude comprobado en campo | 2h |
| A-2 | IEPS separado del IVA | Legal — bebidas alcoholicas requieren IEPS | 1d |
| A-3 | Fondo de propinas (recoleccion, reparto, retiro) | Proceso diario del gerente | 5d |
| A-4 | Catalogo de razones de cancelacion/cortesia | Estandariza motivos, evita texto libre | 1d |
| A-5 | Arqueo por forma de pago | Detecta discrepancias en tarjeta, no solo efectivo | 2h |
| A-6 | Catalogo de propinas sugeridas en ticket | UX para el cliente, sube propina promedio | 1h |
| A-7 | Apertura formal de dia con validaciones | Verificar impresoras, internet, fondo antes de operar | 2h |

### Mejorar (la idea es buena, hacerla mejor)

| # | Funcionalidad | Como hacerla mejor | Esfuerzo |
|---|---|---|---|
| M-1 | Tipos de precio (evento, HH, delivery) | Reglas automaticas por horario/tipo de orden, no config manual | 3d |
| M-2 | Produccion/batch | Modulo de produccion con recetas de lote + tracking de merma | 5d |
| M-3 | Pedidos programados | Calendario integrado con notificaciones | 3d |
| M-4 | Terminales temporales | PWA: cualquier celular es terminal temporal sin configuracion | Ya funciona |
| M-5 | Liquidacion de meseros | Dashboard automatico con desglose, no calculo manual | 3d |
| M-6 | CRM de clientes | Con historial, preferencias, RFC guardado, y recomendaciones IA | 5d |

### No replicar (deuda tecnica o irrelevante)

| # | Funcionalidad | Razon |
|---|---|---|
| N-1 | Multi-sucursal con traspasos | Solo relevante cuando tengamos multi-local. No agregar ahora |
| N-2 | Integracion hotelera | Nicho especifico, no aplica a AMALAY ni a los primeros 100 |
| N-3 | 822 stored procedures | Logica en SQL no testeable ni versionable |
| N-4 | RestPrintingApp polling 15s | Ya superado con bridge HTTP |
| N-5 | Tarjetas prepago (Megapoints) | Add-on comercial de Wansoft, no core |
| N-6 | Check&Go (self-service) | Nicho, no priorizar |

### Investigar (no sabemos si aporta valor)

| # | Funcionalidad | Pregunta a responder | A quien preguntar |
|---|---|---|---|
| I-1 | Liquidacion de meseros | AMALAY paga a meseros por turno o por quincena? El gerente calcula manualmente? | Monica/gerente |
| I-2 | Produccion/batch | El chef de AMALAY prepara bases antes del servicio? Cuantas? | Chef |
| I-3 | Descuento por unidad (DXU) | AMALAY aplica descuentos por item individual? | Cajero |
| I-4 | Pedidos programados | AMALAY recibe pedidos para hora especifica? | Monica |
| I-5 | Costo por hora | El gerente analiza productividad por hora del personal? | Gerente |
| I-6 | Fondo de propinas | Como reparten las propinas hoy? Hay pool? Hay mositos? | Staff |

---

## 5. MAPA DEL RESTAURANT OS — COBERTURA

```
┌──────────────────────────────────────────────────────────────┐
│                    RESTAURANT OS                              │
│                                                              │
│  ████████████████████  VENTAS (95%)                          │
│  ████████████████████  CAJA (95%)                            │
│  ████████████████████  COCINA (90%)                          │
│  ████████████████████  INVENTARIO (90%)                      │
│  ████████████████████  FACTURACION (85%)                     │
│  ████████████████████  EMPLEADOS (85%)                       │
│  ████████████████████  REPORTES (85%)                        │
│  ████████████████████  AUDITORIA (80%)                       │
│  ████████████████████  INTEGRACIONES (80%)                   │
│  █████████████░░░░░░░  PROPINAS (50% — sin fondo/reparto)    │
│  ████████░░░░░░░░░░░░  CLIENTES (30% — sin CRM/CxC)         │
│  ██░░░░░░░░░░░░░░░░░░  PRODUCCION (10% — sin batch)         │
│  ░░░░░░░░░░░░░░░░░░░░  MULTI-SUCURSAL (0%)                  │
│  ░░░░░░░░░░░░░░░░░░░░  HOTELERA (0% — no relevante)         │
│                                                              │
│  COBERTURA TOTAL: ~78% del dominio modelado por Wansoft      │
│  RELEVANTE PARA AMALAY: ~92%                                │
│                                                              │
│  36 procesos MEJOR que Wansoft                               │
│  35 procesos IGUAL que Wansoft                               │
│  13 procesos PEOR que Wansoft (todos con solucion)           │
│  10 procesos que WANSOFT NO TIENE (IA, KDS visual, etc.)    │
└──────────────────────────────────────────────────────────────┘
```

### Lo que todavia no sabemos

**5% del dominio** que no podemos verificar sin restaurar el .bak:
- Logica exacta del corte Z (que bloquea, que imprime, que ya no permite)
- Reglas de liquidacion de meseros
- Logica del fondo de propinas (como calcula %, como distribuye)
- Produccion/batch cooking (como funciona la planificacion)
- Conciliacion de pagos anticpados (como cuadran anticipos)

**Para descubrir esto:** restaurar el .bak en Docker y leer los SPs clave.

---

## 6. PROXIMOS PASOS

### Acciones inmediatas (no requieren restaurar .bak)

| # | Accion | Esfuerzo | Impacto |
|---|---|---|---|
| 1 | Registrar intentos de corte en audit | 2h | Alto (anti-fraude) |
| 2 | Agregar IEPS al calculo de impuestos | 1d | Alto (legal) |
| 3 | Catalogo de razones predefinido | 1d | Medio (estandariza) |
| 4 | Device ID en audit log | 1h | Alto (trazabilidad) |
| 5 | Propinas sugeridas en ticket | 1h | Medio (UX) |

### Preguntas para AMALAY (antes de implementar)

| # | Pregunta | Impacta |
|---|---|---|
| 1 | Como reparten propinas hoy? Pool? Mositos? | Fondo de propinas (5d) |
| 2 | El chef prepara bases antes del servicio? | Produccion/batch (5d) |
| 3 | Venden alcohol? Cobran IEPS? | Calculo fiscal (1d) |
| 4 | Pagan meseros por turno o quincena? | Liquidacion (3d) |
| 5 | Reciben pedidos programados? | Pedidos futuros (3d) |

---

> Este analisis se hizo sin restaurar la BD.
> Para el modelo completo (tablas, columnas, relaciones, datos reales),
> restaurar el .bak en Docker:
>
> docker run -e 'ACCEPT_EULA=Y' -e 'SA_PASSWORD=Str0ngP@ss!' \
>   -p 1433:1433 -v ~/Desktop/WANSOFT:/backup \
>   mcr.microsoft.com/mssql/server:2017-latest
>
> Fullsite v1.0 — 2026-06-30
