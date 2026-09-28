// lifeos-mcp - Supabase Edge Function
//
// Servidor MCP (Model Context Protocol) remoto do LifeOS (LifeOS)
// -- pensado pra ser cadastrado como "custom connector" em claude.ai (Settings
// > Connectors > Add custom connector, colando a URL desta function + token).
// Expoe tools de CONSULTA sobre todo o sistema (Notas, Tarefas, Projetos,
// Eventos, Manifestações, Citações, Finanças) e tools de ESCRITA em cinco
// domínios: Notas (create_nota, update_nota), Tarefas (create_tarefa,
// update_tarefa), Eventos (create_evento, update_evento), Finanças
// (create_movimentacao, update_movimentacao) e Citações (create_citacao --
// só criar, set/2026). Projetos e Manifestações continuam só-leitura.
//
// Memória de longo prazo (27/set/2026, LIFEOS.md §17): list_memorias,
// get_memoria, create_memoria, add_registro, update_memoria,
// update_registro. Além das tools, o `initialize` devolve `instructions`
// com o ÍNDICE das memórias montado na hora (buildInstructions) -- o cliente
// injeta isso no system prompt e o modelo começa a conversa sabendo o que
// existe, sem gastar uma tool call.
// Nenhum domínio ganha DELETE por aqui -- escrita destrutiva via MCP segue
// fora de escopo, decisão mantida mesmo depois de abrir create/update pra
// além de Notas (22/set/2026).
//
// Histórico: até 22/set/2026 só Notas tinha tool de escrita -- decisão
// explícita do autor (8ª rodada, set/2026): "vamos deixar apenas o notas com
// tool para create" (9ª rodada, set/2026: estendida pra update_nota, mesmo
// domínio, mesmo racional). Revertida a pedido do próprio autor em 22/set/2026
// pra cobrir Tarefas, Eventos e Movimentações também -- ver commit desta
// mudança pro contexto completo.
//
// update_nota é SUBSTITUIÇÃO COMPLETA, nunca um patch parcial -- todos os
// campos (name/tipo/projetos/conteudo_md) são obrigatórios em toda chamada,
// mesmo os que não mudaram. Decisão deliberada (9ª rodada, set/2026): o
// modelo sempre tem o estado atual em mãos (search_notas devolve o
// conteúdo completo antes de qualquer edição), então reenviar tudo é
// barato pra ele e mantém o servidor sem nenhuma lógica de merge/diff --
// um único PATCH que troca cada campo pelo valor final. O motivo de peso
// é `conteudo_md`: exigi-lo sempre, por completo, é o que garante que o
// modelo nunca envie só um trecho/diff do texto -- um envio parcial
// apagaria o resto da nota.
//
// update_tarefa/update_evento/update_movimentacao já são PATCH parcial de
// verdade (só os campos enviados mudam) -- ao contrário de update_nota, não
// há aqui nenhum campo de texto livre grande cujo envio parcial arriscasse
// apagar conteúdo, e esse é o mesmo contrato que lifeos-tarefas/
// lifeos-movimentacoes já expõem pro próprio app (lifeos-eventos é exceção:
// não tinha "update" nenhum até aqui -- ver handleUpdateEvento). update_tarefa
// também troca o projeto vinculado (envie projeto) -- até 23/set/2026 isso
// era bloqueado aqui espelhando uma limitação que na verdade era um bug em
// lifeos-tarefas/handleUpdate (o modal de edição já mandava projeto_id, o
// backend só ignorava); corrigido nos dois lugares.
//
// Transporte: Streamable HTTP, SEM estado entre chamadas (sem Mcp-Session-Id)
// -- cada POST e' um JSON-RPC 2.0 completo e independente, o que combina bem
// com o modelo stateless/efemero de Edge Functions. So POST e' implementado
// de fato (GET pra abrir stream SSE de server push nao e' necessario, ja que
// nenhuma tool empurra notificacao assincrona).
//
// AUTENTICACAO -- 2ª versão deste arquivo, desenho deliberadamente diferente
// do resto do projeto (pedido explícito do autor, 8ª rodada):
//   A 1ª versão pedia a senha mestre como PARÂMETRO em cada tool call. O
//   o autor achou isso pouco prático -- queria o token "na conexão", entrado
//   uma vez só. Claude.ai (custom connector pessoal, fora do fluxo de
//   diretório/enterprise) não expõe hoje um campo de header estático pra
//   conector pessoal -- só URL + OAuth opcional (ver AUTH.md §4 pra mais
//   contexto). A alternativa mais simples e' embutir o token no PRÓPRIO
//   PATH da URL: a Edge Function roteia qualquer sufixo de path pro mesmo
//   código (testado -- POST /lifeos-mcp/<qualquer-coisa> chega aqui igual),
//   então a "conexão" cadastrada em claude.ai é
//   `.../functions/v1/lifeos-mcp/<MCP_TOKEN>` -- colado UMA VEZ ao
//   adicionar o conector, nunca mais digitado.
//
//   O token vinha CHAPADO NO CÓDIGO até set/2026; hoje vem de
//   `admin_config.mcp_token` (ou do secret LIFEOS_MCP_TOKEN) --
//   não é o `access_tokens`/`check_master_token` do resto do app, é uma
//   constante própria só pra este conector, gerada com
//   `openssl rand -hex 32` (256 bits). Comparação simples (===) é
//   suficiente: o espaço de valores é grande demais pra brute-force
//   importar, e é overkill uma comparação timing-safe pra um servidor de
//   uso pessoal único. TODA a superfície (tools/list incluso) fica atrás
//   desse gate -- se o path não bate, nem chega a fazer parse do corpo
//   JSON-RPC.
//
//   verify_jwt = false: sem isso, o runtime da Supabase exigiria um JWT
//   valido no Authorization antes mesmo do codigo rodar -- e o cliente MCP
//   de Claude.ai nao tem ideia do que e' isso.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// O TOKEN NAO MORA MAIS NO CODIGO (set/2026).
//
// Ate esta mudanca ele era uma constante chapada aqui. Enquanto o repo era
// privado isso passava; com o projeto indo pra open-source, publicar este
// arquivo entregaria acesso de LEITURA ao LifeOS inteiro pra qualquer
// pessoa que abrisse o codigo no GitHub. Era o bloqueador numero um de
// tornar o repositorio publico.
//
// Agora vem de `admin_config.mcp_token`, a mesma tabela do github_pat,
// lida com a service role a cada requisicao. Duas consequencias boas:
//   - o valor some do controle de versao;
//   - da pra rotacionar o token sem redeployar a function (a tela
//     lifeos/mcp.html le a URL da mesma linha, entao os dois andam juntos).
//
// `LIFEOS_MCP_TOKEN` tem precedencia se estiver definida como secret --
// util pra quem preferir nao guardar o segredo em tabela.
//
// Gerar um valor: `openssl rand -hex 32` (256 bits).
async function tokenEsperado(REST: string, headers: Record<string, string>): Promise<string> {
  const doAmbiente = Deno.env.get("LIFEOS_MCP_TOKEN");
  if (doAmbiente) return doAmbiente;

  const r = await fetch(`${REST}/admin_config?key=eq.mcp_token&select=value`, { headers });
  if (!r.ok) return "";
  const rows: { value: string }[] = await r.json();
  return rows.length ? rows[0].value : "";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Vocabulários ──────────────────────────────────────────────────────
// Desde a migration 0002 eles vivem em `lifeos_vocabularios`, editáveis em
// LifeOS > menu > Tags. As constantes abaixo viraram FALLBACK: se a leitura
// da tabela falhar, o servidor segue com o vocabulário embutido em vez de
// ficar sem nenhum.
//
// Antes disto havia uma cópia aqui e outra em cada Edge Function de
// domínio; adicionar um valor exigia editar e redeployar as duas.
const FALLBACK: Record<string, string[]> = {
  nota_tipo: ["Lembranças", "Análise de Leitura", "Pensamentos", "Conclusões", "Úteis",
    "Faculdade", "Vida", "Pesquisa", "Programação", "Pessoal", "Relato", "Documentação"],
  tarefa_status: ["Não Iniciado", "Em Andamento", "Feito"],
  tarefa_tipo: ["Vida", "Organização", "Documentação", "Estudo", "Avaliação", "Código", "Freelance", "Trabalho", "Tarefa"],
  projeto_status: ["Não Iniciado", "Em Progresso", "Feito", "Pausado"],
  projeto_tag: ["Pessoal", "Profissional", "Acadêmico", "Configuração"],
  evento_tipo: ["faculdade", "psicodelia", "trabalho", "lazer", "vida"],
  manifestacao_status: ["Não Iniciado", "Em Progresso", "Feito"],
  manifestacao_tag: ["Vida", "Financeiro", "Carreira", "Saúde", "Lazer"],
  mov_direcao: ["Entrada", "Saida"],
  mov_meio: ["Crédito", "Débito", "Pix", "Vale", "Boleto"],
  memoria_categoria: ["Perfil", "Preferências", "Projetos", "Referências", "Vida"],
};

// Preenchido uma vez por invocação, antes de montar as tools -- o enum de
// cada inputSchema precisa da lista já resolvida.
let VOCAB: Record<string, string[]> = { ...FALLBACK };

async function carregarVocab(REST: string, headers: Record<string, string>) {
  try {
    const r = await fetch(`${REST}/lifeos_vocabularios?select=dominio,valor,ordem&order=dominio.asc,ordem.asc`, { headers });
    if (!r.ok) return;
    const rows: { dominio: string; valor: string }[] = await r.json();
    if (!rows.length) return;
    const novo: Record<string, string[]> = {};
    for (const row of rows) (novo[row.dominio] ??= []).push(row.valor);
    // Só sobrescreve os domínios que vieram preenchidos; um domínio vazio
    // na tabela mantém o fallback em vez de zerar a lista.
    VOCAB = { ...FALLBACK, ...novo };
  } catch {
    // mantém o fallback
  }
}


// ── JSON-RPC 2.0 -- helpers de envelope ──────────────────────────────────
function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
// Resultado de tool "bem-sucedido" na semantica MCP -- o texto vira contexto
// pro modelo ler; erros de DOMINIO (filtro invalido, projeto nao encontrado)
// tambem usam este formato com isError:true, nao um erro JSON-RPC -- assim
// o Claude LE o motivo e pode se corrigir, em vez de a chamada simplesmente
// falhar.
function toolText(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// Cópia isolada de noteSnippet() (notas.js/lifeos.js) -- mesmo principio de
// cópia-não-import do resto do projeto (ver LIFEOS.md §2).
function noteSnippet(md: string | null, max = 220): string {
  if (!md) return "";
  const s = md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max).trim() + "…" : s;
}

function clampLimit(v: unknown, def = 20, max = 50): number {
  return Math.max(1, Math.min(max, Number(v) || def));
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Definições das tools (JSON Schema) ────────────────────────────────────
//
// É uma FUNÇÃO, não uma constante: os `enum` de cada inputSchema saem do
// vocabulário carregado do banco a cada invocação. Como constante de módulo
// eles congelariam no fallback, e o modelo veria uma lista de valores
// diferente da que a validação aceita.
function buildTools() {
  return [
  {
    name: "search_notas",
    description:
      "Busca notas do LifeOS por nome, projeto(s) vinculado(s), tipo/tags e " +
      "intervalo de data. Todos os filtros são opcionais e combináveis (AND " +
      "entre filtros diferentes; arrays usam OR internamente). Sem filtro " +
      "nenhum, retorna as notas mais recentes. Cada nota já vem com o " +
      "conteúdo completo em markdown.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Trecho do nome da nota (busca parcial, case-insensitive)." },
        projetos: { type: "array", items: { type: "string" }, description: "Nomes (ou trechos) de projetos vinculados -- entra se bater com QUALQUER UM." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.nota_tipo }, description: "Um ou mais tipos/tags -- entra se tiver QUALQUER UM." },
        data_inicio: { type: "string", description: "Data mínima YYYY-MM-DD (inclusive)." },
        data_fim: { type: "string", description: "Data máxima YYYY-MM-DD (inclusive)." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
      },
    },
  },
  {
    name: "create_nota",
    description:
      "Cria uma nova nota no LifeOS. A data é sempre a data atual (não é um " +
      "parâmetro). Todos os outros campos são obrigatórios: nome, tipo/tags, " +
      "ao menos um projeto vinculado, e o conteúdo completo em markdown.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome/título da nota." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.nota_tipo }, minItems: 1, description: "Um ou mais tipos/tags (vocabulário fixo)." },
        projetos: { type: "array", items: { type: "string" }, minItems: 1, description: "Nomes de um ou mais projetos existentes aos quais vincular a nota." },
        conteudo_md: { type: "string", description: "Conteúdo completo da nota, em markdown." },
      },
      required: ["name", "tipo", "projetos", "conteudo_md"],
    },
  },
  {
    name: "update_nota",
    description:
      "Atualiza uma nota existente do LifeOS -- SUBSTITUIÇÃO COMPLETA, não " +
      "é um patch parcial. Envie TODOS os campos com o valor final " +
      "desejado, incluindo os que não mudaram (use search_notas antes " +
      "para recuperar o estado atual da nota). O parâmetro conteudo_md " +
      "precisa ser o TEXTO INTEIRO e final da nota, em markdown, já com " +
      "os ajustes aplicados -- nunca um trecho, resumo ou diff do que " +
      "mudou; enviar só a parte alterada apaga o resto do conteúdo. A " +
      "data e o histórico de criação da nota não mudam.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da nota a editar (retornado por search_notas)." },
        name: { type: "string", description: "Nome/título final da nota." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.nota_tipo }, minItems: 1, description: "Conjunto final de tipos/tags -- substitui o atual por completo." },
        projetos: { type: "array", items: { type: "string" }, description: "Nomes de TODOS os projetos que a nota deve ter ao final -- substitui os vínculos atuais por completo. Pode ser [] se a nota não deve ficar vinculada a nenhum projeto." },
        conteudo_md: { type: "string", description: "Texto INTEIRO e final da nota, em markdown -- nunca um trecho, resumo ou diff do que mudou." },
      },
      required: ["id", "name", "tipo", "projetos", "conteudo_md"],
    },
  },
  {
    name: "search_tarefas",
    description:
      "Busca tarefas do LifeOS por nome, projeto, status, tipo e intervalo " +
      "de data de entrega. Todos os filtros são opcionais e combináveis.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Trecho do nome da tarefa." },
        projetos: { type: "array", items: { type: "string" }, description: "Nomes (ou trechos) do projeto vinculado." },
        status: { type: "string", enum: VOCAB.tarefa_status, description: "Status exato da tarefa." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.tarefa_tipo }, description: "Um ou mais tipos -- entra se tiver QUALQUER UM." },
        data_entrega_inicio: { type: "string", description: "Data de entrega mínima YYYY-MM-DD (inclusive)." },
        data_entrega_fim: { type: "string", description: "Data de entrega máxima YYYY-MM-DD (inclusive)." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
      },
    },
  },
  {
    name: "create_tarefa",
    description:
      "Cria uma nova tarefa no LifeOS. Toda tarefa é obrigatoriamente " +
      "vinculada a um projeto existente -- use search_projetos antes se " +
      "não souber o nome exato. status, quando omitido, começa como " +
      "'Não Iniciado' (mesmo padrão da tela).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome da tarefa." },
        projeto: { type: "string", description: "Nome (ou trecho único) do projeto ao qual vincular a tarefa." },
        status: { type: "string", enum: VOCAB.tarefa_status, description: "Status inicial (padrão: 'Não Iniciado')." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.tarefa_tipo }, description: "Tipos/tags da tarefa (opcional, pode ficar vazio)." },
        data_entrega: { type: "string", description: "Data de entrega YYYY-MM-DD (opcional)." },
      },
      required: ["name", "projeto"],
    },
  },
  {
    name: "update_tarefa",
    description:
      "Atualiza uma tarefa existente do LifeOS -- PATCH parcial: só os " +
      "campos enviados mudam, os demais ficam como estão. Inclui trocar " +
      "o projeto vinculado (envie projeto).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da tarefa a editar (retornado por search_tarefas)." },
        name: { type: "string", description: "Novo nome da tarefa." },
        status: { type: "string", enum: VOCAB.tarefa_status, description: "Novo status." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.tarefa_tipo }, description: "Conjunto final de tipos/tags -- substitui o atual por completo (pode ser [])." },
        data_entrega: { type: "string", description: "Nova data de entrega YYYY-MM-DD, ou \"\"/null pra remover." },
        projeto: { type: "string", description: "Nome (ou trecho único) do novo projeto ao qual vincular a tarefa -- toda tarefa precisa de um, não pode ficar sem." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_projetos",
    description: "Busca projetos do LifeOS por nome, status e tags. Todos os filtros são opcionais e combináveis.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Trecho do nome do projeto." },
        status: { type: "string", enum: VOCAB.projeto_status, description: "Status exato do projeto." },
        tags: { type: "array", items: { type: "string", enum: VOCAB.projeto_tag }, description: "Uma ou mais tags -- entra se tiver QUALQUER UMA." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
      },
    },
  },
  {
    name: "search_eventos",
    description:
      "Busca eventos do calendário do LifeOS por nome, tipo, projeto e " +
      "intervalo de data. Todos os filtros são opcionais e combináveis.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Trecho do nome do evento." },
        tipo: { type: "array", items: { type: "string", enum: VOCAB.evento_tipo }, description: "Um ou mais tipos -- entra se tiver QUALQUER UM." },
        projetos: { type: "array", items: { type: "string" }, description: "Nomes (ou trechos) do projeto vinculado (nem todo evento tem um)." },
        data_inicio: { type: "string", description: "Data mínima YYYY-MM-DD (inclusive) -- eventos de vários dias que se SOBREPÕEM ao intervalo também entram, não só os que começam dentro dele." },
        data_fim: { type: "string", description: "Data máxima YYYY-MM-DD (inclusive)." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
      },
    },
  },
  {
    name: "create_evento",
    description:
      "Cria um novo evento no calendário do LifeOS. date_fim é opcional " +
      "(só pra eventos de vários dias -- quando enviado, não pode ser " +
      "anterior a date). projeto é opcional -- nem todo evento pertence " +
      "a um projeto.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome do evento." },
        date: { type: "string", description: "Data de início, YYYY-MM-DD." },
        date_fim: { type: "string", description: "Data final YYYY-MM-DD, só para eventos de vários dias (opcional)." },
        tipo: { type: "string", enum: VOCAB.evento_tipo, description: "Tipo do evento." },
        projeto: { type: "string", description: "Nome (ou trecho único) de um projeto vinculado (opcional)." },
      },
      required: ["name", "date", "tipo"],
    },
  },
  {
    name: "update_evento",
    description:
      "Atualiza um evento existente do LifeOS -- PATCH parcial: só os " +
      "campos enviados mudam. Envie date_fim como \"\" ou null pra " +
      "remover a data final (voltar a ser evento de um dia só); envie " +
      "projeto como \"\" ou null pra desvincular do projeto atual.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id do evento a editar (retornado por search_eventos)." },
        name: { type: "string", description: "Novo nome do evento." },
        date: { type: "string", description: "Nova data de início, YYYY-MM-DD." },
        date_fim: { type: "string", description: "Nova data final YYYY-MM-DD, ou \"\"/null pra remover." },
        tipo: { type: "string", enum: VOCAB.evento_tipo, description: "Novo tipo do evento." },
        projeto: { type: "string", description: "Novo projeto vinculado, ou \"\"/null pra desvincular." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_manifestacoes",
    description: "Busca manifestações do LifeOS por nome, status e tags. Todos os filtros são opcionais e combináveis.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Trecho do nome da manifestação." },
        status: { type: "string", enum: VOCAB.manifestacao_status, description: "Status exato." },
        tags: { type: "array", items: { type: "string", enum: VOCAB.manifestacao_tag }, description: "Uma ou mais tags -- entra se tiver QUALQUER UMA." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
      },
    },
  },
  {
    name: "search_citacoes",
    description:
      "Lê as citações guardadas no LifeOS (texto + quem disse). Sem " +
      "filtros devolve todas. Trechos entre *asteriscos* no texto são " +
      "destaques visuais do app, não parte da frase.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Trecho do texto da citação." },
        autor: { type: "string", description: "Trecho do nome de quem disse." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
      },
    },
  },
  {
    name: "create_citacao",
    description:
      "Adiciona uma citação ao LifeOS. Ela passa a concorrer ao sorteio do " +
      "banner do painel. Envolva um trecho em *asteriscos* para destacá-lo " +
      "(ex.: \"elimine *duas coisas*\") — opcional.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "O texto da citação, sem aspas em volta." },
        autor: { type: "string", description: "Nome de quem disse." },
      },
      required: ["texto", "autor"],
    },
  },
  {
    name: "list_memorias",
    description:
      "Lista o ÍNDICE da memória de longo prazo sobre o usuário: título, " +
      "categoria, descrição curta e nº de registros de cada memória -- sem " +
      "o conteúdo. Use para descobrir quais memórias existem e depois abra " +
      "as relevantes com get_memoria. O mesmo índice já vem nas instruções " +
      "do servidor ao conectar; chame esta tool para conferir a versão atual.",
    inputSchema: {
      type: "object",
      properties: {
        categoria: { type: "string", enum: VOCAB.memoria_categoria, description: "Filtra por uma categoria (opcional)." },
      },
    },
  },
  {
    name: "get_memoria",
    description:
      "Abre uma ou mais memórias e devolve todos os registros de cada uma, em " +
      "ordem cronológica, com data e origem. Cada registro reflete o que era " +
      "verdade QUANDO foi escrito -- confira a data antes de tratar um fato " +
      "antigo como atual.",
    inputSchema: {
      type: "object",
      properties: {
        memorias: {
          type: "array", items: { type: "string" }, minItems: 1,
          description: "Títulos (exatos ou trecho único) ou ids das memórias a abrir.",
        },
      },
      required: ["memorias"],
    },
  },
  {
    name: "create_memoria",
    description:
      "Cria uma memória nova (um TEMA) sobre o usuário. Só use quando nenhuma " +
      "memória existente cobre o assunto -- se já existir uma, adicione um " +
      "registro nela com add_registro. O título é único. A descrição é o que " +
      "aparece no índice: uma ou duas frases dizendo do que a memória trata, " +
      "pra que um modelo decida se vale abri-la sem ler o conteúdo.",
    inputSchema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Título curto e específico (máx. 120 caracteres)." },
        descricao: { type: "string", description: "Uma ou duas frases sobre do que a memória trata (máx. 400 caracteres)." },
        categoria: { type: "string", enum: VOCAB.memoria_categoria, description: "Categoria da memória." },
        registros: { type: "array", items: { type: "string" }, description: "Registros iniciais -- um fato por item (opcional)." },
        origem: { type: "string", description: "Quem está escrevendo: o cliente/harness, ex.: 'claude-code', 'claude.ai'." },
      },
      required: ["titulo", "descricao", "categoria"],
    },
  },
  {
    name: "add_registro",
    description:
      "Acrescenta um registro (um fato datado) a uma memória existente. É a " +
      "forma normal de a memória crescer. Um registro = um fato autocontido, " +
      "legível sem o resto da conversa. Não registre o que é efêmero (o que " +
      "só importa nesta conversa) nem o que já está registrado -- se um fato " +
      "antigo mudou, corrija-o com update_registro em vez de duplicar.",
    inputSchema: {
      type: "object",
      properties: {
        memoria: { type: "string", description: "Título (exato ou trecho único) ou id da memória." },
        texto: { type: "string", description: "O fato, em texto corrido (máx. 8000 caracteres)." },
        origem: { type: "string", description: "Quem está escrevendo: o cliente/harness, ex.: 'claude-code', 'claude.ai'." },
      },
      required: ["memoria", "texto"],
    },
  },
  {
    name: "update_memoria",
    description:
      "Atualiza título, descrição e/ou categoria de uma memória -- PATCH " +
      "parcial: só os campos enviados mudam. Os registros não são tocados.",
    inputSchema: {
      type: "object",
      properties: {
        memoria: { type: "string", description: "Título atual (exato ou trecho único) ou id da memória." },
        titulo: { type: "string", description: "Novo título." },
        descricao: { type: "string", description: "Nova descrição." },
        categoria: { type: "string", enum: VOCAB.memoria_categoria, description: "Nova categoria." },
      },
      required: ["memoria"],
    },
  },
  {
    name: "update_registro",
    description:
      "Corrige o texto de um registro existente (id vem de get_memoria). " +
      "SUBSTITUIÇÃO: envie o TEXTO INTEIRO e final do registro, nunca só o " +
      "trecho que mudou. A data original do registro se mantém. Excluir " +
      "memórias ou registros não é possível por aqui -- só pela tela do LifeOS.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id do registro (retornado por get_memoria)." },
        texto: { type: "string", description: "Texto INTEIRO e final do registro." },
      },
      required: ["id", "texto"],
    },
  },
  {
    name: "resumo_financeiro",
    description:
      "Panorama financeiro de um mês (ou comparação de até 12 meses) já " +
      "AGREGADO com as mesmas regras da tela de Finanças do LifeOS -- use " +
      "esta tool para qualquer pergunta sobre quanto entrou, saiu, sobrou ou " +
      "está devendo, em vez de somar linhas de search_movimentacoes (somar " +
      "linhas cruas conta a compra no crédito e o pagamento da fatura duas " +
      "vezes). Significado dos campos: saidas_caixa = o que saiu do caixa no " +
      "mês (sem compras no crédito); saidas_com_credito = todas as saídas, " +
      "inclusive crédito; saldo = saldo_abertura (sobra dos meses anteriores) " +
      "+ variacao_mes; lançamentos com data futura contam nos totais mas não " +
      "no saldo. fatura_deste_mes = compras no crédito do mês anterior que " +
      "fecham agora, com quanto já foi pago; fatura_projetada = compras no " +
      "crédito deste mês, por fatura futura. Sem parâmetros, resume o mês atual.",
    inputSchema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Um mês, YYYY-MM." },
        de: { type: "string", description: "Primeiro mês de um intervalo, YYYY-MM (use com ate)." },
        ate: { type: "string", description: "Último mês do intervalo, YYYY-MM (máx. 12 meses)." },
      },
    },
  },
  {
    name: "search_movimentacoes",
    description:
      "Busca movimentações financeiras do LifeOS por nome, direção " +
      "(Entrada/Saida), meio de pagamento, intervalo de data e faixa de " +
      "valor. Todos os filtros são opcionais e combináveis. Serve pra " +
      "descer ao detalhe (quais lançamentos, de quê); pra totais e saldo, " +
      "use resumo_financeiro. Com data_inicio E data_fim, o limite sobe " +
      "pra 300 -- um mês inteiro cabe numa chamada.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Trecho do nome/descrição da movimentação." },
        direcao: { type: "string", enum: VOCAB.mov_direcao, description: "Entrada ou Saida." },
        meio: { type: "array", items: { type: "string", enum: VOCAB.mov_meio }, description: "Um ou mais meios -- entra se tiver QUALQUER UM." },
        data_inicio: { type: "string", description: "Data mínima YYYY-MM-DD (inclusive)." },
        data_fim: { type: "string", description: "Data máxima YYYY-MM-DD (inclusive)." },
        valor_min: { type: "number", description: "Valor mínimo (inclusive)." },
        valor_max: { type: "number", description: "Valor máximo (inclusive)." },
        limit: { type: "integer", description: "Máximo de resultados (padrão 20; máximo 50, ou 300 com data_inicio e data_fim)." },
      },
    },
  },
  {
    name: "create_movimentacao",
    description:
      "Cria uma nova movimentação financeira no LifeOS. direcao e meio " +
      "viram um único campo `tipo` (array) na tabela -- aqui vêm " +
      "separados, mesmo padrão de search_movimentacoes.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome/descrição da movimentação." },
        valor: { type: "number", description: "Valor (não-negativo)." },
        date: { type: "string", description: "Data YYYY-MM-DD." },
        direcao: { type: "string", enum: VOCAB.mov_direcao, description: "Entrada ou Saida." },
        meio: { type: "array", items: { type: "string", enum: VOCAB.mov_meio }, description: "Meio(s) de pagamento (opcional, pode ficar vazio)." },
      },
      required: ["name", "valor", "date", "direcao"],
    },
  },
  {
    name: "update_movimentacao",
    description:
      "Atualiza uma movimentação financeira existente -- PATCH parcial: " +
      "só os campos enviados mudam. direcao e meio são independentes -- " +
      "enviar só um dos dois mantém o outro como está hoje (os dois " +
      "juntos formam o `tipo` final na tabela).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da movimentação a editar (retornado por search_movimentacoes)." },
        name: { type: "string", description: "Novo nome/descrição." },
        valor: { type: "number", description: "Novo valor (não-negativo)." },
        date: { type: "string", description: "Nova data YYYY-MM-DD." },
        direcao: { type: "string", enum: VOCAB.mov_direcao, description: "Nova direção (Entrada/Saida)." },
        meio: { type: "array", items: { type: "string", enum: VOCAB.mov_meio }, description: "Novo(s) meio(s) de pagamento." },
      },
      required: ["id"],
    },
  },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const REST = `${SUPABASE_URL}/rest/v1`;
  const restHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  await carregarVocab(REST, restHeaders);

  // Auth de CONEXÃO: token embutido no próprio path da URL (ver comentário
  // grande no topo do arquivo). Checado ANTES de tocar no corpo JSON-RPC --
  // toda a superfície, tools/list incluso, fica atrás disso.
  const esperado = await tokenEsperado(REST, restHeaders);
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const providedToken = segments[segments.length - 1] || "";

  // Sem token configurado, NINGUEM entra. O contrario (liberar quando a
  // config falta) transformaria um erro de instalacao num servidor aberto.
  if (!esperado || providedToken !== esperado) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return respond(rpcError(null, -32700, "Parse error"));
  }

  // Notificacao (sem "id") -- por spec, servidor nao responde. O unico caso
  // que o cliente MCP manda e' "notifications/initialized", apos o handshake.
  if (msg && typeof msg === "object" && !("id" in msg) && "method" in msg) {
    return new Response(null, { status: 202, headers: cors });
  }

  const id = msg?.id ?? null;
  const method = msg?.method;
  const params = msg?.params ?? {};

  try {
    if (method === "initialize") {
      return respond(rpcResult(id, {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "lifeos-mcp", version: "2.3.0" },
        instructions: await buildInstructions(REST, restHeaders),
      }));
    }

    if (method === "ping") return respond(rpcResult(id, {}));

    if (method === "tools/list") {
      return respond(rpcResult(id, { tools: buildTools() }));
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments ?? {};
      const handlers: Record<string, (args: Record<string, any>) => Promise<unknown>> = {
        search_notas: (a) => handleSearchNotas(REST, restHeaders, a),
        create_nota: (a) => handleCreateNota(REST, restHeaders, a),
        update_nota: (a) => handleUpdateNota(REST, restHeaders, a),
        search_tarefas: (a) => handleSearchTarefas(REST, restHeaders, a),
        create_tarefa: (a) => handleCreateTarefa(REST, restHeaders, a),
        update_tarefa: (a) => handleUpdateTarefa(REST, restHeaders, a),
        search_projetos: (a) => handleSearchProjetos(REST, restHeaders, a),
        search_eventos: (a) => handleSearchEventos(REST, restHeaders, a),
        create_evento: (a) => handleCreateEvento(REST, restHeaders, a),
        update_evento: (a) => handleUpdateEvento(REST, restHeaders, a),
        search_manifestacoes: (a) => handleSearchManifestacoes(REST, restHeaders, a),
        search_citacoes: (a) => handleSearchCitacoes(REST, restHeaders, a),
        create_citacao: (a) => handleCreateCitacao(REST, restHeaders, a),
        list_memorias: (a) => handleListMemorias(REST, restHeaders, a),
        get_memoria: (a) => handleGetMemoria(REST, restHeaders, a),
        create_memoria: (a) => handleCreateMemoria(REST, restHeaders, a),
        add_registro: (a) => handleAddRegistro(REST, restHeaders, a),
        update_memoria: (a) => handleUpdateMemoria(REST, restHeaders, a),
        update_registro: (a) => handleUpdateRegistro(REST, restHeaders, a),
        resumo_financeiro: (a) => handleResumoFinanceiro(REST, restHeaders, a),
        search_movimentacoes: (a) => handleSearchMovimentacoes(REST, restHeaders, a),
        create_movimentacao: (a) => handleCreateMovimentacao(REST, restHeaders, a),
        update_movimentacao: (a) => handleUpdateMovimentacao(REST, restHeaders, a),
      };
      const handler = handlers[toolName];
      if (!handler) return respond(rpcError(id, -32602, `Unknown tool: ${String(toolName)}`));
      return respond(rpcResult(id, await handler(args)));
    }

    return respond(rpcError(id, -32601, `Method not found: ${String(method)}`));
  } catch (e) {
    return respond(rpcError(id, -32603, String(e)));
  }
});

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Projetos: fetch compartilhado por várias tools (join/label/filtro) ───
type ProjetoRow = { id: string; name: string; emoji: string | null; status: string; tags: string[] };
async function fetchAllProjetos(REST: string, headers: Record<string, string>): Promise<ProjetoRow[]> {
  const r = await fetch(`${REST}/lifeos_projetos?order=name.asc`, { headers });
  if (!r.ok) throw new Error(`select projetos -> ${r.status} ${await r.text()}`);
  return r.json();
}
function projetoLabel(p: { name: string; emoji: string | null }) {
  return (p.emoji ? p.emoji + " " : "") + p.name;
}
// Resolve termos de filtro (substring, case-insensitive) pra um conjunto de
// projeto_ids -- usado por qualquer tool que filtre "por projeto vinculado".
// Mesmo padrão em todo domínio: nunca falha, só relata warnings se algum
// termo não bater com nenhum projeto (o filtro resultante fica vazio, então
// nada passa -- reflete corretamente "esse projeto não existe").
function resolveProjetoFiltro(projetos: ProjetoRow[], termosRaw: string[]): { ids: Set<string> | null; warnings: string[] } {
  const termos = termosRaw.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!termos.length) return { ids: null, warnings: [] };
  const matched = new Set<string>();
  const warnings: string[] = [];
  for (const termo of termos) {
    const hits = projetos.filter((p) => p.name.toLowerCase().includes(termo));
    if (!hits.length) warnings.push(`nenhum projeto encontrado com "${termo}"`);
    hits.forEach((p) => matched.add(p.id));
  }
  return { ids: matched, warnings };
}

