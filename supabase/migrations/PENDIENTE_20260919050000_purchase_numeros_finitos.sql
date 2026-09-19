-- P0_PURCHASE_NUMERIC_NAN
--
-- Medido en runtime el 2026-09-18 contra el Preview, con lectura de vuelta a la
-- base: una OC creada con `quantity_ordered: "NaN"` devolvió HTTP 200 y quedó
-- guardada con `subtotal = NaN` y `total = NaN`.
--
-- La causa es que en PostgreSQL el tipo `numeric` ordena NaN por ENCIMA de todo
-- número, no fuera del orden. Medido en el proyecto compartido (pg 17.6):
--
--      NaN <= 0        false        <- la guarda de cantidad no lo ve
--      NaN <  0        false        <- la de costo tampoco
--      Infinity <= 0   false
--      Infinity <  0   false
--      -Infinity <= 0  true         <- el único que sí caía
--      NaN =  NaN      true         <- por eso la detección es por igualdad
--
-- Así que `coalesce(x, 0) <= 0` deja pasar NaN y +Infinity, y el total de la
-- orden se vuelve NaN. Un solo renglón así envenena cualquier SUM sobre
-- compras, y el veneno no se nota: la fila se ve normal hasta que alguien suma.
--
-- `x <> x` NO sirve para detectarlo —a diferencia de float, numeric considera
-- que NaN es igual a sí mismo—, y por eso la comprobación es explícita contra
-- los tres valores no finitos.

