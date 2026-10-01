> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track E — CrunchTime y el back-of-house: qué sabe la industria y qué se vuelve fácil cuando eres dueño del POS

> Sprint de investigación de solo lectura. Fecha: 2026-09-17. Sin código, sin commits, sin contacto con proveedores.
> Cada afirmación va marcada **FACT** (fuente citada), **INFERENCE** (deducción nuestra) o **RECOMMENDATION**.
> Los precios se reportan tal como aparecen en la fuente, con fecha; donde dos fuentes se contradicen, se dice. No se inventó ninguno.
> Método: ~40 búsquedas web + ~35 fetches de páginas primarias (sitios oficiales, help centers, docs de desarrollador, repos GitHub). Varias páginas devolvieron 403 (support.crunchtime.com, kb.7shifts.com, digitalcommons.fiu.edu, synergysuite.com/plans) y se marcan como **no verificadas**.

---

## 0. Resumen ejecutivo

1. **FACT.** Toda la industria del back-of-house (CrunchTime, Restaurant365, MarginEdge, xtraCHEF, MarketMan) calcula lo mismo con la misma aritmética: **uso real = inventario inicial + compras (± traspasos, ± producción) − inventario final**, **uso teórico = Σ (cantidad de receta × unidades vendidas por PMIX)**, y **varianza = real − teórico** (CrunchTime lo firma al revés: *teórico − real*). Ese es el producto entero; lo demás es UX, integraciones y confianza en los datos.
2. **FACT.** El eslabón débil universal es la **importación de ventas desde el POS**: MarginEdge la hace *cada noche*; xtraCHEF (Toast) la hace *diaria* y su reporte AvT tarda *2–3 días hábiles* en tener datos teóricos; Restaurant365 tiene el mapeo de modificadores **en beta y "sólo para POS seleccionados"** con la restricción de que *un modificador sólo puede ligarse a una receta*; los reseñadores de MarketMan reportan que al sincronizar con Square *"los productos y modificadores se multiplican"*.
3. **INFERENCE.** Fullsite ya tiene lo que esos proveedores tienen que pedir prestado: el flujo de eventos del POS (línea, modificador, void, descuento, pago, turno, corte) más un ledger de inventario con `recordMovement()` atómico y costo promedio (`dashboard-app/src/lib/inventory.ts:101,261`) y motor de costos por receta/subreceta (`dashboard-app/src/lib/cost-engine.ts:187,427`). La **explosión de recetas en tiempo real al nivel de modificador**, la **varianza por turno**, la **correlación void/merma** y la **conciliación caja-vs-ventas** son construibles con SQL sobre datos que ya existen, no proyectos de integración.
4. **INFERENCE.** Lo que **no** se vuelve más fácil: OCR de facturas (MarginEdge lo resuelve con *ML + revisión humana en 24–48 h*), EDI/GDSN con distribuidores, contabilidad/GL y cumplimiento. Ahí se compra o se asocia.
5. **RECOMMENDATION.** Secuencia: (1) AvT por turno sobre el event stream + PMIX exacto con modificadores → (2) conteos shelf-to-sheet y merma tipificada → (3) pedido sugerido = on-hand − par dinámico por pronóstico (fórmula pública de CrunchTime) usando `statsforecast` → (4) prep sugerido por subreceta → (5) facturas por **CFDI XML** (México ya tiene la factura estructurada; el OCR es para el remanente). No construir contabilidad, EDI, ni nómina.

---

## 1. Tabla producto por producto

