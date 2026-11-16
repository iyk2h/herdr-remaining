import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { buildRelease, readRelease, installRelease, rollbackRelease, releaseStatus, adoptInstallation } from '../tools/releases.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'remaining-releases-'));
  try {
    const runtime = join(root, 'source');
    const appHome = join(root, 'app');
    await mkdir(join(runtime, 'themes'), { recursive: true });
    await writeFile(join(runtime, 'main.js'), 'export default class VersionOne {}\n');
    await writeFile(join(runtime, 'mod.json'), '{"place":"none"}\n');
    await writeFile(join(runtime, 'themes/bars.json'), '{"id":"bars","name":"Bars","layout":"bars"}\n');
    const first = await buildRelease({ runtime, version: '1.0.0', outputRoot: join(root, 'dist') });
    await writeFile(join(runtime, 'main.js'), 'export default class VersionTwo {}\n');
    await writeFile(join(runtime, 'new.mjs'), 'export const value = 2;\n');
    await writeFile(join(runtime, 'themes/bars.json'), '{"id":"bars","name":"New default","layout":"bars"}\n');
    const second = await buildRelease({ runtime, version: '1.1.0', outputRoot: join(root, 'dist') });
    await run({ root, runtime, appHome, first, second, dest: join(appHome, 'mods/remaining'), check: async () => {} });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('update and rollback preserve custom themes, account config and unrelated Herdr state', async () => {
  await fixture(async ({ appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    await writeFile(join(dest, 'themes/bars.json'), 'user-modified builtin theme');
    await writeFile(join(dest, 'themes/custom.json'), 'custom theme');
    await writeFile(join(dest, 'accounts.json'), '{"private":"credential-placeholder"}');
    await writeFile(join(appHome, 'shared.json'), '{"unrelated":{"keep":true}}');
    await installRelease({ appHome, release: second, check });
    assert.match(await readFile(join(dest, 'main.js'), 'utf8'), /VersionTwo/);
    await writeFile(join(dest, 'themes/custom.json'), 'custom theme edited after upgrade');
    await rollbackRelease({ appHome, check });
    assert.match(await readFile(join(dest, 'main.js'), 'utf8'), /VersionOne/);
    assert.equal(await readFile(join(dest, 'themes/bars.json'), 'utf8'), 'user-modified builtin theme');
    assert.equal(await readFile(join(dest, 'themes/custom.json'), 'utf8'), 'custom theme edited after upgrade');
    assert.equal(await readFile(join(dest, 'accounts.json'), 'utf8'), '{"private":"credential-placeholder"}');
    assert.equal(await readFile(join(appHome, 'shared.json'), 'utf8'), '{"unrelated":{"keep":true}}');
    await assert.rejects(readFile(join(dest, 'new.mjs')), { code: 'ENOENT' });
    assert.equal((await releaseStatus({ appHome })).status, 'ok');
    const snapshot = join(appHome, 'data/remaining/deploy/releases', basename(second));
    await assert.rejects(readFile(join(snapshot, 'accounts.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(snapshot, 'themes/custom.json')), { code: 'ENOENT' });
  });
});
test('native validation failure and edits made during validation leave the installed release intact', async () => {
  await fixture(async ({ appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    const original = await readFile(join(dest, 'main.js'), 'utf8');
    await assert.rejects(installRelease({ appHome, release: second, check: async () => { throw new Error('Native check failed'); } }));
    assert.equal(await readFile(join(dest, 'main.js'), 'utf8'), original);
    await assert.rejects(installRelease({ appHome, release: second, check: async () => { await writeFile(join(dest, 'themes/custom.json'), 'concurrent user edit'); } }), /changed during validation/);
    assert.equal(await readFile(join(dest, 'main.js'), 'utf8'), original);
    assert.equal(await readFile(join(dest, 'themes/custom.json'), 'utf8'), 'concurrent user edit');
  });
});
test('edited managed code and collisions with unowned files are refused without overwriting them', async () => {
  await fixture(async ({ appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    const original = await readFile(join(dest, 'main.js'), 'utf8');
    await writeFile(join(dest, 'main.js'), 'user code');
    await assert.rejects(installRelease({ appHome, release: second, check }), /Managed files changed/);
    assert.equal(await readFile(join(dest, 'main.js'), 'utf8'), 'user code');
    assert.equal((await releaseStatus({ appHome })).status, 'modified');
    await writeFile(join(dest, 'main.js'), original);
    await writeFile(join(dest, 'new.mjs'), 'unowned helper');
    await assert.rejects(installRelease({ appHome, release: second, check }), /unowned file/);
    assert.equal(await readFile(join(dest, 'new.mjs'), 'utf8'), 'unowned helper');
  });
});
test('the validated stage cannot be modified by a checker or concurrent process before installation', async () => {
  await fixture(async ({ appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    await assert.rejects(installRelease({ appHome, release: second, check: async (stage) => { await writeFile(join(stage, 'main.js'), 'changed after validation'); } }), /Managed files changed/);
    assert.match(await readFile(join(dest, 'main.js'), 'utf8'), /VersionOne/);
  });
});
test('same-release install is an idempotent no-op and does not rerun the checker', async () => {
  await fixture(async ({ appHome, first, check }) => {
    await installRelease({ appHome, release: first, check });
    assert.equal((await installRelease({ appHome, release: first, check: async () => { throw new Error('Must not run'); } })).status, 'up_to_date');
    assert.equal((await releaseStatus({ appHome })).status, 'ok');
  });
});
test('corrupt payloads, symlinks and traversal metadata are rejected', async () => {
  await fixture(async ({ root, runtime, appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    await writeFile(join(second, 'main.js'), 'tampered');
    await assert.rejects(installRelease({ appHome, release: second, check }), /checksum/);
    await writeFile(join(root, 'outside'), 'private outside content');
    await symlink(join(root, 'outside'), join(dest, 'themes/link.json'));
    await assert.rejects(installRelease({ appHome, release: first, check }), /Symbolic links/);
    assert.equal(await readFile(join(root, 'outside'), 'utf8'), 'private outside content');
    await symlink(join(root, 'outside'), join(runtime, 'link.mjs'));
    await assert.rejects(buildRelease({ runtime, version: '2.0.0', outputRoot: join(root, 'dist') }), /Symbolic links/);
    const bad = join(root, 'bad');
    await mkdir(bad);
    const manifest = JSON.parse(await readFile(join(first, 'remaining-release.json'), 'utf8'));
    manifest.files[0].path = '../outside';
    await writeFile(join(bad, 'remaining-release.json'), JSON.stringify(manifest));
    await assert.rejects(readRelease(bad), /Invalid release file/);
  });
});
test('adoption requires the legacy owner marker and an exact code match', async () => {
  await fixture(async ({ appHome, first, second, dest, check }) => {
    await mkdir(dest, { recursive: true });
    for (const file of (await readRelease(first)).manifest.files) {
      const target = join(dest, file.path);
      await mkdir(join(target, '..'), { recursive: true });
      await cp(join(first, file.path), target);
    }
    await assert.rejects(adoptInstallation({ appHome, release: first }), /not owned/);
    await writeFile(join(dest, '.local-remaining-owned'), 'owned');
    await adoptInstallation({ appHome, release: first });
    await installRelease({ appHome, release: second, check });
    await rollbackRelease({ appHome, check });
    assert.match(await readFile(join(dest, 'main.js'), 'utf8'), /VersionOne/);
  });
});
test('a directory-swap interruption recovers the previous folder before another operation', async () => {
  await fixture(async ({ appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    await writeFile(join(dest, 'accounts.json'), 'private config');
    const directory = join(appHome, 'data/remaining/deploy');
    const before = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8'));
    const stage = '.remaining-stage-00000000-0000-0000-0000-000000000001';
    const old = '.remaining-old-00000000-0000-0000-0000-000000000002';
    await cp(second, join(appHome, 'mods', stage), { recursive: true });
    await rename(dest, join(appHome, 'mods', old));
    await writeFile(join(directory, 'transaction.json'), JSON.stringify({ stage, old, hadDestination: true, target: basename(second), before }));
    assert.equal((await installRelease({ appHome, release: first, check })).status, 'up_to_date');
    assert.equal(await readFile(join(dest, 'accounts.json'), 'utf8'), 'private config');
    assert.match(await readFile(join(dest, 'main.js'), 'utf8'), /VersionOne/);
    assert.equal((await releaseStatus({ appHome })).recoveryRequired, false);
  });
});
test('a live operation lock and symlinked state parent cannot be bypassed', async () => {
  await fixture(async ({ root, appHome, first, second, dest, check }) => {
    await installRelease({ appHome, release: first, check });
    const lock = join(appHome, 'data/remaining/deploy/update.lock');
    await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'busy' }));
    await assert.rejects(installRelease({ appHome, release: second, check }), /operation is running/);
    await rm(lock);
    const other = join(root, 'other-app');
    await mkdir(other);
    await symlink(join(appHome, 'data'), join(other, 'data'));
    await assert.rejects(installRelease({ appHome: other, release: first, check }), /ordinary directory/);
    assert.match(await readFile(join(dest, 'main.js'), 'utf8'), /VersionOne/);
  });
});
test('packaging refuses credentials and local account configuration', async () => {
  await fixture(async ({ root, runtime }) => {
    await writeFile(join(runtime, 'accounts.json'), '{"private":"configuration"}');
    await assert.rejects(buildRelease({ runtime, version: '2.0.0', outputRoot: join(root, 'dist') }), /Non-distribution file/);
  });
});
