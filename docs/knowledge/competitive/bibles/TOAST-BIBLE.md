# TOAST BIBLE — el estándar de oro, de pies a cabeza

**Fecha:** 2026-08-27 · **Método:** sitio oficial (pos.toasttab.com, actualizado 2026-07-22), docs de plataforma (doc.toasttab.com), help center (support.toasttab.com), prensa, guías de pricing, reviews agregadas. Convención: [HECHO] = fuente pública verificada · [INFERENCIA] = derivado · [HIPÓTESIS] = por validar.
**Complementa:** `../COMPETITIVE-INTELLIGENCE.md` §2.1 y §4 (estrategia e historia). Este doc es la **anatomía del producto**.

---

## 1. Ficha

- Boston, fundada 2011. Pública (NYSE: TOST). **130,000+ locations** [HECHO — cifra propia 2026].
- Solo mercados anglo: US, UK, Irlanda, Canadá, Australia. **No está en México ni lo ha anunciado** [HECHO].
- Modelo: SaaS barato + **procesamiento de pagos obligatorio** (ahí está el negocio) + fintech encima (capital, checking, instant deposit).
- Por qué importa aunque no compita aquí: **define hacia dónde va la industria**. Todo lo que Toast lanza hoy (IA nativa, celular en el handheld, agregación de delivery) llega a México en 2-4 años vía imitadores.

## 2. Mapa completo del producto (9 suites, ~35 productos) [HECHO]

Del catálogo oficial (2026-07-22):

| Suite | Productos |
|---|---|
| **POS & Restaurant Ops** | Point of Sale · Toast Payments · Toast Now (app del dueño) · Mobile Order & Pay (QR en mesa) · Catering & Events (NEW) · Restaurant Retail (NEW) · Reporting & Analytics · Order-Ready Boards |
| **Marketing** | Email Marketing · Loyalty · Gift Cards · Toast Tables (NEW: reservas+waitlist+mesas) · Guest CRM · Advertising (Google/Meta con IA) |
| **Digital Storefront** | Online Ordering (first-party sin comisión) · Local by Toast (marketplace propio) · Toast Delivery Services (repartidores on-demand) · Third-Party Delivery Integrations · Toast Websites (NEW) · Branded Mobile App |
| **Hardware** | Toast Go 3 handheld · Kiosk · KDS · Toast Flex · Flex for Guest · Flex for Kitchen · Toast Tap |
| **Restaurant Management** | Benchmarking (vs peers) · Multi-Location Management · 170+ integraciones |
| **Supplier & Accounting** | xtraCHEF (OCR de facturas → costos) · Inventory |
| **Payroll** | Payroll & Team Management (mediana 15 min) · Pay Card & PayOut |
| **Team Management** | Tips Manager · Sling (scheduling + chat de equipo) |
| **Finance** | Capital Loans (15,000+ prestatarios, vía WebBank) · Toast Checking (aparta impuestos/nómina automático) · Instant Deposit (fee 1.75%) |

**Lectura:** Toast ya no es un POS — es un **sistema operativo financiero** del restaurante. El POS es el caballo de Troya del procesamiento; el procesamiento es el caballo de Troya del crédito. (Coincide con la lección de Alejandro: verdad de datos → crédito seguro → moat de pagos.)

## 3. El POS de pies a cabeza

### 3.1 Flujo de cobro [HECHO — docs + demos públicas]
- Grid de categorías touch con imágenes; búsqueda rápida por nombre.
- Modificadores en modal: obligatorios vs opcionales.
- Split checks nativo: por item o porcentaje, hasta 50 divisiones.
- Propinas sugeridas en pantalla del cliente (18/20/22%, customizable).
- Pagos: cash, tarjeta, Apple/Google Pay, gift cards.
- <2 segundos por transacción en su hardware.

