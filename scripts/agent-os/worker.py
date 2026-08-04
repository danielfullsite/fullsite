#!/usr/bin/env python3
"""
Agent OS Worker — invokes Claude Code non-interactively to execute a task.

Usage:
  python3 worker.py TSK-002 engineer   # do engineering work on a READY task
  python3 worker.py TSK-002 verify     # independently verify a SUBMITTED task

Claude CLI flags used:
  --print              non-interactive, output to stdout and exit
  --permission-mode auto  auto-approve tool confirmations (Bash, Edit, Write)
  --allowedTools       whitelist: Read,Edit,Write,Bash
  --max-budget-usd     hard spending cap per worker run
"""
import sys, os, subprocess, json, re, time, tempfile

SCRIPTS_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_ROOT)

from shared import (
    load_task, load_result, transition_task, submit_result, submit_review,
    update_task_fields, audit, now_iso, REPO_ROOT, get_task_diff,
)

CLAUDE_BIN       = '/usr/local/bin/claude'
MAX_BUDGET_USD   = 3.0
WORKER_TIMEOUT_S = 570    # slightly under supervisor's 600s

SAFETY_CONSTRAINTS = """
SAFETY CONSTRAINTS (non-negotiable — violations cause immediate FAIL verdict):
- Never run: git push, git push --force, git merge main, git rebase main
- Never modify Supabase production via MCP tools or direct API calls
- Never write secrets (.env, .mcp.json, tokens) to code, commits, or stdout
- Commits go to current branch only — never force-push
- Never run: rm -rf, kubectl, terraform, wrangler deploy
- Scope: only files relevant to this task's objective
""".strip()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print('Usage: worker.py TASK_ID PHASE (engineer|verify)')
        sys.exit(1)

    task_id = sys.argv[1]
    phase   = sys.argv[2]

    try:
        task = load_task(task_id)
    except FileNotFoundError:
        print(f'ERROR: Task {task_id} not found')
        sys.exit(1)

    print(f'[worker] {task_id} phase={phase} status={task["status"]}', flush=True)
    audit('WORKER_STARTED', {'task_id': task_id, 'phase': phase, 'pid': os.getpid()})

    if phase == 'engineer':
        run_engineer(task)
    elif phase == 'verify':
        run_verify(task)
    else:
        print(f'Unknown phase: {phase}')
        sys.exit(1)


# ── Engineer phase ────────────────────────────────────────────────────────────

def run_engineer(task: dict):
    task_id = task['id']

    s = task['status']
    if s == 'READY':
        transition_task(task_id, 'CLAIMED',     by='RUNTIME_ENGINEER', note='Worker claimed task')
        transition_task(task_id, 'IN_PROGRESS', by='RUNTIME_ENGINEER', note='Engineering started')
    elif s == 'CHANGES_REQUESTED':
        transition_task(task_id, 'IN_PROGRESS', by='RUNTIME_ENGINEER', note='Repair attempt after verification failure')
    elif s not in ('CLAIMED', 'IN_PROGRESS'):
        print(f'[worker] Cannot engineer task in status {s}')
        sys.exit(1)

    # Re-load task to get worktree_path (set by supervisor before dispatch)
    task = load_task(task_id)
    worktree_path = task.get('worktree_path')
    work_dir = worktree_path if worktree_path and os.path.isdir(worktree_path) else REPO_ROOT
    print(f'[worker] Engineering in: {work_dir}', flush=True)

    # Load previous review findings if this is a repair attempt
    repair_context = ''
    if s == 'CHANGES_REQUESTED':
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.dirname(__file__))
            from shared import load_review
            review = load_review(task_id)
            if review and review.get('findings'):
                repair_context = '\n\nPREVIOUS VERIFICATION FAILURES (fix these specifically):\n' + \
                    '\n'.join(f'  - {f}' for f in review['findings'])
        except Exception:
            pass

    prompt = _build_engineer_prompt(task, work_dir, repair_context)
    result = _invoke_claude(prompt, task_id, 'engineer', cwd=work_dir)

    submit_result(
        task_id      = task_id,
        submitted_by = 'RUNTIME_ENGINEER',
        summary      = result.get('evidence', 'Engineering completed')[:200],
        verdict      = result.get('verdict', 'PARTIAL'),
        evidence     = result.get('evidence', ''),
        commit       = result.get('commit'),
        tests_passed = result.get('tests_passed', 0),
        tests_total  = result.get('tests_total', 0),
        gaps_found   = result.get('gaps_found', []),
        next_steps   = result.get('next_steps', []),
    )
    transition_task(task_id, 'SUBMITTED', by='RUNTIME_ENGINEER', note='Submitted for verification')
    print(f'[worker] {task_id} SUBMITTED — verdict: {result.get("verdict")}')


# ── Verify phase ──────────────────────────────────────────────────────────────

