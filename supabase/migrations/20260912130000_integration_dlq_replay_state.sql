-- Estado durable para que la DLQ deje de ser una tabla invisible sin consumidor.
-- Aditiva e idempotente; conserva payload e historial después del replay.

ALTER TABLE public.integration_webhook_dlq
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE public.integration_webhook_dlq
    ADD CONSTRAINT integration_webhook_dlq_status_check
    CHECK (status IN ('pending', 'processing', 'failed', 'resolved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_integration_webhook_dlq_open
  ON public.integration_webhook_dlq (status, created_at)
  WHERE status <> 'resolved';
