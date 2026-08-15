# Fullsite — Plan de monetización y camino a millonario (bootstrap, sin capital)

> Fecha: 2026-08-15. Complementa `PRODUCT-AUDIT.md` y `SCALE-STRATEGY-10K.md`.
> Restricción real: **no hay capital ahorita.** La tesis: los 2 motores más
> grandes (SaaS + pagos) NO necesitan capital; el capital/lending se BROKEA.

---

## 1. Los 3 motores de ingreso (orden de riqueza)

| # | Motor | Cómo cobra | Napkin @ 1,000 restaurantes | ¿Necesita capital? |
|---|---|---|---|---|
| 1 | **💳 Pagos (procesamiento)** | spread por transacción con tarjeta | ~$800k MXN/mes venta × 0.5% × 1,000 ≈ **$4M MXN/mes** | ❌ (contrato/partnership) |
| 2 | **📅 SaaS suscripción** | mensualidad por tier | $2,000/mes × 1,000 = **$2M MXN/mes** | ❌ (solo cobrar) |
| 3 | **🏦 Capital / adelanto de ventas** | margen de préstamo | márgenes fintech + lock-in | ✅ propio / ❌ si se brokea |

**Regla de oro:** el que ignora los pagos deja **~el 80% del dinero** en la mesa (es el ~80% del ingreso de Toast). El SaaS es el piso predecible; los pagos son la escala; el capital es el margen.

---

## 2. Pricing — qué cobrar

### SaaS por tier (cobra contra el VALOR, no el costo)
- **Básico — ~$1,499-1,999/mes:** POS + CFDI + cortes de caja + reportes.
- **Pro — ~$2,499-2,999/mes:** + inventario/food-cost + **agentes IA + anti-fraude + el reporte "cuánto dinero te ahorré"**. Aquí va el diferenciador.
- **Pitch de precio:** *"Te tapo $30k/mes de fuga, cobro $2k."* El ROI es 15-30×; el precio deja de ser objeción.
- Sin contrato largo (baja fricción de entrada; la retención la gana el valor, no el candado legal).

### Pagos (el motor de escala)
- Cobra al restaurante ~2.9-3.2% por transacción; consigue un rate mayorista menor del procesador → **te quedas el spread** (0.3-0.6 pts).
- Cero renta de terminal (o inclúyela); el volumen es lo que compone.

### Hardware (sin capex)
- El **cliente compra su combo** (mini PC + pantalla táctil + impresora + cajón, ~$8-12k MXN, modelo Polo Tab). Fullsite solo da el software. **Cero inventario.** (Después, con caja, puedes rentar/financiar hardware como margen extra.)

---

## 3. Procesadores de pago MX — comisiones y a quién acercarse

Comisiones base 2026 (merchant estándar; **negociables a volumen**):

| Procesador | Comisión aprox. | Notas para partnership/embed |
|---|---|---|
| **Conekta** | **~2.9% + $2.5 MXN** | MX-native, API-first, OXXO/SPEI/MSI nativos, orientado a plataformas. **Mejor fit para embeber pagos en un SaaS + rate negociable.** |
| **Openpay (BBVA)** | **~2.9% + $2.5 MXN** | Respaldo bancario, negociable a volumen, MSI nativo. Fuerte candidato. |
| **Stripe (Connect)** | ~3.6% + $3 | La MEJOR tooling para plataformas que toman spread (Stripe Connect), pero rate más alto y menos local (OXXO vía terceros). |
| **Mercado Pago** | ~3.5-3.79% + $4 | Dominante, terminales Point (lo que Fullsite ya usa). Programa de developers/marketplace. |
| **Clip** | ~3.6% + IVA | Terminales sin renta; más merchant que ISV/embed. Ojo: **Clip es dueño de Wansoft** (tu competidor) — cuidado estratégico. |

**Los más baratos:** **Conekta y Openpay (~2.9%)**. **Los más caros:** PayPal (3.95%), MP/Clip (~3.5-3.6%).

**Cómo hacerte partner (el spread):**
1. Contacta el equipo de **Partnerships / ISV / Plataformas** (NO la línea de ventas merchant). Conekta y Openpay tienen programa de plataformas.
2. El pitch: *"SaaS POS para restaurantes con X sucursales; queremos embeber pagos y ser aggregator/PayFac con rev-share."*
3. Dos modelos:
   - **Referral partner** (simple, comisión menor) — empiezas aquí.
   - **Aggregator / PayFac** (onboardeas sub-merchants bajo tu cuenta, te quedas el spread completo) — más margen, más compliance. Meta de Fase 1.
4. **Recomendación:** arranca con **Conekta** (rate más bajo + API-first + MX-native), negocia rate mayorista a volumen. **Evita a Clip como core** (compite contigo vía Wansoft).

> Fuentes de tarifas: atempora.studio/blog/comisiones-mercado-pago-2026 · velozpay.mx/mejores-pasarelas-de-pago-en-mexico · calculadorapro.com.mx · rebill.com/en/blog/payment-gateways-mexico · muralpay.com/blog/top-payment-gateways-in-mexico. Confirmar rates y programas ISV directo con cada procesador (cambian y son negociables).

---

## 4. Plan de ejecución bootstrap (fases)

### FASE 0 — Primeros pesos (ahora, $0) — meta: cash-flow+
- Cobra AMALAY + cierra **3-5 restaurantes de Monterrey** a $1,999/$2,999.
- **Arma de venta:** el reporte "cuánto dinero te ahorré" (software, cero capital).
- **Gate de build (todo software = solo tiempo/flota):** fix de seguridad #31 (antes del 2do cliente) · **offline-boot real** (arma de confianza) · el reporte de ahorro · onboarding self-serve.
- Hardware = el cliente lo compra. Referidos instrumentados día 1. **Domina Monterrey, no te disperses.**

### FASE 1 — Pagos (mes 3-6, un contrato) — el ingreso se dispara
- Partner ISV con **Conekta/Openpay** → rev-share por transacción. Cero capex.
- Meta: **los pagos > el SaaS** en ingreso.

### FASE 2 — Capital brokered (con datos + densidad) — margen fintech
- NO prestes tu dinero. **Brokea:** refiere restaurantes pre-calificados (con tu data de ventas real) a un lender/Clip Capital/fintech → comisión de originación. Lock-in brutal.
- Cuando haya caja propia, lo haces tú (el margen entero).

### FASE 3 — Marca / franquicias (el resultado)
- Con densidad + ROI innegable en un segmento, las marcas y franquicias voltean a ver. Es el **resultado** de ganar la cuña, no el punto de partida.

---

## 5. El math del camino
```
Fase 0:  10 clientes × $2,500/mes                 = $25k MXN/mes   → cash-flow+
Fase 1:  +200 clientes + spread de pagos           ≈ $1.5M MXN/mes
Fase 2:  +comisión de capital + escala             ≈ márgenes fintech
Meta:    1,000 restaurantes (SaaS $2M + pagos $4M) ≈ $6M+ MXN/mes recurrente
```
**Sin levantar un peso** hasta Fase 1-2 — y para entonces el propio ingreso te fondea (o te hace levantable en buenos términos).

---

## 6. La verdad honesta
Tu mayor riesgo **no es la falta de capital** — es quedarte en Fase 0 sin cerrar clientes que paguen y se queden. El producto ya es bueno (lo probó el audit). **Lo que te hace millonario es vender + retener + los pagos** — y nada de eso necesita dinero, necesita 5-10 restaurantes que digan *"no puedo operar sin esto porque me tapa la fuga."*
