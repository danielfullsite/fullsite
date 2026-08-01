# P0-4 — Offline Fase 5: Plan de Ejecución Física (4h)

> **Propósito:** Certificación física E4. Sin código. Sin DevTools. Sin intervención técnica.  
> **Fuente canónica:** `docs/offline/RUNBOOK.md`  
> **Estado:** PENDING — esperando ejecución física en AMALAY

---

## Hardware mínimo requerido

| Dispositivo | IP | Rol |
|---|---|---|
| Caja | 192.168.1.71 | POS principal + Local Server + Bridge + impresora caja |
| PDV1 | 192.168.1.68 | POS secundario |
| PDV2 | 192.168.1.4 ó .69 | POS terciario |
| KDS Cocina | (confirmar IP) | KDS cocina |
| KDS Barra | (confirmar IP) | KDS barra |
| Router | — | Acceso a cable WAN para desconexión |
| Impresora cocina | — | Conectada al bridge |
| Cajón | — | Puerto RJ-11 Caja |

---

## PRE-FASE — Checklist (30 min antes de desconectar WAN)

Ejecutar con WAN activa. No marcar nada como PASS hasta observarlo en pantalla.

```
PRE-01 — Versiones instaladas
  Caja:  commit ________  versión Electron ________
  PDV1:  commit ________  versión app ________
  PDV2:  commit ________  versión app ________
  KDS Cocina: URL cargada ________
  KDS Barra:  URL cargada ________

PRE-02 — Local Server
  GET http://127.0.0.1:7717/health desde Caja → responde:  [ ] Sí  [ ] No
  GET http://192.168.1.71:7717/health desde PDV1 → responde: [ ] Sí  [ ] No
  GET http://192.168.1.71:7717/health desde PDV2 → responde: [ ] Sí  [ ] No
  supabase_reachable: ________
  sync_queue_size: ________

PRE-03 — Turno limpio
  ¿Hay turno activo en Caja?  [ ] Sí → cerrar antes  [ ] No → OK
  Estado inicial: sin turno activo / turno cerrado

PRE-04 — Estado inicial Supabase
  pos_orders activos: ________  (SELECT count(*) WHERE status NOT IN ('cobrada','cancelada'))
  pos_cierres último ID: ________
  pos_turnos último ID: ________
  sync_queue en IDB de Caja (OfflineIndicator): ________

PRE-05 — Colas iniciales
  Browser IDB sync_queue (Caja): ________ pendientes
  Browser IDB sync_queue (PDV1): ________ pendientes
  Bridge EventStore sync_queue_size: ________
  [ ] Todas las colas en 0 antes de iniciar — requisito previo

PRE-06 — IDs de prueba
  Prefijo de referencia para esta sesión: F5-YYYY-MM-DD
  (registrar Order IDs reales aquí durante la prueba)

PRE-07 — Restauración de WAN
  Método de desconexión: [ ] Cable WAN del router  [ ] Firewall Windows
  Responsable de restaurar WAN: ________
  ¿Puede restaurar sin cambiar configuración?  [ ] Sí confirmado
```

---

## SECUENCIA DE EJECUCIÓN

### T+00 — Desconexión de WAN

```
ACCIÓN:
  Desconectar cable WAN del router (puerto Internet/WAN).
  Hora exacta de desconexión: ________________

VERIFICAR en los siguientes 60 segundos:
  ping 192.168.1.68 desde Caja → [ ] Responde (LAN OK)
  ping 192.168.1.71 desde PDV1 → [ ] Responde (LAN OK)
  ping 8.8.8.8 desde Caja      → [ ] No responde (WAN cortada)
  GET http://192.168.1.71:7717/health → supabase_reachable: [ ] false

CAPTURA OBLIGATORIA:
  Screenshot de cada terminal mostrando el OfflineIndicator o indicador de modo offline.

GATE:
  Si LAN no responde → DETENER. Verificar router. No iniciar Fase 5.
```

---

### T+05 — T+30: Operación básica multi-terminal

