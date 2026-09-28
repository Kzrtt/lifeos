# CLAUDE.md — LifeOS

> Leia este arquivo inteiro antes de qualquer ação no projeto.
> Os docs auxiliares em `docs/` são referenciados em cada seção.
> **Antes de estender o LifeOS, confira a tabela da §3 — existe uma skill para quase todo tipo de mudança.**

---

## 1. O que é este projeto

Um sistema de gestão de vida auto-hospedado, com duas metades publicadas pelo
GitHub Pages:

| Metade | Onde | O que é |
|---|---|---|
| **LifeOS** (o painel) | `lifeos/` + `assets/js/` + `supabase/` | Painel privado: finanças, tarefas, notas, calendário, memória das IAs… Backend no Supabase (Postgres + Edge Functions). Ver [`LIFEOS.md`](../docs/LIFEOS.md). |
| **Blog** (opcional) | `index.html`, `pages/`, `galeria.html` | Páginas HTML independentes publicadas pelo próprio painel. `LIFEOS_CONFIG.blog.habilitado = false` desliga essa metade — ver `LIFEOS.md` §16. |

**Sem build step, sem framework, sem `node_modules`.** HTML, CSS e JS crus. `git push` publica.

**Stack:**
- HTML + CSS + JS cru. Nenhuma dependência de build
- Chart.js `@4.4.6` e marked `@12.0.2` via CDN, só nas páginas que precisam; Mermaid `@10.9.0` nas páginas de texto com diagrama
- Font Awesome 5 **Free** (`assets/css/icons.css` + `assets/webfonts/free-*`). As classes no markup dizem `fad`, herdado do Pro — o CSS as aponta para a família Solid livre. **Nunca adicione arquivos do FA Pro**: é produto licenciado e o repositório é público
- Supabase: tabelas `lifeos_*` com RLS ligado e **sem policy** (só a `service_role` acessa), uma Edge Function por módulo, servidor MCP em `lifeos-mcp`
- `assets/js/lifeos-config.js` — configuração da instância (URL do Supabase, anon key, identidade, tema padrão, blog). Dado declarativo, nenhuma função. É o arquivo que um fork edita

