-- Vistoria digital (termo de constatação) no recolhimento do veículo.
-- O guincheiro do atendimento registra fotos, avarias marcadas no desenho do
-- carro, checklist e a assinatura do responsável. Fotos e assinatura ficam no
-- bucket privado "gf-vistorias", na pasta do pedido. Só quem participa do
-- atendimento (cliente, guincheiro) e o admin veem. Uma vez concluída, a
-- vistoria não muda (vale como registro). Só adiciona objetos novos.

create table if not exists public.gf_vistorias (
  id uuid primary key,                                   -- gerado no celular (envio repetido sem sinal não duplica)
  pedido_id uuid not null references public.gf_pedidos(id) on delete cascade,
  guincheiro_id uuid not null references public.gf_perfis(id) on delete cascade,
  tipo text not null default 'retirada' check (tipo in ('retirada', 'entrega')),
  fotos jsonb not null default '[]'::jsonb,              -- [{"slot":"frente","path":"<pedido>/<vistoria>/frente.jpg"}]
  avarias jsonb not null default '[]'::jsonb,            -- [{"x":0.31,"y":0.12,"tipo":"risco"}] (x/y de 0 a 1 no desenho)
  checklist jsonb not null default '{}'::jsonb,          -- {"estepe":true,...,"combustivel":"1/2","km":123456}
  obs text check (coalesce(char_length(obs), 0) <= 1000),
  responsavel_nome text check (coalesce(char_length(responsavel_nome), 0) <= 80),
  responsavel_relacao text check (responsavel_relacao in ('proprietario', 'condutor', 'terceiro', 'ausente')),
  assinatura_path text,
  feita_em timestamptz not null,                         -- hora no celular (pode ter sido sem sinal)
  recebida_em timestamptz not null default now(),
  unique (pedido_id, tipo),
  constraint gf_vistorias_fotos_chk check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) between 4 and 8),
  constraint gf_vistorias_avarias_chk check (jsonb_typeof(avarias) = 'array' and jsonb_array_length(avarias) <= 40),
  constraint gf_vistorias_assinatura_chk check (responsavel_relacao = 'ausente' or assinatura_path is not null)
);
create index if not exists gf_vistorias_pedido_idx on public.gf_vistorias(pedido_id);

alter table public.gf_vistorias enable row level security;
drop policy if exists gf_vist_sel on public.gf_vistorias;
create policy gf_vist_sel on public.gf_vistorias for select to authenticated using (
  guincheiro_id = (select auth.uid()) or public.gf_eh_autor_pedido(pedido_id) or public.gf_is_admin());
revoke all on public.gf_vistorias from anon, authenticated;
grant select on public.gf_vistorias to authenticated;

-- quem é o guincheiro do pedido (para as regras dos arquivos)
create or replace function public.gf_eh_prestador_pedido(p_pedido text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_pedidos where id::text = p_pedido and prestador_id = auth.uid())
$$;
create or replace function public.gf_participa_pedido_txt(p_pedido text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_pedidos where id::text = p_pedido
                  and (prestador_id = auth.uid() or autor_id = auth.uid())) or public.gf_is_admin()
$$;

-- bucket privado; até 3 MB por arquivo, só imagens
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gf-vistorias', 'gf-vistorias', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gf_vist_obj_ins on storage.objects;
drop policy if exists gf_vist_obj_upd on storage.objects;
drop policy if exists gf_vist_obj_sel on storage.objects;
-- envio: só o guincheiro do pedido, na pasta do pedido, e só enquanto não há vistoria concluída
create policy gf_vist_obj_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'gf-vistorias' and public.gf_eh_prestador_pedido((storage.foldername(name))[1])
  and not exists (select 1 from public.gf_vistorias v where v.pedido_id::text = (storage.foldername(name))[1]));
create policy gf_vist_obj_upd on storage.objects for update to authenticated using (
  bucket_id = 'gf-vistorias' and public.gf_eh_prestador_pedido((storage.foldername(name))[1])
  and not exists (select 1 from public.gf_vistorias v where v.pedido_id::text = (storage.foldername(name))[1]));
create policy gf_vist_obj_sel on storage.objects for select to authenticated using (
  bucket_id = 'gf-vistorias' and public.gf_participa_pedido_txt((storage.foldername(name))[1]));

-- concluir a vistoria (chamado depois de enviar fotos e assinatura)
create or replace function public.gf_salvar_vistoria(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_ped public.gf_pedidos; v_pref text; f jsonb; v_rel text := p->>'responsavel_relacao';
begin
  select * into v_ped from public.gf_pedidos where id = (p->>'pedido_id')::uuid;
  if not found or v_ped.prestador_id is distinct from auth.uid() then perform public.gf__erro('Só o guincheiro deste atendimento faz a vistoria.'); end if;
  if exists (select 1 from public.gf_vistorias where id = v_id) then return v_id; end if; -- reenvio do celular
  if exists (select 1 from public.gf_vistorias where pedido_id = v_ped.id and tipo = 'retirada') then
    perform public.gf__erro('Este atendimento já tem vistoria.');
  end if;
  if v_ped.status not in ('aceito', 'a_caminho', 'no_local', 'em_transporte') then
    perform public.gf__erro('A vistoria é feita durante o atendimento.');
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
  values (v_id, v_ped.id, auth.uid(), 'retirada', coalesce(p->'fotos', '[]'::jsonb), coalesce(p->'avarias', '[]'::jsonb),
    coalesce(p->'checklist', '{}'::jsonb), nullif(btrim(p->>'obs'), ''),
    case when v_rel = 'ausente' then null else btrim(p->>'responsavel_nome') end, v_rel,
    case when v_rel = 'ausente' then null else p->>'assinatura_path' end,
    least(coalesce((p->>'feita_em')::timestamptz, now()), now()));
  perform public.gf__evento(v_ped.id, 'vistoria', null, null,
    'Vistoria de retirada: ' || jsonb_array_length(coalesce(p->'fotos', '[]'::jsonb)) || ' fotos, '
    || jsonb_array_length(coalesce(p->'avarias', '[]'::jsonb)) || ' avaria(s) marcada(s)');
  perform public.gf__avisar(v_ped.autor_id, 'vistoria', 'Vistoria do seu veículo registrada',
    v_ped.origem || ' › ' || v_ped.destino || ' · veja fotos e avarias no app', '#vistoria/' || v_id, v_ped.id);
  return v_id;
exception when check_violation then
  perform public.gf__erro('Vistoria incompleta: confira fotos (mínimo 4) e assinatura.');
end $$;

revoke all on function public.gf_eh_prestador_pedido(text), public.gf_participa_pedido_txt(text) from public, anon;
grant execute on function public.gf_eh_prestador_pedido(text), public.gf_participa_pedido_txt(text) to authenticated;
revoke all on function public.gf_salvar_vistoria(jsonb) from public, anon;
grant execute on function public.gf_salvar_vistoria(jsonb) to authenticated;
