# Acta de Línea Base — medir el ANTES

> Plantilla llenable. Se levanta **una vez por restaurante**, en la visita de diagnóstico,
> **antes de tocar absolutamente nada**.
> Creada 2026-08-25. Ver §1E de [`../ONBOARDING-RESTAURANT.md`](../ONBOARDING-RESTAURANT.md).

---

## Por qué existe este documento

Un caso de éxito no se construye al final. Se construye **el día cero, o no existe.**

Si instalamos Fullsite sin haber medido cómo estaba el restaurante antes, a los seis meses
tenemos una anécdota — *"les fue mejor"* — y no un caso. Una anécdota no convence a un dueño
escéptico, no sostiene una nota de prensa, y no se puede presentar a un inversionista.

**Regla dura: sin acta levantada y firmada, no hay instalación.** No es burocracia — es el
único momento en que estos números todavía se pueden capturar. Después es irrecuperable.

**Regla de honestidad:** cada dato lleva su **fuente** y su **confiabilidad**. Un número que
el dueño nos dijo de memoria no es lo mismo que uno que extrajimos de su POS. Los dos sirven,
pero se citan distinto. Nunca presentar un dato declarado como si fuera medido.

---

## Bloque 0 — Identidad del acta

| Campo | Valor |
|---|---|
| Restaurante | |
| Dueño / responsable presente | |
| Fecha de levantamiento (YYYY-MM-DD) | |
| Quién levantó el acta | |
| POS actual | |
| Fecha estimada de instalación | |
| Quién presentó al cliente (referidor) | |

---

## Bloque A — Dinero

| # | Métrica | Valor | Periodo medido | Fuente | Confiabilidad |
|---|---|---|---|---|---|
| A1 | Venta semanal promedio (MXN) | | | | |
| A2 | Venta por día de la semana (L a D) | | | | |
| A3 | Ticket promedio (MXN) | | | | |
| A4 | Número de cuentas/comandas por semana | | | | |
| A5 | Mix alimentos vs bebidas (%) | | | | |
| A6 | Mix efectivo vs tarjeta vs transferencia (%) | | | | |
| A7 | Venta por delivery (Rappi/Uber) y su % | | | | |
| A8 | Descuentos y cortesías al mes (MXN) | | | | |

> **Confiabilidad:** `MEDIDO` (lo extrajimos nosotros) · `EXPORTADO` (reporte de su POS) ·
> `DECLARADO` (nos lo dijo el dueño) · `ESTIMADO` (lo calculamos con supuestos — anotar cuáles).

---

## Bloque B — Costo y merma

| # | Métrica | Valor | Periodo | Fuente | Confiabilidad |
|---|---|---|---|---|---|
| B1 | Food cost **declarado** por el dueño (%) | | | | |
| B2 | Food cost **calculado** por nosotros (%) | | | | |
| B3 | Compra mensual de insumos (MXN) | | | | |
| B4 | Merma estimada al mes (MXN o %) | | | | |
| B5 | Veces que se "86" un platillo al mes | | | | |
| B6 | Número de proveedores activos | | | | |
| B7 | Top 5 insumos por gasto | | | | |
| B8 | ¿Cada cuánto revisa precios de proveedor? | | | | |

> B1 vs B2 es a propósito. **La brecha entre lo que el dueño cree y lo que es** suele ser el
> hallazgo más vendedor de toda el acta — y sólo se puede mostrar si se registran los dos.

---

## Bloque C — Operación

| # | Métrica | Valor | Fuente | Confiabilidad |
|---|---|---|---|---|
| C1 | Número de mesas y distribución por zona | | | |
| C2 | Rotación de mesa (vueltas por servicio) | | | |
| C3 | Tiempo promedio de mesa (minutos) | | | |
| C4 | Tiempo de cocina de la comanda (minutos) | | | |
| C5 | Comandas mal capturadas o corregidas por semana | | | |
| C6 | Cancelaciones por semana y quién las autoriza | | | |
| C7 | Cuánto tarda el corte de caja (minutos) | | | |
| C8 | ¿Cuadra el corte a la primera? ¿Cada cuánto no? | | | |

---

## Bloque D — El tiempo del dueño

> **El bloque que más vende.** Un dueño discute un porcentaje de food cost. No discute
> cuántos domingos lleva sin descansar.

| # | Métrica | Horas/semana | Quién lo hace | Confiabilidad |
|---|---|---|---|---|
| D1 | Corte de caja y arqueo | | | |
| D2 | Conteo e inventario | | | |
| D3 | Armar pedidos a proveedores | | | |
| D4 | Sacar reportes / capturar en Excel | | | |
| D5 | Nómina y propinas | | | |
| D6 | Facturación y contabilidad | | | |
| D7 | **Total de horas administrativas por semana** | | | |
| D8 | ¿Cuántos días a la semana descansa el dueño? | | | |

---

## Bloque E — Lo que paga hoy

| # | Concepto | MXN / mes | Notas |
|---|---|---|---|
| E1 | Licencia del POS actual | | |
| E2 | Módulos extra / soporte / consultoría | | |
| E3 | Facturación (PAC) | | |
| E4 | Hardware pagado en los últimos 12 meses | | |
| E5 | Otro software (inventario, nómina, reservas) | | |
| E6 | **Costo total de sistemas al mes** | | |

---

## Bloque F — Evidencia visual

Sin esto no hay "antes y después". Se captura el mismo día, con permiso del dueño.

- [ ] Video del **flujo completo de una comanda**: mesero toma la orden → llega a cocina → sale el plato
- [ ] Video del **corte de caja** de principio a fin (cronometrado)
- [ ] Foto de la **pantalla del POS actual** en uso
- [ ] Foto de **cómo se ve la comanda** en cocina hoy (papel, pantalla, grito)
- [ ] Foto del **método de inventario actual** (libreta, Excel, nada)
- [ ] Foto del **espacio de caja y cocina** tal como está
- [ ] Consentimiento del dueño para usar el material — **por escrito**, ver Bloque G

---

## Bloque G — Consentimiento

| Campo | Valor |
|---|---|
| ¿Autoriza usar sus datos **agregados y anonimizados** para benchmarks? | Sí / No |
| ¿Autoriza usar su caso **con nombre** en materiales de venta? | Sí / No |
| ¿Autoriza foto y video en materiales públicos? | Sí / No |
| Firma del dueño | |
| Firma de Fullsite | |

> Si contesta **No** a la segunda, el caso sirve igual — se publica sin nombre
> ("una cafetería de 90 asientos en San Pedro"). Lo que **no** se hace nunca es publicarlo
> sin haber preguntado.

---

## Re-medición

Las mismas métricas se vuelven a levantar a los **30, 60 y 90 días**, con **exactamente la
misma definición**. Si cambia la definición, el número no es comparable y el caso se cae.

| Corte | Fecha | Quién midió | Observaciones |
|---|---|---|---|
| Día 0 | | | |
| Día 30 | | | |
| Día 60 | | | |
| Día 90 | | | |

**Al comparar, siempre anotar qué más cambió** — si subieron precios, abrieron terraza o entró
temporada alta, eso va en la nota. Atribuirle a Fullsite un cambio que fue del mercado destruye
la credibilidad del caso completo y no se recupera.

---

## Lo que este documento NO es

- **No es una promesa de resultados.** Es una fotografía del punto de partida.
- **No sustituye la matriz de aceptación técnica.** Son cosas distintas: ésta mide el negocio,
  esa mide el sistema.
- **No se llena de memoria después.** Si no se levantó el día cero, se registra como
  *"sin línea base"* y ese restaurante no se usa como caso de éxito. Se dice y ya.
