# WANSOFT ARCHITECTURE REPORT

> Auditoria profunda del sistema Wansoft/NetSilver, basada en la extraccion
> de archivos de AMALAY Coffee & Market del 29 de junio de 2026.
> Objetivo: entender por que Wansoft ha sobrevivido 20 anos y que podemos
> aprender para construir Fullsite como un sistema superior.

---

## 1. MAPA DEL SISTEMA

```
                    ┌─────────────────────────────┐
                    │     www.wansoft.net          │
                    │  (Update SOAP, sin HTTPS)    │
                    └──────────┬──────────────────┘
                               │ check version
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    TERMINAL WINDOWS (SERVER1)                    │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │  NetSilver.exe   │    │   WebApi (IIS)   │                   │
│  │  (POS principal) │    │  api/menu        │                   │
│  │  .NET 4.5, VB    │    │  api/order       │◄── APK Comandero  │
│  │  WinForms touch  │    │  api/payment     │    (Android)      │
│  └────────┬─────────┘    │  api/user        │                   │
│           │              │  api/sale         │                   │
│           │              │  api/SmartOEL     │                   │
│           │              │  api/SmartNetPay  │                   │
│           │              └────────┬──────────┘                   │
│           │                       │                              │
│           ▼                       ▼                              │
│  ┌─────────────────────────────────────────┐                    │
│  │          SQL SERVER LOCAL               │                    │
│  │    (unica fuente de verdad)             │                    │
│  │    822 stored procedures                │                    │
│  │    ~80 tablas                           │                    │
│  │    config operativa en BD               │                    │
│  └─────────────────────────────────────────┘                    │
│           ▲              ▲              ▲                        │
│           │              │              │                        │
│  ┌────────┴──┐  ┌───────┴────┐  ┌──────┴──────┐               │
│  │ Wansoft   │  │ RestPrint  │  │ DebugDB     │               │
│  │ Services  │  │ App        │  │ (soporte)   │               │
│  │ (backgnd) │  │ (polling   │  └─────────────┘               │
│  └───────────┘  │  15s)      │                                  │
│                 └─────┬──────┘                                  │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────┐               │
│  │           HARDWARE                            │               │
│  │  Impresoras: USB (EC TICKET, PANADERIA)      │               │
│  │              TCP (COCINA FRIA/CALIENTE, BARRA)│               │
│  │  Cajon: RJ-11 via EC TICKET                  │               │
│  │  Huella: HID DigitalPersona 4500 USB         │               │
│  │  Pinpad: OEL / NetPay / Clip                 │               │
│  └──────────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

**Principio arquitectonico #1: TODO pasa por SQL Server.**
No hay cache, no hay estado en memoria, no hay eventos. Cada operacion es un stored procedure.
822 stored procedures son el "codigo de negocio" real de Wansoft.

---

## 2. MODULOS

### 2.1 Modulos principales (DLLs)

| Modulo | DLL | Tamano | Responsabilidad |
|---|---|---|---|
| **Impresor** | NetSilver.Impresor.dll | 421 KB | Motor de impresion: tickets, comandas, cortes, facturas, etiquetas. Contiene sub-namespaces para Factura, Tickets, Cortes, Reportes, Pagos, MegaPoints, Etiquetas |
| **Retail** | NetSilver.Retail.dll | 248 KB | Modulo de venta retail/market: captura, busqueda, scanner, devoluciones, descuentos, vendedores, promociones. Integra Wansoft.CashDro y Wansoft.Promociones.Motor |
| **Mapa de Mesas** | NetSilver.MapaDeMesas.dll | 170 KB | Layout visual de mesas: configurador drag-and-drop, secciones, botones 2024. Incluye AdminCliente |
| **Huella Digital** | NetSilver.HuellaDigital.dll | 109 KB | Enrollment, verificacion, asistencia. Forms: CaptureForm, EnrollmentForm, AsistForm, ConfirmarEntrada, MainForm |
| **Factura Electronica** | NetSilver.FacturaElectronica.DLL | 80 KB | CFDI via eGlobal. Sub-modulos: Facturas, Consultas, Canelaciones [sic]. Usa WebServices SOAP de wansoft.net |
| **Seguridad** | NetSilver.Seguridad.dll | 41 KB | Permisos y roles de usuario |
| **Inventarios** | NetSilver.Inventarios.dll | 23 KB | Modulo de inventario — sorprendentemente pequeno |
| **Cajon** | Cajon.DLL + ControladoresDeCajon.dll | 43 KB | Control del cajon de dinero via comandos ESC/POS |

### 2.2 SDKs de hardware

| SDK | DLLs | Funcion |
|---|---|---|
| **DigitalPersona** | DPCtlUruNet (126K), DPFPDevNET (41K), DPFPShrNET (25K), DPFPVerNET (25K) | Lector de huella URU. Namespaces: DPFP.Capture, DPFP.Verification. Funciones: CreateAcquisition, StartAcquisition, ConvertSampleToANSI, EnumerateDevices |
| **Pagos** | Wansoft.Clip, Wansoft.Netpay, Wansoft.OEL, Wansoft.Wannapay | 4 integraciones de terminal bancaria. Clip usa REST API. NetPay y OEL son on-premise. Wannapay es SOAP legacy |
| **Lealtad** | Megapoints.App.Backend.dll | Puntos, recompensas, tarjetas prepago. SOAP via tempuri.org |
| **Reportes** | DotLiquid.dll | Motor de templates Liquid para generacion dinamica de reportes |

### 2.3 Separacion del sistema

**Fortaleza:** Los modulos son DLLs separadas con responsabilidades claras.
Cada uno tiene su namespace (`NetSilver.Inventarios`, `NetSilver.Seguridad`, etc.).

**Debilidad:** TODOS dependen de `NetSilver.BL` y `NetSilver.Backend` — no hay fronteras reales.
Cualquier modulo puede llamar a cualquier stored procedure. No hay contratos entre modulos.

---

## 3. MODELO DE DATOS

### 3.1 Entidades principales (extraidas de 822 stored procedures)

#### Ventas y Ordenes
| Entidad | SPs | Campos clave |
|---|---|---|
| **OrdenPendiente** | ~15 SPs | Mesa, Mesero, Personas, Terminal, TipoOrden, Status, Descuento |
| **Comanda** | ~10 SPs | Platillo, Cantidad, Silla, Tiempo, Modificadores, Produccion |
| **Venta** | ~20 SPs | Total, Subtotal, IVA, IEPS, FormaPago, Propina |
| **DetalleVenta** | SPs dedicados | Cada item vendido con precio, cantidad, descuento |
| **DivisionCuentaMonto** | tabla propia | Split de cuentas — monto por division |

#### Catalogo
| Entidad | SPs | Campos clave |
|---|---|---|
| **Platillo** | ~10 SPs | Clave, Nombre, Precio, Grupo, Tipo, Barcode, 2x1, Descuento, Cortesia |
| **Grupo** | ~8 SPs | Nombre, TipoGrupo, Nivel, Seccion |
| **Modificador** | ~5 SPs | Nombre, Platillo, Requerido, Nivel |
| **Tamano** | ~4 SPs | Nombre, Precio por tamano |
| **Brand** | SPs dedicados | Marca/submarca de productos |

#### Usuarios y Seguridad
| Entidad | SPs | Campos clave |
|---|---|---|
| **Usuario** | ~15 SPs | Nombre, Puesto, Seccion, Entrada/Salida, Huella |
| **UsuarioHuella** | ~4 SPs | Imagen de huella, datos biometricos |
| **UsuarioRoles** | tabla propia | Roles asignados por usuario |
| **Permiso/PermisoRol/PermisoUsuario** | ~10 SPs | Sistema granular de permisos |
| **RegistroAsistencia** | ~3 SPs | Checada de entrada/salida con huella |

#### Clientes y Facturacion
| Entidad | SPs | Campos clave |
|---|---|---|
| **ClientePOS** | ~15 SPs | Nombre, RFC, RazonSocial, Direccion, Telefono, Email, Tarjeta |
| **ClienteHuella** | SPs dedicados | Huella del cliente (para programas de lealtad) |
| **CodigoFacturacion** | tabla propia | Codigos de facturacion |
| **FacturasACliente** | ~5 SPs | Historial de facturas por cliente |
| **ClienteOrdenParaLlevar** | ~5 SPs | Datos de delivery por cliente |

#### Pagos
| Entidad | SPs | Campos clave |
|---|---|---|
| **FormaPago** | tabla propia | Efectivo, Tarjeta Credito/Debito, Transferencia, UberEats, etc. |
| **Pago** | ~5 SPs | Monto, FormaPago, Propina, Traceabilidad bancaria |
| **PagoParcial** | ~3 SPs | Pagos parciales (splits) |
| **PagosAnticipados** | SPs dedicados | Anticipos/prepagos |
| **PagosPendientes** | tabla propia | Cuentas por cobrar |

#### Inventario y Almacen
| Entidad | SPs | Campos clave |
|---|---|---|
| **Almacen** | ~5 SPs | Existencias, Grupo de almacen |
| **Articulos** | SPs dedicados | Items de inventario |
| **ConsumoPorVenta** | SPs dedicados | Deduccion por receta al vender |
| **Produccion** | campos en Comanda | CantidadEnProduccion, CantidadPorProducir |

#### Operacion
| Entidad | SPs | Campos clave |
|---|---|---|
| **Terminal** | tabla propia | Nombre, Configuracion por terminal |
| **Mesa** | ~5 SPs | Numero, Seccion, Color, Mapa |
| **CambiosDeMesa** | SPs dedicados | Historial de cambios |
| **Configuracion** | ~10 SPs | Config operativa — se lee de BD, no de archivos |
| **Impresora/ImpresoraGrupo** | ~5 SPs | Routing: que grupo va a que impresora |

#### Cortes y Reportes
| Entidad | SPs | Campos clave |
|---|---|---|
| **CorteGlobal** | SPs dedicados | Corte Z: totales del dia |
| **CorteDeTurno** | SPs dedicados | Corte por turno con arqueo |
| **CorteDeMesero** | SPs dedicados | Corte individual |
| **IntentosCorte** | reporte dedicado | Cuantas veces se intento cerrar |

#### Control Anti-Fraude (Logs)
| Entidad | SPs | Campos clave |
|---|---|---|
| **LogFileOperacion** | ~5 SPs | Acciones sensibles por usuario |
| **LogFileOrden** | ~3 SPs | Modificaciones a ordenes |
| **LogFilePlatillo** | ~6 SPs | Cancelaciones/anulaciones de items |
| **LogOperacionesUsuarios** | SPs dedicados | Bitacora de acciones |
| **LogsAccesosPDV** | SPs dedicados | Accesos al punto de venta |
| **LogsDescuentosCortesias** | SPs dedicados | Descuentos y cortesias otorgadas |
| **LogsPromociones** | SPs dedicados | Promociones aplicadas |

#### eCommerce/Delivery
| Entidad | SPs | Campos clave |
|---|---|---|
| **eCommerce** | ~5 SPs | Ordenes externas (Rappi, UberEats) |
| **ZonasDomicilio** | SPs dedicados | Zonas de entrega |
| **Repartidor** | ~5 SPs | Comisiones, ventas por repartidor |

### 3.2 Como modelaron un restaurante

**Wansoft modela un restaurante como:**

1. **Terminales** que abren/cierran turnos
2. **Usuarios** con roles, permisos, y huella digital
3. **Mesas** organizadas en secciones con mapa visual
4. **Ordenes** que pasan por estados: abierta → comandada → impresa → cobrada
5. **Comandas** que son los items enviados a cocina con silla, tiempo, y modificadores
6. **Pagos** que cierran ordenes con multiples formas de pago
7. **Cortes** que cuadran caja por turno, mesero, y dia
8. **Logs** que registran cada accion sensible con quien/cuando/por que

**El modelo es transaccional, no event-driven.** Cada SP hace UPDATE directo sobre las tablas.
No hay historial de eventos — solo el estado actual + logs separados.

---

## 4. FLUJO OPERATIVO

### 4.1 Flujo de una orden (reconstruido de SPs y WebApi)

```
1. APERTURA
   spInsOrdenPendiente(Mesa, Mesero, Personas, Terminal, TipoOrden)
   → Status = 1 (abierta)

