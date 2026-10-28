-- Fixa o search_path das funções auxiliares (aviso do linter do Supabase).
alter function public.gf__brl(numeric) set search_path = public;
alter function public.gf__erro(text) set search_path = public;
alter function public.gf__placa(text) set search_path = public;
alter function public.gf_transicao_valida(text, text, text) set search_path = public;
