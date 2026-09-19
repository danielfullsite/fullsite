# Plan Square-de-Fullsite — el mejor sistema para todas las industrias, empezando por restaurantes

> Creado: 2026-08-28 · Fuente principal: conversación Daniel ↔ Billy Newell (2026-08-28, transcripción en el hilo)
> Estado: **borrador vivo** — se actualiza conforme avancen las juntas con Billy y el trabajo técnico.
> Convención de este doc: cada afirmación clave se marca **[Confirmado]** (dicho por Billy/Daniel o verificado en código),
> **[Inferido]** o **[Pendiente]**.

## 1. La tesis (en una frase)

Fullsite deja de ser "un POS para restaurantes" y se convierte en lo que Square es para
cualquier negocio: **una plataforma de punto de venta + inventario + recetas + mano de obra +
facturación que sirve a cualquier industria**, pero con dos ventajas que Square no tiene:

1. **Profundidad de restaurante** — recetas, costos ideales, KDS, offline, meseros — heredada de AMALAY.
2. **IA nativa** — captura de facturas por foto, costeo automático, alertas en tiempo real — no como parche.

El propio Billy lo nombró: *"lo que me estás diciendo es Square"* — y el insight clave es que
una "receta" generaliza: la receta de una hamburguesa y la lista de materiales de una camisa
maquilada son el mismo objeto de datos. **[Confirmado — dicho en la llamada]**

## 2. Quién es Billy y por qué importa