| Producto | Core | Target | Precio (fuente/fecha) | Integración POS | Claims de IA | Diferenciador | Debilidad observable |
|---|---|---|---|---|---|---|---|
| **CrunchTime** (Net-Chef = Inventory, Teamworks = Labor, Ops Execution = ex-Zenput, Kitchen = ex-QSR Automations) | Inventario/AvT, pronóstico, pedido y prep sugerido, labor, tareas/food safety, KDS | Multi-unidad enterprise; "800 marcas, 150,000+ locales" tras fusión con QSR Automations (jun-2025) | No público. Tercero (restauranttools.ai, jul-2026): "$350/mes por local". R365 en su blog comparativo: "$5,000+/mes enterprise". **Contradicción**; ninguna es cifra del proveedor | Conectores nombrados: Simphony, Micros 3700, Aloha, PAR, Toast, Revel, Square, Squirrel, etc. Botón "Refresh POS Data" en Net-Chef para jalar el Sales Mix vía integración "Connex" (help center, 403 al fetch; visto en snippet). APIs GET/POST gratuitas + flat files "Crunchtime Data Pump" + streaming a Snowflake de pago | Pronóstico ML: "hasta 27% de mejora, >50% en algunas tiendas; muchas dentro de 10% MAPE". 4 capacidades (abr-2026): AI Analyst, conteo por voz "3–4x más rápido", Photo Intelligence, AI Actions | Suite completa + KDS propio; "suggested prep" con subrecetas "hasta 15 niveles" | Enterprise-only; precio opaco; POS externo sigue siendo *polling* de PMIX |
| **Restaurant365** (absorbió Compeat, jun-2021) | Contabilidad + inventario + labor + payroll | Multi-unidad SMB-enterprise; "28,000 restaurantes" post-Compeat | Página oficial: sólo "Get a Custom Quote". Blog propio: Essential "$469–$499", Professional "$689–$749" /local/mes. Terceros (Capterra, etc.): $399/$489. **Contradicción interna R365 vs terceros** | "POS Connect"; PMIX importado; **Menu Item Modifier Management en beta, "sólo POS y clientes seleccionados", "un modificador → una sola receta"** | "Smart Ops" (no se encontró doc técnico) | GL contable integrado (USAR-friendly) | Modificadores en beta; AvT depende de PMIX importado |
| **MarginEdge** | Facturas (foto→line items), recetas, AvT, bill pay | Independientes y grupos pequeños/medianos | Página oficial (2026): **$350/mes/local**, $500 con Freepour, −10% anual, +$50 para usuarios Toast. (El $330 del brief es cifra anterior; hoy es $350) | "50+ POS" (how-it-works) / "60+" (terceros). **"Importamos ventas y labor cada noche"** | ML + revisión humana en facturas, "24–48 h" | Invoice OCR con humanos en el loop; sin contrato | Latencia nocturna; usuarios: setup de recetas lento, datos crudos poco accesibles |
| **xtraCHEF by Toast** | Facturas, AvT, PMIX margin | Clientes Toast | No público; terceros: $149–$349 | Sync **diario** desde Toast; mapea "menu items & modifiers en Toast a recetas y modificadores de receta"; **datos teóricos disponibles "2–3 días hábiles" después del rango** | — | Nativo en Toast | Lock-in Toast; latencia de días |
| **MarketMan** | Inventario perpetuo, compras, proveedores | SMB y cadenas medianas | Terceros: Starter $199–$249, Growth $249–$299, Enterprise custom; setup $500. **Rangos difieren entre fuentes** | Claims "consulta a Toast en tiempo real"; "depleta con cada venta en Square" | — | Integración de distribuidores (Sysco, US Foods: precios, códigos, órdenes, facturas) | Reseñas: con Square "productos y modificadores se multiplican"; "invoice scanning no funcionaba 50% del tiempo" |
| **Craftable** (Bevager/Foodager) | Bebidas + alimentos, compras, AP, AvT | Bares, hoteles, multi-unidad | Terceros: "desde $99/usuario/mes" (no verificado con el proveedor) | Lista no verificada | — | Fuerte en bar/licor | Poca documentación pública técnica |
| **Fourth / HotSchedules** (Adaco para inventario) | Labor, scheduling, inventario hotel | Enterprise, hoteles | No público; terceros "$40/local/mes" HotSchedules | API Adaco pública (developer.fourth.com) | — | HotSchedules = estándar de scheduling en EE.UU. | Inventario orientado a hotel |
| **7shifts** | Scheduling, labor forecast, tips, payroll | SMB | Terceros: Comp gratis, Essentials $39.99, Pro $69.99, Premium $134.99–$149.99 /local/mes (**cifras varían entre fuentes**) | "50+ POS"; POS manda ventas para pronóstico, punches regresan | Labor forecast / "Optimal Labor" (KB devolvió 403) | Barato, mobile-first | Pronóstico sólo tan bueno como el POS le mande |
| **Tenzo** | BI + pronóstico | Multi-sitio UK/EU | Terceros: £80–£200 ($100–$250) /local/mes | "70+ integraciones"; empuja pronóstico a Planday, Deputy, MarketMan… | "30–50% más preciso que promedio móvil de 4 semanas"; daypart; 3 semanas adelante | Capa de BI agnóstica | No es sistema de registro |
| **Nory** | Ops + IA agéntica (forecast, rotas, pedidos) | Cadenas UK/IE | No público | POS integrado "datos cada 15 min" | "97% precisión demanda", "10–20% menos labor en 8 semanas" | Agentes que actúan | Claims de clientes, no benchmark |
| **Lineup.ai** | Pronóstico item-level + scheduling | SMB/franquicias EE.UU. | Oficial: **$79** (Forecasts) y **$149** (Forecasts+Scheduling) /local/mes, −10% anual | Toast, Brink, Square, Clover, Snowflake, Omnivore | Item-level forecasting | Precio público y simple | Sólo pronóstico |
| **PreciTaste** | Prep Assistant con IA | QSR/fast-casual (logos: Chipotle, First Watch franquicia, honeygrow, DIG) | No público | Usa ventas + PMIX + clima | "50% menos merma, 4+ h/tienda/día, −7% food cost, −2% labor" | Prep por lote guiado | Requiere disciplina de cocina |
| **Apicbase** | Menu engineering, inventario, procurement, producción | Multi-sitio EU | Sin cifras en pricing-plans; Growth "desde 5 outlets"; +15% si mensual; terceros $149–$160/mes | — | "Demand Forecasting" en Professional | Production Planning con lotes por subreceta | Precio opaco |
| **Meez** | Recetas para chefs, costeo, escalado | Chefs, grupos culinarios | Terceros (jul-2026): $19/$89/$179 mes + Enterprise | Ninguna profunda | — | UX de receta excelente | No es inventario |
| **Galley** | "Culinary Resource Planning" | Comisariatos, catering, food producers | Terceros: free tier, SMB $99/mes, enterprise custom | — | — | Producción por dependencias/vida útil | Nicho producción |
| **SynergySuite** | Back-office modular | Cadenas | Página de planes devolvió 403; terceros "desde $75/mes" | — | — | Modularidad | Sin verificación directa |
| **Yellow Dog** | Inventario retail/F&B | Hoteles, clubs, estadios | "Cotización por tienda / número de items" | — | — | Retail+F&B | Nicho |
| **Opsi** | Recetas, inventario, checklists | Independientes | Adquirido por GoTab (mar-2025) | GoTab | — | Fusionado al POS GoTab | Ya no independiente |
| **Ottimate** (ex Plate IQ) | AP automation, OCR facturas | Restaurantes/hospitality | No público | Motor "entrenado en Sysco, US Foods, PFG, Southern Glazer's" | OCR + aprobaciones | Mejor OCR de facturas de distribuidores EE.UU. | Sin precio; centrado en EE.UU. |
| **Veryfi** (API OCR) | OCR line-item por API | Developers | Oficial: $0.08 recibo, **$0.16 factura**, mínimo $500/mes en Starter; Free 100 docs | n/a | — | API pura, line items | Mínimo mensual alto para 1–5 tenants |
| **Google Document AI – Invoice Parser** | OCR por API | Developers | Oficial: $0.10 por bloque de 10 páginas | n/a | — | Barato, sin mínimo | Facturas MX requieren afinado |
| **Soft Restaurant** (MX) | POS + inventarios integrados | Restaurantes MX | No público | Nativo | — | Costeo por **costo promedio o último costo**, descuento automático al vender, existencia teórica | Legacy Windows |
| **Wansoft** (MX, "by Clip") | POS + paquete de inventarios (almacenes, salidas por almacén, recetas, subproductos, conversiones) | Restaurantes MX | Booklet PDF ilegible por fetch; no público | Nativo | — | Todo en un paquete (POS, KDS, checador, egresos, prenómina, inventarios) | Curso externo para configurar; conocimiento interno de Fullsite: ingesta manual, ver `project_wansoft_inventory_structure.md` |
| **Parrot** (MX) | POS + inventarios | Restaurantes MX | No público | Nativo | — | Recetas de artículo, **de modificador**, de producción y subrecetas; **compras por XML (CFDI)**; traspasos entre sucursales; mermas tipificadas; "costo teórico vs real" | Sin AvT por turno publicado |

