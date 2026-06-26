# Fullsite Certification Run — AMALAY

```
Versión: 48d7bdb (2026-06-25)
Restaurante: AMALAY Coffee & Market
Fecha: _______________
Ejecutado por: Daniel Ramonfaur
```

---

## FASE 1: P0 Core Flow

### Login

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| LOG-01 | PIN válido mesero | Accede → Mesas | |
| LOG-02 | PIN inválido 5x | Rate limit | |
| LOG-03 | PIN gerente | Accede con permisos | |

### Turno

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| TUR-01 | Abrir turno fondo $2,000 | pos_turnos creado | |
| TUR-02 | Turno en /pos/corte | Fondo correcto | |

### Mesa

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| MES-01 | Plano de mesas | 33 mesas, colores | |
| MES-02 | Mesa disponible | Orden vacía | |
| MES-03 | Mesa ocupada | Carga items | |
| MES-04 | Transferir mesa | Orden se mueve | |

### Orden

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| ORD-01 | Agregar bebida | Precio correcto | |
| ORD-02 | Agregar platillo + modificador | Precio extra correcto | |
| ORD-03 | Agregar Market item | Station = barra | |
| ORD-04 | Cambiar cantidad | Total se actualiza | |
| ORD-05 | Subtotal/IVA/Total | Sin centavos sueltos | |
| ORD-06 | Refresh con items no enviados | Draft se recupera | |

### Enviar

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| ENV-01 | Enviar 1 bebida + 1 platillo | Cocina imprime platillo, barra imprime bebida | |
| ENV-02 | Orden en Supabase ANTES de imprimir | Verificar en DB | |
| ENV-03 | Doble-click "Enviar" | Solo 1 envío | |
| ENV-04 | Reabrir mesa | Items siguen | |
| ENV-05 | Agregar item nuevo + re-enviar | Solo imprime nuevo | |
| ENV-06 | Número de línea en comanda | "1 - 1x ..." | |

### Impresión

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| PRT-01 | Comanda cocina (TCP) | Imprime | |
| PRT-02 | Comanda barra (TCP) | Imprime | |
| PRT-03 | Ticket cobro (USB) | Imprime | |
| PRT-04 | Cajón de dinero | Abre con efectivo | |
| PRT-05 | Ticket completo | Nombre, fecha, items, QR | |
| PRT-06 | Pago mixto en ticket | Cada método con monto | |

### Cobrar

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| PAY-01 | Efectivo | Cajón + ticket + cerrada | |
| PAY-02 | Tarjeta | Ticket + cerrada | |
| PAY-03 | Mixto $300 ef + $200 tarj | Ambos en ticket | |
| PAY-04 | Propina | En ticket y corte | |
| PAY-05 | Doble-click "Cobrar" | Solo 1 cobro | |
| PAY-06 | Mesa libre después | Verde en plano | |
| PAY-07 | Cache limpio | Sin flash viejo | |

### Corte

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| CRT-01 | Acceso requiere PIN | Modal PIN | |
| CRT-02 | Ventas por forma de pago | Suma = total | |
| CRT-03 | Fórmula efectivo | fondo + ef + prop + dep - ret | |
| CRT-04 | Declarar + diferencia | Correcto | |
| CRT-05 | Imprimir corte | Completo | |
| CRT-06 | Cerrar turno | No reabrir | |

---

## FASE 2: P0 Caos

### Doble click

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| ENV-03 | Doble-click Enviar | 1 solo envío | |
| PAY-05 | Doble-click Cobrar | 1 solo cobro | |

### Offline

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| OFF-01 | Internet caído + enviar | Offline queue | |
| OFF-02 | Reconectar | Sync automático | |
| OFF-03 | Sin duplicados | 1 orden en DB | |

### Bridge

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| INF-01 | Reiniciar terminal | Bridge auto-start | |
| INF-02 | Health check | ok:true | |
| INF-04 | Desconectar impresora | Toast advertencia | |
| INF-06 | Matar bridge con orden | Encolado, no diálogo Windows | |
| BRG-01 | Bridge muerto + enviar | Detecta <5s, encola | |
| BRG-02 | Reiniciar bridge con queue | Imprime pendientes | |

