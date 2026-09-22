# LIFEOS.md — LifeOS (`lifeos.html` + módulos)

> Introduzido em **set/2026**, quando a gestão de vida pessoal do autor
> ganhou uma área própria fora do Notion (que continua existindo só como
> fonte de notas). Lê [`FINANCAS.md`](FINANCAS.md) pro módulo Finanças em
> detalhe — este doc é sobre o **padrão do hub** e a arquitetura de módulos
> isolados que o sustenta.

### Onde os arquivos moram

As cinco páginas ficam em **`lifeos/`** desde a reorganização do repo:
`lifeos/lifeos.html`, `lifeos/financas.html`, `lifeos/tarefas.html`,
`lifeos/notas.html` e `lifeos/eventos.html` (dormente). **O JS continua em
`assets/js/`** — `lifeos.js`, `financas.js`, `tarefas.js`, `notas.js`,
`eventos.js` não se moveram.

Ao longo deste doc as páginas são citadas pelo nome curto (`financas.html`,
`tarefas.html`, …) porque não há ambiguidade — existe só uma de cada no
repositório. Onde importa o caminho de verdade:

- dentro de uma página do LifeOS, assets são `../assets/...` e a volta pro
  archive é `../index.html`;
- entre páginas do LifeOS, os links são irmãos (`href="financas.html"`);
- de fora (index, legacy), o caminho é `lifeos/<arquivo>.html`.

---

## 1. O que é

O LifeOS é a área master-only onde vive a gestão de vida do autor:
**Finanças**, **Eventos/Calendário**, **Tarefas** (com sua entidade-mãe,
**Projetos**), **Manifestações** e, desde set/2026, **Notas** são módulos
funcionais — todos já migrados do Notion. A ideia é migrar aos poucos tudo
que hoje vive espalhado no Notion pra tabelas próprias no Supabase, sempre
atrás do mesmo gate mestre — Notas era o último bloco de dados que ainda
dependia do Notion (ver [`NOTAS.md`](NOTAS.md)).

- **`lifeos.html`** é o hub — a tela de pouso após o login master, um
  dashboard denso de insights por área de vida.
- **Três padrões válidos pra um módulo, não um só:**
  - **Página própria e isolada** — quando o módulo tem profundidade
    (filtros, várias views, muitas regras de negócio). **Finanças**
    (`financas.html`/`assets/js/financas.js`), **Tarefas**
    (`tarefas.html`/`assets/js/tarefas.js`) e **Notas**
    (`notas.html`/`assets/js/notas.js`, ver [`NOTAS.md`](NOTAS.md)). O hub
    mostra um resumo/preview e linka pra lá com navegação real de página
    (`<a href="financas.html">`, `<a href="tarefas.html">`,
    `<a href="notas.html">`) pra qualquer ação de escrita.
  - **Nativo do hub** — quando o módulo é simples o bastante pra não
    justificar uma tela própria. Hoje **Eventos/Calendário**: view +
    CRUD completo (criar, ver detalhes, excluir) moram dentro de
    `lifeos.html`/`assets/js/lifeos.js`, no card de Calendário e no modal de
    detalhes do dia. `eventos.html`/`assets/js/eventos.js` (a página própria
    que o módulo tinha antes) ficou **dormente** — sem link nenhum
    apontando pra ela — depois que o autor decidiu que o calendário não
    precisava de tela própria (set/2026). Ver §3.4/§5.
  - **Híbrido: página própria + CRUD completo também no hub** — só
    **Tarefas**. Até set/2026 o hub só tinha leitura + mudança de status via
    drag; **atualizado em set/2026, decisão explícita do autor:** o hub
    ganhou um `#tarefa-modal` próprio (criar/editar) e botões Editar/Excluir
    no `#detail-modal` — agora dá pra criar, editar TODOS os campos (nome,
    status, tipo, projeto, data, descrição) e excluir uma tarefa sem sair de
    `lifeos.html`. `tarefas.html` continua sendo a página completa (kanban
    +lista, filtro por tipo, estatísticas, gráficos, CRUD de Projetos) — o
    hub não tenta replicar nada disso, só o formulário de uma tarefa. Ver
    §3.2 pro detalhe de cada peça:
    - **Mini-kanban** (`#tar-mini-board`): clicar num card abre o
      `#detail-modal` (leitura completa + Editar/Excluir); arrastar um card
      pra outra coluna muda só o status, só em **desktop** (`IS_DESKTOP`,
      feature-detect `(hover:hover) and (pointer:fine)` — em touch os cards
      nem nascem `draggable`), via `apiTarefasUpdate` (mesma function que o
      formulário completo agora usa).
    - **Botão "Adicionar"** (`#add-tarefa-btn`, ao lado de "Abrir" no
      cabeçalho de `#hero-tarefas`) abre o `#tarefa-modal` em modo criar.
    - **`#detail-modal`** ganhou uma coluna de ações (`#detail-modal-actions`,
      só visível pra tarefa — eventos continuam sem editar/excluir aqui):
      "Editar" fecha o detail-modal e abre o `#tarefa-modal` já preenchido;
      "Excluir" usa a mesma confirmação inline de dois cliques
      (`confirmDelete`/`resetDeletePending`, cópia isolada — ver §7) já usada
      pra eventos neste arquivo.
    - Diferente de Finanças, o hub não se limita a um resumo raso — ganha um
      **mini-kanban filtrável por projeto** (select + 3 colunas, com tags de
      tipo e data de entrega no canto inferior direito de cada card) e uma
      **visão geral estatística** (contagem por status).
    - E o card de Calendário do hub ganha um **toggle Eventos/Tarefas** (ver
      §3.4) que troca o que os dots/legenda/linha do tempo/modal do dia
      mostram — tarefas com `data_entrega` aparecem no MESMO mini-calendário
      que os eventos, sem ser uma cópia separada dele.
  - **Nativo do hub, movido de uma página própria** — só **Projetos**.
    **Atualizado em set/2026, decisão explícita do autor:** o CRUD completo
    de Projetos (criar, editar, excluir) que morava em `tarefas.html`
    (`#add-projeto-btn`, `#projeto-modal`) passou inteiro pra `lifeos.js`
    (`#hero-projetos`, ver §3.2) — "pra centralizar essa gestão na tela
    principal do LifeOS". `tarefas.html` continua lendo Projetos
    (`apiProjetosQuery`, popula o `<select>` de projeto ativo e os chips do
    modal de tarefa) mas não escreve mais nenhum campo de Projeto; o estado
    vazio (nenhum projeto ainda) vira um link pra `lifeos.html#hero-projetos`
    em vez de abrir um modal local. Diferente de Eventos (que NUNCA teve
    página própria pro CRUD nativo) e de Tarefas (que GANHOU CRUD no hub sem
    perder nada em `tarefas.html`), Projetos é o primeiro caso de escrita
    REMOVIDA de uma página própria e centralizada só no hub.
- **Um gate, mesma senha.** A senha mestre (`check_master_token`) dá acesso
  a tudo — não há gate por módulo. Cada página com gate próprio (hoje
  `lifeos.html`, `financas.html` e `tarefas.html`) tem seu próprio
  formulário e boot, mas todas leem/gravam a mesma chave de "lembrar" no
  localStorage (`financas_master`), então entrar numa já deixa as outras
  logadas na próxima visita.
- **Módulos não-construídos ficam como hero-section ilustrada ("ghost")**
  no hub, nunca escondidos ou removidos — ver §3.3 (hoje só Manifestações).

---

## 2. Arquitetura: páginas isoladas, sem hub-com-telas-embutidas

**Regra inegociável, corrigida explicitamente pelo autor em set/2026 depois
de uma primeira tentativa errada:** onde houver mais de um arquivo por
área, cada um é isolado — sem imports cruzados, sem uma área lendo
funções/estado de outra, sem misturar código de um módulo dentro do
arquivo de outro. Isso vale tanto entre `lifeos.html`/`financas.js` quanto
dentro do próprio `lifeos.js` (o card de Eventos não deveria, um dia,
"vazar" lógica pro card de Finanças, e vice-versa).

```
lifeos.html + assets/js/lifeos.js       → hub: Finanças (SÓ leitura) + Tarefas (CRUD completo, ver §3.2) + Eventos (CRUD completo, nativo) + Notas (SÓ leitura)
financas.html + assets/js/financas.js   → módulo Finanças, página própria (CRUD completo)
tarefas.html + assets/js/tarefas.js     → módulo Tarefas, página própria (CRUD completo) + Projetos (leitura, CRUD mudou pro hub)
notas.html + assets/js/notas.js         → módulo Notas, página própria (CRUD completo) — ver NOTAS.md
publicar.html + assets/js/publicar.js   → publica entrada nova do archive (ex-admin/index.html) — ver §11
senhas.html + assets/js/senhas.js       → senhas de acesso e escopo por página — ver §11
temas.html + assets/js/temas.js         → paleta do painel (sem gate, sem backend) — ver §12
tags.html + assets/js/tags.js           → vocabulários de todas as tabelas — ver §14
automacao.html + assets/js/automacao.js → webhook de lançamento por celular — ver §15
mcp.html + assets/js/mcp.js             → URL do conector MCP e guia das tools — ver §13
tutorial.html                           → guia do sistema (sem gate, sem JS próprio) — ver §13
eventos.html + assets/js/eventos.js     → DORMENTE — sem link algum apontando pra ela (ver §5)
```

### A exceção declarativa: `assets/js/lifeos-config.js`

A regra acima proíbe compartilhar **comportamento**. `lifeos-config.js` é uma
emenda deliberada, e vale entender a fronteira:

- É **dado declarativo** carregado por `<script>` — apenas seta
  `window.LIFEOS_CONFIG` com URL do Supabase, anon key, dados do repositório
  no GitHub, identidade do masthead e a chave de sessão. Nenhuma função.
- É o mesmo padrão que o archive já usa com `assets/js/manifest.js`: funciona
  em `file://` e em HTTP, sem fetch e sem build step.
- A consequência prática da §2 continua valendo: **cada página LÊ a config e
  monta as próprias constantes locais** (`var FN_BASE = CFG.supabaseUrl + …`).
  Nenhuma página deve expor helper ali pra outra consumir — no dia em que
  alguém puser uma função nesse arquivo, a §2 voltou a ser violada.
- Carregado **sem `?v=`**, como `manifest.js`.

Existe porque o projeto vai virar open-source: é o único arquivo que um fork
precisa editar pra apontar pro próprio backend. Hoje `lifeos.js`, `publicar.js`,
`senhas.js`, `temas.js` e `tema.js` consomem; `financas.js`, `tarefas.js`,
`notas.js` e `eventos.js` ainda têm as constantes chapadas e migram depois.

`assets/js/tema.js` é o segundo arquivo compartilhado, pela mesma lógica: ele
não tem estado nem regra de negócio, só lê a config e troca o `href` de um
`<link>` antes da primeira pintura. Ver §12.

`lifeos.js` não é "só leitura" como um todo — é read-only para Finanças
(resumo + link "Abrir"), e tem CRUD completo tanto pra Eventos (criar via
modal, ver/excluir pelos detalhes do dia) quanto pra Tarefas (criar via
`#tarefa-modal`, editar/excluir pelo `#detail-modal`, status também via
drag-and-drop no mini-kanban — atualizado em set/2026, ver §3.2). Essas são
exceções deliberadas, não inconsistências — ver §3/§3.2/§3.4.

O que **é** compartilhado entre as páginas ativas (`lifeos.html`,
`financas.html`, `tarefas.html`), e como:

- **A mesma senha mestre e o mesmo backend** (`check_master_token`,
  Edge Functions no Supabase) — cada página autentica de forma
  independente contra o mesmo gate, não há sessão compartilhada em memória
  entre páginas.
- **A mesma chave de localStorage** (`financas_master`, guardada só se
  "lembrar" estiver marcado) — histórico do nome (a chave nasceu quando só
  existia Finanças) mantido de propósito para não invalidar sessões já
  lembradas nos navegadores do autor.
