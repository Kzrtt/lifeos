---
name: lifeos-pagina
description: Cria uma página nova em `lifeos/` com o JS dela em `assets/js/` — módulo com tela própria ou tela de configuração do menu — seguindo a casca padrão (head na ordem do tema, [hidden], gate da senha mestre, modo local com mocks, SYSTEM SKIN, ?v=). Use sempre que o pedido for "uma tela nova", "uma página pra X", ou quando um módulo precisar de mais do que cabe no hub. Trigger - /lifeos-pagina
---

# /lifeos-pagina

Uma página nova do painel: `lifeos/<nome>.html` + `assets/js/<nome>.js`,
isolada de todas as outras (`CLAUDE.md` §4.1).

**A referência canônica é `lifeos/memoria.html` + `assets/js/memoria.js`.**
Copie os dois e adapte — não monte a casca de memória, nem a partir de uma
página mais antiga (`financas`, `tarefas` e `notas` carregam histórico que
não vale propagar).

---

## 0. Decida o tipo

| Tipo | Quando | Como se chega nela |
|---|---|---|
| **Módulo** | dado próprio com várias views, filtros ou regra de negócio (`financas`, `tarefas`, `notas`) | hero-section no hub com botão "Abrir" (`/lifeos-hero-section`) |
| **Tela de drawer** | configuração ou contexto (`senhas`, `tags`, `memoria`) | item no menu do hub (`/lifeos-menu`) |
| **Texto** | só leitura, sem dado (`tutorial`) | item no menu; **sem gate e sem JS próprio** |

Se o módulo é simples (uma lista, um formulário), talvez ele caiba **dentro
do hub** e não mereça página — ver `docs/LIFEOS.md` §1 e §8. Pergunte se
estiver em dúvida; página nova é o caminho mais caro de manter.

O backend (`/lifeos-backend`) vem antes: a página precisa saber o nome da
Edge Function e o formato que ela devolve.

---

## 1. HTML — o que copiar de `memoria.html` e o que trocar

**Mantenha exatamente** (são o mecanismo, não o estilo da memória):

- `<meta name="robots" content="noindex, nofollow">` e `theme-color`
- `<link>` do Google Fonts (tire EB Garamond se a página não tiver prosa)
- `<link>` dos ícones — copie o da página irmã, qualquer que seja (kit Pro ou
  `icons.css`)
- No `<style>`: bloco de tokens base, `[hidden] { display: none !important; }`,
  gate, topbar, `.head`, `.row-btn`, modal `.pdet-*`, `.edit-*`, `.foot`,
  `.loading-ov`/`.spinner`, e o bloco **SYSTEM SKIN** por último
- Depois do `</style>`, nesta ordem e sem `defer`:
  `<link rel="stylesheet" id="lifeos-tema" …>` → `lifeos-config.js` →
  `tema.js` → `blog.js`. O `href` do tema é o mesmo das páginas irmãs (é o
  padrão da instância)
- `<div id="gate">…</div>` inteiro, `<div id="app" class="wrap" hidden>`,
  `<div id="loading" class="loading-ov" hidden>`
- Topbar: `<a href="lifeos.html" class="back">` + botão de sair

**Troque:**

- `<title>` — mesmo prefixo das páginas irmãs + ` · <Nome>`
- `.head`: `<h1>` com o nome e um `<p>` curto em minúsculas
- O conteúdo do `#app` e os modais — a página em si
- CSS específico da memória (`.mem-*`, `.reg-*`, `.origem*`, `.composer`) →
  o CSS da sua página, **só com tokens** (`CLAUDE.md` §4.5)
- Rodapé: copie o texto do `.foot-text` de uma página irmã
- `<script src="../assets/js/<nome>.js?v=AAAAMMDD"></script>` no fim do body

Página **de texto**: sem gate, sem `#app hidden`, sem `<script>` próprio além
de `lifeos-config.js`/`tema.js`/`blog.js`. Molde: `tutorial.html`.