Fuentes de la tabla: sección 7 y las URLs inline del §2.

---

## 2. Definiciones y fórmulas con fuente

### 2.1 Costo real (actual)
- **FACT — CrunchTime Net-Chef (help.crunchtime.com, reporte Actual/Theoretical Cost):** *Actual Value = Beginning + Purchases + Production − Transfers Out − Production Consumption Reversal − Ending*. Porcentajes sobre "Sales for GL": *Actual % = Actual ÷ Sales × 100*; *Logged Waste % = Adjustment Value ÷ Sales × 100*.
  https://help.crunchtime.com/NC/en/WebHelp_English/Content/English/NC_Reports/Actual_Theoretical_Cost.htm
- **FACT — xtraCHEF (Toast):** *Actual consumption = opening inventory + purchases − closing inventory*, con inicio/fin tomados de conteos físicos; requiere "al menos dos conteos".
  https://support.toasttab.com/en/article/xtraCHEF-Get-Started-With-Actual-vs-Theoretical-Analysis-Reports
- **FACT — Restaurant365:** "Actual Usage Dollar" se puede valuar por *Transaction Cost*, *Unit Cost* o *End Count Cost*; el reporte exige dos conteos (From/To) y transacciones POS del periodo.
  https://docs.restaurant365.com/docs/actual-vs-theoretical-analysis
- **FACT — USAR / prime cost:** COGS = inventario inicial + compras − inventario final; prime cost = COGS + labor. (R365 blog; el USAR 8.ª ed., NRA/Pearson 2012, ISBN 9780133142877, es la referencia normativa.)
  https://www.restaurant365.com/blog/how-to-calculate-prime-cost-in-a-restaurant/ · https://www.amazon.com/Uniform-System-Accounts-Restaurants-8th/dp/0133142876