- **Padrões de UI repetidos por cópia, não por função compartilhada.** O
  gate visual, o badge "DEV · dados fictícios", o mock determinístico
  (`IS_LOCAL_DEV`), a confirmação de exclusão de dois cliques
  (`confirmDelete`/`resetDeletePending`) — cada arquivo `.js` tem sua
  **própria cópia** dessas funções. Isso é intencional: a alternativa
  (um arquivo `lifeos-shared.js` importado pelas páginas) reintroduziria o
  acoplamento que motivou a separação. Ajustar o comportamento de um
  padrão desses num arquivo não muda o outro — se o ajuste deve valer nos
  dois, precisa ser replicado manualmente.

O que **nunca** deve acontecer: código de Finanças dentro de `lifeos.js`
fazendo escrita (Finanças continua read-only no hub, ponto final), ou
qualquer `<div id="view-hub">`/`<div id="view-financas">` alternando
`hidden` dentro de um único arquivo pra simular páginas separadas. Uma
página própria (quando existir) se navega de verdade (`<a href>`), nunca é
uma tela trocada por JS.

---

## 3. `lifeos.html` — o hub

**Finanças é read-only aqui** — só faz `query`, mostra um resumo raso, e o
botão "Abrir" leva pra `financas.html` pra qualquer ação de escrita.
**Eventos e Tarefas são as exceções**: Eventos tem CRUD completo (criar,
ver, excluir) direto no card de Calendário e no modal de detalhes do dia —
ver §3.4. Tarefas também ganhou CRUD completo (criar, editar, excluir, além
do drag-and-drop de status) no mini-kanban + `#tarefa-modal`/`#detail-modal`
— ver §3.2 — desde set/2026, decisão explícita do autor; o botão "Abrir"
continua levando pra `tarefas.html` pra quem quiser a página completa
(kanban grande, lista, filtros, gráficos, CRUD de Projetos). As três
coisas coexistem no mesmo arquivo por design, não por descuido (ver §2).

### 3.1 Masthead

Inspirado no padrão de capa de página do Notion (banner + ícone sobreposto):
`.hub-banner` (imagem full-width, `assets/images/banner_lifeos.png`, AR
nativo ~1.79:1 — a caixa mantém uma altura compacta por design, então o
`object-fit:cover` recorta uma faixa da ilustração de propósito, como
qualquer capa de banner; `object-position: center top` garante que é
sempre o TOPO da imagem que fica inteiro (o autor prefere perder conteúdo de
baixo, não de cima); um scrim (`::after`, gradiente escuro de baixo para
cima) garante contraste do título por cima, seja qual for o conteúdo da
imagem ali) com `.hub-icon-wrap` (imagem `assets/images/
profile_lifeos.jpeg`, quadrado grande — `clamp(120px, 15vw, 168px)` —
bordas arredondadas, sobreposta ao banner via `margin-top` negativo) +
`<h1>LifeOS</h1>` + subtítulo, seguido de `.hub-quicknav` logo acima do
divisor (`.hub-masthead-rule`) que separa o cabeçalho do resto do conteúdo.
**Sem entrada pra Eventos** — o card de Calendário já é a primeira
hero-section, logo abaixo do quicknav, então um atalho pra rolar até ele
seria redundante; o quicknav tem o link real pra Finanças
(`financas.html` — a única exceção real, Finanças não tem hero-section no
hub pra rolar até), botões que rolam até Tarefas, Projetos e Notas
(`data-jump` — Notas virou `data-jump` na 6ª rodada, set/2026, pedido
explícito do autor; antes era link direto pra `notas.html`, ver `NOTAS.md`
§3), e o botão de Manifestações — que NÃO rola, entra em modo foco (ver
§3.3).

### 3.2 Hero-sections são divisores, não cards — os cards são os `.bento-card`

**Decisão explícita do autor, corrigida depois de uma primeira tentativa
errada onde cada `.hero-section` virou uma caixa com fundo/borda própria
(um "card com vários subcards dentro"):** `.hero-section` **não tem**
fundo, borda nem padding-como-container — é só um agrupador de título +
um conjunto de `.bento-card`s soltos, flutuando direto sobre o fundo da
página (`--bg`). A separação entre uma área e a próxima é o MESMO divisor
duplo do masthead (`.hero-section + .hero-section { border-top: 3px double
var(--text); }`, igual a `.hub-masthead-rule`) — não uma caixa visual, e não
um filete de 1px qualquer, pra manter a mesma assinatura visual do resto do
arquivo. O efeito buscado é "vários cards agrupados sobre o mesmo assunto",
nunca um card contendo outros cards.

`.bento-card` é a unidade visual real (fundo `--surface-2`, raio 12px,
**sem borda** — a mesma regra de "nenhum card tem borda" de todo o sistema,
ver `index.html` `.card`: a separação vem só de contraste de fundo, mais um
leve wash de cor via `.tint-pos`/`.tint-neg` nos cards com semântica
positiva/negativa — nunca uma borda colorida). Cada `.bento-card-label` leva
um ícone pequeno (`fad fa-*`, dourado) antes do texto — parte do "estilizar
mais" pedido pelo autor, os cards não podem ficar genéricos demais. Cada
hero-section é livre pra montar seu próprio grid bento de cards de tamanhos
variados — não um grid uniforme — mas cards que dividem uma LINHA/coluna
entre si (ex.: os dois cards de `#hero-eventos`) precisam ter a MESMA
altura (`align-items: stretch`, o default do grid) — nunca um maior que o
outro por causa da quantidade de conteúdo interno.

Ordem das hero-sections (o `.hub-quicknav` NÃO cobre mais 1:1 cada uma —
ver §3.1, Eventos e Tarefas não têm atalho lá, só Finanças + os botões que
rolam até Manifestações):

- **`#hero-eventos`** (primeiro — o autor confere o calendário com mais
  frequência do que a ordem "alfabética" dos módulos sugeriria; não é
  "menos importante" por vir depois de Finanças em outras partes deste doc).
  `.evt-bento`, 2 cards lado a lado, mesma altura: calendário **navegável,
  com toggle Eventos/Tarefas e CRUD completo de Eventos** (ver §3.4) numa
  coluna, linha do tempo (passados + divisor "hoje" + próximos, também
  alternando por Eventos/Tarefas) na outra. **A lista não corta mais em
  N itens** (era 3 passados + 5 futuros — um 9º item simplesmente não
  aparecia em lugar nenhum, sem scroll pra alcançar); agora todos entram
  no DOM e o card rola internamente pra revelar o resto
  (`#eventos-timeline.hub-list-scroll`: `flex:1; min-height:0;
  overflow-y:auto`, cresce até a altura do card — que já é esticada pra
  bater com o calendário via `align-items:stretch` em `.evt-bento` — e só
  então rola; mesma barra fina discreta do resto do arquivo).
  `.hub-list-scroll` é uma classe própria, **não** aplicada direto em
  `.hub-list` — essa também é usada em `#fin-recent` e no
  `#day-modal-body`, que não devem herdar esse comportamento. Sem link
  "Abrir" — o
  botão no cabeçalho é **"Adicionar"** em modo Eventos (`#add-evento-btn`,
  abre o modal de criação) ou **"Abrir Tarefas"** em modo Tarefas (navega
  pra `tarefas.html` — criar tarefa exige projeto obrigatório, não cabe
  duplicar esse formulário aqui).
- **`#hero-financas`** (`.fin-bento`, grid de 4 colunas, 6 cards):
  - **Saldo · evolução do mês** (2×2, o maior) — número grande + gráfico de
    **linha** (não barra) do saldo acumulado dia a dia, a info que o autor
    mais confere — com **hover funcional** (`interaction: {mode:'index',
    intersect:false}`, mesmo ajuste do gráfico de fluxo de `financas.js`;
    sem isso, com `pointRadius:0`, o tooltip praticamente nunca dispara).
  - **Entradas** / **Saídas** (pequenos, ao lado do saldo, com wash
    verde/vermelho e subtexto de contagem de transações).
  - **Fatura deste mês** / **Fatura projetada** (pequenos, abaixo dos
    anteriores) — "estado do crédito": a fatura que fecha agora (projetada
    a partir do mês anterior, com status pago/restante, colorido verde se
    quitada ou dourado se em aberto) e a próxima fatura projetada (a partir
    das compras em crédito do mês corrente, já com o adiantamento — se
    houver — descontado do "valor atual"). **Cópia INTEGRAL** da lógica de
    `financas.js` — `calcularProjecaoFatura`, `isPagamentoFatura`,
    `isAdiantamentoExplicito`, `splitPagamentosFatura` e a cadeia recursiva
    `carryInto` (com seu próprio cache de meses, `FIN_MONTH_CACHE`/
    `ensureFinMonthRows`, já que o hub só busca `t`/`pt` no boot mas a
    recursão pode precisar de meses mais antigos). **Bug corrigido em
    set/2026:** a primeira versão desses cards usava uma conta direta
    (`MROWS.filter(isPagamentoFatura)` contra o total, sem `split`/
    `carryInto`) que ignorava adiantamento explícito e cadeias de mais de
    um mês — mostrava valores errados sempre que havia excedente/
    adiantamento envolvido. Ver FINANCAS.md pro algoritmo completo; a regra
    de negócio é UMA só, cada arquivo só replica o código (ver §2/§7).
  - **Últimas transações** (largo, full-width, embaixo) — 6 linhas.
  - Link "Abrir" → `financas.html`.
- **`#hero-tarefas`** (`.tar-bento`: 3 cards pequenos de contagem por status
  — Não iniciadas/Em andamento/Feitas, sempre sobre TODAS as tarefas — mais
  um card de kanban full-width abaixo, nunca dividindo linha com outro card,
  ver `.tar-card-kanban { grid-area: kanban }`): cabeçalho com "Adicionar"
  (`#add-tarefa-btn`) e "Abrir" (`<a href="tarefas.html">`) lado a lado.
  **CRUD completo desde set/2026** (decisão explícita do autor — ver §1):
  - **Botão "Adicionar"**: abre `#tarefa-modal` em modo criar — mesmos
    campos de `tarefas.html` (nome, status, tipo, projeto, data de entrega,
    descrição em markdown), projeto pré-selecionado com o filtro ativo do
    kanban (ou o primeiro projeto). **O picker de projeto só lista projetos
    "Em Progresso"** (`buildProjetoChipPicker`, ver §9) — não faz sentido
    vincular uma tarefa nova a um projeto Pausado/Feito/Não Iniciado, e
    mantém a lista de chips enxuta. Exceção: ao EDITAR uma tarefa cujo
    projeto não está (ou deixou de estar) Em Progresso, esse projeto ainda
    aparece na lista — senão o chip da seleção atual sumiria e a tarefa
    pareceria "sem projeto" no formulário.
  - **Card kanban** (`.tar-card-kanban`): um `<select id="tar-projeto-
    select">` (populado de `PROJETOS`, "Todos os projetos" como primeira
    opção/default) no topo, filtrando um **mini-kanban de 3 colunas**
    (`#tar-mini-board`, mesmo vocabulário de status do kanban de verdade —
    ver §4). Cada card mostra o nome, até 2 tags de tipo, a **data de
    entrega** no canto inferior direito (vermelha se vencida e a tarefa não
    está em `Feito`) e o emoji/nome do projeto — **sempre**, mesmo com um
    projeto específico selecionado no filtro (não só em "Todos os
    projetos": filtrar recorta QUAIS tarefas aparecem, nunca esconde de
    qual projeto cada uma é); lista corta em 6 com um "+N" — sem paginação,
    é preview. **Coluna "Feito" ordena pela conclusão mais recente
    primeiro** (`updated_at` desc, devolvido pela Edge Function só pra
    isso) — as outras 2 colunas mantêm a ordem que já vem da API
    (`created_at` asc). Sem isso, com a maioria das tarefas reais já
    concluídas (69 de 75, ver §6.3), a coluna ficava dominada pelas mais
    antigas, escondendo as concluídas recentemente. Trocar o `<select>` só
    re-renderiza o kanban (`renderTarMiniKanban`),
    não refaz fetch (todas as tarefas já vieram no boot via
    `apiTarefasQuery` sem filtro). **Clicar num card** (qualquer
    dispositivo) abre `#detail-modal` — leitura completa da tarefa
    (incluindo descrição renderizada em markdown) **com botões Editar/
    Excluir** (`#detail-modal-actions`, só aparecem pra tarefa, não pra
    evento): Editar fecha o detail-modal e abre `#tarefa-modal` já
    preenchido; Excluir usa a confirmação inline de dois cliques
    (`confirmDelete`, cópia isolada — ver §7).
    **Drag-and-drop entre colunas** (só **desktop**, `IS_DESKTOP` —
    `window.matchMedia('(hover:hover) and (pointer:fine)')`; em touch os
    cards não nascem `draggable`, só continuam clicáveis) muda só o
    `status` via `apiTarefasUpdate`, otimista (aplica na UI no drop, reverte
    se a API falhar); se o calendário estiver em modo Tarefas, o
    dot/legenda daquele dia re-renderiza junto (`renderCalIfTarefasMode`).
  - Link "Abrir" → `tarefas.html` continua valendo pra quem quiser a página
    completa (kanban grande, lista, filtro por tipo, estatísticas,
    gráficos) — o hub só cobre o formulário de uma tarefa por vez.
