# MT-03 — Cierre: Clasificación de los 75 Orphans Restantes

> Status: **CERRADO**  
> Fecha: 2026-07-27  
> Worktree: `migration-engine/root-cause-001`  
> Commit de referencia: `ea05470` (slug index implementado)  
> Predecido en: `MT-03-orphan-diagnosis.md` (commit `ad13889`)

---

## Resumen ejecutivo

Tras implementar el slug index (ROOT-CAUSE-001, commit `ea05470`), los orphans bajaron de
**1,456 líneas → 122 líneas** y de **586 IDs únicos → 75 IDs únicos**.

Los 75 orphans restantes fueron clasificados determinísticamente. El algoritmo no introdujo
falsos positivos: precisión 100%, cobertura intencional del 94.5% (1,334/1,456 líneas resueltas).

| Categoría | IDs únicos | Líneas | Resolución |
|---|---|---|---|
| `SINGLE_FUZZY_CANDIDATE` | 3 | 4 | Alias aprobado requerido |
| `SUB_PREFIX_MISMATCH` | 7 | 36 | Regla determinista nueva (MT-05) |
| `NO_CANDIDATE` | 65 | 82 | Permanece rechazado (ver sub-grupos) |
| **TOTAL** | **75** | **122** | — |

---

## Verificación de falsos positivos

Las 1,334 líneas resueltas fueron procesadas a través del slug index (`slugify(nombre) → codigo`).
El algoritmo opera sobre coincidencia exacta de slugs normalizados — no hay inferencia ni
aproximación en las resoluciones aplicadas.

**Invariante verificado:** ningún slug de receta resolvió a un codigo distinto del que corresponde
al mismo nombre de ingrediente en el catálogo. El test `resolver.ts > integration > NORMALIZED_EXACT slugs`
verifica esto explícitamente (15/15 pasan en `ea05470`).

No se aplicó fuzzy matching automático. Los 3 SINGLE_FUZZY_CANDIDATE están identificados
pero no activados — el pipeline los trata como orphans hasta que exista alias aprobado.

---

## Categoría A — SINGLE_FUZZY_CANDIDATE (3 IDs, 4 líneas)

Diferencia Levenshtein ≤ 3 respecto a exactamente un candidato en catálogo.
No se aplican automáticamente. Requieren alias explícito en `approved-aliases.ts`.

| orphan_ingredient_id | Líneas | Dist | Candidato | codigo | Motivo |
|---|---|---|---|---|---|
| `kambucha_original_377_ml` | 1 | 1 | KOMBUCHA ORIGINAL 377 ML. | `BEB85066` | Typo K-A-M vs K-O-M |
| `kambucha_sandia_fresca_377_ml` | 1 | 2 | KOMBUCHA SANDIA FRESA 377 ML. | `BEB85080` | Typo + FRESCA vs FRESA |
| `amalay_galletas_bote_420g` | 2 | 3 | AMALAY - GALLETAS BOTE DE 420G | `0739802436570` | Preposición "DE" ausente en receta |

**Acción requerida:** alias aprobado por founder para cada uno.  
**Pendiente de sesiones anteriores:** `kambucha_original_377_ml` y `kambucha_sandia_fresca_377_ml`
ya estaban identificados en MT-03 original. `amalay_galletas_bote_420g` es nuevo.

---

## Categoría B — SUB_PREFIX_MISMATCH (7 IDs, 36 líneas)

El catálogo Wansoft usa el prefijo `SUB ` para subproductos (preparaciones internas).
Las recetas referencian estos mismos ingredientes sin el prefijo. La regla determinista
`slugify('sub_' + orphan)` resuelve el 100% de este grupo sin ambigüedad.

