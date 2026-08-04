# OCS P2.5.9 — Offline / Sync: Plan de Certificación Física

> **Status:** PENDIENTE EJECUCIÓN FÍSICA
>
> **NOTA 2026-08-04 — OC-09 INTEGRADO:** `pos-manager-auth.ts` (PBKDF2) ahora conectado al production path en `pos-data.ts`. Las tres funciones `verifyManagerPin`, `verifyManagerPinWithRole`, `verifyPinWithMinRole` usan PBKDF2 offline; fallback a btoa legacy para migración. 23 tests en `pos-manager-auth.test.ts` PASS. OC-09 listo para ejecución física.  
> **Suite:** Operational Certification Suite v1  
> **Módulo:** Offline / Sync — E4 campo en AMALAY  
> **Bloquea:** P0-4 · Golden Skeleton · Cliente #2  
> **Prerrequisitos:** P2.5.4–P2.5.8 CERTIFIED ✓ · Código verificado ✓

---

## Estado actual del módulo

| Capa | Estado | Evidencia |
|---|---|---|
| IDB schema v4 (orders, cash_movements, sync_queue) | CODE ONLY | commits `447a777`, `2edcca1` |
| Offline queue (`queueOperation`, `APP_API`) | CODE ONLY | `pos-offline-db.ts` |
| Registro auto-sync al reconectar | CODE ONLY | `registerAutoSync()` |
| Print queue con retry loop | CODE ONLY | `startRetryLoop()` |
| Auth offline — Manager PIN | ✅ CODE VERIFIED | PBKDF2 activo (commit fc5ffb1): `provisionManagerCredential` en online auth, `verifyPinOffline` como primer path offline, btoa legacy DEPRECATED como fallback transitorio (telemetría: `pos_btoa_fallback_count`). TTL 24h. 18+13=31 tests PASS. Pendiente: ejecución física OC-09 (FIELD VERIFIED). |
| Auth offline — Staff Login (lockscreen) | ⚠️ DEUDA SEPARADA | `layout.tsx` usa `SHA-256(pin:staffId)` + `pos_staff_cache`. TTL 8h. No usa PBKDF2. **Fuera de scope de OC-09 en este PR.** Fix programado como workstream independiente. |
| Menú offline (IDB cache) | PASS (código) | `pos-offline-db.ts` |
| KDS broadcast LAN (127.0.0.1:7717) | CODE ONLY | `page.tsx:2973` |
| MP recovery en reload | CODE ONLY | `mp-payment-recovery.ts` |
| OC-01 a OC-08, OC-11, OC-12 | **PENDING FIELD** | Este documento |

**Lo único que falta es ejecutar la prueba física.**

---

## Preflight — antes de salir a AMALAY

Completar en orden. No iniciar la prueba si algún ítem está incompleto.

| # | Verificación | Responsable | OK |
|---|---|---|---|
| PRE-01 | App instalada en los 3 POS (versión del mismo commit) | Daniel | ☐ |
| PRE-02 | KDS instalado y visible en pantalla cocina | Daniel | ☐ |
| PRE-03 | Impresora cocina conectada y respondiendo | Daniel | ☐ |
| PRE-04 | Impresora barra conectada y respondiendo | Daniel | ☐ |
| PRE-05 | Turno previo cerrado (sin turno abierto en BD) | Daniel | ☐ |
| PRE-06 | Queue offline vacía en los 3 POS (`localStorage.getItem('sync_queue')` = null o `[]`) | Daniel | ☐ |
| PRE-07 | MP Point desconectado (prueba no usa MP) | Daniel | ☐ |
| PRE-08 | Versión y commit anotados para todos los dispositivos | Daniel | ☐ |
| PRE-09 | Supabase con internet — verificar que tabla `pos_orders` es accesible | Daniel | ☐ |
| PRE-10 | Router / switch LAN disponible y funcional independiente del WAN | Daniel | ☐ |
| PRE-11 | Cronómetro listo para medir tiempo de reconexión (OC-12) | Daniel | ☐ |
| PRE-12 | Este documento abierto en dispositivo separado para captura | Daniel | ☐ |

**Versiones a registrar antes de iniciar:**

```
POS-1 (caja):       commit __________ · versión __________
POS-2 (mesero 1):   commit __________ · versión __________
POS-3 (mesero 2):   commit __________ · versión __________
KDS (cocina):       commit __________ · versión __________
KDS (barra):        commit __________ · versión __________
Electron bridge:    versión __________
```