### 3.2 Permisos y roles [HECHO]
- Niveles Employee/Manager/Admin/Owner + **100+ permisos granulares** ("puede aplicar descuento >20%", "puede ver food cost", "puede cerrar caja").
- PIN de 4 dígitos por empleado; fingerprint en hardware nuevo. Clock-in/out integrado al POS.
- Audit trail de toda acción (quién, cuándo, qué).

### 3.3 Hardware [HECHO]
- **Toast Go 3** (global desde 2026-04-28): 6.52", >24 h batería (carga 4.5 h), IP65, caídas 1.5 m, 16% más ligero que Go 2, cámaras frontal+trasera, **WiFi + CELULAR nativo**, ToastIQ integrado. El mesero cobra en la banqueta sin red del local.
- Flex (terminal), Flex for Guest (pantalla al cliente), Flex for Kitchen, Tap (lector), Kiosk, KDS propio. Todo Android propietario.

### 3.4 KDS [HECHO]
- Routing por estación (parrilla/freidora/ensaladas) automático por item.
- Timers con semáforo (verde→amarillo→rojo). Bump por estación; la orden se completa cuando todas terminan.
- **Expeditor mode**: vista unificada para coordinar estaciones. Prep-time analytics por estación.

### 3.5 Offline — su talón de Aquiles arquitectónico [HECHO — doc.toasttab.com]

**Modo básico:** si no hay cloud, **los dispositivos NO se comunican entre sí** (comunicación mediada por nube, no P2P). Pagos offline solo banda magnética (EMV deshabilitado), almacenados localmente. Checks offline numerados: `(device_id + 2) × 1000 + secuencial`.

**"Offline mode with local sync" (el parche):** UN dispositivo actúa de hub local — elegido AUTOMÁTICO por Toast, solo reasignable llamando a soporte. Requiere Ethernet, no puede ser handheld, un solo hub por red, subredes no comparten datos. **Las órdenes de un POS NO se ven en otro POS offline** (solo POS→KDS). Y sus propias reglas de supervivencia lo delatan:
- "No desinstales la app ni limpies caché — **borra permanentemente los pagos almacenados**."
- "No cierres sesión — no podrás volver a entrar hasta reconectar."
- "Cada empleado debe usar UN solo dispositivo mientras dure el offline."
- "Guarda copias firmadas de los recibos por si el pago se pierde."
- Si no reconectas al fin del día: llamar a soporte para desactivar el auto-capture.

**No disponible offline:** kiosk, clock-in entre dispositivos, datos de clientes, gift cards, loyalty, house accounts.

**Contraste Fullsite [INFERENCIA sobre HECHO]:** nuestro Bridge LAN es un servidor local real con estado compartido entre dispositivos. Toast, con $14B de market cap, tiene un relay de hub único donde las órdenes viven aisladas por dispositivo. **En offline, Fullsite es arquitectónicamente superior a Toast.** Esta comparación pertenece al pitch.

## 4. El back-office (Toast Web) de pies a cabeza [HECHO — support.toasttab.com]

Navegación: menú izquierdo → **Reports** → abre Weekly Overview → flecha expande el árbol completo. **9 categorías, ~74 reportes:**

| Categoría | # | Reportes clave |
|---|---|---|
| Sales | 11 | Sales Summary, Sales Analytics, Sales Breakdown, Marketing-driven sales, Digital Order Sources, Orders, Order Details, Paid in Total, Deposit Sales, Location Breakdown, Group Sales Overview |
| Labor | 13 | costos, time entries, ventas por hora, productividad por empleado, shifts, tips, break adherence, audits |
| Menu | 8 | **Product Mix (PMIX)**, Menu Breakdown, Top Items/Groups/Modifiers, Item Details, Modifier Details, **86 Report**, **Food Waste Breakdown** |
| Payments | 14 | payouts, **reconciliation**, chargebacks, deposits, card activity, gift cards, billing |
| **Cash & Loss Management** | 15 | cash audits, drawers, **voided/removed items**, loyalty misuse, discounts, refunds, end-of-day |
| Accounting | 4 | Overview, By Day, By Location, GL codes / House Accounts |
| Kitchen Ops (requiere KDS) | 3 | Tickets by Fulfillment, By Hour, Details |
| Marketing (requiere Loyalty) | 6 | feedback, rewards, credits, fundraising |
| Other | — | reservas, waitlist, comparación de sucursales |

