# SEC-DEPLOY-01 — Reproducible Database Security Deployment

> Abierto: 2026-07-27  
> Origen: hallazgo R-15 de la auditoría de Fase 0 (`03-risk-register.md`)  
> Severidad: ALTO — CONFIRMADO  
> Workstream: SEPARADO del Migration Engine. No mezclar.  
> Estado: ABIERTO — solo documentación por ahora

---

## Problema

El `scripts/sql/migrations/MANIFEST.json` documenta que el schema consolidado tiene:

- **194 RLS policies** — no incluidas en los archivos SQL de migration
- **15 funciones** — bodies no disponibles desde `information_schema`
- **7 triggers** — bodies no disponibles desde `information_schema`

La razón documentada en el MANIFEST: `"Bodies not available from information_schema"`.

**Consecuencia:** Un deploy de `scripts/sql/migrations/` a un entorno nuevo (nuevo tenant, staging, disaster recovery) resultaría en todas las tablas **sin protección de RLS**. Los datos de un cliente serían accesibles desde la sesión de otro cliente.

---

## Alcance del workstream

Documentar todo lo que actualmente **no es reproducible** en un nuevo entorno:

| Categoría | Cantidad conocida | Reproducible hoy | Notas |
|---|---|---|---|
| RLS policies | 194 | ❌ No | No están en ningún archivo `.sql` del repo |
| Funciones PL/pgSQL | 15 | ❌ No | Bodies no capturados |
| Triggers | 7 | ❌ No | Bodies no capturados |
| GRANTs / REVOKEs | ? | DESCONOCIDO | No verificado |
| Extensiones | ? | DESCONOCIDO | No verificado |
| Roles de base de datos | ? | DESCONOCIDO | No verificado |
| Tests de aislamiento | 0 | N/A | No existen |

---

## Lo que NO hace este workstream

- No copia ciegamente las 194 RLS policies a un archivo SQL sin revisarlas
- No mezcla con el Migration Engine ni con cambios al POS
- No despliega a producción dentro de este workstream
- No genera un "dump" de producción como sustituto de migrations reales

---

## Preguntas abiertas (antes de cualquier acción)

1. ¿Cuáles de las 194 RLS policies son del schema core vs del schema wansoft_pipeline vs de tablas temporales?
2. ¿Hay policies que solo aplican a AMALAY y que no deberían propagarse a nuevos tenants?
3. ¿Las funciones usan `SECURITY DEFINER`? ¿Con qué rol?
4. ¿Los triggers mutan datos? ¿Qué condición los activa?
5. ¿Existe algún script de Supabase CLI (`supabase db diff`) que capture el estado actual?
6. ¿Las 194 policies son por-tabla o hay políticas row-level por `client_id`?

---

## Primer entregable (solo documentación)

Antes de escribir un solo SQL:

1. Conectar a Supabase con el MCP y extraer:
   - Lista de tablas con RLS habilitado vs deshabilitado
   - Lista de policies por tabla (nombre, comando, roles, expresión `USING`)
   - Lista de funciones con `pg_proc` (nombre, schema, `prosrc` o body)
   - Lista de triggers con `pg_trigger` (nombre, tabla, función, timing)

2. Clasificar:
   - ¿Qué policies son multi-tenant (filtran por `client_id`)? — deben ser parte del schema base
   - ¿Qué policies son AMALAY-específicas? — no deben propagarse
   - ¿Qué funciones son utilitarias genéricas vs AMALAY-específicas?

3. Entregar un documento `SEC-DEPLOY-01-inventory.md` con la clasificación completa.

**No escribir SQL de policies hasta tener ese inventario revisado por Daniel.**

---

## Tests de aislamiento requeridos (Fase futura)

Antes de declarar SEC-DEPLOY-01 cerrado, deben existir tests que verifiquen:

```
- Usuario del cliente A no puede leer filas del cliente B en ninguna tabla
- Usuario anónimo no puede leer filas con información sensible
- service_role puede leer todo (bypass RLS) — verificar que solo se usa en GH Actions
- RLS policies sobreviven un DROP + recreate del schema
```

---

## Relación con Migration Engine

SEC-DEPLOY-01 y el Migration Engine son workstreams paralelos e independientes.

| Decisión en uno | Impacto en el otro |
|---|---|
| Migration Engine agrega tabla nueva | SEC-DEPLOY-01 debe incluir RLS para esa tabla |
| SEC-DEPLOY-01 extrae policies existentes | Migration Engine puede referenciarlas como prerequisito |

El punto de coordinación es: **antes de que el Migration Engine escriba a producción en un nuevo tenant, SEC-DEPLOY-01 debe haber verificado que ese tenant tiene RLS activo**.
