> **ARCHIVED.** Replaced by: `operations/GO-LIVE-CHECKLIST.md`
>
> This document is kept for historical reference only.

# Fullsite POS — Certification Checklist v2.0

> **Estándar:** No "funciona". **Sobrevive al caos operativo de un restaurante real.**
> **Regla:** Si un solo P0 falla, Fullsite NO se instala.
> **Regla:** Todo fallo se convierte en bug. Todo bug corregido requiere re-certificación del módulo.
> **Regla:** Este checklist no se modifica durante la ejecución.

## Clasificación P0

| Clase | Significado | Ejemplo |
|---|---|---|
| **P0-A** | Puede perder VENTAS | Orden no se guarda, cocina no recibe comanda |
| **P0-B** | Puede perder DINERO | Doble cobro, corte incorrecto, retiro no registrado |
| **P0-C** | Puede perder DATOS | Audit log borrable, items desaparecen, draft perdido |

---

## Cómo usar este documento

1. Abrir en un restaurante con hardware conectado (impresoras, terminal, bridge)
2. Ejecutar cada test en orden
3. Marcar PASS o FAIL
4. Si FAIL: anotar evidencia (screenshot, log, error) y crear bug
5. Al final: si todos los P0 pasan → **CERTIFICADO**

Formato: `[P] ID | Acción | Resultado esperado | PASS/FAIL | Evidencia si falla`

`[P]` = Prioridad (P0/P1/P2/P3)

---

## 1. INFRAESTRUCTURA

### 1.1 Bridge

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | INF-01 | Reiniciar terminal Windows | Bridge arranca automáticamente (Startup) | | Carpeta Startup, start-bridge.bat |
| P0 | INF-02 | Abrir `127.0.0.1:7717/health` en Chrome | JSON con `ok:true`, 4+ estaciones | | Node instalado, printers.json, firewall |
| P0 | INF-03 | Apagar bridge (cerrar CMD) y reabrir terminal | Bridge se recupera solo | | Startup folder, start-bridge.bat |
| P1 | INF-04 | Desconectar cable de red de impresora cocina | POS muestra toast "⚠ Impresora sin conexión: cocina" | | printer.ts, bridge logs |
| P1 | INF-05 | Reconectar cable de impresora cocina | Siguiente envío imprime correctamente (< 10 seg) | | Bridge health TTL (5s) |
| P1 | INF-06 | Matar bridge mientras hay orden en curso | POS encola impresión, no abre diálogo de Windows | | print-queue.ts, enqueueFailedPrint |
| P2 | INF-07 | Verificar que bridge escucha solo en 127.0.0.1 | No accesible desde otra máquina en la red | | bridge.js, server.listen binding |

### 1.2 Chrome Kiosk

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | INF-08 | Reiniciar terminal Windows | Chrome abre en kiosk con POS fullscreen | | start-pos.bat en Startup |
| P0 | INF-09 | Intentar salir del kiosk (sin teclado) | No se puede salir — pantalla completa fija | | chrome --kiosk flag |
| P1 | INF-10 | Tocar logo AMALAY 5 veces rápido en PIN | Sale del kiosk (admin exit) | | layout.tsx, logo onClick |
| P1 | INF-11 | Verificar que barra de tareas NO aparece | Kiosk oculta taskbar | | Windows kiosk vs Chrome kiosk |

---

## 2. LOGIN / SESIÓN

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | LOG-01 | Ingresar PIN válido de mesero | Accede al POS → va a Mesas | | /api/pos/pin, pos_staff tabla |
| P0 | LOG-02 | Ingresar PIN inválido 5 veces | Muestra "Demasiados intentos" (rate limit) | | /api/pos/pin, rate limiter |
| P0 | LOG-03 | Ingresar PIN de gerente | Accede con permisos de gerente | | pos_staff.role |
| P1 | LOG-04 | Verificar que NO hay PINs en localStorage | `localStorage.getItem('pos_pin_cache')` debe ser null o vacío | | layout.tsx, pre-fetch eliminado |
| P1 | LOG-05 | Desconectar internet, ingresar PIN previamente validado | Funciona con token cached (15 min) | | pos_auth_cache, TTL |
| P1 | LOG-06 | Esperar 15+ min sin actividad | Sesión expira, muestra PIN | | IDLE_TIMEOUT_MS, layout.tsx |
| P2 | LOG-07 | Dos terminales con mismo PIN | Ambas acceden, sesiones independientes | | sessionStorage separado |

