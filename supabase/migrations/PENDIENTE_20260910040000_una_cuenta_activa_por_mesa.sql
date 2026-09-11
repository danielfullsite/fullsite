-- Candidate: closes creation races for EVERY writer, not just transfer RPCs.
-- Apply in the coordinated migration window. Existing duplicate active accounts
-- intentionally stop index creation: reconcile them explicitly, never delete them.
-- Payment and kitchen states are independent: a paid account may remain in KDS
-- while the same physical table starts a new account. Virtual pickup tables are
-- not exclusive physical resources.
CREATE UNIQUE INDEX IF NOT EXISTS pos_orders_una_cuenta_activa_por_mesa
ON public.pos_orders (client_id, coalesce(location_id, ''), mesa)
WHERE mesa > 0 AND mesa < 900
  AND status IN ('abierta','enviada','preparando','lista')
  AND coalesce(payment_status,'pendiente') <> 'pagada';
