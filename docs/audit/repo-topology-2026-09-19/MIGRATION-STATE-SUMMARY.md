# MIGRATION STATE — FILE ≠ LEDGER ≠ EFFECT

> 2026-09-19 · Read-only. No se aplicó ninguna migración ni se escribió nada en la BD.
> Fuentes: archivos en `origin/main@10a1caa7` y en todas las refs · ledger vía MCP
> `supabase-amalay` (`list_migrations`) · efecto vía `pg_class` / `pg_attribute`.

## Por qué se usó `pg_catalog` y no `information_schema`

`information_schema` **filtra por privilegios**: una tabla existente sobre la que el rol no
tiene permisos simplemente no aparece, y se lee igual que "no existe". La primera pasada dio
falsos negativos por eso. Todos los resultados de EFFECT de este documento se repitieron
contra `pg_class` / `pg_attribute`, que no filtran.

---

## Conteos

```
Migraciones en origin/main ............... 37 normales + 13 PENDIENTE_ + 1 README = 51
Migraciones en ramas y NO en main ........ 14 normales + 13 PENDIENTE_ = 27
Entradas en el ledger de AMALAY prod ..... 54
Archivos ROLLBACK ........................ 1  (PENDIENTE_20260917200000_append_idempotency_ROLLBACK.sql)
```

---

## A) El ledger dice APLICADA — ¿dónde está el archivo?

### A1 · Aplicada, pero el archivo en main sigue marcado `PENDIENTE_` — **1** ⚠ DRIFT

| Ledger | Archivo en main |
|---|---|
| `20260915181654 tenant_provisioning_atomic` | `PENDIENTE_20260910070000_tenant_provisioning_atomic.sql` |

El prefijo `PENDIENTE_` es la convención del repo para "todavía no aplicada". Aquí miente:
ya corrió en producción el 2026-09-15. Cualquiera que lea el árbol concluirá lo contrario.

### A2 · Aplicada, pero el archivo NO está en main (sólo en otra rama) — **6** ⚠ DRIFT

| Ledger | Archivo, y dónde vive |
|---|---|
| `20260826212117 cleanup_orders_transaccional` | `20260826200000_…sql` — sólo en rama |
| `20260826213930 cleanup_orders_revocar_authenticated` | `20260826213000_…sql` — sólo en rama |
| `20260827012058 cleanup_orders_protocolo_tres_fases` | `20260826230000_…sql` — sólo en rama |
| `20260829205440 chat_logs_veredicto_para_evals` | `20260829000000_…sql` — sólo en rama |
| `20260909035251 ops_daily_desde_pos_no_materializar` | `20260908140000_…sql` — sólo en rama |
| `20260909035305 ocm_daily_no_materializar` | `20260908210000_…sql` — sólo en rama |

Seis cambios **viven en la base de datos de producción y no están en `main`**. Si el repo se
clona de cero y se levanta un tenant nuevo, esos seis no se aplican. Es el mecanismo exacto
por el que un clon nace distinto de AMALAY.

### A3 · Aplicada sin archivo en NINGUNA rama — **26**

`create_wansoft_recipes`, `pos_inventory_movements_read_policy`,
`rls_anon_to_authenticated_hardening`, `revoke_pos_staff_anon_read`,
`fix_inventory_rls_missing_policies`, `delivery_orders_select_policy`,
`pos_orders_customer_name_order_number`, `add_recipe_ref_to_pos_menu_items`,
`create_pos_mesas`, `create_pos_sessions`, `guard_08_cierre_ordenes_abiertas`,
`add_refresh_token_enc_to_integration_providers`, `p1_d12_clients_support_email_plan`,
`p1_d03_amalay_station_routing`, `p1_d09_remove_client_id_defaults`,
`p1_d10a_integration_store_mappings`, `skel04_b0_critical_security`, `platform_admins_v1`,
`create_superadmin_daniel_prod`, `cerrar_politicas_permisivas_authenticated`,
`agent_events_admite_todos_los_agentes`, `cleanup_begin_carrera_unique_violation`,
`pos_cierres_folio_z_consecutivo`, `freno_auto_update_versiones_bloqueadas`,
`platillos_top_determinista`, `ops_daily_no_cuenta_la_orden_dividida`.

Aplicadas por el dashboard de Supabase o por MCP, no desde el repo. Varias son de seguridad
(`skel04_b0_critical_security`, `rls_anon_to_authenticated_hardening`,
`revoke_pos_staff_anon_read`) — **el repo no contiene el DDL que hoy protege producción.**

