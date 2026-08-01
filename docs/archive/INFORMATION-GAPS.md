# Information Gaps — Auditoría de Conocimiento

**Fecha:** 2026-07-21
**Objetivo:** Convertir conocimiento tácito en explícito. Identificar todo lo que depende de supuestos, memoria o contexto no documentado.

---

## 1. Producto

### 1.1 Límites de rendimiento del POS
- **Qué sabemos:** POS funciona con ~500 items de menú y ~30 mesas para AMALAY
- **Qué no sabemos:** ¿Cuántos items/mesas/órdenes simultáneas soporta antes de degradarse? ¿El POS de 5,158 líneas escala a 100+ items por categoría? ¿Qué pasa con 200+ mesas?
- **Por qué importa:** Un restaurante grande podría tener 1,000+ items o 100+ mesas
- **Cómo obtener:** Load testing con datos sintéticos. Medir tiempo de render por cantidad de items.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido

### 1.2 Comportamiento real offline
- **Qué sabemos:** IndexedDB queue existe. Electron tiene retry con offline.html. Service worker deshabilitado intencionalmente.
- **Qué no sabemos:** ¿Cuántas órdenes puede acumular offline? ¿Qué pasa si pierde internet por 2 horas con 50 órdenes en cola? ¿La sincronización maneja conflictos correctamente? ¿Qué pasa si dos terminales operan offline y luego sincronizan?
- **Por qué importa:** Restaurantes en zonas con internet inestable. Cortes de luz.
- **Cómo obtener:** Test controlado: desconectar internet, operar 30 min, reconectar, verificar.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — código existe pero nunca se probó en escenario real prolongado

### 1.3 Concurrencia multi-terminal
- **Qué sabemos:** Concurrency check existe para evitar double payment en órdenes modificadas. Operation lock previene double-tap.
- **Qué no sabemos:** ¿Qué pasa si terminal A edita una orden mientras terminal B la cobra? ¿El realtime de Supabase mantiene las mesas sincronizadas entre terminales? ¿Hay race conditions en el split de cuenta?
- **Por qué importa:** AMALAY tiene 3 terminales. Restaurantes más grandes podrían tener 5+.
- **Cómo obtener:** Test con 2 browsers abiertos en la misma mesa, operaciones simultáneas.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — mitigaciones existen pero no hay test end-to-end de concurrencia

### 1.4 Precisión del food cost en producción
- **Qué sabemos:** 97% del revenue tiene food cost calculable. Cost engine validado contra 9 sub-recetas de Wansoft (8/9 dentro de 3%).
- **Qué no sabemos:** ¿El food cost calculado por Fullsite coincide con el margen real que observa el restaurante? ¿Los costos promedio ponderados se mantienen precisos después de semanas de operación? ¿La merma real coincide con lo registrado?
- **Por qué importa:** Si el food cost es inexacto, las decisiones de pricing son incorrectas.
- **Cómo obtener:** Comparar food cost Fullsite vs contabilidad real de AMALAY después de 1 mes de operación.
- **Impacto:** P2
- **Estado:** 🟡 Parcial — validado teóricamente, no en producción continua

---

## 2. Operación

### 2.1 Flujo real del almacenista
- **Qué sabemos:** Alex es el almacenista de AMALAY. Hace conteo manual. Las páginas de entradas/merma/toma física ya escriben al stock real.
- **Qué no sabemos:** ¿Alex sabe usar las páginas del dashboard? ¿El flujo de toma física es práctico para 700+ ingredientes? ¿Cuánto tarda un conteo real? ¿Necesita barcode scanner?
- **Por qué importa:** Si el almacenista no puede usar el sistema, el inventario se desactualiza.
- **Cómo obtener:** Observar a Alex haciendo un conteo con Fullsite. Medir tiempo y fricciones.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido — nunca se ha observado uso real del módulo de inventario

### 2.2 Proceso de cierre de día completo
- **Qué sabemos:** CierreCajaWizard existe. Corte de turno funciona. Wansoft tiene un flujo de cierre detallado.
- **Qué no sabemos:** ¿El flujo de cierre de Fullsite cubre todo lo que el gerente necesita? ¿Falta algo que Wansoft hacía y Fullsite no? ¿El reporte de cierre coincide con lo que el cajero contó físicamente?
- **Por qué importa:** El cierre es el momento de verdad financiera del día.
- **Cómo obtener:** Hacer un cierre completo en paralelo con Wansoft y comparar.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — Eduardo revisó pero no se hizo cierre paralelo

