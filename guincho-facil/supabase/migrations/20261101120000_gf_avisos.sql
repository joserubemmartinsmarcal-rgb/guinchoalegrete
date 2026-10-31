-- Avisos do GF: lista no app (sininho) e aviso no celular (Web Push).
-- Os avisos nascem dos eventos que já existem (gf_eventos) e das mudanças de
-- situação da antecipação; o envio ao celular é feito pela função "gf-avisos"
-- (Edge Function), chamada pelo banco via pg_net. Se o envio falhar, o aviso
-- continua na lista do app e o fluxo do pedido não é afetado.
-- Só adiciona objetos novos; nada existente muda.

create extension if not exists pg_net;

create table if not exists public.gf_avisos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.gf_perfis(id) on delete cascade,
  tipo text not null,
  titulo text not null check (char_length(titulo) <= 120),
  corpo text check (coalesce(char_length(corpo),0) <= 300),
  url text check (url is null or url like '#%'),
  pedido_id uuid references public.gf_pedidos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  lido_em timestamptz,
  enviado_em timestamptz
);
create index if not exists gf_avisos_user_idx on public.gf_avisos(user_id, criado_em desc);

create table if not exists public.gf_push (
  endpoint text primary key check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  user_id uuid not null references public.gf_perfis(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists gf_push_user_idx on public.gf_push(user_id);

-- configuração interna (endereço da função, segredo compartilhado, chave pública)
create table if not exists public.gf__config (chave text primary key, valor text not null);

alter table public.gf_avisos enable row level security;
alter table public.gf_push enable row level security;
alter table public.gf__config enable row level security;
drop policy if exists gf_avisos_sel on public.gf_avisos;
create policy gf_avisos_sel on public.gf_avisos for select to authenticated using (user_id = auth.uid());
revoke all on public.gf_avisos, public.gf_push, public.gf__config from anon, authenticated;
grant select on public.gf_avisos to authenticated;

-- cria o aviso e pede o envio ao celular (sem nunca quebrar quem chamou)
create or replace function public.gf__avisar(p_user uuid, p_tipo text, p_titulo text, p_corpo text, p_url text, p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_url text; v_seg text;
begin
  if p_user is null then return; end if;
  insert into public.gf_avisos(user_id, tipo, titulo, corpo, url, pedido_id)
  values (p_user, p_tipo, left(p_titulo, 120), left(p_corpo, 300), p_url, p_pedido) returning id into v_id;
  select valor into v_url from public.gf__config where chave = 'avisos_url';
  select valor into v_seg from public.gf__config where chave = 'avisos_segredo';
  if v_url is null or v_seg is null or not exists (select 1 from public.gf_push where user_id = p_user) then return; end if;
  begin
    perform net.http_post(url := v_url, body := jsonb_build_object('aviso_id', v_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-gf-segredo', v_seg));
  exception when others then null; -- o aviso fica na lista mesmo sem o envio
  end;
end $$;

create or replace function public.gf__rotulo(p_status text) returns text
language sql immutable set search_path = public as $$
  select case p_status when 'aceito' then 'Guincheiro escolhido' when 'a_caminho' then 'Guincheiro a caminho'
    when 'no_local' then 'Guincheiro no local' when 'em_transporte' then 'Veículo em transporte'
    when 'concluido' then 'Atendimento concluído' when 'cancelado' then 'Pedido cancelado' else p_status end
$$;

-- eventos do pedido → avisos para as pessoas certas
create or replace function public.gf__avisos_do_evento() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.gf_pedidos; v_trajeto text; v_url text; r record; v_outro uuid;
begin
  select * into p from public.gf_pedidos where id = new.pedido_id;
  if not found then return new; end if;
  v_trajeto := p.origem || ' › ' || p.destino; v_url := '#pedido/' || p.id;

  if new.tipo = 'criado' then
    for r in select id from public.gf_perfis
             where tipo = 'guincheiro' and aprovacao = 'aprovado' and disponivel and id <> p.autor_id limit 300 loop
      perform public.gf__avisar(r.id, 'pedido_novo', case when p.tipo = 'repasse' then 'Repasse de colega: ' else 'Novo pedido: ' end || v_trajeto,
        p.veiculo, v_url, p.id);
    end loop;
  elsif new.tipo = 'proposta' then
    perform public.gf__avisar(p.autor_id, 'proposta', 'Nova proposta para ' || v_trajeto, new.detalhe, v_url, p.id);
  elsif new.tipo = 'status' and new.status_novo = 'aceito' then
    perform public.gf__avisar(p.prestador_id, 'escolhido', 'Sua proposta foi escolhida', v_trajeto || ' · combine os detalhes pelo WhatsApp', v_url, p.id);
  elsif new.tipo = 'status' and new.status_novo in ('a_caminho', 'no_local', 'em_transporte', 'concluido', 'cancelado') then
    -- avisa quem não fez a mudança: o cliente, ou o guincheiro quando foi o cliente
    for v_outro in select x from unnest(array[p.autor_id, p.prestador_id]) x where x is not null and x is distinct from new.autor_id loop
      perform public.gf__avisar(v_outro, 'status', public.gf__rotulo(new.status_novo), v_trajeto, v_url, p.id);
    end loop;
  elsif new.tipo = 'desistencia' then
    perform public.gf__avisar(p.autor_id, 'desistencia', 'O guincheiro desistiu do atendimento',
      v_trajeto || ' · seu pedido voltou a receber propostas', v_url, p.id);
  end if;
  return new;
exception when others then
  return new; -- aviso nunca bloqueia o pedido
end $$;

drop trigger if exists gf_eventos_avisos on public.gf_eventos;
create trigger gf_eventos_avisos after insert on public.gf_eventos for each row execute function public.gf__avisos_do_evento();

-- antecipação: admin sabe do pedido novo; guincheiro sabe da resposta
create or replace function public.gf__avisos_antecipacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_valor text := public.gf__brl(new.valor);
begin
  if tg_op = 'INSERT' then
    for r in select id from public.gf_perfis where is_admin loop
      perform public.gf__avisar(r.id, 'antecipacao_nova', 'Novo pedido de antecipação', v_valor || ' · ' || new.pagador_nome, '#admin/antecipacoes', null);
    end loop;
  elsif new.status is distinct from old.status and new.status in ('enviado', 'aprovado', 'recusado') then
    perform public.gf__avisar(new.guincheiro_id, 'antecipacao',
      case new.status when 'enviado' then 'Sua antecipação foi enviada à JK Invest'
        when 'aprovado' then 'Antecipação aprovada' else 'Antecipação não aprovada' end,
      v_valor || coalesce(' · ' || new.nota_admin, ''), '#servicos/antecipar', null);
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists gf_antecipacoes_avisos on public.gf_antecipacoes;
create trigger gf_antecipacoes_avisos after insert or update of status on public.gf_antecipacoes
  for each row execute function public.gf__avisos_antecipacao();

-- ───────── funções para o app ─────────
create or replace function public.gf_push_chave() returns text
language sql stable security definer set search_path = public as $$
  select valor from public.gf__config where chave = 'vapid_publica'
$$;

create or replace function public.gf_registrar_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.gf_perfis where id = auth.uid()) then perform public.gf__erro('Complete seu perfil primeiro.'); end if;
  insert into public.gf_push(endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, atualizado_em = now();
exception when check_violation then
  perform public.gf__erro('Não foi possível ligar os avisos neste aparelho.');
end $$;

create or replace function public.gf_remover_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.gf_push where endpoint = p_endpoint and user_id = auth.uid()
$$;

create or replace function public.gf_marcar_avisos_lidos() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.gf_avisos set lido_em = now() where user_id = auth.uid() and lido_em is null;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.gf_aviso_teste() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.gf_perfis where id = auth.uid()) then perform public.gf__erro('Complete seu perfil primeiro.'); end if;
  if exists (select 1 from public.gf_avisos where user_id = auth.uid() and tipo = 'teste' and criado_em > now() - interval '1 minute') then
    perform public.gf__erro('Aguarde um minuto para testar de novo.');
  end if;
  perform public.gf__avisar(auth.uid(), 'teste', 'Avisos ligados', 'Você vai receber aqui as novidades dos seus pedidos.', '#avisos', null);
end $$;

revoke all on function public.gf__avisar(uuid, text, text, text, text, uuid), public.gf__rotulo(text),
  public.gf__avisos_do_evento(), public.gf__avisos_antecipacao() from public, anon, authenticated;
revoke all on function public.gf_push_chave(), public.gf_registrar_push(text, text, text, text), public.gf_remover_push(text),
  public.gf_marcar_avisos_lidos(), public.gf_aviso_teste() from public, anon;
grant execute on function public.gf_push_chave(), public.gf_registrar_push(text, text, text, text), public.gf_remover_push(text),
  public.gf_marcar_avisos_lidos(), public.gf_aviso_teste() to authenticated;
