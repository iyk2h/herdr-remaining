const color = { type: 'string', pattern: '^(profile|foreground|muted|dim|accent|working|blocked|border|chrome|ansi(?:[0-9]|1[0-5])|#[0-9a-fA-F]{6})$' };
const number = (minimum, maximum, fallback) => ({ type: 'number', minimum, maximum, default: fallback });
export const themeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Remaining theme', type: 'object', additionalProperties: false,
  required: ['id', 'name', 'layout'],
  properties: {
    $schema: { type: 'string', maxLength: 200 },
    id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' },
    name: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[^\\x00-\\x1f]+$' },
    layout: { type: 'string', enum: ['bars', 'rings'] },
    show: { type: 'object', additionalProperties: false, default: {}, properties: {
      short: { type: 'boolean', default: true }, weekly: { type: 'boolean', default: true }, badge: { type: 'boolean', default: true },
    }, not: { required: ['short', 'weekly'], properties: { short: { const: false }, weekly: { const: false } } } },
    sizes: { type: 'object', additionalProperties: false, default: {}, properties: {
      font: number(10, 14, 12), rowPadding: number(0, 6, 2), gap: number(3, 10, 6),
      badge: number(14, 20, 16), bar: number(1, 5, 3), ring: number(20, 28, 24),
    } },
    colors: { type: 'object', additionalProperties: false, default: {}, properties: {
      text: { ...color, default: 'foreground' }, secondary: { ...color, default: 'muted' },
      fill: { ...color, default: 'profile' }, track: { ...color, default: 'border' },
      warning: { ...color, default: 'working' }, exhausted: { ...color, default: 'blocked' },
    } },
  },
};

// Only the schema vocabulary used above is needed; themes never execute code.
function field(spec, value, path) {
  if (value === undefined) {
    if (!Object.hasOwn(spec, 'default')) return undefined;
    value = spec.default;
  }
  if (spec.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`);
    for (const key of Object.keys(value)) if (!Object.hasOwn(spec.properties, key)) throw new Error(`${path}.${key}: unknown field`);
    for (const key of spec.required ?? []) if (value[key] === undefined) throw new Error(`${path}.${key}: required`);
    return Object.fromEntries(Object.entries(spec.properties).map(([key, schema]) => [key, field(schema, value[key], `${path}.${key}`)]).filter(([, result]) => result !== undefined));
  }
  if (typeof value !== spec.type || spec.type === 'number' && !Number.isFinite(value)) throw new Error(`${path}: expected ${spec.type}`);
  if (spec.enum && !spec.enum.includes(value)) throw new Error(`${path}: use ${spec.enum.join(' or ')}`);
  if (spec.pattern && !new RegExp(spec.pattern).test(value)) throw new Error(`${path}: invalid value`);
  if (spec.minLength !== undefined && value.length < spec.minLength || spec.maxLength !== undefined && value.length > spec.maxLength) throw new Error(`${path}: invalid length`);
  if (spec.minimum !== undefined && value < spec.minimum || spec.maximum !== undefined && value > spec.maximum) throw new Error(`${path}: out of range`);
  return value;
}

export function normalizeTheme(value) {
  const result = field(themeSchema, value, 'theme');
  if (!result.show.short && !result.show.weekly) throw new Error('theme.show: enable at least one limit');
  return result;
}

export const DEFAULT_THEMES = [
  normalizeTheme({ id: 'bars', name: 'Bars', layout: 'bars' }),
  normalizeTheme({ id: 'rings', name: 'Rings', layout: 'rings' }),
];
export function activeTheme(catalog, id) {
  return (catalog?.themes ?? DEFAULT_THEMES).find((theme) => theme.id === id) ?? DEFAULT_THEMES[0];
}
