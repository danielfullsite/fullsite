"""
Agent Audit Log — lightweight helper for security logging.
Every agent imports this and logs its actions.

Usage:
    from audit_log import AuditLogger
    audit = AuditLogger("anomaly_detector", os.environ)
    audit.log_read(["wansoft_daily", "wansoft_kpis"])
    audit.log_write(["agent_results", "agent_runs"], "2 rows inserted")
    audit.log_error("Connection timeout")
"""
import os
import requests
from datetime import datetime, timezone


class AuditLogger:
    def __init__(self, agent_name: str, env: dict = None):
        self.agent_name = agent_name
        env = env or os.environ
        self.url = env.get("SUPABASE_URL", "").rstrip("/")
        self.key = env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_AGENT_KEY", "")
        self.trigger = env.get("TRIGGER_TYPE", "unknown")
        self.role = "service_role"
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def _log(self, action_type: str, tables: list, result: str, detail: str = "", duration_ms: int = 0):
        if not self.url or not self.key:
            return
        try:
            requests.post(
                f"{self.url}/rest/v1/agent_audit_log",
                headers=self.headers,
                json={
                    "agent_name": self.agent_name,
                    "trigger_type": self.trigger,
                    "action_type": action_type,
                    "tables_touched": tables,
                    "result": result,
                    "detail": (detail or "")[:500],
                    "duration_ms": duration_ms,
                    "auth_role": self.role,
                },
                timeout=5,
            )
        except Exception:
            pass  # Audit logging should never crash the agent

    def log_read(self, tables: list, detail: str = ""):
        self._log("SELECT", tables, "success", detail)

    def log_write(self, tables: list, detail: str = "", duration_ms: int = 0):
        self._log("INSERT", tables, "success", detail, duration_ms)

    def log_error(self, detail: str, tables: list = None):
        self._log("ERROR", tables or [], "error", detail)

    def log_start(self):
        self._log("START", [], "success", f"Agent {self.agent_name} started")

    def log_end(self, duration_ms: int, summary: str = ""):
        self._log("END", [], "success", summary, duration_ms)
