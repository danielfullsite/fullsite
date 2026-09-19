# Auditoría de campo — 2026-08-29 (navegador real, sesión admin, tenant carls-jr)

> Ejecutada por Claude con el Chrome de Daniel (sesión existente; sin teclear passwords).
> Método: navegación real en prod + consola + verificación contra la base (read-only).
> Tenant de prueba: `carls-jr` (fast_food, creado por Daniel esta noche).

## Lo que FUNCIONA (verificado en vivo, prod)

| Flujo | Evidencia |
|---|---|
| Ojito de contraseña en /login | Visto renderizado |
| Fix act-as (#209) | Banner "viendo carls-jr" solo con sesión admin real |
| Selector de tipo de restaurante (#208) | Visto por Daniel; carls-jr nació `fast_food`, 0 mesas, 9 items de menú combos |
| **Minute-0 (#215)**: PIN plantilla 1001 entra como dueño y PUEDE abrir turno | Turno abierto en vivo con fondo $500; fila en pos_turnos verificada |
| Corte X + Cierre visibles para dueño | Pantalla Turnos con ambos botones |
| PIN gate muestra el tenant (CARLS-JR) | Visto |

## BUGS encontrados (nuevos, con evidencia)

### B1 — `/ahora` 404 — CORREGIDO EL DIAGNÓSTICO
Verificado después: `main` NO tiene ninguna referencia a `/ahora` — nadie redirige ahí
(el 404 fue por navegación manual; la página vive solo en el working tree local como WIP).
No es bug de prod. Queda la observación menor: el home de un dueño nuevo (`/`) no ofrece
checklist de primeros pasos.

### B2 — El navegador NO puede leer `clients` del tenant nuevo (BLOQUEA, raíz de clonabilidad)
Consola: `[client-config] Sin configuración para "carls-jr": se usan valores por omisión` —
repetido en cada pantalla. `fetchClientConfig` (anon key + RLS) no ve la fila. Cascada:
- El **service model no se resuelve** → un fast_food NUNCA redirige a modo mostrador
  (los PRs #210/#211 quedan inertes para tenants nuevos).
- Tema/acento/IVA/mesas caen a defaults.
AMALAY "funciona" solo por su fallback hardcodeado.

**Raíz encontrada (verificada a mano en prod):** la policy y la membresía están BIEN —
con el token de sesión de localStorage la fila se lee (200). El veneno es
`getAuthToken()`: `supabase.auth.getSession()` se cuelga (falla conocida del SDK en App
Router), el timeout de 3 s degrada a la anon key, y RLS devuelve 0 filas en silencio.
**Fix shippeado:** fallback directo a `sb-<ref>-auth-token` (PR fix/tenant-config-caches).

**Hallazgo extra B5:** `carlsdemo@gmail.com` no tenía NINGUNA fila en `client_users` —
el mapping de dueño falló con el código viejo (upsert con onConflict sin UNIQUE tronaba
y se tragaba el error). El código de main ya hace check-then-insert; la fila de carls-jr
se reparó a mano (insert verificado).

### B3 — Caché de turno CRUZA tenants (BLOQUEA, riesgo de dinero)
En el POS de carls-jr apareció "Turno del día anterior — abierto por Daniel, 25 ago"
— es el turno de **amalay** desde `pos_cached_turno` del navegador (verificado: carls-jr
solo tiene su turno de hoy en la base). El botón "Ir a realizar Corte Z" de esa pantalla
apunta al turno equivocado → **un tenant podría cerrar la caja de otro**. Es el gap #7/#10
de la auditoría de código, ahora con evidencia de campo. Fix: prefijar TODOS los cachés
POS (`pos_cached_turno`, `pos_staff_cache`, `pos_manager_credentials_v2`,
`fullsite_client_id`) con `client_id` y purgar al cambiar de tenant.

### B4 — Métricas de plataforma con números no verificables (CONFUNDE)
/platform muestra "$800,000 Value Created (~$80,000/client/yr)" — huele a estimación
presentada como hecho (viola PUBLIC-CLAIMS-REGISTER). Y "Success Rate 66.1% · 3,392
errors" en agentes: revisar por qué un tercio de las corridas falla.

## Gaps ya documentados que esta sesión CONFIRMÓ

- Identidad por navegador compartido (checador "No autorizado"/"PIN no encontrado" según
  qué sesión tenga la pestaña) — gaps #7–#10 de la auditoría de código.
- KDS de tenant nuevo sin URL/`?client=` (#11).
- Speed screen sin combos sembrados (#12) — carls-jr tiene la categoría Combos como
  ítems de menú, pero `pos_combos` está vacío → sin botones de un toque.

## Orden de ataque propuesto

1. **B2** (lectura de clients) — desbloquea el comportamiento por tipo para TODO tenant nuevo.
2. **B3** (cachés por tenant) — riesgo de dinero; incluye B-checador.
3. **B1** (/ahora) — un commit.
4. #11 KDS URL + #12 combos semilla + B4 métricas honestas.

## Estado del turno de prueba
carls-jr quedó con turno ABIERTO (fondo $500, dueño plantilla) para que Daniel pueda
seguir probando. Cerrarlo desde /pos/turno → Cierre de Caja cuando termine.
