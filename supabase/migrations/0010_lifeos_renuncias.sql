-- ════════════════════════════════════════════════════════════════════════
-- 0010_lifeos_renuncias.sql — renúncias do LifeOS
--
-- Um hábito que o autor cortou, e há quanto tempo está sem ele. A tela
-- (lifeos/renuncias.html, pelo drawer) mostra o tempo corrido e uma barra
-- até o próximo marco (1d, 3d, 7d… 1a). Ver LIFEOS.md §19.
--
-- Duas tabelas:
--
--   lifeos_renuncias            — a renúncia em curso: nome, emoji e `desde`
--                                 (o momento da última vez; pode ser no
--                                 passado, com hora).
--   lifeos_renuncia_tentativas  — o histórico. Cada recaída fecha a
--                                 tentativa atual (inicio = desde antigo,
--                                 fim = momento da recaída) e o `desde`
--                                 recomeça. O recorde sai daqui.
--
-- Os marcos não moram no banco: são uma escala fixa de tempo, não uma
-- preferência — o front e o MCP têm a mesma lista.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_renuncias (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(btrim(nome)) > 0),
  emoji      text not null check (length(btrim(emoji)) > 0),
  -- A última vez que fez. O contador corre a partir daqui.
  desde      timestamptz not null,
  -- Arquivada some da lista principal sem perder o histórico.
  arquivada  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nome único sem diferenciar caixa: o MCP busca renúncia por nome, e
-- "Açúcar" e "açúcar" seriam a mesma coisa contada duas vezes.
create unique index if not exists lifeos_renuncias_nome_uidx
  on public.lifeos_renuncias (lower(btrim(nome)));

create table if not exists public.lifeos_renuncia_tentativas (
  id          uuid primary key default gen_random_uuid(),
  renuncia_id uuid not null references public.lifeos_renuncias(id) on delete cascade,
  inicio      timestamptz not null,
  fim         timestamptz not null,
  created_at  timestamptz not null default now(),
  check (fim >= inicio)
);

create index if not exists lifeos_renuncia_tentativas_renuncia_idx
  on public.lifeos_renuncia_tentativas (renuncia_id, fim);

-- RLS habilitado sem policies — mesmo padrão de todo `lifeos_*` (ver
-- 0001_init.sql): só a service role (usada pela Edge Function) acessa.
alter table public.lifeos_renuncias enable row level security;
alter table public.lifeos_renuncia_tentativas enable row level security;

-- ────────────────────────────────────────────────────────────────────────
-- Recaída numa transação só: fechar a tentativa e recomeçar o `desde` são
-- duas escritas, e uma sem a outra perde a tentativa ou a duplica.
-- Devolve 'ok', 'not_found' ou 'antes_do_inicio' (a recaída não pode ser
-- anterior ao começo da tentativa que ela fecha).
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.lifeos_renuncia_recaida(p_id uuid, p_quando timestamptz)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_desde timestamptz;
begin
  select desde into v_desde from public.lifeos_renuncias where id = p_id for update;
  if not found then return 'not_found'; end if;
  if p_quando < v_desde then return 'antes_do_inicio'; end if;

  insert into public.lifeos_renuncia_tentativas (renuncia_id, inicio, fim)
  values (p_id, v_desde, p_quando);

  update public.lifeos_renuncias
     set desde = p_quando, updated_at = now()
   where id = p_id;

  return 'ok';
end;
$$;

-- Mesma postura das outras RPCs: só a service role, dentro da Edge Function.
revoke execute on function public.lifeos_renuncia_recaida(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.lifeos_renuncia_recaida(uuid, timestamptz) to service_role;
