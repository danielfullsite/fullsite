# Incident: Commit Isolation Breach — b6882d1

> Fecha: 2026-07-27  
> Severidad: BAJO — sin impacto en contenido ni runtime  
> Estado: CERRADO Y RESUELTO

---

## Commit original con brecha

`b6882d1` — commit huérfano (no en historial lineal actual). Existe en el object store como referencia.

El commit mezcló archivos de dos workstreams distintos:

**CFG-01 (7 archivos):**
- `A docs/testing/CFG-01-restaurante-norte-demo.md`
- `M electron-app/local-server/adapters/printer-config-schema.js`
- `M electron-app/local-server/adapters/printer-wizard-logic.js`
- `M electron-app/local-server/tests/printer-config.test.js`
- `M electron-app/local-server/tests/printer-wizard.test.js`
- `M electron-app/main.js`
- `M electron-app/setup.html`

**Migration Engine (arrastrados — 2 archivos):**
- `A docs/architecture/ROOT-CAUSE-001-recipe-identifier-mismatch.md`
- `A scripts/migration-pipeline/maps/approved-aliases.ts`

---

## Causa

Dos agentes trabajaron simultáneamente sobre el índice de `main`. Los archivos del Migration Engine ya estaban en el staging area compartido cuando el agente de CFG-01 ejecutó `git commit`.

---

## Resolución

El historial fue reescrito en dos commits separados y limpios:

| Commit | Workstream | Contenido |
|---|---|---|
| `2722c56` | CFG-01 | Solo archivos de Electron/printer |
| `26fefee` | Migration Engine | Solo ROOT-CAUSE-001 + approved-aliases.ts |

Verificado con `git show --stat 26fefee` y `git show --stat 2722c56`. Sin archivos cruzados.

---

## Impacto final

Ninguno sobre contenido, runtime ni integridad. Los 9 archivos tienen el contenido correcto en commits separados.

---

## Protocolo establecido a partir de este incidente

1. Ningún agente trabaja directamente sobre `main` mientras otro esté activo.
2. Cada workstream usa su propio worktree y branch dedicados.
3. Antes de `git add`: ejecutar `git status --short`.
4. Staging únicamente mediante paths explícitos — nunca `git add .` ni `git add -A`.
5. Antes de `git commit`: verificar `git diff --cached --name-status`.
6. El merge a `main` ocurre solo cuando el worktree está limpio y el commit fue revisado.
