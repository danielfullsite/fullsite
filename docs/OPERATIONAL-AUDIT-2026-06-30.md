# AUDITORIA OPERATIVA COMPLETA — FULLSITE POS

> Fecha: 2026-06-30
> Perspectiva: Gerente de restaurante, NO desarrollador
> Pregunta guia: "Puede AMALAY operar una semana completa sin que
> alguien diga: en Wansoft esto era mas facil o mas confiable?"
> Veredicto: NO todavia. 8 huecos bloqueantes identificados.

---

## PROCESOS DE NEGOCIO DESCUBIERTOS EN WANSOFT

El .bak de 1.78 GB contiene 822 stored procedures que revelan
475 entidades unicas. Estos son los dominios de negocio que
Wansoft resuelve y que Fullsite debe considerar:

### Dominios principales (ya cubiertos por Fullsite)

| Dominio | SPs en Wansoft | Status en Fullsite |
|---|---|---|
| Ventas/Ordenes | 318 SPs | Cubierto |
| Pagos | 188 SPs | Cubierto |
| Catalogo (platillos, grupos, mods) | 111 SPs | Cubierto |
| Usuarios/Seguridad/Huella | 120 SPs | Parcial (falta huella) |
| Logs/Auditoria | 108 SPs | Cubierto (mejor que Wansoft) |
| Clientes | 155 SPs | NO cubierto |
| Impresion/Routing | 40 SPs | Cubierto |
| Mesas | 35 SPs | Cubierto |
| Descuentos/Cortesias | 37 SPs | Cubierto |
| Cortes | 11 SPs | Parcial |

### Dominios secundarios (NO cubiertos por Fullsite)

| Dominio | SPs en Wansoft | Relevancia para AMALAY | Prioridad |
|---|---|---|---|
| **Produccion** (cocina, batch, tiempos) | 26 SPs | Si — planifica produccion | P2 |
| **Cobranza/CxC** (credito a clientes) | 23 SPs | No activo en AMALAY | P3 |
| **Promociones** (motor de promos) | 15 SPs | Si — 2x1, happy hour | P2 |
| **Tarjetas prepago** (saldo, recarga) | 16 SPs | No activo en AMALAY | P3 |
| **Etiquetas** (barcode para delivery) | 18 SPs | Si — market/delivery | P2 |
| **Propinas** (fondo, comisiones, retiros) | 20 SPs | Si — reparto diario | P1 |
| **Reservaciones** | 5 SPs | Si — eventos AMALAY | P2 |
| **Vales de caja** (tipos, comisiones) | 25 SPs | Si — gastos operativos | P1 |
| **Check&Go** (self-service) | 6 SPs | No activo | P3 |
| **Mesa billar** (config especial) | 7 SPs | No — AMALAY no tiene | -- |
| **eCommerce** (integracion online) | 8+ SPs | Parcial (delivery) | P2 |

### Proceso desconocido mas importante: FONDO DE PROPINAS

Wansoft tiene un sistema completo de gestion de propinas que NO existe en Fullsite:

- `FondoPropinas` — pool de propinas del turno
- `FondoTotalPropinas` — total acumulado
- `RegistrarPropinasCorte` — registrar propinas al hacer corte
- `RetiroFondoPropina` — retirar propinas del fondo
- `TotalRetiradoPropinas` — control de retiros
- `ReportePropinasMesero` — desglose por mesero
- `ReportePropinasPuestos` — desglose por puesto (mesero vs mosito)
- `PorcentajesPropinasMeseros` — % de reparto
- `ComisionCajero` / `ComisionRepartidor` — comisiones deducidas
- `EstadoCuentaPropinaPorUsuarioId` — estado de cuenta por persona

**Esto es un proceso diario que el gerente ejecuta al cierre.** Las propinas
no son "un campo en la orden" — son un flujo completo de recoleccion,
distribucion, y liquidacion.

---

## FASE 1 — APERTURA

### Lo que deberia pasar al iniciar el dia

```
1. Primer empleado llega
2. Enciende terminal
3. Bridge arranca automaticamente ← FUNCIONA (Startup folder)
4. Abre Chrome con Fullsite ← FUNCIONA (PWA)
5. Login con huella o PIN ← PIN funciona, huella NO
6. Abre turno con fondo de caja ← NO EXISTE COMO FLUJO
7. Verifica impresoras ← NO VISIBLE al usuario
8. Verifica internet ← FUNCIONA (indicador verde)
9. Empieza a tomar ordenes ← FUNCIONA
```

