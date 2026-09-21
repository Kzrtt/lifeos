/* tags.js — vocabulários do sistema (lifeos/tags.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Uma seção por domínio: tipos de nota, status de tarefa, meios de pagamento
 * e assim por diante. Até a migration 0002 essas listas eram constantes em
 * cada JS, cópias em cada Edge Function e CHECK no banco; agora são linhas
 * de `lifeos_vocabularios`.
 *
 * DUAS COISAS QUE A TELA PRECISA DEIXAR ÓBVIAS, porque mexem em dado real:
 *
 *   1. RENOMEAR MIGRA OS DADOS. Não é só trocar o rótulo — as linhas que
 *      usam o valor antigo são atualizadas na mesma transação. A tela avisa
 *      antes ("47 linhas serão atualizadas") e confirma depois.
 *
 *   2. APAGAR SÓ FUNCIONA SE NINGUÉM USA. A contagem de uso vem junto da
 *      listagem, então o botão já nasce desabilitado quando há uso — em vez
 *      de deixar clicar e falhar.
 *
 * `protegido` marca os valores que o CÓDIGO conhece por nome ('Feito',
 * 'Entrada', 'Crédito'…). Renomeáveis, nunca apagáveis: apagar quebraria o
 * cálculo de progresso ou o de saldo em silêncio.
 *
 * Backend: Edge Function `lifeos-vocabularios`.
 */