> Algunas son anteriores a que existiera `supabase/migrations/` y estarían absorbidas por
> `00000000000000_baseline_esquema.sql`. No lo verifiqué archivo por archivo: sería necesario
> leer el baseline completo y comparar objeto por objeto. Lo dejo como **NO VERIFICADO**.

---

## B) El archivo está en main — ¿qué dice el ledger?

### B1 · Normales (sin prefijo `PENDIENTE_`) sin entrada en el ledger — **18** ⚠ AMBIGÜEDAD

```
00000000000000_baseline_esquema.sql          20260829_turnos_por_sucursal.sql
20260811010000_platform_admin_lockdown.sql   20260831010000_secure_agent_results_backup.sql
20260811020000_platform_settings_feature_flags.sql
20260811030000_platform_audit_log.sql        20260831011000_pos_turno_replay_and_numbering.sql
20260826130000_agent_results_data_a_objeto.sql
20260826140000_wansoft_data_a_objeto_o_arreglo.sql
20260826_agent_events_admite_agentes.sql     20260902120000_client_locations_timezone.sql
20260826_politicas_permisivas.sql            20260909030000_un_turno_abierto_por_restaurante.sql
20260827120000_pos_terminals_por_sucursal.sql
20260827130000_pos_terminal_enrollments.sql  20260909120000_ops_daily_por_dia_de_venta.sql
20260827150000_pos_turnos_por_sucursal.sql   20260918210000_tenant_source_authority.sql
```

El nombre sin prefijo comunica "ya aplicada". El ledger no las conoce. **Verifiqué el EFFECT
real de seis de ellas:**

| Objeto que crea la migración | ¿Existe en AMALAY prod? | Veredicto |
|---|---|---|
| tabla `pos_terminals` (`20260827120000`) | **NO** | HECHO — no aplicada |
| tabla `pos_terminal_enrollments` (`20260827130000`) | **NO** | HECHO — no aplicada |
| tabla `tenant_source_authority` (`20260918210000`) | **NO** | HECHO — no aplicada |
| extensión `btree_gist` (la anterior la requiere) | **NO** | HECHO — no aplicada |
| columna `client_locations.timezone` (`20260902120000`) | **NO** | HECHO — no aplicada |
| índice `pos_turnos_uno_abierto_por_restaurante` (`20260909030000`) | **NO** | HECHO — no aplicada |
| tabla `agent_results_respaldo_jsonb` (`20260831010000`) | SÍ | aplicada (fuera del ledger) |
| tabla `platform_audit_log` (`20260811030000`) | SÍ | aplicada (fuera del ledger) |
| función `is_platform_admin` (`20260811010000`) | SÍ | aplicada (fuera del ledger) |

**Seis migraciones de main, sin prefijo `PENDIENTE_`, no tienen efecto en la base de datos de
producción.** Tres sí lo tienen aunque el ledger las ignore.

### B2 · `PENDIENTE_` sin ledger — **13** ✔ coherente

```
PENDIENTE_20260904000000_cuentas_divididas_modelo_durable.sql
PENDIENTE_20260905010000_caja_business_materializer.sql
PENDIENTE_20260910020000_scoped_proxy_upsert.sql
PENDIENTE_20260910030000_proxy_child_scope.sql
PENDIENTE_20260910040000_una_cuenta_activa_por_mesa.sql
PENDIENTE_20260910080000_caja_folio_por_turno.sql
PENDIENTE_20260911010000_guardas_turnos_y_deducciones.sql
PENDIENTE_20260914120000_pos_staff_pin_hash.sql
PENDIENTE_20260917200000_append_idempotency.sql
PENDIENTE_20260917200000_append_idempotency_ROLLBACK.sql
PENDIENTE_20260918210000_purchase_order_atomic.sql
PENDIENTE_20260919050000_purchase_numeros_finitos.sql
PENDIENTE_20260919060000_inventario_se_crea_al_moverse.sql
```

Verificado que `pos_staff.pin_hash` y `pos_staff.pin_hash_v` **no existen** en prod, coherente
con su estado `PENDIENTE_`. Pero los PRs #411 y #412 ("F0/F1 — columnas pin_hash y pin_hash_v")
**ya están mergeados en main y desplegados desde el 2026-09-14**. Código de hash de PIN vivo
en producción contra columnas que no existen.

