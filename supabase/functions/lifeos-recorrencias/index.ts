// lifeos-recorrencias - Supabase Edge Function
//
// Backend das Recorrências previstas das Finanças (Psyches Archive,
// financas.html -- ver FINANCAS.md §9.2). Uma recorrência é o que se espera
// que entre ou saia todo mês: nome, direção, valor fixo ou faixa
// (valor_min/valor_max), meio, dia e se está ativa. Não gera movimentação:
// é tabela de referência que o resumo_financeiro do MCP lê pra projetar o
// mês seguinte (o MCP lê a tabela direto, sem passar por aqui).
//
// Acoes: "query" (default, lista todas), "create", "update" (patch
// parcial), "delete".
//
// SEGURANCA (mesma postura de lifeos-projetos):
//  - verify_jwt = false: autenticacao via senha mestre no corpo, checada
//    contra access_tokens.is_master usando a service role (RPC
//    check_master_token). O site chama com a anon key publica.
//  - Escritas na tabela usam a service role (REST do PostgREST), nunca
//    exposta ao browser.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ORIGEM PERMITIDA (CORS)
//
// Vem de LIFEOS_ALLOWED_ORIGIN. **Sem a variavel, o padrao e "*"** -- um
// deploy novo funciona em qualquer dominio sem configuracao nenhuma.
//
// "*" nao afrouxa a seguranca deste desenho: a autenticacao e a senha
// mestre enviada NO CORPO da requisicao, nao um cookie. A fronteira real e
// check_master_token, server-side. Ver o comentario completo em
// lifeos-projetos.
//
//   supabase secrets set LIFEOS_ALLOWED_ORIGIN=https://<usuario>.github.io
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// O nome casa com o das movimentações, então segue o mesmo tamanho de uma
// descrição curta. O teto de valor só barra erro de digitação (um zero a
// mais), não é regra de negócio.
const MAX_NOME = 120;
const MAX_VALOR = 1_000_000;

