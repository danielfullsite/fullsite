# P0-4 — Offline Fase 5: Protocolo de Certificación Física (4h)

> **PROTOCOLO OFICIAL — v1.1 · propuesto 2026-08-26** *(v1.0 congelado el 2026-07-31)*  
> Todo restaurante nuevo debe superar exactamente esta prueba antes de considerarse listo para producción.  
> Cualquier cambio a este documento requiere incrementar la versión y aprobación explícita.

> ### Por qué cambia — v1.0 → v1.1
>
> **El punto ciego:** v1.0 hace 30 minutos de preflight **con WAN**, y desconecta el cable en
> T+00. Para entonces cada terminal ya está encendida, logueada y con caché caliente. El
> protocolo **nunca enciende una terminal sin internet**.
>
> Eso deja fuera el modo de falla que apareció en campo esta semana: **abrir el restaurante
> sin red**. Se encontró auditando código el 2026-08-26 y era doble —
>
> - el caché de credenciales duraba 8 h, y de la 1am a la 1pm van 12: **nadie entraba**;
> - guardaba **una sola credencial**, así que offline sólo entraba la última persona que se
>   había logueado con internet.
>
> Los dos están corregidos (#133), pero **corregido no es certificado**. Y corriendo v1.0 tal
> cual, la prueba habría salido verde sin tocar el caso: se certifica un restaurante que no
> puede abrir.
>
> **El cambio:** una **FASE 0** de 10 minutos que va *antes* del preflight, con las terminales
> apagadas y el cable ya desconectado. Cubre T-24 (login sin red, **dos** personas), T-25
> (plano de salón en arranque en frío, corregido en #128) y la apertura de una mesa concreta
> sin red (#110).
>
> No se toca nada más del protocolo. v1.0 sigue siendo válido de la PRE-FASE en adelante.
>
> **Requiere aprobación explícita para quedar congelado como v1.1.**

> **Propósito:** Certificación física E4. Sin código. Sin DevTools. Sin intervención técnica.  
> **Fuente canónica:** `docs/offline/RUNBOOK.md`  
> **Estado:** PENDING — esperando ejecución física en AMALAY

---

## Tabla de referencia rápida — Escenarios

| ID | Descripción | Tiempo esperado | Owner | Severidad si falla |
|---|---|---|---|---|
| **F5-00A–C** | **Arranque en frío sin WAN** *(v1.1 — va primero)* | **10 min** | **Operador** | **P0 — aborta la prueba** |
| PRE-01–07 | Preflight completo | 30 min | Técnico | P0 — aborta la prueba |
| T+00 | Desconexión WAN | 5 min | Técnico | P0 |
| F5-01 | Abrir turno | 2 min | Gerente | P1 |
| F5-02 | Login PIN ×3 terminales | 3 min | Operador | P0 |
| F5-03 | Abrir mesas simultáneas | 5 min | Operador | P0 |
| F5-04 | Agregar ítems | 5 min | Operador | P1 |
| F5-05 | Enviar a Cocina y Barra | 10 min | Operador | P0 |
| F5-06 | Agregar ítem post-envío | 5 min | Operador | P1 |
| F5-07 | Cancelar ítem | 3 min | Operador | P1 |
| F5-08 | Transferir mesa | 5 min | Operador | P1 |
| F5-09 | Unir mesas | 5 min | Operador | P2 |
| F5-10 | Pago efectivo | 3 min | Cajero | P0 |
| F5-11 | Pago tarjeta manual | 3 min | Cajero | P0 |
| F5-12 | Pago transferencia | 3 min | Cajero | P1 |
| F5-13 | Depósito de caja | 3 min | Gerente | P1 |
| F5-14 | Retiro de caja | 3 min | Gerente | P1 |
| F5-15 | Reiniciar PDV1 | 5 min | Técnico | P0 |
| F5-16 | Reiniciar KDS Cocina | 3 min | Técnico | P0 |
| F5-17 | Nueva orden post-reinicio | 5 min | Operador | P0 |
| F5-18 | Simular falla impresora | 5 min | Técnico | P0 |
| F5-19 | Recuperación impresora | 5 min | Técnico | P0 |
| F5-20 | Orden delivery | 10 min | Operador | P2 |
| F5-21 | Conteo de estado T+3h | 5 min | Observador | N/A — solo captura |
| F5-22 | GUARD-08 previo al cierre | 5 min | Gerente | P1 |
| F5-23 | Contar efectivo | 5 min | Cajero | P1 |
| F5-24 | Cierre de turno con PIN | 3 min | Gerente | P0 |
| F5-25 | Arqueo post-cierre | 5 min | Gerente | P0 |
| F5-26 | Restaurar WAN | 3 min | Técnico | P0 |
| F5-27 | Sync automático | 5 min | Observador | P0 |
| F5-28 | Replay completo | 10 min | Técnico | P0 |
| F5-29 | Cero duplicados | 5 min | Técnico | P0 |
| F5-30 | Comparación local vs Supabase | 5 min | Técnico | P0 |

> Tiempo total mínimo (sin buffer): ~165 min. La prueba se diseña para 240 min para absorber incidentes, flujo real de comensales y tiempos de recuperación.

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

## FASE 0 — Arranque en frío sin WAN *(nueva en v1.1)*

> **Va PRIMERO, antes del preflight.** Es la única parte del protocolo que se ejecuta con
> las terminales **apagadas y sin internet**, y por eso no puede ir después: cualquier paso
> con WAN deja el caché caliente y ya no se puede volver atrás sin repetir el día.
>
> **Duración: 10 min.** Si falla, se detiene todo — un restaurante que no puede abrir no
> necesita que le certifiquen el resto.

```
F5-00A — T-24 · Login sin red al abrir
  Precondición: terminales APAGADAS desde el cierre de anoche. Cable WAN YA desconectado.
  Registrar la hora del último login con internet:  ________
  Registrar la hora de esta prueba:                 ________
  Horas transcurridas: ________   (el TTL es 16 h — si pasaron más, se espera que falle)

  1. Encender PDV1 sin internet.
     ¿Carga el POS?                                  [ ] Sí  [ ] No
  2. Persona A teclea su PIN.
     ¿Entra?                                         [ ] Sí  [ ] No   Nombre: ________
  3. Persona B —distinta— teclea el suyo, misma terminal.
     ¿Entra?                                         [ ] Sí  [ ] No   Nombre: ________

  PASS sólo si entran LAS DOS. Que entre una sola es el bug de #133 sin arreglar.

F5-00B — T-25 · Plano de salón en arranque en frío
  4. Con PDV1 ya adentro y sin internet, abrir la vista de mesas.
     ¿Sale el plano REAL de AMALAY, con sus mesas y posiciones?   [ ] Sí  [ ] No
     ¿O sale un plano genérico / vacío?                            [ ] Sí  [ ] No

  PASS sólo si es el plano real. Se corrigió en #128 y nunca se validó en campo.

F5-00C — Apertura de mesa sin red
  5. Tocar una mesa concreta y distinta de la 1 — por ejemplo la 52.
     ¿Abre ESA mesa, o cae a la mesa 1?              [ ] la correcta  [ ] cayó a la 1

  Este handler cambió de técnica tres veces (window.location.href → router.push → revert
  → sessionStorage en #110). El test fija el método; que abra la mesa correcta sin red
  sólo se comprueba tocándola.
```

**Si F5-00 pasa completo**, reconectar la WAN y continuar con el preflight de abajo. Si algo
falla, anotarlo y **detener** — ver [BUGS — si aparece uno durante la prueba](#bugs--si-aparece-uno-durante-la-prueba).

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

## MÉTRICAS DE RECURSOS

Capturar en cuatro snapshots: T+30, T+90, T+180, T+240 (post-sync).  
En Caja: Task Manager Windows → proceso Electron. En browser: OfflineIndicator visual.  
Bridge: GET http://192.168.1.71:7717/health.

| Snapshot | Hora | CPU Electron % | RAM Electron MB | Bridge sync_queue | Bridge print_queue | IDB Caja | IDB PDV1 | IDB PDV2 | Notas |
|---|---|---|---|---|---|---|---|---|---|
| T+30  | | | | | | | | | |
| T+90  | | | | | | | | | |
| T+180 | | | | | | | | | |
| T+240 | | | | | | | | | |

**Umbrales de alerta** (no son gates automáticos, requieren investigación si se superan):

| Métrica | Umbral de alerta |
|---|---|
| CPU Electron | > 80% sostenido ≥ 5 min |
| RAM Electron | > 800 MB |
| Bridge sync_queue | > 50 items acumulados |
| Bridge print_queue | > 5 items pendientes |
| IDB sync_queue cualquier terminal | > 30 items acumulados |

---

## GATES — La fase falla automáticamente si:

- [ ] Se perdió una orden (no aparece en Supabase después del Replay) · **P0**
- [ ] Una orden quedó duplicada en Supabase · **P0**
- [ ] KDS o Barra no recibieron una comanda enviada (sin falla de hardware) · **P0**
- [ ] Una impresión se perdió sin quedar en cola de retry · **P0**
- [ ] Un pago o movimiento de caja quedó duplicado · **P0**
- [ ] El cierre de turno tiene inconsistencia en el arqueo · **P0**
- [ ] El Replay quedó incompleto (operaciones faltantes) · **P0**
- [ ] Conflicto de concurrencia silencioso (dos terminales con datos divergentes) · **P0**
- [ ] Se abrió DevTools para continuar operando · **P0 — invalida la sesión**
- [ ] Se editó JSON, SQL, IP o variable durante la prueba · **P0 — invalida la sesión**
- [ ] Intervención técnica fue necesaria para que el sistema continuara · **P0**
- [ ] CPU > 80% sostenido ≥ 5 min sin recuperación · **P1**
- [ ] RAM > 800 MB sin recuperación tras reinicio · **P1**

Si un gate P0 falla → registrar en incidente, capturar evidencia, detener solo ese caso, corregir, re-ejecutar ese caso.  
Si fallan ≥2 gates P0 distintos → la prueba se clasifica FAIL y debe re-ejecutarse completa.

---

## OFFLINE RELIABILITY SCORE (ORS)

Calcular al terminar T+240, antes del veredicto.

### Fórmula

| Componente | Pts máx | Cálculo |
|---|---|---|
| **Integridad de datos** | 40 | 40 − (20 × pérdidas_de_orden) − (20 × duplicados). Mín 0. |
| **Continuidad operativa** | 30 | 30 − (5 × intervenciones_humanas) − (10 × incidentes_P0_no_recuperados). Mín 0. |
| **Velocidad de recuperación** | 20 | Sync ≤ 60s: +10 / ≤ 120s: +5 / >120s: +0. Impresora auto: +5 / manual: +2. POS reinicia ≤ 30s: +5 / >30s: +2. |
| **Paridad multi-terminal** | 10 | Los 3 POS sin divergencia: +10. 1 con divergencia recuperada: +5. 2+: +0. |
| **TOTAL** | **100** | |

### Tabla de cálculo ORS

```
INTEGRIDAD DE DATOS                              pts
  Pérdidas de orden:       __ × −20 =         ____
  Duplicados:              __ × −20 =         ____
  Subtotal (máx 40, mín 0):                   ____

CONTINUIDAD OPERATIVA
  Intervenciones humanas:  __ × −5  =         ____
  Incidentes P0 sin recuperación: __ × −10 = ____
  Subtotal (base 30, mín 0):                  ____

VELOCIDAD DE RECUPERACIÓN
  Sync tras WAN restore (______s):            ____
  Recuperación impresora (auto/manual):        ____
  Reinicio POS en ___s:                        ____
  Subtotal:                                    ____

PARIDAD MULTI-TERMINAL
  Divergencias observadas: __
  Subtotal:                                    ____

ORS TOTAL:                                     ____/100
```

### Umbrales de veredicto

| ORS | Veredicto |
|---|---|
| ≥ 80 | **PASS** — apto para producción |
| 70–79 | **PARTIAL** — blockers documentados, puede ir a producción con mitigaciones |
| < 70 | **FAIL** — re-ejecutar Fase 5 completa |

---

## FORMATO DE CIERRE (llenar al terminar T+240)

```
P0-4 — Offline Fase 5
Estado: PASS / PARTIAL / FAIL
ORS: ____/100
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
Métricas de recursos:
  CPU pico Electron: ______%  RAM pico: ______MB
  Bridge queue pico: ______  IDB queue pico (Caja): ______
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

> **PROTOCOLO OFICIAL CONGELADO — v1.0 · 2026-07-31**  
> Este documento es el estándar de certificación offline para todos los restaurantes de Fullsite.  
> No se modifica sin incrementar la versión. Llevar impreso o en tablet secundaria durante la prueba.
