-- Roleta Premiada: schema privado roleta2 + funções públicas roleta2_* (chamadas via RPC)
create extension if not exists pgcrypto with schema extensions;

create schema if not exists roleta2;
revoke all on schema roleta2 from public, anon, authenticated;

create table roleta2.config (
  id int primary key default 1 check (id = 1),
  prizes jsonb not null,
  whatsapp text not null default '',
  validity int not null default 7,
  limit_spin boolean not null default false,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table roleta2.participants (
  id bigserial primary key,
  name text,
  phone text,
  phone_digits text,
  prize text not null,
  code text not null unique,
  optin boolean not null default false,
  created_at timestamptz not null default now()
);
create index participants_phone_digits_idx on roleta2.participants (phone_digits);

create table roleta2.login_fails (
  id bigserial primary key,
  at timestamptz not null default now()
);

create table roleta2.assets (
  name text primary key,
  mime text not null,
  b64 text not null,
  updated_at timestamptz not null default now()
);

alter table roleta2.config enable row level security;
alter table roleta2.participants enable row level security;
alter table roleta2.login_fails enable row level security;
alter table roleta2.assets enable row level security;

create or replace function roleta2.norm_phone(p text)
 returns text language sql immutable set search_path to ''
as $function$
  select nullif(case when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3) else d end, '')
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$function$;

create or replace function roleta2.check_pin(p_pin text)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare ok boolean; v text := upper(trim(coalesce(p_pin, '')));
begin
  if (select count(*) from roleta2.login_fails where at > now() - interval '15 minutes') >= 20 then return 'bloqueado'; end if;
  select c.pin_hash = extensions.crypt(v, c.pin_hash) into ok from roleta2.config c where c.id = 1;
  if coalesce(ok, false) then return 'ok'; end if;
  insert into roleta2.login_fails default values;
  delete from roleta2.login_fails where at < now() - interval '1 day';
  return 'pin';
end $function$;

create or replace function public.roleta2_admin_clear(p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  delete from roleta2.participants where true;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.roleta2_admin_delete_asset(p_pin text, p_name text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  delete from roleta2.assets where name = p_name;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.roleta2_admin_login(p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.roleta2_admin_participants(p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('name', coalesce(p.name, ''), 'phone', coalesce(p.phone, ''), 'prize', p.prize,
             'code', p.code, 'optin', p.optin, 'date', p.created_at) order by p.created_at desc)
    from (select * from roleta2.participants order by created_at desc limit 5000) p), '[]'::jsonb));
end $function$;

