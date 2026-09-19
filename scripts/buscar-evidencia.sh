#!/usr/bin/env bash
#
# buscar-evidencia.sh — Búsqueda exhaustiva de evidencia en toda la máquina.
#
# Implementa los ocho pasos de "La regla del descubrimiento" (CLAUDE.md §17).
# Un resultado negativo SÓLO es válido si se corrieron los ocho y se muestra el comando.
#
# Uso:
#   scripts/buscar-evidencia.sh constancia fiscal
#   scripts/buscar-evidencia.sh -c FTE260611          # además busca DENTRO del contenido
#   scripts/buscar-evidencia.sh -q csf                # sin encabezados, para pipes
#
# SÓLO LECTURA. No modifica, mueve ni borra nada.

set -uo pipefail

CONTENIDO=0
QUIET=0
while getopts ":cqh" opt; do
  case $opt in
    c) CONTENIDO=1 ;;
    q) QUIET=1 ;;
    h) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "opción inválida: -$OPTARG" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

if [ $# -eq 0 ]; then
  echo "uso: $(basename "$0") [-c] [-q] <término> [término...]" >&2
  exit 2
fi

TERMINOS=("$@")
VISTOS="$(mktemp -t buscarev)"
trap 'rm -f "$VISTOS"' EXIT
TOTAL=0

EXCLUIR=(
  -name node_modules -o -name .git -o -name __pycache__ -o -name .venv
  -o -name venv -o -name Caches -o -name .Trash -o -name google-cloud-sdk
  -o -name .next -o -name dist -o -name build
)

say() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

# Imprime una coincidencia con su evidencia: tamaño, fecha, tipo y SHA-256.
reportar() {
  local f="$1" real
  real="$(cd "$(dirname "$f")" 2>/dev/null && pwd -P)/$(basename "$f")" || real="$f"
  grep -qxF "$real" "$VISTOS" 2>/dev/null && return 0
  printf '%s\n' "$real" >> "$VISTOS"
  TOTAL=$((TOTAL + 1))

  if [ -d "$f" ]; then
    say "  [dir]  $real"
    return 0
  fi
  local meta tipo hash
  meta="$(stat -f '%z bytes  %Sm' -t '%Y-%m-%d %H:%M' "$f" 2>/dev/null)"
  tipo="$(file -b "$f" 2>/dev/null | cut -c1-60)"
  if [ -r "$f" ]; then
    hash="$(shasum -a 256 "$f" 2>/dev/null | cut -d' ' -f1)"
    say "  $real"
    say "      ${meta}  |  ${tipo}"
    say "      sha256: ${hash}"
  else
    say "  $real"
    say "      ENCONTRADO PERO NO LEGIBLE — permisos: $(stat -f '%Sp' "$f" 2>/dev/null)"
  fi
}

buscar_en() {
  local raiz="$1" etiqueta="$2"
  [ -d "$raiz" ] || { say "  (no existe: $raiz)"; return 0; }
  local t
  for t in "${TERMINOS[@]}"; do
    while IFS= read -r hit; do
      [ -n "$hit" ] && reportar "$hit"
    done < <(find "$raiz" \( "${EXCLUIR[@]}" \) -prune -o -iname "*${t}*" -print 2>/dev/null)
  done
}

REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

say "═══ Búsqueda de evidencia: ${TERMINOS[*]}"
say "═══ $(date '+%Y-%m-%d %H:%M:%S')  —  sólo lectura"
say ""

say "── 1. Repositorio y worktrees"
buscar_en "$REPO" repo
while IFS= read -r wt; do
  [ -n "$wt" ] && [ "$wt" != "$REPO" ] && buscar_en "$wt" worktree
done < <(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')

say "── 2. Outputs y sesiones de otras herramientas"
for d in "$HOME/.claude/projects" "$HOME/.codex" "$HOME/.cursor" "$HOME/Library/Application Support/Claude"; do
  buscar_en "$d" sesiones
done

say "── 3. ~/Downloads";        buscar_en "$HOME/Downloads" downloads
say "── 4. ~/Documents";        buscar_en "$HOME/Documents" documents
say "── 5. ~/Documents/Codex";  buscar_en "$HOME/Documents/Codex" codex
say "── 6. ~/Desktop";          buscar_en "$HOME/Desktop" desktop

say "── 7. Búsqueda global en ~ (incluye adjuntos de correo)"
buscar_en "$HOME" global

say "── 8. Volúmenes externos montados"
for v in /Volumes/*; do
  [ -d "$v" ] && [ "$(basename "$v")" != "Macintosh HD" ] && buscar_en "$v" volumen
done

if [ "$CONTENIDO" -eq 1 ]; then
  say ""
  say "── Extra: coincidencias DENTRO del contenido"
  if command -v rg >/dev/null 2>&1; then
    for t in "${TERMINOS[@]}"; do
      rg --files-with-matches --no-messages --hidden \
         --glob '!node_modules' --glob '!.git' --glob '!Library/Caches' \
         -i -- "$t" "$REPO" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" 2>/dev/null \
        | while IFS= read -r hit; do reportar "$hit"; done
    done
  else
    say "  (rg no instalado — se omite la búsqueda por contenido)"
  fi
fi

say ""
say "═══ $TOTAL coincidencia(s) única(s)"
if [ "$TOTAL" -eq 0 ]; then
  say ""
  say "Estado permitido para este resultado:"
  say "  NO LOCALIZADO DESPUÉS DE BÚSQUEDA GLOBAL"
  say "  (los ocho pasos corrieron; el comando fue: $(basename "$0") ${TERMINOS[*]})"
  say ""
  say "NO equivale a AUSENCIA CONFIRMADA: eso exige además una razón positiva"
  say "para creer que no existe. Y antes de concluir, preguntarle a Daniel —"
  say "las ausencias tienen causas que viven en personas, no en el disco."
fi
exit 0
