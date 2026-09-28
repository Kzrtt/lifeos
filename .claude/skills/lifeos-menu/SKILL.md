---
name: lifeos-menu
description: Acrescenta ou reorganiza pontos de navegação do LifeOS — item no menu lateral (drawer) do hub, atalho no quicknav do masthead, ou botão de ação no cabeçalho de uma hero-section — no markup e comportamento padrão. Use para "botão novo no menu", "link pra tela X", "atalho no topo", "reorganizar o menu". Trigger - /lifeos-menu
---

# /lifeos-menu

O LifeOS tem três lugares de navegação, e cada um tem um papel. Escolher o
lugar certo é metade da tarefa.

| Lugar | Onde | Para quê | Exemplo |
|---|---|---|---|
| **Drawer** | `<aside id="config-drawer">` em `lifeos.html`, aberto pelo ☰ | telas de **contexto, configuração e ajuda** | Memória, Tags, Temas, MCP |
| **Quicknav** | `<nav class="hub-quicknav">` no masthead do hub | pular para uma **seção do hub** ou para um **módulo principal** | Finanças, Tarefas, Notas |
| **Cabeçalho de seção** | `.hero-head` de uma `.hero-section` | ação **daquela área**: criar, abrir a página própria, alternar modo | "Adicionar", "Abrir →" |

Um módulo de uso diário não vai para o drawer; uma tela de configuração não
vai para o quicknav.

---

## Drawer

Só existe no hub. As outras páginas têm um botão de sair direto na topbar e
voltam ao hub pelo link "← lifeos".

Grupos atuais, nesta ordem: **Contexto** (dado sobre o usuário) →
**Configuração** → **Ajuda** → Sair. Encaixe no grupo que corresponde ao
assunto; um grupo novo só com pelo menos dois itens ou um motivo claro
(Contexto nasceu com um item só porque memória é dado, não configuração — e
isso está num comentário no HTML).

```html
<a class="drawer-item" href="<pagina>.html">
  <i class="fad fa-<icone>"></i>
  <span><Nome><span class="drawer-item-sub"><o que tem lá, em minúsculas, curto></span></span>
</a>
```

- Todo item é `<a href>` para uma página própria — **nunca** um botão que
  troca conteúdo por JS. O único `<button>` do drawer é o Sair.
- Subtítulo: 2 a 5 palavras, minúsculas, dizendo o que o usuário encontra.
- Item que só faz sentido com o blog ligado recebe `data-requer-blog` —
  `blog.js` o esconde quando `LIFEOS_CONFIG.blog.habilitado` é `false`.
- Item desabilitado temporariamente: `.is-disabled` (não remova do HTML sem
  pedido).
- A página de destino precisa existir (`/lifeos-pagina`) e ter o link de volta
  `<a href="lifeos.html" class="back">`.

## Quicknav

```html
<!-- rola até uma seção do hub -->
<button type="button" data-jump="hero-<modulo>"><i class="fad fa-<icone>"></i> <Nome></button>
<!-- módulo que não tem seção no hub pra rolar até ele -->
<a href="<modulo>.html"><i class="fad fa-<icone>"></i> <Nome></a>
```

- `data-jump` já funciona sozinho: o listener em `lifeos.js` pega todo
  `.hub-quicknav button[data-jump]`, sai do modo foco de Manifestações e rola
  até o `id`. **Não** escreva listener novo para ele.
- O `id` do `data-jump` é o da `<section class="hero-section">`.
- Ordem do quicknav = ordem das seções na página, com o botão especial de
  Manifestações (modo foco) por último.
- Máximo de ~6 itens: é uma linha só no desktop. Passando disso, discuta com o
  usuário o que sai.
- Não duplique a primeira seção (Calendário), que já está logo abaixo.

## Cabeçalho de seção

```html
<button type="button" class="hero-link" id="add-<modulo>-btn">Adicionar <i class="fad fa-plus"></i></button>
<a class="hero-link" href="<modulo>.html">Abrir <i class="fad fa-arrow-right"></i></a>
```

- Texto + ícone **à direita** do texto, sempre `.hero-link`.
- Mais de uma ação: dentro de `<div class="hero-head-actions">`, que empilha
  no celular.
- Alternar modo de visualização da seção: o toggle `.tar-chart-toggle` (ver
  `#cal-mode-toggle`), não dois botões soltos.

## Ícones

Um `fa-*` por item, sem repetir o de outro item do mesmo menu. Se existir
`assets/css/icons.css`, o ícone precisa estar lá (ou ganhar a entrada, com o
codepoint FA5 Free Solid, em ordem alfabética).

## Reorganizar

Mover itens entre grupos ou mudar a ordem é permitido, mas:
- mantenha os `href`/`id` (links salvos e `data-jump` dependem deles);
- se o `LIFEOS.md` §11 ou §3.1 descreve a ordem, atualize.

## Fechamento

- Não há JS a mudar no caso comum — só HTML. Se mudou JS, suba o `?v=`.
- Diga ao usuário o que conferir: o item aparece, leva ao lugar certo, e a
  página de destino volta ao hub.
- `/lifeos-revisar`.

## Nunca

- Tela "trocada por JS" a partir do drawer
- Item de configuração no quicknav, ou módulo diário no drawer
- Listener novo para `data-jump`
- Drawer em outra página além do hub
