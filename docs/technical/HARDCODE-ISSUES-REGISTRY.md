# Hardcode Issues Registry

**Fecha:** 2026-07-28
**Rama de referencia:** `sandbox/second-customer-skeleton`
**Propósito:** Clasificación formal de hardcodes que impiden desplegar Fullsite para un nuevo cliente sin cambios de código.

Severidad:
- **P0** — Bloqueante para producción. Causa corrupción de datos o error fatal para otro cliente.
- **P1** — Bloqueante para demo. Funcionalidad clave rota o dato incorrecto visible al cliente.
- **P2** — Degradado silencioso. Feature no funciona pero la app no falla.
- **P3** — Cosmético o interno. No visible al usuario final o impacto mínimo.

---

## P0 — Bloquea producción

Ninguno identificado actualmente. El sistema `client_users` es la fuente de verdad y aísla correctamente los datos por tenant.

---

## P1 — Bloquea demo

### HC-01 — Tarjetas de regalo: default client_id hardcodeado

| Campo | Valor |
|---|---|
| Archivo | `src/app/admin/tarjetas-regalo/page.tsx` |
| Línea | 23 |
| Código | `const empty = { ..., client_id: 'amalay' }` |
| Impacto | Si se crea una tarjeta regalo desde la UI de un cliente nuevo sin modificar el estado inicial, la tarjeta se registra con `client_id='amalay'`. Bug de datos silencioso. |
| Fix propuesto | Reemplazar con `client_id: clientId` donde `clientId` viene de `useClientId()` hook. |
| Effort | 15 min |

### HC-02 — Vault Admin: dropdown solo muestra AMALAY

| Campo | Valor |
|---|---|
| Archivos | `src/app/admin/vault/page.tsx:181`, `src/app/internal/vault/page.tsx:170` |
| Código | `<option value="amalay">AMALAY</option>` (hardcoded) |
| Impacto | Un admin que intente ver el vault de VANTARA no encontrará su cliente en el dropdown. Feature invisible para clientes nuevos. |
| Fix propuesto | Reemplazar con `SELECT id, display_name FROM clients ORDER BY display_name`. |
| Effort | 30 min |

### HC-03 — Chat logs: condición de display invertida

| Campo | Valor |
|---|---|
| Archivo | `src/app/admin/chat-logs/page.tsx` |
| Línea | 159 |
| Código | `log.client_id !== 'amalay'` (filtra AMALAY para mostrar "otros") |
| Impacto | La lógica de display no escala a múltiples clientes — cualquier cliente nuevo verá logs de todos excepto AMALAY, o ninguno, según la intención real del filtro. |
| Fix propuesto | Filtrar por `log.client_id === currentClientId()` o eliminar el filtro si el admin debe ver todos. |
| Effort | 20 min |

---

## P2 — Degradación silenciosa (AI/Analytics)

### HC-04 — AI Chat: no funciona para clientes sin wansoft_daily

| Campo | Valor |
|---|---|
| Archivo | `src/app/api/chat/route.ts` (y dependencias) |
| Impacto | El chat IA construye contexto leyendo `wansoft_daily`. Para un cliente con `data_source='fullsite'`, esta tabla está vacía y el chat responde con datos vacíos o de otro tenant. |
| Estado | Fallback a `pos_orders` existe en algunas rutas pero no está universalmente aplicado. |
| Fix propuesto | Aplicar el Modelo Canónico Operacional (ver `OPERATIONAL-CANONICAL-MODEL-v0.md`) como capa de abstracción. No intentar copiar datos a `wansoft_daily`. |
| Effort | 3–5 días (requiere OCM primero) |
| Bloqueante para demo | No — la app no falla, solo el chat no sabe del restaurante nuevo. |

### HC-05 — AI Coach: solo lee wansoft_daily

| Campo | Valor |
|---|---|
| Archivo | `src/app/api/coach/route.ts` |
| Impacto | Coach no funciona para clientes con `data_source='fullsite'`. |
| Fix propuesto | Mismo que HC-04. |
| Effort | Incluido en OCM |

### HC-06 — Inventory Predictor: volúmenes desde wansoft_daily