2. COMANDA
   spInsComanda(Orden, Platillo, Cantidad, Silla, Tiempo, Modificadores)
   → RestPrintingApp.exe polling cada 15s detecta comanda nueva
   → Imprime en impresora asignada al grupo del platillo
   → Status = 2 (comandada)

3. IMPRESION
   spSelImpresoraGrupoByGrupoTerminal → routing a impresora correcta
   → Cada grupo tiene una o mas impresoras asignadas
   → Status = 3 (impresa)

4. COBRO
   spInsVenta + spInsDetalleVenta + spInsPago
   → Calcula Subtotal, IVA, IEPS, Descuento, Propina
   → Si efectivo: abre cajon via ControladoresDeCajon.dll
   → Si tarjeta: llama SmartOEL/NetPay/Clip
   → Imprime ticket de cobro
   → Status = 4 (cobrada)

5. CORTE
   spSelCorteDeTurno / spSelCorteGlobal
   → Calcula totales, diferencia efectivo real vs sistema
   → Registra intentos de corte
   → Genera reporte impreso
```

### 4.2 Latencia de impresion

**Problema critico de Wansoft:** RestPrintingApp.exe hace polling a SQL Server cada 15 segundos.
Esto significa que una comanda puede tardar hasta 15 segundos en imprimirse despues de enviarla.
En hora pico, 15 segundos es una eternidad para la cocina.

**Fullsite resuelve esto** con el bridge en localhost que recibe el POST inmediatamente.

---

## 5. SISTEMA DE IMPRESION (47 templates)

### 5.1 Tipos de documentos

| Categoria | Cantidad | Ejemplos |
|---|---|---|
| Tickets de venta | 6 | Mesa, llevar, recoger, domicilio (con/sin datos cliente) |
| Cortes financieros | 5 | Global (Z), turno, mesero, intentos, propinas |
| Ventas por dimension | 8 | Por platillo, grupo, mesero, repartidor, forma de pago, fecha |
| Control anti-fraude | 9 | Cancelaciones, anulaciones, cortesias, descuentos, reimpresiones, vales |
| Clientes/facturacion | 7 | Directorio, CxC, CxP, facturas, cobradas |
| Operativos | 4 | Comandas por mesero, consumo por receta, existencias, asistencia |
| Especiales | 3 | Etiquetas barcode, saldo prepago, vale de caja |
| **Total** | **47** | |

### 5.2 Campos reveladores en los templates

- **FondoCaja / EfectivoReal / MontoEntregado** → manejo de fondo de apertura y arqueo
- **Movimiento** → cada modificacion a una cuenta incrementa un contador
- **Gerente + Razon** → TODA excepcion requiere autorizacion documentada
- **PropinasNetas = Propinas - Comision** → descuento de comision sobre propinas
- **Mositos** → rol de ayudante de mesero, recibe fraccion de propinas
- **PorPagar** → sistema de credito/cuenta corriente para clientes regulares
- **CantidadEnLetras** → monto en texto para comprobantes legales

---

## 6. SISTEMA DE HUELLA DIGITAL

### 6.1 Arquitectura

```
HID DigitalPersona 4500 (USB)
    ↓
