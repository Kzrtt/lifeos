# OPENSOURCE.md — o que falta para alguém instanciar este projeto

Levantamento feito em **set/2026**, varrendo o código e o projeto Supabase.

**Resposta curta: sim, com uma ressalva de deploy.** Os quatro bloqueadores
foram resolvidos em set/2026. O que falta é polimento (§2 e §3), não
impedimento.

---

## 1. Bloqueadores — RESOLVIDOS

### 1.1 ✅ Schema do banco versionado

`supabase/migrations/0001_init.sql` + `supabase/seed.sql`. Cobre as 11 tabelas,
as constraints, os índices, o RLS, as 5 funções que o produto usa e o bucket
`manifestacoes` do Storage.

**Foi testado de verdade**, não só escrito: a migration foi aplicada num schema
descartável (`mig_test`) no próprio banco, o seed rodou em cima, e as funções de
gate foram verificadas (`check_master_token` aceita a senha do seed e recusa
outra; `check_page_access` confirma que um token mestre abre qualquer página).
O schema de teste foi removido em seguida; a produção não foi tocada.

O `seed.sql` cria a senha mestre `lifeos`, um projeto inicial (toda tarefa exige
um projeto, então sem isso a primeira ação do usuário falha) e cinco tarefas que
funcionam como checklist de configuração.

> A migration **não é cópia literal da produção**: três políticas foram fechadas
> e cinco funções órfãs não foram recriadas. Tudo marcado no rodapé do arquivo,
> com o SQL para corrigir a instância original — ver §3.5 aqui.

### 1.2 ✅ Segredo do MCP fora do código

`lifeos-mcp` lê o token de `admin_config.mcp_token` (ou do secret
`LIFEOS_MCP_TOKEN`, que tem precedência). A constante sumiu do arquivo.

Se não houver token configurado, a function recusa **toda** conexão — o
contrário transformaria um erro de instalação num servidor aberto. No `seed.sql`
o valor nasce como um placeholder inválido de propósito.

> **Pendência de deploy:** a versão em execução no projeto do autor ainda é a
> anterior, com a constante. Ela continua funcionando, e o segredo não está
> publicado em lugar nenhum — mas o repositório e o deploy divergem até que
> `lifeos-mcp` seja redeployado. É o único passo pendente desta lista.

### 1.3 ✅ `LICENSE`

MIT. É o padrão para projetos desta natureza e o mais permissivo para quem
forkar — a escolha pode ser trocada à vontade, é um arquivo só.

### 1.4 ✅ CORS não trava mais um domínio diferente

Era o bloqueador mais traiçoeiro: nove Edge Functions tinham
`const ALLOWED_ORIGIN = "https://SEU-USUARIO.github.io"` chapado. Um fork subia tudo
certo e **toda chamada morria em CORS**, com um erro de browser que não diz o
que fazer.

Agora: `Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*"`. Sem configuração
nenhuma, funciona em qualquer domínio.

**Por que `*` é aceitável aqui:** a autenticação é a senha mestre enviada no
**corpo** da requisição, não um cookie. Não existe credencial ambiente que o
browser anexe sozinho, então uma página maliciosa que chame a function não
consegue nada sem já saber a senha — e se souber, o CORS não a impediria de
qualquer forma (`curl` ignora CORS). A fronteira real é `check_master_token`,
server-side. Quem quiser restringir mesmo assim define o secret.

`lifeos-ingest` não tem CORS porque é server-to-server; `lifeos-mcp` já era `*`
pelo mesmo motivo — clientes MCP não são browsers.

---

## 2. Atritos de instalação (dá para subir, mas dói)

### 2.1 Credenciais ainda chapadas em 7 arquivos

`assets/js/lifeos-config.js` resolveu isso para as páginas do LifeOS, mas
continuam com o project ref escrito no código:

```
assets/js/eventos.js      assets/js/financas.js     assets/js/gallery.js
assets/js/gate.js         assets/js/notas.js        assets/js/tarefas.js
login.html
```

Quem forkar tem de achar e trocar o ref em cada um. `gate.js` e `login.html`
são os mais sensíveis: são o gate das páginas protegidas do archive.

### 2.2 ✅ Origin do GitHub Pages — resolvido

Virou o bloqueador §1.4. As nove functions com CORS agora leem
`LIFEOS_ALLOWED_ORIGIN`, com `*` como padrão.

**Pendência de deploy:** os arquivos do repositório estão corretos, mas as
versões em execução no projeto do autor ainda têm o valor antigo. Como a
instância dele usa exatamente aquele domínio, nada quebrou — e deployar
mudaria o comportamento dela de "travado num domínio" para "aberto". Fica a
critério dele.

### 2.3 Identidade pessoal no código

"LifeOS", "LifeOS", os banners e avatares, os vocabulários (tipos de nota,
tags de projeto, meios de pagamento). `LIFEOS_CONFIG.identidade` cobre o
masthead do hub; o resto está espalhado. Um fork nasce com a cara de outra
pessoa.

### 2.4 Dados de exemplo — parcial

`seed.sql` cria um projeto e cinco tarefas que funcionam como checklist de
configuração. Resolve o caso que travava de verdade (toda tarefa exige um
projeto, então sem nenhum a primeira ação do usuário falha).

Falta o resto: nota, evento, manifestação e movimentação de exemplo, para que
cada módulo abra mostrando o que sabe fazer em vez de uma tela vazia.

### 2.5 ✅ `.env.example` e `SETUP.md`

`.env.example` existe e documenta os secrets (quais a Supabase injeta sozinha,
quais são opcionais, e o que cada um faz).

`SETUP.md` cobre os dois caminhos — instalação assistida por IA (com o prompt
pronto) e manual — mais diagnóstico de erros comuns e os limites do plano free.
A skill `/personalizar` (em `.claude/skills/`) entrevista o dono do fork e
aplica identidade, backend, tema e limpeza do conteúdo do autor original.

### 2.6 Functions pessoais misturadas

`notion-movimentacoes` (local) e `notion-explore` /
`notion-manifestacoes-migrate` (só no Supabase) são scripts de migração única
do Notion. Não pertencem ao produto e devem ficar fora do repo OSS.

---

## 3. Inconsistências de código

Levantadas na varredura. **Nenhuma quebra nada hoje** — são dívida.

### 3.1 `THEME_ACCENTS` em quatro cópias

`index.html`, `assets/js/index.js`, `assets/js/publicar.js` e
`assets/js/temas.js`. Trocar a cor de um tema exige editar os quatro, e nada
avisa se um ficar para trás. **É a pior das duplicações**, porque as cópias
não estão perto umas das outras.

Candidato claro a `assets/js/theme-accents.js` carregado por `<script>` — o
mesmo padrão de `manifest.js` e `lifeos-config.js`. Mexe no render do
`index.html`, que é a capa pública, então pede cuidado.

### 3.2 Vocabulários duplicados entre front e MCP

`PROJETO_STATUS` aparece em 3 arquivos, `TIPOS_TAREFA` e `MANIFESTACAO_TAGS`
em 2 cada, e todos aparecem **de novo** em `lifeos-mcp/index.ts`. Um valor
novo precisa ser adicionado em dois a três lugares; esquecer um faz a busca
via MCP rejeitar um valor que a interface aceita.

Aqui a duplicação é deliberada (`LIFEOS.md` §2) — mas a promessa de
"configurável a partir de si mesmo" exige que virem dados numa tabela, lidos
por todos. É a mudança de maior retorno depois das migrations.

### 3.3 Helpers repetidos por cópia