def run_verify(task: dict):
    task_id = task['id']

    if task['status'] not in ('IN_REVIEW', 'VERIFIED'):
        print(f'[worker] Task {task_id} is {task["status"]}, expected IN_REVIEW')
        sys.exit(1)

    engineer_result = load_result(task_id)

    # Get real diff from task branch for independent inspection
    diff_stat, diff_patch = get_task_diff(task_id)
    print(f'[worker] Diff stat ({len(diff_stat)} chars): {diff_stat[:200]}', flush=True)

    prompt = _build_verify_prompt(task, engineer_result, diff_stat, diff_patch)
    result = _invoke_claude(prompt, task_id, 'verify', cwd=REPO_ROOT)

    verdict = result.get('verdict', 'FAILED')
    is_verified = (verdict == 'VERIFIED')

    submit_review(
        task_id           = task_id,
        reviewed_by       = 'RUNTIME_VERIFICATION',
        verdict           = 'VERIFIED' if is_verified else ('PARTIAL' if verdict == 'PARTIAL' else 'FAILED'),
        findings          = result.get('gaps_found', []),
        return_to_engineer= not is_verified,
        return_reason     = result.get('evidence', '') if not is_verified else None,
        notes             = result.get('evidence', ''),
    )

    retry_count = task.get('retry_count', 0)
    max_retries = task.get('max_retries', 3)

    if is_verified:
        transition_task(task_id, 'VERIFIED', by='RUNTIME_VERIFICATION',
                       note=result.get('evidence', 'All DoD items verified')[:300])
        print(f'[worker] {task_id} VERIFIED')
    elif retry_count < max_retries:
        update_task_fields(task_id, {'retry_count': retry_count + 1})
        transition_task(task_id, 'CHANGES_REQUESTED', by='RUNTIME_VERIFICATION',
                       note=result.get('evidence', 'Verification failed')[:300])
        print(f'[worker] {task_id} CHANGES_REQUESTED (retry {retry_count + 1}/{max_retries})')
    else:
        transition_task(task_id, 'BLOCKED', by='RUNTIME_VERIFICATION',
                       note=f'Max retries ({max_retries}) exceeded — escalating to Founder')
        print(f'[worker] {task_id} BLOCKED after {max_retries} retries')


# ── Claude invocation ─────────────────────────────────────────────────────────

def _invoke_claude(prompt: str, task_id: str, phase: str, cwd: str = None) -> dict:
    """
    Invoke claude --print non-interactively.
    cwd: working directory for Claude (worktree for engineer, REPO_ROOT for verify).
    Returns parsed AGENT_OS_RESULT dict, or a FAILED dict on error.
    """
    work_dir = cwd if cwd and os.path.isdir(cwd) else REPO_ROOT

    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(prompt)
        prompt_file = f.name

    try:
        cmd = [
            CLAUDE_BIN,
            '--print',
            '--permission-mode', 'auto',
            '--allowedTools', 'Read,Edit,Write,Bash',
            '--max-budget-usd', str(MAX_BUDGET_USD),
        ]

        audit('CLAUDE_INVOKE', {'task_id': task_id, 'phase': phase,
                                'budget_usd': MAX_BUDGET_USD, 'cwd': work_dir})
        print(f'[worker] Invoking claude for {task_id}/{phase} cwd={work_dir} '
              f'(timeout={WORKER_TIMEOUT_S}s)', flush=True)

        with open(prompt_file) as pf:
            proc = subprocess.run(
                cmd,
                input=pf.read(),
                capture_output=True,
                text=True,
                timeout=WORKER_TIMEOUT_S,
                cwd=work_dir,
                env={**os.environ, 'HOME': os.environ.get('HOME', '/Users/danielrg')},
            )

        output = proc.stdout or ''
        if proc.returncode != 0 and proc.stderr:
            print(f'[worker] claude stderr: {proc.stderr[:500]}', flush=True)

        print(f'[worker] claude output length: {len(output)} chars', flush=True)
        result = _parse_result(output)
        audit('CLAUDE_DONE', {'task_id': task_id, 'phase': phase, 'verdict': result.get('verdict')})
        return result

    except subprocess.TimeoutExpired:
        print(f'[worker] claude TIMEOUT after {WORKER_TIMEOUT_S}s', flush=True)
        audit('CLAUDE_TIMEOUT', {'task_id': task_id, 'phase': phase})
        return {'verdict': 'FAILED', 'evidence': f'Timeout after {WORKER_TIMEOUT_S}s',
                'gaps_found': ['WORKER_TIMEOUT']}
    except Exception as e:
        print(f'[worker] claude ERROR: {e}', flush=True)
        return {'verdict': 'FAILED', 'evidence': str(e), 'gaps_found': ['WORKER_ERROR']}
    finally:
        try:
            os.unlink(prompt_file)
        except Exception:
            pass


