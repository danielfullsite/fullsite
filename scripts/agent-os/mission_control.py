#!/usr/bin/env python3
"""FULLSITE MISSION CONTROL — local founder dashboard for the Agent Company.

- Pure projection of canonical state (PIPELINE.json, TASKS.json, DOMAIN-LOCKS.json,
  HUMAN-QUEUE.json, decisions/, HEARTBEAT.json, AUDIT-LOG.ndjson). NO second
  source of truth: every mutation goes through the existing governance mechanisms
  (update_state, respond_to_decision, complete_human_task).
- stdlib only. Zero model tokens. Localhost only (127.0.0.1).
- Managed by launchd as com.fullsite.mission-control (RunAtLoad + KeepAlive):
  starts at login, survives crashes/supervisor restarts, resumes after sleep.
- Port from docs/agent-os/MISSION-CONTROL.json (default 8890; 8787 deliberately
  avoided — wrangler dev default).
"""
import datetime
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPTS_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_ROOT)

from shared import (
    AOS_ROOT, REPO_ROOT, read_json, load_tasks_index, load_task,
    load_pending_decisions, update_state, load_state, audit, now_iso,
    respond_to_decision, INTEGRATION_BRANCH,
)
import pipeline
import locks as locks_mod
import human_queue

PID_FILE = '/tmp/com.fullsite.mission-control.pid'
HTML_PATH = os.path.join(SCRIPTS_ROOT, 'mission_control.html')
CONFIG = read_json(os.path.join(AOS_ROOT, 'MISSION-CONTROL.json'), {})
PORT = int(os.environ.get('MISSION_CONTROL_PORT', CONFIG.get('port', 8890)))
BIND = '127.0.0.1'

TASK_ACTIVE = {'READY', 'CLAIMED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW',
               'CHANGES_REQUESTED', 'VERIFIED'}

DOMAIN_LABELS = {
    'security-multitenant': 'Security / Multi-tenant',
    'offline-runtime': 'Reliability / Offline',
    'ops-truth': 'Operations Truth',
    'clonability': 'Clonability',
    'observability-release': 'Observability / Release',
    'production': 'Production',
    'field': 'Client #2 / Field',
}

MEANINGFUL_AUDIT = {
    'GATE_STATUS', 'TASK_CLOSED', 'PIPELINE_COMPLETE', 'DECISION_CREATED',
    'DECISION_RESPONSE', 'DECISION_RECLASSIFIED', 'HUMAN_TASK_CREATED',
    'HUMAN_TASK_DONE', 'TARGET_COMPLETE', 'GATE_RECLASSIFIED',
    'DOMAIN_LOCK_RELEASED', 'TELEGRAM_OPTIONAL_DISABLED', 'PAUSED', 'RESUMED',
}


# ── PID lock: no duplicate service after wake/restart ─────────────────────────

def acquire_pid_lock():
    if os.path.exists(PID_FILE):
        try:
            old = int(open(PID_FILE).read().strip())
            os.kill(old, 0)
            print(f'[mission-control] already running (pid {old}); exiting')
            sys.exit(0)
        except (ProcessLookupError, ValueError):
            pass
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))


# ── State projection (read-only over canonical files) ─────────────────────────

