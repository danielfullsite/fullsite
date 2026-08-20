# Runbook — flags de enforcement de fraude (grace → strict)

> **Qué es:** cómo activar el bloqueo real de los vectores de fraude del POS. Hoy las
> correcciones están desplegadas en modo **grace** (detectan/auditan pero **no bloquean**),
> a la espera de tráfico real. Este doc dice cuándo y cómo pasarlas a **strict**.
>
> **Fuente:** verificado en `origin/main` — `dashboard-app/src/lib/manager-approval.ts`,
> `src/app/api/pos/cancel-item/route.ts`, `src/app/api/pos/save-order/route.ts`. Ver
> [`../audit/AUDITORIA-FULL-2026-08-19.md`](../audit/AUDITORIA-FULL-2026-08-19.md) y
> [`../DECISION-BRAIN.md`](../DECISION-BRAIN.md).
>
> **Última actualización:** 2026-08-19.

---

## Los flags

Son variables de entorno del dashboard (Vercel, prod = `app.fullsite.mx`). **Default: ausentes = grace.**

| Flag | Controla | Default (grace) | En `='true'` (strict) |
|---|---|---|---|
| `POS_APPROVAL_STRICT` | Reabrir cuenta pagada (`reopen-order`) vía `verifyManagerApproval` (minLevel 4 = gerente) | Permite + audita `legacy_no_approval` | Sin aprobación válida → **403** (`mode:'blocked'`) |
| `CANCEL_APPROVAL_STRICT` | Cancelar item (`cancel-item`) | Permite + audita `legacy_no_approval` | POST forjado sin aprobación → **403** |

**Nota sobre skimming (`save-order`):** hoy es **Fase 1 log-only** — recomputa el total desde los
items y si difiere del declarado (>$1) escribe `skimming_suspect` en `pos_audit_log`. **Nunca
bloquea.** La **Fase 2 (rechazo) NO está codificada aún** — no hay flag que la active; hay que
escribir el rechazo primero. El agente anti-fraude ya consume estos eventos (los reporta por mesero).

---

## Cuándo voltear a strict

**No antes del jueves.** El diseño grace→strict existe para observar tráfico real primero y no
romper la operación con un bug de enforcement. Secuencia:

1. Dejar correr el servicio real (desde el jueves) con los flags en grace.
2. Revisar `pos_audit_log` unos días:
   ```sql
   select action, count(*) from pos_audit_log
   where action in ('legacy_no_approval','skimming_suspect')
     and created_at > now() - interval '7 days'
   group by action;
   ```
3. Voltear a strict **cuando `legacy_no_approval` llegue a ~0 o sea 100% explicable** (significa
   que todos los POS ya mandan aprobación válida — voltear ya no rompe operación legítima).
4. `skimming_suspect`: cada evento es un ticket cobrado por menos que sus items → **investigar
   caso por caso** (cruzar `order_id` contra el arqueo del mesero). No requiere flag; ya alerta.

---

## Cómo voltear (prod)

Los flags viven en el proyecto **raíz** de Vercel (el dashboard deploya desde la raíz, no desde
`dashboard-app/`). Setearlos y redeployar:

```bash
# Ver que existen / su valor actual
vercel env ls

# Activar strict (production)
vercel env add POS_APPROVAL_STRICT production      # valor: true
vercel env add CANCEL_APPROVAL_STRICT production   # valor: true

# Redeploy para que tome el nuevo env (o push a main dispara auto-deploy)
```

> Nota: no imprimir el `.env` real en chat/logs (regla de seguridad). Estos flags también
> convendría dejarlos como comentario en `dashboard-app/.env.example` para que sean visibles a
> quien clone el repo — pendiente (el archivo está protegido de edición automática).

---

## Cómo verificar tras voltear

1. **Prueba negativa (debe bloquear):** un POST forjado a `/api/pos/cancel-item` o
   `/api/pos/reopen-order` **sin** aprobación de gerente → debe responder **403** y auditar
   `mode:'blocked'` en `pos_audit_log`.
2. **Prueba positiva (no debe romper):** un cancelar/reabrir **con** aprobación de gerente real
   desde el POS → debe seguir funcionando normal.
3. Confirmar que `legacy_no_approval` deja de aparecer para tráfico nuevo.

---

## Rollback

Si strict rompe algo legítimo (algún POS viejo que no manda aprobación): **quitar el flag** (o
ponerlo distinto de `'true'`) y redeployar → vuelve a grace al instante. Cero migración, cero
estado. Luego investigar qué POS no mandaba aprobación y actualizarlo antes de reintentar.
