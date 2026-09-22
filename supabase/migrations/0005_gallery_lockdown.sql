-- ════════════════════════════════════════════════════════════════════════
-- 0005_gallery_lockdown.sql — fecha a escrita direta com anon key na galeria
--
-- Contexto: a tabela `gallery` já tinha só SELECT liberado pra `anon`
-- (nenhuma policy de INSERT) -- decisão de segurança documentada em
-- 0001_init.sql, rodapé item A. Só que `assets/js/gallery.js` continuava
-- inserindo DIRETO na tabela com a anon key a partir do browser, e por
-- isso todo upload passou a falhar com "new row violates row-level
-- security policy for table gallery".
--
-- Além disso, um desenho anterior do bucket de Storage 'gallery' chegou a
-- ter uma policy MUITO pior ainda aberta: `anon_upload_gallery` (INSERT,
-- with check só `bucket_id = 'gallery'`) -- SEM NENHUM gate de senha,
-- qualquer pessoa com a anon key (pública, vai no código-fonte do site)
-- podia subir arquivo arbitrário pro bucket, mesmo que o INSERT na
-- tabela falhasse depois.
--
-- Fix real: gallery.js passou a chamar a Edge Function `gallery-upload`
-- (service role, valida senha via check_page_access antes de escrever).
-- Este arquivo fecha as duas pontas que só existiam pra sustentar o
-- fluxo antigo (o `drop policy if exists` é seguro mesmo numa instância
-- nova que nunca chegou a ter essa policy):
--   1. Derruba `anon_upload_gallery` -- Storage volta a só aceitar
--      escrita da service role.
--   2. Concede EXECUTE em check_page_access pra service_role -- é quem
--      a nova Edge Function usa pra validar a senha (a função já era
--      concedida a `anon` pro fluxo antigo de gate.js/páginas
--      protegidas; service_role precisa da mesma concessão explícita,
--      GRANT EXECUTE não é herdado automaticamente).
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists anon_upload_gallery on storage.objects;

grant execute on function public.check_page_access(text, text) to service_role;
