-- Testes dos avisos no banco real, com as funções de verdade do app.
-- Roda numa transação e termina com "TESTES_OK ..." para nada ficar gravado.
create or replace function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  if u is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true); execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  end if;
end $$;
create or replace function pg_temp.checa(cond boolean, nome text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FALHA: %', nome; end if; end $$;

do $t$
declare
  c uuid := gen_random_uuid(); g uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  ped uuid; prop uuid; n int; erro text; ok int := 0; an uuid;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'av-c@gf.invalid', 'authenticated', 'authenticated'), (g, 'av-g@gf.invalid', 'authenticated', 'authenticated'),
    (g2, 'av-g2@gf.invalid', 'authenticated', 'authenticated'), (a, 'av-a@gf.invalid', 'authenticated', 'authenticated');
  perform pg_temp.como(c);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Aviso","cidade":"Alegrete","whatsapp":"55999990001"}');
  perform pg_temp.como(g);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Aviso","cidade":"Santa Maria","whatsapp":"55999990002","equipamento":"Plataforma","placa":"ABC1D23","raio_km":150}');
  perform pg_temp.como(g2);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Parado","cidade":"Cacequi","whatsapp":"55999990003","equipamento":"Plataforma"}');
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Aviso', 'Alegrete', '55999990004', 'aprovado', true);
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform public.gf_admin_aprovar(g2, 'aprovado', null);
  perform pg_temp.como(g);
  perform public.gf_definir_disponivel(true);

  -- pedido novo: avisa guincheiro aprovado e disponível, não o indisponível
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo) values ('Cacequi', 'Alegrete', 'Gol 2015') returning id into ped;
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and pedido_id = ped and tipo = 'pedido_novo'), 'guincheiro disponível avisado do pedido novo'); ok := ok + 1;
  perform pg_temp.checa(not exists (select 1 from public.gf_avisos where user_id in (g2, c) and pedido_id = ped), 'indisponível e cliente não recebem aviso de pedido novo'); ok := ok + 1;

  -- proposta → cliente
  perform pg_temp.como(g);
  prop := public.gf_enviar_proposta(ped, 450, 'hoje 16h', null);
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and tipo = 'proposta' and corpo like '%450,00%'), 'cliente avisado da proposta'); ok := ok + 1;

  -- aceite → guincheiro; etapas → cliente
  perform pg_temp.como(c);
  perform public.gf_aceitar_proposta(prop);
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and tipo = 'escolhido'), 'guincheiro avisado que foi escolhido'); ok := ok + 1;
  perform pg_temp.como(g);
  perform public.gf_atualizar_status(ped, 'a_caminho', null);
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and titulo = 'Guincheiro a caminho' and url = '#pedido/' || ped), 'cliente avisado: a caminho'); ok := ok + 1;
  perform pg_temp.checa(not exists (select 1 from public.gf_avisos where user_id = g and tipo = 'status'), 'quem mudou a etapa não é avisado'); ok := ok + 1;

  -- antecipação → admin e guincheiro
  perform pg_temp.como(g);
  an := public.gf_pedir_antecipacao(jsonb_build_object('valor', 1500, 'pagador_tipo', 'seguradora', 'pagador_nome', 'Assistência X',
    'forma', 'boleto', 'vencimento', (current_date + 30)::text, 'pessoa', 'mei', 'consentimento', true));
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = a and tipo = 'antecipacao_nova'), 'admin avisado da antecipação'); ok := ok + 1;
  perform pg_temp.como(a);
  perform public.gf_admin_tratar_antecipacao(an, 'aprovado', 'Cai hoje');
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and titulo = 'Antecipação aprovada'), 'guincheiro avisado da aprovação'); ok := ok + 1;

  -- privacidade e funções do app
  perform pg_temp.como(c);
  select count(*) into n from public.gf_avisos where user_id <> c;
  perform pg_temp.checa(n = 0, 'cliente só vê os próprios avisos'); ok := ok + 1;
  begin update public.gf_avisos set lido_em = now(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'avisos não são alterados direto'); ok := ok + 1;
  begin perform 1 from public.gf_push; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'aparelhos inscritos não são legíveis'); ok := ok + 1;
  begin perform 1 from public.gf__config; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'configuração interna fechada'); ok := ok + 1;
  begin perform public.gf__avisar(g, 'x', 'forjado', null, null, null); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'ninguém cria aviso para outra pessoa'); ok := ok + 1;
  perform public.gf_registrar_push('https://push.exemplo/teste-gf', repeat('p', 40), repeat('a', 16), 'teste');
  perform public.gf_aviso_teste();
  perform pg_temp.checa(public.gf_marcar_avisos_lidos() >= 3, 'marcar avisos como lidos'); ok := ok + 1;
  perform public.gf_remover_push('https://push.exemplo/teste-gf');
  execute 'reset role';
  perform pg_temp.checa(not exists (select 1 from public.gf_push where endpoint = 'https://push.exemplo/teste-gf'), 'aparelho removido ao sair'); ok := ok + 1;
  perform pg_temp.como(null);
  begin perform public.gf_marcar_avisos_lidos(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante sem login não usa as funções'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
