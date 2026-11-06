-- Preço lançado por quem pede o frete (opcional). Sem valor, o pedido fica
-- "a combinar". O guincheiro aceita pelo valor (proposta com o mesmo valor) ou
-- negocia (proposta com outro valor); quem pediu escolhe, como antes.
-- Só adiciona uma coluna e atualiza o texto do aviso de pedido novo.

alter table public.gf_pedidos add column if not exists valor_oferecido numeric(10,2);
alter table public.gf_pedidos drop constraint if exists gf_pedidos_valor_oferecido_chk;
alter table public.gf_pedidos add constraint gf_pedidos_valor_oferecido_chk
  check (valor_oferecido is null or valor_oferecido between 1 and 100000);

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