| Campo | Valor |
|---|---|
| Archivo | `src/app/api/inventory/predict/route.ts` |
| Impacto | Sin historial de ventas en wansoft_daily, las predicciones son cero o inválidas. |
| Fix propuesto | Mismo que HC-04. |
| Effort | Incluido en OCM |

### HC-07 — Agents/GitHub Actions: solo AMALAY

| Campo | Valor |
|---|---|
| Archivos | `.github/workflows/*.yml`, `.github/scripts/*.py` |
| Impacto | Todos los workflows (daily briefing, orquestador, wansoft scraper) están configurados exclusivamente para AMALAY Supabase. No generan value para otros clientes. |
| Fix propuesto | Parametrizar con `CLIENT_ID` y `SUPABASE_URL` por cliente. Trabajo de configuración, no de código. |
| Effort | 2 días (multi-tenant agents) |
| Bloqueante para demo | No — los agentes son un feature adicional, no el core. |

---

## P3 — Cosmético / interno

### HC-08 — SSR fallback a 'amalay' en pos-config.ts

| Campo | Valor |
|---|---|
| Archivo | `src/lib/pos-config.ts` |
| Línea | 28 |
| Código | `typeof window === 'undefined' ? 'amalay' : clientId` |
| Impacto | Durante el render server-side (SSR), antes de que `client_users` resuelva el client_id, la config carga datos de AMALAY por ~100ms. Causa flicker visual en la carga inicial del POS. **No causa datos incorrectos** — la hidratación corrige inmediatamente. |
| Fix propuesto | Usar el `client_id` del contexto de sesión en el servidor, o eliminar el fallback a 'amalay' y retornar null/loading. |
| Effort | 1 hora |

### HC-09 — Floor plan personalizado solo para AMALAY

| Campo | Valor |
|---|---|
| Archivo | `src/lib/pos-data.ts` |
| Línea | 1258 |
| Código | `if (clientId === 'amalay') return MESAS_CONFIG` |
| Impacto | AMALAY tiene un plano físico personalizado (mesas con posición en sala). Cualquier otro cliente cae al path de grilla numérica genérica. Funcional pero sin el plano físico. |
| Fix propuesto | Mover `MESAS_CONFIG` a una tabla `pos_floor_plans` en Supabase por client_id. Feature futura — no urgente. |
| Effort | 2 días (feature completa) |

### HC-10 — Health check lee wansoft_daily

| Campo | Valor |
|---|---|
| Archivo | `src/app/api/health/route.ts` |
| Línea | 16, 32 |
| Impacto | Para clientes con `data_source='fullsite'` y `wansoft_daily` vacío, el endpoint `/api/health` reporta error aunque la app funcione correctamente. Falso negativo en monitoreo. |
| Fix propuesto | El health check debe verificar si el cliente usa wansoft antes de leer esa tabla. |
| Effort | 30 min |

### HC-11 — Email map legacy en client-config.ts

| Campo | Valor |
|---|---|
| Archivo | `src/lib/client-config.ts` |
| Línea | 183 |
| Código | `'ramonfaur.daniel@gmail.com': 'amalay'` |
| Impacto | Fallback legacy que mapea email → client_id. **No bloquea** porque `client_users` tiene prioridad. Solo relevante si se elimina `client_users`. |
| Fix propuesto | Eliminar el mapa cuando se confirme que `client_users` es la única fuente de verdad. |
| Effort | 15 min |

---

## Resumen ejecutivo

| Prioridad | Issues | Acción |
|---|---|---|
| P0 | — | Ninguno identificado |
| P1 | HC-01, HC-02, HC-03 | Fix antes del primer demo con cliente externo |
| P2 | HC-04, HC-05, HC-06, HC-07 | Fix después de OCM — no bloquea demo básico |
| P3 | HC-08, HC-09, HC-10, HC-11 | Fix en el sprint siguiente a demo |

**Costo total para demo-ready (P1):** ~65 min de código + QA.
**Costo para producción con AI (P2):** requiere OCM — 3–5 días de sprint dedicado.

---

*Actualizar este archivo al cerrar cada issue. Usar `HC-XX (CLOSED YYYY-MM-DD)` en el título.*
