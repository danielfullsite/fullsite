# Fullsite — El Experto de IA en tu Restaurante · Catálogo completo de ideas

> Brain-dump maestro de lo que Fullsite puede ser de esquina a esquina. La tesis:
> **el POS es el sensor, la IA es el producto.** Cada terminal, cada ticket, cada
> comanda, cada ajuste de inventario es un dato; la IA los cruza y le habla al dueño
> como lo haría el mejor gerente que jamás podrá contratar.
>
> Cada idea marca su tier: **🟢 software con la data que ya capturamos** ·
> **🟡 necesita hardware/integración** · **🔵 moonshot**. Lo honesto arriba: el ~70%
> del valor son 🟢 — ya se puede vender. El hardware es el "wow"; la conversación es
> el hábito diario. Ver también el deep-dive de inventario:
> [`COPILOTO-RENTABILIDAD-ANTIROBO.md`](./COPILOTO-RENTABILIDAD-ANTIROBO.md).

**North star:** el dueño abre Fullsite y en 10 segundos sabe *"¿cuánto gané, cuánto me
robaron, qué está en riesgo, y qué hago hoy?"* — sin buscar en ningún reporte.

---

## 1. 💰 Rentabilidad & Robo de Inventario  *(el dolor #1 — deep-dive aparte)*
- **Variance teórico vs real en pesos** por insumo/turno/persona. 🟢
- **Conteo físico obligado + conteo ciego** (te regaña si no lo hiciste; no muestra el teórico para que nadie lo maquille). 🟢
- **Robo hormiga:** correlación POS↔inventario (licor que baja más que las margaritas vendidas), básculas inteligentes, cámara con evidencia en video. 🟢/🟡/🔵
- **Sobre-porción / yield** (el rib eye que rinde 6.2 vs 7.0 porciones/kg). 🟢

## 2. 🔮 Pronóstico & Demanda
- **Predicción de cierre del día** a las 2/4/6pm ("vas a cerrar en ~$38k"). 🟢
- **Pronóstico de demanda** por día de la semana + clima + eventos locales → *cuánto preparar de cada cosa* (mise en place que evita merma y faltantes). 🟢/🟡
- **Clima → demanda:** llueve el sábado → ajusta compras y staff. 🟡 (API de clima)
- **Detección de anomalías:** hoy las ventas van 30% abajo del patrón a esta hora → alerta temprana, no post-mortem. 🟢
- **Calendario de eventos** (partido, concierto, quincena, día de pago) → sube el pronóstico. 🟡

## 3. 🧑‍🍳 Meseros, Staff & Capacitación  *(dolor #1 de Eduardo)*
- **Coach de upselling por mesero:** "Rodrigo dejó de ofrecer entradas, su ticket cayó 12% → capacítalo". 🟢
- **El mejor mesero como maestro:** detecta a Fernanda (+18% ticket) y convierte su técnica en el guion del pre-turno. 🟢
- **Propinas justas y transparentes** (reparto por venta/hora, detecta el que se queda de más). 🟢
- **Staffing óptimo:** cuántos meseros/cocineros por bloque según pronóstico (sábado 21h sub-dotado). 🟢
- **Onboarding en 30 segundos** (alta con PIN autogenerado — ya construido). 🟢
- **Control anti-fraude por persona:** cancelaciones/descuentos concentrados en un empleado. 🟢
- **Micro-capacitación en el POS:** tips contextuales ("sugiere coctel en mesas de 2"), quizzes de menú. 🟢
- **Ranking de productividad** (ventas/hora, mesas atendidas, attach rate) sin que se sienta vigilancia sino coaching. 🟢

## 4. 🍳 Cocina & KDS
- **Tiempos de preparación** por platillo/estación; alerta cuando la cocina se satura (vie/sáb 21-23h). 🟢
- **Calidad:** monitorea cancelaciones/recomandas como señal de calidad; qué platillo se devuelve más. 🟢
- **Auto-86 inteligente:** predice qué se va a agotar y sugiere 86 antes de que el mesero lo venda. 🟢
- **Mise en place dirigido:** según el pronóstico, cuánto prepichar de cada cosa hoy. 🟢
- **Cadena de frío:** sensores de temperatura en refris/congeladores → alerta si sube (merma + salud). 🟡
- **Voz en cocina:** el cocinero marca "listo" o pide insumo por voz, manos libres. 🔵