```
F5-01 — Abrir turno (desde Caja)
  Quién abre: ________  Fondo inicial: $________
  Turno ID: ________
  [ ] Turno visible en Caja  [ ] Turno persiste en IDB  
  [ ] PDF1 ve turno activo   [ ] PDV2 ve turno activo
  Estado: PASS / FAIL

F5-02 — Login con PIN offline (los tres POS)
  Caja:  PIN de ________  → acepta en ___s  [ ] PASS  [ ] FAIL
  PDV1:  PIN de ________  → acepta en ___s  [ ] PASS  [ ] FAIL
  PDV2:  PIN de ________  → acepta en ___s  [ ] PASS  [ ] FAIL

F5-03 — Abrir mesas simultáneamente (3 POS al mismo tiempo)
  Caja abre mesa ____  Order ID: ________________
  PDV1 abre mesa ____  Order ID: ________________
  PDV2 abre mesa ____  Order ID: ________________
  [ ] Sin conflicto visible  [ ] Mesas distintas en mapa
  Estado: PASS / FAIL

F5-04 — Agregar ítems (≥3 productos por mesa, de categorías distintas)
  Mesa ____ (Caja):  ________  +  ________  +  ________  Total: $________
  Mesa ____ (PDV1):  ________  +  ________  +  ________  Total: $________
  Mesa ____ (PDV2):  ________  +  ________  +  ________  Total: $________
  Estado: PASS / FAIL

F5-05 — Enviar a Cocina y Barra (desde los 3 POS)
  Envío desde Caja:
    Hora: ________  Order ID: ________
    → KDS Cocina recibe en ___s: [ ] PASS / [ ] FAIL
    → KDS Barra recibe en ___s:  [ ] PASS / [ ] FAIL
    → Impresora cocina imprime:  [ ] PASS / [ ] FAIL
  Envío desde PDV1:
    Hora: ________  Order ID: ________
    → KDS Cocina recibe en ___s: [ ] PASS / [ ] FAIL
    → KDS Barra recibe en ___s:  [ ] PASS / [ ] FAIL
    → Impresora cocina imprime:  [ ] PASS / [ ] FAIL
  Envío desde PDV2:
    Hora: ________  Order ID: ________
    → KDS Cocina recibe en ___s: [ ] PASS / [ ] FAIL
    → KDS Barra recibe en ___s:  [ ] PASS / [ ] FAIL
    → Impresora cocina imprime:  [ ] PASS / [ ] FAIL
```

---

### T+30 — T+60: Modificaciones de orden y estructura

```
F5-06 — Agregar ítem a orden ya enviada
  Mesa: ____  Order ID: ________________
  Ítem agregado: ________
  [ ] Orden acepta ítem post-envío
  → KDS Cocina muestra adición: [ ] PASS  [ ] FAIL
  → Impresora imprime batch:     [ ] PASS  [ ] FAIL  [ ] N/A
  Estado: PASS / FAIL

F5-07 — Cancelar ítem
  Mesa: ____  Order ID: ________________
  Ítem cancelado: ________
  [ ] Cancelación aceptada  [ ] Total actualizado
  → KDS refleja baja: [ ] PASS  [ ] FAIL
  Estado: PASS / FAIL

F5-08 — Transferir mesa
  De mesa: ____  A mesa: ____  Order ID origen: ________________
  [ ] Order ID conservado o nuevo ID registrado: ________________
  [ ] PDV receptor ve la orden
  [ ] KDS no duplica la orden
  Estado: PASS / FAIL

F5-09 — Unir mesas (si disponible)
  Mesa A: ____  Mesa B: ____
  Order ID resultante: ________________
  [ ] Ítems de ambas mesas en la orden unida
  [ ] KDS muestra orden unificada sin duplicar ítems
  Estado: PASS / FAIL  [ ] GAP (no implementado)
```

---

### T+60 — T+90: Pagos y movimientos de caja

