-- UPSERT wansoft_daily: datos de screenshots Wansoft Jun 24 - Jul 10, 2026
-- Fuente: capturas de pantalla de la app móvil Wansoft
-- Ejecutar en Supabase SQL Editor
--
-- Nota: ventas_dia = ventas consolidadas del día (lo que muestra Wansoft)
-- ticket_promedio_restaurant = ventas_dia / tickets_count (por ticket)
-- Solo actualiza estas 4 columnas. No toca meseros, platillos, pagos, etc.

-- Paso 1: Agregar UNIQUE constraint en fecha si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wansoft_daily'::regclass
    AND contype = 'u'
    AND conname = 'wansoft_daily_fecha_key'
  ) THEN
    ALTER TABLE wansoft_daily ADD CONSTRAINT wansoft_daily_fecha_key UNIQUE (fecha);
  END IF;
END $$;

-- Paso 2: Upsert — actualiza si ya existe, inserta si no
INSERT INTO wansoft_daily (fecha, ventas_dia, tickets_count, personas_restaurant, ticket_promedio_restaurant, updated_at)
VALUES
  ('2026-06-24', 66090, 81, 151, 816, now()),
  ('2026-06-25', 66179, 89, 151, 744, now()),
  ('2026-06-26', 90035, 91, 197, 989, now()),
  ('2026-06-27', 134189, 133, 286, 1009, now()),
  ('2026-06-28', 139262, 161, 304, 865, now()),
  ('2026-06-29', 95185, 101, 198, 942, now()),
  ('2026-06-30', 86135, 99, 197, 870, now()),
  ('2026-07-01', 65561, 86, 148, 762, now()),
  ('2026-07-02', 97633, 112, 217, 872, now()),
  ('2026-07-03', 90611, 104, 235, 871, now()),
  ('2026-07-04', 48149, 50, 107, 963, now()),
  ('2026-07-05', 124740, 141, 273, 885, now()),
  ('2026-07-06', 55916, 74, 123, 756, now()),
  ('2026-07-07', 49754, 69, 108, 721, now()),
  ('2026-07-08', 51462, 70, 120, 735, now()),
  ('2026-07-09', 60833, 75, 143, 811, now()),
  ('2026-07-10', 41332, 47, 92, 879, now())
ON CONFLICT (fecha)
DO UPDATE SET
  ventas_dia = EXCLUDED.ventas_dia,
  tickets_count = EXCLUDED.tickets_count,
  personas_restaurant = EXCLUDED.personas_restaurant,
  ticket_promedio_restaurant = EXCLUDED.ticket_promedio_restaurant,
  updated_at = now();