// Fallback dos vocabulários, se lifeos_vocabularios estiver indisponível --
// mesmos valores do FALLBACK de lifeos-mcp e do seed da migration 0002.
const DIRECAO_FALLBACK = ["Entrada", "Saida"];
const MEIO_FALLBACK = ["Crédito", "Débito", "Pix", "Vale", "Boleto"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type Ctx = { REST: string; headers: Record<string, string> };

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
  const ctx: Ctx = { REST, headers: restHeaders };

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
    let token = "", action = "query", id = "";
    let recorrencia: Record<string, any> | null = null;
    let patch: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      recorrencia = (body?.recorrencia && typeof body.recorrencia === "object") ? body.recorrencia : null;
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(ctx, recorrencia);
    if (action === "update") return await handleUpdate(ctx, id, patch);
    if (action === "delete") return await handleDelete(ctx, id);

    return await handleQuery(ctx);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function normalizeRow(r: any) {
  return {
    id: r.id, nome: r.nome, direcao: r.direcao,
    valor_min: Number(r.valor_min), valor_max: Number(r.valor_max),
    meio: r.meio ?? null, dia: r.dia ?? null, ativa: r.ativa !== false,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

// Devolve a string limpa, ou null se vazia/grande demais.
function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > max) return null;
  return s;
}

// Mesma normalização de finChave no lifeos-mcp (sem os apelidos): é o que
// decide se duas recorrências são a mesma coisa.
function chave(nome: string): string {
  return (nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

async function fetchVocab(ctx: Ctx, dominio: string, fallback: string[]): Promise<string[]> {
  try {
    const r = await fetch(
      `${ctx.REST}/lifeos_vocabularios?dominio=eq.${dominio}&select=valor&order=ordem.asc,valor.asc`,
      { headers: ctx.headers },
    );
    if (!r.ok) return fallback;
    const rows: { valor: string }[] = await r.json();
    return rows.length ? rows.map((x) => x.valor) : fallback;
  } catch {
    return fallback;
  }
}

function parseValor(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_VALOR) return null;
  return Math.round(n * 100) / 100;
}

// Valida os campos presentes em `src` e devolve os que vão pro banco, ou o
// código de erro. `completo` exige todos os obrigatórios (create).
async function validar(ctx: Ctx, src: Record<string, any>, completo: boolean): Promise<{ campos?: Record<string, any>; erro?: string }> {
  const campos: Record<string, any> = {};

  if (completo || "nome" in src) {
    const nome = cleanText(src.nome, MAX_NOME);
    if (!nome) return { erro: "invalid_nome" };
    campos.nome = nome;
  }
  if (completo || "direcao" in src) {
    const direcao = String(src.direcao ?? "").trim();
    if (!(await fetchVocab(ctx, "mov_direcao", DIRECAO_FALLBACK)).includes(direcao)) return { erro: "invalid_direcao" };
    campos.direcao = direcao;
  }
  // Valor vai sempre em par: fixo manda os dois iguais.
  if (completo || "valor_min" in src || "valor_max" in src) {
    const min = parseValor(src.valor_min), max = parseValor(src.valor_max);
    if (min === null || max === null || max < min) return { erro: "invalid_valor" };
    campos.valor_min = min;
    campos.valor_max = max;
  }
  if ("meio" in src) {
    const meio = src.meio === null ? "" : String(src.meio).trim();
    if (meio && !(await fetchVocab(ctx, "mov_meio", MEIO_FALLBACK)).includes(meio)) return { erro: "invalid_meio" };
    campos.meio = meio || null;
  }
  if ("dia" in src) {
    if (src.dia === null || src.dia === "") campos.dia = null;
    else {
      const dia = Number(src.dia);
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) return { erro: "invalid_dia" };
      campos.dia = dia;
    }
  }
  if ("ativa" in src) {
    if (typeof src.ativa !== "boolean") return { erro: "invalid_ativa" };
    campos.ativa = src.ativa;
  }
  return { campos };
}

// Duas recorrências com a mesma chave e a mesma direção seriam contadas duas
// vezes na projeção.
async function duplicada(ctx: Ctx, nome: string, direcao: string, ignorarId = ""): Promise<boolean> {
  const r = await fetch(`${ctx.REST}/lifeos_recorrencias?select=id,nome&direcao=eq.${encodeURIComponent(direcao)}`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select recorrencias -> ${r.status} ${await r.text()}`);
  const rows: { id: string; nome: string }[] = await r.json();
  const k = chave(nome);
  return rows.some((x) => x.id !== ignorarId && chave(x.nome) === k);
}

async function handleQuery(ctx: Ctx) {
  const r = await fetch(`${ctx.REST}/lifeos_recorrencias?order=direcao.asc,nome.asc`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select recorrencias -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return json({ ok: true, recorrencias: rows.map(normalizeRow) });
}

async function handleCreate(ctx: Ctx, rec: Record<string, any> | null) {
  if (!rec) return json({ ok: false, error: "missing_recorrencia" }, 400);
  const v = await validar(ctx, rec, true);
  if (v.erro) return json({ ok: false, error: v.erro }, 400);
  const campos = v.campos!;
  if (await duplicada(ctx, campos.nome, campos.direcao)) return json({ ok: false, error: "nome_duplicado" }, 409);

  const r = await fetch(`${ctx.REST}/lifeos_recorrencias`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify(campos),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, recorrencia: normalizeRow(rows[0]) });
}

async function handleUpdate(ctx: Ctx, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const v = await validar(ctx, patch, false);
  if (v.erro) return json({ ok: false, error: v.erro }, 400);
  const update = v.campos!;
  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);

  if ("nome" in update || "direcao" in update) {
    const cur = await fetch(`${ctx.REST}/lifeos_recorrencias?id=eq.${id}&select=nome,direcao`, { headers: ctx.headers });
    if (!cur.ok) throw new Error(`select recorrencia -> ${cur.status} ${await cur.text()}`);
    const curRows = await cur.json();
    if (!curRows.length) return json({ ok: false, error: "not_found" }, 404);
    const nome = update.nome ?? curRows[0].nome, direcao = update.direcao ?? curRows[0].direcao;
    if (await duplicada(ctx, nome, direcao, id)) return json({ ok: false, error: "nome_duplicado" }, 409);
  }
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${ctx.REST}/lifeos_recorrencias?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, recorrencia: normalizeRow(rows[0]) });
}

async function handleDelete(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${ctx.REST}/lifeos_recorrencias?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