// ── Tool: search_notas ────────────────────────────────────────────────────
async function fetchProjetoIdsByNota(REST: string, headers: Record<string, string>, notaIds: string[]) {
  const map: Record<string, string[]> = {};
  if (!notaIds.length) return map;
  const idsFilter = notaIds.join(",");
  const r = await fetch(`${REST}/lifeos_notas_projetos?nota_id=in.(${idsFilter})`, { headers });
  if (!r.ok) throw new Error(`select notas_projetos -> ${r.status} ${await r.text()}`);
  const rows: { nota_id: string; projeto_id: string }[] = await r.json();
  for (const row of rows) {
    if (!map[row.nota_id]) map[row.nota_id] = [];
    map[row.nota_id].push(row.projeto_id);
  }
  return map;
}

async function handleSearchNotas(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const nome = args?.nome ? String(args.nome).trim().toLowerCase() : "";
  const tipoFiltro = strArray(args?.tipo);
  const dataInicio = args?.data_inicio ? String(args.data_inicio) : "";
  const dataFim = args?.data_fim ? String(args.data_fim) : "";
  const limit = clampLimit(args?.limit);

  const invalidTipo = tipoFiltro.filter((t) => !VOCAB.nota_tipo.includes(t));
  if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.nota_tipo.join(", ")}.`, true);

  const [notasRes, projetos] = await Promise.all([
    fetch(`${REST}/lifeos_notas?order=data.desc.nullslast,created_at.desc`, { headers }),
    fetchAllProjetos(REST, headers),
  ]);
  if (!notasRes.ok) throw new Error(`select notas -> ${notasRes.status} ${await notasRes.text()}`);
  const rows = await notasRes.json();
  const projetoMap = await fetchProjetoIdsByNota(REST, headers, rows.map((r: any) => r.id));
  const projetoById = new Map(projetos.map((p) => [p.id, p]));

  const { ids: projetoIdsFiltro, warnings } = resolveProjetoFiltro(projetos, strArray(args?.projetos));

  let notas = rows.map((row: any) => ({
    id: row.id, name: row.name, tipo: row.tipo ?? [], data: row.data,
    conteudo_md: row.conteudo_md, projeto_ids: projetoMap[row.id] ?? [],
  }));

  if (nome) notas = notas.filter((n: any) => n.name.toLowerCase().includes(nome));
  if (tipoFiltro.length) notas = notas.filter((n: any) => (n.tipo || []).some((t: string) => tipoFiltro.includes(t)));
  if (projetoIdsFiltro) notas = notas.filter((n: any) => (n.projeto_ids || []).some((pid: string) => projetoIdsFiltro.has(pid)));
  if (dataInicio) notas = notas.filter((n: any) => n.data && n.data >= dataInicio);
  if (dataFim) notas = notas.filter((n: any) => n.data && n.data <= dataFim);

  const totalMatches = notas.length;
  const returned = notas.slice(0, limit).map((n: any) => ({
    id: n.id, name: n.name, tipo: n.tipo, data: n.data,
    projetos: (n.projeto_ids || []).map((pid: string) => projetoById.get(pid)).filter(Boolean).map((p: any) => ({ id: p.id, name: projetoLabel(p) })),
    snippet: noteSnippet(n.conteudo_md),
    conteudo_md: n.conteudo_md,
  }));

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length,
    warnings: warnings.length ? warnings : undefined, notas: returned,
  }, null, 2));
}

// ── Tool: create_nota (única tool de escrita deste servidor) ─────────────
async function resolveProjetoNomes(projetos: ProjetoRow[], nomes: string[]) {
  const resolved: { id: string; name: string }[] = [];
  const naoEncontrados: string[] = [];
  for (const nomeRaw of nomes) {
    const nome = nomeRaw.trim();
    const nomeLower = nome.toLowerCase();
    let hit = projetos.find((p) => p.name.toLowerCase() === nomeLower);
    if (!hit) {
      const candidatos = projetos.filter((p) => p.name.toLowerCase().includes(nomeLower));
      if (candidatos.length === 1) hit = candidatos[0];
    }
    if (hit) resolved.push({ id: hit.id, name: projetoLabel(hit) });
    else naoEncontrados.push(nome);
  }
  return { resolved, naoEncontrados };
}

async function handleCreateNota(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const name = String(args?.name ?? "").trim();
  if (!name) return toolText("O parâmetro name (nome da nota) é obrigatório e não pode ser vazio.", true);

  const tipo = strArray(args?.tipo);
  if (!tipo.length) return toolText("O parâmetro tipo é obrigatório e precisa ter ao menos um valor.", true);
  const invalidTipo = tipo.filter((t) => !VOCAB.nota_tipo.includes(t));
  if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.nota_tipo.join(", ")}.`, true);

  const projetosNomes = strArray(args?.projetos);
  if (!projetosNomes.length) return toolText("O parâmetro projetos é obrigatório e precisa ter ao menos um nome de projeto.", true);

  const conteudo_md = typeof args?.conteudo_md === "string" ? args.conteudo_md.trim() : "";
  if (!conteudo_md) return toolText("O parâmetro conteudo_md é obrigatório e não pode ser vazio.", true);

  const projetos = await fetchAllProjetos(REST, headers);
  const { resolved, naoEncontrados } = await resolveProjetoNomes(projetos, projetosNomes);
  if (naoEncontrados.length) {
    const disponiveis = projetos.map((p) => p.name).join(", ");
    return toolText(`Projeto(s) não encontrado(s) ou ambíguo(s): ${naoEncontrados.join(", ")}. Projetos existentes: ${disponiveis}.`, true);
  }

  const data = todayInSaoPaulo();
  const insertRes = await fetch(`${REST}/lifeos_notas`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, tipo, data, conteudo_md }),
  });
  if (!insertRes.ok) return toolText(`Erro ao salvar a nota: ${insertRes.status} ${await insertRes.text()}`, true);
  const created = (await insertRes.json())[0];

  const linkRows = resolved.map((p) => ({ nota_id: created.id, projeto_id: p.id }));
  const linkRes = await fetch(`${REST}/lifeos_notas_projetos`, { method: "POST", headers, body: JSON.stringify(linkRows) });
  if (!linkRes.ok) return toolText(`Nota criada (id ${created.id}), mas falhou ao vincular projetos: ${linkRes.status} ${await linkRes.text()}`, true);

  return toolText(JSON.stringify({
    ok: true,
    nota: { id: created.id, name: created.name, tipo: created.tipo ?? [], data: created.data, projetos: resolved, conteudo_md: created.conteudo_md, created_at: created.created_at },
  }, null, 2));
}

