-- ════════════════════════════════════════════════════════════════════════
-- 0002_vocabularios.sql — tags e status configuráveis
--
-- Até aqui, os vocabulários do sistema (tipos de nota, status de tarefa,
-- meios de pagamento…) viviam em TRÊS lugares ao mesmo tempo: uma constante
-- no JS de cada página, outra cópia em cada Edge Function, e um CHECK no
-- banco. Adicionar um valor exigia editar os três e redeployar.
--
-- Esta migration move a fonte de verdade para uma tabela e derruba os CHECK.
-- A validação continua existindo — passa a ser feita pelas Edge Functions
-- contra esta tabela, que é o único lugar editável (LifeOS → menu → Tags).
--
-- ⚠ NÃO destrói dado. Os valores de seed abaixo são EXATAMENTE os que já
--   estavam em uso; nenhuma linha existente deixa de ser válida. Rodar de
--   novo é seguro.
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- 1. A TABELA
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.lifeos_vocabularios (
  id        uuid primary key default gen_random_uuid(),
  -- Qual lista. Ver a tabela de domínios em 2, abaixo.
  dominio   text not null,
  -- O texto GRAVADO nas linhas de dados. Renomear exige migrar os dados —
  -- é o que a função lifeos_renomear_vocabulario faz.
  valor     text not null,
  -- Cor opcional, hoje usada só por `evento_tipo` (o calendário pinta cada
  -- tipo). Hex `#rrggbb` ou nulo.
  cor       text,
  -- Ordem de exibição nos seletores. Empate cai no alfabético.
  ordem     integer not null default 0,
  -- Valores dos quais o CÓDIGO depende por nome. Podem ser renomeados (com
  -- migração dos dados), mas não apagados: apagar quebraria a lógica que os
  -- referencia. Ver a nota sobre semântica no fim deste arquivo.
  protegido boolean not null default false,
  created_at timestamptz not null default now(),
  unique (dominio, valor)
);

create index if not exists lifeos_vocabularios_dominio_idx
  on public.lifeos_vocabularios (dominio, ordem);

alter table public.lifeos_vocabularios enable row level security;
-- Sem policy: só a service_role alcança, como todas as tabelas do LifeOS.

-- ────────────────────────────────────────────────────────────────────────
-- 2. SEED — exatamente os valores que já estavam em uso
--
-- | domínio              | onde é gravado                  | formato |
-- |----------------------|----------------------------------|---------|
-- | nota_tipo            | lifeos_notas.tipo                | array   |
-- | tarefa_status        | lifeos_tarefas.status            | escalar |
-- | tarefa_tipo          | lifeos_tarefas.tipo              | array   |
-- | projeto_status       | lifeos_projetos.status           | escalar |
-- | projeto_tag          | lifeos_projetos.tags             | array   |
-- | evento_tipo          | lifeos_eventos.tipo              | escalar |
-- | manifestacao_status  | lifeos_manifestacoes.status      | escalar |
-- | manifestacao_tag     | lifeos_manifestacoes.tags        | array   |
-- | mov_direcao          | lifeos_movimentacoes.tipo        | array   |
-- | mov_meio             | lifeos_movimentacoes.tipo        | array   |
--
-- `mov_direcao` e `mov_meio` gravam na MESMA coluna — herdado da migração
-- do Notion, onde direção e meio convivem num array só. Ver FINANCAS.md.
-- ────────────────────────────────────────────────────────────────────────

