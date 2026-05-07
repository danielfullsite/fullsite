# war-room-ui

## Scope
El frontend interno del War Room: dashboard operativo de AMALAY y UI de reservaciones.
Todo vanilla HTML/CSS/JS — sin framework, sin build step. Servido como archivos estáticos.

## Key files
- `fullsite.html` — Dashboard principal del War Room. Setup screen con password → app principal. Secciones: Wansoft KPI live, reservaciones, ranking meseros, shared memory panel, chat panel lateral deslizable. Topbar con pills de status por tentáculo.
- `eventos.html` — UI de reservaciones para clientes o staff (TODO: verificar quién la usa y si está en producción).
- `assets/characters/` — PNGs de personajes (probablemente para floor plan o avatar de staff).
- `assets/floors/` — Imágenes de planos de planta del restaurante.
- `assets/furniture/` — Assets de mobiliario para el floor plan.
- `assets/walls/` — Assets de muros para el floor plan.
- `assets/default-layout-1.json` — Layout serializado del floor plan (14KB — mesas y elementos posicionados).
- `landing.html` — Landing pública de Fullsite (creada 2026-05-07). Secciones: Hero con Three.js neural sphere, El problema, Agentes, Caso AMALAY, Pricing.

## Architecture / Stack
- **Zero dependencies:** HTML/CSS/JS puro — ningún framework, ningún bundler
- **Fonts:** Syne (700/800) + JetBrains Mono — via Google Fonts CDN
- **Design tokens:** CSS custom properties en `:root` — bg, surface, card, border, green (#4ade80), amber, blue, red, purple, teal
- **Auth:** Password hardcodeado en JS del setup screen (verificar si existe o si valida contra Supabase)
- **Data:** Llama Supabase REST directamente desde el browser (requiere SUPABASE_URL + anon/service key en el cliente — TODO: verificar cómo se maneja)
- **Landing** (`landing.html`): Fraunces italic + Geist, accent #00ff88, Three.js r128 CDN, scroll reveal con IntersectionObserver

### Landing pública separada
`https://ramonfaurdaniel-png.github.io/fullsite-web/` — repo diferente, no está en este directorio.

## Known issues / gotchas
- `fullsite.html` y `fullsite.html.bak.20260502-183114` coexisten en la raíz — el bak es idéntico al actual al momento del backup.
- Los assets en `assets/` (characters, floors, furniture, walls) sugieren un floor plan interactivo pero no es evidente si está implementado en `fullsite.html` o es código separado pendiente.
- `eventos.html` — propósito y estado de producción sin confirmar. TODO: verificar si tiene usuarios activos.
- `landing.html` tiene stats de Caso AMALAY como placeholders `[X]%` — pendiente datos reales de Mónica Gracia.

## How to extend
- **Nueva sección en dashboard:** agregar pill en topbar + sección en el main con el patrón de cards existente. Todo inline en `fullsite.html`.
- **Nueva página:** crear HTML independiente en la raíz (sin routing — cada página es un archivo).
- **Actualizar landing:** editar `landing.html`. CTAs apuntan a `mailto:daniel@fullsite.mx`. CTA "caso-amalay" apunta a `#caso-amalay` anchor.
- **No usar frameworks:** el sistema completo es estático — mantener sin build step.
