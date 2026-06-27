# FULLSITE OPERATIONS

Solo hechos verificados. Sin hipotesis.
No modificar salvo cambio de estado, riesgo, decision o leccion aprendida.

## Executive Summary

**Estado:** Pre-cutover. Software CORE certificado. Implementacion fisica pendiente.
**Clientes activos:** AMALAY Coffee & Market (San Pedro, Monterrey)
**Siguiente hito:** Shadow Day en AMALAY
**Ultima actualizacion:** 2026-06-27

**Top 5 blockers (ordenados por riesgo operativo):**
1. Facturama no activado — $1,650 pendiente de pago
2. Bridge sin autoarranque — NSSM pendiente in situ
3. Staff sin capacitacion — ninguna sesion realizada
4. 9 items con precio no verificado — esperando Monica
5. Shadow Day no programado

**Proxima accion:** Pagar Facturama. Agendar visita in situ.

---

# 1. Estado del producto

## Certificado E2E (no reabrir sin evidencia nueva)

| Componente | Fecha | Evidencia |
|---|---|---|
| Offline sync (IndexedDB + auto-sync) | 2026-06-26 | OFF-02: orden offline, sync, Supabase, cola vacia |
| Print queue state machine | 2026-06-26 | BUG-005: pending → bridge_unavailable → needs_attention, banner rojo, auto-recovery |
| Audit queue offline | 2026-06-26 | A3: logAudit fallback a sync_queue, 2 synced 0 failed |
| Cobro efectivo | 2026-06-26 | COBRO-01: status cerrada, metodo_pago, pagos, audit, cajon |
| Cobro tarjeta | 2026-06-26 | COBRO-02: cajon NO abre, audit correcto |
| Cobro mixto | 2026-06-26 | COBRO-03: 2 pagos, suma = total, cajon SI abre |
| Cobro propina | 2026-06-26 | COBRO-04: propina separada de total, 15% correcto |
| Cierre de orden | 2026-06-26 | COBRO-06: status cerrada, closed_at, mesa disponible |
| Impacto en corte | 2026-06-26 | COBRO-10: desglose efectivo/tarjeta/propinas correcto |
| Bloqueo cobro sin envio | 2026-06-26 | COBRO-00: toast "primero envia", modal no abre |
| Inventory movements bridge | 2026-06-26 | ALTER TABLE + RLS authenticated, 7 registros reales |

## Funcional (opera pero no completamente certificado)

| Componente | Estado | Pendiente |
|---|---|---|
| Print bridge AMALAY | Imprime correctamente | Autoarranque NSSM (in situ) |
| KDS cocina | Funcional en produccion | Legibilidad a distancia (LATER, post-cutover) |
| Descuento con PIN | Funcional | No certificado E2E |
| Cancelacion de item con PIN | Funcional | No certificado E2E |
| Reapertura de orden | Funcional | COBRO-07 no certificado |
| Split parejo | Funcional | COBRO-12 no certificado |
| Split por items | Funcional | COBRO-13 no certificado |
| Cambio de mesa | Funcional | No certificado |
| Reimpresion ticket | Funcional | No certificado |

## Pendiente

| Componente | Blocker | Tipo |
|---|---|---|
| Facturacion CFDI | Cuenta Facturama no activada ($1,650) | Pago |
| Capacitacion staff | Ninguna sesion realizada | Operacion |
| Shadow Day | No programado | Operacion |
| Autoarranque bridge (NSSM) | Pendiente visita in situ | Configuracion |

## Deprecado

| Componente | Razon |
|---|---|
| offline-sync.ts (localStorage) | Reemplazado por pos-offline-db.ts (IndexedDB). Sin imports. Codigo muerto |
| Telegram reportes legacy | Migrado a Supabase + chat POS |

---

# 2. Estado por cliente

## AMALAY Coffee & Market (San Pedro, Monterrey)

### Implementacion

| Item | Estado | Detalle |
|---|---|---|
| POS software | Produccion | app.fullsite.mx/pos |
| Menu | 522 items activos | 9 items P0 Price Mismatch pendientes de verificacion |
| Staff | 50 registros con PIN | Verificar que son PINs reales, no demo |
| Payment methods | 10 configurados | Efectivo, TC, TD, Transfer, UberEats, Rappi, DiDi, Clip, NetPay, aDomicilio |
| Mesas | 31 configuradas | Hardcoded del plano fisico |
| Facturacion | Codigo listo, cuenta pendiente | $1,650 Facturama |

### Hardware

