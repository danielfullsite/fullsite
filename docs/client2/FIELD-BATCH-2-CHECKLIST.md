# Field Batch #2 — Offline real en AMALAY · Hoja de campo (1 página)

Ejecución física por personal autorizado en AMALAY. No simular. No declarar PASS sin esta hoja + video/fotos.

## Commit instalado (confirmar en el dispositivo, no asumir)
- Rama de release offline: `release/offline-field-2026-08-06`
- Commit esperado (tip actual de la rama): `349ff0d` — **la rama se movió; NO asumir.**
- **Commit REAL leído del dispositivo AMALAY:** `________________`  (build/version en la app) ← este manda
- App abre y hay menú / PIN / turno disponibles: ☐ sí ☐ no

## Pasos (marcar + registrar)
| # | Paso | Hora (HH:MM:SS) | Order ID(s) | OK |
|---|------|----------------|-------------|----|
| 1 | Abrir Fullsite, menú/PIN/turno disponibles | | — | ☐ |
| 2 | Cortar internet (anotar hora exacta del corte) | | — | ☐ |
| 3 | Tomar orden → enviar a KDS → imprimir → cobrar (offline) | | | ☐ |
| 4 | Reiniciar POS y KDS SIN internet; recuperar operación | | | ☐ |
| 5 | Reconectar internet (anotar hora exacta) | | — | ☐ |
| 6 | Confirmar conciliación tras sync | | | ☐ |

## Conteos de conciliación (paso 6)
- Órdenes/eventos creados OFFLINE (conteo local en dispositivo): `______`
- Órdenes/eventos presentes en REMOTO tras sync: `______`
- **data_loss** (local no presente en remoto): `______`  → requerido **0**
- **duplicates** (mismo evento/orden repetido en remoto): `______`  → requerido **0**
- IDs de órdenes offline: `_________________________________`
- Impresiones realizadas offline (comanda/ticket): `______`

## Evidencia adjunta
- Video del corte → operación offline → reinicio → reconexión: ☐
- Fotos: pantalla POS offline, KDS, ticket impreso, pantalla de conciliación: ☐

## Resultado
- ☐ PASS  (data_loss=0 y duplicates=0, operación recuperada tras reinicio offline)
- ☐ FAIL  → describir el fallo exacto (caso, hora, IDs). Se corrige SOLO ese delta.

Notas del fallo: ______________________________________________________________