- Filtros: rango, horas, empleados, sucursal(es), dining type, revenue center. **Comparativos YoY / periodo previo / sucursales lado a lado** (azul vs naranja). Columnas customizables por reporte.
- Export: email (.xls/.csv), Excel directo, print-to-PDF.
- **Lo notable:** "Cash & Loss Management" es la categoría MÁS GRANDE (15 reportes). Toast trata el anti-fraude como categoría de primer nivel, no como feature — valida nuestra tesis del antifraude como producto.

### Toast Now (la app del dueño) [HECHO]
- Ventas/tráfico/labor en tiempo real, hora por hora, vs mismo día de la semana pasada y del año pasado.
- Quién está clocked-in; editar turnos; tips; breaks.
- **Acciones**: throttle de online ordering, snooze de takeout/delivery, 86 de items desde el celular.
- Manager log sincronizado con Toast Web + threads con el staff.
- Multi-sucursal con un login.

## 5. ToastIQ — su capa de IA (2025-2026) [HECHO]

- Lanzada 2025; expandida a "Smart AI Assistant" (oct-2025, linaje "Sous Chef"); **Toast IQ Grow** (marketing/demand, primavera 2026).
- Tres capacidades: (1) feed **"For you"** de recomendaciones personalizadas y oportunas; (2) **preguntas en lenguaje natural** sobre el negocio con consejo a la medida; (3) **acciones desde la conversación** — editar menú, editar turno, modificar item.
- Voice-AI (llamadas): +6% volumen de orden por upsells de IA (dato propio).
- Motor: 130K+ locations, millones de transacciones — su moat es la ESCALA de datos.
- Go 3 lleva ToastIQ en el handheld.

**Lectura para Fullsite:** Toast validó nuestra tesis completa — IA operativa nativa del POS con feed de recomendaciones (= agentes), chat en lenguaje natural (= copiloto) y acciones desde el chat (ahí van adelante; nuestro chat aún no ejecuta acciones). Su ventaja: datos. La nuestra: México — CFDI, WhatsApp como canal (ellos usan app propia), español operativo, ticket de $2K MXN vs $10K USD de entrada, y offline real.

## 6. Pricing 2026 [HECHO — guías públicas]

| Plan | Software | Procesamiento |
|---|---|---|
| Starter Kit | $0/mes, hardware $0 upfront | 3.09–3.69% + $0.15 (según bundle) |
| Point of Sale | $69 USD/mes | 2.49% + $0.15 |
| Payroll bundle | $90/mes + $9/empleado | — |
| Build Your Own | ~$110–165+/mes | negociado |

- Hardware (compra): Go 2 $494 · Flex+Tap $719 + $50/mes · +pantalla cliente $944 + $50/mes · KDS $674 + $35/mes · Kiosk $1,034 + $90/mes · impresoras $296–431 · cajón $134.
- Add-ons/mes: Online Ordering $75 · 3rd-party integration $75 · Loyalty $50 · Gift cards $50 · KDS sw $25 · Kiosk sw $90 · Email mkt $75 · Catering $100 · Websites $75.
- **Contratos 1–3 años · early termination $5,000–10,000 · procesamiento Toast EXCLUSIVO.**
- Costo real todo incluido: café de 10 mesas ~$250–500 USD/mes; full-service de 30 asientos $700–1,200 USD/mes, ANTES de fees de procesamiento.

## 7. Debilidades documentadas (2026) [HECHO]

