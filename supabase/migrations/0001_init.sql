-- ════════════════════════════════════════════════════════════════════════
-- 0001_init.sql — schema completo do LifeOS
--
-- Gerado a partir do banco de produção em set/2026, quando o projeto passou
-- a ser preparado para open-source. Até aqui o schema existia SÓ dentro do
-- Supabase: um clone do repositório subia o front e as Edge Functions e
-- encontrava erro em toda chamada, porque nenhuma tabela existia.
--
-- Aplicar:  supabase db push        (ou cole no SQL Editor do dashboard)
-- Depois:   supabase/seed.sql       (cria a senha mestre inicial)
--
-- ⚠ NÃO é cópia literal da produção. Três políticas de acesso foram
--   FECHADAS aqui em relação ao que está lá hoje — estão marcadas com
--   [DIVERGE DA PRODUÇÃO] e explicadas no rodapé. Uma instalação nova deve
--   nascer fechada; a instância original precisa ser corrigida à parte.
-- ════════════════════════════════════════════════════════════════════════

-- `gen_random_uuid()` vem daqui. Em projetos Supabase já costuma estar
-- instalada, mas um projeto realmente vazio pode não ter.
create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────
-- 1. CONTROLE DE ACESSO
-- ────────────────────────────────────────────────────────────────────────

-- As senhas do sistema. `is_master = true` abre o LifeOS inteiro e qualquer
-- página protegida do archive; as demais abrem só as páginas concedidas em
-- token_pages.
--
-- As senhas ficam em TEXTO PURO, de propósito documentado: elas são
-- comparadas por igualdade dentro de funções SECURITY DEFINER e nunca saem
-- do banco (a tela de senhas só recebe versões mascaradas). Um hash seria
-- mais correto e é a melhoria óbvia — exigiria trocar `token = p_token` por
-- uma verificação de hash em check_master_token e check_page_access.
create table if not exists public.access_tokens (
  id        bigint generated always as identity primary key,
  token     text    not null unique,
  is_master boolean not null default false,
  label     text
);

-- Escopo por página das senhas NÃO-mestre. `page_slug` é o slug da entrada
-- do archive, o mesmo do manifest e do atributo data-page em gate.js.
create table if not exists public.token_pages (
  id        bigserial primary key,
  token_id  bigint not null references public.access_tokens(id) on delete cascade,
  page_slug text   not null,
  unique (token_id, page_slug)
);

-- Configuração chave/valor. Hoje: `github_pat` (token de publicação) e
-- `mcp_token` (token do conector MCP). Ambos são SEGREDOS — a tabela nunca
-- deve ganhar policy de leitura para `anon`.
create table if not exists public.admin_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────────────
-- 2. LIFEOS — DOMÍNIOS
-- ────────────────────────────────────────────────────────────────────────

