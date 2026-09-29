// lifeos-backup - Supabase Edge Function
//
// Backup completo do banco do LifeOS (lifeos.html -- ver
// LIFEOS.md §3.7). Chama a RPC lifeos_backup_dump (migration 0009), que
// devolve toda tabela do schema public com as linhas, e monta os arquivos
// .sql que repopulam outro banco com os mesmos dados. O .zip é montado no
// front -- aqui só sai texto.
//
// O backup é de DADOS. O schema vem das migrations do repositório,
// aplicadas no banco de destino antes do restore (o LEIAME.md gerado diz
// como e em qual migration o dado nasceu).
//
// Formato de cada insert:
//   insert into public.t (cols) select cols
//     from jsonb_populate_recordset(null::public.t, $tag$[...]$tag$);
// O Postgres converte cada valor pelo tipo da coluna de destino (arrays,
// jsonb, numeric, datas), o que dispensa reescrever literal por tipo aqui.
//
// Acoes: "export" (default). Corpo: { token, incluir_credenciais? }.
// Sem credenciais, access_tokens/token_pages/admin_config ficam de fora --
// nem esvaziadas nem repostas no destino, que mantém as próprias.
//
// SEGURANCA (mesma postura de lifeos-projetos):
//  - verify_jwt = false: autenticacao via senha mestre no corpo, checada
//    contra access_tokens.is_master usando a service role (RPC
//    check_master_token). O site chama com a anon key publica.
//  - O front NÃO reaproveita a senha da sessão: o modal pede a senha de
//    novo, porque o arquivo leva o banco inteiro.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ORIGEM PERMITIDA (CORS) -- ver o comentario completo em lifeos-projetos.
//   supabase secrets set LIFEOS_ALLOWED_ORIGIN=https://<usuario>.github.io
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// Tabelas com senhas (texto puro, ver 0001_init.sql) e tokens de serviço.
// O backup completo as inclui; o front deixa tirar.
const CREDENCIAIS = new Set(["access_tokens", "token_pages", "admin_config"]);

