# FINANCAS.md — Módulo Finanças do LifeOS (`lifeos/financas.html`)

> Subsystem adicionada em **jun/2026**; migrada de fonte de dados (Notion →
> Supabase) em **set/2026**, quando passou a ser um dos módulos do **LifeOS**
> — página própria e isolada (`lifeos/financas.html` +
> `assets/js/financas.js`), aberta a partir do hub `lifeos/lifeos.html`. É a
> **primeira camada de backend dinâmico** do projeto — todo o resto do
> LifeOS é estático (GitHub Pages, sem backend). Lê este doc inteiro
> antes de mexer em qualquer parte de finanças. Ver [`LIFEOS.md`](LIFEOS.md)
> para o hub e a arquitetura de módulos isolados como um todo.
>
> **Caminhos:** a página mora em `lifeos/`, o JS continua em `assets/js/`.
> No corpo deste doc `/financas` e `financas.html` são usados como nome curto
> do módulo; a URL real é `…/SEU-REPOSITORIO/lifeos/financas.html`. Ver
> [`LIFEOS.md`](LIFEOS.md) §"Onde os arquivos moram".

---

## 1. O que é

Dashboard financeiro pessoal, **master-only**, módulo **Finanças** do LifeOS
— página própria (`financas.html`), isolada de `lifeos.html` (ver
[`LIFEOS.md`](LIFEOS.md) §2). Lê a tabela própria
`public.lifeos_movimentacoes` no Supabase e apresenta KPIs, gráficos,
recorrências e análises **mês a mês**.

- **Posse dos dados:** até set/2026 a fonte era a base "Movimentações" do
  Notion; migrado para uma tabela própria (`lifeos_movimentacoes`) pra ter
  controle total, sem depender de API de terceiro. O Notion **não é mais
  tocado** por este módulo — segue existindo só como cópia histórica dormente
  (ver §9) e como fonte da view de notas do LifeOS (fora deste módulo).
- Vive **fora** do fluxo de mapas/entradas do archive. É uma **seção de nível
  raiz**, como `galeria.html` — **não** entra no `manifest.json`, não é um "card".
- Tem **estética própria** (dashboard dark "fintech"), deliberadamente fora do
  tema sépia/Playfair do archive.
- URL: `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/financas.html`
- Acesso: link **`lifeos`** no rodapé do `index.html` (master-only) leva ao
  hub `lifeos.html`, que linka pra `financas.html` — ou URL direta.
  A página tem `<meta robots noindex,nofollow>` e o link do rodapé tem
  `rel="nofollow"`.
- **Export:** botão na topbar (ao lado do refresh) exporta o mês corrente em
  `.csv` (`movimentacoes-YYYY-MM.csv`), BOM UTF-8 + CRLF, colunas `data, descricao,
  valor, direcao, meio, tipo_raw, valor_liquido, id`. No iPhone usa o **share
  nativo** (Web Share API — `navigator.share` com `files`) pra enviar a outro app
  sem baixar; no desktop cai pro download.
- **Saldo de abertura:** o gráfico de saldo acumulado começa do saldo de caixa
  que sobrou dos meses anteriores (campo `saldo_abertura` do response), não de
  zero, com uma nota mostrando o valor. Assim o "0 → salário" do dia do pagamento
  parte do saldo real. Calculado server-side na Edge Function.
- **Fatura deste mês (fecha agora):** card acima do de "Fatura projetada",
  mostrando as compras em `Crédito` feitas no mês **anterior** ao exibido que
  caem na fatura de **agora** — ou seja, a fatura projetada no mês passado que
  está fechando/sendo paga neste mês. Vem **fechado** (só o total no cabeçalho);
  expande pra listar cada movimentação de crédito daquele mês. Precisa dos dados
  do mês anterior, que o fetch do mês exibido não traz sozinho — busca/cacheia
  esse mês à parte sob demanda (`ensureMonthRows`), reaproveitando o mesmo
  contrato da Edge Function (não é uma rota nova, é só mais uma chamada com
  `ym` diferente). Sem chamada nova = sem alteração no Supabase.
- **Fatura projetada:** card que projeta, por competência de crédito, quanto das
  compras em `Crédito` do mês exibido vai cair na fatura de cada mês **futuro**.
  Regra: a fatura fecha no **último dia do mês** — compra antes do último dia
  vai pra **M+1**; compra no último dia já entra no ciclo seguinte (**M+2**). É
  leitura/projeção, não altera o saldo de caixa. Mesma função de agrupamento
  (`calcularProjecaoFatura`) é reaproveitada pelos dois cards acima, com
  mês-fonte diferente. Brief: `CREDITO-FATURA-PROJECAO.md`.
