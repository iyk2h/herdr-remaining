import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rankAccounts, recommend } from '../mods/remaining/recommend.mjs';
import { diagnosticsClipboard } from '../mods/remaining/diagnostic-report.mjs';
import { loadProfiles } from '../mods/remaining/profiles.mjs';
import { preferences, pollingPreferences } from '../mods/remaining/preferences.mjs';
import { snapshotKey, SNAPSHOT_VERSION } from '../mods/remaining/usage.mjs';

const now = 1000000;
const profile = (id, provider = 'codex') => ({ id, provider, source: `source-${id}` });
const window = (minutes, left, resetAt = now + 60000, scoped = false) => ({ minutes, used: 100 - left, resetAt, scoped });
const saved = (id, windows, extra = {}) => ({ id, source: `source-${id}`, status: 'ok', fetchedAt: now - 1000, windows, ...extra });
function rank(rows, prefs = {}, profiles = rows.map((row) => profile(row.id))) {
  return rankAccounts({ profiles, prefs: preferences(prefs), cache: { accounts: rows }, compatible: true, now });
}
test('a spent five-hour quota excludes an account even when its weekly quota has room', () => {
  const result = rank([saved('spent', [window(300, 0), window(10080, 90)]), saved('weekly', [window(10080, 50)])]);
  assert.equal(result.codex.recommendedId, 'weekly');
  assert.equal(result.codex.accounts[0].state, 'exhausted');
  assert.equal(result.codex.accounts[1].state, 'eligible');
});
test('recommendations use the smallest reported general allowance and keep a small positive amount eligible', () => {
  const result = rank([saved('short', [window(300, 15), window(10080, 90)]),
    saved('weekly', [window(10080, 45), window(300, 0, now + 60000, true)]), saved('tiny', [window(300, 0.2)])]);
  assert.deepEqual(result.codex.eligibleIds, ['weekly', 'short', 'tiny']);
  assert.equal(result.codex.accounts[2].state, 'eligible');
});
test('stale, future-dated, failed, changed-identity and reset-pending accounts require a fresh query', () => {
  const rows = [saved('stale', [window(10080, 90)], { fetchedAt: now - 300000 }), saved('future', [window(10080, 90)], { fetchedAt: now + 1 }),
    saved('failed', [window(10080, 90)], { status: 'stale', error: 'private-token' }), saved('changed', [window(10080, 90)], { source: 'other' }),
    saved('pending', [window(10080, 0, now - 1)])];
  const result = rank(rows).codex;
  assert.equal(result.recommendedId, null);
  assert.equal(result.refreshRequired, true);
  assert.deepEqual(result.accounts.map((account) => account.state), ['stale', 'stale', 'query_failed', 'refresh_required', 'reset_pending']);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});