- **`#hero-projetos`** (logo depois de Tarefas — ver §1): seção
  deliberadamente simples, **um único `.bento-card` full-width com uma
  tabela** (`.proj-table`), não um grid bento de cards variados como as
  outras — é só uma lista de gestão, não um dashboard. Cabeçalho com só o
  botão **"Novo projeto"** (abre `#projeto-modal`, mesmo componente de
  criar/editar; sem "Abrir", não existe mais página própria pra Projetos).
  Logo abaixo do cabeçalho, numa linha própria antes da tabela: um
  **`<select id="proj-status-filter">`** (`.proj-filter-bar`) filtra a
  tabela por status — "Todos os status" + os 4 valores de
  `STATUS_PROJETO`; default **"Em Progresso"** (`PROJ_STATUS_FILTRO`,
  estado de sessão, não persistido — reseta ao deslogar, mesmo padrão de
  `TAR_PROJETO_FILTRO`). Empty-state distingue "nenhum projeto ainda" (zero
  projetos de verdade) de "nenhum projeto com esse status" (filtro sem
  match). Cada linha: **avatar** (emoji do projeto ou 📁 genérico,
  quadrado `.proj-avatar`) + nome (itálico, mesmo peso visual de
  `.hub-cal-label`), **status** (pill com dot colorido —
  `PROJETO_STATUS_COR`, 4 valores incluindo `Pausado` → `var(--blue)`, o
  único status de Projeto sem equivalente em Tarefa), **tags** (chips,
  `.proj-tag`), **progresso** (barra + "`x/y tarefas`", calculado na hora
  sobre `TAREFAS_ALL` filtrado por `projeto_id` — sem fetch extra, já
  carregado no boot) e **ações** (`.row-action-btn` Editar/Excluir, mesmo
  ícone-botão do resto do arquivo). Excluir usa `confirmDelete` (dois
  cliques, ver §7); em caso de `409 has_tarefas` (projeto com tarefa
  vinculada — `on delete restrict`, ver §6.2), a mensagem de erro já vem
  pronta de `apiProjetosDelete` em vez de um "erro 409" genérico. Qualquer
  criação/edição/exclusão chama `refreshProjetoDependents()` — reconstrói o
  picker de projeto do `#evento-modal`, o `<select>` do mini-kanban de
  Tarefas e o próprio mini-kanban, pra nome/emoji nunca ficarem
  desatualizados alhures.
  - **`#projeto-detail-modal`** (aberto ao clicar numa linha da tabela,
    fora de `.row-actions` — `openProjetoDetail(id)`; só leitura, Editar/
    Excluir continuam sendo as ações da linha, não duplicadas aqui). Banner
    com ícone/emoji do projeto sobre gradiente na cor do status
    (`PROJETO_STATUS_COR`). Corpo dividido em dois pares de blocos que se
    alternam via **toggle Tarefas/Notas** no canto superior esquerdo do
    banner (`#pdet-view-toggle`, 3ª rodada set/2026 — pedido explícito do
    o autor: "visão bem centralizada e dinâmica" de tudo que existe no LifeOS
    pra um projeto; reaproveita literalmente `.tar-chart-toggle`/`-btn`, o
    mesmo componente do toggle Eventos/Tarefas do calendário — ver §3.4).
    Estado `PDET_VIEW_MODE` (`'tarefas'` | `'notas'`), reseta pra
    `'tarefas'` a cada `openProjetoDetail()`, trocado via
    `switchPdetViewMode(mode)`:
    - **Modo Tarefas** (default, `#pdet-view-tarefas`): barra de progresso
      + 3 stats por status (`.pdet-stats`) + lista filtrável por status
      (`.pdet-filter`/`renderProjetoDetailTasks()`) — comportamento
      original, sem mudança nesta rodada.
    - **Modo Notas** (`#pdet-view-notas`): filtra `NOTAS_HUB` por
      `projeto_ids.indexOf(PDET_PROJETO_ID) !== -1`
      (`renderProjetoDetailNotas()`), mesma ordenação de `notas.html`
      (`data desc` nulls-last, depois `created_at desc` — comparador cópia
      local). Cada linha (`.pdet-note`) mostra nome, tags de Tipo (`.tag-
      tipo-mini` — ponto colorido + texto neutro, mesma paleta `NOT_TIPO_COR`
      do gráfico do `#hero-notas`, ver `NOTAS.md` §3), trecho de conteúdo
      (`noteSnippet()`) e data. Clicar fecha este modal e abre o
      `#detail-modal` em modo leitura (`openDetailModal('nota', obj)` —
      terceiro branch do mesmo dispatcher genérico que já serve evento/
      tarefa, ver §3.4/§3.2; tags de Tipo/Projeto em linhas separadas,
      divisória, conteúdo completo, sem `--pdet-accent` dinâmico). **5ª
      rodada, set/2026 — pedido explícito do autor:** este modal virou SÓ
      leitura — "Tela cheia" é a única ação, e virou icon-button ao lado do
      Fechar (`.pdet-banner-top-actions`, ambos reusando `.pdet-close`) em
      vez do botão-texto que ficava num rodapé (`.detail-modal-foot`) —
      esse rodapé agora serve exclusivamente tarefa (Editar/Excluir); pra
      nota e evento fica sempre `hidden`. Leva pra `notas.html?nota=<id>`,
      ver `NOTAS.md` §2 — nunca dois modais abertos ao mesmo tempo.
- **`#hero-manifestacoes`** (última hero-section — ver §3.3): grid de
  `.manif-card` (`.manif-grid`, **3 colunas fixas no desktop**
  `repeat(3, 1fr)` — era `auto-fill`/`minmax(220px, 1fr)`, que cabia 4
  cards apertados nos ~1080px do `.app`; o autor preferiu cards maiores, 3
  por linha, banner mais alto (190px, era 140px) acompanhando; 2 colunas
  ≤780px, 1 coluna ≤560px, mesmos breakpoints do resto do arquivo), não o
  bento de tamanhos variados das outras seções — é uma listagem, cada card
  com o mesmo peso visual. Cabeçalho com ícone + título + botão **"Nova
  manifestação"** (`#add-manifestacao-btn`, abre `#manifestacao-modal` —
  ver §3.3).

### 3.3 Manifestações — migrada do Notion, com modo foco e CREATE

**Migrada do Notion em set/2026** (7 entradas — ver §6.4 pro detalhe da
migração). **Atualizado em set/2026, decisão explícita do autor:** ganhou
CREATE direto pelo hub (`#manifestacao-modal`) — continua **sem editar/
excluir** (mesmo princípio de "não adiantar escopo além do pedido" que
Tarefas e Projetos seguiram antes de ganharem CRUD completo, ver §1/§9).

- **`#manifestacao-modal`**: nome (obrigatório), status (chips,
  `STATUS_MANIFESTACAO` — 3 valores, mesmo texto de `TAR_STATUS`, sem
  `Pausado`), tags (chips multi-select, `TAGS_MANIFESTACAO` — vocabulário
  PRÓPRIO, `Vida|Financeiro|Carreira|Saúde|Lazer`, nada a ver com
  `TAGS_PROJETO`) e **banner** (opcional). Upload de banner: botão
  estilizado (`.banner-upload-btn`) sobre um `<input type="file"
  accept="image/*" hidden>` — nunca sobe direto pro Storage a partir do
  browser (mesma postura de segurança do resto do LifeOS: toda escrita
  passa pela senha mestre no corpo da requisição, nunca client-side direto
  com a anon key, ao contrário do padrão mais antigo de `gallery.js`/
  `galeria.html`, que NÃO deve ser copiado aqui). Fluxo: `FileReader.
  readAsDataURL` lê o arquivo local, `readFileAsBase64` extrai só o
  payload base64 (depois da vírgula do `data:...;base64,`), e
  `apiManifestacoesCreate` manda `banner_base64`/`banner_content_type`
  junto do payload — o servidor (`lifeos-manifestacoes`/`handleCreate`)
  insere a linha primeiro (pra ter o `id`), sobe o arquivo pro bucket
  `manifestacoes` usando esse id como nome, e faz um PATCH setando
  `banner_url`; se o upload falhar, a linha fica criada mesmo assim (sem
  banner) — **create nunca falha por causa da imagem**. Limite de 5MB no
  client (`MANIFESTACAO_BANNER_MAX_BYTES`) e 6MB de base64 no servidor
  (`MAX_BASE64_LEN`, ~4.5MB de arquivo original — a folga cobre o overhead
  de ~33% do base64). Preview da imagem escolhida (`.banner-preview-wrap`)
  com botão de remover antes de salvar. Sem arquivo escolhido, a
  manifestação nasce com `banner_url: null` e o card usa o banner padrão
  animado (ver abaixo).

- **Card** (`.manif-card`): banner no topo, edge-to-edge (`.manif-banner`,
  140px) — imagem real (`banner_url`, re-hospedada no Storage durante a
  migração, ver §6.4) ou, quando a entrada não tem imagem própria, um
  **banner padrão estilizado** (`.manif-banner-default`): glow cônico
  rotativo (`conic-gradient` + `@keyframes manifSpin`, 9s) atrás de um
  ícone `fa-sparkles` pulsante (`@keyframes manifPulse`, 3.6s) — as duas
  animações são desligadas com `prefers-reduced-motion: reduce`. Corpo do
  card: nome (serif itálico), status (`.proj-status-pill`/`.proj-status-dot`
  — **reaproveitados de Projetos**, mesmo vocabulário visual, sem duplicar
  CSS) e tags (`.proj-tag`, idem).
- **Vocabulário**: `status` é `Não Iniciado`/`Em Progresso`/`Feito` (mesmo
  texto do Notion original — sem `Pausado`, que é só de Projeto); `tags` é
  subset de `Vida`/`Financeiro`/`Carreira`/`Saúde`/`Lazer` (também herdado
  do Notion, campo se chamava `tag` lá, singular).
- **Diferencial: modo foco** (`toggleManifFocus`, `MANIF_FOCUS`) — o botão
  "Manifestações" do `.hub-quicknav` (`#quicknav-manifestacoes`) NÃO rola a
  página como os outros atalhos (não tem `data-jump`, fica de fora do loop
  genérico): ele chama `toggleManifFocus()`, que adiciona
  `.is-manif-focus` no `#app`. Essa classe oculta (`display:none`) TODAS as
  outras `.hero-section` via `.app.is-manif-focus .hero-section:not(#hero-
  manifestacoes)` — como Manifestações já É a última seção no DOM, sumir
  com as outras faz ela "subir" sozinha pro topo do conteúdo, logo abaixo
  do masthead (onde normalmente fica o Calendário), **sem reordenar nada**.
  Clicar de novo no mesmo atalho sai do modo foco (`toggleManifFocus` é um
  toggle simples). Clicar em QUALQUER outro atalho do quicknav
  (`data-jump`) chama `exitManifFocusIfActive()` antes de rolar — senão a
  seção alvo continuaria escondida pela regra acima. **Bug corrigido na
  hora**: `.hero-section + .hero-section` (a borda dupla entre seções, ver
  §3.2) não liga pra `display:none` do irmão anterior — o seletor de irmão
  adjacente conta posição no DOM, não visibilidade — então Manifestações em
  modo foco ficava com uma borda extra logo abaixo de `.hub-masthead-rule`
  (ela É precedida por outra `.hero-section`, só que oculta). Fix:
  `.app.is-manif-focus #hero-manifestacoes { border-top: none; }`.
