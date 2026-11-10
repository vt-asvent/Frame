-- ============================================================
-- 0020 · Métricas: dispositivos bien contados (Frame 1.9.2)
--
-- Revisión de 0016 y 0017 antes de publicar la 1.9.2. Tres cosas:
--
-- 1. `nd` (dispositivos de cada cuenta) contaba toda fila con linked = true,
--    también la de una Frame reinstalada hace meses: su fila vieja se queda
--    «vinculada» para siempre (nadie más la ve cerrar sesión). Ahora cuenta
--    solo los equipos vistos en los últimos 30 días, como el total del panel
--    y como la propia app, que a los demás los llama «inactivos».
-- 2. El total del panel (`devices`) contaba los equipos del responsable, y
--    los de cuentas que el panel no muestra. Ahora, como todo lo demás de la
--    foto: sin la cuenta del responsable y solo de quienes están en ella.
-- 3. `nd` era una subconsulta por estudiante con un cambio de tipo que no
--    deja usar la clave: recorría la tabla entera por cada uno. Ahora es una
--    sola pasada por la tabla y un cruce.
--
-- Y un evento de descarga no puede sumar más de 1000 archivos (admitía 9999
-- y la tabla acepta eventos anónimos).
--
-- Como 0016: se retoca el texto actual de las funciones y, si no tiene la
-- forma esperada, no se toca nada. Los patrones toleran cualquier espaciado
-- y fin de línea.
-- ============================================================

do $$
declare
  per_event constant text := $q$then (props ->> 'n')::int else 1 end$q$;
  capped    constant text := $q$then least((props ->> 'n')::int, 1000) else 1 end$q$;
  old_nd    constant text := $q$'nd', (select count(*) from public.devices dv where dv.linked and dv.user_id::text = u.user_id),$q$;
  old_join  constant text := $q$left join screens_by sb on sb.user_id = u.user_id$q$;
  -- El final de la última consulta auxiliar (screens_by) y el comienzo de la principal.
  ctes_end  constant text := $q$(scd group by user_id, screen\) x group by user_id\s+\))(\s+select jsonb_build_object\()$q$;
  -- De dónde salía el total del panel.
  total_src constant text := $q$from public\.devices\s+where linked and last_seen > now\(\) - interval '30 days'$q$;
  def text;
begin
  -- 1. La compactación diaria.
  def := pg_get_functiondef('private.compact_telemetry(integer)'::regprocedure);
  if position(capped in def) = 0 then
    if position(per_event in def) = 0 then
      raise exception 'compact_telemetry() no tiene la forma esperada; revísala a mano';
    end if;
    execute replace(def, per_event, capped);
  end if;

  -- 2. La foto del panel.
  def := pg_get_functiondef('private.build_usage_snapshot(text)'::regprocedure);
  if position('devices_by as' in def) = 0 then
    if position(per_event in def) = 0 or position(old_nd in def) = 0 or position(old_join in def) = 0
       or def !~ ctes_end or def !~ total_src then
      raise exception 'build_usage_snapshot() no tiene la forma esperada; revísala a mano';
    end if;
    def := replace(def, per_event, capped);
    def := regexp_replace(def, ctes_end, $q$\1,
  dev as (
    select d.user_id::text as user_id, d.kind
      from public.devices d
     where d.linked and d.last_seen > now() - interval '30 days'
       and d.user_id::text in (select user_id from tu)
  ),
  devices_by as (select user_id, count(*) as nd from dev group by user_id)\2$q$);
    def := replace(def, old_nd, $q$'nd', coalesce(dvb.nd, 0),$q$);
    def := replace(def, old_join, old_join || $q$
        left join devices_by dvb on dvb.user_id = u.user_id$q$);
    def := regexp_replace(def, total_src, 'from dev');
    execute def;
  end if;
end;
$$;
