# Autorización Offline — Arquitectura PBKDF2

> **Status:** IMPLEMENTADO — 2026-07-31  
> **Módulo:** `src/lib/pos-manager-auth.ts`  
> **Origen:** CAJ-GAP-02 (OCS P2.5.4 Caja)  
> **Principio base:** Wansoft-First Offline — no podemos quedar por debajo del benchmark de Wansoft

---

## Contexto

Wansoft verifica PINs de gerente contra un SQL Server local — sin necesidad de WAN. Fullsite debe igualar o superar esa confiabilidad. La implementación anterior usaba `btoa(pin)` como clave de localStorage, lo que equivale a almacenar el PIN en texto claro (base64 es reversible sin clave).

---

## Modelo de amenaza

**Riesgo principal:** Un empleado no-gerente con acceso físico a la tablet lee localStorage y extrae el PIN del gerente.

**Mitigación:** PBKDF2 con 10 000 iteraciones hace que la reversión bruta de un PIN de 4–8 dígitos requiera >10 minutos en la propia tablet. No es protección criptográfica fuerte — es protección operativa suficiente para el contexto POS.

**Fuera de alcance:** Ataques con acceso root al dispositivo, keyloggers de hardware, ingeniería social. Esos están cubiertos por políticas operativas, no por software.

---

## Diseño

### Device Salt

```typescript
// pos_pin_device_salt en localStorage
// 128 bits aleatorios, generado UNA VEZ por instalación
const bytes = crypto.getRandomValues(new Uint8Array(16))
salt = btoa(String.fromCharCode(...bytes))
```

El salt es por dispositivo. Un hash del dispositivo A no puede usarse en el dispositivo B aunque el atacante extraiga `pos_manager_credentials_v2`.

### Hash de PIN

```typescript
// PBKDF2(pin, deviceSalt, 10_000 iterations, SHA-256, 256 bits)
const hash = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 10_000 },
  keyMaterial, 256,
)
```

~5–20 ms por hash en tablet. Para 5 gerentes: 25–100 ms total. Aceptable.

### Credential Shape

```typescript
interface ManagerCredential {
  staff_id: string    // deduplication key
  name:     string
  role:     string
  pin_hash: string    // base64 PBKDF2 result — NOT the PIN
  synced_at: number   // Date.now() when provisioned — TTL baseline
  disabled: boolean   // revocation flag
}
```

Almacenadas como array en `pos_manager_credentials_v2` (localStorage).

### TTL

8 horas (un turno). Si la terminal lleva offline >8h desde la última auth online, el gerente debe autenticarse online. Esto también limita la exposición si un dispositivo es robado.

### Provisioning

Cada autenticación online exitosa llama `provisionManagerCredential()` en background (non-blocking). El hash local siempre refleja el PIN más reciente usado online. Un cambio de PIN en el servidor se propaga al próximo auth online del gerente.

### Revocación

`revokeManagerCredential(staffId)` marca `disabled: true`. Honrado inmediatamente al siguiente intento de auth. Limitación conocida: si el gerente es revocado mientras la terminal está offline, la credencial sigue válida hasta que reconnect o expire el TTL (max 8h). Este comportamiento iguala a Wansoft.

### Audit Log

Cada intento de auth offline se registra en `pos_offline_auth_log` (localStorage):

```typescript
interface OfflineAuthLogEntry {
  ts:       number   // Date.now()
  staff_id: string
  action:   'auth_success' | 'auth_failed' | 'auth_expired' | 'auth_disabled'
  context?: string   // e.g. 'cierre_caja', 'retiro'
  synced?:  boolean
}
```

`getPendingOfflineAuthLog()` + `markOfflineAuthLogSynced()` se usan al reconectar para flush a Supabase.

---

## API pública

```typescript
// Provisioning (llamar después de auth online exitosa)
provisionManagerCredential(pin, staffId, name, role): Promise<void>

// Verificación offline
verifyPinOffline(pin, context?): Promise<OfflineAuthResult | null>

// Administración
revokeManagerCredential(staffId): void
pruneStaleCredentials(): void   // llamar en startup cuando online
listCachedManagers(): Array<{staff_id, name, role, expires_at, active}>

// Audit log
getPendingOfflineAuthLog(): OfflineAuthLogEntry[]
markOfflineAuthLogSynced(): void
```

---

## Integración con pos-data.ts

`verifyManagerPin` y `verifyManagerPinWithRole` siguen el mismo patrón:

```
Online path  → fetch /api/pos/pin → si ok, provisionManagerCredential() [background]
Offline path → verifyPinOffline()
```

Los consumidores (CierreCajaWizard, movimientos de caja, descuentos, reapertura de órdenes) no necesitan saber en qué modo están — la interfaz es la misma.

---

## Extender a otros módulos

Este mismo patrón aplica a cualquier acción que requiera autorización de gerente offline:

1. El servidor siempre es la fuente de verdad para roles y permisos
2. Las credenciales se provisionen en cada auth online exitosa
3. El TTL de 8h limita la exposición
4. El audit log garantiza trazabilidad post-hecho

Para módulos futuros: no reimplementar — usar `verifyPinOffline()` directamente.

---

## Relaciones

- `docs/certifications/OCS-P2.5.4-CAJA.md` — certification que originó este módulo
- `docs/adr/ADR-004-CANONICAL-MODULE.md` — patrón arquitectónico relacionado
- `docs/architecture/OFFLINE-MASTER.md` — arquitectura offline global
- `docs/offline/WANSOFT-BENCHMARK.md` — benchmark de confiabilidad Wansoft
