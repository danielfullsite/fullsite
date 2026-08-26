# Estado del proyecto — Handoff (2026-08-24)

> **Para retomar:** `cd ~/fullsite && claude`, y de primero: *"lee `docs/HANDOFF-STATE.md`"*.

## Lo primero que hay que hacer al volver

**Extraer las definiciones de las 8 vistas OCM de STAGING** (`jkcnxfbbuyyfhwfjizgw`) vía el MCP
`supabase-fullsite-staging`, que carga solo al arrancar la sesión en este directorio. Es la
razón por la que se reinició.

Encargo de Daniel, textual: staging/AMALAY sólo como **fuente read-only** — nada de DDL,
migraciones ni cambios en producción. Extraer definiciones exactas, dependencias, funciones,
permisos y propiedades de seguridad. Sanitizar datos sensibles. Versionar una migración
**idempotente**, agregar validación estructural, probar el clone gate en staging/sandbox.
Entregable: **PR + diff + prueba de creación desde cero + rollback**. Sin merge ni producción
sin su autorización.

### Lo que ya se investigó — ⚠️ PENDIENTE DE VERIFICAR CONTRA LA BASE

Todo lo de abajo sale de LEER documentos y código del repo. **Nada está comprobado contra
staging ni contra producción.** Verificarlo directamente es el primer paso, antes de
escribir migración alguna.

- Según `docs/platform/OCM-REVIEW-2026-08-19.md`, las 8 vistas OCM viven **sólo en staging**
  y *"ninguna está desplegada a prod"*. **Sin confirmar contra la base.** (Una afirmación
  previa de que estaban en producción y podían perderse era incorrecta; ésta también puede
  estar desactualizada — el doc es del 19-ago y el commit `e8a2067f` de la rama afirma haber
  aplicado 014+015 a prod ese mismo día. Los dos no pueden ser ciertos a la vez.)
- `scripts/clone-test.sql` (el gate de clonabilidad) exige **9 nombres**:
  `ocm_daily · ocm_orders · ocm_shifts · ocm_cash · ocm_customers · ocm_suppliers ·
  ocm_order_consumption · ocm_service_kitchen · ocm_customer_journey`
- Las migraciones `014/015/016` de la rama `feat/pos-ui-kit` definen **otras 4**:
  `ocm_daily · ocm_waiter_rankings · ocm_menu_groups · ocm_menu_items`
- **Sólo `ocm_daily` coincide entre ambos conjuntos.** Hay dos generaciones de OCM con
  nombres distintos → **decisión de contrato pendiente de Daniel**: ¿el gate se alinea a las 9
  originales, o se reescribe a la superficie nueva?

## Estado al cierre de la sesión del 2026-08-24

### Mergeado a `main` hoy
| PR | |
|---|---|
| #64 | suite completa en verde — 11 tests obsoletos + 1 regresión real (`proxy.ts` sin timeout) |
| #65 | alta y acceso de empleados restaurados (PIN de 10 díg. vs teclado de 8 + anon key) |
| #66 | `GET /identity` tiraba ReferenceError + CI para los 192 tests del local server |
| #67 | el check requerido `test` reporta siempre (quitado el filtro `paths`) |

### CI y protección de rama — NUEVO
- `main` protegida: check requerido **`test`**, anclado a `app_id 15368` (GitHub Actions) para
  que un commit status crudo no lo satisfaga. `force push` y borrado de `main`: bloqueados.
- `enforce_admins: false` **a propósito**, gobernado por `docs/operations/RUNBOOK-HOTFIX.md`.
- Validado adversarialmente: rama con test roto → `test: fail` → `mergeStateStatus: BLOCKED` →
  `gh pr merge` rechazado con *"the base branch policy prohibits the merge"*. PR #68 cerrado
  y rama borrada tras la prueba.
- Dos workflows verdes en main: `test` (2118 casos) y `local-server` (192 casos).

### PRs abiertos, esperando validación FÍSICA (no mergear sin ella)
- **#61** — P0-1: un 403 de negocio se confundía con sesión expirada; abortaba el drenado de
  la cola y desloagueaba al cajero en bucle cada ~20s. Se valida con **el corte de caja**.
- **#63** — P0-2: offline se perdían los grupos de modificadores OBLIGATORIOS. Se valida
  tocando **una arrachera con el WiFi apagado** — ¿pide el término?
- **#62** — de Codex, **superseded por #64**. Su único aporte único es quitar la variable
  `ventasDia` sin usar. Va a conflictuar; Daniel decide si lo cierra.

### Sin commitear en el working tree (viven sólo en disco)
- `.claude/settings.json` — guard de comandos Bash (`.claude/hooks/guard-bash.sh`, 29/29 tests).
  Bloquea truncado de archivos persistentes, `git reset --hard`, `rm -rf ~`, `push --force` e
  impresión de secretos. **Se activa al reiniciar.**
- `CLAUDE.md` — protocolo permanente de colaboración agregado como sección nueva (aditivo,
  0 líneas borradas). Diff mostrado a Daniel; **decisión de commitear pendiente**.
- `docs/operations/RUNBOOK-HOTFIX.md` — nuevo, sin commitear.