```
F5-10 — Pago en efectivo offline
  Mesa: ____  Order ID: ________________  Total: $________
  [ ] Pago aceptado  [ ] Ticket impreso  [ ] Cajón abre  [ ] Orden → cobrada
  Estado: PASS / FAIL

F5-11 — Pago en tarjeta offline (manual, sin terminal)
  Mesa: ____  Order ID: ________________  Total: $________
  [ ] Pago aceptado como tarjeta manual
  [ ] Ticket impreso  [ ] Orden → cobrada
  Estado: PASS / FAIL

F5-12 — Pago en transferencia offline
  Mesa: ____  Order ID: ________________  Total: $________
  [ ] Pago aceptado  [ ] Orden → cobrada
  Estado: PASS / FAIL

F5-13 — Depósito de caja
  Monto: $________  Motivo: ________________
  [ ] Movimiento registrado en IDB
  [ ] OfflineIndicator incrementa  o  sync_queue sube
  Estado: PASS / FAIL

F5-14 — Retiro de caja
  Monto: $________  Motivo: ________________
  [ ] Movimiento registrado en IDB
  Estado: PASS / FAIL
```

---

### T+90 — T+120: Reinicio de terminales

```
F5-15 — Reiniciar POS (PDV1)
  Hora de reinicio: ________
  ANTES: órdenes activas en PDV1: ____  sync_queue PDV1: ____
  
  Cerrar app / recargar browser → esperar carga completa.
  
  DESPUÉS (≤30s):
  [ ] PDV1 carga sin internet
  [ ] Mesas ocupadas visibles  [ ] Órdenes IDB recuperadas
  [ ] Login con PIN funciona
  [ ] PDV1 puede tomar nueva orden
  Tiempo de recuperación: ____s
  Estado: PASS / FAIL

F5-16 — Reiniciar KDS Cocina
  Hora de reinicio: ________
  
  Recargar browser del KDS Cocina (F5 o reload).
  
  DESPUÉS (≤15s):
  [ ] KDS Cocina carga
  [ ] Órdenes activas visibles sin reload manual
  [ ] Nuevas órdenes llegan normalmente
  Tiempo de recuperación: ____s
  Estado: PASS / FAIL

F5-17 — Nueva orden post-reinicio (PDV1 → KDS Cocina)
  Enviar desde PDV1 recién reiniciado.
  Order ID: ________________
  [ ] KDS Cocina recibe  [ ] Impresora cocina imprime
  Estado: PASS / FAIL
```

---

### T+120 — T+150: Falla y recuperación de impresora

```
F5-18 — Simular falla de impresora cocina
  Hora de desconexión impresora: ________
  
  Enviar comanda con impresora desconectada.
  Order ID: ________________
  
  [ ] La orden se envía correctamente al KDS (sin bloquear el POS)
  [ ] Bridge detecta fallo de impresión
  [ ] Print job queda en cola de retry (visible en /health → print_queue)
  [ ] OfflineIndicator o algún indicador muestra reintento pendiente
  print_queue en /health: ________
  Estado: PASS / FAIL

F5-19 — Recuperación de impresora
  Hora de reconexión impresora: ________
  
  [ ] Bridge reintenta impresión automáticamente
  [ ] Ticket imprime sin acción manual
  Tiempo hasta impresión automática: ____s
  Estado: PASS / FAIL  [ ] FAIL (requirió acción manual — documentar)
```

---

### T+150 — T+180: Delivery (condicional)

```
F5-20 — Orden de delivery (si entorno disponible)
  Plataforma: [ ] Ubereats  [ ] Rappi  [ ] N/A (entorno no disponible)
  
  Si disponible:
  Order ID delivery: ________________
  [ ] Aparece en KDS Barra  [ ] Aparece en KDS Cocina (si aplica)
  [ ] POS puede marcarla como entregada
  Estado: PASS / FAIL / N/A
```

---

### T+180 — T+210: Operación continua y conteos intermedios