### 2.3 Volumen de facturación diaria
- **Qué sabemos:** AMALAY emite 400-430 CFDIs/mes (~15/día). Facturama cuesta $1,650/año.
- **Qué no sabemos:** ¿Cuánto tarda el timbrado en promedio? ¿El flujo self-service (QR) es intuitivo para el cliente? ¿Qué porcentaje de clientes realmente escanea el QR vs pide factura en caja?
- **Por qué importa:** Si el flujo es lento o confuso, el cajero se convierte en soporte de facturación.
- **Cómo obtener:** Activar Facturama y observar 1 semana de operación real.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido — 0 CFDIs emitidos en Fullsite producción

---

## 3. Wansoft y Migración

### 3.1 ¿Qué pasa el día que se apaga Wansoft?
- **Qué sabemos:** Los scrapers dependen de Wansoft para ventas diarias (wansoft_daily). Cookie relay funciona pero expira en ~55 min.
- **Qué no sabemos:** ¿Wansoft permite exportar todos los datos antes de cerrar la cuenta? ¿Hay datos en Wansoft que no hemos extraído y que serían irrecuperables? ¿Wansoft cobra penalización por cancelación?
- **Por qué importa:** El cutover requiere tener toda la información necesaria ANTES de apagar Wansoft.
- **Cómo obtener:** Preguntar a Wansoft sobre proceso de cancelación y exportación. Revisar contrato.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido

### 3.2 Componentes de sub-recetas
- **Qué sabemos:** `pos_sub_recipe_ingredients` está vacía. La extracción via `GetSubProductRecipe` solo obtuvo 2 sub-recetas. Hay ~108 sub-recetas en Wansoft.
- **Qué no sabemos:** ¿Por qué la extracción solo obtuvo 2? ¿El endpoint requiere autenticación diferente? ¿Hay un listado completo de sub-product IDs que podamos iterar? ¿Eduardo tiene los componentes en Excel?
- **Por qué importa:** Sin componentes, el cost engine no calcula food cost de sub-recetas. 44 ingredientes afectados.
- **Cómo obtener:** DevTools bookmarklet iterando `GetSubProductListBySubsidiary` + `GetSubProductRecipe` como hicimos con recetas.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — sabemos que existen, no pudimos extraerlos

### 3.3 Endpoints de inventario rotos en Wansoft
- **Qué sabemos:** `GetInventoryBySubsidiary`, `GetInventoryStatementBySubsidiary`, `GetPhysicalInventoryVsSystem` retornan HTTP 500.
- **Qué no sabemos:** ¿Es un bug temporal o permanente? ¿Solo afecta a AMALAY o a todos los clientes de Wansoft? ¿Wansoft sabe del problema? ¿Hay un endpoint alternativo?
- **Por qué importa:** Sin sync de inventario automático, el stock inicial requiere conteo físico manual.
- **Cómo obtener:** Reportar a Wansoft soporte. Probar en otra fecha. Verificar si el error es por subsidiaryId.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido — no sabemos si es permanente

---

## 4. Infraestructura

### 4.1 Límites de Supabase (free tier vs pro)
- **Qué sabemos:** Proyecto actual: `qjiomlvudfmzuvqvhwpk`. Funciona con AMALAY + tests.
- **Qué no sabemos:** ¿En qué plan está? ¿Cuántas filas/requests soporta antes de throttling? ¿Cuánto cuesta escalar a 10 clientes? ¿El free tier tiene límite de connections simultáneas? ¿Cuándo necesitamos migrar a pro?
- **Por qué importa:** 10 restaurantes × 50 órdenes/día × 30 días = 15,000 órdenes/mes. Plus queries de dashboard, agentes, chat.
- **Cómo obtener:** Revisar dashboard de Supabase, verificar plan actual, calcular proyección.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — funciona hoy, no sabemos el techo

### 4.2 Seguridad real del multi-tenant
- **Qué sabemos:** Todos los queries tienen `client_id` filter. RLS habilitado en 102 tablas. 194 policies.
- **Qué no sabemos:** ¿Las policies realmente filtran por client_id o son `USING (true)` permisivas? ¿Un usuario autenticado de un cliente puede ver datos de otro si hace una request directa a Supabase? ¿El anon key permite bypass de RLS en alguna tabla?
- **Por qué importa:** Un data leak entre clientes es un problema legal y de confianza.
- **Cómo obtener:** Auditoría de las 194 policies para verificar que filtran por `auth.uid()` o `client_id`. Pen test manual.
- **Impacto:** P0
- **Estado:** 🟡 Parcial — RLS existe pero no se ha auditado policy por policy

