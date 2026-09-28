-- ════════════════════════════════════════════════════════════════════════
-- 0007_lifeos_memorias.sql — memória de longo prazo do LifeOS
--
-- Memória que não depende de harness nem de modelo: o que uma IA aprendeu
-- sobre o autor fica aqui, e qualquer cliente conectado ao MCP do LifeOS lê
-- de volta. Ver LIFEOS.md §17.
--
-- Duas tabelas, no mesmo formato de um MEMORY.md + arquivos:
--
--   lifeos_memorias           — o ÍNDICE. Uma linha por tema: título,
--                               descrição curta (o "gancho" que diz do que
--                               se trata sem abrir) e categoria.
--   lifeos_memoria_registros  — o CONTEÚDO. N registros de texto por
--                               memória, cada um datado. Crescem por append.
--
-- O índice é barato de ler (uma query, com a contagem de registros embutida)
-- e é o que o MCP injeta nas `instructions` do servidor; os registros só
-- são buscados quando o modelo abre uma memória específica.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_memorias (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null check (length(btrim(titulo)) > 0),
  -- 1–2 frases. É o que aparece no índice: precisa bastar pro modelo decidir
  -- se vale abrir a memória.
  descricao  text not null default '',
  -- Vocabulário `memoria_categoria` (lifeos_vocabularios), validado pelas
  -- Edge Functions — sem CHECK aqui, mesmo desenho da 0002.
  categoria  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Título único sem diferenciar caixa: o MCP abre memória por título, e
-- "Perfil" e "perfil" virariam duas memórias sobre a mesma coisa.
create unique index if not exists lifeos_memorias_titulo_uidx
  on public.lifeos_memorias (lower(btrim(titulo)));

create table if not exists public.lifeos_memoria_registros (
  id         uuid primary key default gen_random_uuid(),
  memoria_id uuid not null references public.lifeos_memorias(id) on delete cascade,
  texto      text not null check (length(btrim(texto)) > 0),
  -- Quem escreveu: 'manual' (a tela), 'claude-code', 'claude.ai'… Texto
  -- livre de propósito — o ponto da feature é trocar de cliente, e cada um
  -- se identifica como quiser. Nulo = não informado.
  origem     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lifeos_memoria_registros_memoria_idx
  on public.lifeos_memoria_registros (memoria_id, created_at);

-- RLS habilitado sem policies — mesmo padrão de todo `lifeos_*`: só a
-- service role (usada pelas Edge Functions) acessa.
alter table public.lifeos_memorias enable row level security;
alter table public.lifeos_memoria_registros enable row level security;

-- ────────────────────────────────────────────────────────────────────────
-- Vocabulário das categorias. Os quatro primeiros espelham os tipos de
-- memória do Claude Code (user/feedback/project/reference), pra migração de
-- lá pra cá ser direta; `Vida` cobre o que não é trabalho.
-- ────────────────────────────────────────────────────────────────────────

insert into public.lifeos_vocabularios (dominio, valor, cor, ordem, protegido)
values
  ('memoria_categoria', 'Perfil',       null, 10, false),
  ('memoria_categoria', 'Preferências', null, 20, false),
  ('memoria_categoria', 'Projetos',     null, 30, false),
  ('memoria_categoria', 'Referências',  null, 40, false),
  ('memoria_categoria', 'Vida',         null, 50, false)
on conflict (dominio, valor) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- As duas RPCs de vocabulário (0002) ganham o ramo `memoria_categoria`.
-- Reescritas por inteiro — `create or replace` não aceita "só um ramo a
-- mais". O corpo abaixo é o da 0002 + o ramo novo.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.lifeos_renomear_vocabulario(
  p_dominio text, p_de text, p_para text
) returns integer language plpgsql security definer set search_path to '' as $$
declare v_linhas integer := 0;
begin
  if p_de = p_para then return 0; end if;
  if not exists (select 1 from public.lifeos_vocabularios where dominio=p_dominio and valor=p_de) then
    raise exception 'valor_inexistente'; end if;
  if exists (select 1 from public.lifeos_vocabularios where dominio=p_dominio and valor=p_para) then
    raise exception 'valor_duplicado'; end if;
  case p_dominio
    when 'nota_tipo' then
      update public.lifeos_notas set tipo = array_replace(tipo, p_de, p_para) where p_de = any(tipo);
    when 'tarefa_status' then
      update public.lifeos_tarefas set status = p_para where status = p_de;
    when 'tarefa_tipo' then
      update public.lifeos_tarefas set tipo = array_replace(tipo, p_de, p_para) where p_de = any(tipo);
    when 'projeto_status' then
      update public.lifeos_projetos set status = p_para where status = p_de;
    when 'projeto_tag' then
      update public.lifeos_projetos set tags = array_replace(tags, p_de, p_para) where p_de = any(tags);
    when 'evento_tipo' then
      update public.lifeos_eventos set tipo = p_para where tipo = p_de;
    when 'manifestacao_status' then
      update public.lifeos_manifestacoes set status = p_para where status = p_de;
    when 'manifestacao_tag' then
      update public.lifeos_manifestacoes set tags = array_replace(tags, p_de, p_para) where p_de = any(tags);
    when 'mov_direcao', 'mov_meio' then
      update public.lifeos_movimentacoes set tipo = array_replace(tipo, p_de, p_para) where p_de = any(tipo);
    when 'memoria_categoria' then
      update public.lifeos_memorias set categoria = p_para where categoria = p_de;
    else raise exception 'dominio_invalido';
  end case;
  get diagnostics v_linhas = row_count;
  update public.lifeos_vocabularios set valor = p_para where dominio=p_dominio and valor=p_de;
  return v_linhas;
end; $$;

create or replace function public.lifeos_uso_vocabulario(
  p_dominio text, p_valor text
) returns integer language plpgsql security definer set search_path to '' as $$
declare v_n integer := 0;
begin
  case p_dominio
    when 'nota_tipo' then select count(*) into v_n from public.lifeos_notas where p_valor = any(tipo);
    when 'tarefa_status' then select count(*) into v_n from public.lifeos_tarefas where status = p_valor;
    when 'tarefa_tipo' then select count(*) into v_n from public.lifeos_tarefas where p_valor = any(tipo);
    when 'projeto_status' then select count(*) into v_n from public.lifeos_projetos where status = p_valor;
    when 'projeto_tag' then select count(*) into v_n from public.lifeos_projetos where p_valor = any(tags);
    when 'evento_tipo' then select count(*) into v_n from public.lifeos_eventos where tipo = p_valor;
    when 'manifestacao_status' then select count(*) into v_n from public.lifeos_manifestacoes where status = p_valor;
    when 'manifestacao_tag' then select count(*) into v_n from public.lifeos_manifestacoes where p_valor = any(tags);
    when 'mov_direcao', 'mov_meio' then select count(*) into v_n from public.lifeos_movimentacoes where p_valor = any(tipo);
    when 'memoria_categoria' then select count(*) into v_n from public.lifeos_memorias where categoria = p_valor;
    else raise exception 'dominio_invalido';
  end case;
  return v_n;
end; $$;

revoke execute on function public.lifeos_renomear_vocabulario(text, text, text) from public, anon, authenticated;
revoke execute on function public.lifeos_uso_vocabulario(text, text) from public, anon, authenticated;
grant  execute on function public.lifeos_renomear_vocabulario(text, text, text) to service_role;
grant  execute on function public.lifeos_uso_vocabulario(text, text) to service_role;
