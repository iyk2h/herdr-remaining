const percent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const resetAt = (value) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};
const duration = (minutes) => minutes === 10080 ? 'Weekly' : minutes === 300 ? '5-hour' : minutes === 1440 ? 'Daily' : minutes > 0 ? `${minutes}m` : 'Limit';
export const modelKey = (value) => typeof value === 'string' && value.trim().length <= 100 && !/[\x00-\x1f]/.test(value) ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const modelKeys = (model) => [...new Set([modelKey(model?.id), modelKey(model?.display_name)].filter(Boolean))];

export function codexWindows(payload) {
  const buckets = payload?.rateLimitsByLimitId;
  const base = buckets?.codex ?? payload?.rateLimits;
  const rows = [];
  const add = (snapshot, prefix = '', scoped = false) => {
    for (const key of ['primary', 'secondary']) {
      const w = snapshot?.[key];
      const used = percent(w?.usedPercent);
      if (used === null) continue;
      const minutes = Number.isFinite(w.windowDurationMins) ? w.windowDurationMins : null;
      rows.push({ label: prefix + duration(minutes), used, minutes, scoped,
        resetAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null });
    }
  };
  add(base);
  for (const [id, snapshot] of Object.entries(buckets ?? {})) {
    if (snapshot === base || id === 'codex') continue;
    add(snapshot, `${snapshot?.limitName || id} · `, true);
  }
  return rows;
}

export function claudeWindows(payload) {
  const rows = [];
  for (const [key, label, minutes] of [['five_hour', '5-hour', 300], ['seven_day', 'Weekly', 10080]]) {
    const w = payload?.[key];
    const used = percent(w?.utilization);
    if (used !== null) rows.push({ label, minutes, used, resetAt: resetAt(w.resets_at), scoped: false });
  }
  for (const w of Array.isArray(payload?.limits) ? payload.limits : []) {
    if (w?.kind !== 'weekly_scoped' || w.is_active !== true || percent(w.percent) === null) continue;
    const name = w.scope?.model?.display_name || w.scope?.surface?.display_name || 'Model';
    const keys = modelKeys(w.scope?.model);
    rows.push({ label: `${name} · Weekly`, minutes: 10080, used: percent(w.percent), resetAt: resetAt(w.resets_at), scoped: true,
      ...(keys.length ? { modelKeys: keys } : {}) });
  }
  // Older responses expose model-specific windows outside the limits array.
  for (const [key, name] of [['seven_day_sonnet', 'Sonnet'], ['seven_day_opus', 'Opus']]) {
    const w = payload?.[key];
    if (percent(w?.utilization) === null || rows.some((r) => r.label === `${name} · Weekly`)) continue;
    rows.push({ label: `${name} · Weekly`, minutes: 10080, used: percent(w.utilization), resetAt: resetAt(w.resets_at), scoped: true, modelKeys: [name.toLowerCase()] });
  }
  return rows;
}

export function failedAccount(profile, old, error, now, identity = null) {
  const base = { id: profile.id, provider: profile.provider, label: profile.label, badge: profile.badge, tint: profile.tint, source: profile.source };
  if (identity && old?.source === profile.source && old.email?.toLowerCase() === identity.toLowerCase() && old.windows?.length) {
    return { ...old, ...base, status: 'stale', error, checkedAt: now };
  }
  return { ...base, email: identity, windows: [], status: 'error', error, checkedAt: now, fetchedAt: null };
}
