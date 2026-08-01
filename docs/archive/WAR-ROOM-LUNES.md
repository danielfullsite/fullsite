# War Room — Lunes Smoke Test AMALAY

> Primera operacion real de Fullsite en un restaurante.
> No programar. No hacer deploy. Solo observar.

---

## Pre-requisitos (domingo noche)

- [ ] .exe compilado con todos los fixes RC
- [ ] USB con .exe listo (+ copia del instalador anterior funcional como rollback)
- [ ] printers.json verificado (IPs cocina/barra, USB caja)
- [ ] Foto de conexiones fisicas e IPs actuales antes de modificar
- [ ] Confirmar que Wansoft sigue instalado y operativo como contingencia
- [ ] Export/backup de configuracion actual de cada terminal
- [ ] Telefono cargado
- [ ] Este documento impreso o en tablet

---

## Protocolo

1. Si algo falla y el restaurante puede seguir operando: **documentar, no arreglar**
2. Si algo falla y el restaurante NO puede operar: **revertir a Wansoft, documentar**
3. No hacer deploy durante el turno
4. No modificar codigo durante el turno
5. Grabar hitos principales y anomalias — no distraerse produciendo contenido

---

## Fase 1 — Smoke Test (08:30–10:05, antes de clientes)

Pruebas controladas. Se puede provocar fallas, reiniciar, desconectar.

| Hora | Evento | Esperado | Resultado | Bug | Accion |
|------|--------|----------|-----------|-----|--------|
| 08:30 | Instalar .exe terminal 1 | App abre en kiosk | | | |
| 08:35 | Instalar .exe terminal 2 | App abre en kiosk | | | |
| 08:40 | Instalar .exe terminal 3 | App abre en kiosk | | | |
| 08:45 | Verificar bridge (localhost:7717/health) | 3 estaciones OK | | | |
| 08:48 | Login con PIN correcto | Acceso OK | | | |
| 08:49 | Login con PIN incorrecto | Bloqueado, mensaje error | | | |
| 08:50 | Registrar huella Eduardo | Enrollment exitoso | | | |
| 08:52 | Registrar huella mesero 1 | Enrollment exitoso | | | |
| 08:54 | Login con huella Eduardo | Acceso, redirige a mesas | | | |
| 08:56 | Simular huella caida (cerrar servicio) → login PIN | PIN funciona como fallback | | | |
| 09:00 | Abrir turno | Fondo inicial, turno activo | | | |
| 09:03 | Orden mesa 1 — 2 items simples | Items en pantalla | | | |
| 09:04 | Enviar a cocina | Comanda impresa en cocina | | | |
| 09:05 | Verificar comanda fisica cocina | Texto legible, mesa correcta, mesero | | | |
| 09:06 | Orden mesa 1 — Chilaquiles (modificador escalonado) | Flujo paso a paso, obligatorio bloquea | | | |
| 09:07 | Enviar a cocina (2do envio) | Solo nuevos items impresos | | | |
| 09:08 | Verificar comanda barra | Bebida impresa en barra | | | |
| 09:10 | Cobro efectivo mesa 1 | Ticket impreso, cajon abre | | | |
| 09:11 | Verificar ticket fisico caja | Total, IVA, mesa, mesero correctos | | | |
| 09:13 | Orden mesa 5 — pago tarjeta | Cierra sin cajon | | | |
| 09:16 | Orden mesa 8 — pago mixto (efectivo + tarjeta) | Ambos registrados | | | |
| 09:19 | Orden mesa 3 — dividir cuenta (2 personas) | Cada cuenta cobra su parte | | | |
| 09:22 | Cancelar platillo ya enviado a cocina | Item voided, auditoria, verificar como se notifica a cocina | | | |
| 09:25 | Login huella mesero 1 (terminal 2) | Acceso en otra terminal | | | |
| 09:27 | Orden desde terminal 2 | No conflicto con terminal 1 | | | |
| 09:30 | Desconectar ethernet terminal 1 | Banner offline amarillo | | | |
| 09:31 | Hacer orden offline | Orden guardada local | | | |
| 09:33 | Reconectar ethernet | Sync automatico, banner desaparece | | | |
| 09:35 | Verificar orden synced en Supabase | Row existe en pos_orders | | | |
| 09:38 | Reiniciar Windows terminal 1 | Auto-start, turno persiste | | | |
| 09:42 | Crear empleado nuevo desde POS | Staff CRUD funciona | | | |
| 09:45 | Monitor de salud (/pos/monitor) | 6 servicios green | | | |
| 09:50 | Corte parcial | Totales coinciden con ventas de prueba | | | |
| 10:00 | Decision GO/NO-GO | Flujos 1-14 pasan, 0 P0, caja cuadra | | | |

---

## Criterio GO/NO-GO (10:00)

**GO** si se cumplen TODAS:
- Flujos de smoke test pasan sin P0
- Caja cuadra (efectivo contado = esperado)
- Comandas llegan a cocina y barra
- Eduardo confirma que puede operar sin Wansoft

**NO-GO** si cualquiera:
- Existe un P0 sin workaround
- Caja no cuadra por causa del software
- Comandas no llegan consistentemente

---

## Fase 2 — Observacion en operacion real (10:15+)

**NO provocar fallas.** No reiniciar terminales. No desconectar internet.
Solo observar la operacion normal con clientes reales.

| Hora | Evento | Resultado | Notas |
|------|--------|-----------|-------|
| 10:15 | Inicio operacion real | | |
| | Primera orden de cliente real | | |
| | Primer cobro de cliente real | | |
| | Hora pico (si aplica) | | |
| | Primer incidente (si ocurre) | | |
| | Segundo incidente (si ocurre) | | |

---

## Criterios de rollback inmediato

Revertir a Wansoft si ocurre cualquiera de estos:

1. Se pierde una orden
2. Se registra un cobro duplicado
3. El total del corte no coincide por causa del software
4. Cocina deja de recibir comandas y no hay workaround en <10 min
5. Dos terminales sobrescriben la misma orden
6. La recuperacion de cualquier falla tarda mas de 10 minutos

---

## Fase 3 — Cierre del dia

| Item | Resultado | Notas |
|------|-----------|-------|
| Corte final (turno completo) | | |
| Efectivo contado vs esperado por sistema | | |
| Desglose por metodo de pago (efectivo/tarjeta/mixto) | | |
| Ordenes abiertas al cierre | | |
| Cancelaciones y descuentos del dia | | |
| Inventario descontado correctamente | | |
| Print queue: jobs pendientes o fallidos | | |
| Total incidentes del dia | | |
| Decision para el martes | Continuar con Fullsite / Revertir a Wansoft / Operar en paralelo | |

---

## Evidencia

- Fotos de hitos principales (primer ticket, primer comanda, corte)
- Screenshots de anomalias
- Todo va a FIELD-NOTES.md al terminar el dia

---

## Despues del lunes

El smoke test demuestra que los flujos funcionan.
La semana completa demuestra que el restaurante puede depender de Fullsite.

---

*Code Freeze activo. No hay mas codigo hasta despues del smoke test.*
