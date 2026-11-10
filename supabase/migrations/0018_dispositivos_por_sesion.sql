-- 0018 · Dispositivos por sesión (Frame 1.9.2 / móvil 1.3.2)
--
-- Rehace lo de 0015 antes de que ningún cliente publicado lo use (la tabla
-- está vacía). Tres cambios:
--
-- 1. «Vinculado» sale de la sesión real. Cada fila guarda el id de la sesión
--    con la que el equipo dio su último latido; si esa sesión ya no existe
--    (se cerró en el equipo, se cerraron todas, cambió la contraseña), el
--    equipo deja de estar vinculado aunque nunca haya llegado a avisar.
-- 2. La tabla se maneja solo con funciones. Antes el cliente escribía
--    resync_at y unlinked_at con su propio reloj y podía poner cualquier
--    cosa en su fila; ahora las horas son las del servidor.
-- 3. El latido devuelve también la versión de la copia en la nube y la hora
--    del servidor: «al día» se decide comparando con esa versión, no con lo
--    que otro equipo dijo haber visto, y «hace cuánto» no depende del reloj
--    de cada equipo.
--
-- private.build_usage_snapshot sigue leyendo user_id, kind, linked y
-- last_seen: no cambian de nombre ni de sentido.

alter table public.devices add column if not exists session_id uuid;

comment on table public.devices is 'Equipos (laptop, celular, tablet) con los que cada cuenta abre Frame. Solo se lee y escribe con las funciones device_*.';
comment on column public.devices.session_id is 'Sesión de Supabase Auth del último latido. Nunca sale de la base: sirve para saber si el equipo sigue vinculado.';
comment on column public.devices.unlinked_at is 'Cuándo cerró sesión el equipo. Nulo con linked = false: la sesión se cerró sin que el equipo avisara.';

drop policy if exists devices_select_own on public.devices;
drop policy if exists devices_update_own on public.devices;
drop policy if exists devices_delete_own on public.devices;
revoke all on table public.devices from anon, authenticated;

-- ------------------------------------------------------------
-- Latido: registra este equipo y devuelve los de la cuenta.
-- ------------------------------------------------------------
drop function if exists public.device_heartbeat(text, text, text, text, jsonb);

create function public.device_heartbeat(p_device_id text, p_kind text, p_platform text, p_app_version text, p_sync jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
  sid uuid;
  clean_sync jsonb := '{}'::jsonb;
begin
  if me is null then
    raise exception 'sin sesión' using errcode = '28000';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'dispositivo no válido' using errcode = '22023';
  end if;

  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    sid := null;
  end;

  -- Un resumen raro (de una versión futura, o demasiado grande) no tumba el
  -- latido: se guarda vacío y el equipo sigue apareciendo.
  if p_sync is not null and jsonb_typeof(p_sync) = 'object' and pg_column_size(p_sync) <= 2000 then
    clean_sync := p_sync;
  end if;

  insert into public.devices as d (user_id, device_id, kind, platform, app_version, linked, last_seen, unlinked_at, sync, session_id)
  values (
    me,
    p_device_id,
    case when p_kind in ('laptop', 'phone', 'tablet') then p_kind else 'laptop' end,
    case when p_platform in ('windows', 'android', 'ios', 'macos', 'linux', 'web') then p_platform else 'web' end,
    left(coalesce(p_app_version, ''), 20),
    true,
    now(),
    null,
    clean_sync,
    sid
  )
  on conflict (user_id, device_id) do update
    set kind = excluded.kind,
        platform = excluded.platform,
        app_version = excluded.app_version,
        linked = true,
        last_seen = now(),
        unlinked_at = null,
        sync = excluded.sync,
        session_id = excluded.session_id;

  -- Los demás equipos cuya sesión ya no existe quedan desvinculados. No se
  -- sabe cuándo se cerró: unlinked_at se queda como estaba (nulo). Si algún
  -- día cambia el esquema de Auth, el latido sigue funcionando sin esto.
  begin
    update public.devices d
       set linked = false
     where d.user_id = me
       and d.linked
       and d.session_id is not null
       and d.device_id <> p_device_id
       and not exists (
         select 1 from auth.sessions s
          where s.id = d.session_id and (s.not_after is null or s.not_after > now())
       );
  exception when others then
    null;
  end;

  -- Tope de 20 equipos por cuenta: se van los que llevan más sin aparecer.
  delete from public.devices x
   where x.user_id = me
     and x.device_id in (
       select y.device_id from public.devices y
        where y.user_id = me
        order by y.last_seen desc
        offset 20
     );

  return jsonb_build_object(
    'cloud_at', (select b.updated_at from public.backups b where b.user_id = me),
    'now', now(),
    'devices', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'device_id', d.device_id,
                 'kind', d.kind,
                 'platform', d.platform,
                 'app_version', d.app_version,
                 'linked', d.linked,
                 'first_seen', d.first_seen,
                 'last_seen', d.last_seen,
                 'unlinked_at', d.unlinked_at,
                 'sync', d.sync,
                 'resync_at', d.resync_at
               )
               order by d.last_seen desc
             )
        from public.devices d
       where d.user_id = me
    ), '[]'::jsonb)
  );
end
$$;

-- ------------------------------------------------------------
-- Este equipo cierra sesión (se llama justo antes de cerrarla).
-- ------------------------------------------------------------
create or replace function public.device_unlink(p_device_id text)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.devices
     set linked = false, unlinked_at = now()
   where user_id = auth.uid()
     and device_id = p_device_id
     and (linked or unlinked_at is null);
$$;

-- ------------------------------------------------------------
-- Quitar un equipo de la lista (vuelve solo si abre Frame con la cuenta).
-- ------------------------------------------------------------
create or replace function public.device_forget(p_device_id text)
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.devices
   where user_id = auth.uid()
     and device_id = p_device_id;
$$;

-- ------------------------------------------------------------
-- «Corregir»: pide a los demás equipos vinculados que sincronicen todo.
-- Cada uno lo ve en su siguiente latido (resync_at cambió) y lo hace una vez.
-- ------------------------------------------------------------
create or replace function public.device_request_resync(p_from text)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.devices
     set resync_at = now()
   where user_id = auth.uid()
     and linked
     and device_id <> coalesce(p_from, '');
$$;

revoke all on function public.device_heartbeat(text, text, text, text, jsonb) from public, anon;
revoke all on function public.device_unlink(text) from public, anon;
revoke all on function public.device_forget(text) from public, anon;
revoke all on function public.device_request_resync(text) from public, anon;
grant execute on function public.device_heartbeat(text, text, text, text, jsonb) to authenticated;
grant execute on function public.device_unlink(text) to authenticated;
grant execute on function public.device_forget(text) to authenticated;
grant execute on function public.device_request_resync(text) to authenticated;
