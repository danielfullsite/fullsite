# Runbook — flags de enforcement de fraude (grace → strict)

> **Qué es:** cómo activar el bloqueo real de los vectores de fraude del POS. Hoy las
> correcciones están desplegadas en modo **grace** (detectan/auditan pero **no bloquean**),
> a la espera de tráfico real. Este doc dice cuándo y cómo pasarlas a **strict**.
>
> **Fuente:** verificado en `origin/main` — `dashboard-app/src/lib/manager-approval.ts`,
> `src/app/api/pos/cancel-item/route.ts`, `src/app/api/pos/save-order/route.ts`. Ver
> [`../audit/AUDITORIA-FULL-2026-08-19.md`](../audit/AUDITORIA-FULL-2026-08-19.md) y
> [`../DECISION-BRAIN.md`](../DECISION-BRAIN.md).
>
> **Última actualización:** 2026-08-26 — ver [Medición del 2026-08-26](#medición-del-2026-08-26--el-dato-no-dice-lo-que-parece)
> y [Qué cierra realmente el flag](#qué-cierra-realmente-el-flag--y-qué-no) antes de voltear nada.

---

## Los flags

Son variables de entorno del dashboard (Vercel, prod = `app.fullsite.mx`). **Default: ausentes = grace.**

| Flag | Controla | Default (grace) | En `='true'` (strict) |
|---|---|---|---|
| `POS_APPROVAL_STRICT` | Reabrir cuenta pagada (`reopen-order`) vía `verifyManagerApproval` (minLevel 4 = gerente) | Permite + audita `legacy_no_approval` | Sin aprobación válida → **403** (`mode:'blocked'`) |
| `CANCEL_APPROVAL_STRICT` | Cancelar item (`cancel-item`) | Permite + audita `legacy_no_approval` | POST forjado sin aprobación → **403** |

**Nota sobre skimming (`save-order`):** hoy es **Fase 1 log-only** — recomputa el total desde los
items y si difiere del declarado (>$1) escribe `skimming_suspect` en `pos_audit_log`. **Nunca
bloquea.** La **Fase 2 (rechazo) NO está codificada aún** — no hay flag que la active; hay que
escribir el rechazo primero. El agente anti-fraude ya consume estos eventos (los reporta por mesero).

---

## Cuándo voltear a strict

**No antes del jueves.** El diseño grace→strict existe para observar tráfico real primero y no
romper la operación con un bug de enforcement. Secuencia:

1. Dejar correr el servicio real (desde el jueves) con los flags en grace.
2. Revisar `pos_audit_log` unos días:
   ```sql
   select action, count(*) from pos_audit_log
   where action in ('legacy_no_approval','skimming_suspect')
     and created_at > now() - interval '7 days'
   group by action;
   ```
3. Voltear a strict **cuando `legacy_no_approval` llegue a ~0 o sea 100% explicable** (significa
   que todos los POS ya mandan aprobación válida — voltear ya no rompe operación legítima).
4. `skimming_suspect`: cada evento es un ticket cobrado por menos que sus items → **investigar
   caso por caso** (cruzar `order_id` contra el arqueo del mesero). No requiere flag; ya alerta.

---

---

## Medición del 2026-08-26 — el dato no dice lo que parece

Corrida la consulta de arriba contra producción, read-only:

| Acción | Eventos | Último |
|---|---:|---|
| `legacy_no_approval` | **0** | — |
| `skimming_suspect` | 15 | 2026-08-26 |

Leído de frente, el criterio del paso 3 ya se cumple: `legacy_no_approval` está en ~0. **Pero no
por la razón que el criterio suponía.**

```
item_cancelled   →  7 eventos, el último 2026-07-24
order_cancelled  →  1 evento,  el último 2026-07-14
```

La instrumentación se desplegó el **2026-08-19**. Desde entonces **no ha habido ni una sola
cancelación ni reapertura**. El cero no mide cumplimiento: mide que no hubo tráfico. AMALAY sigue
operando en Wansoft — el cutover no ha ocurrido.

> El criterio original —"voltear cuando `legacy_no_approval` llegue a ~0"— asumía servicio real
> corriendo. Cumplirlo con la caja vacía no demuestra nada.

**Los 15 `skimming_suspect` eran falsos positivos**, todos: el detector restaba el IVA como si
fuera faltante. Corregido en `fix/skimming-iva`.

---

## Qué cierra realmente el flag — y qué no

Antes de voltear conviene saber qué compra, porque es menos de lo que parece.

El POS de hoy **siempre** manda una de las dos aprobaciones ([pos/page.tsx:2604](../../dashboard-app/src/app/pos/page.tsx)):

```ts
approval_token:   _approvalToken || undefined,
offline_approved: _approvalToken ? undefined : true,
```

Y el servidor acepta `offline_approved` **antes** de consultar el flag
([manager-approval.ts:31](../../dashboard-app/src/lib/manager-approval.ts)):

```ts
if (opts.offlineApproved === true) mode = 'offline_device_trust'
else if (process.env.POS_APPROVAL_STRICT === 'true') return { ok: false, mode: 'blocked' }
else mode = 'legacy_no_approval'
```

De ahí se siguen dos cosas:

**1. Voltear a strict no rompe nada.** El cliente actual nunca cae en la rama que el flag
bloquea. El riesgo de romper operación legítima es prácticamente cero — el único caso sería un
Service Worker cacheado tan viejo que no mande ninguno de los dos campos.

**2. Voltear a strict tampoco cierra el vector.** El flag sólo bloquea peticiones que omiten
**ambos** campos. Un mesero con sesión válida —que es exactamente el modelo de amenaza: las
rutas ya exigen `withPOSAuth`— cancela sin aprobación de gerente agregando un campo:

```json
{ "order_id": "...", "item_id": "...", "offline_approved": true }
```

Esto **no es un descuido**: es la decisión "Opción A, como Wansoft", tomada a propósito para que
cancelar funcione sin internet en un país 40% efectivo. Offline no hay servidor que valide el PIN
del gerente, así que se confía en el dispositivo.

Lo que sí faltaba es que estuviera **escrito**. Hasta hoy vivía sólo en un comentario de
`cancel-item/route.ts`; `docs/` no lo mencionaba en ningún lado, y este mismo runbook daba a
entender que voltear el flag cerraba el asunto.

### Recomendación

- **Voltear los dos flags a strict: sí**, cuando se quiera. Es gratis y bloquea la falsificación
  ingenua. Pero **no lo cuentes como el vector cerrado**.
- **Reevaluar el criterio después del cutover.** El dato útil es el de servicio real, no el de
  hoy.
- **El cierre de verdad requiere diseño**, no un flag: que la aprobación offline lleve algo que
  el dispositivo no pueda fabricar — una llave por dispositivo provisionada mientras hay red, y
  la aprobación firmada como `HMAC(llave_dispositivo, orden+gerente+timestamp)`, verificable
  cuando la cola sincroniza. Es la misma forma del token de cocina
  ([`ACTIVAR-KITCHEN-TOKEN.md`](ACTIVAR-KITCHEN-TOKEN.md)). No se hace en un flag y no se hace
  sin las pantallas y terminales en la mano.

---

## Cómo voltear (prod)

Los flags viven en el proyecto **raíz** de Vercel (el dashboard deploya desde la raíz, no desde
`dashboard-app/`). Setearlos y redeployar:

```bash
# Ver que existen / su valor actual
vercel env ls

# Activar strict (production)
vercel env add POS_APPROVAL_STRICT production      # valor: true
vercel env add CANCEL_APPROVAL_STRICT production   # valor: true

# Redeploy para que tome el nuevo env (o push a main dispara auto-deploy)
```

> Nota: no imprimir el `.env` real en chat/logs (regla de seguridad). Estos flags también
> convendría dejarlos como comentario en `dashboard-app/.env.example` para que sean visibles a
> quien clone el repo — pendiente (el archivo está protegido de edición automática).

---

## Cómo verificar tras voltear

1. **Prueba negativa (debe bloquear):** un POST forjado a `/api/pos/cancel-item` o
   `/api/pos/reopen-order` **sin** aprobación de gerente → debe responder **403** y auditar
   `mode:'blocked'` en `pos_audit_log`.
2. **Prueba positiva (no debe romper):** un cancelar/reabrir **con** aprobación de gerente real
   desde el POS → debe seguir funcionando normal.
3. Confirmar que `legacy_no_approval` deja de aparecer para tráfico nuevo.

---

## Rollback

Si strict rompe algo legítimo (algún POS viejo que no manda aprobación): **quitar el flag** (o
ponerlo distinto de `'true'`) y redeployar → vuelve a grace al instante. Cero migración, cero
estado. Luego investigar qué POS no mandaba aprobación y actualizarlo antes de reintentar.
