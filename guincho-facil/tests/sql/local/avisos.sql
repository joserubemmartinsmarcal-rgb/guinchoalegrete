create or replace function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  if u is null then perform set_config('request.jwt.claims', '{"role":"anon"}', true); execute 'set local role anon';
  else perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); execute 'set local role authenticated'; end if;
end $$;
create or replace function pg_temp.checa(cond boolean, nome text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FALHA: %', nome; end if; end $$;
do $t$
declare c uuid := gen_random_uuid(); g uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); gi uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  ped uuid; n int; erro text; ok int := 0; an uuid;
begin
  insert into public.gf_perfis(id, tipo, nome, aprovacao, disponivel, is_admin) values
    (c,'cliente','C','aprovado',false,false),(g,'guincheiro','G','aprovado',true,false),(g2,'guincheiro','G2','aprovado',true,false),
    (gi,'guincheiro','Gi','aprovado',false,false),(a,'empresa','A','aprovado',false,true);
  insert into public.gf__config values ('avisos_url','https://exemplo.supabase.co/functions/v1/gf-avisos'),('avisos_segredo','s3gr3d0'),('vapid_publica','BPUB');
  insert into public.gf_push values ('https://push.exemplo/c1', c, repeat('p',40), repeat('a',16), 'ua');

  insert into public.gf_pedidos(autor_id, origem, destino, veiculo) values (c,'Cacequi','Alegrete','Gol') returning id into ped;
  insert into public.gf_eventos(pedido_id, autor_id, tipo, status_novo) values (ped, c, 'criado', 'aberto');
  select count(*) into n from public.gf_avisos where pedido_id = ped and tipo = 'pedido_novo';
  perform pg_temp.checa(n = 2, 'pedido novo avisa só guincheiros aprovados e disponíveis (' || n || ')'); ok := ok + 1;
  perform pg_temp.checa(not exists (select 1 from public.gf_avisos where user_id in (c, gi) and tipo='pedido_novo'), 'não avisa cliente nem indisponível'); ok := ok + 1;

  insert into public.gf_eventos(pedido_id, autor_id, tipo, detalhe) values (ped, g, 'proposta', 'Proposta de R$ 450,00');
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and tipo = 'proposta' and corpo like '%450%' and url = '#pedido/'||ped), 'cliente recebe aviso de proposta'); ok := ok + 1;
  select count(*) into n from net.chamadas where body->>'aviso_id' in (select id::text from public.gf_avisos where user_id = c);
  perform pg_temp.checa(n = 1 and (select headers->>'x-gf-segredo' from net.chamadas order by id desc limit 1) = 's3gr3d0', 'envio ao celular só para quem tem aparelho inscrito'); ok := ok + 1;

  update public.gf_pedidos set prestador_id = g, status = 'aceito' where id = ped;
  insert into public.gf_eventos(pedido_id, autor_id, tipo, status_anterior, status_novo) values (ped, c, 'status', 'aberto', 'aceito');
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and tipo = 'escolhido'), 'guincheiro sabe que foi escolhido'); ok := ok + 1;
  insert into public.gf_eventos(pedido_id, autor_id, tipo, status_anterior, status_novo) values (ped, g, 'status', 'aceito', 'a_caminho');
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and titulo = 'Guincheiro a caminho')
    and not exists (select 1 from public.gf_avisos where user_id = g and tipo = 'status'), 'etapa avisa o cliente, não quem mudou'); ok := ok + 1;
  insert into public.gf_eventos(pedido_id, autor_id, tipo, status_anterior, status_novo) values (ped, c, 'status', 'em_transporte', 'concluido');
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and titulo = 'Atendimento concluído'), 'cliente concluiu → guincheiro avisado'); ok := ok + 1;

  -- falha no envio não derruba o evento
  update public.gf__config set valor = 'x' where chave = 'avisos_url';
  alter function net.http_post(text, jsonb, jsonb) rename to http_post_x;
  insert into public.gf_eventos(pedido_id, autor_id, tipo, detalhe) values (ped, g2, 'proposta', 'Proposta de R$ 1,00');
  alter function net.http_post_x(text, jsonb, jsonb) rename to http_post;
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = c and corpo = 'Proposta de R$ 1,00'), 'aviso fica na lista mesmo se o envio falha'); ok := ok + 1;

  -- antecipação
  insert into public.gf_antecipacoes(guincheiro_id, valor, pagador_nome) values (g, 1500, 'Seguradora X') returning id into an;
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = a and tipo = 'antecipacao_nova'), 'admin avisado de antecipação nova'); ok := ok + 1;
  update public.gf_antecipacoes set status = 'aprovado', nota_admin = 'Pago amanhã' where id = an;
  perform pg_temp.checa(exists (select 1 from public.gf_avisos where user_id = g and titulo = 'Antecipação aprovada' and corpo like '%1500,00%Pago amanhã'), 'guincheiro sabe da aprovação'); ok := ok + 1;

  -- permissões
  perform pg_temp.como(g2);
  select count(*) into n from public.gf_avisos;
  perform pg_temp.checa(n = (select count(*) from public.gf_avisos where user_id = g2), 'cada um vê só os próprios avisos'); ok := ok + 1;
  begin update public.gf_avisos set lido_em = now(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'update direto bloqueado'); ok := ok + 1;
  begin perform 1 from public.gf_push; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'inscrições não são legíveis'); ok := ok + 1;
  begin perform 1 from public.gf__config; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'configuração interna fechada'); ok := ok + 1;
  begin perform public.gf__avisar(c, 'x', 'forjado', null, null, null); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'ninguém cria aviso para outra pessoa'); ok := ok + 1;
  perform pg_temp.checa(public.gf_push_chave() = 'BPUB', 'chave pública disponível'); ok := ok + 1;
  perform public.gf_registrar_push('https://push.exemplo/c1', repeat('q',40), repeat('b',16), 'novo');
  perform pg_temp.como(null); execute 'reset role';
  perform pg_temp.checa((select user_id from public.gf_push where endpoint = 'https://push.exemplo/c1') = g2, 'aparelho trocado de conta passa para o novo dono'); ok := ok + 1;
  perform pg_temp.como(c);
  perform public.gf_remover_push('https://push.exemplo/c1');
  execute 'reset role';
  perform pg_temp.checa(exists (select 1 from public.gf_push where endpoint = 'https://push.exemplo/c1'), 'não remove aparelho de outra conta'); ok := ok + 1;
  perform pg_temp.como(g2);
  begin perform public.gf_registrar_push('http://inseguro', repeat('q',40), repeat('b',16), null); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%Não foi possível%', 'endereço inválido recusado'); ok := ok + 1;
  perform public.gf_aviso_teste();
  begin perform public.gf_aviso_teste(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%Aguarde%', 'teste limitado a 1 por minuto'); ok := ok + 1;
  perform pg_temp.como(c);
  perform pg_temp.checa(public.gf_marcar_avisos_lidos() >= 3, 'marcar lidos'); ok := ok + 1;
  perform pg_temp.checa(not exists (select 1 from public.gf_avisos where lido_em is null), 'todos os do cliente lidos'); ok := ok + 1;
  perform pg_temp.como(null);
  begin perform public.gf_push_chave(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante sem login não usa as funções'); ok := ok + 1;
  raise exception 'TESTES_OK %', ok;
end $t$;
