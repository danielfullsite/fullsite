#!/usr/bin/env python3
"""Mission Control certification — 24-point proof against a sandbox state root.

Spins the real server (subprocess) over sandbox canonical files and verifies
projection fidelity, governance write-through, safety, and failure modes.
Zero tokens, zero product/production mutation.
"""
import os, sys, json, shutil, subprocess, tempfile, time, urllib.request, socket, signal

SB = tempfile.mkdtemp(prefix='mission-control-cert-')
REPO = os.path.join(SB, 'repo'); STATE = os.path.join(SB, 'state')
os.makedirs(REPO); os.makedirs(STATE)
subprocess.run(['git', 'init', '-q', '-b', 'master', REPO], check=True)
subprocess.run(['git', '-C', REPO, 'config', 'user.email', 'c@f.mx'], check=True)
subprocess.run(['git', '-C', REPO, 'config', 'user.name', 'c'], check=True)
open(os.path.join(REPO, 'x'), 'w').write('x')
subprocess.run(['git', '-C', REPO, 'add', '-A'], check=True)
subprocess.run(['git', '-C', REPO, 'commit', '-q', '-m', 'init'], check=True)

ENV = {**os.environ,
       'AGENT_OS_REPO_ROOT': REPO, 'AGENT_OS_STATE_ROOT': STATE,
       'AGENT_OS_TELEGRAM_DRYRUN': os.path.join(SB, 'tg.ndjson'),
       'MISSION_CONTROL_PORT': '0'}  # replaced below

os.environ.update(ENV)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shared, pipeline, locks, human_queue
shared.ensure_dirs()
TS = shared.now_iso()

# Seed sandbox canonical state
pipeline.save_pipeline({'version': 1, 'active_target': 'MC_TEST', 'targets': {'MC_TEST': {
    'title': 'MC cert', 'target_date': '2026-08-09', 'gates': {
        'G-PASS': {'title': 'done gate', 'domain': 'clonability', 'status': 'PASS',
                   'criticality': 'REQUIRED', 'dependencies': [], 'execution_class': 'AUTO_TECH',
                   'cert_level': 'SOFTWARE', 'evidence': [{'ts': TS, 'note': 'ok'}], 'updated_at': TS},
        'G-RUN': {'title': 'working gate', 'domain': 'clonability', 'status': 'RUNNING',
                  'criticality': 'REQUIRED', 'dependencies': [], 'execution_class': 'AUTO_TECH',
                  'cert_level': 'SOFTWARE', 'evidence': [], 'updated_at': TS},
        'G-HUM': {'title': 'physical gate', 'domain': 'field', 'status': 'BLOCKED_HUMAN',
                  'criticality': 'REQUIRED', 'dependencies': [], 'execution_class': 'HUMAN_PHYSICAL',
                  'cert_level': 'PHYSICAL', 'requires_human': True, 'evidence': [], 'updated_at': TS},
    }}}})
locks.acquire('security-multitenant', owner='EXTERNAL:test', kind='EXTERNAL')
task = shared.create_task('working task', 'obj', 'RUNTIME_ENGINEER',
                          tags=['gate:G-RUN', 'clonability'], gate_id='G-RUN', domain=None)
shared.transition_task(task['id'], 'CLAIMED'); shared.transition_task(task['id'], 'IN_PROGRESS')
human_queue.ensure_human_task('G-HUM', {'title': 'ir al sitio', 'location': 'AMALAY',
    'why': 'probar', 'do_exactly': ['paso uno secreto-visible-check'], 'expected_result': 'ok',
    'return_evidence': 'foto', 'safe_failure': 'nada', 'estimated_time': '10 min'})
dec = shared.create_decision(task_id=None, objective='decision de prueba',
                             what_changed='x', why_it_matters='y', skip_gap_gate=True)
# heartbeat fresh
shared.write_json(os.path.join(STATE, 'HEARTBEAT.json'),
                  {'supervisor_status': 'IDLE', 'pid': 999, 'last_heartbeat': shared.now_iso(),
                   'active_workers': {}, 'errors': []})

# Pick free port
s = socket.socket(); s.bind(('127.0.0.1', 0)); PORT = s.getsockname()[1]; s.close()
ENV['MISSION_CONTROL_PORT'] = str(PORT)

SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mission_control.py')
proc = subprocess.Popen([sys.executable, SERVER], env=ENV,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

def get(path):
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=5) as r:
        return json.loads(r.read()) if path.startswith('/api') else r.read().decode()

def post(path, body):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}',
                                 data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

RESULTS = []
def check(n, ok, d=''):
    RESULTS.append((n, ok, d))
    print(f'  {"PASS" if ok else "FAIL"}  {n}' + (f' — {d}' if d and not ok else ''))

for _ in range(40):
    time.sleep(0.25)
    try:
        get('/api/state'); break
    except Exception: pass

print('[MC certification]')
st = get('/api/state')
r = pipeline.readiness()

# 1 launch-with-company: real install uses launchd (verified live); here: server up
check('1. server launches', st.get('ok') is True)
# 2 localhost only: bind address + Host check
import socket as _s
ext_ips = [i[4][0] for i in _s.getaddrinfo(_s.gethostname(), None) if i[4][0] not in ('127.0.0.1', '::1')]
bound_external = False
for ip in ext_ips[:2]:
    try:
        _c = _s.create_connection((ip, PORT), timeout=1); _c.close(); bound_external = True
    except Exception: pass