// ── Tool: update_nota (substituição completa, nunca patch parcial) ───────
// Mesmo contrato de setProjetoLinks() em lifeos-notas/index.ts (delete
// tudo + insere de novo -- nunca um diff dos vínculos). Cópia isolada, ver
// LIFEOS.md §2: este servidor não importa nada de lifeos-notas.
async function handleUpdateNota(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const id = String(args?.id ?? "").trim();
  if (!id) return toolText("O parâmetro id (id da nota a editar, retornado por search_notas) é obrigatório.", true);

  const name = String(args?.name ?? "").trim();
  if (!name) return toolText("O parâmetro name (nome da nota) é obrigatório e não pode ser vazio.", true);

  const tipo = strArray(args?.tipo);
  if (!tipo.length) return toolText("O parâmetro tipo é obrigatório e precisa ter ao menos um valor.", true);
  const invalidTipo = tipo.filter((t) => !VOCAB.nota_tipo.includes(t));
  if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.nota_tipo.join(", ")}.`, true);

  if (!Array.isArray(args?.projetos)) {
    return toolText("O parâmetro projetos é obrigatório -- envie a lista completa de projetos vinculados (pode ser [] se a nota não deve ter nenhum).", true);
  }
  const projetosNomes = strArray(args.projetos);

  const conteudo_md = typeof args?.conteudo_md === "string" ? args.conteudo_md.trim() : "";
  if (!conteudo_md) {
    return toolText("O parâmetro conteudo_md é obrigatório e precisa ser o TEXTO INTEIRO e final da nota (nunca um trecho, resumo ou diff).", true);
  }

  const projetos = await fetchAllProjetos(REST, headers);
  const { resolved, naoEncontrados } = await resolveProjetoNomes(projetos, projetosNomes);
  if (naoEncontrados.length) {
    const disponiveis = projetos.map((p) => p.name).join(", ");
    return toolText(`Projeto(s) não encontrado(s) ou ambíguo(s): ${naoEncontrados.join(", ")}. Projetos existentes: ${disponiveis}.`, true);
  }

  const updateRes = await fetch(`${REST}/lifeos_notas?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, tipo, conteudo_md, updated_at: new Date().toISOString() }),
  });
  if (!updateRes.ok) return toolText(`Erro ao atualizar a nota: ${updateRes.status} ${await updateRes.text()}`, true);
  const updatedRows = await updateRes.json();
  if (!updatedRows.length) return toolText(`Nenhuma nota encontrada com id ${id}.`, true);
  const updated = updatedRows[0];

  const delRes = await fetch(`${REST}/lifeos_notas_projetos?nota_id=eq.${id}`, { method: "DELETE", headers });
  if (!delRes.ok) return toolText(`Nota atualizada, mas falhou ao limpar vínculos antigos de projeto: ${delRes.status} ${await delRes.text()}`, true);
  if (resolved.length) {
    const linkRows = resolved.map((p) => ({ nota_id: id, projeto_id: p.id }));
    const linkRes = await fetch(`${REST}/lifeos_notas_projetos`, { method: "POST", headers, body: JSON.stringify(linkRows) });
    if (!linkRes.ok) return toolText(`Nota atualizada, mas falhou ao vincular projetos: ${linkRes.status} ${await linkRes.text()}`, true);
  }

  return toolText(JSON.stringify({
    ok: true,
    nota: { id: updated.id, name: updated.name, tipo: updated.tipo ?? [], data: updated.data, projetos: resolved, conteudo_md: updated.conteudo_md, updated_at: updated.updated_at },
  }, null, 2));
}

