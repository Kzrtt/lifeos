# VISUAL.md — Sistema Visual do LifeOS

> Lê este arquivo inteiro antes de escrever qualquer CSS ou HTML.
> A identidade visual é o ativo mais crítico do projeto.

---

## Filosofia visual

O Archive tem duas camadas visuais distintas com estéticas próprias:

**Index (index.html):** editorial de jornal/periódico acadêmico. Papel off-white envelhecido, tipografia pesada no masthead, cards com barra lateral colorida. Sensação de publicação impressa digitalizada.

**Páginas de entrada (.html individuais):** imersivas e escuras. Fundo quase-preto com gradientes radiais sutis. Diagrama Mermaid como elemento central. Prosa narrativa abaixo. Sensação de documento vivo, mapa cognitivo em exibição.

Ambas compartilham a mesma família tipográfica e filosofia de não-genericidade.

---

## Paleta de cores

> **Não existe um conjunto canônico de nomes de variável.** Cada página declara
> o seu próprio `:root`, com os nomes que fizerem sentido ali. O que é
> compartilhado são os **valores** — a família de cores abaixo. Não tente
> "padronizar" os nomes entre páginas: a variação é intencional e mexer nisso
> significa reescrever 30 arquivos sem ganho nenhum.

### Index (`index.html`) — é a referência real

```css
:root {
  --bg:        #f5f2ec;   /* off-white envelhecido / papel aged */
  --bg-card:   #faf8f4;   /* card sobre o papel */
  --bg-hover:  #ffffff;   /* card em hover */
  --ink:       #1a1814;   /* sépia-preto — texto principal */
  --ink-dim:   #6b6456;   /* sépia médio — texto secundário */
  --ink-mute:  #b0a898;   /* sépia claro — metadados */
  --rule:      #d8d0c4;   /* linhas de pauta e bordas */
  --gold:      #c4913a;   /* dourado editorial — único accent */
  --gold-wash: rgba(196, 145, 58, 0.06);

  --ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

`legacy.html` e `galeria.html` seguem a mesma família.

### Páginas de entrada — a família, não um contrato

Fundo quase-preto, texto off-white quente, um accent (normalmente dourado) e uma
cor de borda dessaturada. Exemplos reais, para calibrar:

```css
/* pages/retrato.html */
--bg: #0e0d12;  --bg-elev: #16151c;  --ink: #e8e4dc;
--ink-dim: #a39d92;  --ink-mute: #6b6657;
--accent: #c9a96e;  --accent-soft: #8a7a52;  --line: #2a2730;  --red: #b85c5c;

/* pages/apologetica-o-ritual-que-responde.html */
--bg-void: #0D0B09;  --cream: #E8E0D4;  --cream-dim: #B8AE9E;
--gold: #C4A882;  --gold-dim: #9A8E82;
--border-soft: #2A2520;  --border-med: #3A3228;

/* pages/analise-integral.html — desvia do dourado de propósito */
--bg: #0a0e1a;  --bg-elev: #11162a;  --bg-deep: #060812;
--ink: #e0d8c8;  --ink-dim: #9a9180;  --ink-mute: #5a5468;
--violet: #8b6db5;  --violet-soft: #5d4882;  --sage: #7a9a85;  --copper: #c08a5e;
```

Os fundos ficam entre `#06` e `#11`; o texto principal em torno de `#E8E0D4`;
o accent em torno de `#C4A882`/`#c9a96e` quando é dourado. Uma entrada pode
trocar a família de accent inteira se o conteúdo pedir (`o-amante` usa vermelho
`#c44a3f`), desde que o fundo escuro e o contraste se mantenham.

### A exceção clara

`pages/sete-leituras-manifesto.html` é uma entrada de **fundo claro**
(`--bg: #f1ede1`), com uma cor por modelo de IA comparado (`--c-kimi`,
`--c-gemini`, `--c-deepseek`, `--c-gpt`). Foi decisão de conteúdo, não descuido.
A regra "fundo escuro nas páginas de entrada" é forte, mas não é absoluta — se
for quebrar, que seja por um motivo tão explícito quanto esse.

---

## Tipografia

### O trio base (sempre via Google Fonts)
```
Playfair Display — títulos, masthead, headings de seção
EB Garamond      — corpo de texto, prosa narrativa
JetBrains Mono   — tags, labels técnicos, datas, metadados
```

