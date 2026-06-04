-- FASE 3: Agent Audit Log
-- ADITIVO — nueva tabla, no modifica nada existente
-- Reversible: DROP TABLE agent_audit_log;

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT NOW(),
  agent_name TEXT NOT NULL,
  trigger_type TEXT,              -- 'cron', 'webhook', 'manual', 'workflow_dispatch'
  action_type TEXT NOT NULL,      -- 'SELECT', 'INSERT', 'UPDATE', 'UPSERT', 'TELEGRAM', 'HTTP'
  tables_touched TEXT[],          -- {'wansoft_daily', 'agent_runs'}
  result TEXT,                    -- 'success', 'error', 'skipped'
  detail TEXT,                    -- short description or error message
  duration_ms INTEGER,
  auth_role TEXT                  -- 'service_role', 'fullsite_agent', 'fullsite_readonly'
);

-- Index for fast queries by agent and time
CREATE INDEX IF NOT EXISTS idx_audit_agent_ts ON agent_audit_log (agent_name, ts DESC);

-- Grant insert to both roles (they need to log their own actions)
GRANT INSERT ON agent_audit_log TO fullsite_readonly;
GRANT INSERT ON agent_audit_log TO fullsite_agent;
GRANT SELECT ON agent_audit_log TO fullsite_agent;
GRANT USAGE ON SEQUENCE agent_audit_log_id_seq TO fullsite_readonly;
GRANT USAGE ON SEQUENCE agent_audit_log_id_seq TO fullsite_agent;
