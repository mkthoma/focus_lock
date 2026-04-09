/**
 * FocusLock Popup — dashboard, session controls, and break-glass modal.
 */

'use strict';

// ─── Chrome API stub (preview / dev mode only) ────────────────────────────────
if (typeof chrome === 'undefined' || !chrome.runtime) {
  const MOCK_STATE = {
    ok: true,
    session: { mode: 'deep_work', startedAt: Date.now() - 1800000, endsAt: Date.now() + 2700000, locked: true, driftMs: 127000, breakCount: 0 },
    settings: {
      modes: {
        deep_work:    { label: 'Deep Work',    durationMin: 90, allowlist: ['github.com'], blocklist: [] },
        shallow_work: { label: 'Shallow Work', durationMin: 45, allowlist: [], blocklist: ['reddit.com'] },
        break:        { label: 'Break',        durationMin: 15, allowlist: [], blocklist: [] }
      }
    },
    sessions: [
      { id: 's1', mode: 'deep_work',    startedAt: Date.now()-86400000, endedAt: Date.now()-83000000, durationMs: 3400000, driftMs: 0,      score: 100, breakCount: 0 },
      { id: 's2', mode: 'shallow_work', startedAt: Date.now()-79200000, endedAt: Date.now()-76800000, durationMs: 2400000, driftMs: 300000, score: 87,  breakCount: 0 },
      { id: 's3', mode: 'deep_work',    startedAt: Date.now()-43200000, endedAt: Date.now()-39600000, durationMs: 3600000, driftMs: 127000, score: 96,  breakCount: 1 },
      { id: 's4', mode: 'break',        startedAt: Date.now()-36000000, endedAt: Date.now()-35100000, durationMs:  900000, driftMs: 0,      score: 100, breakCount: 0 },
      { id: 's5', mode: 'deep_work',    startedAt: Date.now()-7200000,  endedAt: Date.now()-3600000,  durationMs: 3600000, driftMs: 200000, score: 94,  breakCount: 0 }
    ],
    cooldownUntil: null,
    remainingMs: 2700000,
    report: {
      focusScore: 94,
      streak: 5,
      bestDay: 'Wed',
      totalSessions: 5,
      worstOffenders: [
        { domain: 'reddit.com',  driftMs: 300000, driftMin: 5 },
        { domain: 'youtube.com', driftMs: 127000, driftMin: 2 }
      ],
      dailyBreakdown: (() => {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        return days.map((label, i) => ({
          label, date: '', focusScore: 70 + i * 4,
          deepWorkMin:    i < 5 ? 60 + i * 15 : 0,
          shallowWorkMin: i < 5 ? 20 : 0,
          breakMin:       i < 5 ? 15 : 0
        }));
      })()
    }
  };

  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => { if (cb) setTimeout(() => cb(MOCK_STATE), 50); },
      onMessage:   { addListener: () => {} },
      openOptionsPage: () => alert('Options page (Chrome extension only)')
    },
    storage: { local: { get: (k, cb) => cb({}), set: (d, cb) => cb && cb() } }
  };
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const sessionBar     = $('session-bar');
const sessionActive  = $('session-active');
const sessionProgress = $('session-progress');
const sessionProgressFill = $('session-progress-fill');
const sessionIdle    = $('session-idle');
const cooldownBar    = $('cooldown-bar');
const cooldownText   = $('cooldown-text');
const sessionModeBadge = $('session-mode-badge');
const sessionModeIcon  = $('session-mode-icon');
const sessionModeLabel = $('session-mode-label');
const countdown      = $('countdown');
const focusScoreInline = $('focus-score-inline');
const btnEndSession  = $('btn-end-session');
const btnSettings    = $('btn-settings');
const modeSelector   = $('mode-selector');
const modeBtns       = [...document.querySelectorAll('.mode-btn')];

const donutScore     = $('donut-score');
const streakCount    = $('streak-count');
const bestDay        = $('best-day');
const totalSessions  = $('total-sessions');
const worstOffenderMeta   = $('worst-offender-meta');
const worstOffenderDomain = $('worst-offender-domain');
const offenderList   = $('offender-list');
const sessionLog     = $('session-log');

const breakModal     = $('break-modal');
const breakPhraseInput = $('break-phrase-input');
const breakReasonInput = $('break-reason-input');
const modalCancel    = $('modal-cancel');
const modalConfirm   = $('modal-confirm');

// Chart instances
let donutChart = null;
let barChart   = null;

const MODE_ICONS  = { deep_work: '🔴', shallow_work: '🟡', break: '🟢', off: '⚪' };
const MODE_LABELS = { deep_work: 'Deep Work', shallow_work: 'Shallow Work', break: 'Break', off: 'Off' };

// ─── State ────────────────────────────────────────────────────────────────────
let currentState = null;
let tickInterval  = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadState();
  bindEvents();
}

