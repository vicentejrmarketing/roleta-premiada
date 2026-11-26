-- Roleta Premiada multi-loja: cada loja tem endereço próprio (/slug), prêmios com estoque,
-- senha própria e seus leads. O marketing usa a senha mestra para gerenciar todas as lojas.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists rede;
revoke all on schema rede from public, anon, authenticated;

create table rede.config (
  id int primary key default 1 check (id = 1),
  master_pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table rede.campanhas (
  id serial primary key,
  nome text not null,
  premios jsonb not null default '[]'::jsonb,
  validade int not null default 7 check (validade between 1 and 90),
  limite text not null default 'rede' check (limite in ('rede', 'loja', 'livre')),
  inicio date,
  fim date,
  created_at timestamptz not null default now()
);

create table rede.lojas (
  id serial primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  nome text not null,
  whatsapp text not null default '',
  pin_hash text not null,
  edita_premios boolean not null default false,
  limite_aparelho boolean not null default false,
  ativo boolean not null default true,
  campanha_id int references rede.campanhas(id) on delete set null,
  created_at timestamptz not null default now()
);

-- prêmios de cada loja em cada campanha: [{label, weight, active, estoque (null = sem limite), saidos}]
create table rede.loja_premios (
  loja_id int not null references rede.lojas(id) on delete cascade,
  campanha_id int not null references rede.campanhas(id) on delete cascade,
  premios jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (loja_id, campanha_id)
);

create table rede.participants (
  id bigserial primary key,
  loja_id int not null references rede.lojas(id),
  campanha_id int references rede.campanhas(id) on delete set null,
  name text,
  phone text,
  phone_digits text,
  prize text not null,
  code text not null unique,
  optin boolean not null default false,
  created_at timestamptz not null default now()
);
create index participants_camp_phone_idx on rede.participants (campanha_id, phone_digits);
create index participants_loja_date_idx on rede.participants (loja_id, created_at desc);

create table rede.login_fails (
  id bigserial primary key,
  chave text not null,
  at timestamptz not null default now()
);
create index login_fails_chave_idx on rede.login_fails (chave, at);

create table rede.assets (
  name text primary key,
  mime text not null,
  b64 text not null,
  updated_at timestamptz not null default now()
);

alter table rede.config enable row level security;
alter table rede.campanhas enable row level security;
alter table rede.lojas enable row level security;
alter table rede.loja_premios enable row level security;
alter table rede.participants enable row level security;
alter table rede.login_fails enable row level security;
alter table rede.assets enable row level security;

/* ---------------- funções internas ---------------- */

create or replace function rede.norm_phone(p text)
 returns text language sql immutable set search_path to ''
as $$
  select nullif(case when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3) else d end, '')
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;

create or replace function rede.hoje()
 returns date language sql stable set search_path to ''
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- prêmio esgotado = tem estoque definido e já saiu tudo
create or replace function rede.esgotado(x jsonb)
 returns boolean language sql immutable set search_path to ''
as $$
  select jsonb_typeof(x->'estoque') = 'number' and coalesce((x->>'saidos')::int, 0) >= (x->>'estoque')::int
$$;

-- limpa a lista enviada pelo painel e mantém a contagem de "saídos" de quem já existia (pelo nome)
create or replace function rede.merge_premios(p_old jsonb, p_new jsonb)
 returns jsonb language sql immutable set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'label', left(trim(coalesce(n.x->>'label', '')), 40),
      'weight', greatest(0, least(1000, coalesce((n.x->>'weight')::numeric, 0))),
      'active', coalesce((n.x->>'active')::boolean, false),
      'estoque', case when jsonb_typeof(n.x->'estoque') = 'number' then to_jsonb(greatest(0, (n.x->>'estoque')::int))
                      when coalesce(n.x->>'estoque', '') ~ '^\d+$' then to_jsonb((n.x->>'estoque')::int)
                      else 'null'::jsonb end,
      'saidos', coalesce((select (o.y->>'saidos')::int from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o(y)
                          where lower(trim(o.y->>'label')) = lower(trim(n.x->>'label')) limit 1), 0)
    ) order by n.i), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) with ordinality n(x, i)
  where length(trim(coalesce(n.x->>'label', ''))) > 0
$$;

-- confere a senha: senha mestra -> 'master'; senha da loja -> 'loja'
create or replace function rede.auth(p_slug text, p_pin text, out papel text, out loja_id int)
 language plpgsql security definer set search_path to ''