### Pendientes que no necesitan base de datos
- `KITCHEN_TOKEN_SECRET` — interruptor que apaga la cocina en silencio.
- KDS `kds_only` sin `client_id` — muestra 0 órdenes.
- 35 commits **solo-docs** varados en `feat/pos-ui-kit` (riesgo cero, ya desbloqueados por #67).

### El número honesto
Código ~90% · **certificación ~10%** · punta a punta **~35%**.
Matriz offline: 23 escenarios, 8 con test automatizado, **0 certificados**.

**Validación física: PARCIAL, no inexistente.** La madrugada del 2026-08-24, con Daniel en
AMALAY por TeamViewer, se validó end-to-end la CAJA + KDS con el WiFi apagado: abrir mesa,
ordenar, enviar, imprimir, cobrar, cerrar y reconciliar al reconectar. Lo que NO se validó:
**entrada y escondite**, arranque en frío sin WAN, y los 3 P0 encontrados el 24-ago (son
posteriores a esa prueba). Ninguno de los 23 escenarios tiene las 3 columnas de la matriz
marcadas, que es lo que define CERTIFIED — de ahí el 0.
Golden Skeleton: 7 items en `PENDING-GATE`, ninguno arrancado.
7 de los 23 escenarios se pueden correr contra staging sin Daniel; 16 necesitan la caja física.

---

# Handoff anterior (2026-08-17) — histórico · ⛔ NO EJECUTAR

> **Todo lo que sigue es un registro de cómo estaban las cosas el 2026-08-17. NO son
> instrucciones vigentes.** Los pasos, comandos, ramas y migraciones de abajo pueden estar
> obsoletos o ser directamente peligrosos hoy — en particular el "PASO B", que aplica
> migraciones a producción. **No ejecutar nada de esta sección sin revalidarlo con Daniel
> contra el estado actual.**

> **Para retomar en una sesión nueva de Claude Code:** `cd ~/fullsite && claude`, y de primero: "lee `docs/HANDOFF-STATE.md`". Esto captura dónde quedó todo. No hace falta reabrir la sesión gigante de 59 MB.

## ✅ EN PRODUCCIÓN (app.fullsite.mx)
- **Rediseño DS v2** desplegado. `redesign/app-ui` → `main` (commit `445ea74f`), deploy Vercel exitoso.
- Fidelidad cerrada 1:1 vs los 5 artifacts (POS, KDS, Dashboard, Tabla, Configuración), ambos temas Night/Bright, cero pérdida de datos.
- **Verificación pendiente (fundador):** login authed en prod y confirmar ambos temas con datos AMALAY.

## 🟡 LISTO PERO NO EN PROD — Control Plane / super-admin
- Rama **`feature/control-plane`** (contiene el rediseño mergeado + el control plane completo: seguridad, feature flags globales, onboarding=esqueleton, UI DS v2, audit inmutable, + 2FA por correo en `platform-auth.ts`).
- **Preview de Vercel** (apunta a STAGING jkcnxfbb): `https://fullsite-git-feature-control-plane-daniel-ramonfaur-s-projects.vercel.app` (Deployment Protection ON). Credenciales de login staging: **en memoria de Claude** (pedir; son de staging).
- **NO mergeado a prod. NO se aplicaron migraciones a prod.**

### PASO B — para subir el Control Plane a prod (lo aprueba/ejecuta el fundador, en orden):
1. Aplicar 3 migraciones a **prod** (`qjiomlvudfmzuvqvhwpk`), validadas ya en staging: `supabase/migrations/20260811010000_platform_admin_lockdown.sql`, `..020000_platform_settings_feature_flags.sql`, `..030000_platform_audit_log.sql`.
2. Confirmar `SUPABASE_SERVICE_KEY` de prod en Vercel **Production** env (dashboard, nunca en chat).
3. `daniel@fullsite.mx` en `platform_admins` de prod → **ya está** ✅. **OJO:** el flag `app_metadata.platform_admin` se **quitó** de esa cuenta (2026-08-17) para que el login aterrice en el dashboard de AMALAY y no en `/platform`. Al subir el control-plane hay que **re-agregarlo** (`raw_app_meta_data || '{"platform_admin":true}'`), o el gate `/platform` del middleware bloquea al propio fundador.
4. Merge `feature/control-plane` → `main` + deploy (después de 1-3, o `/platform` se rompe).
5. Verificar: gate `/platform` bloquea no-admins + prueba 2-tenants (un tenant no puede voltear un flag global).

## 📖 Documentos clave producidos
- `docs/product/FULLSITE-VS-WANSOFT-BIBLE.md` (1008 líneas) — comparación completa Fullsite vs Wansoft: schema nativo real (1,048 SPs, 85+ tablas, ~120 endpoints), 71 gaps (6 P0 · 23 P1 · 42 P2), y **Sección 10 = roadmap ejecutable (29 tickets en 4 waves)**. Artifact HTML publicado.
- Migraciones control-plane en `supabase/migrations/2026081101/02/03*.sql`.

## 🌳 Ramas y worktrees
- `main` = prod (con rediseño). `redesign/app-ui` = rediseño. `feature/control-plane` = control plane (basado en app-ui).
- Worktrees: `.claude/worktrees/app-ui` (redesign/app-ui) y `.claude/worktrees/control-plane` (feature/control-plane).

## ▶️ Próximos pasos abiertos
- Fundador: verificar rediseño en prod (ambos temas) + decidir PASO B (subir control plane).
- Opcional: convertir el roadmap de la Biblia (29 tickets) en issues de GitHub.
- Backlog: 6 P0 (descuadre/fiscal/offline) → Wave 0 cuando se decida.

## 🔑 Cómo retomar sin perderte (regla)
1. **Sesión nueva por tarea** en `~/fullsite` (no reabrir la sesión de 59 MB).
2. Primer mensaje: "lee `docs/HANDOFF-STATE.md`".
3. Al cerrar cada tarea grande, pídele a Claude que **actualice este archivo** — así siempre refleja el estado real.
