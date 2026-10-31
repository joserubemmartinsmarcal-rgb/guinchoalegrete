create role anon; create role authenticated;
create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema net; create table net.chamadas(id serial, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ insert into net.chamadas(url, body, headers) values (url, body, headers) returning id $$;
create table public.gf_perfis(id uuid primary key, tipo text, nome text, aprovacao text, disponivel boolean default false, is_admin boolean default false);
create table public.gf_pedidos(id uuid primary key default gen_random_uuid(), autor_id uuid, prestador_id uuid, tipo text default 'cliente', origem text, destino text, veiculo text, status text default 'aberto');
create table public.gf_eventos(id bigint generated always as identity primary key, pedido_id uuid not null references public.gf_pedidos(id) on delete cascade,
  autor_id uuid, tipo text not null, status_anterior text, status_novo text, detalhe text, criado_em timestamptz default now());
create table public.gf_antecipacoes(id uuid primary key default gen_random_uuid(), guincheiro_id uuid, valor numeric, pagador_nome text, status text default 'recebido', nota_admin text);
create function public.gf__erro(p_msg text) returns void language plpgsql as $$ begin raise exception using message = p_msg, errcode = 'P0001'; end $$;
create function public.gf__brl(v numeric) returns text language sql immutable as $$ select 'R$ ' || replace(to_char(v, 'FM9999990.00'), '.', ',') $$;
