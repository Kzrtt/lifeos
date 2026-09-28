/* tema.js — aplica o tema escolhido, antes da primeira pintura
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Serve DOIS escopos com o mesmo código: as páginas do LifeOS
 * (`assets/css/themes/lifeos/`, paletas escuras) e a capa do arquivo —
 * index, legacy e galeria — (`assets/css/themes/blog/`, paletas claras, com
 * outros nomes de token). Ele não sabe de qual se trata: `hrefDe()` troca só
 * o nome do arquivo no href e preserva a pasta.
 *
 * A chave de localStorage é a mesma nos dois, de propósito — a escolha do
 * tema é uma só e vale no sistema inteiro.
 *
 * Vai no `<head>`, LOGO DEPOIS do `<link>` do tema e sem `defer`/`async`:
 *
 *   </style>
 *   <link rel="stylesheet" id="lifeos-tema" href="../assets/css/themes/lifeos/sepia.css">
 *   <script src="../assets/js/lifeos-config.js"></script>
 *   <script src="../assets/js/tema.js"></script>
 *
 * A ORDEM É O MECANISMO INTEIRO, e vale entender os dois motivos:
 *
 *   1. O `<link>` vem DEPOIS do `<style>` inline da página. As páginas trazem
 *      a paleta padrão num bloco `SYSTEM SKIN` no fim desse `<style>`; ambos
 *      declaram os mesmos tokens em `:root`, mesma especificidade, então quem
 *      vence é o último. Por isso o `<link>` é estático no HTML, na posição
 *      certa — este script só troca o `href` dele.
 *
 *   2. Este script roda durante o parse do `<head>`, antes de qualquer pintura.
 *      A troca de `href` acontece enquanto a página ainda não apareceu, então
 *      não existe flash de tema errado. (Trocar o tema depois, num
 *      DOMContentLoaded, pintaria com a paleta padrão e viraria de cor na cara
 *      do usuário — foi por isso que o `<link>` não é criado por JS.)
 *
 * O `href` estático é o padrão da instância, então a página funciona sem JS e
 * o caso comum não desperdiça requisição: só quem escolheu outro tema paga uma
 * troca de folha.
 *
 * SEM BACKEND. A escolha vive no localStorage deste navegador e o padrão da
 * instância em `lifeos-config.js`. Nenhuma chamada de rede — o que faz isto
 * funcionar em `file://` e em localhost sem esbarrar no CORS das Edge Functions.
 *
 * Precedência: localStorage['lifeos_tema'] → LIFEOS_CONFIG.tema → 'sepia'.
 *
 * CAPA DO HUB (set/2026) — a segunda preferência de aparência, pelo mesmo
 * caminho e pelo mesmo motivo (aplicar antes da pintura, sem flash):
 * `data-hub-capa="classica|imersiva"` no <html>. Só o CSS de lifeos.html
 * reage a ela; nas outras páginas o atributo é inerte. NÃO usar `data-capa`
 * — esse nome é o marcador que blog.js usa pra redirecionar a capa do
 * arquivo, e no hub viraria um loop de redirecionamento com o blog desligado.
 *
 * Precedência: localStorage['lifeos_hub_capa'] → LIFEOS_CONFIG.hubCapa → 'classica'.
 */
(function () {
  'use strict';

  var LS_TEMA = 'lifeos_tema';
  var FALLBACK = 'sepia';

  /* Lista branca. O valor vem do localStorage, que o usuário controla; sem
     isto um valor arbitrário viraria um caminho arbitrário no href do <link>.
     Manter em sincronia com TEMAS no topo de temas.js. */
  var VALIDOS = [
    'sepia', 'noite', 'carvao', 'floresta',
    'ardosia', 'vinho', 'indigo', 'cobre', 'abismo',
  ];

  var link = document.getElementById('lifeos-tema');

  function lido() {
    try { return localStorage.getItem(LS_TEMA); } catch (_e) { return null; } /* modo privado */
  }

  function escolhido() {
    var salvo = lido();
    if (salvo && VALIDOS.indexOf(salvo) !== -1) return salvo;
    var cfg = window.LIFEOS_CONFIG;
    if (cfg && cfg.tema && VALIDOS.indexOf(cfg.tema) !== -1) return cfg.tema;
    return FALLBACK;
  }

  /* Deriva o caminho dos temas a partir do href que já está no <link> — assim
     funciona em qualquer subdiretório sem o script saber onde está. */
  function hrefDe(tema) {
    return link.getAttribute('href').replace(/[^/]+\.css$/, tema + '.css');
  }

  function aplicar(tema) {
    if (link.getAttribute('data-tema') === tema) return;
    link.setAttribute('href', hrefDe(tema));
    link.setAttribute('data-tema', tema);
  }

  if (link) aplicar(escolhido());

  /* ── Capa do hub ── mesma lógica de lista branca + precedência. */
  var LS_CAPA = 'lifeos_hub_capa';
  var CAPAS = ['classica', 'imersiva'];
  var CAPA_FALLBACK = 'classica';

  function capaLida() {
    try { return localStorage.getItem(LS_CAPA); } catch (_e) { return null; }
  }
  function capaPadrao() {
    var cfg = window.LIFEOS_CONFIG;
    return (cfg && CAPAS.indexOf(cfg.hubCapa) !== -1) ? cfg.hubCapa : CAPA_FALLBACK;
  }
  function capaEscolhida() {
    var salva = capaLida();
    return (salva && CAPAS.indexOf(salva) !== -1) ? salva : capaPadrao();
  }
  function aplicarCapa(capa) { document.documentElement.setAttribute('data-hub-capa', capa); }

  aplicarCapa(capaEscolhida());

  /* API usada por temas.js pra trocar o tema sem recarregar a página. */
  window.LIFEOS_TEMA = {
    capa: capaEscolhida,
    capas: function () { return CAPAS.slice(); },
    capaPadrao: capaPadrao,
    /* `null` limpa a escolha e volta ao padrão da instância. */
    definirCapa: function (nova) {
      if (nova === null) {
        try { localStorage.removeItem(LS_CAPA); } catch (_e) {}
        aplicarCapa(capaEscolhida());
        return true;
      }
      if (CAPAS.indexOf(nova) === -1) return false;
      try { localStorage.setItem(LS_CAPA, nova); } catch (_e) {}
      aplicarCapa(nova);
      return true;
    },
    usandoCapaPadrao: function () {
      var salva = capaLida();
      return !(salva && CAPAS.indexOf(salva) !== -1);
    },
    atual: escolhido,
    validos: function () { return VALIDOS.slice(); },
    /* `null` limpa a escolha e devolve a página ao padrão da instância. */
    definir: function (novo) {
      if (novo === null) {
        try { localStorage.removeItem(LS_TEMA); } catch (_e) {}
        if (link) aplicar(escolhido());
        return true;
      }
      if (VALIDOS.indexOf(novo) === -1) return false;
      try { localStorage.setItem(LS_TEMA, novo); } catch (_e) {}
      if (link) aplicar(novo);
      return true;
    },
    /* true quando a página está no padrão da instância, sem override local. */
    usandoPadrao: function () {
      var salvo = lido();
      return !(salvo && VALIDOS.indexOf(salvo) !== -1);
    },
  };
})();
