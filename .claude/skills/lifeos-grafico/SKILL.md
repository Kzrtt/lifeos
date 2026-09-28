---
name: lifeos-grafico
description: Acrescenta um gráfico Chart.js a uma página do LifeOS (hub ou página de módulo) no padrão visual do painel — contêiner com estado vazio, cores lidas dos tokens do tema, tooltip e fontes do sistema, ciclo destroy/recreate, hover que funciona. Use para qualquer pedido de gráfico, evolução, distribuição, comparação ou "visualizar" dados no LifeOS. Trigger - /lifeos-grafico
---

# /lifeos-grafico

Gráficos do LifeOS são Chart.js `4.4.6` pelo CDN, desenhados em `<canvas>`.
Chart.js **não lê `var(--token)`** — por isso a maior parte desta skill é
sobre cor.

Exemplos no repositório:
- barras horizontais: `renderNotasBarChart()` em `assets/js/lifeos.js`
- linha com área e hover: gráfico de saldo em `renderFinancasPreview()` (hub)
  e `renderSaldo()` em `assets/js/financas.js`
- rosca clicável com toggle de modo: `renderDonut()` em `financas.js`
- helpers de estilo reaproveitados na página: `baseTooltip()`, `legendCfg()`,
  `moneyScales()` em `financas.js`

---

## 1. Escolha o tipo pelo que a pergunta pede

| A pergunta | Tipo | Detalhe |
|---|---|---|
| Como X evoluiu no tempo? | `line` | `tension: 0.25`, área com `fill: true` e cor a ~12% |
| Quanto de cada categoria? (muitas categorias, rótulos longos) | `bar` com `indexAxis: 'y'` | top N (≈8), ordenado desc |
| Comparar poucos grupos por período | `bar` vertical, datasets lado a lado | `maxBarThickness: 22`, `borderRadius: 3` |
| Parte de um todo, até ~6 fatias | `doughnut` | `cutout: '58%'`, legenda embaixo |

Não use pizza cheia, 3D, radar ou gráfico duplo-eixo. Um número sozinho não é
gráfico — é um `.bento-big-val`.

## 2. Markup

O canvas mora num contêiner de altura definida, com um estado vazio por cima:

```html
<!-- hub -->
<div class="hub-chart-wrap">
  <canvas id="<pfx>-chart-<nome>"></canvas>
  <div class="hub-chart-empty" id="<pfx>-chart-<nome>-empty" hidden>sem dados ainda</div>
</div>
```

Nas páginas de módulo a classe é `.chart-wrap` / `.chart-empty` (ver
`financas.html`, `tarefas.html`). Se a página ainda não tem essas regras,
copie-as de lá. A altura vem do CSS do contêiner — `maintainAspectRatio:
false` depende disso.

A página precisa carregar o Chart.js **antes** do próprio JS:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
```

## 3. Cor: leia os tokens do tema na hora de desenhar

O painel tem nove temas. Cor chapada num gráfico fica errada em oito deles.
Leia os tokens do `<html>` **no momento do render** (não no carregamento do
módulo — o tema pode ainda não ter aplicado), como `lifeos/index.html` já faz
para os diagramas Mermaid:

```js
/* Tokens do tema ATIVO — Chart.js não entende var(). Lido a cada render,
   então o gráfico acompanha a paleta escolhida em Temas. */
function tok(nome, fb) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || fb;
}
/* Translúcido a partir de um token hex (#rrggbb). Não use color-mix() aqui:
   o Chart.js interpreta as cores sozinho (pra derivar o hover) e não
   entende essa sintaxe. */
