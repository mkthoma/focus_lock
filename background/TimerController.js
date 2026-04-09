/**
 * TimerController — manages session countdown using chrome.alarms.
 * Alarms persist across service worker suspension, unlike setInterval.
 */

const SESSION_END_ALARM = 'focuslock_session_end';
const TICK_ALARM = 'focuslock_tick';
const TICK_INTERVAL_MIN = 1; // fire every minute for badge updates

/**
 * Start the session-end alarm and a recurring tick alarm for badge updates.
 * @param {number} endsAt - Unix ms timestamp when session should end
 */
export function startSessionAlarm(endsAt) {
  const remainingMs = endsAt - Date.now();
  const remainingMin = Math.max(remainingMs / 60000, 0.1);

  chrome.alarms.create(SESSION_END_ALARM, { delayInMinutes: remainingMin });
  chrome.alarms.create(TICK_ALARM, {
    delayInMinutes: TICK_INTERVAL_MIN,
    periodInMinutes: TICK_INTERVAL_MIN
  });
}

/** Cancel all session alarms (called when session ends or is broken). */
export function clearSessionAlarms() {
  chrome.alarms.clear(SESSION_END_ALARM);
  chrome.alarms.clear(TICK_ALARM);
}

/**
 * Returns remaining milliseconds in the session, or 0 if expired.
 * @param {number} endsAt - Unix ms timestamp
 */
export function getRemainingMs(endsAt) {
  return Math.max(0, endsAt - Date.now());
}

/** Format ms into "MM:SS" string for badge / popup display. */
export function formatCountdown(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Format ms into a human-readable string like "1h 23m" or "45m". */
export function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export const ALARM_NAMES = { SESSION_END: SESSION_END_ALARM, TICK: TICK_ALARM };
