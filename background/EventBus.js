/**
 * EventBus — broadcasts messages to all content scripts and popup.
 */

/**
 * Send a message to all open tabs (content scripts).
 * Silently ignores tabs that haven't loaded the content script yet.
 */
export async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // Tab may not have content script — ignore
    });
  }
}

/**
 * Send a message to a specific tab.
 */
export async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    // Content script not ready
  }
}

/**
 * Send a message to the popup (if open). Uses chrome.runtime.sendMessage.
 * Popup must have a listener; if not open this throws — we ignore it.
 */
export function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ─── Message type constants ───────────────────────────────────────────────────
export const MSG = {
  SESSION_STARTED: 'SESSION_STARTED',
  SESSION_ENDED: 'SESSION_ENDED',
  SESSION_BROKEN: 'SESSION_BROKEN',
  DRIFT_START: 'DRIFT_START',
  DRIFT_CLEAR: 'DRIFT_CLEAR',
  DRIFT_T1: 'DRIFT_T1',   // tier-1 threshold: red flash + toast
  DRIFT_T2: 'DRIFT_T2',   // tier-2 threshold: overlay
  // legacy aliases kept for backwards compat
  DRIFT_60S: 'DRIFT_T1',
  DRIFT_180S: 'DRIFT_T2',
  TICK: 'TICK',
  STATE_QUERY: 'STATE_QUERY',
  STATE_RESPONSE: 'STATE_RESPONSE',
  START_SESSION: 'START_SESSION',
  END_SESSION: 'END_SESSION',
  BREAK_SESSION: 'BREAK_SESSION',
  GET_STATE: 'GET_STATE',
  ADD_SESSION_EXCEPTION: 'ADD_SESSION_EXCEPTION',
  CLOSE_BLOCKED_TABS: 'CLOSE_BLOCKED_TABS',
  ADD_TO_BLOCKLIST: 'ADD_TO_BLOCKLIST',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED'
};
