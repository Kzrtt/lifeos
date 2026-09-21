/* senhas.js — gestão de senhas de acesso (lifeos/senhas.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Antes desta tela, cadastrar ou trocar uma senha exigia SQL no painel do
 * Supabase; o admin/index.html só sabia conceder e revogar escopo de página,
 * nunca criar, editar ou apagar a senha em si.
 *
 * DUAS COISAS DIFERENTES NUMA TELA SÓ
 *   1. A SENHA (`access_tokens`) — o valor digitado no gate. `is_master = true`
 *      abre o LifeOS inteiro e qualquer página protegida.
 *   2. O ESCOPO (`token_pages`) — quais páginas do archive uma senha NÃO-mestre
 *      abre. Mestre não usa escopo: `check_page_access` já a libera em tudo.
 *
 * BACKEND: Edge Function `lifeos-senhas`, não RPC direta. A tabela de
 * autenticação não ganha superfície de escrita no `anon` — ver o comentário
 * no topo de supabase/functions/lifeos-senhas/index.ts pro motivo histórico.
 *
 * O VALOR DA SENHA NUNCA VOLTA DO SERVIDOR: a function só devolve uma versão
 * mascarada. Não há "revelar senha" — esqueceu, troca.
 */
(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────── */
  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em senhas.html');

  var SENHAS_FN = CFG.supabaseUrl + '/functions/v1/lifeos-senhas';
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey;

  /* ── State ───────────────────────────────────────────────────── */
  var SESSION_PW = '';
  var SENHAS = [];
  var EDIT_ID = null;      /* null = criando; id = editando */
  var GRANT_ID = null;     /* senha que vai receber a página */
  var DELETE_PENDING = null;

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  /* Remove a marcação de redação/itálico do manifest (`#(x)`, `_(x)_`) —
     senão os títulos aparecem com a sintaxe crua no select de páginas. */
  function stripMarkup(str) {
    return String(str == null ? '' : str)
      .replace(/_\(([^)]+)\)_/g, '$1')
      .replace(/#\(([^)]+)\)/g, '$1');
  }

  /* ── Modo local (mock) ───────────────────────────────────────────
   * Cópia do padrão `IS_LOCAL_DEV` das outras páginas do LifeOS
   * (LIFEOS.md §2: repetido por cópia, não por arquivo compartilhado).
   *
   * Existe porque as Edge Functions restringem CORS ao origin do GitHub
   * Pages — de `file://` ou `localhost` o browser recusa a resposta antes
   * do JS ver qualquer coisa. Em vez de afrouxar o CORS em produção (que é
   * a fronteira de verdade), a página inteira roda contra dados fictícios
   * em memória.
   *
   * Os mocks reproduzem os GUARDRAILS da function de propósito — last_master,
   * self_delete, duplicate_token. Sem isso, testar localmente validaria só o
   * caminho feliz e esconderia justamente os estados que dão trabalho de
   * acertar na UI.
   *
   * Nada aqui roda em produção: `IS_LOCAL_DEV` é falso em qualquer host que
   * não seja file://, localhost ou 127.0.0.1.
   */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  var MOCK_PW = 'local-dev';

  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · dados fictícios';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }

  function mockDelay(value) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, 220); });
  }
  function mockFail(code) {
    var err = new Error(code);
    err.code = code;
    return Promise.reject(err);
  }

  /* Espelha o formato exato que a function devolve — inclusive `token` cru,
     que só existe aqui dentro pra simular duplicata e self_delete; o que vai
     pra tela continua sendo só `token_masked`. */
  var MOCK_SENHAS = null;
  var MOCK_NEXT_ID = 0;
  var MOCK_NEXT_GRANT = 0;

  function seedMock() {
    MOCK_SENHAS = [
      { id: 1, token: MOCK_PW, label: 'senha mestre', is_master: true, paginas: [] },
      { id: 2, token: 'leitura-compartilhada-2026', label: 'leitura compartilhada', is_master: false,
        paginas: [{ id: 1, page_slug: 'retrato' }, { id: 2, page_slug: 'o-amante' }] },
      { id: 3, token: 'sul', label: 'senha antiga (curta)', is_master: false,
        paginas: [{ id: 3, page_slug: 'piramide' }] },
      { id: 4, token: 'sem-paginas-ainda-000', label: null, is_master: false, paginas: [] },
    ];
    MOCK_NEXT_ID = 5;
    MOCK_NEXT_GRANT = 4;
  }

  function mockMask(t) {
    if (!t) return '?';
    if (t.length <= 4) return '•'.repeat(t.length);
    if (t.length <= 10) return t.slice(0, 2) + '•'.repeat(t.length - 2);
    return t.slice(0, 4) + '…' + t.slice(-4);
  }

  function mockShape(s) {
    return {
      id: s.id, label: s.label, is_master: s.is_master,
      token_masked: mockMask(s.token), token_len: s.token.length,
      curta: s.token.length < 12,
      paginas: s.paginas.slice(),
    };
  }

  function mockFind(id) {
    return MOCK_SENHAS.filter(function (s) { return String(s.id) === String(id); })[0] || null;
  }
  function mockCountMasters() {
    return MOCK_SENHAS.filter(function (s) { return s.is_master; }).length;
  }

  var mockApi = {
    query: function () {
      return mockDelay({ ok: true, senhas: MOCK_SENHAS.map(mockShape), min_token_len: 12 });
    },
    create: function (senha) {
      var value = String(senha.token || '').trim();
      if (!value) return mockFail('invalid_token');
      if (MOCK_SENHAS.some(function (s) { return s.token === value; })) return mockFail('duplicate_token');
      var nova = {
        id: MOCK_NEXT_ID++, token: value,
        label: String(senha.label || '').trim() || null,
        is_master: senha.is_master === true, paginas: [],
      };
      MOCK_SENHAS.push(nova);
      return mockDelay({ ok: true, senha: mockShape(nova) });
    },
    update: function (id, patch) {
      var s = mockFind(id);
      if (!s) return mockFail('not_found');
      if ('token' in patch) {
        var value = String(patch.token || '').trim();
        if (!value) return mockFail('invalid_token');
        if (MOCK_SENHAS.some(function (o) { return o.token === value && String(o.id) !== String(id); })) {
          return mockFail('duplicate_token');
        }
      }
      if ('is_master' in patch && s.is_master && patch.is_master !== true && mockCountMasters() <= 1) {
        return mockFail('last_master');
      }
      var eraCaller = s.token === SESSION_PW;
      if ('token' in patch) s.token = String(patch.token).trim();
      if ('label' in patch) s.label = String(patch.label || '').trim() || null;
      if ('is_master' in patch) s.is_master = patch.is_master === true;
      return mockDelay({ ok: true, senha: mockShape(s), reauth: eraCaller && 'token' in patch });
    },
    remove: function (id) {
      var s = mockFind(id);
      if (!s) return mockFail('not_found');
      if (s.token === SESSION_PW) return mockFail('self_delete');
      if (s.is_master && mockCountMasters() <= 1) return mockFail('last_master');
      MOCK_SENHAS = MOCK_SENHAS.filter(function (o) { return o !== s; });
      return mockDelay({ ok: true, id: id });
    },
    grant: function (id, slug) {
      var s = mockFind(id);
      if (!s) return mockFail('not_found');
      if (s.is_master) return mockFail('master_no_scope');
      if (s.paginas.some(function (p) { return p.page_slug === slug; })) return mockFail('duplicate_grant');
      s.paginas.push({ id: MOCK_NEXT_GRANT++, page_slug: slug });
      return mockDelay({ ok: true });
    },
    revoke: function (grantId) {
      var achou = false;
      MOCK_SENHAS.forEach(function (s) {
        var antes = s.paginas.length;
        s.paginas = s.paginas.filter(function (p) { return String(p.id) !== String(grantId); });
        if (s.paginas.length !== antes) achou = true;
      });
      return achou ? mockDelay({ ok: true, id: grantId }) : mockFail('not_found');
    },
  };

  /* ── API ─────────────────────────────────────────────────────── */
  function callFn(body) {
    return fetch(SENHAS_FN, {
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

  /* Em modo local, cada chamada cai no mock equivalente — a UI não sabe a
     diferença, e é esse o ponto: o que se testa localmente é a tela inteira. */
  var api = {
    query:  function ()          { return IS_LOCAL_DEV ? mockApi.query()             : callFn({ token: SESSION_PW, action: 'query' }); },
    create: function (senha)     { return IS_LOCAL_DEV ? mockApi.create(senha)       : callFn({ token: SESSION_PW, action: 'create', senha: senha }); },
    update: function (id, patch) { return IS_LOCAL_DEV ? mockApi.update(id, patch)   : callFn({ token: SESSION_PW, action: 'update', id: id, patch: patch }); },
    remove: function (id)        { return IS_LOCAL_DEV ? mockApi.remove(id)          : callFn({ token: SESSION_PW, action: 'delete', id: id }); },
    grant:  function (id, slug)  { return IS_LOCAL_DEV ? mockApi.grant(id, slug)     : callFn({ token: SESSION_PW, action: 'grant', id: id, page_slug: slug }); },
    revoke: function (grantId)   { return IS_LOCAL_DEV ? mockApi.revoke(grantId)     : callFn({ token: SESSION_PW, action: 'revoke', id: grantId }); },
  };

  /* Mensagens dos códigos de erro que a function devolve. */
  var ERRO_MSG = {
    duplicate_token: 'já existe uma senha com esse valor',
    duplicate_grant: 'essa página já está concedida a esta senha',
    invalid_token:   'a senha não pode ficar em branco',
    last_master:     'esta é a única senha mestre — promova outra antes',
    self_delete:     'você está usando esta senha agora — entre com outra para apagá-la',
    master_no_scope: 'senha mestre já abre tudo, não precisa de escopo',
    not_found:       'registro não encontrado — recarregue a página',
    unauthorized:    'sessão expirada — entre novamente',
  };
  function msgErro(code) { return ERRO_MSG[code] || ('erro — ' + code); }

  /* ── Gate ────────────────────────────────────────────────────── */
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

  function onGateSubmit(e) {
    e.preventDefault();
    var pw = $('gate-input').value.trim();
    if (!pw) return;
    $('gate-btn').disabled = true;
    $('gate-error').textContent = '';
    SESSION_PW = pw;

    api.query().then(function (data) {
      $('gate-btn').disabled = false;
      if ($('gate-remember').checked) localStorage.setItem(LS_KEY, pw);
      else localStorage.removeItem(LS_KEY);
      $('gate').hidden = true;
      $('app').hidden = false;
      render(data.senhas);
    }).catch(function (err) {
      $('gate-btn').disabled = false;
      SESSION_PW = '';
      if (err.code === 'unauthorized') {
        shake();
        $('gate-error').textContent = 'senha incorreta';
        $('gate-input').value = '';
        $('gate-input').focus();
      } else {
        $('gate-error').textContent = 'erro ao carregar — tente de novo';
        console.error('[senhas] gate', err);
      }
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    SESSION_PW = '';
    SENHAS = [];
    DELETE_PENDING = null;
    closeSenhaModal();
    closeGrantModal();
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  /* ── Render ──────────────────────────────────────────────────── */
  function render(senhas) {
    SENHAS = senhas || [];
    DELETE_PENDING = null;
    var list = $('senha-list');

    if (!SENHAS.length) {
      /* Na prática inalcançável: sem nenhuma senha, o gate não teria deixado
         entrar. Fica como rede de segurança visual. */
      list.innerHTML = '<div class="list-empty">nenhuma senha cadastrada</div>';
      return;
    }

    list.innerHTML = SENHAS.map(cardHtml).join('');
  }

  function cardHtml(s) {
    var label = s.label
      ? '<span class="senha-label">' + esc(s.label) + '</span>'
      : '<span class="senha-label sem">sem nome</span>';

    var badges = '';
    if (s.is_master) badges += '<span class="badge badge-master">mestre</span>';
    if (s.curta) badges += '<span class="badge badge-curta">curta</span>';

    var pages;
    if (s.is_master) {
      pages = '<div class="senha-pages-master">Abre o LifeOS e todas as páginas protegidas — escopo por página não se aplica.</div>';
    } else if (!s.paginas.length) {
      pages = '<div class="senha-pages-empty">nenhuma página concedida — esta senha não abre nada</div>'
        + '<div class="page-chips" style="margin-top:9px">' + addChipHtml(s.id) + '</div>';
    } else {
      pages = '<div class="page-chips">'
        + s.paginas.map(function (p) {
            return '<span class="page-chip">' + esc(p.page_slug)
              + '<button type="button" data-revoke="' + p.id + '" title="Revogar" aria-label="Revogar ' + esc(p.page_slug) + '">'
              + '<i class="fad fa-times"></i></button></span>';
          }).join('')
        + addChipHtml(s.id)
        + '</div>';
    }

    /* Sem blog não há páginas do archive a proteger, então a seção de
       escopo vira ruído: a senha mestre abre o painel e pronto. */
    var semBlog = window.LIFEOS_BLOG && !window.LIFEOS_BLOG.habilitado();

    return '<div class="senha-card">'
      + '<div class="senha-top">'
        + label
        + '<span class="senha-token">' + esc(s.token_masked) + '</span>'
        + badges
        + '<span class="senha-actions">'
          + '<button type="button" class="row-btn" data-edit="' + s.id + '" title="Editar" aria-label="Editar"><i class="fad fa-pen"></i></button>'
          + '<button type="button" class="row-btn danger" data-delete="' + s.id + '" title="Excluir" aria-label="Excluir"><i class="fad fa-trash"></i></button>'
        + '</span>'
      + '</div>'
      + (semBlog ? '' :
          '<div class="senha-pages">'
        + '<div class="senha-pages-label">Páginas</div>'
        + pages
      + '</div>')
    + '</div>';
  }

  function addChipHtml(id) {
    return '<span class="page-chip add" data-grant="' + id + '"><i class="fad fa-plus"></i> conceder</span>';
  }

  function reload() {
    return api.query().then(function (data) { render(data.senhas); });
  }

  function setLoading(on) { $('loading').hidden = !on; }

  /* ── Modal de senha ──────────────────────────────────────────── */
  function openSenhaModal(id) {
    EDIT_ID = id || null;
    var s = id ? SENHAS.filter(function (x) { return String(x.id) === String(id); })[0] : null;

    $('senha-modal-title').textContent = s ? 'Editar senha' : 'Nova senha';
    $('senha-label-input').value = s ? (s.label || '') : '';
    $('senha-token-input').value = '';
    $('senha-master-input').checked = s ? s.is_master : false;
    $('senha-token-hint').textContent = s
      ? 'Deixe em branco para manter a senha atual.'
      : 'Use algo longo e aleatório — senhas curtas são força-brutáveis.';
    $('senha-error').textContent = '';
    $('senha-modal').classList.add('open');
    $('senha-label-input').focus();
  }

  function closeSenhaModal() {
    $('senha-modal').classList.remove('open');
    EDIT_ID = null;
  }

  function onSenhaSubmit(e) {
    e.preventDefault();
    var label = $('senha-label-input').value.trim();
    var token = $('senha-token-input').value.trim();
    var isMaster = $('senha-master-input').checked;
    var errEl = $('senha-error');
    errEl.textContent = '';

    if (!EDIT_ID && !token) {
      errEl.textContent = 'defina a senha';
      $('senha-token-input').focus();
      return;
    }

    $('senha-save').disabled = true;
    setLoading(true);

    var req;
    if (EDIT_ID) {
      /* Só manda o que mudou — `token` em branco significa "manter". */
      var patch = { label: label, is_master: isMaster };
      if (token) patch.token = token;
      req = api.update(EDIT_ID, patch);
    } else {
      req = api.create({ token: token, label: label, is_master: isMaster });
    }

    req.then(function (data) {
      setLoading(false);
      $('senha-save').disabled = false;

      /* Trocar a própria senha invalida a sessão em memória: segue com a
         nova sem derrubar o usuário no meio da edição. */
      if (data.reauth && token) {
        SESSION_PW = token;
        if (localStorage.getItem(LS_KEY)) localStorage.setItem(LS_KEY, token);
      }
      closeSenhaModal();
      return reload();
    }).catch(function (err) {
      setLoading(false);
      $('senha-save').disabled = false;
      errEl.textContent = msgErro(err.code);
      console.error('[senhas] salvar', err);
    });
  }

  /* ── Exclusão (confirmação de dois cliques, padrão do LifeOS) ── */
  function resetDeletePending() {
    DELETE_PENDING = null;
    var btns = document.querySelectorAll('.row-btn.pending');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('pending');
      btns[i].innerHTML = '<i class="fad fa-trash"></i>';
      btns[i].title = 'Excluir';
    }
  }

  function onDelete(btn, id) {
    if (DELETE_PENDING !== id) {
      resetDeletePending();
      DELETE_PENDING = id;
      btn.classList.add('pending');
      btn.innerHTML = '<i class="fad fa-check"></i>';
      btn.title = 'Confirmar exclusão';
      return;
    }
    resetDeletePending();
    setLoading(true);
    api.remove(id).then(function () {
      setLoading(false);
      return reload();
    }).catch(function (err) {
      setLoading(false);
      alertInline(msgErro(err.code));
      console.error('[senhas] excluir', err);
    });
  }

  /* Erro fora de modal — a lista não tem lugar fixo pra mensagem, então
     usa a barra de aviso do topo, que já existe no layout. */
  function alertInline(msg) {
    var notice = document.querySelector('.notice span');
    if (!notice) return;
    var antigo = notice.innerHTML;
    notice.innerHTML = '<strong style="color:var(--red)">' + esc(msg) + '</strong>';
    setTimeout(function () { notice.innerHTML = antigo; }, 5000);
  }

  /* ── Modal de concessão de página ────────────────────────────── */
  function openGrantModal(id) {
    GRANT_ID = id;
    var s = SENHAS.filter(function (x) { return String(x.id) === String(id); })[0];
    $('grant-modal-title').textContent = s && s.label ? 'Conceder a “' + s.label + '”' : 'Conceder página';
    $('grant-error').textContent = '';
    populatePageSelect(s);
    $('grant-modal').classList.add('open');
  }

  function closeGrantModal() {
    $('grant-modal').classList.remove('open');
    GRANT_ID = null;
  }

  /* Lista de páginas vinda do manifest do archive, menos as que esta senha
     já tem. O manifest é a única fonte que conhece os slugs; ele não diz
     quais carregam gate.js, então a lista é de candidatas, não de
     protegidas — o hint do modal avisa. */
  function populatePageSelect(senha) {
    var sel = $('grant-page-select');
    var jaTem = {};
    if (senha) senha.paginas.forEach(function (p) { jaTem[p.page_slug] = true; });

    var manifest = window.PSYCHES_MANIFEST;
    var entries = (manifest && manifest.entries) ? manifest.entries : [];

    var opts = ['<option value="">— selecionar —</option>'];
    entries
      .filter(function (e) { return e.slug && !jaTem[e.slug]; })
      .sort(function (a, b) { return a.slug < b.slug ? -1 : 1; })
      .forEach(function (e) {
        var titulo = stripMarkup(e.title || e.slug);
        opts.push('<option value="' + esc(e.slug) + '">' + esc(e.slug) + ' — ' + esc(titulo) + '</option>');
      });

    if (opts.length === 1) opts.push('<option value="" disabled>todas as páginas já concedidas</option>');
    sel.innerHTML = opts.join('');
  }

  function onGrantSubmit(e) {
    e.preventDefault();
    var slug = $('grant-page-select').value;
    if (!slug) { $('grant-error').textContent = 'selecione uma página'; return; }

    $('grant-save').disabled = true;
    setLoading(true);
    api.grant(GRANT_ID, slug).then(function () {
      setLoading(false);
      $('grant-save').disabled = false;
      closeGrantModal();
      return reload();
    }).catch(function (err) {
      setLoading(false);
      $('grant-save').disabled = false;
      $('grant-error').textContent = msgErro(err.code);
      console.error('[senhas] conceder', err);
    });
  }

  function onRevoke(grantId) {
    setLoading(true);
    api.revoke(grantId).then(function () {
      setLoading(false);
      return reload();
    }).catch(function (err) {
      setLoading(false);
      alertInline(msgErro(err.code));
      console.error('[senhas] revogar', err);
    });
  }

  /* ── Boot ────────────────────────────────────────────────────── */
  function boot() {
    /* Local: pula o gate por inteiro — não há backend contra o que validar. */
    if (IS_LOCAL_DEV) {
      showDevBadge();
      seedMock();
      SESSION_PW = MOCK_PW;
      $('gate').hidden = true;
      $('app').hidden = false;
      api.query().then(function (data) { render(data.senhas); });
      return;
    }

    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }

    $('gate').hidden = false;
    $('gate-form').hidden = true;
    $('gate-checking').hidden = false;
    SESSION_PW = saved;

    api.query().then(function (data) {
      $('gate').hidden = true;
      $('app').hidden = false;
      render(data.senhas);
    }).catch(function (err) {
      SESSION_PW = '';
      localStorage.removeItem(LS_KEY);
      $('gate-checking').hidden = true;
      showGateForm();
      if (err.code === 'unauthorized') $('gate-error').textContent = 'sessão expirada — entre novamente';
      else console.error('[senhas] boot', err);
    });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('add-senha-btn').addEventListener('click', function () { openSenhaModal(null); });

    $('senha-form').addEventListener('submit', onSenhaSubmit);
    $('senha-cancel').addEventListener('click', closeSenhaModal);
    $('senha-modal-close').addEventListener('click', closeSenhaModal);
    $('senha-modal').addEventListener('click', function (e) {
      if (e.target === $('senha-modal')) closeSenhaModal();
    });

    $('grant-form').addEventListener('submit', onGrantSubmit);
    $('grant-cancel').addEventListener('click', closeGrantModal);
    $('grant-modal-close').addEventListener('click', closeGrantModal);
    $('grant-modal').addEventListener('click', function (e) {
      if (e.target === $('grant-modal')) closeGrantModal();
    });

    /* Delegação: a lista é re-renderizada inteira a cada mudança, então
       prender listeners nos botões individuais custaria re-prender sempre. */
    $('senha-list').addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;

      var edit = t.closest('[data-edit]');
      if (edit) { resetDeletePending(); openSenhaModal(edit.getAttribute('data-edit')); return; }

      var del = t.closest('[data-delete]');
      if (del) { onDelete(del, del.getAttribute('data-delete')); return; }

      var grant = t.closest('[data-grant]');
      if (grant) { resetDeletePending(); openGrantModal(grant.getAttribute('data-grant')); return; }

      var revoke = t.closest('[data-revoke]');
      if (revoke) { resetDeletePending(); onRevoke(revoke.getAttribute('data-revoke')); return; }

      resetDeletePending();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('grant-modal').classList.contains('open')) { closeGrantModal(); return; }
      if ($('senha-modal').classList.contains('open')) { closeSenhaModal(); return; }
      resetDeletePending();
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
