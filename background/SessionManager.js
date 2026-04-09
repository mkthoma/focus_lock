/**
 * SessionManager — session lifecycle: start, end, break.
 * All state is persisted via StorageManager; this module holds no in-memory state.
 */

import * as StorageManager from './StorageManager.js';
import * as TimerController from './TimerController.js';
import * as EventBus from './EventBus.js';
import { updateActionIcon } from './IconManager.js';

/**
 * Start a new focused session.
 * @param {string} mode - 'deep_work' | 'shallow_work' | 'break'
 */
export async function startSession(mode) {
  const { settings, cooldownUntil } = await StorageManager.loadAll();

  // Enforce cooldown
  if (cooldownUntil && Date.now() < cooldownUntil) {
    const remainingMs = cooldownUntil - Date.now();
    throw new Error(`Cooldown active. ${Math.ceil(remainingMs / 60000)} minute(s) remaining.`);
  }

  const modeConfig = settings.modes[mode];
  if (!modeConfig) throw new Error(`Unknown mode: ${mode}`);

  const durationMs = modeConfig.durationMin * 60 * 1000;
  const now = Date.now();
  const endsAt = now + durationMs;

  const session = {
    mode,
    startedAt: now,
    endsAt,
    locked: true,
    driftMs: 0,
    breakCount: 0,
    driftLog: [],
    breaks: [],
    sessionExceptions: []
  };

  await StorageManager.saveCurrentSession(session);
  TimerController.startSessionAlarm(endsAt);
  await updateActionIcon(mode);

  EventBus.broadcastToTabs({ type: EventBus.MSG.SESSION_STARTED, mode });
  EventBus.notifyPopup({ type: EventBus.MSG.SESSION_STARTED, mode });

  return session;
}

/**
 * End the current session normally (timer elapsed or user-initiated after unlock).
 */
export async function endSession() {
  const session = await StorageManager.getCurrentSession();
  if (!session || session.mode === 'off') return null;

  TimerController.clearSessionAlarms();

  const now = Date.now();
  const durationMs = now - session.startedAt;
  const score = durationMs === 0 ? 100 : Math.round(((durationMs - session.driftMs) / durationMs) * 100);

  const completedSession = {
    id: `sess_${session.startedAt}`,
    mode: session.mode,
    startedAt: session.startedAt,
    endedAt: now,
    durationMs,
    driftMs: session.driftMs,
    driftLog: session.driftLog ?? [],
    breaks: session.breaks ?? [],
    breakCount: session.breakCount,
    score: Math.max(0, score)
  };

  await StorageManager.appendSession(completedSession);
  await StorageManager.saveCurrentSession({ ...StorageManager.DEFAULT_SESSION });
  await updateActionIcon('off');

  EventBus.broadcastToTabs({ type: EventBus.MSG.SESSION_ENDED, session: completedSession });
  EventBus.notifyPopup({ type: EventBus.MSG.SESSION_ENDED, session: completedSession });

  return completedSession;
}

/**
 * Break the current session early — logs the break and starts cooldown.
 * @param {string} reason - optional user-provided reason
 */
export async function breakSession(reason = '') {
  const session = await StorageManager.getCurrentSession();
  if (!session || session.mode === 'off') return null;

  const now = Date.now();
  const remainingMs = Math.max(0, session.endsAt - now);

  // Append the break record
  const breakRecord = { at: now, remainingMs, reason };
  session.breaks = [...(session.breaks ?? []), breakRecord];
  session.breakCount = (session.breakCount ?? 0) + 1;
  await StorageManager.saveCurrentSession(session);

  // End the session and log it
  const completed = await endSession();

  // Apply cooldown
  const settings = await StorageManager.getSettings();
  const cooldownMs = (settings.cooldownMin ?? 5) * 60 * 1000;
  await StorageManager.setCooldownUntil(now + cooldownMs);

  EventBus.broadcastToTabs({ type: EventBus.MSG.SESSION_BROKEN, reason });
  EventBus.notifyPopup({ type: EventBus.MSG.SESSION_BROKEN, reason });

  return completed;
}

/**
 * Add a per-session domain exception (allow a blocked domain just for this session).
 */
export async function addSessionException(domain) {
  const session = await StorageManager.getCurrentSession();
  if (!session || session.mode === 'off') return;
  session.sessionExceptions = [...(session.sessionExceptions ?? []), domain];
  await StorageManager.saveCurrentSession(session);
}

/**
 * Returns the full current session state plus computed remaining time.
 */
export async function getState() {
  const [session, settings, sessions, cooldownUntil] = await Promise.all([
    StorageManager.getCurrentSession(),
    StorageManager.getSettings(),
    StorageManager.getSessions(),
    StorageManager.getCooldownUntil()
  ]);

  const remainingMs = session.endsAt ? TimerController.getRemainingMs(session.endsAt) : 0;

  return { session, settings, sessions, cooldownUntil, remainingMs };
}