---

## 3. APERTURA DE TURNO

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | TUR-01 | Abrir turno con fondo de $2,000 | Turno creado en pos_turnos, fondo registrado | | pos_turnos tabla |
| P0 | TUR-02 | Verificar que el turno aparece en /pos/corte | Muestra fondo inicial correcto | | corte/page.tsx |
| P1 | TUR-03 | Intentar abrir segundo turno sin cerrar primero | No permite (o advierte) | | getActiveTurno |
| P2 | TUR-04 | Verificar turno_id se asigna a órdenes nuevas | Orden guardada tiene turno_id correcto | | saveOrder, pos_orders.turno_id |

---

## 4. MESAS

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | MES-01 | Abrir plano de mesas | Muestra 33 mesas, colores por mesero | | mesas/page.tsx |
| P0 | MES-02 | Tocar mesa disponible | Abre orden vacía para esa mesa | | handleMesaClick, window.location.href |
| P0 | MES-03 | Tocar mesa ocupada | Carga la orden existente con todos los items | | loadMesaOrder, pos_orders query |
| P0 | MES-04 | Transferir mesa (botón ↔️) | Orden se mueve, mesa vieja libre, nueva ocupada | | updateOrderStatus, mesa patch |
| P1 | MES-05 | Verificar que mesa con status "entregada" sigue visible | Mesa muestra como ocupada, no verde | | status filter includes entregada |
| P1 | MES-06 | Dos terminales abren la misma mesa | Conflict check al enviar: "modificada por otro usuario" | | loadedUpdatedAt check |

---

## 5. TOMA DE ORDEN

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | ORD-01 | Agregar 1 bebida (Coffee) | Item aparece en la orden con precio correcto | | menuCategories, handleMenuItemTap |
| P0 | ORD-02 | Agregar 1 platillo con modificador (Chilaquiles + Aguacate) | Item + modificador + precio extra correcto | | modifier groups, precioExtra |
| P0 | ORD-03 | Agregar 1 producto Market | Item aparece, station = barra | | pos-constants.ts routing |
| P0 | ORD-04 | Cambiar cantidad (+ / -) | Precio se actualiza correctamente | | updateQuantity |
| P0 | ORD-05 | Verificar subtotal, IVA y total | Matemática correcta, sin centavos sueltos | | Math.round, floating point fix |
| P0 | ORD-06 | Refresh del navegador con items no enviados | Items se recuperan del draft | | pos_draft_{mesa} localStorage |
| P1 | ORD-07 | Buscar platillo por nombre | Resultados correctos en buscador | | menuSearch |
| P1 | ORD-08 | Agregar nota a un item | Nota visible en la orden y en la comanda impresa | | item.notas |
| P1 | ORD-09 | Verificar botón "Verificar" | Tabla con items agrupados + modificadores en columnas | | showVerify modal |
| P2 | ORD-10 | Doble-click rápido en "Agregar" | Solo se agrega 1 vez | | handleMenuItemTap guard |

---

