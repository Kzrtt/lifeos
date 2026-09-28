---
name: lifeos-hero-section
description: Acrescenta uma hero-section nova ao hub do LifeOS (`lifeos/lifeos.html` + `assets/js/lifeos.js`) ou um card novo dentro de uma seção existente — markup `.hero-section`/`.bento-card`, grid bento responsivo, busca no boot, cache local do hub, render, reset no logout. Use para qualquer pedido de "mostrar X no painel principal", "um card com Y no hub", "uma área nova na tela inicial". Trigger - /lifeos-hero-section
---

# /lifeos-hero-section

O hub é a tela de pouso — um dashboard de seções, cada uma com seus cards.
Esta skill cobre dois pedidos:

- **A. Seção nova** — uma área inteira (ícone + título + ações + grid de cards)
- **B. Card novo** numa seção que já existe

Leia antes: `docs/LIFEOS.md` §3.2 (hero-sections e bento), §3.5 (boot e
cache) e, como exemplo completo de seção nativa com CRUD, as partes de
**Citações** e **Projetos** em `lifeos.html` e `lifeos.js`.

---

## Regras de forma (valem para A e B)

- `.hero-section` **não é card**: sem fundo, sem borda, sem padding de
  contêiner. Ela agrupa um `.hero-head` e um grid de `.bento-card`s soltos. A
  separação entre seções é automática (`.hero-section + .hero-section` ganha
  o divisor duplo) — não acrescente borda.
- O card é `.bento-card`. Semântica positiva/negativa usa `.tint-pos` /
  `.tint-neg` (wash de fundo), **nunca** borda colorida nem faixa lateral.
- Todo card tem `.bento-card-label` com um ícone `fad fa-*` antes do texto.
  Número de destaque: `.bento-big-val` (+ `.pos`/`.neg`); linha de apoio:
  `.bento-sub`.
- O grid é próprio da seção (`.<pfx>-bento`), com `grid-template-areas`
  nomeadas, e cards de tamanhos variados quando fizer sentido. Cards que
  dividem uma linha têm a **mesma altura** (o `stretch` padrão do grid —
  nunca altura por conteúdo).
- Responsivo com os breakpoints do hub: `780px` (duas colunas) e `480px`
  (uma coluna), redefinindo `grid-template-areas`. Ver `.fin-bento`.
- Lista longa dentro de card rola por dentro (`.hub-list .hub-list-scroll`),
  não corta em N itens. Lista vazia: `.hub-list-empty` com uma frase.
- Módulo que ainda não tem dado nenhum aparece como **ghost preview**
  ilustrado (`LIFEOS.md` §3.3), nunca como seção vazia de texto.
- Prefixo de classe curto e exclusivo da seção (`fin-`, `tar-`, `not-`,
  `cit-`) — o CSS dela fica agrupado num bloco comentado no `<style>`.

---

## A. Seção nova

### A1. Onde ela entra

Pergunte a posição se não for óbvia. A ordem atual está em `lifeos.html`
(Calendário → Finanças → Tarefas → Projetos → Notas → Manifestações por
último, que tem modo foco). Uma seção nova **não** vai depois de
Manifestações.

Decida também o modo de escrita (`LIFEOS.md` §1):
- **só leitura** + botão "Abrir" para a página própria do módulo;
- **nativa** — CRUD ali mesmo, por modal (`/lifeos-modal`);
- **híbrida** — as duas coisas (caso de Tarefas).

Finanças e Notas continuam só leitura no hub, sempre.

### A2. Markup (`lifeos.html`)

```html
<!-- <O que a seção mostra, e por que no hub. Ver LIFEOS.md §N.> -->
<section class="hero-section" id="hero-<modulo>">
  <div class="hero-head">
    <div class="hero-icon"><i class="fad fa-<icone>"></i></div>
    <div class="hero-title"><Nome></div>
    <!-- ações: botão que abre modal, ou link pra página própria -->
    <button type="button" class="hero-link" id="add-<modulo>-btn">Adicionar <i class="fad fa-plus"></i></button>
    <a class="hero-link" href="<modulo>.html">Abrir <i class="fad fa-arrow-right"></i></a>
  </div>
  <div class="<pfx>-bento">
    <div class="bento-card <pfx>-card-<nome>">
      <div class="bento-card-label"><i class="fad fa-<icone>"></i> <Rótulo></div>
      <div class="bento-big-val" id="<pfx>-<valor>">—</div>
      <div class="bento-sub" id="<pfx>-<valor>-sub"></div>
    </div>
    <!-- … -->
  </div>
</section>
```