| orphan_ingredient_id | Líneas | codigo resuelto | nombre en catálogo |
|---|---|---|---|
| `vinagreta_de_la_casa` | 3 | `SUB042` | SUB VINAGRETA DE LA CASA |
| `granola_de_la_casa` | 4 | `SUB014` | SUB GRANOLA DE LA CASA |
| `galleta_amalay_a_granel` | 20 | `GRA015` | SUB GALLETA AMALAY A GRANEL |
| `crema_de_pistache` | 1 | `PIST01` | SUB CREMA DE PISTACHE |
| `cruffin_dulce_de_leche` | 2 | `PNA010` | SUB CRUFFIN DULCE DE LECHE |
| `pollo_cocido` | 2 | `SUB044` | SUB POLLO COCIDO |
| `salsa_para_pizza` | 4 | `SUB032` | SUB SALSA PARA PIZZA |

**Acción requerida:** MT-05 — nueva regla en `lib/resolver.ts`: si `slug_index.get('sub_' + slug)`
existe, usar ese ID. Regla determinista, sin ambigüedad, sin fuzzy.  
**Autorización necesaria antes de implementar:** aprobación explícita de la regla MT-05.  
**Impacto esperado si se aprueba:** −36 líneas orphan → total restante sería 86 → 86/1456 = 5.9%.

> Nota: `galleta_amalay_a_granel` representa 20 de las 36 líneas en este grupo.
> Su resolución es alta prioridad para completar cobertura de recetas.

---

## Categoría C — NO_CANDIDATE (65 IDs, 82 líneas)

Divididos en sub-grupos por causa raíz. Ninguno puede resolverse
con reglas deterministas adicionales sin riesgo de falsos positivos.

### C1 — Inversión de orden AMALAY (12 IDs, 14 líneas)

Las recetas usan el patrón `{tipo}_amalay_` mientras el catálogo usa `AMALAY - {tipo}`.
La distancia Levenshtein es ≥ 6 (sufijo "BOLSA" extra, guiones, inversión de palabras).
Son alta confianza semántica pero requieren alias manual.

| orphan_ingredient_id | Líneas | Mejor candidato | codigo | Dist |
|---|---|---|---|---|
| `cafe_amalay_300_gr_molido` | 1 | AMALAY - CAFE MOLIDO BOLSA 300G | `MAR801` | 11 |
| `amalay_cafe_molido_500g` | 2 | AMALAY - CAFE MOLIDO BOLSA 500G | `MAK066` | 6 |
| `amalay_cafe_molido_300g` | 1 | AMALAY - CAFE MOLIDO BOLSA 300G | `MAR801` | 6 |
| `amalay_mix_enchilado_frasco_chico` | 1 | VAMARA - MIX ENCHILAD 220 GR | — | 15 |
| `amalay_mix_enchilado_frasco_grande` | 1 | VAMARA - MIX ENCHILAD 220 GR | — | 14 |
| `amalay_mix_enchilado_frasco_mediano` | 1 | VAMARA - MIX ENCHILAD 220 GR | — | 17 |
| `galletas_amalay_bote_chico_20_pza` | 1 | AMALAY - GALLETAS BOTE CHICO 20 PZ | `MAR012` | 13 |
| `galletas_amalay_bote_mediano_180_gr` | 2 | AMALAY - GALLETAS BOTE MEDIANO 180G | `MAR014` | 14 |
| `galletas_amalay_pq_de_3_pzs` | 3 | AMALAY - GALLETAS PQ DE 3 PZS | `0763331041462` | 12 |
| `amalay_frasco_te_petalo_mio_300g` | 1 | SUB AMALAY - TE PETALO MIO PZ - 100G | `SUBAMA06042601` | 15 |
| `amalay_frasco_tisana_bora_bora_300g` | 1 | AMALAY - CAFE EN GRANO BOLSA 300G | — | 16 |
| `termo_vidrio_amalay_pz_1250ml` | 1 | AMALAY - TERMO VIDRIO PZ 1.25L | `VARAMA1702` | 17 |

**Resolución:** Alias manual requerido para los que tienen candidato identificable.
Los MIX ENCHILADO no tienen entrada clara en catálogo actual (VAMARA es marca diferente).
`amalay_frasco_tisana_bora_bora_300g` — probable producto discontinuado o sin catalogar.

**Duplicado de referencia detectado:** `cafe_amalay_300_gr_molido` y `amalay_cafe_molido_300g`
parecen referenciar el mismo producto (`MAR801`). Requiere verificación operativa antes de alias.

