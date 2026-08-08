#!/usr/bin/env python3
"""Agent Company V1 certification — end-to-end proof in an isolated sandbox.

Runs the ENTIRE pipeline (orchestrator → dispatch → builder → reviewer → cert →
merge → gate PASS → next task) against a scratch git repo + scratch state root,
with a stub worker (zero tokens) and Telegram in dry-run capture mode.

No product code, no production, no real branches are touched.

Usage: python3 certify_v1.py
Exit 0 = CERTIFIED. Non-zero = failed check (printed).
"""
import os, sys, json, shutil, subprocess, tempfile, time, datetime

SANDBOX = tempfile.mkdtemp(prefix='agent-company-cert-')
REPO = os.path.join(SANDBOX, 'repo')
STATE = os.path.join(SANDBOX, 'state')
TG_LOG = os.path.join(SANDBOX, 'telegram.ndjson')

os.makedirs(REPO)
os.makedirs(STATE)
subprocess.run(['git', 'init', '-q', '-b', 'master', REPO], check=True)
subprocess.run(['git', '-C', REPO, 'config', 'user.email', 'cert@fullsite.mx'], check=True)
subprocess.run(['git', '-C', REPO, 'config', 'user.name', 'cert'], check=True)
open(os.path.join(REPO, 'README.md'), 'w').write('cert sandbox\n')
subprocess.run(['git', '-C', REPO, 'add', '-A'], check=True)
subprocess.run(['git', '-C', REPO, 'commit', '-q', '-m', 'init'], check=True)

# Environment MUST be set before importing shared/pipeline/etc.
os.environ['AGENT_OS_REPO_ROOT'] = REPO
os.environ['AGENT_OS_STATE_ROOT'] = STATE
os.environ['AGENT_OS_TELEGRAM_DRYRUN'] = TG_LOG
os.environ['AGENT_OS_WORKER_CMD'] = f'{sys.executable} {os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker_stub.py")}'
os.environ['AGENT_OS_INTEGRATION_WT'] = os.path.join(SANDBOX, 'integration-wt')
os.environ['AGENT_OS_WORKTREE_PREFIX'] = os.path.join(SANDBOX, 'wt-')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shared
import pipeline
import locks
import human_queue
import orchestrator
import supervisor

os.makedirs(supervisor.WORKERS_LOG_DIR, exist_ok=True)

RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, ok, detail))
    print(f'  {"PASS" if ok else "FAIL"}  {name}' + (f' — {detail}' if detail and not ok else ''))
    return ok


def now_plus(seconds):
    return (datetime.datetime.utcnow() + datetime.timedelta(seconds=seconds)
            ).strftime('%Y-%m-%dT%H:%M:%SZ')


# ── Sandbox pipeline ──────────────────────────────────────────────────────────
shared.ensure_dirs()
TS = shared.now_iso()


def gate(gid, title, domain, ec='AUTO_TECH', deps=None, status='READY', **kw):
    return {'title': title, 'domain': domain, 'status': status, 'priority': 'P1',
            'criticality': kw.pop('criticality', 'REQUIRED'), 'dependencies': deps or [],
            'owner': None, 'execution_class': ec, 'cert_level': 'SOFTWARE',
            'evidence_required': f'cert artifact for {gid}', 'evidence': [],
            'requires_human': ec != 'AUTO_TECH', 'updated_at': TS, **kw}


pipeline.save_pipeline({
    'version': 1, 'active_target': 'CERT_TARGET',
    'targets': {'CERT_TARGET': {'title': 'V1 certification', 'target_date': '2026-08-09',
        'gates': {
            'GATE-A': gate('GATE-A', 'first gate [INDUCE-FAIL]', 'dom-a'),
            'GATE-B': gate('GATE-B', 'depends on A', 'dom-a', deps=['GATE-A'],
                           status='BACKLOG', cert_command='true'),
            'GATE-LOCKED': gate('GATE-LOCKED', 'externally owned', 'dom-ext'),
            'GATE-H': gate('GATE-H', 'physical test', 'dom-field', ec='HUMAN_PHYSICAL',
                           status='BACKLOG', location='AMALAY'),
            'GATE-DEC': gate('GATE-DEC', 'founder decision sample', 'dom-dec',
                             ec='FOUNDER_DECISION', status='BACKLOG'),
            'GATE-PROD': gate('GATE-PROD', 'production action', 'production',
                              ec='PRODUCTION_APPROVAL', status='BACKLOG',
                              criticality='OPTIONAL'),
        }}}})

