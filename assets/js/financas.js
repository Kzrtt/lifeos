/**
 * financas.js — LifeOS · LifeOS · módulo Finanças (/financas)
 *
 * JS cru, sem framework, sem build. Consumido por financas.html. Módulo
 * ISOLADO — não sabe nada sobre o hub (lifeos.html/lifeos.js) nem sobre
 * Eventos (eventos.html/eventos.js); só compartilha o backend (mesma senha
 * mestre) e, no localStorage, a chave da senha lembrada ('financas_master')
 * — de propósito, pra "lembrar" valer nas três páginas do LifeOS.
 *
 * Backend: Edge Function lifeos-movimentacoes, sobre a tabela própria
 * public.lifeos_movimentacoes (Supabase) — não lê o Notion. O Notion
 * continua existindo só como fonte da view de notas do LifeOS, fora deste
 * módulo.
 *
 * Busca POR MÊS, sob demanda: cada navegação chama a Edge Function com
 * { token, ym } e recebe só aquele mês + o `range` global de meses (pra
 * travar as setas).
 *
 * Cache "burro" PERSISTENTE (localStorage, JSON): cada mês buscado é gravado e
 * sobrevive a reloads e dias — abrir um mês já cacheado NÃO chama a Edge
 * Function (renderiza direto do cache, inclusive no boot). O ↻ é a única forma
 * de buscar dados novos: invalida e re-busca SÓ o mês na tela. O label
 * "sincronizado" mostra quando AQUELE mês específico foi buscado. O cache só é
 * apagado no logout.
 */
