/**
 * back-to-top.js — LifeOS
 *
 * Drop this script before </body> on any page to get a floating
 * "scroll to top" button that appears after 300px of scroll.
 *
 * Self-contained: no jQuery, no extra markup, no CSS file needed.
 * Safe to include on pages that already have a #back-to-top element
 * (e.g. index.html) — the script bails out automatically.
 *
 * CSS variables used (with fallbacks matching the dark-page palette):
 *   --bg, --border-mid, --text-muted, --accent-dim, --accent
 */
(function () {
  'use strict';

  // Index.html manages its own button via index.js — skip silently.
  if (document.getElementById('back-to-top')) return;

  /* ── CSS ──────────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = '\
.btt-btn {\
  position: fixed;\
  bottom: 1.5rem;\
  right: 1.5rem;\
  width: 34px;\
  height: 34px;\
  background: var(--bg, #0D0D0F);\
  border: 1px solid var(--border-mid, #3A3228);\
  color: var(--text-muted, #5A5249);\
  display: flex;\
  align-items: center;\
  justify-content: center;\
  cursor: pointer;\
  transition:\
    border-color 0.15s ease,\
    color        0.15s ease,\
    opacity      0.2s  ease,\
    transform    0.2s  ease;\
  z-index: 100;\
  padding: 0;\
  opacity: 0;\
  pointer-events: none;\
  transform: translateY(8px);\
}\
.btt-btn.btt-visible {\
  opacity: 1;\
  pointer-events: auto;\
  transform: translateY(0);\
}\
.btt-btn:hover {\
  border-color: var(--accent-dim, #7A6A56);\
  color: var(--accent, #C4A882);\
}\
@media (prefers-reduced-motion: reduce) {\
  .btt-btn {\
    transition: opacity 0.2s ease;\
  }\
}';
  document.head.appendChild(style);

  /* ── BUTTON ───────────────────────────────────────────────── */
  var btn = document.createElement('button');
  btn.id        = 'back-to-top';
  btn.className = 'btt-btn';
  btn.setAttribute('aria-label', 'Voltar ao topo');
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
      '<line x1="7" y1="12" x2="7" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<polyline points="3,6 7,2 11,6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';
  document.body.appendChild(btn);

  /* ── BEHAVIOUR ────────────────────────────────────────────── */
  btn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', function () {
    btn.classList.toggle('btt-visible', window.scrollY > 300);
  }, { passive: true });
}());