-- Projetos são a entidade-mãe: toda tarefa pertence a um (not null), notas
-- se ligam a vários (N:N), eventos podem ter um (nullable).
create table if not exists public.lifeos_projetos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  emoji      text,
  status     text not null check (status in ('Não Iniciado','Em Progresso','Feito','Pausado')),
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `on delete restrict`: apagar um projeto com tarefas é recusado pelo banco.
-- A Edge Function traduz o erro em "has_tarefas" para a interface.
-- Atenção: o vocabulário de status aqui é "Em Andamento", enquanto o de
-- projeto é "Em Progresso". A diferença é real e intencional — não unifique.
create table if not exists public.lifeos_tarefas (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  status       text not null check (status in ('Não Iniciado','Em Andamento','Feito')),
  tipo         text[] not null default '{}',
  projeto_id   uuid not null references public.lifeos_projetos(id) on delete restrict,
  data_entrega date,
  descricao    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists lifeos_tarefas_projeto_id_idx on public.lifeos_tarefas (projeto_id);

-- `on delete set null`: apagar o projeto não apaga o evento, só desvincula.
create table if not exists public.lifeos_eventos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  date       date not null,
  tipo       text not null check (tipo in ('faculdade','psicodelia','trabalho','lazer','vida')),
  projeto_id uuid references public.lifeos_projetos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lifeos_eventos_date_idx on public.lifeos_eventos (date);

create table if not exists public.lifeos_notas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tipo        text[] not null default '{}',
  data        date,
  conteudo_md text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- N:N entre notas e projetos. Cascade nos dois lados: o vínculo não faz
-- sentido sem as duas pontas.
create table if not exists public.lifeos_notas_projetos (
  nota_id    uuid not null references public.lifeos_notas(id)    on delete cascade,
  projeto_id uuid not null references public.lifeos_projetos(id) on delete cascade,
  primary key (nota_id, projeto_id)
);

-- `tipo` é um array que mistura direção (Entrada/Saida) e meio (Crédito,
-- Débito, Pix, Vale, Boleto) na mesma coluna — ver FINANCAS.md. Herdado da
-- migração do Notion; as funções de saldo abaixo dependem desse formato.
create table if not exists public.lifeos_movimentacoes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  valor      numeric(12,2) not null check (valor >= 0),
  date       date not null,
  tipo       text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lifeos_movimentacoes_date_idx on public.lifeos_movimentacoes (date);

create table if not exists public.lifeos_manifestacoes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null check (status in ('Não Iniciado','Em Progresso','Feito')),
  tags       text[] not null default '{}',
  banner_url text,
  descricao  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Galeria do archive (galeria.html). Não faz parte do LifeOS.
create table if not exists public.gallery (
  id         uuid primary key default gen_random_uuid(),
  image_url  text,
  updated_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────────────
-- 3. RLS
--
-- Todas as tabelas com RLS LIGADO e SEM policy: isso bloqueia `anon` e
-- `authenticated` por completo. A `service_role` ignora RLS, e é só ela que
-- as Edge Functions usam — a service key nunca chega ao browser.
--
-- Ou seja: o dado do LifeOS é inalcançável com a anon key pública. A
-- fronteira de verdade é a senha mestre validada dentro das functions.
-- ────────────────────────────────────────────────────────────────────────

alter table public.access_tokens        enable row level security;
alter table public.token_pages          enable row level security;
alter table public.admin_config         enable row level security;
alter table public.lifeos_projetos      enable row level security;
alter table public.lifeos_tarefas       enable row level security;
alter table public.lifeos_eventos       enable row level security;
alter table public.lifeos_notas         enable row level security;
alter table public.lifeos_notas_projetos enable row level security;
alter table public.lifeos_movimentacoes enable row level security;
alter table public.lifeos_manifestacoes enable row level security;
alter table public.gallery              enable row level security;

-- [DIVERGE DA PRODUÇÃO] — ver rodapé, item A.
-- A galeria é pública para LEITURA e só para leitura.
create policy gallery_select_anon on public.gallery
  for select to anon using (true);

-- ────────────────────────────────────────────────────────────────────────
-- 4. FUNÇÕES
-- ────────────────────────────────────────────────────────────────────────

-- O gate de TUDO no LifeOS. `service_role`-only: só as Edge Functions
-- chamam, nunca o browser.
create or replace function public.check_master_token(p_token text)
returns boolean language sql security definer set search_path to '' as $$
  select exists (
    select 1 from public.access_tokens
    where token = p_token and is_master = true
  );
$$;

-- O gate das páginas protegidas do archive (gate.js / login.html), chamado
-- do browser com a anon key.
--
-- Atenção ao que ele faz: um token mestre passa em QUALQUER página, sem
-- precisar de linha em token_pages. É por isso que a senha do antigo painel
-- /admin sempre foi, na prática, a senha mestre.
create or replace function public.check_page_access(p_token text, p_page text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
    from public.access_tokens t
    where t.token = p_token
      and (
        t.is_master = true
        or exists (
          select 1 from public.token_pages tp
          where tp.token_id = t.id and tp.page_slug = p_page
        )
      )
  );
$$;

-- Devolve um valor de admin_config, exigindo senha MESTRE.
--
-- O `and is_master = true` é o resultado de uma correção de segurança
-- (set/2026): antes a função checava só a existência do token, e qualquer
-- senha de página — algumas com 3 a 6 caracteres — recuperava o github_pat
-- chamando a RPC direto. Não afrouxe esta condição.
--
-- `search_path to ''` + prefixo `public.` explícito, como as outras. Na
-- produção esta função nasceu com `search_path to 'public'` e referências
-- sem prefixo — funciona, mas é a variante frágil: search_path mutável é o
-- vetor clássico de sequestro de função em SECURITY DEFINER. Padronizado
-- aqui de propósito.
create or replace function public.get_admin_config(p_token text, p_key text)
returns text language plpgsql security definer set search_path to '' as $$
declare v_value text;
begin
  if not exists (
    select 1 from public.access_tokens where token = p_token and is_master = true
  ) then
    return null;
  end if;
  select value into v_value from public.admin_config where key = p_key;
  return v_value;
end;
$$;

-- Saldo acumulado antes de uma data. "Crédito" não entra: a fatura é
-- projetada à parte — ver FINANCAS.md.
create or replace function public.lifeos_saldo_abertura(p_before date)
returns numeric language sql security definer set search_path to '' as $$
  select coalesce(sum(
    case
      when 'Entrada' = any(tipo) then valor
      when 'Saida' = any(tipo) and not ('Crédito' = any(tipo)) then -valor
      else 0
    end
  ), 0)::numeric
  from public.lifeos_movimentacoes
  where date < p_before;
$$;

create or replace function public.lifeos_range()
returns table(min_date date, max_date date)
language sql security definer set search_path to '' as $$
  select min(date), max(date) from public.lifeos_movimentacoes;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 5. PERMISSÕES DE EXECUÇÃO
--
-- Funções SECURITY DEFINER rodam com os privilégios de quem as criou e
-- ignoram RLS. Qualquer uma exposta ao `anon` é superfície de ataque
-- pública — o `revoke ... from public` abaixo é deliberado e não deve ser
-- afrouxado sem motivo.
--
-- Só DUAS precisam do `anon`, porque o browser as chama direto no fluxo de
-- senha das páginas protegidas.
-- ────────────────────────────────────────────────────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.check_page_access(text, text) to anon;
grant execute on function public.get_admin_config(text, text)  to anon;

grant execute on function public.check_master_token(text)      to service_role;
grant execute on function public.lifeos_saldo_abertura(date)   to service_role;
grant execute on function public.lifeos_range()                to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 6. STORAGE
--
-- Bucket dos banners de Manifestações. Público para leitura porque as URLs
-- são renderizadas direto em <img> no hub; a ESCRITA acontece só dentro da
-- Edge Function lifeos-manifestacoes, com a service role.
-- ────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('manifestacoes', 'manifestacoes', true)
on conflict (id) do nothing;

-- Bucket da galeria (galeria.html). Publico para leitura pelo mesmo motivo:
-- as URLs sao renderizadas direto em <img> numa pagina publica.
--
-- ESCRITA: passa pela Edge Function `gallery-upload` (service role) --
-- ver migration 0005_gallery_lockdown.sql. NAO cria policy nenhuma de
-- INSERT pra `anon` aqui (nem na tabela `gallery`, nem neste bucket) --
-- só SELECT é liberado pra `anon`, de propósito. Um desenho ANTERIOR
-- escrevia direto do browser com a anon key (sem Edge Function nenhuma);
-- ficou sem policy de escrita nem aqui nem na tabela desde o início
-- deste arquivo, o que quebrava o upload de cara -- não repita esse
-- padrão se algum dia mexer nisso de novo.
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════
-- RODAPÉ — onde este arquivo DIVERGE da produção, e por quê
--
-- Levantado ao gerar esta migration. São três pontos; os dois primeiros são
-- falhas reais na instância original e precisam ser corrigidos lá.
--
-- A) `gallery` aceitava INSERT de `anon` (policy `anon_insert_gallery`,
--    with check `true`). Qualquer pessoa com a anon key — que é pública por
--    natureza, vai no código do site — podia inserir linhas arbitrárias na
--    galeria. Aqui só a policy de SELECT foi recriada.
--
--      Para corrigir a instância original:
--      drop policy if exists anon_insert_gallery on public.gallery;
--
-- B) `token_pages` tinha SELECT liberado para `anon` (`anon_read_token_pages`,
--    using `true`). Não vaza senha, mas vaza o mapa de quais páginas são
--    protegidas e por qual token_id — informação que só ajuda quem está
--    tentando entrar. Nenhum código do projeto depende dessa policy: quem lê
--    a tabela é check_page_access (SECURITY DEFINER) e a Edge Function
--    lifeos-senhas (service role).
--
--      Para corrigir a instância original:
--      drop policy if exists anon_read_token_pages on public.token_pages;
--
-- C) Funções que existiam na produção e NÃO foram recriadas aqui:
--
--    - `check_access_token(text)` — checa só se o token existe, sem olhar
--      is_master. Nenhum arquivo a chama. Exposta ao `anon`, ela é um
--      oráculo de força bruta: dá para testar senhas contra ela sem limite.
--      Legado do desenho antigo; não deve nascer de novo.
--
--    - `list_access_tokens`, `list_token_pages`, `grant_token_page`,
--      `revoke_token_page` — substituídas pela Edge Function `lifeos-senhas`
--      em set/2026, que faz o mesmo com a service role. Nenhuma é chamada
--      pelo front. As quatro estavam expostas ao `anon`, e
--      `list_access_tokens` devolve os tokens EM TEXTO PURO.
--
--    - `get_notion_token()` — leitura do Vault para a migração única do
--      Notion. Não pertence ao produto.
--
--      Para limpar a instância original:
--      drop function if exists public.check_access_token(text);
--      drop function if exists public.list_access_tokens(text);
--      drop function if exists public.list_token_pages(text);
--      drop function if exists public.grant_token_page(text, bigint, text);
--      drop function if exists public.revoke_token_page(text, bigint);
-- ════════════════════════════════════════════════════════════════════════