É o conjunto do `index.html` e o default de qualquer entrada nova.

### Fontes de exceção já em uso

Uma entrada pode trocar o trio se a personalidade da página pedir. Já aconteceu,
e são precedentes válidos — não são erros para "corrigir":

| Fonte | Onde |
|---|---|
| Cormorant Garamond | `retrato`, `piramide`, `o-amante`, `o-observador`, `login.html`, `admin/` |
| Fraunces | `sistema-operacional`, `sete-leituras-manifesto`, `profissional.html` |
| Cinzel / Cinzel Decorative | `analise-integral`, `piramide` |
| Fira Code | `login.html`, `o-amante`, `o-observador` |
| DM Serif Display | `imaginacao-ativa` |
| Space Mono | `profissional.html` |
| IBM Plex Sans / Plus Jakarta / Inter | `jogo.html`, `sete-leituras-manifesto`, `planejamento-financeiro` |

A última linha é a que merece cuidado: **sans genérica só entra quando a página
está citando outro contexto** (a comparação entre modelos de IA em
`sete-leituras`, a UI do joguinho). Em prosa do archive, nunca.

### Classes reais no index (`index.html`)

Não existe uma folha de estilo compartilhada — as classes abaixo vivem no
`<style>` do próprio `index.html`:

```
.masthead  .masthead-rule  .masthead-about  .dateline  .dateline-right
.cards  .card  .card--featured  .card-rim  .card-main  .card-body
.card-title  .card-desc  .card-category  .card-tags  .card-meta
.card-date  .card-date-l  .card-glyph  .card-arrow
```

### Nas páginas de entrada

**Cada entrada nomeia as suas próprias classes.** Não existe um vocabulário
comum de `.page-title` / `.section-heading` / `.body-text` — versões anteriores
deste doc listavam essas classes, e elas não existem em nenhum arquivo do
projeto. O que se repete de fato é a estrutura semântica (`<header>` com
categorias + `<h1>` + subtítulo + tags, depois diagrama, depois narrativa em
`<h2>`/`<p>`) — ver [`PAGE_TEMPLATE.md`](PAGE_TEMPLATE.md) para o esqueleto e
`pages/apologetica-o-ritual-que-responde.html` como exemplo recente.

---

## Mermaid.js — configuração obrigatória

Sempre `theme: 'base'` + `themeVariables` apontando para a paleta **daquela
página**. Nunca o tema default, e nunca `theme: 'dark'` cru (duas páginas antigas
ainda usam — não replique).

CDN com versão pinada, igual em todas as páginas:

```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js"></script>
```

Exemplo real (`pages/retrato.html`) — os hex saem das variáveis da própria página:

```javascript
mermaid.initialize({
  startOnLoad: true,
  theme: 'base',
  themeVariables: {
    darkMode: true,
    background:         '#16151c',   /* --bg-elev */
    primaryColor:       '#1c1a26',
    primaryTextColor:   '#e8e4dc',   /* --ink */
    primaryBorderColor: '#8a7a52',   /* --accent-soft */
    lineColor:          '#6b6657',   /* --ink-mute */
    secondaryColor:     '#201a26',
    tertiaryColor:      '#1a2018',
    fontFamily: 'Cormorant Garamond, serif',
    fontSize: '14px'
  },
  flowchart: {
    curve: 'basis',
    padding: 20,
    nodeSpacing: 40,
    rankSpacing: 60,
    htmlLabels: true
  }
});
```

`darkMode: true` e `fontFamily` casando com a fonte de corpo da página são o que
impede o diagrama de destoar do resto. Numa página de fundo claro (ver a exceção
acima), `darkMode` sai e os hex invertem.

O diagrama deve ser envolvido em um container com scroll horizontal para mobile:
```html
<div class="diagram-wrapper">
  <div class="mermaid">
    <!-- diagrama aqui -->
  </div>
</div>
```

```css
.diagram-wrapper {
  overflow-x: auto;
  padding: 2rem 0;
  margin: 2rem -1rem;
}
.diagram-wrapper .mermaid {
  min-width: 600px;
}
```

---

## Cards do index — padrão visual

