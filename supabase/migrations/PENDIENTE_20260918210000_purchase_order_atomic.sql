-- La firma de `pos_create_purchase_order` cambió al mover `created_by` fuera del
-- cuerpo. La función NO se ha desplegado en ninguna base, así que se elimina
-- cualquier variante previa en vez de dejar dos sobrecargas conviviendo.
DROP FUNCTION IF EXISTS public.pos_create_purchase_order(text, jsonb, jsonb);

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
  p_client_id text, p_created_by text, p_header jsonb, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id text; v_linea jsonb; v_ing text; v_total numeric := 0; v_filas jsonb := '[]'::jsonb; v_fila jsonb;
  v_tasa numeric; v_iva numeric;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RAISE EXCEPTION 'SCOPE_REQUIRED'; END IF;
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN RAISE EXCEPTION 'INVALID_HEADER'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 1
     OR jsonb_array_length(p_lines) > 200 THEN RAISE EXCEPTION 'INVALID_LINES'; END IF;

  v_id := coalesce(nullif(p_header->>'id',''), gen_random_uuid()::text);
  IF coalesce(p_header->>'supplier','') = '' THEN RAISE EXCEPTION 'SUPPLIER_REQUIRED'; END IF;
  -- `created_by` es PROCEDENCIA: dice quién hizo esto, y eso lo sabe la sesión
  -- autenticada, no el cuerpo. Aceptarlo del cliente permitiría firmar una orden
  -- a nombre de otra persona. Si algún día hace falta registrar a un tercero
  -- —«lo pidió el chef»— eso es otro campo, no éste.
  IF coalesce(btrim(p_created_by),'') = '' THEN RAISE EXCEPTION 'CREATED_BY_REQUIRED'; END IF;
  IF p_header ? 'created_by' THEN RAISE EXCEPTION 'CREATED_BY_NOT_ACCEPTED'; END IF;
  -- Los importes tampoco: el servidor los calcula desde las líneas y la tasa
  -- configurada. Aceptarlos dejaría que el cliente declare su propio total.
  IF p_header ?| array['iva','total','subtotal','iva_rate','tax_rate'] THEN
    RAISE EXCEPTION 'AMOUNTS_NOT_ACCEPTED';
  END IF;
  -- El tenant NO se lee del cuerpo: lo pone quien llama, ya autenticado.
  IF p_header ? 'client_id' THEN RAISE EXCEPTION 'CLIENT_ID_NOT_ACCEPTED'; END IF;
  -- Una OC nueva NACE en borrador. Ignorar el campo no basta: aceptarlo en
  -- silencio deja la puerta abierta a que un cambio futuro lo vuelva a leer, y
  -- quien lo mandó se queda creyendo que eligió el estado. Se rechaza de frente.
  IF p_header ? 'status' THEN RAISE EXCEPTION 'STATUS_NOT_ACCEPTED'; END IF;
  IF EXISTS (SELECT 1 FROM public.pos_purchase_orders WHERE id = v_id) THEN RAISE EXCEPTION 'ORDER_ID_TAKEN'; END IF;

  -- ── VALIDAR TODO ANTES DE ESCRIBIR NADA ───────────────────────────────────
  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_linea) <> 'object' THEN RAISE EXCEPTION 'INVALID_LINE'; END IF;
    -- Ni en las líneas. El tenant tiene UNA fuente y no es el cuerpo.
    IF v_linea ? 'client_id' THEN RAISE EXCEPTION 'CLIENT_ID_NOT_ACCEPTED'; END IF;
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

  -- ── IMPUESTO: LA CONFIGURACIÓN DEL TENANT, NUNCA EL CUERPO ────────────────
  --
  -- La primera versión de esta función traía 16% fijo. Eso era inventar una
  -- semántica: `pos-constants.ts:5` declara `IVA_RATE = 0` («AMALAY: precios ya
  -- incluyen IVA»), y la tasa real vive por restaurante en `clients.iva_rate`
  -- —el mismo contrato que usa `save-order/route.ts:146`—.
  --
  -- Mismas reglas que allá: una fracción en [0,1]; cualquier otra cosa, o
  -- ausencia, cuenta como 0. Con 0, `total = subtotal`, que es lo que la página
  -- de compras calculaba antes de este cambio.
  SELECT iva_rate INTO v_tasa FROM public.clients WHERE id = p_client_id;
  IF v_tasa IS NULL OR v_tasa < 0 OR v_tasa > 1 THEN v_tasa := 0; END IF;
  v_iva := round(v_total * v_tasa, 2);

  -- ── ESCRIBIR ──────────────────────────────────────────────────────────────
  INSERT INTO public.pos_purchase_orders (id, client_id, supplier, status, created_by, notes,
                                          subtotal, iva, total, ai_suggested)
  VALUES (v_id, p_client_id, p_header->>'supplier', 'borrador',
          btrim(p_created_by), nullif(p_header->>'notes',''),
          v_total, v_iva, v_total + v_iva,
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

  RETURN jsonb_build_object('order_id', v_id, 'lines', v_filas, 'created_by', btrim(p_created_by),
                            'subtotal', v_total, 'iva_rate', v_tasa, 'iva', v_iva, 'total', v_total + v_iva);
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
  --
  -- `EXISTS` y luego `INSERT` tiene una ventana: dos altas simultáneas del mismo
  -- nombre pasan las dos la comprobación y crean dos filas. No hay índice único
  -- que lo impida —y no se puede crear a ciegas: el catálogo histórico tiene
  -- 1,475 filas sin auditar y podría ya contener duplicados—, así que la
  -- exclusión se toma explícitamente.
  --
  -- El lock es de TRANSACCIÓN y por (tenant, nombre normalizado): dos altas del
  -- mismo nombre en el mismo restaurante se serializan; en restaurantes
  -- distintos, o con nombres distintos, no se estorban. Se libera solo al
  -- terminar, sin necesidad de soltarlo a mano en cada camino de error.
  -- Una sola llave de 64 bits: `pg_advisory_xact_lock` no tiene forma
  -- (bigint, bigint), y partir el hash en dos int32 desperdicia entropía.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id || '|' || lower(btrim(p_name)), 0));
  -- Recomprobar DESPUÉS del lock: quien esperó tiene que ver lo que el otro
  -- acaba de escribir, no lo que había cuando llegó.
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

REVOKE ALL ON FUNCTION public.pos_create_purchase_order(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_create_purchase_order(text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pos_create_ingredient(text,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_create_ingredient(text,text,text,numeric,text,text) TO service_role;
