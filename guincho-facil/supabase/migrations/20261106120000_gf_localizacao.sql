-- Localização aproximada do guincho durante o atendimento. O app do guincheiro
-- envia a posição (com o app aberto) enquanto o serviço está em andamento; só o
-- cliente e o guincheiro daquele atendimento veem, e só enquanto ele está ativo.

create table if not exists public.gf_localizacoes (
  pedido_id uuid primary key references public.gf_pedidos(id) on delete cascade,
  guincheiro_id uuid not null references public.gf_perfis(id) on delete cascade,
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  atualizado_em timestamptz not null default now()
);
alter table public.gf_localizacoes enable row level security;
drop policy if exists gf_loc_sel on public.gf_localizacoes;
create policy gf_loc_sel on public.gf_localizacoes for select to authenticated using (
  exists (select 1 from public.gf_pedidos p where p.id = pedido_id and p.prestador_id = gf_localizacoes.guincheiro_id
          and p.status in ('aceito', 'a_caminho', 'no_local', 'em_transporte')
          and (p.autor_id = (select auth.uid()) or p.prestador_id = (select auth.uid()))));
revoke all on public.gf_localizacoes from anon, authenticated;
grant select on public.gf_localizacoes to authenticated;

create or replace function public.gf_atualizar_local(p_pedido uuid, p_lat numeric, p_lng numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.gf_pedidos;
begin
  select * into v_ped from public.gf_pedidos where id = p_pedido;
  if not found or v_ped.prestador_id is distinct from auth.uid() then perform public.gf__erro('Você não atende este pedido.'); end if;
  if v_ped.status not in ('aceito', 'a_caminho', 'no_local', 'em_transporte') then
    delete from public.gf_localizacoes where pedido_id = p_pedido; return;
  end if;
  insert into public.gf_localizacoes(pedido_id, guincheiro_id, lat, lng, atualizado_em)
  values (p_pedido, auth.uid(), round(p_lat, 6), round(p_lng, 6), now())
  on conflict (pedido_id) do update set guincheiro_id = excluded.guincheiro_id, lat = excluded.lat, lng = excluded.lng, atualizado_em = now();
end $$;
revoke all on function public.gf_atualizar_local(uuid, numeric, numeric) from public, anon;
grant execute on function public.gf_atualizar_local(uuid, numeric, numeric) to authenticated;
