# AUTH.md — Mecanismos de acesso

O projeto tem **quatro mecanismos independentes** de controle de acesso, que não
se conhecem e não compartilham código. Antes de mexer em qualquer um, identifique
qual está em jogo:

| # | Mecanismo | Arquivo | Tem senha? | Tem backend? | Onde é usado |
|---|---|---|---|---|---|
| 1 | Gate por senha | `assets/js/gate.js` + `login.html` | ✅ sim | ✅ Supabase RPC | 10 entradas em `pages/` |
| 2 | Gate por origem de navegação | `assets/js/access-gate.js` | ❌ não | ❌ nenhum | `pages/fichamento-mestre.html` |
| 3 | Trava de link compartilhado | `assets/js/share-guard.js` + `share-link.js` | ❌ não | ❌ nenhum | guard em 29 páginas (26 em `pages/`) · link em 1 |
| 4 | Gate mestre do LifeOS | inline em cada página | ✅ sim | ✅ Edge Function | `lifeos/` (6 páginas ativas) |

**Nenhum deles é criptografia.** O conteúdo está inteiro no HTML servido — quem
abrir o source lê tudo. São barreiras de acesso casual, decisão consciente do
projeto. A única exceção é o mecanismo 4, onde o dado real (finanças, tarefas)
vive no Supabase e a fronteira é validada server-side.

---

## 1. Gate por senha (`gate.js`)

### Como funciona

1. Ao carregar, **esconde imediatamente** o `<body>` (`visibility: hidden`)
2. Redireciona para `login.html?page=<slug>&back=<url>`
3. `login.html` valida a senha contra o Supabase (RPC `check_page_access(p_token, p_page)`, escopada por página)
4. Se válida: grava uma flag de uso único em `sessionStorage` e volta para a página original, que revela o conteúdo
5. Se o flag de uso único de uma navegação anterior já bate com a página atual: revela sem redirecionar

### Como proteger uma página

Uma linha no `<head>` — o `data-page` é obrigatório e define o escopo do token:

```html
<head>
  <!-- ... outras tags ... -->
  <script data-page="minha-entrada" src="../assets/js/gate.js"></script>
</head>
```

Isso é tudo. **Não existe "bloco de autenticação Supabase" para colar no corpo da
página** — `gate.js` cuida de tudo sozinho, sem markup adicional.

### Detalhes da implementação

| Item | Valor |
|---|---|
| Supabase URL | hardcoded em `gate.js` e `login.html` |
| Anon key | hardcoded em `gate.js` e `login.html` |
| RPC chamado | `check_page_access(p_token, p_page)` → retorna `true`/`false` |
| Quem chama a RPC | no fluxo normal, **só o `login.html`** — `gate.js` apenas redireciona. O `gate.js` só fala com o Supabase no atalho `?md=claude` (abaixo), e é por isso que ele carrega URL e anon key |
| Slug da página | atributo `data-page` no próprio `<script>` |
| Chave de sessão | `psyches_just_auth` no `sessionStorage` — flag de uso único, consumida na volta do login |
| Escopo | por navegação — recarregar a página protegida direto (sem passar pelo login) pede senha de novo |

### Páginas que usam hoje

`analise-integral`, `cartografia-das-medicinas`, `consagracao-changa-presenca`,
`degrau-onde-eros-trava`, `estereotipo-sombra-neo-arquetipo`, `o-amante`,
`piramide`, `planejamento-financeiro`, `retrato`, `tarot-dois-mapas-um-vetor`.

### Acesso direto de agente (`?md=claude&pswd=`)

Para permitir que um agente (ex.: Claude) leia o conteúdo de uma página protegida
em uma única navegação — sem passar pelo fluxo `gate.js → login.html → volta` —
`gate.js` reconhece dois parâmetros extras na query string da própria página
protegida:

```
pages/minha-entrada.html?md=claude&pswd=SENHA_DO_CLAUDE
```

Se `md=claude` e `pswd` estiverem presentes, `gate.js` chama a mesma RPC
`check_page_access(p_token, p_page)` diretamente (sem redirecionar para
`login.html`) e revela a página se a senha for válida para aquele slug. Se
inválida ou ausente, cai no fluxo normal de redirect.

