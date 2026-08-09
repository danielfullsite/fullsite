#!/usr/bin/env python3
"""Fullsite Agent Company — founder CLI.

  agent_company.py status                     estado completo (servicio + pipeline + locks + humanos)
  agent_company.py pause                      pausa (supervisor vivo, sin claims)
  agent_company.py resume                     reanuda
  agent_company.py stop                       apaga el servicio launchd (hasta 'start')
  agent_company.py start                      instala/carga el servicio launchd
  agent_company.py human-done GATE "evidencia"   marca tarea física completada
  agent_company.py release-lock DOMAIN        libera lock externo (cuando el owner cerró)
"""
import sys, os, json, subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shared import update_state, load_state, audit, read_json, AOS_ROOT, ensure_dirs

PLIST_LABEL = 'com.fullsite.agent-os'
PLIST_PATH = os.path.expanduser(f'~/Library/LaunchAgents/{PLIST_LABEL}.plist')


def status():
    ensure_dirs()
    import pipeline, locks, human_queue
    hb = read_json(os.path.join(AOS_ROOT, 'HEARTBEAT.json'), {})
    r = pipeline.readiness()
    lk = locks.load_locks()
    hq = human_queue.load_queue()
    pending_h = [g for g, t in hq.items() if t['status'] == 'PENDING']

    running = subprocess.run(['launchctl', 'list', PLIST_LABEL],
                             capture_output=True).returncode == 0
    print('══════════════════════════════════════')
    print('  FULLSITE AGENT COMPANY')
    print('══════════════════════════════════════')
    print(f'Servicio launchd:   {"RUNNING" if running else "STOPPED"}')
    print(f'Supervisor:         {hb.get("supervisor_status", "?")} '
          f'(pid {hb.get("pid", "?")}, hb {hb.get("last_heartbeat", "?")})')
    print(f'Kill switch/pause:  {load_state().get("kill_switch", False)}')
    print()
    print(f'Target activo:      {r["target"]} (fecha: {r.get("target_date", "?")})')
    print(f'CLIENT #2 PIPELINE GATE COMPLETION: {r["required_pass"]}/{r["required_total"]} PASS ({r["pct"]}%)')
    print('                    (métrica de gates del pipeline — NO es completitud del producto Fullsite)')
    if r.get('blocked_human'):
        print(f'  🔵 Bloqueados en Daniel (físico): {", ".join(r["blocked_human"])}')
    if r.get('blocked_decision'):
        print(f'  🟡 Bloqueados en decisión: {", ".join(r["blocked_decision"])}')
    if r.get('blocked_tech'):
        print(f'  🔴 Bloqueados técnicos: {", ".join(r["blocked_tech"])}')
    print()
    print(f'Tareas físicas pendientes: {len(pending_h)}'
          + (f' → docs/agent-os/FIELD-VISIT-PACK.md' if pending_h else ''))
    print('Domain locks:')
    for d, l in lk.items():
        print(f'  {d}: {l["owner"]} [{l["kind"]}]')
    print()
    print(f'Workers activos:    {list(hb.get("active_workers", {}).keys()) or "ninguno"}')
    print(f'Próxima acción:     {hb.get("next_action", "?")}')


def pause():
    update_state({'kill_switch': True, 'notes': 'PAUSED by operator'})
    audit('PAUSED', {'by': 'OPERATOR'})
    print('Agent Company PAUSED. Supervisor sigue vivo; no tomará trabajo nuevo.')


def resume():
    update_state({'kill_switch': False, 'notes': ''})
    audit('RESUMED', {'by': 'OPERATOR'})
    print('Agent Company RESUMED.')


def stop():
    subprocess.run(['launchctl', 'unload', PLIST_PATH], capture_output=True)
    audit('SERVICE_STOPPED', {'by': 'OPERATOR'})
    print('Servicio detenido. Para reactivar: agent_company.py start')


def start():
    if not os.path.exists(PLIST_PATH):
        subprocess.run([sys.executable,
                        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     'install_service.py')], check=True)
    else:
        subprocess.run(['launchctl', 'load', PLIST_PATH], capture_output=True)
    print('Servicio activo.')


def human_done(gate_id: str, evidence: str):
    import human_queue
    human_queue.complete_human_task(gate_id, evidence)
    human_queue.render_field_visit_pack()
    print(f'{gate_id} marcado DONE con evidencia. Gates dependientes se reanudan solos.')


def release_lock(domain: str):
    import locks
    if locks.release(domain, by='OPERATOR', force=True):
        print(f'Lock {domain} liberado. El Agent Company puede asignar writers.')
    else:
        print(f'No se pudo liberar {domain}.')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'status':
        status()
    elif cmd == 'pause':
        pause()
    elif cmd == 'resume':
        resume()
    elif cmd == 'stop':
        stop()
    elif cmd == 'start':
        start()
    elif cmd == 'human-done':
        human_done(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'done')
    elif cmd == 'release-lock':
        release_lock(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
