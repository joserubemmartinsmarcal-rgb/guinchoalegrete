# Teste local da migração de avisos

Roda num Postgres 16 local, sem tocar no banco de produção. `stub.sql` cria versões
mínimas das tabelas que já existem no Supabase (perfis, pedidos, eventos, antecipações),
`auth.uid()` e um `net.http_post` falso que só registra as chamadas.

```bash
psql -d teste -v ON_ERROR_STOP=1 -f tests/sql/local/stub.sql
grep -v "create extension if not exists pg_net" supabase/migrations/20261101120000_gf_avisos.sql | psql -d teste -v ON_ERROR_STOP=1
psql -d teste -f tests/sql/local/avisos.sql   # termina com "TESTES_OK 23" e desfaz tudo
```