### Huecos de apertura

| Proceso | Status | Impacto | Prioridad |
|---|---|---|---|
| Login PIN | Funciona | -- | -- |
| Login huella | No funciona (WebAuthn pendiente) | ALTO — no hay teclado en todas las terminales | P0 |
| Abrir turno con fondo | **NO EXISTE como UI** | CRITICO — el corte necesita fondo para cuadrar | P0 |
| Verificar impresoras al abrir | No visible | MEDIO — cajero no sabe si imprime hasta que falla | P1 |
| Verificar bridge al abrir | No visible | MEDIO | P1 |
| Verificar internet | Funciona (indicador) | -- | -- |
| Verificar terminal bancaria | No aplica (Getnet standalone) | -- | -- |

---

## FASE 2 — OPERACION

### Matriz completa de flujos operativos

| Proceso | Existe | Intuitivo | Permisos | Auditoria | Rollback | Si falla | vs Wansoft |
|---|---|---|---|---|---|---|---|
| Abrir mesa | Si | Si (planograma) | Si | Si | Salir sin guardar | OK | MEJOR |
| Agregar items | Si | Si (categorias touch) | Si | Si | Eliminar item | OK | MEJOR (mods multinivel) |
| Modificar item | Si | Si (tap en item) | Si | Si (before/after) | Deshacer mod | OK | MEJOR |
| Cancelar item | Si | Si (CancelModal) | PIN gerente | Si (razon+merma) | No (correcto) | OK | MEJOR (3 opciones) |
| Cancelar orden | Si | Si (VoidOrderModal) | Solo admin | Si | Reabrir | OK | MEJOR |
| **Mover mesa** | **No** | -- | -- | -- | -- | -- | **PEOR** |
| Juntar mesas | Si | Si (modo Fusionar) | Si | Si | No | OK | IGUAL |
| **Cambiar mesero** | **Parcial** | **No** (dropdown sin auditoria) | No enforced | No | -- | -- | **PEOR** |
| Split cuenta | Si | Si (2 modos) | No check | Si (por cuenta) | No | OK | IGUAL |
| Descuento | Si | Si (4 modos) | PIN gerente | Si | Quitar descuento | OK | MEJOR |
| Cortesia | Si | Si ($480/persona) | PIN gerente | Si | Quitar | OK | MEJOR |
| **Reimprimir ticket** | **Parcial** | **No visible** para ordenes cerradas | -- | Si | -- | -- | **PEOR** |
| Preticket | Si | Si | Si | Si | -- | Bridge retry | IGUAL |
| Mesa temporal | Si | Si (boton Cuenta) | Si | Si | -- | OK | IGUAL |
| Notas item/orden | Si | Si | Si | -- | Borrar nota | OK | IGUAL |
| Delivery Rappi/Uber | Parcial | Si | Si | Si | -- | OK | PARCIAL |
| Barcode scanner | Si | Si | Si | -- | -- | Busqueda manual | IGUAL |
| Busqueda | Si | Si | Si | -- | -- | OK | IGUAL |
| Tiempos/cursos | Si | Si (boton TIEMPO) | Si | Si | -- | OK | IGUAL |

---

## FASE 3 — COCINA (KDS)

| Proceso | Existe | Intuitivo | Auditoria | Si falla | vs Wansoft |
|---|---|---|---|---|---|
| Recibir ordenes | Si (polling 2s) | Si (cards grandes) | Si | Polling reintenta | MEJOR (Wansoft no tiene KDS) |
| Routing por estacion | Si (cocina/barra/caja) | Si (tabs) | -- | Fallback a default | IGUAL |
| Confirmar items done | Si (checkboxes) | Si | Si | -- | MEJOR (item-level) |
| Avanzar status | Si (boton grande) | Si | Si | -- | MEJOR |
| **Reimprimir comanda** | **No en KDS** | -- | -- | -- | **PEOR** |
| Cambios post-envio | Parcial (agrega, no re-imprime) | No | No | **Cocina no se entera del cambio** | **PEOR** |
| Multi-estacion | Parcial (tabs, no feedback cruzado) | -- | -- | -- | DIFERENTE |

---

## FASE 4 — CAJA