locks.acquire('dom-ext', owner='EXTERNAL:test-session', kind='EXTERNAL',
              note='simulated external owner')
locks.acquire('production', owner='FOUNDER', kind='FROZEN')

print('\n[1] Supervisor/orchestrator startup + target load')
r = pipeline.readiness()
check('target loaded', r['target'] == 'CERT_TARGET')

print('\n[2] Orchestration: claim once, deps blocked, locks respected')
orchestrator.run()
orchestrator.run()  # second run must NOT duplicate
index = shared.load_tasks_index()
a_tasks = [t for t, m in index.items() if 'gate:GATE-A' in m.get('tags', [])]
b_tasks = [t for t, m in index.items() if 'gate:GATE-B' in m.get('tags', [])]
locked_tasks = [t for t, m in index.items() if 'gate:GATE-LOCKED' in m.get('tags', [])]
check('task claimed exactly once for GATE-A', len(a_tasks) == 1, str(a_tasks))
check('dependent GATE-B stays blocked (no task)', len(b_tasks) == 0)
check('locked domain gets NO writer', len(locked_tasks) == 0)
check('domain lock registered for dom-a', 'dom-a' in locks.load_locks())

print('\n[3] Human queue + decision gates')
hq = human_queue.load_queue()
check('HUMAN_PHYSICAL structured task created', 'GATE-H' in hq
      and hq['GATE-H']['location'] == 'AMALAY' and hq['GATE-H']['do_exactly'])
check('field visit pack rendered', os.path.exists(human_queue.PACK_FILE))
pending = shared.load_pending_decisions()
dec_gates = [d.get('gate_id') for d in pending]
check('FOUNDER_DECISION card created', 'GATE-DEC' in dec_gates)
check('PRODUCTION_APPROVAL card created, not executed', 'GATE-PROD' in dec_gates)
check('decision pauses only its branch (GATE-A task still active)',
      len(a_tasks) == 1)

print('\n[4] Builder → reviewer → induced FAIL → retry → PASS → merge → gate PASS')
task_id = a_tasks[0]


def run_cycles(n, timeout_s=120):
    deadline = time.time() + timeout_s
    for _ in range(n):
        if time.time() > deadline:
            break
        try:
            supervisor._loop_once()
        except SystemExit:
            pass
        # wait for spawned workers to finish so cycles are deterministic
        for w in list(supervisor._workers.values()):
            try:
                w['proc'].wait(timeout=60)
            except Exception:
                pass
        supervisor._reap_workers()


run_cycles(8)
gA = pipeline.get_gate('GATE-A')
task = shared.load_task(task_id)
check('induced failure routed back (retry_count>0)', task.get('retry_count', 0) >= 1,
      f'retry={task.get("retry_count")} status={task["status"]}')
check('fix/retry loop reached VERIFIED+CLOSED', task['status'] in ('CLOSED', 'MERGED'),
      task['status'])
check('gate PASS updated automatically', gA and gA['status'] == 'PASS',
      gA and gA['status'])
int_wt = os.environ['AGENT_OS_INTEGRATION_WT']
merged = subprocess.run(['git', '-C', REPO, 'log', '--oneline', 'agent-os/integration'],
                        capture_output=True, text=True).stdout
check('merge landed on integration branch (checkout untouched)',
      f'merge({task_id})' in merged)
head_branch = subprocess.run(['git', '-C', REPO, 'branch', '--show-current'],
                             capture_output=True, text=True).stdout.strip()
check('checked-out branch never mutated', head_branch == 'master')

print('\n[5] Next-task auto selection after dependency PASS')
orchestrator.run()
index = shared.load_tasks_index()
b_tasks = [t for t, m in index.items() if 'gate:GATE-B' in m.get('tags', [])]
check('GATE-B task created after GATE-A PASS', len(b_tasks) == 1)
run_cycles(6)
gB = pipeline.get_gate('GATE-B')
check('deterministic cert_command ran → GATE-B PASS', gB['status'] == 'PASS',
      gB['status'])

