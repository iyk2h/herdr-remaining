const states = ['ok', 'warning', 'error'];
const codes = new Set(['node_runtime', 'preferences_unreadable', 'preferences_normalized', 'accounts_discovered', 'no_accounts',
  'account_discovery_failed', 'cache_invalid', 'refresh_required', 'refresh_due', 'codex_cli_missing', 'login_file_missing',
  'identity_changed', 'login_required', 'provider_rate_limited', 'query_timeout', 'cli_unavailable', 'limits_not_reported',
  'query_failed', 'theme_validation_failed', 'themes_valid', 'theme_selection_missing', 'diagnostic_failed']);
const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const count = (value, max = 1000000000) => Number.isInteger(value) && value >= 0 && value <= max ? value : null;

export function diagnosticsClipboard(report) {
  if (report?.version !== 1 || report.mode !== 'offline' || !states.includes(report.status) || !Array.isArray(report.checks)) throw new Error('Invalid diagnostic report');
  const safe = { version: 1, mode: 'offline', status: report.status };
  if (report.discovery) safe.discovery = { source: choice(report.discovery.source, ['accounts_config', 'herdr_and_cli'], 'unknown'),
    count: count(report.discovery.count, 20), monitored: count(report.discovery.monitored, 20) };
  if (report.refreshMinutes !== undefined) safe.refreshMinutes = choice(report.refreshMinutes, [1, 5, 10, 15], null);
  if (report.cache !== undefined) safe.cache = choice(report.cache, ['compatible', 'unavailable'], 'unavailable');
  if (Array.isArray(report.accounts)) safe.accounts = report.accounts.slice(0, 20).map((account) => ({
    account: count(account?.account, 20), provider: choice(account?.provider, ['claude', 'codex'], 'unknown'), monitored: account?.monitored === true,
    cli: choice(account?.cli, ['available', 'missing', 'not_checked'], 'not_checked'),
    login: choice(account?.login, ['paused', 'file_present_not_verified', 'keychain_not_checked', 'file_missing'], 'not_checked'),
    query: choice(account?.query, ['paused', 'ok', 'stale', 'error', 'checking', 'not_checked'], 'not_checked'),
    failure: codes.has(account?.failure) ? account.failure : account?.failure ? 'query_failed' : null,
    lastSuccessMinutesAgo: count(account?.lastSuccessMinutesAgo),
    windowsMinutes: Array.isArray(account?.windowsMinutes) ? account.windowsMinutes.filter((value) => count(value, 525600) !== null && value > 0).slice(0, 20) : [],
  }));
  if (report.themes) safe.themes = { available: count(report.themes.available, 52), invalid: count(report.themes.invalid, 1000), selectedAvailable: report.themes.selectedAvailable === true };
  safe.checks = report.checks.slice(0, 100).map((check) => ({ status: choice(check?.status, states, 'error'), code: codes.has(check?.code) ? check.code : 'diagnostic_failed' }));
  return JSON.stringify(safe, null, 2);
}
