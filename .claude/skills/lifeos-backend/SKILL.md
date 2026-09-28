---
name: lifeos-backend
description: Cria a parte de servidor de um domínio do LifeOS — tabela `lifeos_*` numa migration nova, Edge Function `lifeos-<modulo>` com gate de senha mestre e contrato {ok, error}, entrada no SETUP. Use quando o pedido precisar guardar um tipo de dado que ainda não tem tabela, ou quando for criar uma Edge Function nova. Trigger - /lifeos-backend
---

# /lifeos-backend

Tabela + migration + Edge Function para um domínio novo. É a primeira etapa de
`/lifeos-modulo`, e pode rodar sozinha quando só o backend é pedido.

**Referências no repositório** (leia antes de escrever):
- `supabase/migrations/0006_lifeos_citacoes.sql` — a migration mais simples
- `supabase/migrations/0007_lifeos_memorias.sql` — com relação 1:N, vocabulário e reescrita das RPCs
- `supabase/functions/lifeos-citacoes/index.ts` — o CRUD mais simples
- `supabase/functions/lifeos-memorias/index.ts` — com entidade filha e validação contra vocabulário
- `docs/LIFEOS.md` §8 (como plugar um módulo) e §14 (vocabulários)

---

## Antes de escrever

Confirme com o usuário, em uma pergunta só, o que não for óbvio do pedido:

1. **Nome do domínio** — singular do slug da function e plural da tabela
   (`lifeos-citacoes` / `lifeos_citacoes`). Português, sem acento, minúsculo.
2. **Campos** — nome, tipo, obrigatório ou não, limite de tamanho.
3. **Algum campo é uma lista de valores escolhidos** (status, tipo, tag)? Se
   sim, ele vira vocabulário — rode `/lifeos-vocabulario` para esse campo
   depois desta skill, não chape um `CHECK` nem uma constante.
4. **Relação com Projetos** (a entidade-eixo)? 1:1 é `projeto_id uuid
   references lifeos_projetos(id)`; N:N é tabela de junção (ver
   `lifeos_notas_projetos`).

---

## 1. Migration

Arquivo novo em `supabase/migrations/`, **próximo número da sequência**
(`ls supabase/migrations`). Nunca edite uma migration que já existe — ela pode
já ter rodado numa instância.

Molde:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- 00NN_lifeos_<dominio>.sql — <uma linha dizendo o que é>
--
-- <O que o domínio guarda e onde aparece na interface. Ver LIFEOS.md §N.>
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_<dominio> (
  id         uuid primary key default gen_random_uuid(),
  <campo>    text not null check (length(btrim(<campo>)) > 0),
  <opcional> text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS habilitado sem policies — mesmo padrão de todo `lifeos_*` (ver
-- 0001_init.sql): só a service role (usada pela Edge Function) acessa.
alter table public.lifeos_<dominio> enable row level security;
```

Regras:
- **RLS ligado, nenhuma policy.** Nunca `grant` para `anon`/`authenticated`.
- `check` no banco só para invariantes que nunca mudam (não-vazio, faixa
  numérica). **Nunca** `check (status in (...))` — lista de valores é
  vocabulário (`LIFEOS.md` §14).
- Valor padrão que o sistema precisa (uma linha inicial, uma config) entra
  como `insert … on conflict do nothing` **nesta migration** — nunca como
  constante no código.
- Comentário no topo explicando o porquê, no tom das migrations existentes.

Aplicar: pelo SQL Editor do Supabase, ou pela ferramenta de migration do MCP
do Supabase se ela estiver conectada. **Pergunte antes de aplicar** — escreve
no banco de produção do usuário.

## 2. Edge Function

Pasta nova `supabase/functions/lifeos-<dominio>/index.ts`. Copie
`lifeos-citacoes/index.ts` inteiro e adapte — ele já traz tudo que precisa ser
igual em todas:

| Parte | Mantém igual | Adapta |
|---|---|---|
| Cabeçalho | formato e seção SEGURANCA | descrição, ações, `LIFEOS.md §N` |
| CORS | `LIFEOS_ALLOWED_ORIGIN ?? "*"`, headers, `Vary` | — |
| `Deno.serve` | OPTIONS, só POST, `check_master_token`, `try/catch` → 500 | nome do objeto no corpo (`body.<dominio>`) |
| Ações | `query` (default), `create`, `update` (patch parcial), `delete` | ações extras se houver entidade filha (ver `lifeos-memorias`: `registro_create`…) |
| Helpers | `json()`, `cleanText()` | `normalizeRow()` com os campos novos |

Contrato que o front espera — não invente outro:

- Requisição: `POST { token, action, id?, <dominio>?, patch? }`
- Sucesso: `{ ok: true, <dominio>: {...} }` ou `{ ok: true, <plural>: [...] }`
- Erro: `{ ok: false, error: "<codigo>" }` com status HTTP coerente —
  `400` validação (`invalid_<campo>`, `missing_id`, `empty_patch`), `401`
  `unauthorized`, `404` `not_found`, `409` conflito (`has_<filhos>`,
  `<campo>_duplicado`), `502` `db_error: …`
- `update` é **patch parcial**: só valida e grava as chaves presentes, e
  sempre seta `updated_at`
- `normalizeRow()` define o formato que sai — o front e o cache do hub
  dependem dele; campo novo que não passa por ali não chega na tela
- Limites (`MAX_*`) como constantes no topo, com comentário do porquê

Campo de vocabulário: valide contra `lifeos_vocabularios` com fallback
embutido, como `fetchCategorias()` em `lifeos-memorias`.

## 3. Deploy e registro

1. `SETUP.md` → acrescente `lifeos-<dominio>` ao loop do `for fn in …`.
2. `docs/ARCHITECTURE.md` → contagem de Edge Functions/migrations, se o doc
   citar número.
3. Deploy (pergunte antes — publica em produção):
   ```bash
   supabase functions deploy lifeos-<dominio> --no-verify-jwt
   ```
   `--no-verify-jwt` é obrigatório: a autenticação é a senha no corpo, não um
   JWT. Com o MCP do Supabase conectado, a ferramenta de deploy dele serve,
   com `verify_jwt: false`.
4. Teste com `curl` contra a function deployada: sem token (`400
   missing_token`), token errado (`401`), `query` vazio (`{ok:true, …: []}`).

## 4. O que esta skill não faz

- Não cria tela — siga com `/lifeos-pagina` ou `/lifeos-hero-section`.
- Não expõe no MCP — siga com `/lifeos-mcp-tool`.
- Não cria vocabulário — siga com `/lifeos-vocabulario`.

Termine dizendo quais dessas etapas o pedido ainda precisa.

---

## Nunca

- Reaproveitar a Edge Function de outro domínio para "só mais uma ação"
- Policy de RLS, `grant` a `anon`, ou a service role key em qualquer arquivo
- `CHECK` com lista de valores de status/tipo/tag
- Editar migration já existente, ou pular número na sequência
- Deployar sem confirmar que o arquivo local tem tudo que a versão em produção tem