- **`.hub-quicknav` agora tem 5 itens**: Finanças (link real, única
  exceção), Tarefas (`data-jump`), Projetos (`data-jump`), Notas
  (`data-jump`, virou isso na 6ª rodada — antes era link direto, ver
  `NOTAS.md` §3) e Manifestações (`#quicknav-manifestacoes`, comportamento
  próprio acima) — ver §3.1.

### 3.4 O calendário do hub: navegação + CRUD de Eventos + toggle Tarefas

Decisão do autor (set/2026, revertendo uma etapa intermediária onde o
calendário navegava no hub mas só criava/excluía em `/eventos`): **o
calendário não precisa de tela de detalhe separada** — "a ideia é quase
sempre conseguir usar só a dashboard do LifeOS". Todo o ciclo de vida de um
evento mora em `lifeos.js`; quando Tarefas chegou, em vez de ganhar uma
grade separada, passou a **compartilhar essa MESMA grade** via um toggle —
exatamente a previsão que já estava aqui antes de Tarefas existir.

- **Navegação de mês**: `renderMiniCal()` usa estado próprio (`HUB_CAL_YM`,
  `goHubCalMonth(delta)`, `ensureHubCalMonth(ym)` — busca sob demanda e
  cacheia por mês; só relevante pra Eventos — Tarefas não pagina por mês,
  `TAREFAS_ALL` já tem tudo desde o boot).
- **Toggle Eventos/Tarefas** (`#cal-mode-toggle`, estado `CAL_MODE`): troca
  o que é EXIBIDO — dots do mini-calendário, legenda (`renderLegend`,
  reconstrói a cada troca, não monta mais uma vez só), linha do tempo
  (`renderEventosTimeline` — nome ficou de eventos por histórico, mas serve
  os dois modos agora) e o conteúdo do `#day-modal`. Em modo tarefas, os
  dots/linha do tempo usam `data_entrega` (não `date`) e a cor vem de
  `TAR_STATUS_COR` (não `EVENTO_COR`). **Nunca troca o que é possível
  ESCREVER NESTA VIEW específica**: eventos continuam com CRUD completo
  aqui (dots/`#day-modal`); tarefas continuam só visíveis nesta mesma view
  (dots/linha do tempo/`#day-modal`), mesmo o mini-kanban de `#hero-tarefas`
  tendo ganhado CRUD completo (ver §1/§3.2) — o CRUD de tarefas vive só no
  card de kanban/`#tarefa-modal`, nunca dentro do calendário.
- **Botão "Adicionar" também muda com o toggle** (`setCalMode`/
  `onAddClick`): em modo eventos abre `#evento-modal` (comportamento
  original); em modo tarefas vira um link disfarçado de botão — "Abrir
  Tarefas", navega pra `tarefas.html` — porque criar tarefa exige projeto
  obrigatório (ver §4) e não cabe duplicar esse formulário (com seletor de
  projeto e tudo) só pra essa tela.
- **Criar evento**: botão "Adicionar" (modo eventos) abre `#evento-modal`
  (nome/data/tipo/projeto opcional — ver §6.1). Ao salvar, navega
  `HUB_CAL_YM` pro mês do evento criado.
- **Ver + excluir (modo eventos) / só ver (modo tarefas)**: clicar numa
  célula do mini-calendário abre `#day-modal` (`openDayModal(dateStr)`).
  Em modo eventos, cada linha tem um botão de excluir
  (`.row-action-btn.row-action-danger`, sempre visível, não hover-only —
  dentro de um modal já focado, hover não ajuda e não existe em touch) com
  a confirmação inline de dois cliques (`confirmDelete`/
  `resetDeletePending`, cópia própria — ver §2/§7); excluir re-renderiza o
  modal no lugar (sem fechar). Em modo tarefas, a lista é só leitura (nome +
  projeto + tag de status), sem botão nenhum.
- **"Hoje" no mini-calendário**: wash dourado translúcido
  (`rgba(196,145,58,0.30)`, texto `var(--gold)`), não um bloco sólido
  `var(--gold)` com texto escuro por cima — o contraste ficava alto demais
  ("amarelão"), especialmente ao lado dos pontinhos de tipo/status.

`#tar-chart-toggle` (visão geral de Tarefas, §3.2) e `#cal-mode-toggle`
reaproveitam a MESMA classe CSS (`.tar-chart-toggle`/`.tar-chart-toggle-btn`)
— o nome ficou de Tarefas por ter sido o primeiro a existir, mas o
componente é genérico (pill de 2 botões, um ativo por vez); cada um tem seu
próprio listener JS escutando só dentro do seu container, sem colisão.

### 3.5 Boot e cache local (set/2026)

**Atualizado em set/2026** (decisão explícita do autor, mesmo motivo que
gerou o botão ↻ de Finanças meses antes: o hub tinha crescido pra **5
fontes de dados independentes** — Finanças, Eventos, Projetos, Tarefas,
Manifestações — e cada boot/reload disparava as 5 buscas de novo, mesmo
quando nada tinha mudado desde a última visita).

- **`fetchAllHub()`** (era `loadPreview()`) faz a busca fresca de tudo:
  Finanças do mês corrente **e anterior** **numa chamada só** (`apiFinQuery(
  pw, t, pt)` — ver §6.2-fin abaixo; o mês anterior alimenta o card "Fatura
  deste mês"), uma janela de Eventos (mês anterior até +2,
  `apiEventosQuery` — cobre navegação do calendário sem re-fetch imediato),
  TODOS os Projetos, TODAS as Tarefas (sem filtro) e TODAS as
  Manifestações. Só roda quando não há cache válido, ou via ↻.
