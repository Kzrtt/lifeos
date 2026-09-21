// lifeos-manifestacoes - Supabase Edge Function
//
// Backend do modulo Manifestacoes do hub LifeOS (LifeOS,
// lifeos.html -- ver LIFEOS.md). Migrado do Notion em set/2026 (ver
// notion-manifestacoes-migrate, dormente apos a migracao unica).
//
// Acoes: "query" (default, leitura) e "create" (cadastro direto pelo hub,
// adicionado a pedido do autor -- ver LIFEOS.md). Sem update/delete ainda
// (nao adiantar escopo alem do pedido).
//
// Banner no create e OPCIONAL e vem como base64 (banner_base64 +
// banner_content_type) -- o client le o arquivo local via FileReader,
// nao ha upload direto do browser pro Storage (mesma postura de
// seguranca do resto do LifeOS: toda escrita passa pela senha mestre
// aqui, nunca client-side direto com a anon key). Fluxo: insere a linha
// primeiro (pra ter o id), depois -- se veio banner -- sobe o arquivo pro
// bucket 'manifestacoes' usando o id da linha como nome, e faz um PATCH
// setando banner_url. Se o upload falhar, a linha fica criada mesmo assim
// (sem banner) -- create nunca falha por causa da imagem.
//
// SEGURANCA: mesma postura de lifeos-projetos/lifeos-tarefas.

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

const BUCKET = "manifestacoes";
const STATUS_VALIDOS = ["Não Iniciado", "Em Progresso", "Feito"];
const TAGS_VALIDAS = ["Vida", "Financeiro", "Carreira", "Saúde", "Lazer"];

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

// 6MB de base64 texto ~= 4.5MB de arquivo original -- generoso o bastante
// pra foto de celular sem comprimir, mas barra upload de vídeo/arquivo
// gigante por engano.
const MAX_BASE64_LEN = 6 * 1024 * 1024;

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
    let token = "", action = "query";
    let manifestacao: Record<string, any> | null = null;
    let bannerBase64 = "", bannerContentType = "";
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      manifestacao = (body?.manifestacao && typeof body.manifestacao === "object") ? body.manifestacao : null;
      bannerBase64 = (body?.banner_base64 ?? "").toString();
      bannerContentType = (body?.banner_content_type ?? "").toString();
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(SUPABASE_URL, REST, restHeaders, SERVICE_KEY, manifestacao, bannerBase64, bannerContentType);

    const r = await fetch(`${REST}/lifeos_manifestacoes?order=created_at.asc`, { headers: restHeaders });
    if (!r.ok) throw new Error(`select manifestacoes -> ${r.status} ${await r.text()}`);
    const rows = await r.json();
    const manifestacoes = rows.map(normalizeRow);
    return json({ ok: true, manifestacoes });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function normalizeRow(r: any) {
  return {
    id: r.id, name: r.name, status: r.status, tags: r.tags ?? [],
    banner_url: r.banner_url, descricao: r.descricao,
  };
}

function validTags(tags: unknown): string[] | null {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const s = String(t);
    if (!vocab("manifestacao_tag", TAGS_VALIDAS).includes(s)) return null;
    out.push(s);
  }
  return out;
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

async function handleCreate(
  SUPABASE_URL: string, REST: string, headers: Record<string, string>, SERVICE_KEY: string,
  manifestacao: Record<string, any> | null, bannerBase64: string, bannerContentType: string,
) {
  if (!manifestacao) return json({ ok: false, error: "missing_manifestacao" }, 400);

  const name = String(manifestacao.name ?? "").trim();
  if (!name) return json({ ok: false, error: "invalid_name" }, 400);

  const status = String(manifestacao.status ?? "");
  if (!vocab("manifestacao_status", STATUS_VALIDOS).includes(status)) return json({ ok: false, error: "invalid_status" }, 400);

  const tags = validTags(manifestacao.tags);
  if (tags === null) return json({ ok: false, error: "invalid_tags" }, 400);

  if (bannerBase64 && bannerBase64.length > MAX_BASE64_LEN) {
    return json({ ok: false, error: "banner_too_large" }, 400);
  }

  const insR = await fetch(`${REST}/lifeos_manifestacoes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, status, tags }),
  });
  if (!insR.ok) return json({ ok: false, error: `db_error: ${insR.status} ${await insR.text()}` }, 502);
  const inserted = (await insR.json())[0];

  if (!bannerBase64) return json({ ok: true, manifestacao: normalizeRow(inserted) });

  // Upload do banner e best-effort -- se falhar, a manifestacao ja foi
  // criada (so sem banner); nunca desfaz o create por causa da imagem.
  try {
    const bytes = Uint8Array.from(atob(bannerBase64), (c) => c.charCodeAt(0));
    const contentType = bannerContentType || "image/jpeg";
    const ext = extFromContentType(contentType);
    const path = `${inserted.id}.${ext}`;
    const upR = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": contentType, "x-upsert": "true" },
      body: bytes,
    });
    if (!upR.ok) throw new Error(`upload storage -> ${upR.status} ${await upR.text()}`);
    const bannerUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

    const patchR = await fetch(`${REST}/lifeos_manifestacoes?id=eq.${inserted.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ banner_url: bannerUrl, updated_at: new Date().toISOString() }),
    });
    if (!patchR.ok) throw new Error(`patch banner_url -> ${patchR.status} ${await patchR.text()}`);
    const patched = (await patchR.json())[0];
    return json({ ok: true, manifestacao: normalizeRow(patched) });
  } catch (_imgErr) {
    return json({ ok: true, manifestacao: normalizeRow(inserted), banner_error: true });
  }
}
