# OCM — Autoridad de fuente por inquilino y fecha

> **Estado:** implementado en rama, **migración NO aplicada a producción**. 2026-09-18.
> **Migración:** `supabase/migrations/20260918210000_tenant_source_authority.sql`
> **Guardianes:** `dashboard-app/src/__tests__/ocm-source-authority.test.ts` ·
> `.github/scripts/test_migraciones_no_exponen_a_anon.py`

---

## 1. El defecto que cierra

`ocm_daily` unía dos alimentadores y desempataba con esta cláusula:

```sql
FROM hist h
WHERE NOT EXISTS (SELECT 1 FROM live l
                  WHERE l.client_id = h.client_id AND l.fecha = h.fecha)
```

**`live` (desde `pos_orders`) siempre ganaba; `hist` (desde `ops_daily`) sólo rellenaba
huecos.** Para un inquilino que todavía opera en su sistema anterior y sólo tiene órdenes
de prueba en el POS, esa precedencia está exactamente al revés.

Medido contra producción en sólo lectura el 2026-09-18:

| Fecha | `ocm_daily` publicó | Fuente autoritativa | Órdenes POS ese día |
|---|---|---|---|
| 2026-08-30 | $682.08 · 1 ticket | **$125,724.25 · 143 tickets** | 15 (1 cerrada) |
| 2026-08-31 | $1,756.24 · 3 tickets | **$56,787.00 · 75 tickets** | 9 (3 cerradas) |
| 2026-09-02 | $3,519.44 · 5 tickets | **$53,715.50 · 84 tickets** | 5 (5 cerradas) |
| 2026-09-13 | $150.80 · 1 ticket | **sin fila en ninguna fuente** | 3 (1 cerrada) |

`wansoft_daily` y `ops_daily` **coinciden exacto** en los tres días con dato, y también en
los 972 días normales ($79,138,465 en ambas).

```
RAW_SOURCE_CORRUPTION       = false   ← ninguna fuente está dañada
OCM_PUBLISHED_VALUE_INVALID = true    ← el defecto está en la vista
```

Y no estaba confinado al pronóstico: **todo consumidor de `ocm_daily`** —agentes, reportes,
pantallas— leyó esas cifras durante quince días.

---

## 2. El contrato

```
tenant_source_authority
  client_id · authoritative_source ('wansoft'|'fullsite') · mode
  effective_from · effective_to · reason · changed_by
```

**La autoridad se resuelve POR LA FECHA DEL DATO, no por el estado de hoy.** Ésa es la
propiedad entera: voltear el cutover mañana no reinterpreta los 976 días de ayer.

**`mode` y `authoritative_source` son columnas distintas a propósito.** La vista sólo
necesita lo binario; el guardián y el soporte necesitan la situación operativa. Una
restricción `CHECK` impide que se separen — un `shadow` con autoridad `fullsite` sería el
defecto escrito a mano.

**La restricción que carga el peso** es la exclusión por rango:

```sql
EXCLUDE USING gist (
  client_id WITH =,
  tstzrange(effective_from, coalesce(effective_to,'infinity'), '[)') WITH &&
)
```

Sin ella, dos filas vigentes vuelven ambigua la autoridad de una fecha, y una vista no
puede resolver una ambigüedad: elegiría una en silencio. **Ese es el modo de falla que
produjo este incidente**, y por eso la restricción es la pieza central y no un adorno.

### Por qué no se reutilizó una señal existente

| Señal | Qué tiene | Por qué no sirve sola |
|---|---|---|
| `clients.data_source` | La semántica correcta; ya se usa así en `recipe-sync/route.ts` | **No tiene fecha.** Voltearlo el día del cutover reinterpreta toda la historia |
| `pos_mutation_authority` | `cutover_at`, la forma exacta | `sale_authority` ('r1'/'legacy') gobierna qué ruta descuenta inventario, no qué sistema reporta. AMALAY tiene cutover ahí en julio y sigue operando en Wansoft |
| `pos_authority_transitions` | Máquina de estados con `cancelled_at` y `failure_reason` | Es para la autoridad de **escritura** del POS (Pedro ↔ nube), no la de reporte |

