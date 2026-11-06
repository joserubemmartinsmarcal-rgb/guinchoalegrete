-- Testes dos números da rede e do alcance do pedido, no banco real.
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
  c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); g uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  ped uuid; j jsonb; j0 jsonb; erro text; ok int := 0;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'nr-c@gf.invalid', 'authenticated', 'authenticated'), (c2, 'nr-c2@gf.invalid', 'authenticated', 'authenticated'),
    (g, 'nr-g@gf.invalid', 'authenticated', 'authenticated'), (a, 'nr-a@gf.invalid', 'authenticated', 'authenticated');
  perform pg_temp.como(c);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Radar","cidade":"Alegrete","whatsapp":"55999992001"}');
  perform pg_temp.como(c2);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Outro Cliente","cidade":"Alegrete","whatsapp":"55999992002"}');
  j0 := public.gf_rede_numeros();
  perform pg_temp.como(g);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Radar","cidade":"Santa Maria","whatsapp":"55999992003","equipamento":"Plataforma"}');
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Radar', 'Alegrete', '55999992004', 'aprovado', true);
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform pg_temp.como(g);
  perform public.gf_definir_disponivel(true);

  -- números da rede sobem com o guincheiro aprovado e disponível
  perform pg_temp.como(c2);
  j := public.gf_rede_numeros();
  perform pg_temp.checa((j->>'guincheiros')::int = (j0->>'guincheiros')::int + 1 and (j->>'disponiveis')::int = (j0->>'disponiveis')::int + 1, 'rede conta o guincheiro novo'); ok := ok + 1;
  perform pg_temp.checa(j ? 'rotas_ativas' and j ? 'caminhoes' and j ? 'pedidos_7d' and not (j ? 'whatsapp'), 'rede só traz contagens'); ok := ok + 1;

  -- pedido novo: alcance mostra o guincheiro avisado
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo) values ('Cacequi', 'Alegrete', 'Gol 2015') returning id into ped;
  j := public.gf_alcance_pedido(ped);
  perform pg_temp.checa((j->>'avisados')::int >= 1 and (j->>'propostas')::int = 0, 'autor vê quantos foram avisados'); ok := ok + 1;
  perform pg_temp.como(g);
  perform public.gf_enviar_proposta(ped, 300, 'hoje', null);
  perform pg_temp.como(c);
  perform pg_temp.checa((public.gf_alcance_pedido(ped)->>'propostas')::int = 1, 'alcance conta a proposta'); ok := ok + 1;

  -- privacidade
  perform pg_temp.como(c2);
  begin perform public.gf_alcance_pedido(ped); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro = 'Pedido não encontrado.', 'outro cliente não vê o alcance'); ok := ok + 1;
  perform pg_temp.como(g);
  begin perform public.gf_alcance_pedido(ped); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro = 'Pedido não encontrado.', 'guincheiro não vê o alcance do pedido alheio'); ok := ok + 1;
  perform pg_temp.como(a);
  perform pg_temp.checa(public.gf_alcance_pedido(ped) ? 'avisados', 'admin vê o alcance'); ok := ok + 1;
  perform pg_temp.como(null);
  begin perform public.gf_rede_numeros(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante sem login não vê números'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
