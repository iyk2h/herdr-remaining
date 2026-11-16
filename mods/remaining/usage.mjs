import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, unlink, stat, access, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { codexWindows, claudeWindows, failedAccount } from './normalize.mjs';
import { nextRefreshAt } from './refresh-policy.mjs';
import { loadProfiles } from './profiles.mjs';
import { pollingPreferences, enabledProfiles } from './preferences.mjs';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const stateDir = join(process.env.HERDR_APP_HOME || join(home, '.config/herdr-app'), 'data/remaining');
export const SNAPSHOT_VERSION = 3;
export const snapshotKey = (profiles, prefs) => createHash('sha256').update(JSON.stringify([profiles, prefs])).digest('hex');

export class UsageError extends Error {
  constructor(message, identity = null) { super(message); this.identity = identity; }
}
async function json(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}
function checkIdentity(profile, email) {
  if (typeof email !== 'string' || !email.includes('@')) throw new UsageError('Sign in with your CLI subscription account');
  if (profile.expectedEmail && email.toLowerCase() !== profile.expectedEmail.toLowerCase()) throw new UsageError('Signed-in account does not match expectedEmail');
  return email;
}
export async function codexExecutable(profile) {
  const candidates = profile.codexBin ? [profile.codexBin] : [
    ...(process.env.PATH || '').split(delimiter).filter(Boolean).map((p) => join(p, 'codex')),
    '/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(home, '.local/bin/codex'),
  ];
  for (const path of candidates) { try { await access(path, constants.X_OK); return path; } catch {} }
  throw new UsageError('Codex CLI not found; install it or configure codexBin');
}

