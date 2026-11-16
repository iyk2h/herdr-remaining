import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { discoverProfiles } from './discovery.mjs';

const TINTS = ['ansi3', 'ansi2', 'ansi4', 'ansi5', 'ansi6'];
export function normalizeProfiles(input, home = homedir(), env = process.env) {
  if (!Array.isArray(input) || input.length > 20) throw new Error('accounts.json must contain an array of up to 20 accounts');
  const ids = new Set();
  const expand = (value) => {
    if (value === '~') return home;
    if (value.startsWith('~/')) return join(home, value.slice(2));
    if (!isAbsolute(value)) throw new Error('Account paths must be absolute or start with ~/');
    return resolve(value);
  };
  return input.map((p, index) => {
    if (!p || !['claude', 'codex'].includes(p.provider) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(p.id) || ids.has(p.id)) {
      throw new Error('Each account needs a unique id and a claude or codex provider');
    }
    ids.add(p.id);
    const label = p.label ?? (p.provider === 'claude' ? 'Claude' : 'Codex');
    if (typeof label !== 'string' || !label.trim() || label.length > 60 || /[\r\n\x00-\x1f]/.test(label)) throw new Error('Invalid account label');
    if (p.expectedEmail !== undefined && (typeof p.expectedEmail !== 'string' || !p.expectedEmail.includes('@'))) throw new Error('Invalid expectedEmail');
    const directory = expand(p.home ?? (p.provider === 'codex' ? env.CODEX_HOME || join(home, '.codex') : env.CLAUDE_CONFIG_DIR || join(home, '.claude')));
    const metadata = p.provider === 'claude' ? expand(p.metadata ?? (directory === join(home, '.claude') ? join(home, '.claude.json') : join(directory, '.claude.json'))) : null;
    if (p.keychainService !== undefined && (typeof p.keychainService !== 'string' || !p.keychainService || p.keychainService.length > 200)) throw new Error('Invalid keychainService');
    if (p.codexBin !== undefined && (typeof p.codexBin !== 'string' || !isAbsolute(p.codexBin))) throw new Error('codexBin must be an absolute path');
    const keychainService = p.keychainService ?? (directory === join(home, '.claude') ? 'Claude Code-credentials' : null);
    const source = createHash('sha256').update(JSON.stringify([p.provider, directory, metadata, keychainService, p.codexBin, p.expectedEmail?.toLowerCase()])).digest('hex');
    return { id: p.id, provider: p.provider, label, home: directory, metadata, keychainService,
      expectedEmail: p.expectedEmail ?? null, codexBin: p.codexBin ?? null, source,
      badge: typeof p.badge === 'string' && p.badge.length ? [...p.badge][0] : [...label][0].toUpperCase(),
      tint: TINTS.includes(p.tint) ? p.tint : TINTS[index % TINTS.length] };
  });
}

export async function loadProfiles(root, { appHome = process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), home = homedir(), env = process.env } = {}) {
  let input;
  try { input = JSON.parse(await readFile(join(root, 'accounts.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Unable to read accounts.json; check its JSON syntax');
    input = await discoverProfiles(appHome, home, env);
  }
  const normalized = normalizeProfiles(input, home, env);
  const sources = new Set();
  return normalized.filter((profile) => {
    const key = JSON.stringify([profile.provider, profile.home]);
    if (sources.has(key)) return false;
    sources.add(key);
    return true;
  });
}
