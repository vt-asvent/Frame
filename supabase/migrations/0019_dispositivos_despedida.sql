-- 0019 · Dispositivos: la despedida manda (Frame 1.9.2 / móvil 1.3.2)
--
-- Cierra tres huecos de 0018 antes de que ningún cliente publicado la use
-- (la tabla sigue vacía):
--
-- 1. Un latido enviado justo antes de «Cerrar sesión» podía llegar después
--    de la despedida y volvía a vincular el equipo. Ahora el latido de la
--    MISMA sesión que acaba de despedirse no lo revive durante dos minutos.
--    Si la sesión en realidad sobrevivió (la app murió a media salida), el
--    equipo vuelve a vincularse solo pasado ese margen.
-- 2. Un equipo cuya sesión se cerró desde fuera puede seguir latiendo hasta
--    que caduque su llave (una hora): se marcaba vinculado y los demás lo
--    desvinculaban, así que la lista parpadeaba. Ahora el latido comprueba
--    su propia sesión y, si ya no existe, se anota como desvinculado.
-- 3. Un equipo «olvidado» con la sesión cerrada reaparecía con su siguiente
--    latido. Una sesión que ya no existe no crea filas.
--
-- Además, device_unlink guarda qué sesión se despide y siempre deja la hora.
-- device_forget y device_request_resync no cambian.

-- ------------------------------------------------------------
-- Latido: registra este equipo y devuelve los de la cuenta.
-- ------------------------------------------------------------
create or replace function public.device_heartbeat(p_device_id text, p_kind text, p_platform text, p_app_version text, p_sync jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
  sid uuid;
  alive boolean := true;
  clean_kind text := case when p_kind in ('laptop', 'phone', 'tablet') then p_kind else 'laptop' end;
  clean_platform text := case when p_platform in ('windows', 'android', 'ios', 'macos', 'linux', 'web') then p_platform else 'web' end;
  clean_version text := left(coalesce(p_app_version, ''), 20);
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

  -- ¿Sigue existiendo la sesión que late? La llave vale hasta una hora después
  -- de cerrarse la sesión. Si no se puede saber, se da por viva.
  if sid is not null then
    begin
      alive := exists (
        select 1 from auth.sessions s
         where s.id = sid
           and s.user_id = me
           and (s.not_after is null or s.not_after > now())
      );
    exception when others then
      alive := true;
    end;
  end if;

  -- Solo el resumen que arma Frame (unos pocos números); nada más grande.
  if p_sync is not null and jsonb_typeof(p_sync) = 'object' and pg_column_size(p_sync) <= 2000 then
    clean_sync := p_sync;
  end if;

  if alive then
    insert into public.devices as d (user_id, device_id, kind, platform, app_version, linked, last_seen, unlinked_at, sync, session_id)
    values (me, p_device_id, clean_kind, clean_platform, clean_version, true, now(), null, clean_sync, sid)
    on conflict (user_id, device_id) do update
      set kind = excluded.kind,
          platform = excluded.platform,
          app_version = excluded.app_version,
          last_seen = now(),
          sync = excluded.sync,
          session_id = excluded.session_id,
          -- La despedida manda: esta misma sesión acaba de cerrar aquí, así que
          -- este latido salió antes y llegó después. No revive el equipo.
          linked = not (
            not d.linked
            and d.unlinked_at is not null
            and d.unlinked_at > now() - interval '2 minutes'
            and d.session_id is not distinct from excluded.session_id
          ),
          unlinked_at = case
            when not d.linked
             and d.unlinked_at is not null
             and d.unlinked_at > now() - interval '2 minutes'
             and d.session_id is not distinct from excluded.session_id
            then d.unlinked_at
            else null
          end;
  else
    -- Sesión cerrada desde fuera: el equipo se ve (sigue abierto), pero ya no
    -- está vinculado. Si no tenía fila (se olvidó), no se crea.
    update public.devices d
       set kind = clean_kind,
           platform = clean_platform,
           app_version = clean_version,
           last_seen = now(),
           sync = clean_sync,
           session_id = sid,
           linked = false
     where d.user_id = me and d.device_id = p_device_id;
  end if;

  -- Los equipos cuya sesión ya no existe dejan de estar vinculados. Sin hora
  -- de despedida: no llegaron a avisar.
  begin
    update public.devices d
       set linked = false
     where d.user_id = me
       and d.linked
       and d.session_id is not null
       and not exists (
         select 1 from auth.sessions s
          where s.id = d.session_id and (s.not_after is null or s.not_after > now())
       );
  exception when others then
    null;
  end;

  -- Tope: como mucho 20 equipos por cuenta (los vistos más recientemente).
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
      select jsonb_agg(jsonb_build_object(
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
             ) order by d.last_seen desc)
        from public.devices d
       where d.user_id = me
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- Despedida: el equipo cierra sesión. Anota qué sesión se despide: es la que
-- el latido de arriba reconoce para no revivirlo.
-- ------------------------------------------------------------
create or replace function public.device_unlink(p_device_id text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  sid uuid;
begin
  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    sid := null;
  end;

  update public.devices
     set linked = false,
         unlinked_at = now(),
         session_id = coalesce(sid, session_id)
   where user_id = auth.uid() and device_id = p_device_id;
end;
$$;

revoke all on function public.device_heartbeat(text, text, text, text, jsonb) from public, anon;
revoke all on function public.device_unlink(text) from public, anon;
grant execute on function public.device_heartbeat(text, text, text, text, jsonb) to authenticated;
grant execute on function public.device_unlink(text) to authenticated;
