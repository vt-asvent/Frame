-- 0021 · El código del panel de métricas ya no cierra Frame en los equipos
--        del responsable (10-nov-2026)
--
-- Qué pasaba. El panel pedía el código del autenticador con el segundo factor
-- de Supabase Auth (`mfa.challengeAndVerify`). Al verificarlo, Auth sube esa
-- sesión a `aal2` y BORRA todas las demás sesiones de la cuenta que no lo son
-- (`InvalidateSessionsWithAALLessThan`): la de Frame en la laptop, en el
-- celular y en la tablet del responsable. Cada visita al panel dejaba a Frame
-- «desvinculada»: la Biblioteca decía «tu sesión venció», Dispositivos «la
-- sesión caducó» y, al vencer la llave, había que volver a entrar. Solo le
-- pasaba a la cuenta del responsable, la única con segundo factor.
--
-- Qué cambia. El panel sigue pidiendo el mismo código de la misma app de
-- autenticación, pero lo comprueba esta base (TOTP, RFC 6238) y anota que ESA
-- sesión del panel quedó abierta. Auth no interviene, así que no borra nada.
--   · `metrics_unlock(code)`: solo el responsable; cinco fallos en diez minutos
--     lo bloquean un cuarto de hora; un código no vale dos veces.
--   · `is_frame_owner()`: el responsable con su sesión abierta así (o con
--     `aal2`, como hasta ahora: el alta del autenticador sigue siendo de Auth).
--   · El correo del responsable pasa a una tabla privada: deja de ir escrito
--     dentro de la función.
--
-- De paso: cada visita al panel dejaba una sesión sin cerrar para siempre (al
-- cerrar la pestaña nadie avisa). Al abrir el panel se cierran las anteriores
-- del propio panel; nunca las de Frame.

-- ------------------------------------------------------------
-- Quién es el responsable
-- ------------------------------------------------------------
create table if not exists private.frame_owner (
  only_row boolean primary key default true check (only_row),
  email    text not null check (email = lower(email) and position('@' in email) > 1)
);
alter table private.frame_owner enable row level security;
revoke all on table private.frame_owner from public, anon, authenticated;

do $$
declare
  found text[];
begin
  if not exists (select 1 from private.frame_owner) then
    -- El correo sale de la función actual: así no va escrito en el repositorio.
    found := regexp_match(pg_get_functiondef('public.is_frame_owner()'::regprocedure), $q$'email'\)\s*=\s*'([^']+@[^']+)'$q$);
    if found is null then
      raise exception 'is_frame_owner() no tiene la forma esperada; indica el correo del responsable a mano en private.frame_owner';
    end if;
    insert into private.frame_owner (email) values (lower(found[1]));
  end if;
end
$$;

/** ¿La cuenta que llama es la del responsable? (Sin mirar el segundo paso.) */
create or replace function public.metrics_owner_account()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = (select o.email from private.frame_owner o), false)
$$;

-- ------------------------------------------------------------
-- Sesiones del panel abiertas con el código, y el freno de intentos
-- ------------------------------------------------------------
create table if not exists private.metrics_unlocks (
  session_id  uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  until       timestamptz not null
);
alter table private.metrics_unlocks enable row level security;
revoke all on table private.metrics_unlocks from public, anon, authenticated;

create table if not exists private.metrics_unlock_state (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  failures     integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  -- Último paso de tiempo (30 s) cuyo código se aceptó: ese y los anteriores ya no valen.
  last_step    bigint not null default 0
);
alter table private.metrics_unlock_state enable row level security;
revoke all on table private.metrics_unlock_state from public, anon, authenticated;

-- ------------------------------------------------------------
-- TOTP (RFC 6238: SHA-1, 6 dígitos, pasos de 30 s), como el de Supabase Auth
-- ------------------------------------------------------------
create or replace function private.base32_decode(p text)
returns bytea
language plpgsql
immutable
strict
set search_path to ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  clean text := upper(regexp_replace(p, '[\s=]', '', 'g'));
  bits text := '';
  idx integer;
  decoded bytea := ''::bytea;