// ── Tool: search_tarefas ──────────────────────────────────────────────────
async function handleSearchTarefas(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const nome = args?.nome ? String(args.nome).trim().toLowerCase() : "";
  const status = args?.status ? String(args.status) : "";
  if (status && !VOCAB.tarefa_status.includes(status)) return toolText(`Status inválido: ${status}. Valores aceitos: ${VOCAB.tarefa_status.join(", ")}.`, true);
  const tipoFiltro = strArray(args?.tipo);
  const invalidTipo = tipoFiltro.filter((t) => !VOCAB.tarefa_tipo.includes(t));
  if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.tarefa_tipo.join(", ")}.`, true);
  const dataInicio = args?.data_entrega_inicio ? String(args.data_entrega_inicio) : "";
  const dataFim = args?.data_entrega_fim ? String(args.data_entrega_fim) : "";
  const limit = clampLimit(args?.limit);

  const [tarefasRes, projetos] = await Promise.all([
    fetch(`${REST}/lifeos_tarefas?order=created_at.asc`, { headers }),
    fetchAllProjetos(REST, headers),
  ]);
  if (!tarefasRes.ok) throw new Error(`select tarefas -> ${tarefasRes.status} ${await tarefasRes.text()}`);
  const rows = await tarefasRes.json();
  const projetoById = new Map(projetos.map((p) => [p.id, p]));
  const { ids: projetoIdsFiltro, warnings } = resolveProjetoFiltro(projetos, strArray(args?.projetos));

  let tarefas = rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status, tipo: r.tipo ?? [], projeto_id: r.projeto_id, data_entrega: r.data_entrega }));

  if (nome) tarefas = tarefas.filter((t: any) => t.name.toLowerCase().includes(nome));
  if (status) tarefas = tarefas.filter((t: any) => t.status === status);
  if (tipoFiltro.length) tarefas = tarefas.filter((t: any) => (t.tipo || []).some((x: string) => tipoFiltro.includes(x)));
  if (projetoIdsFiltro) tarefas = tarefas.filter((t: any) => projetoIdsFiltro.has(t.projeto_id));
  if (dataInicio) tarefas = tarefas.filter((t: any) => t.data_entrega && t.data_entrega >= dataInicio);
  if (dataFim) tarefas = tarefas.filter((t: any) => t.data_entrega && t.data_entrega <= dataFim);

  const totalMatches = tarefas.length;
  const returned = tarefas.slice(0, limit).map((t: any) => ({
    id: t.id, name: t.name, status: t.status, tipo: t.tipo, data_entrega: t.data_entrega,
    projeto: projetoById.has(t.projeto_id) ? { id: t.projeto_id, name: projetoLabel(projetoById.get(t.projeto_id)!) } : null,
  }));

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length,
    warnings: warnings.length ? warnings : undefined, tarefas: returned,
  }, null, 2));
}

// ── Tool: create_tarefa ───────────────────────────────────────────────────
async function handleCreateTarefa(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const name = String(args?.name ?? "").trim();
  if (!name) return toolText("O parâmetro name (nome da tarefa) é obrigatório e não pode ser vazio.", true);

  const status = args?.status ? String(args.status) : "Não Iniciado";
  if (!VOCAB.tarefa_status.includes(status)) return toolText(`Status inválido: ${status}. Valores aceitos: ${VOCAB.tarefa_status.join(", ")}.`, true);

  const tipo = strArray(args?.tipo);
  const invalidTipo = tipo.filter((t) => !VOCAB.tarefa_tipo.includes(t));
  if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.tarefa_tipo.join(", ")}.`, true);

  const projetoNome = String(args?.projeto ?? "").trim();
  if (!projetoNome) return toolText("O parâmetro projeto é obrigatório -- toda tarefa do LifeOS pertence a um projeto.", true);

  const projetos = await fetchAllProjetos(REST, headers);
  const { resolved, naoEncontrados } = await resolveProjetoNomes(projetos, [projetoNome]);
  if (naoEncontrados.length) {
    return toolText(`Projeto não encontrado ou ambíguo: ${projetoNome}. Projetos existentes: ${projetos.map((p) => p.name).join(", ")}.`, true);
  }
  const projeto = resolved[0];

  const dataEntregaRaw = args?.data_entrega;
  const data_entrega = (typeof dataEntregaRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dataEntregaRaw)) ? dataEntregaRaw : null;

  const insertRes = await fetch(`${REST}/lifeos_tarefas`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, status, tipo, projeto_id: projeto.id, data_entrega }),
  });
  if (!insertRes.ok) return toolText(`Erro ao criar a tarefa: ${insertRes.status} ${await insertRes.text()}`, true);
  const created = (await insertRes.json())[0];

  return toolText(JSON.stringify({
    ok: true,
    tarefa: { id: created.id, name: created.name, status: created.status, tipo: created.tipo ?? [], projeto, data_entrega: created.data_entrega },
  }, null, 2));
}

