# Runbook — hotfix con bypass de admin

> **Qué es:** el único procedimiento autorizado para saltarse la protección de rama de `main`.
> Existe porque `enforce_admins` está en `false` a propósito: si el restaurante está caído a
> las 2am, la regla de protección no debe ser lo que impida el arreglo.
>
> **Establecido:** 2026-08-24, junto con la protección de rama.

---

## La protección que aplica

```
main · check requerido: test (app_id 15368 = GitHub Actions)
       force push: no · borrar rama: no · reviews: no requeridos
       enforce_admins: false  ← el bypass que este runbook gobierna
```

El check está anclado al app de GitHub Actions, así que un commit status crudo con el nombre
`test` posteado por cualquier token **no** lo satisface.

---

## Cuándo se permite el bypass

Sólo estas tres. Cualquier otra cosa espera a CI.

1. **Producción caída o degradada para un restaurante en servicio.** El POS no cobra, el KDS
   no recibe, la caja no imprime, o el dashboard no carga para el dueño.
2. **Pérdida o corrupción de datos en curso.** Algo está escribiendo mal y cada minuto empeora.
3. **Deadlock de la propia protección.** Un cambio necesario no puede recibir el check
   requerido (p. ej. un PR que no toca `dashboard-app/` y por eso `test` nunca reporta).

**No es hotfix:** una feature urgente, una demo mañana, un test molesto, o "es un cambio
chiquito". Esas esperan.

---

## Procedimiento

1. **Nombra el incidente.** Una línea: qué está roto, qué restaurante, desde cuándo.
2. **Rama y PR normales.** Aunque vayas a saltarte el check, el cambio pasa por PR — para
   que exista diff revisable y reversible. Nunca push directo a `main`.
3. **Corre la suite en local** aunque CI no la corra:
   ```
   cd dashboard-app && npx vitest run && npx tsc --noEmit
   ```
   Si no pasa en local, el bypass no está justificado: estarías metiendo dos problemas.
4. **Merge con bypass** (sólo el owner):
   ```
   gh pr merge <N> --squash --admin
   ```
5. **Verifica producción** antes de irte a dormir:
   ```
   vercel ls --prod          # debe decir ● Ready
   gh run list --workflow=smoke-test.yml --limit 1
   ```
6. **Registra el bypass abajo, el mismo día.** Un bypass sin registro es una regla muerta.
7. **Abre el PR de seguimiento** con el test de regresión que faltaba. El hotfix apaga el
   fuego; el test evita el siguiente.

---

## Registro de bypasses

Toda línea aquí es deuda hasta que su PR de seguimiento esté cerrado.

| Fecha | Incidente | PR | Quién | Seguimiento |
|---|---|---|---|---|
| _(sin usos todavía)_ | | | | |

---

## Cómo quitar la protección temporalmente (último recurso)

> ## 🔒 REQUIERE AUTORIZACIÓN EXPLÍCITA DE DANIEL
>
> **Quitar la protección de rama o reescribir historial (`force push`, `rebase` de `main`,
> `filter-branch`) NO se ejecuta nunca por iniciativa propia — ni por un agente, ni bajo
> presión de un incidente.** Hace falta que Daniel lo autorice para ESA operación concreta,
> en el momento, por escrito en el chat.
>
> No cuentan como autorización: un "dale" previo sobre otra tarea, tener acceso de admin,
> que el bypass esté técnicamente disponible, ni que sea urgente. Si Daniel no está
> disponible, la respuesta correcta es **esperar** y decirlo.
>
> Motivo: son las dos únicas operaciones del repo cuyo daño no se puede revertir con otro
> commit. Todo lo demás es recuperable.

Con esa autorización en mano, es preferible **quitar y restaurar** la protección de forma
explícita antes que dejar `enforce_admins` permisivo sin control:

```bash
# Guardar el estado actual ANTES de tocar nada
gh api repos/danielfullsite/fullsite/branches/main/protection > /tmp/protection-backup.json

# ... intervención ...

# Restaurar
gh api -X PUT repos/danielfullsite/fullsite/branches/main/protection \
  --input /tmp/protection-backup.json
```

Verificar después que el check requerido siga anclado:

```bash
gh api repos/danielfullsite/fullsite/branches/main/protection/required_status_checks \
  --jq '.checks'
# esperado: [{"context":"test","app_id":15368}]
```

---

## Deuda conocida de este runbook

- El bypass **no está auditado automáticamente**. El registro de arriba es manual y depende
  de la disciplina de quien lo usa. Un bypass sin registro es una regla muerta.

> *Resuelto el 2026-08-24 (PR #67):* el filtro `paths: dashboard-app/**` hacía que `test`
> nunca reportara en PRs de docs/workflows/electron, dejándolos bloqueados para siempre.
> Se quitó el filtro; el check requerido ahora reporta en todos los PR. El caso 3 de arriba
> sigue existiendo como categoría, pero ya no por esta causa.