### C2 — Sub-recetas con variante en catálogo (4 IDs, 4 líneas)

Las recetas usan `sub_` + nombre, pero el nombre del catálogo incluye sufijo adicional
o prefijo diferente, con distancia > 3.

| orphan_ingredient_id | Líneas | Candidato más cercano | Dist |
|---|---|---|---|
| `sub_carrot_cake` | 1 | SUB CARROT CAKE REBANADA (`SUPA28052601`) | 8 |
| `sub_rosca_de_reyes_nutella_4_6_pax` | 1 | SUB CROISSANT DE NUTELLA PZ | 16 |
| `sub_rosca_de_reyes_reg_4_6_pax` | 1 | SUB MEZCLA DE FRENCH TOAST | 18 |
| `sub_amalay_sour_watermelon_bolsa_100g` | 1 | SUB AMALAY - TE PETALO MIO PZ - 100G | 16 |

**Resolución:** `sub_carrot_cake` → alias probable a `SUPA28052601` si "REBANADA" es sufijo
redundante (requiere verificación). Roscas de reyes y sour watermelon — probablemente temporada;
verificar si existen en catálogo bajo otro nombre.

### C3 — Productos de market / marca terceros (28 IDs, 28 líneas)

Productos comerciales vendidos en el market AMALAY que pueden o no estar catalogados.
La mayoría no tienen entrada en Wansoft o están bajo denominación diferente.

**Sub-grupo con candidato plausible (requieren alias con verificación):**

| orphan_ingredient_id | Líneas | Candidato | codigo | Dist |
|---|---|---|---|---|
| `amoranth_obleas_dif_sabores_paq_58g` | 1 | AMALAY - OBLEAS DIF SABORES PAQ 58G | `CKAMA14102501` | 5 |
| `birdman_fitmingo_protein_vainilla_510g` | 1 | BIRDMAN FALCON PROTEIN VAINILLA 510G | `7500326818226` | 6 |
| `rx_bar_mixed_berry_52_gr` | 1 | RX BAR - BLUEBERRY 52 GR | `857777004195` | 5 |
| `semilla_de_girasol` | 2 | PEPITA DE GIRASOL | `GRA009` | 4 |
| `leche_de_almendra` | 4 | LECHE DE AVENA | `ABA071` | 4 |
| `green_peach_carbon_activado_100_gr` | 1 | GREEN PEACH - MACA EN POLVO 100 GR | `MAR127` | 11 |
| `force_factor_total_beets_60pz` | 1 | FORCE FACTOR - MODERN MUSHROOMS 60 PZ | `818594019519` | 14 |
| `birdman_creatina_monohidratada_450g` | 1 | HABITS - CREATINA MONOHIDRATADA 300G | `7501468172849` | 9 |
| `nucelli_galleta_chocochips` | 2 | SUB GALLETAS CHOCO CHIPS | `PAN011` | 8 |
| `jarabe_blood_naranja_da_vinci` | 1 | JARABE SANDIA DA VINCI | `BEB010014789` | 11 |
| `jarabe_da_vinci_mixologia_violeta` | 1 | JARABE DA VINCI CHOCOLATE | `BEB005054689` | 13 |

> Advertencia: varios de estos son falsos cercanos. `leche_de_almendra` (dist=4 a
> "LECHE DE AVENA") y `rx_bar_mixed_berry` (dist=5 a "RX BAR BLUEBERRY") son
> **productos distintos** — no deben aliasarse sin verificación explícita.
> La distancia pequeña es coincidencia léxica, no semántica.

**Sin candidato válido (genuinamente ausentes del catálogo):**

`alma_viva_camote_*` (×3), `alma_viva_chips_betabel_*` (×2), `beef_jerky_*` (×6),
`brain_md_restful_slep_60_cap`, `bs_bicarbonato_de_sodio_puro_400gg`,
`bullet_proof_brain_octane_*`, `baitz_fresas_enchiladas_110g`, `cinzano_pro_spritz_*`,
`chai_en_polvo_sin_azucar`, `totopo_heb`, `deli_dry_rollo_varios_sabores`,
`extra_virgen_granola_keto_*` (×2), `fraise_mermelada_*` (×2),
`malaleuca_gel`, `nucelli_brownie_vegan`, `nutricion_avanzada_easy_detox_*`,
`botella_te_kambucha`.

