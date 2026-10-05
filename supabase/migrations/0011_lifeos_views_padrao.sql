-- ════════════════════════════════════════════════════════════════════════
-- 0011_lifeos_views_padrao.sql — view padrão de Notas e Tarefas
--
-- Até aqui notas.html, tarefas.html e o hub abriam sempre na view "Todas"
-- (implícita, sem linha). `padrao = true` marca a view salva que abre no
-- lugar dela. No máximo uma por tabela — o índice único parcial garante;
-- a Edge Function desmarca a anterior antes de marcar a nova. Nenhuma
-- marcada = "Todas" continua sendo o padrão.
-- ════════════════════════════════════════════════════════════════════════

alter table public.lifeos_views
  add column if not exists padrao boolean not null default false;

create unique index if not exists lifeos_views_padrao_uniq
  on public.lifeos_views (tabela) where padrao;
