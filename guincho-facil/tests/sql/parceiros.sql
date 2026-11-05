-- Testes de parceiros (vaga e caminhão cedido) no banco real.
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
  c uuid := gen_random_uuid(); g uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); g3 uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  cam uuid; vaga uuid; n int; erro text; ok int := 0; j jsonb;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'pa-c@gf.invalid', 'authenticated', 'authenticated'), (g, 'pa-g@gf.invalid', 'authenticated', 'authenticated'),
    (g2, 'pa-g2@gf.invalid', 'authenticated', 'authenticated'), (g3, 'pa-g3@gf.invalid', 'authenticated', 'authenticated'),
    (a, 'pa-a@gf.invalid', 'authenticated', 'authenticated');
  perform pg_temp.como(c);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Parceiro","cidade":"Alegrete","whatsapp":"55999991001"}');
  perform pg_temp.como(g);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Dono Caminhão","cidade":"Santa Maria","whatsapp":"55999991002","equipamento":"Plataforma","placa":"ABC1D23","raio_km":150}');
  perform pg_temp.como(g2);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Colega Rota","cidade":"Cacequi","whatsapp":"55999991003","equipamento":"Plataforma"}');
  perform pg_temp.como(g3);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Novato","cidade":"Rosário do Sul","whatsapp":"55999991004","equipamento":"Plataforma"}');
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Parceiro', 'Alegrete', '55999991005', 'aprovado', true);
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform public.gf_admin_aprovar(g2, 'aprovado', null);

  -- ceder caminhão: aprovado anuncia; dono é sempre quem está logado
  perform pg_temp.como(g);
  insert into public.gf_caminhoes(guincheiro_id, cidade, raio_km, equipamento, com_motorista, valor, cobranca, obs)
  values (g2, ' Santa Maria ', 200, 'Plataforma', false, 600, 'dia', 'Caminhão revisado') returning id into cam;
  execute 'reset role';
  perform pg_temp.checa((select guincheiro_id = g and cidade = 'Santa Maria' and status = 'ativo' from public.gf_caminhoes where id = cam), 'dono e cidade ajustados no anúncio'); ok := ok + 1;

  -- a combinar zera o valor
  perform pg_temp.como(g);
  update public.gf_caminhoes set cobranca = 'combinar' where id = cam;
  execute 'reset role';
  perform pg_temp.checa((select valor is null from public.gf_caminhoes where id = cam), 'a combinar não guarda valor'); ok := ok + 1;

  -- período inválido é recusado
  perform pg_temp.como(g);
  begin insert into public.gf_caminhoes(cidade, equipamento, disponivel_de, disponivel_ate) values ('Alegrete', 'Plataforma', current_date, current_date - 1);
    erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%periodo%', 'período com fim antes do início'); ok := ok + 1;

  -- não aprovado e cliente não anunciam nem veem
  perform pg_temp.como(g3);
  begin insert into public.gf_caminhoes(cidade, equipamento) values ('Alegrete', 'Plataforma'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%row-level security%', 'guincheiro não aprovado não anuncia'); ok := ok + 1;
  select count(*) into n from public.gf_caminhoes where id = cam;
  perform pg_temp.checa(n = 0, 'não aprovado não vê caminhões'); ok := ok + 1;
  perform pg_temp.como(c);
  select count(*) into n from public.gf_caminhoes where id = cam;
  perform pg_temp.checa(n = 0, 'cliente não vê caminhões'); ok := ok + 1;

  -- colega aprovado vê, mas não altera nem apaga o anúncio do outro
  perform pg_temp.como(g2);
  select count(*) into n from public.gf_caminhoes where id = cam;
  perform pg_temp.checa(n = 1, 'colega aprovado vê o caminhão'); ok := ok + 1;
  update public.gf_caminhoes set obs = 'invadido' where id = cam;
  delete from public.gf_caminhoes where id = cam;
  execute 'reset role';
  perform pg_temp.checa((select obs = 'Caminhão revisado' from public.gf_caminhoes where id = cam), 'colega não altera nem apaga anúncio alheio'); ok := ok + 1;

  -- falar com parceiro: devolve o WhatsApp e avisa o dono uma vez
  perform pg_temp.como(g2);
  j := public.gf_falar_com_parceiro('caminhao', cam);
  perform pg_temp.checa(j->>'whatsapp' = '55999991002' and j->>'nome' = 'Dono Caminhão', 'contato do dono do caminhão'); ok := ok + 1;
  perform public.gf_falar_com_parceiro('caminhao', cam);
  execute 'reset role';
  select count(*) into n from public.gf_avisos where user_id = g and tipo = 'parceiro' and url = '#caminhao/' || cam;
  perform pg_temp.checa(n = 1, 'dono avisado só na primeira vez'); ok := ok + 1;

  -- vaga numa rota
  perform pg_temp.como(g);
  insert into public.gf_retornos(guincheiro_id, sentido, origem, destino, saida, equipamento, vagas)
  values (g, 'ida', 'Santa Maria', 'Alegrete', now() + interval '1 day', 'Plataforma', 2) returning id into vaga;
  perform pg_temp.como(g2);
  j := public.gf_falar_com_parceiro('vaga', vaga);
  execute 'reset role';
  perform pg_temp.checa(j->>'whatsapp' = '55999991002' and exists (select 1 from public.gf_avisos where user_id = g and titulo = 'Colega quer sua vaga'), 'vaga: contato e aviso'); ok := ok + 1;

  -- recusas
  perform pg_temp.como(g);
  begin perform public.gf_falar_com_parceiro('vaga', vaga); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro = 'Este anúncio é seu.', 'não chama o próprio anúncio'); ok := ok + 1;
  perform pg_temp.como(g3);
  begin perform public.gf_falar_com_parceiro('vaga', vaga); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Só guincheiros aprovados%', 'não aprovado não pega contato'); ok := ok + 1;
  perform pg_temp.como(c);
  begin perform public.gf_falar_com_parceiro('caminhao', cam); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Só guincheiros aprovados%', 'cliente não pega contato'); ok := ok + 1;
  perform pg_temp.como(g);
  update public.gf_caminhoes set status = 'encerrado' where id = cam;
  perform pg_temp.como(g2);
  begin perform public.gf_falar_com_parceiro('caminhao', cam); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Anúncio não encontrado%', 'anúncio encerrado não dá contato'); ok := ok + 1;

  -- interesses: dono e interessado veem; terceiros não; ninguém grava direto
  select count(*) into n from public.gf_interesses where dono_id = g;
  perform pg_temp.checa(n = 2, 'interessado vê os próprios contatos'); ok := ok + 1;
  begin insert into public.gf_interesses(user_id, alvo_tipo, alvo_id, dono_id) values (g2, 'vaga', vaga, g); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'interesse não é gravado direto'); ok := ok + 1;
  perform pg_temp.como(g3);
  select count(*) into n from public.gf_interesses;
  perform pg_temp.checa(n = 0, 'terceiro não vê interesses'); ok := ok + 1;
  perform pg_temp.como(null);
  begin perform public.gf_falar_com_parceiro('vaga', vaga); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante sem login não usa a função'); ok := ok + 1;
  begin perform 1 from public.gf_caminhoes; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante não lê caminhões'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
