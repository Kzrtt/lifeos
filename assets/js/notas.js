/**
 * notas.js — LifeOS · módulo Notas (/notas)
 *
 * JS cru, sem framework, sem build. Consumido por notas.html. Módulo
 * ISOLADO — não importa nem é importado por lifeos.js/tarefas.js/
 * financas.js/eventos.js (ver LIFEOS.md §2).
 *
 * Migrado do Notion em set/2026 (105 notas — ver NOTAS.md). Diferente de
 * Tarefas (projeto_id NOT NULL, 1:N), o vínculo a Projeto aqui é N:N de
 * fato: uma nota pode ter 0, 1 ou vários projetos (`projeto_ids`, array).
 * Sem status/kanban — a lista é sempre uma tabela única, filtrável por
 * projeto, tipo e busca por nome.
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
  var NOTAS_FN = CFG_FN_BASE + 'lifeos-notas';
  var VIEWS_FN = CFG_FN_BASE + 'lifeos-views';
  var ANON_KEY = window.LIFEOS_CONFIG ? window.LIFEOS_CONFIG.anonKey : '';
  var LS_KEY = (window.LIFEOS_CONFIG && window.LIFEOS_CONFIG.sessionKey) || 'financas_master';    /* mesma chave de /financas, /tarefas e /lifeos */
  var CACHE_KEY = 'notas_cache';     /* cache persistente (localStorage) — ver LIFEOS.md */
  var CACHE_V = 2;                   /* bump: cache ganhou o campo `views` */

  /* Os 12 valores reais da base Notion (ver NOTAS.md) — mais do que os 9
     listados no CLAUDE.md pessoal (Pessoal/Relato/Documentação faltavam lá). */
  var TIPOS_NOTA = [
    'Lembranças', 'Análise de Leitura', 'Pensamentos', 'Conclusões', 'Úteis',
    'Faculdade', 'Vida', 'Pesquisa', 'Programação', 'Pessoal', 'Relato', 'Documentação',
  ];

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
      var t = lista('nota_tipo');
      if (t.length) TIPOS_NOTA = t;
    }).catch(function (e) {
      console.warn('[notas] vocabulários indisponíveis — usando o fallback embutido', e);
    });
  }
  /* Paleta de cor por Tipo (3ª rodada, set/2026 — pedido explícito do autor:
     Tipo e Projeto pareciam "a mesma tag"). MESMOS 12 hex de
     NOT_TIPO_COR_PALETTE em lifeos.js — cópia isolada (ver LIFEOS.md §2),
     mas intencionalmente idêntica, pra Tipo ter a mesma cor nas duas telas
     (hub e página própria). Projeto NUNCA usa essa paleta — ver
     .tag-projeto no CSS, cor fixa neutra sem ícone (4ª rodada removeu o
     ícone de pasta que existia antes) — a diferença tem que ser óbvia sem
     precisar ler a cor. */
  var TIPO_COR_PALETTE = [
    '#c4913a', '#5b8def', '#3fb98c', '#e5616a', '#b06ee0', '#e58b5b',
    '#4fc3d9', '#d4a5e8', '#8a9b6e', '#e0c15c', '#6e9de0', '#c47a9a',
  ];
  var TIPO_COR = {};
  TIPOS_NOTA.forEach(function (t, i) { TIPO_COR[t] = TIPO_COR_PALETTE[i % TIPO_COR_PALETTE.length]; });

  /* ── Estado ──────────────────────────────────────────────────── */
  var SESSION_PW = '';
  var PROJETOS = [];
  var NOTAS = [];                /* todas as notas (não particionado por projeto — só ~100 linhas) */
  var PROJETO_FILTRO = '';       /* '' = Todos os projetos */
  var TIPO_FILTRO = new Set();
  var BUSCA_FILTRO = '';

  /* ── Views salvas (filtros combináveis, persistem via lifeos-views) ────
     A view "Todas" (sem filtro) é IMPLÍCITA — não é uma linha de VIEWS,
     ACTIVE_VIEW_ID null representa ela. Compõe (E lógico) com
     PROJETO_FILTRO/TIPO_FILTRO/BUSCA_FILTRO acima, em vez de substituí-los
     — ver matchesFiltro(). */
  var VIEWS = [];
  var ACTIVE_VIEW_ID = null;
  var EDIT_VIEW_ID = null;       /* null = #view-modal em modo "criar" */
  var VIEW_MODO = 'todas';       /* 'todas' (E) | 'qualquer' (OU) — estado do editor */
  var VIEW_REGRAS = [];          /* estado do editor de regras do #view-modal, ver renderRegrasEditor */
  var VIEW_CAMPOS = ['projeto', 'tipo']; /* campos válidos pra views de Notas (sem status — só Tarefas tem) */

  var EDIT_NOTA_ID = null;       /* null = modal de nota em modo "criar" */
  var DETAIL_NOTA_ID = null;     /* nota aberta no modal de detalhe */
  var NOTA_TIPO_SEL = [];        /* estado do chip-picker multi de Tipo no modal */
  var NOTA_PROJETO_SEL = [];     /* estado do chip-picker multi de Projetos no modal */
  var NOTAS_VIEW = 'cards';      /* 'cards' | 'lista' — toggle de view (pedido do autor, default Cards), sem persistência — mesmo padrão de TAR_VIEW em tarefas.js */
  var NOTA_EDITOR = null;        /* instância EasyMDE do #nota-conteudo, viva só enquanto #nota-modal está aberto */

  /* ── Helpers ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function fmtDate(d) { if (!d) return '—'; var p = d.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function findProjeto(id) { for (var i = 0; i < PROJETOS.length; i++) { if (PROJETOS[i].id === id) return PROJETOS[i]; } return null; }
  function projetoLabel(p) { return (p.emoji ? p.emoji + ' ' : '') + p.name; }

  /* Duas famílias de tag visualmente distintas — pedido explícito do autor
     (3ª rodada, set/2026): a leitura dava a entender que Projeto era "só
     mais uma tag" igual Tipo. `.tag-tipo` é colorida por tipo (TIPO_COR);
     `.tag-projeto` tem ícone de pasta + cor neutra fixa, formato distinto
     de propósito — a diferença precisa bater o olho, não só a cor. A
     antiga `.tag-proj` genérica (usada pros dois) foi removida em favor
     dessas duas. */
  /* 4ª rodada, set/2026 — correção de estilo (pedido explícito do autor):
     texto colorido era "vibrante demais" — agora é um PONTO colorido
     (--dot-color, via ::before no CSS) + texto neutro (--dim). Tag de
     projeto perdeu o ícone de pasta — só não ter cor já diferencia de
     tipo, sem precisar de mais ornamento nenhum. */
  function buildTipoTag(t) {
    var s = document.createElement('span'); s.className = 'tag-tipo'; s.textContent = t;
    s.style.setProperty('--dot-color', TIPO_COR[t] || 'var(--mute)');
    return s;
  }
  function buildProjetoTag(p) {
    var s = document.createElement('span'); s.className = 'tag-projeto';
    s.textContent = p ? projetoLabel(p) : '?';
    return s;
  }
  /* window.marked pode não estar disponível ainda (CDN lento/bloqueado) — cai
     pra texto puro escapado em vez de quebrar a pré-visualização. */
  function renderMarkdown(src) {
    if (!src) return '';
    if (window.marked && window.marked.parse) return window.marked.parse(src);
    var div = document.createElement('div'); div.textContent = src;
    return '<p>' + div.innerHTML.replace(/\n/g, '<br>') + '</p>';
  }

  /* Mantém NOTAS na mesma ordem que a Edge Function devolve — `data` desc
     (nulls por último), depois `created_at` desc como desempate. A maioria
     das notas tem `data` preenchida (a data real do conteúdo — mesma
     lógica de ordenação que a database no Notion usava); `created_at` é só
     quando/como a linha entrou no Supabase, sem relação com a cronologia
     real do conteúdo, então nunca deve ser o critério primário. Sem essa
     função, um create/update local (push/replace em memória) deixaria a
     lista fora de ordem até o próximo refresh. */
  function sortNotas() {
    NOTAS.sort(function (a, b) {
      var ad = a.data, bd = b.data;
      if (ad && bd) { if (ad !== bd) return ad < bd ? 1 : -1; }
      else if (ad !== bd) { return ad ? -1 : 1; }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  /* Trecho de preview pra visão · Cards — texto puro (sem parse de
     markdown), símbolos de bloco mais comuns removidos pra não sobrar
     "#"/"-"/">" soltos no começo da linha cortada. */
  function noteSnippet(md) {
    if (!md) return '';
    var s = md
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/[*_`]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return s.length > 140 ? s.slice(0, 140).trim() + '…' : s;
  }

  /* Valor bruto de uma nota pro campo de uma regra — único ponto que muda
     por tabela (cópia isolada equivalente existe em tarefas.js/lifeos.js,
     ver LIFEOS.md §2). */
  function getCampoNota(campo, n) {
    if (campo === 'projeto') return n.projeto_ids || [];
    if (campo === 'tipo') return n.tipo || [];
    return [];
  }
  /* '__sem_projeto__' é o sentinela pro estado "nota sem projeto nenhum" —
     só existe pra Notas (única tabela onde isso é um estado real de
     verdade, ver NOTAS.md §1). */
  function matchesRegra(campoVal, regra) {
    var arr = Array.isArray(campoVal) ? campoVal : [campoVal];
    var bate = regra.valores.some(function (v) { return arr.indexOf(v) !== -1; }) ||
      (regra.campo === 'projeto' && !arr.length && regra.valores.indexOf('__sem_projeto__') !== -1);
    return regra.operador === 'excluir' ? !bate : bate;
  }
  function matchesView(n, view) {
    if (!view || !view.regras.length) return true;
    var results = view.regras.map(function (r) { return matchesRegra(getCampoNota(r.campo, n), r); });
    return view.modo === 'qualquer' ? results.some(Boolean) : results.every(Boolean);
  }
  function activeView() {
    if (!ACTIVE_VIEW_ID) return null;
    return VIEWS.find(function (v) { return v.id === ACTIVE_VIEW_ID; }) || null;
  }

  function matchesFiltro(n) {
    if (PROJETO_FILTRO && (n.projeto_ids || []).indexOf(PROJETO_FILTRO) === -1) return false;
    if (TIPO_FILTRO.size && !(n.tipo || []).some(function (t) { return TIPO_FILTRO.has(t); })) return false;
    if (BUSCA_FILTRO && n.name.toLowerCase().indexOf(BUSCA_FILTRO) === -1) return false;
    if (!matchesView(n, activeView())) return false;
    return true;
  }
  function visibleNotas() { return NOTAS.filter(matchesFiltro); }

  /* ── Dev mock (ambiente local) — mesmo motivo dos outros módulos. ── */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function mockDelay(value) { return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, 220); }); }

  var MOCK_PROJETOS = null;
  var MOCK_NOTAS = null;
  function seedMockData() {
    MOCK_PROJETOS = [
      { id: 'mock-proj-1', name: 'LifeOS', emoji: '📚', status: 'Em Progresso', tags: ['Pessoal'] },
      { id: 'mock-proj-2', name: 'Faculdade', emoji: null, status: 'Em Progresso', tags: ['Acadêmico'] },
      { id: 'mock-proj-3', name: 'Psicodelia', emoji: null, status: 'Feito', tags: ['Pessoal'] },
    ];
    MOCK_NOTAS = [
      {
        id: 'mock-nota-1', name: 'Bhagavad Gita — Introdução', tipo: ['Análise de Leitura', 'Conclusões'],
        data: '2026-06-05', projeto_ids: ['mock-proj-1'],
        conteudo_md: '> É melhor o seu próprio dharma sem qualidade do que o dharma de outro bem executado\n\nPara atingir o dharma é preciso reconhecer si-mesmo — apenas esse conhecimento liberta o yogui da ilusão.',
        created_at: '2026-06-05T18:00:00.000Z', updated_at: '2026-06-05T18:00:00.000Z',
      },
      {
        id: 'mock-nota-2', name: 'Análise da viabilidade da IA psiconauta', tipo: ['Faculdade', 'Pesquisa'],
        data: '2026-05-20', projeto_ids: ['mock-proj-2'],
        conteudo_md: '# Contexto\n\nComparação entre sklearn clássico e fine-tuning de LLM.\n\n## sklearn\n- Bag of Words\n- Naive Bayes\n- K-Means\n\n> A distinção mais importante: sklearn é uma calculadora sofisticada, um LLM fine-tunado é um cérebro sintético.\n\n## Conclusão\n\nCaminho pragmático: fazer o trabalho com sklearn, explorar fine-tuning como projeto pessoal.',
        created_at: '2026-05-20T12:00:00.000Z', updated_at: '2026-05-20T12:00:00.000Z',
      },
      {
        id: 'mock-nota-3', name: '[08/06/2024] Visual do Fone', tipo: ['Lembranças', 'Conclusões', 'Vida'],
        data: null, projeto_ids: ['mock-proj-3', 'mock-proj-1'],
        conteudo_md: 'Sensação extrema de quebrar o fone — luzes vermelhas e azuis, sensação inexplicável.',
        created_at: '2026-04-01T09:00:00.000Z', updated_at: '2026-04-01T09:00:00.000Z',
      },
      {
        id: 'mock-nota-4', name: 'Nota rápida sem projeto', tipo: ['Pensamentos'],
        data: null, projeto_ids: [],
        conteudo_md: null,
        created_at: '2026-03-01T09:00:00.000Z', updated_at: '2026-03-01T09:00:00.000Z',
      },
    ];
  }
  var MOCK_VIEWS = [];
  function mockViewsQuery() { return { ok: true, views: MOCK_VIEWS.slice() }; }
  function mockViewsCreate(v) {
    var now = new Date().toISOString();
    var ordem = MOCK_VIEWS.length ? Math.max.apply(null, MOCK_VIEWS.map(function (x) { return x.ordem; })) + 1 : 0;
    var created = Object.assign({ id: 'mock-view-' + Date.now(), ordem: ordem, created_at: now, updated_at: now }, v);
    MOCK_VIEWS.push(created);
    return { ok: true, view: created };
  }
  function mockViewsUpdate(id, patch) {
    var existing = null;
    for (var i = 0; i < MOCK_VIEWS.length; i++) { if (MOCK_VIEWS[i].id === id) { existing = MOCK_VIEWS[i]; break; } }
    var withTimestamp = Object.assign({}, patch, { updated_at: new Date().toISOString() });
    var updated = Object.assign({}, existing || { id: id }, withTimestamp);
    if (existing) Object.assign(existing, withTimestamp);
    return { ok: true, view: updated };
  }
  function mockViewsDelete(id) {
    for (var i = 0; i < MOCK_VIEWS.length; i++) { if (MOCK_VIEWS[i].id === id) { MOCK_VIEWS.splice(i, 1); break; } }
    return { ok: true, id: id };
  }
  function mockProjetosQuery() { if (!MOCK_PROJETOS) seedMockData(); return { ok: true, projetos: MOCK_PROJETOS.slice() }; }
  function mockNotasQuery() { if (!MOCK_NOTAS) seedMockData(); return { ok: true, notas: MOCK_NOTAS.slice() }; }
  function mockNotasCreate(n) {
    if (!MOCK_NOTAS) seedMockData();
    var now = new Date().toISOString();
    var created = Object.assign({ id: 'mock-nota-new-' + Date.now(), created_at: now, updated_at: now }, n);
    MOCK_NOTAS.push(created);
    return { ok: true, nota: created };
  }
  function mockNotasUpdate(id, patch) {
    if (!MOCK_NOTAS) seedMockData();
    var existing = null;
    for (var i = 0; i < MOCK_NOTAS.length; i++) { if (MOCK_NOTAS[i].id === id) { existing = MOCK_NOTAS[i]; break; } }
    var withTimestamp = Object.assign({}, patch, { updated_at: new Date().toISOString() });
    var updated = Object.assign({}, existing || { id: id }, withTimestamp);
    if (existing) Object.assign(existing, withTimestamp);
    return { ok: true, nota: updated };
  }
  function mockNotasDelete(id) {
    if (MOCK_NOTAS) { for (var i = 0; i < MOCK_NOTAS.length; i++) { if (MOCK_NOTAS[i].id === id) { MOCK_NOTAS.splice(i, 1); break; } } }
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
  function apiNotasQuery(pw) { return IS_LOCAL_DEV ? mockDelay(mockNotasQuery()) : callFn(NOTAS_FN, { token: pw }); }
  function apiNotasCreate(pw, nota) { return IS_LOCAL_DEV ? mockDelay(mockNotasCreate(nota)) : callFn(NOTAS_FN, { token: pw, action: 'create', nota: nota }); }
  function apiNotasUpdate(pw, id, patch) { return IS_LOCAL_DEV ? mockDelay(mockNotasUpdate(id, patch)) : callFn(NOTAS_FN, { token: pw, action: 'update', id: id, patch: patch }); }
  function apiNotasDelete(pw, id) { return IS_LOCAL_DEV ? mockDelay(mockNotasDelete(id)) : callFn(NOTAS_FN, { token: pw, action: 'delete', id: id }); }
  function apiViewsQuery(pw) { return IS_LOCAL_DEV ? mockDelay(mockViewsQuery()) : callFn(VIEWS_FN, { token: pw, tabela: 'notas' }); }
  function apiViewsCreate(pw, view) { return IS_LOCAL_DEV ? mockDelay(mockViewsCreate(view)) : callFn(VIEWS_FN, { token: pw, action: 'create', view: Object.assign({ tabela: 'notas' }, view) }); }
  function apiViewsUpdate(pw, id, patch) { return IS_LOCAL_DEV ? mockDelay(mockViewsUpdate(id, patch)) : callFn(VIEWS_FN, { token: pw, action: 'update', id: id, patch: patch }); }
  function apiViewsDelete(pw, id) { return IS_LOCAL_DEV ? mockDelay(mockViewsDelete(id)) : callFn(VIEWS_FN, { token: pw, action: 'delete', id: id }); }

  /* ── Chip pickers genéricos (multi-select) ──────────────────────
     Clicar alterna aquele valor num array — usado em Tipo e Projetos, os
     dois são N:N aqui (diferente de tarefas.js, onde Projeto é single). */
  function buildChipOptions(hostId, values, labelFn) {
    var host = $(hostId); host.innerHTML = '';
    values.forEach(function (v) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip-opt'; btn.setAttribute('data-value', typeof v === 'string' ? v : v.id);
      btn.textContent = labelFn ? labelFn(v) : v;
      host.appendChild(btn);
    });
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

  /* Picker de projetos do modal de atributos — reconstrói toda vez que o
     modal abre (vocabulário muda se um projeto novo for criado em
     lifeos.html). Só projetos "Em Progresso" entram na lista — não faz
     sentido vincular uma nota nova a um projeto Pausado/Feito/Não Iniciado
     (mesma regra e mesmo motivo do picker de tarefas.js, ver
     buildProjetoChipPicker lá; decisão revertida em set/2026 — a versão
     anterior deste doc/código listava TODOS os projetos, decisão que o
     o autor reverteu explicitamente). Exceção: qualquer projeto já em
     NOTA_PROJETO_SEL continua aparecendo mesmo se não estiver mais Em
     Progresso — senão o(s) chip(s) da seleção atual sumiriam e uma nota
     editada pareceria perder o vínculo no formulário (mesma exceção do
     picker de tarefas.js, adaptada pra N:N — aqui pode ser mais de um id). */
  function buildProjetoChipPicker() {
    var visiveis = PROJETOS.filter(function (p) {
      return p.status === 'Em Progresso' || NOTA_PROJETO_SEL.indexOf(p.id) !== -1;
    });
    buildChipOptions('nota-projeto-picker', visiveis, projetoLabel);
  }

  /* ── Seletor de projeto (filtro, topo da página) ────────────────
     "Todos os projetos" (value="") é o default — nenhum filtro de projeto. */
  function renderProjetoSelect() {
    var sel = $('projeto-select'); sel.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = ''; allOpt.textContent = 'Todos os projetos';
    sel.appendChild(allOpt);
    PROJETOS.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = projetoLabel(p);
      sel.appendChild(opt);
    });
    sel.value = PROJETO_FILTRO;
  }

  /* ── Filtro por tipo (badges) — presença calculada sobre TODAS as notas,
     mesmo padrão de tarefas.js/financas.js: os chips refletem o
     vocabulário inteiro, não o subconjunto já filtrado. ── */
  function buildTipoFilterChips() {
    var host = $('tipo-filters'); host.innerHTML = '';
    var present = {};
    NOTAS.forEach(function (n) { (n.tipo || []).forEach(function (t) { present[t] = true; }); });
    var any = Object.keys(present).length > 0;
    host.hidden = !any;
    if (!any) return;
    var lbl = document.createElement('span'); lbl.className = 'filters-label'; lbl.textContent = 'filtrar por tipo:';
    host.appendChild(lbl);
    TIPOS_NOTA.forEach(function (t) {
      if (!present[t]) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (TIPO_FILTRO.has(t) ? ' active' : ''); b.setAttribute('data-tipo', t);
      b.textContent = t;
      host.appendChild(b);
    });
    if (TIPO_FILTRO.size) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip chip-clear'; c.id = 'tipo-filter-clear';
      c.innerHTML = 'limpar <i class="fad fa-times"></i>';
      host.appendChild(c);
    }
  }
  function toggleTipoFilter(t) {
    if (TIPO_FILTRO.has(t)) TIPO_FILTRO.delete(t); else TIPO_FILTRO.add(t);
    renderAll();
  }
  function clearTipoFilter() { TIPO_FILTRO.clear(); renderAll(); }

  /* ── Views (badges) — "Todas" (fixa, sem regra) + uma por VIEWS + "+ Nova
     view". Clicar na badge JÁ ativa (não-Todas) abre o editor em modo
     editar — evita precisar de um ícone de lápis à parte. ── */
  function renderViewBadges() {
    var host = $('view-filters'); if (!host) return;
    host.innerHTML = '';
    var lbl = document.createElement('span'); lbl.className = 'filters-label'; lbl.textContent = 'view:';
    host.appendChild(lbl);

    var todas = document.createElement('button');
    todas.type = 'button'; todas.className = 'chip' + (!ACTIVE_VIEW_ID ? ' active' : '');
    todas.textContent = 'Todas';
    host.appendChild(todas);

    VIEWS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (v.id === ACTIVE_VIEW_ID ? ' active' : ''); b.setAttribute('data-view-id', v.id);
      b.textContent = v.nome;
      host.appendChild(b);
    });

    var nova = document.createElement('button');
    nova.type = 'button'; nova.className = 'chip chip-clear'; nova.id = 'view-add-btn';
    nova.innerHTML = '+ Nova view';
    host.appendChild(nova);
  }
  function onViewBadgeClick(e) {
    var nova = e.target.closest ? e.target.closest('#view-add-btn') : null;
    if (nova) { openViewModal(null); return; }
    var btn = e.target.closest ? e.target.closest('.chip') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-view-id');
    if (!id) { ACTIVE_VIEW_ID = null; renderAll(); return; }
    if (id === ACTIVE_VIEW_ID) { openViewModal(id); return; }
    ACTIVE_VIEW_ID = id; renderAll();
  }

  /* ── Modal · view (criar/editar/excluir) ──────────────────────── */
  function opcoesValoresPorCampo(campo) {
    if (campo === 'tipo') return TIPOS_NOTA.map(function (t) { return { value: t, label: t }; });
    /* projeto: TODOS (não só "Em Progresso") — a view é um filtro passivo,
       não cria vínculo novo, então referenciar um projeto já Feito/Pausado
       continua fazendo sentido. '__sem_projeto__' é o sentinela de "nota
       sem projeto nenhum" (ver matchesRegra). */
    var opts = PROJETOS.map(function (p) { return { value: p.id, label: projetoLabel(p) }; });
    opts.push({ value: '__sem_projeto__', label: '— sem projeto —' });
    return opts;
  }
  function renderRegrasEditor() {
    var host = $('view-regras-list'); host.innerHTML = '';
    VIEW_REGRAS.forEach(function (regra, idx) {
      var row = document.createElement('div'); row.className = 'view-regra-row'; row.setAttribute('data-idx', idx);

      var campoSel = document.createElement('select'); campoSel.className = 'edit-input view-regra-campo';
      VIEW_CAMPOS.forEach(function (c) {
        var opt = document.createElement('option'); opt.value = c; opt.textContent = c === 'projeto' ? 'Projeto' : 'Tipo';
        if (c === regra.campo) opt.selected = true;
        campoSel.appendChild(opt);
      });
      row.appendChild(campoSel);

      var opSel = document.createElement('select'); opSel.className = 'edit-input view-regra-operador';
      [['incluir', 'Incluir'], ['excluir', 'Excluir']].forEach(function (p) {
        var opt = document.createElement('option'); opt.value = p[0]; opt.textContent = p[1];
        if (p[0] === regra.operador) opt.selected = true;
        opSel.appendChild(opt);
      });
      row.appendChild(opSel);

      var valores = document.createElement('div'); valores.className = 'chip-picker view-regra-valores';
      opcoesValoresPorCampo(regra.campo).forEach(function (o) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'chip-opt' + (regra.valores.indexOf(o.value) !== -1 ? ' is-selected' : '');
        b.setAttribute('data-value', o.value); b.textContent = o.label;
        valores.appendChild(b);
      });
      row.appendChild(valores);

      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'icon-btn icon-btn-danger view-regra-remove'; rm.setAttribute('aria-label', 'Remover regra');
      rm.innerHTML = '<i class="fad fa-trash"></i>';
      row.appendChild(rm);

      host.appendChild(row);
    });
  }
  function onRegrasListChange(e) {
    var row = e.target.closest ? e.target.closest('.view-regra-row') : null;
    if (!row) return;
    var idx = Number(row.getAttribute('data-idx'));
    if (e.target.classList.contains('view-regra-campo')) { VIEW_REGRAS[idx].campo = e.target.value; VIEW_REGRAS[idx].valores = []; renderRegrasEditor(); }
    else if (e.target.classList.contains('view-regra-operador')) { VIEW_REGRAS[idx].operador = e.target.value; }
  }
  function onRegrasListClick(e) {
    var row = e.target.closest ? e.target.closest('.view-regra-row') : null;
    if (!row) return;
    var idx = Number(row.getAttribute('data-idx'));
    if (e.target.closest('.view-regra-remove')) { VIEW_REGRAS.splice(idx, 1); renderRegrasEditor(); return; }
    var chip = e.target.closest ? e.target.closest('.chip-opt') : null;
    if (chip) { toggleMultiChip(chip, VIEW_REGRAS[idx].valores); }
  }
  function addRegraRow() { VIEW_REGRAS.push({ campo: 'projeto', operador: 'incluir', valores: [] }); renderRegrasEditor(); }

  function setViewModo(modo) {
    VIEW_MODO = modo;
    var btns = document.querySelectorAll('#view-modo-picker .chip-opt');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-selected', btns[i].getAttribute('data-value') === modo);
  }

  function openViewModal(id) {
    EDIT_VIEW_ID = id || null;
    var v = id ? VIEWS.find(function (x) { return x.id === id; }) : null;
    $('view-modal-title').textContent = v ? 'Editar view' : 'Nova view';
    $('view-icon-actions').hidden = !v;
    if (v) resetDeletePendingUI($('view-delete'), '<i class="fad fa-trash"></i>');
    $('view-nome').value = v ? v.nome : '';
    setViewModo(v ? v.modo : 'todas');
    /* Cópia profunda — editar aqui não pode mexer no objeto de VIEWS
       enquanto o usuário ainda não salvou (Cancelar precisa descartar). */
    VIEW_REGRAS = v ? JSON.parse(JSON.stringify(v.regras)) : [{ campo: 'projeto', operador: 'incluir', valores: [] }];
    renderRegrasEditor();
    $('view-error').textContent = '';
    setViewSaving(false);
    $('view-modal').classList.add('open');
  }
  function closeViewModal() { $('view-modal').classList.remove('open'); EDIT_VIEW_ID = null; }
  function setViewSaving(on) { $('view-save').disabled = on; $('view-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  function onViewSubmit(e) {
    e.preventDefault();
    var nome = $('view-nome').value.trim();
    if (!nome) { $('view-error').textContent = 'nome obrigatório'; return; }
    if (!VIEW_REGRAS.length) { $('view-error').textContent = 'adicione ao menos uma regra'; return; }
    for (var i = 0; i < VIEW_REGRAS.length; i++) {
      if (!VIEW_REGRAS[i].valores.length) { $('view-error').textContent = 'toda regra precisa de ao menos um valor selecionado'; return; }
    }

    setViewSaving(true);
    $('view-error').textContent = '';
    var payload = { nome: nome, modo: VIEW_MODO, regras: VIEW_REGRAS };
    var req = EDIT_VIEW_ID ? apiViewsUpdate(SESSION_PW, EDIT_VIEW_ID, payload) : apiViewsCreate(SESSION_PW, payload);

    req.then(function (j) {
      var saved = j.view;
      closeViewModal();
      var found = false;
      for (var i = 0; i < VIEWS.length; i++) { if (VIEWS[i].id === saved.id) { VIEWS[i] = saved; found = true; break; } }
      if (!found) VIEWS.push(saved);
      ACTIVE_VIEW_ID = saved.id;
      writeCache();
      renderAll();
    }).catch(function (err) {
      setViewSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('view-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }
  function onViewDeleteClick() {
    var btn = $('view-delete');
    var id = EDIT_VIEW_ID;
    if (!id) return;
    if (!DELETE_PENDING) { DELETE_PENDING = true; btn.classList.add('confirming'); btn.textContent = 'confirmar?'; return; }
    btn.disabled = true; btn.textContent = 'Excluindo…';
    apiViewsDelete(SESSION_PW, id).then(function () {
      closeViewModal();
      for (var i = 0; i < VIEWS.length; i++) { if (VIEWS[i].id === id) { VIEWS.splice(i, 1); break; } }
      if (ACTIVE_VIEW_ID === id) ACTIVE_VIEW_ID = null;
      writeCache();
      renderAll();
    }).catch(function (err) {
      resetDeletePendingUI(btn, '<i class="fad fa-trash"></i>');
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao excluir — ' + ((err && err.detail) || 'tente de novo'));
    });
  }

  /* ── Visão · Lista (tabela) ──────────────────────────────────── */
  function renderListView() {
    var tbody = $('notas-tbody'); tbody.innerHTML = '';
    var rows = visibleNotas();
    if (!rows.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td'); td.colSpan = 4; td.className = 'notas-table-empty';
      td.textContent = NOTAS.length ? 'nenhuma nota com esse filtro' : 'nenhuma nota ainda';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    rows.forEach(function (n) {
      var row = document.createElement('tr'); row.setAttribute('data-id', n.id);
      var td1 = document.createElement('td'); td1.className = 'td-nota-name'; td1.textContent = n.name;

      var td2 = document.createElement('td');
      var tipoWrap = document.createElement('div'); tipoWrap.className = 'td-nota-tags';
      (n.tipo || []).forEach(function (t) { tipoWrap.appendChild(buildTipoTag(t)); });
      td2.appendChild(tipoWrap);

      var td3 = document.createElement('td');
      var projWrap = document.createElement('div'); projWrap.className = 'td-nota-tags';
      (n.projeto_ids || []).forEach(function (pid) { projWrap.appendChild(buildProjetoTag(findProjeto(pid))); });
      td3.appendChild(projWrap);

      var td4 = document.createElement('td'); td4.className = 'td-nota-data'; td4.textContent = fmtDate(n.data);

      row.appendChild(td1); row.appendChild(td2); row.appendChild(td3); row.appendChild(td4);
      tbody.appendChild(row);
    });
  }

  /* ── Visão · Cards (default, pedido do autor) — mesmo peso visual de
     .manif-card no hub, sem banner de imagem (nota não tem), com um trecho
     de conteúdo (noteSnippet) pra dar contexto sem abrir o detalhe. ── */
  function renderCardsView() {
    var host = $('notas-cards-view'); host.innerHTML = '';
    var rows = visibleNotas();
    if (!rows.length) {
      var empty = document.createElement('div'); empty.className = 'notas-grid-empty';
      empty.textContent = NOTAS.length ? 'nenhuma nota com esse filtro' : 'nenhuma nota ainda';
      host.appendChild(empty);
      return;
    }
    rows.forEach(function (n) {
      var card = document.createElement('div'); card.className = 'nota-card'; card.setAttribute('data-id', n.id);

      var name = document.createElement('div'); name.className = 'nota-card-name'; name.textContent = n.name;
      card.appendChild(name);

      /* Tipo e Projeto em linhas SEPARADAS (pedido explícito do autor — a
         versão anterior misturava os dois numa .nota-card-tags única,
         "dava a entender que projeto é outra tag"). */
      if ((n.tipo || []).length) {
        var tipoRow = document.createElement('div'); tipoRow.className = 'nota-card-tags';
        n.tipo.forEach(function (t) { tipoRow.appendChild(buildTipoTag(t)); });
        card.appendChild(tipoRow);
      }
      if ((n.projeto_ids || []).length) {
        var projRow = document.createElement('div'); projRow.className = 'nota-card-tags';
        n.projeto_ids.forEach(function (pid) { projRow.appendChild(buildProjetoTag(findProjeto(pid))); });
        card.appendChild(projRow);
      }

      var divider = document.createElement('div'); divider.className = 'nota-card-divider';
      card.appendChild(divider);

      var snippet = document.createElement('div'); snippet.className = 'nota-card-snippet';
      var snip = noteSnippet(n.conteudo_md);
      if (snip) { snippet.textContent = snip; } else { snippet.textContent = 'sem conteúdo'; snippet.classList.add('is-empty'); }
      card.appendChild(snippet);

      /* Ícone-botões (Tela cheia / Editar / Exportar PDF) do lado OPOSTO da
         data — pedido explícito do autor, 4ª rodada. data-action é lido pelo
         listener de clique de #notas-cards-view, que intercepta ANTES de
         cair no fallback de abrir o detalhe (ver init()). */
      var foot = document.createElement('div'); foot.className = 'nota-card-foot';
      var actionsWrap = document.createElement('div'); actionsWrap.className = 'nota-card-actions';
      var expandBtn = document.createElement('button');
      expandBtn.type = 'button'; expandBtn.className = 'nota-card-action-btn'; expandBtn.setAttribute('aria-label', 'Abrir em tela cheia');
      expandBtn.setAttribute('data-action', 'expand'); expandBtn.setAttribute('data-id', n.id);
      expandBtn.innerHTML = '<i class="fad fa-expand"></i>';
      var editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'nota-card-action-btn'; editBtn.setAttribute('aria-label', 'Editar nota');
      editBtn.setAttribute('data-action', 'edit'); editBtn.setAttribute('data-id', n.id);
      editBtn.innerHTML = '<i class="fad fa-pen"></i>';
      var exportBtn = document.createElement('button');
      exportBtn.type = 'button'; exportBtn.className = 'nota-card-action-btn'; exportBtn.setAttribute('aria-label', 'Exportar PDF');
      exportBtn.setAttribute('data-action', 'export'); exportBtn.setAttribute('data-id', n.id);
      exportBtn.innerHTML = '<i class="fad fa-file-pdf"></i>';
      actionsWrap.appendChild(expandBtn); actionsWrap.appendChild(editBtn); actionsWrap.appendChild(exportBtn);
      foot.appendChild(actionsWrap);
      var date = document.createElement('span'); date.className = 'nota-card-date'; date.textContent = fmtDate(n.data);
      foot.appendChild(date);
      card.appendChild(foot);

      host.appendChild(card);
    });
  }

  /* Toggle Lista/Cards — cópia do padrão de switchTarView em tarefas.js:
     só alterna a aba ativa e o hidden das duas views; ambas já são
     renderizadas sempre em renderAll(), então não precisa refazer nada
     aqui. */
  function switchNotasView(id) {
    NOTAS_VIEW = id;
    var tabs = document.querySelectorAll('.view-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === id);
    $('notas-cards-view').hidden = id !== 'cards';
    $('notas-lista-view').hidden = id !== 'lista';
  }

  function renderAll() {
    renderViewBadges();
    buildTipoFilterChips();
    renderListView();
    renderCardsView();
  }

  /* ── Cache persistente (localStorage, JSON) — mesmo princípio de
     tarefas_cache/financas_cache/lifeos_hub_cache (ver LIFEOS.md). Lista
     única (não particionada por projeto como tarefas.js) — só ~100 linhas,
     não vale a granularidade extra. ── */
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
        v: CACHE_V, fetched_at: new Date().toISOString(), projetos: PROJETOS, notas: NOTAS, views: VIEWS,
      }));
    } catch (_e) { /* quota/indisponível: cache só em memória nesta sessão */ }
  }
  function dropCache() { try { localStorage.removeItem(CACHE_KEY); } catch (_e) {} }

  function updateFetchedLabel() {
    var el = $('fetched-at');
    if (!el) return;
    var cache = readCache();
    if (!cache || !cache.fetched_at) { el.textContent = ''; return; }
    el.textContent = 'sincronizado ' + new Date(cache.fetched_at).toLocaleString('pt-BR');
  }

  function loadInitial() {
    var cache = readCache();
    if (cache) {
      PROJETOS = cache.projetos || [];
      NOTAS = cache.notas || [];
      VIEWS = cache.views || [];
      renderProjetoSelect();
      renderAll();
      updateFetchedLabel();
      return Promise.resolve();
    }
    setLoading(true);
    return Promise.all([apiProjetosQuery(SESSION_PW), apiNotasQuery(SESSION_PW), apiViewsQuery(SESSION_PW)]).then(function (res) {
      PROJETOS = res[0].projetos || [];
      NOTAS = res[1].notas || [];
      VIEWS = res[2].views || [];
      renderProjetoSelect();
      renderAll();
      writeCache();
      updateFetchedLabel();
    }).then(function () { setLoading(false); }, function (err) { setLoading(false); return Promise.reject(err); });
  }

  function authAndLoad(pw) {
    SESSION_PW = pw;
    /* Vocabulário antes dos dados: o chip-picker de tipos depende dele. */
    return carregarVocab(pw).then(loadInitial).then(function () {
      enterApp();
      /* Link direto/favoritado/compartilhado (notas.html?nota=<id>) — abre
         a view de leitura direto no boot, sem passar pela tela de cards
         primeiro (ver D.3 do plano). showLeituraView, não openLeituraView:
         a URL já É essa, empilhar de novo no histórico seria redundante. */
      var notaId = parseNotaIdFromUrl();
      if (notaId) showLeituraView(notaId);
    });
  }

  var NOT_REFRESHING = false;
  function onRefresh() {
    if (!SESSION_PW || NOT_REFRESHING) return;
    NOT_REFRESHING = true;
    var btn = $('refresh-btn');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    Promise.all([apiProjetosQuery(SESSION_PW), apiNotasQuery(SESSION_PW), apiViewsQuery(SESSION_PW)]).then(function (res) {
      PROJETOS = res[0].projetos || [];
      NOTAS = res[1].notas || [];
      VIEWS = res[2].views || [];
      writeCache();
      renderProjetoSelect();
      renderAll();
      updateFetchedLabel();
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao atualizar — ' + ((err && err.detail) || 'tente de novo'));
    }).then(function () {
      NOT_REFRESHING = false;
      if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    });
  }

  /* ── Modal · detalhe (leitura completa + Excluir/Editar atributos/
     Editar texto) ── */
  function openDetailModal(id) {
    var n = null;
    for (var i = 0; i < NOTAS.length; i++) { if (NOTAS[i].id === id) { n = NOTAS[i]; break; } }
    if (!n) return;
    DETAIL_NOTA_ID = id;
    $('detail-modal-title').textContent = n.name;
    /* Data vira o badge no canto superior esquerdo do banner (pedido
       explícito do autor) — não entra mais como tag em .detail-meta. */
    var dateBadge = $('detail-banner-date');
    if (n.data) { dateBadge.textContent = fmtDate(n.data); dateBadge.hidden = false; } else { dateBadge.hidden = true; }
    /* Tipo e Projeto em linhas SEPARADAS (mesma reestruturação dos cards/
       lista, pedido explícito do autor — nunca mais "projeto parece só
       outra tag"). */
    var meta = $('detail-modal-meta'); meta.innerHTML = '';
    if ((n.tipo || []).length) {
      var metaTipoRow = document.createElement('div'); metaTipoRow.className = 'detail-meta-row';
      n.tipo.forEach(function (t) { metaTipoRow.appendChild(buildTipoTag(t)); });
      meta.appendChild(metaTipoRow);
    }
    if ((n.projeto_ids || []).length) {
      var metaProjRow = document.createElement('div'); metaProjRow.className = 'detail-meta-row';
      n.projeto_ids.forEach(function (pid) { metaProjRow.appendChild(buildProjetoTag(findProjeto(pid))); });
      meta.appendChild(metaProjRow);
    }
    $('detail-modal-content').innerHTML = renderMarkdown(n.conteudo_md);
    $('detail-modal').classList.add('open');
  }
  function closeDetailModal() { $('detail-modal').classList.remove('open'); DETAIL_NOTA_ID = null; }

  /* ── Exportar PDF — print-to-PDF nativo do navegador ────────────────
     Sem dependência nova: popula #pdf-export-root (fora do fluxo normal,
     só visível via @media print — ver CSS) com um header simples do
     sistema, os atributos da nota (Tipo/Projeto(s)/Data) e o corpo via o
     MESMO renderMarkdown() já usado na leitura — nunca duplica a lógica de
     parse nem perde estilização, porque .pdf-content reusa .nota-content e
     as MESMAS variáveis CSS, só recoloridas pra papel branco (ver CSS).
     window.print() abre o diálogo nativo; o usuário escolhe "Salvar como
     PDF" — resultado é vetorial, texto selecionável/pesquisável. */
  function buildPdfExport(n) {
    var root = $('pdf-export-root'); root.innerHTML = '';

    var header = document.createElement('div'); header.className = 'pdf-header';
    var brand = document.createElement('span'); brand.className = 'pdf-brand';
    brand.textContent = '✦ LifeOS · LifeOS · Notas';
    var gen = document.createElement('span'); gen.className = 'pdf-generated';
    gen.textContent = 'Gerado em ' + new Date().toLocaleString('pt-BR');
    header.appendChild(brand); header.appendChild(gen);
    root.appendChild(header);
    var headerRule = document.createElement('div'); headerRule.className = 'pdf-header-rule';
    root.appendChild(headerRule);

    var title = document.createElement('div'); title.className = 'pdf-title'; title.textContent = n.name;
    root.appendChild(title);

    /* Atributos — mesma ordem de .detail-meta/.leitura-meta (Tipo, depois
       Projeto(s)); Data sempre aparece (mesmo padrão de fmtDate() na
       coluna Data da tabela — '—' quando vazia, nunca escondida). */
    var attrs = document.createElement('div'); attrs.className = 'pdf-attrs';
    if ((n.tipo || []).length) {
      var tipoRow = document.createElement('div'); tipoRow.className = 'pdf-attrs-row';
      var tipoLbl = document.createElement('span'); tipoLbl.className = 'pdf-attrs-label'; tipoLbl.textContent = 'Tipo';
      var tipoTags = document.createElement('div'); tipoTags.className = 'pdf-attrs-tags';
      n.tipo.forEach(function (t) { var s = document.createElement('span'); s.className = 'pdf-tag'; s.textContent = t; tipoTags.appendChild(s); });
      tipoRow.appendChild(tipoLbl); tipoRow.appendChild(tipoTags);
      attrs.appendChild(tipoRow);
    }
    if ((n.projeto_ids || []).length) {
      var projRow = document.createElement('div'); projRow.className = 'pdf-attrs-row';
      var projLbl = document.createElement('span'); projLbl.className = 'pdf-attrs-label'; projLbl.textContent = 'Projeto(s)';
      var projTags = document.createElement('div'); projTags.className = 'pdf-attrs-tags';
      n.projeto_ids.forEach(function (pid) {
        var p = findProjeto(pid);
        var s = document.createElement('span'); s.className = 'pdf-tag'; s.textContent = p ? projetoLabel(p) : '?';
        projTags.appendChild(s);
      });
      projRow.appendChild(projLbl); projRow.appendChild(projTags);
      attrs.appendChild(projRow);
    }
    var dataRow = document.createElement('div'); dataRow.className = 'pdf-attrs-row';
    var dataLbl = document.createElement('span'); dataLbl.className = 'pdf-attrs-label'; dataLbl.textContent = 'Data';
    var dataVal = document.createElement('span'); dataVal.className = 'pdf-attrs-value'; dataVal.textContent = fmtDate(n.data);
    dataRow.appendChild(dataLbl); dataRow.appendChild(dataVal);
    attrs.appendChild(dataRow);
    root.appendChild(attrs);

    var divider = document.createElement('div'); divider.className = 'pdf-divider';
    root.appendChild(divider);

    var content = document.createElement('div'); content.className = 'nota-content pdf-content';
    content.innerHTML = renderMarkdown(n.conteudo_md);
    root.appendChild(content);
  }
  /* O navegador sugere document.title como nome de arquivo no diálogo de
     "Salvar como PDF" — troca temporária pro nome da nota (em vez do
     título fixo da aba, "Psychḗs · Notas"), restaurado no 'afterprint'
     (dispara tanto ao salvar quanto ao cancelar o diálogo). */
  function exportNotaPdf(id) {
    if (!id) return;
    var n = null;
    for (var i = 0; i < NOTAS.length; i++) { if (NOTAS[i].id === id) { n = NOTAS[i]; break; } }
    if (!n) return;
    buildPdfExport(n);
    var originalTitle = document.title;
    function restoreTitle() {
      document.title = originalTitle;
      window.removeEventListener('afterprint', restoreTitle);
    }
    window.addEventListener('afterprint', restoreTitle);
    document.title = n.name;
    window.print();
  }

  /* Excluir — confirmação inline de dois cliques, cópia isolada do mesmo
     padrão de tarefas.js/financas.js (ver LIFEOS.md §2/§7). Generalizada
     pra servir a view de leitura em tela cheia (DETAIL_NOTA_ID, botão de
     texto) E o modal de atributos (EDIT_NOTA_ID, icon-button — 6ª rodada,
     set/2026) — dois botões diferentes (`btn`), dois jeitos de "fechar"
     depois de excluir (`closeFn`), o id relevante em cada contexto passado
     explícito. `restingHTML` é o conteúdo do botão fora do estado de
     confirmação — texto simples ("Excluir", default) pro botão de texto da
     leitura, um `<i>` de ícone pro icon-button dos atributos; sem isso o
     reset trocaria o ícone por texto permanentemente. `.confirming`
     (mesma classe/visual de `.row-action-btn.confirming` em lifeos.html,
     ver LIFEOS.md §7) faz o icon-button crescer pra caber "confirmar?" —
     no botão de texto é inofensivo (CSS não define nada pra
     `.edit-btn.confirming`, some sem efeito). */
  var DELETE_PENDING = false;
  function resetDeletePendingUI(btn, restingHTML) {
    DELETE_PENDING = false;
    btn.classList.remove('confirming');
    btn.innerHTML = restingHTML || 'Excluir';
    btn.disabled = false;
  }
  function onDeleteClick(btn, closeFn, id, restingHTML) {
    if (!id) return;
    if (!DELETE_PENDING) {
      DELETE_PENDING = true;
      btn.classList.add('confirming');
      btn.textContent = 'confirmar?';
      return;
    }
    btn.disabled = true; btn.textContent = 'Excluindo…';
    apiNotasDelete(SESSION_PW, id).then(function () {
      closeFn();
      for (var i = 0; i < NOTAS.length; i++) { if (NOTAS[i].id === id) { NOTAS.splice(i, 1); break; } }
      writeCache();
      renderAll();
    }).catch(function (err) {
      resetDeletePendingUI(btn, restingHTML);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao excluir — ' + ((err && err.detail) || 'tente de novo'));
    });
  }

  /* ── View · Leitura em tela cheia (#nota-leitura-view) ─────────────────
     3ª rodada, set/2026 — pedido explícito do autor: "uma tela para
     leitura, além do modal". NÃO é um arquivo novo — é um modo de view
     dentro da própria notas.html (ao lado de 'cards'/'lista'), porque o
     gate/boot/dados já existem em memória aqui; duplicar tudo isso só pra
     mostrar uma nota não compensava. URL ganha `?nota=<id>` via
     history.pushState — permite favoritar/compartilhar o link direto e
     usar o botão Voltar do navegador (ver popstate abaixo). ──

     showLeituraView() é o render puro (sem tocar histórico) — usado tanto
     por openLeituraView() (ação do usuário, empilha estado novo) quanto
     pelo boot inicial com `?nota=` na URL (a entrada já É a URL certa,
     empilhar de novo duplicaria o histórico) quanto pelo popstate (o
     browser já mudou a URL, só falta sincronizar a UI). */
  function parseNotaIdFromUrl() {
    var m = /(?:^|[?&])nota=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function showLeituraView(id) {
    var n = null;
    for (var i = 0; i < NOTAS.length; i++) { if (NOTAS[i].id === id) { n = NOTAS[i]; break; } }
    if (!n) return false;
    DETAIL_NOTA_ID = id;
    $('leitura-name').textContent = n.name;
    var meta = $('leitura-meta'); meta.innerHTML = '';
    if ((n.tipo || []).length) {
      var tipoRow = document.createElement('div'); tipoRow.className = 'leitura-meta-row';
      n.tipo.forEach(function (t) { tipoRow.appendChild(buildTipoTag(t)); });
      meta.appendChild(tipoRow);
    }
    if ((n.projeto_ids || []).length) {
      var projRow = document.createElement('div'); projRow.className = 'leitura-meta-row';
      n.projeto_ids.forEach(function (pid) { projRow.appendChild(buildProjetoTag(findProjeto(pid))); });
      meta.appendChild(projRow);
    }
    if (n.data) {
      var dateRow = document.createElement('div'); dateRow.className = 'leitura-meta-row';
      var d = document.createElement('span'); d.className = 'leitura-date'; d.textContent = fmtDate(n.data);
      dateRow.appendChild(d); meta.appendChild(dateRow);
    }
    $('leitura-content').innerHTML = renderMarkdown(n.conteudo_md);
    resetDeletePendingUI($('leitura-delete'));

    $('notas-head').hidden = true;
    $('notas-filtros-bar').hidden = true;
    $('tipo-filters').hidden = true;
    $('notas-cards-view').hidden = true;
    $('notas-lista-view').hidden = true;
    $('nota-leitura-view').hidden = false;
    /* Topbar "← LifeOS" vira "← Notas" enquanto a leitura está ativa — ver
       #topbar-back-link, pedido explícito do autor (4ª rodada, set/2026):
       substitui o botão "← Notas" que existia solto dentro da view. O
       clique é interceptado em init() checando o hidden desta view, não
       precisa trocar listener aqui. */
    $('topbar-back-label').textContent = 'Notas';
    window.scrollTo(0, 0);
    return true;
  }
  /* Restaura cards/lista sem tocar histórico — usada por closeLeituraView
     (que ainda faz o pushState) e pelo popstate (o browser já mudou a URL
     pra fora de ?nota=, não deve empilhar mais nada). */
  function restoreListView() {
    $('nota-leitura-view').hidden = true;
    $('notas-head').hidden = false;
    $('notas-filtros-bar').hidden = false;
    $('topbar-back-label').textContent = 'LifeOS';
    buildTipoFilterChips();     /* só reaparece se houver o que filtrar — mesma lógica de sempre */
    switchNotasView(NOTAS_VIEW); /* volta pra Cards ou Lista, o que estava ativo antes de entrar na leitura */
    DETAIL_NOTA_ID = null;
  }
  function openLeituraView(id) {
    if (!showLeituraView(id)) return;
    history.pushState({ notaId: id }, '', 'notas.html?nota=' + encodeURIComponent(id));
  }
  function closeLeituraView() {
    restoreListView();
    history.pushState({}, '', 'notas.html');
  }
  window.addEventListener('popstate', function () {
    var id = parseNotaIdFromUrl();
    if (id) showLeituraView(id); else restoreListView();
  });

  /* ── Modal · nota · atributos (criar/editar nome/tipo/projetos/data) ──
     Conteúdo NUNCA aparece aqui — mora só no #nota-content-modal abaixo
     (pedido explícito do autor: 3 modais bem separados — leitura, atributos,
     texto, nunca dois desses num só). Criar salva só os atributos e, no
     sucesso, encadeia direto pra abrir o modal de texto com o id
     recém-criado (ver onAttrsSubmit) — dá pra escrever o corpo na
     sequência sem precisar reabrir a nota depois. */
  function openAttrsModal(id) {
    EDIT_NOTA_ID = id || null;
    var n = id ? NOTAS.find(function (x) { return x.id === id; }) : null;
    $('nota-attrs-modal-title').textContent = n ? 'Editar atributos' : 'Nova nota';
    /* Excluir/Editar texto só fazem sentido editando uma nota que já existe
       — linha inteira escondida ao criar (ver comentário no HTML). */
    $('nota-attrs-icon-actions').hidden = !n;
    if (n) resetDeletePendingUI($('nota-attrs-delete'), '<i class="fad fa-trash"></i>');
    $('nota-nome').value = n ? n.name : '';
    NOTA_TIPO_SEL = n ? n.tipo.slice() : [];
    setMultiChips('nota-tipo-picker', NOTA_TIPO_SEL);
    /* NOTA_PROJETO_SEL precisa estar pronto ANTES de buildProjetoChipPicker
       — o picker lê esse array pra decidir a exceção de projeto fora de
       "Em Progresso" (ver buildProjetoChipPicker). */
    NOTA_PROJETO_SEL = n ? (n.projeto_ids || []).slice() : [];
    buildProjetoChipPicker();
    setMultiChips('nota-projeto-picker', NOTA_PROJETO_SEL);
    $('nota-data').value = (n && n.data) ? n.data : '';
    $('nota-attrs-error').textContent = '';
    setAttrsSaving(false);
    $('nota-attrs-modal').classList.add('open');
    if (!n) { var ni = $('nota-nome'); if (ni) ni.focus(); }
  }
  function closeAttrsModal() { $('nota-attrs-modal').classList.remove('open'); EDIT_NOTA_ID = null; }
  function setAttrsSaving(on) { $('nota-attrs-save').disabled = on; $('nota-attrs-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  function onAttrsSubmit(e) {
    e.preventDefault();
    var name = $('nota-nome').value.trim();
    var data = $('nota-data').value || null;
    if (!name) { $('nota-attrs-error').textContent = 'nome obrigatório'; return; }

    setAttrsSaving(true);
    $('nota-attrs-error').textContent = '';
    var payload = { name: name, tipo: NOTA_TIPO_SEL.slice(), projeto_ids: NOTA_PROJETO_SEL.slice(), data: data };

    var req = EDIT_NOTA_ID
      ? apiNotasUpdate(SESSION_PW, EDIT_NOTA_ID, payload)
      : apiNotasCreate(SESSION_PW, payload);

    /* Guarda ANTES de fechar o modal — closeAttrsModal() zera EDIT_NOTA_ID,
       e checá-lo só depois sempre cairia no ramo de criar (mesmo bug já
       corrigido em tarefas.js/lifeos.js — ver LIFEOS.md §9). */
    var wasEditing = EDIT_NOTA_ID;
    req.then(function (j) {
      var saved = j.nota;
      closeAttrsModal();
      if (wasEditing) {
        for (var i = 0; i < NOTAS.length; i++) { if (NOTAS[i].id === saved.id) { NOTAS[i] = saved; break; } }
        sortNotas();
        writeCache();
        renderAll();
      } else {
        NOTAS.push(saved);
        sortNotas();
        writeCache();
        renderAll();
        /* Nota recém-criada nasce sem conteúdo — encadeia direto pro modal
           de texto pra escrever o corpo na hora. */
        openContentModal(saved.id);
      }
    }).catch(function (err) {
      setAttrsSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('nota-attrs-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* ── Modal · nota · texto (edição de conteúdo via EasyMDE) ───────────
     Exclusivo pro corpo em markdown — nome/tipo/projeto/data moram só no
     #nota-attrs-modal acima. Só abre pra nota que já tem id (nunca do
     zero — ver fluxo de criação em onAttrsSubmit). O editor vem com
     toolbar, Pré-visualizar/Lado-a-lado/Tela cheia embutidos, essencial
     pra notas de até ~18KB (a maior da base migrada, ver NOTAS.md). Vive
     só enquanto o modal está aberto (initNotaEditor no open,
     destroyNotaEditor no close) — mesmo ciclo de vida que os gráficos
     Chart.js seguem em tarefas.js/lifeos.js (destruir antes de recriar).
     Se o CDN falhar (window.EasyMDE indisponível), cai pro textarea
     nativo sem quebrar o formulário — mesma postura defensiva de
     renderMarkdown() com window.marked. */
  function initNotaEditor(initial) {
    destroyNotaEditor();
    $('nota-conteudo').value = initial || '';
    if (!window.EasyMDE) return;
    NOTA_EDITOR = new EasyMDE({
      element: $('nota-conteudo'),
      spellChecker: false,
      status: false,
      minHeight: '46vh',
      placeholder: '# título, **negrito**, listas, links…',
      toolbar: [
        'bold', 'italic', 'heading', '|',
        'quote', 'code', 'unordered-list', 'ordered-list', '|',
        'link', 'image', 'table', 'horizontal-rule', '|',
        'preview', 'side-by-side', 'fullscreen', '|',
        'guide',
      ],
    });
  }
  function destroyNotaEditor() {
    if (!NOTA_EDITOR) return;
    NOTA_EDITOR.toTextArea();
    NOTA_EDITOR = null;
  }

  function openContentModal(id) {
    EDIT_NOTA_ID = id;
    var n = NOTAS.find(function (x) { return x.id === id; });
    $('nota-content-modal-title').textContent = n ? n.name : 'Nota';
    initNotaEditor((n && n.conteudo_md) ? n.conteudo_md : '');
    $('nota-content-error').textContent = '';
    setContentSaving(false);
    $('nota-content-modal').classList.add('open');
  }
  function closeContentModal() {
    $('nota-content-modal').classList.remove('open'); EDIT_NOTA_ID = null;
    destroyNotaEditor();
  }
  function setContentSaving(on) { $('nota-content-save').disabled = on; $('nota-content-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  function onContentSubmit(e) {
    e.preventDefault();
    var id = EDIT_NOTA_ID;
    if (!id) return;
    var conteudo_md = (NOTA_EDITOR ? NOTA_EDITOR.value() : $('nota-conteudo').value).trim() || null;

    setContentSaving(true);
    $('nota-content-error').textContent = '';
    apiNotasUpdate(SESSION_PW, id, { conteudo_md: conteudo_md }).then(function (j) {
      var saved = j.nota;
      closeContentModal();
      for (var i = 0; i < NOTAS.length; i++) { if (NOTAS[i].id === saved.id) { NOTAS[i] = saved; break; } }
      writeCache();
      renderAll();
    }).catch(function (err) {
      setContentSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('nota-content-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* ── Gate / boot ─────────────────────────────────────────────── */
  function enterApp() { if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar(); $('gate').hidden = true; $('gate-checking').hidden = true; $('app').hidden = false; }
  function showGateForm() { $('gate').hidden = false; $('gate-checking').hidden = true; $('gate-form').hidden = false; $('app').hidden = true; var i = $('gate-input'); if (i) i.focus(); }
  function setGateLoading(on) { $('gate-btn').disabled = on; $('gate-btn').textContent = on ? '…' : '→'; }
  function shake() { var f = $('gate-row'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
  function setLoading(on) { $('loading').hidden = !on; }

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
    SESSION_PW = ''; PROJETOS = []; NOTAS = []; PROJETO_FILTRO = ''; TIPO_FILTRO.clear(); BUSCA_FILTRO = '';
    VIEWS = []; ACTIVE_VIEW_ID = null;
    closeAttrsModal(); closeContentModal(); closeDetailModal(); closeViewModal();
    restoreListView();
    if (parseNotaIdFromUrl()) history.replaceState(null, '', 'notas.html'); /* limpa ?nota= sem empilhar histórico */
    $('gate-input').value = ''; $('gate-remember').checked = false; $('gate-error').textContent = '';
    $('busca-input').value = '';
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
    $('gate-form').addEventListener('submit', onSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('refresh-btn').addEventListener('click', onRefresh);

    buildChipOptions('nota-tipo-picker', TIPOS_NOTA);

    var viewTabs = document.querySelectorAll('.view-tab');
    for (var vi = 0; vi < viewTabs.length; vi++) {
      viewTabs[vi].addEventListener('click', function (e) { switchNotasView(e.currentTarget.getAttribute('data-view')); });
    }

    $('projeto-select').addEventListener('change', function (e) { PROJETO_FILTRO = e.target.value; renderAll(); });
    $('busca-input').addEventListener('input', function (e) { BUSCA_FILTRO = e.target.value.trim().toLowerCase(); renderAll(); });
    $('add-nota-btn').addEventListener('click', function () { openAttrsModal(null); });

    $('notas-tbody').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-id]') : null;
      if (row) openDetailModal(row.getAttribute('data-id'));
    });
    $('notas-cards-view').addEventListener('click', function (e) {
      /* Ícone-botões (Tela cheia / Editar) interceptados ANTES do fallback
         de abrir o detalhe — 4ª rodada, set/2026 (ver renderCardsView). */
      var actionBtn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (actionBtn) {
        e.stopPropagation();
        var id = actionBtn.getAttribute('data-id');
        var action = actionBtn.getAttribute('data-action');
        if (action === 'expand') openLeituraView(id);
        else if (action === 'edit') openAttrsModal(id);
        else if (action === 'export') exportNotaPdf(id);
        return;
      }
      var card = e.target.closest ? e.target.closest('.nota-card[data-id]') : null;
      if (card) openDetailModal(card.getAttribute('data-id'));
    });

    $('tipo-filters').addEventListener('click', function (e) {
      var clearBtn = e.target.closest ? e.target.closest('#tipo-filter-clear') : null;
      if (clearBtn) { clearTipoFilter(); return; }
      var chip = e.target.closest ? e.target.closest('.chip[data-tipo]') : null;
      if (chip) toggleTipoFilter(chip.getAttribute('data-tipo'));
    });

    $('view-filters').addEventListener('click', onViewBadgeClick);
    $('view-add-regra').addEventListener('click', addRegraRow);
    $('view-regras-list').addEventListener('change', onRegrasListChange);
    $('view-regras-list').addEventListener('click', onRegrasListClick);
    $('view-modo-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) setViewModo(btn.getAttribute('data-value'));
    });
    $('view-form').addEventListener('submit', onViewSubmit);
    $('view-cancel').addEventListener('click', closeViewModal);
    $('view-modal-close').addEventListener('click', closeViewModal);
    $('view-modal').addEventListener('click', function (e) { if (e.target === $('view-modal')) closeViewModal(); });
    $('view-delete').addEventListener('click', onViewDeleteClick);

    $('nota-tipo-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) toggleMultiChip(btn, NOTA_TIPO_SEL);
    });
    $('nota-projeto-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) toggleMultiChip(btn, NOTA_PROJETO_SEL);
    });
    $('nota-attrs-form').addEventListener('submit', onAttrsSubmit);
    $('nota-attrs-cancel').addEventListener('click', closeAttrsModal);
    $('nota-attrs-modal-close').addEventListener('click', closeAttrsModal);
    $('nota-attrs-modal').addEventListener('click', function (e) { if (e.target === $('nota-attrs-modal')) closeAttrsModal(); });
    $('nota-attrs-edit-content').addEventListener('click', function () { var id = EDIT_NOTA_ID; closeAttrsModal(); openContentModal(id); });
    $('nota-attrs-delete').addEventListener('click', function () { onDeleteClick($('nota-attrs-delete'), closeAttrsModal, EDIT_NOTA_ID, '<i class="fad fa-trash"></i>'); });

    $('nota-content-form').addEventListener('submit', onContentSubmit);
    $('nota-content-cancel').addEventListener('click', closeContentModal);
    $('nota-content-modal-close').addEventListener('click', closeContentModal);
    $('nota-content-modal').addEventListener('click', function (e) { if (e.target === $('nota-content-modal')) closeContentModal(); });

    $('detail-modal-close').addEventListener('click', closeDetailModal);
    $('detail-modal').addEventListener('click', function (e) { if (e.target === $('detail-modal')) closeDetailModal(); });
    $('detail-fullscreen').addEventListener('click', function () { var id = DETAIL_NOTA_ID; closeDetailModal(); openLeituraView(id); });
    $('detail-export-pdf').addEventListener('click', function () { exportNotaPdf(DETAIL_NOTA_ID); });

    /* ── View de leitura em tela cheia — mesmos handlers de edição/exclusão
       do #detail-modal, só que fechando a view (não um modal) antes de
       abrir o modal correspondente. "← Voltar" é o próprio link do topbar
       (ver #topbar-back-link) — intercepta a navegação pra LifeOS SÓ
       quando a leitura está ativa (checa o hidden na hora do clique, sem
       precisar trocar listener dinamicamente). ── */
    $('topbar-back-link').addEventListener('click', function (e) {
      if (!$('nota-leitura-view').hidden) { e.preventDefault(); closeLeituraView(); }
    });
    $('leitura-edit-attrs').addEventListener('click', function () { var id = DETAIL_NOTA_ID; closeLeituraView(); openAttrsModal(id); });
    $('leitura-edit-content').addEventListener('click', function () { var id = DETAIL_NOTA_ID; closeLeituraView(); openContentModal(id); });
    $('leitura-delete').addEventListener('click', function () { onDeleteClick($('leitura-delete'), closeLeituraView, DETAIL_NOTA_ID); });
    $('leitura-export-pdf').addEventListener('click', function () { exportNotaPdf(DETAIL_NOTA_ID); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('nota-attrs-modal').classList.contains('open')) { closeAttrsModal(); return; }
      if ($('nota-content-modal').classList.contains('open')) { closeContentModal(); return; }
      if ($('view-modal').classList.contains('open')) { closeViewModal(); return; }
      if ($('detail-modal').classList.contains('open')) { closeDetailModal(); return; }
      if (!$('nota-leitura-view').hidden) { closeLeituraView(); return; }
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