---

## Checklist ejecutable — secuencia de prueba

Duración estimada: **90–120 minutos**. Ejecutar en un solo bloque sin interrupciones.

### FASE A — Línea base online (10 min)

| ID | Acción | Dispositivo | Evidencia requerida | OK |
|---|---|---|---|---|
| A-01 | Abrir turno | POS-1 | Turno visible en BD | ☐ |
| A-02 | Tomar orden mesa 1 (3 platillos) + enviar a cocina | POS-2 | Comanda en KDS cocina | ☐ |
| A-03 | Tomar orden mesa 2 (2 bebidas) + enviar a barra | POS-3 | Comanda en KDS barra | ☐ |
| A-04 | Cobrar mesa 1 en efectivo | POS-2 | Ticket impreso, cajón abierto | ☐ |
| A-05 | Verificar en Supabase: 2 órdenes + 1 cobro | Supabase | `pos_orders` con 2 registros | ☐ |

**Estado Supabase al cerrar Fase A:**
```
Órdenes en BD: ____  Cobros: ____  Queue: vacía ✓/✗
```

---

### FASE B — Desconexión WAN (30 min)

**Acción: desconectar cable WAN del router (LAN permanece activa).**

| ID | Acción | Dispositivo | Evidencia requerida | OK |
|---|---|---|---|---|
| B-01 | Verificar indicador offline visible en los 3 POS | POS-1/2/3 | Banner/icono offline visible | ☐ |
| B-02 | Tomar orden mesa 3 (4 platillos cocina) | POS-2 | Toast "guardada localmente" | ☐ |
| B-03 | Verificar comanda llegó a KDS cocina vía LAN | KDS cocina | Orden visible sin internet | ☐ |
| B-04 | Tomar orden mesa 4 (3 bebidas barra) | POS-3 | Toast "guardada localmente" | ☐ |
| B-05 | Verificar comanda llegó a KDS barra vía LAN | KDS barra | Orden visible sin internet | ☐ |
| B-06 | Modificar mesa 3 (agregar 1 platillo) + reenviar | POS-2 | Toast "guardada localmente" | ☐ |
| B-07 | Cancelar 1 ítem de mesa 4 con PIN gerente | POS-3 | PIN solicitado, ítem cancelado | ☐ |
| B-08 | Cobrar mesa 3 en efectivo | POS-2 | Ticket impreso, cajón abierto | ☐ |
| B-09 | Cobrar mesa 4 en transferencia | POS-3 | Ticket impreso | ☐ |
| B-10 | Movimiento de caja: retiro $500 con PIN gerente | POS-1 | Toast "guardado localmente" | ☐ |
| B-11 | Tomar orden mesa 5 + enviar | POS-1 | Comanda en KDS, toast "guardada" | ☐ |
| B-12 | **Apagar impresora cocina** | Física | Impresora apagada | ☐ |
| B-13 | Tomar orden mesa 6 + enviar (impresora apagada) | POS-2 | KDS recibe; toast impresora falla | ☐ |
| B-14 | Verificar cola de reimpresión activa | POS-2 | `pos_print_queue` en localStorage | ☐ |
| B-15 | **Encender impresora cocina** | Física | Impresora activa | ☐ |
| B-16 | Esperar retry automático (max 60s) | POS-2 | Comanda impresa sin acción manual | ☐ |
| B-17 | **Reiniciar KDS cocina** | KDS cocina | App cierra y reabre | ☐ |
| B-18 | Verificar que órdenes pendientes siguen visibles en KDS | KDS cocina | Mesa 5 y 6 presentes | ☐ |
| B-19 | **Reiniciar POS-3** (Electron o browser reload) | POS-3 | App cierra y reabre | ☐ |
| B-20 | Verificar que mesa 4 ya no aparece (cobrada) | POS-3 | Mesa 4 sin orden abierta | ☐ |
| B-21 | Verificar que queue tiene los registros esperados | POS-1/2/3 | Anotar count abajo | ☐ |

**Queue snapshot pre-reconexión:**
```
POS-1 pending: ____  POS-2 pending: ____  POS-3 pending: ____
Operations: (listar tipo y order_id de cada una)
_________________________________________________________________
_________________________________________________________________
```

---

### FASE C — Reconexión WAN (10 min)

**Acción: reconectar cable WAN. Iniciar cronómetro.**

