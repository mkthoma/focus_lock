/**
 * FocusLock — Service Worker (background.js)
 * Orchestrates session lifecycle, tab monitoring, drift detection, and alarms.
 */

import * as SessionManager from './background/SessionManager.js';
import * as StorageManager from './background/StorageManager.js';
import * as TimerController from './background/TimerController.js';
import * as EventBus from './background/EventBus.js';
import { resolvePolicy, isInternalUrl, extractRootDomain } from './background/PolicyEngine.js';
import { updateActionIcon, updateBadgeCountdown } from './background/IconManager.js';
import { buildWeeklyReport } from './background/ReportBuilder.js';
import { ALARM_NAMES } from './background/TimerController.js';

// ─── Drift tracking state (in-memory, reset when SW restarts) ────────────────
// Maps tabId → { domain, startMs, warnLevel }
const driftState = new Map();

let seedBlocklist = [];

// ─── Initialise ──────────────────────────────────────────────────────────────
async function init() {
  try {
    const response = await fetch(chrome.runtime.getURL('seed/blocklist.json'));
    seedBlocklist = await response.json();
  } catch (e) {
    console.error('[FocusLock] Failed to load seed blocklist', e);
  }

  // Restore icon state from persisted session
  const session = await StorageManager.getCurrentSession();
  if (session.mode && session.mode !== 'off') {
    await updateActionIcon(session.mode);
    if (session.endsAt) {
      const remaining = TimerController.getRemainingMs(session.endsAt);
      if (remaining > 0) {
        // Re-arm alarms in case SW was restarted mid-session
        TimerController.startSessionAlarm(session.endsAt);
        await updateBadgeCountdown(remaining);
      } else {
        // Session expired while SW was down — end it now
        await SessionManager.endSession();
      }
    }
  }
}

init();

// ─── Alarm handler ───────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.SESSION_END) {
    await SessionManager.endSession();
    driftState.clear();
  } else if (alarm.name === ALARM_NAMES.TICK) {
    const session = await StorageManager.getCurrentSession();
    if (session.mode !== 'off' && session.endsAt) {
      const remaining = TimerController.getRemainingMs(session.endsAt);
      await updateBadgeCountdown(remaining);
      EventBus.notifyPopup({ type: EventBus.MSG.TICK, remainingMs: remaining });
    }
  }
});

// ─── Tab / navigation monitoring ─────────────────────────────────────────────
async function handleNavigation(tabId, url) {
  if (isInternalUrl(url)) return;

  const session = await StorageManager.getCurrentSession();
  if (!session || session.mode === 'off' || !session.locked) {
    // Clear any drift state for this tab since we're not in a session
    if (driftState.has(tabId)) {
      await EventBus.sendToTab(tabId, { type: EventBus.MSG.DRIFT_CLEAR });
      driftState.delete(tabId);
    }
    return;
  }

  const settings = await StorageManager.getSettings();
  const modeConfig = settings.modes[session.mode];
  if (!modeConfig) return;

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return;
  }

  const exceptions = session.sessionExceptions ?? [];
  const policy = resolvePolicy(hostname, modeConfig, seedBlocklist, exceptions);

  if (policy === 'ALLOW') {
    if (driftState.has(tabId)) {
      // Navigated away from drift domain — finalise drift record
      const drift = driftState.get(tabId);
      const driftDuration = Date.now() - drift.startMs;
      await StorageManager.updateSessionDrift(driftDuration);
      await StorageManager.logDriftEntry({
        domain: drift.domain,
        startMs: drift.startMs,
        durationMs: driftDuration
      });
      driftState.delete(tabId);
      await EventBus.sendToTab(tabId, { type: EventBus.MSG.DRIFT_CLEAR });
    }
  } else {
    // DRIFT_WARN
    const domain = extractRootDomain(hostname);
    if (!driftState.has(tabId)) {
      driftState.set(tabId, { domain, startMs: Date.now(), warnLevel: 0 });
      await EventBus.sendToTab(tabId, { type: EventBus.MSG.DRIFT_START, domain, sessionMode: session.mode });
    }
    // Schedule escalating drift checks
    scheduleDriftEscalation(tabId, domain);
  }
}

async function scheduleDriftEscalation(tabId, domain) {
  const settings = await StorageManager.getSettings();
  const timers = settings.driftTimers ?? {};
  const t1Ms = (timers.tier1Sec ?? 30) * 1000;
  const t2Ms = (timers.tier2Sec ?? 60) * 1000;

  // Tier 1: red page flash + toast
  setTimeout(async () => {
    const drift = driftState.get(tabId);
    if (!drift || drift.domain !== domain) return;
    const elapsedMs = Date.now() - drift.startMs;
    if (elapsedMs >= t1Ms) {
      await EventBus.sendToTab(tabId, { type: EventBus.MSG.DRIFT_T1, domain, elapsedMs });
    }
  }, t1Ms);

  // Tier 2: full overlay (red flash continues underneath)
  setTimeout(async () => {
    const drift = driftState.get(tabId);
    if (!drift || drift.domain !== domain) return;
    const elapsedMs = Date.now() - drift.startMs;
    if (elapsedMs >= t2Ms) {
      const session = await StorageManager.getCurrentSession();
      const remaining = session.endsAt ? TimerController.getRemainingMs(session.endsAt) : 0;
      const modeSettings = settings.modes[session.mode] ?? {};
      // Build the effective blocklist shown in the overlay
      const effectiveBlocklist = session.mode === 'deep_work'
        ? [] // deep work uses allowlist — pass that instead
        : [...new Set([...(modeSettings.blocklist ?? []), ...seedBlocklist])].sort();
      const effectiveAllowlist = modeSettings.allowlist ?? [];
      await EventBus.sendToTab(tabId, {
        type: EventBus.MSG.DRIFT_T2,
        domain,
        elapsedMs,
        remainingMs: remaining,
        driftMs: session.driftMs,
        sessionMode: session.mode,
        blocklist: effectiveBlocklist,
        allowlist: effectiveAllowlist
      });
    }
  }, t2Ms);
}

