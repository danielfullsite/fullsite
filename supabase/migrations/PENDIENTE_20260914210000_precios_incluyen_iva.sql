-- Precios con IVA incluido, por restaurante.
--
-- POR QUÉ
-- -------
-- Hasta hoy la tabla `clients` sólo sabía `iva_rate`: una tasa que el POS SUMA
-- encima del precio de la carta. No había forma de expresar lo contrario — que
-- el precio de la carta YA traiga el impuesto — que en México es lo normal.
--
-- Medido el 2026-09-14 contra Wansoft, que es donde AMALAY cobra hoy: en 22 de
-- 25 platillos con nombre coincidente, lo que paga el cliente ES el precio de la
-- carta (mediana de la razón 1.000; ninguno en 1.16). Y se descartó que Wansoft
-- registre neto de impuesto: en `ocm_daily`, lo cobrado sobre `ventas_dia` da
-- entre 0.92 y 1.00 todos los días, nunca 1.16.
--
-- Con la configuración actual (`iva_rate = 0.16`, sumando encima), un platillo de
-- $92 saldría en $106.72. AMALAY todavía NO opera en Fullsite, así que ningún
-- cliente ha pagado de más: esto es una puerta que cerrar antes del cutover, no
-- una fuga activa.
--
-- POR QUÉ NO SE ARREGLA PONIENDO LA TASA EN CERO
-- ---------------------------------------------
-- Sería el atajo obvio y el equivocado — de hecho es lo que hacía el código
-- original (`pos-constants.ts`: «AMALAY: precios ya incluyen IVA (= 0)»). El
-- total queda bien y el TICKET declara cero impuesto sobre una venta que sí lo
-- causa. Con RFC y facturación de por medio, peor que el problema. Lo correcto
-- con precio inclusivo es EXTRAER el impuesto, no dejar de declararlo:
--
--     hoy (exclusivo):   $92.00 + $14.72  =  $106.72
--     inclusivo:         $79.31 + $12.69  =  $92.00
--
-- SEGURIDAD DE ESTA MIGRACIÓN
-- ---------------------------
-- `DEFAULT false` = el comportamiento de hoy. Aplicarla NO cambia un centavo en
-- ningún restaurante: sólo agrega la capacidad de declarar el otro modo. El
-- encendido de cada tenant es una decisión aparte y deliberada.
--
-- El código ya la lee con `=== true`, así que funciona igual antes y después de
-- aplicarla: una columna inexistente llega como `undefined` y eso significa el
-- modo de hoy.

alter table public.clients
  add column if not exists precios_incluyen_iva boolean not null default false;

comment on column public.clients.precios_incluyen_iva is
  'true = el precio de la carta YA incluye el impuesto y hay que EXTRAERLO (total = precio). '
  'false = el precio es neto y el impuesto se SUMA (total = precio * (1 + iva_rate)). '
  'Nunca resolver esto poniendo iva_rate en 0: el ticket quedaria sin declarar impuesto.';

-- ── Para encender AMALAY, cuando se confirme contra un ticket o la carta ──────
-- No se hace aquí a propósito: es una decisión de negocio, no de migración.
--
--   update public.clients set precios_incluyen_iva = true where id = 'amalay';
--
-- Cómo confirmarlo sin estar en el restaurante: si la carta dice «precios
-- incluyen IVA», o si una factura (CFDI) emitida por AMALAY muestra que el total
-- pagado es el precio de carta, queda confirmado.