### 2.2 Costo teórico
- **FACT — CrunchTime:** "lo que los costos *deberían* ser, con los costos actuales de inventario para los platillos vendidos, asumiendo porciones perfectas, sin roturas ni mermas".
  https://www.crunchtime.com/blog/blog/explaining-actual-vs-theoretical-food-cost-variance
- **FACT — xtraCHEF:** *Theoretical consumption = cantidad del ingrediente en receta × unidades vendidas del platillo*, repetido por cada platillo que contenga el ingrediente, tras "Product Mix Mapping".
- **FACT — R365:** "calcula uso teórico usando datos históricos de POS y PMIX".

### 2.3 Varianza (AvT)
- **FACT — CrunchTime:** *Variance Value = Theoretical − Actual* (signo teórico-menos-real). Ejemplo publicado: Austin 32.1% real − 29.5% teórico = 2.6 pts; Houston 0.9 pts. Causas listadas: recepción, facturación, preparación, porcionado, merma/caducidad, robo/ajustes sospechosos. Meta: "reducir la varianza a 0%".
- **FACT — xtraCHEF:** *Variance = actual − theoretical* (signo opuesto a CrunchTime). **Contradicción de convención de signo entre proveedores**; Fullsite debe fijar una y documentarla.
- **FACT — R365:** *Efficiency = teórico ÷ real*; *Unexplained variance = variance − waste*. Esta última es la más útil: separa merma registrada de merma inexplicada.

### 2.4 Recetas, subrecetas, rendimientos y merma
- **FACT — CrunchTime prep:** pronostica "subrecetas hasta 15 niveles"; al registrar producción, "graba las cantidades exactas usadas, p. ej. ocho cebollas, 15 jitomates".
  https://www.crunchtime.com/blog/blog/restaurant-food-prep-planning-methods
- **FACT — Parrot (MX):** recetas de artículo, de modificador, de producción y subrecetas; mermas por "caducidad, errores, mal estado"; eventos de producción.
  https://soporte.parrotsoftware.com.mx/es_MX/inventarios
- **FACT — Soft Restaurant (MX):** costeo por costo promedio o último costo; descuento automático al vender.
  https://softrestaurant.com/blog-restaurantero/como-hacer-el-costeo-de-recetas-en-un-restaurante
- **INFERENCE.** Ninguna fuente pública describe factores de rendimiento (yield %) como fórmula; se manejan como atributo del ingrediente (peso bruto → neto). Fullsite ya tiene `convertUnit()` y `calculateSubRecipeCost()` en `cost-engine.ts:158,187`.

### 2.5 Traspasos y comisariato
- **FACT.** CrunchTime incluye *Transfers Out* y *Production* en la fórmula de uso real (arriba). Parrot ofrece "transferencias entre sucursales". Galley optimiza producción "por dependencias de receta, tiempo de prep, vida útil, fecha de servicio".
  https://support.galleysolutions.com/how-to-create-a-production-plan-from-the-menu-plan

### 2.6 Pedido sugerido (par / forecast)
- **FACT — CrunchTime:** "Se parte del on-hand; se resta de un par **estático o dinámico** que sale de patrones de consumo y del pronóstico; el resultado se compara contra fechas de entrega para recomendar la cantidad exacta".
  https://www.crunchtime.com/blog/benefits-of-recommended-orders
- **FACT — Producción:** "need = forecast + par + consumo histórico; have = on-hand + pedidos pendientes".
  https://www.crunchtime.com/blog/how-to-translate-restaurant-sales-forecasts-into-better-prep-ordering-and-labor-planning

### 2.7 Catálogos de proveedor, EDI, GS1
- **FACT.** CrunchTime lista Sysco, US Foods, GFS, PFG, McLane, etc. como integraciones de proveedor. MarketMan: con Sysco/US Foods "se actualizan precios, códigos y nuevos ítems; las órdenes van directo y las facturas entran solas". Sysco y US Foods exigen a *sus proveedores* sincronizar por GDSN (GS1) y EDI 810 para facturas.
  https://www.crunchtime.com/integrations · https://www.marketman.com/partner-categories/distributors · https://mediacdn.sysco.com/images/rendition?id=3269d0d95d1fec3223ebf508382fcf386a7f3f3b
- **INFERENCE.** En México no existe el equivalente a Sysco con EDI abierto a restaurantes; lo que sí existe es el **CFDI XML obligatorio**, que Parrot ya ingiere ("compras por XML"). Eso convierte el problema de "invoice ingestion" mexicano en parsing de XML, no OCR — salvo remisiones/tickets de mercado.

### 2.8 Recepción y OCR de facturas
- **FACT — MarginEdge:** "capturamos todos los line items en 24–48 h, incluso garabatos a mano", con "ML + revisión humana".
  https://www.marginedge.com/how-it-works
