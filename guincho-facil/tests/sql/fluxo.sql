-- Testes de permissão e fluxo do Guincho Fácil no banco real.
-- Roda tudo numa transação e termina com uma exceção proposital
-- ("TESTES_OK ...") para que NADA fique gravado. Qualquer falha real
-- interrompe com "FALHA: ...".
-- Uso: executar este arquivo inteiro (via Supabase SQL / MCP execute_sql).

create or replace function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  if u is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.checa(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHA: %', nome; end if;
end $$;

do $t$
declare
  c uuid := gen_random_uuid();  -- cliente
  g uuid := gen_random_uuid();  -- guincheiro
  g2 uuid := gen_random_uuid(); -- outro guincheiro
  a uuid := gen_random_uuid();  -- admin
  x uuid := gen_random_uuid();  -- cliente sem relação com o pedido
  ped uuid; ped2 uuid; prop uuid; prop2 uuid; n int; j jsonb; s text; erro text; ok int := 0;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'teste-c@gf.invalid', 'authenticated', 'authenticated'), (g, 'teste-g@gf.invalid', 'authenticated', 'authenticated'),
    (g2, 'teste-g2@gf.invalid', 'authenticated', 'authenticated'), (a, 'teste-a@gf.invalid', 'authenticated', 'authenticated'),
    (x, 'teste-x@gf.invalid', 'authenticated', 'authenticated');

  -- perfis
  perform pg_temp.como(c);
  j := public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Teste","cidade":"Alegrete","whatsapp":"(55) 99999-0001"}');
  perform pg_temp.checa(j->>'aprovacao' = 'aprovado' and j->>'whatsapp' = '55999990001', 'cliente salvo e aprovado'); ok := ok + 1;
  perform pg_temp.como(x);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Curioso","cidade":"Uruguaiana","whatsapp":"55999990009"}');
  perform pg_temp.como(g);
  j := public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Um","cidade":"Santa Maria","whatsapp":"55999990002","equipamento":"Plataforma","placa":"abc-1d23","raio_km":150}');
  perform pg_temp.checa(j->>'aprovacao' = 'pendente' and j->>'placa' = 'ABC1D23', 'guincheiro começa pendente e placa normalizada'); ok := ok + 1;
  perform pg_temp.como(g2);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Dois","cidade":"Rosário do Sul","whatsapp":"55999990003","equipamento":"Asa-delta"}');

  perform pg_temp.como(g);
  begin perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"G","cidade":"X","whatsapp":"123"}'); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'perfil com dados inválidos é recusado'); ok := ok + 1;

  begin update public.gf_perfis set aprovacao = 'aprovado' where id = g; erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'guincheiro não se autoaprova'); ok := ok + 1;

  -- admin aprova
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Teste', 'Alegrete', '55999990004', 'aprovado', true);
  perform pg_temp.como(g);
  begin perform public.gf_admin_aprovar(g, 'aprovado', null); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%restrito%', 'não-admin não usa funções de admin'); ok := ok + 1;
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform public.gf_admin_aprovar(g2, 'aprovado', null);

  -- cliente cria pedido tentando forjar status/prestador
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo, condicao, status, prestador_id, valor_combinado, placa)
    values ('Cacequi', 'Alegrete', 'Gol 2015', 'nao_anda', 'concluido', g, 1, 'iyz-1234') returning id into ped;
  select status || '|' || coalesce(prestador_id::text, '-') || '|' || coalesce(valor_combinado::text, '-') || '|' || placa into s from public.gf_pedidos where id = ped;
  perform pg_temp.checa(s = 'aberto|-|-|IYZ1234', 'pedido nasce aberto, sem prestador forjado (' || s || ')'); ok := ok + 1;

  begin update public.gf_pedidos set status = 'concluido' where id = ped; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'cliente não altera status direto'); ok := ok + 1;

  -- privacidade
  perform pg_temp.como(x);
  select count(*) into n from public.gf_pedidos where id = ped;
  perform pg_temp.checa(n = 0, 'cliente sem relação não vê pedido alheio'); ok := ok + 1;
  begin perform whatsapp from public.gf_perfis limit 1; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'WhatsApp não é legível pela API'); ok := ok + 1;
  select count(*) into n from public.gf_perfis where id = c;
  perform pg_temp.checa(n = 0, 'cliente sem relação não vê nome de outro cliente'); ok := ok + 1;

  perform pg_temp.como(g);
  select count(*) into n from public.gf_pedidos where id = ped;
  perform pg_temp.checa(n = 1, 'guincheiro aprovado vê pedido aberto'); ok := ok + 1;
  select count(*) into n from public.gf_perfis where id = c;
  perform pg_temp.checa(n = 1, 'guincheiro vê nome de quem pediu'); ok := ok + 1;

  -- propostas
  prop := public.gf_enviar_proposta(ped, 450, 'hoje 16h', 'passo no caminho');
  perform pg_temp.como(g2);
  prop2 := public.gf_enviar_proposta(ped, 520, null, null);
  perform pg_temp.como(c);
  begin perform public.gf_enviar_proposta(ped, 10, null, null); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'cliente não manda proposta'); ok := ok + 1;
  select count(*) into n from public.gf_propostas where pedido_id = ped;
  perform pg_temp.checa(n = 2, 'cliente vê as 2 propostas do seu pedido'); ok := ok + 1;
  begin update public.gf_propostas set valor = 1 where id = prop; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'cliente não altera valor de proposta'); ok := ok + 1;
  begin perform public.gf_contato(ped); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'contato bloqueado antes do aceite'); ok := ok + 1;

  perform pg_temp.como(g2);
  select count(*) into n from public.gf_propostas where pedido_id = ped;
  perform pg_temp.checa(n = 1, 'guincheiro só vê a própria proposta'); ok := ok + 1;
  perform pg_temp.como(g);
  begin perform public.gf_aceitar_proposta(prop); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'guincheiro não aceita a própria proposta'); ok := ok + 1;

  -- aceite
  perform pg_temp.como(c);
  perform public.gf_aceitar_proposta(prop);
  select status || '|' || prestador_id::text || '|' || valor_combinado::text into s from public.gf_pedidos where id = ped;
  perform pg_temp.checa(s = 'aceito|' || g::text || '|450.00', 'aceite fecha pedido com prestador e valor (' || s || ')'); ok := ok + 1;
  select status into s from public.gf_propostas where id = prop2;
  perform pg_temp.checa(s = 'recusada', 'outra proposta vira recusada'); ok := ok + 1;
  j := public.gf_contato(ped);
  perform pg_temp.checa(j->>'whatsapp' = '55999990002', 'cliente recebe WhatsApp do guincheiro escolhido'); ok := ok + 1;
  perform pg_temp.como(g2);
  begin perform public.gf_contato(ped); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'guincheiro não escolhido não recebe contato'); ok := ok + 1;

  -- andamento
  perform pg_temp.como(g);
  begin perform public.gf_atualizar_status(ped, 'no_local'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'não pula etapa de status'); ok := ok + 1;
  perform public.gf_atualizar_status(ped, 'a_caminho', 'saindo agora');
  perform public.gf_atualizar_status(ped, 'no_local');
  perform public.gf_atualizar_status(ped, 'em_transporte');
  perform pg_temp.como(c);
  begin perform public.gf_cancelar_pedido(ped, 'desisti'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'cliente não cancela veículo em transporte'); ok := ok + 1;
  perform public.gf_atualizar_status(ped, 'concluido', 'recebi o carro');
  perform public.gf_avaliar(ped, 5, 'Ótimo');
  begin perform public.gf_avaliar(ped, 1, null); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'avaliação só uma vez'); ok := ok + 1;
  select count(*) into n from public.gf_eventos where pedido_id = ped;
  perform pg_temp.checa(n >= 9, 'histórico registra cada etapa (' || n || ')'); ok := ok + 1;
  perform pg_temp.como(x);
  select count(*) into n from public.gf_eventos where pedido_id = ped;
  perform pg_temp.checa(n = 0, 'histórico não vaza para terceiros'); ok := ok + 1;

  -- desistência do guincheiro devolve o pedido ao mercado
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo) values ('Santa Maria', 'Alegrete', 'S10') returning id into ped2;
  perform pg_temp.como(g);
  prop := public.gf_enviar_proposta(ped2, 800, null, null);
  perform pg_temp.como(g2);
  prop2 := public.gf_enviar_proposta(ped2, 900, null, null);
  perform pg_temp.como(c);
  perform public.gf_aceitar_proposta(prop);
  perform pg_temp.como(g);
  begin perform public.gf_cancelar_pedido(ped2, ''); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%motivo%', 'desistência exige motivo'); ok := ok + 1;
  perform public.gf_cancelar_pedido(ped2, 'Pneu furou');
  perform pg_temp.como(c);
  select status || '|' || coalesce(prestador_id::text, '-') into s from public.gf_pedidos where id = ped2;
  perform pg_temp.checa(s = 'aberto|-', 'pedido volta a aberto após desistência'); ok := ok + 1;
  select status into s from public.gf_propostas where id = prop2;
  perform pg_temp.checa(s = 'enviada', 'proposta do outro guincheiro volta a valer'); ok := ok + 1;
  perform public.gf_cancelar_pedido(ped2, null);
  select status into s from public.gf_pedidos where id = ped2;
  perform pg_temp.checa(s = 'cancelado', 'cliente cancela pedido aberto'); ok := ok + 1;

  -- rotas / vagas
  perform pg_temp.como(g);
  insert into public.gf_retornos(origem, destino, saida, equipamento, sentido, vagas)
    values ('Santa Maria', 'Alegrete', now() + interval '2 hours', 'Plataforma', 'retorno', 2);
  perform pg_temp.como(g2);
  select count(*) into n from public.gf_retornos where guincheiro_id = g;
  perform pg_temp.checa(n = 1, 'guincheiros aprovados veem retornos da rede'); ok := ok + 1;
  perform pg_temp.como(c);
  select count(*) into n from public.gf_retornos;
  perform pg_temp.checa(n = 0, 'cliente não vê agenda dos guincheiros'); ok := ok + 1;

  -- ocorrências
  perform public.gf_abrir_ocorrencia(ped, 'servico', 'Chegou atrasado, mas resolveu bem.');
  perform pg_temp.como(x);
  select count(*) into n from public.gf_ocorrencias;
  perform pg_temp.checa(n = 0, 'ocorrência é privada'); ok := ok + 1;

  -- admin
  perform pg_temp.como(a);
  j := public.gf_admin_indicadores();
  perform pg_temp.checa((j->'por_status'->>'concluido')::int >= 1 and (j->>'ocorrencias_abertas')::int >= 1, 'indicadores reais: ' || j::text); ok := ok + 1;
  j := public.gf_admin_usuarios();
  perform pg_temp.checa(jsonb_array_length(j) >= 5 and j::text like '%55999990002%', 'admin lista usuários com contato'); ok := ok + 1;

  -- visitante anônimo
  perform pg_temp.como(null);
  begin perform 1 from public.gf_pedidos limit 1; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'anônimo não lê pedidos'); ok := ok + 1;
  insert into public.gf_lista_espera(perfil, nome, cidade, whatsapp, aceite_lgpd) values ('cliente', 'Visitante', 'Alegrete', '55999990005', true);
  begin insert into public.gf_lista_espera(perfil, nome, cidade, whatsapp, aceite_lgpd) values ('cliente', 'V', 'A', '1', true); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'lista de espera valida dados'); ok := ok + 1;

  execute 'reset role';
  raise exception 'TESTES_OK: % verificações passaram', ok;
end $t$;
