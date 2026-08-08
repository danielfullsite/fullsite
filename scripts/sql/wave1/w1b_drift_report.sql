-- ═════════════════════════════════════════════════════════════════════════════
-- W1-B · Reporte de drift — READ-ONLY, no muta nada
-- ═════════════════════════════════════════════════════════════════════════════
-- Parte 1: drift POST-cutover. Invariante: stored == opening + SUM(post-opening).
--          drift != 0 significa que alguien mutó stock fuera del camino canónico
--          (o falló un PATCH tras un INSERT). Meta de certificación: 0 filas.
--
-- Parte 2: clasificación de anomalías PRE-cutover (histórico). No se corrige —
--          se lista para clasificación humana (ej. errores de escala de unidad
--          tipo flor_comestible: receta en gr con stock en pz).
-- Reemplazar CLIENT_ID_HERE.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Parte 1: drift post-cutover (certificación: debe devolver 0 filas) ──
WITH opening AS (
  SELECT ingredient_id, id AS opening_id, quantity AS opening_qty
  FROM pos_inventory_movements
  WHERE client_id = 'CLIENT_ID_HERE' AND movement_type = 'opening_balance'
), post AS (
  SELECT o.ingredient_id,
         o.opening_qty,
         coalesce(sum(m.quantity) FILTER (WHERE m.id > o.opening_id AND m.movement_type <> 'underflow_prevented'), 0) AS post_sum
  FROM opening o
  LEFT JOIN pos_inventory_movements m
    ON m.client_id = 'CLIENT_ID_HERE' AND m.ingredient_id = o.ingredient_id
  GROUP BY o.ingredient_id, o.opening_qty, o.opening_id
)
SELECT p.ingredient_id,
       inv.stock AS stored_stock,
       round(p.opening_qty + p.post_sum, 4) AS reconstructed,
       round(inv.stock - (p.opening_qty + p.post_sum), 4) AS drift
FROM post p
JOIN pos_inventory inv
  ON inv.client_id = 'CLIENT_ID_HERE' AND inv.ingredient_id = p.ingredient_id
WHERE round(inv.stock - (p.opening_qty + p.post_sum), 4) <> 0
ORDER BY abs(inv.stock - (p.opening_qty + p.post_sum)) DESC;

-- ── Parte 2: anomalías históricas pre-cutover (clasificación, no corrección) ──
-- WITH opening AS (
--   SELECT ingredient_id, id AS opening_id FROM pos_inventory_movements
--   WHERE client_id = 'CLIENT_ID_HERE' AND movement_type = 'opening_balance'
-- )
-- SELECT m.ingredient_id,
--        count(*) AS pre_cutover_moves,
--        round(sum(m.quantity), 2) AS pre_cutover_delta_sum,
--        inv.stock AS stored_stock_now,
--        CASE
--          WHEN abs(sum(m.quantity)) > 10 * greatest(abs(inv.stock), 1)
--            THEN 'SOSPECHA_ESCALA_UNIDAD (revisar receta: unidad gr/kg/pz)'
--          WHEN inv.stock < 0 THEN 'STOCK_NEGATIVO (requiere conteo físico)'
--          ELSE 'REVISAR'
--        END AS clasificacion_sugerida
-- FROM pos_inventory_movements m
-- JOIN opening o ON o.ingredient_id = m.ingredient_id
-- JOIN pos_inventory inv ON inv.client_id = m.client_id AND inv.ingredient_id = m.ingredient_id
-- WHERE m.client_id = 'CLIENT_ID_HERE' AND m.id < o.opening_id
-- GROUP BY m.ingredient_id, inv.stock
-- HAVING abs(round(sum(m.quantity),2)) > 0
-- ORDER BY abs(sum(m.quantity)) DESC
-- LIMIT 50;