create or replace function public.roleta2_admin_save(p_pin text, p_cfg jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  if jsonb_typeof(p_cfg->'prizes') <> 'array' or jsonb_array_length(p_cfg->'prizes') < 2 or jsonb_array_length(p_cfg->'prizes') > 16 then
    return jsonb_build_object('error', 'premios');
  end if;
  update roleta2.config set
    prizes = p_cfg->'prizes',
    whatsapp = left(regexp_replace(coalesce(p_cfg->>'whatsapp', ''), '\D', '', 'g'), 15),
    validity = least(90, greatest(1, coalesce((p_cfg->>'validity')::int, 7))),
    limit_spin = coalesce((p_cfg->>'limit')::boolean, false),
    updated_at = now()
  where id = 1;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.roleta2_admin_set_asset(p_pin text, p_name text, p_mime text, p_b64 text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  if not ((p_name = 'mascote' and p_mime in ('video/mp4', 'video/webm'))
       or (p_name in ('musica_fundo', 'musica_premio') and p_mime in ('audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'))) then
    return jsonb_build_object('error', 'arquivo');
  end if;
  if p_b64 is null or length(p_b64) > 7200000 or p_b64 !~ '^[A-Za-z0-9+/=]+$' then return jsonb_build_object('error', 'tamanho'); end if;
  insert into roleta2.assets (name, mime, b64, updated_at) values (p_name, p_mime, p_b64, now())
  on conflict (name) do update set mime = excluded.mime, b64 = excluded.b64, updated_at = now();
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.roleta2_admin_set_pin(p_pin text, p_new text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare st text := roleta2.check_pin(p_pin); v text := upper(trim(coalesce(p_new, '')));
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  if v !~ '^[A-Z0-9-]{4,20}$' then return jsonb_build_object('error', 'formato'); end if;
  update roleta2.config set pin_hash = extensions.crypt(v, extensions.gen_salt('bf')) where id = 1;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.roleta2_get_asset(p_name text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select jsonb_build_object('mime', a.mime, 'b64', a.b64, 'v', (extract(epoch from a.updated_at) * 1000)::bigint::text)
  from roleta2.assets a where a.name = p_name
$function$;

create or replace function public.roleta2_get_config()
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select jsonb_build_object('prizes', c.prizes, 'whatsapp', c.whatsapp, 'validity', c.validity,
                            'limit', c.limit_spin, 'updated_at', c.updated_at,
                            'mascot', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from roleta2.assets a where a.name = 'mascote'),
                            'music', jsonb_build_object(
                               'fundo', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from roleta2.assets a where a.name = 'musica_fundo'),
                               'premio', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from roleta2.assets a where a.name = 'musica_premio')))
  from roleta2.config c where c.id = 1
$function$;

create or replace function public.roleta2_spin(p_name text, p_phone text, p_optin boolean)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  d text := roleta2.norm_phone(p_phone);
  prev record; prz jsonb; total numeric; n int; r numeric; acc numeric := 0;
  chosen text; el jsonb; c text; t timestamptz;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then return jsonb_build_object('error', 'nome'); end if;
  if d is null or length(d) < 10 or length(d) > 11 then return jsonb_build_object('error', 'telefone'); end if;
  perform pg_advisory_xact_lock(hashtext('roleta2:' || d));
  select p.name, p.prize, p.code, p.created_at into prev
    from roleta2.participants p where p.phone_digits = d order by p.created_at limit 1;
  if found then
    return jsonb_build_object('error', 'repetido', 'name', prev.name, 'prize', prev.prize, 'code', prev.code, 'date', prev.created_at);
  end if;
  select cf.prizes into prz from roleta2.config cf where cf.id = 1;
  select coalesce(sum(greatest(0, coalesce((x->>'weight')::numeric, 0))), 0), count(*) into total, n
    from jsonb_array_elements(prz) x where coalesce((x->>'active')::boolean, false) and length(trim(coalesce(x->>'label', ''))) > 0;
  if n < 2 then return jsonb_build_object('error', 'config'); end if;
  if total <= 0 then
    select x->>'label' into chosen from jsonb_array_elements(prz) x
      where coalesce((x->>'active')::boolean, false) and length(trim(coalesce(x->>'label', ''))) > 0 order by random() limit 1;
  else
    r := random() * total;
    for el in select x from jsonb_array_elements(prz) with ordinality as a(x, i)
              where coalesce((x->>'active')::boolean, false) and length(trim(coalesce(x->>'label', ''))) > 0 order by i loop
      acc := acc + greatest(0, coalesce((el->>'weight')::numeric, 0));
      chosen := el->>'label';
      exit when r < acc;
    end loop;
  end if;
  loop
    c := 'EDC-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from roleta2.participants p where p.code = c);
  end loop;
  insert into roleta2.participants (name, phone, phone_digits, prize, code, optin)
  values (left(trim(p_name), 60), left(trim(coalesce(p_phone, '')), 20), d, chosen, c, coalesce(p_optin, false))
  returning created_at into t;
  return jsonb_build_object('ok', true, 'prize', chosen, 'code', c, 'date', t);
end $function$;

-- funções internas não ficam expostas; as públicas podem ser chamadas pelo site
revoke execute on all functions in schema roleta2 from public, anon, authenticated;
grant execute on function
  public.roleta2_admin_clear(text), public.roleta2_admin_delete_asset(text, text), public.roleta2_admin_login(text),
  public.roleta2_admin_participants(text), public.roleta2_admin_save(text, jsonb),
  public.roleta2_admin_set_asset(text, text, text, text), public.roleta2_admin_set_pin(text, text),
  public.roleta2_get_asset(text), public.roleta2_get_config(), public.roleta2_spin(text, text, boolean)
to anon, authenticated;
