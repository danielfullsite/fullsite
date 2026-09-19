# La frontera dashboard ↔ punto de venta

> **Qué es esto:** el mapa de qué se alimenta desde el dashboard, qué nace en el punto de
> venta, y por qué esa separación es exactamente lo que hace posible el offline.
>
> **Fecha:** 2026-09-14 · **Estado:** ✅ verificado contra `origin/main`.
> Fuentes: `dashboard-app/src/lib/pos-data.ts` (3,484 líneas, 78 funciones exportadas) y
> `dashboard-app/src/lib/pos-offline-db.ts` (IndexedDB v4, 13 stores).

---

## La regla, en una línea

> **El catálogo baja. La operación sube.**

No es una convención de estilo: es la razón de que el restaurante pueda seguir vendiendo
sin internet. Si el catálogo tuviera que consultarse en vivo, un corte de red pararía la
caja. Como el catálogo ya está en disco, lo único que falta cuando no hay red es *subir* —
y eso puede esperar.

---

## Lo que BAJA — lo alimenta el dueño desde el dashboard

El punto de venta **sólo lee** estas cosas y guarda una copia local. Nunca las edita.

| Qué | Se captura en | Tabla | Store local |
|---|---|---|---|
| Menú, categorías y precios | Dashboard › Platillos | `pos_menu_categories` · `pos_menu_items` | `menu` |
| Grupos de modificadores | Dashboard › Platillos | `pos_modifier_groups` | `modifier_groups` |
| Modificadores y su precio | Dashboard › Platillos | `pos_modifiers` | `modifiers` |
| Qué modificador aplica a qué | Dashboard › Platillos | `pos_item_modifier_groups` · `pos_category_modifiers` | `item_modifier_links` |
| Formas de pago | Dashboard › Configuración | `pos_payment_methods` | `payment_methods` |
| Personal, roles y permisos | Dashboard › Equipo | `pos_staff` | `staff` |
| Insumos, costos y recetas | Dashboard › Recetas · Inventario | `pos_ingredients` · `pos_menu_item_recipes` | `inventory` |
| Proveedores | Dashboard › Proveedores | `pos_suppliers` | — (en línea) |

La bajada la hace `prefetchOfflineData()` (`pos-data.ts`). Su `catch` está vacío a
propósito, y el comentario en el código lo dice: *"Network error — already cached from
previous session"*. Si no hay red, no es un fallo: ya hay copia.

**Consecuencia operativa que hay que decirle al cliente:** un precio que se cambia en el
dashboard entra al punto de venta en la siguiente bajada de catálogo. No es instantáneo, y
está bien que no lo sea — si lo fuera, un dedazo en la oficina cambiaría el precio a media
comanda.

---

## Lo que SUBE — nace en el punto de venta

| Qué | Función | Destino | Store local |
|---|---|---|---|
| Órdenes y sus renglones | `saveOrder` · `addOrderItems` | `pos_orders` · `pos_order_items` | `orders` |
| Cambios de estado de la orden | `updateOrderStatus` | `pos_orders` | `orders` |
| Turnos | `openTurno` · `autoCloseStaleTurno` | `pos_turnos` | `turnos` |
| Movimientos de caja | — | `pos_cash_movements` | `cash_movements` |
| Descuento de inventario por venta | `deductIngredientsForOrder` | `pos_inventory_movements` | `inventory` |
| Merma y conteo físico | `updateInventoryStock` · `logInventoryMovement` | `pos_inventory_movements` | `inventory` |
| Auditoría | `logAudit` | `audit_log` | `sync_queue` |
| Impresiones | — | bridge local (Pedro) | `print_jobs` |
| Facturas y CFDI | `createFactura` · `createCFDIRequest` | `pos_facturas` | — (en línea) |

---

## Las tres excepciones — catálogo que SÍ se edita desde el punto de venta

No son inconsistencias; cada una tiene una razón operativa:

| Qué | Por qué aquí y no en el dashboard |
|---|---|
| **Plano de mesas** | Se acomoda mirando el salón. Nadie mueve una mesa desde una oficina. |
| **Existencias** | La merma y el conteo físico ocurren en la cocina, con el producto en la mano. |
| **Ajustes de la terminal** | Tamaño de letra, tema e impresoras son de *esa máquina*, no del restaurante. Por eso viven en `localStorage` y no se sincronizan. |

---

## Cómo sobrevive el offline

`pos-offline-db.ts` — IndexedDB **v4**, 13 stores:

