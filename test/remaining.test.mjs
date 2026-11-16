import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProfiles, loadProfiles } from '../mods/remaining/profiles.mjs';
import { codexWindows, claudeWindows, failedAccount } from '../mods/remaining/normalize.mjs';
import { amount, remaining, quotaTone, quotaPair, quotaColumns, quotaDescription, rowMetrics, resetLabel, resetSummary, shortAge } from '../mods/remaining/presentation.mjs';
import { DEFAULT_THEMES } from '../mods/remaining/theme-format.mjs';
import { nextRefreshAt, REFRESH_MS, RETRY_MS } from '../mods/remaining/refresh-policy.mjs';
import { preferences, pollingPreferences, enabledProfiles, orderedAccounts, moveAccount } from '../mods/remaining/preferences.mjs';
import { collectProfiles, UsageError, codex, claude } from '../mods/remaining/usage.mjs';
import { profileFromProgram } from '../mods/remaining/discovery.mjs';

const profiles = (entries) => normalizeProfiles(entries, '/example', {});
const profile = profiles([{ id: 'test', provider: 'codex', expectedEmail: 'test@example.com' }])[0];
const old = { id: 'test', source: profile.source, email: 'test@example.com', windows: [{ used: 40 }], fetchedAt: 1000 };

test('profiles expand portable paths and support multiple subscription accounts', () => {
  const rows = profiles([{ id: 'work', provider: 'codex', home: '~/.codex-work' }, { id: 'personal', provider: 'codex' }, { id: 'claude', provider: 'claude' }]);
  assert.equal(rows[0].home, '/example/.codex-work');
  assert.equal(rows[1].home, '/example/.codex');
  assert.equal(rows[2].metadata, '/example/.claude.json');
  assert.notEqual(rows[0].source, rows[1].source);
});
test('invalid and duplicate profiles are rejected instead of silently monitoring the wrong login', () => {
  for (const value of [null, [{ id: 'a', provider: 'other' }], [{ id: 'a', provider: 'codex', home: 'relative' }],
    [{ id: 'a', provider: 'codex' }, { id: 'a', provider: 'claude' }]]) assert.throws(() => profiles(value));
});
test('changing the provider, home or expected identity invalidates the cache source', () => {
  for (const patch of [{ provider: 'claude' }, { home: '~/.codex-other' }, { expectedEmail: 'other@example.com' }]) {
    assert.notEqual(profiles([{ id: 'test', provider: 'codex', expectedEmail: 'test@example.com', ...patch }])[0].source, profile.source);
  }
});
test('Herdr agents are discovered for a missing config; malformed JSON never falls back silently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remaining-config-'));
  try {
    const options = { appHome: dir, home: dir, env: {} };
    assert.equal((await loadProfiles(dir, options)).length, 0);
    await writeFile(join(dir, 'programs.json'), JSON.stringify({ programs: {
      work: { name: 'Work · Codex', run: ['/usr/bin/env', `CODEX_HOME=${dir}/.codex-work`, '/usr/local/bin/codex'] },
    } }));
    const discovered = await loadProfiles(dir, options);
    assert.equal(discovered[0].label, 'Work · Codex');
    assert.equal(discovered[0].home, `${dir}/.codex-work`);
    await writeFile(join(dir, 'accounts.json'), '[');
    await assert.rejects(loadProfiles(dir, options), /JSON syntax/);
    await writeFile(join(dir, 'accounts.json'), '[]');
    assert.deepEqual(await loadProfiles(dir, options), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('agent discovery never executes shell wrappers or copies other environment variables', () => {
  const row = profileFromProgram('work', { name: 'Work', run: ['/usr/bin/env', 'PRIVATE_TOKEN=synthetic-private', 'CODEX_HOME=~/.codex-work', '/opt/homebrew/bin/codex', '--model', 'example'] });
  assert.equal(row.home, '~/.codex-work');
  assert.equal(row.codexBin, '/opt/homebrew/bin/codex');
  assert.equal(JSON.stringify(row).includes('synthetic-private'), false);
  assert.equal(profileFromProgram('shell', { run: ['/bin/sh', '-c', 'codex'] }), null);
  assert.equal(profileFromProgram('other', { run: ['other-agent'] }), null);
});
test('a registered account keeps its name and is deduplicated against the default CLI home', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remaining-dedupe-'));
  try {
    await mkdir(join(dir, '.codex'));
    await writeFile(join(dir, '.codex/auth.json'), '{}');
    await writeFile(join(dir, 'programs.json'), JSON.stringify({ programs: { personal: { name: 'Personal · Codex', run: ['codex'] } } }));
    const rows = await loadProfiles(dir, { appHome: dir, home: dir, env: {} });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, 'Personal · Codex');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Codex weekly primary and a real zero are preserved; mirrored buckets are not repeated', () => {
  const rows = codexWindows({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1000 } },
    review: { limitName: 'Review', primary: { usedPercent: 25, windowDurationMins: 300 } },
  } });
  assert.deepEqual(rows.map((r) => [r.label, r.used, r.scoped]), [['Weekly', 0, false], ['Review · 5-hour', 25, true]]);
  assert.equal(rows[0].resetAt, 1000000);
});
test('Claude missing, inactive and invalid quotas stay absent', () => {
  const rows = claudeWindows({ five_hour: null, seven_day: { utilization: 0 }, limits: [
    { kind: 'weekly_scoped', percent: 80, is_active: false },
    { kind: 'weekly_scoped', percent: 60, is_active: true, scope: { model: { display_name: 'Sonnet' } } },
  ] });
  assert.deepEqual(rows.map((r) => [r.label, r.used]), [['Weekly', 0], ['Sonnet · Weekly', 60]]);
  assert.deepEqual(claudeWindows({ seven_day: { utilization: '0' } }), []);
  assert.deepEqual(codexWindows({ rateLimits: { primary: { usedPercent: -1 } } }), []);
});
test('main row chooses the general weekly window and clamps only the displayed remainder', () => {
  const windows = [{ used: 80, minutes: 10080, scoped: true }, { used: 40, minutes: 300 }, { used: 25, minutes: 10080 }];
  assert.equal(quotaPair({ windows }).weekly, windows[2]);
  assert.equal(amount(quotaPair({ windows }).weekly), '75%');
  assert.equal(remaining({ used: 120 }), 0);
  assert.equal(amount(null), '—');
});
test('only reported general windows occupy columns, including exhausted and cached short limits', () => {
  const show = { short: true, weekly: true };
  const weekly = { windows: [{ used: 40, minutes: 10080 }, { used: 10, minutes: 300, scoped: true }] };
  const short = { status: 'stale', windows: [{ used: 100, minutes: 300 }] };
  assert.deepEqual(quotaColumns([weekly], show), { short: false, weekly: true });
  assert.deepEqual(quotaColumns([weekly, short], show), { short: true, weekly: true });
  assert.deepEqual(quotaColumns([short], show), { short: true, weekly: false });
  assert.deepEqual(quotaColumns([weekly, short], { short: false, weekly: true }), { short: false, weekly: true });
  assert.deepEqual(quotaColumns([{ windows: [{ used: NaN, minutes: 300 }] }], show), { short: false, weekly: false });
  assert.deepEqual(quotaColumns([], show), { short: false, weekly: false });
});
test('a failed read never becomes a fresh zero or reuses an unverified account', () => {
  const stale = failedAccount(profile, old, 'Offline', 5000, 'test@example.com');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.fetchedAt, 1000);
  assert.equal(stale.checkedAt, 5000);
  for (const identity of [null, 'other@example.com']) {
    assert.deepEqual(failedAccount(profile, old, 'Failed', 5000, identity).windows, []);
  }
  assert.deepEqual(failedAccount({ ...profile, source: 'changed' }, old, 'Failed', 5000, 'test@example.com').windows, []);
});
test('a provider failure does not hide successful accounts or expose raw exception contents', async () => {
  const list = profiles([{ id: 'ok', provider: 'codex' }, { id: 'fail', provider: 'claude' }]);
  const rows = await collectProfiles(list, null, async (p) => {
    if (p.id === 'fail') throw new Error('private credential detail');
    return { email: 'demo@example.com', windows: [{ used: 20 }] };
  }, () => 42);
  assert.equal(rows[0].status, 'ok');
  assert.equal(rows[1].status, 'error');
  assert.equal(JSON.stringify(rows).includes('private credential detail'), false);
});
test('only a verified same-identity provider failure keeps earlier numbers', async () => {
  const [row] = await collectProfiles([profile], { accounts: [old] }, async () => { throw new UsageError('Offline', 'test@example.com'); }, () => 42);
  assert.equal(row.status, 'stale');
  assert.equal(row.fetchedAt, 1000);
});
test('refresh is anchored to the oldest provider fetch, including after panel recreation', () => {
  const snapshot = { checkedAt: 5000, accounts: [{ status: 'ok', fetchedAt: 1000 }, { status: 'ok', fetchedAt: 3000 }] };
  assert.equal(nextRefreshAt(snapshot, 241000), 301000);
  assert.equal(nextRefreshAt(snapshot, 301000), 301000);
  assert.equal(nextRefreshAt({ ...snapshot, refreshMs: 60000 }), 61000);
  assert.equal(nextRefreshAt({ checkedAt: 400000, accounts: [{ status: 'stale', fetchedAt: 1000 }] }), 400000 + RETRY_MS);
  assert.equal(nextRefreshAt({ checkedAt: 42, accounts: [] }), 42 + REFRESH_MS);
});
test('settings reject unsupported intervals and disabled accounts are not polled', () => {
  assert.deepEqual(preferences(null), { refreshMinutes: 5, disabledIds: [], order: [], theme: 'bars' });
  assert.equal(preferences({ refreshMinutes: 0 }).refreshMinutes, 5);
  const prefs = preferences({ refreshMinutes: 10, disabledIds: ['test', 'test', null] });
  assert.deepEqual(prefs, { refreshMinutes: 10, disabledIds: ['test'], order: [], theme: 'bars' });
  assert.deepEqual(enabledProfiles([profile], prefs), []);
});
test('manual order survives new and removed agents and moves one account at a time', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'new' }];
  assert.deepEqual(orderedAccounts(rows, ['b', 'removed', 'a']).map((a) => a.id), ['b', 'a', 'new']);
  const order = moveAccount(rows, ['b', 'a'], 'a', -1);
  assert.deepEqual(order, ['a', 'b', 'new']);
  assert.deepEqual(moveAccount(rows, order, 'a', -1), order);
  assert.deepEqual(preferences({ order: ['b', 'a', 'b'] }).order, ['b', 'a']);
});
test('changing display order never invalidates polling preferences or refreshes provider data', () => {
  assert.deepEqual(pollingPreferences({ order: ['a', 'b'] }), pollingPreferences({ order: ['b', 'a'] }));
  assert.deepEqual(pollingPreferences({ theme: 'bars' }), pollingPreferences({ theme: 'rings' }));
  assert.equal(preferences({ theme: 'compact' }).theme, 'compact');
  assert.equal(preferences({ theme: '../outside' }).theme, 'bars');
});
test('the two readouts use independent general quotas and never copy a weekly value into five hours', () => {
  const short = { used: 96, minutes: 300 };
  const weekly = { used: 40, minutes: 10080 };
  const scoped = { used: 100, minutes: 300, scoped: true };
  assert.deepEqual(quotaPair({ windows: [scoped, short, weekly] }), { short, weekly });
  assert.deepEqual(quotaPair({ windows: [weekly] }), { short: null, weekly });
  assert.deepEqual(quotaPair({ windows: [short] }), { short, weekly: null });
  assert.deepEqual(quotaPair({ windows: [scoped] }), { short: null, weekly: null });
});
test('a small positive allowance is not labelled exhausted', () => {
  assert.equal(amount({ used: 99.8 }), '<1%');
  assert.equal(quotaTone({ used: 99.8 }), 'working');
  assert.equal(amount({ used: 100 }), '0%');
  assert.equal(quotaTone({ used: 100 }), 'blocked');
});
test('a missing short quota has an explicit unavailable reason and never looks like a zero limit', () => {
  assert.equal(amount(null), '—');
  assert.equal(quotaDescription(null, '5h'), '5h limit · Not reported by provider');
  assert.equal(quotaDescription(null, '5h', 1000, 'Refresh failed'), '5h limit · Refresh failed');
  assert.equal(quotaTone(null), null);
  assert.notEqual(quotaDescription({ label: '5-hour', used: 100 }, '5h', 1000), quotaDescription(null, '5h'));
});
test('Bars and Rings reserve the same row height and numeric columns', () => {
  assert.deepEqual(rowMetrics(DEFAULT_THEMES[0]), rowMetrics(DEFAULT_THEMES[1]));
  const metrics = rowMetrics(DEFAULT_THEMES[0]);
  assert.ok(22 + 10 + 3 * metrics.row + 2 <= 132);
  assert.ok(metrics.row - DEFAULT_THEMES[0].sizes.rowPadding - metrics.bottom >= DEFAULT_THEMES[0].sizes.font + 13);
  assert.ok(metrics.bottom - DEFAULT_THEMES[0].sizes.bar >= 2);
  assert.ok(metrics.column >= DEFAULT_THEMES[1].sizes.ring);
});
test('visible reset summaries distinguish each window, unknown timestamps and pending resets', () => {
  const minute = 60000;
  const short = { resetAt: 65 * minute };
  const weekly = { resetAt: (3 * 1440 + 5 * 60) * minute };
  assert.equal(resetSummary({ short: null, weekly }, 0), '3d 5h');
  assert.equal(resetSummary({ short, weekly }, 0), '5h 1h 5m · 7d 3d 5h');
  assert.equal(resetSummary({ short: { resetAt: null }, weekly }, 0), '7d 3d 5h');
  assert.equal(resetSummary({ short: { resetAt: 0 }, weekly: null }, 1), 'Reset pending');
  assert.equal(resetSummary({ short: null, weekly: { resetAt: null } }, 0), null);
  assert.equal(resetSummary({ short: null, weekly: null }, 0), null);
  assert.equal(resetSummary({ short, weekly: null }, minute), '1h 4m');
});
test('relative dates use English and never change the fetched timestamp', () => {
  assert.equal(resetLabel(3 * 1440 * 60000 + 15 * 60 * 60000, 0), '3d 15h');
  assert.equal(resetLabel(0, 1000), 'Reset pending');
  assert.equal(shortAge(1000, 301000), '5m ago');
  assert.equal(shortAge(null, 301000), '—');
});
test('Codex integration only sends account RPCs and rejects a login change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remaining-rpc-'));
  try {
    const bin = join(dir, 'codex');
    await writeFile(bin, `#!${process.execPath}\nimport('node:readline').then(({createInterface}) => {\nlet reads = 0;\nconst methods = [];\ncreateInterface({ input: process.stdin }).on('line', line => {\n const r = JSON.parse(line); methods.push(r.method);\n if (!r.id) return;\n let result = {};\n if (r.method === 'account/read') result = { account: { email: ++reads === 1 ? 'test@example.com' : 'other@example.com' } };\n if (r.method === 'account/rateLimits/read') result = { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 10080 } } };\n if (!['initialize', 'initialized', 'account/read', 'account/rateLimits/read'].includes(r.method)) process.exit(2);\n console.log(JSON.stringify({ id: r.id, result }));\n});\n});\n`);
    await chmod(bin, 0o700);
    await assert.rejects(codex({ ...profile, codexBin: bin }), (e) => e instanceof UsageError && e.identity === null && /account/i.test(e.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Claude uses the provider endpoint without redirects and never exposes a token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remaining-claude-'));
  const originalFetch = globalThis.fetch;
  try {
    const metadata = join(dir, '.claude.json');
    await writeFile(metadata, JSON.stringify({ oauthAccount: { emailAddress: 'test@example.com' } }));
    await writeFile(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-test-token' } }));
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
      return { ok: true, json: async () => ({ seven_day: { utilization: 40 } }) };
    };
    const result = await claude({ ...profile, provider: 'claude', home: dir, metadata });
    assert.equal(amount(result.windows[0]), '60%');
    assert.equal(JSON.stringify(result).includes('synthetic-test-token'), false);
    globalThis.fetch = async () => {
      await writeFile(metadata, JSON.stringify({ oauthAccount: { emailAddress: 'other@example.com' } }));
      return { ok: true, json: async () => ({ seven_day: { utilization: 40 } }) };
    };
    await assert.rejects(claude({ ...profile, provider: 'claude', home: dir, metadata }), (e) => e.identity === null);
  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
});
