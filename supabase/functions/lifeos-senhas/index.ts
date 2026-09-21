// lifeos-senhas - Supabase Edge Function
//
// Backend da tela de Senhas do LifeOS (lifeos/senhas.html). CRUD das senhas de
// acesso (`access_tokens`) e do escopo por pagina (`token_pages`) -- o que antes
// so dava pra fazer por SQL no painel do Supabase, ou parcialmente pelo
// admin/index.html.
//
// POR QUE UMA EDGE FUNCTION E NAO RPCs NOVAS
//   O admin antigo falava DIRETO com RPCs SECURITY DEFINER expostas ao `anon`
//   (list_access_tokens, grant_token_page, ...). Foi exatamente esse desenho
//   que causou o vazamento do github_pat registrado no AUTH.md: a RPC
//   get_admin_config nao checava is_master, e qualquer token de pagina --
//   alguns com 3 a 6 caracteres -- chamava ela direto via POST /rest/v1/rpc.
//   Dar superficie de ESCRITA na tabela de autenticacao ao `anon` repetiria o
//   mesmo erro num alvo pior. Aqui a tabela so e alcancada pela service role,
//   de dentro da funcao, depois do gate mestre.
//
// Acoes: "query" (default), "create", "update", "delete", "grant", "revoke".
//
// SEGURANCA (mesma postura das outras lifeos-*):
//  - verify_jwt = false: autenticacao via senha mestre no corpo, checada
//    contra access_tokens.is_master pela RPC check_master_token (service role).
//  - Escritas usam a service role, nunca exposta ao browser.
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

// Abaixo disto a senha entra, mas com aviso. O AUTH.md registra que os tokens
// de pagina existentes tinham 3-6 caracteres -- entropia baixa o bastante pra
// forca-bruta direto na RPC, que nao tem rate-limit visivel. Aviso e nao
// bloqueio porque a senha mestre em uso hoje pode ser curta, e recusar a
// propria senha do dono no meio de uma edicao seria pior que avisar.
const MIN_TOKEN_LEN = 12;

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
    let token = "", action = "query", id = "", pageSlug = "";
    let senha: Record<string, any> | null = null;
    let patch: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      pageSlug = (body?.page_slug ?? "").toString().trim();
      senha = (body?.senha && typeof body.senha === "object") ? body.senha : null;
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const ctx = { REST, headers: restHeaders, callerToken: token };

    if (action === "create") return await handleCreate(ctx, senha);
    if (action === "update") return await handleUpdate(ctx, id, patch);
    if (action === "delete") return await handleDelete(ctx, id);
    if (action === "grant") return await handleGrant(ctx, id, pageSlug);
    if (action === "revoke") return await handleRevoke(ctx, id);

    return await handleQuery(ctx);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

type Ctx = { REST: string; headers: Record<string, string>; callerToken: string };

// Valor de filtro do PostgREST. Uma senha e uma string ARBITRARIA, e virgula,
// parenteses, ponto e aspas tem significado sintatico num `?col=eq.<valor>`:
// sem aspas, uma senha com virgula viraria outra consulta e a checagem de
// duplicata falharia em silencio (deixando cadastrar duas senhas iguais).
// PostgREST aceita o valor entre aspas duplas; dentro delas so `"` e `\`
// precisam de escape.
function eqValue(v: string): string {
  return encodeURIComponent(`"${v.replace(/(["\\])/g, "\\$1")}"`);
}

type TokenRow = { id: number; token: string; is_master: boolean; label: string | null };
type PageRow = { id: number; token_id: number; page_slug: string };

// ── Helpers de leitura ──────────────────────────────────────────────────

