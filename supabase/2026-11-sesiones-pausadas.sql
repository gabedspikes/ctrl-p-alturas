-- ════════════════════════════════════════════════════════════════
-- Sesiones pausadas (status = 'paused')
-- Ejecutar en Supabase → SQL Editor del proyecto Control.
--
-- Permite que el profesor pause una sesión antes de la última slide y la
-- retome otro día. El pipeline de archivado a Plickers solo copia sesiones
-- con status = 'finished', así que una sesión pausada NO se archiva hasta
-- que se retome y se finalice. El pipeline no necesita cambios.
--
-- El script se adapta a cómo esté definida la columna status:
--   · enum de Postgres          → agrega el valor 'paused'
--   · text con restricción CHECK → reemplaza la restricción
--   · text sin restricción       → no hace nada (ya acepta 'paused')
-- Se puede ejecutar más de una vez sin problema.
-- ════════════════════════════════════════════════════════════════

-- 1. (Opcional) Ver cómo está definida hoy la columna y sus restricciones
select data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'sessions' and column_name = 'status';

select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.sessions'::regclass and contype = 'c';

-- 2. Permitir 'paused'
do $$
declare
  col_type text;
  con record;
begin
  select udt_name into col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'sessions' and column_name = 'status';

  -- Caso enum
  if exists (select 1 from pg_type t where t.typname = col_type and t.typtype = 'e') then
    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = col_type and e.enumlabel = 'paused'
    ) then
      execute format('alter type %I add value %L', col_type, 'paused');
    end if;
    return;
  end if;

  -- Caso text con CHECK: se reemplaza solo la restricción que lista los valores
  -- permitidos (status IN (...)), que Postgres muestra como "status = ANY (ARRAY[...])".
  -- Otras restricciones que mencionen status se dejan intactas.
  for con in
    select conname from pg_constraint
    where conrelid = 'public.sessions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'status\)?\s*=\s*any\s*\(\s*\(?\s*array\['
  loop
    execute format('alter table public.sessions drop constraint %I', con.conname);
  end loop;

  alter table public.sessions drop constraint if exists sessions_status_check;
  alter table public.sessions
    add constraint sessions_status_check
    check (status in ('active', 'paused', 'finished'));
end $$;

-- 3. Comprobación: debería mostrar la restricción nueva (o nada si es enum)
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.sessions'::regclass and contype = 'c';
