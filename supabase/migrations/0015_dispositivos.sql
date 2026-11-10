-- ============================================================
-- 0015 · Dispositivos de la cuenta (Frame 1.9.2)
--
-- Ajustes → Dispositivos: cada equipo con sesión deja aquí su fila: tipo
-- (laptop, celular, tablet), sistema, versión de Frame, si sigue vinculado
-- y un resumen de lo que le falta sincronizar. Sin nombre del equipo, red ni
-- ubicación: solo lo que la tarjeta enseña. «Corregir» en un equipo pide a
-- los demás que repasen su sincronización (resync_at).
--
-- Cada cuenta ve y cambia solo sus filas; como mucho 20 (sale la que hace
-- más que no se ve). Al borrar la cuenta se borran con ella.
-- ============================================================

create table if not exists public.devices (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  device_id    text        not null check (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  kind         text        not null check (kind in ('laptop', 'phone', 'tablet')),
  platform     text        not null check (platform in ('windows', 'android', 'ios', 'macos', 'linux', 'web')),
  app_version  text        not null check (char_length(app_version) <= 20),
  linked       boolean     not null default true,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  unlinked_at  timestamptz,
  sync         jsonb       not null default '{}'::jsonb check (pg_column_size(sync) <= 2048),
  resync_at    timestamptz,
  primary key (user_id, device_id)
);
alter table public.devices enable row level security;

drop policy if exists devices_select_own on public.devices;
drop policy if exists devices_update_own on public.devices;
drop policy if exists devices_delete_own on public.devices;
create policy devices_select_own on public.devices for select to authenticated using (user_id = (select auth.uid()));
create policy devices_update_own on public.devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete_own on public.devices for delete to authenticated using (user_id = (select auth.uid()));

-- El latido de un equipo: deja su fila al día (vinculado, visto ahora) y
-- devuelve las de toda la cuenta, en una sola llamada.
create or replace function public.device_heartbeat(
  p_device_id   text,
  p_kind        text,
  p_platform    text,
  p_app_version text,
  p_sync        jsonb
)
returns setof public.devices
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sin sesión' using errcode = '28000';
  end if;
  insert into public.devices as d (user_id, device_id, kind, platform, app_version, linked, last_seen, unlinked_at, sync)
  values (me, p_device_id, p_kind, p_platform, left(p_app_version, 20), true, now(), null, coalesce(p_sync, '{}'::jsonb))
  on conflict (user_id, device_id) do update
    set kind = excluded.kind,
        platform = excluded.platform,
        app_version = excluded.app_version,
        linked = true,
        last_seen = now(),
        unlinked_at = null,
        sync = excluded.sync;
  -- Como mucho 20 por cuenta.
  delete from public.devices x
  where x.user_id = me
    and x.device_id in (select y.device_id from public.devices y where y.user_id = me order by y.last_seen desc offset 20);
  return query select * from public.devices d where d.user_id = me order by d.last_seen desc;
end
$$;

revoke all on function public.device_heartbeat(text, text, text, text, jsonb) from public, anon;
grant execute on function public.device_heartbeat(text, text, text, text, jsonb) to authenticated;