`IS_LOCAL_DEV`, `showDevBadge`, `mockDelay` em 7 arquivos; `esc` em 4;
`confirmDelete` em 3. **Isto é `LIFEOS.md` §2 funcionando como desenhado**,
não um defeito: a alternativa (um `lifeos-shared.js`) reintroduz o acoplamento
que motivou a separação.

O ponto de atenção é outro: **a regra não está sendo verificada**. Foi
exatamente assim que `publicar.html` e `senhas.html` nasceram sem
`[hidden] { display: none !important; }` e travaram em loading infinito — a
linha existia nas quatro páginas antigas e se perdeu ao copiar. Um teste que
compare as cópias vale mais que centralizá-las.

### 3.4 `lifeos.js` com 3.125 linhas

O hub concentra seis domínios num arquivo. Ainda navegável, mas é o arquivo
onde um erro custa mais caro. Não urge.

### 3.5 ✅ RPCs órfãs expostas ao `anon` — corrigido

**Resolvido em set/2026.** `list_access_tokens`, `list_token_pages`,
`grant_token_page`, `revoke_token_page` e `check_access_token` foram dropadas
da instância original — nenhuma era chamada desde que `lifeos-senhas` assumiu,
e todas estavam expostas ao `anon` (`list_access_tokens` devolvia os tokens em
texto puro). A migration nunca as recriou.

### 3.7 ✅ Duas policies abertas demais — corrigido

Descobertas ao gerar a migration, e **corrigidas na instância original em
set/2026**. Um fork já nascia fechado. Eram:

- **`gallery` aceitava INSERT de `anon`** (`anon_insert_gallery`, with check
  `true`). A anon key é pública por natureza — vai no código do site. Qualquer
  pessoa podia inserir linhas arbitrárias na galeria.
- **`token_pages` tinha SELECT liberado para `anon`** (`anon_read_token_pages`).
  Não vaza senha, mas vaza o mapa de quais páginas são protegidas e por qual
  token. Nenhum código do projeto depende dessa policy.

Ambas removidas, junto com as cinco funções órfãs de §3.5. A instância agora
expõe ao `anon` exatamente o que a migration prevê: `check_page_access`,
`get_admin_config`, e a leitura pública da galeria.

### 3.6 O PAT do GitHub vai para o browser

Documentado em `AUTH.md` e assumido conscientemente, mas continua sendo o
ponto mais frágil: quem tem a senha mestre e abre `publicar.html` recebe um
token com escrita no repositório. A tela nova de Token reduz o estrago
(ensina a escopar em um repositório e só a permissão Contents), não elimina.

O fim da linha é a publicação virar uma Edge Function que segura o PAT
server-side.

---

## 4. O que já está pronto

Para não perder de vista:

- Front inteiro funcionando, com dez páginas coerentes e tema trocável
- Todas as Edge Functions em uso **existem no repositório** (`lifeos-manifestacoes`
  foi recuperada do Supabase em set/2026 — estava deployada e fora do repo)
- Configuração do LifeOS feita de dentro do próprio LifeOS: senhas, token do
  GitHub, temas — nada mais exige SQL no painel do Supabase
- Modo local (`IS_LOCAL_DEV`) em todas as telas que falam com o backend, com
  mocks que reproduzem inclusive os casos de erro
- Documentação de arquitetura densa em `docs/`, que é o que faz uma IA
  conseguir trabalhar no projeto

---

## 5. Ordem sugerida do que sobrou

Nada aqui impede o lançamento.

1. Redeployar `lifeos-mcp` (§1.2) — fecha a divergência repo/deploy
2. Corrigir as policies e funções órfãs da instância original (§3.5, §3.7 e o
   rodapé de `0001_init.sql`)
3. Padronizar `lifeos-config.js` nos 7 arquivos que faltam (§2.1)
4. `SETUP.md` com o roteiro de instalação assistida por IA
5. Despersonalizar identidade e vocabulários (§2.3)
6. `THEME_ACCENTS` num arquivo só (§3.1)