export async function codex(profile) {
  const child = spawn(await codexExecutable(profile), ['--no-daemon', 'app-server'], {
    env: { ...process.env, CODEX_HOME: profile.home }, stdio: ['pipe', 'pipe', 'ignore'], cwd: home,
  });
  const pending = new Map();
  let sequence = 0;
  let exited = false;
  const rejectAll = () => {
    for (const r of pending.values()) { clearTimeout(r.timer); r.reject(new UsageError('Codex connection ended; check your CLI version and login')); }
    pending.clear();
  };
  child.on('error', () => { exited = true; rejectAll(); });
  child.on('exit', () => { exited = true; rejectAll(); });
  child.stdin.on('error', rejectAll);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let data; try { data = JSON.parse(line); } catch { return; }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new UsageError('Codex request failed; check your CLI login'));
    else request.resolve(data.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (exited) { reject(new UsageError('Codex could not start')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new UsageError('Codex request timed out')); }, 18000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  let email = null;
  try {
    await call('initialize', { clientInfo: { name: 'herdr_remaining', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    email = checkIdentity(profile, (await call('account/read', { refreshToken: false }))?.account?.email);
    const payload = await call('account/rateLimits/read');
    const current = checkIdentity(profile, (await call('account/read', { refreshToken: false }))?.account?.email);
    if (current.toLowerCase() !== email.toLowerCase()) { email = null; throw new UsageError('Account changed during refresh; retry'); }
    const windows = codexWindows(payload);
    if (!windows.length) throw new UsageError('No supported subscription limits returned');
    return { email, windows, ordinaryUsageAllowed: payload?.ordinaryUsageAllowed ?? null };
  } catch (error) {
    // Identity failures must discard cached numbers, even when a previous request succeeded.
    throw new UsageError(error instanceof UsageError ? error.message : 'Unable to read Codex limits',
      /account|sign in/i.test(error.message) ? null : email);
  } finally {
    lines.close();
    rejectAll();
    child.kill('SIGTERM');
    if (!exited) await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

export async function claude(profile) {
  const email = checkIdentity(profile, (await json(profile.metadata))?.oauthAccount?.emailAddress);
  let raw;
  try { raw = await readFile(join(profile.home, '.credentials.json'), 'utf8'); }
  catch {
    if (process.platform !== 'darwin' || !profile.keychainService) throw new UsageError('Claude credentials unavailable; sign in using the CLI');
    try { raw = (await exec('/usr/bin/security', ['find-generic-password', '-s', profile.keychainService, '-w'], { timeout: 10000, maxBuffer: 1024 * 1024 })).stdout; }
    catch { throw new UsageError('Claude credentials unavailable; check CLI login and Keychain access'); }
  }
  let token;
  try { token = JSON.parse(raw).claudeAiOauth?.accessToken; } catch {}
  if (typeof token !== 'string' || !token) throw new UsageError('Claude subscription login required');
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new UsageError(response.status === 401 || response.status === 403 ? 'Claude login expired; sign in using the CLI'
      : response.status === 429 ? 'Provider rate limit; retrying shortly' : `Claude usage request failed (${response.status})`);
    const windows = claudeWindows(await response.json());
    if (!windows.length) throw new UsageError('No supported subscription limits returned');
    const current = checkIdentity(profile, (await json(profile.metadata))?.oauthAccount?.emailAddress);
    if (current.toLowerCase() !== email.toLowerCase()) throw new UsageError('Account changed during refresh; retry');
    return { email, windows };
  } catch (error) {
    const current = (await json(profile.metadata))?.oauthAccount?.emailAddress;
    const identity = typeof current === 'string' && current.toLowerCase() === email.toLowerCase() && !/login|account|sign in/i.test(error.message) ? email : null;
    throw new UsageError(error instanceof UsageError ? error.message : 'Claude usage request failed; check your connection', identity);
  }
}

export async function collectProfiles(profiles, cached, collect, now = Date.now) {
  return Promise.all(profiles.map(async (profile) => {
    try {
      const data = await collect(profile);
      return { id: profile.id, provider: profile.provider, label: profile.label, badge: profile.badge, tint: profile.tint, source: profile.source,
        ...data, status: 'ok', fetchedAt: now(), checkedAt: now(), error: null };
    } catch (error) {
      return failedAccount(profile, cached?.accounts?.find((a) => a.id === profile.id),
        error instanceof UsageError ? error.message : 'Unable to read account limits', now(), error instanceof UsageError ? error.identity : null);
    }
  }));
}

async function main() {
  const profiles = await loadProfiles(root);
  const preferenceIndex = process.argv.indexOf('--preferences');
  const prefs = pollingPreferences(preferenceIndex === -1 ? null : JSON.parse(process.argv[preferenceIndex + 1]));
  const refreshMs = prefs.refreshMinutes * 60000;
  const enabled = enabledProfiles(profiles, prefs);
  const configKey = snapshotKey(profiles, prefs);
  const cacheFile = join(stateDir, 'usage.json');
  const lockFile = join(stateDir, 'refresh.lock');
  const previous = await json(cacheFile);
  const cached = previous?.version === SNAPSHOT_VERSION && previous?.configKey === configKey ? previous : null;
  const now = Date.now();
  if (cached && now < (process.argv.includes('--refresh') ? cached.checkedAt + 10000 : nextRefreshAt(cached, now))) return cached;
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  try { if (now - (await stat(lockFile)).mtimeMs > 90000) await unlink(lockFile); } catch {}
  try { await writeFile(lockFile, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { ...(cached ?? { checkedAt: now, refreshMs, profiles: profiles.map(({ id, provider, label, badge, tint }) => ({ id, provider, label, badge, tint })),
      accounts: enabled.map((p) => ({ ...failedAccount(p, null, null, now), status: 'checking' })) }), pending: true };
  }
  try {
    const accounts = await collectProfiles(enabled, cached, (p) => p.provider === 'codex' ? codex(p) : claude(p));
    const result = { version: SNAPSHOT_VERSION, configKey, checkedAt: Date.now(), refreshMs,
      profiles: profiles.map(({ id, provider, label, badge, tint }) => ({ id, provider, label, badge, tint })), accounts };
    const temp = `${cacheFile}.${process.pid}`;
    await writeFile(temp, JSON.stringify(result) + '\n', { mode: 0o600 });
    await rename(temp, cacheFile);
    return result;
  } finally { await unlink(lockFile).catch(() => {}); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) {
    console.log(JSON.stringify({ checkedAt: Date.now(), accounts: [], error: error instanceof UsageError ? error.message : 'Unable to refresh; check accounts.json and runtime setup' }));
    process.exitCode = 1;
  }
}