def _age_str(iso: str) -> str:
    try:
        dt = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
        s = (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds()
        if s < 90: return f'{int(s)}s'
        if s < 5400: return f'{int(s // 60)}m'
        if s < 172800: return f'{s / 3600:.1f}h'
        return f'{int(s // 86400)}d'
    except Exception:
        return '?'


def _heartbeat():
    return read_json(os.path.join(AOS_ROOT, 'HEARTBEAT.json'), {})


def _company_status(hb, errors):
    state = load_state()
    if state.get('kill_switch'):
        return 'PAUSED'
    try:
        last = datetime.datetime.fromisoformat(
            hb.get('last_heartbeat', '1970-01-01T00:00:00Z').replace('Z', '+00:00'))
        age = (datetime.datetime.now(datetime.timezone.utc) - last).total_seconds()
        if age > 300:
            errors.append(f'Supervisor heartbeat stale ({int(age // 60)} min) — ¿servicio caído?')
            return 'DEGRADED'
    except Exception:
        errors.append('HEARTBEAT.json ilegible')
        return 'DEGRADED'
    if hb.get('errors'):
        return 'DEGRADED'
    return 'ACTIVE'


def _activity():
    path = os.path.join(AOS_ROOT, 'AUDIT-LOG.ndjson')
    items = []
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 120_000))
            lines = f.read().decode('utf-8', 'ignore').splitlines()
    except Exception:
        return []
    for ln in lines[-400:]:
        try:
            e = json.loads(ln)
        except Exception:
            continue
        t = e.get('type')
        if t not in MEANINGFUL_AUDIT:
            continue
        ts = e.get('ts', '')
        if t == 'GATE_STATUS':
            if e.get('to') not in ('PASS', 'FAIL', 'BLOCKED_TECH'):
                continue
            kind = 'pass' if e.get('to') == 'PASS' else 'fail'
            line = f'{e.get("gate_id")} → {e.get("to")}'
        elif t == 'TASK_CLOSED':
            kind, line = 'pass', f'{e.get("task_id")} cerrado (merge {str(e.get("commit"))[:8]})'
        elif t == 'DECISION_CREATED':
            kind, line = 'decision', f'Decisión {e.get("decision_id")} creada'
        elif t == 'DECISION_RESPONSE':
            kind, line = 'decision', f'Decisión {e.get("decision_id")}: {e.get("response")}'
        elif t == 'DECISION_RECLASSIFIED':
            kind, line = 'info', f'{e.get("decision_id")} reclasificada → AUTO_TECH'
        elif t == 'HUMAN_TASK_DONE':
            kind, line = 'pass', f'Tarea física {e.get("gate_id")} completada'
        elif t == 'HUMAN_TASK_CREATED':
            kind, line = 'info', f'Tarea física {e.get("gate_id")} encolada'
        elif t == 'TARGET_COMPLETE':
            kind, line = 'target', f'🏁 TARGET {e.get("target")} COMPLETO'
        elif t in ('PAUSED', 'RESUMED'):
            kind, line = 'info', f'Agent Company {t}'
        else:
            kind, line = 'info', t.replace('_', ' ').title()
        items.append({'ts': ts, 'time': ts[11:16], 'line': line, 'kind': kind})
    return items[-14:][::-1]


