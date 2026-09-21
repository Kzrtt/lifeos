// lifeos-movimentacoes - Supabase Edge Function
//
// Backend do modulo Financas dentro do hub LifeOS (LifeOS, /financas).
// Substitui notion-movimentacoes: a fonte de verdade das movimentacoes
// financeiras deixou de ser o Notion e passou a ser a tabela
// public.lifeos_movimentacoes, de posse total do projeto. Ver LIFEOS.md e
// FINANCAS.md.
//
// Mesmo contrato de request/response que notion-movimentacoes tinha para
// "query" e "update" (ver FINANCAS.md antigo §6) -- o front (financas.js) so
// trocou a URL, nao o shape dos dados. Duas acoes novas: "create" e "delete".
//
// SEGURANCA (mesma postura de sempre -- nao "corrigir" em review):
//  - verify_jwt = false: autenticacao via senha mestre no corpo, checada
//    contra access_tokens.is_master usando a service role (RPC
//    check_master_token). O site chama com a anon key publica.
//  - Escritas na tabela usam a service role (REST do PostgREST), nunca
//    exposta ao browser.
//  - CORS configuravel por LIFEOS_ALLOWED_ORIGIN (padrao: qualquer origem;
//    ver o comentario grande sobre isso mais abaixo).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ORIGEM PERMITIDA (CORS)
//
// Vem de LIFEOS_ALLOWED_ORIGIN. **Sem a variavel, o padrao e "*"** -- ou
// seja, um deploy novo funciona em qualquer dominio sem configuracao
// nenhuma. Antes daqui o valor era o dominio pessoal do autor chapado no
// codigo, e um fork subia e morria em CORS com um erro que nao diz o que
// fazer. Esse era o problema.
//
// "*" nao afrouxa a seguranca deste desenho: a autenticacao e a senha
// mestre enviada NO CORPO da requisicao, nao um cookie. Nao ha credencial
// ambiente que o browser anexe sozinho, entao uma pagina maliciosa que
// chame esta function nao consegue nada sem ja saber a senha -- e se
// souber, o CORS nao a impediria de qualquer forma (curl ignora CORS).
// A fronteira real e check_master_token, server-side.
//
// Quem quiser restringir mesmo assim (defesa em profundidade, ou reduzir
// ruido de bot):
//   supabase secrets set LIFEOS_ALLOWED_ORIGIN=https://<usuario>.github.io
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// Vocabulario valido da tabela (ver FINANCAS.md §7). Direcao: exatamente uma
// das duas. Meio: zero ou mais das cinco (na pratica a UI so deixa escolher uma).
const DIRECOES = ["Entrada", "Saida"];
const MEIOS_VALIDOS = ["Crédito", "Débito", "Pix", "Vale", "Boleto"];

// ── Vocabulário dinâmico ──────────────────────────────────────────────
// As constantes acima viraram FALLBACK. Desde a migration 0002 a lista de
// verdade esta em `lifeos_vocabularios`, editavel em LifeOS > menu > Tags.
//
// Sem isto, adicionar uma tag pela tela seria aceito na tabela de
// vocabularios e RECUSADO aqui no save -- a feature pareceria quebrada.
//
// Falha de leitura mantem o fallback: degradar pro vocabulario embutido e
// melhor que recusar tudo.
let VOCAB: Record<string, string[]> = {};

async function carregarVocab(REST: string, headers: Record<string, string>) {
  try {
    const r = await fetch(`${REST}/lifeos_vocabularios?select=dominio,valor&order=dominio.asc,ordem.asc`, { headers });
    if (!r.ok) return;
    const rows: { dominio: string; valor: string }[] = await r.json();
    const novo: Record<string, string[]> = {};
    for (const row of rows) (novo[row.dominio] ??= []).push(row.valor);
    VOCAB = novo;
  } catch { /* mantem o fallback */ }
}