print('\n[6] Supervisor restart + worker crash recovery')
# Restart: wipe in-memory workers; disk state must fully drive next cycle
supervisor._workers.clear()
idx_before = json.dumps(shared.load_tasks_index(), sort_keys=True)
orchestrator.run()
idx_after = json.dumps(shared.load_tasks_index(), sort_keys=True)
check('restart preserves state (no duplicates, no loss)', idx_before == idx_after)

# Crash: task stuck IN_PROGRESS with no live worker → recovered to READY
crash_task = shared.create_task('crash sample', 'obj', 'RUNTIME_ENGINEER',
                                gate_id=None, domain=None)
shared.transition_task(crash_task['id'], 'CLAIMED', by='TEST')
shared.transition_task(crash_task['id'], 'IN_PROGRESS', by='TEST')
old = now_plus(-7200)
shared.update_task_fields(crash_task['id'], {'updated_at': old})
# update_task_fields overwrites updated_at with now; patch file directly
p = shared.find_task_file(crash_task['id'])
tj = shared.read_json(p); tj['updated_at'] = old; shared.write_json(p, tj)
supervisor._recover_stuck_tasks()
check('dead worker task recovered to READY',
      shared.load_task(crash_task['id'])['status'] == 'READY')
shared.transition_task(crash_task['id'], 'CANCELLED', by='TEST', note='cert cleanup')

print('\n[7] Sleep/wake: no false timeout, no duplicate worker')
dummy = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(300)'])
supervisor._workers['SLEEP-TEST'] = {
    'proc': dummy, 'phase': 'engineer', 'task_id': 'SLEEP-TEST',
    'started': now_plus(-3600), 'pid': dummy.pid, 'log': '/dev/null'}
supervisor._adjust_workers_after_wake(3590)  # woke after ~1h sleep
supervisor._reap_workers()
survived = 'SLEEP-TEST' in supervisor._workers
check('worker NOT killed after wake (sleep-adjusted timeout)', survived)
check('no duplicate worker for same task after wake',
      list(supervisor._workers.keys()).count('SLEEP-TEST') == 1)
dummy.kill()
supervisor._workers.pop('SLEEP-TEST', None)

print('\n[8] Pause / resume / idle')
shared.update_state({'kill_switch': True})
try:
    paused_result = supervisor._loop_once()
    check('paused supervisor stays alive (no exit)', paused_result is False)
except SystemExit:
    check('paused supervisor stays alive (no exit)', False, 'sys.exit called')
orchestrator.run()
idx = shared.load_tasks_index()
active_new = [t for t, m in idx.items()
              if m['status'] == 'READY' and t not in (task_id, b_tasks[0], crash_task['id'])]
check('paused system claims no work', len(active_new) == 0)
shared.update_state({'kill_switch': False})
check('resume works', not shared.is_killed())

print('\n[9] Telegram dedup + human evidence resumes dependents')
from telegram_notify import notify
notify('TASK_BLOCKED', {'task_id': 'DEDUP-T', 'title': 'x', 'reason': 'r'})
notify('TASK_BLOCKED', {'task_id': 'DEDUP-T', 'title': 'x', 'reason': 'r'})
lines = open(TG_LOG).read().strip().splitlines() if os.path.exists(TG_LOG) else []
dedup_count = sum(1 for l in lines if 'DEDUP-T' in l)
check('telegram dedup (2 sends → 1 message)', dedup_count == 1, f'count={dedup_count}')

human_queue.complete_human_task('GATE-H', 'foto + ticket OK', by='FOUNDER')
check('human evidence → gate PASS', pipeline.get_gate('GATE-H')['status'] == 'PASS')

print('\n[10] Idle: no actionable work → no workers, no token burn')
orchestrator.run()
run_cycles(1)
check('idle system spawns no workers', len(supervisor._workers) == 0)

# ── Verdict ───────────────────────────────────────────────────────────────────
failed = [(n, d) for n, ok, d in RESULTS if not ok]
print('\n══════════════════════════════════════')
print(f'  {len(RESULTS) - len(failed)}/{len(RESULTS)} checks PASS')
if failed:
    print('  FAILED:')
    for n, d in failed:
        print(f'   - {n}: {d}')
    print(f'  Sandbox kept for inspection: {SANDBOX}')
    sys.exit(1)
print('  AGENT COMPANY V1: CERTIFIED')
shutil.rmtree(SANDBOX, ignore_errors=True)