-- ── un número tiene que ser un número ────────────────────────────────────────
--
-- Devuelve NULL para todo lo que no sea un número finito: NaN, ±Infinity, texto
-- basura, cadena vacía, o algo fuera del rango de numeric. Quien llama decide
-- qué error levantar, que es lo que distingue una cantidad de un costo.
--
-- Se captura `invalid_text_representation` y `numeric_value_out_of_range`, no
-- `others`: tragarse cualquier excepción escondería fallos que sí importan.
CREATE OR REPLACE FUNCTION public.pos_numero_finito(p_texto text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE v numeric;
BEGIN
  IF btrim(p_texto) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := p_texto::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
  END;
  IF v = 'NaN'::numeric OR v = 'Infinity'::numeric OR v = '-Infinity'::numeric THEN
    RETURN NULL;
  END IF;
  RETURN v;
END $$;

COMMENT ON FUNCTION public.pos_numero_finito(text) IS
  'Convierte texto a numeric SOLO si es un número finito. NaN, ±Infinity y basura devuelven NULL.';

-- ── creación de OC ───────────────────────────────────────────────────────────
--
-- Cambia únicamente la validación de `quantity_ordered` y `unit_cost`, y el
-- INSERT de renglones para que use el valor ya validado en vez de volver a
-- castear el texto crudo. Todo lo demás queda idéntico a
-- PENDIENTE_20260918210000_purchase_order_atomic.sql, incluido el orden
-- validar-todo-antes-de-escribir, que es lo que garantiza que un rechazo no
-- deje ni cabecera ni renglones.
CREATE OR REPLACE FUNCTION public.pos_create_purchase_order(
  p_client_id text, p_created_by text, p_header jsonb, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id text; v_linea jsonb; v_ing text; v_total numeric := 0; v_filas jsonb := '[]'::jsonb; v_fila jsonb;
  v_tasa numeric; v_iva numeric; v_cant numeric; v_costo numeric;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RAISE EXCEPTION 'SCOPE_REQUIRED'; END IF;
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN RAISE EXCEPTION 'INVALID_HEADER'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 1
     OR jsonb_array_length(p_lines) > 200 THEN RAISE EXCEPTION 'INVALID_LINES'; END IF;

  v_id := coalesce(nullif(p_header->>'id',''), gen_random_uuid()::text);
  IF coalesce(p_header->>'supplier','') = '' THEN RAISE EXCEPTION 'SUPPLIER_REQUIRED'; END IF;
  IF coalesce(btrim(p_created_by),'') = '' THEN RAISE EXCEPTION 'CREATED_BY_REQUIRED'; END IF;
  IF p_header ? 'created_by' THEN RAISE EXCEPTION 'CREATED_BY_NOT_ACCEPTED'; END IF;
  IF p_header ?| array['iva','total','subtotal','iva_rate','tax_rate'] THEN
    RAISE EXCEPTION 'AMOUNTS_NOT_ACCEPTED';
  END IF;
  IF p_header ? 'client_id' THEN RAISE EXCEPTION 'CLIENT_ID_NOT_ACCEPTED'; END IF;
  IF p_header ? 'status' THEN RAISE EXCEPTION 'STATUS_NOT_ACCEPTED'; END IF;
  IF EXISTS (SELECT 1 FROM public.pos_purchase_orders WHERE id = v_id) THEN RAISE EXCEPTION 'ORDER_ID_TAKEN'; END IF;

  -- ── VALIDAR TODO ANTES DE ESCRIBIR NADA ───────────────────────────────────
  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_linea) <> 'object' THEN RAISE EXCEPTION 'INVALID_LINE'; END IF;
    IF v_linea ? 'client_id' THEN RAISE EXCEPTION 'CLIENT_ID_NOT_ACCEPTED'; END IF;
    v_ing := v_linea->>'ingredient_id';
    IF coalesce(v_ing,'') = '' THEN RAISE EXCEPTION 'INGREDIENT_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pos_ingredients WHERE id = v_ing AND client_id = p_client_id) THEN
      RAISE EXCEPTION 'INGREDIENT_SCOPE_CONFLICT';
    END IF;
    -- `pos_numero_finito` devuelve NULL para NaN, ±Infinity y basura, así que
    -- la comparación de abajo ya no puede dejarlos pasar por el orden de
    -- numeric. Ausente sigue siendo inválido, igual que antes.
    v_cant := public.pos_numero_finito(v_linea->>'quantity_ordered');
    IF v_cant IS NULL OR v_cant <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    v_costo := public.pos_numero_finito(v_linea->>'unit_cost');
    IF v_costo IS NULL OR v_costo < 0 THEN RAISE EXCEPTION 'INVALID_UNIT_COST'; END IF;
    IF coalesce(v_linea->>'unit','') = '' THEN RAISE EXCEPTION 'UNIT_REQUIRED'; END IF;
    v_total := v_total + (v_cant * v_costo);
  END LOOP;

  -- ── IMPUESTO: LA OC NO LO CALCULA ─────────────────────────────────────────
  -- PURCHASE_TAX_SEMANTICS = UNKNOWN. Se conserva la semántica que compras ya
  -- tenía —iva 0, total = subtotal— y el IVA del proveedor queda en la factura,
  -- que tiene sus propias columnas y su `uuid_sat`. Sin cambio en esta
  -- migración: se repite para que la función siga siendo legible completa.
  v_tasa := 0;
  v_iva := 0;

  -- ── ESCRIBIR ──────────────────────────────────────────────────────────────
  INSERT INTO public.pos_purchase_orders (id, client_id, supplier, status, created_by, notes,
                                          subtotal, iva, total, ai_suggested)
  VALUES (v_id, p_client_id, p_header->>'supplier', 'borrador',
          btrim(p_created_by), nullif(p_header->>'notes',''),
          v_total, v_iva, v_total + v_iva,
          coalesce((p_header->>'ai_suggested')::boolean, false));

  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    -- El mismo valor validado arriba. Antes aquí se volvía a castear el texto
    -- crudo, o sea que lo que se guardaba no era necesariamente lo que se
    -- validó.
    v_cant := public.pos_numero_finito(v_linea->>'quantity_ordered');
    v_costo := public.pos_numero_finito(v_linea->>'unit_cost');
    INSERT INTO public.pos_purchase_order_items (order_id, ingredient_id, ingredient_name,
                                                 quantity_ordered, unit, unit_cost, total_cost)
    VALUES (v_id, v_linea->>'ingredient_id',
            coalesce(nullif(v_linea->>'ingredient_name',''),
                     (SELECT name FROM public.pos_ingredients WHERE id = v_linea->>'ingredient_id' AND client_id = p_client_id)),
            v_cant, v_linea->>'unit', v_costo, v_cant * v_costo)
    RETURNING to_jsonb(pos_purchase_order_items) INTO v_fila;
    v_filas := v_filas || jsonb_build_array(v_fila);
  END LOOP;

  RETURN jsonb_build_object('order_id', v_id, 'lines', v_filas, 'created_by', btrim(p_created_by),
                            'subtotal', v_total, 'iva_rate', v_tasa, 'iva', v_iva, 'total', v_total + v_iva);
END $$;

-- ── alta de ingrediente ──────────────────────────────────────────────────────
--
-- Mismo agujero, misma forma: `coalesce(p_cost, -1) < 0` deja pasar NaN y
-- +Infinity. Un ingrediente con costo NaN contamina el costeo de recetas y el
-- valor del inventario, que es peor que una OC porque se arrastra a cada
-- movimiento posterior.
--
-- Aquí `p_cost` ya llega como `numeric` (PostgREST lo castea antes de la
-- llamada), así que la comprobación es directa sobre el valor, sin texto.
CREATE OR REPLACE FUNCTION public.pos_create_ingredient(
  p_client_id text, p_name text, p_unit text, p_cost numeric DEFAULT 0,
  p_category text DEFAULT NULL, p_supplier text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id text; v_fila jsonb;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RAISE EXCEPTION 'SCOPE_REQUIRED'; END IF;
  IF coalesce(btrim(p_name),'') = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF coalesce(btrim(p_unit),'') = '' THEN RAISE EXCEPTION 'UNIT_REQUIRED'; END IF;
  IF p_cost IS NOT NULL AND (p_cost = 'NaN'::numeric OR p_cost = 'Infinity'::numeric
                             OR p_cost = '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'INVALID_COST';
  END IF;
  IF coalesce(p_cost, -1) < 0 THEN RAISE EXCEPTION 'INVALID_COST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id || '|' || lower(btrim(p_name)), 0));
  IF EXISTS (SELECT 1 FROM public.pos_ingredients
             WHERE client_id = p_client_id AND lower(btrim(name)) = lower(btrim(p_name))) THEN
    RAISE EXCEPTION 'INGREDIENT_NAME_TAKEN';
  END IF;

  v_id := gen_random_uuid()::text;
  INSERT INTO public.pos_ingredients (id, client_id, name, unit, cost_per_unit, category, supplier, active)
  VALUES (v_id, p_client_id, btrim(p_name), btrim(p_unit), coalesce(p_cost, 0),
          nullif(btrim(coalesce(p_category,'')),''), nullif(btrim(coalesce(p_supplier,'')),''), true)
  RETURNING to_jsonb(pos_ingredients) INTO v_fila;
  RETURN v_fila;
END $$;

-- El helper no toca datos y no necesita privilegio elevado, pero tampoco hay
-- razón para exponerlo a la llave anónima.
REVOKE ALL ON FUNCTION public.pos_numero_finito(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_numero_finito(text) TO service_role;
REVOKE ALL ON FUNCTION public.pos_create_purchase_order(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_create_purchase_order(text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pos_create_ingredient(text,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_create_ingredient(text,text,text,numeric,text,text) TO service_role;
