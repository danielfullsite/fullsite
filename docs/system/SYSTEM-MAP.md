# SYSTEM MAP — el camino REAL de cada dominio

> **INTERNO.** Nombra, por dominio, los caminos que saltan cada contrato. No publicar sin decisión
> explícita — ver [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md) §4.
>
> **Corte:** 2026-09-18 · `origin/main` = `10017cf9` · base AMALAY leída por introspección.
>
> **Esto NO es un diagrama ideal.** Es el camino que cada dominio usa de verdad, con sus atajos.
> Para *cómo funciona* cada componente, usa `docs/COMO-FUNCIONA-TODO.md` (PR #340). Aquí sólo está
> lo que ese documento no cubre: **por dónde viaja una escritura y quién puede saltarse el contrato.**

---

## 1 · LAS CAPAS, Y QUIÉN LAS ATRAVIESA

```
  ① RENDERER (Next.js en navegador o dentro de Electron)
        │
        ├─② IndexedDB `fullsite_pos` / localStorage      ← estado local
        │
        ├─③ supabase-fetch-patch.ts  ── CHOKE POINT DEL RENDERER
        │     inyecta x-fullsite-tenant · reenruta al proxy si hay shiftToken
        │     ⚠ NO cubre el tráfico de Electron MAIN ni de Pedro
        │
        ├─④ PEDRO :7717  (sólo rol server_pos)          ← NDJSON + fsync + WS
        │     CoreEventStore.processCommand · print-queue · ws-hub
        │
        ▼
  ⑤ API / PROXY / RPC  (Vercel)
        ├─ /api/pos/*         withPOSAuth
        ├─ /api/pos/db/*      proxy PostgREST con service key + ALLOW
        └─ RPC SECURITY DEFINER
        ▼
  ⑥ POSTGRES
        ▼
  ⑦ RECIBO / CONCILIACIÓN
```

**La capa ③ es un choke point del *renderer*, no del sistema.** El tráfico que nace en Electron MAIN
o en Pedro no pasa por ahí. Cualquier instrumentación que se ponga sólo en ③ tendrá un hueco del
tamaño de Pedro.

---

## 2 · CAMINO REAL POR DOMINIO

`✓` = lo usa · `–` = no lo toca · `⚠` = camino alternativo que salta el contrato.

| Dominio | ① | ② | ③ | ④ Pedro | ⑤ | ⑥ | ⑦ recibo | Camino real, en una línea |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **ORDERS** | ✓ | ✓ | ✓ | ✓ | `/api/pos/save-order` → `r1_save_order_idempotent` | ✓ | ✓ `pos_save_operations` | El único dominio con la cadena completa **⚠ `pos_orders` está en `ALLOW`: existe un `PATCH` REST que salta el RPC** |
| **CASH** | ✓ | ✓ | ✓ | ✓ `financial-domain` | **proxy REST directo**, mínimo `cajero` | ✓ | **✗ no hay RPC de recibo** | Es dinero y viaja por el camino más débil del sistema. `client_op_id` existe en la base desde D-01, pero el escritor sólo vive en la rama `p0a` |
| **INVENTORY** | ✓ | ✓ | ✓ | – | `/api/pos/inventory/movement` → `pos_record_inventory_movement` | ✓ | ✓ (0 filas) | Dos caminos al mismo efecto. **⚠ `pos_inventory` y `pos_inventory_movements` en `ALLOW`, nivel gerente: `PATCH` directo salta RPC, advisory lock y recibo.** 2 de 4,179 movimientos usan el contrato |
| **KDS** | ✓ | – | ✓ | ✓ **autoritativo en LAN** | `/api/pos/kitchen` | ✓ | – | En LAN manda Pedro por WS. La nube es proyección. Dos UIs distintas: `kds-ui.html` local y `/pos/cocina` |
| **TABLES** | ✓ | localStorage | ✓ | ✓ `MESA_LOCK` 30 s | proxy | ✓ | – | El bloqueo es **sólo LAN**. Sin Pedro, dos terminales pueden abrir la misma mesa sin verse |
| **PRINTING** | ✓ | ✓ `print_jobs` | – | ✓ **autoritativo** | – (`pos_print_jobs` es copia) | ✓ | cola local | Nunca sale a la nube para imprimir. `printed` = el spooler aceptó. `uncertain` sólo se resuelve en LAN |
| **AUTH** | ✓ | credenciales preparadas | ✓ | ✓ `actor-authority` | `/api/pos/pin` | ✓ | – | Con Caja encendida el permiso lo firma Pedro. Sólo un 401 juzga el PIN |
| **OFFLINE/SYNC** | ✓ | ✓ `sync_queue` | ✓ | ✓ | replay por `APP_API` **o** `SUPABASE_REST` | ✓ | parcial | El transporte del replay lo decide el ítem de la cola: por `APP_API` pasa por el RPC, por `SUPABASE_REST` no |
| **PEDRO → nube** | – | – | – | ✓ `outbox.js` | `pos_local_events` | ✓ | verificación de fila | **Escrito y jamás ejecutado en producción: 0 filas** |
| **PAYMENTS** | ✓ | ✓ `recoverable-operation` | ✓ | ✓ | `/api/mp-point`, `/api/clip-pinpad` | ✓ | ✗ `pos_payment_attempts` no existe | El efecto externo ocurre fuera de nuestra transacción y no hay dónde registrar «resultado desconocido» |
| **DELIVERY** | – | – | – | puente a KDS | webhooks `/api/integrations/*` | ✓ | `integration_audit_log` | Único dominio con `correlation_id` real y DLQ |
| **FLEET** | – | – | – | ✓ emite | POST REST | `local_server_heartbeats` | – | **0 filas: la capa ⑥ nunca recibió nada** |
| **AI/AGENTS** | ✓ lectura | – | ✓ | – | `/api/agents/*`, `/api/analyst` | ✓ | `agent_runs` | Las acciones reusan endpoints humanos ⇒ heredan auth y auditoría |
| **SETTINGS** | ✓ | localStorage | ✓ | `config.json` | `/api/platform/*` | ✓ | `platform_audit_log` | Único dominio donde toda escritura deja auditoría inmutable por trigger |

---

## 3 · STATIC PATH ≠ RUNTIME PATH

Tres casos verificados donde leer el código lleva a la conclusión equivocada:

**3.1 · El renderer no siempre habla con Supabase.** `supabase-fetch-patch.ts` detecta un
`pos_shift_token` sin sesión de Supabase y **reescribe la llamada** hacia `/api/pos/db`. Un
`grep` de `supabase.from(...)` sugiere REST directo; en runtime pasa por el proxy con otra
autorización y otro conjunto de reglas.

**3.2 · Electron MAIN no pasa por el choke point del renderer.** Pedro y el proceso principal
hablan con la nube por su cuenta (`outbox.js`, `business-outbox.js`, `telemetry/heartbeat.js`). Una
cabecera inyectada en ③ **no aparece** en ese tráfico.

**3.3 · La cola offline elige transporte por ítem.** `ReplayTransport` puede ser `APP_API` o
`SUPABASE_REST`. El mismo tipo de escritura puede pasar o no por el RPC según cómo se encoló. Leer
el callsite no dice cuál se usó: hay que leer el ítem.

---

## 4 · HUECOS DEL MAPA — lo que NO se verificó

| Hueco | Por qué importa |
|---|---|
| **Nada se ejecutó en runtime.** Todo es lectura de código más introspección de la base | Este mapa es una hipótesis con dirección, no una traza |
| **No se observó tráfico real de Electron MAIN** | §3.2 se deduce del código; no se midió |
| **No se auditaron las 116 rutas `/api/*`** una por una | Puede haber caminos alternativos no listados |
| **PURCHASING, SUPPLIERS, FLEET y CERTIFICATION no tienen tráfico real que observar** | 0 filas o tenant de laboratorio |
| **El camino de traslado (`r1_transfer_item_atomic`) no se auditó** | `BYPASS_EXISTS = UNKNOWN` |
| **`pos_market_movements` / `pos_market_stock` no están en `ALLOW`** y no se determinó su camino vivo | Podría ser RPC, podría estar muerto |

---

## 5 · LA CONCLUSIÓN DEL MAPA

> **Ningún dominio tiene un camino único a su propio efecto.**

Orders tiene el contrato más completo y aun así `pos_orders` es escribible por REST. Inventory tiene
el RPC más maduro del repo y la puerta de gerente sigue abierta. Cash es dinero y no tiene recibo.

Eso es **INV-07** de
[`docs/architecture/OPERATION-IDENTITY-AND-RECEIPTS.md`](../architecture/OPERATION-IDENTITY-AND-RECEIPTS.md),
visto desde el otro lado: no falta construir contratos, falta **cerrar los caminos que los rodean**.
