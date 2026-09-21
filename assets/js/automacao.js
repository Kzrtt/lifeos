/* automacao.js — webhook de lançamento por celular (lifeos/automacao.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Monta e copia a URL do `lifeos-ingest`, o webhook que a automação do
 * celular chama para criar movimentações.
 *
 * A URL carrega a SENHA MESTRE na query string — `?token=<senha>`. Não é
 * descuido: um atalho de iPhone não tem onde guardar cabeçalho, então a
 * autenticação precisou caber no endereço. Por isso esta página fica atrás
 * do gate como as outras, e por isso o aviso de segurança na tela é
 * direto sobre o que a URL permite.
 *
 * Tudo aqui é montado no cliente a partir de `LIFEOS_CONFIG.supabaseUrl` +
 * a senha da sessão. Não há chamada de rede: o gate é validado reusando a
 * RPC `check_page_access`, que já é pública para o fluxo de senha das
 * páginas do archive.
 */
(function () {
  'use strict';

  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em automacao.html');

  var SUPABASE_URL = CFG.supabaseUrl;
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey;

  var SESSION_PW = '';
  var URL_INGEST = '';

  function $(id) { return document.getElementById(id); }

  /* ── Modo local ───────────────────────────────────────────────────
     Sem rede, a página funciona igual; só a senha vira fictícia para que a
     URL mostrada não seja colável num atalho de verdade. */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · URL fictícia';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }

  function montarUrl(pw) {
    return SUPABASE_URL + '/functions/v1/lifeos-ingest?token=' + encodeURIComponent(pw);
  }

  function renderUrl(pw) {
    URL_INGEST = montarUrl(pw);
    var el = $('ingest-url');
    el.className = 'url-val';
    el.textContent = URL_INGEST;
  }

  /* ── Copiar ──────────────────────────────────────────────────────── */
  function copiar() {
    if (!URL_INGEST) return;
    var btn = $('ingest-copy');

    function feedback() {
      btn.classList.add('ok');
      btn.innerHTML = '<i class="fad fa-check"></i>';
      setTimeout(function () {
        btn.classList.remove('ok');
        btn.innerHTML = '<i class="fad fa-copy"></i>';
      }, 1600);
    }

    /* `navigator.clipboard` exige contexto seguro e não existe em file://,
       que é onde a página é testada localmente. O execCommand é obsoleto
       mas continua sendo o único caminho ali. */
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = URL_INGEST;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); feedback(); } catch (_e) {
        var range = document.createRange();
        range.selectNodeContents($('ingest-url'));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(URL_INGEST).then(feedback).catch(fallback);
    } else {
      fallback();
    }
  }

  /* ── Gate ────────────────────────────────────────────────────────── */
  function showGateForm() {
    $('gate').hidden = false;
    $('gate-checking').hidden = true;
    $('gate-form').hidden = false;
    $('app').hidden = true;
    $('gate-input').focus();
  }

  function shake() {
    var row = $('gate-row');
    row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
  }

  /* Valida a senha reusando `check_page_access`, que já é exposta ao anon
     para o fluxo de senha das páginas do archive. Um token mestre passa em
     qualquer página, então isso é, na prática, "esta senha é mestre?". */
  function validar(pw) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/check_page_access', {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: pw, p_page: 'lifeos' }),
    }).then(function (res) {
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json();
    });
  }

  function entrar(pw) {
    SESSION_PW = pw;
    $('gate').hidden = true;
    $('app').hidden = false;
    renderUrl(pw);
  }

  function onGateSubmit(e) {
    e.preventDefault();
    var pw = $('gate-input').value.trim();
    if (!pw) return;
    $('gate-btn').disabled = true;
    $('gate-error').textContent = '';

    validar(pw).then(function (valido) {
      $('gate-btn').disabled = false;
      if (valido !== true) {
        shake();
        $('gate-error').textContent = 'senha incorreta';
        $('gate-input').value = '';
        $('gate-input').focus();
        return;
      }
      if ($('gate-remember').checked) localStorage.setItem(LS_KEY, pw);
      else localStorage.removeItem(LS_KEY);
      entrar(pw);
    }).catch(function (err) {
      $('gate-btn').disabled = false;
      $('gate-error').textContent = 'erro de conexão — tente de novo';
      console.error('[automacao] gate', err);
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    SESSION_PW = '';
    URL_INGEST = '';
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  function boot() {
    if (IS_LOCAL_DEV) {
      showDevBadge();
      $('gate').hidden = true;
      $('app').hidden = false;
      /* senha obviamente falsa: a URL não pode parecer colável */
      renderUrl('SENHA-FICTICIA-DO-MODO-LOCAL');
      return;
    }

    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }

    $('gate').hidden = false;
    $('gate-form').hidden = true;
    $('gate-checking').hidden = false;

    validar(saved).then(function (valido) {
      if (valido !== true) {
        localStorage.removeItem(LS_KEY);
        $('gate-checking').hidden = true;
        showGateForm();
        $('gate-error').textContent = 'sessão expirada — entre novamente';
        return;
      }
      entrar(saved);
    }).catch(function (err) {
      $('gate-checking').hidden = true;
      showGateForm();
      $('gate-error').textContent = 'erro de conexão — tente de novo';
      console.error('[automacao] boot', err);
    });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('ingest-copy').addEventListener('click', copiar);
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
