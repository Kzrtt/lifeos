/**
 * lifeos.js — LifeOS · hub LifeOS (/lifeos)
 *
 * JS cru, sem framework, sem build. Consumido por lifeos.html. Módulo
 * ISOLADO — não importa nem é importado por financas.js/eventos.js.
 *
 * Finanças continua só leitura aqui: um resumo raso, com "Abrir" levando
 * pra tela de verdade (financas.html). Eventos é diferente — o autor decidiu
 * que o calendário não precisa de uma tela própria (`eventos.html` fica
 * dormente, sem link nenhum apontando pra ela); o CRUD inteiro (criar/
 * excluir) mora aqui, dentro do card de Calendário e do modal de detalhes
 * do dia. Isso é uma exceção deliberada ao "hub é só leitura" — ver
 * LIFEOS.md §1/§4.
 *
 * Só compartilha com os outros dois módulos: a senha mestre (mesmo backend)
 * e a chave 'financas_master' no localStorage (de propósito — "lembrar"
 * numa página do LifeOS vale nas outras).
 */
(function () {
  'use strict';

  /* ── Config ────────────────────────────────────────────────────
     Vem de `assets/js/lifeos-config.js` (window.LIFEOS_CONFIG), carregado
     por <script> antes deste arquivo. Ele é DADO declarativo, não código
     compartilhado — a regra de isolamento da LIFEOS.md §2 continua valendo
     (cada página monta as suas próprias constantes locais a partir dele,
     como abaixo; nenhuma página expõe helper ali pra outra consumir).

     Se a config não carregar, é erro de instalação e não vale seguir com
     URLs inválidas até estourar num 404 obscuro lá na frente. */
  var CFG = window.LIFEOS_CONFIG;
  if (!CFG) throw new Error('lifeos-config.js não carregou — confira a tag <script> em lifeos.html');

  var FN_BASE = CFG.supabaseUrl + '/functions/v1/';
  var MOVS_FN = FN_BASE + 'lifeos-movimentacoes';
  var EVENTOS_FN = FN_BASE + 'lifeos-eventos';
  var PROJETOS_FN = FN_BASE + 'lifeos-projetos';
  var TAREFAS_FN = FN_BASE + 'lifeos-tarefas';
  var MANIFESTACOES_FN = FN_BASE + 'lifeos-manifestacoes';
  var NOTAS_FN = FN_BASE + 'lifeos-notas';
  var ANON_KEY = CFG.anonKey;
  var LS_KEY = CFG.sessionKey; /* mesma chave de /financas e /eventos — "lembrar" vale nas três */

  var EVENTO_COR = {
    faculdade: '#5b8def', trabalho: '#c4913a', lazer: '#3fb98c',
    vida: '#e58b5b', psicodelia: '#b06ee0',
  };
  var TIPOS = ['faculdade', 'trabalho', 'lazer', 'vida', 'psicodelia'];
  /* Vocabulário de tipo de TAREFA (não confundir com TIPOS acima, que é de
     evento) — cópia isolada de TIPOS_TAREFA em tarefas.js, ver LIFEOS.md §2. */
  var TIPOS_TAREFA = ['Vida', 'Organização', 'Documentação', 'Estudo', 'Avaliação', 'Código', 'Freelance', 'Trabalho', 'Tarefa'];
  /* Vocabulário de tipo de NOTA (12 valores — cópia isolada de TIPOS_NOTA em
     notas.js, ver LIFEOS.md §2/NOTAS.md §5) + paleta de cor pro gráfico de
     barras do resumo (#not-chart-tipo) — Chart.js não lê var(--x), por
     isso hex literal, mesma técnica de TIPO_COR em tarefas.js. */
  var TIPOS_NOTA = [
    'Lembranças', 'Análise de Leitura', 'Pensamentos', 'Conclusões', 'Úteis',
    'Faculdade', 'Vida', 'Pesquisa', 'Programação', 'Pessoal', 'Relato', 'Documentação',
  ];
  var NOT_TIPO_COR_PALETTE = [
    '#c4913a', '#5b8def', '#3fb98c', '#e5616a', '#b06ee0', '#e58b5b',
    '#4fc3d9', '#d4a5e8', '#8a9b6e', '#e0c15c', '#6e9de0', '#c47a9a',
  ];
  var NOT_TIPO_COR = {};
  TIPOS_NOTA.forEach(function (t, i) { NOT_TIPO_COR[t] = NOT_TIPO_COR_PALETTE[i % NOT_TIPO_COR_PALETTE.length]; });
  /* Status das Tarefas — mesmo vocabulário de 3 colunas do kanban real
     (`STATUS_TAREFA` em tarefas.js, cópia isolada ver LIFEOS.md §2). Usado
     tanto pela visão geral estatística quanto pelo toggle Eventos/Tarefas
     do calendário do hub. */
  var TAR_STATUS = ['Não Iniciado', 'Em Andamento', 'Feito'];
  var TAR_STATUS_COR = { 'Não Iniciado': 'var(--mute)', 'Em Andamento': 'var(--gold)', 'Feito': 'var(--green)' };

  /* O status "concluído" é o ÚLTIMO do vocabulário, não a string 'Feito' —
     os valores são editáveis na tela de Tags e renomear quebraria qualquer
     comparação literal. Tudo que pergunta "esta tarefa está pronta?" passa
     por aqui. */
  function statusConcluido(lista) { return lista[lista.length - 1]; }
  /* Vocabulário de PROJETO (diferente do de tarefa acima) — CRUD completo
     movido de tarefas.js pra cá em set/2026 (ver LIFEOS.md), cópia isolada
     de STATUS_PROJETO/TAGS_PROJETO que existia lá. */
  var STATUS_PROJETO = ['Não Iniciado', 'Em Progresso', 'Feito', 'Pausado'];
  var TAGS_PROJETO = ['Pessoal', 'Profissional', 'Acadêmico', 'Configuração'];
  var PROJETO_STATUS_COR = { 'Não Iniciado': 'var(--mute)', 'Em Progresso': 'var(--gold)', 'Feito': 'var(--green)', 'Pausado': 'var(--blue)' };
  /* Vocabulário de MANIFESTAÇÃO (migrado do Notion, ver notion-manifestacoes-
     migrate) — status é o mesmo texto de TAR_STATUS (3 valores, sem
     "Pausado"), tags é vocabulário próprio, nada a ver com TAGS_PROJETO. */
  var STATUS_MANIFESTACAO = ['Não Iniciado', 'Em Progresso', 'Feito'];
  var TAGS_MANIFESTACAO = ['Vida', 'Financeiro', 'Carreira', 'Saúde', 'Lazer'];
  var COR_ENTRADA = '#3fb98c', COR_SAIDA = '#e5616a', COR_SALDO = '#5b8def';
  var PROJ_STATUS_FILTRO = 'Em Progresso';  /* movido pro topo: carregarVocab valida este valor */
  var MEIOS = ['Crédito', 'Débito', 'Pix', 'Vale', 'Boleto'];

  /* ── Vocabulários dinâmicos ──────────────────────────────────────────
   * As listas acima são FALLBACK, não a fonte de verdade. Desde a migration
   * 0002 elas vivem em `lifeos_vocabularios` e são editáveis em
   * LifeOS → menu → Tags; `carregarVocab` as substitui no boot.
   *
   * Se a chamada falhar, o fallback continua valendo e a página funciona
   * com o vocabulário embutido — degradar para "sem tags" seria pior que
   * degradar para "tags de ontem".
   *
   * Cópia isolada: `tarefas.js`, `notas.js` e `financas.js` têm a sua
   * própria versão disto (LIFEOS.md §2 — repetido por cópia).
   */
  var VOCAB_FN = FN_BASE + 'lifeos-vocabularios';

  function carregarVocab(pw) {
    if (IS_LOCAL_DEV) return Promise.resolve();
    /* fetch inline, como todas as api* deste arquivo — lifeos.js não tem um
       helper compartilhado de rede. */
    return fetch(VOCAB_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw }),
    }).then(function (res) {
      if (!res.ok) return Promise.reject(new Error('http_' + res.status));
      return res.json();
    }).then(function (d) {
      var v = (d && d.vocabularios) || {};
      function lista(dom) {
        return (v[dom] || []).map(function (x) { return x.valor; });
      }
      function aplicar(dom, alvo) {
        var l = lista(dom);
        /* lista vazia = domínio sem valores cadastrados; manter o fallback
           é melhor que deixar um seletor vazio */
        return l.length ? l : alvo;
      }

      TIPOS              = aplicar('evento_tipo', TIPOS);
      TIPOS_TAREFA       = aplicar('tarefa_tipo', TIPOS_TAREFA);
      TIPOS_NOTA         = aplicar('nota_tipo', TIPOS_NOTA);
      TAR_STATUS         = aplicar('tarefa_status', TAR_STATUS);
      STATUS_PROJETO     = aplicar('projeto_status', STATUS_PROJETO);
      TAGS_PROJETO       = aplicar('projeto_tag', TAGS_PROJETO);
      STATUS_MANIFESTACAO = aplicar('manifestacao_status', STATUS_MANIFESTACAO);
      TAGS_MANIFESTACAO  = aplicar('manifestacao_tag', TAGS_MANIFESTACAO);
      MEIOS              = aplicar('mov_meio', MEIOS);

      /* Cor do evento vem da própria linha do vocabulário. */
      var ev = v.evento_tipo || [];
      if (ev.length) {
        var cores = {};
        ev.forEach(function (x) { if (x.cor) cores[x.valor] = x.cor; });
        if (Object.keys(cores).length) EVENTO_COR = cores;
      }

      /* TAR_STATUS_COR é semântica POR POSIÇÃO (não iniciado → neutro,
         em andamento → dourado, feito → verde), não por nome. Remapear por
         índice faz a cor sobreviver a um rename de status. */
      var paleta = ['var(--mute)', 'var(--gold)', 'var(--green)'];
      var novo = {};
      TAR_STATUS.forEach(function (st, i) { novo[st] = paleta[i] || 'var(--dim)'; });
      TAR_STATUS_COR = novo;

      /* O filtro padrão da lista de projetos aponta para um status por
         nome; se ele sumiu da lista, cai no primeiro disponível. */
      if (STATUS_PROJETO.indexOf(PROJ_STATUS_FILTRO) === -1) {
        PROJ_STATUS_FILTRO = STATUS_PROJETO[0] || '';
      }

      /* Refaz o que já tinha sido montado com o vocabulário embutido.
         `init()` roda antes daqui, então sem isto um valor criado na tela
         de Tags não apareceria nos seletores até um reload. */
      renderEventoTipoPicker();
      renderProjStatusFilter();
    }).catch(function (e) {
      console.warn('[lifeos] vocabulários indisponíveis — usando o fallback embutido', e);
    });
  }

  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  /* ── Estado ──────────────────────────────────────────────────── */
  var SESSION_PW = '';
  var MROWS = [];             /* movimentações do mês corrente */
  var FIN_PREV_ROWS = [];     /* movimentações do mês ANTERIOR — só pra projetar a fatura que fecha agora */
  var SALDO_ABERTURA = 0;
  var EVENTOS = [];           /* eventos acumulados de todos os meses já buscados nesta sessão */
  var HUB_CAL_YM = '';        /* mês exibido no mini-calendário (navegável — ver goHubCalMonth) */
  var CAL_MODE = 'eventos';   /* 'eventos' | 'tarefas' — o que o calendário do hub mostra (dots, legenda, linha do tempo, modal do dia). Só troca o que é EXIBIDO; escrita continua só via #add-evento-btn (eventos) ou tarefas.html (tarefas). */
  var HUB_EVENTOS_LOADED = {}; /* ym -> true, meses de eventos já buscados (evita refetch ao navegar) */
  var PROJETOS = [];          /* lista completa, só leitura aqui — popula o seletor opcional do modal de evento e o resumo de Tarefas */
  var TAREFAS_ALL = [];       /* todas as tarefas (todos os projetos), só leitura — resumo de Tarefas no hub */
  var NOTAS_HUB = [];         /* todas as notas, só leitura — resumo de Notas no hub (página própria em notas.html, ver LIFEOS.md §8) */
  /* Manifestações — migrado do Notion em set/2026 (ver notion-manifestacoes-
     migrate, dormente após a migração única; LIFEOS.md). CREATE direto pelo
     hub desde set/2026 (a pedido do autor — ver #manifestacao-modal); sem
     editar/excluir ainda (não adiantar escopo além do pedido). */
  var MANIFESTACOES = [];
  var MANIF_FOCUS = false;    /* modo foco do atalho rápido — ver toggleManifFocus */
  var MANIFESTACAO_TAGS_SEL = [];   /* estado do chip-picker multi-select de tags */
  var MANIFESTACAO_BANNER_FILE = null; /* File escolhido no input, null = sem banner */
  var FIN_MONTH_CACHE = {};   /* ym -> movimentacoes, memoização pra carryInto (ver ensureFinMonthRows) */
  var finChart = null;
  var NOT_TIPO_CHART = null;  /* barras · distribuição de Notas por tipo (#not-chart-tipo) */
  var NOT_PROJETO_CHART = null;  /* barras · distribuição de Notas por projeto (#not-chart-projeto), 6ª rodada */
  var NOT_PROJETO_FILTRO = ''; /* '' = todos os projetos — filtro da mini-lista #not-recent, não persiste (reseta ao deslogar) */
  /* CRUD de Tarefas direto pelo hub (exceção documentada em LIFEOS.md,
     set/2026 — decisão explícita do autor) — estado do #tarefa-modal
     (criar/editar) e do detail-modal (que ganhou botões Editar/Excluir). */
  var EDIT_TAREFA_ID = null;        /* null = #tarefa-modal em modo "criar" */
  var TAREFA_TIPO_SEL = [];         /* estado do chip-picker multi-select de tipo */
  var MD_MODES = ['Editar', 'Pré-visualizar']; /* toggle do campo de descrição (markdown) */
  var TAREFA_DESCRICAO_MODE = 'Editar';
  var CURRENT_DETAIL_TAREFA_ID = null; /* tarefa aberta no detail-modal — alimenta Editar/Excluir */
  var CURRENT_DETAIL_NOTA_ID = null;   /* nota aberta no detail-modal — alimenta o botão "Tela cheia" */
  /* CRUD de Projetos direto pelo hub — movido de tarefas.js em set/2026 (ver
     LIFEOS.md, decisão explícita do autor de centralizar a gestão aqui). */
  var EDIT_PROJETO_ID = null;       /* null = #projeto-modal em modo "criar" */
  var PROJETO_TAGS_SEL = [];        /* estado do chip-picker multi-select de tags */

  /* ── Helpers ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function has(m, tag) { return Array.isArray(m.tipo) && m.tipo.indexOf(tag) !== -1; }
  function isEntrada(m) { return has(m, 'Entrada'); }
  function isSaida(m) { return has(m, 'Saida'); }
  function isSaidaCaixa(m) { return isSaida(m) && !has(m, 'Crédito'); }
  function hasAnyMeio(m) { return MEIOS.some(function (me) { return has(m, me); }); }
  /* Pagamento de fatura: Saida sem NENHUM meio e descrição contendo "fatura"
     — mesma regra de financas.js, cópia isolada (ver LIFEOS.md §2/§6). */
  function isPagamentoFatura(m) { return isSaida(m) && !hasAnyMeio(m) && /fatura/i.test(m.name || ''); }
  /* Adiantamento EXPLÍCITO: pagamento de fatura cujo nome também contém
     "adiant" — mesma regra de financas.js. Sai da conta de quitação da
     fatura que fecha agora, vai direto pro excedente da próxima. */
  function isAdiantamentoExplicito(m) { return isPagamentoFatura(m) && /adiant/i.test(m.name || ''); }
  function vezes(n) { return n + (n === 1 ? ' pagamento' : ' pagamentos'); }
  /* Separa pagamentos de fatura (ordem cronológica) em quitação da atual vs.
     adiantamento — soma cumulativa em CENTAVOS contra o total. Pagamento
     que cruza a linha é partido em duas entradas sintéticas. Cópia exata
     de financas.js (ver comentário lá pro porquê de cada detalhe). */
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
  function todayYM() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function nextMonth(ym) { var p = ym.split('-'); var y = +p[0], m = +p[1]; return (m === 12) ? ((y + 1) + '-01') : (y + '-' + String(m + 1).padStart(2, '0')); }
  function prevMonth(ym) { var p = ym.split('-'); var y = +p[0], m = +p[1]; return (m === 1) ? ((y - 1) + '-12') : (y + '-' + String(m - 1).padStart(2, '0')); }
  var DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function isBissexto(y) { return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0); }
  function lastDayOfMonth(ym) { var p = ym.split('-'); var y = +p[0], m = +p[1]; return (m === 2 && isBissexto(y)) ? 29 : DIAS_NO_MES[m - 1]; }
  /* fatura destino: antes do último dia -> M+1; no último dia -> M+2 (mesma regra de financas.js) */
  function faturaDestino(ym, dia) { var prox = nextMonth(ym); return (dia < lastDayOfMonth(ym)) ? prox : nextMonth(prox); }
  function monthLabel(ym) { var p = ym.split('-'); return MESES[(+p[1]) - 1] + ' ' + p[0]; }
  function fmtDate(d) { if (!d) return '—'; var p = d.split('-'); return p[2] + '/' + p[1]; }
  function tagClass(t) { return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''); }
  function isRealizado(m) { return !m.date || m.date <= todayISO(); }
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  /* Agrupa as compras em Crédito de `rows` (mês `ym`) por ciclo de fatura —
     cópia exata da de financas.js (mesma função, mesma regra de negócio;
     ver LIFEOS.md §2 sobre padrões repetidos por cópia). */
  function calcularProjecaoFatura(rows, ym) {
    var groups = {};
    rows.forEach(function (m) {
      if (!isSaida(m) || !has(m, 'Crédito') || /fatura/i.test(m.name || '')) return;
      var d = m.date ? parseInt(m.date.slice(8, 10), 10) : 0;
      var destino = faturaDestino(ym, d);
      if (!groups[destino]) groups[destino] = { total: 0, rows: [] };
      groups[destino].total += num(m.valor);
      groups[destino].rows.push(m);
    });
    return groups;
  }

  /* ── Chip pickers genéricos (status/tipo/projeto/descrição do
     #tarefa-modal) — cópia isolada do mesmo componente de tarefas.js, ver
     LIFEOS.md §2/§7. Single: clicar troca a seleção inteira. Multi: clicar
     alterna aquele valor num array. ── */
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
  /* Picker de projeto do #tarefa-modal: reconstrói toda vez que o modal abre
     (PROJETOS pode ganhar itens depois do boot), um chip por projeto —
     mesmo padrão de buildProjetoChipPicker em tarefas.js. Diferente do
     picker de projeto do #evento-modal (evento-projeto-picker, opcional,
     com "Nenhum") — projeto de tarefa é OBRIGATÓRIO, sem opção vazia. */
  /* Só projetos "Em Progresso" entram na lista de vínculo — não faz
     sentido criar/mover uma tarefa pra um projeto Pausado/Feito/Não
     Iniciado, e isso mantém a UI enxuta (ver LIFEOS.md). `currentProjetoId`
     é uma exceção: ao EDITAR uma tarefa cujo projeto não está (ou deixou de
     estar) Em Progresso, ele ainda entra na lista — senão o chip da
     seleção atual sumiria e a tarefa pareceria "sem projeto" no formulário. */
  function buildProjetoChipPicker(currentProjetoId) {
    var host = $('tarefa-projeto-picker'); host.innerHTML = '';
    PROJETOS.filter(function (p) { return p.status === 'Em Progresso' || p.id === currentProjetoId; }).forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip-opt'; btn.setAttribute('data-value', p.id);
      btn.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
      host.appendChild(btn);
    });
  }
  /* window.marked pode não estar disponível ainda (CDN lento/bloqueado) —
     cai pra texto puro escapado em vez de quebrar a pré-visualização/leitura. */
  function renderMarkdown(src) {
    if (!src) return '';
    if (window.marked && window.marked.parse) return window.marked.parse(src);
    var div = document.createElement('div'); div.textContent = src;
    return '<p>' + div.innerHTML.replace(/\n/g, '<br>') + '</p>';
  }

  /* ── Dev mock (ambiente local) — mesmo motivo dos outros dois módulos:
     CORS restringe produção, login real é inalcançável em localhost/file://. */
  var IS_LOCAL_DEV = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  /* Drag-and-drop do mini-kanban de Tarefas é só desktop — mouse de
     precisão + hover de verdade, não touch (evita conflito com scroll/tap
     em celular). (hover:hover) + (pointer:fine) é o feature-detect padrão
     pra "tem mouse", mais confiável que sniffar UA ou largura de tela. */
  var IS_DESKTOP = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : true;
  var DRAG_TAREFA_ID = null; /* id da tarefa sendo arrastada no mini-kanban do hub */

  function seededRandom(seed) {
    var s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function seedFromString(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) || 1; }
  function mockDelay(value) { return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, 220); }); }

  function mockFinMonth(ym) {
    var rnd = seededRandom(seedFromString(ym));
    var i = 0, rows = [];
    /* created_at incremental (não realista, só ordenado) — exercita o
       desempate por created_at (ver renderFinancasPreview) em dev local
       também, já que aqui não existe banco de verdade gravando timestamps
       reais na ordem de inserção. */
    function push(name, valor, day, tipo) {
      rows.push({
        id: 'mock-' + ym + '-' + i, name: name, valor: round2(valor),
        date: ym + '-' + String(Math.min(day, lastDayOfMonth(ym))).padStart(2, '0'), tipo: tipo,
        created_at: new Date(2026, 0, 1, 0, i++).toISOString(),
      });
    }
    push('Salário', 4400, 5, ['Entrada', 'Pix']);
    push('Aluguel', 1650 + rnd() * 60, 6, ['Saida', 'Pix']);
    push('Fatura', 280 + rnd() * 220, 10, ['Saida']);
    for (var c = 0; c < 5; c++) push('Delivery', 20 + rnd() * 60, 3 + c * 5, ['Saida', 'Crédito']);
    for (var pxi = 0; pxi < 4; pxi++) push('Pai', 25 + rnd() * 10, 2 + pxi * 6, ['Entrada', 'Pix']);
    return rows;
  }
  function mockFinQuery(ym, ymPrev) {
    var t = todayYM();
    var min = prevMonth(prevMonth(prevMonth(t)));
    var max = nextMonth(t);
    /* Fora do range mockado: linhas vazias, como a base real faria — sem
       isso, carryInto() recursaria pro infinito, já que todo mês mockado
       tem uma linha "Fatura" e nunca bateria no caso-base de "mês sem
       nenhum pagamento de fatura" (mesmo ajuste de financas.js). */
    var rows = (ym >= min && ym <= max) ? mockFinMonth(ym) : [];
    var rndA = seededRandom(seedFromString(ym + '-abertura'));
    var out = { ok: true, ym: ym, saldo_abertura: round2(rndA() * 1200 - 100), movimentacoes: rows };
    if (ymPrev) {
      out.ym_prev = ymPrev;
      out.movimentacoes_prev = (ymPrev >= min && ymPrev <= max) ? mockFinMonth(ymPrev) : [];
    }
    return out;
  }

  var MOCK_EVENTOS = null;
  var MOCK_EVT_NAMES = ['Prova de Cálculo', 'Sessão', 'Cinema com amigos', 'Consulta médica', 'Reunião de equipe', 'Aniversário do Pai'];
  var MOCK_EVT_TIPOS = ['faculdade', 'trabalho', 'lazer', 'vida', 'psicodelia'];
  function seedMockEventos() {
    var rnd = seededRandom(seedFromString('eventos-seed'));
    var t = todayYM();
    var months = [t, t, t, nextMonth(t), nextMonth(t), nextMonth(nextMonth(t))];
    var out = [];
    for (var i = 0; i < months.length; i++) {
      var ym = months[i];
      var day = 1 + Math.floor(rnd() * (lastDayOfMonth(ym) - 1));
      out.push({ id: 'mock-evt-' + i, name: MOCK_EVT_NAMES[i % MOCK_EVT_NAMES.length], date: ym + '-' + String(day).padStart(2, '0'), tipo: MOCK_EVT_TIPOS[i % MOCK_EVT_TIPOS.length] });
    }
    return out;
  }
  function mockEventosQuery(from, to) {
    if (!MOCK_EVENTOS) MOCK_EVENTOS = seedMockEventos();
    return { ok: true, eventos: MOCK_EVENTOS.filter(function (e) { return e.date >= from && e.date <= to; }) };
  }
  /* create/delete mutam o MESMO array que mockEventosQuery lê — sem servidor,
     mesmo espírito do mock de movimentações em financas.js. */
  function mockEventosCreate(evento) {
    if (!MOCK_EVENTOS) MOCK_EVENTOS = seedMockEventos();
    var created = Object.assign({ id: 'mock-evt-new-' + Date.now() }, evento);
    MOCK_EVENTOS.push(created);
    return { ok: true, evento: created };
  }
  function mockEventosDelete(id) {
    if (MOCK_EVENTOS) { for (var i = 0; i < MOCK_EVENTOS.length; i++) { if (MOCK_EVENTOS[i].id === id) { MOCK_EVENTOS.splice(i, 1); break; } } }
    return { ok: true, id: id };
  }

  var MOCK_PROJETOS = null, MOCK_TAREFAS_ALL = null;
  var MOCK_STATUS_TAREFA = ['Não Iniciado', 'Em Andamento', 'Feito'];
  /* Descrições de exemplo (markdown) pros mocks — sem isso, o dev local
     nunca exercita o preview markdown nem o campo Descrição do detail-modal.
     `null` entra na rotação de propósito (testa o caso "sem descrição"). */
  var MOCK_DESCRICOES = [
    '### Contexto\n\nAlinhar com o time antes de começar.\n\n- revisar escopo\n- validar prazo com o responsável',
    'Prioridade **alta** — bloqueada até a revisão de design terminar.\n\n> depende da tarefa anterior',
    'Passos:\n\n1. Levantar requisitos\n2. Rascunhar solução\n3. Validar\n\nSem *breaking changes* nesse ciclo.',
    'Só um lembrete rápido, nada estruturado aqui.',
    null,
  ];
  function seedMockTarefas() {
    MOCK_PROJETOS = [
      { id: 'mock-proj-1', name: 'LifeOS', emoji: '📚', status: 'Em Progresso', tags: ['Pessoal'] },
      { id: 'mock-proj-2', name: 'Faculdade', emoji: null, status: 'Em Progresso', tags: ['Acadêmico'] },
    ];
    var rnd = seededRandom(seedFromString('lifeos-tarefas-seed'));
    var names = ['Ajustar layout', 'Corrigir bug', 'Escrever documentação', 'Revisar PR', 'Planejar sprint'];
    MOCK_TAREFAS_ALL = [];
    var i = 0;
    var t = todayYM();
    MOCK_PROJETOS.forEach(function (p) {
      for (var k = 0; k < 5; k++) {
        var status = MOCK_STATUS_TAREFA[Math.floor(rnd() * MOCK_STATUS_TAREFA.length)];
        var hasData = rnd() > 0.4;
        var ym = rnd() > 0.5 ? t : nextMonth(t); /* espalha entre o mês corrente e o seguinte — dá pra ver dots sem navegar */
        /* 1-2 tipos por tarefa (antes vinha [] sempre — as tags de tipo do
           mini-kanban nunca apareciam em dev local por falta de dado). */
        var tipoSel = [], tipoCount = 1 + Math.floor(rnd() * 2);
        for (var ti = 0; ti < tipoCount; ti++) {
          var tp = TIPOS_TAREFA[Math.floor(rnd() * TIPOS_TAREFA.length)];
          if (tipoSel.indexOf(tp) === -1) tipoSel.push(tp);
        }
        MOCK_TAREFAS_ALL.push({
          id: 'mock-tarefa-' + (i++), name: names[Math.floor(rnd() * names.length)] + ' #' + (k + 1),
          status: status, tipo: tipoSel, projeto_id: p.id,
          data_entrega: hasData ? (ym + '-' + String(1 + Math.floor(rnd() * 27)).padStart(2, '0')) : null,
          descricao: MOCK_DESCRICOES[Math.floor(rnd() * MOCK_DESCRICOES.length)],
          /* espalhado nos últimos 30 dias — dá pra ver a coluna "Feito" do
             mini-kanban ordenando por concluído-mais-recente-primeiro. */
          updated_at: new Date(Date.now() - Math.floor(rnd() * 30) * 86400000).toISOString(),
        });
      }
    });
  }
  function mockProjetosQuery() { if (!MOCK_PROJETOS) seedMockTarefas(); return { ok: true, projetos: MOCK_PROJETOS.slice() }; }
  var MOCK_MANIFESTACOES = null;
  function mockManifestacoesQuery() {
    if (!MOCK_MANIFESTACOES) {
      MOCK_MANIFESTACOES = [
        { id: 'mock-manif-1', name: 'Aprender Malabarismo', status: 'Não Iniciado', tags: ['Vida', 'Lazer'], banner_url: null, descricao: null },
        { id: 'mock-manif-2', name: 'Viajar pra São Tomé', status: 'Não Iniciado', tags: ['Lazer'], banner_url: null, descricao: null },
        { id: 'mock-manif-3', name: 'Integrar a Sombra do Amante', status: 'Em Progresso', tags: ['Vida', 'Saúde'], banner_url: null, descricao: null },
        { id: 'mock-manif-4', name: 'Liberdade Financeira', status: 'Em Progresso', tags: ['Vida', 'Financeiro'], banner_url: null, descricao: null },
        { id: 'mock-manif-5', name: 'Mestrado', status: 'Feito', tags: ['Vida', 'Carreira'], banner_url: null, descricao: null },
      ];
    }
    return { ok: true, manifestacoes: MOCK_MANIFESTACOES.slice() };
  }
  /* create de Manifestações — mock local do CREATE do hub (ver LIFEOS.md).
     Sem Storage de verdade em dev: banner_base64 (se vier) vira um data:
     URL direto, que <img src> já renderiza sem precisar de upload nenhum. */
  function mockManifestacoesCreate(m, bannerBase64, bannerContentType) {
    if (!MOCK_MANIFESTACOES) mockManifestacoesQuery();
    var bannerUrl = bannerBase64 ? ('data:' + (bannerContentType || 'image/jpeg') + ';base64,' + bannerBase64) : null;
    var created = Object.assign({ id: 'mock-manif-new-' + Date.now(), banner_url: bannerUrl, descricao: null }, m);
    MOCK_MANIFESTACOES.push(created);
    return { ok: true, manifestacao: created };
  }
  var MOCK_NOTAS = null;
  function mockNotasQuery() {
    if (!MOCK_NOTAS) {
      MOCK_NOTAS = [
        { id: 'mock-nota-1', name: 'Bhagavad Gita — Introdução', tipo: ['Análise de Leitura', 'Conclusões'], data: '2026-06-05', projeto_ids: [], conteudo_md: null, created_at: '2026-06-05T18:00:00.000Z' },
        { id: 'mock-nota-2', name: 'Análise da viabilidade da IA psiconauta', tipo: ['Faculdade', 'Pesquisa'], data: '2026-05-20', projeto_ids: [], conteudo_md: null, created_at: '2026-05-20T12:00:00.000Z' },
        { id: 'mock-nota-3', name: '[08/06/2024] Visual do Fone', tipo: ['Lembranças', 'Conclusões', 'Vida'], data: null, projeto_ids: [], conteudo_md: null, created_at: '2026-04-01T09:00:00.000Z' },
        { id: 'mock-nota-4', name: 'Nota rápida sem projeto', tipo: ['Pensamentos'], data: null, projeto_ids: [], conteudo_md: null, created_at: '2026-03-01T09:00:00.000Z' },
      ];
    }
    return { ok: true, notas: MOCK_NOTAS.slice() };
  }
  /* create/update/delete de Projetos — CRUD completo movido de tarefas.js
     pra cá em set/2026 (ver LIFEOS.md); cópia isolada do mesmo mock. */
  function mockProjetosCreate(p) {
    if (!MOCK_PROJETOS) seedMockTarefas();
    var created = Object.assign({ id: 'mock-proj-new-' + Date.now() }, p);
    MOCK_PROJETOS.push(created);
    return { ok: true, projeto: created };
  }
  function mockProjetosUpdate(id, patch) {
    if (!MOCK_PROJETOS) seedMockTarefas();
    var existing = null;
    for (var i = 0; i < MOCK_PROJETOS.length; i++) { if (String(MOCK_PROJETOS[i].id) === String(id)) { existing = MOCK_PROJETOS[i]; break; } }
    var updated = Object.assign({}, existing || { id: id }, patch);
    if (existing) Object.assign(existing, patch);
    return { ok: true, projeto: updated };
  }
  function mockProjetosDelete(id) {
    if (MOCK_PROJETOS) { for (var i = 0; i < MOCK_PROJETOS.length; i++) { if (String(MOCK_PROJETOS[i].id) === String(id)) { MOCK_PROJETOS.splice(i, 1); break; } } }
    return { ok: true, id: id };
  }
  function mockTarefasQuery() { if (!MOCK_TAREFAS_ALL) seedMockTarefas(); return { ok: true, tarefas: MOCK_TAREFAS_ALL.slice() }; }
  /* Único write de Tarefas no hub — drag-and-drop de status no mini-kanban
     (ver §3.2 LIFEOS.md, exceção explícita ao "hub é read-only pra
     Tarefas"). Cópia isolada de mockTarefasUpdate em tarefas.js. */
  function mockTarefasUpdate(id, patch) {
    if (!MOCK_TAREFAS_ALL) seedMockTarefas();
    var existing = null;
    for (var i = 0; i < MOCK_TAREFAS_ALL.length; i++) { if (MOCK_TAREFAS_ALL[i].id === id) { existing = MOCK_TAREFAS_ALL[i]; break; } }
    /* bump updated_at — mesmo comportamento do backend real (ver
       lifeos-tarefas/handleUpdate); sem isso, mover um card pra "Feito" no
       mini-kanban não subiria pro topo da coluna (ver renderTarMiniKanban). */
    var withTimestamp = Object.assign({}, patch, { updated_at: new Date().toISOString() });
    var updated = Object.assign({}, existing || { id: id }, withTimestamp);
    if (existing) Object.assign(existing, withTimestamp);
    return { ok: true, tarefa: updated };
  }
  /* create/delete de Tarefas — só entram em uso com o CRUD completo do hub
     (ver LIFEOS.md, exceção set/2026); cópia isolada do mesmo mock de
     tarefas.js. */
  function mockTarefasCreate(t) {
    if (!MOCK_TAREFAS_ALL) seedMockTarefas();
    var created = Object.assign({ id: 'mock-tarefa-new-' + Date.now() }, t);
    MOCK_TAREFAS_ALL.push(created);
    return { ok: true, tarefa: created };
  }
  function mockTarefasDelete(id) {
    if (MOCK_TAREFAS_ALL) { for (var i = 0; i < MOCK_TAREFAS_ALL.length; i++) { if (String(MOCK_TAREFAS_ALL[i].id) === String(id)) { MOCK_TAREFAS_ALL.splice(i, 1); break; } } }
    return { ok: true, id: id };
  }
  function showDevBadge() {
    var b = document.createElement('div');
    b.textContent = 'DEV · dados fictícios';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#c4913a;color:#14120f;' +
      "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;padding:4px 0;";
    document.body.appendChild(b);
  }

  /* ── Rede (só leitura) ───────────────────────────────────────── */
  /* ymPrev (opcional, set/2026): funde a busca do mês atual + anterior numa
     chamada só (ver LIFEOS.md) — antes o hub fazia 2 chamadas separadas
     pra esta function só porque precisava de 2 meses do MESMO módulo.
     financas.js nunca manda ymPrev, contrato dele fica idêntico. */
  function apiFinQuery(pw, ym, ymPrev) {
    if (IS_LOCAL_DEV) return mockDelay(mockFinQuery(ym, ymPrev));
    var body = { token: pw, ym: ym };
    if (ymPrev) body.ym_prev = ymPrev;
    return fetch(MOVS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiEventosQuery(pw, from, to) {
    if (IS_LOCAL_DEV) return mockDelay(mockEventosQuery(from, to));
    return fetch(EVENTOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, from: from, to: to }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiEventosCreate(pw, evento) {
    if (IS_LOCAL_DEV) return mockDelay(mockEventosCreate(evento));
    return fetch(EVENTOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'create', evento: evento }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiEventosDelete(pw, id) {
    if (IS_LOCAL_DEV) return mockDelay(mockEventosDelete(id));
    return fetch(EVENTOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'delete', id: id }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }

  /* Projetos: CRUD completo aqui desde set/2026 (ver LIFEOS.md — movido de
     tarefas.js, decisão explícita do autor de centralizar a gestão no hub).
     Também alimenta o seletor opcional do modal de evento. */
  function apiProjetosQuery(pw) {
    if (IS_LOCAL_DEV) return mockDelay(mockProjetosQuery());
    return fetch(PROJETOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiProjetosCreate(pw, projeto) {
    if (IS_LOCAL_DEV) return mockDelay(mockProjetosCreate(projeto));
    return fetch(PROJETOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'create', projeto: projeto }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiProjetosUpdate(pw, id, patch) {
    if (IS_LOCAL_DEV) return mockDelay(mockProjetosUpdate(id, patch));
    return fetch(PROJETOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'update', id: id, patch: patch }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  /* delete lê o corpo da resposta mesmo em erro (diferente do padrão
     genérico acima) — precisa do campo `error:"has_tarefas"` que a Edge
     Function devolve em 409 quando o projeto ainda tem tarefa vinculada
     (`on delete restrict`), pra mostrar uma mensagem que faça sentido em
     vez de só "erro 409". */
  function apiProjetosDelete(pw, id) {
    if (IS_LOCAL_DEV) return mockDelay(mockProjetosDelete(id));
    return fetch(PROJETOS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'delete', id: id }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      return res.json().catch(function () { return null; }).then(function (j) {
        if (res.status === 409 || (j && j.error === 'has_tarefas')) {
          return Promise.reject({ code: 'server', detail: 'este projeto tem tarefas vinculadas — mova ou exclua as tarefas antes' });
        }
        if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
        if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
        return j;
      });
    });
  }
  function apiTarefasQuery(pw) {
    if (IS_LOCAL_DEV) return mockDelay(mockTarefasQuery());
    return fetch(TAREFAS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  /* Manifestações: só leitura por enquanto (sem CRUD ainda — ver LIFEOS.md). */
  function apiManifestacoesQuery(pw) {
    if (IS_LOCAL_DEV) return mockDelay(mockManifestacoesQuery());
    return fetch(MANIFESTACOES_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  /* Notas: só leitura no hub (página própria, mesmo tratamento read-only
     que Finanças — ver LIFEOS.md §8). */
  function apiNotasQuery(pw) {
    if (IS_LOCAL_DEV) return mockDelay(mockNotasQuery());
    return fetch(NOTAS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  /* CREATE de Manifestações — banner_base64/banner_content_type são
     opcionais (undefined quando nenhum arquivo foi escolhido, ver
     onManifestacaoSubmit). Upload do banner é best-effort no servidor —
     mesmo em erro de imagem a manifestação é criada (ver LIFEOS.md). */
  function apiManifestacoesCreate(pw, manifestacao, bannerBase64, bannerContentType) {
    if (IS_LOCAL_DEV) return mockDelay(mockManifestacoesCreate(manifestacao, bannerBase64, bannerContentType));
    var body = { token: pw, action: 'create', manifestacao: manifestacao };
    if (bannerBase64) { body.banner_base64 = bannerBase64; body.banner_content_type = bannerContentType; }
    return fetch(MANIFESTACOES_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  /* Exceção deliberada ao "Tarefas é só leitura no hub" — só serve o
     drag-and-drop de status do mini-kanban (desktop, ver IS_DESKTOP);
     continua sem criar/editar/excluir tarefa nenhuma aqui. */
  function apiTarefasUpdate(pw, id, patch) {
    if (IS_LOCAL_DEV) return mockDelay(mockTarefasUpdate(id, patch));
    return fetch(TAREFAS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'update', id: id, patch: patch }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  /* create/delete de Tarefas — parte do CRUD completo do hub (exceção
     documentada em LIFEOS.md, set/2026). Mesmo endpoint/contrato de
     tarefas.js, cópia isolada (ver LIFEOS.md §2). */
  function apiTarefasCreate(pw, tarefa) {
    if (IS_LOCAL_DEV) return mockDelay(mockTarefasCreate(tarefa));
    return fetch(TAREFAS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'create', tarefa: tarefa }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }
  function apiTarefasDelete(pw, id) {
    if (IS_LOCAL_DEV) return mockDelay(mockTarefasDelete(id));
    return fetch(TAREFAS_FN, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pw, action: 'delete', id: id }),
    }).then(function (res) {
      if (res.status === 401) return Promise.reject({ code: 'unauthorized' });
      if (!res.ok) return Promise.reject({ code: 'server', detail: String(res.status) });
      return res.json();
    }).then(function (j) {
      if (!j || !j.ok) return Promise.reject({ code: 'server', detail: (j && j.error) || 'resposta inválida' });
      return j;
    });
  }

  /* Trecho de preview de conteúdo — cópia isolada de noteSnippet() em
     notas.js (mesmo princípio de cópia-não-import de todo o resto do
     arquivo, ver LIFEOS.md §2). Texto puro, sem parse de markdown. */
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
    return s.length > 100 ? s.slice(0, 100).trim() + '…' : s;
  }

  /* Barras horizontais compartilhadas entre "Por tipo" e "Por projeto"
     (6ª rodada, set/2026 — antes só existia pra tipo, duplicar a mesma
     config de Chart.js pros dois não valia a pena). Mesmo padrão de
     renderTipoChart() em tarefas.js (indexAxis:'y', tooltip na paleta
     sépia do hub). oldChart é destruído antes de recriar (mesmo ciclo de
     vida que toda instância Chart.js segue no projeto); retorna a nova
     instância (ou null sem dado/sem Chart.js) pro chamador guardar na
     variável de estado certa (NOT_TIPO_CHART/NOT_PROJETO_CHART). */
  function renderNotasBarChart(oldChart, canvasId, emptyId, labels, data, colors, unitLabel) {
    if (oldChart) oldChart.destroy();
    var chartEl = $(canvasId), chartEmptyEl = $(emptyId);
    var hasData = data.length > 0;
    chartEmptyEl.hidden = hasData;
    chartEl.style.display = hasData ? '' : 'none';
    if (!hasData || !window.Chart) return null;
    return new Chart(chartEl, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 20 }] },
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
          tooltip: {
            backgroundColor: '#242018', borderColor: '#2e2a24', borderWidth: 1, titleColor: '#ede8df', bodyColor: '#ede8df',
            titleFont: { family: "'JetBrains Mono', monospace", size: 11 }, bodyFont: { family: "'JetBrains Mono', monospace", size: 12 }, padding: 10,
            callbacks: { label: function (c) { return ' ' + c.parsed.x + (c.parsed.x === 1 ? ' ' + unitLabel : ' ' + unitLabel + 's'); } },
          },
        },
      },
    });
  }

  /* ── Preview de Notas: total + sem-projeto + breakdown por tipo/projeto
     (gráficos de barras) + últimas notas — página própria em notas.html,
     ver LIFEOS.md §8. Lista É clicável (3ª rodada, set/2026) — abre o
     #detail-modal em modo leitura, ver openDetailModal('nota', …). ── */
  function renderNotasPreview() {
    var semProjeto = NOTAS_HUB.filter(function (n) { return !(n.projeto_ids || []).length; }).length;
    $('not-stats').textContent = NOTAS_HUB.length + (NOTAS_HUB.length === 1 ? ' nota' : ' notas') +
      ' · ' + semProjeto + ' sem projeto';

    /* Só entram os tipos com contagem > 0; até 12 categorias possíveis
       ainda lê bem em barra (Tarefas já lida com 9). */
    var tipoCounts = {};
    NOTAS_HUB.forEach(function (n) { (n.tipo || []).forEach(function (t) { tipoCounts[t] = (tipoCounts[t] || 0) + 1; }); });
    var tipoLabels = [], tipoData = [], tipoCores = [];
    TIPOS_NOTA.forEach(function (t) {
      if (tipoCounts[t] > 0) { tipoLabels.push(t); tipoData.push(tipoCounts[t]); tipoCores.push(NOT_TIPO_COR[t]); }
    });
    NOT_TIPO_CHART = renderNotasBarChart(NOT_TIPO_CHART, 'not-chart-tipo', 'not-chart-tipo-empty', tipoLabels, tipoData, tipoCores, 'nota');

    /* "Por projeto" (novo, 6ª rodada) — projeto não tem cor própria como
       tipo (ver .tag-projeto/.tag-projeto-mini, sempre neutra por
       decisão), então todas as barras usam a mesma cor --gold. Top 8 por
       contagem — mais que isso não cabe legível no .not-chart-wrap (mesmo
       raciocínio de qualquer lista "top N" no projeto). Sem entrada "sem
       projeto" aqui — esse número já aparece na linha de stats do card
       "Por tipo" ao lado. */
    var projCounts = {};
    NOTAS_HUB.forEach(function (n) { (n.projeto_ids || []).forEach(function (pid) { projCounts[pid] = (projCounts[pid] || 0) + 1; }); });
    var projEntries = Object.keys(projCounts).map(function (pid) {
      var p = findProjetoById(pid);
      return { label: p ? ((p.emoji ? p.emoji + ' ' : '') + p.name) : '?', count: projCounts[pid] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
    $('not-stats-projeto').textContent = projEntries.length === 0 ? 'nenhum projeto ainda' :
      Object.keys(projCounts).length + (Object.keys(projCounts).length === 1 ? ' projeto' : ' projetos') + ' com notas';
    NOT_PROJETO_CHART = renderNotasBarChart(
      NOT_PROJETO_CHART, 'not-chart-projeto', 'not-chart-projeto-empty',
      projEntries.map(function (e) { return e.label; }), projEntries.map(function (e) { return e.count; }), '#c4913a', 'nota'
    );

    renderNotasRecentList();
  }

  /* Separada de renderNotasPreview() pra poder re-renderizar só a lista
     quando o filtro de projeto muda, sem destruir/recriar o gráfico Chart.js
     à toa (mesmo espírito de renderTarMiniKanban() ser separada do resto do
     preview de Tarefas). */
  function renderNotasRecentList() {
    /* Filtro por projeto (mini versão do <select id="projeto-select"> de
       notas.html) — reconstrói toda vez que o boot/refresh troca PROJETOS,
       preservando a seleção atual (mesmo padrão de renderProjetoSelect()
       pro mini-kanban de Tarefas, ver acima). Só filtra a LISTA — o
       gráfico de tipo acima sempre reflete TODAS as notas, mesmo princípio
       de tarefas.js/financas.js (chips/agregados refletem o todo, nunca o
       subconjunto já filtrado). */
    var notSel = $('not-projeto-filtro');
    if (notSel) {
      notSel.innerHTML = '';
      var notTodos = document.createElement('option'); notTodos.value = ''; notTodos.textContent = 'Todos os projetos';
      notSel.appendChild(notTodos);
      PROJETOS.forEach(function (p) {
        var opt = document.createElement('option'); opt.value = p.id;
        opt.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
        notSel.appendChild(opt);
      });
      notSel.value = NOT_PROJETO_FILTRO;
    }
    var notasFiltradas = NOT_PROJETO_FILTRO
      ? NOTAS_HUB.filter(function (n) { return (n.projeto_ids || []).indexOf(NOT_PROJETO_FILTRO) !== -1; })
      : NOTAS_HUB;

    var recentHost = $('not-recent'); recentHost.innerHTML = '';
    if (!notasFiltradas.length) {
      var emptyRecent = document.createElement('div'); emptyRecent.className = 'hub-list-empty';
      emptyRecent.textContent = NOTAS_HUB.length ? 'nenhuma nota desse projeto' : 'nenhuma nota ainda';
      recentHost.appendChild(emptyRecent);
    } else {
      /* Mesma ordenação da Edge Function (data desc, nulls por último,
         depois created_at desc) — a lista já vem assim, sem reordenar aqui.
         SEM slice — mesma virada de Eventos: mostra TODAS as filtradas, o
         card rola por dentro (.hub-list-scroll, max-height fixo em CSS —
         ver #not-recent em lifeos.html) o que não couber. */
      notasFiltradas.forEach(function (n) {
        var row = document.createElement('div'); row.className = 'hub-list-row is-clickable';
        row.setAttribute('data-detail-kind', 'nota');
        row.setAttribute('data-detail-id', String(n.id));
        var main = document.createElement('div'); main.className = 'hub-list-main';
        var nEl = document.createElement('span'); nEl.className = 'hub-list-name'; nEl.textContent = n.name;
        main.appendChild(nEl);
        if ((n.tipo || []).length || (n.projeto_ids || []).length) {
          var tagsRow = document.createElement('div'); tagsRow.className = 'not-list-tags';
          (n.tipo || []).forEach(function (t) {
            var tg = document.createElement('span'); tg.className = 'tag-tipo-mini'; tg.textContent = t;
            tg.style.setProperty('--dot-color', NOT_TIPO_COR[t] || 'var(--mute)');
            tagsRow.appendChild(tg);
          });
          (n.projeto_ids || []).forEach(function (pid) {
            var p = findProjetoById(pid);
            if (!p) return;
            var pg = document.createElement('span'); pg.className = 'tag-projeto-mini';
            pg.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
            tagsRow.appendChild(pg);
          });
          main.appendChild(tagsRow);
        }
        var snip = noteSnippet(n.conteudo_md);
        if (snip) {
          var snipEl = document.createElement('span'); snipEl.className = 'not-list-snippet'; snipEl.textContent = snip;
          main.appendChild(snipEl);
        }
        row.appendChild(main);
        if (n.data) { var d = document.createElement('span'); d.className = 'hub-list-date'; d.textContent = fmtDate(n.data); row.appendChild(d); }
        recentHost.appendChild(row);
      });
    }
  }

  /* ── Preview de Finanças: bento de ~5 cards, cada um com uma info
     recorrente que o autor confere com frequência (saldo dia a dia, estado
     do crédito — fatura que fecha agora + a projetada — e as últimas
     transações), não um card único resumindo tudo. ── */
  function renderFinancasPreview() {
    var elSaldo = $('fin-saldo'), elEnt = $('fin-entradas'), elSai = $('fin-saidas');
    var entradas = 0, saidasCaixa = 0, entradasRealizadas = 0;
    MROWS.forEach(function (m) {
      var v = num(m.valor), realizado = isRealizado(m);
      if (isEntrada(m)) { entradas += v; if (realizado) entradasRealizadas += v; }
      if (isSaidaCaixa(m) && realizado) saidasCaixa += v;
    });
    var saldo = (SALDO_ABERTURA || 0) + entradasRealizadas - saidasCaixa;
    elSaldo.textContent = brl.format(saldo);
    elSaldo.className = 'bento-big-val ' + (saldo >= 0 ? 'pos' : 'neg');
    elEnt.textContent = brl.format(entradas);
    elSai.textContent = brl.format(saidasCaixa);
    var nEnt = MROWS.filter(isEntrada).length, nSai = MROWS.filter(isSaidaCaixa).length;
    $('fin-entradas-sub').textContent = nEnt + (nEnt === 1 ? ' transação' : ' transações');
    $('fin-saidas-sub').textContent = nSai + (nSai === 1 ? ' transação' : ' transações');

    /* Linha (não barra) — é a info que o autor mais confere: o saldo em
       caixa dia a dia, mesmo gráfico de financas.js, versão compacta. */
    var canvas = $('fin-chart'), emptyEl = $('fin-chart-empty');
    if (finChart) { finChart.destroy(); finChart = null; }
    var abertura = SALDO_ABERTURA || 0;
    var map = {};
    MROWS.forEach(function (m) {
      if (!isRealizado(m)) return;
      var d = m.date, v = num(m.valor), delta = 0;
      if (isEntrada(m)) delta += v;
      if (isSaidaCaixa(m)) delta -= v;
      map[d] = (map[d] || 0) + delta;
    });
    var days = Object.keys(map).sort();
    var acc = abertura, labels = [], data = [];
    if (abertura !== 0) { labels.push('início'); data.push(round2(abertura)); }
    days.forEach(function (d) { acc += map[d]; labels.push(d.slice(8, 10)); data.push(round2(acc)); });

    if (!data.length || !window.Chart) {
      canvas.hidden = true; emptyEl.hidden = false;
    } else {
      canvas.hidden = false; emptyEl.hidden = true;
      finChart = new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: [{ data: data, borderColor: COR_SALDO, backgroundColor: 'rgba(91,141,239,0.14)', fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 12, pointBackgroundColor: COR_SALDO, borderWidth: 2 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          /* intersect:false + mode:'index' faz o hover valer pra coluna
             inteira do dia (qualquer altura do card), não só em cima do
             pixel exato da linha — sem isso, com pointRadius:0, o hover
             praticamente nunca dispara (mesmo ajuste do gráfico de fluxo
             em financas.js). */
          interaction: { mode: 'index', intersect: false, axis: 'x' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1b1f27', borderColor: '#262b34', borderWidth: 1, titleColor: '#e7e9ee', bodyColor: '#e7e9ee',
              titleFont: { family: "'JetBrains Mono', monospace", size: 10 }, bodyFont: { family: "'JetBrains Mono', monospace", size: 11 }, padding: 8,
              callbacks: {
                title: function (c) { var l = c[0].label; return l === 'início' ? 'saldo de abertura' : 'dia ' + l; },
                label: function (c) { return ' saldo: ' + brl.format(c.parsed.y); },
              },
            },
          },
          /* Eixo X visível só pelas linhas de grade (um traço fraco por dia)
             — sem números, pra não poluir um card pequeno; o dia exato já
             aparece no hover (ver title acima). */
          scales: {
            x: { display: true, grid: { display: true, color: 'rgba(255,255,255,0.06)', drawTicks: false }, ticks: { display: false }, border: { display: false } },
            y: { display: false },
          },
        },
      });
    }

    var host = $('fin-recent'); host.innerHTML = '';
    if (!MROWS.length) {
      var empty = document.createElement('div'); empty.className = 'hub-list-empty'; empty.textContent = 'sem transações neste mês';
      host.appendChild(empty);
    } else {
      /* Desempate por created_at (não por id — id é uuid aleatório,
         gen_random_uuid(), não tem ordem cronológica nenhuma) quando duas
         movimentações caem no mesmo dia: sem isso, a ordem entre elas vinha
         de qualquer jeito (a ordem em que a API devolveu), não da ordem
         real em que foram registradas. */
      MROWS.slice().sort(function (a, b) {
        var byDate = (b.date || '').localeCompare(a.date || '');
        if (byDate !== 0) return byDate;
        return (b.created_at || '').localeCompare(a.created_at || '');
      }).slice(0, 6).forEach(function (m) {
        var row = document.createElement('div'); row.className = 'hub-list-row';
        var d = document.createElement('span'); d.className = 'hub-list-date'; d.textContent = fmtDate(m.date);
        var main = document.createElement('div'); main.className = 'hub-list-main';
        var n = document.createElement('span'); n.className = 'hub-list-name'; n.textContent = m.name || '—';
        var tags = document.createElement('span'); tags.className = 'hub-list-tags';
        (m.tipo || []).forEach(function (t) {
          var tag = document.createElement('span'); tag.className = 'tag tag-' + tagClass(t); tag.textContent = t;
          tags.appendChild(tag);
        });
        main.appendChild(n); main.appendChild(tags);
        var v = document.createElement('span');
        var dir = isSaida(m) ? 'neg' : (isEntrada(m) ? 'pos' : '');
        var sign = isSaida(m) ? '− ' : (isEntrada(m) ? '+ ' : '');
        v.className = 'hub-list-val ' + dir; v.textContent = sign + brl.format(num(m.valor));
        row.appendChild(d); row.appendChild(main); row.appendChild(v);
        host.appendChild(row);
      });
    }

    renderFaturaCards();
  }

  /* ── Estado do crédito: fatura que fecha agora (projetada a partir do mês
     ANTERIOR, paga com o que já entrou este mês) + fatura projetada (a
     partir das compras em crédito deste mês, pro próximo ciclo). Versão
     resumida da lógica completa de financas.js — sem a cadeia de
     adiantamento entre meses, que é detalhe do módulo, não do glance do hub. ── */
  /* Garante que um mês (não necessariamente `t`/`pt`, já carregados no boot)
     esteja em cache — a cadeia recursiva de carryInto pode precisar de
     meses mais antigos. Cópia do padrão de ensureMonthRows em financas.js. */
  function ensureFinMonthRows(ym) {
    if (FIN_MONTH_CACHE[ym]) return Promise.resolve(FIN_MONTH_CACHE[ym]);
    return apiFinQuery(SESSION_PW, ym).then(function (j) {
      var rows = j.movimentacoes || [];
      FIN_MONTH_CACHE[ym] = rows;
      return rows;
    }).catch(function () { return null; });
  }

  /* Excedente que carrega da fatura que fecha EM `m` pra fatura seguinte —
     RECURSIVO, cópia exata de financas.js (ver o comentário lá pro porquê:
     sem a recursão, uma cadeia de 3+ meses de pagamento parcial escondia o
     adiantamento ao navegar direto pro mês final). */
  function carryInto(m) {
    var pm = prevMonth(m);
    return ensureFinMonthRows(m).then(function (rows) {
      if (!rows) return [];
      var pagamentosFatura = rows.filter(isPagamentoFatura);
      if (!pagamentosFatura.length) return [];
      var explicitos = pagamentosFatura.filter(isAdiantamentoExplicito);
      var normais = pagamentosFatura.filter(function (x) { return !isAdiantamentoExplicito(x); });
      if (!normais.length) return explicitos;
      return Promise.all([ensureFinMonthRows(pm), carryInto(pm)]).then(function (res) {
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

  /* ── Estado do crédito: fatura que fecha agora (projetada a partir do mês
     ANTERIOR, paga com o que já entrou este mês) + fatura projetada (a
     partir das compras em crédito deste mês, pro próximo ciclo). Mesma
     lógica de quitação/adiantamento de financas.js (carryInto +
     splitPagamentosFatura) — ver LIFEOS.md e FINANCAS.md. */
  function renderFaturaCards() {
    var t = todayYM(), pt = prevMonth(t);
    var elValA = $('fatura-atual-valor'), elStatusA = $('fatura-atual-status');
    var elValP = $('fatura-proj-valor'), elSubP = $('fatura-proj-sub');

    var pagamentosFaturaAtual = MROWS.filter(isPagamentoFatura);
    var explicitosAtual = pagamentosFaturaAtual.filter(isAdiantamentoExplicito);
    var normaisAtual = pagamentosFaturaAtual.filter(function (m) { return !isAdiantamentoExplicito(m); });

    Promise.all([ensureFinMonthRows(pt), carryInto(pt)]).then(function (res) {
      var pRows = res[0], advancedFromPt = res[1];
      if (!pRows) {
        elValA.textContent = '—';
        elStatusA.className = 'bento-sub';
        elStatusA.textContent = 'não foi possível carregar ' + monthLabel(pt).toLowerCase();
        return;
      }
      var proj = calcularProjecaoFatura(pRows, pt);
      var g = proj[t];
      var totalAtual = (g && g.rows.length) ? g.total : 0;
      var pagamentosFatura = normaisAtual.concat(advancedFromPt);
      var pago = pagamentosFatura.reduce(function (sum, m) { return sum + num(m.valor); }, 0);
      var split = splitPagamentosFatura(pagamentosFatura, totalAtual);
      var carryOut = split.adiantamento.concat(explicitosAtual);
      var excedente = round2(carryOut.reduce(function (sum, m) { return sum + num(m.valor); }, 0));
      var countAdiantamento = carryOut.length;

      if (!totalAtual) {
        elValA.textContent = '—';
        elStatusA.className = 'bento-sub';
        elStatusA.textContent = 'sem compras em crédito de ' + monthLabel(pt).toLowerCase();
      } else {
        var restante = round2(Math.max(0, totalAtual - pago));
        elValA.textContent = brl.format(totalAtual);
        if (!(pago > 0)) {
          elStatusA.className = 'bento-sub warn';
          elStatusA.textContent = 'em aberto';
        } else if (restante <= 0) {
          elStatusA.className = 'bento-sub pos';
          elStatusA.textContent = 'quitada ✓ · ' + vezes(split.atual.length) + (pago > totalAtual ? ' · excedente vira adiantamento' : '');
        } else {
          elStatusA.className = 'bento-sub warn';
          elStatusA.textContent = 'pago em ' + vezes(split.atual.length) + ' · falta ' + brl.format(restante);
        }
      }

      /* Fatura projetada: compras em crédito DESTE mês, mais a nota de
         adiantamento (se `t` gerou excedente pra ela) com o valor já
         descontado — mesma composição de renderFaturaAdiantamentoNote. */
      var projCur = calcularProjecaoFatura(MROWS, t);
      var destinos = Object.keys(projCur).sort();
      if (!destinos.length) {
        elValP.textContent = '—';
        elSubP.textContent = excedente > 0 ? ('adiantado em ' + vezes(countAdiantamento) + ': ' + brl.format(excedente)) : 'sem compras em crédito este mês';
      } else {
        var gp = projCur[destinos[0]];
        var valorAtual = excedente > 0 ? round2(Math.max(0, gp.total - excedente)) : gp.total;
        elValP.textContent = brl.format(valorAtual);
        var sub = monthLabel(destinos[0]) + ' · ' + gp.rows.length + (gp.rows.length === 1 ? ' compra' : ' compras');
        if (excedente > 0) sub += ' · adiantado em ' + vezes(countAdiantamento) + ': ' + brl.format(excedente);
        elSubP.textContent = sub;
      }
    });
  }

  /* ── Preview de Eventos: mini-calendário NAVEGÁVEL (ver §1 do LIFEOS.md —
     revertido: o autor quer poder navegar meses direto do hub, não só em
     /eventos) + linha do tempo recentes/próximos. Criar/excluir eventos
     continuam vivendo só em /eventos — o hub segue read-only. ── */
  function renderMiniCal() {
    var dowHost = $('mini-cal-dow'), gridHost = $('mini-cal'), labelEl = $('hub-cal-label');
    if (!gridHost) return;
    if (labelEl) labelEl.textContent = monthLabel(HUB_CAL_YM);
    if (dowHost && !dowHost.childElementCount) {
      ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(function (d) { var s = document.createElement('span'); s.textContent = d; dowHost.appendChild(s); });
    }
    var parts = HUB_CAL_YM.split('-'); var y = +parts[0], m = +parts[1];
    var firstDow = new Date(y, m - 1, 1).getDay();
    var totalDays = lastDayOfMonth(HUB_CAL_YM);
    var isRealCurrentMonth = HUB_CAL_YM === todayYM();
    var todayDate = new Date().getDate();

    /* byDay guarda a COR já resolvida (não o rótulo bruto) — modo eventos usa
       EVENTO_COR[tipo], modo tarefas usa TAR_STATUS_COR[status]; unifica o
       resto do render (loop de dots) sem precisar saber o modo de novo. */
    var byDay = {};
    if (CAL_MODE === 'eventos') {
      EVENTOS.forEach(function (e) {
        if (!e.date || e.date.slice(0, 7) !== HUB_CAL_YM) return;
        var day = parseInt(e.date.slice(8, 10), 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(EVENTO_COR[e.tipo] || 'var(--mute)');
      });
    } else {
      TAREFAS_ALL.forEach(function (t) {
        if (!t.data_entrega || t.data_entrega.slice(0, 7) !== HUB_CAL_YM) return;
        var day = parseInt(t.data_entrega.slice(8, 10), 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(TAR_STATUS_COR[t.status] || 'var(--mute)');
      });
    }

    gridHost.innerHTML = '';
    for (var i = 0; i < firstDow; i++) { var e0 = document.createElement('div'); e0.className = 'hub-mini-cal-cell is-empty'; gridHost.appendChild(e0); }
    for (var day = 1; day <= totalDays; day++) {
      var cell = document.createElement('div'); cell.className = 'hub-mini-cal-cell';
      cell.setAttribute('data-date', HUB_CAL_YM + '-' + String(day).padStart(2, '0'));
      if (isRealCurrentMonth && day === todayDate) cell.classList.add('is-today');
      var numEl = document.createElement('span'); numEl.textContent = day; cell.appendChild(numEl);
      if (byDay[day]) {
        var dots = document.createElement('span'); dots.className = 'hub-mini-cal-dots';
        byDay[day].slice(0, 3).forEach(function (cor) {
          var dot = document.createElement('span'); dot.className = 'hub-mini-cal-dot';
          dot.style.background = cor;
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
      }
      gridHost.appendChild(cell);
    }
  }

  /* Trava a altura do card da linha do tempo (#eventos-timeline) na altura
     JÁ RENDERIZADA do card do calendário ao lado — medida real, não CSS.
     Três variações em CSS puro (align-items:stretch cru, depois start,
     depois stretch+overflow:hidden no item do grid) foram tentadas antes
     dessa e nenhuma se sustentou nos dois modos do calendário ao mesmo
     tempo (Eventos, poucas linhas, vs. Tarefas, geralmente muitas) — o
     navegador nem sempre trata overflow-y:auto de um descendente como
     "não conta pra altura automática do ancestral", e isso varia com
     quanto conteúdo existe. Uma altura EXPLÍCITA (style.height) elimina
     essa ambiguidade: com o card não mais em "auto", o flex:1 +
     overflow-y:auto da .hub-list-scroll dentro dele funciona de forma
     totalmente previsível — comportamento básico de flexbox, sem a parte
     que vinha quebrando.

     NÃO é chamada de dentro de renderMiniCal() — já foi, e criava um bug
     de primeiro carregamento: .cal-legend (dentro de .evt-card-cal) é
     populado por renderLegend(), que roda DEPOIS de renderMiniCal() no
     boot e na troca de modo. Medir ali dentro pegava o calendário ANTES
     da legenda existir, aplicando uma altura menor que a final — corrigia
     sozinho na troca de modo seguinte porque a legenda da renderização
     ANTERIOR ainda estava lá na hora da nova medição. Por isso a chamada
     é explícita, sempre no fim de cada sequência de render que pode afetar
     .evt-card-cal (boot, troca de mês, troca de modo, CRUD de evento) —
     nunca embutida numa função que roda no MEIO dessa sequência. No mobile
     (.evt-bento vira 1 coluna, sem calendário ao lado pra igualar) a
     altura fixa é removida — cada card volta a ocupar a altura do próprio
     conteúdo. Também chamada no resize (ver init()), já que a altura das
     células do calendário depende da largura do card. */
  function syncEventTimelineHeight() {
    var calCard = document.querySelector('.evt-card-cal');
    var timelineCard = document.querySelector('.evt-card-timeline');
    if (!calCard || !timelineCard) return;
    if (window.matchMedia('(max-width: 780px)').matches) { timelineCard.style.height = ''; return; }
    timelineCard.style.height = calCard.offsetHeight + 'px';
  }

  /* Legenda: cor por tipo (eventos) ou por status (tarefas) — reconstrói a
     cada troca de CAL_MODE (ao contrário da versão anterior, que montava
     uma vez só; agora o conteúdo muda com o toggle). */
  function renderLegend() {
    var host = $('cal-legend');
    if (!host) return;
    host.innerHTML = '';
    var items = (CAL_MODE === 'eventos')
      ? TIPOS.map(function (tipo) { return { label: tipo, cor: EVENTO_COR[tipo] }; })
      : TAR_STATUS.map(function (status) { return { label: status, cor: TAR_STATUS_COR[status] }; });
    items.forEach(function (it) {
      var item = document.createElement('span'); item.className = 'cal-legend-item';
      var dot = document.createElement('span'); dot.className = 'cal-legend-dot'; dot.style.background = it.cor;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(it.label));
      host.appendChild(item);
    });
  }

  /* ── Modal · detalhes do dia (clique numa célula do mini-calendário) ──
     Modo eventos: dá pra ver E excluir (criar é pelo botão "Adicionar", ver
     openEventoModal) — o calendário é o único lugar do LifeOS pra CRUD de
     eventos. Modo tarefas: só LEITURA — tarefas exigem projeto obrigatório
     e o CRUD completo mora em tarefas.html, não faz sentido duplicar aqui
     (ver LIFEOS.md §1). Funciona pra qualquer dia do mês já carregado (em
     EVENTOS ou TAREFAS_ALL, dependendo do CAL_MODE). */
  function findProjetoById(id) {
    for (var i = 0; i < PROJETOS.length; i++) { if (PROJETOS[i].id === id) return PROJETOS[i]; }
    return null;
  }
  function addDetailField(body, label, value) {
    var f = document.createElement('div'); f.className = 'detail-field';
    var l = document.createElement('div'); l.className = 'detail-label'; l.textContent = label;
    var v = document.createElement('div'); v.className = 'detail-value'; v.textContent = value;
    f.appendChild(l); f.appendChild(v);
    body.appendChild(f);
  }
  /* Descrição da tarefa (markdown) — única .detail-value com innerHTML em
     vez de textContent aqui: o conteúdo é escrito só pela mesma pessoa
     autenticada pelo gate mestre (ver renderMarkdown), não dado de terceiro. */
  function addDetailMarkdownField(body, label, src) {
    var f = document.createElement('div'); f.className = 'detail-field';
    var l = document.createElement('div'); l.className = 'detail-label'; l.textContent = label;
    var v = document.createElement('div'); v.className = 'detail-value md-preview'; v.innerHTML = renderMarkdown(src);
    f.appendChild(l); f.appendChild(v);
    body.appendChild(f);
  }
  /* Modal de detalhe — abre ao clicar numa linha da linha do tempo ou do
     modal de dia. Existe só pra nunca esconder informação: as linhas de
     lista truncam com ellipsis (.hub-list-name/.hub-list-proj), aqui não
     trunca nada. */
  /* Bloqueio de scroll do body enquanto modal aberto — evita iOS Safari
     deslocar position:fixed e “sumir” o overlay em touch. */
  var SCROLL_LOCK_Y = 0;
  function syncModalScrollLock() {
    var open = $('day-modal').classList.contains('open') ||
      $('detail-modal').classList.contains('open') ||
      $('evento-modal').classList.contains('open') ||
      $('tarefa-modal').classList.contains('open') ||
      $('projeto-modal').classList.contains('open') ||
      $('projeto-detail-modal').classList.contains('open') ||
      $('manifestacao-modal').classList.contains('open');
    if (open) {
      if (document.body.classList.contains('modal-scroll-lock')) return;
      SCROLL_LOCK_Y = window.scrollY;
      document.body.classList.add('modal-scroll-lock');
      document.body.style.top = '-' + SCROLL_LOCK_Y + 'px';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else if (document.body.classList.contains('modal-scroll-lock')) {
      document.body.classList.remove('modal-scroll-lock');
      document.body.style.top = '';
      document.body.style.position = '';
      document.body.style.width = '';
      window.scrollTo(0, SCROLL_LOCK_Y);
    }
  }
  function openDetailModal(kind, obj) {
    var body = $('detail-modal-body'); body.innerHTML = '';
    $('detail-modal-title').textContent = obj.name || '—';
    var banner = $('detail-banner'), bannerIcon = $('detail-banner-icon');
    var actions = $('detail-modal-actions');
    var dateBadge = $('detail-banner-date'); dateBadge.hidden = true;
    if (kind === 'evento') {
      actions.hidden = true;
      $('detail-modal-fullscreen').hidden = true;
      CURRENT_DETAIL_TAREFA_ID = null; CURRENT_DETAIL_NOTA_ID = null;
      bannerIcon.innerHTML = '<i class="fad fa-calendar-alt"></i>';
      banner.style.setProperty('--pdet-accent', EVENTO_COR[obj.tipo] || 'var(--gold)');
      addDetailField(body, 'Data', fmtDate(obj.date));
      addDetailField(body, 'Tipo', obj.tipo || '—');
      var proj = findProjetoById(obj.projeto_id);
      if (proj) addDetailField(body, 'Projeto', (proj.emoji ? proj.emoji + ' ' : '') + proj.name);
    } else if (kind === 'nota') {
      /* Só leitura de atributos aqui — edição mora só em notas.html (ver
         LIFEOS.md §8), o footer mostra só "Tela cheia". Mesma estrutura
         visual de notas.html (4ª rodada, set/2026 — pedido explícito do
         o autor pras duas telas ficarem iguais): data no badge do banner,
         Tipo numa linha de tags, Projeto(s) noutra linha abaixo, divisória,
         depois o conteúdo — nunca mais label:valor pra nota. Sem
         --pdet-accent dinâmico: Tipo é multi-select, não dá pra mapear
         cor 1:1 (mesma decisão já tomada em notas.html). */
      actions.hidden = true;
      $('detail-modal-fullscreen').hidden = false;
      CURRENT_DETAIL_TAREFA_ID = null; CURRENT_DETAIL_NOTA_ID = obj.id;
      bannerIcon.innerHTML = '<i class="fad fa-book-open"></i>';
      banner.style.removeProperty('--pdet-accent');
      if (obj.data) { dateBadge.textContent = fmtDate(obj.data); dateBadge.hidden = false; }

      var meta = document.createElement('div'); meta.className = 'detail-meta';
      if (obj.tipo && obj.tipo.length) {
        var tipoRow = document.createElement('div'); tipoRow.className = 'detail-meta-row';
        obj.tipo.forEach(function (t) {
          var tg = document.createElement('span'); tg.className = 'tag-tipo-mini'; tg.textContent = t;
          tg.style.setProperty('--dot-color', NOT_TIPO_COR[t] || 'var(--mute)');
          tipoRow.appendChild(tg);
        });
        meta.appendChild(tipoRow);
      }
      if ((obj.projeto_ids || []).length) {
        var projRow = document.createElement('div'); projRow.className = 'detail-meta-row';
        obj.projeto_ids.forEach(function (pid) {
          var p = findProjetoById(pid);
          var pg = document.createElement('span'); pg.className = 'tag-projeto-mini';
          pg.textContent = p ? ((p.emoji ? p.emoji + ' ' : '') + p.name) : '?';
          projRow.appendChild(pg);
        });
        meta.appendChild(projRow);
      }
      if (meta.childNodes.length) body.appendChild(meta);

      var divider = document.createElement('div'); divider.className = 'detail-divider';
      body.appendChild(divider);

      var contentEl = document.createElement('div'); contentEl.className = 'detail-value md-preview';
      contentEl.innerHTML = renderMarkdown(obj.conteudo_md);
      body.appendChild(contentEl);
    } else {
      /* Editar/Excluir só aparecem pra tarefa — parte do CRUD completo do
         hub (exceção documentada em LIFEOS.md, set/2026). */
      actions.hidden = false;
      $('detail-modal-fullscreen').hidden = true;
      CURRENT_DETAIL_TAREFA_ID = obj.id; CURRENT_DETAIL_NOTA_ID = null;
      bannerIcon.innerHTML = '<i class="fad fa-tasks"></i>';
      banner.style.setProperty('--pdet-accent', TAR_STATUS_COR[obj.status] || 'var(--gold)');
      addDetailField(body, 'Status', obj.status || '—');
      if (obj.tipo && obj.tipo.length) addDetailField(body, 'Tipo', obj.tipo.join(', '));
      var proj2 = findProjetoById(obj.projeto_id);
      if (proj2) addDetailField(body, 'Projeto', (proj2.emoji ? proj2.emoji + ' ' : '') + proj2.name);
      if (obj.data_entrega) addDetailField(body, 'Entrega', fmtDate(obj.data_entrega));
      if (obj.descricao) addDetailMarkdownField(body, 'Descrição', obj.descricao);
    }
    $('detail-modal').classList.add('open');
    syncModalScrollLock();
  }
  function closeDetailModal() { $('detail-modal').classList.remove('open'); CURRENT_DETAIL_TAREFA_ID = null; CURRENT_DETAIL_NOTA_ID = null; syncModalScrollLock(); }
  function resolveDetailFromRow(row) {
    var kind = row.getAttribute('data-detail-kind');
    var id = row.getAttribute('data-detail-id');
    if (!kind || !id) return;
    if (kind === 'evento') {
      for (var i = 0; i < EVENTOS.length; i++) {
        if (String(EVENTOS[i].id) === id) { openDetailModal('evento', EVENTOS[i]); return; }
      }
    } else if (kind === 'tarefa') {
      for (var j = 0; j < TAREFAS_ALL.length; j++) {
        if (String(TAREFAS_ALL[j].id) === id) { openDetailModal('tarefa', TAREFAS_ALL[j]); return; }
      }
    } else if (kind === 'nota') {
      for (var k = 0; k < NOTAS_HUB.length; k++) {
        if (String(NOTAS_HUB[k].id) === id) { openDetailModal('nota', NOTAS_HUB[k]); return; }
      }
    }
  }
  function onHubListRowActivate(e) {
    var row = e.target.closest ? e.target.closest('.hub-list-row.is-clickable[data-detail-id]') : null;
    if (!row) return;
    if (e.target.closest && e.target.closest('.row-actions')) return;
    resolveDetailFromRow(row);
  }

  var CURRENT_DAY_MODAL_DATE = null; /* pra re-render depois de excluir sem fechar o modal */
  function openDayModal(dateStr) {
    CURRENT_DAY_MODAL_DATE = dateStr;
    var parts = dateStr.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var DOW_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    $('day-modal-title').textContent = DOW_FULL[d.getDay()] + ', ' + fmtDate(dateStr);
    var body = $('day-modal-body'); body.innerHTML = '';

    if (CAL_MODE === 'eventos') {
      var dayEvents = EVENTOS.filter(function (e) { return e.date === dateStr; })
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      if (!dayEvents.length) {
        var empty = document.createElement('div'); empty.className = 'hub-list-empty'; empty.textContent = 'nenhum evento nesse dia';
        body.appendChild(empty);
      } else {
        dayEvents.forEach(function (e) {
          var row = document.createElement('div'); row.className = 'hub-list-row is-clickable';
          var n = document.createElement('span'); n.className = 'hub-list-name'; n.textContent = e.name;
          var tag = document.createElement('span'); tag.className = 'hub-evt-tag'; tag.textContent = e.tipo;
          var cor = EVENTO_COR[e.tipo] || 'var(--mute)'; tag.style.color = cor; tag.style.borderColor = cor;
          var actions = document.createElement('span'); actions.className = 'row-actions';
          var delBtn = document.createElement('button');
          delBtn.type = 'button'; delBtn.className = 'row-action-btn row-action-danger';
          delBtn.setAttribute('data-action', 'delete-evento'); delBtn.setAttribute('data-id', e.id);
          delBtn.setAttribute('aria-label', 'Excluir evento');
          delBtn.innerHTML = '<i class="fad fa-trash"></i>';
          actions.appendChild(delBtn);
          row.setAttribute('data-detail-kind', 'evento');
          row.setAttribute('data-detail-id', String(e.id));
          row.appendChild(n); row.appendChild(tag); row.appendChild(actions);
          body.appendChild(row);
        });
      }
    } else {
      var dayTarefas = TAREFAS_ALL.filter(function (t) { return t.data_entrega === dateStr; })
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      if (!dayTarefas.length) {
        var emptyT = document.createElement('div'); emptyT.className = 'hub-list-empty'; emptyT.textContent = 'nenhuma tarefa com entrega nesse dia';
        body.appendChild(emptyT);
      } else {
        dayTarefas.forEach(function (t) {
          var row = document.createElement('div'); row.className = 'hub-list-row is-clickable';
          var main = document.createElement('div'); main.className = 'hub-list-main';
          var n = document.createElement('span'); n.className = 'hub-list-name'; n.textContent = t.name;
          main.appendChild(n);
          var proj = findProjetoById(t.projeto_id);
          if (proj) {
            var pspan = document.createElement('span'); pspan.className = 'hub-list-proj';
            pspan.textContent = (proj.emoji ? proj.emoji + ' ' : '') + proj.name;
            main.appendChild(pspan);
          }
          var tag = document.createElement('span'); tag.className = 'hub-evt-tag'; tag.textContent = t.status;
          var cor = TAR_STATUS_COR[t.status] || 'var(--mute)'; tag.style.color = cor; tag.style.borderColor = cor;
          row.setAttribute('data-detail-kind', 'tarefa');
          row.setAttribute('data-detail-id', String(t.id));
          row.appendChild(main); row.appendChild(tag);
          body.appendChild(row);
        });
      }
    }
    $('day-modal').classList.add('open');
    syncModalScrollLock();
  }
  function closeDayModal() { $('day-modal').classList.remove('open'); CURRENT_DAY_MODAL_DATE = null; syncModalScrollLock(); }

  /* Excluir (confirmação inline de dois cliques, cópia isolada do mesmo
     padrão de financas.js/eventos.js — ver LIFEOS.md §2/§6). */
  var DELETE_PENDING = null;
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
  function confirmDelete(btn, key, run, onDone) {
    if (DELETE_PENDING && DELETE_PENDING.key === key && DELETE_PENDING.btn === btn) {
      clearTimeout(DELETE_PENDING.timeoutId);
      DELETE_PENDING = null;
      btn.disabled = true;
      btn.innerHTML = '<i class="fad fa-spinner-third fa-spin"></i>';
      run().then(function () { onDone(); }).catch(function (err) {
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
    DELETE_PENDING = { key: key, btn: btn, timeoutId: setTimeout(resetDeletePending, 3000) };
  }
  function onDeleteEvento(btn, id) {
    confirmDelete(btn, 'evt:' + id, function () { return apiEventosDelete(SESSION_PW, id); }, function () {
      for (var i = 0; i < EVENTOS.length; i++) { if (EVENTOS[i].id === id) { EVENTOS.splice(i, 1); break; } }
      writeHubCache();
      renderMiniCal();
      renderEventosTimeline();
      syncEventTimelineHeight();
      if (CURRENT_DAY_MODAL_DATE) openDayModal(CURRENT_DAY_MODAL_DATE);
    });
  }

  /* ── Modal · novo evento (botão "Adicionar" do card de Calendário) ── */
  /* Chips clicáveis pro tipo (em vez de <select>) — clicar pra marcar é mais
     direto que abrir um dropdown. A cor de cada chip é a MESMA de
     EVENTO_COR, guardada em --opt-color pra a borda acender quando
     selecionado (ver CSS .evento-tipo-opt.is-selected).
  
     RECONSTRÓI a cada chamada, de propósito. Antes montava uma vez só, e
     como `init()` roda ANTES de `carregarVocab`, um tipo de evento criado
     na tela de Tags nunca aparecia aqui — o cadastro ficava incompleto.
     Agora `carregarVocab` chama isto de novo quando o vocabulário chega. */
  function renderEventoTipoPicker() {
    var host = $('evento-tipo-picker');
    if (!host) return;
    host.innerHTML = '';
    TIPOS.forEach(function (tipo) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'evento-tipo-opt'; btn.setAttribute('data-tipo', tipo);
      btn.style.setProperty('--opt-color', EVENTO_COR[tipo] || 'var(--gold)');
      var dot = document.createElement('span'); dot.className = 'evento-tipo-opt-dot';
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(tipo));
      host.appendChild(btn);
    });
    /* O valor pode ter ficado órfão (tipo renomeado ou apagado em Tags) —
       cai no primeiro disponível em vez de deixar o modal sem seleção. */
    var atual = $('evento-tipo').value;
    setEventoTipo(TIPOS.indexOf(atual) !== -1 ? atual : (TIPOS[0] || ''));
  }
  function setEventoTipo(tipo) {
    $('evento-tipo').value = tipo;
    var btns = document.querySelectorAll('.evento-tipo-opt');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-selected', btns[i].getAttribute('data-tipo') === tipo);
    $('evento-banner').style.setProperty('--pdet-accent', EVENTO_COR[tipo] || 'var(--gold)');
  }

  /* Projeto é OPCIONAL num evento (diferente de Tarefas, onde é
     obrigatório — ver LIFEOS.md). "Nenhum" é sempre a primeira opção e o
     default; PROJETOS já vem carregado do boot (apiProjetosQuery).
     Só projetos "Em Progresso" entram — mesmo filtro e mesma razão do
     picker de Tarefas (buildProjetoChipPicker, acima): não faz sentido
     vincular a um projeto Pausado/Feito/Não Iniciado. Sem a exceção do
     "projeto atual" que existe lá — eventos não têm edição (só create/
     delete, ver LIFEOS.md §6.1), então nunca há uma seleção prévia a
     preservar. */
  function renderEventoProjetoPicker() {
    var host = $('evento-projeto-picker');
    if (!host) return;
    host.innerHTML = '';
    var nenhum = document.createElement('button');
    nenhum.type = 'button'; nenhum.className = 'evento-projeto-opt'; nenhum.setAttribute('data-id', '');
    nenhum.textContent = 'Nenhum';
    host.appendChild(nenhum);
    PROJETOS.filter(function (p) { return p.status === 'Em Progresso'; }).forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'evento-projeto-opt'; btn.setAttribute('data-id', p.id);
      btn.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
      host.appendChild(btn);
    });
  }
  function setEventoProjeto(id) {
    $('evento-projeto-id').value = id || '';
    var btns = document.querySelectorAll('.evento-projeto-opt');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-selected', btns[i].getAttribute('data-id') === (id || ''));
  }

  function openEventoModal() {
    if ($('day-modal').classList.contains('open')) closeDayModal();
    $('evento-nome').value = '';
    $('evento-date').value = todayISO();
    setEventoTipo('vida');
    setEventoProjeto('');
    $('evento-error').textContent = '';
    setEventoSaving(false);
    $('evento-modal').classList.add('open');
    syncModalScrollLock();
    var ni = $('evento-nome'); if (ni) ni.focus();
  }
  function closeEventoModal() { $('evento-modal').classList.remove('open'); syncModalScrollLock(); }
  function setEventoSaving(on) { $('evento-save').disabled = on; $('evento-save').textContent = on ? 'Salvando…' : 'Salvar'; }
  function onEventoSubmit(e) {
    e.preventDefault();
    var nome = $('evento-nome').value.trim();
    var d = $('evento-date').value;
    var tipo = $('evento-tipo').value;
    var projeto_id = $('evento-projeto-id').value || null;
    if (!nome) { $('evento-error').textContent = 'nome obrigatório'; return; }
    if (!d) { $('evento-error').textContent = 'data inválida'; return; }
    setEventoSaving(true);
    $('evento-error').textContent = '';
    apiEventosCreate(SESSION_PW, { name: nome, date: d, tipo: tipo, projeto_id: projeto_id }).then(function (j) {
      EVENTOS.push(j.evento);
      closeEventoModal();
      /* o mês do evento criado pode estar fora da janela já carregada —
         marca como carregado (já temos ele em memória; não precisa refetch)
         e navega o calendário até lá, pra quem cria já ver o resultado. */
      var evYm = j.evento.date.slice(0, 7);
      HUB_EVENTOS_LOADED[evYm] = true;
      HUB_CAL_YM = evYm;
      writeHubCache();
      renderMiniCal();
      renderEventosTimeline();
      syncEventTimelineHeight();
    }).catch(function (err) {
      setEventoSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('evento-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* Busca sob demanda (mesmo padrão de eventos.js) — o load inicial já
     cobre uma janela de 4 meses; navegar pra fora dela busca só aquele mês
     e mescla em EVENTOS (dedup por id). Falha silenciosa: nunca trava a
     navegação. */
  function ensureHubCalMonth(ym) {
    if (HUB_EVENTOS_LOADED[ym]) return Promise.resolve();
    var from = ym + '-01', to = ym + '-' + String(lastDayOfMonth(ym)).padStart(2, '0');
    return apiEventosQuery(SESSION_PW, from, to).then(function (j) {
      HUB_EVENTOS_LOADED[ym] = true;
      (j.eventos || []).forEach(function (e) { if (!EVENTOS.some(function (x) { return x.id === e.id; })) EVENTOS.push(e); });
    }).catch(function () { /* mês fica vazio; não bloqueia navegação */ });
  }
  function goHubCalMonth(delta) {
    HUB_CAL_YM = delta > 0 ? nextMonth(HUB_CAL_YM) : prevMonth(HUB_CAL_YM);
    renderMiniCal();
    syncEventTimelineHeight();
    ensureHubCalMonth(HUB_CAL_YM).then(function () { renderMiniCal(); syncEventTimelineHeight(); });
  }

  /* Troca o que o card de Calendário exibe (dots, legenda, linha do tempo,
     modal do dia) — nunca o que "Adicionar" faz por escrita real: em modo
     eventos ele continua abrindo o modal de criação; em modo tarefas, como
     toda tarefa exige projeto (obrigatório) e o CRUD mora só em
     tarefas.html, o botão vira um link pra lá em vez de tentar duplicar o
     formulário aqui (ver LIFEOS.md §1). */
  function setCalMode(mode) {
    if (mode === CAL_MODE) return;
    CAL_MODE = mode;
    var btns = document.querySelectorAll('#cal-mode-toggle .tar-chart-toggle-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-active', btns[i].getAttribute('data-mode') === mode);
    var addBtn = $('add-evento-btn');
    if (mode === 'eventos') {
      addBtn.innerHTML = 'Adicionar <i class="fad fa-plus"></i>';
      addBtn.setAttribute('aria-label', 'Novo evento');
    } else {
      addBtn.innerHTML = 'Abrir Tarefas <i class="fad fa-arrow-right"></i>';
      addBtn.setAttribute('aria-label', 'Abrir Tarefas');
    }
    renderMiniCal();
    renderLegend();
    renderEventosTimeline();
    syncEventTimelineHeight();
  }
  function onAddClick() {
    if (CAL_MODE === 'tarefas') { window.location.href = 'tarefas.html'; return; }
    openEventoModal();
  }

  /* Linha do tempo do card de Calendário — mostra Eventos ou Tarefas (por
     data_entrega) dependendo de CAL_MODE. Nome da função ficou de eventos
     por histórico, mas serve os dois modos agora. */
  function renderEventosTimeline() {
    var host = $('eventos-timeline');
    if (!host) return;
    host.innerHTML = '';
    var today = todayISO();
    var source, getDate, buildRow;

    if (CAL_MODE === 'eventos') {
      source = EVENTOS; getDate = function (e) { return e.date; };
      buildRow = function (ev, isPast) {
        var r = document.createElement('div'); r.className = 'hub-list-row is-clickable' + (isPast ? ' is-past' : '');
        var d = document.createElement('span'); d.className = 'hub-list-date'; d.textContent = fmtDate(ev.date);
        var main = document.createElement('div'); main.className = 'hub-list-main';
        var n = document.createElement('span'); n.className = 'hub-list-name'; n.textContent = ev.name;
        main.appendChild(n);
        var proj = findProjetoById(ev.projeto_id);
        if (proj) {
          var pspan = document.createElement('span'); pspan.className = 'hub-list-proj';
          pspan.textContent = (proj.emoji ? proj.emoji + ' ' : '') + proj.name;
          main.appendChild(pspan);
        }
        var tag = document.createElement('span'); tag.className = 'hub-evt-tag'; tag.textContent = ev.tipo;
        var cor = EVENTO_COR[ev.tipo] || 'var(--mute)'; tag.style.color = cor; tag.style.borderColor = cor;
        r.setAttribute('data-detail-kind', 'evento');
        r.setAttribute('data-detail-id', String(ev.id));
        r.appendChild(d); r.appendChild(main); r.appendChild(tag);
        return r;
      };
    } else {
      source = TAREFAS_ALL.filter(function (t) { return t.data_entrega; }); getDate = function (t) { return t.data_entrega; };
      buildRow = function (t, isPast) {
        var r = document.createElement('div'); r.className = 'hub-list-row is-clickable' + (isPast ? ' is-past' : '');
        var d = document.createElement('span'); d.className = 'hub-list-date'; d.textContent = fmtDate(t.data_entrega);
        var main = document.createElement('div'); main.className = 'hub-list-main';
        var n = document.createElement('span'); n.className = 'hub-list-name'; n.textContent = t.name;
        main.appendChild(n);
        var proj = findProjetoById(t.projeto_id);
        if (proj) {
          var pspan = document.createElement('span'); pspan.className = 'hub-list-proj';
          pspan.textContent = (proj.emoji ? proj.emoji + ' ' : '') + proj.name;
          main.appendChild(pspan);
        }
        var tag = document.createElement('span'); tag.className = 'hub-evt-tag'; tag.textContent = t.status;
        var cor = TAR_STATUS_COR[t.status] || 'var(--mute)'; tag.style.color = cor; tag.style.borderColor = cor;
        r.setAttribute('data-detail-kind', 'tarefa');
        r.setAttribute('data-detail-id', String(t.id));
        r.appendChild(d); r.appendChild(main); r.appendChild(tag);
        return r;
      };
    }

    /* Corte assimétrico, de propósito:
       - PASSADOS: no máximo 3, e são os 3 MAIS RECENTES (slice(-3) no array
         crescente). O que já passou serve só de contexto imediato antes do
         divisor "hoje" — histórico antigo não tem por que ocupar o card, e
         é pra isso que existe o /tarefas.
       - FUTUROS: todos entram no DOM, sem corte. O card mostra ~5 deles e o
         resto é alcançado rolando (ver .hub-list-scroll no lifeos.html).
       Já foi 3+5 com corte nos dois lados (um 9º item não aparecia em lugar
       nenhum) e já foi sem corte nenhum (enchia de passado antigo). Este é o
       meio-termo: limita o que é contexto, preserva o que é agenda. */
    var PAST_MAX = 3;
    var past = source.filter(function (x) { return getDate(x) < today; }).sort(function (a, b) { return getDate(a).localeCompare(getDate(b)); }).slice(-PAST_MAX);
    var future = source.filter(function (x) { return getDate(x) >= today; }).sort(function (a, b) { return getDate(a).localeCompare(getDate(b)); });
    if (!past.length && !future.length) {
      var empty = document.createElement('div'); empty.className = 'hub-list-empty';
      empty.textContent = CAL_MODE === 'eventos' ? 'nenhum evento por perto' : 'nenhuma tarefa com entrega por perto';
      host.appendChild(empty);
      return;
    }
    /* A última linha ANTES do divisor "hoje" não leva o filete inferior —
       o próprio divisor já cumpre esse papel, dois seguidos ficaria redundante. */
    past.forEach(function (x, i) {
      var r = buildRow(x, true);
      if (i === past.length - 1) r.classList.add('no-divider');
      host.appendChild(r);
    });
    var divider = document.createElement('div'); divider.className = 'hub-timeline-divider';
    var divLabel = document.createElement('span'); divLabel.textContent = 'hoje'; divider.appendChild(divLabel);
    host.appendChild(divider);
    future.forEach(function (x) { host.appendChild(buildRow(x, false)); });
  }

  /* ── Preview de Tarefas: read-only (padrão Finanças — "Abrir" leva pra
     tarefas.html, escrita só lá; sem criar/editar/mover cards aqui).
     Contagem por status + mini-kanban de 3 colunas filtrável por projeto
     (select) — mesmas 3 colunas do kanban de verdade (`STATUS_TAREFA` em
     tarefas.js, cópia isolada ver LIFEOS.md §2). Sem gráficos — removidos
     por decisão do autor (achou desnecessários). ── */
  var TAR_PROJETO_FILTRO = '';  /* '' = todos os projetos */

  function renderTarStatusCounts() {
    var elNao = $('tar-count-nao-iniciado'), elAnd = $('tar-count-em-andamento'), elFeito = $('tar-count-feito');
    if (!elNao || !elAnd || !elFeito) return;
    elNao.textContent = TAREFAS_ALL.filter(function (t) { return t.status === 'Não Iniciado'; }).length;
    elAnd.textContent = TAREFAS_ALL.filter(function (t) { return t.status === 'Em Andamento'; }).length;
    elFeito.textContent = TAREFAS_ALL.filter(function (t) { return t.status === statusConcluido(TAR_STATUS); }).length;
  }

  function renderProjetoSelect() {
    var sel = $('tar-projeto-select');
    if (!sel) return;
    sel.innerHTML = '';
    var todos = document.createElement('option'); todos.value = ''; todos.textContent = 'Todos os projetos';
    sel.appendChild(todos);
    PROJETOS.forEach(function (p) {
      var opt = document.createElement('option'); opt.value = p.id;
      opt.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
      sel.appendChild(opt);
    });
    sel.value = TAR_PROJETO_FILTRO;
  }

  function renderTarMiniKanban() {
    var board = $('tar-mini-board');
    if (!board) return;
    board.innerHTML = '';
    var rows = TAR_PROJETO_FILTRO ? TAREFAS_ALL.filter(function (t) { return t.projeto_id === TAR_PROJETO_FILTRO; }) : TAREFAS_ALL;
    TAR_STATUS.forEach(function (status) {
      var col = document.createElement('div'); col.className = 'tar-mini-col'; col.setAttribute('data-status', status);
      var head = document.createElement('div'); head.className = 'tar-mini-col-head';
      var title = document.createElement('span'); title.className = 'tar-mini-col-title'; title.textContent = status;
      var rowsForStatus = rows.filter(function (t) { return t.status === status; });
      /* "Feito" ordena pela conclusão mais recente primeiro (updated_at
         desc) — sem isso, tarefa concluída há meses ficava misturada com a
         concluída ontem, sem critério nenhum de relevância. Nas outras
         colunas, o que importa é o que precisa ser feito primeiro: tarefa
         COM data de entrega vem antes de tarefa SEM data, e entre as que
         têm data, a mais próxima de hoje primeiro. Sem data, mantém a
         ordem que já vinha da API (created_at asc) — sort é estável, um
         comparator que só decide "com data < sem data" preserva a ordem
         relativa dentro de cada grupo. Importa aqui mais do que na tabela:
         é essa ordem que decide quais 6 aparecem antes do corte abaixo. */
      var statusFinal = statusConcluido(TAR_STATUS);
      if (status === statusFinal) {
        rowsForStatus = rowsForStatus.slice().sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });
      } else {
        rowsForStatus = rowsForStatus.slice().sort(function (a, b) {
          var ad = !!a.data_entrega, bd = !!b.data_entrega;
          if (ad && bd) return a.data_entrega.localeCompare(b.data_entrega);
          if (ad !== bd) return ad ? -1 : 1;
          return 0;
        });
      }
      var count = document.createElement('span'); count.className = 'tar-mini-col-count'; count.textContent = rowsForStatus.length;
      head.appendChild(title); head.appendChild(count); col.appendChild(head);

      var list = document.createElement('div'); list.className = 'tar-mini-list';
      if (!rowsForStatus.length) {
        var empty = document.createElement('div'); empty.className = 'tar-mini-empty'; empty.textContent = '—';
        list.appendChild(empty);
      } else {
        rowsForStatus.slice(0, 6).forEach(function (t) {
          var card = document.createElement('div'); card.className = 'tar-mini-card';
          card.setAttribute('data-id', String(t.id));
          /* draggable só entra em desktop — ver IS_DESKTOP; em touch o card
             continua clicável (abre o modal de detalhe), só não arrastável. */
          if (IS_DESKTOP) { card.classList.add('is-draggable'); card.setAttribute('draggable', 'true'); }
          var nameEl = document.createElement('span'); nameEl.textContent = t.name;
          card.appendChild(nameEl);
          /* Projeto aparece sempre, mesmo com um projeto específico
             filtrado no select — o filtro só recorta QUAIS tarefas
             aparecem, não é motivo pra esconder a informação de qual
             projeto é de cada uma. */
          var proj = null;
          for (var i = 0; i < PROJETOS.length; i++) { if (PROJETOS[i].id === t.projeto_id) { proj = PROJETOS[i]; break; } }
          if (proj) {
            var pspan = document.createElement('span'); pspan.className = 'tar-mini-card-proj';
            pspan.textContent = (proj.emoji ? proj.emoji + ' ' : '') + proj.name;
            card.appendChild(pspan);
          }
          /* Linha inferior: tags de tipo à esquerda, data no canto direito
             (.tar-mini-card-data tem margin-left:auto dentro do flex de
             .tar-mini-card-meta) — antes a data vinha numa linha própria à
             esquerda, sem os tipos aparecerem no card nenhuma vez. */
          if ((t.tipo && t.tipo.length) || t.data_entrega) {
            var meta = document.createElement('div'); meta.className = 'tar-mini-card-meta';
            (t.tipo || []).slice(0, 2).forEach(function (tp) {
              var tag = document.createElement('span'); tag.className = 'tar-mini-card-tipo'; tag.textContent = tp;
              meta.appendChild(tag);
            });
            if (t.data_entrega) {
              var overdue = t.status !== statusConcluido(TAR_STATUS) && t.data_entrega < todayISO();
              var dspan = document.createElement('span'); dspan.className = 'tar-mini-card-data' + (overdue ? ' is-overdue' : '');
              dspan.textContent = fmtDate(t.data_entrega);
              meta.appendChild(dspan);
            }
            card.appendChild(meta);
          }
          list.appendChild(card);
        });
        if (rowsForStatus.length > 6) {
          var more = document.createElement('div'); more.className = 'tar-mini-empty'; more.textContent = '+ ' + (rowsForStatus.length - 6);
          list.appendChild(more);
        }
      }
      col.appendChild(list);
      board.appendChild(col);
    });
  }

  /* Arrastar um card do mini-kanban pra outra coluna muda o status — única
     escrita de Tarefas permitida no hub (ver LIFEOS.md §3.2/§9), só
     desktop (IS_DESKTOP controla se o card nasce draggable). Otimista:
     aplica na UI no drop, reverte se a API falhar. Se o calendário estiver
     em modo Tarefas, a cor do dot/legenda também depende do status —
     re-renderiza junto pra não ficar com um dot desatualizado. */
  function renderCalIfTarefasMode() {
    if (CAL_MODE === 'tarefas') { renderMiniCal(); renderLegend(); renderEventosTimeline(); syncEventTimelineHeight(); }
  }
  function onDropTarefaStatus(id, newStatus) {
    var t = null;
    for (var i = 0; i < TAREFAS_ALL.length; i++) { if (String(TAREFAS_ALL[i].id) === id) { t = TAREFAS_ALL[i]; break; } }
    if (!t || t.status === newStatus) return;
    var prevStatus = t.status;
    t.status = newStatus;
    renderTarStatusCounts(); renderTarMiniKanban(); renderCalIfTarefasMode();
    apiTarefasUpdate(SESSION_PW, id, { status: newStatus }).then(function (j) {
      var saved = j.tarefa;
      for (var k = 0; k < TAREFAS_ALL.length; k++) { if (String(TAREFAS_ALL[k].id) === String(saved.id)) { TAREFAS_ALL[k] = saved; break; } }
      writeHubCache();
      renderTarStatusCounts(); renderTarMiniKanban(); renderCalIfTarefasMode();
    }).catch(function (err) {
      t.status = prevStatus;
      renderTarStatusCounts(); renderTarMiniKanban(); renderCalIfTarefasMode();
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao mover tarefa — ' + ((err && err.detail) || 'tente de novo'));
    });
  }

  function renderTarefasPreview() {
    renderTarStatusCounts();
    renderProjetoSelect();
    renderTarMiniKanban();
  }

  /* ── #tarefa-modal · criar/editar direto pelo hub ────────────────────
     Exceção documentada em LIFEOS.md (set/2026, decisão explícita do autor):
     CRUD completo de Tarefas passa a existir também aqui, além de
     tarefas.html. Um único modal serve os dois modos — EDIT_TAREFA_ID null
     = criar (mesmo padrão de openTarefaModal em tarefas.js). */
  function openTarefaModal(id) {
    EDIT_TAREFA_ID = id || null;
    var t = null;
    if (id) { for (var i = 0; i < TAREFAS_ALL.length; i++) { if (String(TAREFAS_ALL[i].id) === String(id)) { t = TAREFAS_ALL[i]; break; } } }
    buildProjetoChipPicker(t ? t.projeto_id : null);
    $('tarefa-modal-title').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
    $('tarefa-nome').value = t ? t.name : '';
    var tarefaStatusInicial = t ? t.status : 'Não Iniciado';
    setSingleChip('tarefa-status-picker', 'tarefa-status', tarefaStatusInicial);
    $('tarefa-banner').style.setProperty('--pdet-accent', TAR_STATUS_COR[tarefaStatusInicial] || 'var(--gold)');
    TAREFA_TIPO_SEL = t ? (t.tipo || []).slice() : [];
    setMultiChips('tarefa-tipo-picker', TAREFA_TIPO_SEL);
    /* Criar: pré-seleciona o projeto do filtro do mini-kanban, se houver um
       específico escolhido E ele estiver Em Progresso (só esses aparecem
       como chip, ver buildProjetoChipPicker — um default fora dessa lista
       preencheria o hidden input sem nenhum chip marcado); senão o primeiro
       projeto Em Progresso. */
    var projetosEmProgresso = PROJETOS.filter(function (p) { return p.status === 'Em Progresso'; });
    var filtroValido = TAR_PROJETO_FILTRO && projetosEmProgresso.some(function (p) { return p.id === TAR_PROJETO_FILTRO; });
    var defaultProjeto = filtroValido ? TAR_PROJETO_FILTRO : (projetosEmProgresso[0] ? projetosEmProgresso[0].id : '');
    setSingleChip('tarefa-projeto-picker', 'tarefa-projeto-id', t ? t.projeto_id : defaultProjeto);
    $('tarefa-data-entrega').value = (t && t.data_entrega) ? t.data_entrega : '';
    $('tarefa-descricao').value = (t && t.descricao) ? t.descricao : '';
    setDescricaoMode('Editar');
    $('tarefa-error').textContent = '';
    setTarefaSaving(false);
    $('tarefa-modal').classList.add('open');
    syncModalScrollLock();
    if (!t) { var ni = $('tarefa-nome'); if (ni) ni.focus(); }
  }
  function closeTarefaModal() { $('tarefa-modal').classList.remove('open'); EDIT_TAREFA_ID = null; syncModalScrollLock(); }
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

    /* Guarda ANTES de fechar o modal — mesmo bug de closeProjetoModal:
       closeTarefaModal() zera EDIT_TAREFA_ID, então checá-lo depois sempre
       lia null e caía no ramo de criar, duplicando a linha. */
    var wasEditing = EDIT_TAREFA_ID;
    req.then(function (j) {
      var saved = j.tarefa;
      closeTarefaModal();
      if (wasEditing) {
        for (var i = 0; i < TAREFAS_ALL.length; i++) { if (String(TAREFAS_ALL[i].id) === String(saved.id)) { TAREFAS_ALL[i] = saved; break; } }
      } else {
        TAREFAS_ALL.push(saved);
      }
      writeHubCache();
      renderTarStatusCounts(); renderTarMiniKanban(); renderCalIfTarefasMode();
    }).catch(function (err) {
      setTarefaSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('tarefa-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* Excluir tarefa a partir do detail-modal — mesma confirmação inline de
     dois cliques (confirmDelete/resetDeletePending) já usada pra eventos
     nesse arquivo, só com uma `key` diferente (ver LIFEOS.md §7). */
  function onDeleteTarefaClick(btn, id) {
    confirmDelete(btn, 'tarefa:' + id, function () { return apiTarefasDelete(SESSION_PW, id); }, function () {
      for (var i = 0; i < TAREFAS_ALL.length; i++) { if (String(TAREFAS_ALL[i].id) === String(id)) { TAREFAS_ALL.splice(i, 1); break; } }
      writeHubCache();
      closeDetailModal();
      renderTarStatusCounts(); renderTarMiniKanban(); renderCalIfTarefasMode();
    });
  }

  /* ── Projetos: tabela + CRUD completo direto no hub ──────────────────
     Movido de tarefas.js em set/2026 (ver LIFEOS.md, decisão explícita do
     o autor de centralizar a gestão de projetos na tela principal). ── */
  /* Filtro por status — "Em Progresso" como default (o que o autor mais quer
     ver de cara), não persistido entre visitas (mesmo padrão de
     TAR_PROJETO_FILTRO, só estado de sessão). */

  function renderProjStatusFilter() {
    var sel = $('proj-status-filter');
    if (!sel) return;
    /* Reconstrói sempre: STATUS_PROJETO pode ter mudado na tela de Tags. */
    sel.innerHTML = '';
    var allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'Todos os status';
    sel.appendChild(allOpt);
    STATUS_PROJETO.forEach(function (s) {
      var opt = document.createElement('option'); opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    });
    sel.value = PROJ_STATUS_FILTRO;
  }

  function renderProjetosTable() {
    var tbody = $('proj-table-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    var lista = PROJ_STATUS_FILTRO ? PROJETOS.filter(function (p) { return p.status === PROJ_STATUS_FILTRO; }) : PROJETOS;
    if (!PROJETOS.length) {
      var trE = document.createElement('tr');
      var tdE = document.createElement('td'); tdE.colSpan = 5; tdE.className = 'proj-table-empty';
      tdE.textContent = 'nenhum projeto ainda — clique em "Novo projeto" pra criar o primeiro';
      trE.appendChild(tdE); tbody.appendChild(trE);
      return;
    }
    if (!lista.length) {
      var trF = document.createElement('tr');
      var tdF = document.createElement('td'); tdF.colSpan = 5; tdF.className = 'proj-table-empty';
      tdF.textContent = 'nenhum projeto com status "' + PROJ_STATUS_FILTRO + '"';
      trF.appendChild(tdF); tbody.appendChild(trF);
      return;
    }
    lista.forEach(function (p) {
      var row = document.createElement('tr');
      row.setAttribute('data-projeto-id', p.id); /* linha inteira abre o detalhe — ver openProjetoDetail */

      var tdName = document.createElement('td');
      var nameCell = document.createElement('div'); nameCell.className = 'proj-name-cell';
      var avatar = document.createElement('div'); avatar.className = 'proj-avatar'; avatar.textContent = p.emoji || '📁';
      var nameSpan = document.createElement('span'); nameSpan.className = 'proj-name'; nameSpan.textContent = p.name;
      nameCell.appendChild(avatar); nameCell.appendChild(nameSpan);
      tdName.appendChild(nameCell);

      var tdStatus = document.createElement('td');
      var statusPill = document.createElement('span'); statusPill.className = 'proj-status-pill';
      var dot = document.createElement('span'); dot.className = 'proj-status-dot';
      dot.style.background = PROJETO_STATUS_COR[p.status] || 'var(--mute)';
      statusPill.appendChild(dot);
      statusPill.appendChild(document.createTextNode(p.status || '—'));
      tdStatus.appendChild(statusPill);

      var tdTags = document.createElement('td');
      var tagsWrap = document.createElement('div'); tagsWrap.className = 'proj-tags';
      (p.tags || []).forEach(function (tg) {
        var tag = document.createElement('span'); tag.className = 'proj-tag'; tag.textContent = tg;
        tagsWrap.appendChild(tag);
      });
      tdTags.appendChild(tagsWrap);

      /* Progresso — calculado sobre TAREFAS_ALL (já carregado no boot), não
         precisa de fetch extra por projeto. */
      var tdProg = document.createElement('td'); tdProg.className = 'proj-progress-cell';
      var tarefasProjeto = TAREFAS_ALL.filter(function (t) { return t.projeto_id === p.id; });
      var total = tarefasProjeto.length;
      var feitas = tarefasProjeto.filter(function (t) { return t.status === statusConcluido(TAR_STATUS); }).length;
      var pct = total ? Math.round((feitas / total) * 100) : 0;
      var progLabel = document.createElement('div'); progLabel.className = 'proj-progress-label';
      progLabel.textContent = total ? (feitas + '/' + total + ' tarefas') : 'sem tarefas';
      var progBar = document.createElement('div'); progBar.className = 'proj-progress-bar';
      var progFill = document.createElement('div'); progFill.className = 'proj-progress-fill'; progFill.style.width = pct + '%';
      progBar.appendChild(progFill);
      tdProg.appendChild(progLabel); tdProg.appendChild(progBar);

      var tdActions = document.createElement('td'); tdActions.className = 'r';
      var actions = document.createElement('div'); actions.className = 'row-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'row-action-btn'; editBtn.setAttribute('data-action', 'edit-projeto');
      editBtn.setAttribute('data-id', p.id); editBtn.setAttribute('aria-label', 'Editar projeto');
      editBtn.innerHTML = '<i class="fad fa-pen"></i>';
      var delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'row-action-btn row-action-danger'; delBtn.setAttribute('data-action', 'delete-projeto');
      delBtn.setAttribute('data-id', p.id); delBtn.setAttribute('aria-label', 'Excluir projeto');
      delBtn.innerHTML = '<i class="fad fa-trash"></i>';
      actions.appendChild(editBtn); actions.appendChild(delBtn);
      tdActions.appendChild(actions);

      row.appendChild(tdName); row.appendChild(tdStatus); row.appendChild(tdTags); row.appendChild(tdProg); row.appendChild(tdActions);
      tbody.appendChild(row);
    });
  }

  /* ── Modal de detalhe do projeto (#projeto-detail-modal) ──────────────────
     Aberto ao clicar numa linha de #proj-table-tbody (fora de .row-actions,
     que continua abrindo editar/excluir como já fazia). Só leitura — mostra
     banner + dados do projeto + as tarefas vinculadas (TAREFAS_ALL já vem do
     boot, sem fetch extra), filtráveis por status. Filtro reseta pra "Todos"
     toda vez que o modal abre — é view por projeto, não faz sentido persistir
     entre projetos diferentes. ── */
  var PDET_PROJETO_ID = null;
  var PDET_TASK_FILTER = ''; /* '' = todos os status */
  /* Toggle Tarefas/Notas do modal (3ª rodada, set/2026 — pedido explícito
     do autor). Reseta pra 'tarefas' a cada open, mesmo espírito de
     PDET_TASK_FILTER resetar — é view por projeto, não persiste entre
     projetos diferentes. */
  var PDET_VIEW_MODE = 'tarefas'; /* 'tarefas' | 'notas' */

  function renderProjetoDetailFilter() {
    var host = $('pdet-filter');
    host.innerHTML = '';
    var allBtn = document.createElement('button');
    allBtn.type = 'button'; allBtn.className = 'pdet-filter-btn' + (PDET_TASK_FILTER === '' ? ' is-active' : '');
    allBtn.setAttribute('data-status', ''); allBtn.textContent = 'Todos';
    host.appendChild(allBtn);
    TAR_STATUS.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'pdet-filter-btn' + (PDET_TASK_FILTER === s ? ' is-active' : '');
      btn.setAttribute('data-status', s); btn.textContent = s;
      host.appendChild(btn);
    });
  }

  function renderProjetoDetailTasks() {
    var host = $('pdet-tasks');
    host.innerHTML = '';
    var today = todayISO();
    var tarefas = TAREFAS_ALL.filter(function (t) { return t.projeto_id === PDET_PROJETO_ID; });
    var lista = PDET_TASK_FILTER ? tarefas.filter(function (t) { return t.status === PDET_TASK_FILTER; }) : tarefas;
    /* Ordem fixa Não Iniciado → Em Andamento → Feito (TAR_STATUS já está
       nessa ordem); dentro do mesmo status, por entrega (sem entrega vai pro
       fim) e depois por nome. */
    lista = lista.slice().sort(function (a, b) {
      var oa = TAR_STATUS.indexOf(a.status), ob = TAR_STATUS.indexOf(b.status);
      if (oa !== ob) return oa - ob;
      var da = a.data_entrega || '9999-99-99', db = b.data_entrega || '9999-99-99';
      if (da !== db) return da.localeCompare(db);
      return (a.name || '').localeCompare(b.name || '');
    });
    if (!lista.length) {
      var empty = document.createElement('div'); empty.className = 'pdet-empty';
      empty.textContent = tarefas.length ? 'nenhuma tarefa com status "' + PDET_TASK_FILTER + '"' : 'nenhuma tarefa vinculada a este projeto';
      host.appendChild(empty);
      return;
    }
    lista.forEach(function (t) {
      var row = document.createElement('div'); row.className = 'pdet-task' + (t.status === statusConcluido(TAR_STATUS) ? ' is-done' : '');
      var dot = document.createElement('span'); dot.className = 'pdet-task-dot';
      dot.style.background = TAR_STATUS_COR[t.status] || 'var(--mute)';
      var main = document.createElement('div'); main.className = 'pdet-task-main';
      var name = document.createElement('span'); name.className = 'pdet-task-name'; name.textContent = t.name;
      main.appendChild(name);
      if (t.tipo && t.tipo.length) {
        var sub = document.createElement('span'); sub.className = 'pdet-task-sub'; sub.textContent = t.tipo.join(', ');
        main.appendChild(sub);
      }
      row.appendChild(dot); row.appendChild(main);
      if (t.data_entrega) {
        var late = t.status !== statusConcluido(TAR_STATUS) && t.data_entrega < today;
        var dateEl = document.createElement('span'); dateEl.className = 'pdet-task-date' + (late ? ' is-late' : '');
        dateEl.textContent = fmtDate(t.data_entrega);
        row.appendChild(dateEl);
      }
      host.appendChild(row);
    });
  }

  /* Notas do projeto — filtra NOTAS_HUB por projeto_ids, mesma ordenação
     de notas.html (data desc, nulls por último, depois created_at desc —
     cópia local do comparador, ver sortNotas em notas.js). Cada linha
     reaproveita as mesmas tags coloridas de #not-recent (.tag-tipo-mini/
     .tag-projeto-mini) e o snippet (noteSnippet, ver acima); clicar fecha
     este modal e abre o #detail-modal em modo 'nota' — nunca dois modais
     abertos ao mesmo tempo. */
  function renderProjetoDetailNotas() {
    var host = $('pdet-notes');
    host.innerHTML = '';
    var notas = NOTAS_HUB.filter(function (n) { return (n.projeto_ids || []).indexOf(PDET_PROJETO_ID) !== -1; });
    notas = notas.slice().sort(function (a, b) {
      var ad = a.data, bd = b.data;
      if (ad && bd) { if (ad !== bd) return ad < bd ? 1 : -1; }
      else if (ad !== bd) { return ad ? -1 : 1; }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    $('pdet-notes-count').textContent = notas.length ? (notas.length + (notas.length === 1 ? ' nota' : ' notas')) : '';
    if (!notas.length) {
      var empty = document.createElement('div'); empty.className = 'pdet-empty';
      empty.textContent = 'nenhuma nota vinculada a este projeto';
      host.appendChild(empty);
      return;
    }
    notas.forEach(function (n) {
      var row = document.createElement('div'); row.className = 'pdet-note';
      row.setAttribute('data-nota-id', String(n.id));
      var name = document.createElement('div'); name.className = 'pdet-note-name'; name.textContent = n.name;
      row.appendChild(name);
      if ((n.tipo || []).length) {
        var tagsRow = document.createElement('div'); tagsRow.className = 'pdet-note-tags';
        n.tipo.forEach(function (t) {
          var tg = document.createElement('span'); tg.className = 'tag-tipo-mini'; tg.textContent = t;
          tg.style.setProperty('--dot-color', NOT_TIPO_COR[t] || 'var(--mute)');
          tagsRow.appendChild(tg);
        });
        row.appendChild(tagsRow);
      }
      var snip = noteSnippet(n.conteudo_md);
      if (snip) { var snipEl = document.createElement('div'); snipEl.className = 'pdet-note-snippet'; snipEl.textContent = snip; row.appendChild(snipEl); }
      if (n.data) { var d = document.createElement('div'); d.className = 'pdet-note-date'; d.textContent = fmtDate(n.data); row.appendChild(d); }
      host.appendChild(row);
    });
  }

  function switchPdetViewMode(mode) {
    PDET_VIEW_MODE = mode;
    var btns = document.querySelectorAll('#pdet-view-toggle .tar-chart-toggle-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-active', btns[i].getAttribute('data-view') === mode);
    $('pdet-view-tarefas').hidden = mode !== 'tarefas';
    $('pdet-view-notas').hidden = mode !== 'notas';
    if (mode === 'notas') renderProjetoDetailNotas();
  }

  function openProjetoDetail(id) {
    var p = findProjetoById(id);
    if (!p) return;
    PDET_PROJETO_ID = p.id;
    PDET_TASK_FILTER = '';
    switchPdetViewMode('tarefas');

    $('pdet-banner-icon').textContent = p.emoji || '📁';
    $('pdet-banner').style.setProperty('--pdet-accent', PROJETO_STATUS_COR[p.status] || 'var(--gold)');
    $('pdet-name').textContent = p.name;
    $('pdet-status-dot').style.background = PROJETO_STATUS_COR[p.status] || 'var(--mute)';
    $('pdet-status-text').textContent = p.status || '—';

    var tagsHost = $('pdet-tags'); tagsHost.innerHTML = '';
    (p.tags || []).forEach(function (tg) {
      var tag = document.createElement('span'); tag.className = 'proj-tag'; tag.textContent = tg;
      tagsHost.appendChild(tag);
    });

    var tarefas = TAREFAS_ALL.filter(function (t) { return t.projeto_id === p.id; });
    var total = tarefas.length;
    var porStatus = {};
    TAR_STATUS.forEach(function (s) { porStatus[s] = 0; });
    tarefas.forEach(function (t) { if (porStatus[t.status] !== undefined) porStatus[t.status]++; });
    var feitas = porStatus['Feito'] || 0;
    var pct = total ? Math.round((feitas / total) * 100) : 0;
    $('pdet-progress-label').textContent = total ? (feitas + '/' + total + ' tarefas') : 'sem tarefas';
    $('pdet-progress-pct').textContent = total ? (pct + '%') : '';
    $('pdet-progress-fill').style.width = pct + '%';
    $('pdet-stat-nao-iniciado').textContent = porStatus['Não Iniciado'] || 0;
    $('pdet-stat-em-andamento').textContent = porStatus['Em Andamento'] || 0;
    $('pdet-stat-feito').textContent = feitas;

    renderProjetoDetailFilter();
    renderProjetoDetailTasks();

    $('projeto-detail-modal').classList.add('open');
    syncModalScrollLock();
  }

  function closeProjetoDetail() {
    $('projeto-detail-modal').classList.remove('open');
    PDET_PROJETO_ID = null;
    syncModalScrollLock();
  }

  /* Outras partes do hub também mostram PROJETOS (picker do evento, select
     do mini-kanban, rótulo de projeto nos cards) — re-renderiza todas depois
     de qualquer criação/edição/exclusão, pra nome/emoji nunca ficarem
     desatualizados numa dessas telas. */
  function refreshProjetoDependents() {
    renderEventoProjetoPicker();
    renderProjetoSelect();
    renderTarMiniKanban();
  }

  /* Ícone do banner do #projeto-modal segue o campo Emoji ao vivo — cai no
     folder-open padrão (mesmo fallback do card/tabela, ver .proj-avatar)
     quando o campo está vazio. Chamada no open e a cada tecla digitada no
     campo (ver init()). */
  function syncProjetoBannerIcon() {
    var v = $('projeto-emoji').value.trim();
    var el = $('projeto-banner-icon');
    if (v) { el.textContent = v; } else { el.innerHTML = '<i class="fad fa-folder-open"></i>'; }
  }

  function openProjetoModal(id) {
    EDIT_PROJETO_ID = id || null;
    var p = null;
    if (id) { for (var i = 0; i < PROJETOS.length; i++) { if (String(PROJETOS[i].id) === String(id)) { p = PROJETOS[i]; break; } } }
    $('projeto-modal-title').textContent = p ? 'Editar projeto' : 'Novo projeto';
    $('projeto-nome').value = p ? p.name : '';
    $('projeto-emoji').value = (p && p.emoji) ? p.emoji : '';
    syncProjetoBannerIcon();
    var projetoStatusInicial = p ? p.status : 'Não Iniciado';
    setSingleChip('projeto-status-picker', 'projeto-status', projetoStatusInicial);
    $('projeto-banner').style.setProperty('--pdet-accent', PROJETO_STATUS_COR[projetoStatusInicial] || 'var(--gold)');
    PROJETO_TAGS_SEL = p ? (p.tags || []).slice() : [];
    setMultiChips('projeto-tags-picker', PROJETO_TAGS_SEL);
    $('projeto-error').textContent = '';
    setProjetoSaving(false);
    $('projeto-modal').classList.add('open');
    syncModalScrollLock();
    if (!p) { var ni = $('projeto-nome'); if (ni) ni.focus(); }
  }
  function closeProjetoModal() { $('projeto-modal').classList.remove('open'); EDIT_PROJETO_ID = null; syncModalScrollLock(); }
  function setProjetoSaving(on) { $('projeto-save').disabled = on; $('projeto-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  function onProjetoSubmit(e) {
    e.preventDefault();
    var name = $('projeto-nome').value.trim();
    var emoji = $('projeto-emoji').value.trim() || null;
    var status = $('projeto-status').value;
    if (!name) { $('projeto-error').textContent = 'nome obrigatório'; return; }

    setProjetoSaving(true);
    $('projeto-error').textContent = '';
    var payload = { name: name, emoji: emoji, status: status, tags: PROJETO_TAGS_SEL.slice() };
    var req = EDIT_PROJETO_ID
      ? apiProjetosUpdate(SESSION_PW, EDIT_PROJETO_ID, payload)
      : apiProjetosCreate(SESSION_PW, payload);

    /* Guarda ANTES de fechar o modal — closeProjetoModal() zera
       EDIT_PROJETO_ID, então checá-lo depois de chamar closeProjetoModal()
       sempre lia null e caía no ramo de criar, duplicando a linha (a antiga
       ficava e uma "nova" com o mesmo id era empurrada — só sumia depois de
       um refresh porque o boot busca a lista de novo do zero). */
    var wasEditing = EDIT_PROJETO_ID;
    req.then(function (j) {
      var saved = j.projeto;
      closeProjetoModal();
      if (wasEditing) {
        for (var i = 0; i < PROJETOS.length; i++) { if (String(PROJETOS[i].id) === String(saved.id)) { PROJETOS[i] = saved; break; } }
      } else {
        PROJETOS.push(saved);
      }
      writeHubCache();
      renderProjetosTable();
      refreshProjetoDependents();
    }).catch(function (err) {
      setProjetoSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('projeto-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || 'tente de novo');
    });
  }

  /* Excluir (mesma confirmação inline de dois cliques do resto do arquivo —
     ver confirmDelete/resetDeletePending, LIFEOS.md §7). Em caso de
     `has_tarefas`, a mensagem de erro já vem pronta de apiProjetosDelete. */
  function onDeleteProjetoClick(btn, id) {
    confirmDelete(btn, 'projeto:' + id, function () { return apiProjetosDelete(SESSION_PW, id); }, function () {
      for (var i = 0; i < PROJETOS.length; i++) { if (String(PROJETOS[i].id) === String(id)) { PROJETOS.splice(i, 1); break; } }
      if (TAR_PROJETO_FILTRO === id) TAR_PROJETO_FILTRO = '';
      writeHubCache();
      renderProjetosTable();
      refreshProjetoDependents();
    });
  }

  /* ── Manifestações: grid de cards (migrado do Notion, set/2026) ──────
     Cada card mostra o banner real (Storage, já re-hospedado na migração)
     ou o banner padrão estilizado quando a entrada não tem imagem real
     (nunca teve cover, ou só tinha o cover-padrão de galeria do Notion —
     ver notion-manifestacoes-migrate). Reaproveita .proj-status-pill/
     .proj-status-dot/.proj-tag de Projetos — mesmo vocabulário visual,
     mesmo arquivo, sem motivo pra duplicar CSS. ── */
  function renderManifestacoes() {
    var host = $('manif-grid');
    if (!host) return;
    host.innerHTML = '';
    if (!MANIFESTACOES.length) {
      var empty = document.createElement('div'); empty.className = 'manif-empty';
      empty.textContent = 'nenhuma manifestação ainda';
      host.appendChild(empty);
      return;
    }
    MANIFESTACOES.forEach(function (m) {
      var card = document.createElement('div'); card.className = 'manif-card';

      var banner = document.createElement('div'); banner.className = 'manif-banner';
      if (m.banner_url) {
        var img = document.createElement('img'); img.src = m.banner_url; img.alt = '';
        banner.appendChild(img);
      } else {
        var def = document.createElement('div'); def.className = 'manif-banner-default';
        def.innerHTML = '<i class="fad fa-sparkles"></i>';
        banner.appendChild(def);
      }
      card.appendChild(banner);

      var body = document.createElement('div'); body.className = 'manif-card-body';
      var name = document.createElement('div'); name.className = 'manif-card-name'; name.textContent = m.name;
      body.appendChild(name);

      var statusPill = document.createElement('span'); statusPill.className = 'proj-status-pill';
      var dot = document.createElement('span'); dot.className = 'proj-status-dot';
      dot.style.background = PROJETO_STATUS_COR[m.status] || 'var(--mute)';
      statusPill.appendChild(dot);
      statusPill.appendChild(document.createTextNode(m.status || '—'));
      body.appendChild(statusPill);

      if (m.tags && m.tags.length) {
        var tagsWrap = document.createElement('div'); tagsWrap.className = 'proj-tags';
        m.tags.forEach(function (tg) {
          var tag = document.createElement('span'); tag.className = 'proj-tag'; tag.textContent = tg;
          tagsWrap.appendChild(tag);
        });
        body.appendChild(tagsWrap);
      }

      card.appendChild(body);
      host.appendChild(card);
    });
  }

  /* Modo foco: oculta todas as outras hero-sections, deixando só
     Manifestações visível — como ela já é a ÚLTIMA seção, sumir com as
     outras faz ela "subir" sozinha pro topo do conteúdo (onde normalmente
     fica o Calendário), sem precisar reordenar nada no DOM. Clicar de novo
     no mesmo atalho do quicknav sai do modo foco. */
  function toggleManifFocus() {
    MANIF_FOCUS = !MANIF_FOCUS;
    $('app').classList.toggle('is-manif-focus', MANIF_FOCUS);
    $('quicknav-manifestacoes').classList.toggle('is-active', MANIF_FOCUS);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  /* Qualquer outro atalho do quicknav sai do modo foco antes de rolar —
     senão a seção alvo continuaria escondida (ver .app.is-manif-focus). */
  function exitManifFocusIfActive() {
    if (!MANIF_FOCUS) return;
    MANIF_FOCUS = false;
    $('app').classList.remove('is-manif-focus');
    $('quicknav-manifestacoes').classList.remove('is-active');
  }

  /* ── #manifestacao-modal · cadastro direto pelo hub ──────────────────
     Exceção documentada em LIFEOS.md (set/2026, decisão explícita do autor):
     Manifestações ganhou CREATE — só criar, sem editar/excluir ainda (não
     adiantar escopo além do pedido). Banner é opcional, lido do arquivo
     local como base64 (ver readFileAsBase64) — nunca sobe direto pro
     Storage a partir do browser, mesma postura de segurança do resto do
     LifeOS (toda escrita passa pela senha mestre no corpo da requisição). */
  var MANIFESTACAO_BANNER_MAX_BYTES = 5 * 1024 * 1024; /* 5MB — generoso pra foto de celular sem comprimir */

  function openManifestacaoModal() {
    $('manifestacao-nome').value = '';
    setSingleChip('manifestacao-status-picker', 'manifestacao-status', 'Não Iniciado');
    MANIFESTACAO_TAGS_SEL = [];
    setMultiChips('manifestacao-tags-picker', MANIFESTACAO_TAGS_SEL);
    clearManifestacaoBanner();
    $('manifestacao-error').textContent = '';
    setManifestacaoSaving(false);
    $('manifestacao-modal').classList.add('open');
    syncModalScrollLock();
    var ni = $('manifestacao-nome'); if (ni) ni.focus();
  }
  function closeManifestacaoModal() { $('manifestacao-modal').classList.remove('open'); syncModalScrollLock(); }
  function setManifestacaoSaving(on) { $('manifestacao-save').disabled = on; $('manifestacao-save').textContent = on ? 'Salvando…' : 'Salvar'; }

  /* Banner de Manifestação (#manifestacao-banner) tem dois estados: sem
     imagem, o gradiente padrão + ícone de sparkles aparecem (mesmo
     .pdet-banner de todo modal, ver CSS); com imagem, .pdet-banner-img
     cobre o banner e o ícone some — a imagem escolhida É o banner. */
  function clearManifestacaoBanner() {
    MANIFESTACAO_BANNER_FILE = null;
    $('manifestacao-banner-input').value = '';
    $('manifestacao-banner-label').textContent = 'Adicionar imagem';
    $('manifestacao-banner-remove').hidden = true;
    $('manifestacao-banner-preview').hidden = true;
    $('manifestacao-banner-preview').src = '';
    $('manifestacao-banner-icon').hidden = false;
  }
  function onManifestacaoBannerChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MANIFESTACAO_BANNER_MAX_BYTES) {
      $('manifestacao-error').textContent = 'imagem muito grande — máximo 5MB';
      $('manifestacao-banner-input').value = '';
      return;
    }
    $('manifestacao-error').textContent = '';
    MANIFESTACAO_BANNER_FILE = file;
    $('manifestacao-banner-label').textContent = 'Trocar imagem';
    $('manifestacao-banner-remove').hidden = false;
    var reader = new FileReader();
    reader.onload = function () {
      $('manifestacao-banner-preview').src = reader.result;
      $('manifestacao-banner-preview').hidden = false;
      $('manifestacao-banner-icon').hidden = true;
    };
    reader.readAsDataURL(file);
  }
  /* data: URL vem como "data:image/jpeg;base64,<payload>" — só o payload
     depois da vírgula interessa pro corpo da requisição (ver
     apiManifestacoesCreate/banner_base64). */
  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        var comma = result.indexOf(',');
        resolve(comma === -1 ? '' : result.slice(comma + 1));
      };
      reader.onerror = function () { reject(new Error('erro ao ler arquivo')); };
      reader.readAsDataURL(file);
    });
  }

  function onManifestacaoSubmit(e) {
    e.preventDefault();
    var name = $('manifestacao-nome').value.trim();
    var status = $('manifestacao-status').value;
    if (!name) { $('manifestacao-error').textContent = 'nome obrigatório'; return; }

    setManifestacaoSaving(true);
    $('manifestacao-error').textContent = '';
    var payload = { name: name, status: status, tags: MANIFESTACAO_TAGS_SEL.slice() };

    var bannerPromise = MANIFESTACAO_BANNER_FILE
      ? readFileAsBase64(MANIFESTACAO_BANNER_FILE)
      : Promise.resolve(null);

    bannerPromise.then(function (base64) {
      return apiManifestacoesCreate(SESSION_PW, payload, base64, MANIFESTACAO_BANNER_FILE ? MANIFESTACAO_BANNER_FILE.type : null);
    }).then(function (j) {
      MANIFESTACOES.push(j.manifestacao);
      writeHubCache();
      closeManifestacaoModal();
      renderManifestacoes();
    }).catch(function (err) {
      setManifestacaoSaving(false);
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      $('manifestacao-error').textContent = 'erro ao salvar — ' + ((err && err.detail) || (err && err.message) || 'tente de novo');
    });
  }

  /* ── Gate / boot ─────────────────────────────────────────────────── */
  function enterApp() { $('gate').hidden = true; $('gate-checking').hidden = true; $('app').hidden = false; }
  function showGateForm() { $('gate').hidden = false; $('gate-checking').hidden = true; $('gate-form').hidden = false; $('app').hidden = true; var i = $('gate-input'); if (i) i.focus(); }
  function setGateLoading(on) { $('gate-btn').disabled = on; $('gate-btn').textContent = on ? '…' : '→'; }
  function shake() { var f = $('gate-row'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }

  /* ── Cache persistente (localStorage, JSON) ──────────────────────────
     Mesmo princípio de financas_cache em financas.js (ver LIFEOS.md): o
     boot NÃO dispara as 5 buscas (Finanças, Eventos, Projetos, Tarefas,
     Manifestações) se já existe um cache válido — entra direto do que foi
     salvo na última visita, sem tocar rede nenhuma. O único jeito de forçar
     dados novos é o botão ↻ (`onRefresh`) ou uma escrita bem-sucedida
     (create/update/delete em qualquer módulo persiste o array atualizado
     de volta no cache, na hora — ver cada handler). Sem TTL por tempo,
     igual Finanças: "confiável até você mandar atualizar".
     Diferente de Finanças (cache por MÊS, atemporal — "junho não muda de
     nome"), aqui são 5 fontes independentes, e duas delas são sensíveis a
     "hoje" mudar entre visitas:
       - Finanças: cache.fin guarda o `ym` de quando foi salvo; se o mês
         civil já virou desde então, os dados cacheados seriam do mês
         ERRADO pra mostrar como "mês atual" — busca fresca só dessa parte.
       - Eventos: a janela buscada (mês anterior a +2) é relativa a "hoje"
         no momento do fetch; dias/semanas depois, viu HUB_CAL_YM real. Ao
         hidratar do cache, `topUpEventosWindow()` garante que os 4 meses
         da janela ATUAL estão cobertos — usa `ensureHubCalMonth`, que já é
         idempotente (só busca o que falta), então isso não gera as 6
         chamadas de novo, só as que realmente faltam (geralmente zero). */
  var HUB_CACHE_KEY = 'lifeos_hub_cache';
  var HUB_CACHE_V = 2; /* bump em set/2026: cache ganhou a 6ª fonte (notas) */
  function readHubCache() {
    try {
      var raw = localStorage.getItem(HUB_CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.v !== HUB_CACHE_V) return null;
      return c;
    } catch (_e) { return null; }
  }
  function writeHubCache() {
    try {
      localStorage.setItem(HUB_CACHE_KEY, JSON.stringify({
        v: HUB_CACHE_V,
        fetched_at: new Date().toISOString(),
        fin: { ym: todayYM(), movimentacoes: MROWS, saldo_abertura: SALDO_ABERTURA, movimentacoes_prev: FIN_PREV_ROWS },
        eventos: { loaded: HUB_EVENTOS_LOADED, eventos: EVENTOS },
        projetos: PROJETOS,
        tarefas: TAREFAS_ALL,
        manifestacoes: MANIFESTACOES,
        notas: NOTAS_HUB,
      }));
    } catch (_e) { /* quota/indisponível: cache só em memória nesta sessão */ }
  }
  function dropHubCache() { try { localStorage.removeItem(HUB_CACHE_KEY); } catch (_e) {} }

  /* Fetch fresco de TUDO (sem cache nenhum, ou ↻) — era loadPreview(). */
  function fetchAllHub() {
    /* Vocabulário primeiro: o render dos seletores e das cores depende dele. */
    return carregarVocab(SESSION_PW).then(fetchAllHubDados);
  }

  function fetchAllHubDados() {
    var t = todayYM(), pt = prevMonth(t);
    HUB_CAL_YM = t;
    var toYm = nextMonth(nextMonth(t));
    var from = pt + '-01';
    var to = toYm + '-' + String(lastDayOfMonth(toYm)).padStart(2, '0');
    return Promise.all([
      apiFinQuery(SESSION_PW, t, pt),
      apiEventosQuery(SESSION_PW, from, to),
      apiProjetosQuery(SESSION_PW),
      apiTarefasQuery(SESSION_PW),
      apiManifestacoesQuery(SESSION_PW),
      apiNotasQuery(SESSION_PW),
    ]).then(function (res) {
      var fin = res[0], evt = res[1], proj = res[2], tar = res[3], manif = res[4], notas = res[5];
      MROWS = fin.movimentacoes || [];
      SALDO_ABERTURA = fin.saldo_abertura || 0;
      FIN_PREV_ROWS = fin.movimentacoes_prev || [];
      FIN_MONTH_CACHE = {}; FIN_MONTH_CACHE[t] = MROWS; FIN_MONTH_CACHE[pt] = FIN_PREV_ROWS;
      EVENTOS = evt.eventos || [];
      HUB_EVENTOS_LOADED = {};
      [pt, t, nextMonth(t), toYm].forEach(function (ym) { HUB_EVENTOS_LOADED[ym] = true; });
      PROJETOS = proj.projetos || [];
      TAREFAS_ALL = tar.tarefas || [];
      MANIFESTACOES = manif.manifestacoes || [];
      NOTAS_HUB = notas.notas || [];
    });
  }

  /* Garante que a janela de Eventos ATUAL (mês anterior a +2, a partir de
     HOJE) está coberta — usado ao hidratar de um cache que pode ter sido
     salvo em outro mês civil. ensureHubCalMonth já é idempotente. */
  function topUpEventosWindow() {
    var t = todayYM(), pt = prevMonth(t), toYm = nextMonth(nextMonth(t));
    return Promise.all([pt, t, nextMonth(t), toYm].map(ensureHubCalMonth));
  }

  /* Hidrata as 5 fontes a partir de um cache válido. Finanças é a única que
     precisa de decisão: se o `ym` salvo não é mais o mês atual (mês virou
     desde a última visita), os dados cacheados serviriam pro mês ERRADO —
     busca fresca só dela; as outras 4 nunca re-buscam sozinhas aqui. */
  function hydrateFromHubCache(cache) {
    var t = todayYM(), pt = prevMonth(t);
    HUB_CAL_YM = t;
    PROJETOS = cache.projetos || [];
    TAREFAS_ALL = cache.tarefas || [];
    MANIFESTACOES = cache.manifestacoes || [];
    NOTAS_HUB = cache.notas || [];
    EVENTOS = (cache.eventos && cache.eventos.eventos) || [];
    HUB_EVENTOS_LOADED = (cache.eventos && cache.eventos.loaded) || {};

    var finPromise;
    if (cache.fin && cache.fin.ym === t) {
      MROWS = cache.fin.movimentacoes || [];
      SALDO_ABERTURA = cache.fin.saldo_abertura || 0;
      FIN_PREV_ROWS = cache.fin.movimentacoes_prev || [];
      FIN_MONTH_CACHE = {}; FIN_MONTH_CACHE[t] = MROWS; FIN_MONTH_CACHE[pt] = FIN_PREV_ROWS;
      finPromise = Promise.resolve();
    } else {
      finPromise = apiFinQuery(SESSION_PW, t, pt).then(function (fin) {
        MROWS = fin.movimentacoes || [];
        SALDO_ABERTURA = fin.saldo_abertura || 0;
        FIN_PREV_ROWS = fin.movimentacoes_prev || [];
        FIN_MONTH_CACHE = {}; FIN_MONTH_CACHE[t] = MROWS; FIN_MONTH_CACHE[pt] = FIN_PREV_ROWS;
      });
    }
    return Promise.all([finPromise, topUpEventosWindow()]);
  }

  /* Label "sincronizado" (mesmo padrão de #fetched-at em financas.html) —
     reflete quando o cache local foi escrito pela última vez, não "agora". */
  function updateHubFetchedLabel() {
    var el = $('hub-fetched-at');
    if (!el) return;
    var cache = readHubCache();
    if (!cache || !cache.fetched_at) { el.textContent = ''; return; }
    el.textContent = 'sincronizado ' + new Date(cache.fetched_at).toLocaleString('pt-BR');
  }

  function renderAllHub() {
    renderFinancasPreview();
    renderMiniCal();
    renderLegend();
    renderEventosTimeline();
    syncEventTimelineHeight();
    renderEventoProjetoPicker();
    renderTarefasPreview();
    renderProjStatusFilter();
    renderProjetosTable();
    renderManifestacoes();
    renderNotasPreview();
    updateHubFetchedLabel();
  }

  function authAndLoad(pw) {
    SESSION_PW = pw;
    if (window.Chart) { Chart.defaults.font.family = "'JetBrains Mono', monospace"; }
    var cache = readHubCache();
    var ready = cache
      ? hydrateFromHubCache(cache).then(function () { writeHubCache(); })
      : fetchAllHub().then(function () { writeHubCache(); });
    return ready.then(function () {
      enterApp();
      renderAllHub();
    });
  }

  /* ↻ — único jeito de forçar uma busca completa das 5 fontes de novo (fora
     de uma escrita bem-sucedida, que já persiste só o array que mudou).
     Mesmo espírito do botão de Finanças, só que aqui não é "por mês", é
     tudo de uma vez — são só 5 fontes, refazer todas é simples e raro. */
  var HUB_REFRESHING = false;
  function onRefresh() {
    if (!SESSION_PW || HUB_REFRESHING) return;
    HUB_REFRESHING = true;
    var btn = $('hub-refresh-btn');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    fetchAllHub().then(function () {
      writeHubCache();
      renderAllHub();
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') { onLogout(); return; }
      window.alert('erro ao atualizar — ' + ((err && err.detail) || 'tente de novo'));
    }).then(function () {
      HUB_REFRESHING = false;
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

  /* ── Drawer de configuração ──────────────────────────────────────────
     Aberto pelo #menu-btn da topbar (que ocupa o lugar do antigo botão de
     logout — o "Sair" virou um item daqui de dentro). Os itens de config
     são <a href> pra páginas próprias; não há tela trocada por JS.

     O drawer não usa [hidden]: o CSS troca `visibility` junto com o
     transform (ver lifeos.html), senão display:none mataria o slide. */
  function openDrawer() {
    $('config-drawer').classList.add('open');
    $('drawer-backdrop').classList.add('open');
    $('menu-btn').setAttribute('aria-expanded', 'true');
    /* foco no primeiro item pra quem navega por teclado cair dentro do
       drawer, não atrás dele */
    var first = $('config-drawer').querySelector('.drawer-item');
    if (first) first.focus();
  }

  function closeDrawer(refocus) {
    if (!$('config-drawer').classList.contains('open')) return;
    $('config-drawer').classList.remove('open');
    $('drawer-backdrop').classList.remove('open');
    $('menu-btn').setAttribute('aria-expanded', 'false');
    /* devolve o foco ao botão que abriu — só quando o fechamento foi
       deliberado (ESC/X/backdrop), nunca quando o drawer some porque a
       página está navegando pra outro lugar */
    if (refocus !== false) $('menu-btn').focus();
  }

  function onLogout() {
    closeDrawer(false);
    localStorage.removeItem(LS_KEY);
    dropHubCache();
    SESSION_PW = ''; MROWS = []; FIN_PREV_ROWS = []; FIN_MONTH_CACHE = {}; EVENTOS = []; HUB_EVENTOS_LOADED = {}; PROJETOS = []; TAREFAS_ALL = []; MANIFESTACOES = [];
    closeDayModal(); closeEventoModal(); closeDetailModal(); closeTarefaModal(); closeProjetoModal(); closeManifestacaoModal(); resetDeletePending();
    TAREFA_TIPO_SEL = []; PROJETO_TAGS_SEL = []; MANIFESTACAO_TAGS_SEL = []; MANIFESTACAO_BANNER_FILE = null;
    if (MANIF_FOCUS) { MANIF_FOCUS = false; $('app').classList.remove('is-manif-focus'); $('quicknav-manifestacoes').classList.remove('is-active'); }
    /* Volta a UI do toggle/botão do calendário pro default (eventos), sem
       depender do guard de no-op de setCalMode(). */
    CAL_MODE = 'eventos';
    var calToggleBtns = document.querySelectorAll('#cal-mode-toggle .tar-chart-toggle-btn');
    for (var ci = 0; ci < calToggleBtns.length; ci++) calToggleBtns[ci].classList.toggle('is-active', calToggleBtns[ci].getAttribute('data-mode') === 'eventos');
    var addBtnReset = $('add-evento-btn');
    addBtnReset.innerHTML = 'Adicionar <i class="fad fa-plus"></i>';
    addBtnReset.setAttribute('aria-label', 'Novo evento');
    TAR_PROJETO_FILTRO = ''; DRAG_TAREFA_ID = null;
    /* não chapa 'Em Progresso': o status pode ter sido renomeado na tela
       de Tags, e o filtro precisa apontar pra algo que existe. */
    PROJ_STATUS_FILTRO = STATUS_PROJETO[1] || STATUS_PROJETO[0] || '';
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

  /* Aplica a identidade declarada em lifeos-config.js sobre o masthead. O
     HTML já traz os valores desta instância, então isso é no-op aqui — existe
     pra que um fork troque nome/sub/imagens num arquivo só, sem editar markup.
     Cada campo é opcional: ausente, o que está no HTML permanece. */
  function applyIdentidade() {
    var id = CFG.identidade;
    if (!id) return;
    var h1 = document.querySelector('.hub-masthead-text h1');
    var sub = document.querySelector('.hub-masthead-text .hub-sub');
    var banner = document.querySelector('.hub-banner img');
    var avatar = document.querySelector('.hub-icon-wrap img');
    if (id.nome && h1) h1.textContent = id.nome;
    if (id.sub && sub) sub.textContent = id.sub;
    if (id.banner && banner) banner.src = id.banner;
    if (id.avatar && avatar) avatar.src = id.avatar;
    /* O <title> fica de fora de propósito: ele carrega o nome do site
       ("LifeOS · LifeOS"), não só o do painel, e sobrescrever com `nome`
       perderia esse prefixo. Um fork edita o <title> no HTML. */
  }

  function init() {
    applyIdentidade();
    if (window.LIFEOS_BLOG) window.LIFEOS_BLOG.aplicar();
    /* Recalcula a altura travada da linha do tempo (ver syncEventTimelineHeight)
       no resize — a largura do card muda a altura das células do calendário
       (aspect-ratio:1) e cruzar o breakpoint de 780px liga/desliga o
       pareamento com a coluna do calendário. Debounce simples: só a última
       chamada dentro de 150ms roda de fato. */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { syncEventTimelineHeight(); }, 150);
    });
    $('gate-form').addEventListener('submit', onSubmit);
    $('menu-btn').addEventListener('click', openDrawer);
    $('drawer-close').addEventListener('click', function () { closeDrawer(); });
    $('drawer-backdrop').addEventListener('click', function () { closeDrawer(); });
    $('logout-btn').addEventListener('click', onLogout);
    $('hub-refresh-btn').addEventListener('click', onRefresh);
    $('hub-cal-prev').addEventListener('click', function () { goHubCalMonth(-1); });
    $('hub-cal-next').addEventListener('click', function () { goHubCalMonth(1); });
    $('mini-cal').addEventListener('click', function (e) {
      var cell = e.target.closest ? e.target.closest('.hub-mini-cal-cell[data-date]') : null;
      if (cell) openDayModal(cell.getAttribute('data-date'));
    });
    $('day-modal-close').addEventListener('click', closeDayModal);
    $('day-modal').addEventListener('click', function (e) { if (e.target === $('day-modal')) closeDayModal(); });
    $('eventos-timeline').addEventListener('click', onHubListRowActivate);
    $('not-recent').addEventListener('click', onHubListRowActivate);
    $('day-modal-body').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.row-action-btn[data-action="delete-evento"]') : null;
      if (btn) { onDeleteEvento(btn, btn.getAttribute('data-id')); return; }
      onHubListRowActivate(e);
    });
    $('detail-modal-close').addEventListener('click', closeDetailModal);
    $('detail-modal').addEventListener('click', function (e) { if (e.target === $('detail-modal')) closeDetailModal(); });
    $('detail-modal-edit').addEventListener('click', function () {
      var id = CURRENT_DETAIL_TAREFA_ID;
      closeDetailModal();
      if (id) openTarefaModal(id);
    });
    $('detail-modal-delete').addEventListener('click', function (e) {
      if (CURRENT_DETAIL_TAREFA_ID) onDeleteTarefaClick(e.currentTarget, CURRENT_DETAIL_TAREFA_ID);
    });
    $('detail-modal-fullscreen').addEventListener('click', function () {
      if (CURRENT_DETAIL_NOTA_ID) location.href = 'notas.html?nota=' + encodeURIComponent(CURRENT_DETAIL_NOTA_ID);
    });
    /* Clicar em qualquer lugar que NÃO seja um botão de excluir cancela uma
       confirmação pendente na hora, em vez de esperar os 3s do timeout. */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.row-action-btn') : null;
      if (!btn) resetDeletePending();
    });
    renderEventoTipoPicker();
    $('evento-tipo-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.evento-tipo-opt') : null;
      if (btn) setEventoTipo(btn.getAttribute('data-tipo'));
    });
    $('evento-projeto-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.evento-projeto-opt') : null;
      if (btn) setEventoProjeto(btn.getAttribute('data-id'));
    });
    $('cal-mode-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.tar-chart-toggle-btn') : null;
      if (btn) setCalMode(btn.getAttribute('data-mode'));
    });
    $('add-evento-btn').addEventListener('click', onAddClick);
    $('evento-form').addEventListener('submit', onEventoSubmit);
    $('evento-cancel').addEventListener('click', closeEventoModal);
    $('evento-modal-close').addEventListener('click', closeEventoModal);
    $('evento-modal').addEventListener('click', function (e) { if (e.target === $('evento-modal')) closeEventoModal(); });

    /* ── #tarefa-modal (criar/editar direto pelo hub) ── */
    buildChipOptions('tarefa-status-picker', TAR_STATUS);
    buildChipOptions('tarefa-tipo-picker', TIPOS_TAREFA);
    buildChipOptions('tarefa-descricao-mode', MD_MODES);
    $('add-tarefa-btn').addEventListener('click', function () { openTarefaModal(null); });
    $('tarefa-status-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (!btn) return;
      var status = btn.getAttribute('data-value');
      setSingleChip('tarefa-status-picker', 'tarefa-status', status);
      $('tarefa-banner').style.setProperty('--pdet-accent', TAR_STATUS_COR[status] || 'var(--gold)');
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

    /* ── #projeto-modal (CRUD completo direto pelo hub, movido de
       tarefas.js — ver LIFEOS.md) + ações de linha na tabela de Projetos ── */
    buildChipOptions('projeto-status-picker', STATUS_PROJETO);
    buildChipOptions('projeto-tags-picker', TAGS_PROJETO);
    $('add-projeto-btn').addEventListener('click', function () { openProjetoModal(null); });
    $('proj-status-filter').addEventListener('change', function (e) {
      PROJ_STATUS_FILTRO = e.target.value;
      renderProjetosTable();
    });
    $('projeto-emoji').addEventListener('input', syncProjetoBannerIcon);
    $('projeto-status-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (!btn) return;
      var status = btn.getAttribute('data-value');
      setSingleChip('projeto-status-picker', 'projeto-status', status);
      $('projeto-banner').style.setProperty('--pdet-accent', PROJETO_STATUS_COR[status] || 'var(--gold)');
    });
    $('projeto-tags-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) toggleMultiChip(btn, PROJETO_TAGS_SEL);
    });
    $('projeto-form').addEventListener('submit', onProjetoSubmit);
    $('projeto-cancel').addEventListener('click', closeProjetoModal);
    $('projeto-modal-close').addEventListener('click', closeProjetoModal);
    $('projeto-modal').addEventListener('click', function (e) { if (e.target === $('projeto-modal')) closeProjetoModal(); });
    $('proj-table-tbody').addEventListener('click', function (e) {
      var editBtn = e.target.closest ? e.target.closest('.row-action-btn[data-action="edit-projeto"]') : null;
      if (editBtn) { openProjetoModal(editBtn.getAttribute('data-id')); return; }
      var delBtn = e.target.closest ? e.target.closest('.row-action-btn[data-action="delete-projeto"]') : null;
      if (delBtn) { onDeleteProjetoClick(delBtn, delBtn.getAttribute('data-id')); return; }
      /* Qualquer outro clique na linha (fora de .row-actions) abre o detalhe. */
      if (e.target.closest && e.target.closest('.row-actions')) return;
      var row = e.target.closest ? e.target.closest('tr[data-projeto-id]') : null;
      if (row) openProjetoDetail(row.getAttribute('data-projeto-id'));
    });

    /* ── #projeto-detail-modal (só leitura — ver openProjetoDetail) ── */
    $('projeto-detail-close').addEventListener('click', closeProjetoDetail);
    $('projeto-detail-modal').addEventListener('click', function (e) { if (e.target === $('projeto-detail-modal')) closeProjetoDetail(); });
    $('pdet-filter').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.pdet-filter-btn') : null;
      if (!btn) return;
      PDET_TASK_FILTER = btn.getAttribute('data-status') || '';
      renderProjetoDetailFilter();
      renderProjetoDetailTasks();
    });
    $('pdet-view-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.tar-chart-toggle-btn') : null;
      if (btn) switchPdetViewMode(btn.getAttribute('data-view'));
    });
    /* Clicar numa nota do projeto fecha este modal e abre o #detail-modal
       em modo leitura — nunca dois modais abertos ao mesmo tempo (mesmo
       cuidado de detail-edit/detail-delete fechando o detail-modal antes
       de abrir o de edição, ver mais abaixo). */
    $('pdet-notes').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.pdet-note[data-nota-id]') : null;
      if (!row) return;
      var notaId = row.getAttribute('data-nota-id');
      closeProjetoDetail();
      for (var i = 0; i < NOTAS_HUB.length; i++) {
        if (String(NOTAS_HUB[i].id) === notaId) { openDetailModal('nota', NOTAS_HUB[i]); return; }
      }
    });

    /* ── #manifestacao-modal (CREATE direto pelo hub — ver LIFEOS.md) ── */
    buildChipOptions('manifestacao-status-picker', STATUS_MANIFESTACAO);
    buildChipOptions('manifestacao-tags-picker', TAGS_MANIFESTACAO);
    $('add-manifestacao-btn').addEventListener('click', openManifestacaoModal);
    $('manifestacao-status-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) setSingleChip('manifestacao-status-picker', 'manifestacao-status', btn.getAttribute('data-value'));
    });
    $('manifestacao-tags-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip-opt') : null;
      if (btn) toggleMultiChip(btn, MANIFESTACAO_TAGS_SEL);
    });
    $('manifestacao-banner-trigger').addEventListener('click', function () { $('manifestacao-banner-input').click(); });
    $('manifestacao-banner-input').addEventListener('change', onManifestacaoBannerChange);
    $('manifestacao-banner-remove').addEventListener('click', clearManifestacaoBanner);
    $('manifestacao-form').addEventListener('submit', onManifestacaoSubmit);
    $('manifestacao-cancel').addEventListener('click', closeManifestacaoModal);
    $('manifestacao-modal-close').addEventListener('click', closeManifestacaoModal);
    $('manifestacao-modal').addEventListener('click', function (e) { if (e.target === $('manifestacao-modal')) closeManifestacaoModal(); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      /* drawer primeiro: ele é o único elemento acima dos modais (z 1100),
         então é sempre ele que o ESC deve alcançar quando está aberto */
      if ($('config-drawer').classList.contains('open')) { closeDrawer(); return; }
      if ($('manifestacao-modal').classList.contains('open')) { closeManifestacaoModal(); return; }
      if ($('projeto-modal').classList.contains('open')) { closeProjetoModal(); return; }
      if ($('tarefa-modal').classList.contains('open')) { closeTarefaModal(); return; }
      if ($('detail-modal').classList.contains('open')) { closeDetailModal(); return; }
      if ($('projeto-detail-modal').classList.contains('open')) { closeProjetoDetail(); return; }
      if ($('evento-modal').classList.contains('open')) { closeEventoModal(); return; }
      if ($('day-modal').classList.contains('open')) closeDayModal();
    });
    var quicknavBtns = document.querySelectorAll('.hub-quicknav button[data-jump]');
    for (var qi = 0; qi < quicknavBtns.length; qi++) {
      quicknavBtns[qi].addEventListener('click', function (e) {
        /* sai do modo foco antes de rolar — senão a seção alvo continuaria
           escondida por .app.is-manif-focus (ver toggleManifFocus). */
        exitManifFocusIfActive();
        var target = document.getElementById(e.currentTarget.getAttribute('data-jump'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    $('quicknav-manifestacoes').addEventListener('click', toggleManifFocus);
    $('tar-projeto-select').addEventListener('change', function (e) {
      TAR_PROJETO_FILTRO = e.target.value;
      renderTarMiniKanban();
    });
    $('not-projeto-filtro').addEventListener('change', function (e) {
      NOT_PROJETO_FILTRO = e.target.value;
      renderNotasRecentList();
    });

    /* Mini-kanban de Tarefas: clique abre o modal de detalhe (leitura, todo
       dispositivo); drag-and-drop muda o status (só desktop — ver
       IS_DESKTOP, que já controla se o card nasce draggable). */
    $('tar-mini-board').addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.tar-mini-card[data-id]') : null;
      if (!card) return;
      var id = card.getAttribute('data-id');
      for (var i = 0; i < TAREFAS_ALL.length; i++) {
        if (String(TAREFAS_ALL[i].id) === id) { openDetailModal('tarefa', TAREFAS_ALL[i]); return; }
      }
    });
    $('tar-mini-board').addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.tar-mini-card.is-draggable') : null;
      if (!card) return;
      DRAG_TAREFA_ID = card.getAttribute('data-id');
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', DRAG_TAREFA_ID); } catch (_e) {}
      }
    });
    $('tar-mini-board').addEventListener('dragend', function (e) {
      var card = e.target.closest ? e.target.closest('.tar-mini-card') : null;
      if (card) card.classList.remove('is-dragging');
      DRAG_TAREFA_ID = null;
      var targets = document.querySelectorAll('.tar-mini-col.is-drop-target');
      for (var i = 0; i < targets.length; i++) targets[i].classList.remove('is-drop-target');
    });
    $('tar-mini-board').addEventListener('dragover', function (e) {
      var col = e.target.closest ? e.target.closest('.tar-mini-col') : null;
      if (!col) return;
      e.preventDefault(); /* obrigatório — sem isso o navegador nunca dispara 'drop' */
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      col.classList.add('is-drop-target');
    });
    $('tar-mini-board').addEventListener('dragleave', function (e) {
      var col = e.target.closest ? e.target.closest('.tar-mini-col') : null;
      if (col && (!e.relatedTarget || !col.contains(e.relatedTarget))) col.classList.remove('is-drop-target');
    });
    $('tar-mini-board').addEventListener('drop', function (e) {
      var col = e.target.closest ? e.target.closest('.tar-mini-col') : null;
      if (!col) return;
      e.preventDefault();
      col.classList.remove('is-drop-target');
      var newStatus = col.getAttribute('data-status');
      var id = DRAG_TAREFA_ID || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (id && newStatus) onDropTarefaStatus(id, newStatus);
    });

    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
