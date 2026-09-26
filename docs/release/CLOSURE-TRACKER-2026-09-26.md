# Tracker de cierre — 2026-09-26

Este tracker ordena trabajo ya identificado. No autoriza producción, merges de
seguridad, migraciones ni cambios en cajas.

| Frente | Estado actual | Siguiente evidencia exigida | Dueño de la decisión |
| --- | --- | --- | --- |
| P19 POS/KDS | `HOLD` | Diagnóstico de admisión `FRESH_DRAFT_UNAVAILABLE`; luego gate GUI/CDP nuevo | Ingeniería + revisión humana |
| JEV | Sombra | Panel consume sólo manifiestos redactados y registra opinión/revisión | Administrador humano |
| KDS token | Mecanismo listo, no activado | Inventario y enrolamiento de cada pantalla antes de secreto | Operación de restaurante |
| Rediseño POS v1.2 | Prototipo validado visualmente | Integración por feature flag después de P19 GUI | Producto + ingeniería |
| Electron proxy tenant | Corregido en main | Seguimiento de despliegue y regresión normal | Ingeniería |
| Seguridad POS amplia | Candidata separada | Revisión independiente de cambios 06/07 y plan de despliegue | Revisor independiente |

## Regla de orden

1. No mezclar P19 con el rediseño.
2. No activar el secreto KDS antes de enrolar todas las pantallas afectadas.
3. JEV puede señalar contradicciones, nunca aprobar un release ni ejecutar una
   operación.
4. La validación de laboratorio no equivale a certificación física de Caja.

## Higiene de ramas

- El worktree principal está sucio y se conserva como trabajo del usuario.
- Cada gate o cambio operativo entra en una rama aislada, con pruebas y
  rollback descriptivo.
- Artefactos generados y evidencia permanecen fuera del commit de producto,
  salvo manifiestos redactados expresamente destinados a JEV.

