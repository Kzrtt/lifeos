// lifeos-citacoes - Supabase Edge Function
//
// Backend das Citações do hub LifeOS (lifeos.html -- ver
// LIFEOS.md §3.6). Uma citação é só `texto` + `autor`; o hub sorteia uma a
// cada abertura e mostra no banner acima do calendário. O sorteio é do
// front -- aqui só existe o CRUD.
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

// Limites generosos -- uma citação cabe folgada, um texto colado por engano
// (um artigo inteiro) não.
const MAX_TEXTO = 2000;
const MAX_AUTOR = 200;

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
    let token = "", action = "query", id = "";
    let citacao: Record<string, any> | null = null;
    let patch: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      citacao = (body?.citacao && typeof body.citacao === "object") ? body.citacao : null;
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(REST, restHeaders, citacao);
    if (action === "update") return await handleUpdate(REST, restHeaders, id, patch);
    if (action === "delete") return await handleDelete(REST, restHeaders, id);

    return await handleQuery(REST, restHeaders);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function normalizeRow(r: any) {
  return { id: r.id, texto: r.texto, autor: r.autor, created_at: r.created_at };
}

// Devolve a string limpa, ou null se vazia/grande demais.
function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > max) return null;
  return s;
}

async function handleQuery(REST: string, headers: Record<string, string>) {
  const r = await fetch(`${REST}/lifeos_citacoes?order=created_at.asc`, { headers });
  if (!r.ok) throw new Error(`select citacoes -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return json({ ok: true, citacoes: rows.map(normalizeRow) });
}

async function handleCreate(REST: string, headers: Record<string, string>, citacao: Record<string, any> | null) {
  if (!citacao) return json({ ok: false, error: "missing_citacao" }, 400);

  const texto = cleanText(citacao.texto, MAX_TEXTO);
  if (!texto) return json({ ok: false, error: "invalid_texto" }, 400);
  const autor = cleanText(citacao.autor, MAX_AUTOR);
  if (!autor) return json({ ok: false, error: "invalid_autor" }, 400);

  const r = await fetch(`${REST}/lifeos_citacoes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ texto, autor }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, citacao: normalizeRow(rows[0]) });
}

async function handleUpdate(REST: string, headers: Record<string, string>, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const update: Record<string, any> = {};
  if ("texto" in patch) {
    const texto = cleanText(patch.texto, MAX_TEXTO);
    if (!texto) return json({ ok: false, error: "invalid_texto" }, 400);
    update.texto = texto;
  }
  if ("autor" in patch) {
    const autor = cleanText(patch.autor, MAX_AUTOR);
    if (!autor) return json({ ok: false, error: "invalid_autor" }, 400);
    update.autor = autor;
  }
  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_citacoes?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, citacao: normalizeRow(rows[0]) });
}

async function handleDelete(REST: string, headers: Record<string, string>, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${REST}/lifeos_citacoes?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
