-- ══════════════════════════════════════════════════════════════════════
-- BLINDAJE B3 — Lockdown de credenciales Wansoft en clients (P0-6)
-- ══════════════════════════════════════════════════════════════════════
--
-- Problema (en vivo, AMALAY): clients.wansoft_pass / wansoft_cookies / wansoft_user
-- están en TEXTO PLANO y la política RLS de clients da SELECT de TODAS las columnas
-- al rol authenticated → un empleado del tenant hace
--   GET /rest/v1/clients?select=wansoft_pass,wansoft_cookies
-- y saca la credencial de Wansoft + cookies de sesión en claro.
--
-- Verificado: NADIE en el dashboard (authenticated) lee esas columnas. Solo los
-- scripts Python (GitHub Actions) las leen, y usan la SERVICE key (service_role),
-- que NO se ve afectada por grants de columna. Por eso revocar esas 3 columnas del
-- rol authenticated cierra la fuga sin romper el scraper.
--
-- Técnica: se revoca el SELECT de tabla completa y se re-otorga SELECT de TODAS las
-- columnas MENOS las 3 sensibles (dinámico → robusto ante columnas nuevas; re-correr
-- tras un ALTER TABLE que agregue columnas). La RLS por tenant sigue aplicando.
--
-- ⚠️ Rotar la contraseña de Wansoft + invalidar las cookies guardadas DESPUÉS de
--    aplicar (ya estuvieron expuestas).
-- Idempotente. Aplicar en staging y validar antes de prod.
-- ══════════════════════════════════════════════════════════════════════

DO $b3$
DECLARE
  cols_auth text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols_auth
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'clients'
    AND column_name NOT IN ('wansoft_user', 'wansoft_pass', 'wansoft_cookies');

  -- authenticated: quitar SELECT de tabla completa, re-otorgar solo columnas no-sensibles.
  EXECUTE 'REVOKE SELECT ON public.clients FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.clients TO authenticated', cols_auth);

  -- anon: nunca debe leer credenciales (si tuviera algún grant, quitarlo por completo).
  EXECUTE 'REVOKE SELECT ON public.clients FROM anon';
END
$b3$;

-- POSTFLIGHT (validar):
--   BEGIN; SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<user del tenant>","role":"authenticated"}';
--   SELECT display_name FROM clients LIMIT 1;      -- debe funcionar
--   SELECT wansoft_pass FROM clients LIMIT 1;      -- debe dar: permission denied for column wansoft_pass
--   ROLLBACK;