## 6. ENVIAR A COCINA/BARRA

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | ENV-01 | Enviar orden con 1 bebida + 1 platillo | Comanda cocina imprime platillo, comanda barra imprime bebida | | splitOrderByStation, printByStation |
| P0 | ENV-02 | Verificar que la orden se guardó en Supabase ANTES de imprimir | Orden existe en pos_orders antes de que la comanda salga | | save-before-print fix |
| P0 | ENV-03 | Doble-click rápido en "Enviar" | Solo se envía 1 vez (mutex) | | operationLock.current |
| P0 | ENV-04 | Después de enviar, regresar y abrir la misma mesa | Todos los items siguen ahí | | loadMesaOrder, pos_orders |
| P0 | ENV-05 | Agregar 1 item nuevo y re-enviar | Solo imprime el item nuevo | | sentItemIds tracking |
| P0 | ENV-06 | Verificar número de línea en comanda impresa | "1 - 1x CAFÉ AMERICANO" | | buildStationTicketBytes lineNum |
| P1 | ENV-07 | Enviar con internet caído | Orden se guarda offline, se sincroniza al reconectar | | pos-offline-db, offline queue |
| P1 | ENV-08 | Enviar con bridge caído | Toast "⚠ Impresora sin conexión", comanda encolada | | printResult.failed, enqueueFailedPrint |

---

## 7. KDS / COCINA

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | KDS-01 | Orden enviada aparece en KDS/Cocina | Comanda visible con items y modificadores en cascada | | getKitchenOrders, cocina/page.tsx |
| P0 | KDS-02 | Click "Preparar" en KDS | Status cambia a "preparando" | | updateOrderStatus |
| P0 | KDS-03 | Click "Lista" en KDS | Status cambia a "lista" | | updateOrderStatus |
| P0 | KDS-04 | Click "Entregada" en KDS | Status cambia a "entregada", orden SIGUE visible en POS | | entregada in status filter |
| P1 | KDS-05 | Modificadores se ven en cascada (▸) | Cada modificador en su línea | | cocina/page.tsx modifier display |
| P1 | KDS-06 | Timer de orden cambia color (>15 min = rojo) | Visual correcto | | elapsed calculation |
| P2 | KDS-07 | Auto-archive órdenes >4 horas | Se marcan como "entregada" automáticamente | | fetchOrdersInner auto-archive |

---

## 8. IMPRESIÓN

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | PRT-01 | Imprimir comanda a cocina (TCP) | Sale en impresora de cocina | | printers.json, bridge, IP |
| P0 | PRT-02 | Imprimir comanda a barra (TCP) | Sale en impresora de barra | | printers.json, bridge, IP |
| P0 | PRT-03 | Imprimir ticket de cobro (USB) | Sale en impresora EC TICKET | | printers.json, windows printer name |
| P0 | PRT-04 | Abrir cajón de dinero | Cajón se abre con cobro en efectivo | | /drawer endpoint, ESC p command |
| P0 | PRT-05 | Ticket muestra: nombre negocio, fecha, mesa, mesero, items, mods, subtotal, IVA, total, QR | Todo presente y correcto | | buildESCPOS / printTicketCSS |
| P0 | PRT-06 | Ticket con pago mixto muestra cada método | "Efectivo: $300 / Tarjeta: $200" | | order.pagos display |
| P1 | PRT-07 | Reimprimir ticket | Marca "*** REIMPRESIÓN ***" + audit log | | ticket_reprinted action |
| P1 | PRT-08 | Print queue retry | Comanda fallida se reintenta y sale eventualmente | | print-queue.ts, startRetryLoop |
| P2 | PRT-09 | Verificar que NO se abre diálogo de Windows al fallar | Encolado silencioso, no CSS fallback | | enqueueFailedPrint, no window.print |

---

## 9. CANCELACIÓN

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | CAN-01 | Cancelar item enviado | Pide PIN gerente | | can('cancelar_ordenes'), verifyManagerPin |
| P0 | CAN-02 | Ingresar razón obligatoria | No permite cancelar sin razón | | cancelReason validation |
| P0 | CAN-03 | Pregunta "¿Se preparó?" | Sí = mantiene inventario, No = revierte | | inventory deduction logic |
| P0 | CAN-04 | Item cancelado visible en orden (tachado) | No desaparece, se ve como cancelado | | item.cancelled display |
| P0 | CAN-05 | Audit log de cancelación | Registra: quién, qué, motivo, aprobado_por | | pos_audit_log, item_cancelled |
| P1 | CAN-06 | Item cancelado excluido de totales | Subtotal/IVA/Total se recalculan | | activeItems filter |
| P1 | CAN-07 | Anular orden completa | Requiere PIN, motivo, genera audit | | handleVoidOrder |

