// lifeos-notas - Supabase Edge Function
//
// Backend do modulo Notas do hub LifeOS (LifeOS, notas.html --
// ver LIFEOS.md e NOTAS.md). Migrado do Notion em set/2026 (105 notas).
// Diferente de Tarefas (projeto_id NOT NULL, 1:N), o vinculo a Projeto aqui
// e N:N de fato -- uma nota pode ter 0, 1 ou varios projetos (a base real
// migrada tem casos com 2 e 3 projetos, e 1 nota sem projeto nenhum) --
// por isso existe a tabela de juncao lifeos_notas_projetos em vez de uma
// coluna projeto_id.
//
// Acoes: "query" (default, sem filtro -- so ~100 linhas, o cliente filtra
// por projeto/tipo/busca), "create", "update" (patch parcial), "delete".
//
// SEGURANCA: mesma postura de lifeos-tarefas/lifeos-projetos.

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

// Vocabulario valido (ver NOTAS.md) -- os 12 valores reais da base Notion.
const TIPOS_VALIDOS = [
  "Lembranças", "Análise de Leitura", "Pensamentos", "Conclusões", "Úteis",
  "Faculdade", "Vida", "Pesquisa", "Programação", "Pessoal", "Relato", "Documentação",
];

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
    let nota: Record<string, any> | null = null;
    let patch: Record<string, any> | null = null;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "query").toString().trim() || "query";
      id = (body?.id ?? "").toString().trim();
      nota = (body?.nota && typeof body.nota === "object") ? body.nota : null;
      patch = (body?.patch && typeof body.patch === "object") ? body.patch : null;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(REST, restHeaders, nota);
    if (action === "update") return await handleUpdate(REST, restHeaders, id, patch);
    if (action === "delete") return await handleDelete(REST, restHeaders, id);

    return await handleQuery(REST, restHeaders);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function validTipo(tipo: unknown): string[] | null {
  if (!Array.isArray(tipo)) return [];
  const out: string[] = [];
  for (const t of tipo) {
    const s = String(t);
    if (!vocab("nota_tipo", TIPOS_VALIDOS).includes(s)) return null;
    out.push(s);
  }
  return out;
}

function validData(v: unknown): string | null {
  return (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
}

function validProjetoIds(v: unknown): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const p of v) {
    const s = String(p ?? "").trim();
    if (!s) return null;
    out.push(s);
  }
  return out;
}

async function fetchProjetoIdsByNota(REST: string, headers: Record<string, string>, notaIds: string[]) {
  const map: Record<string, string[]> = {};
  if (!notaIds.length) return map;
  const idsFilter = notaIds.join(",");
  const r = await fetch(`${REST}/lifeos_notas_projetos?nota_id=in.(${idsFilter})`, { headers });
  if (!r.ok) throw new Error(`select notas_projetos -> ${r.status} ${await r.text()}`);
  const rows: { nota_id: string; projeto_id: string }[] = await r.json();
  for (const row of rows) {
    if (!map[row.nota_id]) map[row.nota_id] = [];
    map[row.nota_id].push(row.projeto_id);
  }
  return map;
}

