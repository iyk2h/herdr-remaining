import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pollingPreferences } from './preferences.mjs';
import { orderedAccounts } from './preferences.mjs';
import { generalWindows, remaining } from './presentation.mjs';
import { localAccountState } from './local-state.mjs';
import { modelKey } from './normalize.mjs';

const PROVIDERS = ['claude', 'codex'];
const needsRefresh = new Set(['refresh_required', 'stale', 'query_failed', 'reset_pending', 'unknown_limits']);
const preferencesUsable = ({ stored, preferencesValid }) => !['invalid', 'unreadable'].includes(stored.state) && preferencesValid;
const exec = promisify(execFile);

async function runCollector(context, timeout) {
  const result = await exec(process.execPath, [join(context.root, 'usage.mjs'), '--preferences', JSON.stringify(pollingPreferences(context.prefs)), '--refresh'], {
    env: { ...process.env, HERDR_APP_HOME: context.appHome }, timeout, maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

export async function refreshForRecommendation(context, { run = runCollector, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = Date.now, timeoutMs = 90000 } = {}) {
  const deadline = clock() + timeoutMs;
  for (let attempt = 0; attempt < 90 && clock() < deadline; attempt++) {
    const snapshot = await run(context, Math.max(1, Math.min(85000, deadline - clock())));
    if (!snapshot || !Array.isArray(snapshot.accounts) || snapshot.error) throw new Error('Refresh failed');
    if (!snapshot.pending) return 'completed';
    if (clock() < deadline) await sleep(Math.min(1000, deadline - clock()));
  }
  return 'pending';
}

export function parseRecommendationArgs(args) {
  let provider = null;
  let refresh = false;
  let model = null;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--refresh' && !refresh) refresh = true;
    else if (args[index] === '--provider' && provider === null && PROVIDERS.includes(args[index + 1])) provider = args[++index];
    else if (args[index] === '--model' && model === null && modelKey(args[index + 1]) && !args[index + 1].startsWith('--')) model = modelKey(args[++index]);
    else throw new Error('Invalid recommendation arguments');
  }
  return { provider, refresh, ...(model ? { model } : {}) };
}

export function rankAccounts({ profiles, prefs, cache, compatible, now, model = null }) {
  const target = modelKey(model);
  const accounts = orderedAccounts(profiles, prefs.order).map((profile, order) => {
    const saved = compatible ? cache?.accounts?.find((row) => row.id === profile.id && row.source === profile.source) : null;
    const general = generalWindows(saved);
    const selected = target ? (saved?.windows ?? []).filter((window) => window.scoped && Array.isArray(window.modelKeys)
      && window.modelKeys.some((key) => modelKey(key) === target) && Number.isFinite(window.used) && window.used >= 0) : [];
    const windows = [...general, ...selected];
    const limits = windows.map((window) => ({ minutes: Number.isFinite(window.minutes) ? window.minutes : null,
      remainingPercent: remaining(window), resetAt: Number.isFinite(window.resetAt) ? window.resetAt : null,
      ...(target ? { scope: window.scoped ? 'model' : 'general' } : {}) }));
    let state = 'eligible';
    if (prefs.disabledIds.includes(profile.id)) state = 'paused';
    else if (!saved) state = 'refresh_required';
    else if (saved.status !== 'ok' || saved.error) state = 'query_failed';
    else if (!Number.isFinite(saved.fetchedAt) || saved.fetchedAt > now || now - saved.fetchedAt >= prefs.refreshMinutes * 60000) state = 'stale';
    else if (saved.ordinaryUsageAllowed === false) state = 'usage_blocked';
    else if (windows.some((window) => Number.isFinite(window.resetAt) && window.resetAt <= now)) state = 'reset_pending';
    else if (windows.some((window) => remaining(window) === 0)) state = 'exhausted';
    else if (!general.length || (saved.windows ?? []).some((window) => !window.scoped && (!Number.isFinite(window.used) || window.used < 0))) state = 'unknown_limits';
    else if (target && !selected.length) state = 'model_limits_unavailable';
    const headroom = limits.length ? Math.min(...limits.map((limit) => limit.remainingPercent)) : null;
    const limitingReset = limits.filter((limit) => limit.remainingPercent === headroom && limit.resetAt > now).map((limit) => limit.resetAt);
    return { id: profile.id, provider: profile.provider, state, ...(target ? { modelCoverage: selected.length ? 'reported' : 'not_reported' } : {}),
      minRemainingPercent: state === 'paused' ? null : headroom,
      lastSuccessAt: state !== 'paused' && Number.isFinite(saved?.fetchedAt) ? saved.fetchedAt : null,
      limits: state === 'paused' ? [] : limits, order, limitingReset: limitingReset.length ? Math.min(...limitingReset) : Infinity };
  });
  const providers = {};
  for (const provider of [...new Set(profiles.map((profile) => profile.provider))]) {
    const group = accounts.filter((account) => account.provider === provider);
    const eligible = group.filter((account) => account.state === 'eligible').sort((a, b) =>
      b.minRemainingPercent - a.minRemainingPercent || a.limitingReset - b.limitingReset || a.order - b.order);
    providers[provider] = { recommendedId: eligible[0]?.id ?? null, eligibleIds: eligible.map((account) => account.id),
      refreshRequired: group.some((account) => needsRefresh.has(account.state)),
      accounts: group.map(({ order, limitingReset, ...account }) => account) };
  }
  return providers;
}

export async function recommend({ provider = null, model = null, refresh = false, now, clock = Date.now, refreshCollector = refreshForRecommendation, ...options } = {}) {
  if (provider !== null && !PROVIDERS.includes(provider)) throw new Error('Use claude or codex');
  if (model !== null && !modelKey(model)) throw new Error('Invalid model');
  let context = await localAccountState(options);
  const mode = refresh ? 'refresh' : 'offline';
  if (context.discoveryFailed || !preferencesUsable(context)) {
    return { version: 1, mode, status: 'error', reason: context.discoveryFailed ? 'account_discovery_failed' : 'preferences_unreadable', providers: {} };
  }
  let refreshState = 'skipped';
  if (refresh && context.profiles.some((profile) => (!provider || profile.provider === provider) && !context.prefs.disabledIds.includes(profile.id))) {
    try { refreshState = await refreshCollector(context); }
    catch { return { version: 1, mode, status: 'refresh_required', reason: 'refresh_failed', providers: {} }; }
    if (refreshState !== 'completed') return { version: 1, mode, status: 'refresh_required', reason: 'refresh_pending', providers: {} };
    context = await localAccountState(options);
    if (context.discoveryFailed || !preferencesUsable(context)) return { version: 1, mode, status: 'error', reason: 'settings_changed_during_refresh', providers: {} };
  }
  const profiles = provider ? context.profiles.filter((profile) => profile.provider === provider) : context.profiles;
  const providers = rankAccounts({ profiles, prefs: context.prefs, cache: context.cache.value, compatible: context.compatible, now: now ?? clock(), model });
  if (provider && !providers[provider]) providers[provider] = { recommendedId: null, eligibleIds: [], refreshRequired: false, accounts: [] };
  const groups = Object.values(providers);
  return { version: 1, mode, ...(refresh ? { refresh: refreshState } : {}), scope: model ? 'reported_general_and_model_limits' : 'reported_general_limits',
    status: groups.some((group) => group.recommendedId) ? 'ok' : groups.some((group) => group.refreshRequired) ? 'refresh_required'
      : model && groups.some((group) => group.accounts.some((account) => account.state === 'model_limits_unavailable')) ? 'model_limits_unavailable' : 'no_available_account',
    policy: 'highest_minimum_remaining_then_earliest_limiting_reset_then_saved_order',
    refreshMinutes: context.prefs.refreshMinutes, providers };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const report = await recommend(parseRecommendationArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'error' ? 2 : report.status === 'ok' ? 0 : 1;
  } catch { console.log(JSON.stringify({ version: 1, mode: 'offline', status: 'error', reason: 'recommendation_failed', providers: {} })); process.exitCode = 2; }
}
