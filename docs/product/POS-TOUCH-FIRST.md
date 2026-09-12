# POS táctil — plan y estado

> Trabajo abierto el 2026-09-12 sobre `claude/pos-touch-first`, desde el HEAD del
> PR #395 (`16ec3697`). Continúa lo que empezó `POS-SIN-SCROLL.md`, que resolvió
> el modal de cobro. Esto es el resto de las pantallas.

**No es un rediseño.** La identidad se queda: los tokens de `globals.css`
(`--surface #0c1012`, `--panel #131a1d`, `--accent #10b981`, `--ok/--warn/--crit/--info`)
y la tipografía canónica del proyecto. Lo que cambia es **dónde cae cada cosa en
una pantalla de caja sin ratón**. Ningún contrato de negocio se toca.

## 1. El «antes», medido

Las cuatro medidas son las de las cajas y tabletas de piso: 1600×900, 1366×768,
1280×800 y 1024×768. El peor caso es 1024×768.

Se retrataron las siete pantallas en las cuatro medidas — 28 capturas — con un
restaurante de tamaño creíble: 13 categorías, 240 platillos, 16 mesas, una
comanda de 10 renglones. El recorrido está en
[`electron-app/lab/recorrido-capturas-ui.js`](../../electron-app/lab/recorrido-capturas-ui.js)
y se lanza así:

```bash
FULLSITE_LAB_CATALOGO_DEMO=1 FULLSITE_LAB_RECORRIDO=./recorrido-capturas-ui \
FULLSITE_LAB_ETIQUETA=antes CI=1 FULLSITE_LAB_OPERATIONAL=1 \
node lab/laboratorio-ui-multiterminal.cjs
```

Junto a cada PNG queda `medidas.json` con el alto del documento contra el de la
ventana y los contenedores internos que desbordan. Esto es lo que salió:

| Pantalla | 1600×900 | 1366×768 | 1280×800 | 1024×768 |
|---|---|---|---|---|
| Mesas | cabe | cabe | cabe | cabe |
| **Comanda** | lista 724px en **408** | 724 en **311** | 724 en **343** | 724 en **297** |
| Catálogo | (igual, detrás del modal) | | | |
| Cobro | (igual) | | | |
| **Turno** | cabe | **doc 1184 / ventana 768** | **1184 / 800** | **1184 / 768** |
| **Corte** | cabe | cabe | cabe | **doc 774 / ventana 768** |
| KDS | cabe | cabe | cabe | cabe |

**La lista de renglones de la comanda muestra el 41% de la cuenta en 1024×768**
—tres renglones y medio de diez— y es la pantalla donde vive el mesero. Ése es
el peor problema del sistema, por encima del scroll de Turno.

### Lo que además se ve en las capturas

1. **El editor tiene seis botones del mismo peso** abajo: Guardar · Verificar ·
   Enviar · Cuenta · Split · Cobrar, todos de 52px, en dos filas. Ninguno dice
   «éste es el que sigue».
2. **La rejilla de categorías se estira a lo alto**: 13 categorías en tres filas
   separadas por ~180px de vacío, con «Vinos» sola en la última. La mitad derecha
   —55% del ancho— muestra 13 botones en 632px de alto.
3. **El modal de categoría no cierra con Escape**: sólo el telón o una «×» de
   40px, por debajo del mínimo táctil.
4. **El mapa de mesas repite información**: el encabezado dice «MESA(S): 1 · 2
   personas» y debajo dos tarjetas KPI dicen lo mismo, ocupando ~90px.
5. **Las tarjetas de mesa están casi vacías**: el número arriba, «4 lug.» abajo y
   un hueco en medio; quince insignias «Disponible» idénticas que el color ya
   decía.
6. **Turno de Caja es un formulario web**, no una pantalla de caja: márgenes
   enormes, un campo por pantallazo, y «Retiro o depósito» cortado abajo.
7. **El encabezado del POS ocupa ~160px** (21% de 768) en dos barras antes de
   cualquier contenido.

## 2. Las cinco reglas

1. **Altura útil = 632px** en el peor caso (1024×768 menos encabezado y barra
   fija). Lo que no quepa se reparte en páginas o pestañas, no en scroll.
2. **56px mínimo** para todo lo que toca un dedo.
3. **La acción principal vive abajo, fija y sola.** Las secundarias pesan menos.
4. **Nada depende de hover.** Los `hover:` que hay sólo cambian color y ninguno
   esconde información: se conservan y se les añade `active:`.
5. **Densidad de registradora, no de dashboard.** El número que decide (total,
   saldo, minutos de mesa) es lo más grande de su tarjeta.

## 3. El patrón que se repite

**«Rejilla paginada + barra fija».** Una rejilla que sabe cuántas filas caben,
un par de controles grandes a los costados y un indicador `3 / 7` en mono. Es el
mismo gesto en mesas, catálogo y KDS. Teclado: `PageUp`/`PageDown` y flechas,
foco visible, `aria-current` en la página activa.

## 4. Orden de trabajo

1. Mapa de mesas y navegación operativa
2. Editor de cuenta/comanda
3. Catálogo y categorías
4. Cobro de Caja (ya hecho en PR #395; queda revisarlo contra estas reglas)
5. Turno y Corte Z
6. KDS

## 5. Lo que NO se hace

- Convertirlo en dashboard SaaS.
- Cambiar tipografía, acento o iconografía.
- Tocar lógica de negocio, `saveOrder` ni su caída a `OFFLINE_QUEUED`.
- Tocar los archivos que lleva Codex: `api/pos/pin/**`, `api/pos/staff-cache/**`,
  `shift-token.ts`, `api-auth.ts`, `pos-db-policy.ts`, `manager-approval.ts`,
  `adjust-market`, `recipe-sync`, `cancel-item`, migraciones y
  `app/pos/layout.tsx`.

## 6. Límites de esta evidencia

- Las capturas salen de Electron con Next en modo desarrollo, no del instalador.
- El salón del laboratorio tiene 16 mesas; un restaurante con 40 no se ha
  retratado todavía.
- **Del mapa de mesas se guarda el retrato de 1366×768, no el de 1024×768.** En
  las dos últimas medidas la pantalla se bloqueó sola por inactividad —el
  recorrido tarda minutos entre pantalla y pantalla— y lo que salió fue el
  teclado de PIN. El recorrido ya teclea el PIN para recuperarse
  (`despertar()`), pero la corrida que lo estrenaba no llegó a arrancar Next.
  Las medidas de mesas sí están en las cuatro: cabe en todas.
- La verificación final es física, en la tableta de AMALAY. Nada de lo de aquí
  está validado en campo.
