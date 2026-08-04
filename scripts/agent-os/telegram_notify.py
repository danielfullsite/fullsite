"""
Telegram notifications for Agent OS — send-only, non-blocking.

Token loading priority:
  1. TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID_DANIEL env vars
  2. ~/.agent-os.env  (KEY=VALUE, gitignored, chmod 600)

Allowed events (all others silently suppressed):
  TASK_CLOSED       — important task completed autonomously
  TASK_BLOCKED      — task blocked after max retries → human needed
  DECISION_REQUIRED — Founder decision waiting
  SUPERVISOR_CRASH  — supervisor restarted after abnormal exit (SIGKILL)
  WAITING_FIELD     — all queued work finished, system idle

NOT sent: heartbeats, cycle starts, claims, retries, progress logs.
Deduplication: same event+task_id won't repeat within dedup_ttl_s (default 1h).
Dedup file lives in docs/agent-os/ (persistent across reboots — not /tmp).
Failures: fully swallowed — never raises, never blocks supervisor loop.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

_REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
# Persistent dedup — survives supervisor restarts and machine reboots.
# Previously used /tmp/ which was cleared between restarts, bypassing dedup.
_DEDUP_FILE = _REPO_ROOT / 'docs' / 'agent-os' / '.notified.json'
_SECRETS_FILE = pathlib.Path.home() / '.agent-os.env'

ALLOWED_EVENTS = frozenset({
    'TASK_CLOSED',
    'TASK_BLOCKED',
    'DECISION_REQUIRED',
    'SUPERVISOR_CRASH',
    'WAITING_FIELD',
})


# ── Token loading ─────────────────────────────────────────────────────────────

def _load_secrets() -> tuple:
    """Return (token, chat_id). Both '' if not configured."""
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.environ.get('TELEGRAM_CHAT_ID_DANIEL', '')

    if not token or not chat_id:
        try:
            for line in _SECRETS_FILE.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k == 'TELEGRAM_BOT_TOKEN' and not token:
                    token = v
                elif k == 'TELEGRAM_CHAT_ID_DANIEL' and not chat_id:
                    chat_id = v
        except Exception:
            pass

    return token, chat_id


# ── HTTP send ─────────────────────────────────────────────────────────────────

_REPO = 'ramonfaurdaniel-png/fullsite'
_NOTIFY_WORKFLOW = 'agent-os-notify.yml'


def _send_raw(token: str, chat_id: str, text: str) -> bool:
    """Direct HTTP to Telegram API. Returns True on 200."""
    url = f'https://api.telegram.org/bot{token}/sendMessage'
    payload = json.dumps({
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'HTML',
    }).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
            return resp.status == 200 and body.get('ok', False)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return False  # token invalid — caller falls back to GHA
        return False
    except Exception:
        return False


def _gh_path() -> str:
    """Resolve gh CLI path — handles launchd's restricted PATH."""
    gh = shutil.which('gh')
    if gh:
        return gh
    for candidate in ('/opt/homebrew/bin/gh', '/usr/local/bin/gh'):
        if os.path.isfile(candidate):
            return candidate
    return 'gh'


def _send_via_gha(event_type: str, text: str) -> bool:
    """Fallback: dispatch agent-os-notify.yml via gh CLI (async, ~30-60s delivery)."""
    try:
        result = subprocess.run(
            [
                _gh_path(), 'workflow', 'run', _NOTIFY_WORKFLOW,
                '--repo', _REPO,
                '--field', f'event_type={event_type}',
                '--field', f'text={text}',
            ],
            capture_output=True, text=True, timeout=20,
        )
        return result.returncode == 0
    except Exception:
        return False


# ── Deduplication ─────────────────────────────────────────────────────────────

def _load_dedup() -> dict:
    try:
        return json.loads(_DEDUP_FILE.read_text())
    except Exception:
        return {}


def _save_dedup(data: dict):
    try:
        _DEDUP_FILE.write_text(json.dumps(data))
    except Exception:
        pass


# ── Public API ────────────────────────────────────────────────────────────────

