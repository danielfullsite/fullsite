# SECURITY-HARDENING — Fullsite POS (defensa en capas)

> Versión: 0.1 — 2026-08-11 · Dueño: fundador (Daniel) · Estado: PLAN
> Petición del fundador: *"cuidar mucho la seguridad de todo, hazlo anti-hackeos."*

## Principio honesto (leer primero)

**Ningún sistema es "inhackeable".** Seguridad = **capas** que suben el costo del ataque y
**limitan el daño** cuando algo falla. Para un SaaS multi-tenant de restaurantes, el riesgo
#1 **no** es que copien el `.exe` — es que **un cliente vea los datos de otro**. Ese es el
candado que más importa. El código cliente (JS/Electron) **siempre** se puede revertir con
esfuerzo; el foso real es la **plataforma + datos en el servidor**, no el binario.

Prioridad: **aislar tenants > proteger secretos > minimizar superficie > blindar binario.**

---

## Capa 1 — Aislamiento multi-tenant (PRIORIDAD MÁXIMA para 1000 clientes)

| Control | Estado | Acción |
|---|---|---|
| **RLS por tenant en Supabase** (un cliente no lee/escribe datos de otro) | Diseñado (BUG-019, migración integral 93 tablas) | **Verificar que esté APLICADA en prod y probada** con 2 tenants |
| El bridge valida `restaurant_id` en cada comando | ✅ existe (`CommandHandler` rechaza IDs ajenos) | Mantener |
| Sin `service_role` key en el cliente | ✅ el bundle usa **anon** key (verificado) | Nunca hornear la service key en el `.exe` |
| Advisors de seguridad de Supabase (tablas sin RLS, views expuestas) | por correr | `get_advisors(security)` recurrente |

> **La regla de oro del multi-tenant:** cada query filtra por `client_id` Y hay RLS que lo
> fuerza a nivel DB. La app filtrando sola NO basta — si falla el filtro, RLS es la red.

## Capa 2 — Secretos y datos en reposo

- **Anon key** = pública por diseño (se sirve a todo browser). OK en el bundle.
- **Service key / tokens / passwords:** NUNCA en `config.json`, disco, ni bundle. Solo en
  secrets de CI / variables de entorno del servidor.
- **DB local** (`events.ndjson`, IndexedDB): evaluar **cifrado en reposo** (la tablet en el
  restaurante es físicamente accesible).
- **Huellas:** templates locales, **excluidos de los backups** (privacidad) — ya se hace.
- **PIN:** PBKDF2 10k iteraciones + device salt (ya implementado, OFFLINE-AUTH.md). No btoa.

## Capa 3 — Superficie del bridge (el LAN)

- El bridge escucha en `0.0.0.0:7717` (accesible por toda la LAN). Controles:
  - **Firewall a LocalSubnet** (el field kit ya lo pone) — no exponer a WAN jamás.
  - **Validar comandos** (restaurant_id + considerar un **token de LAN** compartido por sitio).
  - **CORS:** hoy `Access-Control-Allow-Origin: *` — aceptable para LAN, pero endurecer a la
    IP/origen del POS cuando sea posible.
  - **Sin endpoints destructivos** sin autenticar. Rate-limiting básico.
- **mDNS:** solo anuncia metadata pública (restaurant_id, versión) — no secretos. OK.

## Capa 4 — Autenticación y sesión

- PIN offline (PBKDF2) + **bloqueo tras N intentos** (V-04). Roles con permisos mínimos.
- Sesión: JWT autenticado (BUG-019 anon→authenticated para reads sensibles).
- Gerente/admin: PIN con rol mínimo verificado (`verifyPinWithMinRole`).

## Capa 5 — Blindaje del binario (protección de IP — Pedro)

> Honesto: esto **disuade y sube el costo**, no lo hace inviolable. El moat real es la
> plataforma, no el `.exe`.

- **Code signing (Authenticode):** firma el `.exe` → Windows confía + a prueba de manipulación.
- **asar + integrity:** empaquetar el código Electron en archivo con verificación de integridad.
- **Ofuscar el bundle JS** del POS (raise-the-bar contra copiar el algoritmo).
- **No incluir** código/datos que no necesita la terminal (el bundle offline ya es **solo
  `/pos`**, no toda la plataforma — menos superficie).

## Capa 6 — Updates (cadena de suministro)

