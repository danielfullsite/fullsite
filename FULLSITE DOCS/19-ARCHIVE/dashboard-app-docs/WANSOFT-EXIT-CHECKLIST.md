# WANSOFT EXIT CHECKLIST

> "Mañana puedo desinstalar Wansoft y operar todo mi restaurante únicamente con Fullsite sin extrañar nada importante."

Última actualización: 2026-07-08

## Cómo usar este documento

Cada capacidad tiene 4 clasificaciones:
- **Wansoft lo tiene**: ¿Wansoft ofrece esta funcionalidad?
- **Operación diaria**: ¿Se usa todos los días?
- **Bloquea migración**: ¿Un restaurante rechazaría migrar sin esto?
- **Estado**: Construido / Parcial / Falta

---

## CAJA

| Capacidad | Wansoft | Diaria | Bloquea | Estado | Notas |
|-----------|:-------:|:------:|:-------:|:------:|-------|
| Abrir turno con fondo | ✅ | ✅ | ✅ | **Hecho** | TurnoGate obligatorio |
| Cerrar turno (Corte Z) | ✅ | ✅ | ✅ | **Hecho** | Wizard 4 pasos + PIN gerente |
| Corte X (snapshot) | ✅ | ✅ | ✅ | **Hecho** | Sin cierre de turno |
| Fondo inicial | ✅ | ✅ | ✅ | **Hecho** | Conteo manual al abrir |
| Pago efectivo | ✅ | ✅ | ✅ | **Hecho** | Calculadora de cambio |
| Pago tarjeta | ✅ | ✅ | ✅ | **Hecho** | Confirmación Getnet |
| Pago mixto | ✅ | ✅ | ✅ | **Hecho** | N formas, desglose completo |
| Dividir cuenta (parejo) | ✅ | ✅ | ✅ | **Hecho** | N personas, redondeo |
| Dividir cuenta (por items) | ✅ | Semanal | ❌ | **Hecho** | Asignación item→persona |
| Fusionar mesas | ✅ | Semanal | ❌ | **Hecho** | Selección origen→destino |
| Reimpresión ticket | ✅ | ✅ | ✅ | **Hecho** | Desde historial + orden |
| Cancelar item (con PIN) | ✅ | ✅ | ✅ | **Hecho** | Razón + auditoría |
| Cancelar orden completa | ✅ | Semanal | ✅ | **Hecho** | PIN gerente + razón |
| Descuento % | ✅ | ✅ | ✅ | **Hecho** | PIN gerente |
| Descuento monto fijo | ✅ | ✅ | ✅ | **Hecho** | PIN gerente |
| Cortesía | ✅ | Semanal | ❌ | **Hecho** | 100% descuento + razón |
| Propinas | ✅ | ✅ | ✅ | **Hecho** | Manual + botones 10/15/20% |
| Transferir mesa | ✅ | ✅ | ❌ | **Hecho** | Con auditoría |
| Cambio de mesero | ✅ | ✅ | ❌ | **Hecho** | Dropdown dinámico |
| Cuenta por nombre (sin mesa) | ✅ | ✅ | ✅ | **Hecho** | Para llevar / barra |
| Notas en orden | ✅ | ✅ | ❌ | **Hecho** | Por item y por orden |
| Retiros de caja | ✅ | ✅ | ✅ | **Hecho** | Con autorización |
| Depósitos a caja | ✅ | Semanal | ❌ | **Hecho** | Con registro |

## COCINA

| Capacidad | Wansoft | Diaria | Bloquea | Estado | Notas |
|-----------|:-------:|:------:|:-------:|:------:|-------|
| Comandas impresas por estación | ✅ | ✅ | ✅ | **Hecho** | Cocina/barra/caja automático |
| Reimpresión de comanda | ✅ | Semanal | ❌ | **Hecho** | Desde cocina/KDS |
| Cancelación con PIN | ✅ | ✅ | ✅ | **Hecho** | Reversa inventario automática |
| Estados (preparando/lista/entregada) | ✅ | ✅ | ✅ | **Hecho** | KDS con botones |
| KDS pantalla digital | ❌ | ✅ | ❌ | **Hecho** | Fullsite ventaja |
| Timer de preparación | ❌ | ✅ | ❌ | **Hecho** | Color-coded en KDS |
| Impresión por tiempos | ✅ | ✅ | ❌ | **Hecho** | Firebutton en POS |
| Modificadores en comanda | ✅ | ✅ | ✅ | **Hecho** | Impresos en comanda |

## OPERACIÓN

