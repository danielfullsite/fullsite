# PAE — Implementation Plan

> **Propósito:** Backlog ordenado para implementar Café Nómada (PAE v1.0).  
> **No es otro documento de arquitectura.** La arquitectura está congelada en `PAE.md`.  
> Este documento responde: ¿qué toca quién, cuándo, y cómo sabes que terminó?

> **Regla:** No implementar ningún componente del PAE mientras P0-4 Offline siga abierto.  
> Excepción: los componentes de Fase 0 (solo datos, sin código) pueden prepararse en paralelo.

---

## Mapa de fases

```
FASE 0 — Preparación (durante P1 Golden Skeleton)
  ↓  (no depende de código)
FASE 1 — Bootstrap + Dataset (requiere Debt P0 resuelto)
  ↓
GATE P0 — Tenant Isolation
  ↓
FASE 2 — Smoke Tests (12/12 PASS = Gate P1 = P1 Golden Skeleton DONE)
  ↓
GATE P1 — PAE Ready
  ↓
FASE 3 — Agents + KPIs (requiere Debt P1 resuelto)
  ↓
FASE 4 — Acceptance Suite (4h + Offline Fase 5)
  ↓
GATE P3 — PAE CERTIFIED (prerequisito Cliente #2)
```

---

## Qué desbloquea qué en la deuda Golden Skeleton

La PAE implementation depende directamente de los ítems del Debt Registry. Esta tabla dice qué gate de la PAE no puede iniciarse sin qué ítem de deuda.

| Deuda | Prioridad | Bloquea gate PAE |
|---|---|---|
| D-01 client-config.ts FALLBACKS | P0 | Bootstrap — TI Gate P0 |
| D-02 EMAIL_MAP hardcode | P0 | Bootstrap — TI Gate P0 |
| D-03 settings.ts routing default | P0 | SM-04, SM-05 (KDS) — Gate P1 |
| D-04 pos-constants.ts STATION_CATEGORIES | P0 | SM-04, SM-05 (KDS) — Gate P1 |
| D-09 SQL DEFAULT 'amalay' (17 tablas) | P0 | Bootstrap — TI Gate P0 |
| D-21 pos-config.ts SSR fallback | P0 | TI-04 (pantallas POS sin AMALAY) — Gate P0 |
| D-22 encuestas fallback | P0 | TI-02 (datos nomada clean) — Gate P0 |
| D-23 health check wansoft assumption | P0 | SM-11 (health check) — Gate P1 |
| D-24 prospect route chat_id hardcode | P0 | SM indirecto — routing correcto para nomada |
| D-25 CierreCajaWizard `<h2>AMALAY</h2>` | P0 | SM-08 (cierre) — Gate P1 |
| D-05 MARKET_CATEGORIES desde DB | P1 | Acceptance Suite — Gate P3 |
| D-06 BAKERY_CATEGORIES feature flag | P1 | SM-03 (menú limpio) — Gate P1 |
| D-07 panaderia route guard | P1 | TI-04 (rutas AMALAY-only invisibles) |
| D-08 inventario-market route guard | P1 | TI-04 (rutas AMALAY-only invisibles) |
| D-11 AI chat meseros hardcode | P0 | SM-10 (AI chat) — Gate P1 |
| D-12 reviews escalation email | P0 | Agentes Gate P3 |
| D-13 electron-kds URL hardcode | P1 | Acceptance Suite KDS |
| D-14 roles.ts email fallback | P1 | TI Gate P0 indirecto |
| D-15 orquestador SYSTEM_PROMPT | P1 | SM-10 indirecto — Gate P3 |
| D-16 Python scripts CLIENT_ID default | P1 | Fase 3 Agents — Gate P3 |
| D-17 Uber OAuth callback fallback | P1 | Gate P3 (integración Uber) |
| D-18 cron route cron agent default | P1 | Fase 3 Agents — Gate P3 |
| D-19 backup route admins hardcode | P1 | Gate P3 (admin access) |
| D-20 tabla amalay_reservaciones | P1 | TI Gate P0 (schema debt) |

---

## FASE 0 — Preparación

**Cuándo:** Durante la implementación de P1 Golden Skeleton. Antes de que Debt P0 esté resuelto.  
**Restricción:** Solo datos y scripts SQL. Cero cambios a código fuente.  
**Objetivo:** Que el momento en que Debt P0 esté listo, el bootstrap se ejecute sin preparación adicional.

---

### F0-A — Dataset canónico (seed files)

**Dependencias:** Ninguna — datos puros.

