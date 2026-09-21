// lifeos-projetos - Supabase Edge Function
//
// Backend do modulo Tarefas do hub LifeOS (LifeOS, tarefas.html --
// ver LIFEOS.md). Projetos e a entidade-mae: toda tarefa e obrigatoriamente
// vinculada a um projeto (lifeos_tarefas.projeto_id not null); eventos tem
// um vinculo opcional (lifeos_eventos.projeto_id nullable).
//
// Acoes: "query" (default, lista todos), "create", "update", "delete".
//
// SEGURANCA (mesma postura de sempre):
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

// Vocabulario valido (ver LIFEOS.md) -- mesmo texto exato usado no Notion.
const STATUS_VALIDOS = ["Não Iniciado", "Em Progresso", "Feito", "Pausado"];
const TAGS_VALIDAS = ["Pessoal", "Profissional", "Acadêmico", "Configuração"];

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
    let token = "", action = "query", id = "";
    let projeto: Record<string, any> | null = null;
    let patch: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      projeto = (body?.projeto && typeof body.projeto === "object") ? body.projeto : null;
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(REST, restHeaders, projeto);
    if (action === "update") return await handleUpdate(REST, restHeaders, id, patch);
    if (action === "delete") return await handleDelete(REST, restHeaders, id);

    return await handleQuery(REST, restHeaders);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function normalizeRow(r: any) {
  return { id: r.id, name: r.name, emoji: r.emoji, status: r.status, tags: r.tags ?? [] };
}

function validTags(tags: unknown): string[] | null {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const s = String(t);
    if (!vocab("projeto_tag", TAGS_VALIDAS).includes(s)) return null;
    out.push(s);
  }
  return out;
}

async function handleQuery(REST: string, headers: Record<string, string>) {
  const r = await fetch(`${REST}/lifeos_projetos?order=name.asc`, { headers });
  if (!r.ok) throw new Error(`select projetos -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return json({ ok: true, projetos: rows.map(normalizeRow) });
}

async function handleCreate(REST: string, headers: Record<string, string>, projeto: Record<string, any> | null) {
  if (!projeto) return json({ ok: false, error: "missing_projeto" }, 400);

  const name = String(projeto.name ?? "").trim();
  if (!name) return json({ ok: false, error: "invalid_name" }, 400);

  const status = String(projeto.status ?? "");
  if (!vocab("projeto_status", STATUS_VALIDOS).includes(status)) return json({ ok: false, error: "invalid_status" }, 400);

  const emojiRaw = projeto.emoji;
  const emoji = (typeof emojiRaw === "string" && emojiRaw.trim()) ? emojiRaw.trim() : null;

  const tags = validTags(projeto.tags);
  if (tags === null) return json({ ok: false, error: "invalid_tags" }, 400);

  const r = await fetch(`${REST}/lifeos_projetos`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, emoji, status, tags }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, projeto: normalizeRow(rows[0]) });
}

async function handleUpdate(REST: string, headers: Record<string, string>, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const update: Record<string, any> = {};
  if ("name" in patch) {
    const name = String(patch.name ?? "").trim();
    if (!name) return json({ ok: false, error: "invalid_name" }, 400);
    update.name = name;
  }
  if ("emoji" in patch) {
    const emojiRaw = patch.emoji;
    update.emoji = (typeof emojiRaw === "string" && emojiRaw.trim()) ? emojiRaw.trim() : null;
  }
  if ("status" in patch) {
    const status = String(patch.status ?? "");
    if (!vocab("projeto_status", STATUS_VALIDOS).includes(status)) return json({ ok: false, error: "invalid_status" }, 400);
    update.status = status;
  }
  if ("tags" in patch) {
    const tags = validTags(patch.tags);
    if (tags === null) return json({ ok: false, error: "invalid_tags" }, 400);
    update.tags = tags;
  }
  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);
  update.updated_at = new Date().toISOString();

  const r = await fetch(`${REST}/lifeos_projetos?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, projeto: normalizeRow(rows[0]) });
}

async function handleDelete(REST: string, headers: Record<string, string>, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${REST}/lifeos_projetos?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!r.ok) {
    const detail = await r.text();
    // FK restrict de lifeos_tarefas.projeto_id -> mensagem clara pro front
    if (r.status === 409 || /foreign key/i.test(detail)) {
      return json({ ok: false, error: "has_tarefas" }, 409);
    }
    return json({ ok: false, error: `db_error: ${r.status} ${detail}` }, 502);
  }
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
