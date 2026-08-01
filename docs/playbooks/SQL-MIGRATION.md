# Runbook: Migraciones SQL y RPCs

> **Semi-permanente.** Cambia cuando cambia el proceso, no cuando cambia el estado.
> Última revisión: 2026-07-24

---

## Dónde vive cada migración

El repo tiene dos ubicaciones de SQL con propósitos distintos:

```
scripts/sql/migrations/          ← Schema: tablas, índices, constraints, RLS
  000_extensions.sql             ← Extensiones de PostgreSQL
  001_core_schema.sql            ← Tablas principales
  003_rls_policies.sql           ← Políticas de Row Level Security
  004_functions.sql              ← Archivo histórico de funciones (no se actualiza)
  ...

dashboard-app/sql/               ← RPCs y funciones: una por archivo
  r1_save_order.sql              ← (referencia; la función vive en 004_functions.sql)
  r2d_save_operation_...sql      ← Wraps r1 con idempotencia
  r1_add_items.sql               ← Append-only item add
```

**Regla:**
- Nueva tabla, índice, constraint o política RLS → `scripts/sql/migrations/` con número siguiente
- Nueva función o RPC → `dashboard-app/sql/nombre.sql` (archivo individual)
- Modificación a una RPC existente → mismo archivo en `dashboard-app/sql/`, reemplaza el contenido

El archivo `004_functions.sql` es un registro histórico. No lo edites para agregar RPCs nuevas; podría ejecutarse de forma ordenada y sobreescribir tu trabajo.

---

## Convención de nombres

### Archivos SQL

```
dashboard-app/sql/r1_add_items.sql          ← función r1_add_items
dashboard-app/sql/r2d_save_operation_idempotency.sql  ← wraps r1 con idempotencia
scripts/sql/migrations/012_pos_v3_schema.sql  ← migración de schema, número siguiente
```

### Funciones PostgreSQL

| Prefijo | Significado | Ejemplo |
|---|---|---|
| `r1_` | Operación core: atómica, sin idempotencia transaccional | `r1_save_order`, `r1_add_items` |
| `r2d_` o wraps `r1_` | Operación con exactly-once identity (tabla de operaciones) | `r1_save_order_idempotent` |
| Sin prefijo | Trigger o función utilitaria interna | `set_updated_at`, `reject_mutation` |

Los prefijos `r1_`, `r2d_` NO son versiones. Son niveles de garantía. Una función puede existir en ambas variantes simultáneamente.

---

## Migración idempotente vs. destructiva

### Idempotente (ejecutar múltiples veces es seguro)

- `CREATE OR REPLACE FUNCTION` — reemplaza la función existente, no falla si ya existe
- `CREATE TABLE IF NOT EXISTS` — no falla si la tabla ya existe
- `CREATE INDEX IF NOT EXISTS` — no falla si el índice ya existe
- `CREATE POLICY ... ON table` precedida de `DROP POLICY IF EXISTS` — patrón seguro
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — en PostgreSQL 9.6+

Todo SQL de RPC debe ser idempotente: puedes re-correr el archivo en cualquier momento sin consecuencias.

### Destructiva (requiere revisión explícita)

- `DROP TABLE` — pérdida permanente de datos
- `DROP FUNCTION` — sin posibilidad de reversa automática
- `ALTER TABLE ... DROP COLUMN` — pérdida permanente
- `TRUNCATE` — pérdida permanente de datos
- `DELETE FROM ... WHERE` — pérdida según filtro

**Regla:** Ninguna migración destructiva se corre sin confirmación explícita de Daniel. Si el deploy requiere una operación destructiva, escríbela en un archivo separado con sufijo `_DESTRUCTIVE.sql` y documenta el rollback antes de ejecutarla.

---

## Estructura obligatoria de una RPC nueva

Toda función nueva debe seguir exactamente este patrón. No hay excepciones.

