-- pos_sessions: tracks active POS sessions per terminal to prevent concurrent login
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS pos_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  terminal_id text NOT NULL,
  client_id text NOT NULL DEFAULT 'amalay',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by staff_id + client_id
CREATE INDEX IF NOT EXISTS idx_pos_sessions_staff ON pos_sessions (staff_id, client_id);

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_pos_sessions_heartbeat ON pos_sessions (last_heartbeat);

-- Unique constraint: one session per terminal per client
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_sessions_terminal ON pos_sessions (terminal_id, client_id);

-- RLS: allow anon to read/write (same pattern as pos_staff, pos_orders)
ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_sessions_anon_select" ON pos_sessions FOR SELECT TO anon USING (true);
CREATE POLICY "pos_sessions_anon_insert" ON pos_sessions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pos_sessions_anon_update" ON pos_sessions FOR UPDATE TO anon USING (true);
CREATE POLICY "pos_sessions_anon_delete" ON pos_sessions FOR DELETE TO anon USING (true);

-- Optional: auto-cleanup cron (if pg_cron is enabled)
-- Deletes sessions with heartbeat older than 10 minutes
-- SELECT cron.schedule('cleanup_pos_sessions', '*/10 * * * *', $$DELETE FROM pos_sessions WHERE last_heartbeat < now() - interval '10 minutes'$$);
