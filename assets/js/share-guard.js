/**
 * share-guard.js — LifeOS
 *
 * Add as the FIRST <script> in <head> (no defer, no async) on every page.
 *
 * How it works:
 *   • share-link.js writes sessionStorage['psyches_shared_page'] = pathname
 *     when the page is opened with ?ref=share.
 *   • This guard runs on every page load. If the session has a shared page
 *     stored AND the current pathname doesn't match it, the visitor is
 *     immediately redirected back — before any content renders.
 *
 * sessionStorage is tab-scoped: opening a new tab starts a fresh session,
 * so normal navigation in other tabs is never affected.
 */
(function () {
  'use strict';
  var stored = sessionStorage.getItem('psyches_shared_page');
  if (!stored) return;
  if (window.location.pathname !== stored) {
    window.location.replace(stored + '?ref=share');
  }
}());
