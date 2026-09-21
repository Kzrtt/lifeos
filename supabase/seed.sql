-- ════════════════════════════════════════════════════════════════════════
-- seed.sql — dados mínimos para uma instalação nova funcionar
--
-- Aplicar DEPOIS de migrations/0001_init.sql.
-- Rodar de novo é seguro: tudo aqui é idempotente.
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- SENHA MESTRE INICIAL
--
-- Sem nenhuma linha em access_tokens o sistema nasce INACESSÍVEL: o gate do
-- LifeOS valida contra esta tabela e não há outro caminho para entrar. Por
-- isso a senha padrão é um DADO DE SEED, criado aqui.
--
-- Não é um caso especial no código. Nenhum arquivo do front ou das Edge
-- Functions compara nada com a string 'lifeos' — para o sistema ela é uma
-- senha mestre como qualquer outra, e trocá-la pela tela de Senhas a
-- substitui sem deixar resíduo.
--
-- ⚠ TROQUE ANTES DE PUBLICAR O SITE. Enquanto for 'lifeos', qualquer pessoa
--   que conheça o projeto entra no seu painel. LifeOS → menu → Senhas.
-- ────────────────────────────────────────────────────────────────────────

insert into public.access_tokens (token, is_master, label)
values ('lifeos', true, 'senha mestre padrão — TROQUE')
on conflict (token) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- TOKEN DO CONECTOR MCP
--
-- Autentica o servidor MCP (supabase/functions/lifeos-mcp). Quem tiver a URL
-- com este token lê todo o seu LifeOS, então o valor abaixo é um PLACEHOLDER
-- INVÁLIDO de propósito: enquanto não for trocado, o conector recusa toda
-- conexão. É melhor nascer travado do que nascer aberto com um valor que
-- está publicado no repositório.
--
-- Gere o seu e grave:
--   openssl rand -hex 32
--   update public.admin_config set value = '<valor>', updated_at = now()
--    where key = 'mcp_token';
--
-- A URL pronta aparece depois em LifeOS → menu → MCP.
-- ────────────────────────────────────────────────────────────────────────

insert into public.admin_config (key, value)
values ('mcp_token', 'TROQUE-ME-openssl-rand-hex-32')
on conflict (key) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- PROJETO INICIAL
--
-- Existe por uma razão prática: toda tarefa exige um projeto
-- (lifeos_tarefas.projeto_id é not null). Sem ao menos um, a primeira coisa
-- que o usuário tenta fazer — criar uma tarefa — falha.
-- ────────────────────────────────────────────────────────────────────────

insert into public.lifeos_projetos (name, emoji, status, tags)
select 'Configurar o LifeOS', '⚙️', 'Em Progresso', array['Configuração']
where not exists (select 1 from public.lifeos_projetos);

-- ────────────────────────────────────────────────────────────────────────
-- TAREFAS DE PRIMEIRA CONFIGURAÇÃO
--
-- Dobram como dados de exemplo e como checklist do que falta configurar.
-- Só entram se a tabela estiver vazia.
-- ────────────────────────────────────────────────────────────────────────

insert into public.lifeos_tarefas (name, status, tipo, projeto_id, descricao)
select t.name, 'Não Iniciado', array['Organização'], p.id, t.descricao
from (values
  ('Trocar a senha mestre',
   'A instalação nasce com a senha "lifeos". Troque em LifeOS → menu → Senhas antes de publicar o site.'),
  ('Gerar o token do MCP',
   'openssl rand -hex 32, e grave em admin_config.mcp_token. Enquanto não trocar, o conector recusa conexão. Instruções em LifeOS → menu → MCP.'),
  ('Cadastrar o token do GitHub',
   'Necessário para publicar páginas do archive. O passo a passo está em LifeOS → menu → Publicar → aba Token do GitHub.'),
  ('Apontar lifeos-config.js para o seu projeto',
   'assets/js/lifeos-config.js: supabaseUrl, anonKey, e owner/repo do GitHub. É o único arquivo que um fork precisa editar.'),
  ('Ler o guia do sistema',
   'LifeOS → menu → Como funciona. Explica o que cada módulo faz e sugere uma ordem de adoção.')
) as t(name, descricao)
cross join (select id from public.lifeos_projetos order by created_at limit 1) p
where not exists (select 1 from public.lifeos_tarefas);