as $$
declare v text := upper(trim(coalesce(p_pin, ''))); k text := coalesce(nullif(lower(trim(p_slug)), ''), '#master'); l_hash text;
begin
  loja_id := null;
  if (select count(*) from rede.login_fails f where f.chave = k and f.at > now() - interval '15 minutes') >= 15
     or (select count(*) from rede.login_fails f where f.at > now() - interval '15 minutes') >= 120 then
    papel := 'bloqueado'; return;
  end if;
  select x.id, x.pin_hash into loja_id, l_hash from rede.lojas x where x.slug = lower(trim(coalesce(p_slug, '')));
  if v <> '' and exists (select 1 from rede.config c where c.id = 1 and c.master_pin_hash = extensions.crypt(v, c.master_pin_hash)) then
    papel := 'master'; return;
  end if;
  if loja_id is not null and v <> '' and l_hash = extensions.crypt(v, l_hash) then
    papel := 'loja'; return;
  end if;
  insert into rede.login_fails (chave) values (k);
  delete from rede.login_fails where at < now() - interval '1 day';
  papel := 'pin';
end $$;

create or replace function rede.is_master(p_pin text)
 returns text language plpgsql security definer set search_path to ''
as $$ declare a record; begin a := rede.auth(null, p_pin); return case when a.papel = 'master' then 'ok' else a.papel end; end $$;

create or replace function rede.gen_code()
 returns text language plpgsql set search_path to ''
as $$
declare c text;
begin
  loop
    c := 'EDC-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from rede.participants p where p.code = c)
          and not exists (select 1 from roleta2.participants p where p.code = c);
  end loop;
  return c;
end $$;

/* ---------------- roleta da loja (chamadas pelo totem) ---------------- */

create or replace function public.rede_get_config(p_loja text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare l record; c record; pr jsonb; st text := 'ok';
begin
  select * into l from rede.lojas where slug = lower(trim(coalesce(p_loja, '')));
  if not found or not l.ativo then return jsonb_build_object('status', 'loja', 'prizes', '[]'::jsonb); end if;
  select * into c from rede.campanhas where id = l.campanha_id;
  if not found then st := 'campanha';
  elsif (c.inicio is not null and rede.hoje() < c.inicio) or (c.fim is not null and rede.hoje() > c.fim) then st := 'periodo';
  end if;
  select coalesce(jsonb_agg(x || jsonb_build_object('esgotado', rede.esgotado(x)) order by i), '[]'::jsonb) into pr
    from rede.loja_premios lp, jsonb_array_elements(lp.premios) with ordinality a(x, i)
    where lp.loja_id = l.id and lp.campanha_id = l.campanha_id;
  return jsonb_build_object(
    'status', st, 'loja', jsonb_build_object('slug', l.slug, 'nome', l.nome),
    'campanha', case when c.id is null then null else jsonb_build_object('nome', c.nome, 'inicio', c.inicio, 'fim', c.fim) end,
    'prizes', coalesce(pr, '[]'::jsonb), 'whatsapp', l.whatsapp, 'validity', coalesce(c.validade, 7),
    'limit', l.limite_aparelho, 'edita_premios', l.edita_premios,
    'mascot', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from rede.assets a where a.name = 'mascote'),
    'music', jsonb_build_object(
       'fundo', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from rede.assets a where a.name = 'musica_fundo'),
       'premio', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from rede.assets a where a.name = 'musica_premio')));
end $$;

create or replace function public.rede_get_asset(p_loja text, p_name text)
 returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object('mime', a.mime, 'b64', a.b64, 'v', (extract(epoch from a.updated_at) * 1000)::bigint::text)
  from rede.assets a where a.name = p_name
$$;

