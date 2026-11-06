-- Números da rede para as telas iniciais e o "radar" do pedido aberto.
-- Só contagens agregadas (nenhum dado pessoal sai daqui). Só adiciona funções.

-- Rede GF agora: quantos guincheiros, rotas, caminhões e pedidos recentes.
create or replace function public.gf_rede_numeros() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'guincheiros', (select count(*) from public.gf_perfis where tipo = 'guincheiro' and aprovacao = 'aprovado'),
    'disponiveis', (select count(*) from public.gf_perfis where tipo = 'guincheiro' and aprovacao = 'aprovado' and disponivel),
    'rotas_ativas', (select count(*) from public.gf_retornos where status = 'ativo' and saida > now() - interval '1 day'),
    'caminhoes', (select count(*) from public.gf_caminhoes where status = 'ativo' and (disponivel_ate is null or disponivel_ate >= current_date)),
    'pedidos_7d', (select count(*) from public.gf_pedidos where criado_em > now() - interval '7 days'))
$$;

-- Alcance do pedido aberto (só para quem pediu ou admin): quantos guincheiros
-- foram avisados, quantas propostas há e o tempo típico até a 1ª proposta.
create or replace function public.gf_alcance_pedido(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_min numeric; v_n int;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido;
  if not found or not (v_ped.autor_id = auth.uid() or public.gf_is_admin()) then
    perform public.gf__erro('Pedido não encontrado.');
  end if;
  select count(*), percentile_cont(0.5) within group (order by m) into v_n, v_min
    from (select extract(epoch from (min(pr.criado_em) - d.criado_em)) / 60 m
            from public.gf_pedidos d join public.gf_propostas pr on pr.pedido_id = d.id
           where d.criado_em > now() - interval '90 days' group by d.id, d.criado_em) t;
  return jsonb_build_object(
    'avisados', (select count(distinct user_id) from public.gf_avisos where pedido_id = p_pedido and tipo = 'pedido_novo'),
    'propostas', (select count(*) from public.gf_propostas where pedido_id = p_pedido and status = 'enviada'),
    'minutos_tipicos', case when v_n >= 5 then greatest(1, round(v_min))::int end);
end $$;

revoke all on function public.gf_rede_numeros(), public.gf_alcance_pedido(uuid) from public, anon;
grant execute on function public.gf_rede_numeros(), public.gf_alcance_pedido(uuid) to authenticated;