**Archivos que tocará:**
```
scripts/seed/nomada/
  v1_menu.sql          — 10 categorías, 40 ítems con precios y slugs
  v1_staff.sql         — 4 usuarios (Ana, Carlos, Diana, Eduardo) con PINs y roles
  v1_inventory.sql     — 20 ingredientes, 10 recetas con food cost
  v1_settings.sql      — 15 mesas, KDS routing, 4 métodos de pago
```

**Migraciones:** Ninguna. Usa el schema existente. Si el schema cambia durante P1, el seed se versiona a v2.

**Riesgos:**
- Schema drift: si una columna cambia de nombre durante P1, el seed INSERT falla en silencio o con error. Mitigación: escribir los seeds al final de P1 cuando el schema esté estabilizado.
- Valores de PINs en repositorio: los PINs de nomada son ficticios y no tienen acceso a producción, pero deben documentarse como datos de test únicamente. Nunca usar los mismos PINs en un cliente real.

**Criterio PASS:** `SELECT count(*) FROM pos_menu_items WHERE client_id='nomada'` = 40 tras aplicar seed.  
**Criterio FAIL:** Cualquier INSERT falla, o `SELECT count(*) FROM pos_menu_items WHERE client_id!='nomada'` > 0.

---

### F0-B — Script de teardown

**Dependencias:** Ninguna.

**Archivos que tocará:**
```
scripts/seed/nomada/teardown.sql    — DELETE cascade en orden FK para client_id='nomada'
```

**Migraciones:** Ninguna.

**Riesgos:** Si FK constraints faltan en alguna tabla nueva, el DELETE puede dejar huérfanos silenciosos. El script debe verificar con `SELECT count(*)` tras cada DELETE antes de continuar.

**Criterio PASS:** Tras ejecutar teardown, `SELECT count(*) FROM clients WHERE id='nomada'` = 0 y `SELECT count(*) FROM pos_orders WHERE client_id='nomada'` = 0.  
**Criterio FAIL:** Cualquier tabla con rows de nomada después del teardown.

---

### F0-C — Queries de Tenant Isolation (TI-01…TI-06)

**Dependencias:** Ninguna.

**Archivos que tocará:**
```
scripts/verify/tenant_isolation_nomada.sql    — 6 queries verificables, una por línea con output esperado
```

**Migraciones:** Ninguna.

**Riesgos:** Las queries deben ejecutarse desde una sesión autenticada como `admin@nomada.test`, no como `service_role`. Si se ejecutan con service_role, RLS no aplica y los checks pasan aunque estén rotos.

**Criterio PASS:** Las 6 queries devuelven 0 cuando se ejecutan autenticadas como `nomada`.  
**Criterio FAIL:** Cualquier query devuelve > 0 filas.

---

## FASE 1 — Bootstrap + Dataset

**Cuándo:** Inmediatamente después de que D-01, D-02, D-03, D-04, D-09, D-21, D-22 estén resueltos (Debt P0 crítico para provisioning).  
**Objetivo:** Café Nómada existe en staging con datos canónicos y tenancy aislada.

---

### F1-A — Provisioning de Nómada en staging

**Dependencias de deuda:** D-01, D-02, D-09, D-21, D-22 (todos resueltos).

**Archivos que tocará:**
```
scripts/onboard_client.py    — Agregar soporte para --client-id y --display-name como params requeridos.
                               Eliminar default 'amalay'. Fallar explícitamente si CLIENT_ID no pasado.
```

**Migraciones:** `004_remove_amalay_defaults.sql` (D-09) debe estar aplicada antes de ejecutar este paso.

**Riesgos:**
- Si algún INSERT en el flujo de onboarding no pasa `client_id` explícito, el row irá a `'amalay'` hasta que D-09 esté aplicada. D-09 es prerequisito hard.
- Si `onboard_client.py` tiene lógica específica de AMALAY (emails, PINs iniciales, etc.), producirá un `nomada` contaminado. Revisar el script completo antes de ejecutar.

**Criterio PASS:** `SELECT id, display_name FROM clients WHERE id='nomada'` devuelve 1 fila con `display_name='Café Nómada'`.  
**Criterio FAIL:** Script lanza excepción, o la fila no existe, o `display_name` contiene referencia a AMALAY.

---

### F1-B — Aplicación de seeds canónicos

**Dependencias:** F1-A completo. Seeds de F0-A listos.

**Archivos que tocará:**
```
scripts/seed/nomada/v1_menu.sql
scripts/seed/nomada/v1_staff.sql
scripts/seed/nomada/v1_inventory.sql
scripts/seed/nomada/v1_settings.sql
```