- **Cache persistente** (`lifeos_hub_cache` no `localStorage`, versionado
  em `HUB_CACHE_V`) — mesmo princípio de `financas_cache` em `financas.js`
  (ver FINANCAS.md §6): o boot NÃO dispara as 5 buscas se já existe cache
  válido, entra direto do que foi salvo na última visita, **sem tocar rede
  nenhuma**. Sem TTL por tempo — "confiável até você mandar atualizar".
  Diferente de Finanças (cache por MÊS, atemporal — "junho não muda de
  nome"), aqui são 5 fontes independentes, e duas são sensíveis a "hoje"
  mudar entre visitas:
  - **Finanças**: `cache.fin.ym` guarda o mês de quando foi salvo; se o mês
    civil já virou desde então, os dados cacheados serviriam pro mês
    ERRADO como "atual" — `hydrateFromHubCache()` detecta isso
    (`cache.fin.ym !== todayYM()`) e busca fresco só essa parte, sem tocar
    Eventos/Projetos/Tarefas/Manifestações.
  - **Eventos**: a janela buscada (mês anterior a +2) é relativa a "hoje"
    no momento do fetch original. `topUpEventosWindow()` roda em TODO
    boot com cache (não só quando o mês vira) e garante que os 4 meses da
    janela ATUAL estão cobertos, via `ensureHubCalMonth` (que já era
    idempotente — só busca o que falta, geralmente zero requests).
  - **Projetos, Tarefas, Manifestações**: nunca re-buscam sozinhas ao
    hidratar — mesmo princípio "eterno até ↻/escrita" de Finanças.
- **Toda escrita persiste na hora** — cada `create`/`update`/`delete` bem
  sucedido (Eventos, Tarefas — inclusive drag-and-drop de status —,
  Projetos, Manifestações) chama `writeHubCache()` depois de mutar o array
  em memória, então um reload logo depois de editar já reflete a mudança
  sem precisar re-buscar nada.
- **`#hub-refresh-btn`** (↻, ao lado do botão de sair na topbar, com
  `#hub-fetched-at` mostrando "sincronizado —" — mesmo par visual de
  `#refresh-btn`/`#fetched-at` em financas.html) força `fetchAllHub()`
  completo e sobrescreve o cache. Diferente do ↻ de Finanças (que só
  invalida o MÊS em tela), aqui refaz as 5 fontes de uma vez — são poucas,
  e o evento é raro o bastante pra não valer a granularidade extra.
- **Logout limpa o cache** (`dropHubCache()`) — mesmo padrão de Finanças.
- **Limitação aceita, não resolvida**: o cache é local ao browser/aba: uma
  escrita feita em outra aba, outro dispositivo, ou em `tarefas.html`
  (Tarefas/Projetos têm cache PRÓPRIO lá, ver §4) só aparece aqui depois de
  um ↻ manual ou logout+login. Isso é o mesmo trade-off que Finanças já
  tinha aceitado — app de uso pessoal single-user, não vale a complexidade
  de sincronização cross-aba/cross-página.

---

## 4. `tarefas.html` — módulo Tarefas (CRUD completo, página própria)

Migrado do Notion em set/2026 (18 projetos, 71 tarefas — ver §6.3 pros
números exatos da migração). **Projetos é a entidade-mãe**: toda tarefa é
**obrigatoriamente** vinculada a um projeto (`lifeos_tarefas.projeto_id
not null`); eventos têm um vínculo **opcional** ao mesmo projeto (ver §3.4
e §6.1) — essa assimetria é proposital, não um descuido.

- **Seletor de projeto** (`<select id="projeto-select">`, real, não chips —
  trocado de chips de scroll horizontal em set/2026 porque trocar de
  projeto é a ação mais comum da página, merece um controle nativo e
  previsível): primeira opção é **"Todos os projetos"** (`value=""`) —
  busca TODAS as tarefas sem filtro de `projeto_id` (mesmo contrato que
  `lifeos.js` usa pro mini-kanban do hub, ver §6.2), estatísticas e gráfico
  agregam tudo, e kanban/lista passam a mostrar o rótulo do projeto em cada
  tarefa (`.tar-item-proj`) já que ficam misturadas. Projeto ativo lembrado
  em `localStorage['tarefas_active_projeto']` (chave própria desta página,
  ao contrário de `financas_master` que é compartilhada) — `''` salvo
  explicitamente (Todos) é distinguido de "nunca salvou" (`localStorage`
  devolve `null`) pra não perder essa preferência entre visitas.
  **Atualizado em set/2026:** esta página só LÊ Projetos agora
  (`apiProjetosQuery`, popula o `<select>` e os chips do modal de tarefa) —
  criar/editar/excluir projeto foi removido daqui e mora só em
  `lifeos.html#hero-projetos` (ver §1/§3.2, decisão explícita do autor); o
  estado vazio (`#projeto-empty`, nenhum projeto ainda) mostra um link
  `<a href="lifeos.html#hero-projetos">`, não mais um botão que abre modal
  local.
- **Toggle Kanban/Lista** (`.view-tabs`, mesma linha do select de projeto,
  alturas iguais — 48px fixo nos dois pra não desalinhar por causa da
  diferença de métrica entre `<select>` e `<button>`): alterna entre o
  kanban (ver abaixo) e uma tabela (`.tar-table`, ordenada por data de
  entrega) com as mesmas tarefas. Um filtro por Tipo (`#tipo-filters`,
  chips — só aparece se o projeto tiver tarefas com tipo) vale pras duas
  views.
- **Kanban** (`.kanban-board`): **3 colunas fixas** — `Não Iniciado`,
  `Em Andamento`, `Feito` — nessa ordem, com fundo colorido por status
  (cinza/dourado/verde translúcido, mesmo mapeamento do mini-kanban do hub
  — ver §3.2) e SEMPRE a mesma altura entre si (`align-items:stretch` no
  board), mesmo com uma coluna vazia. O Notion original tinha 7 valores de
  status (`Não Iniciado`, `Deploy`, `Em Progresso`, `Em Testes`, `Entregar`,
  `Pausado`, `Feito`); o autor pediu explicitamente **3 colunas simples**,
  então a migração colapsou os 4 intermediários em `Em Andamento` e
  `Pausado` em `Feito` (nenhuma tarefa real usava `Pausado` — só apareceu
  `Feito`/`Em Progresso` nos dados originais, ver §6.3). Cada card mostra
  nome + o emoji/nome do projeto (**sempre**, mesmo com "Todos os
  projetos" fora de vista — igual ao mini-kanban do hub, ver §3.2) + até 2
  tags de tipo + data de entrega (vermelha se vencida e a tarefa não está
  em `Feito`). **Coluna "Feito" ordena por conclusão mais recente
  primeiro** (`updated_at` desc — mesma lógica e mesmo motivo do
  mini-kanban do hub, ver §3.2). Clicar num card abre o modal de detalhe
  (editar nome/status/tipo/data, excluir — dois cliques, `confirmDelete`
  próprio). **Drag-and-drop entre colunas** (só **desktop** — `IS_DESKTOP`,
  `(hover:hover) and (pointer:fine)`; em touch os cards não nascem
  `draggable`, só continuam clicáveis) muda o `status` via
  `apiTarefasUpdate`, otimista (aplica na UI no drop, reverte se a API
  falhar) — segunda forma de mudar status, além do modal. Botão "+" no
  topbar (`#add-tarefa-btn`) cria uma tarefa nova (projeto pré-preenchido
  com o ativo, mas trocável). **Picker de projeto só lista "Em Progresso"**
  — mesma regra e mesma exceção pra edição do mini-kanban do hub, ver §3.2.
- **Estatísticas + gráficos** (abaixo do kanban/lista, separados por
  `.section-divider`): contagem por status, % concluído (barra de
  progresso) e tarefas atrasadas — sempre sobre TODAS as tarefas do
  projeto/seleção ativa, ignora o filtro de tipo (mesmo princípio dos KPIs
  de Finanças). Dois cards Chart.js lado a lado (`.tar-charts-grid`, mesmo
  padrão de `.charts` em financas.html — empilha em mobile), **sem toggle**
  (dois gráficos permanentes, não um só alternando): **Por status**
  (`#tar-chart-status`, doughnut — 3 categorias fixas, pizza funciona bem
  aqui; cores batem com `TAR_STATUS_COR`/o mini-kanban do hub, em hex
  literal já que Chart.js não lê `var(--x)`) e **Por tipo**
  (`#tar-chart-tipo`, **barras horizontais** — até 9 categorias possíveis,
  pizza ficaria ilegível com fatia miúda demais; `indexAxis:'y'` evita
  rótulo de tipo truncado/rotacionado no eixo; cores vêm de uma paleta fixa
  de 9 cores).
- **Descrição (markdown)**: campo `descricao` (nullable, coluna adicionada
  set/2026 — ver §6.2), conteúdo livre em markdown além do nome. O modal de
  tarefa (`#tarefa-modal` aqui e em `lifeos.js`) tem um textarea com toggle
  "Editar"/"Pré-visualizar" (mesmo chip-picker genérico de status/tipo,
  `buildChipOptions('tarefa-descricao-mode', MD_MODES)`) que renderiza via
  `window.marked` (CDN `marked@12.0.2`, carregado antes de `tarefas.js`/
  `lifeos.js`); sem `marked` disponível, cai num fallback de texto puro
  escapado (`renderMarkdown`, nunca quebra a tela). A mesma renderização
  aparece read-only no `#detail-modal` do hub quando a tarefa tem descrição.
- **Emoji de projeto**: sobre 18 projetos migrados do Notion, só 6 tinham
  um emoji Unicode real no ícone da página (o resto era imagem enviada ou
  ícone da biblioteca do Notion, que não é um emoji de verdade) — a
  migração gravou `NULL` nesses casos em vez de inventar um; o autor
  completa manualmente pelo formulário quando quiser. `emoji: null` cai
  num fallback visual (📁) no select e nos rótulos de projeto.
- **Gate e boot próprios** — mesmo padrão visual/isolamento das outras
  páginas (ver §2).
- **Cache local por projeto** (`tarefas_cache` no `localStorage`, próprio
  desta página — não é o mesmo `lifeos_hub_cache` de `lifeos.html`, cada
  arquivo tem o seu, ver §2/§3.5). **Adicionado em set/2026**, mesmo motivo
  do cache do hub. Diferente de Finanças (cache por MÊS) e do hub (cache
  por FONTE), aqui é **cache por `projeto_id`** — `TAREFAS_CACHE[id] =
  tarefas[]`, com `''` representando "Todos os projetos". Trocar de projeto
  no `<select>` é cache-first: `loadTarefas()` só chama `apiTarefasQuery`
  se aquele `projeto_id` nunca foi carregado nesta sessão/cache; senão
  troca a view na hora, sem rede. `PROJETOS` também é cacheado (lido só uma
  vez por sessão de cache, não por projeto).
  - **Invalidação em escrita**: criar/editar/excluir uma tarefa, ou arrastar
    um card pra outra coluna (drag-and-drop de status), invalida a entrada
    `''` ("Todos os projetos", que precisa refletir qualquer tarefa de
    qualquer projeto) e a entrada do projeto ENVOLVIDO — se a EDIÇÃO trocar
    o projeto vinculado da tarefa, invalida os dois lados (o antigo, de
    onde ela "sai", e o novo, pra onde ela "vai"), capturando o
    `projeto_id` de antes do submit pra isso. A entrada do projeto
    ATIVO (`ACTIVE_PROJETO_ID`) é sincronizada direto (`TAREFAS.slice()`);
    as demais só são invalidadas (removidas do cache), buscando fresco
    quando forem selecionadas de novo — não tenta manter todo cache em
    sincronia ativa, mais simples e menos propenso a bug.
  - **`#refresh-btn`** (↻, ao lado do botão de nova tarefa) só re-busca
    `PROJETOS` + o projeto ATIVO — mesmo espírito granular do ↻ de
    Finanças (só o que está em tela); os demais projetos ficam cacheados e
    se auto-atualizam na próxima vez que forem selecionados.
  - **Limitação aceita**: uma escrita feita em `lifeos.html` (Projetos
    ganhou CRUD lá, ver §1/§3.2) não invalida o cache de `tarefas.html`
    automaticamente — só aparece aqui depois de um ↻ ou logout+login.
    Mesmo trade-off aceito no cache do hub (ver §3.5).

---

## 5. `eventos.html` — DORMENTE (mantida, sem link nenhum apontando pra ela)

Era a página própria do módulo Eventos (CRUD completo, isolado) até o autor
decidir (set/2026) que o calendário não precisava de tela de detalhe — ver
§3.4. O arquivo (`eventos.html` + `assets/js/eventos.js`) **continua
existindo no repositório**, mesmo padrão de rede a rede sensivelmente igual
ao que passou a viver em `lifeos.js`, mas **nada no site linka pra ela**:
saiu do `.hub-quicknav` e o card de Calendário não tem mais link "Abrir".
Mesma postura já usada com `notion-movimentacoes` depois da migração pro
Supabase (ver `FINANCAS.md` §9) — mantida como rede de segurança / histórico,
não apagada, mas dormente. Se um dia for removida de vez, isso é decisão
explícita do autor, não algo a inferir.

Não reviva essa página adicionando link de volta sem confirmar com o autor —
a decisão de centralizar tudo em `lifeos.html` foi deliberada.

---

## 6. Backend: Eventos, Projetos e Tarefas

### 6.1 `lifeos_eventos`

Falado por `lifeos.html` (query + create + delete — `eventos.html` está
dormente, ver §5).

- **Tabela `public.lifeos_eventos`**: `id uuid`, `name text`, `date date`,
  `tipo text` (`check` em `faculdade|psicodelia|trabalho|lazer|vida`),
  **`projeto_id uuid` (nullable, `references lifeos_projetos on delete set
  null`)** — vínculo **opcional**, adicionado quando Tarefas/Projetos
  entrou (ver §4). RLS habilitado sem policies (mesmo padrão de
  `lifeos_movimentacoes`).
- **Edge Function `lifeos-eventos`** (`verify_jwt=false`, mesmo gate
  `check_master_token`): ações `query` (`{ token, from, to }` → eventos no
  range de datas, cada um já com `projeto_id`), `create` (`{ token,
  action:"create", evento:{name,date,tipo,projeto_id?} }`), `delete`
  (`{ token, action:"delete", id }`). Sem `update` nesta entrega.

### 6.2 `lifeos_projetos` e `lifeos_tarefas`

**Atualizado em set/2026 — os dois lados inverteram desde a versão anterior
deste doc:**
- **Tarefas**: CRUD completo em AMBOS os arquivos — `tarefas.html` (página
  própria) e `lifeos.js` (`#tarefa-modal`/`#detail-modal` + drag-and-drop de
  status no mini-kanban — ver §3.2/§1).
- **Projetos**: CRUD completo só em `lifeos.js` (`#projeto-modal`, ver
  §3.2) — `tarefas.html` passou a ser **read-only** (`apiProjetosQuery`,
  sem `action`), depois de ter sido a única a escrever até essa mudança.

```sql
lifeos_projetos: id uuid, name text, emoji text (nullable),
  status text check ('Não Iniciado'|'Em Progresso'|'Feito'|'Pausado'),
  tags text[] (subset de Pessoal|Profissional|Acadêmico|Configuração),
  created_at, updated_at

lifeos_tarefas: id uuid, name text,
  status text check ('Não Iniciado'|'Em Andamento'|'Feito'),  -- ver §4
  tipo text[] (subset de Vida|Organização|Documentação|Estudo|Avaliação|
               Código|Freelance|Trabalho|Tarefa),
  projeto_id uuid NOT NULL references lifeos_projetos on delete restrict,
  data_entrega date (nullable),
  descricao text (nullable), -- markdown livre, ver §4; coluna adicionada set/2026
  created_at, updated_at
```

`on delete restrict` em `lifeos_tarefas.projeto_id` — não deixa apagar um
projeto com tarefa pendurada, obriga decisão explícita (mover/excluir as
tarefas primeiro). Compare com `lifeos_eventos.projeto_id`, que é
`on delete set null` (opcional — apagar o projeto só desvincula o evento).

- **Edge Function `lifeos-projetos`**: `query` (lista todos, sem filtro),
  `create`/`update` (`{name,emoji?,status,tags}` / patch parcial),
  `delete` (responde `409 has_tarefas` se houver `on delete restrict`
  travando — `apiProjetosDelete` em `lifeos.js` lê o corpo da resposta
  mesmo em erro pra pegar esse código e mostrar uma mensagem específica,
  não só "erro 409"). **`create`/`update`/`delete` só são chamados por
  `lifeos.js`** desde set/2026 (`tarefas.html` virou read-only pra
  Projetos, ver acima) — inverso de `lifeos-tarefas` logo abaixo.
- **Edge Function `lifeos-tarefas`**: `query` (`{projeto_id?}` — com filtro
  lista as tarefas de UM projeto pro kanban de `tarefas.html`; sem filtro
  lista TODAS, é o que `lifeos.js` usa pro mini-kanban/estatística do hub),
  `create` (`{name,status,tipo,projeto_id,data_entrega?,descricao?}` —
  `projeto_id` obrigatório, valida 400 `missing_projeto_id` se faltar),
  `update` (patch parcial — qualquer subconjunto de
  `name/status/tipo/projeto_id/data_entrega/descricao`), `delete`.
  **Atualizado em set/2026:** `create`/`update`/`delete` agora são chamados
  por AMBOS os arquivos com o payload completo — `tarefas.html` pro modal
  de edição e pro drag-and-drop do kanban de verdade (`{status}`);
  `lifeos.js` pro `#tarefa-modal` (criar/editar todos os campos), pro
  Excluir do `#detail-modal`, e pro drag-and-drop do mini-kanban do hub
  (`{status}`, desktop-only) — ver §3.2. Antes dessa data, `lifeos.js` só
  chamava `update` com `{status}`; a restrição foi removida por decisão
  explícita do autor (ver §1/§9).

### 6.3 Migração (Notion → Supabase, set/2026)

Mesmo processo já usado pra Movimentações (ver `FINANCAS.md` §9): busca
via Notion API, insere em lote com uma coluna `notion_id` temporária pra
resolver a relation Tarefas→Projetos (join por `notion_id`, depois
`alter table ... drop column notion_id` — schema final não carrega
origem). Conferência: 18 projetos, 71 tarefas, 0 tarefas órfãs (toda linha
migrada tinha a relation Projetos preenchida no Notion). Notion não foi
alterado — leitura pura, segue existindo como histórico.

### 6.4 `lifeos_manifestacoes` — migração set/2026

```sql
lifeos_manifestacoes: id uuid, name text,
  status text check ('Não Iniciado'|'Em Progresso'|'Feito'),
  tags text[] (subset de Vida|Financeiro|Carreira|Saúde|Lazer),
  banner_url text (nullable — null = front usa o banner padrão, ver §3.3),
  descricao text (nullable — coluna já criada, sem UI pra editar ainda),
  created_at, updated_at
```

- **Edge Function `lifeos-manifestacoes`**: `query` (lista todos, sem
  filtro) e, **desde set/2026**, `create` — mesmo `check_master_token`,
  mesmo `verify_jwt=false` dos outros módulos. `update`/`delete` ainda não
  existem, não adiantados (ver §1/§9). `create` recebe
  `{name,status,tags}` obrigatórios + `banner_base64`/
  `banner_content_type` OPCIONAIS (ver §3.3 pro fluxo completo do client);
  insere a linha primeiro, depois — só se veio banner — sobe pro Storage e
  faz um segundo `PATCH` setando `banner_url` (`handleCreate`, upload
  best-effort: erro de imagem não desfaz a linha já criada). Limite
  server-side de 6MB de string base64 (`MAX_BASE64_LEN`, ~4.5MB de
  arquivo original) — resposta `400 banner_too_large` se ultrapassar.
- **Bucket `manifestacoes`** (Storage, público) — hospeda os banners.
  Path de cada arquivo é o **id da linha em `lifeos_manifestacoes`** +
  extensão detectada do `content-type` (`{id}.jpg`/`.png`/`.webp`/`.gif`) —
  mesmo esquema pras imagens migradas do Notion (§6.4 abaixo, path era o
  id da PÁGINA do Notion nesse caso específico, único ponto onde os dois
  fluxos de upload divergem) e pras criadas via `#manifestacao-modal`
  (path é o id da linha recém-inserida no Postgres). URL pública:
  `{SUPABASE_URL}/storage/v1/object/public/manifestacoes/{path}`.
- **Migração (única, via `notion-manifestacoes-migrate`, dormente após
  rodar)**: a database Manifestações no Notion tinha `Name` (title),
  `Status` (status: 3 opções, texto idêntico ao usado aqui), `tag`
  (multi_select: 5 opções) e um **cover de página** (não é uma property,
  é campo nativo da página no Notion) com 3 formas possíveis:
  1. `cover.type === "file"` — imagem hospedada no próprio Notion, URL
     assinada da S3 que **expira em ~1h**. Precisa ser baixada e
     re-hospedada NA HORA da migração — não dá pra guardar a URL direto.
  2. `cover.type === "external"` apontando pra
     `app.notion.com/images/page-cover/*` — é um dos covers **padrão da
     galeria do Notion** (o usuário nunca fez upload de nada ali). Tratado
     como "sem banner real" — `banner_url` fica `null` de propósito, front
     usa o banner default estilizado (ver §3.3). Detectado só pelo prefixo
     da URL.
  3. `cover.type === "external"` com qualquer outra URL — link de verdade
     que o usuário colou; seria baixado e re-hospedado igual ao caso 1 (não
     apareceu nenhum caso desse nos 7 registros reais, mas o código cobre).
  Das 7 entradas migradas, 5 tinham imagem real (caso 1) e 2 eram cover
  padrão do Notion (caso 2, `banner_url = null`). Nenhuma tinha conteúdo no
  corpo da página (blocks vazios) — por isso `descricao` nasceu vazia em
  todas; a coluna existe pro o autor preencher depois, quando a UI de editar
  existir.
  **Acesso ao Notion**: a integração usada (`LifeOS Connection`, mesmo
  `NOTION_TOKEN` no Vault que `notion-movimentacoes` já usava — ver
  FINANCAS.md §9) só tinha a database de Movimentações compartilhada; a de
  Manifestações precisou ser conectada manualmente na Notion (`···` →
  `Connections` → adicionar `LifeOS Connection`) antes da migração rodar.
  `notion-explore` foi criada só pra essa investigação (buscar a database,
  ler o schema, checar o cover de amostras) — fica dormente também, mesma
  postura de `notion-movimentacoes` (rede de segurança, não apagada).

---

## 7. Ação de excluir (`confirmDelete`) — padrão repetido, não compartilhado

Cada arquivo com exclusão (`financas.js`, `tarefas.js`, `eventos.js` —
dormente, ver §5 — e `lifeos.js`, pro CRUD de Eventos) tem sua **própria**
cópia de `confirmDelete(btn, key, run, onDone)` + `resetDeletePending()`:
em `financas.js`/`eventos.js`/`tarefas.js` o botão só aparece no hover da
linha (ou é um botão de ação dedicado no modal de detalhe, caso de
Tarefas); em `lifeos.js` ele fica sempre visível (dentro de um modal, não
faz sentido hover-only — ver §3.4). Fora essa diferença de gatilho, o
miolo é idêntico: primeiro clique vira "confirmar?" por ~3s; segundo
clique dentro da janela chama `run()` (a chamada de API) e, no sucesso,
`onDone()` (atualiza o array em memória + re-renderiza). Um módulo novo
com exclusão deve **copiar** esse padrão pro seu próprio arquivo, não
importar de outro (ver §2).

---

## 8. Como plugar um módulo novo

1. **Tabela:** criar `public.lifeos_<modulo>` no Supabase, prefixo
   `lifeos_` (convenção — não é regra de código, é legibilidade). RLS
   habilitado, sem policies (só `service_role` acessa).
2. **Edge Function:** uma function própria (`lifeos-<modulo>`), mesmo gate
   `check_master_token`, mesmo `verify_jwt=false`. Não reaproveitar
   `lifeos-movimentacoes`/`lifeos-eventos`/`lifeos-tarefas`/`lifeos-projetos`
   pra outro domínio de dado — cada módulo tem sua function.
3. **Escolher o padrão certo (ver §1):**
   - **Página própria** (várias views, filtros, muita regra de negócio, OU
     depende de uma entidade relacionada própria — Finanças, Tarefas):
     `<modulo>.html` + `assets/js/<modulo>.js`, isolada (ver §2),
     gate/boot/dev-mock/render próprios. Hub troca o ghost preview (§3.3)
     por uma hero-section densa com link real `<a href="<modulo>.html">` —
     a leitura fica em `lifeos.js` (read-only), a escrita fica só na
     página. O preview no hub pode ser tão rico quanto fizer sentido (ver
     Tarefas: mini-kanban + gráfico), não precisa ser um resumo raso.
   - **Nativo do hub** (módulo simples, ou que compartilha uma view com
     outro já existente — Eventos, e agora Tarefas via o toggle do
     calendário): view + CRUD direto em `lifeos.js`/`lifeos.html`, sem
     página própria PRA AQUELA PARTE específica. Nesse caso `lifeos.js`
     deixa de ser read-only só pro que é nativo (Eventos) — módulos com
     página própria (Finanças, Tarefas) continuam read-only no hub mesmo
     que compartilhem alguma view visual (o calendário) com um módulo
     nativo.
4. **Cache-busting:** bump o `?v=` do JS que mudou — ver `FINANCAS.md` §9
   pro mecanismo.

---

## 9. O que NÃO fazer

- **Não checar `EDIT_*_ID`/`ACTIVE_*_ID` DEPOIS de chamar `close*Modal()`
  no `.then()` de um submit** — bug real, corrigido em set/2026 em três
  lugares (`onProjetoSubmit`/`onTarefaSubmit` em `lifeos.js`,
  `onTarefaSubmit` em `tarefas.js`): todo `close*Modal()` zera o id de
  edição (`EDIT_TAREFA_ID = null`, etc. — é assim que o modal "esquece"
  qual registro estava editando). Chamar `closeModal()` e só DEPOIS checar
  `if (EDIT_TAREFA_ID)` sempre lê `null`, então o código sempre cai no
  ramo de "criar" (`push`) mesmo numa edição — a linha antiga fica no
  array E uma "nova" com o MESMO id é empurrada, duplicando a linha na UI
  até o próximo boot (que busca a lista do zero e não repete o bug). Fix:
  guardar o id numa variável local (`var wasEditing = EDIT_TAREFA_ID;`)
  **antes** de chamar `close*Modal()`, e checar essa variável depois. Um
  módulo novo com modal de criar/editar deve seguir esse padrão desde o
  início.
- **Não misturar código de dois módulos no mesmo arquivo** — foi o erro
  que motivou esta arquitetura (Eventos/calendário chegaram a ser
  construídos dentro de `financas.html`/`financas.js` antes de serem
  isolados). Um módulo com página própria é seu próprio par HTML+JS; um
  módulo nativo do hub fica dentro de `lifeos.js`, mas separado por seção
  (ex.: código de Eventos não deveria se misturar com o de Finanças ou
  Tarefas dentro do próprio `lifeos.js`).
- Não fazer `financas.html`/`tarefas.html` (ou uma futura página própria
  de outro módulo) embutir a tela de outro módulo via `hidden`/tabs —
  navegação entre página própria e hub é sempre `<a href>` real, nunca
  troca de painel em JS.
- Não dar a cada página seu próprio gate/senha — a senha mestre já cobre
  tudo (mesma chave de "lembrar" no localStorage).
- Não deixar um módulo sem dado como hero-section vazia de texto — usar um
  ghost preview ilustrado (ver §3.3), mesmo sem nenhuma tabela por trás.
- Não extrair `confirmDelete`/gate/mock pra um arquivo `shared.js`
  importado pelas páginas — replicar por cópia (ver §2 e §7) é a decisão
  deliberada, não uma lacuna a preencher depois.
- Não misturar dados de módulos diferentes na mesma tabela — cada módulo
  tem sua tabela `lifeos_<modulo>` própria, mesmo que pequena (Eventos e
  Tarefas dividem a VIEW de calendário dentro de `lifeos.js`, não a tabela
  nem o arquivo — ver §6.1/§6.2, são tabelas totalmente separadas).
- **Tarefas tem CRUD completo em `lifeos.js` desde set/2026** (decisão
  explícita do autor — revoga a restrição anterior deste doc, que só
  permitia mudar `status` via drag-and-drop): criar (`#tarefa-modal`),
  editar TODOS os campos (mesmo modal, reaberto a partir do "Editar" do
  `#detail-modal`) e excluir (botão no `#detail-modal`) já são válidos ali,
  além do drag-and-drop de status no mini-kanban — ver §3.2/§6.2. O que
  continua valendo: não duplicar essas telas de novo dentro de
  `tarefas.html` (a página própria não precisa saber que o hub também
  escreve — mesmo endpoint, mesmo contrato) e, mesmo com o toggle do
  calendário mostrando tarefas, aquela view específica (dots/legenda/linha
  do tempo/modal do dia) continua só leitura (ver §3.4) — o CRUD vive só no
  card de kanban/`#tarefa-modal`, não no calendário.
- Não reviver `eventos.html` (adicionar link de volta pra ela) sem decisão
  explícita do autor — ver §5.

---

## 10. Status dos módulos

| Módulo | Status | Onde vive | Tabela(s) | Edge Function(s) |
|---|---|---|---|---|
| Finanças | ✅ Funcional, página própria | `financas.html` | `lifeos_movimentacoes` | `lifeos-movimentacoes` + `lifeos-ingest` |
| Eventos / Calendário | ✅ Funcional, nativo do hub (CRUD completo) | `lifeos.html` (`eventos.html` dormente, ver §5) | `lifeos_eventos` | `lifeos-eventos` |
| Tarefas | ✅ Funcional, página própria + CRUD completo também no hub (ver §3.2) | `tarefas.html` E `lifeos.html` | `lifeos_tarefas` | `lifeos-tarefas` |
| Projetos | ✅ Funcional, CRUD só no hub (leitura em `tarefas.html`, ver §1/§3.2) | `lifeos.html` (`tarefas.html` só lê) | `lifeos_projetos` | `lifeos-projetos` |
| Manifestações | ✅ Funcional, nativo do hub (leitura + CREATE, modo foco — ver §3.3) | `lifeos.html` | `lifeos_manifestacoes` | `lifeos-manifestacoes` |
| Notas | ✅ Funcional, página própria (CRUD completo) | `notas.html` | `lifeos_notas` + `lifeos_notas_projetos` | `lifeos-notas` |

Ver [`FINANCAS.md`](FINANCAS.md) pra tudo sobre o módulo Finanças (contrato
da API, regras de negócio, segurança) e [`NOTAS.md`](NOTAS.md) pra tudo
sobre o módulo Notas.

---

## 11. Telas de configuração (`publicar.html`, `senhas.html`)

Set/2026. O painel `admin/index.html` — que vivia num link no rodapé do
`index.html` e do `legacy.html` — foi desmembrado em duas páginas dentro do
LifeOS, alcançadas pelo **drawer de configuração** do hub.

### O drawer

O `#logout-btn` da topbar do hub virou `#menu-btn` (`fad fa-bars`) e abre um
`<aside id="config-drawer">` que desliza da direita. O "Sair" desceu pra dentro
dele. A topbar tem espaço pra um botão só, e ele rende mais como menu.

- Só existe **no hub**. `financas.html`, `tarefas.html` e `notas.html`
  continuam com o botão de sair direto na topbar.
- Os itens de config são `<a href>` de verdade — páginas próprias, nunca telas
  trocadas por JS (§2). O único `<button>` é o Sair.
- `z-index: 1100`, acima dos modais (1000), pra nunca abrir por baixo de um
  modal esquecido aberto. O ESC checa o drawer **antes** dos modais.
- Fechado com `visibility: hidden` (não `[hidden]`, que é `display:none` e
  mataria a transição do `transform`).

### `publicar.html` — publicar entrada do archive

Porte direto de `admin/index.html`. Mantém intactos o drop de arquivo, a
derivação do slug a partir do nome, o `injectScripts` (`share-guard.js` sempre,
`gate.js` se marcada como restrita) e o commit atômico pela Git Data API.

Três diferenças em relação ao admin antigo:

1. **Gate** — usa o gate mestre do LifeOS, não o formulário próprio que chamava
   `check_page_access(token, 'admin')`. Não é senha nova: `check_page_access`
   libera qualquer token com `is_master = true` independente da página, ou seja,
   a senha do admin **sempre foi** a senha mestre.
2. **`GH_OWNER`/`GH_REPO`** vêm de `lifeos-config.js`.
3. **Faz o cache-busting**, que o admin não fazia. Era um furo real: a entrada
   ia pro manifest mas `meta.version` e o `?v=` do `index.html` ficavam parados,
   então quem tinha o manifest velho em cache não via a entrada nova por até
   10 minutos. O publish agora gera `YYYYMMDD-HHMM`, grava em `meta.version`
   nos dois manifests e reescreve o `?v=` das tags de `manifest.js` e
   `redact.js` no `index.html` — tudo no mesmo commit (4 blobs em vez de 3).

Também recusa publicar um slug que já existe no manifest, e avisa quando o
`theme` colado não existe ou quando falta `volume`.

> O PAT do GitHub continua sendo entregue ao browser depois do gate — ver a nota
> de segurança em [`AUTH.md`](AUTH.md).

### `senhas.html` — senhas e escopo

O que antes exigia SQL no painel do Supabase. Gerencia duas coisas distintas:

| | Tabela | O que é |
|---|---|---|
| **Senha** | `access_tokens` | O valor digitado no gate. `is_master = true` abre o LifeOS inteiro e qualquer página protegida |
| **Escopo** | `token_pages` | Quais páginas do archive uma senha **não-mestre** abre. Mestre não usa escopo |

Backend: Edge Function **`lifeos-senhas`**, não RPCs novas. A tabela de
autenticação não ganha superfície de escrita no `anon` — foi exatamente esse
desenho (RPC `SECURITY DEFINER` exposta ao `anon`) que causou o vazamento do
`github_pat` registrado no `AUTH.md`.

Guardrails aplicados **server-side**, não só na UI:

- Não apaga nem rebaixa a última senha com `is_master = true` (`last_master`)
- Não apaga a senha usada na própria requisição (`self_delete`)
- Recusa senha vazia ou duplicada; marca com badge as menores que 12 caracteres
- Concessão de escopo a uma senha mestre é recusada (`master_no_scope`) — não
  faria nada e só poluiria a lista

O valor da senha **nunca volta do servidor** — a function devolve só uma versão
mascarada. Não há "revelar senha": esqueceu, troca. A lista de páginas do modal
de concessão vem do `manifest.js`, que é a única fonte que conhece os slugs; ela
não sabe quais páginas carregam `gate.js`, então é uma lista de candidatas.

`admin/index.html` virou um stub que redireciona pra `publicar.html`.

---

## 12. Temas (`temas.html`) e modo local

### Temas do painel

Set/2026. Antes disso a paleta do LifeOS era um bloco `SYSTEM SKIN` colado à
mão no fim do `<style>` de cada página — trocar de paleta exigia editar cinco
arquivos. Agora a paleta vem de um `.css` em `assets/css/themes/` — nove temas, cada um
em duas versões (ver "Dois escopos" abaixo):
`sepia` (padrão), `noite`, `carvao`, `floresta`, `ardosia`, `vinho`, `indigo`,
`cobre` e `abismo`. Todos escuros: os overlays e sombras das páginas
(`rgba(6,8,11,0.78)`, `box-shadow` pretos) estão chapados fora dos tokens, então
um tema claro exige tokenizá-los antes.

**Como a troca funciona** — a ordem no `<head>` é o mecanismo inteiro:

```html
  </style>                                  ← o SYSTEM SKIN termina aqui
  <link rel="stylesheet" id="lifeos-tema" href="../assets/css/themes/lifeos/sepia.css">
  <script src="../assets/js/lifeos-config.js"></script>
  <script src="../assets/js/tema.js"></script>
</head>
```

1. O `<link>` vem **depois** do `<style>`. Os dois declaram os mesmos tokens em
   `:root`, mesma especificidade — vence o último. Por isso o `<link>` é
   estático no HTML, na posição certa; `tema.js` só troca o `href` dele.
2. `tema.js` roda **durante o parse do `<head>`**, antes de qualquer pintura.
   A troca acontece com a página ainda invisível, então não há flash. (Criar o
   `<link>` por JS depois — num `DOMContentLoaded` — pintaria com a paleta
   padrão e viraria de cor na cara do usuário.)

O `href` estático é o padrão da instância, então a página funciona sem JS e o
caso comum não gasta uma requisição extra.

**Precedência:** `localStorage['lifeos_tema']` → `LIFEOS_CONFIG.tema` → `sepia`.

**Sem backend e sem gate.** A escolha é por navegador e não há dado a proteger.
Isso também faz `temas.html` funcionar igual em produção, em localhost e em
`file://`.

**Três registros precisam concordar** ao adicionar um tema — e a divergência é
silenciosa em dois deles:

| Onde | O quê | Se faltar |
|---|---|---|
| `assets/css/themes/lifeos/<slug>.css` | o arquivo | 404, página fica na paleta embutida |
| `VALIDOS` em `assets/js/tema.js` | lista branca | o tema nunca é aplicado |
| `TEMAS` em `assets/js/temas.js` | vitrine + cores da miniatura | o tema não aparece na tela |

A lista branca existe porque o valor vem do `localStorage`, que o usuário
controla: sem ela, um valor arbitrário viraria um caminho arbitrário no `href`.

**Todo tema precisa definir o conjunto inteiro de tokens.** Um token faltando
não cai num padrão — herda o do `SYSTEM SKIN` da página, e a mistura de duas
paletas fica pior que qualquer uma das duas.

### Dois escopos: painel e capa

Cada tema tem **dois arquivos com o mesmo nome**:

| Pasta | Paleta | Tokens | Usado por |
|---|---|---|---|
| `assets/css/themes/lifeos/` | escura | `--text`, `--border`, `--surface`, `--dim`, `--mute` | as 10 páginas de `lifeos/` |
| `assets/css/themes/blog/` | clara | `--ink`, `--rule`, `--bg-card`, `--ink-dim`, `--ink-mute`, `--scrim` | `index.html`, `legacy.html`, `galeria.html` |

Os nomes de token são diferentes porque as duas áreas sempre tiveram paletas
independentes — não é duplicação acidental, e por isso não dá para um arquivo
só servir aos dois.

Claro na capa e escuro no painel é decisão de conteúdo, não limitação: o
arquivo é um objeto de papel e o painel é um instrumento. O mesmo ouro que
brilha sobre `#14120f` fica ilegível sobre `#f5f2ec`, então o acento de cada
tema é escurecido na versão clara.

`tema.js` serve aos dois **sem saber de qual se trata**: `hrefDe()` troca só o
nome do arquivo no `href` e preserva a pasta. A chave de localStorage é a
mesma, então a escolha do tema é uma só e vale no sistema inteiro.

**As 27 entradas em `pages/` ficam de fora**, por decisão explícita: cada uma
tem paleta própria, e é isso que o `VISUAL.md` chama de "nenhuma página deve
parecer genérica".

### Cores derivadas do token, não chapadas

Set/2026. Havia 52 valores `rgba()` do dourado, verde, vermelho e azul
chapados nas páginas do LifeOS. O sintoma reportado foi a borda das tags de
meio de pagamento (`.tag-credito` e irmãs) ficando dourada em todos os temas:
a cor do texto era `var(--gold)` e seguia o tema, mas a borda era
`rgba(196,145,58,0.32)` e não.

Todas viraram `color-mix(in srgb, var(--token) N%, transparent)`, preservando
a opacidade exata de cada uma. O que **não** foi tocado são as definições dos
próprios tokens (`--gold-wash: rgba(...)`), que são literais por tema e devem
continuar assim.

**Ao escrever CSS novo nas páginas do LifeOS, nunca chape a cor de um token.**
Se precisar de uma variação com transparência, derive com `color-mix`.

### A paleta dos cards do archive fica de fora

A seção "Cards do archive" da tela é **só referência**. O campo `theme` do
manifest não é um tema visual: escolhe apenas a cor da barra lateral do card no
index. O mapa está chapado em quatro lugares (`index.html`, `assets/js/index.js`,
`publicar.js` e `temas.js`) e mudar uma cor exige commit em todos. Unificar isso
mexe no render do index, que é a capa pública — trabalho separado.

### A armadilha do `[hidden]`

Toda página do LifeOS precisa desta linha no `<style>`:

```css
[hidden] { display: none !important; }
```

Sem ela, `el.hidden = true` **não esconde nada** em qualquer elemento cuja classe
declare `display`: o atributo `[hidden]` vale por uma regra do user-agent, e
qualquer `display` declarado pelo autor vence. Como `.gate`, `.modal` e
`.loading-ov` todas declaram `display: flex`, o efeito é:

- o gate nunca some → a página trava em "verificando sessão…"
- o `#loading` nasce visível e nunca sai → spinner de tela cheia permanente

Foi exatamente o que aconteceu com `publicar.html` e `senhas.html` quando
nasceram sem a linha (set/2026): as duas caíram em "loading infinito" por
motivos diferentes, mesma causa. As quatro páginas antigas já tinham a regra —
ela é fácil de perder ao copiar só o CSS do gate.

### Modo local (`IS_LOCAL_DEV`)

As Edge Functions restringem CORS ao origin do GitHub Pages, então de
`file://` ou `localhost` o browser recusa a resposta antes do JS ver qualquer
coisa. Em vez de afrouxar o CORS em produção — que é a fronteira de verdade —
cada página roda contra dados fictícios em memória, o mesmo padrão que
`financas.js`/`tarefas.js`/`notas.js` já usavam.

```js
var IS_LOCAL_DEV = (location.protocol === 'file:') ||
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
```

Em modo local a página **pula o gate** (não há backend contra o que validar),
mostra uma tarja `DEV` no topo e serve tudo dos mocks.

| Página | O que o mock cobre |
|---|---|
| `senhas.html` | 4 senhas fictícias e o CRUD inteiro, **incluindo os guardrails** (`last_master`, `self_delete`, `duplicate_token`) |
| `publicar.html` | PAT fictício e um publish que percorre os 5 passos e imprime o mesmo log **sem tocar na API do GitHub** |
| `temas.html` | nada a mockar — não usa rede |

Os mocks de `senhas.html` reproduzem os guardrails de propósito: sem isso,
testar localmente validaria só o caminho feliz e esconderia justamente os
estados que dão trabalho de acertar na UI.

Em `publicar.html` o mock resolve um segundo problema além do CORS — o publish
real escreve no repositório, e testar a tela contra a API do GitHub criaria
commits de lixo no `main` a cada tentativa.

---

## 13. `mcp.html`, `tutorial.html` e a aba de Token

Set/2026. Três telas que fecham a promessa de "configurável a partir de si
mesmo": depois delas, nada de configuração exige SQL no painel do Supabase.

### Aba **Token do GitHub** (dentro de `publicar.html`)

`publicar.html` passou a ter duas abas: *Publicar página* e *Token do GitHub*.

**Isto não contraria a §2.** A regra proíbe simular páginas separadas trocando
`hidden` por JS. Aqui não são duas páginas — são dois painéis do **mesmo
assunto**, e o segundo existe justamente porque o primeiro não funciona sem
ele. Uma página própria para "o token que a tela ao lado consome" separaria o
que o usuário lê junto.

A aba mostra o estado do token (mascarado, data), permite cadastrar, substituir
e remover, e traz o passo a passo de geração no GitHub — incluindo a orientação
de escopar em **um** repositório e só a permissão **Contents**. Quando não há
token, um ponto vermelho aparece na aba, visível mesmo de dentro da outra.

Backend: **`lifeos-config`** (ver `AUTH.md`). O valor nunca volta do servidor
— quem precisa do PAT cru é o publish, via `get_admin_config`.

### `mcp.html`

Mostra a URL do conector com botão de copiar, explica o que é MCP, lista as
oito tools e traz exemplos de pergunta.

**Tem gate**, porque a URL carrega o token de acesso embutido no path: quem a
tiver lê todo o LifeOS.

A URL vem de `lifeos-config` (ação `mcp_url`), que lê `admin_config.mcp_token`.
Pôr o token em `lifeos-config.js` seria publicá-lo — aquele arquivo é servido
pelo GitHub Pages.

> O token saiu do código em set/2026. Antes disso ele era uma constante
> chapada em `lifeos-mcp/index.ts`, e havia duas fontes para o mesmo valor —
> trocar uma sem a outra quebrava o conector. Hoje a function lê da mesma
> linha de `admin_config` que esta tela, então rotacionar é um `update` só,
> sem redeploy.

A lista de tools em `mcp.js` é **cópia** da de `lifeos-mcp/index.ts`. Buscá-la
do servidor exigiria falar JSON-RPC com o MCP a partir do browser — mais peça
móvel do que uma tela de ajuda justifica. Ao mudar uma tool lá, atualize aqui.

O botão de copiar tem fallback para `execCommand`: `navigator.clipboard` exige
contexto seguro e não existe em `file://`, que é onde a página é testada.

### `tutorial.html`

Guia longo do sistema: o intuito do projeto, o argumento de tirar o
armazenamento da cabeça, os módulos, por que HTML cru em vez de gerador de
site, o que muda ao conectar uma IA, e uma ordem sugerida de adoção.

**Sem gate e sem JS próprio** — é só texto e navegação. Não lê nem escreve
dado nenhum, então um gate não protegeria nada e atrapalharia quem chega para
entender o sistema antes de configurá-lo. É a única página do `lifeos/` sem
arquivo `.js` correspondente.

### Tema em todas as páginas

Na mesma rodada, `financas.html`, `tarefas.html`, `notas.html` e
`eventos.html` receberam o `<link id="lifeos-tema">` + `tema.js`. Antes disso a
troca de tema só valia para as páginas novas, e os módulos antigos ficavam na
paleta embutida — inconsistência visível assim que se trocava o tema.


---

## 14. Tags (`tags.html`) — vocabulários configuráveis

Set/2026, migration `0002_vocabularios.sql`. Antes disto, cada lista de tags
ou status vivia em **três** lugares ao mesmo tempo: uma constante no JS de
cada página, outra cópia em cada Edge Function, e um `CHECK` no banco.
Adicionar um valor exigia editar os três e redeployar.

Agora a fonte de verdade é a tabela `lifeos_vocabularios`, e os `CHECK`
foram derrubados. **A validação não sumiu** — passou a ser feita pelas Edge
Functions contra a tabela.

### Os dez domínios

| Domínio | Grava em | Formato |
|---|---|---|
| `nota_tipo` | `lifeos_notas.tipo` | array |
| `tarefa_status` | `lifeos_tarefas.status` | escalar |
| `tarefa_tipo` | `lifeos_tarefas.tipo` | array |
| `projeto_status` | `lifeos_projetos.status` | escalar |
| `projeto_tag` | `lifeos_projetos.tags` | array |
| `evento_tipo` | `lifeos_eventos.tipo` | escalar (tem cor) |
| `manifestacao_status` | `lifeos_manifestacoes.status` | escalar |
| `manifestacao_tag` | `lifeos_manifestacoes.tags` | array |
| `mov_direcao` | `lifeos_movimentacoes.tipo` | array |
| `mov_meio` | `lifeos_movimentacoes.tipo` | array |

**`mov_direcao` e `mov_meio` gravam na MESMA coluna** — herdado da migração
do Notion. É o caso que mais exige cuidado em qualquer operação de rename.

### Renomear migra os dados

É a operação central. Trocar o nome sem atualizar as linhas que já o usam
deixaria órfãos — uma tarefa com status que não existe mais na lista.

A RPC `lifeos_renomear_vocabulario(dominio, de, para)` faz as duas coisas
numa transação: `UPDATE` nos dados (`array_replace` para colunas array,
`UPDATE` simples para escalares) e depois `UPDATE` no vocabulário. Devolve
quantas linhas de dado migraram; a tela mostra o número antes e depois.

Testado contra dados reais antes de aplicar: renomear `Crédito` num array
`{Saida, Crédito}` produz `{Saida, Cartão}` — o valor do outro domínio na
mesma coluna sobrevive, e a ordem do array é preservada.

### `protegido` — o que o código conhece por nome

Nem todo valor é só um rótulo. `Feito`, `Em Andamento`, `Não Iniciado`,
`Em Progresso`, `Pausado`, `Entrada`, `Saida` e `Crédito` são lidos pela
**lógica** (progresso, colunas de kanban, cálculo de saldo, regra de fatura).

Marcados `protegido = true`: podem ser **renomeados** (os dados migram e o
código passa a ler o nome novo, porque lê da tabela), mas não **apagados**.

Onde a cor depende do status, o mapa é remontado **por índice**, não por
nome — assim a cor sobrevive a um rename (`TAR_STATUS_COR` em `lifeos.js`,
`STATUS_COR` em `tarefas.js`).

### Apagar checa uso antes

`lifeos_uso_vocabulario(dominio, valor)` conta as linhas que usam o valor. A
contagem vem junto da listagem, então o botão de excluir **já nasce
desabilitado** quando há uso — em vez de deixar clicar e falhar.

`uso = null` (a contagem falhou) **não** é tratado como zero: apagar nesse
caso poderia deixar dados órfãos.

### Fallback em todo lugar

Cada JS e cada Edge Function mantém sua lista embutida como **fallback**. Se
a leitura da tabela falhar, o sistema segue com o vocabulário de ontem em vez
de ficar sem nenhum — degradar para "tags antigas" é melhor que degradar para
"nenhum seletor funciona".

No MCP, `buildTools()` é uma **função** e não uma constante justamente por
isso: os `enum` de cada `inputSchema` precisam sair do vocabulário carregado,
senão o modelo veria uma lista diferente da que a validação aceita.

> **Ao adicionar um domínio novo**, mexa em quatro lugares: os ramos das duas
> RPCs (`0002_vocabularios.sql`), o mapa `DOMINIOS` em `lifeos-vocabularios`,
> a Edge Function do domínio, e o JS que consome a lista.


---

## 15. `automacao.html` — lançar movimentações pelo celular

Set/2026. Expõe a URL do `lifeos-ingest` e ensina a usá-la, para que a
automação que o autor já tinha no iPhone possa ser usada por qualquer fork.

### A URL carrega a senha

`.../functions/v1/lifeos-ingest?token=<senha mestre>`.

Não é descuido: um atalho do iOS não tem onde guardar cabeçalho HTTP, então a
autenticação precisou caber no endereço. Consequências, ditas em voz alta na
própria tela:

- a página fica **atrás do gate**, como `mcp.html`;
- quem tiver a URL consegue lançar movimentações;
- se vazar, o conserto é trocar a senha mestre e atualizar a automação.

### O payload é formato Notion, de propósito

O corpo aceito é o mesmo "create page" da API do Notion. Parece estranho, e é
herança deliberada: o sistema nasceu migrando de lá, e a automação existente
precisou continuar funcionando **trocando só a URL**. `parent` e `icon` são
aceitos e ignorados.

```json
{ "properties": {
    "Name":  { "title": [{ "text": { "content": "Mercado" } }] },
    "Valor": { "number": 42.5 },
    "Tipo":  { "multi_select": [{ "name": "Saida" }, { "name": "Pix" }] },
    "Date":  { "date": { "start": "2026-09-21" } } } }
```

`Tipo` exige **exatamente uma** direção e aceita um meio opcional — os dois
vivem no mesmo array (ver `FINANCAS.md`).

### iPhone pronto, resto manual

O atalho do autor está publicado em
`icloud.com/shortcuts/441b1631b7cc4e03bf0666cac68d1daa`. A tela insiste no
passo que faz ele ser **do usuário**: trocar a URL dentro da ação "Obter
conteúdo de URL", que por padrão aponta para a instância do autor.

Android não tem equivalente — o formato do iOS não é portável. A tela
documenta o contrato inteiro (campos, regras, códigos de erro) para que
Tasker, HTTP Shortcuts, Automate ou um `curl` deem conta.

### `lifeos-ingest` também lê o vocabulário

Ele ficou de fora do primeiro rewire da migration 0002 e foi corrigido junto
com esta tela. Sem isso, um meio de pagamento criado em **Tags** seria
recusado pelo webhook — a automação pararia de aceitar justamente o valor que
o usuário acabou de cadastrar.


---

## 16. Desligar o blog (`LIFEOS_CONFIG.blog.habilitado`)

O projeto é duas metades: o **arquivo público** (`index.html`, `galeria.html`,
`pages/`) e o **painel privado** (`lifeos/`). Nem todo mundo quer as duas —
há quem só queira o painel.

```js
blog: { habilitado: false }
```

O que muda, via `assets/js/blog.js`:

| Onde | Efeito |
|---|---|
| Menu do hub | "Publicar página" some |
| Topbar do LifeOS | o link "← arquivo" some |
| `senhas.html` | a seção de escopo por página some de cada card |
| `index.html` e `galeria.html` | redirecionam para `lifeos/lifeos.html` |
| Rodapé da capa | o link da galeria some |

**Esconde, não apaga.** O markup continua no HTML e os arquivos continuam no
repositório — religar na config traz tudo de volta sem editar página nenhuma.

### Por que fica no arquivo de config e não numa tela

A decisão precisa valer **antes de qualquer render**, inclusive no
`index.html`, que é página pública. Guardar no banco exigiria um fetch no
carregamento da capa: mais lento, e quebrado quando o backend estiver fora.
Um valor declarativo resolve sem nenhuma das duas coisas.

### O padrão é ligado

`blog.js` só desliga com `habilitado === false` explícito. Config sem a chave
— um fork anterior a esta opção — continua com o arquivo público, que é o
comportamento histórico.

A escolha vale para quem **não vai publicar nada**: uma capa vazia no ar é
pior que não ter capa.
