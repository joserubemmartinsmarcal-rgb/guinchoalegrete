-- Testes da vistoria digital no banco real (tabela, função e regras dos arquivos).
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
  ped uuid; prop uuid; vid uuid := gen_random_uuid(); pref text; fotos jsonb; erro text; ok int := 0; n int; r uuid;
begin
  insert into auth.users(id, email, aud, role) values
    (c, 'vi-c@gf.invalid', 'authenticated', 'authenticated'), (g, 'vi-g@gf.invalid', 'authenticated', 'authenticated'),
    (g2, 'vi-g2@gf.invalid', 'authenticated', 'authenticated'), (a, 'vi-a@gf.invalid', 'authenticated', 'authenticated');
  perform pg_temp.como(c);
  perform public.gf_salvar_perfil('{"tipo":"cliente","nome":"Cliente Vistoria","cidade":"Alegrete","whatsapp":"55999993001"}');
  perform pg_temp.como(g);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Guincho Vistoria","cidade":"Santa Maria","whatsapp":"55999993002","equipamento":"Plataforma"}');
  perform pg_temp.como(g2);
  perform public.gf_salvar_perfil('{"tipo":"guincheiro","nome":"Outro Guincho","cidade":"Cacequi","whatsapp":"55999993003","equipamento":"Plataforma"}');
  execute 'reset role';
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values (a, 'empresa', 'Admin Vistoria', 'Alegrete', '55999993004', 'aprovado', true);
  perform pg_temp.como(a);
  perform public.gf_admin_aprovar(g, 'aprovado', null);
  perform public.gf_admin_aprovar(g2, 'aprovado', null);
  perform pg_temp.como(c);
  insert into public.gf_pedidos(origem, destino, veiculo) values ('Cacequi', 'Alegrete', 'Gol 2015') returning id into ped;
  perform pg_temp.como(g);
  prop := public.gf_enviar_proposta(ped, 400, 'hoje', null);
  pref := ped::text || '/' || vid::text || '/';
  fotos := jsonb_build_array(jsonb_build_object('slot','frente','path',pref||'frente.jpg'), jsonb_build_object('slot','traseira','path',pref||'traseira.jpg'),
    jsonb_build_object('slot','esquerda','path',pref||'esquerda.jpg'), jsonb_build_object('slot','direita','path',pref||'direita.jpg'));

  -- antes do aceite, o guincheiro não envia arquivos
  begin insert into storage.objects(bucket_id, name, owner) values ('gf-vistorias', pref || 'frente.jpg', g); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%row-level security%', 'sem aceite não envia fotos'); ok := ok + 1;

  perform pg_temp.como(c);
  perform public.gf_aceitar_proposta(prop);

  -- guincheiro do atendimento envia; outro guincheiro e cliente não
  perform pg_temp.como(g);
  insert into storage.objects(bucket_id, name, owner) values ('gf-vistorias', pref || 'frente.jpg', g);
  perform pg_temp.checa(true, 'guincheiro envia foto na pasta do pedido'); ok := ok + 1;
  perform pg_temp.como(g2);
  begin insert into storage.objects(bucket_id, name, owner) values ('gf-vistorias', pref || 'x.jpg', g2); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%row-level security%', 'outro guincheiro não envia'); ok := ok + 1;
  select count(*) into n from storage.objects where bucket_id = 'gf-vistorias' and name like ped::text || '/%';
  perform pg_temp.checa(n = 0, 'outro guincheiro não vê as fotos'); ok := ok + 1;
  perform pg_temp.como(c);
  select count(*) into n from storage.objects where bucket_id = 'gf-vistorias' and name like ped::text || '/%';
  perform pg_temp.checa(n = 1, 'cliente vê as fotos do seu pedido'); ok := ok + 1;

  -- regras da conclusão
  perform pg_temp.como(g2);
  begin perform public.gf_salvar_vistoria(jsonb_build_object('id', vid, 'pedido_id', ped, 'fotos', fotos, 'responsavel_relacao', 'ausente')); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Só o guincheiro%', 'outro guincheiro não conclui'); ok := ok + 1;
  perform pg_temp.como(g);
  begin perform public.gf_salvar_vistoria(jsonb_build_object('id', vid, 'pedido_id', ped, 'fotos', fotos - 3, 'responsavel_relacao', 'ausente')); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Vistoria incompleta%', 'mínimo de 4 fotos'); ok := ok + 1;
  begin perform public.gf_salvar_vistoria(jsonb_build_object('id', vid, 'pedido_id', ped, 'fotos', fotos, 'responsavel_relacao', 'proprietario', 'responsavel_nome', 'Maria')); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Vistoria incompleta%', 'assinatura obrigatória com responsável presente'); ok := ok + 1;
  begin perform public.gf_salvar_vistoria(jsonb_build_object('id', vid, 'pedido_id', ped, 'fotos',
      fotos || jsonb_build_array(jsonb_build_object('slot','avaria1','path','outro-pedido/x.jpg')), 'responsavel_relacao', 'ausente')); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like 'Foto fora da pasta%', 'foto de outra pasta é recusada'); ok := ok + 1;

  r := public.gf_salvar_vistoria(jsonb_build_object('id', vid, 'pedido_id', ped, 'fotos', fotos,
    'avarias', '[{"x":0.3,"y":0.2,"tipo":"risco"}]'::jsonb, 'checklist', '{"estepe":true,"combustivel":"1/2"}'::jsonb,
    'responsavel_relacao', 'proprietario', 'responsavel_nome', ' Maria Silva ', 'assinatura_path', pref || 'assinatura.png',
    'feita_em', (now() - interval '20 minutes')::text));
  perform pg_temp.checa(r = vid, 'vistoria concluída'); ok := ok + 1;
  perform pg_temp.checa(public.gf_salvar_vistoria(jsonb_build_object('id', vid, 'pedido_id', ped)) = vid, 'reenvio do celular não duplica'); ok := ok + 1;
  begin insert into storage.objects(bucket_id, name, owner) values ('gf-vistorias', pref || 'depois.jpg', g); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%row-level security%', 'depois de concluída não aceita mais arquivos'); ok := ok + 1;
  begin perform public.gf_salvar_vistoria(jsonb_build_object('id', gen_random_uuid(), 'pedido_id', ped, 'fotos', fotos, 'responsavel_relacao', 'ausente')); erro := null;
  exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro = 'Este atendimento já tem vistoria.', 'uma vistoria por atendimento'); ok := ok + 1;

  execute 'reset role';
  perform pg_temp.checa((select responsavel_nome = 'Maria Silva' and feita_em < now() - interval '10 minutes' from public.gf_vistorias where id = vid), 'dados gravados'); ok := ok + 1;
  perform pg_temp.checa(exists (select 1 from public.gf_eventos where pedido_id = ped and tipo = 'vistoria'), 'histórico registra a vistoria'); ok := ok + 1;
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and tipo = 'vistoria' and url = '#vistoria/' || vid), 'cliente é avisado'); ok := ok + 1;

  -- quem vê a vistoria
  perform pg_temp.como(c);
  perform pg_temp.checa(exists (select 1 from public.gf_vistorias where id = vid), 'cliente vê a vistoria'); ok := ok + 1;
  perform pg_temp.como(g2);
  perform pg_temp.checa(not exists (select 1 from public.gf_vistorias where id = vid), 'outro guincheiro não vê'); ok := ok + 1;
  perform pg_temp.como(g);
  begin update public.gf_vistorias set obs = 'mudado' where id = vid; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'vistoria não é alterada depois de concluída'); ok := ok + 1;
  perform pg_temp.como(null);
  begin perform 1 from public.gf_vistorias; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante não lê vistorias'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