DPFPDevNET.dll (captura imagen de huella)
    ↓
DPFPShrNET.dll (procesa y serializa)
    ↓
DPFPVerNET.dll (verifica contra template guardado)
    ↓
DPCtlUruNet.dll (controles UI: EnrollmentControl, IdentificationControl)
    ↓
NetSilver.HuellaDigital.dll (wrapper Wansoft)
    Forms: EnrollmentForm, CaptureForm, AsistForm, ConfirmarEntrada
    ↓
SQL Server: UsuarioHuella (template biometrico), UsuarioHuellaImagen (imagen)
```

### 6.2 Flujos de huella

1. **Enrollment:** EnrollmentForm captura multiples muestras → genera template → guarda en UsuarioHuella
2. **Login:** CaptureForm captura huella → DPFPVerNET verifica contra templates → identifica usuario
3. **Asistencia:** AsistForm registra entrada/salida con huella → RegistroAsistencia
4. **Autorizacion:** ConfirmarEntrada pide huella de gerente para aprobar acciones sensibles

### 6.3 Implicaciones para Fullsite

El SDK de DigitalPersona es **.NET nativo** — no funciona en el browser directamente.
Opciones para Fullsite:
- **WebAuthn/FIDO2:** Si Windows Hello reconoce el lector (verificar en Settings)
- **Bridge de huella:** Agregar endpoint `/fingerprint` al bridge que capture via DLL nativa
- **PIN touch:** Teclado numerico en pantalla como workaround

---

## 7. FORTALEZAS DE WANSOFT

### 7.1 Lo que hicieron bien (y por que sobrevivio 20 anos)

1. **SQL Server como unica fuente de verdad.** Un solo lugar donde vive todo. Sin inconsistencias entre caches. Simple y robusto.

2. **Stored procedures como API.** 822 SPs son una API bien definida aunque acoplada. Cualquier cliente (POS, WebApi, Servicios) puede operar sobre los mismos datos con la misma logica.

3. **Control anti-fraude exhaustivo.** CADA excepcion (cancelacion, anulacion, descuento, cortesia, reimpresion) requiere gerente + razon. Los intentos de corte se registran. Las reimpresiones se rastrean. Esto es lo que los restauranteros NECESITAN.

4. **Configuracion en BD.** OrigenDeConfiguraciones=1 — toda la config operativa (mesas, impresoras, permisos, precios) vive en SQL, no en archivos. Un cambio de configuracion se refleja inmediatamente sin reiniciar.

5. **Impresion robusta.** 47 formatos de impresion cubren CADA escenario operativo. Cortes, auditorias, tickets, etiquetas, facturas — todo imprimible.

6. **Roles granulares.** Cajero, Mesero, Repartidor, Mosito, Gerente — cada uno con permisos especificos. El gerente es el "candado" de toda accion sensible.

7. **Ecosistema de pagos.** 4 integraciones de terminal bancaria (Clip, NetPay, OEL, Wannapay) + puntos de lealtad (Megapoints). No dependen de un solo proveedor.

### 7.2 Principios que debemos adoptar

- **Nunca permitir una excepcion sin autorizacion documentada**
- **Registrar cada intento de corte, no solo el exitoso**
- **Separar propinas brutas de netas (comision)**
- **Credito a clientes regulares con tracking de abonos**
- **Etiquetas de codigo de barras para delivery**
- **Rol "mosito" (ayudante) con fraccion de propinas**

---

## 8. DEBILIDADES DE WANSOFT

### 8.1 Lo que NO debemos replicar

1. **Polling de 15 segundos para impresion.** Inaceptable en hora pico. Fullsite imprime instantaneamente via bridge HTTP.

2. **Sin cifrado en ningun endpoint.** HTTP plano para updates, API, y comunicacion interna. El connection string es la misma cadena cifrada copiada en 4+ archivos.

3. **Dependencia total de Windows.** .NET 4.5, SQL Server local, WinForms. No funciona en tablet, movil, Mac, Linux, ni en la nube.

4. **Sin modo offline real.** Si SQL Server se cae, todo se detiene. No hay queue local ni sincronizacion.

5. **Codigo mixto VB.NET + C#.** Dos lenguajes en el mismo proyecto. El compilador Roslyn esta embebido para generar codigo en runtime. Complejidad innecesaria.

6. **822 stored procedures sin organizacion.** Los SPs son el "codigo" pero no tienen tests, versionamiento, ni documentacion. Un cambio en un SP puede romper multiples clientes.

7. **Sin API publica ni documentacion.** La WebApi es interna y sin autenticacion. Cualquier dispositivo en la red puede operar el POS.

8. **Typos historicos nunca corregidos.** "Empesa", "Descueto", "Canelaciones" en codigo de produccion durante anos. Indica falta de code review.

9. **Update sin HTTPS.** El servidor de actualizaciones (`http://www.wansoft.net`) no usa TLS. Un man-in-the-middle puede inyectar codigo malicioso.

