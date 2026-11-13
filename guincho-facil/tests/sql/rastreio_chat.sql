-- Teste (roda e desfaz): link de acompanhamento, código de chegada e chat.
do $$
declare a uuid; c uuid; pid uuid; s record; j jsonb;
begin
  select id into a from public.gf_perfis where tipo = 'guincheiro' and aprovacao = 'aprovado' limit 1;
  select id into c from public.gf_perfis where id <> a limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role','authenticated')::text, true);
  insert into public.gf_pedidos(autor_id, tipo, origem, destino, veiculo, veiculo_tipo, condicao, data_servico)
  values (c, 'cliente', 'Santa Maria', 'Porto Alegre', 'Gol 2015', 'carro', 'anda', current_date) returning id into pid;
  update public.gf_pedidos set status='aceito', prestador_id=a, valor_combinado=500, aceito_em=now() where id=pid;
  select * into s from public.gf_pedido_segredos where pedido_id=pid;
  if s.codigo is null then raise exception 'sem codigo'; end if;
  j := public.gf_acompanhar(s.token);
  if j->>'origem' <> 'Santa Maria' then raise exception 'acompanhar falhou %', j; end if;
  if public.gf_acompanhar(gen_random_uuid()) is not null then raise exception 'token falso'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  j := public.gf_meu_acompanhamento(pid);
  if j->>'codigo' is not null then raise exception 'prestador viu o codigo'; end if;
  begin perform public.gf_confirmar_chegada(pid, '0000x'); raise exception 'aceitou errado'; exception when others then if sqlerrm = 'aceitou errado' then raise; end if; end;
  perform public.gf_confirmar_chegada(pid, s.codigo);
  if (select status from public.gf_pedidos where id=pid) <> 'no_local' then raise exception 'status'; end if;
  perform public.gf_enviar_mensagem(pid, 'Chego em 5 min');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role','authenticated')::text, true);
  if public.gf_meu_acompanhamento(pid)->>'codigo' <> s.codigo then raise exception 'cliente sem codigo'; end if;
  raise exception 'TESTES_OK';
end $$;