// ── Tool: update_tarefa (PATCH parcial) ───────────────────────────────────
async function handleUpdateTarefa(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const id = String(args?.id ?? "").trim();
  if (!id) return toolText("O parâmetro id (id da tarefa a editar, retornado por search_tarefas) é obrigatório.", true);

  const update: Record<string, any> = {};

  if (args?.name !== undefined) {
    const name = String(args.name).trim();
    if (!name) return toolText("O parâmetro name, quando enviado, não pode ser vazio.", true);
    update.name = name;
  }
  if (args?.status !== undefined) {
    const status = String(args.status);
    if (!VOCAB.tarefa_status.includes(status)) return toolText(`Status inválido: ${status}. Valores aceitos: ${VOCAB.tarefa_status.join(", ")}.`, true);
    update.status = status;
  }
  if (args?.tipo !== undefined) {
    const tipo = strArray(args.tipo);
    const invalidTipo = tipo.filter((t) => !VOCAB.tarefa_tipo.includes(t));
    if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.tarefa_tipo.join(", ")}.`, true);
    update.tipo = tipo;
  }
  if (args?.data_entrega !== undefined) {
    const v = args.data_entrega;
    update.data_entrega = (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
  }
  if (args?.projeto !== undefined) {
    const projetoNome = String(args.projeto ?? "").trim();
    if (!projetoNome) return toolText("O parâmetro projeto, quando enviado, não pode ser vazio -- toda tarefa precisa de um projeto vinculado.", true);
    const projetos = await fetchAllProjetos(REST, headers);
    const { resolved, naoEncontrados } = await resolveProjetoNomes(projetos, [projetoNome]);
    if (naoEncontrados.length) {
      return toolText(`Projeto não encontrado ou ambíguo: ${projetoNome}. Projetos existentes: ${projetos.map((p) => p.name).join(", ")}.`, true);
    }
    update.projeto_id = resolved[0].id;
  }
  if (!Object.keys(update).length) return toolText("Nenhum campo pra atualizar foi enviado -- envie ao menos um de: name, status, tipo, data_entrega, projeto.", true);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_tarefas?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return toolText(`Erro ao atualizar a tarefa: ${r.status} ${await r.text()}`, true);
  const rows = await r.json();
  if (!rows.length) return toolText(`Nenhuma tarefa encontrada com id ${id}.`, true);
  const updated = rows[0];

  return toolText(JSON.stringify({
    ok: true,
    tarefa: { id: updated.id, name: updated.name, status: updated.status, tipo: updated.tipo ?? [], projeto_id: updated.projeto_id, data_entrega: updated.data_entrega, updated_at: updated.updated_at },
  }, null, 2));
}

// ── Tool: search_projetos ─────────────────────────────────────────────────
async function handleSearchProjetos(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const nome = args?.nome ? String(args.nome).trim().toLowerCase() : "";
  const status = args?.status ? String(args.status) : "";
  if (status && !VOCAB.projeto_status.includes(status)) return toolText(`Status inválido: ${status}. Valores aceitos: ${VOCAB.projeto_status.join(", ")}.`, true);
  const tagsFiltro = strArray(args?.tags);
  const invalidTags = tagsFiltro.filter((t) => !VOCAB.projeto_tag.includes(t));
  if (invalidTags.length) return toolText(`Tag(s) inválida(s): ${invalidTags.join(", ")}. Valores aceitos: ${VOCAB.projeto_tag.join(", ")}.`, true);
  const limit = clampLimit(args?.limit);

  let projetos = await fetchAllProjetos(REST, headers);
  if (nome) projetos = projetos.filter((p) => p.name.toLowerCase().includes(nome));
  if (status) projetos = projetos.filter((p) => p.status === status);
  if (tagsFiltro.length) projetos = projetos.filter((p) => (p.tags || []).some((t) => tagsFiltro.includes(t)));

  const totalMatches = projetos.length;
  const returned = projetos.slice(0, limit).map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, status: p.status, tags: p.tags }));

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length, projetos: returned,
  }, null, 2));
}

// ── Tool: search_eventos ──────────────────────────────────────────────────
async function handleSearchEventos(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const nome = args?.nome ? String(args.nome).trim().toLowerCase() : "";
  const tipoFiltro = strArray(args?.tipo);
  const invalidTipo = tipoFiltro.filter((t) => !VOCAB.evento_tipo.includes(t));
  if (invalidTipo.length) return toolText(`Tipo(s) inválido(s): ${invalidTipo.join(", ")}. Valores aceitos: ${VOCAB.evento_tipo.join(", ")}.`, true);
  const dataInicio = args?.data_inicio ? String(args.data_inicio) : "";
  const dataFim = args?.data_fim ? String(args.data_fim) : "";
  const limit = clampLimit(args?.limit);

  const [eventosRes, projetos] = await Promise.all([
    fetch(`${REST}/lifeos_eventos?order=date.desc`, { headers }),
    fetchAllProjetos(REST, headers),
  ]);
  if (!eventosRes.ok) throw new Error(`select eventos -> ${eventosRes.status} ${await eventosRes.text()}`);
  const rows = await eventosRes.json();
  const projetoById = new Map(projetos.map((p) => [p.id, p]));
  const { ids: projetoIdsFiltro, warnings } = resolveProjetoFiltro(projetos, strArray(args?.projetos));

  let eventos = rows.map((r: any) => ({ id: r.id, name: r.name, date: r.date, date_fim: r.date_fim ?? null, tipo: r.tipo, projeto_id: r.projeto_id ?? null }));

  if (nome) eventos = eventos.filter((e: any) => e.name.toLowerCase().includes(nome));
  if (tipoFiltro.length) eventos = eventos.filter((e: any) => tipoFiltro.includes(e.tipo));
  if (projetoIdsFiltro) eventos = eventos.filter((e: any) => e.projeto_id && projetoIdsFiltro.has(e.projeto_id));
  // Sobreposição, não só "date dentro do range" -- um evento de vários dias
  // que começou antes de data_inicio mas ainda estava em curso precisa
  // entrar (mesmo racional de handleQuery em lifeos-eventos).
  if (dataInicio) eventos = eventos.filter((e: any) => (e.date_fim || e.date) >= dataInicio);
  if (dataFim) eventos = eventos.filter((e: any) => e.date <= dataFim);

  const totalMatches = eventos.length;
  const returned = eventos.slice(0, limit).map((e: any) => ({
    id: e.id, name: e.name, date: e.date, date_fim: e.date_fim, tipo: e.tipo,
    projeto: (e.projeto_id && projetoById.has(e.projeto_id)) ? { id: e.projeto_id, name: projetoLabel(projetoById.get(e.projeto_id)!) } : null,
  }));

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length,
    warnings: warnings.length ? warnings : undefined, eventos: returned,
  }, null, 2));
}

// ── Tool: create_evento ───────────────────────────────────────────────────
async function handleCreateEvento(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const name = String(args?.name ?? "").trim();
  if (!name) return toolText("O parâmetro name (nome do evento) é obrigatório e não pode ser vazio.", true);

  const date = String(args?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toolText("O parâmetro date é obrigatório e precisa estar no formato YYYY-MM-DD.", true);

  const dateFimRaw = args?.date_fim;
  let date_fim: string | null = null;
  if (dateFimRaw !== undefined && dateFimRaw !== null && dateFimRaw !== "") {
    date_fim = String(dateFimRaw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date_fim)) return toolText("O parâmetro date_fim, quando enviado, precisa estar no formato YYYY-MM-DD.", true);
    if (date_fim < date) return toolText("date_fim não pode ser anterior a date.", true);
  }

  const tipo = String(args?.tipo ?? "");
  if (!VOCAB.evento_tipo.includes(tipo)) return toolText(`Tipo inválido: ${tipo}. Valores aceitos: ${VOCAB.evento_tipo.join(", ")}.`, true);

  let projeto: { id: string; name: string } | null = null;
  const projetoNome = args?.projeto ? String(args.projeto).trim() : "";
  if (projetoNome) {
    const projetos = await fetchAllProjetos(REST, headers);
    const { resolved, naoEncontrados } = await resolveProjetoNomes(projetos, [projetoNome]);
    if (naoEncontrados.length) {
      return toolText(`Projeto não encontrado ou ambíguo: ${projetoNome}. Projetos existentes: ${projetos.map((p) => p.name).join(", ")}.`, true);
    }
    projeto = resolved[0];
  }

  const insertRes = await fetch(`${REST}/lifeos_eventos`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, date, date_fim, tipo, projeto_id: projeto?.id ?? null }),
  });
  if (!insertRes.ok) return toolText(`Erro ao criar o evento: ${insertRes.status} ${await insertRes.text()}`, true);
  const created = (await insertRes.json())[0];

  return toolText(JSON.stringify({
    ok: true,
    evento: { id: created.id, name: created.name, date: created.date, date_fim: created.date_fim, tipo: created.tipo, projeto },
  }, null, 2));
}

// ── Tool: update_evento (PATCH parcial -- lifeos-eventos.ts não tem essa
// ação pro app; esta tool é a primeira escrita de update deste domínio) ──
async function handleUpdateEvento(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const id = String(args?.id ?? "").trim();
  if (!id) return toolText("O parâmetro id (id do evento a editar, retornado por search_eventos) é obrigatório.", true);

  // Busca o estado atual pra validar date_fim >= date mesmo quando só um
  // dos dois vem no patch (a constraint do banco é sobre o par final, não
  // sobre cada campo isolado).
  const curRes = await fetch(`${REST}/lifeos_eventos?id=eq.${id}&select=id,date,date_fim`, { headers });
  if (!curRes.ok) throw new Error(`select evento -> ${curRes.status} ${await curRes.text()}`);
  const curRows = await curRes.json();
  if (!curRows.length) return toolText(`Nenhum evento encontrado com id ${id}.`, true);
  const atual = curRows[0];

  const update: Record<string, any> = {};

  if (args?.name !== undefined) {
    const name = String(args.name).trim();
    if (!name) return toolText("O parâmetro name, quando enviado, não pode ser vazio.", true);
    update.name = name;
  }

  let finalDate = atual.date;
  if (args?.date !== undefined) {
    const date = String(args.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toolText("O parâmetro date, quando enviado, precisa estar no formato YYYY-MM-DD.", true);
    update.date = date;
    finalDate = date;
  }

  let finalDateFim = atual.date_fim;
  if (args?.date_fim !== undefined) {
    const v = args.date_fim;
    if (v === null || v === "") {
      update.date_fim = null;
      finalDateFim = null;
    } else {
      const date_fim = String(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date_fim)) return toolText("O parâmetro date_fim, quando enviado, precisa estar no formato YYYY-MM-DD (ou \"\"/null pra remover).", true);
      update.date_fim = date_fim;
      finalDateFim = date_fim;
    }
  }
  if (finalDateFim && finalDateFim < finalDate) return toolText("date_fim não pode ser anterior a date.", true);

  if (args?.tipo !== undefined) {
    const tipo = String(args.tipo);
    if (!VOCAB.evento_tipo.includes(tipo)) return toolText(`Tipo inválido: ${tipo}. Valores aceitos: ${VOCAB.evento_tipo.join(", ")}.`, true);
    update.tipo = tipo;
  }

  if (args?.projeto !== undefined) {
    const projetoNome = (args.projeto === null) ? "" : String(args.projeto).trim();
    if (!projetoNome) {
      update.projeto_id = null;
    } else {
      const projetos = await fetchAllProjetos(REST, headers);
      const { resolved, naoEncontrados } = await resolveProjetoNomes(projetos, [projetoNome]);
      if (naoEncontrados.length) {
        return toolText(`Projeto não encontrado ou ambíguo: ${projetoNome}. Projetos existentes: ${projetos.map((p) => p.name).join(", ")}.`, true);
      }
      update.projeto_id = resolved[0].id;
    }
  }

  if (!Object.keys(update).length) return toolText("Nenhum campo pra atualizar foi enviado -- envie ao menos um de: name, date, date_fim, tipo, projeto.", true);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_eventos?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return toolText(`Erro ao atualizar o evento: ${r.status} ${await r.text()}`, true);
  const rows = await r.json();
  if (!rows.length) return toolText(`Nenhum evento encontrado com id ${id}.`, true);
  const updated = rows[0];

  return toolText(JSON.stringify({
    ok: true,
    evento: { id: updated.id, name: updated.name, date: updated.date, date_fim: updated.date_fim, tipo: updated.tipo, projeto_id: updated.projeto_id, updated_at: updated.updated_at },
  }, null, 2));
}

// ── Tool: search_manifestacoes ────────────────────────────────────────────
async function handleSearchManifestacoes(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const nome = args?.nome ? String(args.nome).trim().toLowerCase() : "";
  const status = args?.status ? String(args.status) : "";
  if (status && !VOCAB.manifestacao_status.includes(status)) return toolText(`Status inválido: ${status}. Valores aceitos: ${VOCAB.manifestacao_status.join(", ")}.`, true);
  const tagsFiltro = strArray(args?.tags);
  const invalidTags = tagsFiltro.filter((t) => !VOCAB.manifestacao_tag.includes(t));
  if (invalidTags.length) return toolText(`Tag(s) inválida(s): ${invalidTags.join(", ")}. Valores aceitos: ${VOCAB.manifestacao_tag.join(", ")}.`, true);
  const limit = clampLimit(args?.limit);

  const r = await fetch(`${REST}/lifeos_manifestacoes?order=created_at.asc`, { headers });
  if (!r.ok) throw new Error(`select manifestacoes -> ${r.status} ${await r.text()}`);
  const rows = await r.json();

  let manifestacoes = rows.map((row: any) => ({ id: row.id, name: row.name, status: row.status, tags: row.tags ?? [], descricao: row.descricao, banner_url: row.banner_url }));
  if (nome) manifestacoes = manifestacoes.filter((m: any) => m.name.toLowerCase().includes(nome));
  if (status) manifestacoes = manifestacoes.filter((m: any) => m.status === status);
  if (tagsFiltro.length) manifestacoes = manifestacoes.filter((m: any) => (m.tags || []).some((t: string) => tagsFiltro.includes(t)));

  const totalMatches = manifestacoes.length;
  const returned = manifestacoes.slice(0, limit);

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length, manifestacoes: returned,
  }, null, 2));
}

// ── Tool: search_citacoes ─────────────────────────────────────────────────
async function handleSearchCitacoes(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const texto = args?.texto ? String(args.texto).trim().toLowerCase() : "";
  const autor = args?.autor ? String(args.autor).trim().toLowerCase() : "";
  const limit = clampLimit(args?.limit);

  const r = await fetch(`${REST}/lifeos_citacoes?order=created_at.asc`, { headers });
  if (!r.ok) throw new Error(`select citacoes -> ${r.status} ${await r.text()}`);
  const rows = await r.json();

  let citacoes = rows.map((row: any) => ({ id: row.id, texto: row.texto, autor: row.autor }));
  if (texto) citacoes = citacoes.filter((c: any) => c.texto.toLowerCase().includes(texto));
  if (autor) citacoes = citacoes.filter((c: any) => c.autor.toLowerCase().includes(autor));

  const totalMatches = citacoes.length;
  const returned = citacoes.slice(0, limit);

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length, citacoes: returned,
  }, null, 2));
}

// ── Tool: create_citacao ──────────────────────────────────────────────────
// Mesmos limites de lifeos-citacoes (MAX_TEXTO/MAX_AUTOR) -- cópia, não
// import (ver LIFEOS.md §2).
async function handleCreateCitacao(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const texto = String(args?.texto ?? "").trim();
  if (!texto) return toolText("O parâmetro texto é obrigatório e não pode ser vazio.", true);
  if (texto.length > 2000) return toolText("O texto passa de 2000 caracteres -- uma citação precisa ser mais curta.", true);
  const autor = String(args?.autor ?? "").trim();
  if (!autor) return toolText("O parâmetro autor (quem disse) é obrigatório e não pode ser vazio.", true);
  if (autor.length > 200) return toolText("O autor passa de 200 caracteres.", true);

  const insertRes = await fetch(`${REST}/lifeos_citacoes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ texto, autor }),
  });
  if (!insertRes.ok) return toolText(`Erro ao criar a citação: ${insertRes.status} ${await insertRes.text()}`, true);
  const created = (await insertRes.json())[0];

  return toolText(JSON.stringify({
    ok: true,
    citacao: { id: created.id, texto: created.texto, autor: created.autor },
  }, null, 2));
}