10. **Inventario minimo.** NetSilver.Inventarios.dll tiene solo 23 KB — el modulo de inventario es rudimentario. La deduccion por receta existe (ConsumoPorVenta) pero es basica.

---

## 9. LECCIONES PARA FULLSITE

### 9.1 Adoptar

| Leccion | Por que | Como en Fullsite |
|---|---|---|
| Cada excepcion requiere gerente + razon | Anti-fraude comprobado en campo | Ya implementado (PIN gerente) |
| Intentos de corte registrados | Detecta manipulacion | Agregar al audit log |
| Configuracion en BD, no en archivos | Cambios instantaneos sin deploy | Supabase ya lo hace |
| 47+ formatos de impresion | Cubren toda necesidad operativa | Priorizar por uso real en AMALAY |
| Rol mosito con fraccion de propinas | Realidad operativa de restaurantes | Agregar como rol en Fullsite |
| Credito a clientes (CxC) | Restaurantes lo usan | Post-cutover feature |
| Etiquetas barcode para delivery | Control de ordenes | Post-cutover feature |

### 9.2 Superar

| Area | Wansoft | Fullsite |
|---|---|---|
| Impresion | Polling 15s | HTTP instantaneo |
| Offline | No existe | IndexedDB + sync queue |
| Plataforma | Solo Windows | PWA en cualquier dispositivo |
| Seguridad | HTTP plano | HTTPS + JWT + RLS |
| Inventario | 23 KB basico | Event-driven con recetas |
| Inteligencia | Reportes estaticos | 13 agentes IA |
| Facturacion | eGlobal SOAP | Facturama REST + auto-factura |
| Deployment | USB + visita | < 30 min remoto |