```sql
-- Descripción: qué hace en una línea
-- Garantía de seguridad: si es idempotente, append-only, OCC, etc.
-- Deploy: instrucciones especiales si las hay
CREATE OR REPLACE FUNCTION r1_nombre_funcion(
  p_client_id text,       -- siempre primer parámetro
  p_param_1   text,
  p_param_2   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER           -- OBLIGATORIO: corre con privilegios del owner
SET search_path = public   -- OBLIGATORIO: previene ataques de search_path
AS $fn$
DECLARE
  v_result_var type;
BEGIN
  -- Lógica aquí
  -- Siempre validar que la operación matcheó filas del tenant correcto

  IF v_result_var IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DESCRIPCIÓN_ERROR_ESPECÍFICA');
  END IF;

  RETURN jsonb_build_object('ok', true, ...);
END;
$fn$;

-- ACL: solo service_role puede ejecutar RPCs de datos
REVOKE ALL ON FUNCTION r1_nombre_funcion FROM PUBLIC;
REVOKE ALL ON FUNCTION r1_nombre_funcion FROM anon;
REVOKE ALL ON FUNCTION r1_nombre_funcion FROM authenticated;
GRANT EXECUTE ON FUNCTION r1_nombre_funcion TO service_role;

-- Verificación: ejecutar esto para confirmar que el deploy fue exitoso
SELECT proname, prosecdef, proowner::regrole
FROM   pg_proc
WHERE  proname = 'r1_nombre_funcion';
```

---

## SECURITY DEFINER y SET search_path

### Por qué `SECURITY DEFINER`

Las funciones de datos corren con los privilegios del owner de la función (normalmente `postgres` en Supabase), no del caller. Esto es necesario porque:
- `pos_orders` tiene RLS habilitado
- El API route llama con `service_role` key, que bypasea RLS
- Pero la función misma necesita poder escribir sin restricciones de RLS del caller

Sin `SECURITY DEFINER`, una función llamada por `anon` no puede escribir en tablas con RLS restrictivo.

### Por qué `SET search_path = public`

Sin esta línea, un atacante con acceso a crear esquemas podría crear un esquema con funciones maliciosas que intercepten las llamadas de la RPC. `SET search_path = public` fija el path de búsqueda durante la ejecución de la función, eliminando este vector.

**Si la función usa `uuid_generate_v4()`:** usar `SET search_path = public, extensions` (como `r1_save_order_idempotent`).

---

## Validación de `client_id` / tenant

**Regla absoluta:** Todo `UPDATE`, `INSERT`, `DELETE` y `SELECT` en tablas de datos del restaurante debe incluir `client_id = p_client_id` en el `WHERE`.

```sql
-- Correcto
UPDATE pos_orders
SET ...
WHERE id = p_order_id AND client_id = p_client_id;

-- INCORRECTO — cross-tenant leak posible
UPDATE pos_orders
SET ...
WHERE id = p_order_id;
```

La ausencia de `client_id` en el `WHERE` de un `UPDATE` es un bug de seguridad: cualquier terminal podría modificar órdenes de otro restaurante si conoce el ID.

**Verificación:** Antes de hacer PR de cualquier RPC, grep por `UPDATE`, `DELETE`, e `INSERT INTO` en el cuerpo de la función y confirma que cada uno tiene `client_id` en el predicado o está insertando con `client_id` como valor explícito.

---

## GRANTs y REVOKEs

En Supabase, las funciones creadas tienen `EXECUTE` otorgado a `PUBLIC` por defecto, lo que incluye al rol `anon`. Esto permite que cualquier cliente sin autenticación llame directamente la función vía PostgREST si la URL es conocida.

Para RPCs que manejan datos de órdenes, inventario o pagos, **siempre** incluir al final del archivo:

```sql
REVOKE ALL ON FUNCTION nombre_funcion FROM PUBLIC;
REVOKE ALL ON FUNCTION nombre_funcion FROM anon;
REVOKE ALL ON FUNCTION nombre_funcion FROM authenticated;
GRANT EXECUTE ON FUNCTION nombre_funcion TO service_role;
```

Esto garantiza que solo el backend (que usa `SUPABASE_SERVICE_KEY` = service_role) puede llamar la función. El cliente web (que usa `SUPABASE_ANON_KEY` = anon) no puede llamarla directamente.

**Nota sobre funciones existentes en `004_functions.sql`:** Las funciones históricas no tienen este patrón explícito. Esto es deuda conocida — no bloquea el sistema porque el service_role key ya tiene EXECUTE por defecto, pero es una postura de seguridad más débil. Las funciones nuevas deben siempre incluir el bloque de ACL.

---

## Idempotencia de operaciones

Una RPC es idempotente si llamarla dos veces con los mismos parámetros produce el mismo resultado en la DB.

### Append-only con deduplicación por ID (patrón preferido para `r1_add_items`)

```sql
-- Agrega solo los items que no están ya presentes por su id
SET items = items || (
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (item->>'id') item
    FROM   jsonb_array_elements(p_items) item
    ORDER  BY item->>'id'
  ) deduped
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) existing
    WHERE existing->>'id' = deduped.item->>'id'
  )
)
```

