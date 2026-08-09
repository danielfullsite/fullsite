#!/usr/bin/env python3
"""Install Fullsite Mission Control as a macOS LaunchAgent.

com.fullsite.mission-control: starts at login, restarts on crash, resumes after
sleep with the machine. Localhost-only dashboard; independent of the supervisor
process so it survives supervisor restarts.
"""
import sys, os, subprocess, time

PLIST_LABEL   = 'com.fullsite.mission-control'
LAUNCH_AGENTS = os.path.expanduser('~/Library/LaunchAgents')
PLIST_PATH    = os.path.join(LAUNCH_AGENTS, f'{PLIST_LABEL}.plist')
SCRIPTS_ROOT  = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT     = os.path.abspath(os.path.join(SCRIPTS_ROOT, '..', '..'))
LOGS_DIR      = os.path.join(REPO_ROOT, 'logs', 'agent-os')
SERVER        = os.path.join(SCRIPTS_ROOT, 'mission_control.py')

PLIST = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>{PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{sys.executable}</string>
        <string>{SERVER}</string>
    </array>
    <key>WorkingDirectory</key><string>{REPO_ROOT}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>{LOGS_DIR}/mission-control.stdout.log</string>
    <key>StandardErrorPath</key><string>{LOGS_DIR}/mission-control.stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key><string>{os.path.expanduser('~')}</string>
    </dict>
</dict>
</plist>
"""

if __name__ == '__main__':
    os.makedirs(LAUNCH_AGENTS, exist_ok=True)
    os.makedirs(LOGS_DIR, exist_ok=True)
    with open(PLIST_PATH, 'w') as f:
        f.write(PLIST)
    subprocess.run(['launchctl', 'unload', PLIST_PATH], capture_output=True)
    r = subprocess.run(['launchctl', 'load', PLIST_PATH], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'ERROR: {r.stderr}')
        sys.exit(1)
    time.sleep(2)
    print(f'Loaded {PLIST_LABEL}')
    subprocess.run(['launchctl', 'list', PLIST_LABEL])
