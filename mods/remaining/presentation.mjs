export const generalWindows = (account) => (account?.windows ?? []).filter((w) => !w.scoped && Number.isFinite(w.used) && w.used >= 0);
export const remaining = (window) => Number.isFinite(window?.used) ? Math.min(100, Math.max(0, 100 - window.used)) : null;
export const amount = (window) => remaining(window) === null ? '—' : remaining(window) > 0 && remaining(window) < 1 ? '<1%' : `${Math.round(remaining(window))}%`;
export const quotaTone = (window) => remaining(window) === null ? null : remaining(window) === 0 ? 'blocked' : remaining(window) <= 20 ? 'working' : null;
export function quotaPair(account) {
  const windows = generalWindows(account);
  return { short: windows.find((w) => w.minutes === 300) ?? null, weekly: windows.find((w) => w.minutes === 10080) ?? null };
}

export function quotaColumns(accounts, show) {
  const pairs = accounts.map(quotaPair);
  return {
    short: Boolean(show.short && pairs.some((pair) => pair.short)),
    weekly: Boolean(show.weekly && pairs.some((pair) => pair.weekly)),
  };
}

export function quotaDescription(window, label, now = Date.now(), error = null) {
  if (!window) return `${label} limit · ${error || 'Not reported by provider'}`;
  return `${window.label} · ${amount(window)} left · ${resetLabel(window.resetAt, now, true)}`;
}

export function rowMetrics(appearance) {
  const { font, badge, ring, bar, rowPadding } = appearance.sizes;
  const content = Math.max(ring, badge, font + 13);
  const bottom = Math.max(2, rowPadding) + bar;
  return { column: Math.max(44, Math.ceil(font * 3.2), ring), row: content + rowPadding + bottom, bottom };
}

export function resetLabel(at, now = Date.now(), full = false) {
  if (!Number.isFinite(at)) return 'Reset time unavailable';
  const d = new Date(at);
  if (full) return `Resets ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const mins = Math.ceil((at - now) / 60000);
  if (mins <= 0) return 'Reset pending';
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor(mins % 1440 / 60)}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m`;
}

export function resetSummary(pair, now = Date.now()) {
  const shown = [['5h', pair.short], ['7d', pair.weekly]].filter(([, window]) => window);
  const known = shown.filter(([, window]) => Number.isFinite(window.resetAt));
  if (!known.length) return null;
  if (shown.length === 1) return resetLabel(known[0][1].resetAt, now);
  return known.map(([label, window]) => `${label} ${resetLabel(window.resetAt, now)}`).join(' · ');
}

export function shortAge(at, now = Date.now()) {
  if (!Number.isFinite(at)) return '—';
  const mins = Math.max(0, Math.floor((now - at) / 60000));
  if (!mins) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function oldestFetch(accounts) {
  return accounts.length && accounts.every((a) => Number.isFinite(a.fetchedAt)) ? Math.min(...accounts.map((a) => a.fetchedAt)) : null;
}
