-- Preámbulo del baseline — los roles que el volcado necesita pero no trae.
--
-- `pg_dump` NO vuelca roles: son objetos del clúster, no de la base. El baseline
-- generado hace 342 `GRANT` a `fullsite_readonly` y `fullsite_agent`, así que
-- aplicado a un proyecto nuevo truena en el primero:
--
--     ERROR: role "fullsite_readonly" does not exist
--
-- Eso hacía que el baseline no sirviera para lo único que existe: construir una base
-- de Fullsite desde el repositorio. Los roles sí estaban definidos —en
-- `.github/migrations/001_create_readonly_role.sql`— pero fuera de
-- `supabase/migrations/`, así que nunca corrían antes.
--
-- Este archivo se antepone al volcado al generar el baseline
-- (ver `.github/workflows/esquema-baseline.yml`). No se aplica solo: vive dentro del
-- baseline, arriba de todo, para que el orden esté garantizado por construcción y no
-- por el nombre del archivo.
--
-- Sólo crea los roles. Los permisos NO van aquí: los trae el volcado, que es la
-- fuente fiel de lo que hay en producción. Duplicarlos aquí sería inventar una
-- segunda verdad que se desincroniza en silencio.
--
-- Idempotente. En una base que ya los tiene, no hace nada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullsite_readonly') THEN
    CREATE ROLE fullsite_readonly NOINHERIT LOGIN;
    RAISE NOTICE 'Creado el rol fullsite_readonly';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullsite_agent') THEN
    CREATE ROLE fullsite_agent NOINHERIT LOGIN;
    RAISE NOTICE 'Creado el rol fullsite_agent';
  END IF;
END
$$;

-- Sin contraseña a propósito. `LOGIN` sin contraseña no puede autenticarse: el rol
-- existe para recibir los `GRANT` del volcado, y quien lo necesite para conectarse le
-- pone contraseña aparte, fuera del repositorio.