---

## C) Migraciones en ramas y no en main

### Normales (14)
```
20260826200000_cleanup_orders_transaccional.sql        ← aplicada en prod (A2)
20260826213000_cleanup_orders_revocar_authenticated.sql ← aplicada en prod (A2)
20260826230000_cleanup_orders_protocolo_tres_fases.sql  ← aplicada en prod (A2)
20260826_recetario_01_guardianes.sql
20260826_recetario_02_ordenes_y_triggers.sql
20260827140000_pos_location_stations.sql
20260829000000_chat_logs_veredicto_para_evals.sql       ← aplicada en prod (A2)
20260908140000_ops_daily_desde_pos_no_materializar.sql  ← aplicada en prod (A2)
20260908210000_ocm_daily_no_materializar.sql            ← aplicada en prod (A2)
20260912120000_order_id_del_ledger_es_text.sql
20260912130000_integration_dlq_replay_state.sql
20260914210000_ocm_daily_security_invoker.sql           ← duplica la de main (20260915040000)
20260914210100_agent_runs_solo_plataforma.sql
20260914210200_guardia_vistas_expuestas.sql
```

### `PENDIENTE_` sólo en ramas (13)
`transfer_item_atomico`, `inventory_movement_atomic`, `inventory_cancelled_reconcile`,
`merge_y_cobro_conservan_consumo` (las cuatro **ya aplicadas** en prod y promovidas a
normales en main), `kds_item_delta_atomico`, `order_id_del_ledger_es_text`,
`reopen_order_atomico`, `time_clock_atomico`, `adjust_market_atomico`,
`integration_dlq_replay_lease`, `cancel_item_atomico`, `catalogo_de_precios_versionado`,
`precios_incluyen_iva`.

Dos más existen **sólo sin commitear** en `.codex/worktrees/product-closure-20260905`:
`PENDIENTE_20260908010000_inventory_movement_atomic.sql` y
`PENDIENTE_20260908020000_pos_identity_and_write_guards.sql`. Un `git clean` ahí las borra.

---

## D) Funciones / RPCs aplicados a mano

`provision_tenant_atomic` (o equivalente `%provision%`) existe en la BD; el ledger lo registra
como `20260915181654 tenant_provisioning_atomic`, cuyo archivo en main sigue `PENDIENTE_`.
Es el mismo caso A1 visto desde el otro lado.

Memoria del proyecto registra además que **el MCP "read-only" de Supabase puede escribir**
(`project_agent_results_jsonb_cerrado`). Eso convierte cualquier sesión de agente en un
aplicador potencial de DDL sin pasar por el repo. **No lo probé en esta auditoría** —
probarlo requeriría escribir.

---

## E) Deriva entre entornos

| Objeto | AMALAY prod | staging |
|---|---|---|
| `pos_terminals` | **NO existe** | **SÍ existe** |
| `pos_terminal_enrollments` | NO | NO |
| `tenant_source_authority` | NO | NO |
| `client_locations.timezone` | NO | NO |
| `pos_staff.pin_hash` | NO | NO |

Staging tiene una tabla que producción no tiene. **Un test verde en staging no prueba nada
sobre prod para todo lo que toque terminales.**

---

## Resumen de ambigüedades

| # | Ambigüedad | Conteo | Severidad |
|---|---|---:|---|
| M-1 | Migraciones de main sin `PENDIENTE_` cuyo objeto NO existe en prod | 6 verificadas | **P0** |
| M-2 | Aplicadas en prod cuyo archivo no está en main | 6 | **P1** |
| M-3 | Aplicadas en prod sin archivo en ninguna rama | 26 | **P1** |
| M-4 | Archivo `PENDIENTE_` que en realidad ya se aplicó | 1 | P1 |
| M-5 | Aplicadas fuera del ledger (efecto sin registro) | ≥3 verificadas | P1 |
| M-6 | Migraciones duplicadas con distinto timestamp | 2 pares | P3 |
| M-7 | `PENDIENTE_` sin commitear en un worktree | 2 | **P0** (pérdida) |
| M-8 | Deriva de esquema prod vs staging | 1 tabla | P1 |
| M-9 | Sin pipeline automatizado de migraciones | — | P1 |

**No apliqué nada. No propongo aplicar nada sin antes leer cada archivo completo** — la regla
del proyecto sobre migraciones existe porque el bloque de `grant` va al final y
`create or replace view` resetea permisos.
