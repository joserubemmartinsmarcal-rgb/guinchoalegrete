-- GF · Financeiro do guincheiro: ordens de serviço (OS), contas a receber, custos e lucro.
-- Cada guincheiro só vê as próprias OS. Atendimento concluído pelo GF vira OS sozinho;
-- serviços de fora (seguradora, particular, empresa) entram à mão.

create table if not exists public.gf_os (
  id uuid primary key default gen_random_uuid(),
  guincheiro_id uuid not null default auth.uid() references public.gf_perfis(id) on delete cascade,
  numero int not null,
  pedido_id uuid unique references public.gf_pedidos(id) on delete set null,
  data date not null default current_date,
  cliente text not null check (char_length(btrim(cliente)) between 2 and 120),
  pagador_tipo text not null default 'particular' check (pagador_tipo in ('particular', 'seguradora', 'assistencia', 'empresa', 'colega', 'outro')),
  origem text check (char_length(origem) <= 80),
  destino text check (char_length(destino) <= 80),
  veiculo text check (char_length(veiculo) <= 80),
  placa text check (placa is null or char_length(placa) <= 8),
  km numeric(8,1) check (km is null or km between 0 and 99999),
  valor numeric(12,2) not null check (valor between 0 and 1000000),
  forma text not null default 'pix' check (forma in ('pix', 'dinheiro', 'cartao', 'boleto', 'faturado', 'transferencia', 'outro')),
  status text not null default 'a_receber' check (status in ('a_receber', 'pago', 'cancelada')),
  vencimento date,
  pago_em date,
  custo_diesel numeric(12,2) not null default 0 check (custo_diesel between 0 and 1000000),
  custo_pedagio numeric(12,2) not null default 0 check (custo_pedagio between 0 and 1000000),
  custo_outros numeric(12,2) not null default 0 check (custo_outros between 0 and 1000000),
  comissao numeric(12,2) not null default 0 check (comissao between 0 and 1000000),
  motorista text check (char_length(motorista) <= 80),
  obs text check (char_length(obs) <= 1000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (guincheiro_id, numero)
);
create index if not exists gf_os_dono_data_idx on public.gf_os(guincheiro_id, data desc);

-- número sequencial por guincheiro e carimbos de data
create or replace function public.gf__os_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.guincheiro_id := coalesce(new.guincheiro_id, auth.uid());
    perform pg_advisory_xact_lock(hashtext('gf_os_' || new.guincheiro_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from public.gf_os where guincheiro_id = new.guincheiro_id;
  else
    new.guincheiro_id := old.guincheiro_id; new.numero := old.numero; new.pedido_id := old.pedido_id; new.criado_em := old.criado_em;
  end if;
  if new.status = 'pago' and new.pago_em is null then new.pago_em := current_date; end if;
  if new.status <> 'pago' then new.pago_em := null; end if;
  new.cliente := btrim(new.cliente);
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists gf_os_antes on public.gf_os;
create trigger gf_os_antes before insert or update on public.gf_os for each row execute function public.gf__os_antes();

alter table public.gf_os enable row level security;
drop policy if exists gf_os_sel on public.gf_os;
drop policy if exists gf_os_ins on public.gf_os;
drop policy if exists gf_os_upd on public.gf_os;
drop policy if exists gf_os_del on public.gf_os;
create policy gf_os_sel on public.gf_os for select to authenticated using (guincheiro_id = (select auth.uid()));
create policy gf_os_ins on public.gf_os for insert to authenticated with check (guincheiro_id = (select auth.uid()) and pedido_id is null);
create policy gf_os_upd on public.gf_os for update to authenticated using (guincheiro_id = (select auth.uid())) with check (guincheiro_id = (select auth.uid()));
create policy gf_os_del on public.gf_os for delete to authenticated using (guincheiro_id = (select auth.uid()) and pedido_id is null);
revoke all on public.gf_os from anon, authenticated;
grant select, insert, update, delete on public.gf_os to authenticated;

-- atendimento concluído pelo GF vira OS do guincheiro
create or replace function public.gf__os_do_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cli text;
begin
  if new.status = 'concluido' and old.status is distinct from 'concluido' and new.prestador_id is not null then
    select nome into v_cli from public.gf_perfis where id = new.autor_id;
    insert into public.gf_os(guincheiro_id, numero, pedido_id, data, cliente, pagador_tipo, origem, destino, veiculo, placa, valor, forma, status, obs)
    values (new.prestador_id, 0, new.id, coalesce(new.concluido_em, now())::date, coalesce(nullif(btrim(v_cli), ''), 'Cliente GF'),
      case when new.tipo = 'repasse' then 'colega' else 'particular' end, new.origem, new.destino, new.veiculo, new.placa,
      coalesce(new.valor_combinado, 0), 'pix', 'a_receber', 'Atendimento pelo GF')
    on conflict (pedido_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists gf_os_do_pedido on public.gf_pedidos;
create trigger gf_os_do_pedido after update of status on public.gf_pedidos for each row execute function public.gf__os_do_pedido();

-- atendimentos já concluídos entram como OS
insert into public.gf_os(guincheiro_id, numero, pedido_id, data, cliente, pagador_tipo, origem, destino, veiculo, placa, valor, forma, status, obs)
select p.prestador_id, 0, p.id, coalesce(p.concluido_em, p.atualizado_em)::date, coalesce(nullif(btrim(a.nome), ''), 'Cliente GF'),
  case when p.tipo = 'repasse' then 'colega' else 'particular' end, p.origem, p.destino, p.veiculo, p.placa, coalesce(p.valor_combinado, 0), 'pix', 'a_receber', 'Atendimento pelo GF'
from public.gf_pedidos p left join public.gf_perfis a on a.id = p.autor_id
where p.status = 'concluido' and p.prestador_id is not null
on conflict (pedido_id) do nothing;