async function setProjetoLinks(REST: string, headers: Record<string, string>, notaId: string, projetoIds: string[]) {
  const del = await fetch(`${REST}/lifeos_notas_projetos?nota_id=eq.${notaId}`, {
    method: "DELETE",
    headers,
  });
  if (!del.ok) throw new Error(`delete notas_projetos -> ${del.status} ${await del.text()}`);
  if (!projetoIds.length) return;
  const rows = projetoIds.map((projeto_id) => ({ nota_id: notaId, projeto_id }));
  const ins = await fetch(`${REST}/lifeos_notas_projetos`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error(`insert notas_projetos -> ${ins.status} ${await ins.text()}`);
}

async function handleQuery(REST: string, headers: Record<string, string>) {
  const r = await fetch(`${REST}/lifeos_notas?order=data.desc.nullslast,created_at.desc`, { headers });
  if (!r.ok) throw new Error(`select notas -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  const projetoMap = await fetchProjetoIdsByNota(REST, headers, rows.map((row: any) => row.id));
  const notas = rows.map((row: any) => ({
    id: row.id, name: row.name, tipo: row.tipo ?? [], data: row.data,
    conteudo_md: row.conteudo_md, projeto_ids: projetoMap[row.id] ?? [],
    created_at: row.created_at, updated_at: row.updated_at,
  }));
  return json({ ok: true, notas });
}

async function handleCreate(REST: string, headers: Record<string, string>, nota: Record<string, any> | null) {
  if (!nota) return json({ ok: false, error: "missing_nota" }, 400);

  const name = String(nota.name ?? "").trim();
  if (!name) return json({ ok: false, error: "invalid_name" }, 400);

  const tipo = validTipo(nota.tipo);
  if (tipo === null) return json({ ok: false, error: "invalid_tipo" }, 400);

  const data = nota.data === undefined || nota.data === null ? null : validData(nota.data);
  if (nota.data !== undefined && nota.data !== null && data === null) {
    return json({ ok: false, error: "invalid_data" }, 400);
  }

  const conteudo_md = nota.conteudo_md === undefined || nota.conteudo_md === null
    ? null
    : String(nota.conteudo_md);

  const projeto_ids = validProjetoIds(nota.projeto_ids);
  if (projeto_ids === null) return json({ ok: false, error: "invalid_projeto_ids" }, 400);

  const r = await fetch(`${REST}/lifeos_notas`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, tipo, data, conteudo_md }),
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  const created = rows[0];

  try {
    await setProjetoLinks(REST, headers, created.id, projeto_ids);
  } catch (e) {
    return json({ ok: false, error: `db_error_links: ${String(e)}` }, 502);
  }

  return json({
    ok: true,
    nota: {
      id: created.id, name: created.name, tipo: created.tipo ?? [], data: created.data,
      conteudo_md: created.conteudo_md, projeto_ids,
      created_at: created.created_at, updated_at: created.updated_at,
    },
  });
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
  if ("tipo" in patch) {
    const tipo = validTipo(patch.tipo);
    if (tipo === null) return json({ ok: false, error: "invalid_tipo" }, 400);
    update.tipo = tipo;
  }
  if ("data" in patch) {
    update.data = patch.data === null ? null : validData(patch.data);
    if (patch.data !== null && update.data === null) return json({ ok: false, error: "invalid_data" }, 400);
  }
  if ("conteudo_md" in patch) {
    update.conteudo_md = patch.conteudo_md === null || patch.conteudo_md === undefined
      ? null
      : String(patch.conteudo_md);
  }

  let projeto_ids: string[] | null = null;
  if ("projeto_ids" in patch) {
    projeto_ids = validProjetoIds(patch.projeto_ids);
    if (projeto_ids === null) return json({ ok: false, error: "invalid_projeto_ids" }, 400);
  }

  if (!Object.keys(update).length && projeto_ids === null) return json({ ok: false, error: "empty_patch" }, 400);

  let row: any;
  if (Object.keys(update).length) {
    update.updated_at = new Date().toISOString();
    const r = await fetch(`${REST}/lifeos_notas?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(update),
    });
    if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
    const rows = await r.json();
    if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
    row = rows[0];
  } else {
    const r = await fetch(`${REST}/lifeos_notas?id=eq.${id}`, { headers });
    if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
    const rows = await r.json();
    if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
    row = rows[0];
  }

  let finalProjetoIds: string[];
  if (projeto_ids !== null) {
    try {
      await setProjetoLinks(REST, headers, id, projeto_ids);
    } catch (e) {
      return json({ ok: false, error: `db_error_links: ${String(e)}` }, 502);
    }
    finalProjetoIds = projeto_ids;
  } else {
    const map = await fetchProjetoIdsByNota(REST, headers, [id]);
    finalProjetoIds = map[id] ?? [];
  }

  return json({
    ok: true,
    nota: {
      id: row.id, name: row.name, tipo: row.tipo ?? [], data: row.data,
      conteudo_md: row.conteudo_md, projeto_ids: finalProjetoIds,
      created_at: row.created_at, updated_at: row.updated_at,
    },
  });
}

async function handleDelete(REST: string, headers: Record<string, string>, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const r = await fetch(`${REST}/lifeos_notas?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}