def _parse_result(output: str) -> dict:
    """Extract AGENT_OS_RESULT JSON block from claude output."""
    match = re.search(
        r'AGENT_OS_RESULT:\s*(\{.*?\})\s*AGENT_OS_RESULT_END',
        output, re.DOTALL
    )
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError as e:
            print(f'[worker] JSON parse error: {e}')

    # Fallback: infer verdict from keywords
    lower = output.lower()
    if any(k in lower for k in ('all tests pass', 'tests green', 'tests pass', 'dod satisfied', 'verified')):
        verdict = 'VERIFIED'
    elif any(k in lower for k in ('partial', 'mostly done', 'incomplete')):
        verdict = 'PARTIAL'
    else:
        verdict = 'FAILED'

    return {
        'verdict':  verdict,
        'evidence': output[-3000:] if output else 'No output from claude',
        'gaps_found': [],
        'next_steps': [],
    }


# ── Prompt builders ───────────────────────────────────────────────────────────

def _build_engineer_prompt(task: dict, work_dir: str = None, repair_context: str = '') -> str:
    dod = '\n'.join(f'  {i+1}. {item}' for i, item in enumerate(task.get('dod', [])))
    branch = task.get('branch', f'agent-os/{task["id"]}')
    cwd_note = f'Working directory: {work_dir}' if work_dir else f'Working directory: {REPO_ROOT}'
    return f"""{SAFETY_CONSTRAINTS}

You are the RUNTIME_ENGINEER of the Fullsite Agent OS — an autonomous engineering agent.
{cwd_note}
Branch: {branch}  (do NOT push to remote, do NOT merge to main)

Your job: implement the task below completely and produce verifiable, committed results.
{repair_context}

TASK:
  ID:       {task['id']}
  Title:    {task['title']}
  Priority: {task['priority']}

OBJECTIVE:
{task['objective']}

DEFINITION OF DONE (all items must be satisfied):
{dod}

NOTES:
{task.get('notes', 'None')}

INSTRUCTIONS:
1. Read existing code to understand context before writing anything
2. Implement what the objective requires — no more, no less
3. Run tests to verify your work (fail fast if tests don't pass)
4. Commit your changes when tests pass:
   git add -A
   git commit -m "feat({task['id']}): <description>"
   git rev-parse HEAD   (include this hash in evidence)
5. Do NOT push. Do NOT merge. Commit only to current branch ({branch}).
6. At the very end of your response, output EXACTLY this block with no text after it:

AGENT_OS_RESULT:
{{
  "verdict": "VERIFIED",
  "evidence": "one paragraph: what you did, key files changed, test results, commit hash",
  "commit": "git-hash-here",
  "tests_passed": 0,
  "tests_total": 0,
  "gaps_found": [],
  "next_steps": []
}}
AGENT_OS_RESULT_END

Use verdict=FAILED if you cannot complete the task. Use verdict=PARTIAL if partially done.
List specific unmet DoD items in gaps_found.
"""


def _build_verify_prompt(task: dict, engineer_result,
                         diff_stat: str = '', diff_patch: str = '') -> str:
    result_str = json.dumps(engineer_result, indent=2) if engineer_result else 'No result available'
    dod = '\n'.join(f'  {i+1}. {item}' for i, item in enumerate(task.get('dod', [])))
    branch = task.get('branch', f'agent-os/{task["id"]}')
    return f"""{SAFETY_CONSTRAINTS}

You are RUNTIME_VERIFICATION of the Fullsite Agent OS.
Your job: INDEPENDENTLY verify the engineering work on task {task['id']} is correct.

CRITICAL: Do NOT re-do the work. Inspect the actual diff, run tests yourself, issue your own verdict.
Be skeptical — a VERIFIED verdict requires every DoD item to be genuinely satisfied in the real code.

Branch under review: {branch}
Repo: {REPO_ROOT}

TASK:
  ID:    {task['id']}
  Title: {task['title']}
  Obj:   {task['objective']}

DEFINITION OF DONE:
{dod}

ACTUAL DIFF (what the engineer committed):
--- stat ---
{diff_stat or '(no diff — branch may not exist or has no commits ahead of main)'}
--- patch (first 10k chars) ---
{diff_patch[:8000] if diff_patch else '(no patch)'}

ENGINEER RESULT:
{result_str}

VERIFICATION STEPS:
1. Inspect the diff above. Does it match what the DoD requires?
2. Read the specific files changed (use Read tool with absolute paths in {REPO_ROOT})
3. Run tests independently: cd {REPO_ROOT} && run the relevant test suite (npm test / bun test / jest)
4. Check each DoD item is satisfied in the actual code, not just claimed
5. Look for regressions, security issues, incomplete implementations, or TODO stubs

At the very end, output EXACTLY:

AGENT_OS_RESULT:
{{
  "verdict": "VERIFIED",
  "evidence": "what you read, tests you ran, exact results, gaps found or none",
  "commit": null,
  "tests_passed": 0,
  "tests_total": 0,
  "gaps_found": [],
  "next_steps": []
}}
AGENT_OS_RESULT_END

VERIFIED = every DoD item satisfied in real code + tests pass.
PARTIAL = most done, minor gaps (list them in gaps_found).
FAILED = critical DoD items missing (list them in gaps_found).
"""


if __name__ == '__main__':
    main()
