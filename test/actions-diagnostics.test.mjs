import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usagePage, refreshFeedback, refreshResult } from '../mods/remaining/account-actions.mjs';
import { diagnose, queryFailure } from '../mods/remaining/diagnose.mjs';
import { loadProfiles } from '../mods/remaining/profiles.mjs';
import { snapshotKey, SNAPSHOT_VERSION } from '../mods/remaining/usage.mjs';
import { pollingPreferences } from '../mods/remaining/preferences.mjs';

test('usage links are fixed official destinations and never accept a configured URL', () => {
  assert.equal(usagePage('codex'), 'https://chatgpt.com/codex/settings/usage');
  assert.equal(usagePage('claude'), 'https://claude.ai/settings/usage');
  for (const input of [null, undefined, '__proto__', 'constructor', 'https://example.com', 'javascript:alert(1)']) assert.equal(usagePage(input), null);
});
test('refresh feedback distinguishes pending, failed and partially failed updates without changing saved values', () => {
  const accounts = [{ status: 'ok', windows: [{ used: 42 }] }, { status: 'stale', error: 'Offline', windows: [{ used: 75 }] }];
  const before = structuredClone(accounts);
  assert.equal(refreshFeedback({ busy: true, error: 'Offline', accounts }).kind, 'refreshing');
  assert.equal(refreshFeedback({ error: 'Offline', accounts }).kind, 'error');
  assert.equal(refreshFeedback({ accounts }).kind, 'warning');
  assert.match(refreshFeedback({ accounts }).message, /1 account update failed/);
  assert.equal(refreshFeedback({ accounts: [accounts[0]] }).kind, 'idle');
  assert.deepEqual(accounts, before);
});

test('a collector setup failure keeps the last snapshot, but a provider identity failure replaces its old values', () => {
  const previous = { accounts: [{ id: 'a', windows: [{ minutes: 10080, used: 42 }], fetchedAt: 1000 }] };
  const failed = refreshResult(previous, { accounts: [], error: 'Setup failed' });
  assert.equal(failed.data, previous);
  assert.equal(failed.error, 'Setup failed');
  assert.equal(failed.data.accounts[0].fetchedAt, 1000);
  const changedIdentity = { accounts: [{ id: 'a', status: 'error', error: 'Account changed', windows: [] }] };
  assert.equal(refreshResult(previous, changedIdentity).data, changedIdentity);
  assert.throws(() => refreshResult(previous, { error: 'Malformed' }));
});

