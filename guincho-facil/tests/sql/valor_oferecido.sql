-- Testes do preço lançado por quem pede o frete, no banco real.
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
  c uuid := gen_random_uuid(); g uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  ped uuid; ped2 uuid; prop uuid; erro text; ok int := 0;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'vo-c@gf.invalid', 'authenticated', 'authenticated'), (g, 'vo-g@gf.invalid', 'authenticated', 'authenticated'),
    (a, 'vo-a@gf.invalid', 'authenticated', 'authenticated');
  perform pg_temp.como(c);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Preço","cidade":"Alegrete","whatsapp":"55999994001"}');
  perform pg_temp.como(g);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Preço","cidade":"Santa Maria","whatsapp":"55999994002","equipamento":"Plataforma"}');
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Preço', 'Alegrete', '55999994003', 'aprovado', true);
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform pg_temp.como(g);
  perform public.gf_definir_disponivel(true);

  -- pedido com preço
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo, valor_oferecido) values ('Cacequi', 'Alegrete', 'Gol 2015', 380) returning id into ped;
  perform pg_temp.checa((select valor_oferecido = 380 from public.gf_pedidos where id = ped), 'valor oferecido gravado'); ok := ok + 1;
  -- pedido a combinar
  insert into public.gf_pedidos(origem, destino, veiculo) values ('Cacequi', 'Alegrete', 'Onix 2020') returning id into ped2;
  perform pg_temp.checa((select valor_oferecido is null from public.gf_pedidos where id = ped2), 'sem valor fica a combinar'); ok := ok + 1;
  -- valor inválido
  begin insert into public.gf_pedidos(origem, destino, veiculo, valor_oferecido) values ('Cacequi', 'Alegrete', 'Uno', 0); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%valor_oferecido%', 'valor zero é recusado'); ok := ok + 1;

  -- aviso do pedido novo mostra o preço
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and pedido_id = ped and corpo like '%paga R$ 380,00%'), 'aviso traz o valor'); ok := ok + 1;
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and pedido_id = ped2 and corpo like '%a combinar%'), 'aviso diz a combinar'); ok := ok + 1;

  -- guincheiro vê o valor e aceita pelo valor (proposta igual), cliente escolhe
  perform pg_temp.como(g);
  perform pg_temp.checa((select valor_oferecido = 380 from public.gf_pedidos where id = ped), 'guincheiro vê o valor oferecido'); ok := ok + 1;
  prop := public.gf_enviar_proposta(ped, 380, null, null);
  perform pg_temp.como(c);
  perform public.gf_aceitar_proposta(prop);
  perform pg_temp.checa((select valor_combinado = 380 and status = 'aceito' from public.gf_pedidos where id = ped), 'aceite pelo valor oferecido'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
