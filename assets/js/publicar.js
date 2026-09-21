/* publicar.js — tela de publicação de entradas do archive (lifeos/publicar.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Portado de `admin/index.html` (painel que vivia num link no rodapé do index)
 * para dentro do LifeOS, atrás do drawer de configuração do hub.
 *
 * O QUE MUDOU EM RELAÇÃO AO ADMIN ANTIGO
 *   1. Gate — usa o gate mestre do LifeOS (mesma chave de sessão das outras
 *      páginas), no lugar do formulário próprio que chamava
 *      `check_page_access(token, 'admin')`. Não é senha nova: `check_page_access`
 *      libera qualquer token com `is_master = true` independente da página, ou
 *      seja, a senha do admin sempre FOI a senha mestre. Ver AUTH.md.
 *   2. `GH_OWNER`/`GH_REPO` vêm de `lifeos-config.js`, não de constantes.
 *   3. A seção de permissões saiu daqui — virou `lifeos/senhas.html`.
 *   4. O publish agora faz o CACHE-BUSTING, que o admin antigo não fazia
 *      (ver `novaVersao`/`bumpIndexHtml` abaixo). Era um furo real: entrada
 *      publicada não aparecia pra quem tinha o manifest velho em cache.
 *
 * O QUE NÃO MUDOU: a derivação do slug, `injectScripts`, e todo o fluxo de
 * blob/tree/commit da Git Data API — commit atômico, um só.
 *
 * SEGURANÇA, herdada e registrada em AUTH.md: depois do gate, esta página
 * recebe no browser um PAT do GitHub com permissão de escrita no repositório.
 * A única barreira entre um visitante e esse PAT é a senha mestre. Não piorou
 * com a migração — mas continua sendo o ponto mais frágil do desenho, e o
 * caminho certo (fora do escopo desta empreitada) é a publicação virar uma
 * Edge Function que segura o PAT server-side.
 */