Nenhum backend novo — reaproveita a RPC existente. A senha do Claude deve ser
cadastrada como um token próprio em `access_tokens`, escopado apenas às páginas
às quais o Claude deve ter acesso — não usar a mesma senha de uso humano.

**Nota de segurança:** a senha fica visível na URL (histórico do navegador,
possíveis logs). O risco de vazamento via `Referer` para recursos de terceiros
(Google Fonts, CDN do Mermaid) é mitigado pela política de referrer padrão dos
browsers modernos (`strict-origin-when-cross-origin`, que omite path/query em
requisições cross-origin) — mas trate essa senha como sensível mesmo assim.

---

## 2. Gate por origem de navegação (`access-gate.js`)

Mecanismo **completamente separado** do `gate.js`. Não pede senha, não fala com
o Supabase. Ele só verifica se a visita chegou pelo caminho esperado.

Tem dois modos, escolhidos pelo atributo `data-slug`:

**SETTER** — no `index.html` e no `legacy.html`:
```html
<script src="assets/js/access-gate.js" data-slug="setter"></script>
```
Intercepta (em fase de captura) cliques em links para `pages/` e grava
`sessionStorage['psyches_gate'] = <slug>`, um token de uso único. Também limpa
`psyches_open` ao chegar no index, para que voltar ao index e recarregar a
página protegida volte a ser bloqueado.

**GUARD** — cedo no `<head>` da página protegida, sem `defer`/`async`:
```html
<script src="../assets/js/access-gate.js" data-slug="fichamento-mestre"></script>
```
Libera em três casos: `?ref=share` na URL; `psyches_open === slug` (já validada
nesta sessão, permite refresh); ou `psyches_gate === slug` (primeira entrada
vinda do index — o token é consumido e vira `psyches_open`). Qualquer outra
entrada grava `psyches_blocked` e redireciona para `pages/sem-acesso.html`.

Uma aba marcada com `psyches_blocked` não consegue mais navegar para `pages/`
pelo index — o SETTER intercepta e manda direto para `sem-acesso.html`.

**Usado hoje por uma única página:** `pages/fichamento-mestre.html`.

---

## 3. Trava de link compartilhado (`share-guard.js` / `share-link.js`)

Não é controle de acesso a conteúdo — é confinamento de sessão.

- **`share-link.js`** (só em `pages/fichamento-mestre.html`) põe um botão
  "copiar link" que copia a URL atual com `?ref=share`. Quando a página é aberta
  com `?ref=share`, os elementos `.back-link` são escondidos — quem recebeu o
  link não navega para o resto do archive.
- **`share-guard.js`** (primeiro `<script>` do `<head>`, sem `defer`/`async`, em
  29 páginas — 26 delas em `pages/`) é o outro lado: se a sessão tem uma página
  compartilhada gravada em
  `sessionStorage['psyches_shared_page']` e o pathname atual não bate, o visitante
  é redirecionado de volta antes de qualquer render.

`sessionStorage` é escopado por aba — abrir uma aba nova começa sessão limpa, e
a navegação normal em outras abas nunca é afetada.

---

## 4. Gate mestre — LifeOS (`lifeos/lifeos.html`, `lifeos/financas.html`, `lifeos/tarefas.html`)

As páginas do LifeOS **não** usam `gate.js` nem `access-gate.js`. Cada uma tem seu
próprio formulário de gate (código isolado — ver [`LIFEOS.md`](LIFEOS.md) §2), mas a
senha mestre digitada é enviada à Edge Function correspondente
(`lifeos-movimentacoes`, `lifeos-eventos`, `lifeos-projetos`, `lifeos-tarefas` e
`lifeos-manifestacoes`, todas chamadas por `lifeos.html` — Finanças e Tarefas
read-only, Eventos e Manifestações com escrita; `financas.html` só chama
`lifeos-movimentacoes`; `tarefas.html` chama `lifeos-projetos` e
`lifeos-tarefas`), que valida `is_master` **server-side** (RPC
`check_master_token`, restrita a `service_role`). O gate de senha de cada
página é só UX — a fronteira de segurança real é a function. Uma senha só
cobre tudo (não há gate por módulo), e a chave de "lembrar" no
localStorage (`financas_master`) é compartilhada entre as três páginas,
então logar numa deixa as outras logadas também. Os tokens não-master
(`sul`/`crias`) não entram. `eventos.html` tem o mesmo gate mas está
dormente, sem link apontando pra ela (ver `LIFEOS.md` §6). Detalhes em
[`FINANCAS.md`](FINANCAS.md) §8.