// ── Memória de longo prazo (LIFEOS.md §17) ───────────────────────────────
//
// Índice (lifeos_memorias) + registros (lifeos_memoria_registros). Os
// limites e a regra de título único são os mesmos de lifeos-memorias --
// cópia, não import (LIFEOS.md §2).
//
// Sem DELETE aqui, mesma política do resto do servidor: podar memória é
// trabalho da tela (lifeos/memoria.html). update_registro é SUBSTITUIÇÃO do
// texto inteiro, pelo mesmo motivo de update_nota: um envio parcial apagaria
// o resto do fato.
const MEM_MAX_TITULO = 120;
const MEM_MAX_DESCRICAO = 400;
const MEM_MAX_TEXTO = 8000;
const MEM_MAX_ORIGEM = 60;

// Teto do índice injetado nas `instructions`. Clientes costumam truncar
// instruções longas; passando disto, o índice é cortado com um aviso e o
// modelo usa list_memorias pra ver o resto.
const INSTRUCTIONS_MAX_INDICE = 6000;

type MemoriaIdx = {
  id: string; titulo: string; descricao: string; categoria: string;
  updated_at: string; registros: number;
};

async function fetchMemoriasIndice(REST: string, headers: Record<string, string>): Promise<MemoriaIdx[]> {
  // Os ids dos registros vêm embutidos só pra contar -- mais portátil que
  // depender de aggregate no PostgREST, e o volume é de uso pessoal.
  const r = await fetch(
    `${REST}/lifeos_memorias?select=id,titulo,descricao,categoria,updated_at,lifeos_memoria_registros(id)&order=titulo.asc`,
    { headers },
  );
  if (!r.ok) throw new Error(`select memorias -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.map((m: any) => ({
    id: m.id, titulo: m.titulo, descricao: m.descricao ?? "", categoria: m.categoria,
    updated_at: m.updated_at, registros: (m.lifeos_memoria_registros ?? []).length,
  }));
}

// Mesmo critério de resolveProjetoNomes: id exato, depois título exato
// (sem caixa), depois trecho que bata com UMA memória só.
function resolveMemoria(memorias: MemoriaIdx[], refRaw: string): { hit?: MemoriaIdx; erro?: string } {
  const ref = refRaw.trim();
  const lower = ref.toLowerCase();
  let hit = memorias.find((m) => m.id === ref) ?? memorias.find((m) => m.titulo.trim().toLowerCase() === lower);
  if (!hit) {
    const cands = memorias.filter((m) => m.titulo.toLowerCase().includes(lower));
    if (cands.length === 1) hit = cands[0];
    else if (cands.length > 1) return { erro: `"${ref}" é ambíguo -- bate com: ${cands.map((m) => m.titulo).join(", ")}.` };
  }
  if (!hit) {
    const todas = memorias.map((m) => m.titulo).join(", ") || "(nenhuma ainda)";
    return { erro: `Nenhuma memória encontrada com "${ref}". Memórias existentes: ${todas}.` };
  }
  return { hit };
}

function cleanOrigem(v: unknown): string {
  const s = String(v ?? "").trim().slice(0, MEM_MAX_ORIGEM);
  return s || "mcp";
}

async function tocarMemoria(REST: string, headers: Record<string, string>, memoriaId: string) {
  await fetch(`${REST}/lifeos_memorias?id=eq.${memoriaId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

// `instructions` do initialize: o cliente coloca isto no system prompt, então
// o modelo começa a conversa já sabendo quais memórias existem -- sem gastar
// uma tool call. Falhar aqui nunca derruba o handshake: sem índice, as
// instruções saem só com o texto fixo.
async function buildInstructions(REST: string, headers: Record<string, string>): Promise<string> {
  const base =
    "LifeOS é o sistema de gestão de vida do usuário (tarefas, projetos, notas, eventos, finanças, " +
    "manifestações, citações). Este servidor também guarda a MEMÓRIA DE LONGO PRAZO sobre o usuário, " +
    "independente de cliente ou modelo.\n\n" +
    "Como usar a memória:\n" +
    "- O índice abaixo lista cada memória (título — descrição). Quando o assunto da conversa tocar uma " +
    "delas, abra com get_memoria antes de responder.\n" +
    "- Ao aprender algo durável sobre o usuário (quem é, preferências, correções que ele fez, contexto " +
    "de projetos, referências), registre: add_registro na memória certa, ou create_memoria se nenhuma " +
    "cobre o tema. Informe o parâmetro origem com o nome do seu cliente.\n" +
    "- Não registre o que é efêmero ou só vale para a conversa atual. Não duplique: se um fato mudou, " +
    "corrija com update_registro.\n" +
    "- Cada registro reflete o que era verdade quando foi escrito (veja a data).\n" +
    "- Este índice foi montado na conexão; use list_memorias para a versão atual.";

  let memorias: MemoriaIdx[];
  try {
    memorias = await fetchMemoriasIndice(REST, headers);
  } catch {
    return base + "\n\n(Índice de memória indisponível agora -- use list_memorias.)";
  }
  if (!memorias.length) return base + "\n\nÍndice de memória: vazio -- nenhuma memória registrada ainda.";

  const ordem = [...VOCAB.memoria_categoria];
  for (const m of memorias) if (!ordem.includes(m.categoria)) ordem.push(m.categoria);

  let indice = "";
  let cortado = false;
  for (const cat of ordem) {
    const doGrupo = memorias.filter((m) => m.categoria === cat);
    if (!doGrupo.length) continue;
    const bloco = `\n[${cat}]\n` + doGrupo
      .map((m) => `- ${m.titulo}${m.descricao ? " — " + m.descricao : ""} (${m.registros} ${m.registros === 1 ? "registro" : "registros"})`)
      .join("\n");
    if (indice.length + bloco.length > INSTRUCTIONS_MAX_INDICE) { cortado = true; break; }
    indice += bloco;
  }
  if (cortado) indice += "\n(… índice cortado por tamanho -- use list_memorias para ver todas.)";

  return base + "\n\nÍndice de memória:" + indice;
}

// ── Tool: list_memorias ───────────────────────────────────────────────────
async function handleListMemorias(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const categoria = args?.categoria ? String(args.categoria) : "";
  if (categoria && !VOCAB.memoria_categoria.includes(categoria)) {
    return toolText(`Categoria inválida: ${categoria}. Valores aceitos: ${VOCAB.memoria_categoria.join(", ")}.`, true);
  }
  let memorias = await fetchMemoriasIndice(REST, headers);
  if (categoria) memorias = memorias.filter((m) => m.categoria === categoria);

  return toolText(JSON.stringify({
    total: memorias.length,
    memorias: memorias.map((m) => ({
      id: m.id, titulo: m.titulo, categoria: m.categoria, descricao: m.descricao,
      registros: m.registros, atualizada_em: m.updated_at,
    })),
  }, null, 2));
}

// ── Tool: get_memoria ─────────────────────────────────────────────────────
async function handleGetMemoria(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const refs = strArray(args?.memorias).map((s) => s.trim()).filter(Boolean);
  if (!refs.length) return toolText("O parâmetro memorias é obrigatório -- envie ao menos um título ou id.", true);

  const indice = await fetchMemoriasIndice(REST, headers);
  const ids: string[] = [];
  const warnings: string[] = [];
  for (const ref of refs) {
    const { hit, erro } = resolveMemoria(indice, ref);
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); } else warnings.push(erro!);
  }
  if (!ids.length) return toolText(warnings.join("\n"), true);

  const r = await fetch(
    `${REST}/lifeos_memorias?id=in.(${ids.join(",")})&select=*,lifeos_memoria_registros(*)`,
    { headers },
  );
  if (!r.ok) throw new Error(`select memorias -> ${r.status} ${await r.text()}`);
  const rows = await r.json();

  const memorias = rows.map((m: any) => {
    const regs = (m.lifeos_memoria_registros ?? []).slice()
      .sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    return {
      id: m.id, titulo: m.titulo, categoria: m.categoria, descricao: m.descricao ?? "",
      atualizada_em: m.updated_at,
      registros: regs.map((x: any) => ({
        id: x.id, texto: x.texto, origem: x.origem ?? null,
        data: x.created_at, editado_em: x.updated_at !== x.created_at ? x.updated_at : undefined,
      })),
    };
  });

  return toolText(JSON.stringify({
    warnings: warnings.length ? warnings : undefined, memorias,
  }, null, 2));
}

// ── Tool: create_memoria ──────────────────────────────────────────────────
async function handleCreateMemoria(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const titulo = String(args?.titulo ?? "").trim();
  if (!titulo) return toolText("O parâmetro titulo é obrigatório e não pode ser vazio.", true);
  if (titulo.length > MEM_MAX_TITULO) return toolText(`O título passa de ${MEM_MAX_TITULO} caracteres.`, true);

  const descricao = String(args?.descricao ?? "").trim();
  if (!descricao) return toolText("O parâmetro descricao é obrigatório -- é o que aparece no índice.", true);
  if (descricao.length > MEM_MAX_DESCRICAO) return toolText(`A descrição passa de ${MEM_MAX_DESCRICAO} caracteres -- ela é um resumo de índice; o conteúdo vai nos registros.`, true);

  const categoria = String(args?.categoria ?? "");
  if (!VOCAB.memoria_categoria.includes(categoria)) {
    return toolText(`Categoria inválida: ${categoria}. Valores aceitos: ${VOCAB.memoria_categoria.join(", ")}.`, true);
  }

  const textos = strArray(args?.registros).map((s) => s.trim()).filter(Boolean);
  const longo = textos.find((t) => t.length > MEM_MAX_TEXTO);
  if (longo) return toolText(`Um dos registros passa de ${MEM_MAX_TEXTO} caracteres -- divida em fatos menores.`, true);
  const origem = cleanOrigem(args?.origem);

  // Checagem amigável antes do insert: o índice único do banco também
  // barraria, mas aqui dá pra apontar a memória que já existe.
  const indice = await fetchMemoriasIndice(REST, headers);
  const existente = indice.find((m) => m.titulo.trim().toLowerCase() === titulo.toLowerCase());
  if (existente) {
    return toolText(`Já existe a memória "${existente.titulo}" (id ${existente.id}). Use add_registro para acrescentar a ela.`, true);
  }

  const insertRes = await fetch(`${REST}/lifeos_memorias`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ titulo, descricao, categoria }),
  });
  if (!insertRes.ok) return toolText(`Erro ao criar a memória: ${insertRes.status} ${await insertRes.text()}`, true);
  const created = (await insertRes.json())[0];

  if (textos.length) {
    const regRes = await fetch(`${REST}/lifeos_memoria_registros`, {
      method: "POST",
      headers,
      body: JSON.stringify(textos.map((texto) => ({ memoria_id: created.id, texto, origem }))),
    });
    if (!regRes.ok) return toolText(`Memória criada (id ${created.id}), mas falhou ao gravar os registros: ${regRes.status} ${await regRes.text()}`, true);
  }

  return toolText(JSON.stringify({
    ok: true,
    memoria: { id: created.id, titulo: created.titulo, categoria: created.categoria, descricao: created.descricao, registros: textos.length },
  }, null, 2));
}

// ── Tool: add_registro ────────────────────────────────────────────────────
async function handleAddRegistro(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const ref = String(args?.memoria ?? "").trim();
  if (!ref) return toolText("O parâmetro memoria (título ou id) é obrigatório.", true);
  const texto = String(args?.texto ?? "").trim();
  if (!texto) return toolText("O parâmetro texto é obrigatório e não pode ser vazio.", true);
  if (texto.length > MEM_MAX_TEXTO) return toolText(`O texto passa de ${MEM_MAX_TEXTO} caracteres -- divida em registros menores.`, true);

  const { hit, erro } = resolveMemoria(await fetchMemoriasIndice(REST, headers), ref);
  if (!hit) return toolText(erro!, true);

  const r = await fetch(`${REST}/lifeos_memoria_registros`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ memoria_id: hit.id, texto, origem: cleanOrigem(args?.origem) }),
  });
  if (!r.ok) return toolText(`Erro ao gravar o registro: ${r.status} ${await r.text()}`, true);
  const created = (await r.json())[0];
  await tocarMemoria(REST, headers, hit.id);

  return toolText(JSON.stringify({
    ok: true,
    memoria: { id: hit.id, titulo: hit.titulo },
    registro: { id: created.id, texto: created.texto, origem: created.origem, data: created.created_at },
  }, null, 2));
}

