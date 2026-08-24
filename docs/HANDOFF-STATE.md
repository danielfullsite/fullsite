# Estado del proyecto — Handoff (2026-08-17)

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