test('paused, explicitly blocked and unknown quota states are not recommended', () => {
  const result = rank([saved('paused', [window(10080, 80)]), saved('blocked', [window(10080, 90)], { ordinaryUsageAllowed: false }),
    saved('missing', []), saved('invalid', [{ minutes: 300, used: -1 }])], { disabledIds: ['paused'] }).codex;
  assert.equal(result.recommendedId, null);
  assert.deepEqual(result.accounts.map((account) => account.state), ['paused', 'usage_blocked', 'unknown_limits', 'unknown_limits']);
  assert.deepEqual(result.accounts[0].limits, []);
});
test('equal headroom uses the limiting reset, then saved order, and never mutates the input', () => {
  const rows = [saved('later', [window(300, 40, now + 120000), window(10080, 80, now + 1000)]),
    saved('first', [window(300, 40, now + 60000)]), saved('second', [window(10080, 40, now + 60000)])];
  const before = structuredClone(rows);
  const result = rank(rows, { order: ['second', 'first', 'later'] }).codex;
  assert.deepEqual(result.eligibleIds, ['second', 'first', 'later']);
  assert.deepEqual(rows, before);
});
test('incompatible cache cannot produce a recommendation', () => {
  const result = rankAccounts({ profiles: [profile('a')], prefs: preferences(null), cache: { accounts: [saved('a', [window(10080, 90)])] }, compatible: false, now });
  assert.equal(result.codex.recommendedId, null);
  assert.equal(result.codex.accounts[0].state, 'refresh_required');
});

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'remaining-recommend-'));
  try {
    const appHome = join(root, 'app');
    await mkdir(join(appHome, 'data/remaining'), { recursive: true });
    await writeFile(join(root, 'accounts.json'), JSON.stringify([{ id: 'claude', provider: 'claude', home: join(root, 'claude') },
      { id: 'work', provider: 'codex', home: join(root, 'work'), expectedEmail: 'private@example.com' },
      { id: 'personal', provider: 'codex', home: join(root, 'personal') }]));
    await writeFile(join(appHome, 'shared.json'), JSON.stringify({ 'remaining.preferences': { refreshMinutes: 5 } }));
    const profiles = await loadProfiles(root, { appHome, home: root, env: {} });
    const cacheFile = join(appHome, 'data/remaining/usage.json');
    const cache = { version: SNAPSHOT_VERSION, configKey: snapshotKey(profiles, pollingPreferences(null)), checkedAt: now,
      accounts: profiles.map((p, index) => ({ ...p, email: 'private@example.com', status: 'ok', fetchedAt: now - 1000,
        windows: [window(10080, [30, 60, 10][index], now + 60000)] })) };
    await writeFile(cacheFile, JSON.stringify(cache));
    await run({ root, appHome, home: root, env: {}, now }, { cache, cacheFile });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('offline recommendations group providers and filter without reading credentials, using the network or changing state', async () => {
  await fixture(async (options, { cacheFile }) => {
    const fetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('No network permitted'); };
    try {
      const before = await readFile(cacheFile, 'utf8');
      const result = await recommend(options);
      assert.equal(result.providers.claude.recommendedId, 'claude');
      assert.equal(result.providers.codex.recommendedId, 'work');
      const filtered = await recommend({ ...options, provider: 'codex' });
      assert.deepEqual(Object.keys(filtered.providers), ['codex']);
      for (const privateValue of ['private@example.com', options.root, 'expectedEmail', 'keychainService', 'codexBin']) assert.equal(JSON.stringify(result).includes(privateValue), false);
      assert.equal(await readFile(cacheFile, 'utf8'), before);
    } finally { globalThis.fetch = fetch; }
  });
});
test('invalid paused-account preferences and malformed discovery config fail without a recommendation', async () => {
  await fixture(async (options) => {
    await writeFile(join(options.appHome, 'shared.json'), JSON.stringify({ 'remaining.preferences': { disabledIds: 'work' } }));
    let result = await recommend(options);
    assert.equal(result.status, 'error');
    assert.deepEqual(result.providers, {});
    await writeFile(join(options.root, 'accounts.json'), '{');
    result = await recommend(options);
    assert.equal(result.reason, 'account_discovery_failed');
  });
});
test('clipboard reports strip identities, amounts, paths, raw messages and unknown fields even from malformed extensions', () => {
  const secret = 'private@example.com secret-token /private/path';
  const report = { version: 1, mode: 'offline', status: 'warning', secret,
    accounts: [{ account: 1, provider: 'codex', monitored: true, query: 'ok', failure: secret, email: secret, home: secret, remainingPercent: 42, windowsMinutes: [300, 10080] }],
    checks: [{ status: 'warning', code: 'query_failed', action: secret }, { status: 'error', code: secret }] };
  const copied = diagnosticsClipboard(report);
  assert.equal(copied.includes(secret), false);
  assert.equal(copied.includes('remainingPercent'), false);
  assert.equal(JSON.parse(copied).accounts[0].failure, 'query_failed');
  assert.equal(JSON.parse(copied).checks[1].code, 'diagnostic_failed');
  for (const status of ['ok', 'warning', 'error']) assert.equal(JSON.parse(diagnosticsClipboard({ version: 1, mode: 'offline', status, checks: [] })).status, status);
  assert.throws(() => diagnosticsClipboard({ accounts: [], error: secret }));
});
test('recommendation CLI rejects invalid provider flags without echoing arguments', async () => {
  const exec = promisify(execFile);
  await assert.rejects(exec(process.execPath, [new URL('../mods/remaining/recommend.mjs', import.meta.url).pathname, '--provider', 'private-secret']), (error) => {
    assert.equal(error.code, 2);
    assert.equal(error.stdout.includes('private-secret'), false);
    assert.equal(JSON.parse(error.stdout).status, 'error');
    return true;
  });
});

async function copyHarness(exec) {
  const source = (await readFile(new URL('../mods/remaining/main.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default class Remaining', 'return class Remaining');
  const Widget = new Function('View', 'exec', 'appHome', 'diagnosticsClipboard', source)(class {}, exec, () => '/synthetic', diagnosticsClipboard);
  const widget = new Widget();
  widget.copyState = 'idle';
  const copied = [];
  const tasks = [];
  const cx = { notify() {}, spawn(job) { tasks.push(job(cx)); }, write_to_clipboard(text) { copied.push(text); } };
  return { widget, copied, tasks, cx };
}
test('the real copy handler copies warning/error reports despite nonzero diagnostic exit codes', async () => {
  for (const [code, status] of [[1, 'warning'], [2, 'error']]) {
    const { widget, copied, tasks, cx } = await copyHarness(async (command, args) => {
      assert.equal(command, '/bin/sh');
      assert.equal(args.at(-1), '--diagnose');
      return { code, stdout: JSON.stringify({ version: 1, mode: 'offline', status, checks: [], email: 'private@example.com' }) };
    });
    widget.copyDiagnostics(cx);
    await Promise.all(tasks);
    assert.equal(widget.copyState, 'copied');
    assert.equal(JSON.parse(copied[0]).status, status);
    assert.equal(copied[0].includes('private@example.com'), false);
  }
});
test('copy failure preserves the clipboard and the real handler ignores a second click while working', async () => {
  let finish;
  let calls = 0;
  const { widget, copied, tasks, cx } = await copyHarness(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  widget.copyDiagnostics(cx);
  widget.copyDiagnostics(cx);
  assert.equal(widget.copyState, 'working');
  assert.equal(calls, 1);
  finish({ code: 1, stdout: 'private malformed output' });
  await Promise.all(tasks);
  assert.equal(widget.copyState, 'failed');
  assert.deepEqual(copied, []);
});