- **Débito de fatura por pagamento:** movimentações `Saida` **sem nenhum meio**
  (a mesma "Sem meio" do donut) com descrição contendo "fatura" (`isPagamentoFatura`,
  regex `/fatura/i`, igual à já usada em `calcularProjecaoFatura` pra excluir o
  pagamento da lista de compras novas) são usadas pra abater o total da "Fatura
  deste mês". `splitPagamentosFatura` ordena esses pagamentos por data e faz soma
  cumulativa: todo pagamento cujo acumulado **antes dele** já atingiu o total da
  fatura é puro **adiantamento**; os demais contam como quitação da fatura **atual**
  (o pagamento que cruza a linha — quita o resto e ainda sobra — fica do lado da
  atual, já que é ele quem fecha a conta). Mostra **pago/restante em N pagamentos**
  (ou **quitada ✓**) no card da fatura atual, contando só os pagamentos desse grupo
  — não mistura com os de adiantamento. O excedente vira **adiantamento** anotado
  no card "Fatura projetada" (no mês-destino mais próximo), com sua própria
  contagem de pagamentos e o **valor atual** dessa fatura projetada já descontado
  o adiantamento (recalculado de `calcularProjecaoFatura(MROWS, currentYM())`, não
  lido do DOM). É leitura pura — não altera o saldo de caixa nem reclassifica a
  movimentação.
  **Adiantamento pago em qualquer mês anterior (cadeia recursiva):** um
  adiantamento da fatura de `ym` pode ter sido pago vários meses antes dela
  fechar, e o excesso pode ter atravessado mais de um mês no caminho (ex.:
  sobrou de julho pra agosto, e só a SOMA disso com o que sobrou de agosto é
  que ultrapassa a fatura de agosto e vira adiantamento de setembro).
  `carryInto(m)` resolve isso **recursivamente**: quanto de `m` (pagamentos
  de "fatura" feitos dentro de `m`, mais o que `carryInto(prevMonth(m))` já
  tinha carregado até `m`) excede o total da fatura própria de `m` carrega
  pra `nextMonth(m)`. `renderFaturaMesPassado(ym)` usa `carryInto(pYm)`
  como os pagamentos "trazidos de fora" pra somar aos pagamentos feitos no
  próprio `ym`. A recursão para sozinha num mês sem nenhum pagamento de
  "fatura" (nada a carregar) ou fora do range (`ensureMonthRows` resolve
  `null`); `ensureMonthRows` cacheia por mês, então a recursão não repete
  fetch de rede pro mesmo mês mesmo se vários `carryInto` pedirem o mesmo
  mês em paralelo. **Antes só ia um nível pra trás** (`pYm`/`ppYm`
  hardcoded) — uma cadeia de 3+ meses de sobra pequena escondia o
  adiantamento ao navegar direto pro mês final, só aparecia se o usuário
  passasse pelo mês do meio primeiro.
  **Pagamento que cruza a linha:** `splitPagamentosFatura` compara em
  **centavos** (não float, pra não gerar uma entrada fantasma de R$0,00
  quando um pagamento bate exatamente o total restante) e, quando um
  pagamento tanto quita o resto da fatura atual QUANTO sobra pra próxima
  (ex.: fatura de R$1.906,21, faltam R$1.466,21, e o pagamento é de
  R$1.616,21), **parte** esse pagamento em duas entradas sintéticas — uma só
  com o que faltava (conta como quitação) e outra só com o excedente (conta
  como adiantamento), mesma data/nome, `_partial: true`. Sem isso, o
  excedente ficava embutido dentro do pagamento que fecha a conta e
  desaparecia pra quem só olha a lista de adiantamento (exatamente o caso do
  `carryInto` recursivo, que soma o que carrega de cada mês com os
  pagamentos do mês seguinte antes de comparar de novo — se o excedente não
  vem separado, o próximo hop da recursão não teria como enxergá-lo).
  **Adiantamento explícito:** além dos dois mecanismos acima (que dependem
  da MATEMÁTICA — soma superar o total, mesmo que só depois de somar
  sobra de meses anteriores), `isAdiantamentoExplicito` cobre o caso em que
  não há sobra matemática nenhuma isoladamente: pagamento de fatura cujo
  nome também contém "adiant" (ex.: "Adiantamento fatura setembro") pula
  inteiro a conta de quitação da fatura que fecha agora — vai direto pro
  excedente da fatura seguinte, mesmo com a fatura atual ainda em aberto.
  Vale tanto pra pagamentos feitos no mês exibido quanto pros carregados via
  `carryInto`. **Só funciona se o registro no Notion for de fato renomeado**
  com "adiant" no nome — é uma marcação de intenção manual, não é inferida.