async function fetchTokens(ctx: Ctx): Promise<TokenRow[]> {
  const r = await fetch(`${ctx.REST}/access_tokens?order=is_master.desc,id.asc`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select access_tokens -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchPages(ctx: Ctx): Promise<PageRow[]> {
  const r = await fetch(`${ctx.REST}/token_pages?order=page_slug.asc`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select token_pages -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchTokenById(ctx: Ctx, id: string): Promise<TokenRow | null> {
  const r = await fetch(`${ctx.REST}/access_tokens?id=eq.${encodeURIComponent(id)}`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select access_tokens -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

async function countMasters(ctx: Ctx): Promise<number> {
  const r = await fetch(`${ctx.REST}/access_tokens?is_master=eq.true&select=id`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`count masters -> ${r.status} ${await r.text()}`);
  return (await r.json()).length;
}

async function tokenExists(ctx: Ctx, value: string, exceptId?: string): Promise<boolean> {
  let url = `${ctx.REST}/access_tokens?token=eq.${eqValue(value)}&select=id`;
  if (exceptId) url += `&id=neq.${encodeURIComponent(exceptId)}`;
  const r = await fetch(url, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select access_tokens -> ${r.status} ${await r.text()}`);
  return (await r.json()).length > 0;
}

// O token nunca vai inteiro pro browser: a tela precisa identificar a senha,
// nao reve-la. Quem esqueceu a senha troca por uma nova -- e o mesmo motivo
// pelo qual nao ha acao de "revelar".
function maskToken(t: string): string {
  if (!t) return "?";
  if (t.length <= 4) return "•".repeat(t.length);
  if (t.length <= 10) return t.slice(0, 2) + "•".repeat(t.length - 2);
  return t.slice(0, 4) + "…" + t.slice(-4);
}

function normalizeRow(r: TokenRow, pages: PageRow[]) {
  return {
    id: r.id,
    label: r.label,
    is_master: r.is_master,
    token_masked: maskToken(r.token),
    token_len: r.token.length,
    curta: r.token.length < MIN_TOKEN_LEN,
    paginas: pages
      .filter((p) => p.token_id === r.id)
      .map((p) => ({ id: p.id, page_slug: p.page_slug })),
  };
}

// ── query ───────────────────────────────────────────────────────────────

async function handleQuery(ctx: Ctx) {
  const [tokens, pages] = await Promise.all([fetchTokens(ctx), fetchPages(ctx)]);
  return json({
    ok: true,
    senhas: tokens.map((t) => normalizeRow(t, pages)),
    min_token_len: MIN_TOKEN_LEN,
  });
}

// ── create ──────────────────────────────────────────────────────────────

async function handleCreate(ctx: Ctx, senha: Record<string, any> | null) {
  if (!senha) return json({ ok: false, error: "missing_senha" }, 400);

  const value = String(senha.token ?? "").trim();
  if (!value) return json({ ok: false, error: "invalid_token" }, 400);
  if (await tokenExists(ctx, value)) return json({ ok: false, error: "duplicate_token" }, 409);

  const label = String(senha.label ?? "").trim() || null;
  const isMaster = senha.is_master === true;

  const r = await fetch(`${ctx.REST}/access_tokens`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ token: value, label, is_master: isMaster }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();

  return json({
    ok: true,
    senha: normalizeRow(rows[0], []),
    warning: value.length < MIN_TOKEN_LEN ? "token_curto" : undefined,
  });
}

// ── update ──────────────────────────────────────────────────────────────

async function handleUpdate(ctx: Ctx, id: string, patch: Record<string, any> | null) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!patch || !Object.keys(patch).length) return json({ ok: false, error: "empty_patch" }, 400);

  const atual = await fetchTokenById(ctx, id);
  if (!atual) return json({ ok: false, error: "not_found" }, 404);

  const update: Record<string, any> = {};
  let warning: string | undefined;

  if ("token" in patch) {
    const value = String(patch.token ?? "").trim();
    if (!value) return json({ ok: false, error: "invalid_token" }, 400);
    if (await tokenExists(ctx, value, id)) return json({ ok: false, error: "duplicate_token" }, 409);
    if (value.length < MIN_TOKEN_LEN) warning = "token_curto";
    update.token = value;
  }

  if ("label" in patch) update.label = String(patch.label ?? "").trim() || null;

  if ("is_master" in patch) {
    const novo = patch.is_master === true;
    // Rebaixar a ultima senha mestre deixaria o sistema inacessivel: o gate do
    // LifeOS so aceita is_master, e nao ha outro caminho pra promover alguem.
    if (atual.is_master && !novo && (await countMasters(ctx)) <= 1) {
      return json({ ok: false, error: "last_master" }, 409);
    }
    update.is_master = novo;
  }

  if (!Object.keys(update).length) return json({ ok: false, error: "empty_patch" }, 400);

  const r = await fetch(`${ctx.REST}/access_tokens?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);

  const pages = await fetchPages(ctx);
  return json({
    ok: true,
    senha: normalizeRow(rows[0], pages),
    // A sessao do browser guarda o valor antigo; a tela precisa saber que
    // tem de re-autenticar quando a senha alterada foi a do proprio caller.
    reauth: atual.token === ctx.callerToken && "token" in update,
    warning,
  });
}

// ── delete ──────────────────────────────────────────────────────────────

async function handleDelete(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);

  const atual = await fetchTokenById(ctx, id);
  if (!atual) return json({ ok: false, error: "not_found" }, 404);

  // Apagar a senha da requisicao atual derrubaria a propria sessao no meio do
  // caminho -- e se fosse a ultima mestre, trancaria o sistema pra sempre.
  if (atual.token === ctx.callerToken) return json({ ok: false, error: "self_delete" }, 409);
  if (atual.is_master && (await countMasters(ctx)) <= 1) {
    return json({ ok: false, error: "last_master" }, 409);
  }

  // Escopos primeiro: token_pages.token_id nao tem cascade garantido no schema.
  const rp = await fetch(`${ctx.REST}/token_pages?token_id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: ctx.headers,
  });
  if (!rp.ok) return json({ ok: false, error: `db_error: ${rp.status} ${await rp.text()}` }, 502);

  const r = await fetch(`${ctx.REST}/access_tokens?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);

  return json({ ok: true, id });
}

// ── grant / revoke (escopo por pagina) ──────────────────────────────────

async function handleGrant(ctx: Ctx, id: string, pageSlug: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (!pageSlug) return json({ ok: false, error: "missing_page_slug" }, 400);

  const atual = await fetchTokenById(ctx, id);
  if (!atual) return json({ ok: false, error: "not_found" }, 404);
  // Mestre ja passa em check_page_access por qualquer pagina -- um escopo
  // explicito aqui nao muda nada e so polui a lista.
  if (atual.is_master) return json({ ok: false, error: "master_no_scope" }, 409);

  const existing = await fetch(
    `${ctx.REST}/token_pages?token_id=eq.${encodeURIComponent(id)}&page_slug=eq.${eqValue(pageSlug)}&select=id`,
    { headers: ctx.headers },
  );
  if (!existing.ok) throw new Error(`select token_pages -> ${existing.status} ${await existing.text()}`);
  if ((await existing.json()).length) return json({ ok: false, error: "duplicate_grant" }, 409);

  const r = await fetch(`${ctx.REST}/token_pages`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ token_id: Number(id), page_slug: pageSlug }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, grant: { id: rows[0].id, page_slug: rows[0].page_slug } });
}

// `id` aqui e o id da LINHA de token_pages, nao o da senha.
async function handleRevoke(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${ctx.REST}/token_pages?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