### 9.3 No replicar

- Polling para impresion
- SQL Server local como unico backend
- Stored procedures como logica de negocio
- Codigo mixto VB/C#
- HTTP sin TLS
- Connection strings duplicadas
- Dependencia de Windows
- Typos en produccion

---

## 10. OPORTUNIDADES PARA SUPERAR A WANSOFT

### 10.1 Diferenciadores inmediatos

1. **Impresion instantanea** — ya lo tenemos. Wansoft tarda hasta 15s.
2. **Offline-first** — ya lo tenemos. Wansoft muere sin SQL Server.
3. **Multi-plataforma** — PWA en cualquier device. Wansoft solo Windows.
4. **IA integrada** — 13 agentes. Wansoft tiene cero inteligencia.

### 10.2 Diferenciadores a construir

1. **Huella digital via WebAuthn o bridge** — igualar funcionalidad de Wansoft sin SDK propietario
2. **Auto-facturacion** — QR en ticket para que el cliente facture solo (Wansoft no lo tiene)
3. **Dashboard en tiempo real** — Wansoft solo tiene reportes impresos
4. **Inventario event-driven** — deduccion automatica por receta con alertas
5. **Multi-sucursal cloud** — Wansoft es local por terminal

### 10.3 Lo que AMALAY va a extranar de Wansoft