// Linhas por insert -- um statement por tabela inteira fica pesado de abrir
// no SQL Editor; um por linha incha o arquivo à toa.
const LINHAS_POR_INSERT = 500;

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
    let token = "", action = "export", incluirCredenciais = true;
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      action = (body?.action ?? "export").toString().trim() || "export";
      incluirCredenciais = body?.incluir_credenciais !== false;
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const isMaster = await rpc("check_master_token", { p_token: token });
    if (isMaster !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (action !== "export") return json({ ok: false, error: "invalid_action" }, 400);

    let dump: Dump;
    try {
      dump = await rpc("lifeos_backup_dump", {});
    } catch (e) {
      return json({ ok: false, error: `db_error: ${String(e)}` }, 502);
    }
    return json({ ok: true, ...montarArquivos(dump, incluirCredenciais) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

type Tabela = {
  tabela: string;
  colunas: string[];
  sequencias: { coluna: string; identity: boolean }[];
  depende_de: string[];
  linhas: Record<string, unknown>[];
};
type Dump = { gerado_em: string; ultima_migration: string | null; tabelas: Tabela[] };

function montarArquivos(dump: Dump, incluirCredenciais: boolean) {
  const tabelas = ordenarPorDependencia(
    dump.tabelas.filter((t) => incluirCredenciais || !CREDENCIAIS.has(t.tabela)),
  );
  const cabecalho = `-- Backup LifeOS · gerado em ${dump.gerado_em}`;
  const arquivos: { nome: string; conteudo: string }[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");

  arquivos.push({
    nome: "00_limpar.sql",
    conteudo: [
      cabecalho,
      "--",
      "-- Esvazia as tabelas que este backup repõe, inclusive as linhas que o",
      "-- seed.sql e as migrations criam num banco novo. Sem `cascade`: se o",
      "-- destino tiver uma tabela a mais apontando para estas, o comando falha",
      "-- em vez de apagá-la junto.",
      "",
      `truncate table ${tabelas.map((t) => nomeTabela(t.tabela)).join(", ")} restart identity;`,
      "",
    ].join("\n"),
  });

  let n = 1;
  for (const t of tabelas) {
    if (!t.linhas.length) continue;
    arquivos.push({ nome: `${pad(n++)}_${t.tabela}.sql`, conteudo: sqlInsert(t, cabecalho) });
  }

  const setvals = tabelas.flatMap((t) =>
    t.sequencias.map((s) =>
      `select setval(pg_get_serial_sequence('${nomeTabela(t.tabela)}', '${s.coluna}'), ` +
      `coalesce((select max(${ident(s.coluna)}) from ${nomeTabela(t.tabela)}), 0) + 1, false);`
    )
  );
  if (setvals.length) {
    arquivos.push({
      nome: `${pad(n++)}_sequencias.sql`,
      conteudo: [
        cabecalho,
        "--",
        "-- Os ids originais foram gravados à mão; sem isto o próximo insert",
        "-- tentaria reusar um id que já existe.",
        "",
        ...setvals,
        "",
      ].join("\n"),
    });
  }

  const resumo = tabelas.map((t) => ({ tabela: t.tabela, linhas: t.linhas.length }));
  arquivos.unshift({ nome: "LEIAME.md", conteudo: leiame(dump, resumo, incluirCredenciais) });

  return { gerado_em: dump.gerado_em, arquivos, tabelas: resumo };
}

// Kahn: pai antes de filho; empate em ordem alfabética para o backup sair
// estável. Um ciclo (não existe hoje) vai para o fim, na ordem que vier.
function ordenarPorDependencia(tabelas: Tabela[]): Tabela[] {
  const nomes = new Set(tabelas.map((t) => t.tabela));
  const pendentes = new Map(tabelas.map((t) => [t.tabela, t.depende_de.filter((d) => nomes.has(d))]));
  const porNome = new Map(tabelas.map((t) => [t.tabela, t]));
  const saida: Tabela[] = [];
  while (pendentes.size) {
    const prontas = [...pendentes].filter(([, deps]) => deps.length === 0).map(([nome]) => nome).sort();
    if (!prontas.length) {
      for (const nome of pendentes.keys()) saida.push(porNome.get(nome)!);
      break;
    }
    for (const nome of prontas) {
      saida.push(porNome.get(nome)!);
      pendentes.delete(nome);
      for (const deps of pendentes.values()) {
        const i = deps.indexOf(nome);
        if (i >= 0) deps.splice(i, 1);
      }
    }
  }
  return saida;
}

function sqlInsert(t: Tabela, cabecalho: string): string {
  const cols = t.colunas.map(ident).join(", ");
  const overriding = t.sequencias.some((s) => s.identity) ? " overriding system value" : "";
  const partes = [cabecalho, `-- ${nomeTabela(t.tabela)} · ${t.linhas.length} linha(s)`, ""];
  for (let i = 0; i < t.linhas.length; i += LINHAS_POR_INSERT) {
    const bloco = t.linhas.slice(i, i + LINHAS_POR_INSERT).map((r) => JSON.stringify(r)).join(",\n");
    partes.push(
      `insert into ${nomeTabela(t.tabela)} (${cols})${overriding}`,
      `select ${cols} from jsonb_populate_recordset(null::${nomeTabela(t.tabela)}, ${dollarQuote("[\n" + bloco + "\n]")});`,
      "",
    );
  }
  return partes.join("\n");
}

// Dollar quoting: o JSON vai cru, sem escapar aspa nem barra, e não depende
// de standard_conforming_strings no banco de destino.
function dollarQuote(s: string): string {
  let tag = "$lifeos$";
  while (s.includes(tag)) tag = `$lifeos${Math.random().toString(36).slice(2, 8)}$`;
  return tag + s + tag;
}

function ident(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}

function nomeTabela(nome: string): string {
  return `public.${ident(nome)}`;
}

function leiame(dump: Dump, resumo: { tabela: string; linhas: number }[], incluirCredenciais: boolean): string {
  const total = resumo.reduce((s, t) => s + t.linhas, 0);
  return [
    "# Backup do LifeOS",
    "",
    `Gerado em ${dump.gerado_em}.`,
    dump.ultima_migration
      ? `Schema de origem: migration \`${dump.ultima_migration}\`.`
      : "Schema de origem: não registrado (as migrations foram aplicadas fora do CLI).",
    incluirCredenciais
      ? "Inclui credenciais: `access_tokens` (senhas em texto puro), `token_pages` e `admin_config` (tokens do GitHub, do MCP etc.). **Guarde este arquivo como guardaria as senhas.**"
      : "Sem credenciais: `access_tokens`, `token_pages` e `admin_config` ficaram de fora — o banco de destino mantém as senhas e tokens que já tem.",
    "",
    `## Conteúdo — ${resumo.length} tabelas, ${total} linhas`,
    "",
    "| Tabela | Linhas |",
    "|---|---|",
    ...resumo.map((t) => `| \`${t.tabela}\` | ${t.linhas} |`),
    "",
    "Tabela com 0 linhas não tem arquivo próprio: o `00_limpar.sql` já a deixa vazia.",
    "",
    "## Como restaurar",
    "",
    "1. **Schema.** O banco de destino precisa ter as mesmas tabelas. Num projeto",
    "   Supabase novo, aplique `supabase/migrations/` do repositório em ordem",
    "   (ver `SETUP.md`), até a migration citada acima. O `seed.sql` é",
    "   dispensável: o passo 2 apaga o que ele cria.",
    "2. **Dados.** Rode os `.sql` deste backup em ordem numérica, começando pelo",
    "   `00_limpar.sql`. Pelo SQL Editor do Supabase, um arquivo por vez; ou,",
    "   de uma vez só e tudo-ou-nada, com o psql:",
    "",
    "   ```bash",
    "   cat *.sql | psql \"$DATABASE_URL\" --single-transaction -v ON_ERROR_STOP=1",
    "   ```",
    "",
    "   A connection string fica em Project Settings → Database.",
    "3. **Edge Functions e front.** Deploy das functions e `lifeos-config.js`",
    "   apontando para o projeto novo, como no `SETUP.md`.",
    "",
    "## O que não está aqui",
    "",
    "- **Arquivos do Storage** (banners das Manifestações, imagens da galeria).",
    "  As linhas guardam a URL pública do projeto de origem, que continua",
    "  funcionando enquanto ele existir.",
    "- **Secrets das Edge Functions** (`LIFEOS_ALLOWED_ORIGIN` e afins) — são",
    "  configuração do projeto, não dado do banco.",
    "",
  ].join("\n");
}
