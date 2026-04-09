/**
 * StorageManager — all chrome.storage.local reads and writes.
 * Handles schema initialisation and session log pruning (max 500 entries).
 */

const MAX_SESSIONS = 500;

export const DEFAULT_SETTINGS = {
  modes: {
    deep_work: {
      label: 'Deep Work',
      durationMin: 90,
      allowlist: ['github.com', 'notion.so', 'docs.google.com', 'stackoverflow.com'],
      blocklist: []
    },
    shallow_work: {
      label: 'Shallow Work',
      durationMin: 45,
      allowlist: [],
      blocklist: ['reddit.com', 'youtube.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'facebook.com']
    },
    break: {
      label: 'Break',
      durationMin: 15,
      allowlist: [],
      blocklist: []
    }
  },
  driftSignals: { border: true, toast: true, overlay: true },
  driftTimers: { tier1Sec: 30, tier2Sec: 60, tier3Sec: 180 },
  breakGlassPhrase: 'BREAK',
  cooldownMin: 5,
  notificationsEnabled: false
};

export const DEFAULT_SESSION = {
  mode: 'off',
  startedAt: null,
  endsAt: null,
  locked: false,
  driftMs: 0,
  breakCount: 0,
  driftLog: [],
  breaks: []
};

/** Load all storage data, initialising defaults if first run. */
export async function loadAll() {
  const data = await chrome.storage.local.get(['currentSession', 'settings', 'sessions', 'cooldownUntil']);
  return {
    currentSession: data.currentSession ?? { ...DEFAULT_SESSION },
    settings: data.settings ?? { ...DEFAULT_SETTINGS },
    sessions: data.sessions ?? [],
    cooldownUntil: data.cooldownUntil ?? null
  };
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function getCurrentSession() {
  const { currentSession } = await chrome.storage.local.get('currentSession');
  return currentSession ?? { ...DEFAULT_SESSION };
}

export async function saveCurrentSession(session) {
  await chrome.storage.local.set({ currentSession: session });
}

export async function getSessions() {
  const { sessions } = await chrome.storage.local.get('sessions');
  return sessions ?? [];
}

/** Append a completed session, pruning oldest if over the cap. */
export async function appendSession(session) {
  const sessions = await getSessions();
  sessions.push(session);
  if (sessions.length > MAX_SESSIONS) {
    sessions.splice(0, sessions.length - MAX_SESSIONS);
  }
  await chrome.storage.local.set({ sessions });
}

export async function getCooldownUntil() {
  const { cooldownUntil } = await chrome.storage.local.get('cooldownUntil');
  return cooldownUntil ?? null;
}

export async function setCooldownUntil(timestamp) {
  await chrome.storage.local.set({ cooldownUntil: timestamp });
}

export async function clearCooldown() {
  await chrome.storage.local.remove('cooldownUntil');
}

/** Reset all data to factory defaults. */
export async function resetAll() {
  await chrome.storage.local.set({
    currentSession: { ...DEFAULT_SESSION },
    settings: { ...DEFAULT_SETTINGS },
    sessions: [],
    cooldownUntil: null
  });
}

/** Export all session data as a CSV string. */
export async function exportSessionsCSV() {
  const sessions = await getSessions();
  const header = 'id,mode,startedAt,endedAt,durationMin,driftMin,score,breakCount\n';
  const rows = sessions.map(s => {
    const durationMs = s.endedAt - s.startedAt;
    const durationMin = (durationMs / 60000).toFixed(1);
    const driftMin = (s.driftMs / 60000).toFixed(1);
    return [s.id, s.mode, new Date(s.startedAt).toISOString(), new Date(s.endedAt).toISOString(), durationMin, driftMin, s.score, s.breakCount].join(',');
  });
  return header + rows.join('\n');
}

/** Update the driftMs on the current live session. */
export async function updateSessionDrift(additionalMs) {
  const session = await getCurrentSession();
  session.driftMs = (session.driftMs ?? 0) + additionalMs;
  await saveCurrentSession(session);
}

/** Append a drift log entry to the current session. */
export async function logDriftEntry(entry) {
  const session = await getCurrentSession();
  if (!session.driftLog) session.driftLog = [];
  session.driftLog.push(entry);
  await saveCurrentSession(session);
}
