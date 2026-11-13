-- GF · Contas bancárias e caixa do guincheiro, e aviso diário de contas a vencer.

create table if not exists public.gf_bancos (
  id uuid primary key default gen_random_uuid(),
  guincheiro_id uuid not null default auth.uid() references public.gf_perfis(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 60),
  tipo text not null default 'banco' check (tipo in ('banco', 'caixa', 'carteira')),
  saldo_inicial numeric(12,2) not null default 0 check (saldo_inicial between -10000000 and 10000000),
  data_inicial date not null default current_date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists gf_bancos_dono_idx on public.gf_bancos(guincheiro_id);
alter table public.gf_bancos enable row level security;
drop policy if exists gf_bancos_dono on public.gf_bancos;
create policy gf_bancos_dono on public.gf_bancos for all to authenticated
  using (guincheiro_id = (select auth.uid())) with check (guincheiro_id = (select auth.uid()));
revoke all on public.gf_bancos from anon, authenticated;
grant select, insert, update, delete on public.gf_bancos to authenticated;

alter table public.gf_os add column if not exists banco_id uuid references public.gf_bancos(id) on delete set null;
alter table public.gf_contas add column if not exists banco_id uuid references public.gf_bancos(id) on delete set null;

-- a conta bancária usada tem de ser do próprio dono
create or replace function public.gf__banco_do_dono() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.banco_id is not null and not exists (select 1 from public.gf_bancos where id = new.banco_id and guincheiro_id = new.guincheiro_id) then
    raise exception 'Conta bancária inválida.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists gf_os_banco on public.gf_os;
create trigger gf_os_banco before insert or update of banco_id on public.gf_os for each row execute function public.gf__banco_do_dono();
drop trigger if exists gf_contas_banco on public.gf_contas;
create trigger gf_contas_banco before insert or update of banco_id on public.gf_contas for each row execute function public.gf__banco_do_dono();

-- saldo de cada conta: saldo inicial + recebido (OS pagas) − pago (contas pagas), a partir da data inicial
create or replace function public.gf_saldos() returns table (banco_id uuid, nome text, tipo text, saldo numeric, entradas numeric, saidas numeric)
language sql stable security definer set search_path = public as $$
  select b.id, b.nome, b.tipo,
    b.saldo_inicial + coalesce(e.v, 0) - coalesce(s.v, 0), coalesce(e.v, 0), coalesce(s.v, 0)
  from public.gf_bancos b
  left join lateral (select sum(o.valor) v from public.gf_os o where o.banco_id = b.id and o.status = 'pago' and o.pago_em >= b.data_inicial) e on true
  left join lateral (select sum(c.valor) v from public.gf_contas c where c.banco_id = b.id and c.status = 'pago' and c.pago_em >= b.data_inicial) s on true
  where b.guincheiro_id = auth.uid() and b.ativo
  order by b.criado_em
$$;
revoke all on function public.gf_saldos() from public, anon;
grant execute on function public.gf_saldos() to authenticated;

-- aviso diário: contas que vencem hoje ou amanhã, e OS a receber que vencem hoje
create or replace function public.gf__avisos_vencimentos() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for r in
    select c.guincheiro_id, count(*) n, sum(c.valor) total,
      count(*) filter (where c.vencimento = v_hoje) hoje, string_agg(c.descricao, ', ' order by c.vencimento, c.valor desc) nomes
    from public.gf_contas c
    where c.status = 'a_pagar' and c.vencimento between v_hoje and v_hoje + 1
    group by c.guincheiro_id
  loop
    perform public.gf__avisar(r.guincheiro_id, 'conta_vence',
      case when r.hoje > 0 then 'Conta vence hoje: ' else 'Conta vence amanhã: ' end || public.gf__brl(r.total),
      left(r.nomes, 280), '#servicos/financeiro', null);
    v_n := v_n + 1;
  end loop;
  for r in
    select o.guincheiro_id, count(*) n, sum(o.valor) total
    from public.gf_os o where o.status = 'a_receber' and o.vencimento = v_hoje
    group by o.guincheiro_id
  loop
    perform public.gf__avisar(r.guincheiro_id, 'os_vence', 'Hoje vence ' || public.gf__brl(r.total) || ' a receber',
      r.n || ' OS para cobrar hoje. Confira no financeiro.', '#servicos/financeiro', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.gf__avisos_vencimentos() from public, anon, authenticated;

select cron.unschedule('gf-avisos-vencimentos') where exists (select 1 from cron.job where jobname = 'gf-avisos-vencimentos');
select cron.schedule('gf-avisos-vencimentos', '37 10 * * *', 'select public.gf__avisos_vencimentos()');