**Migraciones:** Ninguna adicional.

**Riesgos:** Orden de aplicación importa: `v1_staff.sql` depende de que `client_id='nomada'` exista en `clients`. Aplicar siempre en el orden declarado.

**Criterio PASS:**
- 40 ítems en `pos_menu_items WHERE client_id='nomada'`
- 4 rows en `pos_staff WHERE client_id='nomada'`
- 20 rows en `pos_ingredients WHERE client_id='nomada'`
- 15 rows en `pos_tables WHERE client_id='nomada'`

**Criterio FAIL:** Cualquier count difiere del esperado, o existe un row con `client_id!='nomada'` introducido por el seed.

---

## GATE P0 — Tenant Isolation

**Cuándo:** Inmediatamente después de F1-B.  
**Ejecutor:** Queries de F0-C desde sesión autenticada como `admin@nomada.test`.

| Check | Criterio | Blocker si falla |
|---|---|---|
| TI-01 | 0 rows `pos_orders WHERE client_id='amalay'` visible desde nomada | Sí — teardown inmediato |
| TI-02 | 0 rows de otros tenants en `pos_menu_categories` visible desde nomada | Sí — teardown inmediato |
| TI-03 | 0 rows de otros tenants en `pos_staff` visible desde nomada | Sí — teardown inmediato |
| TI-04 | Login como admin@nomada.test → ninguna pantalla muestra texto "AMALAY" | Sí — teardown inmediato |
| TI-05 | Dashboard → 0 ventas de AMALAY visible en sesión nomada | Sí — teardown inmediato |
| TI-06 | AI Chat: "¿Quiénes son mis meseros?" → respuesta sin nombres de AMALAY | Sí — teardown inmediato (requiere D-11) |

**Política si falla:** Teardown completo (F0-B). Identificar qué deuda no estaba realmente resuelta. Aplicar fix. Re-provision desde F1-A.

---

## FASE 2 — Smoke Tests

**Cuándo:** Inmediatamente después de Gate P0 PASS.  
**Objetivo:** Confirmar que las 12 capacidades críticas funcionan para Nómada.

---

### F2-A — Suite SM-01…SM-12

**Dependencias de deuda:**

| Smoke Test | Deuda requerida |
|---|---|
| SM-01 (Login PIN) | D-01, D-02 (auth sin fallback AMALAY) |
| SM-02 (Abrir turno) | Ninguna adicional |
| SM-03 (Agregar ítems) | D-06 (bakery flag — menu sin categorías AMALAY) |
| SM-04 (KDS Cocina) | D-03, D-04 (routing genérico) |
| SM-05 (KDS Barra) | D-03, D-04 |
| SM-06 (Impresión) | Ninguna adicional |
| SM-07 (Cobro) | Ninguna adicional |
| SM-08 (Cierre turno) | D-25 (`<h2>AMALAY</h2>` eliminado) |
| SM-09 (Dashboard) | Ninguna adicional (RLS ya verificado en Gate P0) |
| SM-10 (AI Chat) | D-11 (meseros desde DB), D-15 recomendable |
| SM-11 (Health check) | D-23 (health check sin suponer wansoft) |
| SM-12 (Bridge) | Ninguna adicional |

**Archivos que tocará:**
```
scripts/smoke/nomada_smoke.sh    — Script ejecutor secuencial de SM-01..SM-12.
                                   Cada step imprime PASS o FAIL con timestamp.
                                   Sale con código 1 si cualquier step falla.
```

**Migraciones:** Ninguna.

**Riesgos:**
- SM-04/05 (KDS routing): si el bridge de staging no está corriendo, estos tests fallan. El bridge debe estar activo antes de ejecutar los smoke tests.
- SM-10 (AI Chat): el modelo puede responder con contexto de AMALAY si D-11 no está aplicada. Este es el test más frágil — requiere verificación manual del texto de la respuesta.
- SM-12 (Bridge): si se usa un bridge simulado (log-to-file), confirmar que el smoke script sabe la URL correcta.

**Criterio PASS:** 12/12 en una sola ejecución, sin intervención manual, en < 5 minutos.  
**Criterio FAIL:** Cualquier SM devuelve FAIL, o la suite tarda > 5 min, o requiere intervención manual para continuar.

---

## GATE P1 — PAE Ready (cierra P1 Golden Skeleton)

Todos los criterios deben cumplirse simultáneamente en una misma sesión:

| Criterio | Evidencia requerida |
|---|---|
| Provisioning < 30 min | Timestamp de inicio y fin de F1-A + F1-B registrado |
| Gate P0 PASS | 6/6 checks TI-01..TI-06 documentados |
| 12/12 Smoke Tests PASS | Output de `nomada_smoke.sh` archivado |
| 0 datos AMALAY visibles | Captura de pantalla por cada módulo del POS y Dashboard |
| Commit con evidencia | `docs/certifications/PAE-P1-CERT-{fecha}.md` en main |

**Este gate cierra P1 Golden Skeleton.** Una vez cerrado, el foco completo pasa a Fase 3.

---

## FASE 3 — Agents + KPIs

**Cuándo:** Inmediatamente después de Gate P1.  
**Objetivo:** Los 26 agentes corren para Nómada. El Dashboard muestra KPIs reales.

---

### F3-A — Agentes para Nómada

**Dependencias de deuda:** D-16 (Python scripts sin default AMALAY). Sin esto, los agentes corren para AMALAY aunque el target sea nomada.

**Archivos que tocará:**
```
.github/scripts/client_config.py        — Requerir CLIENT_ID env var, sin default.
.github/scripts/daily_briefing.py       — Pasar client_slug desde env.
.github/scripts/anomaly_detector.py     — Ídem.
.github/scripts/close_predictor.py      — Ídem.
[9+ scripts Python adicionales]         — Mismo cambio en cada uno.
.github/workflows/agents-daily.yml      — Agregar CLIENT_ID: nomada para job nomada.
.github/workflows/agents-hourly.yml     — Ídem.
.github/workflows/agents-weekly.yml     — Ídem.
```

**Migraciones:** Ninguna.

**Riesgos:** Algunos workflows corren múltiples tenants en el mismo job. Si el patrón de dispatch no está claro, un agente puede correr para nomada pero escribir en `agent_runs` con `client_slug='amalay'`. Verificar que el `client_slug` en `agent_runs` coincide con el tenant target.

**Criterio PASS:** `SELECT count(*) FROM agent_runs WHERE client_slug='nomada' AND created_at > now() - interval '48h'` ≥ 1 run por agente activo.  
**Criterio FAIL:** Cualquier agente con 0 runs en 48h para nomada, o runs con `client_slug='amalay'` disparados por el job de nomada.

---

### F3-B — KPI Dashboard visible para Nómada

**Dependencias:** F3-A completo (agentes deben tener datos). D-14 (roles.ts sin email hardcode) para que el login de admin@nomada.test tenga acceso completo al Dashboard.

**Archivos que tocará:**
```
dashboard-app/src/lib/roles.ts    — Eliminar fallback de email (D-14).
```

No se requieren nuevas páginas ni componentes. El Dashboard existente con `client_id=nomada` ya muestra los KPIs correctos si los datos existen.

**Migraciones:** Ninguna.

**Riesgos:** El Dashboard puede mostrar datos de AMALAY si hay un join sin filtro de `client_id`. Gate P0 TI-05 ya verificó esto, pero con datos vacíos. Con datos reales de agentes, verificar nuevamente TI-05 y TI-06.

**Criterio PASS:** Los 10 KPIs de `PAE.md §6` muestran valores correctos para nomada. Ningún panel muestra referencias a AMALAY.  
**Criterio FAIL:** Cualquier KPI muestra datos de AMALAY, o el login de admin@nomada.test no tiene acceso al Dashboard con su rol completo.

---

## FASE 4 — Acceptance Suite

**Cuándo:** Después de Gate P1 + Fase 3 completa. Antes de Gate P3.  
**Objetivo:** Certificación completa de 4 horas. Incluye Protocolo Offline Fase 5.

---

### F4-A — Ejecución de Acceptance Suite

**Dependencias:**
- Gate P1 PASS
- Fase 3 completa (agentes activos para nomada, KPIs visibles)
- Debt P1 resuelto: D-05, D-06, D-07, D-08, D-13, D-15, D-17, D-18, D-19, D-20
- Bridge corriendo en staging (o terminal física)
- Protocolo Offline Fase 5 v1.0 (`docs/offline/FASE5-EXECUTION-PLAN.md`)

**Archivos que tocará:**
```
docs/certifications/PAE-CERT-{fecha}.md    — Evidencia archivada al terminar (generado durante test).
docs/state/CERTIFICATIONS.md               — Actualizar con estado PAE CERTIFIED.
```

**Migraciones:** Ninguna adicional (todas aplicadas en fases previas).

**Módulos a ejecutar:**