---

## 10. RETIROS Y DEPÓSITOS

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | CAJ-01 | Hacer retiro: $500, "Pago proveedor" | Requiere PIN gerente, se guarda en pos_cash_movements | | CashMovementModal |
| P0 | CAJ-02 | Hacer depósito: $1000, "Cambio de banco" | Requiere PIN gerente, se guarda | | pos_cash_movements |
| P0 | CAJ-03 | Retiro aparece en corte | Resta del efectivo esperado | | corte formula |
| P0 | CAJ-04 | Depósito aparece en corte | Suma al efectivo esperado | | corte formula |
| P0 | CAJ-05 | Columnas type/amount correctas en wizard | Retiros/depósitos NO son $0 | | CierreCajaWizard, type/amount fix |
| P1 | CAJ-06 | Audit log de retiro/depósito | Registra: monto, motivo, actor, aprobado_por | | cash_retiro, cash_deposito |

---

## 11. DESCUENTOS Y CORTESÍAS

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | DSC-01 | Aplicar descuento % | Requiere PIN, descuento se refleja en subtotal | | DiscountModal, PIN check |
| P0 | DSC-02 | Aplicar descuento monto fijo | Requiere PIN, monto correcto | | discount calculation |
| P0 | DSC-03 | Descuento aparece en ticket | Línea "Descuento: -$XXX" | | buildESCPOS, printTicketCSS |
| P0 | DSC-04 | Audit log de descuento | Registra: tipo, monto, aprobado_por | | discount_applied action |
| P1 | DSC-05 | Cortesía (Pan dulce) | Se aplica automáticamente, aparece en ticket | | automatic promo logic |

---

## 12. PAGO Y COBRO

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | PAY-01 | Cobrar con efectivo | Cajón se abre, ticket imprime, orden se cierra | | handlePayment, openCashDrawer |
| P0 | PAY-02 | Cobrar con tarjeta | Ticket imprime, orden se cierra (sin cajón) | | handlePayment |
| P0 | PAY-03 | Pago mixto: $300 efectivo + $200 tarjeta | Ambos métodos en ticket, total correcto | | pagos array, mixto flow |
| P0 | PAY-04 | Propina | Se registra, aparece en ticket y corte | | order.propina |
| P0 | PAY-05 | Doble-click en "Cobrar" | Solo cobra 1 vez (mutex) | | operationLock.current |
| P0 | PAY-06 | Orden desaparece del plano de mesas | Status = cerrada, mesa verde | | saveOrder status:cerrada |
| P0 | PAY-07 | localStorage cache se limpia | No flash de orden vieja al reabrir mesa | | removeItem pos_order_{mesa} |
| P1 | PAY-08 | Confirmar personas antes de cobrar | Modal de verificación aparece | | showPersonVerify |
| P1 | PAY-09 | Split parejo (2 cuentas iguales) | Cada cuenta = total/2, dos tickets | | calcSplitParejo |
| P1 | PAY-10 | Split por items | Items asignados a cuentas correctas | | splitAssignments |

---

## 13. CORTE DE CAJA

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | CRT-01 | Abrir /pos/corte | Requiere PIN gerente | | corte_access sessionStorage |
| P0 | CRT-02 | Ventas por forma de pago correctas | Efectivo + Tarjeta + Transferencia = Total | | corte calculations |
| P0 | CRT-03 | Efectivo esperado = fondo + efectivo + propina + depósitos - retiros | Fórmula correcta | | corte formula |
| P0 | CRT-04 | Declarar efectivo y ver diferencia | Sobrante/faltante correcto | | CierreCajaWizard |
| P0 | CRT-05 | Imprimir corte | Incluye: negocio, ventas, fondo, depósitos, retiros, esperado, declarado, diferencia | | handlePrint |
| P0 | CRT-06 | Cerrar turno | Turno se marca como cerrado, no se puede reabrir sin crear nuevo | | closeTurno |
| P1 | CRT-07 | Ventas por mesero | Tabla correcta | | mesero breakdown |
| P1 | CRT-08 | Cancelaciones y descuentos en corte | Montos correctos | | cancelaciones, descuentos queries |
| P1 | CRT-09 | Reabrir orden desde corte | Requiere PIN + motivo + audit | | handleReopen |