Placeholder dos valores é `—` até o render. Várias ações no cabeçalho vão
num `.hero-head-actions`.

### A3. Dados (`lifeos.js`)

Siga o caminho de Citações, que é o mais recente e completo. Cada item abaixo
é um lugar do arquivo; **pular um deles é o bug clássico desta skill**:

1. **Config** — `var <X>_FN = FN_BASE + 'lifeos-<modulo>';` junto das outras.
2. **Estado** — `var <X> = [];` na seção `Estado`.
3. **Mock** — `MOCK_<X>` + `mock<X>(body)` na seção de dev mock, com dados
   genéricos e as mesmas respostas/erros da Edge Function.
4. **API** — `api<X>(pw, body)`: um helper por domínio, no molde de
   `apiCitacoes` (ramo `IS_LOCAL_DEV`; `401` → `{code:'unauthorized'}`;
   resto → `{code:'server', detail}`).
5. **Boot** — acrescente a chamada ao `Promise.all` de `fetchAllHubDados()` e
   a atribuição no `.then`. Se a seção é **opcional** (uma instalação antiga
   pode não ter a function ainda), a chamada leva
   `.catch(function () { return { <plural>: [] }; })` — sem isso, a falta da
   function derruba o hub inteiro.
6. **Cache** — o campo entra em `writeHubCache()` e em
   `hydrateFromHubCache()`, e **`HUB_CACHE_V` sobe um número** com comentário
   (`/* bump: cache ganhou o campo <x> */`). Decida se o dado é "eterno até ↻"
   (padrão) ou se re-busca a cada boot mesmo com cache (caso de Citações, que
   também chegam pelo MCP) — e documente a escolha.
7. **Escrita** — todo create/update/delete bem-sucedido muta o array em
   memória, chama `writeHubCache()` e re-renderiza só a seção.
8. **Render** — `render<X>()` numa seção comentada própria
   (`/* ── <X>: … ── */`), chamada de `renderAllHub()`.
9. **Logout** — `onLogout()` zera o estado da seção, fecha os modais dela e
   reseta filtros.
10. **Listeners** — no `init()`, junto dos outros.

### A4. Navegação

- Atalho no quicknav, se fizer sentido: `/lifeos-menu`.
- O modo foco de Manifestações já esconde qualquer `.hero-section` que não
  seja a dela — nada a fazer.

## B. Card novo numa seção existente

1. Ache o grid da seção (`.fin-bento`, `.tar-bento`, `.not-bento`…) e a
   função que o renderiza (`render<X>Preview`).
2. Acrescente o card ao markup **e** uma área nova em **todas** as versões de
   `grid-template-areas` da seção (desktop, `780px`, `480px`). Esquecer um
   breakpoint deixa o card fora do grid naquela largura.
3. Calcule o valor a partir do estado que **já está em memória** — o hub já
   buscou tudo no boot. Busca extra só se o dado não existir, e aí vale a A3
   inteira (boot, cache, `HUB_CACHE_V`).
4. Regra de negócio copiada de outra página (ex.: fatura de `financas.js`) é
   cópia **integral**, com comentário apontando a origem. Existe uma terceira
   cópia no MCP para Finanças — ver `docs/FINANCAS.md` §9.1.
5. Gráfico dentro do card: `/lifeos-grafico`.

---

## Fechamento

- `?v=` do `lifeos.js` sobe no `lifeos.html`.
- `docs/LIFEOS.md` §3.2: a seção nova (ou o card) na lista, com a decisão de
  leitura/escrita e de cache.
- `/lifeos-revisar`.
- Diga ao usuário o que conferir: a seção em `file://` com dados de mock, as
  três larguras, e um ↻ depois de uma escrita.

## Nunca

- Dar fundo ou borda à `.hero-section`
- Escrita de Finanças ou Notas no hub
- Mudar o formato do cache sem subir `HUB_CACHE_V`
- Buscar de novo no render o que já veio no boot
- Pôr código de um módulo dentro da seção de outro em `lifeos.js`
