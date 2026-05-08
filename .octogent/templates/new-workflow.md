# Template: Nuevo GitHub Actions Workflow

Crea un workflow autónomo que corre en GitHub Actions, siguiendo el patrón establecido del War Room.

## Variables

| Variable | Descripción | Ejemplo |
|---|---|---|
| `{{NAME}}` | Nombre del workflow (kebab-case) | `menu-update-alert` |
| `{{TRIGGER}}` | Cron en UTC + workflow_dispatch | `0 15 * * *` (9am MX) |
| `{{ACTION}}` | Qué hace el script | `Compara menú actual vs anterior, alerta cambios a Telegram` |

## Archivos a crear

### 1. Script: `.github/scripts/{{NAME}}.py`

```python
#!/usr/bin/env python3
"""{{ACTION}}"""
import os, sys, json, time, requests

# --- Config ---
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID_DANIEL"]
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "manual")
AGENT_ID = "{{NAME}}"
HEADERS_SB = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def sb_get(table, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=HEADERS_SB, params=params or [])
    r.raise_for_status()
    return r.json()

def send_telegram(text):
    for i in range(0, len(text), 4000):
        requests.post(f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                      json={"chat_id": CHAT_ID, "text": text[i:i+4000], "parse_mode": "Markdown"})

def log_run(status, summary="", error="", duration=0, tin=0, tout=0):
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers={**HEADERS_SB, "Content-Type": "application/json", "Prefer": "return=minimal"},
                      json={"agent_id": AGENT_ID, "trigger_type": TRIGGER_TYPE, "status": status, "duration_ms": duration,
                            "output_summary": summary, "error_message": error, "tokens_in": tin, "tokens_out": tout, "tentacle": "{{TENTACLE}}"})
    except: pass

def main():
    t0 = int(time.time() * 1000)
    try:
        # TODO: implementar lógica de {{ACTION}}
        data = sb_get("wansoft_kpis")
        msg = f"*{{NAME}}*\n\nTODO: implementar"
        send_telegram(msg)
        log_run("success", summary=msg[:200], duration=int(time.time()*1000)-t0)
    except Exception as e:
        log_run("error", error=str(e), duration=int(time.time()*1000)-t0)
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
```

### 2. Workflow: `.github/workflows/{{NAME}}.yml`

```yaml
name: {{NAME}}
on:
  schedule:
    - cron: "{{TRIGGER}}"
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID_DANIEL: ${{ secrets.TELEGRAM_CHAT_ID_DANIEL }}
      TRIGGER_TYPE: ${{ github.event_name }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install requests
      - run: python .github/scripts/{{NAME}}.py
```

## Checklist post-creación

- [ ] Script creado en `.github/scripts/{{NAME}}.py`
- [ ] Workflow creado en `.github/workflows/{{NAME}}.yml`
- [ ] Secrets verificados: `gh secret list --repo ramonfaurdaniel-png/fullsite`
- [ ] Test manual: `gh workflow run {{NAME}}.yml --repo ramonfaurdaniel-png/fullsite`
- [ ] Verificar run: `gh run list --repo ramonfaurdaniel-png/fullsite --limit 3`
- [ ] Agregar al WORKFLOW_MAP de `orquestador.py` si aplica
- [ ] Documentar en `CLAUDE.md` sección "Workflows activos"
