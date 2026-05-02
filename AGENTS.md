# AGENTS.md — Guía para agentes que trabajan en este repo

> Este archivo lo lee Claude Code (local + GitHub Action) automáticamente al iniciar sesión.
> Todo lo que esté aquí se aplica a cualquier agente que toque el código.
> Si algo cambia en el repo, **actualiza este archivo en el mismo commit**.

---

## 1 · Identidad del repo

- **Nombre:** `fullsite`
- **Owner:** `ramonfaurdaniel-png`
- **Visibilidad:** **público** (cualquiera puede ver el código)
- **Propósito:** dashboard interno "War Room" para AMALAY Coffee + sistema de reservaciones del mismo negocio. AMALAY es el cliente piloto de Fullsite (la agencia de Daniel).
- **Deploy:** GitHub Pages, branch `main`, root del repo
- **URL pública:**
  - https://ramonfaurdaniel-png.github.io/fullsite/ → `index.html` (landing del repo)
  - https://ramonfaurdaniel-png.github.io/fullsite/fullsite.html → War Room dashboard
  - https://ramonfaurdaniel-png.github.io/fullsite/eventos.html → Reservaciones AMALAY

---

## 2 · Archivos del repo

### Trackeados en raíz (todos importantes, no hay zombis)

| Path | Tamaño | Qué es |
|------|--------|--------|
| `fullsite.html` | 253 KB | **War Room dashboard.** Single-file vanilla HTML/CSS/JS. Conecta a Supabase + n8n + Telegram bot. Usa D3.js para visualizaciones. Es el archivo más grande y más editado del repo. |
| `eventos.html` | 633 KB | **Sistema de reservaciones de AMALAY.** Form → Supabase → Make.com → Google Calendar + Gmail. Este archivo también vive en el repo separado `amalay-` y debe mantenerse sincronizado con esa copia. |
| `index.html` | 50 KB | Landing del repo. Punto de entrada de GitHub Pages. Casi no se modifica. |
| `package.json` | — | Define proyecto Bun + Vitest. Scripts: `bun test`, `bun test:watch`. |
| `bun.lock` | — | Lockfile generado por Bun. |
| `tests/security/m1m2-xss-escape.test.js` | — | Único test del repo. Cubre la función `esc()` (escape HTML) que vive en `fullsite.html` línea ~2529. Si se modifica `esc()` en el HTML, hay que actualizar este test. |
| `.github/workflows/claude.yml` | — | Configura Claude Code GitHub Action (Sonnet 4.6, Nivel 3 autónomo). |
| `.gitignore` | — | Excluye `node_modules/`, `.DS_Store`, `.env*`, logs, `.vscode/`. |
| `AGENTS.md` | — | Este archivo. |

### Estructura de `assets/`

```
assets/
├── characters/      ← char_0.png … char_5.png (sprites de agentes IA del War Room virtual)
├── floors/          ← floor_0.png … floor_8.png (texturas de piso)
├── walls/           ← wall_*.png
├── furniture/       ← BIN/, COFFEE/, COFFEE_TABLE/, CACTUS/, etc. (cada carpeta tiene PNG + manifest.json)
└── default-layout-1.json  ← layout inicial del War Room virtual
```

Estos assets sirven al "War Room virtual" — la oficina pixelart con agentes IA (Orquestador, Contenido, Reportes, Ops, KB) sentados en escritorios. NO son del sitio público de la agencia.

### Untracked (en disco pero no en git)

- `node_modules/` — deps de Bun, ignorado por `.gitignore`
- `.claude/` — configuración local de Claude Code (ver sección 5)

---

## 3 · Stack técnico

### Frontend (en los HTML)

- **HTML/CSS/JS vanilla** — no React, no Vue, no build step
- **D3.js v7** vía CDN (para visualizaciones del War Room)
- **Tailwind** vía CDN (para estilos rápidos en algunos componentes)
- **Single-file architecture** — todo el JS y CSS embebido en cada `.html`. Sin imports externos custom (solo CDNs públicas).

### Backend / data

- **Supabase** (project: `qjiomlvudfmzuvqvhwpk`)
  - Frontend usa `anon key` con prefijo `sb_publishable_` (formato nuevo, OK estar público)
  - n8n / Make.com usan `service_role key` (formato `sb_secret_`, NUNCA público)
