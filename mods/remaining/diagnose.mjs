import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadThemes } from './themes.mjs';
import { orderedAccounts } from './preferences.mjs';
import { generalWindows } from './presentation.mjs';
import { nextRefreshAt } from './refresh-policy.mjs';
import { codexExecutable } from './usage.mjs';
import { localAccountState, exists } from './local-state.mjs';

export function queryFailure(error) {
  if (!error) return null;
  const text = typeof error === 'string' ? error : '';
  if (/match expectedEmail|account changed/i.test(text)) return 'identity_changed';
  if (/login|sign in|credentials|keychain/i.test(text)) return 'login_required';
  if (/rate limit|429/i.test(text)) return 'provider_rate_limited';
  if (/timed out|timeout/i.test(text)) return 'query_timeout';
  if (/CLI not found|could not start/i.test(text)) return 'cli_unavailable';
  if (/No supported subscription limits/i.test(text)) return 'limits_not_reported';
  return 'query_failed';
}

export async function diagnose({ root = dirname(fileURLToPath(import.meta.url)),
  appHome = process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'),
  home = homedir(), env = process.env, now = Date.now(), findCodex = codexExecutable } = {}) {
  const checks = [];
  const add = (status, code, action = null) => checks.push({ status, code, ...(action ? { action } : {}) });
  add(Number(process.versions.node.split('.')[0]) >= 18 ? 'ok' : 'error', 'node_runtime', 'Use Node.js 18 or newer.');
  const { stored, preferencesValid, prefs, profiles, discoveryFailed, cache, compatible } = await localAccountState({ root, appHome, home, env });
  if (stored.state === 'invalid' || stored.state === 'unreadable') add('error', 'preferences_unreadable', 'Check Herdr shared state locally; do not overwrite it.');
  if (!preferencesValid) {
    add('warning', 'preferences_normalized', 'Check saved Remaining preferences locally; invalid values use defaults.');
  }
  if (!discoveryFailed) {
    add(profiles.length ? 'ok' : 'warning', profiles.length ? 'accounts_discovered' : 'no_accounts',
      profiles.length ? null : 'Configure an existing Claude or Codex CLI login; see AI.md.');
  } else { add('error', 'account_discovery_failed', 'Check local accounts.json and Herdr programs.json; never paste credentials into a report.'); }
  const configured = await exists(join(root, 'accounts.json'));
  const monitored = profiles.filter((profile) => !prefs.disabledIds.includes(profile.id));
  if (monitored.length && !compatible) add('warning', cache.state === 'invalid' ? 'cache_invalid' : 'refresh_required', 'Run launch.sh --refresh, then launch.sh --diagnose.');
  if (compatible && monitored.length && now >= nextRefreshAt(cache.value, now)) add('warning', 'refresh_due', 'Refresh limits in the widget or run launch.sh --refresh.');
  const accounts = [];
  for (const [index, profile] of orderedAccounts(profiles, prefs.order).entries()) {
    const enabled = !prefs.disabledIds.includes(profile.id);
    const saved = compatible ? cache.value.accounts.find((row) => row.id === profile.id && row.source === profile.source) : null;
    let cli = enabled && profile.provider === 'codex' ? 'available' : 'not_checked';
    if (cli === 'available') { try { await findCodex(profile); } catch { cli = 'missing'; add('warning', 'codex_cli_missing', 'Install Codex CLI or check codexBin locally.'); } }
    const credentialFile = enabled ? await exists(join(profile.home, profile.provider === 'codex' ? 'auth.json' : '.credentials.json')) : false;
    const login = !enabled ? 'paused' : credentialFile ? 'file_present_not_verified'
      : profile.provider === 'claude' && profile.keychainService && process.platform === 'darwin' ? 'keychain_not_checked' : 'file_missing';
    if (enabled && login === 'file_missing') add('warning', 'login_file_missing', 'Check this account through its CLI; this diagnostic does not read credentials.');
    const query = !enabled ? 'paused' : saved && ['ok', 'stale', 'error', 'checking'].includes(saved.status) ? saved.status : 'not_checked';
    if (enabled && query === 'not_checked' && compatible) add('warning', 'refresh_required', 'This account has no matching cached query; refresh limits.');
    const failure = enabled ? queryFailure(saved?.error) : null;
    if (enabled && (query === 'stale' || query === 'error' || failure)) add('warning', failure || 'query_failed', 'Check the local CLI login and network, then refresh.');
    accounts.push({ account: index + 1, provider: profile.provider, monitored: enabled, cli, login, query,
      failure, lastSuccessMinutesAgo: enabled && Number.isFinite(saved?.fetchedAt) ? Math.max(0, Math.floor((now - saved.fetchedAt) / 60000)) : null,
      windowsMinutes: enabled ? [...new Set(generalWindows(saved).map((window) => window.minutes).filter(Number.isFinite))] : [] });
  }
  const catalog = await loadThemes(root);
  add(catalog.errors.length ? 'warning' : 'ok', catalog.errors.length ? 'theme_validation_failed' : 'themes_valid',
    catalog.errors.length ? 'Run launch.sh --themes --check locally for filenames and invalid fields.' : null);
  const selectedAvailable = catalog.themes.some((theme) => theme.id === prefs.theme);
  if (!selectedAvailable) add('warning', 'theme_selection_missing', 'Select an available appearance; the widget falls back to Bars.');
  return { version: 1, mode: 'offline', status: checks.some((check) => check.status === 'error') ? 'error' : checks.some((check) => check.status === 'warning') ? 'warning' : 'ok',
    discovery: { source: configured ? 'accounts_config' : 'herdr_and_cli', count: profiles.length, monitored: monitored.length },
    refreshMinutes: prefs.refreshMinutes, cache: compatible ? 'compatible' : 'unavailable', accounts,
    themes: { available: catalog.themes.length, invalid: catalog.errors.length, selectedAvailable }, checks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length > 2) throw new Error('Unsupported diagnostic argument');
    const report = await diagnose();
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'error' ? 2 : report.status === 'warning' ? 1 : 0;
  } catch { console.log(JSON.stringify({ version: 1, mode: 'offline', status: 'error', checks: [{ status: 'error', code: 'diagnostic_failed', action: 'Check local runtime and arguments; see AI.md.' }] })); process.exitCode = 2; }
}
