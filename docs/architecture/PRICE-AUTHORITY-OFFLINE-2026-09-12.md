# Autoridad de precios en órdenes offline

Estado: **diseño cerrado, enforcement legacy no implementado**. La candidata
`PENDIENTE_20260912190000_catalogo_de_precios_versionado.sql` no fue aplicada.

## Veredicto

El `save-order` legacy no tiene hoy evidencia suficiente para recalcular ni rechazar
precios de renglón sin arriesgar ventas offline legítimas.

Una línea trae `menuItemId`; las líneas nuevas pueden traer `modifier_ids` y los
combos conservan `_comboId`/`_comboGroupId`. Eso identifica qué pidió el operador,
pero no prueba cuánto costaba cuando lo pidió:

- `pos_menu_items.price`, `pos_modifiers.price`, `pos_combos.price` y promociones
  se actualizan en su misma fila. No existe historial económico.
- `saveOrder` encola `items`, importes y hora, pero no una `catalog_revision`.
- la caché web de menú guarda categorías y `menu_cached_at`; al refrescar borra la
  versión anterior y no vincula su contenido a la operación.
- la promoción aplicada vive en estado React. `promo_id` no llega a `Order`, al
  payload de `save-order` ni a `pos_orders`.
- el checksum de `CatalogStore` sí protege `ORDER_SAVE` cuando Caja es autoridad,
  pero Caja conserva un solo `catalog.json`. Es suficiente localmente porque Caja
  valida y compromete el comando contra su revisión presente antes de responder; no
  convierte en verificable un replay legacy capturado fuera de Caja.

Caso mínimo reproducido por
`save-order-precio-offline-historico.test.ts`: un café se capturó y pagó a $100
($116 con IVA), la conexión cayó y el menú subió a $120 antes del replay. Usar el
catálogo actual produciría $139.20 frente a un pago durable de $116. Rechazar deja
la venta en conciliación; reprecificar altera una venta ya aceptada. El catálogo
actual no permite distinguir este caso de un precio manipulado a $100.

## A/B

### A. Snapshot económico inmutable por revisión, recomendado

Cada publicación de menú crea un snapshot completo, ordenado e inmutable. El POS
envía sólo intención y su revisión: producto, cantidad, modificadores, combo y promo
por ID. El servidor carga esa revisión y calcula precio, extras, descuento, IVA y
total. Los campos económicos que manda el navegador se ignoran.

Ventajas: funciona tras días sin WAN, prueba exactamente qué precio aceptó el
restaurante y permite auditar sin falsos positivos. Costo: requiere contrato nuevo,
publicación de snapshots y un cutover coordinado.

### B. Comparar con las filas actuales, descartado

Es un cambio pequeño y detiene una manipulación cuando nada cambió en el menú. No
puede diferenciar una edición fraudulenta de una venta legítima anterior al cambio.
Bloquearla pierde disponibilidad; sustituir el importe rompe pagos, tickets y corte.

## Contrato v1

Una creación o un renglón nuevo debe enviar:

```json
{
  "pricing_contract_version": 1,
  "catalog_revision": "sha256-hex",
  "items": [{
    "line_id": "uuid-estable",
    "product_id": "menu-id",
    "quantity": 2,
    "modifier_ids": ["modifier-id"],
    "combo_id": null,
    "combo_group_id": null
  }],
  "promotion_ids": [],
  "promotion_grant_id": null
}
```

No son autoridad: `precio`, `precioExtra`, `subtotal`, nombres/etiquetas, monto de
descuento, tasa de IVA ni total. Se pueden conservar como presentación o para
diagnóstico, pero el resultado persistido sale del snapshot.

El resultado que escribe el servidor agrega a cada línea `catalog_revision`,
`unit_price_cents`, `total_cents` y los modificadores resueltos. La orden conserva
la tasa fiscal y las promociones efectivamente aceptadas. Un hash sin snapshot
retenido no basta: el servidor necesita volver a leer el contenido exacto al replay.

Una revisión tampoco convierte la hora del navegador en autoridad. Una promoción o
combo con horario sólo se acepta offline si Caja evalúa y compromete el comando en
ese momento, o si existe un grant firmado por el servidor y ligado a esa operación.
Sin una de esas dos pruebas, el POS cloud puede vender al precio base pero debe
bloquear la aplicación del descuento temporal. Confiar en `captured_at` permitiría
retroceder el reloj para inventar vigencia.

