-- ============================================================
-- 0017 · Corrección de 0016 (Frame 1.9.2)
--
-- 0016 llamó `dv` al número de dispositivos vinculados de cada estudiante,
-- pero la foto del panel ya usaba `dv` para el tipo de equipo: el número lo
-- pisaba. Pasa a llamarse `nd`. Aplicada minutos después de 0016, con la
-- foto del panel recalculada en seguida (refresh_usage_snapshot).
-- ============================================================

do $$
declare
  def text := pg_get_functiondef('private.build_usage_snapshot(text)'::regprocedure);
  wrong constant text := $q$'dv', (select count(*) from public.devices dv where dv.linked and dv.user_id::text = u.user_id),$q$;
begin
  if position(wrong in def) > 0 then
    def := replace(def, wrong, $q$'nd', (select count(*) from public.devices dv where dv.linked and dv.user_id::text = u.user_id),$q$);
    execute def;
  end if;
end;
$$;