insert into public.lifeos_vocabularios (dominio, valor, cor, ordem, protegido)
values
  ('nota_tipo', 'Lembranças',        null, 10, false),
  ('nota_tipo', 'Análise de Leitura',null, 20, false),
  ('nota_tipo', 'Pensamentos',       null, 30, false),
  ('nota_tipo', 'Conclusões',        null, 40, false),
  ('nota_tipo', 'Úteis',             null, 50, false),
  ('nota_tipo', 'Faculdade',         null, 60, false),
  ('nota_tipo', 'Vida',              null, 70, false),
  ('nota_tipo', 'Pesquisa',          null, 80, false),
  ('nota_tipo', 'Programação',       null, 90, false),
  ('nota_tipo', 'Pessoal',           null, 100, false),
  ('nota_tipo', 'Relato',            null, 110, false),
  ('nota_tipo', 'Documentação',      null, 120, false),

  -- protegido: o hub e o kanban calculam progresso com status = 'Feito',
  -- e o kanban tem uma coluna por status.
  ('tarefa_status', 'Não Iniciado',  null, 10, true),
  ('tarefa_status', 'Em Andamento',  null, 20, true),
  ('tarefa_status', 'Feito',         null, 30, true),

  ('tarefa_tipo', 'Vida',            null, 10, false),
  ('tarefa_tipo', 'Organização',     null, 20, false),
  ('tarefa_tipo', 'Documentação',    null, 30, false),
  ('tarefa_tipo', 'Estudo',          null, 40, false),
  ('tarefa_tipo', 'Avaliação',       null, 50, false),
  ('tarefa_tipo', 'Código',          null, 60, false),
  ('tarefa_tipo', 'Freelance',       null, 70, false),
  ('tarefa_tipo', 'Trabalho',        null, 80, false),
  ('tarefa_tipo', 'Tarefa',          null, 90, false),

  ('projeto_status', 'Não Iniciado', null, 10, true),
  ('projeto_status', 'Em Progresso', null, 20, true),
  ('projeto_status', 'Feito',        null, 30, true),
  ('projeto_status', 'Pausado',      null, 40, true),

  ('projeto_tag', 'Pessoal',         null, 10, false),
  ('projeto_tag', 'Profissional',    null, 20, false),
  ('projeto_tag', 'Acadêmico',       null, 30, false),
  ('projeto_tag', 'Configuração',    null, 40, false),

  -- as cores vêm de EVENTO_COR em lifeos.js
  ('evento_tipo', 'faculdade',  '#5b8def', 10, false),
  ('evento_tipo', 'trabalho',   '#c4913a', 20, false),
  ('evento_tipo', 'lazer',      '#3fb98c', 30, false),
  ('evento_tipo', 'vida',       '#e58b5b', 40, false),
  ('evento_tipo', 'psicodelia', '#b06ee0', 50, false),

  ('manifestacao_status', 'Não Iniciado', null, 10, true),
  ('manifestacao_status', 'Em Progresso', null, 20, true),
  ('manifestacao_status', 'Feito',        null, 30, true),

  ('manifestacao_tag', 'Vida',       null, 10, false),
  ('manifestacao_tag', 'Financeiro', null, 20, false),
  ('manifestacao_tag', 'Carreira',   null, 30, false),
  ('manifestacao_tag', 'Saúde',      null, 40, false),
  ('manifestacao_tag', 'Lazer',      null, 50, false),

  -- protegido: todo o cálculo de saldo depende destes dois nomes.
  ('mov_direcao', 'Entrada', null, 10, true),
  ('mov_direcao', 'Saida',   null, 20, true),

  -- protegido: 'Crédito' tem regra própria (não sai do caixa no mês; vira
  -- fatura futura). Ver FINANCAS.md.
  ('mov_meio', 'Crédito', null, 10, true),
  ('mov_meio', 'Débito',  null, 20, false),
  ('mov_meio', 'Pix',     null, 30, false),
  ('mov_meio', 'Vale',    null, 40, false),
  ('mov_meio', 'Boleto',  null, 50, false)
on conflict (dominio, valor) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- 3. DERRUBA OS CHECK
--
-- Eles congelavam o vocabulário no schema: adicionar um status exigia
-- ALTER TABLE. A validação passa a ser das Edge Functions, contra a tabela
-- acima.
--
-- Isto NÃO abre buraco: as functions já validavam antes de escrever, e
-- continuam validando — só que agora contra uma lista editável em vez de
-- uma constante.
-- ────────────────────────────────────────────────────────────────────────

alter table public.lifeos_tarefas       drop constraint if exists lifeos_tarefas_status_check;
alter table public.lifeos_projetos      drop constraint if exists lifeos_projetos_status_check;
alter table public.lifeos_eventos       drop constraint if exists lifeos_eventos_tipo_check;
alter table public.lifeos_manifestacoes drop constraint if exists lifeos_manifestacoes_status_check;

