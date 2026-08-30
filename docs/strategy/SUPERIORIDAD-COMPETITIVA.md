# Superioridad competitiva — qué hacemos mejor con todo lo que ahora sabemos

**Fecha:** 2026-08-27 · **Fuentes:** las 5 biblias de producto (`../knowledge/competitive/bibles/`), la galería de pantallas, y el doc estratégico (`../knowledge/competitive/COMPETITIVE-INTELLIGENCE.md`). Cada jugada cita su origen.
**Qué es:** el plan de acción derivado del desarme completo de Toast, Parrot, Soft Restaurant, Square y Wansoft. **Qué NO es:** una lista de deseos — cada ítem tiene prioridad, esfuerzo estimado y a qué workstream pertenece. Respeta la governance de milestones: nada de aquí se auto-implementa; los P0 ya estaban en curso y esto los REFUERZA, los P1/P2 son propuesta para decisión de Daniel.

---

## 0. La foto en una frase

Todos llegaron a nuestra tesis (IA + datos del POS) pero cada uno cubrió un pedazo: Toast la IA con escala, Parrot el marketing por WhatsApp, SR el fiscal, Square la simplicidad. **Nadie tiene la combinación nuestra: IA operativa completa + WhatsApp bidireccional + offline real + CFDI sin fricción.** El plan es: defender esas cuatro, cerrar los tres gaps que sí duelen (pagos, delivery, recepción de facturas), robar 15 detalles concretos, y no copiar jamás sus cuatro vicios.

## 1. Donde YA ganamos — defender y explotar (no construir: contar)

