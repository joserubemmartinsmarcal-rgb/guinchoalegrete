-- Parceiros entre guincheiros:
--  (a) vaga na plataforma: já existe em gf_retornos; aqui só entra o contato com o dono.
--  (b) ceder o caminhão: o guincheiro deixa o caminhão (com ou sem motorista) à
--      disposição de colegas numa cidade/região, por um período.
-- O contato (WhatsApp) só sai pela função gf_falar_com_parceiro, para guincheiro
-- aprovado, e o dono do anúncio recebe um aviso na primeira vez de cada colega.
-- Só adiciona objetos novos; nada existente muda.

create table if not exists public.gf_caminhoes (
  id uuid primary key default gen_random_uuid(),
  guincheiro_id uuid not null references public.gf_perfis(id) on delete cascade,
  cidade text not null check (char_length(btrim(cidade)) between 2 and 80),
  raio_km int not null default 100 check (raio_km between 10 and 1000),
  equipamento text not null check (char_length(equipamento) between 2 and 40),
  com_motorista boolean not null default true,
  disponivel_de date not null default current_date,
  disponivel_ate date,
  valor numeric(10,2) check (valor is null or valor between 1 and 100000),
  cobranca text not null default 'combinar' check (cobranca in ('dia', 'viagem', 'km', 'combinar')),
  obs text check (coalesce(char_length(obs), 0) <= 500),
  status text not null default 'ativo' check (status in ('ativo', 'encerrado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint gf_caminhoes_periodo_chk check (disponivel_ate is null or disponivel_ate >= disponivel_de)
);
create index if not exists gf_caminhoes_guincheiro_idx on public.gf_caminhoes(guincheiro_id);
create index if not exists gf_caminhoes_ativos_idx on public.gf_caminhoes(status, disponivel_ate);

create or replace function public.gf__caminhao_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.guincheiro_id := auth.uid(); end if;
  new.cidade := btrim(new.cidade);
  if new.valor is null then new.cobranca := 'combinar'; elsif new.cobranca = 'combinar' then new.valor := null; end if;
  if tg_op = 'INSERT' then new.status := 'ativo'; new.criado_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists gf_caminhao_antes on public.gf_caminhoes;
create trigger gf_caminhao_antes before insert or update on public.gf_caminhoes
  for each row execute function public.gf__caminhao_antes();

alter table public.gf_caminhoes enable row level security;
drop policy if exists gf_cam_sel on public.gf_caminhoes;
drop policy if exists gf_cam_ins on public.gf_caminhoes;
drop policy if exists gf_cam_upd on public.gf_caminhoes;
drop policy if exists gf_cam_del on public.gf_caminhoes;
create policy gf_cam_sel on public.gf_caminhoes for select to authenticated using (
  guincheiro_id = (select auth.uid()) or public.gf_eh_guincheiro_aprovado() or public.gf_is_admin());
create policy gf_cam_ins on public.gf_caminhoes for insert to authenticated with check (
  guincheiro_id = (select auth.uid()) and public.gf_eh_guincheiro_aprovado());
create policy gf_cam_upd on public.gf_caminhoes for update to authenticated using (guincheiro_id = (select auth.uid()))
  with check (guincheiro_id = (select auth.uid()) and public.gf_eh_guincheiro_aprovado());
create policy gf_cam_del on public.gf_caminhoes for delete to authenticated using (guincheiro_id = (select auth.uid()));
revoke all on public.gf_caminhoes from anon, authenticated;
grant select, insert, update, delete on public.gf_caminhoes to authenticated;

-- quem chamou quem (para avisar o dono uma vez e limitar a coleta de contatos)
create table if not exists public.gf_interesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.gf_perfis(id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('vaga', 'caminhao')),
  alvo_id uuid not null,
  dono_id uuid not null references public.gf_perfis(id) on delete cascade,
  criado_em timestamptz not null default now(),
  unique (user_id, alvo_tipo, alvo_id)
);
create index if not exists gf_interesses_dono_idx on public.gf_interesses(dono_id, criado_em desc);
create index if not exists gf_interesses_user_idx on public.gf_interesses(user_id, criado_em desc);
alter table public.gf_interesses enable row level security;
drop policy if exists gf_int_sel on public.gf_interesses;
create policy gf_int_sel on public.gf_interesses for select to authenticated using (
  dono_id = (select auth.uid()) or user_id = (select auth.uid()));
revoke all on public.gf_interesses from anon, authenticated;
grant select on public.gf_interesses to authenticated;

create or replace function public.gf_falar_com_parceiro(p_tipo text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dono uuid; v_desc text; v_url text; v_novo uuid; v_eu public.gf_perfis; v_p public.gf_perfis;
begin
  if not public.gf_eh_guincheiro_aprovado() then perform public.gf__erro('Só guincheiros aprovados falam com parceiros.'); end if;
  if p_tipo = 'vaga' then
    select guincheiro_id, origem || ' › ' || destino into v_dono, v_desc from public.gf_retornos where id = p_id and status = 'ativo';
    v_url := '#rota/' || p_id;
  elsif p_tipo = 'caminhao' then
    select guincheiro_id, equipamento || ' em ' || cidade into v_dono, v_desc from public.gf_caminhoes
     where id = p_id and status = 'ativo' and (disponivel_ate is null or disponivel_ate >= current_date);
    v_url := '#caminhao/' || p_id;
  else
    perform public.gf__erro('Tipo de anúncio inválido.');
  end if;
  if v_dono is null then perform public.gf__erro('Anúncio não encontrado ou encerrado.'); end if;
  if v_dono = auth.uid() then perform public.gf__erro('Este anúncio é seu.'); end if;
  select * into v_p from public.gf_perfis where id = v_dono;
  if v_p.aprovacao = 'bloqueado' then perform public.gf__erro('Anúncio indisponível.'); end if;

  if not exists (select 1 from public.gf_interesses where user_id = auth.uid() and alvo_tipo = p_tipo and alvo_id = p_id) then
    if (select count(*) from public.gf_interesses where user_id = auth.uid() and criado_em > now() - interval '1 day') >= 30 then
      perform public.gf__erro('Limite de contatos de hoje atingido. Tente amanhã.');
    end if;
    insert into public.gf_interesses(user_id, alvo_tipo, alvo_id, dono_id) values (auth.uid(), p_tipo, p_id, v_dono)
      on conflict do nothing returning id into v_novo;
    if v_novo is not null then
      select * into v_eu from public.gf_perfis where id = auth.uid();
      perform public.gf__avisar(v_dono, 'parceiro',
        case p_tipo when 'vaga' then 'Colega quer sua vaga' else 'Colega quer seu caminhão' end,
        v_eu.nome || ' (' || v_eu.cidade || ') · ' || v_desc || ' · vai chamar no WhatsApp', v_url, null);
    end if;
  end if;
  return jsonb_build_object('nome', v_p.nome, 'whatsapp', v_p.whatsapp);
end $$;

revoke all on function public.gf__caminhao_antes() from public, anon, authenticated;
revoke all on function public.gf_falar_com_parceiro(text, uuid) from public, anon;
grant execute on function public.gf_falar_com_parceiro(text, uuid) to authenticated;