1. **Fees ocultos — queja #1**: comisión extra de 2.5–3.5% en online ordering encima del procesamiento; subidas de precio unilaterales en add-ons.
2. **Outages**: 317+ desde ago-2022; 16 incidentes en los últimos 90 días medidos; oct-2026 dos caídas consecutivas de >10 horas. Con offline débil, cada outage es servicio parado.
3. **Soporte**: Trustpilot 3.1/5 (1,402 reviews), 235 quejas BBB; ventas agresivas.
4. **Lock-in**: hardware propietario + procesamiento obligatorio + contrato multianual con penalización de miles de dólares.

## 8. Qué copiar · qué evitar · cómo ganarle

**Copiar:**
- "Cash & Loss Management" como categoría de primer nivel del dashboard (15 reportes) — nuestro antifraude merece ese rango, no un rincón.
- Toast Now: comparativo "vs mismo día semana pasada/año pasado" hora por hora + ACCIONES desde el celular (86, throttle) — nuestro dashboard móvil debe permitir actuar, no solo mirar.
- Expeditor mode y prep-time por estación en KDS.
- ToastIQ "For you" feed: recomendaciones oportunas, no reportes crudos. (Ya es nuestra dirección — Toast la valida.)
- El QR de mesa (Mobile Order & Pay) como expansión natural del ticket.
- Benchmarking vs peers: cuando tengamos 20+ clientes, "tu café vs cafés similares" es un moat de datos que nadie en MX tiene.

**Evitar:**
- El resentimiento por fees ocultos: nuestra promesa de precio fijo transparente es un arma directa contra el modelo Toast/Parrot Pay.
- El lock-in contractual como retención: retención por valor, no por castigo.
- La fragilidad offline "no cierres la app o pierdes pagos".

**Cómo ganarle (a sus imitadores en MX — Toast no está aquí):**
- Offline: la nuestra es arquitectura de servidor local real; la de ellos, un relay frágil. Demo de "apaga el módem" en cada venta.
- CFDI + WhatsApp + español: Toast no lo tiene ni lo tendrá pronto; sus imitadores MX tampoco tienen la capa IA.
- Velocidad: ellos actualizan trimestral con burocracia pública; nosotros en días.

## 9. Material de estudio [HECHO — enlaces verificados por búsqueda]

- **Canal oficial YouTube "Toast, Inc."**: tutoriales POS, payroll, xtraCHEF, menu engineering — youtube.com/channel/UC6oFqFPZ5AbrkJmKHfh3C5A
- Playlist "Toast Point of Sale": youtube.com/playlist?list=PLM4kOja-yPM6cfyINeEZDUuMRw1msUUyP
- "Learn with Toast" (cursos en video oficiales) + Toast Classroom (entrenamiento en vivo, 60 min).
- Demo walkthrough oficial: pos.toasttab.com/request-demo-video (pide correo).
- Front-of-House Skills 101: support.toasttab.com/en/front-of-house-skills-101 (así entrenan meseros — útil para nuestro onboarding).
- Docs de plataforma (arquitectura, offline, API): doc.toasttab.com — **lectura obligada de ingeniería**.
- Reviews con capturas: posusa.com/toast-pos-review, fitsmallbusiness, NerdWallet.
- Videos independientes: "Toast Restaurant POS System - How it Works" (youtube VL6aD1i9LB4), "TOAST POS Demo and Honest Review" (bcsiKtTa0TM), "Get Started With Menus" (XqebkNDpeoA), unboxing z8h3C4PkpMY.

## 10. Qué falta por verificar

- [ ] Ver 2-3 demos completas en video y capturar screenshots del back-office a `docs/knowledge/competitive/bibles/assets/` (tarea manual o sesión con navegador).
- [ ] Toast API pública (doc.toasttab.com) — mapear objetos expuestos vs nuestro modelo de datos.
- [ ] Detalle de xtraCHEF (OCR de facturas): flujo exacto — es el espejo de nuestra Fase 1 de recepción CFDI.
- [ ] Precio y adopción real de ToastIQ (¿incluido o add-on?).