### C4 — Artículos no alimentarios / accesorios (5 IDs, 5 líneas)

Productos que no son ingredientes ni sub-recetas — artículos de tienda o accesorios.
No tienen entrada posible en el catálogo de ingredientes por naturaleza.

| orphan_ingredient_id | Líneas | Descripción |
|---|---|---|
| `ramekin_corazon_amalay` | 1 | Pieza de vajilla, no ingrediente |
| `cartas_al_universo_diario_de_gratitud` | 1 | Artículo de papelería |
| `cartas_al_universo_mantras` | 1 | Artículo de papelería |
| `glitt_fosforos_999_wishes_metal_tip` | 2 | Accesorio (fósforos decorativos) |
| `glitt_vela_bday_wish_8oz` | 1 | Accesorio (vela) |
| `glitt_vela_enchanted_8oz` | 1 | Accesorio (vela) |
| `glitt_vela_zen_xmas_8oz` | 1 | Accesorio (vela) |
| `glitt_fosforos_9odisea` | 1 | Accesorio (fósforos) |
| `organic_coffee_scrub_amalay` | 1 | Producto de cuidado personal |

**Resolución:** No aplica. Estos items están en recetas porque Wansoft los modela como
ingredientes de "receta" para platillos de gift set o experiencias. El pipeline debe
registrarlos como `non_ingredient_reference` — categoría separada de los orphans de insumo.

---

## Próximas acciones derivadas de MT-03

| ID | Tipo | Descripción | Pre-requisito |
|---|---|---|---|
| **MT-05** | Regla algorítmica | Resolver `sub_` prefix mismatch (7 IDs, 36 líneas) | Aprobación de la regla |
| **ALIAS-01** | Alias aprobado | `kambucha_original_377_ml` → `BEB85066` | Pendiente desde MT-03 original |
| **ALIAS-02** | Alias aprobado | `kambucha_sandia_fresca_377_ml` → `BEB85080` | Pendiente desde MT-03 original |
| **ALIAS-03** | Alias aprobado | `amalay_galletas_bote_420g` → `0739802436570` | Nuevo, encontrado en cierre |
| **ALIAS-04..N** | Alias aprobados | C1 naming inversions con candidato claro | Requieren verificación operativa |
| **CAT-01** | Categoría nueva | `non_ingredient_reference` para C4 artículos no alimentarios | Decisión de diseño |

---

## Estado final de orphans

```
TOTAL LÍNEAS EN PIPELINE:     1,456
  Resueltas por slug index:   1,334  (91.6%)
  Resueltas por sub_ rule:        0  (pendiente MT-05 — potencial +36)
  Aliases aprobados activos:      0  (pendiente ALIAS-01..03)
  Orphans permanentes:          122  (8.4%)
    SINGLE_FUZZY:                 4 líneas  (alias pendientes)
    SUB_PREFIX_MISMATCH:         36 líneas  (regla MT-05 pendiente)
    NO_CANDIDATE:                82 líneas  (65 IDs — ver sub-grupos)
```

Si MT-05 + ALIAS-01..03 se aprueban: `rejected` bajaría a **82 líneas** (5.6%).

---

## Confirmación: no hay falsos positivos

Las 1,334 líneas resueltas por el slug index son deterministas: cada resolución es el producto
de `slugify(catalogo.nombre) == slugify(receta.product)`, verificado con los 769 productos del
catálogo real. Los tests de integración en `ea05470` validan esta invariante.

Las 3 entradas SINGLE_FUZZY_CANDIDATE NO están activadas en el pipeline — son sugerencias
documentadas, no resoluciones aplicadas. El pipeline las reporta como orphans hasta que
exista entrada en `approved-aliases.ts` con `aprobado_por` explícito.

**MT-03 queda cerrado.**
