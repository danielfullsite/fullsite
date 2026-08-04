# Runtime Gap Register

**Regla fundamental:** Solo Runtime Verification puede crear una entrada aquí.
La auditoría genera hipótesis → va a AUDIT-FINDINGS.md → se verifica → si es real, entra aquí.

**Status:** ![gaps open](https://img.shields.io/badge/gaps%20abiertos-0-brightgreen)

---

## Formato de entrada

```
### GAP-NNN — Título corto
- **Status:** OPEN | CLOSED
- **Prioridad:** P0 | P1 | P2
- **Componente:** archivo:línea
- **Descripción:** qué falla, bajo qué condición, cuál es el impacto en runtime
- **Evidencia:** código o log que confirma el gap
- **Fix:** PR / commit (cuando esté cerrado)
- **Verificado por:** Runtime Verification — YYYY-MM-DD
```

---

## OPEN

*(ninguno — registro limpio al 2026-08-03)*

---

## CLOSED

### GAP-001 — PIN cache TTL 8 h (debería ser 24 h)
- **Status:** CLOSED
- **Prioridad:** P1
- **Componente:** `dashboard-app/src/lib/pos-data.ts:1712, 1748, 1791`
- **Descripción:** El fallback offline de `verifyManagerPin`, `verifyManagerPinWithRole` y `verifyPinWithMinRole` rechazaba PINs cacheados con más de 8 h de antigüedad. Un turno de trabajo puede durar hasta 18 h; si el primer uso fue al inicio del turno y la red cae, el gerente no puede autorizar operaciones.
- **Evidencia:** `const CREDENTIAL_TTL_MS = 8 * 60 * 60 * 1000` — tres ocurrencias idénticas con comentario erróneo `// 15 min TTL`.
- **Fix:** Commit `PIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000` constante nombrada, tres sitios actualizados.
- **Verificado por:** Runtime Verification — 2026-08-03

### GAP-002 — command_id no es UUID v4
- **Status:** CLOSED
- **Prioridad:** P1
- **Componente:** `dashboard-app/src/lib/pos-offline-db.ts:190`, `bridge-client.ts:160`
- **Descripción:** Los IDs de comandos usaban `${Date.now()}-${Math.random()}`. Con múltiples terminales en el mismo milisegundo, la probabilidad de colisión no es despreciable. El Event Store usa `command_id` como clave de idempotencia; una colisión descarta un evento legítimo como duplicado.
- **Evidencia:** `const id = \`${Date.now()}-${Math.random().toString(36).slice(2, 8)}\`` en pos-offline-db.ts y patrón idéntico en bridge-client.ts.
- **Fix:** `crypto.randomUUID()` en ambos archivos. Tests existentes pasan (`.toBeTruthy()`, sin aserción de formato).
- **Verificado por:** Runtime Verification — 2026-08-03

### GAP-003 — STATE_SYNC descarta locks activos al limpiar _mesas
- **Status:** CLOSED
- **Prioridad:** P1
- **Componente:** `electron-app/local-server/core/state.js:208`
- **Descripción:** `_applyStateSync` llamaba `this._mesas.clear()` antes de reconstruir desde Supabase, pero no tocaba `_locks`. Resultado: `getMesa(n).locked_by` devolvía `null` (mesa parecía desbloqueada) mientras `getLock(n)` seguía devolviendo el lock, hasta que `gcLocks()` lo purgara 30 s después. Ventana de inconsistencia: hasta 30 s en cada ciclo de poll de 5 s.
- **Evidencia:** `_applyStateSync` asignaba `locked_by: null` a todas las mesas sin consultar `_locks`.
- **Fix:** Carry-over de locks activos (`expires_ms > Date.now()`) antes de limpiar `_mesas`. Locks de mesas desaparecidas del snapshot de Supabase se eliminan. Dos tests nuevos en `state.test.js` (16/16 pass).
- **Verificado por:** Runtime Verification — 2026-08-03

### GAP-A — `verifyPinWithMinRole`: jerarquía de roles no aplicada en offline path
- **Status:** CLOSED
- **Prioridad:** P1
- **Componente:** `dashboard-app/src/lib/pos-data.ts:1797-1811`
- **Descripción:** El path offline de `verifyPinWithMinRole` autenticaba el PIN correctamente (PBKDF2 / btoa) pero no comparaba el rol almacenado contra `minRole`. `verifyPinOffline` usa el parámetro `context` solo para audit log — no filtra por rol. El call site (`if (pbkdf2) return pbkdf2`) retornaba el credential sin verificar la jerarquía. Adicionalmente, `legacy.role || minRole` concedía `minRole` como rol cuando el btoa entry no tenía rol. Cualquier credential offline pasaba `verifyPinWithMinRole(pin, 'gerente')` independientemente del rol real.
- **Evidencia:** `pos-manager-auth.ts:160-188` — `context` solo pasa a `logOfflineAuth`. `pos-data.ts:1798`: `if (pbkdf2) return pbkdf2` sin check. `pos-data.ts:1801`: `role || minRole` — escalación de privilegio.
- **Operación afectada:** `handleTransferItem` (`pos/page.tsx:2533`) — única call site, `minRole: 'capitan'`.
- **Fix:** `meetsMinRole(pbkdf2.role, minRole)` en PBKDF2 path; `meetsMinRole(legacy.role, minRole)` en btoa path; `return { name, role: legacy.role }` (sin coalescencia con minRole). Fuente canónica reutilizada: `ROLE_HIERARCHY` + `meetsMinRole` exportados desde `pos-manager-auth.ts:66-84`. 54 tests PASS.
- **Verificado por:** Runtime Verification — 2026-08-04