async function loadState() {
  try {
    currentState = await sendMessage({ type: 'GET_STATE' });
    render(currentState);
  } catch (e) {
    console.error('[FocusLock popup] Failed to load state', e);
  }
}

function bindEvents() {
  btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      startSession(mode);
    });
  });

  btnEndSession.addEventListener('click', () => {
    const session = currentState?.session;
    if (session?.locked) {
      openBreakModal();
    } else {
      endSession();
    }
  });

  // Break glass modal
  breakPhraseInput.addEventListener('input', () => {
    const ready = breakPhraseInput.value === 'BREAK';
    modalConfirm.disabled = !ready;
    modalConfirm.classList.toggle('ready', ready);
  });

  modalCancel.addEventListener('click', closeBreakModal);
  modalConfirm.addEventListener('click', confirmBreak);

  breakModal.addEventListener('click', e => {
    if (e.target === breakModal) closeBreakModal();
  });

  // Listen for ticks / session events from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TICK') {
      updateCountdown(message.remainingMs);
    } else if (message.type === 'SESSION_STARTED' || message.type === 'SESSION_ENDED' || message.type === 'SESSION_BROKEN') {
      loadState();
    }
  });
}

// ─── Session actions ──────────────────────────────────────────────────────────
async function startSession(mode) {
  try {
    await sendMessage({ type: 'START_SESSION', mode });
    await loadState();
  } catch (e) {
    showError(e.message);
  }
}

async function endSession() {
  try {
    await sendMessage({ type: 'END_SESSION' });
    await loadState();
  } catch (e) {
    showError(e.message);
  }
}

// ─── Break-glass modal ────────────────────────────────────────────────────────
function openBreakModal() {
  breakPhraseInput.value = '';
  breakReasonInput.value = '';
  modalConfirm.disabled = true;
  modalConfirm.classList.remove('ready');
  breakModal.classList.remove('hidden');
  breakPhraseInput.focus();
}

function closeBreakModal() {
  breakModal.classList.add('hidden');
}

async function confirmBreak() {
  if (breakPhraseInput.value !== 'BREAK') return;
  closeBreakModal();
  try {
    await sendMessage({ type: 'BREAK_SESSION', reason: breakReasonInput.value.trim() });
    await loadState();
  } catch (e) {
    showError(e.message);
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(state) {
  if (!state) return;

  const { session, cooldownUntil, remainingMs, report } = state;
  const isActive = session?.mode && session.mode !== 'off' && session.locked;
  const hasCooldown = cooldownUntil && Date.now() < cooldownUntil;

  // Session bar
  sessionActive.classList.toggle('hidden', !isActive);
  sessionIdle.classList.toggle('hidden', isActive || hasCooldown);
  cooldownBar.classList.toggle('hidden', !hasCooldown || isActive);

  // Session bar active state
  sessionBar.classList.toggle('active', isActive);

  if (isActive) {
    sessionModeBadge.className = `mode-badge ${session.mode}`;
    sessionModeIcon.textContent  = MODE_ICONS[session.mode] ?? '●';
    sessionModeLabel.textContent = MODE_LABELS[session.mode] ?? session.mode;
    sessionActive.dataset.mode = session.mode;
    updateCountdown(remainingMs);

    // Progress bar
    sessionProgress.classList.remove('hidden');
    updateProgress(session, remainingMs);

    const totalDurationMs = (state.settings?.modes?.[session.mode]?.durationMin ?? 45) * 60000;
    const score = totalDurationMs > 0
      ? Math.max(0, Math.round(((totalDurationMs - (session.driftMs ?? 0)) / totalDurationMs) * 100))
      : 100;
    focusScoreInline.textContent = `${score}% focus`;

    startTickPolling(state.session.endsAt, session);
  } else {
    clearInterval(tickInterval);
    sessionProgress.classList.add('hidden');
  }

  if (hasCooldown && !isActive) {
    const mins = Math.ceil((cooldownUntil - Date.now()) / 60000);
    cooldownText.textContent = `Cooldown — ${mins}m before next session`;
  }

  // Disable mode buttons during active locked session or cooldown; highlight active mode
  modeBtns.forEach(btn => {
    btn.disabled = isActive || hasCooldown;
    btn.classList.toggle('active', isActive && btn.dataset.mode === session?.mode);
  });

  // Dashboard
  if (report) renderDashboard(report, state.sessions);
}

function updateCountdown(remainingMs) {
  if (remainingMs == null) return;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  countdown.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateProgress(session, remainingMs) {
  if (!session?.endsAt || !session?.startedAt) return;
  const total = session.endsAt - session.startedAt;
  const elapsed = total - Math.max(0, remainingMs);
  const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0;
  sessionProgressFill.style.width = `${pct}%`;
}

function startTickPolling(endsAt, session) {
  clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    const remaining = Math.max(0, endsAt - Date.now());
    updateCountdown(remaining);
    updateProgress(session, remaining);
    if (remaining <= 0) clearInterval(tickInterval);
  }, 1000);
}

// ─── Dashboard rendering ──────────────────────────────────────────────────────
function renderDashboard(report, sessions) {
  // Focus score donut
  const score = report.focusScore ?? 100;
  donutScore.textContent = `${score}%`;
  renderDonut(score);

  // Streak + meta
  streakCount.textContent = report.streak ?? 0;
  bestDay.textContent = report.bestDay ?? '--';
  totalSessions.textContent = report.totalSessions ?? 0;

  if (report.worstOffenders?.length) {
    const top = report.worstOffenders[0];
    worstOffenderMeta.style.display = '';
    worstOffenderDomain.textContent = top.domain;
  }

  // Daily bar chart
  renderBarChart(report.dailyBreakdown ?? []);

  // Offender list
  renderOffenders(report.worstOffenders ?? []);

  // Session log
  renderSessionLog((sessions ?? []).slice(-8).reverse());
}

function renderDonut(score) {
  const ctx = document.getElementById('donut-chart').getContext('2d');
  const rest = 100 - score;

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const trackColor = isDark ? '#3C3836' : '#E7E5E4';

  if (donutChart) {
    donutChart.data.datasets[0].data = [score, rest];
    donutChart.update('none');
    return;
  }

  // Teal gradient fill for the arc
  const grad = ctx.createLinearGradient(0, 0, 0, 108);
  grad.addColorStop(0, '#14B8A6');
  grad.addColorStop(1, '#0F766E');

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [score, rest],
        backgroundColor: [grad, trackColor],
        borderWidth: 0,
        hoverOffset: 0
      }]
    },
    options: {
      cutout: '74%',
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      events: []
    }
  });
}