## Migración mínima

La candidata SQL agrega dos piezas sin activar comportamiento:

1. `pos_pricing_catalog_snapshots`: snapshot económico completo por
   `(client_id, revision)`, checksum SHA-256 y trigger que prohíbe `UPDATE/DELETE`.
2. `pos_price_authority_modes`: `legacy`, `observe` o `versioned_required` por
   tenant. Empieza en `legacy`; no confía en `captured_at` para decidir excepciones.
3. `publish_pos_pricing_catalog(client, actor)`: lee en una sola sentencia categorías,
   productos, precios, reglas/opciones, combos, promociones, IVA y zona horaria;
   ordena arreglos y publica el hash. Sólo `service_role` puede ejecutarla.

Falta deliberadamente el RPC de escritura. Añadir sólo la tabla no cierra el bug.
El siguiente cambio debe crear `r2_save_order_priced` (o ampliar de forma compatible
el wrapper idempotente) para cargar `(client_id, catalog_revision)`, resolver cada ID,
validar cardinalidad/horarios y enviar al `r1_save_order` únicamente valores
calculados. Snapshot, guardado e idempotencia deben quedar bajo una única decisión
de servidor; un PATCH suplementario no es aceptable para dinero.

## Reglas de edición posteriores

- **Append:** los renglones ya aceptados conservan su precio y revisión. Un renglón
  nuevo usa la revisión actual y una identidad nueva. Aumentar cantidad después de
  un cambio de precio se representa como otra línea, igual que ya hace Caja.
- **Cancelación:** prorratea descuento e IVA desde los importes aceptados de la
  orden. No vuelve a consultar el menú. `prepararCancelacionItem` ya sigue esta regla.
- **Transferencia:** mueve la línea completa y sus importes aceptados. No crea una
  venta nueva ni reprecifica. `r1_transfer_item_atomic` ya preserva esa suma.
- **Split:** reparte el saldo aceptado de la orden madre; no duplica renglones como
  nueva autoridad de precio. Cada cuenta de cobro referencia la madre y su asignación.
- **Promoción/combo:** el snapshot resuelve ID, definición y selección; Caja o un
  grant de operación resuelve la vigencia. El nombre de una promo, el reloj del
  navegador o la suma proporcional enviada por el cliente no autorizan.

## Cutover sin perder colas

1. Aplicar la migración en staging y publicar la primera revisión.
2. Hacer que `/api/pos/menu` entregue esa misma revisión y el snapshot de una sola
   publicación, no ocho lecturas independientes.
3. Actualizar POS/IDB para conservar revisión e intención v1 en cada operación. Una
   promo temporal además exige recibo de Caja o grant firmado; sin él se conserva la
   venta base y se bloquea sólo el descuento.
4. Ejecutar `observe`: recalcular y comparar, sin bloquear, con métricas separadas
   para diferencias reales y revisiones ausentes.
5. Inventariar terminales y drenar todos los `save-order` legacy. Una operación vieja
   no puede demostrar cuándo se creó sólo con `captured_at`, porque el cliente lo dicta.
6. Activar `versioned_required` por tenant. Desde ese punto falta de snapshot, ID
   desconocido, modificador inválido o promo fuera de vigencia devuelve un conflicto
   visible y recuperable; nunca se guarda un total elegido por el cliente.
7. Retener snapshots al menos mientras exista cualquier orden, replay o periodo de
   auditoría que los referencie. La opción simple y segura es no borrarlos.

Para AMALAY, la ruta más corta para renglones normales es completar el cutover de
Caja como único escritor: `ORDER_SAVE` ya recibe IDs, exige la revisión actual y
calcula importes localmente. El materializador cloud recibe el resultado comprometido
de Caja. Combos promocionales y promociones siguen bloqueados en modo Caja hasta que
entren en ese catálogo/comando. Mientras la instalación siga en autoridad legacy,
este P1 permanece abierto y el detector de `price_edit_suspect` sólo puede ser señal,
nunca prueba ni bloqueo.