- **n8n cloud** (`danielramonfaur.app.n8n.cloud`) para orquestación de workflows
- **Telegram Bot** (chat_id: `7654040494`) para notificaciones
- **Make.com** para integraciones webhook → Google Calendar/Gmail
- **Groq API** (Llama 3.3 / Llama 4 Scout) para el bot del War Room
- **Anthropic Claude** (Opus o Sonnet 4.6) usado por el Wansoft AutoSync extension para parser

### Tests

- **Vitest** vía Bun
- Comando: `bun test` (single run) o `bun test:watch`
- Solo 1 test cubre `esc()` para prevenir regresiones de XSS en el War Room

---

## 4 · Workflow de cambios

### Para Claude Code en LOCAL (Mac de Daniel)

1. **Lee este AGENTS.md primero** (siempre)
2. Para archivos HTML grandes (`fullsite.html` 253 KB, `eventos.html` 633 KB):
   - Usa **lectura completa → str_replace targeted** en lugar de `sed` o ediciones por número de línea
   - Si `str_replace` falla por match no único, agrega más contexto a `old_str`
3. **No hacer `git push` automáticamente** — siempre pedir confirmación a Daniel
4. **No correr** `rm -rf`, `sudo`, `git push --force`, `git reset --hard` — están en denylist
5. Si modificas la función `esc()` en `fullsite.html`, **actualizar también** `tests/security/m1m2-xss-escape.test.js`

### Para Claude Code GitHub Action (modo autónomo Nivel 3)

El workflow `.github/workflows/claude.yml` se dispara con:
- Comentarios en issues que mencionen `@claude`
- Issues nuevos con `@claude` en el body
- PRs nuevos o sincronizados (cualquier PR, sin tag)

**Comportamiento esperado:**
- El agente crea su propia branch
- Commitea cambios
- **Pushea la branch (NO crea PR)** — el workflow lo hace solo después
- El workflow auto-mergea si los checks pasan

Custom instructions críticas (ya están en `claude.yml`):
> "After committing and pushing your changes, your job is done. Do NOT try to create PRs or run gh commands — the workflow handles that automatically after you finish."

### Para cambios en el War Room (`fullsite.html`)

Pasos típicos cuando un usuario pide "agregar X al War Room":

1. Lee `fullsite.html` completo
2. Encuentra la sección relevante (busca por comentarios `<!-- ... -->` o IDs de elementos)
3. Agrega/modifica con `str_replace`
4. **NO toques** la lógica de conexión a Supabase ni a n8n sin avisar — son frágiles
5. Test local abriendo `fullsite.html` en navegador (o `python3 -m http.server 8080`)
6. Commit con mensaje descriptivo: `feat(war-room): add X to dashboard`

---

## 5 · Configuración de Claude Code (`.claude/`)

`.claude/settings.json` (no trackeado en este repo):
- Tiene un hook `PreToolUse` que apunta a `graphify-out/graph.json`. **Ese folder ya no existe** (se borró el 2 mayo 2026). El hook es inofensivo pero obsoleto. Se puede limpiar cuando se quiera.

`.claude/settings.local.json` (no se sube a git):
- Permisos pre-aprobados para Bash (`git add`, `git commit`, `git push`, `gh api`, `bun vitest`, `gcloud`, etc.)
- Personal de Daniel — cada developer tiene su propio settings local

---

## 6 · Convenciones de commits

Formato: `<tipo>(<scope opcional>): <descripción corta>`

Tipos comunes:
- `feat` — nueva funcionalidad
- `fix` — corrección de bug
- `chore` — cambios menores (lint, deps, limpieza)
- `docs` — solo documentación
- `refactor` — cambios sin alterar comportamiento
- `test` — solo tests
- `security` — fixes de seguridad

Scopes comunes en este repo:
- `war-room` — cambios a `fullsite.html`
- `eventos` — cambios a `eventos.html`
- `landing` — cambios a `index.html`
- `ci` — cambios al workflow de GitHub Actions
- `docs` — cambios a AGENTS.md, README

Ejemplos buenos del repo:
- `feat(war-room): add Refrescar datos button to header`
- `fix(security): [M-2] escape D3 tooltip d.label/d.desc/d.icon with esc()`
- `security: remove n8n workflow file with embedded API key`
- `chore: remove abandoned HTML backups and graphify tooling`

