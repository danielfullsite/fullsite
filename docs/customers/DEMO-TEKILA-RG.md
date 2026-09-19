# Demo — Tekila Restaurant Group

> 2026-08-29 · Tenant `tekila-rg` VIVO en prod y verificado de punta a punta (turno abierto,
> mesa con su carta, PIN de 10 dígitos funcionando). Reversible: `delete ... where client_id='tekila-rg'`.

## Quiénes son (investigado, fuentes en cada punto)

**OJO — dato clave:** el único "Tekila Restaurant Group" que existe públicamente es de
**Memphis, Tennessee** (no Monterrey): grupo familiar mexicano de **Alex y José Gómez**
(tekilasteakhouse.com/about), con su **gerente de operaciones, Eduardo García, basado en
Monterrey** (LinkedIn) — probablemente tu contacto. Confirmar con quién es la junta antes
de asumir nada. Sitio: grupotekila.com · 51-200 empleados (LinkedIn).

**5 marcas, 2 estados, expansión agresiva** (200+ empleos nuevos anunciados):

| Marca | Concepto | Dónde |
|---|---|---|
| Tekila Modern Mexican | Mexicano upscale-casual, horno Josper | Southaven, MS (2022) |
| Tekila Steakhouse | Steakhouse mexicano, edificio histórico | Union Ave, Memphis (2024) |
| Tekila Bar & Grill | Tex-Mex casual, margaritas | Germantown, Memphis |
| Fuego Vivo | Fine dining, wagyu, tableside theater | East Memphis (2026) |
| Zona 55 | Urban grill casual | Senatobia, MS (por abrir) |

POS actual: **no verificado** (nada público). Tienen ordering propio (ordertekila.com),
catering y eventos.

## El tenant demo (todo verificado en vivo)

- **Entrar:** `/platform/tenants` → fila "Tekila Restaurant Group" → **Entrar** (act-as).
- **PINs (10 dígitos, la nueva regla):** dueño `4820157396` · gerente `7351904268` ·
  mesero `2093846517`.
- **Las 5 marcas cargadas como sucursales** (el comparativo de /sucursales funciona entre ellas).
- **Su carta real** (precios USD de sus menús publicados): Guacamole $12, Tuna Tostada $16,
  Carne Asada $34, Ave & Mar $30, Ribeye al Josper $48, Tomahawk $95, Ultimate Paloma $13,
  Coconut Crème Brûlée $8. 14 mesas, tema dark, acento ámbar.
- **Umbrales día-0 sembrados** (labor 35 / food 35 / prime 62 / SLA 15 min) — la IA puede
  hablar de SUS números de industria desde el día 1.
- Estado al dejarlo: **turno abierto** por "Alex (dueño demo)" con fondo $1,000 — listo para
  demo inmediata; ciérralo con Corte Z al terminar (estrenando el folio Z #1).

### Datos sembrados (2026-08-30, verificados renderizando en /sucursales)

**45 días de ventas — 5,520 órdenes cerradas** con turnos diarios y perfiles realistas por
marca (fin de semana +35%, propinas 15-23%, pago 72% tarjeta):

| Marca | Órdenes | Ventas (45d) | Ticket prom. |
|---|---|---|---|
| Fuego Vivo (fine dining) | 666 | $157K | **$236** |
| Tekila Steakhouse | 1,277 | $147K | $115 |
| Tekila Modern Mexican | 1,459 | $114K | $78 |
| Tekila Bar & Grill | 2,118 | $88K | $42 |
| Zona 55 | 0 | — | (por abrir — úsalo para la historia de expansión) |

El comparativo de `/sucursales` muestra cada marca con SUS números, top mesero y top
categoría — verificado en vivo. Con esto el dashboard, /ventas, /meseros y el chat de IA
tienen 45 días de historia que contar.

## Guion de demo (12 min)

1. **(1 min) El gancho del grupo:** "Ustedes tienen 5 conceptos en 2 estados. Les armé su
   plataforma — no un demo genérico." Abre `/platform/tenants` → Entrar a Tekila.
2. **(2 min) El comparativo entre marcas** → `/sucursales`: las 5 marcas lado a lado en un
   panel. "Modern vs Steakhouse vs Fuego Vivo, mismo día, sin pedirle nada a nadie." (Su dolor
   #1 como grupo: consolidación.)
3. **(3 min) El POS con SU carta** → `/pos` → PIN dueño → mesa 1 → agrega Ribeye al Josper +
   Ultimate Paloma → envía → enseña la comanda llegando al KDS (`/kds` en otra pestaña).
4. **(2 min) La IA** → `/chat`: "¿cómo van las ventas?" + explica los agentes (antifraude,
   merma, staffing) y que su tablero nace sabiendo los benchmarks de su giro.
5. **(2 min) Offline** (el diferenciador que nadie más tiene): cuenta la historia — "si se
   cae el internet en Union Ave un sábado, la caja cobra e imprime igual; está probado en
   restaurante real".
6. **(2 min) El cierre:** alta de un restaurante nuevo en vivo (selector de tipo → nace
   configurado). "Así abriríamos Zona 55: minutos, no semanas." Oferta: **primer mes gratis**
   (regla de la casa) + piloto en una marca.

## Notas honestas para la junta

- Los precios/carta son de sus menús públicos (aprox.) — invítalos a corregirlos en vivo:
  editar el menú frente a ellos es parte del show.
- Si preguntan por facturación USA (sales tax, no CFDI): decir la verdad — hoy el stack
  fiscal es México (CFDI 4.0); EUA sería roadmap de expansión. `iva_rate` del demo está en 0.
- No sabemos su POS actual: preguntar primero ("¿qué usan hoy y qué les duele?") antes de
  comparar con nadie.
