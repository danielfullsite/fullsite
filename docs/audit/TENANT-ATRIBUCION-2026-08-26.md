# Órdenes de AMALAY con el tenant equivocado — hallazgo del 2026-08-26

**No lo buscaba.** Salió de verificar una afirmación distinta: cuántas órdenes de AMALAY
existieron de verdad, más allá de lo que el libro de operaciones registra. Al barrer las
tablas que referencian `order_id` aparecieron **8 órdenes que siguen vivas** cuando
`pos_orders` no tiene ni una de `amalay`.

**Ninguno de los dos hallazgos está corregido.** Tocar filas de órdenes reales requiere tu
visto bueno, y son defectos de otra capacidad — van en su propia rama.

---

## Hallazgo 1 · Siete órdenes de AMALAY con `client_id` vacío

### HECHO

```sql
select count(*) from pos_orders where client_id is null or client_id = '';   -- 7
```

Las siete están atribuidas a `amalay` por otras tablas:

| Fuente | Qué dice |
|---|---|
| `pos_audit_log` | `client_id = 'amalay'` |
| `pos_print_jobs` | `client_id = 'amalay'` |
| Actores registrados | `Aldo Ruiz Ramirez` — mesero real de AMALAY |

Ventana: **2026-07-26 19:15:32 → 2026-07-27 00:19:17** (`America/Monterrey`). Unas 5 horas.
Antes y después, nada. Eso apunta a un despliegue o una sesión concreta, no a un goteo.

### Por qué importa

1. **Sobrevivieron a la limpieza del 25-ago** — precisamente porque el `DELETE` filtró
   `client_id=eq.amalay` y ellas no lo tienen. Están huérfanas: no son de nadie.
2. **Son invisibles para AMALAY.** Cualquier consulta del dashboard filtra por tenant.
3. **Corrigen una afirmación de mi propio documento.** Escribí que el `client_id` vacío era
   *"el control que valida el método — cuadran 1:1"*. **No es un control.** Son órdenes de
   AMALAY que perdieron su tenant, y las conté como si fueran una anomalía benigna.

### Causa raíz — INFERENCIA FUERTE

[`data.ts:74`](../../dashboard-app/src/lib/data.ts:74):

```ts
export function getActiveClientSlug(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('fullsite_client_id')
      if (stored) return stored.toLowerCase().trim()
    } catch { /* private browsing */ }
  }
  return process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || ''
}
```

Tres niveles, y el último es `''`. Si el navegador no tenía `fullsite_client_id` **y**
`NEXT_PUBLIC_DEFAULT_CLIENT_ID` no estaba puesta en ese despliegue, el tenant sale vacío y
la orden se guarda sin dueño. La ventana de 5 horas encaja con un despliegue sin esa
variable.

**NO VERIFICADO:** no confirmé contra el historial de variables de entorno de ese despliegue
que `NEXT_PUBLIC_DEFAULT_CLIENT_ID` estuviera ausente el 26 de julio. Es la explicación que
el código hace posible, no una que haya observado.

---

## Hallazgo 2 · Una comanda de `demo` dirigida a la cocina de AMALAY

### HECHO

Barrido de desacuerdos entre `pos_orders.client_id` y el tenant que registran las otras
tablas, sobre las 4 fuentes y los 6,316 renglones:

| Fuente | En `pos_orders` | En la otra tabla | n |
|---|---|---|---:|
| `pos_print_jobs` | `demo` | **`amalay`** | **1** |

Una sola. La fila, con el ticket omitido:

```json
{
  "id": "pj-1786569904379-85h2",
  "client_id": "amalay",
  "order_id": "c85dc972-…",     ← esta orden es del tenant `demo`
  "station": "cocina",
  "type": "comanda",
  "status": "needs_attention",
  "error": "Bridge no disponible por 122s — requiere atención",
  "created_at": "2026-08-12T21:25:04Z"
}
```

**No imprimió por suerte, no por diseño.** El bridge llevaba 122 s caído. Si hubiera estado
arriba, la comanda de un pedido `demo` habría salido en la impresora de cocina de AMALAY.

### Causa raíz — HECHO, leído en el código

[`print-queue.ts:223`](../../dashboard-app/src/lib/print-queue.ts:223), dentro de
`syncJobToCloud`:

```ts
await fetch(`${sbUrl}/rest/v1/pos_print_jobs`, {
  method: 'POST',
  headers: { apikey: sbKey /* NEXT_PUBLIC_SUPABASE_ANON_KEY */, … },
  body: JSON.stringify({
    client_id: getActiveClientSlug(),   // ← del localStorage del navegador
    order_id: job.meta?.orderId || null,
    station: job.station,
    …
```

**El tenant del trabajo de impresión y el tenant de la orden vienen de resolvedores
distintos.** La orden lo resuelve el servidor, con la sesión. La comanda lo resuelve el
**navegador**, leyendo `localStorage`. Nada valida que coincidan.

Y es un `POST` directo a PostgREST con la llave `anon`: no pasa por ninguna ruta de API que
pudiera revisarlo.

### Consecuencia

Un navegador con `fullsite_client_id` viejo o equivocado —una laptop que se usó para una demo
y luego se usó en el restaurante, por ejemplo— **manda comandas a la cocina de otro
restaurante**. Con más de un cliente en producción, eso es un ticket imprimiéndose en la
cocina equivocada.

**INFERENCIA FUERTE de que sigue vivo:** el código citado es el de `main` hoy. **NO
VERIFICADO** por ejecución: no reproduje el caso con dos tenants en un navegador real.

---

## Fix propuesto — sin aplicar

La forma correcta no es parchear el default, sino **quitarle al navegador la decisión**:

1. **El trabajo de impresión hereda el tenant de su orden**, resuelto del lado del servidor.
   Que la comanda pase por una ruta de API que lea `order_id`, busque la orden y estampe *su*
   `client_id` — en vez de creerle al `localStorage`.
2. **Rechazar en la base lo que no cuadre.** Una restricción o un disparador que impida
   insertar en `pos_print_jobs` un `client_id` distinto al de la orden referida.
3. **Prohibir el tenant vacío.** `check (client_id <> '')` en `pos_orders`. Hoy una orden sin
   dueño es representable, y por eso existen siete.

Antes de tocar nada: decidir **qué hacer con las 7 huérfanas**. Reasignarlas a `amalay` es
modificar órdenes reales — tu decisión, no la mía. Las opciones son dejarlas como están
(siguen invisibles), reasignarlas, o borrarlas con el mismo protocolo de tres fases que ahora
existe, que al menos dejaría constancia.

---

## Cómo se reproduce

```sql
-- Hallazgo 1
select count(*) from pos_orders where client_id is null or client_id = '';

-- ¿de quién son en realidad?
select distinct a.client_id, a.actor
  from pos_orders o join pos_audit_log a on a.order_id::text = o.id::text
 where coalesce(o.client_id,'') = '';

-- Hallazgo 2 — desacuerdos de tenant entre tablas
select o.client_id as en_pos_orders, j.client_id as en_print_jobs, count(*)
  from pos_orders o join pos_print_jobs j on j.order_id::text = o.id::text
 where coalesce(o.client_id,'') <> '' and coalesce(j.client_id,'') <> ''
   and o.client_id <> j.client_id
 group by 1,2;
```

Los dos son de sólo lectura.