async function fixture(run, prefs = {}) {
  const root = await mkdtemp(join(tmpdir(), 'remaining-diagnose-'));
  try {
    const appHome = join(root, 'app');
    const cliHome = join(root, 'cli');
    await mkdir(join(appHome, 'data/remaining'), { recursive: true });
    await mkdir(cliHome);
    await mkdir(join(root, 'themes'));
    await writeFile(join(root, 'accounts.json'), JSON.stringify([{ id: 'private-account', provider: 'codex', label: 'private@example.com', expectedEmail: 'private@example.com', home: cliHome }]));
    await writeFile(join(cliHome, 'auth.json'), 'synthetic-private-token-do-not-read');
    await writeFile(join(appHome, 'shared.json'), JSON.stringify({ 'remaining.preferences': prefs, unrelated: 'private@example.com' }));
    const profiles = await loadProfiles(root, { appHome, home: root, env: {} });
    const cacheFile = join(appHome, 'data/remaining/usage.json');
    const cache = { version: SNAPSHOT_VERSION, configKey: snapshotKey(profiles, pollingPreferences(prefs)), checkedAt: 1000,
      accounts: [{ ...profiles[0], email: 'private@example.com', status: 'ok', fetchedAt: 1000, windows: [{ used: 31.2345, minutes: 10080 }] }] };
    await writeFile(cacheFile, JSON.stringify(cache));
    await run({ root, appHome, home: root, env: {}, now: 2000, findCodex: async () => '/synthetic/codex' }, { cache, cacheFile, cliHome });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('offline diagnostics report discovery, query and themes without credentials, identities, paths or network calls', async () => {
  await fixture(async (options, { cacheFile }) => {
    const fetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('Diagnostics must be offline'); };
    try {
      const before = await readFile(cacheFile, 'utf8');
      const result = await diagnose(options);
      assert.equal(result.status, 'ok');
      assert.equal(result.mode, 'offline');
      assert.deepEqual(result.discovery, { source: 'accounts_config', count: 1, monitored: 1 });
      assert.equal(result.accounts[0].login, 'file_present_not_verified');
      assert.deepEqual(result.accounts[0].windowsMinutes, [10080]);
      const output = JSON.stringify(result);
      for (const secret of ['private@example.com', 'private-account', 'synthetic-private-token', options.root, '31.2345', 'expectedEmail']) assert.equal(output.includes(secret), false);
      assert.equal(await readFile(cacheFile, 'utf8'), before);
    } finally { globalThis.fetch = fetch; }
  });
});
test('diagnostics turn untrusted query errors and invalid theme filenames into static codes', async () => {
  await fixture(async (options, { cache, cacheFile }) => {
    cache.accounts[0].status = 'stale';
    cache.accounts[0].error = 'private@example.com token=private-secret login expired';
    await writeFile(cacheFile, JSON.stringify(cache));
    await writeFile(join(options.root, 'themes/private@example.com.json'), '{');
    const result = await diagnose(options);
    assert.equal(result.status, 'warning');
    assert.equal(result.accounts[0].failure, 'login_required');
    assert.equal(result.themes.invalid, 1);
    assert.equal(JSON.stringify(result).includes('private@example.com'), false);
    assert.equal(JSON.stringify(result).includes('private-secret'), false);
    assert.ok(result.checks.some((check) => check.code === 'theme_validation_failed'));
  });
});
test('paused accounts do not run CLI readiness checks or report their cached errors as active failures', async () => {
  await fixture(async (options, { cache, cacheFile }) => {
    cache.accounts[0].status = 'error';
    cache.accounts[0].error = 'Offline';
    await writeFile(cacheFile, JSON.stringify(cache));
    const result = await diagnose({ ...options, findCodex: () => { throw new Error('Should not run'); } });
    assert.equal(result.status, 'ok');
    assert.equal(result.accounts[0].query, 'paused');
    assert.equal(result.accounts[0].failure, null);
  }, { disabledIds: ['private-account'] });
});
test('changed cache identity and malformed account config are reported without pretending to have a valid query', async () => {
  await fixture(async (options, { cache, cacheFile }) => {
    cache.accounts[0].source = 'changed';
    await writeFile(cacheFile, JSON.stringify(cache));
    let result = await diagnose(options);
    assert.equal(result.accounts[0].query, 'not_checked');
    assert.equal(result.status, 'warning');
    await writeFile(join(options.root, 'accounts.json'), '{');
    result = await diagnose(options);
    assert.equal(result.status, 'error');
    assert.ok(result.checks.some((check) => check.code === 'account_discovery_failed'));
  });
});
test('query failure classification never returns a provider message', () => {
  assert.equal(queryFailure('Account changed during refresh'), 'identity_changed');
  assert.equal(queryFailure('Provider rate limit; retrying shortly'), 'provider_rate_limited');
  assert.equal(queryFailure('Codex request timed out'), 'query_timeout');
  assert.equal(queryFailure('private arbitrary string'), 'query_failed');
});
test('invalid saved preferences and unavailable executable produce actionable diagnostic warnings', async () => {
  await fixture(async (options) => {
    const result = await diagnose({ ...options, findCodex: async () => { throw new Error('private path'); } });
    assert.equal(result.status, 'warning');
    assert.equal(result.refreshMinutes, 5);
    assert.ok(result.checks.some((check) => check.code === 'preferences_normalized'));
    assert.ok(result.checks.some((check) => check.code === 'codex_cli_missing'));
    assert.equal(JSON.stringify(result).includes('private path'), false);
  }, { refreshMinutes: -1 });
});
