# Offline Auth — Diseño Canónico v1

**Status:** DISEÑO — pendiente de aprobación
**Preparado por:** Runtime Verification
**Fecha:** 2026-08-04
**Aprobación requerida de:** Daniel antes de implementar

---

## 1. Mapa del production path actual

### Dos flujos completamente independientes

El sistema actual tiene **dos contextos de auth offline**, no uno:

| Contexto | Propósito | Flujo | Módulo |
|---|---|---|---|
| **A — Staff Login** | ¿Quién usa la terminal ahora? | Lockscreen de POSLayout | `pos/layout.tsx` |
| **B — Manager PIN** | Elevar permisos para operación específica | Modal inline (retiro, cierre, descuento) | `pos-data.ts` |

Estos flujos son independientes, usan storage keys distintas, y el PBKDF2 de `pos-manager-auth.ts` aplica solo a **Flujo B**.

---

### Flujo A — Staff Login (layout.tsx)

```
handleSubmit(pin)
  │
  ├─ Online: POST /api/pos/pin { pin, client_id }
  │     → { staff: {id, name, role}, shiftToken }
  │     → hashPin(pin, staff.id) = SHA-256("pin:staffId") [hex]
  │     → localStorage['pos_staff_cache'] = { id, name, role, exp: now+8h, pin_hash }
  │     → localStorage['pos_shift_token'] = shiftToken
  │
  └─ Offline (catch): lee localStorage['pos_staff_cache']
        → entry.exp > Date.now() (TTL 8h)
        → si pin_hash: SHA-256(pin:id) === pin_hash
        → si sin pin_hash (legacy): pasa directo (legacy compat)
```

**hashPin en layout.tsx** (línea 16):
```typescript
async function hashPin(pin: string, staffId: string): Promise<string> {
  const data = new TextEncoder().encode(`${pin}:${staffId}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
```
Algoritmo: `SHA-256(pin:staffId)` → hex string. **Activo en producción.**

---

### Flujo B — Manager PIN (pos-data.ts)

```
verifyManagerPin(pin) / verifyManagerPinWithRole(pin) / verifyPinWithMinRole(pin, minRole)
  │
  ├─ Online: POST /api/pos/pin { pin, client_id, manager: true }
  │     → { staff: {id, name, role}, shiftToken }
  │     → _pinCacheKey(pin) = btoa(pin)  ← obfuscación, NO hash criptográfico
  │     → localStorage['pos_manager_pin_cache'][btoa(pin)] = { name, role, cached_at: now }
  │
  └─ Offline (catch): lee localStorage['pos_manager_pin_cache'][btoa(pin)]
        → Date.now() - cached_at < 24h (PIN_CACHE_TTL_MS)
        → retorna { name, role }
```

**hashPin en pos-data.ts** (línea 1678):
```typescript
function _pinCacheKey(pin: string): string {
  return btoa(pin)  // NOT a hash — trivialmente reversible con atob()
}
```
**Activo en producción. El PIN es recuperable del localStorage.**

---

### Las cuatro implementaciones de PIN hash

| # | Archivo | Algoritmo | Input | Output | Estado |
|---|---|---|---|---|---|
| 1 | `pos/layout.tsx:16` | SHA-256(pin:staffId) | pin + staffId | hex | ✅ Activo — Flujo A |
| 2 | `pos-data.ts:1678` | btoa(pin) | pin | base64 | ✅ Activo — Flujo B (inseguro) |
| 3 | `pos-manager-auth.ts:82` | PBKDF2(pin, deviceSalt, 10K, SHA-256) | pin | base64 | ❌ Dead code |
| 4 | `api/pos/staff-cache/route.ts:11` | SHA-256(pin+'_fullsite_salt') | pin | hex | ❌ Endpoint sin callers |

---

## 2. Bug crítico detectado — KEY COLLISION

**`pos_staff_cache` es sobreescrita por `fetchMeseros`.**

```
1. Login exitoso → layout.tsx:455 escribe:
   localStorage['pos_staff_cache'] = { id, name, role, exp, pin_hash }

2. POS page monta → pos/page.tsx:1576 llama fetchMeseros()
   → pos-data.ts:1220 escribe (si online):
   localStorage['pos_staff_cache'] = ["Ana", "Luis", "Brayan", ...]   ← string[]

3. App va offline

4. Intento de re-login → layout.tsx:468 lee pos_staff_cache
   → JSON.parse → string[]
   → entry.exp === undefined
   → undefined > Date.now() === false
   → OFFLINE AUTH FALLA SILENCIOSAMENTE
