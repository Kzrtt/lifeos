// lifeos-vocabularios - Supabase Edge Function
//
// CRUD dos vocabularios do sistema -- as listas de tags e status que antes
// viviam chapadas em tres lugares ao mesmo tempo (uma constante no JS de
// cada pagina, outra copia em cada Edge Function, e um CHECK no banco).
//
// Desde a migration 0002 a fonte de verdade e a tabela
// `lifeos_vocabularios`, e os CHECK foram derrubados. A validacao nao
// sumiu: ela passou a ser feita AQUI e nas outras functions, contra a
// tabela -- que e' o unico lugar editavel (LifeOS > menu > Tags).
//
// Acoes: "query" (default), "create", "update", "delete", "reorder".
//
// DUAS COISAS QUE ESTA FUNCTION FAZ E QUE NAO SAO OBVIAS
//
//   1. RENOMEAR MIGRA OS DADOS. Trocar o nome de um valor sem atualizar as
//      linhas que ja o usam deixaria orfaos -- uma tarefa com status que
//      nao existe mais na lista. O rename delega pra RPC
//      `lifeos_renomear_vocabulario`, que faz as duas coisas numa
//      transacao (UPDATE nos dados + UPDATE no vocabulario) e devolve
//      quantas linhas de dado foram migradas.
//
//   2. APAGAR CHECA USO ANTES. Um valor em uso nao pode sumir da lista sem
//      deixar dados inconsistentes. A RPC `lifeos_uso_vocabulario` conta;
//      se houver uso, a acao e' recusada com a contagem, pra tela poder
//      dizer "12 tarefas usam isto".
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
// nenhuma.
//
// "*" nao afrouxa a seguranca deste desenho: a autenticacao e a senha
// mestre enviada NO CORPO da requisicao, nao um cookie. Nao ha credencial
// ambiente que o browser anexe sozinho, entao uma pagina maliciosa que
// chame esta function nao consegue nada sem ja saber a senha -- e se
// souber, o CORS nao a impediria de qualquer forma (curl ignora CORS).
// A fronteira real e check_master_token, server-side.
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// Os dominios validos. Lista fechada de proposito: sao os pontos onde o
// sistema de fato le um vocabulario. Um dominio novo exige codigo novo (a
// tela que o usa, e os ramos das RPCs de rename/uso), entao deixar isso
// aberto so criaria listas que nada consome.
//
// `coluna_array` diz se o valor e' gravado num text[] ou numa coluna
// escalar -- a tela usa pra explicar o efeito de renomear.
const DOMINIOS: Record<string, { rotulo: string; tabela: string; coluna: string; array: boolean; cor: boolean }> = {
  nota_tipo:           { rotulo: "Tipos de nota",            tabela: "lifeos_notas",          coluna: "tipo",   array: true,  cor: false },
  tarefa_status:       { rotulo: "Status de tarefa",         tabela: "lifeos_tarefas",        coluna: "status", array: false, cor: false },
  tarefa_tipo:         { rotulo: "Tipos de tarefa",          tabela: "lifeos_tarefas",        coluna: "tipo",   array: true,  cor: false },
  projeto_status:      { rotulo: "Status de projeto",        tabela: "lifeos_projetos",       coluna: "status", array: false, cor: false },
  projeto_tag:         { rotulo: "Tags de projeto",          tabela: "lifeos_projetos",       coluna: "tags",   array: true,  cor: false },
  evento_tipo:         { rotulo: "Tipos de evento",          tabela: "lifeos_eventos",        coluna: "tipo",   array: false, cor: true  },
  manifestacao_status: { rotulo: "Status de manifestação",   tabela: "lifeos_manifestacoes",  coluna: "status", array: false, cor: false },
  manifestacao_tag:    { rotulo: "Tags de manifestação",     tabela: "lifeos_manifestacoes",  coluna: "tags",   array: true,  cor: false },
  mov_direcao:         { rotulo: "Direção de movimentação",  tabela: "lifeos_movimentacoes",  coluna: "tipo",   array: true,  cor: false },
  mov_meio:            { rotulo: "Meios de pagamento",       tabela: "lifeos_movimentacoes",  coluna: "tipo",   array: true,  cor: false },
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
    if (!r.ok) {
      const txt = await r.text();
      const e = new Error(txt);
      (e as any).detalhe = txt;
      throw e;
    }
    return r.json();
  };

  try {
    let token = "", action = "query", id = "", dominio = "", valor = "", novoValor = "", cor = "";
    let ordem: unknown = null, ordens: unknown = null;
    try {
      const b = await req.json();
      token = (b?.token ?? "").toString().trim();
      action = (b?.action ?? "query").toString().trim() || "query";
      id = (b?.id ?? "").toString().trim();
      dominio = (b?.dominio ?? "").toString().trim();
      valor = (b?.valor ?? "").toString().trim();
      novoValor = (b?.novo_valor ?? "").toString().trim();
      cor = (b?.cor ?? "").toString().trim();
      ordem = b?.ordem;
      ordens = b?.ordens;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const ctx = { REST, headers: restHeaders, rpc };

    if (action === "create")  return await handleCreate(ctx, dominio, valor, cor, ordem);
    if (action === "update")  return await handleUpdate(ctx, id, novoValor, cor, ordem);
    if (action === "delete")  return await handleDelete(ctx, id);
    if (action === "reorder") return await handleReorder(ctx, ordens);
    return await handleQuery(ctx);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

type Ctx = {
  REST: string;
  headers: Record<string, string>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
};

type VocabRow = {
  id: string; dominio: string; valor: string;
  cor: string | null; ordem: number; protegido: boolean;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

async function buscarPorId(ctx: Ctx, id: string): Promise<VocabRow | null> {
  const r = await fetch(`${ctx.REST}/lifeos_vocabularios?id=eq.${encodeURIComponent(id)}`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select vocabularios -> ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

// ── query ───────────────────────────────────────────────────────────────
//
// Devolve tudo agrupado por dominio, com a contagem de uso de cada valor.
// A contagem e' o que deixa a tela avisar "12 tarefas usam isto" antes de
// apagar, em vez de so recusar depois.

async function handleQuery(ctx: Ctx) {
  const r = await fetch(`${ctx.REST}/lifeos_vocabularios?order=dominio.asc,ordem.asc,valor.asc`, { headers: ctx.headers });
  if (!r.ok) throw new Error(`select vocabularios -> ${r.status} ${await r.text()}`);
  const rows: VocabRow[] = await r.json();

  const usos = await Promise.all(
    rows.map((row) =>
      ctx.rpc("lifeos_uso_vocabulario", { p_dominio: row.dominio, p_valor: row.valor })
        .catch(() => null)   // dominio fora dos ramos da RPC: uso desconhecido
    ),
  );

  const vocabularios: Record<string, any[]> = {};
  rows.forEach((row, i) => {
    (vocabularios[row.dominio] ??= []).push({
      id: row.id, valor: row.valor, cor: row.cor,
      ordem: row.ordem, protegido: row.protegido,
      uso: usos[i],
    });
  });

  // Dominios sem nenhuma linha ainda aparecem, vazios -- senao a tela
  // esconderia uma secao inteira e o usuario nao saberia que existe.
  for (const d of Object.keys(DOMINIOS)) vocabularios[d] ??= [];

  return json({ ok: true, dominios: DOMINIOS, vocabularios });
}

// ── create ──────────────────────────────────────────────────────────────

async function handleCreate(ctx: Ctx, dominio: string, valor: string, cor: string, ordem: unknown) {
  if (!DOMINIOS[dominio]) return json({ ok: false, error: "dominio_invalido" }, 400);
  if (!valor) return json({ ok: false, error: "valor_vazio" }, 400);
  if (cor && !HEX.test(cor)) return json({ ok: false, error: "cor_invalida" }, 400);

  const corFinal = DOMINIOS[dominio].cor ? (cor || null) : null;
  const ordemFinal = Number.isFinite(Number(ordem)) ? Number(ordem) : 999;

  const r = await fetch(`${ctx.REST}/lifeos_vocabularios`, {
    method: "POST",
    headers: { ...ctx.headers, Prefer: "return=representation" },
    body: JSON.stringify({ dominio, valor, cor: corFinal, ordem: ordemFinal, protegido: false }),
  });
  if (!r.ok) {
    const detalhe = await r.text();
    if (/duplicate key|unique/i.test(detalhe)) return json({ ok: false, error: "valor_duplicado" }, 409);
    return json({ ok: false, error: `db_error: ${r.status} ${detalhe}` }, 502);
  }
  const rows = await r.json();
  return json({ ok: true, vocabulario: { ...rows[0], uso: 0 } });
}

// ── update ──────────────────────────────────────────────────────────────
//
// Renomear e' a operacao delicada: o valor novo precisa chegar TAMBEM nas
// linhas de dado que usam o antigo. Quem faz isso e' a RPC, numa transacao.
// Cor e ordem sao alteracoes cosmeticas e vao por PATCH direto.

async function handleUpdate(ctx: Ctx, id: string, novoValor: string, cor: string, ordem: unknown) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  if (cor && !HEX.test(cor)) return json({ ok: false, error: "cor_invalida" }, 400);

  const atual = await buscarPorId(ctx, id);
  if (!atual) return json({ ok: false, error: "not_found" }, 404);

  let migradas: number | null = null;

  if (novoValor && novoValor !== atual.valor) {
    try {
      migradas = await ctx.rpc("lifeos_renomear_vocabulario", {
        p_dominio: atual.dominio, p_de: atual.valor, p_para: novoValor,
      });
    } catch (e) {
      const d = String((e as any).detalhe ?? e);
      if (/valor_duplicado/.test(d)) return json({ ok: false, error: "valor_duplicado" }, 409);
      if (/valor_inexistente/.test(d)) return json({ ok: false, error: "not_found" }, 404);
      if (/dominio_invalido/.test(d)) return json({ ok: false, error: "dominio_invalido" }, 400);
      return json({ ok: false, error: `db_error: ${d}` }, 502);
    }
  }

  const patch: Record<string, unknown> = {};
  if (DOMINIOS[atual.dominio]?.cor && cor) patch.cor = cor;
  if (Number.isFinite(Number(ordem))) patch.ordem = Number(ordem);

  if (Object.keys(patch).length) {
    const r = await fetch(`${ctx.REST}/lifeos_vocabularios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...ctx.headers, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  }

  const atualizado = await buscarPorId(ctx, id);
  return json({ ok: true, vocabulario: atualizado, linhas_migradas: migradas });
}

// ── delete ──────────────────────────────────────────────────────────────

async function handleDelete(ctx: Ctx, id: string) {
  if (!id) return json({ ok: false, error: "missing_id" }, 400);

  const atual = await buscarPorId(ctx, id);
  if (!atual) return json({ ok: false, error: "not_found" }, 404);

  // Valores dos quais a LOGICA depende por nome. Renomear e' permitido (os
  // dados migram e o codigo passa a ler o nome novo); apagar quebraria o
  // calculo de progresso ou o de saldo em silencio.
  if (atual.protegido) return json({ ok: false, error: "protegido" }, 409);

  const uso = await ctx.rpc("lifeos_uso_vocabulario", {
    p_dominio: atual.dominio, p_valor: atual.valor,
  }).catch(() => 0);

  if (uso > 0) return json({ ok: false, error: "em_uso", uso }, 409);

  const r = await fetch(`${ctx.REST}/lifeos_vocabularios?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...ctx.headers, Prefer: "return=representation" },
  });
  if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  const rows = await r.json();
  if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, id });
}

// ── reorder ─────────────────────────────────────────────────────────────
//
// Recebe [{id, ordem}, ...]. So mexe em `ordem`, nunca no valor -- entao
// nao ha dado de usuario em risco aqui.

async function handleReorder(ctx: Ctx, ordens: unknown) {
  if (!Array.isArray(ordens) || !ordens.length) return json({ ok: false, error: "ordens_vazio" }, 400);

  for (const item of ordens) {
    const id = String((item as any)?.id ?? "").trim();
    const n = Number((item as any)?.ordem);
    if (!id || !Number.isFinite(n)) return json({ ok: false, error: "ordens_invalido" }, 400);

    const r = await fetch(`${ctx.REST}/lifeos_vocabularios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: ctx.headers,
      body: JSON.stringify({ ordem: n }),
    });
    if (!r.ok) return json({ ok: false, error: `db_error: ${r.status} ${await r.text()}` }, 502);
  }
  return json({ ok: true, total: ordens.length });
}
