(function () {
  'use strict';

  /* Captura data-page ANTES de qualquer operação assíncrona.
   * Cada página protegida declara seu slug via:
   *   <script data-page="retrato" src="../assets/js/gate.js"></script>
   */
  var _script   = document.currentScript;
  var PAGE_SLUG = _script ? (_script.getAttribute('data-page') || '') : '';

  /* Flag de uso único gravada por login.html após autenticação.
   * É consumida (removida) imediatamente — nunca persiste entre visitas. */
  var PASS_KEY  = 'psyches_just_auth';

  /* Bloqueia o body imediatamente, antes de qualquer render. */
  var preStyle = document.createElement('style');
  preStyle.textContent = 'body{visibility:hidden!important}';
  document.head.appendChild(preStyle);
  function reveal() { preStyle.remove(); }

  /* Se login.html acabou de autenticar esta página: revela e sai. */
  if (sessionStorage.getItem(PASS_KEY) === PAGE_SLUG) {
    sessionStorage.removeItem(PASS_KEY);
    reveal();
    return;
  }

  /* Deriva a URL raiz do projeto a partir do src deste script.
   * Funciona em qualquer nível de subdiretório e em GitHub Pages. */
  var rootUrl  = _script
    ? _script.src.replace(/\/assets\/js\/gate\.js.*$/, '/')
    : '/';

  function redirectToLogin() {
    var loginUrl = rootUrl + 'login.html'
      + '?page=' + encodeURIComponent(PAGE_SLUG)
      + '&back=' + encodeURIComponent(location.href)
      + '&v=20260810';

    /* location.replace não adiciona a página protegida ao histórico,
     * então o botão "← voltar" do login retorna ao ponto anterior correto. */
    location.replace(loginUrl);
  }

  /* Acesso direto via query string (?md=claude&pswd=SENHA) — valida a
   * senha na própria página, sem o redirect para login.html. Existe para
   * permitir que um agente (ex.: Claude) leia o conteúdo em uma única
   * navegação, fornecendo a senha diretamente na URL. Usa a mesma RPC
   * do login.html — nenhum backend novo. */
  var params = new URLSearchParams(location.search);
  if (params.get('md') === 'claude' && params.get('pswd')) {
    var SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
    var ANON_KEY     = 'COLE-AQUI-A-CHAVE-PUBLICAVEL-ANON';

    fetch(SUPABASE_URL + '/rest/v1/rpc/check_page_access', {
      method: 'POST',
      headers: {
        'apikey':        ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ p_token: params.get('pswd'), p_page: PAGE_SLUG }),
    })
      .then(function (res) { return res.json(); })
      .then(function (valid) { valid === true ? reveal() : redirectToLogin(); })
      .catch(redirectToLogin);
    return;
  }

  redirectToLogin();
})();