create or replace function public.rede_spin(p_loja text, p_name text, p_phone text, p_optin boolean)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  d text := rede.norm_phone(p_phone);
  l record; c record; prev record; prz jsonb; total numeric; n int; r numeric; acc numeric := 0;
  chosen text; chosen_i int; el record; cd text; t timestamptz;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then return jsonb_build_object('error', 'nome'); end if;
  if d is null or length(d) < 10 or length(d) > 11 then return jsonb_build_object('error', 'telefone'); end if;
  select * into l from rede.lojas where slug = lower(trim(coalesce(p_loja, '')));
  if not found or not l.ativo then return jsonb_build_object('error', 'loja'); end if;
  select * into c from rede.campanhas where id = l.campanha_id;
  if not found then return jsonb_build_object('error', 'campanha'); end if;
  if (c.inicio is not null and rede.hoje() < c.inicio) or (c.fim is not null and rede.hoje() > c.fim) then
    return jsonb_build_object('error', 'periodo');
  end if;

  if c.limite <> 'livre' then
    perform pg_advisory_xact_lock(hashtext('rede:' || c.id || ':' || case when c.limite = 'loja' then l.id::text else '*' end || ':' || d));
    select p.name, p.prize, p.code, p.created_at into prev from rede.participants p
      where p.campanha_id = c.id and p.phone_digits = d and (c.limite = 'rede' or p.loja_id = l.id)
      order by p.created_at limit 1;
    if found then
      return jsonb_build_object('error', 'repetido', 'name', prev.name, 'prize', prev.prize, 'code', prev.code, 'date', prev.created_at);
    end if;
  end if;

  -- trava a lista de prêmios da loja para o estoque não passar do limite
  select lp.premios into prz from rede.loja_premios lp where lp.loja_id = l.id and lp.campanha_id = c.id for update;
  if prz is null then return jsonb_build_object('error', 'config'); end if;
  select coalesce(sum(greatest(0, coalesce((x->>'weight')::numeric, 0))), 0), count(*) into total, n
    from jsonb_array_elements(prz) x
    where coalesce((x->>'active')::boolean, false) and length(trim(coalesce(x->>'label', ''))) > 0 and not rede.esgotado(x);
  if n < 1 then return jsonb_build_object('error', 'config'); end if;
  r := random() * total;
  for el in select x, (i - 1)::int as i from jsonb_array_elements(prz) with ordinality as a(x, i)
            where coalesce((x->>'active')::boolean, false) and length(trim(coalesce(x->>'label', ''))) > 0 and not rede.esgotado(x)
            order by i loop
    acc := acc + greatest(0, coalesce((el.x->>'weight')::numeric, 0));
    chosen := el.x->>'label'; chosen_i := el.i;
    exit when total > 0 and r < acc;
  end loop;
  if total <= 0 then
    select x->>'label', (i - 1)::int into chosen, chosen_i from jsonb_array_elements(prz) with ordinality a(x, i)
      where coalesce((x->>'active')::boolean, false) and length(trim(coalesce(x->>'label', ''))) > 0 and not rede.esgotado(x)
      order by random() limit 1;
  end if;

  update rede.loja_premios set premios = jsonb_set(premios, array[chosen_i::text, 'saidos'],
           to_jsonb(coalesce((premios->chosen_i->>'saidos')::int, 0) + 1))
    where loja_id = l.id and campanha_id = c.id;

  cd := rede.gen_code();
  insert into rede.participants (loja_id, campanha_id, name, phone, phone_digits, prize, code, optin)
  values (l.id, c.id, left(trim(p_name), 60), left(trim(coalesce(p_phone, '')), 20), d, chosen, cd, coalesce(p_optin, false))
  returning created_at into t;
  return jsonb_build_object('ok', true, 'prize', chosen, 'code', cd, 'date', t);
end $$;

/* ---------------- painel da loja (gerente ou marketing na página da loja) ---------------- */

create or replace function public.rede_admin_login(p_loja text, p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel not in ('master', 'loja') then return jsonb_build_object('error', a.papel); end if;
  if a.loja_id is null then return jsonb_build_object('error', 'loja'); end if;
  return jsonb_build_object('ok', true, 'papel', a.papel,
    'edita_premios', a.papel = 'master' or (select edita_premios from rede.lojas where id = a.loja_id));
end $$;

create or replace function public.rede_admin_participants(p_loja text, p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel not in ('master', 'loja') then return jsonb_build_object('error', a.papel); end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('name', coalesce(p.name, ''), 'phone', coalesce(p.phone, ''), 'prize', p.prize,
             'code', p.code, 'optin', p.optin, 'date', p.created_at, 'campanha', c.nome) order by p.created_at desc)
    from (select * from rede.participants where loja_id = a.loja_id order by created_at desc limit 10000) p
    left join rede.campanhas c on c.id = p.campanha_id), '[]'::jsonb));
end $$;