Instalação: [`SETUP.md`](../SETUP.md). Estado honesto do projeto: [`OPENSOURCE.md`](../docs/OPENSOURCE.md). Árvore de arquivos: [`ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

---

## 2. Mapa do LifeOS

Cada linha é um par HTML + JS isolado (ver §4.1). As páginas moram em `lifeos/`; o JS delas em `assets/js/`.

| Página | JS | Papel | Backend |
|---|---|---|---|
| `lifeos.html` | `lifeos.js` | **Hub** — calendário + CRUD de Eventos, Tarefas (CRUD também aqui), Projetos (CRUD só aqui), Manifestações, Citações; Finanças e Notas **só leitura** | várias `lifeos-*` |
| `financas.html` | `financas.js` | Finanças (CRUD, faturas, projeção) — ver [`FINANCAS.md`](../docs/FINANCAS.md) | `lifeos-movimentacoes`, `lifeos-ingest` |
| `tarefas.html` | `tarefas.js` | Tarefas completo (kanban, lista, gráficos); só lê Projetos | `lifeos-tarefas`, `lifeos-projetos` |
| `notas.html` | `notas.js` | Notas em markdown, N:N com projetos — ver [`NOTAS.md`](../docs/NOTAS.md) | `lifeos-notas` |
| `memoria.html` | `memoria.js` | Memória de longo prazo das IAs (índice + registros) — `LIFEOS.md` §17 | `lifeos-memorias` |
| `publicar.html`, `senhas.html`, `temas.html`, `tags.html`, `automacao.html`, `mcp.html` | homônimos | Telas de configuração do drawer | `lifeos-config`, `lifeos-senhas`, `lifeos-vocabularios`… |
| `tutorial.html` | — | Guia de uso, sem gate e sem JS próprio | — |
| `index.html` | inline | Apresentação pública do LifeOS, sem gate — `LIFEOS.md` §18 | — |

**Referência canônica de página:** `lifeos/memoria.html` + `assets/js/memoria.js` — a mais recente, com gate, modo local, modais `.pdet-*`, exclusão de dois cliques e delegação de eventos no padrão atual. **De backend:** `supabase/functions/lifeos-citacoes/index.ts` + `supabase/migrations/0006_lifeos_citacoes.sql` (o CRUD mais simples). **De hub:** as seções de Citações e Projetos em `lifeos.html`/`lifeos.js`.

---

## 3. Skills — qual usar

As skills em `.claude/skills/` guardam o passo a passo de cada tipo de extensão, com os arquivos que precisam mudar juntos. **Use a skill em vez de improvisar** — quase todo bug deste projeto veio de um lugar esquecido numa mudança que atravessa vários arquivos.

| Quero… | Skill |
|---|---|
| Personalizar uma instância recém-instalada | `/personalizar` |
| Um módulo novo de ponta a ponta (tabela → tela → hub → MCP) | `/lifeos-modulo` |
| Uma tabela nova + migration + Edge Function | `/lifeos-backend` |
| Uma página nova em `lifeos/` (módulo ou tela de configuração) | `/lifeos-pagina` |
| Uma hero-section nova no hub, ou um card novo numa seção existente | `/lifeos-hero-section` |
| Um gráfico (Chart.js) em qualquer página | `/lifeos-grafico` |
| Um modal de criar/editar/detalhe, com formulário e exclusão | `/lifeos-modal` |
| Uma coluna/campo novo num módulo que já existe | `/lifeos-campo` |
| Um item no menu (drawer), no quicknav ou um botão de cabeçalho | `/lifeos-menu` |
| Uma lista de tags/status editável em Tags | `/lifeos-vocabulario` |
| Uma tool nova (ou mudar uma) no servidor MCP | `/lifeos-mcp-tool` |
| Uma paleta nova | `/lifeos-tema` |
| Conferir se uma mudança seguiu o padrão (antes de commitar) | `/lifeos-revisar` |

Mudanças que atravessam várias skills (ex.: módulo novo) começam pela mais abrangente, que chama as outras na ordem certa. **Toda mudança no LifeOS termina com `/lifeos-revisar`.**

---

## 4. LifeOS — o contrato de código

Estas regras valem para qualquer arquivo do LifeOS. As skills as aplicam; quem edita à mão precisa conhecê-las.

### 4.1 Isolamento por cópia

**Cada página do `lifeos/` é isolada.** Sem imports cruzados, sem uma página lendo funções ou estado de outra, sem código de um módulo dentro do arquivo de outro. Padrões repetidos — gate, modo local (`IS_LOCAL_DEV` + mocks), `confirmDelete`, `esc`, `carregarVocab` — são **copiados**, nunca extraídos para um `shared.js`. Ver [`LIFEOS.md`](../docs/LIFEOS.md) §2.

Isso é deliberado, não descuido. A consequência: **ajustar um padrão num arquivo não muda os outros.** Se o ajuste vale em todos, replique à mão e diga isso no commit.

Exceções, todas dado declarativo carregado por `<script>`, sem estado nem regra de negócio: `lifeos-config.js` (config), `tema.js` (troca o `href` do tema antes da pintura) e `blog.js` (esconde o que depende do blog). Ninguém põe helper nelas para outra página consumir.

Navegação entre telas é sempre `<a href>` real — nunca uma "página" trocada por `hidden`/tabs dentro de outro arquivo. Finanças e Notas são **só leitura** no hub; a escrita delas mora nas páginas próprias.

### 4.2 A casca de toda página

- `<head>` nesta ordem: `<style>` inline (tokens base → CSS da página → bloco `SYSTEM SKIN` no fim) → `<link id="lifeos-tema">` → `lifeos-config.js` → `tema.js` → `blog.js`. Sem `defer`. A ordem **é** o mecanismo de tema (`LIFEOS.md` §12)
- `[hidden] { display: none !important; }` no `<style>` — sem isso a página trava no gate (§5)
- O JS numa IIFE com `'use strict'`, lendo `window.LIFEOS_CONFIG` e montando as próprias constantes (`FN = CFG.supabaseUrl + '/functions/v1/lifeos-<x>'`). Nenhuma URL ou chave chapada
- **Modo local:** `IS_LOCAL_DEV` (`file:`/localhost) pula o gate, mostra a tarja `DEV · dados fictícios` e serve **toda** chamada de API a partir de um mock em memória — inclusive os erros que a Edge Function devolve. Uma chamada nova sem ramo de mock quebra o teste local
- Gate: senha mestre enviada **no corpo**; "lembrar" grava em `localStorage[CFG.sessionKey]`, a mesma chave em todas as páginas
- O `<script>` do JS da página leva `?v=AAAAMMDD` (+ letra se mudar duas vezes no dia). **Mudou o JS, suba o `?v=`** — o Pages cacheia por 10 minutos

### 4.3 Backend

- Tabela `public.lifeos_<modulo>`, `uuid` + `created_at`/`updated_at`, **RLS ligado sem policy**. Uma migration nova por mudança, numerada em sequência em `supabase/migrations/` — nunca editar uma migration já publicada: instâncias existentes já a aplicaram
- Uma Edge Function por módulo (`lifeos-<modulo>`), nunca reaproveitar a de outro domínio. Deploy com `--no-verify-jwt`; a autenticação é `check_master_token` sobre a senha do corpo
- Contrato: `POST {token, action, …}` → `{ok: true, …}` ou `{ok: false, error: "<codigo>"}`. Códigos de erro curtos (`invalid_titulo`, `not_found`, `unauthorized`); o front traduz num mapa `ERRO`
- Validação e limites (`MAX_*`) vivem na Edge Function; o front e o MCP **copiam** os mesmos limites
- O MCP (`lifeos-mcp`) fala direto com o PostgREST — não passa pelas Edge Functions de domínio. Mudou regra de validação num domínio, muda no MCP também
- A lista de functions a deployar está em `SETUP.md` — function nova entra lá; migration nova é aplicada em ordem numérica
- CORS é `*` por padrão (`LIFEOS_ALLOWED_ORIGIN` restringe) — a fronteira é a senha, não a origem (`OPENSOURCE.md` §5.4)

### 4.4 Vocabulários são dados

Tags e status vivem em `lifeos_vocabularios`, editáveis em **menu → Tags**. As constantes no código são **fallback**, para o sistema degradar para o vocabulário de ontem em vez de ficar sem nenhum. Valores `protegido` (`Feito`, `Entrada`, `Crédito`…) são lidos pela lógica por nome: renomeáveis, não apagáveis. Cor que depende de status é mapeada **por posição**, não por nome. Ver `LIFEOS.md` §14 e `/lifeos-vocabulario`.

### 4.5 Visual do painel

Leia [`VISUAL.md`](../docs/VISUAL.md) antes de escrever HTML/CSS.

- Painel escuro, nove temas (cada um em versão escura para o painel e clara para o blog). **Toda cor vem de token** (`--bg`, `--surface`, `--surface-2`, `--border`, `--border-mid`, `--text`, `--dim`, `--mute`, `--gold`, `--gold-wash`, `--green`, `--red`, `--blue`). Transparência se deriva: `color-mix(in srgb, var(--gold) 32%, transparent)` — nunca `rgba()` com o hex do token
- Tipografia: Playfair Display itálico nos títulos, JetBrains Mono em todo o resto, EB Garamond só onde o conteúdo é prosa (precedentes: banner de Citações, registros da Memória). Nenhuma fonte genérica (Inter, Roboto, system-ui)
- **Nunca faixa lateral de destaque** (`border-left`/`border-right` colorido para marcar um item). Destaque é fundo tingido, borda nos quatro lados, ou nada
- `.hero-section` não é card — é agrupador sem fundo; o card é o `.bento-card`. Seções se separam pelo divisor duplo `3px double var(--text)`
- Modais seguem o padrão banner `.pdet-*` (banner com ícone, nome em Playfair, corpo `.pdet-body-pad`)
- Breakpoints: `780px` e `560px` (e `480px` nos grids do hub)
- **Ícones:** classes `fad fa-*`. Todo `fa-*` novo precisa de uma entrada em `assets/css/icons.css`, com o codepoint do Font Awesome 5 Free Solid, em ordem alfabética — sem ela o glifo não aparece. Nome que só existe no Pro ou no FA6 ganha o codepoint do equivalente livre

### 4.6 Documentação acompanha o código

Mudou comportamento, mude o doc no mesmo commit: `LIFEOS.md` (a seção do módulo e a tabela §10 "Status dos módulos"), `FINANCAS.md`/`NOTAS.md` quando for deles, `ARCHITECTURE.md` se nasceu arquivo, `SETUP.md` se nasceu function ou migration, `OPENSOURCE.md` se mudou um número que ele cita. Uma tool nova do MCP também aparece em `mcp.js` e em `lifeos/index.html` (a apresentação cita a contagem).

---

## 5. Armadilhas que já custaram bugs

Todas aconteceram em produção.

- **`[hidden]` sem a regra `!important`** não esconde elemento cuja classe declara `display` (`.gate`, `.modal`, `.loading-ov`). Sintoma: página presa em "verificando sessão…" ou spinner eterno
- **Copiar a casca de outra página perde CSS em silêncio.** Classe usada no JS sem regra no `<style>` vira `<button>` cru. Compare as classes do JS com as do CSS
- **Checar `EDIT_*_ID` depois de `close*Modal()`** — o close zera o id e a edição vira criação duplicada. Guarde o id numa variável local **antes** de fechar
- **`e.target.closest()` num listener de `document` que cancela a exclusão pendente** — o `<i>` clicado já saiu do DOM quando `confirmDelete` trocou o conteúdo do botão. Use `e.composedPath()`
- **Picker montado no `init()` não vê o vocabulário** — `init()` roda antes de `carregarVocab`. Todo seletor montado a partir de vocabulário é reconstruído quando ele chega
- **Uma busca nova dentro do `Promise.all` do boot do hub** derruba o hub inteiro se a function não existir numa instalação antiga. Dado opcional leva `.catch` com valor vazio
- **Mudar o formato do cache do hub sem subir `HUB_CACHE_V`** — o boot hidrata o formato velho e o dado novo nunca aparece até um ↻
- **Deploy de Edge Function com o repo atrasado** já regrediu produção. Antes de deployar, confira que o arquivo versionado tem tudo que roda hoje
- **`data-capa` no `<html>`** é o marcador que `blog.js` usa para redirecionar a capa; no hub vira loop. A preferência de capa do hub é `data-hub-capa`

---

## 6. Blog — a metade pública

Só importa se `LIFEOS_CONFIG.blog.habilitado` for `true`.

- `assets/js/manifest.js` é a fonte de verdade das entradas (listagem da capa, linha do tempo, volumes); `manifest.json` é o espelho exato. Schema em [`MANIFEST.md`](../docs/MANIFEST.md). A tela **Publicar** do painel faz tudo isso sozinha
- **Cache-busting** ao mexer no manifest: `meta.version` nos dois arquivos + `?v=` das tags de `manifest.js` e `redact.js` no `index.html`
- Cada entrada em `pages/` é autocontida, com o próprio `<style>` e **paleta própria** — é o ponto, não um descuido. Por isso as entradas ficam fora dos temas
- `index.html` não se edita à mão para adicionar card — ele se monta do manifest
- `#(texto)` em qualquer campo string do manifest aparece embaralhado na capa
- Páginas protegidas por senha: uma linha no `<head>`, `<script data-page="<slug>" src="../assets/js/gate.js"></script>`. `"protected": true` no manifest **não protege nada**. Ver [`AUTH.md`](../docs/AUTH.md)

---

## 7. O que nunca fazer

- Adicionar framework, build step ou `node_modules`
- Adicionar arquivos do **Font Awesome Pro** — é licenciado, o repo é público
- Criar CSS separado para as páginas do blog ou do painel. Os temas em `assets/css/themes/` são a exceção, e só redefinem tokens de cor
- Extrair helper compartilhado entre páginas do LifeOS (§4.1)
- Chapar URL, chave, senha padrão ou qualquer valor de configuração no código — config vem de `lifeos-config.js`; valor padrão do sistema é **seed no banco**, criado pela migration
- Afrouxar o CORS para testar local — o modo local existe para isso
- Pedir, aceitar ou gravar a **service role key** em qualquer arquivo do repositório
- Dar DELETE a uma tool do MCP — excluir é só pelas telas
- Adicionar um tema sem registrá-lo nos **quatro** lugares (`themes/lifeos/<slug>.css`, `themes/blog/<slug>.css`, `VALIDOS` em `tema.js`, `TEMAS` em `temas.js`) — use `/lifeos-tema`
- Pôr dado real de alguém em mock, seed ou exemplo — o repositório é público
- Editar o `index.html` à mão para adicionar um card
- Publicar sem o cache-busting
- Assumir qualquer coisa sobre um arquivo sem lê-lo primeiro