---

## 14. AUDITORÍA

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | AUD-01 | Verificar que pos_audit_log tiene RLS append-only | No se puede DELETE ni UPDATE | | Supabase RLS policies |
| P0 | AUD-02 | Enviar orden genera audit | action: order_sent_kitchen | | logAudit call |
| P0 | AUD-03 | Cancelar item genera audit | action: item_cancelled, con motivo y aprobado_por | | logAudit call |
| P0 | AUD-04 | Cobrar genera audit | action: payment_processed | | logAudit call |
| P0 | AUD-05 | Reimprimir genera audit | action: ticket_reprinted | | logAudit call |
| P0 | AUD-06 | Retiro/depósito genera audit | action: cash_retiro / cash_deposito | | logAudit call |
| P1 | AUD-07 | Abrir /pos/auditoria o equivalente | Log visible con filtros | | audit page |
| P1 | AUD-08 | Descuento genera audit | action: discount_applied | | logAudit call |

---

## 15. OFFLINE / RECOVERY

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | OFF-01 | Desconectar internet, enviar orden | Orden se guarda en offline queue | | pos-offline-db |
| P0 | OFF-02 | Reconectar internet | Orden se sincroniza automáticamente | | syncAll |
| P0 | OFF-03 | Verificar que no hay duplicados después de sync | Una sola orden en pos_orders | | resolution=merge-duplicates |
| P1 | OFF-04 | Refresh con internet caído | Draft se restaura de localStorage | | pos_draft_{mesa} |
| P1 | OFF-05 | Cerrar y reabrir Chrome | Orden persiste (en Supabase o draft) | | loadMesaOrder + draft restore |
| P2 | OFF-06 | Verificar pending count en header | Muestra "X pendientes" cuando hay cola | | OfflineIndicator |

---

## 16. SEGURIDAD / ANTIFRAUDE

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P0 | SEC-01 | Mesero NO puede cancelar sin PIN gerente | Modal de PIN aparece | | can('cancelar_ordenes') |
| P0 | SEC-02 | Mesero NO puede aplicar descuento sin PIN | Modal de PIN aparece | | discount permission |
| P0 | SEC-03 | Mesero NO puede hacer retiro sin PIN gerente | Modal de PIN con aprobación | | CashMovementModal |
| P0 | SEC-04 | No hay PINs en localStorage | Solo tokens temporales | | pos_auth_cache (not pos_pin_cache) |
| P1 | SEC-05 | Manager PIN cache expira en 15 min | Después de 15 min, requiere validación online | | pos_manager_pin_cache TTL |
| P1 | SEC-06 | Rate limit en PIN: 5 intentos en 5 min | Bloqueo después de 5 intentos fallidos | | /api/pos/pin rate limiter |
| P2 | SEC-07 | Permisos móvil restringidos | Celular NO puede cobrar, cancelar, corte | | isMobileRestricted |

---

## 17. INVENTARIO

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P1 | INV-01 | Enviar orden deduce inventario | pos_inventory_movements tipo "deduction" | | deductIngredientsForOrder |
| P1 | INV-02 | Cancelar item (no preparado) revierte inventario | pos_inventory_movements tipo "reversal" | | reverseIngredientDeduction |
| P1 | INV-03 | Stock bajo genera alerta | Toast o badge en POS | | outOfStockItems, inventory alerts |
| P2 | INV-04 | Conteo físico funciona | /pos/inventario-fisico actualiza stock | | inventario-fisico page |

---

## RESUMEN DE CERTIFICACIÓN