```

**Impacto:** En condiciones normales (POS en uso activo), el auth offline del lockscreen falla. El personal no puede re-entrar si la pantalla se bloquea mientras están offline.

**Fix:** Rename en `pos-data.ts` de `pos_staff_cache` → `pos_meseros_cache`.

---

## 3. Diseño canónico propuesto

### Scope

**Solo Flujo B (Manager PIN).** Flujo A (Staff Login) funciona correctamente — SHA-256 con staffId es una mejora real sobre btoa, no requiere cambio.

La implementación canónica para Flujo B es `pos-manager-auth.ts` activada y conectada.

### Implementación canónica

```
verifyManagerPin(pin, context?) — firma nueva con context opcional
  │
  ├─ PASO 1: Online path
  │   POST /api/pos/pin { pin, client_id, manager: true }
  │   → { staff: { id, name, role }, shiftToken }
  │   → await provisionManagerCredential(pin, staff.id, staff.name, staff.role)
  │      ↳ hashPin(pin) = PBKDF2(pin, deviceSalt, 10K, SHA-256)
  │      ↳ guarda en localStorage['pos_manager_credentials_v2']
  │   → mantiene btoa cache (pos_manager_pin_cache) como write-through para rollback
  │   → retorna { name: staff.name, role: staff.role }
  │
  └─ PASO 2: Offline path (server unreachable)
      ├─ A. Intenta verifyPinOffline(pin, context)   ← PBKDF2, pos_manager_credentials_v2
      │   → si hit: retorna { name, role }  ← camino nuevo
      │
      └─ B. Si null: fallback legacy btoa cache
          lee pos_manager_pin_cache[btoa(pin)]
          → si hit dentro de 24h: retorna { name, role }
          └─ (legacy path — va desapareciendo sola a medida que los managers se autentican online)
```

### Storage keys después de la migración

| Key | Escribe | Lee | TTL | Algoritmo | Fase |
|---|---|---|---|---|---|
| `pos_staff_cache` | layout.tsx auth | layout.tsx auth | 8h | SHA-256(pin:staffId) | Activo (sin cambio) |
| `pos_meseros_cache` | fetchMeseros | fetchMeseros | indefinido | — | Fix de colisión |
| `pos_manager_credentials_v2` | provisionManagerCredential | verifyPinOffline | 24h | PBKDF2 | **Nuevo — canónico** |
| `pos_manager_pin_cache` | verifyManager* (write-through) | verifyManager* | 24h | btoa | Legacy fallback |
| `pos_pin_device_salt` | getDeviceSalt() | getDeviceSalt() | permanente | random 128-bit | Nuevo |

---

## 4. Plan de migración — zero downtime

### Principio: siempre escribe en ambos, lee PBKDF2 primero con fallback btoa

La migración es completamente transparente porque:
1. Cada auth online exitosa provisiona PBKDF2 **además** del btoa cache existente
2. Offline siempre intenta PBKDF2 primero, luego btoa como fallback
3. El btoa cache nunca se elimina en este PR — se queda como safety net

### Secuencia de adopción por terminal

```
Día 0 — Antes del deploy:
  pos_manager_credentials_v2: vacío
  pos_manager_pin_cache: con entries btoa existentes

Primera auth online post-deploy:
  → provision PBKDF2 para ese manager
  → ambos stores tienen el manager

Offline inmediatamente después:
  → PBKDF2 hit — ruta nueva funciona

Día N (sin auth online):
  → PBKDF2 TTL 24h expira → fallback a btoa (sigue funcionando)
  → Si btoa también expira → require online auth (comportamiento actual)
