-- Un solo turno abierto por restaurante. Lo impide la base, no el código.
--
-- EL DEFECTO
--
-- Eduardo lo reportó el 2026-08-27: "al parecer había dos turnos activos aún, no puedo
-- hacer corte Z, y por lo que veía se ponían en conflicto". Una auditoría de 19 agentes lo
-- rastreó el 2026-09-08 y la causa es que NADIE serializa la apertura entre terminales:
--
--   · `idParaAbrirTurno()` (pos-data.ts:603) deduplica con localStorage, que es POR
--     TERMINAL. POS-1 y POS-2 generan ids distintos y crean DOS filas.
--   · el único guard entre terminales es `getActiveTurno()`, y el propio archivo de prueba
--     documenta que falla cuando importa: "en una terminal lenta el fetch se pasa del
--     límite y el cache puede estar vacío: el guard no ve nada y se crea otro".
--   · `getActiveTurno()` devuelve `turnos[0]` — se queda con el más reciente y ESCONDE el
--     resto. De ahí las tres frases de Eduardo: el Corte Z cierra sólo uno, el otro queda
--     abierto para siempre, y las comandas quedan repartidas entre dos turno_id.
--   · el guard bueno SÍ existe en el candidato (`operational-domain.js:107`,
--     TURN_ALREADY_OPEN) pero sólo corre con `write_authority === 'caja'`, e instalar el
--     binario NO lo activa.
--
-- EVIDENCIA DE CAMPO, leída de esta misma base:
--
--   · 33 turnos cerrados de un solo golpe con closed_at = 2026-09-01 02:07:00.918+00,
--     con aperturas desde el 8 de julio, varias con closed_at ANTERIOR a opened_at
--   · entre las 02:11 y las 02:32 de ese día se abrieron OCHO turnos, con ids de los dos
--     formatos a la vez — o sea que había dos escritores vivos
--   · el 2026-08-31 AMALAY acumuló 11 turnos abiertos en 25 minutos, CUATRO DÍAS DESPUÉS
--     de que entrara la detección de turnos múltiples. Detectar no es prevenir.
--
-- POR QUÉ ESTO Y NO MÁS CÓDIGO
--
-- Cada guard de código depende de algo: de que localStorage sea el mismo, de que el fetch
-- conteste a tiempo, de que una bandera esté encendida. Un índice único no depende de
-- nada. Es la única capa que no se puede olvidar de correr.
--
-- ESTADO ACTUAL, verificado antes de escribir esto (2026-09-08):
--
--   turnos abiertos          9
--   restaurantes con abierto 9
--   con MÁS de uno abierto   ninguno
--
-- O sea que el índice se puede crear hoy sin conflicto. Si algún día falla al crearse, es
-- porque ya hay duplicados: hay que cerrarlos a mano ANTES, decidiendo cuál conserva las
-- órdenes. No cerrarlos con un UPDATE masivo — eso fue lo que produjo los closed_at
-- anteriores al opened_at que se ven arriba.
--
-- CUANDO EXISTAN SUCURSALES
--
-- `pos_turnos` hoy no tiene `location_id` (comprobado). AMALAY es una sola sucursal, así
-- que "uno por restaurante" es exactamente lo correcto. El día que se agregue la columna,
-- este índice pasa a (client_id, location_id) — y hasta entonces NO se debe agregar
-- location_id sin cambiarlo, porque dos sucursales legítimas chocarían.
--
-- LO QUE HAY QUE HACER EN EL CÓDIGO ANTES DE APLICARLA
--
-- `openTurno` tiene un catch que, ante un POST fallido, abre un turno LOCAL y lo encola
-- (pos-data.ts:695). Con este índice, un segundo terminal recibiría 409 y caería ahí:
-- cambiaríamos "dos turnos" por "un turno fantasma que nunca sincroniza", que es peor.
-- Por eso el commit que acompaña esta migración enseña a `openTurno` a distinguir un
-- conflicto de una falla de red, y a adoptar el turno que ya existe.
--
-- NO APLICADA. Requiere que quien tenga permiso la corra, y que el código de arriba ya
-- esté desplegado.

CREATE UNIQUE INDEX IF NOT EXISTS pos_turnos_uno_abierto_por_restaurante
  ON public.pos_turnos (client_id)
  WHERE closed_at IS NULL;

COMMENT ON INDEX public.pos_turnos_uno_abierto_por_restaurante IS
  'Un turno abierto por restaurante. Los guards de código dependen de localStorage, de que '
  'el fetch conteste a tiempo o de una bandera; éste no depende de nada. Cuando pos_turnos '
  'tenga location_id, pasa a (client_id, location_id).';