// Lista de um dominio, caindo no fallback quando a tabela nao respondeu ou
// o dominio esta vazio.
function vocab(dominio: string, fallback: string[]): string[] {
  const l = VOCAB[dominio];
  return (l && l.length) ? l : fallback;
}


const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const REST = `${SUPABASE_URL}/rest/v1`;
  const restHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  await carregarVocab(REST, restHeaders);

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await fetch(`${REST}/rpc/${fn}`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`rpc ${fn} -> ${r.status} ${await r.text()}`);
    return r.json();
  };

  try {
    let token = "", ym = "", ymPrev = "", action = "query", id = "";
    let patch: Record<string, any> | null = null;
    let movimentacao: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      ym = (body?.ym ?? "").toString().trim();
      ymPrev = (body?.ym_prev ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
      movimentacao = (body?.movimentacao && typeof body.movimentacao === "object") ? body.movimentacao : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    // Gate master (server-side -- a fronteira real, mesma RPC de sempre)
    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "update") return await handleUpdate(REST, restHeaders, id, patch);
    if (action === "create") return await handleCreate(REST, restHeaders, movimentacao);
    if (action === "delete") return await handleDelete(REST, restHeaders, id);

    // query (default)
    const targetYm = /^\d{4}-\d{2}$/.test(ym) ? ym : serverYm();
    const targetPrev = /^\d{4}-\d{2}$/.test(ymPrev) ? ymPrev : "";
    return await handleQuery(REST, restHeaders, targetYm, targetPrev);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function serverYm(): string {
  const d = new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function monthRange(ym: string): { first: string; nextFirst: string } {
  const parts = ym.split("-").map(Number);
  const y = parts[0], m = parts[1];
  const first = `${ym}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const nextFirst = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { first, nextFirst };
}

function normalizeRow(r: any) {
  return { id: r.id, name: r.name, valor: r.valor === null ? null : Number(r.valor), date: r.date, tipo: r.tipo ?? [] };
}

// Busca por mes (mesmo contrato de notion-movimentacoes): movimentacoes do
// mes + range (min/max de date na tabela inteira, via RPC lifeos_range) +
// saldo_abertura (soma condicional de tudo antes do mes, via RPC
// lifeos_saldo_abertura) -- tudo em SQL direto, sem paginacao manual como
// era preciso com a API do Notion.
// `ymPrev` (opcional) existe para o HUB, nao para a pagina de Financas: o
// card da fatura que FECHA neste mes e projetado a partir das compras em
// Credito do mes ANTERIOR, entao o hub precisa dos dois meses numa chamada
// so -- ver `renderFaturaCards` em lifeos.js.
//
// Sem isto o hub recebe `movimentacoes_prev` indefinido, `FIN_PREV_ROWS`
// fica vazio e os cards de fatura aparecem zerados ou errados. A pagina de
// Financas nao passa por aqui e por isso continua correta -- foi assim que
// o sintoma apareceu "so no hub".
async function handleQuery(REST: string, headers: Record<string, string>, ym: string, ymPrev = "") {
  const { first, nextFirst } = monthRange(ym);

  const [rowsRes, rangeRes, aberturaRes] = await Promise.all([
    fetch(`${REST}/lifeos_movimentacoes?date=gte.${first}&date=lt.${nextFirst}&order=date.asc`, { headers }),
    fetch(`${REST}/rpc/lifeos_range`, { method: "POST", headers, body: JSON.stringify({}) }),
    fetch(`${REST}/rpc/lifeos_saldo_abertura`, { method: "POST", headers, body: JSON.stringify({ p_before: first }) }),
  ]);

  if (!rowsRes.ok) throw new Error(`select movimentacoes -> ${rowsRes.status} ${await rowsRes.text()}`);
  if (!rangeRes.ok) throw new Error(`rpc lifeos_range -> ${rangeRes.status} ${await rangeRes.text()}`);
  if (!aberturaRes.ok) throw new Error(`rpc lifeos_saldo_abertura -> ${aberturaRes.status} ${await aberturaRes.text()}`);

  const rows = await rowsRes.json();
  const rangeRows = await rangeRes.json();
  const saldoAbertura = await aberturaRes.json();

  const r0 = rangeRows?.[0] || {};
  const range = (r0.min_date && r0.max_date) ? { min: String(r0.min_date).slice(0, 7), max: String(r0.max_date).slice(0, 7) } : null;

  const movimentacoes = rows.map(normalizeRow);

  let movimentacoes_prev: unknown[] | undefined;
  if (ymPrev) {
    const pr = monthRange(ymPrev);
    const prevRes = await fetch(
      `${REST}/lifeos_movimentacoes?date=gte.${pr.first}&date=lt.${pr.nextFirst}&order=date.asc`,
      { headers },
    );
    // Best-effort: se o mes anterior falhar, devolve o mes atual mesmo
    // assim com uma lista vazia -- melhor um card de fatura vazio do que a
    // tela inteira sem carregar.
    movimentacoes_prev = prevRes.ok ? (await prevRes.json()).map(normalizeRow) : [];
  }

  return json({
    ok: true,
    ym,
    ym_prev: ymPrev || undefined,
    range,
    saldo_abertura: typeof saldoAbertura === "number" ? saldoAbertura : 0,
    count: movimentacoes.length,
    fetched_at: new Date().toISOString(),
    movimentacoes,
    movimentacoes_prev,
  });
}

// Valida e monta o objeto de propriedades da tabela a partir de um patch
// PARCIAL (update) -- cada campo so entra se veio no corpo. Mesma validacao
// de vocabulario que a function anterior tinha para o Notion.
function buildFields(input: Record<string, any>, opts: { requireAll: boolean }): { fields?: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) return { error: "invalid_name" };
    fields.name = name;
  } else if (opts.requireAll) {
    return { error: "invalid_name" };
  }

  if (input.valor !== undefined) {
    const valor = Number(input.valor);
    if (!Number.isFinite(valor) || valor < 0) return { error: "invalid_valor" };
    fields.valor = Math.round(valor * 100) / 100;
  } else if (opts.requireAll) {
    return { error: "invalid_valor" };
  }

  if (input.date !== undefined) {
    const date = String(input.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "invalid_date" };
    fields.date = date;
  } else if (opts.requireAll) {
    return { error: "invalid_date" };
  }

  if (input.tipo !== undefined) {
    if (!Array.isArray(input.tipo) || !input.tipo.length) return { error: "invalid_tipo" };
    const tipo = input.tipo.map((t: unknown) => String(t));
    const dirCount = tipo.filter((t: string) => vocab("mov_direcao", DIRECOES).includes(t)).length;
    const meioOk = tipo.every((t: string) => vocab("mov_direcao", DIRECOES).includes(t) || vocab("mov_meio", MEIOS_VALIDOS).includes(t));
    if (dirCount !== 1 || !meioOk) return { error: "invalid_tipo" };
    fields.tipo = tipo;
  } else if (opts.requireAll) {
    return { error: "invalid_tipo" };
  }

  return { fields };
}

async function handleUpdate(REST: string, headers: Record<string, string>, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const { fields, error } = buildFields(patch, { requireAll: false });
  if (error) return json({ ok: false, error }, 400);
  if (!fields || !Object.keys(fields).length) return json({ ok: false, error: "empty_patch" }, 400);

  fields.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_movimentacoes?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(fields),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, movimentacao: normalizeRow(rows[0]) });
}

async function handleCreate(REST: string, headers: Record<string, string>, movimentacao: Record<string, any> | null) {
  if (!movimentacao) return json({ ok: false, error: "missing_movimentacao" }, 400);

  const { fields, error } = buildFields(movimentacao, { requireAll: true });
  if (error) return json({ ok: false, error }, 400);

  const r = await fetch(`${REST}/lifeos_movimentacoes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(fields),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, movimentacao: normalizeRow(rows[0]) });
}

async function handleDelete(REST: string, headers: Record<string, string>, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${REST}/lifeos_movimentacoes?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
