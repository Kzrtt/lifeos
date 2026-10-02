/* renuncias.js — renúncias (lifeos/renuncias.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Hábitos que o autor cortou, e há quanto tempo está sem cada um. Cada
 * renúncia conta a partir de `desde` (a última vez — pode ser no passado,
 * com hora) e mostra uma barra até o próximo marco da escala MARCOS
 * (1d, 3d, 7d… 10a), no espírito do Quitzilla.
 *
 * Duas entidades:
 *
 *   renúncia   — nome + emoji + desde + arquivada
 *   tentativa  — uma tentativa encerrada por recaída (inicio → fim). O
 *                recorde e a contagem de recaídas saem daqui.
 *
 * O tempo corrido anda sozinho: tick() atualiza a cada segundo só os nós
 * marcados (data-tempo / data-bar / data-falta), sem re-render — senão a
 * exclusão de dois cliques e o hover se perderiam a cada segundo. Quando um
 * marco é cruzado, aí sim re-renderiza (o "próximo marco" mudou).
 *
 * Escrita só por aqui; o MCP só lê (search_renuncias).
 *
 * Backend: Edge Function `lifeos-renuncias`. Ver LIFEOS.md §19.
 */
(function () {
  'use strict';

  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em renuncias.html');

  var REN_FN = CFG.supabaseUrl + '/functions/v1/lifeos-renuncias';
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey;

  /* Mesmos limites de lifeos-renuncias/index.ts — cópia, não import (§2). */
  var MAX_NOME = 80;
  var MAX_EMOJI = 16;

  /* A escala dos marcos, em dias. Mês = 30 dias e ano = 365, de propósito:
     a barra precisa de um alvo fixo, e o MCP (search_renuncias) usa a mesma
     lista — mudou aqui, muda lá. */
  var DIA = 86400000;
  var MARCOS = [
    { dias: 1,    rot: '1 dia' },
    { dias: 3,    rot: '3 dias' },
    { dias: 7,    rot: '7 dias' },
    { dias: 14,   rot: '14 dias' },
    { dias: 21,   rot: '21 dias' },
    { dias: 30,   rot: '1 mês' },
    { dias: 60,   rot: '2 meses' },
    { dias: 90,   rot: '3 meses' },
    { dias: 180,  rot: '6 meses' },
    { dias: 270,  rot: '9 meses' },
    { dias: 365,  rot: '1 ano' },
    { dias: 730,  rot: '2 anos' },
    { dias: 1095, rot: '3 anos' },
    { dias: 1825, rot: '5 anos' },
    { dias: 3650, rot: '10 anos' },
  ];

  /* Sugestões do seletor — o campo ao lado aceita qualquer outro. */
  var EMOJIS = ['🚬', '🍺', '🍷', '🥃', '☕', '🥤', '🍬', '🍫', '🍩', '🍔', '🍟', '🍕',
    '📱', '📺', '🎮', '🎰', '🛒', '💸', '🔞', '🌿', '💊', '😴', '🤬', '💅', '🧠', '🚭', '✋', '🔥'];

  var SESSION_PW = '';
  var RENUNCIAS = [];
  var FILTRO = 'ativas';       /* 'ativas' | 'arquivadas' */
  var DETALHE_ID = null;       /* renúncia aberta no detalhe */
  var DETALHE_IDX = null;      /* próximo marco quando o detalhe foi desenhado */
  var EDIT_RENUNCIA_ID = null; /* null = criando */
  var DELETE_PENDING = null;   /* 'del:<id>' | 'rec:<id>' */
  var TICK = null;

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  function p2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtData(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function fmtDataHora(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return fmtData(iso) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  /* Date → valor de <input type="datetime-local"> (hora local, sem fuso). */
  function toLocalInput(d) {
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
      + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  /* Valor do input → ISO, ou null. `new Date('AAAA-MM-DDTHH:MM')` lê em hora local. */
  function fromLocalInput(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  }

  /* ── Tempo ───────────────────────────────────────────────────────── */
  function decorrido(r, now) { return Math.max(0, now - Date.parse(r.desde)); }

  /* Índice do próximo marco (o primeiro ainda não alcançado); -1 = todos. */
  function proximoIdx(ms) {
    for (var i = 0; i < MARCOS.length; i++) if (MARCOS[i].dias * DIA > ms) return i;
    return -1;
  }

  /* "23d 04h 12m 08s" com número e unidade separados — o .tempo do CSS
     diminui a unidade. Passou de um ano, vira "1a 23d 04h 12m". */
  function tempoHtml(ms) {
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    function u(n, un) { return '<b>' + n + '</b><span>' + un + '</span>'; }
    if (d >= 365) return u(Math.floor(d / 365), 'a') + u(d % 365, 'd') + u(p2(h), 'h') + u(p2(m), 'm');
    if (d > 0) return u(d, 'd') + u(p2(h), 'h') + u(p2(m), 'm') + u(p2(sec), 's');
    return u(h, 'h') + u(p2(m), 'm') + u(p2(sec), 's');
  }

  /* Duração curta, as duas maiores unidades: "2a 10d", "8d 4h", "3h 12m", "45s". */
  function duracao(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 365) return Math.floor(d / 365) + 'a ' + (d % 365) + 'd';
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return s + 's';
  }

  function recordeMs(r, now) {
    var best = decorrido(r, now);
    (r.tentativas || []).forEach(function (t) {
      var dur = Date.parse(t.fim) - Date.parse(t.inicio);
      if (dur > best) best = dur;
    });
    return best;
  }
  function melhorTentativaMs(r) {
    var best = 0;
    (r.tentativas || []).forEach(function (t) {
      var dur = Date.parse(t.fim) - Date.parse(t.inicio);
      if (dur > best) best = dur;
    });
    return best;
  }

  /* ── Modo local ───────────────────────────────────────────────────
     Mesma razão das outras telas: CORS impede falar com a Edge Function de
     file:// ou localhost. O mock reproduz o nome único, a validação de data
     no futuro e a recaída anterior ao início — sem isso o teste local só
     cobriria o caminho feliz. Datas relativas a agora, pra o contador e as
     barras aparecerem em estados diferentes. */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · dados fictícios';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }
  function mockDelay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 200); }); }
  function mockFail(code) { var e = new Error(code); e.code = code; return Promise.reject(e); }

  var MOCK = null;
  var MOCK_SEQ = 100;
  function seedMock() {
    var now = Date.now();
    function atras(ms) { return new Date(now - ms).toISOString(); }
    var H = 3600000;
    MOCK = {
      renuncias: [
        { id: 'r1', nome: 'Refrigerante', emoji: '🥤', desde: atras(47 * DIA + 5 * H), arquivada: false,
          created_at: atras(80 * DIA), updated_at: atras(47 * DIA),
          tentativas: [{ id: 't1', inicio: atras(80 * DIA), fim: atras(47 * DIA + 5 * H) }] },
        { id: 'r2', nome: 'Redes sociais', emoji: '📱', desde: atras(2 * DIA + 9 * H), arquivada: false,
          created_at: atras(40 * DIA), updated_at: atras(2 * DIA),
          tentativas: [
            { id: 't2', inicio: atras(12 * DIA), fim: atras(2 * DIA + 9 * H) },
            { id: 't3', inicio: atras(40 * DIA), fim: atras(12 * DIA) },
          ] },
        { id: 'r3', nome: 'Café depois das 16h', emoji: '☕', desde: atras(5 * H), arquivada: false,
          created_at: atras(5 * H), updated_at: atras(5 * H), tentativas: [] },
        { id: 'r4', nome: 'Doces', emoji: '🍬', desde: atras(400 * DIA), arquivada: true,
          created_at: atras(400 * DIA), updated_at: atras(10 * DIA), tentativas: [] },
      ],
    };
  }
  function mockRen(id) { return MOCK.renuncias.filter(function (r) { return r.id === id; })[0] || null; }
  function mockNomeExiste(nome, exceto) {
    var k = nome.trim().toLowerCase();
    return MOCK.renuncias.some(function (r) { return r.id !== exceto && r.nome.trim().toLowerCase() === k; });
  }
  /* Mesma regra de cleanInstante() da function: futuro (com 5 min de folga) é inválido. */
  function mockInstanteOk(iso) { var t = Date.parse(iso); return isFinite(t) && t <= Date.now() + 300000; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ── API ─────────────────────────────────────────────────────────── */
  function callFn(body) {
    body.token = SESSION_PW;
    return fetch(REN_FN, {
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

  var api = {
    query: function () {
      if (IS_LOCAL_DEV) return mockDelay({ ok: true, renuncias: clone(MOCK.renuncias) });
      return callFn({ action: 'query' });
    },
    create: function (r) {
      if (IS_LOCAL_DEV) {
        if (mockNomeExiste(r.nome)) return mockFail('nome_duplicado');
        if (!mockInstanteOk(r.desde)) return mockFail('invalid_desde');
        var now = new Date().toISOString();
        var nova = { id: 'r' + (++MOCK_SEQ), nome: r.nome, emoji: r.emoji, desde: r.desde, arquivada: false,
          created_at: now, updated_at: now, tentativas: [] };
        MOCK.renuncias.push(nova);
        return mockDelay({ ok: true, renuncia: clone(nova) });
      }
      return callFn({ action: 'create', renuncia: r });
    },
    update: function (id, patch) {
      if (IS_LOCAL_DEV) {
        var r = mockRen(id);
        if (!r) return mockFail('not_found');
        if (patch.nome && mockNomeExiste(patch.nome, id)) return mockFail('nome_duplicado');
        if (patch.desde && !mockInstanteOk(patch.desde)) return mockFail('invalid_desde');
        Object.assign(r, patch, { updated_at: new Date().toISOString() });
        return mockDelay({ ok: true, renuncia: clone(r) });
      }
      return callFn({ action: 'update', id: id, patch: patch });
    },
    remove: function (id) {
      if (IS_LOCAL_DEV) {
        if (!mockRen(id)) return mockFail('not_found');
        MOCK.renuncias = MOCK.renuncias.filter(function (r) { return r.id !== id; });
        return mockDelay({ ok: true, id: id });
      }
      return callFn({ action: 'delete', id: id });
    },
    recaida: function (id, quando) {
      if (IS_LOCAL_DEV) {
        var r = mockRen(id);
        if (!r) return mockFail('not_found');
        if (!mockInstanteOk(quando)) return mockFail('invalid_quando');
        if (Date.parse(quando) < Date.parse(r.desde)) return mockFail('quando_antes_do_inicio');
        r.tentativas.unshift({ id: 't' + (++MOCK_SEQ), inicio: r.desde, fim: quando });
        r.desde = quando;
        r.updated_at = new Date().toISOString();
        return mockDelay({ ok: true, renuncia: clone(r) });
      }
      return callFn({ action: 'recaida', id: id, quando: quando });
    },
  };

  var ERRO = {
    nome_duplicado: 'já existe uma renúncia com esse nome',
    invalid_nome: 'nome vazio ou longo demais (máx. ' + MAX_NOME + ')',
    invalid_emoji: 'escolha um emoji',
    invalid_desde: 'data inválida ou no futuro',
    invalid_quando: 'data da recaída inválida ou no futuro',
    quando_antes_do_inicio: 'a recaída não pode ser antes do começo desta tentativa',
    invalid_arquivada: 'valor inválido — recarregue a página',
    not_found: 'não encontrada — recarregue a página',
    unauthorized: 'sessão expirada — entre novamente',
  };
  function msgErro(err) { return ERRO[err.code] || ('erro — ' + err.code); }

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

  function enterApp(data) {
    $('gate').hidden = true;
    $('app').hidden = false;
    applyData(data);
    if (!TICK) TICK = setInterval(tick, 1000);
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
      enterApp(data);
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
        console.error('[renuncias] gate', err);
      }
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    if (TICK) { clearInterval(TICK); TICK = null; }
    SESSION_PW = ''; RENUNCIAS = []; FILTRO = 'ativas';
    DELETE_PENDING = null;
    closeRenunciaModal(); closeDetalhe();
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  /* ── Dados ───────────────────────────────────────────────────────── */
  function applyData(data) {
    RENUNCIAS = data.renuncias || [];
    if (FILTRO === 'arquivadas' && !RENUNCIAS.some(function (r) { return r.arquivada; })) FILTRO = 'ativas';
    render();
    if (DETALHE_ID) {
      if (acharRenuncia(DETALHE_ID)) renderDetalhe(); else closeDetalhe();
    }
  }
  function reload() { return api.query().then(applyData); }
  function acharRenuncia(id) { return RENUNCIAS.filter(function (r) { return r.id === id; })[0] || null; }
  function setLoading(on) { $('loading').hidden = !on; }

  /* ── Render da lista ─────────────────────────────────────────────── */
  function renderChips() {
    var nArq = RENUNCIAS.filter(function (r) { return r.arquivada; }).length;
    $('toolbar').hidden = !nArq;
    if (!nArq) return;
    var nAt = RENUNCIAS.length - nArq;
    $('filtro-chips').innerHTML =
      '<button type="button" class="cat-chip' + (FILTRO === 'ativas' ? ' on' : '') + '" data-filtro="ativas">Ativas <span class="chip-n">' + nAt + '</span></button>'
      + '<button type="button" class="cat-chip' + (FILTRO === 'arquivadas' ? ' on' : '') + '" data-filtro="arquivadas">Arquivadas <span class="chip-n">' + nArq + '</span></button>';
  }

  function render() {
    DELETE_PENDING = null;
    renderChips();
    var host = $('renuncias');

    if (!RENUNCIAS.length) {
      host.innerHTML = '<div class="list-vazio"><i class="fad fa-hourglass-start"></i>'
        + 'Nenhuma renúncia ainda.<br>Crie uma em <strong>Nova renúncia</strong> — a data da última vez pode ser no passado.</div>';
      return;
    }

    var arq = FILTRO === 'arquivadas';
    var visiveis = RENUNCIAS.filter(function (r) { return !!r.arquivada === arq; });
    if (!visiveis.length) {
      host.innerHTML = '<div class="list-vazio">todas as renúncias estão arquivadas</div>';
      return;
    }
    var now = Date.now();
    /* Há mais tempo primeiro. */
    visiveis.sort(function (a, b) { return Date.parse(a.desde) - Date.parse(b.desde); });
    host.innerHTML = '<div class="ren-grid">' + visiveis.map(function (r) { return cardHtml(r, now); }).join('') + '</div>';
  }

  /* Bloco "próximo marco" + barra, compartilhado entre card e detalhe. O
     data-prox guarda o índice renderizado — tick() compara para saber se
     um marco foi cruzado. */
  function proxHtml(r, ms) {
    var i = proximoIdx(ms);
    if (i === -1) {
      return '<div class="prox" data-prox="' + esc(r.id) + '" data-idx="-1"><span><strong>todos os marcos</strong> conquistados</span></div>'
        + '<div class="bar"><i style="width:100%"></i></div>';
    }
    var alvo = MARCOS[i].dias * DIA;
    return '<div class="prox" data-prox="' + esc(r.id) + '" data-idx="' + i + '">'
        + '<span>próximo marco · <strong>' + MARCOS[i].rot + '</strong></span>'
        + '<span class="falta" data-falta="' + esc(r.id) + '" data-alvo="' + alvo + '">faltam ' + duracao(alvo - ms) + '</span>'
      + '</div>'
      + '<div class="bar"><i data-bar="' + esc(r.id) + '" data-alvo="' + alvo + '" style="width:' + pct(ms, alvo) + '%"></i></div>';
  }

  function pct(ms, alvo) { return Math.min(100, (ms / alvo) * 100).toFixed(2); }

  function cardHtml(r, now) {
    var ms = decorrido(r, now);
    var idx = proximoIdx(ms);
    var trilha = MARCOS.map(function (m, i) {
      var cls = (idx === -1 || i < idx) ? 'ok' : (i === idx ? 'prox-dot' : '');
      return '<i class="' + cls + '" title="' + m.rot + '"></i>';
    }).join('');
    var n = (r.tentativas || []).length;
    var melhor = melhorTentativaMs(r);
    var foot = [];
    if (n) foot.push('<span><i class="fad fa-redo"></i>' + n + (n === 1 ? ' recaída' : ' recaídas') + '</span>');
    if (melhor) {
      foot.push(ms >= melhor
        ? '<span><i class="fad fa-trophy"></i>recorde atual</span>'
        : '<span><i class="fad fa-trophy"></i>recorde ' + duracao(melhor) + '</span>');
    }

    return '<button type="button" class="ren-card' + (r.arquivada ? ' arquivada' : '') + '" data-open="' + esc(r.id) + '">'
      + '<div class="ren-top">'
        + '<div class="ren-emoji">' + esc(r.emoji) + '</div>'
        + '<div class="ren-id">'
          + '<div class="ren-nome">' + esc(r.nome) + '</div>'
          + '<div class="ren-desde">desde ' + esc(fmtDataHora(r.desde)) + (r.arquivada ? ' · arquivada' : '') + '</div>'
        + '</div>'
      + '</div>'
      + '<div class="tempo ren-tempo" data-tempo="' + esc(r.id) + '">' + tempoHtml(ms) + '</div>'
      + proxHtml(r, ms)
      + '<div class="trilha">' + trilha + '</div>'
      + (foot.length ? '<div class="ren-foot">' + foot.join('') + '</div>' : '')
    + '</button>';
  }

  /* ── Tick: o relógio anda sem re-render ──────────────────────────── */
  function tick() {
    if ($('app').hidden) return;
    var now = Date.now();
    var cruzou = false;

    var proxs = document.querySelectorAll('[data-prox]');
    for (var i = 0; i < proxs.length; i++) {
      var r0 = acharRenuncia(proxs[i].getAttribute('data-prox'));
      if (r0 && String(proximoIdx(decorrido(r0, now))) !== proxs[i].getAttribute('data-idx')) cruzou = true;
    }
    /* O detalhe confere por conta própria: o card dele pode não estar na
       tela (filtro de arquivadas). */
    var rd = DETALHE_ID && acharRenuncia(DETALHE_ID);
    if (rd && proximoIdx(decorrido(rd, now)) !== DETALHE_IDX) cruzou = true;
    if (cruzou) {
      /* Marco cruzado: o "próximo" mudou, a trilha também. Re-render
         completo — a não ser com uma confirmação pendente, que esperaria. */
      if (!DELETE_PENDING) { render(); if (DETALHE_ID) renderDetalhe(); }
      return;
    }

    each('[data-tempo]', function (el, r) { el.innerHTML = tempoHtml(decorrido(r, now)); });
    each('[data-bar]', function (el, r) { el.style.width = pct(decorrido(r, now), +el.getAttribute('data-alvo')) + '%'; });
    each('[data-falta]', function (el, r) { el.textContent = 'faltam ' + duracao(+el.getAttribute('data-alvo') - decorrido(r, now)); });
  }
  function each(sel, fn) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var attr = sel.slice(1, -1);
      var r = acharRenuncia(els[i].getAttribute(attr));
      if (r) fn(els[i], r);
    }
  }

  /* ── Detalhe ─────────────────────────────────────────────────────── */
  function openDetalhe(id) {
    var r = acharRenuncia(id);
    if (!r) return;
    resetDeletePending();
    DETALHE_ID = id;
    renderDetalhe();
    $('detalhe-modal').classList.add('open');
  }

  function closeDetalhe() {
    $('detalhe-modal').classList.remove('open');
    DETALHE_ID = null;
  }

  function renderDetalhe() {
    var r = acharRenuncia(DETALHE_ID);
    if (!r) return;
    DELETE_PENDING = null;
    var now = Date.now();
    var ms = decorrido(r, now);
    var inicio = Date.parse(r.desde);
    var idx = proximoIdx(ms);
    DETALHE_IDX = idx;
    var tents = r.tentativas || [];
    var melhor = melhorTentativaMs(r);
    var rec = recordeMs(r, now);
    var ehRecorde = ms >= melhor;

    $('detalhe-emoji').textContent = r.emoji;
    $('detalhe-nome').textContent = r.nome;
    $('detalhe-meta').textContent = 'desde ' + fmtDataHora(r.desde) + (r.arquivada ? ' · arquivada' : '');

    var marcos = MARCOS.map(function (m, i) {
      var alvo = m.dias * DIA;
      var cls, info;
      if (idx === -1 || i < idx) { cls = 'ok'; info = '<i class="fad fa-check"></i> ' + fmtData(new Date(inicio + alvo).toISOString()); }
      else if (i === idx) { cls = 'atual'; info = '<span data-falta="' + esc(r.id) + '" data-alvo="' + alvo + '">faltam ' + duracao(alvo - ms) + '</span>'; }
      else { cls = 'futuro'; info = 'em ' + fmtData(new Date(inicio + alvo).toISOString()); }
      var w = cls === 'ok' ? '100' : pct(ms, alvo);
      var barAttr = cls === 'ok' ? '' : ' data-bar="' + esc(r.id) + '" data-alvo="' + alvo + '"';
      return '<li class="marco ' + cls + '">'
        + '<span class="marco-rot">' + m.rot + '</span>'
        + '<div class="bar"><i' + barAttr + ' style="width:' + w + '%"></i></div>'
        + '<span class="marco-info">' + info + '</span>'
      + '</li>';
    }).join('');

    var tentsHtml = tents.length
      ? '<ul class="tents">' + tents.map(function (t) {
          var dur = Date.parse(t.fim) - Date.parse(t.inicio);
          var top = dur === melhor && !ehRecorde;
          return '<li class="tent">'
            + '<span>' + esc(fmtDataHora(t.inicio)) + ' → ' + esc(fmtDataHora(t.fim)) + '</span>'
            + '<span class="tent-dur' + (top ? ' recorde' : '') + '">' + (top ? '<i class="fad fa-trophy"></i>' : '') + duracao(dur) + '</span>'
          + '</li>';
        }).join('') + '</ul>'
      : '<div class="tents-vazio">nenhuma recaída — esta é a primeira tentativa</div>';

    var agora = toLocalInput(new Date());
    $('detalhe-body').innerHTML =
      '<div class="tempo det-tempo" data-tempo="' + esc(r.id) + '">' + tempoHtml(ms) + '</div>'
      + '<div class="det-stats">'
        + '<div class="det-stat"><div class="det-stat-num">' + (idx === -1 ? MARCOS.length : idx) + '/' + MARCOS.length + '</div><div class="det-stat-label">marcos</div></div>'
        + '<div class="det-stat' + (ehRecorde ? ' recorde' : '') + '"><div class="det-stat-num">' + duracao(rec) + '</div><div class="det-stat-label">' + (ehRecorde ? 'recorde · atual' : 'recorde') + '</div></div>'
        + '<div class="det-stat"><div class="det-stat-num">' + tents.length + '</div><div class="det-stat-label">' + (tents.length === 1 ? 'recaída' : 'recaídas') + '</div></div>'
      + '</div>'

      + '<div class="sec-label">marcos</div>'
      + '<ol class="marcos">' + marcos + '</ol>'

      + (r.arquivada ? '' :
        '<div class="sec-label">recaída</div>'
        + '<div class="recaida-box">'
          + '<input type="datetime-local" class="edit-input" id="recaida-quando" value="' + agora + '" max="' + agora + '" aria-label="Quando foi a recaída">'
          + '<button type="button" class="edit-btn edit-btn-danger" data-recaida="' + esc(r.id) + '" data-orig="Recaí"><i class="fad fa-redo"></i> Recaí</button>'
        + '</div>'
        + '<div class="recaida-hint">Guarda esta tentativa (' + esc(duracao(ms)) + ') no histórico e recomeça o contador a partir da data acima. Clique duas vezes para confirmar.</div>'
        + '<div class="edit-error" id="recaida-error"></div>')

      + '<div class="sec-label">histórico <span class="n">' + tents.length + '</span></div>'
      + tentsHtml

      + '<div class="det-actions">'
        + '<button type="button" class="row-btn" data-edit="' + esc(r.id) + '"><i class="fad fa-pen"></i> Editar</button>'
        + '<button type="button" class="row-btn" data-arquivar="' + esc(r.id) + '">'
          + (r.arquivada ? '<i class="fad fa-box-open"></i> Desarquivar' : '<i class="fad fa-archive"></i> Arquivar') + '</button>'
        + '<button type="button" class="row-btn danger" data-del="' + esc(r.id) + '" title="Excluir renúncia e histórico"><i class="fad fa-trash"></i></button>'
      + '</div>';
  }

  function onRecaida(btn, id) {
    var errEl = $('recaida-error');
    errEl.textContent = '';
    var input = $('recaida-quando');
    /* O input tem precisão de minuto: deixado no valor padrão ("agora"),
       vale o instante exato — senão o contador recomeçaria já com segundos. */
    var quando = input.value === input.defaultValue ? new Date().toISOString() : fromLocalInput(input.value);
    if (!quando) { errEl.textContent = 'informe quando foi'; return; }
    confirmar(btn, 'rec:' + id, function () { return api.recaida(id, quando); }, function (err) {
      errEl.textContent = msgErro(err);
    });
  }

  function onArquivar(id) {
    var r = acharRenuncia(id);
    if (!r) return;
    setLoading(true);
    api.update(id, { arquivada: !r.arquivada }).then(function () {
      setLoading(false);
      closeDetalhe();
      return reload();
    }).catch(function (err) {
      setLoading(false);
      aviso(msgErro(err));
      console.error('[renuncias] arquivar', err);
    });
  }

  /* ── Modal de criar/editar ───────────────────────────────────────── */
  function buildEmojiGrid() {
    $('emoji-grid').innerHTML = EMOJIS.map(function (e) {
      return '<button type="button" class="emoji-opt" data-emoji="' + e + '" aria-label="' + e + '">' + e + '</button>';
    }).join('');
  }

  function setEmoji(e) {
    $('renuncia-emoji').value = e;
    syncEmoji();
  }
  function syncEmoji() {
    var v = $('renuncia-emoji').value.trim();
    $('renuncia-preview').textContent = v || '✋';
    var opts = $('emoji-grid').querySelectorAll('.emoji-opt');
    for (var i = 0; i < opts.length; i++) opts[i].classList.toggle('is-selected', opts[i].getAttribute('data-emoji') === v);
  }

  function openRenunciaModal(id) {
    var r = id ? acharRenuncia(id) : null;
    EDIT_RENUNCIA_ID = r ? r.id : null;
    $('renuncia-modal-title').textContent = r ? 'Editar renúncia' : 'Nova renúncia';
    $('renuncia-nome').value = r ? r.nome : '';
    setEmoji(r ? r.emoji : EMOJIS[0]);
    var agora = toLocalInput(new Date());
    $('renuncia-desde').max = agora;
    $('renuncia-desde').value = r ? toLocalInput(new Date(r.desde)) : agora;
    $('renuncia-desde').setAttribute('data-padrao', $('renuncia-desde').value);
    $('renuncia-desde-hint').textContent = r
      ? 'Corrigir a data aqui não registra recaída. Se você recaiu, use "Recaí" no detalhe — assim a tentativa vai pro histórico.'
      : 'Já vem com agora. Se a última vez foi antes, ajuste — o contador começa dali.';
    $('renuncia-error').textContent = '';
    $('renuncia-modal').classList.add('open');
    $('renuncia-nome').focus();
  }

  function closeRenunciaModal() {
    $('renuncia-modal').classList.remove('open');
    EDIT_RENUNCIA_ID = null;
  }

  function onRenunciaSubmit(e) {
    e.preventDefault();
    var errEl = $('renuncia-error');
    errEl.textContent = '';
    var nome = $('renuncia-nome').value.trim();
    var emoji = $('renuncia-emoji').value.trim();
    var desdeVal = $('renuncia-desde').value;
    /* Criando com o valor padrão ("agora"): o instante exato, não o minuto cheio. */
    var desde = (!EDIT_RENUNCIA_ID && desdeVal === $('renuncia-desde').getAttribute('data-padrao'))
      ? new Date().toISOString()
      : fromLocalInput(desdeVal);

    if (!nome) { errEl.textContent = 'diga do que você está abrindo mão'; $('renuncia-nome').focus(); return; }
    if (nome.length > MAX_NOME) { errEl.textContent = ERRO.invalid_nome; return; }
    if (!emoji || emoji.length > MAX_EMOJI) { errEl.textContent = ERRO.invalid_emoji; return; }
    if (!desde) { errEl.textContent = 'informe a data da última vez'; $('renuncia-desde').focus(); return; }
    if (Date.parse(desde) > Date.now() + 60000) { errEl.textContent = 'a data não pode estar no futuro'; return; }

    /* Guardado ANTES do close — close zera EDIT_RENUNCIA_ID (LIFEOS.md §9). */
    var editandoId = EDIT_RENUNCIA_ID;
    var req;
    if (editandoId) {
      /* Só manda `desde` se mudou: o input tem precisão de minuto, e
         reenviar arredondaria os segundos do valor original. */
      var atual = acharRenuncia(editandoId);
      var patch = { nome: nome, emoji: emoji };
      if (!atual || toLocalInput(new Date(atual.desde)) !== desdeVal) patch.desde = desde;
      req = api.update(editandoId, patch);
    } else {
      req = api.create({ nome: nome, emoji: emoji, desde: desde });
    }

    $('renuncia-save').disabled = true;
    setLoading(true);
    req.then(function () {
      setLoading(false);
      $('renuncia-save').disabled = false;
      closeRenunciaModal();
      return reload().then(function () { if (editandoId) openDetalhe(editandoId); });
    }).catch(function (err) {
      setLoading(false);
      $('renuncia-save').disabled = false;
      errEl.textContent = msgErro(err);
      console.error('[renuncias] salvar', err);
    });
  }

  /* ── Confirmação de dois cliques — cópia do padrão, LIFEOS.md §7 ─────
     Serve à exclusão e à recaída. O botão guarda o rótulo original em
     data-orig (a recaída tem texto, a lixeira só o ícone). */
  function resetDeletePending() {
    DELETE_PENDING = null;
    var btns = document.querySelectorAll('.pending');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('pending');
      var orig = btns[i].getAttribute('data-orig');
      btns[i].innerHTML = orig ? '<i class="fad fa-redo"></i> ' + esc(orig) : '<i class="fad fa-trash"></i>';
    }
  }

  function confirmar(btn, key, run, onErr) {
    if (DELETE_PENDING !== key) {
      resetDeletePending();
      DELETE_PENDING = key;
      btn.classList.add('pending');
      btn.innerHTML = btn.getAttribute('data-orig')
        ? '<i class="fad fa-check"></i> Confirmar recaída'
        : '<i class="fad fa-check"></i>';
      return;
    }
    resetDeletePending();
    setLoading(true);
    run().then(function () {
      setLoading(false);
      return reload();
    }).catch(function (err) {
      setLoading(false);
      if (onErr) onErr(err); else aviso(msgErro(err));
      console.error('[renuncias] ' + key, err);
    });
  }

  /* Mensagem temporária na barra de aviso — mesmo recurso de memoria.js. */
  function aviso(msg) {
    var el = $('notice-text');
    if (!el.dataset.original) el.dataset.original = el.innerHTML;
    el.innerHTML = '<strong style="color:var(--red)">' + esc(msg) + '</strong>';
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () { el.innerHTML = el.dataset.original; }, 5000);
  }

  /* ── Boot ────────────────────────────────────────────────────────── */
  function boot() {
    if (IS_LOCAL_DEV) {
      showDevBadge();
      seedMock();
      SESSION_PW = 'local-dev';
      api.query().then(enterApp);
      return;
    }

    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }

    $('gate').hidden = false;
    $('gate-form').hidden = true;
    $('gate-checking').hidden = false;
    SESSION_PW = saved;

    api.query().then(enterApp).catch(function (err) {
      SESSION_PW = '';
      localStorage.removeItem(LS_KEY);
      $('gate-checking').hidden = true;
      showGateForm();
      if (err.code === 'unauthorized') $('gate-error').textContent = 'sessão expirada — entre novamente';
      else console.error('[renuncias] boot', err);
    });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    buildEmojiGrid();
    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('add-renuncia-btn').addEventListener('click', function () { resetDeletePending(); openRenunciaModal(null); });

    $('renuncia-form').addEventListener('submit', onRenunciaSubmit);
    $('renuncia-cancel').addEventListener('click', closeRenunciaModal);
    $('renuncia-modal-close').addEventListener('click', closeRenunciaModal);
    $('renuncia-modal').addEventListener('click', function (e) { if (e.target === $('renuncia-modal')) closeRenunciaModal(); });
    $('renuncia-emoji').addEventListener('input', syncEmoji);
    $('emoji-grid').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-emoji]');
      if (b) setEmoji(b.getAttribute('data-emoji'));
    });

    $('detalhe-modal-close').addEventListener('click', function () { resetDeletePending(); closeDetalhe(); });
    $('detalhe-modal').addEventListener('click', function (e) {
      if (e.target === $('detalhe-modal')) { resetDeletePending(); closeDetalhe(); }
    });

    $('filtro-chips').addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-filtro]');
      if (!chip) return;
      FILTRO = chip.getAttribute('data-filtro');
      render();
    });

    /* Delegação: a lista é re-renderizada inteira a cada mudança. */
    $('renuncias').addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-open]');
      if (el) openDetalhe(el.getAttribute('data-open'));
    });

    /* Idem no corpo do detalhe, re-renderizado a cada recarga. */
    $('detalhe-body').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el;
      if ((el = t.closest('[data-del]'))) {
        var did = el.getAttribute('data-del');
        confirmar(el, 'del:' + did, function () {
          return api.remove(did).then(function (res) { closeDetalhe(); return res; });
        });
        return;
      }
      if ((el = t.closest('[data-recaida]'))) { onRecaida(el, el.getAttribute('data-recaida')); return; }
      if (t.closest('#recaida-quando')) return;
      resetDeletePending();
      if ((el = t.closest('[data-edit]'))) {
        var eid = el.getAttribute('data-edit');
        closeDetalhe();
        openRenunciaModal(eid);
        return;
      }
      if ((el = t.closest('[data-arquivar]'))) { onArquivar(el.getAttribute('data-arquivar')); return; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('renuncia-modal').classList.contains('open')) { closeRenunciaModal(); return; }
      if (DELETE_PENDING) { resetDeletePending(); return; }
      if ($('detalhe-modal').classList.contains('open')) { closeDetalhe(); return; }
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
