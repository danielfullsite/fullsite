# Auditoría de fugas multi-tenant — 2026-08-30 (P0)

> Disparador: en campo, el Equipo de `tekila-rg` mostró los 40 meseros REALES de AMALAY
> (Daniel, sesión admin multi-membresía). Barrido exhaustivo de las 105 rutas /api + páginas
> de dashboard + localStorage + realtime. Fixes en la rama `fix/fugas-multitenant-p0`.

## Causa raíz (una sola, replicada en varios lados)

`withPOSAuth` (y copias locales del patrón) resolvían el tenant con
`client_users?...&limit=1` **sin `order`**. Para un usuario con varias membresías
(Daniel: 8; mañana cualquier dueño multi-marca) Postgres devuelve una fila **arbitraria**
(en la práctica `amalay`). El RLS es la red de seguridad para un cliente de UNA membresía
—y por eso los clientes normales nunca estuvieron expuestos— pero un multi-membresía tiene
RLS abierto a TODOS sus tenants, así que la fila arbitraria mandaba lecturas (y en algunos
casos escrituras) al restaurante equivocado.

**Contrato nuevo (PR #236, ya en main):** el navegador declara el tenant activo con el
header `x-fullsite-tenant`, validado contra membresía server-side; sin header y
multi-membresía → 401 (jamás adivinar). Este PR extiende ese contrato y cierra los clones.

## FUGA-REAL cerradas

| # | Dónde | Qué se fugaba | Fix |
|---|---|---|---|
| **F-1** | `api/factura/timbrar` | `client_users limit=1` sin order + service key → **timbraba CFDI (irreversible ante el SAT) contra otro restaurante** | `withPOSAuth` fail-closed |
| **F-2** | `api/chat` | `client_id` del body sin validar membresía → ventas/órdenes/recetas/costos/staff de cualquier tenant | `requireTenant(req, body)` |
| **F-2b** | `api/chat:158` | `wansoft_food_cost` con service key sin filtro | `&client_id=eq.` |
| **F-5** | `api/factura/descarga` | servía PDF/XML de **cualquier** CFDI por `fid` | valida `fid` contra `pos_cfdi_requests` del tenant |
| **F-6** | `admin/exportar` | 2 reintentos que QUITABAN el filtro → CSV mezclado | reintentos eliminados |
| **F-7** | `api-auth` + `AuthContext` | `pos_shift_token` nunca se borraba → evadía el fix (se valida antes que la sesión) | purga al cambiar de tenant + rechazo si el header no coincide con el token |

## RIESGO cerrados en este PR
- **R-4** `usePosRealtime`: canales `pos-orders-live`/`pos-presence` con nombre GLOBAL → tenants se veían dispositivos. Namespaciados por `clientId`.
- **R-5** `admin|internal/chat-logs` y `admin|internal/vault`: queries sin `client_id` → conversaciones y credenciales de todos los tenants del usuario. Filtro agregado.

## Contenidos por su gate (NO fuga activa, anotados)
- **F-3** `api/backup`: dump multi-tenant POR DISEÑO (herramienta del operador), gate = allowlist `BACKUP_ADMIN_EMAILS`. Riesgo de gobernanza (no meter correos de cliente), no leak activo.
- **F-4** `api/coach` `wansoft_waiter_categories`: sin columna `client_id`, pero gateado por `esDuenoDelHistoricoWansoft` (solo amalay lo posee). Contenido.
- Igual el `wansoft_waiter_categories` del chat.

## Pendientes (RIESGO menor, siguiente PR)
- R-1 `api/pos/kitchen`: token opt-in; hacer `KITCHEN_TOKEN_SECRET` obligatorio en prod.
- R-2 `pos-db-policy NO_CID`: `pos_purchase_order_items` / `pos_sub_recipe_ingredients` sin scope por id de padre.
- R-3 `api/pos/db` RPC sin allowlist.
- R-6 `uber-eats/auth/initiate`: `client_id` de query sin auth (OAuth state).
- R-8 clave `pos_plano_amalay` con tenant hardcodeado — confirmar purga.

## Daño verificado
CERO escrituras cruzadas: `pos_staff_audit` y `pos_time_clock` de amalay = 0 filas en 12h.
Fue lectura, solo en sesiones multi-membresía (Daniel). Ningún cliente de una sola
membresía estuvo expuesto.
