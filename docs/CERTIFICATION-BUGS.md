# Bugs encontrados durante certificación

---

## BUG-001 — Turno activo requiere refresh

**Categoría:** Funcional
**Prioridad:** P1
**Bloquea certificación:** No

**Reproducible:**
1. Abrir turno desde `/pos/turno`
2. Navegar a otra página del POS
3. Regresar a `/pos/turno`
4. La UI muestra "Abrir turno" como si no hubiera turno activo
5. Hacer refresh (Cmd+R) → ahora sí detecta el turno

**Esperado:** La página debe detectar el turno abierto sin refresh.

**Causa raíz (investigación):**
- La página de Turno (`/pos/turno/page.tsx`) carga el turno activo en un `useEffect` al montar
- Cuando navegas con Next.js `router.push`, el componente puede no re-montarse si está cacheado por el router
- El estado `activeTurno` no se refresca en navegación client-side
- NO hay polling ni listener de visibilidad

**Fix propuesto:** Agregar `cache: 'no-store'` al fetch del turno activo, o agregar polling cada 10 seg, o refrescar en `visibilitychange`.

**Estado:** Documentado

---

## BUG-002 — Venta no apareció en el cierre de caja

**Categoría:** Datos / Dinero
**Prioridad:** Investigando (P0 si es bug real, no-issue si es efecto de la prueba)
**Bloquea certificación:** Pendiente de determinar

**Observado durante la prueba:**
1. Abrimos turno con fondo $2,000
2. Cobramos mesa 8 por $55.68 en efectivo
3. Abrimos el wizard de cierre
4. El wizard mostró: Ventas en efectivo $0.00, Total ventas $0.00

**Investigación:**
- La orden `62edf08c` tiene `turno_id = mqv59atovbkd` (correcto)
- La orden fue creada `16:28:02`, turno abierto `16:27:14` (orden DESPUÉS del turno)
- La orden tiene `status = cerrada`, `total = 55.68`, `metodo_pago = Efectivo`
- Query directa con service key a Supabase CON el filtro del wizard SÍ encuentra la orden
- El wizard usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key) — posible diferencia de RLS

**Hipótesis pendientes de verificar:**
1. ¿RLS con anon key bloquea la lectura? (la tabla podría tener RLS habilitado que filtra por algo)
2. ¿El wizard cargó datos antes de que la orden se cerrara? (cache del useEffect)
3. ¿La navegación a `/pos/turno` no re-disparó el useEffect del wizard?
4. ¿El `turnoOpenedAt` prop tenía un valor stale de una sesión anterior?

**Datos para reproducir:**
- turno_id: `mqv59atovbkd`
- order_id: `62edf08c-56a0-4e15-a09b-97937a560adb`
- turno opened_at: `2026-06-26T16:27:14`
- order created_at: `2026-06-26T16:28:02`
- order closed_at: `2026-06-26T16:29:38`

**Estado:** En investigación — necesita reproducción controlada

---

## BUG-003 — UX Touch en Corte de Caja

**Categoría:** UX
**Prioridad:** P1 UX
**Bloquea certificación:** No

**Observado:**
- El reporte de Corte de Caja tiene demasiado contenido para pantalla touch
- El scroll es pequeño/difícil en la terminal de AMALAY
- Los botones Cierre/Corte X no son sticky
- Las secciones no tienen separación clara para touch

**Propuesta de mejoras (no implementar todavía):**
1. Área de scroll más grande
2. Eliminar scrolls internos cuando sea posible
3. Botones sticky (Cierre, Corte X, Imprimir) siempre visibles
4. Targets touch más grandes (min 48px)
5. Cards con mejor separación
6. Optimizar para terminales táctiles

**Estado:** Documentado

---

## Clasificación de hallazgos

| ID | Tipo | Prioridad | Bloquea | Estado |
|---|---|---|---|---|
| BUG-001 | Funcional | P1 | No | Documentado |
| BUG-002 | Datos/Dinero | Investigando | Pendiente | En investigación |
| BUG-003 | UX | P1 | No | Documentado |
