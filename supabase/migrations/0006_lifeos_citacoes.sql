-- ════════════════════════════════════════════════════════════════════════
-- 0006_lifeos_citacoes.sql — citações do LifeOS
--
-- Uma citação é só o texto e quem disse. O hub sorteia uma a cada abertura
-- e a mostra num banner acima do calendário; clicar no banner abre a lista
-- completa (editar/excluir). Ver LIFEOS.md §3.6.
--
-- `texto` aceita *asteriscos* pra marcar trechos em destaque — o front
-- renderiza esses trechos no acento do tema. Nada disso é validado aqui:
-- pro banco é texto puro.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_citacoes (
  id         uuid primary key default gen_random_uuid(),
  texto      text not null check (length(btrim(texto)) > 0),
  autor      text not null check (length(btrim(autor)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS habilitado sem policies — mesmo padrão de todo `lifeos_*` (ver
-- 0001_init.sql): só a service role (usada pela Edge Function) acessa.
alter table public.lifeos_citacoes enable row level security;
