-- GF · Financeiro da empresa: contas a pagar (despesas fixas e avulsas), com repetição mensal.
-- Só o dono vê as próprias contas.

create table if not exists public.gf_contas (
  id uuid primary key default gen_random_uuid(),
  guincheiro_id uuid not null default auth.uid() references public.gf_perfis(id) on delete cascade,
  descricao text not null check (char_length(btrim(descricao)) between 2 and 120),
  categoria text not null default 'outros' check (categoria in ('caminhao', 'combustivel', 'manutencao', 'seguro', 'salario', 'impostos', 'aluguel', 'telefone', 'pedagio', 'outros')),
  fornecedor text check (char_length(fornecedor) <= 120),
  valor numeric(12,2) not null check (valor between 0 and 1000000),
  vencimento date not null default current_date,
  status text not null default 'a_pagar' check (status in ('a_pagar', 'pago')),
  pago_em date,
  forma text check (forma is null or forma in ('pix', 'dinheiro', 'cartao', 'boleto', 'debito', 'transferencia', 'outro')),
  recorrente boolean not null default false,
  serie_id uuid,
  obs text check (char_length(obs) <= 1000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists gf_contas_dono_venc_idx on public.gf_contas(guincheiro_id, vencimento);
create unique index if not exists gf_contas_serie_mes_uk on public.gf_contas(serie_id, (date_trunc('month', vencimento::timestamp))) where serie_id is not null;

create or replace function public.gf__conta_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.guincheiro_id := coalesce(new.guincheiro_id, auth.uid());
    if new.recorrente and new.serie_id is null then new.serie_id := gen_random_uuid(); end if;
  else
    new.guincheiro_id := old.guincheiro_id; new.criado_em := old.criado_em;
    if new.recorrente and new.serie_id is null then new.serie_id := coalesce(old.serie_id, gen_random_uuid()); end if;
  end if;
  if new.status = 'pago' and new.pago_em is null then new.pago_em := current_date; end if;
  if new.status <> 'pago' then new.pago_em := null; end if;
  new.descricao := btrim(new.descricao);
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists gf_conta_antes on public.gf_contas;
create trigger gf_conta_antes before insert or update on public.gf_contas for each row execute function public.gf__conta_antes();

alter table public.gf_contas enable row level security;
drop policy if exists gf_contas_dono on public.gf_contas;
create policy gf_contas_dono on public.gf_contas for all to authenticated
  using (guincheiro_id = (select auth.uid())) with check (guincheiro_id = (select auth.uid()));
revoke all on public.gf_contas from anon, authenticated;
grant select, insert, update, delete on public.gf_contas to authenticated;

-- cria no mês pedido as contas que repetem todo mês (a partir da última de cada série)
create or replace function public.gf_gerar_contas_mes(p_mes date) returns int
language plpgsql security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_n int := 0; r record; v_dia int; v_venc date;
begin
  if auth.uid() is null then return 0; end if;
  if v_ini > date_trunc('month', current_date)::date + interval '1 month' then return 0; end if; -- no máximo o mês que vem
  for r in
    select distinct on (c.serie_id) c.* from public.gf_contas c
    where c.guincheiro_id = auth.uid() and c.serie_id is not null and c.vencimento < v_ini
    order by c.serie_id, c.vencimento desc
  loop
    if not r.recorrente then continue; end if; -- a última da série parou de repetir
    if exists (select 1 from public.gf_contas where serie_id = r.serie_id and date_trunc('month', vencimento::timestamp) = v_ini) then continue; end if;
    v_dia := extract(day from r.vencimento)::int;
    v_venc := least(v_ini + (v_dia - 1), (v_ini + interval '1 month - 1 day')::date);
    insert into public.gf_contas(guincheiro_id, descricao, categoria, fornecedor, valor, vencimento, status, forma, recorrente, serie_id, obs)
    values (auth.uid(), r.descricao, r.categoria, r.fornecedor, r.valor, v_venc, 'a_pagar', r.forma, true, r.serie_id, r.obs)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.gf_gerar_contas_mes(date) from public, anon;
grant execute on function public.gf_gerar_contas_mes(date) to authenticated;
