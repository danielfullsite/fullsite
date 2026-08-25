#!/usr/bin/env bash
# Suite del guard de comandos. Reproducible y sin dependencias más allá de python3.
#
#   .claude/hooks/guard-bash.test.sh
#   → exit 0 si todo pasa, 1 si algo falla (apto para CI)
#
# Los casos "DEBE PASAR" importan tanto como los de bloqueo: un guard con falsos
# positivos rompe el trabajo diario y termina desactivado, que es peor que no tenerlo.

set -uo pipefail
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-bash.sh"
[ -x "$GUARD" ] || { echo "guard no ejecutable: $GUARD"; exit 1; }

pass=0; fail=0

run() {
  printf '{"tool_input":{"command":%s}}' \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")" \
    | "$GUARD" >/dev/null 2>&1
  echo $?
}

# blocked <descripción> <comando>
blocked() {
  local got; got=$(run "$2")
  if [ "$got" = "2" ]; then pass=$((pass+1))
  else fail=$((fail+1)); printf '  ✗ debía BLOQUEAR (exit %s): %s\n' "$got" "$2"; fi
}

# allowed <descripción> <comando>
allowed() {
  local got; got=$(run "$2")
  if [ "$got" = "0" ]; then pass=$((pass+1))
  else fail=$((fail+1)); printf '  ✗ debía PASAR (exit %s): %s\n' "$got" "$2"; fi
}

echo "── DEBE BLOQUEAR ──"

# 1. Truncado de archivos persistentes
blocked "cat > persistente"        'cat > CLAUDE.md'
blocked "redirección desnuda"      '> AGENTS.md'
blocked "script a settings"        'python3 gen.py > .claude/settings.json'
blocked "escribir .env"            'echo TOKEN=x > .env'
blocked "truncate"                 'truncate -s 0 CLAUDE.md'
blocked "truncate largo"           'truncate --size 0 MEMORY.md'
blocked "tee trunca"               'echo x | tee CLAUDE.md'
blocked "tee a settings"           'cat nuevo.json | tee .claude/settings.json'
blocked "dd of="                   'dd if=/dev/null of=MEMORY.md'

# 2. Descartar trabajo en git
blocked "reset --hard"             'git reset --hard origin/main'
blocked "reset --hard con opts"    'git reset --keep --hard HEAD~1'
blocked "restore ruta"             'git restore src/foo.ts'
blocked "restore sin ruta"         'git restore .'
blocked "checkout -- ruta"         'git checkout -- dashboard-app/src/lib/pos-data.ts'
blocked "checkout ruta directa"    'git checkout src/app/pos/page.tsx'
blocked "checkout punto"           'git checkout .'

# 3. Borrado recursivo amplio
blocked "rm -rf ~"                 'rm -rf ~'
blocked "rm -rf ~/ (barra final)"  'rm -rf ~/'
blocked "rm -rf \$HOME"            'rm -rf $HOME'
blocked "rm -rf \$HOME/"           'rm -rf $HOME/'
blocked "rm -rf \${HOME}"          'rm -rf ${HOME}'
blocked "rm -rf /"                 'rm -rf /'
blocked "rm -rf home del usuario"  'rm -rf /Users/danielrg'
blocked "rm -rf raíz del repo"     'rm -rf /Users/danielrg/fullsite'
blocked "rm -fr (orden inverso)"   'rm -fr ~/'

# 4. Push forzado
blocked "push --force"             'git push --force origin main'
blocked "push -f"                  'git push -f'

# 5. Exposición de secretos
blocked "cat .mcp.json"            'cat .mcp.json'
blocked "cat .env"                 'cat .env'
blocked "cat ~/.zshrc"             'cat ~/.zshrc'
blocked "head .env"                'head -5 .env'
blocked "sed sobre .env"           'sed -n 1,5p .env'
blocked "awk sobre .env"           'awk "{print}" .env'
blocked "grep contenido de .env"   'grep SUPABASE .env'
blocked "cut sobre .mcp.json"      'cut -d= -f2 .mcp.json'
blocked "od sobre id_rsa"          'od -c ~/.ssh/id_rsa'
blocked "python leyendo .env"      'python3 -c "print(open(\".env\").read())"'
blocked "printenv"                 'printenv'
blocked "env pelón"                'env'
blocked "printenv en pipe"         'printenv | grep TOKEN'

echo "── NO DEBE BLOQUEAR (falsos positivos rompen el trabajo diario) ──"

# Append y edición legítima
allowed "append con >>"            'echo "- nota" >> MEMORY.md'
allowed "tee -a"                   'echo x | tee -a CLAUDE.md'
allowed "redirección a /tmp"       'echo salida > /tmp/out.txt'
allowed "redirección a scratch"    'python3 s.py > /private/tmp/claude-501/x/build.log'

# git cotidiano
allowed "checkout -b"              'git checkout -b fix/algo origin/main'
allowed "checkout de rama"         'git checkout main'
allowed "checkout de rama con /"   'git checkout feat/pos-ui-kit'
allowed "status"                   'git status --short --branch'
allowed "diff de un archivo"       'git diff --stat CLAUDE.md'
allowed "show de main"             'git show origin/main:dashboard-app/src/proxy.ts'
allowed "reset suave"              'git reset HEAD~1'
allowed "restore --staged"         'git restore --staged src/foo.ts'
allowed "push normal"              'git push -u origin fix/algo'
allowed "force-with-lease"         'git push --force-with-lease origin mi-rama'
allowed "stash"                    'git stash list'

# rm acotado
allowed "rm -rf en scratchpad"     'rm -rf /private/tmp/claude-501/sesion/build'
allowed "rm -rf subcarpeta"        'rm -rf node_modules/.cache'
allowed "rm de un archivo"         'rm /tmp/basura.txt'

# Comprobaciones que NO vuelcan secretos
allowed "test -e sobre .mcp.json"  'test -e .mcp.json && echo existe'
allowed "grep -c sobre .env"       'grep -c SUPABASE .env'
allowed "ls sobre .env"            'ls -la .env'
allowed "check-ignore"             'git check-ignore -q .mcp.json'
allowed "wc sobre .env"            'wc -l .env'

# Trabajo normal
allowed "vitest"                   'npx vitest run'
allowed "tsc"                      'npx tsc --noEmit'
allowed "cat de un archivo normal" 'cat dashboard-app/package.json'
allowed "sed sobre código"         'sed -n "1,40p" dashboard-app/src/proxy.ts'
allowed "rg"                       'rg -n "ocm_daily" scripts/'
allowed "gh pr checks"             'gh pr checks 61'

echo
echo "  pasaron: $pass   fallaron: $fail"
[ "$fail" -eq 0 ] || exit 1
