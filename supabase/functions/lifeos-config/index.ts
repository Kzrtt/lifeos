// lifeos-config - Supabase Edge Function
//
// Leitura e escrita de `admin_config` (pares chave/valor) atras do gate
// mestre. Hoje serve duas chaves -- `github_pat` (o PAT que
// lifeos/publicar.html usa pra escrever no repositorio) e `mcp_token` (o
// token do conector MCP, mostrado por lifeos/mcp.html) -- mas nasce
// generica porque o proximo passo do projeto (vocabularios configuraveis)
// mora na mesma tabela.
//
// POR QUE EXISTE
//   Antes disto, cadastrar o PAT exigia INSERT manual na tabela pelo painel
//   do Supabase. Era o ultimo atrito de configuracao que sobrava fora do
//   proprio LifeOS, e num projeto open-source e o primeiro que o usuario
//   novo encontra.
//
// O VALOR NUNCA VOLTA POR AQUI
//   `query` devolve so se a chave existe e uma versao mascarada. Quem
//   precisa do PAT cru e o publish, e ele continua usando a RPC
//   `get_admin_config` (que exige is_master). Esta function e pra
//   GERENCIAR o segredo, nao pra distribui-lo -- uma tela de configuracao
//   nao tem motivo pra receber o token inteiro de volta.
//
// Acoes: "query" (default), "set", "delete", "mcp_url".
//
// SEGURANCA (mesma postura das outras lifeos-*):
//  - verify_jwt = false: autenticacao via senha mestre no corpo, checada
//    contra access_tokens.is_master pela RPC check_master_token.
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

// Lista branca. Sem ela, esta function viraria um armazenamento de
// chave/valor arbitrario acessivel a quem tem a senha mestre -- e
// `admin_config` e lida por codigo que confia no formato do que esta la.
const CHAVES_VALIDAS = ["github_pat", "mcp_token"];

// `mcp_url` devolve o token do MCP CRU dentro da URL do conector -- unica
// excecao ao "o valor nunca volta por aqui". E deliberada: a URL so serve
// sendo colada inteira no cliente MCP, entao mascara-la tornaria a tela
// inutil. Continua atras do gate mestre, e e o mesmo grau de exposicao que
// o publish ja tem com o PAT.

// Formatos de PAT do GitHub: classico (ghp_) e fine-grained
// (github_pat_). Checagem de forma, nao de validade -- quem diz se o
// token funciona e a API do GitHub, no primeiro publish.
const PREFIXOS_PAT = ["ghp_", "github_pat_"];

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
    let token = "", action = "query", key = "", value = "";
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      key = (body?.key ?? "").toString().trim();
      value = (body?.value ?? "").toString().trim();
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const ctx = { REST, headers: restHeaders };

    if (action === "set") return await handleSet(ctx, key, value);
    if (action === "delete") return await handleDelete(ctx, key);
    if (action === "mcp_url") return await handleMcpUrl(ctx, SUPABASE_URL);
    return await handleQuery(ctx);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

type Ctx = { REST: string; headers: Record<string, string> };

// Mostra pontas o bastante pra reconhecer QUAL token esta cadastrado, sem
// entregar o suficiente pra usar. Mesma postura de lifeos-senhas.
function mascarar(v: string): string {
  if (!v) return "";
  if (v.length <= 12) return v.slice(0, 2) + "…";
  return v.slice(0, 7) + "…" + v.slice(-4);
}

async function handleQuery(ctx: Ctx) {
  const r = await fetch(`${ctx.REST}/admin_config?select=key,value,updated_at`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select admin_config -> ${r.status} ${await r.text()}`);
  const rows: { key: string; value: string; updated_at: string | null }[] = await r.json();

  // So as chaves da lista branca saem daqui, e nenhuma com o valor cru.
  const config: Record<string, any> = {};
  for (const chave of CHAVES_VALIDAS) {
    const linha = rows.find((x) => x.key === chave);
    config[chave] = {
      definido: !!(linha && linha.value),
      mascarado: linha ? mascarar(linha.value) : "",
      atualizado_em: linha ? linha.updated_at : null,
    };
  }
  return json({ ok: true, config });
}

async function handleSet(ctx: Ctx, key: string, value: string) {
  if (!CHAVES_VALIDAS.includes(key)) return json({ ok: false, error: "invalid_key" }, 400);
  if (!value) return json({ ok: false, error: "empty_value" }, 400);

  if (key === "github_pat" && !PREFIXOS_PAT.some((p) => value.startsWith(p))) {
    // Recusa cedo em vez de deixar o erro aparecer so no primeiro publish,
    // como um 401 cru da API do GitHub.
    return json({ ok: false, error: "invalid_pat_format" }, 400);
  }

  // upsert: `Prefer: resolution=merge-duplicates` depende da PK ser `key`,
  // que e o caso em admin_config.
  const r = await fetch(`${ctx.REST}/admin_config`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  const linha = rows[0];

  return json({
    ok: true,
    key,
    mascarado: mascarar(linha ? linha.value : value),
    atualizado_em: linha ? linha.updated_at : null,
  });
}

// Monta a URL que o usuario cola no cliente MCP (claude.ai > Connectors).
// O token vai no PATH porque um conector pessoal nao tem campo de header
// estatico -- ver AUTH.md §4 e o cabecalho de lifeos-mcp/index.ts.
async function handleMcpUrl(ctx: Ctx, supabaseUrl: string) {
  const r = await fetch(`${ctx.REST}/admin_config?key=eq.mcp_token&select=value`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select admin_config -> ${r.status} ${await r.text()}`);
  const rows: { value: string }[] = await r.json();
  const token = rows.length ? rows[0].value : "";

  if (!token) return json({ ok: true, definido: false, url: "", base: `${supabaseUrl}/functions/v1/lifeos-mcp` });

  return json({
    ok: true,
    definido: true,
    url: `${supabaseUrl}/functions/v1/lifeos-mcp/${token}`,
    base: `${supabaseUrl}/functions/v1/lifeos-mcp`,
  });
}

async function handleDelete(ctx: Ctx, key: string) {
  if (!CHAVES_VALIDAS.includes(key)) return json({ ok: false, error: "invalid_key" }, 400);

  const r = await fetch(`${ctx.REST}/admin_config?key=eq.${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, key });
}
