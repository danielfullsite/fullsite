#!/usr/bin/env bash
# Guard de comandos Bash — Fullsite
#
# Bloquea (permissionDecision: deny + exit 2) los comandos que el Protocolo
# permanente de colaboración prohíbe (CLAUDE.md §3, §13, §14). Nace del incidente
# del 2026-08-24: un `cat >` sobrescribió MEMORY.md (111 entradas escritas a mano)
# y un `cat .mcp.json` expuso dos access tokens de Supabase en el chat.
#
# Lee el JSON del hook por stdin y evalúa .tool_input.command.
# Silencio + exit 0 = permitido. Cualquier otra salida = bloqueo con motivo.
#
# Probar a mano:
#   echo '{"tool_input":{"command":"cat > CLAUDE.md"}}' | .claude/hooks/guard-bash.sh; echo "exit=$?"

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

# Normaliza: colapsa espacios para que los patrones no dependan del formato.
N=$(printf '%s' "$CMD" | tr '\n' ' ' | tr -s ' ')

# ── 1. Truncado de archivos persistentes ────────────────────────────────────
# Sólo redirección que TRUNCA (`>`), nunca append (`>>`). El [^>] evita `>>`.
PERSIST='MEMORY\.md|CLAUDE\.md|AGENTS\.md|settings\.json|settings\.local\.json|\.env|\.mcp\.json|\.gitignore'
if printf '%s' "$N" | grep -qE "(^|[^>])>[[:space:]]*[^|>]*($PERSIST)"; then
  deny "Redirección que TRUNCA un archivo persistente. Léelo, consérvalo y aplica un parche mínimo (Edit). Para añadir usa '>>'. — CLAUDE.md §3"
fi

# ── 2. Descartar trabajo en git ─────────────────────────────────────────────
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+reset[[:space:]]+(--hard|--merge[[:space:]]+--hard)'; then
  deny "git reset --hard destruye cambios que pueden no ser tuyos. Usa 'git stash' o un worktree limpio. — CLAUDE.md §3"
fi
# `git checkout -- <ruta>` y `git checkout .` descartan cambios locales.
# NO bloquea `git checkout -b`, `git checkout <rama>` ni `git checkout <sha> -- ...` de lectura.
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+(checkout|restore)[[:space:]]+(--[[:space:]]|\.[[:space:]]*$)'; then
  deny "git checkout/restore -- <ruta> descarta cambios locales sin respaldo. Respáldalos primero (cp o git stash). — CLAUDE.md §3"
fi

# ── 3. Borrado recursivo en rutas amplias ───────────────────────────────────
if printf '%s' "$N" | grep -qE '\brm[[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*[[:space:]]+)+(-[a-zA-Z]+[[:space:]]+)*(/|~|\$HOME|"\$HOME"|/Users/[^/[:space:]]+)[[:space:]]*$'; then
  deny "rm -rf sobre HOME o la raíz. Resuelve el objetivo exacto en read-only y usa una operación recuperable. — CLAUDE.md §14"
fi
if printf '%s' "$N" | grep -qE '\brm[[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*[[:space:]]+)+(/Users/danielrg/fullsite|\.)[[:space:]]*$'; then
  deny "rm -rf sobre la raíz del repositorio. — CLAUDE.md §14"
fi

# ── 4. Push forzado ─────────────────────────────────────────────────────────
if printf '%s' "$N" | grep -qE '\bgit[[:space:]]+push\b.*(--force([[:space:]]|$)|-f([[:space:]]|$))'; then
  deny "git push --force reescribe historia remota y puede borrar trabajo de otro agente. Usa --force-with-lease y sólo con autorización explícita. — CLAUDE.md §3"
fi

# ── 5. Impresión de secretos ────────────────────────────────────────────────
# El archivo puede leerse con herramientas que NO lo vuelquen al chat; lo que se
# bloquea es imprimirlo. (Incidente 2026-08-24: dos tokens sbp_ expuestos.)
if printf '%s' "$N" | grep -qE '\b(cat|bat|less|more|head|tail|xxd|strings|nl)\b[^|;&]*(\.env|\.mcp\.json|\.zshrc|\.netrc|auth\.json|id_rsa|credentials)'; then
  deny "Imprimir un archivo de secretos lo expone en el chat y en el transcript. Si necesitas comprobar una clave, usa 'grep -c' o 'test -e' sin volcar el contenido. — CLAUDE.md §13"
fi

exit 0
