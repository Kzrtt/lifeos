---
name: lifeos-tema
description: Cria uma paleta nova para o LifeOS nos quatro lugares que precisam concordar — tema escuro do painel, tema do blog (claro + versão escura), lista branca VALIDOS em tema.js e vitrine TEMAS em temas.js — com o conjunto completo de tokens e contraste conferido. Use para "tema novo", "paleta X", "quero o painel em tons de Y". Trigger - /lifeos-tema
---

# /lifeos-tema

Um tema só troca **cor**: nunca layout, espaçamento ou tipografia. Cada tema
tem o mesmo nome (`<slug>`) em quatro lugares, e dois deles falham em
silêncio se faltarem. Leia `docs/LIFEOS.md` §12.

| # | Arquivo | O quê | Se faltar |
|---|---|---|---|
| 1 | `assets/css/themes/lifeos/<slug>.css` | paleta **escura** do painel | a página fica na paleta embutida |
| 2 | `assets/css/themes/blog/<slug>.css` | paleta **clara** da capa + `html.dark` | a capa do archive quebra no tema |
| 3 | `VALIDOS` em `assets/js/tema.js` | lista branca | o tema **nunca é aplicado** (silencioso) |
| 4 | `TEMAS` em `assets/js/temas.js` | vitrine: nome, descrição, cores da miniatura | o tema **não aparece** na tela (silencioso) |

---

## 1. Desenhe a paleta

Pergunte (ou proponha, se o pedido for vago) uma ideia em uma frase — a
descrição de cada tema existente é assim ("quase preto, contraste alto,
acento ciano frio"). Parta do tema existente mais próximo, não do zero.

Regras de paleta:
- **Painel é escuro**, sempre. Um tema claro no painel exige tokenizar os
  overlays e sombras que ainda estão chapados nas páginas — trabalho à parte.
- Escada de superfícies com passos pequenos e constantes: `--bg` <
  `--surface` < `--surface-2`, e `--border` < `--border-mid` um degrau acima.
- `--text` / `--dim` / `--mute` legíveis sobre `--surface`: `--text` com
  contraste alto, `--dim` para texto secundário (≥ 4.5:1), `--mute` só para
  rótulos miúdos e placeholders.
- `--gold` é **o acento** do tema, não precisa ser dourado (no abismo é
  ciano). `--accent` repete o `--gold`; `--gold-wash` é ele a ~10% em `rgba`.
- `--green`, `--red`, `--blue` são semânticos (entrada/saída/saldo, feito,
  atrasado) — ajuste o tom para conversar com a paleta, mas eles precisam
  continuar lidos como verde, vermelho e azul, e distintos do acento.
- **Todos os tokens de cor em hex** (menos os `-wash`, em `rgba`): os
  gráficos leem os tokens e os convertem.

## 2. Painel — `themes/lifeos/<slug>.css`

Copie o tema mais próximo e troque **só os valores**. O conjunto inteiro é
obrigatório — um token faltando herda o do `SYSTEM SKIN` da página e mistura
duas paletas:

```css
/* Tema: <Nome> — <a frase que descreve a paleta>. */
:root {
  --bg: ; --surface: ; --surface-2: ; --border: ; --border-mid: ;
  --text: ; --dim: ; --mute: ; --text-muted: /* = --mute */;
  --gold: ; --gold-wash: /* rgba do gold a 0.10 */; --accent: /* = --gold */; --accent-dim: ;
  --green: ; --red: ; --blue: ;
}
html { background: var(--bg); }
.gate { background: radial-gradient(ellipse at 50% 28%, <surface> 0%, <bg> 72%); }
.loading-ov { background: rgba(<bg em rgb>, 0.55); }
```

## 3. Blog — `themes/blog/<slug>.css`

Os tokens da capa têm **outros nomes** (`--ink`, `--rule`, `--bg-card`…).
Copie o arquivo do blog do tema mais próximo:

- `:root` — a versão **clara** (papel): fundo claro, `--ink` escuro. O acento
  (`--gold`) é **escurecido** em relação ao do painel — o mesmo tom que brilha
  sobre fundo escuro fica ilegível sobre papel.
- `html.dark` — a **mesma paleta do painel**, traduzida para os nomes da capa
  (`--bg`, `--bg-card` = surface, `--bg-hover` = surface-2, `--ink` = text,
  `--ink-dim` = dim, `--ink-mute` = mute, `--rule` = border, `--gold`,
  `--gold-wash`, `--scrim`).

## 4. Registrar

- `tema.js` → acrescente `'<slug>'` em `VALIDOS`.
- `temas.js` → objeto novo em `TEMAS`, no fim, com `slug`, `nome` (com
  acento), `desc` (a frase) e `cores` — os mesmos hex do arquivo do painel
  (`bg`, `surface`, `surface2`, `border`, `text`, `dim`, `mute`, `gold`).
- `?v=` de `temas.js` sobe em `temas.html` (o `tema.js` entra sem versão).
- `docs/LIFEOS.md` §12 e `docs/VISUAL.md`: a lista de temas e o número.
- `assets/css/themes/lifeos/_README.md`, se citar a lista.

O tema **padrão** da instância é outra decisão (`LIFEOS_CONFIG.tema` + o
`href` estático do `<link id="lifeos-tema">` em cada página). Criar um tema
não muda o padrão, a menos que o usuário peça.

## 5. Verificar

Peça ao usuário para abrir `lifeos/temas.html` (funciona em `file://`, sem
gate), escolher o tema e percorrer: hub, Finanças (gráficos), um modal, o
gate (sair e voltar), e a capa do archive nas versões clara e escura. O que
continuar na cor antiga é cor chapada em alguma página — anote como dívida,
não "conserte" no tema.

## Nunca

- Tema que mexe em layout, fonte ou tamanho
- Arquivo de tema com parte dos tokens
- Registrar em três dos quatro lugares
- Nome de token novo inventado para o tema (a página não o lê)
