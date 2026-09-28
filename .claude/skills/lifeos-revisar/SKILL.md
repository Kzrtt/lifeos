---
name: lifeos-revisar
description: Audita uma mudança no LifeOS contra o contrato de código do projeto — casca das páginas, cores fora de token, modo local, cache-busting, cache do hub, backend, MCP sincronizado com a tela, ícones, registro de temas e docs — e relata o que está fora do padrão, com arquivo e linha. Use ao terminar qualquer mudança no LifeOS, antes de commitar, ou quando o usuário pedir para revisar/conferir consistência. Trigger - /lifeos-revisar
---

# /lifeos-revisar

A verificação de fim de mudança. **Só lê e relata** — não corrige nada sem o
usuário pedir. O contrato que ela confere está em `.claude/CLAUDE.md` §4 e §5.

## Uso

```
/lifeos-revisar            # o que mudou desde o último commit (staged + unstaged + novos)
/lifeos-revisar <ref>      # o que mudou desde <ref> (ex.: main, HEAD~3)
/lifeos-revisar --tudo     # o repositório inteiro — mais lento, acha dívida antiga
```

---

## 1. Escopo

```bash
git diff --name-only <ref ou HEAD>; git ls-files --others --exclude-standard
```

Separe por tipo: páginas (`lifeos/*.html`), JS (`assets/js/*.js`), functions
(`supabase/functions/*/index.ts`), migrations, CSS de tema, docs. Leia o diff
de cada arquivo antes de julgar — os comandos abaixo apontam suspeitos, não
veredictos.

## 2. Checagens

Rode as que se aplicam aos tipos que mudaram. Em cada achado, abra o arquivo
e confirme antes de relatar.

### Páginas (`lifeos/*.html`)

- **`[hidden]`** — toda página com gate tem a regra:
  `grep -L "\[hidden\] { display: none !important; }" lifeos/*.html`
  (`tutorial.html` e `index.html` não têm gate e podem não ter.)
- **Ordem do `<head>`** — depois do `</style>`: `<link id="lifeos-tema">`,
  `lifeos-config.js`, `tema.js`, `blog.js`, sem `defer`.
- **Config chapada** — nenhuma URL do Supabase, chave `eyJ…` ou nome de
  repositório no HTML/JS do painel:
  `grep -nE "supabase\.co|eyJhbGci" lifeos/*.html assets/js/*.js | grep -v lifeos-config.js`
  `gate.js` e `login.html` (fluxo de senha do arquivo público) são exceções
  documentadas; o `<projeto>.supabase.co` ilustrativo da apresentação também.
  Arquivo que o diff **não** tocou e ainda tem constante própria é dívida
  antiga — relate nessa categoria, não como achado da mudança.
- **`?v=` atrasado** — para cada JS alterado, o `?v=` na tag que o carrega
  mudou no mesmo diff. JS alterado com `?v=` igual = o usuário vê a versão
  velha por até 10 minutos.

### CSS (no `<style>` das páginas)

Olhe **só as linhas adicionadas** no diff:

- **Cor fora de token** — hex ou `rgba(` novo fora do bloco de tokens e do
  `SYSTEM SKIN`. Transparência de token deveria ser
  `color-mix(in srgb, var(--x) N%, transparent)`. Exceções aceitas: overlays
  pretos de modal/sombra (`rgba(6,8,11,…)`, `rgba(0,0,0,…)`), paletas
  categóricas documentadas.
- **Faixa lateral de destaque** — `border-left`/`border-right` com cor ou
  largura > 1px para marcar um item. Divisor neutro de 1px entre controles
  (como o do botão do gate) não conta.
- **Fonte** fora do trio (Playfair Display, JetBrains Mono, EB Garamond onde
  há prosa). Nenhuma `Inter`, `Roboto`, `Arial`, `system-ui`.
- **`.hero-section`** com `background`/`border` próprios.
- Classe usada no JS/HTML sem regra no `<style>` (a armadilha de copiar a
  casca).

### JS

- **Sintaxe:** `node --check assets/js/<arquivo>.js` em cada JS alterado.
- **Isolamento** — nenhum arquivo lê função/estado de outra página
  (`window.<algo>` que não seja `LIFEOS_CONFIG`, `LIFEOS_TEMA`, `LIFEOS_BLOG`,
  `Chart`, `marked`).
- **Modo local** — toda chamada de rede nova (`fetch(`, `api*`, `callFn`) tem
  ramo `IS_LOCAL_DEV` com mock.
- **Edição** — `if (EDIT_…_ID)` ou uso do id **depois** de um
  `close…Modal()` no mesmo `.then`. Tem que ser uma variável local guardada
  antes.
- **Exclusão** — listener em `document` que usa `e.target.closest(` para
  cancelar pendência (deveria ser `e.composedPath()`); `window.confirm(`.
- **HTML montado com dado do banco** — `innerHTML = … + <campo> + …` sem
  `esc(`.
- **Vocabulário** — comparação com texto literal de valor protegido
  (`=== 'Feito'`, `'Crédito'`), picker montado no `init()` e não reconstruído
  no `carregarVocab`.