- **Donut por meio de pagamento — 3 modos:** toggle (Saídas / Entradas / Ambos)
  acima do gráfico. Saídas é o comportamento original e o default; Entradas
  espelha o mesmo agrupamento por meio só pras entradas; Ambos soma os dois
  lados em valor absoluto (atividade total do canal, não o líquido). O clique
  numa fatia (`openMeioModal`) respeita o modo ativo ao filtrar o modal.
- **Tabs Transações/Recorrências:** abaixo dos gráficos, uma divisória
  (`.section-divider`) separa a zona de gráficos da zona de listagem. Duas
  "view-tabs" num grid de 2 colunas alternam qual card fica visível
  (`switchView`/`.view-panel[hidden]`); o conteúdo de ambas é recalculado a cada
  `render()` **independente** de qual está visível — trocar de aba é só
  toggle de `hidden`, sem recomputar nada. Pensado pra ser fácil de estender
  com novas formas de visualizar os dados (só somar outro botão + panel).
  Default é "Transações do mês"; a seleção persiste entre navegações de mês e
  reseta no logout (`resetViewTabs`).
- **Header de data na tabela de transações:** cada grupo de dia mostra, na
  mesma linha da data, entradas/saídas/diferença **daquele dia** (reaproveita
  `summarize()`), pra bater o olho e já ver a divisão diária sem abrir cada
  linha.
- **Ações de linha no hover (editar/excluir, desktop-only):** cada linha da
  tabela de transações mostra, no **hover**, dois *icon buttons* reais
  (`.row-actions` → `.row-action-btn`, chrome visível — fundo, borda,
  hover dourado, não só um glifo solto) escondidos por CSS abaixo de 720px
  (não existem no mobile, não é só oculto — hover não existe em touch).
  - **✎ Editar:** abre `#edit-modal` pra editar **Data**, **Valor** e
    **Direção/Meio** (as tags `Tipo`) de uma movimentação já existente. Todo
    campo é **opcional**: só o que o usuário de fato mexeu entra no PATCH
    (`EDIT_DIRTY` rastreia toque por campo, não diff de valor — evita
    reescrever tags por acidente quando reabre e salva sem mudar nada).
  - **🗑 Excluir:** confirmação inline de **dois cliques** — o botão vira
    "confirmar?" por ~3s (`DELETE_PENDING` + `setTimeout`); um segundo
    clique dentro da janela executa o delete, clicar em qualquer outro lugar
    ou deixar o tempo passar cancela. Sem modal nem `confirm()` nativo.
  - Resposta da function já vem normalizada; o front só sobrescreve/remove a
    linha em `MROWS` (mesma referência de `monthCache[ym]`, ver `storeMonth`),
    grava `writeCache()` e chama `render()` — sem re-fetch do mês.
- **Criar movimentação:** botão + (`#create-btn`) na topbar abre `#create-modal`
  — todos os campos são **obrigatórios** aqui (Nome, Data, Valor, Direção,
  Meio), ao contrário do modal de edição. No sucesso, insere a movimentação
  retornada em `MROWS` se a data cai no mês exibido (senão só invalida o
  cache do mês de destino, que é buscado de novo quando o usuário navegar
  até lá) e chama `render()`.
- **Modal de ajuda (botão "?" no rodapé):** conteúdo **estático** (não depende
  de `MROWS`, vive todo em `financas.html`) explicando as tags de direção/meio
  e a lógica de cada componente (regime de caixa, faturas, donut, recorrências,
  export). É o mesmo texto deste doc, resumido pra leitura rápida na própria UI.
  Reaproveita as classes `.modal`/`.modal-panel`/`.modal-body` do modal de
  transações (`openHelpModal`/`closeHelpModal`, id `#help-modal` separado).

---

## 2. Por que existe uma Edge Function (a razão da camada nova)

Dois motivos técnicos:

1. **Segredo.** As escritas na tabela usam a **service role key** do
   Supabase, que dá acesso total ao banco — não pode ficar exposta no client
   (que é estático e público). A Edge Function esconde a service role e só
   expõe a operação já validada.