```

### Primer login sin internet (terminal nueva)

El PBKDF2 **requiere al menos un login online exitoso previo**. Sin él, `pos_manager_credentials_v2` está vacío y `verifyPinOffline` retorna null. Fallback al btoa cache (también vacío en terminal nueva).

**Consecuencia:** Terminal nueva sin internet = sin auth de manager. **Este es el mismo comportamiento actual.** No empeora nada.

**Por documentar:** La primera autenticación de cualquier manager en una terminal nueva siempre requiere conexión. Wansoft tiene el mismo constraint (verifica contra SQL Server local; si no hay red al SQL Server, no hay auth).

---

## 5. Manejo de escenarios críticos

### TTL de 24h
- `CREDENTIAL_TTL_MS` en pos-manager-auth.ts: actualmente 8h → **cambiar a 24h** antes de activar.
- Coincide con `PIN_CACHE_TTL_MS` en pos-data.ts (ya 24h).
- Rationale: turno completo incluyendo overnight (cerrar a medianoche, reabrir a las 8am sin internet).

### Staff deshabilitado / terminado
- Supabase: `active = false` → `/api/pos/pin` retorna 401.
- **Online**: retorna null, **no provisiona** (ni PBKDF2 ni btoa).
- **Offline**: si el manager fue deshabilitado mientras la terminal estaba offline:
  - PBKDF2: la credencial sigue válida hasta TTL (máx 24h). Mismo gap que Wansoft.
  - Mitigación disponible: `revokeManagerCredential(staffId)` puede llamarse si el server retorna 401 Y tenemos el staffId.
  - **Problema**: pos-data.ts actualmente no tiene el staffId cuando el server retorna 401 (el 401 no incluye qué staff falló). → No podemos revocar automáticamente.
  - **Decisión**: Aceptar el gap — es el mismo que el sistema actual y el mismo que Wansoft.

### Revocación explícita
- `revokeManagerCredential(staffId)` existe en pos-manager-auth.ts.
- Puede llamarse desde management console cuando el admin tiene internet.
- No implementar en este PR — registrar como mejora futura.

### Múltiples usuarios / managers
- `pos_manager_credentials_v2` es un array: `ManagerCredential[]`.
- Cada staff_id tiene su propia entry. Multiple managers funcionan en paralelo.
- `verifyPinOffline` itera todos y retorna el primero que hace match.

### Cambio de PIN
- Online: el próximo auth online con el PIN nuevo sobreescribe la entry del mismo `staff_id`.
  - `provisionManagerCredential` hace `filter(c => c.staff_id !== staffId)` antes de agregar.
- Offline: el PIN viejo sigue siendo válido hasta TTL. Mismo comportamiento que sistema actual.

### Terminal nueva
- `pos_pin_device_salt` no existe → `getDeviceSalt()` genera uno nuevo → PBKDF2 usa salt local.
- El hash es device-specific: no se puede reutilizar la credential de otra terminal (by design).
- Primera auth siempre online. Ver §5 "Primer login sin internet".

### Reinicio de app
- PBKDF2 credentials: sobreviven en localStorage. App restart no afecta.
- Session de staff (pos_staff_cache): sobrevive en localStorage.
- sessionStorage (pos_staff + pos_last_activity): se borra en reinicio de pestaña.
  → layout.tsx restore logic re-lee sessionStorage, no encuentra nada, muestra lockscreen.
  → El staff hace PIN → auth online si posible, fallback a pos_staff_cache si offline.

### Migración fallida / rollback
El rollback es automático: si verifyPinOffline retorna null (cualquier fallo), el código cae al btoa fallback que ya funciona hoy. No hay estado inconsistente posible.

---

## 6. Cambios de código necesarios

### Archivo 1: `pos-manager-auth.ts`
```diff
- const CREDENTIAL_TTL_MS = 8 * 60 * 60 * 1000  // 8 hours
+ const CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000  // 24h — full overnight shift
```

### Archivo 2: `pos-data.ts` — en las tres funciones verify*

**Patrón nuevo para el online path** (aplicar igual a las 3 funciones):
```typescript
if (res.ok) {
  const { staff } = await res.json()
  if (staff?.name) {
    const role = staff.role || 'gerente'
    // ① PBKDF2 provision (nuevo — canónico)
    if (staff.id) {
      import('@/lib/pos-manager-auth').then(m =>
        m.provisionManagerCredential(pin, staff.id, staff.name, role)
      ).catch(() => {})
    }
    // ② btoa cache (write-through para rollback — mantener)
    try {
      const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
      cached[_pinCacheKey(pin)] = { name: staff.name, role, cached_at: Date.now() }
      localStorage.setItem('pos_manager_pin_cache', JSON.stringify(cached))
    } catch {}
    return staff.name as string  // o { name, role } según la función
  }
}
```

**Patrón nuevo para el offline path**:
```typescript
// catch { /* offline → fallback */ }
// A. PBKDF2 (nuevo — canónico)
try {
  const { verifyPinOffline } = await import('@/lib/pos-manager-auth')
  const result = await verifyPinOffline(pin, context)
  if (result) return result.name  // o { name: result.name, role: result.role }
} catch {}
// B. Legacy btoa fallback (safety net — no eliminar en este PR)
try {
  const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
  const entry = cached[_pinCacheKey(pin)]
  if (entry?.name && Date.now() - (entry.cached_at || 0) < PIN_CACHE_TTL_MS) {
    return entry.name  // o { name, role }
  }
} catch {}
return null
```

### Archivo 3: `pos-data.ts` — fetchMeseros (fix KEY COLLISION)
```diff
- try { localStorage.setItem('pos_staff_cache', JSON.stringify(MESEROS)) } catch {}
+ try { localStorage.setItem('pos_meseros_cache', JSON.stringify(MESEROS)) } catch {}
```
```diff
- const cached = localStorage.getItem('pos_staff_cache')
+ const cached = localStorage.getItem('pos_meseros_cache')
```

---

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Manager sin auth online previa en terminal nueva va offline | Bajo (AMALAY tiene conexión estable) | Alto (no puede hacer cierre) | Btoa fallback mantiene el comportamiento actual — no empeora |
| deviceSalt se borra (user limpia localStorage) | Muy bajo | Alto (hash cambia, PBKDF2 inválido) | Btoa fallback activo; próximo online re-provisiona |
| Error en la importación dinámica de pos-manager-auth | Muy bajo | Medio | Try/catch alrededor, cae a btoa |
| Colisión de deviceSalt en dos terminales | Imposible | — | Salt es per-device por construcción |
| Regresión en flow A (staff login) | Ninguno | — | Flow A no se toca |
| **KEY COLLISION bug activo** | **Alto (sucede en uso normal)** | **Alto (offline auth del lockscreen falla)** | **Fix en mismo PR: rename a pos_meseros_cache** |

---

## 8. Tests propuestos

### Nuevos tests en `pos-manager-auth.test.ts` (módulo PBKDF2 ya tiene 13 tests)

Los siguientes 10 tests cubren el flujo integrado de pos-data.ts:

```typescript
// 1. Login con credencial PBKDF2 (happy path post-migración)
it('verifyManagerPin uses PBKDF2 offline after online provision', ...)

