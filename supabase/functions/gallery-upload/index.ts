// gallery-upload - Supabase Edge Function
//
// Backend do upload de imagens da galeria do archive (galeria.html /
// gallery.js). Ação única: recebe a imagem em base64 (mesmo padrão do
// banner de Manifestações em lifeos-manifestacoes), valida a senha via
// check_page_access(token, 'gallery') -- aceita tanto a senha MESTRE
// quanto um token escopado especificamente à página 'gallery' (ver
// token_pages, gate.js) --, sobe pro bucket 'gallery' e insere a linha
// na tabela, os dois com a service role.
//
// Substitui o fluxo antigo: gallery.js inseria direto na tabela E subia
// pro Storage usando a anon key do browser, o que exigia policies de
// escrita liberadas pra `anon` nas duas pontas -- e o upload pro Storage
// nem tinha gate de senha nenhum (bastava bucket_id = 'gallery'). A
// tabela em si já estava travada (só SELECT liberado pra anon) desde
// antes -- é o que gerava "new row violates row-level security policy
// for table gallery" no upload. Ver migration 0005_gallery_lockdown.sql:
// fecha o INSERT aberto no Storage e concede EXECUTE em check_page_access
// pra service_role, que é quem esta function usa.
//
// SEGURANCA: mesma postura do resto do projeto -- toda escrita passa
// pela service role aqui dentro, nunca client-side com a anon key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ORIGEM PERMITIDA (CORS) -- mesmo padrão das demais functions, ver
// lifeos-eventos/index.ts pro comentário completo sobre por que "*" não
// afrouxa a segurança deste desenho.
const ALLOWED_ORIGIN = Deno.env.get("LIFEOS_ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const BUCKET = "gallery";
const TABLE = "gallery";

// ~12MB de texto base64 -- ~9MB de arquivo original (overhead de ~33% do
// base64), generoso pra foto de celular sem comprimir.
const MAX_BASE64_LEN = 12 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

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

  try {
    let token = "", imageBase64 = "", contentType = "";
    try {
      const body = await req.json();
      token = (body?.token ?? "").toString().trim();
      imageBase64 = (body?.image_base64 ?? "").toString();
      contentType = (body?.content_type ?? "").toString();
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    // check_page_access (não check_master_token): a galeria aceita tanto a
    // senha mestre quanto um token escopado só à página 'gallery' (ver
    // token_pages) -- precisa continuar aceitando os dois, é o mesmo
    // comportamento que gallery.js já tinha antes de mover a checagem pra
    // cá.
    const authR = await fetch(`${REST}/rpc/check_page_access`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({ p_token: token, p_page: "gallery" }),
    });
    if (!authR.ok) throw new Error(`rpc check_page_access -> ${authR.status} ${await authR.text()}`);
    const allowed = await authR.json();
    if (allowed !== true) return json({ ok: false, error: "unauthorized" }, 401);

    if (!imageBase64) return json({ ok: false, error: "missing_image" }, 400);
    if (imageBase64.length > MAX_BASE64_LEN) return json({ ok: false, error: "image_too_large" }, 400);

    const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const ct = contentType || "image/jpeg";
    const ext = extFromContentType(ct);
    const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

    const upR = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": ct, "x-upsert": "false" },
      body: bytes,
    });
    if (!upR.ok) return json({ ok: false, error: `upload_error: ${upR.status} ${await upR.text()}` }, 502);
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;

    const insR = await fetch(`${REST}/${TABLE}`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ image_url: imageUrl }),
    });
    if (!insR.ok) return json({ ok: false, error: `db_error: ${insR.status} ${await insR.text()}` }, 502);
    const row = (await insR.json())[0];

    return json({ ok: true, id: row.id, image_url: row.image_url, updated_at: row.updated_at });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
