-- Zona horaria POR SUCURSAL.
-- Antes: el "día de negocio", cortes y reportes se calculaban con México centro
-- hardcodeado (lib/date-mx.ts). Un cliente en otra zona (p.ej. Tijuana/Pacífico)
-- reportaba con la hora corrida. La zona debe vivir por sucursal para soportar
-- cadenas multi-sucursal que crucen husos.
--
-- NULL = hereda la zona del tenant (clients.timezone) o el default de la app.
-- Se auto-detecta y guarda al instalar la terminal (lib/terminal-config.ts).

ALTER TABLE public.client_locations
  ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.client_locations.timezone IS
  'IANA tz de la sucursal (p.ej. America/Tijuana). NULL = hereda clients.timezone. Auto-detectada al instalar.';