### 4.3 Backup y disaster recovery
- **Qué sabemos:** Supabase tiene backups automáticos (plan dependiente).
- **Qué no sabemos:** ¿Cada cuánto se hace backup? ¿Podemos restaurar a un punto específico? ¿Hay backup de los archivos del Electron app? ¿Si Supabase tiene downtime, qué pasa con las terminales?
- **Por qué importa:** Un restaurante no puede dejar de operar. Necesitan saber que los datos están seguros.
- **Cómo obtener:** Verificar plan de Supabase, probar restore, documentar procedimiento.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido

### 4.4 Vercel deployment pipeline
- **Qué sabemos:** Push a main → auto-deploy en Vercel. No hay staging. No hay preview deployments configurados.
- **Qué no sabemos:** ¿Qué pasa si un deploy rompe algo? ¿Cuánto tarda un rollback? ¿Podemos hacer deploy por cliente (feature flags)? ¿El build time afecta la disponibilidad?
- **Por qué importa:** Un deploy roto a las 12pm afecta a todos los restaurantes simultáneamente.
- **Cómo obtener:** Configurar preview deployments. Definir proceso de rollback. Considerar blue-green.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — funciona pero sin red de seguridad

---

## 5. IA y Agentes

### 5.1 Costo real de IA por cliente
- **Qué sabemos:** Chat usa Groq (gratis con rate limits). Agentes usan Groq. Claude Haiku como fallback ~$35/mes.
- **Qué no sabemos:** ¿Cuántas queries de chat genera un restaurante activo por día? ¿Groq tiene rate limits que impactan a 10 clientes? ¿El costo escala linealmente? ¿Cuándo necesitamos pagar por un modelo?
- **Por qué importa:** COGS por restaurante estimado en $285 MXN — si IA sube, el margen baja.
- **Cómo obtener:** Instrumentar queries por cliente en chat_logs. Proyectar para 10 clientes.
- **Impacto:** P2
- **Estado:** 🟡 Parcial — estimado pero no medido en producción multi-cliente

### 5.2 Calidad de agentes sin Wansoft
- **Qué sabemos:** Los agentes de anomalías, predicción y upselling leen de `wansoft_daily`. Un cliente sin Wansoft no tiene esa tabla.
- **Qué no sabemos:** ¿Los agentes pueden leer de `pos_orders` directamente? ¿Necesitan un adapter? ¿Cuántos días de operación necesita un cliente nuevo para que los agentes tengan datos útiles?
- **Por qué importa:** Si vendemos "30 agentes de IA" y el cliente nuevo solo ve dashboards vacíos, pierde confianza.
- **Cómo obtener:** Ejecutar agentes contra datos de pos_orders en vez de wansoft_daily. Medir mínimo viable de datos.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido — nunca se probó sin Wansoft

### 5.3 Hallucination rate del chat
- **Qué sabemos:** El chat alucinó $63,544 de un ejemplo hardcodeado en el prompt. Se corrigió.
- **Qué no sabemos:** ¿Con qué frecuencia el chat inventa datos? ¿Hay otros ejemplos numéricos en el prompt que podrían causar el mismo problema? ¿El modelo de Groq es más propenso a hallucination que Claude?
- **Por qué importa:** Si el gerente toma decisiones basadas en datos inventados, la confianza se destruye.
- **Cómo obtener:** Audit del prompt completo. Test con preguntas donde no hay datos. Monitorear `had_error` en chat_logs.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — se arregló 1 caso, no se auditó el prompt completo

---

## 6. Customer #2 / Onboarding

### 6.1 Perfil del cliente ideal #2
- **Qué sabemos:** ICP Playbook define 3 segmentos. Susy recomienda perfilar antes de vender.
- **Qué no sabemos:** ¿Qué tipo de restaurante es el candidato ideal para la segunda instalación? ¿Uno similar a AMALAY (café/brunch) o uno diferente (casual dining, taquería)? ¿Cuántas mesas, meseros, platillos son el sweet spot?
- **Por qué importa:** Un cliente muy diferente a AMALAY expone gaps que no hemos encontrado.
- **Cómo obtener:** Definir con Daniel. Considerar complejidad operativa, no solo tamaño.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — ICP existe pero no se ha decidido el cliente #2

