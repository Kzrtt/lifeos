/**
 * tarefas.js — LifeOS · módulo Tarefas (/tarefas)
 *
 * JS cru, sem framework, sem build. Consumido por tarefas.html. Módulo
 * ISOLADO — não importa nem é importado por lifeos.js/financas.js/eventos.js
 * (ver LIFEOS.md §2). Página própria (padrão Finanças, não nativo do hub
 * como Eventos) porque Tarefas depende de uma segunda entidade — Projetos —
 * e a view principal é um kanban por projeto, densa o bastante pra merecer
 * tela própria.
 *
 * Toda tarefa é OBRIGATORIAMENTE vinculada a um projeto (ao contrário de
 * Eventos, onde o vínculo a projeto é opcional). O kanban mostra as tarefas
 * de UM projeto por vez — selecionar o projeto é o fluxo principal.
 *
 * Só compartilha com os outros módulos: a senha mestre (mesmo backend) e a
 * chave 'financas_master' no localStorage ("lembrar" vale nas páginas do
 * LifeOS todas).
 */
(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────── */
  /* URLs derivadas de lifeos-config.js — o único arquivo que um fork edita.
     Ver LIFEOS.md §2 sobre por que a config é a exceção à regra de
     isolamento (dado declarativo, não comportamento compartilhado). */
  var CFG_FN_BASE = (window.LIFEOS_CONFIG ? window.LIFEOS_CONFIG.supabaseUrl : '') + '/functions/v1/';
  var PROJETOS_FN = CFG_FN_BASE + 'lifeos-projetos';
  var TAREFAS_FN = CFG_FN_BASE + 'lifeos-tarefas';
  var ANON_KEY = window.LIFEOS_CONFIG ? window.LIFEOS_CONFIG.anonKey : '';
  var LS_KEY = (window.LIFEOS_CONFIG && window.LIFEOS_CONFIG.sessionKey) || 'financas_master';        /* mesma chave de /financas, /eventos e /lifeos */
  var LS_ACTIVE_PROJETO = 'tarefas_active_projeto'; /* lembra o último projeto aberto, só nesta página */
  var CACHE_KEY = 'tarefas_cache';       /* cache persistente (localStorage) — ver LIFEOS.md */
  var CACHE_V = 1;

  var STATUS_TAREFA = ['Não Iniciado', 'Em Andamento', 'Feito'];
  var TIPOS_TAREFA = ['Vida', 'Organização', 'Documentação', 'Estudo', 'Avaliação', 'Código', 'Freelance', 'Trabalho', 'Tarefa'];

  /* Mesmo mapeamento de cor do mini-kanban do hub (TAR_STATUS_COR em
     lifeos.js), só que em hex literal — Chart.js não lê var(--x). */
  var STATUS_COR = { 'Não Iniciado': '#6b6456', 'Em Andamento': '#c4913a', 'Feito': '#3fb98c' };

  /* O status "concluído" é o ÚLTIMO do vocabulário, não a string 'Feito' —
     os valores são editáveis na tela de Tags e renomear quebraria qualquer
     comparação literal. Tudo que pergunta "esta tarefa está pronta?" passa
     por aqui. */
  function statusConcluido(lista) { return lista[lista.length - 1]; }

  /* ── Vocabulários dinâmicos ──────────────────────────────────────────
   * As listas acima são FALLBACK. Desde a migration 0002 elas vivem em
   * `lifeos_vocabularios`, editáveis em LifeOS → menu → Tags.
   * Se a chamada falhar, o fallback vale e a página funciona com o
   * vocabulário embutido. Cópia isolada por arquivo (LIFEOS.md §2).
   */
  var VOCAB_FN = (window.LIFEOS_CONFIG ? window.LIFEOS_CONFIG.supabaseUrl : '')
    + '/functions/v1/lifeos-vocabularios';

  function carregarVocab(pw) {
    if (IS_LOCAL_DEV) return Promise.resolve();
    return callFn(VOCAB_FN, { token: pw }).then(function (d) {
      var v = (d && d.vocabularios) || {};
      function lista(dom) { return (v[dom] || []).map(function (x) { return x.valor; }); }
      var st = lista('tarefa_status');
      if (st.length) {
        STATUS_TAREFA = st;
        /* A cor do status é semântica POR POSIÇÃO, não por nome — remapear
           por índice faz a cor sobreviver a um rename. */
        var paleta = ['#6b6456', '#c4913a', '#3fb98c'];
        var novo = {};
        st.forEach(function (x, i) { novo[x] = paleta[i] || '#8a8172'; });
        STATUS_COR = novo;
      }
      var tt = lista('tarefa_tipo');
      if (tt.length) TIPOS_TAREFA = tt;
    }).catch(function (e) {
      console.warn('[tarefas] vocabulários indisponíveis — usando o fallback embutido', e);
    });
  }

  var TIPO_COR_PALETTE = ['#c4913a', '#5b8def', '#3fb98c', '#e5616a', '#b06ee0', '#e58b5b', '#4fc3d9', '#d4a5e8', '#8a9b6e'];
  var TIPO_COR = {};
  TIPOS_TAREFA.forEach(function (t, i) { TIPO_COR[t] = TIPO_COR_PALETTE[i % TIPO_COR_PALETTE.length]; });

  /* ── Estado ──────────────────────────────────────────────────── */
  var SESSION_PW = '';
  var PROJETOS = [];
  var ACTIVE_PROJETO_ID = null;
  var TAREFAS = [];              /* só as tarefas do projeto ativo */
  var TAREFAS_CACHE = {};        /* projeto_id -> tarefas[] (memória, hidratado do localStorage) — '' = "Todos os projetos" */
  var EDIT_TAREFA_ID = null;     /* null = modal de tarefa em modo "criar" */
  var TAREFA_TIPO_SEL = [];      /* estado do chip-picker multi-select do modal de tarefa */
  var MD_MODES = ['Editar', 'Pré-visualizar']; /* toggle do campo de descrição (markdown) */
  var TAREFA_DESCRICAO_MODE = 'Editar';

  var TAR_VIEW = 'kanban';       /* 'kanban' | 'lista' — toggle de view */
  var TIPO_FILTRO = new Set();   /* filtro por Tipo, aplica no kanban + na lista */
  var TAR_STATUS_CHART = null;   /* doughnut · distribuição por status */
  var TAR_TIPO_CHART = null;     /* barras · distribuição por tipo */
  var DRAG_TAREFA_ID = null;     /* id da tarefa sendo arrastada no kanban (drag-and-drop de status) */

  /* ── Helpers ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDate(d) { if (!d) return '—'; var p = d.split('-'); return p[2] + '/' + p[1]; }
  function findProjeto(id) { for (var i = 0; i < PROJETOS.length; i++) { if (PROJETOS[i].id === id) return PROJETOS[i]; } return null; }
  /* window.marked pode não estar disponível ainda (CDN lento/bloqueado) — cai
     pra texto puro escapado em vez de quebrar a pré-visualização. */
  function renderMarkdown(src) {
    if (!src) return '';
    if (window.marked && window.marked.parse) return window.marked.parse(src);
    var div = document.createElement('div'); div.textContent = src;
    return '<p>' + div.innerHTML.replace(/\n/g, '<br>') + '</p>';
  }

  /* ── Filtro por tipo — aplica sobre TAREFAS pra alimentar kanban e lista;
     estatísticas/gráfico ignoram (mesmo princípio dos KPIs de Finanças: o
     resumo é do projeto inteiro, o filtro só recorta as views abaixo). ── */
  function matchesTipoFiltro(t) { if (!TIPO_FILTRO.size) return true; return (t.tipo || []).some(function (tp) { return TIPO_FILTRO.has(tp); }); }
  function visibleTarefas() { return TAREFAS.filter(matchesTipoFiltro); }

  /* ── Dev mock (ambiente local) — mesmo motivo dos outros módulos. ── */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  /* Drag-and-drop de status é só desktop — mouse de precisão + hover de
     verdade, não touch (evita conflito com scroll/tap em celular). Mesmo
     feature-detect usado em lifeos.js (cópia isolada, ver LIFEOS.md §2). */
  var IS_DESKTOP = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : true;

  function seededRandom(seed) {
    var s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function seedFromString(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) || 1; }
  function mockDelay(value) { return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, 220); }); }

  var MOCK_PROJETOS = null;
  var MOCK_TAREFAS = null;
  /* Descrições de exemplo (markdown) pros mocks — sem isso, o dev local
     nunca exercita o preview markdown nem o campo Descrição do modal de
     tarefa. `null` entra na rotação de propósito (testa "sem descrição"). */
  var MOCK_DESCRICOES = [
    '### Contexto\n\nAlinhar com o time antes de começar.\n\n- revisar escopo\n- validar prazo com o responsável',
    'Prioridade **alta** — bloqueada até a revisão de design terminar.\n\n> depende da tarefa anterior',
    'Passos:\n\n1. Levantar requisitos\n2. Rascunhar solução\n3. Validar\n\nSem *breaking changes* nesse ciclo.',
    'Só um lembrete rápido, nada estruturado aqui.',
    null,
  ];
  function seedMockData() {
    var rnd = seededRandom(seedFromString('tarefas-seed'));
    MOCK_PROJETOS = [
      { id: 'mock-proj-1', name: 'LifeOS', emoji: '📚', status: 'Em Progresso', tags: ['Pessoal'] },
      { id: 'mock-proj-2', name: 'Faculdade', emoji: null, status: 'Em Progresso', tags: ['Acadêmico'] },
      { id: 'mock-proj-3', name: 'sigarp.com.br', emoji: null, status: 'Em Progresso', tags: ['Profissional'] },
    ];
    var names = ['Ajustar layout', 'Corrigir bug de datas', 'Escrever documentação', 'Revisar PR', 'Planejar sprint', 'Testar fluxo de pagamento'];
    MOCK_TAREFAS = [];
    var i = 0;
    MOCK_PROJETOS.forEach(function (p) {
      var n = 3 + Math.floor(rnd() * 4);
      for (var k = 0; k < n; k++) {
        var status = STATUS_TAREFA[Math.floor(rnd() * STATUS_TAREFA.length)];
        var hasData = rnd() > 0.5;
        MOCK_TAREFAS.push({
          id: 'mock-tarefa-' + (i++), name: names[Math.floor(rnd() * names.length)] + ' #' + (k + 1),
          status: status, tipo: [TIPOS_TAREFA[Math.floor(rnd() * TIPOS_TAREFA.length)]],
          projeto_id: p.id, data_entrega: hasData ? todayISO().slice(0, 8) + String(1 + Math.floor(rnd() * 27)).padStart(2, '0') : null,
          descricao: MOCK_DESCRICOES[Math.floor(rnd() * MOCK_DESCRICOES.length)],
          /* espalhado nos últimos 30 dias — dá pra ver a coluna "Feito" do
             kanban ordenando por concluído-mais-recente-primeiro. */
          updated_at: new Date(Date.now() - Math.floor(rnd() * 30) * 86400000).toISOString(),
        });
      }
    });
  }
  /* Projetos é só leitura aqui — criar/editar/excluir mora em lifeos.html
     (ver LIFEOS.md, movido de tarefas.html em set/2026 a pedido do autor, pra
     centralizar a gestão de projetos na tela principal do hub). */
  function mockProjetosQuery() { if (!MOCK_PROJETOS) seedMockData(); return { ok: true, projetos: MOCK_PROJETOS.slice() }; }
  function mockTarefasQuery(projeto_id) {
    if (!MOCK_TAREFAS) seedMockData();
    var rows = projeto_id ? MOCK_TAREFAS.filter(function (t) { return t.projeto_id === projeto_id; }) : MOCK_TAREFAS.slice();
    return { ok: true, tarefas: rows };
  }
  function mockTarefasCreate(t) {
    if (!MOCK_TAREFAS) seedMockData();
    var created = Object.assign({ id: 'mock-tarefa-new-' + Date.now() }, t);
    MOCK_TAREFAS.push(created);
    return { ok: true, tarefa: created };
  }
  function mockTarefasUpdate(id, patch) {
    if (!MOCK_TAREFAS) seedMockData();
    var existing = null;
    for (var i = 0; i < MOCK_TAREFAS.length; i++) { if (MOCK_TAREFAS[i].id === id) { existing = MOCK_TAREFAS[i]; break; } }
    /* bump updated_at — mesmo comportamento do backend real (ver
       lifeos-tarefas/handleUpdate); sem isso, mover um card pra "Feito" no
       kanban não subiria pro topo da coluna (ver renderKanban). */
    var withTimestamp = Object.assign({}, patch, { updated_at: new Date().toISOString() });
    var updated = Object.assign({}, existing || { id: id }, withTimestamp);
    if (existing) Object.assign(existing, withTimestamp);
    return { ok: true, tarefa: updated };
  }
  function mockTarefasDelete(id) {
    if (MOCK_TAREFAS) { for (var i = 0; i < MOCK_TAREFAS.length; i++) { if (MOCK_TAREFAS[i].id === id) { MOCK_TAREFAS.splice(i, 1); break; } } }
    return { ok: true, id: id };
  }
  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · dados fictícios';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }

  /* ── Rede ────────────────────────────────────────────────────── */
  function callFn(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return res.text().catch(function () { return ''; }).then(function (d) { return Promise.reject({ code: 'server', detail: res.status + ' ' + d }); });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiProjetosQuery(pw) { return IS_LOCAL_DEV ? mockDelay(mockProjetosQuery()) : callFn(PROJETOS_FN, { token: pw }); }
  /* projeto_id vazio ('Todos os projetos') NÃO manda o campo — a Edge
     Function lista TUDO quando projeto_id não vem no corpo (ver
     LIFEOS.md §6.2, mesmo contrato que lifeos.js usa pro mini-kanban). */
  function apiTarefasQuery(pw, projeto_id) {
    return IS_LOCAL_DEV ? mockDelay(mockTarefasQuery(projeto_id)) : callFn(TAREFAS_FN, projeto_id ? { token: pw, projeto_id: projeto_id } : { token: pw });
  }
  function apiTarefasCreate(pw, tarefa) { return IS_LOCAL_DEV ? mockDelay(mockTarefasCreate(tarefa)) : callFn(TAREFAS_FN, { token: pw, action: 'create', tarefa: tarefa }); }
  function apiTarefasUpdate(pw, id, patch) { return IS_LOCAL_DEV ? mockDelay(mockTarefasUpdate(id, patch)) : callFn(TAREFAS_FN, { token: pw, action: 'update', id: id, patch: patch }); }
  function apiTarefasDelete(pw, id) { return IS_LOCAL_DEV ? mockDelay(mockTarefasDelete(id)) : callFn(TAREFAS_FN, { token: pw, action: 'delete', id: id }); }

  /* ── Chip pickers genéricos (single ou multi-select) ────────────
     Single: clicar troca a seleção inteira (usado em status/projeto).
     Multi: clicar alterna aquele valor num array (usado em tipo/tags). */
  function buildChipOptions(hostId, values) {
    var host = $(hostId); host.innerHTML = '';
    values.forEach(function (v) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip-opt'; btn.setAttribute('data-value', v);
      btn.textContent = v;
      host.appendChild(btn);
    });
  }
  function setSingleChip(hostId, hiddenInputId, value) {
    $(hiddenInputId).value = value;
    var btns = document.querySelectorAll('#' + hostId + ' .chip-opt');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-selected', btns[i].getAttribute('data-value') === value);
  }
  function setMultiChips(hostId, selected) {
    var btns = document.querySelectorAll('#' + hostId + ' .chip-opt');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-selected', selected.indexOf(btns[i].getAttribute('data-value')) !== -1);
  }
  function toggleMultiChip(btn, stateArr) {
    var v = btn.getAttribute('data-value');
    var idx = stateArr.indexOf(v);
    if (idx === -1) { stateArr.push(v); btn.classList.add('is-selected'); }
    else { stateArr.splice(idx, 1); btn.classList.remove('is-selected'); }
  }

  /* Picker de projeto dentro do modal de tarefa: reconstrói toda vez que o
     modal abre (não é vocabulário fixo — muda se um projeto novo for
     criado), um chip por projeto com o emoji (ou um ícone genérico). Só
     projetos "Em Progresso" entram — não faz sentido criar/mover uma
     tarefa pra um projeto Pausado/Feito/Não Iniciado, mantém a UI enxuta
     (ver LIFEOS.md). `currentProjetoId` é uma exceção: ao EDITAR uma tarefa
     cujo projeto não está (ou deixou de estar) Em Progresso, ele ainda
     entra na lista — senão o chip da seleção atual sumiria e a tarefa
     pareceria "sem projeto" no formulário. */
  function buildProjetoChipPicker(currentProjetoId) {
    var host = $('tarefa-projeto-picker'); host.innerHTML = '';
    PROJETOS.filter(function (p) { return p.status === 'Em Progresso' || p.id === currentProjetoId; }).forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip-opt'; btn.setAttribute('data-value', p.id);
      btn.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
      host.appendChild(btn);
    });
  }

  /* ── Seletor de projeto (select real, topo da página) ──────────
     Substituiu os chips de scroll horizontal — trocar de projeto é a ação
     mais comum da página, merece um controle nativo e previsível.
     "Todos os projetos" (value="") é a visão geral — busca TODAS as
     tarefas sem filtro de projeto_id (ver apiTarefasQuery), estatísticas/
     gráfico agregam tudo, e kanban/lista passam a mostrar o projeto de
     cada tarefa (ver .tar-item-proj) já que ficam misturadas. */
  function renderProjetoSelect() {
    if (!PROJETOS.length) {
      $('projeto-empty').hidden = false; $('tarefas-content').hidden = true;
      return;
    }
    $('projeto-empty').hidden = true; $('tarefas-content').hidden = false;
    var sel = $('projeto-select'); sel.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = ''; allOpt.textContent = 'Todos os projetos';
    sel.appendChild(allOpt);
    PROJETOS.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
      sel.appendChild(opt);
    });
    sel.value = ACTIVE_PROJETO_ID;
  }

  function clearFilters() { TIPO_FILTRO.clear(); }

  function setActiveProjeto(id) {
    ACTIVE_PROJETO_ID = id;
    try { localStorage.setItem(LS_ACTIVE_PROJETO, id); } catch (_e) {}
    clearFilters();
    renderProjetoSelect();
    loadTarefas();
  }

  /* ── Kanban ──────────────────────────────────────────────────── */
  function renderKanban() {
    var board = $('kanban-board'); board.innerHTML = '';
    var visible = visibleTarefas();
    STATUS_TAREFA.forEach(function (status) {
      var rows = visible.filter(function (t) { return t.status === status; });
      /* "Feito" ordena pela conclusão mais recente primeiro (updated_at
         desc) — sem isso, tarefa concluída há meses ficava misturada com a
         concluída ontem, sem critério nenhum de relevância. Nas outras
         colunas, o que importa é o que precisa ser feito primeiro: tarefa
         COM data de entrega vem antes de tarefa SEM data, e entre as que
         têm data, a mais próxima de hoje primeiro. Sem data, mantém a
         ordem que já vinha da API (created_at asc) — sort é estável, um
         comparator que só decide "com data < sem data" preserva a ordem
         relativa dentro de cada grupo. Mesmo critério do mini-kanban do
         hub (lifeos.js, renderTarMiniKanban). */
      var statusFinal = statusConcluido(STATUS_TAREFA);
      if (status === statusFinal) {
        rows = rows.slice().sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });
      } else {
        rows = rows.slice().sort(function (a, b) {
          var ad = !!a.data_entrega, bd = !!b.data_entrega;
          if (ad && bd) return a.data_entrega.localeCompare(b.data_entrega);
          if (ad !== bd) return ad ? -1 : 1;
          return 0;
        });
      }
      var col = document.createElement('div'); col.className = 'kanban-col'; col.setAttribute('data-status', status);
      var head = document.createElement('div'); head.className = 'kanban-col-head';
      var title = document.createElement('span'); title.className = 'kanban-col-title'; title.textContent = status;
      var count = document.createElement('span'); count.className = 'kanban-col-count'; count.textContent = rows.length;
      head.appendChild(title); head.appendChild(count); col.appendChild(head);

      var body = document.createElement('div'); body.className = 'kanban-col-body';
      if (!rows.length) {
        var empty = document.createElement('div'); empty.className = 'kanban-col-empty'; empty.textContent = '—';
        body.appendChild(empty);
      } else {
        var isComplete = (status === statusFinal);
        rows.forEach(function (t) {
          var card = document.createElement('div'); card.className = 'kanban-card'; card.setAttribute('data-id', t.id);
          if (IS_DESKTOP) { card.classList.add('is-draggable'); card.setAttribute('draggable', 'true'); }
          var name = document.createElement('div'); name.className = 'kanban-card-name'; name.textContent = t.name;
          card.appendChild(name);
          /* Projeto aparece sempre, mesmo com um projeto específico
             selecionado — o filtro só recorta QUAIS tarefas aparecem, não é
             motivo pra esconder de qual projeto cada uma é. */
          var cardProj = findProjeto(t.projeto_id);
          if (cardProj) {
            var projEl = document.createElement('span'); projEl.className = 'tar-item-proj';
            projEl.textContent = (cardProj.emoji ? cardProj.emoji + ' ' : '') + cardProj.name;
            card.appendChild(projEl);
          }
          if ((t.tipo && t.tipo.length) || t.data_entrega) {
            var meta = document.createElement('div'); meta.className = 'kanban-card-meta';
            (t.tipo || []).slice(0, 2).forEach(function (tp) {
              var tag = document.createElement('span'); tag.className = 'kanban-card-tipo'; tag.textContent = tp;
              meta.appendChild(tag);
            });
            if (t.data_entrega) {
              var overdue = !isComplete && t.data_entrega < todayISO();
              var d = document.createElement('span'); d.className = 'kanban-card-data' + (overdue ? ' is-overdue' : '');
              d.textContent = fmtDate(t.data_entrega);
              meta.appendChild(d);
            }
            card.appendChild(meta);
          }
          body.appendChild(card);
        });
      }
      col.appendChild(body);
      board.appendChild(col);
    });
  }

  /* Arrastar um card pra outra coluna muda o status (única forma de mudar
     status pelo kanban — antes só dava pelo modal). Otimista: aplica na UI
     na hora do drop e reverte se a API falhar. */
  function onDropTarefaStatus(id, newStatus) {
    var t = null;
    for (var i = 0; i < TAREFAS.length; i++) { if (TAREFAS[i].id === id) { t = TAREFAS[i]; break; } }
    if (!t || t.status === newStatus) return;
    var prevStatus = t.status;
    t.status = newStatus;
    renderAll();
    apiTarefasUpdate(SESSION_PW, id, { status: newStatus }).then(function (j) {
      var saved = j.tarefa;
      for (var k = 0; k < TAREFAS.length; k++) { if (TAREFAS[k].id === saved.id) { TAREFAS[k] = saved; break; } }
      /* "Todos os projetos" também mostra o status de cada tarefa — invalida
         pra refletir na próxima vez que for selecionado (não mantém em
         sincronia ativa, mesmo princípio de simplicidade do resto do cache). */
      delete TAREFAS_CACHE[''];
      TAREFAS_CACHE[ACTIVE_PROJETO_ID] = TAREFAS.slice();
      writeCache();
      renderAll();
    }).catch(function (err) {
      t.status = prevStatus;
      renderAll();
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao mover tarefa — ' + ((err && err.detail) || 'tente de novo'));
    });
  }

  /* ── Estatísticas do projeto ativo (contagem por status + progresso +
     atrasadas) — sobre TODAS as tarefas do projeto, ignora busca/filtro. ── */
  function renderStats() {
    var nao = TAREFAS.filter(function (t) { return t.status === 'Não Iniciado'; }).length;
    var and = TAREFAS.filter(function (t) { return t.status === 'Em Andamento'; }).length;
    var feito = TAREFAS.filter(function (t) { return t.status === statusConcluido(STATUS_TAREFA); }).length;
    var total = TAREFAS.length;
    var pct = total ? Math.round((feito / total) * 100) : 0;
    var hoje = todayISO();
    var atrasadas = TAREFAS.filter(function (t) { return t.status !== statusConcluido(STATUS_TAREFA) && t.data_entrega && t.data_entrega < hoje; }).length;
    $('stat-nao-iniciado').textContent = nao;
    $('stat-em-andamento').textContent = and;
    $('stat-feito').textContent = feito;
    $('stat-progresso').textContent = pct + '%';
    $('stat-progresso-fill').style.width = pct + '%';
    $('stat-atrasadas').textContent = atrasadas;
  }

  /* ── Filtro por tipo (badges) — presença calculada sobre TODAS as tarefas
     do projeto (não só as visíveis), mesmo padrão de buildBadges em
     financas.js: os chips continuam refletindo os valores disponíveis no
     projeto inteiro, não no subconjunto já filtrado pela busca. ── */
  function buildTipoFilterChips() {
    var host = $('tipo-filters'); host.innerHTML = '';
    var present = {};
    TAREFAS.forEach(function (t) { (t.tipo || []).forEach(function (tp) { present[tp] = true; }); });
    var any = Object.keys(present).length > 0;
    host.hidden = !any;
    if (!any) return;
    var lbl = document.createElement('span'); lbl.className = 'filters-label'; lbl.textContent = 'filtrar por tipo:';
    host.appendChild(lbl);
    TIPOS_TAREFA.forEach(function (tp) {
      if (!present[tp]) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (TIPO_FILTRO.has(tp) ? ' active' : ''); b.setAttribute('data-tipo', tp);
      b.textContent = tp;
      host.appendChild(b);
    });
    if (TIPO_FILTRO.size) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip chip-clear'; c.id = 'tipo-filter-clear';
      c.innerHTML = 'limpar <i class="fad fa-times"></i>';
      host.appendChild(c);
    }
  }
  function toggleTipoFilter(tp) {
    if (TIPO_FILTRO.has(tp)) TIPO_FILTRO.delete(tp); else TIPO_FILTRO.add(tp);
    buildTipoFilterChips(); renderKanban(); renderListView();
  }
  function clearTipoFilter() { TIPO_FILTRO.clear(); buildTipoFilterChips(); renderKanban(); renderListView(); }

  /* ── Toggle de view (Kanban / Lista) ─────────────────────────── */
  function switchTarView(id) {
    TAR_VIEW = id;
    var tabs = document.querySelectorAll('.view-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === id);
    $('kanban-board').hidden = id !== 'kanban';
    $('view-lista').hidden = id !== 'lista';
  }

  /* Prioridade de status na view · Lista — pendentes primeiro, "Feito" por
     último. Sem isso, ordenar só por data de entrega enterra as tarefas
     ativas: a maioria das tarefas reais já está concluída (69 de 75, ver
     LIFEOS.md §6.3), com data de entrega antiga — ordenação ascendente pura
     jogava esse volume de "Feito" pro topo da lista, dando a impressão de
     que só tarefa concluída aparecia. */
  var LISTA_STATUS_ORDER = { 'Não Iniciado': 0, 'Em Andamento': 1, 'Feito': 2 };

  /* ── View · Lista (tabela, pendentes primeiro, depois por data de entrega) ── */
  function renderListView() {
    var tbody = $('tar-list-tbody'); tbody.innerHTML = '';
    var rows = visibleTarefas().slice().sort(function (a, b) {
      var sa = LISTA_STATUS_ORDER[a.status], sb = LISTA_STATUS_ORDER[b.status];
      sa = (sa == null) ? 99 : sa; sb = (sb == null) ? 99 : sb;
      if (sa !== sb) return sa - sb;
      var da = a.data_entrega || '9999-99-99', db = b.data_entrega || '9999-99-99';
      return da.localeCompare(db) || a.name.localeCompare(b.name);
    });
    if (!rows.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td'); td.colSpan = 4; td.className = 'tar-table-empty'; td.textContent = 'nenhuma tarefa com esse filtro';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    var hoje = todayISO();
    rows.forEach(function (t) {
      var row = document.createElement('tr'); row.setAttribute('data-id', t.id);
      var td1 = document.createElement('td'); td1.className = 'td-tar-name'; td1.textContent = t.name;
      if (!ACTIVE_PROJETO_ID) {
        var rowProj = findProjeto(t.projeto_id);
        if (rowProj) {
          var projEl = document.createElement('span'); projEl.className = 'tar-item-proj';
          projEl.textContent = (rowProj.emoji ? rowProj.emoji + ' ' : '') + rowProj.name;
          td1.appendChild(projEl);
        }
      }
      /* .td-tar-tipo (flex-wrap) fica numa DIV interna, não direto no <td> —
         um <td> com display:flex não estica de forma confiável até a altura
         cheia da linha em todo browser; quando "nome" quebra em 2 linhas
         (linha mais alta), esse <td> ficava mais baixo que os outros e a
         borda inferior da linha saía desalinhada entre colunas. Um <td>
         "normal" (table-cell puro) sempre estica certo. */
      var td2 = document.createElement('td');
      var tipoWrap = document.createElement('div'); tipoWrap.className = 'td-tar-tipo';
      (t.tipo || []).forEach(function (tp) { var s = document.createElement('span'); s.className = 'tag-proj'; s.textContent = tp; tipoWrap.appendChild(s); });
      td2.appendChild(tipoWrap);
      var td3 = document.createElement('td'); td3.className = 'td-tar-status';
      var badge = document.createElement('span'); badge.className = 'td-tar-status-badge'; badge.setAttribute('data-status', t.status); badge.textContent = t.status;
      td3.appendChild(badge);
      var overdue = t.status !== statusConcluido(STATUS_TAREFA) && t.data_entrega && t.data_entrega < hoje;
      var td4 = document.createElement('td'); td4.className = 'td-tar-data' + (overdue ? ' is-overdue' : ''); td4.textContent = fmtDate(t.data_entrega);
      row.appendChild(td1); row.appendChild(td2); row.appendChild(td3); row.appendChild(td4);
      tbody.appendChild(row);
    });
  }

  function baseChartTooltip() {
    return {
      backgroundColor: '#242018', borderColor: '#2e2a24', borderWidth: 1,
      titleColor: '#ede8df', bodyColor: '#ede8df',
      titleFont: { family: "'JetBrains Mono', monospace", size: 11 }, bodyFont: { family: "'JetBrains Mono', monospace", size: 12 }, padding: 10,
    };
  }

  /* ── Distribuição por status (doughnut) — poucas categorias fixas (3),
     pizza/doughnut funciona bem aqui. Sempre sobre TODAS as tarefas do
     projeto, mesmo princípio das estatísticas (ignora busca/filtro). ── */
  function renderStatusChart() {
    var labels = [], data = [], cores = [];
    STATUS_TAREFA.forEach(function (s) {
      var n = TAREFAS.filter(function (t) { return t.status === s; }).length;
      if (n > 0) { labels.push(s); data.push(n); cores.push(STATUS_COR[s]); }
    });
    if (TAR_STATUS_CHART) { TAR_STATUS_CHART.destroy(); TAR_STATUS_CHART = null; }
    var hasData = data.length > 0;
    $('tar-chart-status-empty').hidden = hasData;
    $('tar-chart-status').style.display = hasData ? '' : 'none';
    if (!hasData || !window.Chart) return;
    TAR_STATUS_CHART = new Chart($('tar-chart-status'), {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: cores, borderColor: '#1c1a16', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#b0a898', font: { family: "'JetBrains Mono', monospace", size: 11 }, padding: 12, boxWidth: 12, usePointStyle: true } },
          tooltip: Object.assign(baseChartTooltip(), {
            callbacks: {
              label: function (c) {
                var total = c.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                var pct = total ? Math.round((c.parsed / total) * 100) : 0;
                return ' ' + c.label + ': ' + c.parsed + ' (' + pct + '%)';
              },
            },
          }),
        },
      },
    });
  }

  /* ── Distribuição por tipo (barras horizontais) — até 9 categorias
     possíveis; pizza fica ilegível com tanta fatia miúda, barra lê melhor
     (e o nome do tipo não precisa truncar/rotacionar no eixo, ao contrário
     de um bar chart vertical). Mesmo princípio: TODAS as tarefas do
     projeto. ── */
  function renderTipoChart() {
    var labels = [], data = [], cores = [];
    TIPOS_TAREFA.forEach(function (tp) {
      var n = TAREFAS.filter(function (t) { return (t.tipo || []).indexOf(tp) !== -1; }).length;
      if (n > 0) { labels.push(tp); data.push(n); cores.push(TIPO_COR[tp]); }
    });
    if (TAR_TIPO_CHART) { TAR_TIPO_CHART.destroy(); TAR_TIPO_CHART = null; }
    var hasData = data.length > 0;
    $('tar-chart-tipo-empty').hidden = hasData;
    $('tar-chart-tipo').style.display = hasData ? '' : 'none';
    if (!hasData || !window.Chart) return;
    TAR_TIPO_CHART = new Chart($('tar-chart-tipo'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: cores, borderRadius: 4, maxBarThickness: 22 }] },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.06)', drawBorder: false },
            ticks: { color: '#b0a898', font: { family: "'JetBrains Mono', monospace", size: 10 }, precision: 0 },
          },
          y: {
            grid: { display: false },
            ticks: { color: '#b0a898', font: { family: "'JetBrains Mono', monospace", size: 10 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(baseChartTooltip(), {
            callbacks: { label: function (c) { return ' ' + c.parsed.x + (c.parsed.x === 1 ? ' tarefa' : ' tarefas'); } },
          }),
        },
      },
    });
  }

  function renderAll() {
    buildTipoFilterChips();
    renderStats();
    renderStatusChart();
    renderTipoChart();
    renderKanban();
    renderListView();
  }

  /* ── Cache persistente (localStorage, JSON) ──────────────────────────
     Mesmo princípio de financas_cache em financas.js e lifeos_hub_cache em
     lifeos.js (ver LIFEOS.md): sem cache válido, entra direto do que foi
     salvo na última visita, sem tocar rede. Cache por PROJETO (não por mês
     como Finanças) — cada projeto_id (mais '' = "Todos os projetos") tem
     sua própria entrada; trocar de projeto no select é cache-first, só
     busca o que nunca foi carregado. Sem TTL: confiável até um ↻ ou até uma
     escrita invalidar a entrada afetada. */
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.v !== CACHE_V) return null;
      return c;
    } catch (_e) { return null; }
  }
  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        v: CACHE_V,
        fetched_at: new Date().toISOString(),
        projetos: PROJETOS,
        tarefas_by_projeto: TAREFAS_CACHE,
      }));
    } catch (_e) { /* quota/indisponível: cache só em memória nesta sessão */ }
  }
  function dropCache() { try { localStorage.removeItem(CACHE_KEY); } catch (_e) {} }

  /* Label "sincronizado" (mesmo padrão de financas.html/lifeos.html). */
  function updateFetchedLabel() {
    var el = $('fetched-at');
    if (!el) return;
    var cache = readCache();
    if (!cache || !cache.fetched_at) { el.textContent = ''; return; }
    el.textContent = 'sincronizado ' + new Date(cache.fetched_at).toLocaleString('pt-BR');
  }

  /* null = nenhum projeto existe ainda (ver renderProjetoSelect); string
     vazia = "Todos os projetos" (válido, busca tudo) — os dois são
     "falsy", por isso o cheque é explícito contra null, não !ACTIVE_PROJETO_ID.
     Cache-first: se as tarefas deste projeto já estão em TAREFAS_CACHE
     (hidratado do localStorage ou de uma visita anterior nesta sessão),
     usa direto — sem rede. */
  function loadTarefas() {
    if (ACTIVE_PROJETO_ID === null) { TAREFAS = []; renderAll(); return Promise.resolve(); }
    if (TAREFAS_CACHE[ACTIVE_PROJETO_ID]) {
      TAREFAS = TAREFAS_CACHE[ACTIVE_PROJETO_ID];
      renderAll();
      updateFetchedLabel();
      return Promise.resolve();
    }
    setLoading(true);
    return apiTarefasQuery(SESSION_PW, ACTIVE_PROJETO_ID).then(function (j) {
      TAREFAS = j.tarefas || [];
      TAREFAS_CACHE[ACTIVE_PROJETO_ID] = TAREFAS;
      writeCache();
      renderAll();
      updateFetchedLabel();
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') onLogout();
    }).then(function () { setLoading(false); });
  }

  /* ── Modal · tarefa (criar/editar) ──────────────────────────────
     Um único modal serve os dois modos — EDIT_TAREFA_ID null = criar. */
  function openTarefaModal(id) {
    EDIT_TAREFA_ID = id || null;
    var t = id ? TAREFAS.find(function (x) { return x.id === id; }) : null;
    buildProjetoChipPicker(t ? t.projeto_id : null);
    $('tarefa-modal-title').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
    $('tarefa-nome').value = t ? t.name : '';
    setSingleChip('tarefa-status-picker', 'tarefa-status', t ? t.status : 'Não Iniciado');
    TAREFA_TIPO_SEL = t ? t.tipo.slice() : [];
    setMultiChips('tarefa-tipo-picker', TAREFA_TIPO_SEL);
    /* Criar: pré-seleciona o projeto ativo do select do topo, se ele
       estiver Em Progresso (só esses aparecem como chip, ver
       buildProjetoChipPicker — um default fora dessa lista preencheria o
       hidden input sem nenhum chip marcado); senão o primeiro projeto Em
       Progresso. */
    var projetosEmProgresso = PROJETOS.filter(function (p) { return p.status === 'Em Progresso'; });
    var ativoValido = ACTIVE_PROJETO_ID && projetosEmProgresso.some(function (p) { return p.id === ACTIVE_PROJETO_ID; });
    var defaultProjeto = ativoValido ? ACTIVE_PROJETO_ID : (projetosEmProgresso[0] ? projetosEmProgresso[0].id : '');
    setSingleChip('tarefa-projeto-picker', 'tarefa-projeto-id', t ? t.projeto_id : defaultProjeto);
    $('tarefa-data-entrega').value = (t && t.data_entrega) ? t.data_entrega : '';
    $('tarefa-descricao').value = (t && t.descricao) ? t.descricao : '';
    setDescricaoMode('Editar');
    $('tarefa-error').textContent = '';
    $('tarefa-delete').hidden = !t;
    resetTarefaDeletePending();
    setTarefaSaving(false);
    $('tarefa-modal').classList.add('open');
    if (!t) { var ni = $('tarefa-nome'); if (ni) ni.focus(); }
  }
  function closeTarefaModal() { $('tarefa-modal').classList.remove('open'); EDIT_TAREFA_ID = null; }
  function setTarefaSaving(on) { $('tarefa-save').disabled = on; $('tarefa-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  function setDescricaoMode(mode) {
    TAREFA_DESCRICAO_MODE = mode;
    var btns = document.querySelectorAll('#tarefa-descricao-mode .chip-opt');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-selected', btns[i].getAttribute('data-value') === mode);
    var isPreview = mode === 'Pré-visualizar';
    $('tarefa-descricao').hidden = isPreview;
    var preview = $('tarefa-descricao-preview');
    preview.hidden = !isPreview;
    if (isPreview) {
      var src = $('tarefa-descricao').value.trim();
      preview.innerHTML = src ? renderMarkdown(src) : '';
      preview.classList.toggle('is-empty', !src);
    }
  }

  function onTarefaSubmit(e) {
    e.preventDefault();
    var name = $('tarefa-nome').value.trim();
    var status = $('tarefa-status').value;
    var projeto_id = $('tarefa-projeto-id').value;
    var data_entrega = $('tarefa-data-entrega').value || null;
    var descricao = $('tarefa-descricao').value.trim() || null;
    if (!name) { $('tarefa-error').textContent = 'nome obrigatório'; return; }
    if (!projeto_id) { $('tarefa-error').textContent = 'selecione um projeto'; return; }

    setTarefaSaving(true);
    $('tarefa-error').textContent = '';
    var payload = { name: name, status: status, tipo: TAREFA_TIPO_SEL.slice(), projeto_id: projeto_id, data_entrega: data_entrega, descricao: descricao };

    var req = EDIT_TAREFA_ID
      ? apiTarefasUpdate(SESSION_PW, EDIT_TAREFA_ID, payload)
      : apiTarefasCreate(SESSION_PW, payload);

    /* Guarda ANTES de fechar o modal — closeTarefaModal() zera
       EDIT_TAREFA_ID, então checá-lo depois de chamar closeTarefaModal()
       sempre lia null e caía no ramo de criar, duplicando a linha (a antiga
       ficava e uma "nova" com o mesmo id era empurrada — só sumia depois de
       um refresh). */
    var wasEditing = EDIT_TAREFA_ID;
    /* Projeto ANTIGO da tarefa (se editando) — precisa pra invalidar o
       cache dele também caso a edição TROQUE de projeto (a tarefa "sai" de
       lá, mas sem isso a entrada cacheada daquele projeto continuaria com
       a versão antiga até um refresh). */
    var oldProjetoId = null;
    if (wasEditing) {
      var existingTarefa = TAREFAS.find(function (x) { return x.id === wasEditing; });
      oldProjetoId = existingTarefa ? existingTarefa.projeto_id : null;
    }
    req.then(function (j) {
      var saved = j.tarefa;
      closeTarefaModal();
      /* "Todos os projetos" sempre invalida — qualquer create/edit/move
         afeta essa visão agregada. O projeto NOVO da tarefa também, mesmo
         que não seja o ativo (senão ficaria com uma versão desatualizada
         esperando um refresh manual). E o projeto ANTIGO, se mudou. */
      delete TAREFAS_CACHE[''];
      delete TAREFAS_CACHE[saved.projeto_id];
      if (oldProjetoId && oldProjetoId !== saved.projeto_id) delete TAREFAS_CACHE[oldProjetoId];

      /* Em "Todos os projetos" (ACTIVE_PROJETO_ID === '') qualquer projeto
         serve; com um projeto específico ativo, só aparece se bater. */
      if (ACTIVE_PROJETO_ID && saved.projeto_id !== ACTIVE_PROJETO_ID) { writeCache(); return; } /* tarefa movida/criada pra outro projeto: não aparece aqui */
      if (wasEditing) {
        for (var i = 0; i < TAREFAS.length; i++) { if (TAREFAS[i].id === saved.id) { TAREFAS[i] = saved; break; } }
      } else {
        TAREFAS.push(saved);
      }
      TAREFAS_CACHE[ACTIVE_PROJETO_ID] = TAREFAS.slice();
      writeCache();
      renderAll();
    }).catch(function (err) {
      setTarefaSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('tarefa-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* Excluir (confirmação inline de dois cliques, cópia isolada do mesmo
     padrão de financas.js/eventos.js/lifeos.js — ver LIFEOS.md §2/§6). */
  var TAREFA_DELETE_PENDING = false;
  function resetTarefaDeletePending() {
    TAREFA_DELETE_PENDING = false;
    var btn = $('tarefa-delete');
    btn.textContent = 'Excluir'; btn.disabled = false;
  }
  function onTarefaDeleteClick() {
    if (!EDIT_TAREFA_ID) return;
    var btn = $('tarefa-delete');
    if (!TAREFA_DELETE_PENDING) {
      TAREFA_DELETE_PENDING = true;
      btn.textContent = 'confirmar?';
      return;
    }
    btn.disabled = true; btn.textContent = 'Excluindo…';
    apiTarefasDelete(SESSION_PW, EDIT_TAREFA_ID).then(function () {
      var id = EDIT_TAREFA_ID;
      closeTarefaModal();
      for (var i = 0; i < TAREFAS.length; i++) { if (TAREFAS[i].id === id) { TAREFAS.splice(i, 1); break; } }
      delete TAREFAS_CACHE[''];
      TAREFAS_CACHE[ACTIVE_PROJETO_ID] = TAREFAS.slice();
      writeCache();
      renderAll();
    }).catch(function (err) {
      resetTarefaDeletePending();
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao excluir — ' + ((err && err.detail) || 'tente de novo'));
    });
  }

  /* ── Gate / boot ─────────────────────────────────────────────── */
  function enterApp() { if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar(); $('gate').hidden = true; $('gate-checking').hidden = true; $('app').hidden = false; }
  function showGateForm() { $('gate').hidden = false; $('gate-checking').hidden = true; $('gate-form').hidden = false; $('app').hidden = true; var i = $('gate-input'); if (i) i.focus(); }
  function setGateLoading(on) { $('gate-btn').disabled = on; $('gate-btn').textContent = on ? '…' : '→'; }
  function shake() { var f = $('gate-row'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
  function setLoading(on) { $('loading').hidden = !on; }

  /* localStorage.getItem devolve null quando a chave nunca foi salva —
     diferente de '' (salva explicitamente como "Todos os projetos"), então
     dá pra distinguir "sem preferência" de "prefere ver tudo". */
  function resolveActiveProjeto() {
    var saved = null;
    try { saved = localStorage.getItem(LS_ACTIVE_PROJETO); } catch (_e) {}
    if (saved === '') ACTIVE_PROJETO_ID = '';
    else if (saved && findProjeto(saved)) ACTIVE_PROJETO_ID = saved;
    else ACTIVE_PROJETO_ID = PROJETOS[0] ? PROJETOS[0].id : null;
  }

  function loadInitial() {
    var cache = readCache();
    if (cache) {
      PROJETOS = cache.projetos || [];
      TAREFAS_CACHE = cache.tarefas_by_projeto || {};
      resolveActiveProjeto();
      renderProjetoSelect();
      return loadTarefas();
    }
    return apiProjetosQuery(SESSION_PW).then(function (j) {
      PROJETOS = j.projetos || [];
      TAREFAS_CACHE = {};
      resolveActiveProjeto();
      renderProjetoSelect();
      writeCache();
      return loadTarefas();
    });
  }

  function authAndLoad(pw) {
    SESSION_PW = pw;
    /* Vocabulário antes dos dados: os seletores e as cores de status
       dependem dele já no primeiro render. */
    return carregarVocab(pw)
      .then(loadInitial)
      .then(function () { enterApp(); });
  }

  /* ↻ — só invalida/rebusca PROJETOS + o projeto ATIVO (mesmo espírito do
     botão de Finanças, que só re-busca o mês em tela); os outros projetos
     ficam cacheados e são re-buscados naturalmente na próxima vez que
     forem selecionados. */
  var TAR_REFRESHING = false;
  function onRefresh() {
    if (!SESSION_PW || TAR_REFRESHING) return;
    TAR_REFRESHING = true;
    var btn = $('refresh-btn');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    delete TAREFAS_CACHE[ACTIVE_PROJETO_ID];
    Promise.all([
      apiProjetosQuery(SESSION_PW),
      ACTIVE_PROJETO_ID === null ? Promise.resolve({ tarefas: [] }) : apiTarefasQuery(SESSION_PW, ACTIVE_PROJETO_ID),
    ]).then(function (res) {
      PROJETOS = res[0].projetos || [];
      TAREFAS = res[1].tarefas || [];
      if (ACTIVE_PROJETO_ID !== null) TAREFAS_CACHE[ACTIVE_PROJETO_ID] = TAREFAS;
      writeCache();
      renderProjetoSelect();
      renderAll();
      updateFetchedLabel();
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao atualizar — ' + ((err && err.detail) || 'tente de novo'));
    }).then(function () {
      TAR_REFRESHING = false;
      if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    var pw = $('gate-input').value.trim();
    if (!pw) return;
    setGateLoading(true);
    $('gate-error').textContent = '';
    authAndLoad(pw).then(function () {
      setGateLoading(false);
      if ($('gate-remember').checked) localStorage.setItem(LS_KEY, pw); else localStorage.removeItem(LS_KEY);
    }).catch(function (err) {
      setGateLoading(false);
      SESSION_PW = '';
      if (err && err.code === 'unauthorized') { shake(); $('gate-error').textContent = 'senha incorreta'; $('gate-input').value = ''; $('gate-input').focus(); }
      else $('gate-error').textContent = 'erro ao carregar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    dropCache();
    SESSION_PW = ''; PROJETOS = []; TAREFAS = []; TAREFAS_CACHE = {}; ACTIVE_PROJETO_ID = null;
    if (TAR_STATUS_CHART) { TAR_STATUS_CHART.destroy(); TAR_STATUS_CHART = null; }
    if (TAR_TIPO_CHART) { TAR_TIPO_CHART.destroy(); TAR_TIPO_CHART = null; }
    clearFilters(); switchTarView('kanban');
    closeTarefaModal();
    $('gate-input').value = ''; $('gate-remember').checked = false; $('gate-error').textContent = '';
    showGateForm();
  }

  function boot() {
    if (IS_LOCAL_DEV) {
      showDevBadge();
      authAndLoad('local-dev').catch(function (err) {
        $('gate-checking').hidden = true;
        $('gate-error').textContent = 'mock local falhou — ' + ((err && err.detail) || 'ver console');
        showGateForm();
      });
      return;
    }
    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }
    $('gate').hidden = false; $('gate-form').hidden = true; $('gate-checking').hidden = false;
    authAndLoad(saved).catch(function (err) {
      localStorage.removeItem(LS_KEY); $('gate-checking').hidden = true; showGateForm();
      if (err && err.code === 'unauthorized') $('gate-error').textContent = 'sessão expirada — entre novamente';
    });
  }

  function init() {
    if (window.Chart) { Chart.defaults.font.family = "'JetBrains Mono', monospace"; Chart.defaults.color = '#b0a898'; }
    $('gate-form').addEventListener('submit', onSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('refresh-btn').addEventListener('click', onRefresh);

    buildChipOptions('tarefa-status-picker', STATUS_TAREFA);
    buildChipOptions('tarefa-tipo-picker', TIPOS_TAREFA);
    buildChipOptions('tarefa-descricao-mode', MD_MODES);

    $('projeto-select').addEventListener('change', function (e) { setActiveProjeto(e.target.value); });
    $('add-tarefa-btn').addEventListener('click', function () { openTarefaModal(null); });

    $('kanban-board').addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.kanban-card') : null;
      if (card) openTarefaModal(card.getAttribute('data-id'));
    });

    /* Drag-and-drop de status: arrastar um card pra outra coluna. Eventos
       delegados no board inteiro (cards são recriados a cada render). */
    $('kanban-board').addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.kanban-card') : null;
      if (!card) return;
      DRAG_TAREFA_ID = card.getAttribute('data-id');
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', DRAG_TAREFA_ID); } catch (_e) {}
      }
    });
    $('kanban-board').addEventListener('dragend', function (e) {
      var card = e.target.closest ? e.target.closest('.kanban-card') : null;
      if (card) card.classList.remove('is-dragging');
      DRAG_TAREFA_ID = null;
      var targets = document.querySelectorAll('.kanban-col.is-drop-target');
      for (var i = 0; i < targets.length; i++) targets[i].classList.remove('is-drop-target');
    });
    $('kanban-board').addEventListener('dragover', function (e) {
      var col = e.target.closest ? e.target.closest('.kanban-col') : null;
      if (!col) return;
      e.preventDefault(); /* obrigatório — sem isso o navegador nunca dispara 'drop' */
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      col.classList.add('is-drop-target');
    });
    $('kanban-board').addEventListener('dragleave', function (e) {
      var col = e.target.closest ? e.target.closest('.kanban-col') : null;
      if (col && (!e.relatedTarget || !col.contains(e.relatedTarget))) col.classList.remove('is-drop-target');
    });
    $('kanban-board').addEventListener('drop', function (e) {
      var col = e.target.closest ? e.target.closest('.kanban-col') : null;
      if (!col) return;
      e.preventDefault();
      col.classList.remove('is-drop-target');
      var newStatus = col.getAttribute('data-status');
      var id = DRAG_TAREFA_ID || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (id && newStatus) onDropTarefaStatus(id, newStatus);
    });

    $('tar-list-tbody').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-id]') : null;
      if (row) openTarefaModal(row.getAttribute('data-id'));
    });

    var viewTabs = document.querySelectorAll('.view-tab');
    for (var vi = 0; vi < viewTabs.length; vi++) {
      viewTabs[vi].addEventListener('click', function (e) { switchTarView(e.currentTarget.getAttribute('data-view')); });
    }

    $('tipo-filters').addEventListener('click', function (e) {
      var clearBtn = e.target.closest ? e.target.closest('#tipo-filter-clear') : null;
      if (clearBtn) { clearTipoFilter(); return; }
      var chip = e.target.closest ? e.target.closest('.chip[data-tipo]') : null;
      if (chip) toggleTipoFilter(chip.getAttribute('data-tipo'));
    });

    $('tarefa-status-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) setSingleChip('tarefa-status-picker', 'tarefa-status', btn.getAttribute('data-value'));
    });
    $('tarefa-projeto-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) setSingleChip('tarefa-projeto-picker', 'tarefa-projeto-id', btn.getAttribute('data-value'));
    });
    $('tarefa-tipo-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) toggleMultiChip(btn, TAREFA_TIPO_SEL);
    });
    $('tarefa-descricao-mode').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) setDescricaoMode(btn.getAttribute('data-value'));
    });
    $('tarefa-form').addEventListener('submit', onTarefaSubmit);
    $('tarefa-cancel').addEventListener('click', closeTarefaModal);
    $('tarefa-modal-close').addEventListener('click', closeTarefaModal);
    $('tarefa-modal').addEventListener('click', function (e) { if (e.target === $('tarefa-modal')) closeTarefaModal(); });
    $('tarefa-delete').addEventListener('click', onTarefaDeleteClick);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('tarefa-modal').classList.contains('open')) { closeTarefaModal(); return; }
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