2. **Fronteira de autenticação real.** O gate de senha do `financas.html` é
   só UX; a validação de `is_master` precisa acontecer **server-side** —
   a Edge Function é onde isso é aplicado antes de tocar no banco.

O hop é uma **Supabase Edge Function** (`lifeos-movimentacoes`). Ela esconde a
service role, aplica a fronteira de autenticação real (server-side) e expõe
`query`/`update`/`create`/`delete` sobre a tabela `lifeos_movimentacoes`.

> Histórico: até set/2026 a function (`notion-movimentacoes`) era um hop de
> **CORS** pro Notion (a API REST do Notion não envia headers de CORS, e o
> token do Notion lia o workspace inteiro). Com a migração pra uma tabela
> própria, a razão do hop mudou de "CORS + segredo do Notion" pra "segredo da
> service role + fronteira de auth" — o padrão de Edge Function como boundary
> se manteve, só a razão técnica específica mudou. A function antiga fica
> **dormente** (não é mais chamada pelo front) — ver §9.

---

## 3. Arquitetura

```
┌───────────────────────────────────────────┐
│  financas.html + assets/js/financas.js     │  GitHub Pages (estático)
│  Chart.js (CDN) · gate de senha mestre     │
└───────────────┬───────────────────────────┘
                │  POST { token, ym, action? }   (apikey anon)
                ▼
┌───────────────────────────────────────────┐
│  Supabase Edge Function                    │  projeto SEU-PROJETO-REF
│  lifeos-movimentacoes  (verify_jwt=false)  │
│  1. check_master_token(token)  → 401 se ✗  │  ← RPC via SERVICE_ROLE_KEY
│  2. action: query|update|create|delete     │
│  3. lê/escreve lifeos_movimentacoes        │  ← REST (PostgREST) c/ service role
│  4. normaliza + CORS + devolve JSON        │
└───────────────┬───────────────────────────┘
                │  REST (service role)
                ▼
┌───────────────────────────────────────────┐
│  public.lifeos_movimentacoes (Postgres)    │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│  Automação externa do autor                 │
│  POST (payload formato Notion, inalterado) │
└───────────────┬───────────────────────────┘
                │  ?token=<senha mestre>
                ▼
┌───────────────────────────────────────────┐
│  Edge Function lifeos-ingest               │  webhook, verify_jwt=false
│  1. check_master_token(token) → 401 se ✗   │
│  2. parseia o payload (mesmos paths do     │
│     formato "create page" do Notion)       │
│  3. insere em lifeos_movimentacoes         │
└───────────────────────────────────────────┘
```

As agregações (KPIs, donut, fluxo, saldo, recorrências, filtros) rodam **no JS
da página**, sobre o JSON normalizado de **um mês**. As Edge Functions são
"burras": só autenticam, buscam/escrevem, normalizam e devolvem.

---

## 4. Componentes

### 4.1 Frontend (estático)
- **`financas.html`** — página self-contained (HTML + `<style>` interno),
  **isolada** do hub e dos outros módulos (ver [`LIFEOS.md`](LIFEOS.md) §2)
  — só o módulo Finanças, sem código de hub/Eventos dentro. Carrega, no fim
  do `<body>`: Chart.js (CDN), `assets/js/financas.js?v=...` e
  `assets/js/back-to-top.js`.
- **`assets/js/financas.js`** — toda a lógica do módulo Finanças (JS cru,
  IIFE, sem framework): gate de senha, fetch da Edge Function, cache por
  mês, agregações, gráficos, recorrências, filtros, modais (editar/criar/
  excluir). Não referencia nem é referenciado por `lifeos.js`/`eventos.js`.

### 4.2 Backend (Supabase · projeto `SEU-PROJETO-REF` · região `<sua região>`)
- **Tabela `public.lifeos_movimentacoes`** — fonte de verdade das
  movimentações. Colunas: `id uuid`, `name text`, `valor numeric(12,2)`,
  `date date`, `tipo text[]`, `created_at`, `updated_at`. RLS habilitado sem
  policies (só `service_role` acessa — mesma postura de `access_tokens`/
  `admin_config`). Índice em `date`.
- **Edge Function `lifeos-movimentacoes`** (`verify_jwt=false` — intencional).
  Ações: `query` (default), `update`, `create`, `delete` — ver §6.
- **Edge Function `lifeos-ingest`** (`verify_jwt=false`) — webhook que aceita
  o payload no formato "create page" do Notion **inalterado**, autentica via
  `?token=` na query string, e insere em `lifeos_movimentacoes`. Existe pra a
  automação externa do autor só precisar trocar a URL, sem tocar no payload.
