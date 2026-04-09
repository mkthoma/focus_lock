/**
 * FocusLock Options Page — domain management, mode config, signals, data export.
 */

'use strict';

// ─── Chrome API stub (preview / dev mode only) ────────────────────────────────
if (typeof chrome === 'undefined' || !chrome.runtime) {
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => { if (cb) setTimeout(() => cb({ ok: true }), 50); },
      openOptionsPage: () => {}
    },
    storage: {
      local: {
        get: (keys, cb) => cb({}),
        set: (data, cb) => { if (cb) cb(); },
        clear: (cb) => { if (cb) cb(); },
        remove: (keys, cb) => { if (cb) cb(); }
      }
    }
  };
}

const $ = id => document.getElementById(id);

const MODES = ['deep_work', 'shallow_work', 'break'];
const MODE_LABELS = { deep_work: 'Deep Work', shallow_work: 'Shallow Work', break: 'Break' };
const MODE_COLOURS = { deep_work: 'deep_work', shallow_work: 'shallow_work', break: 'break' };

let settings = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  settings = await loadSettings();
  renderModes();
  renderSignals();
  renderDriftTimers();
  renderBreakGlass();
  bindEvents();
}

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get('settings', ({ settings }) => {
      resolve(settings ?? getDefaultSettings());
    });
  });
}

function getDefaultSettings() {
  return {
    modes: {
      deep_work:    { label: 'Deep Work',    durationMin: 90, allowlist: ['github.com', 'notion.so'], blocklist: [] },
      shallow_work: { label: 'Shallow Work', durationMin: 45, allowlist: [], blocklist: ['reddit.com', 'youtube.com'] },
      break:        { label: 'Break',        durationMin: 15, allowlist: [], blocklist: [] }
    },
    driftSignals: { border: true, toast: true, overlay: true },
    breakGlassPhrase: 'BREAK',
    cooldownMin: 5,
    notificationsEnabled: false
  };
}

// ─── Render modes ─────────────────────────────────────────────────────────────
function renderModes() {
  const container = $('modes-container');
  container.innerHTML = '';

  for (const modeKey of MODES) {
    const modeConfig = settings.modes[modeKey] ?? {};
    const card = document.createElement('div');
    card.className = 'mode-card';
    card.dataset.mode = modeKey;

    card.innerHTML = `
      <div class="mode-header">
        <span class="mode-dot ${MODE_COLOURS[modeKey]}"></span>
        <span class="mode-name">${MODE_LABELS[modeKey]}</span>
        <div class="mode-duration-wrap">
          <input
            type="number"
            class="duration-input"
            data-field="duration"
            value="${modeConfig.durationMin ?? 45}"
            min="1" max="480"
            aria-label="Duration in minutes"
          > min
        </div>
      </div>

      ${modeKey === 'deep_work' ? `
        <div class="domain-section">
          <div class="domain-label allowlist-label">🔵 Allowlist — only these domains are accessible</div>
          <div class="domain-list-wrap" data-list="allowlist"></div>
          <div class="domain-add-row">
            <input type="text" class="domain-input" placeholder="e.g. github.com" data-add="allowlist">
            <button class="btn-add btn-add-allowlist" data-add-btn="allowlist">Add</button>
          </div>
        </div>
      ` : ''}

      ${modeKey === 'shallow_work' ? `
        <div class="domain-section" style="margin-bottom:10px;">
          <div class="domain-label">🔴 Blocklist — these domains trigger drift warnings</div>
          <div class="domain-list-wrap" data-list="blocklist"></div>
          <div class="domain-add-row">
            <input type="text" class="domain-input" placeholder="e.g. reddit.com" data-add="blocklist">
            <button class="btn-add" data-add-btn="blocklist">Add</button>
          </div>
        </div>
        <div class="domain-section">
          <div class="domain-label allowlist-label">🔵 Allowlist — override blocklist for these</div>
          <div class="domain-list-wrap" data-list="allowlist"></div>
          <div class="domain-add-row">
            <input type="text" class="domain-input" placeholder="e.g. meet.google.com" data-add="allowlist">
            <button class="btn-add btn-add-allowlist" data-add-btn="allowlist">Add</button>
          </div>
        </div>
      ` : ''}
    `;

    container.appendChild(card);

    // Populate domain lists
    if (modeKey === 'deep_work') {
      renderDomainTags(card.querySelector('[data-list="allowlist"]'), modeKey, 'allowlist', modeConfig.allowlist ?? []);
    } else if (modeKey === 'shallow_work') {
      renderDomainTags(card.querySelector('[data-list="blocklist"]'), modeKey, 'blocklist', modeConfig.blocklist ?? []);
      renderDomainTags(card.querySelector('[data-list="allowlist"]'), modeKey, 'allowlist', modeConfig.allowlist ?? []);
    }

    // Duration change
    card.querySelector('[data-field="duration"]').addEventListener('change', e => {
      const val = Math.min(480, Math.max(1, parseInt(e.target.value) || 1));
      e.target.value = val;
      settings.modes[modeKey].durationMin = val;
      markDirty();
    });

    // Domain add buttons
    card.querySelectorAll('[data-add-btn]').forEach(btn => {
      const listType = btn.dataset.addBtn;
      const input = card.querySelector(`[data-add="${listType}"]`);
      btn.addEventListener('click', () => addDomain(modeKey, listType, input));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') addDomain(modeKey, listType, input);
      });
    });
  }
}

