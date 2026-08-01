# Paso 3: Plan de sesión — UI de /recetas

> Para retomar mañana sin perder contexto.
> No escribir código hasta revisar los archivos.

---

## Archivos indispensables (ALTA prioridad)

### Página actual y nueva de recetas
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/app/recetas/page.tsx` | Página actual de recetas de platillos. Necesito entender qué ya existe para no romperlo al agregar tabs/navegación. | CRUD existente, cómo agrupa recetas, cómo muestra costos, imports |
| `dashboard-app/src/app/recetas/sub-recetas/page.tsx` | La página que acabo de crear. Necesito verificar que el estado es correcto después del deploy. | Todo — es código nuevo mío |

### APIs que construimos (Paso 2)
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/app/api/sub-recipes/route.ts` | GET lista + POST crear | Request/response format |
| `dashboard-app/src/app/api/sub-recipes/[id]/route.ts` | GET detalle + PATCH + DELETE | Cómo resuelve ingredient names |
| `dashboard-app/src/app/api/sub-recipes/[id]/ingredients/route.ts` | GET + POST ingredientes con anti-ciclos | Validaciones, formato de errores |
| `dashboard-app/src/app/api/sub-recipes/[id]/ingredients/[lineId]/route.ts` | DELETE ingrediente | Verificaciones de ownership |
| `dashboard-app/src/app/api/food-cost/calculate/route.ts` | Endpoint de cálculo de costo | Query params, response format |
| `dashboard-app/src/lib/cost-engine.ts` | Motor de costo puro | Tipos exportados (CostResult, CostLineResult), loadCostEngineData signature |
| `dashboard-app/src/app/api/unit-conversions/route.ts` | GET + POST conversiones | Response format |
| `dashboard-app/src/app/api/presentations/route.ts` | GET + POST presentaciones | Response format |
| `dashboard-app/src/app/api/presentations/[id]/assign/route.ts` | POST asignar a ingrediente | Request format |
| `dashboard-app/src/app/api/dependencies/[ingredientId]/route.ts` | GET grafo de dependencias | Response format (sub_recipes, dishes) |

### Helpers de API y auth
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/lib/api-auth.ts` | getClientId() — cómo se extrae client_id del request | Patrón a seguir en la UI |
| `dashboard-app/src/lib/pos-data.ts` | getRecipes(), getIngredients(), formatMXN — funciones que usa la página actual de recetas | Tipos RecipeRow, Ingredient. No modificar |

### Layout y navegación
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/components/AppShell.tsx` | Cómo se renderiza el layout. Verificar que /recetas/sub-recetas no necesita ajustes | publicPages, isPosRoute |
| `dashboard-app/src/components/Sidebar.tsx` | Verificar que /recetas está en el sidebar y /recetas/sub-recetas es accesible como sub-ruta | navSections |

---

## Archivos útiles pero opcionales (MEDIA prioridad)

### Componentes reutilizables
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/components/PageHeader.tsx` | Ya lo uso en sub-recetas. Verificar props disponibles | Props: title, subtitle, eyebrow, action |
| `dashboard-app/src/components/KPICard.tsx` | Por si quiero agregar KPIs de sub-recetas (total, costo promedio, etc.) | Props, estilos |
| `dashboard-app/src/components/EmptyState.tsx` | Patrón de estado vacío del dashboard | Props |

### Páginas de referencia visual
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/app/food-cost/page.tsx` | Cómo muestra costos, márgenes, recetas sospechosas. Referencia para estilo visual de costeo | Solo visual — no modificar |
| `dashboard-app/src/app/costos/page.tsx` | Cómo muestra ingredientes con yield_factor. Ya lee yield_factor de la DB | Cómo renderiza el yield |
| `dashboard-app/src/app/inventario-real/page.tsx` | Referencia para tablas de inventario | Patrón de tabla |

### Estilos
| Archivo | Por qué | Qué revisar |
|---|---|---|
| `dashboard-app/src/app/globals.css` | Variables CSS del sistema de diseño (--surface, --line, --text-1, etc.) | Solo las variables, no todo el archivo |

---

## Archivos que NO necesito todavía (BAJA / no tocar)

| Archivo | Por qué NO |
|---|---|
| `dashboard-app/src/app/pos/page.tsx` | POS — no conectamos recetas al POS todavía |
| `dashboard-app/src/app/api/pos/save-order/route.ts` | Deducción de inventario — Paso 5, no ahora |
| `dashboard-app/src/lib/pos-data.ts` (funciones de deducción) | r1_reconcile_order — no tocar |
| `dashboard-app/src/app/inventario-real/*/page.tsx` | Inventario operativo — no conectamos todavía |
| `dashboard-app/src/components/pos/*` | Componentes del POS — no relevantes |
| `.github/scripts/*.py` | Agentes IA — no relevantes para UI |
| `electron-app/*`, `electron-kds/*` | Electron — no relevante |

---

## Exports de Wansoft (Daniel exporta mañana)

### Crítico
1. **Recetas de subproductos** — Inventario > Producción y costos > Receta de subproductos > "Plantilla para carga masiva de recetas de subproductos"

### Importante
2. **Recetas de platillos** — Inventario > Producción y costos > Receta de platillos > "Plantilla para carga masiva de recetas"

### Útil para validar
3. **Reporte de existencias** — Reportes > Inventarios > Reporte de existencias
4. **Costo y margen** — Reportes > Inventarios > Costo y margen

---

## Orden de trabajo mañana

### Bloque 1: Datos (30-45 min)
1. Recibir exports de Wansoft
2. Parsear Excel de recetas de subproductos
3. Match productos Excel ↔ pos_ingredients por nombre
4. UPDATE pos_ingredients: department, product_type, is_critical para los 1050 existentes
5. CREATE pos_sub_recipes: 123 sub-recetas
6. CREATE pos_sub_recipe_ingredients: ingredientes de cada sub-receta
7. Verificar en UI que las sub-recetas aparecen con costos

### Bloque 2: UI — mejorar /recetas/sub-recetas (30-45 min)
8. Revisar archivos indispensables
9. Agregar edición inline de sub-receta (nombre, rendimiento, notas)
10. Mejorar dropdown de ingredientes (búsqueda, mostrar unidad y costo)
11. Agregar indicador visual de sub-receta anidada en el breakdown
12. Agregar link de navegación desde sidebar o desde /recetas

### Bloque 3: UI — tabs en /recetas (30-45 min)
13. Agregar tab "Ingredientes" con yield_factor editable
14. Agregar tab "Conversiones" (CRUD simple)
15. Agregar tab "Presentaciones" (CRUD + asignación)
16. Navegación fluida entre tabs

### Bloque 4: Validación (15-30 min)
17. Comparar costo calculado de CHILAQUILES en Fullsite vs Wansoft ($34.93)
18. Comparar 5+ platillos para verificar que el engine es correcto
19. Verificar que warnings aparecen cuando falta costo o conversión
20. Probar desactivar sub-receta con dependencias (debe fallar con lista)

### Bloque 5: Dependencias UI (15-30 min)
21. Mostrar dependencias al hacer hover o click en "Desactivar"
22. Al editar un ingrediente, mostrar cuántos platillos se afectan

---

> Este plan es flexible. Si los exports de Wansoft tardan,
> empezamos por el Bloque 2 (UI) sin datos reales.
> Si los exports llegan rápido, empezamos por el Bloque 1 (datos).
