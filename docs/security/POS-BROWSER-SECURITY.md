# POS Browser Security Audit — Foundation v1

**Fecha:** 2026-07-29  
**Alcance:** `sandbox.app.fullsite.mx` → staging `jkcnxfbbuyyfhwfjizgw`  
**Ramas auditadas:** `sandbox/second-customer-skeleton`  
**Método:** static code analysis + live RLS query audit + session analysis  
**Decisión de producción:** ver sección [Criterios PASS/FAIL](#criterios-passfail-para-producción)

---

## Executive Summary

El sistema tiene **14 hallazgos P0** que bloquean la promoción a `app.fullsite.mx`. El patrón dominante es triple:

1. **user_metadata es user-writable en Supabase.** `role` y `client_id` se leen de `user_metadata` para decisiones de autorización. Cualquier usuario autenticado puede llamar `supabase.auth.updateUser({ data: { role: 'dueño', client_id: 'amalay' } })` desde DevTools y escalar privilegios. Esta es la vulnerabilidad más grave arquitecturalmente.

2. **Políticas RLS anon/public con `qual=true` sin filtro de tenant.** Un atacante sin credenciales puede leer y modificar datos financieros, órdenes, turnos y archivos de auditoría de todos los tenants vía REST directo a PostgREST.

3. **API routes sin autenticación aceptan totales financieros del cliente.** `/api/pos/save-order`, `/api/pos/merge-orders` y `/api/mp-point` no tienen autenticación y reciben `total`, `subtotal`, `iva`, `descuento` directamente del body del cliente. El patrón sistémico: `getClientId()` lee de un header `x-client-id` controlado por el cliente, sin ningún gate de autenticación, en ~25 routes.

Los hallazgos P1 y P2 no bloquean la promoción pero deben tener tickets asignados antes de agregar el Cliente #2 real.

---

## Scope

| Capa | Cobertura |
|---|---|
| RLS / DB | 100% — todas las políticas de `public` schema consultadas vía `pg_policies` |
| Autenticación | Login page, AuthContext, session storage, logout flow |
| Secrets / bundle | NEXT_PUBLIC_* vars, localStorage, cookies |
| API routes | `/api/pos/pin`, `/api/pos/order`, `/api/pos/cierre` (+ resto en api routes agent) |
| Acciones sensibles | PIN verificación, descuentos, cancelaciones, corte de caja |
| Terminal física | PIN por turno, WebAuthn (huella), logout |

---

## Threat Matrix

| ID | Amenaza | Control Actual | Estado | Severidad |
|---|---|---|---|---|
| T-01 | Mesero escala a dueño vía `updateUser()` | Ninguno (user_metadata es user-writable) | **FAIL** | P0 |
| T-02 | Atacante sin auth lee datos de todos los tenants vía REST | RLS anon con `qual=true` en 12+ tablas | **FAIL** | P0 |
| T-03 | XSS extrae access_token + refresh_token | Token en localStorage (no httpOnly) | **FAIL** | P0 |
| T-04 | Atacante con DevTools revierte PIN cache offline | `btoa(pin).slice(0,8)` no es hash | **FAIL** | P0 |
| T-05 | Tenant A lee credentials_vault del Tenant B | Policy `authenticated_all_vault` sin client_id filter | **FAIL** | P0 |
| T-06 | Brute-force de PIN en producción | Rate limiter en memoria (se resetea en cold start) | **FAIL** | P1 |
| T-07 | Staff ve roles y IDs de colegas en localStorage | WebAuthn cache incluye `{id, name, role}` | **FAIL** | P1 |
| T-08 | Atacante sin auth inyecta entradas en `pos_audit_log` | Policy `anon_insert_audit` sin auth | **FAIL** | P1 |
| T-09 | Usuario cambia `fullsite_client_id` en localStorage | Leído directamente por data.ts para scoping | **FAIL** | P1 |
| T-10 | Manager PIN históricamente en JS bundle | NEXT_PUBLIC_MANAGER_PINS referenciado en código | **WARN** | P1 |
| T-11 | `auth_client_id()` SECURITY DEFINER con `search_path=public` | Privilege escalation si se crea objeto en public | **WARN** | P2 |
| T-12 | Enumeración de tenants sin autenticación | `clients` table: policy `anon_read` con `qual=true` | **FAIL** | P0 |
| T-13 | Cookie `fs-at` accesible a JS (sin httpOnly) | Set via `document.cookie` sin HttpOnly flag | **FAIL** | P2 |
| T-14 | `NEXT_PUBLIC_DEFAULT_CLIENT_ID` revela tenant en bundle | Embebido en JS bundle público | **WARN** | P2 |
| T-15 | Fiscal data (CFDI) legible sin autenticación | `pos_cfdi_requests`: `anon_select` con `qual=true` | **FAIL** | P2 |

---

## Hallazgos P0 — Bloquean Producción

### P0-A — user_metadata es el vector de escalación de privilegios

**Descripción:** Supabase permite a cualquier usuario autenticado modificar su propio `user_metadata` usando `supabase.auth.updateUser()`. El sistema usa `user_metadata.role` para el redirect post-login y `user_metadata.client_id` como fuente de autoridad #1 para resolver el tenant activo.

**Exploit:** Cualquier mesero con acceso al navegador ejecuta en DevTools:
```javascript
const { createClient } = await import('/src/lib/supabase-browser.ts') // o cargado en window
const sb = createClient()
await sb.auth.updateUser({ data: { role: 'dueño', client_id: 'amalay' } })
// Siguiente login → redirect a dashboard con acceso full a datos AMALAY
```

**Archivos afectados:**
- `src/app/login/page.tsx:63` — `user_metadata?.role` → redirect
- `src/contexts/AuthContext.tsx:60` — `user_metadata.client_id` como Priority 1

**Fix requerido:**
1. Mover `role` y `client_id` a `app_metadata` (solo escribible con service_role):
   ```sql
   UPDATE auth.users
   SET raw_app_meta_data = jsonb_build_object('role', cu.role, 'client_id', cu.client_id)
   FROM client_users cu
   WHERE auth.users.id = cu.user_id;
   ```
2. En `AuthContext.tsx`: cambiar la lectura a `user?.app_metadata?.client_id`
3. En `login/page.tsx`: usar `user?.app_metadata?.role` o esperar resolución de `client_users`
4. RLS puede usar `auth.jwt()->'app_metadata'->>'client_id'` directamente, eliminando la table lookup en `auth_client_id()`

**Severidad:** P0 — explotable por cualquier staff con acceso a un navegador

---

### P0-B — credentials_vault: cualquier usuario autenticado lee todos los secrets

**Descripción:** La tabla `credentials_vault` (API keys, tokens de integraciones) tiene policy `authenticated_all_vault` con `cmd=ALL` y `qual=true`. Tenant A puede leer, modificar y eliminar las credenciales del Tenant B.

**Exploit:**
```bash
curl -H "Authorization: Bearer <token_mesero_vantara>" \
  "https://jkcnxfbbuyyfhwfjizgw.supabase.co/rest/v1/credentials_vault?select=*"
# → Retorna credentials de TODOS los tenants
```

**Fix:** Agregar policy con filtro de tenant:
```sql
DROP POLICY authenticated_all_vault ON credentials_vault;
CREATE POLICY auth_tenant ON credentials_vault
  FOR ALL TO authenticated
  USING (client_id = auth_client_id())
  WITH CHECK (client_id = auth_client_id());
```

**Severidad:** P0 — fuga completa de credenciales entre tenants

---

### P0-C — clients table: enumeración anon + cross-tenant R/W

**Descripción:** La tabla `clients` tiene:
- Policy `anon_read` (roles `{anon}`, qual `true`) — enumerable sin autenticación
- Policy `authenticated_all` (roles `{authenticated}`, qual `true`) — cualquier usuario modificar el registro de cliente de otro tenant

**Exploit anon:**
```bash
curl "https://jkcnxfbbuyyfhwfjizgw.supabase.co/rest/v1/clients?select=*&apikey=<anon_key>"
# → Lista completa de todos los restaurantes en la plataforma
```

**Fix:**
```sql
DROP POLICY anon_read ON clients;
DROP POLICY authenticated_all ON clients;
-- Los usuarios solo ven su propio client row
CREATE POLICY auth_tenant ON clients
  FOR SELECT TO authenticated
  USING (id = auth_client_id());
-- Los admins del sistema usan service_role key
```

**Severidad:** P0 — fuga de directorio de tenants, modificación cross-tenant

---

### P0-D — Auth token en localStorage (XSS → sesión permanente)

**Descripción:** `login/page.tsx` escribe el objeto de sesión completo de Supabase (incluye `access_token` + `refresh_token` + `user_metadata`) en localStorage bajo `sb-<project>-auth-token`. `AuthContext` lo lee en cold start. Cualquier XSS puede extraer ambos tokens y obtener acceso permanente a la cuenta.

**Archivos:** `src/app/login/page.tsx:~55`, `src/contexts/AuthContext.tsx:~132`

**Fix:** Usar `@supabase/ssr` con cookie storage (`createServerClient` en middleware) para que el access token viaje como httpOnly cookie. El `refresh_token` nunca debería estar en localStorage.

**Severidad:** P0 — sesión robable vía cualquier XSS (script de terceros, inject en respuesta HTML)

---

### P0-E — PIN cache offline reversible (btoa ≠ hash)

**Descripción:** `src/app/pos/layout.tsx` almacena el cache offline de PINs como `btoa(pin).slice(0,8) → {id, name, role}`. `btoa()` es codificación Base64, no hashing. Un PIN de 4 dígitos tiene 10,000 combinaciones; iterar `atob()` para todos es instantáneo:

```javascript
// En DevTools — recupera todos los PINs en <1ms
const cache = JSON.parse(localStorage.getItem('pos_auth_cache'))
for (const [hash, staff] of Object.entries(cache)) {
  for (let p = 0; p < 10000; p++) {
    if (btoa(String(p).padStart(4,'0')).slice(0,8) === hash) {
      console.log(`${staff.name} (${staff.role}): ${p}`)
    }
  }
}
```

**Fix:** Reemplazar con un token firmado server-side por turno (JWT corto o token opaco de `pos_turnos`). El server-side PIN check ya existe en `/api/pos/pin` — el cache offline debería ser un token de sesión por shift, no un derivado del PIN.

**Severidad:** P0 — expone PINs de todo el staff con localStorage access (físico o XSS)

---

## Hallazgos P1 — Resolver Antes del Cliente #2

### P1-01 — pos_gastos: acceso anon completo

Policy `anon_all_gastos` (cmd ALL, qual true) → cualquier usuario sin auth puede crear, leer y eliminar gastos de cualquier tenant.

**Fix:** Eliminar policy anon. Los gastos solo se crean vía terminal autenticada.

---

### P1-02 — pos_audit_log: inyección anon de eventos de auditoría

Policy `anon_insert_audit` permite a atacantes sin auth inyectar entradas falsas en el log de auditoría. El log de auditoría es la evidencia de anti-fraude.

**Fix:** Solo authenticated + `client_id = auth_client_id()` puede insertar. SELECT debe requerir auth.

---

### P1-03 — 10 tablas financieras con policies anon/public sin scoping

Las siguientes tablas tienen acceso anon o `{public}` sin filtro de tenant:

| Tabla | Policy problemática | Impacto |
|---|---|---|
| `ops_daily` | public ALL, qual=true | Datos operativos cross-tenant R/W |
| `pos_staff_audit` | anon ALL, qual=true | Trail de auditoría de staff manipulable |
| `pos_inventory_alerts` | public ALL, qual=true | Alertas de inventario cross-tenant |
| `pos_print_jobs` | anon ALL, qual=true | Inyección de print jobs |
| `pos_turnos` | anon ALL (bypasa auth_tenant) | Turnos cross-tenant |
| `pos_customers` | anon SELECT+UPDATE (bypasa auth_tenant) | Clientes legibles sin auth |
| `pos_orders` | anon SELECT+UPDATE (bypasa auth_tenant) | Órdenes legibles/modificables sin auth |
| `pos_cierres` | anon READ+INSERT | Cierres de caja inyectables |
| `pos_cash_movements` | anon READ+INSERT | Movimientos de efectivo inyectables |
| `delivery_orders` | public full R/W | Órdenes delivery cross-tenant |

**Causa raíz:** Las policies PERMISSIVE en PostgreSQL se OR-combinan por rol. Una tabla con `auth_tenant` (correcta) y `anon_read` (sin filtro) resulta en acceso anon a todos los datos porque la segunda policy gana para requests no autenticados.

**Fix general:** Eliminar todas las policies `anon_*` con `qual=true`. Las terminales POS usan tokens de sesión autenticados. Si se necesita acceso sin auth (e.g., print bridge local), usar service_role key en un Edge Function, no exponer PostgREST directo.

---

### P1-04 — Rate limiter de PIN en memoria (reseteable)

`/api/pos/pin/route.ts` usa un `Map` a nivel de módulo para rate limiting. En Vercel, cada función serverless arranca con un módulo limpio. Un atacante puede hacer brute force de PINs asegurando que cada request caiga en una instancia nueva.

**Fix:** Usar Supabase para persistir intentos fallidos:
```sql
CREATE TABLE pos_pin_attempts (
  ip TEXT, client_id TEXT,
  attempts INTEGER DEFAULT 0,
  last_attempt TIMESTAMPTZ DEFAULT now(),
  locked_until TIMESTAMPTZ,
  PRIMARY KEY (ip, client_id)
);
```

---

### P1-05 — WebAuthn credential cache incluye roles en localStorage

`src/app/pos/huella/page.tsx` escribe `pos_biometric_credentials`: `{credentialId → {id, name, role}}`. El campo `role` en este cache se usa para gate de descuentos de manager. Con localStorage access, un atacante puede leer todos los roles de staff o inyectar un credential falso con `role: 'admin'`.

**Fix:** Almacenar solo `{credentialId → staffId}`. Resolver role server-side vía `/api/pos/pin` con `fingerprint_id` (ya existe).

---

### P1-06 — NEXT_PUBLIC_MANAGER_PINS — verificar eliminación completa

El var `NEXT_PUBLIC_MANAGER_PINS` fue históricamente incluido en el bundle. La lógica fue migrada a server-side (`MANAGER_PINS` privado → `/api/pos/pin`). Confirmar que no queda ninguna referencia activa en el bundle actual.

**Acción:** `grep -r "NEXT_PUBLIC_MANAGER_PINS" dashboard-app/src/` → debe ser 0 resultados en código activo (puede quedar en comentarios de migración).

---

### P1-07 — fullsite_client_id en localStorage es fuente de scoping para data.ts

`AuthContext` escribe `fullsite_client_id` en localStorage. `data.ts` llama `getActiveClientSlug()` que lee este valor para scope de queries. Un atacante con acceso a DevTools puede cambiar este valor y hacer que las siguientes queries lean datos del tenant equivocado.

**Mitigación RLS:** Si RLS está correctamente configurado, PostgREST rechazará queries cross-tenant. Sin embargo, las tablas con acceso abierto (P1-03) sí retornarán datos incorrectos.

**Fix:** `getActiveClientSlug()` debe derivar el `client_id` del JWT activo, no de localStorage.

---

## Hallazgos P2 — Sprint siguiente

### P2-01 — auth_client_id() SECURITY DEFINER con search_path=public

La función `auth_client_id()` es SECURITY DEFINER + `search_path=public`. Si un atacante puede crear un objeto en el schema `public` (requiere privilegios de escritura en DDL), puede shadow los objetos que la función consulta. Bajo riesgo de explotación directa, pero viola el principio de mínimo privilegio.

**Fix:** Agregar `SET search_path = 'public', 'pg_catalog'` explícito y considerar mover la función a un schema privado.

---

### P2-02 — Cookie fs-at sin HttpOnly

`document.cookie = 'fs-at=...; secure; samesite=lax'` — la cookie es accesible a JavaScript, ofreciendo protección cero adicional sobre el valor ya en localStorage.

**Fix:** Setear como httpOnly via `Set-Cookie` header en un API route o middleware Next.js.

---

### P2-03 — client_locations legible cross-tenant para usuarios autenticados

Policy `Authenticated read`, roles `{authenticated}`, qual `true` → cualquier dueño de VANTARA puede leer todas las locations de NÓMADA.

---

### P2-04 — CFDI requests (datos fiscales) legibles sin auth

`pos_cfdi_requests`: `anon_select_cfdi_requests`, qual `true` → facturas en tránsito legibles sin autenticación.

---

### P2-05 — NEXT_PUBLIC_DEFAULT_CLIENT_ID revela tenant por defecto en bundle

Baja explotabilidad directa, pero expone la identidad del tenant "default" en el JS bundle público.

---

### P2-06 — memories/agent_results/agent_runs sin scoping de tenant

Tablas de agentes con `authenticated ALL, qual=true`. El Tenant A puede leer el historial de IA del Tenant B, los logs de agents, y las memorias de contexto.

---

## Hallazgos P0 — API Routes (Capa de Servidor)

### P0-F — /api/pos/save-order: No auth + totales financieros del cliente

**Descripción:** El endpoint core de persistencia de órdenes no tiene autenticación. `total`, `subtotal`, `iva`, `descuento` y `propina` provienen directamente del body del request y se pasan al RPC `r1_save_order` sin re-cálculo server-side.

**Exploit:**
```bash
curl -X POST https://sandbox.app.fullsite.mx/api/pos/save-order \
  -H "x-client-id: vantara" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"...", "total": 0.01, "subtotal": 0.01, "iva": 0, "items": [...], "descuento": 9999}'
```

**Fix:** Agregar `requireAuth()`. Recalcular `total = sum(items[].price * qty) - descuento_validado + iva` server-side, rechazando cualquier discrepancia >1%.

---

### P0-G — /api/pos/merge-orders: No auth + totales del cliente

Igual que P0-F pero para merge de órdenes. `total`, `subtotal`, `iva` aceptados del cliente.

---

### P0-H — /api/mp-point: Auth header forgeable + monto del cliente

`x-pos-staff` es un header auto-afirmado que cualquier caller puede incluir. El `accessToken` de MercadoPago y el `amount` del cobro vienen del body del cliente. No hay re-validación del monto contra el total de la orden en DB.

**Exploit:** Un atacante que conoce cualquier token de MP puede cobrar o reembolsar montos arbitrarios.

---

### P0-I — /api/clip-pinpad: Completamente sin auth

Zero autenticación. El cliente envía su propio Clip `apiKey` más `amount` y `orderId`. Cualquier llamada anónima puede iniciar cobros a terminales Clip.

---

### P0-J — /api/deepgram-token: API key de tercero expuesta

`GET /api/deepgram-token` retorna la clave raw de Deepgram a cualquier caller anónimo. No hay autenticación.

**Fix:** Agregar `requireAuth()`. Alternativamente, usar Deepgram's scoped token endpoint server-side y retornar un token de sesión corta.

---

### P0-K — /api/webhook/ubereats: HMAC no implementado

El código tiene un comentario `// TODO: implement HMAC verification`. Cualquier caller puede POST una orden falsa de Uber Eats con items, montos y datos del cliente arbitrarios. La ruta auto-acepta la orden vía la API real de Uber.

---

### P0-L — /api/factura/timbrar: Sin tenant isolation en CFDI

Auth presente vía `requireAuth()` pero la búsqueda del `pos_cfdi_requests` no filtra por `client_id`. Cualquier usuario autenticado puede timbrar un CFDI de otro tenant conociendo (o adivinando) su UUID. Genera documentos fiscales CFDI 4.0 inválidos a nombre del tenant incorrecto.

---

### P0-M — /api/onboarding: Abierto si ONBOARDING_SECRET no está seteado

Si `ONBOARDING_SECRET` no está configurado en el entorno, el route está completamente abierto. Cualquier caller puede crear cuentas de Supabase con `role: 'dueño'` vía `auth.admin.createUser()`.

**Acción inmediata:** Verificar que `ONBOARDING_SECRET` está seteado en Vercel env (production, preview, development). Agregar un guard que falle cerrado (401) si la variable no está seteada.

---

### P0-N — getClientId() sistémico: x-client-id es client-controlled sin auth

**Descripción:** `getClientId()` lee el header `x-client-id` (o query param `client_id`) sin verificar que el usuario autenticado pertenezca a ese tenant. Aproximadamente **25 routes** tienen este patrón sin auth gate. Cualquier atacante que sepa el slug de un tenant puede leer y mutar datos de ese tenant.

**Tablas afectadas sin auth:** pos_orders, pos_staff, pos_turnos, pos_menu_items, pos_inventory, pos_recipes, pos_audit_log, pos_cash_movements, pos_cierres, y más.

**Fix sistémico:** Crear un middleware `withPOSAuth()` que:
1. Valide el token de sesión (`requireAuth()`)
2. Resuelva el `client_id` del JWT/`client_users`, NO del header
3. Retorne error si el header `x-client-id` no coincide con el `client_id` del usuario autenticado

```typescript
// src/lib/api-auth.ts
export async function withPOSAuth(req: Request): Promise<{user: User, clientId: string} | NextResponse> {
  const user = await requireAuth(req)
  if (!user) return NextResponse.json({error: 'Unauthorized'}, {status: 401})
  const clientId = await getClientIdFromDB(user.id) // client_users lookup
  return {user, clientId}
}
```

---

## Automated Authorization Tests

Archivo: `dashboard-app/src/__tests__/security-authorization.test.ts`

Los tests abajo verifican propiedades de seguridad testables sin conexión a red (lógica pura y configuración).

```typescript
// dashboard-app/src/__tests__/security-authorization.test.ts
// Ejecutar con: pnpm test --run security-authorization
```

Ver archivo: `dashboard-app/src/__tests__/security-authorization.test.ts`

### Integration tests requeridos (requieren staging DB)

Los siguientes scenarios deben ejecutarse manualmente contra staging antes de cada deploy a `app.fullsite.mx`:

| Test | Comando / Método | Criterio PASS |
|---|---|---|
| IT-01 — anon no puede leer pos_orders | `curl "${STAGING_URL}/rest/v1/pos_orders?select=*&apikey=${ANON_KEY}"` | HTTP 200 con array vacío O HTTP 401 |
| IT-02 — VANTARA no lee órdenes de NÓMADA | Login VANTARA owner, GET pos_orders | Solo retorna rows con `client_id=vantara` |
| IT-03 — mesero no puede actualizar su propio role en user_metadata | `supabase.auth.updateUser({data:{role:'dueño'}})` desde sesión mesero → reload → `auth_client_id()` sigue siendo mesero | PASS si client_users prevalece |
| IT-04 — credentials_vault scoped por tenant | Login VANTARA, GET credentials_vault | Solo rows donde `client_id=vantara` |
| IT-05 — PIN brute force bloqueado después de N intentos | POST `/api/pos/pin` 10 veces con PINs incorrectos | HTTP 429 en el intento 6+ |
| IT-06 — logout limpia session completa | Logout → acceder con token anterior | HTTP 401 (token revocado) |
| IT-07 — PRUEBA-3 aislada de VANTARA | Login PRUEBA-3, GET pos_menu_items | 0 rows de VANTARA |

---

## Criterios PASS/FAIL para Producción

### Promoción a `app.fullsite.mx` — BLOQUEADA hasta:

| Criterio | ID | Requisito | Estado |
|---|---|---|---|
| **user_metadata no se usa para auth** | P0-A | `role` y `client_id` en `app_metadata` O client_users siempre es fuente de verdad | FAIL |
| **credentials_vault scoped** | P0-B | Policy `auth_tenant` con `client_id = auth_client_id()` | FAIL |
| **clients table protegida** | P0-C | `anon_read` eliminada; auth tenant scoping en SELECT | FAIL |
| **IT-01 PASS** | P0-C | anon GET pos_orders → vacío o 401 | FAIL |
| **IT-02 PASS** | P0-C | cross-tenant data isolation verificado | FAIL |
| **PIN cache reemplazado** | P0-E | `pos_auth_cache` usa token signed, no btoa(pin) | FAIL |

### Antes del Cliente #2 (Cliente #2 = nuevo tenant pagante):

| Criterio | ID | Requisito |
|---|---|---|
| Policies anon eliminadas en tablas financieras | P1-01/03 | pos_gastos, pos_orders, pos_turnos, pos_cierres, pos_cash_movements, pos_audit_log |
| Rate limiter persistente | P1-04 | Intentos de PIN guardados en Supabase, no en memoria |
| WebAuthn cache sin roles | P1-05 | `pos_biometric_credentials` solo almacena `{credentialId: staffId}` |
| IT-03 a IT-07 todos PASS | varios | Isolation suite completa pasa en staging |

---

## Evidencia de Controles Existentes (qué funciona bien)

| Control | Estado | Evidencia |
|---|---|---|
| SUPABASE_SERVICE_KEY nunca en cliente | PASS | `src/` no referencia service key en 'use client' files |
| PIN verificado server-side | PASS | `/api/pos/pin` lee `MANAGER_PINS` de env (server-only), valida y retorna role |
| RLS habilitado en todas las tablas | PASS | `pg_class.relrowsecurity=true` para todas las tablas de `public` |
| `auth_client_id()` usa `auth.uid()` | PASS | Función SECURITY DEFINER resuelve desde `client_users` por `user_id` |
| `auth_tenant` policy en 13 tablas core | PASS | pos_menu_items, pos_menu_categories, pos_staff, pos_payment_methods, etc. |
| Acciones sensibles detrás de PIN modal | PASS | Descuentos y cancelaciones requieren re-autenticación con PIN |
| console.log no imprime tokens ni PINs | PASS | Solo UUIDs de órdenes y nombres de mesa en logs |
| SKEL-04 aplicado en staging | PASS | 13 tablas con policy `auth_tenant` correcta |

---

## Roadmap de Remediación

### Sprint inmediato (antes de `foundation-v1` → app.fullsite.mx)

```
P0-A: Migrar role/client_id a app_metadata
  1. SQL: backfill app_metadata desde client_users
  2. AuthContext: cambiar lectura a user?.app_metadata
  3. login/page.tsx: cambiar redirect source
  4. Test: IT-03 pasa

P0-B: credentials_vault tenant scoping
  SQL migration: drop + recrear con auth_tenant policy

P0-C: clients table — eliminar anon_read + authenticated_all
  SQL migration: drop policies, agregar auth_tenant SELECT

P0-E: PIN cache → session token
  Diseño: POST /api/pos/start-shift → token firmado → localStorage
  Layout.tsx: verificar token vs btoa
```

### Sprint siguiente (antes de Cliente #2)

```
P1-01 a P1-03: SQL migration eliminando todas las anon/public policies abiertas
P1-04: Rate limiter en tabla Supabase
P1-05: WebAuthn cache refactor (remover role field)
P1-06: Confirmar NEXT_PUBLIC_MANAGER_PINS eliminado
P1-07: getActiveClientSlug() desde JWT, no localStorage
```

---

*Audit conducido el 2026-07-29. Revisar y actualizar antes de cada deploy a producción.*
