-- GF · Acompanhamento sem login, código de chegada, chat do atendimento e vistoria de entrega.

-- 1) Segredos do atendimento: link de acompanhamento (token) e código de chegada.
--    Ninguém lê a tabela direto; só pelas funções abaixo (o guincheiro nunca vê o código).
create table if not exists public.gf_pedido_segredos (
  pedido_id uuid primary key references public.gf_pedidos(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  codigo text not null check (codigo ~ '^[0-9]{4}$'),
  tentativas int not null default 0,
  criado_em timestamptz not null default now()
);
alter table public.gf_pedido_segredos enable row level security;
revoke all on public.gf_pedido_segredos from anon, authenticated;

alter table public.gf_pedidos add column if not exists chegada_confirmada_em timestamptz;

-- gera (ou renova) quando um guincheiro assume o atendimento
create or replace function public.gf__pedido_segredos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.prestador_id is not null and new.prestador_id is distinct from old.prestador_id then
    insert into public.gf_pedido_segredos(pedido_id, token, codigo, tentativas)
    values (new.id, gen_random_uuid(), lpad((floor(random() * 10000))::int::text, 4, '0'), 0)
    on conflict (pedido_id) do update set token = excluded.token, codigo = excluded.codigo, tentativas = 0, criado_em = now();
    new.chegada_confirmada_em := null;
  end if;
  return new;
end $$;
drop trigger if exists gf_pedido_segredos_trg on public.gf_pedidos;
create trigger gf_pedido_segredos_trg before update of prestador_id on public.gf_pedidos
  for each row execute function public.gf__pedido_segredos();

-- link e código para quem participa (o código só para quem pediu)
create or replace function public.gf_meu_acompanhamento(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_s public.gf_pedido_segredos;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido;
  if not found or auth.uid() not in (coalesce(v_ped.autor_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(v_ped.prestador_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    perform public.gf__erro('Você não participa deste atendimento.');
  end if;
  select * into v_s from public.gf_pedido_segredos where pedido_id = p_pedido;
  if not found or v_ped.prestador_id is null then return null; end if;
  return jsonb_build_object('token', v_s.token,
    'codigo', case when v_ped.autor_id = auth.uid() then v_s.codigo end,
    'chegada_confirmada_em', v_ped.chegada_confirmada_em);
end $$;
revoke all on function public.gf_meu_acompanhamento(uuid) from public, anon;
grant execute on function public.gf_meu_acompanhamento(uuid) to authenticated;

-- guincheiro digita o código que o cliente passa na chegada
create or replace function public.gf_confirmar_chegada(p_pedido uuid, p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_s public.gf_pedido_segredos;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido for update;
  if not found or v_ped.prestador_id is distinct from auth.uid() then perform public.gf__erro('Você não atende este pedido.'); end if;
  if v_ped.status not in ('aceito', 'a_caminho', 'no_local', 'em_transporte') then perform public.gf__erro('O atendimento não está em andamento.'); end if;
  if v_ped.chegada_confirmada_em is not null then return; end if;
  select * into v_s from public.gf_pedido_segredos where pedido_id = p_pedido for update;
  if not found then perform public.gf__erro('Código ainda não gerado para este atendimento.'); end if;
  if v_s.tentativas >= 5 then perform public.gf__erro('Muitas tentativas. Peça ao cliente para conferir o código no app dele e fale com o GF.'); end if;
  if btrim(coalesce(p_codigo, '')) <> v_s.codigo then
    update public.gf_pedido_segredos set tentativas = tentativas + 1 where pedido_id = p_pedido;
    perform public.gf__erro('Código incorreto. Confira com o cliente.');
  end if;
  update public.gf_pedidos set chegada_confirmada_em = now(), atualizado_em = now(),
    status = case when status in ('aceito', 'a_caminho') then 'no_local' else status end
  where id = p_pedido;
  if v_ped.status in ('aceito', 'a_caminho') then
    perform public.gf__evento(p_pedido, 'status', v_ped.status, 'no_local', 'Chegada confirmada pelo código do cliente');
  else
    perform public.gf__evento(p_pedido, 'chegada', null, null, 'Chegada confirmada pelo código do cliente');
  end if;
end $$;
revoke all on function public.gf_confirmar_chegada(uuid, text) from public, anon;
grant execute on function public.gf_confirmar_chegada(uuid, text) to authenticated;

-- página pública de acompanhamento (sem login): só o necessário para o cliente final
create or replace function public.gf_acompanhar(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s public.gf_pedido_segredos; v_ped public.gf_pedidos; v_g public.gf_perfis; v_loc public.gf_localizacoes; v_ev jsonb;
begin
  select * into v_s from public.gf_pedido_segredos where token = p_token;
  if not found then return null; end if;
  select * into v_ped from public.gf_pedidos where id = v_s.pedido_id;
  if not found or v_ped.prestador_id is null or v_ped.status in ('aberto', 'cancelado') then return null; end if;
  if v_ped.status = 'concluido' and v_ped.concluido_em < now() - interval '7 days' then return null; end if;
  select * into v_g from public.gf_perfis where id = v_ped.prestador_id;
  if v_ped.status in ('aceito', 'a_caminho', 'no_local', 'em_transporte') then
    select * into v_loc from public.gf_localizacoes where pedido_id = v_ped.id and atualizado_em > now() - interval '2 hours';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('status', e.status_novo, 'em', e.criado_em) order by e.criado_em), '[]'::jsonb) into v_ev
  from public.gf_eventos e where e.pedido_id = v_ped.id and e.tipo = 'status';
  return jsonb_build_object(
    'origem', v_ped.origem, 'destino', v_ped.destino, 'veiculo', v_ped.veiculo, 'status', v_ped.status,
    'guincheiro', split_part(coalesce(v_g.nome, ''), ' ', 1), 'empresa', v_g.empresa, 'equipamento', v_g.equipamento, 'placa', v_g.placa,
    'aceito_em', v_ped.aceito_em, 'concluido_em', v_ped.concluido_em, 'chegada_confirmada_em', v_ped.chegada_confirmada_em,
    'local', case when v_loc.pedido_id is null then null else jsonb_build_object('lat', v_loc.lat, 'lng', v_loc.lng, 'em', v_loc.atualizado_em) end,
    'etapas', v_ev);
end $$;
revoke all on function public.gf_acompanhar(uuid) from public;
grant execute on function public.gf_acompanhar(uuid) to anon, authenticated;

-- segredos para atendimentos já em andamento
insert into public.gf_pedido_segredos(pedido_id, codigo)
select id, lpad((floor(random() * 10000))::int::text, 4, '0') from public.gf_pedidos
where prestador_id is not null and status in ('aceito', 'a_caminho', 'no_local', 'em_transporte')
on conflict (pedido_id) do nothing;

-- 2) Chat do atendimento (cliente ↔ guincheiro)
create table if not exists public.gf_mensagens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.gf_pedidos(id) on delete cascade,
  autor_id uuid not null references public.gf_perfis(id) on delete cascade,
  texto text not null check (char_length(btrim(texto)) between 1 and 1000),
  criado_em timestamptz not null default now()
);
create index if not exists gf_mensagens_pedido_idx on public.gf_mensagens(pedido_id, criado_em);
alter table public.gf_mensagens enable row level security;
drop policy if exists gf_msg_sel on public.gf_mensagens;
create policy gf_msg_sel on public.gf_mensagens for select to authenticated using (
  exists (select 1 from public.gf_pedidos p where p.id = pedido_id
          and ((select auth.uid()) in (p.autor_id, p.prestador_id))) or public.gf_is_admin());
revoke all on public.gf_mensagens from anon, authenticated;
grant select on public.gf_mensagens to authenticated;

create or replace function public.gf_enviar_mensagem(p_pedido uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos; v_id uuid; v_para uuid; v_nome text; v_txt text := btrim(coalesce(p_texto, ''));
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido;
  if not found or v_ped.prestador_id is null or auth.uid() not in (v_ped.autor_id, v_ped.prestador_id) then
    perform public.gf__erro('O chat abre quando o guincheiro é escolhido.');
  end if;
  if v_ped.status = 'cancelado' or (v_ped.status = 'concluido' and v_ped.concluido_em < now() - interval '7 days') then
    perform public.gf__erro('Este atendimento já foi encerrado.');
  end if;
  if char_length(v_txt) < 1 or char_length(v_txt) > 1000 then perform public.gf__erro('Escreva uma mensagem de até 1000 caracteres.'); end if;
  if (select count(*) from public.gf_mensagens where autor_id = auth.uid() and criado_em > now() - interval '1 minute') >= 15 then
    perform public.gf__erro('Muitas mensagens seguidas. Espere um pouco.');
  end if;
  insert into public.gf_mensagens(pedido_id, autor_id, texto) values (p_pedido, auth.uid(), v_txt) returning id into v_id;
  v_para := case when auth.uid() = v_ped.autor_id then v_ped.prestador_id else v_ped.autor_id end;
  select split_part(nome, ' ', 1) into v_nome from public.gf_perfis where id = auth.uid();
  if not exists (select 1 from public.gf_avisos where user_id = v_para and pedido_id = p_pedido and tipo = 'mensagem'
                 and criado_em > now() - interval '2 minutes') then
    perform public.gf__avisar(v_para, 'mensagem', 'Mensagem de ' || coalesce(v_nome, 'GF'), left(v_txt, 140), '#pedido/' || p_pedido, p_pedido);
  end if;
  return v_id;
end $$;
revoke all on function public.gf_enviar_mensagem(uuid, text) from public, anon;
grant execute on function public.gf_enviar_mensagem(uuid, text) to authenticated;

-- 3) Vistoria de entrega (a de retirada continua igual)
drop policy if exists gf_vist_obj_ins on storage.objects;
drop policy if exists gf_vist_obj_upd on storage.objects;
create policy gf_vist_obj_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'gf-vistorias' and public.gf_eh_prestador_pedido((storage.foldername(name))[1])
  and not exists (select 1 from public.gf_vistorias v where v.id::text = (storage.foldername(name))[2]));
create policy gf_vist_obj_upd on storage.objects for update to authenticated using (
  bucket_id = 'gf-vistorias' and public.gf_eh_prestador_pedido((storage.foldername(name))[1])
  and not exists (select 1 from public.gf_vistorias v where v.id::text = (storage.foldername(name))[2]));

create or replace function public.gf_salvar_vistoria(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_ped public.gf_pedidos; v_pref text; f jsonb; v_rel text := p->>'responsavel_relacao';
  v_tipo text := coalesce(nullif(p->>'tipo', ''), 'retirada'); v_nome text;
begin
  if v_tipo not in ('retirada', 'entrega') then perform public.gf__erro('Tipo de vistoria inválido.'); end if;
  select * into v_ped from public.gf_pedidos where id = (p->>'pedido_id')::uuid;
  if not found or v_ped.prestador_id is distinct from auth.uid() then perform public.gf__erro('Só o guincheiro deste atendimento faz a vistoria.'); end if;
  if exists (select 1 from public.gf_vistorias where id = v_id) then return v_id; end if; -- reenvio do celular
  if exists (select 1 from public.gf_vistorias where pedido_id = v_ped.id and tipo = v_tipo) then
    perform public.gf__erro(case v_tipo when 'retirada' then 'Este atendimento já tem vistoria.' else 'Este atendimento já tem vistoria de entrega.' end);
  end if;
  if v_tipo = 'retirada' and v_ped.status not in ('aceito', 'a_caminho', 'no_local', 'em_transporte') then
    perform public.gf__erro('A vistoria é feita durante o atendimento.');
  end if;
  if v_tipo = 'entrega' and not (v_ped.status = 'em_transporte' or (v_ped.status = 'concluido' and v_ped.concluido_em > now() - interval '24 hours')) then
    perform public.gf__erro('A vistoria de entrega é feita no destino, com o veículo carregado.');
  end if;
  v_pref := v_ped.id::text || '/' || v_id::text || '/';
  for f in select * from jsonb_array_elements(coalesce(p->'fotos', '[]'::jsonb)) loop
    if left(f->>'path', length(v_pref)) <> v_pref then perform public.gf__erro('Foto fora da pasta da vistoria.'); end if;
  end loop;
  if p->>'assinatura_path' is not null and left(p->>'assinatura_path', length(v_pref)) <> v_pref then
    perform public.gf__erro('Assinatura fora da pasta da vistoria.');
  end if;
  if v_rel <> 'ausente' and char_length(btrim(coalesce(p->>'responsavel_nome', ''))) < 2 then
    perform public.gf__erro('Informe o nome de quem assina.');
  end if;
  insert into public.gf_vistorias(id, pedido_id, guincheiro_id, tipo, fotos, avarias, checklist, obs,
    responsavel_nome, responsavel_relacao, assinatura_path, feita_em)
  values (v_id, v_ped.id, auth.uid(), v_tipo, coalesce(p->'fotos', '[]'::jsonb), coalesce(p->'avarias', '[]'::jsonb),
    coalesce(p->'checklist', '{}'::jsonb), nullif(btrim(p->>'obs'), ''),
    case when v_rel = 'ausente' then null else btrim(p->>'responsavel_nome') end, v_rel,
    case when v_rel = 'ausente' then null else p->>'assinatura_path' end,
    least(coalesce((p->>'feita_em')::timestamptz, now()), now()));
  v_nome := case v_tipo when 'retirada' then 'retirada' else 'entrega' end;
  perform public.gf__evento(v_ped.id, 'vistoria', null, null,
    'Vistoria de ' || v_nome || ': ' || jsonb_array_length(coalesce(p->'fotos', '[]'::jsonb)) || ' fotos, '
    || jsonb_array_length(coalesce(p->'avarias', '[]'::jsonb)) || ' avaria(s) marcada(s)');
  perform public.gf__avisar(v_ped.autor_id, 'vistoria', 'Vistoria de ' || v_nome || ' registrada',
    v_ped.origem || ' › ' || v_ped.destino || ' · veja fotos e avarias no app', '#vistoria/' || v_id, v_ped.id);
  return v_id;
exception when check_violation then
  perform public.gf__erro('Vistoria incompleta: confira fotos (mínimo 4) e assinatura.');
end $$;