### 6.2 Tiempo real de instalación
- **Qué sabemos:** Estimamos 2-4 horas de onboarding + 1 día de validación. AMALAY tomó meses pero eso incluye construir el producto.
- **Qué no sabemos:** ¿Cuánto tarda realmente importar un menú de 500 items? ¿Cuánto tarda configurar 3 impresoras? ¿Cuánto tarda capacitar a 10 meseros? ¿Qué porcentaje del tiempo es técnico vs operativo?
- **Por qué importa:** El pricing incluye instalación gratis. Si tarda 3 días, no es viable.
- **Cómo obtener:** Solo se sabe haciendo la primera instalación nueva.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido — nunca se ha instalado en un restaurante nuevo

### 6.3 Soporte post-instalación
- **Qué sabemos:** Daniel hace soporte remoto + presencial. Eduardo conoce el sistema.
- **Qué no sabemos:** ¿Cuántas incidencias genera un restaurante en la primera semana? ¿Qué tipo de incidencias son más comunes? ¿Se necesita soporte 24/7? ¿Cuánto cuesta dar soporte a 10 clientes?
- **Por qué importa:** Sin soporte, el cliente abandona. Con demasiado soporte, no escala.
- **Cómo obtener:** Documentar cada incidencia de AMALAY durante 1 mes. Clasificar por tipo y frecuencia.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido

---

## 7. Hardware e Impresoras

### 7.1 Compatibilidad de impresoras
- **Qué sabemos:** ESC/POS compatible. AMALAY usa impresoras TCP en cocina/barra y USB en caja.
- **Qué no sabemos:** ¿Qué modelos exactos funcionan? ¿Star, Epson, Bixolon? ¿Todos los modelos ESC/POS interpretan los comandos igual? ¿El QR se imprime correctamente en todas las marcas? ¿Qué ancho de papel soportamos (58mm vs 80mm)?
- **Por qué importa:** Un restaurante nuevo puede tener impresoras de otra marca.
- **Cómo obtener:** Probar con 2-3 modelos diferentes. Documentar los probados.
- **Impacto:** P1
- **Estado:** 🟡 Parcial — funciona con las de AMALAY, no probado con otras

### 7.2 Requisitos de red
- **Qué sabemos:** Terminal se conecta a `app.fullsite.mx` via HTTPS. Impresoras por TCP/IP en red local.
- **Qué no sabemos:** ¿Qué ancho de banda mínimo necesita? ¿Qué latencia es aceptable? ¿Funciona con WiFi de restaurante (generalmente saturado)? ¿Necesita red dedicada? ¿Qué pasa si las impresoras están en otra VLAN?
- **Por qué importa:** Muchos restaurantes tienen WiFi inestable.
- **Cómo obtener:** Medir throughput real durante operación de AMALAY. Documentar requisitos mínimos.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido

---

## 8. Inventario y Recetas

### 8.1 Precisión de la deducción automática
- **Qué sabemos:** `deductIngredientsForOrder()` reactivada. Sub-recipes no se deducen. Floor a 0.
- **Qué no sabemos:** ¿Las recetas importadas de Wansoft son exactas? ¿Las porciones en producción coinciden con la receta en sistema? ¿Cuánta merma no registrada hay? ¿Después de 1 semana de operación, el inventario del sistema coincide con el conteo físico?
- **Por qué importa:** Si la deducción es inexacta, el inventario del sistema diverge de la realidad rápidamente.
- **Cómo obtener:** Operar 1 semana con deducción activa. Hacer conteo físico. Comparar.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido — deducción nunca operó en producción real de AMALAY

### 8.2 Rendimiento (yield factor) real
- **Qué sabemos:** 1,063 ingredientes tienen yield_factor. Frijol negro = 2.5 (expansión). Mayoría = 1 (default).
- **Qué no sabemos:** ¿Los yield factors de Wansoft son correctos? ¿Los ha validado alguien? ¿El rendimiento real varía por proveedor o temporada?
- **Por qué importa:** Yield factor afecta el costo real. Un 10% de error en yield = 10% de error en food cost.
- **Cómo obtener:** Eduardo/Mónica pueden validar los top 20 ingredientes.
- **Impacto:** P2
- **Estado:** 🟡 Parcial — datos existen pero no validados

