# NOTAS.md — Módulo Notas do LifeOS (`lifeos/notas.html`)

> Migrado do Notion em **set/2026** — a migração mais complexa do LifeOS até
> aqui, porque diferente de Tarefas/Projetos/Eventos/Manifestações, cada
> Nota carrega o **corpo da página em markdown**, não só propriedades. Lê
> [`LIFEOS.md`](LIFEOS.md) para o padrão do hub e a arquitetura de módulos
> isolados como um todo antes de mexer neste módulo.
>
> **Caminhos:** a página mora em `lifeos/`, o JS continua em `assets/js/`.
> No corpo deste doc `/notas` e `notas.html` são usados como nome curto do
> módulo; a URL real é `…/SEU-REPOSITORIO/lifeos/notas.html`.

---

## 1. O que é

Registros de contexto — referências, análises de leitura, pensamentos,
lembranças, pesquisas. Página própria (`notas.html`), isolada do hub e dos
outros módulos (ver [`LIFEOS.md`](LIFEOS.md) §2), com CRUD completo.

- **Posse dos dados:** migrado do Notion (database "Notas" do workspace
  LifeOS) em set/2026 pra uma tabela própria (`lifeos_notas` +
  `lifeos_notas_projetos`). O Notion **não é mais tocado** por este módulo
  — segue existindo só como cópia histórica dormente.
- **Sem status/kanban.** Ao contrário de Tarefas, uma nota não tem ciclo de
  vida — é só um registro. A view principal é sempre uma **tabela única**,
  filtrável por projeto, tipo e busca por nome.
- **Vínculo a Projeto é N:N de verdade** — diferente de todas as outras
  relations do LifeOS (que são 1:N via coluna `*_id`, ver §6.2). Uma nota
  pode ter 0, 1 ou vários projetos (a base real migrada tem 79 notas com 1
  projeto, 23 com 2, 2 com 3, e 1 nota sem projeto nenhum). Por isso existe
  uma tabela de junção (`lifeos_notas_projetos`), não uma coluna
  `projeto_id`.
- **Conteúdo em markdown livre** (`conteudo_md`, nullable) — renderizado
  via `marked@12.0.2` (mesma versão usada em `tarefas.js`/`lifeos.js` pra
  descrição de tarefa) no modo leitura, com fallback de texto puro escapado
  se o CDN não carregar. Editado via **EasyMDE** num modal próprio,
  separado do de atributos — ver §2.

---

## 2. `notas.html` — módulo Notas (CRUD completo, página própria)

Mesmo motivo de Tarefas ter página própria (ver `LIFEOS.md` §8):
profundidade real (busca, dois filtros, conteúdo longo, CRUD). Isolado dos
outros módulos — cópia própria de gate/boot/cache/`confirmDelete`/
`buildChipOptions`/`renderMarkdown`.

- **Filtros** (topo): `<select id="projeto-select">` (`Todos os projetos`
  default + os projetos existentes, lidos via `lifeos-projetos` — mesmo
  padrão read-only de `tarefas.html`), campo de **busca por nome**
  (`#busca-input`, filtra client-side a cada tecla — com ~105+ registros e
  sem status/kanban pra agrupar, busca textual é o filtro mais útil aqui,
  não existe em `tarefas.html`), chips de **Tipo** (`#tipo-filters`,
  multi-select, mesmo componente `.filters`/`.chip` de `tarefas.js`), e o
  **toggle Cards/Lista** (`.view-tabs`/`.view-tab`, cópia do componente de
  `tarefas.html` — ver `LIFEOS.md` §4). **Default é Cards** (pedido
  explícito do autor, set/2026 — antes só existia tabela); sem persistência
  em localStorage, reseta por sessão (mesmo padrão de `TAR_VIEW` em
  `tarefas.js`).
