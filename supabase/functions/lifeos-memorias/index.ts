// lifeos-memorias - Supabase Edge Function
//
// Backend da Memória do LifeOS (lifeos/memoria.html -- ver
// LIFEOS.md §17). Memória de longo prazo que não depende de harness nem de
// modelo: um índice (`lifeos_memorias`: título + descrição + categoria) e N
// registros de texto por memória (`lifeos_memoria_registros`).
//
// Acoes:
//   "query" (default)   -> todas as memórias, cada uma com seus registros,
//                          + o vocabulário de categorias
//   "create"            -> memória nova (registros iniciais opcionais)
//   "update"            -> patch parcial de titulo/descricao/categoria
//   "delete"            -> apaga a memória (registros vão junto, cascade)
//   "registro_create"   -> append de um registro numa memória
//   "registro_update"   -> troca o texto de um registro
//   "registro_delete"   -> apaga um registro
//
// Toda escrita num registro toca `updated_at` da memória-mãe: o índice
// ordena por atividade, e "atualizada em" tem de refletir o último registro,
// não só a última vez que alguém renomeou a memória.
//
// O MCP (lifeos-mcp) NÃO passa por aqui -- ele fala direto com o PostgREST,
// como faz com todos os domínios. As regras de validação (limites, categoria
// contra o vocabulário, título único) estão copiadas lá; mudar uma exige
// mudar a outra (LIFEOS.md §2: cópia, não import).
//
// SEGURANCA (mesma postura de lifeos-citacoes):
//  - verify_jwt = false: autenticacao via senha mestre no corpo, checada
//    contra access_tokens.is_master usando a service role (RPC
//    check_master_token). O site chama com a anon key publica.
//  - Escritas na tabela usam a service role (REST do PostgREST), nunca
//    exposta ao browser.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ORIGEM PERMITIDA (CORS) -- ver o comentario completo em lifeos-projetos.
//
//   supabase secrets set LIFEOS_ALLOWED_ORIGIN=https://<usuario>.github.io
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// A descrição é o que vai pro índice (e pras `instructions` do MCP), então o
// limite dela é o mais apertado de propósito: um índice com descrições de
// três parágrafos deixa de ser índice.
const MAX_TITULO = 120;
const MAX_DESCRICAO = 400;
const MAX_TEXTO = 8000;
const MAX_ORIGEM = 60;

// Fallback se a leitura de lifeos_vocabularios falhar -- mesmo princípio
// das outras functions (LIFEOS.md §14).
const CATEGORIAS_FALLBACK = ["Perfil", "Preferências", "Projetos", "Referências", "Vida"];

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
    let body: Record<string, any> = {};
    try {
      body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const ctx: Ctx = { REST, headers: restHeaders };
    const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, any> : null);

    if (action === "create") return await handleCreate(ctx, obj(body.memoria));
    if (action === "update") return await handleUpdate(ctx, id, obj(body.patch));
    if (action === "delete") return await handleDelete(ctx, id);
    if (action === "registro_create") return await handleRegistroCreate(ctx, obj(body.registro));
    if (action === "registro_update") return await handleRegistroUpdate(ctx, id, obj(body.patch));
    if (action === "registro_delete") return await handleRegistroDelete(ctx, id);

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

async function fetchCategorias(ctx: Ctx): Promise<string[]> {
  try {
    const r = await fetch(
      `${ctx.REST}/lifeos_vocabularios?dominio=eq.memoria_categoria&select=valor&order=ordem.asc,valor.asc`,
      { headers: ctx.headers },
    );
    if (!r.ok) return CATEGORIAS_FALLBACK;
    const rows: { valor: string }[] = await r.json();
    return rows.length ? rows.map((x) => x.valor) : CATEGORIAS_FALLBACK;
  } catch {
    return CATEGORIAS_FALLBACK;
  }
}