---

## 9. Facturación (CFDI)

### 9.1 Régimen fiscal por cliente
- **Qué sabemos:** AMALAY es persona moral. Facturama soporta mono-emisor (1 RFC) y multi-emisor (API Lite).
- **Qué no sabemos:** ¿Un cliente de Fullsite en régimen de persona física necesita configuración diferente? ¿Facturama multi-emisor realmente funciona para N clientes? ¿Cada cliente necesita su propio CSD o se puede facturar bajo Fullsite?
- **Por qué importa:** El modelo de facturación para SaaS multi-cliente no está definido.
- **Cómo obtener:** Consultar con Andy (contador) y Facturama soporte.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido

### 9.2 Complemento de pago (PPD)
- **Qué sabemos:** El endpoint `POST /api/factura/complemento-pago` existe. Código implementado.
- **Qué no sabemos:** ¿Funciona en producción? ¿Algún cliente de AMALAY usa PPD? ¿Cuál es el flujo de UI para el operador?
- **Por qué importa:** Algunos clientes de restaurantes pagan a crédito (eventos, empresas).
- **Cómo obtener:** Probar con Facturama sandbox.
- **Impacto:** P3
- **Estado:** 🟡 Parcial — código existe, nunca probado

---

## 10. Riesgos Técnicos

### 10.1 POS monolito (5,158 líneas)
- **Qué sabemos:** `pos/page.tsx` es un solo archivo con 5,158 líneas. Todo el POS vive ahí.
- **Qué no sabemos:** ¿Cuánto afecta al performance del build? ¿Es mantenible a largo plazo? ¿Un cambio en el payment flow puede romper el modifier flow? ¿Se puede hacer code splitting?
- **Por qué importa:** Cada bug fix o feature toca un archivo de 5K líneas. Alto riesgo de regresión.
- **Cómo obtener:** Medir build time. Evaluar split en componentes. Pero NO hacerlo ahora.
- **Impacto:** P3
- **Estado:** 🟡 Parcial — funciona pero es deuda técnica conocida

### 10.2 Dependencia de Groq
- **Qué sabemos:** Chat, coach, voice usan Groq (gratis). No hay fallback activo.
- **Qué no sabemos:** ¿Groq tiene SLA? ¿Cuánto downtime ha tenido? ¿Si Groq falla, el chat muestra error o se cuelga? ¿Podemos switchear a Claude Haiku en runtime?
- **Por qué importa:** Si Groq cae, toda la IA de Fullsite cae.
- **Cómo obtener:** Configurar fallback a Claude Haiku. Monitorear uptime de Groq.
- **Impacto:** P2
- **Estado:** 🟡 Parcial — fallback existe en código pero no verificado

---

## 11. Riesgos de Negocio

### 11.1 Unit economics reales
- **Qué sabemos:** Precio: $1,999/mes. COGS estimado: $285/mes. Margen bruto: ~86%.
- **Qué no sabemos:** ¿El COGS incluye soporte humano? ¿Cuántas horas de soporte consume un cliente/mes? ¿El costo de adquisición de cliente es viable? ¿Cuánto tardamos en hacer break-even con 5 clientes?
- **Por qué importa:** Si el soporte cuesta más que el margen, el modelo no escala.
- **Cómo obtener:** Trackear horas de soporte por incidencia después de instalar cliente #2.
- **Impacto:** P1
- **Estado:** 🔴 Desconocido — estimado teórico, nunca medido

### 11.2 Churn risk
- **Qué sabemos:** Susy dice churn en POS es ~2%. AMALAY no ha churneado (es de Daniel).
- **Qué no sabemos:** ¿Qué haría que un cliente abandone Fullsite en los primeros 30 días? ¿Cuáles son las fricciones más comunes? ¿Qué features son deal-breakers para diferentes tipos de restaurantes?
- **Por qué importa:** Adquirir un cliente cuesta tiempo y credibilidad. Perderlo en 30 días es destructivo.
- **Cómo obtener:** Solo se descubre con clientes reales + exit interviews.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido

---

## 12. Documentación Faltante