```
F5-21 — Conteo de estado a T+3h
  Hora: ________
  
  Órdenes procesadas hasta ahora:
    Abiertas activas: ________
    Cobradas: ________
    Canceladas: ________
  
  Pagos registrados:
    Efectivo: $________  (__ transacciones)
    Tarjeta:  $________  (__ transacciones)
    Transfer: $________  (__ transacciones)
  
  Movimientos de caja:
    Depósitos: $________  (__ movimientos)
    Retiros:   $________  (__ movimientos)
  
  Comandas enviadas:
    Cocina: __ comandas  Barra: __ comandas
  
  Impresiones:
    Comandas: __  Tickets: __  Fallidas/en cola: __
  
  Cola IDB sync_queue (Caja): ________
  Cola IDB sync_queue (PDV1): ________
  Cola IDB sync_queue (PDV2): ________
  Bridge sync_queue_size: ________
  
  Reinicios hasta ahora: __ (detalle en log)
  Incidentes hasta ahora: __ (detalle en log)
```

---

### T+210 — T+225: Cierre de turno offline

```
F5-22 — GUARD-08 previo al cierre
  ¿Hay órdenes abiertas al intentar cerrar?  [ ] Sí  [ ] No
  Si Sí:
    [ ] Wizard muestra lista de órdenes abiertas
    [ ] Option A disponible (volver al POS)
    [ ] Option B disponible (escalación gerente)
    Acción tomada: [ ] Cerrar órdenes primero  [ ] Escalación autorizada
    Si escalación: PIN gerente verificado: [ ] Sí  nota escrita: [ ] Sí
  Estado GUARD-08: PASS / FAIL

F5-23 — Contar efectivo en caja
  Efectivo contado: $________
  Sistema espera:   $________
  Diferencia:       $________
  Estado: PASS (diferencia explicable) / FAIL (diferencia sin explicación)

F5-24 — Cierre de turno con PIN
  PIN gerente:  ________
  [ ] Wizard completa sin error  [ ] onComplete() dispara
  [ ] Turno cerrado en IDB  [ ] En sync_queue para Supabase
  Estado: PASS / FAIL

F5-25 — Arqueo post-cierre
  Total ventas sistema: $________
  Total ventas contadas: $________
  Tickets cerrados: ________  cancelaciones: ________
  Diferencia final: $________
  Estado: PASS / FAIL
```

---

### T+225 — T+240: Restaurar WAN + Replay

```
F5-26 — Restaurar WAN
  Hora de reconexión: ________
  
  Verificar en 60s:
  ping 8.8.8.8 → [ ] Responde
  bridge /health supabase_reachable → [ ] true

F5-27 — Sync automático
  ¿OfflineIndicator en Caja baja a 0?  [ ] Sí en ____s  [ ] No
  ¿OfflineIndicator en PDV1 baja a 0? [ ] Sí en ____s  [ ] No
  ¿OfflineIndicator en PDV2 baja a 0? [ ] Sí en ____s  [ ] No
  Bridge sync_queue_size → 0: [ ] Sí en ____s  [ ] No
  
  Tiempo total de sync desde reconexión: ____s
  Estado: PASS / FAIL

F5-28 — Replay completo
  Hora inicio Replay: ________
  
  Navegando a /pos/replay o la URL equivalente:
  [ ] Replay lista todas las operaciones de la sesión
  
  VERIFICAR cada tipo de operación:
  [ ] Órdenes creadas → en Supabase pos_orders  cantidad: ____
  [ ] Órdenes cobradas → status cobrada en Supabase  cantidad: ____
  [ ] Cancelaciones → en Supabase  cantidad: ____
  [ ] Movimientos de caja → en Supabase pos_cash_movements  cantidad: ____
  [ ] Cierre de turno → en Supabase pos_cierres  cantidad: 1
  [ ] Turno → closed_at no null en pos_turnos  [ ] Sí
  
  Hora fin Replay: ________
  Duración Replay: ____s
  Estado: PASS / FAIL

F5-29 — Cero duplicados
  Verificar en Supabase:
  SELECT id, count(*) FROM pos_orders GROUP BY id HAVING count(*) > 1
  → Resultado: ________ (debe ser vacío)
  
  SELECT turno_id, count(*) FROM pos_cierres 
  WHERE turno_id = '[turno de la prueba]' GROUP BY turno_id
  → Resultado: ________ (debe ser 1)
  
  Pagos duplicados:
  SELECT order_id, count(*) FROM pos_orders 
  WHERE status='cobrada' AND turno_id = '[turno]' GROUP BY order_id HAVING count(*)>1
  → Resultado: ________ (debe ser vacío)
  
  Estado: PASS / FAIL

F5-30 — Comparación estado final local vs Supabase
  Órdenes en IDB (Caja): ________  vs  Supabase pos_orders con turno: ________
  Diff explicado: ________
  Movimientos IDB: ________  vs  Supabase pos_cash_movements: ________
  Arqueo local: $________  vs  Supabase pos_cierres.total_ventas: $________
  Estado: PASS / FAIL  Diff no explicado: ________
```

