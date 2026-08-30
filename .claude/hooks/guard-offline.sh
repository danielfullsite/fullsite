#!/usr/bin/env bash
# guard-offline — inyecta el doc-oro que aplica ANTES de tocar código crítico de offline.
#
# Por qué existe: fundamentar era opcional y manual, así que dependía de que el agente
# se acordara. No se acordaba. Esto lo vuelve automático: si el archivo que vas a tocar
# está nombrado en un doc probado en campo, el hook te pone enfrente qué leer y qué
# regla dura aplica — antes de la edición, no después del merge.
#
# No bloquea nada. Sólo inyecta contexto (exit 0, texto a stdout).

set -u
ENTRADA=$(cat)

RUTA=$(printf '%s' "$ENTRADA" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except: print(''); raise SystemExit
i=d.get('tool_input',{}) or {}
print(i.get('file_path') or i.get('notebook_path') or i.get('command') or '')
" 2>/dev/null)

[ -z "$RUTA" ] && exit 0

# La salida DEBE ir envuelta en hookSpecificOutput.additionalContext o no llega al
# modelo: stdout en crudo no se inyecta al contexto. Es el mismo envoltorio que usa
# el hook de graphify. Sin esto seria otra proteccion construida y no activada.
inyectar() {
  python3 -c "
import json,sys
print(json.dumps({'hookSpecificOutput':{
  'hookEventName':'PreToolUse',
  'additionalContext':sys.argv[1],
}}))
" "$1"
  exit 0
}

# Archivos nombrados en docs probados en campo.
emitir() {
  inyectar "OFFLINE — este archivo esta nombrado en un doc probado en campo.

$1

Antes de editar: LEE el doc completo, no lo grepees. Un grep confirma lo que ya
sospechas; leer te dice lo que no sabias. CI verde no es evidencia."
}

# Merges. Separado a proposito: no habla de offline si el PR no lo toca.
emitir_merge() {
  inyectar "Vas a mergear. CI verde no es evidencia.

$1"
}

case "$RUTA" in
  *pos-data.ts*|*pos/page.tsx*)
    emitir "Doc: docs/pos/PIPELINE-POS-KDS-OFFLINE.md §4 lo nombra «Print/save offline».

REGLA DURA #3 (OFFLINE-LAN-FIELD-PROVEN §4): saveOrder debe caer a OFFLINE_QUEUED
ante navigator.onLine===false, status 0/5xx o timeout. NUNCA a API_ERROR por un
problema de red — se pierde la orden y no imprime.

Capa web: viaja por Vercel, la caja lo toma con F5. No requiere instalador." ;;

  *pos/layout.tsx*|*pos-manager-auth*)
    emitir "Camino de login. NO está entre los 4 escenarios con evidencia de campo
(T-01, T-17, T-22, T-23 — ver TEST-MATRIX.md §Resumen).

T-24 sigue en ⚠️ parcial: la ventana de 8h no cubre cierre-apertura, y pos_staff_cache
guarda UNA sola credencial. Lo validado el 23-ago fue camino feliz: caché fresco, una
persona, pocas horas después del último login online.

Revisa la RAMA DE FALLA, que es donde se cuelan las regresiones." ;;

  *electron-app/local-server/*|*electron-app/main.js*)
    emitir "Cáscara / Pedro. Esto NO viaja por Vercel: requiere INSTALADOR NUEVO
y reinstalar en la caja. Agrúpalo con otros cambios de local-server.

REGLAS DURAS que aplican (OFFLINE-LAN-FIELD-PROVEN §4): KDS por HTTP no HTTPS ·
POS imprime por FULLSITE_BRIDGE_URL · Pedro muere si muere Electron ·
ORDER_SENT por HTTP no ws:// · la sync es idempotente por save_operation_id." ;;

  *pos-offline-db*|*service-worker*|*sw.js*)
    emitir "Service Worker / caché offline. El arranque en frío depende de que el SW
gane la carrera contra did-fail-load (main.js reintenta 3x con backoff).

Si cambias qué se cachea, T-25 y el arranque en frío se ven afectados." ;;

  *gh\ pr\ merge*|*git\ merge*)
    emitir_merge "  1. ¿La rama está actualizada contra main? Verde contra base vieja no vale:
     git rev-list --count origin/<rama>..origin/main
  2. ¿Leíste el diff contra su merge-base, o sólo el estado del check?
     git diff \$(git merge-base origin/main origin/<rama>) origin/<rama>
  3. Si toca POS/offline: ¿revisaste la RAMA DE FALLA? Lo validado en campo suele
     ser el camino feliz, y ahí es donde se cuelan las regresiones." ;;
esac
exit 0
