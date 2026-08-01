# DEPLOY_SANDBOX — Fullsite sandbox desde cero

Procedimiento completo para desplegar un entorno sandbox independiente de AMALAY producción.

**URL objetivo:** `https://sandbox.app.fullsite.mx/login`  
**Usuario demo:** `owner@vantara.sandbox` / `Vantara2026!`  
**Rama Git:** `sandbox/second-customer-skeleton`  
**Tiempo estimado:** 30–45 min (sin contar propagación DNS)

---

## Prerequisitos

| Herramienta | Versión mínima | Para qué |
|---|---|---|
| Python 3 | 3.9+ | Correr scripts de bootstrap |
| Git | cualquiera | Clonar el repo |
| Cuenta Supabase | — | Crear el proyecto sandbox |
| Cuenta Vercel | — | Desplegar la aplicación |
| Acceso DNS (Cloudflare) | — | Crear CNAME `sandbox.app` |

No se necesita Node.js local — el build corre en Vercel.

---

## Fase 1 — Supabase: crear el proyecto

1. Ir a [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Nombre: `fullsite-sandbox`
3. Región: US East (o la más cercana a Monterrey)
4. Contraseña de base de datos: generar y guardar en 1Password
5. Esperar hasta que el proyecto esté activo (~2 min)

**Recolectar credenciales** (Settings → API):

| Variable | Dónde encontrarla |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL_SANDBOX` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX` | anon key (public) |
| `SANDBOX_SERVICE_KEY` | service_role key (secret) |

Guardar en un `.env.sandbox.local` local (nunca commitear):

```
NEXT_PUBLIC_SUPABASE_URL_SANDBOX=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX=eyJ...
SANDBOX_SERVICE_KEY=eyJ...
SANDBOX_ENV=true
```

---

## Fase 2 — Supabase: aplicar migraciones

Ir a **Supabase Dashboard → SQL Editor** del proyecto `fullsite-sandbox`.

Aplicar en este orden exacto. Cada archivo va en una ejecución separada.

```
scripts/sql/sandbox/migrations/000_extensions_sandbox.sql
scripts/sql/sandbox/migrations/010_consolidated_core_sandbox.sql
scripts/sql/sandbox/migrations/003_rls_policies_sandbox.sql
scripts/sql/sandbox/migrations/004_functions_sandbox.sql
scripts/sql/sandbox/migrations/008_realtime_sandbox.sql
scripts/sql/sandbox/migrations/SKEL-01_seed_vantara.sql
scripts/sql/sandbox/migrations/SKEL-03_restaurant_data.sql
```

Para cada archivo:
1. Abrir el archivo localmente
2. Copiar contenido completo
3. Pegar en SQL Editor
4. Click **Run**
5. Verificar que dice "Success" — si hay error, detener y reportar

---

## Fase 3 — Bootstrap de usuarios Auth

Desde la raíz del repo, con las variables de entorno del Paso 1:

```bash
source dashboard-app/.env.sandbox.local
python3 scripts/sql/sandbox/bootstrap_auth.py
```

Salida esperada:

```
fullsite-sandbox bootstrap — https://<ref>.supabase.co
Creating 2 users...

  CREATED  owner@vantara.sandbox  id=<uuid>
  CREATED  test@nomada.sandbox    id=<uuid>

  LINKED   owner@vantara.sandbox → client_users(client_id=vantara, role=dueño)
  LINKED   test@nomada.sandbox   → client_users(client_id=nomada-mini, role=dueño)

Bootstrap complete.
```

Si un usuario ya existe (re-run idempotente), aparece `EXISTS` en lugar de `CREATED`.

---

## Fase 4 — Smoke test local

Verificar que las migraciones y el bootstrap quedaron correctos:

```bash
source dashboard-app/.env.sandbox.local
python3 scripts/sql/sandbox/smoke_test.py
```

Todos los checks deben mostrar `PASS`. Si alguno falla, revisar la fase correspondiente.

**Nota sobre el WARN de aislamiento cross-tenant:** es esperado en SKEL-01/03. RLS completo se implementa en SKEL-04.

---

## Fase 5 — Vercel: crear el proyecto sandbox

1. Ir a [vercel.com/new](https://vercel.com/new)
2. Import → seleccionar el repo `fullsite` (o `ramonfaurdaniel-png/fullsite`)
3. Configuración:
   - **Project Name:** `fullsite-sandbox`
   - **Root Directory:** `dashboard-app`
   - **Framework:** Next.js (auto-detectado)
   - **Branch:** `sandbox/second-customer-skeleton`

4. Antes de hacer click en **Deploy**, ir a **Environment Variables** y agregar:

| Variable | Valor | Environments |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (anon key) | Production, Preview, Development |
| `SUPABASE_SERVICE_KEY` | `eyJ...` (service key) | Production, Preview, Development |
| `SANDBOX_ENV` | `true` | Production, Preview, Development |

   **IMPORTANTE:** estas son las credenciales de `fullsite-sandbox`, NO de AMALAY.

5. Click **Deploy**

El build debe completarse en ~3 min. Si el build falla con:
```
[SANDBOX] NEXT_PUBLIC_SUPABASE_URL apunta al proyecto AMALAY producción
```
significa que se pegaron las variables incorrectas (producción en lugar de sandbox).

---

## Fase 6 — DNS: crear CNAME

En Cloudflare (o tu proveedor DNS), en la zona `fullsite.mx`:

| Nombre | Tipo | Valor | Proxy |
|---|---|---|---|
| `sandbox.app` | CNAME | `cname.vercel-dns.com` | OFF (nube gris) |

Guardar. La propagación toma 1–5 min.

---

## Fase 7 — Vercel: agregar dominio

1. Vercel → proyecto `fullsite-sandbox` → **Settings → Domains**
2. Click **Add** → ingresar `sandbox.app.fullsite.mx`
3. Vercel verificará el CNAME automáticamente (puede tardar 1–2 min)
4. Estado debe cambiar a **Valid** con certificado TLS

---

## Fase 8 — Validación final

Abrir desde una computadora diferente (sin acceso al repo):

```
https://sandbox.app.fullsite.mx/login
```

Flujo de validación completo:

- [ ] La página carga en < 3 segundos
- [ ] Iniciar sesión como `owner@vantara.sandbox` / `Vantara2026!`
- [ ] Dashboard carga sin errores de consola sobre AMALAY
- [ ] POS abre con 12 mesas y menú VANTARA
- [ ] Crear una orden: seleccionar mesa, agregar Ribeye (requiere punto de cocción), cobrar en Efectivo
- [ ] La orden queda cerrada
- [ ] El dashboard refleja la venta
- [ ] Ningún dato de AMALAY es visible

Si algún paso falla, revisar la consola del browser y los logs en Vercel → proyecto `fullsite-sandbox` → Functions.

---

## Rollback

### Rollback parcial (quitar acceso web, mantener datos)
- Vercel → `fullsite-sandbox` → Settings → Domains → Eliminar `sandbox.app.fullsite.mx`
- El proyecto sigue existiendo pero la URL pública ya no resuelve

### Rollback completo (teardown total)
- Vercel → `fullsite-sandbox` → Settings → Delete Project
- Supabase → `fullsite-sandbox` → Settings → Danger Zone → Delete project
- Cloudflare → eliminar el registro CNAME `sandbox.app`
- La rama Git `sandbox/second-customer-skeleton` no se toca — sigue siendo la referencia del trabajo

### Lo que NO se revierte en producción
- El proyecto `fullsite` (AMALAY) en Vercel no fue modificado
- El proyecto `qjiomlvudfmzuvqvhwpk` (Supabase AMALAY) no fue modificado
- `main` branch no fue modificado

---

## Credenciales de demo (cambiar antes de demo con cliente externo)

| Usuario | Contraseña | Tenant | Rol |
|---|---|---|---|
| `owner@vantara.sandbox` | `Vantara2026!` | VANTARA | dueño |
| `test@nomada.sandbox` | `Nomada2026!` | NÓMADA-MINI | dueño (test de aislamiento) |

Staff PINs (POS):

| Nombre | PIN | Rol |
|---|---|---|
| Carlos Mendoza | 9001 | admin |
| Sofia Torres | 1001 | mesero |
| Diego Ramírez | 1002 | mesero |
| Ana Gutiérrez | 1003 | mesero |
