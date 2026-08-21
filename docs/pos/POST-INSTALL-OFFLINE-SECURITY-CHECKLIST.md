# POST-INSTALL — Offline & Security Closure Checklist

> **Estado:** DECISIÓN CONGELADA 2026-08-20. Este documento cierra el debate (3 rondas de
> análisis + verificación en código/BD) y es el **checklist ejecutable** post-instalación.
> No es una opinión más. Regla base: **no se toca offline ni código sensible antes de pasar
> la instalación de AMALAY (lunes 2026-08-24).**

Origen: síntesis de la revisión de ingeniería sobre "offline total" + auditoría RLS en vivo.
Fuentes de verdad relacionadas: `docs/state/OPEN-ITEMS.md` (OP-50), `docs/DECISION-BRAIN.md`,
`OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`, `docs/offline/` (protocolo v1.0 congelado).

---

## 1. Estado congelado antes de la instalación

- **Offline probado en campo:** caída de internet a media operación → Caja guarda+imprime,
  KDS recibe con la caja offline. Es el caso del ~95%. **Funciona.**
- **NO tocar antes/durante la instalación:** Electron, KDS, colas, turno, Service Worker,
  print bridge, el proxy `/api/pos/db`, RLS.
- **Esta semana solo:** checklist + captura de evidencia de la instalación. Cero código.
- **Política operativa del piloto (sin código):**
  - Cae internet a media comida → seguir offline.
  - El restaurante **amanece sin internet** → esperar conexión para **abrir turno**
    (mitiga el defecto de cold-start sin hotfix apresurado; ver §3).
  - Contingencia excepcional → operación manual temporal.

---

## 2. Evidencia RLS EN VIVO (prod), separada de las migraciones

**Por qué separada:** las migraciones canónicas contienen `USING(true)` y policies permisivas
de `anon` que **no reflejan** lo instalado. Lo único que certifica es `pg_policies` en prod.

- **Proyecto:** `qjiomlvudfmzuvqvhwpk` (AMALAY prod) · **Fecha:** 2026-08-20 · **Vía:** MCP `execute_sql` (read-only).
- **Método:** `select tablename, policyname, cmd, roles, qual (USING), with_check from pg_policies`.

### 2.1 Tablas sensibles (dinero / PII / catálogo) — CROSS-TENANT CERRADO

| Tabla | `service_role` (ALL) | `authenticated` SELECT/UPD/DEL | `authenticated` INSERT (WITH CHECK) |
|---|---|---|---|
| `pos_orders` | USING/CHECK `true` | scoped | `user_has_client_access(client_id) AND turno_id IS NOT NULL` |
| `pos_cierres` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |
| `pos_turnos` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |
| `pos_cash_movements` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |
| `pos_staff` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |
| `pos_menu_items` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |
| `pos_ingredients` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |
| `pos_audit_log` | USING/CHECK `true` | scoped | `user_has_client_access(client_id)` |

**Conclusión (con evidencia):** en estas tablas, un usuario `authenticated` del tenant A **no
puede leer, insertar, actualizar ni borrar** datos del tenant B — RLS lo bloquea en las 4
operaciones. El `USING(true)` es **exclusivo de `service_role`** (backend, correcto).
`getClientId()` client-side **no tiene autoridad**: la RLS scoped lo ignora (un no-miembro
recibe 0 filas / 403 sin importar lo que diga localStorage). **La alarma de lectura
cross-tenant de las rondas previas NO aplica a estas tablas.**

### 2.2 Excepción encontrada — `pos_customers` (escritura bloqueada, no cross-tenant)

`pos_customers` solo tiene 2 policies: `svc_pos_customers` (ALL, service_role) y
`authread_pos_customers` (SELECT, authenticated, scoped). **No tiene policy de escritura para
`authenticated`.** Consecuencia:
- Lectura autenticada: OK (scoped) — el CRM ya carga clientes tras el fix `authHdrs()` (`7c67c2da`).
- **Escritura autenticada: BLOQUEADA por RLS** (falta INSERT/UPDATE/DELETE policy). Por eso
  `markContacted` / alta / edición de cliente en `/crm` **aún no persisten** aunque usen el
  token de sesión. El fix de OP-44 arregló la lectura, **no la escritura**. Ver §3, item CRM.

### 2.3 Alcance NO cubierto por esta evidencia (honesto)

- Solo se auditaron **9 tablas sensibles**. Un barrido completo de TODAS las tablas
  (¿alguna con `USING(true)`/permisiva para `authenticated`?) queda pendiente (§3, aislamiento).
- No se ejecutó aún la **prueba negativa formal** A→B (evidencia predice que pasa, falta correrla).

---

## 3. Pendientes confirmados (post-lunes)