### Refresh / Crash

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| CRA-01 | Chrome cerrado con draft | Draft se restaura | |
| CRA-02 | Chrome cerrado durante envío | Orden en DB o draft | |
| CRA-03 | Chrome cerrado durante cobro | Sin doble cobro | |
| CRA-04 | Chrome cerrado durante print | Print queue retry | |

### Concurrencia

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| CON-01 | 2 terminales misma mesa | Conflict check | |
| CON-02 | 2 terminales cobran misma mesa | Solo 1 cobra | |
| CON-05 | Nunca 2 órdenes activas por mesa | Query DB = 0 | |

---

## FASE 3: P0 Caja

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| CAJ-01 | Retiro $500 + PIN | Guardado | |
| CAJ-02 | Depósito $1000 + PIN | Guardado | |
| CAJ-03 | Retiro en corte | Resta esperado | |
| CAJ-04 | Depósito en corte | Suma esperado | |
| CAJ-05 | type/amount correctos | No $0 | |
| DSC-01 | Descuento % + PIN | Aplicado | |
| DSC-03 | Descuento en ticket | Visible | |

---

## FASE 4: P0 Seguridad

| ID | Acción | Esperado | PASS/FAIL |
|---|---|---|---|
| SEC-01 | Mesero cancela sin PIN | Bloqueado | |
| SEC-02 | Mesero descuenta sin PIN | Bloqueado | |
| SEC-03 | Mesero retira sin PIN | Bloqueado | |
| SEC-04 | No PINs en localStorage | Verificar DevTools | |
| CAN-01 | Cancelar con PIN | PIN requerido | |
| CAN-02 | Razón obligatoria | No cancela sin razón | |
| CAN-05 | Audit de cancelación | En pos_audit_log | |
| AUD-01 | Audit append-only | No DELETE/UPDATE | |
| AUD-02 | Enviar genera audit | order_sent_kitchen | |
| AUD-04 | Cobrar genera audit | payment_processed | |
| AUD-05 | Reimprimir genera audit | ticket_reprinted | |
| PRT-07 | Reimpresión marcada | *** REIMPRESIÓN *** | |

---

## FASE 5: P1/P2

### Performance

| ID | Acción | Límite | Medido | PASS/FAIL |
|---|---|---|---|---|
| PER-01 | Abrir POS | < 3s | | |
| PER-02 | Abrir mesa | < 1.5s | | |
| PER-03 | Enviar | < 2s | | |
| PER-04 | Cobrar | < 3s | | |
| PER-05 | Abrir corte | < 3s | | |

### User Acceptance

| ID | Acción | Límite | PASS/FAIL |
|---|---|---|---|
| UAT-01 | Mesero nuevo toma orden | < 5 min | |
| UAT-02 | Mesero nuevo cobra | < 3 min | |
| UAT-03 | Gerente cierra turno | < 10 min | |
| UAT-04 | Cocinero usa KDS | < 2 min | |

---

## REGISTRO DE BUGS

| Bug # | ID Test | Qué pasó | Qué esperaba | Screenshot/log | Prioridad | Reproducible |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |

---

## RESULTADO

```
╔══════════════════════════════════════════════╗
║         FULLSITE POS CERTIFICATION           ║
╠══════════════════════════════════════════════╣
║ Versión:        48d7bdb (2026-06-25)         ║
║ Restaurante:    AMALAY Coffee & Market       ║
║ Fecha:          ___________________________  ║
║ Ejecutado por:  Daniel Ramonfaur             ║
║                                              ║
║ FASE 1 Core:       ___/___ PASS              ║
║ FASE 2 Caos:       ___/___ PASS              ║
║ FASE 3 Caja:       ___/___ PASS              ║
║ FASE 4 Seguridad:  ___/___ PASS              ║
║ FASE 5 P1/P2:      ___/___ PASS              ║
║                                              ║
║ P0 TOTAL:           ___/99  PASS             ║
║ Bugs P0 abiertos:   ___                      ║
║                                              ║
║ RESULTADO: □ CERTIFICADO  □ NO CERTIFICADO   ║
║                                              ║
║ Firma: _________________________________     ║
╚══════════════════════════════════════════════╝
```
