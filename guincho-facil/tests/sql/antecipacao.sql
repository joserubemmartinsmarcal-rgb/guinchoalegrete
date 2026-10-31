-- Testes da antecipação de recebíveis. Roda depois da migração
-- 20261029150000_gf_antecipacao.sql, numa transação que termina com
-- "TESTES_OK" para nada ficar gravado.
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
  id1 uuid; n int; j jsonb; erro text; ok int := 0;
  base jsonb := jsonb_build_object('valor','1.500,00','pagador_tipo','seguradora','pagador_nome','Assistência X','forma','boleto',
    'vencimento', (current_date + 30)::text, 'pessoa','mei','consentimento',true);
begin
  insert into auth.users(id, email, aud, role) values (c,'t-c@gf.invalid','authenticated','authenticated'),
    (g,'t-g@gf.invalid','authenticated','authenticated'),(g2,'t-g2@gf.invalid','authenticated','authenticated'),(a,'t-a@gf.invalid','authenticated','authenticated');
  insert into public.gf_perfis(id, tipo, nome, cidade, whatsapp, aprovacao, is_admin) values
    (c,'cliente','Cliente','Alegrete','55999990001','aprovado',false),
    (g,'guincheiro','Guincho Um','Santa Maria','55999990002','pendente',false),
    (g2,'guincheiro','Guincho Dois','Cacequi','55999990003','aprovado',false),
    (a,'empresa','Admin','Alegrete','55999990004','aprovado',true);

  perform pg_temp.como(c);
  begin perform public.gf_pedir_antecipacao(base || '{"valor":"1500"}'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%guincheiros%', 'cliente não pede antecipação'); ok := ok + 1;

  perform pg_temp.como(g);
  begin perform public.gf_pedir_antecipacao(base || '{"valor":1500,"consentimento":false}'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%Autorize%', 'exige consentimento'); ok := ok + 1;
  begin perform public.gf_pedir_antecipacao(base || '{"valor":1500,"forma":"ted"}'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%TED%', 'TED recusado'); ok := ok + 1;
  begin perform public.gf_pedir_antecipacao(base || jsonb_build_object('valor',1500,'vencimento',current_date::text)); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%futura%', 'vencimento precisa ser futuro'); ok := ok + 1;
  begin perform public.gf_pedir_antecipacao(base || '{"valor":1500,"pessoa":"xx"}'); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%Confira%', 'campo inválido recusado'); ok := ok + 1;

  id1 := public.gf_pedir_antecipacao(base || '{"valor":1500.5}');
  perform pg_temp.checa(id1 is not null, 'guincheiro pendente pode pedir'); ok := ok + 1;
  select count(*) into n from public.gf_antecipacoes where id = id1 and status = 'recebido' and guincheiro_id = g and valor = 1500.5;
  perform pg_temp.checa(n = 1, 'guincheiro vê o próprio pedido'); ok := ok + 1;

  begin insert into public.gf_antecipacoes(guincheiro_id, valor, pagador_tipo, pagador_nome, forma, vencimento, pessoa, consentimento_em)
    values (g, 10, 'empresa', 'XX', 'boleto', current_date + 5, 'pf', now()); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'insert direto bloqueado'); ok := ok + 1;
  begin update public.gf_antecipacoes set status = 'aprovado' where id = id1; erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'guincheiro não muda status'); ok := ok + 1;
  begin perform public.gf_admin_antecipacoes(); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%restrito%', 'guincheiro não vê lista do admin'); ok := ok + 1;

  perform pg_temp.como(g2);
  select count(*) into n from public.gf_antecipacoes where id = id1;
  perform pg_temp.checa(n = 0, 'outro guincheiro não vê o pedido'); ok := ok + 1;
  begin perform public.gf_cancelar_antecipacao(id1); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro is not null, 'outro guincheiro não cancela'); ok := ok + 1;

  perform pg_temp.como(null);
  begin perform public.gf_pedir_antecipacao(base); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%permission denied%', 'visitante sem login não pede'); ok := ok + 1;

  perform pg_temp.como(a);
  j := public.gf_admin_antecipacoes();
  perform pg_temp.checa(j->0->>'nome' = 'Guincho Um' and j->0->>'whatsapp' = '55999990002', 'admin vê pedido com contato'); ok := ok + 1;
  perform public.gf_admin_tratar_antecipacao(id1, 'enviado', 'Mandado ao Bernardo');
  perform pg_temp.como(g);
  select count(*) into n from public.gf_antecipacoes where id = id1 and status = 'enviado' and nota_admin = 'Mandado ao Bernardo';
  perform pg_temp.checa(n = 1, 'guincheiro vê status e nota do admin'); ok := ok + 1;
  perform public.gf_cancelar_antecipacao(id1);
  begin perform public.gf_cancelar_antecipacao(id1); erro := null; exception when others then erro := sqlerrm; end;
  perform pg_temp.checa(erro like '%não pode%', 'não cancela duas vezes'); ok := ok + 1;

  raise exception 'TESTES_OK %', ok;
end $t$;