**`lifeos-mcp` (set/2026)** — servidor MCP (Model Context Protocol) sobre
Streamable HTTP, pensado pra ser cadastrado como "custom connector" em
claude.ai (Settings → Connectors), não pra ser aberto num browser. Expõe
tools de CONSULTA sobre todo o sistema (`search_notas`, `search_tarefas`,
`search_projetos`, `search_eventos`, `search_manifestacoes`,
`search_citacoes`, `search_movimentacoes`) e duas tools de ESCRITA, as duas restritas a Notas
(`create_nota`, `update_nota` — este último substituição completa, nunca
patch parcial: toda chamada reenvia nome/tipo/projetos/conteúdo inteiro,
mesmo o que não mudou) — decisão explícita do autor: nenhum outro domínio
ganha create/update/delete por aqui.

**Auth É DIFERENTE do resto do projeto** (2ª versão do arquivo, 8ª rodada,
set/2026 — pedido explícito do autor: a 1ª versão pedia a senha mestre como
parâmetro em CADA tool call, achou pouco prático, queria o token "na
conexão"). Claude.ai não expõe hoje um campo de header estático pra
conector pessoal (fora do fluxo de diretório/enterprise) — só URL +
OAuth opcional. Solução: o token vai embutido no PRÓPRIO PATH da URL
cadastrada em claude.ai —
`.../functions/v1/lifeos-mcp/<MCP_TOKEN>` — colado UMA VEZ ao adicionar o
conector (confirmado por teste: a Edge Function recebe qualquer sufixo de
path, então isso funciona). `MCP_TOKEN` é uma constante **chapada
diretamente no código** (pedido explícito do autor — não é o
`access_tokens`/`check_master_token` do resto do app, é dedicada só a
este conector, gerada com `openssl rand -hex 32`, 256 bits). Checado
ANTES de tocar no corpo JSON-RPC — `tools/list` também fica atrás desse
gate agora (diferente da 1ª versão, onde `tools/list` era público).
Rotacionar: gerar novo valor, trocar a constante, redeployar, atualizar a
URL cadastrada em claude.ai.

`verify_jwt = false` (deliberado — um cliente MCP não tem noção de JWT do
Supabase; a autenticação real acontece dentro da função). Ver
`supabase/functions/lifeos-mcp/index.ts` pro código completo, incluindo
os vocabulários válidos de cada domínio (cópias isoladas dos que as
Edge Functions correspondentes já validam — `NOTA_TIPOS_VALIDOS`,
`TAREFA_STATUS_VALIDOS`, etc.).

---

## O campo `protected` do manifest

**Nenhum renderizador lê esse campo.** Nem `index.html`, nem
`assets/js/index.js`. O card é montado igual com `protected: true` ou `false` —
não há cadeado, filtro ou aviso. É metadado informativo, e hoje está
**dessincronizado da realidade**:

- Com `gate.js` mas `protected: false` no manifest: `analise-integral`,
  `degrau-onde-eros-trava`, `o-amante`, `retrato`
- Com `protected: true` mas **sem** `gate.js` (abre livre): `a-alavanca-e-a-fronteira`
- `fichamento-mestre` usa `access-gate.js`, que o campo `protected` não
  representa de jeito nenhum

Ao marcar `protected` no manifest, entenda que você está anotando uma intenção,
não ativando nada. A proteção real vem do `<script>` no `<head>` da página.

---

## Estrutura Supabase

**O schema não está versionado neste repositório** — não existe
`supabase/migrations/`. O que segue é o *contrato* que o código realmente chama,
extraído dos `fetch` do front. Os corpos das funções vivem só no projeto Supabase.

### RPCs chamadas pelo front (via anon key)

| RPC | Argumentos | Retorno | Chamado por |
|---|---|---|---|
| `check_page_access` | `p_token text, p_page text` | `boolean` | `gate.js`, `login.html`, `publicar.js` (só pra desambiguar erro de login) |
| `get_admin_config` | `p_token text, p_key text` | valor da config | `publicar.js` (**só `is_master`** — corrigido set/2026, ver nota abaixo). Autentica e busca o PAT na mesma chamada |
| `list_access_tokens` | `p_master text` | lista de tokens | **ninguém** — legado do admin, substituído pela Edge Function `lifeos-senhas` |
| `list_token_pages` | `p_master text` | páginas de um token | **ninguém** — idem |
| `grant_token_page` | `p_master text, p_token_id bigint, p_page text` | — | **ninguém** — idem |
| `revoke_token_page` | `p_master text, p_id bigint` | — | **ninguém** — idem |

As quatro RPCs marcadas como "ninguém" continuam existindo no banco e continuam
expostas ao `anon`. Nenhum arquivo do front as chama desde set/2026 — quem faz
esse trabalho agora é a Edge Function `lifeos-senhas`, com a service role. Vale
revogar o `execute` delas do `anon`, ou dropá-las, já que a superfície `anon`
sobre a tabela de autenticação é justamente o que causou o incidente do
`github_pat`.

### RPCs chamadas pelas Edge Functions (via service role)

| RPC | Argumentos | Retorno | Chamado por |
|---|---|---|---|
| `check_master_token` | `p_token text` | `boolean` | todas as functions `lifeos-*`, incluindo `lifeos-senhas` e `lifeos-config` |
| `lifeos_saldo_abertura` | ver `FINANCAS.md` | — | `lifeos-movimentacoes` |
| `lifeos_range` | ver `FINANCAS.md` | — | `lifeos-movimentacoes` |

### Tabelas do controle de acesso

`access_tokens` guarda os tokens. Pelas chamadas do `admin/index.html` e pelo
`FINANCAS.md` §9, ela tem pelo menos: `token`, `is_master boolean`, `label`. O
escopo por página é uma relação separada (`token_pages`), manipulada por
`grant_token_page` / `revoke_token_page` e lida por `check_page_access`.
`admin_config` guarda pares chave/valor de configuração — hoje a chave
`github_pat`.

### `check_access_token` — existe, mas não é o gate

A RPC `check_access_token(p_token)` existe no banco e **checa apenas se o token
existe**, sem olhar `is_master` (ver `FINANCAS.md` §6). Nenhum arquivo do front
a chama hoje — `gate.js` e `login.html` usam `check_page_access`, que é escopada
por página, e as Edge Functions usam `check_master_token`. Trate-a como legado.

> **Não use a DDL que estava aqui em versões anteriores deste arquivo.** Ela
> apresentava `check_access_token` como o gate das páginas protegidas — não é —
> e descrevia `access_tokens` sem `is_master`, sem `label` e sem escopo por
> página. Para recuperar o schema real, leia o projeto Supabase direto (MCP ou
> dashboard) — e, de preferência, versione o resultado.

---

## Telas de configuração do LifeOS (`lifeos/publicar.html`, `lifeos/senhas.html`)

**Set/2026 — o painel `admin/index.html` foi desmembrado e movido.** Ele vivia
num link no rodapé do `index.html`/`legacy.html`; virou duas páginas dentro do
LifeOS, alcançadas pelo drawer de configuração do hub. `admin/index.html` hoje é
um stub que redireciona. Ver [`LIFEOS.md`](LIFEOS.md) §11.

**A senha não mudou.** O admin autenticava com `check_page_access(token, 'admin')`,
e essa RPC libera qualquer token com `is_master = true` independente da página —
ou seja, a senha do admin sempre foi a senha mestre, a mesma do LifeOS. As duas
telas agora usam o gate mestre padrão (`check_master_token` via Edge Function, ou
`get_admin_config` no caso de `publicar.html`, que exige `is_master`).

### `publicar.html`

Mesma mecânica de antes:

1. Chama `get_admin_config(p_token, p_key: 'github_pat')` e recebe **um Personal
   Access Token do GitHub no browser** — a chamada serve de autenticação e de
   busca do token ao mesmo tempo, já que a RPC exige `is_master = true`
2. Usa esse PAT para escrever no repositório via `api.github.com/repos/{owner}/{repo}/`
3. `owner`/`repo`/`branch` vêm de `assets/js/lifeos-config.js`, não mais de
   constantes no arquivo

> **Postura de segurança deste desenho:** a única barreira entre um visitante e
> um PAT com permissão de escrita no repositório é uma senha. Está documentado
> aqui porque é assim que funciona hoje, não porque seja um padrão a repetir.
> Mover a tela pro LifeOS não piorou isso — é a mesma senha e a mesma RPC — mas
> o caminho certo é a publicação virar uma Edge Function que segure o PAT
> server-side, e isso ainda não foi feito.
>
> **Correção de segurança, set/2026:** `get_admin_config(p_token, p_key)`
> checava apenas `exists(access_tokens where token = p_token)` — SEM olhar
> `is_master`. Na prática, qualquer um dos tokens escopados por página (não
> só o mestre) conseguia chamar essa RPC direto via
> `POST /rest/v1/rpc/get_admin_config` (ela é `SECURITY DEFINER`, exposta ao
> `anon`) e recuperar o `github_pat`. Corrigido adicionando `and is_master = true`
> ao check. Ver também: os tokens de página existentes na época da descoberta
> tinham 3–6 caracteres (`sul`/`crias`/`claude`) — entropia baixa o bastante
> pra tornar isso explorável por força bruta direto na RPC (sem rate-limit
> visível).

### `lifeos-config` — `admin_config` atrás do gate mestre

Set/2026. Antes disto, cadastrar o `github_pat` exigia `INSERT` manual na
tabela pelo painel do Supabase — era o último atrito de configuração fora do
próprio LifeOS. Agora há a aba **Token do GitHub** em `publicar.html`.

Ações: `query`, `set`, `delete`, `mcp_url`. Chaves na lista branca:
`github_pat` e `mcp_token` — a lista existe para a function não virar
armazenamento chave/valor arbitrário.

`query` devolve só `definido` + uma versão mascarada, nunca o valor. **A
exceção é `mcp_url`**, que devolve o token do MCP cru dentro da URL do
conector: mascará-la tornaria a tela inútil, já que a URL só serve sendo
colada inteira no cliente MCP. Continua atrás do gate mestre.

Quem precisa do PAT cru é o publish, e ele continua usando a RPC
`get_admin_config`.

### `senhas.html` — CRUD de `access_tokens` e `token_pages`

A gestão de senhas que antes só existia via SQL no painel do Supabase. Fala com
a Edge Function **`lifeos-senhas`**, **não** com RPCs.

**Por que Edge Function e não RPC nova:** foi o desenho "RPC `SECURITY DEFINER`
exposta ao `anon`" que produziu o vazamento descrito acima. Dar superfície de
**escrita** na tabela de autenticação ao `anon` repetiria o mesmo erro num alvo
pior. A function valida `check_master_token` e só então toca nas tabelas com a
service role, igual a todas as outras `lifeos-*`.

Ações: `query`, `create`, `update`, `delete`, `grant`, `revoke`.

Guardrails aplicados **na function**, não só na UI — testar chamando a function
direto, não pela tela:

| Erro | Quando |
|---|---|
| `last_master` | apagar ou rebaixar a única senha com `is_master = true` |
| `self_delete` | apagar a senha usada na própria requisição |
| `duplicate_token` | criar/editar para um valor de senha que já existe |
| `master_no_scope` | conceder escopo de página a uma senha mestre (ela já abre tudo) |
| `invalid_token` | senha vazia |

Senhas com menos de 12 caracteres entram, mas voltam marcadas (`curta`) e a tela
mostra um badge. É aviso e não bloqueio porque a senha mestre em uso pode ser
curta, e recusá-la no meio de uma edição seria pior que avisar.

O valor da senha **nunca volta do servidor**: a function devolve só
`token_masked` e `token_len`. Não existe ação de revelar senha.

---

## Atualizar credenciais do Supabase

URL e anon key estão hardcoded e **repetidos em 8 arquivos**: `assets/js/gate.js`,
`assets/js/lifeos.js`, `assets/js/financas.js`, `assets/js/tarefas.js`,
`assets/js/eventos.js`, `assets/js/gallery.js`, `login.html` e `admin/index.html`.
Não existe arquivo de configuração — trocar de projeto Supabase exige editar os
oito. As Edge Functions recebem `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` por
variável de ambiente (injetadas pela plataforma), mas têm o `ALLOWED_ORIGIN`
hardcoded em cada `index.ts`.