```
Catálogo (baja):  menu · modifier_groups · modifiers · item_modifier_links
                  payment_methods · staff · inventory
Operación (sube): orders · turnos · cash_movements · print_jobs
Infraestructura:  sync_queue · meta
```

Cuatro piezas hacen que no se pierda ni se duplique nada:

1. **Un solo camino.** Toda operación pasa por la misma función, haya red o no. No existe
   una rama "online" y otra "offline" que se comporten distinto — de ahí salen los bugs
   que sólo aparecen en campo.
2. **Idempotencia por `save_operation_id`.** Si una operación sube dos veces porque se
   cayó la red a media subida, el servidor reconoce el mismo id y la aplica una vez. Por eso
   reintentar siempre es seguro.
3. **Reintento con espera creciente.** `ticksEntreReintentos()` y `tocaReintentar()`. Una
   operación en conflicto no se borra: se reclasifica con `clasificarConflicto()` y se
   resuelve con `resolveSyncConflictKeepServer()` o `resolveSyncConflictApplyLocal()`.
4. **`guardTenant()`.** El caché está atado al `restaurant_id`. Si la terminal se reasigna
   a otro restaurante, detecta el cambio y limpia — para que jamás se mezclen dos negocios.

Hay además un guardián explícito, `esMutacionSinFiltro()`, que impide subir una mutación
sin filtro (un `UPDATE` sin `WHERE`). Es el tipo de detalle que sólo se escribe después de
que algo así casi pasa.

> **Regla dura que no se toca** (`docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §4`):
> `saveOrder` debe caer a `OFFLINE_QUEUED` ante `navigator.onLine === false`, status 0/5xx
> o timeout. **Nunca** a `API_ERROR` por un problema de red: se perdería la orden y no
> imprimiría.

---

## Cómo se clona a otro restaurante

La identidad viene del **TerminalConfig** del Electron
(`electron-app/local-server/config-schema.js`):

```
restaurant_id      · el client_id en Supabase
terminal_id        · UUID estable de esta máquina física
terminal_role      · server_pos | pos | kds | admin
terminal_name      · "Caja Principal"
local_server_host  · 127.0.0.1 para pos; IP de LAN para kds
local_server_port  · 7717
```

Un config inválido o ausente deja la terminal en `NOT_PROVISIONED` y **bloquea** el local
server, el POS y el KDS. Es una puerta, no una advertencia.

Con eso, clonar es: `restaurant_id` nuevo → el catálogo baja solo → el plano se dibuja en el
editor → listo. **Sin tocar una línea de código.**

---

## Cómo se refleja esto en el Skeleton

El demo (`dashboard-app/public/fs-skeleton.html`) implementa la frontera tal cual:

- Todo lo específico del restaurante vive en un objeto `TENANT` y **sólo ahí**. Ninguna
  otra parte del código menciona `amalay`.
- Los iconos de categoría se asignan **por palabra clave** (`ICON_RULES`), en español e
  inglés. Un restaurante de tacos o sushi obtiene sus iconos sin tocar código.
- Hay una pantalla **Sincronización** que muestra la frontera en vivo: qué baja, qué sube,
  qué está en cola y qué tiene conflicto.
- El modo offline es real en el demo: operar sin red encola, reconectar drena.

### Verificado

Ejecutado con un DOM simulado sobre el archivo publicado
(`scratchpad/domtest.js`, 0 errores):

| Prueba | Resultado |
|---|---|
| Las 13 vistas renderizan | ✓ |
| Categorías sin familia válida | 0 |
| Familias sin contenido (pestaña vacía) | 0 |
| Descuento 15% sobre $632.00 | $94.80 |
| Cortesía 2 personas (tope $960, subtotal $632) | $632.00 — se topa al subtotal |
| 2×1 con unidades [292, 292, 48] | 1 par → regala $292.00 (la 2ª del par) |
| Un envío se divide en comandas por estación | ✓ cocina + cafetería |
| Operar sin red | encola 1 operación |
| Reconectar | drena a 0 pendientes |
| Editor: agregar, duplicar, girar, borrar, guardar | ✓ 33 → 35 mesas |

---

## Lo que este diseño NO toca

- `pos/page.tsx` y todo `dashboard-app/src` siguen intactos. El demo vive en `public/`.
- No toca `pos-offline-db`, el bridge ni Pedro. Las reglas duras de offline siguen en pie.
- El demo **no es el punto de venta**: es el lenguaje visual y la mecánica, con datos
  reales, para decidir antes de portar. Portarlo es un trabajo aparte y por fases.
