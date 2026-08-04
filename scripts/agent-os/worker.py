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
    update_task_fields, audit, now_iso, REPO_ROOT,
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

    # Claim: READY → CLAIMED → IN_PROGRESS  (or resume CHANGES_REQUESTED → IN_PROGRESS)
    s = task['status']
    if s == 'READY':
        transition_task(task_id, 'CLAIMED',      by='RUNTIME_ENGINEER', note='Worker claimed task')
        transition_task(task_id, 'IN_PROGRESS',  by='RUNTIME_ENGINEER', note='Engineering started')
    elif s == 'CHANGES_REQUESTED':
        transition_task(task_id, 'IN_PROGRESS',  by='RUNTIME_ENGINEER', note='Resuming after changes requested')
    elif s not in ('CLAIMED', 'IN_PROGRESS'):
        print(f'[worker] Cannot engineer task in status {s}')
        sys.exit(1)

    prompt = _build_engineer_prompt(task)
    result = _invoke_claude(prompt, task_id, 'engineer')

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
    prompt = _build_verify_prompt(task, engineer_result)
    result = _invoke_claude(prompt, task_id, 'verify')

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

def _invoke_claude(prompt: str, task_id: str, phase: str) -> dict:
    """
    Invoke claude --print non-interactively.
    Returns parsed AGENT_OS_RESULT dict, or a FAILED dict on error.
    """
    # Write prompt to temp file (avoids shell-escaping issues with long prompts)
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

        audit('CLAUDE_INVOKE', {'task_id': task_id, 'phase': phase, 'budget_usd': MAX_BUDGET_USD})
        print(f'[worker] Invoking claude for {task_id}/{phase} (timeout={WORKER_TIMEOUT_S}s)', flush=True)

        with open(prompt_file) as pf:
            proc = subprocess.run(
                cmd,
                input=pf.read(),
                capture_output=True,
                text=True,
                timeout=WORKER_TIMEOUT_S,
                cwd=REPO_ROOT,
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

def _build_engineer_prompt(task: dict) -> str:
    dod = '\n'.join(f'  {i+1}. {item}' for i, item in enumerate(task.get('dod', [])))
    return f"""{SAFETY_CONSTRAINTS}

You are the RUNTIME_ENGINEER of the Fullsite Agent OS — an autonomous engineering agent.
Your job: implement the task below completely and produce verifiable results.

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
4. Create a git commit if work is complete and tests pass
5. At the very end of your response, output EXACTLY this block with no text after it:

AGENT_OS_RESULT:
{{
  "verdict": "VERIFIED",
  "evidence": "one paragraph: what you did, key files changed, test results",
  "commit": "git-hash-or-null",
  "tests_passed": 0,
  "tests_total": 0,
  "gaps_found": [],
  "next_steps": []
}}
AGENT_OS_RESULT_END

Use verdict=FAILED if you cannot complete the task. Use verdict=PARTIAL if partially done.
"""


def _build_verify_prompt(task: dict, engineer_result) -> str:
    result_str = json.dumps(engineer_result, indent=2) if engineer_result else 'No result available'
    dod = '\n'.join(f'  {i+1}. {item}' for i, item in enumerate(task.get('dod', [])))
    return f"""{SAFETY_CONSTRAINTS}

You are RUNTIME_VERIFICATION of the Fullsite Agent OS.
Your job: INDEPENDENTLY verify that the engineering work on task {task['id']} is correct.

CRITICAL: Do NOT re-do the work. READ the code, RUN the tests yourself, and issue your own verdict.
Be skeptical. A VERIFIED verdict requires all DoD items to be genuinely satisfied.

TASK BEING VERIFIED:
  ID:    {task['id']}
  Title: {task['title']}
  Obj:   {task['objective']}

DEFINITION OF DONE:
{dod}

ENGINEER'S SELF-REPORTED RESULT:
{result_str}

VERIFICATION STEPS:
1. Read the files the engineer created/modified
2. Run the tests independently (don't trust engineer's report alone)
3. Check each DoD item is genuinely satisfied — not just claimed
4. Look for regressions, security issues, TODOs, or unmet criteria
5. Issue your independent verdict

At the very end, output EXACTLY:

AGENT_OS_RESULT:
{{
  "verdict": "VERIFIED",
  "evidence": "what you verified, test results you ran, gaps you found or didn't find",
  "commit": null,
  "tests_passed": 0,
  "tests_total": 0,
  "gaps_found": [],
  "next_steps": []
}}
AGENT_OS_RESULT_END

VERIFIED = all DoD items satisfied. PARTIAL = most items done, minor gaps. FAILED = critical items missing.
"""


if __name__ == '__main__':
    main()
