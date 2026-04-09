/**
 * toast.js — Non-blocking drift notification using Shadow DOM isolation.
 * Fires at the 60-second drift threshold.
 */

(function () {
  'use strict';

  let host = null;
  let shadow = null;
  let dismissTimer = null;

  const TOAST_HTML = (domain, elapsedMin) => `
    <div id="fl-toast">
      <div class="fl-icon">⏱</div>
      <div class="fl-body">
        <strong>Drifting on ${domain}</strong>
        <span>${elapsedMin} minute${elapsedMin !== 1 ? 's' : ''} — still in your session</span>
      </div>
      <button class="fl-dismiss" aria-label="Dismiss">✕</button>
    </div>
  `;

  const TOAST_CSS = `
    :host {
      all: initial;
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #fl-toast {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #1C1917;
      color: #F5F5F4;
      border-left: 4px solid #F97316;
      border-radius: 8px;
      padding: 12px 14px;
      min-width: 260px;
      max-width: 340px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      animation: fl-slide-in 250ms ease-out forwards;
      cursor: default;
    }
    @keyframes fl-slide-in {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
    @keyframes fl-slide-out {
      from { transform: translateX(0);   opacity: 1; }
      to   { transform: translateX(120%); opacity: 0; }
    }
    #fl-toast.dismissing {
      animation: fl-slide-out 200ms ease-in forwards;
    }
    .fl-icon { font-size: 20px; flex-shrink: 0; }
    .fl-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .fl-body strong { font-size: 13px; font-weight: 600; }
    .fl-body span   { font-size: 11px; color: #A8A29E; }
    .fl-dismiss {
      background: none;
      border: none;
      color: #78716C;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .fl-dismiss:hover { color: #F5F5F4; background: rgba(255,255,255,0.1); }
    @media (prefers-color-scheme: light) {
      #fl-toast { background: #FAFAF9; color: #1C1917; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
      .fl-body span { color: #78716C; }
      .fl-dismiss { color: #A8A29E; }
      .fl-dismiss:hover { color: #1C1917; background: rgba(0,0,0,0.06); }
    }
  `;

  function createToast(domain, elapsedMs) {
    removeToast();

    host = document.createElement('div');
    host.setAttribute('data-focuslock', 'toast');
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = TOAST_CSS;
    shadow.appendChild(style);

    const elapsedMin = Math.floor(elapsedMs / 60000);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = TOAST_HTML(domain, elapsedMin);
    shadow.appendChild(wrapper);

    const dismissBtn = wrapper.querySelector('.fl-dismiss');
    dismissBtn.addEventListener('click', () => dismissToast());

    document.body.appendChild(host);

    // Auto-dismiss after 8 seconds
    dismissTimer = setTimeout(() => dismissToast(), 8000);
  }

  function dismissToast() {
    clearTimeout(dismissTimer);
    const toast = shadow?.querySelector('#fl-toast');
    if (toast) {
      toast.classList.add('dismissing');
      setTimeout(() => removeToast(), 210);
    } else {
      removeToast();
    }
  }

  function removeToast() {
    host?.remove();
    host = null;
    shadow = null;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DRIFT_T1' || message.type === 'DRIFT_60S') {
      createToast(message.domain, message.elapsedMs ?? 30000);
    } else if (message.type === 'DRIFT_CLEAR' || message.type === 'SESSION_ENDED' || message.type === 'SESSION_BROKEN') {
      removeToast();
    }
  });
})();