| Proceso | Existe | Intuitivo | Permisos | Auditoria | vs Wansoft |
|---|---|---|---|---|---|
| Cobro efectivo | Si | Si | Si | Si | IGUAL |
| Cobro tarjeta | Si (Getnet standalone) | Si | Si | Si | IGUAL |
| Cobro mixto | Si | Si | Si | Si | IGUAL |
| Cobro delivery | Si (formas custom) | Si | Si | Si | PARCIAL |
| Propina | Si (%, fijo, custom) | Si | -- | Si | IGUAL |
| Cajon efectivo abre | Si (auto) | Si | -- | -- | IGUAL |
| Cajon tarjeta NO abre | Si (verificado en codigo) | -- | -- | -- | IGUAL |
| **Abrir cajon manual** | **No** | -- | -- | -- | **PEOR** |
| Retiro efectivo | Si | Si | PIN gerente | Si | MEJOR (auditoria) |
| Deposito efectivo | Si | Si | PIN gerente | Si | MEJOR |
| **Arqueo persistente** | **No** (se pierde al recargar) | -- | -- | -- | **PEOR** |

---

## FASE 5 — ADMINISTRACION

| Proceso | Existe | Donde | Lo usa AMALAY | vs Wansoft | Prioridad |
|---|---|---|---|---|---|
| Facturacion CFDI | Si (UI completa) | /pos/facturacion | Si | MEJOR (QR auto-factura) | P0 (pago Facturama) |
| Base de clientes | No | -- | Si | PEOR | P2 |
| Inventario visible | No en POS | Solo dashboard | Si | PEOR en visibilidad | P2 |
| Recetas | BD solo | No hay UI | Si | IGUAL (ninguno en caja) | P2 |
| Compras/proveedores | BD solo | No hay UI | No en caja | IGUAL | P3 |
| Reportes en POS | No | Solo en dashboard | Si | PEOR | P2 |
| Permisos configurables | Hardcoded | pos-permissions.ts | Si | PEOR (no editable) | P2 |

---

## FASE 6 — CIERRE

| Proceso | Existe | Intuitivo | Auditoria | Persiste | vs Wansoft |
|---|---|---|---|---|---|
| Ver corte de turno | Si | Si (datos completos) | Si | Si | IGUAL en datos |
| **Cerrar turno** (accion) | **No** | -- | -- | -- | **PEOR** |
| **Corte Z** (cierre de dia) | **No** | -- | -- | -- | **PEOR** |
| Arqueo (declarar efectivo) | Si (campo) | Si | No | **No (se pierde)** | **PEOR** |
| Conciliacion bancaria | No | -- | -- | -- | IGUAL (ninguno) |
| Auditoria log | Si (BD) | **No hay UI** | Si | Si | PEOR en accesibilidad |
| Backup | Si (Supabase cloud) | Automatico | -- | Si | MEJOR |
| **Fondo de propinas** | **No** | -- | -- | -- | **PEOR** |

---

## 8 HUECOS BLOQUEANTES PARA CUTOVER

Estos son los flujos que si faltan, el gerente de AMALAY va a decir
"en Wansoft esto era mas facil."

| # | Hueco | Por que importa | Esfuerzo | Prioridad |
|---|---|---|---|---|
| **H-1** | No hay flujo de ABRIR TURNO con fondo | El corte no cuadra sin fondo. El gerente no sabe si el turno esta abierto | S-M | P0 |
| **H-2** | No hay flujo de CERRAR TURNO | El gerente no puede "cerrar caja". Solo ve datos. No hay acto formal | S | P0 |
| **H-3** | No se puede MOVER MESA | Cliente se cambia de lugar → no hay solucion | S | P0 |
| **H-4** | ARQUEO no se persiste | El gerente declara efectivo, recarga la pagina, se pierde | S | P0 |
| **H-5** | No se puede REIMPRIMIR ticket de orden cerrada | Cliente pide copia → no hay forma | S | P0 |
| **H-6** | No se puede ABRIR CAJON manual | Necesita dar cambio sin venta → no puede | S | P1 |
| **H-7** | Cambios post-envio no RE-IMPRIMEN comanda | Mesero modifica → cocina no se entera | M | P1 |
| **H-8** | No hay UI para VER AUDITORIA desde el POS | Gerente quiere ver cancelaciones del dia → no puede | S | P1 |

Esfuerzo: S = pequeno (horas), M = medio (1-2 dias)

---

## PROCESOS FALTANTES NO BLOQUEANTES (post-cutover)

