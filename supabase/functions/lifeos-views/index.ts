// lifeos-views - Supabase Edge Function
//
// Backend das views salvas (filtros combinaveis) de Notas e Tarefas do
// LifeOS (Psyches Archive) -- ver LIFEOS.md. Cada view guarda um nome, um
// modo de combinacao ('todas' = E logico entre regras, 'qualquer' = OU) e
// uma lista de regras { campo, operador, valores }. O FILTRO em si roda no
// cliente (poucas linhas em ambas as tabelas) -- esta function so persiste
// a DEFINICAO da view, pra sincronizar entre aparelhos.
//
// A view "Todas" (sem filtro) e implicita no front-end -- nunca vira uma
// linha aqui.
//
// Acoes: "query" ({ tabela }), "create" ({ view }), "update" ({ id, patch }),
// "delete" ({ id }).
//
// SEGURANCA: mesma postura de lifeos-notas/lifeos-tarefas.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ORIGEM PERMITIDA (CORS) -- ver o comentario grande equivalente em
// lifeos-notas/index.ts pro raciocinio completo de por que "*" e aceitavel
// aqui (autenticacao e a senha mestre no CORPO, nao um cookie).
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const TABELAS = ["notas", "tarefas"] as const;
type Tabela = typeof TABELAS[number];

const MODOS = ["todas", "qualquer"];
const OPERADORES = ["incluir", "excluir"];

// Campos validos por tabela -- Notas nao tem status/kanban (ver NOTAS.md
// §1), entao uma regra de status numa view de notas e rejeitada.
const CAMPOS_POR_TABELA: Record<Tabela, string[]> = {
  notas: ["projeto", "tipo"],
  tarefas: ["projeto", "tipo", "status"],
};

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
    let token = "", action = "query", id = "", tabela = "";
    let view: Record<string, any> | null = null;
    let patch: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      tabela = (body?.tabela ?? "").toString().trim();
      view = (body?.view && typeof body.view === "object") ? body.view : null;
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(REST, restHeaders, view);
    if (action === "update") return await handleUpdate(REST, restHeaders, id, patch);
    if (action === "delete") return await handleDelete(REST, restHeaders, id);

    return await handleQuery(REST, restHeaders, tabela);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function normalizeRow(r: any) {
  return {
    id: r.id, tabela: r.tabela, nome: r.nome, modo: r.modo,
    regras: r.regras ?? [], ordem: r.ordem,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

function validTabela(v: unknown): Tabela | null {
  return (typeof v === "string" && (TABELAS as readonly string[]).includes(v)) ? v as Tabela : null;
}

// Valida o array `regras` inteiro pra uma `tabela` especifica -- cada item
// precisa ter campo/operador/valores no formato certo. Devolve null se
// QUALQUER regra for invalida (tudo ou nada, nunca salva um subconjunto).
function validRegras(v: unknown, tabela: Tabela): Array<Record<string, unknown>> | null {
  if (!Array.isArray(v)) return null;
  const camposValidos = CAMPOS_POR_TABELA[tabela];
  const out: Array<Record<string, unknown>> = [];
  for (const r of v) {
    if (!r || typeof r !== "object") return null;
    const campo = String((r as any).campo ?? "");
    const operador = String((r as any).operador ?? "");
    const valoresRaw = (r as any).valores;
    if (!camposValidos.includes(campo)) return null;
    if (!OPERADORES.includes(operador)) return null;
    if (!Array.isArray(valoresRaw) || !valoresRaw.length) return null;
    const valores: string[] = [];
    for (const val of valoresRaw) {
      const s = String(val ?? "").trim();
      if (!s) return null;
      valores.push(s);
    }
    out.push({ campo, operador, valores });
  }
  return out;
}

async function nextOrdem(REST: string, headers: Record<string, string>, tabela: Tabela): Promise<number> {
  const r = await fetch(`${REST}/lifeos_views?tabela=eq.${tabela}&select=ordem&order=ordem.desc&limit=1`, { headers });
  if (!r.ok) throw new Error(`select views_max_ordem -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.length ? Number(rows[0].ordem) + 1 : 0;
}

async function handleQuery(REST: string, headers: Record<string, string>, tabelaRaw: string) {
  const tabela = validTabela(tabelaRaw);
  if (!tabela) return json({ ok: false, error: "invalid_tabela" }, 400);
  const r = await fetch(`${REST}/lifeos_views?tabela=eq.${tabela}&order=ordem.asc,created_at.asc`, { headers });
  if (!r.ok) throw new Error(`select views -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return json({ ok: true, views: rows.map(normalizeRow) });
}

async function handleCreate(REST: string, headers: Record<string, string>, view: Record<string, any> | null) {
  if (!view) return json({ ok: false, error: "missing_view" }, 400);

  const tabela = validTabela(view.tabela);
  if (!tabela) return json({ ok: false, error: "invalid_tabela" }, 400);

  const nome = String(view.nome ?? "").trim();
  if (!nome) return json({ ok: false, error: "invalid_nome" }, 400);

  const modo = view.modo === undefined ? "todas" : String(view.modo);
  if (!MODOS.includes(modo)) return json({ ok: false, error: "invalid_modo" }, 400);

  const regras = validRegras(view.regras, tabela);
  if (regras === null) return json({ ok: false, error: "invalid_regras" }, 400);

  const ordem = Number.isFinite(view.ordem) ? Number(view.ordem) : await nextOrdem(REST, headers, tabela);

  const r = await fetch(`${REST}/lifeos_views`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ tabela, nome, modo, regras, ordem }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, view: normalizeRow(rows[0]) });
}

async function handleUpdate(REST: string, headers: Record<string, string>, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  // A tabela da view (pra validar `regras` contra o conjunto certo de
  // campos) nunca muda depois de criada -- lida do banco, nao do patch.
  const existingRes = await fetch(`${REST}/lifeos_views?id=eq.${id}&select=tabela`, { headers });
  if (!existingRes.ok) return json({ ok: false, error: `db_error: ${existingRes.status} ${await existingRes.text()}` }, 502);
  const existingRows = await existingRes.json();
  if (!existingRows.length) return json({ ok: false, error: "not_found" }, 404);
  const tabela = existingRows[0].tabela as Tabela;

  const update: Record<string, any> = {};
  if ("nome" in patch) {
    const nome = String(patch.nome ?? "").trim();
    if (!nome) return json({ ok: false, error: "invalid_nome" }, 400);
    update.nome = nome;
  }
  if ("modo" in patch) {
    const modo = String(patch.modo ?? "");
    if (!MODOS.includes(modo)) return json({ ok: false, error: "invalid_modo" }, 400);
    update.modo = modo;
  }
  if ("regras" in patch) {
    const regras = validRegras(patch.regras, tabela);
    if (regras === null) return json({ ok: false, error: "invalid_regras" }, 400);
    update.regras = regras;
  }
  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);

  update.updated_at = new Date().toISOString();
  const r = await fetch(`${REST}/lifeos_views?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, view: normalizeRow(rows[0]) });
}

async function handleDelete(REST: string, headers: Record<string, string>, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${REST}/lifeos_views?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
