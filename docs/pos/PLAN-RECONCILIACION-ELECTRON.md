# Reconciliación Electron — 1.3.11 (instalado) × 1.3.6 (main) → 1.3.12

> 2026-08-29 · Descubierto al preparar el instalador del domingo: las dos líneas de
> electron-app divergieron y CADA una tiene trabajo que la otra no. Instalar el build de
> main sobre las cajas sería un DOWNGRADE funcional. Esta reconciliación es una sesión
> propia (protocolo §18: rama de integración + suite + resolución por contrato), no un
> cherry-pick nocturno.

## Las dos líneas

| Línea | Versión | Exclusivos (lo que la otra NO tiene) |
|---|---|---|
| **feat/pos-ui-kit** (lo INSTALADO en AMALAY, field-proven) | 1.3.8→1.3.11 | bridge Rappi→KDS (b5c72c25) · fallback `kds_queue` (554afb4f — arregla KDS en blanco offline) · requisitos de Eduardo: personas/letra/expo (85009784) · light mode (b9a6a20e) · robustez render (090aecc2) · corte 18h de la vista (b4e684a9) · Agente de Borde v0 (f0b42f4d) · huella llave-en-mano (28d41523) · P1-1 bridge en preload (cff0cb20) · KDS offline-native http (0924b5d5) |
| **origin/main** | 1.3.6 | aislamiento de comandos por turno (7fa8a6a5 — el fix de Eduardo del 27-ago) · identidad del instalador AMALAY (b13bfe28) · provisioning HID/huella (46f002d7 y 3 más) · botón cerrar confiable (664d10e1) · KDS responsive (a7bff62c) |

**Trampa detectada:** hay commits duplicados con hashes distintos entre líneas (cherry-picks
previos: p.ej. 5e007c1c≈8ef5d7e4 "tablero horizontal", e4be8c53≈9b5c05ff "columnas") —
un cherry-pick masivo produce conflictos/vacíos engañosos.

## Estrategia recomendada (sesión de ~medio día)

1. Rama `integracion/electron-1.3.12` desde `origin/main`.
2. **Base = el árbol field-proven**: `git checkout feat/pos-ui-kit -- electron-app/`
   (lo instalado es la verdad validada en campo).
3. Re-aplicar los 8 exclusivos de main como parches dirigidos, EN ORDEN, resolviendo por
   contrato (el choque grande será `local-server/index.js`: bridge Rappi × shift isolation
   — ambos deben convivir; el aislamiento por turno debe aplicar TAMBIÉN a las órdenes
   de delivery inyectadas).
4. Bump a **1.3.12** + suite `local-server` (192 tests) + `tests/twin` (el gemelo) +
   build del workflow.
5. Validación física en AMALAY ANTES de declarar release estable (canal pilot del
   auto-updater si se quiere gradual).

## Mientras tanto (regla operativa)

- **No instalar 1.3.6 en ninguna caja.** El artefacto del build de hoy
  (`fullsite-pos-win-18f42644…`, 81.8 MB) queda solo como evidencia de que el pipeline
  compila main.
- El fix de comandas cruzadas YA está en la capa web (endpoint /api/pos/kitchen filtra
  por turno, PR #217); el KDS de Electron lo tendrá con 1.3.12.
- Relación con `offline-shell/local-load` (315 archivos, provisioning wizard + UI local):
  es la TERCERA línea. Orden sugerido: primero esta reconciliación 1.3.12 (chica),
  después offline-shell encima del resultado (grande).