begin
  for i in 1 .. length(clean) loop
    idx := position(substr(clean, i, 1) in alphabet) - 1;
    if idx < 0 then
      raise exception 'clave no válida' using errcode = '22023';
    end if;
    bits := bits || (idx::bit(5))::text;
  end loop;
  for i in 0 .. (length(bits) / 8) - 1 loop
    decoded := decoded || set_byte('\x00'::bytea, 0, (substr(bits, i * 8 + 1, 8)::bit(8))::integer);
  end loop;
  return decoded;
end
$$;

create or replace function private.totp_code(p_key bytea, p_step bigint)
returns text
language plpgsql
immutable
strict
set search_path to ''
as $$
declare
  mac bytea := extensions.hmac(decode(lpad(to_hex(p_step), 16, '0'), 'hex'), p_key, 'sha1');
  pos integer := get_byte(mac, 19) & 15;
  num bigint;
begin
  num := ((get_byte(mac, pos) & 127)::bigint << 24)
       | (get_byte(mac, pos + 1)::bigint << 16)
       | (get_byte(mac, pos + 2)::bigint << 8)
       |  get_byte(mac, pos + 3)::bigint;
  return lpad((num % 1000000)::text, 6, '0');
end
$$;

revoke all on function private.base32_decode(text) from public, anon, authenticated;
revoke all on function private.totp_code(bytea, bigint) from public, anon, authenticated;

/** La sesión que llama, o null si la llave no la trae bien escrita. */
create or replace function private.jwt_session_id()
returns uuid
language sql
stable
set search_path to ''
as $$
  select case
           when (auth.jwt() ->> 'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (auth.jwt() ->> 'session_id')::uuid
         end
$$;
revoke all on function private.jwt_session_id() from public, anon, authenticated;

/** ¿Esta sesión del panel pasó el código y sigue abierta? */
create or replace function public.metrics_unlocked()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
      from private.metrics_unlocks u
      join auth.sessions s on s.id = u.session_id
     where u.session_id = private.jwt_session_id()
       and u.user_id = auth.uid()
       and s.user_id = u.user_id
       and u.until > now()
  )
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
--   unavailable la clave del autenticador no se pudo leer aquí
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
  secret_text text;
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

  select f.secret into secret_text
    from auth.mfa_factors f
   where f.user_id = me and f.factor_type::text = 'totp' and f.status::text = 'verified'
   order by f.created_at desc
   limit 1;
  if secret_text is null then
    return jsonb_build_object('ok', false, 'reason', 'no-factor');
  end if;
  begin
    secret_key := private.base32_decode(secret_text);
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

  -- Las sesiones anteriores del propio panel se cierran (las de sus pestañas ya
  -- cerradas, que nadie cerró): las que se abrieron con este código y las
  -- `aal2`, que solo ha creado el panel. Las de Frame no se tocan.
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
-- El responsable: su cuenta y el segundo paso (del panel o de Auth)
-- ------------------------------------------------------------
create or replace function public.is_frame_owner()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(public.metrics_owner_account() and ((auth.jwt() ->> 'aal') = 'aal2' or public.metrics_unlocked()), false)
$$;

-- Las dos preguntas las hace `is_frame_owner()` desde las políticas de las
-- tablas, con el rol de quien consulta: también el anónimo debe poder hacerlas
-- (a él le responden «no»). Abrir el panel, solo una cuenta con sesión.
revoke all on function public.metrics_owner_account() from public;
revoke all on function public.metrics_unlocked() from public;
revoke all on function public.metrics_unlock(text) from public, anon;
grant execute on function public.metrics_owner_account() to anon, authenticated, service_role;
grant execute on function public.metrics_unlocked() to anon, authenticated, service_role;
grant execute on function public.metrics_unlock(text) to authenticated;
