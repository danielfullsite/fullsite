# Checklist: Archivos para carga masiva de sub-recetas + productos

> Para Daniel — exportar de Wansoft mañana
> Cada archivo es un export del portal de Wansoft

---

## Ya tenemos (no exportar de nuevo)

1. **ReporteProductos2026-07-17 (1).xlsx** — 775 productos con departamento, tipo, rendimiento, costo, presentaciones, proveedores

---

## Falta exportar

### 2. Recetas de subproductos (CRÍTICO)

**Caminito:** Inventario > Producción y costos > Receta de subproductos

Para cada subproducto, necesito sus ingredientes. Hay 2 opciones:

**Opción A (preferida):** Descargar la "Plantilla para carga masiva de recetas de subproductos" (el link rojo que vimos en el screenshot). Es un Excel que probablemente ya tiene todas las recetas cargadas. Si viene vacía, usar opción B.

**Opción B:** Abrir cada sub-receta una por una y sacar screenshot. Son 123 subproductos — esto tomaría mucho tiempo. Solo usar si la plantilla no funciona.

### 3. Recetas de platillos (IMPORTANTE)

**Caminito:** Inventario > Producción y costos > Receta de platillos

Misma lógica — descargar la "Plantilla para carga masiva de recetas". Esto tiene los ingredientes de cada platillo (como los CHILAQUILES que vimos con 8 ingredientes).

Ya tenemos 4066 líneas en pos_recipes_old pero NO tienen ingredient_type (no distinguen materia prima de sub-receta). Con este export podemos enriquecer los datos.

### 4. Reporte de existencias actual (ÚTIL)

**Caminito:** Reportes > Inventarios > Reporte de existencias

Stock actual de cada producto. Útil para poblar pos_inventory con datos reales.

### 5. Reporte de Costo y margen (ÚTIL)

**Caminito:** Reportes > Inventarios > Costo y margen

Costo actual de cada ingrediente según Wansoft. Para validar que nuestro cálculo coincide.

---

## Qué hago con cada archivo

| Archivo | Acción |
|---|---|
| Productos (ya tenemos) | UPDATE pos_ingredients: department, product_type, is_critical. INSERT subproductos como pos_sub_recipes |
| Recetas subproductos | INSERT pos_sub_recipe_ingredients (ingredientes de cada sub-receta) |
| Recetas platillos | UPDATE pos_recipes_old: marcar ingredient_type='sub_recipe' donde corresponda |
| Existencias | Validación cruzada con pos_inventory |
| Costo y margen | Validación: comparar costo Wansoft vs costo calculado por nuestro engine |

---

## Orden de operaciones mañana

1. Exportar archivos de Wansoft
2. Parsear y validar datos
3. Match por nombre (productos Excel ↔ pos_ingredients por nombre)
4. UPDATE campos nuevos en productos existentes
5. CREATE sub-recetas (pos_sub_recipes)
6. CREATE ingredientes de sub-recetas (pos_sub_recipe_ingredients)
7. UPDATE pos_recipes_old ingredient_type donde corresponda
8. Validar costos calculados vs Wansoft
9. Probar en la UI de /recetas/sub-recetas
