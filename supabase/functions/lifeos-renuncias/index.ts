// lifeos-renuncias - Supabase Edge Function
//
// Backend das Renúncias do LifeOS (lifeos/renuncias.html -- ver
// LIFEOS.md §19). Uma renúncia é um hábito cortado: nome, emoji e
// `desde` (a última vez). Cada recaída fecha a tentativa atual numa linha de
// lifeos_renuncia_tentativas e recomeça o contador. Os marcos (1d, 3d…) e o
// progresso até eles são conta do front -- aqui só existe o dado.
//
// Acoes: "query" (default, todas com o histórico embutido), "create",
// "update" (patch parcial: nome, emoji, desde, arquivada -- desarquivar
// recomeca o `desde` agora), "delete",
// "recaida" (id + `quando` opcional, padrão agora -- RPC
// lifeos_renuncia_recaida, migration 0010).
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

// Nome é um rótulo curto ("Açúcar", "Redes sociais"). Emoji aceita
// sequências ZWJ (👨‍👩‍👧 são 8 unidades UTF-16), mas não uma frase.
const MAX_NOME = 80;
const MAX_EMOJI = 16;
// Folga para o relógio do aparelho estar um pouco à frente do servidor:
// "agora" no celular não pode virar "no futuro" aqui.
const FOLGA_FUTURO_MS = 5 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type Ctx = { REST: string; headers: Record<string, string>; rpc: (fn: string, args: Record<string, unknown>) => Promise<any> };

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
    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    const token = (body?.token ?? "").toString().trim();
    const action = (body?.action ?? "query").toString().trim() || "query";
    const id = (body?.id ?? "").toString().trim();
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const ctx: Ctx = { REST, headers: restHeaders, rpc };
    const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, any> : null);

    if (action === "create") return await handleCreate(ctx, obj(body.renuncia));
    if (action === "update") return await handleUpdate(ctx, id, obj(body.patch));
    if (action === "delete") return await handleDelete(ctx, id);
    if (action === "recaida") return await handleRecaida(ctx, id, body.quando);

    return await handleQuery(ctx);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ── helpers ──────────────────────────────────────────────────────────────

// Devolve a string limpa, ou null se vazia/grande demais.
function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > max) return null;
  return s;
}

// Instante ISO válido e não no futuro (com a folga do relógio), ou null.
function cleanInstante(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t) || t > Date.now() + FOLGA_FUTURO_MS) return null;
  return new Date(Math.min(t, Date.now())).toISOString();
}

function normalizeTentativa(t: any) {
  return { id: t.id, inicio: t.inicio, fim: t.fim };
}

function normalizeRow(r: any) {
  const tent = Array.isArray(r.tentativas) ? r.tentativas : [];
  // Mais recente primeiro -- é a ordem do histórico na tela e no MCP.
  tent.sort((a: any, b: any) => (a.fim < b.fim ? 1 : a.fim > b.fim ? -1 : 0));
  return {
    id: r.id, nome: r.nome, emoji: r.emoji, desde: r.desde, arquivada: !!r.arquivada,
    created_at: r.created_at, updated_at: r.updated_at,
    tentativas: tent.map(normalizeTentativa),
  };
}

const SELECT = "select=*,tentativas:lifeos_renuncia_tentativas(id,inicio,fim)";

// Unique violation do índice de nome (23505) vira um erro que a tela sabe
// explicar, não um "db_error" genérico.
async function dbError(r: Response) {
  const txt = await r.text();
  if (r.status === 409 || txt.includes("23505")) return json({ ok: false, error: "nome_duplicado" }, 409);
  return json({ ok: false, error: `db_error: ${r.status} ${txt}` }, 502);
}

