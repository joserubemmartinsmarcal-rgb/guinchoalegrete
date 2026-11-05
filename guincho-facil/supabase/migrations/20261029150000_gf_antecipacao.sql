-- Antecipação de recebíveis com a parceira JK Invest (securitizadora).
-- O GF só registra o pedido do guincheiro e encaminha à parceira: não processa
-- dinheiro, não define taxa e não garante aprovação. Recebíveis pagos por TED
-- não são aceitos pela parceira. Só adiciona objetos novos; nada existente muda.

create table if not exists public.gf_antecipacoes (
  id uuid primary key default gen_random_uuid(),
  guincheiro_id uuid not null references public.gf_perfis(id) on delete cascade,
  valor numeric(12,2) not null check (valor > 0 and valor <= 1000000),
  pagador_tipo text not null check (pagador_tipo in ('seguradora','empresa','pessoa','outro')),
  pagador_nome text not null check (char_length(btrim(pagador_nome)) between 2 and 120),
  forma text not null check (forma in ('boleto','pix_prazo','cartao','outro')),
  vencimento date not null,
  pessoa text not null check (pessoa in ('pf','mei','pj')),
  observacao text check (coalesce(char_length(observacao),0) <= 500),
  consentimento_em timestamptz not null,
  status text not null default 'recebido' check (status in ('recebido','enviado','aprovado','recusado','cancelado')),
  nota_admin text check (coalesce(char_length(nota_admin),0) <= 500),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists gf_antecipacoes_guincheiro_idx on public.gf_antecipacoes(guincheiro_id, criado_em desc);
create index if not exists gf_antecipacoes_status_idx on public.gf_antecipacoes(status);

alter table public.gf_antecipacoes enable row level security;
drop policy if exists gf_antec_sel on public.gf_antecipacoes;
create policy gf_antec_sel on public.gf_antecipacoes for select to authenticated
  using (guincheiro_id = auth.uid() or public.gf_is_admin());
revoke all on public.gf_antecipacoes from anon, authenticated;
grant select on public.gf_antecipacoes to authenticated;

create or replace function public.gf_pedir_antecipacao(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_perfil public.gf_perfis; v_id uuid; v_valor numeric; v_venc date;
begin
  select * into v_perfil from public.gf_perfis where id = auth.uid();
  if not found then perform public.gf__erro('Complete seu perfil primeiro.'); end if;
  if v_perfil.tipo <> 'guincheiro' then perform public.gf__erro('A antecipação é para guincheiros.'); end if;
  if v_perfil.aprovacao = 'bloqueado' then perform public.gf__erro('Cadastro bloqueado. Fale com o suporte.'); end if;
  if coalesce((p->>'consentimento')::boolean, false) is not true then
    perform public.gf__erro('Autorize o envio dos dados para a JK Invest.');
  end if;
  if lower(coalesce(p->>'forma','')) = 'ted' then
    perform public.gf__erro('Valores pagos por TED não podem ser antecipados.');
  end if;
  begin v_valor := round((p->>'valor')::numeric, 2); exception when others then v_valor := null; end;
  if v_valor is null or v_valor <= 0 or v_valor > 1000000 then perform public.gf__erro('Informe o valor a receber.'); end if;
  begin v_venc := (p->>'vencimento')::date; exception when others then v_venc := null; end;
  if v_venc is null or v_venc <= current_date then perform public.gf__erro('Informe uma data de recebimento futura.'); end if;
  if v_venc > current_date + 730 then perform public.gf__erro('Data de recebimento muito distante.'); end if;
  if (select count(*) from public.gf_antecipacoes where guincheiro_id = auth.uid() and status in ('recebido','enviado')) >= 10 then
    perform public.gf__erro('Você já tem 10 pedidos em andamento. Aguarde a resposta da JK Invest.');
  end if;
  insert into public.gf_antecipacoes(guincheiro_id, valor, pagador_tipo, pagador_nome, forma, vencimento, pessoa, observacao, consentimento_em)
  values (auth.uid(), v_valor, p->>'pagador_tipo', btrim(coalesce(p->>'pagador_nome','')), p->>'forma', v_venc, p->>'pessoa',
          nullif(left(btrim(coalesce(p->>'observacao','')), 500), ''), now())
  returning id into v_id;
  return v_id;
exception when check_violation then
  perform public.gf__erro('Confira os campos do pedido.');
end $$;

create or replace function public.gf_cancelar_antecipacao(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.gf_antecipacoes set status = 'cancelado', atualizado_em = now()
  where id = p_id and guincheiro_id = auth.uid() and status in ('recebido','enviado');
  if not found then perform public.gf__erro('Este pedido não pode mais ser cancelado.'); end if;
end $$;

create or replace function public.gf_admin_antecipacoes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.gf__exige_admin();
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('nome', g.nome, 'empresa', g.empresa, 'cidade', g.cidade,
      'whatsapp', g.whatsapp, 'aprovacao', g.aprovacao, 'email', u.email)
      order by (a.status in ('recebido','enviado')) desc, a.criado_em desc)
    from public.gf_antecipacoes a join public.gf_perfis g on g.id = a.guincheiro_id left join auth.users u on u.id = a.guincheiro_id), '[]'::jsonb);
end $$;

create or replace function public.gf_admin_tratar_antecipacao(p_id uuid, p_status text, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.gf__exige_admin();
  if p_status not in ('recebido','enviado','aprovado','recusado','cancelado') then perform public.gf__erro('Situação inválida.'); end if;
  update public.gf_antecipacoes set status = p_status, nota_admin = nullif(left(btrim(coalesce(p_nota,'')), 500), ''), atualizado_em = now()
  where id = p_id;
  if not found then perform public.gf__erro('Pedido não encontrado.'); end if;
end $$;

revoke all on function public.gf_pedir_antecipacao(jsonb), public.gf_cancelar_antecipacao(uuid),
  public.gf_admin_antecipacoes(), public.gf_admin_tratar_antecipacao(uuid, text, text) from public, anon;
grant execute on function public.gf_pedir_antecipacao(jsonb), public.gf_cancelar_antecipacao(uuid),
  public.gf_admin_antecipacoes(), public.gf_admin_tratar_antecipacao(uuid, text, text) to authenticated;
