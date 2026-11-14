import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const dart = await read('apps/kelivo/lib/theme/palettes.dart');
const css = await read('apps/mobile/src/styles.css');
const fixture = JSON.parse((await read('scripts/fixtures/product-host.js')).match(/const palettes = (.*);/u)[1]);
function palette(name, mode) {
  const block = dart.match(new RegExp(`static const ThemePalette ${name} = ThemePalette\\(([\\s\\S]*?)\\n  \\);`, 'u'))?.[1];
  assert.ok(block, name);
  const scheme = block.match(new RegExp(`${mode}: ColorScheme\\(([\\s\\S]*?)\\n    \\)`, 'u'))?.[1];
  assert.ok(scheme, mode);
  const entries = [...scheme.matchAll(/(\w+): Color\(0x([\dA-F]{8})\)/gu)].map(([, k, v]) => [k, `#${v.slice(2).toLowerCase()}`]);
  assert.equal(entries.length, new Set(entries.map(([k]) => k)).size, 'no duplicate ColorScheme fields');
  return Object.fromEntries(entries);
}
function variables(mode) {
  const pattern = mode === 'light' ? /:root \{([^}]+)\}/u : /:root\[data-theme="dark"\] \{([^}]+)\}/u;
  return Object.fromEntries([...css.match(pattern)[1].matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map(([, k, v]) => [k, v]));
}
function resolve(vars, key) {
  const value = vars[key];
  assert.ok(value, key);
  return value.startsWith('var(') ? resolve(vars, value.slice(4, -1)) : value;
}
function luminance(hex) {
  const channels = hex.slice(1).match(/../gu).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('A1 default and Classic retain stable palette identities', () => {
  assert.match(dart, /defaultId = 'default'/u);
  assert.match(dart, /classicId = 'classic'/u);
  assert.match(dart, /all = <ThemePalette>\[\s*defaultPalette,\s*classic,/u);
  for (const id of ['blue', 'green', 'purple', 'yellow', 'smoky_rose', 'terracotta', 'monochrome', 'doc_theme']) assert.ok(dart.includes(`= '${id}'`));
  assert.equal(palette('classic', 'light').primary, '#4d5c92');
  assert.equal(palette('classic', 'dark').primary, '#b6c4ff');
  assert.equal(palette('defaultPalette', 'light').surface, '#f6f4ef');
  assert.equal(palette('defaultPalette', 'dark').surface, '#111317');
});

test('Flutter, standalone CSS and host fixture agree on A1 color roles', () => {
  const mapping = { surface: ['--bg-0', 'background'], onSurface: ['--text', 'text'], onSurfaceVariant: ['--muted', 'muted'], primary: ['--accent', 'primary'], onPrimary: ['--on-accent', 'onPrimary'], primaryContainer: ['--accent-soft', 'primaryContainer'], secondaryContainer: ['--navigation-indicator', 'navigationIndicator'], tertiary: ['--signal', 'signal'], error: ['--danger', 'error'] };
  for (const mode of ['light', 'dark']) {
    const scheme = palette('defaultPalette', mode), vars = variables(mode);
    for (const [role, [variable, field]] of Object.entries(mapping)) {
      assert.equal(resolve(vars, variable), scheme[role], `${mode} ${variable}`);
      assert.equal(fixture[mode][field], scheme[role], `${mode} fixture ${field}`);
    }
    for (const [field, variable] of Object.entries({ panel: '--panel', fill: '--bg-2', userBubble: '--user-bubble', composer: '--composer-surface', avatar: '--avatar-surface', outline: '--border', secondaryText: '--subtle', messageAuthor: '--message-author' })) assert.equal(resolve(vars, variable), fixture[mode][field]);
  }
});

test('A1 normal text pairs meet AA (4.5:1), including muted text on filled surfaces', () => {
  for (const mode of ['light', 'dark']) {
    const s = palette('defaultPalette', mode), vars = variables(mode);
    for (const [fg, bg] of [['onSurface', 'surface'], ['onSurfaceVariant', 'surface'], ['onPrimary', 'primary'], ['onPrimaryContainer', 'primaryContainer'], ['onSecondary', 'secondary'], ['onSecondaryContainer', 'secondaryContainer'], ['onTertiary', 'tertiary'], ['onTertiaryContainer', 'tertiaryContainer'], ['onError', 'error'], ['onErrorContainer', 'errorContainer'], ['onInverseSurface', 'inverseSurface'], ...['Primary', 'Secondary', 'Tertiary'].flatMap(role => [['on'+role+'Fixed', role.toLowerCase()+'Fixed'], ['on'+role+'FixedVariant', role.toLowerCase()+'FixedDim']])]) {
      const ratio = contrast(s[fg], s[bg]);
      assert.ok(ratio >= 4.5, `${mode} ${fg}/${bg}: ${ratio.toFixed(2)}`);
    }
    for (const fg of ['--text', '--muted', '--subtle', '--message-author']) for (const bg of ['--bg-0', '--panel', '--bg-2', '--user-bubble', '--composer-surface']) {
      const ratio = contrast(resolve(vars, fg), resolve(vars, bg));
      assert.ok(ratio >= 4.5, `${mode} ${fg}/${bg}: ${ratio.toFixed(2)}`);
    }
    for (const fg of ['--signal', '--danger', '--ok']) {
      for (const bg of ['--bg-0', '--status-surface']) {
        const ratio = contrast(resolve(vars, fg), resolve(vars, bg));
        assert.ok(ratio >= 4.5, `${mode} ${fg}/${bg}: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('CSS uses only the shared radius, spacing, type and monospace tokens', () => {
  const vars = variables('light');
  assert.deepEqual(Object.keys(vars).filter(k => k.startsWith('--radius-')).sort(), ['--radius-12', '--radius-16', '--radius-24', '--radius-8', '--radius-pill']);
  assert.deepEqual(Object.keys(vars).filter(k => k.startsWith('--font-size-')).sort(), ['--font-size-12', '--font-size-13', '--font-size-15', '--font-size-17', '--font-size-20']);
  for (const [key, value] of Object.entries(vars)) if (key.startsWith('--space-')) assert.equal(parseFloat(value) % 4, 0);
  for (const [, value] of css.matchAll(/(?<![\w-])(?:border-radius|font-size):\s*([^;}]+)/gu)) assert.doesNotMatch(value, /\d(?:px|rem|em|%)/u);
  for (const [, value] of css.matchAll(/(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-[\w-]+)?:\s*([^;}]+)/gu)) {
    // Large responsive content-width constraints within calc() are geometry.
    for (const [, pixels] of value.matchAll(/(-?\d+)px/gu)) assert.ok(Math.abs(Number(pixels)) > 64, value);
  }
  assert.equal([...css.matchAll(/font-family:[^;]*monospace/gu)].length, 0);
  assert.equal([...css.matchAll(/--font-mono:/gu)].length, 1);
  assert.match(css, /font-size: calc\(var\(--font-size-15\) \* var\(--remote-chat-scale, 1\)\)/u);
});
