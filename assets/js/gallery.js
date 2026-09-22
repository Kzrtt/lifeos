/**
 * gallery.js — galeria de imagens do arquivo público
 *
 * Camada de API para a galeria com backend Supabase.
 * Expõe: window.LifeOSGallery = { fetchImages, uploadImage }
 *
 * LEITURA (fetchImages) segue direto via REST + anon key — a tabela
 * `gallery` permite SELECT público (policy `anon_select_gallery`), de
 * propósito (a galeria é pública pra visitantes).
 *
 * ESCRITA (uploadImage) passa pela Edge Function `gallery-upload`
 * (service role) — NÃO insere mais direto na tabela nem sobe pro
 * Storage com a anon key (set/2026: as duas policies de escrita para
 * `anon` foram fechadas — ver `supabase/migrations/
 * 0005_gallery_lockdown.sql` e `supabase/functions/gallery-upload/
 * index.ts`. Escrever direto com a anon key exigia a tabela e o bucket
 * ficarem abertos pra qualquer um que lesse a anon key no código-fonte
 * do site, o mesmo anti-padrão que o LifeOS evita em todo o resto do
 * projeto). O arquivo é lido local via FileReader e enviado em base64,
 * mesmo padrão do banner de Manifestações no LifeOS.
 */
(function (global) {
  'use strict';

  /* Derivados de lifeos-config.js — o único arquivo que um fork edita. */
  const CFG          = window.LIFEOS_CONFIG || {};
  const SUPABASE_URL = CFG.supabaseUrl || '';
  const ANON_KEY     = CFG.anonKey || '';
  const TABLE        = 'gallery';
  const UPLOAD_FN    = SUPABASE_URL + '/functions/v1/gallery-upload';

  const BASE_HEADERS = {
    'apikey':        ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
  };

  function jsonHeaders(extra) {
    return Object.assign({ 'Content-Type': 'application/json' }, BASE_HEADERS, extra || {});
  }

  /* ── fetchImages ──────────────────────────────────────────────
   * Retorna todas as linhas da tabela gallery, mais recentes primeiro.
   * @returns {Promise<Array<{id, image_url, updated_at}>>}
   */
  async function fetchImages() {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/' + TABLE + '?select=id,image_url,updated_at&order=updated_at.desc',
      { headers: jsonHeaders() }
    );
    if (!res.ok) {
      const err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || 'Falha ao buscar imagens: HTTP ' + res.status);
    }
    return res.json();
  }

  /* Lê um File local como base64 puro (sem o prefixo data:...;base64,) —
     mesmo padrão de readFileAsBase64 no upload de banner de
     Manifestações (lifeos.js). */
  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx === -1 ? result : result.slice(idx + 1));
      };
      reader.onerror = function () { reject(new Error('falha ao ler o arquivo')); };
      reader.readAsDataURL(file);
    });
  }

  /* ── uploadImage ──────────────────────────────────────────────
   * Fluxo completo: lê o arquivo local em base64 e envia junto da senha
   * pra Edge Function gallery-upload — ela valida a senha (via
   * check_page_access, mesma regra de antes: mestre OU token escopado
   * a 'gallery'), sobe pro Storage e registra na tabela, tudo do lado
   * do servidor com a service role.
   * @param {File}   file
   * @param {string} password
   * @returns {Promise<string>} URL pública da imagem enviada
   */
  async function uploadImage(file, password) {
    const base64 = await readFileAsBase64(file);
    const res = await fetch(UPLOAD_FN, {
      method:  'POST',
      headers: jsonHeaders(),
      body:    JSON.stringify({ token: password, image_base64: base64, content_type: file.type || 'image/jpeg' }),
    });
    const j = await res.json().catch(function () { return {}; });
    if (res.status === 401 || (j && j.error === 'unauthorized')) {
      const err = new Error('senha incorreta');
      err.isAuth = true;
      throw err;
    }
    if (!res.ok || !j || !j.ok) {
      throw new Error((j && j.error) || 'Falha ao enviar imagem: HTTP ' + res.status);
    }
    return j.image_url;
  }

  /* ── Exporta ─────────────────────────────────────────────────── */
  global.LifeOSGallery = {
    fetchImages:  fetchImages,
    uploadImage:  uploadImage,
  };

}(window));