| ID | Acción | Dispositivo | Evidencia requerida | OK |
|---|---|---|---|---|
| C-01 | Verificar indicador online en los 3 POS | POS-1/2/3 | Banner/icono desaparece o cambia | ☐ |
| C-02 | Verificar que sync inicia automáticamente (sin acción manual) | POS-1/2/3 | Toast o indicador de sync | ☐ |
| C-03 | **Detener cronómetro cuando queue = 0** | — | Tiempo total de sync: ____s | ☐ |
| C-04 | Verificar en Supabase: todas las órdenes offline presentes | Supabase | Count coincide con anotar abajo | ☐ |
| C-05 | Verificar CERO duplicados (search por order_id) | Supabase | No hay filas con mismo order_id x2 | ☐ |
| C-06 | Verificar movimiento de caja ($500 retiro) en BD | Supabase | `pos_cash_movements` tiene el retiro | ☐ |
| C-07 | Verificar cobros offline registrados correctamente | Supabase | 2 cobros (mesa 3 efectivo, mesa 4 transferencia) | ☐ |
| C-08 | Verificar OC-12: tiempo total ≤ 30 segundos | Cronómetro | Tiempo: ____s — PASS/FAIL | ☐ |

**Estado Supabase post-sync:**
```
Órdenes totales en BD: ____  (esperado: A-05 baseline + mesas 3,4,5,6,  =~7)
Cobros totales: ____  (esperado: 3 = mesa 1 online + mesas 3 y 4 offline)
Duplicados: ____  (esperado: 0)
Movimientos de caja: ____  (esperado: 1 retiro $500)
Tiempo sync: ____s  (esperado: ≤ 30s)
```

---

### FASE D — Reconciliación y cierre (20 min)

| ID | Acción | Dispositivo | Evidencia requerida | OK |
|---|---|---|---|---|
| D-01 | Cobrar mesa 5 online (tarjeta manual) | POS-1 | Ticket impreso, registro en BD | ☐ |
| D-02 | Cobrar mesa 6 online (efectivo) | POS-2 | Ticket impreso, cajón abierto | ☐ |
| D-03 | Abrir corte Z (Caja → Corte) | POS-1 | Totales visibles en pantalla | ☐ |
| D-04 | Verificar totales corte vs suma manual | POS-1 | Efectivo: ____  Tarjeta: ____  Trans: ____ | ☐ |
| D-05 | Cerrar turno | POS-1 | Toast cierre OK, turno cerrado en BD | ☐ |
| D-06 | Verificar que cierre refleja ventas offline | Supabase | `pos_turnos.total_ventas` coincide | ☐ |
| D-07 | Verificar print queue vacía en todos los POS | POS-1/2/3 | 0 jobs pendientes | ☐ |
| D-08 | Verificar sync queue vacía en todos los POS | POS-1/2/3 | 0 ops pendientes | ☐ |

---

## Captura de evidencia — formato por caso

Para cada incidente o hallazgo durante la prueba, llenar:

| Campo | Valor |
|---|---|
| **ID** | INC-001 (incrementar) |
| **Hora** | HH:MM |
| **Dispositivo** | POS-1 / POS-2 / POS-3 / KDS-C / KDS-B |
| **Fase** | A / B / C / D |
| **Caso** | B-13 (referencia del checklist) |
| **Acción ejecutada** | — |
| **Order ID / Op ID** | — |
| **Estado local** | Toast mostrado / estado UI |
| **Estado KDS/Barra** | Visible / No visible / N/A |
| **Estado impresión** | Impreso / En queue / Fallido |
| **Estado queue** | Count antes → count después |
| **Resultado** | PASS / FAIL |
| **Incidente** | Descripción si FAIL |
| **Recovery** | Automático / Manual / Sin recovery |

---

## Gates de fallo — cualquiera descertifica

Si se confirma alguna de estas condiciones durante la prueba, el resultado es **FAIL** y se detiene la ejecución:

| Gate | Descripción |
|---|---|
| **G-01** | Pérdida de orden — una orden tomada offline no aparece en Supabase post-sync |
| **G-02** | Pérdida de pago — un cobro offline no aparece en Supabase post-sync |
| **G-03** | Duplicado — mismo `order_id` aparece dos veces en BD |
| **G-04** | Comanda no recibida — KDS no muestra orden enviada offline (LAN activa) |
| **G-05** | Impresión perdida sin queue — ticket no se imprimió y no hay entrada en print queue |
| **G-06** | Replay incompleto — sync termina con queue pendiente > 0 sin error explicable |
| **G-07** | Conflicto silencioso — `STALE_WRITE_CONFLICT` no visible para operador |
| **G-08** | Cierre inconsistente — totales del turno no coinciden con suma de ventas |
| **G-09** | Intervención técnica requerida — se necesitó DevTools, SQL, edición de JSON, o soporte para continuar |
| **G-10** | Reinicio destruye estado — datos perdidos después de reiniciar POS o KDS |

