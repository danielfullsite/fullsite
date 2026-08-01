# FULLSITE — Pitch Deck
## Para: Dalus Capital (erick@daluscapital.com)
## Julio 2026

---

## SLIDE 1 — Portada

**FULLSITE**

El sistema operativo con IA para restaurantes.

Daniel Ramonfaur | Founder & CEO
daniel@fullsite.mx

---

## SLIDE 2 — El problema

**Los restaurantes en Mexico operan a ciegas.**

- El 35-45% del ingreso se va en insumos. La mayoria no sabe su food cost real.
- El software lider (Wansoft) corre en .NET de 2007. Sin IA, sin real-time, sin mobile.
- Instalar un POS toma dias. Cambiar de proveedor toma meses.
- El dueño se entera de los problemas al dia siguiente — cuando ya perdió dinero.

**600,000+ restaurantes en Mexico.**
**90% usa software legacy o no usa nada.**

---

## SLIDE 3 — La solucion

**Fullsite reemplaza todo el stack operativo de un restaurante con una sola app con IA.**

Un sistema que no solo registra ventas — entiende el negocio:

- POS completo (punto de venta, KDS cocina, comandas, cobros)
- 30 agentes de IA corriendo 24/7 sobre datos reales
- Food cost en tiempo real, no en un Excel que nadie abre
- Alertas proactivas: "Se te esta acabando el aguacate. Tu proveedor lo entrega en 24h."
- Setup en menos de 30 minutos — no dias

**No es un POS con IA encima. Es IA con un POS adentro.**

---

## SLIDE 4 — Demo / Producto (screenshots)

[Screenshots del POS en produccion]
[KDS en pantalla de cocina]
[Dashboard con datos reales]
[Alerta de WhatsApp del agente de IA]

**Esto no es un mockup. Esta corriendo en produccion.**

---

## SLIDE 5 — Traccion

| Metrica | Valor |
|---------|-------|
| Ventas procesadas (903 dias) | **$73.7M MXN** (~$4.1M USD) |
| Promedio diario | $81,565 MXN |
| Dias de data operativa | 903 |
| Platillos en menu | 522 |
| Recetas con ingredientes | 615 |
| Proveedores mapeados | 202 |
| Productos de inventario | 3,000+ |
| Agentes de IA activos | 30 |
| Cobertura de food cost | 71% (462/522 platillos costeados) |

**Cutover completo en restaurante piloto: 8 julio 2026.**
Reemplazando un sistema de 20 anos — en produccion, con clientes reales.

---

## SLIDE 6 — El incumbente que vamos a reemplazar

**Wansoft — 20 anos, miles de restaurantes en Mexico.**

Le hicimos ingenieria inversa completa:
- 211 pantallas del portal
- 822 stored procedures
- 150+ endpoints HTTP
- 80+ tablas de base de datos
- 97 reportes exportados y analizados

**Lo que descubrimos:**

| | Wansoft | Fullsite |
|---|---|---|
| Tecnologia | .NET 4.5 / 2007 | Next.js + Supabase (cloud-native) |
| IA | Ninguna | 30 agentes activos |
| Setup | Dias (instalacion local) | < 30 minutos (PWA) |
| Reportes | 60+ estaticos (Excel) | Real-time + alertas proactivas |
| Mobile | No existe | PWA responsiva |
| Offline | SQL Server local | IndexedDB + sync automatico |
| Costo de cambio | Meses | 1 semana |
| Innovacion (5 anos) | Zero | Cada semana |

**Wansoft sobrevivio 20 anos por dependencia, no por innovacion.**

---

## SLIDE 7 — Inteligencia que Wansoft no puede ofrecer

Con los datos que ya tenemos, respondemos preguntas que antes tomaban horas:

**Food Cost Engine:**
- Food cost promedio cocina: 24.9% (saludable)
- 5 platillos se venden a perdida (detectados automaticamente)
- Si el aguacate sube 15%, impacta 18 platillos y $X en margen

**Pareto operativo:**
- 26 platillos (19.3%) generan el 80% del revenue
- CHILAQUILES = 17.2% de todas las ventas ($904K en 90 dias)
- 23 ingredientes son criticos en ambas dimensiones (revenue + dependencia)