| Capacidad | Wansoft | Diaria | Bloquea | Estado | Notas |
|-----------|:-------:|:------:|:-------:|:------:|-------|
| Crear usuarios | ✅ | Semanal | ✅ | **Hecho** | /pos/staff CRUD |
| Editar usuarios | ✅ | Semanal | ✅ | **Hecho** | Nombre, PIN, rol |
| Desactivar usuarios | ✅ | Mensual | ✅ | **Hecho** | Soft delete |
| Roles y permisos | ✅ | Setup | ✅ | **Hecho** | ~50 permisos granulares |
| Login con PIN | ✅ | ✅ | ✅ | **Hecho** | 4-8 dígitos, rate limited |
| Login con huella | ✅ | ✅ | ✅ | **Hecho** | DigitalPersona SDK nativo |
| Turno obligatorio | ✅ | ✅ | ✅ | **Hecho** | TurnoGate multi-terminal |
| Checador (asistencia) | ✅ | ✅ | ❌ | **Hecho** | PIN + huella |
| Inventario (existencias) | ✅ | ✅ | ✅ | **Hecho** | Auto-deducción por venta |
| Ajuste manual de inventario | ✅ | ✅ | ✅ | **Hecho** | Con motivo |
| Recetas (ingredientes) | ✅ | Setup | ✅ | **Hecho** | Ingredientes + cantidades |
| Food cost por platillo | ✅ | Semanal | ❌ | **Hecho** | Automático por receta |
| Órdenes de compra | ✅ | Semanal | ❌ | **Hecho** | Sugeridas por IA |
| Recepción de compras | ✅ | Semanal | ❌ | **Hecho** | Restock automático |
| Facturación CFDI | ✅ | ✅ | ✅ | **Hecho** | QR en ticket + timbrado |
| Métodos de pago config | ✅ | Setup | ✅ | **Hecho** | DB-driven, comisiones |
| Mesas (planograma) | ✅ | Setup | ✅ | **Hecho** | Hardcoded pero funcional |
| Modificadores obligatorios por nivel | ✅ | ✅ | ✅ | **Parcial** | Existe pero no escalonado |
| Modificadores opcionales | ✅ | ✅ | ❌ | **Hecho** | Extras, quitar, agregar |
| Proveedores (master) | ✅ | Semanal | ❌ | **Parcial** | Solo texto en OC |

## ADMINISTRACIÓN

| Capacidad | Wansoft | Diaria | Bloquea | Estado | Notas |
|-----------|:-------:|:------:|:-------:|:------:|-------|
| Config restaurante (nombre, RFC) | ✅ | Setup | ✅ | **Hecho** | Dinámico desde DB |
| Config impresoras | ✅ | Setup | ✅ | **Hecho** | printers.json dinámico |
| Reporte de ventas diario | ✅ | ✅ | ✅ | **Hecho** | Corte por turno/fecha |
| Reporte por mesero | ✅ | ✅ | ❌ | **Hecho** | Ventas, propinas, tickets |
| Auditoría (log inmutable) | ✅ | ✅ | ✅ | **Hecho** | 15+ tipos de acción |
| Historial de órdenes | ✅ | ✅ | ✅ | **Hecho** | Búsqueda + filtros |
| Backup de datos | ✅ | Setup | ❌ | **Hecho** | Supabase (cloud) |
| Health check sistema | ❌ | ✅ | ❌ | **Falta** | Bridge + Supabase + sync |
| Export CSV/Excel | ✅ | Semanal | ❌ | **Falta** | Solo impresión/screen |
| Multi-sucursal | ✅ | Setup | ❌ | **Parcial** | client_id existe, UI no |

---

## RESUMEN

| Área | Hecho | Parcial | Falta | % |
|------|:-----:|:-------:|:-----:|:-:|
| Caja (23 capacidades) | 23 | 0 | 0 | **100%** |
| Cocina (8 capacidades) | 8 | 0 | 0 | **100%** |
| Operación (21 capacidades) | 18 | 3 | 0 | **90%** |
| Administración (10 capacidades) | 7 | 1 | 2 | **80%** |
| **TOTAL (62 capacidades)** | **56** | **4** | **2** | **93%** |

## BLOQUEAN MIGRACIÓN (pendientes)

| Capacidad | Por qué bloquea | Esfuerzo | Prioridad |
|-----------|----------------|:--------:|:---------:|
| Modificadores escalonados por nivel | Eduardo: "confuso si no son paso a paso" | 4h | **P0** |
| Health check del sistema | Sin esto, no sabes si algo falla | 3h | P1 |
| Export CSV | Contador necesita datos | 2h | P1 |
| Proveedores como tabla | No solo texto en OC | 2h | P2 |

## YA NO BLOQUEAN (resueltos en esta sesión)

- ~~Turno obligatorio~~ → TurnoGate
- ~~Crear usuarios desde POS~~ → /pos/staff
- ~~Config restaurante dinámica~~ → clients table
- ~~Config impresoras dinámica~~ → printers.json
- ~~Login con huella~~ → DigitalPersona SDK
- ~~Bloqueo sesión concurrente~~ → pos_sessions
