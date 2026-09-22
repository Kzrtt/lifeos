# ARCHITECTURE.md — Estrutura do Projeto

## Árvore de arquivos

```
lifeos/
│
├── .claude/CLAUDE.md          # Entry point para agentes — lê primeiro
├── .claude/skills/            # /personalizar — entrevista de configuração
├── README.md                  # O que o projeto é
├── SETUP.md                   # Instalação, assistida por IA ou manual
├── LICENSE                    # MIT
├── .env.example               # Secrets que as Edge Functions esperam
│
├── index.html                 # Capa do arquivo — renderiza de assets/js/manifest.js
├── login.html                 # Tela de senha do fluxo gate.js
├── llms.txt                   # Guia de navegação para agentes/crawlers
├── manifest.json              # Espelho JSON do manifest (para humanos e máquinas)
├── galeria.html               # Galeria de imagens (tabela + bucket `gallery`)
│
├── pages/                     # As entradas do arquivo, uma por HTML autocontido
│   └── sem-acesso.html        #   destino de quem não passa no access-gate
│
├── lifeos/                    # O PAINEL — 11 páginas, cada uma isolada
│   ├── lifeos.html            #   hub: calendário, tarefas, saldo, notas
│   ├── financas.html          #   movimentações, fatura, comparação de meses
│   ├── tarefas.html           #   tarefas + projetos (kanban e lista)
│   ├── notas.html             #   notas em markdown
│   ├── publicar.html          #   publica entrada nova + aba do token GitHub
│   ├── senhas.html            #   senhas de acesso e escopo por página
│   ├── temas.html             #   troca a paleta
│   ├── tags.html              #   vocabulários de todas as tabelas
│   ├── automacao.html         #   webhook de lançamento pelo celular
│   ├── mcp.html               #   URL do conector MCP e guia das tools
│   └── tutorial.html          #   guia do sistema (sem gate)
│
├── assets/
│   ├── js/                    # Um .js por página + os compartilhados
│   │   ├── lifeos-config.js   #   ÚNICO arquivo que um fork precisa editar
│   │   ├── tema.js            #   aplica o tema antes da 1ª pintura
│   │   ├── blog.js            #   liga/desliga a metade pública
│   │   └── manifest.js        #   fonte de verdade das entradas
│   ├── css/
│   │   ├── icons.css          #   Font Awesome 5 Free (ver README)
│   │   └── themes/            #   9 temas × 2 escopos (lifeos/ e blog/)
│   ├── webfonts/              # Só os arquivos FA5 Free
│   └── images/                # banner, avatar, favicon
│
├── docs/                      # Referência de arquitetura
└── supabase/
    ├── migrations/            # 0001_init.sql + 0002_vocabularios.sql
    ├── seed.sql               # Senha mestre padrão + projeto inicial
    └── functions/             # 11 Edge Functions
```

> Esta árvore descreve o repositório do **sistema**. A instância de origem
> tinha seções próprias (galeria, portfólio, um jogo) que não fazem parte do
> produto e não vieram — se você encontrar referências a elas em algum doc,
> são resíduo da extração.

### Functions não versionadas (estado atual, não intencional)

`assets/js/lifeos.js` chama `lifeos-manifestacoes`, que **existe em produção mas
não tem código em `supabase/functions/`**. O mesmo vale para
`notion-manifestacoes-migrate` e `notion-explore` (ambas de migração, dormentes
— ver `LIFEOS.md` §6.4). Consequência prática: um deploy limpo a partir deste
repositório sobe o front chamando uma function que não existe, e o módulo
Manifestações quebra sem aviso.

## Princípio de self-containment

Cada página `.html` contém **todo o seu CSS** no `<style>` interno. Não existe
folha de estilo compartilhada escrita à mão — o único `.css` em arquivo é o
`assets/css/font-awesome-pro-master.min.css`, que é biblioteca de terceiros.

**Razão:** simplicidade de manutenção e deploy. Uma página = um arquivo de estilo.

O JS **não** segue a mesma regra. Além do script inline de cada página, existem
14 arquivos compartilhados em `assets/js/` (lista na árvore acima), incluídos por
`<script src>`. São comportamentos transversais — gate, back-to-top, redact,
share-guard — que não valia a pena duplicar em 40 páginas.

## CDNs utilizados

Todos com versão pinada (sem `integrity`/SRI):

```html
<!-- Mermaid.js — 24 páginas de entrada têm diagrama; 22 carregam por aqui -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js"></script>
<!-- ...e 2 carregam a MESMA versão pelo cdnjs (o-observador, o-amante) — inconsistência histórica -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js"></script>

<!-- Chart.js — LifeOS (lifeos.html, financas.html, tarefas.html) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>

<!-- marked — render de markdown na descrição de tarefas -->
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>

<!-- three.js — jogo.html -->
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
```

**Não há SDK do Supabase em lugar nenhum.** Todo acesso ao Supabase — `gate.js`,
`login.html`, `admin/`, LifeOS — é `fetch` cru contra a REST API / Edge Functions.
**jQuery existe só no `legacy.html`**; `index.html` não usa.

Google Fonts: cada página declara o seu próprio conjunto (ver `VISUAL.md` §Tipografia).

## Como o index funciona