| # | Proceso | Impacto | Prioridad |
|---|---|---|---|
| F-1 | Gestion de fondo de propinas (recoleccion, reparto, retiro) | Alto — proceso diario | P1 |
| F-2 | Corte Z formal (cierre de dia + impresion + bloqueo) | Alto — gerente lo usa diario | P1 |
| F-3 | Corte X (consulta parcial sin cerrar) | Medio | P2 |
| F-4 | Huella digital para login | Alto — no hay teclado en todas las terminales | P0 |
| F-5 | Base de datos de clientes | Medio | P2 |
| F-6 | Cambiar mesero con auditoria | Medio | P2 |
| F-7 | Mover platillo individual entre mesas | Bajo | P3 |
| F-8 | Cambiar forma de pago post-cobro | Bajo | P3 |
| F-9 | Reimprimir comanda desde KDS | Medio | P2 |
| F-10 | Reportes locales en el POS (no solo dashboard) | Medio | P2 |

---

## EXCEL DE WANSOFT — PROCESOS REVELADOS

Los 8 templates Excel son plantillas para exportacion de reportes:

| Archivo | Quien lo usa | Frecuencia | Proceso | En Fullsite |
|---|---|---|---|---|
| ReporteDeCorteGlobal.xls | Gerente/dueno | Diario | Corte Z exportado a Excel | No |
| ReporteDePagos.xls | Contador | Semanal/mensual | Conciliacion formas de pago | No |
| ReporteDetalleVentas.xls | Gerente | Semanal | Analisis de ventas con 28 columnas (hora, mesero, terminal, items, grupo, tipo orden, subtipo) | Dashboard tiene, Excel no |
| ReporteExistencias.xls | Almacenista | Diario/semanal | **3 pestanas: Existencias + Entradas + Salidas** — movimientos de almacen completos | NO EXISTE |
| ReporteLogAcciones.xls | Gerente/dueno | Cuando sospecha fraude | Auditoria exportable | No como Excel |
| ReporteVentaDetallada.xls | Contador | Mensual | Ventas para contabilidad | Dashboard tiene |
| ReporteVentaPorFormaPago.xls | Contador | Mensual | Mezcla de pagos | Dashboard tiene |
| ReporteVentasPorMesero.xls | Gerente | Semanal | **2 pestanas: Resumen + Detalle por platillo** — evalua rendimiento individual | Corte tiene basico |

**Hallazgo clave:** ReporteExistencias.xls con 3 pestanas (Existencias/Entradas/Salidas) revela que Wansoft tiene un modulo de almacen con movimientos de entrada y salida que AMALAY podria estar usando para control de inventario. Los campos incluyen: Nombre, Modificador, Cantidad, Fecha, Tipo, Comentario.

---

## RESPALDOSSQL

La carpeta `RespaldosSQL/` esta **vacia**. Los backups reales estan
en la raiz de `C:\NetSilver\` (los .bak que ya bajamos).

---

## VEREDICTO

### Lo que Fullsite hace MEJOR que Wansoft (no perder esto)

1. Audit trail inmutable (Wansoft lo tiene apagado en AMALAY)
2. KDS digital con confirmacion por item
3. Offline-first con sync automatico
4. Print queue con retry y escalacion
5. Modificadores multinivel estructurados
6. Cancelacion con 3 opciones (no preparado/merma/anulado)
7. Cortesia automatica por persona
8. 2x1 por seleccion de pares
9. Planograma de mesas con sillas y tiempos
10. Cloud-first (la terminal es desechable)

### Lo que Fullsite debe IGUALAR antes del cutover

1. Abrir turno con fondo
2. Cerrar turno como accion
3. Mover mesa
4. Persistir arqueo
5. Reimprimir ticket de orden cerrada
6. Abrir cajon manual

### Lo que el gerente va a EXTRANAR de Wansoft

1. Huella digital para login
2. Corte Z como cierre formal del dia
3. Fondo de propinas (recoleccion, reparto, retiro)
4. Reportes exportables a Excel
5. "Cambiar mesero" como operacion auditada
6. "Abrir cajon" sin necesidad de venta

### Recomendacion

**Resolver los 8 huecos bloqueantes antes del Shadow Day.**
Son todos de esfuerzo S (horas). Total estimado: 2-3 dias.

Despues del cutover, priorizar:
1. Huella digital (P0)
2. Corte Z formal (P1)
3. Fondo de propinas (P1)
4. Reportes exportables (P2)

---

> Esta auditoria se hizo desde la perspectiva de un gerente de restaurante,
> no de un desarrollador. Cada hueco identificado es un momento donde
> alguien diria: "en Wansoft esto era mas facil."
>
> El objetivo no es copiar Wansoft. El objetivo es que nadie quiera
> volver a el.