(function () {
  'use strict';

  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em tags.html');

  var VOCAB_FN = CFG.supabaseUrl + '/functions/v1/lifeos-vocabularios';
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey;

  var SESSION_PW = '';
  var DOMINIOS = {};      /* metadados vindos da function */
  var VOCAB = {};         /* { dominio: [ {id, valor, cor, ordem, protegido, uso} ] } */
  var EDIT = null;        /* { dominio, id? } — id ausente = criando */
  var DELETE_PENDING = null;

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  /* ── Modo local ───────────────────────────────────────────────────
     Mesma razão das outras telas: CORS impede falar com a Edge Function de
     file:// ou localhost. O mock reproduz os guardrails (protegido, em uso,
     duplicado) de propósito — sem eles, testar localmente validaria só o
     caminho feliz. */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · dados fictícios';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }
  function mockDelay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 220); }); }
  function mockFail(code, extra) {
    var e = new Error(code); e.code = code;
    if (extra) Object.assign(e, extra);
    return Promise.reject(e);
  }

  var MOCK_DOM = {
    nota_tipo:      { rotulo: 'Tipos de nota',       tabela: 'lifeos_notas',       coluna: 'tipo',   array: true,  cor: false },
    tarefa_status:  { rotulo: 'Status de tarefa',    tabela: 'lifeos_tarefas',     coluna: 'status', array: false, cor: false },
    evento_tipo:    { rotulo: 'Tipos de evento',     tabela: 'lifeos_eventos',     coluna: 'tipo',   array: false, cor: true  },
    mov_meio:       { rotulo: 'Meios de pagamento',  tabela: 'lifeos_movimentacoes', coluna: 'tipo', array: true,  cor: false },
  };
  var MOCK_VOCAB = null;
  var MOCK_SEQ = 100;
  function seedMock() {
    MOCK_VOCAB = {
      nota_tipo: [
        { id: 'm1', valor: 'Pesquisa', cor: null, ordem: 10, protegido: false, uso: 14 },
        { id: 'm2', valor: 'Vida', cor: null, ordem: 20, protegido: false, uso: 0 },
      ],
      tarefa_status: [
        { id: 'm3', valor: 'Não Iniciado', cor: null, ordem: 10, protegido: true, uso: 9 },
        { id: 'm4', valor: 'Feito', cor: null, ordem: 20, protegido: true, uso: 52 },
      ],
      evento_tipo: [
        { id: 'm5', valor: 'trabalho', cor: '#c4913a', ordem: 10, protegido: false, uso: 3 },
        { id: 'm6', valor: 'lazer', cor: '#3fb98c', ordem: 20, protegido: false, uso: 0 },
      ],
      mov_meio: [
        { id: 'm7', valor: 'Crédito', cor: null, ordem: 10, protegido: true, uso: 45 },
        { id: 'm8', valor: 'Pix', cor: null, ordem: 20, protegido: false, uso: 0 },
      ],
    };
  }
  function mockAchar(id) {
    for (var d in MOCK_VOCAB) {
      for (var i = 0; i < MOCK_VOCAB[d].length; i++) {
        if (MOCK_VOCAB[d][i].id === id) return { dominio: d, item: MOCK_VOCAB[d][i] };
      }
    }
    return null;
  }

  /* ── API ─────────────────────────────────────────────────────────── */
  function callFn(body) {
    return fetch(VOCAB_FN, {
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
          err.uso = data.uso;
          throw err;
        }
        return data;
      });
    });
  }

  var api = {
    query: function () {
      if (IS_LOCAL_DEV) return mockDelay({ ok: true, dominios: MOCK_DOM, vocabularios: MOCK_VOCAB });
      return callFn({ token: SESSION_PW, action: 'query' });
    },
    create: function (dominio, valor, cor) {
      if (IS_LOCAL_DEV) {
        if (MOCK_VOCAB[dominio].some(function (v) { return v.valor === valor; })) return mockFail('valor_duplicado');
        MOCK_VOCAB[dominio].push({ id: 'm' + (++MOCK_SEQ), valor: valor, cor: cor || null, ordem: 999, protegido: false, uso: 0 });
        return mockDelay({ ok: true });
      }
      return callFn({ token: SESSION_PW, action: 'create', dominio: dominio, valor: valor, cor: cor });
    },
    update: function (id, novoValor, cor) {
      if (IS_LOCAL_DEV) {
        var h = mockAchar(id);
        if (!h) return mockFail('not_found');
        if (novoValor && novoValor !== h.item.valor &&
            MOCK_VOCAB[h.dominio].some(function (v) { return v.valor === novoValor; })) return mockFail('valor_duplicado');
        var migradas = null;
        if (novoValor && novoValor !== h.item.valor) { migradas = h.item.uso; h.item.valor = novoValor; }
        if (cor) h.item.cor = cor;
        return mockDelay({ ok: true, linhas_migradas: migradas });
      }
      return callFn({ token: SESSION_PW, action: 'update', id: id, novo_valor: novoValor, cor: cor });
    },
    remove: function (id) {
      if (IS_LOCAL_DEV) {
        var h = mockAchar(id);
        if (!h) return mockFail('not_found');
        if (h.item.protegido) return mockFail('protegido');
        if (h.item.uso > 0) return mockFail('em_uso', { uso: h.item.uso });
        MOCK_VOCAB[h.dominio] = MOCK_VOCAB[h.dominio].filter(function (v) { return v.id !== id; });
        return mockDelay({ ok: true });
      }
      return callFn({ token: SESSION_PW, action: 'delete', id: id });
    },
  };

  var ERRO = {
    valor_duplicado: 'já existe um valor igual neste domínio',
    valor_vazio: 'o valor não pode ficar em branco',
    cor_invalida: 'cor inválida',
    dominio_invalido: 'domínio inválido — recarregue a página',
    protegido: 'este valor é usado pela lógica do sistema e não pode ser apagado',
    not_found: 'registro não encontrado — recarregue a página',
    unauthorized: 'sessão expirada — entre novamente',
  };
  function msgErro(err) {
    if (err.code === 'em_uso') {
      return err.uso + (err.uso === 1 ? ' linha usa' : ' linhas usam') + ' este valor — renomeie em vez de apagar';
    }
    return ERRO[err.code] || ('erro — ' + err.code);
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
      render(data);
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
        console.error('[tags] gate', err);
      }
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    SESSION_PW = ''; VOCAB = {}; DELETE_PENDING = null;
    closeModal();
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  function render(data) {
    DOMINIOS = data.dominios || {};
    VOCAB = data.vocabularios || {};
    DELETE_PENDING = null;

    var html = Object.keys(DOMINIOS).map(function (d) {
      var meta = DOMINIOS[d];
      var itens = VOCAB[d] || [];

      var linhas = itens.length
        ? itens.map(function (v) { return linhaHtml(d, v); }).join('')
        : '';

      return '<section class="dom">'
        + '<div class="dom-head">'
          + '<span class="dom-nome">' + esc(meta.rotulo) + '</span>'
          + '<span class="dom-onde">' + esc(meta.tabela + '.' + meta.coluna)
            + (meta.array ? '[]' : '') + '</span>'
          + '<button type="button" class="dom-add" data-add="' + esc(d) + '">'
          + '<i class="fad fa-plus"></i> Adicionar</button>'
        + '</div>'
        + (linhas
            ? '<table class="tags"><tbody>' + linhas + '</tbody></table>'
            : '<div class="dom-vazio">nenhum valor — os seletores deste domínio ficam vazios</div>')
      + '</section>';
    }).join('');

    $('dominios').innerHTML = html;
  }

  function linhaHtml(dominio, v) {
    var swatch = v.cor
      ? '<span class="swatch" style="background:' + esc(v.cor) + '"></span>'
      : '';
    var badge = v.protegido ? '<span class="badge">protegido</span>' : '';

    /* `uso` pode ser null quando a contagem falhou — não é o mesmo que zero,
       e tratar como zero liberaria apagar algo em uso. */
    var usoTxt = v.uso === null || v.uso === undefined
      ? '<span class="td-uso">uso ?</span>'
      : '<span class="td-uso' + (v.uso === 0 ? ' zero' : '') + '">'
        + v.uso + (v.uso === 1 ? ' linha' : ' linhas') + '</span>';

    var podeApagar = !v.protegido && v.uso === 0;
    var tituloApagar = v.protegido
      ? 'Protegido — não pode ser apagado'
      : (v.uso === 0 ? 'Excluir' : v.uso + ' linha(s) usam este valor');

    return '<tr>'
      + '<td class="td-valor">' + swatch + esc(v.valor) + badge + '</td>'
      + '<td class="td-uso">' + usoTxt + '</td>'
      + '<td class="td-acoes">'
        + '<button type="button" class="row-btn" data-edit="' + esc(v.id) + '" data-dominio="' + esc(dominio) + '" title="Renomear"><i class="fad fa-pen"></i></button>'
        + '<button type="button" class="row-btn danger" data-delete="' + esc(v.id) + '"'
          + (podeApagar ? '' : ' disabled')
          + ' title="' + esc(tituloApagar) + '"><i class="fad fa-trash"></i></button>'
      + '</td>'
    + '</tr>';
  }

  function reload() { return api.query().then(render); }
  function setLoading(on) { $('loading').hidden = !on; }

  /* ── Modal ───────────────────────────────────────────────────────── */
  function achar(id) {
    for (var d in VOCAB) {
      for (var i = 0; i < VOCAB[d].length; i++) {
        if (VOCAB[d][i].id === id) return { dominio: d, item: VOCAB[d][i] };
      }
    }
    return null;
  }

  function openModal(dominio, id) {
    var meta = DOMINIOS[dominio] || {};
    var hit = id ? achar(id) : null;
    EDIT = { dominio: dominio, id: id || null };

    $('tag-modal-title').textContent = hit ? 'Renomear' : 'Nova tag';
    $('tag-valor').value = hit ? hit.item.valor : '';
    $('tag-error').textContent = '';

    $('tag-cor-field').hidden = !meta.cor;
    if (meta.cor) $('tag-cor').value = (hit && hit.item.cor) || '#c4913a';

    /* O aviso de migração é o ponto inteiro desta tela: quem renomeia
       precisa saber que o dado muda junto, e quanto dado. */
    var aviso = $('tag-aviso');
    if (hit && hit.item.uso > 0) {
      aviso.hidden = false;
      aviso.innerHTML = '<strong>' + hit.item.uso + (hit.item.uso === 1 ? ' linha' : ' linhas')
        + '</strong> de <code>' + esc(meta.tabela) + '</code> usam este valor e '
        + (hit.item.uso === 1 ? 'será atualizada' : 'serão atualizadas') + ' junto. '
        + 'A troca acontece numa transação só — ou tudo muda, ou nada muda.';
    } else {
      aviso.hidden = true;
      aviso.textContent = '';
    }

    $('tag-valor-hint').textContent = hit
      ? 'O texto gravado nas linhas de dados. Renomear atualiza os dados também.'
      : 'Aparece nos seletores deste domínio assim que salvar.';

    $('tag-modal').classList.add('open');
    $('tag-valor').focus();
  }

  function closeModal() {
    $('tag-modal').classList.remove('open');
    EDIT = null;
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!EDIT) return;
    var valor = $('tag-valor').value.trim();
    var meta = DOMINIOS[EDIT.dominio] || {};
    var cor = meta.cor ? $('tag-cor').value : '';
    var errEl = $('tag-error');
    errEl.textContent = '';

    if (!valor) {
      errEl.textContent = 'defina o valor';
      $('tag-valor').focus();
      return;
    }

    $('tag-save').disabled = true;
    setLoading(true);

    var req = EDIT.id ? api.update(EDIT.id, valor, cor) : api.create(EDIT.dominio, valor, cor);

    req.then(function (data) {
      setLoading(false);
      $('tag-save').disabled = false;
      closeModal();
      return reload().then(function () {
        if (data.linhas_migradas) {
          aviso(data.linhas_migradas + (data.linhas_migradas === 1 ? ' linha migrada' : ' linhas migradas'));
        }
      });
    }).catch(function (err) {
      setLoading(false);
      $('tag-save').disabled = false;
      errEl.textContent = msgErro(err);
      console.error('[tags] salvar', err);
    });
  }

  /* ── Exclusão (dois cliques) ─────────────────────────────────────── */
  function resetDeletePending() {
    DELETE_PENDING = null;
    var btns = document.querySelectorAll('.row-btn.pending');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('pending');
      btns[i].innerHTML = '<i class="fad fa-trash"></i>';
    }
  }

  function onDelete(btn, id) {
    if (DELETE_PENDING !== id) {
      resetDeletePending();
      DELETE_PENDING = id;
      btn.classList.add('pending');
      btn.innerHTML = '<i class="fad fa-check"></i>';
      return;
    }
    resetDeletePending();
    setLoading(true);
    api.remove(id).then(function () {
      setLoading(false);
      return reload();
    }).catch(function (err) {
      setLoading(false);
      aviso(msgErro(err), true);
      console.error('[tags] excluir', err);
    });
  }

  /* Mensagem temporária na barra do topo — a lista não tem lugar fixo
     pra erro, e a barra de aviso já existe no layout. */
  function aviso(msg, erro) {
    var el = document.querySelector('.notice span');
    if (!el) return;
    if (!el.dataset.original) el.dataset.original = el.innerHTML;
    el.innerHTML = '<strong style="color:var(--' + (erro ? 'red' : 'green') + ')">' + esc(msg) + '</strong>';
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () { el.innerHTML = el.dataset.original; }, 5000);
  }

  /* ── Boot ────────────────────────────────────────────────────────── */
  function boot() {
    if (IS_LOCAL_DEV) {
      showDevBadge();
      seedMock();
      SESSION_PW = 'local-dev';
      $('gate').hidden = true;
      $('app').hidden = false;
      api.query().then(render);
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
      render(data);
    }).catch(function (err) {
      SESSION_PW = '';
      localStorage.removeItem(LS_KEY);
      $('gate-checking').hidden = true;
      showGateForm();
      if (err.code === 'unauthorized') $('gate-error').textContent = 'sessão expirada — entre novamente';
      else console.error('[tags] boot', err);
    });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('tag-form').addEventListener('submit', onSubmit);
    $('tag-cancel').addEventListener('click', closeModal);
    $('tag-modal-close').addEventListener('click', closeModal);
    $('tag-modal').addEventListener('click', function (e) {
      if (e.target === $('tag-modal')) closeModal();
    });

    /* Delegação: a lista é re-renderizada inteira a cada mudança. */
    $('dominios').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var add = t.closest('[data-add]');
      if (add) { resetDeletePending(); openModal(add.getAttribute('data-add'), null); return; }

      var edit = t.closest('[data-edit]');
      if (edit) { resetDeletePending(); openModal(edit.getAttribute('data-dominio'), edit.getAttribute('data-edit')); return; }

      var del = t.closest('[data-delete]');
      if (del && !del.disabled) { onDelete(del, del.getAttribute('data-delete')); return; }

      resetDeletePending();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('tag-modal').classList.contains('open')) { closeModal(); return; }
      resetDeletePending();
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
