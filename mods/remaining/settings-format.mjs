import { preferences, validPreferences, orderedAccounts } from './preferences.mjs';

const FORMAT = 'herdr.remaining.settings';
const KEYS = ['refreshMinutes', 'disabledIds', 'order', 'theme'];
const accountIds = (profiles) => profiles.map((profile) => profile.id);
const unique = (values) => new Set(values).size === values.length;

export function createSettingsBackup(value, profiles = []) {
  const accounts = accountIds(profiles);
  if (!validPreferences({ order: accounts }) || !unique(accounts)) throw new Error('Invalid accounts');
  const prefs = preferences(value);
  const known = new Set(accounts);
  return JSON.stringify({ format: FORMAT, version: 1, accounts, preferences: {
    ...prefs, disabledIds: prefs.disabledIds.filter((id) => known.has(id)), order: accountIds(orderedAccounts(profiles, prefs.order)),
  } }, null, 2);
}

export function restoreSettingsBackup(text, { current = null, profiles = [], themeIds = ['bars', 'rings'] } = {}) {
  if (typeof text !== 'string' || text.length > 8192) throw new Error('Invalid settings backup');
  const backup = JSON.parse(text);
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || backup.format !== FORMAT || backup.version !== 1
    || Object.keys(backup).some((key) => !['format', 'version', 'accounts', 'preferences'].includes(key))
    || !validPreferences({ order: backup.accounts }) || !Array.isArray(backup.accounts) || !unique(backup.accounts)
    || !backup.preferences || typeof backup.preferences !== 'object' || Array.isArray(backup.preferences)
    || !validPreferences(backup.preferences) || KEYS.some((key) => !Object.hasOwn(backup.preferences, key))
    || Object.keys(backup.preferences).some((key) => !KEYS.includes(key))) throw new Error('Invalid settings backup');
  const cohort = new Set(backup.accounts);
  if (['order', 'disabledIds'].some((key) => !unique(backup.preferences[key]) || backup.preferences[key].some((id) => !cohort.has(id)))) throw new Error('Invalid backup accounts');
  const prefs = preferences(current);
  const known = new Set(accountIds(profiles));
  const order = backup.preferences.order.filter((id) => known.has(id));
  const extras = accountIds(orderedAccounts(profiles, prefs.order)).filter((id) => !order.includes(id));
  const themeMissing = !themeIds.includes(backup.preferences.theme);
  const theme = themeMissing ? themeIds.includes(prefs.theme) ? prefs.theme : 'bars' : backup.preferences.theme;
  const disabledIds = [...new Set([...backup.preferences.disabledIds.filter((id) => known.has(id)),
    ...prefs.disabledIds.filter((id) => !known.has(id) || !cohort.has(id))])];
  if (disabledIds.length > 20) throw new Error('Too many retained account settings');
  return { preferences: preferences({ ...backup.preferences, theme, order: [...order, ...extras],
    disabledIds,
  }), ignoredAccounts: backup.accounts.filter((id) => !known.has(id)).length, themeMissing };
}