| Módulo | Dependencia de deuda | Riesgo si no resuelta |
|---|---|---|
| POS — Órdenes | D-03, D-04, D-25 | KDS routing a estaciones incorrectas; texto AMALAY en ticket |
| POS — Caja | D-25 | Texto AMALAY en cierre impreso |
| KDS — Cocina | D-03, D-04, D-13 | electron-kds apunta a Supabase prod si D-13 no resuelto |
| KDS — Barra | D-03, D-04 | Mismo riesgo de routing |
| Print | Ninguna adicional | — |
| Offline | D-21 (SSR fallback) | Boot offline puede cargar config de AMALAY por ~100ms |
| Replay | Ninguna adicional | — |
| Multi-terminal | Ninguna adicional | — |
| GUARD-08 | Ninguna adicional (implementado) | — |
| AI Chat | D-11, D-15 | Chat responde con contexto AMALAY |
| Dashboard KPIs | D-14, D-18 | Roles incorrectos o KPIs sin datos de nomada |
| Agentes | D-12, D-16, D-18 | Agentes corren para AMALAY, no para nomada |
| Concurrencia | Ninguna adicional | — |
| Health | D-23 | Health check reporta false negative para nomada |

**Criterio PASS:** ORS ≥ 80, 14/14 módulos PASS, Protocolo Offline Fase 5 PASS sobre Nómada.  
**Criterio FAIL:** ORS < 80, cualquier módulo FAIL, cualquier dato AMALAY visible, o cualquier gate activo al finalizar.

---

### F4-B — Validación de rollback

**Dependencias:** F4-A completo.

**Ejecutar en secuencia:**
1. Aplicar `scripts/seed/nomada/teardown.sql`
2. Verificar 0 rows de nomada en todas las tablas
3. Ejecutar Bootstrap completo (F1-A + F1-B) desde cero
4. Ejecutar Gate P0 (TI-01…TI-06)
5. Ejecutar Smoke Tests (SM-01…SM-12)

**Tiempo objetivo:** < 30 minutos para los pasos 3–5.

**Criterio PASS:** El ciclo completo (teardown → bootstrap → TI → smoke) completa en < 30 min con todos los checks PASS.  
**Criterio FAIL:** Cualquier check falla, o el tiempo supera 30 min, o el bootstrap falla tras el teardown.

---

## GATE P3 — PAE CERTIFIED

Todos los criterios simultáneamente:

| Criterio | Evidencia requerida |
|---|---|
| F4-A: 14/14 módulos PASS | Log de evidencia en tiempo real archivado |
| F4-A: ORS ≥ 80 | Tabla de cálculo ORS completa |
| F4-A: Offline Fase 5 PASS | Evidencia E4 (misma evidencia que AMALAY Fase 5 si se ejecuta primero) |
| F4-B: Rollback validado | Ciclo teardown → bootstrap → TI → smoke documentado |
| Commit con evidencia | `docs/certifications/PAE-CERT-{fecha}.md` en main |
| `CERTIFICATIONS.md` actualizado | Estado PAE CERTIFIED con fecha y referencia al cert |

**Este gate es el prerequisito inmediato antes del Shadow Day de Cliente #2.**

---

## Resumen de dependencias

```
FASE 0 ──────────────────── Sin dependencias de código (solo datos)
    │
FASE 1 ──────────────────── Requiere: D-01, D-02, D-09, D-21, D-22
    │
GATE P0 ─────────────────── Requiere: D-01, D-02, D-09, D-21, D-22 + seeds
    │
FASE 2 ──────────────────── Requiere: D-03, D-04, D-06, D-11, D-23, D-25
    │
GATE P1 (cierra P1) ──────── Requiere: Toda deuda P0 (D-01..D-25 tipo P0)
    │
FASE 3 ──────────────────── Requiere: D-14, D-16, D-18
    │
FASE 4 ──────────────────── Requiere: Toda deuda P1 (D-05..D-20 tipo P1)
    │
GATE P3 (cierra P3) ──────── Requiere: Toda deuda P0 + P1 + evidencia física
```

---

## Ítems que pueden comenzar antes de Gate P1

| Componente | Por qué puede adelantarse |
|---|---|
| F0-A — Seeds (datos) | No dependen de código |
| F0-B — Teardown script | SQL simple, no depende de deuda |
| F0-C — TI queries | SQL simple, no depende de deuda |
| Insertar fila `nomada` en `clients` de staging | No requiere código cambiado |

**Todo lo demás espera a que Debt P0 esté resuelto.**  
No tiene sentido ejecutar el bootstrap antes de que D-09 esté aplicado: los INSERTs irían a `'amalay'` en silencio.
