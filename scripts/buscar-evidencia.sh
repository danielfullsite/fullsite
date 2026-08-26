#!/usr/bin/env bash
# buscar-evidencia.sh — localizar una fuente antes de declarar que no existe.
#
# Nace de un falso negativo del 2026-08-26: se declaró que dos documentos "no se
# encuentran en la máquina" tras correr `ls ~/Downloads/*PATRON*` — un glob, un
# directorio, sin recursión. Existían, eran legibles, y estaban en ~/Documents.
#
# Recorre los ocho pasos que exige CLAUDE.md §17 "La regla del descubrimiento",
# imprime el comando de cada uno, y termina con uno de los estados permitidos.
#
#   uso:  scripts/buscar-evidencia.sh "OFFLINE-AMALAY-CIERRE"
#         scripts/buscar-evidencia.sh "PLAYBOOK-ESCALA" "OFFLINE-AMALAY"
#
# Sólo lectura. No modifica nada.

set -uo pipefail

[ $# -ge 1 ] || { echo "uso: $0 <patrón> [patrón...]" >&2; exit 2; }

RESULTADOS=$(mktemp)
REVISADAS=$(mktemp)
trap 'rm -f "$RESULTADOS" "$REVISADAS"' EXIT

buscar() {  # $1 = etiqueta, $2 = raíz
  local etiqueta="$1" raiz="$2" pat encontrados=0
  [ -d "$raiz" ] || { printf '  %-34s %s\n' "$etiqueta" "(no existe)"; return; }
  if ! ls "$raiz" >/dev/null 2>&1; then
    printf '  %-34s %s\n' "$etiqueta" "ACCESO BLOQUEADO"
    echo "$etiqueta|BLOQUEADO" >> "$REVISADAS"; return
  fi
  for pat in "${PATRONES[@]}"; do
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      echo "$hit" >> "$RESULTADOS"; encontrados=$((encontrados+1))
    done < <(find "$raiz" -iname "*${pat}*" -type f 2>/dev/null)
  done
  printf '  %-34s %s\n' "$etiqueta" "$encontrados coincidencia(s)"
  echo "$etiqueta|OK" >> "$REVISADAS"
}

PATRONES=("$@")
echo "═══ Búsqueda de evidencia — patrones: ${PATRONES[*]}"
echo
echo "Comando por raíz:  find <raíz> -iname \"*<patrón>*\" -type f"
echo

echo "── 1-2. Repositorio, worktrees, outputs de sesiones"
REPO=$(git rev-parse --show-toplevel 2>/dev/null || echo .)
buscar "repo ($REPO)" "$REPO"
while IFS= read -r wt; do
  [ -n "$wt" ] && [ "$wt" != "$REPO" ] && buscar "worktree $(basename "$wt")" "$wt"
done < <(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')
buscar "sesiones Codex (outputs)" "$HOME/.codex"

echo
echo "── 3-6. Raíces del usuario"
buscar "~/Downloads"        "$HOME/Downloads"
buscar "~/Documents"        "$HOME/Documents"
buscar "~/Documents/Codex"  "$HOME/Documents/Codex"
buscar "~/Desktop"          "$HOME/Desktop"

echo
echo "── 7. Búsqueda global en la carpeta del usuario"
# El `find` sobre todo ~ tarda ~25 s en esta máquina y se puede cortar por tiempo.
# Se corre igual, pero SIN depender de él: el paso 8 (índice) cubre el mismo terreno
# en milisegundos, y el resultado final se arma de la unión de todos los pasos.
GLOBAL_ANTES=$(wc -l < "$RESULTADOS" | tr -d ' ')
buscar "~ (global, find)" "$HOME"
GLOBAL_DESPUES=$(wc -l < "$RESULTADOS" | tr -d ' ')
if [ "$GLOBAL_DESPUES" -le "$GLOBAL_ANTES" ] && [ "$GLOBAL_ANTES" -gt 0 ]; then
  echo "  ⚠️  el barrido global aportó 0 y los pasos anteriores sí encontraron."
  echo "      Suele ser corte por tiempo, no ausencia. El paso 8 lo cubre."
fi

echo
echo "── 8. Índice de Spotlight (variantes y contenido)"
if command -v mdfind >/dev/null 2>&1; then
  for pat in "${PATRONES[@]}"; do
    mdfind -onlyin "$HOME" "kMDItemFSName == '*${pat}*'c" 2>/dev/null >> "$RESULTADOS"
  done
  echo "  mdfind: consultado"
else
  echo "  mdfind: no disponible"
fi

echo
echo "═══ Resultado"
UNICOS=$(sort -u "$RESULTADOS" | grep -v '^$' || true)
if [ -z "$UNICOS" ]; then
  echo
  echo "ESTADO: NO LOCALIZADO DESPUÉS DE BÚSQUEDA GLOBAL"
  echo "  Raíces recorridas: $(wc -l < "$REVISADAS" | tr -d ' ')"
  echo "  (Esto NO es 'AUSENCIA CONFIRMADA': para eso hace falta además una razón"
  echo "   positiva para creer que el archivo no debería existir.)"
  exit 1
fi

echo
printf '%s\n' "$UNICOS" | while IFS= read -r f; do
  if [ -r "$f" ]; then
    sha=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
    printf '  ENCONTRADO Y LEGIBLE\n'
    printf '    ruta   : %s\n' "$f"
    printf '    stat   : %s bytes · %s · %s\n' \
      "$(stat -f '%z' "$f" 2>/dev/null)" \
      "$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$f" 2>/dev/null)" \
      "$(stat -f '%Sp' "$f" 2>/dev/null)"
    printf '    file   : %s\n' "$(file -b "$f" 2>/dev/null)"
    printf '    sha256 : %s\n\n' "$sha"
  else
    printf '  ENCONTRADO PERO NO LEGIBLE\n    ruta: %s\n\n' "$f"
  fi
done

echo "── Canónico vs copias (por SHA-256)"
printf '%s\n' "$UNICOS" | while IFS= read -r f; do
  [ -r "$f" ] && printf '%s\t%s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "$f"
done | sort | awk -F'\t' '
  { if ($1 != prev) { printf "  CANÓNICO : %s\n", $2; prev=$1 }
    else            { printf "    copia  : %s  (mismo hash)\n", $2 } }'