| Equipo | Estado | Detalle |
|---|---|---|
| Terminal POS | Instalada | Windows, Chrome |
| Monitor KDS cocina | Instalado | Pendiente verificar legibilidad |
| Impresora cocina 1 | Configurada | TCP 192.168.1.21:9100 |
| Impresora cocina 2 | Configurada | TCP 192.168.1.40:9100 (copia) |
| Impresora barra | Configurada | TCP 192.168.1.30:9100 |
| Impresora caja (Market) | Configurada | Windows printer "PANADERIA" |
| Impresora tickets | Configurada | Windows printer "EC TICKET" |
| Cajon de dinero | Conectado a impresora tickets | RJ11 |

### Bridge

| Criterio | Estado |
|---|---|
| Imprime correctamente | SI |
| Arranca automaticamente con Windows | NO — NSSM pendiente |
| Sobrevive reinicio del equipo | NO — depende de NSSM |
| Se reinicia si el proceso falla | NO — depende de NSSM |
| No requiere accion manual del staff | NO — depende de NSSM |

### Riesgos abiertos

| # | Riesgo | Severidad | Accion |
|---|--------|-----------|--------|
| R1 | 9 items con precio discrepante vs Wansoft | P0 | Verificar contra menu fisico (Monica) |
| R2 | 154 items en Wansoft no en Fullsite | P1 | Confirmar cuales estan activos (Monica) |
| R3 | Bridge sin autoarranque | P0 | Instalar NSSM in situ |
| R4 | Staff sin capacitacion | P0 | Sesion de 2-3 horas |
| R5 | Facturama no activado | P0 | Pago $1,650 |

### Timeline

| Hito | Estado | Fecha |
|---|---|---|
| Menu importado | Completado | 2026-06 |
| POS certificado E2E | Completado | 2026-06-26 |
| Bridge instalado | Parcial (falta NSSM) | 2026-06 |
| Facturama | Pendiente | — |
| Capacitacion | Pendiente | — |
| Shadow Day | Pendiente | — |
| Cutover definitivo | Pendiente | — |

---

# 3. Riesgos abiertos (global)

| # | Riesgo | Cliente | Severidad | Estado |
|---|--------|---------|-----------|--------|
| R1 | Precios no verificados contra menu fisico | AMALAY | P0 | Esperando respuesta Monica |
| R2 | Items faltantes no confirmados | AMALAY | P1 | Esperando respuesta Monica |
| R3 | Bridge sin autoarranque | AMALAY | P0 | Pendiente visita in situ |
| R4 | Staff sin capacitacion en Fullsite | AMALAY | P0 | No programada |
| R5 | Sin facturacion electronica | AMALAY | P0 | Pago pendiente |
| R6 | Deduccion inventario no funciona offline | Global | P1 | Documentado LIMITACION-OFF-INV-01 |
| R7 | Inventario dual (pos_ingredients vs pos_inventory_products) | Global | P2 | Documentado INVENTORY-MIGRATION.md |

---

# 4. Decisiones arquitectonicas (no redebatir sin evidencia nueva)

| # | Decision | Fecha | Razon |
|---|----------|-------|-------|
| D1 | IndexedDB para sync queue, no localStorage | 2026-06 | localStorage no soporta transacciones, IndexedDB si |
| D2 | Print queue en localStorage, no IndexedDB | 2026-06 | Simplicidad. Print jobs son efimeros y pequenos |
| D3 | startRetryLoop en layout mount, no en enqueue | 2026-06-26 | processQueue durante enqueue competia con window.location.href redirect |
| D4 | Bridge time-based state machine (no retry-based) | 2026-06-26 | Retries solo cuentan intentos reales. Bridge down no consume retries |
| D5 | Audit events en sync_queue, no queue separada | 2026-06-26 | Reutilizar infraestructura existente. Sin tablas nuevas |
| D6 | Inventory compatibility bridge (ingredient_id TEXT) | 2026-06-26 | Migracion completa es un proyecto separado. Bridge permite operar |
| D7 | Duplicados de audit aceptados | 2026-06-26 | Mejor un registro de mas que uno de menos. event_id es deuda baja |
| D8 | localStorage.clear prohibido en POS | 2026-06-26 | Destruye print queue y sync data. Sidebar logout preserva keys criticas |
| D9 | Precios en Fullsite sin IVA, POS agrega 16% | 2026-06 | Consistente con contabilidad mexicana. IVA se calcula al cobrar |
| D10 | No implementar features sin evidencia operativa | 2026-06-27 | Stability > innovation. Evidencia antes de codigo |

---

# 5. Framework de producto

## Filtro para toda tarea

Debe responder SI a al menos una:
1. Acerca el cutover?
2. Reduce riesgo operativo?
3. Reduce probabilidad de volver a Wansoft?
4. Ayuda a vender el siguiente restaurante?
5. Resuelve problema observado en operacion real?

## Formato de propuesta

1. Problema observado
2. Evidencia disponible
3. Hipotesis
4. Forma de validarla
5. Riesgo de implementarla
6. Prioridad
7. Recomendacion

## Clasificacion de cambios

