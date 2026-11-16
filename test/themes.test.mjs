import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_THEMES, activeTheme, normalizeTheme, themeSchema } from '../mods/remaining/theme-format.mjs';
import { loadThemes } from '../mods/remaining/themes.mjs';

const basic = { id: 'custom', name: 'Custom', layout: 'bars' };
test('published JSON schema is generated from the same contract used by the loader', async () => {
  const file = await readFile(new URL('../mods/remaining/theme-schema.json', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(file), themeSchema);
});
test('built-in theme defaults select Bars and unknown saved themes fall back safely', () => {
  assert.equal(activeTheme(null, 'bars').layout, 'bars');
  assert.equal(activeTheme(null, 'rings').layout, 'rings');
  assert.equal(activeTheme(null, 'deleted').id, 'bars');
  assert.equal(normalizeTheme(basic).show.weekly, true);
});
test('theme fields are bounded and never interpret executable values', () => {
  for (const patch of [{ layout: 'javascript' }, { run: ['arbitrary'] }, { id: '../outside' },
    { sizes: { ring: 999 } }, { colors: { fill: 'url(https://example.com)' } }, { show: { short: false, weekly: false } }]) {
    assert.throws(() => normalizeTheme({ ...basic, ...patch }));
  }
  assert.equal(normalizeTheme({ ...basic, colors: { fill: '#b2c89a' } }).colors.fill, '#b2c89a');
});
test('AI can add a JSON theme and an invalid neighbor does not break built-ins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remaining-themes-'));
  try {
    await mkdir(join(root, 'themes'));
    await writeFile(join(root, 'themes/custom.json'), JSON.stringify({ ...basic, sizes: { font: 11 } }));
    await writeFile(join(root, 'themes/broken.json'), '{');
    await writeFile(join(root, 'themes/mismatch.json'), JSON.stringify({ ...basic, id: 'different' }));
    const result = await loadThemes(root);
    assert.deepEqual(result.themes.map((t) => t.id), ['bars', 'rings', 'custom']);
    assert.equal(activeTheme(result, 'custom').sizes.font, 11);
    assert.equal(result.errors.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('theme discovery ignores symlinks and retains defaults without a folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remaining-themes-'));
  try {
    assert.deepEqual((await loadThemes(root)).themes, DEFAULT_THEMES);
    await mkdir(join(root, 'themes'));
    await writeFile(join(root, 'outside.json'), JSON.stringify(basic));
    await symlink(join(root, 'outside.json'), join(root, 'themes/custom.json'));
    assert.deepEqual((await loadThemes(root)).themes, DEFAULT_THEMES);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('shipped presets and the example validate and ring assets encode the same data', async () => {
  for (const file of ['themes/bars.json', 'themes/rings.json', 'examples/compact.json']) {
    assert.ok(normalizeTheme(JSON.parse(await readFile(new URL(`../mods/remaining/${file}`, import.meta.url), 'utf8'))));
  }
  const quarter = await readFile(new URL('../mods/remaining/rings/25.svg', import.meta.url), 'utf8');
  assert.match(quarter, /stroke-dashoffset="47\.123890"/);
  const full = await readFile(new URL('../mods/remaining/rings/100.svg', import.meta.url), 'utf8');
  assert.match(full, /stroke-dashoffset="0\.000000"/);
});