// ── Tool: update_memoria (PATCH parcial) ──────────────────────────────────
async function handleUpdateMemoria(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const ref = String(args?.memoria ?? "").trim();
  if (!ref) return toolText("O parâmetro memoria (título atual ou id) é obrigatório.", true);

  const indice = await fetchMemoriasIndice(REST, headers);
  const { hit, erro } = resolveMemoria(indice, ref);
  if (!hit) return toolText(erro!, true);

  const update: Record<string, any> = {};
  if (args?.titulo !== undefined) {
    const titulo = String(args.titulo).trim();
    if (!titulo) return toolText("O parâmetro titulo, quando enviado, não pode ser vazio.", true);
    if (titulo.length > MEM_MAX_TITULO) return toolText(`O título passa de ${MEM_MAX_TITULO} caracteres.`, true);
    const outra = indice.find((m) => m.id !== hit.id && m.titulo.trim().toLowerCase() === titulo.toLowerCase());
    if (outra) return toolText(`Já existe outra memória chamada "${outra.titulo}".`, true);
    update.titulo = titulo;
  }
  if (args?.descricao !== undefined) {
    const descricao = String(args.descricao).trim();
    if (descricao.length > MEM_MAX_DESCRICAO) return toolText(`A descrição passa de ${MEM_MAX_DESCRICAO} caracteres.`, true);
    update.descricao = descricao;
  }
  if (args?.categoria !== undefined) {
    const categoria = String(args.categoria);
    if (!VOCAB.memoria_categoria.includes(categoria)) {
      return toolText(`Categoria inválida: ${categoria}. Valores aceitos: ${VOCAB.memoria_categoria.join(", ")}.`, true);
    }
    update.categoria = categoria;
  }
  if (!Object.keys(update).length) return toolText("Nenhum campo pra atualizar foi enviado -- envie ao menos um de: titulo, descricao, categoria.", true);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_memorias?id=eq.${hit.id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return toolText(`Erro ao atualizar a memória: ${r.status} ${await r.text()}`, true);
  const u = (await r.json())[0];

  return toolText(JSON.stringify({
    ok: true,
    memoria: { id: u.id, titulo: u.titulo, categoria: u.categoria, descricao: u.descricao, atualizada_em: u.updated_at },
  }, null, 2));
}

// ── Tool: update_registro (substituição do texto inteiro) ────────────────
async function handleUpdateRegistro(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const id = String(args?.id ?? "").trim();
  if (!id) return toolText("O parâmetro id (id do registro, retornado por get_memoria) é obrigatório.", true);
  const texto = String(args?.texto ?? "").trim();
  if (!texto) return toolText("O parâmetro texto é obrigatório e precisa ser o TEXTO INTEIRO e final do registro.", true);
  if (texto.length > MEM_MAX_TEXTO) return toolText(`O texto passa de ${MEM_MAX_TEXTO} caracteres.`, true);

  const r = await fetch(`${REST}/lifeos_memoria_registros?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ texto, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return toolText(`Erro ao atualizar o registro: ${r.status} ${await r.text()}`, true);
  const rows = await r.json();
  if (!rows.length) return toolText(`Nenhum registro encontrado com id ${id}.`, true);
  const u = rows[0];
  await tocarMemoria(REST, headers, u.memoria_id);

  return toolText(JSON.stringify({
    ok: true,
    registro: { id: u.id, memoria_id: u.memoria_id, texto: u.texto, origem: u.origem, data: u.created_at, editado_em: u.updated_at },
  }, null, 2));
}

// ═══ RESUMO FINANCEIRO · início ══════════════════════════════════════════
//
// Os números da tela de Finanças (lifeos/financas.html), calculados aqui
// com as MESMAS regras -- terceira cópia da lógica, junto de financas.js e
// lifeos.js (LIFEOS.md §2: cópia, não import; decisão do autor, set/2026,
// até o port pra Laravel). Nomes e comentários seguem financas.js pra
// facilitar comparar as três lado a lado.
//
// Esta seção é PURA: sem fetch, sem Deno, sem VOCAB global -- recebe as
// linhas e devolve o resumo. É isso que permite verificar a porta rodando
// as duas implementações sobre os mesmos dados (o teste extrai o trecho
// entre os marcadores "RESUMO FINANCEIRO · início/fim").
//
// Regras (ver o modal "Como funciona" de financas.html):
//  - Compra em Crédito não sai do caixa no mês: entra em Saídas "com
//    crédito", fica fora do Saldo e vira fatura futura.
//  - Saldo = saldo de abertura (RPC lifeos_saldo_abertura) + entradas
//    realizadas − saídas de caixa realizadas. Data futura conta nos totais,
//    mas só entra no saldo quando a data chegar.
//  - Pagamento de fatura = Saida SEM meio com "fatura" no nome. Abate a
//    fatura que fecha no mês; o excedente vira adiantamento da seguinte,
//    carregado em cadeia (carryInto). "adiant" no nome = adiantamento
//    explícito, que pula direto pra próxima fatura.
//  - A fatura fecha no último dia do mês: compra antes dele cai em M+1; no
//    último dia, em M+2.

type Mov = { id?: string; name: string; valor: number; date: string; tipo: string[]; created_at?: string };

function finNum(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function finRound2(v: number): number { return Math.round(v * 100) / 100; }
function finHas(m: Mov, tag: string) { return Array.isArray(m.tipo) && m.tipo.includes(tag); }
function finIsSaida(m: Mov) { return finHas(m, "Saida"); }
function finIsEntrada(m: Mov) { return finHas(m, "Entrada"); }
function finNextMonth(ym: string) { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; }
function finPrevMonth(ym: string) { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; }
function finLastDay(ym: string) { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function finFaturaDestino(ym: string, dia: number) { const prox = finNextMonth(ym); return dia < finLastDay(ym) ? prox : finNextMonth(prox); }
function finCmpByDateAsc(a: Mov, b: Mov) { return (a.date || "").localeCompare(b.date || "") || (a.created_at || "").localeCompare(b.created_at || ""); }
function finNormName(s: string) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }

function finCtx(meios: string[], hojeISO: string) {
  const hasAnyMeio = (m: Mov) => meios.some((me) => finHas(m, me));
  const isSaidaCaixa = (m: Mov) => finIsSaida(m) && !finHas(m, "Crédito");
  const isPagamentoFatura = (m: Mov) => finIsSaida(m) && !hasAnyMeio(m) && /fatura/i.test(m.name || "");
  const isAdiantamentoExplicito = (m: Mov) => isPagamentoFatura(m) && /adiant/i.test(m.name || "");
  const isRealizado = (m: Mov) => !m.date || m.date <= hojeISO;
  return { hasAnyMeio, isSaidaCaixa, isPagamentoFatura, isAdiantamentoExplicito, isRealizado };
}

// Cópia de financas.js/splitPagamentosFatura -- comparação em CENTAVOS.
function finSplitPagamentos(pagamentos: Mov[], totalFatura: number) {
  const sorted = pagamentos.slice().sort(finCmpByDateAsc);
  const atual: Mov[] = [], adiantamento: Mov[] = [];
  let cumC = 0;
  const totalC = Math.round(totalFatura * 100);
  for (const m of sorted) {
    const valorC = Math.round(finNum(m.valor) * 100);
    const restanteC = totalC - cumC;
    if (restanteC <= 0) adiantamento.push(m);
    else if (valorC > restanteC) {
      atual.push({ ...m, valor: restanteC / 100 });
      adiantamento.push({ ...m, valor: (valorC - restanteC) / 100 });
    } else atual.push(m);
    cumC += valorC;
  }
  return { atual, adiantamento };
}

// Cópia de financas.js/calcularProjecaoFatura.
function finProjecaoFatura(rows: Mov[], ym: string) {
  const groups: Record<string, { total: number; rows: Mov[] }> = {};
  for (const m of rows) {
    if (!finIsSaida(m) || !finHas(m, "Crédito")) continue;
    if (/fatura/i.test(m.name || "")) continue; // pagamento da fatura, não compra nova
    const d = m.date ? parseInt(m.date.slice(8, 10), 10) : 0;
    const destino = finFaturaDestino(ym, d);
    (groups[destino] ??= { total: 0, rows: [] });
    groups[destino].total += finNum(m.valor);
    groups[destino].rows.push(m);
  }
  return groups;
}

// Resumo de UM mês. `rowsDoMes(ym)` devolve as movimentações de qualquer
// mês (a cadeia de faturas olha pra trás); `abertura` vem da RPC.
function calcularResumoMes(
  rowsDoMes: (ym: string) => Mov[], ym: string, abertura: number, hojeISO: string, meios: string[],
) {
  const c = finCtx(meios, hojeISO);
  const MROWS = rowsDoMes(ym);

  // KPIs -- cópia de computeMonthKpis.
  let entradas = 0, saidasTotais = 0, entradasRealizadas = 0, saidasCaixaRealizadas = 0, futuras = 0;
  for (const m of MROWS) {
    const v = finNum(m.valor), realizado = c.isRealizado(m);
    if (!realizado) futuras++;
    if (finIsEntrada(m)) { entradas += v; if (realizado) entradasRealizadas += v; }
    if (finIsSaida(m)) saidasTotais += v;
    if (c.isSaidaCaixa(m) && realizado) saidasCaixaRealizadas += v;
  }
  const variacaoMes = entradasRealizadas - saidasCaixaRealizadas;

  // Por meio -- cópia de computeDonutBuckets (modos saida e entrada).
  const porMeio = (dir: (m: Mov) => boolean) => {
    const out: Record<string, number> = {};
    let semMeio = 0;
    for (const m of MROWS) {
      if (!dir(m)) continue;
      const v = finNum(m.valor);
      let achou = false;
      for (const me of meios) if (finHas(m, me)) { out[me] = (out[me] || 0) + v; achou = true; }
      if (!achou) semMeio += v;
    }
    if (semMeio > 0) out["Sem meio"] = semMeio;
    for (const k of Object.keys(out)) out[k] = finRound2(out[k]);
    return out;
  };

  // Saldo acumulado dia a dia -- cópia de renderSaldo; aqui só o mínimo.
  const porDia: Record<string, number> = {};
  for (const m of MROWS) {
    if (!c.isRealizado(m)) continue;
    let delta = 0;
    if (finIsEntrada(m)) delta += finNum(m.valor);
    if (c.isSaidaCaixa(m)) delta -= finNum(m.valor);
    porDia[m.date] = (porDia[m.date] || 0) + delta;
  }
  let acc = abertura, saldoMinimo: { valor: number; dia: string | null } = { valor: abertura, dia: null };
  for (const d of Object.keys(porDia).sort()) {
    acc += porDia[d];
    if (acc < saldoMinimo.valor) saldoMinimo = { valor: acc, dia: d };
  }

  // Cadeia de faturas -- cópia de carryInto (síncrona: os dados já estão
  // todos em memória; memo por mês no lugar do cache de fetch).
  const memo: Record<string, Mov[]> = {};
  const carryInto = (m: string): Mov[] => {
    if (memo[m]) return memo[m];
    const rows = rowsDoMes(m);
    const pagamentosFatura = rows.filter(c.isPagamentoFatura);
    let res: Mov[];
    if (!pagamentosFatura.length) res = [];
    else {
      const explicitos = pagamentosFatura.filter(c.isAdiantamentoExplicito);
      const normais = pagamentosFatura.filter((x) => !c.isAdiantamentoExplicito(x));
      if (!normais.length) res = explicitos;
      else {
        const pm = finPrevMonth(m);
        const g = finProjecaoFatura(rowsDoMes(pm), pm)[m];
        const totalFaturaM = (g && g.rows.length) ? g.total : 0;
        const split = finSplitPagamentos(normais.concat(carryInto(pm)), totalFaturaM);
        res = split.adiantamento.concat(explicitos);
      }
    }
    return (memo[m] = res);
  };

  // Fatura deste mês -- cópia de renderFaturaMesPassado.
  const pYm = finPrevMonth(ym);
  const pagamentosFaturaAtual = MROWS.filter(c.isPagamentoFatura);
  const explicitosAtual = pagamentosFaturaAtual.filter(c.isAdiantamentoExplicito);
  const normaisAtual = pagamentosFaturaAtual.filter((m) => !c.isAdiantamentoExplicito(m));
  const gAtual = finProjecaoFatura(rowsDoMes(pYm), pYm)[ym];
  const totalFatura = (gAtual && gAtual.rows.length) ? gAtual.total : 0;
  const pagamentosFatura = normaisAtual.concat(carryInto(pYm));
  const pago = pagamentosFatura.reduce((s, m) => s + finNum(m.valor), 0);
  const split = finSplitPagamentos(pagamentosFatura, totalFatura);
  const carryOut = split.adiantamento.concat(explicitosAtual);
  const excedente = finRound2(carryOut.reduce((s, m) => s + finNum(m.valor), 0));

  // Fatura projetada -- cópia de renderFaturaProjetada + nota de adiantamento
  // (o adiantamento abate só o PRIMEIRO destino, como na tela).
  const proj = finProjecaoFatura(MROWS, ym);
  const faturaProjetada = Object.keys(proj).sort().map((dest, i) => ({
    fatura: dest,
    total: finRound2(proj[dest].total),
    compras: proj[dest].rows.length,
    ...(i === 0 && excedente > 0 ? { valor_apos_adiantamento: finRound2(Math.max(0, proj[dest].total - excedente)) } : {}),
  }));

  // Recorrências -- cópia de renderRecList (sem filtros), só as que repetem.
  const grupos: Record<string, { descricao: string; items: Mov[] }> = {};
  for (const m of MROWS) {
    const key = finNormName(m.name) || "—";
    (grupos[key] ??= { descricao: m.name || "—", items: [] }).items.push(m);
  }
  const recorrencias = Object.values(grupos).map((g) => {
    let e = 0, s = 0;
    for (const m of g.items) { if (finIsEntrada(m)) e += finNum(m.valor); if (finIsSaida(m)) s += finNum(m.valor); }
    return { descricao: g.descricao, vezes: g.items.length, entradas: finRound2(e), saidas: finRound2(s), liquido: finRound2(e - s) };
  })
    .sort((a, b) => (b.vezes - a.vezes) || (Math.abs(b.liquido) - Math.abs(a.liquido)))
    .filter((g) => g.vezes > 1);

  const maioresSaidas = MROWS.filter(finIsSaida)
    .sort((a, b) => finNum(b.valor) - finNum(a.valor)).slice(0, 5)
    .map((m) => ({ data: m.date, descricao: m.name, valor: finRound2(finNum(m.valor)), meio: meios.filter((me) => finHas(m, me)) }));

  return {
    mes: ym,
    movimentacoes: MROWS.length,
    lancamentos_futuros: futuras,
    entradas: finRound2(entradas),
    saidas_caixa: finRound2(saidasCaixaRealizadas),
    saidas_com_credito: finRound2(saidasTotais),
    saldo_abertura: finRound2(abertura),
    variacao_mes: finRound2(variacaoMes),
    saldo: finRound2(abertura + variacaoMes),
    saldo_minimo: { valor: finRound2(saldoMinimo.valor), dia: saldoMinimo.dia },
    saidas_por_meio: porMeio(finIsSaida),
    entradas_por_meio: porMeio(finIsEntrada),
    fatura_deste_mes: {
      compras_de: pYm,
      total: finRound2(totalFatura),
      compras: gAtual ? gAtual.rows.length : 0,
      pago: finRound2(Math.min(pago, totalFatura)),
      pagamentos: split.atual.length,
      restante: finRound2(Math.max(0, totalFatura - pago)),
      quitada: totalFatura > 0 && finRound2(Math.max(0, totalFatura - pago)) <= 0,
      adiantamento_para_proxima: excedente,
    },
    fatura_projetada: faturaProjetada,
    recorrencias: recorrencias.slice(0, 8),
    maiores_saidas: maioresSaidas,
  };
}
// ═══ RESUMO FINANCEIRO · fim ═════════════════════════════════════════════

// ── Tool: resumo_financeiro ───────────────────────────────────────────────
// Busca de uma vez tudo até o fim do último mês pedido: a cadeia de faturas
// (carryInto) pode olhar meses pra trás sem limite fixo, e a tabela é de uso
// pessoal (~100 linhas/mês) -- mais simples e exato que buscar sob demanda.
async function handleResumoFinanceiro(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const reYM = /^\d{4}-(0[1-9]|1[0-2])$/;
  const hoje = todayInSaoPaulo();
  const de = String(args?.de ?? args?.mes ?? hoje.slice(0, 7));
  const ate = String(args?.ate ?? args?.mes ?? de);
  if (!reYM.test(de) || !reYM.test(ate)) return toolText("Meses no formato YYYY-MM (ex.: 2026-09).", true);
  if (ate < de) return toolText("O parâmetro ate não pode ser anterior a de.", true);

  const meses: string[] = [];
  for (let ym = de; ym <= ate; ym = finNextMonth(ym)) {
    meses.push(ym);
    if (meses.length > 12) return toolText("No máximo 12 meses por chamada.", true);
  }

  const limite = finNextMonth(ate) + "-01";
  const r = await fetch(
    `${REST}/lifeos_movimentacoes?select=id,name,valor,date,tipo,created_at&date=lt.${limite}&order=date.asc,created_at.asc`,
    { headers },
  );
  if (!r.ok) throw new Error(`select movimentacoes -> ${r.status} ${await r.text()}`);
  const todas: Mov[] = (await r.json()).map((m: any) => ({ ...m, valor: finNum(m.valor), tipo: m.tipo ?? [] }));
  const porMes: Record<string, Mov[]> = {};
  for (const m of todas) (porMes[(m.date || "").slice(0, 7)] ??= []).push(m);
  const rowsDoMes = (ym: string) => porMes[ym] ?? [];

  const aberturas = await Promise.all(meses.map(async (ym) => {
    const a = await fetch(`${REST}/rpc/lifeos_saldo_abertura`, {
      method: "POST", headers, body: JSON.stringify({ p_before: `${ym}-01` }),
    });
    if (!a.ok) throw new Error(`rpc lifeos_saldo_abertura -> ${a.status} ${await a.text()}`);
    return finNum(await a.json());
  }));

  const resumos = meses.map((ym, i) => calcularResumoMes(rowsDoMes, ym, aberturas[i], hoje, VOCAB.mov_meio));

  const comparativo = resumos.length > 1
    ? resumos.map((x) => ({
      mes: x.mes, entradas: x.entradas, saidas_caixa: x.saidas_caixa, saidas_com_credito: x.saidas_com_credito,
      variacao_mes: x.variacao_mes, saldo: x.saldo, fatura_deste_mes: x.fatura_deste_mes.total,
    }))
    : undefined;

  return toolText(JSON.stringify({ hoje, comparativo, meses: resumos }, null, 2));
}

// ── Tool: search_movimentacoes (Finanças) ─────────────────────────────────
async function handleSearchMovimentacoes(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const nome = args?.nome ? String(args.nome).trim().toLowerCase() : "";
  const direcao = args?.direcao ? String(args.direcao) : "";
  if (direcao && !VOCAB.mov_direcao.includes(direcao)) return toolText(`Direção inválida: ${direcao}. Valores aceitos: ${VOCAB.mov_direcao.join(", ")}.`, true);
  const meioFiltro = strArray(args?.meio);
  const invalidMeio = meioFiltro.filter((m) => !VOCAB.mov_meio.includes(m));
  if (invalidMeio.length) return toolText(`Meio(s) inválido(s): ${invalidMeio.join(", ")}. Valores aceitos: ${VOCAB.mov_meio.join(", ")}.`, true);
  const dataInicio = args?.data_inicio ? String(args.data_inicio) : "";
  const dataFim = args?.data_fim ? String(args.data_fim) : "";
  const valorMin = args?.valor_min !== undefined ? Number(args.valor_min) : null;
  const valorMax = args?.valor_max !== undefined ? Number(args.valor_max) : null;
  // Intervalo fechado de datas = pedido de "ler o período": um mês tem ~100
  // linhas, e com teto de 50 o modelo recebia meio mês achando que era tudo.
  const limit = clampLimit(args?.limit, 20, (dataInicio && dataFim) ? 300 : 50);

  const r = await fetch(`${REST}/lifeos_movimentacoes?order=date.desc`, { headers });
  if (!r.ok) throw new Error(`select movimentacoes -> ${r.status} ${await r.text()}`);
  const rows = await r.json();

  let movs = rows.map((row: any) => ({ id: row.id, name: row.name, valor: row.valor === null ? null : Number(row.valor), date: row.date, tipo: row.tipo ?? [] }));

  if (nome) movs = movs.filter((m: any) => m.name.toLowerCase().includes(nome));
  if (direcao) movs = movs.filter((m: any) => (m.tipo || []).includes(direcao));
  if (meioFiltro.length) movs = movs.filter((m: any) => (m.tipo || []).some((t: string) => meioFiltro.includes(t)));
  if (dataInicio) movs = movs.filter((m: any) => m.date >= dataInicio);
  if (dataFim) movs = movs.filter((m: any) => m.date <= dataFim);
  if (valorMin !== null) movs = movs.filter((m: any) => m.valor !== null && m.valor >= valorMin);
  if (valorMax !== null) movs = movs.filter((m: any) => m.valor !== null && m.valor <= valorMax);

  const totalMatches = movs.length;
  const returned = movs.slice(0, limit);

  return toolText(JSON.stringify({
    total_matches: totalMatches, returned: returned.length, truncated: totalMatches > returned.length, movimentacoes: returned,
  }, null, 2));
}

// ── Tool: create_movimentacao ─────────────────────────────────────────────
// direcao+meio chegam separados (mesmo padrão de search_movimentacoes) e
// viram o array `tipo` combinado que a tabela guarda de fato -- mesma regra
// de lifeos-movimentacoes/buildFields: exatamente UMA direção, zero ou mais
// meios.
async function handleCreateMovimentacao(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const name = String(args?.name ?? "").trim();
  if (!name) return toolText("O parâmetro name (nome/descrição da movimentação) é obrigatório e não pode ser vazio.", true);

  const valor = Number(args?.valor);
  if (!Number.isFinite(valor) || valor < 0) return toolText("O parâmetro valor é obrigatório e precisa ser um número não-negativo.", true);

  const date = String(args?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toolText("O parâmetro date é obrigatório e precisa estar no formato YYYY-MM-DD.", true);

  const direcao = String(args?.direcao ?? "");
  if (!VOCAB.mov_direcao.includes(direcao)) return toolText(`Direção inválida: ${direcao}. Valores aceitos: ${VOCAB.mov_direcao.join(", ")}.`, true);

  const meio = strArray(args?.meio);
  const invalidMeio = meio.filter((m) => !VOCAB.mov_meio.includes(m));
  if (invalidMeio.length) return toolText(`Meio(s) inválido(s): ${invalidMeio.join(", ")}. Valores aceitos: ${VOCAB.mov_meio.join(", ")}.`, true);

  const tipo = [direcao, ...meio];
  const valorFinal = Math.round(valor * 100) / 100;

  const insertRes = await fetch(`${REST}/lifeos_movimentacoes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, valor: valorFinal, date, tipo }),
  });
  if (!insertRes.ok) return toolText(`Erro ao criar a movimentação: ${insertRes.status} ${await insertRes.text()}`, true);
  const created = (await insertRes.json())[0];

  return toolText(JSON.stringify({
    ok: true,
    movimentacao: { id: created.id, name: created.name, valor: Number(created.valor), date: created.date, tipo: created.tipo ?? [] },
  }, null, 2));
}

