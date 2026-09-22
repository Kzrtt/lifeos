-- ════════════════════════════════════════════════════════════════════════
-- 0003_lifeos_views.sql — views salvas (filtros combináveis) de Notas e Tarefas
--
-- Motivação: notas.html e tarefas.html só filtravam por UM projeto por vez
-- (inclusão simples, sem exclusão) e nada disso persistia entre aparelhos.
-- Esta tabela guarda a DEFINIÇÃO de uma view (nome + regras) — o filtro em
-- si continua sendo aplicado no cliente, sobre os dados já carregados
-- (poucas linhas em ambas as tabelas), só a definição precisa sincronizar.
--
-- Uma regra: { campo: 'projeto'|'tipo'|'status', operador: 'incluir'|
-- 'excluir', valores: string[] }. `status` só se aplica a `tabela =
-- 'tarefas'` (Notas não tem status/kanban, ver NOTAS.md §1) — validado na
-- Edge Function, não aqui (regras é JSONB solto, sem CHECK por chave).
--
-- A view "Todas" (sem filtro nenhum) é IMPLÍCITA no front-end — não tem
-- linha aqui, é sempre a primeira badge.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_views (
  id         uuid primary key default gen_random_uuid(),
  -- Em qual tela a view aparece — cada tabela filtrável tem seu próprio
  -- espaço de views (uma view de Notas nunca aparece em Tarefas).
  tabela     text not null check (tabela in ('notas', 'tarefas')),
  nome       text not null,
  -- 'todas' = E lógico entre as regras (default); 'qualquer' = OU lógico.
  -- Dentro de UMA regra, múltiplos valores já funcionam como OU (ex.:
  -- "Projeto incluir [X, Y]") — este campo só decide como regras de campos
  -- DIFERENTES se combinam entre si.
  modo       text not null default 'todas' check (modo in ('todas', 'qualquer')),
  regras     jsonb not null default '[]',
  -- Ordem de exibição das badges. Sem UI de reordenar ainda — sempre
  -- crescente na ordem de criação — mas o campo já existe pra não exigir
  -- migração nova quando essa UI aparecer.
  ordem      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lifeos_views_tabela_ordem_idx
  on public.lifeos_views (tabela, ordem);

-- RLS habilitado sem policies — mesmo padrão de todo `lifeos_*` (ver
-- 0001_init.sql): só a service role (usada pela Edge Function) acessa.
alter table public.lifeos_views enable row level security;