Llamar dos veces con los mismos items → segunda vez no agrega nada. La `order_revision` sí se incrementa en la segunda llamada (el UPDATE matchea la fila), pero el array de items no cambia. Si se requiere idempotencia total (incluyendo revision), usar una tabla de operaciones como `r1_save_order_idempotent`.

### OCC (Optimistic Concurrency Control)

`r1_save_order` NO es idempotente por diseño: si se llama dos veces con la misma `expected_revision`, la segunda falla con `conflict`. Para exactly-once, usar `r1_save_order_idempotent` con `save_operation_id`.

---

## Concurrencia y atomicidad

### Un solo `UPDATE` = atómico

Un `UPDATE` en PostgreSQL adquiere un lock exclusivo sobre la fila antes de escribir. El `SET` se evalúa con los valores pre-update de la fila (la snapshot del inicio del statement). Esto garantiza que:

1. Dos terminales que llaman `r1_add_items` simultáneamente serializan en el row lock
2. Cada una ve la versión pre-update de `items` para computar su filtro
3. No hay pérdida de datos entre terminales

```
Terminal A: adquiere lock en pos_orders row → evalúa SET → escribe → suelta lock → rev N+1
Terminal B: espera lock → adquiere lock → evalúa SET (ve rev N+1 de A) → escribe → rev N+2
```

El resultado: ambas terminales agregan sus ítems. Ninguna pierde la del otro.

### Subquery en SET clause con referencia a la misma tabla

```sql
UPDATE pos_orders AS o
SET items = o.items || (SELECT ... FROM jsonb_array_elements(COALESCE(o.items, ...)) ...)
WHERE ...
```

`o.items` en la subquery refiere al valor **pre-update** de la fila bloqueada. PostgreSQL garantiza esto: las referencias a la tabla siendo actualizada en el SET clause leen la snapshot pre-update. El lock exclusivo previene que otra transacción modifique la fila durante la evaluación.

### Lo que NO es atómico

- Dos statements separados (SELECT + UPDATE) sin transacción explícita — hay ventana de race entre ellos
- Leer desde el API route y luego llamar la RPC — el cliente puede ver una versión stale
- CTEs con `FOR UPDATE` combinados con UPDATE externo — comportamiento complejo, evitar

---

## Orden de deploy: SQL primero, código después

**Regla de oro:** La RPC en Supabase debe existir antes de que el código que la llama llegue a producción.

```
1. Crear/actualizar RPC en Supabase SQL Editor
2. Verificar con SELECT (ver sección siguiente)
3. Deploy del código en Vercel (que llama la RPC)
4. Smoke test en producción
```

**Por qué:** El código llama la RPC por nombre. Si la RPC no existe y el código llega primero, cualquier llamada al endpoint retorna 404 o error de función no encontrada. Al revés (RPC existe pero código viejo), el código simplemente no la llama todavía — inofensivo.

**Excepción:** Si la RPC nueva NO es llamada por código existente en producción (es completamente nueva y el código que la llama aún no está en producción), el orden no importa.

---

## Verificación antes del deploy

Antes de correr el SQL en Supabase, revisar:

```sql
-- 1. ¿La función compila? (solo parseo, no ejecuta)
-- → Pegar el CREATE OR REPLACE en SQL Editor y ejecutar. Si hay error de sintaxis, lo reporta.

-- 2. ¿Tiene SECURITY DEFINER?
SELECT proname, prosecdef
FROM   pg_proc
WHERE  proname = 'r1_nombre_funcion';
-- prosecdef = true → correcto

-- 3. ¿El search_path es correcto?
SELECT proname, proconfig
FROM   pg_proc
WHERE  proname = 'r1_nombre_funcion';
-- proconfig debe contener search_path=public

-- 4. ¿Los GRANTs están aplicados?
SELECT grantee, privilege_type
FROM   information_schema.routine_privileges
WHERE  routine_name = 'r1_nombre_funcion';
-- Solo service_role debe aparecer con EXECUTE
```

---

## Smoke test después del deploy

Ejecutar en SQL Editor después de cada deploy de RPC:

```sql
-- Smoke test genérico: llamar con parámetros inválidos, esperar error conocido
SELECT r1_nombre_funcion('nonexistent-client', 'nonexistent-id', '[]'::jsonb);
-- Resultado esperado: {"ok": false, "error": "DESCRIPCIÓN_ERROR_ESPECÍFICA"}
-- Si retorna error de función no encontrada → el deploy no se aplicó
-- Si retorna error de tipo incorrecto → hay un bug en el manejo de errores
```

