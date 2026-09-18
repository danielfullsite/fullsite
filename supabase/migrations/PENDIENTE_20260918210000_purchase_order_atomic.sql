-- Crear una orden de compra es UN hecho de negocio, no dos escrituras.
--
-- Hasta hoy la UI hacía `POST pos_purchase_orders` y luego
-- `POST pos_purchase_order_items`. Si la segunda fallaba —y falla: el 2026-09-18
-- un ingrediente inexistente produjo SCOPE_CONFLICT— la cabecera quedaba en la
-- base con su total y CERO renglones, mientras la pantalla decía «Error al crear
-- la orden». Una orden a medias que nadie pidió.
--
-- Compensar con un DELETE no arregla eso: si el DELETE también falla, o el
-- navegador muere entre ambos, el huérfano queda igual. La única salida es que
-- las dos inserciones vivan en la misma transacción.
--
-- TODAS las líneas se validan ANTES de escribir nada. Validar mientras se
-- inserta deja trabajo hecho que hay que deshacer; validar antes no deja nada.
CREATE OR REPLACE FUNCTION public.pos_create_purchase_order(
  p_client_id text, p_header jsonb, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id text; v_linea jsonb; v_ing text; v_total numeric := 0; v_filas jsonb := '[]'::jsonb; v_fila jsonb;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RAISE EXCEPTION 'SCOPE_REQUIRED'; END IF;
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN RAISE EXCEPTION 'INVALID_HEADER'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 1
     OR jsonb_array_length(p_lines) > 200 THEN RAISE EXCEPTION 'INVALID_LINES'; END IF;

  v_id := coalesce(nullif(p_header->>'id',''), gen_random_uuid()::text);
  IF coalesce(p_header->>'supplier','') = '' THEN RAISE EXCEPTION 'SUPPLIER_REQUIRED'; END IF;
  IF coalesce(p_header->>'created_by','') = '' THEN RAISE EXCEPTION 'CREATED_BY_REQUIRED'; END IF;
  -- El tenant NO se lee del cuerpo: lo pone quien llama, ya autenticado.
  IF p_header ? 'client_id' THEN RAISE EXCEPTION 'CLIENT_ID_NOT_ACCEPTED'; END IF;
  IF EXISTS (SELECT 1 FROM public.pos_purchase_orders WHERE id = v_id) THEN RAISE EXCEPTION 'ORDER_ID_TAKEN'; END IF;

  -- ── VALIDAR TODO ANTES DE ESCRIBIR NADA ───────────────────────────────────
  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_linea) <> 'object' THEN RAISE EXCEPTION 'INVALID_LINE'; END IF;
    v_ing := v_linea->>'ingredient_id';
    IF coalesce(v_ing,'') = '' THEN RAISE EXCEPTION 'INGREDIENT_REQUIRED'; END IF;
    -- El ingrediente tiene que ser de ESTE restaurante. Aquí es donde moría el
    -- flujo viejo, y con razón: la UI inventaba el id a partir del texto.
    IF NOT EXISTS (SELECT 1 FROM public.pos_ingredients WHERE id = v_ing AND client_id = p_client_id) THEN
      RAISE EXCEPTION 'INGREDIENT_SCOPE_CONFLICT';
    END IF;
    IF coalesce((v_linea->>'quantity_ordered')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    IF coalesce((v_linea->>'unit_cost')::numeric, -1) < 0 THEN RAISE EXCEPTION 'INVALID_UNIT_COST'; END IF;
    IF coalesce(v_linea->>'unit','') = '' THEN RAISE EXCEPTION 'UNIT_REQUIRED'; END IF;
    v_total := v_total + ((v_linea->>'quantity_ordered')::numeric * (v_linea->>'unit_cost')::numeric);
  END LOOP;

  -- ── ESCRIBIR ──────────────────────────────────────────────────────────────
  INSERT INTO public.pos_purchase_orders (id, client_id, supplier, status, created_by, notes,
                                          subtotal, iva, total, ai_suggested)
  VALUES (v_id, p_client_id, p_header->>'supplier', coalesce(nullif(p_header->>'status',''), 'borrador'),
          p_header->>'created_by', nullif(p_header->>'notes',''),
          v_total, round(v_total * 0.16, 2), round(v_total * 1.16, 2),
          coalesce((p_header->>'ai_suggested')::boolean, false));

  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.pos_purchase_order_items (order_id, ingredient_id, ingredient_name,
                                                 quantity_ordered, unit, unit_cost, total_cost)
    VALUES (v_id, v_linea->>'ingredient_id',
            coalesce(nullif(v_linea->>'ingredient_name',''),
                     (SELECT name FROM public.pos_ingredients WHERE id = v_linea->>'ingredient_id' AND client_id = p_client_id)),
            (v_linea->>'quantity_ordered')::numeric, v_linea->>'unit',
            (v_linea->>'unit_cost')::numeric,
            (v_linea->>'quantity_ordered')::numeric * (v_linea->>'unit_cost')::numeric)
    RETURNING to_jsonb(pos_purchase_order_items) INTO v_fila;
    v_filas := v_filas || jsonb_build_array(v_fila);
  END LOOP;

  RETURN jsonb_build_object('order_id', v_id, 'lines', v_filas,
                            'subtotal', v_total, 'total', round(v_total * 1.16, 2));
END $$;

-- Alta de ingrediente. La identidad la asigna el SERVIDOR, nunca el texto que
-- alguien teclee: `slug del nombre` ya produjo referencias a ingredientes que no
-- existían. El nombre se conserva como nombre, que es lo que es.
CREATE OR REPLACE FUNCTION public.pos_create_ingredient(
  p_client_id text, p_name text, p_unit text, p_cost numeric DEFAULT 0,
  p_category text DEFAULT NULL, p_supplier text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id text; v_fila jsonb;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RAISE EXCEPTION 'SCOPE_REQUIRED'; END IF;
  IF coalesce(btrim(p_name),'') = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF coalesce(btrim(p_unit),'') = '' THEN RAISE EXCEPTION 'UNIT_REQUIRED'; END IF;
  IF coalesce(p_cost, -1) < 0 THEN RAISE EXCEPTION 'INVALID_COST'; END IF;
  -- Dos ingredientes con el mismo nombre en un restaurante son un error de
  -- captura, y el de abajo terminaría comprando contra el equivocado.
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

REVOKE ALL ON FUNCTION public.pos_create_purchase_order(text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_create_purchase_order(text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pos_create_ingredient(text,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_create_ingredient(text,text,text,numeric,text,text) TO service_role;
