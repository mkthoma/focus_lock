/**
 * drift_overlay.js — Full-page drift overlay (Tier 2 threshold).
 * - "Get Back to Work" auto-closes all blocked tabs in the browser
 * - Shows the current mode's blocked domain list
 * - Lets the user add new domains to the blocklist from the overlay
 */

(function () {
  'use strict';

  let host = null;
  let shadow = null;

  function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function formatRemaining(ms) {
    const totalMin = Math.floor(ms / 60000);
    if (totalMin <= 0) return 'session ending';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  const OVERLAY_CSS = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .fl-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }
    .fl-card {
      position: relative;
      background: #1C1917;
      color: #F5F5F4;
      border-radius: 16px;
      padding: 28px 32px 24px;
      max-width: 500px;
      width: 92%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
      text-align: center;
      animation: fl-pop-in 300ms cubic-bezier(0.16,1,0.3,1) forwards;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    @keyframes fl-pop-in {
      from { transform: scale(0.88) translateY(20px); opacity: 0; }
      to   { transform: scale(1) translateY(0);       opacity: 1; }
    }
    .fl-icon { font-size: 40px; display: block; margin-bottom: 10px; }
    h2 { margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #F97316; }
    .fl-domain { font-size: 14px; color: #A8A29E; margin: 0 0 18px; }

    /* Stats */
    .fl-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }
    .fl-stat {
      background: rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .fl-stat-value { font-size: 17px; font-weight: 700; }
    .fl-stat-label { font-size: 10px; color: #78716C; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }

    /* Primary action */
    .fl-btn-primary {
      width: 100%;
      background: #0F766E;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 13px 24px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .fl-btn-primary:hover { background: #0D9488; }
    .fl-btn-secondary {
      width: 100%;
      background: transparent;
      color: #78716C;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 10px 24px;
      font-size: 13px;
      cursor: pointer;
      transition: color 150ms, border-color 150ms;
      margin-bottom: 16px;
    }
    .fl-btn-secondary:hover { color: #F5F5F4; border-color: rgba(255,255,255,0.3); }

    /* Divider */
    .fl-divider {
      border: none;
      border-top: 1px solid rgba(255,255,255,0.08);
      margin: 4px 0 16px;
    }

    /* Blocked list section */
    .fl-section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #78716C;
      text-align: left;
      margin-bottom: 8px;
    }
    .fl-blocked-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 10px;
      max-height: 120px;
      overflow-y: auto;
      text-align: left;
    }
    .fl-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(220,38,38,0.15);
      border: 1px solid rgba(220,38,38,0.35);
      border-radius: 20px;
      padding: 2px 8px 2px 9px;
      font-size: 11px;
      color: #FCA5A5;
    }
    .fl-tag.current {
      background: rgba(249,115,22,0.2);
      border-color: rgba(249,115,22,0.5);
      color: #FED7AA;
    }
    .fl-tag-remove {
      background: none;
      border: none;
      cursor: pointer;
      color: rgba(252,165,165,0.6);
      font-size: 13px;
      line-height: 1;
      padding: 0 1px;
    }
    .fl-tag-remove:hover { color: #F87171; }
    .fl-empty { font-size: 11px; color: #78716C; text-align: left; padding: 4px 0; }

    /* Add to blocklist */
    .fl-add-row {
      display: flex;
      gap: 6px;
      margin-bottom: 4px;
    }
    .fl-add-input {
      flex: 1;
      padding: 7px 10px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #F5F5F4;
      font-size: 12px;
      outline: none;
    }
    .fl-add-input:focus { border-color: rgba(220,38,38,0.6); }
    .fl-add-input::placeholder { color: #57534E; }
    .fl-add-btn {
      padding: 7px 14px;
      background: rgba(220,38,38,0.2);
      border: 1px solid rgba(220,38,38,0.4);
      border-radius: 8px;
      color: #FCA5A5;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 150ms;
    }
    .fl-add-btn:hover { background: rgba(220,38,38,0.35); }

    @media (prefers-color-scheme: light) {
      .fl-card { background: #FAFAF9; color: #1C1917; }
      .fl-stat { background: rgba(0,0,0,0.05); }
      .fl-domain { color: #78716C; }
      .fl-btn-secondary { color: #A8A29E; border-color: rgba(0,0,0,0.12); }
      .fl-btn-secondary:hover { color: #1C1917; }
      .fl-divider { border-color: rgba(0,0,0,0.08); }
      .fl-tag { background: rgba(220,38,38,0.08); border-color: rgba(220,38,38,0.2); color: #DC2626; }
      .fl-tag.current { background: rgba(249,115,22,0.1); border-color: rgba(249,115,22,0.3); color: #EA580C; }
      .fl-tag-remove { color: rgba(220,38,38,0.5); }
      .fl-tag-remove:hover { color: #DC2626; }
      .fl-add-input { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.12); color: #1C1917; }
      .fl-add-btn { background: rgba(220,38,38,0.08); border-color: rgba(220,38,38,0.2); color: #DC2626; }
    }
  `;

  // The live blocklist state (updated as user adds/removes in the overlay)
  let localBlocklist = [];
  let currentMode = '';

  function buildOverlayHTML(domain, elapsedMs, remainingMs, driftMs, blocklist, sessionMode) {
    const totalDriftMin = Math.round((driftMs ?? 0) / 60000);
    const isDeepWork = sessionMode === 'deep_work';
    const listLabel = isDeepWork ? 'Allowlist (only these permitted)' : 'Current blocklist';

    const tagsHTML = blocklist.length === 0
      ? `<span class="fl-empty">${isDeepWork ? 'No domains in allowlist' : 'No domains in blocklist'}</span>`
      : blocklist.map(d => `
          <span class="fl-tag ${d === domain ? 'current' : ''}" data-domain="${escapeHtml(d)}">
            ${escapeHtml(d)}
            <button class="fl-tag-remove" data-remove="${escapeHtml(d)}" aria-label="Remove ${escapeHtml(d)}">×</button>
          </span>`).join('');

    return `
      <div class="fl-backdrop"></div>
      <div class="fl-card" role="dialog" aria-modal="true" aria-label="Drift Warning">
        <span class="fl-icon">⚠️</span>
        <h2>Hey — you've drifted</h2>
        <p class="fl-domain">
          <strong>${formatMs(elapsedMs)}</strong> on <strong>${escapeHtml(domain)}</strong> during your session.
        </p>

        <div class="fl-stats">
          <div class="fl-stat">
            <div class="fl-stat-value">${formatRemaining(remainingMs)}</div>
            <div class="fl-stat-label">Time left</div>
          </div>
          <div class="fl-stat">
            <div class="fl-stat-value">${totalDriftMin}m</div>
            <div class="fl-stat-label">Total drift</div>
          </div>
        </div>

        <button class="fl-btn-primary" id="fl-back-btn">
          <span>✓</span> Get Back to Work — close all blocked tabs
        </button>
        <button class="fl-btn-secondary" id="fl-allow-btn">
          Allow ${escapeHtml(domain)} for this session only
        </button>

        <hr class="fl-divider">

        <div class="fl-section-label">${escapeHtml(listLabel)}</div>
        <div class="fl-blocked-list" id="fl-blocked-list">${tagsHTML}</div>

        ${!isDeepWork ? `
          <div class="fl-add-row">
            <input class="fl-add-input" id="fl-add-input" type="text" placeholder="Add domain to blocklist…" autocomplete="off">
            <button class="fl-add-btn" id="fl-add-btn">Block</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function rerenderTagList() {
    const list = shadow?.getElementById('fl-blocked-list');
    if (!list) return;
    if (localBlocklist.length === 0) {
      list.innerHTML = '<span class="fl-empty">No domains in blocklist</span>';
      return;
    }
    list.innerHTML = localBlocklist.map(d => `
      <span class="fl-tag" data-domain="${escapeHtml(d)}">
        ${escapeHtml(d)}
        <button class="fl-tag-remove" data-remove="${escapeHtml(d)}" aria-label="Remove ${escapeHtml(d)}">×</button>
      </span>`).join('');
    bindTagRemovals();
  }

  function bindTagRemovals() {
    shadow?.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const domain = btn.dataset.remove;
        localBlocklist = localBlocklist.filter(d => d !== domain);
        // Persist removal (treated as an "add empty" — we just sync the full list)
        chrome.runtime.sendMessage({ type: 'SYNC_BLOCKLIST', mode: currentMode, blocklist: localBlocklist }).catch(() => {});
        rerenderTagList();
      });
    });
  }

  function showOverlay(domain, elapsedMs, remainingMs, driftMs, blocklist, sessionMode) {
    removeOverlay();
    localBlocklist = [...(blocklist ?? [])];
    currentMode = sessionMode ?? '';

    host = document.createElement('div');
    host.setAttribute('data-focuslock', 'overlay');
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildOverlayHTML(domain, elapsedMs, remainingMs, driftMs, localBlocklist, sessionMode);
    shadow.appendChild(wrapper);

    // ── Get Back to Work: close all blocked tabs ──────────────────────────────
    shadow.getElementById('fl-back-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLOSE_BLOCKED_TABS' });
      // Tab will be closed by the service worker; overlay disappears with it
    });

    // ── Allow for session ─────────────────────────────────────────────────────
    shadow.getElementById('fl-allow-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'ADD_SESSION_EXCEPTION', domain });
      removeOverlay();
    });

    // ── Add to blocklist ──────────────────────────────────────────────────────
    const addInput = shadow.getElementById('fl-add-input');
    const addBtn   = shadow.getElementById('fl-add-btn');
    if (addInput && addBtn) {
      function doAdd() {
        const raw = addInput.value.trim().toLowerCase()
          .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!raw || !raw.includes('.') || localBlocklist.includes(raw)) {
          addInput.value = '';
          return;
        }
        localBlocklist = [...localBlocklist, raw];
        chrome.runtime.sendMessage({ type: 'ADD_TO_BLOCKLIST', domain: raw });
        addInput.value = '';
        rerenderTagList();
      }
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    }

    // ── Tag removals ──────────────────────────────────────────────────────────
    bindTagRemovals();

    // ── Backdrop dismiss ──────────────────────────────────────────────────────
    wrapper.querySelector('.fl-backdrop').addEventListener('click', () => removeOverlay());

    document.body.appendChild(host);
  }

  function removeOverlay() {
    host?.remove();
    host = null;
    shadow = null;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DRIFT_T2' || message.type === 'DRIFT_180S') {
      showOverlay(
        message.domain,
        message.elapsedMs ?? 180000,
        message.remainingMs ?? 0,
        message.driftMs ?? 0,
        message.blocklist ?? [],
        message.sessionMode ?? ''
      );
    } else if (
      message.type === 'DRIFT_CLEAR' ||
      message.type === 'SESSION_ENDED' ||
      message.type === 'SESSION_BROKEN'
    ) {
      removeOverlay();
    }
  });
})();
