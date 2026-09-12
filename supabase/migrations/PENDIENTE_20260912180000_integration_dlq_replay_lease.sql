-- Lease recuperable para el replay manual de integration_webhook_dlq.
-- PENDIENTE: aplicar primero en staging junto con las pruebas de replay.

ALTER TABLE public.integration_webhook_dlq
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid;

CREATE INDEX IF NOT EXISTS idx_integration_webhook_dlq_processing_lease
  ON public.integration_webhook_dlq (claimed_at)
  WHERE status = 'processing';

COMMENT ON COLUMN public.integration_webhook_dlq.claimed_at IS
  'Inicio del lease de replay. Un worker nuevo puede reclamarlo al vencer.';
COMMENT ON COLUMN public.integration_webhook_dlq.claim_token IS
  'Token CAS del dueño actual; evita que un worker vencido cierre el replay de otro.';