- **Duas famílias de tag visualmente distintas** (`buildTipoTag()`/
  `buildProjetoTag()`, 3ª rodada set/2026 — pedido explícito do autor: a
  antiga `.tag-proj` genérica dava a entender que "projeto é só mais uma
  tag"). `.tag-tipo`: **ponto colorido** (`--dot-color`, `::before`
  redondo de 6px) + texto neutro `--dim`, sem fundo — cor vem de
  `TIPO_COR`/`TIPO_COR_PALETTE`, 12 hex, **mesma paleta** de
  `NOT_TIPO_COR`/`NOT_TIPO_COR_PALETTE` em `lifeos.js` (cópia isolada
  intencional pra Tipo ter a mesma cor nas duas telas). `.tag-projeto`:
  fundo sólido `--surface-2`, texto neutro, borda igual à de `.tag-tipo` —
  **sem ícone, sem cor, sem borda pesada** (correção da 4ª rodada, set/2026:
  a 1ª tentativa tinha ícone de pasta + borda gold de 2px; o autor cortou os
  dois — "só o fato de ele não estar colorido igual as tags já o
  diferencia"). O texto colorido inteiro (não só um ponto) também foi
  descartado na mesma correção — "vibrante demais" pra uma tela com 12
  cores possíveis por tipo. Usadas em TODO lugar que mostra Tipo/Projeto de
  uma nota: cards, lista, `#detail-modal`, view de leitura, e a lista
  enriquecida do hub (`#not-recent`, ver §3) e do modal de projeto
  (`#pdet-notes`, ver `LIFEOS.md`) — mesmas classes/paleta em todo canto,
  cópia isolada por arquivo (ver `LIFEOS.md` §2).
- **Cards** (`.notas-grid`/`.nota-card`, default): grid **3 colunas fixas**
  (`repeat(3, 1fr)`, pedido explícito do autor — era `auto-fill`, que cabia
  4 nos ~1200px do `.app`), 2 colunas ≤780px, 1 ≤560px — mesmos breakpoints
  de `.manif-grid` no hub. Mesmo peso visual de `.manif-card` (fundo
  `--surface-2`, raio 10px, hover com leve `translateY`), **sem faixa
  colorida no topo** — uma tentativa de "banner" via `border-top: 4px solid`
  colorido pelo tipo dominante foi revertida na 4ª rodada (set/2026, rejeição
  enfática do autor a esse tipo de ornamento em borda de card — "nunca faça
  esse tipo de borda"). **Hierarquia em blocos separados** (nome → linha de
  Tipo → linha de Projeto(s), só se houver → divisor (`.nota-card-divider`)
  → snippet → rodapé) — antes tudo ficava colado numa `.nota-card-tags`
  única misturando os dois tipos de tag. Snippet via `noteSnippet()` (texto
  puro, símbolos de bloco removidos, ~140 chars). **Rodapé** (`.nota-card-foot`,
  `justify-content: space-between`): ícone-botões **Tela cheia**
  (`fa-expand`, abre `#nota-leitura-view` direto) e **Editar** (`fa-pen`,
  abre `#nota-attrs-modal`) do lado esquerdo — lado OPOSTO da data (4ª
  rodada, pedido explícito do autor) — com `data-action`/`stopPropagation`
  pro clique neles não também abrir o detalhe (ver listener de
  `#notas-cards-view`). Clicar no resto do card abre o `#detail-modal`.
- **Lista** (`.notas-table`, view alternativa): colunas Nome, Tipo (tags),
  Projeto(s) (tags — pode ter mais de uma), Data. **Ordenada por `data desc`
  (nulls por último), depois `created_at desc`** como desempate — mesmo
  contrato que a Edge Function devolve
  (`order=data.desc.nullslast,created_at.desc`), o cliente só reordena
  localmente após criar/editar (`sortNotas()`), nunca refaz fetch só por
  isso. **`data` é a data real do conteúdo** (a maioria das notas tem —
  ex.: a data de uma tiragem de tarot, de um relato) e é a mesma lógica de
  ordenação que a database no Notion usava; `created_at` é só quando/como a
  linha entrou no Supabase (pra ~90 notas migradas em lote, todas num
  intervalo de ~1 dia) — nunca deve ser o critério primário, senão a ordem
  fica sem relação nenhuma com a cronologia real das notas. (Correção
  set/2026: uma tentativa intermediária usou só `created_at desc` como
  critério único — revertida no mesmo dia por deixar a ordem "esquisita".)
  Cards e Lista compartilham a mesma ordenação/filtro, só a apresentação
  muda.
- **Detalhe** (`#detail-modal`, "padrão banner" — `.pdet-*`, cópia do
  padrão nascido em `lifeos.html`/commit `8bc5c00`, ver `LIFEOS.md` §3.2 —
  ícone fixo de livro aberto, sem cor dinâmica por tipo já que Tipo é
  multi-select; painel bem mais largo que o padrão banner default,
  `max-width: 860px` — é o modal com mais conteúdo do sistema inteiro,
  precisa de espaço pra ler confortavelmente): título, **data no canto
  superior esquerdo do banner** (`.pdet-date-badge`, simétrico ao
  `.pdet-close` — pedido explícito do autor, "daria um efeito interessante
  ela ali"; não entra mais como tag em `.detail-meta`), tags de Tipo/
  Projeto **em linhas separadas** (`.detail-meta-row`, ver acima),
  **divisória** (`.detail-divider`, 4ª rodada — marca onde os atributos
  terminam e o texto começa) e o markdown renderizado por completo
  (`.nota-content`, tipografia própria pra leitura longa — H1-H4 em serif
  itálico, tabelas, blockquote, `<details>` nativo). **5ª rodada, set/2026
  — pedido explícito do autor: este modal virou SÓ leitura.** Excluir/Editar
  atributos/Editar texto saíram de aqui (moram agora no `#nota-attrs-modal`,
  ver mais abaixo — "deixa tudo bem centralizado" nas palavras do autor); a
  única ação que resta é **Tela cheia** (`openLeituraView`), que virou
  **icon-button ao lado do Fechar** (`.pdet-banner-top-actions`, ambos
  reusando `.pdet-close`) em vez do botão-texto que ficava num rodapé fora
  do scroll (4ª rodada — esse rodapé existiu só uma rodada e foi removido
  de novo por não fazer mais sentido sem os outros três botões).
- **Tela cheia de leitura** (`#nota-leitura-view`, 3ª rodada, set/2026 —
  pedido explícito do autor: "uma tela para leitura, além do modal"). NÃO é
  um arquivo novo — é um **modo de view** dentro da própria `notas.html`,
  ao lado de `'cards'`/`'lista'` (gate/boot/dados já existem em memória
  aqui; um arquivo novo duplicaria tudo isso só pra mostrar uma nota).
  Coluna de prosa centrada, `max-width: 720px`, tipografia maior que o
  modal (`.nota-content-full`, 16px/1.8 vs. 14px/1.7 do modal — a página
  tem a largura inteira pra respirar). Nome grande em serif itálico, tags
  de Tipo/Projeto e data (mesmas classes de tag, sem badge no banner — não
  tem banner aqui). Mantém seus próprios botões Excluir/Editar atributos/
  Editar texto (`.detail-actions`, em fluxo normal no fim da view — nunca
  precisou de rodapé fixo porque a página inteira já rola naturalmente),
  usando `onDeleteClick(btn, closeFn, id)` — generalizada na 5ª rodada,
  set/2026, pra aceitar o id explícito por chamador (`DETAIL_NOTA_ID` aqui,
  `EDIT_NOTA_ID` no `#nota-attrs-modal` abaixo — dois contextos, cada um
  com seu id, nunca os dois visíveis ao mesmo tempo). **Sem botão de voltar
  próprio** (correção da 4ª
  rodada, set/2026 — a 1ª tentativa tinha um `.leitura-back` solto acima
  do cabeçalho, "ficou esquisito" pro o autor): o link `← LifeOS` do topbar
  (`#topbar-back-link`) assume o papel de "← Notas" enquanto a leitura
  está ativa — o texto troca (`#topbar-back-label`) e o clique é
  interceptado (checa se `#nota-leitura-view` está visível na hora do
  clique, sem precisar trocar listener dinamicamente) pra chamar
  `closeLeituraView()` em vez de navegar pra `lifeos.html`. **URL ganha
  `?nota=<id>`** via `history.pushState` —
  permite favoritar/compartilhar o link direto pra uma nota e usar o botão
  Voltar do navegador (`popstate` listener sincroniza a UI de volta pra
  cards/lista ou pra outra nota, sem empilhar histórico duplicado — ver
  `showLeituraView`/`restoreListView`/`openLeituraView`/`closeLeituraView`
  em `notas.js`). Boot com `?nota=` na URL (link direto, favorito,
  compartilhado, ou vindo do hub — ver §3) abre a view direto, sem passar
  pela tela de cards primeiro.
- **Editar/criar atributos** (`#nota-attrs-modal`, `.pdet-panel.attrs-panel`
  — `max-width: 480px`, compacto, é só formulário curto): Nome, Tipo
  (chip-picker **multi**, 12 valores), Projetos (chip-picker **multi** —
  não é um `<select>` single como em `tarefas.js`, já que aqui é N:N de
  verdade). **Só projetos "Em Progresso" aparecem na lista** (decisão
  revertida em set/2026, pedido explícito do autor — "não podemos vincular
  notas a projetos que não estão em progresso"; a versão anterior deste doc
  listava TODOS os projetos, decisão agora invertida), Data (opcional).
  **Nunca tem campo de conteúdo** — isso mora exclusivamente no modal de
  texto abaixo. Exceção ao filtro de status: ao EDITAR uma nota cujo
  projeto não está (ou deixou de estar) Em Progresso, esse projeto ainda
  aparece na lista de chips — senão o(s) chip(s) da seleção atual sumiriam
  e a nota pareceria perder o vínculo no formulário (mesma exceção do
  picker de tarefas.js, ver `buildProjetoChipPicker` em `tarefas.js`,
  adaptada aqui pra múltiplos ids). **Fluxo de criação**: salvar aqui cria
  a nota só com atributos (sem conteúdo) e encadeia direto pra abrir o
  modal de texto com o id recém-criado — escrever o corpo já faz parte do
  fluxo de "criar nota", sem precisar reabrir nada depois.

  **5ª rodada, set/2026 — pedido explícito do autor: "deixar tudo bem
  centralizado".** Este modal ganhou **Excluir** e **Editar texto** no fim
  do formulário (`#nota-attrs-delete`/`#nota-attrs-edit-content`, dentro de
  `.edit-actions` — nunca fixos, sempre em fluxo normal, aparecendo só
  depois de rolar o formulário até o fim; `.edit-btn-danger` já tinha
  `margin-right: auto`, então Excluir cai à esquerda enquanto Editar texto/
  Cancelar/Salvar seguem agrupados à direita). Os dois ficam `hidden` ao
  CRIAR (`EDIT_NOTA_ID` null — excluir/editar o texto de uma nota que ainda
  não existe não faz sentido) e aparecem só ao editar. Motivação: o
  `#detail-modal` de leitura virou somente-leitura nesta mesma rodada (ver
  acima) — em vez de duplicar essas três ações em mais um lugar, elas
  centralizam aqui, único ponto de entrada pra excluir ou pular pro texto a
  partir dos atributos.
- **Editar texto** (`#nota-content-modal`, `.pdet-panel.content-panel` —
  `max-width: 760px`, mais largo que o de atributos porque o editor precisa
  de espaço): só o campo Conteúdo, via **EasyMDE** (`easymde@2.18.0`, CDN
  pinada — mesmo padrão de terceiro via `<script>` que `marked`/`mermaid`/
  `Chart.js` já usam, reskin pra paleta do archive no `<style>` de
  `notas.html`). Substituiu o textarea cru + toggle manual
  Editar/Pré-visualizar que existia antes — notas chegam a ~18KB de
  markdown (ver `conteudo_md` na base migrada), e o editor de verdade
  (toolbar, Pré-visualizar/Lado-a-lado/Tela cheia embutidos) é o que torna
  isso administrável. Vive só enquanto o modal está aberto
  (`initNotaEditor`/`destroyNotaEditor`, mesmo ciclo de vida que instâncias
  Chart.js seguem — destruir antes de recriar); se o CDN falhar, cai pro
  textarea nativo sem quebrar o formulário (mesma postura defensiva de
  `renderMarkdown()` com `window.marked`). Só abre pra nota que já tem id
  (nunca do zero — ver fluxo de criação acima). A leitura (`#detail-modal`)
  continua totalmente separada de qualquer um dos dois modais de edição —
  são 3 modais com responsabilidade única cada: ler, editar atributos,
  editar texto.
- **Cache** (`notas_cache`, localStorage, `CACHE_V=1`): lista única, não
  particionada por projeto como `tarefas_cache` — só ~100 linhas, não vale
  a granularidade extra. `#refresh-btn` força reload completo (Projetos +
  Notas).
- **Gate e boot próprios** — mesmo padrão visual/isolamento das outras
  páginas.

---

## 3. Hub (`lifeos.html`) — `#hero-notas`, só leitura

Padrão default de módulo com página própria (ver `LIFEOS.md` §8): leitura
no hub + link real `<a href="notas.html">`, escrita só na página — mesmo
tratamento que Finanças tem hoje. **Sem botão "Adicionar"** no hub (ao
contrário de Tarefas, que ganhou CRUD completo no hub por pedido explícito
à parte, ver `LIFEOS.md` §1) — não adianto esse escopo aqui sem pedido.

- `.not-bento`, pensado como **mini-versão da própria `notas.html`**, não
  um dashboard de números soltos (2ª rodada, set/2026 — a 1ª tentativa,
  stat-cards dedicados de Total/Sem-projeto, ainda ficava "num card
  gigantesco" sem função real; pedido do autor por algo "mais eficiente").

  **6ª rodada, set/2026 — reestruturação completa, pedido explícito do
  o autor.** Até a 5ª rodada era um grid de 2 cards lado a lado (gráfico +
  lista), com a altura de um sincronizada via JS na altura do outro — só
  cabia ~1 nota sem rolar, "não fazia sentido". Virou **2 linhas**:
  linha 1 é **"Últimas notas" ocupando a largura inteira**
  (`.not-card-recent { grid-column: 1 / -1 }`), alta o bastante pra caber
  ~5 notas sem rolar; linha 2 são **dois cards lado a lado** — "Por tipo"
  (já existia) e **"Por projeto"** (novo). Motivação do autor: "bastante
  visualizações dos dados". Isso também elimina o JS de sincronia de
  altura (`syncNotasCardHeight()`, removida) — histórico completo dos
  bugs que esse mecanismo causou (2 rodadas seguidas de "amontoado") e o
  motivo de ter sido abandonado em favor de CSS puro está no comentário
  grande em `.not-bento` no `lifeos.html`, não duplicado aqui.
  - **Por tipo** (`#not-chart-tipo`) — **gráfico de barras horizontais**
    (Chart.js, mesmo padrão de `renderTipoChart()` em `tarefas.js`, cores
    por categoria via `NOT_TIPO_COR`/`NOT_TIPO_COR_PALETTE`, só tipos com
    contagem > 0). Total e contagem de notas sem projeto viram uma **linha
    de texto compacta** dentro do próprio card (`#not-stats`,
    `.not-stats-line` — "N notas · M sem projeto"), não cards dedicados a
    um número solto.
  - **Por projeto** (`#not-chart-projeto`, novo — 6ª rodada) — mesmo
    gráfico de barras horizontais, agora contando notas por
    `projeto_ids` (top 8 por contagem — mais que isso não cabe legível no
    `.not-chart-wrap`). **Cor única `--gold`** em todas as barras
    (diferente de "Por tipo") — projeto nunca teve mapeamento de cor
    própria no sistema (`.tag-projeto`/`.tag-projeto-mini` são sempre
    neutras, por decisão da 4ª rodada), então o gráfico segue a mesma
    regra. `#not-stats-projeto` mostra "N projetos com notas" (sem
    "sem projeto" aqui — esse número já está na linha de stats de "Por
    tipo" ao lado). `renderNotasBarChart()` (`lifeos.js`) virou uma função
    compartilhada entre os dois gráficos (antes só existia inline pra
    tipo) — mesma config de Chart.js, só dado/cor/unidade mudam.
  - **Últimas notas** (`#not-recent`, `.hub-list-scroll`, linha 1 — mostra
    TODAS as notas filtradas, sem cortar em 6; **`max-height: 420px` fixo
    em CSS** — cabe ~5 notas sem rolar em conteúdo típico, o resto rola
    por dentro do card) — **filtrável por projeto**
    (`#not-projeto-filtro`, reaproveita `.tar-projeto-select`/
    `.tar-kanban-head`, mesmo componente do mini-kanban de Tarefas — select
    real, "Todos os projetos" default, estado `NOT_PROJETO_FILTRO` não
    persiste). O filtro só recorta a LISTA — os dois gráficos na linha 2
    sempre refletem TODAS as notas (mesmo princípio de tarefas.js/
    financas.js: agregados nunca refletem só o subconjunto já filtrado).
    **Agora É clicável** (3ª rodada, set/2026 — pedido explícito do autor;
    era a única exceção "não clicável" nesse padrão, junto de
    `#fin-recent`) — cada linha (`data-detail-kind="nota"`) abre o
    `#detail-modal` em modo leitura via `openDetailModal('nota', obj)`/
    `resolveDetailFromRow` (mesmo dispatcher genérico de evento/tarefa, ver
    acima), com tags de Tipo (`.tag-tipo-mini`, ponto colorido + texto
    neutro) e de Projeto (`.tag-projeto-mini`, fundo sólido, sem ícone —
    mesmo par de classes de `notas.html`, ver §2) e um trecho de conteúdo
    (`noteSnippet()`, cópia local — ver `LIFEOS.md` §2). O modal (só
    leitura — 5ª rodada, set/2026, ver §2) tem **"Tela cheia"** como
    icon-button ao lado do Fechar (`#detail-modal-fullscreen`,
    `.pdet-banner-top-actions`, mesmo tratamento do par em `notas.html`),
    levando pra `notas.html?nota=<id>` (view de leitura em tela cheia — ver
    §2).
- `apiNotasQuery` entra no `Promise.all` de `fetchAllHub()` (6ª fonte,
  depois de Manifestações), cacheada em `lifeos_hub_cache` — `HUB_CACHE_V`
  bump de 1→2 nesta migração (schema do cache mudou: ganhou o campo
  `notas`).
- `.hub-quicknav` ganhou um atalho pra Notas. **6ª rodada, set/2026 —
  pedido explícito do autor:** virou `<button data-jump="hero-notas">`
  (rola até a hero-section, mesmo tratamento de Tarefas/Projetos) em vez
  do link direto `<a href="notas.html">` que existia antes — só **Finanças**
  continua como link de verdade (`<a href="financas.html">`), já que
  Finanças de fato não tem hero-section própria no hub pra rolar até.

---

## 4. Backend

### 4.1 `lifeos_notas` + `lifeos_notas_projetos`

```sql
lifeos_notas: id uuid, name text not null,
  tipo text[] not null default '{}',  -- subset dos 12 valores (ver §5), validado na Edge Function
  data date (nullable),
  conteudo_md text (nullable),        -- markdown livre
  created_at, updated_at

lifeos_notas_projetos: nota_id uuid references lifeos_notas on delete cascade,
  projeto_id uuid references lifeos_projetos on delete cascade,
  primary key (nota_id, projeto_id)
```

RLS habilitado sem policies nas duas (mesmo padrão de todo `lifeos_*`, só
`service_role` acessa). `on delete cascade` dos dois lados da junção:
apagar uma nota limpa seus links; apagar um projeto só remove aquele link
específico — a nota permanece (mesmo espírito de "vínculo opcional" que
`lifeos_eventos.projeto_id on delete set null` tem, adaptado pra tabela de
junção em vez de coluna nullable).

### 4.2 Edge Function `lifeos-notas`

`verify_jwt=false`, gate via RPC `check_master_token`, CORS restrito a
`https://SEU-USUARIO.github.io` — mesmo esqueleto de `lifeos-tarefas`/
`lifeos-projetos`.

- **`query`** (default, sem filtro — só ~100 linhas, o cliente filtra por
  projeto/tipo/busca): 2 SELECTs (`lifeos_notas` + `lifeos_notas_projetos`)
  mesclados em memória na function (`projeto_ids: string[]` por nota) — a
  function não depende de agregação SQL via PostgREST.
- **`create`** — `{ name, tipo[], data?, conteudo_md?, projeto_ids?[] }`.
  `projeto_ids` **opcional** (pode ser `[]`) — diferente de
  `lifeos-tarefas`, que trava `projeto_id` como obrigatório; a base real
  migrada já tem 1 nota sem projeto nenhum, então não faz sentido essa
  trava aqui.
- **`update`** — patch parcial; se `projeto_ids` vier, **substitui** o
  conjunto inteiro de links (delete todos + insere os novos, não faz
  diff).
- **`delete`** — por id; a junção cai sozinha via `on delete cascade`.

**Contrato de resposta** (`query`/`create`/`update` devolvem o mesmo shape
de nota):
```json
{ "id": "<uuid>", "name": "…", "tipo": ["Pensamentos"], "data": "2026-06-05",
  "conteudo_md": "…", "projeto_ids": ["<uuid>", "<uuid>"],
  "created_at": "…", "updated_at": "…" }
```

---

## 5. Vocabulário — Tipo (12 valores reais)

`Lembranças`, `Análise de Leitura`, `Pensamentos`, `Conclusões`, `Úteis`,
`Faculdade`, `Vida`, `Pesquisa`, `Programação`, `Pessoal`, `Relato`,
`Documentação`.

⚠️ O `CLAUDE.md` pessoal (Notion, camada operacional) lista só 9 valores
(faltam `Pessoal`, `Relato`, `Documentação`) — está desatualizado. Este doc
e o código (`TIPOS_VALIDOS` em `lifeos-notas/index.ts`, `TIPOS_NOTA` em
`notas.js`) são a fonte de verdade atual, extraída direto do schema live
da data source Notion no momento da migração.

---

## 6. Migração (Notion → Supabase, set/2026)

Mesmo princípio das migrações anteriores (Tarefas/Projetos, Manifestações
— ver `LIFEOS.md` §6.3/§6.4) — leitura pura, Notion não é alterado — mas
com uma etapa extra: além das propriedades, o **corpo de cada página**
precisou ser extraído e convertido.

- **Fonte:** data source `collection://32696234-602e-80b3-9077-000b5717d6d1`
  (database "Notas" do workspace LifeOS), **105 páginas**.
- **Extração:** via MCP do Notion (`notion-fetch` por página — não uma
  Edge Function nova com a API REST do Notion, ao contrário das migrações
  anteriores) — o corpo de cada página já vem em "Notion-flavored
  Markdown" (formato documentado em `notion://docs/enhanced-markdown-spec`),
  próximo de markdown padrão.
- **Conversão** pra markdown compatível com `marked@12` (sem sanitização —
  HTML5 básico passa direto): `<empty-block/>` removido; atributos de
  bloco (`{color="..."}`) removidos; `<callout>` → blockquote;
  `<table>` (formato XML do Notion) → tabela markdown padrão; `<mention-*>`
  → link `[texto](url)` mantendo a URL externa pro Notion (vínculos
  nota↔nota **não** foram resolvidos pra referência local — decisão
  explícita: só o conteúdo migra por agora); `<span>` de cor/underline →
  texto puro ou `<u>`; `<details>`/headings/listas/citação/código/imagem/
  link — já são markdown padrão, mantidos como estão.
- **Vínculo a Projeto:** mapeado por **nome** (os 18 projetos do Notion
  batem 1:1 por nome com os 18 já migrados em `lifeos_projetos` desde a
  migração de Tarefas/Projetos) — sem precisar de coluna `notion_id`
  temporária como nas migrações anteriores, já que o mapeamento foi
  resolvido manualmente antes de rodar o insert.
- **Conferência:** 105 notas, 131 vínculos em `lifeos_notas_projetos`
  (79×1 + 23×2 + 2×3), 1 nota sem projeto.

---

## 7. O que NÃO foi implementado (decisão consciente)

- **Resolução de vínculos nota↔nota** — os `<mention-page>` internos ficam
  como link externo pro Notion, não pra outra nota local. Fica pra uma
  iteração futura, se o autor pedir.
- **Gráficos/estatísticas dentro de `notas.html`** (linha do tempo, outras
  distribuições) — o hub já tem o breakdown por tipo em gráfico de barras
  (`#not-chart-tipo`, ver §3), mas a página própria em si não carrega
  Chart.js. Pode virar iteração futura.
- **Re-hospedagem de imagens internas do Notion** — nenhuma nota migrada
  tinha imagem com URL de storage interno (que expira ~1h, mesmo problema
  já resolvido pra banners de Manifestações); se aparecer uma no futuro,
  o tratamento seria o mesmo (baixar + subir pro Storage).
