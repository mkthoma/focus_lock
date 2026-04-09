/**
 * ReportBuilder — aggregates raw session logs into weekly report data.
 * Called on demand when the popup opens.
 */

/**
 * Calculate focus score for an array of sessions.
 * Score = % of active time spent on-policy (not drifting).
 */
export function calculateFocusScore(sessions) {
  let totalActive = 0;
  let totalOnPolicy = 0;
  for (const s of sessions) {
    const dur = s.durationMs ?? (s.endedAt - s.startedAt);
    totalActive += dur;
    totalOnPolicy += dur - (s.driftMs ?? 0);
  }
  return totalActive === 0 ? 100 : Math.round((totalOnPolicy / totalActive) * 100);
}

/**
 * Returns sessions from the past N days (default 7).
 */
export function getRecentSessions(sessions, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return sessions.filter(s => s.startedAt >= cutoff);
}

/**
 * Calculate current streak — consecutive days with focus score >= 70%
 * (at least one qualifying session per day).
 */
export function calculateStreak(sessions) {
  if (!sessions.length) return 0;

  // Group sessions by date string (local)
  const byDay = new Map();
  for (const s of sessions) {
    const day = new Date(s.startedAt).toLocaleDateString('en-CA'); // YYYY-MM-DD
    const existing = byDay.get(day) ?? [];
    existing.push(s);
    byDay.set(day, existing);
  }

  // Build sorted list of qualifying days
  const qualifyingDays = new Set();
  for (const [day, daySessions] of byDay.entries()) {
    const score = calculateFocusScore(daySessions);
    if (score >= 70) qualifyingDays.add(day);
  }

  // Walk backward from today counting consecutive qualifying days
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    if (qualifyingDays.has(key)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Build daily breakdown for the past 7 days.
 * Returns array of { date, label, deepWorkMin, shallowWorkMin, breakMin, focusScore }
 */
export function buildDailyBreakdown(sessions) {
  const days = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayKey = d.toLocaleDateString('en-CA');
    const label = d.toLocaleDateString('en-US', { weekday: 'short' });

    const daySessions = sessions.filter(s => {
      return new Date(s.startedAt).toLocaleDateString('en-CA') === dayKey;
    });

    let deepWorkMin = 0, shallowWorkMin = 0, breakMin = 0;
    for (const s of daySessions) {
      const min = (s.durationMs ?? 0) / 60000;
      if (s.mode === 'deep_work') deepWorkMin += min;
      else if (s.mode === 'shallow_work') shallowWorkMin += min;
      else if (s.mode === 'break') breakMin += min;
    }

    days.push({
      date: dayKey,
      label,
      deepWorkMin: Math.round(deepWorkMin),
      shallowWorkMin: Math.round(shallowWorkMin),
      breakMin: Math.round(breakMin),
      focusScore: calculateFocusScore(daySessions)
    });
  }
  return days;
}

/**
 * Build drift heatmap data — 7 days × 18 hour slots (6am–midnight).
 * Returns 2D array [dayIndex][hourIndex] = driftEventCount.
 */
export function buildDriftHeatmap(sessions) {
  // [0=Mon..6=Sun][0=6am..17=11pm]
  const grid = Array.from({ length: 7 }, () => new Array(18).fill(0));

  for (const s of sessions) {
    for (const drift of s.driftLog ?? []) {
      const date = new Date(drift.startMs ?? s.startedAt);
      const hour = date.getHours();
      if (hour < 6 || hour >= 24) continue;
      const hourIdx = hour - 6;
      const dayIdx = (date.getDay() + 6) % 7; // 0=Mon
      grid[dayIdx][hourIdx]++;
    }
  }
  return grid;
}

/**
 * Find the top N worst offender domains by total drift time (ms).
 */
export function getWorstOffenders(sessions, topN = 5) {
  const totals = new Map();
  for (const s of sessions) {
    for (const entry of s.driftLog ?? []) {
      const cur = totals.get(entry.domain) ?? 0;
      totals.set(entry.domain, cur + (entry.durationMs ?? 0));
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([domain, driftMs]) => ({ domain, driftMs, driftMin: Math.round(driftMs / 60000) }));
}

/**
 * Full weekly report — everything the popup needs in one call.
 */
export function buildWeeklyReport(allSessions) {
  const recent = getRecentSessions(allSessions, 7);
  return {
    focusScore: calculateFocusScore(recent),
    streak: calculateStreak(allSessions),
    dailyBreakdown: buildDailyBreakdown(recent),
    driftHeatmap: buildDriftHeatmap(recent),
    worstOffenders: getWorstOffenders(recent),
    totalSessions: recent.length,
    bestDay: (() => {
      const bd = buildDailyBreakdown(recent);
      const best = bd.reduce((a, b) => a.focusScore >= b.focusScore ? a : b, bd[0]);
      return best?.label ?? 'N/A';
    })()
  };
}
