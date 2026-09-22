/* mcp.js — tela do conector MCP (lifeos/mcp.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Mostra a URL que o usuário cola no cliente MCP e explica o que o conector
 * faz. A URL carrega o token de acesso embutido no path (ver AUTH.md §4 e o
 * cabeçalho de supabase/functions/lifeos-mcp/index.ts), então esta página
 * fica atrás do gate mestre como as outras.
 *
 * O TOKEN VEM DO BANCO, NÃO DO CÓDIGO. `lifeos-config` (ação `mcp_url`) lê
 * `admin_config.mcp_token` e devolve a URL montada. Pôr o token em
 * `lifeos-config.js` seria publicá-lo: aquele arquivo é servido pelo GitHub
 * Pages e qualquer visitante o lê.
 *
 * A lista de ferramentas é uma CÓPIA da que está em `lifeos-mcp/index.ts`.
 * Buscar do servidor exigiria falar JSON-RPC com o próprio MCP a partir do
 * browser — mais peça móvel do que o valor justifica numa tela de ajuda.
 * Ao mudar uma tool lá, atualize aqui.
 */
(function () {
  'use strict';

  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em mcp.html');

  var CONFIG_FN = CFG.supabaseUrl + '/functions/v1/lifeos-config';
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey;

  var SESSION_PW = '';
  var MCP_URL = '';

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  /* ── Modo local ──────────────────────────────────────────────────
     Mesma razão das outras telas: CORS impede falar com a Edge Function de
     file:// ou localhost. Aqui o mock usa um token obviamente falso — a URL
     não pode parecer real, ou alguém acaba colando ela num cliente. */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · URL fictícia';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }

  function mockDelay(v) {
    return new Promise(function (r) { setTimeout(function () { r(v); }, 220); });
  }

  /* ── Catálogo das tools — cópia de lifeos-mcp/index.ts ───────────── */
  var TOOLS = [
    {
      nome: 'search_notas', tipo: 'leitura',
      desc: 'Busca notas e devolve o conteúdo completo em markdown, não só o título.',
      filtros: 'nome · projetos · tipo · intervalo de data',
    },
    {
      nome: 'create_nota', tipo: 'escrita',
      desc: 'Cria uma nota nova. A data é sempre hoje. Exige nome, tipo, ao menos um projeto e o conteúdo.',
      filtros: 'escrita — restrita a Notas',
    },
    {
      nome: 'update_nota', tipo: 'escrita',
      desc: 'Edita uma nota existente. Substituição completa, não é um patch — toda chamada reenvia nome, tipo, projetos e o conteúdo INTEIRO, mesmo o que não mudou.',
      filtros: 'escrita — restrita a Notas',
    },
    {
      nome: 'search_tarefas', tipo: 'leitura',
      desc: 'Busca tarefas, com o projeto ao qual cada uma pertence.',
      filtros: 'nome · projeto · status · tipo · data de entrega',
    },
    {
      nome: 'search_projetos', tipo: 'leitura',
      desc: 'Lista projetos — útil para a IA descobrir os nomes antes de filtrar o resto.',
      filtros: 'nome · status · tags',
    },
    {
      nome: 'search_eventos', tipo: 'leitura',
      desc: 'Busca eventos do calendário, com o projeto vinculado quando houver.',
      filtros: 'nome · tipo · projeto · intervalo de data',
    },
    {
      nome: 'search_manifestacoes', tipo: 'leitura',
      desc: 'Busca manifestações — os objetivos de longo prazo do sistema.',
      filtros: 'nome · status · tags',
    },
    {
      nome: 'search_movimentacoes', tipo: 'leitura',
      desc: 'Busca movimentações financeiras, para a IA somar e comparar períodos.',
      filtros: 'nome · direção · meio · data · faixa de valor',
    },
  ];

  function renderTools() {
    $('tool-grid').innerHTML = TOOLS.map(function (t) {
      return '<div class="tool">'
        + '<div class="tool-nome"><code>' + esc(t.nome) + '</code>'
        + '<span class="tool-tag ' + t.tipo + '">' + esc(t.tipo) + '</span></div>'
        + '<div class="tool-desc">' + esc(t.desc) + '</div>'
        + '<div class="tool-filtros"><b>filtros:</b> ' + esc(t.filtros) + '</div>'
        + '</div>';
    }).join('');
  }

  /* ── URL ─────────────────────────────────────────────────────────── */
  function buscarUrl() {
    if (IS_LOCAL_DEV) {
      return mockDelay({
        ok: true, definido: true,
        url: CFG.supabaseUrl + '/functions/v1/lifeos-mcp/TOKEN-FICTICIO-DO-MODO-LOCAL',
      });
    }
    return fetch(CONFIG_FN, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: SESSION_PW, action: 'mcp_url' }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok !== true) {
          var err = new Error(data.error || ('http_' + res.status));
          err.code = data.error || ('http_' + res.status);
          throw err;
        }
        return data;
      });
    });
  }

  function renderUrl(data) {
    var el = $('mcp-url');
    var hint = $('mcp-hint');

    if (!data.definido) {
      MCP_URL = '';
      el.className = 'url-val vazio';
      el.textContent = 'nenhum token de MCP cadastrado';
      hint.innerHTML = 'Gere um valor com <code>openssl rand -hex 32</code> e grave-o em '
        + '<code>admin_config</code>, na chave <code>mcp_token</code>.';
      $('mcp-copy').disabled = true;
      return;
    }

    MCP_URL = data.url;
    el.className = 'url-val';
    el.textContent = data.url;
    hint.textContent = '';
  }

  function copiarUrl() {
    if (!MCP_URL) return;
    var btn = $('mcp-copy');

    function feedback() {
      btn.classList.add('ok');
      btn.innerHTML = '<i class="fad fa-check"></i>';
      setTimeout(function () {
        btn.classList.remove('ok');
        btn.innerHTML = '<i class="fad fa-copy"></i>';
      }, 1600);
    }

    /* `navigator.clipboard` exige contexto seguro (https ou localhost) — em
       file:// ele não existe, e é justamente onde se testa a página. O
       fallback com execCommand é obsoleto mas continua funcionando em todos
       os browsers atuais, e é o único caminho ali. */
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(MCP_URL).then(feedback).catch(fallback);
    } else {
      fallback();
    }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = MCP_URL;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); feedback(); } catch (_e) {
        /* Sem clipboard disponível: seleciona o texto pra cópia manual. */
        var range = document.createRange();
        range.selectNodeContents($('mcp-url'));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.body.removeChild(ta);
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
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  function entrar(pw, vindoDoForm) {
    SESSION_PW = pw;
    return buscarUrl().then(function (data) {
      $('gate').hidden = true;
      $('app').hidden = false;
      renderUrl(data);
    }).catch(function (err) {
      SESSION_PW = '';
      if (err.code === 'unauthorized') {
        if (vindoDoForm) {
          shake();
          $('gate-error').textContent = 'senha incorreta';
          $('gate-input').value = '';
          $('gate-input').focus();
        } else {
          localStorage.removeItem(LS_KEY);
          $('gate-checking').hidden = true;
          showGateForm();
          $('gate-error').textContent = 'sessão expirada — entre novamente';
        }
      } else {
        $('gate-checking').hidden = true;
        if (!vindoDoForm) showGateForm();
        $('gate-error').textContent = 'erro de conexão — tente de novo';
        console.error('[mcp] url', err);
      }
      throw err;
    });
  }

  function onGateSubmit(e) {
    e.preventDefault();
    var pw = $('gate-input').value.trim();
    if (!pw) return;
    $('gate-btn').disabled = true;
    $('gate-error').textContent = '';
    entrar(pw, true).then(function () {
      if ($('gate-remember').checked) localStorage.setItem(LS_KEY, pw);
      else localStorage.removeItem(LS_KEY);
    }).catch(function () { /* já tratado em entrar() */ })
      .then(function () { $('gate-btn').disabled = false; });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    SESSION_PW = '';
    MCP_URL = '';
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  function boot() {
    if (IS_LOCAL_DEV) {
      showDevBadge();
      SESSION_PW = 'local-dev';
      $('gate').hidden = true;
      $('app').hidden = false;
      buscarUrl().then(renderUrl);
      return;
    }

    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }

    $('gate').hidden = false;
    $('gate-form').hidden = true;
    $('gate-checking').hidden = false;
    entrar(saved, false).catch(function () { /* já tratado */ });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    renderTools();
    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('mcp-copy').addEventListener('click', copiarUrl);
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
