import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const exec = promisify(execFile);

test('launcher modes return JSON through a directory alias with spaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remaining launcher '));
  try {
    const runtime = join(root, 'runtime files');
    await cp(new URL('../mods/remaining/', import.meta.url), runtime, { recursive: true });
    await writeFile(join(runtime, 'accounts.json'), '[]');
    const alias = join(root, 'directory alias');
    await symlink(runtime, alias, 'dir');
    const appHome = join(root, 'app home');
    await mkdir(appHome);
    await writeFile(join(appHome, 'shared.json'), '{}');
    const env = { ...process.env, HERDR_APP_HOME: appHome,
      PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter) };
    for (const [args, expectedCode] of [[['--themes', '--check'], 0], [['--diagnose'], 1],
      [['--recommend', '--provider', 'codex'], 1], [['--settings-backup'], 0]]) {
      let result;
      let code = 0;
      try { result = await exec('/bin/sh', [join(alias, 'launch.sh'), ...args], { env }); }
      catch (error) { result = error; code = error.code; }
      assert.equal(code, expectedCode, args.join(' '));
      assert.notEqual(result.stdout.trim(), '', `${args.join(' ')} must return JSON`);
      const report = JSON.parse(result.stdout);
      assert.equal(typeof report, 'object');
      if (args[0] === '--themes') assert.deepEqual(report.themes.map((theme) => theme.id), ['bars', 'rings']);
      if (args[0] === '--diagnose') assert.equal(report.discovery.count, 0);
      if (args[0] === '--recommend') assert.equal(report.providers.codex.recommendedId, null);
      if (args[0] === '--settings-backup') assert.deepEqual(report.accounts, []);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