// ── Tool: update_movimentacao (PATCH parcial -- direcao/meio recompõem o
// `tipo` final a partir do valor ATUAL da tabela quando só um dos dois é
// enviado, pra não perder a outra metade do array sem querer) ───────────
async function handleUpdateMovimentacao(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const id = String(args?.id ?? "").trim();
  if (!id) return toolText("O parâmetro id (id da movimentação a editar, retornado por search_movimentacoes) é obrigatório.", true);

  const update: Record<string, any> = {};

  if (args?.name !== undefined) {
    const name = String(args.name).trim();
    if (!name) return toolText("O parâmetro name, quando enviado, não pode ser vazio.", true);
    update.name = name;
  }
  if (args?.valor !== undefined) {
    const valor = Number(args.valor);
    if (!Number.isFinite(valor) || valor < 0) return toolText("O parâmetro valor, quando enviado, precisa ser um número não-negativo.", true);
    update.valor = Math.round(valor * 100) / 100;
  }
  if (args?.date !== undefined) {
    const date = String(args.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toolText("O parâmetro date, quando enviado, precisa estar no formato YYYY-MM-DD.", true);
    update.date = date;
  }

  let direcao: string | undefined;
  if (args?.direcao !== undefined) {
    direcao = String(args.direcao);
    if (!VOCAB.mov_direcao.includes(direcao)) return toolText(`Direção inválida: ${direcao}. Valores aceitos: ${VOCAB.mov_direcao.join(", ")}.`, true);
  }
  let meio: string[] | undefined;
  if (args?.meio !== undefined) {
    meio = strArray(args.meio);
    const invalidMeio = meio.filter((m) => !VOCAB.mov_meio.includes(m));
    if (invalidMeio.length) return toolText(`Meio(s) inválido(s): ${invalidMeio.join(", ")}. Valores aceitos: ${VOCAB.mov_meio.join(", ")}.`, true);
  }

  if (direcao !== undefined || meio !== undefined) {
    const curRes = await fetch(`${REST}/lifeos_movimentacoes?id=eq.${id}&select=tipo`, { headers });
    if (!curRes.ok) throw new Error(`select movimentacao -> ${curRes.status} ${await curRes.text()}`);
    const curRows = await curRes.json();
    if (!curRows.length) return toolText(`Nenhuma movimentação encontrada com id ${id}.`, true);
    const tipoAtual: string[] = curRows[0].tipo ?? [];
    const direcaoAtual = tipoAtual.find((t) => VOCAB.mov_direcao.includes(t));
    const meioAtual = tipoAtual.filter((t) => VOCAB.mov_meio.includes(t));
    update.tipo = [direcao ?? direcaoAtual, ...(meio ?? meioAtual)];
  }

  if (!Object.keys(update).length) return toolText("Nenhum campo pra atualizar foi enviado -- envie ao menos um de: name, valor, date, direcao, meio.", true);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_movimentacoes?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return toolText(`Erro ao atualizar a movimentação: ${r.status} ${await r.text()}`, true);
  const rows = await r.json();
  if (!rows.length) return toolText(`Nenhuma movimentação encontrada com id ${id}.`, true);
  const updated = rows[0];

  return toolText(JSON.stringify({
    ok: true,
    movimentacao: { id: updated.id, name: updated.name, valor: Number(updated.valor), date: updated.date, tipo: updated.tipo ?? [], updated_at: updated.updated_at },
  }, null, 2));
}
