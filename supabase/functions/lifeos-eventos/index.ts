// lifeos-eventos - Supabase Edge Function
//
// Backend do modulo Eventos, nativo do hub LifeOS (LifeOS,
// lifeos.html -- ver LIFEOS.md). Mesmo padrao de gate/CORS de
// lifeos-movimentacoes.
//
// Acoes: "query" (default, por range de datas), "create", "delete". Sem
// "update" nesta primeira entrega -- a UI so cria/apaga eventos por ora.
//
// projeto_id (opcional): vinculo a um lifeos_projetos, diferente de
// lifeos_tarefas onde o vinculo e obrigatorio -- nem todo evento pertence
// a um projeto.
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

// Vocabulario valido de tipo (ver LIFEOS.md). Categorias fixas pedidas pelo
// o autor -- nao inventar novas sem atualizar aqui e no <select> do front.
const TIPOS_VALIDOS = ["faculdade", "psicodelia", "trabalho", "lazer", "vida"];

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
    let token = "", action = "query", id = "", from = "", to = "";
    let evento: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      from = (body?.from ?? "").toString().trim();
      to = (body?.to ?? "").toString().trim();
      evento = (body?.evento && typeof body.evento === "object") ? body.evento : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(REST, restHeaders, evento);
    if (action === "delete") return await handleDelete(REST, restHeaders, id);

    // query (default)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return json({ ok: false, error: "invalid_range" }, 400);
    }
    return await handleQuery(REST, restHeaders, from, to);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function normalizeRow(r: any) {
  return { id: r.id, name: r.name, date: r.date, date_fim: r.date_fim ?? null, tipo: r.tipo, projeto_id: r.projeto_id ?? null };
}

// Range de datas é por SOBREPOSIÇÃO, não só "date dentro de [from,to]" --
// um evento de vários dias que começou ANTES de `from` mas ainda está em
// curso dentro da janela precisa aparecer mesmo assim (ex.: viagem de
// 28/set a 03/out, janela do calendário começando em 01/out). Condição:
// date <= to E (date_fim >= from OU (date_fim é nulo E date >= from)).
async function handleQuery(REST: string, headers: Record<string, string>, from: string, to: string) {
  const filtro = `or=(date_fim.gte.${from},and(date_fim.is.null,date.gte.${from}))`;
  const r = await fetch(`${REST}/lifeos_eventos?date=lte.${to}&${filtro}&order=date.asc`, { headers });
  if (!r.ok) throw new Error(`select eventos -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return json({ ok: true, eventos: rows.map(normalizeRow) });
}

async function handleCreate(REST: string, headers: Record<string, string>, evento: Record<string, any> | null) {
  if (!evento) return json({ ok: false, error: "missing_evento" }, 400);

  const name = String(evento.name ?? "").trim();
  if (!name) return json({ ok: false, error: "invalid_name" }, 400);

  const date = String(evento.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "invalid_date" }, 400);

  // Opcional -- a maioria dos eventos é de um dia só. Quando presente,
  // precisa ser uma data válida e não pode vir antes de `date` (mesmo CHECK
  // do banco, validado aqui também pra devolver um erro claro em vez de
  // estourar 502 na constraint).
  const dateFimRaw = evento.date_fim;
  let date_fim: string | null = null;
  if (dateFimRaw !== undefined && dateFimRaw !== null && dateFimRaw !== "") {
    date_fim = String(dateFimRaw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date_fim)) return json({ ok: false, error: "invalid_date_fim" }, 400);
    if (date_fim < date) return json({ ok: false, error: "date_fim_antes_de_date" }, 400);
  }

  const tipo = String(evento.tipo ?? "");
  if (!vocab("evento_tipo", TIPOS_VALIDOS).includes(tipo)) return json({ ok: false, error: "invalid_tipo" }, 400);

  const projetoIdRaw = evento.projeto_id;
  const projeto_id = (typeof projetoIdRaw === "string" && projetoIdRaw.trim()) ? projetoIdRaw.trim() : null;

  const r = await fetch(`${REST}/lifeos_eventos`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, date, date_fim, tipo, projeto_id }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  return json({ ok: true, evento: normalizeRow(rows[0]) });
}

async function handleDelete(REST: string, headers: Record<string, string>, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${REST}/lifeos_eventos?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