1. **Huella digital** — P0 blocker, hay que resolverlo
2. **Velocidad del corte** — SPs optimizados en 20 anos, nuestro corte debe ser igual de rapido
3. **Formato de ticket familiar** — los meseros conocen el layout de memoria
4. **Control de reimpresiones** — ya lo tenemos pero verificar que funcione
5. **Intentos de corte** — no lo tenemos, hay que agregarlo

---

## 11. INVENTARIO DE ARCHIVOS EXTRAIDOS

### Base de datos
| Archivo | Tamano | Fecha | Contenido |
|---|---|---|---|
| cafeamalay20260330.bak | 1.78 GB | Mar 2026 | BD completa: todo el modelo de datos con datos reales |
| cafe_malay_29052023.bak | 1.37 GB | May 2023 | BD historica (3 anos atras) |
| 010822.rar | 1.5 MB | Ago 2022 | Backup comprimido antiguo |

### Configuracion (12 archivos)
NetSilver.exe.config, Wansoft.Services.exe.config, WebApi/Web.config, Web.config,
Web 1.config, NetSilver.ECommerceService.exe.config, NetSilver.RestPrintingApp.exe.config,
NetSilver.Support.exe.config, Netsilver.DebugDataBase.exe.config, pinpad.config,
cn.xml, com.eglobal.interfaz.cer, Licencia.ns, ContraLicencia.ns

### DLLs (14 archivos)
NetSilver: Impresor, Retail, MapaDeMesas, HuellaDigital, FacturaElectronica,
Seguridad, Inventarios, Cajon, ControladoresDeCajon
DigitalPersona: DPCtlUruNet, DPFPDevNET, DPFPShrNET, DPFPVerNET
Otros: DotLiquid

### Templates (47 archivos MR6 + 8 XLS)
Tickets (6), cortes (5), ventas (8), anti-fraude (9), clientes (7),
operativos (4), especiales (3), Excel (8)

### Carpetas
Excel/, FormatoImpresion_MR6/, RespaldosSQL/, WebApi/

---

## 12. SIGUIENTE PASO CRITICO

**Restaurar el .bak de marzo 2026 en SQL Server** (puede ser Docker en tu Mac).

```bash
docker run -e 'ACCEPT_EULA=Y' -e 'SA_PASSWORD=Str0ngP@ss!' \
  -p 1433:1433 \
  -v /Users/danielrg/Desktop/WANSOFT:/backup \
  mcr.microsoft.com/mssql/server:2017-latest
```

Luego:
```sql
RESTORE DATABASE NetSilver FROM DISK = '/backup/cafeamalay20260330.bak'
WITH MOVE 'NetSilver' TO '/var/opt/mssql/data/NetSilver.mdf',
     MOVE 'NetSilver_log' TO '/var/opt/mssql/data/NetSilver_log.ldf'
```

Con la BD restaurada podemos:
- Ver TODAS las tablas y relaciones
- Consultar datos reales (productos, recetas, clientes, proveedores)
- Entender la estructura de permisos
- Extraer templates de huella digital
- Exportar datos que falten para Fullsite

---

## 13. LECCIONES PARA FULLSITE

### 13.1 Adoptar

Principios que Wansoft resolvio correctamente durante 20 anos de operacion
en restaurantes reales. Implementarlos en Fullsite no es copiar — es
reconocer que estos problemas ya fueron validados en campo.

| Principio | Evidencia en Wansoft | Accion en Fullsite |
|---|---|---|
| Toda excepcion requiere gerente + razon documentada | 9 reportes anti-fraude, campos Gerente/Razon en cada template de cancelacion, anulacion, descuento, cortesia | Ya implementado parcialmente (PIN gerente). Agregar campo "razon" obligatorio a cada accion sensible |
| Intentos de corte registrados | ReporteIntentosCorte.mr6 — registra cada intento con cantidad declarada y diferencia vs sistema | No implementado. Agregar al audit log: cada intento de cierre, cantidad ingresada, diferencia |
| Reimpresiones rastreadas por usuario | ReporteReimpresionesXMesero.mr6 — cada reimpresion se loguea con mesero y tipo de accion | Implementar: loguear cada reimpresion en audit con actor y motivo |
| Separacion propinas brutas vs netas | Campo Comision en ReportePropinas.mr6, PropinasNetas = Propinas - Comision | Agregar campo comision a propinas cuando aplique |
| Rol mosito (ayudante de mesero) | Campo Mositos en ReportePropinas.mr6, fraccion diferenciada de propinas | Agregar rol "ayudante" en Fullsite con reglas de reparto de propina |
| Credito a clientes regulares (CxC) | CuentasPorPagar, CuentasCobradas, campo PorPagar — historial de abonos | Post-cutover: sistema de cuentas por cobrar con tracking de saldos |
| Etiquetas barcode para delivery | EtiquetasTLP2844.mr6 — rotula bolsas con codigo de barras escaneable | Post-cutover: impresion de etiquetas desde el POS |
| Configuracion operativa en BD, no en archivos | OrigenDeConfiguraciones=1 en todos los procesos — mesas, impresoras, permisos, precios viven en SQL, no en config files | Ya lo hacemos via Supabase. Confirmar que TODA config sea editable sin deploy |
| Vales de caja con trazabilidad | Vale.mr6 — cada salida de efectivo tiene responsable, descripcion, monto, fecha | Ya implementado en retiros/depositos. Verificar que el reporte muestra quien y por que |
| Catalogo de razones predefinido | spSelCatalogoCancelaciones, spSelCatalogoCortesia, spSelCatalogoDescuento — razones estandarizadas, no texto libre | Implementar: catalogos de razones para cancelaciones, cortesias, descuentos. Reduce ambiguedad |