## 5. 🧾 Clientes, CRM & Lealtad
- **Recuperación de inactivos** por WhatsApp (ya iniciado; 120 clientes sin volver = campaña con incentivo). 🟢/🟡
- **Cumpleaños & fechas** automáticas (mensaje + oferta el día del cumple). 🟢
- **VIP automático:** detecta a tus mejores clientes y te avisa cuando entran ("mesa 4 = cliente de $50k/año"). 🟢
- **Reseñas:** monitorea Google/redes, alerta reseña negativa al instante, sugiere respuesta. 🟡 (OAuth GBP)
- **Pre-ticket / recuperación de cuenta** (Bernardo): antes de cerrar, oportunidad de recompra. 🟢
- **Personalización:** "este cliente siempre pide sin cebolla" en el ticket. 🟢
- **Lealtad sin app:** puntos/visitas atados al teléfono en el POS. 🟢

## 6. 📋 Menú & Pricing
- **Ingeniería de menú:** clasifica platillos en estrellas / vacas / perros / puzzles (margen × popularidad) y te dice qué empujar, rediseñar o matar. 🟢
- **Food cost por platillo vivo:** cuando sube un insumo, recalcula qué platillos ya no son rentables. 🟢
- **Pricing sugerido:** "tu margarita está 15% abajo del mercado, súbela $10 = +$4k/mes sin perder volumen". 🟢
- **Combos/upsell inteligentes:** qué se vende junto (arrachera + margarita) → arma el combo que sube el ticket. 🟢
- **Menú por hora/día:** empuja coctelería de noche, desayunos temprano, según lo que rota. 🟢
- **Simulador "¿qué pasa si...?":** subo 5% los cortes / quito 3 platillos perro → efecto en utilidad. 🟢

## 7. 📣 Marketing & Llenar Días Flojos
- **Promos automáticas para días muertos:** "martes floja → 2x1 coctelería, empújalo por WhatsApp". 🟢
- **Contenido para redes:** genera el post del platillo top de la semana / la promo. 🟢 (LLM)
- **Segmentación:** manda la promo correcta al cliente correcto (el que pide cortes vs el de brunch). 🟢
- **Aprovecha el clima/evento:** día caluroso → empuja cervezas/frozen. 🟡

## 8. 🏦 Finanzas, Cierre & Fiscal
- **Cierre de caja predicho + conciliación:** cuadra efectivo/tarjeta/transferencia, detecta el faltante antes de que el dueño lo descubra. 🟢
- **Estado de resultados vivo:** utilidad en tiempo real, no a fin de mes. 🟢
- **Flujo de caja / cobranza:** cuentas por cobrar, cuándo pagar a proveedores. 🟢
- **CFDI 4.0 automático** (facturación desde el POS — ya cableado con Facturama). 🟢
- **Nómina + propinas** integradas con horas trabajadas del POS. 🟢
- **Alertas fiscales:** IVA por pagar, fechas límite, régimen. 🟢
- **Motor de pagos (el negocio grande, tipo Toast):** integrar Clip/MP y cobrar % por transacción → Fullsite vale 10x. 🟡

## 9. 🛵 Delivery & Canales
- **Todos los canales en una pantalla:** Uber Eats + Rappi + DiDi Food sin brincar de tablet (adapter genérico ya existe). 🟡
- **Rentabilidad por canal:** cuánto REALMENTE ganas en Uber después de comisión — a veces pierdes. 🟢
- **Menú por canal:** precios de delivery distintos para absorber la comisión. 🟢
- **Auto-accept + cocina:** la orden de delivery entra directo al KDS. 🟡