function renderDomainTags(container, modeKey, listType, domains) {
  container.innerHTML = '';
  domains.forEach(domain => {
    const tag = document.createElement('span');
    tag.className = `domain-tag ${listType === 'allowlist' ? 'allowlist' : ''}`;
    tag.innerHTML = `${domain} <button aria-label="Remove ${domain}">×</button>`;
    tag.querySelector('button').addEventListener('click', () => {
      removeDomain(modeKey, listType, domain);
    });
    container.appendChild(tag);
  });
}

function addDomain(modeKey, listType, input) {
  const raw = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!raw || !raw.includes('.')) return;

  const list = settings.modes[modeKey][listType] ?? [];
  if (list.includes(raw)) {
    input.value = '';
    return;
  }

  settings.modes[modeKey][listType] = [...list, raw];
  input.value = '';
  markDirty();

  // Re-render the specific tag list
  const card = document.querySelector(`[data-mode="${modeKey}"]`);
  const container = card?.querySelector(`[data-list="${listType}"]`);
  if (container) renderDomainTags(container, modeKey, listType, settings.modes[modeKey][listType]);
}

function removeDomain(modeKey, listType, domain) {
  settings.modes[modeKey][listType] = (settings.modes[modeKey][listType] ?? []).filter(d => d !== domain);
  markDirty();

  const card = document.querySelector(`[data-mode="${modeKey}"]`);
  const container = card?.querySelector(`[data-list="${listType}"]`);
  if (container) renderDomainTags(container, modeKey, listType, settings.modes[modeKey][listType]);
}

// ─── Render signals ───────────────────────────────────────────────────────────
function renderSignals() {
  const signals = settings.driftSignals ?? {};
  $('signal-border').checked        = signals.border ?? true;
  $('signal-toast').checked         = signals.toast  ?? true;
  $('signal-overlay').checked       = signals.overlay ?? true;
  $('signal-notifications').checked = settings.notificationsEnabled ?? false;
}

// ─── Render drift timers ──────────────────────────────────────────────────────
function renderDriftTimers() {
  const t = settings.driftTimers ?? {};
  $('drift-tier1').value = t.tier1Sec ?? 30;
  $('drift-tier2').value = t.tier2Sec ?? 60;
}

// ─── Render break glass ───────────────────────────────────────────────────────
function renderBreakGlass() {
  $('break-phrase').value  = settings.breakGlassPhrase ?? 'BREAK';
  $('cooldown-min').value  = settings.cooldownMin ?? 5;
}

