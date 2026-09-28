/* memoria.js — memória de longo prazo (lifeos/memoria.html)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * O que uma IA aprendeu sobre o autor, guardado fora de qualquer harness ou
 * modelo. Qualquer cliente conectado ao MCP do LifeOS lê daqui (list_memorias,
 * get_memoria…); esta tela é o lado humano — ver, corrigir, podar.
 *
 * Duas entidades, no formato de um MEMORY.md + arquivos:
 *
 *   memória   — título + descrição curta (o índice) + categoria
 *   registro  — um fato datado dentro de uma memória; cresce por append
 *
 * A lista é agrupada por categoria (ordem do vocabulário `memoria_categoria`,
 * editável em Tags) e cada memória expande no lugar pra mostrar os registros
 * em ordem cronológica — o que se sabe, e desde quando.
 *
 * Diferente do MCP (que só cria e edita), aqui se EXCLUI também: memória
 * errada é pior que memória nenhuma, e podar é trabalho de humano.
 *
 * Backend: Edge Function `lifeos-memorias`. Ver LIFEOS.md §17.
 */
(function () {
  'use strict';

  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em memoria.html');

  var MEM_FN = CFG.supabaseUrl + '/functions/v1/lifeos-memorias';
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey;

  /* Mesmos limites de lifeos-memorias/index.ts — cópia, não import (§2). */
  var MAX_TITULO = 120;
  var MAX_DESCRICAO = 400;
  var MAX_TEXTO = 8000;

  var SESSION_PW = '';
  var MEMORIAS = [];
  var CATEGORIAS = [];
  var EXPANDED = {};          /* { memoriaId: true } — sobrevive a re-render */
  var CAT_FILTRO = '';        /* '' = todas */
  var ORIGEM_FILTRO = '';     /* '' = todas; SEM_ORIGEM = registros com origem nula */
  var BUSCA = '';
  var EDIT_MEMORIA_ID = null; /* null = criando */
  var EDIT_REGISTRO_ID = null;
  var DELETE_PENDING = null;  /* 'm:<id>' | 'r:<id>' */

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  /* ── Origem ──────────────────────────────────────────────────────
     A origem é do REGISTRO, não da memória: uma mesma memória junta fatos
     de clientes diferentes. Cada origem ganha cor + ícone + rótulo legível;
     as conhecidas têm valores fixos, qualquer outra (um cliente novo que se
     identificou de outro jeito) recebe uma cor ESTÁVEL derivada do nome —
     a mesma origem sempre com a mesma cor, sem precisar de cadastro.
     Cores fixas em hex, não tokens: todos os temas do LifeOS são escuros, e
     as origens precisam se distinguir do acento do tema (--gold). */
  var SEM_ORIGEM = '__sem_origem__';
  var ORIGENS = {
    'claude-code': { rotulo: 'Claude Code', icone: 'fa-terminal',  cor: '#e08a5f' },
    'claude.ai':   { rotulo: 'Claude web',  icone: 'fa-comments',  cor: '#a98be0' },
    'manual':      { rotulo: 'Você (tela)', icone: 'fa-user-edit', cor: '#9aabbf' },
    'mcp':         { rotulo: 'MCP',         icone: 'fa-plug',      cor: '#5fb3c9' },
  };
  var ORIGEM_PALETA = ['#57c49a', '#d9b44a', '#d47a9b', '#7fa6e0', '#c9a0dc', '#e0a370'];

  function origemKey(o) { return o ? String(o) : SEM_ORIGEM; }
  function origemInfo(key) {
    if (key === SEM_ORIGEM) return { rotulo: 'sem origem', icone: 'fa-question', cor: '#7d8590' };
    if (ORIGENS[key]) return ORIGENS[key];
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return { rotulo: key, icone: 'fa-robot', cor: ORIGEM_PALETA[h % ORIGEM_PALETA.length] };
  }

  function origemPill(key, extra) {
    var o = origemInfo(key);
    return '<span class="origem" style="--oc:' + o.cor + '" title="origem: '
      + esc(key === SEM_ORIGEM ? 'não informada' : key) + '">'
      + '<i class="fad ' + o.icone + '"></i>' + esc(o.rotulo) + (extra || '') + '</span>';
  }

  /* Registros da memória que passam no filtro de origem. */
  function regsVisiveis(m) {
    var regs = m.registros || [];
    if (!ORIGEM_FILTRO) return regs;
    return regs.filter(function (r) { return origemKey(r.origem) === ORIGEM_FILTRO; });
  }

  function fmtData(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* ── Modo local ───────────────────────────────────────────────────
     Mesma razão das outras telas: CORS impede falar com a Edge Function de
     file:// ou localhost. O mock reproduz o título único e o toque em
     updated_at da memória-mãe — sem isso o teste local só cobriria o
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
  function mockDelay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 200); }); }
  function mockFail(code) { var e = new Error(code); e.code = code; return Promise.reject(e); }

  var MOCK = null;
  var MOCK_SEQ = 100;
  function seedMock() {
    var t0 = '2026-09-10T14:00:00Z', t1 = '2026-09-20T09:30:00Z';
    MOCK = {
      categorias: ['Perfil', 'Preferências', 'Projetos', 'Referências', 'Vida'],
      memorias: [
        { id: 'm1', titulo: 'Quem sou', categoria: 'Perfil', created_at: t0, updated_at: t1,
          descricao: 'Trabalho, formação, rotina e os projetos que mantenho.',
          registros: [
            { id: 'r1', memoria_id: 'm1', texto: 'Trabalha como desenvolvedor; mantém projetos pessoais à noite.', origem: 'claude-code', created_at: t0, updated_at: t0 },
            { id: 'r2', memoria_id: 'm1', texto: 'Prefere respostas em português, sem rodeio.', origem: 'claude.ai', created_at: t1, updated_at: t1 },
          ] },
        { id: 'm2', titulo: 'Tom de escrita', categoria: 'Preferências', created_at: t0, updated_at: t0,
          descricao: 'Como textos escritos em nome do autor devem soar.',
          registros: [
            { id: 'r3', memoria_id: 'm2', texto: 'Calibrar entre coach demais e minimalismo demais.', origem: 'manual', created_at: t0, updated_at: t0 },
          ] },
        { id: 'm3', titulo: 'LifeOS', categoria: 'Projetos', created_at: t0, updated_at: t0,
          descricao: '', registros: [] },
      ],
    };
  }
  function mockMem(id) { return MOCK.memorias.filter(function (m) { return m.id === id; })[0] || null; }
  function mockReg(id) {
    for (var i = 0; i < MOCK.memorias.length; i++) {
      var r = MOCK.memorias[i].registros.filter(function (x) { return x.id === id; })[0];
      if (r) return { mem: MOCK.memorias[i], reg: r };
    }
    return null;
  }
  function mockTituloExiste(titulo, exceto) {
    var k = titulo.trim().toLowerCase();
    return MOCK.memorias.some(function (m) { return m.id !== exceto && m.titulo.trim().toLowerCase() === k; });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ── API ─────────────────────────────────────────────────────────── */
  function callFn(body) {
    body.token = SESSION_PW;
    return fetch(MEM_FN, {
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
      if (IS_LOCAL_DEV) return mockDelay({ ok: true, memorias: clone(MOCK.memorias), categorias: MOCK.categorias.slice() });
      return callFn({ action: 'query' });
    },
    create: function (m) {
      if (IS_LOCAL_DEV) {
        if (mockTituloExiste(m.titulo)) return mockFail('titulo_duplicado');
        var now = new Date().toISOString();
        var nova = { id: 'm' + (++MOCK_SEQ), titulo: m.titulo, descricao: m.descricao, categoria: m.categoria,
          created_at: now, updated_at: now, registros: [] };
        (m.registros || []).forEach(function (t) {
          nova.registros.push({ id: 'r' + (++MOCK_SEQ), memoria_id: nova.id, texto: t, origem: 'manual', created_at: now, updated_at: now });
        });
        MOCK.memorias.unshift(nova);
        return mockDelay({ ok: true, memoria: clone(nova) });
      }
      return callFn({ action: 'create', memoria: m });
    },
    update: function (id, patch) {
      if (IS_LOCAL_DEV) {
        var m = mockMem(id);
        if (!m) return mockFail('not_found');
        if (patch.titulo && mockTituloExiste(patch.titulo, id)) return mockFail('titulo_duplicado');
        Object.assign(m, patch, { updated_at: new Date().toISOString() });
        return mockDelay({ ok: true, memoria: clone(m) });
      }
      return callFn({ action: 'update', id: id, patch: patch });
    },
    remove: function (id) {
      if (IS_LOCAL_DEV) {
        MOCK.memorias = MOCK.memorias.filter(function (m) { return m.id !== id; });
        return mockDelay({ ok: true, id: id });
      }
      return callFn({ action: 'delete', id: id });
    },
    registroCreate: function (memoriaId, texto) {
      if (IS_LOCAL_DEV) {
        var m = mockMem(memoriaId);
        if (!m) return mockFail('not_found');
        var now = new Date().toISOString();
        var r = { id: 'r' + (++MOCK_SEQ), memoria_id: memoriaId, texto: texto, origem: 'manual', created_at: now, updated_at: now };
        m.registros.push(r); m.updated_at = now;
        return mockDelay({ ok: true, registro: clone(r) });
      }
      return callFn({ action: 'registro_create', registro: { memoria_id: memoriaId, texto: texto, origem: 'manual' } });
    },
    registroUpdate: function (id, texto) {
      if (IS_LOCAL_DEV) {
        var h = mockReg(id);
        if (!h) return mockFail('not_found');
        var now = new Date().toISOString();
        h.reg.texto = texto; h.reg.updated_at = now; h.mem.updated_at = now;
        return mockDelay({ ok: true, registro: clone(h.reg) });
      }
      return callFn({ action: 'registro_update', id: id, patch: { texto: texto } });
    },
    registroRemove: function (id) {
      if (IS_LOCAL_DEV) {
        var h = mockReg(id);
        if (!h) return mockFail('not_found');
        h.mem.registros = h.mem.registros.filter(function (x) { return x.id !== id; });
        h.mem.updated_at = new Date().toISOString();
        return mockDelay({ ok: true, id: id });
      }
      return callFn({ action: 'registro_delete', id: id });
    },
  };

  var ERRO = {
    titulo_duplicado: 'já existe uma memória com esse título',
    invalid_titulo: 'título vazio ou longo demais (máx. ' + MAX_TITULO + ')',
    invalid_descricao: 'descrição longa demais (máx. ' + MAX_DESCRICAO + ')',
    invalid_categoria: 'categoria inválida — recarregue a página',
    invalid_texto: 'registro vazio ou longo demais (máx. ' + MAX_TEXTO + ')',
    not_found: 'não encontrado — recarregue a página',
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
        console.error('[memoria] gate', err);
      }
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    SESSION_PW = ''; MEMORIAS = []; EXPANDED = {}; CAT_FILTRO = ''; ORIGEM_FILTRO = ''; BUSCA = '';
    DELETE_PENDING = null;
    $('busca-input').value = '';
    closeMemoriaModal(); closeRegistroModal();
    $('gate-input').value = '';
    $('gate-remember').checked = false;
    $('gate-error').textContent = '';
    showGateForm();
  }

  /* ── Dados ───────────────────────────────────────────────────────── */
  function applyData(data) {
    MEMORIAS = data.memorias || [];
    CATEGORIAS = data.categorias || [];
    if (CAT_FILTRO && CATEGORIAS.indexOf(CAT_FILTRO) === -1) CAT_FILTRO = '';
    if (ORIGEM_FILTRO && !contarOrigens()[ORIGEM_FILTRO]) ORIGEM_FILTRO = '';
    renderChips();
    render();
  }

  /* { origemKey: nº de registros } sobre TODAS as memórias — os chips de
     origem nascem dos dados, não de uma lista fixa. */
  function contarOrigens() {
    var c = {};
    MEMORIAS.forEach(function (m) {
      (m.registros || []).forEach(function (r) {
        var k = origemKey(r.origem);
        c[k] = (c[k] || 0) + 1;
      });
    });
    return c;
  }
  function reload() { return api.query().then(applyData); }
  function acharMemoria(id) { return MEMORIAS.filter(function (m) { return m.id === id; })[0] || null; }
  function acharRegistro(id) {
    for (var i = 0; i < MEMORIAS.length; i++) {
      var regs = MEMORIAS[i].registros || [];
      for (var j = 0; j < regs.length; j++) if (regs[j].id === id) return { mem: MEMORIAS[i], reg: regs[j] };
    }
    return null;
  }
  function setLoading(on) { $('loading').hidden = !on; }

  /* ── Render ──────────────────────────────────────────────────────── */
  function renderChips() {
    var cats = [''].concat(CATEGORIAS);
    $('cat-chips').innerHTML = cats.map(function (c) {
      return '<button type="button" class="cat-chip' + (c === CAT_FILTRO ? ' on' : '') + '" data-cat="' + esc(c) + '">'
        + esc(c || 'Todas') + '</button>';
    }).join('');

    /* Linha de origem: só aparece quando há registros. Ordem por volume —
       quem mais escreveu primeiro. O número é de REGISTROS, não de memórias. */
    var cont = contarOrigens();
    var keys = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a] || a.localeCompare(b); });
    var row = $('origem-row');
    row.hidden = !keys.length;
    $('origem-chips').innerHTML = '<button type="button" class="cat-chip' + (ORIGEM_FILTRO ? '' : ' on') + '" data-origem="">Todas</button>'
      + keys.map(function (k) {
        var o = origemInfo(k);
        return '<button type="button" class="cat-chip origem-chip' + (k === ORIGEM_FILTRO ? ' on' : '') + '" data-origem="' + esc(k) + '" style="--oc:' + o.cor + '">'
          + '<i class="fad ' + o.icone + '"></i>' + esc(o.rotulo) + ' <span class="chip-n">' + cont[k] + '</span></button>';
      }).join('');
  }

  /* Com filtro de origem ativo, a busca só olha os registros daquela origem
     — senão uma memória apareceria por causa de um texto que está oculto. */
  function bateBusca(m, termo) {
    if (!termo) return true;
    if ((m.titulo || '').toLowerCase().indexOf(termo) !== -1) return true;
    if ((m.descricao || '').toLowerCase().indexOf(termo) !== -1) return true;
    return regsVisiveis(m).some(function (r) { return (r.texto || '').toLowerCase().indexOf(termo) !== -1; });
  }

  function render() {
    DELETE_PENDING = null;
    var host = $('memorias');

    if (!MEMORIAS.length) {
      host.innerHTML = '<div class="list-vazio"><i class="fad fa-brain"></i>'
        + 'Nenhuma memória ainda.<br>Crie uma aqui, ou peça a uma IA conectada ao MCP pra '
        + '<strong>registrar o que sabe sobre você</strong>.</div>';
      return;
    }

    var termo = BUSCA.trim().toLowerCase();
    var visiveis = MEMORIAS.filter(function (m) {
      return (!CAT_FILTRO || m.categoria === CAT_FILTRO)
        && (!ORIGEM_FILTRO || regsVisiveis(m).length > 0)
        && bateBusca(m, termo);
    });

    if (!visiveis.length) {
      host.innerHTML = '<div class="list-vazio">nenhuma memória bate com esse filtro</div>';
      return;
    }

    /* Grupos na ordem do vocabulário; categoria que saiu da lista (renomeada
       fora da tela, ou vocabulário que falhou) cai num grupo no fim em vez de
       sumir — memória invisível é memória perdida. */
    var ordem = CATEGORIAS.slice();
    visiveis.forEach(function (m) { if (ordem.indexOf(m.categoria) === -1) ordem.push(m.categoria); });

    host.innerHTML = ordem.map(function (cat) {
      var doGrupo = visiveis.filter(function (m) { return m.categoria === cat; });
      if (!doGrupo.length) return '';
      doGrupo.sort(function (a, b) { return a.titulo.localeCompare(b.titulo, 'pt-BR'); });
      return '<section class="cat-group">'
        + '<div class="cat-label">' + esc(cat) + ' <span class="n">' + doGrupo.length + '</span></div>'
        + doGrupo.map(memoriaHtml).join('')
      + '</section>';
    }).join('');
  }

  function memoriaHtml(m) {
    var todos = m.registros || [];
    var regs = regsVisiveis(m);
    var aberta = !!EXPANDED[m.id];
    var n = todos.length;
    var ocultos = n - regs.length;

    /* Resumo de proveniência: uma pill por origem presente na memória, com
       quantos registros vieram dela. Sempre sobre TODOS os registros — o
       filtro recorta a lista, não esconde de onde a memória veio. */
    var porOrigem = {};
    todos.forEach(function (r) { var k = origemKey(r.origem); porOrigem[k] = (porOrigem[k] || 0) + 1; });
    var origensHtml = Object.keys(porOrigem)
      .sort(function (a, b) { return porOrigem[b] - porOrigem[a]; })
      .map(function (k) { return origemPill(k, ' <span class="chip-n">' + porOrigem[k] + '</span>'); })
      .join('');

    var contagem = ORIGEM_FILTRO
      ? regs.length + ' de ' + n + (n === 1 ? ' registro' : ' registros')
      : n + (n === 1 ? ' registro' : ' registros');

    var head = '<button type="button" class="mem-head" data-toggle="' + esc(m.id) + '" aria-expanded="' + aberta + '">'
      + '<div class="mem-main">'
        + '<div class="mem-titulo">' + esc(m.titulo) + '</div>'
        + (m.descricao
            ? '<div class="mem-desc">' + esc(m.descricao) + '</div>'
            : '<div class="mem-desc vazia">sem descrição — o índice fica mudo sobre esta memória</div>')
        + '<div class="mem-meta">' + contagem + ' · atualizada ' + esc(fmtData(m.updated_at)) + '</div>'
        + (origensHtml ? '<div class="mem-origens">' + origensHtml + '</div>' : '')
      + '</div>'
      + '<i class="fad fa-chevron-down mem-chev"></i>'
    + '</button>';

    if (!aberta) return '<article class="mem">' + head + '</article>';

    var lista = regs.length
      ? '<ol class="regs">' + regs.map(registroHtml).join('') + '</ol>'
      : '<div class="regs-vazio">nenhum registro ainda</div>';
    if (ocultos > 0) {
      lista += '<button type="button" class="regs-ocultos" data-limpar-origem>'
        + ocultos + (ocultos === 1 ? ' registro de outra origem oculto' : ' registros de outras origens ocultos')
        + ' pelo filtro — mostrar todos</button>';
    }

    var body = '<div class="mem-body">'
      + '<div class="mem-actions">'
        + '<button type="button" class="row-btn" data-edit-mem="' + esc(m.id) + '" title="Editar título, descrição e categoria"><i class="fad fa-pen"></i></button>'
        + '<button type="button" class="row-btn danger" data-del-mem="' + esc(m.id) + '" title="Excluir memória'
          + (n ? ' e ' + n + (n === 1 ? ' registro' : ' registros') : '') + '"><i class="fad fa-trash"></i></button>'
      + '</div>'
      + lista
      + '<div class="composer">'
        + '<textarea data-composer="' + esc(m.id) + '" placeholder="um fato novo sobre isto…" maxlength="' + MAX_TEXTO + '"></textarea>'
        + '<div class="composer-row">'
          + '<span class="composer-err" data-composer-err="' + esc(m.id) + '"></span>'
          + '<button type="button" class="edit-btn edit-btn-primary edit-btn-sm" data-add-reg="' + esc(m.id) + '"><i class="fad fa-plus"></i> Registrar</button>'
        + '</div>'
      + '</div>'
    + '</div>';

    return '<article class="mem open">' + head + body + '</article>';
  }

  function registroHtml(r) {
    var editado = r.updated_at && r.created_at && r.updated_at.slice(0, 10) !== r.created_at.slice(0, 10);
    var key = origemKey(r.origem);
    return '<li class="reg" style="--oc:' + origemInfo(key).cor + '">'
      + '<div class="reg-top">'
        + origemPill(key)
        + '<span class="reg-data">' + esc(fmtData(r.created_at))
          + (editado ? ' · editado ' + esc(fmtData(r.updated_at)) : '') + '</span>'
        + '<span class="reg-acoes">'
          + '<button type="button" class="row-btn" data-edit-reg="' + esc(r.id) + '" title="Editar"><i class="fad fa-pen"></i></button>'
          + '<button type="button" class="row-btn danger" data-del-reg="' + esc(r.id) + '" title="Excluir"><i class="fad fa-trash"></i></button>'
        + '</span>'
      + '</div>'
      + '<div class="reg-texto">' + esc(r.texto) + '</div>'
    + '</li>';
  }

  /* ── Modal de memória ────────────────────────────────────────────── */
  function fillCategoriaSelect(atual) {
    var cats = CATEGORIAS.slice();
    /* Editando uma memória cuja categoria saiu do vocabulário: mantém a
       atual no select, senão salvar trocaria a categoria sem ninguém pedir. */
    if (atual && cats.indexOf(atual) === -1) cats.push(atual);
    $('memoria-categoria').innerHTML = cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === atual ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }

  function updateDescCount() {
    var n = $('memoria-descricao').value.trim().length;
    var el = $('memoria-descricao-count');
    el.textContent = n + '/' + MAX_DESCRICAO;
    el.classList.toggle('over', n > MAX_DESCRICAO);
  }

  function openMemoriaModal(id) {
    var m = id ? acharMemoria(id) : null;
    EDIT_MEMORIA_ID = m ? m.id : null;
    $('memoria-modal-title').textContent = m ? 'Editar memória' : 'Nova memória';
    $('memoria-titulo').value = m ? m.titulo : '';
    $('memoria-descricao').value = m ? (m.descricao || '') : '';
    $('memoria-primeiro').value = '';
    $('memoria-primeiro-field').hidden = !!m;
    fillCategoriaSelect(m ? m.categoria : (CAT_FILTRO || CATEGORIAS[0]));
    $('memoria-error').textContent = '';
    updateDescCount();
    $('memoria-modal').classList.add('open');
    $('memoria-titulo').focus();
  }

  function closeMemoriaModal() {
    $('memoria-modal').classList.remove('open');
    EDIT_MEMORIA_ID = null;
  }

  function onMemoriaSubmit(e) {
    e.preventDefault();
    var titulo = $('memoria-titulo').value.trim();
    var descricao = $('memoria-descricao').value.trim();
    var categoria = $('memoria-categoria').value;
    var primeiro = $('memoria-primeiro').value.trim();
    var errEl = $('memoria-error');
    errEl.textContent = '';

    if (!titulo) { errEl.textContent = 'defina um título'; $('memoria-titulo').focus(); return; }
    if (descricao.length > MAX_DESCRICAO) { errEl.textContent = ERRO.invalid_descricao; return; }
    if (!categoria) { errEl.textContent = 'escolha uma categoria'; return; }

    /* Guardado ANTES do close — close zera EDIT_MEMORIA_ID (LIFEOS.md §9). */
    var editandoId = EDIT_MEMORIA_ID;
    var req = editandoId
      ? api.update(editandoId, { titulo: titulo, descricao: descricao, categoria: categoria })
      : api.create({ titulo: titulo, descricao: descricao, categoria: categoria, registros: primeiro ? [primeiro] : [] });

    $('memoria-save').disabled = true;
    setLoading(true);
    req.then(function (data) {
      setLoading(false);
      $('memoria-save').disabled = false;
      closeMemoriaModal();
      var id = editandoId || (data.memoria && data.memoria.id);
      if (id) EXPANDED[id] = true;
      return reload();
    }).catch(function (err) {
      setLoading(false);
      $('memoria-save').disabled = false;
      errEl.textContent = msgErro(err);
      console.error('[memoria] salvar memória', err);
    });
  }

  /* ── Modal de registro ───────────────────────────────────────────── */
  function openRegistroModal(id) {
    var h = acharRegistro(id);
    if (!h) return;
    EDIT_REGISTRO_ID = id;
    $('registro-texto').value = h.reg.texto;
    $('registro-hint').textContent = 'Em "' + h.mem.titulo + '" · registrado ' + fmtData(h.reg.created_at)
      + (h.reg.origem ? ' por ' + h.reg.origem : '') + '. A data original se mantém.';
    $('registro-error').textContent = '';
    $('registro-modal').classList.add('open');
    $('registro-texto').focus();
  }

  function closeRegistroModal() {
    $('registro-modal').classList.remove('open');
    EDIT_REGISTRO_ID = null;
  }

  function onRegistroSubmit(e) {
    e.preventDefault();
    var texto = $('registro-texto').value.trim();
    var errEl = $('registro-error');
    errEl.textContent = '';
    if (!texto) { errEl.textContent = 'o registro não pode ficar vazio — exclua em vez disso'; return; }

    var id = EDIT_REGISTRO_ID;
    $('registro-save').disabled = true;
    setLoading(true);
    api.registroUpdate(id, texto).then(function () {
      setLoading(false);
      $('registro-save').disabled = false;
      closeRegistroModal();
      return reload();
    }).catch(function (err) {
      setLoading(false);
      $('registro-save').disabled = false;
      errEl.textContent = msgErro(err);
      console.error('[memoria] salvar registro', err);
    });
  }

  /* ── Registrar (composer inline) ─────────────────────────────────── */
  function onAddRegistro(memoriaId) {
    var ta = document.querySelector('[data-composer="' + memoriaId + '"]');
    var errEl = document.querySelector('[data-composer-err="' + memoriaId + '"]');
    if (!ta) return;
    var texto = ta.value.trim();
    errEl.textContent = '';
    if (!texto) { ta.focus(); return; }

    setLoading(true);
    api.registroCreate(memoriaId, texto).then(function () {
      setLoading(false);
      EXPANDED[memoriaId] = true;
      return reload();
    }).catch(function (err) {
      setLoading(false);
      errEl.textContent = msgErro(err);
      console.error('[memoria] registrar', err);
    });
  }

  /* ── Exclusão (dois cliques) — cópia do padrão, LIFEOS.md §7 ────── */
  function resetDeletePending() {
    DELETE_PENDING = null;
    var btns = document.querySelectorAll('.row-btn.pending');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('pending');
      btns[i].innerHTML = '<i class="fad fa-trash"></i>';
    }
  }

  function confirmDelete(btn, key, run) {
    if (DELETE_PENDING !== key) {
      resetDeletePending();
      DELETE_PENDING = key;
      btn.classList.add('pending');
      btn.innerHTML = '<i class="fad fa-check"></i>';
      return;
    }
    resetDeletePending();
    setLoading(true);
    run().then(function () {
      setLoading(false);
      return reload();
    }).catch(function (err) {
      setLoading(false);
      aviso(msgErro(err));
      console.error('[memoria] excluir', err);
    });
  }

  /* Mensagem temporária na barra de aviso — mesmo recurso de tags.js. */
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
      else console.error('[memoria] boot', err);
    });
  }

  function init() {
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    $('gate-form').addEventListener('submit', onGateSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('add-memoria-btn').addEventListener('click', function () { resetDeletePending(); openMemoriaModal(null); });

    $('memoria-form').addEventListener('submit', onMemoriaSubmit);
    $('memoria-cancel').addEventListener('click', closeMemoriaModal);
    $('memoria-modal-close').addEventListener('click', closeMemoriaModal);
    $('memoria-descricao').addEventListener('input', updateDescCount);
    $('memoria-modal').addEventListener('click', function (e) { if (e.target === $('memoria-modal')) closeMemoriaModal(); });

    $('registro-form').addEventListener('submit', onRegistroSubmit);
    $('registro-cancel').addEventListener('click', closeRegistroModal);
    $('registro-modal-close').addEventListener('click', closeRegistroModal);
    $('registro-modal').addEventListener('click', function (e) { if (e.target === $('registro-modal')) closeRegistroModal(); });

    $('busca-input').addEventListener('input', function () { BUSCA = this.value; render(); });

    $('cat-chips').addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-cat]');
      if (!chip) return;
      CAT_FILTRO = chip.getAttribute('data-cat');
      renderChips();
      render();
    });

    $('origem-chips').addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-origem]');
      if (!chip) return;
      ORIGEM_FILTRO = chip.getAttribute('data-origem');
      renderChips();
      render();
    });

    /* Delegação: a lista é re-renderizada inteira a cada mudança. */
    $('memorias').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el;

      if ((el = t.closest('[data-del-mem]'))) {
        var mid = el.getAttribute('data-del-mem');
        confirmDelete(el, 'm:' + mid, function () { delete EXPANDED[mid]; return api.remove(mid); });
        return;
      }
      if ((el = t.closest('[data-del-reg]'))) {
        var rid = el.getAttribute('data-del-reg');
        confirmDelete(el, 'r:' + rid, function () { return api.registroRemove(rid); });
        return;
      }
      resetDeletePending();

      if ((el = t.closest('[data-toggle]'))) {
        var id = el.getAttribute('data-toggle');
        if (EXPANDED[id]) delete EXPANDED[id]; else EXPANDED[id] = true;
        render();
        return;
      }
      if ((el = t.closest('[data-limpar-origem]'))) { ORIGEM_FILTRO = ''; renderChips(); render(); return; }
      if ((el = t.closest('[data-edit-mem]'))) { openMemoriaModal(el.getAttribute('data-edit-mem')); return; }
      if ((el = t.closest('[data-edit-reg]'))) { openRegistroModal(el.getAttribute('data-edit-reg')); return; }
      if ((el = t.closest('[data-add-reg]'))) { onAddRegistro(el.getAttribute('data-add-reg')); return; }
    });

    /* Ctrl/Cmd+Enter no composer registra, sem tirar a mão do teclado. */
    $('memorias').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      var ta = e.target.closest && e.target.closest('[data-composer]');
      if (ta) { e.preventDefault(); onAddRegistro(ta.getAttribute('data-composer')); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('registro-modal').classList.contains('open')) { closeRegistroModal(); return; }
      if ($('memoria-modal').classList.contains('open')) { closeMemoriaModal(); return; }
      resetDeletePending();
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