## 2. JS — o esqueleto

Copie `memoria.js` e mantenha a ordem das seções, trocando o conteúdo:

```
cabeçalho (o que a página é · backend · LIFEOS.md §N)
(function () { 'use strict';
  config        CFG, <X>_FN, ANON_KEY, LS_KEY, limites MAX_* (cópia dos da function)
  estado        SESSION_PW, arrays de dados, filtros, EDIT_*_ID, DELETE_PENDING
  helpers       $, esc, fmtData…  (cópias locais — nunca importe)
  modo local    IS_LOCAL_DEV, showDevBadge, mockDelay, mockFail, seedMock
  API           callFn(body) + objeto `api` com um ramo IS_LOCAL_DEV por método
  erros         mapa ERRO { codigo: 'mensagem' } + msgErro(err)
  gate          showGateForm, shake, enterApp, onGateSubmit, onLogout
  dados         applyData, reload, achar*
  render        render(), <item>Html()
  modais        open/close/onSubmit por modal  (→ /lifeos-modal)
  exclusão      resetDeletePending, confirmDelete  (cópia, LIFEOS.md §7)
  boot / init   boot(), init() com todos os listeners, ESC
})();
```

Obrigatório:

- **Nenhuma URL ou chave literal.** Tudo a partir de `window.LIFEOS_CONFIG`,
  com o `throw` explicativo se ele não carregou.
- **Todo método de `api` tem ramo de mock**, e o mock reproduz os erros de
  domínio da Edge Function (`titulo_duplicado`, `not_found`…) — senão o teste
  local só cobre o caminho feliz.
- O mock usa dados **fictícios e genéricos**, nunca dados reais do usuário.
- `esc()` em todo valor vindo do banco que entra por `innerHTML`; ou monte com
  `textContent`.
- Delegação de eventos no contêiner da lista (a lista é re-renderizada
  inteira), com `data-*` para identificar a ação — como em `memoria.js`.
- ESC fecha o modal aberto mais recente; sem modal, cancela exclusão pendente.
- `if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();` no `init()`.
- Vocabulário: se a página usa tags/status, copie `carregarVocab` de uma
  página que já o tenha (`notas.js`, `tarefas.js`) e **reconstrua os pickers
  quando ele chegar**.

## 3. Ligar a página ao resto

- **Entrada:** `/lifeos-menu` (drawer) ou `/lifeos-hero-section` (botão
  "Abrir" no hub). Página sem entrada é página órfã.
- **Ícones novos:** se existir `assets/css/icons.css`, cada `fa-*` que ainda
  não está lá ganha uma entrada (codepoint do Font Awesome 5 Free Solid, em
  ordem alfabética).
- **Docs:** `docs/LIFEOS.md` — linha no bloco de arquitetura da §2, seção
  própria e linha na tabela §10; `docs/ARCHITECTURE.md` — a árvore e a
  contagem de páginas.

## 4. Verificar

1. Abra o arquivo direto do disco (`file://`): tarja DEV no topo, sem gate,
   dados do mock na tela, cada ação (criar, editar, excluir, erro de
   validação) funcionando contra o mock.
2. Troque o tema em `temas.html` e volte: a página muda de paleta inteira.
   Algo que ficou na cor antiga é cor chapada.
3. Largura de celular (≤560px): nada estoura na horizontal.
4. Rode `/lifeos-revisar`.

O usuário faz a checagem visual final no navegador — diga o que testar, não
tire screenshots.

---

## Nunca

- Importar ou ler qualquer coisa de outra página (`CLAUDE.md` §4.1)
- Simular duas páginas num arquivo com `hidden`/tabs — navegação é `<a href>`
- Gate próprio com outra senha — é sempre a senha mestre, mesma chave de
  "lembrar"
- Esquecer `[hidden] { display: none !important; }`
- Cor fora de token, fonte genérica, faixa lateral de destaque