**Cadena de suministro:**
- Flor comestible aparece en 56 platillos. Cuesta $5. Si falta, caen 56 items del menu.
- Un solo proveedor (Erikajaqueline Treviño) abastece todos los items de frutas y verduras.
- Detectamos 81 ingredientes "fantasma" — referencias rotas que Wansoft nunca detecto en 20 anos.

**Esto es lo que puede hacer IA sobre datos reales de operacion.**

---

## SLIDE 8 — Modelo de negocio

**SaaS + transaccional**

| Componente | Precio | Notas |
|---|---|---|
| Suscripcion mensual | $2,500 - $5,000 MXN/mes | Segun tamano del restaurante |
| Setup | $0 | El setup gratuito es el diferenciador |
| Facturacion electronica | Variable | Comision por CFDI |
| Modulos premium (IA avanzada) | $1,000 - $3,000 MXN/mes | Food cost, predicciones, compras |
| Compras grupales (futuro) | Comision sobre ahorro | Network effect |

**Unit economics objetivo:**
- ARPU: $4,000 MXN/mes (~$225 USD)
- CAC: < $5,000 MXN (1.25 meses de payback)
- LTV: $144,000 MXN (36 meses, churn 3%)
- LTV/CAC: 29x

---

## SLIDE 9 — Mercado

**TAM: $4.2B USD** — Software para restaurantes en LATAM
**SAM: $850M USD** — Mexico (600K+ restaurantes)
**SOM: $8.5M USD** — 3,000 restaurantes en 3 anos ($225/mes)

**Por que ahora:**
- IA generativa permite automatizar lo que antes requeria consultores
- COVID acelero la digitalizacion de restaurantes 5 anos
- Wansoft y competidores legacy no tienen capacidad tecnica para integrar IA
- El costo de infraestructura cloud se redujo 80% en 5 anos

---

## SLIDE 10 — Competencia

|  | Wansoft | Soft Restaurant | Poster | Clip Pagos | **Fullsite** |
|---|---|---|---|---|---|
| POS completo | SI | SI | SI | Basico | **SI** |
| Inventario real | Basico | Basico | No | No | **IA + recetas** |
| Food cost | Manual | No | No | No | **Automatico** |
| IA / Prediccion | No | No | No | No | **30 agentes** |
| Setup | Dias | Dias | Horas | Minutos | **< 30 min** |
| Offline | SI (local) | SI (local) | Parcial | No | **SI (PWA)** |
| Mobile | No | No | SI | SI | **SI** |
| Precio | Alto | Alto | Medio | Bajo | **Medio** |

**Ningun competidor en Mexico combina POS completo + IA operativa.**

---

## SLIDE 11 — Go-to-market

**Fase 1 — Desplazar Wansoft (0-100 restaurantes)**
- Reverse engineering completo = podemos migrar cualquier restaurante Wansoft en 1 semana
- 615 recetas, 522 platillos, 202 proveedores migrados como prueba
- Eduardo de la Garza: ex-director comercial de Wansoft (construyo la operacion de 2 a 35 personas). Prospecto para CCO

**Fase 2 — Expansion regional (100-500)**
- Monterrey primero, CDMX despues
- Partner channel: contadores, distribuidores de TPVs
- Self-service setup: el restaurante se instala solo

**Fase 3 — Network effect (500+)**
- Benchmarks anonimos entre restaurantes
- Compras grupales (20 restaurantes negociando pollo juntos = 12% menos)
- Predicciones cruzadas ("tu zona ve 20% mas trafico este viernes")

---

## SLIDE 12 — El equipo

**Daniel Ramonfaur — Founder & CEO**
- Ingeniero de software. Construyo todo el stack solo: POS, KDS, bridge, 30 agentes IA, dashboard, offline-first architecture
- Opera AMALAY Coffee & Market (restaurante piloto, $31M MXN en ventas 2025)
- Conoce el problema de adentro — es dueno de restaurante Y desarrollador
- YC W27 target