def build_state() -> dict:
    errors = []
    out = {'ok': True, 'generated_at': now_iso(), 'errors': errors,
           'telegram': 'OPTIONAL_DISABLED'}
    try:
        p = pipeline.load_pipeline()
        tname, target = pipeline.active_target(p)
        r = pipeline.readiness(p)
    except Exception as e:
        out['ok'] = False
        errors.append(f'PIPELINE.json malformado o ilegible: {e}')
        out['company'] = {'status': 'DEGRADED'}
        return out

    hb = _heartbeat()
    status = _company_status(hb, errors)
    out['company'] = {
        'status': status,
        'supervisor_status': hb.get('supervisor_status', '?'),
        'pid': hb.get('pid'),
        'heartbeat_age': _age_str(hb.get('last_heartbeat', '')),
        'hb_errors': hb.get('errors', [])[-3:],
    }
    out['target'] = {
        'name': tname, 'title': (target or {}).get('title', ''),
        'date': r.get('target_date'), 'pass': r['required_pass'],
        'total': r['required_total'], 'pct': r['pct'],
        'complete': r.get('complete', False),
    }

    # Tasks / working now
    index = load_tasks_index()
    working, agents_busy = [], {}
    for tid, m in sorted(index.items()):
        if m['status'] not in TASK_ACTIVE:
            continue
        gate_tags = [t[5:] for t in m.get('tags', []) if t.startswith('gate:')]
        domain = next((t for t in m.get('tags', []) if not t.startswith('gate:')), '')
        working.append({'task': tid, 'gate': gate_tags[0] if gate_tags else None,
                        'domain': DOMAIN_LABELS.get(domain, domain),
                        'state': m['status'], 'title': m['title'][:80],
                        'elapsed': _age_str(m.get('updated_at', ''))})
        agents_busy[domain] = {'task': tid, 'state': m['status'],
                               'gate': gate_tags[0] if gate_tags else None}

    lk = locks_mod.load_locks()
    gates = (target or {}).get('gates', {})
    for gid, g in gates.items():
        if g.get('status') == 'RUNNING' and str(g.get('owner', '')).startswith('EXTERNAL'):
            working.append({'task': gid, 'gate': gid,
                            'domain': DOMAIN_LABELS.get(g.get('domain'), g.get('domain')),
                            'state': 'EXTERNAL OWNER', 'title': g['title'][:80],
                            'elapsed': _age_str(g.get('updated_at', ''))})
    out['working'] = working

    # Actions for Daniel
    hq = human_queue.load_queue()
    packs = {}
    for gid, t in hq.items():
        if t['status'] != 'PENDING':
            continue
        loc = t.get('location', 'AMALAY')
        packs.setdefault(loc, {'location': loc, 'minutes': 0, 'tasks': []})
        try:
            packs[loc]['minutes'] += int(str(t.get('estimated_time', '15')).split()[0])
        except Exception:
            packs[loc]['minutes'] += 15
        packs[loc]['tasks'].append({k: t.get(k) for k in (
            'gate_id', 'title', 'why', 'estimated_time', 'preparation_completed',
            'do_exactly', 'expected_result', 'return_evidence', 'safe_failure',
            'actionable_now')})
    field_packs = list(packs.values())
    for fp in field_packs:
        fp['actionable_now'] = all(t.get('actionable_now') for t in fp['tasks'])
        fp['gates_unlocked'] = [t['gate_id'] for t in fp['tasks']]

    decisions = []
    for d in load_pending_decisions():
        gid = d.get('gate_id')
        g = gates.get(gid, {}) if gid else {}
        decisions.append({
            'id': d['id'], 'gate_id': gid,
            'objective': d.get('objective', ''),
            'why': d.get('why_it_matters', ''),
            'what_changed': d.get('what_changed', ''),
            'risk': d.get('risk', ''), 'verification': d.get('verification', ''),
            'action': d.get('action_requested', ''),
            'production': g.get('execution_class') == 'PRODUCTION_APPROVAL'
                          or 'PRODUCCIÓN' in str(d.get('action_requested', '')).upper(),
            'blocks': gid or d.get('task_id', ''),
            'created': _age_str(d.get('created_at', '')),
        })
    prod_approvals = [d for d in decisions if d['production']]
    founder_decisions = [d for d in decisions if not d['production']]

    out['actions'] = {
        'field_packs': field_packs,
        'decisions': founder_decisions,
        'production': prod_approvals,
        'none': not field_packs and not decisions,
    }
    out['cards'] = {
        'gates': f'{r["required_pass"]}/{r["required_total"]}',
        'active_agents': len([w for w in working if w['state'] not in ('EXTERNAL OWNER',)]),
        'needs_daniel': len(field_packs) + len(decisions),
        'tech_blockers': len(r.get('blocked_tech', [])),
        'prod_approvals': len(prod_approvals),
    }

    # Pipeline grouped by domain
    grouped = {}
    for gid, g in gates.items():
        dom = DOMAIN_LABELS.get(g.get('domain'), g.get('domain') or 'Otros')
        st = g.get('status')
        if st in ('BACKLOG',) and not pipeline.deps_met(g, gates):
            st = 'WAITING_DEPENDENCY'
        grouped.setdefault(dom, []).append({
            'id': gid, 'title': g['title'], 'status': st,
            'required': g.get('criticality', 'REQUIRED') == 'REQUIRED',
            'owner': g.get('owner'), 'deps': g.get('dependencies', []),
            'cert_level': g.get('cert_level'),
            'has_evidence': bool(g.get('evidence')),
            'human': bool(g.get('requires_human')),
            'exec_class': g.get('execution_class'),
            'updated': _age_str(g.get('updated_at', '')),
        })
    out['pipeline'] = grouped

    # Agents (logical roles; IDLE when no work — never invented activity)
    role_domains = [
        ('CEO / Orchestrator', None), ('Security', 'security-multitenant'),
        ('Reliability / Offline', 'offline-runtime'), ('Operations Truth', 'ops-truth'),
        ('Clonability', 'clonability'), ('SRE / Release', 'observability-release'),
        ('QA / Red Team', '_verify'), ('Innovation', '_innovation'),
    ]
    agents = []
    hb_workers = hb.get('active_workers', {})
    for role, dom in role_domains:
        if role == 'CEO / Orchestrator':
            agents.append({'role': role, 'state': out['company']['supervisor_status'],
                           'task': hb.get('next_action', ''), 'branch': None})
        elif dom == '_verify':
            v = [k for k, w in hb_workers.items() if w.get('phase') == 'verify']
            agents.append({'role': role, 'state': 'REVIEWING' if v else 'IDLE',
                           'task': v[0] if v else '', 'branch': None})
        elif dom == '_innovation':
            agents.append({'role': role, 'state': 'IDLE', 'task': '', 'branch': None})
        elif dom in lk and lk[dom].get('kind') == 'EXTERNAL':
            agents.append({'role': role, 'state': 'EXTERNAL OWNER',
                           'task': lk[dom].get('note', '')[:70],
                           'branch': lk[dom].get('branch')})
        elif dom in agents_busy:
            b = agents_busy[dom]
            agents.append({'role': role, 'state': b['state'], 'task': f'{b["task"]} · {b.get("gate") or ""}',
                           'branch': f'agent-os/{b["task"]}'})
        else:
            agents.append({'role': role, 'state': 'IDLE', 'task': '', 'branch': None})
    out['agents'] = agents

    # Locks
    out['locks'] = [{'domain': d, 'label': DOMAIN_LABELS.get(d, d),
                     'owner': l.get('owner'), 'kind': l.get('kind'),
                     'branch': l.get('branch'), 'note': l.get('note', '')[:120]}
                    for d, l in lk.items()]

    # Release view
    def _gate_view(gid):
        g = gates.get(gid, {})
        ev = (g.get('evidence') or [{}])[-1]
        return {'id': gid, 'status': g.get('status'), 'cert_level': g.get('cert_level'),
                'note': str(ev.get('note', ''))[:160]}
    integration = {}
    try:
        r2 = subprocess.run(['git', 'log', '--oneline', '-1', INTEGRATION_BRANCH],
                            cwd=REPO_ROOT, capture_output=True, text=True, timeout=5)
        ahead = subprocess.run(['git', 'rev-list', '--count', f'HEAD..{INTEGRATION_BRANCH}'],
                               cwd=REPO_ROOT, capture_output=True, text=True, timeout=5)
        integration = {'head': r2.stdout.strip()[:80],
                       'commits_ahead': ahead.stdout.strip()}
    except Exception:
        pass
    out['release'] = {
        'frozen_release': next((l.get('branch') for l in lk.values()
                                if str(l.get('owner', '')).startswith('FROZEN')), None),
        'installer': _gate_view('REL-INSTALLER'),
        'offline_field': _gate_view('REL-OFFLINE-FIELD'),
        'print_once': _gate_view('REL-PRINT-EXACTLY-ONCE'),
        'bug019': _gate_view('SEC-BUG019'),
        'wave1': _gate_view('OPS-W1-TRUTH-CHAIN'),
        'rollback': _gate_view('REL-ROLLBACK'),
        'go_live': _gate_view('GO-LIVE-CLIENT2'),
        'integration': integration,
    }
    out['activity'] = _activity()
    return out


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = 'MissionControl/1.0'

    def _localhost_only(self) -> bool:
        host = (self.headers.get('Host') or '').split(':')[0]
        return host in ('127.0.0.1', 'localhost', '::1', '')

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._localhost_only():
            return self._json({'error': 'forbidden'}, 403)
        if self.path.split('?')[0] in ('/', '/index.html'):
            try:
                body = open(HTML_PATH, 'rb').read()
            except Exception as e:
                return self._json({'error': f'html missing: {e}'}, 500)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith('/api/state'):
            try:
                self._json(build_state())
            except Exception as e:
                self._json({'ok': False, 'errors': [f'state build error: {e}'],
                            'company': {'status': 'DEGRADED'}})
        else:
            self._json({'error': 'not found'}, 404)

    def do_POST(self):
        if not self._localhost_only():
            return self._json({'error': 'forbidden'}, 403)
        length = int(self.headers.get('Content-Length') or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            payload = {}
        path = self.path.split('?')[0]
        try:
            if path == '/api/pause':
                update_state({'kill_switch': True, 'notes': 'PAUSED via Mission Control'})
                audit('PAUSED', {'by': 'FOUNDER', 'via': 'mission-control'})
                return self._json({'ok': True})
            if path == '/api/resume':
                update_state({'kill_switch': False, 'notes': ''})
                audit('RESUMED', {'by': 'FOUNDER', 'via': 'mission-control'})
                return self._json({'ok': True})
            if path == '/api/human-done':
                gid = payload.get('gate_id')
                ev = (payload.get('evidence') or '').strip()
                if not gid or not ev:
                    return self._json({'ok': False, 'error': 'gate_id y evidencia requeridos'}, 400)
                human_queue.complete_human_task(gid, ev, by='FOUNDER')
                human_queue.render_field_visit_pack()
                return self._json({'ok': True})
            if path == '/api/decision':
                did = payload.get('decision_id')
                resp = payload.get('response')
                if resp not in ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'):
                    return self._json({'ok': False, 'error': 'response inválida'}, 400)
                # Canonical governance path ONLY. The supervisor observes the
                # response and executes per existing gates — the UI never
                # mutates product, branches or production directly.
                respond_to_decision(did, resp, notes=payload.get('notes', ''),
                                    by='FOUNDER(mission-control)')
                return self._json({'ok': True})
            return self._json({'error': 'not found'}, 404)
        except Exception as e:
            return self._json({'ok': False, 'error': str(e)[:300]}, 500)

    def log_message(self, *args):
        pass  # quiet; audit trail lives in canonical files


def main():
    acquire_pid_lock()
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f'[mission-control] http://{BIND}:{PORT} (pid {os.getpid()})', flush=True)
    try:
        server.serve_forever()
    finally:
        try:
            if int(open(PID_FILE).read().strip()) == os.getpid():
                os.unlink(PID_FILE)
        except Exception:
            pass


if __name__ == '__main__':
    main()
