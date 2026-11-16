import { access, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';

// Read the declaration, never execute an agent's launch command or shell wrapper.
export function profileFromProgram(key, program) {
  if (!Array.isArray(program?.run) || !program.run.every((arg) => typeof arg === 'string')) return null;
  const argv = [...program.run];
  const env = {};
  if (basename(argv[0] || '') === 'env') {
    argv.shift();
    if (argv[0] === '--') argv.shift();
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0] || '')) {
      const value = argv.shift();
      const separator = value.indexOf('=');
      env[value.slice(0, separator)] = value.slice(separator + 1);
    }
  }
  const executable = argv[0];
  const provider = basename(executable || '');
  if (!['claude', 'codex'].includes(provider)) return null;
  return { id: `agent-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`, provider,
    label: program.name || (provider === 'claude' ? 'Claude' : 'Codex'),
    ...(env[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] ? { home: env[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] } : {}),
    ...(provider === 'codex' && isAbsolute(executable) ? { codexBin: executable } : {}),
  };
}

export async function discoverProfiles(appHome, home, env = process.env) {
  let programs = {};
  try { programs = JSON.parse(await readFile(join(appHome, 'programs.json'), 'utf8')).programs ?? {}; }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to read Herdr programs.json'); }
  const profiles = Object.entries(programs).map(([key, program]) => profileFromProgram(key, program)).filter(Boolean);
  const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
  const claudeHome = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const claudeMetadata = claudeHome === join(home, '.claude') ? join(home, '.claude.json') : join(claudeHome, '.claude.json');
  if (await exists(claudeMetadata)) profiles.push({ id: 'claude', provider: 'claude', label: 'Claude', home: claudeHome });
  const codexHome = env.CODEX_HOME || join(home, '.codex');
  if (await exists(join(codexHome, 'auth.json'))) profiles.push({ id: 'codex', provider: 'codex', label: 'Codex', home: codexHome });
  return profiles.sort((a, b) => (a.provider === 'claude' ? 0 : 1) - (b.provider === 'claude' ? 0 : 1));
}