(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────── */
  /* URL derivada de lifeos-config.js — o único arquivo que um fork edita.
     Ver LIFEOS.md §2 sobre a config ser a exceção à regra de isolamento. */
  var SUPABASE_FN = (window.LIFEOS_CONFIG ? window.LIFEOS_CONFIG.supabaseUrl : '')
    + '/functions/v1/lifeos-movimentacoes';
  var ANON_KEY = window.LIFEOS_CONFIG ? window.LIFEOS_CONFIG.anonKey : '';

  var LS_KEY = (window.LIFEOS_CONFIG && window.LIFEOS_CONFIG.sessionKey) || 'financas_master';     /* senha mestre (só com "lembrar") — mesma chave em lifeos.js/eventos.js */
  var CACHE_KEY = 'financas_cache';   /* cache persistente dos meses (JSON) */
  var CACHE_V = 2;                     /* bump invalida caches de schema antigo — v2: migração Notion -> lifeos_movimentacoes (ids mudam de page_id pra uuid; cache antigo tem dados da fonte anterior) */

  var MEIOS = ['Crédito', 'Débito', 'Pix', 'Vale', 'Boleto'];

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
    /* fetch inline: financas.js não tem helper de rede compartilhado — cada
       api* monta o seu. */
    return fetch(VOCAB_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw }),
    }).then(function (res) {
      if (!res.ok) return Promise.reject(new Error('http_' + res.status));
      return res.json();
    }).then(function (d) {
      var v = (d && d.vocabularios) || {};
      function lista(dom) { return (v[dom] || []).map(function (x) { return x.valor; }); }
      var m = lista('mov_meio');
      if (m.length) MEIOS = m;
    }).catch(function (e) {
      console.warn('[financas] vocabulários indisponíveis — usando o fallback embutido', e);
    });
  }

  var MEIO_COR = {
    'Crédito': '#c9a96e', 'Débito': '#5b8def', 'Pix': '#3fb98c',
    'Vale': '#b06ee0', 'Boleto': '#e58b5b',
  };
  var SEM_MEIO_COR = '#6b7280';
  var COR_ENTRADA = '#3fb98c';
  var COR_SAIDA = '#e5616a';
  var COR_SALDO = '#5b8def';

  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  /* Competência de crédito: a fatura fecha no ÚLTIMO dia do mês. Uma compra no
     mês M cai na fatura de M+1; uma compra feita NO último dia de M já entra no
     ciclo seguinte, indo para a fatura de M+2. ("fatura de X" = paga/vence em X.)
     Ex.: 20/06 -> fatura jul; 30/06 -> fatura ago; 01/07 -> fatura ago. */

  var MONO = "'JetBrains Mono', monospace";
  var TEXT_DIM = '#9aa3b2';
  var GRID_COR = 'rgba(255,255,255,0.06)';

  /* ── Estado ──────────────────────────────────────────────────── */
  var RANGE = null;        /* { min, max } 'YYYY-MM' do servidor */
  var MONTHS = [];         /* lista contínua navegável */
  var cursor = 0;
  var SESSION_PW = '';
  var monthCache = {};     /* ym -> movimentacoes (memória; hidratado do localStorage) */
  var aberturaCache = {};  /* ym -> saldo de abertura (vindo do servidor) */
  var fetchedCache = {};   /* ym -> fetched_at iso (quando AQUELE mês foi buscado) */
  var SALDO_ABERTURA = 0;  /* saldo de abertura do mês corrente (meses anteriores) */
  var MROWS = [];          /* transações do mês corrente */
  var LOADING = false;
  var charts = { donut: null, fluxo: null, saldo: null };

  var activeDir = new Set();     /* filtro da TABELA */
  var activeMeio = new Set();
  var activeRecDir = new Set();  /* filtro das RECORRÊNCIAS */
  var activeRecMeio = new Set();
  var donutMode = 'saida';       /* 'saida' | 'entrada' | 'ambos' — toggle do donut */
  var donutExcludeCredito = false; /* checkbox: desconsidera compras em Crédito no donut */
  var activeView = 'transacoes'; /* view exibida entre Transações/Recorrências (tabs) */
  var searchQuery = '';          /* busca por descrição — filtra as DUAS views */

  var donutLabels = [];
  var fluxoDays = [];

  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  /* ── Helpers ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function ymOf(d) { return d ? d.slice(0, 7) : null; }
  function has(m, tag) { return Array.isArray(m.tipo) && m.tipo.indexOf(tag) !== -1; }
  function isSaida(m) { return has(m, 'Saida'); }
  function isEntrada(m) { return has(m, 'Entrada'); }
  function hasAnyMeio(m) { return MEIOS.some(function (me) { return has(m, me); }); }
  /* Regime de caixa: compra no Crédito NÃO consome dinheiro no mês (vira fatura
     futura — ver projeção). Só conta como saída de caixa a Saida que não é
     crédito (inclui a linha "Fatura", que é o pagamento de caixa). */
  function isSaidaCaixa(m) { return isSaida(m) && !has(m, 'Crédito'); }
  /* Pagamento de fatura: Saida sem NENHUM meio (mesma "Sem meio" do donut) e
     descrição contendo "fatura". Usado para debitar a fatura que fecha agora
     (ver renderFaturaMesPassado) — o excedente vira adiantamento da projetada. */
  function isPagamentoFatura(m) { return isSaida(m) && !hasAnyMeio(m) && /fatura/i.test(m.name || ''); }
  /* Adiantamento EXPLÍCITO: pagamento de fatura cujo nome também contém
     "adiant" (ex.: "Adiantamento fatura setembro"). Diferente do excedente
     implícito (que só vira adiantamento quando a SOMA de todos os pagamentos
     do mês já superou o total da fatura corrente), este marca a intenção do
     pagamento mesmo que a fatura corrente ainda esteja em aberto — o valor
     não entra na conta de quitação da fatura que fecha agora, vai direto pra
     próxima. Cobre o caso de pagar a fatura atual PARCIALMENTE de propósito
     enquanto já adianta parte da seguinte (ex.: pagou 1.466,21 de uma fatura
     de 1.906,21 e mais 150 nomeado "adiantamento" pra próxima). */
  function isAdiantamentoExplicito(m) { return isPagamentoFatura(m) && /adiant/i.test(m.name || ''); }
  function vezes(n) { return n + (n === 1 ? ' pagamento' : ' pagamentos'); }
  /* Separa os pagamentos de fatura (em ordem cronológica) em quem quitou a
     fatura atual e quem já foi puro adiantamento: soma cumulativa contra o
     total. O pagamento que CRUZA a linha (uma parte quita o que falta, o
     resto sobra) é PARTIDO em duas entradas sintéticas — uma com o valor que
     falta (vai pra "atual") e outra com o excedente (vai pra "adiantamento"),
     mesma data/nome, `_partial: true`. Sem isso, um excedente embutido dentro
     de um pagamento que também quita o resto da fatura ficava invisível pra
     quem consome só a lista de adiantamento (ex.: carryInto) — aparecia como
     "tudo atual", mesmo já tendo sobra. Comparação em CENTAVOS (não float)
     pra não gerar uma entrada fantasma de R$0,00 quando o pagamento bate
     exatamente o total restante. */
  function splitPagamentosFatura(pagamentos, totalFatura) {
    var sorted = pagamentos.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var atual = [], adiantamento = [], cumC = 0;
    var totalC = Math.round(totalFatura * 100);
    sorted.forEach(function (m) {
      var valorC = Math.round(num(m.valor) * 100);
      var restanteC = totalC - cumC;
      if (restanteC <= 0) {
        adiantamento.push(m);
      } else if (valorC > restanteC) {
        atual.push(Object.assign({}, m, { valor: restanteC / 100 }));
        adiantamento.push(Object.assign({}, m, { valor: (valorC - restanteC) / 100, _partial: true }));
      } else {
        atual.push(m);
      }
      cumC += valorC;
    });
    return { atual: atual, adiantamento: adiantamento };
  }
  function currentYM() { return MONTHS[cursor]; }
  function monthLabel(ym) { var p = ym.split('-'); return MESES[(+p[1]) - 1] + ' ' + p[0]; }
  function normName(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function nextMonth(ym) { var p = ym.split('-'); var y = +p[0], m = +p[1]; return (m === 12) ? ((y + 1) + '-01') : (y + '-' + String(m + 1).padStart(2, '0')); }
  function prevMonth(ym) { var p = ym.split('-'); var y = +p[0], m = +p[1]; return (m === 1) ? ((y - 1) + '-12') : (y + '-' + String(m - 1).padStart(2, '0')); }
  /* dias por mês (jan..dez); fev resolvido por bissexto via cálculo */
  var DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function isBissexto(y) { return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0); }
  function lastDayOfMonth(ym) {
    var p = ym.split('-'); var y = +p[0], m = +p[1];
    return (m === 2 && isBissexto(y)) ? 29 : DIAS_NO_MES[m - 1];
  }
  /* fatura destino: antes do último dia -> M+1; no último dia -> M+2 */
  function faturaDestino(ym, dia) { var prox = nextMonth(ym); return (dia < lastDayOfMonth(ym)) ? prox : nextMonth(prox); }
  function todayYM() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  /* Uma movimentação com data futura (lançada mas o dinheiro ainda não está em
     caixa) conta nos totais de Entradas/Saídas do mês, mas NÃO no saldo — só
     passa a compor o saldo quando a data chegar. */
  function isRealizado(m) { return !m.date || m.date <= todayISO(); }
  function fmtDate(d) { if (!d) return '—'; var p = d.split('-'); return p[2] + '/' + p[1]; }
  function brlShort(v) { var a = Math.abs(v); if (a >= 1000) return 'R$' + (v / 1000).toFixed(1).replace('.', ',') + 'k'; return 'R$' + Math.round(v); }
  function tagClass(t) { return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''); }
  function enumerateMonths(minYM, maxYM) {
    var a = minYM.split('-'), b = maxYM.split('-');
    var y = +a[0], m = +a[1], y1 = +b[0], m1 = +b[1], out = [];
    while (y < y1 || (y === y1 && m <= m1)) { out.push(y + '-' + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }
  function summarize(rows) {
    var entradas = 0, saidas = 0, min = null, max = null;
    rows.forEach(function (m) {
      var v = num(m.valor);
      if (isEntrada(m)) entradas += v;
      if (isSaida(m)) saidas += v;
      if (m.date) { if (!min || m.date < min) min = m.date; if (!max || m.date > max) max = m.date; }
    });
    return { count: rows.length, entradas: entradas, saidas: saidas, liquido: entradas - saidas, minDate: min, maxDate: max };
  }

  /* ── Dev mock (ambiente local) ───────────────────────────────────
     A Edge Function restringe CORS a https://SEU-USUARIO.github.io (produção) —
     login real é inalcançável em localhost/127.0.0.1/file://. Nesses
     ambientes (só nesses — nunca no domínio de produção), a app pula o
     gate e entra direto com dados fictícios gerados em memória (nenhuma
     chamada de rede), só pra permitir testar/ajustar a UI sem depender do
     backend. Os quatro api* abaixo interceptam e respondem com esses
     dados; o resto do app (render, cache, modais) não sabe a diferença. */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function seededRandom(seed) {
    var s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function seedFromString(s) {
    var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) || 1;
  }
  function mockDelay(value) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, 220); });
  }

  /* Gera um mês plausível: salário, contas fixas, compras em crédito
     espalhadas (pra donut/fatura projetada terem conteúdo), recorrências
     ("Pai", "Delivery", "Mercado" repetidos) e um pagamento de "Fatura"
     sem meio (pro card de fatura do mês passado ter o que abater).
     Determinístico por mês (mesma semente = mesmos dados sempre). */
  function mockMonth(ym) {
    var rnd = seededRandom(seedFromString(ym));
    var days = lastDayOfMonth(ym);
    var i = 0, rows = [];
    function d(day) { return ym + '-' + String(Math.min(Math.max(day, 1), days)).padStart(2, '0'); }
    function push(name, valor, day, tipo) {
      rows.push({ id: 'mock-' + ym + '-' + (i++), name: name, valor: Math.round(valor * 100) / 100, date: d(day), tipo: tipo });
    }
    push('Salário', 4400, 5, ['Entrada', 'Pix']);
    push('Aluguel', 1650 + rnd() * 60, 6, ['Saida', 'Pix']);
    push('Internet', 89.99, 6, ['Saida', 'Pix']);
    push('Luz', 70 + rnd() * 30, 6, ['Saida', 'Pix']);
    push('Financiamento Carro', 637.62, 7, ['Saida', 'Boleto']);
    push('Fatura', 1200 + rnd() * 500, 10, ['Saida']);
    push('Claude', 118.4, 4, ['Saida', 'Crédito']);
    push('Reembolso', 12.5, 15, ['Entrada', 'Débito']);
    for (var c = 0; c < 6; c++) push('Delivery', 20 + rnd() * 60, 3 + c * 4, ['Saida', 'Crédito']);
    for (var pxi = 0; pxi < 5; pxi++) push('Pai', 25 + rnd() * 10, 2 + pxi * 5, ['Entrada', 'Pix']);
    for (var deb = 0; deb < 5; deb++) push('Mercado', 4 + rnd() * 40, 1 + deb * 5, ['Saida', 'Débito']);
    return rows;
  }

  function mockQuery(ym) {
    var t = todayYM();
    var min = prevMonth(prevMonth(prevMonth(t)));
    var max = nextMonth(t);
    var rndA = seededRandom(seedFromString(ym + '-abertura'));
    /* Fora do range mockado: linhas vazias, como a base real faria — sem
       isso, carryInto() (fatura do mês passado) recursaria pro infinito,
       já que todo mês mockado tem uma linha "Fatura" e nunca bateria no
       caso-base de "mês sem nenhum pagamento de fatura". */
    var movimentacoes = (ym >= min && ym <= max) ? mockMonth(ym) : [];
    return {
      ok: true, ym: ym, range: { min: min, max: max },
      saldo_abertura: Math.round((rndA() * 1200 - 100) * 100) / 100,
      count: movimentacoes.length, fetched_at: new Date().toISOString(),
      movimentacoes: movimentacoes,
    };
  }
  /* MROWS é a mesma referência usada pelo resto do app (ver storeMonth) —
     update/create/delete no mock leem/gravam direto nela, sem servidor. */
  function mockUpdate(id, patch) {
    var existing = null;
    for (var i = 0; i < MROWS.length; i++) { if (MROWS[i].id === id) { existing = MROWS[i]; break; } }
    return { ok: true, movimentacao: Object.assign({}, existing || { id: id }, patch) };
  }
  function mockCreate(movimentacao) {
    return { ok: true, movimentacao: Object.assign({ id: 'mock-new-' + Date.now() }, movimentacao) };
  }
  function mockDelete(id) { return { ok: true, id: id }; }

  /* ── Rede ────────────────────────────────────────────────────── */
  function apiFetch(pw, ym) {
    if (IS_LOCAL_DEV) return mockDelay(mockQuery(ym));
    return fetch(SUPABASE_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, ym: ym }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return res.text().catch(function () { return ''; }).then(function (d) { return Promise.reject({ code: 'server', detail: res.status + ' ' + d }); });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }

  /* Única chamada de ESCRITA da Edge Function. `patch` é parcial por design —
     só as chaves presentes são enviadas (ver openEditModal/onEditSubmit, que
     só inclui campos que o usuário de fato tocou). Mesmo contrato de erro de
     apiFetch (401 -> unauthorized). */
  function apiUpdate(pw, id, patch) {
    if (IS_LOCAL_DEV) return mockDelay(mockUpdate(id, patch));
    return fetch(SUPABASE_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'update', id: id, patch: patch }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return res.text().catch(function () { return ''; }).then(function (d) { return Promise.reject({ code: 'server', detail: res.status + ' ' + d }); });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }

  /* Cria uma movimentação nova. Todos os campos são obrigatórios (ao
     contrário do patch parcial de apiUpdate) — ver openCreateModal. */
  function apiCreate(pw, movimentacao) {
    if (IS_LOCAL_DEV) return mockDelay(mockCreate(movimentacao));
    return fetch(SUPABASE_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'create', movimentacao: movimentacao }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return res.text().catch(function () { return ''; }).then(function (d) { return Promise.reject({ code: 'server', detail: res.status + ' ' + d }); });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }

  /* Exclui uma movimentação existente. */
  function apiDelete(pw, id) {
    if (IS_LOCAL_DEV) return mockDelay(mockDelete(id));
    return fetch(SUPABASE_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'delete', id: id }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return res.text().catch(function () { return ''; }).then(function (d) { return Promise.reject({ code: 'server', detail: res.status + ' ' + d }); });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }

  /* ── Cache persistente (localStorage, JSON) ──────────────────────
     Cache por mês que sobrevive a reloads/dias. readCache valida schema/versão
     e devolve null em qualquer corrupção (cai pro fetch). writeCache regrava o
     objeto inteiro. resetCaches/dropStoredCache limpam (logout). */
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.v !== CACHE_V || !c.months) return null;
      return c;
    } catch (_e) { return null; }
  }
  function writeCache() {
    var months = {};
    Object.keys(monthCache).forEach(function (ym) {
      months[ym] = { rows: monthCache[ym], abertura: aberturaCache[ym] || 0, fetched_at: fetchedCache[ym] || null };
    });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ v: CACHE_V, range: RANGE, months: months })); }
    catch (_e) { /* quota/indisponível: cache segue só em memória nesta sessão */ }
  }
  function dropStoredCache() { try { localStorage.removeItem(CACHE_KEY); } catch (_e) {} }
  function resetCaches() { monthCache = {}; aberturaCache = {}; fetchedCache = {}; dropStoredCache(); }
  function hydrateFromCache() {
    var c = readCache();
    if (!c) return false;
    Object.keys(c.months).forEach(function (ym) {
      var m = c.months[ym] || {};
      monthCache[ym] = m.rows || [];
      aberturaCache[ym] = m.abertura || 0;
      fetchedCache[ym] = m.fetched_at || null;
    });
    if (c.range) RANGE = c.range;
    return true;
  }

  /* Grava o response de um mês nos caches (memória + localStorage), sem mexer
     no mês em exibição. */
  function cacheMonthData(j) {
    monthCache[j.ym] = j.movimentacoes;
    aberturaCache[j.ym] = j.saldo_abertura || 0;
    fetchedCache[j.ym] = j.fetched_at || new Date().toISOString();
    RANGE = j.range || RANGE;
    writeCache();
  }

  /* Grava o response de um mês em todos os caches e o deixa como mês corrente. */
  function storeMonth(j) {
    cacheMonthData(j);
    MROWS = j.movimentacoes;
    SALDO_ABERTURA = aberturaCache[j.ym];
  }

  /* Garante que um mês (não necessariamente o exibido) esteja em cache — usado
     pelo card "fatura do mês passado", que precisa ler o mês ANTERIOR ao
     exibido. Cache -> resolve na hora; senão busca (mesmo contrato da Edge
     Function) e cacheia. Nunca mexe em MROWS/SALDO_ABERTURA/cursor. */
  function ensureMonthRows(ym) {
    if (monthCache[ym]) return Promise.resolve(monthCache[ym]);
    return apiFetch(SESSION_PW, ym).then(function (j) {
      cacheMonthData(j);
      return monthCache[j.ym] || [];
    }).catch(function () { return null; });
  }

  /* Label "sincronizado": reflete quando o mês EXIBIDO foi buscado. */
  function updateFetchedLabel(ym) {
    var iso = fetchedCache[ym];
    if (!iso) { $('fetched-at').textContent = ''; return; }
    var d = new Date(iso);
    $('fetched-at').textContent = 'sincronizado ' + d.toLocaleString('pt-BR');
  }

  function enterApp() { if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar(); $('gate').hidden = true; $('gate-checking').hidden = true; $('app').hidden = false; }

  function rebuildMonths() {
    var t = todayYM(), min, max;
    if (RANGE && RANGE.min && RANGE.max) { min = RANGE.min; max = RANGE.max; } else { min = t; max = t; }
    if (t > max) max = t;
    if (t < min) min = t;
    MONTHS = enumerateMonths(min, max);
  }

  /* Primeira carga: autentica + entra no app. Reaproveita o cache persistido
     (meses de sessões anteriores) e grava o mês recém-buscado por cima. */
  function authAndLoad(pw, ym) {
    /* Vocabulário antes dos dados: o seletor de meio de pagamento e o
       donut por meio dependem dele. */
    return carregarVocab(pw).then(function () {
      return apiFetch(pw, ym);
    }).then(function (j) {
      SESSION_PW = pw;
      hydrateFromCache();
      storeMonth(j);
      clearAllFilters();
      enterApp();
      afterLoad(j.ym);
    });
  }

  /* Carga de um mês (já autenticado): cache -> imediato; senão fetch. */
  function loadMonth(ym) {
    if (monthCache[ym]) { MROWS = monthCache[ym]; SALDO_ABERTURA = aberturaCache[ym] || 0; afterLoad(ym); return Promise.resolve(); }
    setLoading(true);
    return apiFetch(SESSION_PW, ym).then(function (j) {
      storeMonth(j);
      afterLoad(j.ym);
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') onLogout();
      else { $('month-label').textContent = 'erro ao carregar'; }
    }).then(function () { setLoading(false); });
  }

  function afterLoad(ym) {
    rebuildMonths();
    cursor = MONTHS.indexOf(ym); if (cursor < 0) cursor = MONTHS.length - 1;
    render();
  }

  function goMonth(delta) {
    if (LOADING) return;
    var n = cursor + delta;
    if (n < 0 || n > MONTHS.length - 1) return;
    clearAllFilters();
    loadMonth(MONTHS[n]);
  }

  function clearAllFilters() {
    activeDir.clear(); activeMeio.clear(); activeRecDir.clear(); activeRecMeio.clear();
    searchQuery = '';
    var si = $('search-input'); if (si) si.value = '';
    var sc = $('search-clear'); if (sc) sc.hidden = true;
  }

  function setLoading(on) {
    LOADING = on;
    $('loading').hidden = !on;
    $('refresh-btn').disabled = on;
    $('refresh-btn').classList.toggle('spinning', on);
    $('prev-month').disabled = on || (cursor <= 0);
    $('next-month').disabled = on || (cursor >= MONTHS.length - 1);
  }

  /* Saídas mostram TUDO que saiu (inclui crédito — o dinheiro saiu de fato).
     O Saldo é o saldo de caixa da conta no fim do mês: abertura (o que sobrou
     dos meses anteriores) + entradas − saídas de caixa (crédito não entra, vira
     fatura; a "Fatura", Saida sem crédito, consome). É o último ponto do gráfico
     de saldo acumulado. NÃO bate com Entradas − Saídas(exibido) — é esperado.
     Movimentações com data futura entram nos KPIs de Entradas/Saídas (já são
     um compromisso conhecido), mas ficam de fora do Saldo até a data chegar. */
  function computeMonthKpis(rows, abertura) {
    var entradas = 0, saidasTotais = 0, entradasRealizadas = 0, saidasCaixaRealizadas = 0;
    rows.forEach(function (m) {
      var v = num(m.valor), realizado = isRealizado(m);
      if (isEntrada(m)) { entradas += v; if (realizado) entradasRealizadas += v; }
      if (isSaida(m)) saidasTotais += v;
      if (isSaidaCaixa(m) && realizado) saidasCaixaRealizadas += v;
    });
    var ab = abertura || 0;
    var variacaoMes = entradasRealizadas - saidasCaixaRealizadas;
    return { entradas: entradas, saidasTotais: saidasTotais, saidasCaixa: saidasCaixaRealizadas, abertura: ab, variacaoMes: variacaoMes, saldo: ab + variacaoMes };
  }

  /* ── Render principal ────────────────────────────────────────── */
  function render() {
    var ym = currentYM();
    $('month-label').textContent = monthLabel(ym);
    updateFetchedLabel(ym);
    $('prev-month').disabled = LOADING || (cursor <= 0);
    $('next-month').disabled = LOADING || (cursor >= MONTHS.length - 1);

    var k = computeMonthKpis(MROWS, SALDO_ABERTURA);
    $('kpi-entradas').textContent = brl.format(k.entradas);
    /* KPI principal = saída real de caixa (o que de fato abate o saldo); o total
       com crédito (compras que só viram fatura futura) some abaixo, menor. */
    $('kpi-saidas').textContent = brl.format(k.saidasCaixa);
    var saidasCreditoEl = $('kpi-saidas-credito');
    if (round2(k.saidasTotais) > round2(k.saidasCaixa)) {
      saidasCreditoEl.hidden = false;
      $('kpi-saidas-credito-val').textContent = brl.format(k.saidasTotais);
    } else {
      saidasCreditoEl.hidden = true;
    }
    $('kpi-saldo').textContent = brl.format(k.saldo);
    $('kpi-saldo').className = 'kpi-value ' + (k.saldo >= 0 ? 'pos' : 'neg');
    /* Abertura e variação só aparecem quando têm algo a explicar: sem saldo
       carregado do mês anterior, os dois colapsam no mesmo número já exibido
       em cima (entradas vs. entradas; saldo vs. variação), aí não acrescentam. */
    var entAberturaEl = $('kpi-entradas-abertura'), saldoVarEl = $('kpi-saldo-variacao');
    if (round2(k.abertura) !== 0) {
      entAberturaEl.hidden = false;
      $('kpi-entradas-abertura-val').textContent = brl.format(k.abertura);
      saldoVarEl.hidden = false;
      $('kpi-saldo-variacao-val').textContent = brl.format(k.variacaoMes);
    } else {
      entAberturaEl.hidden = true;
      saldoVarEl.hidden = true;
    }
    $('count-note').textContent = MROWS.length + (MROWS.length === 1 ? ' transação' : ' transações');

    if (MROWS.length === 0) {
      $('empty-state').textContent = 'Sem movimentações em ' + monthLabel(ym).toLowerCase() + '.';
      $('empty-state').hidden = false;
      $('dash-content').hidden = true;
      $('export-btn').hidden = true;
      destroyCharts();
      return;
    }
    $('empty-state').hidden = true;
    $('dash-content').hidden = false;
    $('export-btn').hidden = false;

    renderDonutForMode(donutMode);
    renderFluxo(MROWS);
    renderSaldo(MROWS);
    renderFaturaMesPassado();
    renderFaturaProjetada();
    renderRecorrencias();
    renderTableSection();
  }

  /* ── Charts ──────────────────────────────────────────────────── */
  function baseTooltip(extra) {
    return Object.assign({
      backgroundColor: '#1b1f27', borderColor: '#262b34', borderWidth: 1,
      titleColor: '#e7e9ee', bodyColor: '#e7e9ee',
      titleFont: { family: MONO, size: 11 }, bodyFont: { family: MONO, size: 12 }, padding: 10,
    }, extra || {});
  }
  function legendCfg() { return { position: 'bottom', labels: { color: TEXT_DIM, font: { family: MONO, size: 11 }, padding: 12, boxWidth: 12, usePointStyle: true } }; }
  function moneyScales() {
    return {
      x: { grid: { color: GRID_COR, drawBorder: false }, ticks: { color: TEXT_DIM, font: { family: MONO, size: 10 } } },
      y: { grid: { color: GRID_COR, drawBorder: false }, ticks: { color: TEXT_DIM, font: { family: MONO, size: 10 }, callback: function (v) { return brlShort(v); } } },
    };
  }
  function pointerHover(evt, els, chart) { chart.canvas.style.cursor = els.length ? 'pointer' : 'default'; }

  /* Agrupa MROWS por meio de pagamento conforme o modo do toggle: só saídas
     (comportamento original), só entradas, ou ambos (atividade total do canal,
     nas duas direções, valores absolutos somados). */
  function computeDonutBuckets(mode, excludeCredito) {
    var porMeio = {}; MEIOS.forEach(function (x) { porMeio[x] = 0; });
    var semMeio = 0;
    MROWS.forEach(function (m) {
      var incluir = mode === 'ambos' ? (isEntrada(m) || isSaida(m)) : (mode === 'entrada' ? isEntrada(m) : isSaida(m));
      if (!incluir) return;
      if (excludeCredito && has(m, 'Crédito')) return;
      var v = num(m.valor), achou = false;
      MEIOS.forEach(function (me) { if (has(m, me)) { porMeio[me] += v; achou = true; } });
      if (!achou) semMeio += v;
    });
    return { porMeio: porMeio, semMeio: semMeio };
  }

  function renderDonutForMode(mode) {
    var buckets = computeDonutBuckets(mode, donutExcludeCredito);
    renderDonut(buckets.porMeio, buckets.semMeio, mode);
  }

  function renderDonut(porMeio, semMeio, mode) {
    donutLabels = []; var data = [], cores = [];
    MEIOS.forEach(function (me) { if (porMeio[me] > 0) { donutLabels.push(me); data.push(round2(porMeio[me])); cores.push(MEIO_COR[me]); } });
    if (semMeio > 0) { donutLabels.push('Sem meio'); data.push(round2(semMeio)); cores.push(SEM_MEIO_COR); }

    if (charts.donut) { charts.donut.destroy(); charts.donut = null; }
    var hasData = data.length > 0;
    $('donut-empty').hidden = hasData;
    var emptyMsg = mode === 'entrada' ? 'sem entradas neste mês' : (mode === 'ambos' ? 'sem movimentações neste mês' : 'sem saídas neste mês');
    if (!hasData && donutExcludeCredito) emptyMsg = 'só há Crédito neste mês (desconsiderado)';
    $('donut-empty').textContent = emptyMsg;
    $('chart-donut').style.display = hasData ? '' : 'none';
    if (!hasData) return;

    charts.donut = new Chart($('chart-donut'), {
      type: 'doughnut',
      data: { labels: donutLabels, datasets: [{ data: data, backgroundColor: cores, borderColor: '#14171d', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, cutout: '58%',
        onHover: pointerHover,
        onClick: function (e, els) { if (els.length) openMeioModal(donutLabels[els[0].index], mode); },
        plugins: {
          legend: legendCfg(),
          tooltip: baseTooltip({
            callbacks: {
              label: function (c) {
                var total = c.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                var pct = total ? Math.round(c.parsed / total * 100) : 0;
                return ' ' + c.label + ': ' + brl.format(c.parsed) + ' (' + pct + '%)';
              },
              footer: function () { return 'toque para ver as transações'; },
            },
          }),
        },
      },
    });
  }

  function renderFluxo(rows) {
    var map = {};
    rows.forEach(function (m) {
      var d = m.date; if (!map[d]) map[d] = { in: 0, out: 0 };
      var v = num(m.valor);
      if (isEntrada(m)) map[d].in += v;
      if (isSaida(m)) map[d].out += v;
    });
    fluxoDays = Object.keys(map).sort();
    var labels = fluxoDays.map(function (d) { return d.slice(8, 10); });
    var ins = fluxoDays.map(function (d) { return round2(map[d].in); });
    var outs = fluxoDays.map(function (d) { return round2(map[d].out); });

    if (charts.fluxo) { charts.fluxo.destroy(); charts.fluxo = null; }
    charts.fluxo = new Chart($('chart-fluxo'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Entradas', data: ins, backgroundColor: COR_ENTRADA, borderRadius: 3, maxBarThickness: 22 },
          { label: 'Saídas', data: outs, backgroundColor: COR_SAIDA, borderRadius: 3, maxBarThickness: 22 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
        /* intersect:false + mode:'index' faz o hover/click valerem pra coluna
           inteira do dia (qualquer altura), não só em cima da barra em si —
           dias com movimentação pequena viram um alvo minúsculo do jeito default. */
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        onHover: pointerHover,
        onClick: function (e, els) { if (els.length) openDiaModal(fluxoDays[els[0].index]); },
        scales: moneyScales(),
        plugins: {
          legend: legendCfg(),
          tooltip: baseTooltip({
            callbacks: {
              label: function (c) { return ' ' + c.dataset.label + ': ' + brl.format(c.parsed.y); },
              footer: function () { return 'toque para ver o dia'; },
            },
          }),
        },
      },
    });
  }

  function renderSaldo(rows) {
    /* Saldo acumulado é caixa: exclui compras no Crédito (igual aos KPIs).
       Começa do SALDO_ABERTURA (o que sobrou/faltou dos meses anteriores), não
       do zero — assim o "0 → 4128" do dia do salário parte do saldo real. */
    var abertura = SALDO_ABERTURA || 0;
    var noteEl = $('saldo-abertura-note');
    if (abertura !== 0) {
      noteEl.hidden = false;
      noteEl.textContent = 'Saldo de abertura (meses anteriores): ' + brl.format(abertura);
    } else {
      noteEl.hidden = true;
    }

    var map = {};
    rows.forEach(function (m) {
      if (!isRealizado(m)) return; /* data futura: ainda não é caixa real */
      var d = m.date, v = num(m.valor), delta = 0;
      if (isEntrada(m)) delta += v;
      if (isSaidaCaixa(m)) delta -= v;
      map[d] = (map[d] || 0) + delta;
    });
    var days = Object.keys(map).sort();
    var acc = abertura, labels = [], data = [];
    if (abertura !== 0) { labels.push('início'); data.push(round2(abertura)); }
    days.forEach(function (d) { acc += map[d]; labels.push(d.slice(8, 10)); data.push(round2(acc)); });

    if (charts.saldo) { charts.saldo.destroy(); charts.saldo = null; }
    charts.saldo = new Chart($('chart-saldo'), {
      type: 'line',
      data: { labels: labels, datasets: [{ label: 'Saldo acumulado', data: data, borderColor: COR_SALDO, backgroundColor: 'rgba(91,141,239,0.12)', fill: true, tension: 0.25, pointRadius: 3, pointBackgroundColor: COR_SALDO, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
        scales: moneyScales(),
        plugins: {
          legend: { display: false },
          tooltip: baseTooltip({ callbacks: { title: function (c) { return 'dia ' + c[0].label; }, label: function (c) { return ' saldo: ' + brl.format(c.parsed.y); } } }),
        },
      },
    });
  }

  function destroyCharts() { ['donut', 'fluxo', 'saldo'].forEach(function (k) { if (charts[k]) { charts[k].destroy(); charts[k] = null; } }); }

  /* ── Fatura projetada (competência de crédito) ───────────────── */
  /* Projeção de leitura: agrupa as compras em Crédito de um mês-fonte por ciclo
     de fatura (ver faturaDestino). NÃO mexe no saldo de caixa nem reclassifica
     nada. Reaproveitada tanto para o mês exibido (fatura projetada dos PRÓXIMOS
     meses) quanto para o mês anterior (fatura que fecha AGORA — ver abaixo). */
  function calcularProjecaoFatura(rows, ym) {
    var groups = {};
    rows.forEach(function (m) {
      if (!isSaida(m)) return;
      if (!has(m, 'Crédito')) return;
      if (/fatura/i.test(m.name || '')) return; /* pagamento da fatura, não compra nova */
      var d = m.date ? parseInt(m.date.slice(8, 10), 10) : 0;
      var destino = faturaDestino(ym, d);
      if (!groups[destino]) groups[destino] = { total: 0, rows: [] };
      groups[destino].total += num(m.valor);
      groups[destino].rows.push(m);
    });
    return groups;
  }

  function renderFaturaProjetada() {
    var host = $('fatura-projetada'); host.innerHTML = '';
    var ym = currentYM();
    var proj = calcularProjecaoFatura(MROWS, ym);
    var destinos = Object.keys(proj).sort();

    if (!destinos.length) {
      var empty = document.createElement('div'); empty.className = 'rec-meta';
      empty.textContent = 'Nenhuma compra em crédito neste mês.';
      host.appendChild(empty);
      return;
    }

    var hint = document.createElement('div'); hint.className = 'fatura-hint';
    hint.textContent = 'Estimativa pela data da compra (fatura fecha no último dia do mês) — não afeta o saldo de caixa.';
    host.appendChild(hint);

    destinos.forEach(function (dest) { host.appendChild(faturaGroupNode(dest, proj[dest])); });
  }

  function faturaGroupNode(dest, g, opts) {
    opts = opts || {};
    var wrap = document.createElement('div'); wrap.className = 'rec-group' + (opts.collapsed ? ' collapsed' : '');
    var head = document.createElement('div'); head.className = 'rec-head clickable';

    var left = document.createElement('div'); left.className = 'rec-head-left';
    var chev = document.createElement('i'); chev.className = 'rec-chev fad fa-chevron-down'; left.appendChild(chev);
    var nm = document.createElement('span'); nm.className = 'rec-name'; nm.textContent = 'Fatura de ' + monthLabel(dest); left.appendChild(nm);
    var cnt = document.createElement('span'); cnt.className = 'rec-count'; cnt.textContent = g.rows.length + (g.rows.length === 1 ? ' compra' : ' compras'); left.appendChild(cnt);

    var right = document.createElement('div'); right.className = 'rec-head-right';
    var tot = document.createElement('span'); tot.className = 'rec-total fatura-total'; tot.textContent = brl.format(g.total); right.appendChild(tot);

    head.appendChild(left); head.appendChild(right); wrap.appendChild(head);

    var body = document.createElement('div'); body.className = 'rec-items';
    g.rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (m) {
      var it = document.createElement('div'); it.className = 'rec-item';
      var d = document.createElement('span'); d.className = 'rec-item-date'; d.textContent = fmtDate(m.date);
      var nmi = document.createElement('span'); nmi.className = 'fatura-item-name'; nmi.textContent = m.name || '—';
      var v = document.createElement('span'); v.className = 'rec-item-val fatura-total'; v.textContent = brl.format(num(m.valor));
      it.appendChild(d); it.appendChild(nmi); it.appendChild(v);
      body.appendChild(it);
    });
    wrap.appendChild(body);
    head.addEventListener('click', function () { wrap.classList.toggle('collapsed'); });
    return wrap;
  }

  /* Status de quitação da fatura que fecha agora: soma dos pagamentos com tag
     "Fatura" feitos no mês exibido contra o total da fatura. O que exceder o
     total quitado vira adiantamento — ver renderFaturaAdiantamentoNote. */
  function faturaStatusNode(totalFatura, pago, count) {
    if (!(pago > 0)) return null;
    var el = document.createElement('div'); el.className = 'fatura-status';
    var pagoNaAtual = round2(Math.min(pago, totalFatura));
    var restante = round2(Math.max(0, totalFatura - pago));
    if (restante <= 0) {
      el.classList.add('fatura-status-ok');
      el.textContent = 'Quitada ✓ · ' + vezes(count) + ' · ' + brl.format(pagoNaAtual) + (pago > totalFatura ? ' (excedente vira adiantamento)' : '');
    } else {
      el.textContent = 'Pago em ' + vezes(count) + ' · ' + brl.format(pagoNaAtual) + ' · restante ' + brl.format(restante);
    }
    return el;
  }

  /* Anota o excedente pago na fatura que fecha agora como adiantamento na
     fatura projetada mais próxima (primeiro grupo de #fatura-projetada, já
     que os destinos vêm ordenados ascendente) — junto com em quantos
     pagamentos isso aconteceu e o valor que falta pra essa fatura projetada
     depois de abatido o adiantamento. Sem grupo nenhum (nenhuma compra em
     crédito ainda), a nota entra solta no card e não há "valor atual" a mostrar. */
  function renderFaturaAdiantamentoNote(valor, count) {
    var host = $('fatura-projetada');
    var solta = host.querySelector(':scope > .fatura-adiantado-note');
    if (solta) solta.remove();
    var firstGroup = host.querySelector('.rec-group');
    if (firstGroup) {
      var existing = firstGroup.querySelector('.fatura-adiantado-note');
      if (existing) existing.remove();
    }
    if (!(valor > 0)) return;

    var texto = 'Adiantado em ' + vezes(count) + ': ' + brl.format(valor);
    if (firstGroup) {
      var proj = calcularProjecaoFatura(MROWS, currentYM());
      var destinos = Object.keys(proj).sort();
      var totalProjetado = destinos.length ? proj[destinos[0]].total : 0;
      var valorAtual = round2(Math.max(0, totalProjetado - valor));
      texto += ' · valor atual da fatura: ' + brl.format(valorAtual);
    }
    var note = document.createElement('div'); note.className = 'fatura-adiantado-note'; note.textContent = texto;
    if (firstGroup) firstGroup.insertBefore(note, firstGroup.querySelector('.rec-items'));
    else host.appendChild(note);
  }

  /* Excedente que carrega da fatura que fecha EM `m` pra fatura seguinte
     (nextMonth(m)): pagamentos de "fatura" feitos dentro de `m` (mais
     qualquer excedente que já tenha carregado ATÉ `m`, vindo de antes) que
     superam o total da fatura própria de `m`. RECURSIVO — pra saber quanto
     sobrou de `m`, precisa saber quanto já tinha sobrado até `m`
     (carryInto(prevMonth(m))), não só o que foi pago dentro de `m`. Sem a
     recursão, uma cadeia de 3+ meses de pagamento parcial (sobra de A pra B
     pequena demais sozinha, mas que somada ao que sobra de B pra C finalmente
     ultrapassa a fatura de C) escondia o adiantamento ao navegar direto até
     o mês de destino final — só aparecia se o usuário passasse pelo mês do
     meio primeiro. Base da recursão: mês sem nenhum pagamento de "fatura"
     (nada a carregar) ou fora do range (ensureMonthRows resolve null).
     Adiantamentos explícitos (isAdiantamentoExplicito) de `m` sempre saem
     junto, mesmo sem sobra matemática. ensureMonthRows já cacheia por mês —
     a recursão não repete fetch de rede pro mesmo mês. */
  function carryInto(m) {
    var pm = prevMonth(m);
    return ensureMonthRows(m).then(function (rows) {
      if (!rows) return [];
      var pagamentosFatura = rows.filter(isPagamentoFatura);
      if (!pagamentosFatura.length) return [];
      var explicitos = pagamentosFatura.filter(isAdiantamentoExplicito);
      var normais = pagamentosFatura.filter(function (x) { return !isAdiantamentoExplicito(x); });
      if (!normais.length) return explicitos;
      return Promise.all([ensureMonthRows(pm), carryInto(pm)]).then(function (res) {
        var pmRows = res[0], carriedIntoM = res[1];
        var totalFaturaM = 0;
        if (pmRows) {
          var proj = calcularProjecaoFatura(pmRows, pm);
          var g = proj[m];
          totalFaturaM = (g && g.rows.length) ? g.total : 0;
        }
        var efetivos = normais.concat(carriedIntoM);
        var split = splitPagamentosFatura(efetivos, totalFaturaM);
        return split.adiantamento.concat(explicitos);
      });
    });
  }

  /* ── Fatura do mês passado (fecha agora) ─────────────────────────
     As compras em Crédito feitas no mês ANTERIOR ao exibido, que caem na
     fatura do mês exibido — ou seja, a fatura que está fechando/sendo paga
     agora. Precisa dos dados do mês anterior, que o fetch do mês exibido não
     traz (a Edge Function busca só um mês por vez); busca/cacheia esse mês à
     parte via ensureMonthRows, sem alterar o mês em exibição. Card começa
     fechado — só o total aparece até o usuário expandir. */
  function renderFaturaMesPassado() {
    var ym = currentYM();
    var pYm = prevMonth(ym);
    var host = $('fatura-mes-passado'); host.innerHTML = '';
    var loading = document.createElement('div'); loading.className = 'rec-meta';
    loading.textContent = 'Carregando ' + monthLabel(pYm).toLowerCase() + '…';
    host.appendChild(loading);

    /* Pagamentos com tag "Fatura" feitos no mês EXIBIDO (é quando o dinheiro
       sai), não no mês-fonte da compra — por isso lê MROWS, não `rows`. Os
       marcados como adiantamento explícito (isAdiantamentoExplicito) saem
       desse grupo — não entram na conta de quitação da fatura que fecha
       agora, viram excedente reservado pra fatura seguinte de qualquer jeito. */
    var pagamentosFaturaAtual = MROWS.filter(isPagamentoFatura);
    var explicitosAtual = pagamentosFaturaAtual.filter(isAdiantamentoExplicito);
    var normaisAtual = pagamentosFaturaAtual.filter(function (m) { return !isAdiantamentoExplicito(m); });

    /* O que carrega de pYm pra ym é exatamente carryInto(pYm) — já resolve a
       cadeia inteira pra trás (ver carryInto). */
    Promise.all([ensureMonthRows(pYm), carryInto(pYm)]).then(function (res) {
      var rows = res[0], advancedFromPYm = res[1];
      if (currentYM() !== ym) return; /* usuário já trocou de mês antes de resolver */
      host.innerHTML = '';
      if (!rows) {
        var err = document.createElement('div'); err.className = 'rec-meta';
        err.textContent = 'Não foi possível carregar ' + monthLabel(pYm).toLowerCase() + '.';
        host.appendChild(err);
        renderFaturaAdiantamentoNote(0, 0);
        return;
      }
      var proj = calcularProjecaoFatura(rows, pYm);
      var g = proj[ym];
      var totalFatura = (g && g.rows.length) ? g.total : 0;
      var pagamentosFatura = normaisAtual.concat(advancedFromPYm);
      var pago = pagamentosFatura.reduce(function (sum, m) { return sum + num(m.valor); }, 0);
      var split = splitPagamentosFatura(pagamentosFatura, totalFatura);
      /* O que carrega desta fatura (ym) pra próxima é o mesmo split acima —
         o adiantamento embutido num pagamento que também quita o resto (ver
         splitPagamentosFatura) já vem separado, mais os explícitos de ym. */
      var carryOut = split.adiantamento.concat(explicitosAtual);
      var excedente = round2(carryOut.reduce(function (sum, m) { return sum + num(m.valor); }, 0));
      var countAdiantamento = carryOut.length;

      if (!g || !g.rows.length) {
        var empty = document.createElement('div'); empty.className = 'rec-meta';
        empty.textContent = 'Nenhuma compra em crédito de ' + monthLabel(pYm).toLowerCase() + ' cai na fatura deste mês.';
        host.appendChild(empty);
      } else {
        var hint = document.createElement('div'); hint.className = 'fatura-hint';
        hint.textContent = 'Projetada em ' + monthLabel(pYm) + ' — compras em crédito daquele mês que fecham na fatura de agora, paga este mês.';
        host.appendChild(hint);
        var statusNode = faturaStatusNode(totalFatura, pago, split.atual.length);
        if (statusNode) host.appendChild(statusNode);
        host.appendChild(faturaGroupNode(ym, g, { collapsed: true }));
      }
      renderFaturaAdiantamentoNote(excedente, countAdiantamento);
    });
  }

  /* ── Filtro genérico (badges) ────────────────────────────────── */
  function passesWith(m, dirSet, meioSet) {
    var dirOk = !dirSet.size || (dirSet.has('Entrada') && isEntrada(m)) || (dirSet.has('Saida') && isSaida(m));
    var meioOk = true;
    if (meioSet.size) {
      meioOk = false;
      meioSet.forEach(function (mv) {
        if (mv === '__sem__') { if (!hasAnyMeio(m)) meioOk = true; }
        else if (has(m, mv)) meioOk = true;
      });
    }
    return dirOk && meioOk;
  }

  /* Busca por descrição: filtra as DUAS views (Transações e Recorrências) por
     cima dos badges de direção/meio — não entra em buildBadges (os chips
     continuam refletindo os valores disponíveis no mês inteiro, não no
     subconjunto já filtrado pela busca). */
  function matchesSearch(m) {
    if (!searchQuery) return true;
    return normName(m.name).indexOf(searchQuery) !== -1;
  }

  function buildBadges(hostId, rows, dirSet, meioSet, onChange) {
    var host = $(hostId); host.innerHTML = '';
    var dirs = { Entrada: false, Saida: false }, meios = {}, sem = false;
    rows.forEach(function (m) {
      if (isEntrada(m)) dirs.Entrada = true;
      if (isSaida(m)) dirs.Saida = true;
      var any = false;
      MEIOS.forEach(function (me) { if (has(m, me)) { meios[me] = true; any = true; } });
      if ((isEntrada(m) || isSaida(m)) && !any) sem = true;
    });

    var lbl = document.createElement('span'); lbl.className = 'filters-label'; lbl.textContent = 'filtrar:'; host.appendChild(lbl);

    function chip(label, set, val) {
      var b = document.createElement('button');
      b.className = 'chip' + (set.has(val) ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', function () {
        if (set.has(val)) set.delete(val); else set.add(val);
        buildBadges(hostId, rows, dirSet, meioSet, onChange);
        onChange();
      });
      return b;
    }

    if (dirs.Entrada) host.appendChild(chip('Entradas', dirSet, 'Entrada'));
    if (dirs.Saida) host.appendChild(chip('Saídas', dirSet, 'Saida'));
    MEIOS.forEach(function (me) { if (meios[me]) host.appendChild(chip(me, meioSet, me)); });
    if (sem) host.appendChild(chip('Sem meio', meioSet, '__sem__'));

    if (dirSet.size || meioSet.size) {
      var c = document.createElement('button'); c.className = 'chip chip-clear'; c.innerHTML = 'limpar <i class="fad fa-times"></i>';
      c.addEventListener('click', function () { dirSet.clear(); meioSet.clear(); buildBadges(hostId, rows, dirSet, meioSet, onChange); onChange(); });
      host.appendChild(c);
    }
  }

  function renderAnalysis(hostId, filtered, dirSet, meioSet) {
    var el = $(hostId);
    if (!(dirSet.size || meioSet.size)) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false; el.innerHTML = '';
    var s = summarize(filtered);
    function span(cls, txt) { var x = document.createElement('span'); x.className = cls; x.textContent = txt; return x; }
    el.appendChild(span('an-key', 'filtro'));
    el.appendChild(span('an-val', s.count + (s.count === 1 ? ' transação' : ' transações')));
    if (s.entradas > 0) el.appendChild(span('an-val pos', 'entradas ' + brl.format(s.entradas)));
    if (s.saidas > 0) el.appendChild(span('an-val neg', 'saídas ' + brl.format(s.saidas)));
    el.appendChild(span('an-val', 'líquido ' + brl.format(s.liquido)));
    var period = s.count ? (fmtDate(s.minDate) + (s.minDate !== s.maxDate ? ' – ' + fmtDate(s.maxDate) : '')) : '—';
    el.appendChild(span('an-val', period));
  }

  /* ── Tabela ──────────────────────────────────────────────────── */
  function renderTableSection() {
    buildBadges('filters', MROWS, activeDir, activeMeio, applyTableFilter);
    applyTableFilter();
  }
  function applyTableFilter() {
    var filtered = MROWS.filter(function (m) { return passesWith(m, activeDir, activeMeio) && matchesSearch(m); });
    fillTbody($('tx-tbody'), filtered, true);
    renderAnalysis('analysis', filtered, activeDir, activeMeio);
  }

  function txRow(m) {
    var tr = document.createElement('tr');
    var td1 = document.createElement('td'); td1.className = 'td-date'; td1.textContent = fmtDate(m.date);
    var td2 = document.createElement('td'); td2.className = 'td-name'; td2.textContent = m.name || '—';
    var td3 = document.createElement('td'); td3.className = 'td-tipo';
    (m.tipo || []).forEach(function (t) { var s = document.createElement('span'); s.className = 'tag tag-' + tagClass(t); s.textContent = t; td3.appendChild(s); });
    var td4 = document.createElement('td');
    var dir = isSaida(m) ? 'neg' : (isEntrada(m) ? 'pos' : '');
    var sign = isSaida(m) ? '− ' : (isEntrada(m) ? '+ ' : '');
    td4.className = 'td-valor ' + dir;
    /* Wrapper interno (não o <td>) carrega o display:flex — ver comentário
       de .td-valor-wrap no CSS. */
    var wrap = document.createElement('span'); wrap.className = 'td-valor-wrap';
    var valNum = document.createElement('span'); valNum.className = 'td-valor-num';
    valNum.appendChild(document.createTextNode(sign + brl.format(num(m.valor))));
    wrap.appendChild(valNum);
    /* Ações da linha (editar/excluir): só em desktop, reveladas no hover da
       linha (ver .row-actions no CSS) — no mobile os botões nem existem,
       ausência intencional, não só visual (hover não existe em touch). */
    if (m.id) {
      var actions = document.createElement('span'); actions.className = 'row-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'row-action-btn'; editBtn.setAttribute('data-action', 'edit'); editBtn.setAttribute('data-id', m.id);
      editBtn.setAttribute('aria-label', 'Editar movimentação');
      editBtn.innerHTML = '<i class="fad fa-pencil"></i>';
      var delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'row-action-btn row-action-danger'; delBtn.setAttribute('data-action', 'delete'); delBtn.setAttribute('data-id', m.id);
      delBtn.setAttribute('aria-label', 'Excluir movimentação');
      delBtn.innerHTML = '<i class="fad fa-trash"></i>';
      actions.appendChild(editBtn); actions.appendChild(delBtn);
      wrap.appendChild(actions);
    }
    td4.appendChild(wrap);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
    return tr;
  }
  /* Header do grupo do dia: data à esquerda, entradas/saídas/diferença do dia
     na mesma linha (reaproveita summarize(), já usado no resto do dashboard). */
  function txDateHeaderRow(d, dayRows) {
    var tr = document.createElement('tr'); tr.className = 'tx-date-header';
    var td = document.createElement('td'); td.colSpan = 4;
    var wrap = document.createElement('div'); wrap.className = 'tx-date-header-row';
    var dt = document.createElement('span'); dt.className = 'tx-date-header-date'; dt.textContent = fmtDate(d);
    wrap.appendChild(dt);

    var s = summarize(dayRows);
    var sums = document.createElement('span'); sums.className = 'tx-date-header-sums';
    function val(cls, txt) { var sp = document.createElement('span'); sp.className = 'tx-date-header-val ' + cls; sp.textContent = txt; return sp; }
    if (s.entradas > 0) sums.appendChild(val('pos', '+ ' + brl.format(s.entradas)));
    if (s.saidas > 0) sums.appendChild(val('neg', '− ' + brl.format(s.saidas)));
    sums.appendChild(val(s.liquido >= 0 ? 'pos' : 'neg', (s.liquido >= 0 ? '+ ' : '− ') + brl.format(Math.abs(s.liquido))));
    wrap.appendChild(sums);

    td.appendChild(wrap); tr.appendChild(td);
    return tr;
  }
  function fillTbody(tbody, rows, groupByDate) {
    tbody.innerHTML = '';
    var sorted = rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (!sorted.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td'); td.colSpan = 4; td.className = 'tx-empty'; td.textContent = 'nenhuma transação com esse filtro';
      tr.appendChild(td); tbody.appendChild(tr); return;
    }
    if (!groupByDate) { sorted.forEach(function (m) { tbody.appendChild(txRow(m)); }); return; }
    var groups = [];
    sorted.forEach(function (m) {
      var last = groups[groups.length - 1];
      if (!last || last.date !== m.date) { last = { date: m.date, rows: [] }; groups.push(last); }
      last.rows.push(m);
    });
    groups.forEach(function (g) {
      tbody.appendChild(txDateHeaderRow(g.date, g.rows));
      g.rows.forEach(function (m) { tbody.appendChild(txRow(m)); });
    });
  }

  /* ── Recorrências (com filtro próprio) ───────────────────────── */
  function renderRecorrencias() {
    buildBadges('rec-filters', MROWS, activeRecDir, activeRecMeio, renderRecList);
    renderRecList();
  }

  function renderRecList() {
    var rows = MROWS.filter(function (m) { return passesWith(m, activeRecDir, activeRecMeio) && matchesSearch(m); });
    var groups = {};
    rows.forEach(function (m) {
      var key = normName(m.name) || '—';
      if (!groups[key]) groups[key] = { name: m.name || '—', items: [] };
      groups[key].items.push(m);
    });
    var arr = Object.keys(groups).map(function (k) {
      var g = groups[k], s = summarize(g.items);
      g.count = g.items.length; g.entradas = s.entradas; g.saidas = s.saidas; g.liquido = s.liquido;
      return g;
    });
    arr.sort(function (a, b) { return (b.count - a.count) || (Math.abs(b.liquido) - Math.abs(a.liquido)); });

    var host = $('recorrencias'); host.innerHTML = '';
    var multi = arr.filter(function (g) { return g.count > 1; }).length;
    var uni = arr.length - multi;
    var meta = document.createElement('div'); meta.className = 'rec-meta';
    if (arr.length === 0) meta.textContent = 'nenhuma transação com esse filtro';
    else meta.textContent = arr.length + ' descrições · ' + multi + ' recorrentes · ' + uni + (uni === 1 ? ' única' : ' únicas');
    host.appendChild(meta);
    arr.forEach(function (g) { host.appendChild(recGroupNode(g)); });
  }

  function recGroupNode(g) {
    var multi = g.count > 1;
    var wrap = document.createElement('div'); wrap.className = 'rec-group' + (multi ? ' rec-multi' : '');
    var head = document.createElement('div'); head.className = 'rec-head' + (multi ? ' clickable' : '');

    var left = document.createElement('div'); left.className = 'rec-head-left';
    if (multi) { var chev = document.createElement('i'); chev.className = 'rec-chev fad fa-chevron-down'; left.appendChild(chev); }
    var nm = document.createElement('span'); nm.className = 'rec-name'; nm.textContent = g.name;
    var cnt = document.createElement('span'); cnt.className = 'rec-count'; cnt.textContent = g.count + '×';
    left.appendChild(nm); left.appendChild(cnt);

    var nE = g.items.filter(isEntrada).length, nS = g.items.filter(isSaida).length;
    var parts = [];
    if (nS > 0) parts.push(nS + ' saída' + (nS > 1 ? 's' : ''));
    if (nE > 0) parts.push(nE + ' entrada' + (nE > 1 ? 's' : ''));
    if (parts.length) { var bd = document.createElement('span'); bd.className = 'rec-breakdown'; bd.textContent = parts.join(' · '); left.appendChild(bd); }

    var right = document.createElement('div'); right.className = 'rec-head-right';
    if (!multi) { var dt = document.createElement('span'); dt.className = 'rec-date'; dt.textContent = fmtDate(g.items[0].date); right.appendChild(dt); }
    var tot = document.createElement('span'); tot.className = 'rec-total ' + (g.liquido >= 0 ? 'pos' : 'neg');
    tot.textContent = (g.liquido >= 0 ? '+ ' : '− ') + brl.format(Math.abs(g.liquido));
    right.appendChild(tot);

    head.appendChild(left); head.appendChild(right);
    wrap.appendChild(head);

    if (multi) {
      var body = document.createElement('div'); body.className = 'rec-items';
      g.items.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (m) {
        var it = document.createElement('div'); it.className = 'rec-item';
        var d = document.createElement('span'); d.className = 'rec-item-date'; d.textContent = fmtDate(m.date);
        var tg = document.createElement('span'); tg.className = 'rec-item-tags';
        (m.tipo || []).forEach(function (t) { var sp = document.createElement('span'); sp.className = 'tag tag-' + tagClass(t); sp.textContent = t; tg.appendChild(sp); });
        var v = document.createElement('span');
        var dir = isSaida(m) ? 'neg' : (isEntrada(m) ? 'pos' : '');
        var sign = isSaida(m) ? '− ' : (isEntrada(m) ? '+ ' : '');
        v.className = 'rec-item-val ' + dir; v.textContent = sign + brl.format(num(m.valor));
        it.appendChild(d); it.appendChild(tg); it.appendChild(v);
        body.appendChild(it);
      });
      wrap.appendChild(body);
      head.addEventListener('click', function () { wrap.classList.toggle('collapsed'); });
    }
    return wrap;
  }

  /* ── Modal ───────────────────────────────────────────────────── */
  function openMeioModal(label, mode) {
    var dirOk = mode === 'entrada' ? isEntrada : (mode === 'ambos' ? function () { return true; } : isSaida);
    var rows;
    if (label === 'Sem meio') rows = MROWS.filter(function (m) { return (isEntrada(m) || isSaida(m)) && !hasAnyMeio(m) && dirOk(m); });
    else rows = MROWS.filter(function (m) { return has(m, label) && dirOk(m); });
    openTxModal('Meio · ' + label, monthLabel(currentYM()), rows);
  }
  function openDiaModal(dd) { openTxModal('Dia ' + fmtDate(dd), monthLabel(currentYM()), MROWS.filter(function (m) { return m.date === dd; })); }

  function openTxModal(title, subtitle, rows) {
    $('modal-title').textContent = title;
    $('modal-sub').textContent = subtitle || '';
    var body = $('modal-body'); body.innerHTML = '';

    var wrap = document.createElement('div'); wrap.className = 'table-wrap';
    var table = document.createElement('table'); table.className = 'tx';
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Data</th><th>Descrição</th><th>Tipo</th><th class="r">Valor</th></tr>';
    var tbody = document.createElement('tbody'); fillTbody(tbody, rows);
    table.appendChild(thead); table.appendChild(tbody); wrap.appendChild(table); body.appendChild(wrap);

    var s = summarize(rows);
    var foot = document.createElement('div'); foot.className = 'modal-summary';
    function span(cls, txt) { var x = document.createElement('span'); x.className = cls; x.textContent = txt; return x; }
    foot.appendChild(span('an-val', s.count + (s.count === 1 ? ' transação' : ' transações')));
    if (s.entradas > 0) foot.appendChild(span('an-val pos', 'entradas ' + brl.format(s.entradas)));
    if (s.saidas > 0) foot.appendChild(span('an-val neg', 'saídas ' + brl.format(s.saidas)));
    foot.appendChild(span('an-val', 'líquido ' + brl.format(s.liquido)));
    body.appendChild(foot);

    $('modal').classList.add('open');
  }
  function closeModal() { $('modal').classList.remove('open'); }

  /* Modal de ajuda: conteúdo estático (não depende de MROWS), fica todo em
     financas.html — só abre/fecha aqui. */
  function openHelpModal() { $('help-modal').classList.add('open'); }
  function closeHelpModal() { $('help-modal').classList.remove('open'); }

  /* ── Modal de edição (lápis · valor/data/tags) ───────────────────
     Só existe em desktop (CSS esconde o lápis abaixo de 720px). Tudo
     opcional por design: EDIT_DIRTY rastreia só os campos que o usuário de
     fato tocou (não os que diferem do valor original) — assim reabrir o
     modal e mandar salvar sem mexer em nada não reescreve tags por engano
     (ex.: uma movimentação com mais de um meio, que o formulário colapsa
     num único <select>, não seria "diferente" do original por acidente). */
  var EDIT_ID = null;
  var EDIT_DIRTY = { date: false, valor: false, tipo: false };

  function openEditModal(id) {
    var m = null;
    for (var i = 0; i < MROWS.length; i++) { if (MROWS[i].id === id) { m = MROWS[i]; break; } }
    if (!m) return;
    if ($('modal').classList.contains('open')) closeModal(); /* evita dois modais sobrepostos */
    EDIT_ID = id;
    EDIT_DIRTY = { date: false, valor: false, tipo: false };
    $('edit-modal-sub').textContent = m.name || '—';
    $('edit-date').value = m.date || '';
    $('edit-valor').value = num(m.valor).toFixed(2);
    $('edit-direcao').value = isSaida(m) ? 'Saida' : 'Entrada';
    var meioAtual = MEIOS.filter(function (me) { return has(m, me); })[0] || '';
    $('edit-meio').value = meioAtual;
    $('edit-error').textContent = '';
    setEditSaving(false);
    $('edit-modal').classList.add('open');
  }
  function closeEditModal() { $('edit-modal').classList.remove('open'); EDIT_ID = null; }
  function setEditSaving(on) { $('edit-save').disabled = on; $('edit-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  /* Aplica o retorno normalizado da Edge Function na linha em memória — MROWS
     é a MESMA referência de array que monthCache[ym] (ver storeMonth), então
     mutar aqui já reflete no cache; só falta persistir em localStorage. */
  function applyUpdatedRow(updated) {
    if (!updated || !updated.id) return;
    for (var i = 0; i < MROWS.length; i++) {
      if (MROWS[i].id === updated.id) { MROWS[i] = updated; break; }
    }
    writeCache();
    render();
  }

  /* Remove a linha excluída de MROWS (mesma referência de monthCache[ym] —
     ver storeMonth), persiste e re-renderiza. Mesmo padrão de applyUpdatedRow. */
  function applyDeletedRow(id) {
    for (var i = 0; i < MROWS.length; i++) {
      if (MROWS[i].id === id) { MROWS.splice(i, 1); break; }
    }
    writeCache();
    render();
  }

  /* Excluir (🗑, hover-only): confirmação inline de dois cliques em vez de
     modal ou confirm() nativo — o primeiro clique vira "confirmar?" por
     ~3s; um segundo clique dentro da janela executa o delete. Clicar em
     qualquer outro lugar, ou deixar o tempo passar, reverte sem excluir. */
  var DELETE_PENDING = null; /* { key, btn, timeoutId } | null */

  function resetDeletePending() {
    if (!DELETE_PENDING) return;
    clearTimeout(DELETE_PENDING.timeoutId);
    var btn = DELETE_PENDING.btn;
    if (btn && document.body.contains(btn)) {
      btn.classList.remove('confirming');
      btn.disabled = false;
      btn.innerHTML = '<i class="fad fa-trash"></i>';
    }
    DELETE_PENDING = null;
  }

  /* `key` distingue linhas diferentes pra não confundir estado. `run()` deve
     devolver uma Promise (a chamada de delete real); `onDone()` roda no
     sucesso (atualizar o array em memória + re-renderizar). */
  function confirmDelete(btn, key, run, onDone) {
    if (DELETE_PENDING && DELETE_PENDING.key === key && DELETE_PENDING.btn === btn) {
      /* segundo clique dentro da janela: confirma e executa */
      clearTimeout(DELETE_PENDING.timeoutId);
      DELETE_PENDING = null;
      btn.disabled = true;
      btn.innerHTML = '<i class="fad fa-spinner-third fa-spin"></i>';
      run().then(function () {
        onDone();
      }).catch(function (err) {
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.innerHTML = '<i class="fad fa-trash"></i>';
        if (err && err.code === 'unauthorized') { onLogout(); return; }
        window.alert('erro ao excluir — ' + ((err && err.detail) || 'tente de novo'));
      });
      return;
    }
    resetDeletePending();
    btn.classList.add('confirming');
    btn.textContent = 'confirmar?';
    DELETE_PENDING = {
      key: key, btn: btn,
      timeoutId: setTimeout(resetDeletePending, 3000),
    };
  }

  function onDeleteClick(btn, id) {
    confirmDelete(btn, 'mov:' + id, function () { return apiDelete(SESSION_PW, id); }, function () { applyDeletedRow(id); });
  }

  function onEditSubmit(e) {
    e.preventDefault();
    if (!EDIT_ID) return;
    var patch = {};
    if (EDIT_DIRTY.date) {
      var d = $('edit-date').value;
      if (!d) { $('edit-error').textContent = 'data inválida'; return; }
      patch.date = d;
    }
    if (EDIT_DIRTY.valor) {
      var v = parseFloat($('edit-valor').value);
      if (!isFinite(v) || v < 0) { $('edit-error').textContent = 'valor inválido'; return; }
      patch.valor = round2(v);
    }
    if (EDIT_DIRTY.tipo) {
      var meioVal = $('edit-meio').value;
      patch.tipo = meioVal ? [$('edit-direcao').value, meioVal] : [$('edit-direcao').value];
    }
    if (!Object.keys(patch).length) { closeEditModal(); return; }

    setEditSaving(true);
    $('edit-error').textContent = '';
    apiUpdate(SESSION_PW, EDIT_ID, patch).then(function (j) {
      applyUpdatedRow(j.movimentacao);
      closeEditModal();
    }).catch(function (err) {
      setEditSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('edit-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* ── Modal de criação (nova movimentação) ─────────────────────────
     Botão + na topbar. Diferente do modal de edição, todo campo é
     OBRIGATÓRIO aqui (ver apiCreate). Ao salvar: se a data cai no mês
     exibido, insere direto em MROWS e re-renderiza sem re-fetch; se cai em
     outro mês, só invalida o cache daquele mês (se cacheado) — ele é
     buscado de novo quando o usuário navegar até lá. */
  function openCreateModal() {
    if ($('modal').classList.contains('open')) closeModal();
    if ($('edit-modal').classList.contains('open')) closeEditModal();
    $('create-date').value = todayISO();
    $('create-valor').value = '';
    $('create-nome').value = '';
    $('create-direcao').value = 'Saida';
    $('create-meio').value = '';
    $('create-error').textContent = '';
    setCreateSaving(false);
    $('create-modal').classList.add('open');
    var ni = $('create-nome'); if (ni) ni.focus();
  }
  function closeCreateModal() { $('create-modal').classList.remove('open'); }
  function setCreateSaving(on) { $('create-save').disabled = on; $('create-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  function onCreateSubmit(e) {
    e.preventDefault();
    var nome = $('create-nome').value.trim();
    var d = $('create-date').value;
    var v = parseFloat($('create-valor').value);
    var direcao = $('create-direcao').value;
    var meioVal = $('create-meio').value;
    if (!nome) { $('create-error').textContent = 'descrição obrigatória'; return; }
    if (!d) { $('create-error').textContent = 'data inválida'; return; }
    if (!isFinite(v) || v < 0) { $('create-error').textContent = 'valor inválido'; return; }

    var movimentacao = { name: nome, valor: round2(v), date: d, tipo: meioVal ? [direcao, meioVal] : [direcao] };
    setCreateSaving(true);
    $('create-error').textContent = '';
    apiCreate(SESSION_PW, movimentacao).then(function (j) {
      var created = j.movimentacao;
      closeCreateModal();
      var createdYm = ymOf(created.date);
      if (createdYm === currentYM()) {
        MROWS.push(created);
        writeCache();
        render();
      } else {
        delete monthCache[createdYm]; delete aberturaCache[createdYm]; delete fetchedCache[createdYm];
        writeCache();
      }
    }).catch(function (err) {
      setCreateSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('create-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* ── Export CSV (mês corrente) ───────────────────────────────── */
  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n\r;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function buildCsv() {
    var headers = ['data', 'descricao', 'valor', 'direcao', 'meio', 'tipo_raw', 'valor_liquido', 'id'];
    var lines = [headers.join(',')];
    var sorted = MROWS.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    sorted.forEach(function (m) {
      var v = num(m.valor);
      var dir = isSaida(m) ? 'Saida' : (isEntrada(m) ? 'Entrada' : '');
      var meios = MEIOS.filter(function (me) { return has(m, me); });
      var meio = meios.length ? meios.join(';') : ((isSaida(m) || isEntrada(m)) ? 'Sem meio' : '');
      var liquido = 0; if (isEntrada(m)) liquido += v; if (isSaida(m)) liquido -= v;
      var row = [m.date || '', m.name || '', v.toFixed(2), dir, meio, (m.tipo || []).join(';'), liquido.toFixed(2), m.id || ''];
      lines.push(row.map(csvCell).join(','));
    });
    return '﻿' + lines.join('\r\n'); /* BOM UTF-8 + CRLF (Excel-friendly) */
  }

  function downloadCsv(csv, filename) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCsv() {
    if (!MROWS.length) return;
    var ym = currentYM();
    var csv = buildCsv();
    var filename = 'movimentacoes-' + ym + '.csv';
    /* iPhone & cia: share sheet nativo — manda o arquivo pra outro app SEM baixar.
       Precisa de File + canShare({ files }); onde não houver (desktop), baixa. */
    try {
      if (navigator.canShare) {
        var file = new File([csv], filename, { type: 'text/csv' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: filename, text: 'Movimentações · ' + monthLabel(ym) })
            .catch(function () {}); /* cancelar o share sheet rejeita — silencioso */
          return;
        }
      }
    } catch (_e) { /* cai pro download */ }
    downloadCsv(csv, filename);
  }

  /* ── Gate UI ─────────────────────────────────────────────────── */
  function setGateLoading(on) { $('gate-btn').disabled = on; $('gate-btn').textContent = on ? '…' : '→'; }
  function shake() { var f = $('gate-row'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
  function showGateForm() { $('gate').hidden = false; $('gate-checking').hidden = true; $('gate-form').hidden = false; $('app').hidden = true; var i = $('gate-input'); if (i) i.focus(); }

  function onSubmit(e) {
    e.preventDefault();
    var pw = $('gate-input').value.trim();
    if (!pw) return;
    setGateLoading(true);
    $('gate-error').textContent = '';
    authAndLoad(pw, todayYM()).then(function () {
      setGateLoading(false);
      if ($('gate-remember').checked) localStorage.setItem(LS_KEY, pw); else localStorage.removeItem(LS_KEY);
    }).catch(function (err) {
      setGateLoading(false);
      if (err && err.code === 'unauthorized') { shake(); $('gate-error').textContent = 'senha incorreta'; $('gate-input').value = ''; $('gate-input').focus(); }
      else $('gate-error').textContent = 'erro ao carregar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* ↻ : invalida SÓ o mês na tela e re-busca; os demais meses cacheados ficam. */
  function onRefresh() {
    if (!SESSION_PW || LOADING) return;
    var ym = currentYM();
    delete monthCache[ym]; delete aberturaCache[ym]; delete fetchedCache[ym];
    writeCache();
    loadMonth(ym);
  }

  function resetDonutToggle() {
    donutMode = 'saida';
    var btns = document.querySelectorAll('.donut-toggle-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === 'saida');
    donutExcludeCredito = false;
    $('donut-exclude-credito').checked = false;
  }

  /* Tabs Transações/Recorrências (e futuras views): só alterna visibilidade,
     o conteúdo de ambas já é recalculado a cada render() independente da view
     ativa — trocar de aba é instantâneo, sem recomputar nada. */
  function switchView(id) {
    activeView = id;
    var tabs = document.querySelectorAll('.view-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === id);
    var panels = document.querySelectorAll('.view-panel');
    for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute('data-view-panel') !== id;
  }
  function resetViewTabs() { switchView('transacoes'); }

  function onLogout() {
    localStorage.removeItem(LS_KEY);
    resetCaches();
    SESSION_PW = ''; SALDO_ABERTURA = 0; MROWS = []; destroyCharts(); clearAllFilters(); resetDonutToggle(); resetViewTabs(); closeModal(); closeHelpModal(); closeEditModal(); closeCreateModal(); resetDeletePending();
    setLoading(false); setGateLoading(false);
    $('export-btn').hidden = true;
    $('fetched-at').textContent = '';
    $('gate-input').value = ''; $('gate-remember').checked = false; $('gate-error').textContent = '';
    showGateForm();
  }

  /* ── Boot ────────────────────────────────────────────────────── */
  /* Badge fixo avisando que a sessão é mock (ver IS_LOCAL_DEV) — sem isso,
     dados fictícios em tela poderiam ser confundidos com dados reais. */
  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · dados fictícios';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;' +
      'background:#c4913a;color:#14120f;font-family:' + MONO + ';font-size:11px;' +
      'letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;';
    document.body.appendChild(b);
  }

  function boot() {
    if (IS_LOCAL_DEV) {
      /* CORS da Edge Function restringe a produção — login real é
         inalcançável aqui. Entra direto com dados fictícios (ver mockQuery)
         pra permitir testar/ajustar a UI sem depender do backend. */
      showDevBadge();
      authAndLoad('local-dev', todayYM()).catch(function (err) {
        $('gate-checking').hidden = true;
        $('gate-error').textContent = 'mock local falhou — ' + ((err && err.detail) || 'ver console');
        showGateForm();
      });
      return;
    }
    var saved = localStorage.getItem(LS_KEY);
    if (!saved) { showGateForm(); return; }
    SESSION_PW = saved;
    $('gate-remember').checked = true;

    var ym = todayYM();
    if (hydrateFromCache() && monthCache[ym]) {
      /* Cache quente pro mês atual: entra direto, sem rede. O ↻ rebusca. */
      enterApp();
      clearAllFilters();
      MROWS = monthCache[ym]; SALDO_ABERTURA = aberturaCache[ym] || 0;
      afterLoad(ym);
      return;
    }
    /* Sem cache pro mês atual: valida a sessão e busca. */
    $('gate').hidden = false; $('gate-form').hidden = true; $('gate-checking').hidden = false;
    authAndLoad(saved, ym).catch(function (err) {
      localStorage.removeItem(LS_KEY); $('gate-checking').hidden = true; showGateForm();
      if (err && err.code === 'unauthorized') $('gate-error').textContent = 'sessão expirada — entre novamente';
    });
  }

  function init() {
    if (window.Chart) { Chart.defaults.font.family = MONO; Chart.defaults.color = TEXT_DIM; }
    $('gate-form').addEventListener('submit', onSubmit);
    $('prev-month').addEventListener('click', function () { goMonth(-1); });
    $('next-month').addEventListener('click', function () { goMonth(1); });
    $('refresh-btn').addEventListener('click', onRefresh);
    $('logout-btn').addEventListener('click', onLogout);
    $('export-btn').addEventListener('click', exportCsv);
    $('modal-close').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    $('help-btn').addEventListener('click', openHelpModal);
    $('help-modal-close').addEventListener('click', closeHelpModal);
    $('help-modal').addEventListener('click', function (e) { if (e.target === $('help-modal')) closeHelpModal(); });
    $('edit-form').addEventListener('submit', onEditSubmit);
    $('edit-cancel').addEventListener('click', closeEditModal);
    $('edit-modal-close').addEventListener('click', closeEditModal);
    $('edit-modal').addEventListener('click', function (e) { if (e.target === $('edit-modal')) closeEditModal(); });
    $('edit-date').addEventListener('input', function () { EDIT_DIRTY.date = true; });
    $('edit-valor').addEventListener('input', function () { EDIT_DIRTY.valor = true; });
    $('edit-direcao').addEventListener('change', function () { EDIT_DIRTY.tipo = true; });
    $('edit-meio').addEventListener('change', function () { EDIT_DIRTY.tipo = true; });
    $('create-btn').addEventListener('click', openCreateModal);
    $('create-form').addEventListener('submit', onCreateSubmit);
    $('create-cancel').addEventListener('click', closeCreateModal);
    $('create-modal-close').addEventListener('click', closeCreateModal);
    $('create-modal').addEventListener('click', function (e) { if (e.target === $('create-modal')) closeCreateModal(); });
    /* Delegação: os botões de ação vivem em toda linha da tabela (regenerada
       a cada render), então o listener fica num ancestral estável em vez de
       por-linha. Clicar em qualquer coisa que NÃO seja o botão de excluir
       em estado "confirmar?" cancela essa confirmação pendente. */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.row-action-btn') : null;
      if (!btn) { resetDeletePending(); return; }
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');
      if (action === 'edit') { resetDeletePending(); openEditModal(id); return; }
      if (action === 'delete') { onDeleteClick(btn, id); return; }
    });
    var donutBtns = document.querySelectorAll('.donut-toggle-btn');
    for (var di = 0; di < donutBtns.length; di++) {
      donutBtns[di].addEventListener('click', function (e) {
        var btn = e.currentTarget;
        if (btn.classList.contains('active')) return;
        donutMode = btn.getAttribute('data-mode');
        var btns = document.querySelectorAll('.donut-toggle-btn');
        for (var bi = 0; bi < btns.length; bi++) btns[bi].classList.toggle('active', btns[bi] === btn);
        renderDonutForMode(donutMode);
      });
    }
    $('donut-exclude-credito').addEventListener('change', function (e) {
      donutExcludeCredito = e.target.checked;
      renderDonutForMode(donutMode);
    });
    var viewTabs = document.querySelectorAll('.view-tab');
    for (var vi = 0; vi < viewTabs.length; vi++) {
      viewTabs[vi].addEventListener('click', function (e) { switchView(e.currentTarget.getAttribute('data-view')); });
    }
    $('search-input').addEventListener('input', function (e) {
      searchQuery = normName(e.target.value);
      $('search-clear').hidden = !searchQuery;
      applyTableFilter();
      renderRecList();
    });
    $('search-clear').addEventListener('click', function () {
      $('search-input').value = '';
      searchQuery = '';
      $('search-clear').hidden = true;
      applyTableFilter();
      renderRecList();
      $('search-input').focus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('create-modal').classList.contains('open')) { closeCreateModal(); return; }
      if (e.key === 'Escape' && $('edit-modal').classList.contains('open')) { closeEditModal(); return; }
      if (e.key === 'Escape' && $('modal').classList.contains('open')) { closeModal(); return; }
      if (e.key === 'Escape' && $('help-modal').classList.contains('open')) { closeHelpModal(); return; }
      if ($('app').hidden || $('modal').classList.contains('open') || $('help-modal').classList.contains('open') || $('edit-modal').classList.contains('open') || $('create-modal').classList.contains('open')) return;
      if (e.key === 'ArrowLeft') goMonth(-1);
      if (e.key === 'ArrowRight') goMonth(1);
    });
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
