<!-- See also: ../ENGINEERING-AXIOMS.md — cross-project principles for all Fullsite work -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Inventario de Contratos y Fronteras de Dominio

**En Fullsite, la autoridad de un patrón proviene del contrato del dominio, no de la primera implementación que lo utilizó.**

Antes de implementar cualquier flujo que toque un dominio, responder: **"¿Dónde vive el contrato de este dominio?"**

La tabla distingue dos casos:
- **Contrato formal**: el módulo existe, la abstracción está definida. La tarea es invocarlo.
- **Sin contrato formal**: el dominio existe pero no tiene módulo propio aún. La ausencia no autoriza lógica de dominio dentro de una página — obliga a buscar el contrato en otra capa o a crear primero la abstracción mínima reusable. Una página es una interfaz de usuario, no el dueño de la lógica de negocio.

| Dominio | Contrato | Módulo / Punto de entrada | Prohibido |
|---|---|---|---|
| Inventario / stock | **Formal** | `src/lib/inventory.ts` → `recordMovement()` | Escribir directamente a `pos_inventory` o `pos_ingredients.cost_per_unit` |
| Datos de Supabase | **Formal** | `fetch()` directo a PostgREST | Usar el Supabase SDK — causa hang silencioso en App Router |
| Autenticación / client_id | **Formal** | `src/lib/auth.ts` o helper `_cid()` | Hardcodear un `client_id`; consultar sin filtrar por cliente |
| Food cost / costeo | **Formal** | `src/lib/cost-engine/` + `/api/food-cost/calculate` | Calcular costos de platillo o sub-receta en el cliente |
| Impresión | **Formal** | Print bridge `127.0.0.1:7717` | Llamar a impresoras directamente desde el page |
| Event store (POS) | **Formal** | `src/lib/event-store.ts` | Mutar estado POS sin generar un evento inmutable primero |
| Movimientos de caja | **Sin contrato formal** | `pos_cash_movements` via REST (sin módulo propio aún) | Crear lógica de balance directamente en el page; crear el módulo si el flujo crece |
| Agentes IA | **Sin contrato formal** | `/api/chat`, `/api/coach`, `agent_runs` / `agent_results` (sin orquestador en client) | Lógica de inferencia en el page; llamar a Groq/Claude desde el cliente |

## Reglas de Ingeniería

1. **Extender antes de crear.** Si el dominio tiene contrato formal, invocarlo. Si no existe abstracción, crearla en `src/lib/` antes de escribir lógica en el page.
2. **Extender sin modificar.** Un fix que solo invoca el módulo de dominio es bajo riesgo. Un fix que modifica el módulo requiere evaluación de impacto en todos sus consumidores.
3. **El contrato debe ser visible.** Si el módulo no tiene un comentario que describa su contrato, agregarlo como parte del trabajo — no después.
4. **La primera implementación no es el estándar de facto.** Si un dominio carece de abstracción y alguien escribe lógica directamente en un page, ese code no se convierte en referencia. Se convierte en deuda a refactorizar cuando se cree el módulo real.
