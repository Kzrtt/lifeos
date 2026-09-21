/**
 * gallery.js — galeria de imagens do arquivo público
 *
 * Camada de API para a galeria com backend Supabase.
 * Expõe: window.LifeOSGallery = { fetchImages, uploadImage }
 *
 * Sem dependências externas. Usa Supabase REST API + Storage API diretamente.
 *
 * Tabela: gallery  → colunas: id (uuid), image_url (text), updated_at (timestamptz)
 * Bucket: gallery  → público para leitura; anon key para escrita
 *
 * Fluxo de upload:
 *   1. Valida senha via RPC check_access_token
 *   2. Faz upload do arquivo para o bucket 'gallery'
 *   3. Obtém a URL pública e insere registro na tabela 'gallery'
 */
(function (global) {
  'use strict';

  /* Derivados de lifeos-config.js — o único arquivo que um fork edita. */
  const CFG          = window.LIFEOS_CONFIG || {};
  const SUPABASE_URL = CFG.supabaseUrl || '';
  const ANON_KEY     = CFG.anonKey || '';
  const BUCKET       = 'gallery';
  const TABLE        = 'gallery';

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

  /* ── checkPassword ────────────────────────────────────────────
   * Valida a senha via check_page_access com o slug 'gallery'.
   * Mestre → sempre passa. Token limitado → passa se tiver 'gallery'
   * em token_pages.
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async function checkPassword(password) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_page_access', {
      method:  'POST',
      headers: jsonHeaders(),
      body:    JSON.stringify({ p_token: password, p_page: 'gallery' }),
    });
    if (!res.ok) throw new Error('Falha na verificação de senha: HTTP ' + res.status);
    return res.json();
  }

  /* ── uploadToStorage ──────────────────────────────────────────
   * Faz upload de um arquivo para o bucket 'gallery' no Supabase Storage.
   * Gera um nome único com timestamp + sufixo aleatório.
   * @param {File} file
   * @returns {Promise<string>} URL pública do arquivo
   */
  async function uploadToStorage(file) {
    const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const suffix   = Math.random().toString(36).slice(2, 7);
    const filename = 'img-' + Date.now() + '-' + suffix + '.' + ext;

    const res = await fetch(
      SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + filename,
      {
        method:  'POST',
        headers: Object.assign({}, BASE_HEADERS, {
          'Content-Type': file.type || 'image/jpeg',
          'x-upsert':     'false',
        }),
        body: file,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(function () { return {}; });
      throw new Error(err.error || err.message || 'Falha no upload: HTTP ' + res.status);
    }

    return SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + filename;
  }

  /* ── insertRecord ─────────────────────────────────────────────
   * Insere uma linha na tabela gallery com a URL pública da imagem.
   * @param {string} imageUrl
   */
  async function insertRecord(imageUrl) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE, {
      method:  'POST',
      headers: jsonHeaders({ 'Prefer': 'return=minimal' }),
      body:    JSON.stringify({ image_url: imageUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || 'Falha ao registrar imagem: HTTP ' + res.status);
    }
  }

  /* ── uploadImage ──────────────────────────────────────────────
   * Fluxo completo: valida senha → upload → insere no banco.
   * Lança erro se a senha for inválida ou qualquer etapa falhar.
   * @param {File}   file
   * @param {string} password
   * @returns {Promise<string>} URL pública da imagem enviada
   */
  async function uploadImage(file, password) {
    const valid = await checkPassword(password);
    if (!valid) {
      const err = new Error('senha incorreta');
      err.isAuth = true;
      throw err;
    }
    const url = await uploadToStorage(file);
    await insertRecord(url);
    return url;
  }

  /* ── Exporta ─────────────────────────────────────────────────── */
  global.LifeOSGallery = {
    fetchImages:  fetchImages,
    uploadImage:  uploadImage,
  };

}(window));
