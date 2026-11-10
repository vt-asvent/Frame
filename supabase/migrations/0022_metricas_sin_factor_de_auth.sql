-- 0022 · El autenticador del panel de métricas deja de ser un «segundo factor»
--        de Supabase Auth (10-nov-2026)
--
-- Por qué. Mientras la cuenta del responsable tenga un factor verificado en
-- Auth, Auth la trata distinto que a todas las demás:
--   · verificar ese factor borra sus sesiones normales (lo que arregló la 0021);
--   · darlo de alta o de baja también las borra (la 0021 lo dejaba como
--     «solo esta vez»);
--   · y Auth puede negarse a renovar una sesión normal de una cuenta «capaz de
--     aal2» («Session Expired (Low AAL)»), según cómo esté el proyecto.
-- Las sesiones normales son las de Frame en su laptop, su celular y su tablet.
--
-- Qué cambia. La clave del autenticador pasa a una tabla privada de esta base
-- y el factor de Auth se borra: para Auth, la cuenta del responsable queda como
-- la de cualquier usuario, y nada del panel puede volver a cerrarle Frame. El
-- panel pide el mismo código de la misma app de autenticación: no hay que
-- volver a escanear nada.
--   · `metrics_totp_state()`: 'ready' (hay autenticador), 'none' o 'not-owner'.
--   · `metrics_totp_begin()`: si no hay ninguno confirmado, crea una clave y la
--     devuelve para escribirla en la app de autenticación. Una clave a medio
--     confirmar es de la sesión que la creó: a otra sesión no se le enseña (se
--     le da una nueva y la anterior deja de valer) y solo esa sesión puede
--     confirmarla, en un cuarto de hora.
--   · `metrics_unlock(code)`: como en la 0021, con la clave de aquí; el primer
--     código bueno de una clave nueva la confirma.
--   · `is_frame_owner()`: el responsable con su sesión del panel abierta con el
--     código. Ya no mira `aal2`: nadie vuelve a tenerlo.
--
-- Cambiar de teléfono sin tener el anterior: borrar la fila a mano en el editor
-- SQL de Supabase (`delete from private.metrics_totp;`) y abrir el panel, que
-- ofrece dar de alta el autenticador otra vez.

-- ------------------------------------------------------------
-- La clave del autenticador del responsable
-- ------------------------------------------------------------
create table if not exists private.metrics_totp (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  secret     text not null check (length(secret) >= 16),
  confirmed  boolean not null default false,
  created_at timestamptz not null default now(),
  -- La sesión del panel que creó una clave aún sin confirmar (nulo en la que vino de Auth).
  session_id uuid
);
alter table private.metrics_totp enable row level security;
revoke all on table private.metrics_totp from public, anon, authenticated;

-- La que ya tenía en Auth pasa aquí tal cual, y el factor de Auth se va. Solo
-- se borra si la copia quedó hecha.
insert into private.metrics_totp (user_id, secret, confirmed, created_at)
select f.user_id, f.secret, true, f.created_at
  from auth.mfa_factors f
  join auth.users u on u.id = f.user_id
 where lower(u.email) = (select o.email from private.frame_owner o)
   and f.factor_type::text = 'totp'
   and f.status::text = 'verified'
   and f.secret is not null
 order by f.created_at desc
 limit 1
on conflict (user_id) do nothing;

delete from auth.mfa_factors f
 using auth.users u
 where u.id = f.user_id
   and lower(u.email) = (select o.email from private.frame_owner o)
   and (
     f.status::text <> 'verified'
     or exists (select 1 from private.metrics_totp t where t.user_id = f.user_id and t.confirmed)
   );

-- Las sesiones `aal2` de esa cuenta son las que el panel fue dejando abiertas
-- (una por visita, desde octubre): ya no sirven. Las de Frame son `aal1` y no
-- se tocan.
delete from auth.sessions s
 using auth.users u
 where u.id = s.user_id
   and lower(u.email) = (select o.email from private.frame_owner o)
   and s.aal::text = 'aal2';