### 13.2 Mejorar

Cosas que Wansoft hace bien pero que Fullsite puede hacer significativamente mejor
por ventaja tecnologica o arquitectonica.

| Area | Wansoft | Fullsite (mejor) | Por que |
|---|---|---|---|
| Impresion | Polling cada 15s via RestPrintingApp.exe | Bridge HTTP instantaneo en localhost | Latencia de 0-1s vs 0-15s. En hora pico, 15 segundos es inaceptable |
| Offline | No existe. SQL Server se cae = operacion se detiene | IndexedDB + sync queue + Service Worker | El restaurante sigue vendiendo sin internet |
| Plataforma | Solo Windows (.NET 4.5, WinForms) | PWA en cualquier dispositivo con browser | Una tablet de $3,000 reemplaza una terminal de $15,000 |
| Seguridad de red | HTTP plano en todo. Updates SOAP sin HTTPS | HTTPS + JWT + RLS + CORS | Wansoft transmite credenciales en texto plano |
| Reportes | Templates estaticos (MR6) que se imprimen en papel | Dashboard interactivo en tiempo real + 13 agentes IA | De "imprimir el corte y revisarlo" a "el sistema te alerta si algo esta mal" |
| Facturacion | eGlobal via SOAP, proceso manual | Facturama REST + QR de auto-facturacion en ticket | El cliente factura solo, sin depender del cajero |
| Inventario | 23 KB de DLL, deduccion basica por receta | Event-driven con recetas, alertas de stock bajo, reorder points | De "checar existencias cuando te acuerdas" a "el sistema te avisa" |
| Deployment | USB + visita in situ + instalacion Windows | < 30 min remoto, sin instalacion local | 100 restaurantes en un ano, no 10 |
| Auditoria | Logs en SQL sin visualizacion facil | Audit log con dashboard, filtros, y alertas automaticas | La informacion existe en Wansoft pero nadie la consulta porque es un reporte impreso |
| UX mapa de mesas | Configurador drag-and-drop en WinForms (MapaDeMesas.dll 170 KB) | PWA touch-first con layout visual responsive | Misma funcionalidad, mejor experiencia |

### 13.3 No replicar

Decisiones de Wansoft que son deuda tecnica acumulada o limitaciones de su epoca.
Replicarlas seria importar problemas resueltos, no soluciones.

| Decision | Problema | Alternativa en Fullsite |
|---|---|---|
| Polling de 15s para impresion | Latencia garantizada en hora pico | Bridge HTTP push (ya implementado) |
| SQL Server local como unico backend | Un solo punto de fallo. Sin backup automatico. Sin acceso remoto | Supabase (Postgres cloud) + offline sync |
| 822 stored procedures como logica de negocio | Sin tests, sin versionamiento, sin documentacion. Un cambio rompe todo | Logica en codigo TypeScript con tests, CI/CD, y type safety |
| Dependencia total de Windows | Excluye tablets, moviles, cualquier device moderno | PWA cross-platform |
| Codigo mixto VB.NET + C# | Complejidad innecesaria, dos lenguajes en un proyecto | TypeScript unico en todo el stack |
| Connection string cifrada duplicada en 4+ archivos | Un vector de ataque por copia. Un punto de verdad deberia bastar | Variables de entorno en Vercel, nunca en codigo |
| SDK nativo de DigitalPersona (.NET) | Solo funciona en Windows, acoplado a hardware especifico | WebAuthn/FIDO2 estandar o bridge HTTP agnositco |
| HTTP sin TLS para updates y API interna | Cualquiera en la red puede interceptar trafico | Todo HTTPS, sin excepciones |
| Typos en produccion nunca corregidos ("Empesa", "Descueto", "Canelaciones") | Indica falta de code review y cultura de calidad | Linting, tests, y PR review en cada cambio |
| Modulos sin fronteras reales (todos dependen de NetSilver.BL) | Cambiar inventarios puede romper facturacion | Event bus entre modulos, contratos explicitos |
| WebApi sin autenticacion | Cualquier dispositivo en la red puede operar el POS | JWT + roles + RLS por defecto |
| Compilador Roslyn embebido para reportes dinamicos | Superficie de ataque, complejidad, fragilidad | Templates estaticos o motor de reportes seguro |