create or replace function public.rede_admin_save(p_loja text, p_pin text, p_cfg jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record; l record; old jsonb; np jsonb;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel not in ('master', 'loja') then return jsonb_build_object('error', a.papel); end if;
  select * into l from rede.lojas where id = a.loja_id;
  update rede.lojas set
    whatsapp = left(regexp_replace(coalesce(p_cfg->>'whatsapp', whatsapp), '\D', '', 'g'), 15),
    limite_aparelho = coalesce((p_cfg->>'limit')::boolean, limite_aparelho)
  where id = l.id;
  if p_cfg ? 'prizes' and l.campanha_id is not null then
    select premios into old from rede.loja_premios where loja_id = l.id and campanha_id = l.campanha_id;
    np := rede.merge_premios(old, p_cfg->'prizes');
    if old is not null and np = old then return jsonb_build_object('ok', true); end if;
    if a.papel <> 'master' and not l.edita_premios then
      -- sem permissão: só aceita se os prêmios não mudaram (o painel sempre reenvia a lista)
      if old is null or rede.merge_premios(old, old) <> np then return jsonb_build_object('error', 'permissao'); end if;
      return jsonb_build_object('ok', true);
    end if;
    if jsonb_array_length(np) < 2 or jsonb_array_length(np) > 16 then return jsonb_build_object('error', 'premios'); end if;
    insert into rede.loja_premios (loja_id, campanha_id, premios) values (l.id, l.campanha_id, np)
    on conflict (loja_id, campanha_id) do update set premios = excluded.premios, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rede_admin_set_pin(p_loja text, p_pin text, p_new text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record; v text := upper(trim(coalesce(p_new, '')));
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel not in ('master', 'loja') then return jsonb_build_object('error', a.papel); end if;
  if v !~ '^[A-Z0-9-]{4,20}$' then return jsonb_build_object('error', 'formato'); end if;
  if exists (select 1 from rede.config c where c.master_pin_hash = extensions.crypt(v, c.master_pin_hash)) then
    return jsonb_build_object('error', 'formato');
  end if;
  update rede.lojas set pin_hash = extensions.crypt(v, extensions.gen_salt('bf')) where id = a.loja_id;
  return jsonb_build_object('ok', true);
end $$;

-- limpar lista, mascote e músicas: só o marketing
create or replace function public.rede_admin_clear(p_loja text, p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel <> 'master' then return jsonb_build_object('error', case when a.papel = 'loja' then 'permissao' else a.papel end); end if;
  delete from rede.participants where loja_id = a.loja_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rede_admin_set_asset(p_loja text, p_pin text, p_name text, p_mime text, p_b64 text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel <> 'master' then return jsonb_build_object('error', case when a.papel = 'loja' then 'permissao' else a.papel end); end if;
  if not ((p_name = 'mascote' and p_mime in ('video/mp4', 'video/webm'))
       or (p_name in ('musica_fundo', 'musica_premio') and p_mime in ('audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'))) then
    return jsonb_build_object('error', 'arquivo');
  end if;
  if p_b64 is null or length(p_b64) > 7200000 or p_b64 !~ '^[A-Za-z0-9+/=]+$' then return jsonb_build_object('error', 'tamanho'); end if;
  insert into rede.assets (name, mime, b64, updated_at) values (p_name, p_mime, p_b64, now())
  on conflict (name) do update set mime = excluded.mime, b64 = excluded.b64, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rede_admin_delete_asset(p_loja text, p_pin text, p_name text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel <> 'master' then return jsonb_build_object('error', case when a.papel = 'loja' then 'permissao' else a.papel end); end if;
  delete from rede.assets where name = p_name;
  return jsonb_build_object('ok', true);
end $$;

/* ---------------- painel do marketing (/admin, senha mestra) ---------------- */

create or replace function public.rede_m_login(p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$ declare st text := rede.is_master(p_pin); begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if; return jsonb_build_object('ok', true); end $$;

create or replace function public.rede_m_overview(p_pin text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  return jsonb_build_object(
    'hoje', rede.hoje(),
    'lojas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'slug', l.slug, 'nome', l.nome, 'whatsapp', l.whatsapp, 'ativo', l.ativo,
        'edita_premios', l.edita_premios, 'limite_aparelho', l.limite_aparelho, 'campanha_id', l.campanha_id,
        'premios', coalesce((select lp.premios from rede.loja_premios lp where lp.loja_id = l.id and lp.campanha_id = l.campanha_id), '[]'::jsonb),
        'giros_hoje', (select count(*) from rede.participants p where p.loja_id = l.id and (p.created_at at time zone 'America/Sao_Paulo')::date = rede.hoje()),
        'giros_campanha', (select count(*) from rede.participants p where p.loja_id = l.id and p.campanha_id = l.campanha_id),
        'giros_total', (select count(*) from rede.participants p where p.loja_id = l.id),
        'ultimo_giro', (select max(p.created_at) from rede.participants p where p.loja_id = l.id)
      ) order by l.nome) from rede.lojas l), '[]'::jsonb),
    'campanhas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'premios', c.premios, 'validade', c.validade, 'limite', c.limite,
        'inicio', c.inicio, 'fim', c.fim,
        'lojas', (select count(*) from rede.lojas l where l.campanha_id = c.id),
        'giros', (select count(*) from rede.participants p where p.campanha_id = c.id)
      ) order by c.id desc) from rede.campanhas c), '[]'::jsonb));
