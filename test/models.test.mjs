import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeWindows, codexWindows } from '../mods/remaining/normalize.mjs';
import { rankAccounts, parseRecommendationArgs } from '../mods/remaining/recommend.mjs';
import { preferences } from '../mods/remaining/preferences.mjs';

const now = 1000;
const iso = new Date(now + 100000).toISOString();
test('explicit active model scope retains exact IDs and names; a surface label is not a model', () => {
  const rows = claudeWindows({ seven_day: { utilization: 20, resets_at: iso }, limits: [
    { kind: 'weekly_scoped', is_active: true, percent: 100, resets_at: iso, scope: { model: { id: 'claude-opus-example', display_name: 'Opus' } } },
    { kind: 'weekly_scoped', is_active: true, percent: 0, resets_at: iso, scope: { surface: { display_name: 'Review' } } },
    { kind: 'weekly_scoped', is_active: false, percent: 100, scope: { model: { id: 'inactive' } } },
  ] });
  assert.deepEqual(rows[1].modelKeys, ['claude-opus-example', 'opus']);
  assert.equal(rows[2].modelKeys, undefined);
  assert.equal(rows.length, 3);
  assert.deepEqual(claudeWindows({ seven_day_opus: { utilization: 10, resets_at: iso } })[0].modelKeys, ['opus']);
});
test('generic Codex bucket identifiers or names are never guessed to be model scopes', () => {
  const rows = codexWindows({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 10, windowDurationMins: 10080 } },
    opus: { limitName: 'Opus', primary: { usedPercent: 100, windowDurationMins: 10080 } } } });
  assert.ok(rows.every((window) => window.modelKeys === undefined));
});
test('requested model exhaustion excludes an account without affecting other models or the general recommendation', () => {
  const profiles = [{ id: 'a', provider: 'claude', source: 'a' }, { id: 'b', provider: 'claude', source: 'b' }];
  const windows = (general, opus) => claudeWindows({ seven_day: { utilization: general, resets_at: iso }, limits: [
    { kind: 'weekly_scoped', is_active: true, percent: opus, resets_at: iso, scope: { model: { id: 'opus' } } },
    { kind: 'weekly_scoped', is_active: true, percent: 10, resets_at: iso, scope: { model: { id: 'sonnet' } } },
  ] });
  const cache = { accounts: [{ ...profiles[0], status: 'ok', fetchedAt: now, windows: windows(10, 100) },
    { ...profiles[1], status: 'ok', fetchedAt: now, windows: windows(40, 30) }] };
  const input = { profiles, cache, compatible: true, now, prefs: preferences(null) };
  assert.equal(rankAccounts(input).claude.recommendedId, 'a');
  const opus = rankAccounts({ ...input, model: 'Opus' }).claude;
  assert.equal(opus.recommendedId, 'b');
  assert.equal(opus.accounts[0].state, 'exhausted');
  assert.equal(opus.accounts[1].modelCoverage, 'reported');
  assert.equal(rankAccounts({ ...input, model: 'sonnet' }).claude.recommendedId, 'a');
  const missing = rankAccounts({ ...input, model: 'unknown-model' }).claude;
  assert.equal(missing.recommendedId, null);
  assert.equal(missing.accounts[0].state, 'model_limits_unavailable');
});
test('model arguments match exact identifiers and cannot be duplicated or consumed as another flag', () => {
  assert.deepEqual(parseRecommendationArgs(['--provider', 'claude', '--model', 'Opus', '--refresh']), { provider: 'claude', model: 'opus', refresh: true });
  for (const args of [['--model'], ['--model', '--refresh'], ['--model', 'opus', '--model', 'sonnet']]) assert.throws(() => parseRecommendationArgs(args));
});