- **RPC `check_master_token(p_token text) → boolean`** — `SECURITY DEFINER`,
  `search_path=''`, **EXECUTE só para `service_role`**. Gate estrito (só
  `is_master`), diferente do `check_access_token` (que aceita qualquer token).
  Reaproveitada por `lifeos-movimentacoes` e `lifeos-ingest`.
- **RPC `lifeos_saldo_abertura(p_before date) → numeric`** — `SECURITY
  DEFINER`, `search_path=''`, **EXECUTE só para `service_role`**. Soma
  condicional (Entrada soma; Saida sem Crédito subtrai) de tudo antes de
  `p_before` — mesma regra que `fetchSaldoAbertura` tinha no Notion, agora em
  SQL direto.
- **RPC `lifeos_range() → table(min_date date, max_date date)`** — idem,
  devolve o mês mais antigo/mais novo com dados.
- Tabela `access_tokens` (já existia): a **senha mestre** é a linha `is_master = true`.

Migrations aplicadas: `finance_master_gate_and_notion_secret` e
`finance_lockdown_check_master_token` (legado, Notion) · `create_lifeos_movimentacoes`
· `create_lifeos_saldo_abertura_rpc` · `create_lifeos_range_rpc`.

---

## 5. Fluxo de dados — busca POR MÊS (sob demanda)

O cliente **nunca** baixa a base inteira. Cada navegação pede um mês:

1. O front manda `{ token, ym: "YYYY-MM" }`.
2. A function, em paralelo:
   - acha o **mês mais antigo** e o **mais novo** com dados (2 queries de 1 linha,
     ordenadas por `Date` asc/desc) → `range = { min, max }`;
   - busca **só o mês `ym`** (filtro `Date` `on_or_after` 1º dia / `before` 1º dia
     do mês seguinte), paginando se preciso.
3. Devolve o mês + o `range`. O front usa o `range` para **travar as setas** de
   navegação (sem baixar tudo) e **cacheia** o mês.

**Cache persistente (localStorage, JSON):** o cliente é um **cache "burro"**.
Cada mês buscado é gravado em `localStorage` (chave `financas_cache`,
`{ v, range, months: { "YYYY-MM": { rows, abertura, fetched_at } } }`) e
**sobrevive a reloads e dias** — abrir um mês já cacheado **não chama a Edge
Function** (renderiza direto do cache, inclusive no **boot**: se o mês atual já
está em cache, a página entra sem rede nenhuma). Trocar para um mês não-cacheado
busca e cacheia (mostra **spinner**).

- **`fetched_at` é por mês.** O label "sincronizado" da topbar mostra quando
  **aquele mês exibido** foi buscado (pode ser de ontem) — não o último fetch
  global. Isso dá sentido real ao label.
- **↻ (refresh) é a única forma de buscar dados novos.** Invalida **só o mês na
  tela** e re-busca; os demais meses cacheados permanecem.
- **Persistência independe do "lembrar".** O cache sempre fica gravado; o
  checkbox "lembrar" controla só a **senha** (auto-login). O cache só é apagado
  no **logout** (que limpa `financas_cache` + a senha). `CACHE_V` invalida caches
  de schema antigo; cache corrompido/quota cheia degrada para memória/fetch.
- ⚠️ **Segurança:** os dados financeiros ficam em texto puro no `localStorage`
  (mesma postura que a senha já tinha com "lembrar"). Acesso ao dispositivo =
  acesso aos dados. A fronteira real continua sendo a Edge Function.

> Histórico: a 1ª versão trazia **tudo num fetch** e filtrava no client. Mudou
> para busca por mês a pedido do autor (aceitou a latência por navegação em troca
> de não carregar histórico). Ver [[ENTREGA-FINANCAS]] §5. Depois o cache em
> memória virou **persistente em localStorage** (jun/2026) — abrir a página não
> re-roda a Edge Function se o mês já está cacheado; o ↻ rebusca só o mês atual.
> Em set/2026, a fonte por trás da busca por mês trocou de Notion pra
> `lifeos_movimentacoes` (RPCs `lifeos_range`/`lifeos_saldo_abertura` em vez de
> paginação manual do Notion) — o contrato e o comportamento de cache no
> cliente **não mudaram**.

---

## 6. Contrato da API

**Request** — `POST /functions/v1/lifeos-movimentacoes`
Headers: `apikey: <anon>`, `Content-Type: application/json`
```json
{ "token": "<senha mestre>", "ym": "2026-06" }
```