-- ------------------------------------------------------------
-- Base32 (para entregar una clave nueva)
-- ------------------------------------------------------------
create or replace function private.base32_encode(p bytea)
returns text
language plpgsql
immutable
strict
set search_path to ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bits text := '';
  encoded text := '';
begin
  for i in 0 .. length(p) - 1 loop
    bits := bits || (get_byte(p, i)::bit(8))::text;
  end loop;
  while length(bits) % 5 <> 0 loop
    bits := bits || '0';
  end loop;
  for i in 0 .. (length(bits) / 5) - 1 loop
    encoded := encoded || substr(alphabet, (substr(bits, i * 5 + 1, 5)::bit(5))::integer + 1, 1);
  end loop;
  return encoded;
end
$$;
revoke all on function private.base32_encode(bytea) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ¿Tiene autenticador? · Dar de alta uno
-- ------------------------------------------------------------
create or replace function public.metrics_totp_state()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
           when not public.metrics_owner_account() then 'not-owner'
           when exists (select 1 from private.metrics_totp t where t.user_id = auth.uid() and t.confirmed) then 'ready'
           else 'none'
         end
$$;

-- Devuelve { ok: true, secret } o { ok: false, reason }:
--   not-owner  no es la cuenta del responsable
--   session    la sesión ya no existe (hay que volver a entrar al panel)
--   exists     ya hay un autenticador confirmado (se cambia borrando la fila a mano)
create or replace function public.metrics_totp_begin()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
  sid uuid := private.jwt_session_id();
  current_row private.metrics_totp%rowtype;
  fresh text;
begin
  if me is null then
    raise exception 'sin sesión' using errcode = '28000';
  end if;
  if not public.metrics_owner_account() then
    return jsonb_build_object('ok', false, 'reason', 'not-owner');
  end if;
  if sid is null or not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = me) then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;
  select * into current_row from private.metrics_totp t where t.user_id = me for update;
  if found and current_row.confirmed then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end if;
  -- Una clave a medio confirmar se le repite solo a la sesión que la creó, y un
  -- cuarto de hora (recargar la página no la cambia). A cualquier otra sesión se
  -- le da una nueva: nunca se enseña una clave que otro pudo dejar a medias.
  if found and current_row.session_id = sid and current_row.created_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', true, 'secret', current_row.secret);
  end if;
  fresh := private.base32_encode(extensions.gen_random_bytes(20));
  insert into private.metrics_totp (user_id, secret, confirmed, created_at, session_id)
  values (me, fresh, false, now(), sid)
  on conflict (user_id) do update set secret = excluded.secret, confirmed = false, created_at = now(), session_id = excluded.session_id;
  -- Clave nueva: los pasos de tiempo ya usados eran de la anterior.
  update private.metrics_unlock_state s set last_step = 0 where s.user_id = me;
  return jsonb_build_object('ok', true, 'secret', fresh);
end
$$;