---

## 3. La regla de la vista

```
(fuente, modo) := AUTORIDAD(client_id, fecha)
  sin fila            → hueco, data_status = 'SIN_AUTORIDAD'
  dato en esa fuente  → publicar, data_status = 'OK'
  sin dato en esa fuente → hueco, data_status = 'SIN_DATO_EN_FUENTE_AUTORITATIVA'
```

**Nunca hay respaldo automático a la otra fuente.** La ausencia se publica como ausencia.
`data_status` viaja en la vista, no se infiere: un consumidor que recibe `NULL` sin motivo
acaba inventando su propio respaldo, y el problema reaparece un nivel más arriba.

**Dentro del mismo sistema sí hay precedencia** (`live` antes que `hist`), que es el
comportamiento de hoy y preserva a `lab-resto`, cuyos 365 cierres están marcados
`fullsite`. Lo que nunca ocurre es cruzar de sistema.

### ⚠️ La trampa de `CREATE OR REPLACE VIEW`

**Reemplaza los reloptions: lo que no se vuelve a declarar en el `WITH` se pierde sin
aviso.** Así se perdió `security_invoker` el 2026-09-09 y la vista corrió como `postgres`
(`rolbypassrls = true`) durante seis días, exponiendo los 9 restaurantes a cualquier
`authenticated`. Los ACL sí sobreviven; los reloptions no.

Por eso la migración declara explícitamente `security_invoker = on` y `NOT MATERIALIZED`
en cada vista, y repite el `REVOKE ... FROM anon`.

---

## 4. Máquina de estados del cutover

| | `legacy` | `shadow` | `parallel` | `cutover` | `fullsite` | `rollback` |
|---|---|---|---|---|---|---|
| Fuente autoritativa | wansoft | wansoft | wansoft | fullsite | fullsite | wansoft |
| Escritores | sólo el anterior | POS escribe, no se publica | ambos | sólo POS | sólo POS | POS escribe, no se publica |
| G1 | activo | **activo** | activo | activo | activo | activo |
| G2 | inactivo | informativo | **activo, es el instrumento** | alta | inactivo | alta |
| Precondición de entrada | inicial | Pedro sincronizando | ≥14 días en shadow sin G1 | **G2 < 5% durante ≥7 días** + corte cuadrado | ≥7 días en cutover sin alertas altas | alerta alta de G2 o decisión humana |

**Transiciones:** `legacy → shadow → parallel → cutover → fullsite`, con `rollback` desde
`parallel`, `cutover` o `fullsite`, y de `rollback` sólo se vuelve a `legacy`.
**Prohibido saltarse `parallel`:** es el único estado que produce la evidencia de que el
POS reproduce la realidad. Un cutover sin esa evidencia es una corazonada con fecha.

**Rollback no es deshacer.** Es un estado con su propia fila y su `reason`. Los días
vividos en `cutover` conservan `fullsite` como autoridad; reinterpretarlos exige una fila
correctiva explícita, no un efecto lateral.

**AMALAY hoy es `shadow`**, y se siembra retroactivo al inicio de la serie. Eso corrige los
cuatro días **sin tocar un solo dato de negocio**.

---

## 5. Alcance: por inquilino, no por sucursal

Decidido con evidencia positiva, no por omisión:

- De 25 filas en `client_locations`, **21 son de tres demos** sembrados cada uno en un solo
  día. El único cliente real tiene una sucursal.
- De **949 órdenes creadas desde el 2026-09-02, cero traen `location_id`**. El 96.6%
  histórico venía de un `DEFAULT` de columna que se eliminó ese día.
- `pos_turnos`, `pos_cierres`, `ops_daily` y `ocm_daily` **no tienen columna de sucursal**.
  `save-order/route.ts` documenta el incidente del 2026-08-31 por pedir un `location_id`
  que no existe en `pos_turnos`.
