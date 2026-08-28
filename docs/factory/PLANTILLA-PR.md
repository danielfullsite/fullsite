# Plantilla y checklist obligatorios — PRs de Fullsite Factory

> Copia el bloque de abajo al cuerpo de todo PR del programa. La checklist es **obligatoria**:
> un ítem sin cumplir se marca y se explica, no se borra.

## Plantilla (copiar al PR)

```markdown
## Problema
(qué falla o falta, con evidencia)

## Causa raíz / contexto
(por qué; enlaza el ADR si cambia arquitectura)

## Solución
(qué se hace; reuse-first: qué se reusa vs qué es nuevo)

## Dependencia
- Base: origin/main | rama de #NNN (declara si es stacked y por qué)
- Consume: contrato/envelope de #197
- Bloquea a: (PRs que dependen de éste)

## Feature flag
`factory.<algo>` — apagado por default = comportamiento legacy.

## Estado (vocabulario del programa — marca UNO)
Diseñado · **Implementado · Probado localmente** · Validado en staging · Desplegado · Verificado en campo
> Recordatorio: un PR abierto NO es "terminado".

## Verificación (clon limpio)
- tsc --noEmit: 
- vitest run: (archivos / pruebas)
- eslint (archivos tocados): 
- bun run build: 
- mutación (propiedad crítica): 

## Migración / rollback
- Migración: (nombre) — aditiva/idempotente · aplicada a remoto: **No**
- Rollback: git revert + down documentado; flag apagado = sin cambio en prod

## Seguridad
- Sin PII/secretos en logs ni respuestas
- RLS fail-closed / allowlist / consentimiento (según aplique)
- Sin credenciales, correos privilegiados hardcodeados ni datos reales de AMALAY

## Qué NO se desplegó / tocó
(prod, AMALAY, worktree Codex, tablas compartidas, hot path de Electron…)
```

## Checklist obligatoria (todas deben marcarse o justificarse)

- [ ] **Docs actualizadas** — `docs/factory/` refleja el cambio (referencia, trazabilidad, changelog).
- [ ] **ADR** — si cambia arquitectura, hay un ADR nuevo o actualizado (con supersede).
- [ ] **Pruebas/evidencia** — tests proporcionales al riesgo; números reales, no adjetivos.
- [ ] **Migración/rollback** — aditiva e idempotente; down documentado; no aplicada a remoto sin aprobación.
- [ ] **Compatibilidad** — legacy sigue funcionando con el flag apagado.
- [ ] **Seguridad** — sin secretos/PII; fail-closed; sin correos/IDs sensibles hardcodeados.
- [ ] **Estado de despliegue** — declarado con el vocabulario del programa; nada llamado "terminado" con sólo PR.
- [ ] **Ownership** — no pisa `data.ts`/`seeds`/worktree de Codex; dominios compartidos sólo se extienden.

> Esta plantilla vive en docs. Para hacerla obligatoria a nivel repo se puede promover a
> `.github/pull_request_template.md` en un PR aparte (cambia el comportamiento de todos los PRs).