- **FACT — Veryfi:** $0.16/factura, mínimo $500/mes. https://faq.veryfi.com/en/articles/3743986-what-are-the-plans-prices-for-ocr-api
- **FACT — Google Document AI Invoice Parser:** $0.10 por cada 10 páginas. https://cloud.google.com/document-ai/pricing
- **FACT — Ottimate:** OCR "entrenado en formatos de Sysco, US Foods, PFG, Southern Glazer's". https://ottimate.com/feature/invoice-automation/

### 2.9 Pronóstico
- **FACT — CrunchTime:** ML sobre histórico de la tienda y de la marca; "hasta 27% de mejora, >50% en algunas tiendas; muchas tiendas dentro de 10% de MAPE; una tienda a 13 centavos del real". Salidas: ventas, guests, checks.
  https://www.crunchtime.com/blog/how-crunchtimes-new-ai-forecasting-helps-restaurants-improve-profitability
- **FACT — Tenzo:** "30–50% más preciso que el promedio móvil de 4 semanas"; variables: clima, eventos, día, calendario escolar, estacionalidad; nivel **daypart**; horizonte 3 semanas.
  https://www.gotenzo.com/resources/insight/ai-demand-forecasting-for-restaurants/
- **FACT — Nory:** 96–98% de precisión reportada por clientes; datos POS "cada 15 minutos".
  https://www.nory.ai/blog/why-ai-forecasting-is-essential-for-restaurant-success
- **FACT — Lineup.ai:** item-level forecasting desde $79/local/mes. https://www.lineup.ai/pricing/
- **INFERENCE.** Ningún proveedor publica el algoritmo. "Promedio móvil de 4 semanas" es el baseline que todos dicen vencer; ninguno publica MAPE por ítem, sólo por ventas totales. Un claim de "97–99%" equivale a MAPE 1–3% a nivel tienda-día, no a nivel ítem.

### 2.10 Prep / producción
- **FACT — CrunchTime, PreciTaste, Apicbase:** prep por lote basado en pronóstico + subrecetas + vida útil; PreciTaste reclama "50% menos merma, 4 h/tienda/día".
  https://precitaste.com/daily-prep-management/ · https://get.apicbase.com/production-planning/

### 2.11 Labor
- **FACT — 7shifts:** el POS manda ventas para pronóstico y los punches regresan; SPLH = ventas ÷ horas trabajadas (KB 403; snippet de búsqueda).
  https://www.7shifts.com/blog/integrate-pos-with-scheduling-tool/

### 2.12 Conteos
- **FACT.** "Shelf-to-sheet": ordenar la hoja de conteo como está físicamente el almacén (izq→der, arriba→abajo); mismo día/hora siempre; cycle counts para ítems de alto valor.
  https://www.crunchtime.com/blog/5-best-practices-for-your-restaurants-inventory-workflow · https://www.marketman.com/blog/how-often-should-a-restaurant-take-inventory
- **FACT — CrunchTime abr-2026:** conteo por voz "3–4x más rápido".
  https://www.crunchtime.com/press/crunchtime-introduces-four-new-ai-capabilities-to-elevate-operations-management-lifecycle

### 2.13 Inventario perpetuo: cuándo ocurre la depleción
- **FACT.** MarketMan: "resta con cada compra registrada en el POS" (marketing). MarginEdge: importación **nocturna**. xtraCHEF: sync **diario**, AvT con **2–3 días** de rezago. CrunchTime: botón manual "Refresh POS Data" para traer el Sales Mix más reciente (implica que el flujo normal es programado).
  https://www.marketman.com/page/perpetual-inventory · https://www.marginedge.com/how-it-works · https://xtrachef.com/integration/toast/
- **INFERENCE.** Fuera de MarketMan-con-Square/Toast, el estándar de facto es **batch diario**. Y aun "tiempo real" en MarketMan es *polling* de un API externo con rate limits (Toast ~1 req/s/local según dev.family).

### 2.14 Menu engineering
- **FACT.** Kasavana & Smith (Michigan State, 1982): matriz margen de contribución × popularidad → Stars / Plowhorses / Puzzles / Dogs. Umbral clásico de popularidad: 70% de la mezcla esperada (1/n × 0.7). Referencia académica: *Menu Analysis: A Review of Techniques and Approaches* (FIU Hospitality Review; fetch 403, citado desde índice).
  https://www.researchgate.net/figure/Menu-classification-chart-Kasavana-and-Smith-1982_fig4_349534704 · https://digitalcommons.fiu.edu/cgi/viewcontent.cgi?article=1453&context=hospitalityreview
- **FACT.** CrunchTime lo vende como "Menu Engineering Analysis report". Meez y Foodics publican guías equivalentes.

---

## 3. La ventaja estructural: qué se vuelve fácil y qué no