### 13.4 Riesgos para el cutover

Hallazgos de esta auditoria que impactan directamente la transicion
de Wansoft a Fullsite en AMALAY.

| Riesgo | Severidad | Detalle | Accion requerida |
|---|---|---|---|
| **Certificado eGlobal expira 3 ago 2026** | CRITICO | El certificado para CFDI de Wansoft vence en ~35 dias. Si AMALAY sigue facturando con Wansoft despues de esa fecha, la emision de facturas fallara | Decidir: activar Facturama en Fullsite ANTES de esa fecha, o renovar certificado eGlobal (depende de Wansoft/proveedor) |
| **Huella digital requiere bridge o WebAuthn** | P0 BLOCKER | El SDK DigitalPersona es .NET nativo — no funciona en browser. No hay teclado en todas las terminales. PIN no es viable como metodo unico | Investigar: (1) Windows Hello reconoce el lector? (2) Bridge con endpoint /fingerprint (3) Teclado numerico touch en pantalla |
| **Controles anti-fraude de Wansoft son exhaustivos** | ALTO | El gerente esta acostumbrado a 9 reportes de control. Si Fullsite no iguala la trazabilidad, pierde confianza | Verificar que Fullsite loguee: cancelaciones, anulaciones, descuentos, cortesias, reimpresiones, intentos de corte — todo con actor y razon |
| **822 stored procedures contienen logica de negocio** | MEDIO | Los SPs definen reglas de negocio no documentadas en ningun otro lugar. Pueden existir validaciones o calculos que no conocemos | Restaurar el .bak en Docker, estudiar los SPs criticos (cortes, pagos, inventario) antes del cutover. No copiarlos — entender que reglas aplican |
| **Cajon conectado a EC TICKET (impresora atascada)** | MEDIO | El RJ-11 del cajon va a la impresora que tiene StartDocPrinter fallando. Sin admin no podemos limpiar la cola | Opcion A: obtener acceso admin para limpiar EC TICKET. Opcion B: mover fisicamente el RJ-11 a PANADERIA/EC01 |
| **Staff acostumbrado a formato de ticket Wansoft** | BAJO | 47 formatos de impresion que llevan anos viendo. El formato de Fullsite es diferente | Ajustar el ticket de Fullsite para incluir los campos que el staff espera ver. No tiene que ser identico, pero si familiar |
| **Modelo de datos desconocido en detalle** | BAJO | Solo extrajimos nombres de SPs y columnas. Las relaciones completas requieren restaurar el .bak | Priorizar restauracion del .bak para antes de la capacitacion del staff |

---

## 14. CONCLUSION

Este documento no es un manual para copiar Wansoft.

Es un mapa de un sistema que opero restaurantes durante 20 anos — con
todas sus fortalezas y todas sus limitaciones.

Las fortalezas de Wansoft son operativas: control anti-fraude, trazabilidad,
roles granulares, 47 formatos de impresion que cubren cada escenario. Estas
no son features — son soluciones a problemas reales que los restauranteros
enfrentan todos los dias.

Las debilidades de Wansoft son tecnologicas: dependencia de Windows, polling
para impresion, HTTP sin cifrado, SQL Server local sin offline. Estas son
las brechas donde Fullsite ya es superior.

La pregunta correcta no es "que features nos faltan."

La pregunta correcta es: "que haria que AMALAY quiera volver a Wansoft?"

La respuesta esta en este documento. Cada item en la seccion "Adoptar" es
algo que podrian extranar. Cada item en "Mejorar" es algo donde ya somos
mejores. Y cada item en "No replicar" es una trampa que debemos evitar.

---

> Documento de investigacion permanente.
> Actualizar con hallazgos de la restauracion del .bak y del Shadow Day.
>
> Generado 2026-06-29, basado en extraccion de AMALAY Coffee & Market.
> Fuentes: 2 backups SQL (3.0 GB), 12 configs, 14 DLLs, 47 templates,
> 8 reportes Excel, WebApi completa.