| Ventaja | Evidencia contra competencia | Cómo explotarla YA (venta, no código) |
|---|---|---|
| **Offline real** | Toast: hub frágil, órdenes aisladas por dispositivo, "no cierres la app o pierdes pagos" (sus docs — TOAST-BIBLE §3.4/§4.5). Parrot: ni una página técnica. | Demo "apaga el módem" en toda venta. Slide: *"un Toast offline opera como islas; un Fullsite opera como restaurante"*. |
| **IA operativa completa** | ToastIQ existe pero no llega a MX; Grow es solo marketing y está en waitlist (PARROT-BIBLE §5); SR y Wansoft: cero IA. | Demo de agentes stock/fraude/cierre + copiloto respondiendo "¿cuánto vendí hoy vs el martes pasado?" por WhatsApp. Parrot no tiene respuesta. |
| **WhatsApp bidireccional** | Grow solo dispara campañas; SR solo empuja cortes X (SR-BIBLE §3). **Nadie conversa.** | El copiloto ES el diferenciador de demo #1 para el dueño-operador. |
| **CFDI sin límite de folios** | Parrot cobra por folios (100–500/mes según plan — PARROT-BIBLE §6). | Línea de pricing: "facturación ilimitada incluida". Duele exactamente donde Parrot cobra. |
| **Precio todo incluido** | Toast: add-ons de $25–100 USD c/u + fees ocultos (queja #1). SR: 6 SKUs sueltos + distribuidor. Parrot: $2,800 el completo. | Tabla de costo total real (la del guion de demos alimenta esto con cotizaciones escritas). |
| **Reservas nativas** | Parrot depende de OpenTable (solo planes altos); Toast Tables valida que reservas+POS unidos ganan (TOAST-BIBLE §9). | Contar la unión reservas↔mesa↔cocina como feature, no como tabla. |
| **Table map real** | Parrot: grid paginado sin plano (GALERIA §1). | Mostrarlo junto al grid de Parrot en comparativas. |
| **Dashboard remoto EDITABLE** | SR Admin es solo-lectura: "editar un producto, receta o precio te obliga a estar en el restaurante" (reseña verificada, SR-BIBLE §4); Parrot App: 1K+ descargas. | Demo: cambiar un precio desde el celular en vivo. El incumbente no puede. |
| **Cloud-POS que sí funciona** | SR Cloud: 3.9★, "te obligan a comprar sus terminales", sin inventario ni recetas (reviews verificadas). | La transición cloud del incumbente fracasó — el hueco es NUESTRO mercado natural. |
| **KDS ya arriba del promedio MX** | Parrot y SR ni lo enseñan en público (GALERIA §2). | Dejar de tratarlo como "módulo" — es arma de demo. |

## 2. Los TRES gaps que sí duelen — cerrar (ya están en el roadmap; esto los re-prioriza)

### GAP 1 — Pagos con autoconciliación (el endgame de todos)
- **Evidencia:** Toast: cada dólar pasa 4 veces por ellos, el POS casi se regala (TOAST-BIBLE §3.5). Parrot Pay vende "recupera $276K por discrepancias de cortes" y +40% propinas. SR Payments acaba de entrar. Wansoft es de Clip. **La guerra de pagos MX ya empezó y nosotros no estamos en ella.**
- **Estado nuestro:** matriz-dinero/cuadre en curso (prerequisito correcto); pagos en master plan 05·B; Clip ya tocó la puerta (tasa ~3%).
- **Acción propuesta:** (a) cerrar cuadre/arqueo como producto visible con el mensaje de Parrot ("pesos recuperados", no features); (b) subir la conversación de terminal/procesador de "algún día" a "decisión de Q4" — es la única jugada donde TODOS los competidores ya movieron ficha. **[DECISIÓN DANIEL]**

### GAP 2 — Recepción de facturas CFDI (la Fase 1 de Alejandro, que el incumbente ya tiene)
- **Evidencia:** SR12 importa compras por XML con vinculación automática de insumos (SR-BIBLE §3). xtraCHEF es negocio entero de Toast con OCR y <24 h (TOAST-BIBLE §7). **Nuestro framing regalado: el CFDI XML nos da GRATIS e INSTANTÁNEO lo que a Toast le cuesta OCR y a SR le costó años.**
- **Estado nuestro:** OP-21 (recepción-factura) pendiente.
- **Acción propuesta:** OP-21 sube de prioridad — ya no es "pendiente fiscal", es paridad con el incumbente + diapositiva anti-Toast. Un prospecto que migra DE SR lo va a pedir el día 1. **[REFUERZA ROADMAP EXISTENTE]**

### GAP 3 — Delivery agregado estable
- **Evidencia:** es la cuña original de Parrot (Uber/Rappi/DiDi directo al POS, maduro); Toast lo tiene nativo + red propia; SR lo vende como add-on.
- **Estado nuestro:** Uber en certificación (11/11 endpoints con código, bloqueo = deploy+scopes); Rappi bloqueado en T&C.
- **Acción propuesta:** cerrar la cert de Uber es la unidad de progreso; nada nuevo que decidir. **[YA EN CURSO]**

## 3. Los 15 robos concretos — por producto, priorizados

**P0 = barato y de alto impacto (candidato a próxima ola) · P1 = mediano · P2 = cuando toque.** Esfuerzo: S/M/L.

### POS
| # | Robo | De quién | Esf. | Prio |
|---|---|---|---|---|
| 1 | **Contador pre-86 en el tile** (stock restante visible al mesero) | Toast (§14.3) | M | P1 |
| 2 | **86 a un long-press** desde el grid ("marcar agotado") | Square (§5) | S | **P0** |
| 3 | **Fotos de platillo protagonistas** (no thumbnail) — nuestro ICP es café/brunch visual | Square (§5) | S | **P0** |
| 4 | Dark contextual para servicio a mesa (mismo layout, tema oscuro) | Toast (§14.3) | M | P2 |
| 5 | Propina elegida por el comensal en pantalla/terminal con % calibrados a MX (5/10/15) | Parrot (§9) | M | P1 (va con GAP 1) |

### KDS
| # | Robo | De quién | Esf. | Prio |
|---|---|---|---|---|
| 6 | **Badge "NOT PAID"** en el ticket (cocina ve qué cuenta sigue abierta) | Toast (§14.4) | S | **P0** |
| 7 | Contorno/color distinto para órdenes de delivery vs sala | Toast (§14.4) | S | **P0** |
| 8 | **All Day View** (conteos agregados: "van 14 chilaquiles") | Toast (§3.3) | M | P1 |
| 9 | Auto-fire por prep time (la estación lenta arranca primero) + prep-time analytics | Toast (§3.3) | L | P2 |

### Dashboard / app del dueño
| # | Robo | De quién | Esf. | Prio |
|---|---|---|---|---|
| 10 | **La tripleta en cada KPI: valor + % vs referencia + sparkline** — nunca un número solo | Toast Now (§14.6) | M | **P0** |
| 11 | SPLH (ventas por hora-hombre) como métrica de primera pantalla | Toast Now (§9) | S | P1 |
| 12 | **Anti-fraude como categoría de primer nivel del dashboard** (Toast le da 15 reportes; el nuestro vive escondido) | Toast (§5) | S | **P0** (es re-jerarquizar UI, no construir) |
| 13 | Reporte custom builder | Square | L | P2 |

### Copiloto / IA
| # | Robo | De quién | Esf. | Prio |
|---|---|---|---|---|
| 14 | **Acciones desde el chat con confirmación** (86, editar precio, turno) — hoy nuestro chat responde, no ejecuta | ToastIQ (§6) | L | P1 (dirección ya validada por Toast) |
| 15 | Las 3 reglas de diseño de IA de Toast: **hereda permisos, todo con confirmación, campañas draft-only** | ToastIQ (§6) | S | **P0** (adoptar como principios en AGENTS.md/AI-ARCHITECTURE) |
| — | Medir campañas en VENTA generada, no clicks (regla Grow) — ya es nuestra dirección con agent_events value | Parrot (§5) | S | **P0** (ratificar) |

### Diseño (del capítulo Buffet — TOAST-BIBLE §15.6)
| # | Robo | Esf. | Prio |
|---|---|---|---|
| 16 | Token `interactive` separado del token `brand` (identidad ≠ interacción) | S | P1 (entra al ds-v2.x) |
| 17 | `font-variant-numeric: tabular-nums` en TODO reporte | S | **P0** (una línea) |
| 18 | Semántica de color compartida POS↔KDS (el mismo rojo = "tarde" en toda la casa) | M | P1 |
| 19 | **UX del offline**: banner por causa (red local vs internet vs nube) + guía "qué puedo hacer" reabrible — nuestro offline es superior técnicamente; que también se SIENTA superior | M | P1 |

### Fiscal
| # | Robo | De quién | Esf. | Prio |
|---|---|---|---|---|
| 20 | **Autofactura QR en <45 segundos** con portal por restaurante | Parrot (facturacion.parrot.rest) | M | P1 (benchmark para nuestro flujo Facturapi) |

## 4. Las 5 jugadas de GTM (no requieren código)

1. **"Apaga el módem"** — el momento de demo que ningún competidor puede copiar. Guionizarlo en el pitch estándar.
2. **La caza del incumbente, versión orgánica** — Parrot ya compra ads sobre las búsquedas de tutoriales de SR (verificado — PARROT-BIBLE §1). Nosotros: contenido orgánico de migración "de Soft Restaurant a Fullsite" + comparativas visuales (la imagen del comandero SR junto a nuestro POS se vende sola — GALERIA §1).
3. **Demo interactivo público en fullsite.mx** (tipo Arcade, como Parrot) — baja la fricción de ver el producto sin agendar llamada. Esfuerzo S con herramienta tipo Arcade. **[DECISIÓN DANIEL — es gasto]**
4. **Mensaje en pesos, no en features** — Parrot vende "recupera $276K por discrepancias"; nosotros tenemos cuadre + antifraude + agentes reportando `value`. Reescribir el copy de landing/deck en pesos recuperados/generados.
5. **Licenciamiento académico (semilla)** — la jugada de 25 años de SR: cada egresado de gastronomía sale sabiendo SR. Cuando tengamos 10+ clientes: 1-2 escuelas de MTY. **[POST-MILESTONE]**

## 5. Lo que NUNCA copiar (los cuatro vicios documentados)

1. **Fees ocultos / comisiones sorpresa** — queja #1 de Toast (317+ outages se perdonan; los fees no). Nuestro precio fijo transparente es un ARMA: no erosionarla jamás.
2. **Lock-in como retención** — contratos multianuales con ETF de $5–10K USD (Toast), hardware cautivo (Parrot/Toast). Retención por valor, punto.
3. **Cobrar por folios de factura** (Parrot) — en un país donde el SAT obliga, es cobrar por respirar.
4. **API solo premium** (Parrot) / add-ons fragmentados (SR/Toast) — nuestra API abierta y el todo-incluido son diferenciadores estructurales.

## 6. Secuencia propuesta (respetando governance)

- **Ahora (sin decisión nueva):** ✅ HECHO 2026-08-31 — el material de §1/§4 está ejecutado en [`KIT-VENTA-COMPETITIVO.md`](KIT-VENTA-COMPETITIVO.md) (guion de demo de 5 momentos, battlecards, tabla de costo total, copy en pesos, cola de contenido) · cerrar Uber cert (GAP 3) · ratificar los principios de IA (#15) en docs de arquitectura.
- **Próxima ola de producto (decisión Daniel — los P0):** #2 86-long-press · #3 fotos · #6 NOT PAID · #7 color delivery en KDS · #10 tripleta KPI · #12 antifraude de primer nivel · #17 tabular-nums. Siete cosas chicas, todas visibles en demo.
- **Decisiones estratégicas pendientes [DANIEL]:** terminal/pagos (GAP 1 — la grande) · demo interactivo público (GTM 3) · prioridad de OP-21 (GAP 2).
- **Después:** P1s (§3), académico (GTM 5), P2s.

## 7. Cómo se mantiene vivo

Cada demo comercial del guion, cada release de un competidor, cada prospecto que menciona un feature → actualizar la biblia correspondiente Y revisar si mueve una prioridad aquí. Este doc es el puente entre `knowledge/competitive/` (lo que ellos son) y el roadmap (lo que nosotros hacemos); no duplica ninguno de los dos.