**Buscando:**
- CTO / Co-founder tecnico
- Head of Sales (perfil Eduardo de la Garza)
- Monica — Co-founder operaciones (20% equity, operaciones AMALAY)

---

## SLIDE 13 — La ronda

**Pre-seed: $500K USD**

| Uso | Monto | Resultado |
|---|---|---|
| Equipo (CTO + Sales) | $250K | De 1 a 3 personas |
| Producto (inventario, compras, facturacion) | $100K | Paridad completa con Wansoft |
| Go-to-market (Monterrey) | $100K | De 1 a 50 restaurantes |
| Operaciones + legal | $50K | Incorporacion, SAFE, contabilidad |

**Hitos a 12 meses:**
- 50 restaurantes activos
- $200K MXN MRR
- Aplicacion a YC W27
- Serie Seed de $2-3M

**Instrumento:** SAFE (Post-money, terminos estandar YC)

---

## SLIDE 14 — Por que ahora, por que nosotros

**1. Tenemos la data.**
903 dias de operacion real. $73.7M MXN procesados. No es un piloto — es un negocio funcionando.

**2. Hicimos lo mas dificil primero.**
Reverse engineering completo del incumbente de 20 anos. Nadie mas ha hecho esto.

**3. El timing es perfecto.**
IA + cloud + COVID = la ventana para disrumpir restaurantes legacy esta abierta. En 3 anos se cierra.

**4. El founder conoce ambos lados.**
Es dueno de restaurante Y ingeniero de software. No necesita "validar el problema" — lo vive todos los dias.

**5. El producto ya existe.**
No estamos pidiendo dinero para construir. Estamos pidiendo dinero para escalar.

---

## SLIDE 15 — Cierre

**Fullsite no es un POS.**
**Es el sistema operativo que todo restaurante en Mexico necesita pero nadie ha construido.**

903 dias de datos reales.
30 agentes de IA en produccion.
Cutover en restaurante piloto: 8 julio 2026.

**El software de restaurantes lleva 20 anos sin innovar.**
**Nosotros ya empezamos.**

daniel@fullsite.mx
fullsite.mx

---

## APPENDIX A — Metricas detalladas del piloto

| Metrica | 2024 | 2025 | 2026 (6 meses) |
|---------|------|------|-----------------|
| Ventas brutas | $27.8M MXN | $31.1M MXN | $14.7M MXN |
| Promedio diario | $76K | $85K | $82K |

**Delivery (mayo 2026, 13 dias):**
- UberEats: 149 ordenes, $76K
- Rappi: 32 ordenes, $13K
- Ticket promedio delivery: $488

**Food cost por categoria (cocina):**
- Chilaquiles & Enchiladas: 16.7%
- Toast & Bagels: 17.5%
- Pizzas & Pastas: 18.1%
- Coffee: 18.5%
- Promedio cocina: 24.9%

## APPENDIX B — Stack tecnico

- **Frontend:** Next.js 15 (PWA, offline-first)
- **Backend:** Supabase (PostgreSQL, Auth, Realtime)
- **Deploy:** Vercel (global CDN)
- **IA:** Claude API (30 agentes autonomos via GitHub Actions)
- **Impresion:** Bridge Node.js local → ESC/POS TCP/USB
- **Offline:** IndexedDB + sync queue con conflict resolution
- **Scraping:** Playwright (Wansoft data extraction)
- **Facturacion:** Facturama API (CFDI 4.0)

## APPENDIX C — Datos extraidos de Wansoft

| Dataset | Registros | Estado |
|---------|-----------|--------|
| Platillos (menu) | 522 | Migrado |
| Recetas | 615 | Migrado |
| Productos (inventario) | 3,000+ | Migrado |
| Costos por producto | 878 | Migrado |
| Proveedores | 202 | Migrado |
| Existencias | 840 | Migrado |
| Puntos de reorden | 300+ | Migrado |
| Modificadores | 114 | Migrado |
| Asignacion mods | 517 | Migrado |
| Clientes facturacion | 36 | Listo |
| Staff (empleados) | 40 | Listo |
| Metodos de pago | 14 | Listo |
| Ventas historicas | 903 dias | En Supabase |
