-- Guincho Fácil · v2 — fluxo de atendimento controlado no servidor
-- Corrige: WhatsApp exposto a qualquer usuário, guincheiro aceitando a própria
-- proposta, cliente alterando valor de proposta, status de pedido livre e
-- cadastro de guincheiro sem aprovação. Acrescenta: andamento do atendimento,
-- histórico (gf_eventos), ocorrências, vagas de ida/retorno, disponibilidade,
-- capacidade, raio de atuação e indicadores para a administração.
-- Regra geral: o app só LÊ tabelas; toda escrita relevante passa por funções
-- (security definer) que validam papel, estado e dados.

-- ───────────────────────── perfis ─────────────────────────
alter table public.gf_perfis
  add column if not exists aprovacao text not null default 'pendente',
  add column if not exists aprovacao_obs text,
  add column if not exists capacidade text,
  add column if not exists raio_km int not null default 100,
  add column if not exists disponivel boolean not null default false,
  add column if not exists atualizado_em timestamptz not null default now();

alter table public.gf_perfis
  add constraint gf_perfis_aprovacao_chk check (aprovacao in ('pendente','aprovado','recusado','bloqueado')),
  add constraint gf_perfis_capacidade_chk check (capacidade is null or capacidade in ('leve','utilitario','pesado','extra_pesado')),
  add constraint gf_perfis_raio_chk check (raio_km between 10 and 1000),
  add constraint gf_perfis_nome_chk check (char_length(btrim(nome)) between 2 and 80),
  add constraint gf_perfis_whatsapp_chk check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  add constraint gf_perfis_placa_chk check (placa is null or placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');

-- quem não é guincheiro não passa por aprovação
update public.gf_perfis set aprovacao = 'aprovado' where tipo <> 'guincheiro';

-- ───────────────────────── pedidos ─────────────────────────
alter table public.gf_pedidos drop constraint if exists gf_pedidos_status_check;
update public.gf_pedidos set status = 'aceito' where status = 'fechado';

alter table public.gf_pedidos
  add column if not exists veiculo_tipo text not null default 'carro',
  add column if not exists placa text,
  add column if not exists prestador_id uuid references public.gf_perfis(id) on delete set null,
  add column if not exists proposta_aceita_id uuid,
  add column if not exists valor_combinado numeric(10,2),
  add column if not exists pagamento_status text not null default 'fora_da_plataforma',
  add column if not exists cancelado_motivo text,
  add column if not exists cancelado_por uuid,
  add column if not exists avaliacao_comentario text,
  add column if not exists aceito_em timestamptz,
  add column if not exists concluido_em timestamptz,
  add column if not exists atualizado_em timestamptz not null default now();

alter table public.gf_pedidos
  add constraint gf_pedidos_status_check check (status in ('aberto','aceito','a_caminho','no_local','em_transporte','concluido','cancelado')),
  add constraint gf_pedidos_veiculo_tipo_chk check (veiculo_tipo in ('carro','moto','utilitario','caminhonete','caminhao','outro')),
  add constraint gf_pedidos_condicao_chk check (condicao in ('anda','nao_anda','acidentado')),
  add constraint gf_pedidos_placa_chk check (placa is null or placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  add constraint gf_pedidos_pagamento_chk check (pagamento_status in ('fora_da_plataforma','processado')),
  add constraint gf_pedidos_textos_chk check (
    char_length(btrim(origem)) between 2 and 80 and char_length(btrim(destino)) between 2 and 80
    and char_length(btrim(veiculo)) between 2 and 80 and coalesce(char_length(obs),0) <= 1000);

create index if not exists gf_pedidos_prestador_idx on public.gf_pedidos(prestador_id);
create index if not exists gf_pedidos_autor_idx on public.gf_pedidos(autor_id);

-- ───────────────────────── propostas ─────────────────────────
alter table public.gf_propostas
  add column if not exists atualizado_em timestamptz not null default now();
alter table public.gf_propostas
  add constraint gf_propostas_valor_chk check (valor between 1 and 100000),
  add constraint gf_propostas_textos_chk check (coalesce(char_length(prazo),0) <= 80 and coalesce(char_length(mensagem),0) <= 500);
create index if not exists gf_propostas_guincheiro_idx on public.gf_propostas(guincheiro_id);

-- ───────────────────────── retornos (rotas e vagas) ─────────────────────────
alter table public.gf_retornos
  add column if not exists sentido text not null default 'retorno',
  add column if not exists vagas int not null default 1;
alter table public.gf_retornos
  add constraint gf_retornos_sentido_chk check (sentido in ('ida','retorno')),
  add constraint gf_retornos_vagas_chk check (vagas between 1 and 12),
  add constraint gf_retornos_textos_chk check (
    char_length(btrim(origem)) between 2 and 80 and char_length(btrim(destino)) between 2 and 80
    and coalesce(char_length(obs),0) <= 500);

-- ───────────────────────── lista de espera (formulário público) ─────────────────────────
alter table public.gf_lista_espera
  add constraint gf_lista_textos_chk check (
    perfil in ('guincheiro','cliente','empresa')
    and char_length(btrim(nome)) between 2 and 80 and char_length(btrim(cidade)) between 2 and 80
    and whatsapp ~ '^[0-9]{10,13}$'
    and coalesce(char_length(rota),0) <= 120 and coalesce(char_length(equipamento),0) <= 40);

-- ───────────────────────── histórico e ocorrências ─────────────────────────
create table if not exists public.gf_eventos (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.gf_pedidos(id) on delete cascade,
  autor_id uuid references public.gf_perfis(id) on delete set null,
  tipo text not null,
  status_anterior text,
  status_novo text,
  detalhe text,
  criado_em timestamptz not null default now()
);
create index if not exists gf_eventos_pedido_idx on public.gf_eventos(pedido_id, criado_em);

create table if not exists public.gf_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.gf_pedidos(id) on delete set null,
  autor_id uuid not null references public.gf_perfis(id) on delete cascade,
  tipo text not null check (tipo in ('servico','cobranca','cadastro','seguranca','outro')),
  descricao text not null check (char_length(btrim(descricao)) between 10 and 2000),
  status text not null default 'aberta' check (status in ('aberta','em_analise','resolvida')),
  resposta text check (coalesce(char_length(resposta),0) <= 2000),
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists gf_ocorrencias_status_idx on public.gf_ocorrencias(status);

alter table public.gf_eventos enable row level security;
alter table public.gf_ocorrencias enable row level security;

-- ───────────────────────── funções auxiliares (usadas nas políticas) ─────────────────────────
create or replace function public.gf_eh_guincheiro_aprovado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_perfis where id = auth.uid() and tipo = 'guincheiro' and aprovacao = 'aprovado')
$$;

create or replace function public.gf_eh_autor_pedido(p_pedido uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_pedidos where id = p_pedido and autor_id = auth.uid())
$$;

create or replace function public.gf_tem_proposta(p_pedido uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_propostas where pedido_id = p_pedido and guincheiro_id = auth.uid())
$$;

create or replace function public.gf_participa_pedido(p_pedido uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_pedidos where id = p_pedido and (autor_id = auth.uid() or prestador_id = auth.uid()))
      or public.gf_is_admin()
$$;

-- nome/cidade de outro usuário só aparecem para quem tem relação com ele
create or replace function public.gf_pode_ver_perfil(p_perfil uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_perfil = auth.uid()
      or public.gf_is_admin()
      or exists (select 1 from public.gf_perfis where id = p_perfil and tipo = 'guincheiro' and aprovacao = 'aprovado')
      or exists (select 1 from public.gf_pedidos d where d.autor_id = p_perfil
                   and (d.prestador_id = auth.uid() or (d.status = 'aberto' and public.gf_eh_guincheiro_aprovado())
                        or exists (select 1 from public.gf_propostas x where x.pedido_id = d.id and x.guincheiro_id = auth.uid())))
$$;

-- regras de transição de status (fonte única de verdade, também espelhada no app)
create or replace function public.gf_transicao_valida(p_atual text, p_novo text, p_papel text) returns boolean
language sql immutable as $$
  select case p_papel
    when 'prestador' then (p_atual, p_novo) in (('aceito','a_caminho'),('a_caminho','no_local'),('no_local','em_transporte'),('em_transporte','concluido'))
    when 'cliente'   then (p_atual, p_novo) in (('em_transporte','concluido'))
    else false end
$$;

create or replace function public.gf__evento(p_pedido uuid, p_tipo text, p_ant text, p_novo text, p_det text) returns void
language sql security definer set search_path = public as $$
  insert into public.gf_eventos(pedido_id, autor_id, tipo, status_anterior, status_novo, detalhe)
  values (p_pedido, auth.uid(), p_tipo, p_ant, p_novo, left(p_det, 500))
$$;

create or replace function public.gf__erro(p_msg text) returns void
language plpgsql as $$ begin raise exception using message = p_msg, errcode = 'P0001'; end $$;

create or replace function public.gf__brl(v numeric) returns text
language sql immutable as $$ select 'R$ ' || replace(to_char(v, 'FM9999990.00'), '.', ',') $$;

create or replace function public.gf__placa(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '') $$;

-- ───────────────────────── políticas ─────────────────────────
drop policy if exists gf_perfis_sel on public.gf_perfis;
drop policy if exists gf_perfis_ins on public.gf_perfis;
drop policy if exists gf_perfis_upd on public.gf_perfis;
create policy gf_perfis_sel on public.gf_perfis for select to authenticated using (public.gf_pode_ver_perfil(id));

drop policy if exists gf_ped_sel on public.gf_pedidos;
drop policy if exists gf_ped_ins on public.gf_pedidos;
drop policy if exists gf_ped_upd on public.gf_pedidos;
create policy gf_ped_sel on public.gf_pedidos for select to authenticated using (
  autor_id = auth.uid() or prestador_id = auth.uid() or public.gf_is_admin()
  or (status = 'aberto' and public.gf_eh_guincheiro_aprovado())
  or public.gf_tem_proposta(id));
-- o gatilho gf__pedido_antes_inserir força autor, status inicial e zera campos sensíveis
create policy gf_ped_ins on public.gf_pedidos for insert to authenticated with check (autor_id = auth.uid());

drop policy if exists gf_prop_sel on public.gf_propostas;
drop policy if exists gf_prop_ins on public.gf_propostas;
drop policy if exists gf_prop_upd on public.gf_propostas;
create policy gf_prop_sel on public.gf_propostas for select to authenticated using (
  guincheiro_id = auth.uid() or public.gf_eh_autor_pedido(pedido_id) or public.gf_is_admin());

drop policy if exists gf_ret_sel on public.gf_retornos;
drop policy if exists gf_ret_ins on public.gf_retornos;
drop policy if exists gf_ret_upd on public.gf_retornos;
drop policy if exists gf_ret_del on public.gf_retornos;
create policy gf_ret_sel on public.gf_retornos for select to authenticated using (
  guincheiro_id = auth.uid() or public.gf_eh_guincheiro_aprovado() or public.gf_is_admin());
create policy gf_ret_ins on public.gf_retornos for insert to authenticated with check (
  guincheiro_id = auth.uid() and public.gf_eh_guincheiro_aprovado());
create policy gf_ret_upd on public.gf_retornos for update to authenticated using (guincheiro_id = auth.uid())
  with check (guincheiro_id = auth.uid() and public.gf_eh_guincheiro_aprovado());
create policy gf_ret_del on public.gf_retornos for delete to authenticated using (guincheiro_id = auth.uid());

create policy gf_eventos_sel on public.gf_eventos for select to authenticated using (public.gf_participa_pedido(pedido_id));
create policy gf_ocor_sel on public.gf_ocorrencias for select to authenticated using (autor_id = auth.uid() or public.gf_is_admin());

-- ───────────────────────── permissões de tabela ─────────────────────────
revoke all on public.gf_perfis, public.gf_pedidos, public.gf_propostas, public.gf_retornos,
  public.gf_eventos, public.gf_ocorrencias from anon, authenticated;
revoke all on public.gf_lista_espera from anon, authenticated;

-- WhatsApp e placa do perfil NÃO são legíveis pela API: só via gf_meu_perfil/gf_contato/admin
grant select (id, tipo, nome, empresa, cidade, equipamento, capacidade, raio_km, disponivel, aprovacao, criado_em)
  on public.gf_perfis to authenticated;
grant select, insert on public.gf_pedidos to authenticated;
grant select on public.gf_propostas, public.gf_eventos, public.gf_ocorrencias to authenticated;
grant select, insert, update, delete on public.gf_retornos to authenticated;
grant insert on public.gf_lista_espera to anon, authenticated;
grant select on public.gf_lista_espera to authenticated;

-- ───────────────────────── gatilhos ─────────────────────────
create or replace function public.gf__pedido_antes_inserir() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_perfil public.gf_perfis;
begin
  if auth.uid() is not null then new.autor_id := auth.uid(); end if;
  select * into v_perfil from public.gf_perfis where id = new.autor_id;
  if not found then perform public.gf__erro('Complete seu perfil antes de pedir.'); end if;
  if v_perfil.aprovacao = 'bloqueado' then perform public.gf__erro('Cadastro bloqueado. Fale com o suporte.'); end if;
  if new.tipo = 'repasse' and not (v_perfil.tipo = 'guincheiro' and v_perfil.aprovacao = 'aprovado') then
    perform public.gf__erro('Só guincheiros aprovados podem repassar serviços.');
  end if;
  new.origem := btrim(new.origem); new.destino := btrim(new.destino); new.veiculo := btrim(new.veiculo);
  if new.origem = new.destino then perform public.gf__erro('Origem e destino precisam ser diferentes.'); end if;
  new.placa := public.gf__placa(new.placa);
  new.status := 'aberto'; new.prestador_id := null; new.proposta_aceita_id := null; new.valor_combinado := null;
  new.pagamento_status := 'fora_da_plataforma'; new.nota := null; new.avaliacao_comentario := null;
  new.cancelado_motivo := null; new.cancelado_por := null; new.aceito_em := null; new.concluido_em := null;
  new.criado_em := now(); new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists gf_pedido_antes_inserir on public.gf_pedidos;
create trigger gf_pedido_antes_inserir before insert on public.gf_pedidos
  for each row execute function public.gf__pedido_antes_inserir();

create or replace function public.gf__pedido_depois_inserir() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.gf__evento(new.id, 'criado', null, 'aberto', new.origem || ' › ' || new.destino || ' · ' || new.veiculo);
  return new;
end $$;
drop trigger if exists gf_pedido_depois_inserir on public.gf_pedidos;
create trigger gf_pedido_depois_inserir after insert on public.gf_pedidos
  for each row execute function public.gf__pedido_depois_inserir();

create or replace function public.gf__retorno_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.guincheiro_id := auth.uid(); end if;
  new.origem := btrim(new.origem); new.destino := btrim(new.destino);
  if new.origem = new.destino then perform public.gf__erro('Origem e destino precisam ser diferentes.'); end if;
  if tg_op = 'INSERT' then new.status := 'ativo'; new.criado_em := now(); end if;
  return new;
end $$;
drop trigger if exists gf_retorno_antes on public.gf_retornos;
create trigger gf_retorno_antes before insert or update on public.gf_retornos
  for each row execute function public.gf__retorno_antes();

-- ───────────────────────── funções do app (RPC) ─────────────────────────
create or replace function public.gf_meu_perfil() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) from public.gf_perfis p where p.id = auth.uid()
$$;

create or replace function public.gf_salvar_perfil(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ant public.gf_perfis;
  v_tipo text := p->>'tipo';
  v_nome text := btrim(coalesce(p->>'nome',''));
  v_cidade text := btrim(coalesce(p->>'cidade',''));
  v_zap text := regexp_replace(coalesce(p->>'whatsapp',''), '\D', '', 'g');
  v_equip text := nullif(btrim(coalesce(p->>'equipamento','')), '');
  v_cap text := nullif(p->>'capacidade','');
  v_raio int := coalesce(nullif(p->>'raio_km','')::int, 100);
  v_placa text := public.gf__placa(p->>'placa');
  v_aprov text;
  v_out public.gf_perfis;
begin
  if v_uid is null then perform public.gf__erro('Entre na sua conta para continuar.'); end if;
  if v_tipo not in ('guincheiro','cliente','empresa') then perform public.gf__erro('Escolha como você vai usar o GF.'); end if;
  if char_length(v_nome) not between 2 and 80 then perform public.gf__erro('Informe seu nome.'); end if;
  if char_length(v_cidade) not between 2 and 80 then perform public.gf__erro('Informe sua cidade.'); end if;
  if v_zap !~ '^[0-9]{10,13}$' then perform public.gf__erro('WhatsApp incompleto. Use DDD + número.'); end if;
  if v_placa is not null and v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then perform public.gf__erro('Placa inválida. Use o padrão ABC1234 ou ABC1D23.'); end if;
  if v_tipo = 'guincheiro' then
    if v_equip is null or v_equip not in ('Plataforma','Asa-delta','Guincho pesado','Mais de um') then perform public.gf__erro('Escolha o equipamento.'); end if;
    if v_raio not between 10 and 1000 then perform public.gf__erro('Raio de atuação deve ficar entre 10 e 1000 km.'); end if;
  else
    v_equip := null; v_cap := null; v_placa := null;
  end if;

  select * into v_ant from public.gf_perfis where id = v_uid;
  if found then
    v_aprov := case when v_tipo = 'guincheiro' and v_ant.tipo <> 'guincheiro' then 'pendente'
                    when v_tipo <> 'guincheiro' and v_ant.aprovacao <> 'bloqueado' then 'aprovado'
                    else v_ant.aprovacao end;
    update public.gf_perfis set tipo = v_tipo, nome = v_nome, empresa = nullif(btrim(coalesce(p->>'empresa','')),''),
      cidade = v_cidade, whatsapp = v_zap, equipamento = v_equip, placa = v_placa, capacidade = v_cap,
      raio_km = v_raio, aprovacao = v_aprov,
      disponivel = case when v_tipo = 'guincheiro' and v_aprov = 'aprovado' then disponivel else false end,
      atualizado_em = now()
    where id = v_uid returning * into v_out;
  else
    insert into public.gf_perfis(id, tipo, nome, empresa, cidade, whatsapp, equipamento, placa, capacidade, raio_km, aprovacao)
    values (v_uid, v_tipo, v_nome, nullif(btrim(coalesce(p->>'empresa','')),''), v_cidade, v_zap, v_equip, v_placa, v_cap, v_raio,
            case when v_tipo = 'guincheiro' then 'pendente' else 'aprovado' end)
    returning * into v_out;
  end if;
  return to_jsonb(v_out);
end $$;

create or replace function public.gf_definir_disponivel(p_disponivel boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.gf_eh_guincheiro_aprovado() then perform public.gf__erro('Disponível apenas para guincheiros aprovados.'); end if;
  update public.gf_perfis set disponivel = coalesce(p_disponivel,false), atualizado_em = now() where id = auth.uid();
end $$;

create or replace function public.gf_enviar_proposta(p_pedido uuid, p_valor numeric, p_prazo text, p_mensagem text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_id uuid;
begin
  if not public.gf_eh_guincheiro_aprovado() then perform public.gf__erro('Seu cadastro de guincheiro ainda não foi aprovado.'); end if;
  select * into v_ped from public.gf_pedidos where id = p_pedido for update;
  if not found then perform public.gf__erro('Pedido não encontrado.'); end if;
  if v_ped.autor_id = auth.uid() then perform public.gf__erro('Você não pode mandar proposta no próprio pedido.'); end if;
  if v_ped.status <> 'aberto' then perform public.gf__erro('Este pedido não está mais aberto.'); end if;
  if p_valor is null or p_valor < 1 or p_valor > 100000 then perform public.gf__erro('Informe um valor entre R$ 1 e R$ 100.000.'); end if;
  insert into public.gf_propostas(pedido_id, guincheiro_id, valor, prazo, mensagem, status)
  values (p_pedido, auth.uid(), round(p_valor, 2), nullif(left(btrim(coalesce(p_prazo,'')),80),''), nullif(left(btrim(coalesce(p_mensagem,'')),500),''), 'enviada')
  on conflict (pedido_id, guincheiro_id) do update
    set valor = excluded.valor, prazo = excluded.prazo, mensagem = excluded.mensagem, status = 'enviada', atualizado_em = now()
  returning id into v_id;
  perform public.gf__evento(p_pedido, 'proposta', null, null, 'Proposta de ' || public.gf__brl(round(p_valor,2)));
  return v_id;
end $$;

create or replace function public.gf_retirar_proposta(p_proposta uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_pr public.gf_propostas;
begin
  select * into v_pr from public.gf_propostas where id = p_proposta and guincheiro_id = auth.uid() for update;
  if not found then perform public.gf__erro('Proposta não encontrada.'); end if;
  if v_pr.status <> 'enviada' then perform public.gf__erro('Só dá para retirar propostas que aguardam o cliente.'); end if;
  update public.gf_propostas set status = 'cancelada', atualizado_em = now() where id = p_proposta;
  perform public.gf__evento(v_pr.pedido_id, 'proposta_retirada', null, null, null);
end $$;

create or replace function public.gf_aceitar_proposta(p_proposta uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_pr public.gf_propostas; v_ped public.gf_pedidos;
begin
  select * into v_pr from public.gf_propostas where id = p_proposta;
  if not found then perform public.gf__erro('Proposta não encontrada.'); end if;
  select * into v_ped from public.gf_pedidos where id = v_pr.pedido_id for update;
  if v_ped.autor_id <> auth.uid() then perform public.gf__erro('Só quem fez o pedido pode aceitar propostas.'); end if;
  if v_ped.status <> 'aberto' then perform public.gf__erro('Este pedido não está mais aberto.'); end if;
  select * into v_pr from public.gf_propostas where id = p_proposta for update;
  if v_pr.status <> 'enviada' then perform public.gf__erro('Esta proposta não está mais disponível.'); end if;
  if not exists (select 1 from public.gf_perfis where id = v_pr.guincheiro_id and aprovacao = 'aprovado') then
    perform public.gf__erro('Este guincheiro não está mais ativo no GF.');
  end if;
  update public.gf_propostas set status = 'aceita', atualizado_em = now() where id = p_proposta;
  update public.gf_propostas set status = 'recusada', atualizado_em = now()
    where pedido_id = v_ped.id and id <> p_proposta and status = 'enviada';
  update public.gf_pedidos set status = 'aceito', prestador_id = v_pr.guincheiro_id, proposta_aceita_id = v_pr.id,
    valor_combinado = v_pr.valor, aceito_em = now(), atualizado_em = now() where id = v_ped.id;
  perform public.gf__evento(v_ped.id, 'status', 'aberto', 'aceito', 'Proposta aceita: ' || public.gf__brl(v_pr.valor));
end $$;

create or replace function public.gf_atualizar_status(p_pedido uuid, p_status text, p_detalhe text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_papel text;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido for update;
  if not found then perform public.gf__erro('Pedido não encontrado.'); end if;
  v_papel := case when v_ped.prestador_id = auth.uid() then 'prestador' when v_ped.autor_id = auth.uid() then 'cliente' end;
  if v_papel is null then perform public.gf__erro('Você não participa deste atendimento.'); end if;
  if not public.gf_transicao_valida(v_ped.status, p_status, v_papel) then
    perform public.gf__erro('Não é possível mudar de "' || v_ped.status || '" para "' || coalesce(p_status,'?') || '".');
  end if;
  update public.gf_pedidos set status = p_status, atualizado_em = now(),
    concluido_em = case when p_status = 'concluido' then now() else concluido_em end
  where id = p_pedido;
  perform public.gf__evento(p_pedido, 'status', v_ped.status, p_status, nullif(btrim(coalesce(p_detalhe,'')),''));
end $$;

create or replace function public.gf_cancelar_pedido(p_pedido uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_motivo text := nullif(btrim(coalesce(p_motivo,'')),'');
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido for update;
  if not found then perform public.gf__erro('Pedido não encontrado.'); end if;
  if v_ped.status in ('concluido','cancelado') then perform public.gf__erro('Este pedido já foi encerrado.'); end if;

  if v_ped.prestador_id = auth.uid() then
    -- desistência do guincheiro: o pedido volta para o mercado com as demais propostas
    if v_ped.status not in ('aceito','a_caminho') then perform public.gf__erro('Depois de chegar ao local, use "Abrir ocorrência".'); end if;
    if v_motivo is null then perform public.gf__erro('Informe o motivo da desistência.'); end if;
    update public.gf_propostas set status = 'cancelada', atualizado_em = now() where id = v_ped.proposta_aceita_id;
    update public.gf_propostas set status = 'enviada', atualizado_em = now() where pedido_id = p_pedido and status = 'recusada';
    update public.gf_pedidos set status = 'aberto', prestador_id = null, proposta_aceita_id = null, valor_combinado = null,
      aceito_em = null, atualizado_em = now() where id = p_pedido;
    perform public.gf__evento(p_pedido, 'desistencia', v_ped.status, 'aberto', v_motivo);
    return;
  end if;

  if v_ped.autor_id = auth.uid() then
    if v_ped.status not in ('aberto','aceito','a_caminho') then perform public.gf__erro('O veículo já está sendo atendido. Use "Abrir ocorrência".'); end if;
    if v_ped.status <> 'aberto' and v_motivo is null then perform public.gf__erro('Informe o motivo do cancelamento.'); end if;
  elsif not public.gf_is_admin() then
    perform public.gf__erro('Você não pode cancelar este pedido.');
  end if;

  update public.gf_propostas set status = case when status = 'aceita' then 'cancelada' else 'recusada' end, atualizado_em = now()
    where pedido_id = p_pedido and status in ('enviada','aceita');
  update public.gf_pedidos set status = 'cancelado', cancelado_motivo = v_motivo, cancelado_por = auth.uid(), atualizado_em = now()
    where id = p_pedido;
  perform public.gf__evento(p_pedido, 'status', v_ped.status, 'cancelado', v_motivo);
end $$;

create or replace function public.gf_avaliar(p_pedido uuid, p_nota int, p_comentario text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido for update;
  if not found or v_ped.autor_id <> auth.uid() then perform public.gf__erro('Pedido não encontrado.'); end if;
  if v_ped.status <> 'concluido' then perform public.gf__erro('A avaliação abre quando o serviço é concluído.'); end if;
  if v_ped.nota is not null then perform public.gf__erro('Este serviço já foi avaliado.'); end if;
  if p_nota is null or p_nota not between 1 and 5 then perform public.gf__erro('Escolha de 1 a 5 estrelas.'); end if;
  update public.gf_pedidos set nota = p_nota, avaliacao_comentario = nullif(left(btrim(coalesce(p_comentario,'')),500),''),
    atualizado_em = now() where id = p_pedido;
  perform public.gf__evento(p_pedido, 'avaliacao', null, null, p_nota || ' estrela(s)');
end $$;

-- contato liberado só entre as duas partes de um atendimento aceito
create or replace function public.gf_contato(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_outro uuid; v_p public.gf_perfis;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido;
  if not found or v_ped.prestador_id is null or v_ped.status in ('aberto','cancelado') then
    perform public.gf__erro('O contato aparece depois que a proposta é aceita.');
  end if;
  v_outro := case when auth.uid() = v_ped.autor_id then v_ped.prestador_id when auth.uid() = v_ped.prestador_id then v_ped.autor_id end;
  if v_outro is null then perform public.gf__erro('Você não participa deste atendimento.'); end if;
  select * into v_p from public.gf_perfis where id = v_outro;
  return jsonb_build_object('nome', v_p.nome, 'empresa', v_p.empresa, 'whatsapp', v_p.whatsapp, 'placa', v_p.placa);
end $$;

create or replace function public.gf_reputacao(p_ids uuid[]) returns table(perfil_id uuid, media numeric, avaliacoes int, concluidos int)
language sql stable security definer set search_path = public as $$
  select d.prestador_id, round(avg(d.nota)::numeric, 1), count(d.nota)::int, count(*)::int
  from public.gf_pedidos d
  where d.prestador_id = any(p_ids) and d.status = 'concluido'
  group by d.prestador_id
$$;

create or replace function public.gf_abrir_ocorrencia(p_pedido uuid, p_tipo text, p_descricao text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.gf_perfis where id = auth.uid()) then perform public.gf__erro('Complete seu perfil primeiro.'); end if;
  if p_pedido is not null and not public.gf_participa_pedido(p_pedido) then perform public.gf__erro('Pedido não encontrado.'); end if;
  if p_tipo not in ('servico','cobranca','cadastro','seguranca','outro') then perform public.gf__erro('Escolha o tipo da ocorrência.'); end if;
  if char_length(btrim(coalesce(p_descricao,''))) < 10 then perform public.gf__erro('Descreva o que aconteceu (mínimo 10 letras).'); end if;
  insert into public.gf_ocorrencias(pedido_id, autor_id, tipo, descricao)
  values (p_pedido, auth.uid(), p_tipo, left(btrim(p_descricao), 2000)) returning id into v_id;
  if p_pedido is not null then perform public.gf__evento(p_pedido, 'ocorrencia', null, null, 'Ocorrência aberta: ' || p_tipo); end if;
  return v_id;
end $$;

-- ───────────────────────── administração ─────────────────────────
create or replace function public.gf__exige_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin if not public.gf_is_admin() then perform public.gf__erro('Acesso restrito à administração.'); end if; end $$;

create or replace function public.gf_admin_usuarios() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.gf__exige_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('email', u.email) order by
      (p.aprovacao = 'pendente') desc, p.criado_em desc)
    from public.gf_perfis p left join auth.users u on u.id = p.id), '[]'::jsonb);
end $$;

create or replace function public.gf_admin_aprovar(p_perfil uuid, p_aprovacao text, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.gf__exige_admin();
  if p_aprovacao not in ('pendente','aprovado','recusado','bloqueado') then perform public.gf__erro('Situação inválida.'); end if;
  if p_aprovacao in ('recusado','bloqueado') and char_length(btrim(coalesce(p_obs,''))) < 3 then
    perform public.gf__erro('Informe o motivo para recusar ou bloquear.');
  end if;
  update public.gf_perfis set aprovacao = p_aprovacao, aprovacao_obs = nullif(btrim(coalesce(p_obs,'')),''),
    disponivel = case when p_aprovacao = 'aprovado' then disponivel else false end, atualizado_em = now()
  where id = p_perfil;
  if not found then perform public.gf__erro('Usuário não encontrado.'); end if;
end $$;

create or replace function public.gf_admin_tratar_ocorrencia(p_id uuid, p_status text, p_resposta text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.gf__exige_admin();
  if p_status not in ('aberta','em_analise','resolvida') then perform public.gf__erro('Situação inválida.'); end if;
  update public.gf_ocorrencias set status = p_status, resposta = nullif(btrim(coalesce(p_resposta,'')),''),
    resolvido_em = case when p_status = 'resolvida' then now() else null end
  where id = p_id;
  if not found then perform public.gf__erro('Ocorrência não encontrada.'); end if;
end $$;

create or replace function public.gf_admin_indicadores() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.gf__exige_admin();
  select jsonb_build_object(
    'usuarios', (select count(*) from public.gf_perfis),
    'clientes', (select count(*) from public.gf_perfis where tipo <> 'guincheiro'),
    'guincheiros_aprovados', (select count(*) from public.gf_perfis where tipo = 'guincheiro' and aprovacao = 'aprovado'),
    'guincheiros_pendentes', (select count(*) from public.gf_perfis where tipo = 'guincheiro' and aprovacao = 'pendente'),
    'guincheiros_disponiveis', (select count(*) from public.gf_perfis where tipo = 'guincheiro' and aprovacao = 'aprovado' and disponivel),
    'pedidos_total', (select count(*) from public.gf_pedidos),
    'pedidos_30d', (select count(*) from public.gf_pedidos where criado_em > now() - interval '30 days'),
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.gf_pedidos group by status) s), '{}'::jsonb),
    'pedidos_com_proposta', (select count(distinct pedido_id) from public.gf_propostas),
    'minutos_ate_primeira_proposta', (select round(avg(extract(epoch from (pp.primeira - d.criado_em)) / 60)::numeric, 0)
        from public.gf_pedidos d join (select pedido_id, min(criado_em) primeira from public.gf_propostas group by pedido_id) pp on pp.pedido_id = d.id),
    'avaliacao_media', (select round(avg(nota)::numeric, 1) from public.gf_pedidos where nota is not null),
    'valor_registrado_concluidos', coalesce((select sum(valor_combinado) from public.gf_pedidos where status = 'concluido'), 0),
    'pagamentos_processados', (select count(*) from public.gf_pedidos where pagamento_status = 'processado'),
    'retornos_ativos', (select count(*) from public.gf_retornos where status = 'ativo' and saida > now() - interval '1 day'),
    'ocorrencias_abertas', (select count(*) from public.gf_ocorrencias where status <> 'resolvida'),
    'lista_espera', (select count(*) from public.gf_lista_espera)
  ) into r;
  return r;
end $$;

-- ───────────────────────── execução das funções ─────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'gf\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like 'gf\_\_%' then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