function normalizeRegistro(r: any) {
  return {
    id: r.id, memoria_id: r.memoria_id, texto: r.texto, origem: r.origem ?? null,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

function normalizeMemoria(r: any) {
  const regs = Array.isArray(r.lifeos_memoria_registros) ? r.lifeos_memoria_registros : [];
  regs.sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return {
    id: r.id, titulo: r.titulo, descricao: r.descricao ?? "", categoria: r.categoria,
    created_at: r.created_at, updated_at: r.updated_at,
    registros: regs.map(normalizeRegistro),
  };
}

// Unique violation do índice de título (23505) vira um erro que a tela sabe
// explicar, não um "db_error" genérico.
async function dbError(r: Response) {
  const txt = await r.text();
  if (r.status === 409 || txt.includes("23505")) return json({ ok: false, error: "titulo_duplicado" }, 409);
  return json({ ok: false, error: `db_error: ${r.status} ${txt}` }, 502);
}

async function tocarMemoria(ctx: Ctx, memoriaId: string) {
  await fetch(`${ctx.REST}/lifeos_memorias?id=eq.${memoriaId}`, {
    method: "PATCH",
    headers: ctx.headers,
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

async function fetchMemoria(ctx: Ctx, id: string) {
  const r = await fetch(
    `${ctx.REST}/lifeos_memorias?id=eq.${id}&select=*,lifeos_memoria_registros(*)`,
    { headers: ctx.headers },
  );
  if (!r.ok) throw new Error(`select memoria -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.length ? normalizeMemoria(rows[0]) : null;
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
  const [rows, categorias] = await Promise.all([
    selectTodas(ctx.REST, ctx.headers, "lifeos_memorias?select=*,lifeos_memoria_registros(*)&order=updated_at.desc,id.desc"),
    fetchCategorias(ctx),
  ]);
  return json({ ok: true, memorias: rows.map(normalizeMemoria), categorias });
}

async function handleCreate(ctx: Ctx, m: Record<string, any> | null) {
  if (!m) return json({ ok: false, error: "missing_memoria" }, 400);

  const titulo = cleanText(m.titulo, MAX_TITULO);
  if (!titulo) return json({ ok: false, error: "invalid_titulo" }, 400);
  const descricao = String(m.descricao ?? "").trim();
  if (descricao.length > MAX_DESCRICAO) return json({ ok: false, error: "invalid_descricao" }, 400);
  const categoria = String(m.categoria ?? "").trim();
  if (!(await fetchCategorias(ctx)).includes(categoria)) return json({ ok: false, error: "invalid_categoria" }, 400);

  const textos: string[] = [];
  if (Array.isArray(m.registros)) {
    for (const t of m.registros) {
      const s = cleanText(t, MAX_TEXTO);
      if (!s) return json({ ok: false, error: "invalid_texto" }, 400);
      textos.push(s);
    }
  }

  const r = await fetch(`${ctx.REST}/lifeos_memorias`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ titulo, descricao, categoria }),
  });
  if (!r.ok) return await dbError(r);
  const created = (await r.json())[0];

  if (textos.length) {
    const rr = await fetch(`${ctx.REST}/lifeos_memoria_registros`, {
      method: "POST",
      headers: ctx.headers,
      body: JSON.stringify(textos.map((texto) => ({ memoria_id: created.id, texto, origem: "manual" }))),
    });
    if (!rr.ok) return json({ ok: false, error: `registros_falharam: ${rr.status} ${await rr.text()}`, id: created.id }, 502);
  }

  return json({ ok: true, memoria: await fetchMemoria(ctx, created.id) });
}

async function handleUpdate(ctx: Ctx, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const update: Record<string, any> = {};
  if ("titulo" in patch) {
    const titulo = cleanText(patch.titulo, MAX_TITULO);
    if (!titulo) return json({ ok: false, error: "invalid_titulo" }, 400);
    update.titulo = titulo;
  }
  if ("descricao" in patch) {
    const descricao = String(patch.descricao ?? "").trim();
    if (descricao.length > MAX_DESCRICAO) return json({ ok: false, error: "invalid_descricao" }, 400);
    update.descricao = descricao;
  }
  if ("categoria" in patch) {
    const categoria = String(patch.categoria ?? "").trim();
    if (!(await fetchCategorias(ctx)).includes(categoria)) return json({ ok: false, error: "invalid_categoria" }, 400);
    update.categoria = categoria;
  }
  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${ctx.REST}/lifeos_memorias?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return await dbError(r);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, memoria: await fetchMemoria(ctx, id) });
}

async function handleDelete(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${ctx.REST}/lifeos_memorias?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return await dbError(r);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}

async function handleRegistroCreate(ctx: Ctx, reg: Record<string, any> | null) {
  if (!reg) return json({ ok: false, error: "missing_registro" }, 400);
  const memoriaId = String(reg.memoria_id ?? "").trim();
  if (!memoriaId) return json({ ok: false, error: "missing_memoria_id" }, 400);
  const texto = cleanText(reg.texto, MAX_TEXTO);
  if (!texto) return json({ ok: false, error: "invalid_texto" }, 400);
  const origem = cleanText(reg.origem, MAX_ORIGEM) ?? "manual";

  const r = await fetch(`${ctx.REST}/lifeos_memoria_registros`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ memoria_id: memoriaId, texto, origem }),
  });
  // FK inexistente (23503) = memória apagada entre o load da tela e o save.
  if (!r.ok) {
    const txt = await r.text();
    if (txt.includes("23503")) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: false, error: `db_error: ${r.status} ${txt}` }, 502);
  }
  const created = (await r.json())[0];
  await tocarMemoria(ctx, memoriaId);
  return json({ ok: true, registro: normalizeRegistro(created) });
}

async function handleRegistroUpdate(ctx: Ctx, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const texto = cleanText(patch?.texto, MAX_TEXTO);
  if (!texto) return json({ ok: false, error: "invalid_texto" }, 400);

  const r = await fetch(`${ctx.REST}/lifeos_memoria_registros?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ texto, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return await dbError(r);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  await tocarMemoria(ctx, rows[0].memoria_id);
  return json({ ok: true, registro: normalizeRegistro(rows[0]) });
}

async function handleRegistroDelete(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${ctx.REST}/lifeos_memoria_registros?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return await dbError(r);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  await tocarMemoria(ctx, rows[0].memoria_id);
  return json({ ok: true, id });
}