`index.html` **não faz fetch**. Ele carrega `assets/js/manifest.js` via `<script>`,
que seta `window.PSYCHES_MANIFEST`, e renderiza a partir daí — por isso o index
funciona até em `file://`. O `manifest.json` da raiz é uma cópia de referência
para humanos, agentes e crawlers (é o que o `<noscript>` e o `llms.txt` apontam),
não é lido pelo site.

1. Para publicar uma nova entrada: cria o `.html` em `pages/` + atualiza
   `assets/js/manifest.js` **e** `manifest.json` (os dois, sempre iguais)
2. O index reflete automaticamente na próxima vez que for carregado
3. A paginação por volumes é controlada pelo campo `volume` no manifest
4. O toggle de linha do tempo é controlado pelo mesmo manifest — ordena por `date`

**Dois renderizadores, um manifest:** `index.html` tem a lógica de render inline
no próprio arquivo; `assets/js/index.js` é um render separado usado **apenas por
`legacy.html`**. Os dois leem o mesmo `window.PSYCHES_MANIFEST` e cada um tem sua
própria cópia do mapa `THEME_ACCENTS` — ver `MANIFEST.md` §theme.

## Volumes

Ao atingir 10 entradas no Vol. I:
1. O campo `volume: 1` em todas as entradas existentes permanece como está
2. Novas entradas recebem `volume: 2`
3. O index filtra por volume ativo (o mais alto com entradas)
4. Um link de navegação entre volumes é renderizado automaticamente

## Camada de backend dinâmico (LifeOS) — exceção ao "sem backend"

O projeto é estático, com **uma exceção**: o **LifeOS**. Ele usa **Supabase
Edge Functions** como hop de servidor — necessárias pra esconder a service
role key do banco e aplicar a fronteira de autenticação (senha mestre)
server-side. É a única parte do projeto com backend dinâmico.

- **Frontend:** quatro páginas ativas, isoladas entre si, sem código
  compartilhado (ver [`LIFEOS.md`](LIFEOS.md) §2): `lifeos.html` +
  `assets/js/lifeos.js` (hub — Finanças, Tarefas e Notas são só leitura,
  cada uma com link "Abrir" pra sua página própria; Eventos/Calendário é
  nativo do hub, com CRUD completo ali mesmo, incluindo um toggle que faz o
  mesmo calendário mostrar tarefas com prazo; ghost preview de
  Manifestações); `financas.html` + `assets/js/financas.js` (módulo
  Finanças, página própria, CRUD completo); `tarefas.html` +
  `assets/js/tarefas.js` (módulo Tarefas + Projetos, página própria, CRUD
  completo — toda tarefa exige um projeto); `notas.html` +
  `assets/js/notas.js` (módulo Notas, página própria, CRUD completo —
  vínculo a projeto é N:N, opcional, ver [`NOTAS.md`](NOTAS.md)). Todas via
  JS cru + Chart.js (CDN, exceto Notas, que não usa gráficos). `eventos.html`/
  `assets/js/eventos.js` existem no repositório mas estão **dormentes** —
  sem link algum apontando pra elas (ver `LIFEOS.md` §6).
- **Backend (Supabase):** tabelas `public.lifeos_movimentacoes`,
  `public.lifeos_eventos`, `public.lifeos_projetos`,
  `public.lifeos_tarefas`, `public.lifeos_manifestacoes`,
  `public.lifeos_notas` e `public.lifeos_notas_projetos` + o bucket de
  Storage público `manifestacoes` (banners) + Edge Functions
  `lifeos-movimentacoes` (query/update/create/delete), `lifeos-ingest`
  (webhook de ingestão externa), `lifeos-eventos` (query/create/delete),
  `lifeos-projetos` (query/create/update/delete), `lifeos-tarefas`
  (query/create/update/delete), `lifeos-manifestacoes` (query/create),
  `lifeos-notas` (query/create/update/delete) e `lifeos-mcp` (servidor MCP,
  6 tools de consulta + `create_nota`/`update_nota` como únicas tools de
  escrita, ambas restritas a Notas, ver `AUTH.md` §4) + RPCs
  (`check_master_token`, `lifeos_saldo_abertura`, `lifeos_range`).
  Versionadas em `supabase/functions/`: `lifeos-movimentacoes`,
  `lifeos-ingest`, `lifeos-eventos`, `lifeos-projetos`, `lifeos-tarefas`,
  `lifeos-notas` e `lifeos-mcp`. **`lifeos-manifestacoes` não está
  versionada** (ver acima).
- **Legado dormente:** `notion-movimentacoes` (function) e o `NOTION_TOKEN` no
  Vault não são mais chamados pelo front — a fonte de verdade das
  movimentações migrou do Notion pra `lifeos_movimentacoes` em set/2026, e a
  das notas migrou pra `lifeos_notas` também em set/2026 (ver `FINANCAS.md`
  §9 e [`NOTAS.md`](NOTAS.md) §6). O Notion segue existindo só como cópia
  histórica — nenhum módulo do LifeOS depende dele mais.
- A pasta `supabase/` **não** é servida pelo Pages — é só a fonte versionada das functions.

Detalhes técnicos completos do módulo Finanças em [`FINANCAS.md`](FINANCAS.md),
do módulo Notas em [`NOTAS.md`](NOTAS.md); padrão do hub e como plugar um
módulo novo em [`LIFEOS.md`](LIFEOS.md). Contexto da empreitada original
(decisões, divergências do plano) em [`ENTREGA-FINANCAS.md`](ENTREGA-FINANCAS.md).
