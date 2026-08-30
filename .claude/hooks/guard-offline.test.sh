#!/usr/bin/env bash
# Suite de guard-offline.sh. Corre sin red y sin dependencias más allá de python3.
#
# Qué protege, en orden de gravedad:
#   1. Que la salida vaya envuelta en hookSpecificOutput.additionalContext. Sin ese
#      envoltorio el texto NO llega al modelo y el hook es decoración. Es la falla
#      más peligrosa porque no hace ruido.
#   2. Que dispare en los archivos que los docs-oro nombran.
#   3. Que se calle en todo lo demás. Un guard que grita siempre se ignora.

set -u
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$AQUI/guard-offline.sh"

fallos=0
casos=0

# Corre el guard con una entrada y devuelve su stdout.
correr() { printf '%s' "$1" | bash "$GUARD" 2>/dev/null; }

# Extrae additionalContext, o cadena vacía si no hay salida.
contexto() {
  printf '%s' "$1" | python3 -c "
import json,sys
crudo = sys.stdin.read().strip()
if not crudo:
    print(''); raise SystemExit
print(json.loads(crudo)['hookSpecificOutput']['additionalContext'])
" 2>/dev/null
}

ok() { casos=$((casos+1)); printf '  ok    %s\n' "$1"; }
mal() { casos=$((casos+1)); fallos=$((fallos+1)); printf '  FALLA %s\n     %s\n' "$1" "$2"; }

# Debe inyectar contexto que contenga cierto texto.
debe_avisar() {
  local nombre="$1" entrada="$2" esperado="$3"
  local salida ctx
  salida="$(correr "$entrada")"
  if [ -z "$salida" ]; then mal "$nombre" "no emitió nada"; return; fi
  if ! printf '%s' "$salida" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    mal "$nombre" "la salida no es JSON válido — no llegaría al modelo"; return
  fi
  ctx="$(contexto "$salida")"
  case "$ctx" in
    *"$esperado"*) ok "$nombre" ;;
    *) mal "$nombre" "el contexto no menciona '$esperado'" ;;
  esac
}

# Debe quedarse callado.
debe_callar() {
  local nombre="$1" entrada="$2"
  local salida; salida="$(correr "$entrada")"
  if [ -z "$salida" ]; then ok "$nombre"; else mal "$nombre" "emitió cuando no debía: $salida"; fi
}

echo "── el envoltorio JSON llega al modelo ──"
salida="$(correr '{"tool_input":{"file_path":"dashboard-app/src/lib/pos-data.ts"}}')"
if printf '%s' "$salida" | python3 -c "
import json,sys
d = json.load(sys.stdin)
h = d['hookSpecificOutput']
assert h['hookEventName'] == 'PreToolUse', h
assert h['additionalContext'].strip(), 'contexto vacío'
" 2>/dev/null; then ok "hookSpecificOutput bien formado"
else mal "hookSpecificOutput bien formado" "stdout crudo no se inyecta al contexto"; fi

echo "── avisa en el núcleo offline ──"
debe_avisar "pos-data.ts trae la regla dura de saveOrder" \
  '{"tool_input":{"file_path":"dashboard-app/src/lib/pos-data.ts"}}' 'OFFLINE_QUEUED'
debe_avisar "pos/page.tsx también es print/save offline" \
  '{"tool_input":{"file_path":"dashboard-app/src/app/pos/page.tsx"}}' 'OFFLINE_QUEUED'
debe_avisar "el login avisa que no tiene evidencia de campo" \
  '{"tool_input":{"file_path":"dashboard-app/src/app/pos/layout.tsx"}}' 'T-24'
debe_avisar "pos-manager-auth entra por el mismo camino" \
  '{"tool_input":{"file_path":"dashboard-app/src/lib/pos-manager-auth.ts"}}' 'T-24'
debe_avisar "la cáscara avisa que necesita instalador" \
  '{"tool_input":{"file_path":"electron-app/local-server/core/event-store.js"}}' 'INSTALADOR'
debe_avisar "main.js es cáscara igual" \
  '{"tool_input":{"file_path":"electron-app/main.js"}}' 'INSTALADOR'
debe_avisar "el service worker toca el arranque en frío" \
  '{"tool_input":{"file_path":"dashboard-app/src/lib/pos-offline-db.ts"}}' 'arranque en frío'

echo "── avisa antes de mergear ──"
debe_avisar "gh pr merge pide verificar la base" \
  '{"tool_input":{"command":"gh pr merge 128 --squash"}}' 'CI verde no es evidencia'
debe_avisar "git merge también" \
  '{"tool_input":{"command":"git merge origin/main"}}' 'CI verde no es evidencia'

echo "── se calla en lo demás ──"
debe_callar "un doc cualquiera"          '{"tool_input":{"file_path":"docs/playbooks/x.md"}}'
debe_callar "una prueba cualquiera"      '{"tool_input":{"file_path":"dashboard-app/src/__tests__/x.test.ts"}}'
debe_callar "un comando inofensivo"      '{"tool_input":{"command":"ls -la"}}'
debe_callar "entrada sin ruta ni comando" '{"tool_input":{}}'
debe_callar "entrada vacía"              '{}'
debe_callar "JSON inválido no truena"    'esto no es json'

echo
if [ "$fallos" -eq 0 ]; then
  echo "guard-offline: $casos/$casos ok"
  exit 0
fi
echo "guard-offline: $fallos de $casos FALLARON"
exit 1