- Consultor/operador de restaurantes con décadas de experiencia (Grupo con Dunkin'/Tim Hortons-adjacentes; conoce el mundo fast food). Actualmente **consultor externo dirigiendo de facto un negocio fast food** al que quieren nombrar director general. **[Confirmado]**
- Es **el tomador de decisión**: "yo soy el que tomo la decisión, si me convences a mí, nos vamos". **[Confirmado]**
- Ofrece ser **conejillo de indias + mentor de dominio**: explicarnos el "por qué" operativo de cada feature (por qué se sube una factura, cómo se diseña una cocina). **[Confirmado]**
- Su valor estratégico: nos saca del nicho premium (Rosta, Casa Oso, AMALAY) y nos mete a **fast food y cadenas** — "le pegas a un Tim Hortons y son 200 sucursales × 2 terminales = 400 terminales". **[Confirmado]**

## 3. Requisitos que Billy pidió explícitamente (checklist de venta)

| # | Requisito | Estado en Fullsite hoy | Fuente |
|---|---|---|---|
| 1 | **Mismo hardware** — correr en las terminales Windows/Google que ya tiene, sin comprar hardware nuevo | Web-first: corre en cualquier navegador; Electron para KDS. **[Confirmado en arquitectura]** | dashboard-app (Next.js), electron-app/ |
| 2 | **Captura de facturas por foto/IA** — subir factura de proveedor (ej. Sigma), extraer líneas y alimentar inventario sin captura manual | **[Pendiente — no existe hoy]**. Es el gap #1 que él nombró como "lo que más me da miedo" y "tema gigantesco" del mercado | No hay módulo de OCR de facturas en el repo |
| 3 | **Tacómetro de mano de obra** — dashboard verde/amarillo/rojo de % labor vs ventas, al instante, por hora | **[Pendiente]**. Daniel dijo en la llamada que "sí lo tiene" — hay nómina/empleados pero no el semáforo por hora; hay que construirlo antes del demo o matizar | Verificar contra dashboard-app antes del martes |
| 4 | Reporteo: costos, ventas por producto/mes/año, qué vende y qué no | Existe (dashboard + vistas `ocm_*`) **[Confirmado]** | ocm_daily, ocm_menu_items |
| 5 | **CRM** | Parcial: recuperación de clientes por WhatsApp (proyecto Bernardo) **[Inferido — verificar alcance]** | memoria project_bernardo_crm |
| 6 | **Inventarios sencillos** + captura fácil | Existe módulo (inventario-real) **[Confirmado que existe; sencillez por validar con él]** | dashboard-app/src/app/inventario-real/ |
| 7 | **Costo ideal vs real por receta** — "toda receta tiene un costo ideal; si el food cost salió 42%, algo pasó" | Existe base (pos_recipes, food cost ~27.6% AMALAY) **[Confirmado]**; falta el reporte varianza ideal-vs-real como producto | memoria project_food_cost_truth |
| 8 | Inventario de alcohol (onzas, medidores de botella) | **[Pendiente]** — él mismo dijo que lo va guiando | — |
| 9 | Alta de empleados **por hora aunque se pague por jornada**, para simular eficiencia ("¿qué pasa si lo mando a break?") | **[Pendiente]** — concepto de diseño para el módulo labor | — |

## 4. Los tres diferenciadores que decidirán la venta (y el producto)

### 4.1 Factura → inventario, sin manos (el gap #1 del mercado)
El problema según Billy: nadie captura compras; hacen un inventario al mes y el contador
deduce el food cost. Un error de captura (40 en vez de 4) desbalancea todo. **[Confirmado]**

**La jugada:** foto/PDF de factura (CFDI XML cuando exista — ya tenemos Facturapi para emitir,
y el XML del proveedor es estructurado) → IA extrae líneas → match contra catálogo de insumos →
actualiza inventario y costos → alerta si el precio unitario cambió. Esto es exactamente el tipo
de feature "IA nativa" de la tesis §1, y en México el CFDI XML lo hace *más fácil* que en EUA:
gran parte de las compras ya llegan como XML estructurado, la foto es el fallback. **[Inferido]**

### 4.2 Tacómetro de labor en tiempo real
Ventas por hora (ya las tenemos) ÷ costo de nómina por hora (empleados dados de alta con
tarifa horaria) = % labor vivo, con umbrales verde/amarillo/rojo configurables. Tim Hortons lo
resolvió con "un monitor aparte parchado de tres fuentes"; nosotros lo damos integrado.
**[Confirmado el dolor; pendiente construir]**

### 4.3 Varianza de costo ideal vs real
Receta ideal (ya la modelamos) + ventas (ya) + compras capturadas (§4.1) + inventarios
(ya) = reporte automático "tu food cost debió ser 27.6% y fue 42% — aquí está la diferencia".
Es el cierre del loop que ningún sistema local da bien. **[Confirmado el dolor]**

## 5. La generalización a "todas las industrias" (fase Square)

**No se construye ahora; se diseña para no bloquearla.** El principio: los objetos centrales ya
son genéricos —

- Receta = lista de materiales (BOM). Sirve igual para camisa maquilada que para hamburguesa.
- Producto/modificadores = variantes de cualquier retail.
- Inventario/compras/facturas = universal.
- Labor por hora = universal.

Lo específico de restaurante (KDS, mesas, meseros, propinas) queda como **módulo activable por
vertical**, igual que hoy `features` controla el sidebar por tenant. **[Inferido — consistente con
la arquitectura multi-tenant compartida ya decidida]**

**El diseño completo de presets por tipo de restaurante (fast food, fine dining, bar, cafetería,
dark kitchen, etc.) vive en [BIBLE-SQUARE.md](BIBLE-SQUARE.md)** — con el estado del arte de
Square/Toast/Lightspeed investigado y el plan de construcción en 4 fases sobre la
infraestructura actual (`clients.type` + features + pos_settings + templates).

Secuencia de expansión: restaurantes premium (hoy) → **fast food con Billy** → cadenas →
retail/tienditas → manufactura ligera. Cada salto reutiliza el core; no se abre un vertical
nuevo sin un Billy de ese vertical.

## 6. Plan inmediato (esta semana)

1. **Hoy/viernes — mandar a Billy el demo de AMALAY**: usuario + contraseña, dashboard y POS visibles desde cualquier dispositivo (él subrayó que corre sin hardware nuevo). Daniel lo prometió en la llamada. **[Confirmado compromiso]**
2. **Antes del martes — auditoría honesta del checklist §3**: qué está, qué está a medias, qué no está. No demos por hecho lo que se dijo en la llamada; regla de la cita.
3. **Martes en la mañana — junta con Billy** (él regresa el lunes y confirma hora ese día). Objetivo: cerrar el piloto fast food + calendario de sesiones de dominio con él.
4. **Backlog derivado**: (a) spec de captura de facturas (CFDI XML primero, foto después), (b) spec del tacómetro labor, (c) reporte varianza ideal-vs-real.

> Ojo con la prioridad vigente (§20 del protocolo): P0s y offline siguen primero. Este plan
> define *dirección y venta*; el trabajo nuevo de features entra al roadmap sin desplazar el
> núcleo crítico sin decisión explícita de Daniel.

## 7. Riesgos y honestidad

- En la llamada se afirmó que el tacómetro de labor y la captura de facturas "sí las tenemos". **Hoy no están construidas como él las describió.** Antes del demo hay que decidir: construir un v0, o encuadrarlo como "en el roadmap contigo como conejillo de indias" — que es exactamente el rol que él ofreció.
- Billy aún no tiene acceso al sistema del negocio que dirige (una semana esperando Apolo); su urgencia es real pero su autoridad formal (DG) aún no está firmada.
- El salto a fast food exige volumen/velocidad de caja (combos, drive-thru-like flows) que AMALAY no ejercita. Validar con su operación real.