check('2. localhost-only bind (no external interface)', not bound_external)
try:
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/state', headers={'Host': 'evil.com'})
    code = urllib.request.urlopen(req, timeout=5).status
except urllib.error.HTTPError as e: code = e.code
check('2b. foreign Host header rejected', code == 403)
# 6/7 canonical pipeline + counts match CLI/readiness exactly
check('6. reads canonical PIPELINE', st['target']['name'] == 'MC_TEST')
check('7. gate counts match readiness() exactly',
      st['target']['pass'] == r['required_pass'] and st['target']['total'] == r['required_total'],
      f"ui={st['target']['pass']}/{st['target']['total']} cli={r['required_pass']}/{r['required_total']}")
# 8 active tasks
check('8. active tasks match Agent OS state',
      any(w['task'] == task['id'] and w['state'] == 'IN_PROGRESS' for w in st['working']))
# 9 locks
check('9. locks match DOMAIN-LOCKS',
      any(l['domain'] == 'security-multitenant' and l['kind'] == 'EXTERNAL' for l in st['locks']))
# 10/11 human queue + field pack render
fp = st['actions']['field_packs']
check('10. human queue matches canonical state', len(fp) == 1 and fp[0]['gates_unlocked'] == ['G-HUM'])
check('11. field pack renders full instructions',
      'secreto-visible-check' in json.dumps(fp))
# 12 decision renders
check('12. founder decision renders', any(d['id'] == dec['id'] for d in st['actions']['decisions']))
# 13 decision response through canonical mechanism
post('/api/decision', {'decision_id': dec['id'], 'response': 'REJECTED', 'notes': 'cert'})
dfile = shared.read_json(os.path.join(STATE, 'decisions', f'{dec["id"]}.json'))
check('13. decision writes through governance (file+audit)',
      dfile.get('response') == 'REJECTED')
audit_txt = open(os.path.join(STATE, 'AUDIT-LOG.ndjson')).read()
check('13b. audit trail records response', '"DECISION_RESPONSE"' in audit_txt and dec['id'] in audit_txt)
# 14 no direct production mutation endpoint
src = open(SERVER).read()
check('14. no direct prod mutation path (approval = governance event only)',
      'respond_to_decision' in src and 'supabase' not in src.lower()
      and 'vercel' not in src.lower() and 'push' not in src)
# 15/16 pause/resume
post('/api/pause', {})
check('15. PAUSE works (kill_switch on)', shared.load_state()['kill_switch'] is True)
st2 = get('/api/state')
check('15b. UI reflects PAUSED', st2['company']['status'] == 'PAUSED')
post('/api/resume', {})
check('16. RESUME works', shared.load_state()['kill_switch'] is False)
# 17 auto refresh + 22 responsive (structural)
html = get('/')
check('17. auto-refresh present', 'setInterval(refresh' in html)
check('22. responsive layout (viewport + media queries)',
      'viewport' in html and '@media' in html)
# 18 zero tokens
check('18. zero model tokens (no model invocation in server)',
      'claude' not in src and 'anthropic' not in src.lower() and 'groq' not in src.lower())
# 19 telegram down irrelevant
check('19. telegram OPTIONAL_DISABLED does not degrade dashboard',
      st['telegram'] == 'OPTIONAL_DISABLED' and st['ok'])
# 20 no secrets rendered
blob = json.dumps(st)
check('20. no secret/token rendered',
      'TELEGRAM_BOT_TOKEN' not in blob and 'agent-os.env' not in blob
      and 'service_role' not in blob and 'SUPABASE' not in blob.upper().replace('SUPABASE-', ''))
# 21 no production data: projection contains only agent-os state paths
check('21. no production data exposed (state is agent-os projection only)',
      'wansoft' not in blob.lower() and 'amalay_reservaciones' not in blob)
# 23 founder actions survive restart
proc.terminate(); proc.wait(timeout=10)
proc = subprocess.Popen([sys.executable, SERVER], env=ENV,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
for _ in range(40):
    time.sleep(0.25)
    try: st3 = get('/api/state'); break
    except Exception: pass
check('3/23. survives restart; founder actions persisted',
      shared.read_json(os.path.join(STATE, 'decisions', f'{dec["id"]}.json')).get('response') == 'REJECTED'
      and st3['ok'])
# 5 duplicate service prevention (PID lock)
dup = subprocess.run([sys.executable, SERVER], env=ENV, capture_output=True, text=True, timeout=15)
check('5. no duplicate service (PID lock exits cleanly)',
      dup.returncode == 0 and 'already running' in dup.stdout)
# 24 malformed state fails visibly, not false PASS
open(os.path.join(STATE, 'PIPELINE.json'), 'w').write('{corrupt')
st4 = get('/api/state')
check('24. malformed state → visible failure (ok:false), no false PASS',
      st4.get('ok') is False and st4['company']['status'] == 'DEGRADED'
      and 'target' not in st4)
proc.terminate()

failed = [(n, d) for n, ok, d in RESULTS if not ok]
print(f'\n  {len(RESULTS) - len(failed)}/{len(RESULTS)} checks PASS')
if failed:
    for n, d in failed: print(f'   FAIL {n}: {d}')
    print(f'  sandbox kept: {SB}'); sys.exit(1)
print('  MISSION CONTROL: CERTIFIED')
shutil.rmtree(SB, ignore_errors=True)
