---
name: lifeos-campo
description: Acrescenta uma coluna/campo a um módulo existente do LifeOS e a leva por toda a cadeia — migration, Edge Function (normalizeRow, create, update), mocks, formulário, render, cache do hub, MCP e docs — sem esquecer nenhuma cópia. Use para "adicionar um campo X em tarefas/notas/eventos…", "guardar também Y", "mostrar Z no card", ou qualquer mudança no formato de uma tabela `lifeos_*` que já existe. Trigger - /lifeos-campo
---

# /lifeos-campo

Um campo novo num módulo existente parece pequeno e é a mudança que mais
esquece lugar. O LifeOS copia em vez de compartilhar (`CLAUDE.md` §4.1), então
o mesmo dado passa por **vários arquivos que não sabem um do outro**. Esta
skill é, antes de tudo, um inventário.

---

## 1. Entenda o campo

Pergunte o que faltar, numa mensagem só:

- **Tipo e obrigatoriedade** — texto, número, data, booleano, referência?
  Obrigatório para linhas **novas** — e o que acontece com as linhas que já
  existem (default, nulo, backfill)?
- **Limite** — tamanho máximo, faixa válida.
- **É uma lista de valores escolhidos?** Então é vocabulário: esta skill cria
  a coluna e `/lifeos-vocabulario` cria o domínio.
- **Onde aparece** — só na página do módulo? No hub? No MCP (a IA precisa ler
  ou escrever)?

## 2. Inventário — ache todo mundo que toca a tabela

Antes de editar qualquer coisa:

```bash
grep -rlE "lifeos_<tabela>|lifeos-<function>" --include='*.js' --include='*.ts' --include='*.html' --include='*.sql' .
```

O grep traz também arquivos que só **citam** a tabela num comentário — abra
cada um e anote o que ele faz de fato com o módulo. Para os módulos atuais, o
esperado é:

| Módulo | Quem toca |
|---|---|
| Tarefas | `lifeos-tarefas`, `tarefas.js`, `lifeos.js` (hub, CRUD), `lifeos-views` (views salvas filtram por campo), `lifeos-mcp` |
| Projetos | `lifeos-projetos`, `lifeos.js` (CRUD), `tarefas.js` e `notas.js` (leitura), `lifeos-mcp` |
| Notas | `lifeos-notas`, `notas.js`, `lifeos.js` (leitura), `lifeos-views`, `lifeos-mcp` |
| Eventos | `lifeos-eventos`, `lifeos.js` (CRUD), `lifeos-mcp` (`eventos.js`, onde existir, é dormente — não precisa) |
| Movimentações | `lifeos-movimentacoes`, `lifeos-ingest`, `financas.js`, `lifeos.js` (leitura), `lifeos-mcp` (inclusive `resumo_financeiro`) |
| Manifestações | `lifeos-manifestacoes`, `lifeos.js`, `lifeos-mcp` (só leitura) |
| Citações | `lifeos-citacoes`, `lifeos.js`, `lifeos-mcp` |
| Memória | `lifeos-memorias`, `memoria.js`, `lifeos-mcp` |

Mostre a lista ao usuário e diga quais pontos o campo vai atravessar. Um
ponto que não vai receber o campo é decisão explícita, não esquecimento.

## 3. A cadeia, em ordem

### 3.1 Migration

Nova, próximo número em `supabase/migrations/` (`/lifeos-backend` §1 tem o
molde):

```sql
alter table public.lifeos_<tabela> add column if not exists <campo> <tipo> <default/null>;
```

- `not null` numa tabela com dados precisa de `default` ou de backfill na
  mesma migration.
- Sem `check` de lista de valores (isso é vocabulário).
- Pergunte antes de aplicar.

### 3.2 Edge Function do domínio

- `normalizeRow()` passa a devolver o campo — **sem isso ele não chega a
  nenhuma tela**.
- `create`: valida e grava (com o limite como `MAX_*` no topo).
- `update`: patch parcial — só mexe se a chave veio (`if ("<campo>" in patch)`),
  e aceita limpar (`null`/`""`) quando o campo é opcional.
- Se a query tem `select=` explícito, o campo entra nele.
- Deploy (pergunte antes), com `--no-verify-jwt`.

### 3.3 Cada front que consome

Para **cada** arquivo do inventário que exibe ou escreve o campo:

- **Mock** (`IS_LOCAL_DEV`): os dados fictícios ganham o campo, e o mock de
  create/update o grava — senão o teste local não vê nada.
- **Formulário** (`/lifeos-modal`): input no modal de criar/editar, preenchido
  no `open*Modal`, lido no `on*Submit`, com `maxlength` copiado da function.
- **Render**: onde o campo aparece (linha da lista, card, detalhe). Valor do
  banco em `innerHTML` passa por `esc()`.
- **Filtro/busca/ordenação**, se o campo entra neles.
- **Views salvas** (Notas e Tarefas têm): se o campo é filtrável, ele entra em
  `getCampoNota`/`getCampoTarefa` — que existem em cópia no hub **e** na
  página do módulo — e em `lifeos-views`, se ela valida os campos.

### 3.4 Cache do hub

Se `lifeos.js` exibe o campo: **suba `HUB_CACHE_V`** com comentário. Sem isso,
quem tem cache salvo vê as linhas antigas, sem o campo, até apertar ↻.
`tarefas.js`, `notas.js` e `financas.js` têm cache próprio, cada um com seu
`CACHE_V` — suba o da página que exibe o campo, pelo mesmo motivo.

### 3.5 MCP (`supabase/functions/lifeos-mcp/index.ts`)

Se a IA precisa enxergar ou escrever o campo (quase sempre sim):

- `search_*` — o campo entra no objeto devolvido (e no filtro, se fizer
  sentido).
- `create_*` / `update_*` — propriedade no `inputSchema` com `description`
  escrita **para o modelo** (o que é, formato, exemplo), e validação no
  handler com os **mesmos** limites da Edge Function.
- `assets/js/mcp.js` — a descrição da tool na tela do MCP.
- Detalhes em `/lifeos-mcp-tool`.

### 3.6 Outras entradas de dado

Movimentações também chegam por `lifeos-ingest` (webhook do celular) —
decida se o campo é aceito por lá. Qualquer outro caminho de escrita que o
inventário mostrou entra aqui.

## 4. Fechamento

- `?v=` de cada JS alterado sobe no HTML que o carrega.
- Docs: a seção do módulo em `LIFEOS.md` (ou `NOTAS.md`/`FINANCAS.md`), e o
  contrato da API se o doc o descreve campo a campo.
- Relatório final: o inventário com ✓ em cada ponto atualizado e o motivo de
  cada ponto deixado de fora.
- `/lifeos-revisar`.

## Nunca

- Parar na tela que o usuário pediu quando o campo também passa por hub e MCP
- Mudar o formato das linhas no hub sem subir `HUB_CACHE_V`
- Limite diferente entre front, Edge Function e MCP
- `update` que zera o campo quando ele não veio no patch
