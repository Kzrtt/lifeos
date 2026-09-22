-- ════════════════════════════════════════════════════════════════════════
-- 0004_eventos_date_fim.sql — data final opcional para Eventos
--
-- Motivação: eventos que duram mais de um dia (viagem, congresso, retiro…)
-- só podiam ser registrados pela data de início — não tinha como marcar até
-- quando iam. `date_fim` é OPCIONAL (a grande maioria dos eventos continua
-- sendo de um dia só, sem essa coluna preenchida); quando presente, o
-- evento passa a aparecer em TODOS os dias do intervalo [date, date_fim] no
-- mini-calendário do hub, não só no dia de início — ver LIFEOS.md §3.4.
--
-- `date_fim >= date` via CHECK — nunca faz sentido uma data final antes da
-- inicial. Nulo passa livre (evento de um dia só, o caso comum).
-- ════════════════════════════════════════════════════════════════════════

alter table public.lifeos_eventos
  add column if not exists date_fim date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lifeos_eventos_date_fim_check'
  ) then
    alter table public.lifeos_eventos
      add constraint lifeos_eventos_date_fim_check check (date_fim is null or date_fim >= date);
  end if;
end $$;