(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────── */
  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em publicar.html');

  var SUPABASE_URL = CFG.supabaseUrl;
  var ANON_KEY     = CFG.anonKey;
  var GH_OWNER     = CFG.gh.owner;
  var GH_REPO      = CFG.gh.repo;
  var GH_BRANCH    = CFG.gh.branch || 'main';
  var LS_KEY       = CFG.sessionKey;
  var CONFIG_FN    = CFG.supabaseUrl + '/functions/v1/lifeos-config';

  /* Mapa de themes — cópia isolada do THEME_ACCENTS de index.html (e de
     assets/js/index.js, que serve o legacy.html). Três cópias no projeto,
     mantidas à mão; unificar isso é o item "temas do blog" da tela de Temas.
     Ver MANIFEST.md §"Valores válidos para theme". */
  var THEME_ACCENTS = {
    identidade: '#8b3a3a', psicodelia: '#3a5c8b', metodo: '#3a7a5c',
    ciencia:    '#7a5c3a', sombra:     '#c44a3f', persona: '#5a6b7a',
    umwelt:     '#38408b', onirico:    '#5c3a8b', eros:    '#8b3a6b',
    vestigio:   '#2f7d8b',
  };

  /* ── State ───────────────────────────────────────────────────── */
  var SESSION_PW      = '';   /* senha mestre em memória */
  var githubPAT       = '';   /* PAT buscado do Supabase depois do gate */
  var uploadedSlug    = '';
  var uploadedContent = '';
  var manifestEntry   = null; /* objeto colado no textarea */
  var cleanedJSON     = '';   /* último JSON normalizado — usado no relatório de erro */
  var TOKEN_INFO      = null; /* { definido, mascarado, atualizado_em } de lifeos-config */
  var DELETE_PENDING  = false;

  function $(id) { return document.getElementById(id); }

  /* ── Modo local (mock) ───────────────────────────────────────────
   * Cópia do padrão `IS_LOCAL_DEV` das outras páginas do LifeOS
   * (LIFEOS.md §2: repetido por cópia, não por arquivo compartilhado).
   *
   * Aqui ele resolve DOIS bloqueios de teste local, não um:
   *   1. CORS — as RPCs e Edge Functions só aceitam o origin do GitHub Pages.
   *   2. O publish escreve DE VERDADE no repositório. Testar a tela contra a
   *      API real do GitHub criaria commits de lixo no `main` a cada tentativa.
   *
   * Por isso o publish local percorre os mesmos passos e imprime o mesmo log,
   * mas não faz requisição nenhuma — o que se está testando é a tela.
   */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  var MOCK_PW = 'local-dev';
  var MOCK_PAT = 'ghp_mockmockmockmockmockmockmockmock';

  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · nada é publicado de verdade';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }

  function mockDelay(value, ms) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms || 220); });
  }

  /* Estado fictício do token, mutável — a aba inteira (salvar, trocar,
     remover) é testável localmente sem Supabase. */
  var MOCK_TOKEN = null;

  /* Percorre os mesmos 5 passos do publish real, com as mesmas mensagens,
     sem tocar na API do GitHub. */
  async function mockPublish(slug, versao) {
    log('info', '1/5  lendo branch ' + GH_BRANCH + '…');
    await mockDelay(null, 260);
    log('info', '2/5  lendo manifests e index…');
    await mockDelay(null, 260);
    log('info', '3/5  criando blobs…');
    await mockDelay(null, 260);
    log('info', '4/5  montando árvore…');
    await mockDelay(null, 200);
    log('info', '5/5  commitando…');
    await mockDelay(null, 200);
    log('ok', '✓ simulado — versão ' + versao);
    log('info', 'modo local: nenhum commit foi criado. Em produção isto escreveria '
      + 'pages/' + slug + '.html, assets/js/manifest.js, manifest.json e index.html '
      + 'num commit só.');
  }

  /* ── RPC helper ──────────────────────────────────────────────── */
  function rpc(name, body) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(name + ' → ' + res.status + ' ' + t); });
      return res.json();
    });
  }

  /* PostgREST devolve o retorno de uma função `text` em três formatos
     diferentes dependendo do caso — normaliza todos para string. */
  function unwrapScalar(value) {
    if (Array.isArray(value)) value = value[0];
    if (value !== null && typeof value === 'object') {
      var keys = Object.keys(value);
      if (keys.length) value = value[keys[0]];
    }
    return (value === null || value === undefined) ? '' : String(value);
  }

  /* ── Config (token do GitHub) ─────────────────────────────────── */
  function callConfigFn(body) {
    return fetch(CONFIG_FN, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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

  function mascararLocal(v) {
    if (!v) return '';
    if (v.length <= 12) return v.slice(0, 2) + '…';
    return v.slice(0, 7) + '…' + v.slice(-4);
  }

  var configApi = {
    query: function () {
      if (IS_LOCAL_DEV) {
        return mockDelay({ ok: true, config: { github_pat: MOCK_TOKEN
          ? { definido: true, mascarado: mascararLocal(MOCK_TOKEN), atualizado_em: new Date().toISOString() }
          : { definido: false, mascarado: '', atualizado_em: null } } });
      }
      return callConfigFn({ token: SESSION_PW, action: 'query' });
    },
    set: function (valor) {
      if (IS_LOCAL_DEV) {
        if (!/^(ghp_|github_pat_)/.test(valor)) {
          var e = new Error('invalid_pat_format'); e.code = 'invalid_pat_format';
          return Promise.reject(e);
        }
        MOCK_TOKEN = valor;
        return mockDelay({ ok: true, mascarado: mascararLocal(valor), atualizado_em: new Date().toISOString() });
      }
      return callConfigFn({ token: SESSION_PW, action: 'set', key: 'github_pat', value: valor });
    },
    remove: function () {
      if (IS_LOCAL_DEV) {
        if (!MOCK_TOKEN) { var e = new Error('not_found'); e.code = 'not_found'; return Promise.reject(e); }
        MOCK_TOKEN = null;
        return mockDelay({ ok: true });
      }
      return callConfigFn({ token: SESSION_PW, action: 'delete', key: 'github_pat' });
    },
  };

  var CONFIG_ERRO = {
    invalid_pat_format: 'não parece um token do GitHub — deve começar com ghp_ ou github_pat_',
    empty_value: 'cole o token antes de salvar',
    invalid_key: 'chave de configuração inválida',
    not_found: 'não havia token cadastrado',
    unauthorized: 'sessão expirada — recarregue a página',
  };
  function msgConfigErro(code) { return CONFIG_ERRO[code] || ('erro — ' + code); }

  /* ── Gate ────────────────────────────────────────────────────── */
  function showGateForm() {
    $('gate').hidden = false;
    $('gate-checking').hidden = true;
    $('gate-form').hidden = false;
    $('app').hidden = true;
    $('gate-input').focus();
  }

  function showApp() {
    $('gate').hidden = true;
    $('app').hidden = false;
  }

  function shake() {
    var row = $('gate-row');
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  /* Autentica e já traz o PAT na mesma chamada.
   *
   * `get_admin_config` exige `is_master = true` (foi corrigida em set/2026
   * justamente por não exigir — ver AUTH.md), então um retorno não-vazio
   * prova a senha E entrega o token de uma vez.
   *
   * Retorno vazio é ambíguo: pode ser senha errada OU a linha `github_pat`
   * faltando em `admin_config`. Só nesse caso vale uma segunda chamada pra
   * distinguir — senão o usuário vê "senha incorreta" com a senha certa. */
  function authenticate(pw) {
    return rpc('get_admin_config', { p_token: pw, p_key: 'github_pat' })
      .then(function (raw) {
        var pat = unwrapScalar(raw);
        if (pat) return { ok: true, pat: pat };
        return rpc('check_page_access', { p_token: pw, p_page: 'admin' })
          .then(function (valid) {
            if (valid === true) return { ok: true, pat: '' };  /* senha certa, PAT ausente */
            return { ok: false };
          });
      });
  }

  function onGateSubmit(e) {
    e.preventDefault();
    var pw = $('gate-input').value.trim();
    if (!pw) return;

    $('gate-btn').disabled = true;
    $('gate-error').textContent = '';

    authenticate(pw).then(function (res) {
      $('gate-btn').disabled = false;
      if (!res.ok) {
        shake();
        $('gate-error').textContent = 'senha incorreta';
        $('gate-input').value = '';
        $('gate-input').focus();
        return;
      }
      SESSION_PW = pw;
      if ($('gate-remember').checked) localStorage.setItem(LS_KEY, pw);
      else localStorage.removeItem(LS_KEY);
      showApp();
      applyPAT(res.pat);
      carregarTokenInfo();
    }).catch(function (err) {
      $('gate-btn').disabled = false;
      $('gate-error').textContent = 'erro de conexão — tente de novo';
      console.error('[publicar] auth', err);
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    SESSION_PW = '';
    githubPAT = '';
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  /* ── PAT ─────────────────────────────────────────────────────── */
  function applyPAT(pat) {
    githubPAT = pat;
    var el = $('pat-status');
    if (pat) {
      el.className = 'pat-status ok';
      el.textContent = '✓ token configurado (' + pat.slice(0, 4) + '…' + pat.slice(-4) + ')';
    } else {
      el.className = 'pat-status err';
      /* Aponta pra aba em vez de mandar o usuário pro painel do Supabase —
         desde a Edge Function lifeos-config, cadastrar o token é coisa que
         se faz aqui dentro. */
      el.innerHTML = '✗ sem token do GitHub — '
        + '<a href="#" id="pat-ir-token" style="color:var(--gold)">cadastrar na aba Token</a>';
      var ir = $('pat-ir-token');
      if (ir) ir.addEventListener('click', function (e) { e.preventDefault(); trocarAba('token'); });
    }
    checkReady();
  }

  function refreshPAT() {
    var el = $('pat-status');
    el.className = 'pat-status wait';
    el.textContent = '⋯ buscando token…';
    githubPAT = '';
    checkReady();
    if (IS_LOCAL_DEV) { mockDelay(MOCK_PAT).then(applyPAT); return; }
    rpc('get_admin_config', { p_token: SESSION_PW, p_key: 'github_pat' })
      .then(function (raw) { applyPAT(unwrapScalar(raw)); })
      .catch(function (err) {
        el.className = 'pat-status err';
        el.textContent = '✗ erro ao buscar token — verifique a conexão';
        console.error('[publicar] pat', err);
      });
  }

  /* ── Aba do token ────────────────────────────────────────────── */
  function trocarAba(nome) {
    var abas = document.querySelectorAll('.tab');
    for (var i = 0; i < abas.length; i++) {
      var ativa = abas[i].getAttribute('data-tab') === nome;
      abas[i].classList.toggle('is-active', ativa);
      abas[i].setAttribute('aria-selected', String(ativa));
    }
    $('painel-publicar').hidden = nome !== 'publicar';
    $('painel-token').hidden = nome !== 'token';
    if (nome === 'token') resetDeletePending();
  }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  function dataCurta(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function renderTokenInfo() {
    var wrap = $('token-atual-wrap');
    var dot = $('tab-dot');

    if (!TOKEN_INFO || !TOKEN_INFO.definido) {
      wrap.innerHTML = '<div class="token-atual">'
        + '<i class="fad fa-circle-exclamation" style="color:var(--red)"></i>'
        + '<span class="token-atual-val">nenhum token cadastrado — não é possível publicar</span>'
        + '</div>';
      $('token-input-label').textContent = 'Cadastrar token';
      $('token-save').textContent = 'Salvar token';
      /* O ponto na aba existe pra que a falta do token seja visível mesmo
         quando o usuário está na aba de publicar. */
      dot.hidden = false;
      return;
    }

    var data = dataCurta(TOKEN_INFO.atualizado_em);
    wrap.innerHTML = '<div class="token-atual">'
      + '<i class="fad fa-circle-check" style="color:var(--green)"></i>'
      + '<span class="token-atual-val">' + esc(TOKEN_INFO.mascarado) + '</span>'
      + (data ? '<span class="token-atual-data">salvo em ' + esc(data) + '</span>' : '')
      + '<button type="button" class="row-btn danger" id="token-delete" title="Remover token" aria-label="Remover token">'
      + '<i class="fad fa-trash"></i></button>'
      + '</div>';
    $('token-input-label').textContent = 'Substituir token';
    $('token-save').textContent = 'Substituir token';
    dot.hidden = true;

    $('token-delete').addEventListener('click', onTokenDelete);
  }

  function carregarTokenInfo() {
    return configApi.query().then(function (data) {
      TOKEN_INFO = data.config && data.config.github_pat ? data.config.github_pat : null;
      renderTokenInfo();
    }).catch(function (err) {
      console.error('[publicar] config query', err);
      TOKEN_INFO = null;
      renderTokenInfo();
    });
  }

  function onTokenSave() {
    var valor = $('token-input').value.trim();
    var errEl = $('token-error');
    errEl.className = 'json-status';
    errEl.textContent = '';

    if (!valor) {
      errEl.className = 'json-status err';
      errEl.textContent = '✗ cole o token antes de salvar';
      $('token-input').focus();
      return;
    }

    $('token-save').disabled = true;
    configApi.set(valor).then(function () {
      $('token-input').value = '';
      errEl.className = 'json-status ok';
      errEl.textContent = '✓ token salvo';
      $('token-save').disabled = false;
      /* Recarrega o PAT em memória: sem isto o publish continuaria usando o
         token anterior (ou nenhum) até a página ser recarregada. */
      return carregarTokenInfo().then(refreshPAT);
    }).catch(function (err) {
      $('token-save').disabled = false;
      errEl.className = 'json-status err';
      errEl.textContent = '✗ ' + msgConfigErro(err.code);
      console.error('[publicar] config set', err);
    });
  }

  /* Exclusão com confirmação de dois cliques — mesmo padrão do resto do
     LifeOS, e aqui vale duplamente: apagar deixa o publish sem token. */
  function resetDeletePending() {
    DELETE_PENDING = false;
    var btn = $('token-delete');
    if (btn) {
      btn.classList.remove('pending');
      btn.innerHTML = '<i class="fad fa-trash"></i>';
      btn.title = 'Remover token';
    }
  }

  function onTokenDelete() {
    var btn = $('token-delete');
    if (!DELETE_PENDING) {
      DELETE_PENDING = true;
      btn.classList.add('pending');
      btn.innerHTML = '<i class="fad fa-check"></i>';
      btn.title = 'Confirmar remoção';
      return;
    }
    DELETE_PENDING = false;
    configApi.remove().then(function () {
      githubPAT = '';
      applyPAT('');
      return carregarTokenInfo();
    }).catch(function (err) {
      console.error('[publicar] config delete', err);
      resetDeletePending();
    });
  }

  /* ── Arquivo ─────────────────────────────────────────────────── */
  function processFile(file) {
    var nameEl = $('file-name');
    if (!/\.html$/i.test(file.name)) {
      nameEl.className = 'file-name err';
      nameEl.textContent = '✗ apenas arquivos .html são aceitos';
      uploadedSlug = '';
      uploadedContent = '';
      checkReady();
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      uploadedContent = e.target.result;
      uploadedSlug = file.name.replace(/\.html$/i, '');
      nameEl.className = 'file-name';
      nameEl.textContent = '▸ ' + file.name + '  →  slug: ' + uploadedSlug;
      checkReady();
    };
    reader.readAsText(file, 'UTF-8');
  }

  /* ── Manifest colado ─────────────────────────────────────────── */
  function onManifestInput() {
    var raw = $('manifest-json').value.trim();
    var statusEl = $('json-status');

    if (!raw) {
      manifestEntry = null;
      statusEl.className = 'json-status';
      statusEl.textContent = '';
      checkReady();
      return;
    }

    /* normaliza aspas tipográficas (comuns ao copiar de chat) e trailing
       commas, que JSON estrito recusa */
    cleanedJSON = raw
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');

    try {
      var parsed = JSON.parse(cleanedJSON);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error('deve ser um objeto JSON');
      }
      manifestEntry = parsed;
      if (typeof parsed.protected === 'boolean') $('restricted-input').checked = parsed.protected;

      var avisos = [];
      if (parsed.theme && !THEME_ACCENTS[parsed.theme]) {
        avisos.push('theme "' + parsed.theme + '" não existe — cai no fallback identidade');
      }
      if (parsed.volume === null || parsed.volume === undefined) {
        avisos.push('sem volume — a entrada fica invisível no index');
      }

      statusEl.className = 'json-status ok';
      statusEl.textContent = '✓ JSON válido — ' + Object.keys(parsed).length + ' campos'
        + (avisos.length ? '\n⚠ ' + avisos.join('\n⚠ ') : '');
    } catch (err) {
      manifestEntry = null;
      var detail = '';
      var m = err.message.match(/position (\d+)/);
      if (m) {
        var pos = parseInt(m[1], 10);
        var snip = cleanedJSON.slice(Math.max(0, pos - 20), pos + 20);
        detail = '\npos ' + pos + ' | trecho: ' + JSON.stringify(snip);
      }
      statusEl.className = 'json-status err';
      statusEl.textContent = '✗ ' + err.message + detail;
    }
    checkReady();
  }

  function checkReady() {
    $('publish-btn').disabled = !(githubPAT && uploadedSlug && manifestEntry);
  }

  /* ── Injeção de scripts no HTML enviado ──────────────────────── */
  function injectScripts(html, slug, restricted) {
    var hasGuard = html.indexOf('share-guard.js') !== -1;
    var hasGate  = html.indexOf('gate.js') !== -1;

    var toInject = '';
    if (!hasGuard) toInject += '<script src="../assets/js/share-guard.js"><\/script>\n';
    if (restricted && !hasGate) {
      toInject += '<script data-page="' + slug + '" src="../assets/js/gate.js"><\/script>\n';
    }
    if (!toInject) return html;

    var m = html.match(/(<meta\s[^>]*charset[^>]*>)/i);
    if (m) {
      var idx = html.indexOf(m[0]) + m[0].length;
      return html.slice(0, idx) + '\n' + toInject + html.slice(idx);
    }
    var headIdx = html.toLowerCase().indexOf('<head>');
    if (headIdx !== -1) return html.slice(0, headIdx + 6) + '\n' + toInject + html.slice(headIdx + 6);
    return toInject + html;
  }

  /* ── Base64 UTF-8 ────────────────────────────────────────────── */
  function toB64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function fromB64(b64) { return decodeURIComponent(escape(atob(b64))); }

  /* ── Cache-busting ───────────────────────────────────────────────
   * O GitHub Pages serve JS com `max-age=600`. Sem trocar a versão, quem já
   * visitou o site continua com o manifest antigo em cache e NÃO vê a entrada
   * nova por até 10 minutos (às vezes mais, dependendo do CDN).
   *
   * O CLAUDE.md marca esse bump como obrigatório em três lugares, e o admin
   * antigo não fazia nenhum deles — publicava manifest.js e manifest.json com
   * a `meta.version` velha e não tocava no index.html.
   *
   * Formato da versão: `YYYYMMDD-HHMM`, o mesmo que já está em uso.
   */
  function novaVersao() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* Troca o `?v=` das tags <script> que o index.html versiona (manifest.js e
     redact.js — share-guard.js e access-gate.js entram sem versão). Casa
     qualquer valor anterior, inclusive tag sem `?v=` nenhum. */
  function bumpIndexHtml(html, versao) {
    return html.replace(
      /(<script\s+src="assets\/js\/(?:manifest|redact)\.js)(\?v=[^"]*)?(")/g,
      '$1?v=' + versao + '$3'
    );
  }

  /* ── Publish ─────────────────────────────────────────────────── */
  function log(type, msg) {
    var line = document.createElement('div');
    line.className = 's-' + type;
    line.innerHTML = msg;
    $('status').appendChild(line);
  }

  async function onPublish() {
    var slug = uploadedSlug;
    var restricted = $('restricted-input').checked;
    var html = injectScripts(uploadedContent, slug, restricted);
    var versao = novaVersao();

    $('publish-btn').disabled = true;
    $('status').innerHTML = '';

    if (IS_LOCAL_DEV) {
      await mockPublish(slug, versao);
      $('publish-btn').disabled = false;
      return;
    }

    var H = {
      'Authorization': 'Bearer ' + githubPAT,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    var repoBase = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/';
    var base = repoBase + 'git/';

    async function ghJSON(url, opts) {
      var res = await fetch(url, opts || {});
      var body = await res.json();
      if (!res.ok) throw new Error(res.status + ' — ' + (body.message || JSON.stringify(body)));
      return body;
    }

    async function getContent(path) {
      var r = await fetch(repoBase + 'contents/' + path + '?ref=' + GH_BRANCH, { headers: H });
      var d = await r.json();
      if (!r.ok) throw new Error('GET ' + path + ': ' + r.status);
      return fromB64(d.content.replace(/\n/g, ''));
    }

    async function createBlob(content) {
      var r = await ghJSON(base + 'blobs', {
        method: 'POST', headers: H,
        body: JSON.stringify({ content: toB64(content), encoding: 'base64' }),
      });
      return r.sha;
    }

    /* remove `;` final (manifest.js) e trailing commas antes de parsear */
    function safeParseJSON(str) {
      return JSON.parse(str.trim().replace(/;\s*$/, '').replace(/,\s*([}\]])/g, '$1'));
    }

    try {
      log('info', '1/5  lendo branch ' + GH_BRANCH + '…');
      var ref = await ghJSON(base + 'refs/heads/' + GH_BRANCH, { headers: H });
      var commitSha = ref.object.sha;
      var commit = await ghJSON(base + 'commits/' + commitSha, { headers: H });
      var treeSha = commit.tree.sha;

      log('info', '2/5  lendo manifests e index…');
      var contents = await Promise.all([
        getContent('assets/js/manifest.js'),
        getContent('manifest.json'),
        getContent('index.html'),
      ]);
      var mjsRaw = contents[0], mjsonRaw = contents[1], indexRaw = contents[2];

      /* slug e file SEMPRE derivados do arquivo enviado — o que foi colado
         no textarea nunca manda nesses dois campos */
      var entry = Object.assign({}, manifestEntry, {
        slug: slug,
        file: 'pages/' + slug + '.html',
      });

      var assignIdx = mjsRaw.indexOf('window.PSYCHES_MANIFEST =');
      if (assignIdx === -1) throw new Error('window.PSYCHES_MANIFEST não encontrado em manifest.js');
      var mjsPrefix = mjsRaw.slice(0, assignIdx);
      var mjsJson = safeParseJSON(mjsRaw.slice(assignIdx + 'window.PSYCHES_MANIFEST ='.length));

      if (mjsJson.entries.some(function (e) { return e.slug === slug; })) {
        throw new Error('já existe uma entrada com o slug "' + slug + '" no manifest');
      }

      mjsJson.entries.push(entry);
      mjsJson.meta.version = versao;
      var mjsUpdated = mjsPrefix + 'window.PSYCHES_MANIFEST = ' + JSON.stringify(mjsJson, null, 2) + ';\n';

      var mjsonObj = safeParseJSON(mjsonRaw);
      mjsonObj.entries.push(entry);
      mjsonObj.meta.version = versao;
      var mjsonUpdated = JSON.stringify(mjsonObj, null, 2);

      var indexUpdated = bumpIndexHtml(indexRaw, versao);
      if (indexUpdated === indexRaw) {
        log('info', '⚠ index.html: nenhuma tag <script> versionada encontrada — cache-busting parcial');
      }

      log('info', '3/5  criando blobs…');
      var blobShas = await Promise.all([
        createBlob(html),
        createBlob(mjsUpdated),
        createBlob(mjsonUpdated),
        createBlob(indexUpdated),
      ]);

      log('info', '4/5  montando árvore…');
      var newTree = await ghJSON(base + 'trees', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          base_tree: treeSha,
          tree: [
            { path: 'pages/' + slug + '.html', mode: '100644', type: 'blob', sha: blobShas[0] },
            { path: 'assets/js/manifest.js',   mode: '100644', type: 'blob', sha: blobShas[1] },
            { path: 'manifest.json',           mode: '100644', type: 'blob', sha: blobShas[2] },
            { path: 'index.html',              mode: '100644', type: 'blob', sha: blobShas[3] },
          ],
        }),
      });

      log('info', '5/5  commitando…');
      var newCommit = await ghJSON(base + 'commits', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          message: 'feat: add page ' + slug,
          tree: newTree.sha,
          parents: [commitSha],
        }),
      });

      await ghJSON(base + 'refs/heads/' + GH_BRANCH, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ sha: newCommit.sha }),
      });

      var pageUrl = 'https://' + GH_OWNER + '.github.io/' + GH_REPO + '/pages/' + slug + '.html';
      log('ok', '✓ publicado — commit ' + newCommit.sha.slice(0, 7) + ' · versão ' + versao);
      log('ok', '<a class="s-link" href="' + pageUrl + '" target="_blank" rel="noopener">→ ' + pageUrl + '</a>');
      log('info', 'o GitHub Pages leva ~1 min pra refletir o commit');
    } catch (err) {
      log('err', '✗ ' + err.message);
    }

    $('publish-btn').disabled = false;
  }

  /* ── Legend de themes ────────────────────────────────────────── */
  function renderThemeLegend() {
    var html = '';
    Object.keys(THEME_ACCENTS).forEach(function (nome) {
      var cor = THEME_ACCENTS[nome];
      html += '<div class="theme-swatch">'
        + '<span class="theme-dot" style="background:' + cor + '"></span>'
        + '<span class="theme-name">' + nome + '</span>'
        + '<span class="theme-hex">' + cor + '</span>'
        + '</div>';
    });
    $('theme-legend').innerHTML = html;
  }

  /* ── Boot ────────────────────────────────────────────────────── */
  function boot() {
    /* Local: pula o gate — não há backend contra o que validar. */
    if (IS_LOCAL_DEV) {
      showDevBadge();
      SESSION_PW = MOCK_PW;
      $('gate').hidden = true;
      $('app').hidden = false;
      applyPAT(MOCK_TOKEN || '');
      carregarTokenInfo();
      return;
    }

    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }

    /* Sessão lembrada (provavelmente vinda do hub) — revalida em silêncio */
    $('gate').hidden = false;
    $('gate-form').hidden = true;
    $('gate-checking').hidden = false;

    authenticate(saved).then(function (res) {
      if (!res.ok) {
        localStorage.removeItem(LS_KEY);
        $('gate-checking').hidden = true;
        showGateForm();
        $('gate-error').textContent = 'sessão expirada — entre novamente';
        return;
      }
      SESSION_PW = saved;
      showApp();
      applyPAT(res.pat);
      carregarTokenInfo();
    }).catch(function (err) {
      $('gate-checking').hidden = true;
      showGateForm();
      $('gate-error').textContent = 'erro de conexão — tente de novo';
      console.error('[publicar] boot', err);
    });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    renderThemeLegend();

    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('pat-refresh').addEventListener('click', refreshPAT);
    $('token-save').addEventListener('click', onTokenSave);
    $('token-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); onTokenSave(); }
    });
    var abas = document.querySelectorAll('.tab');
    for (var ai = 0; ai < abas.length; ai++) {
      abas[ai].addEventListener('click', function (e) {
        trocarAba(e.currentTarget.getAttribute('data-tab'));
      });
    }
    $('publish-btn').addEventListener('click', onPublish);
    $('manifest-json').addEventListener('input', onManifestInput);

    var dropZone = $('drop-zone');
    var fileInput = $('file-input');
    dropZone.addEventListener('click', function () { fileInput.click(); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
    ['dragleave', 'dragend'].forEach(function (ev) {
      dropZone.addEventListener(ev, function () { dropZone.classList.remove('drag-over'); });
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) processFile(fileInput.files[0]);
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
