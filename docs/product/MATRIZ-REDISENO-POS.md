# Matriz de rediseño del punto de venta

**Levantada:** 2026-09-14 · **Rama:** `redesign/pos-tile` · **PR:** danielfullsite/fullsite#408

Cruza los 25 flujos de [`WANSOFT-POS-BIBLE.md`](WANSOFT-POS-BIBLE.md) contra el
código real del POS. Existe para que «rediseño completo» deje de depender de una
opinión y pase a ser una lista que se tacha.

> **Cómo se lee.** *Existe* significa que hay código que implementa el flujo —
> medido con `grep` sobre `dashboard-app/src`, no recordado. *Rediseñado* significa
> que una pieza de ese flujo ya se rehízo tras la bandera `#v2=1`. *Operado*
> significa que alguien lo ejecutó de punta a punta en un tenant de pruebas.
> Las tres columnas son distintas y ninguna implica la siguiente.

---

## Estado al levantarla

| | |
|---|---|
| Flujos que existen en el código | **24 de 25** |
| Flujos tocados por el rediseño | **10 de 25** |
| Flujos operados de punta a punta | **0 de 25** |
| Flujos validados en terminal física | **0 de 25** |

La tercera y la cuarta fila son las que importan, y están en cero. Que el CI esté
verde no cuenta: ninguna prueba abre un turno, manda una comanda y cobra.

---

## La matriz

| # | Flujo | Existe | Rediseñado | Operado | Qué falta |
|---|---|---|---|---|---|
| 1 | Apertura y login | sí | tema | — | El portón de PIN sigue con su estructura anterior; la Biblia pide huella grande y bloqueo post-envío |
| 2 | Mapa de mesas | sí | retícula sin scroll | — | Falta el plano visual con zonas nombradas; hoy la vista de plano existe pero el rediseño sólo tocó la de retícula |
| 3 | Crear orden | sí | panel de venta | — | Familias → categorías → productos ya está; falta que la silla se asigne tocando una silla visual |
| 4 | Modificadores | sí | — | — | **Sin tocar.** Es el flujo de más riesgo: un obligatorio que no se pida manda comida mal a cocina |
| 5 | Enviar a cocina | sí | banda de acción | — | Falta confirmación visual de que la comanda imprimió, y alerta inmediata si falla |
| 6 | Editar orden | sí | renglón de cuenta | — | Enviados ya se ven distintos; falta el historial de comandas dentro de la orden |
| 7 | Cancelar | sí | renglón de cuenta | — | Falta catálogo de razones predefinidas |
| 8 | Transferir platillos | sí | renglón de cuenta | — | Falta exigir huella de gerente en TODA transferencia |
| 9 | Juntar / separar mesas | sí | — | — | **Sin tocar.** La Biblia pide arrastrar en el plano y vista previa antes de fusionar |
| 10 | Cobrar | sí | banda de acción | — | **Falta lo grande:** botones grandes de forma de pago en vez de lista, y el teclado nuevo |
| 11 | Split de cuenta | sí | banda de acción | — | Falta vista previa del split y dividir por porcentaje |
| 12 | Descuentos y cortesías | sí | — | — | **Sin tocar.** Pantalla de dinero con teclado chico |
| 13 | Ticket | sí | — | — | **Sin tocar.** Falta ticket digital por QR |
| 14 | KDS cocina | sí | — | — | Excluido a propósito: fija sus tokens en línea y es otra superficie |
| 15 | KDS barra | sí | — | — | Igual que el 14 |
| 16 | Impresoras y estaciones | sí | — | — | Falta alerta cuando un platillo nuevo no tiene impresora asignada |
| 17 | Caja: retiros y depósitos | sí | — | — | **Sin tocar.** Pantalla de dinero: candidata directa al teclado nuevo |
| 18 | Corte / cierre de turno | sí | apertura de turno | — | La apertura ya usa el teclado; **el cierre y el arqueo no** |
| 19 | Permisos y seguridad | sí | — | — | Falta autorización remota desde el celular del gerente |
| 20 | Configuración de ticket | **NO** | — | — | **Hueco real.** El ticket se arma en `lib/printer.ts`; no hay dónde configurar logo, leyenda ni qué campos salen |
| 21 | Configuración de periféricos | sí | — | — | Falta estado de salud en vivo de cada periférico |
| 22 | Inventario desde POS | sí | — | — | Agotado ya se ve en el tile; falta el resto de la pantalla |
| 23 | Reportes locales | sí | — | — | **Sin tocar** |
| 24 | Huellas digitales | sí | — | — | **Sin tocar.** La Biblia pide huella como método principal, no alternativa |
| 25 | Pantalla cliente | sí | — | — | **Sin tocar** |

### El único hueco de función

**#20 — Configuración de ticket.** Buscado por `ticket_config`, `ticketConfig`,
`TICKET_CONFIG`, `logo_ticket`, `ticketFooter`, `ticket_footer` en todo
`dashboard-app/src`, y en `app/pos/configuracion/page.tsx`: cero coincidencias.
El ticket se construye en `lib/printer.ts` interpolando el nombre del tenant.

Consecuencia para clonar: **cada restaurante nuevo necesita un cambio de código
para poner su leyenda o su logo en el ticket.** Eso contradice la tesis de que un
cliente se da de alta sin tocar el sistema.

> Alcance de esta negación: se buscó en `dashboard-app/src`. No se revisó
> `electron-app/` ni el esquema de Supabase.

---

## Cómo se verifica — y por qué en otro restaurante

La bandera ya aísla a AMALAY: está apagada por omisión y vive en el
`localStorage` de cada equipo. El riesgo de que la vean por accidente es cero.

Lo que un tenant de pruebas da y la bandera no es **poder operar**. Un POS no se
evalúa mirándolo: hay que abrir turno, mandar a cocina, dividir y cobrar. Hacer
eso en AMALAY les mete ventas falsas al corte, al food cost y al inventario.

| Tenant | Platillos | Personal | Mesas | Para qué |
|---|---|---|---|---|
| `boruca` — Boruca Restaurant & Bar | 32 | 7 | 14 | **Operar.** El único demo con las tres cosas |
| `amalay` | cientos | 40 | 33 | **Sólo mirar, en lectura.** El caso difícil |

**Por qué los dos.** Boruca tiene 32 platillos; AMALAY tiene 58 categorías con
cientos. El problema que este rediseño resuelve —que nada quepa en la pantalla—
**sólo se reproduce con el catálogo de AMALAY**. Validar las familias y la
retícula con 32 platillos es validar el caso fácil.

### Orden propuesto

Por riesgo operativo, no por lo que se ve más:

1. **#4 Modificadores** — el más peligroso. Un obligatorio que no se pida manda comida mal.
2. **#10 Cobrar** y **#17 Caja** — donde está el dinero, y donde el teclado nuevo ya sirve.
3. **#18 Cierre y arqueo** — la otra mitad del turno.
4. **#12 Descuentos** — pantalla de dinero, mismo teclado.
5. El resto, por orden de uso en un turno.

---

## Reglas que esta matriz impone

1. **Ninguna fila se marca «operado» sin haber ejecutado el flujo completo** en
   `boruca` con la bandera puesta. Compilar y pasar lint no es operar.
2. **AMALAY no corre con la bandera puesta** hasta que las 25 filas estén operadas.
3. **Cada pantalla conserva su rama anterior** hasta que su fila esté operada.
4. **CI verde no cuenta como evidencia** en esta tabla. Las 239 pruebas no abren
   un turno ni mandan una comanda.
