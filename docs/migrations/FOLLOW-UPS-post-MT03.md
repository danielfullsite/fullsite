# Follow-ups post MT-03

> Creado: 2026-07-27  
> Branch origen: `migration-engine/root-cause-001`  
> Prerrequisito: MT-03 cerrado, slug index mergeado a main

Estos ítems NO se implementan en este branch. Cada uno es un workstream separado
con su propio worktree y aprobación explícita.

---

## MT-05 — Regla determinista `sub_` prefix

**Tipo:** Regla algorítmica en `lib/resolver.ts`  
**Impacto potencial:** −36 líneas orphan (SUB_PREFIX_MISMATCH, 7 IDs)  
**Descripción:** Si `slugIndex.get('sub_' + rawSlug)` existe en el catálogo,
usar ese ID sin fuzzy. La regla es exacta — no introduce ambigüedad.  
**Referencia:** MT-03-closure-report.md §Categoría B  
**Estado:** Pendiente aprobación de la regla antes de implementar.

---

## ALIAS-01 — `kambucha_original_377_ml` → `BEB85066`

**Tipo:** Alias aprobado en `approved-aliases.ts`  
**Motivo:** Typo ortográfico KAMBUCHA vs KOMBUCHA (Levenshtein dist=1)  
**Confianza:** HIGH  
**Referencia:** MT-03 original (commit `ad13889`) + cierre (commit `a950c09`)  
**Estado:** Pendiente aprobación explícita de Daniel.

---

## ALIAS-02 — `kambucha_sandia_fresca_377_ml` → `BEB85080`

**Tipo:** Alias aprobado en `approved-aliases.ts`  
**Motivo:** Typo KAMBUCHA/KOMBUCHA + FRESCA/FRESA (dist=2). Verificar que
KOMBUCHA SANDIA FRESA es efectivamente el mismo producto antes de aprobar.  
**Confianza:** MEDIUM  
**Referencia:** MT-03 original + cierre  
**Estado:** Pendiente aprobación explícita de Daniel.

---

## ALIAS-03 — `amalay_galletas_bote_420g` → `0739802436570`

**Tipo:** Alias aprobado en `approved-aliases.ts`  
**Motivo:** Preposición "DE" ausente en nombre de receta (dist=3).
Slug receta: `amalay_galletas_bote_420g` vs catálogo: `amalay___galletas_bote_de_420g`.  
**Confianza:** HIGH  
**Referencia:** MT-03-closure-report.md §Categoría A  
**Estado:** Pendiente aprobación explícita de Daniel.

---

## MT-06 — Revisión manual C1: inversión de orden AMALAY

**Tipo:** Revisión operativa + aliases manuales  
**Scope:** 12 IDs, 14 líneas (ver MT-03-closure-report.md §C1)  
**Descripción:** Las recetas usan patrón `{tipo}_amalay_` mientras el catálogo
usa `AMALAY - {tipo}`. La distancia Levenshtein es ≥ 6 — no auto-resolvable.
Requiere verificación manual por cada par antes de alias.  
**Casos prioritarios:** `amalay_cafe_molido_300g` / `cafe_amalay_300_gr_molido`
(posible duplicado referenciando `MAR801`), galletas AMALAY (3 SKUs).  
**Estado:** Pendiente revisión operativa con AMALAY.

---

## MT-07 — Sub-recetas de temporada (C2)

**Tipo:** Revisión de catálogo Wansoft  
**Scope:** 4 IDs: `sub_carrot_cake`, `sub_rosca_de_reyes_*`, `sub_amalay_sour_watermelon_*`  
**Descripción:** Sub-recetas que posiblemente son de temporada o fueron renombradas.
`sub_carrot_cake` tiene candidato `SUB CARROT CAKE REBANADA` (dist=8, sufijo extra).
Roscas de reyes — verificar si están en catálogo Wansoft actual.  
**Estado:** Pendiente revisión con AMALAY / Eduardo.

---

## MT-08 — Productos de market terceros (C3)

**Tipo:** Auditoría de catálogo  
**Scope:** 28 IDs — ver MT-03-closure-report.md §C3  
**Descripción:** Productos comerciales del market AMALAY. Algunos pueden tener
entrada en Wansoft bajo denominación diferente (ej. `birdman_fitmingo_protein_vainilla_510g`
→ `BIRDMAN FALCON PROTEIN VAINILLA 510G`). Otros son genuinamente ausentes.
> Advertencia explícita: `leche_de_almendra` (dist=4 a LECHE DE AVENA) y
> `rx_bar_mixed_berry_52_gr` (dist=5 a RX BAR BLUEBERRY) son productos distintos
> — NO deben aliasarse por similitud léxica.  
**Estado:** Pendiente auditoría. No bloquea Fase 1 del Migration Engine.

---

## MT-09 — Categoría `non_ingredient_reference` (C4)

**Tipo:** Decisión de diseño + schema  
**Scope:** 9 IDs, 16 líneas — velas, fósforos, ramekin, artículos papelería  
**Descripción:** Wansoft modela artículos de gift sets como "ingredientes" de
recetas. El pipeline los rechaza como orphans porque no están en el catálogo
de ingredientes — lo cual es correcto. Requiere una categoría separada
`non_ingredient_reference` para reportarlos sin contaminar las métricas de orphans.  
**Estado:** Pendiente decisión de diseño (D-06 o similar).
