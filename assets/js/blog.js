/* blog.js — liga e desliga a metade pública do sistema
 * ──────────────────────────────────────────────────────────────────────────
 *
 * O projeto é duas coisas coladas: um ARQUIVO público (index, galeria, as
 * páginas em `pages/`) e um PAINEL privado (`lifeos/`). Nem todo mundo quer
 * as duas — tem quem só queira o painel, sem nada publicado.
 *
 * `LIFEOS_CONFIG.blog.habilitado = false` desliga a metade pública:
 *
 *   - o menu do hub esconde "Publicar página";
 *   - o link "← arquivo" da topbar some;
 *   - a seção de escopo por página some da tela de Senhas (sem páginas
 *     publicadas, conceder acesso a uma delas não quer dizer nada);
 *   - `index.html` deixa de ser a capa do arquivo e manda pro painel.
 *
 * POR QUE NO ARQUIVO DE CONFIG, E NÃO NUMA TELA
 *   A decisão precisa valer ANTES de qualquer render, inclusive no
 *   `index.html`, que é página pública e não deve fazer chamada de rede pra
 *   descobrir se deve existir. Guardar no banco exigiria um fetch no
 *   carregamento da capa — mais lento, e quebrado quando o backend estiver
 *   fora. Um valor declarativo resolve sem nenhuma das duas coisas.
 *
 * Este arquivo é DADO + uma função de aplicação, o mesmo grau de
 * compartilhamento de `tema.js` (ver LIFEOS.md §2).
 */
(function () {
  'use strict';

  var cfg = window.LIFEOS_CONFIG || {};
  /* Ausente = ligado. Um fork que não conhece esta opção continua com o
     arquivo público, que é o comportamento histórico do projeto. */
  var LIGADO = !(cfg.blog && cfg.blog.habilitado === false);

  window.LIFEOS_BLOG = {
    habilitado: function () { return LIGADO; },

    /* Chamado pelas páginas do LifeOS. Esconde em vez de remover: o markup
       continua no HTML, então religar o blog na config volta tudo sem
       precisar editar página nenhuma. */
    aplicar: function () {
      if (LIGADO) return;
      document.documentElement.setAttribute('data-blog', 'off');

      var some = [
        '.drawer-item[href="publicar.html"]',  /* publicar entrada do archive */
        '.topbar .back',                        /* "← arquivo" */
        '[data-requer-blog]',                   /* qualquer coisa marcada à mão */
      ];
      some.forEach(function (sel) {
        var els = document.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) els[i].hidden = true;
      });
    },
  };

  /* A capa é o único ponto que precisa decidir ANTES de pintar: sem blog
     ela não tem razão de existir, e quem abrir a raiz do site quer o
     painel. `location.replace` não empilha no histórico — voltar sai do
     site em vez de cair de novo aqui. */
  if (!LIGADO && document.documentElement.hasAttribute('data-capa')) {
    location.replace('lifeos/lifeos.html');
  }
})();