| Módulo | Tests P0 | Tests P1 | Tests P2 | Total |
|---|---|---|---|---|
| Infraestructura | 3 | 3 | 1 | 7 |
| Login | 3 | 3 | 1 | 7 |
| Turno | 2 | 1 | 1 | 4 |
| Mesas | 4 | 2 | 0 | 6 |
| Orden | 6 | 3 | 1 | 10 |
| Enviar | 6 | 2 | 0 | 8 |
| KDS | 4 | 2 | 1 | 7 |
| Impresión | 6 | 2 | 1 | 9 |
| Cancelación | 5 | 2 | 0 | 7 |
| Caja | 5 | 1 | 0 | 6 |
| Descuentos | 4 | 1 | 0 | 5 |
| Pago | 7 | 3 | 0 | 10 |
| Corte | 6 | 3 | 0 | 9 |
| Auditoría | 6 | 2 | 0 | 8 |
| Offline | 3 | 2 | 1 | 6 |
| Seguridad | 4 | 2 | 1 | 7 |
| Inventario | 0 | 3 | 1 | 4 |
| Concurrencia | 5 | 0 | 0 | 5 |
| Crash Recovery | 5 | 0 | 0 | 5 |
| Bridge Recovery | 3 | 1 | 0 | 4 |
| Performance | 5 | 0 | 0 | 5 |
| Stress | 0 | 4 | 1 | 5 |
| Upgrade | 0 | 4 | 1 | 5 |
| Hardware Failure | 3 | 3 | 0 | 6 |
| User Acceptance | 4 | 2 | 0 | 6 |
| **TOTAL** | **99** | **54** | **12** | **165** |

---

## 18. CONCURRENCIA

> Dos terminales, misma mesa. El POS más confiable que Wansoft.

| P | Clase | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|---|
| P0 | A | CON-01 | Terminal A y B abren mesa 5 al mismo tiempo. A agrega items y envía. B agrega items y envía. | B recibe alerta "modificada por otro usuario" antes de sobreescribir. Orden de A se preserva. | | loadedUpdatedAt conflict check |
| P0 | B | CON-02 | Terminal A cobra mesa 5. Terminal B intenta cobrar misma mesa 5. | B recibe error "orden ya cerrada" o "no encontrada". No se cobra dos veces. | | status=cerrada, query filter |
| P0 | A | CON-03 | Terminal A cancela item mientras B agrega items a la misma mesa | Cancelación de A persiste. Items de B se agregan. No se pierden ni duplican. | | conflict check, UPSERT |
| P0 | B | CON-04 | Gerente A autoriza descuento mientras Gerente B autoriza cancelación en misma orden | Ambas acciones se registran en audit. Orden refleja ambos cambios. | | audit append-only |
| P0 | C | CON-05 | Verificar en pos_orders: NUNCA dos órdenes activas para la misma mesa | `SELECT mesa, COUNT(*) FROM pos_orders WHERE status NOT IN ('cerrada','cancelada') GROUP BY mesa HAVING COUNT(*) > 1` = 0 filas | | DB constraint or query logic |

---

## 19. CRASH RECOVERY

> Apagón de luz, Windows se congela, alguien desconecta la computadora.

| P | Clase | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|---|
| P0 | A | CRA-01 | Cerrar Chrome abruptamente con orden abierta (items agregados, no enviados) | Al reabrir: draft se restaura de localStorage. Mesero no re-captura. | | pos_draft_{mesa}, autosave useEffect |
| P0 | A | CRA-02 | Cerrar Chrome durante envío a cocina (después de "Enviar") | Al reabrir: orden está en Supabase (save-before-print). Si save no completó, draft local persiste. | | saveOrder await, localStorage draft |
| P0 | B | CRA-03 | Cerrar Chrome durante cobro (después de "Cobrar") | Al reabrir: si saveOrder completó → orden cerrada, no se cobra de nuevo. Si no completó → orden sigue abierta, se puede re-cobrar. NUNCA doble cobro. | | operationLock, saveOrder UPSERT |
| P0 | A | CRA-04 | Cerrar Chrome durante impresión | Comanda en print queue. Al reabrir bridge + Chrome: retry imprime. | | print-queue persistence |
| P0 | B | CRA-05 | Reiniciar Windows durante corte de caja | Al reabrir: si cierre no completó → turno sigue abierto, wizard disponible. Si completó → turno cerrado, corte guardado. | | pos_cierres, pos_turnos |

