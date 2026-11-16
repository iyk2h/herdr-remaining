import { readFile, writeFile, mkdir, readdir, lstat, cp, rename, rm, unlink, chmod } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'remaining-release.json';
const FORMAT = 'herdr.remaining.release';
const idPattern = /^\d+\.\d+\.\d+-[a-f0-9]{12}$/;
const ignored = new Set(['gpui-kit.d.ts', 'jsconfig.json']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const managed = (file) => !file.path.startsWith('themes/');
const releaseId = (version, files) => `${version}-${hash(JSON.stringify(files)).slice(0, 12)}`;
const defaultHome = () => process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app');
const statePaths = (appHome) => ({ dest: join(appHome, 'mods/remaining'), mods: join(appHome, 'mods'),
  root: join(appHome, 'data/remaining/deploy'), snapshots: join(appHome, 'data/remaining/deploy/releases'),
  current: join(appHome, 'data/remaining/deploy/current.json'), journal: join(appHome, 'data/remaining/deploy/transaction.json'),
  lock: join(appHome, 'data/remaining/deploy/update.lock') });
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function realDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected an ordinary directory');
}
function allowed(name) {
  const parts = name.split('/');
  if (!name || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /[\\\x00-\x1f]/.test(part))) return false;
  if (parts.length === 1) return !ignored.has(name) && (/\.(?:js|mjs|sh|md|txt)$/.test(name) || ['mod.json', 'theme-schema.json', 'accounts.example.json'].includes(name));
  return ['icons', 'rings', 'themes', 'examples'].includes(parts[0]) && /\.(?:svg|json|txt|md)$/.test(name);
}
async function walk(root, prefix = '') {
  const rows = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not supported by release operations');
    if (entry.isDirectory()) rows.push(...await walk(root, name));
    else if (entry.isFile()) rows.push(name);
    else throw new Error('Special files are not supported by release operations');
  }
  return rows;
}
async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}`;
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
async function readJson(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Invalid release metadata');
  return JSON.parse(await readFile(file, 'utf8'));
}
function validateManifest(value) {
  if (value?.format !== FORMAT || value.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) || !idPattern.test(value.id)
    || !Array.isArray(value.files) || !value.files.length || value.files.length > 1024) throw new Error('Invalid release manifest');
  const names = new Set();
  for (const file of value.files) {
    if (!allowed(file.path) || names.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || ![0o644, 0o755].includes(file.mode)) throw new Error('Invalid release file');
    names.add(file.path);
  }
  if (!names.has('main.js') || !names.has('mod.json') || value.id !== releaseId(value.version, value.files)) throw new Error('Incomplete release manifest');
  return value;
}
export async function readRelease(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid release directory');
  const manifest = validateManifest(await readJson(join(directory, MANIFEST)));
  const files = await walk(directory);
  if (files.some((name) => name !== MANIFEST && !manifest.files.some((file) => file.path === name))) throw new Error('Unexpected release payload');
  let total = 0;
  for (const file of manifest.files) {
    const info = await lstat(join(directory, file.path));
    total += info.size;
    if (!info.isFile() || info.size > 4 * 1024 * 1024 || total > 16 * 1024 * 1024) throw new Error('Release payload exceeds size limit');
    if (hash(await readFile(join(directory, file.path))) !== file.sha256) throw new Error(`Release checksum mismatch: ${file.path}`);
  }
  return { directory, manifest };
}
export async function buildRelease({ projectRoot = project, runtime = join(projectRoot, 'mods/remaining'), version, outputRoot = join(projectRoot, 'dist') } = {}) {
  version ??= JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a numeric semantic version');
  const info = await lstat(runtime);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid runtime directory');
  const files = [];
  for (const name of await walk(runtime)) {
    if (!allowed(name)) {
      if (ignored.has(name) || name.startsWith('.') || name.endsWith('.error')) continue;
      throw new Error(`Non-distribution file in runtime: ${name}`);
    }
    const data = await readFile(join(runtime, name));
    if (data.length > 4 * 1024 * 1024) throw new Error('Release file exceeds size limit');
    files.push({ path: name, sha256: hash(data), mode: name.endsWith('.sh') ? 0o755 : 0o644 });
  }
  const manifest = validateManifest({ format: FORMAT, schema: 1, version, id: releaseId(version, files), files });
  await realDirectory(outputRoot);
  const directory = join(outputRoot, manifest.id);
  if (await exists(directory)) {
    const existing = await readRelease(directory);
    if (existing.manifest.id !== manifest.id) throw new Error('Release directory collision');
    return existing.directory;
  }
  const stage = join(outputRoot, `.build-${randomUUID()}`);
  await realDirectory(stage);
  try {
    for (const file of files) {
      await mkdir(dirname(join(stage, file.path)), { recursive: true, mode: 0o700 });
      await cp(join(runtime, file.path), join(stage, file.path));
      await chmod(join(stage, file.path), file.mode);
    }
    await atomicJson(join(stage, MANIFEST), manifest);
    await readRelease(stage);
    await rename(stage, directory);
  } finally { await rm(stage, { recursive: true, force: true }); }
  return directory;
}
async function verifyInstalled(dest, manifest) {
  const modified = [];
  for (const file of manifest.files.filter(managed)) {
    try { const info = await lstat(join(dest, file.path)); if (!info.isFile() || info.isSymbolicLink() || hash(await readFile(join(dest, file.path))) !== file.sha256) modified.push(file.path); }
    catch (error) { if (error.code === 'ENOENT') modified.push(file.path); else throw error; }
  }
  if (modified.length) throw new Error(`Managed files changed; preserve edits before updating: ${modified.join(', ')}`);
}
async function fingerprint(directory) {
  if (!await exists(directory)) return null;
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Installed mod must not be a symbolic link');
  const rows = [];
  for (const name of await walk(directory)) {
    if (ignored.has(name) || name.endsWith('.error')) continue;
    rows.push([name, hash(await readFile(join(directory, name)))]);
  }
  return hash(JSON.stringify(rows));
}
async function saveRelease(paths, release) {
  const directory = join(paths.snapshots, release.manifest.id);
  if (!await exists(directory)) {
    const stage = join(paths.snapshots, `.save-${randomUUID()}`);
    try { await cp(release.directory, stage, { recursive: true, errorOnExist: true, force: false }); await readRelease(stage); await rename(stage, directory); }
    finally { await rm(stage, { recursive: true, force: true }); }
  }
  return readSnapshot(paths, release.manifest.id);
}
async function readSnapshot(paths, id) {
  const release = await readRelease(join(paths.snapshots, id));
  if (release.manifest.id !== id) throw new Error('Release snapshot identity mismatch');
  return release;
}
async function currentState(paths) {
  if (!await exists(paths.current)) return null;
  const state = await readJson(paths.current);
  if (state.schema !== 1 || !idPattern.test(state.current) || !Array.isArray(state.history) || state.history.some((id) => !idPattern.test(id))) throw new Error('Invalid installation state');
  return state;
}
async function recover(paths) {
  if (!await exists(paths.journal)) return;
  const journal = await readJson(paths.journal);
  if (!/^\.remaining-stage-[a-f0-9-]{36}$/.test(journal.stage) || !/^\.remaining-old-[a-f0-9-]{36}$/.test(journal.old)
    || !idPattern.test(journal.target) || typeof journal.hadDestination !== 'boolean') throw new Error('Invalid update recovery record');
  const stage = join(paths.mods, journal.stage);
  const old = join(paths.mods, journal.old);
  const state = await currentState(paths);
  const committed = state?.current === journal.target && await exists(paths.dest);
  if (!committed && (await exists(old) || !journal.hadDestination)) {
    if (await exists(paths.dest)) await rename(paths.dest, join(paths.mods, `.remaining-recovered-${randomUUID()}`));
    if (await exists(old)) await rename(old, paths.dest);
    if (journal.before) await atomicJson(paths.current, journal.before);
    else await rm(paths.current, { force: true });
  }
  await rm(stage, { recursive: true, force: true });
  await rm(old, { recursive: true, force: true });
  await unlink(paths.journal);
}
async function locked(appHome, action) {
  appHome = resolve(appHome);
  const paths = statePaths(appHome);
  for (const directory of ['', 'mods', 'data', 'data/remaining', 'data/remaining/deploy', 'data/remaining/deploy/releases']) await realDirectory(join(appHome, directory));
  if (await exists(paths.lock)) {
    const previous = await readJson(paths.lock);
    if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error('Invalid update lock');
    let running = true;
    try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; else throw error; }
    if (running) throw new Error('Another release operation is running');
    await unlink(paths.lock);
  }
  const token = randomUUID();
  await writeFile(paths.lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
  try { await recover(paths); return await action(paths); }
  finally { if ((await readJson(paths.lock)).token === token) await unlink(paths.lock); }
}
async function nativeCheck(directory) {
  const candidates = [join(homedir(), '.local/bin/herdr-app'), 'herdr-app'];
  let last;
  for (const executable of candidates) {
    try { await exec(executable, ['check', directory], { timeout: 90000, maxBuffer: 1024 * 1024 }); return; }
    catch (error) {
      if (error.killed) throw new Error('Native mod check timed out; installation was preserved');
      if (error.code !== 'ENOENT') throw new Error('Native mod check failed');
      last = error;
    }
  }
  throw new Error(last ? 'Herdr native checker unavailable' : 'Native check failed');
}
export async function adoptInstallation({ appHome = defaultHome(), release: source } = {}) {
  const release = await readRelease(resolve(source));
  return locked(appHome, async (paths) => {
    if (await currentState(paths)) throw new Error('Installation is already managed');
    const marker = join(paths.dest, '.local-remaining-owned');
    if (!await exists(marker) || !(await lstat(marker)).isFile()) throw new Error('Legacy installation is not owned by Remaining');
    await fingerprint(paths.dest);
    await verifyInstalled(paths.dest, release.manifest);
    await saveRelease(paths, release);
    await atomicJson(paths.current, { schema: 1, current: release.manifest.id, history: [] });
    return { status: 'adopted', version: release.manifest.version, release: release.manifest.id };
  });
}
async function apply(paths, release, before, check) {
  const present = await exists(paths.dest);
  if (present && !before) throw new Error('Existing Remaining folder must be adopted first');
  const previous = before ? await readSnapshot(paths, before.current) : null;
  const original = await fingerprint(paths.dest);
  if (previous) await verifyInstalled(paths.dest, previous.manifest);
  if (before?.current === release.manifest.id) return { status: 'up_to_date', version: release.manifest.version, release: release.manifest.id };
  const previouslyManaged = new Set(previous?.manifest.files.filter(managed).map((file) => file.path) ?? []);
  if (present) for (const file of release.manifest.files.filter(managed)) {
    if (!previouslyManaged.has(file.path) && await exists(join(paths.dest, file.path))) throw new Error(`New release would overwrite an unowned file: ${file.path}`);
  }
  const stageName = `.remaining-stage-${randomUUID()}`;
  const oldName = `.remaining-old-${randomUUID()}`;
  const stage = join(paths.mods, stageName);
  const old = join(paths.mods, oldName);
  try {
    if (present) await cp(paths.dest, stage, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    else await realDirectory(stage);
    await chmod(stage, 0o700);
    for (const file of previous?.manifest.files.filter(managed) ?? []) if (!release.manifest.files.some((next) => next.path === file.path)) await rm(join(stage, file.path));
    for (const file of release.manifest.files) {
      const target = join(stage, file.path);
      if (!managed(file) && await exists(target)) continue;
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await cp(join(release.directory, file.path), target);
      await chmod(target, file.mode);
    }
    await writeFile(join(stage, '.local-remaining-owned'), 'Remaining local installation; publishing requires explicit approval.\n', { mode: 0o600 });
    await verifyInstalled(stage, release.manifest);
    await check(stage);
    await verifyInstalled(stage, release.manifest);
    if (original !== await fingerprint(paths.dest)) throw new Error('Installation changed during validation; retry without concurrent edits');
    await saveRelease(paths, release);
    await atomicJson(paths.journal, { stage: stageName, old: oldName, hadDestination: present, target: release.manifest.id, before });
    if (present) await rename(paths.dest, old);
    await rename(stage, paths.dest);
    await atomicJson(paths.current, { schema: 1, current: release.manifest.id, history: [...new Set([before?.current, ...(before?.history ?? [])].filter((id) => id && id !== release.manifest.id))] });
    await recover(paths);
    return { status: 'installed', version: release.manifest.version, release: release.manifest.id, previous: before?.current ?? null };
  } catch (error) { await recover(paths); throw error; }
  finally { await rm(stage, { recursive: true, force: true }); }
}
export async function installRelease({ appHome = defaultHome(), release: source, check = nativeCheck } = {}) {
  const release = await readRelease(resolve(source));
  return locked(appHome, async (paths) => apply(paths, release, await currentState(paths), check));
}
export async function rollbackRelease({ appHome = defaultHome(), to = null, check = nativeCheck } = {}) {
  return locked(appHome, async (paths) => {
    const before = await currentState(paths);
    const target = to ?? before?.history[0];
    if (!before || !idPattern.test(target) || target === before.current || !before.history.includes(target)) throw new Error('No matching previous release');
    return apply(paths, await readSnapshot(paths, target), before, check);
  });
}
export async function releaseStatus({ appHome = defaultHome() } = {}) {
  const paths = statePaths(resolve(appHome));
  const state = await currentState(paths);
  if (!state) return { status: 'unmanaged', recoveryRequired: await exists(paths.journal) };
  const release = await readSnapshot(paths, state.current);
  let changed = false;
  try { await fingerprint(paths.dest); await verifyInstalled(paths.dest, release.manifest); } catch { changed = true; }
  return { status: changed ? 'modified' : 'ok', version: release.manifest.version, release: state.current, previous: state.history,
    recoveryRequired: await exists(paths.journal) };
}
async function cli(args) {
  const command = args.shift();
  const options = {};
  const names = new Map([['--app-home', 'appHome'], ['--release', 'release'], ['--to', 'to']]);
  while (args.length) { const key = names.get(args.shift()); if (!key || !args.length || options[key]) throw new Error('Invalid release arguments'); options[key] = args.shift(); }
  if (command === 'build' && !Object.keys(options).length) return { status: 'built', directory: await buildRelease() };
  if (command === 'status' && !options.release && !options.to) return releaseStatus(options);
  if (command === 'adopt' && options.release && !options.to) return adoptInstallation(options);
  if (command === 'install' && options.release && !options.to) return installRelease(options);
  if (command === 'rollback' && !options.release) return rollbackRelease(options);
  throw new Error('Use build, status, adopt --release, install --release, or rollback');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(JSON.stringify(await cli(process.argv.slice(2)))); }
  catch (error) { console.log(JSON.stringify({ status: 'error', message: error.message })); process.exitCode = 1; }
}
