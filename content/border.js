/**
 * border.js — Drift visual feedback.
 *
 * DRIFT_START  → subtle orange border (immediate, while under tier-1 threshold)
 * DRIFT_T1     → upgrades to full-page red flash overlay (replaces border)
 * DRIFT_CLEAR / SESSION_ENDED / SESSION_BROKEN → removes everything
 *
 * Red flash rate: 0.25 Hz (one pulse every 4 s) — well within photosensitive
 * epilepsy safety guidelines (< 3 flashes/s, < 50 cd/m² luminance contrast).
 */

(function () {
  'use strict';

  const BORDER_STYLE_ID = 'focuslock-border-style';
  const FLASH_STYLE_ID  = 'focuslock-flash-style';
  const BORDER_EL_ID    = 'focuslock-border-overlay';
  const FLASH_EL_ID     = 'focuslock-flash-overlay';

  // ── Orange border (tier-0) ─────────────────────────────────────────────────
  const BORDER_CSS = `
    @keyframes focuslock-border-pulse {
      0%   { opacity: 1; }
      50%  { opacity: 0.3; }
      100% { opacity: 1; }
    }
    #${BORDER_EL_ID} {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
      box-shadow: inset 0 0 0 4px #F97316;
      animation: focuslock-border-pulse 2s ease-in-out infinite;
    }
  `;

  // ── Red page flash (tier-1+) ───────────────────────────────────────────────
  // 4-second cycle = 0.25 Hz. Max opacity 0.18 keeps it visible but not harsh.
  const FLASH_CSS = `
    @keyframes focuslock-red-flash {
      0%   { opacity: 0; }
      40%  { opacity: 0.18; }
      60%  { opacity: 0.18; }
      100% { opacity: 0; }
    }
    #${FLASH_EL_ID} {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
      background: #DC2626;
      animation: focuslock-red-flash 4s ease-in-out infinite;
    }
  `;

  function injectBorder() {
    if (document.getElementById(BORDER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = BORDER_STYLE_ID;
    style.textContent = BORDER_CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = BORDER_EL_ID;
    document.body.appendChild(el);
  }

  function removeBorder() {
    document.getElementById(BORDER_STYLE_ID)?.remove();
    document.getElementById(BORDER_EL_ID)?.remove();
  }

  function injectFlash() {
    removeBorder(); // replace border with flash
    if (document.getElementById(FLASH_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = FLASH_STYLE_ID;
    style.textContent = FLASH_CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = FLASH_EL_ID;
    document.body.appendChild(el);
  }

  function removeFlash() {
    document.getElementById(FLASH_STYLE_ID)?.remove();
    document.getElementById(FLASH_EL_ID)?.remove();
  }

  function removeAll() {
    removeBorder();
    removeFlash();
  }

  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'DRIFT_START':
        injectBorder();
        break;
      case 'DRIFT_T1':
        injectFlash();
        break;
      case 'DRIFT_CLEAR':
      case 'SESSION_ENDED':
      case 'SESSION_BROKEN':
        removeAll();
        break;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) removeAll();
  });
})();
