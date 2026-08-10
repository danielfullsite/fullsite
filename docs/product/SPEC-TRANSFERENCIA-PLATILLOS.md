# SPEC — Transferencia de platillos entre mesas (GAP operativo prioritario)

> **Estado: ESPECIFICACIÓN. No implementar como frente nuevo sin autorización.**
> Origen: auditoría Wansoft→Fullsite (RC-15, `docs/knowledge/wansoft/REGRESSION-CASES.md`).
> Severidad: ALTA — Eduardo lo identifica como **vector #1 de fraude**. Wansoft lo audita
> (usuario/origen/destino/hora, CAJA-SPEC.md §13); **Fullsite no tiene módulo ni test**.

## 1. Problema

Un platillo (o cuenta parcial) debe poder moverse de la mesa/orden A a la mesa/orden B
sin: (a) perder el registro de quién lo movió, (b) alterar precios/descuentos ya aplicados,
(c) permitir que el item desaparezca (merma encubierta) o se duplique (doble cobro/robo).
Hoy no existe la operación, así que el personal recurre a cancelar+recrear — que rompe la
auditoría y es exactamente el hueco de fraude.

## 2. Invariantes (deben cumplirse siempre)

- **INV-1 Conservación:** tras la transferencia, `Σ items(A_después) + Σ items(B_después)` =
  `Σ items(A_antes) + Σ items(B_antes)`. Ni un item ni un centavo se crea o destruye.
- **INV-2 Precio congelado:** el item transferido conserva su `precio_unitario`, modificadores,
  notas y cualquier descuento/promo ya aplicado a nivel item. No se recalcula al precio actual.
- **INV-3 Descuento a nivel cuenta:** si A tenía un descuento a nivel cuenta, se reprorratea en A
  con los items restantes; el item movido llega a B sin heredar el descuento de cuenta de A
  (queda documentado en el audit trail el monto que llevaba).
- **INV-4 Autorización:** requiere permiso `transferir_items` (mín. rol capitán) o PIN de gerente
  vía escalación in-place (mismo mecanismo que RC-20, `pos-manager-auth.test.ts`).
- **INV-5 Motivo obligatorio:** `reason` NOT NULL, ≥ N caracteres (alinear con GUARD-08, ≥10).
- **INV-6 Estado permitido:** solo items en estado `enviada|preparando|lista` son transferibles;
  `cobrada|cancelada` NO. Una orden `cobrada` no puede ser origen ni destino.
- **INV-7 Audit inmutable:** cada transferencia escribe un registro append-only que no puede
  editarse ni borrarse (mismo patrón que `pos_audit_log`, §2 de BUG-019).
- **INV-8 Idempotencia:** reintento con el mismo `transfer_id` (offline/reconexión) no duplica
  el movimiento (mismo patrón que la depleción idempotente, RC-34).
- **INV-9 Offline:** la operación debe funcionar LAN-first sin internet (benchmark Wansoft);
  entra al outbox/event-store y se reconcilia igual que el resto de comandos.

## 3. Contrato de datos (propuesto — no crear migración aún)

Registro de transferencia (append-only), campos mínimos:
`transfer_id (uuid, idempotencia) · client_id · from_order_id · to_order_id ·
item_ids[] · qty_por_item · precio_congelado_snapshot (jsonb) · descuento_item_snapshot ·
actor_user_id · authorized_by (nullable si actor ya tiene permiso) · reason · created_at ·
origin (online|offline) · business_date`.

Efecto sobre `pos_orders`/items: los items cambian de `order_id` (A→B) **o** se marca el
original como transferido y se crea su espejo en B — la implementación elegirá una, pero el
audit trail debe permitir reconstruir A_antes y B_antes.

## 4. Casos de regresión (a añadir cuando se implemente)

- **RC-T01** | conservación: mover 1 item A→B; total(A)+total(B) constante al centavo.
- **RC-T02** | precio congelado: item con modificador +$25 y nota se mueve con su precio, no el actual.
- **RC-T03** | descuento cuenta: A con −10% cuenta; tras mover 1 item, A reprorratea, B recibe sin ese −10%.
- **RC-T04** | permiso: mesero (sin `transferir_items`) → rechazado; capitán/gerente-PIN → permitido.
- **RC-T05** | motivo: transferencia sin `reason` (o <10 chars) → rechazada.
- **RC-T06** | estado: intentar mover item `cobrada` → rechazado; orden destino `cobrada` → rechazado.
- **RC-T07** | audit inmutable: UPDATE/DELETE sobre el registro de transferencia → 0 filas (como pos_audit_log).
- **RC-T08** | no duplicación: reintento con mismo `transfer_id` → 1 solo movimiento; total invariante.
- **RC-T09** | no desaparición: no existe ruta que quite el item de A sin insertarlo en B (transacción atómica / event replay).
- **RC-T10** | offline: transferencia sin red → entra al outbox, se reconcilia sin duplicar tras reconexión.
- **RC-T11** | KDS: si el item ya estaba en cocina, la comanda de la mesa destino refleja el origen (no re-dispara preparación); alinear con forward-only (RC-32).
- **RC-T12** | fraude: secuencia cancelar-en-A + recrear-en-B queda distinguible en el audit de una transferencia legítima (señal anti-fraude).

## 5. Dependencias / relación

- Reusa: escalación PIN gerente (RC-20), audit inmutable (BUG-019 §2), idempotencia (RC-34),
  outbox/event-store offline (OFFLINE-MASTER).
- No confundir con **split** (RC-11..14): split divide una cuenta en el cobro; transferencia
  mueve items entre órdenes vivas antes del cobro.
- Bloquea: cierre de la paridad de flujos críticos Wansoft (no es paridad visual; es un flujo
  operativo real que hoy falta).