## 10. 🗣️ El Copiloto Conversacional  *(el hábito diario)*
- **"Pregúntale lo que sea":** "¿qué día vendo más?", "¿quién vendió más ayer?", "¿cuánto llevo del mes?" — en lenguaje natural. 🟢
- **Briefing matutino** (7am por WhatsApp: ventas de ayer + 3 acciones de hoy — ya corre para AMALAY). 🟢
- **Coach proactivo:** no espera que preguntes; te dice "atiende esto hoy". 🟢
- **Voz:** pregúntale hablando desde el coche. 🔵
- **Alertas por WhatsApp** con acción de un toque (aprobar, ver detalle). 🟡

## 11. 🏢 Multi-Sucursal & Cadena
- **Benchmarking entre sucursales:** "la sucursal Centro tiene food cost 4 pts más alto — ¿por qué?". 🟢
- **El mejor gerente como plantilla:** detecta qué hace el que tiene mejor margen y lo replica. 🟢
- **Super-admin / torre de control:** todas las sucursales en un tablero, alertas consolidadas. 🟢
- **Rollout de menú/precio** a todas las sucursales de un clic. 🟢

## 12. 🤖 Operación Autónoma (agentes 24/7)
- **El restaurante que se auto-monitorea:** una flota de agentes que vigilan fraude, inventario, cocina, clientes y avisan solos (base ya construida: agent_runs/agent_events, fraud watcher). 🟢
- **Mission Control / AI Ops Lab:** una pantalla que muestra qué detectó cada agente hoy. 🟢
- **Agente que negocia con proveedores** (cotiza, compara, sugiere cambio). 🔵
- **Gemelo digital del restaurante:** simula cambios (nuevo horario, menú, staff) antes de aplicarlos. 🔵

## 13. 🔌 Hardware & Sensores  *(el diferenciador "wow")*
- **Cámara + visión por computadora:** robo hormiga, conteo de mesas/aforo, tiempos reales. 🔵
- **Básculas inteligentes** en insumos caros (carne, licor). 🟡
- **Sensores de temperatura** (cadena de frío). 🟡
- **Huella HID + PIN** para identidad de staff sin fraude (en progreso). 🟡
- **Terminales de pago** (Point Smart / Clip) integradas al flujo. 🟡
- **Impresión/comandas robustas offline** (ya probado en campo). 🟢

## 14. 🛡️ Confiabilidad & Continuidad  *(lo que nadie ve pero todo lo sostiene)*
- **Offline total:** opera aunque se caiga internet — LAN local, comandas y cobros sin nube (probado en AMALAY). 🟢
- **Cero pérdida de comanda / cero doble cobro** (ORDER_SENT durable + dinero certificado — roadmap). 🟢
- **Aislamiento multi-tenant** blindado (cada restaurante ve solo lo suyo). 🟢
- **Clonabilidad:** un restaurante nuevo listo en minutos desde el esqueleton, sin código. 🟢

---

## Dónde empezar (la secuencia que vende)

| # | Jugada | Por qué primero |
|---|---|---|
| 1 | **Copiloto de variance en pesos** (§1) | El dolor #1, puro software, ROI innegable. La feature-estrella. |
| 2 | **"Pregúntale lo que sea" + briefing** (§10) | El hábito diario que hace que el dueño abra Fullsite todos los días. |
| 3 | **Coach de meseros + staffing** (§3) | El dolor de Eduardo; sube ticket y baja costo de labor ya. |
| 4 | **Ingeniería de menú + pricing** (§6) | Sube margen sin vender más — dinero directo. |
| 5 | **Cierre/conciliación + estado de resultados vivo** (§8) | El dueño vive por esto; cierra la confianza. |

**La regla de oro:** cada idea se prueba contra *"¿un cliente que paga la necesita para
ganar más dinero mañana?"*. Si sí → arriba. Si es "wow pero no urgente" (cámara,
básculas) → es el titular del pitch, no el cimiento. Primero el cerebro (software sobre
la data que ya tenemos); el hardware es la carrocería.

## El moat, en una línea
Un POS te dice cuánto vendiste. Fullsite te dice **cuánto ganaste, cuánto te robaron,
qué está en riesgo y qué hacer** — porque tiene el POS + la receta + el inventario + la
IA que cruza los tres. Nadie más tiene los cuatro. Eso es el experto en tu restaurante.
