import { fileURLToPath } from 'node:url';
import { localAccountState } from './local-state.mjs';
import { createSettingsBackup } from './settings-format.mjs';

export async function settingsBackup(options = {}) {
  const context = await localAccountState(options);
  if (context.discoveryFailed || !context.preferencesValid || ['invalid', 'unreadable'].includes(context.stored.state)) throw new Error('Unable to read settings');
  return createSettingsBackup(context.prefs, context.profiles);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 2) throw new Error('Invalid arguments');
    console.log(await settingsBackup());
  } catch { console.log(JSON.stringify({ status: 'error', reason: 'settings_backup_failed' })); process.exitCode = 2; }
}
