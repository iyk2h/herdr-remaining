import { readFile, writeFile } from 'node:fs/promises';
import { themeSchema } from '../mods/remaining/theme-format.mjs';

const root = new URL('../mods/remaining/', import.meta.url);
await writeFile(new URL('theme-schema.json', root), JSON.stringify(themeSchema, null, 2) + '\n');
const circle = await readFile(new URL('rings/track.svg', root), 'utf8');
// Use the Lucide circle as the track and encode measured quota progress in its stroke.
for (let value = 1; value <= 100; value++) {
  const circumference = 2 * Math.PI * 10;
  const ring = circle.replace('r="10"', `r="10" transform="rotate(-90 12 12)" stroke-dasharray="${circumference.toFixed(6)}" stroke-dashoffset="${(circumference * (1 - value / 100)).toFixed(6)}"`);
  await writeFile(new URL(`rings/${value}.svg`, root), ring);
}