- CORE (congelado): saveOrder, offline sync, print queue, audit queue, inventory, payment flow, order lifecycle
- UX/Product (abierto con disciplina): solo con evidencia observada en operacion real

## Post-Implementation Report (despues de cada visita)

1. Que salio mejor de lo esperado?
2. Que fallo?
3. Que sorprendio al staff?
4. Que preguntaron mas?
5. Que parte del producto genero mas friccion?
6. Que decision deberiamos tomar esta semana?

---

# 6. Playbooks

## Implementacion nueva (por restaurante)

1. Migration Diff Report (precios, items, impuestos, estaciones, recetas)
2. Configurar menu, staff, PINs, payment methods en Supabase
3. Verificar precios contra menu fisico
4. Instalar bridge con NSSM (5 criterios de certificacion)
5. Configurar impresoras (IPs, estaciones, printers.json)
6. Activar facturacion (Facturama)
7. Capacitacion staff (2-3 horas)
8. Shadow Day (1 turno completo, Wansoft como respaldo)
9. GO/NO-GO (10 criterios binarios)
10. Cutover definitivo

## Criterios GO/NO-GO

Todos deben ser GO:
1. Facturacion funcionando
2. Bridge certificado (5 criterios)
3. Todas las impresoras configuradas y probadas
4. Staff capacitado en flujo basico
5. PINs configurados
6. Metodos de pago configurados
7. Precios verificados contra menu fisico
8. Red verificada in situ
9. Plan de rollback definido
10. Shadow Day completado sin incidentes criticos

## Shadow Day

- Duracion: 1 turno completo
- Todo en Fullsite, Wansoft solo como respaldo
- Documentar cada incidente, duda, error
- Criterio exito: 0 aperturas de Wansoft, ningun incidente >5min, staff no pide regresar

## Adopcion (30 dias post-cutover)

- Revision diaria de incidentes
- Feedback diario del staff
- Tiempo de respuesta a bugs
- Reunion semanal con gerente
- Metricas de estabilidad y uso
- Lista de "que extranan de Wansoft?"
- Criterio exito: a las 2 semanas, nadie quiere regresar

---

# 7. Lecciones aprendidas

| # | Leccion | Origen | Fecha |
|---|---------|--------|-------|
| L1 | syncAll + startRetryLoop durante page unload pierde localStorage writes | BUG-005 debug | 2026-06-26 |
| L2 | RLS policies necesitan tanto anon como authenticated | Inventory movements 403 | 2026-06-26 |
| L3 | pos_inventory_movements tenia schema incompatible con codigo | Auditoria offline, 0 registros historicos | 2026-06-26 |
| L4 | localStorage.clear en logout destruye colas operativas | Sidebar.tsx destruia print queue | 2026-06-26 |
| L5 | Wansoft "precios" son promedios con descuentos incluidos, no precios de carta | Migration diff report | 2026-06-27 |
| L6 | Service Worker cache puede servir bundle viejo despues de deploy | Multiples deploys sin efecto hasta unregister SW | 2026-06-26 |
| L7 | Bridge sin autoarranque = primera comanda del dia no sale | Analisis print bridge | 2026-06-27 |
| L8 | No asumir causas de discrepancias de datos — verificar contra fuente fisica | Price mismatch analysis | 2026-06-27 |

---

# CHANGELOG

Solo decisiones, certificaciones, incidentes y cambios de estado.

| Fecha | Evento |
|-------|--------|
| 2026-06-26 | OFF-02 certificado E2E: offline sync funciona en produccion |
| 2026-06-26 | BUG-005 certificado: print queue con state machine time-based |
| 2026-06-26 | A3 certificado: audit queue con fallback a sync_queue |
| 2026-06-26 | COBRO-00 a COBRO-10 certificados: flujo completo de cobro |
| 2026-06-26 | Inventory movements: compatibility bridge (ingredient_id TEXT) activado en produccion |
| 2026-06-26 | RLS fix: policies para authenticated agregadas a pos_inventory_movements |
| 2026-06-26 | 7 zombie sync items resueltos (inventory movements acumulados) |
| 2026-06-26 | localStorage.clear reemplazado por clear selectivo en Sidebar logout |
| 2026-06-26 | startRetryLoop movido de enqueue a layout mount (fix localStorage race) |
| 2026-06-27 | Migration diff: 9 items P0 Price Mismatch detectados, pendientes verificacion |
| 2026-06-27 | Migration diff: 154 items en Wansoft no en Fullsite, causa pendiente |
| 2026-06-27 | Bridge: autoarranque NSSM definido como requisito de certificacion |
| 2026-06-27 | FULLSITE-OPERATIONS.md creado como fuente unica de verdad |
| 2026-06-27 | Framework de producto cerrado: evidencia > hipotesis, ejecucion > diseno |
