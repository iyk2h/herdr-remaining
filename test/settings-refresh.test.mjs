import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsBackup, restoreSettingsBackup } from '../mods/remaining/settings-format.mjs';
import { settingsBackup } from '../mods/remaining/settings-backup.mjs';
import { recommend, refreshForRecommendation, parseRecommendationArgs } from '../mods/remaining/recommend.mjs';
import { preferences, pollingPreferences } from '../mods/remaining/preferences.mjs';
import { loadProfiles } from '../mods/remaining/profiles.mjs';
import { snapshotKey, SNAPSHOT_VERSION } from '../mods/remaining/usage.mjs';

const profiles = [{ id: 'a', email: 'private@example.com', home: '/private/path', token: 'secret-token' }, { id: 'b' }];
test('settings backups round-trip only preferences and local IDs, without identities, credentials, paths or unknown fields', () => {
  const prefs = preferences({ refreshMinutes: 10, order: ['b', 'a'], disabledIds: ['a'], theme: 'rings' });
  const backup = createSettingsBackup({ ...prefs, token: 'secret-token' }, profiles);
  for (const secret of ['private@example.com', '/private/path', 'secret-token', 'token', 'home', 'email']) assert.equal(backup.includes(secret), false);
  assert.deepEqual(restoreSettingsBackup(backup, { profiles }).preferences, prefs);
});
test('restore ignores missing accounts, preserves a new account pause and order, and reports unavailable themes', () => {
  const backup = createSettingsBackup({ order: ['b', 'a'], disabledIds: ['a'], theme: 'custom' }, profiles);
  const restored = restoreSettingsBackup(backup, { current: { theme: 'rings', order: ['c', 'a'], disabledIds: ['c'] }, profiles: [{ id: 'a' }, { id: 'c' }] });
  assert.equal(restored.themeMissing, true);
  assert.equal(restored.ignoredAccounts, 1);
  assert.deepEqual(restored.preferences, { theme: 'rings', order: ['a', 'c'], disabledIds: ['a', 'c'], refreshMinutes: 5 });
});
test('malformed, oversized, unversioned and executable-looking backups are rejected before restore', () => {
  const good = JSON.parse(createSettingsBackup(null, profiles));
  const invalid = ['not json', 'x'.repeat(8193), '{}', JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({ ...good, run: ['arbitrary'] }), JSON.stringify({ ...good, accounts: ['a', 'a'] }),
    JSON.stringify({ ...good, preferences: { ...good.preferences, disabledIds: ['outside'] } }),
    JSON.stringify({ ...good, preferences: { ...good.preferences, refreshMinutes: -1 } }),
    JSON.stringify({ ...good, preferences: { ...good.preferences, command: 'arbitrary' } })];
  for (const value of invalid) assert.throws(() => restoreSettingsBackup(value, { profiles }));
});
test('restore preserves a paused account that is temporarily absent and rejects overflow instead of dropping pause choices', () => {
  const backup = createSettingsBackup(null, profiles);
  assert.deepEqual(restoreSettingsBackup(backup, { current: { disabledIds: ['absent'] }, profiles }).preferences.disabledIds, ['absent']);
  const many = Array.from({ length: 20 }, (_, index) => ({ id: `new-${index}` }));
  const full = createSettingsBackup({ disabledIds: many.map((profile) => profile.id) }, many);
  assert.throws(() => restoreSettingsBackup(full, { current: { disabledIds: ['absent'] }, profiles: many }));
});
test('refresh CLI accepts either argument order and rejects duplicate or unknown flags', () => {
  assert.deepEqual(parseRecommendationArgs(['--refresh', '--provider', 'codex']), { provider: 'codex', refresh: true });
  assert.deepEqual(parseRecommendationArgs(['--provider', 'claude', '--refresh']), { provider: 'claude', refresh: true });
  assert.deepEqual(parseRecommendationArgs([]), { provider: null, refresh: false });
  for (const args of [['--refresh', '--refresh'], ['--provider'], ['--provider', 'other'], ['--force'], ['--provider', 'codex', '--provider', 'claude']]) assert.throws(() => parseRecommendationArgs(args));
});
test('refresh waits for the existing collector lock and returns pending at a bounded deadline', async () => {
  let clock = 0;
  let calls = 0;
  const options = { clock: () => clock, sleep: async (ms) => { clock += ms; }, timeoutMs: 3000,
    run: async (_context, timeout) => { assert.ok(timeout > 0 && timeout <= 3000); return { accounts: [], pending: ++calls < 2 }; } };
  assert.equal(await refreshForRecommendation({}, options), 'completed');
  assert.equal(calls, 2);
  clock = 0;
  assert.equal(await refreshForRecommendation({}, { ...options, run: async () => ({ accounts: [], pending: true }) }), 'pending');
  assert.equal(clock, 3000);
  await assert.rejects(refreshForRecommendation({}, { run: async () => ({ accounts: [], error: 'private detail' }) }));
});

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'remaining-refresh-'));
  try {
    const appHome = join(root, 'app');
    await mkdir(join(appHome, 'data/remaining'), { recursive: true });
    await writeFile(join(root, 'accounts.json'), JSON.stringify([{ id: 'a', provider: 'codex', home: join(root, 'cli') }]));
    await writeFile(join(appHome, 'shared.json'), JSON.stringify({ unrelated: { keep: true }, 'remaining.preferences': { theme: 'rings', refreshMinutes: 5 } }));
    const rows = await loadProfiles(root, { appHome, home: root, env: {} });
    const cacheFile = join(appHome, 'data/remaining/usage.json');
    const cache = { version: SNAPSHOT_VERSION, configKey: snapshotKey(rows, pollingPreferences(null)), checkedAt: 1000,
      accounts: [{ ...rows[0], status: 'ok', fetchedAt: 1000, windows: [{ minutes: 10080, used: 80, resetAt: 9999999 }] }] };
    await writeFile(cacheFile, JSON.stringify(cache));
    await run({ root, appHome, home: root, env: {} }, { cache, cacheFile });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('refreshed recommendations re-read the persisted result and use the post-refresh clock', async () => {
  await fixture(async (options, { cache, cacheFile }) => {
    const result = await recommend({ ...options, refresh: true, provider: 'codex', clock: () => 10000, refreshCollector: async (context) => {
      assert.equal(context.prefs.theme, 'rings');
      cache.accounts[0].fetchedAt = 9000;
      cache.accounts[0].windows[0].used = 25;
      await writeFile(cacheFile, JSON.stringify(cache));
      return 'completed';
    } });
    assert.equal(result.mode, 'refresh');
    assert.equal(result.status, 'ok');
    assert.equal(result.providers.codex.accounts[0].minRemainingPercent, 75);
    assert.equal(result.providers.codex.recommendedId, 'a');
  });
});
test('a failed or pending requested refresh never recommends old cached values', async () => {
  await fixture(async (options) => {
    const failed = await recommend({ ...options, refresh: true, clock: () => 10000, refreshCollector: async () => { throw new Error('private token'); } });
    assert.equal(failed.reason, 'refresh_failed');
    assert.deepEqual(failed.providers, {});
    assert.equal(JSON.stringify(failed).includes('private token'), false);
    const pending = await recommend({ ...options, refresh: true, refreshCollector: async () => 'pending' });
    assert.equal(pending.reason, 'refresh_pending');
    assert.deepEqual(pending.providers, {});
  });
});
test('changed settings after refresh invalidate recommendation cache; an absent provider does not trigger collection', async () => {
  await fixture(async (options) => {
    const noAccount = await recommend({ ...options, refresh: true, provider: 'claude', refreshCollector: async () => { throw new Error('Should not run'); } });
    assert.equal(noAccount.refresh, 'skipped');
    const changed = await recommend({ ...options, refresh: true, clock: () => 10000, refreshCollector: async () => {
      await writeFile(join(options.appHome, 'shared.json'), JSON.stringify({ 'remaining.preferences': { refreshMinutes: 10 } }));
      return 'completed';
    } });
    assert.equal(changed.status, 'refresh_required');
    assert.equal(changed.providers.codex.recommendedId, null);
  });
});
test('CLI backup reads settings without rewriting Herdr state', async () => {
  await fixture(async (options) => {
    const file = join(options.appHome, 'shared.json');
    const before = await readFile(file, 'utf8');
    const backup = JSON.parse(await settingsBackup(options));
    assert.equal(backup.preferences.theme, 'rings');
    assert.equal(backup.format, 'herdr.remaining.settings');
    assert.equal(await readFile(file, 'utf8'), before);
  });
});
test('native backup/restore methods touch only Remaining preferences and leave invalid input unapplied', async () => {
  const source = (await readFile(new URL('../mods/remaining/main.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export default class Remaining', 'return class Remaining');
  const state = { 'remaining.preferences': { theme: 'bars', refreshMinutes: 5 }, 'remaining.snapshot': { profiles },
    'remaining.themes': { themes: [{ id: 'bars' }, { id: 'rings' }] }, unrelated: { keep: true } };
  const writes = [];
  let clipboard;
  const Widget = new Function('View', 'shared', 'setShared', 'createSettingsBackup', 'restoreSettingsBackup', source)(class {},
    (key) => state[key], (key, value) => { writes.push(key); state[key] = value; }, createSettingsBackup, restoreSettingsBackup);
  const widget = new Widget();
  const cx = { notify() {}, write_to_clipboard(text) { clipboard = text; }, read_from_clipboard() { return clipboard; } };
  widget.copySettings(cx);
  assert.equal(widget.backupState, 'copied');
  assert.deepEqual(writes, []);
  clipboard = createSettingsBackup({ theme: 'rings', refreshMinutes: 10, order: ['b', 'a'], disabledIds: ['a'] }, profiles);
  widget.restoreSettings(cx);
  assert.equal(widget.restoreState, 'restored');
  assert.deepEqual(writes, ['remaining.preferences']);
  assert.equal(state['remaining.preferences'].theme, 'rings');
  assert.deepEqual(state.unrelated, { keep: true });
  clipboard = 'invalid';
  widget.restoreSettings(cx);
  assert.equal(widget.restoreState, 'failed');
  assert.equal(writes.length, 1);
  widget.copyState = 'working';
  widget.copySettings(cx);
  widget.restoreSettings(cx);
  assert.equal(writes.length, 1);
});