**Response 200**
```json
{
  "ok": true,
  "ym": "2026-06",
  "range": { "min": "2026-06", "max": "2026-06" },
  "saldo_abertura": 0,
  "count": 43,
  "fetched_at": "2026-06-21T19:35:55.571Z",
  "movimentacoes": [
    { "id": "<uuid>", "name": "Mercado", "valor": 84.30, "date": "2026-06-12", "tipo": ["Saida","Crédito"], "created_at": "2026-06-12T14:02:11.000Z" }
  ]
}
```
`range` é `null` se a tabela estiver vazia. `saldo_abertura` = saldo de **caixa**
acumulado de tudo **antes** do dia 1 de `ym` (entradas − saídas que não são
`Crédito`); é o "quanto sobrou/faltou dos meses anteriores", calculado
server-side via RPC `lifeos_saldo_abertura` (o cliente nunca baixa o
histórico). Erros: `401` `{ok:false,error:"unauthorized"}` (token não-master),
`400` (body inválido), `500`/`502` (banco).

`created_at` (adicionado set/2026) existe só pra **desempate de ordenação**
quando duas movimentações caem no mesmo `date` — usado hoje em "Últimas
transações" do hub (`renderFinancasPreview` em `lifeos.js`: ordena por
`date` desc, e por `created_at` desc quando a data empata). **Não usar
`id` pra isso** — `id` é `uuid` (`gen_random_uuid()`), sem ordem
cronológica nenhuma; a query em `handleQuery` já devolve as linhas
ordenadas `order=date.asc,created_at.asc` pelo mesmo motivo (afeta o
cálculo do gráfico de saldo dia a dia, que assume a ordem certa dentro de
cada dia).

**`ym_prev` (opcional, adicionado set/2026)** — funde a busca do mês atual
e do anterior numa chamada só. Motivo: `lifeos.js` (hub) sempre precisava
dos dois meses (o anterior alimenta "Fatura deste mês", ver §3 abaixo) e
fazia **2 chamadas separadas** a esta mesma function só por isso — parte do
trabalho de reduzir o hub de 6 pra 5 requests no boot (ver LIFEOS.md §3.5).
`financas.js` **nunca manda `ym_prev`** — o contrato pra ele fica
IDÊNTICO ao de antes, response sem os campos extras abaixo.

```json
{ "token": "<senha mestre>", "ym": "2026-09", "ym_prev": "2026-08" }
```
Response ganha dois campos a mais: `"ym_prev": "2026-08"` e
`"movimentacoes_prev": [...]` (só as linhas daquele mês, mesmo formato de
`movimentacoes` — **sem** `saldo_abertura`/`range` próprios pra ele, o hub
nunca precisou disso pro mês anterior).

### 6.1 Edição — `action: "update"`

Mesmo endpoint, mesmo gate master; um campo `action` a mais no corpo distingue
leitura (`"query"`, default — todo cliente antigo que nunca manda `action`
continua funcionando) de escrita. Faz `PATCH
/rest/v1/lifeos_movimentacoes?id=eq.<id>` via service role.

**Request**
```json
{ "token": "<senha mestre>", "action": "update", "id": "<uuid>",
  "patch": { "valor": 84.30, "date": "2026-06-12", "tipo": ["Saida", "Crédito"] } }
```
`patch` é **parcial** — cada chave (`valor`, `date`, `tipo`) é opcional e só é
escrita se vier presente; pelo menos uma é obrigatória. Validação server-side:
`valor` número finito ≥ 0 (o sinal é sempre a tag de direção, nunca o número —
ver §7); `date` casa `YYYY-MM-DD`; `tipo` é array não-vazio com **exatamente
uma** das tags `Entrada`/`Saida` e o resto (se houver) dentro de
`Crédito/Débito/Pix/Vale/Boleto` — qualquer coisa fora disso é `400
invalid_tipo`, sem tocar o banco.

**Response 200**
```json
{ "ok": true, "movimentacao": { "id": "<uuid>", "name": "Mercado", "valor": 84.30, "date": "2026-06-12", "tipo": ["Saida","Crédito"] } }
```
Erros: `400` (`missing_id`/`empty_patch`/`invalid_valor`/`invalid_date`/`invalid_tipo`),
`401` (`unauthorized`), `404` (`not_found`, id inexistente), `502` (erro do banco).

### 6.2 Criar — `action: "create"`

Mesmo gate master. Todos os campos são **obrigatórios** (ao contrário do
`patch` parcial do update) — mesma validação de vocabulário/tipo de §6.1.

