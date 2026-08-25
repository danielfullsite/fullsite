#!/usr/bin/env bash
# Guard de comandos Bash — Fullsite
#
# ⚠️ ESTO ES PROTECCIÓN COMPLEMENTARIA, NO UNA FRONTERA DE SEGURIDAD.
#
# Es un filtro de patrones sobre una cadena de shell. Un shell tiene infinitas formas de
# expresar la misma acción (variables, `eval`, base64, `xargs`, un script intermedio,
# redirección construida en runtime). Cualquiera que QUIERA saltárselo, puede. Su función
# es atrapar el descuido honesto —el `cat >` escrito sin pensar— no contener a un actor
# adversario. Las fronteras de verdad son la protección de rama, la RLS y los permisos del
# sistema de archivos.
#
# Nace del incidente del 2026-08-24: un `cat >` sobrescribió MEMORY.md (111 entradas
# escritas a mano) y un `cat .mcp.json` expuso dos access tokens de Supabase en el chat.
#
# Contrato: lee el JSON del hook por stdin, evalúa .tool_input.command.
#   exit 0 sin salida  → permitido
#   exit 2 + JSON deny → bloqueado, con motivo citando el artículo del protocolo
#
# Suite: .claude/hooks/guard-bash.test.sh (reproducible, corre en CI)

set -uo pipefail

CMD=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || true)
[ -z "$CMD" ] && exit 0

deny() {
  python3 -c "
import json,sys
print(json.dumps({'hookSpecificOutput':{
  'hookEventName':'PreToolUse',
  'permissionDecision':'deny',
  'permissionDecisionReason': sys.argv[1]}}))" "$1"
  echo "BLOQUEADO por .claude/hooks/guard-bash.sh: $1" >&2
  exit 2
}

# Colapsa espacios para que los patrones no dependan del formato.
N=$(printf '%s' "$CMD" | tr '\n' ' ' | tr -s ' ')

PERSIST='MEMORY\.md|CLAUDE\.md|AGENTS\.md|settings\.json|settings\.local\.json|\.env|\.mcp\.json|\.gitignore'
SECRETS='\.env|\.mcp\.json|\.zshrc|\.bashrc|\.netrc|auth\.json|id_rsa|id_ed25519|credentials|\.pem'

# ── 1. Truncado de archivos persistentes ────────────────────────────────────
# a) redirección que TRUNCA (`>`), nunca append (`>>`)
if printf '%s' "$N" | grep -qE "(^|[^>])>[[:space:]]*[^|>]*($PERSIST)"; then
  deny "Redirección que TRUNCA un archivo persistente. Léelo, consérvalo y aplica un parche mínimo (Edit). Para añadir usa '>>'. — CLAUDE.md §3"
fi
# b) truncate(1)
if printf '%s' "$N" | grep -qE "\btruncate\b[^|;&]*($PERSIST)"; then
  deny "truncate sobre un archivo persistente. — CLAUDE.md §3"
fi
# c) tee sin -a/--append escribe truncando
if printf '%s' "$N" | grep -qE "\btee\b" && ! printf '%s' "$N" | grep -qE "\btee\b[[:space:]]+(-a\b|--append\b)"; then
  if printf '%s' "$N" | grep -qE "\btee\b[^|;&]*($PERSIST)"; then
    deny "tee sin -a TRUNCA el archivo. Usa 'tee -a' para añadir, o Edit para parchear. — CLAUDE.md §3"
  fi
fi
# d) dd of=
if printf '%s' "$N" | grep -qE "\bdd\b[^|;&]*of=[^[:space:]]*($PERSIST)"; then
  deny "dd of= sobre un archivo persistente. — CLAUDE.md §3"
fi

# ── 2. Descartar trabajo en git ─────────────────────────────────────────────
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+reset[[:space:]]+[^|;&]*--hard'; then
  deny "git reset --hard destruye cambios que pueden no ser tuyos. Usa 'git stash' o un worktree limpio. — CLAUDE.md §3"
fi
# `git restore` SIEMPRE descarta (salvo --staged, que sólo des-indexa).
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+restore\b' && ! printf '%s' "$N" | grep -qE '\bgit[[:space:]]+restore[[:space:]]+(--staged|--source)'; then
  deny "git restore descarta cambios locales sin respaldo. Respáldalos primero (cp o git stash). — CLAUDE.md §3"
fi
# `git checkout -- <ruta>`, `git checkout .`, o checkout de algo que parece ruta (tiene / o .ext).
# NO bloquea `git checkout -b rama`, `git checkout main`, ni `git checkout <sha>`.
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+checkout[[:space:]]+(--[[:space:]]|\.[[:space:]]*$|[^-][^[:space:]]*(/|\.[a-zA-Z0-9]+)([[:space:]]|$))'; then
  deny "git checkout de una ruta descarta cambios locales sin respaldo. Usa 'git stash' o copia antes. — CLAUDE.md §3"
fi

# ── 3. Borrado recursivo en rutas amplias ───────────────────────────────────
# Acepta barra final: `rm -rf ~` y `rm -rf ~/` son lo mismo.
RMR='\brm[[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*[[:space:]]+)+(-[a-zA-Z]+[[:space:]]+)*'
if printf '%s' "$N" | grep -qE "$RMR(/|~|\\\$HOME|\"\\\$HOME\"|\\\$\{HOME\}|/Users/[^/[:space:]]+)/?[[:space:]]*$"; then
  deny "rm -rf sobre HOME o la raíz. Resuelve el objetivo exacto en read-only y usa una operación recuperable. — CLAUDE.md §14"
fi
if printf '%s' "$N" | grep -qE "$RMR(/Users/danielrg/fullsite|\.)/?[[:space:]]*$"; then
  deny "rm -rf sobre la raíz del repositorio. — CLAUDE.md §14"
fi

# ── 4. Push forzado ─────────────────────────────────────────────────────────
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+push\b.*(--force([[:space:]]|$)|-f([[:space:]]|$))'; then
  deny "git push --force reescribe historia remota y puede borrar trabajo de otro agente. Usa --force-with-lease y sólo con autorización explícita. — CLAUDE.md §3"
fi

# ── 5. Exposición de secretos ───────────────────────────────────────────────
# Se bloquea IMPRIMIR el contenido, no comprobar que el archivo existe.
# Allowlist de comprobaciones que NO vuelcan contenido: test/ls/stat/wc/check-ignore, y
# `grep -c` (sólo cuenta). Todo lo demás que toque un archivo de secretos, se bloquea.
if printf '%s' "$N" | grep -qE "($SECRETS)"; then
  SAFE=0
  printf '%s' "$N" | grep -qE '^[[:space:]]*(test|\[|ls|stat|wc|file|git[[:space:]]+check-ignore)\b' && SAFE=1
  printf '%s' "$N" | grep -qE '\bgrep\b[^|;&]*-[a-zA-Z]*c' && SAFE=1
  if [ "$SAFE" -eq 0 ]; then
    deny "Ese comando puede volcar un archivo de secretos al chat y al transcript. Para comprobar existencia usa 'test -e'; para contar, 'grep -c'. Nunca imprimas el contenido. — CLAUDE.md §13"
  fi
fi
# printenv / env sin argumentos vuelcan TODO el entorno, incluidos tokens.
if printf '%s' "$N" | grep -qE '(^|[;&|][[:space:]]*)(printenv|env)[[:space:]]*(\||;|&|$)'; then
  deny "printenv/env vuelcan el entorno completo, incluidos tokens. Consulta una variable concreta con \${VAR:+definida} sin imprimir su valor. — CLAUDE.md §13"
fi

exit 0
