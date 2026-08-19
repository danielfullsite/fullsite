# DISEÑO — Huellas (DigitalPersona/HID) + PIN de 10 dígitos + separación de usuarios

> P0-A del `PIPELINE-MASTER.md`. Objetivo: la **huella es el acceso diario del POS**; el **PIN
> de 10 dígitos, generado aleatorio por el sistema**, es respaldo — para que **nunca se pasen el PIN**.
> POS users se crean en el POS; dashboard users en el dashboard. Offline-capable. 2026-08-18.

## 1. Estado actual (mapeado del código real)

**Buena noticia: la huella YA está cableada como stub — no partimos de cero.**
- `pos_staff` (010_consolidated_core.sql:1065): `id, client_id, name, pin (TEXT, PLAINTEXT), role, active, role_display`. `UNIQUE(pin, client_id)`. PIN hoy = **4–8 díg** (`/^\d{4,8}$/` en `api/pos/pin/route.ts:105`).
- `/api/pos/pin` valida el PIN y emite un **shift token** (JWT HMAC, 8h). Ya tiene **3 caminos**: fingerprint (`fingerprint_id` → busca staff por id), rol-mínimo, y estándar. El PIN es un intercambio único por el token; el token es el bearer.
- **Servicio de huella esperado en `127.0.0.1:7718`** (`lib/fingerprint-url.ts`): `pos/layout.tsx` ya hace `GET /health`, `GET /enroll?id=<staffId>` (4 capturas), `GET /identify` (match). El mapeo se guarda hoy en `localStorage.pos_fingerprint_staff`. Electron proxya `/fp/*` → 7718. **Ese servicio 7718 NO está en el repo** (era externo — el que "antes estaba conectado" en HID/Wansoft).
- Login huella hoy: 7718 `/identify` → `staffId` → `POST /api/pos/pin { fingerprint_id }` → token. **Ya funciona el contrato**, falta el servicio real.
- Offline: `pos_staff_cache` (localStorage, `pin_hash` SHA-256, 8h). `pos_staff` server = PLAINTEXT.
- Dashboard: Supabase Auth (correo/contraseña) + `client_users` + `app_metadata.platform_admin` / `user_metadata.client_id`. **Separado del POS por diseño.**
- **No hay UI de alta de staff** — hoy los `pos_staff` se crean por SQL.

## 2. Arquitectura de la huella (decisión)

El POS ya llama a un servicio local **7718** con `/health`, `/enroll?id=`, `/identify`. Dos caminos para proveerlo:

| Opción | Cómo | Match 1:N offline | Veredicto |
|---|---|---|---|
| **A · Servicio 7718 (nativo)** | Wrapper de DigitalPersona (native SDK / U.are.U) que corre local y expone el contrato que el POS YA usa | ✅ local, "pon el dedo → sabe quién eres" | **RECOMENDADO** — el POS ya está cableado; mantiene el contrato |
| B · Browser SDK | `@digitalpersona/devices` (WebSocket al DP Agent) dentro del POS | ⚠️ 1:1 fácil; 1:N offline complejo (necesita matcher) | Alterna si el nativo no está disponible |

**Recomendación: Opción A** — mantener el contrato 7718 (ya cableado) y que el servicio 7718 sea el wrapper de DigitalPersona que hace **captura + match 1:N local**. Es la parte de hardware (Fase 2). Daniel confirmó el lector = **DigitalPersona/HID (7718)**.

**Contrato del servicio 7718 (lo que el POS ya espera — congelarlo):**
```
GET /health            → { ok:true, reader:true|false }
GET /enroll?id=<staffId>  → captura 4x → guarda template ligado a staffId → { ok, staffId, template? }
GET /identify          → captura 1x, match 1:N → { ok:true, staffId } | { ok:false }
```
**Mejora clave:** hoy el enroll solo guarda mapeo en `localStorage`. Debe **persistir el template en el SERVER** (tabla `pos_staff_biometrics`, cifrado) para multi-terminal + respaldo; el servicio 7718 sincroniza al reconectar.

## 3. Modelo de datos

