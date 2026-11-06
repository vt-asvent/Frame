-- ============================================================
-- 0014 · Catálogo remoto de extensiones (Frame 1.7.6)
--
-- Extensiones de terceros que el responsable de Frame activa para todos sin
-- publicar una versión nueva: aparecen en Ajustes → Extensiones al BUSCARLAS
-- por su nombre (sin texto en el buscador solo se ven las oficiales) y se
-- instalan con la misma aceptación de permisos que un archivo .json.
--
-- El manifiesto es el mismo formato que el de un archivo (lib/extensions/
-- manifest.ts) y Frame lo valida igual: una del catálogo no tiene más
-- permisos que una instalada a mano. Ninguna extensión se nombra aquí: las
-- filas las añade el responsable desde el panel de Supabase.
--
-- Leen solo las cuentas con sesión, y solo las filas activas, por una función.
-- ============================================================

create table if not exists public.extension_catalog (
  id          text        primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$'),
  manifest    jsonb       not null,
  -- Vista previa opcional para su tarjeta (https, imagen o vídeo corto).
  preview_url text        check (preview_url is null or preview_url ~ '^https://'),
  active      boolean     not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.extension_catalog enable row level security;

create or replace function public.extension_catalog_list()
returns table (id text, manifest jsonb, preview_url text)
language sql
stable
security definer
set search_path to ''
as $$
  select c.id, c.manifest, c.preview_url
  from public.extension_catalog c
  where c.active
  order by c.id
  limit 200;
$$;

revoke all on function public.extension_catalog_list() from public, anon;
grant execute on function public.extension_catalog_list() to authenticated;