- `wansoft_daily.location_id` está poblado al 100% con **un solo valor distinto** en 975
  filas: es una constante, no una dimensión.

**Ruta de ampliación, si algún día hace falta:** `location_id` nulable (NULL = todo el
inquilino) e incluirlo en la exclusión. Cuesta un `ALTER TABLE` sobre una tabla chica, y
llegaría **después** del trabajo grande de poblar la sucursal en órdenes, turnos y cortes.
Nacer con una columna que nadie puede llenar obliga a inventar una regla de precedencia —
que es el defecto que este archivo cierra.

---

## 6. Certificación

Ejecutada en **sólo lectura** contra producción el 2026-09-18, reproduciendo la lógica de
la vista con la tabla de autoridad simulada en un CTE. La migración **no se aplicó**.

| Comprobación | Esperado | Medido |
|---|---|---|
| Días de AMALAY | 976 | **976** ✅ |
| Con dato | 975 | **975** ✅ |
| Huecos explícitos | 1 | **1** (2026-09-13, `SIN_DATO_EN_FUENTE_AUTORITATIVA`) ✅ |
| Días que recuperan Wansoft | 3 | **3** (125,724 · 56,787 · 53,716) ✅ |
| Recuperado en esos 3 días | +$230,269 | **+$230,268.99** ✅ |
| Cambio neto del total | — | **+$230,118.19** (los $150.80 del día sin fuente dejan de publicarse) |
| WAPE 91d | ~15.7% | **15.7%** (MAE $12,873, 176 días) ✅ |
| WAPE 91d antes | 18.4% | 18.4% |
| Otros inquilinos | sin cambio | **702 días, 0 huecos, delta $0** ✅ |

**Los dos números de dinero miden cosas distintas y los dos son correctos:** $230,269 es lo
que se recupera en los tres días; $230,118 es el cambio neto del total publicado, porque
además deja de publicarse el $150.80 del día que ninguna fuente conoce.

### Guardianes, verificados por fallo

| Guardián | Se vio fallar con | Resultado |
|---|---|---|
| `ocm-source-authority.test.ts` | El filtro de autoridad quitado | **2 de 10 fallan**, nombrando el filtro ausente |
| `test_migraciones_no_exponen_a_anon.py` | `security_invoker` quitado | **Falla**, nombrando las vistas |
| El mismo, endurecido | Un `CREATE OR REPLACE` posterior sin la opción | **Falla** — el guardián viejo daba 16/16 en verde |

**El endurecimiento del guardián de migraciones es un hallazgo aparte.** Buscaba el
`alter view ... set (security_invoker = on)` en **todo el corpus, sin mirar el orden**. Con
eso, un `CREATE OR REPLACE VIEW` fechado **después** del `alter` pasaba en verde — que es
exactamente el camino de la regresión del 2026-09-09. Ahora el `alter` sólo cuenta si viene
de una migración que ordena igual o después.

---

## 7. Qué falta antes de aplicar

1. **Aplicar la migración a Supabase.** No se hizo: el alcance de este trabajo se detiene
   antes del despliegue a la base compartida.
2. **Correr el bloque de verificación** del final de la migración (V1 a V5) contra la base
   ya migrada, y comparar con la tabla de §6.
3. **Enganchar G1 y G2 a una alerta real.** Hoy son vistas; quien las mire todavía no
   existe. Una vista que nadie consulta es documentación, no un guardián.
4. **Revisar los consumidores de `ocm_daily`** que hoy asumen que `ventas_dia` nunca es
   NULL. `data_status` es nuevo y el hueco también.

> **[Pendiente conocido, fuera de alcance]** La vista sigue resolviendo el día de negocio
> con `America/Monterrey` fijo, igual que antes. La zona horaria por inquilino
> (`getActiveTimezone`) es un follow-up que no se tocó aquí para no mezclar dos cambios.
</content>
