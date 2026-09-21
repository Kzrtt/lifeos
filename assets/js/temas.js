/* temas.js — tela de temas do LifeOS (lifeos/temas.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * DUAS COISAS DIFERENTES, DE PROPÓSITO NA MESMA TELA:
 *
 *   1. TEMAS DO PAINEL — a paleta das páginas do LifeOS. São arquivos em
 *      `assets/css/themes/lifeos/`, trocáveis aqui. Funciona de verdade.
 *   2. PALETA DOS CARDS DO ARCHIVE — o campo `theme` do manifest, que define
 *      só a cor da barra lateral do card no index. Aqui é só REFERÊNCIA: o
 *      mapa está chapado em três arquivos e mudar exige commit. Ver a nota
 *      na própria tela.
 *
 * SEM BACKEND E SEM GATE. A escolha vive no localStorage deste navegador
 * (`lifeos_tema`), escrita via `window.LIFEOS_TEMA` — a API exposta por
 * `assets/js/tema.js`, que é quem de fato aplica o tema. Este arquivo só
 * desenha a tela e chama aquela API.
 *
 * Como não há rede, esta página funciona igual em produção, em localhost e em
 * `file://` — não precisa da camada de mock que `senhas.js` e `publicar.js`
 * carregam.
 */
(function () {
  'use strict';

  /* Catálogo dos temas. Manter em sincronia com a lista branca VALIDOS no topo
     de `assets/js/tema.js` — lá é segurança (o valor vem do localStorage),
     aqui é a vitrine. Um tema listado só aqui não é aplicável; listado só lá,
     fica invisível nesta tela. */
  var TEMAS = [
    {
      slug: 'sepia',
      nome: 'Sépia',
      desc: 'Pergaminho envelhecido e ouro velho. A paleta original do archive.',
      cores: { bg: '#14120f', surface: '#1c1a16', surface2: '#242018', border: '#2e2a24',
               text: '#ede8df', dim: '#b0a898', mute: '#6b6456', gold: '#c4913a' },
    },
    {
      slug: 'noite',
      nome: 'Noite',
      desc: 'Azul-frio. A paleta que o painel tinha antes da reskin sépia.',
      cores: { bg: '#0c0e12', surface: '#14171d', surface2: '#1b1f27', border: '#262b34',
               text: '#e7e9ee', dim: '#9aa3b2', mute: '#5d6675', gold: '#c9a96e' },
    },
    {
      slug: 'carvao',
      nome: 'Carvão',
      desc: 'Grafite neutro, sem viés de matiz. Acento âmbar dessaturado.',
      cores: { bg: '#121212', surface: '#1a1a1a', surface2: '#222222', border: '#2c2c2c',
               text: '#e8e8e8', dim: '#a6a6a6', mute: '#6a6a6a', gold: '#b89b6a' },
    },
    {
      slug: 'floresta',
      nome: 'Floresta',
      desc: 'Verde profundo com acento de latão.',
      cores: { bg: '#0e1411', surface: '#151d19', surface2: '#1c2621', border: '#263129',
               text: '#e4ebe6', dim: '#a2b1a7', mute: '#5f6f65', gold: '#b9a05a' },
    },
    {
      slug: 'ardosia',
      nome: 'Ardósia',
      desc: 'Azul-acinzentado frio, acento gelo. O mais sóbrio do conjunto.',
      cores: { bg: '#10141a', surface: '#171d25', surface2: '#1f2630', border: '#2a323d',
               text: '#e3e8ee', dim: '#9fadbd', mute: '#5e6b7a', gold: '#7fa8cc' },
    },
    {
      slug: 'vinho',
      nome: 'Vinho',
      desc: 'Bordô profundo com acento rosé. Quente sem ser sépia.',
      cores: { bg: '#17100f', surface: '#1f1616', surface2: '#291d1d', border: '#352525',
               text: '#efe3e1', dim: '#bda3a0', mute: '#755b59', gold: '#c77d7d' },
    },
    {
      slug: 'indigo',
      nome: 'Índigo',
      desc: 'Roxo-azulado noturno com acento lavanda.',
      cores: { bg: '#12111c', surface: '#1a1826', surface2: '#232031', border: '#2e2b40',
               text: '#e6e3f0', dim: '#a8a2c0', mute: '#645e7d', gold: '#a58ed6' },
    },
    {
      slug: 'cobre',
      nome: 'Cobre',
      desc: 'Marrom-avermelhado terroso, acento de cobre oxidado.',
      cores: { bg: '#16110d', surface: '#1e1813', surface2: '#27201a', border: '#342a22',
               text: '#eee4d8', dim: '#bca894', mute: '#766451', gold: '#cc7f4f' },
    },
    {
      slug: 'abismo',
      nome: 'Abismo',
      desc: 'Quase preto, contraste alto, acento ciano. Para ambiente sem luz.',
      cores: { bg: '#08090b', surface: '#0e1013', surface2: '#15181c', border: '#1f2329',
               text: '#f0f2f5', dim: '#a4adb8', mute: '#5a636e', gold: '#57b8c4' },
    },
  ];

  /* Paleta dos cards do archive — cópia do THEME_ACCENTS de index.html.
     Quarta cópia no projeto (index.html, assets/js/index.js, publicar.js e
     esta). Exibida só como referência; ver a nota na tela. */
  var THEME_ACCENTS = {
    identidade: '#8b3a3a', psicodelia: '#3a5c8b', metodo: '#3a7a5c',
    ciencia:    '#7a5c3a', sombra:     '#c44a3f', persona: '#5a6b7a',
    umwelt:     '#38408b', onirico:    '#5c3a8b', eros:    '#8b3a6b',
    vestigio:   '#2f7d8b',
  };

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  /* `tema.js` é quem aplica e persiste — esta tela nunca toca no localStorage
     nem no <link> diretamente. Se ele não carregou, a tela vira só leitura em
     vez de falhar silenciosamente ao clicar. */
  var TEMA_API = window.LIFEOS_TEMA || null;

  /* Miniatura pintada com as cores do PRÓPRIO tema (inline, não var()) — uma
     amostra que usasse var() mostraria o tema atual em todos os cards. */
  function previewHtml(t) {
    var c = t.cores;
    return '<div class="tema-preview" style="background:' + c.bg + '">'
      + '<div class="tema-preview-dot" style="background:' + c.surface2 + ';color:' + c.gold + '">✦</div>'
      + '<div class="tema-preview-lines">'
        + '<div class="tema-preview-line" style="background:' + c.text + ';width:62%"></div>'
        + '<div class="tema-preview-line" style="background:' + c.dim + ';width:84%"></div>'
        + '<div class="tema-preview-line" style="background:' + c.mute + ';width:48%"></div>'
      + '</div>'
      + '<div class="tema-preview-bar" style="background:' + c.surface + '"></div>'
      + '<div class="tema-preview-bar" style="background:' + c.border + '"></div>'
      + '<div class="tema-preview-bar" style="background:' + c.gold + '"></div>'
      + '</div>';
  }

  function cardHtml(t, atual, padraoDaInstancia) {
    var badges = '';
    if (t.slug === atual) badges += '<span class="tema-badge ativo">em uso</span>';
    if (t.slug === padraoDaInstancia) badges += '<span class="tema-badge padrao">padrão da instância</span>';

    return '<button type="button" class="tema-card' + (t.slug === atual ? ' is-active' : '') + '"'
      + ' data-tema="' + esc(t.slug) + '"'
      + ' aria-pressed="' + (t.slug === atual) + '">'
      + previewHtml(t)
      + '<div class="tema-info">'
        + '<div class="tema-nome">' + esc(t.nome) + '</div>'
        + '<div class="tema-desc">' + esc(t.desc) + '</div>'
        + '<div class="tema-badges">' + badges + '</div>'
      + '</div>'
      + '</button>';
  }

  function padraoInstancia() {
    var cfg = window.LIFEOS_CONFIG;
    return (cfg && cfg.tema) ? cfg.tema : 'sepia';
  }

  function render() {
    var atual = TEMA_API ? TEMA_API.atual() : padraoInstancia();
    var padrao = padraoInstancia();

    $('tema-grid').innerHTML = TEMAS.map(function (t) {
      return cardHtml(t, atual, padrao);
    }).join('');

    /* O botão de reset só faz sentido quando existe um override local. */
    var btn = $('reset-btn');
    btn.disabled = !TEMA_API || TEMA_API.usandoPadrao();
  }

  function renderAccents() {
    $('accent-grid').innerHTML = Object.keys(THEME_ACCENTS).map(function (nome) {
      var cor = THEME_ACCENTS[nome];
      return '<div class="accent-row">'
        + '<span class="accent-dot" style="background:' + cor + '"></span>'
        + '<span class="accent-nome">' + esc(nome) + '</span>'
        + '<span class="accent-hex">' + esc(cor) + '</span>'
        + '</div>';
    }).join('');
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    renderAccents();
    render();

    if (!TEMA_API) {
      console.warn('[temas] tema.js não carregou — a tela fica só em leitura');
      return;
    }

    $('tema-grid').addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('[data-tema]') : null;
      if (!card) return;
      if (TEMA_API.definir(card.getAttribute('data-tema'))) render();
    });

    $('reset-btn').addEventListener('click', function () {
      TEMA_API.definir(null);
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
