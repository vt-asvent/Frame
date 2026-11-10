-- ============================================================
-- 0016 · Métricas de descargas y dispositivos (Frame 1.9.2 / móvil 1.3.2)
--
-- Pedido de Diego (9-nov-2026): el panel de métricas mide también cuántos
-- archivos descarga cada usuario. Frame manda un evento por descarga, con
-- `n` = cuántos archivos fueron:
--   · `library_download`: archivos de la Biblioteca (AK Lore), uno o una
--     colección entera;
--   · `song_download`: canciones que baja «Añadir» de Música.
-- Esos dos eventos se cuentan por ARCHIVOS, no por veces. El resto, igual.
--
-- Y la foto del panel trae cuántos dispositivos vinculados tiene cada cuenta
-- (`dv`) y el total por tipo de los que se abrieron en los últimos 30 días
-- (`devices`), de la tabla de 0015.
--
-- Se retocan las dos funciones que cuentan eventos (la compactación diaria y
-- la foto del panel) sobre su texto actual, como 0013 hizo con
-- is_frame_owner(): si no tienen la forma esperada, no se toca nada.
-- ============================================================

do $$
declare
  weighted constant text := $w$sum(case when event in ('library_download', 'song_download') and props ->> 'n' ~ '^[0-9]{1,4}$' then (props ->> 'n')::int else 1 end)::bigint as n$w$;
  def text;
begin
  -- 1. La compactación diaria (eventos de más de 14 días → una fila por día).
  def := pg_get_functiondef('private.compact_telemetry(integer)'::regprocedure);
  if position('library_download' in def) = 0 then
    if position('count(*) as n from tagged group by user_id, day, event' in def) = 0 then
      raise exception 'compact_telemetry() no tiene la forma esperada; revísala a mano';
    end if;
    def := replace(def, 'count(*) as n from tagged group by user_id, day, event', weighted || ' from tagged group by user_id, day, event');
    execute def;
  end if;

  -- 2. La foto del panel: eventos de los últimos 14 días, dispositivos.
  def := pg_get_functiondef('private.build_usage_snapshot(text)'::regprocedure);
  if position('library_download' in def) = 0 then
    if position('select user_id, dn, event, count(*) as n from te group by user_id, dn, event' in def) = 0
       or position($q$'e', coalesce(eb.e, '{}'::jsonb),$q$ in def) = 0
       or position($q$'mx_open', ($q$ in def) = 0 then
      raise exception 'build_usage_snapshot() no tiene la forma esperada; revísala a mano';
    end if;
    def := replace(def,
      'select user_id, dn, event, count(*) as n from te group by user_id, dn, event',
      'select user_id, dn, event, ' || weighted || ' from te group by user_id, dn, event');
    def := replace(def,
      $q$'e', coalesce(eb.e, '{}'::jsonb),$q$,
      $q$'e', coalesce(eb.e, '{}'::jsonb),
        'dv', (select count(*) from public.devices dv where dv.linked and dv.user_id::text = u.user_id),$q$);
    def := replace(def,
      $q$'mx_open', ($q$,
      $q$'devices', (
      select jsonb_build_object(
        'laptop', count(*) filter (where kind = 'laptop'),
        'phone', count(*) filter (where kind = 'phone'),
        'tablet', count(*) filter (where kind = 'tablet'),
        'accounts', count(distinct user_id))
        from public.devices
       where linked and last_seen > now() - interval '30 days'
    ),
    'mx_open', ($q$);
    execute def;
  end if;
end;
$$;