- **OTA firmado:** `electron-updater` con firma → nadie puede empujar un update malicioso.
- Canales (`stable`/`pilot`) + **rollback**.

## Capa 7 — Nube / Supabase

- RLS (Capa 1) + auth + **sin writes anónimos** a tablas sensibles.
- Correr **security advisors** de Supabase periódicamente; atender ERROR/WARN.
- **Rotar** cualquier secreto expuesto (SEC-1: creds del scraper Rappi rotadas 2026-08-07).
- Revisar `pg_net`/edge functions expuestas.

## Capa 8 — Operación

- Higiene de red del sitio (firewall, sin puertos a WAN). En AMALAY la LAN estaba "un
  desmadre" — parte del onboarding es asegurarla.
- **Audit log** (events.ndjson append-only, `agent_runs`).
- **Auditoría periódica** (OWASP / skill `/cso`) antes de escalar a más clientes.

---

## Orden de ejecución recomendado

1. **Verificar RLS multi-tenant en prod** (BUG-019) — el candado #1. Sin esto, nada de lo
   demás importa para 1000 clientes.
2. Correr **security advisors** de Supabase y cerrar ERRORs.
3. **Code signing** del instalador + **OTA firmado**.
4. Token de LAN para el bridge + endurecer CORS/superficie.
5. Cifrado de DB local + ofuscación del bundle.
6. Auditoría OWASP antes de abrir clientes nuevos.

*No es "hacerlo anti-hackeo" de un jalón — es cerrar estas capas en orden y auditarlas seguido.*

---

## Auditoría real — Supabase Security Advisors (AMALAY, 2026-08-11)

Corrido con `get_advisors(security)`. Confirma que la **capa 1 (RLS) es el trabajo #1** —
liga directo con BUG-019 (migración RLS integral diseñada pero **no aplicada a prod**).

### 🔴 ERROR — arreglar antes de escalar a más clientes

**A. Tablas PÚBLICAS con RLS DESACTIVADA (cualquiera con la anon key puede leerlas):**
`pos_reconciliation_results`, `pos_item_inventory_policy`, `pos_recipe_lines`,
`pos_recipe_versions`, `pos_mutation_authority`, `pos_menu_item_recipes`.
→ Activar RLS + política por `client_id`. **Estas exponen recetas/inventario/autoridad de
mutación.** Es exactamente el gap que BUG-019 Phase 2 cierra.

**B. Views con `SECURITY DEFINER` (corren con permisos del creador, saltan RLS):**
`reviews_pending`, `reservaciones_activas`, `reservaciones_hoy`, `ops_daily_history`,
`ops_daily_live`, `pos_recipes_canonical`.
→ Revisar; cambiar a `SECURITY INVOKER` salvo que haya razón explícita.

### 🟠 WARN — cerrar pronto

- **`is_platform_admin` ejecutable por `anon`** (RPC sin login). Una función de chequeo de
  admin **NO** debería ser llamable por anónimos → `REVOKE EXECUTE` a anon.
- `r1_save_order` y `r1_observation_sample` ejecutables por anon (revisar si es intencional
  para el POS; si sí, documentar y acotar).
- ~9 funciones con `search_path` mutable (endurecimiento anti-inyección) → fijar `search_path`.
- Extensión `dblink` en schema `public` → mover a otro schema.
- **Protección de contraseñas filtradas (HaveIBeenPwned) DESACTIVADA** en Auth → activar.

### ℹ️ INFO — RLS activada sin política (~28 tablas)

`credentials_vault`, `agent_*`, `delivery_*`, `whatsapp_*`, varias `pos_*`, etc. RLS+sin-política
= **deny por defecto** (seguro, pero revisar que no rompa features legítimas o que necesiten
política explícita por `client_id`). `credentials_vault` bloqueada = bien.

### Veredicto de la auditoría

> El candado #1 (aislar tenants) **tiene huecos reales en prod**: 6 tablas sin RLS + views
> SECURITY DEFINER + `is_platform_admin` abierto a anon. **Es el trabajo de BUG-019 que falta
> aplicar a producción.** Todo esto es **DDL de prod** → requiere autorización explícita del
> fundador + migración Wansoft-safe (no romper la operación). Recomendación: aplicar la
> migración RLS de BUG-019 a prod ANTES de abrir clientes nuevos.
