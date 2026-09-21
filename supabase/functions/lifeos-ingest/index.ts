// lifeos-ingest - Supabase Edge Function
//
// Webhook de cadastro de movimentacoes financeiras para o hub LifeOS
// (LifeOS, /financas). Criado para que a automacao existente do
// o autor (que ate set/2026 cadastrava direto em `POST
// https://api.notion.com/v1/pages`) precise mudar SO A URL, mantendo o
// payload exatamente igual -- ver LIFEOS.md.
//
// Payload aceito (formato "create page" do Notion, inalterado):
// {
//   "parent": { "database_id": "..." },
//   "icon": { "type": "icon", "icon": { "name": "cash", "color": "gray" } },
//   "properties": {
//     "Name": { "title": [{ "text": { "content": "Mercado" } }] },
//     "Valor": { "number": 42.5 },
//     "Tipo": { "multi_select": [{ "name": "Saida" }, { "name": "Pix" }] },
//     "Date": { "date": { "start": "2026-09-16" } }
//   }
// }
// `parent` e `icon` sao ignorados (o Notion exige `parent`; aqui nao ha
// database para apontar, mas aceitamos o campo por compatibilidade de
// payload -- nao validamos o conteudo dele).
//
// AUTH: via query string (?token=<senha mestre>), nao no corpo -- o corpo
// precisa ficar identico ao que a automacao ja envia. Mesmo gate master de
// sempre (RPC check_master_token). verify_jwt=false: e um webhook externo,
// nao uma chamada do site (sem CORS relevante, sem origin do GitHub Pages).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DIRECOES = ["Entrada", "Saida"];
const MEIOS_VALIDOS = ["Crédito", "Débito", "Pix", "Vale", "Boleto"];

// ── Vocabulário dinâmico ──────────────────────────────────────────────
// As constantes acima viraram FALLBACK. Desde a migration 0002 a lista de
// verdade esta em `lifeos_vocabularios` (LifeOS > menu > Tags).
//
// Sem isto, um meio de pagamento criado pela tela de Tags seria recusado
// aqui -- a automacao do celular pararia de aceitar justamente o valor que
// o usuario acabou de cadastrar.
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

function vocab(dominio: string, fallback: string[]): string[] {
  const l = VOCAB[dominio];
  return (l && l.length) ? l : fallback;
}


const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
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

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") ?? "").trim();
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const rpcRes = await fetch(`${REST}/rpc/check_master_token`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({ p_token: token }),
    });
    if (!rpcRes.ok) throw new Error(`rpc check_master_token -> ${rpcRes.status} ${await rpcRes.text()}`);
    const isMaster = await rpcRes.json();
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    // Mesmos paths que o payload Notion ja usa hoje.
    const props = body?.properties ?? {};
    const name = (props?.Name?.title ?? []).map((t: any) => t?.text?.content ?? "").join("").trim();
    const valorRaw = props?.Valor?.number;
    const tipoRaw = (props?.Tipo?.multi_select ?? []).map((t: any) => String(t?.name ?? ""));
    const dateRaw = props?.Date?.date?.start;

    if (!name) return json({ ok: false, error: "invalid_name" }, 400);

    const valor = Number(valorRaw);
    if (!Number.isFinite(valor) || valor < 0) return json({ ok: false, error: "invalid_valor" }, 400);

    if (typeof dateRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return json({ ok: false, error: "invalid_date" }, 400);
    }

    if (!tipoRaw.length) return json({ ok: false, error: "invalid_tipo" }, 400);
    const dirCount = tipoRaw.filter((t: string) => vocab("mov_direcao", DIRECOES).includes(t)).length;
    const meioOk = tipoRaw.every((t: string) => vocab("mov_direcao", DIRECOES).includes(t) || vocab("mov_meio", MEIOS_VALIDOS).includes(t));
    if (dirCount !== 1 || !meioOk) return json({ ok: false, error: "invalid_tipo" }, 400);

    const insertRes = await fetch(`${REST}/lifeos_movimentacoes`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        name,
        valor: Math.round(valor * 100) / 100,
        date: dateRaw,
        tipo: tipoRaw,
      }),
    });
    if (!insertRes.ok) return json({ ok: false, error: `db_error: ${insertRes.status} ${await insertRes.text()}` }, 502);
    const rows = await insertRes.json();

    return json({ ok: true, id: rows?.[0]?.id ?? null });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