---

## 20. BRIDGE RECOVERY

> El bridge es el eslabón entre el POS web y las impresoras físicas. Debe ser indestructible.

| P | Clase | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|---|
| P0 | A | BRG-01 | Matar bridge (taskkill /f /im node.exe), enviar orden | POS detecta bridge caído en <5s. Comanda encolada. Toast de advertencia. | | BRIDGE_HEALTH_TTL_MS=5000, enqueueFailedPrint |
| P0 | A | BRG-02 | Reiniciar bridge con print queue pendiente | Comandas pendientes se imprimen al reconectar (retry loop) | | startRetryLoop, print-queue.ts |
| P0 | A | BRG-03 | Bridge reiniciando mientras llegan nuevas impresiones | Nuevas impresiones encoladas. No se pierden. No se duplican. | | queue persistence, dedup |
| P1 | - | BRG-04 | Bridge corriendo 24 horas continuas | Sin memory leaks, sin degradación. Health check sigue OK. | | bridge.js uptime, /health endpoint |

---

## 21. PERFORMANCE

> En un restaurante, 2 segundos se sienten como una eternidad.

| P | Clase | ID | Acción | Métrica | Límite | PASS/FAIL |
|---|---|---|---|---|---|---|
| P0 | A | PER-01 | Abrir POS (PIN screen) | Tiempo desde click hasta PIN visible | < 3 s | |
| P0 | A | PER-02 | Abrir mesa con orden existente | Tiempo desde click en mesas hasta items visibles | < 1.5 s | |
| P0 | A | PER-03 | Enviar orden a cocina | Tiempo desde click "Enviar" hasta toast de confirmación | < 2 s | |
| P0 | B | PER-04 | Cobrar orden | Tiempo desde click "Cobrar" hasta orden cerrada | < 3 s | |
| P0 | A | PER-05 | Abrir corte de caja | Tiempo desde click hasta datos cargados | < 3 s | |

---

## 22. STRESS TESTS

> Intentar romper el sistema.

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P1 | STR-01 | Abrir 20 mesas consecutivas, agregar 3+ items a cada una | Todas se guardan correctamente. Mapa muestra 20 ocupadas. | | Supabase query performance |
| P1 | STR-02 | Enviar 50 órdenes consecutivas en 10 minutos | Todas las comandas impresas. KDS recibe todas. Ninguna duplicada. | | print queue, bridge throughput |
| P1 | STR-03 | 10 cancelaciones seguidas con PIN | Todas registradas en audit. Inventario correcto. | | audit log, inventory movements |
| P1 | STR-04 | Alternar online/offline 10 veces en 5 minutos | Sync completa sin duplicados. Offline indicator correcto. | | syncAll, offline queue |
| P2 | STR-05 | Usar el POS 8 horas continuas sin refresh | Sin memory leaks, sin degradación, sin crash | | Chrome DevTools memory profile |

---

## 23. UPGRADE TESTS

> Cada actualización debe ser invisible para el restaurante.

| P | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|
| P1 | UPG-01 | Deploy nueva versión mientras hay draft en localStorage | Draft sobrevive el deploy. Items no se pierden. | | localStorage persistence across deploys |
| P1 | UPG-02 | Deploy nueva versión mientras hay offline queue | Queue sobrevive. Se sincroniza con la nueva versión. | | IndexedDB persistence |
| P1 | UPG-03 | Deploy nueva versión: verificar printers.json compatible | Bridge sigue imprimiendo sin reconfigurar | | printers.json backwards compatibility |
| P1 | UPG-04 | Deploy nueva versión: verificar que el menú carga | Categorías, items, modificadores, precios correctos | | pos_menu_categories, pos_menu_items |
| P2 | UPG-05 | Verificar "Actualización disponible" banner | Se muestra cuando hay nueva versión en Vercel | | Next.js service worker update |