// ─── Bind events ──────────────────────────────────────────────────────────────
function bindEvents() {
  ['signal-border', 'signal-toast', 'signal-overlay'].forEach(id => {
    $(id).addEventListener('change', () => {
      const key = id.replace('signal-', '');
      settings.driftSignals[key] = $(id).checked;
      markDirty();
    });
  });

  $('signal-notifications').addEventListener('change', async () => {
    const checked = $('signal-notifications').checked;
    if (checked) {
      const perm = await Notification.requestPermission();
      $('signal-notifications').checked = perm === 'granted';
      settings.notificationsEnabled = perm === 'granted';
    } else {
      settings.notificationsEnabled = false;
    }
    markDirty();
  });

  function saveDriftTimers() {
    const t1 = Math.min(600, Math.max(5,  parseInt($('drift-tier1').value) || 30));
    const t2 = Math.min(600, Math.max(10, parseInt($('drift-tier2').value) || 60));
    $('drift-tier1').value = t1;
    $('drift-tier2').value = Math.max(t1 + 5, t2); // tier2 must be > tier1
    if (!settings.driftTimers) settings.driftTimers = {};
    settings.driftTimers.tier1Sec = t1;
    settings.driftTimers.tier2Sec = Math.max(t1 + 5, t2);
    markDirty();
  }
  $('drift-tier1').addEventListener('change', saveDriftTimers);
  $('drift-tier2').addEventListener('change', saveDriftTimers);

  $('break-phrase').addEventListener('input', () => {
    settings.breakGlassPhrase = $('break-phrase').value.trim() || 'BREAK';
    markDirty();
  });

  $('cooldown-min').addEventListener('change', () => {
    const val = Math.min(60, Math.max(1, parseInt($('cooldown-min').value) || 5));
    $('cooldown-min').value = val;
    settings.cooldownMin = val;
    markDirty();
  });

  $('btn-save').addEventListener('click', saveSettings);
  $('btn-export-csv').addEventListener('click', exportCSV);
  $('btn-clear-history').addEventListener('click', clearHistory);
  $('btn-reset-all').addEventListener('click', resetAll);
}

// ─── Save ─────────────────────────────────────────────────────────────────────
let isDirty = false;

function markDirty() {
  isDirty = true;
  $('save-status').textContent = 'Unsaved changes';
  $('save-status').classList.remove('saved');
}

async function saveSettings() {
  await chrome.storage.local.set({ settings });
  // Notify background
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});
  isDirty = false;
  $('save-status').textContent = '✓ Saved';
  $('save-status').classList.add('saved');
  setTimeout(() => {
    $('save-status').textContent = '';
    $('save-status').classList.remove('saved');
  }, 2500);
}

// ─── Data management ──────────────────────────────────────────────────────────
async function exportCSV() {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const header = 'id,mode,startedAt,endedAt,durationMin,driftMin,score,breakCount\n';
  const rows = sessions.map(s => {
    const dur = s.durationMs ?? (s.endedAt - s.startedAt);
    return [
      s.id,
      s.mode,
      new Date(s.startedAt).toISOString(),
      new Date(s.endedAt ?? s.startedAt).toISOString(),
      (dur / 60000).toFixed(1),
      ((s.driftMs ?? 0) / 60000).toFixed(1),
      s.score ?? 100,
      s.breakCount ?? 0
    ].join(',');
  });

  const csv = header + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `focuslock_export_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearHistory() {
  if (!confirm('Clear all session history? This cannot be undone.')) return;
  await chrome.storage.local.set({ sessions: [] });
  showStatus('History cleared.');
}

async function resetAll() {
  if (!confirm('Reset ALL FocusLock data to factory defaults? This cannot be undone.')) return;
  await chrome.storage.local.clear();
  settings = getDefaultSettings();
  renderModes();
  renderSignals();
  renderDriftTimers();
  renderBreakGlass();
  showStatus('Reset to defaults.');
}

function showStatus(msg) {
  $('save-status').textContent = msg;
  $('save-status').classList.add('saved');
  setTimeout(() => {
    $('save-status').textContent = '';
    $('save-status').classList.remove('saved');
  }, 2500);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
