import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadProfiles } from './profiles.mjs';
import { preferences, pollingPreferences, validPreferences } from './preferences.mjs';
import { snapshotKey, SNAPSHOT_VERSION } from './usage.mjs';

export async function localJson(path) {
  try { return { state: 'readable', value: JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { return { state: error.code === 'ENOENT' ? 'missing' : error instanceof SyntaxError ? 'invalid' : 'unreadable', value: null }; }
}
export async function exists(path) { try { await access(path); return true; } catch { return false; } }

export async function localAccountState({ root = dirname(fileURLToPath(import.meta.url)),
  appHome = process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), home = homedir(), env = process.env } = {}) {
  const stored = await localJson(join(appHome, 'shared.json'));
  if (stored.state === 'readable' && (!stored.value || typeof stored.value !== 'object' || Array.isArray(stored.value))) stored.state = 'invalid';
  const rawPrefs = stored.value?.['remaining.preferences'];
  const prefs = preferences(rawPrefs);
  let profiles = [];
  let discoveryFailed = false;
  try { profiles = await loadProfiles(root, { appHome, home, env }); } catch { discoveryFailed = true; }
  const cache = await localJson(join(appHome, 'data/remaining/usage.json'));
  const compatible = !discoveryFailed && cache.value?.version === SNAPSHOT_VERSION
    && cache.value?.configKey === snapshotKey(profiles, pollingPreferences(prefs)) && Array.isArray(cache.value?.accounts);
  return { root, appHome, stored, rawPrefs, prefs, preferencesValid: validPreferences(rawPrefs), profiles, discoveryFailed, cache, compatible };
}