---

## 7 · Restricciones de seguridad

### NUNCA, bajo ninguna circunstancia

- Commitear API keys, tokens, passwords, o `.env` files
- Modificar `.github/workflows/*` sin que Daniel apruebe explícitamente (afecta autonomía del agente)
- Hacer `git push --force` o `git reset --hard` en `main`
- Hacer commits directos a `main` desde el agente — siempre branch nueva
- Tocar `node_modules/`
- Hardcodear cualquier credencial en `.html`, `.js`, `.json`, `.yml` — **siempre via secrets de GitHub o variables de entorno**

### Reglas para credenciales

- Frontend (`fullsite.html`, `eventos.html`, `index.html`): solo `anon key` de Supabase está OK público. Nada más.
- Workflows de n8n exportados: NO commitear si tienen API keys. Si necesario, scrub primero.
- GitHub Action `claude.yml`: usa `${{ secrets.X }}` siempre, nunca hardcoded.

### Si dudas

- Pregunta primero, ejecuta después
- Si el cambio toca producción de AMALAY (sitio en `cafeamalay.com`, base de datos, n8n workflows activos), **avisa al usuario antes** — AMALAY es el negocio de la mamá de Daniel y no debe romperse

---

## 8 · Cosas conocidas que han fallado antes

Documentadas para que no se repitan:

1. **n8n race condition** en webhooks de Telegram → fix con `await fetch()` secuencial dentro de un solo Code node, no múltiples HTTP nodes en paralelo
2. **Make.com Custom Webhook vs Mailhook** — usa Custom Webhook para HTTP POST de Supabase
3. **Supabase POST necesita header** `Prefer: return=representation` para devolver el UUID insertado
4. **n8n credenciales Anthropic** — usa "Predefined Credential Type" (no manual header) para evitar caracteres invisibles del paste
5. **GoDaddy DNS de cafeamalay.com** — A record correcto es `185.199.108.153` (GitHub Pages)
6. **Wansoft AutoSync extension** parsea `document.body.innerText`, NO la DOM (Wansoft usa AngularJS y no tiene `<table>` real)
7. **Repo de fullsite tuvo nested git repo** (subdirectorio `fullsite/` con su propio `.git`) — limpiado el 2 mayo 2026. Si vuelve a aparecer un `.git` dentro de otro `.git`, no lo crees a propósito.

---

## 9 · Glosario rápido

- **War Room** — `fullsite.html`. Dashboard con KPIs en tiempo real de AMALAY + agentes IA virtuales en oficina pixelart
- **AutoSync** — Chrome extension `AMALAY Wansoft AutoSync` que parsea Wansoft (POS) cada 20 min y sube a Supabase
- **AMALAY** — Coffee shop en San Pedro Garza García. Cliente piloto de Fullsite. Owner: Mónica Gracia (mamá de Daniel)
- **Fullsite** — agencia de marketing+IA de Daniel
- **fullsite-web** — repo SEPARADO con la landing pública de la agencia (no este). URL: `ramonfaurdaniel-png.github.io/fullsite-web/`
- **amalay-** — repo SEPARADO con el sitio `cafeamalay.com` (no este)
- **Eduardo Ezquivel** — contacto de Wansoft con quien Daniel busca integración API directa
- **Mónica** — mamá de Daniel, owner de AMALAY, recibe notificaciones por WhatsApp +52 81 8254 3303

---

## 10 · TODOs activos del repo

(Tareas que un agente puede atacar si Daniel se lo pide explícitamente)

- [ ] Limpiar el hook obsoleto en `.claude/settings.json` que apunta a `graphify-out/`
- [ ] Decidir si `eventos.html` debe vivir aquí o moverse al repo `amalay-`
- [ ] Considerar separar `fullsite.html` (253 KB) en módulos si crece más
- [ ] Agregar más tests a `tests/` además del único de XSS
- [ ] Decidir si privar el repo (actualmente público; alternativa: plan Pro $4/mes para mantener Pages)

---

**Última actualización:** 2 mayo 2026 (sesión de limpieza de repo + reescritura completa)
**Mantenedor:** Daniel Ramonfaur (`ramonfaurdaniel-png`)