-- ------------------------------------------------------------
-- El código del autenticador abre ESTA sesión del panel
-- ------------------------------------------------------------
-- Devuelve { ok: true, until } o { ok: false, reason, … }:
--   not-owner   no es la cuenta del responsable
--   session     la sesión ya no existe (hay que volver a entrar al panel)
--   no-factor   la cuenta aún no dio de alta su autenticador
--   locked      demasiados fallos (retry_in: segundos que faltan)
--   code        código incorrecto o ya usado (left: intentos que quedan)
--   unavailable la clave del autenticador no se pudo leer
create or replace function public.metrics_unlock(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
  sid uuid := private.jwt_session_id();
  digits text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  totp private.metrics_totp%rowtype;
  secret_key bytea;
  now_step bigint := floor(extract(epoch from now()) / 30)::bigint;
  st private.metrics_unlock_state%rowtype;
  matched bigint;
  fails integer;
  good_until timestamptz := now() + interval '12 hours';
begin
  if me is null then
    raise exception 'sin sesión' using errcode = '28000';
  end if;
  if not public.metrics_owner_account() then
    return jsonb_build_object('ok', false, 'reason', 'not-owner');
  end if;
  if sid is null or not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = me) then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select * into totp from private.metrics_totp t where t.user_id = me;
  -- Una clave sin confirmar solo la confirma la sesión que la creó, y a tiempo.
  if not found
     or (not totp.confirmed and (totp.session_id is distinct from sid or totp.created_at < now() - interval '15 minutes')) then
    return jsonb_build_object('ok', false, 'reason', 'no-factor');
  end if;
  begin
    secret_key := private.base32_decode(totp.secret);
  exception when others then
    secret_key := null;
  end;
  if secret_key is null or length(secret_key) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  insert into private.metrics_unlock_state (user_id) values (me) on conflict (user_id) do nothing;
  select * into st from private.metrics_unlock_state s where s.user_id = me for update;

  if st.locked_until is not null and st.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_in', ceil(extract(epoch from st.locked_until - now()))::integer);
  end if;

  -- El paso de ahora y sus vecinos (el reloj del teléfono puede ir medio minuto
  -- corrido). Un paso ya usado, o anterior al último usado, no vuelve a valer.
  if length(digits) = 6 then
    select candidate into matched
      from unnest(array[now_step, now_step - 1, now_step + 1]) as candidate
     where candidate > st.last_step and private.totp_code(secret_key, candidate) = digits
     limit 1;
  end if;

  if matched is null then
    fails := case when st.window_start < now() - interval '10 minutes' then 1 else st.failures + 1 end;
    if fails >= 5 then
      update private.metrics_unlock_state s
         set failures = 0, window_start = now(), locked_until = now() + interval '15 minutes'
       where s.user_id = me;
      return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_in', 900);
    end if;
    update private.metrics_unlock_state s
       set failures = fails,
           window_start = case when st.window_start < now() - interval '10 minutes' then now() else st.window_start end,
           locked_until = null
     where s.user_id = me;
    return jsonb_build_object('ok', false, 'reason', 'code', 'left', 5 - fails);
  end if;

  update private.metrics_unlock_state s
     set failures = 0, window_start = now(), locked_until = null, last_step = matched
   where s.user_id = me;
  -- El primer código bueno de una clave recién creada la da por buena.
  if not totp.confirmed then
    update private.metrics_totp t set confirmed = true, session_id = null where t.user_id = me;
  end if;

  -- Las sesiones anteriores del propio panel se cierran (las de sus pestañas ya
  -- cerradas, que nadie cerró): las que se abrieron con este código y las
  -- `aal2` que quedaran de antes de la 0022. Las de Frame no se tocan.
  begin
    delete from auth.sessions s
     where s.user_id = me
       and s.id <> sid
       and (s.aal::text = 'aal2' or exists (select 1 from private.metrics_unlocks u where u.session_id = s.id));
  exception when others then
    null; -- si un día cambia el esquema de Auth, el panel sigue abriendo
  end;
  delete from private.metrics_unlocks u
   where u.until < now() or (u.user_id = me and u.session_id <> sid);

  insert into private.metrics_unlocks (session_id, user_id, until)
  values (sid, me, good_until)
  on conflict (session_id) do update set until = excluded.until, unlocked_at = now();

  return jsonb_build_object('ok', true, 'until', good_until);
end
$$;

-- ------------------------------------------------------------
-- El responsable: su cuenta y su sesión del panel abierta con el código
-- ------------------------------------------------------------
create or replace function public.is_frame_owner()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(public.metrics_owner_account() and public.metrics_unlocked(), false)
$$;

revoke all on function public.metrics_totp_state() from public, anon;
revoke all on function public.metrics_totp_begin() from public, anon;
revoke all on function public.metrics_unlock(text) from public, anon;
grant execute on function public.metrics_totp_state() to authenticated;
grant execute on function public.metrics_totp_begin() to authenticated;
grant execute on function public.metrics_unlock(text) to authenticated;
