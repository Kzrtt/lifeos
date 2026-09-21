(function () {
  var CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
    '0123456789+/=_-#@!%&░▒▓▄▀█';

  function scramble(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      out += (c === ' ' || c === '\n' || c === '\t')
        ? c
        : CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return out;
  }

  function processNode(node) {
    if (node.nodeType === 3) {
      node.textContent = scramble(node.textContent);
    } else if (node.nodeType === 1) {
      for (var i = 0; i < node.childNodes.length; i++) {
        processNode(node.childNodes[i]);
      }
    }
  }

  function init() {
    var els = document.querySelectorAll('.redacted');
    for (var i = 0; i < els.length; i++) {
      processNode(els[i]);
    }
  }

  /* exposto para uso em conteúdo renderizado dinamicamente */
  window.applyRedact = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