chrome.webNavigation.onCommitted.addListener(({ tabId, url, frameId }) => {
  if (frameId !== 0) return; // top-level frame only
  handleNavigation(tabId, url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) handleNavigation(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  driftState.delete(tabId);
});

// ─── Message handler (from popup / options / content scripts) ─────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case EventBus.MSG.START_SESSION: {
      const session = await SessionManager.startSession(message.mode);
      return { ok: true, session };
    }

    case EventBus.MSG.END_SESSION: {
      const completed = await SessionManager.endSession();
      driftState.clear();
      return { ok: true, session: completed };
    }

    case EventBus.MSG.BREAK_SESSION: {
      const completed = await SessionManager.breakSession(message.reason ?? '');
      driftState.clear();
      return { ok: true, session: completed };
    }

    case EventBus.MSG.GET_STATE: {
      const state = await SessionManager.getState();
      const report = buildWeeklyReport(state.sessions);
      return { ok: true, ...state, report };
    }

    case EventBus.MSG.CLOSE_BLOCKED_TABS: {
      // Close all tabs whose domain is blocked in the current session mode.
      // The tab that sent this message is closed last (or navigated away).
      const session = await StorageManager.getCurrentSession();
      const settings = await StorageManager.getSettings();
      const modeConfig = settings.modes[session.mode];
      const exceptions = session.sessionExceptions ?? [];
      const allTabs = await chrome.tabs.query({});
      const tabsToClose = [];

      for (const tab of allTabs) {
        if (!tab.url || isInternalUrl(tab.url)) continue;
        try {
          const hostname = new URL(tab.url).hostname;
          const policy = resolvePolicy(hostname, modeConfig, seedBlocklist, exceptions);
          if (policy === 'DRIFT_WARN') tabsToClose.push(tab.id);
        } catch { /* skip malformed URLs */ }
      }

      // Close all blocked tabs (including the sender tab)
      for (const id of tabsToClose) {
        chrome.tabs.remove(id).catch(() => {});
        driftState.delete(id);
      }
      return { ok: true, closed: tabsToClose.length };
    }

    case EventBus.MSG.ADD_TO_BLOCKLIST: {
      // Add a domain to the current mode's blocklist and persist it
      const settings = await StorageManager.getSettings();
      const session = await StorageManager.getCurrentSession();
      const mode = session.mode !== 'off' ? session.mode : 'shallow_work';
      const modeConfig = settings.modes[mode];
      if (modeConfig && !modeConfig.blocklist.includes(message.domain)) {
        modeConfig.blocklist = [...modeConfig.blocklist, message.domain];
        await StorageManager.saveSettings(settings);
        await EventBus.broadcastToTabs({ type: EventBus.MSG.SETTINGS_UPDATED });
      }
      return { ok: true };
    }

    case EventBus.MSG.ADD_SESSION_EXCEPTION: {
      await SessionManager.addSessionException(message.domain);
      // Re-evaluate current tab
      if (sender.tab?.id) {
        await EventBus.sendToTab(sender.tab.id, { type: EventBus.MSG.DRIFT_CLEAR });
        driftState.delete(sender.tab.id);
      }
      return { ok: true };
    }

    case 'SYNC_BLOCKLIST': {
      // Called when user removes a tag from the overlay
      const settings = await StorageManager.getSettings();
      const mode = message.mode;
      if (settings.modes[mode]) {
        settings.modes[mode].blocklist = message.blocklist ?? [];
        await StorageManager.saveSettings(settings);
        await EventBus.broadcastToTabs({ type: EventBus.MSG.SETTINGS_UPDATED });
      }
      return { ok: true };
    }

    case EventBus.MSG.SETTINGS_UPDATED: {
      // Broadcast to all tabs so content scripts can re-evaluate
      await EventBus.broadcastToTabs({ type: EventBus.MSG.SETTINGS_UPDATED });
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

// ─── Keyboard commands ────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'start-deep-work') {
    const session = await StorageManager.getCurrentSession();
    if (session.mode === 'off') {
      await SessionManager.startSession('deep_work');
    }
  } else if (command === 'end-session') {
    await SessionManager.endSession();
    driftState.clear();
  }
});

// ─── Notification click ───────────────────────────────────────────────────────
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('focuslock_')) {
    chrome.action.openPopup?.().catch(() => {});
  }
});