**Request**
```json
{ "token": "<senha mestre>", "action": "create",
  "movimentacao": { "name": "Mercado", "valor": 84.30, "date": "2026-06-12", "tipo": ["Saida", "Crédito"] } }
```

**Response 200**
```json
{ "ok": true, "movimentacao": { "id": "<uuid>", "name": "Mercado", "valor": 84.30, "date": "2026-06-12", "tipo": ["Saida","Crédito"] } }
```
Erros: `400` (`missing_movimentacao`/`invalid_name`/`invalid_valor`/`invalid_date`/`invalid_tipo`),
`401` (`unauthorized`), `502` (erro do banco).

### 6.3 Excluir — `action: "delete"`

Mesmo gate master. `DELETE /rest/v1/lifeos_movimentacoes?id=eq.<id>`.

**Request**
```json
{ "token": "<senha mestre>", "action": "delete", "id": "<uuid>" }
```

**Response 200**
```json
{ "ok": true, "id": "<uuid>" }
```
Erros: `400` (`missing_id`), `401` (`unauthorized`), `404` (`not_found`), `502`.

### 6.4 Ingestão externa — `lifeos-ingest` (webhook, endpoint separado)

`POST /functions/v1/lifeos-ingest?token=<senha mestre>` — endpoint **distinto**
de `lifeos-movimentacoes`, criado pra a automação externa do autor (que
cadastrava direto em `POST https://api.notion.com/v1/pages`) só precisar
trocar a **URL**, mantendo o payload **exatamente igual** (formato "create
page" do Notion — `properties.Name.title[].text.content`,
`properties.Valor.number`, `properties.Tipo.multi_select[].name`,
`properties.Date.date.start`; `parent`/`icon` são ignorados, aceitos só por
compatibilidade de shape). Auth via **query string** (não no corpo, pra não
alterar o payload já em uso). Mesma validação de vocabulário/tipo de §6.1,
mesmo gate `check_master_token`. Resposta: `{ ok: true, id: "<uuid>" }` ou
`{ ok: false, error: "..." }` (`400`/`401`/`502`, mesmos códigos de erro).

Parsing (schema da tabela `lifeos_movimentacoes`):
`name text` · `valor numeric(12,2)` · `date date` · `tipo text[]`.

---

## 7. Tags reais da tabela `lifeos_movimentacoes`

**Direção:** `Entrada`, `Saida` · **Meio de pagamento:** `Crédito`, `Débito`,
`Pix`, `Vale`, `Boleto`.

- Os valores são **positivos**; o sinal vem da **direção** (Entrada = +, Saida = −).
- Uma movimentação pode ter **múltiplas tags** (ex.: `["Saida","Pix"]`). Sempre
  testar com `includes`, nunca igualdade.
- Saídas **sem** tag de meio são agregadas como **"Sem meio"** (ex.: a "Fatura"
  de cartão costuma cair aqui).
- **Regime de caixa (só o Saldo):** compra no `Crédito` vira fatura futura, então
  **não consome saldo no mês**. O **KPI Saldo e o gráfico de saldo acumulado
  EXCLUEM saídas em `Crédito`** (`isSaidaCaixa` = `Saida` sem `Crédito`; a linha
  "Fatura", `Saida` sem crédito, entra normal). Mas o **KPI Saídas INCLUI** o
  crédito (o dinheiro saiu de fato), assim como **donut, fluxo diário, tabela e
  recorrências**. O **KPI Saldo = `saldo_abertura` + entradas − saídas de caixa**
  (saldo da conta no fim do mês = último ponto do gráfico de acumulado).
  Consequência intencional, sem nota explicativa na UI: `Entradas − Saídas ≠ Saldo`
  na tela (a diferença é o crédito + a abertura).
- ⚠️ Notas/docs antigas falavam em `Essencial/Lazer/Assinatura` — **não existem**
  nesta base. Não inventar categorias.

---

## 8. Segurança (não-negociável)

1. **A fronteira é a Edge Function, não o gate da página.** O gate de senha do
   `financas.html` é só UX; quem achar a URL da function pode chamá-la. Por isso
   a function valida `is_master` **server-side** e rejeita o resto (401).
2. **Gate em `is_master`** (`check_master_token`), não em "token existe". Os
   tokens `sul`/`crias` **não** entram.
3. **A service role key nunca vai ao browser** — vive só nas env vars da Edge
   Function (`SUPABASE_SERVICE_ROLE_KEY`, injetada pela plataforma). É ela
   quem lê/escreve `lifeos_movimentacoes` via REST, sempre a partir do
   servidor.
