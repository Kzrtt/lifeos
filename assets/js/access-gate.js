/**
 * access-gate.js — LifeOS
 *
 * Two modes, selected by data-slug attribute:
 *
 *   SETTER  (index.html):
 *     <script src="assets/js/access-gate.js" data-slug="setter"></script>
 *     Intercepts clicks on links to pages/. Sets a one-time token in
 *     sessionStorage so the protected page can verify the navigation came
 *     from index. Also clears any open-page marker from a previous visit,
 *     so refreshing the protected page after returning to index is blocked.
 *
 *   GUARD  (protected page, early in <head>, no defer/async):
 *     <script src="../assets/js/access-gate.js" data-slug="fichamento-mestre"></script>
 *     Checks either ?ref=share (shared link), a persistent open-session marker
 *     (allows refreshes while the page remains in the session), or the one-time
 *     token from index (first entry). Any other entry sets psyches_blocked and
 *     redirects to sem-acesso.html.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var slug = script && script.getAttribute('data-slug');
  if (!slug) return;

  /* ── SETTER (index.html) ──────────────────────────────────────── */
  if (slug === 'setter') {
    /* user is back at index — close the open-page session so a refresh
       of the protected page after returning here will be blocked again */
    sessionStorage.removeItem('psyches_open');

    document.addEventListener('click', function (e) {
      var el = e.target;
      /* walk up to the nearest anchor */
      while (el && el.tagName !== 'A') el = el.parentElement;
      if (!el) return;

      var href = el.getAttribute('href');
      if (!href || href.indexOf('pages/') === -1) return;

      /* if this tab was previously blocked, don't allow navigating to pages */
      if (sessionStorage.getItem('psyches_blocked')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        location.replace('pages/sem-acesso.html');
        return;
      }

      /* set one-time token for the specific page slug */
      var pageSlug = href.split('/').pop().replace('.html', '');
      sessionStorage.setItem('psyches_gate', pageSlug);
    }, true); /* capture phase — runs before any other handler */
    return;
  }

  /* ── GUARD (protected page) ───────────────────────────────────── */
  /* 1. allow shared link */
  if (new URLSearchParams(location.search).get('ref') === 'share') return;

  /* 2. allow refresh: page was already validated in this session */
  if (sessionStorage.getItem('psyches_open') === slug) return;

  /* 3. allow first entry via one-time token from index */
  var token = sessionStorage.getItem('psyches_gate');
  if (token === slug) {
    sessionStorage.removeItem('psyches_gate');      /* consume — single use */
    sessionStorage.setItem('psyches_open', slug);   /* mark page open for refreshes */
    return;
  }

  /* blocked: flag this tab and redirect */
  sessionStorage.setItem('psyches_blocked', 'true');
  location.replace('sem-acesso.html');
}());