- **`pos_staff.pin`** → permitir **10 díg** (validación 4–10). Los nuevos = 10 díg generados por el sistema.
- **Nueva tabla `pos_staff_biometrics`:**
  ```sql
  id TEXT PK, client_id TEXT, staff_id TEXT → pos_staff(id),
  template TEXT (cifrado, NUNCA plano ni expuesto al cliente),
  finger_index INT, terminal_id TEXT, enrolled_at TIMESTAMPTZ
  UNIQUE(client_id, staff_id, finger_index)
  ```
  RLS: solo service_role (nunca lectura desde el cliente). Scoped `client_id`.
- **(Fase 3)** hashear `pos_staff.pin` server-side (hoy plaintext).

## 4. Flujos

- **Enrolar (en el POS, gerente/admin):** crear staff → **generar PIN 10 díg** (`lib/pos-pin.ts`) → "enrolar huella" → 7718 `/enroll?id` → template al server (cifrado) + caché local.
- **Login por huella (diario):** 7718 `/identify` → `staffId` → `/api/pos/pin { fingerprint_id }` → shift token. *(ya cableado)*
- **Login por PIN (respaldo):** 10 díg → `/api/pos/pin`. *(solo widen la validación)*
- **Offline:** templates + `pos_staff` en caché local; 7718 hace `/identify` local; el shift-token offline ya existe (`pos_staff_cache`). Todo local → funciona sin internet.

## 5. Separación de usuarios (lo que pidió Daniel)

- **Usuarios POS:** `pos_staff` — creados **en el POS** (nueva UI admin), huella + **PIN 10 díg del sistema** (aleatorio, nadie lo elige). Nunca en el dashboard.
- **Usuarios dashboard:** `client_users` + `auth.users` (correo/contraseña) — creados **en el dashboard** (ya existe el onboard). Nunca PIN de POS.
- Un dueño/gerente puede tener **ambos**, pero son registros separados (uno para operar el POS, otro para ver el dashboard).

## 6. Seguridad

- **Template biométrico cifrado at-rest**, nunca expuesto al cliente ni logueado. Consentimiento del empleado (dato sensible).
- **PIN:** aleatorio 10 díg (nadie lo memoriza → no se comparte). **(Fase 3)** hasheado server-side.
- Rate-limit ya existe (`pin-throttle`, `clientId:ip`) — aplica igual.

## 7. Plan por fases

- **FASE 1 — código ahora (sin hardware): ✅ COMPLETA**
  - ✅ Generador PIN 10 díg → `dashboard-app/src/lib/pos-pin.ts` (criptográfico, con exclusión de duplicados).
  - ✅ Migración `013_pos_biometrics_pin10.sql` (tabla `pos_staff_biometrics` + widen `pos_staff.pin` a 10 díg). *Aplicar en prod = Daniel.*
  - ✅ **API `/api/pos/staff`** (crear/listar/editar/desactivar, admin-gated con shift token gerente+, PIN generado, client_id del token).
  - ✅ **UI `pos/staff`** rewireada a la API segura: crea con PIN generado (mostrado 1 vez + copiar + enrolar huella), toggle regenerar. *(Bonus: estaba ROTA en el POS — escribía con anon key que RLS bloquea.)*
  - ✅ Widen validación a 10 díg (`api/pos/pin` regex + keypad del POS).
- **FASE 2 — con el lector (hardware):** el **servicio 7718** (wrapper DigitalPersona) — captura + match 1:N + persistir template cifrado al server. Probar enroll + login físico.
- **FASE 3 — endurecer:** hashear PIN server-side; cifrado del template; incluir en la auditoría de seguridad (P0-E).

## 8. Cambios exactos listos para aplicar (con deploy + prueba)
1. `dashboard-app/src/app/api/pos/pin/route.ts:105` → `const PIN_RE = /^\d{4,10}$/`.
2. `dashboard-app/src/app/pos/layout.tsx` → `maxLength` del input de PIN de 8 → 10.
3. Migración SQL: `scripts/sql/migrations/030_pos_biometrics.sql` (abajo).
4. Usar `generatePin10()` en la nueva alta de staff.

> Nada de esto toca el login vivo hasta que se despliegue y pruebe. La Fase 1 es aditiva; el
> match real de huella (Fase 2) requiere el lector físico + el servicio 7718.
