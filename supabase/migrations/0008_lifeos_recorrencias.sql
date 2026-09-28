-- ════════════════════════════════════════════════════════════════════════
-- 0008_lifeos_recorrencias.sql — recorrências previstas das Finanças
--
-- O que se espera que entre ou saia todo mês (salário, aluguel, assinaturas),
-- cadastrado à mão em Finanças → Recorrências previstas. Não gera
-- movimentação nenhuma: é tabela de referência pro resumo_financeiro do MCP
-- prever o mês seguinte. Com pelo menos uma recorrência ativa, a projeção
-- usa só este cadastro e a heurística vira sugestão. Ver FINANCAS.md §9.2.
--
-- `nome` casa com as movimentações pela mesma chave do resumo (sem acento,
-- caixa ou espaço sobrando). Valor fixo é valor_min = valor_max; faixa é
-- valor_min < valor_max. `direcao` e `meio` são valores dos vocabulários
-- mov_direcao/mov_meio, validados pela Edge Function (nunca CHECK com lista).
-- `meio` e `dia` nulos = não informado: o resumo infere pelo histórico.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_recorrencias (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(btrim(nome)) > 0),
  direcao    text not null check (length(btrim(direcao)) > 0),
  valor_min  numeric(12,2) not null check (valor_min >= 0),
  valor_max  numeric(12,2) not null,
  meio       text,
  dia        smallint check (dia between 1 and 31),
  ativa      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valor_max >= valor_min)
);

-- RLS habilitado sem policies — mesmo padrão de todo `lifeos_*` (ver
-- 0001_init.sql): só a service role (Edge Function e MCP) acessa.
alter table public.lifeos_recorrencias enable row level security;