Para `r1_add_items` específicamente:

```sql
-- Debe retornar ORDER_CLOSED_OR_NOT_FOUND (no un error SQL)
SELECT r1_add_items('nonexistent', 'nonexistent', '[{"id":"test-1"}]'::jsonb);
```

---

## Rollback

### RPC nueva (no modifica schema)

`CREATE OR REPLACE FUNCTION` — el rollback es crear la versión anterior de la función:

```sql
-- Guardar la versión anterior del archivo antes de desplegar
-- Si algo sale mal, re-correr el archivo con la versión anterior
CREATE OR REPLACE FUNCTION r1_nombre_funcion(...) ...versión anterior...;
```

**Regla:** Antes de hacer un deploy de RPC, copiar el texto de la función actual en un comentario al final del archivo nuevo o en un archivo `_rollback.sql`.

### Schema destructivo

Si se corrió una migración destructiva (`DROP`, `TRUNCATE`, `DROP COLUMN`): no hay rollback automático. La opción es restaurar desde el backup de Supabase o reconstruir los datos. Por esto las migraciones destructivas requieren aprobación explícita y un plan de rollback documentado antes de ejecutar.

---

## Cómo registrar evidencia del deploy

Después de verificar el smoke test, registrar en el commit o en el PR:

```
## SQL Deploy Evidence
- Función: r1_add_items
- Desplegada: 2026-07-24 ~14:00 MX
- Verificación SECURITY DEFINER: prosecdef = true ✓
- Smoke test: SELECT r1_add_items('nonexistent',...) → {"ok":false,"error":"ORDER_CLOSED_OR_NOT_FOUND"} ✓
- ACL: solo service_role tiene EXECUTE ✓
```

Si el deploy es parte de un P0 o P1, también registrar en `docs/state/CERTIFICATIONS.md`.

---

## Cómo actualizar BUGS.md y CERTIFICATIONS.md

### Al cerrar un bug con un SQL deploy

En `docs/state/BUGS.md`, cambiar el estado del bug:

```markdown
### POS-02 · Phantom order merge
**Estado:** CLOSED — 2026-07-24 — commit `43d6140`
```

Si el fix incluye una RPC nueva, agregar el hash del SQL deploy en la evidencia.

### Al certificar un P0

En `docs/state/CERTIFICATIONS.md`, actualizar el estado del ítem correspondiente:

```markdown
## P0-2 — Reimpresión desde KDS/cocina/barra
**Estado:** ✅ CERTIFIED — 2026-07-XX
**Evidencia:** Video sesión campo, order_id XXXX, audit log screenshot
```

**Regla:** No marcar como CERTIFIED sin evidencia de campo. Ver criterios en `docs/feos/EXECUTION-PLAN.md`.

---

## Ejemplo real: r1_add_items

Este fue el proceso para `dashboard-app/sql/r1_add_items.sql` (commit `1a0e1db`):

1. **Diseño:** Append-only, idempotente por `item.id`, sin OCC. Ver `docs/constitution/CONCURRENCY.md`.
2. **Archivo:** `dashboard-app/sql/r1_add_items.sql`
3. **Orden de deploy:** SQL en Supabase → commit del código → push → Vercel deploy
4. **Verificación antes:** Compilar en SQL Editor, revisar `prosecdef`, revisar ACL
5. **Smoke test:** `SELECT r1_add_items('nonexistent',...) → ORDER_CLOSED_OR_NOT_FOUND`
6. **Rollback:** `DROP FUNCTION r1_add_items(text, text, jsonb)` (función nueva, no hay versión anterior)
7. **Evidencia:** Hash del commit en `docs/state/BUGS.md` entrada POS-02

**Pasos exactos en Supabase:**
```
1. Supabase Dashboard → SQL Editor → New query
2. Pegar el contenido completo de dashboard-app/sql/r1_add_items.sql
3. Run
4. Ejecutar verificación: SELECT proname, prosecdef FROM pg_proc WHERE proname = 'r1_add_items';
5. Ejecutar smoke test: SELECT r1_add_items('nonexistent', 'nonexistent', '[{"id":"t1"}]'::jsonb);
6. Confirmar resultado: {"ok": false, "error": "ORDER_CLOSED_OR_NOT_FOUND"}
```
