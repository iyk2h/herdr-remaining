export const INTERVALS = [1, 5, 10, 15];
const ids = (value) => Array.isArray(value) ? [...new Set(value.filter((v) => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(v)))].slice(0, 20) : [];
export function validPreferences(value) {
  return value === undefined || Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value.refreshMinutes === undefined || INTERVALS.includes(value.refreshMinutes))
    && (value.theme === undefined || typeof value.theme === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value.theme))
    && ['disabledIds', 'order'].every((key) => value[key] === undefined || Array.isArray(value[key]) && value[key].length <= 20
      && value[key].every((id) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(id))));
}
export function preferences(value) {
  return {
    refreshMinutes: INTERVALS.includes(value?.refreshMinutes) ? value.refreshMinutes : 5,
    disabledIds: ids(value?.disabledIds).sort(),
    order: ids(value?.order),
    theme: typeof value?.theme === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value.theme) ? value.theme : 'bars',
  };
}

export function pollingPreferences(value) {
  const { refreshMinutes, disabledIds } = preferences(value);
  return { refreshMinutes, disabledIds };
}

export function orderedAccounts(accounts, order) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return accounts.map((account, index) => ({ account, index }))
    .sort((a, b) => (positions.get(a.account.id) ?? order.length + a.index) - (positions.get(b.account.id) ?? order.length + b.index))
    .map(({ account }) => account);
}

export function moveAccount(accounts, order, id, delta) {
  const sorted = orderedAccounts(accounts, order).map((a) => a.id);
  const from = sorted.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sorted.length) return sorted;
  [sorted[from], sorted[to]] = [sorted[to], sorted[from]];
  return sorted;
}

export function enabledProfiles(profiles, prefs) {
  return profiles.filter((profile) => !prefs.disabledIds.includes(profile.id));
}
