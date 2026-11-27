-- Vídeo de propaganda: enviado no /admin (asset "propaganda") e exibido em tela cheia nas roletas,
-- em ciclo: vídeo -> roleta por 5 minutos -> vídeo -> ...

create or replace function public.rede_admin_set_asset(p_loja text, p_pin text, p_name text, p_mime text, p_b64 text)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare a record;
begin
  a := rede.auth(p_loja, p_pin);
  if a.papel <> 'master' then return jsonb_build_object('error', case when a.papel = 'loja' then 'permissao' else a.papel end); end if;
  if not ((p_name in ('mascote', 'propaganda') and p_mime in ('video/mp4', 'video/webm'))
       or (p_name in ('musica_fundo', 'musica_premio') and p_mime in ('audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'))) then
    return jsonb_build_object('error', 'arquivo');
  end if;
  if p_b64 is null or length(p_b64) > 7200000 or p_b64 !~ '^[A-Za-z0-9+/=]+$' then return jsonb_build_object('error', 'tamanho'); end if;
  insert into rede.assets (name, mime, b64, updated_at) values (p_name, p_mime, p_b64, now())
  on conflict (name) do update set mime = excluded.mime, b64 = excluded.b64, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

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
    'propaganda', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from rede.assets a where a.name = 'propaganda'),
    'music', jsonb_build_object(
       'fundo', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from rede.assets a where a.name = 'musica_fundo'),
       'premio', (select (extract(epoch from a.updated_at) * 1000)::bigint::text from rede.assets a where a.name = 'musica_premio')));
end $$;
