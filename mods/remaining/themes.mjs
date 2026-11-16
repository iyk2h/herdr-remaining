import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THEMES, normalizeTheme } from './theme-format.mjs';

export async function loadThemes(root) {
  const themes = new Map(DEFAULT_THEMES.map((theme) => [theme.id, theme]));
  const errors = [];
  let files;
  try { files = await readdir(join(root, 'themes'), { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOENT') errors.push('themes/: unable to read folder');
    return { themes: [...themes.values()], errors };
  }
  const candidates = files.filter((f) => f.isFile() && !f.name.startsWith('.') && f.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
  if (candidates.length > 50) errors.push('themes/: only the first 50 JSON files are loaded');
  for (const file of candidates.slice(0, 50)) {
    try {
      const path = join(root, 'themes', file.name);
      if ((await stat(path)).size > 16384) throw new Error('file exceeds 16 KiB');
      let raw;
      try { raw = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('invalid JSON'); }
      const theme = normalizeTheme(raw);
      if (file.name !== `${theme.id}.json`) throw new Error('filename must match the theme id');
      themes.set(theme.id, theme);
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  return { themes: [...themes.values()], errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await loadThemes(dirname(fileURLToPath(import.meta.url)));
  console.log(JSON.stringify(result));
  if (process.argv.includes('--check') && result.errors.length) process.exitCode = 1;
}