def notify(event_type: str, details: dict = None, dedup_ttl_s: int = 3600) -> bool:
    """
    Send a Telegram notification for event_type.
    Non-blocking: never raises. Returns True if message was sent.
    """
    if event_type not in ALLOWED_EVENTS:
        return False

    token, chat_id = _load_secrets()
    if not token or not chat_id:
        return False

    details = details or {}
    dedup_key = f'{event_type}:{details.get("task_id", "")}'

    dedup = _load_dedup()
    now = time.time()
    if now - dedup.get(dedup_key, 0) < dedup_ttl_s:
        return False  # already sent recently

    text = _format_message(event_type, details)
    if not text:
        return False

    # Try direct HTTP first; fall back to gh workflow run if token invalid/missing
    ok = False
    if token and chat_id:
        ok = _send_raw(token, chat_id, text)
    if not ok:
        ok = _send_via_gha(event_type, text)

    if ok:
        dedup[dedup_key] = now
        dedup = {k: v for k, v in dedup.items() if now - v < 86400}
        _save_dedup(dedup)

    return ok


# ── Git commit validation ─────────────────────────────────────────────────────

def _is_real_git_commit(commit: str) -> bool:
    """Return True only if commit is a hex string resolvable in the repo via git cat-file -e."""
    if not commit or not isinstance(commit, str):
        return False
    # Basic hex format: 7–40 lowercase hex chars
    if not re.fullmatch(r'[0-9a-f]{7,40}', commit.strip().lower()):
        return False
    try:
        r = subprocess.run(
            ['git', 'cat-file', '-e', commit.strip()],
            cwd=str(_REPO_ROOT), capture_output=True, timeout=5,
        )
        return r.returncode == 0
    except Exception:
        return False


def _safe_commit_display(commit) -> str:
    """Return first 12 chars if commit is a real git object, else a warning token."""
    if not commit:
        return '?'
    s = str(commit).strip()
    if _is_real_git_commit(s):
        return s[:12]
    return '⚠️unverified'


# ── Message templates ─────────────────────────────────────────────────────────

def _format_message(event_type: str, d: dict) -> str:
    tid = d.get('task_id', '')
    title = d.get('title', '')

    if event_type == 'TASK_CLOSED':
        merge_commit = d.get('commit')
        eng_commit = d.get('engineer_commit')

        merge_disp = _safe_commit_display(merge_commit)
        eng_disp = _safe_commit_display(eng_commit)

        # Show both hashes when they differ (engineer branch commit vs merge commit)
        if eng_commit and merge_commit and eng_commit != merge_commit:
            commit_line = (
                f"Engineer: <code>{eng_disp}</code> · "
                f"Merge: <code>{merge_disp}</code>"
            )
        else:
            # Fall back to whichever is available
            disp = merge_disp if merge_commit else eng_disp
            commit_line = f"Commit: <code>{disp}</code>"

        return (
            f"✅ <b>Tarea completada</b>\n"
            f"<code>{tid}</code> {title}\n"
            f"{commit_line}"
        )

    if event_type == 'TASK_BLOCKED':
        reason = d.get('reason', 'max retries agotados')
        return (
            f"🚫 <b>Tarea bloqueada — requiere atención</b>\n"
            f"<code>{tid}</code> {title}\n"
            f"Razón: {reason}"
        )

    if event_type == 'DECISION_REQUIRED':
        did = d.get('decision_id', '?')
        return (
            f"⚠️ <b>Decisión de Founder requerida</b>\n"
            f"<code>{did}</code> → tarea <code>{tid}</code>\n"
            f"{title}\n"
            f"<code>python scripts/agent-os/approve_decision.py {did}</code>"
        )

    if event_type == 'SUPERVISOR_CRASH':
        pid = d.get('pid', '?')
        runs = d.get('runs', '?')
        return (
            f"🔄 <b>Agent OS reiniciado (crash recovery)</b>\n"
            f"PID nuevo: <code>{pid}</code> · reinicios launchd: {runs}\n"
            f"Estado recuperado — esperando tareas"
        )

    if event_type == 'WAITING_FIELD':
        completed = d.get('completed', [])
        ts = d.get('completed', [])
        tasks_str = ' '.join(f'<code>{t}</code>' for t in completed) if completed else '—'
        return (
            f"🏁 <b>Ciclo completado — WAITING_FIELD</b>\n"
            f"Tareas cerradas: {tasks_str}\n"
            f"Sin trabajo pendiente en cola"
        )

    return ''