- **Hub** — se `writeHubCache()`/`hydrateFromHubCache()` mudaram de formato,
  `HUB_CACHE_V` mudou no mesmo diff; chamada nova no `Promise.all` de
  `fetchAllHubDados()` para dado opcional tem `.catch`; estado novo é zerado
  no `onLogout()`. Mesmo raciocínio para o `CACHE_V` de `tarefas.js`,
  `notas.js` e `financas.js`.
- **Gráfico** — `new Chart(` sem `destroy()` da instância anterior; cor em hex
  onde há token (`/lifeos-grafico`).

### Backend

- **Migration** — número é o próximo da sequência, nenhuma migration antiga
  editada (`git diff --name-only -- supabase/migrations` só lista arquivos
  novos), `enable row level security` presente em tabela nova, nenhum
  `create policy` / `grant … to anon`, nenhum `check (… in (…))` com lista de
  valores.
- **Edge Function nova** — está no loop de deploy do `SETUP.md`; usa
  `check_master_token`; responde `{ok, error}`; CORS pelo
  `LIFEOS_ALLOWED_ORIGIN`.
- **Limites** — `MAX_*` iguais na function, no JS que valida e no MCP.

### MCP (se `lifeos-mcp` ou `mcp.js` mudou)

```bash
F=supabase/functions/lifeos-mcp/index.ts
diff <(grep -oE '^    name: "[a-z_]+"' $F | cut -d'"' -f2 | sort) \
     <(grep -oE "nome: '[a-z_]+'" assets/js/mcp.js | cut -d"'" -f2 | sort) \
  && echo "buildTools = mcp.js"
diff <(grep -oE '^    name: "[a-z_]+"' $F | cut -d'"' -f2 | sort) \
     <(grep -oE '^        [a-z_]+: \(a\) =>' $F | awk '{print $1}' | tr -d ':' | sort) \
  && echo "buildTools = handlers"
echo "tools: $(grep -cE '^    name: "[a-z_]+"' $F)"; grep -oE '[0-9]+ ferramentas' lifeos/index.html | sort | uniq -c
```

- As três listas batem, e a contagem em `lifeos/index.html` é a real.
- Nenhuma tool `delete_*`.
- `enum` de campo de vocabulário vem de `VOCAB.`, não literal.
- `serverInfo.version` subiu.

### Ícones (só se existir `assets/css/icons.css`)

```bash
[ -f assets/css/icons.css ] && for i in $(grep -rhoE "fad fa-[a-z0-9-]+|'fa-[a-z0-9-]+'" lifeos assets/js | grep -oE "fa-[a-z0-9-]+" | sort -u); do
  grep -q "\.$i::" assets/css/icons.css || echo "sem glifo: $i"; done
```

Descarte o que não é ícone (`fa-spin` é animação). Ícone real sem entrada
aparece como quadrado vazio.

### Temas (se algo em `themes/`, `tema.js` ou `temas.js` mudou)

```bash
T=assets/css/themes
diff <(ls $T/lifeos/*.css | xargs -n1 basename | sed 's/\.css$//' | sort) \
     <(ls $T/blog/*.css   | xargs -n1 basename | sed 's/\.css$//' | sort) && echo "lifeos = blog"
diff <(ls $T/lifeos/*.css | xargs -n1 basename | sed 's/\.css$//' | sort) \
     <(sed -n '/var VALIDOS/,/\]/p' assets/js/tema.js | grep -oE "'[a-z]+'" | tr -d "'" | sort) && echo "arquivos = VALIDOS"
diff <(sed -n '/var VALIDOS/,/\]/p' assets/js/tema.js | grep -oE "'[a-z]+'" | tr -d "'" | sort) \
     <(sed -n '/var TEMAS/,/^  \];/p' assets/js/temas.js | grep -oE "slug: '[a-z]+'" | cut -d"'" -f2 | sort) && echo "VALIDOS = TEMAS"
```

E cada tema novo define todos os tokens do `sepia.css` da mesma pasta.

### Docs

- Página, function, migration, tool ou domínio novo aparece em
  `docs/LIFEOS.md` (seção do módulo + tabela §10), `docs/ARCHITECTURE.md`
  (árvore/contagens) e `SETUP.md` (deploy), conforme o caso.
- Comportamento mudado tem o doc correspondente mudado no mesmo diff.

### Dados

- Mocks e seeds com dados **fictícios** — nenhum nome, valor ou texto real do
  dono da instância.

## 3. Relatório

Agrupe por gravidade, com `arquivo:linha` e a correção em uma linha:

- **Quebra** — vai falhar em produção ou no modo local (sintaxe, `[hidden]`,
  cache sem versão, tool sem handler, tema sem registro, function fora do
  deploy)
- **Fora do padrão** — funciona, mas diverge do contrato (cor chapada, mock
  faltando, doc desatualizado, `?v=` parado)
- **Dívida antiga** — só no modo `--tudo`, ou quando o diff encostou nela

Termine com a lista de checagens que passaram, em uma linha, e pergunte se o
usuário quer que você corrija os achados. Se tudo passou, diga isso
diretamente.
