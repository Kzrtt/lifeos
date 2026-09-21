/* lifeos-config.js — configuração declarativa da instância
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ESTE É O ÚNICO ARQUIVO QUE UM FORK PRECISA EDITAR PARA APONTAR PARA O SEU
 * PRÓPRIO BACKEND. Nenhuma credencial nova mora aqui — só as que já estavam
 * chapadas em cada `.js` do LifeOS, agora num lugar só.
 *
 * Sobre a regra de isolamento (LIFEOS.md §2) — emenda deliberada:
 *   §2 proíbe compartilhar COMPORTAMENTO entre as páginas do LifeOS (sem
 *   imports cruzados, sem uma página lendo funções/estado de outra). Este
 *   arquivo não é comportamento: é DADO DECLARATIVO carregado por <script>,
 *   exatamente o mesmo padrão que o archive já usa com `assets/js/manifest.js`.
 *   Funciona em file:// e em HTTP, sem fetch e sem build step.
 *
 *   A consequência prática da §2 continua valendo: cada página do LifeOS LÊ
 *   esta config e monta as suas próprias constantes locais. Nenhuma página
 *   deve expor helpers aqui para outra consumir.
 *
 * Cache-busting: carregado SEM `?v=` — mesmo tratamento de `manifest.js`.
 * O GitHub Pages serve JS com `max-age=600`; uma mudança aqui pode levar até
 * 10 minutos para alcançar um browser que já visitou o site.
 *
 * A `anonKey` é pública por natureza (é ela que o browser manda em toda
 * requisição ao Supabase) e não dá acesso a nada sozinha: as tabelas do
 * LifeOS têm RLS e só a `service_role` — que vive exclusivamente dentro das
 * Edge Functions, nunca no browser — alcança os dados. A fronteira real de
 * autenticação é a senha mestre validada server-side pela RPC
 * `check_master_token`. Ver AUTH.md §4.
 */
window.LIFEOS_CONFIG = {

  /* ── Backend ──────────────────────────────────────────────────────────
   * Supabase → Project Settings → API. A URL é `https://<ref>.supabase.co`.
   */
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  anonKey:
    'COLE-AQUI-A-CHAVE-PUBLICAVEL-ANON',

  /* ── Repositório ──────────────────────────────────────────────────────
   * Alvo da publicação de páginas novas (lifeos/publicar.html). O PAT usado
   * para escrever não fica aqui — vem do Supabase (`admin_config.github_pat`)
   * depois do gate mestre. Ver AUTH.md §"Painel admin".
   */
  gh: {
    owner:  'SEU-USUARIO',
    repo:   'SEU-REPOSITORIO',
    branch: 'main',
  },

  /* ── Identidade ───────────────────────────────────────────────────────
   * Textos e imagens do masthead do hub. Um fork troca isto pelo que quiser.
   * Os caminhos de imagem são relativos às páginas em `lifeos/`.
   */
  identidade: {
    nome:   'LifeOS',
    sub:    'gestão de vida',
    banner: '../assets/images/banner.jpg',
    avatar: '../assets/images/avatar.jpg',
  },

  /* ── Blog ─────────────────────────────────────────────────────────────
   * O projeto tem duas metades: o ARQUIVO público (index, galeria, as
   * páginas em `pages/`) e o PAINEL privado (`lifeos/`). Nem todo mundo
   * quer as duas.
   *
   * `habilitado: false` desliga a metade pública — o menu perde "Publicar
   * página", o link "← arquivo" some, a tela de Senhas esconde o escopo por
   * página, e a raiz do site passa a levar direto ao painel.
   *
   * Não apaga nada: religar aqui traz tudo de volta. Se você não vai
   * publicar nada, desligue — deixar uma capa vazia no ar é pior que não
   * ter capa.
   */
  blog: {
    habilitado: true,
  },

  /* ── Tema ─────────────────────────────────────────────────────────────
   * Paleta padrão DESTA instância. Um dos arquivos em
   * `assets/css/themes/lifeos/` (hoje: sepia, noite, carvao, floresta).
   *
   * É só o padrão: cada navegador pode escolher outro em `lifeos/temas.html`,
   * e essa escolha (localStorage) tem precedência sobre este valor. Ver o
   * cabeçalho de `assets/js/tema.js`.
   *
   * Ao trocar aqui, troque também o `href` estático do `<link id="lifeos-tema">`
   * no `<head>` de cada página do LifeOS — é ele que vale quando não há JS e
   * é ele que evita uma requisição desperdiçada no caso comum.
   */
  tema: 'sepia',

  /* ── Chave de sessão ──────────────────────────────────────────────────
   * localStorage onde a senha mestre fica guardada quando "lembrar neste
   * navegador" está marcado. Compartilhada por TODAS as páginas do LifeOS
   * de propósito: logar numa deixa as outras logadas.
   *
   * O nome `financas_master` é histórico — nasceu quando Finanças era o
   * único módulo. Mantido para não invalidar as sessões já lembradas nos
   * navegadores em uso. Um fork limpo pode trocar à vontade.
   */
  sessionKey: 'financas_master',
};