-- ────────────────────────────────────────────────────────────────────────
-- 4. RENOMEAR COM MIGRAÇÃO DOS DADOS
--
-- Renomear um valor sem atualizar as linhas que já o usam deixaria dados
-- órfãos — uma tarefa com status que não existe mais na lista. Esta função
-- faz as duas coisas numa transação só.
--
-- Colunas escalares recebem UPDATE simples; colunas array usam
-- array_replace, que troca todas as ocorrências preservando a ordem e o
-- resto do array.
--
-- Devolve quantas linhas de DADO foram migradas.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.lifeos_renomear_vocabulario(
  p_dominio text, p_de text, p_para text
) returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_linhas integer := 0;
begin
  if p_de = p_para then return 0; end if;

  if not exists (
    select 1 from public.lifeos_vocabularios
    where dominio = p_dominio and valor = p_de
  ) then
    raise exception 'valor_inexistente';
  end if;

  if exists (
    select 1 from public.lifeos_vocabularios
    where dominio = p_dominio and valor = p_para
  ) then
    raise exception 'valor_duplicado';
  end if;

  -- Primeiro os DADOS, depois o vocabulário. Se algo falhar no meio, a
  -- transação inteira volta atrás e nada fica inconsistente.
  case p_dominio
    when 'nota_tipo' then
      update public.lifeos_notas set tipo = array_replace(tipo, p_de, p_para)
       where p_de = any(tipo);
    when 'tarefa_status' then
      update public.lifeos_tarefas set status = p_para where status = p_de;
    when 'tarefa_tipo' then
      update public.lifeos_tarefas set tipo = array_replace(tipo, p_de, p_para)
       where p_de = any(tipo);
    when 'projeto_status' then
      update public.lifeos_projetos set status = p_para where status = p_de;
    when 'projeto_tag' then
      update public.lifeos_projetos set tags = array_replace(tags, p_de, p_para)
       where p_de = any(tags);
    when 'evento_tipo' then
      update public.lifeos_eventos set tipo = p_para where tipo = p_de;
    when 'manifestacao_status' then
      update public.lifeos_manifestacoes set status = p_para where status = p_de;
    when 'manifestacao_tag' then
      update public.lifeos_manifestacoes set tags = array_replace(tags, p_de, p_para)
       where p_de = any(tags);
    when 'mov_direcao', 'mov_meio' then
      -- os dois gravam na mesma coluna array
      update public.lifeos_movimentacoes set tipo = array_replace(tipo, p_de, p_para)
       where p_de = any(tipo);
    else
      raise exception 'dominio_invalido';
  end case;

  get diagnostics v_linhas = row_count;

  update public.lifeos_vocabularios
     set valor = p_para
   where dominio = p_dominio and valor = p_de;

  return v_linhas;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 5. QUANTAS LINHAS USAM UM VALOR
--
-- A tela chama antes de apagar: apagar um valor em uso deixaria linhas com
-- uma tag que não existe mais na lista.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.lifeos_uso_vocabulario(
  p_dominio text, p_valor text
) returns integer language plpgsql security definer set search_path to '' as $$
declare v_n integer := 0;
begin
  case p_dominio
    when 'nota_tipo' then
      select count(*) into v_n from public.lifeos_notas where p_valor = any(tipo);
    when 'tarefa_status' then
      select count(*) into v_n from public.lifeos_tarefas where status = p_valor;
    when 'tarefa_tipo' then
      select count(*) into v_n from public.lifeos_tarefas where p_valor = any(tipo);
    when 'projeto_status' then
      select count(*) into v_n from public.lifeos_projetos where status = p_valor;
    when 'projeto_tag' then
      select count(*) into v_n from public.lifeos_projetos where p_valor = any(tags);
    when 'evento_tipo' then
      select count(*) into v_n from public.lifeos_eventos where tipo = p_valor;
    when 'manifestacao_status' then
      select count(*) into v_n from public.lifeos_manifestacoes where status = p_valor;
    when 'manifestacao_tag' then
      select count(*) into v_n from public.lifeos_manifestacoes where p_valor = any(tags);
    when 'mov_direcao', 'mov_meio' then
      select count(*) into v_n from public.lifeos_movimentacoes where p_valor = any(tipo);
    else
      raise exception 'dominio_invalido';
  end case;
  return v_n;
end;
$$;

revoke execute on function public.lifeos_renomear_vocabulario(text, text, text) from public, anon, authenticated;
revoke execute on function public.lifeos_uso_vocabulario(text, text) from public, anon, authenticated;
grant  execute on function public.lifeos_renomear_vocabulario(text, text, text) to service_role;
grant  execute on function public.lifeos_uso_vocabulario(text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════
-- SOBRE `protegido` — o que o código conhece por nome
--
-- Nem todo valor é só um rótulo. Alguns são lidos pela LÓGICA, e apagá-los
-- quebra funcionalidade em silêncio:
--
--   'Feito'         — hub e kanban calculam progresso com ele
--   'Em Andamento'  — coluna do kanban de tarefas
--   'Não Iniciado'  — coluna do kanban, e estado inicial
--   'Em Progresso'  — filtro padrão da lista de projetos
--   'Pausado'       — coluna de projetos
--   'Entrada'/'Saida' — todo o cálculo de saldo
--   'Crédito'       — regra de fatura futura (FINANCAS.md)
--
-- Marcados com `protegido = true`. A tela deixa RENOMEAR (os dados migram
-- junto e o código passa a ver o nome novo, porque lê da tabela), mas não
-- deixa APAGAR.
--
-- Renomear um protegido ainda exige atenção: se você trocar 'Feito' por
-- 'Concluído', a coluna do kanban passa a se chamar 'Concluído' e tudo
-- continua funcionando — mas qualquer texto de ajuda que mencione "Feito"
-- fica desatualizado.
-- ════════════════════════════════════════════════════════════════════════
