-- Despacho: quem lança o frete pode disparar um CHAMADO URGENTE para a rede
-- toda. Os guincheiros disponíveis recebem alarme; o primeiro que aceitar pelo
-- valor oferecido leva o serviço na hora. Se ninguém pegar em 3 minutos, o
-- pedido continua aberto recebendo propostas, como um pedido normal.

alter table public.gf_pedidos add column if not exists despacho_ate timestamptz;

-- o prazo é sempre definido pelo banco (3 min) e exige valor oferecido
create or replace function public.gf__pedido_despacho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.despacho_ate is not null then
    if new.valor_oferecido is null then perform public.gf__erro('Chamado urgente precisa de um valor oferecido.'); end if;
    new.despacho_ate := now() + interval '3 minutes';
  end if;
  return new;
end $$;
drop trigger if exists gf_pedido_despacho on public.gf_pedidos;
create trigger gf_pedido_despacho before insert on public.gf_pedidos
  for each row execute function public.gf__pedido_despacho();

-- guincheiro pega o chamado urgente: vira o prestador pelo valor oferecido
create or replace function public.gf_pegar_chamado(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_prop uuid;
begin
  if not public.gf_eh_guincheiro_aprovado() then perform public.gf__erro('Só guincheiros aprovados pegam chamados.'); end if;
  select * into v_ped from public.gf_pedidos where id = p_pedido for update;
  if not found then perform public.gf__erro('Chamado não encontrado.'); end if;
  if v_ped.autor_id = auth.uid() then perform public.gf__erro('Este chamado é seu.'); end if;
  if v_ped.status <> 'aberto' then perform public.gf__erro('Outro guincheiro pegou este chamado antes.'); end if;
  if v_ped.despacho_ate is null or v_ped.despacho_ate < now() then
    perform public.gf__erro('O prazo do chamado urgente acabou. Mande uma proposta normal.');
  end if;
  update public.gf_propostas set status = 'recusada', atualizado_em = now() where pedido_id = v_ped.id and status = 'enviada';
  insert into public.gf_propostas(pedido_id, guincheiro_id, valor, prazo, mensagem, status)
  values (v_ped.id, auth.uid(), v_ped.valor_oferecido, 'chamado urgente', null, 'aceita')
  on conflict (pedido_id, guincheiro_id) do update set valor = excluded.valor, status = 'aceita', atualizado_em = now()
  returning id into v_prop;
  update public.gf_pedidos set status = 'aceito', prestador_id = auth.uid(), proposta_aceita_id = v_prop,
    valor_combinado = v_ped.valor_oferecido, aceito_em = now(), atualizado_em = now() where id = v_ped.id;
  perform public.gf__evento(v_ped.id, 'despacho', 'aberto', 'aceito', 'Chamado urgente aceito: ' || public.gf__brl(v_ped.valor_oferecido));
  perform public.gf__avisar(v_ped.autor_id, 'escolhido', 'Guincheiro a caminho do seu chamado',
    v_ped.origem || ' › ' || v_ped.destino || ' · ' || public.gf__brl(v_ped.valor_oferecido) || ' · combine pelo WhatsApp', '#pedido/' || v_ped.id, v_ped.id);
end $$;

revoke all on function public.gf__pedido_despacho() from public, anon, authenticated;
revoke all on function public.gf_pegar_chamado(uuid) from public, anon;
grant execute on function public.gf_pegar_chamado(uuid) to authenticated;

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
      perform public.gf__avisar(r.id, 'pedido_novo', case when p.despacho_ate is not null then 'CHAMADO URGENTE: '
          when p.tipo = 'repasse' then 'Repasse de colega: ' else 'Novo pedido: ' end || v_trajeto,
        p.veiculo || coalesce(' · paga ' || public.gf__brl(p.valor_oferecido), ' · valor a combinar'), v_url, p.id);
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