function alpha(hex, a) {
  var h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  var n = parseInt(h, 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
```

| Papel no gráfico | Token |
|---|---|
| série principal / neutra | `--gold` |
| positivo / entrada / feito | `--green` |
| negativo / saída / atrasado | `--red` |
| terceira série, saldo | `--blue` |
| texto dos eixos e da legenda | `--dim` |
| grade | `--border` |
| fundo do tooltip / borda | `--surface-2` / `--border` |
| texto do tooltip | `--text` |
| borda entre fatias da rosca | `--surface` |

Área e fundo translúcidos: `alpha(tok('--blue', '#5b8def'), 0.12)`. Os tokens
de cor dos temas são todos hex; `--gold-wash` já é `rgba` e não passa pelo
`alpha()`.

**Cores categóricas** (uma por tipo, por projeto…): se o vocabulário tem cor
própria (`evento_tipo`), use a do banco. Senão, uma paleta fixa de hex
distinguíveis entre si — é a única exceção aceita a "tudo é token", porque
as categorias precisam se diferenciar independentemente do tema (precedentes:
`NOT_TIPO_COR_PALETTE` em `lifeos.js`, `ORIGENS` em `memoria.js`). Atribua a
cor **por posição no vocabulário**, para ela sobreviver a um rename.

> Os gráficos antigos do hub e de Finanças ainda têm a paleta sépia chapada
> em hex. É dívida conhecida — não a copie para gráfico novo, e só migre os
> antigos se o usuário pedir.

## 4. Opções base

```js
if (<X>_CHART) { <X>_CHART.destroy(); <X>_CHART = null; }
var hasData = data.length > 0;
$('<id>-empty').hidden = hasData;
$('<id>').style.display = hasData ? '' : 'none';
if (!hasData || !window.Chart) return;

<X>_CHART = new Chart($('<id>'), {
  type: '…',
  data: { … },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
    interaction: { mode: 'index', intersect: false },   // line e bar agrupado
    scales: {
      x: { grid: { color: tok('--border', '#2e2a24'), drawBorder: false },
           ticks: { color: tok('--dim', '#b0a898'), font: { family: MONO, size: 10 } } },
      y: { … mesmo … , ticks: { …, precision: 0 } },     // contagens inteiras
    },
    plugins: {
      legend: { display: false },                        // ou legendCfg() com várias séries
      tooltip: {
        backgroundColor: tok('--surface-2', '#242018'), borderColor: tok('--border', '#2e2a24'), borderWidth: 1,
        titleColor: tok('--text', '#ede8df'), bodyColor: tok('--text', '#ede8df'),
        titleFont: { family: MONO, size: 11 }, bodyFont: { family: MONO, size: 12 }, padding: 10,
        callbacks: { label: function (c) { return ' ' + /* valor formatado + unidade */; } },
      },
    },
  },
});
```

Regras:
- **Uma variável de estado por gráfico** (`<X>_CHART`), e `destroy()` antes de
  recriar — senão o canvas acumula instâncias e o hover pisca.
- `Chart.defaults.font.family = "'JetBrains Mono', monospace"` já é setado no
  boot das páginas que têm gráfico; página nova com gráfico faz o mesmo.
- **Linha com `pointRadius: 0` precisa de `interaction: {mode:'index',
  intersect:false}`** — sem isso o tooltip quase nunca aparece.
- Rótulo do tooltip sempre com unidade e plural certo (`1 nota`, `3 notas`);
  dinheiro pelo mesmo formatador da página (`brl.format`).
- Estado vazio com frase específica ("sem movimentação este mês"), nunca um
  eixo vazio.
- Clicável? `onHover` troca o cursor e `onClick` abre o detalhe (modal) — e o
  tooltip ganha um `footer` dizendo isso ("toque para ver…").
- Filtro que recorta uma lista **não** recorta o gráfico de agregado ao lado,
  a menos que o usuário peça: agregados refletem o todo.

## 5. Alternar o que o gráfico mostra

Várias leituras do mesmo dado (entradas / saídas / ambos) usam o toggle
segmentado que já existe — `.tar-chart-toggle` + `.tar-chart-toggle-btn` com
`.is-active` (ver o toggle do calendário no hub e o da rosca de Finanças). Não
invente outro componente de abas.

## 6. Fechamento

- Re-render do gráfico onde os dados mudam (depois de escrita e no ↻), sem
  refazer fetch.
- `?v=` do JS da página sobe.
- Diga ao usuário para conferir: com dados, sem dados, em dois temas
  diferentes, e o hover.
- `/lifeos-revisar`.

## Nunca

- Hex chapado para cor que tem token
- Criar `new Chart` sem destruir a instância anterior
- Canvas sem contêiner de altura definida (o gráfico cresce sem parar)
- Biblioteca de gráfico diferente do Chart.js