### 12.1 Docs para el equipo técnico
- **Qué sabemos:** CLAUDE.md es extenso. Hay docs de diseño en `/docs/design/`. Memory files documentan decisiones.
- **Qué no sabemos:** ¿Un nuevo desarrollador puede levantar el ambiente en <1 hora? ¿Hay instrucciones de setup? ¿Las 52 + 45 migrations son ejecutables en orden? ¿Hay docs de arquitectura visual (diagramas)?
- **Por qué importa:** Si Daniel es el único que puede mantener Fullsite, no escala como empresa.
- **Cómo obtener:** Escribir README de setup. Diagramas de arquitectura. Runbook de deployment.
- **Impacto:** P2
- **Estado:** 🟡 Parcial — CLAUDE.md es bueno pero orientado a Claude, no a humanos

### 12.2 Docs para el cliente (operador)
- **Qué sabemos:** `capacitacion-meseros.md` existe con 14 secciones.
- **Qué no sabemos:** ¿Es suficiente? ¿Necesita videos? ¿El gerente necesita docs diferentes al mesero? ¿Hay docs para el cajero, el almacenista, el contador?
- **Por qué importa:** Sin docs, cada instalación requiere capacitación presencial personalizada.
- **Cómo obtener:** Feedback de Eduardo y staff de AMALAY sobre qué necesitan.
- **Impacto:** P2
- **Estado:** 🟡 Parcial

### 12.3 Runbook de incidencias
- **Qué sabemos:** No existe. Las incidencias se resuelven ad-hoc.
- **Qué no sabemos:** ¿Cuáles son las incidencias más comunes? ¿Cuál es el proceso para "impresora dejó de imprimir"? ¿Quién contacta a quién? ¿Hay escalamiento?
- **Por qué importa:** Sin runbook, cada incidencia es una emergencia.
- **Cómo obtener:** Documentar las primeras 20 incidencias como playbook.
- **Impacto:** P2
- **Estado:** 🔴 Desconocido

---

## Resumen Ejecutivo

### Top 10 Huecos de Información Más Importantes

| # | Hueco | Impacto | Estado |
|---|---|---|---|
| 1 | **Seguridad RLS real** — ¿las policies filtran correctamente o son permisivas? | P0 | 🟡 |
| 2 | **Deducción en producción real** — nunca operó en AMALAY con órdenes reales | P1 | 🔴 |
| 3 | **Offline prolongado** — no probado con 50 órdenes sin internet | P1 | 🟡 |
| 4 | **Tiempo real de instalación** — nunca se instaló en un restaurante nuevo | P1 | 🔴 |
| 5 | **Qué pasa al apagar Wansoft** — proceso de cancelación desconocido | P1 | 🔴 |
| 6 | **Componentes de sub-recetas** — extracción falló, 44 ingredientes afectados | P1 | 🟡 |
| 7 | **Backup y disaster recovery** — plan desconocido | P1 | 🔴 |
| 8 | **Hallucination rate del chat** — solo se corrigió 1 caso | P1 | 🟡 |
| 9 | **Unit economics reales** — soporte no medido | P1 | 🔴 |
| 10 | **Compatibilidad de impresoras** — solo probado con las de AMALAY | P1 | 🟡 |

### Resolver ANTES del cliente #2

| Hueco | Acción concreta |
|---|---|
| RLS audit | Revisar las 194 policies. Verificar que filtran por client_id, no `USING (true)`. |
| Deducción en producción | Validar esta noche en AMALAY con la checklist. |
| Instalación end-to-end | Ejecutar la certificación con `fullsite_certification` y medir tiempo. |
| Printer compatibility | Conseguir 1 impresora de marca diferente y probar. |

### Descubrir durante las siguientes instalaciones

| Hueco | Por qué esperar |
|---|---|
| Tiempo real de instalación | Solo se sabe haciendo la primera. |
| Soporte post-instalación | Solo se sabe operando con un cliente real. |
| Churn risk | Requiere meses de operación. |
| Unit economics reales | Requiere datos de soporte + operación. |
| Offline prolongado | Mejor probar en condiciones reales que simuladas. |

### Probablemente nunca valga la pena resolver

| Hueco | Razón |
|---|---|
| Load testing exhaustivo | Restaurantes no tienen 1,000+ items. Optimizar cuando haya evidencia de problema. |
| Yield factor exacto por ingrediente | Varía por temporada y proveedor. Mejor ajustar con entradas/merma reales. |
| Docs tipo SaaS enterprise | Overengineering para el stage actual. Docs mínimos + soporte directo. |
| Complemento de pago PPD | <5% de clientes lo necesitan. Resolver caso por caso. |
