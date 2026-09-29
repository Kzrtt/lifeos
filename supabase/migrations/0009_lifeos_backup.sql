-- ════════════════════════════════════════════════════════════════════════
-- 0009_lifeos_backup.sql — RPC que despeja o banco inteiro para o backup
--
-- O botão de backup do hub (lifeos.html → #backup-modal) chama a Edge
-- Function lifeos-backup, que chama esta função e transforma o resultado
-- em arquivos .sql de restauração. Ver LIFEOS.md §3.7.
--
-- Por que uma RPC e não o PostgREST tabela a tabela:
--  - a lista de tabelas vem do catálogo, então um módulo novo entra no
--    backup sozinho, sem ninguém lembrar de registrá-lo em lugar nenhum;
--  - o PostgREST corta respostas em `max-rows` (1000 no Supabase), e um
--    backup que perde linhas em silêncio é pior que não ter backup;
--  - só o catálogo sabe as FKs (ordem de inserção) e quais colunas são
--    identity/serial (sequência a reajustar depois do restore).
--
-- Não há regra de negócio aqui: é só leitura. Quem decide o formato dos
-- .sql e o que fica de fora (credenciais) é a Edge Function.
--
-- Limitação conhecida: FK de uma tabela para ela mesma não é ordenada
-- linha a linha. Nenhuma tabela tem isso hoje; se passar a ter, o restore
-- dessa tabela precisa de ordem própria.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.lifeos_backup_dump()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  t       record;
  cols    jsonb;
  seqs    jsonb;
  deps    jsonb;
  ordem   text;
  linhas  jsonb;
  ultima  text;
  tabelas jsonb := '[]'::jsonb;
begin
  for t in
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    -- Colunas graváveis (coluna gerada não aceita valor no insert).
    select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb) into cols
      from pg_attribute a
     where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';

    -- Colunas com sequência (identity ou serial): o restore grava o id
    -- original, então a sequência precisa ser empurrada para depois dele.
    select coalesce(jsonb_agg(jsonb_build_object('coluna', a.attname, 'identity', a.attidentity <> '')), '[]'::jsonb) into seqs
      from pg_attribute a
     where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
       and pg_get_serial_sequence(format('public.%I', t.relname), a.attname) is not null;

    -- Tabelas do public que esta referencia — define a ordem de inserção.
    select coalesce(jsonb_agg(distinct r.relname), '[]'::jsonb) into deps
      from pg_constraint k
      join pg_class r on r.oid = k.confrelid
      join pg_namespace rn on rn.oid = r.relnamespace
     where k.conrelid = t.oid and k.contype = 'f' and k.confrelid <> t.oid and rn.nspname = 'public';

    -- Ordena pela PK para dois backups do mesmo dado saírem idênticos.
    select string_agg(format('x.%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into ordem
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = t.oid and i.indisprimary;

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x)%s), ''[]''::jsonb) from public.%I x',
      case when ordem is null then '' else ' order by ' || ordem end,
      t.relname
    ) into linhas;

    tabelas := tabelas || jsonb_build_array(jsonb_build_object(
      'tabela', t.relname, 'colunas', cols, 'sequencias', seqs, 'depende_de', deps, 'linhas', linhas
    ));
  end loop;

  -- Última migration aplicada, para o LEIAME dizer em qual schema o dado
  -- nasceu. Só existe se as migrations passaram pelo CLI/MCP; instalação
  -- feita colando SQL no editor não tem essa tabela.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select name from supabase_migrations.schema_migrations order by version desc limit 1' into ultima;
  end if;

  return jsonb_build_object('gerado_em', now(), 'ultima_migration', ultima, 'tabelas', tabelas);
end;
$$;

-- Mesma postura das outras RPCs (0001_init.sql §fim, 0002): só a service
-- role, dentro da Edge Function, executa. O despejo inclui access_tokens.
revoke execute on function public.lifeos_backup_dump() from public, anon, authenticated;
grant  execute on function public.lifeos_backup_dump() to service_role;