4. **CORS restrito** a `https://SEU-USUARIO.github.io` em `lifeos-movimentacoes`
   (chamada pelo browser). `lifeos-ingest` **não** define CORS — é um webhook
   chamado por uma automação externa, não por `fetch` de página; a fronteira
   dela é só o `?token=` + `check_master_token`.
5. **`verify_jwt=false` é intencional** nas duas functions (auth via senha
   mestre própria, não via JWT de usuário Supabase).
6. **Escrita:** o mesmo token mestre que lê a tabela também pode **criar,
   alterar e excluir** movimentações (`action: update/create/delete`, §6.1–6.3)
   e a ingestão externa também insere com o mesmo token (§6.4). Não há token
   separado por operação. Consequência consciente (já valia desde a edição,
   set/2026): vazar a senha mestre significa "alguém edita/apaga minhas
   finanças", não só "alguém vê". Validação server-side (tipos, vocabulário de
   tags) reduz corrupção de schema, mas não é uma segunda camada de auth — a
   fronteira continua sendo só o token.
7. **`notion-movimentacoes` fica dormente** (não é mais chamada pelo front) —
   ver §9. O `NOTION_TOKEN` no Vault e a integração do Notion continuam
   existindo, mas fora do caminho de escrita/leitura deste módulo.

---

## 9. Manutenção

- **Testar uma function sem expor a senha real:** insira um token temporário com
  `is_master=true` em `access_tokens`, teste via HTTP, e **delete**:
  ```sql
  insert into access_tokens (token, is_master, label) values ('__tmp__', true, 'tmp');
  -- ... POST na function com token '__tmp__' ...
  delete from access_tokens where token = '__tmp__';
  ```
- **Re-deploy de uma function:** via MCP (`deploy_edge_function`,
  `verify_jwt=false`) ou CLI: `supabase functions deploy lifeos-movimentacoes
  --no-verify-jwt --project-ref SEU-PROJETO-REF` (idem pra
  `lifeos-ingest`).
- **Cache-busting do front:** ao editar `assets/js/financas.js`, bump o `?v=` na
  tag `<script>` do `financas.html`. (financas.js **não** faz parte do conjunto
  manifest/index do `CLAUDE.md`.)
- **`notion-movimentacoes` (dormente, legado):** mantida como rede de
  segurança pós-migração — não recebe chamadas do front. Se um dia for
  removida de vez: apagar a Edge Function, o `NOTION_TOKEN` do Vault e as
  RPCs `get_notion_token`/o uso de `check_master_token` específico dela (a
  RPC em si continua em uso por `lifeos-movimentacoes`/`lifeos-ingest`).
- **Migração do histórico (set/2026):** os dados foram extraídos do Notion
  (`export_all`, ação temporária removida depois de confirmada) e inseridos
  em `lifeos_movimentacoes` via SQL direto. 380 registros migrados; contagem
  conferida por mês contra o Notion antes de trocar o front. O Notion **não**
  foi alterado nesse processo — segue como cópia histórica fora de uso.

---

## 10. O que NÃO foi implementado (opcional, decisão à parte)

- **Categorias de despesa** semânticas (não existem como tags na base).

> A **Fatura projetada / competência de crédito** (antes opcional) já foi
> implementada — ver §1 e o brief `CREDITO-FATURA-PROJECAO.md`. Regra: fatura
> fecha no último dia do mês (compra normal → M+1; compra no último dia → M+2);
> último dia calculado por array `DIAS_NO_MES` + `isBissexto()`.

---

### Anexo — IDs de referência

| Item | Valor |
|---|---|
| Supabase project_id | `SEU-PROJETO-REF` |
| Edge Function (leitura/escrita) | `lifeos-movimentacoes` (`verify_jwt=false`) |
| Edge Function (webhook externo) | `lifeos-ingest` (`verify_jwt=false`) |
| Tabela | `public.lifeos_movimentacoes` |
| RPCs | `check_master_token`, `lifeos_saldo_abertura`, `lifeos_range` |
| Origin CORS (`lifeos-movimentacoes`) | `https://SEU-USUARIO.github.io` |
| Edge Function (dormente, legado) | `notion-movimentacoes` (`verify_jwt=false`) |
| Movimentações database_id (Notion, legado) | `32696234-602e-8037-be9b-fe2cc778202b` |
| Movimentações data_source_id (Notion, legado) | `32696234-602e-806a-835f-000b414de4b5` |