end $$;

create or replace function public.rede_m_save_loja(p_pin text, p_loja jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin); v_id int := nullif(p_loja->>'id', '')::int;
  v_slug text := lower(trim(coalesce(p_loja->>'slug', ''))); v_pin text := upper(trim(coalesce(p_loja->>'pin', '')));
  v_camp int := nullif(p_loja->>'campanha_id', '')::int; old_camp int; cp jsonb;
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' or v_slug in ('admin', 'api', 'index', 'app') then return jsonb_build_object('error', 'slug'); end if;
  if length(trim(coalesce(p_loja->>'nome', ''))) < 2 then return jsonb_build_object('error', 'nome'); end if;
  if v_pin <> '' and v_pin !~ '^[A-Z0-9-]{4,20}$' then return jsonb_build_object('error', 'formato'); end if;
  if exists (select 1 from rede.lojas where slug = v_slug and id is distinct from v_id) then return jsonb_build_object('error', 'slug_usado'); end if;
  if v_camp is not null and not exists (select 1 from rede.campanhas where id = v_camp) then v_camp := null; end if;
  if v_id is null then
    if v_pin = '' then return jsonb_build_object('error', 'formato'); end if;
    insert into rede.lojas (slug, nome, whatsapp, pin_hash, edita_premios, limite_aparelho, ativo, campanha_id)
    values (v_slug, trim(p_loja->>'nome'), left(regexp_replace(coalesce(p_loja->>'whatsapp', ''), '\D', '', 'g'), 15),
            extensions.crypt(v_pin, extensions.gen_salt('bf')), coalesce((p_loja->>'edita_premios')::boolean, false),
            coalesce((p_loja->>'limite_aparelho')::boolean, false), coalesce((p_loja->>'ativo')::boolean, true), v_camp)
    returning id into v_id;
  else
    select campanha_id into old_camp from rede.lojas where id = v_id;
    if not found then return jsonb_build_object('error', 'loja'); end if;
    update rede.lojas set slug = v_slug, nome = trim(p_loja->>'nome'),
      whatsapp = left(regexp_replace(coalesce(p_loja->>'whatsapp', ''), '\D', '', 'g'), 15),
      edita_premios = coalesce((p_loja->>'edita_premios')::boolean, edita_premios),
      limite_aparelho = coalesce((p_loja->>'limite_aparelho')::boolean, limite_aparelho),
      ativo = coalesce((p_loja->>'ativo')::boolean, ativo),
      campanha_id = v_camp,
      pin_hash = case when v_pin <> '' then extensions.crypt(v_pin, extensions.gen_salt('bf')) else pin_hash end
    where id = v_id;
  end if;
  -- loja entrou numa campanha sem prêmios próprios ainda: copia os prêmios padrão da campanha
  if v_camp is not null then
    select premios into cp from rede.campanhas where id = v_camp;
    insert into rede.loja_premios (loja_id, campanha_id, premios) values (v_id, v_camp, rede.merge_premios('[]', cp))
    on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.rede_m_save_campanha(p_pin text, p_c jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin); v_id int := nullif(p_c->>'id', '')::int; pr jsonb;
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  if length(trim(coalesce(p_c->>'nome', ''))) < 2 then return jsonb_build_object('error', 'nome'); end if;
  pr := rede.merge_premios('[]', p_c->'premios');
  if jsonb_array_length(pr) < 2 or jsonb_array_length(pr) > 16 then return jsonb_build_object('error', 'premios'); end if;
  if coalesce(p_c->>'limite', 'rede') not in ('rede', 'loja', 'livre') then return jsonb_build_object('error', 'limite'); end if;
  if v_id is null then
    insert into rede.campanhas (nome, premios, validade, limite, inicio, fim)
    values (trim(p_c->>'nome'), pr, least(90, greatest(1, coalesce((p_c->>'validade')::int, 7))), coalesce(p_c->>'limite', 'rede'),
            nullif(p_c->>'inicio', '')::date, nullif(p_c->>'fim', '')::date)
    returning id into v_id;
  else
    update rede.campanhas set nome = trim(p_c->>'nome'), premios = pr,
      validade = least(90, greatest(1, coalesce((p_c->>'validade')::int, 7))), limite = coalesce(p_c->>'limite', 'rede'),
      inicio = nullif(p_c->>'inicio', '')::date, fim = nullif(p_c->>'fim', '')::date
    where id = v_id;
    if not found then return jsonb_build_object('error', 'campanha'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- coloca a campanha nas lojas escolhidas; com p_substituir, os prêmios dessas lojas voltam ao padrão da campanha
create or replace function public.rede_m_aplicar_campanha(p_pin text, p_campanha_id int, p_lojas int[], p_substituir boolean)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin); cp jsonb; n int;
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  select premios into cp from rede.campanhas where id = p_campanha_id;
  if cp is null then return jsonb_build_object('error', 'campanha'); end if;
  update rede.lojas set campanha_id = p_campanha_id where id = any(p_lojas);
  get diagnostics n = row_count;
  insert into rede.loja_premios (loja_id, campanha_id, premios)
  select l.id, p_campanha_id, rede.merge_premios('[]', cp) from rede.lojas l where l.id = any(p_lojas)
  on conflict (loja_id, campanha_id) do update set
    premios = case when p_substituir then rede.merge_premios(rede.loja_premios.premios, cp) else rede.loja_premios.premios end,
    updated_at = now();
  return jsonb_build_object('ok', true, 'lojas', n);
