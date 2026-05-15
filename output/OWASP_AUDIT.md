# OWASP Security Audit — Fullsite Dashboard

**Fecha:** 2026-05-13  
**Scope:** `/Users/danielrg/fullsite/dashboard-app/src/`  
**Auditor:** Claude (automated review)

---

## Resumen

| Categoria | Riesgo | Hallazgos |
|---|---|---|
| SQL Injection | BAJO | Supabase SDK parametriza queries automaticamente |
| XSS | BAJO | React escapa output por default; no se usa `dangerouslySetInnerHTML` |
| Authentication Bypass | MEDIO | Proxy middleware no valida sesion; depende de auth client-side |
| Sensitive Data Exposure | MEDIO | `console.log` expone email de usuario en login |
| CSRF | BAJO | Cookies SameSite por default en Supabase; API usa JSON body |
| Rate Limiting | ALTO | No hay rate limiting en `/api/chat` |
| Broken Access Control | MEDIO | Fallback a `amalay` client_id cuando no hay mapping |

---

## 1. SQL Injection (A03:2021)

**Riesgo: BAJO**

Todas las queries usan el SDK de Supabase (`supabase.from().select().eq()`) que parametriza automaticamente. No hay SQL crudo.

`data.ts` usa `sbFetch()` con interpolacion de strings para parametros REST:
```
`select=*&fecha=eq.${fecha}&limit=1`
```
Esto pasa por la API REST de Supabase (PostgREST) que sanitiza parametros automaticamente. No es vulnerable a SQL injection clasico, pero un valor de `fecha` malformado podria causar errores 400.

**Recomendacion:** Validar formato de fecha antes de usarlo en queries (regex `YYYY-MM-DD`).

---

## 2. XSS (A07:2021)

**Riesgo: BAJO**

- React escapa todo el contenido renderizado por default.
- No se encontro uso de `dangerouslySetInnerHTML` en ningun componente.
- El chat (`ChatWidget.tsx`) renderiza respuestas de la API dentro de `<div className="whitespace-pre-wrap">{msg.content}</div>` — esto es seguro porque React escapa el contenido.
- Las respuestas de Claude se muestran como texto plano, no como HTML.

**Hallazgo menor:** Los mensajes del chat se renderizan usando el indice del array como key (`key={i}`), lo cual puede causar bugs de UI pero no es un problema de seguridad.

**Sin accion requerida.**

---

## 3. Authentication Bypass (A01:2021 / A07:2021)

**Riesgo: MEDIO**

### 3.1 Proxy/Middleware no valida autenticacion

**Archivo:** `src/proxy.ts`

El middleware simplemente hace `NextResponse.next()` sin validar la sesion:
```typescript
export async function proxy(request: NextRequest) {
  return NextResponse.next()
}
```

La autenticacion se maneja enteramente en el cliente (AppShell). Esto significa que:
- Las rutas de API son accesibles sin autenticacion a nivel de middleware
- La unica proteccion server-side esta en `route.ts` del chat (que si valida auth)
- Los datos se obtienen en Server Components usando el anon key directamente

**Recomendacion:** Implementar validacion de sesion en el middleware para proteger rutas de API y paginas server-side.

### 3.2 Chat API valida autenticacion correctamente

**Archivo:** `src/app/api/chat/route.ts`

La ruta `/api/chat` si valida la autenticacion usando cookies del servidor:
```typescript
const user = await getAuthUser()
if (!user) {
  return Response.json({ error: 'No autorizado' }, { status: 401 })
}
```
Esto es correcto.

### 3.3 Fallback a client_id hardcoded

**Archivo:** `src/contexts/AuthContext.tsx`

Cuando no se encuentra mapping en `client_users`, el sistema hace fallback a `amalay`:
```typescript
setClientId('amalay')
```
Esto podria permitir que un usuario autenticado sin mapping vea datos de AMALAY si no hay RLS configurado correctamente.

**Recomendacion:** Retornar error en lugar de fallback. O asegurar que RLS en Supabase impida acceso cruzado.

---

## 4. Sensitive Data Exposure (A02:2021)

**Riesgo: MEDIO**

### 4.1 Console.log expone datos del usuario

**Archivo:** `src/app/login/page.tsx` linea 24:
```typescript
console.log('Auth result:', { data: data?.user?.email, error: authError?.message })
```
Esto expone el email del usuario en la consola del navegador. En produccion, esto no deberia estar presente.

**Recomendacion:** Eliminar este `console.log` o condicionarlo a `process.env.NODE_ENV === 'development'`.

### 4.2 API Keys en variables de entorno

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son expuestas al cliente (esperado y correcto con Supabase).
- `SUPABASE_SERVICE_KEY` y `ANTHROPIC_API_KEY` solo se usan server-side en `route.ts` y `supabase.ts` (correcto).
- `.env*` esta en `.gitignore` (correcto).

### 4.3 Service key usage

**Archivo:** `src/lib/supabase.ts`