---

## 24. HARDWARE FAILURE

> Cables se desconectan. Impresoras se quedan sin papel. La realidad de un restaurante.

| P | Clase | ID | Acción | Resultado esperado | PASS/FAIL | Si falla revisar |
|---|---|---|---|---|---|---|
| P0 | A | HW-01 | Desconectar impresora cocina (cable ethernet) | POS envia toast. Comanda encolada. Al reconectar, comanda sale. | | bridge TCP timeout, retry queue |
| P0 | A | HW-02 | Impresora sin papel | Bridge retorna error HTTP. POS encola. Al poner papel, sale. | | bridge error handling |
| P0 | B | HW-03 | Cajón de dinero desconectado | Cobro se procesa correctamente. Cajón no abre pero no bloquea la venta. | | openCashDrawer error handling |
| P1 | - | HW-04 | Internet intermitente (conecta/desconecta cada 30 seg) | POS opera offline durante desconexiones. Sync cuando reconecta. No duplica. | | offline queue, syncAll |
| P1 | - | HW-05 | WiFi lento (>2s latency) | POS sigue operando. Save puede tardar pero no falla. | | fetch timeout, offline fallback |
| P1 | - | HW-06 | Monitor touch deja de responder 5 seg | Al regresar, POS sigue en el mismo estado. No se pierde nada. | | React state persistence |

---

## 25. USER ACCEPTANCE

> El mejor POS del mundo es inútil si nadie puede usarlo.

| P | ID | Acción | Resultado esperado | PASS/FAIL | Cómo medir |
|---|---|---|---|---|---|
| P0 | UAT-01 | Mesero nuevo toma primera orden sin entrenamiento previo | Completa el flujo PIN → Mesa → Items → Enviar en menos de 5 minutos | | Cronómetro + observación |
| P0 | UAT-02 | Mesero nuevo cobra mesa sin ayuda | Completa cobro + ticket en menos de 3 minutos | | Cronómetro + observación |
| P0 | UAT-03 | Gerente cierra turno sin ayuda | Completa corte de caja sin preguntar en menos de 10 minutos | | Cronómetro + observación |
| P0 | UAT-04 | Cocinero entiende KDS sin explicación | Identifica qué preparar, usa botón Preparar/Listo en menos de 2 minutos | | Cronómetro + observación |
| P1 | UAT-05 | Mesero encuentra platillo por búsqueda | Escribe nombre parcial y lo encuentra en menos de 10 segundos | | Cronómetro |
| P1 | UAT-06 | Cajero aplica descuento con PIN | Completa flujo descuento + PIN + confirmar en menos de 30 segundos | | Cronómetro |

---

## RESUMEN FINAL v2.0

### Criterio de aprobación:

- **99 tests P0 deben pasar al 100%**
- P1: 90% mínimo (máximo 5 fails de 54)
- P2: informativo, no bloquea

### Firma de certificación:

```
╔══════════════════════════════════════════════╗
║         FULLSITE POS CERTIFICATION           ║
╠══════════════════════════════════════════════╣
║ Versión:        ___________________________  ║
║ Fecha:          ___________________________  ║
║ Restaurante:    ___________________________  ║
║ Ejecutado por:  ___________________________  ║
║                                              ║
║ Tests P0-A (ventas):    ___/___ PASS         ║
║ Tests P0-B (dinero):    ___/___ PASS         ║
║ Tests P0-C (datos):     ___/___ PASS         ║
║ Tests P0 TOTAL:         ___/99  PASS         ║
║ Tests P1:               ___/54  PASS         ║
║ Tests P2:               ___/12  PASS         ║
║                                              ║
║ Bugs encontrados:       ___                  ║
║ Bugs P0 abiertos:       ___                  ║
║                                              ║
║ RESULTADO: □ CERTIFICADO  □ NO CERTIFICADO   ║
║                                              ║
║ Firma: _________________________________     ║
╚══════════════════════════════════════════════╝
```