// 2. Login con credencial legacy btoa (primera vez offline, sin PBKDF2 provisioned)
it('verifyManagerPin falls back to btoa cache when no PBKDF2 credential exists', ...)

// 3. Migración legacy → PBKDF2 (online después de tener btoa)
it('online auth provisions PBKDF2 while keeping btoa write-through', ...)

// 4. PIN incorrecto — ambos caches no hacen match
it('verifyManagerPin returns null for wrong PIN with both caches populated', ...)

// 5. Credencial expirada (PBKDF2 TTL 24h)
it('PBKDF2 credential older than 24h is rejected', ...)

// 6. Usuario deshabilitado (disabled: true)
it('disabled PBKDF2 credential is rejected', ...)

// 7. Cache multiusuario — dos managers en mismo dispositivo
it('two managers can each verify with their own PIN', ...)

// 8. Reinicio de app — credentials sobreviven localStorage
it('PBKDF2 credentials survive localStorage persistence (simulate app restart)', ...)

// 9. Modo offline real — PBKDF2 funciona sin red
it('verifyPinOffline resolves without network access', ...)

// 10. Rollback/migración fallida — btoa cache como safety net
it('btoa fallback is used when PBKDF2 verification throws', ...)
```

### Tests adicionales para el KEY COLLISION fix

```typescript
// 11. fetchMeseros usa pos_meseros_cache, no pos_staff_cache
it('fetchMeseros reads/writes pos_meseros_cache, not pos_staff_cache', ...)

// 12. pos_staff_cache de auth no es sobreescrita por fetchMeseros
it('calling fetchMeseros does not corrupt pos_staff_cache auth entry', ...)
```

---

## 9. Implementación — orden

1. Fix `CREDENTIAL_TTL_MS` en pos-manager-auth.ts: 8h → 24h
2. Fix KEY COLLISION en pos-data.ts: `pos_staff_cache` → `pos_meseros_cache` (2 líneas)
3. Wire PBKDF2 en pos-data.ts: provision en online path + verifyPinOffline en offline path (3 funciones)
4. Tests (12 nuevos)
5. Verificar que los 13 tests existentes de pos-manager-auth.test.ts siguen pasando

**NO en este PR:**
- Eliminar btoa cache (safety net permanece)
- Revocar credentials en 401 automáticamente
- Tocar Flow A (staff login / layout.tsx)
- Activar api/pos/staff-cache endpoint

---

## 10. Aprobación requerida

Antes de implementar, confirmar:

1. **KEY COLLISION fix**: ¿Está aprobado renombrar `pos_staff_cache` → `pos_meseros_cache` en `fetchMeseros`? (2 líneas, sin impacto en auth, fix de bug activo)
2. **TTL 24h**: ¿Confirmado que PBKDF2 TTL debe ser 24h (no 8h)?
3. **Flow A sin cambios**: ¿Confirmado que Staff Login (layout.tsx) queda sin tocar?
4. **btoa permanece como safety net**: ¿Confirmado que no se elimina en este PR?
