# Foundation Skeleton Audit — v1

> **Pregunta central:** ¿Qué sigue siendo frágil, manual, o dependiente de conocimiento humano?  
> Fecha: 2026-07-29 · Scope: sandbox milestone + arquitectura multi-tenant

---

## 1. ¿Qué sigue dependiendo de conocimiento humano?

| Proceso | Conocimiento implícito | Dónde está documentado |
|---|---|---|
| Orden correcto de migraciones SQL | `000 → 010 → 003 → 004 → 008 → SKEL-04` — ningún script lo enforza | `DEPLOY_SANDBOX.md` — solo como lista |
| Cuándo un CNAME está propagado | "esperar 1–5 min" | `RUNBOOK.md` — instrucción informal |
| Diferencia entre anon key y service key | Qué permisos tiene cada uno, cuál va donde | `ARCHITECTURE.md` — explicado pero no enforced |
| Pin de staff deben ser únicos por cliente | UNIQUE(pin, client_id) — si falla, error críptico de Postgres | `PROVISIONING.md` — nota al pie |
| PRUEBA-3 es un cliente de prueba, no de demo | Nada en la DB lo distingue de VANTARA | Solo en este documento |
| Las políticas {public} rompen RLS | Bug encontrado en SKEL-04 — no hay gate automático | `KNOWN_GOTCHAS.md G-002` + `DECISIONS.md ADR-004` |
| Cuál es el ref de producción prohibido | `qjiomlvudfmzuvqvhwpk` guardado en FORBIDDEN_CLIENT_IDS | `onboard_client.py` hardcode |

**Riesgo:** todo este conocimiento desaparece si el que hace onboarding no leyó la documentación primero.

---

## 2. ¿Qué scripts faltan?

| Script faltante | Qué haría | Impacto si no existe |
|---|---|---|
| `provision_client.sh` | Un solo comando: client-id + nombre + email + pass → inserta todo vía psql | El onboarding requiere copiar/pegar ~7 bloques SQL manualmente |
| `verify_rls.py` | Query `pg_policies` y confirma que todas las tablas tenant tienen `auth_tenant` y ninguna tiene `{public}` | Bug G-002 puede reaparecer sin detección |
| `smoke_test_browser.py` / Playwright | Login → menú visible → orden → cobro end-to-end headless | Validación browser requiere persona en el loop |
| `apply_migrations.py` | Aplica todos los archivos SQL en el orden correcto a un Supabase project ref dado | Hoy requiere copiar/pegar en SQL Editor |
| `teardown_client.sh` | Elimina todos los datos de un client_id (para limpiar tests) | Limpieza manual tabla por tabla |
| `check_hardcodes.sh` | `grep -r "amalay"` en el código con whitelist de falsos positivos | Hardcodes nuevos pasan inadvertidos |

---

## 3. ¿Qué configuraciones siguen siendo manuales?

| Configuración | Cómo se hace hoy | Automatizable? |
|---|---|---|
| Crear proyecto Supabase | UI web | Sí — Supabase Management API |
| Setear env vars en Vercel | `vercel env add` x4 | Sí — Vercel CLI scriptable |
| Crear CNAME en Cloudflare | UI web o API manual | Sí — Cloudflare API |
| Aplicar `vercel alias set` | CLI manual | Sí — ya es CLI |
| Rotar contraseñas de sandbox | SQL manual | Sí — `onboard_client.py` extensión |
| Agregar dominio a Vercel project | CLI o UI | Sí — Vercel CLI |
| Configurar Telegram chat IDs por cliente | `clients.telegram_chat_ids` en SQL | Ya es dato, falta UI |
| Configurar printer IP por terminal | `clients` o local config | Falta columna/tabla |

**Bottleneck principal:** el bloque "crear Supabase project + aplicar migraciones" toma ~15 min y es completamente manual. Automatizarlo requeriría un `provision_client.sh` que use la Supabase Management API.

---

## 4. ¿Qué procesos siguen siendo frágiles?

| Proceso | Por qué es frágil | Mitigación actual |
|---|---|---|
| Orden de migraciones | Un archivo aplicado fuera de orden puede crear FKs antes que las tablas referenciadas | Solo documentación — no hay `IF EXISTS` guards en todos los archivos |
| RLS en nuevas migraciones | Una nueva migración puede accidentalmente crear una política `{public}` y romper el aislamiento | Ninguno — requiere review manual |
| `auth_client_id()` si client_users vacío | Si el user existe en auth.users pero no en client_users, la función retorna NULL → RLS devuelve 0 filas (data access denied) | Smoke test verifica el link |
| SSL provisioning timing | Si Vercel intenta verificar el dominio antes de que el DNS propague, el cert no se provisionará automáticamente | Esperar y hacer click en "Verify" en Vercel UI |
| Sandbox credentials en texto | Las contraseñas del sandbox están en `RUNBOOK.md` y `DEPLOY_SANDBOX.md` | Solo en docs privados — no en código |
| `onboard_client.py` SSL bypass | El script deshabilita verificación SSL (`CERT_NONE`) para funcionar en macOS 3.11 | Solo aceptable en sandbox — no en producción |

---

## 5. ¿Qué debería automatizarse antes del Cliente #10?

Ordenado por impacto / urgencia:

### P0 — Antes del Cliente #3

| Automatización | Por qué P0 | Effort |
|---|---|---|
| `provision_client.sh` end-to-end | A partir del #3, el proceso manual no escala. 30 min × 10 clientes = 5 horas | ~1 día |
| `verify_rls.py` como CI gate | Una política `{public}` en producción expone todos los tenants simultáneamente | ~2 horas |

### P1 — Antes del Cliente #5

| Automatización | Por qué P1 | Effort |
|---|---|---|
| `apply_migrations.py` | Hoy requiere copiar/pegar en SQL Editor. Error humano probable | ~4 horas |
| Cloudflare API para DNS | El CNAME manual es el único paso que no puede hacerse desde CLI hoy | ~4 horas |
| `check_hardcodes.sh` en CI | Sin gate, cada PR puede introducir un `client_id = 'amalay'` hardcodeado | ~2 horas |

### P2 — Antes del Cliente #10

| Automatización | Por qué P2 | Effort |
|---|---|---|
| Supabase Management API para crear proyectos | Si cada cliente tiene su propio proyecto (move away from shared schema) | ~2 días |
| UI de onboarding (admin panel) | El fundador no debería necesitar SQL para agregar un cliente | ~1 semana |
| `teardown_client.sh` | Imposible hacer limpieza de clientes de prueba sin él | ~4 horas |
| Playwright smoke test | Validación browser hoy requiere una persona | ~1 día |
| Per-client anon key | Cierra el gap de G-006 (anon cross-tenant reads) | Requiere Supabase Enterprise o branching |

---

## Resumen: Deuda de Automatización

| Categoría | Items | Antes del #3 | Antes del #5 | Antes del #10 |
|---|---|---|---|---|
| Scripts faltantes | 6 | 2 | 3 | 1 |
| Configuraciones manuales | 8 | 0 | 4 | 4 |
| Procesos frágiles | 6 | 2 | 2 | 2 |

**El esqueleto funciona.** El onboarding de PRUEBA-3 tomó ~5 min con SQL puro. Pero sin automatización, el tiempo no baja de 15–30 min por cliente y hay 4+ puntos donde un error humano puede causar un incidente de aislamiento.

La automatización de `provision_client.sh` + `verify_rls.py` es la inversión mínima para operar con confianza más allá del Cliente #5.