end $$;

create or replace function public.rede_m_save_premios(p_pin text, p_loja_id int, p_premios jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin); c int; old jsonb; np jsonb;
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  select campanha_id into c from rede.lojas where id = p_loja_id;
  if c is null then return jsonb_build_object('error', 'campanha'); end if;
  select premios into old from rede.loja_premios where loja_id = p_loja_id and campanha_id = c;
  np := rede.merge_premios(old, p_premios);
  if jsonb_array_length(np) < 2 or jsonb_array_length(np) > 16 then return jsonb_build_object('error', 'premios'); end if;
  insert into rede.loja_premios (loja_id, campanha_id, premios) values (p_loja_id, c, np)
  on conflict (loja_id, campanha_id) do update set premios = excluded.premios, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rede_m_leads(p_pin text, p_loja_id int, p_campanha_id int, p_desde date, p_ate date)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin);
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('loja', l.nome, 'campanha', c.nome, 'name', coalesce(p.name, ''), 'phone', coalesce(p.phone, ''),
             'prize', p.prize, 'code', p.code, 'optin', p.optin, 'date', p.created_at) order by p.created_at desc)
    from (select * from rede.participants p
          where (p_loja_id is null or p.loja_id = p_loja_id) and (p_campanha_id is null or p.campanha_id = p_campanha_id)
            and (p_desde is null or (p.created_at at time zone 'America/Sao_Paulo')::date >= p_desde)
            and (p_ate is null or (p.created_at at time zone 'America/Sao_Paulo')::date <= p_ate)
          order by p.created_at desc limit 20000) p
    join rede.lojas l on l.id = p.loja_id left join rede.campanhas c on c.id = p.campanha_id), '[]'::jsonb));
end $$;

create or replace function public.rede_m_set_master_pin(p_pin text, p_new text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st text := rede.is_master(p_pin); v text := upper(trim(coalesce(p_new, '')));
begin
  if st <> 'ok' then return jsonb_build_object('error', st); end if;
  if v !~ '^[A-Z0-9-]{6,20}$' then return jsonb_build_object('error', 'formato'); end if;
  update rede.config set master_pin_hash = extensions.crypt(v, extensions.gen_salt('bf')), updated_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;

/* ---------------- permissões ---------------- */
revoke execute on all functions in schema rede from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'rede\_%' loop
    execute format('revoke execute on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