---

## LOG DE EVIDENCIA EN TIEMPO REAL

Llenar durante la prueba. Una fila por evento significativo.

| Hora | Dispositivo | Acción | Order ID / Op ID | Estado local | KDS Cocina | KDS Barra | Impresión | Queue | Resultado | Incidente | Recuperación |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

**Incidentes** — detalle completo:

```
INCIDENTE #1
  Hora: ________
  Dispositivo: ________
  Descripción: ________
  Severidad: P0 / P1 / P2 / P3
  Se detuvo la prueba: [ ] Sí → ¿cuánto tiempo? ____  [ ] No
  Fix aplicado: ________
  Commit del fix: ________
  Tests corridos: ________
  Caso repetido físicamente: [ ] Sí → resultado: ________  [ ] No
  Recuperación: [ ] Automática  [ ] Manual — descripción: ________
```

---

## GATES — La fase falla automáticamente si:

- [ ] Se perdió una orden (no aparece en Supabase después del Replay)
- [ ] Una orden quedó duplicada en Supabase
- [ ] KDS o Barra no recibieron una comanda enviada (sin falla de hardware)
- [ ] Una impresión se perdió sin quedar en cola de retry
- [ ] Un pago o movimiento de caja quedó duplicado
- [ ] El cierre de turno tiene inconsistencia en el arqueo
- [ ] El Replay quedó incompleto (operaciones faltantes)
- [ ] Conflicto de concurrencia silencioso (dos terminales con datos divergentes)
- [ ] Se abrió DevTools para continuar operando
- [ ] Se editó JSON, SQL, IP o variable durante la prueba
- [ ] Intervención técnica fue necesaria para que el sistema continuara

Si algún gate falla → registrar en incidente, capturar evidencia, detener solo ese caso, corregir, re-ejecutar ese caso.

---

## FORMATO DE CIERRE (llenar al terminar T+240)

```
P0-4 — Offline Fase 5
Estado: PASS / PARTIAL / FAIL
Duración real:
Hardware:
  Caja: commit ______  Electron ______
  PDV1/PDV2: commit ______  App URL ______
  KDS Cocina / KDS Barra
Versiones:
Órdenes procesadas:
Pagos:
  Efectivo: $______  Tarjeta: $______  Transferencia: $______
Movimientos de caja:
  Depósitos: ______  Retiros: ______
Comandas Cocina:
Comandas Barra:
Impresiones:
  Correctas: ______  Fallidas recuperadas: ______  Perdidas: ______
Reinicios:
  POS: ______  KDS: ______
Incidentes:
Recuperaciones automáticas:
Intervenciones humanas:
Duplicados:
Pérdida de datos:
Replay:
  Duración: ______s  Operaciones sync: ______  Faltantes: ______
Estado final Supabase:
  pos_orders con turno: ______  Diff vs local: ______
  pos_cierres: ______
  pos_cash_movements: ______
Gaps encontrados:
Commits (fixes durante la prueba):
Docs actualizados:
Veredicto:
```

---

## BUGS — si aparece uno durante la prueba

1. Capturar screenshot y descripción exacta
2. Registrar en `docs/state/BUGS.md` con ID `OFC-XX`
3. Clasificar: P0 (detiene la prueba) / P1 / P2 / P3
4. Corregir → `npx vitest run` → 0 regresiones
5. Repetir el caso físico
6. No declarar PASS en ese caso hasta que pase físico

---

> Documento listo para ejecución. No hay nada que revisar antes de llevar hardware.  
> Llevar impreso o en tablet secundaria durante la prueba.