### 3.1 Lo que los SaaS externos padecen (y dicen en público)
- **Latencia:** MarginEdge "cada noche"; xtraCHEF "diario" + "2–3 días hábiles" para AvT; CrunchTime con botón de refresh manual. (**FACT**, §2.13.)
- **Mapeo de ítems:** IDs internos del POS cambian tras re-importar el menú y rompen todo lo mapeado; se recomienda mapear contra un `external_id` estable. (**FACT**, https://plumpos.com/glossary/item-mapping.html · https://dev.family/blog/article/pos-integration-development-restaurants-retailers)
- **Mapeo de modificadores:** R365 "No Tomato" significa ingredientes distintos según ensalada/sándwich/hamburguesa; su solución está **en beta**, y **un modificador → una sola receta**. (**FACT**, https://docs.restaurant365.com/docs/pos-menu-item-modifier-management)
- **Duplicación:** MarketMan+Square "productos y modificadores se multiplican". (**FACT**, reseñas G2/Capterra vía checkthat.ai)
- **Fallas parciales:** "los puntos de lealtad se registran pero la deducción de inventario no". (**FACT**, dev.family)
- **Rate limits:** Toast ~1 req/s/local. (**FACT**, dev.family)

**INFERENCE.** Cada uno de esos dolores es un síntoma de una sola causa: el SaaS no es dueño del evento; recibe una foto del PMIX, sin contexto de turno, mesero, void ni caja.

### 3.2 Lo que se vuelve MUCHO más fácil para Fullsite

| Capacidad | Por qué el SaaS externo sufre | Por qué Fullsite no | Estado interno (verificado en disco) |
|---|---|---|---|
| **Depleción en tiempo real** | Polling nocturno/diario | El evento `order_line` ya existe al momento de "enviar"; `recordMovement()` es atómico y calcula costo promedio ponderado | `lib/inventory.ts:101,261-267` |
| **Explosión de receta a nivel modificador** | PMIX aplana modificadores; R365 beta; MarketMan duplica | Fullsite tiene la línea con sus modificadores y el `menu_item_id` estable; la receta de modificador es la misma tabla `pos_recipes` (Parrot ya lo hace nativo, es la referencia local) | `cost-engine.ts:187,427`; memoria `project_descuento_inventario_r1.md` (descuento por `menu_item_id`) |
| **Correlación void / merma** | No ven voids ni quién los hizo | Void es un evento con mesero, hora, motivo y platillo; se cruza con merma registrada y con varianza del ingrediente | Event stream POS |
| **Varianza por turno** | AvT entre dos conteos (semanal/mensual) | Con conteo de apertura/cierre por turno o cycle counts de ítems críticos, la fórmula CrunchTime se evalúa por turno; R365 "unexplained = variance − waste" por turno | Turnos/cortes (PRs serie 2026-09-02) |
| **Caja vs ventas** | Fuera de su alcance | Pagos, propinas, corte y arqueo son eventos propios | Turnos/cortes |
| **Tip pooling** | Necesitan payroll export | Propinas por ticket + PIN del mesero ya en el stream | AuthContext/PIN |
| **Labor real desde PIN clock-in** | Punches vienen de otro sistema | El PIN de entrada al POS *es* el punch; SPLH por hora sale de un `JOIN` | POS regresa al PIN tras cada acción (`project_pos_regresa_al_pin.md`) |
| **Pedido sugerido desde pronóstico por ítem** | Necesitan PMIX limpio por daypart | Fullsite tiene ventas por ítem, por hora, por canal; la fórmula pública de CrunchTime (on-hand − par dinámico vs. fecha de entrega) es implementable directo | `ocm_menu_items`, `ocm_daily` |
| **Menu engineering** | Necesitan costo teórico + PMIX | Ambos ya son columnas internas | `pos_recipes` ~27.6% (`project_food_cost_truth.md`) |
| **Prep sugerido** | Requiere forecast por ítem + subrecetas | Igual que arriba | `cost-engine.ts` subrecetas |

### 3.3 Lo que NO se vuelve más fácil
| Capacidad | Razón | Postura |
|---|---|---|
| **OCR de facturas/remisiones en papel** | Es visión + humanos; MarginEdge tarda 24–48 h con revisión humana | **Comprar API** (Document AI $0.10/10 págs; Veryfi con mínimo $500/mes es caro hasta ~10 tenants) y, sobre todo, **ingerir CFDI XML primero** (Parrot ya lo hace) |
| **EDI / GDSN con distribuidores** | Contratos B2B, GS1, mapeo de catálogos | No construir; en MX no hay Sysco; usar catálogos por CSV/XML del proveedor |
| **Contabilidad / GL / USAR** | Dominio regulatorio y de despacho contable | Exportar pólizas (CSV/Contpaqi/Aspel), no ser el GL |
| **Cumplimiento laboral / nómina** | Legal por país | Exportar horas; no calcular nómina |
| **Food safety / HACCP** | Sensores, checklists, auditoría; Ops Execution de CrunchTime vale por su red de 60,000 locales | Diferido; sólo si un cliente lo pide |

**INFERENCE.** La ventaja de Fullsite es *exactamente* lo que CrunchTime intenta comprar: la fusión con QSR Automations (KDS) y el "connected operations suite" (sep-2026) buscan meter los workflows en el KDS para dejar de depender del POS ajeno. Fullsite ya está en ese punto por construcción.

---

## 4. Secuencia recomendada para Fullsite

**RECOMMENDATION.** Orden por relación valor/esfuerzo, sujeto a la prioridad §20 del protocolo (P0 offline primero; esto es Fase "nuevas funciones e IA" y no debe abrirse antes de certificar el núcleo).

1. **AvT v0 sobre el event stream (semanas, no meses).**
   - Vista `theoretical_usage_by_shift`: Σ receta × líneas vendidas, **con modificadores** y con voids excluidos/segregados.
   - Vista `actual_usage_by_period`: inicial + compras + producción − traspasos − final (fórmula CrunchTime).
   - `variance`, `waste_logged`, `unexplained = variance − waste` (R365).
   - Fijar convención de signo (recomendado: *real − teórico*, positivo = pérdida).
   - Prueba con dos tenants (regla §12).
2. **Conteos shelf-to-sheet + merma tipificada.** Hoja ordenada por ubicación física; cycle counts diarios de 10–15 ítems de alto valor (Alamo Drafthouse: "top 10 productos = 60% de la merma", CrunchTime). Merma con motivo (caducidad/error/mal estado, como Parrot).
3. **Pedido sugerido.** `on_hand − par_dinámico(forecast, consumo) ` ajustado a fecha de entrega y empaque del proveedor. Pronóstico con `statsforecast` (AutoETS/MSTL por ítem-día; Croston/TSB para ítems intermitentes), baseline = promedio móvil 4 semanas para poder reportar la mejora igual que Tenzo.
4. **Prep sugerido por subreceta** con la misma serie por ítem × daypart, con vida útil como restricción.
5. **Ingesta de compras: CFDI XML primero** (parser propio, determinista), OCR después para el remanente (Document AI). Conciliación 3 vías: OC ↔ recepción ↔ CFDI.
6. **Labor:** SPLH por hora desde el PIN; pronóstico de cobertura; exportar horas. No nómina.
7. **Menu engineering:** matriz Kasavana-Smith con umbral 70% y CM promedio, ya con costo teórico vivo.

**Comprar / asociar:** OCR (Google Document AI por costo; Veryfi cuando el volumen justifique el mínimo), contabilidad (export a despacho), scheduling avanzado si un cliente lo exige (7shifts es barato y tiene API).

---

## 5. Referencias open-source para pronóstico

| REPO | STARS | LICENSE | LAST_ACTIVE | WHAT_FULLSITE_COULD_REUSE | RISKS |
|---|---|---|---|---|---|
| https://github.com/Nixtla/statsforecast | 4.9k | Apache-2.0 | Activo (releases 2026) | AutoARIMA/AutoETS/MSTL/Theta + **Croston/TSB/ADIDA para demanda intermitente** (ítems que venden 0 la mayoría de los días); "1M series en 30 min"; ideal para miles de ítems × tenants en batch nocturno | Python en un stack TS; correr como job (GitHub Actions/Edge) y guardar resultados en Supabase |
| https://github.com/facebook/prophet | 20.4k | MIT | **Maintenance mode desde v1.4.0 (2026-08-01): "no new features"** | Baseline explicable con feriados MX; bueno para demos | Congelado; lento ("500x más lento que statsforecast" según Nixtla); no maneja intermitencia |
| https://github.com/unit8co/darts | 9.5k | Apache-2.0 | Activo; integra Chronos-2, TimesFM, TFT | Covariables futuras (clima, feriados, eventos); intervalos de confianza; ensembles | Pesado (torch); más de lo que necesita un pedido sugerido v1 |
| https://github.com/sktime/sktime | 10k | BSD-3 | Activo (v1.1.0) | Pipelines/backtesting estandarizados para medir MAPE por ítem | Framework grande; curva de aprendizaje |
| https://github.com/ourownstory/neural_prophet | 4.3k | MIT | "En beta"; 73 issues abiertos | Autoregresión + covariables interpretables | Beta declarada; no para producción |
| https://github.com/amazon-science/chronos-forecasting | 5.9k | Apache-2.0 | Chronos-2 (2025-10-20) | **Zero-shot** con covariables: sirve para tenants nuevos sin histórico (problema que Tenzo admite) | Modelo 120M params; inferencia en CPU lenta para miles de series; validar contra statsforecast |
| https://github.com/Nixtla/neuralforecast · mlforecast · hierarchicalforecast | 4.3k / 1.3k / 758 | Apache-2.0 | Activos | `hierarchicalforecast` para reconciliar **tenant → sucursal → categoría → ítem** (coherencia entre niveles); `mlforecast` para LightGBM con features de calendario | Complejidad; empezar por statsforecast |

**RECOMMENDATION.** v1 = `statsforecast` (AutoETS + MSTL semanal/anual + TSB para intermitentes) con baseline promedio móvil 4 semanas y MAPE por ítem/daypart en una tabla `forecast_accuracy`. Chronos-2 sólo como fallback zero-shot para sucursales con < 8 semanas de datos.

---

## 6. Contradicciones encontradas

1. **Signo de la varianza:** CrunchTime = teórico − real; xtraCHEF = real − teórico.
2. **Precio CrunchTime:** "$350/mes/local" (restauranttools.ai) vs "$5,000+/mes" (blog de R365). Ninguna del proveedor.
3. **Precio R365:** $469–499 / $689–749 (blog R365) vs $399 / $489 (Capterra y otros). La página oficial no publica nada.
4. **Precio MarginEdge:** brief decía $330; página oficial hoy dice $350 (+$50 para Toast).
5. **Precio MarketMan:** $199/$249 vs $249/$299 según tercero.
6. **7shifts:** nombres y precios de planes difieren entre fuentes (Essentials/Pro/Premium vs Entrée/The Works/Gourmet).
7. **"Tiempo real" de MarketMan** es marketing de polling; reseñas reportan "sincronización retrasada entre ventas y stock".
8. **Chipotle y CrunchTime:** Chipotle usa **Ops Execution** (ex-Zenput, 3,200 locales); **Five Guys** usa **Inventory** (1,700+). Chipotle también aparece como logo de PreciTaste. No se encontró evidencia de Chipotle usando Net-Chef para AvT.
9. **Precisión de pronóstico:** "98–99%" (snippet de tercero sobre CrunchTime) vs el blog propio de CrunchTime, que habla de "dentro de 10% MAPE" y "27% de mejora". La fuente primaria es más modesta; usar esa.

---

## 7. Top 5 URLs

1. https://help.crunchtime.com/NC/en/WebHelp_English/Content/English/NC_Reports/Actual_Theoretical_Cost.htm — la fórmula completa de Net-Chef, con producción y traspasos.
2. https://support.toasttab.com/en/article/xtraCHEF-Get-Started-With-Actual-vs-Theoretical-Analysis-Reports — fórmula mínima + prueba del rezago de 2–3 días.
3. https://docs.restaurant365.com/docs/pos-menu-item-modifier-management — el dolor de modificadores, en beta, en palabras del proveedor.
4. https://www.crunchtime.com/blog/benefits-of-recommended-orders — lógica pública de pedido sugerido (on-hand, par dinámico, fecha de entrega).
5. https://github.com/Nixtla/statsforecast — el motor de pronóstico que conviene reutilizar.

Complementarias: https://www.marginedge.com/how-it-works (nocturno, 24–48 h) · https://www.crunchtime.com/press/qsr-automations-agrees-to-merge-with-crunchtime · https://soporte.parrotsoftware.com.mx/es_MX/inventarios (referencia local: recetas de modificador y compras por XML).

---

## 8. Qué NO construir

- **Contabilidad/GL/USAR**: exportar; R365 vive de eso y tiene 28,000 restaurantes de ventaja.
- **EDI/GDSN**: no existe el ecosistema en MX; los proveedores mandan CFDI.
- **OCR propio**: comprar API; el valor está en la conciliación, no en el reconocimiento.
- **Nómina y cumplimiento laboral**: exportar horas.
- **Food safety / sensores / checklists tipo Zenput**: diferido hasta demanda real.
- **Scheduling completo tipo HotSchedules**: 7shifts cuesta $40–$150/local y tiene API; Fullsite aporta el SPLH real, no el editor de turnos.
- **Un motor de pronóstico propio**: `statsforecast` ya resolvió AutoETS/MSTL/intermitencia; la IP de Fullsite es la *serie limpia por ítem-modificador-daypart-canal*, que nadie más tiene.

---

## Estado de verificación

- **Confirmado:** fórmulas CrunchTime/xtraCHEF/R365; precios oficiales de MarginEdge, Lineup.ai, Veryfi, Google Document AI; frecuencia nocturna MarginEdge y diaria xtraCHEF; modificadores R365 en beta; fusión CrunchTime–QSR Automations y 4 capacidades de IA; stars/licencias de los 7 repos; capacidades de Parrot y Soft Restaurant.
- **Inferido:** todo el §3 y §4; que el batch diario es el estándar de facto; que CFDI reemplaza el OCR en MX para la mayoría de compras.
- **Pendiente / no verificado:** support.crunchtime.com (403), kb.7shifts.com (403), synergysuite.com/plans (403), digitalcommons.fiu.edu (403), booklet de Wansoft (PDF sin texto extraíble), pricing de Craftable/Fourth/Tenzo/Apicbase (sólo terceros). Presupuesto de búsqueda web agotado en 200 consultas; Ottimate pricing y Toast inventory nativo quedaron sin búsqueda dedicada.
