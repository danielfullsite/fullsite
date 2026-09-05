# Catálogo compartido de Caja

Estado: implementado y probado en el candidato local; no desplegado. Forma parte de T9 y prepara el cálculo autorizado de T6. No equivale al cierre offline completo.

## Comportamiento de producto

Caja conserva menú, precios, opciones obligatorias, formas de pago, IVA, zona horaria, configuración de recibos y ajustes operativos registrados. Cada POS consulta ese mismo catálogo por LAN. Una terminal sin caché privada obtiene los productos cuando no hay internet. Los extras con precios fijos del código antiguo ya no sustituyen los modificadores configurados en una terminal LAN.

El ingreso por PIN confirmado online inicia la descarga desde Caja usando el token emitido por el servidor. El PIN sigue funcionando si la descarga falla; preparar catálogo es una condición separada. `/catalog/status` informa si existe una versión completa, cuándo se descargó y si hay actualización pendiente. La UI distingue menú no disponible de un restaurante sin menú configurado.

Una descarga incompleta, un precio inválido, un grupo obligatorio sin opciones suficientes o una respuesta de otro restaurante conservan la última versión válida. No se cambia un IVA ausente por 16%, ni un precio nulo por cero. Si no hay versión válida se bloquea la confirmación desde la cuenta y se conserva el borrador.

## Contrato y persistencia

- `GET /api/pos/menu`: sesión POS o dashboard verificada, tenant resuelto en servidor, todas las páginas de ocho datasets bajo un plazo común. Publica `schema_version:1`, `complete:true`, `catalog_scope:restaurant`, fecha, categorías, modificadores, formas de pago, configuración y ajustes permitidos. No incluye credenciales ni ajustes privados.
- `CatalogStore`: sólo obtiene datos del endpoint HTTPS configurado en código; no admite una carga desde el body del navegador. Valida referencias, importes, límites e identidad. Guarda un único archivo con checksum mediante escritura, fsync y rename. Un fallo de disco no publica éxito y bloquea la lectura hasta reiniciar. Un archivo corrupto o copiado de otra sucursal no queda listo.
- `GET /catalog` y `/catalog/status`: autenticados por LAN; el secundario los reenvía a Caja. Si no la alcanza devuelve error; no presenta un catálogo privado como actual. El token de la descarga no se guarda en catálogo ni eventos.
- `pedro-catalogo.ts`: comparte una lectura concurrente y una caché en memoria de tres segundos, separada por bridge, restaurante y sucursal. Menú, configuración, ajustes, formas de pago y modificadores usan este contrato en terminales configuradas para Caja.

El esquema de menú vigente es por restaurante, compartido entre sus sucursales. El archivo local queda vinculado adicionalmente a la sucursal de la instalación. Esto **no implementa listas de precios distintas por sucursal**. El conjunto se adquiere por lecturas paginadas; todavía no hay una versión transaccional única del menú en Postgres frente a ediciones administrativas simultáneas.

## Evidencia y límites

Siete pruebas de almacén/transporte: reinicio, IVA cero, copia/corrupción, fallo de disco, descargas inválidas, aislamiento, reenvío real y preparación posterior al login. Cinco de adquisición cloud: paginación completa, fallo de página/límite, configuración ausente, precio nulo y autorización. Tres de lectura de UI: opciones obligatorias, aislamiento de caché y recuperación tras preparación.

El laboratorio multi-Electron pasa **10/10**. El caso añadido navega el selector real de POS 3 sin caché de menú, con WAN cortada y LAN viva: ve el café de $50, exige su opción obligatoria y habilita Agregar sólo después de elegirla. Captura: `output/closure/ui/catalogo-compartido-sin-internet.png`. La selección se cancela; este caso no afirma haber guardado una nueva ronda.

Quedan fuera: stock/promociones/combos/recetas completos por LAN, assets de arranque frío, política de activación de cambios de precio durante un servicio, adquisición transaccional del catálogo, comandos operativos calculados en Caja, materialización cloud y aceptación física de Windows/impresión. El catálogo compartido prepara esos pasos; no activa el nuevo escritor ni certifica el producto entero.