async function fetchRenuncia(ctx: Ctx, id: string) {
  const r = await fetch(`${ctx.REST}/lifeos_renuncias?id=eq.${id}&${SELECT}`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select renuncia -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.length ? normalizeRow(rows[0]) : null;
}

// Todas as linhas da consulta, página a página. O PostgREST corta em
// max-rows (1000 no Supabase) SEM erro: uma leitura única devolvia as
// primeiras 1000 e a tela tratava como a lista inteira. A `order` de quem
// chama termina numa coluna única (id), senão as páginas se sobrepõem.
// Cópia em cada function que lista (ver LIFEOS.md §2), não import.
async function selectTodas(REST: string, headers: Record<string, string>, tabelaQs: string): Promise<any[]> {
  const PAGINA = 1000;
  const out: any[] = [];
  for (;;) {
    const r = await fetch(`${REST}/${tabelaQs}&limit=${PAGINA}&offset=${out.length}`, { headers: { ...headers, Prefer: "count=exact" } });
    if (!r.ok) throw new Error(`select ${tabelaQs.split("?")[0]} -> ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    const total = Number((r.headers.get("content-range") || "").split("/")[1]);
    if (!rows.length || !Number.isFinite(total) || out.length >= total) return out;
  }
}

// ── handlers ─────────────────────────────────────────────────────────────

async function handleQuery(ctx: Ctx) {
  // `desde` ascendente: a renúncia mais antiga (a que está há mais tempo)
  // primeiro.
  const rows = await selectTodas(ctx.REST, ctx.headers, `lifeos_renuncias?${SELECT}&order=desde.asc,id.asc`);
  return json({ ok: true, renuncias: rows.map(normalizeRow) });
}

async function handleCreate(ctx: Ctx, r0: Record<string, any> | null) {
  if (!r0) return json({ ok: false, error: "missing_renuncia" }, 400);

  const nome = cleanText(r0.nome, MAX_NOME);
  if (!nome) return json({ ok: false, error: "invalid_nome" }, 400);
  const emoji = cleanText(r0.emoji, MAX_EMOJI);
  if (!emoji) return json({ ok: false, error: "invalid_emoji" }, 400);
  const desde = cleanInstante(r0.desde);
  if (!desde) return json({ ok: false, error: "invalid_desde" }, 400);

  const r = await fetch(`${ctx.REST}/lifeos_renuncias`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ nome, emoji, desde }),
  });
  if (!r.ok) return await dbError(r);
  const rows = await r.json();
  return json({ ok: true, renuncia: normalizeRow({ ...rows[0], tentativas: [] }) });
}

async function handleUpdate(ctx: Ctx, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const update: Record<string, any> = {};
  if ("nome" in patch) {
    const nome = cleanText(patch.nome, MAX_NOME);
    if (!nome) return json({ ok: false, error: "invalid_nome" }, 400);
    update.nome = nome;
  }
  if ("emoji" in patch) {
    const emoji = cleanText(patch.emoji, MAX_EMOJI);
    if (!emoji) return json({ ok: false, error: "invalid_emoji" }, 400);
    update.emoji = emoji;
  }
  if ("desde" in patch) {
    const desde = cleanInstante(patch.desde);
    if (!desde) return json({ ok: false, error: "invalid_desde" }, 400);
    update.desde = desde;
  }
  if ("arquivada" in patch) {
    if (typeof patch.arquivada !== "boolean") return json({ ok: false, error: "invalid_arquivada" }, 400);
    update.arquivada = patch.arquivada;
    // Arquivada nao conta tempo (a tela e o MCP ignoram o `desde` dela), entao
    // desarquivar e uma tentativa nova: o contador recomeca agora, a menos que
    // o patch traga o proprio `desde`. So vale se ela estava arquivada.
    if (patch.arquivada === false && !("desde" in patch)) {
      const atual = await fetch(`${ctx.REST}/lifeos_renuncias?id=eq.${id}&select=arquivada`, { headers: ctx.headers });
      if (!atual.ok) return await dbError(atual);
      const linhas = await atual.json();
      if (!linhas.length) return json({ ok: false, error: "not_found" }, 404);
      if (linhas[0].arquivada) update.desde = new Date().toISOString();
    }
  }
  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${ctx.REST}/lifeos_renuncias?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...ctx.headers, Prefer: "return=minimal" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return await dbError(r);
  const renuncia = await fetchRenuncia(ctx, id);
  if (!renuncia) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, renuncia });
}

async function handleDelete(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${ctx.REST}/lifeos_renuncias?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}

async function handleRecaida(ctx: Ctx, id: string, quando0: unknown) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const quando = (quando0 === undefined || quando0 === null || quando0 === "")
    ? new Date().toISOString()
    : cleanInstante(quando0);
  if (!quando) return json({ ok: false, error: "invalid_quando" }, 400);

  const res = await ctx.rpc("lifeos_renuncia_recaida", { p_id: id, p_quando: quando });
  if (res === "not_found") return json({ ok: false, error: "not_found" }, 404);
  if (res === "antes_do_inicio") return json({ ok: false, error: "quando_antes_do_inicio" }, 400);

  const renuncia = await fetchRenuncia(ctx, id);
  if (!renuncia) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, renuncia });
}