---

## Resultado final

```
P2.5.9 — Offline / Sync
═══════════════════════════════════════════════

Estado:              [ ] PASS   [ ] PARTIAL   [ ] FAIL
Fecha:               2026-____-__
Hora inicio:         ____:____
Hora fin:            ____:____
Duración real:       ____ min

Hardware:
  POS-1:             ____________________________
  POS-2:             ____________________________
  POS-3:             ____________________________
  KDS cocina:        ____________________________
  KDS barra:         ____________________________

Versión / commit:    ____________________________

═══════════════════════════════════════════════

Métricas:
  Órdenes offline:   ____
  Pagos offline:     ____
  Comandas KDS:      ____
  Impresiones:       ____
  Reinicios:         ____
  Tiempo de sync:    ____s (OC-12 PASS/FAIL)

Incidentes:          ____
Recoveries auto:     ____
Recoveries manual:   ____
Intervenciones:      ____ (gate G-09: PASS/FAIL)
Duplicados:          ____ (esperado: 0)
Pérdida:             ____ (esperado: 0)
Replay completo:     [ ] SÍ   [ ] NO

Estado Supabase post-cierre:
  Órdenes:           ____  (esperado: ____)
  Cobros:            ____  (esperado: ____)
  Movimientos caja:  ____  (esperado: ____)
  Queue offline:     ____ pendientes (esperado: 0)
  Print queue:       ____ jobs (esperado: 0)

═══════════════════════════════════════════════

OC-01 a OC-12:
  OC-01 4h offline:        [ ] PASS  [ ] FAIL  [ ] DEFERRED
    Motivo OC-01: smoke test 90–120 min ejecutado. Certificación de 4h
    queda pendiente de ventana operacional completa.
  OC-02 Sin pérdida:       [ ] PASS  [ ] FAIL
  OC-03 Sync completo:     [ ] PASS  [ ] FAIL
  OC-04 Sin duplicados:    [ ] PASS  [ ] FAIL
  OC-05 Turno offline:     [ ] PASS  [ ] FAIL
  OC-06 Cierre correcto:   [ ] PASS  [ ] FAIL
  OC-07 Ticket offline:    [ ] PASS  [ ] FAIL
  OC-08 Print queue retry: [ ] PASS  [ ] FAIL
  OC-09 Auth offline:      [ ] PASS  [ ] FAIL
  OC-10 Menú offline:      [ ] PASS  [ ] FAIL
  OC-11 UX indicador:      [ ] PASS  [ ] FAIL
  OC-12 Sync ≤ 30s:        [ ] PASS  [ ] FAIL  (tiempo real: ____s)

Gaps encontrados:
  _______________________________________________________________
  _______________________________________________________________

Commits de fix (si aplica):
  _______________________________________________________________

Docs actualizados:
  [ ] OFFLINE-SUITE-v1.md (OC-01–OC-12)
  [ ] CERTIFICATIONS.md (P2.5.9)
  [ ] GOLDEN-POS-SKELETON.md (P0 completado)

═══════════════════════════════════════════════

Operational Readiness:
  POS            [ ] Ready
  Caja           [ ] Ready
  KDS            [ ] Ready
  Barra          [ ] Ready
  Print          [ ] Ready
  Bridge         [ ] Ready
  Offline Replay [ ] Ready
  Shadow Day     [ ] Pending  [ ] Ready
  Golden Skeleton[ ] Blocked  [ ] Ready
  Cliente #2     [ ] Blocked  [ ] Ready

Veredicto:
  _______________________________________________________________

Firma Daniel: _________________  Fecha: ________________
```

---

## Lecciones aprendidas

*(Completar post-ejecución)*

**¿Qué salió mejor de lo esperado?**

**¿Qué salió peor?**

**¿Qué automatizaríamos antes del siguiente cliente?**

**¿Qué cambiaríamos del protocolo de prueba?**

**¿Qué debe incorporarse al Golden Skeleton?**

**¿Qué debe convertirse en un módulo FEOS?**
