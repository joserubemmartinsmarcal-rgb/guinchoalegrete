-- Testes do chamado urgente (despacho para a rede), no banco real.
-- Roda numa transação e termina com "TESTES_OK ..." para nada ficar gravado.
create or replace function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
end $$;
create or replace function pg_temp.checa(cond boolean, nome text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FALHA: %', nome; end if; end $$;

do $t$
declare
  c uuid := gen_random_uuid(); g uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); g3 uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  ped uuid; ped2 uuid; erro text; ok int := 0;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'dp-c@gf.invalid', 'authenticated', 'authenticated'), (g, 'dp-g@gf.invalid', 'authenticated', 'authenticated'),
    (g2, 'dp-g2@gf.invalid', 'authenticated', 'authenticated'), (g3, 'dp-g3@gf.invalid', 'authenticated', 'authenticated'),
    (a, 'dp-a@gf.invalid', 'authenticated', 'authenticated');
  perform pg_temp.como(c);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Urgente","cidade":"Alegrete","whatsapp":"55999995001"}');
  perform pg_temp.como(g);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Rápido","cidade":"Alegrete","whatsapp":"55999995002","equipamento":"Plataforma"}');
  perform pg_temp.como(g2);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Lento","cidade":"Cacequi","whatsapp":"55999995003","equipamento":"Plataforma"}');
  perform pg_temp.como(g3);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Novato","cidade":"Cacequi","whatsapp":"55999995004","equipamento":"Plataforma"}');
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Urgente', 'Alegrete', '55999995005', 'aprovado', true);
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform public.gf_admin_aprovar(g2, 'aprovado', null);
  perform pg_temp.como(g); perform public.gf_definir_disponivel(true);
  perform pg_temp.como(g2); perform public.gf_definir_disponivel(true);

  -- urgente sem valor é recusado
  perform pg_temp.como(c);
  begin insert into public.gf_pedidos(origem, destino, veiculo, despacho_ate) values ('Alegrete', 'Uruguaiana', 'Gol', now()); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Chamado urgente precisa%', 'urgente exige valor'); ok := ok + 1;

  -- prazo é o do banco, não o que o app mandou
  insert into public.gf_pedidos(origem, destino, veiculo, valor_oferecido, despacho_ate)
  values ('Alegrete', 'Uruguaiana', 'Gol 2015', 300, now() + interval '5 days') returning id into ped;
  perform pg_temp.checa((select despacho_ate between now() + interval '170 seconds' and now() + interval '190 seconds' from public.gf_pedidos where id = ped), 'prazo de 3 minutos'); ok := ok + 1;
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and pedido_id = ped and titulo like 'CHAMADO URGENTE%'), 'rede recebe aviso de urgente'); ok := ok + 1;

  -- não aprovado e o próprio cliente não pegam
  perform pg_temp.como(g3);
  begin perform public.gf_pegar_chamado(ped); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Só guincheiros aprovados%', 'não aprovado não pega'); ok := ok + 1;

  -- o primeiro que aceita leva; o segundo recebe aviso de que já foi
  perform pg_temp.como(g);
  perform public.gf_pegar_chamado(ped);
  execute 'reset role';
  perform pg_temp.checa((select status = 'aceito' and prestador_id = g and valor_combinado = 300 from public.gf_pedidos where id = ped), 'primeiro leva pelo valor'); ok := ok + 1;
  perform pg_temp.checa(exists (select 1 from public.gf_propostas where pedido_id = ped and guincheiro_id = g and status = 'aceita'), 'proposta aceita registrada'); ok := ok + 1;
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and pedido_id = ped and tipo = 'escolhido'), 'cliente avisado'); ok := ok + 1;
  perform pg_temp.checa(not exists (select 1 from public.gf_avisos where user_id = g and pedido_id = ped and tipo = 'escolhido'), 'guincheiro não recebe aviso de si mesmo'); ok := ok + 1;
  perform pg_temp.como(g2);
  begin perform public.gf_pegar_chamado(ped); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Outro guincheiro pegou%', 'segundo não pega'); ok := ok + 1;

  -- prazo vencido: vira pedido normal
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo, valor_oferecido, despacho_ate) values ('Alegrete', 'Uruguaiana', 'Onix', 250, now()) returning id into ped2;
  execute 'reset role';
  update public.gf_pedidos set despacho_ate = now() - interval '1 second' where id = ped2;
  perform pg_temp.como(g2);
  begin perform public.gf_pegar_chamado(ped2); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'O prazo do chamado urgente acabou%', 'vencido não pega'); ok := ok + 1;
  perform public.gf_enviar_proposta(ped2, 260, null, null);
  perform pg_temp.checa(exists (select 1 from public.gf_propostas where pedido_id = ped2 and guincheiro_id = g2), 'vencido aceita proposta normal'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