`createServiceClient()` usa `SUPABASE_SERVICE_KEY` que bypasea RLS. Se usa en `route.ts` para queries del chat. Esto es intencional pero debe limitarse a server-side routes.

**Recomendacion:** Verificar que `createServiceClient()` nunca se importe desde componentes client-side.

---

## 5. CSRF (A01:2021)

**Riesgo: BAJO**

- La API `/api/chat` usa POST con JSON body (`Content-Type: application/json`). Los navegadores no envian JSON bodies en CSRF automatico (forms usan `application/x-www-form-urlencoded`).
- Supabase auth usa cookies con `SameSite=Lax` por default.
- No hay acciones destructivas (DELETE, UPDATE) expuestas via API del dashboard.

**Sin accion inmediata requerida.**

---

## 6. Rate Limiting (A04:2021)

**Riesgo: ALTO**

**Archivo:** `src/app/api/chat/route.ts`

No hay rate limiting en el endpoint `/api/chat`. Un usuario autenticado podria:
- Hacer miles de requests por minuto
- Consumir creditos de Anthropic API sin limite
- Causar costos inesperados

**Recomendacion:**
1. Implementar rate limiting por usuario (ej. 20 requests/minuto) usando un middleware o servicio como Upstash Redis.
2. Limitar el largo del mensaje de entrada (`message`).
3. Limitar el tamano del `history` array (actualmente limitado a 6, lo cual esta bien).

---

## 7. Broken Access Control (A01:2021)

**Riesgo: MEDIO**

### 7.1 No hay validacion de client_id en queries

**Archivo:** `src/lib/data.ts`

Las funciones `getRecentDays()`, `getLatestDay()`, etc. hacen queries a `wansoft_daily` sin filtrar por `client_id`. Actualmente solo hay un cliente (AMALAY), pero al escalar a multiples clientes esto permitiria ver datos de otros.

**Recomendacion:** Agregar filtro de `client_id` a todas las queries de datos. Alternativamente, configurar RLS en Supabase para filtrar automaticamente basado en el JWT.

### 7.2 Chat API no filtra por client_id

**Archivo:** `src/app/api/chat/route.ts`

El chat recibe `client_id` del body del request (controlado por el cliente). Un usuario podria enviar un `client_id` diferente para intentar acceder a datos de otro cliente:
```typescript
const { message, history = [], client_id = 'amalay' } = await request.json()
```
Actualmente el `client_id` no se usa en las queries del chat, pero es un riesgo si se implementa multi-tenancy.

**Recomendacion:** Obtener `client_id` del servidor (de la sesion/JWT), no del body del request.

---

## 8. Insecure Input Validation (A03:2021)

**Riesgo: BAJO**

### 8.1 Message validation en chat

El chat valida que `message` sea un string:
```typescript
if (!message || typeof message !== 'string') {
  return Response.json({ error: 'Mensaje requerido' }, { status: 400 })
}
```
Pero no valida el largo. Un mensaje de 100KB consumiria tokens de Anthropic innecesariamente.

**Recomendacion:** Limitar `message` a 2000 caracteres max.

### 8.2 History no se valida

El array `history` del chat no se valida por estructura ni tamano. Se toman los ultimos 6 elementos (bien), pero cada elemento podria tener contenido arbitrario.

**Recomendacion:** Validar que cada elemento de `history` tenga `role` y `content` validos.

---

## 9. Security Misconfiguration (A05:2021)

**Riesgo: BAJO**

- No se encontraron headers de seguridad (CSP, X-Frame-Options, etc.) configurados explicitamente. Vercel agrega algunos por default.
- No hay `next.config.js` con headers de seguridad custom.

**Recomendacion:** Agregar headers de seguridad en `next.config.js`:
```javascript
headers: [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]
```

---

## 10. Error Handling (A09:2021)

**Riesgo: BAJO**

El chat API maneja errores correctamente sin exponer detalles internos al cliente:
```typescript
catch (error) {
  console.error('Chat API error:', error)
  return Response.json({ response: 'Lo siento, hubo un error...' }, { status: 200 })
}
```

**Nota:** Retornar `status: 200` en error puede confundir a herramientas de monitoreo. Considerar usar `status: 500` con un mensaje generico.

---

## Prioridades de remediacion

| Prioridad | Issue | Esfuerzo |
|---|---|---|
| 1 - ALTA | Rate limiting en `/api/chat` | Medio (Upstash o similar) |
| 2 - MEDIA | Validar `client_id` server-side, no del body | Bajo |
| 3 - MEDIA | Quitar `console.log` de login en produccion | Trivial |
| 4 - MEDIA | Implementar middleware de auth real en `proxy.ts` | Medio |
| 5 - BAJA | Agregar security headers en `next.config.js` | Bajo |
| 6 - BAJA | Validar largo de `message` en chat | Trivial |
| 7 - BAJA | Validar formato de fecha en `data.ts` | Trivial |