function renderBarChart(daily) {
  const ctx = document.getElementById('bar-chart').getContext('2d');
  const labels = daily.map(d => d.label);
  const deepData    = daily.map(d => d.deepWorkMin);
  const shallowData = daily.map(d => d.shallowWorkMin);
  const breakData   = daily.map(d => d.breakMin);

  if (barChart) {
    barChart.data.labels = labels;
    barChart.data.datasets[0].data = deepData;
    barChart.data.datasets[1].data = shallowData;
    barChart.data.datasets[2].data = breakData;
    barChart.update('none');
    return;
  }

  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Deep Work', data: deepData,    backgroundColor: '#EF4444', borderRadius: 3, borderSkipped: false },
        { label: 'Shallow',   data: shallowData, backgroundColor: '#F59E0B', borderRadius: 3, borderSkipped: false },
        { label: 'Break',     data: breakData,   backgroundColor: '#22C55E', borderRadius: 3, borderSkipped: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 9 }, color: '#78716C' }
        },
        y: {
          stacked: true,
          display: false,
          beginAtZero: true
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}m`
          }
        }
      }
    }
  });
}

function renderOffenders(offenders) {
  if (!offenders.length) {
    offenderList.innerHTML = '<div class="empty-state">No drift recorded this week 🎉</div>';
    return;
  }

  const max = offenders[0]?.driftMs ?? 1;
  offenderList.innerHTML = offenders.map(o => {
    const pct = Math.round((o.driftMs / max) * 100);
    const mins = o.driftMin;
    return `
      <div class="offender-row">
        <span class="offender-domain" title="${o.domain}">${o.domain}</span>
        <div class="offender-bar-wrap"><div class="offender-bar" style="width:${pct}%"></div></div>
        <span class="offender-time">${mins}m</span>
      </div>
    `;
  }).join('');
}

function renderSessionLog(sessions) {
  if (!sessions.length) {
    sessionLog.innerHTML = '<div class="empty-state">No sessions yet</div>';
    return;
  }

  const MODE_SHORT = { deep_work: '🔴 Deep', shallow_work: '🟡 Shallow', break: '🟢 Break' };

  sessionLog.innerHTML = sessions.map(s => {
    const dur = s.durationMs ? Math.round(s.durationMs / 60000) : 0;
    const scoreClass = s.score >= 80 ? 'good' : s.score >= 60 ? 'ok' : 'poor';
    return `
      <div class="log-row ${s.mode ?? ''}">
        <span class="log-mode">${MODE_SHORT[s.mode] ?? s.mode}</span>
        <span class="log-dur">${dur}m</span>
        <span class="log-score ${scoreClass}">${s.score}%</span>
      </div>
    `;
  }).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

function showError(msg) {
  // Simple inline error — could be enhanced with a toast
  const bar = sessionIdle;
  const original = bar.textContent;
  bar.textContent = `⚠ ${msg}`;
  bar.style.color = 'var(--color-deep)';
  setTimeout(() => {
    bar.textContent = original;
    bar.style.color = '';
  }, 3000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