| # | Trabajo | Tipo | Notas |
|---|---|---|---|
| T1 | **Turno offline: apertura POST / cierre PATCH con filtro exacto** | Integridad datos | Una sola cola canónica (eliminar la vieja que no conserva método HTTP → asume PATCH). Cierre no debe permitir PATCH amplio. |
| T2 | **ORDER_SENT durable en el emisor** | Cero comandas perdidas | Outbox LAN (IndexedDB) en Entrada; mismo `command_id` en reintentos; borrar solo tras ACK de Caja; recuperar tras reinicio de Entrada/Caja. UI: "guardado" vs "en cocina". |
| T3 | **Dinero offline certificado** | Riesgo económico | Cobro/cancelación/reapertura/cierre idempotentes; doble-clic sin doble cobro; reconexión sin duplicados; conciliación exacta o **bloqueo visible** (nunca resolver dinero en silencio). |
| T4 | **`pos_customers`: policy de escritura autenticada** (o rutear escritura por endpoint server-side) | Funcional CRM | Sin esto, OP-44 (recuperación) y el CRM en general no escriben. Patrón preferido: endpoint server-side con service_role (como `/api/owner/staff`), o policy INSERT/UPD/DEL con `WITH CHECK user_has_client_access`. |
| T5 | **OP-50: authz por operación/rol en `/api/pos/db`** | Intra-tenant (no cross-tenant) | El proxy corre como service_role e inyecta `client_id` en código → cross-tenant OK. Falta: allowlist de lectura, deny-by-default en escritura, sacar del proxy genérico staff/PIN/auditoría/inventario/recetas/mesas/cierres/dinero; probar que un mesero no puede mutarlas por URL directa. |
| T6 | **Aislamiento: barrido completo + prueba negativa A→B** | Cero acceso cruzado | Auditar `pg_policies` de TODAS las tablas (no solo las 9); migrar consumidores de `getClientId()` client-side a tenant server-resuelto (quitarle autoridad, no borrarlo); prueba negativa formal: usuario A intenta CRUD de B → 0 filas / 403 en todas. |

---

## 4. Orden de ejecución post-lunes

1. T1 — Turno POST/PATCH + cola canónica.
2. T2 — ORDER_SENT durable.
3. T3 — Dinero offline certificado.
4. **Congelar versión "Offline Certified".**
5. T4 — Escritura CRM (`pos_customers`).
6. T5 + T6 — **Aislamiento + authz certificados ANTES del cliente #2 con datos reales.**
7. Cliente #2 — reusar Golden Skeleton / Provisioning Engine (terminar y **certificar, no reconstruir**); smoke test Minute 0.

---

## 5. Criterios de aprobación por gate

- **Turno (T1):** pruebas que demuestran que apertura siempre es POST idempotente y que
  **ningún replay** produce un PATCH sin filtro exacto.
- **ORDER_SENT (T2):** matar Entrada / Caja a media orden → al reiniciar, la orden llega al
  KDS sin duplicar; la cola termina en cero.
- **Dinero (T3):** doble-toque y replay = **cero** doble cobro; al reconectar, `suma(caja) =
  suma(órdenes) = suma(pagos)` exacta, o se detiene y muestra el conflicto.
- **CRM (T4):** "marcar contactado" y alta/edición persisten y sobreviven recarga.
- **OP-50 (T5):** un shift token de rol `mesero` recibe 403 al intentar mutar tablas sensibles
  por URL directa al proxy.
- **Aislamiento (T6):** prueba negativa A→B pasa en TODAS las tablas (0 filas / 403), con
  evidencia (`pg_policies` completo + log de la prueba).
- **Cold-start:** definición de "cerrado" = cero órdenes/comandas perdidas, cero cobros
  duplicados, arranque en frío funcional, colas a cero al reconectar, sin fallos silenciosos.

### Certificación física (money + turno + ORDER_SENT) — requiere estar en AMALAY

1. Arranque del día sin WAN · 2. Caída de WAN a media orden · 3. Caja apagada 60s · 4. Reinicio
de Entrada antes del ACK · 5. Reinicio del KDS · 6. Impresora desconectada+recuperada · 7. Dos
POS enviando simultáneo · 8. Cobro repetido por doble toque · 9. Cierre + reconexión ·
10. Cola final en cero + conciliación exacta.

**Estimación realista:** 4–7 días efectivos de código/pruebas + **2–4 visitas físicas** a AMALAY
(el offline solo se debuggea físicamente — desconectar internet mata TeamViewer). **Calendario:
2–4 semanas condicionado al acceso.** UPS para caja/switch/router/impresoras = parte de la solución.

---

## 6. Trabajo explícitamente DIFERIDO (por evidencia de demanda, no ahora)

- Certificación completa de **cold-start** (amanecer sin internet, operar todo el día, cobrar,
  cerrar, sincronizar). Los **defectos** de turno (T1) sí se corrigen ya; la certificación total no.
- **Fleet management** de dispositivos, canary por grupos, rollback remoto, heartbeats.
- **Alta disponibilidad local:** failover entre cajas, elección de líder, standby, locks distribuidos.
- Reescribir todo bajo **event sourcing**; Pedro como autoridad total de cada entidad.
- **DLQ** sofisticada / panel de conflictos general; arquitectura regional anticipada.

> Motivo: son la arquitectura de Fullsite a 2 años. Con 1→2 restaurantes, el cuello es aterrizar
> y vender, no construir un sistema distribuido por sucursal. La clonabilidad nace de la **misma
> célula aburrida instalada N veces + un buen control plane**, no de hacer cada restaurante sofisticado.

---

## 7. Regla dura

**El cliente #2 NO recibe datos reales hasta pasar los gates de: (a) Offline Certified, (b)
Aislamiento + authz (T5+T6).** El gate no es un número de cliente — es "**segundo tenant con
datos reales en el proyecto compartido**". En cuanto existan dos, el cross-tenant deja de ser
deuda futura y se vuelve riesgo presente.

---

## Nota de método (por qué este doc existe)

3 rondas de análisis (2 IAs + revisión humana) convergieron en este plan; el valor no fue el
plan sino **aterrizarlo en código/BD**: la verificación en `pg_policies` **desinfló una alarma
cross-tenant que no existía** y **descubrió un gap real** (escritura CRM). Regla: **evidencia >
elocuencia** — de cualquier fuente, incluidas las IAs. Todo hallazgo de RLS/authz se certifica
contra prod, no contra migraciones.