Cada card tem uma borda/accent colorida que varia por tema da entrada. A cor **não** vem de um CSS attribute selector — vem de um mapa JS (`THEME_ACCENTS`) que resolve `entry.theme` para um hex e injeta via custom property inline: `style="--accent: <hex>"`. O CSS consome `var(--accent, var(--gold))`.

O mapa existe **em duas cópias que precisam ser mantidas iguais à mão**: inline
no `index.html` e em `assets/js/index.js` (usado por `legacy.html`) — mais o
legend visual em `admin/index.html`, que é uma terceira cópia dos mesmos hex.

```js
var THEME_ACCENTS = {
  identidade: '#8b3a3a',  // vermelho terroso
  psicodelia: '#3a5c8b',  // azul
  metodo:     '#3a7a5c',  // verde
  ciencia:    '#7a5c3a',  // marrom dourado
  sombra:     '#c44a3f',  // vermelho-alaranjado
  persona:    '#5a6b7a',  // azul-acinzentado
  umwelt:     '#38408b',  // azul índigo
  onirico:    '#5c3a8b',  // violeta
  eros:       '#8b3a6b',  // rosa-magenta
  vestigio:   '#2f7d8b',  // verde-azulado (teal)
};
```

A cor do card é definida pelo campo `theme` no `manifest.json`. Um `theme` que não bate com nenhuma chave cai no fallback `identidade` (vermelho) silenciosamente — ver lista completa e legend visual em [`MANIFEST.md`](MANIFEST.md#valores-válidos-para-theme) e `/admin`.

---

## Linha do tempo — visual

Quando o toggle de linha do tempo está ativo, os cards são reordenados e um eixo vertical aparece à esquerda:

```
│
●  Abr 2026 — Retrato em alta resolução
│
●  10 Abr 2026 — Análise Integral
│
●  Mai 2026 — O Sistema Operacional
│
●  04 Mai 2026 — Imaginação Ativa
```

O eixo usa `--rule` como cor. Os pontos (●) usam a cor de accent do card correspondente. A transição entre visualizações usa `opacity` + `transform` com `transition: all 0.35s ease`.

A preferência de visualização fica em `localStorage` na chave `psyches_view`.

---

## Animações e transições

- Page load: fade-in dos elementos principais com `animation-delay` escalonado (0ms, 100ms, 200ms...)
- Hover em cards: `transform: translateX(4px)` suave, sem escala
- Toggle linha do tempo: reordenação com fade (não usar reflow abrupto)
- Nenhuma animação deve durar mais de 400ms
- `prefers-reduced-motion` deve desativar todas as animações

---

## O que nunca fazer

- Usar `font-family: Inter, Roboto, Arial` ou `system-ui` em prosa do archive (a exceção documentada na seção de Tipografia vale só quando a página cita outro contexto — nunca é o default)
- Usar `background: purple` ou gradientes roxo/rosa em fundo branco
- Usar `border-radius` maior que 4px nos cards (quebra a estética editorial)
- Usar sombras com `box-shadow` pesadas — o projeto usa bordas e espaço, não profundidade artificial
- Centralizar o texto principal — alinhamento à esquerda em todo o corpo de texto

---

## Ícones — a regra depende de onde você está

**No archive** (index, `pages/`, `galeria`, `qui-videti`): sem biblioteca de
ícones. Usa emoji (o campo `icon` do manifest), Unicode (`●`, `←`, `→`, `✦`) ou
SVG inline. Uma entrada nunca carrega o Font Awesome.

**No LifeOS** (`lifeos.html`, `financas.html`, `tarefas.html`, `eventos.html`):
usa **Font Awesome Pro duotone**, classes `fad fa-*`. É uma interface de
aplicação, não uma peça editorial — emoji não dá conta de um kanban.

```html
<link rel="stylesheet" type="text/css" href="assets/css/font-awesome-pro-master.min.css?v=20260723">
...
<i class="fad fa-chart-line"></i>
```

Os webfonts vivem em `assets/webfonts/` e o CSS em `assets/css/` — é a única
folha de estilo em arquivo do projeto, e é biblioteca de terceiros. Ao pedir um
ícone novo no LifeOS, prefira `fad fa-` (duotone) para manter a consistência com
os que já estão lá.
